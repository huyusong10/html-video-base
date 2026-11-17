import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const core = new URL('../runtime/base/js/core/', import.meta.url);
const source = ['01-registry.js', '02-math.js', '10-subtitles.js', '12e-components.js']
  .map(file => [file, fs.readFileSync(new URL(file, core), 'utf8')]);

function fixture() {
  const sandbox = vm.createContext({ console, URLSearchParams, location: { search: '' } });
  for (const [file, code] of source) vm.runInContext(code, sandbox, { filename: file });
  const V = sandbox.V;
  const frame = Object.freeze({ id: 1, sceneIndex: 0, playing: false, isRecord: false });
  V.getFrameState = () => frame;
  V.getSceneEnergy = () => 0.4;
  const cue = { start: 0, end: 2, text: 'Subtitle', speaker: null };
  const scene = { duration: 3, cues: [cue] };
  const lead = { innerHTML: '', children: [], appendChild(child) { this.children.push(child); } };
  const text = { firstChild: {}, lastChild: {} };
  const subs = { dataset: {}, style: { setProperty() {}, removeProperty() {} },
    querySelector(selector) {
      if (selector === '.sub-lead') return lead;
      if (selector === '.sub-text') return text;
      return null;
    } };
  function tick() { V._subtitlesRuntime.updateSubs(scene, 0, 0.5, 0.5, 0.5, true); }
  return { V, frame, cue, lead, subs, tick };
}

function checkCallbacks(name, configKeys, runtimeKeys, selected) {
  const { V, frame, cue, lead, subs, tick } = fixture();
  const calls = [];
  const callback = label => (receivedCue, info, dom) => {
    assert.equal(receivedCue, cue, name + ': original callback receives the current cue');
    assert.equal(info.frame, frame, name + ': original callback receives the current frame');
    assert.equal(dom.subs, subs, name + ': original callback receives the subtitle DOM');
    calls.push(label);
  };
  V.config.subtitles = Object.fromEntries(configKeys.map(key => [key, callback('config.' + key)]));
  V.subtitle(Object.fromEntries(runtimeKeys.map(key => [key, callback('runtime.' + key)])));
  V._subtitlesRuntime.bindSubElements(subs);
  tick();
  assert.deepEqual(calls, [selected], name + ': baseline callback selection');
  calls.length = 0;

  const element = { nodeType: 1 };
  const companion = V.subtitleCompanion({
    create(_h, runtime) { assert.equal(runtime, V); return element; },
    update(receivedElement, receivedCue, info, dom) {
      assert.equal(receivedElement, element);
      assert.equal(receivedCue, cue);
      assert.equal(info.frame, frame);
      assert.equal(dom.subs, subs);
      calls.push('companion');
    },
  });
  V._subtitlesRuntime.bindSubElements(subs);
  tick();
  assert.equal(companion.element, element);
  assert.deepEqual(lead.children, [element], name + ': companion mounts in the lead slot');
  assert.deepEqual(calls, [selected, 'companion'], name + ': preserved callback precedes the companion');
}

checkCallbacks('Configured onUpdate', ['onUpdate'], [], 'config.onUpdate');
checkCallbacks('Runtime onUpdate override', ['onUpdate'], ['onUpdate'], 'runtime.onUpdate');
checkCallbacks('Configured update alias', ['update'], [], 'config.update');
checkCallbacks('Runtime update alias override', ['update'], ['update'], 'runtime.update');
checkCallbacks('onUpdate priority across sources', ['onUpdate'], ['update'], 'config.onUpdate');

console.log('Subtitle companion preserves configured callbacks and runtime callback precedence.');
