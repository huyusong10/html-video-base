// 端到端全量自检（零本地 videos/base 目录）：
// 覆盖微内核开放注册表、30Hz 真实口型包络、受控 <video> 寻道与混音、多语种与 .vtt/.srt 外挂字幕、
// Web 交互驻点、SSE 实时热重载端点、按幕 SHA-256 增量渲染缓存与独立静态包 bundle
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, resolveFfmpeg, resolvePython, loadChromium, findBrowserExecutable } from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';
import { stripSceneCalls } from './render.mjs';

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

  fs.writeFileSync(path.join(videoDir, 'locales/zh-TW.js'), [
    'V.locale("zh-TW", {',
    '  title: "微內核自檢演示",',
    '  scenes: {',
    '    s01: { title: "微內核架構", lines: ["歡迎體驗關鍵微內核時間軸引擎。"], anchors: { "关键": "關鍵" } },',
    '    s02: ["第一句繁體檢驗。", "第二句陣列簡寫擴行。"],',
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
    '  ui: { resumeMinSec: 0.5, idleHideDelay: 420, leaveHideDelay: 120 },',
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
    '  id: "s01", title: "微内核架构", subLayout: "mascotLeft",',
    '  lines: [{ text: "欢迎体验关键微内核时间轴引擎。", enSlowdown: 0.9, align: "acoustic", volume: 0.85, whisperModel: "tiny", xmlLang: "zh-CN" }],',
    '  checkpoints: x => [{ at: 0.45, id: "cp-1", defaultValue: "auto-ok", prompt: "继续演示？", actions: [{ label: "继续", resume: true }] }],',
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
    '  // 1) don\'t break stripSceneCalls )',
    '  id: "s02", title: "纯函数校验", live: true, transition: "zoomFade", transitionDur: 0.35,',
    '  lines: ["所有画面仅由时间纯函数唯一决定。"],',
    '  build(root) { root.append(V.u.h("div", { class: "s2-box", "data-ref": "../assets/shared.svg" }, "PURE F(T)")); },',
    '  update(t) { window.__s2LiveT = t; window.__s2SeenCp = V.checkpointState["cp-1"]; },',
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
  const subsShadow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-act="subs"]')).boxShadow);
  assert.equal(subsShadow, 'none', 'Active [data-act="subs"] must NOT render bottom decorative inset box-shadow');

  await page.mouse.move(200, 200);
  await page.evaluate(() => {
    window.__video.seek(window.V.scenes[1].start + 0.05);
    window.__video.play();
  });
  await page.waitForTimeout(640);
  const idleHidden = await page.evaluate(() => ({
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(idleHidden.uiActive, false, 'Playing with stationary pointer on video canvas must clear .ui-active');
  assert.ok(idleHidden.opacity < 0.05, `Expected idle-hidden #controls opacity ~0, got ${idleHidden.opacity}`);

  await page.mouse.move(320, 180);
  await page.waitForTimeout(190);
  const canvasWake = await page.evaluate(() => ({
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(canvasWake.uiActive, true, 'Moving pointer anywhere inside video canvas must immediately wake #controls');
  assert.ok(canvasWake.opacity > 0.95, `Expected awake #controls opacity ~1, got ${canvasWake.opacity}`);

  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave')));
  await page.waitForTimeout(300);
  const leaveHide = await page.evaluate(() => ({
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(leaveHide.uiActive, false, 'Pointer leaving video window must snap-hide #controls quickly');
  assert.ok(leaveHide.opacity < 0.05, `Expected leave-hidden #controls opacity ~0, got ${leaveHide.opacity}`);

  await page.locator('#controls [data-act="full"]').click();
  await page.waitForTimeout(660);
  const fullAutoHidden = await page.evaluate(async () => {
    const focusedInBar = document.getElementById('controls').contains(document.activeElement);
    const opacity = Number(getComputedStyle(document.getElementById('controls')).opacity);
    if (document.fullscreenElement) await document.exitFullscreen();
    return { focusedInBar, opacity };
  });
  assert.equal(fullAutoHidden.focusedInBar, true, 'Clicking fullscreen button focuses button inside #controls');
  assert.ok(fullAutoHidden.opacity < 0.05, `Fullscreen #controls must still auto-hide after button focus, got opacity ${fullAutoHidden.opacity}`);

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
  await verifyBugfixRegressions(page, port);
  await verifyIframeWebFullContract(page, port);
}

async function verifyHttpAndDomRegressions(page, port) {
  const suffixRes = await fetch(`http://127.0.0.1:${port}/demo/index.html`, { headers: { Range: 'bytes=-64' } });
  assert.equal(suffixRes.status, 206, 'Suffix byte range bytes=-64 must return 206');
  const suffixTxt = await suffixRes.text();
  assert.ok(suffixTxt.length > 0 && suffixTxt.length <= 64, `Suffix range length must be 1..64, got ${suffixTxt.length}`);
  const unsatRes = await fetch(`http://127.0.0.1:${port}/demo/index.html`, { headers: { Range: 'bytes=99999999-999999999' } });
  assert.equal(unsatRes.status, 416, 'Out-of-bounds byte range must return 416');

  const domRes = await page.evaluate(() => {
    const box = document.createElement('div');
    window.V.u.set(box, { opacity: 0.25, scale: 1.5, rotate: 12 });
    const origVoice = window.V.voice;
    const origLines0 = window.V.scenes[0]._origLines.slice();
    window.V.voice = null;
    window.V.scenes[0]._origLines = ['Run voice.py v2.6 at 0.2s carefully.'];
    window.V.layout();
    const dotChunks = window.V.scenes[0].subCues.map(c => c.text);
    window.V.voice = origVoice;
    window.V.scenes[0]._origLines = origLines0;
    window.V.layout();
    return { opacity: box.style.opacity, transform: box.style.transform, dotChunks };
  });
  assert.equal(domRes.opacity, '0.25', 'V.u.set must accept opacity alias');
  assert.ok(domRes.transform.includes('scale(1.5)') && domRes.transform.includes('rotate(12deg)'), `V.u.set must accept scale/rotate aliases, got ${domRes.transform}`);
  assert.equal(domRes.dotChunks.length, 1, `chunkSentences must not split dots inside tokens: ${JSON.stringify(domRes.dotChunks)}`);
  assert.ok(domRes.dotChunks[0].includes('voice.py v2.6 at 0.2s'), `chunkSentences lost dotted tokens: ${domRes.dotChunks[0]}`);
}

async function verifyInteractiveRegressions(page) {
  const res = await page.evaluate(async () => {
    const lastStart = window.V.scenes[window.V.scenes.length - 1].start;
    window.__video.tryEgg(lastStart + 0.05, 'egg-last');
    await new Promise(r => setTimeout(r, 80));
    const lastEggAlive = document.body.classList.contains('egg-mode')
      && document.querySelector('.v-sandbox-bar').classList.contains('on');
    document.querySelector('.v-sandbox-back').click();

    let playHits = 0, pauseHits = 0, actionResumeVal = null;
    window.V.use({ id: 'reg-hooks', play() { playHits++; }, pause() { pauseHits++; } });
    const sc0 = window.V.scenes[0];
    const origCp = sc0.checkpoints;
    sc0._resolvedCheckpoints = null;
    sc0.checkpoints = [{
      at: 0.2,
      id: 'reg-cp',
      title: 'Reg Check',
      actions: [{ label: 'Proceed', resume: 'ok-action' }],
      onResume(val) { actionResumeVal = val; },
    }];
    window.V.resetCheckpoints();
    window.__video.seek(0.14);
    window.__video.play();
    const ov = document.getElementById('checkpoint-overlay');
    for (let i = 0; i < 20 && !ov.classList.contains('is-open'); i++) await new Promise(r => setTimeout(r, 40));
    const cpOpened = ov.classList.contains('is-open');
    const btn = ov.querySelector('.cp-btn');
    const btnLabel = btn ? btn.textContent : '';
    if (btn) btn.click();
    window.V.resetCheckpoints();
    window.__video.seek(0.14);
    for (let i = 0; i < 20 && !ov.classList.contains('is-open'); i++) await new Promise(r => setTimeout(r, 40));
    window.__video.seek(0.05);
    const cpClosedOnSeek = !ov.classList.contains('is-open');
    window.__video.pause();
    sc0.checkpoints = origCp;
    sc0._resolvedCheckpoints = null;
    window.V.resetCheckpoints();
    return { lastEggAlive, cpOpened, btnLabel, actionResumeVal, playHits, pauseHits, cpClosedOnSeek };
  });
  assert.equal(res.lastEggAlive, true, 'tryEgg() targeting live last scene must stay active across animation frames');
  assert.equal(res.cpOpened, true, 'Checkpoint with actions[] must open #checkpoint-overlay');
  assert.equal(res.btnLabel, 'Proceed', 'Checkpoint actions[] button label must render');
  assert.equal(res.actionResumeVal, 'ok-action', 'Checkpoint action resume fallback must pass to onResume');
  assert.ok(res.playHits >= 1 && res.pauseHits >= 1, `play/pause plugin hooks must fire (${res.playHits}/${res.pauseHits})`);
  assert.equal(res.cpClosedOnSeek, true, 'Seeking while checkpoint overlay is open must close #checkpoint-overlay');
}

async function verifyHookAndLocaleVoiceRegressions(page) {
  const r = await page.evaluate(() => {
    let bootHit = 0, tickHit = 0, scChangeHit = 0, ctxBound = false;
    const plug = {
      id: 'short-alias-hooks',
      boot() { bootHit++; ctxBound = this === plug; },
      tick() { tickHit++; },
      sceneChange() { scChangeHit++; },
    };
    window.V.use(plug);
    window.V.emit('onStart', window.V._playerCtl);
    window.__video.seek(window.V.scenes[1].start + 0.1);
    window.__video.seek(0.2);

    const origVoice = window.V.voice;
    const origLang = window.V.__activeLang;
    window.V.voice = {
      src: 'assets/zh-dry.m4a',
      durations: [[9.9]],
      subCues: [[[[0, 9.9, '中文旧字幕']]]],
      bakedLayout: { duration: 99, scenes: [{ start: 0, duration: 50, cues: [[0.35, 10.25]] }, { start: 50, duration: 49, cues: [[0.35, 10.25]] }] },
    };
    window.V.__activeLang = 'en';
    const matchStale = window.V.isVoiceLocaleMatch();
    window.V.layout();
    const leakZhSub = window.V.scenes[0].subCues.some(c => c.text.includes('中文旧字幕'));
    const leakBakedDur = window.V.duration === 99;
    window.V.voice = origVoice;
    window.V.__activeLang = origLang;
    window.V.layout();
    return { bootHit, tickHit, scChangeHit, ctxBound, matchStale, leakZhSub, leakBakedDur };
  });
  assert.equal(r.bootHit, 1, 'Plugin boot() alias must fire on onStart');
  assert.equal(r.ctxBound, true, 'Plugin hook must preserve this === plugin');
  assert.ok(r.tickHit >= 1, 'Plugin tick() alias must fire on onRender');
  assert.ok(r.scChangeHit >= 1, 'Plugin sceneChange() alias must fire on onSceneEnter');
  assert.equal(r.matchStale, false, 'Unlabeled primary V.voice must NOT match secondary locale');
  assert.equal(r.leakZhSub, false, 'Stale primary V.voice.subCues must NOT leak into secondary locale V.layout()');
  assert.equal(r.leakBakedDur, false, 'Stale primary bakedLayout must NOT apply to secondary locale V.layout()');
}

async function verifyRound2EngineRegressions(page, port) {
  const r = await page.evaluate(() => {
    const u0 = window.V._getUiCfg({ ui: { idleHideDelay: 0, leaveHideDelay: 0 } });
    const tileBox = document.createElement('div');
    const tileDom = window.V.transitions.tiles.mount(tileBox, { tileSize: 320 });
    window.V.transitions.tiles.update(tileDom, 0, 0);
    const tileTfZero = tileDom.tiles[0] && tileDom.tiles[0][0].style.transform;

    const sc1 = window.V.scenes[1];
    const origGl = sc1.gl;
    sc1.gl = () => [
      { t: 0.2, shape: 'burst', x: 0.5, y: 0.5 },
      { t: 0.4, t0: 0.1, shape: 'ring', x: 0.5, y: 0.5 },
    ];
    window.V.layout();
    const burstKey = window.V.glKeys.find(k => k.shape === 'burst');
    const ringKey = window.V.glKeys.find(k => k.shape === 'ring');
    const s1Start = sc1.start;
    sc1.gl = origGl;

    window.__video.search('唯一决定');
    const origLang = window.V.__activeLang;
    window.V.locale('zz-reg', {
      scenes: { s01: { lines: ['Alpha line', 'Beta UniqueToken99', 'Gamma line'] } },
    });
    window.V.__activeLang = 'zz-reg';
    window.V.layout();
    const cuesLen = window.V.scenes[0].cues.length;
    const searchHits = window.__video.search('UniqueToken99').length;
    delete window.V.locales['zz-reg'];
    window.V.__activeLang = origLang;
    window.V.layout();
    return {
      u0Idle: u0.idleHideDelay,
      u0Leave: u0.leaveHideDelay,
      tileTfZero,
      burstT0Diff: Math.abs(burstKey.t0 - (s1Start + 0.2)),
      ringT0Diff: Math.abs(ringKey.t0 - (s1Start + 0.1)),
      cuesLen,
      searchHits,
    };
  });
  assert.equal(r.u0Idle, 0, 'Explicit idleHideDelay: 0 must not fall back to 1500');
  assert.equal(r.u0Leave, 0, 'Explicit leaveHideDelay: 0 must not fall back to 220');
  assert.equal(r.tileTfZero, 'scale(0)', 'tiles transition with dur=0 must output scale(0), not scale(NaN)');
  assert.ok(r.burstT0Diff < 1e-6, 'GL burst without explicit t0 must default t0 to burst timestamp');
  assert.ok(r.ringT0Diff < 1e-6, 'GL numeric t0 must be offset by scene start');
  assert.equal(r.cuesLen, 3, 'Locale override with extra lines must preserve all localized lines');
  assert.equal(r.searchHits, 1, 'V.layout() must invalidate cached search index');

  const hmrCtx = await page.context().browser().newContext();
  try {
    const pHmr = await hmrCtx.newPage();
    await pHmr.addInitScript(() => {
      if (!sessionStorage.getItem('__hmr_seeded')) {
        sessionStorage.setItem('__hmr_seeded', '1');
        sessionStorage.setItem('__video_hmr_t', '1.85');
      }
    });
    await pHmr.goto(`http://127.0.0.1:${port}/demo/?record=1&t=0.15`, { waitUntil: 'networkidle' });
    const hmrState = await pHmr.evaluate(() => ({
      now: window.__video.getSyncState().now,
      rem: sessionStorage.getItem('__video_hmr_t'),
    }));
    assert.ok(Math.abs(hmrState.now - 1.85) < 0.1, `__video_hmr_t must take priority over ?t=, got ${hmrState.now}`);
    assert.equal(hmrState.rem, null, '__video_hmr_t must be cleared from sessionStorage after restore');
  } finally {
    await hmrCtx.close();
  }
}

async function verifyBugfixRegressions(page, port) {
  const badUrlRes = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
  assert.equal(badUrlRes.status, 400, 'Malformed URI path must return 400 without crashing HTTP server');
  const liveManifestRes = await fetch(`http://127.0.0.1:${port}/manifest.js`);
  assert.equal(liveManifestRes.status, 200, 'Dev server must synthesize virtual /manifest.js for hub index');
  const liveManifestTxt = await liveManifestRes.text();
  assert.ok(liveManifestTxt.includes('"demo"'), 'Virtual /manifest.js must include live video entry');

  const rt = await page.evaluate(() => {
    const subs = document.getElementById('subs');
    window.__video.seek(0.2);
    const posS1 = subs.dataset.subPos;
    window.__video.seek(window.V.scenes[1].start + 0.2);
    const posS2 = subs.dataset.subPos;
    window.__video.seek(0.35);
    window.__video.seekVisual(1.4);
    window.__video.seek(0.35);
    const backNow = window.__video.getSyncState().now;
    const cue0 = window.V.scenes[0].cues[0];
    return { posS1, posS2, backNow, enSlowdown: cue0.enSlowdown, align: cue0.align };
  });
  assert.equal(rt.posS1, 'left', 'Scene 1 declarative subLayout must apply');
  assert.equal(rt.posS2, 'center', 'Entering Scene 2 without subLayout must reset #subs back to center');
  assert.ok(Math.abs(rt.backNow - 0.35) < 0.03, `Rapid scrub-back seek must not be dropped by dedupe guard, got ${rt.backNow}`);
  assert.equal(rt.enSlowdown, 0.9, 'Per-line enSlowdown override must survive timeline buildCueEntry');
  assert.equal(rt.align, 'acoustic', 'Per-line align override must survive timeline buildCueEntry');

  await verifyHttpAndDomRegressions(page, port);
  await verifyInteractiveRegressions(page);
  await verifyHookAndLocaleVoiceRegressions(page);
  await verifyRound2EngineRegressions(page, port);
}

async function verifyV26ExperienceContracts(page) {
  const kf = await page.evaluate(() => {
    const stops = [
      { at: 0, x: 100, scale: 1, pose: 'wave', badge: 'NEW' },
      { at: 1.0, x: 300, scale: 1.5, dur: 0.5, pose: 'point' },
      { at: 2.2, x: 500, dur: 0.4, pose: 'nod', badge: null },
    ];
    return {
      s0: window.V.u.keyframes(0.4, stops),
      s1: window.V.u.keyframes(1.25, stops),
      s2: window.V.u.keyframes(2.8, stops),
    };
  });
  assert.equal(kf.s0.x, 100, 'keyframes() before stop 1 must hold initial numeric value');
  assert.equal(kf.s0.pose, 'wave', 'keyframes() before stop 1 must hold initial string state');
  assert.equal(kf.s0.badge, 'NEW', 'keyframes() must seed discrete prop');
  assert.ok(kf.s1.x > 140 && kf.s1.x < 260, `keyframes() mid-transition must smoothly interpolate x, got ${kf.s1.x}`);
  assert.equal(kf.s1.pose, 'point', 'keyframes() past midpoint must switch discrete string state');
  assert.equal(kf.s2.x, 500, 'keyframes() after final stop must settle at target x');
  assert.equal(kf.s2.scale, 1.5, 'keyframes() must inherit omitted numeric props from previous stops');
  assert.equal(kf.s2.badge, null, 'keyframes() must allow resetting discrete prop to null');

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
  await page.waitForTimeout(640);
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
  const reloaded = await page.evaluate(() => {
    const sync = window.__video.getSyncState();
    const osdText = document.getElementById('osd').textContent;
    window.V.config.ui.resume = true;
    window.V._prefsRuntime.flushProgress(1.2, false);
    const optInResumeT = window.V._prefsRuntime.resolveSavedResumeTime(
      new URLSearchParams(),
      window.V._getUiCfg(window.V.getCfg()),
      window.V.duration
    );
    window.V.config.ui.resume = false;
    return { sync, osdText, optInResumeT };
  });
  assert.equal(reloaded.sync.playbackRate, 1.25, 'Reload must restore persisted playbackRate');
  assert.equal(reloaded.sync.subsEnabled, false, 'Reload must restore persisted subtitle visibility');
  assert.equal(reloaded.sync.bgmEnabled, false, 'Reload must restore persisted BGM toggle');
  assert.ok(reloaded.sync.now < 0.05, `Default ui.resume=false must start from 0 on reload, got ${reloaded.sync.now}`);
  assert.equal(reloaded.osdText.includes('已续播'), false, 'Default ui.resume=false must NOT flash resume OSD');
  assert.equal(reloaded.optInResumeT, 1.2, 'Opt-in ui.resume=true must persist and resolve saved timestamp');

  await page.evaluate(() => {
    window.__video.clearSavedState();
    window.__video.setRate(1);
    window.__video.setSubs(true);
    window.__video.setBgm(true);
    window.__video.seek(0.2);
  });
  await verifyLivePauseAndPointerContract(page);
}

async function verifyLivePauseAndPointerContract(page) {
  const clockFlow = await page.evaluate(async () => {
    window.__video.pause();
    window.__video.seek(0.22);
    const s0 = window.__video.getSyncState();
    await new Promise(r => setTimeout(r, 130));
    const s1 = window.__video.getSyncState();
    window.__video.play();
    await new Promise(r => setTimeout(r, 70));
    const s2 = window.__video.getSyncState();
    window.__video.pause();
    return { s0, s1, s2 };
  });
  assert.ok(Math.abs(clockFlow.s1.now - clockFlow.s0.now) < 0.001, 'Paused narrative timeline now must remain frozen');
  assert.ok(clockFlow.s1.alive > clockFlow.s0.alive + 0.05, `Paused ambient clock/alive must keep flowing, got ${clockFlow.s0.alive} -> ${clockFlow.s1.alive}`);
  assert.ok(clockFlow.s2.alive >= clockFlow.s1.alive, `Resuming play() must NOT snap ambient clock backward (${clockFlow.s1.alive} -> ${clockFlow.s2.alive})`);

  const stageBox = await page.locator('#stage').boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width * 0.75, stageBox.y + stageBox.height * 0.25);
  await page.waitForTimeout(90);
  const ptrState = await page.evaluate(() => {
    const scRoot = document.querySelector('#stage .scene');
    window.__intClicks = 0;
    const btn = window.V.u.interactive(
      window.V.u.h('button', { id: 'test-int-btn', type: 'button', style: 'left:24px;top:24px;width:64px;height:28px;z-index:20' }, 'ACT'),
      () => { window.__intClicks++; }
    );
    scRoot.appendChild(btn);
    return {
      p: Object.assign({}, window.V.pointer),
      ptrInsideVar: document.getElementById('stage').style.getPropertyValue('--ptr-inside'),
    };
  });
  assert.equal(ptrState.p.inside, true, 'Moving mouse inside #stage must set V.pointer.inside = true');
  assert.ok(Math.abs(ptrState.p.x - 480) < 6 && Math.abs(ptrState.p.y - 90) < 6, `Stage-space V.pointer.(x,y) must inverse-map CSS scale to (480,90), got (${ptrState.p.x},${ptrState.p.y})`);
  assert.ok(ptrState.p.nx > 0.45 && ptrState.p.ny < -0.45, `Normalized V.pointer.(nx,ny) must map to (+0.5,-0.5), got (${ptrState.p.nx},${ptrState.p.ny})`);
  assert.ok(ptrState.p.sx > 0.1 && ptrState.p.presence > 0.2, 'Damped V.pointer.sx & presence must smoothly ramp up');
  assert.equal(ptrState.ptrInsideVar, '1', '#stage --ptr-inside CSS variable must reflect active pointer');

  await page.locator('#test-int-btn').click();
  const intRes = await page.evaluate(() => {
    document.getElementById('test-int-btn')?.remove();
    return { clicks: window.__intClicks, playing: window.__video.getSyncState().playing };
  });
  assert.equal(intRes.clicks, 1, 'V.u.interactive() button click handler must fire');
  assert.equal(intRes.playing, false, 'Clicking V.u.interactive() stage element must NOT toggle player play/pause');
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

async function verifyRound3BrowserContracts(page, port) {
  await page.goto(`http://127.0.0.1:${port}/demo/?record=1`, { waitUntil: 'networkidle' });
  const cpDeterminism = await page.evaluate(async () => {
    const cue0 = window.V.scenes[0].cues[0];
    const s2Start = window.V.scenes[1].start + 0.2;
    await window.V.seekToAsync(s2Start);
    const seenInS2FirstFrame = window.__s2SeenCp;
    await window.V.seekToAsync(0.1);
    const afterRewind = window.V.checkpointState['cp-1'];
    return {
      cueVol: cue0.volume,
      cueWhisper: cue0.whisperModel,
      cueXmlLang: cue0.xmlLang,
      seenInS2FirstFrame,
      afterRewind,
    };
  });
  assert.equal(cpDeterminism.cueVol, 0.85, 'buildCueEntry must preserve per-line volume');
  assert.equal(cpDeterminism.cueWhisper, 'tiny', 'buildCueEntry must preserve per-line whisperModel');
  assert.equal(cpDeterminism.cueXmlLang, 'zh-CN', 'buildCueEntry must preserve per-line xmlLang');
  assert.equal(cpDeterminism.seenInS2FirstFrame, 'auto-ok', 'Record mode must populate prior-scene checkpoints before first S2 update');
  assert.equal(cpDeterminism.afterRewind, undefined, 'Record mode backward scrub must clear future checkpoints');

  await page.goto(`http://127.0.0.1:${port}/demo/?lang=zh-TW&record=1`, { waitUntil: 'networkidle' });
  const twInfo = await page.evaluate(() => ({
    s1Title: window.V.scenes[0].title,
    s2LineCount: window.V.scenes[1].lines.length,
    s2SecondLine: window.V.scenes[1].lines[1] && window.V.scenes[1].lines[1].text,
    voiceMatched: Boolean(window.V.getActiveVoice && window.V.getActiveVoice()),
  }));
  assert.equal(twInfo.s1Title, '微內核架構', 'Regional locale ?lang=zh-TW on zh-CN page must load locales/zh-TW.js');
  assert.equal(twInfo.s2LineCount, 2, 'Locale array shorthand must expand scene line count');
  assert.equal(twInfo.s2SecondLine, '第二句陣列簡寫擴行。', 'Locale array shorthand extra line must apply');
  assert.equal(twInfo.voiceMatched, false, 'Unbuilt regional locale zh-TW must not reuse zh-CN V.voice');
}

function verifyRound3UnitRegressions() {
  const sample = [
    '// Example: V.scene(unclosed in comment',
    'const SHARED = 7;',
    'V.scene({',
    '  // 1) step ) with "quote and \'apostrophe',
    '  /* block ) comment */',
    '  build() { return "(ok)"; },',
    '});',
    'const AFTER = 9;',
  ].join('\n');
  const stripped = stripSceneCalls(sample);
  assert.ok(stripped.includes('const SHARED = 7;') && stripped.includes('const AFTER = 9;'), 'stripSceneCalls must preserve shared code around commented V.scene');
  assert.equal(stripped.includes('build()'), false, 'stripSceneCalls must strip real V.scene body containing comments with parens/quotes');

  const py = resolvePython(PKG_ROOT);
  const pyCheck = spawnSync(py, [
    '-c',
    [
      'import sys; sys.path.insert(0, "tools")',
      'from tts_providers import vol_str',
      'from voice import make_cache_key',
      'assert vol_str(0.8) == "-20%" and vol_str(1.2) == "+20%" and vol_str("+5%") == "+5%" and vol_str(None) == "+0%"',
      'assert make_cache_key({"lang": "en"}, "OK", 1.0) != make_cache_key({"lang": "ja"}, "OK", 1.0)',
      'assert make_cache_key({"xmlLang": "zh-TW"}, "OK", 1.0) != make_cache_key({"xmlLang": "zh-CN"}, "OK", 1.0)',
    ].join('; '),
  ], { cwd: PKG_ROOT, encoding: 'utf8' });
  assert.equal(pyCheck.status, 0, `Python TTS unit checks failed:\n${pyCheck.stderr}`);
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
      cpActiveInRecord: document.getElementById('checkpoint-overlay')?.classList.contains('is-open') || false,
      ptrNeutral: window.V.pointer.inside === false && window.V.pointer.nx === 0 && window.V.pointer.presence === 0,
      clockLocked: window.__video.getSyncState().clock === window.__video.getSyncState().now,
    }));
    assert.equal(recState.pluginInstalled, true, 'Plugin should install');
    assert.equal(recState.hasPreset, true, 'Preset should render');
    assert.equal(recState.hasControl, true, 'Custom control should mount');
    assert.ok(recState.maxEnergy > 0.05, `Expected 30Hz voice energy > 0.05, got ${recState.maxEnergy}`);
    assert.equal(recState.cpActiveInRecord, false, 'Record mode must auto-bypass checkpoints');
    assert.equal(recState.ptrNeutral, true, 'Record mode must lock V.pointer to neutral center');
    assert.equal(recState.clockLocked, true, 'Record mode must lock ambient clock === narrative now');

    await page.goto(`http://127.0.0.1:${port}/demo/?lang=en&record=1`, { waitUntil: 'networkidle' });
    const enInfo = await page.evaluate(() => ({
      title: window.V.scenes[0].title,
      bakedLang: window.V.voice && window.V.voice.bakedLayout && window.V.voice.bakedLayout.lang,
    }));
    assert.equal(enInfo.title, 'Architecture', 'Localized scene title should apply');
    assert.equal(enInfo.bakedLang, 'en', 'Localized timings.en.js must stamp bakedLayout.lang = "en"');

    await verifyRound3BrowserContracts(page, port);
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

function assertCliFails(args, msg) {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: TEST_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: TEST_ROOT }),
  });
  assert.notEqual(r.status, 0, msg || `Expected CLI failure for: ${args.join(' ')}`);
}

function verifyFreshUnbuiltAudit() {
  runCliCmd(['init', 'fresh-unbuilt', '--title', 'Fresh Unbuilt']);
  runCliCmd(['audit', 'fresh-unbuilt']);
  fs.rmSync(path.join(TEST_ROOT, 'videos/fresh-unbuilt'), { recursive: true, force: true });
}

function verifyRenderAssetCacheInvalidation(videoDir, outMp4) {
  fs.mkdirSync(path.join(videoDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'assets/probe.svg'), '<svg>V1</svg>', 'utf8');
  const outAssetV1 = runCliCmd(['render', 'demo', outMp4, '--fps', '10']);
  assert.ok(outAssetV1.includes('0/2 scenes hit'), `Adding visual asset must invalidate render cache, got:\n${outAssetV1}`);
  const outAssetHit = runCliCmd(['render', 'demo', outMp4, '--fps', '10']);
  assert.ok(outAssetHit.includes('2/2 scenes hit'), `Unchanged visual asset must hit 2/2 render cache, got:\n${outAssetHit}`);
  fs.writeFileSync(path.join(videoDir, 'assets/probe.svg'), '<svg>V2</svg>', 'utf8');
  const outAssetV2 = runCliCmd(['render', 'demo', outMp4, '--fps', '10']);
  assert.ok(outAssetV2.includes('0/2 scenes hit'), `Modifying visual asset must invalidate render cache, got:\n${outAssetV2}`);
}

function seedNestedBundleComponent(videoDir) {
  const nestedDir = path.join(videoDir, 'components/nested');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(
    path.join(nestedDir, 'card.js'),
    'export const u = "../assets/collide.svg"; import "../../../base/js/engine.js";\n',
    'utf8'
  );
}

function verifyBundleSafetyAndDepth(videoDir, colDir) {
  const nestedOut = fs.readFileSync(path.join(colDir, 'components/nested/card.js'), 'utf8');
  assert.ok(
    nestedOut.includes('./shared-assets/collide.svg') && nestedOut.includes('../../base/js/engine.js'),
    `Nested bundle component refs must rewrite by depth, got:\n${nestedOut}`
  );
  assertCliFails(['bundle', 'demo', '--out', TEST_ROOT], 'bundle must reject TEST_ROOT as --out');
  assertCliFails(['bundle', 'demo', '--single', '--out', path.join(TEST_ROOT, 'videos')], 'bundle must reject videos/ as --out');
  assert.equal(fs.existsSync(path.join(videoDir, 'index.html')), true, 'Rejected bundle --out must leave videos/demo untouched');
}

async function main() {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_ROOT, 'videos'), { recursive: true });

  try {
    verifyRound3UnitRegressions();
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
    runCliCmd(['audit', 'demo', '--lang', 'en']);
    runCliCmd(['build', 'demo', '--lang', 'en']);
    const shotDir = path.join(TEST_ROOT, 'audit-shots');
    runCliCmd(['audit', 'demo', '--screenshots', shotDir]);
    verifyFreshUnbuiltAudit();

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
    fs.appendFileSync(path.join(videoDir, 'style.css'), '\n.s2-box { letter-spacing: 0.02em; }\n', 'utf8');
    const outCssChanged = runCliCmd(['render', 'demo', outMp4, '--fps', '10']);
    assert.ok(outCssChanged.includes('0/2 scenes hit'), `Editing style.css must invalidate scene render cache, got:\n${outCssChanged}`);
    verifyRenderAssetCacheInvalidation(videoDir, outMp4);
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
    assert.ok(fs.readFileSync(path.join(singleDir, 'js/s02.js'), 'utf8').includes('./assets/shared.svg'), 'Single bundle js/* must rewrite document-relative ../assets/ -> ./assets/');

    fs.mkdirSync(path.join(TEST_ROOT, 'videos/assets'), { recursive: true });
    fs.mkdirSync(path.join(TEST_ROOT, 'videos/themes'), { recursive: true });
    fs.writeFileSync(path.join(TEST_ROOT, 'videos/assets/collide.svg'), '<svg>SHARED</svg>', 'utf8');
    fs.writeFileSync(path.join(videoDir, 'assets/collide.svg'), '<svg>LOCAL</svg>', 'utf8');
    fs.writeFileSync(path.join(TEST_ROOT, 'videos/themes/collision-test.css'), '.t-col{background:url(../assets/collide.svg);mask:url(my-assets/collide.svg)}\n', 'utf8');
    fs.appendFileSync(path.join(videoDir, 'js/s02.js'), '\nvoid "../assets/collide.svg"; void "assets/collide.svg";\n', 'utf8');
    seedNestedBundleComponent(videoDir);
    const colDir = path.join(TEST_ROOT, 'dist-single-collision');
    runCliCmd(['bundle', 'demo', '--single', '--out', colDir]);
    assert.equal(fs.readFileSync(path.join(colDir, 'assets/collide.svg'), 'utf8'), '<svg>LOCAL</svg>', 'Local colliding asset must win at assets/');
    assert.equal(fs.readFileSync(path.join(colDir, 'shared-assets/collide.svg'), 'utf8'), '<svg>SHARED</svg>', 'Shared colliding asset must isolate into shared-assets/');
    const colS02 = fs.readFileSync(path.join(colDir, 'js/s02.js'), 'utf8');
    assert.ok(colS02.includes('./shared-assets/collide.svg') && colS02.includes('"assets/collide.svg"'), 'Shared vs local refs in js/* must stay distinct');
    const colThemeCss = fs.readFileSync(path.join(colDir, 'themes/collision-test.css'), 'utf8');
    assert.ok(colThemeCss.includes('../shared-assets/collide.svg') && colThemeCss.includes('my-assets/collide.svg'), 'Theme CSS must rewrite ../assets/ collisions without corrupting substring paths');
    verifyBundleSafetyAndDepth(videoDir, colDir);

    console.log('✅ All html-video-base v2.6 end-to-end self-tests PASSED.');
  } finally {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

await main();
