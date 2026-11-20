// 无头视频导出引擎：多进程分片并行渲染 + 按幕 SHA-256 内容哈希增量缓存 + 受控 <video>/静态图解码等待
// 用法：html-video render [video-id] [output.mp4] [--workers 4] [--scene 0] [--range 5:15] [--fps 30] [--lang en] [--no-cache]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse } from 'acorn';
import {
  ROOT, VIDEOS_DIR, listVideoIds, loadVideoSandbox, resolveBaseFile,
  loadChromium, findBrowserExecutable, resolveFfmpeg, getSandboxCfg,
  isBgmDisabledCfg, extractRawBgmSrc, localizeMediaRel, normalizeCliArgs, getSceneCacheSnapshot, isMainModule,
} from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

const OPT_HANDLERS = {
  '--workers': (o, v) => { o.workers = Math.max(1, parseInt(v, 10) || 1); },
  '--scene': (o, v) => { o.scene = v.trim() ? Number(v) : NaN; },
  '--range': (o, v) => { o.range = v; },
  '--fps': (o, v) => { o.fps = Number(v); },
  '--lang': (o, v) => { o.lang = v; },
};

const BOOLEAN_FLAGS = {
  '--no-cache': 'noCache',
  '--no-frame-reuse': 'noFrameReuse',
  '--no-bgm': 'noBgm',
};

function parseRenderArgs(rawArgv) {
  const argv = normalizeCliArgs(rawArgv);
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
  const firstIsMp4 = pos.length === 1 && /\.mp4$/i.test(pos[0]);
  const suffix = buildRenderSuffix(opts);
  const baseName = cfg.outputName || `${videoId}.mp4`;
  const defaultOutName = suffix ? baseName.replace(/\.mp4$/i, `${suffix}.mp4`) : baseName;
  const outPath = firstIsMp4 ? path.resolve(pos[0]) : path.resolve(pos[1] || path.join(ROOT, defaultOutName));
  return { outPath, ...audioInfo };
}

export function resolveTimeWindow(scenes, fullDur, hasAudio, opts) {
  if (opts.scene != null) {
    if (!Number.isInteger(opts.scene) || opts.scene < 0 || opts.scene >= scenes.length) {
      throw new Error(`--scene ${opts.scene} out of range (0..${scenes.length - 1})`);
    }
    const sc = scenes[opts.scene];
    return { startSec: sc.start, endSec: sc.start + sc.duration, isSlice: true };
  }
  if (opts.range) {
    const parts = String(opts.range).split(':');
    const [a, b] = parts.map(Number);
    if (parts.length !== 2 || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      throw new Error(`Invalid --range "${opts.range}". Expected format like --range 5:18.5`);
    }
    const startSec = Math.max(0, a), endSec = Math.min(fullDur + 0.5, b);
    if (endSec <= startSec) throw new Error(`--range "${opts.range}" does not overlap the video (0..${fullDur + 0.5}).`);
    return { startSec, endSec, isSlice: true };
  }
  return { startSec: 0, endSec: fullDur + (hasAudio ? 0.4 : 0), isSlice: false };
}

function hashFilesInDir(h, dir, extFilter, recursive = false, relDir = '') {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const fp = path.join(dir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = fs.statSync(fp);
    if (st.isDirectory() && recursive) {
      hashFilesInDir(h, fp, extFilter, true, rel);
    } else if (st.isFile() && (!extFilter || extFilter(name))) {
      hashFileEntry(h, rel, fp, st.size);
    }
  }
}

function isGeneratedMediaOrSub(name) {
  return /^(soundtrack|bgm|subtitles)(\.[a-z0-9_-]+)?\.(m4a|mp3|wav|ogg|vtt|srt)$/i.test(name);
}

function hashFileContent(h, fp, size) {
  if (size <= 2 * 1024 * 1024) { h.update(fs.readFileSync(fp)); return; }
  const buf = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(fp, 'r');
  try {
    // 逐块读取完整内容，避免大素材中部的改动误命中缓存。
    let count;
    while ((count = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
}

function hashFileEntry(h, name, fp, size = fs.statSync(fp).size) {
  h.update(JSON.stringify({ name, size }));
  hashFileContent(h, fp, size);
}

function isRenderOutput(fp, outputPath) {
  return Boolean(outputPath) && path.relative(fp, outputPath) === '';
}

function hashVisualAssetsDir(h, dir, outputPath = '', relDir = '') {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const fp = path.join(dir, name);
    if (isRenderOutput(fp, outputPath)) continue;
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (name !== 'voice') hashVisualAssetsDir(h, fp, outputPath, rel);
    } else if (st.isFile() && !isGeneratedMediaOrSub(name)) {
      hashFileEntry(h, rel, fp, st.size);
    }
  }
}

function shouldHashExtraFile(name, rel, sceneRelSet) {
  if (isGeneratedMediaOrSub(name)) return false;
  if (/^timings(\.[a-z0-9_-]+)?\.js$/i.test(name)) return false;
  return !sceneRelSet.has(rel);
}

function hashExtraVideoFiles(h, videoDir, sceneRelSet, relDir = '', outputPath = '') {
  const dir = relDir ? path.join(videoDir, relDir) : videoDir;
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const rel = relDir ? `${relDir}/${name}` : name;
    const fp = path.join(dir, name);
    if (isRenderOutput(fp, outputPath)) continue;
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (name === 'node_modules' || (!relDir && (name === 'assets' || name === 'locales'))) continue;
      hashExtraVideoFiles(h, videoDir, sceneRelSet, rel, outputPath);
    } else if (st.isFile() && shouldHashExtraFile(name, rel, sceneRelSet)) {
      hashFileEntry(h, 'video-files/' + rel, fp, st.size);
    }
  }
}

function memberPath(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression' || node.computed) return '';
  return `${memberPath(node.object)}.${node.property.name}`;
}

function isSceneRegistration(node) {
  if (node.type !== 'CallExpression' || node.arguments.length !== 1) return false;
  if (node.arguments[0].type !== 'ObjectExpression') return false;
  const callee = memberPath(node.callee);
  return callee === 'V.scene' || callee === 'V.scenes.push';
}

function splitSceneSource(code) {
  let body;
  try { body = parse(code, { ecmaVersion: 'latest' }).body; }
  catch { return { shared: code, calls: [] }; }
  let shared = '', last = 0;
  const calls = [];
  for (const statement of body) {
    if (statement.type !== 'ExpressionStatement' || !isSceneRegistration(statement.expression)) continue;
    const { start, end } = statement.expression;
    shared += code.slice(last, start);
    calls.push(code.slice(start, end));
    last = end;
  }
  return { shared: shared + code.slice(last), calls };
}

export function stripSceneCalls(code) {
  return splitSceneSource(code).shared;
}

function loadSceneCacheSources(videoDir, scenes) {
  const groups = new Map(), modules = new Map(), definitions = new WeakMap();
  for (const scene of scenes) {
    if (!scene._sourceScript) continue;
    if (!groups.has(scene._sourceScript)) groups.set(scene._sourceScript, []);
    groups.get(scene._sourceScript).push(scene);
  }
  for (const [rel, group] of groups) {
    const code = fs.readFileSync(path.join(videoDir, rel), 'utf8');
    const parts = splitSceneSource(code);
    // 只有能够逐个对应的顶层对象定义才按幕处理，工厂和动态注册保留完整源码。
    if (parts.calls.length !== group.length) { modules.set(rel, code); continue; }
    modules.set(rel, parts.shared);
    group.forEach((scene, i) => definitions.set(scene, parts.calls[i]));
  }
  return { modules, definitions };
}

function hashEntryScripts(h, videoDir, sourceInfo) {
  const entry = path.join(videoDir, 'index.html');
  if (!fs.existsSync(entry)) return;
  const sceneFiles = new Set([...sourceInfo.modules.keys()].map(rel => path.resolve(videoDir, rel)));
  const html = fs.readFileSync(entry, 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = match[1].split(/[?#]/)[0];
    if (!src || /^(?:[a-z]+:|\/\/)/i.test(src)) continue;
    const file = src.startsWith('/') ? path.resolve(VIDEOS_DIR, '.' + src) : path.resolve(videoDir, src);
    if (sceneFiles.has(file)) continue;
    h.update(JSON.stringify({ entryScript: src, exists: fs.existsSync(file) }));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) hashFileEntry(h, src, file);
  }
}

function cssImportPaths(css) {
  // Skip quoted strings and comments so text containing "@import" is not treated as a dependency.
  const comment = /\/\*[\s\S]*?\*\//.source;
  const escape = /\\(?:[0-9a-f]{1,6}(?:\r\n|[ \t\r\n\f])?|\r\n|[\s\S])/.source;
  const quoted = String.raw`"(?:${escape}|[^"\\])*"|'(?:${escape}|[^'\\])*'`;
  const unquoted = String.raw`(?:${escape}|[^)\s"'\\])+`;
  const imports = new RegExp(
    String.raw`${comment}|${quoted}|@import\b(?:\s|${comment})*(?:(${quoted})|url\(\s*(${quoted}|${unquoted})\s*\))`, 'gi');
  const paths = [];
  for (const [, direct, url] of css.matchAll(imports)) {
    const value = (direct ?? url)?.replace(/^(["'])([\s\S]*)\1$/, '$2');
    if (!value) continue;
    paths.push(value.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\s\S]))/gi, (_, hex, escaped) => {
      if (!hex) return /^[\r\n\f]/.test(escaped) ? '' : escaped;
      const code = parseInt(hex, 16);
      return code && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    }));
  }
  return paths;
}

function localStylesheet(href, referrer, videosDir) {
  let url, pathname;
  try {
    url = new URL(href, referrer);
    pathname = decodeURIComponent(url.pathname);
  } catch { return null; }
  if (url.origin !== referrer.origin || pathname.includes('\0')) return null;
  const file = path.resolve(videosDir, '.' + pathname);
  const relative = path.relative(videosDir, file);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  const basePrefix = 'base' + path.sep;
  return { url, file: relative.startsWith(basePrefix) ? resolveBaseFile(relative.slice(basePrefix.length), videosDir) : file };
}

function hashStylesheet(h, href, referrer, videosDir, seen) {
  const resolved = localStylesheet(href, referrer, videosDir);
  if (!resolved || seen.has(resolved.url.pathname)) return;
  const { url, file } = resolved;
  seen.add(url.pathname);
  const css = fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : null;
  h.update(JSON.stringify({ stylesheet: url.pathname, size: css?.length ?? null }));
  if (!css) return;
  h.update(css);
  for (const imported of cssImportPaths(css.toString('utf8'))) hashStylesheet(h, imported, url, videosDir, seen);
}

function hashEntryStyles(h, videoDir) {
  const entry = path.join(videoDir, 'index.html');
  if (!fs.existsSync(entry)) return;
  const html = fs.readFileSync(entry, 'utf8');
  const referrer = new URL('/' + encodeURIComponent(path.basename(videoDir)) + '/', 'http://video.local');
  const videosDir = path.dirname(videoDir);
  const seen = new Set();
  const hashStyle = href => hashStylesheet(h, href, referrer, videosDir, seen);
  for (const [tag, inline] of html.matchAll(/<!--[\s\S]*?-->|<style\b[^>]*>([\s\S]*?)<\/style\s*>|<link\b[^>]*>/gi)) {
    if (inline !== undefined) {
      for (const imported of cssImportPaths(inline)) hashStyle(imported);
    } else if (/^<link/i.test(tag)) {
      const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (/\bstylesheet\b/i.test(rel) && href) hashStyle(href);
    }
  }
}

function computeSharedVideoDigest(videoDir, W, H, fps, lang, sourceInfo, outputPath) {
  const h = crypto.createHash('sha256');
  // 渲染规则改变后，旧缓存片段也需要重新生成。
  h.update(JSON.stringify({ v: '4.1', W, H, fps, lang }));
  for (const rel of ['css/base.css', 'js/engine.js', 'js/gl.js', 'js/frame-client.js']) {
    const fp = resolveBaseFile(rel, VIDEOS_DIR);
    if (fs.existsSync(fp)) hashFileEntry(h, 'base/' + rel, fp);
  }
  const topFiles = ['index.html', 'video.config.js', ...(lang ? [`locales/${lang}.js`] : [])];
  for (const rel of topFiles) {
    const fp = path.join(videoDir, rel);
    if (fs.existsSync(fp)) hashFileEntry(h, 'video/' + rel, fp);
  }
  for (const rel of [...sourceInfo.modules.keys()].sort()) {
    h.update(JSON.stringify({ sharedSceneModule: rel, source: sourceInfo.modules.get(rel) }));
  }
  hashEntryScripts(h, videoDir, sourceInfo);
  hashEntryStyles(h, videoDir);
  hashFilesInDir(h, path.join(VIDEOS_DIR, 'themes'), n => n.endsWith('.css') || n.endsWith('.js'), true, 'themes');
  hashExtraVideoFiles(h, videoDir, new Set(sourceInfo.modules.keys()), '', outputPath);
  hashVisualAssetsDir(h, path.join(VIDEOS_DIR, 'assets'), outputPath, 'shared-assets');
  hashVisualAssetsDir(h, path.join(videoDir, 'assets'), outputPath, 'video-assets');
  return h.digest('hex');
}

function serializeSubSpec(spec) {
  return typeof spec === 'function' ? spec.toString() : JSON.stringify(spec || null);
}

function serializeSceneCode(V, sc) {
  if (!sc) return '';
  const parts = {
    authored: getSceneCacheSnapshot(sc),
    id: sc.id, title: sc.title, cls: sc.cls,
    transition: sc.transition, transitionDur: sc.transitionDur,
    subtitles: serializeSubSpec(sc.subLayout || sc.subtitles),
    checkpoints: serializeSubSpec(sc.checkpoints),
    build: sc.build && sc.build.toString(),
    update: sc.update && sc.update.toString(),
    gl: sc.gl && sc.gl.toString(),
    layers: [],
  };
  for (const layer of (V.layers || [])) {
    const fn = sc[layer.prop || layer.id];
    parts.layers.push([layer.prop || layer.id, typeof fn === 'function' ? fn.toString() : JSON.stringify(fn)]);
  }
  return JSON.stringify(parts);
}

function nextCutSignature(scenes, si) {
  const next = si + 1 < scenes.length ? scenes[si + 1] : null;
  if (!next) return '';
  return JSON.stringify({ transition: next.transition || '', duration: next.transitionDur });
}

function serializePrevLayerState(V, scenes, si, sourceInfo, startSec) {
  const prev = si > 0 ? scenes[si - 1] : null;
  if (!prev || !Array.isArray(V.layers) || !V.layers.length) return '';
  const elapsed = Math.max(0, startSec - scenes[si].start);
  if (!V.layers.some(layer => (layer.blendDur ?? 0.45) > elapsed)) return '';
  return JSON.stringify({
    scene: serializeSceneCode(V, prev),
    source: sourceInfo.definitions.get(prev),
    timing: getSceneTimingInputs(V, prev, si - 1),
  });
}

function getSceneTimingInputs(V, scene, index) {
  if (!scene) return null;
  const voice = (V.getActiveVoice ? V.getActiveVoice() : V.voice) || {};
  return {
    duration: scene.duration,
    cues: scene.cues,
    subCues: scene.subCues,
    words: voice.words ? voice.words[index] : null,
    envelope: voice.envelopes ? voice.envelopes[index] : null,
  };
}

function computeSceneSegmentDigest(V, sharedHash, sourceInfo, scenes, si, f0, f1, fps, hudSig, cpSig) {
  const sc = scenes[si];
  const prevSc = si > 0 && f0 / fps < sc.start ? scenes[si - 1] : null;
  const h = crypto.createHash('sha256');
  h.update(sharedHash);
  h.update(JSON.stringify({
    scene: serializeSceneCode(V, sc),
    previous: serializeSceneCode(V, prevSc),
    source: sourceInfo.definitions.get(sc),
    previousSource: sourceInfo.definitions.get(prevSc),
    previousLayers: serializePrevLayerState(V, scenes, si, sourceInfo, f0 / fps),
    nextCut: nextCutSignature(scenes, si),
    checkpoints: cpSig,
  }));
  h.update(JSON.stringify({
    frames: f1 - f0,
    phase: Math.round((f0 / fps - sc.start) * 10000),
    dur: sc.duration,
    hudSig,
    timing: getSceneTimingInputs(V, sc, si),
    previousTiming: getSceneTimingInputs(V, prevSc, si - 1),
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

export function buildCachedSceneSegments(V, cfg, videoId, videoDir, totalFrames, W, H, fps, lang, outputPath = '') {
  const scenes = V.scenes || [];
  const sourceInfo = loadSceneCacheSources(videoDir, scenes);
  const sharedHash = computeSharedVideoDigest(videoDir, W, H, fps, lang, sourceInfo, outputPath);
  const hudSig = computeHudSignature(V, cfg, scenes);
  const cpParts = scenes.map(s => [s.start, serializeSubSpec(s.checkpoints)]);
  const cacheDir = path.join(ROOT, '.runtime/render-cache', videoId);
  fs.mkdirSync(cacheDir, { recursive: true });

  const bounds = scenes.map((sc, i) => (i === 0 ? 0 : Math.min(totalFrames, Math.round(sc.start * fps))));
  bounds.push(totalFrames);

  const segments = [];
  for (let si = 0; si < scenes.length; si++) {
    const f0 = bounds[si];
    const f1 = Math.max(f0, bounds[si + 1]);
    if (f1 <= f0) continue;
    const cpSig = JSON.stringify(cpParts.slice(0, si + 1));
    const digest = computeSceneSegmentDigest(V, sharedHash, sourceInfo, scenes, si, f0, f1, fps, hudSig, cpSig);
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

export function buildRenderTasks(misses, workerCount, fps, tmpDir) {
  const totalFrames = misses.reduce((sum, segment) => sum + segment.f1 - segment.f0, 0);
  const targetFrames = Math.max(Math.ceil(fps * 10), Math.ceil(totalFrames / (workerCount * 2)));
  const groups = misses.map(segment => {
    const length = segment.f1 - segment.f0;
    const count = workerCount > 1 ? Math.ceil(length / targetFrames) : 1;
    const parts = Array.from({ length: count }, (_, index) => ({
      ...segment,
      f0: segment.f0 + Math.floor(length * index / count),
      f1: segment.f0 + Math.floor(length * (index + 1) / count),
      partPath: count === 1 ? segment.partPath : path.join(tmpDir, `scene-${segment.idx}-part-${index}.mp4`),
    }));
    return { segment, parts };
  });
  const jobs = groups.flatMap(group => group.parts).sort((a, b) => (b.f1 - b.f0) - (a.f1 - a.f0));
  return { groups, jobs };
}

function writeConcatList(listFile, segments) {
  const body = segments.map(s => `file '${s.partPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n';
  fs.writeFileSync(listFile, body, 'utf8');
}

async function mergeRenderParts(groups, ffmpegBin, tmpDir) {
  for (const { segment, parts } of groups) {
    if (parts.length === 1) continue;
    const listFile = path.join(tmpDir, `scene-${segment.idx}-concat.txt`);
    const tmpOut = `${segment.partPath}.${process.pid}.tmp.mp4`;
    writeConcatList(listFile, parts);
    try {
      await runFfmpeg(ffmpegBin, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', tmpOut]);
      fs.renameSync(tmpOut, segment.partPath);
    } finally {
      fs.rmSync(tmpOut, { force: true });
    }
  }
}

function runFfmpeg(bin, args) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.once('error', error => rej(new Error(`Cannot start ffmpeg: ${bin}`, { cause: error })));
    p.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`))));
  });
}

export function installFrameReuseProbe() {
  const shadowHosts = new WeakSet();
  const modalSelector = CSS.supports('selector(:modal)') ? ':modal' : 'dialog[open]';
  const popoverSelector = CSS.supports('selector(:popover-open)') ? ':popover-open' : '[popover]';
  const nativeNodeIds = new WeakMap();
  let nextNativeNodeId = 0;
  const nativeNodeId = node => {
    if (!node) return 0;
    if (!nativeNodeIds.has(node)) nativeNodeIds.set(node, ++nextNativeNodeId);
    return nativeNodeIds.get(node);
  };
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options);
    shadowHosts.add(this);
    return root;
  };
  let styleState = [];
  const usesAnimationClock = rule => {
    if (rule.style) {
      const delay = rule.style.getPropertyValue('animation-delay');
      const priority = rule.style.getPropertyPriority('animation-delay');
      // 含 var() 的简写属性可能无法拆成长属性，保留其完整声明检查。
      const text = rule.style.cssText.replace(`animation-delay: ${delay}${priority ? ' !' + priority : ''};`, '');
      if (text.includes('--anim-t')) return true;
    }
    if (rule.cssRules) return Array.from(rule.cssRules).some(usesAnimationClock);
    return !rule.style && rule.cssText.includes('--anim-t');
  };
  const collectStyleState = (sheet, seen, parts) => {
    if (seen.has(sheet)) return true;
    seen.add(sheet);
    try {
      parts.push([sheet.href, sheet.disabled, sheet.media.mediaText]);
      for (const rule of sheet.cssRules) {
        const text = rule.cssText;
        // 活动动画不会复用；单独的 animation-delay 不影响静态画面。
        if (text.includes('--tg') || (text.includes('--anim-t') && usesAnimationClock(rule))) return false;
        parts.push(text);
        if (rule.styleSheet && !collectStyleState(rule.styleSheet, seen, parts)) return false;
      }
    } catch { return false; }
    return true;
  };
  const readStyleState = () => {
    const parts = [], seen = new Set();
    const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
    for (const sheet of sheets) {
      if (!collectStyleState(sheet, seen, parts)) return false;
    }
    styleState = parts;
    return true;
  };
  const usesInlineClock = el => /\bvar\([^)]*--(?:tg|anim-t)(?![\w-])|\\/i.test(el.style?.cssText || '');
  const hasUntrackedElementState = el => shadowHosts.has(el) || el.shadowRoot || el.localName.includes('-') || usesInlineClock(el);
  const hasExternalPixels = stage => Boolean(stage.querySelector('iframe,canvas:not(#gl),svg animate,svg animateTransform,svg animateMotion,svg set') || (window.V._frameRuntime && window.V._frameRuntime.hasActive()));
  const canDedupeStage = stage => {
    if (!stage) return false;
    // 原生顶层元素的层叠顺序无法从舞台 HTML 读取，打开期间完整截帧。
    if (document.querySelector(`${modalSelector},${popoverSelector}`)) return false;
    const V = window.V;
    const glEl = document.getElementById('gl');
    if (V.gl && V.gl.ready && glEl && !glEl.classList.contains('is-off')) return false;
    if (V._videoClips && V._videoClips.size > 0) return false;
    // Canvas 像素和 SVG 原生动画的当前状态不会反映在 HTML 中。
    if (hasExternalPixels(stage)) return false;
    // 自定义元素还可能持有声明式封闭影子根，其内部状态无法通过 innerHTML 检查。
    if ([document.documentElement, document.body, stage, ...stage.querySelectorAll('*')].some(hasUntrackedElementState)) return false;
    // use 可绘制舞台外的 SVG 定义，这些内容不在舞台签名中。
    if ([...stage.querySelectorAll('use')].some(el => {
      try {
        const ref = new URL(el.href?.baseVal || '', document.baseURI);
        if (ref.href.split('#')[0] !== location.href.split('#')[0]) return true;
        return !stage.contains(document.getElementById(decodeURIComponent(ref.hash.slice(1))));
      } catch { return true; }
    })) return false;
    if (stage.getAnimations && stage.getAnimations({ subtree: true }).length > 0) return false;
    return readStyleState();
  };
  const stageExtraState = stage => {
    const scope = [document.documentElement, document.body, stage].map(el => {
      const shell = el.cloneNode(false);
      if (el === stage) {
        // 使用内置时钟的 CSS 动效已由 canDedupeStage 排除。
        shell.style.removeProperty('--tg');
        shell.style.removeProperty('--anim-t');
      }
      return shell.outerHTML;
    });
    const forms = Array.from(stage.querySelectorAll('input,textarea,select'), el => [
      el.value, el.checked, el.indeterminate, el.validity.valid,
      el.selectionStart, el.selectionEnd, el.selectionDirection,
      el.options ? Array.from(el.options, opt => opt.selected) : null,
    ]);
    const scrolls = [stage, ...stage.querySelectorAll('*')]
      .map((el, index) => [index, el.scrollTop, el.scrollLeft])
      .filter(([, top, left]) => top || left);
    // 原生焦点和选区不会反映在 HTML 中，单独记录节点身份与范围。
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => {
      const range = selection.getRangeAt(index);
      return [nativeNodeId(range.startContainer), range.startOffset, nativeNodeId(range.endContainer), range.endOffset];
    }) : [];
    const nativeState = [
      nativeNodeId(document.activeElement),
      selection ? [nativeNodeId(selection.anchorNode), selection.anchorOffset, nativeNodeId(selection.focusNode), selection.focusOffset] : null,
      ranges,
    ];
    return JSON.stringify([styleState, scope, forms, scrolls, nativeState]);
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
    const sig = `${stageExtraState(stage)}|${readStageHtml(stage)}`;
    if (sig === window.__prevStageSig) return true;
    window.__prevStageSig = sig;
    return false;
  };
}

async function openRenderPage(browser, port, videoId, W, H, lang) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.addInitScript(installFrameReuseProbe);
  const q = lang ? `?record=1&lang=${encodeURIComponent(lang)}` : '?record=1';
  await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(videoId)}/${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__video && window.V && window.V.seekToAsync, null, { timeout: 15000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  return page;
}

function observeEncoderExit(child) {
  let inputError = null;
  child.stdin?.on('error', error => { inputError = error; });
  return new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ error: inputError, code, signal }));
  });
}

function encoderExitError(result, index) {
  return new Error(`ffmpeg seg ${index} stopped before encoding completed (exit ${result.code ?? result.signal ?? 'unknown'})`, { cause: result.error });
}

function duringEncoding(step, finished, index) {
  return Promise.race([step, finished.then(result => { throw encoderExitError(result, index); })]);
}

function writeEncodedFrame(input, buffer, index) {
  return new Promise((resolve, reject) => {
    input.write(buffer, error => {
      if (error) reject(new Error(`ffmpeg seg ${index} input write failed`, { cause: error }));
      else resolve();
    });
  });
}

async function writeSegmentFrames(page, input, fps, startSec, seg, reuseFrames, onFrame) {
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
    await writeEncodedFrame(input, buf, seg.idx);
    onFrame(reused);
  }
}

async function renderSegmentToMp4(page, ffmpegBin, fps, encoderThreads, startSec, seg, reuseFrames, onFrame) {
  const tmpOut = `${seg.partPath}.${process.pid}.tmp.mp4`;
  const ffArgs = [
    '-y', '-loglevel', 'error',
    '-threads', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-threads', String(encoderThreads), '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    tmpOut,
  ];
  let ff;
  try { ff = spawn(ffmpegBin, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] }); }
  catch (error) { throw new Error(`Cannot start ffmpeg seg ${seg.idx}: ${ffmpegBin}`, { cause: error }); }
  const finished = observeEncoderExit(ff);
  try {
    // 每段只监听一次编码器退出，避免逐帧创建的竞争 Promise 保留已写出的截图。
    await duringEncoding(writeSegmentFrames(page, ff.stdin, fps, startSec, seg, reuseFrames, onFrame), finished, seg.idx);
    ff.stdin.end();
    const result = await finished;
    if (result.error || result.code !== 0) throw encoderExitError(result, seg.idx);
    fs.renameSync(tmpOut, seg.partPath);
  } finally {
    ff.stdin?.destroy();
    if (ff.exitCode === null && ff.signalCode === null) ff.kill();
    await finished;
    fs.rmSync(tmpOut, { force: true });
  }
}

async function renderMissingSegments({ misses, workerCount, cpuBudget, tmpDir, videoId, W, H, fps, lang, startSec, ffmpegBin, tStartWall, reuseFrames }) {
  if (!misses.length) return;
  const totalMissFrames = misses.reduce((a, s) => a + (s.f1 - s.f0), 0);
  const { groups, jobs } = buildRenderTasks(misses, workerCount, fps, tmpDir);
  const poolSize = Math.min(jobs.length, workerCount);
  // 每个任务为浏览器渲染和 JPEG 解码各留一份 CPU 预算，其余分给编码器。
  const encoderThreads = Math.max(1, Math.floor(cpuBudget / poolSize) - 2);
  const queue = jobs.slice();
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log(`  Parallel render: ${poolSize} workers, ${encoderThreads} encoder threads/worker, ${jobs.length} chunks (${misses.length} uncached segments, CPU budget ${cpuBudget})`);
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
    let firstError = null;
    await Promise.all(Array.from({ length: poolSize }, async () => {
      let page;
      try {
        page = await openRenderPage(browser, port, videoId, W, H, lang);
        while (queue.length > 0 && !firstError) {
          const seg = queue.shift();
          if (seg) await renderSegmentToMp4(page, ffmpegBin, fps, encoderThreads, startSec, seg, reuseFrames, onFrame);
        }
      } catch (error) {
        if (!firstError) {
          firstError = error;
          await browser.close().catch(() => {});
        }
      } finally {
        await page?.close().catch(() => {});
      }
    }));
    if (firstError) throw firstError;
    await mergeRenderParts(groups, ffmpegBin, tmpDir);
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
  muxArgs.push(...(canCopy ? ['-c:a', 'copy', '-shortest'] : ['-c:a', 'aac', '-b:a', audioBitrate || '160k', '-shortest']));
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
  muxArgs.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', audioBitrate || '160k', '-shortest');
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
    '-c:a', 'aac', '-b:a', audioBitrate || '160k', '-shortest'
  );
}

async function stitchSegmentsAndAudio(spec) {
  const { segments, tmpDir, ffmpegBin, hasAudio, audioPath, hasBgm, audioBitrate, isSlice, startSec, renderDur, outPath } = spec;
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const listFile = path.join(tmpDir, 'concat.txt');
  writeConcatList(listFile, segments);

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
  const outputExt = path.basename(outPath).match(/\.[^.]*$/)?.[0] || '';
  const tmpOut = path.join(path.dirname(outPath), `.html-video-${process.pid}-${crypto.randomUUID()}.tmp${outputExt}`);
  muxArgs.push('-movflags', '+faststart', tmpOut);
  try {
    await runFfmpeg(ffmpegBin, muxArgs);
    fs.renameSync(tmpOut, outPath);
  } finally {
    fs.rmSync(tmpOut, { force: true });
  }
}

function resolveTargetVideoId(pos) {
  const firstIsMp4 = pos.length === 1 && /\.mp4$/i.test(pos[0]);
  const defaultVideo = listVideoIds()[0] || 'starter';
  return firstIsMp4 ? defaultVideo : (pos[0] || defaultVideo);
}

export function resolveRenderConcurrency(totalFrames, opts, cpuCount = os.availableParallelism?.() || os.cpus().length) {
  const cpuBudget = Math.max(1, cpuCount - 1);
  const maxWorkers = Math.max(1, Math.floor(cpuBudget / 3));
  const frameBudget = Math.max(1, Math.ceil(totalFrames / ((opts.fps || 30) * 10)));
  const autoCap = opts.maxAutoWorkers == null ? 8 : Math.max(1, Math.floor(positiveRenderNumber(opts.maxAutoWorkers, 'render.maxAutoWorkers')));
  const autoWorkers = Math.min(8, maxWorkers, frameBudget, autoCap);
  const envWorkers = process.env.WORKERS ? Math.max(1, parseInt(process.env.WORKERS, 10) || 1) : null;
  return { workerCount: Math.min(totalFrames, maxWorkers, opts.workers || envWorkers || autoWorkers), cpuBudget };
}

function describeRenderAudio(hasAudio, hasBgm) {
  if (hasAudio) return hasBgm ? ' + audio+bgm' : ' + audio';
  return hasBgm ? ' + bgm' : ' (silent)';
}

function positiveRenderNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${label}: ${value}. Expected a finite positive number.`);
  }
  return number;
}

function renderDimension(value, label) {
  const number = positiveRenderNumber(value, label);
  if (!Number.isInteger(number) || number % 2 !== 0) {
    throw new Error(`${label} must be a positive even integer for MP4 output (received ${value}).`);
  }
  return number;
}

export function resolveStageSpec(V, cfg, opts) {
  return {
    W: renderDimension(cfg.width ?? 1920, 'Stage width'),
    H: renderDimension(cfg.height ?? 1080, 'Stage height'),
    FPS: positiveRenderNumber(opts.fps ?? (process.env.FPS || (cfg.fps ?? 30)), 'FPS'),
    scenes: V.scenes || [],
    fullDur: positiveRenderNumber(V.totalDuration ?? V.duration ?? 1, 'Video duration'),
    audioBitrate: cfg.audioBitrate || '160k',
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
  if (!Number.isSafeInteger(totalFrames)) throw new Error('Render frame count exceeds the supported integer range. Reduce the FPS or selected duration.');
  const { workerCount, cpuBudget } = resolveRenderConcurrency(totalFrames, { ...opts, fps: FPS, maxAutoWorkers: cfg.render?.maxAutoWorkers });

  const tmpDir = path.join(ROOT, '.runtime', `render-${VIDEO_ID}-${process.pid}`);
  const ffmpegBin = resolveFfmpeg(ROOT);
  const tStartWall = Date.now();

  try {
    const useSceneCache = !isSlice && !opts.noCache && scenes.length > 0;
    const segments = useSceneCache
      ? buildCachedSceneSegments(sandbox.V, cfg, VIDEO_ID, videoDir, totalFrames, W, H, FPS, opts.lang, media.outPath)
      : buildUncachedChunks(totalFrames, workerCount, tmpDir);
    const misses = segments.filter(s => !s.cached);
    const cacheInfo = useSceneCache ? ` [cache ${segments.length - misses.length}/${segments.length} scenes hit]` : '';

    console.log(
      `Rendering [${VIDEO_ID}] ${W}x${H} @ ${FPS}fps · ${totalFrames} frames ` +
      `(${startSec.toFixed(2)}s..${endSec.toFixed(2)}s)${cacheInfo}${describeRenderAudio(media.hasAudio, media.hasBgm)} -> ${media.outPath}`
    );

    await renderMissingSegments({
      misses, workerCount, cpuBudget, tmpDir, videoId: VIDEO_ID, W, H, fps: FPS, lang: opts.lang,
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

if (isMainModule(import.meta.url)) await runRenderCli();
