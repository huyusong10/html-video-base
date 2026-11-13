// 独立静态站点打包器（Static Bundler）：将虚拟 /base/* 运行时与业务视频物化为免 node_modules 的纯静态目录
// 用法：html-video bundle [video-id ... | --all] [--single] [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, PKG_ROOT, VIDEOS_DIR, RUNTIME_BASE_DIR, TEMPLATES_DIR,
  listVideoIds, normalizeCliArgs, buildVideoManifestItem,
} from './lib/paths.mjs';

function parseBundleArgs(rawArgv) {
  const argv = normalizeCliArgs(rawArgv);
  let outDir = '';
  let single = false;
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && i + 1 < argv.length) { outDir = path.resolve(argv[++i]); continue; }
    if (a === '--single') { single = true; continue; }
    if (a === '--all' || a.startsWith('--')) continue;
    ids.push(a);
  }
  const targets = ids.length ? ids : listVideoIds();
  const resolvedOut = outDir || (single && targets[0] ? path.join(ROOT, 'dist', targets[0]) : path.join(ROOT, 'dist'));
  return { targets, outDir: resolvedOut, single };
}

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, force: true });
}

function rewriteTextRefs(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  const code = fs.readFileSync(filePath, 'utf8');
  let next = code;
  for (const [pattern, to] of replacements) {
    next = pattern instanceof RegExp ? next.replace(pattern, to) : next.replaceAll(pattern, to);
  }
  if (next !== code) fs.writeFileSync(filePath, next, 'utf8');
}

function rewriteDirFiles(dirPath, exts, replacements, recursive = false) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory() && recursive) rewriteDirFiles(full, exts, replacements, true);
    else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) rewriteTextRefs(full, replacements);
  }
}

function collectRelFiles(dir, prefix = '', out = new Set()) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRelFiles(full, rel, out);
    else if (entry.isFile()) out.add(rel);
  }
  return out;
}

function isolateCollidingSharedAssets(sharedDir, localDir, targetOut) {
  const sharedFiles = collectRelFiles(sharedDir);
  const localFiles = collectRelFiles(localDir);
  const collisions = [];
  for (const rel of sharedFiles) {
    if (!localFiles.has(rel)) continue;
    collisions.push(rel);
    const dst = path.join(targetOut, 'shared-assets', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(sharedDir, rel), dst);
  }
  return collisions.sort((a, b) => b.length - a.length);
}

function buildCollisionRules(collisions, prefixFrom, prefixTo) {
  return collisions.map(rel => {
    const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [new RegExp(`${prefixFrom}assets/${esc}(?![\\w.-])`, 'g'), `${prefixTo}shared-assets/${rel}`];
  });
}

const BUNDLED_SYS_DIRS = new Set(['base', 'assets', 'shared-assets', 'themes']);

function normCmpPath(p) {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function isSameOrParent(parentPath, childPath) {
  const rel = path.relative(normCmpPath(parentPath), normCmpPath(childPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertSafeBundleOutDir(outDir, projectRoot = ROOT) {
  const resolved = path.resolve(outDir);
  if (path.parse(resolved).root === resolved) {
    throw new Error(`Refusing to bundle into filesystem root: ${resolved}`);
  }
  const videosDir = path.join(projectRoot, 'videos');
  for (const guarded of [projectRoot, PKG_ROOT, videosDir]) {
    if (isSameOrParent(resolved, guarded)) {
      throw new Error(`Refusing to bundle into project/package directory or ancestor: ${resolved}`);
    }
  }
  for (const srcDir of [videosDir, RUNTIME_BASE_DIR, TEMPLATES_DIR, path.join(PKG_ROOT, 'tools')]) {
    if (isSameOrParent(srcDir, resolved)) {
      throw new Error(`Refusing to bundle inside protected source directory: ${resolved}`);
    }
  }
}

function buildDepthRules(depth, collisions, includeDocLevel) {
  const escHops = '(?<!\\.\\.\\/)' + '\\.\\.\\/'.repeat(depth + 1);
  const toPrefix = depth === 0 ? './' : '../'.repeat(depth);
  const depthRelRule = [new RegExp(`${escHops}(base|assets|themes)\\/`, 'g'), `${toPrefix}$1/`];
  const colRules = buildCollisionRules(collisions, escHops, toPrefix);
  if (!includeDocLevel || depth === 0) return [...colRules, depthRelRule];
  const docColRules = buildCollisionRules(collisions, '(?<!\\.\\.\\/)\\.\\.\\/', './');
  const docRelRule = [/(?<!\.\.\/)\.\.\/(base|assets|themes)\//g, './$1/'];
  return [...colRules, ...docColRules, docRelRule, depthRelRule];
}

function rewriteEntryFile(entryName, full, jsRules, docRules) {
  if (entryName.endsWith('.js') || entryName.endsWith('.mjs')) rewriteTextRefs(full, jsRules);
  else if (entryName.endsWith('.html') || entryName.endsWith('.css')) rewriteTextRefs(full, docRules);
}

function walkRewriteVideoDirs(dirPath, depth, collisions) {
  if (!fs.existsSync(dirPath)) return;
  const docRules = buildDepthRules(depth, collisions, false);
  const jsRules = buildDepthRules(depth, collisions, true);
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (depth === 0 && BUNDLED_SYS_DIRS.has(entry.name)) continue;
      walkRewriteVideoDirs(full, depth + 1, collisions);
    } else if (entry.isFile()) {
      rewriteEntryFile(entry.name, full, jsRules, docRules);
    }
  }
}

function rewriteBundledRefs(targetOut, collisions) {
  walkRewriteVideoDirs(targetOut, 0, collisions);
  const docColRules = buildCollisionRules(collisions, '(?<!\\.\\.\\/)\\.\\.\\/', './');
  const docRelRule = [/(?<!\.\.\/)\.\.\/(base|assets|themes)\//g, './$1/'];
  const themeCssColRules = buildCollisionRules(collisions, '(?<=\\.\\.\\/)', '');
  rewriteDirFiles(path.join(targetOut, 'themes'), ['.js', '.mjs'], [...docColRules, docRelRule], true);
  rewriteDirFiles(path.join(targetOut, 'themes'), ['.css'], themeCssColRules, true);
}

export function bundleSingleVideo(videoId, outDir, projectRoot = ROOT) {
  const videosDir = path.join(projectRoot, 'videos');
  const srcVideo = path.join(videosDir, videoId);
  if (!fs.existsSync(srcVideo)) throw new Error(`Video directory not found: ${srcVideo}`);
  const targetOut = outDir || path.join(projectRoot, 'dist', videoId);
  assertSafeBundleOutDir(targetOut, projectRoot);

  fs.rmSync(targetOut, { recursive: true, force: true });
  fs.mkdirSync(targetOut, { recursive: true });

  const sharedAssetsDir = path.join(videosDir, 'assets');
  copyIfExists(RUNTIME_BASE_DIR, path.join(targetOut, 'base'));
  copyIfExists(path.join(videosDir, 'base'), path.join(targetOut, 'base'));
  copyIfExists(sharedAssetsDir, path.join(targetOut, 'assets'));
  copyIfExists(path.join(videosDir, 'themes'), path.join(targetOut, 'themes'));
  const collisions = isolateCollidingSharedAssets(sharedAssetsDir, path.join(srcVideo, 'assets'), targetOut);
  fs.cpSync(srcVideo, targetOut, { recursive: true, force: true });

  rewriteBundledRefs(targetOut, collisions);
  console.log(`✅ Bundled single video '${videoId}' -> ${targetOut}`);
  return targetOut;
}

export function bundleStaticSite(videoIds, outDir = path.join(ROOT, 'dist')) {
  const targets = videoIds && videoIds.length ? videoIds : listVideoIds();
  if (!targets.length) throw new Error('No videos found under videos/ to bundle.');
  assertSafeBundleOutDir(outDir, ROOT);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  copyIfExists(RUNTIME_BASE_DIR, path.join(outDir, 'base'));
  copyIfExists(path.join(VIDEOS_DIR, 'base'), path.join(outDir, 'base'));
  copyIfExists(path.join(VIDEOS_DIR, 'assets'), path.join(outDir, 'assets'));
  copyIfExists(path.join(VIDEOS_DIR, 'themes'), path.join(outDir, 'themes'));

  for (const id of targets) {
    const srcVideo = path.join(VIDEOS_DIR, id);
    if (!fs.existsSync(srcVideo)) throw new Error(`Video directory not found: ${srcVideo}`);
    fs.cpSync(srcVideo, path.join(outDir, id), { recursive: true, force: true });
  }

  const localHub = path.join(VIDEOS_DIR, 'index.html');
  const hubSrc = fs.existsSync(localHub) ? localHub : path.join(TEMPLATES_DIR, 'hub/index.html');
  copyIfExists(hubSrc, path.join(outDir, 'index.html'));

  const manifestItems = targets.map(id => buildVideoManifestItem(ROOT, id));
  const manifestCode = `/* 由 html-video bundle 自动生成 */\nwindow.VIDEO_MANIFEST = ${JSON.stringify(manifestCodeSafe(manifestItems), null, 2)};\n`;
  fs.writeFileSync(path.join(outDir, 'manifest.js'), manifestCode, 'utf8');

  console.log(`✅ Bundled ${targets.length} video(s) + standalone runtime -> ${outDir}`);
  return outDir;
}

function manifestCodeSafe(items) {
  return items;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('bundle.mjs');
if (isDirectRun) {
  const { targets, outDir, single } = parseBundleArgs(process.argv.slice(2));
  if (single) {
    if (targets.length !== 1) throw new Error(`"--single" requires a single video id, got: ${targets.join(', ') || '(none)'}`);
    bundleSingleVideo(targets[0], outDir, ROOT);
  } else {
    bundleStaticSite(targets, outDir);
  }
}
