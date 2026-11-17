import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PKG_ROOT } from './lib/paths.mjs';
import { readVideoMetadata, readVideoCatalog, createSearchIndex, createVideoManifest, readVideoManifest } from './content.mjs';
import { sampleFrames } from './sampling.mjs';
import { captureBatch } from './audit-capture.mjs';
import { startVideoServer } from './server.mjs';

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

test('search dictionaries preserve valid IDs that match Object prototype names', () => {
  const catalog = readVideoCatalog({ projectRoot: root, ids: ['demo'] });
  const index = createSearchIndex([{ ...catalog[0], id: '__proto__' }]);
  assert.ok(Object.hasOwn(index.videos, '__proto__'));
  assert.equal(index.scenes[0].videoId, '__proto__');
  assert.equal(JSON.parse(JSON.stringify(index)).videos.__proto__.title, 'Demo');
});

function layoutWithBaked(baked) {
  const sandbox = vm.createContext({ console });
  for (const name of ['01-registry.js', '02-math.js', '04-timeline.js']) {
    vm.runInContext(fs.readFileSync(path.join(PKG_ROOT, 'runtime/base/js/core', name), 'utf8'), sandbox);
  }
  const V = sandbox.V;
  V.scene({ lines: ['Example sentence'] });
  V.voice = { bakedLayout: baked };
  V.layout();
  return V;
}

test('incomplete, invalid or non-finite baked times fall back to an estimated, sampleable layout', () => {
  const valid = { duration: 10, scenes: [{ start: 0, duration: 10, cues: [[0.1, 0.9]] }] };
  const changes = [
    baked => { delete baked.duration; },
    baked => { delete baked.scenes[0].start; },
    baked => { delete baked.scenes[0].duration; },
    baked => { baked.duration = -1; },
    baked => { baked.duration = 0; },
    baked => { baked.scenes[0].start = -1; },
    baked => { baked.scenes[0].duration = -1; },
    baked => { baked.scenes[0].start = Infinity; },
    baked => { baked.scenes[0].duration = NaN; },
    baked => { baked.scenes[0].cues = [null]; },
    baked => { baked.scenes[0].cues = [[0.1]]; },
    baked => { baked.scenes[0].cues = [[0.1, NaN]]; },
    baked => { baked.scenes[0].cues = [[0.9, 0.1]]; },
  ];
  for (const change of changes) {
    const baked = structuredClone(valid);
    change(baked);
    const V = layoutWithBaked(baked);
    assert.equal(V.layoutInfo.source, 'estimated');
    assert.ok(Number.isFinite(V.duration) && Number.isFinite(V.scenes[0].start) && Number.isFinite(V.scenes[0].duration));
    assert.equal(sampleFrames({ scenes: V.scenes }).length, 3);
  }
  for (const cue of [[0.1, 0.9], [0.5, 0.5], [-0.2, 0.9], [0.1, 0.9, 'legacy extra field']]) {
    const baked = structuredClone(valid);
    baked.scenes[0].cues = [cue];
    const V = layoutWithBaked(baked);
    assert.equal(V.layoutInfo.source, 'baked');
    assert.equal(V.duration, 10);
  }
  const zeroScene = structuredClone(valid);
  zeroScene.scenes[0].duration = 0;
  zeroScene.scenes[0].cues = [[0, 0]];
  assert.equal(layoutWithBaked(zeroScene).layoutInfo.source, 'baked', 'Zero-duration scenes must remain compatible');
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

test('batch capture preserves every requested output when generated or explicit names collide', async () => {
  const outDir = path.join(root, 'collisions');
  const capture = async (time, options) => {
    const image = Buffer.from(String(time));
    fs.writeFileSync(options.path, image);
    return { frame: { now: time }, image };
  };
  const result = await captureBatch([{ name: 'shot', time: 1.001 }, { name: 'shot', time: 1.004 }], { outDir }, capture);
  assert.equal(path.basename(result[0].path), 'shot_1.00s.png');
  assert.equal(path.basename(result[1].path), 'shot_1.00s_2.png');
  assert.equal(fs.readFileSync(result[0].path, 'utf8'), '1.001');
  assert.equal(fs.readFileSync(result[1].path, 'utf8'), '1.004');
  const explicit = await captureBatch([1, 2], { screenshot: { path: path.join(outDir, 'explicit.png') } }, capture);
  assert.notEqual(explicit[0].path, explicit[1].path);
  assert.equal(fs.readFileSync(explicit[0].path, 'utf8'), '1');
  assert.equal(fs.readFileSync(explicit[1].path, 'utf8'), '2');
});

test('batch cancellation stops before the next capture', async () => {
  const abort = new AbortController(), captured = [];
  await assert.rejects(captureBatch([1, 2], { signal: abort.signal }, async time => {
    captured.push(time); abort.abort(); return { frame: { now: time }, image: Buffer.alloc(0) };
  }), { name: 'AbortError' });
  assert.deepEqual(captured, [1]);
  await assert.rejects(captureBatch([NaN], {}, async () => {}), /finite time/);
});

test('invalid server hosts reject without leaving a listening server', async () => {
  const servers = () => process._getActiveHandles().filter(handle => handle.constructor.name === 'Server' && handle.listening);
  const before = new Set(servers());
  let added;
  try {
    for (const host of [null, 12, {}, '', '  ']) {
      await assert.rejects(startVideoServer({ projectRoot: root, host }), /host must be a non-empty string/);
    }
  } finally {
    added = servers().filter(server => !before.has(server));
    await Promise.all(added.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); })));
  }
  assert.equal(added.length, 0);
});
