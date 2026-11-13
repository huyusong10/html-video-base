/* core/04-timeline.js · 时间轴排布、句内语义词锚 (x.at)、多语言覆盖与 30Hz 语音振幅包络采样 */
(function (V) {
  const { clamp } = V.u;
  const DEFAULT_CPS = 5.4, DEFAULT_GAP = 0.22, DEFAULT_LEAD = 0.35, DEFAULT_TAIL = 0.38;

  function getPacing() {
    const cfg = V.getCfg();
    return {
      CPS: cfg.cps === undefined ? DEFAULT_CPS : cfg.cps,
      GAP: cfg.gap === undefined ? DEFAULT_GAP : cfg.gap,
      LEAD: cfg.lead === undefined ? DEFAULT_LEAD : cfg.lead,
      TAIL: cfg.tail === undefined ? DEFAULT_TAIL : cfg.tail,
    };
  }

  const CJK_CHAR_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff01-\uff60]/;
  const CJK_GLOBAL_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff01-\uff60]/g;
  const WORD_GLOBAL_RE = /[\p{L}\p{N}][\p{L}\p{N}.'\-]*/gu;

  function weight(s) {
    const str = String(s || '');
    const cjk = str.match(CJK_GLOBAL_RE) || [];
    const nonCjk = str.replace(CJK_GLOBAL_RE, ' ');
    const words = nonCjk.match(WORD_GLOBAL_RE) || [];
    let w = words.length * 1.5;
    for (const ch of cjk) {
      w += /[，。、：；！？“”‘’（）《》—…]/.test(ch) ? 0.45 : 1;
    }
    const rest = nonCjk.replace(WORD_GLOBAL_RE, '').replace(/\s/g, '');
    for (const ch of rest) {
      w += /[,!?:;"'()\-—…]/.test(ch) ? 0.45 : 0.7;
    }
    return w;
  }

  function normKey(s) {
    return String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  }

  function findNth(haystack, needle, nth = 1) {
    if (!needle) return -1;
    let idx = -1, from = 0;
    for (let i = 0; i < nth; i++) {
      idx = haystack.indexOf(needle, from);
      if (idx < 0) return -1;
      from = idx + Math.max(1, needle.length);
    }
    return idx;
  }

  function recordAnchorError(entry) {
    if (!Array.isArray(V.__anchorErrors)) return;
    const key = `${entry.scene}|${entry.lineIdx}|${entry.keyword}|${entry.reason}`;
    if (!V.__anchorErrorKeys) V.__anchorErrorKeys = new Set();
    if (V.__anchorErrorKeys.has(key)) return;
    V.__anchorErrorKeys.add(key);
    V.__anchorErrors.push(entry);
  }

  function parseAnchorOpts(optsOrOffset) {
    if (typeof optsOrOffset === 'number') return { nth: 1, offset: optsOrOffset };
    if (!optsOrOffset) return { nth: 1, offset: 0 };
    return { nth: optsOrOffset.nth || 1, offset: optsOrOffset.offset || 0 };
  }

  function matchWordBoundary(words, needle, nth) {
    let acc = '';
    const spans = words.map(([t0, w]) => {
      const s = acc.length;
      acc += normKey(w);
      return { t0, s, e: acc.length };
    });
    const pos = findNth(acc, needle, nth);
    if (pos < 0) return null;
    const hit = spans.find(sp => sp.e > pos) || spans[0];
    return hit ? hit.t0 : null;
  }

  function estimateCharAnchor(rawText, needle, nth, dur) {
    let charAcc = '', rawPos = 0;
    const charMap = [];
    for (const ch of rawText) {
      const k = normKey(ch);
      for (let j = 0; j < k.length; j++) charMap.push(rawPos);
      charAcc += k;
      rawPos += ch.length;
    }
    const pos = findNth(charAcc, needle, nth);
    if (pos < 0) return null;
    const rawIdx = charMap[pos] || 0;
    const ratio = weight(rawText.slice(0, rawIdx)) / Math.max(1, weight(rawText));
    return ratio * dur;
  }

  function resolveLocalizedKeyword(sc, lineIdx, keyword) {
    const ln = sc.lines && sc.lines[lineIdx];
    const map = ln && ln.anchors;
    return (map && map[keyword]) || keyword;
  }

  function lookupLineWords(si, lineIdx) {
    const vv = V.getActiveVoice ? V.getActiveVoice() : V.voice;
    const w = vv && vv.words;
    return (w && w[si] && w[si][lineIdx]) || null;
  }

  function warnBrokenAnchor(si, sc, lineIdx, keyword, text) {
    const msg = `Broken anchor keyword "${keyword}" not found in line: "${text}"`;
    recordAnchorError({ scene: si, title: sc.title, lineIdx, keyword: String(keyword), reason: msg });
    if (typeof console !== 'undefined' && console.warn) console.warn(`[V.at] S${si}L${lineIdx}: ${msg}`);
  }

  function resolveAnchor(sc, si, lineIdx, keyword, optsOrOffset) {
    const cue = sc.cues[lineIdx];
    if (!cue) {
      recordAnchorError({ scene: si, title: sc.title, lineIdx, keyword: String(keyword || ''), reason: `Line index ${lineIdx} out of range (lines=${sc.cues.length})` });
      return 0;
    }
    const { nth, offset } = parseAnchorOpts(optsOrOffset);
    const needle = normKey(resolveLocalizedKeyword(sc, lineIdx, keyword));
    if (!needle) return Math.max(0, cue.start + offset);

    const words = lookupLineWords(si, lineIdx);
    const wb = words && words.length ? matchWordBoundary(words, needle, nth) : null;
    if (wb != null) return Math.max(0, cue.start + wb + offset);

    const est = estimateCharAnchor(cue.text || '', needle, nth, cue.end - cue.start);
    if (est == null) {
      warnBrokenAnchor(si, sc, lineIdx, keyword, cue.text || '');
      return Math.max(0, cue.start + offset);
    }
    return Math.max(0, cue.start + est + offset);
  }

  function makeCtx(sc, si) {
    return {
      cue: i => (sc.cues[i] ? sc.cues[i].start : 0),
      end: i => (sc.cues[i] ? sc.cues[i].end : sc.duration),
      at: (i, kw, opts) => resolveAnchor(sc, si, i, kw, opts),
      t: (key, fb, vars) => (V.t ? V.t(key, fb, vars, si) : (fb === undefined ? key : fb)),
      sfx: (type, vol) => (V.sfx ? V.sfx(type, vol) : false),
      dur: sc.duration,
      clock: 0,
      alive: 0,
      idle: 0,
      playing: false,
      ended: false,
      pointer: V.pointer,
      holdStart: () => (sc.cues.length ? sc.cues[sc.cues.length - 1].end + 0.3 : 0.3),
    };
  }

  function cleanChunkTail(c) {
    return c.replace(/(?:[。！？；，、：!?;,:\s]|(?<!\.)\.(?!\.))+$/g, '');
  }

  function measureSubUnits(s) {
    let u = 0;
    for (const ch of s) u += CJK_CHAR_RE.test(ch) ? 1 : 0.72;
    return u;
  }

  function needsSpaceBetween(a, b) {
    if (!a || !b || /\s$/.test(a) || /^\s/.test(b)) return false;
    return !CJK_CHAR_RE.test(a[a.length - 1]) && !CJK_CHAR_RE.test(b[0]);
  }

  function joinSubFrag(a, b) {
    if (!a) return b;
    return needsSpaceBetween(a, b) ? `${a} ${b}` : a + b;
  }

  function splitLongSubClause(sub) {
    if (measureSubUnits(sub) <= 28 || !/\s/.test(sub)) return [sub];
    const out = [];
    let buf = '';
    for (const word of sub.split(/\s+/).filter(Boolean)) {
      const cand = joinSubFrag(buf, word);
      if (buf && measureSubUnits(cand) > 28) { out.push(buf); buf = word; }
      else buf = cand;
    }
    if (buf) out.push(buf);
    return out;
  }

  function packSubClauses(subs, chunks) {
    let buf = '';
    for (const rawSub of subs) {
      for (const piece of splitLongSubClause(rawSub.trim())) {
        if (!piece) continue;
        const cand = joinSubFrag(buf, piece);
        if (buf && measureSubUnits(cand) > 28) { chunks.push(buf); buf = piece; }
        else buf = cand;
      }
    }
    if (buf) chunks.push(buf);
  }

  function chunkSentences(raw) {
    const parts = raw.split(/(?<=[。！？；!?]|;|(?<!\.)\.(?![\p{L}\p{N}.]))\s*/u);
    const chunks = [];
    for (const s of parts) {
      const clean = s.trim();
      if (!clean) continue;
      if (measureSubUnits(clean) <= 28) { chunks.push(clean); continue; }
      packSubClauses(clean.split(/(?<=[，、：,:])\s*/), chunks);
    }
    return chunks.map(cleanChunkTail).filter(Boolean);
  }

  function mapWordsToChunks(chunks, words, cueStart, cueEnd) {
    let flat = '';
    const charTime = [];
    for (const [t0, w] of words) {
      const k = normKey(w);
      for (let i = 0; i < k.length; i++) charTime.push(t0);
      flat += k;
    }
    let searchFrom = 0;
    const starts = chunks.map((c, idx) => {
      if (idx === 0) return 0;
      const key = normKey(c);
      const pos = key ? flat.indexOf(key, searchFrom) : -1;
      if (pos >= 0) { searchFrom = pos + key.length; return charTime[pos]; }
      return null;
    });
    return chunks.map((text, i) => {
      const s = starts[i] != null ? cueStart + starts[i] : (i === 0 ? cueStart : cueStart + (cueEnd - cueStart) * (i / chunks.length));
      const e = (i + 1 < chunks.length && starts[i + 1] != null) ? cueStart + starts[i + 1] : cueEnd;
      return { start: s, end: Math.max(s + 0.25, e), text };
    });
  }

  function splitSubCues(text, cueStart, cueEnd, words) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const chunks = chunkSentences(raw);
    if (chunks.length <= 1) {
      return [{ start: cueStart, end: cueEnd, text: chunks[0] || raw }];
    }
    if (words && words.length) return mapWordsToChunks(chunks, words, cueStart, cueEnd);
    const total = chunks.reduce((a, c) => a + weight(c), 0) || 1;
    const span = cueEnd - cueStart;
    let cur = cueStart;
    return chunks.map((c, idx) => {
      const d = idx === chunks.length - 1 ? cueEnd - cur : span * (weight(c) / total);
      const item = { start: cur, end: cur + d, text: c };
      cur += d;
      return item;
    });
  }

  function getSceneLocaleOverride(sc, si) {
    const lang = V.getActiveLang();
    const scenes = lang && V.locales[lang] && V.locales[lang].scenes;
    if (!scenes) return null;
    return (sc.id && scenes[sc.id]) || scenes[si] || null;
  }

  function applyLocaleLine(lineObj, scLoc, li) {
    if (!scLoc) return lineObj;
    const rawOv = Array.isArray(scLoc) ? scLoc[li] : (scLoc.lines && scLoc.lines[li]);
    if (!rawOv && !scLoc.anchors) return lineObj;
    const patch = typeof rawOv === 'string' ? { text: rawOv } : (rawOv || {});
    const mergedAnchors = Object.assign({}, lineObj.anchors || {}, scLoc.anchors || {}, patch.anchors || {});
    return Object.assign({}, lineObj, patch, { anchors: mergedAnchors });
  }

  function buildCueEntry(lineObj, cueStart, cueEnd) {
    return {
      start: cueStart,
      end: cueEnd,
      text: lineObj.text,
      speaker: lineObj.speaker || null,
      voice: lineObj.voice,
      speed: lineObj.speed,
      pitch: lineObj.pitch,
      model: lineObj.model,
      provider: lineObj.provider,
      style: lineObj.style,
      instructions: lineObj.instructions,
      enSlowdown: lineObj.enSlowdown,
      align: lineObj.align,
      whisperModel: lineObj.whisperModel,
      volume: lineObj.volume,
      xmlLang: lineObj.xmlLang,
    };
  }

  function resolveSceneDuration(sc, bSc, lt, TAIL) {
    if (bSc) return bSc.duration;
    if (sc.lines.length === 0 && sc._explicitDuration != null) return sc._explicitDuration;
    const hold = sc.lines.length === 0 ? (sc.hold === undefined ? 3.0 : sc.hold) : (sc.hold || 0);
    return lt + hold + TAIL;
  }

  function isLangBakedMatch(baked) {
    const activeLang = typeof V.getActiveLang === 'function' ? V.getActiveLang() : '';
    if (baked.lang) {
      return activeLang ? baked.lang === activeLang : !(V.isSecondaryLocale && V.isSecondaryLocale(baked.lang));
    }
    return !(V.isSecondaryLocale && V.isSecondaryLocale(activeLang));
  }

  function isBakedValid(baked) {
    if (!baked || V.__ignoreBakedLayout || !isLangBakedMatch(baked)) return false;
    if (!Array.isArray(baked.scenes) || baked.scenes.length !== V.scenes.length) return false;
    return V.scenes.every((sc, idx) => {
      const bs = baked.scenes[idx];
      return bs && Array.isArray(bs.cues) && bs.cues.length === (sc.lines ? sc.lines.length : 0);
    });
  }

  function resolveCueTiming(bSc, voiceDurs, si, li, lineObj, lt, CPS) {
    const bCue = bSc ? bSc.cues[li] : null;
    if (bCue) return [bCue[0], bCue[1]];
    const vDur = voiceDurs[si] && voiceDurs[si][li];
    const d = vDur || lineObj.dur || Math.max(1.2, weight(lineObj.text) / CPS);
    return [lt, lt + d];
  }

  function isExactSubsTextMatch(exactSubs, lineText) {
    const subJoined = exactSubs.map(x => (Array.isArray(x) ? x[2] : '') || '').join('');
    return normKey(subJoined) === normKey(lineText);
  }

  function shouldUseExactSubs(exactSubs, lineObj, lineWords) {
    if (!exactSubs || !exactSubs.length) return false;
    if (!V.__ignoreBakedLayout) return true;
    if (lineWords && lineWords.length) return false;
    return isExactSubsTextMatch(exactSubs, lineObj.text);
  }

  function appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords) {
    const speaker = lineObj.speaker || null;
    if (shouldUseExactSubs(exactSubs, lineObj, lineWords)) {
      sc.subCues.push(...exactSubs.map(([s0, s1, txt]) => ({ start: cueStart + s0, end: cueStart + s1, text: txt, speaker })));
    } else {
      sc.subCues.push(...splitSubCues(lineObj.text, cueStart, cueEnd, lineWords).map(s => ({ ...s, speaker })));
    }
  }

  const SPEAKER_INHERIT_KEYS = ['voice', 'speed', 'pitch', 'style', 'instructions', 'model', 'provider', 'volume', 'xmlLang'];

  function resolveSpeakerLabel(sp, key) {
    if (sp.label === false || sp.label === '') return null;
    return sp.label || sp.name || key;
  }

  function applySpeakerPreset(lineObj, speakers) {
    const key = lineObj.speakerId || lineObj.speaker;
    const raw = key && speakers ? speakers[key] : null;
    if (!raw) return lineObj;
    const sp = typeof raw === 'string' ? { voice: raw } : raw;
    const out = Object.assign({}, lineObj, { speakerId: key, speaker: resolveSpeakerLabel(sp, key) });
    for (const k of SPEAKER_INHERIT_KEYS) {
      if (out[k] === undefined && sp[k] !== undefined) out[k] = sp[k];
    }
    return out;
  }

  function buildLocalizedLines(sc, scLoc) {
    const cfg = V.getCfg();
    const speakers = cfg.tts && cfg.tts.speakers;
    const locArr = Array.isArray(scLoc) ? scLoc : (scLoc && Array.isArray(scLoc.lines) ? scLoc.lines : null);
    const count = locArr ? locArr.length : sc._origLines.length;
    const out = [];
    for (let li = 0; li < count; li++) {
      const orig = sc._origLines[li];
      const baseObj = orig ? (typeof orig === 'string' ? { text: orig } : orig) : { text: '' };
      out.push(applySpeakerPreset(applyLocaleLine(baseObj, scLoc, li), speakers));
    }
    sc.lines = out;
  }

  function syncSceneLocaleMeta(sc, si) {
    if (sc._explicitDuration === undefined && typeof sc.duration === 'number' && (!sc.lines || !sc.lines.length)) {
      sc._explicitDuration = sc.duration;
    }
    if (sc._origTitle === undefined) sc._origTitle = sc.title;
    sc.lines = sc.lines || [];
    if (!sc._origLines) sc._origLines = sc.lines.slice();
    const scLoc = getSceneLocaleOverride(sc, si);
    sc.title = (scLoc && scLoc.title) || sc._origTitle;
    sc._resolvedCheckpoints = null;
    sc._resolvedSfx = null;
    buildLocalizedLines(sc, scLoc);
  }

  function layoutScene(sc, si, t, bSc, voiceInfo, pacing) {
    sc.start = bSc ? bSc.start : t;
    let lt = sc.lead === undefined ? pacing.LEAD : sc.lead;
    sc.cues = [];
    sc.subCues = [];

    sc.lines.forEach((lineObj, li) => {
      const [cueStart, cueEnd] = resolveCueTiming(bSc, voiceInfo.durs, si, li, lineObj, lt, pacing.CPS);
      sc.cues.push(buildCueEntry(lineObj, cueStart, cueEnd));
      const exactSubs = voiceInfo.subs[si] && voiceInfo.subs[si][li];
      const lineWords = voiceInfo.words[si] && voiceInfo.words[si][li];
      appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords);
      lt = cueEnd + pacing.GAP + (lineObj.pause || 0);
    });

    sc.duration = resolveSceneDuration(sc, bSc, lt, pacing.TAIL);
    return sc.start + sc.duration;
  }

  function resolveGlKeyframeT0(k, scStart, at) {
    if (k.t0 === 'self') return at;
    if (typeof k.t0 === 'number') return scStart + k.t0;
    if (k.t0 === undefined && k.shape === 'burst') return at;
    return k.t0;
  }

  function collectGlKeyframes() {
    V.glKeys = [];
    V.scenes.forEach((sc, si) => {
      if (!sc.gl) return;
      for (const k of sc.gl(makeCtx(sc, si))) {
        const at = sc.start + k.t;
        V.glKeys.push({ ...k, t: at, t0: resolveGlKeyframeT0(k, sc.start, at) });
      }
    });
    V.glKeys.sort((a, b) => a.t - b.t);
  }

  function normalizeLineSegs(lineSegs) {
    if (!Array.isArray(lineSegs)) return [];
    let prev = 0;
    return lineSegs.map(item => {
      if (!Array.isArray(item) || item.length >= 3) return item;
      const end = Number(item[0]) || prev;
      const triple = [Math.round(prev * 1000) / 1000, end, item[1]];
      prev = end;
      return triple;
    });
  }

  function resolveVoiceSubCues(vv) {
    if (Array.isArray(vv.subCues) && vv.subCues.length) return vv.subCues;
    if (!Array.isArray(vv.segs)) return [];
    return vv.segs.map(scSegs => (Array.isArray(scSegs) ? scSegs.map(normalizeLineSegs) : []));
  }

  V.layout = function () {
    const pacing = getPacing();
    const vv = (V.getActiveVoice ? V.getActiveVoice() : V.voice) || {};
    const voiceInfo = { durs: vv.durations || [], subs: resolveVoiceSubCues(vv), words: vv.words || [] };
    V.scenes.forEach((sc, si) => syncSceneLocaleMeta(sc, si));
    const baked = vv.bakedLayout;
    const useBaked = isBakedValid(baked);

    let t = 0;
    V.scenes.forEach((sc, si) => {
      t = layoutScene(sc, si, t, useBaked ? baked.scenes[si] : null, voiceInfo, pacing);
    });

    V.duration = useBaked && typeof baked.duration === 'number' ? baked.duration : Math.max(0.1, t);
    V.totalDuration = V.duration;
    collectGlKeyframes();
    V.emit('onLayout', { duration: V.duration, scenes: V.scenes });
  };

  // 采样 30Hz 真实语音振幅包络（0..1），驱动数字人真口型与声波可视化
  function sampleEnvelopeArray(arr, relSec) {
    const pos = clamp(relSec * 30, 0, arr.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(arr.length - 1, i0 + 1);
    const frac = pos - i0;
    return ((arr[i0] * (1 - frac) + arr[i1] * frac) / 100);
  }

  V.getSceneEnergy = function (sc, si, lt) {
    if (!sc || !sc.cues) return 0;
    const li = sc.cues.findIndex(c => lt >= c.start && lt <= c.end);
    if (li < 0) return 0;
    const cue = sc.cues[li];
    const vv = V.getActiveVoice ? V.getActiveVoice() : V.voice;
    const env = vv && vv.envelopes && vv.envelopes[si] && vv.envelopes[si][li];
    if (Array.isArray(env) && env.length) return clamp(sampleEnvelopeArray(env, lt - cue.start));
    // 草稿期尚无音频时回退为自然语音节律波
    const g = sc.start + lt;
    return clamp(0.35 + 0.55 * Math.abs(Math.sin(g * 12.5)) * Math.abs(Math.cos(g * 3.1)));
  };

  V.makeCtx = makeCtx;
})(globalThis.V = globalThis.V || {});
