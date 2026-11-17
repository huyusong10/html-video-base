import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, resolveFfmpeg } from './lib/paths.mjs';
import { startVideoServer } from './server.mjs';
import { withAuditSession } from './audit-session.mjs';

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/frame-interfaces-'));
const dir = path.join(root, 'videos/demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><style>#controls,#hud,#subs,#start-hint{display:none!important}iframe{border:0;width:320px;height:180px}</style><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,fps:4,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(dir, 'scenes.js'), `(function(){
V.config={width:320,height:180,fps:4,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:['scenes.js']};
let screen;
window.framesSeen=[];
const remove=V.frameSource({id:'screen',element:()=>screen,timeoutMs:100,active:()=>!window.inactive,
 async prepare(frame,{signal}){
  if(window.fail) await new Promise(()=>{});
  await new Promise(resolve=>setTimeout(resolve,frame.now<0.5?25:2));
  if(signal.aborted) throw new DOMException('Cancelled','AbortError');
  screen.contentDocument.body.style.background=frame.now<0.5?'#00dd44':'#ff2255';
 }});
window.removeSource=remove;
V.layer({id:'test',update(state,info){window.layerFrame=info.frame;}});
V.use({onRender(info){window.hookFrame=info.frame;}});
V.scene({duration:1,lines:[],build(root){screen=document.createElement('iframe');screen.srcdoc='<body style="margin:0"></body>';root.append(screen);},
 update(t,x){window.sceneFrame=x.frame;window.framesSeen.push(x.frame.id);}});
})();
`);

await withAuditSession({ projectRoot: root }, async audit => {
  const video = await audit.openVideo('demo');
  await video.page.frames()[1].waitForLoadState();
  const a = await video.capture(0.1);
  const b = await video.capture(0.8);
  assert.ok(!a.image.equals(b.image), 'External iframe pixels must change');
  await video.seek(0.3);
  assert.ok(a.image.equals((await video.capture(0.1)).image), 'Backward seek must restore the exact prepared frame');
  assert.equal(await video.page.evaluate(() => sceneFrame === layerFrame && layerFrame === hookFrame && Object.isFrozen(sceneFrame.pointer)), true);
  assert.equal(a.frame.clock, a.frame.now);
  assert.equal(a.frame.uiDt, 0);
  assert.equal(a.frame.pointer.inside, false);
  const race = await video.page.evaluate(async () => {
    const first = V.seekToAsync(0.1).catch(error => error.name);
    const second = V.seekToAsync(0.8);
    return [await first, (await second).now];
  });
  assert.deepEqual(race, ['AbortError', 0.8]);
  await video.page.evaluate(() => { window.fail = true; });
  await assert.rejects(video.seek(0.2), /screen.*scene=0.*time=0.200.*timed out/);
  await video.page.evaluate(() => { window.fail = false; });
  assert.ok(b.image.equals((await video.capture(0.8)).image), 'A failed preparation must allow retry');
  await video.page.evaluate(() => { removeSource(); removeSource(); });
  await video.seek(0.1);
  await video.page.evaluate(() => {
    V.frameSource({ id: 'screen', element: () => document.querySelector('iframe'), prepare: () => { window.replacementPrepared = true; } });
    removeSource();
  });
  await video.seek(0.8);
  assert.equal(await video.page.evaluate(() => window.replacementPrepared), true, 'An old unregister callback must not remove a replacement source');
  const portal = await audit.openPage('/demo/', { viewport: { width: 640, height: 360 } });
  assert.equal(portal.viewportSize().width, 640);
  await portal.close();
});

await withAuditSession({ projectRoot: root }, async audit => {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  await video.page.frames()[1].waitForLoadState();
  const frame = await video.seek(0.1);
  assert.equal(frame.isRecord, false);
  assert.equal(frame.now, 0.1, 'Paused ambient frames must not cancel precise preparation');
  await video.page.evaluate(() => {
    const ui = document.createElement('div');
    ui.dataset.videoUi = '1';
    ui.style.cssText = 'position:fixed;inset:0;z-index:9999';
    document.body.append(ui);
  });
  await video.page.mouse.move(20, 20);
  const overUI = (await video.seek(0.1)).pointer;
  assert.ok(overUI.active && overUI.overUI && !overUI.inside, 'UI hover retains raw pointer input without stage interaction');
  await video.page.mouse.move(-10, -10);
  assert.equal((await video.seek(0.1)).pointer.active, false, 'Leaving the window clears raw pointer activity');
  const reported = video.page.waitForEvent('console', { predicate: message => message.text().includes('Preview fixture') });
  await video.page.evaluate(() => {
    V.frameSource({ id: 'preview-error', element: () => document.body, prepare() { throw new Error('Preview fixture'); } });
    V.seekTo(0.4);
  });
  await reported;
  assert.ok(video.issues.some(issue => issue.code === 'FRAME_ERROR' && issue.message.includes('Preview fixture')), 'Audit sessions must collect preview preparation errors');
});

let origin;
await assert.rejects(withAuditSession({ projectRoot: root }, async audit => {
  origin = audit.origin;
  throw new Error('Intentional audit failure');
}), /Intentional audit failure/);
await assert.rejects(fetch(origin));
const server = await startVideoServer({ projectRoot: root });
assert.equal((await fetch(server.origin + '/demo/')).status, 200);
await server.close();
await server.close();

const output = path.join(root, 'actual.mp4');
const ffmpeg = resolveFfmpeg();
const rendered = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/render.mjs'), 'demo', output, '--workers', '1', '--no-cache'], {
  cwd: root, encoding: 'utf8', timeout: 120000, env: { ...process.env, VIDEO_PROJECT_ROOT: root, FFMPEG_BIN: ffmpeg },
});
assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
const decoded = spawnSync(ffmpeg, ['-loglevel', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1024 * 1024 });
assert.equal(decoded.status, 0);
assert.equal(decoded.stdout.length, 4 * 320 * 180 * 3);
const pixel = frame => Array.from(decoded.stdout.subarray(frame * 320 * 180 * 3 + 3000, frame * 320 * 180 * 3 + 3003));
assert.ok(pixel(0)[1] > 100 && pixel(2)[0] > 100 && pixel(2)[1] < 100, 'Actual encoded frames must include the iframe color change');
const completedVideo = fs.readFileSync(output);
fs.appendFileSync(path.join(dir, 'scenes.js'), '\nwindow.fail = true;\n');
const failedRender = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/render.mjs'), 'demo', output, '--workers', '1', '--no-cache'], {
  cwd: root, encoding: 'utf8', timeout: 120000, env: { ...process.env, VIDEO_PROJECT_ROOT: root, FFMPEG_BIN: ffmpeg },
});
assert.notEqual(failedRender.status, 0, 'Export must fail when an external frame cannot prepare');
assert.match(failedRender.stdout + failedRender.stderr, /screen.*timed out/);
assert.ok(fs.readFileSync(output).equals(completedVideo), 'Failed external preparation must preserve the completed MP4');
console.log('Frame snapshots, external preparation/cancellation/timeout/retry, audit cleanup and actual MP4 PASSED.', root);
