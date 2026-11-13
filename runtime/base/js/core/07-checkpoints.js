/* core/07-checkpoints.js · 网页交互检查点（Interactive Checkpoints）：网页端驻留交互，录制态自动放行 */
(function (V) {
  const { h } = V.u;
  let activeCp = null;
  let triggeredKeys = new Map();

  const recordManagedIds = new Set();

  function resolveSceneCheckpoints(sc, si) {
    if (!sc._resolvedCheckpoints) {
      const ctx = sc.ctx || (V.makeCtx ? V.makeCtx(sc, si) : null);
      const raw = typeof sc.checkpoints === 'function' ? sc.checkpoints(ctx) : sc.checkpoints;
      sc._resolvedCheckpoints = Array.isArray(raw) ? raw : [];
    }
    return sc._resolvedCheckpoints;
  }

  function renderCheckpointCard(overlay, cp, resumeFn) {
    overlay.innerHTML = '';
    if (typeof cp.render === 'function') {
      cp.render(overlay, val => resumeFn(cp, val));
      return;
    }
    const rawChoices = Array.isArray(cp.choices) && cp.choices.length
      ? cp.choices
      : (Array.isArray(cp.actions) && cp.actions.length ? cp.actions : null);
    const choices = rawChoices || [{ label: cp.buttonLabel || '继续播放', value: true, primary: true }];
    const btns = choices.map((ch, idx) => {
      const b = h('button', { class: 'cp-btn' + (ch.primary || idx === 0 ? ' is-primary' : '') }, ch.label);
      b.onclick = e => {
        e.stopPropagation();
        if (typeof ch.onSelect === 'function') ch.onSelect(V);
        const resVal = ch.value !== undefined ? ch.value : (ch.resume !== undefined ? ch.resume : ch.label);
        resumeFn(cp, resVal);
      };
      return b;
    });
    const card = h('div', { class: 'cp-card', 'data-interactive': '1' },
      cp.title ? h('h4', null, cp.title) : null,
      cp.prompt ? h('p', null, cp.prompt) : null,
      h('div', { class: 'cp-actions' }, ...btns));
    overlay.appendChild(card);
  }

  function closeCheckpointOverlay() {
    const overlay = typeof document !== 'undefined' ? document.getElementById('checkpoint-overlay') : null;
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.innerHTML = '';
    }
    activeCp = null;
  }

  function triggerCheckpoint(cp, pauseFn, playFn) {
    activeCp = cp;
    pauseFn();
    const overlay = document.getElementById('checkpoint-overlay');
    if (!overlay) return;
    overlay.classList.add('is-open');
    renderCheckpointCard(overlay, cp, (item, val) => {
      if (item.id) V.checkpointState[item.id] = val;
      closeCheckpointOverlay();
      if (typeof item.onResume === 'function') item.onResume(val, V);
      playFn();
    });
  }

  function collectAllRecordCheckpoints() {
    const all = [];
    const scenes = V.scenes || [];
    for (let si = 0; si < scenes.length; si++) {
      const sc = scenes[si];
      for (const cp of resolveSceneCheckpoints(sc, si)) {
        if (cp && cp.at != null && cp.id) {
          all.push({ gAt: (sc.start || 0) + Number(cp.at), id: cp.id, val: cp.defaultValue === undefined ? true : cp.defaultValue });
        }
      }
    }
    return all.sort((a, b) => a.gAt - b.gAt);
  }

  function syncRecordCheckpoints(curT) {
    for (const id of recordManagedIds) delete V.checkpointState[id];
    recordManagedIds.clear();
    for (const item of collectAllRecordCheckpoints()) {
      if (curT >= item.gAt) {
        V.checkpointState[item.id] = item.val;
        recordManagedIds.add(item.id);
      }
    }
  }

  function canCheckInteractive(ctl, prevT, curT) {
    if (!ctl.playing || ctl.scrubbing) return false;
    return curT > prevT && curT - prevT <= 0.3;
  }

  function didCrossTime(prevT, curT, gAt) {
    return gAt <= 0 ? prevT <= 0 && curT > 0 : prevT < gAt && curT >= gAt;
  }

  function checkSceneCheckpoints(sc, si, prevT, curT, ctl) {
    if (ctl.isRecord) { syncRecordCheckpoints(curT); return; }
    const list = resolveSceneCheckpoints(sc, si);
    if (!list.length || !canCheckInteractive(ctl, prevT, curT)) return;
    for (let i = 0; i < list.length; i++) {
      const cp = list[i];
      if (!cp || cp.at == null) continue;
      const gAt = sc.start + Number(cp.at);
      const key = `${si}:${cp.id || i}`;
      if (!triggeredKeys.has(key) && didCrossTime(prevT, curT, gAt)) {
        triggeredKeys.set(key, gAt);
        triggerCheckpoint(cp, ctl.pause, ctl.play);
        return;
      }
    }
  }

  V.resume = function (val) {
    if (!activeCp) {
      if (V._playerCtl) V._playerCtl.play();
      return;
    }
    if (activeCp.id) V.checkpointState[activeCp.id] = val;
    const item = activeCp;
    closeCheckpointOverlay();
    if (typeof item.onResume === 'function') item.onResume(val, V);
    if (V._playerCtl) V._playerCtl.play();
  };

  function onSeek(targetT) {
    closeCheckpointOverlay();
    for (const [key, gAt] of triggeredKeys.entries()) {
      if (gAt >= targetT - 0.01) triggeredKeys.delete(key);
    }
  }

  V.resetCheckpoints = function () {
    triggeredKeys = new Map();
    closeCheckpointOverlay();
  };

  V._checkpointsRuntime = { checkSceneCheckpoints, syncRecordCheckpoints, closeCheckpointOverlay, onSeek };
})(globalThis.V = globalThis.V || {});
