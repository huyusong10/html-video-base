import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.argv[2]);
process.env.VIDEO_PROJECT_ROOT = root;
const videoDir = path.join(root, 'videos/demo');
const voiceDir = path.join(videoDir, 'assets/voice');
fs.mkdirSync(voiceDir, { recursive: true });
fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><script src="../base/js/engine.js"></script><script src="video.config.js"></script><script src="scenes.js"></script>');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={audioSrc:false,bgm:false,sceneScripts:["scenes.js"]};');
const scenePath = path.join(videoDir, 'scenes.js');
fs.writeFileSync(scenePath, 'V.scene({duration:1,lines:[],build(){},update(){}});');
const timings = path.join(voiceDir, 'timings.js');
fs.writeFileSync(timings, 'window.V=window.V||{};V.voice={voice:"previous",src:false,durations:[[]],words:[[]],envelopes:[[]]};');
const { stampBakedLayout } = await import('./verify-sync.mjs');
const { writeSubtitleFiles } = await import('./lib/subtitles.mjs');

function loadVoice() {
  const V = {};
  vm.runInNewContext(fs.readFileSync(timings, 'utf8'), { V, window: { V } });
  return V.voice;
}

function snapshot(files) {
  const folder = path.dirname(files[0]);
  return { folder, names: fs.readdirSync(folder).sort(), files: files.map(file => [file, fs.readFileSync(file)]) };
}

function assertPreserved(before) {
  for (const [file, bytes] of before.files) {
    assert.ok(bytes.equals(fs.readFileSync(file)), `A failed text output must preserve ${path.basename(file)}`);
  }
  assert.deepEqual(fs.readdirSync(before.folder).sort(), before.names, 'Text output must clean only its own temporary files');
}

function failWrite(folder, failAt, action) {
  const original = fs.writeFileSync;
  let writes = 0, injected = false;
  try {
    fs.writeFileSync = function(file, data, options) {
      if (path.dirname(path.resolve(file)) === folder && ++writes === failAt) {
        original(file, Buffer.from(data).subarray(0, 8), options);
        injected = true;
        throw new Error('Intentional text write failure after opening output');
      }
      return original(file, data, options);
    };
    assert.throws(action, /Intentional text write failure/);
    assert.ok(injected, 'The test must exercise a real partial file write');
  } finally { fs.writeFileSync = original; }
}

function failRename(target, action) {
  const original = fs.renameSync;
  let injected = false;
  try {
    fs.renameSync = function(source, destination) {
      if (path.resolve(destination) === target) {
        injected = true;
        throw new Error('Intentional text publication failure');
      }
      return original(source, destination);
    };
    assert.throws(action, /Intentional text publication failure/);
    assert.ok(injected, 'The test must exercise replacement of the intended output');
  } finally { fs.renameSync = original; }
}

stampBakedLayout('demo');
const previousTiming = snapshot([timings]);
assert.equal(loadVoice().bakedLayout.duration, 1);
failWrite(voiceDir, 1, () => stampBakedLayout('demo'));
assertPreserved(previousTiming);
assert.equal(loadVoice().bakedLayout.duration, 1, 'The preserved timing JavaScript must remain usable');
failRename(timings, () => stampBakedLayout('demo'));
assertPreserved(previousTiming);
fs.writeFileSync(scenePath, 'V.scene({duration:2,lines:[],build(){},update(){}});');
stampBakedLayout('demo');
assert.equal(loadVoice().bakedLayout.duration, 2, 'A successful retry must replace the previous timing data');
assert.ok(!fs.readFileSync(timings).equals(previousTiming.files[0][1]));
assert.deepEqual(fs.readdirSync(voiceDir).sort(), previousTiming.names);

const cues = { scenes: [{ start: 0, subCues: [{ start: 0, end: 1, text: '原有字幕' }] }] };
const { vttPath, srtPath } = writeSubtitleFiles(videoDir, cues);
const previousCaptions = snapshot([vttPath, srtPath]);
for (const failAt of [1, 2]) {
  failWrite(path.dirname(vttPath), failAt, () => writeSubtitleFiles(videoDir, cues));
  assertPreserved(previousCaptions);
}
for (const target of [vttPath, srtPath]) {
  failRename(target, () => writeSubtitleFiles(videoDir, cues));
  assertPreserved(previousCaptions);
}
cues.scenes[0].subCues[0] = { start: 0, end: 2, text: '更新后的字幕' };
writeSubtitleFiles(videoDir, cues);
const vtt = fs.readFileSync(vttPath, 'utf8'), srt = fs.readFileSync(srtPath, 'utf8');
assert.ok(vtt.startsWith('WEBVTT\n'));
assert.ok(vtt.includes('00:00:02.000') && vtt.includes('更新后的字幕'));
assert.ok(srt.includes('00:00:02,000') && srt.includes('更新后的字幕'));
assert.deepEqual(fs.readdirSync(path.dirname(vttPath)).sort(), previousCaptions.names);

const englishCues = { scenes: [{ start: 0, subCues: [{ start: 0, end: 1, text: 'English caption' }] }] };
const english = writeSubtitleFiles(videoDir, englishCues, 'en');
const englishPaths = [english.vttPath, english.srtPath];
const englishBytes = englishPaths.map(file => fs.readFileSync(file));
const unrelated = path.join(videoDir, 'assets/notes.txt');
fs.writeFileSync(unrelated, 'Keep unrelated output');
const empty = { scenes: [] };
assert.equal(writeSubtitleFiles(videoDir, empty), null);
assert.equal(fs.existsSync(vttPath), false, 'Empty cues must remove a previously generated VTT');
assert.equal(fs.existsSync(srtPath), false, 'Empty cues must remove a previously generated SRT');
for (let index = 0; index < englishPaths.length; index++) {
  assert.ok(fs.readFileSync(englishPaths[index]).equals(englishBytes[index]), 'Clearing one language must preserve another language');
}
assert.equal(writeSubtitleFiles(videoDir, empty), null, 'Repeated clearing must be harmless');
writeSubtitleFiles(videoDir, cues);
const regenerated = [vttPath, srtPath].map(file => fs.readFileSync(file));
assert.equal(writeSubtitleFiles(videoDir, empty, 'en'), null);
for (let index = 0; index < englishPaths.length; index++) {
  assert.equal(fs.existsSync(englishPaths[index]), false, 'Clearing a locale must remove only that locale subtitle files');
  assert.ok(fs.readFileSync([vttPath, srtPath][index]).equals(regenerated[index]), 'Locale clearing must preserve the base subtitles');
}
assert.equal(fs.readFileSync(unrelated, 'utf8'), 'Keep unrelated output');
const bareVideo = path.join(root, 'videos/empty');
fs.mkdirSync(bareVideo, { recursive: true });
assert.equal(writeSubtitleFiles(bareVideo, empty), null);
assert.equal(fs.existsSync(path.join(bareVideo, 'assets')), false, 'Empty cues must not create a new assets directory');


for (const invalidLang of ['../en', 'en\\sub', 'en\u0000']) {
  assert.throws(() => writeSubtitleFiles(videoDir, empty, invalidLang), /Invalid language code/);
}
assert.equal(fs.readFileSync(unrelated, 'utf8'), 'Keep unrelated output');
for (let index = 0; index < regenerated.length; index++) {
  assert.ok(fs.readFileSync([vttPath, srtPath][index]).equals(regenerated[index]), 'Rejected language paths must preserve existing subtitles');
}
console.log('Timing/caption write protection, successful retry, UTF-8, empty output, locale clearing and path boundaries PASSED.');
