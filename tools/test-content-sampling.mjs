import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './lib/paths.mjs';
import { readVideoMetadata, readVideoCatalog, createSearchIndex, createVideoManifest, readVideoManifest } from './content.mjs';
import { sampleFrames } from './sampling.mjs';
import { captureBatch } from './audit-capture.mjs';

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/content-api-'));
const videoDir = path.join(root, 'videos/demo');
fs.mkdirSync(path.join(videoDir, 'js'), { recursive: true });
fs.mkdirSync(path.join(videoDir, 'assets/voice'), { recursive: true });
fs.writeFileSync(path.join(videoDir, 'index.html'), '<script src="video.config.js"></script><img src="assets/cover.png">');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), "V.config={title:'Demo',width:320,height:180,sceneScripts:['js/z-first.js','js/a-second.js']};");
fs.writeFileSync(path.join(videoDir, 'js/z-first.js'), "V.scene({id:'first',title:'First',lines:[{text:'First sentence',anchors:{focus:0.4}}],build(){return 'assets/model.glb';}});");
fs.writeFileSync(path.join(videoDir, 'js/a-second.js'), "V.scenes.push({id:'second',title:'Second',lines:['Second sentence'],build(){return 'Second label';}});");
fs.writeFileSync(path.join(videoDir, 'assets/voice/timings.js'), "V.voice={bakedLayout:{duration:1234,scenes:[{start:0,duration:400,cues:[[0.2,390]]},{start:400,duration:834,cues:[[0.2,830]]}]}};");

test('content metadata follows configured script order and preserves declarations without leaking a VM', () => {
  const metadata = readVideoMetadata({ projectRoot: root, id: 'demo', includeLiterals: true, includeAssets: true });
  assert.equal(metadata.duration, 1234);
  assert.deepEqual(metadata.scenes.map(scene => scene.id), ['first', 'second']);
  assert.equal(metadata.scenes[0].lines[0].anchors.focus, 0.4);
  assert.ok(metadata.scenes[1].literals.includes('Second label'));
  assert.ok(metadata.assetReferences.includes('assets/model.glb'));
  assert.ok(metadata.assetReferences.includes('assets/cover.png'));
  assert.equal(metadata.sandbox, undefined);
  assert.doesNotThrow(() => JSON.stringify(metadata));
  assert.notEqual(readVideoMetadata({ projectRoot: root, id: 'demo', ignoreBaked: true }).duration, 1234);
});

test('catalog, index and manifest share the same scene times and allow business fields', () => {
  const catalog = readVideoCatalog({ projectRoot: root, ids: ['demo'] });
  const index = createSearchIndex(catalog, { mapVideo: () => ({ chapter: 'A' }), mapScene: scene => ({ keywords: scene.id }) });
  assert.equal(index.videos.demo.chapter, 'A');
  assert.equal(index.scenes[1].startSec, 400);
  assert.equal(index.scenes[1].keywords, 'second');
  const manifest = createVideoManifest(catalog, { mapVideo: () => ({ department: 'Training' }) });
  assert.equal(manifest[0].scenes, 2);
  assert.equal(manifest[0].department, 'Training');
  fs.writeFileSync(path.join(root, 'videos/manifest.js'), `/* generated */\nwindow.VIDEO_MANIFEST = ${JSON.stringify(manifest)};\n`);
  assert.deepEqual(readVideoManifest({ projectRoot: root }), manifest);
});

const timeline = { scenes: [
  { start: 0, duration: 10, cues: [{ start: 0.2, end: 3 }, { start: 3.5, end: 6 }, { start: 6.5, end: 9.8 }] },
  { start: 10, duration: 0.1, cues: [] },
] };

test('sampling defaults to one representative cue and supports explicit scene/cue scope', () => {
  const smoke = sampleFrames(timeline);
  assert.equal(smoke.length, 3);
  assert.ok(smoke.every(point => point.sceneIndex === 0 && point.cueIndex === 0));
  const selected = sampleFrames(timeline, { scenes: [0], cues: [2], positions: ['mid'] });
  assert.equal(selected[0].time, 6.5 + (9.8 - 6.5) * 0.52);
  assert.equal(sampleFrames(timeline, { mode: 'all' }).length, 10);
  assert.ok(sampleFrames(timeline, { scenes: [1] })[0].time < 10.1);
  const shortCue = { scenes: [{ start: 0, duration: 1, cues: [{ start: 0.4, end: 0.5 }] }] };
  assert.ok(sampleFrames(shortCue).every(point => point.time >= 0.4 && point.time < 0.5));
});

test('sampling rejects invalid selection and sampling positions', () => {
  assert.throws(() => sampleFrames(timeline, { scenes: [8] }), /out of range/);
  assert.throws(() => sampleFrames(timeline, { cues: [8] }), /out of range/);
  assert.throws(() => sampleFrames(timeline, { positions: [1.2] }), /Invalid sample position/);
  assert.throws(() => sampleFrames(timeline, { mode: 'everything' }), /Unknown sample mode/);
});

test('batch capture serializes points, streams images and keeps generated names inside the output directory', async () => {
  const order = [], observed = [], outDir = path.join(root, 'captures');
  const result = await captureBatch([{ time: 1, name: '../../unsafe' }, { time: 2, name: 'safe' }], {
    outDir, onCapture: (item, image) => observed.push([item.point.time, image.toString()]),
  }, async (time, options) => {
    order.push('start' + time);
    await Promise.resolve();
    order.push('end' + time);
    assert.equal(path.dirname(options.path), outDir);
    return { frame: { now: time }, image: Buffer.from('image' + time) };
  });
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2']);
  assert.deepEqual(observed, [[1, 'image1'], [2, 'image2']]);
  assert.equal(result[0].image, undefined);
});

test('batch cancellation stops before the next capture', async () => {
  const abort = new AbortController(), captured = [];
  await assert.rejects(captureBatch([1, 2], { signal: abort.signal }, async time => {
    captured.push(time); abort.abort(); return { frame: { now: time }, image: Buffer.alloc(0) };
  }), { name: 'AbortError' });
  assert.deepEqual(captured, [1]);
  await assert.rejects(captureBatch([NaN], {}, async () => {}), /finite time/);
});
