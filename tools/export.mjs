// 从场景脚本沙箱导出配音文案、语义断锚门禁、动作音效、受控视频原声与外挂字幕 (.vtt/.srt)
// 用法：node tools/export.mjs <video-id> <out-lines.json> <out-cues.json> [--lang en]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listVideoIds, loadVideoSandbox, probeSceneAnchors } from './lib/paths.mjs';
import { writeSubtitleFiles } from './lib/subtitles.mjs';

function parseExportArgs(argv) {
  const langIdx = argv.indexOf('--lang');
  const lang = langIdx >= 0 && argv[langIdx + 1] ? argv[langIdx + 1] : (process.env.VIDEO_LANG || '');
  const pos = argv.filter((a, i) => !a.startsWith('--') && (langIdx < 0 || i !== langIdx + 1));
  return {
    videoId: pos[0] || listVideoIds()[0],
    outLines: pos[1] || '.runtime/lines.json',
    outCues: pos[2] || '.runtime/cues.json',
    lang,
  };
}

function applyTtsEnvOverrides(ttsCfg) {
  const map = [
    ['TTS_PROVIDER', 'provider', String],
    ['TTS_VOICE', 'voice', String],
    ['TTS_MODEL', 'model', String],
    ['TTS_SPEED', 'speed', Number],
    ['TTS_BASE_URL', 'baseUrl', String],
  ];
  for (const [envKey, prop, cast] of map) {
    if (process.env[envKey]) ttsCfg[prop] = cast(process.env[envKey]);
  }
}

const LINE_TTS_KEYS = ['voice', 'speed', 'pitch', 'model', 'provider', 'style', 'instructions', 'enSlowdown', 'align'];

function serializeLineCue(c) {
  const overrides = {};
  let hasOverride = false;
  for (const k of LINE_TTS_KEYS) {
    if (c[k] != null) { overrides[k] = c[k]; hasOverride = true; }
  }
  return hasOverride ? { text: c.text, ...overrides } : c.text;
}

function resolveSceneSfx(V, sc, si) {
  const raw = typeof sc.sfx === 'function' ? sc.sfx(V.makeCtx ? V.makeCtx(sc, si) : null) : sc.sfx;
  return Array.isArray(raw) ? raw : [];
}

function buildVideoClipAudioList(dryClips, scenes) {
  return dryClips
    .filter(vc => Number(vc.volume || 0) > 0 && vc.src)
    .map(vc => {
      const sc = scenes[vc.sceneIndex] || { start: 0, duration: 0 };
      const clipStart = Number(vc.start || 0);
      return {
        src: vc.src,
        at: sc.start + clipStart,
        trim: Number(vc.trim || 0),
        speed: Number(vc.speed || 1),
        volume: Number(vc.volume || 0),
        maxDur: Math.max(0.1, sc.duration - clipStart),
      };
    });
}

const { videoId, outLines, outCues, lang } = parseExportArgs(process.argv.slice(2));
if (!videoId) {
  console.error('Error: No video found under videos/.');
  process.exit(1);
}

const { sandbox, videoDir, audioRel } = loadVideoSandbox(ROOT, videoId, { ignoreBaked: true, requireTimings: false, lang });
const V = sandbox.V;
const cfg = Object.assign({}, V.themeDefaults || {}, V.config || {});

const dryClips = [];
const anchorErrors = probeSceneAnchors(sandbox, dryClips);
if (anchorErrors.length > 0) {
  console.error(`\n❌ [${videoId}] Broken x.at() semantic anchor(s) detected:`);
  for (const err of anchorErrors) console.error(`  - ${err}`);
  process.exit(1);
}

const ttsCfg = cfg.tts === false ? { enabled: false } : Object.assign({}, cfg.tts || {});
if (cfg.pronunciation && !ttsCfg.pronunciation) ttsCfg.pronunciation = cfg.pronunciation;
applyTtsEnvOverrides(ttsCfg);

const linesPayload = {
  videoId,
  lang,
  videoDir,
  audioSrc: audioRel === null ? false : audioRel,
  tts: ttsCfg,
  scenes: V.scenes.map(sc => sc.cues.map(serializeLineCue)),
};

const impacts = [];
if (Array.isArray(V.glKeys)) {
  for (const k of V.glKeys) if (k.shape === 'burst') impacts.push(k.t);
}

const cuesPayload = {
  videoId,
  lang,
  videoDir,
  duration: V.duration,
  audioBitrate: process.env.AUDIO_BITRATE || cfg.audioBitrate || '128k',
  bgm: cfg.bgm === undefined ? { preset: 'ambient', volume: 0.16, duck: 0.55 } : cfg.bgm,
  sfx: cfg.sfx === undefined ? { preset: 'soft', volume: 0.18 } : cfg.sfx,
  scenes: V.scenes.map((sc, si) => ({
    title: sc.title,
    start: sc.start,
    duration: sc.duration,
    energy: sc.energy,
    cues: sc.cues,
    sfx: resolveSceneSfx(V, sc, si),
  })),
  impacts,
  videoClips: buildVideoClipAudioList(dryClips, V.scenes),
};

fs.mkdirSync(path.dirname(outLines), { recursive: true });
fs.mkdirSync(path.dirname(outCues), { recursive: true });
fs.writeFileSync(outLines, JSON.stringify(linesPayload, null, 2));
fs.writeFileSync(outCues, JSON.stringify(cuesPayload, null, 2));
writeSubtitleFiles(videoDir, V, lang);

const nLines = linesPayload.scenes.reduce((a, b) => a + b.length, 0);
console.log(`[${videoId}${lang ? ':' + lang : ''}] duration=${V.duration.toFixed(1)}s, scenes=${V.scenes.length}, lines=${nLines}`);
