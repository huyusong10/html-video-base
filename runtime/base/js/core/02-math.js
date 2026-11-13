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

  const KF_META = new Set(['at', 'dur', 'ease', 'switchAt']);

  function seedKeyframeState(stops, init) {
    if (init) return Object.assign({}, init);
    const state = {};
    for (const [key, val] of Object.entries(stops[0] || {})) {
      if (!KF_META.has(key) && val !== undefined) state[key] = val;
    }
    return state;
  }

  function blendKeyframeProp(state, key, val, k, snap) {
    if (typeof val === 'number' && typeof state[key] === 'number') state[key] = lerp(state[key], val, k);
    else if (snap || state[key] === undefined) state[key] = val;
  }

  function applyKeyframeStop(state, kf, t, defDur, defEase) {
    const d = kf.dur === undefined ? defDur : kf.dur;
    const rawK = d <= 0 ? (t >= kf.at ? 1 : 0) : prog(t, kf.at, kf.at + d);
    if (rawK <= 0) return;
    const fn = ease[kf.ease || defEase] || ease.io;
    const k = fn(rawK);
    const snap = d <= 0 || rawK >= (kf.switchAt === undefined ? 0.5 : kf.switchAt);
    for (const [key, val] of Object.entries(kf)) {
      if (!KF_META.has(key) && val != null) blendKeyframeProp(state, key, val, k, snap);
    }
  }

  function keyframes(t, stops = [], opts = {}) {
    if (!stops || !stops.length) return Object.assign({}, opts.init || {});
    const state = seedKeyframeState(stops, opts.init);
    const defDur = opts.dur === undefined ? 0.5 : opts.dur;
    const defEase = opts.ease || 'io';
    for (let i = opts.init ? 0 : 1; i < stops.length; i++) {
      if (stops[i] && stops[i].at != null) applyKeyframeStop(state, stops[i], t, defDur, defEase);
    }
    return state;
  }

  V.u = Object.assign(V.u || {}, { clamp, lerp, prog, ease, appear, win, stagger, keyframes });
})(globalThis.V = globalThis.V || {});
