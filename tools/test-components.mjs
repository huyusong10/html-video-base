import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sandbox = { console, performance, AbortController, DOMException, setTimeout, clearTimeout };
vm.createContext(sandbox);
for (const file of ['01-registry.js', '02-math.js', '06-layers.js', '12c-frame.js', '12d-sources.js', '12e-components.js', '12f-actors.js']) {
  vm.runInContext(fs.readFileSync(new URL('../runtime/base/js/core/' + file, import.meta.url), 'utf8'), sandbox);
}
const V = sandbox.V;
V.environment = { isRecord: false, mode: 'interactive' };
V.getSceneEnergy = () => 0;
const scene = { start: 0, duration: 10 };
V.scenes = [scene];
const frame = (time, record = false) => V._frameRuntime.begin(scene, 0, time, time, 0,
  { isRecord: record, precise: true, playing: false, ended: false });

const manual = V.manualState();
manual.set('chosen', frame(1));
assert.equal(manual.resolve('automatic'), 'chosen');
assert.equal(manual.resolve('automatic', frame(1, true)), 'automatic');
V.emit('onSeek', 2);
assert.equal(manual.resolve('automatic', frame(2)), 'automatic');
const bound = {};
V.manualState({ resetOn: [] }).bind(bound, 'selection', undefined);
assert.equal(bound.selection, undefined, 'An explicit undefined fallback must stay undefined');
bound.selection = 3;
assert.equal(bound.selection, 3);
frame(2, true);
assert.equal(bound.selection, undefined, 'Record frames must not expose a preview selection');

const response = V.pointerResponse({ hitTest: () => true });
const pointerFrame = { id: 100, isRecord: false, playing: false, uiDt: 0.1,
  pointer: { x: 900, y: 400, rawX: 900, rawY: 400, active: true, inside: true, overUI: false } };
const geometry = { x: 900, y: 400, eyeY: 380, opacity: 1 };
assert.equal(response.update(pointerFrame, geometry), response.update(pointerFrame, geometry), 'One frame must advance smoothing once');

let resolveMount, mounted = false, drawn = null, disposed = 0, updates = 0, mounts = 0;
const element = { isConnected: true, style: { visibility: '' } };
const actor = V.actor({ id: 'fake-3d', element: () => element,
  renderer: { capabilities: { dimensions: 3, poses: ['custom-pose'] },
    mount: () => { mounts++; return new Promise(resolve => { resolveMount = () => { mounted = true; resolve({ mixerTime: 0 }); }; }); },
    update(state, context) { updates++; assert.ok(mounted); assert.ok(context.data); },
    async prepare(state, { frame: current, signal, data }) {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      data.mixerTime = current.clock;
      drawn = { time: data.mixerTime, z: state.position.z, quaternion: state.quaternion.slice(), pose: state.pose };
    },
    dispose() { disposed++; },
  },
});
const state = { position: { x: 1, y: 2, z: 3 }, quaternion: [0, 0.5, 0, 0.866], pose: 'custom-pose' };
const first = frame(2, true);
actor.update(state, first);
const pending = V._frameRuntime.prepare(first);
await new Promise(resolve => setTimeout(resolve, 0));
resolveMount(); await pending;
await V._frameRuntime.prepare(first);
assert.equal(updates, 1, 'Waiting for the same prepared frame must apply its state once');
assert.deepEqual(drawn, { time: 2, z: 3, quaternion: state.quaternion, pose: 'custom-pose' });
const other = frame(8, true); actor.update(state, other); await V._frameRuntime.prepare(other);
const again = frame(2, true); actor.update(state, again); await V._frameRuntime.prepare(again);
assert.equal(drawn.time, 2, 'The mixer must sample the supplied time after backward seeking');
assert.equal(mounts, 1, 'Seeking must reuse one model initialization');
await actor.dispose(); await actor.dispose();
assert.equal(disposed, 1);
assert.throws(() => actor.update(state, again), /disposed/);

let removedLayer = 0;
const layerActor = V.actor({ id: 'layer-disposal', element: () => element,
  renderer: { mount: () => ({}) }, layer: { prop: 'guide' } });
const registeredLayer = V.layers.find(value => value.id === 'layer-disposal');
registeredLayer.build({ remove() { removedLayer++; } });
registeredLayer._mounted = true;
await layerActor.mount(again);
await layerActor.dispose();
assert.equal(V.layers.includes(registeredLayer), false);
assert.equal(removedLayer, 1, 'Disposing an actor must remove its owned persistent wrapper');
assert.doesNotThrow(() => V._layersRuntime.updateLayers(scene, 0, 2, 2, false), 'The platform must stop updating the disposed layer');
console.log('Manual values, pointer frame identity and asynchronous spatial renderer contracts passed.');
