// 语义词锚硬门禁、五维音画同步校验、bakedLayout 固化与外挂字幕 (.vtt/.srt) 同步工具
// 用法：node tools/verify-sync.mjs [video-id ...] [--stamp-baked] [--visual] [--strict] [--lang en]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, listVideoIds, loadVideoSandbox, resolveFfmpeg, probeSceneAnchors } from './lib/paths.mjs';
import { writeSubtitleFiles } from './lib/subtitles.mjs';
import { auditVideos } from './audit-visual.mjs';

const COMMON_HOMO_MAP = [
  [/重编排/g, '崇编排'], [/重算/g, '崇算'], [/重放/g, '崇放'], [/重写/g, '崇写'], [/重构/g, '崇构'],
  [/执行/g, '直形'], [/运行/g, '运形'], [/并行/g, '并形'], [/例行/g, '例形'], [/先行/g, '先形'],
  [/进行/g, '进形'], [/自行/g, '自形'], [/推行/g, '推形'], [/实行/g, '实形'], [/放行/g, '放形'],
  [/命令行/g, '命令航'], [/一行行/g, '一航航'],
];

const round3 = n => Math.round(Number(n) * 1000) / 1000;
const stripPunct = s => String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();

function buildSpokenNormalizer(pronunciation) {
  const customRules = [];
  if (pronunciation && typeof pronunciation === 'object') {
    for (const [pat, rep] of Object.entries(pronunciation)) {
      try { customRules.push([new RegExp(pat, 'g'), String(rep)]); } catch {}
    }
  }
  return s => {
    let out = String(s || '');
    for (const [re, rep] of customRules) out = out.replace(re, rep);
    for (const [re, rep] of COMMON_HOMO_MAP) out = out.replace(re, rep);
    return stripPunct(out);
  };
}

function normalizeLegacyLineSegs(lineSegs) {
  if (!Array.isArray(lineSegs)) return [];
  let prev = 0;
  return lineSegs.map(item => {
    if (!Array.isArray(item) || item.length >= 3) return item;
    const end = round3(Number(item[0]) || prev);
    const triple = [round3(prev), end, item[1]];
    prev = end;
    return triple;
  });
}

function resolveVoiceSubCuesGrid(voice) {
  if (Array.isArray(voice.subCues) && voice.subCues.length) return voice.subCues;
  if (!Array.isArray(voice.segs)) return [];
  return voice.segs.map(scSegs => (Array.isArray(scSegs) ? scSegs.map(normalizeLegacyLineSegs) : []));
}

function computeSceneSubCuesGrid(scenes) {
  return scenes.map(sc => {
    let subCursor = 0;
    return sc.cues.map(cue => {
      const lineSubs = [];
      while (subCursor < sc.subCues.length && sc.subCues[subCursor].start < cue.end - 0.01) {
        const s = sc.subCues[subCursor++];
        lineSubs.push([round3(s.start - cue.start), round3(s.end - cue.start), s.text]);
      }
      return lineSubs;
    });
  });
}

export function stampBakedLayout(videoId, lang = '') {
  const { sandbox, videoDir, timingsPath, bgmRel } = loadVideoSandbox(ROOT, videoId, { ignoreBaked: true, requireTimings: true, lang });
  const V = sandbox.V;
  const bakedLayout = {
    duration: round3(V.duration),
    scenes: V.scenes.map(sc => ({
      start: round3(sc.start),
      duration: round3(sc.duration),
      cues: sc.cues.map(c => [round3(c.start), round3(c.end)]),
    })),
  };

  if (!Array.isArray(V.voice.subCues) || !V.voice.subCues.length) {
    const fromLegacy = resolveVoiceSubCuesGrid(V.voice);
    V.voice.subCues = fromLegacy.length ? fromLegacy : computeSceneSubCuesGrid(V.scenes);
  }
  if (!bgmRel && V.voice.bgmSrc) {
    fs.rmSync(path.join(videoDir, V.voice.bgmSrc), { force: true });
  }
  const candBgm = bgmRel ? (V.voice.bgmSrc || bgmRel) : null;
  if (candBgm && fs.existsSync(path.join(videoDir, candBgm))) V.voice.bgmSrc = candBgm;
  else delete V.voice.bgmSrc;
  V.voice.bakedLayout = bakedLayout;

  const out = [
    '/* 配音时长（秒）、词边界字幕分段、30Hz 语音包络与固化时间轴，由构建管线生成并校验。 */',
    'window.V = window.V || {};',
    'V.voice = ' + JSON.stringify(V.voice) + ';',
    '',
  ].join('\n');
  fs.writeFileSync(timingsPath, out, 'utf8');
  writeSubtitleFiles(videoDir, V, lang);
  console.log(`[${videoId}] Stamped bakedLayout & subtitles -> ${path.relative(ROOT, timingsPath)} (duration=${bakedLayout.duration}s)`);
}

function checkSingleLineTextAndWords(si, li, lnText, dur, lSubs, lWords, normSpoken, errors) {
  if (!lSubs.length && !lWords.length) {
    errors.push(`S${si}L${li}: Missing both subCues and words in timings.js`);
  }
  if (lSubs.length) {
    const subText = lSubs.map(x => x[2]).join('');
    if (stripPunct(lnText) !== stripPunct(subText)) {
      errors.push(`S${si}L${li}: Subtitle text mismatch:\n    scene: ${lnText}\n    sub  : ${subText}`);
    }
    const subEnd = lSubs[lSubs.length - 1][1];
    if (Math.abs(subEnd - dur) > 0.15) errors.push(`S${si}L${li}: Last subCue end (${subEnd}s) != voice duration (${dur}s)`);
  }
  if (lWords.length) {
    const wordText = lWords.map(x => x[1]).join('');
    if (normSpoken(lnText) !== normSpoken(wordText)) {
      errors.push(`S${si}L${li}: Word-boundary text mismatch:\n    expected: ${normSpoken(lnText)}\n    actual  : ${normSpoken(wordText)}`);
    }
    const lastWordStart = lWords[lWords.length - 1][0];
    if (lastWordStart > dur || dur - lastWordStart > 1.8) {
      errors.push(`S${si}L${li}: Last word start (${lastWordStart}s) out of range for duration (${dur}s)`);
    }
  }
}

function verifyScenesAndTimings(V, voice, normSpoken, errors) {
  const durs = voice.durations || [], subs = resolveVoiceSubCuesGrid(voice), words = voice.words || [];
  if (V.scenes.length !== durs.length) {
    errors.push(`Scene count mismatch: scenes=${V.scenes.length}, timings.durations=${durs.length}`);
  }
  let totalLines = 0;
  for (let si = 0; si < V.scenes.length; si++) {
    const sc = V.scenes[si], sDurs = durs[si] || [];
    if (sc.lines.length !== sDurs.length) {
      errors.push(`Scene ${si} (${sc.title}) line count mismatch: scene=${sc.lines.length}, timings=${sDurs.length}`);
      continue;
    }
    for (let li = 0; li < sc.lines.length; li++) {
      totalLines++;
      const lSubs = (subs[si] && subs[si][li]) || [];
      const lWords = (words[si] && words[si][li]) || [];
      checkSingleLineTextAndWords(si, li, sc.lines[li].text, sDurs[li], lSubs, lWords, normSpoken, errors);
    }
  }
  return totalLines;
}

function verifyBakedLayoutMatch(V, voice, videoId, errors) {
  const b = voice.bakedLayout;
  if (!b) {
    errors.push(`Missing V.voice.bakedLayout in timings.js (run "html-video verify ${videoId} --stamp-baked")`);
    return;
  }
  if (Math.abs(b.duration - V.duration) > 0.01) {
    errors.push(`bakedLayout.duration (${b.duration}s) != dynamic V.duration (${V.duration.toFixed(3)}s). Re-build audio!`);
  }
  if (!Array.isArray(b.scenes) || b.scenes.length !== V.scenes.length) {
    errors.push('bakedLayout.scenes length mismatch');
    return;
  }
  for (let si = 0; si < V.scenes.length; si++) {
    const sc = V.scenes[si], bSc = b.scenes[si];
    if (Math.abs(sc.start - bSc.start) > 0.01 || Math.abs(sc.duration - bSc.duration) > 0.01) {
      errors.push(`Scene ${si} drifted from bakedLayout`);
    }
    for (let li = 0; li < sc.cues.length; li++) {
      const c = sc.cues[li], bc = bSc.cues && bSc.cues[li];
      if (!bc || Math.abs(c.start - bc[0]) > 0.01 || Math.abs(c.end - bc[1]) > 0.01) {
        errors.push(`S${si}L${li} cue drifted from bakedLayout`);
      }
    }
  }
}

function collectAbsSfxTimes(V, sc, si, globalEvents) {
  let rawSfx = [];
  try {
    rawSfx = typeof sc.sfx === 'function' ? sc.sfx(V.makeCtx ? V.makeCtx(sc, si) : null) : (sc.sfx || []);
  } catch {}
  const list = Array.isArray(rawSfx) ? rawSfx : [];
  return [
    ...list.map(ev => sc.start + Number((ev && ev.at) ?? -999)),
    ...globalEvents.map(ev => Number((ev && ev.at) ?? -999)),
  ].filter(Number.isFinite);
}

function rmsInSampleWindow(samples, sr, t0, t1) {
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const i1 = Math.min(samples.length, Math.floor(t1 * sr));
  if (i1 <= i0) return 0;
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (i1 - i0));
}

function verifyDecodedWaveform(V, cfg, samples, sr, videoId, totalLines, errors) {
  const actualDur = samples.length / sr;
  const durDiff = Math.abs(actualDur - V.duration);
  if (durDiff > 0.08) {
    errors.push(`Physical soundtrack duration (${actualDur.toFixed(3)}s) differs from V.duration (${V.duration.toFixed(3)}s)`);
  }
  const globalEvents = Array.isArray(cfg.sfx && cfg.sfx.events) ? cfg.sfx.events : [];
  for (let si = 0; si < V.scenes.length; si++) {
    const sc = V.scenes[si];
    const absSfx = collectAbsSfxTimes(V, sc, si, globalEvents);
    for (let li = 0; li < sc.cues.length; li++) {
      const absStart = sc.start + sc.cues[li].start, absEnd = sc.start + sc.cues[li].end;
      const rmsVoice = rmsInSampleWindow(samples, sr, absStart, absEnd);
      const rmsGap = rmsInSampleWindow(samples, sr, absEnd + 0.05, Math.min(actualDur, absEnd + 0.22));
      const hasGapSfx = absSfx.some(ts => ts >= absEnd - 0.12 && ts <= absEnd + 0.28);
      if (rmsVoice < 0.08) errors.push(`S${si}L${li}: Voice RMS too low (${rmsVoice.toFixed(3)})`);
      else if (!hasGapSfx && rmsGap > 0 && rmsVoice < rmsGap * 1.8) {
        errors.push(`S${si}L${li}: Voice/Gap RMS contrast too low (voice=${rmsVoice.toFixed(3)}, gap=${rmsGap.toFixed(3)})`);
      }
    }
  }
  console.log(`[${videoId}] Audio verified: V.duration=${V.duration.toFixed(3)}s, m4a=${actualDur.toFixed(3)}s (diff=${durDiff.toFixed(4)}s), scenes=${V.scenes.length}, lines=${totalLines}`);
}

function verifyBgmStem(videoDir, V, voice, ffmpegBin, errors) {
  if (!voice.bgmSrc) return;
  const bgmPath = path.join(videoDir, voice.bgmSrc);
  if (!fs.existsSync(bgmPath)) { errors.push(`Missing physical BGM stem: ${bgmPath}`); return; }
  const sr = 8000;
  const dec = spawnSync(ffmpegBin, ['-v', 'error', '-i', bgmPath, '-f', 'f32le', '-ac', '1', '-ar', String(sr), '-'], { maxBuffer: 60 * 1024 * 1024 });
  if (dec.status !== 0 || !dec.stdout || !dec.stdout.byteLength) {
    errors.push(`Failed to decode BGM stem ${bgmPath} via ffmpeg`);
    return;
  }
  const bgmDur = Math.floor(dec.stdout.byteLength / 4) / sr;
  if (Math.abs(bgmDur - V.duration) > 0.12) {
    errors.push(`Physical BGM duration (${bgmDur.toFixed(3)}s) differs from V.duration (${V.duration.toFixed(3)}s)`);
  }
}

function verifyPhysicalAudio(videoId, videoDir, V, cfg, voice, audioRelFallback, ffmpegBin, totalLines, errors) {
  if (cfg.audioSrc === false || voice.src === false) return;
  const audioPath = path.join(videoDir, voice.src || audioRelFallback || 'assets/soundtrack.m4a');
  if (!fs.existsSync(audioPath)) { errors.push(`Missing physical audio file: ${audioPath}`); return; }
  const sr = 16000;
  const dec = spawnSync(ffmpegBin, ['-v', 'error', '-i', audioPath, '-f', 'f32le', '-ac', '1', '-ar', String(sr), '-'], { maxBuffer: 120 * 1024 * 1024 });
  if (dec.status !== 0 || !dec.stdout || !dec.stdout.byteLength) {
    errors.push(`Failed to decode ${audioPath} via ffmpeg`);
    return;
  }
  const samples = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, Math.floor(dec.stdout.byteLength / 4));
  verifyDecodedWaveform(V, cfg, samples, sr, videoId, totalLines, errors);
  verifyBgmStem(videoDir, V, voice, ffmpegBin, errors);
}

export function verifyVideo(videoId, ffmpegBin, lang = '') {
  const errors = [];
  const { sandbox: dynamicSb, videoDir, audioRel } = loadVideoSandbox(ROOT, videoId, { ignoreBaked: true, requireTimings: false, lang });
  const { sandbox: runtimeSb } = loadVideoSandbox(ROOT, videoId, { ignoreBaked: false, requireTimings: false, lang });
  const V = dynamicSb.V;
  const cfg = Object.assign({}, V.themeDefaults || {}, V.config || {});

  for (const ae of probeSceneAnchors(dynamicSb)) errors.push(`Broken anchor: ${ae}`);

  const totalSceneLines = V.scenes.reduce((acc, sc) => acc + (sc.lines ? sc.lines.length : 0), 0);
  if (cfg.audioSrc === false && totalSceneLines === 0) {
    if (!errors.length) console.log(`[${videoId}] Pure-visual mode verified: V.duration=${V.duration.toFixed(3)}s, scenes=${V.scenes.length}`);
    return errors;
  }
  if (!V.voice) {
    errors.push(`Missing timings file for '${videoId}'. Run "html-video build ${videoId}".`);
    return errors;
  }

  const totalLines = verifyScenesAndTimings(V, V.voice, buildSpokenNormalizer(cfg.pronunciation), errors);
  verifyBakedLayoutMatch(V, V.voice, videoId, errors);
  if (Math.abs(runtimeSb.V.duration - V.duration) > 0.01) {
    errors.push(`Runtime V.duration (${runtimeSb.V.duration}) != dynamic V.duration (${V.duration})`);
  }
  verifyPhysicalAudio(videoId, videoDir, V, cfg, V.voice, audioRel, ffmpegBin, totalLines, errors);
  return errors;
}

function parseVerifyCliArgs(rawArgs) {
  const langIdx = rawArgs.indexOf('--lang');
  const lang = langIdx >= 0 && rawArgs[langIdx + 1] ? rawArgs[langIdx + 1] : '';
  const targets = rawArgs.filter((a, i) => !a.startsWith('--') && (langIdx < 0 || i !== langIdx + 1));
  return {
    stampFlag: rawArgs.includes('--stamp-baked'),
    visualFlag: rawArgs.includes('--visual'),
    strictFlag: rawArgs.includes('--strict'),
    lang,
    targetVideos: targets.length ? targets : listVideoIds(),
  };
}

async function runVerifyCli() {
  const opts = parseVerifyCliArgs(process.argv.slice(2));
  if (!opts.targetVideos.length) { console.log('No videos found under videos/.'); return; }
  const ffmpegBin = resolveFfmpeg(ROOT);
  let hasError = false;

  for (const v of opts.targetVideos) {
    if (opts.stampFlag) stampBakedLayout(v, opts.lang);
    const errs = verifyVideo(v, ffmpegBin, opts.lang);
    if (errs.length) {
      hasError = true;
      console.error(`\n❌ [${v}] SYNC VERIFICATION FAILED (${errs.length} issue(s)):`);
      for (const e of errs) console.error(`  - ${e}`);
    } else {
      console.log(`✅ [${v}] All audio-visual sync checks PASSED.`);
    }
  }

  if (opts.visualFlag) {
    const { errors: vErrs } = await auditVideos(opts.targetVideos, { strict: opts.strictFlag, lang: opts.lang });
    if (vErrs > 0) hasError = true;
  }
  if (hasError) process.exit(1);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('verify-sync.mjs');
if (isDirectRun) await runVerifyCli();
