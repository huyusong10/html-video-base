// 跨平台统一工具链入口（Windows PowerShell / macOS / Linux 原生运行，零 Bash 依赖）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT, PKG_ROOT, TOOLS_DIR, VIDEOS_DIR, TEMPLATES_DIR,
  listVideoIds, resolvePython, loadVideoSandbox, resolveLangMediaPaths,
} from './lib/paths.mjs';

function run(bin, args, label, extraEnv = {}) {
  if (label) console.log(label);
  const r = spawnSync(bin, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { VIDEO_PROJECT_ROOT: ROOT }, extraEnv),
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function parseFlag(args, name, fallback = null) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

function stripFlags(args, valueFlags = []) {
  const out = [];
  const vf = new Set(valueFlags);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (vf.has(a)) { i++; continue; }
    if (!a.startsWith('--')) out.push(a);
  }
  return out;
}

function copyTemplateDir(src, dest, replacements) {
  fs.mkdirSync(dest, { recursive: true });
  const textExts = new Set(['.html', '.js', '.css', '.md', '.json']);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDir(s, d, replacements);
      continue;
    }
    if (!textExts.has(path.extname(entry.name).toLowerCase())) {
      fs.copyFileSync(s, d);
      continue;
    }
    let txt = fs.readFileSync(s, 'utf8');
    for (const [k, v] of Object.entries(replacements)) txt = txt.replaceAll(k, v);
    fs.writeFileSync(d, txt, 'utf8');
  }
}

function buildManifestItem(id) {
  try {
    const { sandbox } = loadVideoSandbox(ROOT, id, { ignoreBaked: false, requireTimings: false });
    const cfg = sandbox.V.config || {};
    return {
      id,
      title: cfg.title || id,
      subtitle: cfg.subtitle || '',
      description: cfg.description || cfg.subtitle || '',
      width: cfg.width || 1920,
      height: cfg.height || 1080,
      duration: Math.round(sandbox.V.duration || 0),
      scenes: sandbox.V.scenes.length,
      path: `./${id}/index.html`,
    };
  } catch {
    return { id, title: id, subtitle: '', description: '', width: 1920, height: 1080, duration: 0, scenes: 0, path: `./${id}/index.html` };
  }
}

function syncManifest() {
  const manifestPath = path.join(VIDEOS_DIR, 'manifest.js');
  if (!fs.existsSync(manifestPath)) return;
  const items = listVideoIds().map(buildManifestItem);
  const content = [
    '/* 视频中心清单（由 html-video 自动同步，也可手动编辑） */',
    'window.VIDEO_MANIFEST = ' + JSON.stringify(items, null, 2) + ';',
    '',
  ].join('\n');
  fs.writeFileSync(manifestPath, content, 'utf8');
}

function resolveAspectDims(aspect) {
  if (aspect === '9:16') return [1080, 1920];
  if (aspect === '1:1') return [1080, 1080];
  return [1920, 1080];
}

function exportSkillDoc(outDir) {
  const src = path.join(PKG_ROOT, 'skills/html-video/SKILL.md');
  const targetDir = outDir ? path.resolve(ROOT, outDir) : path.join(ROOT, '.agents/skills/html-video');
  fs.mkdirSync(targetDir, { recursive: true });
  const dest = path.join(targetDir, 'SKILL.md');
  fs.copyFileSync(src, dest);
  console.log(`✅ Exported Agent Skill -> ${dest}`);
}

function cmdSkill(args) {
  exportSkillDoc(parseFlag(args, '--out', null));
}

function cmdInit(args) {
  const pos = stripFlags(args, ['--title', '--aspect']);
  const videoId = pos[0];
  if (!videoId || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    console.error('Usage: html-video init <video-id> [--title "标题"] [--aspect 16:9|9:16|1:1] [--skill]');
    process.exit(1);
  }
  const targetDir = path.join(VIDEOS_DIR, videoId);
  if (fs.existsSync(targetDir)) {
    console.error(`Error: Video '${videoId}' already exists at ${targetDir}`);
    process.exit(1);
  }
  const localTpl = path.join(ROOT, 'templates/starter');
  const tplDir = fs.existsSync(localTpl) ? localTpl : path.join(TEMPLATES_DIR, 'starter');
  const title = parseFlag(args, '--title', `${videoId} 视频演示`);
  const [width, height] = resolveAspectDims(parseFlag(args, '--aspect', '16:9'));

  copyTemplateDir(tplDir, targetDir, {
    '__VIDEO_ID__': videoId,
    '__VIDEO_TITLE__': title,
    '__STAGE_WIDTH__': String(width),
    '__STAGE_HEIGHT__': String(height),
  });
  if (args.includes('--skill')) exportSkillDoc(null);
  syncManifest();
  console.log(`✅ Created new video at videos/${videoId} (${width}x${height})`);
  console.log(`  Preview draft: npx html-video serve -> http://localhost:8765/${videoId}/?dev=1`);
  console.log(`  Build audio  : npx html-video build ${videoId}`);
  console.log(`  Export MP4   : npx html-video render ${videoId}`);
}

function collectBuildTtsEnv(args) {
  const env = {};
  const map = [
    ['--provider', 'TTS_PROVIDER'],
    ['--voice', 'TTS_VOICE'],
    ['--model', 'TTS_MODEL'],
    ['--speed', 'TTS_SPEED'],
    ['--bitrate', 'AUDIO_BITRATE'],
  ];
  for (const [flag, key] of map) {
    const val = parseFlag(args, flag);
    if (val) env[key] = val;
  }
  return env;
}

function cmdBuild(args) {
  const pos = stripFlags(args, ['--provider', '--voice', '--model', '--speed', '--bitrate', '--lang']);
  const videoId = pos[0] || listVideoIds()[0];
  const lang = parseFlag(args, '--lang', '');
  const videoDir = videoId ? path.join(VIDEOS_DIR, videoId) : '';
  if (!videoId || !fs.existsSync(videoDir)) {
    console.error(`Error: Video directory not found for '${videoId || ''}' under ${VIDEOS_DIR}`);
    process.exit(1);
  }

  const ttsEnv = collectBuildTtsEnv(args);
  if (lang) ttsEnv.VIDEO_LANG = lang;
  const py = resolvePython(ROOT, true);
  const rtDir = path.join(ROOT, '.runtime', `build-${videoId}${lang ? '-' + lang : ''}`);
  const linesJson = path.join(rtDir, 'lines.json');
  const cuesJson = path.join(rtDir, 'cues.json');
  const voiceDir = path.join(rtDir, 'voice');

  const { sandbox } = loadVideoSandbox(ROOT, videoId, { ignoreBaked: true, requireTimings: false, lang });
  const { timingsRel, audioRel } = resolveLangMediaPaths(sandbox.V.config, lang);
  const langArgs = lang ? ['--lang', lang] : [];

  fs.rmSync(rtDir, { recursive: true, force: true });
  fs.mkdirSync(rtDir, { recursive: true });

  run(process.execPath, [path.join(TOOLS_DIR, 'export.mjs'), videoId, linesJson, cuesJson, ...langArgs],
    `[1/4] Exporting scene script & config for '${videoId}'...`, ttsEnv);
  run(py, [path.join(TOOLS_DIR, 'voice.py'), linesJson, voiceDir, path.join(videoDir, timingsRel)],
    `[2/4] Synthesizing TTS voice, word boundaries & 30Hz envelopes...`, ttsEnv);
  run(process.execPath, [path.join(TOOLS_DIR, 'export.mjs'), videoId, linesJson, cuesJson, ...langArgs],
    `[3/4] Computing timeline cues, subtitles & mixing soundtrack...`, ttsEnv);
  if (audioRel) {
    run(py, [path.join(TOOLS_DIR, 'mix.py'), cuesJson, voiceDir, path.join(videoDir, audioRel)], null, ttsEnv);
  }
  fs.rmSync(rtDir, { recursive: true, force: true });

  const verifyArgs = [path.join(TOOLS_DIR, 'verify-sync.mjs'), videoId, '--stamp-baked', ...langArgs];
  if (args.includes('--visual')) verifyArgs.push('--visual');
  if (args.includes('--strict')) verifyArgs.push('--strict');
  run(process.execPath, verifyArgs, `[4/4] Stamping bakedLayout & running audio-visual sync verification...`, ttsEnv);

  syncManifest();
  console.log(`Build complete for '${videoId}${lang ? ':' + lang : ''}'.`);
}

function printHelp() {
  console.log([
    'html-video CLI (v2.3)',
    '  html-video init <id> [--title "..."] [--aspect 16:9|9:16|1:1] [--skill]',
    '  html-video skill [--out .agents/skills/html-video]',
    '  html-video serve [port] [host] [--no-watch]',
    '  html-video build [video-id] [--lang en] [--provider edge|openai|elevenlabs|azure|http|command] [--voice ...] [--speed ...] [--bitrate 128k] [--visual]',
    '  html-video verify [video-id ...] [--stamp-baked] [--visual] [--strict] [--lang en]',
    '  html-video audit [video-id ...] [--strict] [--screenshots <dir>] [--lang en]',
    '  html-video storyboard [video-id] [out.html] [--per-cue] [--pdf] [--lang en]',
    '  html-video render [video-id] [output.mp4] [--workers N] [--scene K] [--range t0:t1] [--fps N] [--lang en] [--no-cache] [--no-frame-reuse]',
    '  html-video bundle [video-id ... | --single | --all] [--out dist]',
    '  html-video manifest',
  ].join('\n'));
}

const COMMANDS = {
  init: cmdInit,
  new: cmdInit,
  skill: cmdSkill,
  build: cmdBuild,
  serve: r => run(process.execPath, [path.join(TOOLS_DIR, 'serve.mjs'), ...r]),
  verify: r => run(process.execPath, [path.join(TOOLS_DIR, 'verify-sync.mjs'), ...r]),
  audit: r => run(process.execPath, [path.join(TOOLS_DIR, 'audit-visual.mjs'), ...r]),
  storyboard: r => run(process.execPath, [path.join(TOOLS_DIR, 'storyboard.mjs'), ...r]),
  render: r => run(process.execPath, [path.join(TOOLS_DIR, 'render.mjs'), ...r]),
  bundle: r => run(process.execPath, [path.join(TOOLS_DIR, 'bundle.mjs'), ...r]),
  manifest: () => { syncManifest(); console.log('Synced videos/manifest.js'); },
  'check-cc': () => run(process.execPath, [path.join(TOOLS_DIR, 'check-complexity.mjs')]),
};

export function runCli(argv = process.argv.slice(2)) {
  const [cmd = 'help', ...rest] = argv;
  const handler = COMMANDS[cmd];
  if (handler) handler(rest);
  else printHelp();
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('cli.mjs');
if (isDirectRun) runCli();
