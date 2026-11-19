import assert from 'node:assert/strict';
import { V } from '../runtime/base/js/index.mjs';

V.projectDefaults = {
  ui: { resume: true, rates: [1, 2] },
  bgm: { src: 'shared.m4a', volume: 0.2 },
  tts: { voice: 'default', pronunciation: { AxisOne: 'Axis One', AI: 'A I' } },
};
V.themeDefaults = { tts: { voice: 'course', pronunciation: { AIDC: 'A I D C', 执行: '执行' } } };
V.config = {
  bgm: { volume: 0 },
  ui: { rates: [1] },
  pronunciation: { 'Win+L': 'Win 加 L' },
  tts: { pronunciation: { AxisOne: false, MB: '兆' } },
};

const cfg = V.getCfg();
assert.deepEqual(cfg.bgm, { src: 'shared.m4a', volume: 0 });
assert.deepEqual(cfg.ui, { resume: true, rates: [1] });
assert.equal(cfg.tts.voice, 'course');
assert.equal(V._createSpeech().speak('AxisOne AIDC AI TRAIN 10MB Win+L，执行重构'),
  'AxisOne A I D C A I TRAIN 10兆 Win 加 L，执行崇构');

V.__activeLang = 'en';
V.locale('en', { tts: { pronunciation: { AIDC: false } } });
assert.equal(V._createSpeech().speak('AIDC AI 重构'), 'AIDC A I 重构');
V.__activeLang = '';
V.config.tts.polyphoneFix = false;
assert.equal(V._createSpeech().speak('AI 重构'), 'A I 重构');

V.config = { tts: false, bgm: false };
assert.equal(V.getCfg().tts, false);
assert.equal(V.getCfg().bgm, false);

for (const malformed of ['AI', ['AI'], null, false]) {
  V.config = { tts: { pronunciation: malformed } };
  assert.throws(() => V.getCfg(), /tts\.pronunciation must be an object/);
}
V.config = { pronunciation: 'AI', tts: { pronunciation: { IT: 'I T' } } };
assert.throws(() => V.getCfg(), /pronunciation must be an object/);
for (const malformed of [{ ' ': 'reading' }, { AI: true }, { AI: 1 }]) {
  V.config = { tts: { pronunciation: malformed } };
  assert.throws(() => V._createSpeech(), /Invalid tts\.pronunciation entry/);
}
console.log('Project, course, video and locale defaults passed.');
