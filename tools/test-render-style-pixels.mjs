import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, resolveFfmpeg } from './lib/paths.mjs';

const runtime = path.join(PKG_ROOT, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const project = fs.mkdtempSync(path.join(runtime, 'render-style-pixels-'));
const course = path.join(project, 'videos/demo');
fs.mkdirSync(course, { recursive: true });
fs.writeFileSync(path.join(course, 'index.html'), `<!doctype html>
<link rel="stylesheet" href="../base/css/base.css"><link rel="stylesheet" href="style.css">
<script src="../base/js/engine.js"></script><script src="video.config.js"></script>
<body><script src="scenes.js"></script><script>V.boot()</script></body>`);
fs.writeFileSync(path.join(course, 'video.config.js'),
  'V.config={width:320,height:180,fps:4,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(course, 'style.css'), '@import "../palette.css";');
fs.writeFileSync(path.join(course, 'scenes.js'), `
V.scene({duration:1,lines:[],build(root){
  const tile = document.createElement('div');
  tile.style.cssText = 'position:absolute;left:16px;top:22px;width:64px;height:72px;background:lime;' +
    'transform:translateX(calc(var(--tg) * 10px))';
  root.append(tile);
},update(){}});
`);

const ffmpeg = resolveFfmpeg(PKG_ROOT);
const palette = path.join(project, 'videos/palette.css');
function render(name, ...flags) {
  const file = path.join(project, name + '.mp4');
  const result = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools/render.mjs'), 'demo', file, '--workers', '1', ...flags], {
    cwd: project, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, VIDEO_PROJECT_ROOT: project, FFMPEG_BIN: ffmpeg },
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  const decoded = spawnSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  assert.equal(decoded.stdout.length, 4 * 320 * 180 * 3);
  return { log: result.stdout, pixels: decoded.stdout };
}

function dominantChannel(pixels, frame, x, y) {
  const offset = ((frame * 180 + y) * 320 + x) * 3;
  const rgb = [...pixels.subarray(offset, offset + 3)];
  assert.ok(Math.max(...rgb) > 200, 'Expected a saturated pixel, got ' + rgb);
  return rgb.indexOf(Math.max(...rgb));
}

fs.writeFileSync(palette, '#stage{background:red}');
const red = render('red');
assert.equal(dominantChannel(red.pixels, 0, 305, 135), 0);
assert.equal(dominantChannel(red.pixels, 0, 42, 45), 1);
assert.equal(dominantChannel(red.pixels, 3, 42, 45), 0, 'The tile must leave its initial position');
assert.equal(dominantChannel(red.pixels, 3, 225, 45), 1, 'The tile must move with the inline CSS clock in the decoded MP4');

const warm = render('warm');
assert.match(warm.log, /cache 1\/1 scenes hit/);
assert.ok(warm.pixels.equals(red.pixels));
fs.writeFileSync(palette, '#stage{background:blue}');
const blue = render('blue');
assert.match(blue.log, /cache 0\/1 scenes hit/);
assert.equal(dominantChannel(blue.pixels, 0, 305, 135), 2, 'Changing only an imported CSS file must update the decoded MP4');
const reference = render('reference', '--no-cache', '--no-frame-reuse');
assert.ok(reference.pixels.equals(blue.pixels), 'Default export must match every decoded RGB pixel from the uncached export');
console.log('MP4 CSS cache invalidation and time-driven inline frame pixels passed.');
