// 无头视频导出引擎：多进程分片并行渲染 + 按幕 SHA-256 内容哈希增量缓存 + 受控 <video>/静态图解码等待
// 用法：html-video render [video-id] [output.mp4] [--workers 4] [--scene 0] [--range 5:15] [--fps 30] [--lang en] [--no-cache]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ROOT, VIDEOS_DIR, listVideoIds, loadVideoSandbox, resolveBaseFile,
  loadChromium, findBrowserExecutable, resolveFfmpeg, getSandboxCfg,
  isBgmDisabledCfg, extractRawBgmSrc, localizeMediaRel,
} from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

const OPT_HANDLERS = {
  '--workers': (o, v) => { o.workers = Math.max(1, parseInt(v, 10) || 1); },
  '--scene': (o, v) => { o.scene = parseInt(v, 10); },
  '--range': (o, v) => { o.range = v; },
  '--fps': (o, v) => { o.fps = Number(v); },
  '--lang': (o, v) => { o.lang = v; },
};

const BOOLEAN_FLAGS = {
  '--no-cache': 'noCache',
  '--no-frame-reuse': 'noFrameReuse',
  '--no-bgm': 'noBgm',
};

function parseRenderArgs(argv) {
  const opts = { workers: null, scene: null, range: null, fps: null, lang: '', noCache: false, noFrameReuse: false, noBgm: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOLEAN_FLAGS[a]) { opts[BOOLEAN_FLAGS[a]] = true; continue; }
    if (OPT_HANDLERS[a] && i + 1 < argv.length) { OPT_HANDLERS[a](opts, argv[++i]); continue; }
    if (!a.startsWith('--')) pos.push(a);
  }
  return { opts, pos };
}

function resolveRawBgmVol(cfg) {
  const b = cfg && cfg.bgm;
  if (b && typeof b === 'object' && b.volume !== undefined) {
    const v = Number(b.volume);
    return Number.isFinite(v) ? Math.max(0, v) : 0.18;
  }
  return cfg && cfg.bgmSrc ? 1 : 0.18;
}

function findRawBgmPath(videoDir, cfg, lang) {
  const rawBase = extractRawBgmSrc(cfg);
  if (!rawBase) return null;
  if (lang) {
    const locPath = path.join(videoDir, localizeMediaRel(rawBase, lang));
    if (fs.existsSync(locPath)) return locPath;
  }
  const basePath = path.join(videoDir, rawBase);
  return fs.existsSync(basePath) ? basePath : null;
}

function resolveBgmForRender(videoDir, voice, cfg, bgmRelDefault, noBgm, lang) {
  const bgmLoop = !(cfg && cfg.bgm && typeof cfg.bgm === 'object' && cfg.bgm.loop === false);
  if (noBgm || isBgmDisabledCfg(cfg)) return { bgmPath: null, hasBgm: false, bgmVolume: 1, bgmLoop };
  const stemRel = voice.bgmSrc || bgmRelDefault || '';
  if (stemRel && fs.existsSync(path.join(videoDir, stemRel))) {
    return { bgmPath: path.join(videoDir, stemRel), hasBgm: true, bgmVolume: 1, bgmLoop };
  }
  const rawPath = findRawBgmPath(videoDir, cfg, lang);
  return { bgmPath: rawPath, hasBgm: Boolean(rawPath), bgmVolume: resolveRawBgmVol(cfg), bgmLoop };
}

function resolveAudioFile(videoDir, sandbox, cfg, audioRelDefault, bgmRelDefault, opts) {
  const voice = sandbox.V.voice || {};
  const audioRel = cfg.audioSrc === false ? '' : (voice.src || audioRelDefault || 'assets/soundtrack.m4a');
  const audioPath = audioRel ? path.join(videoDir, audioRel) : null;
  const bgmInfo = resolveBgmForRender(videoDir, voice, cfg, bgmRelDefault, opts.noBgm, opts.lang);
  return {
    audioPath,
    hasAudio: Boolean(audioPath && fs.existsSync(audioPath)),
    ...bgmInfo,
  };
}

function buildRenderSuffix(opts) {
  let suffix = opts.lang ? `.${opts.lang}` : '';
  if (opts.scene != null && !Number.isNaN(opts.scene)) return `${suffix}-s${String(opts.scene).padStart(2, '0')}`;
  if (opts.range) return `${suffix}-range`;
  return suffix;
}

function resolveOutAndAudio(videoId, videoDir, sandbox, cfg, opts, pos, audioRelDefault, bgmRelDefault) {
  const audioInfo = resolveAudioFile(videoDir, sandbox, cfg, audioRelDefault, bgmRelDefault, opts);
  const firstIsMp4 = Boolean(pos[0] && pos[0].endsWith('.mp4'));
  const suffix = buildRenderSuffix(opts);
  const baseName = cfg.outputName || `${videoId}.mp4`;
  const defaultOutName = suffix ? baseName.replace(/\.mp4$/i, `${suffix}.mp4`) : baseName;
  const outPath = firstIsMp4 ? path.resolve(pos[0]) : path.resolve(pos[1] || path.join(ROOT, defaultOutName));
  return { outPath, ...audioInfo };
}

function resolveTimeWindow(scenes, fullDur, hasAudio, opts) {
  if (opts.scene != null && !Number.isNaN(opts.scene)) {
    if (opts.scene < 0 || opts.scene >= scenes.length) {
      throw new Error(`--scene ${opts.scene} out of range (0..${scenes.length - 1})`);
    }
    const sc = scenes[opts.scene];
    return { startSec: sc.start, endSec: sc.start + sc.duration, isSlice: true };
  }
  if (opts.range) {
    const [a, b] = String(opts.range).split(':').map(Number);
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) {
      throw new Error(`Invalid --range "${opts.range}". Expected format like --range 5:18.5`);
    }
    return { startSec: Math.max(0, a), endSec: Math.min(fullDur + 0.5, b), isSlice: true };
  }
  return { startSec: 0, endSec: fullDur + (hasAudio ? 0.4 : 0), isSlice: false };
}

function hashFilesInDir(h, dir, extFilter, recursive = false) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory() && recursive) {
      h.update(name + '/');
      hashFilesInDir(h, fp, extFilter, true);
    } else if (st.isFile() && (!extFilter || extFilter(name))) {
      h.update(name);
      h.update(fs.readFileSync(fp));
    }
  }
}

function isGeneratedMediaOrSub(name) {
  return /^(soundtrack|bgm|subtitles)(\.[a-z0-9_-]+)?\.(m4a|mp3|wav|ogg|vtt|srt)$/i.test(name);
}

function hashFileFast(h, fp) {
  const st = fs.statSync(fp);
  if (st.size <= 2 * 1024 * 1024) { h.update(fs.readFileSync(fp)); return; }
  const chunk = 65536;
  const buf = Buffer.allocUnsafe(chunk * 2);
  const fd = fs.openSync(fp, 'r');
  try {
    fs.readSync(fd, buf, 0, chunk, 0);
    fs.readSync(fd, buf, chunk, chunk, st.size - chunk);
  } finally {
    fs.closeSync(fd);
  }
  h.update(`${st.size}:`);
  h.update(buf);
}

function hashVisualAssetsDir(h, dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (name !== 'voice') { h.update(`d:${name}/`); hashVisualAssetsDir(h, fp); }
    } else if (st.isFile() && !isGeneratedMediaOrSub(name)) {
      h.update(`f:${name}:`);
      hashFileFast(h, fp);
    }
  }
}

function shouldHashExtraScript(name, rel, sceneRelSet) {
  if (!name.endsWith('.js') && !name.endsWith('.mjs')) return false;
  if (/^timings(\.[a-z0-9_-]+)?\.js$/i.test(name)) return false;
  return !sceneRelSet.has(rel);
}

const SKIP_EXTRA_SCRIPT_DIRS = new Set(['assets', 'locales', 'node_modules']);

function hashExtraVideoScripts(h, videoDir, sceneRelSet, relDir = '') {
  const dir = relDir ? path.join(videoDir, relDir) : videoDir;
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const rel = relDir ? `${relDir}/${name}` : name;
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (!SKIP_EXTRA_SCRIPT_DIRS.has(name)) hashExtraVideoScripts(h, videoDir, sceneRelSet, rel);
    } else if (st.isFile() && shouldHashExtraScript(name, rel, sceneRelSet)) {
      h.update(`js:${rel}:`);
      h.update(fs.readFileSync(fp));
    }
  }
}

function skipQuoted(code, i, quote) {
  i++;
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue; }
    if (code[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function skipBlockComment(code, i) {
  const end = code.indexOf('*/', i + 2);
  return end < 0 ? code.length : end + 2;
}

function skipLineComment(code, i) {
  const end = code.indexOf('\n', i + 2);
  return end < 0 ? code.length : end + 1;
}

function advanceCallToken(code, i) {
  const ch = code[i];
  if (ch === '"' || ch === "'" || ch === '`') return skipQuoted(code, i, ch);
  if (ch === '/' && code[i + 1] === '/') return skipLineComment(code, i);
  if (ch === '/' && code[i + 1] === '*') return skipBlockComment(code, i);
  return -1;
}

function findCallEnd(code, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < code.length; i++) {
    const next = advanceCallToken(code, i);
    if (next >= 0) { i = next - 1; continue; }
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i + 1;
  }
  return code.length;
}

const SCENE_CALL_AT = /^V\.(?:scene|scenes\.push)\s*\(/;

function isIdentChar(ch) {
  return Boolean(ch && /[A-Za-z0-9_$]/.test(ch));
}

export function stripSceneCalls(code) {
  let out = '', last = 0, i = 0;
  while (i < code.length) {
    const next = advanceCallToken(code, i);
    if (next >= 0) { i = next; continue; }
    if (code[i] === 'V' && !isIdentChar(code[i - 1])) {
      const m = SCENE_CALL_AT.exec(code.slice(i));
      if (m) {
        out += code.slice(last, i);
        last = findCallEnd(code, i + m[0].length - 1);
        i = last;
        continue;
      }
    }
    i++;
  }
  return out + code.slice(last);
}

function getSceneModuleSharedDigest(videoDir, relScript, memo) {
  if (!relScript) return '';
  if (memo.has(relScript)) return memo.get(relScript);
  const fp = path.join(videoDir, relScript);
  const raw = fs.existsSync(fp) ? stripSceneCalls(fs.readFileSync(fp, 'utf8')) : '';
  const dg = crypto.createHash('sha256').update(raw).digest('hex');
  memo.set(relScript, dg);
  return dg;
}

function computeSharedVideoDigest(videoDir, W, H, fps, lang, sceneRelSet) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ v: '2.2', W, H, fps, lang }));
  for (const rel of ['css/base.css', 'js/engine.js', 'js/gl.js']) {
    const fp = resolveBaseFile(rel, VIDEOS_DIR);
    if (fs.existsSync(fp)) h.update(fs.readFileSync(fp));
  }
  const topFiles = ['index.html', 'video.config.js', ...(lang ? [`locales/${lang}.js`] : [])];
  for (const rel of topFiles) {
    const fp = path.join(videoDir, rel);
    if (fs.existsSync(fp)) h.update(fs.readFileSync(fp));
  }
  hashFilesInDir(h, videoDir, n => n.endsWith('.css'), false);
  hashFilesInDir(h, path.join(videoDir, 'css'), n => n.endsWith('.css'), true);
  hashFilesInDir(h, path.join(VIDEOS_DIR, 'themes'), n => n.endsWith('.css') || n.endsWith('.js'), true);
  hashExtraVideoScripts(h, videoDir, sceneRelSet || new Set());
  hashVisualAssetsDir(h, path.join(VIDEOS_DIR, 'assets'));
  hashVisualAssetsDir(h, path.join(videoDir, 'assets'));
  return h.digest('hex');
}

function serializeSubSpec(spec) {
  return typeof spec === 'function' ? spec.toString() : JSON.stringify(spec || null);
}

function serializeSceneCode(V, sc) {
  if (!sc) return '';
  const parts = [
    sc.id, sc.title, sc.cls, sc.transition, sc.transitionDur,
    serializeSubSpec(sc.subLayout || sc.subtitles),
    serializeSubSpec(sc.checkpoints),
    sc.build && sc.build.toString(),
    sc.update && sc.update.toString(),
    sc.gl && sc.gl.toString(),
  ];
  for (const layer of (V.layers || [])) {
    const fn = sc[layer.prop || layer.id];
    parts.push(typeof fn === 'function' ? fn.toString() : JSON.stringify(fn));
  }
  return parts.join('|');
}

function nextCutSignature(scenes, si) {
  const next = si + 1 < scenes.length ? scenes[si + 1] : null;
  if (!next) return '';
  return `${next.transition || ''}:${next.transitionDur === undefined ? '' : next.transitionDur}`;
}

function serializePrevLayerState(V, scenes, si) {
  const prev = si > 0 ? scenes[si - 1] : null;
  if (!prev || !Array.isArray(V.layers) || !V.layers.length) return '';
  return V.layers.map(l => {
    const v = prev[l.prop || l.id];
    return typeof v === 'function' ? v.toString() : JSON.stringify(v);
  }).join('|');
}

function computeSceneSegmentDigest(V, sharedHash, videoDir, modMemo, scenes, si, f0, f1, fps, hudSig, cpSig) {
  const sc = scenes[si];
  const prevSc = si > 0 && f0 / fps < sc.start ? scenes[si - 1] : null;
  const h = crypto.createHash('sha256');
  h.update(sharedHash);
  h.update(serializeSceneCode(V, sc));
  h.update(serializeSceneCode(V, prevSc));
  h.update(getSceneModuleSharedDigest(videoDir, sc._sourceScript, modMemo));
  h.update(getSceneModuleSharedDigest(videoDir, prevSc && prevSc._sourceScript, modMemo));
  h.update(serializePrevLayerState(V, scenes, si));
  h.update(nextCutSignature(scenes, si));
  h.update(cpSig);
  h.update(JSON.stringify({
    frames: f1 - f0,
    phase: Math.round((f0 / fps - sc.start) * 10000),
    dur: sc.duration,
    hudSig,
    cues: sc.cues,
    subCues: sc.subCues,
    env: V.voice && V.voice.envelopes ? V.voice.envelopes[si] : null,
    glKeys: V.glKeys || null,
  }));
  return h.digest('hex').slice(0, 16);
}

function computeHudSignature(V, cfg, scenes) {
  const hudEnabled = !(cfg && (cfg.hud === false || (cfg.ui && cfg.ui.hud === false)));
  if (!hudEnabled) return '';
  const durNorm = Math.max(0.001, V.duration || 1);
  return `${Math.round(durNorm * 1000)}:${scenes.slice(1).map(s => Math.round((s.start / durNorm) * 10000)).join(',')}`;
}

export function buildCachedSceneSegments(V, cfg, videoId, videoDir, totalFrames, W, H, fps, lang) {
  const scenes = V.scenes || [];
  const sceneRelSet = new Set(scenes.map(s => s._sourceScript).filter(Boolean));
  const sharedHash = computeSharedVideoDigest(videoDir, W, H, fps, lang, sceneRelSet);
  const modMemo = new Map();
  const hudSig = computeHudSignature(V, cfg, scenes);
  const cpParts = scenes.map(s => `${s.start}:${serializeSubSpec(s.checkpoints)}`);
  const cacheDir = path.join(ROOT, '.runtime/render-cache', videoId);
  fs.mkdirSync(cacheDir, { recursive: true });

  const bounds = scenes.map((sc, i) => (i === 0 ? 0 : Math.min(totalFrames, Math.round(sc.start * fps))));
  bounds.push(totalFrames);

  const segments = [];
  for (let si = 0; si < scenes.length; si++) {
    const f0 = bounds[si];
    const f1 = Math.max(f0, bounds[si + 1]);
    if (f1 <= f0) continue;
    const cpSig = cpParts.slice(0, si + 1).join('|');
    const digest = computeSceneSegmentDigest(V, sharedHash, videoDir, modMemo, scenes, si, f0, f1, fps, hudSig, cpSig);
    const cachePath = path.join(cacheDir, `s${String(si).padStart(2, '0')}-${digest}.mp4`);
    segments.push({ idx: si, f0, f1, partPath: cachePath, cached: fs.existsSync(cachePath) });
  }
  return segments;
}

function buildUncachedChunks(totalFrames, workerCount, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const chunks = [];
  const baseChunk = Math.floor(totalFrames / workerCount);
  const rem = totalFrames % workerCount;
  let cursor = 0;
  for (let w = 0; w < workerCount; w++) {
    const len = baseChunk + (w < rem ? 1 : 0);
    const partPath = path.join(tmpDir, `part-${String(w).padStart(2, '0')}.mp4`);
    chunks.push({ idx: w, f0: cursor, f1: cursor + len, partPath, cached: false });
    cursor += len;
  }
  return chunks;
}

function runFfmpeg(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`))));
  });
}

function installFrameReuseProbe() {
  let usesTgVar = null;
  const checkUsesTg = () => {
    if (usesTgVar !== null) return usesTgVar;
    usesTgVar = false;
    for (const s of Array.from(document.styleSheets)) {
      let rules;
      try { rules = s.cssRules; } catch { continue; }
      for (const r of Array.from(rules || [])) {
        if (r.cssText && r.cssText.includes('--tg')) { usesTgVar = true; return true; }
      }
    }
    return false;
  };
  const canDedupeStage = stage => {
    if (!stage) return false;
    const V = window.V;
    const glEl = document.getElementById('gl');
    if (V.gl && V.gl.ready && glEl && !glEl.classList.contains('is-off')) return false;
    if (V._videoClips && V._videoClips.size > 0) return false;
    if (stage.querySelector('canvas:not(#gl)')) return false;
    if (stage.getAnimations && stage.getAnimations({ subtree: true }).length > 0) return false;
    return !checkUsesTg();
  };
  const stageExtraState = stage => {
    const forms = Array.from(stage.querySelectorAll('input,textarea,select'))
      .slice(0, 20)
      .map(el => `${el.value}:${el.checked}`)
      .join(',');
    const scrolls = Array.from(stage.querySelectorAll('*'))
      .filter(el => el.scrollTop || el.scrollLeft)
      .slice(0, 20)
      .map(el => `${el.scrollTop}:${el.scrollLeft}`)
      .join(',');
    return `${document.documentElement.style.cssText}|${forms}|${scrolls}`;
  };
  const readStageHtml = stage => {
    const hud = document.getElementById('hud');
    const bar = hud && getComputedStyle(hud).display === 'none' ? hud.querySelector('.hud-bar') : null;
    if (!bar) return stage.innerHTML;
    const prev = bar.style.width;
    bar.style.width = '';
    const html = stage.innerHTML;
    bar.style.width = prev;
    return html;
  };
  window.__seekAndDedupe = async sec => {
    await window.V.seekToAsync(sec);
    const stage = document.getElementById('stage');
    if (!canDedupeStage(stage)) { window.__prevStageSig = null; return false; }
    const sig = `${document.documentElement.dataset.theme || ''}|${document.body.className}|${stageExtraState(stage)}|${readStageHtml(stage)}`;
    if (sig === window.__prevStageSig) return true;
    window.__prevStageSig = sig;
    return false;
  };
}

async function openRenderPage(browser, port, videoId, W, H, lang) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.addInitScript(installFrameReuseProbe);
  const q = lang ? `?record=1&lang=${encodeURIComponent(lang)}` : '?record=1';
  await page.goto(`http://127.0.0.1:${port}/${videoId}/${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__video && window.V && window.V.seekToAsync, null, { timeout: 15000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  return page;
}

async function renderSegmentToMp4(page, ffmpegBin, fps, startSec, seg, reuseFrames, onFrame) {
  const tmpOut = `${seg.partPath}.${process.pid}.tmp.mp4`;
  const ffArgs = [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    tmpOut,
  ];
  const ff = spawn(ffmpegBin, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  await page.evaluate(() => { window.__prevStageSig = null; });
  let prevBuf = null;
  for (let f = seg.f0; f < seg.f1; f++) {
    const sec = startSec + f / fps;
    const same = reuseFrames
      ? await page.evaluate(s => window.__seekAndDedupe(s), sec)
      : (await page.evaluate(s => window.V.seekToAsync(s), sec), false);
    const reused = Boolean(same && prevBuf);
    const buf = reused ? prevBuf : await page.screenshot({ type: 'jpeg', quality: 92 });
    prevBuf = buf;
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    onFrame(reused);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg seg ${seg.idx} exit ${code}`)))));
  fs.renameSync(tmpOut, seg.partPath);
}

async function renderMissingSegments({ misses, workerCount, videoId, W, H, fps, lang, startSec, ffmpegBin, tStartWall, reuseFrames }) {
  if (!misses.length) return;
  const totalMissFrames = misses.reduce((a, s) => a + (s.f1 - s.f0), 0);
  const poolSize = Math.min(misses.length, workerCount);
  const queue = misses.slice();
  let doneFrames = 0;
  let reusedFrames = 0;

  const { srv, port } = await startEphemeralVideoServer();
  const chromium = await loadChromium(ROOT);
  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });

  const onFrame = reused => {
    doneFrames++;
    if (reused) reusedFrames++;
    if (doneFrames % Math.max(1, fps * 2) === 0 || doneFrames === totalMissFrames) {
      const elapsed = Math.max(0.1, (Date.now() - tStartWall) / 1000);
      const pct = ((doneFrames / totalMissFrames) * 100).toFixed(1);
      const reusePct = Math.round((reusedFrames / doneFrames) * 100);
      process.stdout.write(`\r  frame ${doneFrames}/${totalMissFrames} (${pct}% · ${(doneFrames / elapsed).toFixed(1)} fps · ${reusePct}% reused)`);
    }
  };

  try {
    await Promise.all(Array.from({ length: poolSize }, async () => {
      const page = await openRenderPage(browser, port, videoId, W, H, lang);
      while (queue.length > 0) {
        const seg = queue.shift();
        if (seg) await renderSegmentToMp4(page, ffmpegBin, fps, startSec, seg, reuseFrames, onFrame);
      }
      await page.close();
    }));
    process.stdout.write('\n');
  } finally {
    await browser.close();
    srv.close();
  }
}

function pushSlicedAudioInput(muxArgs, filePath, isSlice, startSec, renderDur) {
  if (isSlice) muxArgs.push('-ss', startSec.toFixed(3), '-t', renderDur.toFixed(3));
  muxArgs.push('-i', filePath);
}

function pushVoiceOnlyMuxArgs(muxArgs, audioPath, isSlice, startSec, renderDur, audioBitrate) {
  pushSlicedAudioInput(muxArgs, audioPath, isSlice, startSec, renderDur);
  muxArgs.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy');
  const canCopy = !isSlice && /\.m4a$/i.test(audioPath);
  muxArgs.push(...(canCopy ? ['-c:a', 'copy', '-shortest'] : ['-c:a', 'aac', '-b:a', audioBitrate || '128k', '-shortest']));
}

function buildBgmFilterOps({ isSlice, startSec, renderDur, bgmVolume, padToEnd }) {
  const ops = [];
  if (isSlice) ops.push(`atrim=start=${startSec.toFixed(3)}:duration=${renderDur.toFixed(3)},asetpts=PTS-STARTPTS`);
  if (Math.abs((bgmVolume ?? 1) - 1) > 0.001) ops.push(`volume=${Number(bgmVolume).toFixed(4)}`);
  if (padToEnd) ops.push('apad');
  return ops;
}

function pushBgmOnlyMuxArgs(muxArgs, { bgmPath, bgmLoop, bgmVolume, isSlice, startSec, renderDur, audioBitrate }) {
  if (bgmLoop) muxArgs.push('-stream_loop', '-1');
  muxArgs.push('-i', bgmPath);
  const ops = buildBgmFilterOps({ isSlice, startSec, renderDur, bgmVolume, padToEnd: !bgmLoop });
  if (ops.length) muxArgs.push('-af', ops.join(','));
  muxArgs.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', audioBitrate || '128k', '-shortest');
}

function pushDualStemMuxArgs(muxArgs, { audioPath, bgmPath, bgmLoop, bgmVolume, isSlice, startSec, renderDur, audioBitrate }) {
  pushSlicedAudioInput(muxArgs, audioPath, isSlice, startSec, renderDur);
  if (bgmLoop) muxArgs.push('-stream_loop', '-1');
  muxArgs.push('-i', bgmPath);
  const ops = buildBgmFilterOps({ isSlice, startSec, renderDur, bgmVolume, padToEnd: false });
  const bgmGraph = ops.length ? `[2:a]${ops.join(',')}[bgm];[1:a][bgm]` : '[1:a][2:a]';
  muxArgs.push(
    '-filter_complex', `${bgmGraph}amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
    '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', audioBitrate || '128k', '-shortest'
  );
}

async function stitchSegmentsAndAudio(spec) {
  const { segments, tmpDir, ffmpegBin, hasAudio, audioPath, hasBgm, audioBitrate, isSlice, startSec, renderDur, outPath } = spec;
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const listFile = path.join(tmpDir, 'concat.txt');
  const listBody = segments.map(s => `file '${s.partPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n';
  fs.writeFileSync(listFile, listBody, 'utf8');

  const muxArgs = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (hasAudio && hasBgm) {
    pushDualStemMuxArgs(muxArgs, spec);
  } else if (hasAudio) {
    pushVoiceOnlyMuxArgs(muxArgs, audioPath, isSlice, startSec, renderDur, audioBitrate);
  } else if (hasBgm) {
    pushBgmOnlyMuxArgs(muxArgs, spec);
  } else {
    muxArgs.push('-c:v', 'copy');
  }
  muxArgs.push('-movflags', '+faststart', outPath);
  await runFfmpeg(ffmpegBin, muxArgs);
}

function resolveTargetVideoId(pos) {
  const firstIsMp4 = Boolean(pos[0] && pos[0].endsWith('.mp4'));
  const defaultVideo = listVideoIds()[0] || 'starter';
  return firstIsMp4 ? defaultVideo : (pos[0] || defaultVideo);
}

function resolveWorkerCount(totalFrames, opts) {
  const autoWorkers = totalFrames >= 120 ? Math.min(4, Math.max(1, os.cpus().length - 1)) : 1;
  const envWorkers = process.env.WORKERS ? Math.max(1, parseInt(process.env.WORKERS, 10) || 1) : null;
  return Math.min(totalFrames, opts.workers || envWorkers || autoWorkers);
}

function describeRenderAudio(hasAudio, hasBgm) {
  if (hasAudio) return hasBgm ? ' + audio+bgm' : ' + audio';
  return hasBgm ? ' + bgm' : ' (silent)';
}

function resolveStageSpec(V, cfg, opts) {
  return {
    W: cfg.width || 1920,
    H: cfg.height || 1080,
    FPS: Number(opts.fps || process.env.FPS || cfg.fps || 30),
    scenes: V.scenes || [],
    fullDur: V.totalDuration || V.duration || 1,
    audioBitrate: cfg.audioBitrate || '128k',
  };
}

async function runRenderCli() {
  const { opts, pos } = parseRenderArgs(process.argv.slice(2));
  const VIDEO_ID = resolveTargetVideoId(pos);
  const { sandbox, videoDir, audioRel, bgmRel } = loadVideoSandbox(ROOT, VIDEO_ID, { ignoreBaked: false, requireTimings: false, lang: opts.lang });
  const cfg = getSandboxCfg(sandbox.V);
  const { W, H, FPS, scenes, fullDur, audioBitrate } = resolveStageSpec(sandbox.V, cfg, opts);

  const media = resolveOutAndAudio(VIDEO_ID, videoDir, sandbox, cfg, opts, pos, audioRel, bgmRel);
  const { startSec, endSec, isSlice } = resolveTimeWindow(scenes, fullDur, media.hasAudio || media.hasBgm, opts);
  const renderDur = Math.max(1 / FPS, endSec - startSec);
  const totalFrames = Math.max(1, Math.ceil(renderDur * FPS));
  const workerCount = resolveWorkerCount(totalFrames, opts);

  const tmpDir = path.join(ROOT, '.runtime', `render-${VIDEO_ID}-${process.pid}`);
  const ffmpegBin = resolveFfmpeg(ROOT);
  const tStartWall = Date.now();

  try {
    const useSceneCache = !isSlice && !opts.noCache && scenes.length > 0;
    const segments = useSceneCache
      ? buildCachedSceneSegments(sandbox.V, cfg, VIDEO_ID, videoDir, totalFrames, W, H, FPS, opts.lang)
      : buildUncachedChunks(totalFrames, workerCount, tmpDir);
    const misses = segments.filter(s => !s.cached);
    const cacheInfo = useSceneCache ? ` [cache ${segments.length - misses.length}/${segments.length} scenes hit]` : '';

    console.log(
      `Rendering [${VIDEO_ID}] ${W}x${H} @ ${FPS}fps · ${totalFrames} frames ` +
      `(${startSec.toFixed(2)}s..${endSec.toFixed(2)}s)${cacheInfo}${describeRenderAudio(media.hasAudio, media.hasBgm)} -> ${media.outPath}`
    );

    await renderMissingSegments({
      misses, workerCount, videoId: VIDEO_ID, W, H, fps: FPS, lang: opts.lang,
      startSec, ffmpegBin, tStartWall, reuseFrames: !opts.noFrameReuse,
    });

    await stitchSegmentsAndAudio({
      segments, tmpDir, ffmpegBin, ...media,
      audioBitrate, isSlice, startSec, renderDur,
    });

    console.log(`Done in ${((Date.now() - tStartWall) / 1000).toFixed(1)}s: ${media.outPath}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('render.mjs');
if (isDirectRun) await runRenderCli();
