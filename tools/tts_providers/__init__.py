"""开放式多模型 TTS 适配器注册表（edge / openai / elevenlabs / azure / http / command + 自定义脚本扩展）。"""
import asyncio, base64, importlib, importlib.util, json, os, re, shlex, subprocess, urllib.error, urllib.parse, urllib.request
from xml.sax.saxutils import escape as xml_escape

DEFAULT_PROVIDER = 'edge'
DEFAULT_VOICE = 'en-US-EmmaMultilingualNeural'


def rate_str(speed: float) -> str:
    pct = round((float(speed) - 1.0) * 100)
    return f'{pct:+d}%'


def _resolve_api_key(cfg: dict, default_env: str, required: bool = True) -> str:
    env_name = cfg.get('apiKeyEnv') or default_env
    key = cfg.get('apiKey') or os.environ.get(env_name) or os.environ.get('TTS_API_KEY') or ''
    if required and not key:
        raise RuntimeError(f"Missing API key for TTS provider '{cfg.get('provider')}'. Set {env_name} or TTS_API_KEY.")
    return key


def _http_request(url: str, method: str = 'POST', headers: dict | None = None, body_bytes: bytes | None = None, timeout: float = 90.0):
    req = urllib.request.Request(url, data=body_bytes, headers=headers or {}, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(), resp.headers.get('Content-Type', '')
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', errors='replace')[:500]
        raise RuntimeError(f'TTS HTTP {e.code} from {url}: {detail}') from e


async def _request_with_retry(url: str, method: str = 'POST', headers: dict | None = None, body_bytes: bytes | None = None, retries: int = 3):
    for attempt in range(retries):
        try:
            return await asyncio.to_thread(_http_request, url, method, headers, body_bytes)
        except Exception:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))


async def _synth_edge_once(text: str, out_path: str, voice: str, rate: str, pitch: str, volume: str):
    import edge_tts

    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume, boundary='WordBoundary')
    words = []
    with open(out_path, 'wb') as f:
        async for ch in comm.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'WordBoundary':
                words.append((ch['offset'] / 1e7, ch['duration'] / 1e7, ch['text']))
    return words


async def synth_edge(text: str, out_path: str, cfg: dict):
    voice = cfg.get('voice') or DEFAULT_VOICE
    rate = rate_str(cfg.get('speed', 1.15))
    pitch = cfg.get('pitch', '+0Hz')
    volume = cfg.get('volume', '+0%')
    for attempt in range(4):
        try:
            return await _synth_edge_once(text, out_path, voice, rate, pitch, volume)
        except Exception:
            if attempt == 3:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))


def _resolve_openai_base_url(cfg: dict) -> str:
    env_key = cfg.get('baseUrlEnv') or 'TTS_BASE_URL'
    raw = cfg.get('baseUrl') or os.environ.get(env_key) or os.environ.get('OPENAI_BASE_URL') or 'https://api.openai.com/v1'
    return raw.rstrip('/')


def _build_openai_payload(text: str, cfg: dict) -> dict:
    payload = {
        'model': cfg.get('model') or 'gpt-4o-mini-tts',
        'input': text,
        'voice': cfg.get('voice') or 'alloy',
        'response_format': cfg.get('format') or 'mp3',
        'speed': float(cfg.get('speed', 1.0)),
    }
    if cfg.get('instructions'):
        payload['instructions'] = cfg['instructions']
    if isinstance(cfg.get('extraBody'), dict):
        payload.update(cfg['extraBody'])
    return payload


async def synth_openai(text: str, out_path: str, cfg: dict):
    base_url = _resolve_openai_base_url(cfg)
    is_local = any(h in base_url for h in ('localhost', '127.0.0.1', '0.0.0.0'))
    api_key = _resolve_api_key(cfg, 'OPENAI_API_KEY', required=not is_local)
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    if isinstance(cfg.get('headers'), dict):
        headers.update(cfg['headers'])
    body_bytes = json.dumps(_build_openai_payload(text, cfg), ensure_ascii=False).encode('utf-8')
    audio_bytes, _ = await _request_with_retry(f'{base_url}/audio/speech', method='POST', headers=headers, body_bytes=body_bytes)
    with open(out_path, 'wb') as f:
        f.write(audio_bytes)
    return []


def _alignment_to_words(alignment: dict | None):
    if not isinstance(alignment, dict):
        return []
    chars = alignment.get('characters') or []
    starts = alignment.get('character_start_times_seconds') or []
    ends = alignment.get('character_end_times_seconds') or []
    n = min(len(chars), len(starts), len(ends))
    words, buf, b_start, b_end = [], '', 0.0, 0.0

    def flush():
        nonlocal buf
        if buf:
            words.append((round(b_start, 4), round(max(0.01, b_end - b_start), 4), buf))
            buf = ''

    for i in range(n):
        ch, t0, t1 = str(chars[i]), float(starts[i]), float(ends[i])
        if re.match(r'[A-Za-z0-9]', ch):
            b_start = t0 if not buf else b_start
            buf, b_end = buf + ch, t1
        elif re.match(r'[\u4e00-\u9fa5]', ch):
            flush()
            words.append((round(t0, 4), round(max(0.01, t1 - t0), 4), ch))
        else:
            flush()
    flush()
    return words


async def synth_elevenlabs(text: str, out_path: str, cfg: dict):
    base_url = (cfg.get('baseUrl') or 'https://api.elevenlabs.io/v1').rstrip('/')
    api_key = _resolve_api_key(cfg, 'ELEVENLABS_API_KEY', required=True)
    voice_id = cfg.get('voice') or 'JBFqnCBsd6RMkjVDRZzb'
    payload = {'text': text, 'model_id': cfg.get('model') or 'eleven_multilingual_v2'}
    voice_settings = dict(cfg.get('voiceSettings') or {})
    if 'speed' in cfg and 'speed' not in voice_settings:
        voice_settings['speed'] = float(cfg['speed'])
    if voice_settings:
        payload['voice_settings'] = voice_settings
    headers = {'Content-Type': 'application/json', 'xi-api-key': api_key}
    url = f'{base_url}/text-to-speech/{urllib.parse.quote(voice_id)}/with-timestamps'
    raw_bytes, _ = await _request_with_retry(url, method='POST', headers=headers, body_bytes=json.dumps(payload, ensure_ascii=False).encode('utf-8'))
    resp = json.loads(raw_bytes.decode('utf-8'))
    with open(out_path, 'wb') as f:
        f.write(base64.b64decode(resp['audio_base64']))
    return _alignment_to_words(resp.get('alignment') or resp.get('normalized_alignment'))


async def synth_azure(text: str, out_path: str, cfg: dict):
    region = cfg.get('region') or os.environ.get('AZURE_SPEECH_REGION') or 'eastus'
    endpoint = cfg.get('endpoint') or f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1'
    api_key = _resolve_api_key(cfg, 'AZURE_SPEECH_KEY', required=True)
    voice = cfg.get('voice') or DEFAULT_VOICE
    inner = f'<prosody rate="{rate_str(cfg.get("speed", 1.15))}" pitch="{cfg.get("pitch", "+0Hz")}">{xml_escape(text)}</prosody>'
    if cfg.get('style'):
        inner = f'<mstts:express-as style="{xml_escape(str(cfg["style"]))}">{inner}</mstts:express-as>'
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="{xml_escape(voice)}">{inner}</voice></speak>'
    )
    headers = {
        'Ocp-Apim-Subscription-Key': api_key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': cfg.get('outputFormat') or 'riff-24khz-16bit-mono-pcm',
        'User-Agent': 'html-video-base',
    }
    audio_bytes, _ = await _request_with_retry(endpoint, method='POST', headers=headers, body_bytes=ssml.encode('utf-8'))
    with open(out_path, 'wb') as f:
        f.write(audio_bytes)
    return []


def _subst(template, mapping: dict):
    if isinstance(template, str):
        out = template
        for k, val in mapping.items():
            out = out.replace(f'{{{{{k}}}}}', str(val))
        return out
    if isinstance(template, list):
        return [_subst(x, mapping) for x in template]
    if isinstance(template, dict):
        return {k: _subst(val, mapping) for k, val in template.items()}
    return template


def _decode_http_json_response(resp_bytes: bytes, out_path: str):
    data = json.loads(resp_bytes.decode('utf-8'))
    b64 = data.get('audio_base64') or data.get('audio')
    if not b64:
        raise RuntimeError("HTTP TTS JSON response missing 'audio_base64' or 'audio' field")
    with open(out_path, 'wb') as f:
        f.write(base64.b64decode(b64))
    raw_words = data.get('words') or []
    return [(float(w[0]), float(w[1]) if len(w) > 2 else 0.1, str(w[-1])) for w in raw_words]


def _prepare_http_req(text: str, cfg: dict):
    raw_url = cfg.get('url') or cfg.get('baseUrl')
    if not raw_url:
        raise RuntimeError("TTS provider 'http' requires 'tts.url' in video.config.js")
    mapping = {'text': text, 'rawText': cfg.get('_rawText', text), 'voice': cfg.get('voice', ''), 'speed': cfg.get('speed', 1.0), 'model': cfg.get('model', '')}
    method = (cfg.get('method') or 'POST').upper()
    url_map = {k: urllib.parse.quote(str(val)) if method == 'GET' else val for k, val in mapping.items()}
    url = _subst(raw_url, url_map)
    headers = dict(cfg.get('headers') or {})
    api_key = _resolve_api_key(cfg, 'TTS_API_KEY', required=False)
    if api_key and 'Authorization' not in headers:
        headers['Authorization'] = f'Bearer {api_key}'
    if method == 'GET':
        return url, method, headers, None
    body_tpl = cfg.get('body') or {'text': '{{text}}', 'voice': '{{voice}}', 'speed': '{{speed}}'}
    headers.setdefault('Content-Type', 'application/json')
    return url, method, headers, json.dumps(_subst(body_tpl, mapping), ensure_ascii=False).encode('utf-8')


async def synth_http(text: str, out_path: str, cfg: dict):
    url, method, headers, body_bytes = _prepare_http_req(text, cfg)
    resp_bytes, ctype = await _request_with_retry(url, method=method, headers=headers, body_bytes=body_bytes)
    if 'application/json' in ctype.lower():
        return _decode_http_json_response(resp_bytes, out_path)
    with open(out_path, 'wb') as f:
        f.write(resp_bytes)
    return []


def _subst_cmd_tokens(tpl: str, fmt_vars: dict, quote_val: bool = False) -> str:
    def _rep(m):
        val = str(fmt_vars.get(m.group(1), ''))
        if not quote_val:
            return val
        return subprocess.list2cmdline([val]) if os.name == 'nt' else shlex.quote(val)

    return re.sub(r'\{(text|raw_text|out|voice|speed)\}', _rep, str(tpl))


def _split_cmd_template(cmd_tpl: str):
    parts = shlex.split(cmd_tpl, posix=(os.name != 'nt'))
    cleaned = []
    for p in parts:
        if os.name == 'nt' and len(p) >= 2 and p[0] == p[-1] and p[0] in ('"', "'"):
            p = p[1:-1]
        cleaned.append(p)
    return cleaned


def _build_command_invocation(cmd_tpl, fmt_vars: dict):
    if isinstance(cmd_tpl, list):
        return [_subst_cmd_tokens(str(x), fmt_vars, quote_val=False) for x in cmd_tpl], False
    raw = str(cmd_tpl)
    if not re.search(r'[|&;<>()`$\n]', raw):
        try:
            parts = _split_cmd_template(raw)
            if parts:
                return [_subst_cmd_tokens(p, fmt_vars, quote_val=False) for p in parts], False
        except ValueError:
            pass
    return _subst_cmd_tokens(raw, fmt_vars, quote_val=True), True


async def synth_command(text: str, out_path: str, cfg: dict):
    cmd_tpl = cfg.get('command')
    if not cmd_tpl:
        raise RuntimeError("TTS provider 'command' requires 'tts.command' in video.config.js")
    fmt_vars = {'text': text, 'raw_text': cfg.get('_rawText', text), 'out': out_path, 'voice': cfg.get('voice', ''), 'speed': cfg.get('speed', 1.0)}
    cmd_args, use_shell = _build_command_invocation(cmd_tpl, fmt_vars)

    def _run():
        subprocess.run(cmd_args, shell=use_shell, check=True)

    await asyncio.to_thread(_run)
    return []


BUILTIN_PROVIDERS = {
    'edge': synth_edge,
    'openai': synth_openai,
    'elevenlabs': synth_elevenlabs,
    'azure': synth_azure,
    'http': synth_http,
    'command': synth_command,
}


def resolve_provider(cfg: dict, video_dir: str | None = None):
    script_rel = cfg.get('script')
    if script_rel:
        script_path = script_rel if os.path.isabs(script_rel) else os.path.join(video_dir or os.getcwd(), script_rel)
        if not os.path.exists(script_path):
            raise FileNotFoundError(f'Custom TTS provider script not found: {script_path}')
        spec = importlib.util.spec_from_file_location('custom_tts_provider', script_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.synthesize

    name = str(cfg.get('provider') or DEFAULT_PROVIDER).lower().strip()
    if name in BUILTIN_PROVIDERS:
        return BUILTIN_PROVIDERS[name]
    try:
        return importlib.import_module(f'tts_providers.{name}').synthesize
    except ModuleNotFoundError as e:
        known = ', '.join(sorted(BUILTIN_PROVIDERS.keys()))
        raise ValueError(f"Unknown TTS provider '{name}'. Built-in: [{known}].") from e
