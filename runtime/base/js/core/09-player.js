/* core/09-player.js · 舞台挂载、可插拔控制栏、音频主时钟、异步媒资锁帧与 V.boot 启动器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, prog, appear, h, svg, toggle, syncVideoClip } = V.u;

  const CTRL_ICONS = {
    webEnter: ['M2.25 2.75h11.5a.75.75 0 0 1 .75.75v9a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75v-9a.75.75 0 0 1 .75-.75z', 'M4.75 7.25V5.25h2', 'M11.25 8.75v2h-2'],
    webExit: ['M2.25 2.75h11.5a.75.75 0 0 1 .75.75v9a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75v-9a.75.75 0 0 1 .75-.75z', 'M6.75 5.25v2h-2', 'M9.25 10.75v-2h2'],
    fullEnter: ['M2.5 6V2.5H6', 'M10 2.5h3.5V6', 'M13.5 10v3.5H10', 'M6 13.5H2.5V10'],
    fullExit: ['M6 2.5V6H2.5', 'M10 2.5V6h3.5', 'M13.5 10H10v3.5', 'M2.5 10H6v3.5'],
  };
  const RATE_STEPS = [1, 1.25, 1.5, 2, 0.75];

  const params = new URLSearchParams(location.search);
  const RECORD = params.has('record') || params.has('capture');
  const DEV = params.has('dev') && !RECORD;
  V._isRecord = RECORD;

  let audio = null, stage = null, subs = null, subSpeaker = null, subText = null;
  let current = null, now = 0, prevRenderNow = 0, playing = false, lastTs = 0;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false, muted = false;
  let scrubbing = false, targetSeekTime = null, lastSeekTarget = -1, lastSeekAt = 0;
  let audioBlocked = false, playPending = false, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null;
  let wipeState = { name: '', handler: null, dom: null };
  const ui = {};

  function makeCtrlIcon(paths) {
    return svg(
      paths.map(d => `<path d="${d}"/>`).join(''),
      'class="ctrl-ico" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
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

  V.mountStage = function () {
    const cfg = V.getCfg();
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    if (document.getElementById('stage')) return;

    const vp = h('div', { id: 'viewport' },
      h('div', { id: 'stage' },
        h('canvas', { id: 'gl', width: String(W), height: String(H), class: V.gl ? '' : 'is-off' }),
        h('div', { id: 'hud', class: cfg.hud === false ? 'is-off' : '' }, h('div', { class: 'hud-track' }, h('i', { class: 'hud-bar' }))),
        h('div', { id: 'subs' }, h('span', { class: 'sub-speaker' }), h('p', { class: 'sub-text' }, h('span', { class: 'ghost' }), h('span'))),
        h('div', { id: 'checkpoint-overlay' }),
        h('div', { id: 'wipe' }),
        h('div', { id: 'safe-guide' }, h('div', { class: 'safe-action' }), h('div', { class: 'safe-sub' }, 'SUBTITLE SAFE ZONE'))),
      h('div', { id: 'start-hint' }, cfg.startHint || '▶ 点击画面开始播放'));

    const homeLink = cfg.homeUrl === false ? null : h('a', { class: 'ctrl-home', href: cfg.homeUrl || '../', title: '返回视频中心主界面' }, cfg.homeLabel || '⌂ 主界面');
    const ctrls = h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { 'data-act': 'play', title: '播放 / 暂停（空格）' }, '▶'),
      ...renderCustomControls('left'),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: '切换章节' }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, '▲')),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, '章节导航 · CHAPTERS'), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right'),
      h('button', { 'data-act': 'rate', title: '切换播放倍速' }, '1.0x'),
      h('button', { 'data-act': 'subs', title: '字幕' }, '字幕'),
      h('button', { 'data-act': 'mute', title: '声音' }, '声音'),
      h('button', { 'data-act': 'webfull', title: '窗口全屏（W）' }, makeCtrlIcon(CTRL_ICONS.webEnter), h('span', { class: 'ctrl-txt' }, '窗口')),
      h('button', { 'data-act': 'full', title: '全屏（F）' }, makeCtrlIcon(CTRL_ICONS.fullEnter), h('span', { class: 'ctrl-txt' }, '全屏')));

    document.body.prepend(vp, ctrls);
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

  function updateSubs(sc, lt) {
    const list = sc.subCues && sc.subCues.length ? sc.subCues : sc.cues;
    let cue = null;
    activeCueIdx = -1;
    sc.cues.forEach((c, i) => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) activeCueIdx = i; });
    list.forEach(c => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) cue = c; });
    subs.style.visibility = cue && showSubs ? 'visible' : 'hidden';
    if (!cue) return;
    const a = Math.min(appear(lt, cue.start - 0.04, 0.14), 1 - prog(lt, cue.end, cue.end + 0.12));
    subs.style.opacity = String(clamp(a));
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

  function syncSceneVideoClips(lt) {
    for (const clip of V._videoClips) {
      if (clip.isConnected) syncVideoClip(clip, lt, playing && !scrubbing);
    }
  }

  function render(t) {
    if (!V.scenes.length) return;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    prevRenderNow = now;
    V._now = now;
    const sc = sceneAt(now);
    if (sc !== current) enter(sc);
    const lt = now - sc.start;
    const idx = V.scenes.indexOf(sc);

    runTransition();
    if (V.gl && V.gl.ready) V.gl.render(now);
    updateHud();
    stage.style.setProperty('--tg', ((now % 6) / 6) * 150);
    document.body.classList.toggle('started', now > 0.05);
    sc.update(lt, sc.ctx);
    syncSceneVideoClips(lt);
    updateSubs(sc, lt);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: RECORD, playing, scrubbing, pause, play });
    V.emit('onRender', { now, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx, playing, scrubbing, hasAudio: Boolean(audio), isRecord: RECORD, muted });
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

  function advanceAudioClock(ts) {
    lastTs = ts;
    if (targetSeekTime == null && !audio.paused && !audio.seeking && audio.readyState >= 2) {
      if (checkSceneLoop(audio.currentTime)) return;
      if (audio.ended || audio.currentTime >= V.duration - 0.01) { render(V.duration - 0.001); pause(); }
      else render(audio.currentTime);
      return;
    }
    if (audio.paused && audio.readyState >= 1 && !audio.seeking) safePlayAudio();
    if (current && current.live) render(now);
  }

  function advanceWallClock(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (now + dt >= V.duration - 0.002) { render(V.duration - 0.001); pause(); }
    else render(now + dt);
  }

  function canSyncAudioWhileScrubbing() {
    if (!playing || !audio) return false;
    return !audio.paused && !audio.seeking && audio.readyState >= 2 && targetSeekTime == null;
  }

  function frame(ts) {
    if (scrubbing) {
      lastTs = ts;
      if (canSyncAudioWhileScrubbing()) render(audio.currentTime);
      else if (current && current.live) render(now);
    } else if (playing) {
      if (audio && !audioBlocked) advanceAudioClock(ts);
      else advanceWallClock(ts);
    } else if (current && current.live) {
      render(now);
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

  function setMenuOpen(bar, open) {
    bar.classList.toggle('menu-open', open);
    document.body.classList.toggle('menu-open', open);
  }

  function play() {
    if (now >= V.duration - 0.01) { V.resetCheckpoints(); seek(0); }
    V._checkpointsRuntime.closeCheckpointOverlay();
    const bar = document.getElementById('controls');
    if (bar) setMenuOpen(bar, false);
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
    document.body.classList.remove('playing');
    if (audio) audio.pause();
    for (const clip of V._videoClips) if (clip.pause) clip.pause();
    if (!RECORD) updateUI();
  }

  function fmtRate(r) { return Number.isInteger(r) ? `${r}.0x` : `${r}x`; }

  function setRate(rate) {
    playbackRate = clamp(Number(rate) || 1, 0.25, 4);
    V._playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
    if (ui.rate) {
      ui.rate.textContent = fmtRate(playbackRate);
      ui.rate.classList.toggle('on', Math.abs(playbackRate - 1) > 0.01);
    }
    V.emit('onRateChange', playbackRate);
  }

  function seek(t) {
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (Math.abs(target - lastSeekTarget) < 0.015 && ts - lastSeekAt < 600) return;
    lastTs = ts;
    lastSeekTarget = target;
    lastSeekAt = ts;
    render(target);
    V.emit('onSeek', target);
    if (!audio) return;
    if (audio.readyState >= 1) {
      try { audio.currentTime = now; targetSeekTime = null; } catch { targetSeekTime = now; }
    } else {
      targetSeekTime = now;
    }
  }

  const fmtTime = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function buildChapters(bar) {
    const list = bar.querySelector('.chap-list'), wrap = bar.querySelector('.chap-wrap'), trig = bar.querySelector('.chap-trigger');
    ui.chapLabel = bar.querySelector('.chap-cur-txt');
    if (!list || !wrap || !trig) return;
    list.innerHTML = '';
    ui.chapItems = V.scenes.map((sc, i) => {
      const item = h('div', { class: 'chap-item' }, h('em', null, String(i + 1).padStart(2, '0')), h('span', { class: 'chap-it-title' }, sc.title), h('small', null, fmtTime(sc.start)));
      item.onclick = e => { e.stopPropagation(); setMenuOpen(bar, false); seek(sc.start + 0.02); };
      list.appendChild(item);
      return item;
    });
    trig.onclick = e => { e.stopPropagation(); setMenuOpen(bar, !bar.classList.contains('menu-open')); };
    addEventListener('pointerdown', e => { if (!wrap.contains(e.target)) setMenuOpen(bar, false); });
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

  function setBtnLabelIcon(btn, iconPaths, text, title, active) {
    if (!btn) return;
    btn.classList.toggle('on', active);
    btn.title = title;
    const oldSvg = btn.querySelector('svg');
    if (oldSvg) oldSvg.replaceWith(makeCtrlIcon(iconPaths));
    const txt = btn.querySelector('.ctrl-txt');
    if (txt) txt.textContent = text;
  }

  function syncFullUI() {
    const osOn = isOsFull();
    document.body.classList.toggle('os-full', osOn);
    document.body.classList.toggle('web-full', webFull);
    setBtnLabelIcon(ui.webfull, webFull ? CTRL_ICONS.webExit : CTRL_ICONS.webEnter, webFull ? '退出' : '窗口', webFull ? '退出窗口全屏（W / Esc）' : '窗口全屏（W）', webFull);
    setBtnLabelIcon(ui.full, osOn ? CTRL_ICONS.fullExit : CTRL_ICONS.fullEnter, osOn ? '还原' : '全屏', osOn ? '退出全屏（F / Esc）' : '全屏（F）', osOn);
    fit();
  }

  function setWebFull(on) {
    webFull = Boolean(on);
    syncParentFrameFull(webFull);
    syncFullUI();
    try { window.parent.postMessage({ type: 'video:webfull', active: webFull }, '*'); } catch {}
  }

  function toggleOsFull() {
    if (isOsFull()) {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
      return;
    }
    const req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!req) { setWebFull(!webFull); return; }
    const p = req.call(document.documentElement);
    if (p && p.catch) p.catch(() => setWebFull(true));
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

  function handleEscapeKey(bar) {
    if (bar.classList.contains('menu-open')) setMenuOpen(bar, false);
    else if (!isOsFull() && webFull) setWebFull(false);
  }

  function bindKeyboard(bar) {
    const keyMap = {
      '.': () => { pause(); seek(now + 1 / 30); },
      ',': () => { pause(); seek(now - 1 / 30); },
      ']': () => jumpChapterDelta(1),
      PageDown: () => jumpChapterDelta(1),
      '[': () => jumpChapterDelta(-1),
      PageUp: () => jumpChapterDelta(-1),
      w: () => setWebFull(!webFull),
      W: () => setWebFull(!webFull),
      f: toggleOsFull,
      F: toggleOsFull,
      Escape: () => handleEscapeKey(bar),
    };
    addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); return; }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const dir = e.code === 'ArrowRight' ? 1 : -1;
        seek(now + dir * (e.shiftKey ? 1 : 5));
        return;
      }
      if (keyMap[e.key]) keyMap[e.key]();
    });
  }

  function buildUI() {
    const bar = document.getElementById('controls');
    ui.play = bar.querySelector('[data-act=play]');
    ui.fill = bar.querySelector('.fill');
    ui.thumb = bar.querySelector('.thumb');
    ui.time = bar.querySelector('.time');
    ui.rate = bar.querySelector('[data-act=rate]');
    ui.mute = bar.querySelector('[data-act=mute]');
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');

    ui.play.onclick = () => (playing ? pause() : play());
    bindScrubber(bar.querySelector('.track'));
    buildChapters(bar);
    ui.rate.onclick = () => {
      const idx = RATE_STEPS.findIndex(r => Math.abs(r - playbackRate) < 0.01);
      setRate(RATE_STEPS[(idx + 1) % RATE_STEPS.length]);
    };
    bar.querySelector('[data-act=subs]').onclick = e => {
      showSubs = !showSubs;
      document.body.classList.toggle('nosubs', !showSubs);
      e.currentTarget.classList.toggle('on', showSubs);
      render(now);
    };
    ui.mute.onclick = e => {
      muted = !muted;
      if (audio) audio.muted = muted;
      e.currentTarget.classList.toggle('on', !muted);
    };
    ui.mute.classList.toggle('on', Boolean(audio) && !muted);
    ui.webfull.onclick = () => setWebFull(!webFull);
    ui.full.onclick = toggleOsFull;
    document.addEventListener('fullscreenchange', syncFullUI);
    document.addEventListener('webkitfullscreenchange', syncFullUI);
    bar.querySelector('[data-act=subs]').classList.toggle('on', showSubs);
    bindKeyboard(bar);

    let idle;
    const wakeUi = () => {
      document.body.classList.add('ui-active');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.remove('ui-active'), 2500);
    };
    addEventListener('pointermove', wakeUi);
    addEventListener('pointerdown', wakeUi);
    document.getElementById('viewport').addEventListener('click', e => {
      if (!e.target.closest('[data-interactive]')) (playing ? pause() : play());
    });
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
    el.addEventListener('ended', () => { if (playing && targetSeekTime == null) { render(V.duration - 0.001); pause(); } });
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
      seek: t => (RECORD ? render(t) : seek(t)),
      seekVisual: t => render(t),
      seekAsync: V.seekToAsync,
      setRate,
      play,
      pause,
      resume: V.resume,
      getSyncState: () => ({
        now,
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
    if (cfg.title) document.title = cfg.title;
    stage = document.getElementById('stage');
    subs = document.getElementById('subs');
    subSpeaker = subs.querySelector('.sub-speaker');
    subText = subs.querySelector('.sub-text');
    V.layout();
    V._layersRuntime.mountLayers(stage, subs);

    const audioSrc = resolveAudioSource(cfg);
    if (audioSrc) audio = initAudio(audioSrc);

    V.seekTo = t => render(t);
    V.seekToAsync = async t => { render(t); await waitStageAssets(); };
    V._playerCtl = { play, pause, seek, setRate, getRate: () => playbackRate, toggleLoopScene: () => (loopScene = !loopScene), isDev: DEV, isRecord: RECORD };

    if (RECORD) document.body.classList.add('record');
    else buildUI();
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', fit);
    const t0 = resolveInitialTime();
    if (t0 > 0) seek(t0);
    else render(0);
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
    }
    V.start();
  };
})(globalThis.V = globalThis.V || {});
