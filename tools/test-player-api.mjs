import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './lib/paths.mjs';
import { withAuditSession } from './audit-session.mjs';

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/player-api-'));
const dir = path.join(root, 'videos/demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><body><script src="../base/js/engine.js"></script><script>window.startupMode=V.environment.mode</script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={ppt:true,width:320,height:180,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(dir, 'scenes.js'), `
V.subtitle({onUpdate(cue,info){ window.captionFrame=info.frame; }});
V.use({onSeek(t){window.lastSeek=t;}});
for(let i=0;i<2;i++) V.scene({id:'scene-'+i,duration:2,lines:['字幕示例'],build(){},update(t,x){window.sceneFrame=x.frame;}});
`);
await withAuditSession({ projectRoot: root }, async audit => {
  const interactive = await audit.openVideo('demo', { mode: 'interactive' });
  const result = await interactive.page.evaluate(() => {
    const target = V.scenes[1].start + 0.1;
    V.player.seek(target);
    const nav = { event: lastSeek, now: V.player.getState().now, sameFrame: captionFrame === sceneFrame };
    V.seekTo(0.1);
    return { target, nav, eventAfterVisualSeek: lastSeek, startupMode, frozen: Object.isFrozen(V.environment) };
  });
  assert.equal(result.nav.event, result.target);
  assert.equal(result.nav.now, result.target);
  assert.ok(result.nav.sameFrame);
  assert.equal(result.eventAfterVisualSeek, result.target, 'Visual seek preserves its existing tool semantics');
  assert.equal(result.startupMode, 'interactive');
  assert.ok(result.frozen);
  await interactive.close();

  const ppt = await audit.openVideo('demo', { mode: 'ppt' });
  assert.equal(await ppt.page.evaluate(() => V.player.goToScene('scene-1').sceneIndex), 1);
  assert.equal(await ppt.page.evaluate(() => V.player.goToPage(1).page), 1);
  assert.equal(await ppt.page.evaluate(() => V.player.play().playing), false);
  await assert.rejects(ppt.page.evaluate(() => V.player.goToScene('missing')), /Unknown scene/);
  await ppt.close();

  const record = await audit.openVideo('demo');
  assert.equal(await record.page.evaluate(() => startupMode), 'record');
});
console.log('Player navigation, visual seek compatibility, subtitle frame identity and startup modes passed.');
