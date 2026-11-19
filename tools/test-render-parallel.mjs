import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRenderTasks, resolveRenderConcurrency } from './render.mjs';
import { resolveFfmpeg } from './lib/paths.mjs';

function verifyPlanning() {
  const original = process.env.WORKERS;
  delete process.env.WORKERS;
  try {
    assert.deepEqual(resolveRenderConcurrency(600, {}, 32), { workerCount: 2, cpuBudget: 31 });
    assert.equal(resolveRenderConcurrency(2400, {}, 32).workerCount, 8);
    assert.equal(resolveRenderConcurrency(120, {}, 32).workerCount, 1);
    assert.equal(resolveRenderConcurrency(2400, { maxAutoWorkers: 2 }, 32).workerCount, 2);
    assert.equal(resolveRenderConcurrency(2400, { maxAutoWorkers: 2, workers: 4 }, 32).workerCount, 4);
    assert.equal(resolveRenderConcurrency(60, {}, 32).workerCount, 1);
    assert.equal(resolveRenderConcurrency(600, { workers: 100 }, 8).workerCount, 2);
    assert.equal(resolveRenderConcurrency(600, { workers: 8 }, 1).workerCount, 1);
    process.env.WORKERS = '3';
    assert.equal(resolveRenderConcurrency(600, {}, 32).workerCount, 3);
    assert.equal(resolveRenderConcurrency(600, { workers: 2 }, 32).workerCount, 2);
  } finally {
    if (original === undefined) delete process.env.WORKERS;
    else process.env.WORKERS = original;
  }
  const segments = [{ idx: 0, f0: 3, f1: 1003, partPath: '/cache/long.mp4' }, { idx: 1, f0: 1003, f1: 1009, partPath: '/cache/short.mp4' }];
  const { groups, jobs } = buildRenderTasks(segments, 4, 1, '/temporary');
  assert.ok(groups[0].parts.length > 4, 'One long scene must provide work to multiple workers');
  for (const { segment, parts } of groups) {
    assert.equal(parts[0].f0, segment.f0);
    assert.equal(parts.at(-1).f1, segment.f1);
    parts.slice(1).forEach((part, i) => assert.equal(part.f0, parts[i].f1, 'Chunk boundaries must have no missing or repeated frames'));
  }
  assert.equal(groups[1].parts[0].partPath, segments[1].partPath, 'Short scenes must retain direct cache publication');
  assert.equal(jobs.at(-1).idx, 1, 'Longer chunks should run first');
  assert.deepEqual(buildRenderTasks(segments, 1, 1, '/temporary').jobs.map(job => job.partPath), segments.map(segment => segment.partPath));
  assert.deepEqual(buildRenderTasks([], 4, 30, '/temporary').jobs, []);
  console.log('CPU allocation, balanced chunks and exact frame coverage PASSED.');
}

function writeFixture(root) {
  const dir = path.join(root, 'videos/demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../base/css/base.css"></head><body><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script></body></html>');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,fps:6,audioSrc:false,bgm:false,lead:0,gap:0,tail:0,ui:{hud:false,livePause:false},sceneScripts:["scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'V.scene({duration:13.1,transition:"none",lines:[],build(){},update(t){this.root.style.background=t<6.5?"#ff0000":"#0000ff";}});V.scene({duration:1,transition:"none",lines:[],build(root){root.style.background="#00ff00";},update(){}});');
}

function writeLauncher(root, failure = '') {
  const file = path.join(root, 'launch.mjs');
  const failing = path.join(root, 'fail.mjs');
  fs.writeFileSync(failing, 'import fs from "node:fs";fs.writeFileSync(process.argv.at(-1),"partial");console.error("Intentional parallel render failure");process.exit(9);');
  fs.writeFileSync(file, [
    'import os from "node:os";import cp from "node:child_process";',
    'import {syncBuiltinESMExports} from "node:module";import {pathToFileURL} from "node:url";',
    'os.availableParallelism=()=>8;',
    `const failure=${JSON.stringify(failure)},failing=${JSON.stringify(failing)};`,
    'const original=cp.spawn;cp.spawn=function(bin,args,opts){',
    'const chunk=failure==="chunk"&&args.includes("image2pipe")&&args.at(-1).includes("scene-0-part-1.mp4");',
    'const merge=failure==="merge"&&args.includes("concat")&&args.at(-1).includes("render-cache");',
    'return chunk||merge?original(process.execPath,[failing,...args],opts):original(bin,args,opts);};',
    'syncBuiltinESMExports();const [script,...args]=process.argv.slice(2);process.argv=[process.execPath,script,...args];await import(pathToFileURL(script).href);',
  ].join('\n'));
  return file;
}

function runRender(root, workers, failure = '') {
  const render = path.join(path.dirname(fileURLToPath(import.meta.url)), 'render.mjs');
  return spawnSync(process.execPath, [writeLauncher(root, failure), render, 'demo', path.join(root, 'output.mp4'), '--workers', String(workers)], {
    cwd: root, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, VIDEO_PROJECT_ROOT: root, FFMPEG_BIN: resolveFfmpeg() },
  });
}

function verifyFrames(root) {
  const decoded = spawnSync(resolveFfmpeg(), ['-v', 'error', '-i', path.join(root, 'output.mp4'), '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  const bytes = 320 * 180 * 3;
  assert.equal(decoded.stdout.length, bytes * 85, 'Scene and chunk joins must preserve all 85 frames');
  for (let index = 0; index < 85; index++) {
    const pixel = decoded.stdout.subarray(index * bytes + (90 * 320 + 160) * 3, index * bytes + (90 * 320 + 160) * 3 + 3);
    const expected = index < 39 ? 0 : index < 79 ? 2 : 1;
    assert.ok(pixel[expected] > 220 && [...pixel].filter((_, channel) => channel !== expected).every(value => value < 30), `Unexpected frame at index ${index}: ${pixel}`);
  }
}

function verifyIntegration(parent) {
  fs.mkdirSync(parent, { recursive: true });
  const suite = fs.mkdtempSync(path.join(parent, '分片 缓存-'));
  const roots = ['sequential', 'parallel', 'chunk-failure', 'merge-failure'].map(name => path.join(suite, name));
  roots.forEach(writeFixture);
  for (const [index, workers] of [1, 2].entries()) {
    const result = runRender(roots[index], workers);
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    if (workers === 2) assert.match(result.stdout, /2 workers, 1 encoder threads\/worker, 3 chunks/);
    verifyFrames(roots[index]);
  }
  const cache = root => fs.readdirSync(path.join(root, '.runtime/render-cache/demo')).sort();
  const before = cache(roots[1]);
  assert.equal(before.length, 2, 'Persistent cache must contain one MP4 per scene');
  assert.deepEqual(before, cache(roots[0]), 'Workers and encoder threads must not change scene cache keys');
  const warm = runRender(roots[1], 1);
  assert.equal(warm.status, 0, warm.stderr);
  assert.match(warm.stdout, /cache 2\/2 scenes hit/);
  assert.deepEqual(cache(roots[1]), before);
  for (const [index, mode] of ['chunk', 'merge'].entries()) {
    const root = roots[index + 2];
    fs.writeFileSync(path.join(root, 'output.mp4'), 'previous complete output');
    const failed = runRender(root, 2, mode);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Intentional parallel render failure/);
    assert.equal(fs.readFileSync(path.join(root, 'output.mp4'), 'utf8'), 'previous complete output');
    assert.equal(cache(root).some(name => name.startsWith('s00-')), false, 'Failed scene parts must not become a valid scene cache');
    assert.equal(fs.readdirSync(path.join(root, '.runtime')).some(name => name.startsWith('render-demo-')), false, 'Workers must settle before temporary files are cleaned');
  }
  console.log('Parallel frame order, scene cache reuse, chunk/merge failures and output preservation PASSED.');
}

verifyPlanning();
if (process.argv[2]) verifyIntegration(path.resolve(process.argv[2]));
