/* core/10-subtitles.js · 字幕槽位挂载、多姿态布局避让与 30Hz 语音钩子 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, prog, appear, h } = V.u;

  const SUB_VAR_MAP = [
    ['left', '--sub-left'], ['right', '--sub-right'], ['top', '--sub-top'], ['bottom', '--sub-bottom'],
    ['offsetX', '--sub-offset-x'], ['offsetY', '--sub-offset-y'], ['align', '--sub-align'],
    ['maxWidth', '--sub-max-w'], ['padding', '--sub-padding'], ['gap', '--sub-gap'], ['zIndex', '--sub-z'],
  ];

  let subs = null, subLead = null, subTail = null, subSpeaker = null, subText = null;
  let globalOverrideSpec = null;
  let buildSubSpec = null;
  let updateSubTick = 0;
  let sceneScopedSpec = false;
  let appliedSubSpec = null;
  let subSize = 'medium', subAlign = 'left';

  function getSubCfg() {
    const cfg = V.getCfg();
    return Object.assign({}, cfg.subtitles || {}, V.subtitles || {});
  }

  function resolveDefaultSubSpec() {
    if (globalOverrideSpec != null) return globalOverrideSpec;
    const subCfg = getSubCfg();
    return subCfg.layout || subCfg.position || null;
  }

  function resolveSubLayoutObj(spec, subCfg) {
    const eff = spec || (subCfg && (subCfg.layout || subCfg.position));
    if (!eff) return { pos: V.pptMode ? 'center' : subAlign };
    if (typeof eff === 'string') {
      const m = subCfg && subCfg.modes && subCfg.modes[eff];
      return m ? Object.assign({ pos: 'center' }, m) : { pos: eff };
    }
    return Object.assign({ pos: eff.pos || 'center' }, eff);
  }

  function applySubLayout(spec) {
    appliedSubSpec = spec;
    if (!subs) return;
    const obj = resolveSubLayoutObj(spec, getSubCfg());
    const position = obj.pos || 'center';
    if (subs.dataset.subPos !== position) subs.dataset.subPos = position;
    for (const [prop, cssVar] of SUB_VAR_MAP) {
      const val = obj[prop];
      if (val == null || val === '') {
        if (subs.style.getPropertyValue(cssVar)) subs.style.removeProperty(cssVar);
      } else {
        const value = typeof val === 'number' && prop !== 'zIndex' ? `${val}px` : String(val);
        if (subs.style.getPropertyValue(cssVar) !== value) subs.style.setProperty(cssVar, value);
      }
    }
  }
  function getAppearance() { return { size: subSize, align: subAlign }; }

  function setAppearance({ size, align } = {}) {
    if (['small', 'medium', 'large'].includes(size)) subSize = size;
    if (['left', 'center'].includes(align)) subAlign = align;
    if (!subs || V.pptMode) return;
    subs.dataset.subSize = subSize;
    subs.dataset.subAlign = subAlign;
    applySubLayout(appliedSubSpec);
  }

  V.setSubLayout = function (spec) {
    if (V._inSceneBuild) {
      buildSubSpec = spec;
      sceneScopedSpec = true;
    } else if (V._inSceneUpdate) {
      updateSubTick = V._renderTick || 1;
      sceneScopedSpec = true;
    } else {
      globalOverrideSpec = spec;
    }
    return applySubLayout(spec);
  };

  function resetSceneSubLayout() {
    buildSubSpec = null;
    updateSubTick = 0;
    if (!sceneScopedSpec) return;
    sceneScopedSpec = false;
    applySubLayout(resolveDefaultSubSpec());
  }

  function mountSubSlot(slotEl, factory) {
    if (!slotEl || !factory) return;
    slotEl.innerHTML = '';
    const res = typeof factory === 'function' ? factory(h, V) : factory;
    if (!res) return;
    if (res.nodeType) slotEl.appendChild(res);
    else slotEl.innerHTML = String(res);
  }

  function bindSubElements(subsEl) {
    subs = subsEl;
    if (!subs) return;
    subLead = subs.querySelector('.sub-lead');
    subTail = subs.querySelector('.sub-tail');
    subSpeaker = subs.querySelector('.sub-speaker');
    subText = subs.querySelector('.sub-text');
    const subCfg = getSubCfg();
    mountSubSlot(subLead, subCfg.lead);
    mountSubSlot(subTail, subCfg.tail);
    applySubLayout(resolveDefaultSubSpec());
    setAppearance();
  }

  function syncSceneSubLayout(sc, lt) {
    const spec = sc.subLayout || sc.subtitles;
    if (spec) {
      sceneScopedSpec = true;
      applySubLayout(typeof spec === 'function' ? spec(lt, sc.ctx, sc) : spec);
      return;
    }
    if (updateSubTick > 0 && updateSubTick !== (V._renderTick || 0)) {
      updateSubTick = 0;
      sceneScopedSpec = buildSubSpec != null;
      applySubLayout(buildSubSpec != null ? buildSubSpec : resolveDefaultSubSpec());
    }
  }

  function updateSubDomText(cue) {
    if (subSpeaker && subSpeaker._sp !== (cue.speaker || '')) {
      subSpeaker._sp = cue.speaker || '';
      subSpeaker.textContent = subSpeaker._sp;
      subSpeaker.classList.toggle('is-on', Boolean(subSpeaker._sp));
    }
    if (subText && subText._t !== cue.text) {
      subText.firstChild.textContent = cue.text;
      subText.lastChild.textContent = cue.text;
      subText._t = cue.text;
    }
  }

  function runSubHook(subCfg, cue, sc, idx, lt, now, clock, activeCueIdx) {
    const fn = subCfg.onUpdate || subCfg.update;
    if (typeof fn !== 'function') return;
    const lineCue = activeCueIdx >= 0 ? sc.cues[activeCueIdx] : null;
    const info = {
      frame: V.getFrameState(),
      t: now, clock, alive: clock, playing: Boolean(V._isPlaying), pointer: V.pointer,
      lt, scene: sc, sceneIndex: idx, lineCue, speaking: Boolean(cue), energy: V.getSceneEnergy(sc, idx, lt),
    };
    fn(cue, info, { subs, lead: subLead, tail: subTail, speaker: subSpeaker, text: subText });
  }

  function pickPptCue(sc) {
    const note = V._pptRuntime && V._pptRuntime.getCurrentNote ? V._pptRuntime.getCurrentNote() : '';
    const text = note || (sc.cues || []).filter(c => c && !c.pptSkip && c.text).map(c => c.text.trim()).join(' ');
    if (text) return { cue: { start: 0, end: sc.duration, text, speaker: null }, activeCueIdx: -1 };
    return { cue: null, activeCueIdx: -1 };
  }

  function prepareVideoCue(sc, lt) {
    const list = sc.subCues && sc.subCues.length ? sc.subCues : sc.cues;
    let cue = null, activeCueIdx = -1;
    sc.cues.forEach((c, i) => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) activeCueIdx = i; });
    list.forEach(c => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) cue = c; });
    // 句间留白时先按下一句排版，让角色能从字幕即将出现的位置展开。
    if (subs) updateSubDomText(cue || list.find(c => lt < c.start - 0.04) || list.at(-1) || { text: '' });
    return { cue, activeCueIdx };
  }

  function updateSubs(sc, idx, lt, now, clock, showSubs, videoCue) {
    if (!subs) return -1;
    const subCfg = getSubCfg();
    syncSceneSubLayout(sc, lt, subCfg);
    const picked = V.pptMode ? pickPptCue(sc) : (videoCue || prepareVideoCue(sc, lt));
    const { cue, activeCueIdx } = picked;
    const visible = Boolean(cue && showSubs);
    subs.style.visibility = visible ? 'visible' : 'hidden';
    if (V.pptMode && cue) updateSubDomText(cue);
    if (visible) {
      const a = V.pptMode ? 1 : Math.min(appear(lt, cue.start - 0.04, 0.14), 1 - prog(lt, cue.end, cue.end + 0.12));
      subs.style.opacity = String(clamp(a));
    } else {
      subs.style.opacity = '0';
    }
    runSubHook(subCfg, cue, sc, idx, lt, now, clock, activeCueIdx);
    return activeCueIdx;
  }

  V._subtitlesRuntime = { bindSubElements, applySubLayout, resetSceneSubLayout, prepareVideoCue, updateSubs, getAppearance, setAppearance };
})(globalThis.V = globalThis.V || {});
