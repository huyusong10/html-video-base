import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './lib/paths.mjs';
import { withAuditSession } from './audit-session.mjs';

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/player-reliability-'));
const dir = path.join(root, 'videos/demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={ppt:true,width:320,height:180,audioSrc:false,bgm:false,ui:{persist:false,livePause:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(dir, 'scenes.js'), `
window.choice=V.manualState({enabled:frame=>!frame.playing});
window.seekChoice=V.manualState({resetOn:['seek']});
V.use({onPlay(){window.playFrame=V.getFrameState().playing;},onPause(){window.pauseFrame=V.getFrameState().playing;},
onSeek(time){window.seekEvent={time,now:V.player.getState().now};}});
for(let i=0;i<2;i++) V.scene({id:'scene-'+i,duration:4,lines:[],build(){},
update(t,x){window.drawn=seekChoice.resolve('automatic',x.frame);}});
`);

async function checkPauseAndSeek(audit) {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  const initial = await video.page.evaluate(() => V.getFrameState().id);
  await assert.rejects(video.page.evaluate(() => V.seekToAsync(NaN)), /seek time must be finite/);
  assert.equal(await video.page.evaluate(() => V.getFrameState().id), initial, 'Invalid positioning must not publish another frame');
  await video.page.evaluate(() => V.player.play());
  await video.page.waitForFunction(() => V.getFrameState().playing);
  const paused = await video.page.evaluate(() => {
    V.player.pause();
    choice.set('chosen');
    const pauseChoice = choice.resolve('automatic');
    seekChoice.set('old choice');
    V.player.seek(0.4);
    return { playing: V.getFrameState().playing, choice: choice.resolve('automatic'),
      pauseChoice, playFrame, pauseFrame, drawn, seekEvent };
  });
  assert.equal(paused.playing, false);
  assert.equal(paused.playFrame, true, 'onPlay must read the new playback snapshot');
  assert.equal(paused.pauseFrame, false, 'onPause must read the paused snapshot without ambient ticks');
  assert.equal(paused.pauseChoice, 'chosen', 'A paused manual control must remain usable without ambient ticks');
  assert.equal(paused.choice, 'automatic', 'The default manual seek policy still resets the selection');
  assert.equal(paused.drawn, 'automatic', 'A user seek must clear manual state before drawing');
  assert.equal(paused.seekEvent.now, paused.seekEvent.time, 'onSeek remains a notification after positioning');
  assert.equal(await video.page.evaluate(async () => {
    seekChoice.set('visual choice'); await V.seekToAsync(0.8); return drawn;
  }), 'visual choice', 'Tool positioning must keep its existing manual-state semantics');
  await video.close();

  const ppt = await audit.openVideo('demo', { mode: 'ppt' });
  const pageResult = await ppt.page.evaluate(() => {
    seekChoice.set('old page choice'); V.player.nextPage(); return { drawn, seekEvent };
  });
  assert.equal(pageResult.drawn, 'automatic', 'PPT navigation must clear state before drawing');
  assert.equal(pageResult.seekEvent.time, pageResult.seekEvent.now);
  await ppt.close();
}

async function checkAssetCancellation(audit) {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  await video.page.clock.install();
  await video.page.evaluate(() => {
    const image = document.createElement('img');
    image.id = 'blocked-decode'; image.decode = () => new Promise(() => {});
    document.getElementById('stage').appendChild(image);
    window.oldSeek = 'pending';
    V.seekToAsync(0.5).then(() => { oldSeek = 'resolved'; }, error => { oldSeek = error.name; });
  });
  await video.page.evaluate(async () => {
    document.getElementById('blocked-decode').remove(); await V.seekToAsync(0.9);
  });
  assert.equal(await video.page.evaluate(() => oldSeek), 'AbortError', 'Superseding a seek must cancel its asset wait');
  await video.page.evaluate(() => {
    const image = document.createElement('img'); image.id = 'blocked-decode';
    image.decode = () => new Promise(() => {}); document.getElementById('stage').appendChild(image);
    window.assetFailure = 'pending';
    V.seekToAsync(1).then(() => { assetFailure = 'resolved'; }, error => { assetFailure = error.message; });
  });
  await video.page.clock.fastForward(30001);
  assert.match(await video.page.evaluate(() => assetFailure), /asset preparation timed out/);
  assert.equal(await video.page.evaluate(() => V._frameRuntime.isHeld()), false, 'A failed asset wait must release the player');
  await video.page.evaluate(async () => {
    document.getElementById('blocked-decode').remove(); await V.seekToAsync(1.2);
  });
  assert.equal(await video.page.evaluate(() => V.getFrameState().now), 1.2, 'Seeking must recover after an asset timeout');
  await video.close();
}

await withAuditSession({ projectRoot: root }, async audit => {
  await checkPauseAndSeek(audit);
  await checkAssetCancellation(audit);
});
console.log('Playback snapshots, manual seek ordering, asset cancellation and timeout recovery passed.');
