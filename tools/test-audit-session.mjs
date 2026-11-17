import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './lib/paths.mjs';
import { withAuditSession } from './audit-session.mjs';

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/audit-session-'));
const videoDir = path.join(root, 'videos/demo');
fs.mkdirSync(videoDir, { recursive: true });
fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), "V.config={width:320,height:180,fps:4,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:['scenes.js']};");
fs.writeFileSync(path.join(videoDir, 'scenes.js'), "V.scene({id:'only',title:'Only',duration:1,lines:[],build(root){root.textContent='Tiny fixture';},update(){}});");

async function failedImage(page, pathname, reason) {
  await page.route('**' + pathname, route => route.abort(reason));
  const failed = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith(pathname) });
  await page.evaluate(source => new Promise(resolve => {
    const image = document.createElement('img');
    image.onerror = () => resolve();
    image.src = source;
    document.getElementById('stage').appendChild(image);
  }), pathname);
  await failed;
}

test('audit sessions report failed resources, clean failed opens and cancel captures on close', { timeout: 20000 }, async () => {
  let origin;
  await withAuditSession({ projectRoot: root }, async audit => {
    origin = audit.origin;
    const network = await audit.openVideo('demo');
    await failedImage(network.page, '/required-network.png', 'failed');
    assert.ok(network.issues.some(issue => issue.code === 'REQUEST_FAILED' && issue.message.includes('required-network.png')));
    const count = network.issues.length;
    await failedImage(network.page, '/cancelled.png', 'aborted');
    await failedImage(network.page, '/soundtrack.m4a', 'failed');
    assert.equal(network.issues.length, count, 'Cancelled and optional requests must not become audit failures');
    const browser = network.page.context().browser();
    await network.close();
    const contexts = browser.contexts().length;
    await assert.rejects(audit.openPage('http://127.0.0.1:0/'), /page.goto:/);
    assert.equal(browser.contexts().length, contexts, 'A failed page open must release its owned context');

    const hanging = await audit.openVideo('demo');
    await hanging.page.evaluate(() => {
      V.frameSource({ id: 'hanging', element: () => document.getElementById('stage'), timeoutMs: 10000,
        prepare() { window.fixtureFrameStarted = true; return new Promise(() => {}); } });
    });
    const active = hanging.seek(0.25);
    await hanging.page.waitForFunction(() => window.fixtureFrameStarted);
    const queued = hanging.capture(0.75);
    const closing = hanging.close();
    assert.equal(hanging.close(), closing, 'Repeated close calls must return the same promise');
    await Promise.all([
      assert.rejects(active, { name: 'AbortError' }),
      assert.rejects(queued, { name: 'AbortError' }),
      closing,
    ]);
    assert.equal(hanging.page.isClosed(), true);
    await assert.rejects(hanging.seek(0.2), { name: 'AbortError' });
    await assert.rejects(hanging.capture(0.2), { name: 'AbortError' });
    await assert.rejects(hanging.captureMany([0.2]), { name: 'AbortError' });

    const callback = await audit.openVideo('demo');
    const outDir = path.join(root, 'saved-before-close');
    let callbacks = 0;
    await assert.rejects(callback.captureMany([0.1, 0.2], {
      outDir,
      onCapture() { callbacks++; return callback.close(); },
    }), { name: 'AbortError' });
    await callback.close();
    assert.equal(callback.page.isClosed(), true);
    assert.equal(callbacks, 1, 'Closing in onCapture must prevent the next capture');
    const saved = fs.readdirSync(outDir);
    assert.equal(saved.length, 1);
    assert.ok(fs.statSync(path.join(outDir, saved[0])).size > 0, 'Closing must retain an already saved PNG');
  });
  await assert.rejects(fetch(origin), 'The session must close the static server');
});
