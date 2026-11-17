import fs from 'node:fs/promises';
import path from 'node:path';

function checkSignal(signal) {
  if (signal?.aborted) throw new DOMException('Capture cancelled', 'AbortError');
}

function capturePoint(point, index) {
  if (typeof point === 'number' && Number.isFinite(point)) return { time: point, name: `frame-${index + 1}` };
  if (!point || !Number.isFinite(point.time)) throw new TypeError('Capture points require a finite time');
  return point;
}

function outputFile(outDir, point) {
  const name = String(point.name || 'frame').replace(/[^\w\u4e00-\u9fff.-]/g, '_').slice(0, 120);
  return path.join(outDir, `${name}_${point.time.toFixed(2)}s.png`);
}

function uniqueOutput(file, used) {
  if (!file) return file;
  const { dir, name, ext } = path.parse(file);
  const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  let candidate = file, suffix = 2;
  while (used.has(key(candidate))) candidate = path.join(dir, `${name}_${suffix++}${ext}`);
  used.add(key(candidate));
  return candidate;
}

export async function captureBatch(points, { outDir = '', screenshot = {}, retainImages = false, signal, onCapture } = {}, capture) {
  const normalized = points.map(capturePoint);
  if (outDir) await fs.mkdir(outDir, { recursive: true });
  const results = [], usedFiles = new Set();
  for (const point of normalized) {
    checkSignal(signal);
    const file = uniqueOutput(outDir ? outputFile(path.resolve(outDir), point) : screenshot.path, usedFiles);
    const result = await capture(point.time, { ...screenshot, ...(file ? { path: file } : {}) });
    checkSignal(signal);
    const item = { point, frame: result.frame, path: file || null };
    if (retainImages) item.image = result.image;
    if (onCapture) await onCapture(item, result.image);
    results.push(item);
  }
  return results;
}
