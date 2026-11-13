/* core/09-icons.js · 控制栏图标预设（现代线性 / 像素格）、UI 配置归一化与图标构造器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { h, svg } = V.u;

  const CTRL_ICONS = {
    home: ['M2.25 7.2 8 2.5l5.75 4.7', 'M4 6.2v6.55a.75.75 0 0 0 .75.75h6.5a.75.75 0 0 0 .75-.75V6.2', 'M6.75 13.5V9.75h2.5v3.75'],
    play: '<path d="M4.5 2.9a.8.8 0 0 1 1.22-.68l7.4 4.6a.8.8 0 0 1 0 1.36l-7.4 4.6a.8.8 0 0 1-1.22-.68V2.9z"/>',
    pause: '<rect x="3.75" y="2.75" width="3" height="10.5" rx="0.9"/><rect x="9.25" y="2.75" width="3" height="10.5" rx="0.9"/>',
    replay: ['M2.75 8a5.25 5.25 0 1 0 1.4-3.58', 'M2.6 2.6v2.7h2.7'],
    chapCaret: ['M4.5 9.75 8 6.25l3.5 3.5'],
    rate: ['M2.6 11.5a6 6 0 1 1 10.8 0', 'M8 8.5 10.8 5.4', 'M6 12.5h4'],
    subsOn: ['M2.25 3.5h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75z', 'M4.25 8.25h3', 'M9 8.25h2.75', 'M4.25 10.6h5.25'],
    subsOff: ['M2.25 3.5h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75z', 'M4.25 8.25h2', 'M2.25 2.25l11.5 11.5'],
    volumeOn: ['M2.5 6.25h2.3L8.25 3.5v9L4.8 9.75H2.5a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5z', 'M10.6 5.6a3.4 3.4 0 0 1 0 4.8', 'M12.6 3.8a6 6 0 0 1 0 8.4'],
    volumeVoice: ['M2.5 6.25h2.3L8.25 3.5v9L4.8 9.75H2.5a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5z', 'M10.8 5.6a3.4 3.4 0 0 1 0 4.8'],
    volumeBgm: ['M6.5 11.5V4l6-1.25v7.5', 'M4.75 13a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z', 'M10.75 11.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z'],
    volumeMute: ['M2.5 6.25h2.3L8.25 3.5v9L4.8 9.75H2.5a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5z', 'M10.75 6l3.25 4', 'M14 6l-3.25 4'],
    webEnter: ['M2 3h12a.75.75 0 0 1 .75.75v8.5A.75.75 0 0 1 14 13H2a.75.75 0 0 1-.75-.75v-8.5A.75.75 0 0 1 2 3z', 'M1.25 5.5h13.5', 'M4.5 8.5v-1.5H6', 'M11.5 9.5V11H10'],
    webExit: ['M2 3h12a.75.75 0 0 1 .75.75v8.5A.75.75 0 0 1 14 13H2a.75.75 0 0 1-.75-.75v-8.5A.75.75 0 0 1 2 3z', 'M1.25 5.5h13.5', 'M6 7v1.5H4.5', 'M10 11V9.5h1.5'],
    fullEnter: ['M2.5 6V2.5H6', 'M10 2.5h3.5V6', 'M13.5 10v3.5H10', 'M6 13.5H2.5V10'],
    fullExit: ['M6 2.5V6H2.5', 'M10 2.5V6h3.5', 'M13.5 10H10v3.5', 'M2.5 10H6v3.5'],
  };

  const PIXEL_ICONS = {
    home: '<path d="M7 2h2v1h2v1h2v2h1v2h-2v6H9v-4H7v4H4V8H2V6h1V4h2V3h2V2z"/>',
    play: '<path d="M4 2h2v1h2v1h2v1h2v2h1v2h-1v2h-2v1H8v1H6v1H4V2z"/>',
    pause: '<rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/>',
    replay: '<rect x="5" y="2" width="7" height="2"/><rect x="12" y="4" width="2" height="8"/><rect x="4" y="12" width="8" height="2"/><rect x="2" y="9" width="2" height="3"/><path d="M2 2h2v3h3v2H2V2z"/>',
    chapCaret: '<path d="M7 5h2v2h2v2h2v2h-2V9H9V7H7v2H5v2H3V9h2V7h2V5z"/>',
    rate: '<rect x="4" y="2" width="8" height="2"/><rect x="2" y="4" width="2" height="7"/><rect x="12" y="4" width="2" height="7"/><rect x="3" y="11" width="2" height="2"/><rect x="11" y="11" width="2" height="2"/><rect x="7" y="8" width="2" height="3"/><rect x="9" y="6" width="2" height="2"/><rect x="6" y="13" width="4" height="1"/>',
    subsOn: '<path d="M1 3h14v10H1V3zm2 2v6h10V5H3zm1 2h3v1H4V7zm5 0h3v1H9V7zm-5 2h6v1H4V9z"/>',
    subsOff: '<path d="M1 3h14v10H1V3zm2 2v6h10V5H3z"/><rect x="2" y="2" width="2" height="2"/><rect x="4" y="4" width="2" height="2"/><rect x="6" y="6" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/><rect x="10" y="10" width="2" height="2"/><rect x="12" y="12" width="2" height="2"/>',
    volumeOn: '<path d="M2 6h3V5h1V4h1V3h2v10H7v-1H6v-1H5v-1H2V6z"/><rect x="11" y="5" width="1" height="6"/><rect x="10" y="4" width="1" height="1"/><rect x="10" y="11" width="1" height="1"/><rect x="13" y="3" width="1" height="10"/><rect x="12" y="2" width="1" height="1"/><rect x="12" y="13" width="1" height="1"/>',
    volumeVoice: '<path d="M2 6h3V5h1V4h1V3h2v10H7v-1H6v-1H5v-1H2V6z"/><rect x="11" y="5" width="2" height="6"/><rect x="10" y="4" width="1" height="1"/><rect x="10" y="11" width="1" height="1"/>',
    volumeBgm: '<path d="M5 3h9v3H7v6H4v-1H3V9h2V3zm7 3h2v5h-1v1h-3V9h2V6z"/>',
    volumeMute: '<path d="M2 6h3V5h1V4h1V3h2v10H7v-1H6v-1H5v-1H2V6z"/><rect x="10" y="5" width="2" height="2"/><rect x="13" y="5" width="2" height="2"/><rect x="11" y="7" width="3" height="2"/><rect x="10" y="9" width="2" height="2"/><rect x="13" y="9" width="2" height="2"/>',
    webEnter: '<rect x="1" y="2" width="14" height="3"/><rect x="1" y="5" width="2" height="9"/><rect x="13" y="5" width="2" height="9"/><rect x="1" y="12" width="14" height="2"/><rect x="4" y="6" width="3" height="1"/><rect x="4" y="7" width="1" height="2"/><rect x="9" y="10" width="3" height="1"/><rect x="11" y="8" width="1" height="2"/>',
    webExit: '<rect x="1" y="2" width="14" height="3"/><rect x="1" y="5" width="2" height="9"/><rect x="13" y="5" width="2" height="9"/><rect x="1" y="12" width="14" height="2"/><rect x="4" y="8" width="3" height="1"/><rect x="6" y="6" width="1" height="2"/><rect x="9" y="7" width="3" height="1"/><rect x="9" y="8" width="1" height="2"/>',
    fullEnter: '<rect x="2" y="2" width="4" height="2"/><rect x="2" y="4" width="2" height="2"/><rect x="10" y="2" width="4" height="2"/><rect x="12" y="4" width="2" height="2"/><rect x="2" y="10" width="2" height="2"/><rect x="2" y="12" width="4" height="2"/><rect x="12" y="10" width="2" height="2"/><rect x="10" y="12" width="4" height="2"/>',
    fullExit: '<rect x="4" y="2" width="2" height="2"/><rect x="2" y="4" width="4" height="2"/><rect x="10" y="2" width="2" height="2"/><rect x="10" y="4" width="4" height="2"/><rect x="2" y="10" width="4" height="2"/><rect x="4" y="12" width="2" height="2"/><rect x="10" y="10" width="4" height="2"/><rect x="10" y="12" width="2" height="2"/>',
  };

  V.defaultIcons = CTRL_ICONS;
  V.iconPresets = { default: CTRL_ICONS, linear: CTRL_ICONS, pixel: PIXEL_ICONS };
  const DEFAULT_RATES = [2, 1.5, 1.25, 1, 0.75];

  function canExpandParentFrame() {
    try {
      return Boolean(window.frameElement && window.parent === window.top);
    } catch {
      return false;
    }
  }

  function resolveWebFull(u) {
    return typeof u.webFull === 'boolean' ? u.webFull : canExpandParentFrame();
  }

  function resolveUiIcons(u) {
    const preset = V.iconPresets[u.iconPreset] || CTRL_ICONS;
    return Object.assign({}, CTRL_ICONS, preset, u.icons || {}, V.customIcons || {});
  }

  function resolveHudFlag(u, cfg) {
    return u.hud !== undefined ? Boolean(u.hud) : (!cfg || cfg.hud !== false);
  }

  function resolveChapterMarks(u, cfg) {
    return u.chapterMarks !== false && (!cfg || cfg.chapterMarks !== false);
  }

  function resolveResumeMinSec(u) {
    return u.resumeMinSec === undefined ? 5 : Math.max(0, Number(u.resumeMinSec) || 0);
  }

  function resolveUiDelays(u) {
    return {
      idleHideDelay: Number(u.idleHideDelay) || 1500,
      leaveHideDelay: Number(u.leaveHideDelay || u.autoHideDelay) || 220,
    };
  }

  function getUiCfg(cfg) {
    const u = (cfg && cfg.ui) || {};
    const delays = resolveUiDelays(u);
    return {
      controlsMode: u.controlsMode || (cfg && cfg.controlsMode) || 'overlay',
      idleHideDelay: delays.idleHideDelay,
      leaveHideDelay: delays.leaveHideDelay,
      persist: u.persist !== false,
      resumeMinSec: resolveResumeMinSec(u),
      osd: u.osd !== false,
      chapterMarks: resolveChapterMarks(u, cfg),
      hud: resolveHudFlag(u, cfg),
      rate: u.rate !== false,
      bgmDefault: u.bgmDefault !== false,
      webFull: resolveWebFull(u),
      rates: Array.isArray(u.rates) && u.rates.length ? u.rates : DEFAULT_RATES,
      icons: resolveUiIcons(u),
    };
  }

  function parseFullSvg(markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    const node = tpl.content.firstElementChild;
    if (!node) return svg('', 'class="ctrl-ico" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"');
    node.classList.add('ctrl-ico');
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function makeCtrlIcon(spec) {
    if (typeof spec === 'function') {
      const res = spec(h, V);
      return res && res.nodeType ? res : makeCtrlIcon(String(res || ''));
    }
    if (typeof spec === 'string') {
      return spec.trim().startsWith('<svg')
        ? parseFullSvg(spec)
        : svg(spec, 'class="ctrl-ico" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"');
    }
    const paths = Array.isArray(spec) ? spec : [];
    return svg(
      paths.map(d => `<path d="${d}"/>`).join(''),
      'class="ctrl-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
    );
  }

  function swapBtnIcon(btn, cacheKey, spec, label) {
    if (!btn) return;
    if (label) {
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    if (btn._icoKey === cacheKey) return;
    btn._icoKey = cacheKey;
    btn.replaceChildren(makeCtrlIcon(spec));
  }

  const fmtTime = s => {
    const sec = Math.max(0, Math.floor(s));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };
  const fmtRate = r => (Number.isInteger(r) ? `${r}.0x` : `${r}x`);

  V.makeIcon = nameOrSpec => {
    const icons = getUiCfg(V.getCfg()).icons;
    return makeCtrlIcon(icons[nameOrSpec] || nameOrSpec);
  };
  V._getUiCfg = getUiCfg;
  V._makeCtrlIcon = makeCtrlIcon;
  V._swapBtnIcon = swapBtnIcon;
  V._fmtTime = fmtTime;
  V._fmtRate = fmtRate;
})(globalThis.V = globalThis.V || {});
