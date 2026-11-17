import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import { ROOT, listVideoIds, loadVideoSandbox, getSandboxCfg } from './lib/paths.mjs';

function visit(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => visit(item, fn));
    else if (value && typeof value === 'object') visit(value, fn);
  }
}

function isSceneCall(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  const { object, property } = node.callee;
  if (object.name === 'V' && property.name === 'scene') return true;
  return property.name === 'push' && object.type === 'MemberExpression'
    && object.object.name === 'V' && object.property.name === 'scenes';
}

function sceneLiterals(file) {
  const definitions = [];
  visit(parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), node => {
    if (!isSceneCall(node)) return;
    const literals = new Set();
    visit(node.arguments[0], item => {
      if (item.type === 'Literal' && typeof item.value === 'string') literals.add(item.value);
      if (item.type === 'TemplateLiteral' && item.expressions.length === 0) literals.add(item.quasis[0].value.cooked);
    });
    definitions.push([...literals]);
  });
  return definitions;
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function strings(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(strings);
}

function assetReferences(videoDir, config, scenes) {
  const references = strings(config).concat(scenes.flatMap(scene => scene.literals));
  for (const name of ['index.html', 'style.css']) {
    const file = path.join(videoDir, name);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^)'"\s]+)["']?\)/g)) references.push(match[1] || match[2]);
  }
  return [...new Set(references.filter(ref => /\.(?:png|jpe?g|svg|webp|gif|mp[34]|m4a|wav|woff2?|css|js|glb|gltf)(?:[?#].*)?$/i.test(ref)))];
}

function describeScenes(V, videoDir, includeLiterals) {
  const sources = new Map(), offsets = new Map();
  return V.scenes.map((scene, index) => {
    const sourceScript = scene._sourceScript || '';
    const offset = offsets.get(sourceScript) || 0;
    offsets.set(sourceScript, offset + 1);
    if (includeLiterals && sourceScript && !sources.has(sourceScript)) sources.set(sourceScript, sceneLiterals(path.join(videoDir, sourceScript)));
    return serializable({ id: scene.id || '', index, title: scene.title || '', start: scene.start, duration: scene.duration,
      isBumper: Boolean(scene.isBumper), pptSkip: Boolean(scene.pptSkip),
      lines: scene.lines || [], cues: scene.cues || [], sourceScript,
      literals: sources.has(sourceScript) ? sources.get(sourceScript)[offset] || [] : [] });
  });
}

export function readVideoMetadata({ projectRoot = ROOT, id, lang = '', includeLiterals = false, includeAssets = false, ignoreBaked = false } = {}) {
  const root = path.resolve(projectRoot);
  const { sandbox, videoDir } = loadVideoSandbox(root, id, { lang, ignoreBaked });
  const V = sandbox.V, config = serializable(getSandboxCfg(V));
  const source = V.layoutInfo ? V.layoutInfo.source : 'unknown';
  const scenes = describeScenes(V, videoDir, includeLiterals || includeAssets);
  const assets = includeAssets ? assetReferences(videoDir, config, scenes) : null;
  if (!includeLiterals) scenes.forEach(scene => { delete scene.literals; });
  return { id, config, title: config.title || id, subtitle: config.subtitle || config.description || '',
    description: config.description || config.subtitle || '', duration: V.duration,
    width: config.width || 1920, height: config.height || 1080, fps: config.fps || 30, ppt: Boolean(config.ppt),
    layout: { source }, scenes, assetReferences: assets };
}

export function readVideoCatalog({ projectRoot = ROOT, ids, lang = '', ...options } = {}) {
  const root = path.resolve(projectRoot);
  const targets = ids || listVideoIds(path.join(root, 'videos'));
  return targets.map(id => readVideoMetadata({ ...options, projectRoot: root, id, lang }));
}

export function createSearchIndex(catalog, { mapVideo = () => ({}), mapScene = () => ({}) } = {}) {
  const videos = {}, scenes = [];
  for (const video of catalog) {
    videos[video.id] = { id: video.id, title: video.title, ...mapVideo(video) };
    for (const scene of video.scenes) {
      if (scene.isBumper || (scene.pptSkip && scene.lines.length === 0)) continue;
      scenes.push({ videoId: video.id, sceneIdx: scene.index, startSec: Math.round(scene.start), title: scene.title,
        text: scene.lines.map(line => typeof line === 'string' ? line : line.text || '').join(' '),
        ...mapScene(scene, video, videos[video.id]) });
    }
  }
  return { videos, scenes };
}

export function createVideoManifest(catalog, { mapVideo = () => ({}) } = {}) {
  return catalog.map(video => ({ id: video.id, title: video.title, subtitle: video.subtitle, description: video.description,
    duration: Math.round(video.duration * 10) / 10,
    scenes: video.scenes.filter(scene => !scene.isBumper && !(scene.pptSkip && scene.lines.length === 0)).length,
    width: video.width, height: video.height, ppt: video.ppt, path: `./${video.id}/index.html`, ...mapVideo(video) }));
}

export function readVideoManifest({ projectRoot = ROOT } = {}) {
  const file = path.join(path.resolve(projectRoot), 'videos/manifest.js');
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, 'utf8'), marker = source.indexOf('window.VIDEO_MANIFEST');
  if (marker < 0) return [];
  try {
    const data = JSON.parse(source.slice(source.indexOf('=', marker) + 1).trim().replace(/;\s*$/, ''));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
