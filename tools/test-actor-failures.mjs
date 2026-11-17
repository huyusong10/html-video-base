import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const base = new URL('../runtime/base/js/core/', import.meta.url);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function createRuntime() {
  const reported = [];
  const node = name => ({ name, isConnected: true, style: { visibility: '' }, children: [],
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    remove() { this.removed = true; this.isConnected = false; },
  });
  const stage = node('stage');
  const sandbox = vm.createContext({ console: { error: error => reported.push(error) }, performance,
    AbortController, DOMException, setTimeout, clearTimeout,
    document: { getElementById: id => id === 'stage' ? stage : null } });
  for (const file of ['01-registry.js', '02-math.js']) {
    vm.runInContext(fs.readFileSync(new URL(file, base), 'utf8'), sandbox);
  }
  sandbox.V.u.h = (tag, props) => node(props.id || tag);
  for (const file of ['06-layers.js', '12c-frame.js', '12d-sources.js', '12e-components.js', '12f-actors.js']) {
    vm.runInContext(fs.readFileSync(new URL(file, base), 'utf8'), sandbox);
  }
  const V = sandbox.V;
  V.getSceneEnergy = () => 0;
  const scene = { start: 0, duration: 10 };
  V.scenes = [scene];
  const frame = V._frameRuntime.begin(scene, 0, 1, 1, 0,
    { isRecord: false, precise: true, playing: false, ended: false });
  return { V, stage, frame, reported };
}

async function disposeWithoutWaiting(actor) {
  let timer;
  try {
    await Promise.race([actor.dispose(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Actor disposal waited for the pending loader')), 250);
    })]);
  } finally { clearTimeout(timer); }
}

{
  const { V, frame, stage } = createRuntime();
  let finish, disposedData, disposeCalls = 0;
  const data = { model: 'late model' };
  const actor = V.actor({ id: 'late-dispose', renderer: {
    mount: () => new Promise(resolve => { finish = resolve; }),
    dispose(context) { disposedData = context.data; disposeCalls++; },
  } });
  actor.update({}, frame);
  await tick();
  await disposeWithoutWaiting(actor);
  assert.equal(stage.children[0].removed, true);
  assert.equal(disposeCalls, 0, 'Pending mount cleanup must retain the eventual data');
  finish(data);
  await tick();
  await actor.dispose();
  assert.equal(disposedData, data);
  assert.equal(disposeCalls, 1, 'The late model must be released once');
}

{
  const { V, frame } = createRuntime();
  let fail, disposeCalls = 0;
  const actor = V.actor({ id: 'late-reject', renderer: {
    mount: () => new Promise((_, reject) => { fail = reject; }),
    dispose() { disposeCalls++; },
  } });
  actor.mount(frame);
  await tick();
  await disposeWithoutWaiting(actor);
  fail(new Error('Loader stopped after cancellation'));
  await tick();
  assert.equal(disposeCalls, 1, 'A pending mount that later rejects must release partial resources');
}

{
  const { V, frame, reported } = createRuntime();
  let finish, disposedData, disposeCalls = 0;
  const data = { model: 'late after timeout' };
  const cleanupError = new Error('Late cleanup failed');
  const actor = V.actor({ id: 'late-timeout', readyTimeoutMs: 10, renderer: {
    mount: () => new Promise(resolve => { finish = resolve; }),
    dispose(context) { disposedData = context.data; disposeCalls++; throw cleanupError; },
  } });
  await assert.rejects(actor.mount(frame), /Initialization timed out/);
  await disposeWithoutWaiting(actor);
  finish(data);
  await tick();
  assert.equal(disposedData, data);
  assert.equal(disposeCalls, 1);
  assert.ok(reported.includes(cleanupError), 'Late cleanup failures must be observable');
  await actor.dispose();
  assert.equal(disposeCalls, 1);
}

{
  const { V, frame, stage } = createRuntime();
  let disposeCalls = 0;
  const actor = V.actor({ id: 'mount-failed', renderer: {
    mount() { throw new Error('Model could not load'); }, dispose() { disposeCalls++; },
  } });
  await assert.rejects(actor.mount(frame), /Model could not load/);
  await actor.dispose();
  assert.equal(disposeCalls, 1);
  assert.equal(stage.children[0].removed, true);
}

{
  const { V, frame, reported } = createRuntime();
  const frameErrors = [];
  V.use({ id: 'error-observer', onFrameError: info => frameErrors.push(info.error) });
  const actor = V.actor({ id: 'sync-failed', renderer: {
    mount: () => ({}), update() { throw new Error('Synchronous drawing failed'); },
  } });
  await actor.mount(frame);
  assert.doesNotThrow(() => actor.update({}, frame), 'A renderer failure must not interrupt the player tick');
  await assert.rejects(V._frameRuntime.prepare(frame), /Synchronous drawing failed/);
  V._frameRuntime.preview(frame);
  await tick();
  assert.equal(frameErrors.length, 1);
  assert.equal(reported.length, 1);
  await actor.dispose();
}

for (const thrown of [null, '', 0]) {
  const { V, frame } = createRuntime();
  const managedSource = V.managedSource;
  let rejected = false, received;
  V.managedSource = definition => managedSource({ ...definition,
    async prepare(...args) {
      try { return await definition.prepare(...args); }
      catch (error) { rejected = true; received = error; throw error; }
    },
  });
  const actor = V.actor({ id: 'falsy-failure', renderer: {
    mount: () => ({}), update() { throw thrown; },
  } });
  await actor.mount(frame);
  assert.doesNotThrow(() => actor.update({}, frame));
  await assert.rejects(V._frameRuntime.prepare(frame), error => Object.is(error.cause, thrown),
    'The frame error must preserve the original falsy renderer failure');
  assert.equal(rejected, true, 'Falsy renderer failures must reject preparation');
  assert.equal(received, thrown, 'The original thrown value must reach the frame source');
  await actor.dispose();
}

{
  const { V, frame, reported } = createRuntime();
  const unhandled = [];
  const receive = error => unhandled.push(error);
  process.on('unhandledRejection', receive);
  try {
    const actor = V.actor({ id: 'async-update', renderer: {
      mount: () => ({}), async update() { throw new Error('Rejected async drawing'); },
    } });
    await actor.mount(frame);
    assert.doesNotThrow(() => actor.update({}, frame));
    await assert.rejects(V._frameRuntime.prepare(frame), /update must be synchronous/);
    V._frameRuntime.preview(frame);
    await tick();
    assert.equal(unhandled.length, 0);
    assert.match(reported[0].message, /update must be synchronous/);
    await actor.dispose();
  } finally { process.off('unhandledRejection', receive); }
}

{
  const { V, frame } = createRuntime();
  const cleanupError = new Error('Renderer disposal failed');
  let wrapperRemoved = 0;
  const actor = V.actor({ id: 'failed-disposal', layer: {}, renderer: {
    mount: () => ({}), dispose() { throw cleanupError; },
  } });
  const layer = V.layers.find(item => item.id === 'failed-disposal');
  layer.build({ appendChild() {}, remove() { wrapperRemoved++; } });
  await actor.mount(frame);
  await assert.rejects(actor.dispose(), error => error === cleanupError);
  assert.equal(wrapperRemoved, 1);
  assert.equal(V.layers.includes(layer), false);
}

console.log('Actor cancellation, late resources, cleanup and renderer failure regressions passed.');
