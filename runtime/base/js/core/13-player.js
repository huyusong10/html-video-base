/* core/13-player.js · 舞台挂载、紧凑全图标控制栏、PotPlayer 热区速隐、实时进度浮窗、OSD 轻提示与 V.boot 启动器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, h, toggle, syncVideoClip } = V.u;
  const getUiCfg = V._getUiCfg;
  const makeCtrlIcon = V._makeCtrlIcon;
  const swapBtnIcon = V._swapBtnIcon;
  const fmtTime = V._fmtTime;
  const fmtRate = V._fmtRate;

  const params = new URLSearchParams(location.search);
  const RECORD = params.has('record') || params.has('capture');
  const DEV = params.has('dev') && !RECORD;
  V._isRecord = RECORD;

  let stage = null, current = null, now = 0, prevRenderNow = 0, playing = false;
  let lastTs = 0, lastFrameTs = 0, ambientOffset = 0, idleSec = 0, audioStallSec = 0, ended = false, scrubbing = false;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false;
  let lastSeekTarget = -1, lastSeekAt = 0, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null, idleTimer = 0, osdTimer = 0;
  let inBar = false, lastPtrX = -9999, lastPtrY = -9999;
  const ptr = (V.pointer = V.pointer || {
    x: 960, y: 540, rawX: 960, rawY: 540, nx: 0, ny: 0, sx: 0, sy: 0, presence: 0, active: false, inside: false, down: false, overUI: false,
  });
  let wipeState = { name: '', handler: null, dom: null };
  const sandboxState = { active: false, entering: false, autoExitOnLast: true, returnTime: null, el: null, txtEl: null, backEl: null };
  const ui = {};
  const cssImageDecodes = new Map();
  let audioRt = null;
  let pptRt = null;
  let localeSwitch = Promise.resolve();
  let localeLoading = false;

  function navigateModeSwitch(toPpt, sceneIdx) {
    try {
      const u = new URL(location.href);
      ['t', 'page', 'autoplay', '_hmr'].forEach(k => u.searchParams.delete(k));
      if (toPpt) u.searchParams.set('ppt', '1');
      else u.searchParams.delete('ppt');
      if (sceneIdx > 0) u.searchParams.set('scene', String(sceneIdx));
      else u.searchParams.delete('scene');
      if (V.__langOverridden && V.getActiveLang) {
        const lang = V.getActiveLang();
        if (lang && (!V.isSecondaryLocale || V.isSecondaryLocale(lang))) u.searchParams.set('lang', lang);
      }
      location.href = u.toString();
    } catch {}
  }

  function ensurePptRuntime() {
    if (pptRt || !V._createPptRuntime) return pptRt;
    pptRt = V._createPptRuntime({
      params,
      renderAt: t => { ambientOffset = 0; render(t, 0); },
      uiText,
      makeCtrlIcon,
      swapBtnIcon,
      switchMode: navigateModeSwitch,
      renderCustomControls,
      setOpenMenu,
      toggleOsFull,
      fallbackWebFull,
      exitWebFullIfActive: () => {
        if (!isOsFull() && webFull) { setWebFull(false); return true; }
        return false;
      },
      bindMenuAutoClose,
    });
    V._pptRuntime = pptRt;
    return pptRt;
  }

  function buildCustomControlBtn(c, pos, uiCfg) {
    if (typeof c.render === 'function') return c.render(h, V);
    const title = c.title || c.label || c.id || '';
    if (c.icon) {
      const cls = pos === 'right' ? 'ctrl-rbtn ctrl-icon-btn' : 'ctrl-icon-btn';
      return h('button', { class: cls, 'data-custom-ctrl': c.id || '', title, 'aria-label': title }, makeCtrlIcon(uiCfg.icons[c.icon] || c.icon));
    }
    return h('button', { 'data-custom-ctrl': c.id || '', title }, c.label || c.id || '');
  }

  function renderCustomControls(pos, uiCfg) {
    return V.controls.filter(c => (c.position || 'right') === pos).map(c => {
      const btn = buildCustomControlBtn(c, pos, uiCfg);
      if (typeof c.onClick === 'function') btn.addEventListener('click', e => c.onClick(e, V));
      c._el = btn;
      return btn;
    });
  }

  function uiText(key, vars) {
    return V.uiStr ? V.uiStr(key, vars) : key;
  }

  function buildControlsBar(cfg, uiCfg) {
    const homeTitle = cfg.homeLabel || uiText('home');
    const homeLink = !cfg.homeUrl
      ? null
      : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl, title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
    const rateLabel = uiText('rate', { rate: '1.0x' });
    const rateWrap = uiCfg.rate
      ? h('div', { class: 'rate-wrap' },
          h('button', { class: 'ctrl-rbtn ctrl-icon-btn rate-trigger', 'data-act': 'rate', title: rateLabel, 'aria-label': rateLabel }, makeCtrlIcon(uiCfg.icons.rate)),
          h('div', { class: 'rate-menu' }))
      : null;
    const webLabel = uiText('webEnter');
    const pptBtn = cfg.ppt
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'to-ppt', title: uiText('switchToPpt'), 'aria-label': uiText('switchToPpt') }, makeCtrlIcon(uiCfg.icons.pptMode))
      : null;
    const webFullBtn = uiCfg.webFull
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: webLabel, 'aria-label': webLabel }, makeCtrlIcon(uiCfg.icons.webEnter))
      : null;
    const playLabel = uiText('play');
    const subsLabel = uiText('subsHide');
    const fullLabel = uiText('fullEnter');
    return h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { class: 'ctrl-icon-btn', 'data-act': 'play', 'data-state': 'paused', 'aria-pressed': 'false', title: playLabel, 'aria-label': playLabel }, makeCtrlIcon(uiCfg.icons.play)),
      ...renderCustomControls('left', uiCfg),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' }), h('div', { class: 'track-tip' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: uiText('chapTrigger') }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, makeCtrlIcon(uiCfg.icons.chapCaret))),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, uiText('chapHeader')), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right', uiCfg),
      rateWrap,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'subs', title: subsLabel, 'aria-label': subsLabel }, makeCtrlIcon(uiCfg.icons.subsOn)),
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'mute', title: uiText('soundOnTip', { pct: 100 }), 'aria-label': uiText('soundLabel') }, makeCtrlIcon(uiCfg.icons.volumeOn)),
      h('div', { class: 'sound-menu' }),
      pptBtn,
      webFullBtn,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: fullLabel, 'aria-label': fullLabel }, makeCtrlIcon(uiCfg.icons.fullEnter)));
  }

  V.mountStage = function () {
    const cfg = V.getCfg();
    if (!cfg.ppt) V.pptMode = false;
    const uiCfg = getUiCfg(cfg);
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (!ptr.inside) { ptr.x = W / 2; ptr.y = H / 2; }
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    document.body.classList.toggle('ctrl-overlay', uiCfg.controlsMode === 'overlay');
    document.body.classList.toggle('ppt-mode', Boolean(V.pptMode));
    if (document.getElementById('stage')) return;

    const sbTxt = h('span', { class: 'v-sandbox-txt egg-ban-txt' }, uiText('sandboxActive'));
    const sbBack = h('button', { class: 'v-sandbox-back egg-back-btn', 'data-interactive': '1', type: 'button' }, uiText('sandboxBack'));
    const sbBar = h('div', { class: 'v-sandbox-bar egg-banner', 'data-interactive': '1' }, sbTxt, sbBack);
    const osdEl = h('div', { id: 'osd', 'aria-live': 'polite' });
    sandboxState.el = sbBar;
    sandboxState.txtEl = sbTxt;
    sandboxState.backEl = sbBack;
    ui.osd = osdEl;

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
      osdEl,
      h('div', { id: 'start-hint' }, cfg.startHint || uiText('startHint')));

    const bar = V.pptMode ? ensurePptRuntime().buildControlsBar(cfg, uiCfg) : buildControlsBar(cfg, uiCfg);
    document.body.prepend(vp, bar);
  };

  function sceneAt(t) {
    for (const sc of V.scenes) if (t < sc.start + sc.duration) return sc;
    return V.scenes[V.scenes.length - 1];
  }

  function enter(sc) {
    if (current && current.root) current.root.remove();
    V._videoClips.clear();
    if (V._subtitlesRuntime && V._subtitlesRuntime.resetSceneSubLayout) {
      V._subtitlesRuntime.resetSceneSubLayout();
    }
    const si = V.scenes.indexOf(sc);
    V._currentSceneIdx = si;
    sc.root = h('div', { class: 'scene ' + (sc.cls || '') });
    sc.ctx = V.makeCtx(sc, si);
    stage.appendChild(sc.root);
    V._inSceneBuild = true;
    V._inSceneUpdate = true;
    try {
      sc.build(sc.root, sc.ctx);
      if (V.localizeDom) V.localizeDom(sc.root, si);
    } finally {
      V._inSceneBuild = false;
      V._inSceneUpdate = false;
    }
    current = sc;
    if (audioRt && audioRt.syncSceneVolume) audioRt.syncSceneVolume();
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

  function resolveCutDur(cutSc, cfg, handler) {
    if (cutSc && cutSc.transitionDur !== undefined) return cutSc.transitionDur;
    return cfg.transitionDur === undefined ? (handler.dur || 0.28) : cfg.transitionDur;
  }

  function runTransition() {
    if (current && current.root) {
      current.root.style.transform = '';
      current.root.style.opacity = '';
    }
    if (V.pptMode) return;
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
    handler.update(wipeState.dom, near, resolveCutDur(cutSc, cfg, handler), current, cfg);
  }

  function updateHud() {
    const el = document.getElementById('hud');
    if (!el || el.classList.contains('is-off') || !(V.duration > 0)) return;
    const steps = Math.max(400, (V.stageWidth || 1920) * 2);
    const q = Math.round(clamp(now / V.duration) * steps) / steps;
    el.querySelector('.hud-bar').style.width = (q * 100).toFixed(4) + '%';
  }

  function syncSceneVideoClips(lt) {
    const tick = V._renderTick || 0;
    for (const clip of V._videoClips) {
      if (!clip.isConnected) continue;
      if (clip._vclip && clip._vclip._syncedTick === tick) continue;
      syncVideoClip(clip, lt, playing && !scrubbing && !localeLoading);
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
    if (opts.sfx !== false && V.sfx) V.sfx(opts.sfx || 'pop', 0.45);
    const prefix = opts.prefix === undefined ? uiText('sandboxPrefix') : opts.prefix;
    const label = opts.hint ? prefix + opts.hint : uiText('sandboxActive');
    const last = V.scenes[V.scenes.length - 1];
    sandboxState.autoExitOnLast = !last || target < last.start;
    sandboxState.returnTime = Number.isFinite(opts.returnTime) ? opts.returnTime : resolveDefaultSandboxReturn();
    sandboxState.entering = true;
    setSandboxActiveDom(true, label, opts.backLabel || uiText('sandboxBack'));
    seek(target);
    pause();
    sandboxState.entering = false;
  }

  function tryEgg(targetTime, hint, opts) {
    enterSandbox(Object.assign({}, opts || {}, { targetTime, hint }));
  }

  function replay() {
    ambientOffset = 0;
    idleSec = 0;
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

  function shouldContinueSceneAtEnd(sc, idle) {
    if (!ended || idle <= 0 || !sc.live || sc.freezeTimelineAtEnd) return false;
    return sc === V.scenes[V.scenes.length - 1];
  }

  function syncSceneCtxAndEndState(sc, idle) {
    ended = !playing && now >= V.duration - 0.01;
    document.body.classList.toggle('is-ended', ended);
    if (sandboxState.active && !sandboxState.entering && sandboxState.autoExitOnLast && sc === V.scenes[V.scenes.length - 1]) {
      setSandboxActiveDom(false);
    }
    if (sc !== current) enter(sc);
    sc.ctx.clock = V._clock;
    sc.ctx.alive = V._clock;
    sc.ctx.sceneClock = V._clock - sc.start;
    sc.ctx.idle = idle;
    sc.ctx.playing = playing && !scrubbing && !localeLoading;
    sc.ctx.ended = ended;
    sc.ctx.pointer = ptr;
    sc.ctx.frame = V.getFrameState();
  }

  function runSceneUpdate(sc, lt, idle) {
    V._renderTick = (V._renderTick || 0) + 1;
    V._isPlaying = playing && !scrubbing && !localeLoading;
    V._inSceneUpdate = true;
    try {
      sc.update(shouldContinueSceneAtEnd(sc, idle) ? lt + idle : lt, sc.ctx);
    } finally {
      V._inSceneUpdate = false;
    }
  }

  function publishFrame(sc, clock, idle, precise) {
    ended = !playing && now >= V.duration - 0.01;
    V._frameRuntime.begin(sc, V.scenes.indexOf(sc), now, clock, idle, {
      playing: playing && !scrubbing && !localeLoading, ended, isRecord: RECORD, precise,
    });
  }

  function syncPlaybackFrame() {
    const previous = V.getFrameState();
    const active = playing && !scrubbing && !localeLoading;
    if (!current || !previous || (previous.playing === active && previous.ended === ended)) return;
    publishFrame(current, previous.clock, idleSec, true);
    syncSceneCtxAndEndState(current, idleSec);
    V._isPlaying = active;
    if (!RECORD) V._frameRuntime.preview(V.getFrameState());
  }

  function completeFrameUI() {
    if (RECORD) return;
    updateUI();
    V._frameRuntime.preview(V.getFrameState());
  }

  function render(t, nextIdle, precise = true) {
    if (!V.scenes.length || !Number.isFinite(t)) return;
    const idle = RECORD ? 0 : (nextIdle === undefined ? idleSec : nextIdle);
    idleSec = idle;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    const clock = RECORD ? now : now + ambientOffset;
    prevRenderNow = now;
    V._now = now;
    V._clock = clock;
    if (RECORD || V.pptMode) V._checkpointsRuntime.syncRecordCheckpoints(now);
    const sc = sceneAt(now);
    publishFrame(sc, clock, idle, precise);
    syncSceneCtxAndEndState(sc, idle);
    const lt = now - sc.start;
    const idx = V.scenes.indexOf(sc);

    runTransition();
    if (V.gl && V.gl.ready) V.gl.render(now, clock);
    updateHud();
    stage.style.setProperty('--tg', ((clock % 6) / 6) * 150);
    stage.style.setProperty('--anim-t', (-clock).toFixed(3) + 's');
    document.body.classList.toggle('started', now > 0.05);
    runSceneUpdate(sc, lt, idle);
    syncSceneVideoClips(lt);
    activeCueIdx = V._subtitlesRuntime.updateSubs(sc, idx, lt, now, clock, showSubs);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    if (!RECORD && !V.pptMode) V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: false, playing, scrubbing, pause, play });
    const aState = audioRt ? audioRt.getState(now) : { hasAudio: false, muted: false, voiceOn: true, volume: 1 };
    V.emit('onRender', {
      frame: V.getFrameState(),
      now, clock, alive: clock, idle, ended, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx,
      playing, scrubbing, sandbox: sandboxState.active, pointer: ptr,
      hasAudio: aState.hasAudio, isRecord: RECORD, muted: aState.muted, voiceOn: aState.voiceOn !== false, volume: aState.volume,
    });
    completeFrameUI();
  }

  function showUiHold() {
    inBar = true;
    clearTimeout(idleTimer);
    document.body.classList.add('ui-active');
  }

  function scheduleUiHide(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!inBar) document.body.classList.remove('ui-active');
    }, ms);
  }

  function flashUi(ms = 1500) {
    document.body.classList.add('ui-active');
    if (!inBar) scheduleUiHide(ms);
  }

  function releaseBarHold() {
    inBar = false;
    scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
  }

  function flashOsd(text, ms = 680) {
    const uiCfg = getUiCfg(V.getCfg());
    if (RECORD || !uiCfg.osd || !ui.osd || !text) return;
    ui.osd.textContent = text;
    ui.osd.classList.add('is-show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => { if (ui.osd) ui.osd.classList.remove('is-show'); }, ms);
  }
  V.flashOsd = flashOsd;

  function syncVolumeSliderUI(st) {
    const pct = st.muted ? 0 : Math.round(st.volume * 100);
    if (ui.volRange) {
      ui.volRange.value = String(pct);
      ui.volRange.style.setProperty('--vol-pct', pct + '%');
    }
    if (ui.volVal) ui.volVal.textContent = pct + '%';
  }

  function syncSoundLabelsUI(st) {
    if (ui.volRange) ui.volRange.setAttribute('aria-label', uiText('volAria'));
    if (ui.soundVoiceTxt) ui.soundVoiceTxt.textContent = uiText('voiceItem');
    if (ui.soundBgmTxt) ui.soundBgmTxt.textContent = uiText('bgmItem');
    if (ui.soundMuteTxt) ui.soundMuteTxt.textContent = st.hasBgm ? uiText('muteAllItem') : uiText('muteItem');
    if (!ui.langItems) return;
    const active = ((V.getActiveLang && V.getActiveLang()) || (V.getBaseLang && V.getBaseLang()) || '').toLowerCase();
    ui.langItems.forEach(({ el, code }) => toggle(el, 'on', code.toLowerCase() === active));
  }

  function syncSoundMenuUI() {
    if (!audioRt) return;
    const st = audioRt.getState(now);
    if (ui.mute) {
      const icons = getUiCfg(V.getCfg()).icons;
      const [key, label] = audioRt.resolveSoundBtnSpec();
      ui.mute.classList.toggle('is-off', st.muted);
      ui.mute.classList.toggle('is-blocked', Boolean(st.audioBlocked && !st.muted));
      ui.mute.dataset.soundMode = key;
      swapBtnIcon(ui.mute, key, icons[key], label);
    }
    syncVolumeSliderUI(st);
    syncSoundLabelsUI(st);
    if (ui.soundVoice) { ui.soundVoice.hidden = !st.hasBgm; toggle(ui.soundVoice, 'on', st.voiceOn); }
    if (ui.soundBgm) { ui.soundBgm.hidden = !st.hasBgm; toggle(ui.soundBgm, 'on', st.bgmOn); }
    if (ui.soundSepBgm) ui.soundSepBgm.hidden = !st.hasBgm;
    if (ui.soundAllMute) toggle(ui.soundAllMute, 'on', st.muted);
  }

  function stepVolumeBy(delta, showOsd = true) {
    if (!audioRt) return;
    const cur = audioRt.getState(now);
    const base = cur.muted && cur.volume <= 0.001 ? 0 : cur.volume;
    const next = Math.round(clamp(base + delta, 0, 1) * 100) / 100;
    audioRt.setVolume(next);
    if (!showOsd) return;
    const pct = Math.round(next * 100);
    flashOsd(pct <= 0 ? uiText('osdMutedZero') : uiText('osdVol', { pct }));
  }

  function bindVolumeWheel(el) {
    if (!el || el._wheelBound) return;
    el._wheelBound = true;
    el.addEventListener('wheel', e => {
      if (!e.deltaY) return;
      e.preventDefault();
      e.stopPropagation();
      stepVolumeBy(e.deltaY < 0 ? 0.05 : -0.05, true);
    }, { passive: false });
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

  function dampAxis(cur, target, k) {
    const next = cur + (target - cur) * k;
    return Math.abs(target - next) < 0.0005 ? target : next;
  }

  function syncStagePointerVars() {
    if (RECORD || !stage) return;
    const sig = `${ptr.sx.toFixed(4)}|${ptr.sy.toFixed(4)}|${ptr.presence.toFixed(4)}|${Math.round(ptr.x)}|${Math.round(ptr.y)}|${ptr.inside ? 1 : 0}`;
    if (stage._ptrSig === sig) return;
    stage._ptrSig = sig;
    stage.style.setProperty('--ptr-x', ptr.sx.toFixed(4));
    stage.style.setProperty('--ptr-y', ptr.sy.toFixed(4));
    stage.style.setProperty('--ptr-px', Math.round(ptr.x) + 'px');
    stage.style.setProperty('--ptr-py', Math.round(ptr.y) + 'px');
    stage.style.setProperty('--ptr-inside', ptr.inside ? '1' : '0');
    stage.style.setProperty('--ptr-presence', ptr.presence.toFixed(4));
  }

  function stepPointerSmoothing(dt) {
    if (RECORD || !stage) return;
    const k = dt > 0 ? 1 - Math.exp(-dt * 12) : 0.25;
    ptr.sx = dampAxis(ptr.sx, ptr.inside ? ptr.nx : 0, k);
    ptr.sy = dampAxis(ptr.sy, ptr.inside ? ptr.ny : 0, k);
    ptr.presence = dampAxis(ptr.presence, ptr.inside ? 1 : 0, k);
    syncStagePointerVars();
  }

  function isDocHidden() {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  function shouldTickAmbientPause(sc) {
    if (RECORD || isDocHidden() || !sc) return false;
    if (sc.live) return true;
    const uiCfg = getUiCfg(V.getCfg());
    return uiCfg.livePause !== false && sc.livePause !== false;
  }

  function advanceAudioClock(ts, rawDt) {
    const mTime = audioRt.tickMasterClock();
    if (mTime != null) {
      lastTs = ts;
      if (audioStallSec > 0.35 && Math.abs(mTime - now) > 0.35) {
        audioStallSec = 0;
        audioRt.seekTracks(now);
        return;
      }
      audioStallSec = 0;
      if (checkSceneLoop(mTime)) return;
      if (mTime >= V.duration - 0.01) finishPlayback();
      else render(mTime, 0, false);
      return;
    }
    audioStallSec += rawDt;
    if (audioStallSec > 0.35) {
      advanceWallClock(ts);
      return;
    }
    lastTs = ts;
    if (shouldTickAmbientPause(current)) {
      ambientOffset += rawDt;
      render(now, 0, false);
    }
  }

  function advanceWallClock(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (audioRt) audioRt.syncWithWallClock(now);
    if (now + dt >= V.duration - 0.002) finishPlayback();
    else render(now + dt, 0, false);
  }

  function stepAmbientIdle(rawDt) {
    if (!shouldTickAmbientPause(current)) return;
    ambientOffset += rawDt;
    idleSec += rawDt;
    render(now, idleSec, false);
  }

  function frame(ts) {
    const rawDt = lastFrameTs > 0 ? clamp((ts - lastFrameTs) / 1000, 0, 0.1) : 0;
    lastFrameTs = ts;
    if (V._frameRuntime.isHeld()) { lastTs = ts; requestAnimationFrame(frame); return; }
    stepPointerSmoothing(rawDt);
    if (localeLoading) {
      lastTs = ts;
    } else if (V.pptMode && pptRt) {
      stepAmbientIdle(rawDt);
    } else if (scrubbing) {
      lastTs = ts;
      if (current && current.live) render(now, 0, false);
    } else if (playing) {
      if (audioRt && audioRt.canUseMasterClock()) advanceAudioClock(ts, rawDt);
      else advanceWallClock(ts);
    } else {
      stepAmbientIdle(rawDt);
    }
    requestAnimationFrame(frame);
  }

  function positionSoundMenu(bar) {
    if (!ui.soundMenu || !ui.mute || !bar) return;
    const barRect = bar.getBoundingClientRect();
    const btnRect = ui.mute.getBoundingClientRect();
    if (!barRect.width || !btnRect.width) return;
    const menuW = ui.soundMenu.offsetWidth || 176;
    const center = btnRect.left - barRect.left + btnRect.width / 2;
    const left = clamp(center - menuW / 2, 8, Math.max(8, barRect.width - menuW - 8));
    ui.soundMenu.style.left = Math.round(left) + 'px';
  }

  function blurMenuInput(bar) {
    const ae = document.activeElement;
    if (ae && bar.contains(ae) && ae.tagName === 'INPUT') ae.blur();
  }

  function setOpenMenu(bar, which) {
    if (!bar) return;
    const prev = bar.dataset.menu || '';
    const mode = which || '';
    if (mode === 'sound') positionSoundMenu(bar);
    bar.dataset.menu = mode;
    bar.classList.toggle('menu-open', Boolean(mode));
    bar.classList.toggle('chap-open', mode === 'chap');
    bar.classList.toggle('rate-open', mode === 'rate');
    bar.classList.toggle('sound-open', mode === 'sound');
    document.body.classList.toggle('menu-open', Boolean(mode));
    if (prev && !mode) {
      blurMenuInput(bar);
      if (!inBar) scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
    }
  }

  function play() {
    if (now >= V.duration - 0.01) {
      ambientOffset = 0;
      idleSec = 0;
      V.resetCheckpoints();
      seek(0);
    }
    setSandboxActiveDom(false);
    ended = false;
    idleSec = 0;
    document.body.classList.remove('is-ended');
    V._checkpointsRuntime.closeCheckpointOverlay();
    setOpenMenu(document.getElementById('controls'), '');
    playing = true;
    audioStallSec = 0;
    lastTs = performance.now();
    if (audioRt) audioRt.startPlayback();
    document.body.classList.add('playing');
    syncPlaybackFrame();
    V.emit('onPlay', { now, playing: true });
    if (!RECORD) {
      if (!inBar) scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
      updateUI();
    }
  }

  function pause() {
    playing = false;
    idleSec = 0;
    ended = now >= V.duration - 0.01;
    document.body.classList.remove('playing');
    document.body.classList.toggle('is-ended', ended);
    if (audioRt) audioRt.pausePlayback();
    for (const clip of V._videoClips) if (clip.pause) clip.pause();
    syncPlaybackFrame();
    V.emit('onPause', { now, ended, playing: false });
    if (!RECORD) updateUI();
  }

  function syncRateMenuSelection() {
    if (!ui.rateItems) return;
    ui.rateItems.forEach(({ el, rate }) => toggle(el, 'on', Math.abs(rate - playbackRate) < 0.01));
  }

  function syncRateBtnUI() {
    if (!ui.rate) return;
    const isNormal = Math.abs(playbackRate - 1) < 0.01;
    const txt = fmtRate(playbackRate);
    const label = uiText('rate', { rate: txt });
    ui.rate.classList.toggle('on', !isNormal);
    ui.rate.classList.toggle('ctrl-icon-btn', isNormal);
    if (isNormal) {
      swapBtnIcon(ui.rate, 'rate', getUiCfg(V.getCfg()).icons.rate, label);
      return;
    }
    ui.rate.title = label;
    ui.rate.setAttribute('aria-label', label);
    if (ui.rate._icoKey !== txt) {
      ui.rate._icoKey = txt;
      ui.rate.textContent = txt;
    }
  }

  function setRate(rate) {
    playbackRate = clamp(Number(rate) || 1, 0.25, 4);
    V._playbackRate = playbackRate;
    if (audioRt) audioRt.setRate(playbackRate);
    syncRateBtnUI();
    syncRateMenuSelection();
    V.emit('onRateChange', playbackRate);
  }

  function setSubs(nextOn) {
    showSubs = Boolean(nextOn);
    document.body.classList.toggle('nosubs', !showSubs);
    syncSubsBtnUI();
    render(now);
    V.emit('onSubsChange', showSubs);
  }

  function isRedundantSeek(target, ts) {
    return Math.abs(target - lastSeekTarget) < 0.015 && Math.abs(target - now) < 0.015 && ts - lastSeekAt < 250;
  }

  function seek(t, force = false) {
    if (!Number.isFinite(t)) return;
    if (V.pptMode && pptRt && !pptRt.isInternalRender()) {
      pptRt.seekToNearestPage(t);
      return;
    }
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (!force && isRedundantSeek(target, ts)) return;
    lastTs = ts;
    idleSec = 0;
    lastSeekTarget = target;
    lastSeekAt = ts;
    if (V._checkpointsRuntime && V._checkpointsRuntime.onSeek) V._checkpointsRuntime.onSeek(target);
    V.emit('onBeforeSeek', target);
    render(target, 0);
    V.emit('onSeek', target);
    if (audioRt) audioRt.seekTracks(now);
  }

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
    const tip = track.querySelector('.track-tip');
    track.addEventListener('pointermove', e => {
      if (!tip || V.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width));
      const t = ratio * V.duration;
      const sc = sceneAt(t);
      const idx = V.scenes.indexOf(sc);
      tip.textContent = sc ? `${String(idx + 1).padStart(2, '0')} · ${sc.title} · ${fmtTime(t)}` : fmtTime(t);
      const half = (tip.offsetWidth || 96) / 2;
      const x = clamp(ratio * rect.width, half, Math.max(half, rect.width - half));
      tip.style.left = `${Math.round(x)}px`;
      tip.classList.add('is-show');
    });
    const hideTip = () => { if (tip) tip.classList.remove('is-show'); };
    track.addEventListener('pointerleave', hideTip);
    track.addEventListener('pointercancel', hideTip);
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

  function appendSoundLangItems(menu, bar) {
    const locales = V.getAvailableLocales ? V.getAvailableLocales() : [];
    ui.langItems = [];
    if (locales.length <= 1) return;
    menu.appendChild(h('div', { class: 'sound-sep sound-lang-sep' }));
    ui.langItems = locales.map(entry => {
      const el = h('div', { class: 'sound-item sound-lang-item', 'data-lang': entry.code }, h('span', null, entry.label), h('i', null, '✓'));
      el.onclick = e => {
        e.stopPropagation();
        setOpenMenu(bar, '');
        setLang(entry.code);
      };
      menu.appendChild(el);
      return { el, code: entry.code };
    });
  }

  function buildSoundMenu(bar) {
    const menu = bar.querySelector('.sound-menu');
    ui.soundMenu = menu;
    if (!menu) return;
    menu.innerHTML = '';
    ui.volRange = h('input', { class: 'sound-vol-range', type: 'range', min: '0', max: '100', step: '1', value: '100', 'aria-label': uiText('volAria') });
    ui.volVal = h('span', { class: 'sound-vol-val' }, '100%');
    const volRow = h('div', { class: 'sound-vol-row' }, ui.volRange, ui.volVal);
    volRow.onclick = e => e.stopPropagation();
    ui.volRange.oninput = () => audioRt.setVolume(Number(ui.volRange.value) / 100);
    ui.soundVoiceTxt = h('span', null, uiText('voiceItem'));
    ui.soundBgmTxt = h('span', null, uiText('bgmItem'));
    ui.soundVoice = h('div', { class: 'sound-item', 'data-sound': 'voice' }, ui.soundVoiceTxt, h('i', null, '✓'));
    ui.soundBgm = h('div', { class: 'sound-item', 'data-sound': 'bgm' }, ui.soundBgmTxt, h('i', null, '✓'));
    ui.soundSepBgm = h('div', { class: 'sound-sep' });
    ui.soundMuteTxt = h('span', null, uiText('muteAllItem'));
    ui.soundAllMute = h('div', { class: 'sound-item', 'data-sound': 'mute' }, ui.soundMuteTxt, h('i', null, '✓'));
    ui.soundVoice.onclick = e => { e.stopPropagation(); audioRt.toggleVoiceFromMenu(); };
    ui.soundBgm.onclick = e => { e.stopPropagation(); audioRt.toggleBgmFromMenu(); };
    ui.soundAllMute.onclick = e => { e.stopPropagation(); audioRt.setMuted(!audioRt.isAllMuted()); };
    menu.append(volRow, h('div', { class: 'sound-sep' }), ui.soundVoice, ui.soundBgm, ui.soundSepBgm, ui.soundAllMute);
    appendSoundLangItems(menu, bar);
    bindVolumeWheel(menu);
    syncSoundMenuUI();
  }

  function bindMenuAutoClose(bar) {
    const chapWrap = bar.querySelector('.chap-wrap');
    const rateWrap = bar.querySelector('.rate-wrap');
    addEventListener('pointerdown', e => {
      const inChap = chapWrap && chapWrap.contains(e.target);
      const inRate = rateWrap && rateWrap.contains(e.target);
      const inSound = (ui.mute && ui.mute.contains(e.target)) || (ui.soundMenu && ui.soundMenu.contains(e.target));
      if (!inChap && !inRate && !inSound) setOpenMenu(bar, '');
    });
  }

  function bindScrubber(el) {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      let dragged = false, uncommittedT = null, lastAudioSeekTs = performance.now();
      scrubbing = true;
      document.body.classList.add('scrubbing');
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      const toTime = cx => {
        const rect = el.getBoundingClientRect();
        return clamp((cx - rect.left) / Math.max(1, rect.width)) * V.duration;
      };
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
        if (uncommittedT != null) seek(uncommittedT, true);
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

  function setBtnIcon(btn, cacheKey, iconSpec, title, active) {
    if (!btn || !btn.classList.contains('ctrl-icon-btn')) return;
    btn.classList.toggle('on', active);
    swapBtnIcon(btn, cacheKey, iconSpec, title);
  }

  function syncFullUI() {
    const osOn = isOsFull();
    const icons = getUiCfg(V.getCfg()).icons;
    document.body.classList.toggle('os-full', osOn);
    document.body.classList.toggle('web-full', webFull);
    setBtnIcon(ui.webfull, webFull ? 'webExit' : 'webEnter', webFull ? icons.webExit : icons.webEnter, uiText(webFull ? 'webExit' : 'webEnter'), webFull);
    setBtnIcon(ui.full, osOn ? 'fullExit' : 'fullEnter', osOn ? icons.fullExit : icons.fullEnter, uiText(osOn ? 'fullExit' : 'fullEnter'), osOn);
    releaseBarHold();
    fit();
  }

  function setWebFull(on) {
    webFull = Boolean(on);
    syncParentFrameFull(webFull);
    syncFullUI();
    try { window.parent.postMessage({ type: 'video:webfull', active: webFull }, '*'); } catch {}
  }

  function fallbackWebFull(toggleMode) {
    if (ui.webfull) setWebFull(toggleMode ? !webFull : true);
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
    if (!current) return;
    const idx = V.scenes.indexOf(current);
    if (delta > 0 && idx < V.scenes.length - 1) seek(V.scenes[idx + 1].start + 0.01);
    if (delta < 0) seek(V.scenes[Math.max(0, now - current.start < 1.5 ? idx - 1 : idx)].start + 0.01);
    if (current) flashOsd(`${String(V.scenes.indexOf(current) + 1).padStart(2, '0')} · ${current.title}`);
  }

  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === 'INPUT' && target.type === 'range') return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '');
  }

  function isNativeSpaceTarget(target) {
    return Boolean(target && target.closest && target.closest('button, a'));
  }

  function handleEscapeKey(bar, e) {
    if (bar && bar.classList.contains('menu-open')) { setOpenMenu(bar, ''); e.preventDefault(); }
    else if (sandboxState.active) { exitSandbox(true); e.preventDefault(); }
    else if (!isOsFull() && webFull) { setWebFull(false); e.preventDefault(); }
  }

  function toggleMuteShortcut() {
    const next = !audioRt.isAllMuted();
    audioRt.setMuted(next);
    const pct = Math.round(audioRt.getState(now).volume * 100);
    flashOsd(next ? uiText('osdMuted') : uiText('osdVol', { pct }));
  }

  function toggleBgmShortcut() {
    if (!audioRt.hasBgm()) return;
    const next = !audioRt.getState(now).bgmOn;
    audioRt.setBgm(next);
    flashOsd(uiText(next ? 'osdBgmOn' : 'osdBgmOff'));
  }

  function seekDeltaShortcut(stepSec) {
    seek(now + stepSec);
    flashOsd(`${stepSec > 0 ? '+' : ''}${stepSec}s · ${fmtTime(now)}`);
  }

  function stepFrameShortcut(dir) {
    const fps = Math.max(1, Number(V.getCfg().fps) || 30);
    pause();
    seek(now + dir / fps, true);
  }

  function bindKeyboard(bar) {
    const keyMap = {
      '.': () => stepFrameShortcut(1),
      ',': () => stepFrameShortcut(-1),
      ']': () => jumpChapterDelta(1),
      PageDown: () => jumpChapterDelta(1),
      '[': () => jumpChapterDelta(-1),
      PageUp: () => jumpChapterDelta(-1),
      w: () => fallbackWebFull(true),
      W: () => fallbackWebFull(true),
      f: toggleOsFull,
      F: toggleOsFull,
      m: toggleMuteShortcut,
      M: toggleMuteShortcut,
      b: toggleBgmShortcut,
      B: toggleBgmShortcut,
      ArrowUp: e => { e.preventDefault(); stepVolumeBy(0.05, true); },
      ArrowDown: e => { e.preventDefault(); stepVolumeBy(-0.05, true); },
      ArrowRight: e => { if (e.target !== ui.volRange) seekDeltaShortcut(e.shiftKey ? 1 : 5); },
      ArrowLeft: e => { if (e.target !== ui.volRange) seekDeltaShortcut(e.shiftKey ? -1 : -5); },
    };
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { handleEscapeKey(bar, e); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.code === 'Space') {
        if (!isNativeSpaceTarget(e.target)) { e.preventDefault(); playing ? pause() : play(); }
        return;
      }
      if (keyMap[e.key]) keyMap[e.key](e);
    });
  }

  function resetPointerLeave() {
    ptr.inside = false;
    ptr.down = false;
    ptr.nx = 0;
    ptr.ny = 0;
  }

  function isEventOverBar(bar, target) {
    return Boolean(bar && target && bar.contains && bar.contains(target));
  }

  function hitRect(r, cx, cy) {
    if (r.width <= 0 || r.height <= 0) return false;
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  function isPointerOverBar(bar, e) {
    if (!bar) return false;
    if (isEventOverBar(bar, e.target)) return true;
    return Number.isFinite(e.clientX) && hitRect(bar.getBoundingClientRect(), e.clientX, e.clientY);
  }

  function applyStagePointerCoords(e) {
    if (RECORD || !stage || !Number.isFinite(e.clientX)) return;
    const r = stage.getBoundingClientRect();
    ptr.active = true;
    ptr.rawX = (e.clientX - r.left) / r.width * (V.stageWidth || 1920);
    ptr.rawY = (e.clientY - r.top) / r.height * (V.stageHeight || 1080);
    if (!hitRect(r, e.clientX, e.clientY)) {
      resetPointerLeave();
      return;
    }
    const rx = clamp((e.clientX - r.left) / r.width, 0, 1);
    const ry = clamp((e.clientY - r.top) / r.height, 0, 1);
    ptr.inside = true;
    ptr.x = rx * (V.stageWidth || 1920);
    ptr.y = ry * (V.stageHeight || 1080);
    ptr.nx = rx * 2 - 1;
    ptr.ny = ry * 2 - 1;
  }

  function updatePointerFromEvent(bar, e) {
    applyStagePointerCoords(e);
    ptr.overUI = Boolean(isPointerOverBar(bar, e) || e.target?.closest?.('[data-video-ui],#search-modal,#help-modal'));
    if (ptr.overUI) resetPointerLeave();
  }

  function wakeFromPointer(bar, uiCfg, e, force) {
    const overBar = isPointerOverBar(bar, e);
    updatePointerFromEvent(bar, e);
    if (!force && Math.abs(e.clientX - lastPtrX) < 1 && Math.abs(e.clientY - lastPtrY) < 1) return;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    if (overBar) showUiHold();
    else { inBar = false; flashUi(uiCfg.idleHideDelay); }
  }

  function isBarOverlayHidden(bar) {
    const b = document.body.classList;
    if (!(b.contains('ctrl-overlay') || b.contains('web-full') || b.contains('os-full'))) return false;
    if (!b.contains('playing') && !b.contains('ppt-mode')) return false;
    if (b.contains('ui-active') || b.contains('scrubbing') || b.contains('menu-open')) return false;
    return !(bar && bar.matches && bar.matches(':has(.chap-search:focus)'));
  }

  function bindBlindBarGuard(bar, uiCfg) {
    if (!bar) return;
    let blindPointerType = '';
    bar.addEventListener('pointerdown', e => {
      if (!isBarOverlayHidden(bar)) { blindPointerType = ''; return; }
      blindPointerType = e.pointerType || 'mouse';
      e.stopPropagation();
      e.preventDefault();
      flashUi(blindPointerType === 'touch' ? 2200 : uiCfg.idleHideDelay);
    }, true);
    bar.addEventListener('click', e => {
      if (!blindPointerType) return;
      const pt = blindPointerType;
      blindPointerType = '';
      e.stopPropagation();
      e.preventDefault();
      if (pt !== 'touch' && playing && !V.pptMode) pause();
    }, true);
  }

  function bindIdleWake(bar, uiCfg) {
    bindBlindBarGuard(bar, uiCfg);
    const clearOnLeave = () => {
      ptr.active = false;
      ptr.overUI = false;
      inBar = false;
      lastPtrX = -9999;
      lastPtrY = -9999;
      resetPointerLeave();
      scheduleUiHide(uiCfg.leaveHideDelay);
    };
    const clearDown = () => { ptr.down = false; };
    document.addEventListener('pointerenter', e => wakeFromPointer(bar, uiCfg, e, true));
    addEventListener('pointermove', e => wakeFromPointer(bar, uiCfg, e, false));
    if (bar) bar.addEventListener('pointerleave', () => { inBar = false; scheduleUiHide(uiCfg.idleHideDelay); });
    document.addEventListener('mouseleave', clearOnLeave);
    addEventListener('blur', clearOnLeave);
    addEventListener('pointerdown', e => {
      updatePointerFromEvent(bar, e);
      if (ptr.inside) ptr.down = true;
      if (e.pointerType === 'touch') flashUi(bar && bar.contains(e.target) ? 2200 : uiCfg.idleHideDelay);
    });
    addEventListener('pointerup', clearDown);
    addEventListener('pointercancel', clearDown);
    addEventListener('focusin', e => {
      if (bar && bar.contains(e.target)) flashUi(uiCfg.idleHideDelay);
    });
    flashUi(uiCfg.idleHideDelay);
    if (!V.pptMode) {
      document.getElementById('viewport').addEventListener('click', e => {
        if (e.target.closest('[data-interactive]')) return;
        if (!playing && isInteractiveHold()) return;
        playing ? pause() : play();
      });
    }
  }

  function syncPlayBtnUI() {
    if (!ui.play) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const state = playing ? 'playing' : (ended ? 'ended' : 'paused');
    const key = playing ? 'pause' : (ended ? 'replay' : 'play');
    const label = uiText(key);
    ui.play.dataset.state = state;
    ui.play.setAttribute('aria-pressed', String(playing));
    swapBtnIcon(ui.play, key, icons[key], label);
  }

  function syncSubsBtnUI() {
    if (!ui.subs) return;
    const icons = getUiCfg(V.getCfg()).icons;
    if (V.pptMode && pptRt && pptRt.swapSubsIcon) {
      pptRt.swapSubsIcon(ui.subs, showSubs, icons);
      return;
    }
    const key = showSubs ? 'subsOn' : 'subsOff';
    ui.subs.classList.toggle('is-off', !showSubs);
    swapBtnIcon(ui.subs, key, icons[key], uiText(showSubs ? 'subsHide' : 'subsShow'));
  }

  function buildPptUI(uiCfg) {
    const bar = document.getElementById('controls');
    ui.subs = bar.querySelector('[data-act=subs]');
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');
    pptRt.init(bar, uiCfg);
    syncSubsBtnUI();
    if (ui.subs) ui.subs.onclick = () => setSubs(!showSubs);
    if (ui.webfull) ui.webfull.onclick = () => setWebFull(!webFull);
    if (ui.full) ui.full.onclick = toggleOsFull;
    document.addEventListener('fullscreenchange', syncFullUI);
    document.addEventListener('webkitfullscreenchange', syncFullUI);
    bindIdleWake(bar, uiCfg);
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
    ui.subs = bar.querySelector('[data-act=subs]');
    ui.mute = bar.querySelector('[data-act=mute]');
    ui.toPpt = bar.querySelector('[data-act=to-ppt]');
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');

    ui.play.onclick = () => (playing ? pause() : play());
    mountTrackMarks(track, uiCfg);
    bindScrubber(track);
    bindTrackHoverHint(track);
    if (hudEl && !hudEl.classList.contains('is-off')) bindScrubber(hudEl);
    buildChapters(bar);
    buildRateMenu(bar, uiCfg);
    buildSoundMenu(bar);
    bindMenuAutoClose(bar);

    syncRateBtnUI();
    syncSubsBtnUI();
    ui.subs.onclick = () => setSubs(!showSubs);
    syncSoundMenuUI();
    bindVolumeWheel(ui.mute);
    ui.mute.onclick = e => {
      e.stopPropagation();
      if (audioRt && audioRt.consumeRecentUnlock && audioRt.consumeRecentUnlock()) {
        const pct = Math.round(audioRt.getState(now).volume * 100);
        flashOsd(uiText('osdVol', { pct }));
        return;
      }
      setOpenMenu(bar, bar.dataset.menu === 'sound' ? '' : 'sound');
    };
    if (ui.toPpt) ui.toPpt.onclick = e => { e.stopPropagation(); pause(); navigateModeSwitch(true, Math.max(0, V.scenes.indexOf(current))); };
    if (ui.webfull) ui.webfull.onclick = () => setWebFull(!webFull);
    ui.full.onclick = toggleOsFull;
    if (sandboxState.backEl) {
      sandboxState.backEl.onclick = e => { e.stopPropagation(); exitSandbox(true); };
    }
    document.addEventListener('fullscreenchange', syncFullUI);
    document.addEventListener('webkitfullscreenchange', syncFullUI);
    bindKeyboard(bar);
    bindIdleWake(bar, uiCfg);
  }

  function updateUI() {
    if (V.pptMode && pptRt) { pptRt.syncUI(); return; }
    if (!ui.fill) return;
    const pct = clamp(now / V.duration) * 100 + '%';
    ui.fill.style.width = pct;
    if (ui.thumb) ui.thumb.style.left = pct;
    if (!ui.time.dataset.copied) ui.time.textContent = fmtTime(now) + ' / ' + fmtTime(V.duration);
    const idx = V.scenes.indexOf(current);
    if (ui.chapLabel && current) ui.chapLabel.textContent = `${String(idx + 1).padStart(2, '0')} · ${current.title}`;
    syncPlayBtnUI();
    if (ui.chapItems) ui.chapItems.forEach((it, i) => toggle(it, 'on', i === idx));
    V.controls.forEach(c => { if (typeof c.sync === 'function') c.sync(c._el, V); });
  }

  function fit() {
    const vp = document.getElementById('viewport');
    const bar = document.getElementById('controls');
    const W = V.stageWidth || 1920, H = V.stageHeight || 1080;
    const vpW = (vp && vp.clientWidth) || innerWidth;
    const vpH = (vp && vp.clientHeight) || innerHeight;
    const ctrlH = (bar && bar.offsetHeight) || 46;
    const k = Math.min(vpW / W, vpH / H);
    const letterbox = Math.max(0, (vpH - H * k) / 2);
    const overlap = Math.round(Math.max(0, (ctrlH + 6 - letterbox) / Math.max(0.1, k)));
    stage.style.transform = `translate(-50%,-50%) scale(${k})`;
    stage.style.setProperty('--ctrl-overlap', overlap + 'px');
    if (vp) vp.style.setProperty('--k', k);
  }

  function waitVideoReady(vid, minimum, timeoutMs, signal) {
    return new Promise(resolve => {
      if (vid.error) { resolve(false); return; }
      const isReady = () => vid.readyState >= minimum && !vid.seeking;
      if (isReady()) { resolve(true); return; }
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked'];
      const done = ok => {
        clearTimeout(timer);
        events.forEach(event => vid.removeEventListener(event, onReady));
        vid.removeEventListener('error', onErr);
        signal.removeEventListener('abort', onErr);
        resolve(ok);
      };
      const onReady = () => { if (isReady()) done(true); };
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), timeoutMs);
      events.forEach(event => vid.addEventListener(event, onReady));
      vid.addEventListener('error', onErr, { once: true });
      signal.addEventListener('abort', onErr, { once: true });
      if (signal.aborted) done(false);
    });
  }

  function videoFrameError(vid, phase) {
    const src = vid.currentSrc || vid.src;
    const detail = vid.error ? (vid.error.message || `media error ${vid.error.code}`) : 'Media did not become ready for seeking';
    return new Error(`Cannot prepare embedded video "${src}" (${phase}, currentTime=${vid.currentTime.toFixed(3)}): ${detail}`);
  }

  function resolveLoadedVideoTime(vid, targetSec) {
    const duration = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : null;
    if (!duration) return targetSec;
    const target = vid._vclip.loop ? targetSec % duration : Math.min(targetSec, duration - 0.01);
    return Math.max(0, target);
  }

  function assertAssetRequestActive(signal) {
    if (signal.aborted) throw new DOMException('Frame superseded', 'AbortError');
  }

  async function seekVideoElementAsync(vid, targetSec, signal) {
    const metadataReady = await waitVideoReady(vid, 1, RECORD ? 15000 : 2000, signal);
    assertAssetRequestActive(signal);
    if (!metadataReady) {
      if (RECORD) throw videoFrameError(vid, 'metadata');
      return;
    }
    // 元数据可能晚于场景更新到达，按真实片长重新计算末帧或循环位置。
    targetSec = resolveLoadedVideoTime(vid, targetSec);
    vid._vclip.targetTime = targetSec;
    if (Math.abs((vid.currentTime || 0) - targetSec) > 0.000001 || vid.seeking) {
      try { vid.currentTime = targetSec; } catch (err) {
        if (RECORD) throw err;
        return;
      }
    }
    const frameReady = await waitVideoReady(vid, 2, RECORD ? 15000 : 1500, signal);
    assertAssetRequestActive(signal);
    const atTarget = frameReady && Math.abs(vid.currentTime - targetSec) <= 0.000001;
    if (RECORD && !atTarget) throw videoFrameError(vid, `frame at ${targetSec.toFixed(3)}s`);
  }

  function unescapeCssImageUrl(value) {
    return value.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_match, escaped) => {
      return /^[0-9a-f]/i.test(escaped) ? String.fromCodePoint(parseInt(escaped, 16) || 0xfffd) : escaped;
    });
  }

  function collectCssImageUrls(style, sources) {
    const images = [style.backgroundImage, style.maskImage, style.borderImageSource, style.listStyleImage, style.content].join(' ');
    for (const match of images.matchAll(/url\("((?:\\.|[^"\\])*)"\)/g)) {
      sources.add(unescapeCssImageUrl(match[1]));
    }
  }

  function decodeCssImage(src) {
    if (!cssImageDecodes.has(src)) {
      const image = new Image();
      image.src = src;
      cssImageDecodes.set(src, image.decode().catch(() => {}));
    }
    return cssImageDecodes.get(src);
  }

  function cssMayUseImages(text) {
    // 无类型的 attr(name) 只生成文本；保留带类型或回退值的声明继续检查。
    const imageText = text.replace(/attr\(\s*[-\w]+\s*\)/gi, '');
    return /(?:url|image-set|attr)\s*\(/i.test(imageText) || text.includes('\\') || text.includes('/*');
  }

  function stylesheetMayUseImages(sheet) {
    try {
      return Array.from(sheet.cssRules).some(rule => rule.type !== 5 && cssMayUseImages(rule.cssText));
    } catch { return true; }
  }

  function stageMayUseCssImages() {
    const roots = stage.shadowRoot ? [document, stage.shadowRoot] : [document];
    for (let el = stage; el; el = el.parentElement) {
      if (cssMayUseImages(el.style.cssText)) return true;
    }
    while (roots.length) {
      const root = roots.pop();
      const sheets = [...root.styleSheets, ...(root.adoptedStyleSheets || [])];
      if (sheets.some(stylesheetMayUseImages)) return true;
      const elements = root === document ? stage.querySelectorAll('*') : root.querySelectorAll('*');
      for (const el of elements) {
        if (cssMayUseImages(el.style.cssText)) return true;
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return false;
  }

  function waitCssImages() {
    // 没有 CSS 图片来源时，避免逐帧读取每个元素及其伪元素的计算样式。
    // 每次寻道重新检查声明，仍可发现动态内联样式、CSSOM 和影子根更新。
    if (!stageMayUseCssImages()) return Promise.resolve();
    const sources = new Set();
    const pending = [stage];
    while (pending.length) {
      const el = pending.pop();
      const style = getComputedStyle(el);
      if (style.display === 'none') continue;
      pending.push(...el.children);
      if (el.shadowRoot) pending.push(...el.shadowRoot.children);
      if (style.visibility === 'visible' && style.display !== 'contents') collectCssImageUrls(style, sources);
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = getComputedStyle(el, pseudo);
        if (pseudoStyle.content !== 'none' && pseudoStyle.content !== 'normal' && pseudoStyle.display !== 'none' && pseudoStyle.visibility === 'visible') {
          collectCssImageUrls(pseudoStyle, sources);
        }
      }
    }
    return Promise.all(Array.from(sources, decodeCssImage));
  }

  function collectImageDecodes(root, tasks) {
    for (const img of root.querySelectorAll('img, image')) {
      if (!(img._decoded && img.complete) && typeof img.decode === 'function') {
        tasks.push(img.decode().then(() => { img._decoded = true; }).catch(() => {}));
      }
    }
    if (root.shadowRoot) collectImageDecodes(root.shadowRoot, tasks);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collectImageDecodes(el.shadowRoot, tasks);
    }
  }

  async function waitStageAssets(signal) {
    if (!stage) return;
    const tasks = [waitCssImages()];
    collectImageDecodes(stage, tasks);
    for (const clip of V._videoClips) {
      if (clip.isConnected && clip._vclip) tasks.push(seekVideoElementAsync(clip, clip._vclip.targetTime, signal));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  async function waitFrameAssets(frame) {
    const signal = V._frameRuntime.signal(frame);
    const assets = new AbortController();
    let timer, cancel;
    const stopped = new Promise((_, reject) => {
      cancel = () => {
        reject(new DOMException('Frame superseded', 'AbortError'));
        assets.abort();
      };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        reject(new Error('Stage asset preparation timed out after 30000ms'));
        assets.abort();
      }, 30000);
      if (signal.aborted) cancel();
    });
    try { await Promise.race([waitStageAssets(assets.signal), stopped]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }

  function consumeHmrTime() {
    try {
      const raw = sessionStorage.getItem('__video_hmr_t');
      if (raw == null) return null;
      sessionStorage.removeItem('__video_hmr_t');
      const v = parseFloat(raw);
      return Number.isFinite(v) ? v : 0;
    } catch {
      return null;
    }
  }

  function resolveInitialTime(uiCfg) {
    const hmrT = consumeHmrTime();
    if (hmrT != null) return { t: hmrT, resumed: false };
    if (params.has('t')) return { t: parseFloat(params.get('t')) || 0, resumed: false };
    if (params.has('scene')) {
      const sIdx = clamp(+params.get('scene') || 0, 0, Math.max(0, V.scenes.length - 1));
      return { t: V.scenes[sIdx] ? V.scenes[sIdx].start + 0.01 : 0, resumed: false };
    }
    const savedT = V._prefsRuntime ? V._prefsRuntime.resolveSavedResumeTime(params, uiCfg, V.duration) : 0;
    return { t: savedT, resumed: savedT > 0 };
  }

  function applySavedPrefs(saved) {
    if (!saved) return;
    if (typeof saved.subs === 'boolean' && !params.has('nosubs')) {
      showSubs = saved.subs;
      document.body.classList.toggle('nosubs', !showSubs);
    }
    if (typeof saved.rate === 'number' && Number.isFinite(saved.rate)) {
      playbackRate = clamp(saved.rate, 0.25, 4);
      V._playbackRate = playbackRate;
    }
  }

  function captureCuePos(cues, lt, scDur) {
    const last = cues[cues.length - 1];
    if (lt > last.end) {
      return { mode: 'tail', li: cues.length - 1, frac: clamp((lt - last.end) / Math.max(0.05, scDur - last.end), 0, 1) };
    }
    const li = Math.max(0, cues.findIndex(c => lt <= c.end));
    const c = cues[li];
    if (lt < c.start) {
      const prevEnd = li > 0 ? cues[li - 1].end : 0;
      return { mode: 'gap', li, frac: clamp((lt - prevEnd) / Math.max(0.05, c.start - prevEnd), 0, 1) };
    }
    return { mode: 'cue', li, frac: clamp((lt - c.start) / Math.max(0.05, c.end - c.start), 0, 1) };
  }

  function captureLogicalPos() {
    const si = Math.max(0, V.scenes.indexOf(current));
    const sc = V.scenes[si];
    if (!sc) return { si: 0, mode: 'scene', li: 0, frac: 0 };
    const lt = clamp(now - sc.start, 0, sc.duration);
    if (!sc.cues || !sc.cues.length) {
      return { si, mode: 'scene', li: 0, frac: clamp(lt / Math.max(0.1, sc.duration), 0, 1) };
    }
    return Object.assign({ si }, captureCuePos(sc.cues, lt, sc.duration));
  }

  function resolveMappedCueLt(cues, scDur, pos) {
    const li = clamp(pos.li, 0, cues.length - 1);
    const c = cues[li];
    if (pos.mode === 'tail') {
      const last = cues[cues.length - 1];
      return last.end + pos.frac * Math.max(0, scDur - last.end);
    }
    if (pos.mode === 'gap') {
      const prevEnd = li > 0 ? cues[li - 1].end : 0;
      return prevEnd + pos.frac * Math.max(0, c.start - prevEnd);
    }
    return c.start + pos.frac * Math.max(0, c.end - c.start);
  }

  function resolveMappedPos(pos) {
    if (!V.scenes.length) return 0;
    const sc = V.scenes[clamp(pos.si, 0, V.scenes.length - 1)];
    if (!sc) return 0;
    if (pos.mode === 'scene' || !sc.cues || !sc.cues.length) {
      return sc.start + pos.frac * sc.duration;
    }
    return sc.start + resolveMappedCueLt(sc.cues, sc.duration, pos);
  }

  async function ensureLocaleAssetsLoaded(target, fallbackLang) {
    if (shouldProbeLocalePack(target)) await loadOptionalScript(`locales/${target}.js`);
    if (V.activateCachedVoice && V.activateCachedVoice(target)) return true;
    const cfg0 = V.getCfg();
    const baseTimings = cfg0.timingsScript || 'assets/voice/timings.js';
    const isSec = V.isSecondaryLocale ? V.isSecondaryLocale(target) : false;
    const targetTimings = isSec ? baseTimings.replace(/\.js$/i, `.${target}.js`) : baseTimings;
    const ok = await loadOptionalScript(targetTimings);
    if (ok && V.captureVoice) { V.captureVoice(V.voice); return true; }
    return finalizeLocaleFallback(target, fallbackLang);
  }

  function syncStaticBarLabels(bar, cfg) {
    const home = bar.querySelector('.ctrl-home');
    if (home) {
      const ht = cfg.homeLabel || uiText('home');
      home.title = ht;
      home.setAttribute('aria-label', ht);
    }
    const chapTrig = bar.querySelector('.chap-trigger');
    if (chapTrig) chapTrig.title = uiText('chapTrigger');
    const chapHd = bar.querySelector('.chap-menu-hd');
    if (chapHd) chapHd.textContent = uiText('chapHeader');
    if (ui.mute) ui.mute.setAttribute('aria-label', uiText('soundLabel'));
    if (ui.toPpt) {
      const pt = uiText('switchToPpt');
      ui.toPpt.title = pt;
      ui.toPpt.setAttribute('aria-label', pt);
    }
  }

  function refreshLocalizedChrome(cfg, uiCfg) {
    if (sandboxState.txtEl && !sandboxState.active) sandboxState.txtEl.textContent = uiText('sandboxActive');
    if (sandboxState.backEl) sandboxState.backEl.textContent = uiText('sandboxBack');
    const hintEl = document.getElementById('start-hint');
    if (hintEl) hintEl.textContent = cfg.startHint || uiText('startHint');
    if (RECORD) return;
    const bar = document.getElementById('controls');
    if (!bar) return;
    if (V.pptMode && pptRt) {
      pptRt.refreshChrome(cfg, uiCfg);
      syncSubsBtnUI();
      syncFullUI();
      return;
    }
    syncStaticBarLabels(bar, cfg);
    mountTrackMarks(bar.querySelector('.track'), uiCfg);
    buildChapters(bar);
    buildSoundMenu(bar);
    syncRateBtnUI();
    syncSubsBtnUI();
    syncFullUI();
  }

  function resolveTargetLangCode(nextLang) {
    const trimmed = String(nextLang || '').trim();
    if (trimmed) return trimmed;
    return (V.getBaseLang && V.getBaseLang()) || '';
  }

  function applyPostLocaleReload(pos, target) {
    if (V.syncDocLangAttrs) V.syncDocLangAttrs();
    if (current && current.root) current.root.remove();
    current = null;
    V.layout();
    if (V.pptMode && pptRt) pptRt.rebuildPages();
    const cfg = V.getCfg(), uiCfg = getUiCfg(cfg);
    if (cfg.title) document.title = cfg.title;
    mountHudTicks(uiCfg);
    if (audioRt) audioRt.reloadTracks(cfg);
    refreshLocalizedChrome(cfg, uiCfg);
    lastSeekTarget = -1;
    seek(resolveMappedPos(pos), true);
    V.emit('onLocaleChange', { lang: V.getActiveLang(), duration: V.duration });
    const hit = V.getAvailableLocales ? V.getAvailableLocales().find(x => x.code.toLowerCase() === target.toLowerCase()) : null;
    if (hit) flashOsd(hit.label);
  }

  async function applyLang(nextLang) {
    const target = resolveTargetLangCode(nextLang);
    const prevLang = V.getActiveLang();
    if (target === prevLang) return prevLang;
    // 等待资源时保留用户的播放意图，暂停时间轴与旧媒体。
    localeLoading = true;
    try {
      if (audioRt) audioRt.pausePlayback();
      for (const clip of V._videoClips) if (clip.pause) clip.pause();
      if (V.captureVoice && V.voice) V.captureVoice(V.voice);
      V.__langOverridden = true;
      V.__activeLang = target;
      const ok = await ensureLocaleAssetsLoaded(target, prevLang);
      if (!ok && V.getActiveLang() === prevLang) return prevLang;
      const pos = captureLogicalPos();
      V.resetCheckpoints();
      applyPostLocaleReload(pos, V.getActiveLang());
      return V.getActiveLang();
    } finally {
      localeLoading = false;
      lastTs = performance.now();
      if (playing && audioRt) audioRt.startPlayback();
    }
  }

  function setLang(nextLang) {
    const pending = localeSwitch.then(() => applyLang(nextLang));
    localeSwitch = pending.catch(() => {});
    return pending;
  }

  function exposeBridge(cfg) {
    window.__video = {
      get duration() { return V.duration; },
      width: V.stageWidth,
      height: V.stageHeight,
      fps: cfg.fps || 30,
      seek: t => (RECORD ? render(t, 0) : seek(t)),
      seekVisual: t => render(t, 0),
      seekAsync: V.seekToAsync,
      setRate,
      setSubs,
      setLang,
      getLang: () => V.getActiveLang(),
      pptMode: Boolean(V.pptMode),
      get page() { return pptRt ? pptRt.getPageNo() : 0; },
      get totalPages() { return pptRt ? pptRt.getTotalPages() : 0; },
      nextPage: () => (pptRt ? pptRt.stepBy(1) + 1 : 0),
      prevPage: () => (pptRt ? pptRt.stepBy(-1) + 1 : 0),
      goToPage: (p, opts) => (pptRt ? pptRt.goToPage((Number(p) || 1) - 1, opts) + 1 : 0),
      sfx: (k, o) => (V.sfx ? V.sfx(k, o) : false),
      setVolume: v => audioRt.setVolume(v),
      getVolume: () => audioRt.getState(now).volume,
      setBgm: on => audioRt.setBgm(on),
      setVoice: on => audioRt.setVoice(on),
      setMuted: on => audioRt.setMuted(on),
      clearSavedState: V.clearSavedState,
      flashOsd,
      play,
      pause,
      replay,
      tryEgg,
      enterSandbox,
      exitSandbox,
      search: q => (V.search ? V.search(q) : []),
      openSearch: q => (V.openSearch ? V.openSearch(q) : undefined),
      getDeepLink: t => (V.getDeepLink ? V.getDeepLink(t) : ''),
      resume: V.resume,
      getSyncState: () => {
        const a = audioRt.getState(now);
        return {
          now,
          clock: V._clock || now,
          alive: V._clock || now,
          idle: idleSec,
          pointer: Object.assign({}, ptr),
          ended,
          sandbox: sandboxState.active,
          playing,
          playbackRate,
          subsEnabled: showSubs,
          sceneIndex: V._currentSceneIdx || 0,
          pptMode: Boolean(V.pptMode),
          ...(pptRt ? pptRt.getState() : {}),
          lang: V.getActiveLang(),
          audioBlocked: Boolean(a.audioBlocked),
          volume: a.volume,
          muted: a.muted,
          hasBgm: a.hasBgm,
          bgmEnabled: a.bgmOn,
          voiceEnabled: a.voiceOn,
          audioTime: a.audioTime,
          drift: a.drift,
          seeking: a.seeking,
          targetSeekTime: a.targetSeekTime,
          readyState: a.readyState,
          audioPaused: a.audioPaused,
        };
      },
      get scenes() { return V.scenes.map(s => ({ title: s.title, start: s.start, duration: s.duration, cues: s.cues })); },
    };
  }

  function playerState() {
    return Object.freeze({ now, playing: playing && !scrubbing && !localeLoading,
      ended, sceneIndex: V.scenes.indexOf(current), mode: V.environment.mode,
      sandbox: sandboxState.active, rate: playbackRate,
      page: pptRt ? pptRt.getPageNo() : 0, totalPages: pptRt ? pptRt.getTotalPages() : 0 });
  }

  function goToScene(index, options = {}) {
    const sceneIndex = typeof index === 'string' ? V.scenes.findIndex(sc => sc.id === index) : index;
    const scene = V.scenes[sceneIndex];
    if (!Number.isInteger(sceneIndex) || !scene) throw new RangeError(`Unknown scene: ${index}`);
    const offset = options.offset === undefined ? 0.05 : Number(options.offset);
    if (!Number.isFinite(offset)) throw new TypeError('Scene offset must be finite');
    const target = scene.start + clamp(offset, 0, Math.max(0, scene.duration - 0.001));
    if (options.sandbox && !V.pptMode && !RECORD) tryEgg(target, options.hint || scene.title);
    else if (RECORD) render(target, 0);
    else seek(target, true);
    return playerState();
  }

  function exposePlayer() {
    V.player = Object.freeze({
      play: () => { if (!V.pptMode) play(); return playerState(); },
      pause: () => { pause(); return playerState(); },
      replay: () => { if (pptRt) pptRt.goToPage(0); else replay(); return playerState(); },
      getState: playerState,
      seek: t => { if (RECORD) render(t, 0); else seek(t, true); return playerState(); },
      goToScene, tryAt: tryEgg, exitSandbox,
      goToPage(page, options) {
        if (!pptRt) throw new Error('PPT mode is not active');
        if (!Number.isInteger(page) || page < 1 || page > pptRt.getTotalPages()) throw new RangeError('Unknown PPT page');
        pptRt.goToPage(page - 1, options);
        return playerState();
      },
      nextPage: () => pptRt && pptRt.stepBy(1),
      prevPage: () => pptRt && pptRt.stepBy(-1),
    });
  }

  function syncInitialLocaleState() {
    if (V.captureVoice && V.voice) V.captureVoice(V.voice);
    if (V.syncDocLangAttrs) V.syncDocLangAttrs();
  }

  function initInitialAudioAndSubs(cfg, uiCfg, savedPrefs) {
    if (V.pptMode) {
      showSubs = params.has('subs');
      document.body.classList.toggle('nosubs', !showSubs);
      return;
    }
    applySavedPrefs(savedPrefs);
    audioRt.setRate(playbackRate);
    audioRt.initTracks(cfg, uiCfg, savedPrefs);
  }

  function startInitialRender(uiCfg) {
    if (V.pptMode && pptRt) {
      pptRt.rebuildPages();
      pptRt.goToPage(pptRt.resolveInitialPageIndex(), { instant: true, force: true });
      return;
    }
    const initPos = resolveInitialTime(uiCfg);
    if (initPos.t > 0) {
      seek(initPos.t);
      if (initPos.resumed) flashOsd(uiText('osdResumed', { time: fmtTime(initPos.t) }), 1200);
    } else {
      render(0, 0);
    }
  }

  V.start = function () {
    syncInitialLocaleState();
    V.mountStage();
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    if (cfg.title) document.title = cfg.title;
    stage = document.getElementById('stage');
    V._subtitlesRuntime.bindSubElements(document.getElementById('subs'));
    V.layout();
    mountHudTicks(uiCfg);
    V._layersRuntime.mountLayers(stage, document.getElementById('subs'));

    const savedPrefs = V._prefsRuntime ? V._prefsRuntime.readSaved(uiCfg) : null;
    audioRt = V._createAudioRuntime({
      params,
      isRecord: RECORD,
      isPlaying: () => playing && !localeLoading,
      getNow: () => now,
      getCurrentScene: () => current,
      markSeekApplied: target => { lastSeekTarget = target; lastSeekAt = performance.now(); },
      onSoundUI: syncSoundMenuUI,
      onAudioBlocked: () => flashOsd(uiText('osdBlocked'), 1800),
      onEnded: finishPlayback,
      onVisibilitySync: t => render(t, 0),
      onBgmUnavailable: syncSoundMenuUI,
    });
    initInitialAudioAndSubs(cfg, uiCfg, savedPrefs);

    V.seekTo = t => render(t, 0);
    V.seekToAsync = async t => {
      if (!Number.isFinite(t)) throw new TypeError('seek time must be finite');
      render(t, 0);
      const snapshot = V.getFrameState();
      const release = V._frameRuntime.hold(snapshot);
      try {
        await Promise.all([waitFrameAssets(snapshot), V._frameRuntime.prepare(snapshot)]);
        if (snapshot !== V.getFrameState()) throw new DOMException('Frame superseded', 'AbortError');
        return snapshot;
      } finally { release(); }
    };
    V.setSubs = setSubs;
    V.setLang = setLang;
    V.setVolume = v => audioRt.setVolume(v);
    V.getVolume = () => audioRt.getState(now).volume;
    V.setBgm = on => audioRt.setBgm(on);
    V.setVoice = on => audioRt.setVoice(on);
    V.setMuted = on => audioRt.setMuted(on);
    V.enterSandbox = enterSandbox;
    V.exitSandbox = exitSandbox;
    V.tryEgg = tryEgg;
    V.replay = replay;
    V._playerCtl = {
      play, pause, replay, seek, setRate, setSubs, setLang,
      setVolume: V.setVolume, getVolume: V.getVolume,
      setBgm: V.setBgm, setVoice: V.setVoice, setMuted: V.setMuted,
      enterSandbox, exitSandbox, tryEgg,
      fmtTime, updateUI, flashUi, flashOsd,
      setOpenMenu: m => setOpenMenu(document.getElementById('controls'), m),
      getRate: () => playbackRate,
      toggleLoopScene: () => (loopScene = !loopScene),
      isDev: DEV,
      isRecord: RECORD,
    };
    exposePlayer();

    if (RECORD) document.body.classList.add('record');
    else if (V.pptMode && pptRt) buildPptUI(uiCfg);
    else buildUI(uiCfg);
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', () => { releaseBarHold(); fit(); });
    lastFrameTs = performance.now();
    ambientOffset = 0;
    idleSec = 0;
    startInitialRender(uiCfg);
    requestAnimationFrame(frame);
    if (!V.pptMode && params.has('autoplay')) play();
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

  function clearStaleVoiceIfNeeded() {
    if (V.voice && V.isVoiceLocaleMatch && !V.isVoiceLocaleMatch(V.voice)) {
      V.voice = null;
    }
  }

  function hasLocaleResources(lang) {
    if (!lang || (V.isSecondaryLocale && !V.isSecondaryLocale(lang))) return true;
    if (V.locales && V.locales[lang]) return true;
    if (V.voices && V.voices[lang]) return true;
    return Boolean(V.voice && V.voice.lang === lang);
  }

  function finalizeLocaleFallback(lang, fallbackLang) {
    if (hasLocaleResources(lang)) {
      clearStaleVoiceIfNeeded();
      return true;
    }
    const fb = fallbackLang !== undefined ? fallbackLang : ((V.getBaseLang && V.getBaseLang()) || '');
    V.__langOverridden = true;
    V.__activeLang = fb;
    if (V.activateCachedVoice) V.activateCachedVoice(fb);
    return false;
  }

  function shouldProbeLocalePack(lang) {
    if (!lang || V.locales[lang]) return false;
    if (V.isSecondaryLocale && V.isSecondaryLocale(lang)) return true;
    const base = V.getBaseLang ? V.getBaseLang() : '';
    return Boolean(!base || lang.toLowerCase() !== base.toLowerCase());
  }

  async function loadBootLocaleTimings(cfg, lang) {
    if (!lang || (V.isSecondaryLocale && !V.isSecondaryLocale(lang))) return;
    const baseTimings = cfg.timingsScript || 'assets/voice/timings.js';
    const langTimings = baseTimings.replace(/\.js$/i, `.${lang}.js`);
    if (langTimings === baseTimings) return;
    const ok = await loadOptionalScript(langTimings);
    if (ok && V.captureVoice) V.captureVoice(V.voice);
    else finalizeLocaleFallback(lang);
  }

  async function ensureDynamicBootAssets() {
    if (V.captureVoice && V.voice) V.captureVoice(V.voice);
    const cfg = V.getCfg();
    if (V.scenes.length === 0 && Array.isArray(cfg.sceneScripts)) {
      for (const rel of cfg.sceneScripts) await loadOptionalScript(rel);
    }
    const lang = V.getActiveLang();
    if (shouldProbeLocalePack(lang)) await loadOptionalScript(`locales/${lang}.js`);
    await loadBootLocaleTimings(cfg, lang);
  }

  V.boot = async function () {
    await ensureDynamicBootAssets();
    V.mountStage();
    const glEl = document.getElementById('gl');
    if (V.gl && glEl) {
      glEl.classList.remove('is-off');
      try {
        await V.gl.init(glEl, V.getCfg());
        if (V.gl.ready === undefined) V.gl.ready = true;
      } catch {
        V.gl.ready = false;
        glEl.classList.add('is-off');
      }
    }
    V.start();
  };
})(globalThis.V = globalThis.V || {});
