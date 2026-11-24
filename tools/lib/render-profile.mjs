// 渲染分辨率缩放（HiDPI）与软/硬编视频编码器配置解析
import { spawnSync } from 'node:child_process';

const RES_PRESETS = {
  '720p': 720,
  'hd': 720,
  '1080p': 1080,
  'fhd': 1080,
  '2k': 1440,
  '1440p': 1440,
  'qhd': 1440,
  '4k': 2160,
  '2160p': 2160,
  'uhd': 2160,
};

const ENCODER_ALIASES = {
  h264: 'libx264',
  x264: 'libx264',
  hevc: 'libx265',
  h265: 'libx265',
  x265: 'libx265',
  nvenc: 'h264_nvenc',
  qsv: 'h264_qsv',
  amf: 'h264_amf',
};

const AUTO_CHAINS = {
  auto: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'],
  'auto:h264': ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'],
  'auto:hevc': ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
  'auto:h265': ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
  'auto:av1': ['av1_nvenc', 'av1_qsv', 'av1_amf'],
};

function buildSwArgs(codec, tag, threads, quality, preset) {
  const args = ['-c:v', codec, '-threads', String(threads), '-preset', preset, '-crf', String(quality)];
  if (tag) args.push('-tag:v', tag);
  args.push('-pix_fmt', 'yuv420p');
  return args;
}

function buildNvencArgs(codec, tag, quality, preset) {
  const args = ['-c:v', codec, '-preset', preset, '-rc', 'vbr', '-cq', String(quality), '-b:v', '0'];
  if (tag) args.push('-tag:v', tag);
  args.push('-pix_fmt', 'yuv420p');
  return args;
}

function buildQsvArgs(codec, tag, quality, preset) {
  const args = ['-c:v', codec, '-preset', preset, '-global_quality', String(quality)];
  if (tag) args.push('-tag:v', tag);
  args.push('-pix_fmt', 'nv12');
  return args;
}

function buildAmfArgs(codec, tag, quality, preset) {
  const args = ['-c:v', codec, '-quality', preset, '-rc', 'cqp', '-qp_i', String(quality), '-qp_p', String(quality)];
  if (tag) args.push('-tag:v', tag);
  args.push('-pix_fmt', 'yuv420p');
  return args;
}

const ENCODER_SPECS = {
  libx264: { codec: 'h264', hw: false, defaultQuality: 18, defaultPreset: 'medium', build: o => buildSwArgs('libx264', '', o.threads, o.quality, o.preset) },
  libx265: { codec: 'hevc', hw: false, defaultQuality: 20, defaultPreset: 'medium', build: o => buildSwArgs('libx265', 'hvc1', o.threads, o.quality, o.preset) },
  h264_nvenc: { codec: 'h264', hw: true, defaultQuality: 19, defaultPreset: 'p5', build: o => buildNvencArgs('h264_nvenc', '', o.quality, o.preset) },
  hevc_nvenc: { codec: 'hevc', hw: true, defaultQuality: 21, defaultPreset: 'p5', build: o => buildNvencArgs('hevc_nvenc', 'hvc1', o.quality, o.preset) },
  av1_nvenc: { codec: 'av1', hw: true, defaultQuality: 24, defaultPreset: 'p5', build: o => buildNvencArgs('av1_nvenc', '', o.quality, o.preset) },
  h264_qsv: { codec: 'h264', hw: true, defaultQuality: 20, defaultPreset: 'medium', build: o => buildQsvArgs('h264_qsv', '', o.quality, o.preset) },
  hevc_qsv: { codec: 'hevc', hw: true, defaultQuality: 22, defaultPreset: 'medium', build: o => buildQsvArgs('hevc_qsv', 'hvc1', o.quality, o.preset) },
  av1_qsv: { codec: 'av1', hw: true, defaultQuality: 25, defaultPreset: 'medium', build: o => buildQsvArgs('av1_qsv', '', o.quality, o.preset) },
  h264_amf: { codec: 'h264', hw: true, defaultQuality: 19, defaultPreset: 'quality', build: o => buildAmfArgs('h264_amf', '', o.quality, o.preset) },
  hevc_amf: { codec: 'hevc', hw: true, defaultQuality: 21, defaultPreset: 'quality', build: o => buildAmfArgs('hevc_amf', 'hvc1', o.quality, o.preset) },
  av1_amf: { codec: 'av1', hw: true, defaultQuality: 24, defaultPreset: 'quality', build: o => buildAmfArgs('av1_amf', '', o.quality, o.preset) },
};

function parseExplicitDimensions(raw, W, H) {
  const m = /^(\d+)x(\d+)$/i.exec(raw);
  if (!m) return null;
  const tw = Number(m[1]);
  const th = Number(m[2]);
  if (!Number.isInteger(tw) || !Number.isInteger(th) || tw <= 0 || th <= 0 || tw % 2 !== 0 || th % 2 !== 0) {
    throw new Error(`Invalid --res "${raw}": dimensions must be positive even integers.`);
  }
  if (tw * H !== th * W) {
    throw new Error(`Invalid --res "${raw}": aspect ratio must match stage ${W}x${H}.`);
  }
  return tw / W;
}

function parseResToScale(resRaw, W, H) {
  const clean = String(resRaw || '').trim().toLowerCase();
  if (!clean) throw new Error('Invalid --res: expected preset (720p, 1080p, 2k, 4k) or WxH.');
  if (RES_PRESETS[clean]) return RES_PRESETS[clean] / Math.min(W, H);
  const scale = parseExplicitDimensions(clean, W, H);
  if (scale !== null) return scale;
  throw new Error(`Invalid --res "${resRaw}": expected 720p, 1080p, 2k, 4k, or WxH.`);
}

function validateScaleOutput(scale, W, H) {
  const num = Number(scale);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`Invalid render scale "${scale}": expected a positive number.`);
  }
  const outW = Math.round(W * num);
  const outH = Math.round(H * num);
  if (Math.abs(outW - W * num) > 1e-4 || Math.abs(outH - H * num) > 1e-4 || outW <= 0 || outH <= 0 || outW % 2 !== 0 || outH % 2 !== 0) {
    throw new Error(`Invalid render scale ${num} for ${W}x${H}: output ${outW}x${outH} must be exact positive even integers.`);
  }
  return { scale: outW / W, outW, outH };
}

export function resolveRenderScale(opts = {}, cfg = {}, W, H) {
  if (opts.scale != null && opts.res != null) {
    throw new Error('Specify either --scale or --res, not both.');
  }
  const renderCfg = cfg.render || {};
  const candidates = [
    ['scale', opts.scale],
    ['res', opts.res],
    ['scale', process.env.RENDER_SCALE],
    ['res', process.env.RENDER_RES],
    ['scale', renderCfg.scale],
    ['res', renderCfg.res],
  ];
  const hit = candidates.find(([, val]) => val != null && val !== '');
  if (!hit) return { scale: 1, outW: W, outH: H };
  const scale = hit[0] === 'scale' ? hit[1] : parseResToScale(hit[1], W, H);
  return validateScaleOutput(scale, W, H);
}

export function probeFfmpegEncoder(ffmpegBin, encoderName) {
  const spec = ENCODER_SPECS[encoderName];
  if (!spec) return false;
  const encArgs = spec.build({ threads: 1, quality: spec.defaultQuality, preset: spec.defaultPreset });
  const r = spawnSync(
    ffmpegBin,
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:d=0.05', '-frames:v', '1', ...encArgs, '-f', 'null', '-'],
    { stdio: 'ignore', timeout: 8000 }
  );
  return r.status === 0;
}

function resolveAutoEncoder(rawKey, ffmpegBin, probeFn) {
  const chain = AUTO_CHAINS[rawKey];
  if (!chain) throw new Error(`Unknown auto encoder target "${rawKey}". Expected auto, auto:h264, auto:hevc, or auto:av1.`);
  for (const candidate of chain) {
    if (probeFn(ffmpegBin, candidate)) return candidate;
  }
  throw new Error(`No available FFmpeg encoder found for "${rawKey}" (tried: ${chain.join(', ')}).`);
}

function pickValue(values, fallback) {
  const hit = values.find(v => v != null && v !== '');
  return hit === undefined ? fallback : hit;
}

function resolveQualityValue(opts, renderCfg, spec) {
  const raw = pickValue([opts.quality, process.env.RENDER_QUALITY, renderCfg.quality], null);
  if (raw == null) return spec.defaultQuality;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < 0 || val > 51) {
    throw new Error(`Invalid render quality "${raw}": expected a number between 0 and 51.`);
  }
  return val;
}

function lookupEncoderSpec(raw, ffmpegBin, probeFn) {
  const normalized = ENCODER_ALIASES[raw] || raw;
  const name = normalized.startsWith('auto') ? resolveAutoEncoder(normalized, ffmpegBin, probeFn) : normalized;
  const spec = ENCODER_SPECS[name];
  if (!spec) {
    throw new Error(`Unsupported video encoder "${raw}". Supported: ${Object.keys(ENCODER_SPECS).join(', ')}, auto, auto:hevc, auto:av1.`);
  }
  return { name, spec };
}

export function resolveEncoderProfile(opts = {}, cfg = {}, ffmpegBin, probeFn = probeFfmpegEncoder) {
  const renderCfg = cfg.render || {};
  const raw = String(pickValue([opts.encoder, process.env.RENDER_ENCODER, renderCfg.encoder], 'libx264')).trim().toLowerCase();
  const { name, spec } = lookupEncoderSpec(raw, ffmpegBin, probeFn);
  const quality = resolveQualityValue(opts, renderCfg, spec);
  const preset = String(pickValue([opts.preset, process.env.RENDER_PRESET, renderCfg.preset], spec.defaultPreset)).trim();
  return {
    encoder: name,
    codec: spec.codec,
    hw: spec.hw,
    quality,
    preset,
    buildArgs: threads => spec.build({ threads, quality, preset }),
  };
}
