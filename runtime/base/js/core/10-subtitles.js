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
  let sceneScopedSpec = false;

  function getSubCfg() {
    const cfg = V.getCfg();
    return Object.assign({}, cfg.subtitles || {}, V.subtitles || {});
  }

  function resolveSubLayoutObj(spec, subCfg) {
    const eff = spec || (subCfg && (subCfg.layout || subCfg.position));
    if (!eff) return { pos: 'center' };
    if (typeof eff === 'string') {
      const m = subCfg && subCfg.modes && subCfg.modes[eff];
      return m ? Object.assign({ pos: 'center' }, m) : { pos: eff };
    }
    return Object.assign({ pos: eff.pos || 'center' }, eff);
  }

  function applySubLayout(spec) {
    if (!subs) return;
    const obj = resolveSubLayoutObj(spec, getSubCfg());
    subs.dataset.subPos = obj.pos || 'center';
    for (const [prop, cssVar] of SUB_VAR_MAP) {
      const val = obj[prop];
      if (val == null || val === '') subs.style.removeProperty(cssVar);
      else subs.style.setProperty(cssVar, typeof val === 'number' && prop !== 'zIndex' ? `${val}px` : String(val));
    }
  }
  V.setSubLayout = function (spec) {
    if (V._inSceneUpdate) sceneScopedSpec = true;
    return applySubLayout(spec);
  };

  function resetSceneSubLayout() {
    if (!sceneScopedSpec) return;
    sceneScopedSpec = false;
    applySubLayout(getSubCfg().layout || getSubCfg().position || 'center');
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
    if (subCfg.layout || subCfg.position) applySubLayout(subCfg.layout || subCfg.position);
  }

  function syncSceneSubLayout(sc, lt) {
    const spec = sc.subLayout || sc.subtitles;
    if (!spec) return;
    sceneScopedSpec = true;
    applySubLayout(typeof spec === 'function' ? spec(lt, sc.ctx, sc) : spec);
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
    const info = { t: now, clock, lt, scene: sc, sceneIndex: idx, lineCue, speaking: Boolean(cue), energy: V.getSceneEnergy(sc, idx, lt) };
    fn(cue, info, { subs, lead: subLead, tail: subTail, speaker: subSpeaker, text: subText });
  }

  function updateSubs(sc, idx, lt, now, clock, showSubs) {
    if (!subs) return -1;
    const subCfg = getSubCfg();
    syncSceneSubLayout(sc, lt, subCfg);
    const list = sc.subCues && sc.subCues.length ? sc.subCues : sc.cues;
    let cue = null;
    let activeCueIdx = -1;
    sc.cues.forEach((c, i) => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) activeCueIdx = i; });
    list.forEach(c => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) cue = c; });
    const visible = Boolean(cue && showSubs);
    subs.style.visibility = visible ? 'visible' : 'hidden';
    if (cue) updateSubDomText(cue);
    if (visible) {
      const a = Math.min(appear(lt, cue.start - 0.04, 0.14), 1 - prog(lt, cue.end, cue.end + 0.12));
      subs.style.opacity = String(clamp(a));
    } else {
      subs.style.opacity = '0';
    }
    runSubHook(subCfg, cue, sc, idx, lt, now, clock, activeCueIdx);
    return activeCueIdx;
  }

  V._subtitlesRuntime = { bindSubElements, applySubLayout, resetSceneSubLayout, updateSubs };
})(globalThis.V = globalThis.V || {});
