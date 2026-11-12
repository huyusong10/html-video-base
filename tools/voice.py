"""多模型 TTS 配音合成、声学词边界对齐与 30Hz 真实语音振幅包络提取管线。"""
import asyncio, hashlib, json, os, re, shutil, subprocess, sys
import imageio_ffmpeg, numpy as np, soundfile as sf

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

from tts_providers import DEFAULT_PROVIDER, DEFAULT_VOICE, resolve_provider

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
PROJECT_ROOT = os.path.abspath(os.environ.get('VIDEO_PROJECT_ROOT') or os.getcwd())
CACHE_DIR = os.path.join(PROJECT_ROOT, '.runtime', 'voice-cache')

COMMON_FIX = [
    (r'重编排', '崇编排'), (r'重算', '崇算'), (r'重放', '崇放'), (r'重写', '崇写'), (r'重构', '崇构'),
    (r'执行', '直形'), (r'运行', '运形'), (r'并行', '并形'), (r'例行', '例形'), (r'先行', '先形'),
    (r'进行', '进形'), (r'自行', '自形'), (r'推行', '推形'), (r'实行', '实形'), (r'放行', '放形'),
    (r'命令行', '命令航'), (r'一行行', '一航航'), (r'“|”|‘|’|《|》', ''),
]
TOKEN_RE = re.compile(r'[A-Za-z0-9]+|[\u4e00-\u9fa5]')
PAUSE_CHARS = set('，。；：！？——,.;:!?、')
_WHISPER_MODEL = None


def build_rules(pron_dict, enable_common=True):
    rules = [(pat, str(rep)) for pat, rep in pron_dict.items()] if isinstance(pron_dict, dict) else []
    if enable_common:
        rules.extend(COMMON_FIX)
    return rules


def speakable(s, rules):
    for a, b in rules:
        s = re.sub(a, b, s)
    return s


def trim(y, thr=0.005, pad=0.05):
    idx = np.where(np.abs(y) > thr)[0]
    if not len(idx):
        return y, 0.0
    a = max(0, idx[0] - int(pad * 24000))
    b = min(len(y), idx[-1] + int(pad * 24000))
    return y[a:b], a / 24000.0


def extract_envelope_30hz(y: np.ndarray, sr: int = 24000) -> list[int]:
    """按 30Hz（每帧约 33.3ms）提取归一化语音振幅包络（0..100 紧凑整数数组），驱动数字人真口型。"""
    if len(y) == 0:
        return [0]
    hop = max(1, sr // 30)
    n_frames = max(1, int(np.ceil(len(y) / hop)))
    pad_len = n_frames * hop - len(y)
    y_pad = np.pad(y, (0, pad_len)) if pad_len > 0 else y
    rms = np.sqrt(np.mean(y_pad.reshape(n_frames, hop) ** 2, axis=1) + 1e-12)
    if n_frames >= 3:
        rms = np.convolve(rms, np.array([0.25, 0.5, 0.25]), mode='same')
    ref = float(np.percentile(rms, 95)) if len(rms) else 0.0
    if ref < 1e-5:
        return [0] * n_frames
    norm = np.where(rms < ref * 0.08, 0.0, np.clip(rms / ref, 0.0, 1.0) ** 0.75)
    return [int(round(float(v) * 100)) for v in norm]


def merge_en_spans(words):
    spans = []
    for t0, dur, w in words:
        if not re.search(r'[A-Za-z]{2,}', w):
            continue
        t1 = t0 + dur
        if spans and t0 - spans[-1][1] < 0.22:
            spans[-1][1] = t1
        else:
            spans.append([t0, t1])
    return spans


def stretch_span(seg, tmp_base, ratio=0.78):
    if ratio >= 0.99 or len(seg) < int(0.08 * 24000):
        return seg
    s_in, s_out = tmp_base + '.sin.wav', tmp_base + '.sout.wav'
    sf.write(s_in, seg, 24000)
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', s_in, '-af', f'atempo={ratio}', s_out], check=True)
    y_st, _ = sf.read(s_out, dtype='float32')
    os.remove(s_in)
    os.remove(s_out)
    return y_st


def _remap_word_time(t0: float, shifts: list) -> float:
    t_new = t0
    for a0, a1, sh, scale in shifts:
        if t0 < a0:
            break
        if t0 <= a1:
            return a0 + sh + (t0 - a0) * scale
        t_new = t0 + sh + (a1 - a0) * (scale - 1.0)
    return t_new


def apply_en_slowdown(y, words, tmp_base, ratio=0.78):
    if ratio >= 0.99 or not words:
        return y, [(round(t0, 3), w) for t0, _, w in words]
    spans = merge_en_spans(words)
    if not spans:
        return y, [(round(t0, 3), w) for t0, _, w in words]
    pieces, shifts, cur, cum_shift = [], [], 0, 0.0
    for s0, s1 in spans:
        i0, i1 = max(cur, int(s0 * 24000)), min(len(y), int((s1 + 0.03) * 24000))
        if i0 > cur:
            pieces.append(y[cur:i0])
        st = stretch_span(y[i0:i1], tmp_base, ratio)
        pieces.append(st)
        orig_d, new_d = (i1 - i0) / 24000.0, len(st) / 24000.0
        shifts.append((i0 / 24000.0, i1 / 24000.0, cum_shift, new_d / max(orig_d, 1e-6)))
        cum_shift += new_d - orig_d
        cur = i1
    if cur < len(y):
        pieces.append(y[cur:])
    adj_words = [(round(_remap_word_time(t0, shifts), 3), w) for t0, _, w in words]
    return np.concatenate(pieces), adj_words


def _collect_whisper_char_times(segments):
    w_times = []
    for seg in segments:
        for w in (seg.words or []):
            clean = ''.join(TOKEN_RE.findall(w.word))
            for idx in range(len(clean)):
                w_times.append(w.start + (w.end - w.start) * (idx / max(1, len(clean))))
    return w_times


def _try_whisper_align(wav_path: str, tokens: list[str], dur: float, cfg: dict):
    global _WHISPER_MODEL
    try:
        from faster_whisper import WhisperModel
        if _WHISPER_MODEL is None:
            _WHISPER_MODEL = WhisperModel(cfg.get('whisperModel') or 'tiny', device='cpu', compute_type='int8')
        segments, _ = _WHISPER_MODEL.transcribe(wav_path, word_timestamps=True)
        w_times = _collect_whisper_char_times(segments)
        if not w_times:
            return None
        out, char_cursor = [], 0
        total_chars = max(1, sum(len(t) for t in tokens))
        for tok in tokens:
            mapped_idx = min(len(w_times) - 1, int(round(char_cursor / total_chars * len(w_times))))
            out.append((round(float(np.clip(w_times[mapped_idx], 0.0, max(0.0, dur - 0.02))), 3), tok))
            char_cursor += len(tok)
        return out
    except Exception:
        return None


def _tokenize_spoken_with_pauses(spoken: str):
    tokens, token_weights, pending_pause, pos = [], [], 0.0, 0
    for m in TOKEN_RE.finditer(spoken):
        if any(ch in PAUSE_CHARS for ch in spoken[pos:m.start()]):
            pending_pause = 0.45
        tok = m.group(0)
        tokens.append(tok)
        token_weights.append((pending_pause, 1.45 if re.match(r'^[A-Za-z0-9]+$', tok) else 1.0))
        pending_pause, pos = 0.0, m.end()
    return tokens, token_weights


def _compute_energy_cdf(y: np.ndarray, sr: int):
    hop = max(1, int(sr * 0.01))
    n_frames = max(1, int(np.ceil(len(y) / hop)))
    pad_len = n_frames * hop - len(y)
    y_pad = np.pad(y, (0, pad_len)) if pad_len > 0 else y
    rms = np.sqrt(np.mean(y_pad.reshape(n_frames, hop) ** 2, axis=1) + 1e-12)
    if n_frames >= 3:
        rms = np.convolve(rms, np.ones(3) / 3.0, mode='same')
    peak = float(np.max(rms)) if len(rms) else 0.0
    if peak < 1e-5:
        return None, hop
    thr = max(peak * 0.08, float(np.percentile(rms, 15)) * 1.4)
    voiced = np.where(rms >= thr, np.power(rms / peak, 0.45), 0.015)
    return np.cumsum(voiced), hop


def align_words_acoustic(y: np.ndarray, sr: int, spoken: str, wav_path: str, cfg: dict) -> list[tuple[float, str]]:
    align_mode = cfg.get('align', 'acoustic')
    dur = len(y) / max(1, sr)
    if align_mode in (False, 'none') or dur <= 0.05:
        return []
    tokens, token_weights = _tokenize_spoken_with_pauses(spoken)
    if not tokens:
        return []
    if align_mode == 'whisper':
        w_aligned = _try_whisper_align(wav_path, tokens, dur, cfg)
        if w_aligned:
            return w_aligned

    cdf, hop = _compute_energy_cdf(y, sr)
    if cdf is None:
        return [(round(i / len(tokens) * dur * 0.9, 3), tok) for i, tok in enumerate(tokens)]

    cum_units, cur_u = [], 0.0
    for pause_u, tok_u in token_weights:
        cur_u += pause_u
        cum_units.append(cur_u)
        cur_u += tok_u
    total_u, total_energy = max(1e-6, cur_u), float(cdf[-1])

    aligned, last_t, max_start = [], 0.0, max(0.0, dur - 0.04)
    for idx, tok in enumerate(tokens):
        f_idx = int(np.searchsorted(cdf, (cum_units[idx] / total_u) * total_energy, side='left'))
        t0 = max(last_t, min(max_start, (f_idx * hop) / sr))
        last_t = t0
        aligned.append((round(float(t0), 3), tok))
    return aligned


def post_process_audio(src_audio, raw_wav, out_wav, words, en_ratio, spoken, cfg):
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', src_audio, '-ar', '24000', '-ac', '1', raw_wav], check=True)
    y, _ = sf.read(raw_wav, dtype='float32')
    for tmp in (src_audio, raw_wav):
        if os.path.exists(tmp):
            os.remove(tmp)
    y, adj_words = apply_en_slowdown(y, words, out_wav, en_ratio)
    y, trim_s = trim(y)
    if adj_words:
        adj_words = [(round(max(0.0, t - trim_s), 3), w) for t, w in adj_words]
    sf.write(out_wav, y, 24000)
    if not adj_words:
        adj_words = align_words_acoustic(y, 24000, spoken, out_wav, cfg)
    env_30hz = extract_envelope_30hz(y, 24000)
    return round(len(y) / 24000, 3), adj_words, env_30hz


def compute_en_ratio(cfg: dict) -> float:
    if cfg.get('enSlowdown') is not None:
        return float(cfg['enSlowdown'])
    provider = str(cfg.get('provider') or DEFAULT_PROVIDER).lower()
    voice = str(cfg.get('voice') or '')
    return 0.78 if provider == 'edge' and voice.startswith('en-') else 1.0


def make_cache_key(cfg: dict, spoken: str, en_ratio: float) -> str:
    provider = str(cfg.get('provider') or DEFAULT_PROVIDER).lower()
    voice = str(cfg.get('voice') or '')
    speed = float(cfg.get('speed', 1.15))
    pitch = str(cfg.get('pitch', '+0Hz'))
    align = str(cfg.get('align', 'acoustic'))
    if provider == 'edge' and not cfg.get('script') and align == 'acoustic':
        raw = f'{voice}|{speed}|{pitch}|{en_ratio}|{spoken}'
    else:
        raw = json.dumps({
            'provider': provider, 'script': cfg.get('script'), 'model': cfg.get('model'),
            'voice': voice, 'speed': speed, 'pitch': cfg.get('pitch'), 'en_ratio': en_ratio,
            'align': align, 'baseUrl': cfg.get('baseUrl') or cfg.get('url'),
            'instructions': cfg.get('instructions'), 'style': cfg.get('style'),
            'extraBody': cfg.get('extraBody'), 'spoken': spoken,
        }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]


def normalize_line_item(item, base_cfg: dict):
    if not isinstance(item, dict):
        return str(item), base_cfg
    line_cfg = dict(base_cfg)
    for k in ('provider', 'voice', 'speed', 'pitch', 'model', 'style', 'instructions', 'enSlowdown', 'align'):
        if item.get(k) is not None:
            line_cfg[k] = item[k]
    if item.get('provider'):
        line_cfg['provider'] = str(item['provider']).lower()
    return str(item.get('text') or ''), line_cfg


def _try_load_cached_voice(c_wav: str, c_meta: str, out_wav: str):
    if not (os.path.exists(c_wav) and os.path.exists(c_meta)):
        return None
    try:
        with open(c_meta, encoding='utf-8') as mf:
            cached = json.load(mf)
        shutil.copyfile(c_wav, out_wav)
        env = cached.get('env')
        if not isinstance(env, list):
            y_c, sr_c = sf.read(c_wav, dtype='float32')
            env = extract_envelope_30hz(y_c, sr_c)
        return float(cached['dur']), [tuple(x) for x in cached['words']], env
    except Exception:
        return None


def _resolve_media_ext(cfg: dict) -> str:
    if cfg.get('format'):
        return str(cfg['format']).lstrip('.')
    if cfg.get('provider') in ('edge', 'openai', 'elevenlabs') and not cfg.get('script'):
        return 'mp3'
    return 'wav'


async def synth_one(text, synth_fn, cfg, en_ratio, rules, out_wav):
    os.makedirs(CACHE_DIR, exist_ok=True)
    spoken = speakable(text, rules)
    digest = make_cache_key(cfg, spoken, en_ratio)
    c_wav, c_meta = os.path.join(CACHE_DIR, f'{digest}.wav'), os.path.join(CACHE_DIR, f'{digest}.json')
    hit = _try_load_cached_voice(c_wav, c_meta, out_wav)
    if hit is not None:
        return hit

    src_media = f'{out_wav}.src.{_resolve_media_ext(cfg)}'
    raw_wav = out_wav + '.raw.wav'
    raw_res = await synth_fn(spoken, src_media, dict(cfg, _rawText=text))
    if isinstance(raw_res, dict):
        raw_res = raw_res.get('words') or []
    words = [(float(x[0]), float(x[1]) if len(x) > 2 else 0.1, str(x[-1])) for x in (raw_res or [])]
    dur, adj_words, env_30hz = await asyncio.to_thread(post_process_audio, src_media, raw_wav, out_wav, words, en_ratio, spoken, cfg)
    try:
        shutil.copyfile(out_wav, c_wav)
        with open(c_meta, 'w', encoding='utf-8') as mf:
            json.dump({'dur': dur, 'words': adj_words, 'env': env_30hz, 'text': text}, mf, ensure_ascii=False)
    except Exception:
        pass
    return dur, adj_words, env_30hz


async def synth_all(scenes, out_dir, base_cfg, rules, video_dir=None):
    os.makedirs(out_dir, exist_ok=True)
    sem = asyncio.Semaphore(max(1, int(base_cfg.get('concurrency') or 6)))
    durs = [[0.0] * len(lines) for lines in scenes]
    all_words = [[[] for _ in lines] for lines in scenes]
    all_envs = [[[] for _ in lines] for lines in scenes]
    provider_cache = {}

    def get_fn(cfg):
        key = (str(cfg.get('provider') or DEFAULT_PROVIDER).lower(), cfg.get('script') or '')
        if key not in provider_cache:
            provider_cache[key] = resolve_provider(cfg, video_dir=video_dir)
        return provider_cache[key]

    async def worker(si, li, raw_item):
        text, line_cfg = normalize_line_item(raw_item, base_cfg)
        synth_fn = get_fn(line_cfg)
        async with sem:
            wav = f'{out_dir}/{si:02d}_{li:02d}.wav'
            dur, wlist, env = await synth_one(text, synth_fn, line_cfg, compute_en_ratio(line_cfg), rules, wav)
            durs[si][li], all_words[si][li], all_envs[si][li] = dur, wlist, env
            vtag = f" [{line_cfg.get('voice')}]" if line_cfg.get('voice') != base_cfg.get('voice') else ''
            print(f'  S{si:02d}L{li:02d} ({dur:5.2f}s){vtag} {text[:36]}', flush=True)

    tasks = [worker(si, li, item) for si, lines in enumerate(scenes) for li, item in enumerate(lines)]
    if tasks:
        await asyncio.gather(*tasks)
    with open(f'{out_dir}/words.json', 'w', encoding='utf-8') as wf:
        json.dump(all_words, wf, ensure_ascii=False, indent=2)
    return durs, all_words, all_envs


def _parse_cli_tts_config(raw_payload, argv):
    if isinstance(raw_payload, dict):
        scenes = raw_payload.get('scenes', [])
        tts_cfg = dict(raw_payload.get('tts') or {})
        audio_src = raw_payload.get('audioSrc', 'assets/soundtrack.m4a')
        bgm_src = raw_payload.get('bgmSrc', False)
        video_dir = raw_payload.get('videoDir')
    else:
        scenes, tts_cfg, audio_src, bgm_src, video_dir = raw_payload, {}, 'assets/soundtrack.m4a', False, None

    if len(argv) > 4 and argv[4]:
        tts_cfg['voice'] = argv[4]
    if len(argv) > 5 and argv[5]:
        tts_cfg['speed'] = float(argv[5])
    if len(argv) > 6 and argv[6]:
        tts_cfg['provider'] = argv[6]
    return scenes, tts_cfg, audio_src, bgm_src, video_dir


def _finalize_tts_defaults(tts_cfg: dict) -> str:
    provider = str(tts_cfg.get('provider') or DEFAULT_PROVIDER).lower()
    tts_cfg['provider'] = provider
    if not tts_cfg.get('voice'):
        tts_cfg['voice'] = DEFAULT_VOICE if provider in ('edge', 'azure') else None
    is_en_ms = provider in ('edge', 'azure') and str(tts_cfg.get('voice') or '').startswith('en-')
    tts_cfg['speed'] = float(tts_cfg.get('speed', 1.15 if is_en_ms else 1.0))
    return provider


def main():
    lines_path, out_dir, timings_path = sys.argv[1:4]
    with open(lines_path, encoding='utf-8') as f:
        scenes, tts_cfg, audio_src, bgm_src, video_dir = _parse_cli_tts_config(json.load(f), sys.argv)
    provider = _finalize_tts_defaults(tts_cfg)
    rules = build_rules(tts_cfg.get('pronunciation', {}), enable_common=bool(tts_cfg.get('polyphoneFix', True)))

    if not tts_cfg.get('enabled', True) or sum(len(s) for s in scenes) == 0:
        os.makedirs(out_dir, exist_ok=True)
        durs, all_words, all_envs, voice_label = [[] for _ in scenes], [[] for _ in scenes], [[] for _ in scenes], 'none'
        print('  No spoken lines (or TTS disabled); skipping speech synthesis.')
    else:
        prov_label = f"script:{os.path.basename(tts_cfg['script'])}" if tts_cfg.get('script') else provider
        voice_tag = tts_cfg.get('voice') or tts_cfg.get('model') or 'default'
        print(f"  TTS Provider: {prov_label} ({voice_tag}, speed={tts_cfg['speed']})")
        durs, all_words, all_envs = asyncio.run(synth_all(scenes, out_dir, tts_cfg, rules, video_dir=video_dir))
        voice_label = f"{prov_label} / {voice_tag}"

    os.makedirs(os.path.dirname(timings_path), exist_ok=True)
    with open(timings_path, 'w', encoding='utf-8') as f:
        f.write('/* 配音时长（秒）、逐词时间轴与 30Hz 语音包络，由构建管线生成。 */\n')
        f.write('window.V = window.V || {};\n')
        meta = {'src': audio_src, 'voice': voice_label, 'durations': durs, 'words': all_words, 'envelopes': all_envs}
        if bgm_src:
            meta['bgmSrc'] = bgm_src
        f.write('V.voice = ' + json.dumps(meta, ensure_ascii=False) + ';\n')
    print('total voice', round(sum(map(sum, durs)), 1), 's')


if __name__ == '__main__':
    main()
