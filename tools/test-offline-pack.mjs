import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { bundleSingleVideo } from './bundle.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';
import { PKG_ROOT, findBrowserExecutable, loadChromium } from './lib/paths.mjs';

function makeFixtureRoot() {
  const runtime = path.join(PKG_ROOT, '.runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const root = fs.mkdtempSync(path.join(runtime, 'offline-pack-'));
  const videoDir = path.join(root, 'videos', 'demo');
  fs.mkdirSync(path.join(videoDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'index.html'), [
    '<!doctype html><html><head><meta charset="utf-8"><title>Demo</title>',
    '<link rel="stylesheet" href="../base/css/base.css">',
    '<style>#hud,#subs,#start-hint{display:none!important}iframe{width:320px;height:180px;border:0}</style>',
    '</head><body>',
    '<script src="../base/js/engine.js"></script>',
    '<script src="video.config.js"></script>',
    '<script src="js/scenes.js"></script>',
    '<script>V.boot()</script>',
    '</body></html>',
  ].join('\n'), 'utf8');
  fs.writeFileSync(
    path.join(videoDir, 'video.config.js'),
    'V.config={id:"demo",title:"Demo 中文",width:320,height:180,fps:2,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:["js/scenes.js"]};',
    'utf8'
  );
  fs.writeFileSync(path.join(videoDir, 'js', 'scenes.js'), `
    let host;
    const childSource = V.iframeSource({ id: 'child', src: 'child.html', element: () => host, startup: true });
    V.scene({
      duration: 1,
      lines: [],
      build(rootEl) {
        host = document.createElement('iframe');
        rootEl.append(host);
      },
      update(t) {
        childSource.setState({ color: t < 0.5 ? '#00dd44' : '#ff2255' });
      },
    });
  `, 'utf8');
  fs.writeFileSync(path.join(videoDir, 'child.html'), `<!doctype html><body><script src="../base/js/frame-client.js"></script><script>
    window.client = VFrameClient.connect({
      initialize() { return Promise.resolve(); },
      prepare(state) { document.body.style.background = state.color; },
    });
  </script></body>`, 'utf8');
  return root;
}

async function extractZipToDir(zipPath, targetDir) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = [];
  for (const [rel, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    names.push(rel);
    const out = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await entry.async('nodebuffer'));
  }
  return names;
}

async function verifyHttpBundleAndDownload(browser, webRoot, downloadZipPath) {
  const { srv, port } = await startEphemeralVideoServer({ videosDir: webRoot });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    try {
      await page.goto(`http://127.0.0.1:${port}/default/index.html`, { waitUntil: 'load' });
      assert.equal(await page.locator('[data-act="offline-pack"]').count(), 0, 'Default bundle must hide offline button');

      await page.goto(`http://127.0.0.1:${port}/optin/index.html`, { waitUntil: 'load' });
      const btn = page.locator('[data-act="offline-pack"]');
      assert.equal(await btn.count(), 1, 'Opt-in bundle must render offline pack button');
      const [download] = await Promise.all([page.waitForEvent('download'), btn.click()]);
      assert.equal(download.suggestedFilename(), 'demo-offline.zip');
      await download.saveAs(downloadZipPath);
    } finally {
      await page.close();
    }
  } finally {
    srv.closeAllConnections();
    await new Promise(resolve => srv.close(resolve));
  }
}

async function verifyExtractedFilePlayback(browser, extractedCourseDir) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    const fileUrl = new URL(`file:///${extractedCourseDir.replaceAll('\\', '/')}/index.html`).toString();
    await page.goto(fileUrl, { waitUntil: 'load' });
    assert.equal(await page.locator('[data-act="offline-pack"]').count(), 0, 'file:// playback must hide offline button');
    await page.evaluate(() => V.seekToAsync(0.8));
    const childFrame = page.frames().find(f => f !== page.mainFrame());
    assert.ok(childFrame, 'Expected child iframe under file://');
    await childFrame.waitForFunction(() => document.body.style.background === 'rgb(255, 34, 85)');
    assert.deepEqual(errors, [], `file:// iframe playback must produce zero errors, got: ${errors.join('; ')}`);
  } finally {
    await page.close();
  }
}

const root = makeFixtureRoot();
try {
  const webRoot = path.join(root, 'web');
  const defaultOut = path.join(webRoot, 'default');
  const optInOut = path.join(webRoot, 'optin');
  bundleSingleVideo('demo', defaultOut, root);
  assert.equal(fs.existsSync(path.join(defaultOut, 'offline-manifest.json')), false);
  assert.equal(fs.readFileSync(path.join(defaultOut, 'index.html'), 'utf8').includes('data-offline-pack'), false);

  bundleSingleVideo('demo', optInOut, root, { offlinePack: true });
  assert.equal(fs.existsSync(path.join(optInOut, 'offline-manifest.json')), true);
  const optInHtml = fs.readFileSync(path.join(optInOut, 'index.html'), 'utf8');
  assert.ok(optInHtml.includes('data-offline-pack') && optInHtml.includes('data-offline-unzip-guard'));

  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: findBrowserExecutable() });
  try {
    const zipPath = path.join(root, 'downloaded.zip');
    await verifyHttpBundleAndDownload(browser, webRoot, zipPath);
    const extractDir = path.join(root, 'unzipped');
    const entries = await extractZipToDir(zipPath, extractDir);
    assert.ok(entries.includes('demo-offline/index.html'));
    assert.equal(entries.some(e => e.endsWith('offline-manifest.json')), false);
    assert.deepEqual(
      fs.readFileSync(path.join(extractDir, 'demo-offline/video.config.js')),
      fs.readFileSync(path.join(optInOut, 'video.config.js'))
    );
    await verifyExtractedFilePlayback(browser, path.join(extractDir, 'demo-offline'));
  } finally {
    await browser.close();
  }
  console.log('✅ Offline pack opt-in, ZIP build, and file:// iframe playback PASSED.');
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
