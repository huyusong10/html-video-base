/* core/08-plugins.js · 内置可插拔扩展（通过标准 V.use 注册：草稿 WebAudio 微音效 + ?dev 面板 + SSE 保位热重载） */
(function (V) {
  const { clamp, h, toggle } = V.u;

  // 1. 草稿态动作微音效预览插件（已有正式音轨或录制态自动静默）
  let draftActx = null;

  function synthTone(ctx, type, g) {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const presets = {
      ping: ['sine', 880, 1320, 0.09, 0.24],
      chime: ['sine', 880, 1320, 0.09, 0.24],
      alert: ['triangle', 520, 420, 0.09, 0.22],
      key: ['triangle', 420, 160, 0.045, 0.05],
      click: ['triangle', 680, 160, 0.045, 0.05],
    };
    const [wave, f0, f1, rampT, endT] = presets[type] || presets.click;
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + rampT);
    gain.gain.setValueAtTime(g, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + endT);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + endT + 0.01);
  }

  function playDraftSfx(type, vol = 0.5) {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      if (!draftActx) draftActx = new Ctx();
      if (draftActx.state === 'suspended') draftActx.resume();
      synthTone(draftActx, type, clamp(vol, 0.05, 1) * 0.12);
    } catch {}
  }

  function canPlayDraftSfx(st) {
    if (!st.playing || st.scrubbing || st.hasAudio || st.isRecord || st.muted) return false;
    return st.now > st.prevT && st.now - st.prevT <= 0.25;
  }

  function resolveSceneSfxList(sc) {
    if (!sc._resolvedSfx) {
      const raw = typeof sc.sfx === 'function' ? sc.sfx(sc.ctx) : sc.sfx;
      sc._resolvedSfx = Array.isArray(raw) ? raw : [];
    }
    return sc._resolvedSfx;
  }

  V.use({
    id: 'builtin-draft-sfx',
    onRender(st) {
      if (!canPlayDraftSfx(st)) return;
      const sc = st.scene;
      for (const ev of resolveSceneSfxList(sc)) {
        if (!ev || ev.at == null) continue;
        const gAt = sc.start + Number(ev.at);
        if (st.prevT < gAt && st.now >= gAt) {
          playDraftSfx(ev.type || ev.preset || 'click', ev.volume === undefined ? 0.5 : ev.volume);
        }
      }
    },
  });

  // 2. ?dev=1 创作者调试条与零依赖 SSE 保位热重载插件
  let devStatEl = null;
  let devRateBtns = null;

  function hotReloadStylesheets() {
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    const stamp = Date.now();
    links.forEach(lnk => {
      const u = new URL(lnk.href, location.href);
      u.searchParams.set('_hmr', String(stamp));
      lnk.href = u.toString();
    });
  }

  function connectLiveReload() {
    if (typeof EventSource === 'undefined' || V._isRecord) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    try {
      const es = new EventSource('/__hmr');
      es.onmessage = ev => {
        const msg = JSON.parse(ev.data || '{}');
        if (msg.type === 'css') { hotReloadStylesheets(); return; }
        if (msg.type === 'reload') {
          try { sessionStorage.setItem('__video_hmr_t', String(V._now || 0)); } catch {}
          location.reload();
        }
      };
      es.onerror = () => es.close();
    } catch {}
  }

  function mountDevPanel(ctl) {
    devStatEl = h('span', { class: 'dev-stat' }, 't=0.00s');
    devRateBtns = [0.5, 1, 1.5, 2].map(r => {
      const b = h('button', { class: Math.abs(r - ctl.getRate()) < 0.01 ? 'on' : '' }, `${r}x`);
      b.onclick = () => ctl.setRate(r);
      return [r, b];
    });
    const loopBtn = h('button', null, '单幕循环');
    loopBtn.onclick = () => toggle(loopBtn, 'on', ctl.toggleLoopScene());
    const safeEl = document.getElementById('safe-guide');
    const safeBtn = h('button', { class: 'on' }, '安全区');
    if (safeEl) safeEl.classList.add('on');
    safeBtn.onclick = () => toggle(safeBtn, 'on', safeEl ? safeEl.classList.toggle('on') : false);
    document.body.appendChild(h('div', { id: 'dev-hud', 'data-interactive': '1' }, devStatEl, ...devRateBtns.map(x => x[1]), loopBtn, safeBtn));
  }

  V.use({
    id: 'builtin-dev-hmr',
    onStart(ctl) {
      connectLiveReload();
      if (ctl.isDev) mountDevPanel(ctl);
    },
    onRateChange(rate) {
      if (devRateBtns) devRateBtns.forEach(([r, b]) => toggle(b, 'on', Math.abs(r - rate) < 0.01));
    },
    onRender(st) {
      if (!devStatEl) return;
      const cueTag = st.activeCueIdx >= 0 ? `L${st.activeCueIdx}` : '--';
      devStatEl.textContent = `t=${st.now.toFixed(2)}s | S${st.sceneIndex + 1} lt=${st.lt.toFixed(2)}s (${cueTag})`;
    },
  });
})(globalThis.V = globalThis.V || {});
