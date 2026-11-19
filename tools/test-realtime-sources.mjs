import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findBrowserExecutable, loadChromium, PKG_ROOT } from './lib/paths.mjs';
import { startVideoServer } from './server.mjs';

const runtime = path.join(PKG_ROOT, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const project = fs.mkdtempSync(path.join(runtime, 'realtime-sources-'));
const course = path.join(project, 'videos/demo');
fs.mkdirSync(course, { recursive: true });
fs.writeFileSync(path.join(course, 'index.html'), `<!doctype html><body>
<script src="../base/js/loading.js"></script><link rel="stylesheet" href="../base/css/base.css">
<script src="../base/js/engine.js"></script><script>
V.config = { width: 320, height: 180, audioSrc: false, bgm: false, ui: { persist: false, livePause: false } };
let host;
const source = V.iframeSource({ id: 'slow-3d', src: 'model.html', element: () => host,
  active: frame => frame.sceneIndex === 0 });
V.scene({ duration: 4, lines: [], build() {
  host = document.createElement('iframe');
  host.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none';
  document.getElementById('stage').append(host);
}, update(t, ctx) { source.setState({ time: ctx.frame.now }); } });
V.scene({ duration: 2, lines: [], build() {}, update() {} });
V.boot();
</script></body>`);
fs.writeFileSync(path.join(course, 'model.html'), `<!doctype html><body style="margin:0">
<canvas width="320" height="180"></canvas><script src="../base/js/frame-client.js"></script><script>
const gl = document.querySelector('canvas').getContext('webgl', { preserveDrawingBuffer: true });
if (!gl) throw new Error('This test requires WebGL');
const stats = window.stats = { started: [], committed: [], canceled: [], inFlight: 0, peak: 0 };

function waitForModel(delay, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
    function cancel() { clearTimeout(timer); reject(signal.reason); }
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

window.client = VFrameClient.connect({
  async prepare(state, frame, { signal }) {
    if (state.time !== frame.now) throw new Error('Frame does not match submitted state');
    const blocked = Boolean(window.blockRealtime && !frame.precise);
    stats.started.push({ id: frame.id, blocked });
    if (!frame.precise) stats.peak = Math.max(stats.peak, ++stats.inFlight);
    try {
      await waitForModel(blocked ? 10000 : 50, signal);
      if (signal.aborted) throw signal.reason;
      gl.clearColor(frame.now / 4, 0.2, 0.3, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      stats.committed.push({ id: frame.id, now: frame.now, precise: frame.precise, red: pixel[0] });
    } catch (error) {
      if (signal.aborted) stats.canceled.push(frame.id);
      throw error;
    } finally { if (!frame.precise) stats.inFlight--; }
  }
});
</script></body>`);

const server = await startVideoServer({ projectRoot: project });
let browser;
try {
  const chromium = await loadChromium(project);
  browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.origin + '/demo/');
  await page.waitForFunction(() => window.V?.getFrameState?.() && !document.getElementById('video-loading'));
  await page.locator('#viewport').click();
  await page.waitForFunction(() => V.player.getState().now >= 1.5);
  const playback = await page.evaluate(() => {
    const { stats } = document.querySelector('iframe').contentWindow;
    return { frames: stats.committed.filter(frame => !frame.precise),
      peak: stats.peak, now: V.player.getState().now, buffering: V.player.getState().buffering };
  });
  assert.ok(playback.frames.length >= 8, 'A renderer that takes 50 ms must keep committing frames during playback');
  assert.equal(playback.peak, 1, 'Playback must keep one active preparation per source');
  assert.equal(playback.buffering, false);
  const last = playback.frames.at(-1);
  assert.ok(playback.now - last.now < 0.3, 'The renderer must catch up to the latest time');
  assert.ok(last.red > playback.frames[0].red + 35, 'The actual WebGL pixels must advance during playback');
  assert.ok(playback.frames.slice(1).every((frame, i) => frame.id > playback.frames[i].id));
  assert.ok(playback.frames.slice(1).some((frame, i) => frame.id > playback.frames[i].id + 1),
    'The scheduler must drop intermediate frames without accumulating a backlog');

  await page.evaluate(() => { document.querySelector('iframe').contentWindow.blockRealtime = true; });
  const inFlight = await page.waitForFunction(() => {
    const child = document.querySelector('iframe').contentWindow;
    const started = child.stats.started.at(-1);
    return started.blocked && child.stats.inFlight && started.id;
  });
  const oldId = await inFlight.jsonValue();
  const target = await page.evaluate(async () => {
    V.player.pause();
    return V.seekToAsync(0.25);
  });
  const afterSeek = await page.evaluate(() => {
    const { stats, client } = document.querySelector('iframe').contentWindow;
    return { canceled: stats.canceled, frame: stats.committed.at(-1), acknowledged: client.frameId };
  });
  assert.ok(afterSeek.canceled.includes(oldId), 'An exact seek must cancel the in-flight preview');
  assert.deepEqual(afterSeek.frame, { id: target.id, now: 0.25, precise: true, red: 16 });
  assert.equal(afterSeek.acknowledged, target.id, 'Exact seek must wait for the target iframe frame');

  await page.evaluate(() => { V.player.seek(3.6); V.player.play(); });
  const beforeCut = await page.waitForFunction(() => {
    const child = document.querySelector('iframe').contentWindow;
    const started = child.stats.started.at(-1);
    return started.blocked && child.stats.inFlight && started.id;
  });
  const cutId = await beforeCut.jsonValue();
  await page.waitForFunction(id => {
    const host = document.querySelector('iframe');
    return V.getFrameState().sceneIndex === 1 && host.style.display === 'none' && host.contentWindow.stats.canceled.includes(id);
  }, cutId);
  assert.deepEqual(errors, []);
  console.log('WebGL playback submitted ' + playback.frames.length + ' frames in ' + playback.now.toFixed(2) +
    ' s (peak ' + playback.peak + ' pending, red channel ' + playback.frames[0].red + ' → ' + last.red +
    '), and canceled stale work on exact seek and scene change.');
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
