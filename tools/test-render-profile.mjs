import assert from 'node:assert/strict';
import { resolveEncoderProfile, resolveRenderScale } from './lib/render-profile.mjs';

function testScalePresets() {
  assert.deepEqual(resolveRenderScale({}, {}, 1920, 1080), { scale: 1, outW: 1920, outH: 1080 });
  assert.deepEqual(resolveRenderScale({ scale: '2' }, {}, 1920, 1080), { scale: 2, outW: 3840, outH: 2160 });
  assert.deepEqual(resolveRenderScale({ res: '4k' }, {}, 1920, 1080), { scale: 2, outW: 3840, outH: 2160 });
  assert.deepEqual(resolveRenderScale({ res: '2k' }, {}, 1920, 1080), { scale: 2560 / 1920, outW: 2560, outH: 1440 });
  assert.deepEqual(resolveRenderScale({ res: '720p' }, {}, 1920, 1080), { scale: 1280 / 1920, outW: 1280, outH: 720 });
  assert.deepEqual(resolveRenderScale({ res: '3840x2160' }, {}, 1920, 1080), { scale: 2, outW: 3840, outH: 2160 });
  assert.deepEqual(resolveRenderScale({ res: '4k' }, {}, 1080, 1920), { scale: 2, outW: 2160, outH: 3840 });
  assert.deepEqual(resolveRenderScale({}, { render: { res: '4k' } }, 1920, 1080), { scale: 2, outW: 3840, outH: 2160 });
}

function testScaleValidation() {
  assert.throws(() => resolveRenderScale({ scale: 2, res: '4k' }, {}, 1920, 1080), /not both/i);
  assert.throws(() => resolveRenderScale({ res: '1920x1200' }, {}, 1920, 1080), /aspect ratio/i);
  assert.throws(() => resolveRenderScale({ res: '1921x1080' }, {}, 1920, 1080), /even integers/i);
  assert.throws(() => resolveRenderScale({ res: 'unknown' }, {}, 1920, 1080), /Invalid --res/i);
  assert.throws(() => resolveRenderScale({ scale: '0' }, {}, 1920, 1080), /Invalid render scale/i);
  assert.throws(() => resolveRenderScale({ scale: '1.001' }, {}, 1920, 1080), /exact positive even integers/i);
}

function testEncoderProfiles() {
  const sw = resolveEncoderProfile({}, {}, 'ffmpeg');
  assert.equal(sw.encoder, 'libx264');
  assert.equal(sw.hw, false);
  assert.deepEqual(sw.buildArgs(8), ['-c:v', 'libx264', '-threads', '8', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p']);

  const hevc = resolveEncoderProfile({ encoder: 'hevc', quality: '22', preset: 'slow' }, {}, 'ffmpeg');
  assert.equal(hevc.encoder, 'libx265');
  assert.ok(hevc.buildArgs(4).includes('hvc1'));
  assert.ok(hevc.buildArgs(4).includes('22'));

  const nvenc = resolveEncoderProfile({ encoder: 'h264_nvenc' }, {}, 'ffmpeg');
  assert.equal(nvenc.hw, true);
  assert.deepEqual(nvenc.buildArgs(8), ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p']);

  const qsv = resolveEncoderProfile({ encoder: 'qsv' }, {}, 'ffmpeg');
  assert.equal(qsv.encoder, 'h264_qsv');
  assert.equal(qsv.hw, true);
  assert.deepEqual(qsv.buildArgs(8), ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '20', '-pix_fmt', 'nv12']);

  const amf = resolveEncoderProfile({ encoder: 'amf' }, {}, 'ffmpeg');
  assert.equal(amf.encoder, 'h264_amf');
  assert.equal(amf.hw, true);
  assert.deepEqual(amf.buildArgs(8), ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19', '-pix_fmt', 'yuv420p']);
}

function testAutoEncoderProbe() {
  const seen = [];
  const autoQsv = resolveEncoderProfile({ encoder: 'auto' }, {}, 'ffmpeg', (_bin, name) => {
    seen.push(name);
    return name === 'h264_qsv';
  });
  assert.equal(autoQsv.encoder, 'h264_qsv');
  assert.deepEqual(seen, ['h264_nvenc', 'h264_qsv']);

  const autoFallback = resolveEncoderProfile({ encoder: 'auto:hevc' }, {}, 'ffmpeg', (_bin, name) => name === 'libx265');
  assert.equal(autoFallback.encoder, 'libx265');
  assert.equal(autoFallback.hw, false);

  assert.throws(() => resolveEncoderProfile({ encoder: 'bad_codec' }, {}, 'ffmpeg'), /Unsupported video encoder/i);
  assert.throws(() => resolveEncoderProfile({ quality: '99' }, {}, 'ffmpeg'), /Invalid render quality/i);
}

testScalePresets();
testScaleValidation();
testEncoderProfiles();
testAutoEncoderProbe();
console.log('Render scale, resolution presets and encoder profile regressions PASSED.');
