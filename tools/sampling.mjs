const POSITIONS = { early: 0.18, mid: 0.52, end: 0.90 };

function selectIndices(items, requested, fallback) {
  if (requested === undefined) return fallback;
  const selected = Array.isArray(requested) ? requested : [requested];
  for (const index of selected) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new RangeError(`Sample index out of range: ${index}`);
  }
  return [...new Set(selected)];
}

function cueIndices(cues, mode, requested) {
  const all = cues.map((_, i) => i);
  if (requested !== undefined) return selectIndices(cues, requested, []);
  if (mode === 'smoke') return all.slice(0, 1);
  if (mode === 'summary') return [...new Set([0, Math.floor(cues.length / 2), cues.length - 1])];
  return all;
}

function positionTime(position, duration) {
  if (position === 'early') return Math.min(0.35, duration * POSITIONS.early);
  const fraction = typeof position === 'number' ? position : POSITIONS[position];
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new RangeError(`Invalid sample position: ${position}`);
  return duration * fraction;
}

function clampTime(scene, time) {
  const lo = scene.start + Math.min(0.04, scene.duration / 4);
  const hi = Math.max(lo, scene.start + scene.duration - Math.min(0.06, scene.duration / 4));
  return Math.max(lo, Math.min(hi, time));
}

function cuePoints(scene, sceneIndex, cueIndex, positions) {
  const cue = scene.cues[cueIndex], duration = Math.max(0, cue.end - cue.start);
  const tag = `S${String(sceneIndex + 1).padStart(2, '0')}_L${String(cueIndex + 1).padStart(2, '0')}`;
  return positions.map((position, i) => ({
    name: `${tag}_${String.fromCharCode(97 + i)}_${position}`, sceneIndex, cueIndex, position,
    time: clampTime(scene, scene.start + cue.start + positionTime(position, duration)),
  }));
}

export function sampleFrames(metadata, { scenes, cues, positions = ['early', 'mid', 'end'], mode = 'smoke' } = {}) {
  if (!['smoke', 'summary', 'all'].includes(mode)) throw new TypeError(`Unknown sample mode: ${mode}`);
  if (!Array.isArray(positions) || positions.length === 0) throw new TypeError('Sample positions must not be empty');
  positions.forEach(position => positionTime(position, 1));
  const list = metadata.scenes || [];
  const all = list.map((_, i) => i);
  const selected = selectIndices(list, scenes, mode === 'smoke' ? all.slice(0, 1) : all);
  return selected.flatMap(index => {
    const scene = list[index];
    if (!(scene.duration > 0)) return [];
    if (!scene.cues.length) return [{ name: `S${String(index + 1).padStart(2, '0')}_mid`, sceneIndex: index, cueIndex: null,
      time: clampTime(scene, scene.start + scene.duration / 2) }];
    return cueIndices(scene.cues, mode, cues).flatMap(cueIndex => cuePoints(scene, index, cueIndex, positions));
  });
}
