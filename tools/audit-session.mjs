import path from 'node:path';
import { ROOT, loadChromium, findBrowserExecutable } from './lib/paths.mjs';
import { startVideoServer } from './server.mjs';
import { readVideoMetadata } from './content.mjs';
import { captureBatch } from './audit-capture.mjs';

function collectIssues(page, issues, id) {
  page.on('pageerror', error => issues.push({ level: 'error', code: 'PAGE_ERROR', videoId: id, message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error' && /Frame source ".*" failed/.test(message.text())) {
      issues.push({ level: 'error', code: 'FRAME_ERROR', videoId: id, message: message.text() });
    }
  });
  page.on('response', response => {
    const url = response.url();
    if (response.status() < 400 || /\/(soundtrack|bgm|timings)(\.|\/)|\/favicon.ico/.test(url)) return;
    issues.push({ level: 'error', code: 'HTTP_ERROR', videoId: id, message: `HTTP ${response.status()}: ${url}` });
  });
}

async function videoMetadata(page, metadata) {
  const layout = await page.evaluate(() => ({
    duration: V.duration,
    timingSource: V.layoutInfo ? V.layoutInfo.source : 'unknown',
    scenes: V.scenes.map(sc => ({ title: sc.title, start: sc.start, duration: sc.duration,
      cues: sc.cues.map(c => ({ start: c.start, end: c.end, text: c.text })) })),
  }));
  return { ...metadata, duration: layout.duration, layout: { source: 'browser', timingSource: layout.timingSource },
    scenes: layout.scenes.map((scene, index) => ({ ...metadata.scenes[index], ...scene })) };
}

async function seekFrame(page, time, issues, id) {
  if (!Number.isFinite(time)) throw new TypeError('seek time must be finite');
  try { return await page.evaluate(t => V.seekToAsync(t), time); }
  catch (error) {
    issues.push({ level: 'error', code: 'FRAME_ERROR', videoId: id, time, message: error.message });
    throw error;
  }
}

function videoHandle(page, metadata, issues, id, pages) {
  let queue = Promise.resolve();
  const enqueue = work => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const capture = async (time, options = {}) => {
    const frame = await seekFrame(page, time, issues, id);
    const image = await page.screenshot({ ...options, type: 'png', caret: 'initial' });
    return { frame, image };
  };
  return {
    page, metadata,
    get issues() { return issues.map(issue => ({ ...issue })); },
    seek(time) { return enqueue(() => seekFrame(page, time, issues, id)); },
    capture(time, options = {}) {
      return enqueue(() => capture(time, options));
    },
    captureMany(points, options = {}) { return enqueue(() => captureBatch(points, options, capture)); },
    async close() { await queue; await page.close(); pages.delete(page); },
  };
}

async function openVideo(browser, server, pages, projectRoot, id, options) {
  const { mode = 'record', lang = '' } = options;
  if (!['record', 'interactive', 'ppt'].includes(mode)) throw new TypeError(`Unknown audit mode: ${mode}`);
  const metadata = readVideoMetadata({ projectRoot, id, lang });
  const cfg = metadata.config;
  const page = await browser.newPage({ viewport: { width: cfg.width || 1920, height: cfg.height || 1080 }, deviceScaleFactor: 1 });
  pages.add(page);
  const issues = [];
  collectIssues(page, issues, id);
  const query = new URLSearchParams({ autoplay: '0' });
  if (mode === 'record') query.set('record', '1');
  if (mode === 'ppt') query.set('ppt', '1');
  if (lang) query.set('lang', lang);
  try {
    await page.goto(`${server.origin}/${encodeURIComponent(id)}/?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.V?.getFrameState?.() && window.__video);
    await page.evaluate(async () => { __video.pause(); await document.fonts.ready; });
    return videoHandle(page, await videoMetadata(page, metadata), issues, id, pages);
  } catch (error) { await page.close(); pages.delete(page); throw new Error(`Cannot open video "${id}": ${error.message}; ${issues.map(issue => issue.message).join("; ")}`, { cause: error }); }
}

export async function withAuditSession({ projectRoot = ROOT, headless = true } = {}, callback) {
  projectRoot = path.resolve(projectRoot);
  const server = await startVideoServer({ projectRoot });
  const pages = new Set();
  let browser;
  try {
    const chromium = await loadChromium(projectRoot);
    browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless,
      args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    return await callback({ origin: server.origin,
      async openPage(pathname = '/', options = {}) {
        const page = await browser.newPage(options);
        try {
          await page.goto(new URL(pathname, server.origin).href, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);
          return page;
        } catch (error) { await page.close(); throw error; }
      },
      openVideo: (id, options = {}) => openVideo(browser, server, pages, projectRoot, id, options) });
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
}
