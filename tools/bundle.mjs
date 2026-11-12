// 独立静态站点打包器（Static Bundler）：将虚拟 /base/* 运行时与业务视频物化为免 node_modules 的纯静态目录
// 用法：html-video bundle [video-id ... | --all] [--single] [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, VIDEOS_DIR, RUNTIME_BASE_DIR, TEMPLATES_DIR,
  listVideoIds, loadVideoSandbox,
} from './lib/paths.mjs';

function parseBundleArgs(argv) {
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
  let code = fs.readFileSync(filePath, 'utf8');
  let next = code;
  for (const [from, to] of replacements) next = next.replaceAll(from, to);
  if (next !== code) fs.writeFileSync(filePath, next, 'utf8');
}

function rewriteDirFiles(dirPath, exts, replacements) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || !exts.some(ext => entry.name.endsWith(ext))) continue;
    rewriteTextRefs(path.join(dirPath, entry.name), replacements);
  }
}

export function bundleSingleVideo(videoId, outDir, projectRoot = ROOT) {
  const videosDir = path.join(projectRoot, 'videos');
  const srcVideo = path.join(videosDir, videoId);
  if (!fs.existsSync(srcVideo)) throw new Error(`Video directory not found: ${srcVideo}`);
  const targetOut = outDir || path.join(projectRoot, 'dist', videoId);

  fs.rmSync(targetOut, { recursive: true, force: true });
  fs.mkdirSync(targetOut, { recursive: true });

  copyIfExists(RUNTIME_BASE_DIR, path.join(targetOut, 'base'));
  copyIfExists(path.join(videosDir, 'base'), path.join(targetOut, 'base'));
  copyIfExists(path.join(videosDir, 'assets'), path.join(targetOut, 'assets'));
  copyIfExists(path.join(videosDir, 'themes'), path.join(targetOut, 'themes'));
  fs.cpSync(srcVideo, targetOut, { recursive: true, force: true });

  rewriteDirFiles(targetOut, ['.html', '.css', '.js', '.mjs'], [
    ['../base/', './base/'],
    ['../assets/', './assets/'],
    ['../themes/', './themes/'],
  ]);
  for (const sub of ['js', 'locales']) {
    rewriteDirFiles(path.join(targetOut, sub), ['.js', '.mjs', '.css'], [
      ['../../base/', '../base/'],
      ['../../assets/', '../assets/'],
      ['../../themes/', '../themes/'],
    ]);
  }
  console.log(`✅ Bundled single video '${videoId}' -> ${targetOut}`);
  return targetOut;
}

function buildManifestEntry(id) {
  try {
    const { sandbox } = loadVideoSandbox(ROOT, id, { ignoreBaked: false, requireTimings: false });
    const cfg = Object.assign({}, sandbox.V.themeDefaults || {}, sandbox.V.config || {});
    return {
      id,
      title: cfg.title || id,
      description: cfg.description || '',
      duration: Math.round((sandbox.V.duration || 0) * 10) / 10,
      scenes: (sandbox.V.scenes || []).length,
      width: cfg.width || 1920,
      height: cfg.height || 1080,
      path: `./${id}/index.html`,
    };
  } catch {
    return { id, title: id, description: '', duration: 0, scenes: 0, width: 1920, height: 1080, path: `./${id}/index.html` };
  }
}

export function bundleStaticSite(videoIds, outDir = path.join(ROOT, 'dist')) {
  const targets = videoIds && videoIds.length ? videoIds : listVideoIds();
  if (!targets.length) throw new Error('No videos found under videos/ to bundle.');

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

  const manifestItems = targets.map(buildManifestEntry);
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
