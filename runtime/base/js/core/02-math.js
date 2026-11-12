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
