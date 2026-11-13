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
  let lastTs = 0, lastFrameTs = 0, ambientOffset = 0, idleSec = 0, ended = false, scrubbing = false;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false;
  let lastSeekTarget = -1, lastSeekAt = 0, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null, idleTimer = 0, osdTimer = 0;
  let inBar = false, lastPtrX = -9999, lastPtrY = -9999;
  const ptr = (V.pointer = V.pointer || {
    x: 960, y: 540, nx: 0, ny: 0, sx: 0, sy: 0, presence: 0, inside: false, down: false,
  });
  let wipeState = { name: '', handler: null, dom: null };
  const sandboxState = { active: false, entering: false, autoExitOnLast: true, returnTime: null, el: null, txtEl: null, backEl: null };
  const ui = {};
  let audioRt = null;

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

  function buildControlsBar(cfg, uiCfg) {
    const homeTitle = cfg.homeLabel || '返回主界面';
    const homeLink = cfg.homeUrl === false
      ? null
      : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl || '../', title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
    const rateWrap = uiCfg.rate
      ? h('div', { class: 'rate-wrap' },
          h('button', { class: 'ctrl-rbtn ctrl-icon-btn rate-trigger', 'data-act': 'rate', title: '播放倍速（1.0x）', 'aria-label': '播放倍速（1.0x）' }, makeCtrlIcon(uiCfg.icons.rate)),
          h('div', { class: 'rate-menu' }))
      : null;
    const webFullBtn = uiCfg.webFull
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: '窗口全屏（W）', 'aria-label': '窗口全屏' }, makeCtrlIcon(uiCfg.icons.webEnter))
      : null;
    return h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { class: 'ctrl-icon-btn', 'data-act': 'play', 'data-state': 'paused', 'aria-pressed': 'false', title: '播放（空格）', 'aria-label': '播放（空格）' }, makeCtrlIcon(uiCfg.icons.play)),
      ...renderCustomControls('left', uiCfg),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' }), h('div', { class: 'track-tip' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: '切换章节 / 搜索台词（/）' }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, makeCtrlIcon(uiCfg.icons.chapCaret))),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, '章节导航 · CHAPTERS'), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right', uiCfg),
      rateWrap,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'subs', title: '关闭字幕', 'aria-label': '关闭字幕' }, makeCtrlIcon(uiCfg.icons.subsOn)),
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'mute', title: '声音设置（M 静音 / ↑↓ 调节音量）', 'aria-label': '声音设置' }, makeCtrlIcon(uiCfg.icons.volumeOn)),
      h('div', { class: 'sound-menu' }),
      webFullBtn,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: '全屏（F）', 'aria-label': '全屏' }, makeCtrlIcon(uiCfg.icons.fullEnter)));
  }

  V.mountStage = function () {
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (!ptr.inside) { ptr.x = W / 2; ptr.y = H / 2; }
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    document.body.classList.toggle('ctrl-overlay', uiCfg.controlsMode === 'overlay');
    if (document.getElementById('stage')) return;

    const sbTxt = h('span', { class: 'v-sandbox-txt egg-ban-txt' }, '🎮 彩蛋试玩中');
    const sbBack = h('button', { class: 'v-sandbox-back egg-back-btn', 'data-interactive': '1', type: 'button' }, '↩ 返回终章');
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
    if (V._subtitlesRuntime && V._subtitlesRuntime.resetSceneSubLayout) {
      V._subtitlesRuntime.resetSceneSubLayout();
    }
    const si = V.scenes.indexOf(sc);
    sc.root = h('div', { class: 'scene ' + (sc.cls || '') });
    sc.ctx = V.makeCtx(sc, si);
    stage.appendChild(sc.root);
    V._inSceneBuild = true;
    V._inSceneUpdate = true;
    try {
      sc.build(sc.root, sc.ctx);
    } finally {
      V._inSceneBuild = false;
      V._inSceneUpdate = false;
    }
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

  function resolveCutDur(cutSc, cfg, handler) {
    if (cutSc && cutSc.transitionDur !== undefined) return cutSc.transitionDur;
    return cfg.transitionDur === undefined ? (handler.dur || 0.28) : cfg.transitionDur;
  }

  function runTransition() {
    if (current && current.root) {
      current.root.style.transform = '';
      current.root.style.opacity = '';
    }
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
      syncVideoClip(clip, lt, playing && !scrubbing);
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
    const last = V.scenes[V.scenes.length - 1];
    sandboxState.autoExitOnLast = !last || target < last.start;
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
    sc.ctx.idle = idle;
    sc.ctx.playing = playing && !scrubbing;
    sc.ctx.ended = ended;
    sc.ctx.pointer = ptr;
  }

  function runSceneUpdate(sc, lt, idle) {
    V._renderTick = (V._renderTick || 0) + 1;
    V._isPlaying = playing && !scrubbing;
    V._inSceneUpdate = true;
    try {
      sc.update(shouldContinueSceneAtEnd(sc, idle) ? lt + idle : lt, sc.ctx);
    } finally {
      V._inSceneUpdate = false;
    }
  }

  function render(t, nextIdle) {
    if (!V.scenes.length || !Number.isFinite(t)) return;
    const idle = RECORD ? 0 : (nextIdle === undefined ? idleSec : nextIdle);
    idleSec = idle;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    const clock = RECORD ? now : now + ambientOffset;
    prevRenderNow = now;
    V._now = now;
    V._clock = clock;
    if (RECORD) V._checkpointsRuntime.syncRecordCheckpoints(now);
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
    runSceneUpdate(sc, lt, idle);
    syncSceneVideoClips(lt);
    activeCueIdx = V._subtitlesRuntime.updateSubs(sc, idx, lt, now, clock, showSubs);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    if (!RECORD) V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: false, playing, scrubbing, pause, play });
    const aState = audioRt ? audioRt.getState(now) : { hasAudio: false, muted: false, voiceOn: true, volume: 1 };
    V.emit('onRender', {
      now, clock, alive: clock, idle, ended, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx,
      playing, scrubbing, sandbox: sandboxState.active, pointer: ptr,
      hasAudio: aState.hasAudio, isRecord: RECORD, muted: aState.muted, voiceOn: aState.voiceOn !== false, volume: aState.volume,
    });
    if (!RECORD) updateUI();
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

  function syncSoundMenuUI() {
    if (!audioRt) return;
    const st = audioRt.getState(now);
    if (ui.mute) {
      const icons = getUiCfg(V.getCfg()).icons;
      const [key, label] = audioRt.resolveSoundBtnSpec();
      ui.mute.classList.toggle('is-off', st.muted);
      ui.mute.dataset.soundMode = key;
      swapBtnIcon(ui.mute, key, icons[key], label);
    }
    syncVolumeSliderUI(st);
    if (ui.soundVoice) { ui.soundVoice.hidden = !st.hasBgm; toggle(ui.soundVoice, 'on', st.voiceOn); }
    if (ui.soundBgm) { ui.soundBgm.hidden = !st.hasBgm; toggle(ui.soundBgm, 'on', st.bgmOn); }
    if (ui.soundSepBgm) ui.soundSepBgm.hidden = !st.hasBgm;
    if (ui.soundAllMute) {
      if (ui.soundMuteTxt) ui.soundMuteTxt.textContent = st.hasBgm ? '全部静音' : '静音';
      toggle(ui.soundAllMute, 'on', st.muted);
    }
  }

  function stepVolumeBy(delta, showOsd = true) {
    if (!audioRt) return;
    const cur = audioRt.getState(now);
    const base = cur.muted && cur.volume <= 0.001 ? 0 : cur.volume;
    const next = Math.round(clamp(base + delta, 0, 1) * 100) / 100;
    audioRt.setVolume(next);
    if (!showOsd) return;
    const pct = Math.round(next * 100);
    flashOsd(pct <= 0 ? '已静音 · 0%' : `音量 ${pct}%`);
  }

  function bindVolumeWheel(el) {
    if (!el) return;
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
    lastTs = ts;
    const mTime = audioRt.tickMasterClock();
    if (mTime != null) {
      if (checkSceneLoop(mTime)) return;
      if (mTime >= V.duration - 0.01) finishPlayback();
      else render(mTime, 0);
      return;
    }
    if (shouldTickAmbientPause(current)) {
      ambientOffset += rawDt;
      render(now, 0);
    }
  }

  function advanceWallClock(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (audioRt) audioRt.syncWithWallClock(now);
    if (now + dt >= V.duration - 0.002) finishPlayback();
    else render(now + dt, 0);
  }

  function frame(ts) {
    const rawDt = lastFrameTs > 0 ? clamp((ts - lastFrameTs) / 1000, 0, 0.1) : 0;
    lastFrameTs = ts;
    stepPointerSmoothing(rawDt);
    if (scrubbing) {
      lastTs = ts;
      if (current && current.live) render(now, 0);
    } else if (playing) {
      if (audioRt && audioRt.canUseMasterClock()) advanceAudioClock(ts, rawDt);
      else advanceWallClock(ts);
    } else if (shouldTickAmbientPause(current)) {
      ambientOffset += rawDt;
      idleSec += rawDt;
      render(now, idleSec);
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
    lastTs = performance.now();
    if (audioRt) audioRt.startPlayback();
    document.body.classList.add('playing');
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
    const label = `播放倍速（${txt}）`;
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
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (!force && isRedundantSeek(target, ts)) return;
    lastTs = ts;
    idleSec = 0;
    lastSeekTarget = target;
    lastSeekAt = ts;
    if (V._checkpointsRuntime && V._checkpointsRuntime.onSeek) V._checkpointsRuntime.onSeek(target);
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

  function buildSoundMenu(bar) {
    const menu = bar.querySelector('.sound-menu');
    ui.soundMenu = menu;
    if (!menu) return;
    menu.innerHTML = '';
    ui.volRange = h('input', { class: 'sound-vol-range', type: 'range', min: '0', max: '100', step: '1', value: '100', 'aria-label': '音量' });
    ui.volVal = h('span', { class: 'sound-vol-val' }, '100%');
    const volRow = h('div', { class: 'sound-vol-row' }, ui.volRange, ui.volVal);
    volRow.onclick = e => e.stopPropagation();
    ui.volRange.oninput = () => audioRt.setVolume(Number(ui.volRange.value) / 100);
    ui.soundVoice = h('div', { class: 'sound-item', 'data-sound': 'voice' }, h('span', null, '解说声音'), h('i', null, '✓'));
    ui.soundBgm = h('div', { class: 'sound-item', 'data-sound': 'bgm' }, h('span', null, '背景音乐'), h('i', null, '✓'));
    ui.soundSepBgm = h('div', { class: 'sound-sep' });
    ui.soundMuteTxt = h('span', null, '全部静音');
    ui.soundAllMute = h('div', { class: 'sound-item', 'data-sound': 'mute' }, ui.soundMuteTxt, h('i', null, '✓'));
    ui.soundVoice.onclick = e => { e.stopPropagation(); audioRt.toggleVoiceFromMenu(); };
    ui.soundBgm.onclick = e => { e.stopPropagation(); audioRt.toggleBgmFromMenu(); };
    ui.soundAllMute.onclick = e => { e.stopPropagation(); audioRt.setMuted(!audioRt.isAllMuted()); };
    menu.append(volRow, h('div', { class: 'sound-sep' }), ui.soundVoice, ui.soundBgm, ui.soundSepBgm, ui.soundAllMute);
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
    setBtnIcon(ui.webfull, webFull ? 'webExit' : 'webEnter', webFull ? icons.webExit : icons.webEnter, webFull ? '退出窗口全屏（W / Esc）' : '窗口全屏（W）', webFull);
    setBtnIcon(ui.full, osOn ? 'fullExit' : 'fullEnter', osOn ? icons.fullExit : icons.fullEnter, osOn ? '退出全屏（F / Esc）' : '全屏（F）', osOn);
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
    flashOsd(next ? '已静音' : `音量 ${pct}%`);
  }

  function toggleBgmShortcut() {
    if (!audioRt.hasBgm()) return;
    const next = !audioRt.getState(now).bgmOn;
    audioRt.setBgm(next);
    flashOsd(next ? '背景音乐已开' : '背景音乐已关');
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
    if (isEventOverBar(bar, e.target)) {
      resetPointerLeave();
      return;
    }
    applyStagePointerCoords(e);
  }

  function wakeFromPointer(bar, uiCfg, e, force) {
    const overBar = isPointerOverBar(bar, e);
    if (overBar) resetPointerLeave();
    else applyStagePointerCoords(e);
    if (!force && Math.abs(e.clientX - lastPtrX) < 1 && Math.abs(e.clientY - lastPtrY) < 1) return;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    if (overBar) showUiHold();
    else { inBar = false; flashUi(uiCfg.idleHideDelay); }
  }

  function isBarOverlayHidden(bar) {
    const b = document.body.classList;
    if (!(b.contains('ctrl-overlay') || b.contains('web-full') || b.contains('os-full'))) return false;
    if (!b.contains('playing')) return false;
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
      if (pt !== 'touch' && playing) pause();
    }, true);
  }

  function bindIdleWake(bar, uiCfg) {
    bindBlindBarGuard(bar, uiCfg);
    const clearOnLeave = () => {
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
    document.getElementById('viewport').addEventListener('click', e => {
      if (e.target.closest('[data-interactive]')) return;
      if (!playing && isInteractiveHold()) return;
      playing ? pause() : play();
    });
  }

  function syncPlayBtnUI() {
    if (!ui.play) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const state = playing ? 'playing' : (ended ? 'ended' : 'paused');
    const key = playing ? 'pause' : (ended ? 'replay' : 'play');
    const label = playing ? '暂停（空格）' : (ended ? '重播（空格）' : '播放（空格）');
    ui.play.dataset.state = state;
    ui.play.setAttribute('aria-pressed', String(playing));
    swapBtnIcon(ui.play, key, icons[key], label);
  }

  function syncSubsBtnUI() {
    if (!ui.subs) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const key = showSubs ? 'subsOn' : 'subsOff';
    ui.subs.classList.toggle('is-off', !showSubs);
    swapBtnIcon(ui.subs, key, icons[key], showSubs ? '关闭字幕' : '开启字幕');
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
      setOpenMenu(bar, bar.dataset.menu === 'sound' ? '' : 'sound');
    };
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

  function waitVideoMetadata(vid, timeoutMs = 2000) {
    return new Promise(resolve => {
      const done = ok => {
        clearTimeout(timer);
        vid.removeEventListener('loadedmetadata', onMeta);
        vid.removeEventListener('error', onErr);
        resolve(ok);
      };
      const onMeta = () => done(true);
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), timeoutMs);
      vid.addEventListener('loadedmetadata', onMeta, { once: true });
      vid.addEventListener('error', onErr, { once: true });
    });
  }

  async function seekVideoElementAsync(vid, targetSec) {
    if (vid.readyState === 0) {
      const ready = await waitVideoMetadata(vid, 2000);
      if (!ready || vid.readyState === 0) return;
    }
    if (Math.abs((vid.currentTime || 0) - targetSec) < 0.008 && !vid.seeking) return;
    await new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        vid.removeEventListener('seeked', done);
        vid.removeEventListener('error', done);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      vid.addEventListener('seeked', done, { once: true });
      vid.addEventListener('error', done, { once: true });
      try { vid.currentTime = targetSec; } catch { done(); }
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

  V.start = function () {
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
    applySavedPrefs(savedPrefs);

    audioRt = V._createAudioRuntime({
      params,
      isRecord: RECORD,
      isPlaying: () => playing,
      getNow: () => now,
      markSeekApplied: target => { lastSeekTarget = target; lastSeekAt = performance.now(); },
      onSoundUI: syncSoundMenuUI,
      onEnded: finishPlayback,
      onVisibilitySync: t => render(t, 0),
      onBgmUnavailable: syncSoundMenuUI,
    });
    audioRt.setRate(playbackRate);
    audioRt.initTracks(cfg, uiCfg, savedPrefs);

    V.seekTo = t => render(t, 0);
    V.seekToAsync = async t => { render(t, 0); await waitStageAssets(); };
    V.setSubs = setSubs;
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
      play, pause, replay, seek, setRate, setSubs,
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

    if (RECORD) document.body.classList.add('record');
    else buildUI(uiCfg);
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', () => { releaseBarHold(); fit(); });
    lastFrameTs = performance.now();
    ambientOffset = 0;
    idleSec = 0;
    const initPos = resolveInitialTime(uiCfg);
    if (initPos.t > 0) {
      seek(initPos.t);
      if (initPos.resumed) flashOsd(`已续播 ${fmtTime(initPos.t)}`, 1200);
    } else {
      render(0, 0);
    }
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

  function clearStaleVoiceIfNeeded() {
    if (V.voice && V.isVoiceLocaleMatch && !V.isVoiceLocaleMatch(V.voice)) {
      V.voice = null;
    }
  }

  function shouldProbeLocalePack(lang) {
    if (!lang || V.locales[lang]) return false;
    if (V.isSecondaryLocale && V.isSecondaryLocale(lang)) return true;
    const base = V.getBaseLang ? V.getBaseLang() : '';
    const explicit = Boolean(V.__activeLang || params.get('lang'));
    return explicit && Boolean(!base || lang.toLowerCase() !== base.toLowerCase());
  }

  async function ensureDynamicBootAssets() {
    const cfg = V.getCfg();
    if (V.scenes.length === 0 && Array.isArray(cfg.sceneScripts)) {
      for (const rel of cfg.sceneScripts) await loadOptionalScript(rel);
    }
    const lang = V.getActiveLang();
    if (shouldProbeLocalePack(lang)) await loadOptionalScript(`locales/${lang}.js`);
    if (!lang || (V.isSecondaryLocale && !V.isSecondaryLocale(lang))) return;
    const baseTimings = cfg.timingsScript || 'assets/voice/timings.js';
    const langTimings = baseTimings.replace(/\.js$/i, `.${lang}.js`);
    if (langTimings !== baseTimings) {
      const ok = await loadOptionalScript(langTimings);
      if (!ok) clearStaleVoiceIfNeeded();
    }
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
