// 工具链公共模块：包目录与业务项目目录解耦解析、Python/FFmpeg/Playwright 探测与无头 VM 沙箱
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PKG_ROOT = path.resolve(TOOLS_DIR, '..');
export const RUNTIME_BASE_DIR = path.join(PKG_ROOT, 'runtime/base');
export const TEMPLATES_DIR = path.join(PKG_ROOT, 'templates');

export function getProjectRoot() {
  return path.resolve(process.env.VIDEO_PROJECT_ROOT || process.cwd());
}

export const ROOT = getProjectRoot();
export const VIDEOS_DIR = path.join(ROOT, 'videos');

const RESERVED_DIRS = new Set(['base', 'themes', 'templates', 'assets', 'vendor']);

export function resolveBaseFile(relFromBase, videosDir = VIDEOS_DIR) {
  const localOverride = path.join(videosDir, 'base', relFromBase);
  if (fs.existsSync(localOverride)) return localOverride;
  return path.join(RUNTIME_BASE_DIR, relFromBase);
}

export function listVideoIds(videosDir = VIDEOS_DIR) {
  if (!fs.existsSync(videosDir)) return [];
  return fs.readdirSync(videosDir).filter(name => {
    if (RESERVED_DIRS.has(name) || name.startsWith('.')) return false;
    const dir = path.join(videosDir, name);
    if (!fs.statSync(dir).isDirectory()) return false;
    return fs.existsSync(path.join(dir, 'index.html')) || fs.existsSync(path.join(dir, 'video.config.js'));
  });
}

function readRuntimeHint(root, filename) {
  const p = path.join(root, '.runtime', filename);
  if (!fs.existsSync(p)) return null;
  const val = fs.readFileSync(p, 'utf8').trim();
  return val && fs.existsSync(val) ? val : null;
}

function pythonCandidates(root) {
  const parent = path.resolve(root, '..');
  return [
    process.env.PYTHON_BIN,
    readRuntimeHint(root, 'python-path.txt'),
    readRuntimeHint(parent, 'python-path.txt'),
    readRuntimeHint(PKG_ROOT, 'python-path.txt'),
    path.join(root, '.runtime/venv/Scripts/python.exe'),
    path.join(root, '.runtime/venv/bin/python'),
    path.join(parent, '.runtime/venv/Scripts/python.exe'),
    path.join(parent, '.runtime/venv/bin/python'),
    path.join(root, '.venv/Scripts/python.exe'),
    path.join(root, '.venv/bin/python'),
    path.join(PKG_ROOT, '.runtime/venv/Scripts/python.exe'),
    path.join(PKG_ROOT, '.runtime/venv/bin/python'),
    'python',
    'python3',
  ].filter(Boolean);
}

function isUsablePython(py, checkCode) {
  if (py !== 'python' && py !== 'python3' && !fs.existsSync(py)) return false;
  return spawnSync(py, ['-c', checkCode], { encoding: 'utf8' }).status === 0;
}

export function resolvePython(root = ROOT, requireAudioDeps = false) {
  const checkCode = requireAudioDeps
    ? 'import edge_tts, numpy, scipy, soundfile, imageio_ffmpeg; print("ok")'
    : 'import sys; print(sys.executable)';
  for (const py of pythonCandidates(root)) {
    if (isUsablePython(py, checkCode)) return py;
  }
  throw new Error(
    'Python environment (with edge-tts, numpy, scipy, soundfile, imageio-ffmpeg) not found.\n' +
    `Run: python -m venv .runtime/venv && .runtime/venv/Scripts/pip install -r "${path.join(PKG_ROOT, 'requirements.txt')}"`
  );
}

export function resolveFfmpeg(root = ROOT) {
  if (process.env.FFMPEG_BIN && fs.existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN;
  if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0) return 'ffmpeg';
  for (const py of pythonCandidates(root)) {
    if (py !== 'python' && py !== 'python3' && !fs.existsSync(py)) continue;
    const r = spawnSync(py, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('FFmpeg not found. Install ffmpeg or python package imageio-ffmpeg.');
}

function playwrightHintCandidates(root) {
  const parent = path.resolve(root, '..');
  return [
    process.env.PLAYWRIGHT_CORE_PATH,
    readRuntimeHint(root, 'playwright-path.txt'),
    readRuntimeHint(parent, 'playwright-path.txt'),
    readRuntimeHint(PKG_ROOT, 'playwright-path.txt'),
    path.join(root, 'node_modules/playwright-core/index.mjs'),
    path.join(parent, 'node_modules/playwright-core/index.mjs'),
    path.join(PKG_ROOT, 'node_modules/playwright-core/index.mjs'),
  ].filter(Boolean);
}

export async function loadChromium(root = ROOT) {
  try {
    const pw = await import('playwright-core');
    return pw.chromium;
  } catch {
    for (const hint of playwrightHintCandidates(root)) {
      if (fs.existsSync(hint)) return (await import(pathToFileURL(hint).href)).chromium;
    }
    throw new Error('playwright-core not found. Run "npm install" in workspace root.');
  }
}

export function findBrowserExecutable() {
  const cands = [
    process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return p;
  throw new Error('Chrome/Edge executable not found. Set CHROME_BIN environment variable.');
}

function createMockStyle() {
  return new Proxy({ cssText: '' }, {
    get(target, prop) {
      if (prop === 'setProperty') return (k, v) => { target[k] = v; };
      if (prop === 'removeProperty') return k => { delete target[k]; };
      return prop in target ? target[prop] : '';
    },
    set(target, prop, val) { target[prop] = val; return true; },
  });
}

function createMockClassList(classes) {
  return {
    add: (...cs) => cs.forEach(c => c && classes.add(c)),
    remove: (...cs) => cs.forEach(c => classes.delete(c)),
    toggle: (c, force) => {
      const on = force === undefined ? !classes.has(c) : Boolean(force);
      if (on) classes.add(c); else classes.delete(c);
      return on;
    },
    contains: c => classes.has(c),
  };
}

export function createMockElement(tag = 'div') {
  const attrs = new Map(), classes = new Set(), children = [];
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    isConnected: true,
    style: createMockStyle(),
    classList: createMockClassList(classes),
    setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'class') this.className = String(v); },
    getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: k => attrs.delete(k),
    append(...nodes) {
      for (const n of nodes) {
        if (n != null && n !== false) children.push(typeof n === 'object' ? n : { nodeType: 3, textContent: String(n) });
      }
    },
    appendChild(n) { if (n) children.push(n); return n; },
    insertBefore(n) { if (n) children.push(n); return n; },
    replaceChildren(...nodes) { children.length = 0; this.append(...nodes); },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => createMockElement('el'),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 }),
    getTotalLength: () => 1000,
    get children() { return children; },
    get childNodes() { return children; },
    get firstChild() { return children[0] || createMockElement('el'); },
    get lastChild() { return children[children.length - 1] || createMockElement('el'); },
  };
}

export function resolveLangMediaPaths(cfg, lang = '') {
  const baseTimings = (cfg && cfg.timingsScript) || 'assets/voice/timings.js';
  const baseAudio = cfg && cfg.audioSrc === false ? null : ((cfg && cfg.audioSrc) || 'assets/soundtrack.m4a');
  if (!lang) return { timingsRel: baseTimings, audioRel: baseAudio };
  const timingsRel = baseTimings.replace(/\.js$/i, `.${lang}.js`);
  const audioRel = baseAudio ? baseAudio.replace(/(\.[a-z0-9]+)$/i, `.${lang}$1`) : null;
  return { timingsRel, audioRel };
}

function createSandboxContext(ignoreBaked, lang) {
  const stageMock = createMockElement('div');
  const mockDoc = {
    documentElement: createMockElement('html'),
    head: createMockElement('head'),
    body: createMockElement('body'),
    createElement: tag => createMockElement(tag),
    createElementNS: (_ns, tag) => createMockElement(tag),
    createTextNode: s => ({ nodeType: 3, textContent: String(s) }),
    getElementById: id => (id === 'stage' ? stageMock : createMockElement('div')),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const sandbox = {
    window: {},
    console,
    document: mockDoc,
    V: {
      scenes: [],
      layers: [],
      config: {},
      __ignoreBakedLayout: ignoreBaked,
      __activeLang: lang || '',
      c: new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => createMockElement('div')) }),
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadPreConfigHtmlScripts(videoDir, sandbox) {
  const indexHtmlPath = path.join(videoDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) return;
  const htmlTxt = fs.readFileSync(indexHtmlPath, 'utf8');
  for (const m of htmlTxt.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (src.includes('video.config.js')) break;
    if (src.includes('base/js/engine.js') || src.includes('base/js/gl.js')) continue;
    const prePath = path.resolve(videoDir, src);
    if (fs.existsSync(prePath)) {
      try { vm.runInContext(fs.readFileSync(prePath, 'utf8'), sandbox, { filename: src }); } catch {}
    }
  }
}

function loadLocaleScriptIfPresent(videoDir, sandbox, lang) {
  if (!lang) return;
  const locPath = path.join(videoDir, 'locales', `${lang}.js`);
  if (fs.existsSync(locPath)) {
    vm.runInContext(fs.readFileSync(locPath, 'utf8'), sandbox, { filename: `locales/${lang}.js` });
  }
}

function resolveSceneScriptList(videoDir, cfg) {
  if (Array.isArray(cfg && cfg.sceneScripts) && cfg.sceneScripts.length) return cfg.sceneScripts;
  const jsDir = path.join(videoDir, 'js');
  if (!fs.existsSync(jsDir)) return [];
  return fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort().map(f => `js/${f}`);
}

function loadOptionalTimings(sandbox, timingsPath, timingsRel, videoId, requireTimings) {
  if (!fs.existsSync(timingsPath)) {
    if (requireTimings) throw new Error(`[${videoId}] Missing timings file: ${timingsPath}`);
    return;
  }
  try {
    vm.runInContext(fs.readFileSync(timingsPath, 'utf8'), sandbox, { filename: timingsRel });
  } catch (err) {
    if (requireTimings) throw err;
  }
}

export function loadVideoSandbox(root, videoId, { ignoreBaked = false, requireTimings = false, lang = '' } = {}) {
  const videosDir = path.join(root, 'videos');
  const videoDir = path.join(videosDir, videoId);
  if (!fs.existsSync(videoDir)) throw new Error(`Video directory not found: ${videoDir}`);

  const sandbox = createSandboxContext(ignoreBaked, lang);
  const enginePath = resolveBaseFile('js/engine.js', videosDir);
  vm.runInContext(fs.readFileSync(enginePath, 'utf8'), sandbox, { filename: 'base/js/engine.js' });

  loadPreConfigHtmlScripts(videoDir, sandbox);

  const configPath = path.join(videoDir, 'video.config.js');
  if (fs.existsSync(configPath)) {
    vm.runInContext(fs.readFileSync(configPath, 'utf8'), sandbox, { filename: `videos/${videoId}/video.config.js` });
  }
  loadLocaleScriptIfPresent(videoDir, sandbox, lang);

  const { timingsRel, audioRel } = resolveLangMediaPaths(sandbox.V.config, lang);
  const timingsPath = path.join(videoDir, timingsRel);
  loadOptionalTimings(sandbox, timingsPath, timingsRel, videoId, requireTimings);

  for (const rel of resolveSceneScriptList(videoDir, sandbox.V.config)) {
    const full = path.join(videoDir, rel);
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: `videos/${videoId}/${rel}` });
  }

  sandbox.V.layout();
  return { sandbox, videoDir, timingsPath, timingsRel, audioRel };
}

function safeCall(fn, thisArg, ...args) {
  if (typeof fn !== 'function') return;
  try { fn.apply(thisArg, args); } catch {}
}

function collectDryVideoClips(V, si, sceneStart, videoClipsOut) {
  if (!videoClipsOut || !V._videoClips) return;
  for (const clip of V._videoClips) {
    if (clip._vclip) videoClipsOut.push({ sceneIndex: si, sceneStart, ...clip._vclip });
  }
}

function dryRunSingleScene(V, sc, si, videoClipsOut) {
  const ctx = V.makeCtx ? V.makeCtx(sc, si) : { cue: () => 0, end: () => sc.duration, at: () => 0, dur: sc.duration, holdStart: () => 0.3 };
  sc.root = createMockElement('div');
  sc.ctx = ctx;
  if (V._videoClips) V._videoClips.clear();
  safeCall(sc.build, sc, sc.root, ctx);
  safeCall(sc.sfx, sc, ctx);
  safeCall(sc.checkpoints, sc, ctx);
  safeCall(sc.gl, sc, ctx);
  for (const frac of [0, 0.5, 1]) safeCall(sc.update, sc, (sc.duration || 1) * frac, ctx);
  for (const layer of (V.layers || [])) safeCall(sc[layer.prop || layer.id], sc, ctx, sc, si);
  collectDryVideoClips(V, si, sc.start, videoClipsOut);
}

export function probeSceneAnchors(sandbox, videoClipsOut = null) {
  const V = sandbox.V;
  V.__anchorErrors = [];
  V.__anchorErrorKeys = new Set();
  for (let si = 0; si < V.scenes.length; si++) {
    dryRunSingleScene(V, V.scenes[si], si, videoClipsOut);
  }
  return V.__anchorErrors.map(e => `S${e.scene} (${e.title || 'untitled'}) L${e.lineIdx}: ${e.reason}`);
}
