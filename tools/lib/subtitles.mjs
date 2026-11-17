// WebVTT (.vtt) 与 SubRip (.srt) 标准外挂字幕导出模块
import fs from 'node:fs';
import path from 'node:path';
import { writeUtf8FileAtomic } from './file-output.mjs';

function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

function formatTimestamp(sec, sep) {
  const msTotal = Math.max(0, Math.round(Number(sec || 0) * 1000));
  const h = Math.floor(msTotal / 3600000);
  const m = Math.floor((msTotal % 3600000) / 60000);
  const s = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}${sep}${pad3(ms)}`;
}

export function collectAbsoluteSubCues(V) {
  const items = [];
  for (const sc of (V.scenes || [])) {
    const list = sc.subCues && sc.subCues.length ? sc.subCues : (sc.cues || []);
    for (const c of list) {
      const text = String(c.text || '').trim();
      if (!text) continue;
      items.push({
        start: sc.start + c.start,
        end: sc.start + c.end,
        speaker: c.speaker || '',
        text,
      });
    }
  }
  return items;
}

function escapeVttText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildVttContent(items) {
  const lines = ['WEBVTT', ''];
  items.forEach((it, idx) => {
    const prefix = it.speaker ? `<v ${escapeVttText(it.speaker)}>` : '';
    lines.push(String(idx + 1));
    lines.push(`${formatTimestamp(it.start, '.')} --> ${formatTimestamp(it.end, '.')}`);
    lines.push(`${prefix}${escapeVttText(it.text)}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function buildSrtContent(items) {
  const lines = [];
  items.forEach((it, idx) => {
    const prefix = it.speaker ? `[${it.speaker}] ` : '';
    lines.push(String(idx + 1));
    lines.push(`${formatTimestamp(it.start, ',')} --> ${formatTimestamp(it.end, ',')}`);
    lines.push(`${prefix}${it.text}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function writeSubtitleFiles(videoDir, V, lang = '') {
  const items = collectAbsoluteSubCues(V);
  if (lang && /[\/\\\u0000]/.test(String(lang))) throw new Error('Invalid language code: use a single name without path separators.');
  const suffix = lang ? `.${lang}` : '';
  const assetsDir = path.join(videoDir, 'assets');
  const vttPath = path.join(assetsDir, `subtitles${suffix}.vtt`);
  const srtPath = path.join(assetsDir, `subtitles${suffix}.srt`);
  if (!items.length) {
    fs.rmSync(vttPath, { force: true });
    fs.rmSync(srtPath, { force: true });
    return null;
  }
  fs.mkdirSync(assetsDir, { recursive: true });
  writeUtf8FileAtomic(vttPath, buildVttContent(items));
  writeUtf8FileAtomic(srtPath, buildSrtContent(items));
  return { vttPath, srtPath, count: items.length };
}
