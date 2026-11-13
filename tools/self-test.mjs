// 端到端全量自检（零本地 videos/base 目录）：
// 覆盖微内核开放注册表、30Hz 真实口型包络、受控 <video> 寻道与混音、多语种与 .vtt/.srt 外挂字幕、
// Web 交互驻点、SSE 实时热重载端点、按幕 SHA-256 增量渲染缓存与独立静态包 bundle
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, resolveFfmpeg, loadChromium, findBrowserExecutable } from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

const TEST_ROOT = path.join(PKG_ROOT, '.runtime/self-test-proj');
const CLI_BIN = path.join(PKG_ROOT, 'bin/html-video.mjs');

function runCliCmd(args) {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: TEST_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: TEST_ROOT }),
  });
  if (r.status !== 0) {
    throw new Error(`CLI failed (${args.join(' ')}):\n${r.stdout || ''}\n${r.stderr || ''}`);
  }
  return (r.stdout || '') + (r.stderr || '');
}

function createSampleMp4(ffmpegBin, outMp4) {
  fs.mkdirSync(path.dirname(outMp4), { recursive: true });
  const r = spawnSync(ffmpegBin, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x1e293b:s=320x180:d=1.5:r=15',
    '-f', 'lavfi', '-i', 'sine=frequency=520:duration=1.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    outMp4,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Failed generating sample clip: ${r.stderr}`);
}

function writeTestProjectFiles(videoDir) {
  fs.writeFileSync(path.join(videoDir, 'mock_tts.py'), [
    'import numpy as np, soundfile as sf',
    'async def synthesize(text: str, out_path: str, cfg: dict):',
    '    sr = 24000',
    '    dur = max(1.1, min(2.2, 0.12 * len(text)))',
    '    t = np.linspace(0, dur, int(sr * dur), endpoint=False)',
    '    env = 0.55 + 0.45 * np.sin(2 * np.pi * 6.0 * t)',
    '    wav = (0.35 * env * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)',
    '    sf.write(out_path, wav, sr)',
    '    return []',
    '',
  ].join('\n'), 'utf8');

  fs.mkdirSync(path.join(videoDir, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'locales/en.js'), [
    'V.locale("en", {',
    '  title: "Microkernel Demo EN",',
    '  scenes: {',
    '    s01: {',
    '      title: "Architecture",',
    '      lines: ["Welcome to the critical microkernel timeline."],',
    '      anchors: { "关键": "critical" },',
    '    },',
    '    s02: {',
    '      title: "Verification",',
    '      lines: ["Every pure function stays deterministic."],',
    '    },',
    '  },',
    '});',
    '',
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(videoDir, 'video.config.js'), [
    'window.__pluginInstalled = false;',
    'window.__maxLayerEnergy = 0;',
    'V.use({ name: "test-plugin", install(v) { window.__pluginInstalled = Boolean(v); } });',
    'V.transition("zoomFade", (dom, near, dur, curSc) => {',
    '  const k = Math.abs(near) < dur ? 1 - Math.abs(near) / dur : 0;',
    '  if (curSc && curSc.root) curSc.root.style.opacity = (1 - k * 0.4).toFixed(3);',
    '});',
    'V.icons({ pin: ["M8 2.5v7", "M5 6.5h6", "M8 10v3.5"] });',
    'V.control({ id: "test-btn", icon: "pin", title: "Custom Control", onClick() { window.__ctrlClicked = true; } });',
    'V.subtitle({',
    '  modes: { mascotLeft: { pos: "left", left: "180px", maxWidth: "420px" } },',
    '  lead: (h) => h("span", { id: "test-sub-mascot" }, "MASCOT"),',
    '  onUpdate(_cue, info) { if (info.energy > 0) window.__subHookCalled = true; },',
    '});',
    'V.preset("badge", (label) => V.u.h("div", { class: "test-preset-badge" }, label));',
    'V.layer({',
    '  id: "host", prop: "host", zIndex: 25,',
    '  defaultState: { x: 100, y: 100, scale: 1 },',
    '  create() { return V.u.h("div", { id: "test-host-layer" }, "HOST"); },',
    '  update(st, info) { if (info.energy > window.__maxLayerEnergy) window.__maxLayerEnergy = info.energy; },',
    '});',
    'V.config = {',
    '  title: "微内核自检演示",',
    '  width: 640, height: 360, fps: 10,',
    '  ui: { resumeMinSec: 0.5 },',
    '  tts: { provider: "custom", script: "./mock_tts.py" },',
    '  sceneScripts: ["js/s01.js", "js/s02.js"],',
    '};',
    '',
  ].join('\n'), 'utf8');

  fs.mkdirSync(path.join(videoDir, 'js'), { recursive: true });
  fs.rmSync(path.join(videoDir, 'js/scenes.js'), { force: true });
  const idxHtml = path.join(videoDir, 'index.html');
  fs.writeFileSync(idxHtml, fs.readFileSync(idxHtml, 'utf8').replace('<script src="js/scenes.js"></script>', ''), 'utf8');

  fs.writeFileSync(path.join(videoDir, 'js/s01.js'), [
    'V.scene({',
    '  id: "s01", title: "微内核架构",',
    '  lines: ["欢迎体验关键微内核时间轴引擎。"],',
    '  checkpoints: x => [{ at: 0.45, id: "cp-1", prompt: "继续演示？", actions: [{ label: "继续", resume: true }] }],',
    '  build(root, x) {',
    '    const badge = V.c.badge("OPEN-KERNEL");',
    '    const clip = V.u.videoClip("assets/clip.mp4", { start: 0.05, volume: 0.25, style: { width: "160px", height: "90px" } });',
    '    root.append(badge, clip);',
    '    this._badge = badge; this._clip = clip;',
    '    this._tKey = x.at(0, "关键");',
    '  },',
    '  update(t) {',
    '    V.u.set(this._badge, { opacity: t >= this._tKey ? 1 : 0.6 });',
    '    V.u.syncVideoClip(this._clip, t);',
    '  },',
    '});',
    '',
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(videoDir, 'js/s02.js'), [
    'V.scene({',
    '  id: "s02", title: "纯函数校验", live: true, transition: "zoomFade", transitionDur: 0.35,',
    '  lines: ["所有画面仅由时间纯函数唯一决定。"],',
    '  build(root) { root.append(V.u.h("div", { class: "s2-box" }, "PURE F(T)")); },',
    '  update(t) { window.__s2LiveT = t; },',
    '});',
    '',
  ].join('\n'), 'utf8');
}

async function verifyIframeWebFullContract(page, port) {
  await page.setContent(`<iframe id="vid" src="http://127.0.0.1:${port}/demo/" style="width:640px;height:360px;border:0"></iframe>`);
  const frame = page.frameLocator('#vid');
  await frame.locator('[data-act="webfull"]').waitFor({ state: 'visible' });
  const dodge = await page.evaluate(async () => {
    const f = document.getElementById('vid');
    const win = f.contentWindow;
    const doc = f.contentDocument;
    const injected = doc.createElement('button');
    injected.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"></svg>';
    doc.querySelector('[data-act="webfull"]').before(injected);
    const iconWidths = Array.from(doc.querySelectorAll('#controls .ctrl-rbtn, #controls .chap-wrap ~ button'))
      .map(b => Math.round(b.getBoundingClientRect().width));
    await win.V.seekToAsync(0.8);
    doc.querySelector('[data-act="webfull"]').click();
    doc.getElementById('subs').style.transition = 'none';
    const fr = f.getBoundingClientRect();
    const s = doc.getElementById('subs').getBoundingClientRect();
    const c = doc.getElementById('controls').getBoundingClientRect();
    return {
      rbtnCount: doc.querySelectorAll('#controls .ctrl-rbtn').length,
      iconWidths,
      expanded: Math.round(fr.width) === window.innerWidth && Math.round(fr.height) === window.innerHeight,
      subBottom: s.bottom,
      ctrlTop: c.top,
    };
  });
  assert.equal(dodge.rbtnCount, 6, 'Single-layer same-origin iframe must auto-render [data-act="webfull"] (6 right icon buttons)');
  for (const w of dodge.iconWidths) assert.equal(w, dodge.iconWidths[0], 'All right-side icon buttons (including injected SVG buttons) must share uniform width');
  assert.equal(dodge.expanded, true, 'Clicking webfull inside single-layer iframe must expand iframe to viewport');
  assert.ok(dodge.subBottom <= dodge.ctrlTop, `Fullscreen #subs (${dodge.subBottom}) must dodge above #controls (${dodge.ctrlTop})`);
}

async function verifyPotPlayerAutoHideContract(page) {
  await page.mouse.move(200, 200);
  await page.evaluate(() => window.__video.play());
  await page.waitForTimeout(960);
  const idleHidden = await page.evaluate(() => ({
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(idleHidden.uiActive, false, 'Playing with pointer outside bottom hot-zone must clear .ui-active');
  assert.ok(idleHidden.opacity < 0.05, `Expected hidden #controls opacity ~0, got ${idleHidden.opacity}`);

  await page.mouse.move(200, 706);
  await page.waitForTimeout(190);
  const hotWake = await page.evaluate(() => ({
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(hotWake.uiActive, true, 'Entering bottom hot-zone must immediately wake #controls');
  assert.ok(hotWake.opacity > 0.95, `Expected awake #controls opacity ~1, got ${hotWake.opacity}`);

  await page.mouse.move(200, 200);
  await page.waitForTimeout(520);
  const fastHide = await page.evaluate(() => ({
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(fastHide.uiActive, false, 'Leaving bottom hot-zone must clear .ui-active within ~300ms');
  assert.ok(fastHide.opacity < 0.05, `Expected fast-hidden #controls opacity ~0, got ${fastHide.opacity}`);

  await page.evaluate(() => { window.__video.pause(); window.__video.seek(0.2); });
  await page.waitForTimeout(200);
  const pausedHold = await page.evaluate(() => Number(getComputedStyle(document.getElementById('controls')).opacity));
  assert.ok(pausedHold > 0.95, 'Paused state must keep #controls visible');
}

async function verifyPlayerBarContracts(page, port) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/demo/`, { waitUntil: 'networkidle' });
  const barInfo = await page.evaluate(async () => {
    const isIconNode = sel => {
      const el = document.querySelector(sel);
      return Boolean(el && el.textContent.trim() === '' && el.querySelector('svg.ctrl-ico'));
    };
    const allIconsAt1x = ['.ctrl-home', '[data-act="play"]', '[data-custom-ctrl="test-btn"]', '[data-act="rate"]', '[data-act="subs"]', '[data-act="mute"]', '[data-act="full"]', '.chap-caret']
      .every(isIconNode);
    const rbtnSizes = Array.from(document.querySelectorAll('#controls .ctrl-rbtn')).map(b => {
      const r = b.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const track = document.querySelector('#controls .track');
    const w0 = track.getBoundingClientRect().width;
    await window.V.seekToAsync(window.V.scenes[1].start + 0.6);
    const w1 = track.getBoundingClientRect().width;
    document.querySelector('[data-act="rate"]').click();
    const rateOpen = document.getElementById('controls').classList.contains('rate-open');
    const item15 = Array.from(document.querySelectorAll('.rate-item')).find(el => el.textContent.includes('1.5x'));
    item15.click();
    const rateBtn = document.querySelector('[data-act="rate"]');
    const rateBadge15 = rateBtn.textContent.trim();
    const rateVal = window.__video.getSyncState().playbackRate;
    window.__video.setRate(1);
    const revertedIcon = isIconNode('[data-act="rate"]');
    return {
      overlayDefault: document.body.classList.contains('ctrl-overlay'),
      hudTicks: document.querySelectorAll('#hud .hud-tick').length,
      trackMarks: document.querySelectorAll('#controls .track .mark').length,
      w0: Math.round(w0 * 100),
      w1: Math.round(w1 * 100),
      allIconsAt1x,
      rbtnSizes,
      rateOpen,
      rateVal,
      rateBadge15,
      revertedIcon,
      noStandaloneWebFull: document.querySelector('[data-act="webfull"]') === null,
    };
  });
  assert.equal(barInfo.overlayDefault, true, 'Default controlsMode must be overlay (PotPlayer style)');
  assert.equal(barInfo.hudTicks, 1, 'Expected 1 .hud-tick for 2 scenes');
  assert.equal(barInfo.trackMarks, 1, 'Expected 1 .track .mark for 2 scenes');
  assert.equal(barInfo.w0, barInfo.w1, 'Progress bar width must stay invariant across chapter changes');
  assert.equal(barInfo.allIconsAt1x, true, 'Home, play, custom control, 1.0x rate, subs, mute, fullscreen & chapter caret must all render SVG icons');
  assert.equal(barInfo.rbtnSizes.length, 5, 'Expected 5 compact right-side icon buttons on standalone page');
  for (const b of barInfo.rbtnSizes) {
    assert.equal(b.w, 32, 'Compact right-side icon buttons must be 32px wide');
    assert.equal(b.h, 30, 'Compact right-side icon buttons must be 30px tall');
  }
  assert.equal(barInfo.rateOpen, true, 'Clicking rate button must open upward .rate-menu');
  assert.equal(barInfo.rateVal, 1.5, 'Selecting 1.5x from rate menu must update playbackRate');
  assert.equal(barInfo.rateBadge15, '1.5x', 'Non-1.0x playbackRate must display compact numeric badge');
  assert.equal(barInfo.revertedIcon, true, 'Resetting playbackRate to 1.0x must restore speedometer SVG icon');
  assert.equal(barInfo.noStandaloneWebFull, true, 'Standalone top-level page must omit redundant webfull button by default');
  await verifyPotPlayerAutoHideContract(page);

  await page.evaluate(() => window.V.setSubLayout('mascotLeft'));
  const subExt = await page.evaluate(() => {
    const subs = document.getElementById('subs');
    return {
      hasMascotLead: Boolean(document.getElementById('test-sub-mascot')),
      hookCalled: Boolean(window.__subHookCalled),
      pos: subs.dataset.subPos,
      leftVar: subs.style.getPropertyValue('--sub-left'),
    };
  });
  assert.equal(subExt.hasMascotLead, true, 'V.subtitle({ lead }) must mount companion element inside #subs .sub-lead');
  assert.equal(subExt.hookCalled, true, 'V.subtitle({ onUpdate }) must receive 30Hz energy updates');
  assert.equal(subExt.pos, 'left', 'V.setSubLayout(mode) must switch data-sub-pos');
  assert.equal(subExt.leftVar, '180px', 'V.setSubLayout(mode) must apply custom --sub-left coordinate');
  await page.evaluate(() => window.V.setSubLayout('center'));

  const postEnd = await page.evaluate(async () => {
    window.__video.seek(window.__video.duration);
    window.__video.pause();
    const t0 = window.__s2LiveT;
    const tg0 = document.getElementById('stage').style.getPropertyValue('--tg');
    document.getElementById('viewport').click();
    const nowAfterClick = window.__video.getSyncState().now;
    await new Promise(r => setTimeout(r, 120));
    const t1 = window.__s2LiveT;
    const tg1 = document.getElementById('stage').style.getPropertyValue('--tg');
    window.__video.tryEgg(0.4, '点击卡片交互');
    const inEgg = document.body.classList.contains('egg-mode') && document.querySelector('.v-sandbox-bar').classList.contains('on');
    const eggNow = window.__video.getSyncState().now;
    document.querySelector('.v-sandbox-back').click();
    const backState = window.__video.getSyncState();
    return {
      isEnded: nowAfterClick >= window.__video.duration - 0.02,
      liveAdvanced: t1 > t0 + 0.04 && tg1 !== tg0,
      inEgg,
      eggNow,
      exitedEgg: !backState.sandbox && backState.now >= window.V.scenes[1].start,
    };
  });
  assert.equal(postEnd.isEnded, true, 'Blank #viewport click at end of live scene must NOT reset timeline to 0');
  assert.equal(postEnd.liveAdvanced, true, 'Live scene HTML & --tg animations must keep moving after timeline ends');
  assert.equal(postEnd.inEgg, true, 'tryEgg() must activate .v-sandbox-bar and body.egg-mode');
  assert.ok(Math.abs(postEnd.eggNow - 0.4) < 0.05, 'tryEgg() must jump to targetTime');
  assert.equal(postEnd.exitedEgg, true, 'Clicking .v-sandbox-back must exit egg mode and return to finale');

  await verifySearchAndDeepLinkContract(page);
  await verifyDualStemBgmContract(page);
  await verifyV26ExperienceContracts(page);
  await verifyIframeWebFullContract(page, port);
}

async function verifyV26ExperienceContracts(page) {
  const kf = await page.evaluate(() => {
    const stops = [
      { at: 0, x: 100, scale: 1, pose: 'wave' },
      { at: 1.0, x: 300, scale: 1.5, dur: 0.5, pose: 'point' },
      { at: 2.2, x: 500, dur: 0.4, pose: 'nod' },
    ];
    return {
      s0: window.V.u.keyframes(0.4, stops),
      s1: window.V.u.keyframes(1.25, stops),
      s2: window.V.u.keyframes(2.8, stops),
    };
  });
  assert.equal(kf.s0.x, 100, 'keyframes() before stop 1 must hold initial numeric value');
  assert.equal(kf.s0.pose, 'wave', 'keyframes() before stop 1 must hold initial string state');
  assert.ok(kf.s1.x > 140 && kf.s1.x < 260, `keyframes() mid-transition must smoothly interpolate x, got ${kf.s1.x}`);
  assert.equal(kf.s1.pose, 'point', 'keyframes() past midpoint must switch discrete string state');
  assert.equal(kf.s2.x, 500, 'keyframes() after final stop must settle at target x');
  assert.equal(kf.s2.scale, 1.5, 'keyframes() must inherit omitted numeric props from previous stops');

  await page.evaluate(() => { window.__video.pause(); window.__video.seek(0.2); });
  const trackBox = await page.locator('#controls .track').boundingBox();
  await page.mouse.move(trackBox.x + trackBox.width * 0.78, trackBox.y + trackBox.height / 2);
  const tipOn = await page.evaluate(() => {
    const el = document.querySelector('#controls .track-tip');
    return { show: el.classList.contains('is-show'), text: el.textContent };
  });
  assert.equal(tipOn.show, true, 'Hovering .track must show .track-tip pill');
  assert.ok(tipOn.text.includes('02 · 纯函数校验'), `Expected .track-tip to show chapter 02 title, got "${tipOn.text}"`);
  await page.mouse.move(200, 200);
  const tipOff = await page.evaluate(() => document.querySelector('#controls .track-tip').classList.contains('is-show'));
  assert.equal(tipOff, false, 'Leaving .track must hide .track-tip pill');

  await page.evaluate(() => {
    window.__video.seek(window.V.scenes[1].start + 0.05);
    window.__video.play();
  });
  await page.waitForTimeout(480);
  await page.keyboard.press('b');
  const osdState = await page.evaluate(() => ({
    osdShow: document.getElementById('osd').classList.contains('is-show'),
    osdText: document.getElementById('osd').textContent,
    uiActive: document.body.classList.contains('ui-active'),
  }));
  assert.equal(osdState.osdShow, true, 'Keyboard shortcut must trigger top-right #osd pill');
  assert.ok(osdState.osdText.includes('背景音乐'), `Expected #osd to describe BGM toggle, got "${osdState.osdText}"`);
  assert.equal(osdState.uiActive, false, 'Keyboard shortcut must NOT pop up bottom #controls while pointer is idle');
  await page.keyboard.press('b');

  await page.evaluate(() => {
    window.__video.pause();
    window.__video.setRate(1.25);
    window.__video.setSubs(false);
    window.__video.setBgm(false);
    window.__video.seek(1.2);
    window.V._prefsRuntime.flushProgress(1.2, false);
  });
  await page.reload({ waitUntil: 'networkidle' });
  const resumed = await page.evaluate(() => ({
    sync: window.__video.getSyncState(),
    osdText: document.getElementById('osd').textContent,
  }));
  assert.equal(resumed.sync.playbackRate, 1.25, 'Reload must restore persisted playbackRate');
  assert.equal(resumed.sync.subsEnabled, false, 'Reload must restore persisted subtitle visibility');
  assert.equal(resumed.sync.bgmEnabled, false, 'Reload must restore persisted BGM toggle');
  assert.ok(Math.abs(resumed.sync.now - 1.2) < 0.15, `Reload must resume at saved timestamp (~1.2s), got ${resumed.sync.now}`);
  assert.ok(resumed.osdText.includes('已续播'), `Reload resume must flash OSD indicator, got "${resumed.osdText}"`);

  await page.evaluate(() => {
    window.__video.clearSavedState();
    window.__video.setRate(1);
    window.__video.setSubs(true);
    window.__video.setBgm(true);
    window.__video.seek(0.2);
  });
}

async function verifyDualStemBgmContract(page) {
  await page.locator('[data-act="mute"]').click();
  const opened = await page.evaluate(() => ({
    soundOpen: document.getElementById('controls').classList.contains('sound-open'),
    hasBgm: window.__video.getSyncState().hasBgm,
    bgmEnabled: window.__video.getSyncState().bgmEnabled,
    voiceEnabled: window.__video.getSyncState().voiceEnabled,
  }));
  assert.equal(opened.soundOpen, true, 'Clicking mute button on dual-stem video must open .sound-menu');
  assert.equal(opened.hasBgm, true, 'Dual-stem video must report hasBgm: true');
  assert.equal(opened.bgmEnabled, true, 'BGM must start enabled by default');
  assert.equal(opened.voiceEnabled, true, 'Voice must start enabled by default');

  await page.locator('.sound-menu [data-sound="bgm"]').click();
  const afterBgmOff = await page.evaluate(() => window.__video.getSyncState());
  assert.equal(afterBgmOff.bgmEnabled, false, 'Clicking BGM row in .sound-menu must turn off BGM');
  assert.equal(afterBgmOff.voiceEnabled, true, 'Turning off BGM must keep narration voice active');

  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  const afterBKey = await page.evaluate(() => window.__video.getSyncState());
  assert.equal(afterBKey.bgmEnabled, true, 'Pressing B shortcut must toggle BGM back on');
}

async function verifySearchAndDeepLinkContract(page) {
  await page.evaluate(() => window.__video.seek(0.1));
  await page.keyboard.press('/');
  await page.keyboard.type('唯一决定');
  const markCount = await page.evaluate(() => document.querySelectorAll('#controls .chap-hit-mark').length);
  assert.ok(markCount >= 1, 'Pressing / and typing must focus .chap-search and highlight hits');
  await page.keyboard.press('Enter');

  const res = await page.evaluate(async () => {
    const afterJump = window.__video.getSyncState().now;
    const hits = window.__video.search('唯一决定');
    window.__video.openSearch('唯一决定');
    const menuOpen = document.getElementById('controls').classList.contains('chap-open');
    window.V._playerCtl.setOpenMenu('');
    const link5 = window.__video.getDeepLink(5);
    const timeEl = document.querySelector('#controls .time');
    timeEl.click();
    await new Promise(r => setTimeout(r, 30));
    return {
      hitCount: hits.length,
      hitScene: hits[0] ? hits[0].sceneIndex : -1,
      menuOpen,
      jumpedToS2: afterJump >= window.V.scenes[1].start,
      hasTParam: link5.includes('t=5'),
      copiedState: timeEl.dataset.copied === '1' && timeEl.textContent.includes('已复制'),
    };
  });
  assert.equal(res.hitCount, 1, 'V.search() must find matching transcript line');
  assert.equal(res.hitScene, 1, 'V.search() must identify Scene 2');
  assert.equal(res.menuOpen, true, 'V.openSearch() must open chapter/search menu');
  assert.equal(res.jumpedToS2, true, 'Clicking search hit must jump to target cue timestamp');
  assert.equal(res.hasTParam, true, 'V.getDeepLink(5) must encode ?t=5');
  assert.equal(res.copiedState, true, 'Clicking .time must copy deep link and show confirmation');
}

async function verifyBrowserCapabilities(videoDir) {
  const { srv, port } = await startEphemeralVideoServer({ videosDir: path.join(TEST_ROOT, 'videos'), watch: true });
  const chromium = await loadChromium(PKG_ROOT);
  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const hmrRes = await fetch(`http://127.0.0.1:${port}/__hmr`);
    assert.equal(hmrRes.status, 200);
    assert.ok((hmrRes.headers.get('content-type') || '').includes('text/event-stream'));
    await hmrRes.body.cancel();

    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.goto(`http://127.0.0.1:${port}/demo/?record=1`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await window.V.seekToAsync(0.6);
      await window.V.seekToAsync(0.9);
    });
    const recState = await page.evaluate(() => ({
      pluginInstalled: window.__pluginInstalled,
      hasPreset: Boolean(document.querySelector('.test-preset-badge')),
      hasControl: Boolean(document.querySelector('[data-custom-ctrl="test-btn"]')),
      maxEnergy: window.__maxLayerEnergy,
      cpActiveInRecord: document.getElementById('checkpoint-overlay')?.classList.contains('on') || false,
    }));
    assert.equal(recState.pluginInstalled, true, 'Plugin should install');
    assert.equal(recState.hasPreset, true, 'Preset should render');
    assert.equal(recState.hasControl, true, 'Custom control should mount');
    assert.ok(recState.maxEnergy > 0.05, `Expected 30Hz voice energy > 0.05, got ${recState.maxEnergy}`);
    assert.equal(recState.cpActiveInRecord, false, 'Record mode must auto-bypass checkpoints');

    await page.goto(`http://127.0.0.1:${port}/demo/?lang=en&record=1`, { waitUntil: 'networkidle' });
    const enTitle = await page.evaluate(() => window.V.scenes[0].title);
    assert.equal(enTitle, 'Architecture', 'Localized scene title should apply');

    await verifyPlayerBarContracts(page, port);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }

  for (const sub of ['assets/bgm.m4a', 'assets/bgm.en.m4a', 'assets/subtitles.vtt', 'assets/subtitles.srt', 'assets/subtitles.en.vtt', 'assets/subtitles.en.srt']) {
    assert.ok(fs.existsSync(path.join(videoDir, sub)), `Expected generated media/subtitle file ${sub}`);
  }
}

async function main() {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'videos'), { recursive: true });

  try {
    console.log('[SelfTest 1/5] Scaffolding isolated video project (zero local videos/base)...');
    runCliCmd(['init', 'demo', '--title', '微内核自检演示', '--skill']);
    assert.equal(fs.existsSync(path.join(TEST_ROOT, 'videos/base')), false, 'videos/base must NOT exist locally');
    assert.equal(fs.existsSync(path.join(TEST_ROOT, '.agents/skills/html-video/SKILL.md')), true, '--skill must export SKILL.md');

    const videoDir = path.join(TEST_ROOT, 'videos/demo');
    createSampleMp4(resolveFfmpeg(PKG_ROOT), path.join(videoDir, 'assets/clip.mp4'));
    writeTestProjectFiles(videoDir);

    console.log('[SelfTest 2/5] Building default & localized (en) tracks + offline remix + visual audit...');
    runCliCmd(['build', 'demo', '--bitrate', '96k', '--visual']);
    const mixWarm = runCliCmd(['mix', 'demo', '--bitrate', '96k']);
    assert.ok(mixWarm.includes('2/2 dry clips hit'), `Expected warm offline mix to hit 2/2 cached clips, got:\n${mixWarm}`);
    fs.rmSync(path.join(TEST_ROOT, '.runtime/voice-cache'), { recursive: true, force: true });
    fs.renameSync(path.join(videoDir, 'mock_tts.py'), path.join(videoDir, 'mock_tts.py.bak'));
    const mixCold = runCliCmd(['build', 'demo', '--mix-only', '--bitrate', '96k']);
    assert.ok(mixCold.includes('2 fallback to stem'), `Expected cold offline mix to slice from stem without TTS, got:\n${mixCold}`);
    fs.renameSync(path.join(videoDir, 'mock_tts.py.bak'), path.join(videoDir, 'mock_tts.py'));
    runCliCmd(['build', 'demo', '--lang', 'en']);
    const shotDir = path.join(TEST_ROOT, 'audit-shots');
    runCliCmd(['audit', 'demo', '--screenshots', shotDir]);

    console.log('[SelfTest 3/5] Verifying microkernel registries, 30Hz lip-sync energy, SSE HMR & i18n in Chromium...');
    await verifyBrowserCapabilities(videoDir);

    console.log('[SelfTest 4/5] Verifying per-scene SHA-256 render cache & static frame reuse...');
    const outMp4 = path.join(TEST_ROOT, 'demo.mp4');
    const out1 = runCliCmd(['render', 'demo', outMp4, '--fps', '10']);
    assert.ok(fs.existsSync(outMp4), 'Rendered MP4 should exist');
    assert.ok(out1.includes('% reused)'), `First render should report static frame reuse stats, got:\n${out1}`);
    const out2 = runCliCmd(['render', 'demo', outMp4, '--fps', '10']);
    assert.ok(out2.includes('2/2 scenes hit'), `Second render must hit 2/2 scene cache, got:\n${out2}`);
    assert.ok(out2.includes('+ audio+bgm'), `Default render must mix audio+bgm, got:\n${out2}`);
    const outNoBgm = path.join(TEST_ROOT, 'demo-nobgm.mp4');
    const out3 = runCliCmd(['render', 'demo', outNoBgm, '--fps', '10', '--no-bgm']);
    assert.ok(fs.existsSync(outNoBgm) && out3.includes('+ audio ->'), `--no-bgm render must mux voice-only stem, got:\n${out3}`);

    console.log('[SelfTest 5/5] Verifying standalone static bundler...');
    const distDir = path.join(TEST_ROOT, 'dist');
    runCliCmd(['bundle', 'demo', '--out', distDir]);
    assert.ok(fs.existsSync(path.join(distDir, 'base/js/engine.js')), 'Bundled base/js/engine.js should exist');
    assert.ok(fs.existsSync(path.join(distDir, 'demo/index.html')), 'Bundled demo/index.html should exist');

    const singleDir = path.join(TEST_ROOT, 'dist-single');
    runCliCmd(['bundle', 'demo', '--single', '--out', singleDir]);
    assert.ok(fs.existsSync(path.join(singleDir, 'index.html')), 'Single bundle root index.html should exist');
    assert.ok(fs.existsSync(path.join(singleDir, 'base/js/engine.js')), 'Single bundle base/js/engine.js should exist');
    assert.ok(fs.readFileSync(path.join(singleDir, 'index.html'), 'utf8').includes('./base/js/engine.js'), 'Single bundle index.html must rewrite ../base/ -> ./base/');

    console.log('✅ All html-video-base v2.6 end-to-end self-tests PASSED.');
  } finally {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

await main();
