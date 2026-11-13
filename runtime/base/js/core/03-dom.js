/* core/03-dom.js · 轻量 DOM/SVG 构造、运镜、仿真光标与确定性受控 <video> 切片原语 */
(function (V) {
  const { clamp, lerp, prog, ease, appear, keyframes } = V.u;

  function applyAttr(el, k, val) {
    if (k === 'class') el.className = val;
    else if (k === 'html') el.innerHTML = val;
    else if (k === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (k === 'style') el.style.cssText = val;
    else el.setAttribute(k, val);
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, val] of Object.entries(attrs)) {
        if (val != null && val !== false) applyAttr(el, k, val);
      }
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svg(markup, attrs = '') {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" ' + attrs + '>' + markup + '</svg>';
    return wrap.firstChild;
  }

  function formatScale(s, sx, sy) {
    if (sx === undefined && sy === undefined) return `scale(${s})`;
    return `scale(${sx === undefined ? s : sx},${sy === undefined ? s : sy})`;
  }

  function pickOpt(opts, shortKey, longKey, fallback) {
    if (opts[shortKey] !== undefined) return opts[shortKey];
    if (opts[longKey] !== undefined) return opts[longKey];
    return fallback;
  }

  function set(el, opts = {}) {
    if (!el) return;
    const o = pickOpt(opts, 'o', 'opacity', undefined);
    const s = pickOpt(opts, 's', 'scale', 1);
    const r = pickOpt(opts, 'r', 'rotate', 0);
    const { x = 0, y = 0, sx, sy, origin } = opts;
    if (o !== undefined) {
      el.style.opacity = o;
      el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    }
    el.style.transform = `translate(${x}px,${y}px) ${formatScale(s, sx, sy)} rotate(${r}deg)`;
    if (origin) el.style.transformOrigin = origin;
  }

  function pop(el, k, { dy = 24, s0 = 0.96 } = {}) {
    set(el, { o: k, y: (1 - k) * dy, s: lerp(s0, 1, k) });
  }

  function typeText(el, text, k) {
    if (!el) return false;
    const chars = Array.from(text);
    const n = Math.round(chars.length * clamp(k));
    const out = chars.slice(0, n).join('');
    if (el._typed !== out) { el.textContent = out; el._typed = out; }
    return n < chars.length;
  }

  function type(el, text, k, t = 0, cursorOn = false) {
    if (!el) return;
    const chars = Array.from(text);
    const n = Math.floor(chars.length * clamp(k));
    const showCur = cursorOn && (n < chars.length || Math.floor((t || 0) * 2.5) % 2 === 0);
    const out = chars.slice(0, n).join('') + (showCur ? '_' : '');
    if (el._ty !== out) { el.textContent = out; el._ty = out; }
  }

  const scramble = (el, text, k, t = 0) => type(el, text, k, t, false);

  function formatNumber(v, fmt) {
    if (typeof fmt === 'function') return fmt(v);
    if (typeof fmt === 'number') return v.toFixed(fmt);
    return String(Math.round(v));
  }

  function countUp(el, from, to, k, fmt) {
    if (!el) return;
    const out = formatNumber(lerp(from, to, clamp(k)), fmt);
    if (el._cu !== out) { el.textContent = out; el._cu = out; }
  }

  function drawPath(el, k) {
    if (!el) return;
    if (el._pathLen == null) {
      el._pathLen = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 1000;
      el.style.strokeDasharray = String(el._pathLen);
    }
    el.style.strokeDashoffset = String(el._pathLen * (1 - clamp(k)));
  }

  function toggle(el, cls, on) {
    if (el) el.classList.toggle(cls, Boolean(on));
  }

  function bindInteractiveEvent(el, type, fn) {
    if (typeof fn !== 'function') return;
    el.addEventListener(type, e => {
      if (type === 'click' || type === 'dblclick') e.stopPropagation();
      fn.call(el, e, el);
    });
  }

  function interactive(el, handlers) {
    if (!el) return el;
    if (el.setAttribute) el.setAttribute('data-interactive', '1');
    if (el.style && !el.style.pointerEvents) el.style.pointerEvents = 'auto';
    if (typeof handlers === 'function') {
      bindInteractiveEvent(el, 'click', handlers);
    } else if (handlers && typeof handlers === 'object') {
      for (const [k, fn] of Object.entries(handlers)) bindInteractiveEvent(el, k, fn);
    }
    return el;
  }

  function toIndexList(activeIdx) {
    if (Array.isArray(activeIdx)) return activeIdx;
    return activeIdx != null && activeIdx >= 0 ? [activeIdx] : null;
  }

  function spotlight(els, activeIdx, focusCls = 'is-focus', dimCls = 'is-dim') {
    if (!els) return;
    const fSet = toIndexList(activeIdx);
    els.forEach((el, i) => {
      toggle(el, focusCls, fSet ? fSet.includes(i) : false);
      toggle(el, dimCls, fSet ? !fSet.includes(i) : false);
    });
  }

  function initCameraState(opts, cx, cy) {
    return {
      x: opts.x0 === undefined ? cx : opts.x0,
      y: opts.y0 === undefined ? cy : opts.y0,
      zoom: opts.zoom0 === undefined ? 1 : opts.zoom0,
      r: opts.r0 || 0,
    };
  }

  function applyCameraDom(el, st, cx, cy) {
    if (!el || !el.style) return;
    el.style.transformOrigin = '0 0';
    const tx = (cx - st.x * st.zoom).toFixed(2);
    const ty = (cy - st.y * st.zoom).toFixed(2);
    const rot = st.r ? ` rotate(${st.r.toFixed(2)}deg)` : '';
    el.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${st.zoom.toFixed(4)})${rot}`;
  }

  function camera(el, t, stops = [], opts = {}) {
    const cx = opts.cx === undefined ? (V.stageWidth || 1920) / 2 : opts.cx;
    const cy = opts.cy === undefined ? (V.stageHeight || 1080) / 2 : opts.cy;
    const st = keyframes(t, stops, {
      init: initCameraState(opts, cx, cy),
      dur: opts.dur === undefined ? 0.55 : opts.dur,
      ease: 'io',
    });
    applyCameraDom(el, st, cx, cy);
    return st;
  }

  const CURSOR_SVG = '<path d="M4 3.5L21.5 11.5L13.2 14.1L9.8 22L4 3.5Z" fill="#1E293B" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>';

  function makeCursor(parent, opts = {}) {
    const ring = h('i', { class: 'v-cursor-ring' });
    const body = svg(opts.svg || CURSOR_SVG, 'class="v-cursor-body" viewBox="0 0 26 26"');
    const el = h('div', { class: 'v-cursor ' + (opts.cls || '') }, ring, body);
    el._body = body;
    el._ring = ring;
    if (parent && parent.append) parent.append(el);
    return el;
  }

  function applyCursorStep(state, st, t) {
    const dur = st.dur === undefined ? 0.42 : st.dur;
    const mk = dur <= 0 ? (t >= st.at ? 1 : 0) : ease.io(prog(t, st.at, st.at + dur));
    if (mk > 0) {
      if (st.x != null) state.x = lerp(state.x, st.x, mk);
      if (st.y != null) state.y = lerp(state.y, st.y, mk);
    }
    if (st.click) {
      const cAt = st.clickAt === undefined ? st.at + dur : st.clickAt;
      applyCursorClick(state, t, cAt);
    }
    if (st.hide) state.vis *= 1 - appear(t, st.at, st.dur === undefined ? 0.25 : st.dur);
  }

  function applyCursorClick(state, t, cAt) {
    if (t < cAt || t > cAt + 0.45) return;
    const pk = prog(t, cAt, cAt + 0.22);
    if (pk < 1) state.pressS = Math.min(state.pressS, 1 - 0.18 * Math.sin(Math.PI * pk));
    const rk = prog(t, cAt, cAt + 0.42);
    state.ringS = lerp(0.35, 2.15, ease.out(rk));
    state.ringO = Math.max(state.ringO, (1 - rk) * 0.85);
  }

  function cursor(el, t, steps = [], opts = {}) {
    if (!el || !steps.length) return { x: 0, y: 0, o: 0 };
    const s0 = steps[0];
    const st = {
      x: s0.x === undefined ? 960 : s0.x,
      y: s0.y === undefined ? 540 : s0.y,
      vis: appear(t, opts.enterAt === undefined ? s0.at || 0 : opts.enterAt, 0.22),
      pressS: 1,
      ringS: 0.3,
      ringO: 0,
    };
    if (opts.leaveAt != null) st.vis *= 1 - appear(t, opts.leaveAt, 0.25);
    for (let i = 1; i < steps.length; i++) {
      if (steps[i]) applyCursorStep(st, steps[i], t);
    }
    if (s0.click) applyCursorClick(st, t, s0.clickAt === undefined ? (s0.at || 0) + 0.25 : s0.clickAt);
    renderCursorDom(el, st);
    return { x: st.x, y: st.y, o: st.vis };
  }

  function renderCursorDom(el, st) {
    set(el, { o: st.vis, x: st.x, y: st.y, s: 1 });
    toggle(el, 'is-clicking', st.ringO > 0.01);
    const body = el._body;
    const ring = el._ring;
    if (body && body.style) body.style.transform = `scale(${st.pressS.toFixed(3)})`;
    if (ring && ring.style) {
      ring.style.opacity = String(st.ringO.toFixed(3));
      ring.style.transform = `scale(${st.ringS.toFixed(3)})`;
    }
  }

  // 受控嵌入式 <video> 切片原语：支持预览同步与录制态逐帧解码锁定
  function videoClip(src, opts = {}) {
    const el = h('video', {
      class: 'v-videoclip ' + (opts.cls || ''),
      src,
      preload: 'auto',
      muted: true,
      playsinline: 'true',
      style: opts.style || '',
    });
    el.muted = true;
    el._vclip = {
      src,
      start: opts.start || 0,
      trim: opts.trim || 0,
      speed: opts.speed || 1,
      loop: Boolean(opts.loop),
      volume: opts.volume || 0,
      targetTime: opts.trim || 0,
    };
    V._videoClips.add(el);
    return el;
  }

  function resolveClipPlaybackTarget(el, meta, lt) {
    const rawTarget = meta.trim + Math.max(0, (lt - meta.start) * meta.speed);
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    const endedClip = Boolean(dur && !meta.loop && rawTarget >= dur - 0.015);
    const target = dur && meta.loop ? (rawTarget % dur) : (dur ? Math.min(rawTarget, dur - 0.01) : rawTarget);
    return { target: Math.max(0, target), endedClip };
  }

  function syncVideoClip(el, lt, playing) {
    if (!el || !el._vclip) return;
    const meta = el._vclip;
    const usePlaying = playing === undefined ? Boolean(V._isPlaying) : Boolean(playing);
    meta._syncedTick = V._renderTick || 0;
    const { target, endedClip } = resolveClipPlaybackTarget(el, meta, lt);
    meta.targetTime = target;
    if (typeof el.pause !== 'function') return;
    syncBrowserVideoTime(el, meta, lt >= meta.start && !endedClip && usePlaying, endedClip);
  }

  function toggleBrowserVideoPlay(el, shouldPlay) {
    if (shouldPlay && !V._isRecord) {
      if (!el.paused) return;
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }
    if (!el.paused) el.pause();
  }

  function syncBrowserVideoTime(el, meta, shouldPlay, endedClip) {
    const tol = endedClip ? 0.05 : 0.16;
    const diff = Math.abs((el.currentTime || 0) - meta.targetTime);
    if (diff > tol && el.readyState >= 1) {
      try { el.currentTime = meta.targetTime; } catch {}
    }
    el.playbackRate = meta.speed * (V._playbackRate || 1);
    toggleBrowserVideoPlay(el, shouldPlay);
  }

  V.u = Object.assign(V.u || {}, {
    h, svg, set, pop, typeText, type, scramble, countUp,
    drawPath, toggle, interactive, spotlight, camera, makeCursor, cursor,
    videoClip, syncVideoClip,
  });
})(globalThis.V = globalThis.V || {});
