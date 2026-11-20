"""用真实音频验证混音倍速、输出格式及写入失败时的保护。"""
import os
import sys
import subprocess
from unittest.mock import patch

import numpy as np
import soundfile as sf

from mix import (
    SR,
    _limit_true_peak,
    _master_voice_track,
    _measure_ebu_lufs,
    _select_aac_encoder,
    decode_audio_file,
    write_master_output,
)


def verify_clip_playback_speed(root):
    os.makedirs(root, exist_ok=True)
    duration = 24.0
    times = np.arange(int(duration * SR), dtype=np.float32) / SR
    source = os.path.join(root, 'source.wav')
    sf.write(source, 0.2 * np.sin(2 * np.pi * 440 * times), SR)
    for speed in (1.0, 1.005, 0.995, 1.5):
        decoded = decode_audio_file(source, channels=2, speed=speed)
        actual, expected = len(decoded) / SR, duration / speed
        assert abs(actual - expected) < 0.025, f'{speed}x audio duration {actual:.6f}s must match {expected:.6f}s'
        sample = decoded[SR:2 * SR, 0]
        assert np.sqrt(np.mean(sample ** 2)) > 0.09, 'Decoded clip must contain the source audio'
        spectrum = np.abs(np.fft.rfft(sample))
        peak_hz = np.fft.rfftfreq(len(sample), 1 / SR)[np.argmax(spectrum)]
        assert abs(peak_hz - 440) <= 1, f'Playback speed must preserve the source pitch, got {peak_hz}Hz'
        print(f'  Clip audio {speed}x: {actual:.6f}s (expected {expected:.6f}s), {peak_hz:.0f}Hz')


def verify_master_output_extensions(root):
    output_dir = os.path.join(root, '输出 格式')
    os.makedirs(output_dir, exist_ok=True)
    times = np.arange(SR, dtype=np.float32) / SR
    stereo = np.stack([0.2 * np.sin(2 * np.pi * 440 * times), 0.15 * np.sin(2 * np.pi * 660 * times)], axis=1)
    for name in ('control.wav', 'lower.m4a', 'upper.M4A', 'mixed.M4a'):
        output = os.path.join(output_dir, name)
        write_master_output(stereo, output, bitrate='96k')
        decoded = decode_audio_file(output, channels=2)
        actual = len(decoded) / SR
        assert abs(actual - 1) < 0.025, f'{name} must preserve the one-second audio duration, got {actual:.6f}s'
        for channel, expected_hz in enumerate((440, 660)):
            sample = decoded[SR // 4:3 * SR // 4, channel]
            assert np.sqrt(np.mean(sample ** 2)) > 0.05, f'{name} must retain channel {channel} audio'
            spectrum = np.abs(np.fft.rfft(sample))
            peak_hz = np.fft.rfftfreq(len(sample), 1 / SR)[np.argmax(spectrum)]
            assert abs(peak_hz - expected_hz) <= 2, f'{name} channel {channel} must retain {expected_hz}Hz, got {peak_hz}Hz'
        if name.lower().endswith('.m4a'):
            with open(output, 'rb') as stream:
                assert stream.read(8)[4:8] == b'ftyp', f'{name} must use the M4A container'
        print(f'  Master output {name}: {actual:.6f}s, stereo 440/660Hz')
    assert not any('.tmp.' in name for name in os.listdir(output_dir)), 'Master output must clean its temporary audio files'


def verify_master_write_failures(root):
    output_dir = os.path.join(root, 'write-failures')
    os.makedirs(output_dir, exist_ok=True)
    samples = np.zeros((SR, 2), dtype=np.float32)
    original_write = sf.write
    expected_files = set()

    def fail_pcm(file, data, samplerate, *args, **kwargs):
        original_write(file, data[:64], samplerate, *args, **kwargs)
        raise OSError('Intentional PCM write failure after opening output')

    def fail_encoder(command, **kwargs):
        with open(command[-1], 'wb') as stream:
            stream.write(b'partial failed audio encoding')
        raise subprocess.CalledProcessError(9, command)

    for suffix, phase in (('.wav', 'pcm'), ('.m4a', 'pcm'), ('.m4a', 'encoder')):
        name = phase + suffix
        output = os.path.join(output_dir, name)
        expected_files.add(name)
        write_master_output(samples, output)
        with open(output, 'rb') as stream:
            before = stream.read()
        assert abs(len(decode_audio_file(output)) / SR - 1) < 0.025, 'The previous output must contain a complete second of audio'
        target = 'mix.sf.write' if phase == 'pcm' else 'mix.subprocess.run'
        handler = fail_pcm if phase == 'pcm' else fail_encoder
        with patch(target, side_effect=handler) as injected:
            try:
                write_master_output(samples, output)
            except (OSError, subprocess.CalledProcessError):
                pass
            else:
                raise AssertionError(f'{name} must propagate the injected write failure')
            assert injected.called, 'The injected failure must exercise the writer or encoder'
        with open(output, 'rb') as stream:
            assert stream.read() == before, f'{name} failure must preserve the previous complete audio file'
        assert abs(len(decode_audio_file(output)) / SR - 1) < 0.025, 'Preserved audio must still decode completely'
        assert set(os.listdir(output_dir)) == expected_files, f'{name} failure must remove private temporary files'
        write_master_output(samples[:SR // 2], output)
        with open(output, 'rb') as stream:
            assert stream.read() != before, f'{name} must replace the old audio after a successful retry'
        assert abs(len(decode_audio_file(output)) / SR - 0.5) < 0.025, 'A successful retry must publish the new complete audio'
        assert set(os.listdir(output_dir)) == expected_files, 'A successful retry must clean private temporary files'
        print(f'  Master output {name} failure: previous audio preserved, temporary files cleaned')


def verify_mastering_quality(root):
    os.makedirs(root, exist_ok=True)
    times = np.arange(SR, dtype=np.float32) / SR
    sine_07 = np.stack([0.7 * np.sin(2 * np.pi * 1000 * times), 0.7 * np.sin(2 * np.pi * 1000 * times)], axis=1)
    clean = _limit_true_peak(sine_07, -1.5)
    spec = np.abs(np.fft.rfft(clean[:, 0]))
    thd = float(np.sqrt(np.sum(spec[[2000, 3000, 4000, 5000]] ** 2)) / max(1e-12, spec[1000]))
    assert thd < 0.0005, f'Normal levels must remain linear (THD < 0.05%), got {thd * 100:.4f}%'

    sine_14 = np.stack([1.4 * np.sin(2 * np.pi * 1000 * times), 1.4 * np.sin(2 * np.pi * 1000 * times)], axis=1)
    limited = _limit_true_peak(sine_14, -1.5)
    assert float(np.abs(limited).max()) <= 0.86, f'Limiter must cap 1.4 peak below -1.3 dBFS, got {float(np.abs(limited).max()):.4f}'

    t2 = np.arange(int(1.2 * SR), dtype=np.float32) / SR
    speech_sig = (0.18 * np.sin(2 * np.pi * 500 * t2) + 0.12 * np.sin(2 * np.pi * 1200 * t2)).astype(np.float32)
    mastered = _master_voice_track(speech_sig, True, np.zeros(len(speech_sig), dtype=bool), 'speech', -16.0)
    lufs = _measure_ebu_lufs(mastered)
    assert lufs is not None and -17.0 <= lufs <= -15.0, f'Expected -16 LUFS (+/-1), got {lufs}'
    assert float(np.abs(mastered).max()) <= 0.92, 'Mastered voice must leave headroom'

    assert _select_aac_encoder('64k', 'auto') != 'aac_mf', 'aac_mf must be skipped below 96 kbps to prevent HE-AAC drift'
    enc_128 = _select_aac_encoder('128k', 'auto')
    assert enc_128 in ('libfdk_aac', 'aac_at', 'aac_mf', 'aac'), f'Unexpected encoder {enc_128}'
    print(f'  Mastering quality: THD={thd * 100:.4f}%, peak={float(np.abs(limited).max()):.3f}, lufs={lufs:.1f}, enc128={enc_128}')


if __name__ == '__main__':
    test_root = os.path.abspath(sys.argv[1])
    verify_clip_playback_speed(test_root)
    verify_master_output_extensions(test_root)
    verify_master_write_failures(test_root)
    verify_mastering_quality(os.path.join(test_root, 'mastering'))
    print('Clip playback speed, master output formats, mastering quality and write failure protection PASSED.')
