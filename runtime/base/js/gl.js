/* HTML 视频通用底座 · 可选 Three.js 关键帧粒子背景插件：纯函数粒子插值，支持平滑圆点与像素网格渲染 */
import * as THREE from '../vendor/three/build/three.custom.min.js';

const V = globalThis.V = globalThis.V || {};
const N = 3600;
const TAU = Math.PI * 2;

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20261110);
const R = Array.from({ length: 4 }, () => Float32Array.from({ length: N }, rand));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = k => k * k * (3 - 2 * k);
const hex = v => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];

let W = 1920, H = 1080;
let defaultText = 'VIDEO';
let glFont = '700 280px system-ui, -apple-system, "Segoe UI", sans-serif';
let palette = [0x2563EB, 0x38BDF8, 0x6366F1, 0x14B8A6, 0x8B5CF6, 0x0EA5E9].map(hex);
let textStops = [0x2563EB, 0x38BDF8, 0x6366F1, 0x38BDF8, 0x2563EB].map(hex);
let driftMuted = hex(0xCBD5E1);

const textCache = {};
let colorCache = {};

function extractCanvasAlphaPoints(data, w, h) {
  const pts = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 128) pts.push([x / w, y / h]);
    }
  }
  if (!pts.length) pts.push([0.5, 0.5]);
  return pts;
}

function sampleText(label = defaultText) {
  const key = `${glFont}|${label}`;
  if (textCache[key]) return textCache[key];
  const w = 1400, h = 420;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.font = glFont;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(label, 700, 210);
  const pts = extractCanvasAlphaPoints(g.getImageData(0, 0, w, h).data, w, h);
  textCache[key] = Array.from({ length: N }, (_, i) => pts[Math.floor(R[0][i] * pts.length)]);
  return textCache[key];
}

const SHAPES = {
  swarm(i, t) {
    const rad = 2.4 + R[0][i] * 5.5, a = R[1][i] * TAU + t * (0.10 + R[2][i] * 0.18);
    return [Math.cos(a) * rad, (R[3][i] - 0.5) * 3.6 + Math.sin(t * 0.6 + R[0][i] * 9) * 0.35, Math.sin(a) * rad * 0.55 - 2.5];
  },
  drift(i, t) {
    const z = ((R[2][i] * 18 + t * 0.75) % 18) - 14;
    return [(R[0][i] - 0.5) * 26, (R[1][i] - 0.5) * 15, z];
  },
  stream(i, t, o) {
    const th = R[1][i] * TAU, ph = Math.acos(2 * R[2][i] - 1);
    const k = (R[0][i] + t * 0.35) % 1, r = 0.9 + (1 - k * k) * 8;
    return [(o.x || 0) + Math.sin(ph) * Math.cos(th) * r, (o.y || 0) + Math.sin(ph) * Math.sin(th) * 0.7 * r, Math.cos(ph) * r * 0.6];
  },
  text(i, t, o) {
    const p = sampleText(o.text || defaultText)[i], s = o.s || 9.6;
    const x = (p[0] - 0.5) * s, y = -(p[1] - 0.5) * s * 0.3 + (o.y || 0);
    return [x + (o.x || 0), y, Math.sin(x * 1.2 + t * 2.2) * 0.12 + (R[3][i] - 0.5) * 0.25];
  },
  burst(i, _t, o, now) {
    const k = clamp(((now || 0) - (o.t0 || 0)) / 2.2), e = 1 - Math.pow(1 - k, 3);
    const th = R[1][i] * TAU, ph = Math.acos(2 * R[2][i] - 1), r = e * (3 + R[0][i] * 9);
    return [(o.x || 0) + Math.sin(ph) * Math.cos(th) * r, (o.y || 0) + Math.cos(ph) * r * 0.7, Math.sin(ph) * Math.sin(th) * r];
  },
  ring(i, t, o) {
    const a = (i / 850) * TAU + t * 0.22, rad = (o.r || 4.8) + (R[0][i] - 0.5) * 1.1;
    return [(o.x || 0) + Math.cos(a) * rad * 1.35, (o.y || 0) + Math.sin(a) * rad * 0.72, Math.sin(a * 3 + t) * 0.45 - 2.0];
  },
  grid(i, t) {
    const cols = 34, gx = (i % cols) - cols / 2, gy = Math.floor(i / cols) - 12;
    return [gx * 0.62, gy * 0.48 + Math.sin(gx * 0.35 + t * 1.1) * 0.14, -3.2 + Math.cos(gy * 0.4 + t * 0.9) * 0.35];
  },
  hex(i, t) {
    const cols = 32, c = i % cols, r = Math.floor(i / cols);
    const x = (c - cols / 2 + (r % 2) * 0.5) * 0.66, y = (r - 13) * 0.56;
    return [x, y, -3.0 + Math.sin(Math.hypot(x, y) * 0.7 - t * 1.3) * 0.42];
  },
};

function toneAt(i) {
  return palette[Math.floor(R[3][i] * palette.length) % palette.length];
}

function gradAt(x) {
  const f = clamp(x) * (textStops.length - 1), k = Math.floor(f), m = f - k;
  const a = textStops[k], b = textStops[Math.min(k + 1, textStops.length - 1)];
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
}

const COLORS = {
  swarm: toneAt,
  drift: i => (R[2][i] < 0.65 ? driftMuted : toneAt(i)),
  stream: toneAt,
  text: (i, o) => gradAt(sampleText((o && o.text) || defaultText)[i][0]),
  burst: toneAt,
};

function colorsFor(keyframe) {
  const name = keyframe.shape;
  const cacheKey = name === 'text' ? `text:${keyframe.text || defaultText}` : name;
  if (!colorCache[cacheKey]) {
    const a = new Float32Array(N * 3);
    const fn = COLORS[name] || toneAt;
    for (let i = 0; i < N; i++) a.set(fn(i, keyframe), i * 3);
    colorCache[cacheKey] = a;
  }
  return colorCache[cacheKey];
}

let renderer, scene, camera, points, geo, floor, floorMat, mat;

function createPointMaterial(pixelGrid, bgHex) {
  const vertexShader = pixelGrid > 0
    ? 'attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uGrid; uniform float uBright; uniform vec3 uBg; uniform vec2 uRes;' +
      'void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vec4 p = projectionMatrix * mv;' +
      'vec2 q = (p.xy / p.w * 0.5 + 0.5) * uRes; q = floor(q / uGrid) * uGrid + uGrid * 0.5;' +
      'p.xy = (q / uRes * 2.0 - 1.0) * p.w; gl_Position = p;' +
      'gl_PointSize = uGrid * (size > 1.6 ? 2.0 : 1.0);' +
      'float fade = clamp(1.0 - (-mv.z - 9.0) / 20.0, 0.0, 1.0) * clamp(uBright, 0.0, 1.0);' +
      'vColor = mix(uBg, color, fade); }'
    : 'attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uBright; uniform vec3 uBg;' +
      'void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;' +
      'gl_PointSize = clamp(size * 6.5 * (10.0 / max(2.0, -mv.z)), 2.5, 14.0);' +
      'float fade = clamp(1.0 - (-mv.z - 9.0) / 20.0, 0.0, 1.0) * clamp(uBright, 0.0, 1.0);' +
      'vColor = mix(uBg, color, fade); }';
  const fragmentShader = pixelGrid > 0
    ? 'varying vec3 vColor; void main(){ gl_FragColor = vec4(vColor, 1.0); }'
    : 'varying vec3 vColor; void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; gl_FragColor = vec4(vColor, 1.0); }';
  return new THREE.ShaderMaterial({
    uniforms: { uBright: { value: 0.14 }, uGrid: { value: pixelGrid || 6 }, uBg: { value: hex(bgHex) }, uRes: { value: [W, H] } },
    vertexShader,
    fragmentShader,
    transparent: false,
    depthWrite: false,
    depthTest: false,
  });
}

function buildFloor(floorHex) {
  const lines = [];
  for (let x = -30; x <= 30; x += 1.5) lines.push(x, 0, -40, x, 0, 12);
  for (let z = -40; z <= 12; z += 1.5) lines.push(-30, 0, z, 30, 0, z);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  floorMat = new THREE.LineBasicMaterial({ color: floorHex, transparent: true, opacity: 0.25, fog: true, depthWrite: false });
  floor = new THREE.LineSegments(fg, floorMat);
  floor.position.y = -3.2;
  scene.add(floor);
}

function build(canvas, cfg) {
  const pixelGrid = Number(cfg.glPixelGrid || 0);
  const defaultBg = cfg.theme === 'dark' ? 0x0B1120 : 0xF8FAFC;
  const defaultFloor = cfg.theme === 'dark' ? 0x1E293B : 0xCBD5E1;
  const bgHex = cfg.glBg === undefined ? defaultBg : cfg.glBg;
  const floorHex = cfg.glFloorColor === undefined ? defaultFloor : cfg.glFloorColor;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: pixelGrid <= 0, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(bgHex, 6, 30);
  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);

  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('size', new THREE.BufferAttribute(Float32Array.from(R[1], r => 0.55 + r * r * 1.8), 1));
  geo.setDrawRange(0, 900);

  mat = createPointMaterial(pixelGrid, bgHex);
  points = new THREE.Points(geo, mat);
  scene.add(points);
  buildFloor(floorHex);
}

function keysAt(now) {
  const keys = V.glKeys;
  let k = 0;
  for (let j = 0; j < keys.length; j++) if (keys[j].t <= now) k = j;
  return [keys[Math.max(0, k - 1)], keys[k]];
}

function stepParticles(now, a, b, mix, cnt) {
  const pos = geo.attributes.position.array, col = geo.attributes.color.array;
  const ca = colorsFor(a), cb = colorsFor(b);
  const fa = SHAPES[a.shape] || SHAPES.drift, fb = SHAPES[b.shape] || SHAPES.drift;
  for (let i = 0; i < cnt; i++) {
    const m = mix >= 1 ? 1 : smooth(clamp(mix * 1.5 - R[2][i] * 0.5));
    const pb = fb(i, now, b, now);
    const pa = m < 1 ? fa(i, now, a, now) : pb;
    const o = i * 3;
    pos[o] = pa[0] + (pb[0] - pa[0]) * m;
    pos[o + 1] = pa[1] + (pb[1] - pa[1]) * m;
    pos[o + 2] = pa[2] + (pb[2] - pa[2]) * m;
    col[o] = ca[o] + (cb[o] - ca[o]) * m;
    col[o + 1] = ca[o + 1] + (cb[o + 1] - ca[o + 1]) * m;
    col[o + 2] = ca[o + 2] + (cb[o + 2] - ca[o + 2]) * m;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
}

function valOr(v, fallback) {
  return v === undefined ? fallback : v;
}

function render(now) {
  if (!renderer || !V.glKeys || !V.glKeys.length) return;
  const [a, b] = keysAt(now);
  const mix = a === b ? 1 : smooth(clamp((now - b.t) / (b.dur || 1.1)));
  const cnt = (a.shape === 'text' || b.shape === 'text') ? N : 850;
  geo.setDrawRange(0, cnt);
  stepParticles(now, a, b, mix, cnt);
  const l = (x, y) => x + (y - x) * mix;
  mat.uniforms.uBright.value = l(valOr(a.bright, 0.14), valOr(b.bright, 0.14));
  floorMat.opacity = l(valOr(a.floor, 0.22), valOr(b.floor, 0.22));
  floor.position.z = (now * 1.8) % 1.5;
  const sway = l(valOr(a.sway, 0.6), valOr(b.sway, 0.6));
  camera.position.set(Math.sin(now * 0.18) * 0.5 * sway, 0.25 + Math.sin(now * 0.12) * 0.18 * sway, 10);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

function applyGlConfig(cfg) {
  W = cfg.width || 1920;
  H = cfg.height || 1080;
  defaultText = cfg.glText || 'VIDEO';
  if (cfg.glFont) glFont = cfg.glFont;
  if (Array.isArray(cfg.glPalette) && cfg.glPalette.length) palette = cfg.glPalette.map(hex);
  if (Array.isArray(cfg.glTextStops) && cfg.glTextStops.length) textStops = cfg.glTextStops.map(hex);
  const fallbackMuted = cfg.theme === 'dark' ? 0x334155 : 0xCBD5E1;
  driftMuted = hex(cfg.glDriftMutedColor === undefined ? fallbackMuted : cfg.glDriftMutedColor);
  colorCache = {};
}

V.gl = {
  ready: false,
  async init(canvas, initCfg) {
    const cfg = Object.assign({}, V.themeDefaults || {}, V.config || {}, initCfg || {});
    applyGlConfig(cfg);
    if (cfg.glFontLoad && document.fonts && document.fonts.load) {
      try { await document.fonts.load(cfg.glFontLoad); } catch {}
    }
    sampleText(defaultText);
    build(canvas, cfg);
    this.ready = true;
  },
  render,
  registerShape(name, shapeFn, colorFn) {
    if (!name || typeof shapeFn !== 'function') return;
    SHAPES[name] = shapeFn;
    if (typeof colorFn === 'function') COLORS[name] = colorFn;
    colorCache = {};
  },
};
