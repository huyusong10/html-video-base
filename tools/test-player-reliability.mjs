import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, resolveFfmpeg } from './lib/paths.mjs';
import { withAuditSession } from './audit-session.mjs';

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/player-reliability-'));
const dir = path.join(root, 'videos/demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={ppt:true,homeUrl:"/",width:320,height:180,audioSrc:false,bgm:false,ui:{persist:false,livePause:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(dir, 'scenes.js'), `
window.choice=V.manualState({enabled:frame=>!frame.playing});
window.seekChoice=V.manualState({resetOn:['seek']});
V.use({onPlay(){window.playFrame=V.getFrameState().playing;},onPause(){window.pauseFrame=V.getFrameState().playing;},
onSeek(time){window.seekEvent={time,now:V.player.getState().now};}});
for(let i=0;i<2;i++) V.scene({id:'scene-'+i,duration:4,lines:[],build(){},
update(t,x){window.drawn=seekChoice.resolve('automatic',x.frame);}});
`);

fs.writeFileSync(path.join(root, 'videos/blank.html'), '<!doctype html><body>Test setup</body>');
const loadingDir = path.join(root, 'videos/loading');
fs.mkdirSync(loadingDir);
fs.writeFileSync(path.join(loadingDir, 'index.html'), `<!doctype html><html lang="zh-CN"><body>
  <script src="../base/js/loading.js"></script><link rel="stylesheet" href="../base/css/base.css">
  <script src="../base/js/engine.js"></script><script src="../demo/video.config.js"></script>
  <script src="../demo/scenes.js"></script>
  <script>
    const startup = new URLSearchParams(location.search);
    if (startup.has('startup-audio')) V.config.audioSrc = '../audio/assets/delayed.wav';
    const source = V.managedSource({ id:'demo-visual', element:()=>document.getElementById('stage'),
      active:frame=>frame.sceneIndex===1, timeoutMs:80,
      startup: startup.has('startup-source'),
      async initialize({signal}) {
        window.loadingOpacityAtInit = getComputedStyle(document.getElementById('buffering-status')).opacity;
        const response = await fetch('visual.txt', {signal});
        if (!response.ok) throw new Error('Visual unavailable');
      },
      prepare(state, frame) {
        if (window.prepareBlocked) return new Promise(() => {});
        window.preparedVisualFrame = frame.id;
      },
    });
    source.setState({});
    V.use({onStart(){window.playerStartedAt=performance.now();}});
    V.boot();
  </script>
`);

const audioDir = path.join(root, 'videos/audio');
fs.mkdirSync(audioDir);
fs.writeFileSync(path.join(audioDir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(audioDir, 'video.config.js'), `
V.config={audioSrc:'assets/delayed.wav',bgm:false,ui:{persist:false}};
window.starts=[];
const NativeAudio=Audio;
window.Audio=function(...args){const audio=new NativeAudio(...args);window.testAudio=audio;audio.addEventListener('playing',()=>starts.push(audio.currentTime));return audio;};
V.scene({duration:8,lines:[],build(){},update(){}});
`);

function silenceWav() {
  const length = 8 * 8000 * 2, wav = Buffer.alloc(44 + length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(length, 40);
  return wav;
}

fs.mkdirSync(path.join(audioDir, 'assets'));
fs.writeFileSync(path.join(audioDir, 'assets/delayed.wav'), silenceWav());

function createStartupMedia() {
  const media = path.join(root, 'videos/startup-media');
  fs.mkdirSync(media);
  fs.writeFileSync(path.join(media, 'asset.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>');
  const movie = spawnSync(resolveFfmpeg(PKG_ROOT), [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=8:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(media, 'asset.mp4'),
  ], { encoding: 'utf8', timeout: 15000 });
  assert.equal(movie.status, 0, movie.error?.message || movie.stderr);
  fs.writeFileSync(path.join(media, 'index.html'), `<!doctype html><html lang="zh-CN"><body>
<script src="../base/js/loading.js"></script><link rel="stylesheet" href="../base/css/base.css">
<script src="../base/js/engine.js"></script><script>
V.config = {width:320,height:180,audioSrc:false,bgm:false,ui:{livePause:false,persist:false}};
const mode = new URLSearchParams(location.search).get('mode');
V.scene({duration:2,lines:[],build(root){
  const media = {
    image: '<img src="asset.svg" loading="lazy" width="64" height="64">',
    svg: '<svg width="64" height="64"><image href="asset.svg" width="64" height="64"></image></svg>',
    css: '<div style="width:64px;height:64px;background-image:url(asset.svg)"></div>',
    video: '<video muted preload="none" width="64" height="64"><source src="missing-movie.mp4"><source src="asset.mp4"></video>',
  };
  root.innerHTML = '<div style="display:none"><img src="missing-hidden.svg"></div>' +
    '<div data-video-optional style="background:url(missing-background.svg)"><img src="missing-decorative.svg"></div>' +
    (media[mode] || '');
  if (mode === 'clip') root.append(V.u.videoClip('asset.mp4', {style:'width:64px;height:64px'}));
},update(){}});
V.boot();
</script></body></html>`);
}

async function checkStartupMedia(audit, mode) {
  const page = await audit.openPage('/blank.html');
  const asset = /\/startup-media\/asset\.(?:svg|mp4)$/;
  let broken = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(asset, async route => {
    if (broken) await route.fulfill({ status: 404, body: '' });
    else { await gate; await route.continue(); }
  });
  try {
    const address = audit.origin + '/startup-media/?t=0.42&mode=' + mode;
    await page.goto(address, { waitUntil: 'commit' });
    const startup = page.locator('#video-loading');
    await startup.getByText('加载失败', { exact: true }).waitFor({ timeout: 12000 });
    assert.equal(await page.locator('#viewport').evaluate(el => el.inert), true);
    broken = false;
    const retried = page.waitForRequest(asset);
    await startup.getByRole('button', { name: '重试', exact: true }).click();
    await retried;
    await startup.getByText('正在加载…', { exact: true }).waitFor();
    assert.equal(await page.locator('#viewport').evaluate(el => el.inert), true);
    release();
    await page.waitForFunction(() => window.V?.getFrameState?.() && !document.getElementById('video-loading'));
    assert.equal(page.url(), address);
    assert.equal(await page.evaluate(() => V.getFrameState().now), 0.42);
    if (mode === 'image') assert.equal(await page.locator('img[src="asset.svg"]').evaluate(el => el.naturalWidth), 64);
    if (mode === 'video' || mode === 'clip') {
      assert.ok(await page.locator('video').evaluate(el => el.readyState >= 2));
    }
  } finally { release(); await page.close(); }
}

async function checkOptionalLoading(audit) {
  const page = await audit.openPage('/blank.html');
  let release;
  let failEngine = true;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/base/css/base.css', async route => {
    await gate;
    await route.continue();
  });
  await page.route('**/base/js/engine.js', route => failEngine ? route.abort() : route.continue());
  try {
    await page.goto(audit.origin + '/loading/', { waitUntil: 'commit' });
    const startup = page.locator('#video-loading');
    await startup.getByText('正在加载…').waitFor();
    assert.equal(await startup.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
    assert.equal(await page.locator('#stage').count(), 0);
    release();
    await startup.getByText('加载失败', { exact: true }).waitFor();
    failEngine = false;
    await startup.getByRole('button', { name: '重试' }).click();
    await page.waitForFunction(() => window.V?.getFrameState?.() && !document.getElementById('video-loading'));
    await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
    assert.ok(await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0].startTime <= playerStartedAt),
      'The browser must paint the startup screen before the player builds its first scene');
    assert.equal(await page.locator('#buffering-status.video-loading-panel').count(), 1);

    await page.goto(audit.origin + '/loading/?capture=1');
    assert.equal(await startup.count(), 0);
    assert.equal(await page.locator('#buffering-status.video-loading-panel').count(), 0);
    await page.goto(audit.origin + '/demo/');
    assert.equal(await startup.count(), 0);
    assert.equal(await page.locator('#buffering-status.video-loading-panel').count(), 0);
  } finally { release(); await page.close(); }
}

async function checkStartupAssets(audit) {
  const page = await audit.openPage('/blank.html');
  let releaseAudio, releaseVisual;
  const audio = new Promise(resolve => { releaseAudio = resolve; });
  const visual = new Promise(resolve => { releaseVisual = resolve; });
  await page.route('**/delayed.wav', async route => { await audio; await route.continue(); });
  await page.route('**/visual.txt', async route => { await visual; await route.fulfill({ status: 200, body: '' }); });
  try {
    const visualRequested = page.waitForRequest('**/visual.txt');
    await page.goto(audit.origin + '/loading/?startup-source&startup-audio');
    await visualRequested;
    const startup = page.locator('#video-loading');
    await startup.getByText('正在加载…').waitFor();
    assert.equal(await page.locator('#viewport').evaluate(el => el.inert), true);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => V.getFrameState().playing), false);
    const visualResponse = page.waitForResponse('**/visual.txt');
    releaseVisual();
    await visualResponse;
    await startup.getByText('正在加载…').waitFor();
    releaseAudio();
    await startup.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#viewport').evaluate(el => el.inert), false);
    await page.mouse.click(120, 120);
    await page.waitForFunction(() => V.getFrameState().now > 0.1);
  } finally { releaseVisual(); releaseAudio(); await page.close(); }
}

async function checkStartupRetryAtTarget(audit) {
  const page = await audit.openPage('/blank.html');
  let fail = true;
  await page.route('**/visual.txt', route => route.fulfill({ status: fail ? 503 : 200, body: '' }));
  try {
    await page.goto(audit.origin + '/loading/?t=4.2');
    const startup = page.locator('#video-loading');
    await startup.getByText('加载失败', { exact: true }).waitFor();
    assert.equal(await page.locator('#viewport').evaluate(el => el.inert), true);
    fail = false;
    await startup.getByRole('button', { name: '重试' }).click();
    await page.waitForFunction(() => window.preparedVisualFrame && !document.getElementById('video-loading'));
    assert.equal(await page.evaluate(() => V.getFrameState().now), 4.2);
    assert.equal(await page.evaluate(() => V.getFrameState().id), await page.evaluate(() => preparedVisualFrame));
  } finally { await page.close(); }
}

async function checkLoadingInPpt(audit) {
  const page = await audit.openPage('/blank.html');
  let release;
  let fail = true;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/visual.txt', async route => {
    await gate;
    await route.fulfill({ status: fail ? 503 : 200, body: '' });
  });
  try {
    await page.goto(audit.origin + '/loading/?ppt=1');
    await page.waitForFunction(() => window.V?.player && !document.getElementById('video-loading'));
    await page.evaluate(() => V.player.nextPage());
    const panel = page.locator('#buffering-status');
    await panel.getByText('正在加载…').waitFor();
    assert.equal(await panel.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    await page.waitForFunction(() => window.loadingOpacityAtInit !== undefined);
    assert.equal(await page.evaluate(() => window.loadingOpacityAtInit), '1', 'Show the loading panel before initializing the visual source');
    release();
    await panel.getByText('加载失败', { exact: true }).waitFor();
    fail = false;
    await panel.getByRole('button', { name: '重试' }).click();
    await page.waitForFunction(() => !V.player.getState().buffering);
    assert.equal(await page.evaluate(() => V.getFrameState().sceneIndex), 1);
  } finally { release(); await page.close(); }
}

async function checkVisualPrepareRetry(audit) {
  const page = await audit.openPage('/blank.html');
  await page.route('**/visual.txt', route => route.fulfill({ status: 200, body: '' }));
  try {
    await page.goto(audit.origin + '/loading/');
    await page.waitForFunction(() => window.V?.player && !document.getElementById('video-loading'));
    await assert.rejects(page.evaluate(() => {
      window.prepareBlocked = true;
      return V.seekToAsync(4.2);
    }), /Preparation timed out/);
    const retry = page.locator('#buffering-status').getByRole('button', { name: '重试' });
    await retry.waitFor();
    await page.evaluate(() => { window.prepareBlocked = false; });
    await retry.click();
    await page.waitForFunction(() => window.preparedVisualFrame === V.getFrameState().id && !V.player.getState().buffering);
    assert.equal(await page.evaluate(() => V.getFrameState().now), 4.2);
  } finally { await page.close(); }
}

async function checkAudioBuffering(audit) {
  const page = await audit.openPage('/blank.html');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/delayed.wav', async route => {
    await gate;
    await route.fulfill({ contentType: 'audio/wav', body: silenceWav() });
  });
  try {
    await page.goto(audit.origin + '/audio/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.V?.player);
    await page.evaluate(() => V.player.play());
    await page.waitForTimeout(850);
    const pending = await page.evaluate(() => ({ state: V.player.getState(), frame: V.getFrameState() }));
    assert.ok(pending.state.now < 0.05, 'Narration buffering must freeze the narrative timeline');
    assert.equal(pending.state.buffering, true);
    assert.ok(pending.frame.clock > 0.5, 'Ambient animation must continue while narration buffers');
    release();
    await page.waitForFunction(() => starts.length > 0 && !V.player.getState().buffering);
    assert.ok(await page.evaluate(() => starts[0] < 0.25), 'Delayed narration must start at its beginning');
    const paused = await page.evaluate(() => { V.player.pause(); return V.getFrameState(); });
    await page.waitForTimeout(250);
    const alive = await page.evaluate(() => V.getFrameState());
    assert.equal(alive.now, paused.now);
    assert.ok(alive.clock > paused.clock, 'Pausing must retain live ambient frames');
  } finally { release(); await page.close(); }
}

async function checkAudioFailure(audit) {
  const page = await audit.openPage('/blank.html');
  let fail = true;
  await page.route('**/delayed.wav', route => route.fulfill(fail ? { status: 404, body: 'missing' } : { contentType: 'audio/wav', body: silenceWav() }));
  await page.goto(audit.origin + '/audio/');
  await page.waitForFunction(() => window.V?.player);
  await page.evaluate(() => V.player.play());
  await page.waitForFunction(() => V.player.getState().error);
  const frozen = await page.evaluate(() => V.player.getState().now);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => V.player.getState().now), frozen, 'A failed narration must not silently advance');
  fail = false;
  await page.locator('#buffering-status button').click();
  await page.waitForFunction(time => !V.player.getState().error && V.player.getState().now > time + .1, frozen);
  assert.ok(await page.evaluate(() => starts[0] < .25), 'Retry must preserve the narration start');
  await page.close();
}

async function checkScrubbing(audit) {
  const page = await audit.openPage('/blank.html');
  await page.goto(audit.origin + '/audio/');
  await page.waitForFunction(() => window.V?.player);
  await page.evaluate(() => V.player.play());
  await page.waitForFunction(() => starts.length > 0);
  const box = await page.locator('.track').boundingBox();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const held = await page.evaluate(() => ({ now: V.player.getState().now, audio: testAudio.currentTime, paused: testAudio.paused }));
  assert.equal(held.paused, true, 'Scrubbing must pause narration');
  assert.ok(Math.abs(held.audio - held.now) < .05, JSON.stringify(held));
  await page.mouse.up();
  await page.waitForFunction(time => V.player.getState().now > time + .1, held.now);
  await page.close();
}

async function checkInteractiveKeyboard(audit) {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  await video.page.evaluate(() => {
    window.activations = 0;
    const button = V.u.h('div', { id: 'keyboard-test' }, 'Choose');
    V.u.interactive(button, () => activations++);
    document.getElementById('stage').append(button);
  });
  await video.page.locator('#keyboard-test').focus();
  await video.page.keyboard.press('Space');
  await video.page.keyboard.press('Enter');
  assert.equal(await video.page.evaluate(() => activations), 2);
  assert.equal(await video.page.evaluate(() => V.player.getState().playing), false, 'Activating a stage control must not toggle playback');

  const page = video.page;
  const track = page.locator('#controls .track');
  await page.evaluate(() => V.player.seek(0.5));
  await track.focus();
  const volume = await page.evaluate(() => V.getVolume());
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => V.getFrameState().now), 5.5);
  await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await page.evaluate(() => V.getFrameState().now), 4.5);
  assert.equal(await page.evaluate(() => V.getVolume()), volume, 'Progress keys must not change volume');

  for (const [triggerSelector, choiceSelector] of [['.chap-trigger', '.chap-item'], ['.rate-trigger', '.rate-item']]) {
    const trigger = page.locator(triggerSelector);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.locator(choiceSelector).first().focus();
    await page.keyboard.press('Escape');
    assert.ok(await trigger.evaluate(el => el === document.activeElement), 'Closing a menu must return keyboard focus to its trigger');
  }

  await page.addStyleTag({ content: ':root { --ctrl-chap-w: 248px; }' });
  for (const width of [650, 540]) {
    await page.setViewportSize({ width, height: 460 });
    const full = await page.locator('[data-act=full]').boundingBox();
    assert.ok(full && full.x + full.width <= width, 'The fullscreen button must fit even with a wide chapter theme');
  }
  await video.close();
}

async function checkCompactControls(audit) {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  const { page } = video;
  await page.addStyleTag({ content: ':root { --ctrl-chap-w: 248px; }' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 460 });
    const layout = await page.evaluate(() => {
      const bar = document.getElementById('controls');
      const bounds = selector => bar.querySelector(selector).getBoundingClientRect().toJSON();
      return { width: bar.scrollWidth, track: bounds('.track'), play: bounds('[data-act=play]'), full: bounds('[data-act=full]') };
    });
    assert.ok(layout.width <= width && layout.full.right <= width, 'Every control must fit in a narrow viewport');
    assert.ok(layout.track.width > width / 2 && layout.track.bottom <= layout.play.top, 'The track must retain a separate usable row');
  }

  for (const [trigger, menu] of [['chap', '.chap-menu'], ['rate', '.rate-menu'], ['subs', '.subs-menu'], ['mute', '.sound-menu']]) {
    await page.locator(`[data-act=${trigger}]`).focus();
    await page.keyboard.press('Enter');
    const panel = await page.locator(menu).boundingBox();
    assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= 320, 'Open menus must fit inside the viewport');
    await page.keyboard.press('Escape');
  }

  await page.evaluate(() => {
    document.body.classList.remove('ctrl-overlay');
    window.dispatchEvent(new Event('resize'));
  });
  const viewport = await page.locator('#viewport').boundingBox();
  const bar = await page.locator('#controls').boundingBox();
  assert.equal(viewport.y + viewport.height, bar.y, 'Pinned controls must reserve their full wrapped height');
  await video.close();

  const ppt = await audit.openVideo('demo', { mode: 'ppt' });
  await ppt.page.setViewportSize({ width: 390, height: 460 });
  const nav = await ppt.page.locator('.ppt-nav').boundingBox();
  const full = await ppt.page.locator('[data-act=full]').boundingBox();
  assert.ok(nav.width > 360 && nav.y + nav.height <= full.y && full.x + full.width <= 390,
    'PPT navigation and the remaining controls must fit on separate rows');
  await ppt.close();
}

async function checkSubtitleSettings(audit) {
  const page = await audit.openPage('/blank.html');
  const fixture = fs.readFileSync(path.join(dir, 'video.config.js'), 'utf8');
  await page.route('**/demo/video.config.js', route => route.fulfill({
    contentType: 'application/javascript', body: fixture.replace('persist:false', 'persist:true'),
  }));
  try {
    await page.goto(audit.origin + '/demo/');
    await page.waitForFunction(() => window.V?.player);
    const subtitle = page.locator('#subs');
    const fontSize = () => subtitle.locator('.sub-text').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.equal(await fontSize(), 32.5);
    assert.equal(await subtitle.getAttribute('data-sub-pos'), 'left');

    const trigger = page.getByRole('button', { name: '字幕', exact: true });
    const toggle = page.getByRole('checkbox', { name: '显示字幕' });
    assert.equal(await page.locator('.subs-wrap button').count(), 1);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.count(), 0);
    await trigger.focus();
    await page.keyboard.press('Enter');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.ok(await toggle.isChecked());
    await page.keyboard.press('Tab');
    assert.ok(await toggle.evaluate(el => el === document.activeElement));
    assert.equal(await toggle.evaluate(el => getComputedStyle(el).opacity), '0');
    const option = name => page.getByRole('radio', { name, exact: true });
    assert.ok(await option('中').isChecked());
    assert.ok(await option('靠左').isChecked());
    await option('中').focus();
    await page.keyboard.press('ArrowUp');
    assert.ok(await option('小').isChecked());
    assert.equal(await fontSize(), 26);
    await option('大').check();
    assert.equal(await fontSize(), 39);
    await option('居中').check();
    assert.equal(await subtitle.getAttribute('data-sub-pos'), 'center');
    const checkedRows = () => page.locator('.subs-menu .sound-item').evaluateAll(rows => rows
      .filter(row => getComputedStyle(row.querySelector('i')).opacity === '1')
      .map(row => row.querySelector('span').textContent));
    assert.deepEqual(await checkedRows(), ['显示字幕', '大', '居中']);
    await toggle.uncheck();
    assert.equal(await page.evaluate(() => V.getFrameState().subsEnabled), false);
    assert.deepEqual(await checkedRows(), ['大', '居中']);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.ok(await trigger.evaluate(el => el === document.activeElement));
    await page.reload();
    await page.waitForFunction(() => window.V?.player);
    assert.equal(await fontSize(), 39);
    assert.equal(await subtitle.getAttribute('data-sub-pos'), 'center');
    assert.equal(await page.evaluate(() => V.getFrameState().subsEnabled), false);
    await trigger.click();
    assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => window.__video.setSubs(true));
    assert.ok(await toggle.isChecked());
  } finally { await page.close(); }
}

async function checkStyleWrites(audit) {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  const result = await video.page.evaluate(() => {
    const node = document.createElement('div'); document.body.append(node);
    V.u.set(node, { x: 1, o: 1 });
    const observer = new MutationObserver(() => {}); observer.observe(node, { attributes: true });
    for (let i = 0; i < 10; i++) V.u.set(node, { x: 1, o: 1 });
    const unchanged = observer.takeRecords().length;
    node.style.transform = 'translateX(20px)';
    V.u.set(node, { x: 1, o: 1 });
    observer.disconnect(); node.remove();
    return { unchanged, transform: node.style.transform };
  });
  assert.equal(result.unchanged, 0, 'Identical frame styles must not rewrite DOM attributes');
  assert.match(result.transform, /translate\(1px/, 'External style changes must still be corrected');
  await video.close();
}

async function checkControlFocus(audit) {
  const video = await audit.openVideo('demo', { mode: 'interactive' });
  const page = video.page;
  await page.locator('[data-act=play]').click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1850);
  assert.equal(await page.locator('#controls').evaluate(el => getComputedStyle(el).opacity), '0', 'Mouse focus must not prevent idle hiding');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1850);
  assert.equal(await page.locator('#controls').evaluate(el => getComputedStyle(el).opacity), '1', 'Keyboard focus must keep controls visible');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#controls') !== null), true);
  await video.close();
}

async function checkPointerAutoHide(audit) {
  const page = await audit.openPage('/blank.html', { viewport: { width: 960, height: 540 } });
  const config = fs.readFileSync(path.join(dir, 'video.config.js'), 'utf8');
  await page.route('**/demo/video.config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: config.replace('persist:false', 'persist:false,idleHideDelay:450,leaveHideDelay:50'),
  }));
  const waitBar = shown => page.waitForFunction(visible => {
    const opacity = Number(getComputedStyle(document.getElementById('controls')).opacity);
    return visible ? opacity >= 0.95 : opacity <= 0.05;
  }, shown, { polling: 40, timeout: 5000 });
  try {
    await page.goto(audit.origin + '/demo/');
    await page.waitForFunction(() => window.__video && V.getFrameState());
    await page.mouse.move(240, 140);
    await waitBar(true);
    await waitBar(false);
    assert.equal(await page.evaluate(() => V.player.getState().playing), false);

    await page.mouse.move(400, 525);
    await waitBar(true);
    await waitBar(false);
    await page.mouse.move(410, 525);
    await waitBar(true);
    await page.mouse.move(970, 525);
    await waitBar(false);

    await page.locator('[data-act=subs]').click();
    assert.equal(await page.locator('#controls').getAttribute('data-menu'), 'subs');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitBar(false);
    assert.equal(await page.locator('#controls').getAttribute('data-menu'), '');

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitBar(true);
    await page.evaluate(async () => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;left:150px;top:100px;width:400px;height:260px;z-index:8';
      const loaded = new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }));
      iframe.src = '/blank.html';
      document.getElementById('viewport').append(iframe);
      await loaded;
    });
    await page.mouse.move(250, 190);
    await waitBar(true);
    await waitBar(false);
    await page.mouse.move(300, 210);
    await waitBar(true);
    await page.mouse.move(970, 210);
    await waitBar(false);

    const track = await page.locator('#controls .track').boundingBox();
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
    await page.mouse.down();
    assert.ok(await page.evaluate(() => document.body.classList.contains('scrubbing')));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitBar(false);
    assert.equal(await page.evaluate(() => document.body.classList.contains('scrubbing')), false);
  } finally {
    await page.close();
  }
}

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
  await checkOptionalLoading(audit);
  await checkStartupAssets(audit);
  await checkStartupRetryAtTarget(audit);
  createStartupMedia();
  for (const mode of ['image', 'svg', 'css', 'clip', 'video']) await checkStartupMedia(audit, mode);
  await checkLoadingInPpt(audit);
  await checkVisualPrepareRetry(audit);
  await checkAudioBuffering(audit);
  await checkAudioFailure(audit);
  await checkScrubbing(audit);
  await checkInteractiveKeyboard(audit);
  await checkCompactControls(audit);
  await checkSubtitleSettings(audit);
  await checkStyleWrites(audit);
  await checkControlFocus(audit);
  await checkPointerAutoHide(audit);
  await checkPauseAndSeek(audit);
  await checkAssetCancellation(audit);
});
console.log('Playback snapshots, manual seek ordering, asset cancellation and timeout recovery passed.');
