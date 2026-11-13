"""通用混音管线：支持 BGM 侧链闪避、48kHz 程序化动作微音效、受控 <video> 切片原声混入与 AAC 封装。"""
import json, math, os, subprocess, sys
import imageio_ffmpeg, numpy as np, soundfile as sf
from scipy.signal import fftconvolve, resample_poly

SR = 48000
rng = np.random.default_rng(7)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def env_ad(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d)


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


def place(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf) or i + len(sig) <= 0:
        return
    j = min(len(buf), i + len(sig))
    s0 = max(0, -i)
    buf[max(i, 0):j] += sig[s0:s0 + j - max(i, 0)]


def place_stereo(buf_st, sig_st, at, gain=1.0):
    if sig_st.ndim == 1:
        sig_st = np.stack([sig_st, sig_st], axis=1)
    i = int(at * SR)
    if i >= len(buf_st) or i + len(sig_st) <= 0:
        return
    j = min(len(buf_st), i + len(sig_st))
    s0 = max(0, -i)
    buf_st[max(i, 0):j] += sig_st[s0:s0 + j - max(i, 0)] * gain


def decode_audio_file(path, channels=2, trim_start=0.0, speed=1.0):
    cmd = [FFMPEG, '-v', 'error']
    if trim_start > 0:
        cmd += ['-ss', f'{trim_start:.3f}']
    cmd += ['-i', path]
    if abs(speed - 1.0) > 0.01:
        clamped = max(0.5, min(2.0, float(speed)))
        cmd += ['-af', f'atempo={clamped:.4f}']
    cmd += ['-f', 'f32le', '-ac', str(channels), '-ar', str(SR), '-']
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0 or not proc.stdout:
        return np.zeros((0, 2) if channels == 2 else 0, dtype=np.float32)
    arr = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    return arr.reshape(-1, 2) if channels == 2 else arr


def loop_track(track, target_n, loop=True):
    if len(track) == 0:
        return np.zeros((target_n, 2), dtype=np.float32)
    if len(track) >= target_n:
        return track[:target_n].copy()
    if not loop:
        out = np.zeros((target_n, 2), dtype=np.float32)
        out[:len(track)] = track
        return out
    xfade = min(int(0.5 * SR), len(track) // 4)
    if xfade < 64:
        return np.tile(track, (math.ceil(target_n / len(track)), 1))[:target_n].copy()
    out = np.zeros((target_n + len(track), 2), dtype=np.float32)
    step = len(track) - xfade
    fade_in = np.linspace(0.0, 1.0, xfade)[:, None]
    fade_out = 1.0 - fade_in
    pos, first = 0, True
    while pos < target_n:
        seg = track.copy()
        if not first:
            seg[:xfade] *= fade_in
            out[pos:pos + xfade] *= fade_out
        out[pos:pos + len(seg)] += seg
        pos, first = pos + step, False
    return out[:target_n]


def intensity(t, sections):
    for s in sections:
        if s['start'] <= t < s['start'] + s['duration']:
            return s.get('energy', 0.55)
    return 0.55


AMB_CHORDS = [(53, [60, 64, 67, 69]), (55, [59, 62, 67, 71]), (57, [60, 64, 67, 71]), (48, [60, 64, 67, 71])]


def _add_ambient_pulses(L, Rr, t0, bar, bar_len, chord, inten):
    beat = bar_len / 4.0
    pn = int(0.28 * SR)
    pt = np.arange(pn) / SR
    for q in range(4):
        note = chord[(bar + q) % len(chord)] + 12
        ping = np.sin(2 * np.pi * midi(note) * pt) * env_ad(pn, 0.01, 0.09) * 0.045 * inten
        place(L, ping * 0.85, t0 + q * beat)
        place(Rr, ping, t0 + q * beat + 0.015)


def music_ambient(dur, sections):
    n = int(dur * SR) + SR
    L, Rr = np.zeros(n), np.zeros(n)
    bar_len = 60.0 / 92.0 * 4.0
    for bar in range(int(dur / bar_len) + 2):
        t0 = bar * bar_len
        inten = intensity(t0, sections)
        root, chord = AMB_CHORDS[bar % len(AMB_CHORDS)]
        pad_n = int((bar_len + 0.8) * SR)
        t = np.arange(pad_n) / SR
        env = np.minimum(1.0, t / 0.65) * np.clip((bar_len + 0.8 - t) / 0.85, 0.0, 1.0) * (0.45 + 0.55 * inten)
        bass = np.sin(2 * np.pi * midi(root - 12) * t) * env * 0.20
        place(L, bass, t0)
        place(Rr, bass, t0)
        for idx, note in enumerate(chord):
            freq = midi(note)
            sig = (np.sin(2 * np.pi * freq * t) * 0.75 + np.sin(2 * np.pi * freq * (1.0 + (idx - 1.5) * 0.0012) * t) * 0.25) * env * 0.07
            pan = 0.35 + 0.15 * idx
            place(L, sig * (1.0 - pan * 0.4), t0)
            place(Rr, sig * (0.6 + pan * 0.4), t0)
        if inten > 0.48:
            _add_ambient_pulses(L, Rr, t0, bar, bar_len, chord, inten)
    return np.stack([L, Rr], axis=1)[:int(dur * SR)]


def soft_whoosh():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    filt = np.convolve(rng.normal(0.0, 1.0, n), np.ones(36) / 36, mode='same')
    env = np.sin(np.pi * np.clip(t / 0.32, 0, 1)) ** 1.6
    tone = np.sin(2 * np.pi * np.cumsum(np.linspace(220, 440, n)) / SR) * env * 0.10
    return filt * env * 0.28 + tone


def soft_impact():
    n = int(0.75 * SR)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(np.linspace(120, 46, n)) / SR) * np.exp(-t / 0.24) * 0.45
    return sub + np.sin(2 * np.pi * midi(72) * t) * env_ad(n, 0.01, 0.22) * 0.12


def sfx_click():
    n = int(0.032 * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * np.cumsum(np.linspace(1500, 320, n)) / SR) * np.exp(-t / 0.007) * 0.55 + rng.normal(0.0, 1.0, n) * np.exp(-t / 0.0025) * 0.22
    return np.stack([sig, sig], axis=1)


def sfx_key():
    n = int(0.075 * SR)
    t = np.arange(n) / SR
    act = np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.003) * 0.28
    thock = np.sin(2 * np.pi * np.cumsum(np.linspace(420, 135, n)) / SR) * np.exp(-t / 0.014) * 0.52
    bot, b0 = np.zeros(n), int(0.028 * SR)
    tb = np.arange(n - b0) / SR
    bot[b0:] = np.sin(2 * np.pi * np.cumsum(np.linspace(260, 110, n - b0)) / SR) * np.exp(-tb / 0.011) * 0.30
    sig = act + thock + bot
    return np.stack([sig * 0.96, sig], axis=1)


def sfx_ping():
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f1 = np.sin(2 * np.pi * 880.0 * t) * env_ad(n, 0.004, 0.14) * 0.42
    f2 = np.sin(2 * np.pi * 1318.5 * t) * env_ad(n, 0.008, 0.18) * 0.28
    return np.stack([f1 + f2 * 0.85, f1 * 0.90 + f2], axis=1)


def sfx_stamp():
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * np.cumsum(np.linspace(210, 68, n)) / SR) * np.exp(-t / 0.032) * 0.58
    tick, k0 = np.zeros(n), int(0.016 * SR)
    tk = np.arange(n - k0) / SR
    tick[k0:] = np.sin(2 * np.pi * 1180 * tk) * np.exp(-tk / 0.012) * 0.26
    sig = body + tick
    return np.stack([sig, sig], axis=1)


def sfx_alert():
    n = int(0.30 * SR)
    t = np.arange(n) / SR
    p1 = np.sin(2 * np.pi * 660 * t) * env_ad(n, 0.005, 0.055) * 0.42
    p2, s0 = np.zeros(n), int(0.11 * SR)
    ts = np.arange(n - s0) / SR
    p2[s0:] = np.sin(2 * np.pi * 520 * ts) * env_ad(n - s0, 0.005, 0.075) * 0.45
    sig = np.tanh((p1 + p2) * 1.4) * 0.75
    return np.stack([sig, sig], axis=1)


BUILTIN_ACTION_SFX = {
    'click': sfx_click, 'key': sfx_key, 'ping': sfx_ping, 'chime': sfx_ping,
    'stamp': sfx_stamp, 'pop': sfx_stamp, 'alert': sfx_alert, 'warn': sfx_alert,
    'whoosh': lambda: np.stack([soft_whoosh(), soft_whoosh()], axis=1),
    'impact': lambda: np.stack([soft_impact(), soft_impact()], axis=1),
}


def pulse(freq, n, duty=0.25):
    return np.where((np.arange(n) / SR * freq) % 1 < duty, 1.0, -1.0)


def tri(freq, n):
    return 4 * np.abs(((np.arange(n) / SR * freq) % 1) - 0.5) - 1


def noise(n):
    return rng.choice([-1.0, 1.0], n)


CHIP_PROG = [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [67, 72, 76]), (55, [67, 71, 74])]


def _chip_arp(L, Rr, tb, q, beat, chord, inten):
    for s in range(4):
        ts = tb + s * beat / 4
        m = chord[(q * 4 + s) % 3] + (12 if (q + s) % 4 == 3 else 0)
        arp = pulse(midi(m), int(0.12 * SR), 0.125) * env_ad(int(0.12 * SR), 0.001, 0.05) * 0.07 * (0.35 + inten)
        place(L, arp, ts)
        place(Rr, arp * 0.7, ts)
        place(Rr, arp * 0.35, ts + beat * 0.75)
        if inten > 0.5:
            hn = int(0.025 * SR)
            place(L, noise(hn) * env_ad(hn, 0.001, 0.006) * 0.05 * inten, ts)


def chip_bar(L, Rr, t0, beat, bar, inten):
    root, chord = CHIP_PROG[(bar // 2) % 4]
    for q in range(4):
        tb = t0 + q * beat
        if inten > 0.35:
            kn = int(0.09 * SR)
            k = np.sign(np.sin(2 * np.pi * np.cumsum(np.linspace(180, 50, kn)) / SR)) * env_ad(kn, 0.001, 0.04) * 0.5 * inten
            place(L, k, tb)
            place(Rr, k, tb)
        if inten > 0.55 and q % 2 == 1:
            sn = noise(int(0.12 * SR)) * env_ad(int(0.12 * SR), 0.001, 0.05) * 0.16 * inten
            place(L, sn, tb)
            place(Rr, sn, tb)
        for e in range(2):
            bn = int(beat / 2 * SR)
            bass = tri(midi(root - 12 + (7 if e else 0)), bn) * env_ad(bn, 0.003, 0.18) * 0.34 * (0.5 + inten)
            place(L, bass, tb + e * beat / 2)
            place(Rr, bass, tb + e * beat / 2)
        _chip_arp(L, Rr, tb, q, beat, chord, inten)


def chip_lead(L, Rr, t0, beat, bar, inten):
    if inten < 0.5 or bar % 2:
        return
    phrase = [76, 74, 72, 74, 76, 79, 76, 72] if (bar // 2) % 2 == 0 else [72, 71, 69, 71, 72, 74, 72, 69]
    ln = int(beat * 0.9 * SR)
    for k, m in enumerate(phrase):
        v = pulse(midi(m), ln, 0.5) * env_ad(ln, 0.005, 0.25) * 0.045 * inten
        place(L, v * 0.8, t0 + k * beat)
        place(Rr, v, t0 + k * beat)


def music_chiptune(dur, sections):
    n = int(dur * SR) + SR
    beat = 60 / 112
    L, Rr = np.zeros(n), np.zeros(n)
    for bar in range(int(dur / (beat * 4)) + 2):
        t0 = bar * beat * 4
        inten = intensity(t0, sections)
        chip_bar(L, Rr, t0, beat, bar, inten)
        chip_lead(L, Rr, t0, beat, bar, inten)
    return np.stack([L, Rr], 1)[:int(dur * SR)]


def chip_whoosh():
    out = np.zeros(int(0.5 * SR))
    n = int(0.06 * SR)
    for k, m in enumerate([60, 64, 67, 72, 76, 79, 84]):
        place(out, pulse(midi(m), n, 0.25) * env_ad(n, 0.001, 0.03) * 0.35, k * 0.05)
    return out


def chip_impact():
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    out = np.sign(np.sin(2 * np.pi * (110 * t - 50 * t * t))) * np.exp(-t / 0.18) * 0.5 + noise(n) * np.exp(-t / 0.04) * 0.3
    place(out, pulse(midi(88), int(0.25 * SR), 0.5) * env_ad(int(0.25 * SR), 0.001, 0.08) * 0.3, 0.08)
    place(out, pulse(midi(95), int(0.35 * SR), 0.5) * env_ad(int(0.35 * SR), 0.001, 0.12) * 0.3, 0.16)
    return out


def parse_bgm_cfg(raw_bgm):
    if raw_bgm in (False, None, 'none'):
        return {'mode': 'none', 'volume': 0.0, 'duck': 0.55, 'loop': True}
    if isinstance(raw_bgm, str):
        mode = raw_bgm if raw_bgm in ('ambient', 'chiptune') else 'file'
        return {'mode': mode, 'src': raw_bgm, 'volume': 0.16 if mode != 'file' else 0.18, 'duck': 0.55, 'loop': True}
    if isinstance(raw_bgm, dict):
        if raw_bgm.get('src'):
            return {'mode': 'file', 'src': raw_bgm['src'], 'volume': float(raw_bgm.get('volume', 0.18)), 'duck': float(raw_bgm.get('duck', 0.55)), 'loop': bool(raw_bgm.get('loop', True))}
        preset = raw_bgm.get('preset', 'ambient')
        if preset in (False, 'none'):
            return {'mode': 'none', 'volume': 0.0, 'duck': 0.55, 'loop': True}
        return {'mode': preset, 'volume': float(raw_bgm.get('volume', 0.16)), 'duck': float(raw_bgm.get('duck', 0.55)), 'loop': True}
    return {'mode': 'ambient', 'volume': 0.16, 'duck': 0.55, 'loop': True}


def parse_sfx_cfg(raw_sfx):
    if raw_sfx in (False, None, 'none'):
        return {'preset': 'none', 'volume': 0.0, 'transition': None, 'impact': None, 'events': []}
    if isinstance(raw_sfx, str):
        return {'preset': raw_sfx, 'volume': 0.28 if raw_sfx == 'chiptune' else 0.18, 'transition': None, 'impact': None, 'events': []}
    if isinstance(raw_sfx, dict):
        preset = raw_sfx.get('preset', 'soft')
        def_vol = 0.0 if preset in (False, 'none') else (0.28 if preset == 'chiptune' else 0.18)
        return {'preset': 'none' if preset is False else preset, 'volume': float(raw_sfx.get('volume', def_vol)), 'transition': raw_sfx.get('transition'), 'impact': raw_sfx.get('impact'), 'events': raw_sfx.get('events', [])}
    return {'preset': 'soft', 'volume': 0.18, 'transition': None, 'impact': None, 'events': []}


def resolve_asset(video_dir, rel_or_abs):
    return rel_or_abs if os.path.isabs(rel_or_abs) else os.path.join(video_dir, rel_or_abs)


def _slice_stem_cue(stem_mono, baked_scenes, si, sc, li, c):
    if stem_mono is None or len(stem_mono) == 0:
        return None
    b_sc = baked_scenes[si] if isinstance(baked_scenes, list) and si < len(baked_scenes) else None
    b_cues = b_sc.get('cues') if isinstance(b_sc, dict) else None
    if isinstance(b_cues, list) and li < len(b_cues) and len(b_cues[li]) >= 2:
        t0 = float(b_sc.get('start', sc['start'])) + float(b_cues[li][0])
        t1 = float(b_sc.get('start', sc['start'])) + float(b_cues[li][1])
    else:
        t0, t1 = float(sc['start']) + float(c['start']), float(sc['start']) + float(c['end'])
    i0, i1 = max(0, int(round(t0 * SR))), min(len(stem_mono), int(round(t1 * SR)))
    if i1 <= i0:
        return None
    seg = stem_mono[i0:i1].copy()
    edge = min(len(seg) // 4, int(0.006 * SR))
    if edge > 1:
        ramp = np.linspace(0.0, 1.0, edge, dtype=np.float32)
        seg[:edge] *= ramp
        seg[-edge:] *= ramp[::-1]
    return seg


def _read_cue_wav(wav_path):
    raw_y, sr = sf.read(wav_path)
    raw_y = raw_y.mean(axis=1) if raw_y.ndim > 1 else raw_y
    g = math.gcd(SR, sr)
    return resample_poly(raw_y, SR // g, sr // g)


def _maybe_load_stem(stem_loaded, stem_mono, fallback_stem_path):
    if stem_loaded:
        return True, stem_mono
    if fallback_stem_path and os.path.exists(fallback_stem_path):
        return True, decode_audio_file(fallback_stem_path, channels=1)
    return True, None


def mix_voice_track(scenes, vdir, n, fallback_stem_path=None, baked_scenes=None):
    voice, active, has_voice = np.zeros(n), np.zeros(n), False
    stem_mask = np.zeros(n, dtype=bool)
    stem_mono, stem_loaded = None, False
    for si, sc in enumerate(scenes):
        for li, c in enumerate(sc.get('cues', [])):
            wav_path = f'{vdir}/{si:02d}_{li:02d}.wav'
            used_stem = not os.path.exists(wav_path)
            if not used_stem:
                y = _read_cue_wav(wav_path)
            else:
                stem_loaded, stem_mono = _maybe_load_stem(stem_loaded, stem_mono, fallback_stem_path)
                y = _slice_stem_cue(stem_mono, baked_scenes, si, sc, li, c)
            if y is None or len(y) == 0:
                continue
            has_voice = True
            at = sc['start'] + c['start']
            place(voice, y, at)
            a, b = max(0, int(at * SR)), min(n, int((at + len(y) / SR) * SR))
            if b > a:
                active[a:b] = 1
                if used_stem:
                    stem_mask[a:b] = True
    return voice, active, has_voice, stem_mask


def build_bgm_track(bgm_cfg, video_dir, dur, n, secs, active, has_voice):
    if bgm_cfg['mode'] == 'none' or bgm_cfg['volume'] <= 0:
        return np.zeros((n, 2), dtype=np.float32)
    if bgm_cfg['mode'] == 'file':
        mus = loop_track(decode_audio_file(resolve_asset(video_dir, bgm_cfg['src']), channels=2), n, loop=bgm_cfg['loop'])
    elif bgm_cfg['mode'] == 'chiptune':
        mus = music_chiptune(dur, secs)
    else:
        mus = music_ambient(dur, secs)

    duck = 1.0 - bgm_cfg['duck'] * np.clip(fftconvolve(active, np.ones(int(0.25 * SR)) / int(0.25 * SR), mode='same'), 0, 1) if (has_voice and bgm_cfg['duck'] > 0) else np.ones(n)
    fade = np.ones(n)
    fi, fo = min(n // 3, int(1.5 * SR)), min(n // 2, int(3.0 * SR))
    if fi > 0:
        fade[:fi] = np.linspace(0, 1, fi)
    if fo > 0:
        fade[-fo:] = np.linspace(1, 0, fo)
    return mus[:n] * (duck * fade)[:, None] * bgm_cfg['volume']


def _load_or_synth_pair(custom_path, video_dir, chip_fn, soft_fn, preset):
    if custom_path:
        return decode_audio_file(resolve_asset(video_dir, custom_path), channels=2)
    sig = chip_fn() if preset == 'chiptune' else soft_fn()
    return np.stack([sig, sig], axis=1)


def mix_sfx_bus(data, sfx_cfg, video_dir, n):
    fx_st = np.zeros((n, 2), dtype=np.float32)
    if sfx_cfg['preset'] != 'none' and sfx_cfg['volume'] > 0:
        tr_sig = _load_or_synth_pair(sfx_cfg['transition'], video_dir, chip_whoosh, soft_whoosh, sfx_cfg['preset'])
        for sc in data['scenes'][1:]:
            place_stereo(fx_st, tr_sig, sc['start'] - 0.35)
        imp_sig = _load_or_synth_pair(sfx_cfg['impact'], video_dir, chip_impact, soft_impact, sfx_cfg['preset'])
        for at in data.get('impacts', []):
            place_stereo(fx_st, imp_sig, float(at))

    custom_events = _collect_custom_sfx_events(data, sfx_cfg)
    _render_custom_sfx_events(fx_st, custom_events, video_dir)
    bus_gain = sfx_cfg['volume'] if sfx_cfg['volume'] > 0 else (0.22 if custom_events and data.get('sfx') is not False else 0.0)
    return fx_st * bus_gain


def _collect_custom_sfx_events(data, sfx_cfg):
    events = list(sfx_cfg.get('events', []))
    for sc in data['scenes']:
        for ev in sc.get('sfx', []):
            if isinstance(ev, dict) and (ev.get('src') or ev.get('type') or ev.get('preset')):
                events.append({
                    'at': sc['start'] + float(ev.get('at', 0)),
                    'src': ev.get('src'),
                    'type': ev.get('type') or ev.get('preset'),
                    'volume': float(ev.get('volume', 0.5)),
                })
    return events


def _render_custom_sfx_events(fx_st, events, video_dir):
    file_cache, builtin_cache = {}, {}
    for ev in events:
        vol, at_sec = float(ev.get('volume', 0.5)), float(ev.get('at', 0))
        src, kind = ev.get('src'), str(ev.get('type') or '').lower()
        if src:
            full = resolve_asset(video_dir, src)
            if full not in file_cache:
                file_cache[full] = decode_audio_file(full, channels=2)
            place_stereo(fx_st, file_cache[full], at_sec, vol)
        elif kind in BUILTIN_ACTION_SFX:
            if kind not in builtin_cache:
                builtin_cache[kind] = BUILTIN_ACTION_SFX[kind]()
            place_stereo(fx_st, builtin_cache[kind], at_sec, vol)


def _fit_clip_samples(sig, max_len, loop):
    if max_len <= 0 or len(sig) == 0:
        return sig
    if loop and len(sig) < max_len:
        reps = (max_len + len(sig) - 1) // len(sig)
        sig = np.tile(sig, (reps, 1)) if sig.ndim > 1 else np.tile(sig, reps)
    return sig[:max_len] if len(sig) > max_len else sig


def mix_video_clip_tracks(data, video_dir, n):
    clips_st = np.zeros((n, 2), dtype=np.float32)
    for vc in data.get('videoClips', []):
        vol = float(vc.get('volume') or 0.0)
        if vol <= 0 or not vc.get('src'):
            continue
        full = resolve_asset(video_dir, vc['src'])
        if not os.path.exists(full):
            continue
        sig = decode_audio_file(full, channels=2, trim_start=float(vc.get('trim') or 0.0), speed=float(vc.get('speed') or 1.0))
        max_len = int(max(0.0, float(vc.get('maxDur') or 0.0)) * SR)
        sig = _fit_clip_samples(sig, max_len, bool(vc.get('loop')))
        place_stereo(clips_st, sig, float(vc.get('at') or 0.0), vol)
    return clips_st


def normalize_audio_bitrate(raw) -> str:
    val = str(raw or '128k').strip().lower()
    if len(val) >= 3 and val.endswith('k') and val[:-1].isdigit():
        return val
    return '128k'


def write_master_output(mix, out, bitrate='128k'):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    if not out.endswith('.m4a'):
        sf.write(out, mix.astype(np.float32), SR)
        return
    tmp_wav = out + '.tmp.wav'
    sf.write(tmp_wav, mix.astype(np.float32), SR)
    subprocess.run([
        FFMPEG, '-y', '-loglevel', 'error', '-i', tmp_wav,
        '-c:a', 'aac', '-b:a', normalize_audio_bitrate(bitrate), '-ac', '2', '-ar', '48000', '-movflags', '+faststart', out,
    ], check=True)
    os.remove(tmp_wav)


def _soft_clip(sig):
    return np.tanh(sig * 1.1) / np.tanh(1.1)


def _compose_foreground_bus(voice, f, vc, stem_mask):
    voice_st = np.stack([voice, voice], 1)
    extras = f + vc
    if stem_mask is not None and stem_mask.any():
        extras = extras.copy()
        extras[stem_mask] = 0.0
    return voice_st + extras


def _clip_preserving_stem(sig, stem_mask):
    if stem_mask is not None and stem_mask.any():
        return np.where(stem_mask[:, None], sig, _soft_clip(sig))
    return _soft_clip(sig)


def _write_dual_stems(fg, m, out, bgm_out, dur, bitrate, bgm_bitrate, stem_mask=None):
    fg_s, m_s = _clip_preserving_stem(fg, stem_mask), _soft_clip(m)
    ref_peak = float(np.abs(fg_s + m_s).max())
    scale = (0.95 / ref_peak) if ref_peak > 1e-6 else 1.0
    write_master_output(fg_s * scale, out, bitrate)
    if float(np.abs(m).max()) > 1e-5:
        write_master_output(m_s * scale, bgm_out, bgm_bitrate or '96k')
        print('written', out, '+', bgm_out, round(dur, 1), 's')
    else:
        if os.path.exists(bgm_out):
            os.remove(bgm_out)
        print('written', out, '(no bgm)', round(dur, 1), 's')


def main():
    cues_path, vdir, out = sys.argv[1:4]
    bgm_out = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
    with open(cues_path, encoding='utf-8') as f:
        data = json.load(f)

    dur = max(0.2, float(data['duration']))
    n = int(dur * SR)
    video_dir = data.get('videoDir') or os.path.dirname(os.path.dirname(os.path.abspath(out)))
    def_e = [0.45, 0.55, 0.62, 0.68, 0.65]
    secs = [dict(s, energy=s.get('energy', def_e[i] if i < len(def_e) else 0.58)) for i, s in enumerate(data['scenes'])]

    voice, active, has_voice, stem_mask = mix_voice_track(
        data['scenes'], vdir, n, fallback_stem_path=out, baked_scenes=data.get('bakedScenes')
    )
    m = build_bgm_track(parse_bgm_cfg(data.get('bgm')), video_dir, dur, n, secs, active, has_voice)
    f = mix_sfx_bus(data, parse_sfx_cfg(data.get('sfx')), video_dir, n)
    vc = mix_video_clip_tracks(data, video_dir, n)
    fg = _compose_foreground_bus(voice, f, vc, stem_mask)

    if bgm_out:
        _write_dual_stems(fg, m, out, bgm_out, dur, data.get('audioBitrate'), data.get('bgmBitrate'), stem_mask=stem_mask)
        return

    bgm_masked = m
    if stem_mask is not None and stem_mask.any():
        bgm_masked = m.copy()
        bgm_masked[stem_mask] = 0.0
    mix = _clip_preserving_stem(bgm_masked + fg, stem_mask)
    peak = np.abs(mix).max()
    if peak > 1e-6:
        mix = mix / peak * 0.95

    write_master_output(mix, out, data.get('audioBitrate'))
    print('written', out, round(dur, 1), 's')


if __name__ == '__main__':
    main()
