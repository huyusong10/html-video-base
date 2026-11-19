/* HTML Video Base v2.0 · Microkernel Runtime (Auto-assembled from runtime/base/js/core/*.js) */

/* core/01-registry.js · 微内核注册表与开放扩展契约（Plugin / Transition / Control / Preset / Layer / Locale） */
(function (V) {
  const DEFAULTS = [
    ['scenes', () => []],
    ['layers', () => []],
    ['plugins', () => []],
    ['transitions', () => ({})],
    ['controls', () => []],
    ['presets', () => ({})],
    ['locales', () => ({})],
    ['voices', () => ({})],
    ['subtitles', () => ({})],
    ['customIcons', () => ({})],
    ['config', () => ({})],
    ['c', () => ({})],
    ['checkpointState', () => ({})],
    ['pointer', () => ({ x: 960, y: 540, rawX: 960, rawY: 540, nx: 0, ny: 0, sx: 0, sy: 0, presence: 0, active: false, inside: false, down: false, overUI: false })],
    ['_videoClips', () => new Set()],
  ];
  for (const [k, make] of DEFAULTS) {
    if (!V[k]) V[k] = make();
  }

  function detectInitialPptMode() {
    if (typeof location === 'undefined' || !location.search) return false;
    const sp = new URLSearchParams(location.search);
    if (sp.get('capture') === 'ppt') return true;
    if (sp.has('record') || sp.has('capture')) return false;
    const raw = (sp.get('ppt') || '').toLowerCase();
    return raw === '1' || raw === 'true' || (sp.get('mode') || '').toLowerCase() === 'ppt';
  }
  if (V.pptMode === undefined) V.pptMode = detectInitialPptMode();
  const startupQuery = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
  const startupRecord = Boolean(startupQuery && (startupQuery.has('record') || startupQuery.has('capture')));
  V.environment = Object.freeze({
    isRecord: startupRecord,
    get pptMode() { return Boolean(V.pptMode); },
    get mode() { return startupRecord ? 'record' : (V.pptMode ? 'ppt' : 'interactive'); },
  });

  function upsertById(list, item) {
    const key = item.id || item.name;
    if (!key) { list.push(item); return item; }
    const idx = list.findIndex(x => (x.id || x.name) === key);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    return item;
  }

  V.scene = function (def) {
    if (def) V.scenes.push(def);
    return def;
  };

  V.use = function (plugin) {
    if (!plugin) return V;
    const obj = typeof plugin === 'function' ? { setup: plugin } : plugin;
    upsertById(V.plugins, obj);
    const initFn = obj.setup || obj.install;
    if (typeof initFn === 'function') initFn.call(obj, V);
    return V;
  };

  V.transition = function (name, handler) {
    if (!name || !handler) return V;
    V.transitions[name] = typeof handler === 'function'
      ? { mount: box => ({ box }), update: handler }
      : handler;
    return V;
  };

  V.control = function (def) {
    if (def) upsertById(V.controls, def);
    return V;
  };

  V.layer = function (def) {
    if (def && def.id) upsertById(V.layers, def);
    return def;
  };

  V.locale = function (lang, dict) {
    if (lang && dict) V.locales[lang] = dict;
    return V;
  };

  V.subtitle = function (def) {
    if (def) Object.assign(V.subtitles, def);
    return V;
  };

  V.icons = function (dict) {
    if (dict) Object.assign(V.customIcons, dict);
    return V;
  };

  V.preset = function (def, fn) {
    if (typeof def === 'string' && typeof fn === 'function') {
      V.c[def] = fn;
      return V;
    }
    if (!def || !def.name) return V;
    V.presets[def.name] = def;
    if (def.auto) V.activatePreset(def.name);
    return V;
  };

  function injectStylesheet(href) {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.querySelector(`link[data-preset-css="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-preset-css', href);
    document.head.appendChild(link);
  }

  function applyTokens(tokens) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const style = document.documentElement.style;
    for (const [k, val] of Object.entries(tokens)) {
      style.setProperty(k.startsWith('--') ? k : `--${k}`, String(val));
    }
  }

  V.activatePreset = function (name) {
    const p = V.presets[name];
    if (!p || p._applied) return;
    p._applied = true;
    if (p.defaults) V.themeDefaults = Object.assign({}, V.themeDefaults || {}, p.defaults);
    if (p.tokens) applyTokens(p.tokens);
    if (Array.isArray(p.stylesheets)) p.stylesheets.forEach(injectStylesheet);
    if (p.transitions) Object.entries(p.transitions).forEach(([k, fn]) => V.transition(k, fn));
    if (Array.isArray(p.layers)) p.layers.forEach(l => V.layer(l));
    if (p.subtitles) V.subtitle(p.subtitles);
    if (p.components) Object.assign(V.c, typeof p.components === 'function' ? p.components(V) : p.components);
    if (typeof p.setup === 'function') p.setup(V);
  };

  V.applyConfiguredPresets = function () {
    const list = V.config && V.config.presets;
    if (Array.isArray(list)) list.forEach(name => V.activatePreset(name));
  };

  const HOOK_ALIASES = {
    onStart: ['onBoot', 'boot', 'start'],
    onBoot: ['boot', 'onStart', 'start'],
    boot: ['onBoot', 'onStart', 'start'],
    onLayout: ['layout'],
    layout: ['onLayout'],
    onRender: ['tick', 'onTick', 'render'],
    onTick: ['tick', 'onRender', 'render'],
    tick: ['onTick', 'onRender', 'render'],
    onSeek: ['seek'],
    seek: ['onSeek'],
    onPlay: ['play'],
    play: ['onPlay'],
    onPause: ['pause'],
    pause: ['onPause'],
    onSceneEnter: ['sceneChange', 'onSceneChange', 'sceneEnter'],
    onSceneChange: ['sceneChange', 'onSceneEnter', 'sceneEnter'],
    sceneChange: ['onSceneChange', 'onSceneEnter', 'sceneEnter'],
    onEnded: ['ended'],
    ended: ['onEnded'],
  };

  function resolvePluginHook(plugin, hook) {
    if (typeof plugin[hook] === 'function') return plugin[hook];
    const alts = HOOK_ALIASES[hook];
    if (!alts) return null;
    for (const k of alts) if (typeof plugin[k] === 'function') return plugin[k];
    return null;
  }

  V.emit = function (hook, payload) {
    for (const p of V.plugins) {
      const fn = resolvePluginHook(p, hook);
      if (fn) fn.call(p, payload, V);
    }
  };

  function extractCfgLocaleCode(item) {
    if (typeof item === 'string') return item;
    return item && item.code ? String(item.code) : '';
  }

  function resolveOptInQueryLang(q) {
    if (!q) return '';
    const low = String(q).toLowerCase();
    const regKeys = V.locales ? Object.keys(V.locales) : [];
    const regHit = regKeys.find(k => k.toLowerCase() === low);
    if (regHit) return regHit;
    const cfgLoc = V.config && V.config.locales;
    if (cfgLoc === true) return q;
    if (!Array.isArray(cfgLoc) || !cfgLoc.length) return '';
    for (const item of cfgLoc) {
      const code = extractCfgLocaleCode(item);
      if (code && code.toLowerCase() === low) return code;
    }
    return '';
  }

  V.getActiveLang = function () {
    if (V.__langOverridden) return V.__activeLang || (V.config && V.config.lang) || '';
    if (V.__activeLang) return V.__activeLang;
    if (typeof location !== 'undefined' && location.search) {
      const q = resolveOptInQueryLang(new URLSearchParams(location.search).get('lang'));
      if (q) return q;
    }
    return (V.config && V.config.lang) || '';
  };

  function resolveBaseLang() {
    if (V.config && V.config.lang) return String(V.config.lang);
    const docEl = typeof document !== 'undefined' && document.documentElement;
    const htmlLang = docEl && docEl.getAttribute && docEl.getAttribute('lang');
    return htmlLang || '';
  }

  function sameLangFamily(a, b) {
    if (!a || !b) return false;
    const na = String(a).toLowerCase(), nb = String(b).toLowerCase();
    if (na === nb) return true;
    if (na.includes('-') && nb.includes('-')) return false;
    return na.split('-')[0] === nb.split('-')[0];
  }

  V.getBaseLang = resolveBaseLang;

  V.isSecondaryLocale = function (lang = V.getActiveLang()) {
    if (!lang) return false;
    if (V.locales && V.locales[lang]) return true;
    const base = resolveBaseLang();
    return base ? !sameLangFamily(lang, base) : true;
  };

  V.isVoiceLocaleMatch = function (voice = V.voice) {
    if (!voice) return false;
    const lang = V.getActiveLang();
    if (voice.lang) return lang ? voice.lang === lang : !V.isSecondaryLocale(voice.lang);
    return !V.isSecondaryLocale(lang);
  };

  V.getActiveVoice = function () {
    return V.isVoiceLocaleMatch(V.voice) ? V.voice : null;
  };

  function mergeUiDict(baseUi, nextUi) {
    if (!nextUi) return Object.assign({}, baseUi || {});
    const out = Object.assign({}, baseUi || {}, nextUi);
    if ((baseUi && baseUi.icons) || nextUi.icons) {
      out.icons = Object.assign({}, (baseUi && baseUi.icons) || {}, nextUi.icons || {});
    }
    return out;
  }

  function extractLocaleCfg(loc) {
    const out = Object.assign({}, (loc && loc.config) || {});
    if (loc && loc.title && !out.title) out.title = loc.title;
    if (loc && loc.tts && !out.tts) out.tts = loc.tts;
    return out;
  }

  function mergeTtsDict(a, b) {
    const out = mergeConfigValue(a, b);
    if (isConfigDict(a) && isConfigDict(b)) {
      if (a.speakers || b.speakers) out.speakers = { ...a.speakers, ...b.speakers };
      if (a.pronunciation || b.pronunciation) out.pronunciation = { ...a.pronunciation, ...b.pronunciation };
    }
    return out;
  }

  function isConfigDict(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeConfigValue(base, next) {
    if (next === undefined) return base;
    return isConfigDict(base) && isConfigDict(next) ? { ...base, ...next } : next;
  }

  function checkPronunciationMap(value, field) {
    if (value !== undefined && !isConfigDict(value)) {
      throw new TypeError(`${field} must be an object mapping terms to readings or false`);
    }
  }

  function readLayerTts(layer) {
    const legacy = layer.pronunciation;
    const nested = layer.tts?.pronunciation;
    checkPronunciationMap(legacy, 'pronunciation');
    checkPronunciationMap(nested, 'tts.pronunciation');
    if (legacy === undefined || layer.tts === false) return layer.tts;
    return { ...layer.tts, pronunciation: { ...legacy, ...nested } };
  }

  function mergeOptionalDict(a, b, c) {
    if (!a && !b && !c) return undefined;
    return Object.assign({}, a || {}, b || {}, c || {});
  }

  V.getCfg = function () {
    V.applyConfiguredPresets();
    const lang = V.getActiveLang();
    const loc = (lang && V.locales[lang]) || null;
    const locCfg = extractLocaleCfg(loc);
    const td = V.themeDefaults || {}, vc = V.config || {};
    const pd = V.projectDefaults || {};
    const layers = [pd, td, vc, locCfg];
    const merged = Object.assign({}, ...layers);
    merged.ui = layers.reduce((base, layer) => mergeUiDict(base, layer.ui), undefined);
    const tts = layers.reduce((base, layer) => mergeTtsDict(base, readLayerTts(layer)), undefined);
    if (tts !== undefined) merged.tts = tts;
    for (const key of ['bgm', 'sfx']) {
      if (merged[key] !== undefined) merged[key] = layers.reduce((base, layer) => mergeConfigValue(base, layer[key]), undefined);
    }
    const texts = mergeOptionalDict(mergeOptionalDict(pd.texts, td.texts), vc.texts, loc && loc.texts);
    if (texts) merged.texts = texts;
    const strings = mergeOptionalDict(mergeOptionalDict(pd.strings, td.strings), vc.strings, loc && loc.strings);
    if (strings) merged.strings = strings;
    return merged;
  };
})(globalThis.V = globalThis.V || {});

/* core/01b-i18n.js - 多语言界面字典、画布文案翻译 (V.t / x.t)、多语种配音缓存与语种发现 */
(function (V) {
  const UI_ZH = {
    buffering: '正在准备播放…',
    loading: '正在加载…',
    loadingFailed: '加载失败',
    narrationFailed: '配音加载失败，请重试',
    visualFailed: '画面加载失败，请重试',
    retryPlayback: '重试',
    progressLabel: '播放进度',
    home: '返回主界面',
    startHint: '▶ 点击画面开始播放',
    play: '播放（空格）',
    pause: '暂停（空格）',
    replay: '重播（空格）',
    rate: '播放倍速（{rate}）',
    chapTrigger: '切换章节 / 搜索台词（/）',
    chapHeader: '章节导航',
    sceneFallbackTitle: '第 {n} 幕',
    searchPlaceholder: '搜索台词或章节 ( / )',
    searchAria: '搜索视频台词或章节',
    searchEmpty: '未找到匹配的台词或章节',
    copyTimeTip: '点击复制当前时间点链接 (?t=)',
    copiedTime: '✓ 已复制 {time}',
    subtitles: '字幕',
    subtitleSettings: '字幕设置',
    subtitleShow: '显示字幕',
    subtitleSize: '字号',
    subtitleSmall: '小',
    subtitleMedium: '中',
    subtitleLarge: '大',
    subtitleAlign: '对齐',
    subtitleLeft: '靠左',
    subtitleCenter: '居中',
    soundLabel: '声音设置',
    soundOnTip: '声音设置 {pct}%（M 静音 / ↑↓ 调节音量）',
    soundMutedTip: '声音设置：已静音（M 取消静音 / ↑↓ 调节音量）',
    soundBlockedTip: '声音待开启：点击开启声音',
    soundBgmOnlyTip: '声音设置：仅背景音乐 {pct}%（M 静音 / B 开关配乐）',
    soundNoBgmTip: '声音设置：已关背景乐 {pct}%（M 静音 / B 恢复配乐）',
    volAria: '音量',
    voiceItem: '解说声音',
    bgmItem: '背景音乐',
    muteAllItem: '全部静音',
    muteItem: '静音',
    osdMuted: '已静音',
    osdMutedZero: '已静音 0%',
    osdVol: '音量 {pct}%',
    osdBlocked: '已静音自动播放，点击开启声音',
    osdBgmOn: '背景音乐已开',
    osdBgmOff: '背景音乐已关',
    osdResumed: '已续播 {time}',
    webEnter: '窗口全屏（W）',
    webExit: '退出窗口全屏（W / Esc）',
    fullEnter: '全屏（F）',
    fullExit: '退出全屏（F / Esc）',
    cpContinue: '继续播放',
    sandboxPrefix: '🎮 彩蛋试玩：',
    sandboxActive: '🎮 彩蛋试玩中',
    sandboxBack: '↩ 返回终章',
    pptPrev: '上一页（← / PageUp）',
    pptNext: '下一页（→ / 空格 / 滚轮）',
    pptPageBadge: '第 {cur}/{total} 页',
    pptChapPage: '第 {p} 页',
    copyPageTip: '点击复制当前页链接 (?ppt=1&page=)',
    copiedPage: '✓ 已复制第 {p} 页',
    switchToPpt: '切换为 PPT 演示',
    downloadPptx: '下载 PPTX',
    downloadPptxImage: '图片版',
    downloadPptxEditable: '可编辑版（混合）',
    switchToVideo: '切换为视频播放',
  };

  const UI_ZH_TW = {
    home: '返回主介面',
    startHint: '▶ 點擊畫面開始播放',
    buffering: '正在準備播放…',
    loading: '正在載入…',
    loadingFailed: '載入失敗',
    narrationFailed: '配音載入失敗，請重試',
    visualFailed: '畫面載入失敗，請重試',
    retryPlayback: '重試',
    progressLabel: '播放進度',
    play: '播放（空白鍵）',
    pause: '暫停（空白鍵）',
    replay: '重播（空白鍵）',
    rate: '播放倍速（{rate}）',
    chapTrigger: '切換章節 / 搜尋台詞（/）',
    chapHeader: '章節導覽',
    sceneFallbackTitle: '第 {n} 幕',
    searchPlaceholder: '搜尋台詞或章節 ( / )',
    searchAria: '搜尋影片台詞或章節',
    searchEmpty: '未找到符合的台詞或章節',
    copyTimeTip: '點擊複製目前時間點連結 (?t=)',
    copiedTime: '✓ 已複製 {time}',
    subtitles: '字幕',
    subtitleSettings: '字幕設定',
    subtitleSize: '字級',
    subtitleSmall: '小',
    subtitleMedium: '中',
    subtitleLarge: '大',
    subtitleAlign: '對齊',
    subtitleLeft: '靠左',
    subtitleCenter: '置中',
    soundLabel: '聲音設定',
    soundOnTip: '聲音設定 {pct}%（M 靜音 / ↑↓ 調節音量）',
    soundMutedTip: '聲音設定：已靜音（M 取消靜音 / ↑↓ 調節音量）',
    soundBlockedTip: '聲音待開啟：點擊開啟聲音',
    soundBgmOnlyTip: '聲音設定：僅背景音樂 {pct}%（M 靜音 / B 開關配樂）',
    soundNoBgmTip: '聲音設定：已關背景樂 {pct}%（M 靜音 / B 恢復配樂）',
    volAria: '音量',
    voiceItem: '解說聲音',
    bgmItem: '背景音樂',
    muteAllItem: '全部靜音',
    muteItem: '靜音',
    osdMuted: '已靜音',
    osdMutedZero: '已靜音 0%',
    osdVol: '音量 {pct}%',
    osdBlocked: '已靜音自動播放，點擊開啟聲音',
    osdBgmOn: '背景音樂已開',
    osdBgmOff: '背景音樂已關',
    osdResumed: '已續播 {time}',
    webEnter: '視窗全螢幕（W）',
    webExit: '退出視窗全螢幕（W / Esc）',
    fullEnter: '全螢幕（F）',
    fullExit: '退出全螢幕（F / Esc）',
    cpContinue: '繼續播放',
    sandboxPrefix: '🎮 互動試玩：',
    sandboxActive: '🎮 互動試玩中',
    sandboxBack: '↩ 返回終章',
    pptPrev: '上一頁（← / PageUp）',
    pptNext: '下一頁（→ / 空白鍵 / 滾輪）',
    pptPageBadge: '第 {cur}/{total} 頁',
    pptChapPage: '第 {p} 頁',
    copyPageTip: '點擊複製目前頁連結 (?ppt=1&page=)',
    copiedPage: '✓ 已複製第 {p} 頁',
    switchToPpt: '切換為 PPT 簡報',
    downloadPptx: '下載 PPTX',
    downloadPptxImage: '圖片版',
    downloadPptxEditable: '可編輯版（混合）',
    switchToVideo: '切換為影片播放',
  };

  const UI_EN = {
    home: 'Back to Home',
    startHint: '▶ Click to play',
    buffering: 'Preparing playback…',
    loading: 'Loading…',
    loadingFailed: 'Loading failed',
    narrationFailed: 'Narration failed to load. Please retry.',
    visualFailed: 'Visuals failed to load. Please retry.',
    retryPlayback: 'Retry',
    progressLabel: 'Playback position',
    play: 'Play (Space)',
    pause: 'Pause (Space)',
    replay: 'Replay (Space)',
    rate: 'Playback Speed ({rate})',
    chapTrigger: 'Chapters / Search (/)',
    chapHeader: 'CHAPTERS',
    sceneFallbackTitle: 'Scene {n}',
    searchPlaceholder: 'Search transcript or chapters ( / )',
    searchAria: 'Search transcript or chapters',
    searchEmpty: 'No matching lines or chapters',
    copyTimeTip: 'Click to copy link at current time (?t=)',
    copiedTime: '✓ Copied {time}',
    subtitles: 'Subtitles',
    subtitleSettings: 'Subtitle settings',
    subtitleShow: 'Show subtitles',
    subtitleSize: 'Font size',
    subtitleSmall: 'Small',
    subtitleMedium: 'Medium',
    subtitleLarge: 'Large',
    subtitleAlign: 'Alignment',
    subtitleLeft: 'Left',
    subtitleCenter: 'Center',
    soundLabel: 'Sound Settings',
    soundOnTip: 'Sound {pct}% (M Mute / ↑↓ Volume)',
    soundMutedTip: 'Muted (M Unmute / ↑↓ Volume)',
    soundBlockedTip: 'Autoplay muted: Click to enable sound',
    soundBgmOnlyTip: 'BGM Only {pct}% (M Mute / B Toggle BGM)',
    soundNoBgmTip: 'BGM Off {pct}% (M Mute / B Restore BGM)',
    volAria: 'Volume',
    voiceItem: 'Narration',
    bgmItem: 'Music (BGM)',
    muteAllItem: 'Mute All',
    muteItem: 'Mute',
    osdMuted: 'Muted',
    osdMutedZero: 'Muted 0%',
    osdVol: 'Volume {pct}%',
    osdBlocked: 'Autoplay muted, click for sound',
    osdBgmOn: 'BGM On',
    osdBgmOff: 'BGM Off',
    osdResumed: 'Resumed {time}',
    webEnter: 'Window Fullscreen (W)',
    webExit: 'Exit Window Fullscreen (W / Esc)',
    fullEnter: 'Fullscreen (F)',
    fullExit: 'Exit Fullscreen (F / Esc)',
    cpContinue: 'Continue',
    sandboxPrefix: '🎮 Interactive: ',
    sandboxActive: '🎮 Interactive Mode',
    sandboxBack: '↩ Back to Finale',
    pptPrev: 'Previous Slide (← / PageUp)',
    pptNext: 'Next Slide (→ / Space / Wheel)',
    pptPageBadge: 'Slide {cur}/{total}',
    pptChapPage: 'P.{p}',
    copyPageTip: 'Click to copy slide link (?ppt=1&page=)',
    copiedPage: '✓ Copied Slide {p}',
    switchToPpt: 'Switch to Slide Deck',
    downloadPptx: 'Download PPTX',
    downloadPptxImage: 'Image slides',
    downloadPptxEditable: 'Editable slides (hybrid)',
    switchToVideo: 'Switch to Video Mode',
  };

  const NATIVE_LANG_LABELS = {
    zh: '中文', 'zh-cn': '简体中文', 'zh-hans': '简体中文',
    'zh-tw': '繁體中文', 'zh-hk': '繁體中文', 'zh-hant': '繁體中文',
    en: 'English', 'en-us': 'English', 'en-gb': 'English (UK)',
    ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch',
    es: 'Español', pt: 'Português', ru: 'Русский', ar: 'العربية',
  };

  function interpolateVars(tpl, vars) {
    const str = String(tpl == null ? '' : tpl);
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
  }

  function pickBuiltInUiTable(lang) {
    const low = String(lang || '').toLowerCase();
    if (/^zh[-_](?:tw|hk|mo|hant)(?:$|[-_])/.test(low)) return UI_ZH_TW;
    if (!low || /^zh(?:$|[-_])/.test(low)) return UI_ZH;
    return UI_EN;
  }

  function resolveCustomUiStr(lang, key) {
    const loc = lang && V.locales ? V.locales[lang] : null;
    if (loc && loc.uiStrings && loc.uiStrings[key] !== undefined) return loc.uiStrings[key];
    const cfgUi = V.config && V.config.uiStrings;
    return cfgUi ? cfgUi[key] : undefined;
  }

  V.uiStr = function (key, vars) {
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    const custom = resolveCustomUiStr(lang, key);
    if (custom !== undefined) return interpolateVars(custom, vars);
    const effLang = lang || (V.getBaseLang ? V.getBaseLang() : '') || 'zh-CN';
    const table = pickBuiltInUiTable(effLang);
    return interpolateVars(table[key] || UI_ZH[key] || key, vars);
  };

  function resolveSceneLocDict(lang, sceneIdx) {
    const scenes = lang && V.locales && V.locales[lang] && V.locales[lang].scenes;
    if (!scenes || sceneIdx == null || sceneIdx < 0) return null;
    const sc = V.scenes && V.scenes[sceneIdx];
    return (sc && sc.id && scenes[sc.id]) || scenes[sceneIdx] || null;
  }

  function lookupDictKey(obj, key) {
    if (!obj) return undefined;
    if (obj.texts && obj.texts[key] !== undefined) return obj.texts[key];
    return obj.strings ? obj.strings[key] : undefined;
  }

  function lookupTranslatedEntry(lang, sceneIdx, key) {
    const scHit = lookupDictKey(resolveSceneLocDict(lang, sceneIdx), key);
    if (scHit !== undefined) return scHit;
    const cfg = V.getCfg ? V.getCfg() : (V.config || {});
    return lookupDictKey(cfg, key);
  }

  V.t = function (key, fallback, vars, sceneIdx) {
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    const idx = sceneIdx === undefined ? V._currentSceneIdx : sceneIdx;
    const val = lookupTranslatedEntry(lang, idx, key);
    if (val !== undefined) return interpolateVars(val, vars);
    return interpolateVars(fallback !== undefined ? fallback : key, vars);
  };

  function hasActiveTextLocalization(root) {
    if (root._i18nTouched) return true;
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    if (lang && V.locales && V.locales[lang]) return true;
    if (V.isSecondaryLocale && V.isSecondaryLocale(lang)) return true;
    const vc = V.config || {};
    return Boolean(vc.texts || vc.strings);
  }

  function localizeKeyedElements(root, sceneIdx) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      if (el._i18nOrig === undefined) el._i18nOrig = el.textContent;
      el.textContent = V.t(key, el._i18nOrig, null, sceneIdx);
    }
  }

  function shouldSkipTextNodeParent(parent) {
    if (!parent) return false;
    const tag = parent.tagName;
    return tag === 'SCRIPT' || tag === 'STYLE' || parent.hasAttribute('data-i18n');
  }

  function applyLiteralTextNode(node, lang, sceneIdx) {
    if (shouldSkipTextNodeParent(node.parentElement)) return;
    if (node._i18nOrig === undefined) node._i18nOrig = node.nodeValue || '';
    const orig = node._i18nOrig;
    const trimmed = orig.trim();
    if (!trimmed) return;
    const hit = lookupTranslatedEntry(lang, sceneIdx, trimmed);
    if (hit === undefined) {
      if (node.nodeValue !== orig) node.nodeValue = orig;
      return;
    }
    const at = orig.indexOf(trimmed);
    node.nodeValue = orig.slice(0, at) + String(hit) + orig.slice(at + trimmed.length);
  }

  function localizeLiteralTextNodes(root, lang, sceneIdx) {
    if (typeof document === 'undefined' || !document.createTreeWalker) return;
    const walker = document.createTreeWalker(root, 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      applyLiteralTextNode(n, lang, sceneIdx);
    }
  }

  V.localizeDom = function (root, sceneIdx) {
    if (!root || !root.querySelectorAll || !hasActiveTextLocalization(root)) return;
    root._i18nTouched = true;
    const idx = sceneIdx === undefined ? V._currentSceneIdx : sceneIdx;
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    localizeKeyedElements(root, idx);
    localizeLiteralTextNodes(root, lang, idx);
  };

  V.captureVoice = function (voiceObj = V.voice) {
    if (!voiceObj || typeof voiceObj !== 'object') return;
    const key = voiceObj.lang || (V.getBaseLang && V.getBaseLang()) || '_base';
    V.voices[key] = voiceObj;
    if (!voiceObj.lang) V.voices._base = voiceObj;
  };

  V.activateCachedVoice = function (lang) {
    V.captureVoice(V.voice);
    const isSec = V.isSecondaryLocale ? V.isSecondaryLocale(lang) : Boolean(lang);
    if (!isSec) {
      const baseKey = (V.getBaseLang && V.getBaseLang()) || '_base';
      V.voice = V.voices[baseKey] || V.voices._base || (V.isVoiceLocaleMatch(V.voice) ? V.voice : null);
      return Boolean(V.voice);
    }
    V.voice = V.voices[lang] || (V.isVoiceLocaleMatch(V.voice) ? V.voice : null);
    return Boolean(V.voice);
  };

  function resolveLocaleLabel(code, explicitLabel) {
    if (explicitLabel) return String(explicitLabel);
    const loc = V.locales && V.locales[code];
    if (loc && loc.label) return String(loc.label);
    return NATIVE_LANG_LABELS[String(code || '').toLowerCase()] || String(code);
  }

  function normalizeLocaleEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return { code: raw, label: resolveLocaleLabel(raw) };
    if (raw.code) return { code: String(raw.code), label: resolveLocaleLabel(raw.code, raw.label || raw.name) };
    return null;
  }

  V.getAvailableLocales = function () {
    const out = [], seen = new Set();
    const push = entry => {
      if (!entry || !entry.code) return;
      const k = entry.code.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(entry);
    };
    const baseCode = (V.getBaseLang && V.getBaseLang()) || 'zh-CN';
    const cfgList = (V.config && Array.isArray(V.config.locales)) ? V.config.locales : [];
    const regKeys = Object.keys(V.locales || {});
    if (cfgList.length || regKeys.length) push(normalizeLocaleEntry(baseCode));
    cfgList.forEach(item => push(normalizeLocaleEntry(item)));
    regKeys.forEach(code => push(normalizeLocaleEntry(code)));
    return out;
  };

  V.isRtlLang = function (lang = V.getActiveLang()) {
    const loc = lang && V.locales && V.locales[lang];
    if (loc && loc.dir) return loc.dir === 'rtl';
    return /^(ar|he|fa|ur)\b/i.test(String(lang || ''));
  };

  V.syncDocLangAttrs = function () {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const lang = (V.getActiveLang && V.getActiveLang()) || (V.getBaseLang && V.getBaseLang()) || 'zh-CN';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', V.isRtlLang(lang) ? 'rtl' : 'ltr');
  };
})(globalThis.V = globalThis.V || {});

/* core/02-math.js · 纯函数插值、缓动与时间窗口数学原语 */
(function (V) {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));

  const ease = {
    out: k => 1 - Math.pow(1 - k, 3),
    in: k => k * k * k,
    io: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    back: k => {
      const c = 1.6;
      return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
    },
  };

  const appear = (t, a, d = 0.45) => ease.out(prog(t, a, a + d));
  const win = (t, a, b, d = 0.35) => Math.min(appear(t, a, d), 1 - ease.in(prog(t, b, b + d)));

  function stagger(count, index, t, start, span = 0.6, dur = 0.4) {
    const step = count > 1 ? span / (count - 1) : 0;
    return appear(t, start + index * step, dur);
  }

  const KF_META = new Set(['at', 'dur', 'ease', 'switchAt']);

  function seedKeyframeState(stops, init) {
    if (init) return Object.assign({}, init);
    const state = {};
    for (const [key, val] of Object.entries(stops[0] || {})) {
      if (!KF_META.has(key) && val !== undefined) state[key] = val;
    }
    return state;
  }

  function blendKeyframeProp(state, key, val, k, snap) {
    if (typeof val === 'number' && typeof state[key] === 'number') state[key] = lerp(state[key], val, k);
    else if (snap || state[key] === undefined) state[key] = val;
  }

  function applyKeyframeStop(state, kf, t, defDur, defEase) {
    const d = kf.dur === undefined ? defDur : kf.dur;
    const rawK = d <= 0 ? (t >= kf.at ? 1 : 0) : prog(t, kf.at, kf.at + d);
    if (rawK <= 0) return;
    const fn = ease[kf.ease || defEase] || ease.io;
    const k = fn(rawK);
    const snap = d <= 0 || rawK >= (kf.switchAt === undefined ? 0.5 : kf.switchAt);
    for (const [key, val] of Object.entries(kf)) {
      if (!KF_META.has(key) && val !== undefined) blendKeyframeProp(state, key, val, k, snap);
    }
  }

  function keyframes(t, stops = [], opts = {}) {
    if (!stops || !stops.length) return Object.assign({}, opts.init || {});
    const state = seedKeyframeState(stops, opts.init);
    const defDur = opts.dur === undefined ? 0.5 : opts.dur;
    const defEase = opts.ease || 'io';
    for (let i = opts.init ? 0 : 1; i < stops.length; i++) {
      if (stops[i] && stops[i].at != null) applyKeyframeStop(state, stops[i], t, defDur, defEase);
    }
    return state;
  }

  V.u = Object.assign(V.u || {}, { clamp, lerp, prog, ease, appear, win, stagger, keyframes });
})(globalThis.V = globalThis.V || {});

/* core/03-dom.js · 轻量 DOM/SVG 构造、运镜、仿真光标与确定性受控 <video> 切片原语 */
(function (V) {
  const { clamp, lerp, prog, ease, appear, keyframes } = V.u;
  const styleCache = new WeakMap();

  function attr(el, name, value) {
    const text = String(value);
    if (el.getAttribute(name) !== text) el.setAttribute(name, text);
  }

  function writeStyle(el, property, value) {
    let values = styleCache.get(el);
    if (!values) { values = {}; styleCache.set(el, values); }
    const cached = values[property] || (values[property] = {});
    const input = String(value);
    if (cached.input === input && cached.applied === el.style[property]) return;
    el.style[property] = value;
    cached.input = input;
    cached.applied = el.style[property];
  }

  function applyAttr(el, k, val) {
    if (k === 'class') el.className = val;
    else if (k === 'html') el.innerHTML = val;
    else if (k === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (k === 'style') el.style.cssText = val;
    else el.setAttribute(k, val);
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, val] of Object.entries(attrs)) {
        if (val != null && val !== false) applyAttr(el, k, val);
      }
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svg(markup, attrs = '') {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" ' + attrs + '>' + markup + '</svg>';
    return wrap.firstChild;
  }

  function formatScale(s, sx, sy) {
    if (sx === undefined && sy === undefined) return `scale(${s})`;
    return `scale(${sx === undefined ? s : sx},${sy === undefined ? s : sy})`;
  }

  function pickOpt(opts, shortKey, longKey, fallback) {
    if (opts[shortKey] !== undefined) return opts[shortKey];
    if (opts[longKey] !== undefined) return opts[longKey];
    return fallback;
  }

  function set(el, opts = {}) {
    if (!el) return;
    const o = pickOpt(opts, 'o', 'opacity', undefined);
    const s = pickOpt(opts, 's', 'scale', 1);
    const r = pickOpt(opts, 'r', 'rotate', 0);
    const { x = 0, y = 0, sx, sy, origin } = opts;
    if (o !== undefined) {
      writeStyle(el, 'opacity', o);
      writeStyle(el, 'visibility', o <= 0.001 ? 'hidden' : 'visible');
    }
    writeStyle(el, 'transform', `translate(${x}px,${y}px) ${formatScale(s, sx, sy)} rotate(${r}deg)`);
    if (origin) writeStyle(el, 'transformOrigin', origin);
  }

  function pop(el, k, { dy = 24, s0 = 0.96 } = {}) {
    set(el, { o: k, y: (1 - k) * dy, s: lerp(s0, 1, k) });
  }

  function typeText(el, text, k) {
    if (!el) return false;
    const chars = Array.from(text);
    const n = Math.round(chars.length * clamp(k));
    const out = chars.slice(0, n).join('');
    if (el._typed !== out) { el.textContent = out; el._typed = out; }
    return n < chars.length;
  }

  function type(el, text, k, t = 0, cursorOn = false) {
    if (!el) return;
    const chars = Array.from(text);
    const n = Math.floor(chars.length * clamp(k));
    const showCur = cursorOn && (n < chars.length || Math.floor((t || 0) * 2.5) % 2 === 0);
    const out = chars.slice(0, n).join('') + (showCur ? '_' : '');
    if (el._ty !== out) { el.textContent = out; el._ty = out; }
  }

  const scramble = (el, text, k, t = 0) => type(el, text, k, t, false);

  function formatNumber(v, fmt) {
    if (typeof fmt === 'function') return fmt(v);
    if (typeof fmt === 'number') return v.toFixed(fmt);
    return String(Math.round(v));
  }

  function countUp(el, from, to, k, fmt) {
    if (!el) return;
    const out = formatNumber(lerp(from, to, clamp(k)), fmt);
    if (el._cu !== out) { el.textContent = out; el._cu = out; }
  }

  function drawPath(el, k) {
    if (!el) return;
    if (el._pathLen == null) {
      el._pathLen = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 1000;
      el.style.strokeDasharray = String(el._pathLen);
    }
    el.style.strokeDashoffset = String(el._pathLen * (1 - clamp(k)));
  }

  function toggle(el, cls, on) {
    if (el) el.classList.toggle(cls, Boolean(on));
  }

  function playInteractiveSfx(sfxSpec) {
    if (!sfxSpec || !V.sfx) return;
    V.sfx(sfxSpec === true ? 'click' : sfxSpec);
  }

  function bindInteractiveEvent(el, type, fn, sfxSpec) {
    if (typeof fn !== 'function') return;
    el.addEventListener(type, e => {
      if (type === 'click' || type === 'dblclick') {
        e.stopPropagation();
        playInteractiveSfx(sfxSpec);
      }
      fn.call(el, e, el);
    });
  }

  function resolveInteractiveSfx(handlers, opts) {
    if (opts && opts.sfx !== undefined) return opts.sfx;
    return handlers && typeof handlers === 'object' ? handlers.sfx : undefined;
  }

  function bindInteractiveKeyboard(el) {
    if (!el.matches('button, input, select, textarea, a[href]')) {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      el.addEventListener('keydown', e => {
        if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault(); e.stopPropagation();
        if (el.getAttribute('aria-disabled') !== 'true') el.click();
      });
    }
  }

  function interactive(el, handlers, opts) {
    if (!el) return el;
    if (el.setAttribute) el.setAttribute('data-interactive', '1');
    if (el.style && !el.style.pointerEvents) el.style.pointerEvents = 'auto';
    const sfxSpec = resolveInteractiveSfx(handlers, opts);
    if (typeof handlers === 'function' || typeof handlers?.click === 'function') bindInteractiveKeyboard(el);
    if (typeof handlers === 'function') {
      bindInteractiveEvent(el, 'click', handlers, sfxSpec);
    } else if (handlers && typeof handlers === 'object') {
      for (const [k, fn] of Object.entries(handlers)) {
        if (k !== 'sfx') bindInteractiveEvent(el, k, fn, sfxSpec);
      }
    }
    return el;
  }

  function toIndexList(activeIdx) {
    if (Array.isArray(activeIdx)) return activeIdx;
    return activeIdx != null && activeIdx >= 0 ? [activeIdx] : null;
  }

  function spotlight(els, activeIdx, focusCls = 'is-focus', dimCls = 'is-dim') {
    if (!els) return;
    const fSet = toIndexList(activeIdx);
    els.forEach((el, i) => {
      toggle(el, focusCls, fSet ? fSet.includes(i) : false);
      toggle(el, dimCls, fSet ? !fSet.includes(i) : false);
    });
  }

  function initCameraState(opts, cx, cy) {
    return {
      x: opts.x0 === undefined ? cx : opts.x0,
      y: opts.y0 === undefined ? cy : opts.y0,
      zoom: opts.zoom0 === undefined ? 1 : opts.zoom0,
      r: opts.r0 || 0,
    };
  }

  function applyCameraDom(el, st, cx, cy) {
    if (!el || !el.style) return;
    el.style.transformOrigin = '0 0';
    const tx = (cx - st.x * st.zoom).toFixed(2);
    const ty = (cy - st.y * st.zoom).toFixed(2);
    const rot = st.r ? ` rotate(${st.r.toFixed(2)}deg)` : '';
    el.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${st.zoom.toFixed(4)})${rot}`;
  }

  function camera(el, t, stops = [], opts = {}) {
    const cx = opts.cx === undefined ? (V.stageWidth || 1920) / 2 : opts.cx;
    const cy = opts.cy === undefined ? (V.stageHeight || 1080) / 2 : opts.cy;
    const st = keyframes(t, stops, {
      init: initCameraState(opts, cx, cy),
      dur: opts.dur === undefined ? 0.55 : opts.dur,
      ease: 'io',
    });
    applyCameraDom(el, st, cx, cy);
    return st;
  }

  const CURSOR_SVG = '<path d="M4 3.5L21.5 11.5L13.2 14.1L9.8 22L4 3.5Z" fill="#1E293B" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>';

  function makeCursor(parent, opts = {}) {
    const ring = h('i', { class: 'v-cursor-ring' });
    const body = svg(opts.svg || CURSOR_SVG, 'class="v-cursor-body" viewBox="0 0 26 26"');
    const el = h('div', { class: 'v-cursor ' + (opts.cls || '') }, ring, body);
    el._body = body;
    el._ring = ring;
    if (parent && parent.append) parent.append(el);
    return el;
  }

  function applyCursorStep(state, st, t) {
    const dur = st.dur === undefined ? 0.42 : st.dur;
    const mk = dur <= 0 ? (t >= st.at ? 1 : 0) : ease.io(prog(t, st.at, st.at + dur));
    if (mk > 0) {
      if (st.x != null) state.x = lerp(state.x, st.x, mk);
      if (st.y != null) state.y = lerp(state.y, st.y, mk);
    }
    if (st.click) {
      const cAt = st.clickAt === undefined ? st.at + dur : st.clickAt;
      applyCursorClick(state, t, cAt);
    }
    if (st.hide) state.vis *= 1 - appear(t, st.at, st.dur === undefined ? 0.25 : st.dur);
  }

  function applyCursorClick(state, t, cAt) {
    if (t < cAt || t > cAt + 0.45) return;
    const pk = prog(t, cAt, cAt + 0.22);
    if (pk < 1) state.pressS = Math.min(state.pressS, 1 - 0.18 * Math.sin(Math.PI * pk));
    const rk = prog(t, cAt, cAt + 0.42);
    state.ringS = lerp(0.35, 2.15, ease.out(rk));
    state.ringO = Math.max(state.ringO, (1 - rk) * 0.85);
  }

  function cursor(el, t, steps = [], opts = {}) {
    if (!el || !steps.length) return { x: 0, y: 0, o: 0 };
    const s0 = steps[0];
    const st = {
      x: s0.x === undefined ? 960 : s0.x,
      y: s0.y === undefined ? 540 : s0.y,
      vis: appear(t, opts.enterAt === undefined ? s0.at || 0 : opts.enterAt, 0.22),
      pressS: 1,
      ringS: 0.3,
      ringO: 0,
    };
    if (opts.leaveAt != null) st.vis *= 1 - appear(t, opts.leaveAt, 0.25);
    for (let i = 1; i < steps.length; i++) {
      if (steps[i]) applyCursorStep(st, steps[i], t);
    }
    if (s0.click) applyCursorClick(st, t, s0.clickAt === undefined ? (s0.at || 0) + 0.25 : s0.clickAt);
    renderCursorDom(el, st);
    return { x: st.x, y: st.y, o: st.vis };
  }

  function renderCursorDom(el, st) {
    set(el, { o: st.vis, x: st.x, y: st.y, s: 1 });
    toggle(el, 'is-clicking', st.ringO > 0.01);
    const body = el._body;
    const ring = el._ring;
    if (body && body.style) body.style.transform = `scale(${st.pressS.toFixed(3)})`;
    if (ring && ring.style) {
      ring.style.opacity = String(st.ringO.toFixed(3));
      ring.style.transform = `scale(${st.ringS.toFixed(3)})`;
    }
  }

  // 受控嵌入式 <video> 切片原语：支持预览同步与录制态逐帧解码锁定
  function videoClip(src, opts = {}) {
    const el = h('video', {
      class: 'v-videoclip ' + (opts.cls || ''),
      src,
      preload: 'auto',
      muted: true,
      playsinline: 'true',
      style: opts.style || '',
    });
    el.muted = true;
    el._vclip = {
      src,
      start: opts.start || 0,
      trim: opts.trim || 0,
      speed: opts.speed || 1,
      loop: Boolean(opts.loop),
      volume: opts.volume || 0,
      targetTime: opts.trim || 0,
    };
    el.addEventListener('loadedmetadata', () => {
      const meta = el._vclip;
      if (!el.isConnected || !meta || meta._lastLt === undefined) return;
      syncVideoClip(el, meta._lastLt, !el.paused);
    });
    V._videoClips.add(el);
    return el;
  }

  function resolveClipPlaybackTarget(el, meta, lt) {
    const rawTarget = meta.trim + Math.max(0, (lt - meta.start) * meta.speed);
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    const endedClip = Boolean(dur && !meta.loop && rawTarget >= dur - 0.015);
    const target = dur && meta.loop ? (rawTarget % dur) : (dur ? Math.min(rawTarget, dur - 0.01) : rawTarget);
    return { target: Math.max(0, target), endedClip };
  }

  function syncVideoClip(el, lt, playing) {
    if (!el || !el._vclip) return;
    const meta = el._vclip;
    meta._lastLt = lt;
    const usePlaying = playing === undefined ? Boolean(V._isPlaying) : Boolean(playing);
    meta._syncedTick = V._renderTick || 0;
    const { target, endedClip } = resolveClipPlaybackTarget(el, meta, lt);
    meta.targetTime = target;
    if (typeof el.pause !== 'function') return;
    syncBrowserVideoTime(el, meta, lt >= meta.start && !endedClip && usePlaying);
  }

  function toggleBrowserVideoPlay(el, shouldPlay) {
    if (shouldPlay && !V._isRecord) {
      if (!el.paused) return;
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }
    if (!el.paused) el.pause();
  }

  function syncBrowserVideoTime(el, meta, shouldPlay) {
    // 暂停与录制必须准确换帧；连续播放保留容差，避免反复打断解码。
    const tol = shouldPlay && !V._isRecord ? 0.16 : 0.000001;
    const diff = Math.abs((el.currentTime || 0) - meta.targetTime);
    if (diff > tol && el.readyState >= 1) {
      try { el.currentTime = meta.targetTime; } catch {}
    }
    el.playbackRate = meta.speed * (V._playbackRate || 1);
    toggleBrowserVideoPlay(el, shouldPlay);
  }

  V.u = Object.assign(V.u || {}, {
    h, svg, attr, set, pop, typeText, type, scramble, countUp,
    drawPath, toggle, interactive, spotlight, camera, makeCursor, cursor,
    videoClip, syncVideoClip,
  });
})(globalThis.V = globalThis.V || {});

(function (V) {
  const COMMON_ZH = {
    重编排: '崇编排', 重算: '崇算', 重放: '崇放', 重写: '崇写', 重构: '崇构',
    执行: '直形', 运行: '运形', 并行: '并形', 例行: '例形', 先行: '先形',
    进行: '进形', 自行: '自形', 推行: '推形', 实行: '实形', 放行: '放形',
    命令行: '命令航', 一行行: '一航航',
  };
  const PAUSE_MARKS = /[，、；：。！？]/g;
  const ASCII_TOKEN = /[A-Za-z0-9][A-Za-z0-9_@.+%:/#?=&-]*/g;

  function escapeTerm(term) {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function phrasePattern(term) {
    const left = /^[a-z0-9_]/i.test(term) ? '(?<![a-zA-Z_])' : '';
    const right = /[a-z0-9_]$/i.test(term) ? '(?![a-zA-Z0-9_])' : '';
    return left + escapeTerm(term) + right;
  }

  function compilePronunciation(cfg, lang) {
    const common = cfg.tts?.polyphoneFix !== false && (!lang || /^zh(?:[-_]|$)/i.test(lang));
    const dict = { ...(common ? COMMON_ZH : {}), ...cfg.tts?.pronunciation };
    const terms = Object.keys(dict);
    for (const term of terms) {
      if (!term.trim() || (typeof dict[term] !== 'string' && dict[term] !== false)) {
        throw new TypeError(`Invalid tts.pronunciation entry ${JSON.stringify(term)}: expected a nonempty term and a string reading or false`);
      }
    }
    terms.sort((a, b) => b.length - a.length);
    const pattern = terms.length ? new RegExp(terms.map(phrasePattern).join('|'), 'g') : null;
    return raw => {
      const text = String(raw ?? '');
      const spoken = pattern ? text.replace(pattern, term => dict[term] === false ? term : dict[term]) : text;
      return common ? spoken.replace(/[“”‘’《》]/g, '') : spoken;
    };
  }

  function withoutPauseMarks(text) {
    return text.replace(PAUSE_MARKS, '');
  }

  function asciiTokens(text) {
    return (text.match(ASCII_TOKEN) || []).join('\0');
  }

  function resolveLineSpeech(line, speak, location) {
    const text = String(line.text ?? '');
    const override = line.speechText;
    if (override === undefined || override === text) return speak(text);
    if (typeof override !== 'string' || withoutPauseMarks(override) !== withoutPauseMarks(text) ||
        asciiTokens(override) !== asciiTokens(text)) {
      throw new TypeError(`${location}: speechText may only change Chinese punctuation outside letters, numbers and codes`);
    }
    const spoken = speak(override);
    if (withoutPauseMarks(spoken) !== withoutPauseMarks(speak(text))) {
      throw new TypeError(`${location}: speechText must not break a configured pronunciation term`);
    }
    return spoken;
  }

  V._speechKey = text => String(text || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  V._createSpeech = function (cfg = V.getCfg(), lang = V.getActiveLang()) {
    const speak = compilePronunciation(cfg, lang);
    return { speak, key: V._speechKey, line: (line, location) => resolveLineSpeech(line, speak, location) };
  };
})(globalThis.V = globalThis.V || {});

/* core/04-timeline.js · 时间轴排布、句内语义词锚 (x.at)、多语言覆盖与 30Hz 语音振幅包络采样 */
(function (V) {
  const { clamp } = V.u;
  const DEFAULT_CPS = 5.4, DEFAULT_GAP = 0.22, DEFAULT_LEAD = 0.35, DEFAULT_TAIL = 0.38;

  function getPacing(cfg) {
    return {
      CPS: cfg.cps === undefined ? DEFAULT_CPS : cfg.cps,
      GAP: cfg.gap === undefined ? DEFAULT_GAP : cfg.gap,
      LEAD: cfg.lead === undefined ? DEFAULT_LEAD : cfg.lead,
      TAIL: cfg.tail === undefined ? DEFAULT_TAIL : cfg.tail,
    };
  }

  const CJK_CHAR_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff01-\uff60]/;
  const CJK_GLOBAL_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff01-\uff60]/g;
  const WORD_GLOBAL_RE = /[\p{L}\p{N}][\p{L}\p{N}.'\-]*/gu;

  function weight(s) {
    const str = String(s || '');
    const cjk = str.match(CJK_GLOBAL_RE) || [];
    const nonCjk = str.replace(CJK_GLOBAL_RE, ' ');
    const words = nonCjk.match(WORD_GLOBAL_RE) || [];
    let w = words.length * 1.5;
    for (const ch of cjk) {
      w += /[，。、：；！？“”‘’（）《》—…]/.test(ch) ? 0.45 : 1;
    }
    const rest = nonCjk.replace(WORD_GLOBAL_RE, '').replace(/\s/g, '');
    for (const ch of rest) {
      w += /[,!?:;"'()\-—…]/.test(ch) ? 0.45 : 0.7;
    }
    return w;
  }

  const normKey = V._speechKey;

  function findNth(haystack, needle, nth = 1) {
    if (!needle) return -1;
    let idx = -1, from = 0;
    for (let i = 0; i < nth; i++) {
      idx = haystack.indexOf(needle, from);
      if (idx < 0) return -1;
      from = idx + Math.max(1, needle.length);
    }
    return idx;
  }

  function recordAnchorError(entry) {
    if (!Array.isArray(V.__anchorErrors)) return;
    const key = `${entry.scene}|${entry.lineIdx}|${entry.keyword}|${entry.reason}`;
    if (!V.__anchorErrorKeys) V.__anchorErrorKeys = new Set();
    if (V.__anchorErrorKeys.has(key)) return;
    V.__anchorErrorKeys.add(key);
    V.__anchorErrors.push(entry);
  }

  function parseAnchorOpts(optsOrOffset) {
    if (typeof optsOrOffset === 'number') return { nth: 1, offset: optsOrOffset };
    if (!optsOrOffset) return { nth: 1, offset: 0 };
    return { nth: optsOrOffset.nth || 1, offset: optsOrOffset.offset || 0 };
  }

  function matchWordBoundary(words, needle, nth) {
    let acc = '';
    const spans = words.map(([t0, w]) => {
      const s = acc.length;
      acc += normKey(w);
      return { t0, s, e: acc.length };
    });
    const pos = findNth(acc, needle, nth);
    if (pos < 0) return null;
    const hit = spans.find(sp => sp.e > pos) || spans[0];
    return hit ? hit.t0 : null;
  }

  function estimateCharAnchor(rawText, needle, nth, dur) {
    let charAcc = '', rawPos = 0;
    const charMap = [];
    for (const ch of rawText) {
      const k = normKey(ch);
      for (let j = 0; j < k.length; j++) charMap.push(rawPos);
      charAcc += k;
      rawPos += ch.length;
    }
    const pos = findNth(charAcc, needle, nth);
    if (pos < 0) return null;
    const rawIdx = charMap[pos] || 0;
    const ratio = weight(rawText.slice(0, rawIdx)) / Math.max(1, weight(rawText));
    return ratio * dur;
  }

  function resolveLocalizedKeyword(sc, lineIdx, keyword) {
    const ln = sc.lines && sc.lines[lineIdx];
    const map = ln && ln.anchors;
    return (map && map[keyword]) || keyword;
  }

  function lookupLineWords(si, lineIdx) {
    const vv = V.getActiveVoice ? V.getActiveVoice() : V.voice;
    const w = vv && vv.words;
    return (w && w[si] && w[si][lineIdx]) || null;
  }

  function warnBrokenAnchor(si, sc, lineIdx, keyword, text) {
    const msg = `Broken anchor keyword "${keyword}" not found in line: "${text}"`;
    recordAnchorError({ scene: si, title: sc.title, lineIdx, keyword: String(keyword), reason: msg });
    if (typeof console !== 'undefined' && console.warn) console.warn(`[V.at] S${si}L${lineIdx}: ${msg}`);
  }

  function resolveAnchor(sc, si, lineIdx, keyword, optsOrOffset) {
    const cue = sc.cues[lineIdx];
    if (!cue) {
      recordAnchorError({ scene: si, title: sc.title, lineIdx, keyword: String(keyword || ''), reason: `Line index ${lineIdx} out of range (lines=${sc.cues.length})` });
      return 0;
    }
    const { nth, offset } = parseAnchorOpts(optsOrOffset);
    const needle = normKey(resolveLocalizedKeyword(sc, lineIdx, keyword));
    if (!needle) return Math.max(0, cue.start + offset);

    const words = lookupLineWords(si, lineIdx);
    const wb = words && words.length ? matchWordBoundary(words, needle, nth) : null;
    if (wb != null) return Math.max(0, cue.start + wb + offset);

    const est = estimateCharAnchor(cue.text || '', needle, nth, cue.end - cue.start);
    if (est == null) {
      warnBrokenAnchor(si, sc, lineIdx, keyword, cue.text || '');
      return Math.max(0, cue.start + offset);
    }
    return Math.max(0, cue.start + est + offset);
  }

  function makeCtx(sc, si) {
    return {
      cue: i => (sc.cues[i] ? sc.cues[i].start : 0),
      end: i => (sc.cues[i] ? sc.cues[i].end : sc.duration),
      at: (i, kw, opts) => resolveAnchor(sc, si, i, kw, opts),
      t: (key, fb, vars) => (V.t ? V.t(key, fb, vars, si) : (fb === undefined ? key : fb)),
      sfx: (type, vol) => (V.sfx ? V.sfx(type, vol) : false),
      frame: V._frameRuntime ? V._frameRuntime.forScene(sc, si) : null,
      dur: sc.duration,
      clock: 0,
      alive: 0,
      idle: 0,
      playing: false,
      ended: false,
      pointer: V.pointer,
      holdStart: () => (sc.cues.length ? sc.cues[sc.cues.length - 1].end + 0.3 : 0.3),
    };
  }

  function cleanChunkTail(c) {
    return c.replace(/(?:[。！？；，、：!?;,:\s]|(?<!\.)\.(?!\.))+$/g, '');
  }

  function measureSubUnits(s) {
    let u = 0;
    for (const ch of s) u += CJK_CHAR_RE.test(ch) ? 1 : 0.72;
    return u;
  }

  function needsSpaceBetween(a, b) {
    if (!a || !b || /\s$/.test(a) || /^\s/.test(b)) return false;
    return !CJK_CHAR_RE.test(a[a.length - 1]) && !CJK_CHAR_RE.test(b[0]);
  }

  function joinSubFrag(a, b) {
    if (!a) return b;
    return needsSpaceBetween(a, b) ? `${a} ${b}` : a + b;
  }

  function splitLongSubClause(sub) {
    if (measureSubUnits(sub) <= 28 || !/\s/.test(sub)) return [sub];
    const out = [];
    let buf = '';
    for (const word of sub.split(/\s+/).filter(Boolean)) {
      const cand = joinSubFrag(buf, word);
      if (buf && measureSubUnits(cand) > 28) { out.push(buf); buf = word; }
      else buf = cand;
    }
    if (buf) out.push(buf);
    return out;
  }

  function packSubClauses(subs, chunks) {
    let buf = '';
    for (const rawSub of subs) {
      for (const piece of splitLongSubClause(rawSub.trim())) {
        if (!piece) continue;
        const cand = joinSubFrag(buf, piece);
        if (buf && measureSubUnits(cand) > 28) { chunks.push(buf); buf = piece; }
        else buf = cand;
      }
    }
    if (buf) chunks.push(buf);
  }

  function chunkSentences(raw) {
    const parts = raw.split(/(?<=[。！？；!?]|;|(?<!\.)\.(?![\p{L}\p{N}.]))\s*/u);
    const chunks = [];
    for (const s of parts) {
      const clean = s.trim();
      if (!clean) continue;
      if (measureSubUnits(clean) <= 28) { chunks.push(clean); continue; }
      packSubClauses(clean.split(/(?<=[，、：,:])\s*/), chunks);
    }
    return chunks.map(cleanChunkTail).filter(Boolean);
  }

  function interpolateChunkGap(starts, weights, lIdx, rIdx, tLeft, tRight) {
    let wTotal = 0;
    for (let k = lIdx; k < rIdx; k++) wTotal += weights[k];
    const denom = wTotal || (rIdx - lIdx);
    let acc = 0;
    for (let k = lIdx; k < rIdx; k++) {
      if (k > lIdx) starts[k] = tLeft + (tRight - tLeft) * (acc / denom);
      acc += wTotal ? weights[k] : 1;
    }
  }

  function fillMissingChunkStarts(starts, chunks, span) {
    const weights = chunks.map(c => Math.max(0.5, weight(c)));
    starts[0] = 0;
    let lIdx = 0;
    while (lIdx < chunks.length - 1) {
      let rIdx = lIdx + 1;
      while (rIdx < chunks.length && starts[rIdx] == null) rIdx++;
      const tLeft = starts[lIdx];
      const tRight = rIdx < chunks.length ? Math.max(tLeft, starts[rIdx]) : Math.max(tLeft, span);
      if (rIdx > lIdx + 1) interpolateChunkGap(starts, weights, lIdx, rIdx, tLeft, tRight);
      lIdx = rIdx;
    }
  }

  function mapWordsToChunks(chunks, words, cueStart, cueEnd, spokenText) {
    let flat = '';
    const charTime = [];
    for (const [t0, w] of words) {
      const k = normKey(w);
      for (let i = 0; i < k.length; i++) charTime.push(t0);
      flat += k;
    }
    let searchFrom = 0;
    const starts = chunks.map((c, idx) => {
      if (idx === 0) return 0;
      const key = normKey(spokenText(c));
      const pos = key ? flat.indexOf(key, searchFrom) : -1;
      if (pos >= 0) { searchFrom = pos + key.length; return charTime[pos]; }
      return null;
    });
    fillMissingChunkStarts(starts, chunks, Math.max(0.25, cueEnd - cueStart));
    return chunks.map((text, i) => {
      const s = cueStart + starts[i];
      const e = i + 1 < chunks.length ? cueStart + starts[i + 1] : cueEnd;
      return { start: s, end: Math.max(s + 0.2, e), text };
    });
  }

  function splitSubCues(text, cueStart, cueEnd, words, spokenText) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const chunks = chunkSentences(raw);
    if (chunks.length <= 1) {
      return [{ start: cueStart, end: cueEnd, text: chunks[0] || raw }];
    }
    if (words && words.length) return mapWordsToChunks(chunks, words, cueStart, cueEnd, spokenText);
    const total = chunks.reduce((a, c) => a + weight(c), 0) || 1;
    const span = cueEnd - cueStart;
    let cur = cueStart;
    return chunks.map((c, idx) => {
      const d = idx === chunks.length - 1 ? cueEnd - cur : span * (weight(c) / total);
      const item = { start: cur, end: cur + d, text: c };
      cur += d;
      return item;
    });
  }

  function getSceneLocaleOverride(sc, si) {
    const lang = V.getActiveLang();
    const scenes = lang && V.locales[lang] && V.locales[lang].scenes;
    if (!scenes) return null;
    return (sc.id && scenes[sc.id]) || scenes[si] || null;
  }

  function applyLocaleLine(lineObj, scLoc, li) {
    if (!scLoc) return lineObj;
    const rawOv = Array.isArray(scLoc) ? scLoc[li] : (scLoc.lines && scLoc.lines[li]);
    if (!rawOv && !scLoc.anchors) return lineObj;
    const patch = typeof rawOv === 'string' ? { text: rawOv } : (rawOv || {});
    const mergedAnchors = Object.assign({}, lineObj.anchors || {}, scLoc.anchors || {}, patch.anchors || {});
    const merged = Object.assign({}, lineObj, patch, { anchors: mergedAnchors });
    if (merged.text !== lineObj.text && !Object.hasOwn(patch, 'speechText')) delete merged.speechText;
    return merged;
  }

  function buildCueEntry(lineObj, cueStart, cueEnd) {
    return {
      start: cueStart,
      end: cueEnd,
      text: lineObj.text,
      speaker: lineObj.speaker || null,
      voice: lineObj.voice,
      speed: lineObj.speed,
      pitch: lineObj.pitch,
      model: lineObj.model,
      provider: lineObj.provider,
      style: lineObj.style,
      instructions: lineObj.instructions,
      enSlowdown: lineObj.enSlowdown,
      align: lineObj.align,
      whisperModel: lineObj.whisperModel,
      volume: lineObj.volume,
      xmlLang: lineObj.xmlLang,
      pptSkip: Boolean(lineObj.pptSkip),
      pptAt: lineObj.pptAt,
    };
  }

  function resolveSceneDuration(sc, bSc, lt, TAIL) {
    if (bSc) return bSc.duration;
    if (sc.lines.length === 0 && sc._explicitDuration != null) return sc._explicitDuration;
    const hold = sc.lines.length === 0 ? (sc.hold === undefined ? 3.0 : sc.hold) : (sc.hold || 0);
    return lt + hold + TAIL;
  }

  function isLangBakedMatch(baked) {
    const activeLang = typeof V.getActiveLang === 'function' ? V.getActiveLang() : '';
    if (baked.lang) {
      return activeLang ? baked.lang === activeLang : !(V.isSecondaryLocale && V.isSecondaryLocale(baked.lang));
    }
    return !(V.isSecondaryLocale && V.isSecondaryLocale(activeLang));
  }

  function isBakedCueValid(cue) {
    return Array.isArray(cue) && cue.length >= 2 && Number.isFinite(cue[0]) && Number.isFinite(cue[1]) && cue[1] >= cue[0];
  }

  function isBakedSceneValid(scene, bakedScene) {
    return bakedScene && Number.isFinite(bakedScene.start) && bakedScene.start >= 0
      && Number.isFinite(bakedScene.duration) && bakedScene.duration >= 0
      && Array.isArray(bakedScene.cues) && bakedScene.cues.length === (scene.lines ? scene.lines.length : 0)
      && bakedScene.cues.every(isBakedCueValid);
  }

  function isBakedValid(baked) {
    if (!baked || V.__ignoreBakedLayout || !isLangBakedMatch(baked)) return false;
    if (!Number.isFinite(baked.duration) || baked.duration <= 0) return false;
    if (!Array.isArray(baked.scenes) || baked.scenes.length !== V.scenes.length) return false;
    return V.scenes.every((sc, idx) => isBakedSceneValid(sc, baked.scenes[idx]));
  }

  function resolveCueTiming(bSc, voiceDurs, si, li, lineObj, lt, CPS) {
    const bCue = bSc ? bSc.cues[li] : null;
    if (bCue) return [bCue[0], bCue[1]];
    const vDur = voiceDurs[si] && voiceDurs[si][li];
    const d = vDur || lineObj.dur || Math.max(1.2, weight(lineObj.text) / CPS);
    return [lt, lt + d];
  }

  function isExactSubsTextMatch(exactSubs, lineText) {
    const subJoined = exactSubs.map(x => (Array.isArray(x) ? x[2] : '') || '').join('');
    return normKey(subJoined) === normKey(lineText);
  }

  function shouldUseExactSubs(exactSubs, lineObj, lineWords) {
    if (!exactSubs || !exactSubs.length) return false;
    if (!V.__ignoreBakedLayout) return true;
    if (lineWords && lineWords.length) return false;
    return isExactSubsTextMatch(exactSubs, lineObj.text);
  }

  function appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords, spokenText) {
    const speaker = lineObj.speaker || null;
    if (shouldUseExactSubs(exactSubs, lineObj, lineWords)) {
      sc.subCues.push(...exactSubs.map(([s0, s1, txt]) => ({ start: cueStart + s0, end: cueStart + s1, text: txt, speaker })));
    } else {
      sc.subCues.push(...splitSubCues(lineObj.text, cueStart, cueEnd, lineWords, spokenText).map(s => ({ ...s, speaker })));
    }
  }

  const SPEAKER_INHERIT_KEYS = ['voice', 'speed', 'pitch', 'style', 'instructions', 'model', 'provider', 'volume', 'xmlLang'];

  function resolveSpeakerLabel(sp, key) {
    if (sp.label === false || sp.label === '') return null;
    return sp.label || sp.name || key;
  }

  function applySpeakerPreset(lineObj, speakers) {
    const key = lineObj.speakerId || lineObj.speaker;
    const raw = key && speakers ? speakers[key] : null;
    if (!raw) return lineObj;
    const sp = typeof raw === 'string' ? { voice: raw } : raw;
    const out = Object.assign({}, lineObj, { speakerId: key, speaker: resolveSpeakerLabel(sp, key) });
    for (const k of SPEAKER_INHERIT_KEYS) {
      if (out[k] === undefined && sp[k] !== undefined) out[k] = sp[k];
    }
    return out;
  }

  function buildLocalizedLines(sc, scLoc, speakers) {
    const locArr = Array.isArray(scLoc) ? scLoc : (scLoc && Array.isArray(scLoc.lines) ? scLoc.lines : null);
    const count = locArr ? locArr.length : sc._origLines.length;
    const out = [];
    for (let li = 0; li < count; li++) {
      const orig = sc._origLines[li];
      const baseObj = orig ? (typeof orig === 'string' ? { text: orig } : orig) : { text: '' };
      out.push(applySpeakerPreset(applyLocaleLine(baseObj, scLoc, li), speakers));
    }
    sc.lines = out;
  }

  function syncSceneLocaleMeta(sc, si, speakers) {
    if (sc._explicitDuration === undefined && typeof sc.duration === 'number' && (!sc.lines || !sc.lines.length)) {
      sc._explicitDuration = sc.duration;
    }
    if (sc._origTitle === undefined) sc._origTitle = sc.title;
    sc.lines = sc.lines || [];
    if (!sc._origLines) sc._origLines = sc.lines.slice();
    const scLoc = getSceneLocaleOverride(sc, si);
    sc.title = (scLoc && scLoc.title) || sc._origTitle;
    sc._resolvedCheckpoints = null;
    sc._resolvedSfx = null;
    buildLocalizedLines(sc, scLoc, speakers);
  }

  function layoutScene(sc, si, t, bSc, voiceInfo, pacing) {
    sc.start = bSc ? bSc.start : t;
    let lt = sc.lead === undefined ? pacing.LEAD : sc.lead;
    sc.cues = [];
    sc.subCues = [];

    sc.lines.forEach((lineObj, li) => {
      const [cueStart, cueEnd] = resolveCueTiming(bSc, voiceInfo.durs, si, li, lineObj, lt, pacing.CPS);
      const cue = buildCueEntry(lineObj, cueStart, cueEnd);
      cue.spoken = V._speech.line(lineObj, `S${si}L${li}`);
      sc.cues.push(cue);
      const exactSubs = voiceInfo.subs[si] && voiceInfo.subs[si][li];
      const lineWords = voiceInfo.words[si] && voiceInfo.words[si][li];
      appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords, V._speech.speak);
      lt = cueEnd + pacing.GAP + (lineObj.pause || 0);
    });

    sc.duration = resolveSceneDuration(sc, bSc, lt, pacing.TAIL);
    return sc.start + sc.duration;
  }

  function resolveGlKeyframeT0(k, scStart, at) {
    if (k.t0 === 'self') return at;
    if (typeof k.t0 === 'number') return scStart + k.t0;
    if (k.t0 === undefined && k.shape === 'burst') return at;
    return k.t0;
  }

  function collectGlKeyframes() {
    V.glKeys = [];
    V.scenes.forEach((sc, si) => {
      if (!sc.gl) return;
      for (const k of sc.gl(makeCtx(sc, si))) {
        const at = sc.start + k.t;
        V.glKeys.push({ ...k, t: at, t0: resolveGlKeyframeT0(k, sc.start, at) });
      }
    });
    V.glKeys.sort((a, b) => a.t - b.t);
  }

  function normalizeLineSegs(lineSegs) {
    if (!Array.isArray(lineSegs)) return [];
    let prev = 0;
    return lineSegs.map(item => {
      if (!Array.isArray(item) || item.length >= 3) return item;
      const end = Number(item[0]) || prev;
      const triple = [Math.round(prev * 1000) / 1000, end, item[1]];
      prev = end;
      return triple;
    });
  }

  function resolveVoiceSubCues(vv) {
    if (Array.isArray(vv.subCues) && vv.subCues.length) return vv.subCues;
    if (!Array.isArray(vv.segs)) return [];
    return vv.segs.map(scSegs => (Array.isArray(scSegs) ? scSegs.map(normalizeLineSegs) : []));
  }

  V.layout = function () {
    const cfg = V.getCfg();
    const pacing = getPacing(cfg);
    V._speech = V._createSpeech(cfg);
    const vv = (V.getActiveVoice ? V.getActiveVoice() : V.voice) || {};
    const voiceInfo = { durs: vv.durations || [], subs: resolveVoiceSubCues(vv), words: vv.words || [] };
    V.scenes.forEach((sc, si) => syncSceneLocaleMeta(sc, si, cfg.tts?.speakers));
    const baked = vv.bakedLayout;
    const useBaked = isBakedValid(baked);
    V.layoutInfo = Object.freeze({ source: useBaked ? 'baked' : 'estimated', gap: pacing.GAP });

    let t = 0;
    V.scenes.forEach((sc, si) => {
      t = layoutScene(sc, si, t, useBaked ? baked.scenes[si] : null, voiceInfo, pacing);
    });

    V.duration = useBaked && typeof baked.duration === 'number' ? baked.duration : Math.max(0.1, t);
    V.totalDuration = V.duration;
    collectGlKeyframes();
    V.emit('onLayout', { duration: V.duration, scenes: V.scenes });
  };

  // 采样 30Hz 真实语音振幅包络（0..1），驱动数字人真口型与声波可视化
  function sampleEnvelopeArray(arr, relSec) {
    const pos = clamp(relSec * 30, 0, arr.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(arr.length - 1, i0 + 1);
    const frac = pos - i0;
    return ((arr[i0] * (1 - frac) + arr[i1] * frac) / 100);
  }

  V.getSceneEnergy = function (sc, si, lt) {
    if (V.pptMode) return 0;
    if (!sc || !sc.cues) return 0;
    const li = sc.cues.findIndex(c => lt >= c.start && lt <= c.end);
    if (li < 0) return 0;
    const cue = sc.cues[li];
    const vv = V.getActiveVoice ? V.getActiveVoice() : V.voice;
    const env = vv && vv.envelopes && vv.envelopes[si] && vv.envelopes[si][li];
    if (Array.isArray(env) && env.length) return clamp(sampleEnvelopeArray(env, lt - cue.start));
    // 草稿期尚无音频时回退为自然语音节律波
    const g = sc.start + lt;
    return clamp(0.35 + 0.55 * Math.abs(Math.sin(g * 12.5)) * Math.abs(Math.cos(g * 3.1)));
  };

  V.makeCtx = makeCtx;
})(globalThis.V = globalThis.V || {});

/* core/05-transitions.js · 基于 V.transition() 契约注册内置换幕过渡，支持外部自定义覆盖或新增 */
(function (V) {
  const { clamp, ease, h } = V.u;
  const DEFAULT_TILE_COLORS = ['#2563EB', '#3B82F6', '#6366F1', '#0EA5E9', '#64748B'];

  V.transition('none', {
    mount() { return {}; },
    update(_dom, _near, _dur, curScene) {
      if (curScene && curScene.root) curScene.root.style.transform = '';
    },
  });

  V.transition('fade', {
    mount(box) {
      const veil = h('div', { class: 'wipe-veil' });
      box.appendChild(veil);
      return { veil };
    },
    update(dom, near, dur) {
      const k = dur > 0 && Math.abs(near) < dur ? 1 - ease.io(Math.abs(near) / dur) : 0;
      dom.veil.style.opacity = String(clamp(k));
    },
  });

  V.transition('slide', {
    mount(box) {
      const veil = h('div', { class: 'wipe-veil' });
      box.appendChild(veil);
      return { veil };
    },
    update(dom, near, dur, curScene) {
      const active = dur > 0 && Math.abs(near) < dur;
      const k = active ? 1 - ease.io(Math.abs(near) / dur) : 0;
      dom.veil.style.opacity = String(clamp(k * 0.85));
      if (!curScene || !curScene.root) return;
      if (!active) { curScene.root.style.transform = ''; return; }
      const dx = near < 0 ? -42 * ease.in(1 + near / dur) : 42 * (1 - ease.out(near / dur));
      curScene.root.style.transform = `translateX(${dx}px)`;
    },
  });

  V.transition('wipe', {
    mount(box, cfg) {
      const curtain = h('div', { class: 'wipe-curtain' });
      if (cfg.wipeColor) curtain.style.background = cfg.wipeColor;
      box.appendChild(curtain);
      return { curtain };
    },
    update(dom, near, dur) {
      const active = dur > 0 && Math.abs(near) < dur;
      const k = !active ? 0 : (near < 0 ? ease.in(1 + near / dur) : 1 - ease.out(near / dur));
      dom.curtain.style.transformOrigin = near < 0 ? '0% 50%' : '100% 50%';
      dom.curtain.style.transform = `scaleX(${clamp(k)})`;
    },
  });

  V.transition('tiles', {
    dur: 0.42,
    mount(box, cfg) {
      const tile = cfg.tileSize || 120;
      const cols = Math.ceil((V.stageWidth || 1920) / tile);
      const rows = Math.ceil((V.stageHeight || 1080) / tile);
      const colors = cfg.wipeColors || DEFAULT_TILE_COLORS;
      const tiles = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const el = h('i', {
            style: `width:${tile}px;height:${tile}px;left:${c * tile}px;top:${r * tile}px;background:${colors[(c * 3 + r * 7) % colors.length]}`,
          });
          box.appendChild(el);
          tiles.push([el, (c + r) / Math.max(1, cols + rows - 2)]);
        }
      }
      return { tiles, cleared: false };
    },
    update(dom, near, dur) {
      if (!(dur > 0) || Math.abs(near) >= dur) {
        if (!dom.cleared) {
          for (const [el] of dom.tiles) el.style.transform = 'scale(0)';
          dom.cleared = true;
        }
        return;
      }
      dom.cleared = false;
      for (const [el, delay] of dom.tiles) {
        const k = near < 0
          ? clamp((near + dur) / dur * 1.6 - delay * 0.6)
          : 1 - clamp(near / dur * 1.6 - delay * 0.6);
        const s = Math.round(clamp(k) * 4) / 4;
        el.style.transform = `scale(${s})`;
      }
    },
  });
})(globalThis.V = globalThis.V || {});

/* core/06-layers.js · 跨幕持久层（V.layer）挂载、状态插值与实时语音能量注入 */
(function (V) {
  const { clamp, lerp, ease, h } = V.u;

  function initLayerElement(layer, stage, subs) {
    const existing = document.getElementById(`layer-${layer.id}`);
    if (existing) return existing;
    const zVal = layer.z !== undefined ? layer.z : (layer.zIndex !== undefined ? layer.zIndex : 6);
    const el = h('div', {
      id: `layer-${layer.id}`,
      class: 'stage-layer ' + (layer.cls || ''),
      style: `z-index:${zVal}`,
    });
    stage.insertBefore(el, subs);
    return el;
  }

  function mountLayers(stage, subs) {
    for (const layer of V.layers) {
      if (!layer || layer._mounted) continue;
      const el = initLayerElement(layer, stage, subs);
      const fn = layer.build || layer.create;
      const ret = fn ? fn(el, stage) : null;
      if (ret && ret.nodeType === 1 && !ret.parentNode) el.appendChild(ret);
      layer._el = el;
      layer._data = ret;
      layer._mounted = true;
    }
  }

  function resolveLayerState(layer, sc, si, frameCtx) {
    const prop = layer.prop || layer.id;
    const raw = sc ? sc[prop] : null;
    let val = raw;
    if (typeof raw === 'function') {
      const ctx = sc.ctx || (sc.ctx = V.makeCtx(sc, si));
      ctx.dur = sc.duration;
      ctx.frame = V._frameRuntime.forScene(sc, si);
      if (frameCtx) {
        const { clock, alive, idle, playing, ended, pointer } = frameCtx;
        Object.assign(ctx, { clock, alive, idle, playing, ended, pointer, sceneClock: clock - sc.start });
      }
      val = raw(ctx, sc, si);
    }
    return Object.assign({}, layer.defaults || layer.defaultState || {}, val || {});
  }

  function blendLayerStates(prev, next, k) {
    const out = Object.assign({}, prev, next);
    for (const key of Object.keys(out)) {
      const a = prev[key], b = next[key];
      if (typeof a === 'number' && typeof b === 'number') out[key] = lerp(a, b, k);
      else out[key] = k < 0.5 && a !== undefined ? a : b;
    }
    return out;
  }

  function computeLayerFrame(layer, sc, idx, lt) {
    const curState = resolveLayerState(layer, sc, idx);
    const blendDur = layer.blendDur === undefined ? 0.45 : layer.blendDur;
    if (idx <= 0 || blendDur <= 0 || lt >= blendDur) {
      return { state: curState, prevState: curState, curState, blend: 1 };
    }
    const prevState = resolveLayerState(layer, V.scenes[idx - 1], idx - 1, sc.ctx);
    const blend = ease.io(clamp(lt / blendDur));
    return { state: blendLayerStates(prevState, curState, blend), prevState, curState, blend };
  }

  function updateLayers(sc, idx, lt, now, speaking) {
    if (!V.layers.length) return;
    const energy = V.getSceneEnergy(sc, idx, lt);
    const clock = V._clock === undefined ? now : V._clock;
    for (const layer of V.layers) {
      if (!layer || !layer._mounted || typeof layer.update !== 'function') continue;
      const f = computeLayerFrame(layer, sc, idx, lt);
      layer.update(f.state, {
        frame: V.getFrameState(),
        t: now,
        lt,
        clock,
        alive: clock,
        playing: Boolean(V._isPlaying),
        pointer: V.pointer,
        scene: sc,
        sceneIndex: idx,
        speaking,
        energy,
        blend: f.blend,
        prev: f.prevState,
        next: f.curState,
        el: layer._el,
        data: layer._data,
        ctx: sc.ctx,
      });
    }
  }

  V._layersRuntime = { mountLayers, updateLayers, resolveLayerState };
})(globalThis.V = globalThis.V || {});

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

  function resolveCheckpointChoices(cp) {
    if (Array.isArray(cp.choices) && cp.choices.length) return cp.choices;
    if (Array.isArray(cp.actions) && cp.actions.length) return cp.actions;
    const label = cp.buttonLabel || (V.uiStr ? V.uiStr('cpContinue') : '继续播放');
    return [{ label, value: true, primary: true }];
  }

  function trCheckpointText(raw, fallbackKey) {
    if (!raw || !V.t) return raw;
    const direct = V.t(raw, raw);
    if (direct !== raw) return direct;
    return fallbackKey ? V.t(fallbackKey, raw) : raw;
  }

  function buildChoiceBtn(ch, idx, cp, resumeFn) {
    const label = trCheckpointText(ch.label, cp.id ? `cp.${cp.id}.choice.${idx}` : '');
    const b = h('button', { class: 'cp-btn' + (ch.primary || idx === 0 ? ' is-primary' : '') }, label);
    b.onclick = e => {
      e.stopPropagation();
      if (ch.sfx !== false && V.sfx) V.sfx(ch.sfx || 'click', 0.5);
      if (typeof ch.onSelect === 'function') ch.onSelect(V);
      const resVal = ch.value !== undefined ? ch.value : (ch.resume !== undefined ? ch.resume : ch.label);
      resumeFn(cp, resVal);
    };
    return b;
  }

  function renderCheckpointCard(overlay, cp, resumeFn) {
    overlay.innerHTML = '';
    if (typeof cp.render === 'function') {
      cp.render(overlay, val => resumeFn(cp, val));
      return;
    }
    const btns = resolveCheckpointChoices(cp).map((ch, idx) => buildChoiceBtn(ch, idx, cp, resumeFn));
    const title = trCheckpointText(cp.title, cp.id ? `cp.${cp.id}.title` : '');
    const prompt = trCheckpointText(cp.prompt, cp.id ? `cp.${cp.id}.prompt` : '');
    const card = h('div', { class: 'cp-card', 'data-interactive': '1' },
      title ? h('h4', null, title) : null,
      prompt ? h('p', null, prompt) : null,
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
    if (cp.sfx !== false && V.sfx) V.sfx(cp.sfx || 'ping', 0.45);
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

/* core/08-plugins.js - 内置可插拔扩展（交互实时微音效 V.sfx + 草稿 WebAudio 微音效 + ?dev 面板 + SSE 保位热重载） */
(function (V) {
  const { clamp, h, toggle } = V.u;

  // 1. 交互实时微音效 V.sfx() 与草稿态动作音效预览插件（录制态/静音态自动静默）
  let draftActx = null;
  const TONE_PRESETS = {
    ping: ['sine', 880, 1320, 0.09, 0.24],
    chime: ['sine', 880, 1320, 0.09, 0.24],
    success: ['sine', 784, 1175, 0.09, 0.24],
    stamp: ['sine', 260, 95, 0.055, 0.13],
    pop: ['sine', 520, 760, 0.04, 0.09],
    whoosh: ['sine', 340, 140, 0.14, 0.2],
    alert: ['triangle', 520, 360, 0.1, 0.22],
    warn: ['triangle', 520, 360, 0.1, 0.22],
    error: ['sawtooth', 300, 180, 0.11, 0.22],
    key: ['triangle', 420, 160, 0.045, 0.055],
    click: ['triangle', 680, 160, 0.045, 0.055],
  };

  function synthTone(ctx, type, g) {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const [wave, f0, f1, rampT, endT] = TONE_PRESETS[type] || TONE_PRESETS.click;
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + rampT);
    gain.gain.setValueAtTime(g, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + endT);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + endT + 0.01);
  }

  function playSynthTone(type, effVol) {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return false;
      if (!draftActx) draftActx = new Ctx();
      if (draftActx.state === 'suspended') draftActx.resume();
      synthTone(draftActx, type, clamp(effVol, 0.02, 1) * 0.14);
      return true;
    } catch {
      return false;
    }
  }

  function playUrlSfx(src, effVol) {
    try {
      if (typeof Audio === 'undefined') return false;
      const el = new Audio(src);
      el.volume = clamp(effVol, 0, 1);
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function resolveDraftSfxGain() {
    const s = V.getCfg().sfx;
    if (s === false || s === 'none') return 0;
    if (s && typeof s === 'object') {
      if (s.enabled === false || s.preset === 'none') return 0;
      if (s.volume !== undefined) return Math.max(0, Number(s.volume) || 0);
    }
    return 1;
  }

  function parseSfxCallArgs(spec, volOrOpts) {
    if (spec && typeof spec === 'object') {
      return {
        src: spec.src || '',
        type: spec.type || spec.preset || 'click',
        vol: spec.volume === undefined ? 0.6 : Number(spec.volume),
      };
    }
    const raw = typeof spec === 'string' && spec ? spec : 'click';
    const isUrl = /[/.]/.test(raw) && /\.(mp3|wav|ogg|m4a|aac|webm)(\?|$)/i.test(raw);
    const optVol = typeof volOrOpts === 'number' ? volOrOpts : (volOrOpts && volOrOpts.volume);
    return { src: isUrl ? raw : '', type: raw, vol: optVol === undefined ? 0.6 : Number(optVol) };
  }

  function computeEffectiveSfxVol(baseVol) {
    if (V._isRecord || V._allMuted) return 0;
    const master = V._masterVolume === undefined ? 1 : Number(V._masterVolume);
    const cfgGain = resolveDraftSfxGain();
    if (master <= 0.001 || cfgGain <= 0) return 0;
    return clamp((Number.isFinite(baseVol) ? baseVol : 0.6) * master * cfgGain, 0, 1);
  }

  function triggerSfx(spec, volOrOpts) {
    const parsed = parseSfxCallArgs(spec, volOrOpts);
    const effVol = computeEffectiveSfxVol(parsed.vol);
    if (effVol <= 0.001) return false;
    const ok = parsed.src ? playUrlSfx(parsed.src, effVol) : playSynthTone(parsed.type, effVol);
    if (ok) V._sfxCount = (V._sfxCount || 0) + 1;
    return ok;
  }

  V.sfx = triggerSfx;
  V.sfx.play = triggerSfx;

  function canPlayDraftSfx(st) {
    if (!st.playing || st.scrubbing || st.hasAudio || st.isRecord || st.muted || st.voiceOn === false) return false;
    if ((st.volume !== undefined && st.volume <= 0) || resolveDraftSfxGain() <= 0) return false;
    return st.now > st.prevT && st.now - st.prevT <= 0.25;
  }

  function resolveSceneSfxList(sc, si) {
    if (!sc._resolvedSfx) {
      const ctx = sc.ctx || (V.makeCtx ? V.makeCtx(sc, si) : null);
      const raw = typeof sc.sfx === 'function' ? sc.sfx(ctx) : sc.sfx;
      sc._resolvedSfx = Array.isArray(raw) ? raw : [];
    }
    return sc._resolvedSfx;
  }

  function didCrossSfxAt(prevT, curT, gAt) {
    return gAt <= 0 ? prevT <= 0 && curT > 0 : prevT < gAt && curT >= gAt;
  }

  V.use({
    id: 'builtin-draft-sfx',
    onRender(st) {
      if (!canPlayDraftSfx(st)) return;
      const sc = st.scene;
      const masterGain = resolveDraftSfxGain() * (st.volume === undefined ? 1 : st.volume);
      for (const ev of resolveSceneSfxList(sc, st.sceneIndex)) {
        if (!ev || ev.at == null) continue;
        const gAt = sc.start + Number(ev.at);
        if (didCrossSfxAt(st.prevT, st.now, gAt)) {
          const vol = (ev.volume === undefined ? 0.5 : Number(ev.volume)) * masterGain;
          if (vol > 0) playSynthTone(ev.type || ev.preset || 'click', vol);
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

/* core/09-icons.js · 控制栏图标预设（现代线性 / 像素格）、UI 配置归一化与图标构造器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { h, svg } = V.u;

  const CTRL_ICONS = {
    home: ['M2.25 7.2 8 2.5l5.75 4.7', 'M4 6.2v6.55a.75.75 0 0 0 .75.75h6.5a.75.75 0 0 0 .75-.75V6.2', 'M6.75 13.5V9.75h2.5v3.75'],
    play: '<path d="M4.5 2.9a.8.8 0 0 1 1.22-.68l7.4 4.6a.8.8 0 0 1 0 1.36l-7.4 4.6a.8.8 0 0 1-1.22-.68V2.9z"/>',
    pause: '<rect x="3.75" y="2.75" width="3" height="10.5" rx="0.9"/><rect x="9.25" y="2.75" width="3" height="10.5" rx="0.9"/>',
    replay: ['M2.75 8a5.25 5.25 0 1 0 1.4-3.58', 'M2.6 2.6v2.7h2.7'],
    prevSlide: ['M9.75 3.75 5.5 8l4.25 4.25'],
    nextSlide: ['M6.25 3.75 10.5 8l-4.25 4.25'],
    download: ['M8 2.5v7.75', 'M5 7.25 8 10.25l3-3', 'M2.5 11v2.5h11V11'],
    pptMode: ['M2 3h12a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-.75.75H2a.75.75 0 0 1-.75-.75v-7A.75.75 0 0 1 2 3z', 'M8 11.5v2.25', 'M5.25 13.75h5.5', 'M5.25 6.5h5.5', 'M5.25 8.75h3.5'],
    videoMode: ['M2 3.25h12a.75.75 0 0 1 .75.75v8a.75.75 0 0 1-.75.75H2a.75.75 0 0 1-.75-.75V4a.75.75 0 0 1 .75-.75z', 'M6.5 5.75 10.5 8l-4 2.25V5.75z'],
    chapCaret: ['M4.5 9.75 8 6.25l3.5 3.5'],
    rate: ['M2.6 11.5a6 6 0 1 1 10.8 0', 'M8 8.5 10.8 5.4', 'M6 12.5h4'],
    subsOn: ['M2.25 3.5h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75z', 'M4.25 8.25h3', 'M9 8.25h2.75', 'M4.25 10.6h5.25'],
    subsOff: ['M2.25 3.5h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75z', 'M4.25 8.25h2', 'M2.25 2.25l11.5 11.5'],
    volumeOn: ['M2.5 6.25h2.3L8.25 3.5v9L4.8 9.75H2.5a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5z', 'M10.6 5.6a3.4 3.4 0 0 1 0 4.8', 'M12.6 3.8a6 6 0 0 1 0 8.4'],
    volumeLow: ['M2.5 6.25h2.3L8.25 3.5v9L4.8 9.75H2.5a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5z', 'M10.8 5.6a3.4 3.4 0 0 1 0 4.8'],
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
    prevSlide: '<path d="M10 3v2H8v2H6v2h2v2h2v2h1v-2H9V9H7V7h2V5h2V3h-1z"/>',
    nextSlide: '<path d="M5 3v2h2v2h2v2H7v2H5v2h1v-2h2V9h2V7H8V5H6V3H5z"/>',
    download: '<path d="M7 2h2v6h3L8 12 4 8h3V2zM2 11h2v2h8v-2h2v4H2z"/>',
    pptMode: '<path d="M1 2h14v9H1V2zm2 2v5h10V4H3zm4 7h2v2h3v1H4v-1h3v-2zm-2-5h6v1H5V6zm0 2h4v1H5V8z"/>',
    videoMode: '<path d="M1 3h14v10H1V3zm2 2v6h10V5H3zm3 1h2v1h2v2H8v1H6V6z"/>',
    chapCaret: '<path d="M7 5h2v2h2v2h2v2h-2V9H9V7H7v2H5v2H3V9h2V7h2V5z"/>',
    rate: '<rect x="4" y="2" width="8" height="2"/><rect x="2" y="4" width="2" height="7"/><rect x="12" y="4" width="2" height="7"/><rect x="3" y="11" width="2" height="2"/><rect x="11" y="11" width="2" height="2"/><rect x="7" y="8" width="2" height="3"/><rect x="9" y="6" width="2" height="2"/><rect x="6" y="13" width="4" height="1"/>',
    subsOn: '<path d="M1 3h14v10H1V3zm2 2v6h10V5H3zm1 2h3v1H4V7zm5 0h3v1H9V7zm-5 2h6v1H4V9z"/>',
    subsOff: '<path d="M1 3h14v10H1V3zm2 2v6h10V5H3z"/><rect x="2" y="2" width="2" height="2"/><rect x="4" y="4" width="2" height="2"/><rect x="6" y="6" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/><rect x="10" y="10" width="2" height="2"/><rect x="12" y="12" width="2" height="2"/>',
    volumeOn: '<path d="M2 6h3V5h1V4h1V3h2v10H7v-1H6v-1H5v-1H2V6z"/><rect x="11" y="5" width="1" height="6"/><rect x="10" y="4" width="1" height="1"/><rect x="10" y="11" width="1" height="1"/><rect x="13" y="3" width="1" height="10"/><rect x="12" y="2" width="1" height="1"/><rect x="12" y="13" width="1" height="1"/>',
    volumeLow: '<path d="M2 6h3V5h1V4h1V3h2v10H7v-1H6v-1H5v-1H2V6z"/><rect x="11" y="5" width="2" height="6"/><rect x="10" y="4" width="1" height="1"/><rect x="10" y="11" width="1" height="1"/>',
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

  function numDelayOr(val, fallback) {
    if (val === undefined || val === null || val === '') return fallback;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function resolveUiDelays(u) {
    const rawLeave = u.leaveHideDelay !== undefined ? u.leaveHideDelay : u.autoHideDelay;
    return {
      idleHideDelay: numDelayOr(u.idleHideDelay, 1500),
      leaveHideDelay: numDelayOr(rawLeave, 220),
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
      resume: Boolean(u.resume),
      livePause: u.livePause !== false,
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

/* core/11-audio.js · 解说干声与背景音乐双轨独立加载、寻道防漂移同步与声音状态机 */
(function (V) {
  if (typeof location === 'undefined') return;

  function isVoiceLocaleMatch() {
    return V.isVoiceLocaleMatch ? V.isVoiceLocaleMatch() : Boolean(V.voice);
  }

  function hasExplicitLocaleMedia(lang, key) {
    const loc = (V.locales && V.locales[lang]) || null;
    if (!loc) return false;
    if (loc[key] !== undefined) return true;
    return Boolean(loc.config && loc.config[key] !== undefined);
  }

  function localizeFallbackMedia(src, key = 'audioSrc') {
    if (!src) return null;
    const lang = typeof V.getActiveLang === 'function' ? V.getActiveLang() : '';
    const isSec = V.isSecondaryLocale ? V.isSecondaryLocale(lang) : false;
    if (!isSec || hasExplicitLocaleMedia(lang, key)) return src;
    return key === 'audioSrc' ? null : src;
  }

  function resolveAudioSource(cfg, isRecord) {
    if (cfg.audioSrc === false || isRecord) return null;
    if (isVoiceLocaleMatch() && V.voice.src) return V.voice.src;
    return localizeFallbackMedia(cfg.audioSrc, 'audioSrc') || null;
  }

  function isBgmDisabledInCfg(cfg) {
    if (!cfg || cfg.bgm === false || cfg.bgm === 'none' || cfg.bgmSrc === false) return true;
    if (cfg.audioSrc === false && cfg.bgm === undefined && !cfg.bgmSrc) return true;
    const b = cfg.bgm;
    if (b && typeof b === 'object') {
      if (b.preset === false || b.preset === 'none') return true;
      if (b.volume !== undefined && Number(b.volume) <= 0) return true;
    }
    return false;
  }

  function extractRawBgmSrc(cfg) {
    if (cfg.bgmSrc) return cfg.bgmSrc;
    if (cfg.bgm && typeof cfg.bgm === 'object' && cfg.bgm.src) return cfg.bgm.src;
    if (typeof cfg.bgm === 'string' && cfg.bgm !== 'ambient' && cfg.bgm !== 'chiptune') return cfg.bgm;
    return null;
  }

  function resolveRawBgmVolume(cfg) {
    const b = cfg.bgm;
    if (b && typeof b === 'object' && b.volume !== undefined) {
      const v = Number(b.volume);
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.18;
    }
    return cfg.bgmSrc ? 1 : 0.18;
  }

  function resolveBgmTrackSpec(cfg, isRecord) {
    if (isRecord || isBgmDisabledInCfg(cfg)) return null;
    if (isVoiceLocaleMatch() && V.voice.bgmSrc) return { src: V.voice.bgmSrc, volume: 1, baked: true };
    const src = localizeFallbackMedia(extractRawBgmSrc(cfg), 'bgmSrc');
    return src ? { src, volume: resolveRawBgmVolume(cfg), baked: false } : null;
  }

  function resolveSceneBgmFactor(sc) {
    if (!sc) return 1;
    const spec = sc.bgm !== undefined ? sc.bgm : sc.bgmVolume;
    if (spec === undefined || spec === null || spec === true) return 1;
    if (spec === false || spec === 'none') return 0;
    if (typeof spec === 'number') return clampUnitVolume(spec, 1);
    if (typeof spec === 'object' && spec.volume !== undefined) return clampUnitVolume(spec.volume, 1);
    return 1;
  }

  function resolveBgmTarget(el, refT, loopOn) {
    const t = Math.max(0, refT || 0);
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    if (!dur) return { time: t, dur: null, ended: false };
    if (loopOn) return { time: t % dur, dur, ended: false };
    if (t >= dur - 0.02) return { time: Math.max(0, dur - 0.01), dur, ended: true };
    return { time: t, dur, ended: false };
  }

  function computeBgmDrift(cur, target, dur, loopOn) {
    const diff = Math.abs(cur - target);
    return dur && loopOn ? Math.min(diff, Math.max(0, dur - diff)) : diff;
  }

  function clampUnitVolume(val, fallback = 1) {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  }

  V._createAudioRuntime = function (hooks) {
    const { params, isRecord } = hooks;
    let audio = null, bgmAudio = null, playbackRate = 1, bgmLoop = true, bgmIsBaked = false;
    let volume = 1, restoreVolume = 1, bgmBaseVolume = 1;
    let voiceOn = !params.has('novoice'), bgmOn = !params.has('nobgm'), muted = false;
    let audioBlocked = false, unlockArmed = false, lastUnlockTs = 0;
    let playPending = false, playPendingTs = 0, bgmPlayPending = false, targetSeekTime = null;
    let lastAudioSample = -1, lastAudioMoveTs = 0, lastRecoverTs = 0, lastBgmSeekTs = 0;
    let audioFailed = false, masterSource = null;

    function isAllMuted() {
      if (muted || volume <= 0.001) return true;
      const activeVoice = audio ? voiceOn : (!bgmAudio && voiceOn);
      const activeBgm = Boolean(bgmAudio) && bgmOn;
      return !activeVoice && !activeBgm;
    }

    function computeEffectiveBgmVol() {
      const scFactor = bgmIsBaked ? 1 : resolveSceneBgmFactor(hooks.getCurrentScene ? hooks.getCurrentScene() : null);
      return clampUnitVolume(bgmBaseVolume * volume * scFactor, 1);
    }

    function syncTrackVolumes() {
      V._masterVolume = volume;
      if (audio) { try { audio.volume = volume; } catch {} }
      if (bgmAudio) { try { bgmAudio.volume = computeEffectiveBgmVol(); } catch {} }
    }

    function ensureActiveTrack() {
      const hasActive = (audio ? voiceOn : (!bgmAudio && voiceOn)) || (Boolean(bgmAudio) && bgmOn);
      if (hasActive) return;
      if (audio || !bgmAudio) voiceOn = true;
      else bgmOn = true;
    }

    function restoreZeroVolumeIfNeeded() {
      if (volume > 0.001) return;
      volume = restoreVolume >= 0.1 ? restoreVolume : 0.5;
      syncTrackVolumes();
    }

    function resolveRefTime() {
      if (targetSeekTime != null) return targetSeekTime;
      if (audio && !audio.paused && !audioBlocked && audio.readyState >= 1) return audio.currentTime;
      return hooks.getNow();
    }

    function unlockBlockedAudio() {
      unlockArmed = false;
      document.removeEventListener('pointerdown', unlockBlockedAudio, true);
      document.removeEventListener('keydown', unlockBlockedAudio, true);
      if (!audioBlocked) return false;
      audioBlocked = false;
      lastUnlockTs = performance.now();
      hooks.onSoundUI();
      if (hooks.isPlaying()) startPlayback();
      return true;
    }

    function armBlockedUnlock() {
      if (unlockArmed) return;
      unlockArmed = true;
      document.addEventListener('pointerdown', unlockBlockedAudio, true);
      document.addEventListener('keydown', unlockBlockedAudio, true);
    }

    function markAudioBlocked() {
      const wasBlocked = audioBlocked;
      audioBlocked = true;
      armBlockedUnlock();
      hooks.onSoundUI();
      if (!wasBlocked && hooks.onAudioBlocked) hooks.onAudioBlocked();
    }

    function safePlayAudio() {
      if (!audio || !hooks.isPlaying() || !audio.paused) return;
      const nowTs = performance.now();
      if (playPending && nowTs - playPendingTs < 1500) return;
      playPending = true;
      playPendingTs = nowTs;
      audio.playbackRate = playbackRate;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          playPending = false;
          lastAudioMoveTs = performance.now();
          if (audioBlocked) { audioBlocked = false; hooks.onSoundUI(); }
        }).catch(err => {
          playPending = false;
          if (err && err.name === 'NotAllowedError') markAudioBlocked();
        });
      } else {
        playPending = false;
      }
    }

    function handleBgmPlayErr(err) {
      bgmPlayPending = false;
      if (err && err.name === 'NotAllowedError') markAudioBlocked();
    }

    function safePlayBgm() {
      if (!bgmAudio || !hooks.isPlaying() || bgmAudio.muted || !bgmAudio.paused || bgmPlayPending) return;
      bgmPlayPending = true;
      bgmAudio.playbackRate = playbackRate;
      const p = bgmAudio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { bgmPlayPending = false; }).catch(handleBgmPlayErr);
      } else {
        bgmPlayPending = false;
      }
    }

    function alignBgmToTime(refT, tol) {
      if (!bgmAudio || bgmAudio.readyState < 1) return false;
      const target = resolveBgmTarget(bgmAudio, refT, bgmLoop);
      if (target.ended) {
        if (!bgmAudio.paused) bgmAudio.pause();
        return false;
      }
      if (computeBgmDrift(bgmAudio.currentTime, target.time, target.dur, bgmLoop) > tol) {
        try { bgmAudio.currentTime = target.time; } catch {}
      }
      return true;
    }

    function syncBgmPlaybackNow() {
      if (!bgmAudio) return;
      bgmAudio.muted = isAllMuted() || !bgmOn;
      bgmAudio.playbackRate = playbackRate;
      if (!hooks.isPlaying() || bgmAudio.muted) { bgmAudio.pause(); return; }
      const refT = resolveRefTime();
      if (bgmAudio.readyState >= 1 && !alignBgmToTime(refT, 0.18)) return;
      safePlayBgm();
    }

    function keepBgmInSync(masterTime) {
      if (!bgmAudio || isAllMuted() || !bgmOn || bgmAudio.seeking) return;
      const target = resolveBgmTarget(bgmAudio, masterTime, bgmLoop);
      if (target.ended) {
        if (!bgmAudio.paused) bgmAudio.pause();
        return;
      }
      if (bgmAudio.paused) { safePlayBgm(); return; }
      const nowTs = performance.now();
      if (bgmAudio.readyState >= 2 && nowTs - lastBgmSeekTs > 1200 && computeBgmDrift(bgmAudio.currentTime, target.time, target.dur, bgmLoop) > 0.32) {
        lastBgmSeekTs = nowTs;
        try { bgmAudio.currentTime = target.time; } catch {}
      }
    }

    function uiText(key, vars) {
      return V.uiStr ? V.uiStr(key, vars) : key;
    }

    function resolveSoundBtnSpec() {
      const pct = Math.round(volume * 100);
      if (isAllMuted()) return ['volumeMute', uiText('soundMutedTip')];
      if (audioBlocked) return ['volumeMute', uiText('soundBlockedTip')];
      if (bgmAudio && (!audio || !voiceOn) && bgmOn) return ['volumeBgm', uiText('soundBgmOnlyTip', { pct })];
      if (bgmAudio && voiceOn && !bgmOn) return ['volumeVoice', uiText('soundNoBgmTip', { pct })];
      return [volume < 0.5 ? 'volumeLow' : 'volumeOn', uiText('soundOnTip', { pct })];
    }

    function emitAndSync() {
      const allOff = isAllMuted();
      V._allMuted = allOff;
      const voiceActive = Boolean(audio || !bgmAudio) && !allOff && voiceOn;
      if (audio) audio.muted = allOff || !voiceOn;
      syncBgmPlaybackNow();
      hooks.onSoundUI();
      V.emit('onSoundChange', {
        volume,
        muted: allOff,
        voiceOn: voiceActive,
        bgmOn: Boolean(bgmAudio) && !allOff && bgmOn,
        rawMuted: muted,
        rawVoiceOn: voiceOn,
        rawBgmOn: bgmOn,
      });
    }

    function setVolume(nextVol) {
      volume = Math.round(clampUnitVolume(nextVol, volume) * 100) / 100;
      if (volume > 0.001) {
        if (volume >= 0.1) restoreVolume = volume;
        if (muted) muted = false;
        ensureActiveTrack();
      }
      syncTrackVolumes();
      emitAndSync();
    }

    function setBgm(on) {
      bgmOn = Boolean(on);
      if (bgmOn) { muted = false; restoreZeroVolumeIfNeeded(); }
      emitAndSync();
    }

    function setVoice(on) {
      voiceOn = Boolean(on);
      if (voiceOn) { muted = false; restoreZeroVolumeIfNeeded(); }
      emitAndSync();
    }

    function setMuted(nextMuted) {
      muted = Boolean(nextMuted);
      if (!muted) {
        restoreZeroVolumeIfNeeded();
        ensureActiveTrack();
      }
      emitAndSync();
    }

    function toggleVoiceFromMenu() {
      if (isAllMuted()) { muted = false; voiceOn = true; bgmOn = false; restoreZeroVolumeIfNeeded(); emitAndSync(); }
      else setVoice(!voiceOn);
    }

    function toggleBgmFromMenu() {
      if (isAllMuted()) { muted = false; voiceOn = false; bgmOn = true; restoreZeroVolumeIfNeeded(); emitAndSync(); }
      else setBgm(!bgmOn);
    }

    function syncAudioBeforePlay() {
      if (!audio) return;
      const target = targetSeekTime != null ? targetSeekTime : hooks.getNow();
      if (Math.abs(audio.currentTime - target) > 0.15) {
        try { audio.currentTime = target; targetSeekTime = null; hooks.markSeekApplied(target); }
        catch { targetSeekTime = target; }
      } else {
        targetSeekTime = null;
      }
      safePlayAudio();
    }

    function startPlayback() {
      if (audioFailed) return;
      if (bgmAudio && bgmAudio.error) bgmAudio = null;
      audioBlocked = false;
      if (audio) {
        if (audio.readyState >= 1) syncAudioBeforePlay();
        else audio.addEventListener('loadedmetadata', syncAudioBeforePlay, { once: true });
      }
      syncBgmPlaybackNow();
    }

    function pausePlayback() {
      if (audio) audio.pause();
      if (bgmAudio) bgmAudio.pause();
    }

    function seekTracks(nowVal) {
      alignBgmToTime(nowVal, 0.02);
      if (!audio) return;
      lastAudioMoveTs = performance.now();
      if (audio.readyState >= 1) {
        try { audio.currentTime = nowVal; targetSeekTime = null; } catch { targetSeekTime = nowVal; }
      } else {
        targetSeekTime = nowVal;
      }
    }

    function setRate(rate) {
      playbackRate = rate;
      if (audio) audio.playbackRate = rate;
      if (bgmAudio) bgmAudio.playbackRate = rate;
    }

    function canUseMasterClock() {
      return Boolean(audio && !audioBlocked && !audioFailed);
    }

    function tryApplyPendingSeek() {
      if (targetSeekTime == null || !audio || audio.readyState < 1 || audio.seeking) return;
      const t = targetSeekTime;
      try {
        audio.currentTime = t;
        targetSeekTime = null;
        lastAudioMoveTs = performance.now();
        hooks.markSeekApplied(t);
      } catch {}
    }

    function recoverStalledAudio(nowTs) {
      if (!audio || audioBlocked || nowTs - lastRecoverTs < 2200) return;
      lastRecoverTs = nowTs;
      const refT = hooks.getNow();
      playPending = false;
      if (audio.readyState === 0 || audio.error) {
        targetSeekTime = refT;
        try { audio.load(); } catch {}
        return;
      }
      try { audio.currentTime = refT; } catch {}
      safePlayAudio();
    }

    function observeMasterProgress(nowTs) {
      const cur = audio.currentTime;
      if (Math.abs(cur - lastAudioSample) > 0.0005) {
        lastAudioSample = cur;
        lastAudioMoveTs = nowTs;
        return cur;
      }
      if (lastAudioMoveTs <= 0) lastAudioMoveTs = nowTs;
      if (nowTs - lastAudioMoveTs < 700) return cur;
      recoverStalledAudio(nowTs);
      return null;
    }

    function tickMasterClock() {
      const nowTs = performance.now();
      tryApplyPendingSeek();
      if (targetSeekTime == null && !audio.paused && !audio.seeking && audio.readyState >= 2) {
        const cur = observeMasterProgress(nowTs);
        if (cur != null) keepBgmInSync(cur);
        return cur;
      }
      if (audio.paused && audio.readyState >= 1 && !audio.seeking) safePlayAudio();
      else if (!audio.seeking && nowTs - lastAudioMoveTs > 1400) recoverStalledAudio(nowTs);
      return null;
    }

    let visBound = false;
    function bindVisibilitySyncOnce() {
      if (visBound || typeof document === 'undefined') return;
      visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden || !hooks.isPlaying() || !audio || audio.paused) return;
        if (!audio.seeking && targetSeekTime == null && audio.readyState >= 2) hooks.onVisibilitySync(audio.currentTime);
      });
    }

    function handleMasterAudioError(el) {
      if (audio !== el) return;
      if (!el._errRetried && hooks.isPlaying()) {
        el._errRetried = true;
        targetSeekTime = hooks.getNow();
        playPending = false;
        try { el.load(); } catch {}
        return;
      }
      audioFailed = true;
      el.pause();
      if (!isRecord) hooks.onSoundUI();
    }

    function createMasterAudio(src) {
      masterSource = src;
      audioFailed = false;
      bindVisibilitySyncOnce();
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('loadedmetadata', () => {
        if (audio !== el) return;
        el._errRetried = false;
        el.playbackRate = playbackRate;
        const nowVal = hooks.getNow();
        const target = targetSeekTime != null ? targetSeekTime : (nowVal > 0.05 ? nowVal : null);
        if (target != null) {
          try { el.currentTime = target; targetSeekTime = null; hooks.markSeekApplied(target); } catch {}
        }
        lastAudioMoveTs = performance.now();
        if (hooks.isPlaying() && el.paused) safePlayAudio();
      });
      el.addEventListener('seeked', () => {
        if (audio !== el) return;
        lastAudioMoveTs = performance.now();
        if (hooks.isPlaying() && el.paused) safePlayAudio();
      });
      el.addEventListener('canplay', () => {
        if (audio !== el) return;
        tryApplyPendingSeek();
        if (hooks.isPlaying() && el.paused && !el.seeking) safePlayAudio();
      });
      el.addEventListener('stalled', () => { if (audio === el && hooks.isPlaying()) recoverStalledAudio(performance.now()); });
      el.addEventListener('ended', () => { if (audio === el && hooks.isPlaying() && targetSeekTime == null) hooks.onEnded(); });
      el.addEventListener('error', () => handleMasterAudioError(el));
      el.src = src;
      el.load();
      return el;
    }

    function handleBgmAudioError(el) {
      if (bgmAudio !== el) return;
      if (!el._errRetried && hooks.isPlaying()) {
        el._errRetried = true;
        bgmPlayPending = false;
        try { el.load(); } catch {}
        return;
      }
      bgmAudio = null;
      hooks.onBgmUnavailable();
      hooks.onSoundUI();
    }

    function createBgmAudio(spec) {
      const el = new Audio();
      el.preload = 'auto';
      el.loop = bgmLoop;
      el.volume = spec.volume;
      el.muted = isAllMuted() || !bgmOn;
      el.addEventListener('loadedmetadata', () => {
        if (bgmAudio !== el) return;
        el._errRetried = false;
        el.playbackRate = playbackRate;
        el.loop = bgmLoop;
        const target = resolveBgmTarget(el, resolveRefTime(), bgmLoop);
        if (target.time > 0.05) { try { el.currentTime = target.time; } catch {} }
        if (hooks.isPlaying() && !el.muted && el.paused && !target.ended) safePlayBgm();
      });
      el.addEventListener('error', () => handleBgmAudioError(el));
      el.src = spec.src;
      el.load();
      return el;
    }

    function applySavedPrefsDict(savedPrefs) {
      if (!savedPrefs) return;
      if (typeof savedPrefs.volume === 'number') volume = clampUnitVolume(savedPrefs.volume, volume);
      if (typeof savedPrefs.muted === 'boolean') muted = savedPrefs.muted;
      if (typeof savedPrefs.voice === 'boolean' && !params.has('novoice')) voiceOn = savedPrefs.voice;
      if (typeof savedPrefs.bgm === 'boolean' && !params.has('nobgm') && !params.has('bgm')) bgmOn = savedPrefs.bgm;
    }

    function applySavedSoundPrefs(savedPrefs, cfg) {
      if (cfg && cfg.volume !== undefined) volume = clampUnitVolume(cfg.volume, 1);
      applySavedPrefsDict(savedPrefs);
      if (params.has('volume')) volume = clampUnitVolume(params.get('volume'), volume);
      if (params.has('muted')) muted = params.get('muted') !== '0' && params.get('muted') !== 'false';
      if (volume >= 0.1) restoreVolume = volume;
      V._masterVolume = volume;
    }

    function disposeAudioEl(el) {
      if (!el) return;
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
    }

    function mountTracksFromCfg(cfg) {
      bgmLoop = !(cfg.bgm && typeof cfg.bgm === 'object' && cfg.bgm.loop === false);
      const audioSrc = resolveAudioSource(cfg, isRecord);
      audio = audioSrc ? createMasterAudio(audioSrc) : null;
      if (audio) audio.muted = isAllMuted() || !voiceOn;
      const bgmSpec = resolveBgmTrackSpec(cfg, isRecord);
      bgmBaseVolume = bgmSpec ? bgmSpec.volume : 1;
      bgmIsBaked = Boolean(bgmSpec && bgmSpec.baked);
      bgmAudio = bgmSpec ? createBgmAudio(bgmSpec) : null;
      syncTrackVolumes();
      V._allMuted = isAllMuted();
    }

    function initTracks(cfg, uiCfg, savedPrefs) {
      if (uiCfg.bgmDefault === false && !params.has('bgm')) bgmOn = false;
      applySavedSoundPrefs(savedPrefs, cfg);
      mountTracksFromCfg(cfg);
    }

    function reloadTracks(cfg) {
      audioFailed = false;
      masterSource = null;
      playPending = false;
      bgmPlayPending = false;
      targetSeekTime = null;
      disposeAudioEl(audio);
      disposeAudioEl(bgmAudio);
      audio = null;
      bgmAudio = null;
      mountTracksFromCfg(cfg);
      hooks.onSoundUI();
    }

    function retry() {
      if (!audioFailed || !masterSource) return;
      disposeAudioEl(audio);
      playPending = false;
      targetSeekTime = hooks.getNow();
      audio = createMasterAudio(masterSource);
      syncTrackVolumes();
    }

    function consumeRecentUnlock() {
      if (audioBlocked) return unlockBlockedAudio();
      if (lastUnlockTs > 0 && performance.now() - lastUnlockTs < 450) {
        lastUnlockTs = 0;
        return true;
      }
      return false;
    }

    function getState(nowVal) {
      const allOff = isAllMuted();
      return {
        hasAudio: Boolean(audio),
        hasBgm: Boolean(bgmAudio),
        audioBlocked,
        volume,
        muted: allOff,
        voiceOn: Boolean(audio || !bgmAudio) && !allOff && voiceOn,
        bgmOn: Boolean(bgmAudio) && !allOff && bgmOn,
        audioTime: audio ? audio.currentTime : null,
        drift: audio && !audio.paused && targetSeekTime == null ? Math.abs(audio.currentTime - nowVal) : 0,
        seeking: audio ? audio.seeking : false,
        targetSeekTime,
        readyState: audio ? audio.readyState : 0,
        audioPaused: audio ? audio.paused : true,
      };
    }

    return {
      initTracks, reloadTracks, startPlayback, pausePlayback, seekTracks, setRate,
      setVolume, setBgm, setVoice, setMuted, toggleVoiceFromMenu, toggleBgmFromMenu,
      syncSceneVolume: syncTrackVolumes, consumeRecentUnlock,
      isAllMuted, resolveSoundBtnSpec, canUseMasterClock,
      tickMasterClock, syncWithWallClock: keepBgmInSync,
      hasBgm: () => Boolean(bgmAudio), hasError: () => audioFailed, retry, getState,
    };
  };
})(globalThis.V = globalThis.V || {});

/* core/12-prefs-resume.js · 观看偏好（倍速/字幕/声音/配乐）持久化与按需断点续播（默认关闭 resume: false） */
(function (V) {
  if (typeof location === 'undefined') return;

  let lastFlushTs = 0;
  let lastSavedT = null;
  let lastSavedKey = null;
  let boundPageHide = false;

  function getStorageKey() {
    const normPath = (location.pathname || '/').replace(/\/index\.html$/i, '/').replace(/\/+$/, '') || '/';
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    return 'hv:v1:' + normPath + (lang ? ':' + lang : '');
  }

  function canPersist(uiCfg) {
    return !V._isRecord && Boolean(uiCfg && uiCfg.persist !== false);
  }

  function canResume(uiCfg) {
    return canPersist(uiCfg) && Boolean(uiCfg && uiCfg.resume);
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
    lastSavedT = null;
    lastSavedKey = null;
    try { localStorage.removeItem(getStorageKey()); } catch {}
  }

  function resolveSavedResumeTime(params, uiCfg, duration) {
    if (!canResume(uiCfg) || params.has('from0')) return 0;
    const saved = readSaved(uiCfg);
    const t = saved && Number(saved.t);
    if (!Number.isFinite(t)) return 0;
    const minSec = uiCfg.resumeMinSec;
    const maxSec = Math.max(0, duration - 2);
    return t >= minSec && t < maxSec ? t : 0;
  }

  function resolveProgressTimestamp(curNow, isEnded, minSec, duration) {
    if (isEnded || curNow >= duration - 2) return 0;
    return curNow >= minSec ? Math.round(curNow * 10) / 10 : null;
  }

  function flushProgress(curNow, isEnded) {
    const uiCfg = V._getUiCfg ? V._getUiCfg(V.getCfg()) : null;
    if (!canResume(uiCfg) || !V.duration) return;
    const nextT = resolveProgressTimestamp(curNow, isEnded, uiCfg.resumeMinSec, V.duration);
    const key = getStorageKey();
    if (nextT === null || (nextT === lastSavedT && key === lastSavedKey)) return;
    lastSavedT = nextT;
    lastSavedKey = key;
    writeSaved(uiCfg, { t: nextT });
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
      writeSaved(V._getUiCfg(V.getCfg()), {
        volume: st.volume,
        muted: st.rawMuted,
        voice: st.rawVoiceOn,
        bgm: st.rawBgmOn,
      });
    },
    onSubsChange(subs) {
      writeSaved(V._getUiCfg(V.getCfg()), { subs });
    },
    onEnded() {
      const uiCfg = V._getUiCfg(V.getCfg());
      if (!canResume(uiCfg)) return;
      lastSavedT = 0;
      lastSavedKey = getStorageKey();
      writeSaved(uiCfg, { t: 0 });
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
      params, renderAt, uiText, makeCtrlIcon, switchMode,
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
      V.emit('onBeforeSeek', next.globalT);
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
        const item = h('button', { type: 'button', class: 'chap-item' }, h('em', null, String(si + 1).padStart(2, '0')), h('span', { class: 'chap-it-title' }, sc.title), h('small', null, pageTag));
        item.onclick = e => { e.stopPropagation(); setOpenMenu(bar, ''); goToPage(firstIdx); };
        list.appendChild(item);
        refs.chapItems.push({ item, sceneIndex: si });
      });
      trig.onclick = e => { e.stopPropagation(); setOpenMenu(bar, bar.dataset.menu === 'chap' ? '' : 'chap'); };
    }

    function buildControlsBar(cfg, uiCfg) {
      const homeTitle = cfg.homeLabel || uiText('home');
      const homeLink = !cfg.homeUrl
        ? null
        : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl, title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
      const webLabel = uiText('webEnter');
      const webBtn = uiCfg.webFull
        ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: webLabel, 'aria-label': webLabel }, makeCtrlIcon(uiCfg.icons.webEnter))
        : null;
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
      if (bar && bar.classList.contains('menu-open')) { setOpenMenu(bar, '', true); e.preventDefault(); }
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
      if (e.defaultPrevented) return;
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
          if (e.defaultPrevented) return;
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
      isInternalRender: () => internalRender,
      getPageNo: () => pageIdx + 1,
      getTotalPages: () => pages.length,
      getPages: () => pages.map(page => ({ ...page })),
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

/* 公共帧快照与外部画面准备；业务组件通过 Promise 参与精确定位。 */
(function (V) {
  let current = null, sequence = 0, lastTick = 0, controller = null, prepared = null;
  const sources = new Map();
  const reportedErrors = new WeakSet();
  let heldId = 0;

  function abortError() { return new DOMException('Frame superseded or source removed', 'AbortError'); }

  function sceneFrame(base, scene, index) {
    return Object.freeze(Object.assign({}, base, {
      sceneIndex: index,
      lt: base.now - scene.start,
      sceneClock: base.clock - scene.start,
      energy: V.getSceneEnergy(scene, index, base.now - scene.start),
    }));
  }

  function begin(scene, index, now, clock, idle, options) {
    if (controller) controller.abort();
    controller = new AbortController();
    prepared = null;
    const ts = performance.now();
    const uiDt = options.isRecord || options.precise || !lastTick ? 0 : Math.min(0.1, (ts - lastTick) / 1000);
    lastTick = ts;
    const pointer = options.isRecord
      ? { x: 0, y: 0, nx: 0, ny: 0, sx: 0, sy: 0, rawX: 0, rawY: 0, active: false, inside: false, down: false, presence: 0, overUI: false }
      : Object.assign({}, V.pointer);
    current = sceneFrame({ id: ++sequence, now, clock, alive: clock, idle, uiDt,
      playing: options.playing, ended: options.ended, isRecord: options.isRecord,
      buffering: Boolean(options.buffering),
      subsEnabled: options.subsEnabled !== false,
      precise: Boolean(options.precise || options.isRecord),
      pptMode: Boolean(V.pptMode), pointer: Object.freeze(pointer) }, scene, index);
    return current;
  }

  function forScene(scene, index) {
    if (!current) return null;
    return index === current.sceneIndex ? current : sceneFrame(current, scene, index);
  }

  function isActive(source, frame) {
    const el = source.element();
    return Boolean(el && el.isConnected && source.active(frame));
  }

  function activeSources(frame) {
    return [...sources.values()].filter(source => isActive(source, frame));
  }

  function sourceError(source, frame, error) {
    if (error?.name === 'AbortError') return error;
    return new Error(`Frame source "${source.id}" failed (scene=${frame.sceneIndex}, time=${frame.now.toFixed(3)}): ${error?.message ?? String(error)}`, { cause: error });
  }

  function report(error, frame = current) {
    if (error?.name === 'AbortError') return;
    if (typeof error?.message !== 'string') error = new Error(String(error), { cause: error });
    let cause = error;
    const seen = new Set();
    while (cause.cause && !seen.has(cause.cause)) { seen.add(cause); cause = cause.cause; }
    if (typeof cause === 'object' && cause !== null) {
      if (reportedErrors.has(cause)) return;
      reportedErrors.add(cause);
    }
    console.error(error);
    try { V.emit('onFrameError', { frame, error }); }
    catch (cause) { console.error(new Error(`onFrameError callback failed: ${cause?.message ?? String(cause)}`, { cause })); }
  }

  function prepareSource(source, frame, parentSignal) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    parentSignal.addEventListener('abort', cancel, { once: true });
    source.pending.add(abort);
    let timer, onAbort, timeoutError;
    const stopped = new Promise((_, reject) => {
      onAbort = () => reject(timeoutError || abortError());
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    if (parentSignal.aborted) abort.abort();
    const work = Promise.resolve().then(() => source.ready ? source.ready() : undefined).then(() => {
      if (abort.signal.aborted) throw abortError();
      timer = setTimeout(() => {
        timeoutError = new Error(`Preparation timed out after ${source.timeoutMs}ms`);
        abort.abort();
      }, source.timeoutMs);
      return source.prepare(frame, { signal: abort.signal });
    });
    return Promise.race([work, stopped]).catch(error => {
      if (!parentSignal.aborted && error?.name !== 'AbortError') source.onPrepareError?.();
      throw sourceError(source, frame, error);
    }).finally(() => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', cancel);
      abort.signal.removeEventListener('abort', onAbort);
      source.pending.delete(abort);
    });
  }

  function prepare(frame) {
    if (frame !== current) return Promise.reject(abortError());
    if (!prepared) {
      const signal = controller.signal;
      prepared = Promise.resolve().then(() => activeSources(frame)).then(list =>
        Promise.all(list.map(source => prepareSource(source, frame, signal))));
    }
    return prepared.then(() => {
      if (frame !== current || controller.signal.aborted) throw abortError();
      return frame;
    });
  }

  V.frameSource = function (definition) {
    if (!definition || !definition.id || typeof definition.element !== 'function' || typeof definition.prepare !== 'function') {
      throw new TypeError('frameSource requires id, element() and prepare()');
    }
    if (sources.has(definition.id)) throw new Error(`Duplicate frame source: ${definition.id}`);
    const timeoutMs = definition.timeoutMs === undefined ? 15000 : Number(definition.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('frameSource timeoutMs must be positive');
    const source = Object.assign({ active: () => true }, definition, { timeoutMs, pending: new Set() });
    sources.set(source.id, source);
    return () => {
      if (sources.get(source.id) !== source) return;
      sources.delete(source.id);
      for (const pending of source.pending) pending.abort();
      if (source.dispose) return source.dispose();
    };
  };

  V.getFrameState = () => current;
  V._frameRuntime = { begin, forScene, prepare, report,
    readiness() {
      const list = current ? activeSources(current) : [];
      return { waiting: list.some(source => source.status && source.status() !== 'ready'),
        failed: list.some(source => source.status?.() === 'failed') };
    },
    retryActive() {
      return Promise.all((current ? activeSources(current) : []).map(source => source.retry?.()));
    },
    signal(frame) {
      if (!current || frame !== current) throw abortError();
      return controller.signal;
    },
    isHeld: () => Boolean(current && heldId === current.id),
    hold(frame) {
      heldId = frame.id;
      return () => { if (heldId === frame.id) heldId = 0; };
    },
    hasActive: () => Boolean(current && activeSources(current).length),
    preview(frame) {
      prepare(frame).catch(error => report(error, frame));
    },
  };
})(globalThis.V = globalThis.V || {});

/* 外部受管画面：共享初始化、状态提交、宿主显隐与可选 iframe 协议。 */
(function (V) {
  const PROTOCOL = 'html-video-source-v1';

  function aborted() { return new DOMException('Source operation cancelled', 'AbortError'); }

  function timeout(value, fallback, name) {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(result) || result <= 0) throw new TypeError(`${name} must be positive`);
    return result;
  }

  function initializeSource(definition, lifetime, waitMs) {
    let timer, cancel, expire;
    const stopped = new Promise((_, reject) => {
      cancel = () => reject(aborted());
      lifetime.signal.addEventListener('abort', cancel, { once: true });
      expire = () => {
        reject(new Error(`Initialization timed out after ${waitMs}ms`));
        lifetime.abort();
      };
    });
    const work = Promise.resolve(V._loading?.waitForPaint?.()).then(() => {
      if (lifetime.signal.aborted) throw aborted();
      timer = setTimeout(expire, waitMs);
      return definition.initialize?.({ signal: lifetime.signal, mode: V.environment.mode });
    });
    return Promise.race([work, stopped]).finally(() => {
      clearTimeout(timer);
      lifetime.signal.removeEventListener('abort', cancel);
    });
  }

  function removePlugin(plugin) {
    const index = V.plugins.indexOf(plugin);
    if (index >= 0) V.plugins.splice(index, 1);
  }

  V.managedSource = function (definition) {
    if (!definition?.id || typeof definition.element !== 'function' || typeof definition.prepare !== 'function') {
      throw new TypeError('managedSource requires id, element() and prepare()');
    }
    const readyMs = timeout(definition.readyTimeoutMs, 15000, 'readyTimeoutMs');
    let state = null, lifetime = null, initialized = null, initializedData, phase = 'idle';
    let disposed = false, visibility = null, previousVisibility = '', disposing = null;
    let previousActive = null;

    function ready() {
      if (disposed) return Promise.reject(aborted());
      if (initialized) return initialized;
      lifetime = new AbortController();
      phase = 'loading';
      initialized = initializeSource(definition, lifetime, readyMs).then(result => {
        if (!disposed) phase = 'ready';
        initializedData = result;
        return result;
      }, cause => {
        if (!disposed) phase = 'failed';
        if (cause?.name === 'AbortError') throw cause;
        throw new Error(`Frame source "${definition.id}" failed during initialization: ${cause?.message ?? String(cause)}`, { cause });
      });
      initialized.catch(error => { if (!disposed) V._frameRuntime.report(error); });
      return initialized;
    }

    function active(frame) {
      return !disposed && state !== null && (!definition.active || definition.active(frame, state));
    }

    function retry() {
      if (phase === 'failed') { lifetime?.abort(); lifetime = null; initialized = null; }
      return ready();
    }

    function syncHostVisibility(element, visible, frame) {
      if (!element) return;
      if (element !== visibility) {
        visibility = element;
        previousVisibility = element.style.visibility;
        previousActive = null;
      }
      const nextVisibility = visible ? previousVisibility : 'hidden';
      if (element.style.visibility !== nextVisibility) element.style.visibility = nextVisibility;
      if (previousActive !== visible) {
        previousActive = visible;
        definition.onVisibilityChange?.(visible, frame);
      }
    }

    function updateHost(frame) {
      if (disposed) return;
      const element = definition.element();
      const visible = active(frame);
      syncHostVisibility(element, visible, frame);
      const preload = typeof definition.preload === 'function' ? definition.preload(V.environment) : definition.preload;
      if (element?.isConnected && (visible || preload)) ready().catch(() => {});
    }

    const plugin = { id: `managed-source:${definition.id}`, onRender: info => updateHost(info.frame) };
    const unregister = V.frameSource({
      id: definition.id, element: definition.element, active, ready, retry, status: () => phase,
      timeoutMs: definition.timeoutMs,
      onPrepareError() { if (!disposed) phase = 'failed'; },
      prepare(frame, context) {
        if (context.signal.aborted) throw aborted();
        const preparationLifetime = lifetime;
        return Promise.resolve().then(() => definition.prepare(state, frame, { ...context, data: initializedData })).then(result => {
          if (!disposed && !context.signal.aborted && lifetime === preparationLifetime) phase = 'ready';
          return result;
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        phase = 'disposed';
        lifetime?.abort();
        removePlugin(plugin);
        if (visibility) visibility.style.visibility = previousVisibility;
        return definition.dispose?.();
      },
    });
    V.use(plugin);
    return {
      setState(next) { if (disposed) throw aborted(); state = next === undefined ? null : next; },
      ready,
      retry,
      get status() { return phase; },
      get state() { return state; },
      dispose() {
        if (!disposing) disposing = new Promise(resolve => resolve(unregister()));
        return disposing;
      },
    };
  };

  function iframeElement(definition) {
    const host = definition.element();
    const frame = host?.tagName === 'IFRAME' ? host : host?.querySelector('iframe');
    if (!frame) throw new Error('iframeSource element must contain an iframe');
    return frame;
  }

  function iframeUrl(definition, frame) {
    const value = typeof definition.src === 'function' ? definition.src() : definition.src;
    const url = new URL(value || frame.src, document.baseURI);
    if (definition.passMode !== false) {
      url.searchParams.delete('record');
      url.searchParams.delete('capture');
      url.searchParams.delete('ppt');
      if (V.environment.isRecord) url.searchParams.set('record', '1');
      else if (V.environment.pptMode) url.searchParams.set('ppt', '1');
    }
    return url;
  }

  function createIframeConnection(definition, signal, reload = false) {
    const frame = iframeElement(definition);
    const url = iframeUrl(definition, frame);
    const origin = definition.origin || url.origin;
    if (!origin || origin === '*' || origin === 'null') throw new TypeError('iframeSource requires an exact HTTP(S) origin');
    const session = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const pending = new Map();
    let sequence = 0, closed = false, completed = false, receivedHello = false, closedError;

    function send(type, requestId, payload = {}) {
      frame.contentWindow?.postMessage({ protocol: PROTOCOL, sourceId: definition.id, session,
        type, requestId, ...payload }, origin);
    }

    function request(type, payload, requestSignal) {
      if (closed) return Promise.reject(closedError || aborted());
      if (requestSignal.aborted) return Promise.reject(aborted());
      const requestId = ++sequence;
      return new Promise((resolve, reject) => {
        const cancel = () => { pending.delete(requestId); send('cancel', requestId); reject(aborted()); };
        const cleanup = () => requestSignal.removeEventListener('abort', cancel);
        pending.set(requestId, { resolve, reject, cleanup });
        requestSignal.addEventListener('abort', cancel, { once: true });
        try { send(type, requestId, payload); }
        catch (error) { pending.delete(requestId); cleanup(); reject(error); }
      });
    }

    function receive(event) {
      const data = event.data;
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      if (data?.protocol !== PROTOCOL || data.sourceId !== definition.id || data.session !== session) return;
      if (data.requestId === 0) receivedHello = true;
      const entry = pending.get(data.requestId);
      if (!entry) return;
      pending.delete(data.requestId);
      entry.cleanup();
      if (data.type === 'error') entry.reject(new Error(data.message || 'External frame failed'));
      else if (data.type === 'ready' || data.type === 'complete') entry.resolve(data.frameId);
      else entry.reject(new Error(`Unexpected iframe response: ${data.type}`));
    }

    function hello() {
      if (closed) return;
      if (completed) { dispose(new Error('External iframe reloaded; recreate the source')); return; }
      send('hello', 0, { mode: V.environment.mode });
    }

    function dispose(error = aborted()) {
      if (closed) return;
      send('dispose', 0);
      closed = true;
      closedError = error;
      window.removeEventListener('message', receive);
      frame.removeEventListener('load', hello);
      signal.removeEventListener('abort', stop);
      for (const entry of pending.values()) { entry.cleanup(); entry.reject(error); }
      pending.clear();
    }

    const stop = () => dispose();
    window.addEventListener('message', receive);
    frame.addEventListener('load', hello);
    signal.addEventListener('abort', stop, { once: true });
    const ready = new Promise((resolve, reject) => {
      pending.set(0, { resolve: value => { completed = true; resolve(value); }, reject, cleanup() {} });
    });
    if (frame.src !== url.href || reload) frame.src = url.href;
    else hello();
    return { ready, dispose, get connected() { return receivedHello; },
      prepare: (state, snapshot, context) => request('prepare', { state, frame: snapshot }, context.signal) };
  }

  V.iframeSource = function (definition) {
    let connection, element, originalDisplay = '', initialized = false, visible = false;
    function syncDisplay() {
      if (!initialized || !element || V.environment.isRecord) return;
      const display = visible ? originalDisplay : 'none';
      if (element.style.display !== display) element.style.display = display;
    }
    return V.managedSource({ ...definition,
      initialize({ signal }) {
        const reload = Boolean(connection && !connection.connected);
        connection?.dispose();
        const nextElement = iframeElement(definition);
        if (nextElement !== element) { element = nextElement; originalDisplay = element.style.display; }
        initialized = false;
        element.style.display = originalDisplay;
        connection = createIframeConnection(definition, signal, reload);
        return connection.ready.then(result => { initialized = true; syncDisplay(); return result; });
      },
      onVisibilityChange(active, frame) {
        visible = active;
        syncDisplay();
        definition.onVisibilityChange?.(active, frame);
      },
      prepare(state, frame, context) {
        return connection.prepare(state, frame, context).then(frameId => {
          if (frameId !== frame.id) throw new Error('External frame acknowledgement does not match');
        });
      },
      dispose() {
        connection?.dispose();
        connection = null;
        if (element) element.style.display = originalDisplay;
        element = null;
        return definition.dispose?.();
      },
    });
  };
})(globalThis.V = globalThis.V || {});

/* 交互值、指针响应与字幕伴随组件。组件只消费帧，不创建独立时钟。 */
(function (V) {
  const manualStates = new Set();
  const { clamp, lerp } = V.u;

  function recordFrame(frame) { return Boolean(frame ? frame.isRecord : V.environment?.isRecord); }

  V.manualState = function ({ resetOn = ['play', 'seek', 'sceneExit'], enabled = () => true } = {}) {
    const resets = new Set(resetOn);
    let active = false, value, sceneIndex, previous = null;
    const api = {
      get active() { return active; },
      get value() { return value; },
      set(next, frame = V.getFrameState()) {
        if (recordFrame(frame) || !enabled(frame)) return api;
        value = next; active = true;
        if (frame) sceneIndex = frame.sceneIndex;
        return api;
      },
      clear() { active = false; value = undefined; return api; },
      resolve(automatic, frame = V.getFrameState()) {
        if (frame && previous && resets.has('play') && frame.playing && !previous.playing) api.clear();
        if (frame && sceneIndex !== undefined && resets.has('sceneExit') && frame.sceneIndex !== sceneIndex) api.clear();
        previous = frame;
        return active && !recordFrame(frame) && enabled(frame) ? value : automatic;
      },
      reset(event, nextScene) {
        if (!resets.has(event)) return;
        if (event !== 'sceneExit' || sceneIndex !== nextScene) api.clear();
      },
      bind(owner, key, automatic) {
        if (arguments.length < 3) automatic = null;
        Object.defineProperty(owner, key, { configurable: true,
          get: () => api.resolve(automatic), set: next => next == null ? api.clear() : api.set(next) });
        return api;
      },
      dispose() { manualStates.delete(api); api.clear(); },
    };
    manualStates.add(api);
    return api;
  };

  function resetManualSeek() { for (const state of manualStates) state.reset('seek'); }

  V.use({ id: 'builtin-manual-state',
    onPlay() { for (const state of manualStates) state.reset('play'); },
    onBeforeSeek: resetManualSeek,
    onSeek: resetManualSeek,
    onSceneEnter(info) { for (const state of manualStates) state.reset('sceneExit', info.sceneIndex); },
  });

  function pointerTarget(pointer, geometry, previous) {
    const width = geometry.stageWidth || V.stageWidth || 1920;
    const height = geometry.stageHeight || V.stageHeight || 1080;
    if (pointer.inside) return { active: true, x: pointer.x, y: pointer.y };
    if (pointer.active) return { active: true,
      x: clamp(pointer.rawX, -width * 0.25, width * 1.25),
      y: clamp(pointer.rawY, -height * 0.25, height * 1.25) };
    return { active: pointer.presence > 0.001, x: previous.x, y: previous.y };
  }

  function ellipseHit(pointer, geometry, hovered) {
    const rx = geometry.hitRx || 48, ry = geometry.hitRy || 48;
    const distance = Math.hypot((pointer.x - geometry.hitX) / rx, (pointer.y - geometry.hitY) / ry);
    return distance <= (hovered ? 1.18 : 1);
  }

  function pointerHit(target, pointer, geometry, frame, state, options) {
    if (frame.playing || !target.active || pointer.overUI || geometry.opacity <= 0.15) return false;
    const width = geometry.stageWidth || V.stageWidth || 1920;
    const height = geometry.stageHeight || V.stageHeight || 1080;
    if (target.x < -20 || target.x > width + 20 || target.y < -20 || target.y > height + 20) return false;
    return (options.hitTest || ellipseHit)(target, geometry, state.hovered, frame);
  }

  function smoothPointer(state, target, focus, hit, dt, options, suppressed) {
    if (!suppressed) {
      const k = options.snapOnFirst && state.focus < 0.02 ? 1 : 1 - Math.exp(-dt * (options.positionRate || 14));
      state.x = lerp(state.x, target.x, k); state.y = lerp(state.y, target.y, k);
    }
    state.focus = lerp(state.focus, focus, 1 - Math.exp(-dt * (options.focusRate || 10)));
    state.greet = lerp(state.greet, Number(hit), 1 - Math.exp(-dt * (hit ? 13 : 10)));
    state.hoverSec = hit ? Math.min(10, (state.hovered ? state.hoverSec : 0) + dt) : 0;
    state.hovered = hit;
  }

  function pointerResult(state, geometry, options) {
    const duration = options.hopDuration || 0.36;
    const hop = state.hovered && state.hoverSec < duration ? Math.sin(state.hoverSec / duration * Math.PI) * state.greet : 0;
    const dx = state.x - geometry.x, dy = state.y - geometry.eyeY;
    return Object.freeze({ x: state.x, y: state.y, w: state.focus, focus: state.focus,
      greet: state.greet, hoverSec: state.hoverSec, hovered: state.hovered, hop,
      lx: dx / Math.hypot(dx, options.gazeDistanceX || 380),
      ly: dy / Math.hypot(dy, options.gazeDistanceY || 280) });
  }

  V.pointerResponse = function (options = {}) {
    const state = { x: 960, y: 540, focus: 0, greet: 0, hovered: false, hoverSec: 0 };
    let frameId, result = Object.freeze({ x: 960, y: 540, w: 0, focus: 0, lx: 0, ly: 0, greet: 0, hop: 0, hovered: false, hoverSec: 0 });
    return {
      update(frame = V.getFrameState(), suppliedGeometry) {
        if (!frame || frame.id === frameId) return result;
        frameId = frame.id;
        const geometry = suppliedGeometry || options.geometry?.(frame) || {};
        if (frame.isRecord) return result = Object.freeze({ ...result, w: 0, focus: 0, lx: 0, ly: 0, greet: 0, hop: 0, hovered: false });
        const pointer = frame.pointer;
        const target = pointerTarget(pointer, geometry, state);
        const suppressed = Boolean(options.suppressUIInPpt && frame.pptMode && pointer.overUI);
        const focus = !frame.playing && target.active && !suppressed ? (pointer.active ? 1 : clamp(pointer.presence)) : 0;
        const hit = pointerHit(target, pointer, geometry, frame, state, options);
        smoothPointer(state, target, focus, hit, frame.uiDt, options, suppressed);
        result = pointerResult(state, geometry, options);
        return result;
      },
      reset() { Object.assign(state, { x: 960, y: 540, focus: 0, greet: 0, hovered: false, hoverSec: 0 }); frameId = undefined; },
    };
  };

  V.subtitleCompanion = function ({ slot = 'lead', create, update, enabled = () => true }) {
    let element = null;
    const config = V.getCfg ? V.getCfg() : V.config;
    const callbacks = Object.assign({}, config.subtitles, V.subtitles);
    const previous = callbacks.onUpdate || callbacks.update;
    V.subtitle({
      [slot]: (h, runtime) => (element = create(h, runtime)),
      onUpdate(cue, info, dom) {
        if (previous) previous(cue, info, dom);
        const frame = info.frame || V.getFrameState();
        if (element && enabled(frame)) update(element, cue, { ...info, frame }, dom);
      },
    });
    return { get element() { return element; } };
  };

  V.subtitleReservation = function (options = {}) {
    const stage = Object.assign({ paddingLeft: 34 }, options.stage);
    const docked = Object.assign({ left: 146, paddingLeft: 56, maxWidth: 1660 }, options.docked);
    return {
      resolve(blend, overrides = {}, frame) {
        const k = clamp(blend);
        const target = Object.assign({}, docked, overrides);
        if (options.resolve) return options.resolve(k, target, frame);
        const align = V.pptMode ? 'center' : (V._subtitlesRuntime?.getAppearance().align || 'left');
        if (k <= 0.001) return { pos: align };
        if (align === 'center') {
          const limit = typeof target.maxWidth === 'number' ? `${target.maxWidth}px` : target.maxWidth;
          const inset = Math.min(2 * (target.left + target.paddingLeft) * k, (V.stageWidth || 1920) * 0.6).toFixed(1);
          return { pos: 'center', left: stage.left, maxWidth: `min(${limit}, calc(var(--stage-w) - ${inset}px))` };
        }
        return { pos: 'left', left: lerp(120, target.left, k), maxWidth: target.maxWidth,
          padding: `12px 34px 12px ${lerp(stage.paddingLeft, target.paddingLeft, k).toFixed(1)}px` };
      },
      apply(blend, overrides, frame = V.getFrameState()) {
        const layout = this.resolve(blend, overrides, frame);
        V.setSubLayout(layout);
        const element = options.element?.() || (typeof document === 'undefined' ? null : document.getElementById('subs'));
        if (element && layout.transform) element.style.setProperty('--sub-transform', layout.transform);
        else if (element) element.style.removeProperty('--sub-transform');
        return layout;
      },
    };
  };
})(globalThis.V = globalThis.V || {});

/* 与渲染技术无关的角色状态、连续动作和可等待的渲染器。 */
(function (V) {
  const { clamp, lerp, prog, ease, win, keyframes } = V.u;
  const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const pulse = raw => raw > 0 && raw < 1 ? Math.sin(raw * Math.PI) : 0;

  function scalarTrack(t, stops, duration = 0.3) {
    if (!Array.isArray(stops) || !stops.length) return 0;
    const keys = stops.filter(Array.isArray).map(stop => ({ at: number(stop[0], 0), value: number(stop[1], 0), dur: Math.max(0.04, number(stop[2], duration)) }));
    return keyframes(t, keys, { dur: duration }).value;
  }

  function evalTrack(t, value, fallback = 0, duration = 0.32) {
    return Array.isArray(value) ? scalarTrack(t, value, duration) : number(value, fallback);
  }

  function normalizePoses(poses, endAt, allowStart, duration) {
    const list = (poses || []).filter(Array.isArray).filter(stop => !Number.isFinite(endAt) || stop[0] < endAt - 0.02);
    if (!list.length) list.push([0, 'idle']);
    if (!allowStart && list[0][0] > 0.001) list.unshift([0, 'idle']);
    if (Number.isFinite(endAt) && list.at(-1)[1] !== 'idle') list.push([endAt, 'idle', duration]);
    return list;
  }

  function beaconAt(t, value, endAt) {
    if (t >= endAt) return false;
    if (Array.isArray(value)) return value.some(range => t >= range[0] && t < range[1]);
    return Boolean(value);
  }

  function hop(t, inAt, outAt, target, duration, dock, safe) {
    duration = Math.max(0.1, number(duration, 0.56));
    const rawIn = inAt == null ? 1 : prog(t, inAt, inAt + duration);
    const rawOut = outAt == null ? 0 : prog(t, outAt, outAt + Math.max(0.1, number(target.durOut, duration)));
    const k = ease.io(rawIn) * (1 - ease.io(rawOut));
    const x = clamp(number(target.x, dock.x), safe.minX, safe.maxX);
    const y = clamp(number(target.y, dock.y), safe.minY, safe.maxY);
    const s = clamp(number(target.s, dock.s), safe.minS, safe.maxS);
    return { k, x: lerp(dock.x, x, k), y: lerp(dock.y, y, k) + Math.sin(k * Math.PI) * number(target.arc, -36),
      s: lerp(dock.s, s, k), walk: Math.max(pulse(rawIn), pulse(rawOut)) * 0.9,
      dockBlend: 1 - k, lookBlend: k, subMode: k > 0.5 ? 'center' : 'dock', ringAlpha: clamp(1 - k * 1.75) };
  }

  function hasLookAfter(stops, after, before = Infinity) {
    return Array.isArray(stops) && stops.some(stop => stop[0] > after && stop[0] < before);
  }

  function resolveStage(t, stage, defaults) {
    if (!Array.isArray(stage)) return { ...defaults, ...stage, walk: 0 };
    const first = stage[0]?.[1] || {};
    const initial = { ...defaults, ...first };
    const keys = stage.slice(1).map(([at, state]) => ({ ...state, at, dur: Math.max(0.12, number(state.dur, 0.5)) }));
    const value = keyframes(t, keys, { init: initial });
    const walk = Math.max(0, ...keys.map(key => pulse(prog(t, key.at, key.at + key.dur)) * 0.85));
    return { ...value, walk };
  }

  function tourSegment(t, points) {
    if (t <= points[0][0] || points.length === 1) return { index: 0, fraction: 0 };
    if (t >= points.at(-1)[0]) return { index: Math.max(0, points.length - 2), fraction: 1 };
    for (let i = 0; i < points.length - 1; i++) {
      if (t >= points[i][0] && t <= points[i + 1][0]) return { index: i, fraction: ease.io(prog(t, points[i][0], points[i + 1][0])) };
    }
    return { index: 0, fraction: 0 };
  }

  function programOpening(c, t, spec, duration) {
    const start = Object.assign({ x: 960, y: c.openingY, s: 2.2 }, spec.start);
    const shift = spec.shift || {};
    const shiftDuration = Math.max(0.12, number(shift.dur, 0.65));
    const rawShift = spec.shift ? prog(t, number(shift.at, 0), number(shift.at, 0) + shiftDuration) : 0;
    const shifted = keyframes(t, [{ ...shift, at: number(shift.at, 0), dur: shiftDuration }], { init: start });
    const dockDuration = Math.max(0.2, number(spec.dockDur, 0.78));
    const latest = Math.max(0.2, duration - dockDuration - 0.12);
    const at = Math.min(number(spec.dockAt, latest), latest);
    const rawDock = prog(t, at, at + dockDuration), kDock = ease.io(rawDock);
    const settle = Math.max(at + 0.2, duration - 0.5);
    const lateLook = spec.postDockLook || hasLookAfter(spec.lookX, at + 0.05);
    return { state: { ...spec, _managed: true,
      x: lerp(shifted.x, c.dock.x, kDock), y: lerp(shifted.y, c.dock.y, kDock) + Math.sin(kDock * Math.PI) * number(spec.arc, c.openingArc),
      s: lerp(shifted.s, c.dock.s, kDock), walk: Math.max(pulse(rawShift), pulse(rawDock)) * 0.9,
      topAlpha: evalTrack(t, spec.topAlpha, V.pptMode ? ease.io(rawShift) : kDock),
      dockBlend: kDock, ringAlpha: prog(kDock, 0.45, 0.96), subMode: kDock > 0.5 ? 'dock' : 'center',
      poses: normalizePoses(spec.poses || [[0, 'wave'], [at + 0.16, 'idle']], settle, true, c.poseDuration),
      lookBlend: lateLook ? 1 - ease.io(prog(t, settle, duration - 0.06)) : 1 - kDock,
      tilt: spec.tilt === undefined ? undefined : evalTrack(t, spec.tilt) * (1 - kDock), beacon: beaconAt(t, spec.beacon, settle) },
      result: { kShift: ease.io(rawShift), kDock } };
  }

  function programDocked(c, t, spec, duration) {
    const settle = Math.max(0.5, duration - 0.5);
    const fade = 1 - ease.io(prog(t, settle, duration - 0.06));
    const hasLook = spec.lookX !== undefined || spec.lookY !== undefined;
    return { state: { ...spec, ...c.dock, _managed: true, dockBlend: 1, ringAlpha: 1, subMode: 'dock',
      topAlpha: evalTrack(t, spec.topAlpha, 1),
      poses: normalizePoses(spec.poses, settle, false, c.poseDuration),
      lookBlend: hasLook ? ease.io(win(t, 0.24, duration - 0.5, 0.36)) : 0,
      tilt: spec.tilt === undefined ? undefined : evalTrack(t, spec.tilt) * fade,
      dark: evalTrack(t, spec.dark) * (spec.darkHoldEnd ? 1 : fade), beacon: beaconAt(t, spec.beacon, settle) } };
  }

  function cameoTiming(t, spec, duration) {
    const enter = Math.max(0.16, number(spec.dur, 0.54)), leave = Math.max(0.16, number(spec.durOut, enter));
    const at = Math.max(0.02, number(spec.inAt, 0.06));
    const latest = Math.max(at + enter + 0.08, duration - leave - 0.08);
    const out = spec.outAt == null ? latest : Math.min(number(spec.outAt, latest), latest);
    return { enter, leave, at, out, fade: 1 - ease.io(prog(t, out, out + leave)) };
  }

  function cameoLook(t, spec, duration, timing, h, keep) {
    if (keep) return 1;
    const early = spec.dockLook || hasLookAfter(spec.lookX, 0.05, timing.at - 0.1);
    return early ? Math.max(h.k, ease.io(win(t, 0.24, Math.min(timing.out, duration - 0.5), 0.36))) : h.k;
  }

  function programCameo(c, t, spec, duration) {
    const stage = resolveStage(t, spec.stage, { ...c.cameoStage, arc: number(spec.arc, c.cameoStage.arc) });
    const timing = cameoTiming(t, spec, duration);
    const keep = Boolean(V.pptMode && spec.pptKeep), settle = keep ? duration + 99 : timing.out;
    const h = keep ? { k: 1, subMode: 'center', dockBlend: 0, ringAlpha: 0, ...stage, walk: 0 }
      : hop(t, timing.at, timing.out, { ...stage, durOut: timing.leave }, timing.enter, c.dock, c.safe);
    return { state: { ...spec, ...stage, ...h, _managed: true, walk: Math.max(h.walk, stage.walk * h.k),
      poses: normalizePoses(spec.poses, settle, false, c.poseDuration),
      lookBlend: cameoLook(t, spec, duration, timing, h, keep),
      tilt: spec.tilt === undefined ? undefined : evalTrack(t, spec.tilt) * h.k,
      dark: spec.dark === 'hop' ? h.k : evalTrack(t, spec.dark) * (keep ? 1 : timing.fade),
      beacon: beaconAt(t, spec.beacon === 'hop' ? h.k > 0.5 : spec.beacon, settle) }, result: h };
  }

  function tourPosition(t, spec, points, segment) {
    const a = points[segment.index], b = points[Math.min(points.length - 1, segment.index + 1)];
    const x = lerp(number(a[1], 960), number(b[1], 960), segment.fraction);
    const y = lerp(number(a[2], 520), number(b[2], 520), segment.fraction);
    const s = spec.s === undefined ? lerp(number(a[3], 1.05), number(b[3], 1.05), segment.fraction) : evalTrack(t, spec.s, 1.05);
    const lookX = spec.lookX === undefined && points.length > 1 ? clamp((number(b[1], x) - number(a[1], x)) / 120, -0.9, 0.9) : spec.lookX;
    return { x, y, s, lookX };
  }

  function programTour(c, t, spec, duration) {
    const points = spec.waypoints?.length ? spec.waypoints : [[0.5, 960, 520, 1.1]];
    const first = points[0], last = points.at(-1), segment = tourSegment(t, points);
    const position = tourPosition(t, spec, points, segment);
    const enter = Math.max(0.16, number(spec.dur, 0.5)), at = Math.max(0.04, number(spec.inAt, first[0] - 0.55));
    const latest = Math.max(at + enter + 0.1, duration - enter - 0.08);
    const out = spec.outAt == null ? latest : Math.min(number(spec.outAt, latest), latest);
    const h = hop(t, at, out, { ...position, arc: number(spec.arc, -22) }, enter, c.dock, c.safe);
    const walk = points.length > 1 ? ease.io(prog(t, first[0] - 0.22, first[0] + 0.14)) * (1 - ease.io(prog(t, last[0] - 0.18, last[0] + 0.18))) * 0.9 : 0;
    return { state: { ...spec, ...h, _managed: true, topAlpha: evalTrack(t, spec.topAlpha, 1),
      walk: Math.max(h.walk, walk * h.k), poses: normalizePoses(spec.poses || [[at + 0.08, 'guide']], out, false, c.poseDuration),
      lookX: position.lookX, lookBlend: h.k, beacon: beaconAt(t, spec.beacon, out) },
      result: { ...h, segIdx: segment.index, segFrac: segment.fraction } };
  }

  function programFinale(c, t, spec) {
    const stage = { x: 960, y: 470, s: 1.92, arc: -42, ...spec.stage };
    const at = number(spec.returnAt === undefined ? spec.inAt : spec.returnAt, 0.2);
    const h = spec.fromDock === false ? { k: 1, ...stage, subMode: 'center', dockBlend: 0, ringAlpha: 0 }
      : hop(t, at, null, stage, Math.max(0.2, number(spec.dur, 0.76)), c.dock, c.safe);
    const poses = spec.fromDock === false ? [[0, 'present'], [1, 'wave']] : [[0, 'idle'], [at + 0.15, 'wave']];
    const early = spec.lookX !== undefined || spec.lookY !== undefined;
    return { state: { ...spec, ...h, s: spec.fromDock === false ? evalTrack(t, stage.s, 1.92) : h.s, _managed: true, persistStage: true,
      topAlpha: evalTrack(t, spec.topAlpha, 1 - h.k),
      poses: normalizePoses(spec.poses || poses, null, spec.fromDock === false, c.poseDuration),
      lookBlend: early ? Math.max(h.k, ease.io(prog(t, 0.24, 0.64))) : h.k,
      beacon: beaconAt(t, spec.beacon === 'hop' ? h.k > 0.5 : spec.beacon, Infinity) }, result: h };
  }

  function poseTrack(t, stops, duration, poseFromName, mix) {
    if (!stops?.length) return poseFromName('idle');
    let state = poseFromName(stops[0][1]);
    for (const [at, name, span = duration] of stops.slice(1)) {
      const k = ease.io(prog(t, at, at + Math.max(0.06, number(span, duration))));
      if (k > 0) state = mix(state, poseFromName(name), k, lerp);
    }
    return state;
  }

  function defaultMix(from, to, k) {
    const output = { ...from, ...to };
    for (const field of Object.keys(output)) {
      output[field] = typeof from[field] === 'number' && typeof to[field] === 'number' ? lerp(from[field], to[field], k) : (k < 0.5 ? from[field] : to[field]);
    }
    return output;
  }

  const PROGRAMS = { opening: programOpening, docked: programDocked, cameo: programCameo, tour: programTour, finale: programFinale };

  function makeMotion(definition, submit) {
    const c = { dock: { x: 138, y: 1035, s: 0.9 }, safe: { minX: 110, maxX: 1810, minY: 130, maxY: 1035, minS: 0.5, maxS: 2.6 },
      openingY: 468, openingArc: -42, cameoStage: { x: 310, y: 536, s: 1.88, arc: -34 }, poseDuration: 0.44, ...definition.motion };
    const api = { kf: scalarTrack, evalTrack,
      hop: (t, enter, leave, target, duration = 0.56) => hop(t, enter, leave, target, duration, c.dock, c.safe),
      poseTrack: (t, stops, duration = c.poseDuration) => poseTrack(t, stops, duration, definition.poseFromName || (pose => ({ pose })), definition.poseMix || defaultMix),
    };
    for (const [name, program] of Object.entries({ ...PROGRAMS, ...definition.programs })) api[name] = (scene, t, spec = {}) => {
      const sceneIndex = typeof scene === 'object' ? V.scenes.indexOf(scene) : scene;
      const duration = number(V.scenes[sceneIndex]?.duration, 20);
      const output = program(c, Math.max(0, t), spec, duration);
      submit(output.state, V.getFrameState(), { sceneIndex, lt: t });
      return output.result;
    };
    return api;
  }

  function actorHost(definition, layerParent) {
    const existing = definition.element?.();
    if (existing) return { element: existing, owned: false };
    if (typeof document === 'undefined') return { element: null, owned: false };
    const element = V.u.h('div', { class: 'video-actor', 'data-actor-id': definition.id });
    const parent = definition.parent?.() || layerParent || document.getElementById('stage');
    if (parent) parent.appendChild(element);
    return { element, owned: true };
  }

  V.actor = function (definition) {
    if (!definition?.id || !definition.renderer) throw new TypeError('actor requires id and renderer');
    const renderer = definition.renderer;
    let mounted = null, ready = null, current = null, source = null, disposed = false, disposal = null, cleanup = null;
    let layer = null, layerParent = null, ownedLayer = false;
    const context = (request = current, extra = {}) => ({ ...request, element: mounted?.element, data: mounted?.data,
      capabilities: renderer.capabilities || {}, ...extra });

    function apply(request, extra) {
      try {
        const updated = renderer.update?.(request.state, context(request, extra));
        if (updated && typeof updated.then === 'function') {
          Promise.resolve(updated).catch(() => {});
          throw new TypeError('actor renderer.update must be synchronous; use prepare');
        }
      } catch (error) { request.failed = true; request.error = error; }
      request.applied = true;
    }

    function cleanupRenderer() {
      if (!cleanup) {
        cleanup = Promise.resolve().then(() => renderer.dispose?.(context()));
        cleanup.catch(error => V._frameRuntime.report(error, current?.frame));
      }
      return cleanup;
    }

    async function initializeRenderer(frame, { signal, mode }) {
      try {
        mounted.data = await renderer.mount?.(mounted.element, { frame, signal, mode, capabilities: renderer.capabilities || {} });
      } catch (error) {
        mounted.settled = true;
        if (signal.aborted || disposed) await cleanupRenderer();
        throw error;
      }
      mounted.settled = true;
      if (signal.aborted || disposed) {
        await cleanupRenderer();
        throw new DOMException('Actor disposed', 'AbortError');
      }
      mounted.pending = false;
      return mounted.data;
    }

    function mount(frame) {
      if (mounted || disposed) return ready;
      mounted = actorHost(definition, layerParent);
      mounted.pending = true;
      source = V.managedSource({ id: `actor:${definition.id}`, element: () => mounted?.element,
        active: (_frame, request) => request.state.visible !== false,
        timeoutMs: definition.timeoutMs, readyTimeoutMs: definition.readyTimeoutMs,
        initialize: options => initializeRenderer(frame, options),
        async prepare(request, preparedFrame, { signal, data }) {
          if (signal.aborted || disposed || current !== request) throw new DOMException('Actor frame superseded', 'AbortError');
          const extra = { frame: preparedFrame, signal, data };
          if (!request.applied) apply(request, extra);
          if (request.failed) throw request.error;
          if (renderer.prepare) await renderer.prepare(request.state, context(request, extra));
          if (signal.aborted || disposed) throw new DOMException('Actor frame superseded', 'AbortError');
        },
      });
      ready = source.ready().then(() => mounted.element);
      ready.catch(() => {});
      return ready;
    }

    const reservation = definition.subtitle ? V.subtitleReservation(definition.subtitle) : null;
    const api = {
      capabilities: Object.freeze({ ...(renderer.capabilities || {}) }),
      mount,
      update(state, frame = V.getFrameState(), extra = {}) {
        if (disposed) throw new Error(`Actor "${definition.id}" is disposed`);
        mount(frame);
        current = { state: Object.freeze({ ...definition.defaults, ...state }), frame, sceneIndex: frame?.sceneIndex, lt: frame?.lt, ...extra };
        source.setState(current);
        if (reservation && definition.autoSubtitle !== false) reservation.apply(number(state.dockBlend, 0), definition.reserve?.(state, frame), frame);
        if (!mounted.pending) apply(current);
        return current.state;
      },
      stage(state, frame) { return api.update({ dockBlend: 0, subMode: 'center', ...state }, frame); },
      transition(from, to, fraction, frame) { return api.update((definition.mix || defaultMix)(from, to, clamp(fraction)), frame); },
      reserveSubtitle: (fraction, overrides, frame) => reservation?.apply(fraction, overrides, frame),
      dispose() {
        if (disposal) return disposal;
        disposed = true;
        const layerIndex = V.layers.indexOf(layer);
        if (layerIndex >= 0) V.layers.splice(layerIndex, 1);
        const sourceDisposal = source?.dispose();
        disposal = (async () => {
          try { await sourceDisposal; await ready; } catch {}
          try { if (!mounted || mounted.settled) await cleanupRenderer(); }
          finally {
            if (mounted?.owned) mounted.element?.remove();
            if (ownedLayer) layerParent?.remove();
          }
        })();
        return disposal;
      },
    };
    Object.assign(api, makeMotion(definition, api.update));
    if (definition.layer) {
      const existing = typeof document === 'undefined' ? null : document.getElementById(`layer-${definition.id}`);
      layer = V.layer({ ...definition.layer, id: definition.id,
        build(element) { layerParent = element; ownedLayer = element !== existing; api.mount(V.getFrameState()); return mounted.element; },
        update: (state, info) => api.update(state, info.frame) });
    }
    return api;
  };
})(globalThis.V = globalThis.V || {});

/* core/13-player.js · 舞台挂载、紧凑全图标控制栏、PotPlayer 热区速隐、实时进度浮窗、OSD 轻提示与 V.boot 启动器 */
(function (V) {
  if (typeof location === 'undefined') return;
  const { clamp, h, toggle, syncVideoClip } = V.u;
  const getUiCfg = V._getUiCfg;
  const makeCtrlIcon = V._makeCtrlIcon;
  const swapBtnIcon = V._swapBtnIcon;
  const fmtTime = V._fmtTime;
  const fmtRate = V._fmtRate;

  const params = new URLSearchParams(location.search);
  const RECORD = params.has('record') || params.has('capture');
  const DEV = params.has('dev') && !RECORD;
  V._isRecord = RECORD;

  let stage = null, current = null, now = 0, prevRenderNow = 0, playing = false;
  let lastTs = 0, lastFrameTs = 0, ambientOffset = 0, idleSec = 0, ended = false, scrubbing = false;
  let buffering = false, bufferingError = '', waitingAssets = false;
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false;
  let lastSeekTarget = -1, lastSeekAt = 0, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null, idleTimer = 0, osdTimer = 0;
  let pointerInPlayer = false, lastPtrX = -9999, lastPtrY = -9999;
  const ptr = (V.pointer = V.pointer || {
    x: 960, y: 540, rawX: 960, rawY: 540, nx: 0, ny: 0, sx: 0, sy: 0, presence: 0, active: false, inside: false, down: false, overUI: false,
  });
  let wipeState = { name: '', handler: null, dom: null };
  const sandboxState = { active: false, entering: false, autoExitOnLast: true, returnTime: null, el: null, txtEl: null, backEl: null };
  const ui = {};
  const cssImageDecodes = new Map();
  let audioRt = null;
  let pptRt = null;
  let localeSwitch = Promise.resolve();
  let localeLoading = false;

  function navigateModeSwitch(toPpt, sceneIdx) {
    try {
      const u = new URL(location.href);
      ['t', 'page', 'autoplay', '_hmr'].forEach(k => u.searchParams.delete(k));
      if (toPpt) u.searchParams.set('ppt', '1');
      else u.searchParams.delete('ppt');
      if (sceneIdx > 0) u.searchParams.set('scene', String(sceneIdx));
      else u.searchParams.delete('scene');
      if (V.__langOverridden && V.getActiveLang) {
        const lang = V.getActiveLang();
        if (lang && (!V.isSecondaryLocale || V.isSecondaryLocale(lang))) u.searchParams.set('lang', lang);
      }
      location.href = u.toString();
    } catch {}
  }

  function ensurePptRuntime() {
    if (pptRt || !V._createPptRuntime) return pptRt;
    pptRt = V._createPptRuntime({
      params,
      renderAt: t => { ambientOffset = 0; render(t, 0); },
      uiText,
      makeCtrlIcon,
      switchMode: navigateModeSwitch,
      renderCustomControls,
      setOpenMenu,
      toggleOsFull,
      fallbackWebFull,
      exitWebFullIfActive: () => {
        if (!isOsFull() && webFull) { setWebFull(false); return true; }
        return false;
      },
      bindMenuAutoClose,
    });
    V._pptRuntime = pptRt;
    return pptRt;
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

  function uiText(key, vars) {
    return V.uiStr ? V.uiStr(key, vars) : key;
  }

  function addPptxDownload(bar, cfg, uiCfg) {
    const presentations = document.querySelectorAll('link[rel="alternate"][type="application/vnd.openxmlformats-officedocument.presentationml.presentation"][href]');
    const byMode = new Map(Array.from(presentations, item => [item.dataset.pptxMode || 'image', item.href]));
    const modes = ['image', 'editable'].filter(mode => byMode.has(mode));
    if (!modes.length) return;
    const icon = () => makeCtrlIcon(uiCfg.icons.download);
    const label = uiText('downloadPptx');
    const fileAttrs = mode => ({
      href: byMode.get(mode),
      download: `${cfg.id || 'presentation'}${mode === 'editable' ? '-editable' : ''}.pptx`,
    });
    const optionLabel = mode => uiText(mode === 'image' ? 'downloadPptxImage' : 'downloadPptxEditable');
    const fullButton = bar.querySelector('[data-act="full"]');
    if (modes.length === 1) {
      const title = modes[0] === 'image' ? label : `${label} · ${optionLabel(modes[0])}`;
      bar.insertBefore(h('a', { ...fileAttrs(modes[0]), class: 'ctrl-rbtn ctrl-icon-btn ctrl-pptx-download',
        title, 'aria-label': title }, icon()), fullButton);
      return;
    }
    const trigger = h('button', { type: 'button', class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'pptx-menu',
      title: label, 'aria-label': label, 'aria-expanded': 'false' }, icon());
    trigger.onclick = () => setOpenMenu(bar, bar.dataset.menu === 'pptx' ? '' : 'pptx');
    const links = modes.map(mode => {
      const link = h('a', { ...fileAttrs(mode), class: 'pptx-download-option', 'data-pptx-mode': mode }, optionLabel(mode));
      link.onclick = () => setOpenMenu(bar, '');
      return link;
    });
    bar.insertBefore(h('div', { class: 'pptx-wrap' }, trigger, h('div', { class: 'pptx-menu' }, links)), fullButton);
  }

  function buildControlsBar(cfg, uiCfg) {
    const homeTitle = cfg.homeLabel || uiText('home');
    const homeLink = !cfg.homeUrl
      ? null
      : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl, title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
    const rateLabel = uiText('rate', { rate: '1.0x' });
    const rateWrap = uiCfg.rate
      ? h('div', { class: 'rate-wrap' },
          h('button', { class: 'ctrl-rbtn ctrl-icon-btn rate-trigger', 'data-act': 'rate', title: rateLabel, 'aria-label': rateLabel }, makeCtrlIcon(uiCfg.icons.rate)),
          h('div', { class: 'rate-menu' }))
      : null;
    const webLabel = uiText('webEnter');
    const pptBtn = cfg.ppt
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'to-ppt', title: uiText('switchToPpt'), 'aria-label': uiText('switchToPpt') }, makeCtrlIcon(uiCfg.icons.pptMode))
      : null;
    const webFullBtn = uiCfg.webFull
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: webLabel, 'aria-label': webLabel }, makeCtrlIcon(uiCfg.icons.webEnter))
      : null;
    const playLabel = uiText('play');
    const subsLabel = uiText('subtitles');
    const fullLabel = uiText('fullEnter');
    return h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { class: 'ctrl-icon-btn', 'data-act': 'play', 'data-state': 'paused', 'aria-pressed': 'false', title: playLabel, 'aria-label': playLabel }, makeCtrlIcon(uiCfg.icons.play)),
      ...renderCustomControls('left', uiCfg),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track', role: 'slider', tabindex: '0', 'aria-label': uiText('progressLabel'), 'aria-valuemin': '0' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' }), h('div', { class: 'track-tip' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: uiText('chapTrigger') }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, makeCtrlIcon(uiCfg.icons.chapCaret))),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, uiText('chapHeader')), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right', uiCfg),
      rateWrap,
      h('div', { class: 'subs-wrap' },
        h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'subs', type: 'button', title: subsLabel, 'aria-label': subsLabel,
          'aria-controls': 'subtitle-settings', 'aria-expanded': 'false' }, makeCtrlIcon(uiCfg.icons.subsOn)),
        h('div', { id: 'subtitle-settings', class: 'subs-menu', role: 'group', inert: true })),
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'mute', title: uiText('soundOnTip', { pct: 100 }), 'aria-label': uiText('soundLabel') }, makeCtrlIcon(uiCfg.icons.volumeOn)),
      h('div', { class: 'sound-menu' }),
      pptBtn,
      webFullBtn,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: fullLabel, 'aria-label': fullLabel }, makeCtrlIcon(uiCfg.icons.fullEnter)));
  }

  V.mountStage = function () {
    const cfg = V.getCfg();
    if (!cfg.ppt) V.pptMode = false;
    const uiCfg = getUiCfg(cfg);
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (!ptr.inside) { ptr.x = W / 2; ptr.y = H / 2; }
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    document.body.classList.toggle('ctrl-overlay', uiCfg.controlsMode === 'overlay');
    document.body.classList.toggle('ppt-mode', Boolean(V.pptMode));
    if (document.getElementById('stage')) return;

    const sbTxt = h('span', { class: 'v-sandbox-txt egg-ban-txt' }, uiText('sandboxActive'));
    const sbBack = h('button', { class: 'v-sandbox-back egg-back-btn', 'data-interactive': '1', type: 'button' }, uiText('sandboxBack'));
    const sbBar = h('div', { class: 'v-sandbox-bar egg-banner', 'data-interactive': '1' }, sbTxt, sbBack);
    const osdEl = h('div', { id: 'osd', 'aria-live': 'polite' });
    ui.bufferingText = h('span');
    ui.retry = h('button', { type: 'button', hidden: true, 'data-interactive': '1' }, uiText('retryPlayback'));
    ui.retry.onclick = retryPlaybackAssets;
    ui.buffering = h('div', { id: 'buffering-status', role: 'status', 'aria-live': 'polite', 'data-interactive': '1' }, ui.bufferingText, ui.retry);
    if (V._loading) {
      ui.loadingSpinner = h('span', { class: 'video-loading-spinner', 'aria-hidden': 'true', hidden: true });
      ui.buffering.classList.add('video-loading-panel');
      ui.buffering.prepend(ui.loadingSpinner);
    }
    sandboxState.el = sbBar;
    sandboxState.txtEl = sbTxt;
    sandboxState.backEl = sbBack;
    ui.osd = osdEl;

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
      osdEl,
      ui.buffering,
      h('div', { id: 'start-hint' }, cfg.startHint || uiText('startHint')));

    const bar = V.pptMode ? ensurePptRuntime().buildControlsBar(cfg, uiCfg) : buildControlsBar(cfg, uiCfg);
    document.body.prepend(vp, bar);
  };

  function sceneAt(t) {
    for (const sc of V.scenes) if (t < sc.start + sc.duration) return sc;
    return V.scenes[V.scenes.length - 1];
  }

  function enter(sc) {
    if (current && current.root) current.root.remove();
    V._videoClips.clear();
    if (V._subtitlesRuntime && V._subtitlesRuntime.resetSceneSubLayout) {
      V._subtitlesRuntime.resetSceneSubLayout();
    }
    const si = V.scenes.indexOf(sc);
    V._currentSceneIdx = si;
    sc.root = h('div', { class: 'scene ' + (sc.cls || '') });
    sc.ctx = V.makeCtx(sc, si);
    stage.appendChild(sc.root);
    V._inSceneBuild = true;
    V._inSceneUpdate = true;
    try {
      sc.build(sc.root, sc.ctx);
      if (V.localizeDom) V.localizeDom(sc.root, si);
    } finally {
      V._inSceneBuild = false;
      V._inSceneUpdate = false;
    }
    current = sc;
    if (audioRt && audioRt.syncSceneVolume) audioRt.syncSceneVolume();
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

  function resolveCutDur(cutSc, cfg, handler) {
    if (cutSc && cutSc.transitionDur !== undefined) return cutSc.transitionDur;
    return cfg.transitionDur === undefined ? (handler.dur || 0.28) : cfg.transitionDur;
  }

  function runTransition() {
    if (current && current.root) {
      current.root.style.transform = '';
      current.root.style.opacity = '';
    }
    if (V.pptMode) return;
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
    handler.update(wipeState.dom, near, resolveCutDur(cutSc, cfg, handler), current, cfg);
  }

  function updateHud() {
    const el = document.getElementById('hud');
    if (!el || el.classList.contains('is-off') || !(V.duration > 0)) return;
    const steps = Math.max(400, (V.stageWidth || 1920) * 2);
    const q = Math.round(clamp(now / V.duration) * steps) / steps;
    el.querySelector('.hud-bar').style.width = (q * 100).toFixed(4) + '%';
  }

  function syncSceneVideoClips(lt) {
    const tick = V._renderTick || 0;
    for (const clip of V._videoClips) {
      if (!clip.isConnected) continue;
      if (clip._vclip && clip._vclip._syncedTick === tick) continue;
      syncVideoClip(clip, lt, playing && !scrubbing && !localeLoading);
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
    if (opts.sfx !== false && V.sfx) V.sfx(opts.sfx || 'pop', 0.45);
    const prefix = opts.prefix === undefined ? uiText('sandboxPrefix') : opts.prefix;
    const label = opts.hint ? prefix + opts.hint : uiText('sandboxActive');
    const last = V.scenes[V.scenes.length - 1];
    sandboxState.autoExitOnLast = !last || target < last.start;
    sandboxState.returnTime = Number.isFinite(opts.returnTime) ? opts.returnTime : resolveDefaultSandboxReturn();
    sandboxState.entering = true;
    setSandboxActiveDom(true, label, opts.backLabel || uiText('sandboxBack'));
    seek(target);
    pause();
    sandboxState.entering = false;
  }

  function tryEgg(targetTime, hint, opts) {
    enterSandbox(Object.assign({}, opts || {}, { targetTime, hint }));
  }

  function replay() {
    ambientOffset = 0;
    idleSec = 0;
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

  function shouldContinueSceneAtEnd(sc, idle) {
    if (!ended || idle <= 0 || !sc.live || sc.freezeTimelineAtEnd) return false;
    return sc === V.scenes[V.scenes.length - 1];
  }

  function syncSceneCtxAndEndState(sc, idle) {
    ended = !playing && now >= V.duration - 0.01;
    document.body.classList.toggle('is-ended', ended);
    if (sandboxState.active && !sandboxState.entering && sandboxState.autoExitOnLast && sc === V.scenes[V.scenes.length - 1]) {
      setSandboxActiveDom(false);
    }
    if (sc !== current) enter(sc);
    sc.ctx.clock = V._clock;
    sc.ctx.alive = V._clock;
    sc.ctx.sceneClock = V._clock - sc.start;
    sc.ctx.idle = idle;
    sc.ctx.playing = playing && !scrubbing && !localeLoading;
    sc.ctx.ended = ended;
    sc.ctx.pointer = ptr;
    sc.ctx.frame = V.getFrameState();
  }

  function runSceneUpdate(sc, lt, idle) {
    V._renderTick = (V._renderTick || 0) + 1;
    V._isPlaying = playing && !scrubbing && !localeLoading;
    V._inSceneUpdate = true;
    try {
      sc.update(shouldContinueSceneAtEnd(sc, idle) ? lt + idle : lt, sc.ctx);
    } finally {
      V._inSceneUpdate = false;
    }
  }

  function publishFrame(sc, clock, idle, precise) {
    ended = !playing && now >= V.duration - 0.01;
    V._frameRuntime.begin(sc, V.scenes.indexOf(sc), now, clock, idle, {
      playing: playing && !scrubbing && !localeLoading, ended, buffering, subsEnabled: showSubs, isRecord: RECORD, precise,
    });
  }

  function syncPlaybackFrame() {
    const previous = V.getFrameState();
    const active = playing && !scrubbing && !localeLoading;
    if (!current || !previous || (previous.playing === active && previous.ended === ended)) return;
    publishFrame(current, previous.clock, idleSec, true);
    syncSceneCtxAndEndState(current, idleSec);
    V._isPlaying = active;
    if (!RECORD) V._frameRuntime.preview(V.getFrameState());
  }

  function completeFrameUI() {
    if (RECORD) return;
    updateUI();
    V._frameRuntime.preview(V.getFrameState());
  }

  function render(t, nextIdle, precise = true) {
    if (!V.scenes.length || !Number.isFinite(t)) return;
    const idle = RECORD ? 0 : (nextIdle === undefined ? idleSec : nextIdle);
    idleSec = idle;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    const clock = RECORD ? now : now + ambientOffset;
    prevRenderNow = now;
    V._now = now;
    V._clock = clock;
    if (RECORD || V.pptMode) V._checkpointsRuntime.syncRecordCheckpoints(now);
    const sc = sceneAt(now);
    publishFrame(sc, clock, idle, precise);
    syncSceneCtxAndEndState(sc, idle);
    const lt = now - sc.start;
    const idx = V.scenes.indexOf(sc);

    runTransition();
    if (V.gl && V.gl.ready) V.gl.render(now, clock);
    updateHud();
    stage.style.setProperty('--tg', ((clock % 6) / 6) * 150);
    stage.style.setProperty('--anim-t', (-clock).toFixed(3) + 's');
    document.body.classList.toggle('started', now > 0.05);
    const videoCue = V.pptMode ? null : V._subtitlesRuntime.prepareVideoCue(sc, lt);
    runSceneUpdate(sc, lt, idle);
    syncSceneVideoClips(lt);
    activeCueIdx = V._subtitlesRuntime.updateSubs(sc, idx, lt, now, clock, showSubs, videoCue);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    if (!RECORD && !V.pptMode) V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: false, playing, scrubbing, pause, play });
    const aState = audioRt ? audioRt.getState(now) : { hasAudio: false, muted: false, voiceOn: true, volume: 1 };
    V.emit('onRender', {
      frame: V.getFrameState(),
      now, clock, alive: clock, idle, ended, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx,
      playing, scrubbing, buffering, sandbox: sandboxState.active, pointer: ptr,
      hasAudio: aState.hasAudio, isRecord: RECORD, muted: aState.muted, voiceOn: aState.voiceOn !== false, volume: aState.volume,
    });
    completeFrameUI();
  }

  function scheduleUiHide(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.remove('ui-active'), ms);
  }

  function flashUi(ms = 1500) {
    if (document.hidden || !document.hasFocus()) return;
    document.body.classList.add('ui-active');
    scheduleUiHide(ms);
  }

  function flashOsd(text, ms = 680) {
    const uiCfg = getUiCfg(V.getCfg());
    if (RECORD || !uiCfg.osd || !ui.osd || !text) return;
    ui.osd.textContent = text;
    ui.osd.classList.add('is-show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => { if (ui.osd) ui.osd.classList.remove('is-show'); }, ms);
  }
  V.flashOsd = flashOsd;

  function syncVolumeSliderUI(st) {
    const pct = st.muted ? 0 : Math.round(st.volume * 100);
    if (ui.volRange) {
      ui.volRange.value = String(pct);
      ui.volRange.style.setProperty('--vol-pct', pct + '%');
    }
    if (ui.volVal) ui.volVal.textContent = pct + '%';
  }

  function syncSoundLabelsUI(st) {
    if (ui.volRange) ui.volRange.setAttribute('aria-label', uiText('volAria'));
    if (ui.soundVoiceTxt) ui.soundVoiceTxt.textContent = uiText('voiceItem');
    if (ui.soundBgmTxt) ui.soundBgmTxt.textContent = uiText('bgmItem');
    if (ui.soundMuteTxt) ui.soundMuteTxt.textContent = st.hasBgm ? uiText('muteAllItem') : uiText('muteItem');
    if (!ui.langItems) return;
    const active = ((V.getActiveLang && V.getActiveLang()) || (V.getBaseLang && V.getBaseLang()) || '').toLowerCase();
    ui.langItems.forEach(({ el, code }) => toggle(el, 'on', code.toLowerCase() === active));
  }

  function syncSoundMenuUI() {
    if (!audioRt) return;
    const st = audioRt.getState(now);
    if (ui.mute) {
      const icons = getUiCfg(V.getCfg()).icons;
      const [key, label] = audioRt.resolveSoundBtnSpec();
      ui.mute.classList.toggle('is-off', st.muted);
      ui.mute.classList.toggle('is-blocked', Boolean(st.audioBlocked && !st.muted));
      ui.mute.dataset.soundMode = key;
      swapBtnIcon(ui.mute, key, icons[key], label);
    }
    syncVolumeSliderUI(st);
    syncSoundLabelsUI(st);
    if (ui.soundVoice) { ui.soundVoice.hidden = !st.hasBgm; toggle(ui.soundVoice, 'on', st.voiceOn); }
    if (ui.soundBgm) { ui.soundBgm.hidden = !st.hasBgm; toggle(ui.soundBgm, 'on', st.bgmOn); }
    if (ui.soundSepBgm) ui.soundSepBgm.hidden = !st.hasBgm;
    if (ui.soundAllMute) toggle(ui.soundAllMute, 'on', st.muted);
  }

  function stepVolumeBy(delta, showOsd = true) {
    if (!audioRt) return;
    const cur = audioRt.getState(now);
    const base = cur.muted && cur.volume <= 0.001 ? 0 : cur.volume;
    const next = Math.round(clamp(base + delta, 0, 1) * 100) / 100;
    audioRt.setVolume(next);
    if (!showOsd) return;
    const pct = Math.round(next * 100);
    flashOsd(pct <= 0 ? uiText('osdMutedZero') : uiText('osdVol', { pct }));
  }

  function bindVolumeWheel(el) {
    if (!el || el._wheelBound) return;
    el._wheelBound = true;
    el.addEventListener('wheel', e => {
      if (!e.deltaY) return;
      e.preventDefault();
      e.stopPropagation();
      stepVolumeBy(e.deltaY < 0 ? 0.05 : -0.05, true);
    }, { passive: false });
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

  function dampAxis(cur, target, k) {
    const next = cur + (target - cur) * k;
    return Math.abs(target - next) < 0.0005 ? target : next;
  }

  function syncStagePointerVars() {
    if (RECORD || !stage) return;
    const sig = `${ptr.sx.toFixed(4)}|${ptr.sy.toFixed(4)}|${ptr.presence.toFixed(4)}|${Math.round(ptr.x)}|${Math.round(ptr.y)}|${ptr.inside ? 1 : 0}`;
    if (stage._ptrSig === sig) return;
    stage._ptrSig = sig;
    stage.style.setProperty('--ptr-x', ptr.sx.toFixed(4));
    stage.style.setProperty('--ptr-y', ptr.sy.toFixed(4));
    stage.style.setProperty('--ptr-px', Math.round(ptr.x) + 'px');
    stage.style.setProperty('--ptr-py', Math.round(ptr.y) + 'px');
    stage.style.setProperty('--ptr-inside', ptr.inside ? '1' : '0');
    stage.style.setProperty('--ptr-presence', ptr.presence.toFixed(4));
  }

  function stepPointerSmoothing(dt) {
    if (RECORD || !stage) return;
    const k = dt > 0 ? 1 - Math.exp(-dt * 12) : 0.25;
    ptr.sx = dampAxis(ptr.sx, ptr.inside ? ptr.nx : 0, k);
    ptr.sy = dampAxis(ptr.sy, ptr.inside ? ptr.ny : 0, k);
    ptr.presence = dampAxis(ptr.presence, ptr.inside ? 1 : 0, k);
    syncStagePointerVars();
  }

  function isDocHidden() {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  function shouldTickAmbientPause(sc) {
    if (RECORD || isDocHidden() || !sc) return false;
    if (sc.live) return true;
    const uiCfg = getUiCfg(V.getCfg());
    return uiCfg.livePause !== false && sc.livePause !== false;
  }

  function setBuffering(value, error = '') {
    if (buffering === value && bufferingError === error) return;
    buffering = value;
    bufferingError = error;
    document.body.classList.toggle('is-buffering', value);
    if (ui.bufferingText) {
      ui.bufferingText.textContent = error
        ? (ui.loadingSpinner ? uiText('loadingFailed') : error)
        : (value ? uiText(ui.loadingSpinner ? 'loading' : 'buffering') : '');
    }
    if (ui.loadingSpinner) ui.loadingSpinner.hidden = !value || Boolean(error);
    if (ui.retry) ui.retry.hidden = !error;
  }

  function retryPlaybackAssets() {
    audioRt?.retry();
    V._frameRuntime.retryActive().catch(() => {});
    setBuffering(true);
    render(now);
  }

  function syncAssetAvailability() {
    const source = V._frameRuntime.readiness();
    const error = audioRt.hasError() ? uiText('narrationFailed') : (source.failed ? uiText('visualFailed') : '');
    const next = source.waiting || Boolean(error), previous = waitingAssets;
    waitingAssets = next;
    if (next || previous) setBuffering(next, error);
    if (next && !previous) audioRt.pausePlayback();
    if (!next && previous && playing && !scrubbing) {
      audioRt.seekTracks(now);
      audioRt.startPlayback();
      lastTs = performance.now();
    }
  }

  function renderBufferingFrame(rawDt) {
    if (!shouldTickAmbientPause(current)) return;
    ambientOffset += rawDt;
    render(now, 0, false);
  }

  function advanceAudioClock(ts, rawDt) {
    const mTime = audioRt.tickMasterClock();
    lastTs = ts;
    setBuffering(mTime == null && audioRt.canUseMasterClock());
    if (mTime != null) {
      if (checkSceneLoop(mTime)) return;
      if (mTime >= V.duration - 0.01) finishPlayback();
      else render(mTime, 0, false);
      return;
    }
    renderBufferingFrame(rawDt);
  }

  function advanceWallClock(ts) {
    setBuffering(false);
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (audioRt) audioRt.syncWithWallClock(now);
    if (now + dt >= V.duration - 0.002) finishPlayback();
    else render(now + dt, 0, false);
  }

  function stepAmbientIdle(rawDt) {
    if (!shouldTickAmbientPause(current)) return;
    ambientOffset += rawDt;
    idleSec += rawDt;
    render(now, idleSec, false);
  }

  function frame(ts) {
    const rawDt = lastFrameTs > 0 ? clamp((ts - lastFrameTs) / 1000, 0, 0.1) : 0;
    lastFrameTs = ts;
    if (V._frameRuntime.isHeld()) { lastTs = ts; requestAnimationFrame(frame); return; }
    stepPointerSmoothing(rawDt);
    syncAssetAvailability();
    if (localeLoading) {
      lastTs = ts;
    } else if (V.pptMode && pptRt) {
      stepAmbientIdle(rawDt);
    } else if (scrubbing) {
      lastTs = ts;
      renderBufferingFrame(rawDt);
    } else if (playing) {
      if (waitingAssets) { lastTs = ts; renderBufferingFrame(rawDt); }
      else if (audioRt && audioRt.canUseMasterClock()) advanceAudioClock(ts, rawDt);
      else advanceWallClock(ts);
    } else {
      stepAmbientIdle(rawDt);
    }
    requestAnimationFrame(frame);
  }

  function positionSoundMenu(bar) {
    if (!ui.soundMenu || !ui.mute || !bar) return;
    const barRect = bar.getBoundingClientRect();
    const btnRect = ui.mute.getBoundingClientRect();
    if (!barRect.width || !btnRect.width) return;
    const menuW = ui.soundMenu.offsetWidth || 176;
    const center = btnRect.left - barRect.left + btnRect.width / 2;
    const left = clamp(center - menuW / 2, 8, Math.max(8, barRect.width - menuW - 8));
    ui.soundMenu.style.left = Math.round(left) + 'px';
  }

  function blurMenuInput(bar) {
    const ae = document.activeElement;
    if (ae && bar.contains(ae) && ae.tagName === 'INPUT') ae.blur();
  }

  function restoreMenuFocus(bar, menu) {
    const trigger = {
      chap: '.chap-trigger', rate: '.rate-trigger', sound: '[data-act=mute]',
      subs: '[data-act=subs]', pptx: '[data-act=pptx-menu]',
    }[menu];
    if (trigger) bar.querySelector(trigger)?.focus();
  }

  function setOpenMenu(bar, which, restoreFocus = false) {
    if (!bar) return;
    const prev = bar.dataset.menu || '';
    const mode = which || '';
    if (restoreFocus) restoreMenuFocus(bar, prev);
    if (mode === 'sound') positionSoundMenu(bar);
    bar.dataset.menu = mode;
    bar.classList.toggle('menu-open', Boolean(mode));
    bar.classList.toggle('chap-open', mode === 'chap');
    bar.classList.toggle('rate-open', mode === 'rate');
    bar.classList.toggle('sound-open', mode === 'sound');
    bar.querySelector('[data-act="pptx-menu"]')?.setAttribute('aria-expanded', String(mode === 'pptx'));
    ui.subs?.setAttribute('aria-expanded', String(mode === 'subs'));
    if (ui.subsMenu) ui.subsMenu.inert = mode !== 'subs';
    document.body.classList.toggle('menu-open', Boolean(mode));
    if (prev && !mode) {
      blurMenuInput(bar);
      scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
    }
  }

  function play() {
    if (now >= V.duration - 0.01) {
      ambientOffset = 0;
      idleSec = 0;
      V.resetCheckpoints();
      seek(0);
    }
    setSandboxActiveDom(false);
    ended = false;
    idleSec = 0;
    document.body.classList.remove('is-ended');
    V._checkpointsRuntime.closeCheckpointOverlay();
    setOpenMenu(document.getElementById('controls'), '');
    playing = true;
    setBuffering(false);
    lastTs = performance.now();
    syncAssetAvailability();
    if (audioRt && !waitingAssets && !scrubbing) audioRt.startPlayback();
    document.body.classList.add('playing');
    syncPlaybackFrame();
    V.emit('onPlay', { now, playing: true });
    if (!RECORD) {
      scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
      updateUI();
    }
  }

  function pause() {
    playing = false;
    setBuffering(false);
    idleSec = 0;
    ended = now >= V.duration - 0.01;
    document.body.classList.remove('playing');
    document.body.classList.toggle('is-ended', ended);
    if (audioRt) audioRt.pausePlayback();
    for (const clip of V._videoClips) if (clip.pause) clip.pause();
    syncPlaybackFrame();
    V.emit('onPause', { now, ended, playing: false });
    if (!RECORD) {
      if (pointerInPlayer) flashUi(getUiCfg(V.getCfg()).idleHideDelay);
      updateUI();
    }
  }

  function syncRateMenuSelection() {
    if (!ui.rateItems) return;
    ui.rateItems.forEach(({ el, rate }) => toggle(el, 'on', Math.abs(rate - playbackRate) < 0.01));
  }

  function syncRateBtnUI() {
    if (!ui.rate) return;
    const isNormal = Math.abs(playbackRate - 1) < 0.01;
    const txt = fmtRate(playbackRate);
    const label = uiText('rate', { rate: txt });
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
    if (audioRt) audioRt.setRate(playbackRate);
    syncRateBtnUI();
    syncRateMenuSelection();
    V.emit('onRateChange', playbackRate);
  }

  function setSubs(nextOn) {
    showSubs = Boolean(nextOn);
    document.body.classList.toggle('nosubs', !showSubs);
    syncSubsBtnUI();
    render(now);
    V.emit('onSubsChange', showSubs);
  }

  function isRedundantSeek(target, ts) {
    return Math.abs(target - lastSeekTarget) < 0.015 && Math.abs(target - now) < 0.015 && ts - lastSeekAt < 250;
  }

  function seek(t, force = false) {
    if (!Number.isFinite(t)) return;
    if (V.pptMode && pptRt && !pptRt.isInternalRender()) {
      pptRt.seekToNearestPage(t);
      return;
    }
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (!force && isRedundantSeek(target, ts)) return;
    lastTs = ts;
    idleSec = 0;
    lastSeekTarget = target;
    lastSeekAt = ts;
    if (V._checkpointsRuntime && V._checkpointsRuntime.onSeek) V._checkpointsRuntime.onSeek(target);
    V.emit('onBeforeSeek', target);
    render(target, 0);
    V.emit('onSeek', target);
    if (audioRt) audioRt.seekTracks(now);
  }

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
    const tip = track.querySelector('.track-tip');
    track.addEventListener('pointermove', e => {
      if (!tip || V.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width));
      const t = ratio * V.duration;
      const sc = sceneAt(t);
      const idx = V.scenes.indexOf(sc);
      tip.textContent = sc ? `${String(idx + 1).padStart(2, '0')} · ${sc.title} · ${fmtTime(t)}` : fmtTime(t);
      const half = (tip.offsetWidth || 96) / 2;
      const x = clamp(ratio * rect.width, half, Math.max(half, rect.width - half));
      tip.style.left = `${Math.round(x)}px`;
      tip.classList.add('is-show');
    });
    const hideTip = () => { if (tip) tip.classList.remove('is-show'); };
    track.addEventListener('pointerleave', hideTip);
    track.addEventListener('pointercancel', hideTip);
  }

  function buildChapters(bar) {
    const list = bar.querySelector('.chap-list'), trig = bar.querySelector('.chap-trigger');
    ui.chapLabel = bar.querySelector('.chap-cur-txt');
    if (!list || !trig) return;
    ui.lastChapter = -1;
    list.innerHTML = '';
    ui.chapItems = V.scenes.map((sc, i) => {
      const item = h('button', { type: 'button', class: 'chap-item' }, h('em', null, String(i + 1).padStart(2, '0')), h('span', { class: 'chap-it-title' }, sc.title), h('small', null, fmtTime(sc.start)));
      item.onclick = e => { e.stopPropagation(); setOpenMenu(bar, ''); seek(sc.start + 0.02); if (!e.detail) trig.focus(); };
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
      const el = h('button', { type: 'button', class: 'rate-item' }, h('span', null, fmtRate(r)), h('i', null, '✓'));
      el.onclick = e => { e.stopPropagation(); setRate(r); setOpenMenu(bar, ''); if (!e.detail) trig.focus(); };
      menu.appendChild(el);
      return { el, rate: r };
    });
    syncRateMenuSelection();
    trig.onclick = e => {
      e.stopPropagation();
      setOpenMenu(bar, bar.dataset.menu === 'rate' ? '' : 'rate');
    };
  }

  function appendSoundLangItems(menu, bar) {
    const locales = V.getAvailableLocales ? V.getAvailableLocales() : [];
    ui.langItems = [];
    if (locales.length <= 1) return;
    menu.appendChild(h('div', { class: 'sound-sep sound-lang-sep' }));
    ui.langItems = locales.map(entry => {
      const el = h('div', { class: 'sound-item sound-lang-item', 'data-lang': entry.code }, h('span', null, entry.label), h('i', null, '✓'));
      el.onclick = e => {
        e.stopPropagation();
        setOpenMenu(bar, '');
        setLang(entry.code);
      };
      menu.appendChild(el);
      return { el, code: entry.code };
    });
  }

  function buildSoundMenu(bar) {
    const menu = bar.querySelector('.sound-menu');
    ui.soundMenu = menu;
    if (!menu) return;
    menu.innerHTML = '';
    ui.volRange = h('input', { class: 'sound-vol-range', type: 'range', min: '0', max: '100', step: '1', value: '100', 'aria-label': uiText('volAria') });
    ui.volVal = h('span', { class: 'sound-vol-val' }, '100%');
    const volRow = h('div', { class: 'sound-vol-row' }, ui.volRange, ui.volVal);
    volRow.onclick = e => e.stopPropagation();
    ui.volRange.oninput = () => audioRt.setVolume(Number(ui.volRange.value) / 100);
    ui.soundVoiceTxt = h('span', null, uiText('voiceItem'));
    ui.soundBgmTxt = h('span', null, uiText('bgmItem'));
    ui.soundVoice = h('div', { class: 'sound-item', 'data-sound': 'voice' }, ui.soundVoiceTxt, h('i', null, '✓'));
    ui.soundBgm = h('div', { class: 'sound-item', 'data-sound': 'bgm' }, ui.soundBgmTxt, h('i', null, '✓'));
    ui.soundSepBgm = h('div', { class: 'sound-sep' });
    ui.soundMuteTxt = h('span', null, uiText('muteAllItem'));
    ui.soundAllMute = h('div', { class: 'sound-item', 'data-sound': 'mute' }, ui.soundMuteTxt, h('i', null, '✓'));
    ui.soundVoice.onclick = e => { e.stopPropagation(); audioRt.toggleVoiceFromMenu(); };
    ui.soundBgm.onclick = e => { e.stopPropagation(); audioRt.toggleBgmFromMenu(); };
    ui.soundAllMute.onclick = e => { e.stopPropagation(); audioRt.setMuted(!audioRt.isAllMuted()); };
    menu.append(volRow, h('div', { class: 'sound-sep' }), ui.soundVoice, ui.soundBgm, ui.soundSepBgm, ui.soundAllMute);
    appendSoundLangItems(menu, bar);
    bindVolumeWheel(menu);
    syncSoundMenuUI();
  }

  function bindMenuAutoClose(bar) {
    const chapWrap = bar.querySelector('.chap-wrap');
    const rateWrap = bar.querySelector('.rate-wrap');
    const pptxWrap = bar.querySelector('.pptx-wrap');
    const subsWrap = bar.querySelector('.subs-wrap');
    addEventListener('pointerdown', e => {
      const inChap = chapWrap && chapWrap.contains(e.target);
      const inRate = rateWrap && rateWrap.contains(e.target);
      const inSound = (ui.mute && ui.mute.contains(e.target)) || (ui.soundMenu && ui.soundMenu.contains(e.target));
      if (!inChap && !inRate && !inSound && !pptxWrap?.contains(e.target) && !subsWrap?.contains(e.target)) setOpenMenu(bar, '');
    });
  }

  function bindScrubber(el) {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      let dragged = false, uncommittedT = null, lastAudioSeekTs = performance.now();
      scrubbing = true;
      audioRt?.pausePlayback();
      document.body.classList.add('scrubbing');
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      const toTime = cx => {
        const rect = el.getBoundingClientRect();
        return clamp((cx - rect.left) / Math.max(1, rect.width)) * V.duration;
      };
      seek(toTime(e.clientX));
      const mv = ev => {
        if (!dragged && Math.abs(ev.clientX - startX) < 3) return;
        dragged = true;
        const t = toTime(ev.clientX), ts = performance.now();
        if (ts - lastAudioSeekTs > 120) { lastAudioSeekTs = ts; uncommittedT = null; seek(t); }
        else { uncommittedT = t; render(t); }
      };
      const up = () => {
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        scrubbing = false;
        document.body.classList.remove('scrubbing');
        seek(uncommittedT == null ? now : uncommittedT, true);
        syncAssetAvailability();
        if (playing && !waitingAssets) audioRt?.startPlayback();
        removeEventListener('pointermove', mv);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        removeEventListener('blur', up);
        document.removeEventListener('visibilitychange', endHiddenDrag);
      };
      const endHiddenDrag = () => { if (document.hidden) up(); };
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
      addEventListener('blur', up);
      document.addEventListener('visibilitychange', endHiddenDrag);
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
    setBtnIcon(ui.webfull, webFull ? 'webExit' : 'webEnter', webFull ? icons.webExit : icons.webEnter, uiText(webFull ? 'webExit' : 'webEnter'), webFull);
    setBtnIcon(ui.full, osOn ? 'fullExit' : 'fullEnter', osOn ? icons.fullExit : icons.fullEnter, uiText(osOn ? 'fullExit' : 'fullEnter'), osOn);
    scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
    fit();
  }

  function setWebFull(on) {
    webFull = Boolean(on);
    syncParentFrameFull(webFull);
    syncFullUI();
    try { window.parent.postMessage({ type: 'video:webfull', active: webFull }, '*'); } catch {}
  }

  function fallbackWebFull(toggleMode) {
    if (ui.webfull) setWebFull(toggleMode ? !webFull : true);
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
    if (!current) return;
    const idx = V.scenes.indexOf(current);
    if (delta > 0 && idx < V.scenes.length - 1) seek(V.scenes[idx + 1].start + 0.01);
    if (delta < 0) seek(V.scenes[Math.max(0, now - current.start < 1.5 ? idx - 1 : idx)].start + 0.01);
    if (current) flashOsd(`${String(V.scenes.indexOf(current) + 1).padStart(2, '0')} · ${current.title}`);
  }

  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === 'INPUT' && target.type === 'range') return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '');
  }

  function isNativeSpaceTarget(target) {
    return Boolean(target && target.closest && target.closest('button, a'));
  }

  function handleEscapeKey(bar, e) {
    if (bar?.classList.contains('menu-open')) {
      setOpenMenu(bar, '', true);
      e.preventDefault();
    } else if (sandboxState.active) { exitSandbox(true); e.preventDefault(); }
    else if (!isOsFull() && webFull) { setWebFull(false); e.preventDefault(); }
  }

  function toggleMuteShortcut() {
    const next = !audioRt.isAllMuted();
    audioRt.setMuted(next);
    const pct = Math.round(audioRt.getState(now).volume * 100);
    flashOsd(next ? uiText('osdMuted') : uiText('osdVol', { pct }));
  }

  function toggleBgmShortcut() {
    if (!audioRt.hasBgm()) return;
    const next = !audioRt.getState(now).bgmOn;
    audioRt.setBgm(next);
    flashOsd(uiText(next ? 'osdBgmOn' : 'osdBgmOff'));
  }

  function seekDeltaShortcut(stepSec) {
    seek(now + stepSec);
    flashOsd(`${stepSec > 0 ? '+' : ''}${stepSec}s · ${fmtTime(now)}`);
  }

  function stepFrameShortcut(dir) {
    const fps = Math.max(1, Number(V.getCfg().fps) || 30);
    pause();
    seek(now + dir / fps, true);
  }

  function bindKeyboard(bar) {
    const keyMap = {
      '.': () => stepFrameShortcut(1),
      ',': () => stepFrameShortcut(-1),
      ']': () => jumpChapterDelta(1),
      PageDown: () => jumpChapterDelta(1),
      '[': () => jumpChapterDelta(-1),
      PageUp: () => jumpChapterDelta(-1),
      w: () => fallbackWebFull(true),
      W: () => fallbackWebFull(true),
      f: toggleOsFull,
      F: toggleOsFull,
      m: toggleMuteShortcut,
      M: toggleMuteShortcut,
      b: toggleBgmShortcut,
      B: toggleBgmShortcut,
      ArrowUp: e => { e.preventDefault(); stepVolumeBy(0.05, true); },
      ArrowDown: e => { e.preventDefault(); stepVolumeBy(-0.05, true); },
      ArrowRight: e => { if (e.target !== ui.volRange) seekDeltaShortcut(e.shiftKey ? 1 : 5); },
      ArrowLeft: e => { if (e.target !== ui.volRange) seekDeltaShortcut(e.shiftKey ? -1 : -5); },
    };
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { handleEscapeKey(bar, e); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.code === 'Space') {
        if (!isNativeSpaceTarget(e.target)) { e.preventDefault(); playing ? pause() : play(); }
        return;
      }
      if (keyMap[e.key]) keyMap[e.key](e);
    });
  }

  function resetPointerLeave() {
    ptr.inside = false;
    ptr.down = false;
    ptr.nx = 0;
    ptr.ny = 0;
  }

  function isEventOverBar(bar, target) {
    return Boolean(bar && target && bar.contains && bar.contains(target));
  }

  function hitRect(r, cx, cy) {
    if (r.width <= 0 || r.height <= 0) return false;
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  function isPointerOverBar(bar, e) {
    if (!bar) return false;
    if (isEventOverBar(bar, e.target)) return true;
    return Number.isFinite(e.clientX) && hitRect(bar.getBoundingClientRect(), e.clientX, e.clientY);
  }

  function applyStagePointerCoords(e) {
    if (RECORD || !stage || !Number.isFinite(e.clientX)) return;
    const r = stage.getBoundingClientRect();
    ptr.active = true;
    ptr.rawX = (e.clientX - r.left) / r.width * (V.stageWidth || 1920);
    ptr.rawY = (e.clientY - r.top) / r.height * (V.stageHeight || 1080);
    if (!hitRect(r, e.clientX, e.clientY)) {
      resetPointerLeave();
      return;
    }
    const rx = clamp((e.clientX - r.left) / r.width, 0, 1);
    const ry = clamp((e.clientY - r.top) / r.height, 0, 1);
    ptr.inside = true;
    ptr.x = rx * (V.stageWidth || 1920);
    ptr.y = ry * (V.stageHeight || 1080);
    ptr.nx = rx * 2 - 1;
    ptr.ny = ry * 2 - 1;
  }

  function updatePointerFromEvent(bar, e) {
    applyStagePointerCoords(e);
    ptr.overUI = Boolean(isPointerOverBar(bar, e) || e.target?.closest?.('[data-video-ui],#search-modal,#help-modal'));
    if (ptr.overUI) resetPointerLeave();
  }

  function showPointerUi(uiCfg) {
    pointerInPlayer = true;
    document.body.classList.remove('ui-keyboard');
    flashUi(uiCfg.idleHideDelay);
  }

  function wakeFromPointer(bar, uiCfg, e, force) {
    updatePointerFromEvent(bar, e);
    if (e.clientX < 0 || e.clientX >= innerWidth || e.clientY < 0 || e.clientY >= innerHeight) return;
    if (!force && Math.abs(e.clientX - lastPtrX) < 1 && Math.abs(e.clientY - lastPtrY) < 1) return;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    showPointerUi(uiCfg);
  }

  function isBarOverlayHidden(bar) {
    const body = document.body;
    if (!body.matches('.ctrl-overlay, .web-full, .os-full, [data-video-host-fullscreen]')) return false;
    if (body.matches('.ui-active, .scrubbing, .menu-open')) return false;
    return !(body.classList.contains('ui-keyboard') && bar?.matches(':has(:focus-visible)'));
  }

  function bindBlindBarGuard(bar, uiCfg) {
    if (!bar) return;
    let blindClick = false;
    bar.addEventListener('pointerdown', e => {
      blindClick = isBarOverlayHidden(bar);
      if (!blindClick) return;
      e.stopPropagation();
      e.preventDefault();
      flashUi(uiCfg.idleHideDelay);
    }, true);
    bar.addEventListener('click', e => {
      if (!blindClick || !e.detail) return;
      blindClick = false;
      e.stopPropagation();
      e.preventDefault();
      if (playing && !V.pptMode) pause();
    }, true);
  }

  function clearPlayerPointer(bar, delay) {
    pointerInPlayer = false;
    ptr.active = false;
    ptr.overUI = false;
    lastPtrX = -9999;
    lastPtrY = -9999;
    resetPointerLeave();
    setOpenMenu(bar, '');
    document.body.classList.remove('ui-keyboard');
    if (delay > 0) scheduleUiHide(delay);
    else {
      clearTimeout(idleTimer);
      document.body.classList.remove('ui-active');
    }
  }

  function bindIframeWake(viewport, uiCfg) {
    const connected = new WeakSet();
    const connect = frame => {
      const doc = frame.contentDocument;
      if (!doc || connected.has(doc)) return;
      connected.add(doc);
      let x, y;
      doc.addEventListener('pointermove', e => {
        if (e.clientX === x && e.clientY === y) return;
        x = e.clientX;
        y = e.clientY;
        showPointerUi(uiCfg);
      }, { capture: true, passive: true });
      doc.addEventListener('pointerdown', () => showPointerUi(uiCfg), { capture: true, passive: true });
    };
    document.addEventListener('load', e => {
      if (e.target.tagName === 'IFRAME' && viewport.contains(e.target)) connect(e.target);
    }, true);
    viewport.querySelectorAll('iframe').forEach(connect);
  }

  function bindIdleWake(bar, uiCfg) {
    const viewport = document.getElementById('viewport');
    bindBlindBarGuard(bar, uiCfg);
    bindIframeWake(viewport, uiCfg);
    const wakeOnFocus = () => {
      if (document.documentElement.matches(':hover')) showPointerUi(uiCfg);
    };
    const wakeOnKeyboard = e => {
      if (!bar?.contains(e.target) || !e.target.matches(':focus-visible')) return;
      document.body.classList.add('ui-keyboard');
      flashUi(uiCfg.idleHideDelay);
    };
    const clearOnLeave = e => {
      if (e.pointerType !== 'touch') clearPlayerPointer(bar, uiCfg.leaveHideDelay);
    };
    const clearDown = () => { ptr.down = false; };
    document.addEventListener('pointerenter', e => {
      if (e.target === document || (e.target.tagName === 'IFRAME' && viewport.contains(e.target))) wakeFromPointer(bar, uiCfg, e, true);
    }, true);
    addEventListener('pointermove', e => wakeFromPointer(bar, uiCfg, e, false));
    document.addEventListener('pointerleave', clearOnLeave);
    document.addEventListener('mouseleave', clearOnLeave);
    addEventListener('blur', () => {
      if (document.hasFocus() && document.activeElement?.tagName === 'IFRAME') return;
      clearPlayerPointer(bar, 0);
    });
    addEventListener('focus', wakeOnFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPlayerPointer(bar, 0);
      else wakeOnFocus();
    });
    addEventListener('pointerdown', e => {
      updatePointerFromEvent(bar, e);
      showPointerUi(uiCfg);
      if (ptr.inside) ptr.down = true;
    });
    addEventListener('pointerup', clearDown);
    addEventListener('pointercancel', clearDown);
    bar?.addEventListener('focusin', wakeOnKeyboard);
    bar?.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.key === 'Enter' || e.code === 'Space' ||
          e.target === ui.volRange || isEditableTarget(e.target)) wakeOnKeyboard(e);
    });
    wakeOnFocus();
    if (!V.pptMode) {
      viewport.addEventListener('click', e => {
        if (e.target.closest('[data-interactive]')) return;
        if (!playing && isInteractiveHold()) return;
        playing ? pause() : play();
      });
    }
  }

  function syncPlayBtnUI() {
    if (!ui.play) return;
    const state = playing ? 'playing' : (ended ? 'ended' : 'paused');
    const key = playing ? 'pause' : (ended ? 'replay' : 'play');
    const label = uiText(key);
    const icons = getUiCfg(V.getCfg()).icons;
    if (ui.play.dataset.state === state && ui.play.getAttribute('aria-label') === label && ui.play._playIcon === icons[key]) return;
    ui.play._playIcon = icons[key];
    ui.play.dataset.state = state;
    ui.play.setAttribute('aria-pressed', String(playing));
    swapBtnIcon(ui.play, key, icons[key], label);
  }

  function syncSubsBtnUI() {
    if (!ui.subs) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const key = showSubs ? 'subsOn' : 'subsOff';
    ui.subs.classList.toggle('is-off', !showSubs);
    ui.subsToggle.checked = showSubs;
    swapBtnIcon(ui.subs, key, icons[key], uiText('subtitles'));
  }

  function subtitleItem(input, label) {
    return h('label', { class: 'sound-item' }, input, h('span', null, uiText(label)), h('i', { 'aria-hidden': 'true' }, '✓'));
  }

  function subtitleOptions(key, label, options) {
    const chosen = V._subtitlesRuntime.getAppearance()[key];
    const fields = options.map(([value, text]) => {
      const input = h('input', { type: 'radio', name: `subtitle-${key}`, value, checked: value === chosen });
      input.onchange = () => {
        V._subtitlesRuntime.setAppearance({ [key]: value });
        const { size, align } = V._subtitlesRuntime.getAppearance();
        V._prefsRuntime.writeSaved(getUiCfg(V.getCfg()), { subSize: size, subAlign: align });
        render(now);
      };
      return subtitleItem(input, text);
    });
    return h('fieldset', null, h('legend', null, uiText(label)), h('div', { class: 'subs-options' }, fields));
  }

  function buildSubsMenu() {
    ui.subsToggle = h('input', { type: 'checkbox', checked: showSubs });
    ui.subsToggle.onchange = () => setSubs(ui.subsToggle.checked);
    ui.subsMenu.setAttribute('aria-label', uiText('subtitleSettings'));
    ui.subsMenu.replaceChildren(
      subtitleItem(ui.subsToggle, 'subtitleShow'),
      h('div', { class: 'sound-sep' }),
      subtitleOptions('size', 'subtitleSize', [['small', 'subtitleSmall'], ['medium', 'subtitleMedium'], ['large', 'subtitleLarge']]),
      h('div', { class: 'sound-sep' }),
      subtitleOptions('align', 'subtitleAlign', [['left', 'subtitleLeft'], ['center', 'subtitleCenter']]));
  }

  function buildPptUI(cfg, uiCfg) {
    const bar = document.getElementById('controls');
    addPptxDownload(bar, cfg, uiCfg);
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');
    pptRt.init(bar, uiCfg);
    if (ui.webfull) ui.webfull.onclick = () => setWebFull(!webFull);
    if (ui.full) ui.full.onclick = toggleOsFull;
    document.addEventListener('fullscreenchange', syncFullUI);
    document.addEventListener('webkitfullscreenchange', syncFullUI);
    bindIdleWake(bar, uiCfg);
  }

  function buildUI(uiCfg) {
    const bar = document.getElementById('controls');
    const track = bar.querySelector('.track');
    ui.track = track;
    track.setAttribute('aria-valuemax', String(V.duration));
    track.onkeydown = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (direction) seekDeltaShortcut(direction * (e.shiftKey ? 1 : 5));
      else if (e.key === 'Home' || e.key === 'End') seek(e.key === 'Home' ? 0 : V.duration, true);
      else return;
      e.preventDefault();
    };
    const hudEl = document.getElementById('hud');
    ui.play = bar.querySelector('[data-act=play]');
    ui.fill = bar.querySelector('.fill');
    ui.thumb = bar.querySelector('.thumb');
    ui.time = bar.querySelector('.time');
    ui.rate = bar.querySelector('[data-act=rate]');
    ui.subs = bar.querySelector('[data-act=subs]');
    ui.subsMenu = bar.querySelector('.subs-menu');
    ui.mute = bar.querySelector('[data-act=mute]');
    ui.toPpt = bar.querySelector('[data-act=to-ppt]');
    ui.webfull = bar.querySelector('[data-act=webfull]');
    ui.full = bar.querySelector('[data-act=full]');

    ui.play.onclick = () => (playing ? pause() : play());
    mountTrackMarks(track, uiCfg);
    bindScrubber(track);
    bindTrackHoverHint(track);
    if (hudEl && !hudEl.classList.contains('is-off')) bindScrubber(hudEl);
    buildChapters(bar);
    buildRateMenu(bar, uiCfg);
    buildSubsMenu();
    ui.subs.onclick = () => setOpenMenu(bar, bar.dataset.menu === 'subs' ? '' : 'subs');
    buildSoundMenu(bar);
    bindMenuAutoClose(bar);

    syncRateBtnUI();
    syncSubsBtnUI();
    syncSoundMenuUI();
    bindVolumeWheel(ui.mute);
    ui.mute.onclick = e => {
      e.stopPropagation();
      if (audioRt && audioRt.consumeRecentUnlock && audioRt.consumeRecentUnlock()) {
        const pct = Math.round(audioRt.getState(now).volume * 100);
        flashOsd(uiText('osdVol', { pct }));
        return;
      }
      setOpenMenu(bar, bar.dataset.menu === 'sound' ? '' : 'sound');
    };
    if (ui.toPpt) ui.toPpt.onclick = e => { e.stopPropagation(); pause(); navigateModeSwitch(true, Math.max(0, V.scenes.indexOf(current))); };
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

  function syncProgressUI() {
    const pct = clamp(now / V.duration) * 100 + '%';
    if (ui.lastProgress !== pct) {
      ui.fill.style.width = pct;
      if (ui.thumb) ui.thumb.style.left = pct;
      ui.lastProgress = pct;
    }
    const seconds = Math.min(V.duration, Math.round(now));
    if (ui.track && ui.lastTrackTime !== seconds) {
      ui.track.setAttribute('aria-valuenow', String(seconds));
      ui.track.setAttribute('aria-valuetext', fmtTime(now));
      ui.lastTrackTime = seconds;
    }
  }

  function updateUI() {
    if (V.pptMode && pptRt) { pptRt.syncUI(); return; }
    if (!ui.fill) return;
    syncProgressUI();
    const time = fmtTime(now) + ' / ' + fmtTime(V.duration);
    if (!ui.time.dataset.copied && ui.time.textContent !== time) ui.time.textContent = time;
    const idx = V.scenes.indexOf(current);
    const chapter = current ? `${String(idx + 1).padStart(2, '0')} · ${current.title}` : '';
    if (ui.chapLabel && ui.chapLabel.textContent !== chapter) ui.chapLabel.textContent = chapter;
    syncPlayBtnUI();
    if (ui.chapItems && ui.lastChapter !== idx) {
      ui.chapItems.forEach((it, i) => toggle(it, 'on', i === idx));
      ui.lastChapter = idx;
    }
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

  function waitVideoReady(vid, minimum, timeoutMs, signal) {
    return new Promise(resolve => {
      if (vid.error) { resolve(false); return; }
      const isReady = () => vid.readyState >= minimum && !vid.seeking;
      if (isReady()) { resolve(true); return; }
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked'];
      const done = ok => {
        clearTimeout(timer);
        events.forEach(event => vid.removeEventListener(event, onReady));
        vid.removeEventListener('error', onErr);
        signal.removeEventListener('abort', onErr);
        resolve(ok);
      };
      const onReady = () => { if (isReady()) done(true); };
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), timeoutMs);
      events.forEach(event => vid.addEventListener(event, onReady));
      vid.addEventListener('error', onErr, { once: true });
      signal.addEventListener('abort', onErr, { once: true });
      if (signal.aborted) done(false);
    });
  }

  function videoFrameError(vid, phase) {
    const src = vid.currentSrc || vid.src;
    const detail = vid.error ? (vid.error.message || `media error ${vid.error.code}`) : 'Media did not become ready for seeking';
    return new Error(`Cannot prepare embedded video "${src}" (${phase}, currentTime=${vid.currentTime.toFixed(3)}): ${detail}`);
  }

  function resolveLoadedVideoTime(vid, targetSec) {
    const duration = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : null;
    if (!duration) return targetSec;
    const target = vid._vclip.loop ? targetSec % duration : Math.min(targetSec, duration - 0.01);
    return Math.max(0, target);
  }

  function assertAssetRequestActive(signal) {
    if (signal.aborted) throw new DOMException('Frame superseded', 'AbortError');
  }

  async function seekVideoElementAsync(vid, targetSec, signal) {
    const metadataReady = await waitVideoReady(vid, 1, RECORD ? 15000 : 2000, signal);
    assertAssetRequestActive(signal);
    if (!metadataReady) {
      if (RECORD) throw videoFrameError(vid, 'metadata');
      return;
    }
    // 元数据可能晚于场景更新到达，按真实片长重新计算末帧或循环位置。
    targetSec = resolveLoadedVideoTime(vid, targetSec);
    vid._vclip.targetTime = targetSec;
    if (Math.abs((vid.currentTime || 0) - targetSec) > 0.000001 || vid.seeking) {
      try { vid.currentTime = targetSec; } catch (err) {
        if (RECORD) throw err;
        return;
      }
    }
    const frameReady = await waitVideoReady(vid, 2, RECORD ? 15000 : 1500, signal);
    assertAssetRequestActive(signal);
    const atTarget = frameReady && Math.abs(vid.currentTime - targetSec) <= 0.000001;
    if (RECORD && !atTarget) throw videoFrameError(vid, `frame at ${targetSec.toFixed(3)}s`);
  }

  function unescapeCssImageUrl(value) {
    return value.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_match, escaped) => {
      return /^[0-9a-f]/i.test(escaped) ? String.fromCodePoint(parseInt(escaped, 16) || 0xfffd) : escaped;
    });
  }

  function collectCssImageUrls(style, sources) {
    const images = [style.backgroundImage, style.maskImage, style.borderImageSource, style.listStyleImage, style.content].join(' ');
    for (const match of images.matchAll(/url\("((?:\\.|[^"\\])*)"\)/g)) {
      sources.add(unescapeCssImageUrl(match[1]));
    }
  }

  function decodeCssImage(src) {
    if (!cssImageDecodes.has(src)) {
      const image = new Image();
      image.src = src;
      cssImageDecodes.set(src, image.decode().catch(() => {}));
    }
    return cssImageDecodes.get(src);
  }

  function cssMayUseImages(text) {
    // 无类型的 attr(name) 只生成文本；保留带类型或回退值的声明继续检查。
    const imageText = text.replace(/attr\(\s*[-\w]+\s*\)/gi, '');
    return /(?:url|image-set|attr)\s*\(/i.test(imageText) || text.includes('\\') || text.includes('/*');
  }

  function stylesheetMayUseImages(sheet) {
    try {
      return Array.from(sheet.cssRules).some(rule => rule.type !== 5 && cssMayUseImages(rule.cssText));
    } catch { return true; }
  }

  function stageMayUseCssImages() {
    const roots = stage.shadowRoot ? [document, stage.shadowRoot] : [document];
    for (let el = stage; el; el = el.parentElement) {
      if (cssMayUseImages(el.style.cssText)) return true;
    }
    while (roots.length) {
      const root = roots.pop();
      const sheets = [...root.styleSheets, ...(root.adoptedStyleSheets || [])];
      if (sheets.some(stylesheetMayUseImages)) return true;
      const elements = root === document ? stage.querySelectorAll('*') : root.querySelectorAll('*');
      for (const el of elements) {
        if (cssMayUseImages(el.style.cssText)) return true;
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return false;
  }

  function waitCssImages() {
    // 没有 CSS 图片来源时，避免逐帧读取每个元素及其伪元素的计算样式。
    // 每次寻道重新检查声明，仍可发现动态内联样式、CSSOM 和影子根更新。
    if (!stageMayUseCssImages()) return Promise.resolve();
    const sources = new Set();
    const pending = [stage];
    while (pending.length) {
      const el = pending.pop();
      const style = getComputedStyle(el);
      if (style.display === 'none') continue;
      pending.push(...el.children);
      if (el.shadowRoot) pending.push(...el.shadowRoot.children);
      if (style.visibility === 'visible' && style.display !== 'contents') collectCssImageUrls(style, sources);
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = getComputedStyle(el, pseudo);
        if (pseudoStyle.content !== 'none' && pseudoStyle.content !== 'normal' && pseudoStyle.display !== 'none' && pseudoStyle.visibility === 'visible') {
          collectCssImageUrls(pseudoStyle, sources);
        }
      }
    }
    return Promise.all(Array.from(sources, decodeCssImage));
  }

  function collectImageDecodes(root, tasks) {
    for (const img of root.querySelectorAll('img, image')) {
      if (!(img._decoded && img.complete) && typeof img.decode === 'function') {
        tasks.push(img.decode().then(() => { img._decoded = true; }).catch(() => {}));
      }
    }
    if (root.shadowRoot) collectImageDecodes(root.shadowRoot, tasks);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collectImageDecodes(el.shadowRoot, tasks);
    }
  }

  async function waitStageAssets(signal) {
    if (!stage) return;
    const tasks = [waitCssImages()];
    collectImageDecodes(stage, tasks);
    for (const clip of V._videoClips) {
      if (clip.isConnected && clip._vclip) tasks.push(seekVideoElementAsync(clip, clip._vclip.targetTime, signal));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  async function waitFrameAssets(frame) {
    const signal = V._frameRuntime.signal(frame);
    const assets = new AbortController();
    let timer, cancel;
    const stopped = new Promise((_, reject) => {
      cancel = () => {
        reject(new DOMException('Frame superseded', 'AbortError'));
        assets.abort();
      };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        reject(new Error('Stage asset preparation timed out after 30000ms'));
        assets.abort();
      }, 30000);
      if (signal.aborted) cancel();
    });
    try { await Promise.race([waitStageAssets(assets.signal), stopped]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }

  function consumeHmrTime() {
    try {
      const raw = sessionStorage.getItem('__video_hmr_t');
      if (raw == null) return null;
      sessionStorage.removeItem('__video_hmr_t');
      const v = parseFloat(raw);
      return Number.isFinite(v) ? v : 0;
    } catch {
      return null;
    }
  }

  function resolveInitialTime(uiCfg) {
    const hmrT = consumeHmrTime();
    if (hmrT != null) return { t: hmrT, resumed: false };
    if (params.has('t')) return { t: parseFloat(params.get('t')) || 0, resumed: false };
    if (params.has('scene')) {
      const sIdx = clamp(+params.get('scene') || 0, 0, Math.max(0, V.scenes.length - 1));
      return { t: V.scenes[sIdx] ? V.scenes[sIdx].start + 0.01 : 0, resumed: false };
    }
    const savedT = V._prefsRuntime ? V._prefsRuntime.resolveSavedResumeTime(params, uiCfg, V.duration) : 0;
    return { t: savedT, resumed: savedT > 0 };
  }

  function applySavedPrefs(saved) {
    if (!saved) return;
    if (typeof saved.subs === 'boolean' && !params.has('nosubs')) {
      showSubs = saved.subs;
      document.body.classList.toggle('nosubs', !showSubs);
    }
    V._subtitlesRuntime.setAppearance({ size: saved.subSize, align: saved.subAlign });
    if (typeof saved.rate === 'number' && Number.isFinite(saved.rate)) {
      playbackRate = clamp(saved.rate, 0.25, 4);
      V._playbackRate = playbackRate;
    }
  }

  function captureCuePos(cues, lt, scDur) {
    const last = cues[cues.length - 1];
    if (lt > last.end) {
      return { mode: 'tail', li: cues.length - 1, frac: clamp((lt - last.end) / Math.max(0.05, scDur - last.end), 0, 1) };
    }
    const li = Math.max(0, cues.findIndex(c => lt <= c.end));
    const c = cues[li];
    if (lt < c.start) {
      const prevEnd = li > 0 ? cues[li - 1].end : 0;
      return { mode: 'gap', li, frac: clamp((lt - prevEnd) / Math.max(0.05, c.start - prevEnd), 0, 1) };
    }
    return { mode: 'cue', li, frac: clamp((lt - c.start) / Math.max(0.05, c.end - c.start), 0, 1) };
  }

  function captureLogicalPos() {
    const si = Math.max(0, V.scenes.indexOf(current));
    const sc = V.scenes[si];
    if (!sc) return { si: 0, mode: 'scene', li: 0, frac: 0 };
    const lt = clamp(now - sc.start, 0, sc.duration);
    if (!sc.cues || !sc.cues.length) {
      return { si, mode: 'scene', li: 0, frac: clamp(lt / Math.max(0.1, sc.duration), 0, 1) };
    }
    return Object.assign({ si }, captureCuePos(sc.cues, lt, sc.duration));
  }

  function resolveMappedCueLt(cues, scDur, pos) {
    const li = clamp(pos.li, 0, cues.length - 1);
    const c = cues[li];
    if (pos.mode === 'tail') {
      const last = cues[cues.length - 1];
      return last.end + pos.frac * Math.max(0, scDur - last.end);
    }
    if (pos.mode === 'gap') {
      const prevEnd = li > 0 ? cues[li - 1].end : 0;
      return prevEnd + pos.frac * Math.max(0, c.start - prevEnd);
    }
    return c.start + pos.frac * Math.max(0, c.end - c.start);
  }

  function resolveMappedPos(pos) {
    if (!V.scenes.length) return 0;
    const sc = V.scenes[clamp(pos.si, 0, V.scenes.length - 1)];
    if (!sc) return 0;
    if (pos.mode === 'scene' || !sc.cues || !sc.cues.length) {
      return sc.start + pos.frac * sc.duration;
    }
    return sc.start + resolveMappedCueLt(sc.cues, sc.duration, pos);
  }

  async function ensureLocaleAssetsLoaded(target, fallbackLang) {
    if (shouldProbeLocalePack(target)) await loadOptionalScript(`locales/${target}.js`);
    if (V.activateCachedVoice && V.activateCachedVoice(target)) return true;
    const cfg0 = V.getCfg();
    const baseTimings = cfg0.timingsScript || 'assets/voice/timings.js';
    const isSec = V.isSecondaryLocale ? V.isSecondaryLocale(target) : false;
    const targetTimings = isSec ? baseTimings.replace(/\.js$/i, `.${target}.js`) : baseTimings;
    const ok = await loadOptionalScript(targetTimings);
    if (ok && V.captureVoice) { V.captureVoice(V.voice); return true; }
    return finalizeLocaleFallback(target, fallbackLang);
  }

  function syncStaticBarLabels(bar, cfg) {
    const home = bar.querySelector('.ctrl-home');
    if (home) {
      const ht = cfg.homeLabel || uiText('home');
      home.title = ht;
      home.setAttribute('aria-label', ht);
    }
    const chapTrig = bar.querySelector('.chap-trigger');
    if (chapTrig) chapTrig.title = uiText('chapTrigger');
    const chapHd = bar.querySelector('.chap-menu-hd');
    if (chapHd) chapHd.textContent = uiText('chapHeader');
    if (ui.mute) ui.mute.setAttribute('aria-label', uiText('soundLabel'));
    if (ui.toPpt) {
      const pt = uiText('switchToPpt');
      ui.toPpt.title = pt;
      ui.toPpt.setAttribute('aria-label', pt);
    }
  }

  function refreshLocalizedChrome(cfg, uiCfg) {
    if (sandboxState.txtEl && !sandboxState.active) sandboxState.txtEl.textContent = uiText('sandboxActive');
    if (sandboxState.backEl) sandboxState.backEl.textContent = uiText('sandboxBack');
    const hintEl = document.getElementById('start-hint');
    if (hintEl) hintEl.textContent = cfg.startHint || uiText('startHint');
    if (RECORD) return;
    const bar = document.getElementById('controls');
    if (!bar) return;
    if (V.pptMode && pptRt) {
      pptRt.refreshChrome(cfg, uiCfg);
      syncSubsBtnUI();
      syncFullUI();
      return;
    }
    syncStaticBarLabels(bar, cfg);
    mountTrackMarks(bar.querySelector('.track'), uiCfg);
    buildChapters(bar);
    buildSoundMenu(bar);
    buildSubsMenu();
    syncRateBtnUI();
    syncSubsBtnUI();
    syncFullUI();
  }

  function resolveTargetLangCode(nextLang) {
    const trimmed = String(nextLang || '').trim();
    if (trimmed) return trimmed;
    return (V.getBaseLang && V.getBaseLang()) || '';
  }

  function applyPostLocaleReload(pos, target) {
    if (V.syncDocLangAttrs) V.syncDocLangAttrs();
    if (current && current.root) current.root.remove();
    current = null;
    V.layout();
    if (V.pptMode && pptRt) pptRt.rebuildPages();
    const cfg = V.getCfg(), uiCfg = getUiCfg(cfg);
    if (cfg.title) document.title = cfg.title;
    mountHudTicks(uiCfg);
    if (audioRt) audioRt.reloadTracks(cfg);
    refreshLocalizedChrome(cfg, uiCfg);
    lastSeekTarget = -1;
    seek(resolveMappedPos(pos), true);
    V.emit('onLocaleChange', { lang: V.getActiveLang(), duration: V.duration });
    const hit = V.getAvailableLocales ? V.getAvailableLocales().find(x => x.code.toLowerCase() === target.toLowerCase()) : null;
    if (hit) flashOsd(hit.label);
  }

  async function applyLang(nextLang) {
    const target = resolveTargetLangCode(nextLang);
    const prevLang = V.getActiveLang();
    if (target === prevLang) return prevLang;
    // 等待资源时保留用户的播放意图，暂停时间轴与旧媒体。
    localeLoading = true;
    try {
      if (audioRt) audioRt.pausePlayback();
      for (const clip of V._videoClips) if (clip.pause) clip.pause();
      if (V.captureVoice && V.voice) V.captureVoice(V.voice);
      V.__langOverridden = true;
      V.__activeLang = target;
      const ok = await ensureLocaleAssetsLoaded(target, prevLang);
      if (!ok && V.getActiveLang() === prevLang) return prevLang;
      const pos = captureLogicalPos();
      V.resetCheckpoints();
      applyPostLocaleReload(pos, V.getActiveLang());
      return V.getActiveLang();
    } finally {
      localeLoading = false;
      lastTs = performance.now();
      if (playing && audioRt) audioRt.startPlayback();
    }
  }

  function setLang(nextLang) {
    const pending = localeSwitch.then(() => applyLang(nextLang));
    localeSwitch = pending.catch(() => {});
    return pending;
  }

  function exposeBridge(cfg) {
    window.__video = {
      get duration() { return V.duration; },
      width: V.stageWidth,
      height: V.stageHeight,
      fps: cfg.fps || 30,
      seek: t => (RECORD ? render(t, 0) : seek(t)),
      seekVisual: t => render(t, 0),
      seekAsync: V.seekToAsync,
      setRate,
      setSubs,
      setLang,
      getLang: () => V.getActiveLang(),
      pptMode: Boolean(V.pptMode),
      get page() { return pptRt ? pptRt.getPageNo() : 0; },
      get totalPages() { return pptRt ? pptRt.getTotalPages() : 0; },
      nextPage: () => (pptRt ? pptRt.stepBy(1) + 1 : 0),
      prevPage: () => (pptRt ? pptRt.stepBy(-1) + 1 : 0),
      goToPage: (p, opts) => (pptRt ? pptRt.goToPage((Number(p) || 1) - 1, opts) + 1 : 0),
      sfx: (k, o) => (V.sfx ? V.sfx(k, o) : false),
      setVolume: v => audioRt.setVolume(v),
      getVolume: () => audioRt.getState(now).volume,
      setBgm: on => audioRt.setBgm(on),
      setVoice: on => audioRt.setVoice(on),
      setMuted: on => audioRt.setMuted(on),
      clearSavedState: V.clearSavedState,
      flashOsd,
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
      getSyncState: () => {
        const a = audioRt.getState(now);
        return {
          now,
          clock: V._clock || now,
          alive: V._clock || now,
          idle: idleSec,
          pointer: Object.assign({}, ptr),
          ended,
          sandbox: sandboxState.active,
          playing,
          playbackRate,
          subsEnabled: showSubs,
          sceneIndex: V._currentSceneIdx || 0,
          pptMode: Boolean(V.pptMode),
          ...(pptRt ? pptRt.getState() : {}),
          lang: V.getActiveLang(),
          audioBlocked: Boolean(a.audioBlocked),
          volume: a.volume,
          muted: a.muted,
          hasBgm: a.hasBgm,
          bgmEnabled: a.bgmOn,
          voiceEnabled: a.voiceOn,
          audioTime: a.audioTime,
          drift: a.drift,
          seeking: a.seeking,
          targetSeekTime: a.targetSeekTime,
          readyState: a.readyState,
          audioPaused: a.audioPaused,
        };
      },
      get scenes() { return V.scenes.map(s => ({ title: s.title, start: s.start, duration: s.duration, cues: s.cues })); },
    };
  }

  function playerState() {
    return Object.freeze({ now, playing: playing && !scrubbing && !localeLoading,
      ended, sceneIndex: V.scenes.indexOf(current), mode: V.environment.mode,
      sandbox: sandboxState.active, rate: playbackRate, buffering, error: bufferingError || null,
      page: pptRt ? pptRt.getPageNo() : 0, totalPages: pptRt ? pptRt.getTotalPages() : 0 });
  }

  function goToScene(index, options = {}) {
    const sceneIndex = typeof index === 'string' ? V.scenes.findIndex(sc => sc.id === index) : index;
    const scene = V.scenes[sceneIndex];
    if (!Number.isInteger(sceneIndex) || !scene) throw new RangeError(`Unknown scene: ${index}`);
    const offset = options.offset === undefined ? 0.05 : Number(options.offset);
    if (!Number.isFinite(offset)) throw new TypeError('Scene offset must be finite');
    const target = scene.start + clamp(offset, 0, Math.max(0, scene.duration - 0.001));
    if (options.sandbox && !V.pptMode && !RECORD) tryEgg(target, options.hint || scene.title);
    else if (RECORD) render(target, 0);
    else seek(target, true);
    return playerState();
  }

  function exposePlayer() {
    V.player = Object.freeze({
      play: () => { if (!V.pptMode) play(); return playerState(); },
      pause: () => { pause(); return playerState(); },
      replay: () => { if (pptRt) pptRt.goToPage(0); else replay(); return playerState(); },
      getState: playerState,
      seek: t => { if (RECORD) render(t, 0); else seek(t, true); return playerState(); },
      goToScene, tryAt: tryEgg, exitSandbox,
      getPptPages: () => pptRt?.getPages() || [],
      goToPage(page, options) {
        if (!pptRt) throw new Error('PPT mode is not active');
        if (!Number.isInteger(page) || page < 1 || page > pptRt.getTotalPages()) throw new RangeError('Unknown PPT page');
        pptRt.goToPage(page - 1, options);
        return playerState();
      },
      nextPage: () => pptRt && pptRt.stepBy(1),
      prevPage: () => pptRt && pptRt.stepBy(-1),
    });
  }

  function syncInitialLocaleState() {
    if (V.captureVoice && V.voice) V.captureVoice(V.voice);
    if (V.syncDocLangAttrs) V.syncDocLangAttrs();
  }

  function initInitialAudioAndSubs(cfg, uiCfg, savedPrefs) {
    if (V.pptMode) {
      showSubs = params.has('subs');
      document.body.classList.toggle('nosubs', !showSubs);
      return;
    }
    applySavedPrefs(savedPrefs);
    document.body.classList.toggle('nosubs', !showSubs);
    audioRt.setRate(playbackRate);
    audioRt.initTracks(cfg, uiCfg, savedPrefs);
  }

  function startInitialRender(uiCfg) {
    if (V.pptMode && pptRt) {
      pptRt.rebuildPages();
      pptRt.goToPage(pptRt.resolveInitialPageIndex(), { instant: true, force: true });
      return;
    }
    const initPos = resolveInitialTime(uiCfg);
    if (initPos.t > 0) {
      seek(initPos.t);
      if (initPos.resumed) flashOsd(uiText('osdResumed', { time: fmtTime(initPos.t) }), 1200);
    } else {
      render(0, 0);
    }
  }

  V.start = function () {
    syncInitialLocaleState();
    V.mountStage();
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    if (cfg.title) document.title = cfg.title;
    stage = document.getElementById('stage');
    V._subtitlesRuntime.bindSubElements(document.getElementById('subs'));
    V.layout();
    mountHudTicks(uiCfg);
    V._layersRuntime.mountLayers(stage, document.getElementById('subs'));

    const savedPrefs = V._prefsRuntime ? V._prefsRuntime.readSaved(uiCfg) : null;
    audioRt = V._createAudioRuntime({
      params,
      isRecord: RECORD,
      isPlaying: () => playing && !scrubbing && !localeLoading && !waitingAssets,
      getNow: () => now,
      getCurrentScene: () => current,
      markSeekApplied: target => { lastSeekTarget = target; lastSeekAt = performance.now(); },
      onSoundUI: syncSoundMenuUI,
      onAudioBlocked: () => flashOsd(uiText('osdBlocked'), 1800),
      onEnded: finishPlayback,
      onVisibilitySync: t => render(t, 0),
      onBgmUnavailable: syncSoundMenuUI,
    });
    initInitialAudioAndSubs(cfg, uiCfg, savedPrefs);

    V.seekTo = t => render(t, 0);
    V.seekToAsync = async t => {
      if (!Number.isFinite(t)) throw new TypeError('seek time must be finite');
      render(t, 0);
      const snapshot = V.getFrameState();
      const release = V._frameRuntime.hold(snapshot);
      try {
        await Promise.all([waitFrameAssets(snapshot), V._frameRuntime.prepare(snapshot)]);
        if (snapshot !== V.getFrameState()) throw new DOMException('Frame superseded', 'AbortError');
        return snapshot;
      } finally { release(); }
    };
    V.setSubs = setSubs;
    V.setLang = setLang;
    V.setVolume = v => audioRt.setVolume(v);
    V.getVolume = () => audioRt.getState(now).volume;
    V.setBgm = on => audioRt.setBgm(on);
    V.setVoice = on => audioRt.setVoice(on);
    V.setMuted = on => audioRt.setMuted(on);
    V.enterSandbox = enterSandbox;
    V.exitSandbox = exitSandbox;
    V.tryEgg = tryEgg;
    V.replay = replay;
    V._playerCtl = {
      play, pause, replay, seek, setRate, setSubs, setLang,
      setVolume: V.setVolume, getVolume: V.getVolume,
      setBgm: V.setBgm, setVoice: V.setVoice, setMuted: V.setMuted,
      enterSandbox, exitSandbox, tryEgg,
      fmtTime, updateUI, flashUi, flashOsd,
      setOpenMenu: m => setOpenMenu(document.getElementById('controls'), m),
      getRate: () => playbackRate,
      toggleLoopScene: () => (loopScene = !loopScene),
      isDev: DEV,
      isRecord: RECORD,
    };
    exposePlayer();

    if (RECORD) document.body.classList.add('record');
    else if (V.pptMode && pptRt) buildPptUI(cfg, uiCfg);
    else buildUI(uiCfg);
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', fit);
    lastFrameTs = performance.now();
    ambientOffset = 0;
    idleSec = 0;
    startInitialRender(uiCfg);
    if (V._loading) {
      syncAssetAvailability();
      V._loading.finish();
    }
    requestAnimationFrame(frame);
    if (!V.pptMode && params.has('autoplay')) play();
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

  function clearStaleVoiceIfNeeded() {
    if (V.voice && V.isVoiceLocaleMatch && !V.isVoiceLocaleMatch(V.voice)) {
      V.voice = null;
    }
  }

  function hasLocaleResources(lang) {
    if (!lang || (V.isSecondaryLocale && !V.isSecondaryLocale(lang))) return true;
    if (V.locales && V.locales[lang]) return true;
    if (V.voices && V.voices[lang]) return true;
    return Boolean(V.voice && V.voice.lang === lang);
  }

  function finalizeLocaleFallback(lang, fallbackLang) {
    if (hasLocaleResources(lang)) {
      clearStaleVoiceIfNeeded();
      return true;
    }
    const fb = fallbackLang !== undefined ? fallbackLang : ((V.getBaseLang && V.getBaseLang()) || '');
    V.__langOverridden = true;
    V.__activeLang = fb;
    if (V.activateCachedVoice) V.activateCachedVoice(fb);
    return false;
  }

  function shouldProbeLocalePack(lang) {
    if (!lang || V.locales[lang]) return false;
    if (V.isSecondaryLocale && V.isSecondaryLocale(lang)) return true;
    const base = V.getBaseLang ? V.getBaseLang() : '';
    return Boolean(!base || lang.toLowerCase() !== base.toLowerCase());
  }

  async function loadBootLocaleTimings(cfg, lang) {
    if (!lang || (V.isSecondaryLocale && !V.isSecondaryLocale(lang))) return;
    const baseTimings = cfg.timingsScript || 'assets/voice/timings.js';
    const langTimings = baseTimings.replace(/\.js$/i, `.${lang}.js`);
    if (langTimings === baseTimings) return;
    const ok = await loadOptionalScript(langTimings);
    if (ok && V.captureVoice) V.captureVoice(V.voice);
    else finalizeLocaleFallback(lang);
  }

  async function ensureDynamicBootAssets() {
    if (V.captureVoice && V.voice) V.captureVoice(V.voice);
    const cfg = V.getCfg();
    if (V.scenes.length === 0 && Array.isArray(cfg.sceneScripts)) {
      for (const rel of cfg.sceneScripts) await loadOptionalScript(rel);
    }
    const lang = V.getActiveLang();
    if (shouldProbeLocalePack(lang)) await loadOptionalScript(`locales/${lang}.js`);
    await loadBootLocaleTimings(cfg, lang);
  }

  V.boot = async function () {
    try {
      await ensureDynamicBootAssets();
      if (V._loading && !V.scenes.length) throw new Error('No scenes to play');
      if (V._loading?.waitForPaint) await V._loading.waitForPaint();
      V.mountStage();
      const glEl = document.getElementById('gl');
      if (V.gl && glEl) {
        glEl.classList.remove('is-off');
        try {
          await V.gl.init(glEl, V.getCfg());
          if (V.gl.ready === undefined) V.gl.ready = true;
        } catch {
          V.gl.ready = false;
          glEl.classList.add('is-off');
        }
      }
      V.start();
    } catch (error) {
      V._loading?.fail();
      throw error;
    }
  };
})(globalThis.V = globalThis.V || {});

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
    const ppt = V.pptMode && V._pptRuntime;
    const rowMeta = ppt ? uiText('pptChapPage', { p: ppt.findPageNoForTime(hit.time) }) : ctl.fmtTime(hit.time);
    const row = h('button', { type: 'button', class: 'chap-item' + (idx === activeIdx ? ' on' : '') },
      h('em', null, code),
      body,
      h('small', null, rowMeta));
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
      const ppt = V.pptMode && V._pptRuntime;
      if (ppt && targetSec === undefined) {
        u.searchParams.set('ppt', '1');
        u.searchParams.set('page', String(ppt.getPageNo()));
        u.searchParams.delete('t');
      } else if (ppt) {
        u.searchParams.set('ppt', '1');
        u.searchParams.set('page', String(ppt.findPageNoForTime(sec)));
        u.searchParams.delete('t');
      } else if (sec >= 1) {
        u.searchParams.set('t', String(sec));
      } else {
        u.searchParams.delete('t');
      }
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
    timeEl.title = uiText(V.pptMode ? 'copyPageTip' : 'copyTimeTip');
    timeEl.onclick = async e => {
      e.stopPropagation();
      if (V.sfx) V.sfx('click', 0.45);
      const ppt = V.pptMode && V._pptRuntime;
      const sec = Math.max(0, Math.floor(V._now || 0));
      await copyToClipboard(getDeepLink(ppt ? undefined : sec));
      timeEl.dataset.copied = '1';
      timeEl.textContent = ppt
        ? uiText('copiedPage', { p: ppt.getPageNo() })
        : uiText('copiedTime', { time: ctl.fmtTime(sec) });
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
      if (e.defaultPrevented) return;
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
      if (timeElRef) timeElRef.title = uiText(V.pptMode ? 'copyPageTip' : 'copyTimeTip');
    },
    onSeek(t) {
      if (!V._isRecord) syncAddressBarOnSeek(t);
    },
  });
})(globalThis.V = globalThis.V || {});

