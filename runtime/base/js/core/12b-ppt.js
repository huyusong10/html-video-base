/* core/12b-ppt.js - 独立 PPT 人工讲解运行时（默认 1 幕 = 1 页定格终态、画布交互零冲突、滚轮与翻页笔支持） */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, h, toggle } = V.u;

  function joinKeptCues(cues, minLt, maxLt) {
    return (cues || [])
      .filter(c => c && !c.pptSkip && c.text && c.start >= minLt && c.start <= maxLt)
      .map(c => c.text.trim())
      .join(' ');
  }

  function resolveSceneSettledStep(sc) {
    const maxLt = Math.max(0.06, sc.duration - 0.05);
    const raw = typeof sc.pptAt === 'number' ? sc.pptAt : sc.duration - 0.12;
    return [{
      lt: clamp(raw, 0.05, maxLt),
      cueStart: sc.start,
      cueEnd: sc.start + sc.duration,
      text: joinKeptCues(sc.cues, -1, sc.duration + 1),
    }];
  }

  function extractCustomFrameItem(it, maxLt) {
    const val = typeof it === 'number' ? it : (it && (it.lt !== undefined ? it.lt : it.at));
    return {
      lt: clamp(Number(val) || 0, 0.05, maxLt),
      text: it && typeof it === 'object' && it.text ? String(it.text).trim() : '',
    };
  }

  function resolveCustomFrames(sc, si) {
    const rawSpec = sc.pptFrames !== undefined ? sc.pptFrames : sc.pptSteps;
    const raw = typeof rawSpec === 'function'
      ? rawSpec(sc.ctx || (V.makeCtx ? V.makeCtx(sc, si) : null), sc, si)
      : rawSpec;
    if (!Array.isArray(raw) || !raw.length) return null;
    const maxLt = Math.max(0.06, sc.duration - 0.05);
    const items = raw.map(it => extractCustomFrameItem(it, maxLt));
    return items.map((item, idx) => {
      const prevLt = idx > 0 ? items[idx - 1].lt : -0.1;
      const isLast = idx === items.length - 1;
      const winEnd = isLast ? sc.duration + 1 : item.lt + 0.25;
      return {
        lt: item.lt,
        cueStart: sc.start + Math.max(0, prevLt),
        cueEnd: sc.start + (isLast ? sc.duration : item.lt + 0.2),
        text: item.text || joinKeptCues(sc.cues, prevLt + 0.02, winEnd),
      };
    });
  }

  function resolveScenePages(sc, si) {
    if (sc && (sc.pptFrames !== undefined || sc.pptSteps !== undefined)) {
      const custom = resolveCustomFrames(sc, si);
      if (custom) return custom;
    }
    return resolveSceneSettledStep(sc);
  }

  function buildPptPages() {
    const pages = [];
    (V.scenes || []).forEach((sc, si) => {
      if (!sc || sc.pptSkip) return;
      const steps = resolveScenePages(sc, si);
      steps.forEach((st, idx) => {
        pages.push({
          index: pages.length,
          pageNo: pages.length + 1,
          sceneIndex: si,
          stepInScene: idx,
          sceneSteps: steps.length,
          lt: st.lt,
          globalT: sc.start + st.lt,
          cueStart: st.cueStart,
          cueEnd: st.cueEnd,
          text: st.text,
        });
      });
    });
    return pages;
  }

  function canElementScrollY(el, deltaY) {
    if (!el || el.scrollHeight <= el.clientHeight + 2) return false;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') return false;
    return deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  }

  function shouldAllowNativeWheel(target, vp, deltaY) {
    if (!target) return false;
    if (target.closest && target.closest('#controls, [data-no-wheel-flip]')) return true;
    let node = target;
    while (node && node !== vp && node !== document.body) {
      if (canElementScrollY(node, deltaY)) return true;
      node = node.parentElement;
    }
    return false;
  }

  V._createPptRuntime = function (deps) {
    const {
      params, renderAt, uiText, makeCtrlIcon, swapBtnIcon, switchMode,
      renderCustomControls, setOpenMenu, toggleOsFull, fallbackWebFull, exitWebFullIfActive, bindMenuAutoClose,
    } = deps;

    let pages = [];
    let pageIdx = 0;
    let hasRendered = false;
    let barEl = null;
    let internalRender = false;
    let wheelLockTs = 0;
    const refs = { prev: null, next: null, pageNum: null, chapLabel: null, toVideo: null, chapItems: [] };

    function renderInternal(t) {
      internalRender = true;
      try { renderAt(t); } finally { internalRender = false; }
    }

    function rebuildPages() {
      pages = buildPptPages();
      pageIdx = clamp(pageIdx, 0, Math.max(0, pages.length - 1));
      return pages;
    }

    function findFirstPageIndexForScene(si) {
      const idx = pages.findIndex(p => p.sceneIndex === si);
      return idx >= 0 ? idx : Math.max(0, pages.findIndex(p => p.sceneIndex > si));
    }

    function findBestPageInScene(si, targetT) {
      const list = pages.filter(p => p.sceneIndex === si);
      if (!list.length) return -1;
      const hit = list.find(p => targetT <= p.cueEnd + 0.12);
      return hit ? hit.index : list[list.length - 1].index;
    }

    function findPageIndexForTime(targetT) {
      if (!pages.length) return 0;
      const t = Number(targetT) || 0;
      const scenes = V.scenes || [];
      for (let si = 0; si < scenes.length; si++) {
        const sc = scenes[si];
        if (t < sc.start + sc.duration) {
          const hit = findBestPageInScene(si, t);
          if (hit >= 0) return hit;
        }
      }
      let best = 0, bestDist = Infinity;
      for (const p of pages) {
        const d = Math.abs(p.globalT - t);
        if (d < bestDist) { bestDist = d; best = p.index; }
      }
      return best;
    }

    function resolveInitialPageIndex() {
      if (!pages.length) return 0;
      if (params.has('page')) {
        return clamp((parseInt(params.get('page'), 10) || 1) - 1, 0, pages.length - 1);
      }
      if (params.has('scene')) {
        const si = clamp(parseInt(params.get('scene'), 10) || 0, 0, Math.max(0, (V.scenes || []).length - 1));
        return clamp(findFirstPageIndexForScene(si), 0, pages.length - 1);
      }
      if (params.has('t')) return findPageIndexForTime(parseFloat(params.get('t')) || 0);
      return 0;
    }

    function syncUI() {
      const p = pages[pageIdx];
      if (!p) return;
      if (refs.prev) refs.prev.disabled = pageIdx <= 0;
      if (refs.next) refs.next.disabled = pageIdx >= pages.length - 1;
      if (refs.pageNum && !refs.pageNum.dataset.copied) {
        refs.pageNum.textContent = `${pageIdx + 1} / ${pages.length}`;
        refs.pageNum.setAttribute('aria-label', uiText('pptPageBadge', { cur: pageIdx + 1, total: pages.length }));
      }
      const sc = V.scenes[p.sceneIndex];
      if (refs.chapLabel && sc) refs.chapLabel.textContent = `${String(p.sceneIndex + 1).padStart(2, '0')} ${sc.title}`;
      refs.chapItems.forEach(({ item, sceneIndex }) => toggle(item, 'on', sceneIndex === p.sceneIndex));
      V.controls.forEach(c => { if (typeof c.sync === 'function') c.sync(c._el, V); });
    }

    function goToPage(targetIdx, opts = {}) {
      if (!pages.length) return 0;
      const nextIdx = clamp(targetIdx, 0, pages.length - 1);
      const next = pages[nextIdx];
      if (nextIdx === pageIdx && hasRendered && !opts.force) return pageIdx;
      pageIdx = nextIdx;
      hasRendered = true;
      renderInternal(next.globalT);
      syncUI();
      V.emit('onSeek', next.globalT);
      V.emit('onPptPage', { page: pageIdx + 1, total: pages.length, sceneIndex: next.sceneIndex });
      return pageIdx;
    }

    function stepBy(delta) {
      if (!pages.length) return pageIdx;
      return goToPage(pageIdx + delta);
    }

    function jumpSceneDelta(delta) {
      const p = pages[pageIdx];
      if (!p) return;
      const scenes = V.scenes || [];
      let nextSi = p.sceneIndex + delta;
      while (nextSi >= 0 && nextSi < scenes.length) {
        const idx = pages.findIndex(item => item.sceneIndex === nextSi);
        if (idx >= 0) { goToPage(idx); return; }
        nextSi += delta;
      }
    }

    function seekToNearestPage(t) {
      if (!pages.length) rebuildPages();
      goToPage(findPageIndexForTime(t), { force: true });
    }

    function buildChapters(bar) {
      const list = bar.querySelector('.chap-list'), trig = bar.querySelector('.chap-trigger');
      refs.chapLabel = bar.querySelector('.chap-cur-txt');
      if (!list || !trig) return;
      list.innerHTML = '';
      refs.chapItems = [];
      (V.scenes || []).forEach((sc, si) => {
        if (!sc || sc.pptSkip) return;
        const firstIdx = pages.findIndex(p => p.sceneIndex === si);
        if (firstIdx < 0) return;
        const pageTag = uiText('pptChapPage', { p: firstIdx + 1 });
        const item = h('div', { class: 'chap-item' }, h('em', null, String(si + 1).padStart(2, '0')), h('span', { class: 'chap-it-title' }, sc.title), h('small', null, pageTag));
        item.onclick = e => { e.stopPropagation(); setOpenMenu(bar, ''); goToPage(firstIdx); };
        list.appendChild(item);
        refs.chapItems.push({ item, sceneIndex: si });
      });
      trig.onclick = e => { e.stopPropagation(); setOpenMenu(bar, bar.dataset.menu === 'chap' ? '' : 'chap'); };
    }

    function buildControlsBar(cfg, uiCfg) {
      const homeTitle = cfg.homeLabel || uiText('home');
      const homeLink = cfg.homeUrl === false
        ? null
        : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl || '../', title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
      const webLabel = uiText('webEnter');
      const webBtn = uiCfg.webFull
        ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: webLabel, 'aria-label': webLabel }, makeCtrlIcon(uiCfg.icons.webEnter))
        : null;
      const notesLabel = uiText('pptNotesShow');
      const toVideoLabel = uiText('switchToVideo');
      const fullLabel = uiText('fullEnter');
      const nav = h('div', { class: 'ppt-nav' },
        h('button', { class: 'ctrl-icon-btn ppt-prev', 'data-ppt-act': 'prev', title: uiText('pptPrev'), 'aria-label': uiText('pptPrev') }, makeCtrlIcon(uiCfg.icons.prevSlide)),
        h('div', { class: 'chap-wrap' },
          h('button', { class: 'chap-trigger', 'data-act': 'chap', title: uiText('chapTrigger') }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, makeCtrlIcon(uiCfg.icons.chapCaret))),
          h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, uiText('chapHeader')), h('div', { class: 'chap-list' }))),
        h('span', { class: 'time ppt-page-num' }, '1 / 1'),
        h('button', { class: 'ctrl-icon-btn ppt-next', 'data-ppt-act': 'next', title: uiText('pptNext'), 'aria-label': uiText('pptNext') }, makeCtrlIcon(uiCfg.icons.nextSlide)));
      return h('div', { id: 'controls', class: 'ppt-bar', 'data-interactive': '1' },
        homeLink,
        ...renderCustomControls('left', uiCfg),
        h('div', { class: 'ppt-spacer' }),
        nav,
        h('div', { class: 'ppt-spacer' }),
        ...renderCustomControls('right', uiCfg),
        h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'subs', title: notesLabel, 'aria-label': notesLabel }, makeCtrlIcon(uiCfg.icons.subsOff)),
        h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'to-video', title: toVideoLabel, 'aria-label': toVideoLabel }, makeCtrlIcon(uiCfg.icons.videoMode)),
        webBtn,
        h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: fullLabel, 'aria-label': fullLabel }, makeCtrlIcon(uiCfg.icons.fullEnter)));
    }

    function syncBtnTitle(el, key) {
      if (!el) return;
      const label = uiText(key);
      el.title = label;
      el.setAttribute('aria-label', label);
    }

    function refreshChrome(cfg, uiCfg) {
      rebuildPages();
      if (!barEl) return;
      syncBtnTitle(barEl.querySelector('.ctrl-home'), 'home');
      const home = barEl.querySelector('.ctrl-home');
      if (home && cfg.homeLabel) { home.title = cfg.homeLabel; home.setAttribute('aria-label', cfg.homeLabel); }
      syncBtnTitle(refs.prev, 'pptPrev');
      syncBtnTitle(refs.next, 'pptNext');
      syncBtnTitle(refs.toVideo, 'switchToVideo');
      const chapTrig = barEl.querySelector('.chap-trigger');
      if (chapTrig) chapTrig.title = uiText('chapTrigger');
      const chapHd = barEl.querySelector('.chap-menu-hd');
      if (chapHd) chapHd.textContent = uiText('chapHeader');
      buildChapters(barEl);
      syncUI();
      void uiCfg;
    }

    function isEditableKeyTarget(t) {
      if (!t) return false;
      return Boolean(t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    }

    function isActionControlTarget(t) {
      return Boolean(t && t.closest && t.closest('button, a'));
    }

    function handlePptEscape(bar, e) {
      if (bar && bar.classList.contains('menu-open')) { setOpenMenu(bar, ''); e.preventDefault(); }
      else if (exitWebFullIfActive && exitWebFullIfActive()) e.preventDefault();
    }

    const stepForwardOrScene = e => { e.preventDefault(); if (e.shiftKey) jumpSceneDelta(1); else stepBy(1); };
    const stepBackwardOrScene = e => { e.preventDefault(); if (e.shiftKey) jumpSceneDelta(-1); else stepBy(-1); };
    const PPT_KEY_MAP = {
      ArrowRight: stepForwardOrScene,
      ArrowDown: stepForwardOrScene,
      PageDown: stepForwardOrScene,
      ArrowLeft: stepBackwardOrScene,
      ArrowUp: stepBackwardOrScene,
      PageUp: stepBackwardOrScene,
      Backspace: stepBackwardOrScene,
      '[': e => { e.preventDefault(); jumpSceneDelta(-1); },
      ']': e => { e.preventDefault(); jumpSceneDelta(1); },
      Home: e => { e.preventDefault(); goToPage(0); },
      End: e => { e.preventDefault(); goToPage(pages.length - 1); },
      f: toggleOsFull,
      F: toggleOsFull,
      w: () => fallbackWebFull(true),
      W: () => fallbackWebFull(true),
    };

    function handlePptKeyDown(bar, e) {
      if (e.key === 'Escape') { handlePptEscape(bar, e); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableKeyTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        if (!isActionControlTarget(e.target)) { e.preventDefault(); stepBy(1); }
        return;
      }
      const fn = PPT_KEY_MAP[e.key];
      if (fn) fn(e);
    }

    function bindInputs(bar) {
      if (refs.prev) refs.prev.onclick = e => { e.stopPropagation(); stepBy(-1); };
      if (refs.next) refs.next.onclick = e => { e.stopPropagation(); stepBy(1); };
      if (refs.toVideo && switchMode) {
        refs.toVideo.onclick = e => {
          e.stopPropagation();
          const cur = pages[pageIdx];
          switchMode(false, cur ? cur.sceneIndex : 0);
        };
      }
      const vp = document.getElementById('viewport');
      if (vp) {
        vp.addEventListener('wheel', e => {
          if (Math.abs(e.deltaY) < 8 || shouldAllowNativeWheel(e.target, vp, e.deltaY)) return;
          e.preventDefault();
          const nowTs = performance.now();
          if (nowTs - wheelLockTs < 240) return;
          wheelLockTs = nowTs;
          stepBy(e.deltaY > 0 ? 1 : -1);
        }, { passive: false });
      }
      document.addEventListener('keydown', e => handlePptKeyDown(bar, e));
    }

    function init(bar) {
      barEl = bar;
      refs.prev = bar.querySelector('[data-ppt-act="prev"]');
      refs.next = bar.querySelector('[data-ppt-act="next"]');
      refs.pageNum = bar.querySelector('.ppt-page-num');
      refs.toVideo = bar.querySelector('[data-act="to-video"]');
      rebuildPages();
      buildChapters(bar);
      bindMenuAutoClose(bar);
      bindInputs(bar);
      syncUI();
    }

    return {
      rebuildPages,
      buildControlsBar,
      init,
      refreshChrome,
      syncUI,
      goToPage,
      stepBy,
      jumpSceneDelta,
      seekToNearestPage,
      resolveInitialPageIndex,
      swapSubsIcon: (subsBtn, showSubs, icons) => {
        if (!subsBtn) return;
        const key = showSubs ? 'subsOn' : 'subsOff';
        subsBtn.classList.toggle('is-off', !showSubs);
        swapBtnIcon(subsBtn, key, icons[key], uiText(showSubs ? 'pptNotesHide' : 'pptNotesShow'));
      },
      isInternalRender: () => internalRender,
      getPageNo: () => pageIdx + 1,
      getTotalPages: () => pages.length,
      getCurrentNote: () => (pages[pageIdx] ? pages[pageIdx].text : ''),
      getState: () => ({
        page: pageIdx + 1,
        totalPages: pages.length,
        sceneIndex: pages[pageIdx] ? pages[pageIdx].sceneIndex : 0,
      }),
      findPageNoForTime: t => findPageIndexForTime(t) + 1,
    };
  };
})(globalThis.V = globalThis.V || {});
