/* core/14-search-deeplink.js · 台词与章节全文检索跳转（/ 或 Ctrl+K）及时间戳深链一键复制 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { h } = V.u;

  let cachedIndex = null;
  let searchInputEl = null;
  let timeElRef = null;
  let lastUrlSyncTs = 0;

  function uiText(key, vars) {
    return V.uiStr ? V.uiStr(key, vars) : key;
  }

  function buildSearchIndex() {
    if (cachedIndex) return cachedIndex;
    const entries = [];
    (V.scenes || []).forEach((sc, si) => {
      const title = sc.title || uiText('sceneFallbackTitle', { n: si + 1 });
      entries.push({ sceneIndex: si, sceneTitle: title, text: title, norm: title.toLowerCase(), time: sc.start, isTitle: true });
      for (const c of (sc.cues || [])) {
        if (!c || !c.text) continue;
        entries.push({
          sceneIndex: si,
          sceneTitle: title,
          text: c.text,
          norm: c.text.toLowerCase(),
          time: sc.start + (c.start || 0),
          isTitle: false,
        });
      }
    });
    cachedIndex = entries;
    return entries;
  }

  function searchTranscript(rawQuery) {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return [];
    return buildSearchIndex()
      .filter(it => it.norm.includes(q))
      .slice(0, 24)
      .map(({ sceneIndex, sceneTitle, text, time, isTitle }) => ({ sceneIndex, sceneTitle, text, time, isTitle }));
  }

  function buildHighlightedSnippet(text, query) {
    const low = text.toLowerCase();
    const q = query.trim().toLowerCase();
    const pos = low.indexOf(q);
    if (pos < 0) return document.createTextNode(text);
    const start = Math.max(0, pos - 12);
    const end = Math.min(text.length, pos + q.length + 22);
    const frag = document.createDocumentFragment();
    const prefix = (start > 0 ? '…' : '') + text.slice(start, pos);
    const hit = text.slice(pos, pos + q.length);
    const suffix = text.slice(pos + q.length, end) + (end < text.length ? '…' : '');
    if (prefix) frag.append(document.createTextNode(prefix));
    frag.append(h('mark', { class: 'chap-hit-mark' }, hit));
    if (suffix) frag.append(document.createTextNode(suffix));
    return frag;
  }

  function renderHitRow(hit, idx, activeIdx, query, ctl, onPick) {
    const code = String(hit.sceneIndex + 1).padStart(2, '0');
    const body = hit.isTitle
      ? h('span', { class: 'chap-it-title' }, buildHighlightedSnippet(hit.sceneTitle, query))
      : h('span', { class: 'chap-it-title' },
          h('span', null, hit.sceneTitle),
          h('span', { class: 'chap-hit-sub' }, buildHighlightedSnippet(hit.text, query)));
    const row = h('div', { class: 'chap-item' + (idx === activeIdx ? ' on' : '') },
      h('em', null, code),
      body,
      h('small', null, ctl.fmtTime(hit.time)));
    row.onclick = e => { e.stopPropagation(); onPick(hit); };
    return row;
  }

  function syncDeepLinkLangParam(u) {
    if (!V.__langOverridden) return;
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    if (lang && (!V.isSecondaryLocale || V.isSecondaryLocale(lang))) u.searchParams.set('lang', lang);
    else u.searchParams.delete('lang');
  }

  function getDeepLink(targetSec) {
    const sec = Math.max(0, Math.floor(Number.isFinite(targetSec) ? targetSec : (V._now || 0)));
    try {
      const u = new URL(location.href);
      u.searchParams.delete('autoplay');
      u.searchParams.delete('_hmr');
      syncDeepLinkLangParam(u);
      if (sec >= 1) u.searchParams.set('t', String(sec));
      else u.searchParams.delete('t');
      return u.toString();
    } catch {
      return location.href;
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0' }, text);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }

  function bindTimeDeepLinkCopy(ctl) {
    const timeEl = document.querySelector('#controls .time');
    if (!timeEl) return;
    timeElRef = timeEl;
    let copyTimer = null;
    timeEl.title = uiText('copyTimeTip');
    timeEl.onclick = async e => {
      e.stopPropagation();
      if (V.sfx) V.sfx('click', 0.45);
      const sec = Math.max(0, Math.floor(V._now || 0));
      await copyToClipboard(getDeepLink(sec));
      timeEl.dataset.copied = '1';
      timeEl.textContent = uiText('copiedTime', { time: ctl.fmtTime(sec) });
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        delete timeEl.dataset.copied;
        ctl.updateUI();
      }, 1200);
    };
  }

  function syncAddressBarOnSeek(t) {
    const cfg = V.getCfg();
    const uiCfg = (cfg && cfg.ui) || {};
    if (!uiCfg.syncUrl || window !== window.top) return;
    if (!/^https?:$/i.test(location.protocol)) return;
    const nowTs = performance.now();
    if (nowTs - lastUrlSyncTs < 350) return;
    lastUrlSyncTs = nowTs;
    try { history.replaceState(null, '', getDeepLink(t)); } catch {}
  }

  function isTypingInField(target) {
    const tag = (target && target.tagName) || '';
    return /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || Boolean(target && target.isContentEditable);
  }

  function mountChapterSearch(ctl) {
    const menu = document.querySelector('#controls .chap-menu');
    const chapList = menu && menu.querySelector('.chap-list');
    if (!menu || !chapList) return;

    const input = h('input', {
      class: 'chap-search',
      type: 'search',
      placeholder: uiText('searchPlaceholder'),
      'aria-label': uiText('searchAria'),
    });
    const resultsBox = h('div', { class: 'chap-search-results', hidden: 'true' });
    menu.insertBefore(h('div', { class: 'chap-search-row' }, input), chapList);
    menu.appendChild(resultsBox);
    searchInputEl = input;

    let hits = [];
    let activeIdx = 0;

    const pickHit = hit => {
      if (!hit) return;
      input.value = '';
      refresh('');
      ctl.setOpenMenu('');
      input.blur();
      ctl.seek(hit.time + 0.02);
    };

    function refresh(raw) {
      const q = String(raw || '').trim();
      if (!q) {
        hits = [];
        chapList.hidden = false;
        resultsBox.hidden = true;
        resultsBox.innerHTML = '';
        return;
      }
      chapList.hidden = true;
      resultsBox.hidden = false;
      hits = searchTranscript(q);
      activeIdx = 0;
      paintHits(q);
    }

    function paintHits(q) {
      resultsBox.innerHTML = '';
      if (!hits.length) {
        resultsBox.appendChild(h('div', { class: 'chap-empty' }, uiText('searchEmpty')));
        return;
      }
      hits.forEach((hit, i) => resultsBox.appendChild(renderHitRow(hit, i, activeIdx, q, ctl, pickHit)));
    }

    input.addEventListener('input', () => refresh(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && hits.length) {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % hits.length;
        paintHits(input.value);
      } else if (e.key === 'ArrowUp' && hits.length) {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + hits.length) % hits.length;
        paintHits(input.value);
      } else if (e.key === 'Enter' && hits.length) {
        e.preventDefault();
        pickHit(hits[activeIdx]);
      } else if (e.key === 'Escape') {
        input.value = '';
        refresh('');
        input.blur();
      }
    });

    document.addEventListener('keydown', e => {
      const isCmdK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
      const isSlash = !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '/' && !isTypingInField(e.target);
      if (!isCmdK && !isSlash) return;
      e.preventDefault();
      V.openSearch();
    });
  }

  V.search = searchTranscript;
  V.getDeepLink = getDeepLink;
  V.openSearch = function (initialQuery) {
    if (!V._playerCtl || V._playerCtl.isRecord || !searchInputEl) return;
    document.body.classList.add('ui-active');
    V._playerCtl.setOpenMenu('chap');
    void searchInputEl.offsetWidth;
    if (initialQuery !== undefined) {
      searchInputEl.value = String(initialQuery);
      searchInputEl.dispatchEvent(new Event('input'));
    }
    searchInputEl.focus({ preventScroll: true });
    searchInputEl.select();
  };

  V.use({
    id: 'builtin-search-deeplink',
    onStart(ctl) {
      cachedIndex = null;
      if (ctl.isRecord) return;
      mountChapterSearch(ctl);
      bindTimeDeepLinkCopy(ctl);
    },
    onLayout() {
      cachedIndex = null;
    },
    onLocaleChange() {
      cachedIndex = null;
      if (searchInputEl) {
        searchInputEl.placeholder = uiText('searchPlaceholder');
        searchInputEl.setAttribute('aria-label', uiText('searchAria'));
        if (searchInputEl.value) searchInputEl.dispatchEvent(new Event('input'));
      }
      if (timeElRef) timeElRef.title = uiText('copyTimeTip');
    },
    onSeek(t) {
      if (!V._isRecord) syncAddressBarOnSeek(t);
    },
  });
})(globalThis.V = globalThis.V || {});
