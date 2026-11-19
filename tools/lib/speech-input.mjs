import { createHash } from 'node:crypto';

export function spokenInputDigest(V) {
  const input = V.scenes.map(scene => scene.cues.map(cue => cue.spoken));
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function spokenInputStatus(V, voice) {
  if (!voice?.spokenDigest) return 'unrecorded';
  return voice.spokenDigest === spokenInputDigest(V) ? 'current' : 'changed';
}
