import fs from 'node:fs';
import path from 'node:path';
import { writeUtf8FileAtomic } from './file-output.mjs';
import { spokenInputStatus } from './speech-input.mjs';

const SAMPLES_PER_SECOND = 30;
const QUIET_LEVEL = 5;
const MIN_QUIET_SAMPLES = 9;

const seconds = value => `${Number(value).toFixed(2)}s`;
const clock = value => {
  const millis = Math.round(value * 1000);
  const minutes = Math.floor(millis / 60000);
  const remainder = (millis % 60000 / 1000).toFixed(3).padStart(6, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
};
const cell = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

function findQuietRuns(envelope, duration) {
  if (!Array.isArray(envelope) || !Number.isFinite(duration) || duration <= 0 ||
      Math.abs(envelope.length / SAMPLES_PER_SECOND - duration) > 0.06 ||
      !envelope.every(level => Number.isFinite(level) && level >= 0 && level <= 100)) return null;
  const first = envelope.findIndex(level => level > QUIET_LEVEL);
  if (first < 0) return null;
  const last = envelope.findLastIndex(level => level > QUIET_LEVEL);
  const runs = [];
  let start = -1;
  for (let i = first + 1; i <= last; i++) {
    if (envelope[i] <= QUIET_LEVEL) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= MIN_QUIET_SAMPLES) runs.push([start / SAMPLES_PER_SECOND, i / SAMPLES_PER_SECOND]);
      start = -1;
    }
  }
  return runs;
}

function describeRun(words, from, to, offset) {
  const left = words.findLast(([time]) => time <= from);
  const right = words.find(([time]) => time >= to);
  const around = [left?.[1], right?.[1]].filter(Boolean).join(' / ');
  return `${clock(offset + from)}–${clock(offset + to)}（${seconds(to - from)}${around ? '，附近词：' + around : ''}）`;
}

function describeCuePauses(sceneIndex, lineIndex, voice, offset) {
  const envelope = voice?.envelopes?.[sceneIndex]?.[lineIndex];
  const duration = voice?.durations?.[sceneIndex]?.[lineIndex];
  const runs = findQuietRuns(envelope, duration);
  if (!runs) return '未测';
  if (!runs.length) return '未发现明显低声段';
  const candidates = voice?.words?.[sceneIndex]?.[lineIndex];
  const words = Array.isArray(candidates)
    ? candidates.filter(word => Array.isArray(word) && Number.isFinite(word[0]) && typeof word[1] === 'string') : [];
  return runs.map(([from, to]) => describeRun(words, from, to, offset)).join('；');
}

function describeGap(cue, next, gap, extra) {
  return next ? `${seconds(next.start - cue.end)}（当前配置：gap ${seconds(gap)} + pause ${seconds(extra)}）` : '—';
}

export function buildPauseReport(videoId, lang, V) {
  const voice = V.getActiveVoice();
  const status = spokenInputStatus(V, voice);
  const speechStatus = !voice ? '无配音时间数据。' : {
    current: '朗读文本与配音时记录的输入一致。',
    changed: '朗读文本已改变，以下句内估算来自旧配音。',
    unrecorded: '现有数据未记录朗读输入，无法确认是否对应当前原稿。',
  }[status];
  const output = [
    `# 停顿报告：${cell(videoId)}${lang ? ' · ' + cell(lang) : ''}`,
    '',
    `句间来源：${V.layoutInfo.source === 'baked' ? '已固化时间轴' : '当前估算时间轴'}。只计算同一幕相邻两句；括号内是当前配置，可能与已固化的间隔不同。`,
    '句内来源：现有 timings.js 的 30Hz 声音强度，约 0.30 秒以上的低声段才列出；附近词来自已有逐词数据。改稿后，旧配音数据可能尚未更新。',
    speechStatus,
  ];
  V.scenes.forEach((scene, sceneIndex) => {
    if (!scene.cues.length) return;
    output.push('', `## 第 ${sceneIndex + 1} 幕：${cell(scene.title)}`, '',
      '| 句号与起点 | 原句 | 朗读文本（有变化时） | 句间留白 | 句内低声段估算 |',
      '| --- | --- | --- | --- | --- |');
    scene.cues.forEach((cue, lineIndex) => {
      const absStart = scene.start + cue.start;
      const gap = describeGap(cue, scene.cues[lineIndex + 1], V.layoutInfo.gap, scene.lines[lineIndex].pause || 0);
      const intra = describeCuePauses(sceneIndex, lineIndex, voice, absStart);
      const row = [`${lineIndex + 1} · ${clock(absStart)}`, cue.text, cue.spoken === cue.text ? '—' : cue.spoken, gap, intra];
      output.push(`| ${row.map(cell).join(' | ')} |`);
    });
  });
  return output.join('\n') + '\n';
}

export function writePauseReport(root, videoId, lang, V) {
  const dir = path.join(root, '.runtime', 'reports', videoId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, lang ? `pauses.${lang}.md` : 'pauses.md');
  writeUtf8FileAtomic(file, buildPauseReport(videoId, lang, V));
  return file;
}
