"""验证单句配音、缓存和时间轴写入保护与离线恢复，不调用外部 TTS。"""
import builtins
import json
import subprocess
from unittest.mock import patch
import os
import shutil
import sys
import tempfile
import threading

import numpy as np
import soundfile as sf

import voice


def make_wave(file, duration, frequency=220):
    t = np.arange(round(duration * 24000)) / 24000
    sf.write(file, (np.sin(t * 2 * np.pi * frequency) * 0.2).astype(np.float32), 24000)


def payload(duration):
    return {'dur': duration, 'words': [[0.0, 'tone']], 'env': [0]}


def check_restore_integrity(root):
    folder = tempfile.mkdtemp(prefix='restore-', dir=root)
    source, other, longer = [os.path.join(folder, name) for name in ('source.wav', 'other.wav', 'longer.wav')]
    cache, meta, out = [os.path.join(folder, name) for name in ('cache.wav', 'cache.json', 'out.wav')]
    make_wave(source, 0.4)
    make_wave(other, 0.4, 440)
    make_wave(longer, 0.8)
    voice._write_cache_entry_atomic(source, cache, meta, payload(0.4))
    hit = voice._try_load_cached_voice(cache, meta, out)
    assert hit is not None and hit[0] == 0.4, 'Valid cache entry must restore'
    with open(out, 'rb') as stream:
        previous = stream.read()
    shutil.copyfile(other, cache)
    assert voice._try_load_cached_voice(cache, meta, out) is None, 'Changed audio with equal duration must not reuse unrelated metadata'
    with open(out, 'rb') as stream:
        assert stream.read() == previous, 'Rejected cache must preserve previous output'
    with open(meta, 'w', encoding='utf-8') as stream:
        json.dump({'dur': 0.4, 'env': [0]}, stream)
    assert voice._try_load_cached_voice(cache, meta, out) is None, 'Incomplete metadata must be rejected'
    with open(out, 'rb') as stream:
        assert stream.read() == previous, 'Incomplete metadata must not overwrite output'
    shutil.copyfile(source, cache)
    with open(meta, 'w', encoding='utf-8') as stream:
        json.dump(payload(0.4), stream)
    assert voice._try_load_cached_voice(cache, meta, out) is not None, 'Valid legacy cache entries must remain usable'
    shutil.copyfile(longer, cache)
    assert voice._try_load_cached_voice(cache, meta, out) is None, 'Legacy cache duration must match the actual WAV'
    with open(out, 'rb') as stream:
        assert stream.read() == previous, 'Invalid legacy cache must preserve output'
    assert not any(name.endswith('.cache.tmp') for name in os.listdir(folder)), 'Cache restore must clean its temporary files'


def check_concurrent_writers(root):
    folder = tempfile.mkdtemp(prefix='concurrent-', dir=root)
    a_wav, b_wav, cache, meta, out = [os.path.join(folder, name) for name in ('a.wav', 'b.wav', 'cache.wav', 'cache.json', 'out.wav')]
    make_wave(a_wav, 0.4)
    make_wave(b_wav, 0.8, 440)
    a_written, b_finished = threading.Event(), threading.Event()
    original_replace = os.replace

    def interleaved_replace(src, dst):
        original_replace(src, dst)
        if threading.current_thread().name == 'cache-a' and dst == cache:
            a_written.set()
            assert b_finished.wait(5), 'Second writer must complete'
        if threading.current_thread().name == 'cache-b' and dst == meta:
            b_finished.set()

    a = threading.Thread(target=voice._write_cache_entry_atomic, args=(a_wav, cache, meta, payload(0.4)), name='cache-a')
    b = threading.Thread(target=voice._write_cache_entry_atomic, args=(b_wav, cache, meta, payload(0.8)), name='cache-b')
    try:
        os.replace = interleaved_replace
        a.start()
        assert a_written.wait(5), 'First writer must publish audio'
        b.start()
        a.join(10)
        b.join(10)
        assert not a.is_alive() and not b.is_alive(), 'Cache writers must finish'
    finally:
        os.replace = original_replace
    with open(meta, encoding='utf-8') as stream:
        assert json.load(stream)['dur'] == 0.4, 'Fixture must finish with first metadata'
    assert sf.info(cache).duration == 0.8, 'Fixture must finish with second audio'
    assert voice._try_load_cached_voice(cache, meta, out) is None, 'Interleaved cache writes must not restore mismatched audio and metadata'
    assert not os.path.exists(out), 'Rejected cache must not create a usable dry clip'


def check_offline_hydration(root):
    folder = tempfile.mkdtemp(prefix='offline-', dir=root)
    cache_dir, output_dir = os.path.join(folder, 'cache'), os.path.join(folder, 'voice')
    os.makedirs(cache_dir)
    cfg = {'provider': 'custom', 'speed': 1.0}
    digest = voice.make_cache_key(cfg, 'tone', 1.0)
    cache, meta = os.path.join(cache_dir, digest + '.wav'), os.path.join(cache_dir, digest + '.json')
    make_wave(cache, 0.8)
    with open(meta, 'w', encoding='utf-8') as stream:
        json.dump(payload(0.4), stream)
    original_cache_dir = voice.CACHE_DIR
    try:
        voice.CACHE_DIR = cache_dir
        voice.hydrate_cached_voices([[{'text': 'original', 'spoken': 'tone'}]], output_dir, cfg)
        assert not os.path.exists(os.path.join(output_dir, '00_00.wav')), 'Offline mix must fall back to the stem for inconsistent cache'
        source = os.path.join(folder, 'valid.wav')
        make_wave(source, 0.4)
        voice._write_cache_entry_atomic(source, cache, meta, payload(0.4))
        voice.hydrate_cached_voices([[{'text': 'original', 'spoken': 'tone'}]], output_dir, cfg)
        assert sf.info(os.path.join(output_dir, '00_00.wav')).duration == 0.4, 'Offline mix must still restore valid cached clips'
    finally:
        voice.CACHE_DIR = original_cache_dir


def check_processed_voice_case(root, phase, existing):
    folder = tempfile.mkdtemp(prefix=f'processed-{phase}-', dir=root)
    source, raw, output = [os.path.join(folder, name) for name in ('source.wav', 'raw.wav', '00_00.wav')]
    if existing:
        make_wave(output, 1.0)
    previous = voice._file_sha256(output) if existing else None
    original_write = sf.write

    def partial_write(file, data, samplerate, *args, **kwargs):
        original_write(file, data[:64], samplerate, *args, **kwargs)
        raise OSError('Intentional processed voice write failure')

    make_wave(source, 0.5, 440)
    failure = OSError('Intentional processed voice publication failure')
    contexts = {
        'write': patch.object(voice.sf, 'write', side_effect=partial_write),
        'alignment': patch.object(voice, 'align_words_acoustic', side_effect=failure),
        'replace': patch.object(voice.os, 'replace', side_effect=failure),
    }
    with contexts[phase] as injected:
        try:
            voice.post_process_audio(source, raw, output, [], 1.0, 'tone', {})
        except OSError as error:
            assert 'Intentional processed voice' in str(error)
        else:
            raise AssertionError(f'Processed voice {phase} failure must propagate')
        assert injected.called, f'The processed voice {phase} failure must be exercised'
    if existing:
        assert voice._file_sha256(output) == previous, f'{phase}: failed processing must preserve the complete previous dry clip'
        assert abs(sf.info(output).duration - 1.0) < 1e-6
    else:
        assert not os.path.exists(output), f'{phase}: failed processing must not publish a partial new dry clip'
    assert set(os.listdir(folder)) == ({'00_00.wav'} if existing else set()), f'{phase}: failed processing must remove its temporary files'
    make_wave(source, 0.5, 440)
    duration, words, envelope = voice.post_process_audio(source, raw, output, [], 1.0, 'tone', {})
    samples, samplerate = sf.read(output, dtype='float32')
    assert duration == 0.5 and abs(sf.info(output).duration - duration) < 1e-6, 'A successful retry must publish the complete replacement audio'
    assert samplerate == 24000 and np.max(np.abs(samples)) > 0.1
    assert words and words[0][1] == 'tone' and len(envelope) == 15, 'Retry audio must match its word timing and 30Hz envelope'
    assert voice._file_sha256(output) != previous
    assert set(os.listdir(folder)) == {'00_00.wav'}, 'Successful processing must clean its temporary files'


def check_processed_voice_output(root):
    for phase in ('write', 'alignment', 'replace'):
        for existing in (True, False):
            check_processed_voice_case(root, phase, existing)
    print('  Processed voice partial writes, alignment/publication failures, new outputs and successful retries PASSED.')


class PartialTimingWriter:
    def __init__(self, stream):
        self.stream = stream

    def __enter__(self):
        self.stream.__enter__()
        return self

    def __exit__(self, *args):
        return self.stream.__exit__(*args)

    def write(self, data):
        self.stream.write(data[:8])
        self.stream.flush()
        raise OSError('Intentional timing text write failure')


def check_timings_write_failures(root):
    folder = tempfile.mkdtemp(prefix='timings-', dir=root)
    output = os.path.join(folder, 'timings.js')
    node = shutil.which('node')
    assert node, 'Timing JavaScript must be checked in the Node runtime'
    node_code = "import fs from 'node:fs';import vm from 'node:vm';const V={};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{V,window:{V}});process.stdout.write(JSON.stringify(V.voice));"

    def write(label, duration):
        voice._write_timings_js(output, 'assets/tone.m4a', False, label, [[duration]], [[[(0, duration, label)]]], [[[0.1, 0.2]]], '')

    def load():
        loaded = subprocess.run([node, '--input-type=module', '-e', node_code, output], capture_output=True, text=True, encoding='utf-8', timeout=15000)
        assert loaded.returncode == 0, f'Published timing JavaScript must remain usable: {loaded.stderr}'
        return json.loads(loaded.stdout)

    def partial_open(file, *args, **kwargs):
        assert os.path.dirname(os.path.abspath(file)) == folder, 'Timing temporary files must stay in the output directory'
        return PartialTimingWriter(builtins.open(file, *args, **kwargs))

    write('previous', 1.0)
    assert load()['voice'] == 'previous'
    with open(output, 'rb') as stream:
        previous = stream.read()
    for phase in ('write', 'replace'):
        injected_error = OSError('Intentional timing publication failure')
        context = patch.object(voice, 'open', side_effect=partial_open, create=True) if phase == 'write' else patch.object(voice.os, 'replace', side_effect=injected_error)
        with context as injected:
            try:
                write('replacement', 2.0)
            except OSError as error:
                assert 'Intentional timing' in str(error)
            else:
                raise AssertionError(f'Timing {phase} failure must propagate')
            assert injected.called, f'The timing {phase} failure must be exercised'
        with open(output, 'rb') as stream:
            assert stream.read() == previous, f'Timing {phase} failure must preserve the previous complete JavaScript'
        metadata = load()
        assert metadata['voice'] == 'previous' and metadata['durations'] == [[1.0]]
        assert set(os.listdir(folder)) == {'timings.js'}, 'Failed timing output must clean its private temporary file'
    write('updated', 2.0)
    metadata = load()
    assert metadata['voice'] == 'updated' and metadata['durations'] == [[2.0]]
    assert metadata['words'][0][0][0][2] == 'updated', 'A successful retry must publish the updated word data'
    with open(output, 'rb') as stream:
        assert stream.read() != previous
    assert set(os.listdir(folder)) == {'timings.js'}, 'Successful timing output must clean its private temporary file'
    print('  Timing partial writes, failed replacement, successful retry and Node loading PASSED.')


if __name__ == '__main__':
    root = os.path.abspath(sys.argv[1])
    os.makedirs(root, exist_ok=True)
    check_restore_integrity(root)
    check_concurrent_writers(root)
    check_offline_hydration(root)
    check_processed_voice_output(root)
    check_timings_write_failures(root)
    print('Voice output protection, cache integrity, timing publication, concurrent writes, legacy entries and offline hydration PASSED.')
