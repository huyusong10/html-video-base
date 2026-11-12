/* HTML Video Base v2.0 · Microkernel Runtime (Auto-assembled from runtime/base/js/core/*.js) */

/* core/01-registry.js · 微内核注册表与开放扩展契约（Plugin / Transition / Control / Preset / Layer / Locale） */
(function (V) {
  V.scenes = V.scenes || [];
  V.layers = V.layers || [];
  V.plugins = V.plugins || [];
  V.transitions = V.transitions || {};
  V.controls = V.controls || [];
  V.presets = V.presets || {};
  V.locales = V.locales || {};
  V.subtitles = V.subtitles || {};
  V.config = V.config || {};
  V.c = V.c || {};
  V.checkpointState = V.checkpointState || {};
  V._videoClips = V._videoClips || new Set();

  function upsertById(list, item) {
    if (!item.id) { list.push(item); return item; }
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    return item;
  }

  V.scene = function (def) {
    if (def) V.scenes.push(def);
    return def;
  };

  V.use = function (plugin) {
    if (!plugin) return V;
    const obj = typeof plugin === 'function' ? { setup: plugin } : plugin;
    upsertById(V.plugins, obj);
    const initFn = obj.setup || obj.install;
    if (typeof initFn === 'function') initFn.call(obj, V);
    return V;
  };

  V.transition = function (name, handler) {
    if (!name || !handler) return V;
    V.transitions[name] = typeof handler === 'function'
      ? { mount: box => ({ box }), update: handler }
      : handler;
    return V;
  };

  V.control = function (def) {
    if (def) upsertById(V.controls, def);
    return V;
  };

  V.layer = function (def) {
    if (def && def.id) upsertById(V.layers, def);
    return def;
  };

  V.locale = function (lang, dict) {
    if (lang && dict) V.locales[lang] = dict;
    return V;
  };

  V.subtitle = function (def) {
    if (def) Object.assign(V.subtitles, def);
    return V;
  };

  V.preset = function (def, fn) {
    if (typeof def === 'string' && typeof fn === 'function') {
      V.c[def] = fn;
      return V;
    }
    if (!def || !def.name) return V;
    V.presets[def.name] = def;
    if (def.auto) V.activatePreset(def.name);
    return V;
  };

  function injectStylesheet(href) {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.querySelector(`link[data-preset-css="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-preset-css', href);
    document.head.appendChild(link);
  }

  function applyTokens(tokens) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const style = document.documentElement.style;
    for (const [k, val] of Object.entries(tokens)) {
      style.setProperty(k.startsWith('--') ? k : `--${k}`, String(val));
    }
  }

  V.activatePreset = function (name) {
    const p = V.presets[name];
    if (!p || p._applied) return;
    p._applied = true;
    if (p.defaults) V.themeDefaults = Object.assign({}, V.themeDefaults || {}, p.defaults);
    if (p.tokens) applyTokens(p.tokens);
    if (Array.isArray(p.stylesheets)) p.stylesheets.forEach(injectStylesheet);
    if (p.transitions) Object.entries(p.transitions).forEach(([k, fn]) => V.transition(k, fn));
    if (Array.isArray(p.layers)) p.layers.forEach(l => V.layer(l));
    if (p.subtitles) V.subtitle(p.subtitles);
    if (p.components) Object.assign(V.c, typeof p.components === 'function' ? p.components(V) : p.components);
    if (typeof p.setup === 'function') p.setup(V);
  };

  V.applyConfiguredPresets = function () {
    const list = V.config && V.config.presets;
    if (Array.isArray(list)) list.forEach(name => V.activatePreset(name));
  };

  V.emit = function (hook, payload) {
    for (const p of V.plugins) {
      if (typeof p[hook] === 'function') p[hook](payload, V);
    }
  };

  V.getActiveLang = function () {
    if (V.__activeLang) return V.__activeLang;
    if (typeof location !== 'undefined' && location.search) {
      const q = new URLSearchParams(location.search).get('lang');
      if (q) return q;
    }
    return (V.config && V.config.lang) || '';
  };

  V.getCfg = function () {
    V.applyConfiguredPresets();
    const lang = V.getActiveLang();
    const loc = (lang && V.locales[lang]) || null;
    const locCfg = Object.assign({}, (loc && loc.config) || {});
    if (loc && loc.title && !locCfg.title) locCfg.title = loc.title;
    return Object.assign({}, V.themeDefaults || {}, V.config || {}, locCfg);
  };
})(globalThis.V = globalThis.V || {});

/* core/02-math.js · 纯函数插值、缓动与时间窗口数学原语 */
(function (V) {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));

  const ease = {
    out: k => 1 - Math.pow(1 - k, 3),
    in: k => k * k * k,
    io: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    back: k => {
      const c = 1.6;
      return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
    },
  };

  const appear = (t, a, d = 0.45) => ease.out(prog(t, a, a + d));
  const win = (t, a, b, d = 0.35) => Math.min(appear(t, a, d), 1 - ease.in(prog(t, b, b + d)));

  function stagger(count, index, t, start, span = 0.6, dur = 0.4) {
    const step = count > 1 ? span / (count - 1) : 0;
    return appear(t, start + index * step, dur);
  }

  V.u = Object.assign(V.u || {}, { clamp, lerp, prog, ease, appear, win, stagger });
})(globalThis.V = globalThis.V || {});

/* core/03-dom.js · 轻量 DOM/SVG 构造、运镜、仿真光标与确定性受控 <video> 切片原语 */
(function (V) {
  const { clamp, lerp, prog, ease, appear } = V.u;

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

  function set(el, opts = {}) {
    if (!el) return;
    const { o, x = 0, y = 0, s = 1, r = 0, sx, sy, origin } = opts;
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

  function stepCameraKeyframe(state, kf, t, defaultDur) {
    const d = kf.dur === undefined ? defaultDur : kf.dur;
    const rawK = d <= 0 ? (t >= kf.at ? 1 : 0) : prog(t, kf.at, kf.at + d);
    if (rawK <= 0) return;
    const fn = (kf.ease && ease[kf.ease]) || ease.io;
    const k = fn(rawK);
    if (kf.x != null) state.x = lerp(state.x, kf.x, k);
    if (kf.y != null) state.y = lerp(state.y, kf.y, k);
    if (kf.zoom != null) state.zoom = lerp(state.zoom, kf.zoom, k);
    if (kf.r != null) state.r = lerp(state.r, kf.r, k);
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

  function camera(el, t, keyframes = [], opts = {}) {
    const cx = opts.cx === undefined ? (V.stageWidth || 1920) / 2 : opts.cx;
    const cy = opts.cy === undefined ? (V.stageHeight || 1080) / 2 : opts.cy;
    const st = initCameraState(opts, cx, cy);
    const defaultDur = opts.dur === undefined ? 0.55 : opts.dur;
    for (const kf of keyframes) {
      if (kf && kf.at != null) stepCameraKeyframe(st, kf, t, defaultDur);
    }
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

  function syncVideoClip(el, lt, playing = false) {
    if (!el || !el._vclip) return;
    const meta = el._vclip;
    const rel = (lt - meta.start) * meta.speed;
    const rawTarget = meta.trim + Math.max(0, rel);
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    const target = dur && meta.loop ? (rawTarget % dur) : (dur ? Math.min(rawTarget, dur - 0.01) : rawTarget);
    meta.targetTime = Math.max(0, target);
    if (typeof el.pause !== 'function') return;
    syncBrowserVideoTime(el, meta, lt >= meta.start && playing);
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

  function syncBrowserVideoTime(el, meta, shouldPlay) {
    const diff = Math.abs((el.currentTime || 0) - meta.targetTime);
    if (diff > 0.16 && el.readyState >= 1) {
      try { el.currentTime = meta.targetTime; } catch {}
    }
    el.playbackRate = meta.speed * (V._playbackRate || 1);
    toggleBrowserVideoPlay(el, shouldPlay);
  }

  V.u = Object.assign(V.u || {}, {
    h, svg, set, pop, typeText, type, scramble, countUp,
    drawPath, toggle, spotlight, camera, makeCursor, cursor,
    videoClip, syncVideoClip,
  });
})(globalThis.V = globalThis.V || {});

/* core/04-timeline.js · 时间轴排布、句内语义词锚 (x.at)、多语言覆盖与 30Hz 语音振幅包络采样 */
(function (V) {
  const { clamp } = V.u;
  const DEFAULT_CPS = 5.4, DEFAULT_GAP = 0.22, DEFAULT_LEAD = 0.35, DEFAULT_TAIL = 0.38;

  function getPacing() {
    const cfg = V.getCfg();
    return {
      CPS: cfg.cps === undefined ? DEFAULT_CPS : cfg.cps,
      GAP: cfg.gap === undefined ? DEFAULT_GAP : cfg.gap,
      LEAD: cfg.lead === undefined ? DEFAULT_LEAD : cfg.lead,
      TAIL: cfg.tail === undefined ? DEFAULT_TAIL : cfg.tail,
    };
  }

  function weight(s) {
    const str = String(s || '');
    const words = str.match(/[A-Za-z0-9][A-Za-z0-9.\-]*/g) || [];
    let w = words.length * 1.5;
    const rest = str.replace(/[A-Za-z0-9][A-Za-z0-9.\-]*/g, '').replace(/\s/g, '');
    for (const ch of rest) {
      w += /[，。、：；！？“”‘’（）《》—…,!?:;"'()]/.test(ch) ? 0.45 : 1;
    }
    return w;
  }

  function normKey(s) {
    return String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
  }

  function findNth(haystack, needle, nth = 1) {
    if (!needle) return -1;
    let idx = -1, from = 0;
    for (let i = 0; i < nth; i++) {
      idx = haystack.indexOf(needle, from);
      if (idx < 0) return -1;
      from = idx + Math.max(1, needle.length);
    }
    return idx;
  }

  function recordAnchorError(entry) {
    if (!Array.isArray(V.__anchorErrors)) return;
    const key = `${entry.scene}|${entry.lineIdx}|${entry.keyword}|${entry.reason}`;
    if (!V.__anchorErrorKeys) V.__anchorErrorKeys = new Set();
    if (V.__anchorErrorKeys.has(key)) return;
    V.__anchorErrorKeys.add(key);
    V.__anchorErrors.push(entry);
  }

  function parseAnchorOpts(optsOrOffset) {
    if (typeof optsOrOffset === 'number') return { nth: 1, offset: optsOrOffset };
    if (!optsOrOffset) return { nth: 1, offset: 0 };
    return { nth: optsOrOffset.nth || 1, offset: optsOrOffset.offset || 0 };
  }

  function matchWordBoundary(words, needle, nth) {
    let acc = '';
    const spans = words.map(([t0, w]) => {
      const s = acc.length;
      acc += normKey(w);
      return { t0, s, e: acc.length };
    });
    const pos = findNth(acc, needle, nth);
    if (pos < 0) return null;
    const hit = spans.find(sp => sp.e > pos) || spans[0];
    return hit ? hit.t0 : null;
  }

  function estimateCharAnchor(rawText, needle, nth, dur) {
    let charAcc = '';
    const charMap = [];
    for (let i = 0; i < rawText.length; i++) {
      const k = normKey(rawText[i]);
      if (!k) continue;
      for (let j = 0; j < k.length; j++) charMap.push(i);
      charAcc += k;
    }
    const pos = findNth(charAcc, needle, nth);
    if (pos < 0) return null;
    const rawIdx = charMap[pos] || 0;
    const ratio = weight(rawText.slice(0, rawIdx)) / Math.max(1, weight(rawText));
    return ratio * dur;
  }

  function resolveLocalizedKeyword(sc, lineIdx, keyword) {
    const ln = sc.lines && sc.lines[lineIdx];
    const map = ln && ln.anchors;
    return (map && map[keyword]) || keyword;
  }

  function lookupLineWords(si, lineIdx) {
    const w = V.voice && V.voice.words;
    return (w && w[si] && w[si][lineIdx]) || null;
  }

  function warnBrokenAnchor(si, sc, lineIdx, keyword, text) {
    const msg = `Broken anchor keyword "${keyword}" not found in line: "${text}"`;
    recordAnchorError({ scene: si, title: sc.title, lineIdx, keyword: String(keyword), reason: msg });
    if (typeof console !== 'undefined' && console.warn) console.warn(`[V.at] S${si}L${lineIdx}: ${msg}`);
  }

  function resolveAnchor(sc, si, lineIdx, keyword, optsOrOffset) {
    const cue = sc.cues[lineIdx];
    if (!cue) {
      recordAnchorError({ scene: si, title: sc.title, lineIdx, keyword: String(keyword || ''), reason: `Line index ${lineIdx} out of range (lines=${sc.cues.length})` });
      return 0;
    }
    const { nth, offset } = parseAnchorOpts(optsOrOffset);
    const needle = normKey(resolveLocalizedKeyword(sc, lineIdx, keyword));
    if (!needle) return Math.max(0, cue.start + offset);

    const words = lookupLineWords(si, lineIdx);
    const wb = words && words.length ? matchWordBoundary(words, needle, nth) : null;
    if (wb != null) return Math.max(0, cue.start + wb + offset);

    const est = estimateCharAnchor(cue.text || '', needle, nth, cue.end - cue.start);
    if (est == null) {
      warnBrokenAnchor(si, sc, lineIdx, keyword, cue.text || '');
      return Math.max(0, cue.start + offset);
    }
    return Math.max(0, cue.start + est + offset);
  }

  function makeCtx(sc, si) {
    return {
      cue: i => (sc.cues[i] ? sc.cues[i].start : 0),
      end: i => (sc.cues[i] ? sc.cues[i].end : sc.duration),
      at: (i, kw, opts) => resolveAnchor(sc, si, i, kw, opts),
      dur: sc.duration,
      holdStart: () => (sc.cues.length ? sc.cues[sc.cues.length - 1].end + 0.3 : 0.3),
    };
  }

  function chunkSentences(raw) {
    const parts = raw.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) || [raw];
    const chunks = [];
    for (const s of parts) {
      const clean = s.trim();
      if (!clean) continue;
      if (clean.length <= 28) { chunks.push(clean); continue; }
      const subs = clean.split(/(?<=[，、：,:])\s*/);
      let buf = '';
      for (const sub of subs) {
        if ((buf + sub).length > 28 && buf) { chunks.push(buf); buf = sub; }
        else buf += sub;
      }
      if (buf) chunks.push(buf);
    }
    return chunks.map(c => c.replace(/[。！？；，、：.!?;,:""''\s]+$/g, '')).filter(Boolean);
  }

  function mapWordsToChunks(chunks, words, cueStart, cueEnd) {
    let flat = '';
    const charTime = [];
    for (const [t0, w] of words) {
      const k = normKey(w);
      for (let i = 0; i < k.length; i++) charTime.push(t0);
      flat += k;
    }
    let searchFrom = 0;
    const starts = chunks.map((c, idx) => {
      if (idx === 0) return 0;
      const key = normKey(c);
      const pos = key ? flat.indexOf(key, searchFrom) : -1;
      if (pos >= 0) { searchFrom = pos + key.length; return charTime[pos]; }
      return null;
    });
    return chunks.map((text, i) => {
      const s = starts[i] != null ? cueStart + starts[i] : (i === 0 ? cueStart : cueStart + (cueEnd - cueStart) * (i / chunks.length));
      const e = (i + 1 < chunks.length && starts[i + 1] != null) ? cueStart + starts[i + 1] : cueEnd;
      return { start: s, end: Math.max(s + 0.25, e), text };
    });
  }

  function splitSubCues(text, cueStart, cueEnd, words) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const chunks = chunkSentences(raw);
    if (chunks.length <= 1) {
      return [{ start: cueStart, end: cueEnd, text: chunks[0] || raw }];
    }
    if (words && words.length) return mapWordsToChunks(chunks, words, cueStart, cueEnd);
    const total = chunks.reduce((a, c) => a + weight(c), 0) || 1;
    const span = cueEnd - cueStart;
    let cur = cueStart;
    return chunks.map((c, idx) => {
      const d = idx === chunks.length - 1 ? cueEnd - cur : span * (weight(c) / total);
      const item = { start: cur, end: cur + d, text: c };
      cur += d;
      return item;
    });
  }

  function getSceneLocaleOverride(sc, si) {
    const lang = V.getActiveLang();
    const scenes = lang && V.locales[lang] && V.locales[lang].scenes;
    if (!scenes) return null;
    return (sc.id && scenes[sc.id]) || scenes[si] || null;
  }

  function applyLocaleLine(lineObj, scLoc, li) {
    if (!scLoc) return lineObj;
    const rawOv = Array.isArray(scLoc) ? scLoc[li] : (scLoc.lines && scLoc.lines[li]);
    if (!rawOv && !scLoc.anchors) return lineObj;
    const patch = typeof rawOv === 'string' ? { text: rawOv } : (rawOv || {});
    const mergedAnchors = Object.assign({}, lineObj.anchors || {}, scLoc.anchors || {}, patch.anchors || {});
    return Object.assign({}, lineObj, patch, { anchors: mergedAnchors });
  }

  function buildCueEntry(lineObj, cueStart, cueEnd) {
    return {
      start: cueStart,
      end: cueEnd,
      text: lineObj.text,
      speaker: lineObj.speaker || null,
      voice: lineObj.voice,
      speed: lineObj.speed,
      pitch: lineObj.pitch,
      model: lineObj.model,
      provider: lineObj.provider,
      style: lineObj.style,
      instructions: lineObj.instructions,
    };
  }

  function resolveSceneDuration(sc, bSc, lt, TAIL) {
    if (bSc) return bSc.duration;
    if (sc.lines.length === 0 && sc._explicitDuration != null) return sc._explicitDuration;
    const hold = sc.lines.length === 0 ? (sc.hold === undefined ? 3.0 : sc.hold) : (sc.hold || 0);
    return lt + hold + TAIL;
  }

  function isBakedValid(baked) {
    if (!baked || V.__ignoreBakedLayout) return false;
    if (!Array.isArray(baked.scenes) || baked.scenes.length !== V.scenes.length) return false;
    return V.scenes.every((sc, idx) => {
      const bs = baked.scenes[idx];
      return bs && Array.isArray(bs.cues) && bs.cues.length === (sc.lines ? sc.lines.length : 0);
    });
  }

  function resolveCueTiming(bSc, voiceDurs, si, li, lineObj, lt, CPS) {
    const bCue = bSc ? bSc.cues[li] : null;
    if (bCue) return [bCue[0], bCue[1]];
    const vDur = voiceDurs[si] && voiceDurs[si][li];
    const d = vDur || lineObj.dur || Math.max(1.2, weight(lineObj.text) / CPS);
    return [lt, lt + d];
  }

  function appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords) {
    const speaker = lineObj.speaker || null;
    if (exactSubs && exactSubs.length) {
      sc.subCues.push(...exactSubs.map(([s0, s1, txt]) => ({ start: cueStart + s0, end: cueStart + s1, text: txt, speaker })));
    } else {
      sc.subCues.push(...splitSubCues(lineObj.text, cueStart, cueEnd, lineWords).map(s => ({ ...s, speaker })));
    }
  }

  function layoutScene(sc, si, t, bSc, voiceInfo, pacing) {
    if (sc._origTitle === undefined) sc._origTitle = sc.title;
    if (!sc._origLines) sc._origLines = sc.lines.slice();
    const scLoc = getSceneLocaleOverride(sc, si);
    sc.title = (scLoc && scLoc.title) || sc._origTitle;
    sc.start = bSc ? bSc.start : t;
    let lt = sc.lead === undefined ? pacing.LEAD : sc.lead;
    sc.cues = [];
    sc.subCues = [];

    sc._origLines.forEach((ln, li) => {
      const baseObj = typeof ln === 'string' ? { text: ln } : ln;
      const lineObj = applyLocaleLine(baseObj, scLoc, li);
      sc.lines[li] = lineObj;
      const [cueStart, cueEnd] = resolveCueTiming(bSc, voiceInfo.durs, si, li, lineObj, lt, pacing.CPS);
      sc.cues.push(buildCueEntry(lineObj, cueStart, cueEnd));
      const exactSubs = voiceInfo.subs[si] && voiceInfo.subs[si][li];
      const lineWords = voiceInfo.words[si] && voiceInfo.words[si][li];
      appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords);
      lt = cueEnd + pacing.GAP + (lineObj.pause || 0);
    });

    sc.duration = resolveSceneDuration(sc, bSc, lt, pacing.TAIL);
    return sc.start + sc.duration;
  }

  function collectGlKeyframes() {
    V.glKeys = [];
    V.scenes.forEach((sc, si) => {
      if (!sc.gl) return;
      for (const k of sc.gl(makeCtx(sc, si))) {
        const at = sc.start + k.t;
        V.glKeys.push({ ...k, t: at, t0: k.t0 === 'self' ? at : k.t0 });
      }
    });
    V.glKeys.sort((a, b) => a.t - b.t);
  }

  V.layout = function () {
    const pacing = getPacing();
    const vv = V.voice || {};
    const voiceInfo = { durs: vv.durations || [], subs: vv.subCues || [], words: vv.words || [] };
    const baked = vv.bakedLayout;
    const useBaked = isBakedValid(baked);

    let t = 0;
    V.scenes.forEach((sc, si) => {
      if (sc._explicitDuration === undefined && typeof sc.duration === 'number' && (!sc.lines || !sc.lines.length)) {
        sc._explicitDuration = sc.duration;
      }
      sc.lines = sc.lines || [];
      t = layoutScene(sc, si, t, useBaked ? baked.scenes[si] : null, voiceInfo, pacing);
    });

    V.duration = useBaked && typeof baked.duration === 'number' ? baked.duration : Math.max(0.1, t);
    V.totalDuration = V.duration;
    collectGlKeyframes();
    V.emit('onLayout', { duration: V.duration, scenes: V.scenes });
  };

  // 采样 30Hz 真实语音振幅包络（0..1），驱动数字人真口型与声波可视化
  function sampleEnvelopeArray(arr, relSec) {
    const pos = clamp(relSec * 30, 0, arr.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(arr.length - 1, i0 + 1);
    const frac = pos - i0;
    return ((arr[i0] * (1 - frac) + arr[i1] * frac) / 100);
  }

  V.getSceneEnergy = function (sc, si, lt) {
    if (!sc || !sc.cues) return 0;
    const li = sc.cues.findIndex(c => lt >= c.start && lt <= c.end);
    if (li < 0) return 0;
    const cue = sc.cues[li];
    const env = V.voice && V.voice.envelopes && V.voice.envelopes[si] && V.voice.envelopes[si][li];
    if (Array.isArray(env) && env.length) return clamp(sampleEnvelopeArray(env, lt - cue.start));
    // 草稿期尚无音频时回退为自然语音节律波
    const g = sc.start + lt;
    return clamp(0.35 + 0.55 * Math.abs(Math.sin(g * 12.5)) * Math.abs(Math.cos(g * 3.1)));
  };

  V.makeCtx = makeCtx;
})(globalThis.V = globalThis.V || {});

/* core/05-transitions.js · 基于 V.transition() 契约注册内置换幕过渡，支持外部自定义覆盖或新增 */
(function (V) {
  const { clamp, ease, h } = V.u;
  const DEFAULT_TILE_COLORS = ['#2563EB', '#3B82F6', '#6366F1', '#0EA5E9', '#64748B'];

  V.transition('none', {
    mount() { return {}; },
    update(_dom, _near, _dur, curScene) {
      if (curScene && curScene.root) curScene.root.style.transform = '';
    },
  });

  V.transition('fade', {
    mount(box) {
      const veil = h('div', { class: 'wipe-veil' });
      box.appendChild(veil);
      return { veil };
    },
    update(dom, near, dur) {
      const k = Math.abs(near) < dur ? 1 - ease.io(Math.abs(near) / dur) : 0;
      dom.veil.style.opacity = String(clamp(k));
    },
  });

  V.transition('slide', {
    mount(box) {
      const veil = h('div', { class: 'wipe-veil' });
      box.appendChild(veil);
      return { veil };
    },
    update(dom, near, dur, curScene) {
      const active = Math.abs(near) < dur;
      const k = active ? 1 - ease.io(Math.abs(near) / dur) : 0;
      dom.veil.style.opacity = String(clamp(k * 0.85));
      if (!curScene || !curScene.root) return;
      if (!active) { curScene.root.style.transform = ''; return; }
      const dx = near < 0 ? -42 * ease.in(1 + near / dur) : 42 * (1 - ease.out(near / dur));
      curScene.root.style.transform = `translateX(${dx}px)`;
    },
  });

  V.transition('wipe', {
    mount(box, cfg) {
      const curtain = h('div', { class: 'wipe-curtain' });
      if (cfg.wipeColor) curtain.style.background = cfg.wipeColor;
      box.appendChild(curtain);
      return { curtain };
    },
    update(dom, near, dur) {
      const active = Math.abs(near) < dur;
      const k = !active ? 0 : (near < 0 ? ease.in(1 + near / dur) : 1 - ease.out(near / dur));
      dom.curtain.style.transformOrigin = near < 0 ? '0% 50%' : '100% 50%';
      dom.curtain.style.transform = `scaleX(${clamp(k)})`;
    },
  });

  V.transition('tiles', {
    dur: 0.42,
    mount(box, cfg) {
      const tile = cfg.tileSize || 120;
      const cols = Math.ceil((V.stageWidth || 1920) / tile);
      const rows = Math.ceil((V.stageHeight || 1080) / tile);
      const colors = cfg.wipeColors || DEFAULT_TILE_COLORS;
      const tiles = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const el = h('i', {
            style: `width:${tile}px;height:${tile}px;left:${c * tile}px;top:${r * tile}px;background:${colors[(c * 3 + r * 7) % colors.length]}`,
          });
          box.appendChild(el);
          tiles.push([el, (c + r) / Math.max(1, cols + rows - 2)]);
        }
      }
      return { tiles };
    },
    update(dom, near, dur) {
      for (const [el, delay] of dom.tiles) {
        const k = near < 0
          ? clamp((near + dur) / dur * 1.6 - delay * 0.6)
          : 1 - clamp(near / dur * 1.6 - delay * 0.6);
        const s = Math.round(clamp(k) * 4) / 4;
        el.style.transform = `scale(${s})`;
      }
    },
  });
})(globalThis.V = globalThis.V || {});

/* core/06-layers.js · 跨幕持久层（V.layer）挂载、状态插值与实时语音能量注入 */
(function (V) {
  const { clamp, lerp, ease, h } = V.u;

  function initLayerElement(layer, stage, subs) {
    const existing = document.getElementById(`layer-${layer.id}`);
    if (existing) return existing;
    const zVal = layer.z !== undefined ? layer.z : (layer.zIndex !== undefined ? layer.zIndex : 6);
    const el = h('div', {
      id: `layer-${layer.id}`,
      class: 'stage-layer ' + (layer.cls || ''),
      style: `z-index:${zVal}`,
    });
    stage.insertBefore(el, subs);
    return el;
  }

  function mountLayers(stage, subs) {
    for (const layer of V.layers) {
      if (!layer || layer._mounted) continue;
      const el = initLayerElement(layer, stage, subs);
      const fn = layer.build || layer.create;
      const ret = fn ? fn(el, stage) : null;
      if (ret && ret.nodeType === 1 && !ret.parentNode) el.appendChild(ret);
      layer._el = el;
      layer._data = ret;
      layer._mounted = true;
    }
  }

  function resolveLayerState(layer, sc, si) {
    const prop = layer.prop || layer.id;
    const raw = sc ? sc[prop] : null;
    const val = typeof raw === 'function' ? raw(sc.ctx || V.makeCtx(sc, si), sc, si) : raw;
    return Object.assign({}, layer.defaults || layer.defaultState || {}, val || {});
  }

  function blendLayerStates(prev, next, k) {
    const out = Object.assign({}, prev, next);
    for (const key of Object.keys(out)) {
      const a = prev[key], b = next[key];
      if (typeof a === 'number' && typeof b === 'number') out[key] = lerp(a, b, k);
      else out[key] = k < 0.5 && a !== undefined ? a : b;
    }
    return out;
  }

  function computeLayerFrame(layer, sc, idx, lt) {
    const curState = resolveLayerState(layer, sc, idx);
    const blendDur = layer.blendDur === undefined ? 0.45 : layer.blendDur;
    if (idx <= 0 || blendDur <= 0 || lt >= blendDur) {
      return { state: curState, prevState: curState, curState, blend: 1 };
    }
    const prevState = resolveLayerState(layer, V.scenes[idx - 1], idx - 1);
    const blend = ease.io(clamp(lt / blendDur));
    return { state: blendLayerStates(prevState, curState, blend), prevState, curState, blend };
  }

  function updateLayers(sc, idx, lt, now, speaking) {
    if (!V.layers.length) return;
    const energy = V.getSceneEnergy(sc, idx, lt);
    for (const layer of V.layers) {
      if (!layer || !layer._mounted || typeof layer.update !== 'function') continue;
      const f = computeLayerFrame(layer, sc, idx, lt);
      layer.update(f.state, {
        t: now,
        lt,
        scene: sc,
        sceneIndex: idx,
        speaking,
        energy,
        blend: f.blend,
        prev: f.prevState,
        next: f.curState,
        el: layer._el,
        data: layer._data,
        ctx: sc.ctx,
      });
    }
  }

  V._layersRuntime = { mountLayers, updateLayers, resolveLayerState };
})(globalThis.V = globalThis.V || {});

/* core/07-checkpoints.js · 网页交互检查点（Interactive Checkpoints）：网页端驻留交互，录制态自动放行 */
(function (V) {
  const { h } = V.u;
  let activeCp = null;
  let triggeredKeys = new Set();

  function resolveSceneCheckpoints(sc) {
    if (!sc._resolvedCheckpoints) {
      const raw = typeof sc.checkpoints === 'function' ? sc.checkpoints(sc.ctx) : sc.checkpoints;
      sc._resolvedCheckpoints = Array.isArray(raw) ? raw : [];
    }
    return sc._resolvedCheckpoints;
  }

  function renderCheckpointCard(overlay, cp, resumeFn) {
    overlay.innerHTML = '';
    if (typeof cp.render === 'function') {
      cp.render(overlay, val => resumeFn(cp, val));
      return;
    }
    const choices = Array.isArray(cp.choices) && cp.choices.length
      ? cp.choices
      : [{ label: cp.buttonLabel || '继续播放', value: true, primary: true }];
    const btns = choices.map((ch, idx) => {
      const b = h('button', { class: 'cp-btn' + (ch.primary || idx === 0 ? ' is-primary' : '') }, ch.label);
      b.onclick = e => {
        e.stopPropagation();
        if (typeof ch.onSelect === 'function') ch.onSelect(V);
        resumeFn(cp, ch.value === undefined ? ch.label : ch.value);
      };
      return b;
    });
    const card = h('div', { class: 'cp-card', 'data-interactive': '1' },
      cp.title ? h('h4', null, cp.title) : null,
      cp.prompt ? h('p', null, cp.prompt) : null,
      h('div', { class: 'cp-actions' }, ...btns));
    overlay.appendChild(card);
  }

  function closeCheckpointOverlay() {
    const overlay = typeof document !== 'undefined' ? document.getElementById('checkpoint-overlay') : null;
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.innerHTML = '';
    }
    activeCp = null;
  }

  function triggerCheckpoint(cp, pauseFn, playFn) {
    activeCp = cp;
    pauseFn();
    const overlay = document.getElementById('checkpoint-overlay');
    if (!overlay) return;
    overlay.classList.add('is-open');
    renderCheckpointCard(overlay, cp, (item, val) => {
      if (item.id) V.checkpointState[item.id] = val;
      closeCheckpointOverlay();
      if (typeof item.onResume === 'function') item.onResume(val, V);
      playFn();
    });
  }

  function applyRecordCheckpoints(list, scStart, curT) {
    for (const cp of list) {
      if (!cp || cp.at == null || !cp.id) continue;
      if (curT >= scStart + Number(cp.at) && V.checkpointState[cp.id] === undefined) {
        V.checkpointState[cp.id] = cp.defaultValue === undefined ? true : cp.defaultValue;
      }
    }
  }

  function canCheckInteractive(ctl, prevT, curT) {
    if (!ctl.playing || ctl.scrubbing) return false;
    return curT > prevT && curT - prevT <= 0.3;
  }

  function checkSceneCheckpoints(sc, si, prevT, curT, ctl) {
    const list = resolveSceneCheckpoints(sc);
    if (!list.length) return;
    if (ctl.isRecord) { applyRecordCheckpoints(list, sc.start, curT); return; }
    if (!canCheckInteractive(ctl, prevT, curT)) return;
    for (let i = 0; i < list.length; i++) {
      const cp = list[i];
      if (!cp || cp.at == null) continue;
      const gAt = sc.start + Number(cp.at);
      const key = `${si}:${cp.id || i}`;
      if (!triggeredKeys.has(key) && prevT < gAt && curT >= gAt) {
        triggeredKeys.add(key);
        triggerCheckpoint(cp, ctl.pause, ctl.play);
        return;
      }
    }
  }

  V.resume = function (val) {
    if (!activeCp) {
      if (V._playerCtl) V._playerCtl.play();
      return;
    }
    if (activeCp.id) V.checkpointState[activeCp.id] = val;
    const item = activeCp;
    closeCheckpointOverlay();
    if (typeof item.onResume === 'function') item.onResume(val, V);
    if (V._playerCtl) V._playerCtl.play();
  };

  V.resetCheckpoints = function () {
    triggeredKeys = new Set();
    closeCheckpointOverlay();
  };

  V._checkpointsRuntime = { checkSceneCheckpoints, closeCheckpointOverlay };
})(globalThis.V = globalThis.V || {});

/* core/08-plugins.js · 内置可插拔扩展（通过标准 V.use 注册：草稿 WebAudio 微音效 + ?dev 面板 + SSE 保位热重载） */
(function (V) {
  const { clamp, h, toggle } = V.u;

  // 1. 草稿态动作微音效预览插件（已有正式音轨或录制态自动静默）
  let draftActx = null;

  function synthTone(ctx, type, g) {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const presets = {
      ping: ['sine', 880, 1320, 0.09, 0.24],
      chime: ['sine', 880, 1320, 0.09, 0.24],
      alert: ['triangle', 520, 420, 0.09, 0.22],
      key: ['triangle', 420, 160, 0.045, 0.05],
      click: ['triangle', 680, 160, 0.045, 0.05],
    };
    const [wave, f0, f1, rampT, endT] = presets[type] || presets.click;
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + rampT);
    gain.gain.setValueAtTime(g, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + endT);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + endT + 0.01);
  }

  function playDraftSfx(type, vol = 0.5) {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      if (!draftActx) draftActx = new Ctx();
      if (draftActx.state === 'suspended') draftActx.resume();
      synthTone(draftActx, type, clamp(vol, 0.05, 1) * 0.12);
    } catch {}
  }

  function canPlayDraftSfx(st) {
    if (!st.playing || st.scrubbing || st.hasAudio || st.isRecord || st.muted) return false;
    return st.now > st.prevT && st.now - st.prevT <= 0.25;
  }

  function resolveSceneSfxList(sc) {
    if (!sc._resolvedSfx) {
      const raw = typeof sc.sfx === 'function' ? sc.sfx(sc.ctx) : sc.sfx;
      sc._resolvedSfx = Array.isArray(raw) ? raw : [];
    }
    return sc._resolvedSfx;
  }

  V.use({
    id: 'builtin-draft-sfx',
    onRender(st) {
      if (!canPlayDraftSfx(st)) return;
      const sc = st.scene;
      for (const ev of resolveSceneSfxList(sc)) {
        if (!ev || ev.at == null) continue;
        const gAt = sc.start + Number(ev.at);
        if (st.prevT < gAt && st.now >= gAt) {
          playDraftSfx(ev.type || ev.preset || 'click', ev.volume === undefined ? 0.5 : ev.volume);
        }
      }
    },
  });

  // 2. ?dev=1 创作者调试条与零依赖 SSE 保位热重载插件
  let devStatEl = null;
  let devRateBtns = null;

  function hotReloadStylesheets() {
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    const stamp = Date.now();
    links.forEach(lnk => {
      const u = new URL(lnk.href, location.href);
      u.searchParams.set('_hmr', String(stamp));
      lnk.href = u.toString();
    });
  }

  function connectLiveReload() {
    if (typeof EventSource === 'undefined' || V._isRecord) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    try {
      const es = new EventSource('/__hmr');
      es.onmessage = ev => {
        const msg = JSON.parse(ev.data || '{}');
        if (msg.type === 'css') { hotReloadStylesheets(); return; }
        if (msg.type === 'reload') {
          try { sessionStorage.setItem('__video_hmr_t', String(V._now || 0)); } catch {}
          location.reload();
        }
      };
      es.onerror = () => es.close();
    } catch {}
  }

  function mountDevPanel(ctl) {
    devStatEl = h('span', { class: 'dev-stat' }, 't=0.00s');
    devRateBtns = [0.5, 1, 1.5, 2].map(r => {
      const b = h('button', { class: Math.abs(r - ctl.getRate()) < 0.01 ? 'on' : '' }, `${r}x`);
      b.onclick = () => ctl.setRate(r);
      return [r, b];
    });
    const loopBtn = h('button', null, '单幕循环');
    loopBtn.onclick = () => toggle(loopBtn, 'on', ctl.toggleLoopScene());
    const safeEl = document.getElementById('safe-guide');
    const safeBtn = h('button', { class: 'on' }, '安全区');
    if (safeEl) safeEl.classList.add('on');
    safeBtn.onclick = () => toggle(safeBtn, 'on', safeEl ? safeEl.classList.toggle('on') : false);
    document.body.appendChild(h('div', { id: 'dev-hud', 'data-interactive': '1' }, devStatEl, ...devRateBtns.map(x => x[1]), loopBtn, safeBtn));
  }

  V.use({
    id: 'builtin-dev-hmr',
    onStart(ctl) {
      connectLiveReload();
      if (ctl.isDev) mountDevPanel(ctl);
    },
    onRateChange(rate) {
      if (devRateBtns) devRateBtns.forEach(([r, b]) => toggle(b, 'on', Math.abs(r - rate) < 0.01));
    },
    onRender(st) {
      if (!devStatEl) return;
      const cueTag = st.activeCueIdx >= 0 ? `L${st.activeCueIdx}` : '--';
      devStatEl.textContent = `t=${st.now.toFixed(2)}s | S${st.sceneIndex + 1} lt=${st.lt.toFixed(2)}s (${cueTag})`;
    },
  });
})(globalThis.V = globalThis.V || {});

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
  let current = null, now = 0, prevRenderNow = 0, playing = false, lastTs = 0;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false, muted = false;
  let scrubbing = false, targetSeekTime = null, lastSeekTarget = -1, lastSeekAt = 0;
  let audioBlocked = false, playPending = false, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null;
  let wipeState = { name: '', handler: null, dom: null };
  const ui = {};

  function getUiCfg(cfg) {
    const u = (cfg && cfg.ui) || {};
    return {
      controlsMode: u.controlsMode || (cfg && cfg.controlsMode) || 'docked',
      chapterMarks: u.chapterMarks !== false && (!cfg || cfg.chapterMarks !== false),
      hud: u.hud !== undefined ? Boolean(u.hud) : (!cfg || cfg.hud !== false),
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
      h('div', { class: 'rate-wrap' },
        h('button', { class: 'ctrl-rbtn rate-trigger', 'data-act': 'rate', title: '播放倍速' }, '1.0x'),
        h('div', { class: 'rate-menu' })),
      h('button', { class: 'ctrl-rbtn', 'data-act': 'subs', title: '字幕开关' }, '字幕'),
      h('button', { class: 'ctrl-rbtn', 'data-act': 'mute', title: '声音开关' }, '声音'),
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: '窗口全屏（W）', 'aria-label': '窗口全屏' }, makeCtrlIcon(uiCfg.icons.webEnter)),
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

    const vp = h('div', { id: 'viewport' },
      h('div', { id: 'stage' },
        h('canvas', { id: 'gl', width: String(W), height: String(H), class: V.gl ? '' : 'is-off' }),
        h('div', { id: 'hud', 'data-interactive': '1', class: uiCfg.hud ? '' : 'is-off' }, h('div', { class: 'hud-track' }, h('i', { class: 'hud-bar' }))),
        h('div', { id: 'subs', 'data-sub-pos': 'center' },
          h('div', { class: 'sub-lead' }),
          h('span', { class: 'sub-speaker' }),
          h('p', { class: 'sub-text' }, h('span', { class: 'ghost' }), h('span')),
          h('div', { class: 'sub-tail' })),
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

  function runSubHook(subCfg, cue, sc, idx, lt) {
    const fn = subCfg.onUpdate || subCfg.update;
    if (typeof fn !== 'function') return;
    const info = { t: now, lt, scene: sc, sceneIndex: idx, speaking: Boolean(cue), energy: V.getSceneEnergy(sc, idx, lt) };
    fn(cue, info, { subs, lead: subLead, tail: subTail, speaker: subSpeaker, text: subText });
  }

  function syncSceneSubLayout(sc, lt) {
    const spec = sc.subLayout || sc.subtitles;
    if (!spec) return;
    applySubLayout(typeof spec === 'function' ? spec(lt, sc.ctx, sc) : spec);
  }

  function updateSubs(sc, idx, lt) {
    const subCfg = getSubCfg();
    syncSceneSubLayout(sc, lt);
    const list = sc.subCues && sc.subCues.length ? sc.subCues : sc.cues;
    let cue = null;
    activeCueIdx = -1;
    sc.cues.forEach((c, i) => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) activeCueIdx = i; });
    list.forEach(c => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) cue = c; });
    subs.style.visibility = cue && showSubs ? 'visible' : 'hidden';
    runSubHook(subCfg, cue, sc, idx, lt);
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
    updateSubs(sc, idx, lt);
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
    document.body.classList.remove('playing');
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
    if (bar && bar.classList.contains('menu-open')) setOpenMenu(bar, '');
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

  function bindIdleWake() {
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
    ui.webfull.onclick = () => setWebFull(!webFull);
    ui.full.onclick = toggleOsFull;
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

    V.seekTo = t => render(t);
    V.seekToAsync = async t => { render(t); await waitStageAssets(); };
    V._playerCtl = { play, pause, seek, setRate, getRate: () => playbackRate, toggleLoopScene: () => (loopScene = !loopScene), isDev: DEV, isRecord: RECORD };

    if (RECORD) document.body.classList.add('record');
    else buildUI(uiCfg);
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

