/* core/12-prefs-resume.js · 观看偏好（倍速/字幕/声音/配乐）与断点续播极简 localStorage 记忆 */
(function (V) {
  if (typeof location === 'undefined') return;

  let lastFlushTs = 0;
  let boundPageHide = false;

  function getStorageKey() {
    const normPath = (location.pathname || '/').replace(/\/index\.html$/i, '/').replace(/\/+$/, '') || '/';
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    return 'hv:v1:' + normPath + (lang ? ':' + lang : '');
  }

  function canPersist(uiCfg) {
    return !V._isRecord && Boolean(uiCfg && uiCfg.persist !== false);
  }

  function readSaved(uiCfg) {
    if (!canPersist(uiCfg)) return null;
    try {
      const raw = localStorage.getItem(getStorageKey());
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSaved(uiCfg, patch) {
    if (!canPersist(uiCfg)) return;
    try {
      const cur = readSaved(uiCfg) || {};
      localStorage.setItem(getStorageKey(), JSON.stringify(Object.assign(cur, patch)));
    } catch {}
  }

  function clearSavedState() {
    try { localStorage.removeItem(getStorageKey()); } catch {}
  }

  function resolveSavedResumeTime(params, uiCfg, duration) {
    if (!canPersist(uiCfg) || params.has('from0')) return 0;
    const saved = readSaved(uiCfg);
    const t = saved && Number(saved.t);
    if (!Number.isFinite(t)) return 0;
    const minSec = uiCfg.resumeMinSec;
    const maxSec = Math.max(0, duration - 2);
    return t >= minSec && t < maxSec ? t : 0;
  }

  function flushProgress(curNow, isEnded) {
    const uiCfg = V._getUiCfg ? V._getUiCfg(V.getCfg()) : null;
    if (!canPersist(uiCfg) || !V.duration) return;
    if (isEnded || curNow >= V.duration - 2) {
      writeSaved(uiCfg, { t: 0 });
    } else if (curNow >= uiCfg.resumeMinSec) {
      writeSaved(uiCfg, { t: Math.round(curNow * 10) / 10 });
    }
  }

  V.clearSavedState = clearSavedState;
  V._prefsRuntime = { readSaved, writeSaved, clearSavedState, resolveSavedResumeTime, flushProgress };

  V.use({
    id: 'builtin-prefs-resume',
    onStart(ctl) {
      if (ctl.isRecord || boundPageHide) return;
      boundPageHide = true;
      addEventListener('pagehide', () => flushProgress(V._now || 0, false));
    },
    onRateChange(rate) {
      writeSaved(V._getUiCfg(V.getCfg()), { rate });
    },
    onSoundChange(st) {
      writeSaved(V._getUiCfg(V.getCfg()), { muted: st.rawMuted, voice: st.rawVoiceOn, bgm: st.rawBgmOn });
    },
    onSubsChange(subs) {
      writeSaved(V._getUiCfg(V.getCfg()), { subs });
    },
    onEnded() {
      writeSaved(V._getUiCfg(V.getCfg()), { t: 0 });
    },
    onRender(st) {
      if (st.isRecord || st.sandbox) return;
      const ts = performance.now();
      if (ts - lastFlushTs < 2500) return;
      lastFlushTs = ts;
      flushProgress(st.now, st.ended);
    },
  });
})(globalThis.V = globalThis.V || {});
