/* core/09-player.js · 舞台挂载、可主题化控制栏、章节分段、倍速上拉菜单、音频主时钟与 V.boot 启动器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, prog, appear, h, svg, toggle, syncVideoClip } = V.u;

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

  const params = new URLSearchParams(location.search);
  const RECORD = params.has('record') || params.has('capture');
  const DEV = params.has('dev') && !RECORD;
  V._isRecord = RECORD;

  let audio = null, bgmAudio = null, stage = null, subs = null, subLead = null, subTail = null, subSpeaker = null, subText = null;
  let current = null, now = 0, prevRenderNow = 0, playing = false, lastTs = 0, pauseBaseTs = 0, ended = false;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false, muted = false;
  let voiceOn = !params.has('novoice'), bgmOn = !params.has('nobgm');
  let scrubbing = false, targetSeekTime = null, lastSeekTarget = -1, lastSeekAt = 0;
  let audioBlocked = false, playPending = false, bgmPlayPending = false, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null, idleTimer = 0, inHotZone = false;
  let wipeState = { name: '', handler: null, dom: null };
  const sandboxState = { active: false, entering: false, returnTime: null, el: null, txtEl: null, backEl: null };
  const ui = {};

  function canExpandParentFrame() {
    try {
      return Boolean(window.frameElement && window.parent === window.top);
    } catch {
      return false;
    }
  }

  function resolveWebFull(u) {
    if (typeof u.webFull === 'boolean') return u.webFull;
    return canExpandParentFrame();
  }

  function resolveControlsMode(u, cfg) {
    return u.controlsMode || (cfg && cfg.controlsMode) || 'overlay';
  }

  function resolveUiIcons(u) {
    const preset = V.iconPresets[u.iconPreset] || CTRL_ICONS;
    return Object.assign({}, CTRL_ICONS, preset, u.icons || {}, V.customIcons || {});
  }

  function getUiCfg(cfg) {
    const u = (cfg && cfg.ui) || {};
    return {
      controlsMode: resolveControlsMode(u, cfg),
      autoHideZone: Number(u.autoHideZone) || 72,
      autoHideDelay: Number(u.autoHideDelay) || 300,
      actionWakeDelay: Number(u.actionWakeDelay) || 850,
      chapterMarks: u.chapterMarks !== false && (!cfg || cfg.chapterMarks !== false),
      hud: u.hud !== undefined ? Boolean(u.hud) : (!cfg || cfg.hud !== false),
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
  V.makeIcon = nameOrSpec => {
    const icons = getUiCfg(V.getCfg()).icons;
    return makeCtrlIcon(icons[nameOrSpec] || nameOrSpec);
  };

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

  function buildCustomControlBtn(c, pos, uiCfg) {
    if (typeof c.render === 'function') return c.render(h, V);
    const title = c.title || c.label || c.id || '';
    if (c.icon) {
      const cls = pos === 'right' ? 'ctrl-rbtn ctrl-icon-btn' : 'ctrl-icon-btn';
      return h('button', { class: cls, 'data-custom-ctrl': c.id || '', title, 'aria-label': title }, makeCtrlIcon(uiCfg.icons[c.icon] || c.icon));
    }
    return h('button', { 'data-custom-ctrl': c.id || '', title }, c.label || c.id || '');
  }

  function renderCustomControls(pos, uiCfg) {
    return V.controls.filter(c => (c.position || 'right') === pos).map(c => {
      const btn = buildCustomControlBtn(c, pos, uiCfg);
      if (typeof c.onClick === 'function') btn.addEventListener('click', e => c.onClick(e, V));
      c._el = btn;
      return btn;
    });
  }

  function buildControlsBar(cfg, uiCfg) {
    const homeTitle = cfg.homeLabel || '返回主界面';
    const homeLink = cfg.homeUrl === false
      ? null
      : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl || '../', title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
    const rateWrap = uiCfg.rate
      ? h('div', { class: 'rate-wrap' },
          h('button', { class: 'ctrl-rbtn ctrl-icon-btn rate-trigger', 'data-act': 'rate', title: '播放倍速（1.0x）', 'aria-label': '播放倍速（1.0x）' }, makeCtrlIcon(uiCfg.icons.rate)),
          h('div', { class: 'rate-menu' }))
      : null;
    const webFullBtn = uiCfg.webFull
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: '窗口全屏（W）', 'aria-label': '窗口全屏' }, makeCtrlIcon(uiCfg.icons.webEnter))
      : null;
    return h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { class: 'ctrl-icon-btn', 'data-act': 'play', 'data-state': 'paused', 'aria-pressed': 'false', title: '播放（空格）', 'aria-label': '播放（空格）' }, makeCtrlIcon(uiCfg.icons.play)),
      ...renderCustomControls('left', uiCfg),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: '切换章节 / 搜索台词（/）' }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, makeCtrlIcon(uiCfg.icons.chapCaret))),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, '章节导航 · CHAPTERS'), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right', uiCfg),
      rateWrap,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'subs', title: '关闭字幕', 'aria-label': '关闭字幕' }, makeCtrlIcon(uiCfg.icons.subsOn)),
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'mute', title: '声音设置（M 静音 / B 开关配乐）', 'aria-label': '声音设置' }, makeCtrlIcon(uiCfg.icons.volumeOn)),
      h('div', { class: 'sound-menu' }),
      webFullBtn,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: '全屏（F）', 'aria-label': '全屏' }, makeCtrlIcon(uiCfg.icons.fullEnter)));
  }

  V.mountStage = function () {
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    document.body.classList.toggle('ctrl-overlay', uiCfg.controlsMode === 'overlay');
    if (document.getElementById('stage')) return;

    const sbTxt = h('span', { class: 'v-sandbox-txt egg-ban-txt' }, '🎮 彩蛋试玩中');
    const sbBack = h('button', { class: 'v-sandbox-back egg-back-btn', 'data-interactive': '1', type: 'button' }, '↩ 返回终章');
    const sbBar = h('div', { class: 'v-sandbox-bar egg-banner', 'data-interactive': '1' }, sbTxt, sbBack);
    sandboxState.el = sbBar;
    sandboxState.txtEl = sbTxt;
    sandboxState.backEl = sbBack;

    const vp = h('div', { id: 'viewport' },
      h('div', { id: 'stage' },
        h('canvas', { id: 'gl', width: String(W), height: String(H), class: V.gl ? '' : 'is-off' }),
        h('div', { id: 'hud', 'data-interactive': '1', class: uiCfg.hud ? '' : 'is-off' }, h('div', { class: 'hud-track' }, h('i', { class: 'hud-bar' }))),
        h('div', { id: 'subs', 'data-sub-pos': 'center' },
          h('div', { class: 'sub-lead' }),
          h('span', { class: 'sub-speaker' }),
          h('p', { class: 'sub-text' }, h('span', { class: 'ghost' }), h('span')),
          h('div', { class: 'sub-tail' })),
        sbBar,
        h('div', { id: 'checkpoint-overlay' }),
        h('div', { id: 'wipe' }),
        h('div', { id: 'safe-guide' }, h('div', { class: 'safe-action' }), h('div', { class: 'safe-sub' }, 'SUBTITLE SAFE ZONE'))),
      h('div', { id: 'start-hint' }, cfg.startHint || '▶ 点击画面开始播放'));

    document.body.prepend(vp, buildControlsBar(cfg, uiCfg));
  };

  function sceneAt(t) {
    for (const sc of V.scenes) if (t < sc.start + sc.duration) return sc;
    return V.scenes[V.scenes.length - 1];
  }

  function enter(sc) {
    if (current && current.root) current.root.remove();
    V._videoClips.clear();
    const si = V.scenes.indexOf(sc);
    sc.root = h('div', { class: 'scene ' + (sc.cls || '') });
    sc.ctx = V.makeCtx(sc, si);
    stage.appendChild(sc.root);
    sc.build(sc.root, sc.ctx);
    current = sc;
    V.emit('onSceneEnter', { scene: sc, sceneIndex: si });
  }

  function findNearestCut() {
    let near = 999, cutSc = null;
    for (const sc of V.scenes) {
      if (sc.start > 0 && Math.abs(now - sc.start) < Math.abs(near)) {
        near = now - sc.start;
        cutSc = sc;
      }
    }
    return { near, cutSc };
  }

  function runTransition() {
    const box = document.getElementById('wipe');
    if (!box || V.scenes.length < 2) return;
    const cfg = V.getCfg();
    const { near, cutSc } = findNearestCut();
    const name = (cutSc && cutSc.transition) || cfg.transition || 'fade';
    const handler = V.transitions[name] || V.transitions.fade;
    if (!handler) return;
    if (wipeState.name !== name) {
      box.innerHTML = '';
      wipeState = { name, handler, dom: handler.mount ? handler.mount(box, cfg) : {} };
    }
    const dur = cfg.transitionDur === undefined ? (handler.dur || 0.28) : cfg.transitionDur;
    handler.update(wipeState.dom, near, dur, current, cfg);
  }

  function updateHud() {
    const el = document.getElementById('hud');
    if (el && !el.classList.contains('is-off')) {
      el.querySelector('.hud-bar').style.width = clamp(now / V.duration) * 100 + '%';
    }
  }

  const SUB_VAR_MAP = [
    ['left', '--sub-left'], ['right', '--sub-right'], ['top', '--sub-top'], ['bottom', '--sub-bottom'],
    ['offsetX', '--sub-offset-x'], ['offsetY', '--sub-offset-y'], ['align', '--sub-align'],
    ['maxWidth', '--sub-max-w'], ['padding', '--sub-padding'], ['gap', '--sub-gap'], ['zIndex', '--sub-z'],
  ];

  function getSubCfg() {
    const cfg = V.getCfg();
    return Object.assign({}, cfg.subtitles || {}, V.subtitles || {});
  }

  function resolveSubLayoutObj(spec, subCfg) {
    if (!spec) return { pos: 'center' };
    if (typeof spec === 'string') {
      const m = subCfg && subCfg.modes && subCfg.modes[spec];
      return m ? Object.assign({ pos: 'center' }, m) : { pos: spec };
    }
    return Object.assign({ pos: spec.pos || 'center' }, spec);
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
  V.setSubLayout = applySubLayout;

  function mountSubSlot(slotEl, factory) {
    if (!slotEl || !factory) return;
    slotEl.innerHTML = '';
    const res = typeof factory === 'function' ? factory(h, V) : factory;
    if (!res) return;
    if (res.nodeType) slotEl.appendChild(res);
    else slotEl.innerHTML = String(res);
  }

  function mountSubSlots() {
    const subCfg = getSubCfg();
    mountSubSlot(subLead, subCfg.lead);
    mountSubSlot(subTail, subCfg.tail);
    if (subCfg.layout || subCfg.position) applySubLayout(subCfg.layout || subCfg.position);
  }

  function runSubHook(subCfg, cue, sc, idx, lt, clock) {
    const fn = subCfg.onUpdate || subCfg.update;
    if (typeof fn !== 'function') return;
    const lineCue = activeCueIdx >= 0 ? sc.cues[activeCueIdx] : null;
    const info = { t: now, clock, lt, scene: sc, sceneIndex: idx, lineCue, speaking: Boolean(cue), energy: V.getSceneEnergy(sc, idx, lt) };
    fn(cue, info, { subs, lead: subLead, tail: subTail, speaker: subSpeaker, text: subText });
  }

  function syncSceneSubLayout(sc, lt) {
    const spec = sc.subLayout || sc.subtitles;
    if (!spec) return;
    applySubLayout(typeof spec === 'function' ? spec(lt, sc.ctx, sc) : spec);
  }

  function updateSubDomText(cue) {
    if (subSpeaker && subSpeaker._sp !== (cue.speaker || '')) {
      subSpeaker._sp = cue.speaker || '';
      subSpeaker.textContent = subSpeaker._sp;
      subSpeaker.classList.toggle('is-on', Boolean(subSpeaker._sp));
    }
    if (subText._t !== cue.text) {
      subText.firstChild.textContent = cue.text;
      subText.lastChild.textContent = cue.text;
      subText._t = cue.text;
    }
  }

  function updateSubs(sc, idx, lt, clock) {
    const subCfg = getSubCfg();
    syncSceneSubLayout(sc, lt);
    const list = sc.subCues && sc.subCues.length ? sc.subCues : sc.cues;
    let cue = null;
    activeCueIdx = -1;
    sc.cues.forEach((c, i) => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) activeCueIdx = i; });
    list.forEach(c => { if (lt >= c.start - 0.04 && lt < c.end + 0.08) cue = c; });
    subs.style.visibility = cue && showSubs ? 'visible' : 'hidden';
    if (cue) {
      const a = Math.min(appear(lt, cue.start - 0.04, 0.14), 1 - prog(lt, cue.end, cue.end + 0.12));
      subs.style.opacity = String(clamp(a));
      updateSubDomText(cue);
    }
    runSubHook(subCfg, cue, sc, idx, lt, clock);
  }

  function syncSceneVideoClips(lt) {
    for (const clip of V._videoClips) {
      if (clip.isConnected) syncVideoClip(clip, lt, playing && !scrubbing);
    }
  }

  function resolveDefaultSandboxReturn() {
    const last = V.scenes[V.scenes.length - 1];
    if (!last) return Math.max(0, V.duration - 0.5);
    if (typeof last.sandboxReturnOffset === 'number') return last.start + last.sandboxReturnOffset;
    const lastCue = last.cues && last.cues.length ? last.cues[last.cues.length - 1] : null;
    return lastCue ? Math.min(V.duration - 0.05, last.start + lastCue.start + 2.5) : Math.max(0, V.duration - 0.5);
  }

  function setSandboxActiveDom(on, hint, backLabel) {
    sandboxState.active = on;
    document.body.classList.toggle('sandbox-mode', on);
    document.body.classList.toggle('egg-mode', on);
    if (!sandboxState.el) return;
    sandboxState.el.classList.toggle('on', on);
    if (on && hint && sandboxState.txtEl) sandboxState.txtEl.textContent = hint;
    if (on && backLabel && sandboxState.backEl) sandboxState.backEl.textContent = backLabel;
  }

  function exitSandbox(seekBack = true) {
    const ret = sandboxState.returnTime;
    setSandboxActiveDom(false);
    if (seekBack && ret != null) {
      seek(ret);
      pause();
    }
  }

  function enterSandbox(opts = {}) {
    const target = Number(opts.targetTime);
    if (!Number.isFinite(target)) return;
    const prefix = opts.prefix === undefined ? '🎮 彩蛋试玩：' : opts.prefix;
    const label = opts.hint ? prefix + opts.hint : '🎮 彩蛋试玩中';
    sandboxState.returnTime = Number.isFinite(opts.returnTime) ? opts.returnTime : resolveDefaultSandboxReturn();
    sandboxState.entering = true;
    setSandboxActiveDom(true, label, opts.backLabel || '↩ 返回终章');
    seek(target);
    pause();
    sandboxState.entering = false;
  }

  function tryEgg(targetTime, hint, opts) {
    enterSandbox(Object.assign({}, opts || {}, { targetTime, hint }));
  }

  function replay() {
    exitSandbox(false);
    V.resetCheckpoints();
    seek(0);
    play();
  }

  function isInteractiveHold() {
    if (sandboxState.active) return true;
    if (!ended || !current) return false;
    const cfg = V.getCfg();
    return Boolean(current.live || current.interactiveEnd || cfg.interactiveEnd);
  }

  function shouldContinueSceneAtEnd(sc, idleSec) {
    if (!ended || idleSec <= 0 || !sc.live || sc.freezeTimelineAtEnd) return false;
    return sc === V.scenes[V.scenes.length - 1];
  }

  function syncSceneCtxAndEndState(sc, idle) {
    ended = !playing && now >= V.duration - 0.01;
    document.body.classList.toggle('is-ended', ended);
    if (sandboxState.active && !sandboxState.entering && sc === V.scenes[V.scenes.length - 1]) setSandboxActiveDom(false);
    if (sc !== current) enter(sc);
    sc.ctx.clock = V._clock;
    sc.ctx.idle = idle;
    sc.ctx.ended = ended;
  }

  function render(t, idleSec) {
    if (!V.scenes.length || !Number.isFinite(t)) return;
    const idle = idleSec || 0;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    const clock = now + idle;
    prevRenderNow = now;
    V._now = now;
    V._clock = clock;
    const sc = sceneAt(now);
    syncSceneCtxAndEndState(sc, idle);
    const lt = now - sc.start;
    const idx = V.scenes.indexOf(sc);

    runTransition();
    if (V.gl && V.gl.ready) V.gl.render(now, clock);
    updateHud();
    stage.style.setProperty('--tg', ((clock % 6) / 6) * 150);
    stage.style.setProperty('--anim-t', (-clock).toFixed(3) + 's');
    document.body.classList.toggle('started', now > 0.05);
    sc.update(shouldContinueSceneAtEnd(sc, idle) ? lt + idle : lt, sc.ctx);
    syncSceneVideoClips(lt);
    updateSubs(sc, idx, lt, clock);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: RECORD, playing, scrubbing, pause, play });
    V.emit('onRender', { now, clock, idle, ended, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx, playing, scrubbing, hasAudio: Boolean(audio), isRecord: RECORD, muted });
    if (!RECORD) updateUI();
  }

  function safePlayAudio() {
    if (!audio || !playing || !audio.paused || playPending) return;
    playPending = true;
    audio.playbackRate = playbackRate;
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { playPending = false; audioBlocked = false; })
       .catch(err => { playPending = false; if (err && err.name === 'NotAllowedError') audioBlocked = true; });
    } else {
      playPending = false;
    }
  }

  function safePlayBgm() {
    if (!bgmAudio || !playing || bgmAudio.muted || !bgmAudio.paused || bgmPlayPending) return;
    bgmPlayPending = true;
    bgmAudio.playbackRate = playbackRate;
    const p = bgmAudio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { bgmPlayPending = false; }).catch(() => { bgmPlayPending = false; });
    } else {
      bgmPlayPending = false;
    }
  }

  function isAllMuted() {
    return muted || (!voiceOn && (!bgmAudio || !bgmOn));
  }

  function syncBgmPlaybackNow() {
    if (!bgmAudio) return;
    bgmAudio.muted = isAllMuted() || !bgmOn;
    bgmAudio.playbackRate = playbackRate;
    if (!playing || bgmAudio.muted) { bgmAudio.pause(); return; }
    const refT = audio && audio.readyState >= 1 ? audio.currentTime : now;
    if (bgmAudio.readyState >= 1 && Math.abs(bgmAudio.currentTime - refT) > 0.18) {
      try { bgmAudio.currentTime = refT; } catch {}
    }
    safePlayBgm();
  }

  function keepBgmInSync(masterTime) {
    if (!bgmAudio || isAllMuted() || !bgmOn || bgmAudio.seeking) return;
    if (bgmAudio.paused) { safePlayBgm(); return; }
    if (bgmAudio.readyState >= 2 && Math.abs(bgmAudio.currentTime - masterTime) > 0.22) {
      try { bgmAudio.currentTime = masterTime; } catch {}
    }
  }

  function showUiHold() {
    inHotZone = true;
    clearTimeout(idleTimer);
    document.body.classList.add('ui-active');
  }

  function scheduleUiHide(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!inHotZone) document.body.classList.remove('ui-active');
    }, ms);
  }

  function flashUi(ms = 850) {
    document.body.classList.add('ui-active');
    if (!inHotZone) scheduleUiHide(ms);
  }

  function resolveSoundBtnSpec(allOff) {
    if (allOff) return ['volumeMute', '取消静音（M）'];
    if (bgmAudio && !voiceOn && bgmOn) return ['volumeBgm', '声音设置：仅背景音乐（M 静音 / B 开关配乐）'];
    if (bgmAudio && voiceOn && !bgmOn) return ['volumeVoice', '声音设置：已关背景乐（M 静音 / B 恢复配乐）'];
    return ['volumeOn', bgmAudio ? '声音设置（M 静音 / B 开关配乐）' : '静音（M）'];
  }

  function syncSoundMenuUI() {
    const allOff = isAllMuted();
    if (ui.mute) {
      const icons = getUiCfg(V.getCfg()).icons;
      const [key, label] = resolveSoundBtnSpec(allOff);
      ui.mute.classList.toggle('is-off', allOff);
      ui.mute.dataset.soundMode = key;
      swapBtnIcon(ui.mute, key, icons[key], label);
    }
    if (ui.soundVoice) toggle(ui.soundVoice, 'on', !allOff && voiceOn);
    if (ui.soundBgm) toggle(ui.soundBgm, 'on', !allOff && bgmOn);
    if (ui.soundAllMute) toggle(ui.soundAllMute, 'on', allOff);
  }

  function applySoundState() {
    const allOff = isAllMuted();
    if (audio) audio.muted = allOff || !voiceOn;
    syncBgmPlaybackNow();
    syncSoundMenuUI();
    V.emit('onSoundChange', { muted: allOff, voiceOn: !allOff && voiceOn, bgmOn: Boolean(bgmAudio) && !allOff && bgmOn });
  }

  function setBgm(on) {
    bgmOn = Boolean(on);
    if (bgmOn && muted) muted = false;
    applySoundState();
  }

  function setVoice(on) {
    voiceOn = Boolean(on);
    if (voiceOn && muted) muted = false;
    applySoundState();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (!muted && !voiceOn && (!bgmAudio || !bgmOn)) voiceOn = true;
    applySoundState();
  }

  function checkSceneLoop(nextT) {
    if (!loopScene || !current) return false;
    const scEnd = current.start + current.duration - 0.03;
    if (now > scEnd || nextT < scEnd) return false;
    seek(current.start + 0.02);
    return true;
  }

  function finishPlayback() {
    render(V.duration - 0.001, 0);
    pause();
    V.emit('onEnded', { duration: V.duration, scene: current });
  }

  function advanceAudioClock(ts) {
    lastTs = ts;
    if (targetSeekTime == null && !audio.paused && !audio.seeking && audio.readyState >= 2) {
      keepBgmInSync(audio.currentTime);
      if (checkSceneLoop(audio.currentTime)) return;
      if (audio.ended || audio.currentTime >= V.duration - 0.01) finishPlayback();
      else render(audio.currentTime, 0);
      return;
    }
    if (audio.paused && audio.readyState >= 1 && !audio.seeking) safePlayAudio();
    if (current && current.live) render(now, 0);
  }

  function advanceWallClock(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (now + dt >= V.duration - 0.002) finishPlayback();
    else render(now + dt, 0);
  }

  function canSyncAudioWhileScrubbing() {
    if (!playing || !audio) return false;
    return !audio.paused && !audio.seeking && audio.readyState >= 2 && targetSeekTime == null;
  }

  function frame(ts) {
    if (scrubbing) {
      lastTs = ts;
      pauseBaseTs = ts;
      if (canSyncAudioWhileScrubbing()) render(audio.currentTime, 0);
      else if (current && current.live) render(now, 0);
    } else if (playing) {
      if (audio && !audioBlocked) advanceAudioClock(ts);
      else advanceWallClock(ts);
    } else if (current && current.live && !RECORD) {
      const idleSec = pauseBaseTs > 0 ? Math.max(0, (ts - pauseBaseTs) / 1000) : 0;
      render(now, idleSec);
    }
    requestAnimationFrame(frame);
  }

  function syncAudioBeforePlay() {
    const target = targetSeekTime != null ? targetSeekTime : now;
    if (Math.abs(audio.currentTime - target) > 0.15) {
      try { audio.currentTime = target; lastSeekTarget = target; lastSeekAt = performance.now(); targetSeekTime = null; }
      catch { targetSeekTime = target; }
    } else {
      targetSeekTime = null;
    }
    safePlayAudio();
  }

  function positionSoundMenu(bar) {
    if (!ui.soundMenu || !ui.mute || !bar) return;
    const barRect = bar.getBoundingClientRect();
    const btnRect = ui.mute.getBoundingClientRect();
    if (!barRect.width || !btnRect.width) return;
    const menuW = ui.soundMenu.offsetWidth || 148;
    const center = btnRect.left - barRect.left + btnRect.width / 2;
    const left = clamp(center - menuW / 2, 8, Math.max(8, barRect.width - menuW - 8));
    ui.soundMenu.style.left = Math.round(left) + 'px';
  }

  function setOpenMenu(bar, which) {
    if (!bar) return;
    const prev = bar.dataset.menu || '';
    const mode = which || '';
    if (mode === 'sound') positionSoundMenu(bar);
    bar.dataset.menu = mode;
    bar.classList.toggle('menu-open', Boolean(mode));
    bar.classList.toggle('chap-open', mode === 'chap');
    bar.classList.toggle('rate-open', mode === 'rate');
    bar.classList.toggle('sound-open', mode === 'sound');
    document.body.classList.toggle('menu-open', Boolean(mode));
    if (prev && !mode && !inHotZone) scheduleUiHide(300);
  }

  function play() {
    if (now >= V.duration - 0.01) { V.resetCheckpoints(); seek(0); }
    setSandboxActiveDom(false);
    ended = false;
    document.body.classList.remove('is-ended');
    V._checkpointsRuntime.closeCheckpointOverlay();
    setOpenMenu(document.getElementById('controls'), '');
    playing = true;
    if (audio && audio.error) audio = null;
    if (bgmAudio && bgmAudio.error) bgmAudio = null;
    audioBlocked = false;
    lastTs = performance.now();
    if (audio) {
      if (audio.readyState >= 1) syncAudioBeforePlay();
      else audio.addEventListener('loadedmetadata', syncAudioBeforePlay, { once: true });
    }
    syncBgmPlaybackNow();
    document.body.classList.add('playing');
    if (!RECORD) updateUI();
  }

  function pause() {
    playing = false;
    pauseBaseTs = performance.now();
    ended = now >= V.duration - 0.01;
    document.body.classList.remove('playing');
    document.body.classList.toggle('is-ended', ended);
    if (audio) audio.pause();
    if (bgmAudio) bgmAudio.pause();
    for (const clip of V._videoClips) if (clip.pause) clip.pause();
    if (!RECORD) updateUI();
  }

  function fmtRate(r) { return Number.isInteger(r) ? `${r}.0x` : `${r}x`; }

  function syncRateMenuSelection() {
    if (!ui.rateItems) return;
    ui.rateItems.forEach(({ el, rate }) => toggle(el, 'on', Math.abs(rate - playbackRate) < 0.01));
  }

  function syncRateBtnUI() {
    if (!ui.rate) return;
    const isNormal = Math.abs(playbackRate - 1) < 0.01;
    const txt = fmtRate(playbackRate);
    const label = `播放倍速（${txt}）`;
    ui.rate.classList.toggle('on', !isNormal);
    ui.rate.classList.toggle('ctrl-icon-btn', isNormal);
    if (isNormal) {
      swapBtnIcon(ui.rate, 'rate', getUiCfg(V.getCfg()).icons.rate, label);
      return;
    }
    ui.rate.title = label;
    ui.rate.setAttribute('aria-label', label);
    if (ui.rate._icoKey !== txt) {
      ui.rate._icoKey = txt;
      ui.rate.textContent = txt;
    }
  }

  function setRate(rate) {
    playbackRate = clamp(Number(rate) || 1, 0.25, 4);
    V._playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
    if (bgmAudio) bgmAudio.playbackRate = playbackRate;
    syncRateBtnUI();
    syncRateMenuSelection();
    V.emit('onRateChange', playbackRate);
  }

  function seek(t) {
    if (!Number.isFinite(t)) return;
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (Math.abs(target - lastSeekTarget) < 0.015 && ts - lastSeekAt < 600) return;
    lastTs = ts;
    pauseBaseTs = ts;
    lastSeekTarget = target;
    lastSeekAt = ts;
    render(target, 0);
    V.emit('onSeek', target);
    if (bgmAudio && bgmAudio.readyState >= 1) {
      try { bgmAudio.currentTime = now; } catch {}
    }
    if (!audio) return;
    if (audio.readyState >= 1) {
      try { audio.currentTime = now; targetSeekTime = null; } catch { targetSeekTime = now; }
    } else {
      targetSeekTime = now;
    }
  }

  const fmtTime = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function mountHudTicks(uiCfg) {
    const hudTrack = document.querySelector('#hud .hud-track');
    if (!hudTrack) return;
    hudTrack.querySelectorAll('.hud-tick').forEach(n => n.remove());
    if (!uiCfg.chapterMarks || V.duration <= 0) return;
    V.scenes.forEach((sc, i) => {
      if (i > 0) hudTrack.appendChild(h('i', { class: 'hud-tick', style: `left:${((sc.start / V.duration) * 100).toFixed(3)}%` }));
    });
  }

  function mountTrackMarks(track, uiCfg) {
    if (!track) return;
    track.querySelectorAll('.mark').forEach(n => n.remove());
    if (!uiCfg.chapterMarks || V.duration <= 0) return;
    const refNode = track.querySelector('.thumb');
    V.scenes.forEach((sc, i) => {
      if (i <= 0) return;
      const pct = ((sc.start / V.duration) * 100).toFixed(3);
      track.insertBefore(h('i', { class: 'mark', style: `left:${pct}%` }), refNode);
    });
  }

  function bindTrackHoverHint(track) {
    if (!track) return;
    track.addEventListener('pointermove', e => {
      if (V.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const t = clamp((e.clientX - rect.left) / Math.max(1, rect.width)) * V.duration;
      const sc = sceneAt(t);
      const idx = V.scenes.indexOf(sc);
      track.title = sc ? `${String(idx + 1).padStart(2, '0')} · ${sc.title} · ${fmtTime(t)}` : fmtTime(t);
    });
  }

  function buildChapters(bar) {
    const list = bar.querySelector('.chap-list'), trig = bar.querySelector('.chap-trigger');
    ui.chapLabel = bar.querySelector('.chap-cur-txt');
    if (!list || !trig) return;
    list.innerHTML = '';
    ui.chapItems = V.scenes.map((sc, i) => {
      const item = h('div', { class: 'chap-item' }, h('em', null, String(i + 1).padStart(2, '0')), h('span', { class: 'chap-it-title' }, sc.title), h('small', null, fmtTime(sc.start)));
      item.onclick = e => { e.stopPropagation(); setOpenMenu(bar, ''); seek(sc.start + 0.02); };
      list.appendChild(item);
      return item;
    });
    trig.onclick = e => {
      e.stopPropagation();
      setOpenMenu(bar, bar.dataset.menu === 'chap' ? '' : 'chap');
    };
  }

  function buildRateMenu(bar, uiCfg) {
    const menu = bar.querySelector('.rate-menu'), trig = bar.querySelector('.rate-trigger');
    if (!menu || !trig) return;
    menu.innerHTML = '';
    ui.rateItems = uiCfg.rates.map(r => {
      const el = h('div', { class: 'rate-item' }, h('span', null, fmtRate(r)), h('i', null, '✓'));
      el.onclick = e => { e.stopPropagation(); setRate(r); setOpenMenu(bar, ''); };
      menu.appendChild(el);
      return { el, rate: r };
    });
    syncRateMenuSelection();
    trig.onclick = e => {
      e.stopPropagation();
      setOpenMenu(bar, bar.dataset.menu === 'rate' ? '' : 'rate');
    };
  }

  function buildSoundMenu(bar) {
    const menu = bar.querySelector('.sound-menu');
    ui.soundMenu = menu;
    if (!menu) return;
    menu.innerHTML = '';
    ui.soundVoice = h('div', { class: 'sound-item', 'data-sound': 'voice' }, h('span', null, '解说声音'), h('i', null, '✓'));
    ui.soundBgm = h('div', { class: 'sound-item', 'data-sound': 'bgm' }, h('span', null, '背景音乐'), h('i', null, '✓'));
    ui.soundAllMute = h('div', { class: 'sound-item', 'data-sound': 'mute' }, h('span', null, '全部静音'), h('i', null, '✓'));
    ui.soundVoice.onclick = e => {
      e.stopPropagation();
      if (isAllMuted()) { muted = false; voiceOn = true; bgmOn = false; applySoundState(); }
      else setVoice(!voiceOn);
    };
    ui.soundBgm.onclick = e => {
      e.stopPropagation();
      if (isAllMuted()) { muted = false; voiceOn = false; bgmOn = true; applySoundState(); }
      else setBgm(!bgmOn);
    };
    ui.soundAllMute.onclick = e => { e.stopPropagation(); setMuted(!isAllMuted()); };
    menu.append(ui.soundVoice, ui.soundBgm, h('div', { class: 'sound-sep' }), ui.soundAllMute);
    syncSoundMenuUI();
  }

  function bindMenuAutoClose(bar) {
    const chapWrap = bar.querySelector('.chap-wrap');
    const rateWrap = bar.querySelector('.rate-wrap');
    addEventListener('pointerdown', e => {
      const inChap = chapWrap && chapWrap.contains(e.target);
      const inRate = rateWrap && rateWrap.contains(e.target);
      const inSound = (ui.mute && ui.mute.contains(e.target)) || (ui.soundMenu && ui.soundMenu.contains(e.target));
      if (!inChap && !inRate && !inSound) setOpenMenu(bar, '');
    });
  }

  function bindScrubber(el) {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      const rect = el.getBoundingClientRect(), startX = e.clientX;
      let dragged = false, uncommittedT = null, lastAudioSeekTs = performance.now();
      scrubbing = true;
      document.body.classList.add('scrubbing');
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      const toTime = cx => clamp((cx - rect.left) / rect.width) * V.duration;
      seek(toTime(e.clientX));
      const mv = ev => {
        if (!dragged && Math.abs(ev.clientX - startX) < 3) return;
        dragged = true;
        const t = toTime(ev.clientX), ts = performance.now();
        if (ts - lastAudioSeekTs > 120) { lastAudioSeekTs = ts; uncommittedT = null; seek(t); }
        else { uncommittedT = t; render(t); }
      };
      const up = () => {
        scrubbing = false;
        document.body.classList.remove('scrubbing');
        if (uncommittedT != null) seek(uncommittedT);
        removeEventListener('pointermove', mv);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  }

  function isOsFull() { return Boolean(document.fullscreenElement || document.webkitFullscreenElement); }

  function syncParentFrameFull(on) {
    try {
      const frameEl = window.frameElement;
      if (!frameEl) return;
      if (on) {
        savedFrameStyle = frameEl.getAttribute('style');
        frameEl.style.cssText += ';position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;max-width:none !important;max-height:none !important;z-index:2147483647 !important;border:0 !important;border-radius:0 !important;margin:0 !important;';
      } else if (savedFrameStyle === null) frameEl.removeAttribute('style');
      else frameEl.setAttribute('style', savedFrameStyle);
    } catch {}
  }

  function setBtnIcon(btn, cacheKey, iconSpec, title, active) {
    if (!btn || !btn.classList.contains('ctrl-icon-btn')) return;
    btn.classList.toggle('on', active);
    swapBtnIcon(btn, cacheKey, iconSpec, title);
  }

  function syncFullUI() {
    const osOn = isOsFull();
    const icons = getUiCfg(V.getCfg()).icons;
    document.body.classList.toggle('os-full', osOn);
    document.body.classList.toggle('web-full', webFull);
    setBtnIcon(ui.webfull, webFull ? 'webExit' : 'webEnter', webFull ? icons.webExit : icons.webEnter, webFull ? '退出窗口全屏（W / Esc）' : '窗口全屏（W）', webFull);
    setBtnIcon(ui.full, osOn ? 'fullExit' : 'fullEnter', osOn ? icons.fullExit : icons.fullEnter, osOn ? '退出全屏（F / Esc）' : '全屏（F）', osOn);
    fit();
  }

  function setWebFull(on) {
    webFull = Boolean(on);
    syncParentFrameFull(webFull);
    syncFullUI();
    try { window.parent.postMessage({ type: 'video:webfull', active: webFull }, '*'); } catch {}
  }

  function fallbackWebFull(toggle) {
    if (ui.webfull) setWebFull(toggle ? !webFull : true);
  }

  function toggleOsFull() {
    if (isOsFull()) {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
      return;
    }
    const req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!req) { fallbackWebFull(true); return; }
    const p = req.call(document.documentElement);
    if (p && p.catch) p.catch(() => fallbackWebFull(false));
  }

  function jumpChapterDelta(delta) {
    const idx = V.scenes.indexOf(current);
    if (delta > 0 && idx < V.scenes.length - 1) seek(V.scenes[idx + 1].start + 0.01);
    if (delta < 0) seek(V.scenes[Math.max(0, now - current.start < 1.5 ? idx - 1 : idx)].start + 0.01);
  }

  function isEditableTarget(target) {
    const tag = (target && target.tagName) || '';
    return /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
  }

  function isNativeSpaceTarget(target) {
    return Boolean(target && target.closest && target.closest('button, a'));
  }

  function handleEscapeKey(bar, e) {
    if (bar && bar.classList.contains('menu-open')) { setOpenMenu(bar, ''); e.preventDefault(); }
    else if (sandboxState.active) { exitSandbox(true); e.preventDefault(); }
    else if (!isOsFull() && webFull) { setWebFull(false); e.preventDefault(); }
  }

  function bindKeyboard(bar) {
    const keyMap = {
      '.': () => { pause(); seek(now + 1 / 30); },
      ',': () => { pause(); seek(now - 1 / 30); },
      ']': () => { jumpChapterDelta(1); flashUi(); },
      PageDown: () => { jumpChapterDelta(1); flashUi(); },
      '[': () => { jumpChapterDelta(-1); flashUi(); },
      PageUp: () => { jumpChapterDelta(-1); flashUi(); },
      w: () => fallbackWebFull(true),
      W: () => fallbackWebFull(true),
      f: toggleOsFull,
      F: toggleOsFull,
      m: () => { setMuted(!isAllMuted()); flashUi(); },
      M: () => { setMuted(!isAllMuted()); flashUi(); },
      b: () => { if (bgmAudio) { setBgm(!(!isAllMuted() && bgmOn)); flashUi(); } },
      B: () => { if (bgmAudio) { setBgm(!(!isAllMuted() && bgmOn)); flashUi(); } },
      ArrowRight: e => { seek(now + (e.shiftKey ? 1 : 5)); flashUi(); },
      ArrowLeft: e => { seek(now - (e.shiftKey ? 1 : 5)); flashUi(); },
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { handleEscapeKey(bar, e); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.code === 'Space') {
        if (!isNativeSpaceTarget(e.target)) { e.preventDefault(); playing ? pause() : play(); }
        return;
      }
      if (keyMap[e.key]) keyMap[e.key](e);
    });
  }

  function bindIdleWake(bar, uiCfg) {
    const hotZone = uiCfg.autoHideZone;
    const leaveDelay = uiCfg.autoHideDelay;
    addEventListener('pointermove', e => {
      const hot = e.clientY >= innerHeight - hotZone || Boolean(bar && bar.contains(e.target));
      if (hot) showUiHold();
      else if (inHotZone) { inHotZone = false; scheduleUiHide(leaveDelay); }
    });
    document.addEventListener('mouseleave', () => { inHotZone = false; scheduleUiHide(leaveDelay); });
    addEventListener('blur', () => { inHotZone = false; scheduleUiHide(leaveDelay); });
    addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') flashUi(bar && bar.contains(e.target) ? 2000 : 1500);
    });
    addEventListener('focusin', e => {
      if (bar && bar.contains(e.target)) flashUi(1200);
    });
    flashUi(uiCfg.actionWakeDelay);
    document.getElementById('viewport').addEventListener('click', e => {
      if (e.target.closest('[data-interactive]')) return;
      if (!playing && isInteractiveHold()) return;
      playing ? pause() : play();
    });
  }

  function syncPlayBtnUI() {
    if (!ui.play) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const state = playing ? 'playing' : (ended ? 'ended' : 'paused');
    const key = playing ? 'pause' : (ended ? 'replay' : 'play');
    const label = playing ? '暂停（空格）' : (ended ? '重播（空格）' : '播放（空格）');
    ui.play.dataset.state = state;
    ui.play.setAttribute('aria-pressed', String(playing));
    swapBtnIcon(ui.play, key, icons[key], label);
  }

  function syncSubsBtnUI() {
    if (!ui.subs) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const key = showSubs ? 'subsOn' : 'subsOff';
    ui.subs.classList.toggle('is-sub-on', showSubs);
    ui.subs.classList.toggle('is-off', !showSubs);
    swapBtnIcon(ui.subs, key, icons[key], showSubs ? '关闭字幕' : '开启字幕');
  }

  function buildUI(uiCfg) {
    const bar = document.getElementById('controls');
    const track = bar.querySelector('.track');
    const hudEl = document.getElementById('hud');
    ui.play = bar.querySelector('[data-act=play]');
    ui.fill = bar.querySelector('.fill');
    ui.thumb = bar.querySelector('.thumb');
    ui.time = bar.querySelector('.time');
    ui.rate = bar.querySelector('[data-act=rate]');
    ui.subs = bar.querySelector('[data-act=subs]');
    ui.mute = bar.querySelector('[data-act=mute]');
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');

    ui.play.onclick = () => (playing ? pause() : play());
    mountTrackMarks(track, uiCfg);
    bindScrubber(track);
    bindTrackHoverHint(track);
    if (hudEl && !hudEl.classList.contains('is-off')) bindScrubber(hudEl);
    buildChapters(bar);
    buildRateMenu(bar, uiCfg);
    buildSoundMenu(bar);
    bindMenuAutoClose(bar);

    syncRateBtnUI();
    syncSubsBtnUI();
    ui.subs.onclick = () => {
      showSubs = !showSubs;
      document.body.classList.toggle('nosubs', !showSubs);
      syncSubsBtnUI();
      render(now);
    };
    syncSoundMenuUI();
    ui.mute.onclick = e => {
      e.stopPropagation();
      if (bgmAudio) setOpenMenu(bar, bar.dataset.menu === 'sound' ? '' : 'sound');
      else setMuted(!isAllMuted());
    };
    if (ui.webfull) ui.webfull.onclick = () => setWebFull(!webFull);
    ui.full.onclick = toggleOsFull;
    if (sandboxState.backEl) {
      sandboxState.backEl.onclick = e => { e.stopPropagation(); exitSandbox(true); };
    }
    document.addEventListener('fullscreenchange', syncFullUI);
    document.addEventListener('webkitfullscreenchange', syncFullUI);
    bindKeyboard(bar);
    bindIdleWake(bar, uiCfg);
  }

  function updateUI() {
    if (!ui.fill) return;
    const pct = clamp(now / V.duration) * 100 + '%';
    ui.fill.style.width = pct;
    if (ui.thumb) ui.thumb.style.left = pct;
    if (!ui.time.dataset.copied) ui.time.textContent = fmtTime(now) + ' / ' + fmtTime(V.duration);
    const idx = V.scenes.indexOf(current);
    if (ui.chapLabel && current) ui.chapLabel.textContent = `${String(idx + 1).padStart(2, '0')} · ${current.title}`;
    syncPlayBtnUI();
    if (ui.chapItems) ui.chapItems.forEach((it, i) => toggle(it, 'on', i === idx));
    V.controls.forEach(c => { if (typeof c.sync === 'function') c.sync(c._el, V); });
  }

  function fit() {
    const vp = document.getElementById('viewport');
    const bar = document.getElementById('controls');
    const W = V.stageWidth || 1920, H = V.stageHeight || 1080;
    const vpW = (vp && vp.clientWidth) || innerWidth;
    const vpH = (vp && vp.clientHeight) || innerHeight;
    const ctrlH = (bar && bar.offsetHeight) || 46;
    const k = Math.min(vpW / W, vpH / H);
    const letterbox = Math.max(0, (vpH - H * k) / 2);
    const overlap = Math.round(Math.max(0, (ctrlH + 6 - letterbox) / Math.max(0.1, k)));
    stage.style.transform = `translate(-50%,-50%) scale(${k})`;
    stage.style.setProperty('--ctrl-overlap', overlap + 'px');
    if (vp) vp.style.setProperty('--k', k);
  }

  function initAudio(src) {
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('loadedmetadata', () => {
      el.playbackRate = playbackRate;
      const target = targetSeekTime != null ? targetSeekTime : (now > 0.05 ? now : null);
      if (target != null) {
        try { el.currentTime = target; lastSeekTarget = target; lastSeekAt = performance.now(); targetSeekTime = null; } catch {}
      }
      if (playing && el.paused) safePlayAudio();
    });
    el.addEventListener('seeked', () => { if (playing && el.paused) safePlayAudio(); });
    el.addEventListener('canplay', () => { if (playing && el.paused && !el.seeking) safePlayAudio(); });
    el.addEventListener('ended', () => { if (playing && targetSeekTime == null) finishPlayback(); });
    el.addEventListener('error', () => {
      if (audio === el) { audio = null; if (!RECORD) syncSoundMenuUI(); }
      audioBlocked = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && playing && !el.paused && !el.seeking && targetSeekTime == null && el.readyState >= 2) render(el.currentTime);
    });
    el.src = src;
    el.load();
    return el;
  }

  function seekVideoElementAsync(vid, targetSec) {
    return new Promise(resolve => {
      if (vid.readyState === 0) {
        const onMeta = () => { vid.removeEventListener('loadedmetadata', onMeta); seekVideoElementAsync(vid, targetSec).then(resolve); };
        vid.addEventListener('loadedmetadata', onMeta, { once: true });
        vid.addEventListener('error', () => resolve(), { once: true });
        return;
      }
      if (Math.abs((vid.currentTime || 0) - targetSec) < 0.008 && !vid.seeking) { resolve(); return; }
      const timer = setTimeout(resolve, 1500);
      vid.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
      try { vid.currentTime = targetSec; } catch { clearTimeout(timer); resolve(); }
    });
  }

  async function waitStageAssets() {
    if (!stage) return;
    const tasks = [];
    for (const img of stage.querySelectorAll('img')) {
      if (!(img._decoded && img.complete) && typeof img.decode === 'function') {
        tasks.push(img.decode().then(() => { img._decoded = true; }).catch(() => {}));
      }
    }
    for (const clip of V._videoClips) {
      if (clip.isConnected && clip._vclip) tasks.push(seekVideoElementAsync(clip, clip._vclip.targetTime));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  function resolveInitialTime() {
    if (params.has('t')) return parseFloat(params.get('t')) || 0;
    if (params.has('scene')) {
      const sIdx = clamp(+params.get('scene') || 0, 0, Math.max(0, V.scenes.length - 1));
      return V.scenes[sIdx] ? V.scenes[sIdx].start + 0.01 : 0;
    }
    try {
      const hmrT = sessionStorage.getItem('__video_hmr_t');
      if (hmrT != null) { sessionStorage.removeItem('__video_hmr_t'); return parseFloat(hmrT) || 0; }
    } catch {}
    return 0;
  }

  function initBgmAudio(src) {
    const el = new Audio();
    el.preload = 'auto';
    el.muted = isAllMuted() || !bgmOn;
    el.addEventListener('loadedmetadata', () => {
      el.playbackRate = playbackRate;
      const refT = audio && audio.readyState >= 1 ? audio.currentTime : now;
      if (refT > 0.05) { try { el.currentTime = refT; } catch {} }
      if (playing && !el.muted && el.paused) safePlayBgm();
    });
    el.addEventListener('error', () => {
      if (bgmAudio !== el) return;
      bgmAudio = null;
      const bar = document.getElementById('controls');
      if (bar && bar.dataset.menu === 'sound') setOpenMenu(bar, '');
      syncSoundMenuUI();
    });
    el.src = src;
    el.load();
    return el;
  }

  function resolveAudioSource(cfg) {
    if (cfg.audioSrc === false || RECORD) return null;
    return (V.voice && V.voice.src) || cfg.audioSrc || null;
  }

  function resolveBgmSource(cfg) {
    if (cfg.audioSrc === false || cfg.bgm === false || cfg.bgmSrc === false || RECORD) return null;
    return (V.voice && V.voice.bgmSrc) || cfg.bgmSrc || null;
  }

  function exposeBridge(cfg) {
    window.__video = {
      duration: V.duration,
      width: V.stageWidth,
      height: V.stageHeight,
      fps: cfg.fps || 30,
      seek: t => (RECORD ? render(t, 0) : seek(t)),
      seekVisual: t => render(t, 0),
      seekAsync: V.seekToAsync,
      setRate,
      setBgm,
      setVoice,
      setMuted,
      play,
      pause,
      replay,
      tryEgg,
      enterSandbox,
      exitSandbox,
      search: q => (V.search ? V.search(q) : []),
      openSearch: q => (V.openSearch ? V.openSearch(q) : undefined),
      getDeepLink: t => (V.getDeepLink ? V.getDeepLink(t) : ''),
      resume: V.resume,
      getSyncState: () => ({
        now,
        clock: V._clock || now,
        ended,
        sandbox: sandboxState.active,
        playing,
        playbackRate,
        muted: isAllMuted(),
        hasBgm: Boolean(bgmAudio),
        bgmEnabled: Boolean(bgmAudio) && !isAllMuted() && bgmOn,
        voiceEnabled: Boolean(audio) && !isAllMuted() && voiceOn,
        audioTime: audio ? audio.currentTime : null,
        drift: audio && !audio.paused && targetSeekTime == null ? Math.abs(audio.currentTime - now) : 0,
        seeking: audio ? audio.seeking : false,
        targetSeekTime,
        readyState: audio ? audio.readyState : 0,
        audioPaused: audio ? audio.paused : true,
      }),
      scenes: V.scenes.map(s => ({ title: s.title, start: s.start, duration: s.duration, cues: s.cues })),
    };
  }

  V.start = function () {
    V.mountStage();
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    if (uiCfg.bgmDefault === false && !params.has('bgm')) bgmOn = false;
    if (cfg.title) document.title = cfg.title;
    stage = document.getElementById('stage');
    subs = document.getElementById('subs');
    subLead = subs.querySelector('.sub-lead');
    subTail = subs.querySelector('.sub-tail');
    subSpeaker = subs.querySelector('.sub-speaker');
    subText = subs.querySelector('.sub-text');
    mountSubSlots();
    V.layout();
    mountHudTicks(uiCfg);
    V._layersRuntime.mountLayers(stage, subs);

    const audioSrc = resolveAudioSource(cfg);
    if (audioSrc) {
      audio = initAudio(audioSrc);
      audio.muted = isAllMuted() || !voiceOn;
    }
    const bgmSrc = resolveBgmSource(cfg);
    if (bgmSrc) bgmAudio = initBgmAudio(bgmSrc);

    V.seekTo = t => render(t, 0);
    V.seekToAsync = async t => { render(t, 0); await waitStageAssets(); };
    V.setBgm = setBgm;
    V.setVoice = setVoice;
    V.setMuted = setMuted;
    V.enterSandbox = enterSandbox;
    V.exitSandbox = exitSandbox;
    V.tryEgg = tryEgg;
    V.replay = replay;
    V._playerCtl = {
      play, pause, replay, seek, setRate, setBgm, setVoice, setMuted,
      enterSandbox, exitSandbox, tryEgg,
      fmtTime, updateUI, flashUi,
      setOpenMenu: m => setOpenMenu(document.getElementById('controls'), m),
      getRate: () => playbackRate,
      toggleLoopScene: () => (loopScene = !loopScene),
      isDev: DEV,
      isRecord: RECORD,
    };

    if (RECORD) document.body.classList.add('record');
    else buildUI(uiCfg);
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', fit);
    pauseBaseTs = performance.now();
    const t0 = resolveInitialTime();
    if (t0 > 0) seek(t0);
    else render(0, 0);
    requestAnimationFrame(frame);
    if (params.has('autoplay')) play();
    exposeBridge(cfg);
  };

  function loadOptionalScript(src) {
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => { s.remove(); resolve(false); };
      document.head.appendChild(s);
    });
  }

  async function ensureDynamicBootAssets() {
    const cfg = V.getCfg();
    if (V.scenes.length === 0 && Array.isArray(cfg.sceneScripts)) {
      for (const rel of cfg.sceneScripts) await loadOptionalScript(rel);
    }
    const lang = V.getActiveLang();
    if (!lang) return;
    if (!V.locales[lang]) await loadOptionalScript(`locales/${lang}.js`);
    const baseTimings = cfg.timingsScript || 'assets/voice/timings.js';
    const langTimings = baseTimings.replace(/\.js$/i, `.${lang}.js`);
    if (langTimings !== baseTimings) await loadOptionalScript(langTimings);
  }

  V.boot = async function () {
    await ensureDynamicBootAssets();
    V.mountStage();
    const glEl = document.getElementById('gl');
    if (V.gl && glEl) {
      glEl.classList.remove('is-off');
      await V.gl.init(glEl, V.getCfg());
      if (V.gl.ready === undefined) V.gl.ready = true;
    }
    V.start();
  };
})(globalThis.V = globalThis.V || {});
