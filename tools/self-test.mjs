// 默认运行全量测试；--quick 只运行轻量检查，不执行浏览器、音频处理或视频渲染。
// 覆盖微内核开放注册表、30Hz 真实口型包络、受控 <video> 寻道与混音、多语种与 .vtt/.srt 外挂字幕、
// Web 交互驻点、SSE 实时热重载端点、按幕 SHA-256 增量渲染缓存与独立静态包 bundle
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PKG_ROOT, resolveFfmpeg, resolvePython, loadChromium, findBrowserExecutable, loadVideoSandbox } from './lib/paths.mjs';
import { createVideoHttpServer, startEphemeralVideoServer } from './lib/http-static.mjs';
import { buildVttContent } from './lib/subtitles.mjs';
import { verifySpokenTimings } from './verify-sync.mjs';
import { stripSceneCalls, buildCachedSceneSegments, installFrameReuseProbe, resolveStageSpec, resolveTimeWindow } from './render.mjs';

const RUNTIME_DIR = path.join(PKG_ROOT, '.runtime');
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
const TEST_ROOT = fs.mkdtempSync(path.join(RUNTIME_DIR, 'self-test-'));
const CLI_BIN = path.join(PKG_ROOT, 'bin/html-video.mjs');
const PROJECT_FILES = {
  'index.html': '<!doctype html><title>Project home</title><link rel="stylesheet" href="home.css"><a href="demo/">Play</a><script src="catalog.js"></script>',
  'manifest.js': 'window.VIDEO_MANIFEST = [{ id: "demo", title: "Project title", order: 42 }];\n',
  'catalog.js': 'window.projectCatalog = true;\n',
  'home.css': 'body { color: #234; }\n',
};

function writeProjectFiles() {
  for (const [name, content] of Object.entries(PROJECT_FILES)) {
    fs.writeFileSync(path.join(TEST_ROOT, 'videos', name), content, 'utf8');
  }
}

async function verifyProjectFileOwnership() {
  const { srv, port } = await startEphemeralVideoServer({ videosDir: path.join(TEST_ROOT, 'videos') });
  try {
    for (const route of ['/', '/index.html', '/manifest.js']) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(res.status, 404, `Missing project file ${route} must not be generated`);
      await res.text();
    }
    writeProjectFiles();
    for (const [name, content] of Object.entries(PROJECT_FILES)) {
      const res = await fetch(`http://127.0.0.1:${port}/${name}`);
      assert.equal(res.status, 200, `Project file ${name} must be served`);
      assert.equal(await res.text(), content, `Project file ${name} must be served unchanged`);
    }
  } finally {
    await new Promise(resolve => srv.close(resolve));
  }
}

function verifyBundledProjectFiles(distDir) {
  for (const [name, content] of Object.entries(PROJECT_FILES)) {
    assert.equal(fs.readFileSync(path.join(TEST_ROOT, 'videos', name), 'utf8'), content, `init/build/mix must preserve project file ${name}`);
    assert.equal(fs.readFileSync(path.join(distDir, name), 'utf8'), content, `bundle must copy project file ${name} unchanged`);
  }
  try {
    for (const name of Object.keys(PROJECT_FILES)) fs.rmSync(path.join(TEST_ROOT, 'videos', name));
    const bareDist = path.join(TEST_ROOT, 'dist-bare');
    runCliCmd(['bundle', 'demo', '--out', bareDist]);
    assert.equal(fs.existsSync(path.join(bareDist, 'index.html')), false, 'bundle must not generate a home page');
    assert.equal(fs.existsSync(path.join(bareDist, 'manifest.js')), false, 'bundle must not generate a catalog');
  } finally {
    writeProjectFiles();
  }
}

function runCliCmd(args, projectRoot = TEST_ROOT) {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: projectRoot }),
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
    '  texts: { "继续演示？": "Continue demo?", "继续": "Continue" },',
    '  scenes: {',
    '    s01: {',
    '      title: "Architecture",',
    '      texts: { "OPEN-KERNEL": "OPEN-KERNEL-EN" },',
    '      lines: ["Welcome to the critical microkernel timeline."],',
    '      anchors: { "关键": "critical" },',
    '    },',
    '    s02: {',
    '      title: "Verification",',
    '      texts: { "PURE F(T)": "PURE F(T) EN" },',
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
    '  ppt: true,',
    '  homeUrl: "../index.html",',
    '  lang: "zh-CN",',
    '  locales: ["zh-CN", "en", "zh-TW"],',
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
    await win.V.seekToAsync(0.8);
    doc.querySelector('[data-act="webfull"]').click();
    doc.getElementById('subs').style.transition = 'none';
    const fr = f.getBoundingClientRect();
    const s = doc.getElementById('subs').getBoundingClientRect();
    const c = doc.getElementById('controls').getBoundingClientRect();
    return {
      expanded: Math.round(fr.width) === window.innerWidth && Math.round(fr.height) === window.innerHeight,
      subBottom: s.bottom,
      ctrlTop: c.top,
    };
  });
  assert.equal(dodge.expanded, true, 'Clicking webfull inside single-layer iframe must expand iframe to viewport');
  assert.ok(dodge.subBottom <= dodge.ctrlTop, `Fullscreen #subs (${dodge.subBottom}) must dodge above #controls (${dodge.ctrlTop})`);
}

async function verifyPotPlayerAutoHideContract(page) {
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
    const resetRate = window.__video.getSyncState().playbackRate;
    return {
      overlayDefault: document.body.classList.contains('ctrl-overlay'),
      hudTicks: document.querySelectorAll('#hud .hud-tick').length,
      trackMarks: document.querySelectorAll('#controls .track .mark').length,
      w0: Math.round(w0 * 100),
      w1: Math.round(w1 * 100),
      rateOpen,
      rateVal,
      rateBadge15,
      resetRate,
      noStandaloneWebFull: document.querySelector('[data-act="webfull"]') === null,
    };
  });
  assert.equal(barInfo.overlayDefault, true, 'Default controlsMode must be overlay (PotPlayer style)');
  assert.equal(barInfo.hudTicks, 1, 'Expected 1 .hud-tick for 2 scenes');
  assert.equal(barInfo.trackMarks, 1, 'Expected 1 .track .mark for 2 scenes');
  assert.equal(barInfo.w0, barInfo.w1, 'Progress bar width must stay invariant across chapter changes');
  assert.equal(barInfo.rateOpen, true, 'Clicking rate button must open upward .rate-menu');
  assert.equal(barInfo.rateVal, 1.5, 'Selecting 1.5x from rate menu must update playbackRate');
  assert.equal(barInfo.rateBadge15, '1.5x', 'Non-1.0x playbackRate must display compact numeric badge');
  assert.equal(barInfo.resetRate, 1, 'Resetting playbackRate must restore normal playback speed');
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
  await verifyProgressResumeAndLivePlayback(page);
  await verifySubtitleLayoutAndTimeline(page, port);
  await verifyIframeWebFullContract(page, port);
}

async function verifyMalformedHttpRequests(port) {
  for (const opts of [{ headers: { Host: '[invalid' } }, { path: 'http://[invalid' }]) {
    const status = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/demo/index.html', ...opts }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(status, 400, 'Malformed request URLs and Host headers must return 400');
  }
  const goodRes = await fetch(`http://127.0.0.1:${port}/demo/index.html`);
  assert.equal(goodRes.status, 200, 'Preview server must remain available after malformed requests');
  await goodRes.arrayBuffer();
}

async function verifyHttpRanges(port) {
  await verifyMalformedHttpRequests(port);
  const suffixRes = await fetch(`http://127.0.0.1:${port}/demo/index.html`, { headers: { Range: 'bytes=-64' } });
  assert.equal(suffixRes.status, 206, 'Suffix byte range bytes=-64 must return 206');
  const suffixTxt = await suffixRes.text();
  assert.ok(suffixTxt.length > 0 && suffixTxt.length <= 64, `Suffix range length must be 1..64, got ${suffixTxt.length}`);
  const unsatRes = await fetch(`http://127.0.0.1:${port}/demo/index.html`, { headers: { Range: 'bytes=99999999-999999999' } });
  assert.equal(unsatRes.status, 416, 'Out-of-bounds byte range must return 416');
  await unsatRes.arrayBuffer();
  const badUrlRes = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
  assert.equal(badUrlRes.status, 400, 'Malformed URI path must return 400 without crashing HTTP server');
  await badUrlRes.arrayBuffer();
}

async function verifyDomAndPronunciation(page) {
  const domRes = await page.evaluate(() => {
    const box = document.createElement('div');
    window.V.u.set(box, { opacity: 0.25, scale: 1.5, rotate: 12 });
    const origVoice = window.V.voice;
    const origPron = window.V.config.pronunciation;
    const origLines0 = window.V.scenes[0]._origLines.slice();
    window.V.voice = null;
    window.V.scenes[0]._origLines = ['Run voice.py v2.6 at 0.2s carefully.'];
    window.V.layout();
    const dotChunks = window.V.scenes[0].subCues.map(c => c.text);

    window.V.config.pronunciation = { '几万行': '几万航', '调用': '掉用' };
    window.V.scenes[0]._origLines = ['进入几万行的工程仓库；再扣掉工具调用开销；最后保持稳定输出。'];
    window.V.voice = {
      durations: [[9.0], [2.0]],
      words: [[[[0, '进入'], [0.6, '几万航'], [1.4, '的工程仓库'], [3.2, '再扣掉工具'], [4.2, '掉用'], [5.0, '开销'], [6.4, '最后保持稳定输出']]], [[]]],
    };
    window.V.__ignoreBakedLayout = true;
    window.V.layout();
    const pronSubs = window.V.scenes[0].subCues.map(c => [Number(c.start.toFixed(2)), Number(c.end.toFixed(2)), c.text]);
    delete window.V.__ignoreBakedLayout;

    window.V.config.pronunciation = origPron;
    window.V.voice = origVoice;
    window.V.scenes[0]._origLines = origLines0;
    window.V.layout();
    return { opacity: box.style.opacity, transform: box.style.transform, dotChunks, pronSubs };
  });
  assert.equal(domRes.opacity, '0.25', 'V.u.set must accept opacity alias');
  assert.ok(domRes.transform.includes('scale(1.5)') && domRes.transform.includes('rotate(12deg)'), `V.u.set must accept scale/rotate aliases, got ${domRes.transform}`);
  assert.equal(domRes.dotChunks.length, 1, `chunkSentences must not split dots inside tokens: ${JSON.stringify(domRes.dotChunks)}`);
  assert.ok(domRes.dotChunks[0].includes('voice.py v2.6 at 0.2s'), `chunkSentences lost dotted tokens: ${domRes.dotChunks[0]}`);
  assert.equal(domRes.pronSubs.length, 3, `Expected 3 clause subCues, got ${JSON.stringify(domRes.pronSubs)}`);
  assert.ok(domRes.pronSubs[0][1] <= domRes.pronSubs[1][0] + 0.01 && domRes.pronSubs[1][1] <= domRes.pronSubs[2][0] + 0.01,
    `Pronunciation homophones must not cause overlapping subCues: ${JSON.stringify(domRes.pronSubs)}`);
  assert.ok(Math.abs(domRes.pronSubs[1][0] - (0.35 + 3.2)) < 0.05 && Math.abs(domRes.pronSubs[2][0] - (0.35 + 6.4)) < 0.05,
    `Pronunciation-mapped chunks must hit exact word boundary timestamps: ${JSON.stringify(domRes.pronSubs)}`);
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

async function verifyTransitionsLocaleSearchAndHmr(page, port) {
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

async function verifySubtitleLayoutAndTimeline(page, port) {
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

  await verifyDomAndPronunciation(page);
  await verifyInteractiveRegressions(page);
  await verifyHookAndLocaleVoiceRegressions(page);
  await verifyTransitionsLocaleSearchAndHmr(page, port);
  await verifyConditionalSubtitlesAndHiddenControls(page);
}

async function verifyConditionalSubtitlesAndHiddenControls(page) {
  const res = await page.evaluate(async () => {
    const bar = document.getElementById('controls');
    const subs = document.getElementById('subs');
    const sc1 = window.V.scenes[1];
    const origUpdate = sc1.update;
    sc1.update = (t, x) => {
      origUpdate.call(sc1, t, x);
      if (t > 0.35) window.V.setSubLayout('mascotLeft');
    };
    window.__video.seek(sc1.start + 0.55);
    const subLate = subs.dataset.subPos;
    window.__video.seek(sc1.start + 0.1);
    const subEarly = subs.dataset.subPos;
    sc1.update = origUpdate;

    window.__video.seek(0.2);
    window.__video.play();
    document.body.classList.remove('ui-active');
    const track = bar.querySelector('.track');
    const tr = track.getBoundingClientRect();
    const beforeNow = window.__video.getSyncState().now;
    track.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: tr.left + tr.width * 0.9,
      clientY: tr.top + tr.height * 0.5,
      pointerType: 'touch',
      bubbles: true,
      cancelable: true,
    }));
    track.dispatchEvent(new MouseEvent('click', {
      clientX: tr.left + tr.width * 0.9,
      clientY: tr.top + tr.height * 0.5,
      bubbles: true,
      cancelable: true,
    }));
    const afterBlindTapNow = window.__video.getSyncState().now;
    const wokeFromBlindTap = document.body.classList.contains('ui-active');
    window.__video.pause();
    return { subLate, subEarly, notScrubbed: Math.abs(afterBlindTapNow - beforeNow) < 0.15, wokeFromBlindTap };
  });
  assert.equal(res.subLate, 'left', 'Conditional intra-scene V.setSubLayout must apply when condition holds');
  assert.equal(res.subEarly, 'center', 'Scrubbing backward in same scene must reset conditional V.setSubLayout');
  assert.equal(res.notScrubbed, true, 'Blind tap on hidden overlay #controls .track must not accidentally scrub');
  assert.equal(res.wokeFromBlindTap, true, 'Blind tap on hidden overlay #controls must wake ui-active');
}

async function verifyProgressResumeAndLivePlayback(page) {
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
    window.__video.setVolume(0.65);
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
  assert.equal(reloaded.sync.volume, 0.65, 'Reload must restore persisted master volume');
  assert.equal(reloaded.sync.subsEnabled, false, 'Reload must restore persisted subtitle visibility');
  assert.equal(reloaded.sync.bgmEnabled, false, 'Reload must restore persisted BGM toggle');
  assert.ok(reloaded.sync.now < 0.05, `Default ui.resume=false must start from 0 on reload, got ${reloaded.sync.now}`);
  assert.equal(reloaded.osdText.includes('已续播'), false, 'Default ui.resume=false must NOT flash resume OSD');
  assert.equal(reloaded.optInResumeT, 1.2, 'Opt-in ui.resume=true must persist and resolve saved timestamp');

  await page.evaluate(() => {
    window.__video.clearSavedState();
    window.__video.setRate(1);
    window.__video.setVolume(1);
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
  await verifyVolumeControlContract(page);
}

async function verifyVolumeControlContract(page) {
  await page.locator('[data-act="mute"]').click();
  const volSliderRes = await page.evaluate(() => {
    const range = document.querySelector('.sound-vol-range');
    const valEl = document.querySelector('.sound-vol-val');
    const muteBtn = document.querySelector('[data-act="mute"]');
    range.focus();
    range.value = '35';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const s35 = {
      vol: window.__video.getSyncState().volume,
      muted: window.__video.getSyncState().muted,
      txt: valEl.textContent,
      mode: muteBtn.dataset.soundMode,
    };
    range.value = '2';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.value = '0';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const s0 = {
      vol: window.__video.getSyncState().volume,
      muted: window.__video.getSyncState().muted,
      txt: valEl.textContent,
      mode: muteBtn.dataset.soundMode,
    };
    return { s35, s0 };
  });
  assert.equal(volSliderRes.s35.vol, 0.35, 'Dragging .sound-vol-range to 35 must set volume=0.35');
  assert.equal(volSliderRes.s35.muted, false, 'Setting volume=0.35 must remain unmuted');
  assert.equal(volSliderRes.s35.txt, '35%', '.sound-vol-val must display 35%');
  assert.equal(volSliderRes.s35.mode, 'volumeLow', 'Volume < 50% must switch icon to volumeLow');
  assert.equal(volSliderRes.s0.vol, 0, 'Dragging .sound-vol-range to 0 must set volume=0');
  assert.equal(volSliderRes.s0.muted, true, 'Volume 0% must report muted=true');
  assert.equal(volSliderRes.s0.mode, 'volumeMute', 'Volume 0% must switch icon to volumeMute');

  await page.keyboard.press('m');
  const unmutedFromZero = await page.evaluate(() => window.__video.getSyncState());
  assert.equal(unmutedFromZero.muted, false, 'Pressing M at 0% must unmute');
  assert.equal(unmutedFromZero.volume, 0.35, 'Unmuting after dragging through 2%->0% must restore >=10% volume (0.35)');

  await page.keyboard.press('Escape');
  await page.mouse.move(200, 200);
  await page.evaluate(() => {
    window.__video.seek(window.V.scenes[1].start + 0.05);
    window.__video.play();
  });
  await page.waitForTimeout(640);
  await page.keyboard.press('ArrowUp');
  const arrowVol = await page.evaluate(() => ({
    vol: window.__video.getSyncState().volume,
    osd: document.getElementById('osd').textContent,
    uiActive: document.body.classList.contains('ui-active'),
    opacity: Number(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  assert.equal(arrowVol.vol, 0.4, 'ArrowUp must step volume +5% (0.35 -> 0.40)');
  assert.equal(arrowVol.osd, '音量 40%', 'ArrowUp must flash #osd with updated volume percentage');
  assert.equal(arrowVol.uiActive, false, 'ArrowUp volume step must NOT wake bottom #controls');
  assert.ok(arrowVol.opacity < 0.05, 'Closing .sound-menu after focusing slider must allow #controls to auto-hide');

  const wheelVol = await page.evaluate(() => {
    window.__video.pause();
    document.querySelector('[data-act="mute"]').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    const afterWheel = window.__video.getSyncState().volume;
    window.__video.setVolume(1);
    window.__video.clearSavedState();
    return afterWheel;
  });
  assert.equal(wheelVol, 0.45, 'Mouse wheel up on [data-act="mute"] must step volume +5% (0.40 -> 0.45)');
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

async function verifyRecordCheckpointsAndLocaleAudio(page, port) {
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

  await page.goto(`http://127.0.0.1:${port}/demo/?lang=zh-TW&volume=0.4`, { waitUntil: 'networkidle' });
  await page.locator('[data-act="mute"]').click();
  const singleStemMenu = await page.evaluate(() => ({
    soundOpen: document.getElementById('controls').classList.contains('sound-open'),
    hasBgm: window.__video.getSyncState().hasBgm,
    vol: window.__video.getSyncState().volume,
    valTxt: document.querySelector('.sound-vol-val').textContent,
    bgmRowHidden: document.querySelector('.sound-menu [data-sound="bgm"]').hidden,
    muteRowTxt: document.querySelector('.sound-menu [data-sound="mute"] span').textContent,
  }));
  assert.equal(singleStemMenu.soundOpen, true, 'Non-BGM video must still open .sound-menu for volume slider');
  assert.equal(singleStemMenu.hasBgm, false, 'Unbuilt zh-TW locale must have hasBgm=false');
  assert.equal(singleStemMenu.vol, 0.4, '?volume=0.4 query parameter must initialize volume to 40%');
  assert.equal(singleStemMenu.valTxt, '40%', '.sound-vol-val must reflect ?volume=0.4');
  assert.equal(singleStemMenu.bgmRowHidden, true, 'Non-BGM video must hide BGM row in .sound-menu');
  assert.equal(singleStemMenu.muteRowTxt, '靜音', 'Non-BGM video on ?lang=zh-TW must localize mute item as 靜音');
}

function verifySceneSourceParsing() {
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
}

function verifyTtsOptionsAndCacheKeys() {
  const py = resolvePython(PKG_ROOT);
  const pyCheck = spawnSync(py, [
    '-c',
    [
      'import sys, os; sys.path.insert(0, "tools")',
      'from tts_providers import vol_str',
      'from voice import make_cache_key',
      'assert vol_str(0.8) == "-20%" and vol_str(1.2) == "+20%" and vol_str("+5%") == "+5%" and vol_str(None) == "+0%"',
      'assert make_cache_key({"lang": "en"}, "OK", 1.0) != make_cache_key({"lang": "ja"}, "OK", 1.0)',
      'assert make_cache_key({"xmlLang": "zh-TW"}, "OK", 1.0) != make_cache_key({"xmlLang": "zh-CN"}, "OK", 1.0)',
      'cfg = {"provider": "openai", "voice": "alloy"}',
      'os.environ.pop("TTS_BASE_URL", None)',
      'os.environ["OPENAI_BASE_URL"] = "http://127.0.0.1:1111/v1"',
      'before = make_cache_key(cfg, "OK", 1.0)',
      'os.environ["OPENAI_BASE_URL"] = "http://127.0.0.1:2222/v1"',
      'assert make_cache_key(cfg, "OK", 1.0) != before, "Changing the effective TTS service must invalidate cached audio"',
      'explicit = dict(cfg, baseUrl="http://127.0.0.1:3333/v1/")',
      'fixed = make_cache_key(explicit, "OK", 1.0)',
      'os.environ["TTS_BASE_URL"] = "http://127.0.0.1:4444/v1"',
      'assert make_cache_key(explicit, "OK", 1.0) == fixed, "Explicit baseUrl must override environment defaults in cache identity"',
      'custom = dict(cfg, baseUrlEnv="HTML_VIDEO_TEST_TTS_BASE")',
      'os.environ["HTML_VIDEO_TEST_TTS_BASE"] = "http://127.0.0.1:5555/v1"',
      'before = make_cache_key(custom, "OK", 1.0)',
      'os.environ["HTML_VIDEO_TEST_TTS_BASE"] = "http://127.0.0.1:6666/v1"',
      'assert make_cache_key(custom, "OK", 1.0) != before, "Custom baseUrlEnv must affect cached audio"',
      'azure = {"provider": "azure"}',
      'os.environ["AZURE_SPEECH_REGION"] = "eastus"',
      'before = make_cache_key(azure, "OK", 1.0)',
      'os.environ["AZURE_SPEECH_REGION"] = "westus"',
      'assert make_cache_key(azure, "OK", 1.0) != before, "Effective Azure region must affect cached audio"',
      'azure["endpoint"] = "http://127.0.0.1:7777/speech"',
      'fixed = make_cache_key(azure, "OK", 1.0)',
      'os.environ["AZURE_SPEECH_REGION"] = "eastus"',
      'assert make_cache_key(azure, "OK", 1.0) == fixed, "Explicit Azure endpoint must override environment region in cache identity"',
    ].join('\n'),
  ], { cwd: PKG_ROOT, encoding: 'utf8' });
  assert.equal(pyCheck.status, 0, `Python TTS unit checks failed:\n${pyCheck.stderr}`);
}

function verifyRenderArgumentValidation() {
  const V = { duration: 2, totalDuration: 2, scenes: [{ start: 0, duration: 1 }, { start: 1, duration: 1 }] };
  const cfg = { width: 320, height: 180, fps: 4 };
  const priorFps = process.env.FPS;
  try {
    delete process.env.FPS;
    assert.equal(resolveStageSpec(V, cfg, { fps: 29.97 }).FPS, 29.97, 'Fractional frame rates must remain supported');
    for (const fps of [0, -1, NaN, Infinity]) {
      assert.throws(() => resolveStageSpec(V, cfg, { fps }), /FPS/i, 'Invalid frame rates must fail before rendering');
    }
    process.env.FPS = 'Infinity';
    assert.throws(() => resolveStageSpec(V, cfg, { fps: null }), /FPS/i, 'Invalid environment frame rate must be rejected');
    assert.equal(resolveStageSpec(V, cfg, { fps: 4 }).FPS, 4, 'Explicit frame rate must override the environment');
    delete process.env.FPS;
    for (const duration of [0, -1, NaN, Infinity]) {
      assert.throws(() => resolveStageSpec({ ...V, totalDuration: duration }, cfg, { fps: 4 }), /duration/i, 'Invalid duration must not produce an unbounded render');
    }
    for (const key of ['width', 'height']) {
      for (const value of [0, -2, NaN, Infinity, 321, 320.5]) {
        assert.throws(() => resolveStageSpec(V, { ...cfg, [key]: value }, { fps: 4 }), /width|height/i, 'MP4 dimensions must be finite positive even integers');
      }
    }
    for (const range of ['100:101', '-5:-1', '0:1:2', '0:Infinity', 'bad', '2:1']) {
      assert.throws(() => resolveTimeWindow(V.scenes, V.duration, false, { scene: null, range }), /range/i, 'Invalid or nonoverlapping ranges must be rejected');
    }
    for (const scene of [-1, 2, 1.5, NaN, Infinity]) {
      assert.throws(() => resolveTimeWindow(V.scenes, V.duration, false, { scene }), /scene/i, 'Scene selection must use a valid integer index');
    }
    assert.deepEqual(resolveTimeWindow(V.scenes, 2, false, { scene: null, range: '-1:1' }), { startSec: 0, endSec: 1, isSlice: true });
    assert.deepEqual(resolveTimeWindow(V.scenes, 2, false, { scene: null, range: '1:99' }), { startSec: 1, endSec: 2.5, isSlice: true });
    assert.deepEqual(resolveTimeWindow(V.scenes, 2, false, { scene: 1 }), { startSec: 1, endSec: 2, isSlice: true });
  } finally {
    if (priorFps === undefined) delete process.env.FPS;
    else process.env.FPS = priorFps;
  }
}

function verifyVoiceCacheRegressions() {
  const r = spawnSync(resolvePython(PKG_ROOT, true), [path.join(PKG_ROOT, 'tools/test-voice-cache.py'), path.join(TEST_ROOT, 'voice-cache-check')], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: TEST_ROOT }),
  });
  assert.equal(r.status, 0, `Voice cache regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyMultilingualTokensAndSceneBgm() {
  const py = resolvePython(PKG_ROOT, true);
  const tokCheck = spawnSync(py, [
    '-c',
    [
      'import sys; sys.path.insert(0, "tools")',
      'from voice import TOKEN_RE',
      'assert TOKEN_RE.findall("AI视频") == ["AI", "视", "频"]',
      'assert TOKEN_RE.findall("これはAIです") == ["こ", "れ", "は", "AI", "で", "す"]',
      'assert TOKEN_RE.findall("안녕 AI") == ["안", "녕", "AI"]',
      'assert TOKEN_RE.findall("Café résumé 2026") == ["Café", "résumé", "2026"]',
    ].join('; '),
  ], { cwd: PKG_ROOT, encoding: 'utf8' });
  assert.equal(tokCheck.status, 0, `Python multi-script TOKEN_RE unit checks failed:\n${tokCheck.stderr}`);

  const bgmScDir = path.join(TEST_ROOT, 'scene-bgm-check');
  fs.mkdirSync(bgmScDir, { recursive: true });
  const cuesJson = path.join(bgmScDir, 'cues.json');
  const bgmWav = path.join(bgmScDir, 'bgm.wav');
  fs.writeFileSync(cuesJson, JSON.stringify({
    duration: 4.0,
    videoDir: bgmScDir,
    bgm: { preset: 'ambient', volume: 0.2 },
    sfx: false,
    scenes: [
      { title: 'S1', start: 0, duration: 2.0, bgm: 1.0, cues: [] },
      { title: 'S2', start: 2.0, duration: 2.0, bgm: false, cues: [] },
    ],
  }), 'utf8');
  const mixRes = spawnSync(py, [path.join(PKG_ROOT, 'tools/mix.py'), cuesJson, bgmScDir, '', bgmWav], { encoding: 'utf8' });
  assert.equal(mixRes.status, 0, `Per-scene BGM mix.py failed:\n${mixRes.stderr}`);
  const rmsRes = spawnSync(py, [
    '-c',
    [
      `import soundfile as sf, numpy as np`,
      `y, sr = sf.read(${JSON.stringify(bgmWav)})`,
      `s1 = float(np.sqrt(np.mean(y[int(0.6*sr):int(1.4*sr)]**2)))`,
      `s2 = float(np.sqrt(np.mean(y[int(2.6*sr):int(3.4*sr)]**2)))`,
      `print(f"{s1:.6f},{s2:.6f}")`,
    ].join('; '),
  ], { encoding: 'utf8' });
  const [s1Rms, s2Rms] = (rmsRes.stdout || '').trim().split(',').map(Number);
  assert.ok(s1Rms > 0.005, `Expected S1 BGM RMS > 0.005, got ${s1Rms}`);
  assert.ok(s2Rms < 1e-5, `Expected S2 (bgm: false) mid-scene BGM RMS ~ 0, got ${s2Rms}`);
}

async function verifySfxAndMultiScriptContracts(page, port) {
  await page.goto(`http://127.0.0.1:${port}/demo/?record=1`, { waitUntil: 'networkidle' });
  const recSfx = await page.evaluate(() => window.__video.sfx('click'));
  assert.equal(recSfx, false, 'Record mode must silence V.sfx()');

  await page.goto(`http://127.0.0.1:${port}/demo/`, { waitUntil: 'networkidle' });
  const sfxRes = await page.evaluate(() => {
    window.V._sfxCount = 0;
    const ok1 = window.__video.sfx('click');
    const btn = window.V.u.interactive(window.V.u.h('button', null, 'HIT'), () => {}, { sfx: 'ping' });
    document.getElementById('stage').appendChild(btn);
    btn.click();
    const countAfterTwo = window.V._sfxCount;
    window.__video.setMuted(true);
    const okMuted = window.__video.sfx('click');
    window.__video.setMuted(false);
    window.__video.setVolume(0);
    const okZero = window.__video.sfx('click');
    window.__video.setVolume(1);
    btn.remove();
    return { ok1, countAfterTwo, okMuted, okZero, finalCount: window.V._sfxCount };
  });
  assert.equal(sfxRes.ok1, true, 'Audible V.sfx("click") must return true');
  assert.equal(sfxRes.countAfterTwo, 2, 'V.sfx + interactive({ sfx }) must both trigger WebAudio tone');
  assert.equal(sfxRes.okMuted, false, 'Muted player must suppress V.sfx()');
  assert.equal(sfxRes.okZero, false, '0% volume must suppress V.sfx()');
  assert.equal(sfxRes.finalCount, 2, 'Suppressed V.sfx calls must not increment _sfxCount');

  const multiScript = await page.evaluate(() => {
    const V = window.V;
    const savedScenes = V.scenes.slice();
    const savedLoc = Object.assign({}, V.locales);
    const savedVoice = V.voice;
    const savedCfg = Object.assign({}, V.config);
    V.voice = null;
    V.config.tts = { speakers: { lead: { label: '小灵耳', voice: 'zh-CN-XiaoxiaoNeural', speed: '+6%' } } };
    V.locale('ja', {
      tts: { speakers: { lead: { label: 'リン', voice: 'ja-JP-NanamiNeural' } } },
      scenes: { ms: { lines: ['これは重要なAIテストです。'], anchors: { 关键: '重要' } } },
    });
    V.scenes = [];
    V.scene({
      id: 'ms',
      title: 'MS',
      lines: [
        { speaker: 'lead', text: 'First, check logs, then restart the service now.' },
        { text: 'Café résumé验证通过。' },
      ],
      build() {},
      update() {},
    });
    V.__langOverridden = true;
    V.__activeLang = '';
    V.layout();
    const enSub0 = V.scenes[0].subCues[0].text;
    const speakerZh = V.scenes[0].cues[0].speaker;
    const voiceZh = V.scenes[0].cues[0].voice;
    const ctxZh = V.makeCtx(V.scenes[0], 0);
    const frAt = ctxZh.at(1, 'résumé');
    V.__activeLang = 'ja';
    V.layout();
    const ctxJa = V.makeCtx(V.scenes[0], 0);
    const jaAt = ctxJa.at(0, '关键');
    const speakerJa = V.scenes[0].cues[0].speaker;
    const voiceJa = V.scenes[0].cues[0].voice;
    const rtlAr = V.isRtlLang('ar');
    V.scenes = savedScenes;
    V.locales = savedLoc;
    V.voice = savedVoice;
    V.config = savedCfg;
    V.__langOverridden = false;
    V.__activeLang = '';
    V.layout();
    return { enSub0, speakerZh, voiceZh, frAt, jaAt, speakerJa, voiceJa, rtlAr };
  });
  assert.equal(multiScript.enSub0, 'First, check logs', 'English comma subtitle split must preserve space after comma');
  assert.equal(multiScript.speakerZh, '小灵耳', 'tts.speakers must resolve base speaker label');
  assert.equal(multiScript.voiceZh, 'zh-CN-XiaoxiaoNeural', 'tts.speakers must inherit speaker voice');
  assert.ok(multiScript.frAt > 0.15, `Accented Latin x.at("résumé") must resolve > 0.15s, got ${multiScript.frAt}`);
  assert.ok(multiScript.jaAt > 0.15, `Japanese Kana/Kanji x.at("重要") must resolve > 0.15s, got ${multiScript.jaAt}`);
  assert.equal(multiScript.speakerJa, 'リン', 'Localized tts.speakers must override speaker label');
  assert.equal(multiScript.voiceJa, 'ja-JP-NanamiNeural', 'Localized tts.speakers must override speaker voice');
  assert.equal(multiScript.rtlAr, true, 'Arabic locale must detect RTL direction');
}

async function verifyAutoplayBlockedUnlock(browser, port) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    let gestureSeen = false;
    window.addEventListener('pointerdown', () => { gestureSeen = true; }, true);
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!gestureSeen) return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
      return origPlay.call(this);
    };
  });
  await p.goto(`http://127.0.0.1:${port}/demo/?autoplay=1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(120);
  const blockedSt = await p.evaluate(() => ({
    blocked: window.__video.getSyncState().audioBlocked,
    btnBlockedCls: document.querySelector('[data-act="mute"]').classList.contains('is-blocked'),
    mode: document.querySelector('[data-act="mute"]').dataset.soundMode,
    osd: document.getElementById('osd').textContent,
  }));
  assert.equal(blockedSt.blocked, true, 'NotAllowedError on autoplay must set audioBlocked=true');
  assert.equal(blockedSt.btnBlockedCls, true, 'Blocked autoplay must add .is-blocked on [data-act="mute"]');
  assert.equal(blockedSt.mode, 'volumeMute', 'Blocked autoplay must show volumeMute icon instead of misleading volumeOn');
  assert.ok(blockedSt.osd.includes('点击开启声音'), `Blocked autoplay must flash #osd hint, got "${blockedSt.osd}"`);

  await p.locator('[data-act="mute"]').click();
  await p.waitForTimeout(100);
  const unlockedSt = await p.evaluate(() => ({
    blocked: window.__video.getSyncState().audioBlocked,
    btnBlockedCls: document.querySelector('[data-act="mute"]').classList.contains('is-blocked'),
    menuOpen: document.getElementById('controls').classList.contains('sound-open'),
    osd: document.getElementById('osd').textContent,
  }));
  assert.equal(unlockedSt.blocked, false, 'Clicking [data-act="mute"] must unlock blocked audio');
  assert.equal(unlockedSt.btnBlockedCls, false, 'Unlocking audio must clear .is-blocked');
  assert.equal(unlockedSt.menuOpen, false, 'First click on blocked mute button must unlock audio without popping open .sound-menu');
  assert.equal(unlockedSt.osd, '音量 100%', 'Unlocking blocked audio must confirm active volume in #osd');
  await ctx.close();
}

async function verifyRuntimeSetLangHotSwitch(page, port) {
  await page.goto(`http://127.0.0.1:${port}/demo/`, { waitUntil: 'networkidle' });
  const beforeSwitch = await page.evaluate(() => {
    const s2 = window.V.scenes[1];
    const c0 = s2.cues[0];
    const mid = s2.start + (c0.start + c0.end) * 0.5;
    window.__video.seek(mid);
    return {
      langCount: document.querySelectorAll('.sound-lang-item').length,
      i18nTouchedOnBase: Boolean(window.V.scenes[1].root && window.V.scenes[1].root._i18nTouched),
      docTitle: document.title,
      boxTxt: document.querySelector('.s2-box')?.textContent,
      subTxt: document.querySelector('#subs .sub-text > span:last-child')?.textContent,
    };
  });
  assert.equal(beforeSwitch.langCount, 3, 'Multi-locale config must render 3 language rows in .sound-menu');
  assert.equal(beforeSwitch.i18nTouchedOnBase, false, 'Base locale must skip DOM text scan (zero overhead)');
  assert.equal(beforeSwitch.docTitle, '微内核自检演示');
  assert.equal(beforeSwitch.boxTxt, 'PURE F(T)');
  assert.ok(beforeSwitch.subTxt.includes('时间纯函数'), `Expected zh-CN subtitle before switch, got "${beforeSwitch.subTxt}"`);

  const enSwitch = await page.evaluate(async () => {
    await window.__video.setLang('en');
    const s2 = window.V.scenes[1];
    const c0 = s2.cues[0];
    const st = window.__video.getSyncState();
    const lt = st.now - s2.start;
    return {
      lang: st.lang,
      htmlLang: document.documentElement.getAttribute('lang'),
      docTitle: document.title,
      inS2CueMid: lt >= c0.start + 0.1 && lt <= c0.end - 0.1,
      boxTxt: document.querySelector('.s2-box')?.textContent,
      subTxt: document.querySelector('#subs .sub-text > span:last-child')?.textContent,
      chapHd: document.querySelector('.chap-menu-hd')?.textContent,
      muteTxt: document.querySelector('.sound-menu [data-sound="mute"] span')?.textContent,
      deepLink: window.__video.getDeepLink(),
    };
  });
  assert.equal(enSwitch.lang, 'en', 'setLang("en") must update active lang');
  assert.equal(enSwitch.htmlLang, 'en', 'setLang("en") must update <html lang>');
  assert.equal(enSwitch.docTitle, 'Microkernel Demo EN', 'setLang("en") must update document.title');
  assert.equal(enSwitch.inS2CueMid, true, 'setLang("en") must preserve logical mid-cue position in S2');
  assert.equal(enSwitch.boxTxt, 'PURE F(T) EN', 'setLang("en") must re-render [data-i18n] scene DOM');
  assert.match(enSwitch.subTxt, /Every pure function|deterministic/, `setLang("en") must switch active subtitle, got "${enSwitch.subTxt}"`);
  assert.equal(enSwitch.chapHd, 'CHAPTERS', 'setLang("en") must localize .chap-menu-hd');
  assert.equal(enSwitch.muteTxt, 'Mute All', 'setLang("en") must localize sound menu labels');
  assert.ok(enSwitch.deepLink.includes('lang=en'), `getDeepLink() after setLang("en") must include lang=en, got ${enSwitch.deepLink}`);

  const zhRoundTrip = await page.evaluate(async () => {
    await window.__video.setLang('zh-CN');
    window.__video.seek(0.2);
    return {
      lang: window.__video.getSyncState().lang,
      badgeTxt: document.querySelector('.test-preset-badge')?.textContent,
      chapHd: document.querySelector('.chap-menu-hd')?.textContent,
      muteTxt: document.querySelector('.sound-menu [data-sound="mute"] span')?.textContent,
      deepLink: window.__video.getDeepLink(),
    };
  });
  assert.equal(zhRoundTrip.lang, 'zh-CN', 'setLang("zh-CN") must round-trip back to base lang');
  assert.equal(zhRoundTrip.badgeTxt, 'OPEN-KERNEL', 'x.t() must restore base fallback string after round-trip');
  assert.equal(zhRoundTrip.chapHd, '章节导航', 'setLang("zh-CN") must restore Chinese UI chrome');
  assert.equal(zhRoundTrip.muteTxt, '全部静音', 'setLang("zh-CN") must restore Chinese sound menu label');
  assert.equal(zhRoundTrip.deepLink.includes('lang='), false, 'getDeepLink() on base lang must omit redundant lang param');

  const ghostFallback = await page.evaluate(async () => {
    const ret = await window.__video.setLang('nonexistent');
    return { ret, voiceOk: Boolean(window.V.getActiveVoice && window.V.getActiveVoice()) };
  });
  assert.equal(ghostFallback.ret, 'zh-CN', 'setLang("nonexistent") must roll back to base lang');
  assert.equal(ghostFallback.voiceOk, true, 'Missing locale rollback must preserve base V.voice');
}

async function verifyConcurrentLocaleSwitches(page, port) {
  await page.goto(`http://127.0.0.1:${port}/demo/`, { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => ({ duration: V.duration, lang: V.getActiveLang(), title: document.title, words: V.getActiveVoice()?.words }));
  let release, markRequested;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { markRequested = resolve; });
  const delayedTimings = async route => { markRequested(); await gate; await route.continue(); };
  await page.route('**/timings.en.js', delayedTimings);
  try {
    await page.evaluate(() => { window.__firstLocaleSwitch = V.setLang('en'); });
    await requested;
    await page.evaluate(() => { window.__secondLocaleSwitch = V.setLang('zh-CN'); });
    release();
    await page.evaluate(() => Promise.all([window.__firstLocaleSwitch, window.__secondLocaleSwitch]));
    const after = await page.evaluate(() => ({
      lang: V.getActiveLang(), hasVoice: Boolean(V.getActiveVoice()), duration: V.duration, title: document.title,
      subtitle: V.scenes[0].cues[0].text, words: V.getActiveVoice()?.words,
    }));
    assert.equal(after.lang, before.lang, 'The latest language choice must remain active');
    assert.ok(after.hasVoice, 'Late timing scripts must not replace the latest selected voice');
    assert.equal(after.duration, before.duration, 'Concurrent language switches must retain the selected timeline');
    assert.equal(after.title, before.title, 'Concurrent language switches must retain the selected document title');
    assert.match(after.subtitle, /欢迎体验/, 'Concurrent language switches must retain the selected subtitles');
    assert.deepEqual(after.words, before.words, 'Concurrent language switches must retain word anchor timestamps');
    await page.waitForFunction(() => window.__video.getSyncState().readyState >= 1, null, { timeout: 10000 });
    const recovered = await page.evaluate(async () => {
      let failOnce = true;
      V.use({ name: 'locale-switch-error', onLocaleChange() { if (failOnce) { failOnce = false; throw new Error('Locale hook failed'); } } });
      const results = await Promise.allSettled([V.setLang('en'), V.setLang('zh-CN')]);
      return { statuses: results.map(r => r.status), lang: V.getActiveLang(), hasVoice: Boolean(V.getActiveVoice()) };
    });
    assert.deepEqual(recovered.statuses, ['rejected', 'fulfilled'], 'A failed language switch must not prevent the next request');
    assert.equal(recovered.lang, before.lang, 'Language switching must recover after an extension hook throws');
    assert.ok(recovered.hasVoice, 'Recovery must restore the requested voice');
  } finally {
    release();
    await page.unroute('**/timings.en.js', delayedTimings);
  }
}

async function verifySingleLangOptOutSafety(browser, port) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  const probedUrls = [];
  p.on('request', req => {
    if (/\/locales\/|timings\.[a-z-]+\.js/i.test(req.url())) probedUrls.push(req.url());
  });
  await p.goto(`http://127.0.0.1:${port}/demo/?lang=fr`, { waitUntil: 'networkidle' });
  const unlisted = await p.evaluate(() => ({
    lang: window.__video.getSyncState().lang,
    voiceOk: Boolean(window.V.getActiveVoice && window.V.getActiveVoice()),
    hasBgm: window.__video.getSyncState().hasBgm,
  }));
  assert.equal(probedUrls.length, 0, 'Unlisted ?lang=fr must not trigger 404 locale/timings probes');
  assert.equal(unlisted.lang, 'zh-CN', 'Unlisted ?lang=fr must fall back to base lang');
  assert.equal(unlisted.voiceOk, true, 'Unlisted ?lang=fr must preserve base V.voice');
  assert.equal(unlisted.hasBgm, true, 'Unlisted ?lang=fr must preserve base audio/BGM');

  await p.route('**/demo/video.config.js', async route => {
    const resp = await route.fetch();
    const txt = (await resp.text()).replace(/locales:\s*\[[^\]]*\],?\s*/g, '');
    await route.fulfill({ response: resp, body: txt });
  });
  await p.goto(`http://127.0.0.1:${port}/demo/?lang=en`, { waitUntil: 'networkidle' });
  const singleLang = await p.evaluate(() => ({
    lang: window.__video.getSyncState().lang,
    langCount: document.querySelectorAll('.sound-lang-item').length,
    chapHd: document.querySelector('.chap-menu-hd')?.textContent,
    voiceOk: Boolean(window.V.getActiveVoice && window.V.getActiveVoice()),
    hasBgm: window.__video.getSyncState().hasBgm,
  }));
  assert.equal(probedUrls.length, 0, 'Single-language video (no locales config) must ignore ?lang=en with zero probes');
  assert.equal(singleLang.lang, 'zh-CN', 'Single-language video must ignore external ?lang=en');
  assert.equal(singleLang.langCount, 0, 'Single-language video must render zero language rows');
  assert.equal(singleLang.chapHd, '章节导航', 'Single-language video must keep base UI chrome under ?lang=en');
  assert.equal(singleLang.voiceOk, true, 'Single-language video must keep V.voice under ?lang=en');
  assert.equal(singleLang.hasBgm, true, 'Single-language video must keep audio & BGM under ?lang=en');
  await ctx.close();
}

async function verifyPptOptInDefaultOff(browser, port) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  await p.route('**/demo/video.config.js', async route => {
    const resp = await route.fetch();
    const txt = (await resp.text()).replace(/ppt:\s*true,?\s*/g, '');
    await route.fulfill({ response: resp, body: txt });
  });
  await p.goto(`http://127.0.0.1:${port}/demo/?ppt=1`, { waitUntil: 'networkidle' });
  const st = await p.evaluate(() => ({
    pptMode: Boolean(window.__video && window.__video.pptMode),
    bodyPpt: document.body.classList.contains('ppt-mode'),
    toPptBtn: Boolean(document.querySelector('[data-act="to-ppt"]')),
    pptBar: Boolean(document.querySelector('[data-ppt-act]')),
  }));
  assert.equal(st.pptMode, false, 'Video without ppt:true must ignore ?ppt=1 and stay in video mode');
  assert.equal(st.bodyPpt, false, 'Video without ppt:true must not get body.ppt-mode');
  assert.equal(st.toPptBtn, false, 'Video without ppt:true must not render [data-act="to-ppt"]');
  assert.equal(st.pptBar, false, 'Video without ppt:true must not render PPT control bar');
  await ctx.close();
}

async function verifyOptionalReturnLink(browser, port) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    for (const mode of ['', '?ppt=1']) {
      await page.goto(`http://127.0.0.1:${port}/demo/${mode}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.ctrl-home').getAttribute('href'), '../index.html', 'Return link must use the project URL');
    }
    await page.route('**/demo/video.config.js', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('homeUrl: "../index.html",', '');
      await route.fulfill({ response, body });
    });
    for (const mode of ['', '?ppt=1']) {
      await page.goto(`http://127.0.0.1:${port}/demo/${mode}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.ctrl-home').count(), 0, 'Player must omit return links when homeUrl is absent');
    }
  } finally {
    await ctx.close();
  }
}

async function verifyPptNavigationSteps(page) {
  await page.mouse.click(320, 160);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.__video.page), 1, 'Clicking blank canvas in PPT mode must NOT advance slide');

  await page.evaluate(() => {
    window.V.scenes[1].pptFrames = [0.6, 1.8];
    window.V._pptRuntime.rebuildPages();
    window.V._pptRuntime.syncUI();
  });
  await page.locator('[data-ppt-act="next"]').click();
  const afterNext = await page.evaluate(() => window.__video.getSyncState());
  assert.equal(afterNext.page, 2, 'Clicking next button must advance to Page 2');
  assert.equal(afterNext.totalPages, 3, 'Rebuilt custom pptFrames must yield 3 slides');

  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.__video.page), 3, 'ArrowRight must advance immediately to Page 3');

  await page.mouse.move(320, 160);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.__video.page), 2, 'Wheel up must step back to Page 2');

  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => window.__video.page), 1, 'Home must jump to Page 1');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => window.__video.page), 3, 'End must jump to last slide');
}

async function verifyPptModeSwitch(page) {
  await page.evaluate(() => window.__video.goToPage(2));
  assert.equal(await page.evaluate(() => window.__video.getSyncState().sceneIndex), 1);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator('[data-act="to-video"]').click(),
  ]);
  const vidSt = await page.evaluate(() => ({
    url: location.href,
    st: window.__video.getSyncState(),
    hasToPpt: Boolean(document.querySelector('[data-act="to-ppt"]')),
  }));
  assert.equal(vidSt.st.pptMode, false, 'to-video must switch into video mode');
  assert.ok(vidSt.url.includes('scene=1') && !vidSt.url.includes('ppt=1'), `to-video URL must carry ?scene=1 without ppt=1, got ${vidSt.url}`);
  assert.equal(vidSt.st.sceneIndex, 1, 'to-video must preserve Scene 1');
  assert.equal(vidSt.hasToPpt, true, 'Video mode bar must expose to-ppt button when cfg.ppt is true');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator('[data-act="to-ppt"]').click(),
  ]);
  const backSt = await page.evaluate(() => ({ url: location.href, st: window.__video.getSyncState() }));
  assert.equal(backSt.st.pptMode, true, 'to-ppt must switch back to PPT mode');
  assert.ok(backSt.url.includes('ppt=1') && backSt.url.includes('scene=1'), `to-ppt URL must carry ?ppt=1&scene=1, got ${backSt.url}`);
  assert.equal(backSt.st.sceneIndex, 1, 'to-ppt must land on Scene 1');
}

async function verifyPptDeckMode(page, port) {
  const mediaReqs = [];
  const onReq = req => { if (/\.m4a(\?|$)/i.test(req.url())) mediaReqs.push(req.url()); };
  page.on('request', onReq);
  await page.goto(`http://127.0.0.1:${port}/demo/?ppt=1`, { waitUntil: 'networkidle' });
  page.off('request', onReq);
  assert.equal(mediaReqs.length, 0, 'PPT mode must not fetch soundtrack.m4a or bgm.m4a');

  const init = await page.evaluate(() => {
    const st = window.__video.getSyncState();
    const hint = document.getElementById('start-hint');
    const lead = document.querySelector('#subs .sub-lead');
    return {
      st,
      s0Dur: window.V.scenes[0].duration,
      hintDisplay: getComputedStyle(hint).display,
      leadDisplay: getComputedStyle(lead).display,
      energy: window.V.getSceneEnergy(window.V.scenes[0], 0, 0.5),
      hasPreset: Boolean(document.querySelector('.test-preset-badge')),
      hasVideoCtrls: Boolean(document.querySelector('[data-act="play"], [data-act="rate"], [data-act="mute"]')),
      hasToVideo: Boolean(document.querySelector('[data-act="to-video"]')),
      prevDisabled: document.querySelector('[data-ppt-act="prev"]').disabled,
      pageNumTxt: document.querySelector('.ppt-page-num').textContent,
    };
  });
  await page.waitForTimeout(80);
  const afterIdle = await page.evaluate(() => window.__video.getSyncState());
  assert.equal(init.st.pptMode, true, '?ppt=1 must enable pptMode');
  assert.equal(init.st.subsEnabled, false, 'PPT mode must hide subtitles/notes by default');
  assert.equal(init.st.page, 1, 'PPT mode must start on Page 1');
  assert.ok(init.st.now > init.s0Dur - 0.3, 'PPT Page 1 must settle near end of Scene 0');
  assert.ok(afterIdle.clock > init.st.clock, 'PPT mode ambient clock must advance live while timeline stays settled');
  assert.equal(afterIdle.now, init.st.now, 'PPT mode timeline must remain frozen on settled page');
  assert.equal(init.hasPreset, true, 'PPT Page 1 must execute Scene 0 build/update on boot');
  assert.equal(init.hintDisplay, 'none', 'PPT mode must hide #start-hint');
  assert.equal(init.leadDisplay, 'none', 'PPT mode must hide #subs .sub-lead mascot slot');
  assert.equal(init.energy, 0, 'PPT mode must keep speech energy at 0');
  assert.equal(init.hasVideoCtrls, false, 'PPT mode must replace video bar with clean PPT bar');
  assert.equal(init.hasToVideo, true, 'PPT mode bar must expose to-video switcher button');
  assert.equal(init.prevDisabled, true, 'Prev button must be disabled on Page 1');
  assert.equal(init.pageNumTxt, '1 / 2', 'PPT page badge must render "1 / 2"');

  await page.locator('[data-act="subs"]').click();
  const notes = await page.evaluate(() => ({
    subsOn: window.__video.getSyncState().subsEnabled,
    subVis: getComputedStyle(document.getElementById('subs')).visibility,
    subOp: getComputedStyle(document.getElementById('subs')).opacity,
    subTxt: document.querySelector('#subs .sub-text > span:last-child')?.textContent,
  }));
  assert.equal(notes.subsOn, true, 'Clicking [data-act="subs"] in PPT mode must open speaker teleprompter');
  assert.equal(notes.subVis, 'visible', 'Speaker teleprompter must render #subs visible');
  assert.equal(notes.subOp, '1', 'Speaker teleprompter must stay at opacity 1 without fade-out');
  assert.ok(notes.subTxt && notes.subTxt.includes('微内核时间轴引擎'), 'Speaker teleprompter must show full Scene 0 script');

  await verifyPptNavigationSteps(page);
  assert.ok(await page.evaluate(() => {
    const dl = window.__video.getDeepLink();
    return dl.includes('ppt=1') && dl.includes('page=3');
  }), 'PPT deep link must encode ?ppt=1&page=3');

  await verifyPptModeSwitch(page);
}

async function verifyAnimationClockFrameReuse(browser) {
  const baseCss = fs.readFileSync(path.join(PKG_ROOT, 'runtime/base/css/base.css'), 'utf8');
  for (const grouped of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    try {
      await page.setContent(`<style>${baseCss}html,body{margin:0}#stage{position:static;transform:none;width:320px;height:180px;background:red}</style><body class="record"><div id="stage"></div></body>`);
      await page.evaluate(() => {
        window.V = { async seekToAsync(sec) {
          document.getElementById('stage').style.setProperty('--tg', String(sec));
          document.getElementById('stage').style.setProperty('--anim-t', `${-sec}s`);
        } };
      });
      await page.evaluate(installFrameReuseProbe);
      assert.equal(await page.evaluate(() => window.__seekAndDedupe(0.1)), false);
      assert.equal(await page.evaluate(() => window.__seekAndDedupe(0.2)), true, 'The built-in animation delay alone must preserve static frame reuse');
      await page.evaluate(grouped => {
        const style = document.createElement('style');
        const rule = '#stage{background:hsl(atan2(var(--anim-t),1s) 100% 50%)}';
        style.textContent = grouped ? `@media(min-width:0px){${rule}}` : rule;
        document.head.append(style);
      }, grouped);
      await page.evaluate(() => window.__seekAndDedupe(0.1));
      const before = await page.screenshot();
      const reused = await page.evaluate(() => window.__seekAndDedupe(0.8));
      const after = await page.screenshot();
      assert.ok(!before.equals(after), 'The animation clock CSS fixture must visibly change');
      assert.equal(reused, false, 'CSS driven by --anim-t must not reuse a previous frame');
    } finally { await page.close(); }
  }
}

async function verifyFrameReuseStateTracking(browser) {
  const modes = ['body-style', 'body-attribute', 'stage-style', 'stage-class', 'root-attribute', 'input-21', 'checkbox-indeterminate', 'select-multiple', 'scroll-swap', 'css-rule', 'css-disabled', 'late-clock-style', 'imported-clock-style', 'adopted-rule'];
  for (const mode of modes) {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    try {
      await page.setContent('<style>html,body{margin:0}#stage{width:320px;height:180px;background:red}#stage.alternate{background:blue}html[data-phase="alternate"] #stage,body[data-phase="alternate"] #stage{background:blue}input{font:60px Arial;width:300px}.scroll{display:inline-block;width:100px;height:80px;overflow:hidden}.content{height:200px;background:linear-gradient(red 50%,blue 50%)}</style><div id="stage"></div>');
      await page.evaluate(async mode => {
        const stage = document.getElementById('stage');
        if (mode === 'input-21') {
          for (let i = 0; i < 21; i++) {
            const input = document.createElement('input');
            input.style.display = i < 20 ? 'none' : 'block';
            stage.append(input);
          }
        }
        if (mode === 'checkbox-indeterminate') {
          stage.innerHTML = '<input type="checkbox" style="width:80px;height:80px">';
        }
        if (mode === 'select-multiple') {
          stage.innerHTML = '<select multiple size="3" style="font:24px Arial"><option selected>A</option><option>B</option><option>C</option></select>';
        }
        if (mode === 'scroll-swap') {
          stage.innerHTML = '<div class="scroll"><div class="content"></div></div><div class="scroll"><div class="content"></div></div>';
        }
        if (mode === 'late-clock-style' || mode === 'imported-clock-style') {
          stage.innerHTML = '<div class="moving" style="width:100px;height:100px;background:blue"></div>';
        }
        if (mode === 'imported-clock-style') {
          const url = 'data:text/css,' + encodeURIComponent('.moving{transform:translateX(calc(var(--tg)*100px))}').replace(/-/g, '%2D');
          const style = document.createElement('style');
          const ready = new Promise(resolve => { style.onload = resolve; style.onerror = resolve; });
          style.textContent = `@import url("${url}");`;
          document.head.append(style);
          await ready;
        }
        if (mode === 'adopted-rule') {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync('#stage{background:red}');
          document.adoptedStyleSheets = [sheet];
        }
        const update = {
          'body-style': alt => { document.body.style.filter = alt ? 'hue-rotate(90deg)' : 'none'; },
          'body-attribute': alt => { document.body.dataset.phase = alt ? 'alternate' : 'normal'; },
          'stage-style': alt => { stage.style.opacity = alt ? '0.2' : '1'; },
          'stage-class': alt => { stage.classList.toggle('alternate', alt); },
          'root-attribute': alt => { document.documentElement.dataset.phase = alt ? 'alternate' : 'normal'; },
          'input-21': alt => { stage.lastElementChild.value = alt ? '222' : '111'; },
          'checkbox-indeterminate': alt => { stage.lastElementChild.indeterminate = alt; },
          'select-multiple': alt => { stage.lastElementChild.options[1].selected = alt; },
          'scroll-swap': alt => {
            stage.children[0].scrollTop = alt ? 80 : 0;
            stage.children[1].scrollTop = alt ? 0 : 80;
          },
          'css-rule': alt => { document.styleSheets[0].cssRules[1].style.backgroundColor = alt ? 'blue' : 'red'; },
          'css-disabled': alt => { document.styleSheets[0].disabled = alt; },
          'adopted-rule': alt => { document.adoptedStyleSheets[0].cssRules[0].style.backgroundColor = alt ? 'blue' : 'red'; },
          'imported-clock-style': () => {},
          'late-clock-style': alt => {
            if (!alt || document.getElementById('late-clock-style')) return;
            const style = document.createElement('style');
            style.id = 'late-clock-style';
            style.textContent = '.moving{transform:translateX(calc(var(--tg)*100px))}';
            document.head.append(style);
          },
        };
        window.V = { async seekToAsync(sec) {
          stage.style.setProperty('--tg', String(sec));
          stage.style.setProperty('--anim-t', `${-sec}s`);
          update[mode](sec > 0.5);
        } };
      }, mode);
      await page.evaluate(installFrameReuseProbe);
      assert.equal(await page.evaluate(() => window.__seekAndDedupe(0.1)), false, `${mode}: first frame cannot be reused`);
      const before = await page.screenshot();
      const reused = await page.evaluate(() => window.__seekAndDedupe(0.8));
      const after = await page.screenshot();
      assert.ok(!before.equals(after), `${mode}: regression fixture must visibly change the frame`);
      assert.equal(reused, false, `${mode}: visible changes must not reuse the previous frame`);
      assert.equal(await page.evaluate(() => window.__seekAndDedupe(0.9)), !['late-clock-style', 'imported-clock-style'].includes(mode), `${mode}: reuse must follow visible state and active clock styles`);
    } finally { await page.close(); }
  }
}

async function verifyShadowDomFrameReuse(browser) {
  for (const mode of ['open', 'closed', 'existing-open', 'declarative-open', 'declarative-closed']) {
    for (const target of ['child', 'stage']) {
      const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
      try {
        await page.setContent('<style>html,body{margin:0}#stage{width:320px;height:180px;background:white}</style><div id="stage"><div id="host"></div></div>');
        if (mode !== 'existing-open') await page.evaluate(installFrameReuseProbe);
        await page.evaluate(({ mode, target }) => {
          const host = document.getElementById(target === 'stage' ? 'stage' : 'host');
          let fill;
          if (mode.startsWith('declarative-')) {
            customElements.define('paint-box', class extends HTMLElement {
              constructor() { super(); this.internals = this.attachInternals(); }
            });
            host.setHTMLUnsafe(`<paint-box><template shadowrootmode="${mode.slice(12)}"><div></div></template></paint-box>`);
            fill = host.firstElementChild.internals.shadowRoot.firstElementChild;
          } else {
            const shadow = host.attachShadow({ mode: mode === 'closed' ? 'closed' : 'open' });
            fill = document.createElement('div');
            shadow.append(fill);
          }
          fill.style.cssText = 'width:320px;height:180px';
          window.V = { async seekToAsync(sec) { fill.style.background = sec < 0.5 ? 'red' : 'blue'; } };
        }, { mode, target });
        if (mode === 'existing-open') await page.evaluate(installFrameReuseProbe);
        assert.equal(await page.evaluate(() => window.__seekAndDedupe(0.1)), false);
        const before = await page.screenshot();
        const reused = await page.evaluate(() => window.__seekAndDedupe(0.8));
        const after = await page.screenshot();
        assert.ok(!before.equals(after), `${mode}/${target}: shadow content must visibly change`);
        assert.equal(reused, false, `${mode}/${target}: shadow changes must not reuse a previous frame`);
        await page.evaluate(() => {
          const stage = document.getElementById('stage');
          stage.replaceWith(stage.cloneNode(false));
        });
        assert.equal(await page.evaluate(() => window.__seekAndDedupe(1)), false);
        assert.equal(await page.evaluate(() => window.__seekAndDedupe(1.1)), true, 'Removing shadow content must restore ordinary static frame reuse');
      } finally { await page.close(); }
    }
  }
}

async function verifySvgUseFrameReuse(browser) {
  const modes = ['inside-href', 'inside-xlink', 'inside-absolute', 'inside-encoded', 'outside-href', 'outside-xlink', 'outside-absolute', 'outside-encoded'];
  for (const mode of modes) {
    const inside = mode.startsWith('inside');
    const id = mode.endsWith('encoded') ? '绘制色块' : 'shared-paint';
    const fragment = mode.endsWith('encoded') ? encodeURIComponent(id) : id;
    const href = `${mode.endsWith('absolute') ? 'http://svg-frame.test/' : ''}#${fragment}`;
    const attr = mode.endsWith('xlink') ? 'xlink:href' : 'href';
    const definition = `<defs><rect id="${id}" width="320" height="180"/></defs>`;
    const external = inside ? '' : `<svg width="0" height="0" style="position:absolute">${definition}</svg>`;
    const content = `<!doctype html><style>html,body{margin:0}#stage{width:320px;height:180px}</style>${external}<div id="stage"><svg width="320" height="180" xmlns:xlink="http://www.w3.org/1999/xlink">${inside ? definition : ''}<use ${attr}="${href}"/></svg></div>`;
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    try {
      await page.route('http://svg-frame.test/**', route => route.fulfill({ body: content, contentType: 'text/html; charset=utf-8' }));
      await page.goto('http://svg-frame.test/');
      await page.evaluate(installFrameReuseProbe);
      await page.evaluate(id => {
        window.V = { async seekToAsync(sec) { document.getElementById(id).setAttribute('fill', sec < 0.5 ? 'red' : 'blue'); } };
      }, id);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      const before = await page.screenshot();
      const reused = await page.evaluate(() => __seekAndDedupe(0.8));
      assert.ok(!before.equals(await page.screenshot()), `${mode}: the SVG reference must visibly update`);
      assert.equal(reused, false, `${mode}: changing a referenced definition must not reuse a stale frame`);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.9)), inside, `${mode}: only definitions inspected inside the stage can keep static frame reuse`);
      await page.evaluate(() => {
        document.getElementById('stage').innerHTML = '<div style="width:320px;height:180px;background:blue"></div>';
        window.V.seekToAsync = async () => {};
      });
      assert.equal(await page.evaluate(() => __seekAndDedupe(1)), false);
      assert.equal(await page.evaluate(() => __seekAndDedupe(1.1)), true, 'Removing external SVG references must restore ordinary static frame reuse');
    } finally { await page.close(); }
  }
}

async function verifyNativeControlFrameReuse(browser) {
  const fields = {
    'input-range': '<input id="first" value="AAAA BBBB">',
    'textarea-range': '<textarea id="first" spellcheck="false">AAAA BBBB</textarea>',
    'document-range': '<div id="first" contenteditable="true" spellcheck="false">AAAA BBBB</div>',
    'button-focus': '<button id="first" class="half">First</button><button id="second" class="half">Second</button>',
    'focus-outside': '<button id="first">First</button>',
    'focus-sibling': '<div id="first">Panel</div>',
    'input-validity': '<input id="first" data-validity value="unchanged">',
    'textarea-validity': '<textarea id="first" data-validity>unchanged</textarea>',
    'select-validity': '<select id="first" data-validity><option>unchanged</option></select>',
  };
  for (const [mode, content] of Object.entries(fields)) {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    try {
      await page.setContent(`<style>html,body{margin:0}#stage{width:320px;height:180px;position:relative;overflow:hidden}#stage>*{position:absolute;left:0;top:0;width:320px;height:180px;box-sizing:border-box;font:36px monospace;padding:12px;border:2px solid black;outline:none;caret-color:transparent;background:white}#stage>*:focus,#external-a:focus~#stage>*{background:#ffe6a7}#stage>[data-validity]:valid{background:#00dd44}#stage>[data-validity]:invalid{background:#ff2255}#stage ::selection{background:#1769ff;color:white}#stage>.half{height:90px}#second{top:90px}.external{position:fixed;top:0;left:0;width:0;height:0;min-width:0;min-height:0;padding:0;border:0;opacity:0}</style><button id="external-a" class="external">External A</button><button id="external-b" class="external">External B</button><div id="stage">${content}</div>`);
      await page.evaluate(installFrameReuseProbe);
      await page.evaluate(mode => {
        const first = document.getElementById('first');
        const focusTargets = {
          'button-focus': ['first', 'second'],
          'focus-outside': ['first', 'external-b'],
          'focus-sibling': ['external-a', 'external-b'],
        }[mode];
        window.V = { async seekToAsync(sec) {
          const later = sec >= 0.5;
          if (mode.endsWith('-validity')) { first.setCustomValidity(later ? 'Please review this value' : ''); return; }
          if (mode === 'input-range' || mode === 'textarea-range') {
            first.focus(); first.setSelectionRange(later ? 5 : 0, later ? 9 : 4); return;
          }
          if (mode === 'document-range') {
            first.focus();
            const range = document.createRange();
            range.setStart(first.firstChild, later ? 5 : 0); range.setEnd(first.firstChild, later ? 9 : 4);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            return;
          }
          document.getElementById(focusTargets[later ? 1 : 0]).focus();
        } };
      }, mode);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      const before = await page.screenshot({ caret: 'initial' });
      const reused = await page.evaluate(() => __seekAndDedupe(0.8));
      assert.ok(!before.equals(await page.screenshot({ caret: 'initial' })), `${mode}: native control state must visibly change`);
      assert.equal(reused, false, `${mode}: native state changes must not reuse a stale frame`);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.9)), true, `${mode}: unchanged native state must retain static frame reuse`);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      assert.ok(before.equals(await page.screenshot({ caret: 'initial' })), `${mode}: backward seeking must restore the same native rendering`);
      await page.evaluate(() => {
        document.activeElement.blur(); getSelection().removeAllRanges();
        document.getElementById('stage').innerHTML = '<div>Static</div>';
        window.V.seekToAsync = async () => {};
      });
      assert.equal(await page.evaluate(() => __seekAndDedupe(1)), false);
      assert.equal(await page.evaluate(() => __seekAndDedupe(1.1)), true, 'Clearing native state must preserve ordinary static reuse');
    } finally { await page.close(); }
  }
}

async function verifyInitTitleEscaping(browser, port) {
  const cases = [
    ['title-special', 'O\'Reilly "HTML" &amp; <Video>'],
    ['title-literal', '第一行\n第二行\\ ` ${literal} $& $$ $\' $` __VIDEO_ID__ __STAGE_WIDTH__'],
  ];
  for (const [id, title] of cases) {
    runCliCmd(['init', id, '--title', title]);
    const { sandbox } = loadVideoSandbox(TEST_ROOT, id);
    assert.equal(sandbox.V.config.title, title, 'init must preserve the literal title in valid JavaScript');
    const html = fs.readFileSync(path.join(TEST_ROOT, 'videos', id, 'index.html'), 'utf8');
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    try {
      const parsedTitle = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('title').textContent, html);
      assert.equal(parsedTitle, title, 'HTML title text must preserve characters and entity-like text');
      await page.goto(`http://127.0.0.1:${port}/${id}/?record=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.V?.seekToAsync);
      const shownTitle = await page.locator('h1.tpl-title').textContent();
      assert.equal(shownTitle, title, 'Initialized scenes must display the literal title');
    } finally {
      await page.close();
      fs.rmSync(path.join(TEST_ROOT, 'videos', id), { recursive: true, force: true });
    }
  }
}

async function verifyDelayedLocalePlayback(browser, port) {
  const id = 'locale-playback';
  const dir = path.resolve(TEST_ROOT, 'videos', id);
  assert.equal(path.dirname(dir), path.resolve(TEST_ROOT, 'videos'));
  fs.mkdirSync(path.join(dir, 'assets/voice'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="assets/voice/timings.js"></script><script src="scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:640,height:360,lang:"zh-CN",locales:["zh-CN","en"],lead:0,tail:0,gap:0,bgm:false,sceneScripts:["scenes.js"],ui:{persist:false,livePause:false,hud:false}};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'V.scene({id:"intro",lines:["中文配音。"],build(root){this.clip=V.u.videoClip("assets/clip.mp4",{loop:true,style:{width:"160px",height:"90px"}});root.append(this.clip);},update(t){V.u.syncVideoClip(this.clip,t);}});');
  fs.writeFileSync(path.join(dir, 'locales/en.js'), 'V.locale("en",{scenes:{intro:{lines:["English narration."]}}});');
  const ffmpeg = resolveFfmpeg(PKG_ROOT);
  for (const [lang, name, duration] of [['zh-CN', 'base', 3], ['en', 'en', 30]]) {
    const audio = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, path.join(dir, 'assets', name + '.wav')]);
    assert.equal(audio.status, 0, String(audio.stderr));
    fs.writeFileSync(path.join(dir, 'assets/voice', lang === 'en' ? 'timings.en.js' : 'timings.js'), 'V.voice=' + JSON.stringify({ lang, src: `assets/${name}.wav`, durations: [[duration]] }) + ';');
  }
  const video = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=3:r=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'assets/clip.mp4')]);
  assert.equal(video.status, 0, String(video.stderr));
  try {
    for (const action of [
      { kind: 'keep', at: 2.5, playing: true, target: 'en', lang: 'en', mapped: 25 },
      { kind: 'pause', at: 2.5, playing: false, target: 'en', lang: 'en', mapped: 25 },
      { kind: 'seek', at: 1.5, playing: true, target: 'en', lang: 'en', mapped: 15 },
      { kind: 'missing', at: 2.5, playing: true, target: 'missing', lang: 'zh-CN', mapped: 2.5 },
    ]) {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      try {
        const timingsPattern = `**/timings.${action.target}.js`;
        await page.route(timingsPattern, async route => { await gate; await route.continue(); });
        await page.goto(`http://127.0.0.1:${port}/${id}/`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__video?.getSyncState().readyState >= 2 && document.querySelector('video')?.readyState >= 2);
        const requested = page.waitForRequest(timingsPattern, { timeout: 10000 });
        await page.evaluate(target => { __video.seek(2.5); __video.play(); window.__localePlayback = V.setLang(target); }, action.target);
        await requested;
        await page.evaluate(action => {
          if (action.kind === 'pause') __video.pause();
          if (action.kind === 'seek') __video.seek(action.at);
        }, action);
        await page.waitForTimeout(1100);
        const during = await page.evaluate(() => ({ ...__video.getSyncState(), clipPaused: document.querySelector('video').paused }));
        release();
        const after = await page.evaluate(async () => {
          await window.__localePlayback;
          const state = __video.getSyncState();
          __video.pause();
          return state;
        });
        assert.ok(Math.abs(during.now - action.at) < 0.001, 'Locale loading must hold the narrative at the latest requested position');
        assert.equal(during.playing, action.playing, 'Locale loading must retain the latest playback intent');
        assert.ok(during.audioPaused && during.clipPaused, 'Previous narration and embedded video must remain paused while locale assets load');
        assert.equal(after.lang, action.lang, 'The delayed language request must finish in the selected locale or restore the previous locale');
        assert.equal(after.playing, action.playing, 'Completing a language change must respect a user pause during loading');
        assert.ok(Math.abs(after.now - action.mapped) < 0.001, 'A seek during loading must map its latest logical cue position');
      } finally { release(); await page.close(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function verifyLocaleResumeProgress(browser, port) {
  const id = 'locale-resume';
  const dir = path.resolve(TEST_ROOT, 'videos', id);
  assert.equal(path.dirname(dir), path.resolve(TEST_ROOT, 'videos'));
  fs.mkdirSync(path.join(dir, 'assets/voice'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="assets/voice/timings.js"></script><script src="scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:640,height:360,lang:"zh-CN",locales:["zh-CN","en"],audioSrc:false,bgm:false,sceneScripts:["scenes.js"],ui:{persist:true,resume:true,resumeMinSec:1,livePause:false,hud:false}};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'V.scene({duration:30,lines:[],build(){},update(){}});');
  fs.writeFileSync(path.join(dir, 'locales/en.js'), 'V.locale("en",{title:"Resume EN"});');
  for (const lang of ['zh-CN', 'en']) {
    const name = lang === 'en' ? 'timings.en.js' : 'timings.js';
    fs.writeFileSync(path.join(dir, 'assets/voice', name), 'V.voice=' + JSON.stringify({ lang, durations: [[]] }) + ';if(V.captureVoice)V.captureVoice(V.voice);');
  }
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  try {
    await page.goto(`http://127.0.0.1:${port}/${id}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__video);
    const base = await page.evaluate(() => {
      __video.seek(5);
      V._prefsRuntime.flushProgress(5, false);
      return V._prefsRuntime.readSaved(V._getUiCfg(V.getCfg()));
    });
    assert.equal(base.t, 5, 'The base locale must save its paused progress');
    const switched = await page.evaluate(async () => {
      await V.setLang('en');
      V._prefsRuntime.flushProgress(__video.getSyncState().now, false);
      return V._prefsRuntime.readSaved(V._getUiCfg(V.getCfg()));
    });
    assert.equal(switched?.t, 5, 'The same timestamp in another locale must save that locale progress');
    await page.goto(`http://127.0.0.1:${port}/${id}/?lang=en`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__video);
    assert.equal(await page.evaluate(() => __video.getSyncState().now), 5, 'Reloading the selected locale must resume at its saved position');
    const reset = await page.evaluate(() => {
      V.clearSavedState();
      const empty = V._prefsRuntime.readSaved(V._getUiCfg(V.getCfg()));
      V._prefsRuntime.flushProgress(5, false);
      return { empty, saved: V._prefsRuntime.readSaved(V._getUiCfg(V.getCfg())) };
    });
    assert.equal(reset.empty, null, 'Clearing saved state must remove the current locale progress');
    assert.equal(reset.saved.t, 5, 'Cleared progress must be saved again even at the previous timestamp');
    const restored = await page.evaluate(async () => {
      await V.setLang('zh-CN');
      return V._prefsRuntime.readSaved(V._getUiCfg(V.getCfg()));
    });
    assert.equal(restored.t, 5, 'Clearing another locale must preserve the base locale progress');
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyConsumedInputEvents(browser, port) {
  const id = 'consumed-input';
  const dir = path.resolve(TEST_ROOT, 'videos', id);
  assert.equal(path.dirname(dir), path.resolve(TEST_ROOT, 'videos'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:640,height:360,audioSrc:false,bgm:false,ppt:true,ui:{hud:false,persist:false,livePause:false},sceneScripts:["scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `for(let i=0;i<3;i++)V.scene({title:'Widget '+i,duration:10,lines:[],build(root){
const widget=V.u.interactive(V.u.h('div',{id:'input-widget',tabindex:'0',role:'listbox',style:'position:absolute;inset:40px;background:white;color:black'},'Component input'),{
keydown(e){if(['ArrowRight','/',' ','Escape'].includes(e.key)){e.preventDefault();this.dataset.handled=e.key;}},
wheel(e){e.preventDefault();this.dataset.wheeled='yes';}
});root.append(widget);},update(){}});`);
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  try {
    for (const mode of ['video', 'ppt']) {
      await page.goto(`http://127.0.0.1:${port}/${id}/${mode === 'ppt' ? '?ppt=1' : ''}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__video);
      const before = await page.evaluate(() => ({ now: __video.getSyncState().now, page: __video.page }));
      await page.locator('#input-widget').focus();
      for (const key of ['ArrowRight', 'Space']) {
        await page.keyboard.press(key);
        const after = await page.evaluate(() => ({ now: __video.getSyncState().now, page: __video.page, playing: __video.getSyncState().playing }));
        assert.equal(after.now, before.now, `${mode}: a consumed ${key} must not seek the timeline`);
        assert.equal(after.page, before.page, `${mode}: a consumed ${key} must not turn a page`);
        assert.equal(after.playing, false, 'A consumed Space must not start playback');
      }
      await page.keyboard.press('/');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'input-widget', 'A consumed search shortcut must retain component focus');
      await page.evaluate(() => V._playerCtl.setOpenMenu('chap'));
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.getElementById('controls').dataset.menu), 'chap', 'A consumed Escape must not dismiss the player menu');
      await page.evaluate(() => { V._playerCtl.setOpenMenu(''); document.activeElement.blur(); });
      await page.keyboard.press('/');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'INPUT', 'Unconsumed search shortcuts must still open the search field');
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowRight');
      const navigated = await page.evaluate(() => ({ now: __video.getSyncState().now, page: __video.page }));
      if (mode === 'video') {
        assert.ok(Math.abs(navigated.now - before.now - 5) < 0.001, 'Unconsumed ArrowRight must still seek forward');
      } else {
        assert.equal(navigated.page, 2, 'Unconsumed ArrowRight must still turn a page');
        await page.evaluate(() => { __video.goToPage(1); window.__wheelTarget = document.getElementById('input-widget'); });
        const box = await page.locator('#input-widget').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 120);
        await page.waitForFunction(() => window.__wheelTarget.dataset.wheeled === 'yes');
        assert.equal(await page.evaluate(() => __video.page), 1, 'A consumed component wheel event must not turn a PPT page');
        const stage = await page.locator('#stage').boundingBox();
        await page.mouse.move(stage.x + 5, stage.y + 5);
        await page.mouse.wheel(0, 120);
        await page.waitForFunction(() => window.__video.page === 2);
      }
    }
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyPersistentLayerFrameContext(browser, port) {
  const id = 'layer-frame-context';
  const dir = path.resolve(TEST_ROOT, 'videos', id);
  assert.equal(path.dirname(dir), path.resolve(TEST_ROOT, 'videos'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,transitionDur:0,ui:{hud:false},sceneScripts:["scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `function frameState(x,sc,si){return{tone:20+x.clock*50+si*30,clock:x.clock,alive:x.alive,sceneClock:x.sceneClock,dur:x.dur};}
V.layer({id:'context',prop:'host',blendDur:0.5,zIndex:50,create(){},update(st,info){info.el.style.background='rgb('+Math.round(st.tone)+',0,0)';window.__layerPrevious={...info.prev};}});
for(let i=0;i<3;i++)V.scene({duration:1,lines:[],host:frameState,build(){},update(){}});`);
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  try {
    for (const [target, prior] of [[1.1, 0.8], [2.1, 1.8]]) {
      await page.goto(`http://127.0.0.1:${port}/${id}/?record=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.V?.seekToAsync);
      await page.evaluate(t => V.seekToAsync(t), target);
      const direct = await page.evaluate(() => window.__layerPrevious);
      const first = await page.screenshot();
      await page.evaluate(async ({ prior, target }) => { await V.seekToAsync(prior); await V.seekToAsync(target); }, { prior, target });
      assert.deepEqual(await page.evaluate(() => window.__layerPrevious), direct, 'Persistent-layer state must not depend on the previous seek path');
      assert.ok(first.equals(await page.screenshot()), 'Random seeks must reproduce identical persistent-layer pixels');
      assert.equal(direct.clock, target, 'Previous-scene layer callbacks must receive the current frame clock');
      assert.equal(direct.alive, target, 'Previous-scene layer callbacks must receive the current ambient clock');
      assert.ok(Math.abs(direct.sceneClock - 1.1) < 0.000001, 'Layer callbacks must resolve sceneClock against their own scene start');
    }
    const resized = await page.evaluate(async () => {
      V.scenes[0]._explicitDuration = 1.4;
      V.layout();
      await V.seekToAsync(V.scenes[1].start + 0.1);
      return { actual: window.__layerPrevious.dur, expected: V.scenes[0].duration };
    });
    assert.equal(resized.actual, resized.expected, 'Previous-scene layer callbacks must use the latest laid-out duration');
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyPausedVideoMetadata(browser, port) {
  const id = 'paused-video-metadata';
  const dir = path.resolve(TEST_ROOT, 'videos', id);
  assert.equal(path.dirname(dir), path.resolve(TEST_ROOT, 'videos'));
  fs.mkdirSync(dir, { recursive: true });
  createVideoBoundaryClip(path.join(dir, 'assets/boundary.mp4'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"><style>#controls,#osd,#start-hint{display:none!important}</style></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,sceneScripts:["scenes.js"],ui:{persist:false,livePause:false,hud:false}};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'V.scene({duration:1,lines:[],build(){},update(){}});V.scene({duration:3,lines:[],build(root){this.clip=V.u.videoClip("assets/boundary.mp4",{loop:new URLSearchParams(location.search).has("loop"),style:{width:"320px",height:"180px"}});root.append(this.clip);},update(t){V.u.syncVideoClip(this.clip,t);}});');
  try {
    for (const action of [
      { lt: 0.6, loop: false, expected: 0.6, pause: false },
      { lt: 2.5, loop: false, expected: 0.99, pause: false },
      { lt: 2.5, loop: true, expected: 0.5, pause: false },
      { lt: 0.6, loop: false, pause: true },
    ]) {
      const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      try {
        await page.route('**/boundary.mp4', async route => { await gate; await route.continue(); });
        await page.goto(`http://127.0.0.1:${port}/${id}/${action.loop ? '?loop=1' : ''}`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__video);
        const requested = page.waitForRequest('**/boundary.mp4', { timeout: 10000 });
        await page.evaluate(t => __video.seek(t), 1 + action.lt);
        await requested;
        if (action.pause) {
          await page.evaluate(() => __video.play());
          await page.waitForFunction(() => !document.querySelector('video').paused);
          await page.evaluate(() => __video.pause());
        }
        const at = await page.evaluate(() => __video.getSyncState().now);
        release();
        await page.waitForFunction(() => { const v = document.querySelector('video'); return v.readyState >= 2 && !v.seeking; });
        const loaded = await page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused }));
        assert.ok(Math.abs(loaded.time - (action.expected ?? (at - 1))) < 0.000001, 'Late metadata must apply the paused target, including end holds and loops');
        assert.equal(loaded.paused, true, 'Metadata arrival must respect a pause requested during loading');
        const ordinary = await page.locator('video').screenshot();
        await page.evaluate(t => V.seekToAsync(t), at);
        assert.ok(ordinary.equals(await page.locator('video').screenshot()), 'An ordinary paused seek must show the same pixels as an awaited seek');
      } finally { release(); await page.close(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function createVideoBoundaryClip(outMp4) {
  fs.mkdirSync(path.dirname(outMp4), { recursive: true });
  const r = spawnSync(resolveFfmpeg(PKG_ROOT), [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=0.5:r=4',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=0.5:r=4',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outMp4,
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `Failed generating video frame boundary fixture: ${r.stderr}`);
}

async function verifyVideoSeekPrecision(page, port, id) {
  await page.goto(`http://127.0.0.1:${port}/${id}/?record=1&precision=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.V?.seekToAsync);
  await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.499));
  const before = await page.locator('video').screenshot();
  await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.501));
  const time = await page.locator('video').evaluate(v => v.currentTime);
  assert.ok(Math.abs(time - 0.501) < 0.00001, `Record seek must cross nearby source frame boundaries, got ${time}`);
  assert.ok(!before.equals(await page.locator('video').screenshot()), 'A two-millisecond seek across a source frame boundary must decode different pixels');
  await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.499));
  assert.ok(before.equals(await page.locator('video').screenshot()), 'Seeking backward across the same boundary must restore the original frame');

  await page.goto(`http://127.0.0.1:${port}/${id}/?precision=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.V?.seekToAsync);
  await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.4));
  const pausedBefore = await page.locator('video').screenshot();
  await page.evaluate(() => window.__video.seek(V.scenes[1].start + 0.5));
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  const paused = await page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused }));
  assert.ok(paused.paused && Math.abs(paused.time - 0.5) < 0.00001, `Paused preview must seek to the requested frame, got ${paused.time}`);
  assert.ok(!pausedBefore.equals(await page.locator('video').screenshot()), 'Paused preview seek must update the decoded video pixels');
}

async function verifyAsyncVideoFrameReadiness(browser, port, videoDir) {
  const slow = createVideoHttpServer({ videosDir: path.join(videoDir, 'assets') });
  const serveAsset = slow.listeners('request')[0];
  slow.removeAllListeners('request');
  slow.on('request', (req, res) => {
    const timer = setTimeout(() => serveAsset.call(slow, req, res), 3000);
    res.once('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
  const id = 'delayed-video';
  const dir = path.join(TEST_ROOT, 'videos', id);
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  createVideoBoundaryClip(path.join(dir, 'assets/boundary.mp4'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="js/scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,fps:4,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/scenes.js"]};');
  const goodSrc = `http://127.0.0.1:${slow.address().port}/clip.mp4`;
  const badSrc = `http://127.0.0.1:${port}/${id}/missing.mp4`;
  const precisionSrc = `http://127.0.0.1:${port}/${id}/assets/boundary.mp4`;
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), `V.scene({duration:1,lines:[],build(root){root.textContent='First';},update(){}});
V.scene({duration:3,lines:[],build(root){const params=new URLSearchParams(location.search);const src=params.has('broken')?${JSON.stringify(badSrc)}:(params.has('precision')?${JSON.stringify(precisionSrc)}:${JSON.stringify(goodSrc)});this.clip=V.u.videoClip(src,{loop:params.has('loop'),style:{width:'320px',height:'180px'}});root.append(this.clip);},update(t){V.u.syncVideoClip(this.clip,t);}});`);
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  try {
    await page.goto(`http://127.0.0.1:${port}/${id}/?record=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.V?.seekToAsync);
    const state = await page.evaluate(async () => {
      await V.seekToAsync(V.scenes[1].start + 0.6);
      const v = document.querySelector('video');
      return { ready: v.readyState, seeking: v.seeking, time: v.currentTime, target: v._vclip.targetTime };
    });
    assert.ok(state.ready >= 2 && !state.seeking, 'Record seek must await a decoded frame even when metadata takes more than two seconds');
    assert.ok(Math.abs(state.time - state.target) < 0.008, 'Record seek must reach the requested video position');
    const first = await page.screenshot();
    await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.6));
    assert.ok(first.equals(await page.screenshot()), 'Repeated video seek must produce identical pixels');
    const dataWait = await page.evaluate(async () => {
      const v = document.querySelector('video');
      let ready = 1;
      Object.defineProperty(v, 'readyState', { configurable: true, get: () => ready });
      const timer = setTimeout(() => { ready = 2; v.dispatchEvent(new Event('loadeddata')); }, 250);
      const start = performance.now();
      try { await V.seekToAsync(V.scenes[1].start + 0.6); return performance.now() - start; }
      finally { clearTimeout(timer); delete v.readyState; }
    });
    assert.ok(dataWait >= 200, 'Metadata alone must not count as a decoded first frame');
    for (const loop of [false, true]) {
      await page.goto(`http://127.0.0.1:${port}/${id}/?record=1${loop ? '&loop=1' : ''}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.V?.seekToAsync);
      const end = await page.evaluate(async () => {
        await V.seekToAsync(V.scenes[1].start + 2.5);
        const v = document.querySelector('video');
        return { time: v.currentTime, target: v._vclip.targetTime, duration: v.duration };
      });
      const expected = loop ? 2.5 % end.duration : end.duration - 0.01;
      assert.ok(Math.abs(end.time - expected) < 0.008, 'Late metadata must resolve end holds and loops against the loaded clip duration');
      assert.ok(Math.abs(end.time - end.target) < 0.008, 'Resolved video target must match the decoded position');
    }
    await page.goto(`http://127.0.0.1:${port}/${id}/?record=1&broken=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.V?.seekToAsync);
    await assert.rejects(page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.6)), /embedded video/i, 'Record mode must reject unavailable media instead of exporting a black frame');
    await page.goto(`http://127.0.0.1:${port}/${id}/?broken=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.V?.seekToAsync);
    await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.6));
    await verifyVideoSeekPrecision(page, port, id);
  } finally {
    await page.close();
    slow.closeAllConnections();
    await new Promise(resolve => slow.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifySceneImageReadiness(browser, port) {
  const completed = new Set();
  const requested = new Set();
  const assets = http.createServer((req, res) => {
    requested.add(req.url);
    const timer = setTimeout(() => {
      const color = req.url.includes('later') ? 'green' : 'red';
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`);
      completed.add(req.url);
    }, 400);
    res.once('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => assets.listen(0, '127.0.0.1', resolve));
  const id = 'css-image-readiness';
  const dir = path.join(TEST_ROOT, 'videos', id);
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"><style>.probe,.probe::before{position:absolute;inset:0;background-image:var(--probe-image);background-size:cover}.probe.as-pseudo{background-image:none}.probe.as-pseudo::before{content:""}</style></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="js/scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,fps:4,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), `V.scene({duration:1,lines:[],build(){},update(){}});
V.scene({duration:2,lines:[],build(root){
  this.mode=new URLSearchParams(location.search).get('image')||'element';
  if(this.mode==='svg'){
    const svg=V.u.svg('<image width="320" height="180"/>','width="320" height="180"');
    this.probe=svg.querySelector('image');root.append(svg);
  }else{
    this.probe=V.u.h(this.mode==='html'?'img':'div',{class:'probe'+(this.mode==='pseudo'?' as-pseudo':'')});root.append(this.probe);
  }
  if(['stylesheet','adopted'].includes(this.mode)){
    if(this.mode==='adopted'){
      this.sheet=new CSSStyleSheet();document.adoptedStyleSheets=[...document.adoptedStyleSheets,this.sheet];
    }else{
      const style=document.createElement('style');document.head.append(style);this.sheet=style.sheet;
    }
    this.sheet.insertRule('.probe{background-image:none}');
  }
  if(!this.sheet){
    const hidden=V.u.h('div',{style:{display:'none'}});
    hidden.append(V.u.h('div',{style:{backgroundImage:'url("http://127.0.0.1:${assets.address().port}/'+this.mode+'/unused.svg")'}}));
    root.append(hidden);
  }
},update(t){
  const prefix='http://127.0.0.1:${assets.address().port}/'+this.mode+'/';
  const src=t>=0.5?'later(green).svg':'initial(red).svg';
  if(this.mode==='svg'){this.probe.setAttribute('href',prefix+src);return;}
  if(this.mode==='html'){this.probe.src=prefix+src;return;}
  if(this.sheet){this.sheet.cssRules[0].style.backgroundImage='url("'+prefix+src+'"),url("'+prefix+'layer.svg")';return;}
  this.probe.style.setProperty('--probe-image','url("'+prefix+src+'"), url("'+prefix+'layer.svg")');
}});`);
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  try {
    for (const mode of ['element', 'pseudo', 'html', 'svg', 'stylesheet', 'adopted']) {
      await page.goto(`http://127.0.0.1:${port}/${id}/?record=1&image=${mode}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.V?.seekToAsync);
      await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.4));
      const files = ['html', 'svg'].includes(mode) ? ['initial(red).svg'] : ['initial(red).svg', 'layer.svg'];
      for (const file of files) {
        assert.ok(completed.has(`/${mode}/${file}`), `Async seek must wait for ${mode} images`);
      }
      assert.equal(requested.has(`/${mode}/unused.svg`), false, 'Hidden subtrees must not fetch unused CSS images');
      const first = await page.screenshot();
      await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.6));
      assert.ok(completed.has(`/${mode}/later(green).svg`), 'An image changed by update(t) must be decoded before async seek completes');
      assert.ok(!first.equals(await page.screenshot()), 'The changed image must appear in the captured pixels');
      await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.4));
      assert.ok(first.equals(await page.screenshot()), 'Seeking back must restore the same image pixels');
    }
  } finally {
    await page.close();
    assets.closeAllConnections();
    await new Promise(resolve => assets.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyShadowImageReadiness(browser, port) {
  const completed = new Set();
  const requested = new Set();
  const assets = http.createServer((req, res) => {
    requested.add(req.url);
    const timer = setTimeout(() => {
      const color = req.url.includes('green') ? 'green' : 'red';
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`);
      completed.add(req.url);
    }, 400);
    res.once('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => assets.listen(0, '127.0.0.1', resolve));
  const id = 'shadow-image-readiness';
  const dir = path.join(TEST_ROOT, 'videos', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"><style>#controls,#osd,#start-hint,#subs{display:none!important}</style></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,ui:{hud:false,livePause:false},sceneScripts:["scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `V.scene({duration:1,lines:[],build(){},update(){}});
V.scene({duration:2,lines:[],build(root){
  this.mode=new URLSearchParams(location.search).get('image');
  const host=V.u.h('div',{style:{position:'absolute',inset:'0',background:'black'}});root.append(host);
  let shadow=host.attachShadow({mode:'open'});
  if(this.mode==='nested'){
    const nested=V.u.h('div',{style:{position:'absolute',inset:'0'}});shadow.append(nested);
    shadow=nested.attachShadow({mode:'open'});
  }
  shadow.append(V.u.h('style',null,'.probe{position:absolute;inset:0;width:320px;height:180px;background-size:cover}.probe.pseudo::before{content:"";position:absolute;inset:0;background-image:var(--image);background-size:cover}'));
  if(this.mode==='svg'){
    const svg=V.u.svg('<image width="320" height="180"/>','class="probe" width="320" height="180"');
    this.probe=svg.querySelector('image');shadow.append(svg);
  }else{
    this.probe=V.u.h(['html','nested'].includes(this.mode)?'img':'div',{class:'probe '+this.mode});
    shadow.append(this.probe);
  }
  const hidden=V.u.h('div',{style:{display:'none'}});
  hidden.append(V.u.h('div',{style:{backgroundImage:'url("http://127.0.0.1:${assets.address().port}/'+this.mode+'/unused.svg")'}}));
  shadow.append(hidden);
},update(t){
  const src='http://127.0.0.1:${assets.address().port}/'+this.mode+'/'+(t>=0.5?'green':'red')+'.svg';
  if(this.mode==='svg'){this.probe.setAttribute('href',src);return;}
  if(['html','nested'].includes(this.mode)){this.probe.src=src;return;}
  this.probe.style.setProperty('--image','url("'+src+'")');
  if(this.mode==='css')this.probe.style.backgroundImage='var(--image)';
}});`);
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  try {
    for (const mode of ['html', 'svg', 'css', 'pseudo', 'nested']) {
      await page.goto(`http://127.0.0.1:${port}/${id}/?record=1&image=${mode}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.V?.seekToAsync);
      await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.4));
      assert.ok(completed.has(`/${mode}/red.svg`), `Async seek must wait for shadow ${mode} images`);
      const first = await page.screenshot();
      await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.6));
      assert.ok(completed.has(`/${mode}/green.svg`), 'Updated shadow images must load before async seek returns');
      assert.ok(!first.equals(await page.screenshot()), 'Updated shadow images must change captured pixels');
      await page.evaluate(() => V.seekToAsync(V.scenes[1].start + 0.4));
      assert.ok(first.equals(await page.screenshot()), 'Seeking back must restore the same shadow image pixels');
      assert.equal(requested.has(`/${mode}/unused.svg`), false, 'Hidden shadow subtrees must not fetch unused CSS images');
    }
  } finally {
    await page.close();
    assets.closeAllConnections();
    await new Promise(resolve => assets.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyTopLayerFrameReuse(browser) {
  for (const mode of ['popover', 'popover-outside', 'popover-order', 'dialog', 'fallback-popover', 'fallback-dialog']) {
    const kind = mode.replace('fallback-', '');
    const fallback = mode.startsWith('fallback-');
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    try {
      const content = kind === 'dialog' ? '<dialog id="popup">Dialog</dialog>' : '<div id="popup" popover="manual">Popover</div>' + (kind === 'popover-order' ? '<div id="other" popover="manual">Other</div>' : '');
      const inside = kind === 'popover-outside' ? '' : content;
      const outside = kind === 'popover-outside' ? content : '';
      await page.setContent(`<style>html,body{margin:0}#stage{width:320px;height:180px;background:#00dd44}#popup,#other{inset:0;margin:0;box-sizing:border-box;width:320px;height:180px;max-width:none;max-height:none;outline:none;border:0;background:#00dd44;color:black;font:32px monospace;padding:12px}#popup:popover-open,#popup:modal{background:#ff2255}#other{background:#2255ff}</style><div id="stage">${inside}</div>${outside}`);
      if (fallback) await page.evaluate(() => {
        const original = CSS.supports;
        CSS.supports = function (...args) {
          if (String(args[0]).startsWith('selector(')) return false;
          return original.apply(this, args);
        };
      });
      await page.evaluate(installFrameReuseProbe);
      await page.evaluate(kind => {
        const popup = document.getElementById('popup');
        const other = document.getElementById('other');
        window.V = { async seekToAsync(sec) {
          const later = sec >= 0.5;
          if (kind === 'popover-order') {
            for (const el of [popup, other]) if (el.matches(':popover-open')) el.hidePopover();
            for (const el of later ? [other, popup] : [popup, other]) el.showPopover();
            return;
          }
          if (kind === 'dialog') {
            if (!popup.open || later !== popup.matches(':modal')) {
              popup.close();
              if (later) popup.showModal(); else popup.show();
            }
            return;
          }
          if (later !== popup.matches(':popover-open')) {
            if (later) popup.showPopover(); else popup.hidePopover();
          }
        } };
      }, kind);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      const before = await page.screenshot({ caret: 'initial' });
      const html = await page.evaluate(() => document.getElementById('stage').innerHTML);
      const ordinary = !fallback && kind !== 'popover-order';
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.2)), ordinary, `${mode}: ordinary stage content must retain static reuse`);
      const reused = await page.evaluate(() => __seekAndDedupe(0.8));
      assert.equal(await page.evaluate(() => document.getElementById('stage').innerHTML), html, 'Top-layer state must be tested independently of HTML mutations');
      assert.ok(!before.equals(await page.screenshot({ caret: 'initial' })), `${mode}: top-layer state must change the visible frame`);
      assert.equal(reused, false, `${mode}: a native top-layer frame must be captured`);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.9)), false, 'An open top layer can change stacking order without DOM changes');
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      assert.ok(before.equals(await page.screenshot({ caret: 'initial' })), `${mode}: backward seeking must restore the same pixels`);
      await page.evaluate(() => {
        for (const dialog of document.querySelectorAll('dialog')) dialog.close();
        for (const popup of document.querySelectorAll('[popover]')) if (popup.matches(':popover-open')) popup.hidePopover();
        document.body.innerHTML = '<div id="stage">Static</div>';
        window.V.seekToAsync = async () => {};
      });
      assert.equal(await page.evaluate(() => __seekAndDedupe(1)), false);
      assert.equal(await page.evaluate(() => __seekAndDedupe(1.1)), true, 'Removing top-layer elements must restore ordinary static reuse');
    } finally { await page.close(); }
  }
}

async function verifySvgAnimationFrameReuse(browser) {
  const drawings = {
    animate: '<rect width="320" height="180" fill="#00dd44"><animate attributeName="fill" values="#00dd44;#ff2255" dur="1s" fill="freeze"/></rect>',
    transform: '<rect width="160" height="180" fill="#ff2255"><animateTransform attributeName="transform" type="translate" values="0 0;160 0" dur="1s" fill="freeze"/></rect>',
    motion: '<rect width="100" height="180" fill="#ff2255"><animateMotion path="M0,0 L160,0" dur="1s" fill="freeze"/></rect>',
    set: '<rect width="320" height="180" fill="#00dd44"><set attributeName="fill" to="#ff2255" begin="0.5s" fill="freeze"/></rect>',
  };
  for (const [mode, drawing] of Object.entries(drawings)) {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    try {
      await page.setContent('<style>html,body{margin:0}#stage{width:320px;height:180px;background:#2255ff}svg{display:block}</style><div id="stage"><svg id="drawing" width="320" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="180" fill="#00dd44"/></svg></div>');
      await page.evaluate(installFrameReuseProbe);
      await page.evaluate(() => { window.V = { async seekToAsync() {} }; });
      assert.equal(await page.evaluate(() => __seekAndDedupe(0)), false);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.05)), true, `${mode}: ordinary static SVG must retain frame reuse`);
      await page.evaluate(drawing => {
        const svg = document.getElementById('drawing');
        svg.innerHTML = drawing;
        svg.pauseAnimations();
        window.V.seekToAsync = async sec => { svg.setCurrentTime(sec); };
      }, drawing);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      const before = await page.screenshot({ caret: 'initial' });
      const html = await page.evaluate(() => document.getElementById('stage').innerHTML);
      const reused = await page.evaluate(() => __seekAndDedupe(0.8));
      assert.equal(await page.evaluate(() => document.getElementById('stage').innerHTML), html, `${mode}: native animation time must be tested independently of HTML mutations`);
      assert.equal(await page.evaluate(() => document.getElementById('stage').getAnimations({ subtree: true }).length), 0, 'Native SVG animations are not exposed through the Web Animations API');
      assert.ok(!before.equals(await page.screenshot({ caret: 'initial' })), `${mode}: authored SVG time must change the rendered pixels`);
      assert.equal(reused, false, `${mode}: SVG animation state must produce a fresh frame`);
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.8)), false, 'Native animation elements must bypass HTML-only frame reuse');
      assert.equal(await page.evaluate(() => __seekAndDedupe(0.1)), false);
      assert.ok(before.equals(await page.screenshot({ caret: 'initial' })), `${mode}: backward seeking must restore the same pixels`);
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('animate,animateTransform,animateMotion,set')) el.remove();
      });
      assert.equal(await page.evaluate(() => __seekAndDedupe(1)), false);
      assert.equal(await page.evaluate(() => __seekAndDedupe(1.1)), true, `${mode}: removing animation elements must restore static SVG reuse`);
    } finally { await page.close(); }
  }
}

async function verifySubtitleExportText(browser) {
  const items = [
    { start: 0, end: 1, text: '普通中文字幕与 English captions。', speaker: '' },
    { start: 1, end: 2, text: '比较 a < b 且 c > d，A --> B。', speaker: '' },
    { start: 2, end: 3, text: '标签 <b>重点</b>、<i>斜体</i>、<00:00:02.500> 与 <未知标签>。', speaker: '' },
    { start: 3, end: 4, text: '字面实体 &amp; &lt; &gt; &nbsp; &#65; 与普通 &。', speaker: '' },
    { start: 4, end: 5, text: '引号 "原样" 与单行换行\n下一行。', speaker: '讲者甲' },
    { start: 5, end: 6, text: '讲者名称不应混入字幕正文。', speaker: '讲者 > 甲 <乙> &amp; "丙"' },
  ];
  const page = await browser.newPage();
  try {
    const parsed = await page.evaluate(async (vtt) => {
      const video = document.createElement('video');
      const track = document.createElement('track');
      track.kind = 'subtitles';
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      let timer;
      try {
        const loaded = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Subtitle track did not load')), 10000);
          track.onload = resolve;
          track.onerror = () => reject(new Error('Browser rejected the exported VTT'));
        });
        track.src = url;
        video.append(track);
        document.body.append(video);
        track.track.mode = 'hidden';
        await loaded;
        return Array.from(track.track.cues, cue => {
          const html = cue.getCueAsHTML();
          const speaker = html.querySelector('span[title]');
          return { start: cue.startTime, end: cue.endTime, text: html.textContent, speaker: speaker ? speaker.title : '' };
        });
      } finally {
        clearTimeout(timer);
        video.remove();
        URL.revokeObjectURL(url);
      }
    }, buildVttContent(items));
    assert.equal(parsed.length, items.length, 'Exported VTT must keep every cue');
    for (let index = 0; index < items.length; index++) {
      assert.deepEqual(parsed[index], items[index], 'Browser-parsed VTT must preserve the literal subtitle text, speaker and timing');
    }
  } finally { await page.close(); }
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
    await verifyFrameReuseStateTracking(browser);
    await verifyAnimationClockFrameReuse(browser);
    await verifyShadowDomFrameReuse(browser);
    await verifySvgUseFrameReuse(browser);
    await verifyNativeControlFrameReuse(browser);
    await verifyTopLayerFrameReuse(browser);
    await verifySvgAnimationFrameReuse(browser);
    await verifySubtitleExportText(browser);
    await verifyInitTitleEscaping(browser, port);
    await verifyPersistentLayerFrameContext(browser, port);
    await verifyConsumedInputEvents(browser, port);
    await verifyAsyncVideoFrameReadiness(browser, port, videoDir);
    await verifyPausedVideoMetadata(browser, port);
    await verifySceneImageReadiness(browser, port);
    await verifyShadowImageReadiness(browser, port);
    const hmrRes = await fetch(`http://127.0.0.1:${port}/__hmr`);
    assert.equal(hmrRes.status, 200);
    assert.ok((hmrRes.headers.get('content-type') || '').includes('text/event-stream'));
    await hmrRes.body.cancel();

    const bigBinPath = path.join(videoDir, 'assets/big-range.bin');
    fs.writeFileSync(bigBinPath, Buffer.alloc(5 * 1024 * 1024, 0x41));
    const openRangeRes = await fetch(`http://127.0.0.1:${port}/demo/assets/big-range.bin`, { headers: { Range: 'bytes=0-' } });
    assert.equal(openRangeRes.status, 206, 'Open-ended Range bytes=0- must return 206');
    const openRangeBuf = await openRangeRes.arrayBuffer();
    assert.equal(openRangeBuf.byteLength, 4 * 1024 * 1024, 'Open-ended Range on >4MB asset must bound chunk to 4MB to avoid hung sockets');
    fs.rmSync(bigBinPath, { force: true });

    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.goto(`http://127.0.0.1:${port}/demo/?record=1`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await window.V.seekToAsync(0.6);
      await window.V.seekToAsync(0.9);
    });
    const recState = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const guide = document.createElement('div');
      guide.style.cssText = 'position:absolute;bottom:calc(30px + var(--ctrl-dodge, 0px));width:40px;height:40px';
      stage.appendChild(guide);
      const stageRect = stage.getBoundingClientRect();
      const overlayBottom = (stageRect.bottom - guide.getBoundingClientRect().bottom) / (stageRect.height / V.stageHeight);
      guide.remove();
      return {
        overlayBottom,
        pluginInstalled: window.__pluginInstalled,
        hasPreset: Boolean(document.querySelector('.test-preset-badge')),
        hasControl: Boolean(document.querySelector('[data-custom-ctrl="test-btn"]')),
        maxEnergy: window.__maxLayerEnergy,
        cpActiveInRecord: document.getElementById('checkpoint-overlay')?.classList.contains('is-open') || false,
        ptrNeutral: window.V.pointer.inside === false && window.V.pointer.nx === 0 && window.V.pointer.presence === 0,
        clockLocked: window.__video.getSyncState().clock === window.__video.getSyncState().now,
      };
    });
    assert.equal(recState.pluginInstalled, true, 'Plugin should install');
    assert.equal(recState.hasPreset, true, 'Preset should render');
    assert.equal(recState.hasControl, true, 'Custom control should mount');
    assert.ok(recState.maxEnergy > 0.05, `Expected 30Hz voice energy > 0.05, got ${recState.maxEnergy}`);
    assert.equal(recState.cpActiveInRecord, false, 'Record mode must auto-bypass checkpoints');
    assert.equal(recState.ptrNeutral, true, 'Record mode must lock V.pointer to neutral center');
    assert.equal(recState.clockLocked, true, 'Record mode must lock ambient clock === narrative now');
    assert.ok(Math.abs(recState.overlayBottom - 30) < 0.01, 'Recorded project overlays must not inherit hidden control-bar spacing');

    await page.goto(`http://127.0.0.1:${port}/demo/?lang=en&record=1`, { waitUntil: 'networkidle' });
    const enInfo = await page.evaluate(() => ({
      title: window.V.scenes[0].title,
      bakedLang: window.V.voice && window.V.voice.bakedLayout && window.V.voice.bakedLayout.lang,
    }));
    assert.equal(enInfo.title, 'Architecture', 'Localized scene title should apply');
    assert.equal(enInfo.bakedLang, 'en', 'Localized timings.en.js must stamp bakedLayout.lang = "en"');

    await verifyRecordCheckpointsAndLocaleAudio(page, port);
    await verifyPlayerBarContracts(page, port);
    const noPptLeak = await page.evaluate(() => ({
      pptMode: window.__video.pptMode,
      hasPptAct: Boolean(document.querySelector('[data-ppt-act]')),
    }));
    assert.equal(noPptLeak.pptMode, false, 'Default video mode must keep pptMode=false');
    assert.equal(noPptLeak.hasPptAct, false, 'Default video mode must not inject PPT buttons');
    await verifyPptDeckMode(page, port);
    await verifySfxAndMultiScriptContracts(page, port);
    await verifyRuntimeSetLangHotSwitch(page, port);
    await verifyConcurrentLocaleSwitches(page, port);
    await verifyDelayedLocalePlayback(browser, port);
    await verifyLocaleResumeProgress(browser, port);
    await verifySingleLangOptOutSafety(browser, port);
    await verifyPptOptInDefaultOff(browser, port);
    await verifyOptionalReturnLink(browser, port);
    await verifyAutoplayBlockedUnlock(browser, port);
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
  return r;
}

function verifyInvalidRenderCliArgs() {
  const out = path.join(TEST_ROOT, 'invalid-render.mp4');
  const cases = [
    ['--fps', '0'], ['--fps', 'bad'], ['--fps', '1e308'], ['--range', '100:101'],
    ['--range', '0:1:2'], ['--scene', '1.5'], ['--scene', 'bad'],
  ];
  const errors = { '--fps': /Invalid FPS|Render frame count/i, '--range': /--range/i, '--scene': /--scene/i };
  for (const args of cases) {
    const fpsArgs = args[0] === '--fps' ? [] : ['--fps', '4'];
    const r = assertCliFails(['render', 'demo', out, ...fpsArgs, ...args]);
    assert.match(r.stderr, errors[args[0]], 'CLI must explain the invalid render option');
    assert.equal(fs.existsSync(out), false, 'Invalid render options must not create an output');
  }
}

function verifyFreshUnbuiltAudit() {
  runCliCmd(['init', 'fresh-unbuilt', '--title', 'Fresh Unbuilt']);
  runCliCmd(['audit', 'fresh-unbuilt']);
  fs.rmSync(path.join(TEST_ROOT, 'videos/fresh-unbuilt'), { recursive: true, force: true });
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

function verifySpecialCharacterVideoPaths() {
  const id = '演示 # 50% +&';
  const dir = path.join(TEST_ROOT, 'videos', id);
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="js/scenes.js"></script><script>V.boot();</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={title:"Special directory",width:320,height:180,fps:2,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), 'V.scene({title:"Color",duration:1,lines:[],build(root){root.style.background="teal";},update(){}});');
  runCliCmd(['audit', id]);
  const outMp4 = path.join(dir, 'assets/rendered/special-directory.mp4');
  runCliCmd(['render', id, outMp4, '--workers', '1']);
  const warm = runCliCmd(['render', id, outMp4, '--workers', '1']);
  assert.ok(warm.includes('1/1 scenes hit'), 'Rendering into the video asset tree must retain the scene cache');
  const decoded = spawnSync(resolveFfmpeg(PKG_ROOT), ['-loglevel', 'error', '-i', outMp4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert.equal(decoded.status, 0, String(decoded.stderr));
  assert.equal(decoded.stdout.length, 320 * 180 * 3 * 2, 'Special-character video directory must render two complete frames');
  const pixel = decoded.stdout.subarray((90 * 320 + 160) * 3, (90 * 320 + 160) * 3 + 3);
  assert.ok(pixel[0] < 10 && pixel[1] > 100 && pixel[2] > 100, 'Special-character video directory must render the scene pixels');
  const outHtml = path.join(TEST_ROOT, 'special-directory-storyboard.html');
  runCliCmd(['storyboard', id, outHtml]);
  assert.match(fs.readFileSync(outHtml, 'utf8'), /data:image\/jpeg;base64,/, 'Storyboard must embed a captured frame for the special-character video directory');
  verifyOutputFilenameCase(dir);
}

function verifyOutputFilenameCase(videoDir) {
  for (const [mode, extension, flags] of [['render', 'MP4', ['--workers', '1']], ['storyboard', 'HtMl', []]]) {
    const root = path.join(TEST_ROOT, 'output-shortcuts', mode);
    const id = `video.${extension}`;
    fs.cpSync(videoDir, path.join(root, 'videos', id), { recursive: true });
    for (const explicitId of [false, true]) {
      const out = path.join(root, `${explicitId ? 'explicit' : '导出 文件'}.${extension}`);
      runCliCmd([mode, ...(explicitId ? [id] : []), out, ...flags], root);
      assert.ok(fs.statSync(out).size > 0, `${mode} must preserve the requested output filename`);
      if (mode === 'storyboard') {
        assert.match(fs.readFileSync(out, 'utf8'), /data:image\/jpeg;base64,/, 'Mixed-case HTML output must contain a captured frame');
      } else {
        const decoded = spawnSync(resolveFfmpeg(PKG_ROOT), ['-loglevel', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        assert.equal(decoded.status, 0, String(decoded.stderr));
        assert.equal(decoded.stdout.length, 320 * 180 * 3 * 2, 'Uppercase MP4 output must contain two complete frames');
        const pixel = decoded.stdout.subarray((90 * 320 + 160) * 3, (90 * 320 + 160) * 3 + 3);
        assert.ok(pixel[0] < 10 && pixel[1] > 100 && pixel[2] > 100, 'Output shortcuts must render the selected video');
      }
    }
  }
}

function verifyLargeAssetCacheInvalidation() {
  const videoDir = path.join(TEST_ROOT, 'large-asset-cache');
  fs.mkdirSync(path.join(videoDir, 'assets'), { recursive: true });
  const asset = path.join(videoDir, 'assets/large.svg');
  const padding = ' '.repeat(1100000);
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg">${padding}<rect width="100" height="100" fill="${color}"/>${padding}</svg>`;
  const V = { duration: 1, scenes: [{ start: 0, duration: 1, cues: [], subCues: [] }] };
  const cacheId = `self-test-large-asset-${process.pid}`;
  const cachePath = () => buildCachedSceneSegments(V, { ui: { hud: false } }, cacheId, videoDir, 4, 320, 180, 4, '')[0].partPath;
  let initialPath;
  try {
    fs.writeFileSync(asset, svg('red'), 'utf8');
    assert.ok(fs.statSync(asset).size > 2 * 1024 * 1024, 'Cache regression fixture must exceed the old sampling threshold');
    initialPath = cachePath();
    assert.equal(cachePath(), initialPath, 'Unchanged large assets must preserve the cache key');
    fs.writeFileSync(asset, svg('tan'), 'utf8');
    assert.notEqual(cachePath(), initialPath, 'Changing only the middle of a large visual asset must invalidate the render cache');
  } finally {
    if (initialPath) fs.rmdirSync(path.dirname(initialPath));
  }
}

function verifyNestedStylesheetCacheInvalidation() {
  const videoDir = path.join(TEST_ROOT, 'nested-styles-cache');
  const stylesheet = path.join(videoDir, 'components/nested/card.css');
  fs.mkdirSync(path.dirname(stylesheet), { recursive: true });
  const V = { duration: 1, scenes: [{ start: 0, duration: 1, cues: [], subCues: [] }] };
  const cacheId = `self-test-nested-styles-${process.pid}`;
  const cachePath = () => buildCachedSceneSegments(V, { ui: { hud: false } }, cacheId, videoDir, 4, 320, 180, 4, '')[0].partPath;
  let initialPath;
  try {
    fs.writeFileSync(stylesheet, '.card{background:red}');
    initialPath = cachePath();
    assert.equal(cachePath(), initialPath, 'Unchanged nested stylesheets must preserve the cache key');
    fs.writeFileSync(stylesheet, '.card{background:blue}');
    assert.notEqual(cachePath(), initialPath, 'Stylesheets in nested component directories must invalidate the render cache');
  } finally {
    if (initialPath) fs.rmdirSync(path.dirname(initialPath));
  }
}

function verifyNestedVisualAssetCacheInvalidation() {
  const videoDir = path.join(TEST_ROOT, 'nested-visual-cache');
  const files = ['components/nested/card.svg', 'components/nested/assets/icon.svg'];
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="${color}"/></svg>`;
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(videoDir, file)), { recursive: true });
    fs.writeFileSync(path.join(videoDir, file), svg('red'));
  }
  const V = { duration: 1, scenes: [{ start: 0, duration: 1, cues: [], subCues: [] }] };
  const cacheId = `self-test-nested-visuals-${process.pid}`;
  const cachePath = () => buildCachedSceneSegments(V, { ui: { hud: false } }, cacheId, videoDir, 4, 320, 180, 4, '')[0].partPath;
  let initialPath;
  try {
    initialPath = cachePath();
    for (const file of files) {
      const previous = cachePath();
      fs.writeFileSync(path.join(videoDir, file), svg('blue'));
      const changed = cachePath();
      assert.notEqual(changed, previous, `Changing a nested visual asset must invalidate the scene cache: ${file}`);
      assert.equal(cachePath(), changed, 'Unchanged nested visual assets must preserve the cache key');
    }
  } finally {
    if (initialPath) fs.rmdirSync(path.dirname(initialPath));
  }
}

function verifySceneCacheGranularity() {
  const project = path.join(TEST_ROOT, 'scene-cache-granularity');
  const videoDir = path.join(project, 'videos/demo');
  fs.mkdirSync(path.join(videoDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/first.js","js/second.js"]};');
  const scene = color => `V.scene({duration:1,lines:[],build(root){root.textContent='${color}';},update(){}});`;
  fs.writeFileSync(path.join(videoDir, 'js/first.js'), scene('red'));
  fs.writeFileSync(path.join(videoDir, 'js/second.js'), scene('red'));
  const cacheId = `self-test-scene-granularity-${process.pid}`;
  const cachePaths = () => {
    const { sandbox } = loadVideoSandbox(project, 'demo');
    return buildCachedSceneSegments(sandbox.V, sandbox.V.config, cacheId, videoDir, 8, 320, 180, 4, '').map(segment => segment.partPath);
  };
  let initial;
  try {
    initial = cachePaths();
    fs.writeFileSync(path.join(videoDir, 'js/second.js'), scene('blue'));
    const changed = cachePaths();
    assert.equal(changed[0], initial[0], 'Changing the second scene must preserve the first scene cache key');
    assert.notEqual(changed[1], initial[1], 'Changing the second scene must invalidate its own cache key');
  } finally {
    if (initial) fs.rmdirSync(path.dirname(initial[0]));
  }
}

function verifyRenderOutputCacheExclusion() {
  const videoDir = path.join(TEST_ROOT, 'render-output-cache');
  fs.mkdirSync(videoDir, { recursive: true });
  const V = { duration: 1, scenes: [{ start: 0, duration: 1, cues: [], subCues: [] }] };
  const cacheId = `self-test-output-cache-${process.pid}`;
  let initialPath;
  try {
    for (const rel of ['output.mp4', 'assets/output.mp4', 'assets/nested/output.mp4']) {
      const output = path.join(videoDir, rel);
      const cachePath = () => buildCachedSceneSegments(V, { ui: { hud: false } }, cacheId, videoDir, 4, 320, 180, 4, '', output)[0].partPath;
      const before = cachePath();
      initialPath = before;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'generated output');
      assert.equal(cachePath(), before, 'Creating the current output inside the source tree must not invalidate its own cache');
      fs.writeFileSync(output, 'changed generated output');
      assert.equal(cachePath(), before, 'Changing the current output must not invalidate its own cache');
    }
    const source = path.join(videoDir, 'assets/source.mp4');
    const output = path.join(videoDir, 'output.mp4');
    const cachePath = () => buildCachedSceneSegments(V, { ui: { hud: false } }, cacheId, videoDir, 4, 320, 180, 4, '', output)[0].partPath;
    const before = cachePath();
    fs.writeFileSync(source, 'source clip');
    assert.notEqual(cachePath(), before, 'Other source videos must still participate in cache identity');
  } finally {
    if (initialPath) fs.rmdirSync(path.dirname(initialPath));
  }
}

function verifyMixAudioRegressions() {
  const py = resolvePython(PKG_ROOT, true);
  const r = spawnSync(py, [path.join(PKG_ROOT, 'tools/test-mix-audio.py'), path.join(TEST_ROOT, 'mix-audio-check')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `Mix audio regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifySpokenTextRules() {
  for (const spec of [
    { text: '执行命令行', word: '直形命令航', config: {} },
    { text: '品牌', word: 'Brand', config: { pronunciation: { '品牌': 'Brand' } } },
    { text: '执行', word: '执行', config: { tts: { polyphoneFix: false } } },
  ]) {
    const errors = [];
    const V = { config: spec.config, scenes: [{ lines: [{ text: spec.text }] }], voice: { durations: [[1]], words: [[[[0, spec.word]]]] } };
    assert.equal(verifySpokenTimings(V, errors), 1);
    assert.deepEqual(errors, [], 'Existing pronunciation rules must remain valid for offline remix');
  }
  const legacyErrors = [];
  verifySpokenTimings({ scenes: [{ lines: [{ text: '旧版字幕。' }] }], voice: { durations: [[1]], segs: [[[[1, '旧版字幕。']]]] } }, legacyErrors);
  assert.deepEqual(legacyErrors, [], 'Valid legacy subtitle-only timings must remain supported');
}

function verifyMixSpokenTextPreflight(videoDir) {
  const cases = [
    { name: 'object-line', args: ['mix', 'demo'], file: 'js/s01.js', from: '欢迎体验', to: '重新体验' },
    { name: 'string-line-mix-only', args: ['build', 'demo', '--mix-only'], file: 'js/s02.js', from: '所有画面', to: '这些画面' },
    { name: 'localized', args: ['mix', 'demo', '--lang', 'en'], file: 'locales/en.js', from: 'Welcome to', to: 'New welcome to', work: 'mix-demo-en' },
    { name: 'legacy-segs', args: ['mix', 'demo'], file: 'js/s01.js', from: '欢迎体验', to: '重新体验', legacy: true },
  ];
  for (const spec of cases) {
    const project = path.join(TEST_ROOT, `mix-preflight-${spec.name}`);
    const copy = path.join(project, 'videos/demo');
    fs.cpSync(videoDir, copy, { recursive: true });
    if (spec.legacy) {
      const { sandbox, timingsPath } = loadVideoSandbox(project, 'demo', { ignoreBaked: true, requireTimings: true });
      const voice = sandbox.V.voice;
      voice.segs = voice.subCues.map(scene => scene.map(line => line.map(([, end, text]) => [end, text])));
      delete voice.words;
      delete voice.subCues;
      fs.writeFileSync(timingsPath, `V.voice=${JSON.stringify(voice)};`);
    }
    const file = path.join(copy, spec.file);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes(spec.from), `${spec.name}: the original spoken text must be present`);
    fs.writeFileSync(file, content.replace(spec.from, spec.to));
    const assets = path.join(copy, 'assets');
    const voiceDir = path.join(assets, 'voice');
    const outputs = fs.readdirSync(assets).filter(name => /\.(m4a|vtt|srt)$/i.test(name)).map(name => path.join(assets, name));
    outputs.push(...fs.readdirSync(voiceDir).map(name => path.join(voiceDir, name)));
    const marker = path.join(project, '.runtime', spec.work || 'mix-demo', 'keep.txt');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, 'Previous remix work');
    outputs.push(marker);
    const previous = outputs.map(output => [output, fs.readFileSync(output)]);
    const result = spawnSync(process.execPath, [CLI_BIN, ...spec.args], {
      cwd: project, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, VIDEO_PROJECT_ROOT: project, PYTHON_BIN: resolvePython(PKG_ROOT, true), FFMPEG_BIN: resolveFfmpeg(PKG_ROOT) },
    });
    assert.equal(result.error, undefined, `${spec.name}: remix must settle`);
    assert.notEqual(result.status, 0, `${spec.name}: changed spoken text must be rejected`);
    for (const [output, bytes] of previous) {
      assert.ok(fs.existsSync(output) && fs.readFileSync(output).equals(bytes), `${spec.name}: rejected remix must preserve ${path.relative(project, output)}`);
    }
    assert.match(result.stderr, /Spoken lines no longer match timings/, `${spec.name}: rejection must report stale spoken text`);
    assert.doesNotMatch(result.stdout, /\[1\/3\]/, 'Invalid remix must be rejected before exporting or mixing');
  }
}

function verifyTimingOutputRegressions() {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/test-timing-output.mjs'), path.join(TEST_ROOT, 'timing-output')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `Timing output regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyUnicodePythonBuild() {
  const root = path.join(TEST_ROOT, 'unicode-python');
  const id = '视频😀';
  const videoDir = path.join(root, 'videos', id);
  const audioRel = 'assets/旁白😀.m4a';
  fs.mkdirSync(videoDir, { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script></body></html>');
  fs.writeFileSync(path.join(videoDir, 'video.config.js'), `V.config={width:320,height:180,fps:2,audioSrc:${JSON.stringify(audioRel)},bgm:false,sfx:false,tts:false,sceneScripts:["scenes.js"]};`);
  fs.writeFileSync(path.join(videoDir, 'scenes.js'), 'V.scene({duration:1,lines:[],build(){},update(){}});');
  const built = spawnSync(process.execPath, [CLI_BIN, 'build', id], {
    cwd: root, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, VIDEO_PROJECT_ROOT: root, PYTHONUTF8: '0', PYTHONIOENCODING: 'ascii' },
  });
  assert.equal(built.error, undefined, `Unicode build must settle: ${built.stdout}\n${built.stderr}`);
  assert.equal(built.status, 0, `Unicode paths must build independently of the parent Python stream encoding:\n${built.stdout}\n${built.stderr}`);
  assert.ok(built.stdout.includes('旁白😀.m4a'), 'Python logs must preserve Unicode text as UTF-8');
  assert.ok(built.stdout.includes('Audio verified:'), 'Unicode output must pass physical audio verification');
  const output = path.join(videoDir, audioRel);
  const decoded = spawnSync(resolveFfmpeg(PKG_ROOT), ['-loglevel', 'error', '-i', output, '-f', 's16le', '-ac', '2', '-ar', '48000', '-'], { timeout: 15000 });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  const duration = decoded.stdout.length / (48000 * 2 * 2);
  assert.ok(Math.abs(duration - 1) < 0.03, `Unicode output must decode to one second of stereo audio, got ${duration}`);
}

function verifyHttpFileMutationRegressions() {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/test-http-file-races.mjs'), path.join(TEST_ROOT, 'http-file-mutations')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `HTTP file mutation regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyInputPathSafetyRegressions(quick = false) {
  const args = [path.join(PKG_ROOT, 'tools/test-input-path-safety.mjs'), path.join(TEST_ROOT, 'input-path-safety')];
  if (quick) args.push('--quick');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `Input path safety regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyRenderCacheIdentityRegressions() {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/test-render-cache-identity.mjs'), path.join(TEST_ROOT, 'render-cache-identity')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `Render cache identity regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyRenderParallelRegressions(integration = false) {
  const args = [path.join(PKG_ROOT, 'tools/test-render-parallel.mjs')];
  if (integration) args.push(path.join(TEST_ROOT, 'render-parallel'));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, `Parallel rendering regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyRenderEncoderExitRegression() {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/test-render-encoder.mjs'), path.join(TEST_ROOT, 'render-encoder-exit')], { encoding: 'utf8', timeout: 130000 });
  assert.equal(r.status, 0, `Early encoder exit regression failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyRenderMuxRegression() {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/test-render-mux.mjs'), path.join(TEST_ROOT, 'render-mux')], { encoding: 'utf8', timeout: 420000 });
  assert.equal(r.status, 0, `Final mux output regression failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyModuleEntryRegressions() {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/test-module-entry.mjs'), path.join(TEST_ROOT, 'module-entry')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `Module entry regressions failed:\n${r.stdout}\n${r.stderr}`);
}

function verifyAuditLaunchFailureCleanup() {
  const invalidBrowser = path.join(TEST_ROOT, 'invalid-browser.txt');
  fs.writeFileSync(invalidBrowser, 'This file is not a browser executable.', 'utf8');
  const auditUrl = pathToFileURL(path.join(PKG_ROOT, 'tools/audit-visual.mjs')).href;
  const code = [
    'import assert from "node:assert/strict";',
    `import { auditVideos } from ${JSON.stringify(auditUrl)};`,
    'await assert.rejects(auditVideos(["demo"]), /browserType.launch/);',
    'console.log("Browser startup failure handled");',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: TEST_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: TEST_ROOT, CHROME_BIN: invalidBrowser }),
  });
  assert.equal(r.error, undefined, `Caught browser startup failure must not leave a running HTTP server: ${r.error}`);
  assert.equal(r.status, 0, `Audit browser failure cleanup check failed:\n${r.stderr}`);
  assert.ok(r.stdout.includes('Browser startup failure handled'), 'Audit must reject when the browser cannot start');
}

function verifyBundleSourcePreflight() {
  const outDir = path.join(TEST_ROOT, 'dist-invalid-sources');
  const marker = path.join(outDir, 'previous-build.txt');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(marker, 'last known good build', 'utf8');
  fs.writeFileSync(path.join(TEST_ROOT, 'videos/not-a-directory'), 'not a video directory', 'utf8');
  fs.mkdirSync(path.join(TEST_ROOT, 'outside-video'), { recursive: true });
  fs.writeFileSync(path.join(TEST_ROOT, 'outside-video/index.html'), '<h1>Outside videos</h1>', 'utf8');
  const invalidTargets = [
    ['demo', 'missing-video'],
    ['not-a-directory'],
    ['not-a-directory', '--single'],
    ['../outside-video'],
    ['../outside-video', '--single'],
  ];
  for (const args of invalidTargets) {
    assertCliFails(['bundle', ...args, '--out', outDir], `bundle must reject invalid source: ${args.join(' ')}`);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'last known good build', 'Invalid bundle sources must preserve the previous output');
  }
  const validId = '演示 空格';
  const html = '<h1>Valid video</h1>';
  fs.mkdirSync(path.join(TEST_ROOT, 'videos', validId));
  fs.writeFileSync(path.join(TEST_ROOT, 'videos', validId, 'index.html'), html, 'utf8');
  runCliCmd(['bundle', validId, '--single', '--out', outDir]);
  assert.equal(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'), html, 'Valid Unicode and space-containing video IDs must still bundle');
}

function verifyBundleProtectedDirectories() {
  const pkg = path.join(TEST_ROOT, 'guarded-package');
  fs.mkdirSync(path.join(pkg, 'tools/lib'), { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, 'tools/bundle.mjs'), path.join(pkg, 'tools/bundle.mjs'));
  fs.copyFileSync(path.join(PKG_ROOT, 'tools/lib/paths.mjs'), path.join(pkg, 'tools/lib/paths.mjs'));
  const fileOut = path.join(TEST_ROOT, 'existing-file.txt');
  const markers = [
    path.join(TEST_ROOT, '.git/HEAD'), path.join(pkg, '.git/HEAD'),
    path.join(pkg, 'runtime/base/js/engine.js'), path.join(pkg, 'bin/html-video.mjs'),
    path.join(pkg, 'skills/html-video/SKILL.md'), fileOut,
  ];
  for (const file of markers) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'protected source', 'utf8');
  }
  const alias = path.join(pkg, 'runtime-alias');
  fs.symlinkSync(path.join(pkg, 'runtime'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const targets = [
    path.join(TEST_ROOT, '.git'), path.join(pkg, '.git'),
    path.join(pkg, 'runtime'), path.join(pkg, 'bin'), path.join(pkg, 'skills'), fileOut,
    path.join(alias, 'base'), path.join(alias, 'new-output'),
  ];
  for (const target of targets) {
    for (const flags of [[], ['--single']]) {
      const r = spawnSync(process.execPath, [path.join(pkg, 'tools/bundle.mjs'), 'demo', ...flags, '--out', target], {
        cwd: TEST_ROOT,
        encoding: 'utf8',
        env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: TEST_ROOT }),
      });
      assert.notEqual(r.status, 0, `bundle must reject protected output: ${target}`);
      for (const file of markers) assert.equal(fs.readFileSync(file, 'utf8'), 'protected source', 'Rejected output must preserve all source and metadata files');
    }
  }
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

function verifyLocalizedRemixAndBgmVolume(videoDir) {
  const enLocalePath = path.join(videoDir, 'locales/en.js');
  const origEn = fs.readFileSync(enLocalePath, 'utf8');
  const editedEn = origEn.replace(
    'Every pure function stays deterministic.',
    'Every pure function, stays deterministic.'
  );
  assert.notEqual(editedEn, origEn, 'locales/en.js test target string must match');
  fs.writeFileSync(enLocalePath, editedEn, 'utf8');
  runCliCmd(['mix', 'demo', '--lang=en', '--bitrate=96k']);
  const enTimings = fs.readFileSync(path.join(videoDir, 'assets/voice/timings.en.js'), 'utf8');
  assert.ok(
    enTimings.includes('"Every pure function"') && enTimings.includes('"stays deterministic"'),
    'mix --lang=en must refresh V.voice.subCues clause splits after punctuation edits'
  );
  fs.writeFileSync(enLocalePath, origEn, 'utf8');
  runCliCmd(['mix', 'demo', '--lang=en', '--bitrate=96k']);

  const py = resolvePython(PKG_ROOT, true);
  const bgmCheckDir = path.join(TEST_ROOT, 'bgm-vol-check');
  fs.mkdirSync(bgmCheckDir, { recursive: true });
  const cuesJson = path.join(bgmCheckDir, 'cues.json');
  const bgmWav = path.join(bgmCheckDir, 'bgm.wav');
  fs.writeFileSync(cuesJson, JSON.stringify({
    duration: 1.5,
    videoDir: bgmCheckDir,
    bgm: { preset: 'ambient', volume: 0.12 },
    sfx: false,
    scenes: [{ title: 'S1', start: 0, duration: 1.5, cues: [] }],
  }), 'utf8');
  const r = spawnSync(py, [path.join(PKG_ROOT, 'tools/mix.py'), cuesJson, bgmCheckDir, '', bgmWav], { encoding: 'utf8' });
  assert.equal(r.status, 0, `BGM-only mix.py failed: ${r.stderr}`);
  const peakRes = spawnSync(py, ['-c', `import soundfile as sf, numpy as np; y,_=sf.read(${JSON.stringify(bgmWav)}); print(float(np.abs(y).max()))`], { encoding: 'utf8' });
  const bgmPeak = parseFloat((peakRes.stdout || '').trim());
  assert.ok(bgmPeak > 0.03 && bgmPeak < 0.35, `BGM-only volume=0.12 must preserve configured gain (got peak=${bgmPeak})`);
}

async function verifyScaffoldAndStaticBundle() {
  runCliCmd(['init', 'demo', '--title', '微内核自检演示', '--skill']);
  assert.equal(fs.existsSync(path.join(TEST_ROOT, 'videos/base')), false, 'Runtime must be served from the package');
  assert.ok(fs.existsSync(path.join(TEST_ROOT, '.agents/skills/html-video/SKILL.md')), '--skill must export SKILL.md');
  const { sandbox } = loadVideoSandbox(TEST_ROOT, 'demo', { ignoreBaked: true });
  assert.ok(sandbox.V.scenes.length > 0 && sandbox.V.duration > 0, 'The starter must produce a playable timeline');
  assert.ok(sandbox.V.scenes[0].subCues.length > 0, 'The starter must produce subtitle cues');
  const { srv, port } = await startEphemeralVideoServer({ videosDir: path.join(TEST_ROOT, 'videos') });
  try {
    await verifyHttpRanges(port);
    for (const route of ['/demo/', '/demo/video.config.js', '/demo/js/scenes.js', '/base/js/engine.js', '/base/css/base.css']) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 200, `Scaffold asset must be served: ${route}`);
      assert.ok((await response.text()).length > 0, `Scaffold asset must not be empty: ${route}`);
    }
  } finally {
    srv.closeAllConnections();
    await new Promise(resolve => srv.close(resolve));
  }
  verifyInvalidRenderCliArgs();
  const dist = path.join(TEST_ROOT, 'smoke-dist');
  runCliCmd(['bundle', 'demo', '--out', dist]);
  assert.ok(fs.existsSync(path.join(dist, 'base/js/engine.js')), 'Bundle must include the runtime');
  assert.ok(fs.existsSync(path.join(dist, 'demo/index.html')), 'Bundle must include the video');
  verifyBundledProjectFiles(dist);
  verifyBundleSourcePreflight();
  verifyBundleProtectedDirectories();
}

async function runQuickChecks() {
  const started = performance.now();
  console.log('[Quick 1/3] HTTP, input paths and module imports...');
  await verifyProjectFileOwnership();
  verifyHttpFileMutationRegressions();
  verifyInputPathSafetyRegressions(true);
  verifyModuleEntryRegressions();
  for (const name of ['test-content-sampling.mjs', 'test-components.mjs']) {
    const check = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools', name)], { encoding: 'utf8', timeout: 30000 });
    assert.equal(check.status, 0, name + '\n' + check.stdout + check.stderr);
  }

  console.log('[Quick 2/3] Timeline, subtitles, render arguments and cache identity...');
  verifySceneSourceParsing();
  verifyRenderArgumentValidation();
  verifySpokenTextRules();
  verifyTimingOutputRegressions();
  verifyRenderCacheIdentityRegressions();
  verifyRenderParallelRegressions();
  verifyLargeAssetCacheInvalidation();
  verifyNestedStylesheetCacheInvalidation();
  verifyNestedVisualAssetCacheInvalidation();
  verifySceneCacheGranularity();
  verifyRenderOutputCacheExclusion();

  console.log('[Quick 3/3] Init, preview assets, bundle and output protection...');
  await verifyScaffoldAndStaticBundle();
  console.log(`✅ Quick tests PASSED (${((performance.now() - started) / 1000).toFixed(1)}s).`);
}

async function main() {
  const started = performance.now();
  fs.mkdirSync(path.join(TEST_ROOT, 'videos'), { recursive: true });
  try {
    await runQuickChecks();
    if (process.argv.includes('--quick')) return;

    console.log('[Full 1/5] Build input protection, encoder/mux failures and audio regressions...');
    for (const name of ['test-frame-interfaces.mjs', 'test-managed-sources.mjs', 'test-player-api.mjs']) {
      const check = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools', name)], { encoding: 'utf8', timeout: 180000 });
      assert.equal(check.status, 0, name + '\n' + check.stdout + check.stderr);
    }
    verifyInputPathSafetyRegressions();
    verifyRenderEncoderExitRegression();
    verifyRenderMuxRegression();
    verifyAuditLaunchFailureCleanup();
    verifyTtsOptionsAndCacheKeys();
    verifyVoiceCacheRegressions();
    verifyMixAudioRegressions();
    verifyUnicodePythonBuild();
    verifyMultilingualTokensAndSceneBgm();
    const videoDir = path.join(TEST_ROOT, 'videos/demo');
    createSampleMp4(resolveFfmpeg(PKG_ROOT), path.join(videoDir, 'assets/clip.mp4'));
    writeTestProjectFiles(videoDir);

    console.log('[Full 2/5] Building localized tracks, offline remix and visual audit...');
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
    verifyMixSpokenTextPreflight(videoDir);
    verifyLocalizedRemixAndBgmVolume(videoDir);
    const shotDir = path.join(TEST_ROOT, 'audit-shots');
    runCliCmd(['audit', 'demo', '--screenshots', shotDir]);
    verifyFreshUnbuiltAudit();

    console.log('[Full 3/5] Chromium playback, frame reuse, checkpoints, HMR and locales...');
    await verifyBrowserCapabilities(videoDir);

    console.log('[Full 4/5] Cold render, warm cache, style invalidation and voice-only output...');
    verifyRenderParallelRegressions(true);
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
    const outNoBgm = path.join(TEST_ROOT, 'demo-nobgm.mp4');
    const out3 = runCliCmd(['render', 'demo', outNoBgm, '--fps', '10', '--no-bgm']);
    assert.ok(fs.existsSync(outNoBgm) && out3.includes('+ audio ->'), `--no-bgm render must mux voice-only stem, got:\n${out3}`);

    console.log('[Full 5/5] Bundled project assets and special-character export paths...');
    const distDir = path.join(TEST_ROOT, 'dist');
    runCliCmd(['bundle', 'demo', '--out', distDir]);
    assert.ok(fs.existsSync(path.join(distDir, 'base/js/engine.js')), 'Bundled base/js/engine.js should exist');
    assert.ok(fs.existsSync(path.join(distDir, 'demo/index.html')), 'Bundled demo/index.html should exist');
    verifyBundledProjectFiles(distDir);

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
    verifySpecialCharacterVideoPaths();

    console.log(`✅ Full tests PASSED (${((performance.now() - started) / 1000).toFixed(1)}s, including quick tests).`);
  } finally {
    assert.equal(path.dirname(TEST_ROOT), RUNTIME_DIR, 'Cleanup must stay inside the private runtime directory');
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

await main();
