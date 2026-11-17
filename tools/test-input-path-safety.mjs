import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, resolveFfmpeg, resolvePython, resolveLangMediaPaths, localizeMediaRel, loadVideoSandbox } from './lib/paths.mjs';

const base = path.resolve(process.argv[2]);
fs.mkdirSync(base, { recursive: true });
const cli = path.join(PKG_ROOT, 'bin/html-video.mjs');
const python = resolvePython(undefined, true);
const ffmpeg = resolveFfmpeg();
const cases = [
  { name: 'build-lang', mode: 'build', id: 'demo', lang: '../../../keep' },
  { name: 'mix-lang', mode: 'mix', id: 'demo', lang: '../../../keep' },
  { name: 'build-id', mode: 'build', id: '../../../source', lang: '' },
];
function inside(file, root) {
  const rel = path.relative(root, file);
  assert.ok(rel && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel), `Fixture must remain inside ${root}: ${file}`);
}
const results = [];
for (const lang of ['en', 'zh-Hant-TW', 'pt_BR', 'es-419', '中文']) {
  assert.equal(localizeMediaRel('assets/soundtrack.m4a', lang), `assets/soundtrack.${lang}.m4a`);
  assert.equal(resolveLangMediaPaths({}, lang).timingsRel, `assets/voice/timings.${lang}.js`);
}
for (const invalid of ['../../keep', '..\\..\\keep', '.', '..', '... ', '\0en']) {
  assert.throws(() => localizeMediaRel('assets/soundtrack.m4a', invalid), /Invalid language code/);
  assert.throws(() => resolveLangMediaPaths({ audioSrc: false, bgm: false }, invalid), /Invalid language code/);
  assert.throws(() => loadVideoSandbox(base, 'demo', { lang: invalid }), /Invalid language code/);
  assert.throws(() => loadVideoSandbox(base, invalid), /Invalid video id/);
}
for (const spec of cases) {
  const project = path.join(base, spec.name, 'nested/project');
  const videoDir = path.resolve(project, 'videos', spec.id);
  const temporary = path.join(project, '.runtime', `${spec.mode}-${spec.id}${spec.lang ? '-' + spec.lang : ''}`);
  inside(videoDir, base);
  inside(temporary, project);
  assert.equal(temporary, path.join(project, spec.lang ? 'keep' : 'source'));
  fs.mkdirSync(path.join(videoDir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(videoDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,tts:false,sceneScripts:["js/scenes.js"]};');
  fs.writeFileSync(path.join(videoDir, 'js/scenes.js'), 'V.scene({duration:1,lines:[],build(){},update(){}});');
  if (spec.mode === 'mix') {
    const timings = path.resolve(videoDir, `assets/voice/timings.${spec.lang}.js`);
    inside(timings, base);
    fs.mkdirSync(path.dirname(timings), { recursive: true });
    fs.writeFileSync(timings, 'V.voice=' + JSON.stringify({ src: false, durations: [[]], words: [[]], envelopes: [[]], lang: spec.lang }) + ';');
  }
  fs.mkdirSync(temporary, { recursive: true });
  const marker = path.join(temporary, 'keep.txt');
  fs.writeFileSync(marker, 'unrelated existing directory');
  const args = [cli, spec.mode, spec.id, ...(spec.lang ? ['--lang', spec.lang] : [])];
  const r = spawnSync(process.execPath, args, { cwd: project, env: { ...process.env, VIDEO_PROJECT_ROOT: project, PYTHON_BIN: python, FFMPEG_BIN: ffmpeg }, encoding: 'utf8', timeout: 30000 });
  results.push({ name: spec.name, status: r.status, markerPreserved: fs.existsSync(marker), stdout: r.stdout, stderr: r.stderr, error: String(r.error || '') });
}
for (const result of results) {
  assert.ok(result.markerPreserved && result.status !== 0, `${result.name}: Invalid identifiers must be rejected before temporary-directory cleanup\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Invalid language code|Invalid video id/);
}
console.log('Input path components and build/remix source preservation regressions PASSED.');
