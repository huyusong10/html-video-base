/* core/07-checkpoints.js · 网页交互检查点（Interactive Checkpoints）：网页端驻留交互，录制态自动放行 */
(function (V) {
  const { h } = V.u;
  let activeCp = null;
  let triggeredKeys = new Map();

  function resolveSceneCheckpoints(sc) {
    if (!sc._resolvedCheckpoints) {
      const raw = typeof sc.checkpoints === 'function' ? sc.checkpoints(sc.ctx) : sc.checkpoints;
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

  function applyRecordCheckpoints(list, scStart, curT) {
    for (const cp of list) {
      if (!cp || cp.at == null || !cp.id) continue;
      if (curT >= scStart + Number(cp.at) && V.checkpointState[cp.id] === undefined) {
        V.checkpointState[cp.id] = cp.defaultValue === undefined ? true : cp.defaultValue;
      }
    }
  }

  function canCheckInteractive(ctl, prevT, curT) {
    if (!ctl.playing || ctl.scrubbing) return false;
    return curT > prevT && curT - prevT <= 0.3;
  }

  function checkSceneCheckpoints(sc, si, prevT, curT, ctl) {
    const list = resolveSceneCheckpoints(sc);
    if (!list.length) return;
    if (ctl.isRecord) { applyRecordCheckpoints(list, sc.start, curT); return; }
    if (!canCheckInteractive(ctl, prevT, curT)) return;
    for (let i = 0; i < list.length; i++) {
      const cp = list[i];
      if (!cp || cp.at == null) continue;
      const gAt = sc.start + Number(cp.at);
      const key = `${si}:${cp.id || i}`;
      if (!triggeredKeys.has(key) && prevT < gAt && curT >= gAt) {
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

  V._checkpointsRuntime = { checkSceneCheckpoints, closeCheckpointOverlay, onSeek };
})(globalThis.V = globalThis.V || {});
