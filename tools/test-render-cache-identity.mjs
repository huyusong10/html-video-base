import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
fs.mkdirSync(root, { recursive: true });
process.env.VIDEO_PROJECT_ROOT = root;
const { buildCachedSceneSegments } = await import('./render.mjs');
const { loadVideoSandbox } = await import('./lib/paths.mjs');
const shared = path.join(root, 'videos/assets');
fs.mkdirSync(shared, { recursive: true });
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="red"/></svg>';

function createFixture(id, script) {
  const dir = path.join(root, 'videos', id);
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'components'));
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/scenes.js"]};');
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), script);
  const key = () => {
    const { sandbox } = loadVideoSandbox(root, id);
    return buildCachedSceneSegments(sandbox.V, sandbox.V.config, id, dir, 4, 320, 180, 4, '')[0].partPath;
  };
  return { dir, key };
}

function assertChanged(key, before, label) {
  const changed = key();
  assert.notEqual(changed, before, label);
  assert.equal(key(), changed, 'Stable inputs must retain their cache identity');
}

function verifySceneFieldBoundaries() {
  const scene = (id, title) => `V.scene({id:${JSON.stringify(id)},title:${JSON.stringify(title)},duration:1,lines:[],build(root){root.textContent=this.title;},update(){}});`;
  const { dir, key } = createFixture('scene-fields', scene('a|b', 'c'));
  const before = key();
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), scene('a', 'b|c'));
  assertChanged(key, before, 'Different scene fields must not collide through delimiter characters');
}

function imageScene(src) {
  return `V.scene({duration:1,lines:[],build(root){root.append(V.u.h('img',{src:${JSON.stringify(src)}}));},update(){}});`;
}

function verifyVisualAssetChanges() {
  const { dir, key } = createFixture('asset-changes', imageScene('assets/probe.svg'));
  const asset = path.join(dir, 'assets/probe.svg');
  const missing = key();
  fs.writeFileSync(asset, svg);
  const added = key();
  assert.notEqual(added, missing, 'Adding a visual asset must invalidate its scene cache');
  assert.equal(key(), added, 'Unchanged visual assets must retain their cache identity');
  fs.writeFileSync(asset, svg.replace('red', 'blue'));
  assertChanged(key, added, 'Modifying a visual asset must invalidate its scene cache');
  fs.unlinkSync(asset);
  assert.equal(key(), missing, 'Removing a visual asset must restore the original cache identity');
}

function verifyAssetOwnership() {
  const { dir, key } = createFixture('asset-owner', imageScene('../assets/owner.svg'));
  fs.writeFileSync(path.join(shared, 'owner.svg'), svg);
  const before = key();
  fs.copyFileSync(path.join(shared, 'owner.svg'), path.join(dir, 'assets/owner.svg'));
  fs.unlinkSync(path.join(shared, 'owner.svg'));
  assertChanged(key, before, 'Moving a file between shared and video assets must change its identity');
}

function verifyFileBoundaries(extra) {
  const folder = extra ? 'components' : 'assets';
  const { dir, key } = createFixture(extra ? 'extra-boundary' : 'asset-boundary', imageScene(`${folder}/b.svg`));
  const assets = path.join(dir, folder);
  fs.writeFileSync(path.join(assets, 'a.txt'), 'notes');
  fs.writeFileSync(path.join(assets, 'b.svg'), svg);
  const before = key();
  const oldHeader = extra ? 'file:components/b.svg:' : 'f:b.svg:';
  fs.writeFileSync(path.join(assets, 'a.txt'), 'notes' + oldHeader + svg);
  fs.unlinkSync(path.join(assets, 'b.svg'));
  assertChanged(key, before, 'File content must not absorb the identity of the next file');
}

function verifyAssetPaths() {
  const { dir, key } = createFixture('asset-paths', imageScene('assets/left/b.svg'));
  fs.mkdirSync(path.join(dir, 'assets/left'));
  fs.mkdirSync(path.join(dir, 'assets/right'));
  fs.writeFileSync(path.join(dir, 'assets/left/b.svg'), svg);
  const before = key();
  fs.copyFileSync(path.join(dir, 'assets/left/b.svg'), path.join(dir, 'assets/right/b.svg'));
  fs.unlinkSync(path.join(dir, 'assets/left/b.svg'));
  assertChanged(key, before, 'Nested asset paths must remain part of the cache identity');
}

function verifyAuthoredSceneData() {
  const scene = color => `V.scene({palette:{colors:[${JSON.stringify(color)}]},duration:1,lines:[],build(root){root.style.background=this.palette.colors[0];},update(){}});`;
  const { dir, key } = createFixture('scene-data', scene('red'));
  const before = key();
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), scene('blue'));
  assertChanged(key, before, 'Authored scene data used by an unchanged callback must invalidate its cache');
}

function verifyCrossModuleSharedCode() {
  const { dir, key } = createFixture('module-shared', 'V.scene({duration:1,lines:[],build(root){root.style.background=GLOBAL_COLOR;},update(){}});');
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,ui:{hud:false},sceneScripts:["js/scenes.js","js/shared.js"]};');
  const sharedScene = color => `const GLOBAL_COLOR=${JSON.stringify(color)};V.scene({duration:1,lines:[],build(root){root.style.background="gray";},update(){}});`;
  fs.writeFileSync(path.join(dir, 'js/shared.js'), sharedScene('red'));
  const before = key();
  fs.writeFileSync(path.join(dir, 'js/shared.js'), sharedScene('blue'));
  assertChanged(key, before, 'Shared code in another scene module must invalidate every dependent scene');
}

function verifySameModuleGranularity() {
  const scene = color => `V.scene({color:${JSON.stringify(color)},duration:1,lines:[],build(root){root.style.background=this.color;},update(){}});`;
  const { dir } = createFixture('same-module', scene('red') + scene('red'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="video.config.js"></script><script src="js/scenes.js"></script>');
  const keys = () => {
    const { sandbox } = loadVideoSandbox(root, 'same-module');
    return buildCachedSceneSegments(sandbox.V, sandbox.V.config, 'same-module', dir, 8, 320, 180, 4, '').map(segment => segment.partPath);
  };
  const before = keys();
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), scene('red') + scene('blue'));
  const changed = keys();
  assert.equal(changed[0], before[0], 'Changing a second inline definition must preserve the first scene cache');
  assert.notEqual(changed[1], before[1], 'Changing a second inline definition must invalidate its own cache');
  assert.deepEqual(keys(), changed, 'Unchanged authored definitions must retain both cache identities');
}

function verifyEntryScriptDependency() {
  const { dir, key } = createFixture('entry-script', 'V.scene({duration:1,lines:[],build(root){root.textContent=window.caption;},update(){}});');
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="../catalog.js"></script><script src="video.config.js"></script><script src="js/scenes.js"></script>');
  const catalog = path.join(root, 'videos/catalog.js');
  fs.writeFileSync(catalog, 'window.caption="First course order";');
  const before = key();
  fs.writeFileSync(catalog, 'window.caption="Updated course order";');
  assertChanged(key, before, 'A referenced course script must invalidate rendered navigation');
}

function verifyFactoryArguments(inline) {
  const scene = color => inline
    ? `V.scene({duration:1,lines:[],build:(color=>root=>{root.style.background=color;})(${JSON.stringify(color)}),update(){}});`
    : `function makeScene(color){return {duration:1,lines:[],build(root){root.style.background=color;},update(){}};}V.scene(makeScene(${JSON.stringify(color)}));`;
  const { dir, key } = createFixture(inline ? 'inline-closure' : 'factory-closure', scene('red'));
  const before = key();
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), scene('blue'));
  assertChanged(key, before, 'Changed closure inputs must invalidate a scene even when callback text is unchanged');
}

function verifySharedRegexSource() {
  const source = color => `const GLOBAL_COLOR=/V.scene(${color})/.source.includes('red')?'red':'blue';V.scene({duration:1,lines:[],build(root){root.style.background=GLOBAL_COLOR;},update(){}});`;
  const { dir, key } = createFixture('shared-regex', source('red'));
  const before = key();
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), source('blue'));
  assertChanged(key, before, 'Scene-like text in a shared regular expression must remain in its cache identity');
}

function verifyDynamicRegistrations() {
  const body = color => `{color:${JSON.stringify(color)},duration:1,lines:[],build(root){root.style.background=this.color;},update(){}}`;
  for (const [id, register] of [
    ['bulk-scenes', color => `V.scenes.push(${body(color)},${body('gray')});`],
    ['wrapped-scene', color => `(()=>{V.scene(${body(color)});})();`],
    ['getter-scene', color => `V.scene({get color(){return ${JSON.stringify(color)};},duration:1,lines:[],build(root){root.style.background=this.color;},update(){}});`],
  ]) {
    const { dir, key } = createFixture(id, register('red'));
    const before = key();
    fs.writeFileSync(path.join(dir, 'js/scenes.js'), register('blue'));
    assertChanged(key, before, `Dynamic or accessor-based definitions must invalidate their cache: ${id}`);
  }
}

function writeVoiceData(dir, data) {
  fs.mkdirSync(path.join(dir, 'assets/voice'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets/voice/timings.js'), 'V.voice=' + JSON.stringify(data) + ';');
}

function verifyWordAnchorTimings() {
  const { dir, key } = createFixture('voice-words', 'V.scene({lines:["red blue"],build(){},update(t,x){this.root.style.background=t>=x.at(0,"blue")?"blue":"red";}});');
  const voice = at => ({ durations: [[1]], words: [[[[0, 'red'], [at, 'blue']]]] });
  writeVoiceData(dir, voice(0.25));
  const before = key();
  writeVoiceData(dir, voice(0.75));
  assertChanged(key, before, 'Changed word timestamps must invalidate animation driven by x.at()');
}

function verifyPreviousSceneEnvelope(duration) {
  const id = 'previous-envelope-' + duration;
  const scene = 'V.scene({lines:["voice"],build(){},update(t){this.root.style.background=V.getSceneEnergy(this,0,t)>.5?"blue":"red";}});V.scene({duration:1,lines:[],build(root){root.style.background="gray";},update(){}});';
  const { dir } = createFixture(id, scene);
  fs.writeFileSync(path.join(dir, 'video.config.js'), 'V.config={width:320,height:180,audioSrc:false,bgm:false,lead:0,gap:0,tail:0,ui:{hud:false},sceneScripts:["js/scenes.js"]};');
  const keys = () => {
    const { sandbox } = loadVideoSandbox(root, id);
    return buildCachedSceneSegments(sandbox.V, sandbox.V.config, id, dir, Math.ceil((duration + 1) * 4), 320, 180, 4, '').map(segment => segment.partPath);
  };
  const voice = level => ({ durations: [[duration]], envelopes: [[[level, level]]] });
  writeVoiceData(dir, voice(0));
  const before = keys();
  writeVoiceData(dir, voice(100));
  const changed = keys();
  assert.notEqual(changed[0], before[0], 'Changed voice energy must invalidate its own scene');
  if (duration === 1) assert.equal(changed[1], before[1], 'A frame-aligned next scene must retain its cache');
  else assert.notEqual(changed[1], before[1], 'A segment containing the previous scene must include its voice energy');
  assert.deepEqual(keys(), changed, 'Unchanged voice data must retain its cache identity');
}

function verifyPreviousLayerDefinition(closure, blendDur) {
  const id = `previous-layer-${closure}-${blendDur}`;
  const source = color => {
    const previous = closure
      ? `probe:(color=>()=>({color}))(${JSON.stringify(color)})`
      : `color:${JSON.stringify(color)},probe(x,sc){return {color:sc.color};}`;
    return `V.layer({id:"probe",blendDur:${blendDur},update(){}});V.scene({${previous},duration:1,lines:[],build(){},update(){}});V.scene({probe:{color:"gray"},duration:1,lines:[],build(){},update(){}});`;
  };
  const { dir } = createFixture(id, source('red'));
  const keys = () => {
    const { sandbox } = loadVideoSandbox(root, id);
    return buildCachedSceneSegments(sandbox.V, sandbox.V.config, id, dir, 8, 320, 180, 4, '').map(segment => segment.partPath);
  };
  const before = keys();
  fs.writeFileSync(path.join(dir, 'js/scenes.js'), source('blue'));
  const changed = keys();
  assert.notEqual(changed[0], before[0], 'Changed layer data must invalidate its own scene');
  if (blendDur > 0) assert.notEqual(changed[1], before[1], 'A blended layer must include the previous definition and closure inputs');
  else assert.equal(changed[1], before[1], 'A layer without blending must preserve the next scene cache');
  assert.deepEqual(keys(), changed, 'Unchanged persistent-layer inputs must retain cache identity');
}

function verifyEntryStyleDependency() {
  const { dir, key } = createFixture('entry-style', 'V.scene({duration:1,lines:[],build(){},update(){}});');
  fs.writeFileSync(path.join(dir, 'index.html'), '<link href="../palette.css" rel="stylesheet">');
  const css = path.join(root, 'videos/palette.css');
  fs.writeFileSync(css, '#stage{background:red}');
  const before = key();
  fs.writeFileSync(css, '#stage{background:blue}');
  assertChanged(key, before, 'Changing a linked stylesheet outside the video directory must invalidate its cache');
}

function verifyImportedStyles() {
  const { dir, key } = createFixture('imported-styles', 'V.scene({duration:1,lines:[],build(){},update(){}});');
  fs.writeFileSync(path.join(dir, 'index.html'), '<style>@import url("style.css");</style>');
  fs.writeFileSync(path.join(dir, 'style.css'), String.raw`@import /* gap */ url(../imported\20 theme.css?v=2) layer(theme) screen;`);
  fs.writeFileSync(path.join(root, 'videos/imported theme.css'), '@import "/palette-deep.css"; @import "imported%20theme.css";');
  const palette = path.join(root, 'videos/palette-deep.css');
  const missing = key();
  fs.writeFileSync(palette, '#stage{background:red}');
  assertChanged(key, missing, 'Adding a transitive CSS import must invalidate the cache');
  const red = key();
  fs.writeFileSync(palette, '#stage{background:blue}');
  assertChanged(key, red, 'Changing a transitive CSS import must invalidate the cache');
  fs.unlinkSync(palette);
  assert.equal(key(), missing, 'Removing a transitive CSS import must be reflected in the cache key');
}

function verifyRenderProfileInvalidation() {
  const { dir } = createFixture('profile-identity', 'V.scene({duration:1,lines:[],build(root){root.style.background="red";},update(){}});');
  const keyWith = renderSpec => {
    const { sandbox } = loadVideoSandbox(root, 'profile-identity');
    return buildCachedSceneSegments(sandbox.V, sandbox.V.config, 'profile-identity', dir, 4, 320, 180, 4, '', '', renderSpec)[0].partPath;
  };
  const base = keyWith({ scale: 1, outW: 320, outH: 180, encoder: 'libx264', quality: 18, preset: 'medium' });
  assert.notEqual(keyWith({ scale: 2, outW: 640, outH: 360, encoder: 'libx264', quality: 18, preset: 'medium' }), base, 'Changing scale/output dimensions must invalidate scene cache');
  assert.notEqual(keyWith({ scale: 1, outW: 320, outH: 180, encoder: 'h264_nvenc', quality: 19, preset: 'p5' }), base, 'Changing video encoder must invalidate scene cache');
  assert.notEqual(keyWith({ scale: 1, outW: 320, outH: 180, encoder: 'libx264', quality: 23, preset: 'medium' }), base, 'Changing video quality must invalidate scene cache');
}

verifyEntryStyleDependency();
verifyImportedStyles();
verifySceneFieldBoundaries();
verifyVisualAssetChanges();
verifyAssetOwnership();
verifyFileBoundaries(false);
verifyFileBoundaries(true);
verifyAssetPaths();
verifyAuthoredSceneData();
verifyCrossModuleSharedCode();
verifySameModuleGranularity();
verifyEntryScriptDependency();
verifyFactoryArguments(false);
verifyFactoryArguments(true);
verifySharedRegexSource();
verifyDynamicRegistrations();
verifyWordAnchorTimings();
verifyPreviousSceneEnvelope(1.08);
verifyPreviousSceneEnvelope(1);
verifyPreviousLayerDefinition(false, 0.5);
verifyPreviousLayerDefinition(true, 0.5);
verifyPreviousLayerDefinition(false, 0);
verifyRenderProfileInvalidation();
console.log('Scene/source identity, voice words/energy, dynamic registrations, granularity and file identity regressions PASSED.');
