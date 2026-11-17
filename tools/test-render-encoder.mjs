import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2]);
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const videoDir = path.join(root, 'videos/demo');
fs.mkdirSync(path.join(videoDir, 'js'), { recursive: true });
fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="js/scenes.js"></script><script>V.boot();const seek=V.seekToAsync;V.seekToAsync=async t=>{await new Promise(resolve=>setTimeout(resolve,40));return seek(t);};</script></body></html>');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={width:320,height:180,fps:30,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/scenes.js"]};');
fs.writeFileSync(path.join(videoDir, 'js/scenes.js'), 'V.scene({duration:1,lines:[],build(root){root.style.background="red";},update(){}});');
const outPath = path.join(root, 'previous-output.mp4');
fs.writeFileSync(outPath, 'previous successful output');
const invalidExecutable = path.join(root, 'invalid-encoder.txt');
fs.writeFileSync(invalidExecutable, 'This file is not an executable.');
// Node 拒绝 FFmpeg 参数并立即退出；普通文本文件则使启动本身失败。
for (const [label, ffmpeg] of [['early-exit', process.execPath], ['spawn-failure', invalidExecutable]]) {
  const result = spawnSync(process.execPath, [path.join(toolsDir, 'render.mjs'), 'demo', outPath, '--workers', '1', '--no-frame-reuse'], {
    cwd: root, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, VIDEO_PROJECT_ROOT: root, FFMPEG_BIN: ffmpeg },
  });
  assert.equal(result.error, undefined, `Encoder ${label} must settle without hanging: ${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.status, 0, `Encoder ${label} must fail the render`);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/, 'Encoder and pipe errors must be handled as render failures');
  assert.match(result.stderr, /ffmpeg/i, 'The render must report the encoder failure');
  assert.equal(fs.readFileSync(outPath, 'utf8'), 'previous successful output', 'A failed render must preserve the previous output');
}
console.log('Encoder early exit/startup failure settle promptly and preserve existing output PASSED.');
