import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveFfmpeg } from './lib/paths.mjs';

const root = path.resolve(process.argv[2]);
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const renderScript = path.join(toolsDir, 'render.mjs');
const ffmpegBin = resolveFfmpeg();
const videoDir = path.join(root, 'videos/demo');
const outputDir = path.join(root, '输出 文件');
const outPath = path.join(outputDir, 'existing.mp4');
fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'unrelated.tmp.mp4'), 'unrelated temporary file');
fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script></body></html>');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={width:320,height:180,fps:2,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["scenes.js"]};');

function writeScene(color) {
  fs.writeFileSync(path.join(videoDir, 'scenes.js'), `V.scene({duration:1,lines:[],build(root){root.style.background=${JSON.stringify(color)};},update(){}});`);
}

function runRender(launcher = null, target = outPath) {
  const args = [renderScript, 'demo', target, '--workers', '1'];
  if (launcher) args.unshift(launcher);
  const result = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, VIDEO_PROJECT_ROOT: root, FFMPEG_BIN: ffmpegBin },
  });
  assert.equal(result.error, undefined, `Render must settle within its deadline: ${result.stdout}\n${result.stderr}`);
  return result;
}

function decodeColors(target = outPath) {
  const result = spawnSync(ffmpegBin, ['-loglevel', 'error', '-i', target, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 15000 });
  assert.equal(result.status, 0, String(result.stderr));
  const frameBytes = 320 * 180 * 3;
  assert.equal(result.stdout.length, 2 * frameBytes, 'The complete MP4 must contain both frames');
  return [0, 1].map(frame => Array.from(result.stdout.subarray(frame * frameBytes + (90 * 320 + 160) * 3, frame * frameBytes + (90 * 320 + 160) * 3 + 3)));
}

function assertOutputDirectory() {
  assert.deepEqual(fs.readdirSync(outputDir).sort(), ['existing.mp4', 'unrelated.tmp.mp4'], 'Final mux must remove its private temporary file');
  assert.equal(fs.readFileSync(path.join(outputDir, 'unrelated.tmp.mp4'), 'utf8'), 'unrelated temporary file', 'Cleanup must preserve unrelated files');
}

function writeFailingLauncher(failToStart = false) {
  const failingMux = path.join(root, 'fail-mux.mjs');
  fs.writeFileSync(failingMux, 'import fs from "node:fs";fs.writeFileSync(process.argv.at(-1),"partial failed mux");process.stderr.write("Intentional mux failure after opening output\\n");process.exit(9);');
  const launcher = path.join(root, failToStart ? 'launch-missing-mux.mjs' : 'launch-render.mjs');
  const injectedCommand = failToStart ? path.join(root, 'missing-final-mux-executable') : process.execPath;
  const injectedArgs = failToStart ? 'args' : '[failingMux,...args]';
  fs.writeFileSync(launcher, [
    'import childProcess from "node:child_process";',
    'import { syncBuiltinESMExports } from "node:module";',
    'import { pathToFileURL } from "node:url";',
    'const original = childProcess.spawn;',
    `const failingMux = ${JSON.stringify(failingMux)};`,
    'childProcess.spawn = function(file,args,options){',
    `  if(file===process.env.FFMPEG_BIN && args.includes("concat"))return original(${JSON.stringify(injectedCommand)},${injectedArgs},options);`,
    '  return original(file,args,options);',
    '};',
    'syncBuiltinESMExports();',
    'const [renderScript,...args]=process.argv.slice(2);',
    'process.argv=[process.execPath,renderScript,...args];',
    'await import(pathToFileURL(renderScript).href);',
  ].join('\n'));
  return launcher;
}

writeScene('teal');
const initial = runRender();
assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
for (const [r, g, b] of decodeColors()) {
  assert.ok(r < 10 && g > 110 && g < 140 && b > 110 && b < 140, 'The initial MP4 must decode to teal');
}
assertOutputDirectory();
const before = fs.readFileSync(outPath);
for (const failToStart of [false, true]) {
  const failed = runRender(writeFailingLauncher(failToStart));
  assert.notEqual(failed.status, 0, 'The final mux failure must fail the render');
  assert.match(failed.stderr, failToStart ? /ENOENT/ : /Intentional mux failure after opening output/);
  assert.doesNotMatch(failed.stderr, /Unhandled 'error' event/, 'Final mux startup errors must reject through the render cleanup');
  assert.match(failed.stdout, /cache 1\/1 scenes hit/, 'The injected failure must occur after cached rendering');
  assert.ok(before.equals(fs.readFileSync(outPath)), 'A failed final mux must preserve the previous complete MP4');
  assert.equal(fs.existsSync(path.join(root, '.runtime', `render-demo-${failed.pid}`)), false, 'Failed final mux must remove its render temporary directory');
  assertOutputDirectory();
}

writeScene('blue');
const replaced = runRender();
assert.equal(replaced.status, 0, `${replaced.stdout}\n${replaced.stderr}`);
assert.ok(!before.equals(fs.readFileSync(outPath)), 'A successful render must replace the existing output');
for (const [r, g, b] of decodeColors()) {
  assert.ok(r < 10 && g < 10 && b > 240, 'The replacement MP4 must decode to blue');
}
assertOutputDirectory();

const formatDir = path.join(root, '格式 校验');
const mkvPath = path.join(formatDir, 'video.mkv');
const mkv = runRender(null, mkvPath);
assert.equal(mkv.status, 0, `${mkv.stdout}\n${mkv.stderr}`);
assert.equal(fs.readFileSync(mkvPath).subarray(0, 4).toString('hex'), '1a45dfa3', 'An explicit .mkv output must remain Matroska');
for (const [r, g, b] of decodeColors(mkvPath)) {
  assert.ok(r < 10 && g < 10 && b > 240, 'The Matroska output must contain the expected blue frames');
}
const unsupportedPath = path.join(formatDir, 'previous.js');
fs.writeFileSync(unsupportedPath, 'previous JavaScript content');
const unsupported = runRender(null, unsupportedPath);
assert.notEqual(unsupported.status, 0, 'An unsupported output format must fail');
assert.equal(fs.readFileSync(unsupportedPath, 'utf8'), 'previous JavaScript content', 'An unsupported output format must preserve the existing file');
assert.deepEqual(fs.readdirSync(formatDir).sort(), ['previous.js', 'video.mkv'], 'Format handling must clean its private temporary files');
console.log('Final mux exit/startup failure, output preservation, successful replacement, explicit container format and decoded frames PASSED.');
