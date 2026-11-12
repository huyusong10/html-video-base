/* core/09-player.js · 舞台挂载、可主题化控制栏、章节分段、倍速上拉菜单、音频主时钟与 V.boot 启动器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, prog, appear, h, svg, toggle, syncVideoClip } = V.u;

  const CTRL_ICONS = {
    webEnter: ['M2 3h12a.75.75 0 0 1 .75.75v8.5A.75.75 0 0 1 14 13H2a.75.75 0 0 1-.75-.75v-8.5A.75.75 0 0 1 2 3z', 'M1.25 5.5h13.5', 'M4.5 8.5v-1.5H6', 'M11.5 9.5V11H10'],
    webExit: ['M2 3h12a.75.75 0 0 1 .75.75v8.5A.75.75 0 0 1 14 13H2a.75.75 0 0 1-.75-.75v-8.5A.75.75 0 0 1 2 3z', 'M1.25 5.5h13.5', 'M6 7v1.5H4.5', 'M10 11V9.5h1.5'],
    fullEnter: ['M2.5 6V2.5H6', 'M10 2.5h3.5V6', 'M13.5 10v3.5H10', 'M6 13.5H2.5V10'],
    fullExit: ['M6 2.5V6H2.5', 'M10 2.5V6h3.5', 'M13.5 10H10v3.5', 'M2.5 10H6v3.5'],
  };
  const DEFAULT_RATES = [2, 1.5, 1.25, 1, 0.75];

  const params = new URLSearchParams(location.search);
  const RECORD = params.has('record') || params.has('capture');
  const DEV = params.has('dev') && !RECORD;
  V._isRecord = RECORD;

  let audio = null, stage = null, subs = null, subLead = null, subTail = null, subSpeaker = null, subText = null;
  let current = null, now = 0, prevRenderNow = 0, playing = false, lastTs = 0, pauseBaseTs = 0, ended = false;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false, muted = false;
  let scrubbing = false, targetSeekTime = null, lastSeekTarget = -1, lastSeekAt = 0;
  let audioBlocked = false, playPending = false, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null;
  let wipeState = { name: '', handler: null, dom: null };
  const sandboxState = { active: false, entering: false, returnTime: null, el: null, txtEl: null, backEl: null };
  const ui = {};

  function canExpandParentFrame() {
    try {
      return Boolean(window.frameElement && window.parent === window.top);
    } catch {
      return false;
    }
  }

  function resolveWebFull(u) {
    if (typeof u.webFull === 'boolean') return u.webFull;
    return canExpandParentFrame();
  }

  function getUiCfg(cfg) {
    const u = (cfg && cfg.ui) || {};
    return {
      controlsMode: u.controlsMode || (cfg && cfg.controlsMode) || 'docked',
      chapterMarks: u.chapterMarks !== false && (!cfg || cfg.chapterMarks !== false),
      hud: u.hud !== undefined ? Boolean(u.hud) : (!cfg || cfg.hud !== false),
      rate: u.rate !== false,
      webFull: resolveWebFull(u),
      rates: Array.isArray(u.rates) && u.rates.length ? u.rates : DEFAULT_RATES,
      icons: Object.assign({}, CTRL_ICONS, u.icons || {}),
    };
  }

  function makeCtrlIcon(spec) {
    if (typeof spec === 'string') {
      return svg(spec, 'class="ctrl-ico" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"');
    }
    return svg(
      spec.map(d => `<path d="${d}"/>`).join(''),
      'class="ctrl-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
    );
  }

  function renderCustomControls(pos) {
    return V.controls.filter(c => (c.position || 'right') === pos).map(c => {
      const btn = typeof c.render === 'function'
        ? c.render(h, V)
        : h('button', { 'data-custom-ctrl': c.id || '', title: c.title || '' }, c.label || c.id || '');
      if (typeof c.onClick === 'function') btn.addEventListener('click', e => c.onClick(e, V));
      c._el = btn;
      return btn;
    });
  }

  function buildControlsBar(cfg, uiCfg) {
    const homeLink = cfg.homeUrl === false
      ? null
      : h('a', { class: 'ctrl-home', href: cfg.homeUrl || '../', title: '返回视频中心主界面' }, cfg.homeLabel || '⌂ 主界面');
    const rateWrap = uiCfg.rate
      ? h('div', { class: 'rate-wrap' },
          h('button', { class: 'ctrl-rbtn rate-trigger', 'data-act': 'rate', title: '播放倍速' }, '1.0x'),
          h('div', { class: 'rate-menu' }))
      : null;
    const webFullBtn = uiCfg.webFull
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: '窗口全屏（W）', 'aria-label': '窗口全屏' }, makeCtrlIcon(uiCfg.icons.webEnter))
      : null;
    return h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { 'data-act': 'play', title: '播放 / 暂停（空格）' }, '▶'),
      ...renderCustomControls('left'),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: '切换章节' }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, '▲')),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, '章节导航 · CHAPTERS'), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right'),
      rateWrap,
      h('button', { class: 'ctrl-rbtn', 'data-act': 'subs', title: '字幕开关' }, '字幕'),
      h('button', { class: 'ctrl-rbtn', 'data-act': 'mute', title: '声音开关' }, '声音'),
      webFullBtn,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: '全屏（F）', 'aria-label': '全屏' }, makeCtrlIcon(uiCfg.icons.fullEnter)));
  }

  V.mountStage = function () {
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    document.body.classList.toggle('ctrl-overlay', uiCfg.controlsMode === 'overlay');
    if (document.getElementById('stage')) return;

    const sbTxt = h('span', { class: 'v-sandbox-txt egg-ban-txt' }, '🎮 彩蛋试玩中');
    const sbBack = h('button', { class: 'v-sandbox-back egg-back-btn', 'data-interactive': '1', type: 'button' }, '↩ 返回终章');
    const sbBar = h('div', { class: 'v-sandbox-bar egg-banner', 'data-interactive': '1' }, sbTxt, sbBack);
    sandboxState.el = sbBar;
    sandboxState.txtEl = sbTxt;
    sandboxState.backEl = sbBack;

    const vp = h('div', { id: 'viewport' },
      h('div', { id: 'stage' },
        h('canvas', { id: 'gl', width: String(W), height: String(H), class: V.gl ? '' : 'is-off' }),
        h('div', { id: 'hud', 'data-interactive': '1', class: uiCfg.hud ? '' : 'is-off' }, h('div', { class: 'hud-track' }, h('i', { class: 'hud-bar' }))),
        h('div', { id: 'subs', 'data-sub-pos': 'center' },
          h('div', { class: 'sub-lead' }),
          h('span', { class: 'sub-speaker' }),
          h('p', { class: 'sub-text' }, h('span', { class: 'ghost' }), h('span')),
          h('div', { class: 'sub-tail' })),
        sbBar,
        h('div', { id: 'checkpoint-overlay' }),
        h('div', { id: 'wipe' }),
        h('div', { id: 'safe-guide' }, h('div', { class: 'safe-action' }), h('div', { class: 'safe-sub' }, 'SUBTITLE SAFE ZONE'))),
      h('div', { id: 'start-hint' }, cfg.startHint || '▶ 点击画面开始播放'));

    document.body.prepend(vp, buildControlsBar(cfg, uiCfg));
  };

  function sceneAt(t) {
    for (const sc of V.scenes) if (t < sc.start + sc.duration) return sc;
    return V.scenes[V.scenes.length - 1];
  }

  function enter(sc) {
    if (current && current.root) current.root.remove();
    V._videoClips.clear();
    const si = V.scenes.indexOf(sc);
    sc.root = h('div', { class: 'scene ' + (sc.cls || '') });
    sc.ctx = V.makeCtx(sc, si);
    stage.appendChild(sc.root);
    sc.build(sc.root, sc.ctx);
    current = sc;
    V.emit('onSceneEnter', { scene: sc, sceneIndex: si });
  }

  function findNearestCut() {
    let near = 999, cutSc = null;
    for (const sc of V.scenes) {
      if (sc.start > 0 && Math.abs(now - sc.start) < Math.abs(near)) {
        near = now - sc.start;
        cutSc = sc;
      }
    }
    return { near, cutSc };
  }

  function runTransition() {
    const box = document.getElementById('wipe');
    if (!box || V.scenes.length < 2) return;
    const cfg = V.getCfg();
    const { near, cutSc } = findNearestCut();
    const name = (cutSc && cutSc.transition) || cfg.transition || 'fade';
    const handler = V.transitions[name] || V.transitions.fade;
    if (!handler) return;
    if (wipeState.name !== name) {
      box.innerHTML = '';
      wipeState = { name, handler, dom: handler.mount ? handler.mount(box, cfg) : {} };
    }
    const dur = cfg.transitionDur === undefined ? (handler.dur || 0.28) : cfg.transitionDur;
    handler.update(wipeState.dom, near, dur, current, cfg);
  }

  function updateHud() {
    const el = document.getElementById('hud');
    if (el && !el.classList.contains('is-off')) {
      el.querySelector('.hud-bar').style.width = clamp(now / V.duration) * 100 + '%';
    }
  }

  const SUB_VAR_MAP = [
    ['left', '--sub-left'], ['right', '--sub-right'], ['top', '--sub-top'], ['bottom', '--sub-bottom'],
    ['offsetX', '--sub-offset-x'], ['offsetY', '--sub-offset-y'], ['align', '--sub-align'],
    ['maxWidth', '--sub-max-w'], ['padding', '--sub-padding'], ['gap', '--sub-gap'], ['zIndex', '--sub-z'],
  ];

  function getSubCfg() {
    const cfg = V.getCfg();
    return Object.assign({}, cfg.subtitles || {}, V.subtitles || {});
  }

  function resolveSubLayoutObj(spec, subCfg) {
    if (!spec) return { pos: 'center' };
    if (typeof spec === 'string') {
      const m = subCfg && subCfg.modes && subCfg.modes[spec];
      return m ? Object.assign({ pos: 'center' }, m) : { pos: spec };
    }
    return Object.assign({ pos: spec.pos || 'center' }, spec);
  }

  function applySubLayout(spec) {
    if (!subs) return;
    const obj = resolveSubLayoutObj(spec, getSubCfg());
    subs.dataset.subPos = obj.pos || 'center';
    for (const [prop, cssVar] of SUB_VAR_MAP) {
      const val = obj[prop];
      if (val == null || val === '') subs.style.removeProperty(cssVar);
      else subs.style.setProperty(cssVar, typeof val === 'number' && prop !== 'zIndex' ? `${val}px` : String(val));
    }
  }
  V.setSubLayout = applySubLayout;

  function mountSubSlot(slotEl, factory) {
    if (!slotEl || !factory) return;
    slotEl.innerHTML = '';
    const res = typeof factory === 'function' ? factory(h, V) : factory;
    if (!res) return;
    if (res.nodeType) slotEl.appendChild(res);
    else slotEl.innerHTML = String(res);
  }

  function mountSubSlots() {
    const subCfg = getSubCfg();
    mountSubSlot(subLead, subCfg.lead);
    mountSubSlot(subTail, subCfg.tail);
    if (subCfg.layout || subCfg.position) applySubLayout(subCfg.layout || subCfg.position);
  }

  function runSubHook(subCfg, cue, sc, idx, lt, clock) {
    const fn = subCfg.onUpdate || subCfg.update;
    if (typeof fn !== 'function') return;
    const lineCue = activeCueIdx >= 0 ? sc.cues[activeCueIdx] : null;
    const info = { t: now, clock, lt, scene: sc, sceneIndex: idx, lineCue, speaking: Boolean(cue), energy: V.getSceneEnergy(sc, idx, lt) };
    fn(cue, info, { subs, lead: subLead, tail: subTail, speaker: subSpeaker, text: subText });
  }

  function syncSceneSubLayout(sc, lt) {
    const spec = sc.subLayout || sc.subtitles;
    if (!spec) return;
    applySubLayout(typeof spec === 'function' ? spec(lt, sc.ctx, sc) : spec);
  }

  function updateSubDomText(cue) {
    if (subSpeaker && subSpeaker._sp !== (cue.speaker || '')) {
      subSpeaker._sp = cue.speaker || '';
      subSpeaker.textContent = subSpeaker._sp;
      subSpeaker.classList.toggle('is-on', Boolean(subSpeaker._sp));
    }
    if (subText._t !== cue.text) {
      subText.firstChild.textContent = cue.text;
      subText.lastChild.textContent = cue.text;
      subText._t = cue.text;
    }
  }

  function updateSubs(sc, idx, lt, clock) {
    const subCfg = getSubCfg();
    syncSceneSubLayout(sc, lt);
    const list = sc.subCues && sc.subCues.length ? sc.subCues : sc.cues;
    let cue = null;
    activeCueIdx = -1;
    sc.cues.forEach((c, i) => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) activeCueIdx = i; });
    list.forEach(c => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) cue = c; });
    subs.style.visibility = cue && showSubs ? 'visible' : 'hidden';
    if (cue) {
      const a = Math.min(appear(lt, cue.start - 0.04, 0.14), 1 - prog(lt, cue.end, cue.end + 0.12));
      subs.style.opacity = String(clamp(a));
      updateSubDomText(cue);
    }
    runSubHook(subCfg, cue, sc, idx, lt, clock);
  }

  function syncSceneVideoClips(lt) {
    for (const clip of V._videoClips) {
      if (clip.isConnected) syncVideoClip(clip, lt, playing && !scrubbing);
    }
  }

  function resolveDefaultSandboxReturn() {
    const last = V.scenes[V.scenes.length - 1];
    if (!last) return Math.max(0, V.duration - 0.5);
    if (typeof last.sandboxReturnOffset === 'number') return last.start + last.sandboxReturnOffset;
    const lastCue = last.cues && last.cues.length ? last.cues[last.cues.length - 1] : null;
    return lastCue ? Math.min(V.duration - 0.05, last.start + lastCue.start + 2.5) : Math.max(0, V.duration - 0.5);
  }

  function setSandboxActiveDom(on, hint, backLabel) {
    sandboxState.active = on;
    document.body.classList.toggle('sandbox-mode', on);
    document.body.classList.toggle('egg-mode', on);
    if (!sandboxState.el) return;
    sandboxState.el.classList.toggle('on', on);
    if (on && hint && sandboxState.txtEl) sandboxState.txtEl.textContent = hint;
    if (on && backLabel && sandboxState.backEl) sandboxState.backEl.textContent = backLabel;
  }

  function exitSandbox(seekBack = true) {
    const ret = sandboxState.returnTime;
    setSandboxActiveDom(false);
    if (seekBack && ret != null) {
      seek(ret);
      pause();
    }
  }

  function enterSandbox(opts = {}) {
    const target = Number(opts.targetTime);
    if (!Number.isFinite(target)) return;
    const prefix = opts.prefix === undefined ? '🎮 彩蛋试玩：' : opts.prefix;
    const label = opts.hint ? prefix + opts.hint : '🎮 彩蛋试玩中';
    sandboxState.returnTime = Number.isFinite(opts.returnTime) ? opts.returnTime : resolveDefaultSandboxReturn();
    sandboxState.entering = true;
    setSandboxActiveDom(true, label, opts.backLabel || '↩ 返回终章');
    seek(target);
    pause();
    sandboxState.entering = false;
  }

  function tryEgg(targetTime, hint, opts) {
    enterSandbox(Object.assign({}, opts || {}, { targetTime, hint }));
  }

  function replay() {
    exitSandbox(false);
    V.resetCheckpoints();
    seek(0);
    play();
  }

  function isInteractiveHold() {
    if (sandboxState.active) return true;
    if (!ended || !current) return false;
    const cfg = V.getCfg();
    return Boolean(current.live || current.interactiveEnd || cfg.interactiveEnd);
  }

  function shouldContinueSceneAtEnd(sc, idleSec) {
    if (!ended || idleSec <= 0 || !sc.live || sc.freezeTimelineAtEnd) return false;
    return sc === V.scenes[V.scenes.length - 1];
  }

  function syncSceneCtxAndEndState(sc, idle) {
    ended = !playing && now >= V.duration - 0.01;
    document.body.classList.toggle('is-ended', ended);
    if (sandboxState.active && !sandboxState.entering && sc === V.scenes[V.scenes.length - 1]) setSandboxActiveDom(false);
    if (sc !== current) enter(sc);
    sc.ctx.clock = V._clock;
    sc.ctx.idle = idle;
    sc.ctx.ended = ended;
  }

  function render(t, idleSec) {
    if (!V.scenes.length || !Number.isFinite(t)) return;
    const idle = idleSec || 0;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    const clock = now + idle;
    prevRenderNow = now;
    V._now = now;
    V._clock = clock;
    const sc = sceneAt(now);
    syncSceneCtxAndEndState(sc, idle);
    const lt = now - sc.start;
    const idx = V.scenes.indexOf(sc);

    runTransition();
    if (V.gl && V.gl.ready) V.gl.render(now, clock);
    updateHud();
    stage.style.setProperty('--tg', ((clock % 6) / 6) * 150);
    stage.style.setProperty('--anim-t', (-clock).toFixed(3) + 's');
    document.body.classList.toggle('started', now > 0.05);
    sc.update(shouldContinueSceneAtEnd(sc, idle) ? lt + idle : lt, sc.ctx);
    syncSceneVideoClips(lt);
    updateSubs(sc, idx, lt, clock);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: RECORD, playing, scrubbing, pause, play });
    V.emit('onRender', { now, clock, idle, ended, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx, playing, scrubbing, hasAudio: Boolean(audio), isRecord: RECORD, muted });
    if (!RECORD) updateUI();
  }

  function safePlayAudio() {
    if (!audio || !playing || !audio.paused || playPending) return;
    playPending = true;
    audio.playbackRate = playbackRate;
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { playPending = false; audioBlocked = false; })
       .catch(err => { playPending = false; if (err && err.name === 'NotAllowedError') audioBlocked = true; });
    } else {
      playPending = false;
    }
  }

  function checkSceneLoop(nextT) {
    if (!loopScene || !current) return false;
    const scEnd = current.start + current.duration - 0.03;
    if (now > scEnd || nextT < scEnd) return false;
    seek(current.start + 0.02);
    return true;
  }

  function finishPlayback() {
    render(V.duration - 0.001, 0);
    pause();
    V.emit('onEnded', { duration: V.duration, scene: current });
  }

  function advanceAudioClock(ts) {
    lastTs = ts;
    if (targetSeekTime == null && !audio.paused && !audio.seeking && audio.readyState >= 2) {
      if (checkSceneLoop(audio.currentTime)) return;
      if (audio.ended || audio.currentTime >= V.duration - 0.01) finishPlayback();
      else render(audio.currentTime, 0);
      return;
    }
    if (audio.paused && audio.readyState >= 1 && !audio.seeking) safePlayAudio();
    if (current && current.live) render(now, 0);
  }

  function advanceWallClock(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (now + dt >= V.duration - 0.002) finishPlayback();
    else render(now + dt, 0);
  }

  function canSyncAudioWhileScrubbing() {
    if (!playing || !audio) return false;
    return !audio.paused && !audio.seeking && audio.readyState >= 2 && targetSeekTime == null;
  }

  function frame(ts) {
    if (scrubbing) {
      lastTs = ts;
      pauseBaseTs = ts;
      if (canSyncAudioWhileScrubbing()) render(audio.currentTime, 0);
      else if (current && current.live) render(now, 0);
    } else if (playing) {
      if (audio && !audioBlocked) advanceAudioClock(ts);
      else advanceWallClock(ts);
    } else if (current && current.live && !RECORD) {
      const idleSec = pauseBaseTs > 0 ? Math.max(0, (ts - pauseBaseTs) / 1000) : 0;
      render(now, idleSec);
    }
    requestAnimationFrame(frame);
  }

  function syncAudioBeforePlay() {
    const target = targetSeekTime != null ? targetSeekTime : now;
    if (Math.abs(audio.currentTime - target) > 0.15) {
      try { audio.currentTime = target; lastSeekTarget = target; lastSeekAt = performance.now(); targetSeekTime = null; }
      catch { targetSeekTime = target; }
    } else {
      targetSeekTime = null;
    }
    safePlayAudio();
  }

  function setOpenMenu(bar, which) {
    if (!bar) return;
    const mode = which || '';
    bar.dataset.menu = mode;
    bar.classList.toggle('menu-open', Boolean(mode));
    bar.classList.toggle('chap-open', mode === 'chap');
    bar.classList.toggle('rate-open', mode === 'rate');
    document.body.classList.toggle('menu-open', Boolean(mode));
  }

  function play() {
    if (now >= V.duration - 0.01) { V.resetCheckpoints(); seek(0); }
    setSandboxActiveDom(false);
    ended = false;
    document.body.classList.remove('is-ended');
    V._checkpointsRuntime.closeCheckpointOverlay();
    setOpenMenu(document.getElementById('controls'), '');
    playing = true;
    if (audio && audio.error) audio = null;
    audioBlocked = false;
    lastTs = performance.now();
    if (audio) {
      if (audio.readyState >= 1) syncAudioBeforePlay();
      else audio.addEventListener('loadedmetadata', syncAudioBeforePlay, { once: true });
    }
    document.body.classList.add('playing');
    if (!RECORD) updateUI();
  }

  function pause() {
    playing = false;
    pauseBaseTs = performance.now();
    ended = now >= V.duration - 0.01;
    document.body.classList.remove('playing');
    document.body.classList.toggle('is-ended', ended);
    if (audio) audio.pause();
    for (const clip of V._videoClips) if (clip.pause) clip.pause();
    if (!RECORD) updateUI();
  }

  function fmtRate(r) { return Number.isInteger(r) ? `${r}.0x` : `${r}x`; }

  function syncRateMenuSelection() {
    if (!ui.rateItems) return;
    ui.rateItems.forEach(({ el, rate }) => toggle(el, 'on', Math.abs(rate - playbackRate) < 0.01));
  }

  function setRate(rate) {
    playbackRate = clamp(Number(rate) || 1, 0.25, 4);
    V._playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
    if (ui.rate) {
      ui.rate.textContent = fmtRate(playbackRate);
      ui.rate.classList.toggle('on', Math.abs(playbackRate - 1) > 0.01);
    }
    syncRateMenuSelection();
    V.emit('onRateChange', playbackRate);
  }

  function seek(t) {
    if (!Number.isFinite(t)) return;
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (Math.abs(target - lastSeekTarget) < 0.015 && ts - lastSeekAt < 600) return;
    lastTs = ts;
    pauseBaseTs = ts;
    lastSeekTarget = target;
    lastSeekAt = ts;
    render(target, 0);
    V.emit('onSeek', target);
    if (!audio) return;
    if (audio.readyState >= 1) {
      try { audio.currentTime = now; targetSeekTime = null; } catch { targetSeekTime = now; }
    } else {
      targetSeekTime = now;
    }
  }

  const fmtTime = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function mountHudTicks(uiCfg) {
    const hudTrack = document.querySelector('#hud .hud-track');
    if (!hudTrack) return;
    hudTrack.querySelectorAll('.hud-tick').forEach(n => n.remove());
    if (!uiCfg.chapterMarks || V.duration <= 0) return;
    V.scenes.forEach((sc, i) => {
      if (i > 0) hudTrack.appendChild(h('i', { class: 'hud-tick', style: `left:${((sc.start / V.duration) * 100).toFixed(3)}%` }));
    });
  }

  function mountTrackMarks(track, uiCfg) {
    if (!track) return;
    track.querySelectorAll('.mark').forEach(n => n.remove());
    if (!uiCfg.chapterMarks || V.duration <= 0) return;
    const refNode = track.querySelector('.thumb');
    V.scenes.forEach((sc, i) => {
      if (i <= 0) return;
      const pct = ((sc.start / V.duration) * 100).toFixed(3);
      track.insertBefore(h('i', { class: 'mark', style: `left:${pct}%` }), refNode);
    });
  }

  function bindTrackHoverHint(track) {
    if (!track) return;
    track.addEventListener('pointermove', e => {
      if (V.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const t = clamp((e.clientX - rect.left) / Math.max(1, rect.width)) * V.duration;
      const sc = sceneAt(t);
      const idx = V.scenes.indexOf(sc);
      track.title = sc ? `${String(idx + 1).padStart(2, '0')} · ${sc.title} · ${fmtTime(t)}` : fmtTime(t);
    });
  }

  function buildChapters(bar) {
    const list = bar.querySelector('.chap-list'), trig = bar.querySelector('.chap-trigger');
    ui.chapLabel = bar.querySelector('.chap-cur-txt');
    if (!list || !trig) return;
    list.innerHTML = '';
    ui.chapItems = V.scenes.map((sc, i) => {
      const item = h('div', { class: 'chap-item' }, h('em', null, String(i + 1).padStart(2, '0')), h('span', { class: 'chap-it-title' }, sc.title), h('small', null, fmtTime(sc.start)));
      item.onclick = e => { e.stopPropagation(); setOpenMenu(bar, ''); seek(sc.start + 0.02); };
      list.appendChild(item);
      return item;
    });
    trig.onclick = e => {
      e.stopPropagation();
      setOpenMenu(bar, bar.dataset.menu === 'chap' ? '' : 'chap');
    };
  }

  function buildRateMenu(bar, uiCfg) {
    const menu = bar.querySelector('.rate-menu'), trig = bar.querySelector('.rate-trigger');
    if (!menu || !trig) return;
    menu.innerHTML = '';
    ui.rateItems = uiCfg.rates.map(r => {
      const el = h('div', { class: 'rate-item' }, h('span', null, fmtRate(r)), h('i', null, '✓'));
      el.onclick = e => { e.stopPropagation(); setRate(r); setOpenMenu(bar, ''); };
      menu.appendChild(el);
      return { el, rate: r };
    });
    syncRateMenuSelection();
    trig.onclick = e => {
      e.stopPropagation();
      setOpenMenu(bar, bar.dataset.menu === 'rate' ? '' : 'rate');
    };
  }

  function bindMenuAutoClose(bar) {
    const chapWrap = bar.querySelector('.chap-wrap');
    const rateWrap = bar.querySelector('.rate-wrap');
    addEventListener('pointerdown', e => {
      const inChap = chapWrap && chapWrap.contains(e.target);
      const inRate = rateWrap && rateWrap.contains(e.target);
      if (!inChap && !inRate) setOpenMenu(bar, '');
    });
  }

  function bindScrubber(el) {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      const rect = el.getBoundingClientRect(), startX = e.clientX;
      let dragged = false, uncommittedT = null, lastAudioSeekTs = performance.now();
      scrubbing = true;
      document.body.classList.add('scrubbing');
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      const toTime = cx => clamp((cx - rect.left) / rect.width) * V.duration;
      seek(toTime(e.clientX));
      const mv = ev => {
        if (!dragged && Math.abs(ev.clientX - startX) < 3) return;
        dragged = true;
        const t = toTime(ev.clientX), ts = performance.now();
        if (ts - lastAudioSeekTs > 120) { lastAudioSeekTs = ts; uncommittedT = null; seek(t); }
        else { uncommittedT = t; render(t); }
      };
      const up = () => {
        scrubbing = false;
        document.body.classList.remove('scrubbing');
        if (uncommittedT != null) seek(uncommittedT);
        removeEventListener('pointermove', mv);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  }

  function isOsFull() { return Boolean(document.fullscreenElement || document.webkitFullscreenElement); }

  function syncParentFrameFull(on) {
    try {
      const frameEl = window.frameElement;
      if (!frameEl) return;
      if (on) {
        savedFrameStyle = frameEl.getAttribute('style');
        frameEl.style.cssText += ';position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;max-width:none !important;max-height:none !important;z-index:2147483647 !important;border:0 !important;border-radius:0 !important;margin:0 !important;';
      } else if (savedFrameStyle === null) frameEl.removeAttribute('style');
      else frameEl.setAttribute('style', savedFrameStyle);
    } catch {}
  }

  function setBtnIcon(btn, iconSpec, title, active) {
    if (!btn) return;
    btn.classList.toggle('on', active);
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const oldSvg = btn.querySelector('svg');
    if (oldSvg) oldSvg.replaceWith(makeCtrlIcon(iconSpec));
  }

  function syncFullUI() {
    const osOn = isOsFull();
    const icons = getUiCfg(V.getCfg()).icons;
    document.body.classList.toggle('os-full', osOn);
    document.body.classList.toggle('web-full', webFull);
    setBtnIcon(ui.webfull, webFull ? icons.webExit : icons.webEnter, webFull ? '退出窗口全屏（W / Esc）' : '窗口全屏（W）', webFull);
    setBtnIcon(ui.full, osOn ? icons.fullExit : icons.fullEnter, osOn ? '退出全屏（F / Esc）' : '全屏（F）', osOn);
    fit();
  }

  function setWebFull(on) {
    webFull = Boolean(on);
    syncParentFrameFull(webFull);
    syncFullUI();
    try { window.parent.postMessage({ type: 'video:webfull', active: webFull }, '*'); } catch {}
  }

  function fallbackWebFull(toggle) {
    if (ui.webfull) setWebFull(toggle ? !webFull : true);
  }

  function toggleOsFull() {
    if (isOsFull()) {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
      return;
    }
    const req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!req) { fallbackWebFull(true); return; }
    const p = req.call(document.documentElement);
    if (p && p.catch) p.catch(() => fallbackWebFull(false));
  }

  function jumpChapterDelta(delta) {
    const idx = V.scenes.indexOf(current);
    if (delta > 0 && idx < V.scenes.length - 1) seek(V.scenes[idx + 1].start + 0.01);
    if (delta < 0) seek(V.scenes[Math.max(0, now - current.start < 1.5 ? idx - 1 : idx)].start + 0.01);
  }

  function isEditableTarget(target) {
    const tag = (target && target.tagName) || '';
    return /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
  }

  function isNativeSpaceTarget(target) {
    return Boolean(target && target.closest && target.closest('button, a'));
  }

  function handleEscapeKey(bar, e) {
    if (bar && bar.classList.contains('menu-open')) { setOpenMenu(bar, ''); e.preventDefault(); }
    else if (sandboxState.active) { exitSandbox(true); e.preventDefault(); }
    else if (!isOsFull() && webFull) { setWebFull(false); e.preventDefault(); }
  }

  function bindKeyboard(bar) {
    const keyMap = {
      '.': () => { pause(); seek(now + 1 / 30); },
      ',': () => { pause(); seek(now - 1 / 30); },
      ']': () => jumpChapterDelta(1),
      PageDown: () => jumpChapterDelta(1),
      '[': () => jumpChapterDelta(-1),
      PageUp: () => jumpChapterDelta(-1),
      w: () => fallbackWebFull(true),
      W: () => fallbackWebFull(true),
      f: toggleOsFull,
      F: toggleOsFull,
      Escape: e => handleEscapeKey(bar, e),
    };
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.code === 'Space') {
        if (!isNativeSpaceTarget(e.target)) { e.preventDefault(); playing ? pause() : play(); }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const dir = e.code === 'ArrowRight' ? 1 : -1;
        seek(now + dir * (e.shiftKey ? 1 : 5));
        return;
      }
      if (keyMap[e.key]) keyMap[e.key](e);
    });
  }

  function bindIdleWake() {
    let idle;
    const wakeUi = () => {
      document.body.classList.add('ui-active');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.remove('ui-active'), 2500);
    };
    addEventListener('pointermove', wakeUi);
    addEventListener('pointerdown', wakeUi);
    addEventListener('focusin', wakeUi);
    wakeUi();
    document.getElementById('viewport').addEventListener('click', e => {
      if (e.target.closest('[data-interactive]')) return;
      if (!playing && isInteractiveHold()) return;
      playing ? pause() : play();
    });
  }

  function buildUI(uiCfg) {
    const bar = document.getElementById('controls');
    const track = bar.querySelector('.track');
    const hudEl = document.getElementById('hud');
    ui.play = bar.querySelector('[data-act=play]');
    ui.fill = bar.querySelector('.fill');
    ui.thumb = bar.querySelector('.thumb');
    ui.time = bar.querySelector('.time');
    ui.rate = bar.querySelector('[data-act=rate]');
    ui.mute = bar.querySelector('[data-act=mute]');
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');

    ui.play.onclick = () => (playing ? pause() : play());
    mountTrackMarks(track, uiCfg);
    bindScrubber(track);
    bindTrackHoverHint(track);
    if (hudEl && !hudEl.classList.contains('is-off')) bindScrubber(hudEl);
    buildChapters(bar);
    buildRateMenu(bar, uiCfg);
    bindMenuAutoClose(bar);

    const subsBtn = bar.querySelector('[data-act=subs]');
    subsBtn.classList.toggle('on', showSubs);
    subsBtn.onclick = e => {
      showSubs = !showSubs;
      document.body.classList.toggle('nosubs', !showSubs);
      e.currentTarget.classList.toggle('on', showSubs);
      render(now);
    };
    ui.mute.classList.toggle('on', Boolean(audio) && !muted);
    ui.mute.onclick = e => {
      muted = !muted;
      if (audio) audio.muted = muted;
      e.currentTarget.classList.toggle('on', !muted);
    };
    if (ui.webfull) ui.webfull.onclick = () => setWebFull(!webFull);
    ui.full.onclick = toggleOsFull;
    if (sandboxState.backEl) {
      sandboxState.backEl.onclick = e => { e.stopPropagation(); exitSandbox(true); };
    }
    document.addEventListener('fullscreenchange', syncFullUI);
    document.addEventListener('webkitfullscreenchange', syncFullUI);
    bindKeyboard(bar);
    bindIdleWake();
  }

  function updateUI() {
    if (!ui.fill) return;
    const pct = clamp(now / V.duration) * 100 + '%';
    ui.fill.style.width = pct;
    if (ui.thumb) ui.thumb.style.left = pct;
    ui.time.textContent = fmtTime(now) + ' / ' + fmtTime(V.duration);
    const idx = V.scenes.indexOf(current);
    if (ui.chapLabel && current) ui.chapLabel.textContent = `${String(idx + 1).padStart(2, '0')} · ${current.title}`;
    ui.play.textContent = playing ? '❚❚' : '▶';
    if (ui.chapItems) ui.chapItems.forEach((it, i) => toggle(it, 'on', i === idx));
    V.controls.forEach(c => { if (typeof c.sync === 'function') c.sync(c._el, V); });
  }

  function fit() {
    const vp = document.getElementById('viewport');
    const W = V.stageWidth || 1920, H = V.stageHeight || 1080;
    const vpW = (vp && vp.clientWidth) || innerWidth;
    const vpH = (vp && vp.clientHeight) || innerHeight;
    const k = Math.min(vpW / W, vpH / H);
    const letterbox = Math.max(0, (vpH - H * k) / 2);
    const overlap = Math.round(Math.max(0, (54 - letterbox) / Math.max(0.1, k)));
    stage.style.transform = `translate(-50%,-50%) scale(${k})`;
    stage.style.setProperty('--ctrl-overlap', overlap + 'px');
    if (vp) vp.style.setProperty('--k', k);
  }

  function initAudio(src) {
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('loadedmetadata', () => {
      el.playbackRate = playbackRate;
      const target = targetSeekTime != null ? targetSeekTime : (now > 0.05 ? now : null);
      if (target != null) {
        try { el.currentTime = target; lastSeekTarget = target; lastSeekAt = performance.now(); targetSeekTime = null; } catch {}
      }
      if (playing && el.paused) safePlayAudio();
    });
    el.addEventListener('seeked', () => { if (playing && el.paused) safePlayAudio(); });
    el.addEventListener('canplay', () => { if (playing && el.paused && !el.seeking) safePlayAudio(); });
    el.addEventListener('ended', () => { if (playing && targetSeekTime == null) finishPlayback(); });
    el.addEventListener('error', () => {
      if (audio === el) { audio = null; if (!RECORD && ui.mute) ui.mute.classList.remove('on'); }
      audioBlocked = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && playing && !el.paused && !el.seeking && targetSeekTime == null && el.readyState >= 2) render(el.currentTime);
    });
    el.src = src;
    el.load();
    return el;
  }

  function seekVideoElementAsync(vid, targetSec) {
    return new Promise(resolve => {
      if (vid.readyState === 0) {
        const onMeta = () => { vid.removeEventListener('loadedmetadata', onMeta); seekVideoElementAsync(vid, targetSec).then(resolve); };
        vid.addEventListener('loadedmetadata', onMeta, { once: true });
        vid.addEventListener('error', () => resolve(), { once: true });
        return;
      }
      if (Math.abs((vid.currentTime || 0) - targetSec) < 0.008 && !vid.seeking) { resolve(); return; }
      const timer = setTimeout(resolve, 1500);
      vid.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
      try { vid.currentTime = targetSec; } catch { clearTimeout(timer); resolve(); }
    });
  }

  async function waitStageAssets() {
    if (!stage) return;
    const tasks = [];
    for (const img of stage.querySelectorAll('img')) {
      if (!(img._decoded && img.complete) && typeof img.decode === 'function') {
        tasks.push(img.decode().then(() => { img._decoded = true; }).catch(() => {}));
      }
    }
    for (const clip of V._videoClips) {
      if (clip.isConnected && clip._vclip) tasks.push(seekVideoElementAsync(clip, clip._vclip.targetTime));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  function resolveInitialTime() {
    if (params.has('t')) return parseFloat(params.get('t')) || 0;
    if (params.has('scene')) {
      const sIdx = clamp(+params.get('scene') || 0, 0, Math.max(0, V.scenes.length - 1));
      return V.scenes[sIdx] ? V.scenes[sIdx].start + 0.01 : 0;
    }
    try {
      const hmrT = sessionStorage.getItem('__video_hmr_t');
      if (hmrT != null) { sessionStorage.removeItem('__video_hmr_t'); return parseFloat(hmrT) || 0; }
    } catch {}
    return 0;
  }

  function resolveAudioSource(cfg) {
    if (cfg.audioSrc === false || RECORD) return null;
    return (V.voice && V.voice.src) || cfg.audioSrc || null;
  }

  function exposeBridge(cfg) {
    window.__video = {
      duration: V.duration,
      width: V.stageWidth,
      height: V.stageHeight,
      fps: cfg.fps || 30,
      seek: t => (RECORD ? render(t, 0) : seek(t)),
      seekVisual: t => render(t, 0),
      seekAsync: V.seekToAsync,
      setRate,
      play,
      pause,
      replay,
      tryEgg,
      enterSandbox,
      exitSandbox,
      resume: V.resume,
      getSyncState: () => ({
        now,
        clock: V._clock || now,
        ended,
        sandbox: sandboxState.active,
        playing,
        playbackRate,
        audioTime: audio ? audio.currentTime : null,
        drift: audio && !audio.paused && targetSeekTime == null ? Math.abs(audio.currentTime - now) : 0,
        seeking: audio ? audio.seeking : false,
        targetSeekTime,
        readyState: audio ? audio.readyState : 0,
        audioPaused: audio ? audio.paused : true,
      }),
      scenes: V.scenes.map(s => ({ title: s.title, start: s.start, duration: s.duration, cues: s.cues })),
    };
  }

  V.start = function () {
    V.mountStage();
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    if (cfg.title) document.title = cfg.title;
    stage = document.getElementById('stage');
    subs = document.getElementById('subs');
    subLead = subs.querySelector('.sub-lead');
    subTail = subs.querySelector('.sub-tail');
    subSpeaker = subs.querySelector('.sub-speaker');
    subText = subs.querySelector('.sub-text');
    mountSubSlots();
    V.layout();
    mountHudTicks(uiCfg);
    V._layersRuntime.mountLayers(stage, subs);

    const audioSrc = resolveAudioSource(cfg);
    if (audioSrc) audio = initAudio(audioSrc);

    V.seekTo = t => render(t, 0);
    V.seekToAsync = async t => { render(t, 0); await waitStageAssets(); };
    V.enterSandbox = enterSandbox;
    V.exitSandbox = exitSandbox;
    V.tryEgg = tryEgg;
    V.replay = replay;
    V._playerCtl = { play, pause, replay, seek, setRate, enterSandbox, exitSandbox, tryEgg, getRate: () => playbackRate, toggleLoopScene: () => (loopScene = !loopScene), isDev: DEV, isRecord: RECORD };

    if (RECORD) document.body.classList.add('record');
    else buildUI(uiCfg);
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', fit);
    pauseBaseTs = performance.now();
    const t0 = resolveInitialTime();
    if (t0 > 0) seek(t0);
    else render(0, 0);
    requestAnimationFrame(frame);
    if (params.has('autoplay')) play();
    exposeBridge(cfg);
  };

  function loadOptionalScript(src) {
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => { s.remove(); resolve(false); };
      document.head.appendChild(s);
    });
  }

  async function ensureDynamicBootAssets() {
    const cfg = V.getCfg();
    if (V.scenes.length === 0 && Array.isArray(cfg.sceneScripts)) {
      for (const rel of cfg.sceneScripts) await loadOptionalScript(rel);
    }
    const lang = V.getActiveLang();
    if (!lang) return;
    if (!V.locales[lang]) await loadOptionalScript(`locales/${lang}.js`);
    const baseTimings = cfg.timingsScript || 'assets/voice/timings.js';
    const langTimings = baseTimings.replace(/\.js$/i, `.${lang}.js`);
    if (langTimings !== baseTimings) await loadOptionalScript(langTimings);
  }

  V.boot = async function () {
    await ensureDynamicBootAssets();
    V.mountStage();
    const glEl = document.getElementById('gl');
    if (V.gl && glEl) {
      glEl.classList.remove('is-off');
      await V.gl.init(glEl, V.getCfg());
      if (V.gl.ready === undefined) V.gl.ready = true;
    }
    V.start();
  };
})(globalThis.V = globalThis.V || {});
