// 无头视频导出引擎：多进程分片并行渲染 + 按幕 SHA-256 内容哈希增量缓存 + 受控 <video>/静态图解码等待
// 用法：html-video render [video-id] [output.mp4] [--workers 4] [--scene 0] [--range 5:15] [--fps 30] [--lang en] [--no-cache]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ROOT, VIDEOS_DIR, listVideoIds, loadVideoSandbox, resolveBaseFile,
  loadChromium, findBrowserExecutable, resolveFfmpeg,
} from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

const OPT_HANDLERS = {
  '--workers': (o, v) => { o.workers = Math.max(1, parseInt(v, 10) || 1); },
  '--scene': (o, v) => { o.scene = parseInt(v, 10); },
  '--range': (o, v) => { o.range = v; },
  '--fps': (o, v) => { o.fps = Number(v); },
  '--lang': (o, v) => { o.lang = v; },
};

function parseRenderArgs(argv) {
  const opts = { workers: null, scene: null, range: null, fps: null, lang: '', noCache: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-cache') { opts.noCache = true; continue; }
    if (OPT_HANDLERS[a] && i + 1 < argv.length) { OPT_HANDLERS[a](opts, argv[++i]); continue; }
    if (!a.startsWith('--')) pos.push(a);
  }
  return { opts, pos };
}

function resolveAudioFile(videoDir, sandbox, cfg, audioRelDefault) {
  if (cfg.audioSrc === false) return { audioPath: null, hasAudio: false };
  const audioRel = (sandbox.V.voice && sandbox.V.voice.src) || audioRelDefault || 'assets/soundtrack.m4a';
  const audioPath = path.join(videoDir, audioRel);
  return { audioPath, hasAudio: fs.existsSync(audioPath) };
}

function buildRenderSuffix(opts) {
  let suffix = opts.lang ? `.${opts.lang}` : '';
  if (opts.scene != null && !Number.isNaN(opts.scene)) return `${suffix}-s${String(opts.scene).padStart(2, '0')}`;
  if (opts.range) return `${suffix}-range`;
  return suffix;
}

function resolveOutAndAudio(videoId, videoDir, sandbox, cfg, opts, pos, audioRelDefault) {
  const { audioPath, hasAudio } = resolveAudioFile(videoDir, sandbox, cfg, audioRelDefault);
  const firstIsMp4 = Boolean(pos[0] && pos[0].endsWith('.mp4'));
  const suffix = buildRenderSuffix(opts);
  const baseName = cfg.outputName || `${videoId}.mp4`;
  const defaultOutName = suffix ? baseName.replace(/\.mp4$/i, `${suffix}.mp4`) : baseName;
  const outPath = firstIsMp4 ? path.resolve(pos[0]) : path.resolve(pos[1] || path.join(ROOT, defaultOutName));
  return { outPath, audioPath, hasAudio };
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

function hashFilesInDir(h, dir, extFilter) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const fp = path.join(dir, name);
    if (fs.statSync(fp).isFile() && (!extFilter || extFilter(name))) {
      h.update(name);
      h.update(fs.readFileSync(fp));
    }
  }
}

function computeSharedVideoDigest(videoDir, W, H, fps, lang) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ v: '2.0', W, H, fps, lang }));
  for (const rel of ['css/base.css', 'js/engine.js', 'js/gl.js']) {
    const fp = resolveBaseFile(rel, VIDEOS_DIR);
    if (fs.existsSync(fp)) h.update(fs.readFileSync(fp));
  }
  for (const rel of ['index.html', 'video.config.js', `locales/${lang}.js`]) {
    const fp = path.join(videoDir, rel);
    if (fs.existsSync(fp)) h.update(fs.readFileSync(fp));
  }
  hashFilesInDir(h, path.join(videoDir, 'css'), n => n.endsWith('.css'));
  hashFilesInDir(h, path.join(VIDEOS_DIR, 'themes'), n => n.endsWith('.css') || n.endsWith('.js'));
  const compJs = path.join(videoDir, 'js/components.js');
  if (fs.existsSync(compJs)) h.update(fs.readFileSync(compJs));
  return h.digest('hex');
}

function serializeSceneCode(V, sc) {
  if (!sc) return '';
  const parts = [
    sc.id, sc.title, sc.transition, sc.transitionDur,
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

function buildCachedSceneSegments(V, videoId, videoDir, totalFrames, W, H, fps, lang) {
  const scenes = V.scenes || [];
  const sharedHash = computeSharedVideoDigest(videoDir, W, H, fps, lang);
  const cacheDir = path.join(ROOT, '.runtime/render-cache', videoId);
  fs.mkdirSync(cacheDir, { recursive: true });

  const bounds = scenes.map((sc, i) => (i === 0 ? 0 : Math.min(totalFrames, Math.round(sc.start * fps))));
  bounds.push(totalFrames);

  const segments = [];
  for (let si = 0; si < scenes.length; si++) {
    const f0 = bounds[si];
    const f1 = Math.max(f0, bounds[si + 1]);
    if (f1 <= f0) continue;
    const sc = scenes[si];
    const prevSc = si > 0 && Number(sc.transitionDur || 0) > 0 ? scenes[si - 1] : null;
    const h = crypto.createHash('sha256');
    h.update(sharedHash);
    h.update(serializeSceneCode(V, sc));
    h.update(serializeSceneCode(V, prevSc));
    h.update(JSON.stringify({
      frames: f1 - f0,
      phase: Math.round((f0 / fps - sc.start) * 10000),
      dur: sc.duration,
      cues: sc.cues,
      subCues: sc.subCues,
      env: V.voice && V.voice.envelopes ? V.voice.envelopes[si] : null,
      glKeys: V.glKeys || null,
    }));
    const digest = h.digest('hex').slice(0, 16);
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

async function openRenderPage(browser, port, videoId, W, H, lang) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const q = lang ? `?record=1&lang=${encodeURIComponent(lang)}` : '?record=1';
  await page.goto(`http://127.0.0.1:${port}/${videoId}/${q}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  return page;
}

async function renderSegmentToMp4(page, ffmpegBin, fps, startSec, seg, onFrame) {
  const tmpOut = `${seg.partPath}.${process.pid}.tmp.mp4`;
  const ffArgs = [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    tmpOut,
  ];
  const ff = spawn(ffmpegBin, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = seg.f0; f < seg.f1; f++) {
    const sec = startSec + f / fps;
    await page.evaluate(s => window.V.seekToAsync(s), sec);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    onFrame();
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg seg ${seg.idx} exit ${code}`)))));
  fs.renameSync(tmpOut, seg.partPath);
}

async function renderMissingSegments({ misses, workerCount, videoId, W, H, fps, lang, startSec, ffmpegBin, tStartWall }) {
  if (!misses.length) return;
  const totalMissFrames = misses.reduce((a, s) => a + (s.f1 - s.f0), 0);
  const poolSize = Math.min(misses.length, workerCount);
  const queue = misses.slice();
  let doneFrames = 0;

  const { srv, port } = await startEphemeralVideoServer();
  const chromium = await loadChromium(ROOT);
  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });

  const onFrame = () => {
    doneFrames++;
    if (doneFrames % Math.max(1, fps * 2) === 0 || doneFrames === totalMissFrames) {
      const elapsed = Math.max(0.1, (Date.now() - tStartWall) / 1000);
      const pct = ((doneFrames / totalMissFrames) * 100).toFixed(1);
      process.stdout.write(`\r  frame ${doneFrames}/${totalMissFrames} (${pct}% · ${(doneFrames / elapsed).toFixed(1)} fps)`);
    }
  };

  try {
    await Promise.all(Array.from({ length: poolSize }, async () => {
      const page = await openRenderPage(browser, port, videoId, W, H, lang);
      while (queue.length > 0) {
        const seg = queue.shift();
        if (seg) await renderSegmentToMp4(page, ffmpegBin, fps, startSec, seg, onFrame);
      }
      await page.close();
    }));
    process.stdout.write('\n');
  } finally {
    await browser.close();
    srv.close();
  }
}

async function stitchSegmentsAndAudio({ segments, tmpDir, ffmpegBin, hasAudio, audioPath, isSlice, startSec, renderDur, outPath }) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const listFile = path.join(tmpDir, 'concat.txt');
  const listBody = segments.map(s => `file '${s.partPath.replace(/\\/g, '/')}'`).join('\n') + '\n';
  fs.writeFileSync(listFile, listBody, 'utf8');

  const muxArgs = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (hasAudio) {
    if (isSlice) muxArgs.push('-ss', startSec.toFixed(3), '-t', renderDur.toFixed(3));
    muxArgs.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy');
    muxArgs.push(...(isSlice ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-c:a', 'copy', '-shortest']));
  } else {
    muxArgs.push('-c:v', 'copy');
  }
  muxArgs.push('-movflags', '+faststart', outPath);
  await runFfmpeg(ffmpegBin, muxArgs);
}

const { opts, pos } = parseRenderArgs(process.argv.slice(2));
const firstIsMp4 = Boolean(pos[0] && pos[0].endsWith('.mp4'));
const defaultVideo = listVideoIds()[0] || 'starter';
const VIDEO_ID = firstIsMp4 ? defaultVideo : (pos[0] || defaultVideo);

const { sandbox, videoDir, audioRel } = loadVideoSandbox(ROOT, VIDEO_ID, { ignoreBaked: false, requireTimings: false, lang: opts.lang });
const cfg = Object.assign({}, sandbox.V.themeDefaults || {}, sandbox.V.config || {});
const W = cfg.width || 1920;
const H = cfg.height || 1080;
const FPS = Number(opts.fps || process.env.FPS || cfg.fps || 30);

const { outPath, audioPath, hasAudio } = resolveOutAndAudio(VIDEO_ID, videoDir, sandbox, cfg, opts, pos, audioRel);
const scenes = sandbox.V.scenes || [];
const fullDur = sandbox.V.totalDuration || sandbox.V.duration || 1;
const { startSec, endSec, isSlice } = resolveTimeWindow(scenes, fullDur, hasAudio, opts);
const renderDur = Math.max(1 / FPS, endSec - startSec);
const totalFrames = Math.max(1, Math.ceil(renderDur * FPS));

const autoWorkers = totalFrames >= 120 ? Math.min(4, Math.max(1, os.cpus().length - 1)) : 1;
const envWorkers = process.env.WORKERS ? Math.max(1, parseInt(process.env.WORKERS, 10) || 1) : null;
const workerCount = Math.min(totalFrames, opts.workers || envWorkers || autoWorkers);

const tmpDir = path.join(ROOT, '.runtime', `render-${VIDEO_ID}-${process.pid}`);
const ffmpegBin = resolveFfmpeg(ROOT);
const tStartWall = Date.now();

try {
  const useSceneCache = !isSlice && !opts.noCache && scenes.length > 0;
  const segments = useSceneCache
    ? buildCachedSceneSegments(sandbox.V, VIDEO_ID, videoDir, totalFrames, W, H, FPS, opts.lang)
    : buildUncachedChunks(totalFrames, workerCount, tmpDir);
  const misses = segments.filter(s => !s.cached);
  const hitCount = segments.length - misses.length;
  const cacheInfo = useSceneCache ? ` [cache ${hitCount}/${segments.length} scenes hit]` : '';

  console.log(
    `Rendering [${VIDEO_ID}] ${W}x${H} @ ${FPS}fps · ${totalFrames} frames ` +
    `(${startSec.toFixed(2)}s..${endSec.toFixed(2)}s)${cacheInfo}${hasAudio ? ' + audio' : ' (silent)'} -> ${outPath}`
  );

  await renderMissingSegments({
    misses,
    workerCount,
    videoId: VIDEO_ID,
    W,
    H,
    fps: FPS,
    lang: opts.lang,
    startSec,
    ffmpegBin,
    tStartWall,
  });

  await stitchSegmentsAndAudio({
    segments,
    tmpDir,
    ffmpegBin,
    hasAudio,
    audioPath,
    isSlice,
    startSec,
    renderDur,
    outPath,
  });

  console.log(`Done in ${((Date.now() - tStartWall) / 1000).toFixed(1)}s: ${outPath}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
