import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const IMMUTABLE_ASSET_CACHE = 'private, max-age=31536000, immutable';
const VERSIONED_NAME = /\.sha256-([a-f0-9]{24})(?:\.[^.]+)?$/;
const ASSET_META = /<!--[\s\S]*?-->|<meta\b[^>]*>/gi;

export function hashAsset(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function assetVersion(filePath) {
  return VERSIONED_NAME.exec(path.basename(filePath))?.[1];
}

function declaredPath(tag) {
  if (tag.startsWith('<!--') || !/\sname\s*=\s*(["'])video-versioned-asset\1/i.test(tag)) return null;
  const rel = /\scontent\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
  if (!rel || /[\\:%?#*\s<>"'&]/.test(rel) || rel.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('video-versioned-asset requires a course-relative file path in content');
  }
  return rel;
}

export function readVersionedAssets(courseDir) {
  const entry = path.join(courseDir, 'index.html');
  if (!fs.existsSync(entry)) return [];
  const root = fs.realpathSync(courseDir);
  const tags = fs.readFileSync(entry, 'utf8').matchAll(ASSET_META);
  const files = new Set();
  for (const [tag] of tags) {
    const rel = declaredPath(tag);
    if (rel === null || files.has(rel)) continue;
    const file = path.join(root, rel);
    if (path.relative(file, fs.realpathSync(file)) || !fs.statSync(file).isFile()) {
      throw new Error(`Invalid video-versioned-asset: ${rel}`);
    }
    if (rel === 'index.html') throw new Error('The course entry cannot be a versioned asset');
    files.add(rel);
  }
  return [...files];
}

export function versionBundleAssets(courseDir, files, rewriteAsset) {
  if (!files.length) return [];
  const names = new Map();
  for (const rel of files) {
    const file = path.join(courseDir, rel);
    rewriteAsset?.(file, rel);
    const hash = hashAsset(fs.readFileSync(file)).slice(0, 24);
    const ext = path.posix.extname(rel);
    const versioned = `${rel.slice(0, rel.length - ext.length)}.sha256-${hash}${ext}`;
    fs.copyFileSync(file, path.join(courseDir, versioned));
    names.set(rel, versioned);
  }
  const entry = path.join(courseDir, 'index.html');
  const html = fs.readFileSync(entry, 'utf8').replace(ASSET_META, tag => {
    const rel = declaredPath(tag);
    return names.has(rel) ? tag.replace(/(\scontent\s*=\s*)(["'])(.*?)\2/i, (_match, attr, quote) =>
      `${attr}${quote}${names.get(rel)}${quote}`) : tag;
  });
  fs.writeFileSync(entry, html, 'utf8');
  return [...names.values()];
}

export function writeVersionedCacheHeaders(outDir, paths) {
  if (!paths.length) return;
  const file = path.join(outDir, '_headers');
  const rules = paths.map(rel => `/${encodeURI(rel)}\n  Cache-Control: ${IMMUTABLE_ASSET_CACHE}\n`);
  if (fs.existsSync(file)) fs.appendFileSync(file, '\n' + rules.join('\n'));
  else fs.writeFileSync(file, rules.join('\n'), 'utf8');
}
