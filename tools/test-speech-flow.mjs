import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG_ROOT, loadVideoSandbox } from './lib/paths.mjs';

const root = path.resolve(process.argv[2]);
const video = path.join(root, 'videos/demo');
const timing = path.join(video, 'assets/voice/timings.js');
const report = path.join(root, '.runtime/reports/demo/pauses.md');
const linesFile = path.join(root, 'lines.json');
const cuesFile = path.join(root, 'cues.json');
const text = '发现异常后执行命令。';
fs.mkdirSync(path.dirname(timing), { recursive: true });
fs.writeFileSync(path.join(video, 'index.html'), '<script src="../base/js/engine.js"></script><script src="video.config.js"></script>');

function config(pauseReport) {
  fs.writeFileSync(path.join(video, 'video.config.js'),
    `V.themeDefaults={pauseReport:true};V.config=${JSON.stringify({ lang: 'zh-CN', locales: ['en'], audioSrc: false,
      bgm: false, gap: 0.30, pauseReport, sceneScripts: ['scene.js'] })};`);
}

function writeScene(speechText, source = text) {
  const lines = [{ text: source, speechText, pause: 0.18 }, { text: '继续观察。' }];
  fs.writeFileSync(path.join(video, 'scene.js'), `V.scene({id:'demo',title:'检查流程',lines:${JSON.stringify(lines)}});`);
}

function run(tool, args, status = 0) {
  const result = spawnSync(process.execPath, [path.join(PKG_ROOT, 'tools', tool), ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, VIDEO_PROJECT_ROOT: root }, timeout: 15000 });
  assert.equal(result.status, status, result.stdout + '\n' + result.stderr);
  return result.stdout + result.stderr;
}

config(true);
writeScene('发现异常后，执行命令。');
fs.mkdirSync(path.join(video, 'locales'));
fs.writeFileSync(path.join(video, 'locales/en.js'),
  `V.locale('en',{scenes:{demo:{lines:['Run the command if needed.','Keep watching.']}}});`);
const localized = loadVideoSandbox(root, 'demo', { lang: 'en' }).sandbox.V.scenes[0].cues[0];
assert.equal(localized.spoken, 'Run the command if needed.', 'Translated text must not inherit base punctuation');

run('export.mjs', ['demo', linesFile, cuesFile]);
const exported = JSON.parse(fs.readFileSync(linesFile, 'utf8'));
assert.deepEqual(exported.scenes[0][0], { text, spoken: '发现异常后，直形命令。' });
const subtitle = fs.readFileSync(path.join(video, 'assets/subtitles.vtt'), 'utf8');
assert.match(subtitle, /发现异常后执行命令/);
assert.doesNotMatch(subtitle, /直形|异常后，/);

assert.match(run('verify-sync.mjs', ['demo'], 1), /Missing timings/);
const draft = fs.readFileSync(report, 'utf8');
assert.match(draft, /当前估算时间轴/);
assert.match(draft, /未测/);

const envelope = [...Array(9).fill(50), ...Array(9).fill(0), ...Array(12).fill(50)];
const voice = { src: false, spokenDigest: exported.spokenDigest, durations: [[1, 1]],
  envelopes: [[envelope, Array(30).fill(45)]],
  words: [[[[0.05, '发现'], [0.26, '异常后'], [0.65, '直形'], [0.8, '命令']], [[0.12, '继续观察']]]] };
fs.writeFileSync(timing, `V.voice=${JSON.stringify(voice)};`);
run('verify-sync.mjs', ['demo', '--stamp-baked']);
const measured = fs.readFileSync(report, 'utf8');
assert.match(measured, /已固化时间轴/);
assert.match(measured, /朗读文本与配音时记录的输入一致/);
assert.match(measured, /0\.48s（当前配置：gap 0\.30s \+ pause 0\.18s）/);
assert.match(measured, /00:00\.650–00:00\.950（0\.30s，附近词：异常后 \/ 直形）/);
assert.match(measured, /继续观察。.*未发现明显低声段/);

writeScene('发现异常后；执行命令。');
assert.match(run('verify-sync.mjs', ['demo'], 1), /Spoken input differs/);
assert.match(fs.readFileSync(report, 'utf8'), /句内估算来自旧配音/);

fs.rmSync(report);
config(undefined);
writeScene('发现异常后，执行命令。');
run('verify-sync.mjs', ['demo']);
assert.ok(!fs.existsSync(report), 'Only a video setting can enable the report');

writeScene('P，UE 为 1.25。', 'PUE 为 1.25。');
assert.throws(() => loadVideoSandbox(root, 'demo'), /S0L0: speechText may only change/);
writeScene('发现异常后执行新命令。');
assert.throws(() => loadVideoSandbox(root, 'demo'), /speechText may only change/);
writeScene('发现异常后执，行命令。');
assert.throws(() => loadVideoSandbox(root, 'demo'), /speechText must not break a configured pronunciation term/);
console.log('Speech input, subtitles, pause report and stale audio checks passed.');
