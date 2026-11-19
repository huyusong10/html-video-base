import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { withAuditSession } from './audit-session.mjs';
import { bundleSingleVideo } from './bundle.mjs';
import { PKG_ROOT } from './lib/paths.mjs';
import { exportPptx } from './pptx.mjs';
import { prepareEditablePage } from './lib/pptx-editable.mjs';

async function checkPptxDownloads(page, decks) {
  assert.equal(await page.locator('#controls [data-act=subs]').count(), 0);
  for (const [mode, deck] of Object.entries(decks)) {
    await page.getByRole('button', { name: '下载 PPTX' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`#controls .pptx-download-option[data-pptx-mode="${mode}"]`).click(),
    ]);
    assert.equal(download.suggestedFilename(), mode === 'image' ? 'demo.pptx' : 'demo-editable.pptx');
    assert.deepEqual(fs.readFileSync(await download.path()), deck);
  }
}

async function checkVideoToolbar(page) {
  assert.equal(await page.locator('#controls .ctrl-pptx-download, #controls .pptx-wrap').count(), 0);
}

async function checkChartPackage(bytes) {
  const deck = await JSZip.loadAsync(bytes);
  const chart = await deck.file(/^ppt\/charts\/chart\d+\.xml$/)[0].async('string');
  const groups = [...chart.matchAll(/<c:lineChart>(.*?)<\/c:lineChart>/gs)].map(([, body]) => body);
  assert.deepEqual(groups.map(body => [...body.matchAll(/<c:ser>/g)].length), [2, 1]);
  assert.ok(groups.every(body => [...body.matchAll(/<c:axId /g)].length === 2));
  assert.match(chart, /<c:pt idx="0"><c:v>0<\/c:v><\/c:pt>/);
  const book = await JSZip.loadAsync(await deck.file(/^ppt\/embeddings\/.*\.xlsx$/)[0].async('nodebuffer'));
  assert.match(await book.file('xl/tables/table1.xml').async('string'), /ref="A1:D4"/);
  const sheet = await book.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet, /<c r="B2"><v>0<\/v><\/c><c r="C2"\/>/);
}

test('PPTX uses PPT pages and can be downloaded in preview and in a static bundle', { timeout: 120000 }, async t => {
  const runtime = path.join(PKG_ROOT, '.runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const root = fs.mkdtempSync(path.join(runtime, 'pptx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const course = path.join(root, 'videos/demo');
  fs.mkdirSync(course, { recursive: true });
  fs.writeFileSync(path.join(course, 'index.html'), `<!doctype html><html><head>
    <link rel="stylesheet" href="../base/css/base.css"></head><body>
    <script src="../base/js/engine.js"></script><script src="video.config.js"></script>
    <script src="scenes.js"></script><script>V.boot()</script></body></html>`);
  fs.writeFileSync(path.join(course, 'video.config.js'), `V.config = {
    id: 'demo', lang: 'zh-CN', ppt: true, width: 640, height: 360, audioSrc: false, bgm: false,
    ui: { controlsMode: 'docked', persist: false }, sceneScripts: ['scenes.js']
  };`);
  fs.writeFileSync(path.join(course, 'scenes.js'), `
    V.scene({ title: 'Hidden', pptSkip: true, lines: [], build() {}, update() {} });
    V.scene({ title: 'Demo', lines: ['One', 'Two'],
      pptFrames: [{ lt: 0.1, text: 'First note' }, { lt: 0.2, text: 'Second note' }],
      build(root) {
        root.innerHTML = '<span data-pptx-native="text">Slide fixture</span>'
          + '<svg data-pptx-native="svg" width="160" height="90"><rect x="5" y="5" width="75" height="40" fill="#4488aa"/></svg>'
          + '<div data-pptx-native="chart" style="width:240px;height:100px"></div>';
        root.querySelector('[data-pptx-native=chart]').dataset.pptxChart = JSON.stringify({
          labels: ['A', 'B', 'C'],
          axes: [{ min: 0, max: 10, step: 2, unit: '°C' }, { min: 0, max: 100, step: 20, unit: '%' }],
          series: [
            { name: 'Primary A', color: '4488AA', values: [0, 1, 2] },
            { name: 'Primary B', color: '8844AA', values: [null, 4, 8] },
            { name: 'Secondary', color: 'AA8844', values: [10, 40, 80], axis: 1 },
          ],
        });
      },
      update() {} });
  `);

  await withAuditSession({ projectRoot: root }, async audit => {
    const video = await audit.openVideo('demo', { mode: 'ppt-capture' });
    const pages = await video.page.evaluate(() => V.player.getPptPages());
    assert.deepEqual(pages.map(page => page.text), ['First note', 'Second note']);
    const { frame } = await video.capture(pages[1].globalT);
    assert.equal(frame.isRecord, true);
    assert.equal(frame.pptMode, true);
    assert.equal(frame.sceneIndex, 1);
    const captured = await video.page.evaluateHandle(prepareEditablePage);
    assert.deepEqual(await captured.evaluate(result => result.objects.map(object => object.type)), ['text', 'shape', 'chart']);
    const tag = video.page.locator('span[data-pptx-native]');
    assert.equal(await tag.isVisible(), false);
    await captured.evaluate(result => result.restore());
    await captured.dispose();
    assert.equal(await tag.isVisible(), true);
    const preview = await audit.openPage('/demo/?ppt=1');
    assert.equal(await preview.locator('#controls .ctrl-pptx-download').count(), 0);
    assert.equal(await preview.locator('#controls [data-act=subs]').count(), 0);
  });

  const output = path.join(course, 'assets/presentation.pptx');
  assert.equal(await exportPptx({ projectRoot: root, videoId: 'demo', output, pages: '2' }), 1);
  const editableOutput = path.join(course, 'assets/presentation-editable.pptx');
  assert.equal(await exportPptx({ projectRoot: root, videoId: 'demo', output: editableOutput, pages: '2', mode: 'editable' }), 1);
  const decks = { image: fs.readFileSync(output), editable: fs.readFileSync(editableOutput) };
  assert.equal(decks.image.readUInt32LE(0), 0x04034b50);
  assert.equal(decks.editable.readUInt32LE(0), 0x04034b50);
  await checkChartPackage(decks.editable);

  await withAuditSession({ projectRoot: root }, async audit => {
    await checkPptxDownloads(await audit.openPage('/demo/?ppt=1'), decks);
    const video = await audit.openPage('/demo/');
    await checkVideoToolbar(video);
    const subs = video.locator('#controls [data-act=subs]');
    assert.equal(await subs.getAttribute('title'), '字幕');
    const icon = await subs.innerHTML();
    await subs.evaluate(button => button.click());
    assert.equal(await subs.getAttribute('aria-expanded'), 'true');
    assert.equal(await video.evaluate(() => V.getFrameState().subsEnabled), true);
    await video.getByRole('checkbox', { name: '显示字幕' }).uncheck();
    assert.equal(await video.evaluate(() => V.getFrameState().subsEnabled), false);
    assert.notEqual(await subs.innerHTML(), icon);
    assert.equal(await subs.getAttribute('title'), '字幕');
  });

  const publishRoot = path.join(root, 'publish');
  const bundled = bundleSingleVideo('demo', path.join(publishRoot, 'videos/demo'), root);
  const entry = fs.readFileSync(path.join(bundled, 'index.html'), 'utf8');
  assert.match(entry, /data-pptx-mode="image".*presentation\.pptx/);
  assert.match(entry, /data-pptx-mode="editable".*presentation-editable\.pptx/);
  await withAuditSession({ projectRoot: publishRoot }, async audit => {
    await checkPptxDownloads(await audit.openPage('/demo/?ppt=1'), decks);
    await checkVideoToolbar(await audit.openPage('/demo/'));
  });
});
