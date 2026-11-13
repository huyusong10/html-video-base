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
    ['pointer', () => ({ x: 960, y: 540, nx: 0, ny: 0, sx: 0, sy: 0, presence: 0, inside: false, down: false })],
    ['_videoClips', () => new Set()],
  ];
  for (const [k, make] of DEFAULTS) {
    if (!V[k]) V[k] = make();
  }

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

  V.getActiveLang = function () {
    if (V.__langOverridden) return V.__activeLang || (V.config && V.config.lang) || '';
    if (V.__activeLang) return V.__activeLang;
    if (typeof location !== 'undefined' && location.search) {
      const q = new URLSearchParams(location.search).get('lang');
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
    if (!a && !b) return undefined;
    const out = Object.assign({}, a || {}, b || {});
    if ((a && a.speakers) || (b && b.speakers)) {
      out.speakers = Object.assign({}, (a && a.speakers) || {}, (b && b.speakers) || {});
    }
    return out;
  }

  V.getCfg = function () {
    V.applyConfiguredPresets();
    const lang = V.getActiveLang();
    const loc = (lang && V.locales[lang]) || null;
    const locCfg = extractLocaleCfg(loc);
    const td = V.themeDefaults || {};
    const vc = V.config || {};
    const merged = Object.assign({}, td, vc, locCfg);
    merged.ui = mergeUiDict(mergeUiDict(td.ui, vc.ui), locCfg.ui);
    const tts = mergeTtsDict(mergeTtsDict(td.tts, vc.tts), locCfg.tts);
    if (tts) merged.tts = tts;
    if (td.strings || vc.strings || (loc && loc.strings)) {
      merged.strings = Object.assign({}, td.strings || {}, vc.strings || {}, (loc && loc.strings) || {});
    }
    return merged;
  };
})(globalThis.V = globalThis.V || {});

/* core/01b-i18n.js - 多语言界面字典、画布文案翻译 (V.t / x.t)、多语种配音缓存与语种发现 */
(function (V) {
  const UI_ZH = {
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
    subsHide: '关闭字幕',
    subsShow: '开启字幕',
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
  };

  const UI_ZH_TW = {
    home: '返回主介面',
    startHint: '▶ 點擊畫面開始播放',
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
    subsHide: '關閉字幕',
    subsShow: '開啟字幕',
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
  };

  const UI_EN = {
    home: 'Back to Home',
    startHint: '▶ Click to play',
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
    subsHide: 'Hide Subtitles',
    subsShow: 'Show Subtitles',
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

  function lookupSceneString(lang, sceneIdx, key) {
    const scLoc = resolveSceneLocDict(lang, sceneIdx);
    return scLoc && scLoc.strings ? scLoc.strings[key] : undefined;
  }

  V.t = function (key, fallback, vars, sceneIdx) {
    const lang = V.getActiveLang ? V.getActiveLang() : '';
    const scVal = lookupSceneString(lang, sceneIdx === undefined ? V._currentSceneIdx : sceneIdx, key);
    if (scVal !== undefined) return interpolateVars(scVal, vars);
    const cfg = V.getCfg ? V.getCfg() : (V.config || {});
    const gVal = cfg.strings && cfg.strings[key];
    if (gVal !== undefined) return interpolateVars(gVal, vars);
    return interpolateVars(fallback !== undefined ? fallback : key, vars);
  };

  V.localizeDom = function (root, sceneIdx) {
    if (!root || !root.querySelectorAll) return;
    for (const el of root.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      if (el._i18nOrig === undefined) el._i18nOrig = el.textContent;
      el.textContent = V.t(key, el._i18nOrig, null, sceneIdx);
    }
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
      el.style.opacity = o;
      el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    }
    el.style.transform = `translate(${x}px,${y}px) ${formatScale(s, sx, sy)} rotate(${r}deg)`;
    if (origin) el.style.transformOrigin = origin;
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

  function interactive(el, handlers, opts) {
    if (!el) return el;
    if (el.setAttribute) el.setAttribute('data-interactive', '1');
    if (el.style && !el.style.pointerEvents) el.style.pointerEvents = 'auto';
    const sfxSpec = resolveInteractiveSfx(handlers, opts);
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
    const usePlaying = playing === undefined ? Boolean(V._isPlaying) : Boolean(playing);
    meta._syncedTick = V._renderTick || 0;
    const { target, endedClip } = resolveClipPlaybackTarget(el, meta, lt);
    meta.targetTime = target;
    if (typeof el.pause !== 'function') return;
    syncBrowserVideoTime(el, meta, lt >= meta.start && !endedClip && usePlaying, endedClip);
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

  function syncBrowserVideoTime(el, meta, shouldPlay, endedClip) {
    const tol = endedClip ? 0.05 : 0.16;
    const diff = Math.abs((el.currentTime || 0) - meta.targetTime);
    if (diff > tol && el.readyState >= 1) {
      try { el.currentTime = meta.targetTime; } catch {}
    }
    el.playbackRate = meta.speed * (V._playbackRate || 1);
    toggleBrowserVideoPlay(el, shouldPlay);
  }

  V.u = Object.assign(V.u || {}, {
    h, svg, set, pop, typeText, type, scramble, countUp,
    drawPath, toggle, interactive, spotlight, camera, makeCursor, cursor,
    videoClip, syncVideoClip,
  });
})(globalThis.V = globalThis.V || {});

/* core/04-timeline.js · 时间轴排布、句内语义词锚 (x.at)、多语言覆盖与 30Hz 语音振幅包络采样 */
(function (V) {
  const { clamp } = V.u;
  const DEFAULT_CPS = 5.4, DEFAULT_GAP = 0.22, DEFAULT_LEAD = 0.35, DEFAULT_TAIL = 0.38;

  function getPacing() {
    const cfg = V.getCfg();
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

  function normKey(s) {
    return String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  }

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

  function mapWordsToChunks(chunks, words, cueStart, cueEnd) {
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
      const key = normKey(c);
      const pos = key ? flat.indexOf(key, searchFrom) : -1;
      if (pos >= 0) { searchFrom = pos + key.length; return charTime[pos]; }
      return null;
    });
    return chunks.map((text, i) => {
      const s = starts[i] != null ? cueStart + starts[i] : (i === 0 ? cueStart : cueStart + (cueEnd - cueStart) * (i / chunks.length));
      const e = (i + 1 < chunks.length && starts[i + 1] != null) ? cueStart + starts[i + 1] : cueEnd;
      return { start: s, end: Math.max(s + 0.25, e), text };
    });
  }

  function splitSubCues(text, cueStart, cueEnd, words) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const chunks = chunkSentences(raw);
    if (chunks.length <= 1) {
      return [{ start: cueStart, end: cueEnd, text: chunks[0] || raw }];
    }
    if (words && words.length) return mapWordsToChunks(chunks, words, cueStart, cueEnd);
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
    return Object.assign({}, lineObj, patch, { anchors: mergedAnchors });
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

  function isBakedValid(baked) {
    if (!baked || V.__ignoreBakedLayout || !isLangBakedMatch(baked)) return false;
    if (!Array.isArray(baked.scenes) || baked.scenes.length !== V.scenes.length) return false;
    return V.scenes.every((sc, idx) => {
      const bs = baked.scenes[idx];
      return bs && Array.isArray(bs.cues) && bs.cues.length === (sc.lines ? sc.lines.length : 0);
    });
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

  function appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords) {
    const speaker = lineObj.speaker || null;
    if (shouldUseExactSubs(exactSubs, lineObj, lineWords)) {
      sc.subCues.push(...exactSubs.map(([s0, s1, txt]) => ({ start: cueStart + s0, end: cueStart + s1, text: txt, speaker })));
    } else {
      sc.subCues.push(...splitSubCues(lineObj.text, cueStart, cueEnd, lineWords).map(s => ({ ...s, speaker })));
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

  function buildLocalizedLines(sc, scLoc) {
    const cfg = V.getCfg();
    const speakers = cfg.tts && cfg.tts.speakers;
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

  function syncSceneLocaleMeta(sc, si) {
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
    buildLocalizedLines(sc, scLoc);
  }

  function layoutScene(sc, si, t, bSc, voiceInfo, pacing) {
    sc.start = bSc ? bSc.start : t;
    let lt = sc.lead === undefined ? pacing.LEAD : sc.lead;
    sc.cues = [];
    sc.subCues = [];

    sc.lines.forEach((lineObj, li) => {
      const [cueStart, cueEnd] = resolveCueTiming(bSc, voiceInfo.durs, si, li, lineObj, lt, pacing.CPS);
      sc.cues.push(buildCueEntry(lineObj, cueStart, cueEnd));
      const exactSubs = voiceInfo.subs[si] && voiceInfo.subs[si][li];
      const lineWords = voiceInfo.words[si] && voiceInfo.words[si][li];
      appendLineSubCues(sc, lineObj, cueStart, cueEnd, exactSubs, lineWords);
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
    const pacing = getPacing();
    const vv = (V.getActiveVoice ? V.getActiveVoice() : V.voice) || {};
    const voiceInfo = { durs: vv.durations || [], subs: resolveVoiceSubCues(vv), words: vv.words || [] };
    V.scenes.forEach((sc, si) => syncSceneLocaleMeta(sc, si));
    const baked = vv.bakedLayout;
    const useBaked = isBakedValid(baked);

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

  function resolveLayerState(layer, sc, si) {
    const prop = layer.prop || layer.id;
    const raw = sc ? sc[prop] : null;
    const val = typeof raw === 'function' ? raw(sc.ctx || V.makeCtx(sc, si), sc, si) : raw;
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
    const prevState = resolveLayerState(layer, V.scenes[idx - 1], idx - 1);
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

  function buildChoiceBtn(ch, idx, cp, resumeFn) {
    const label = cp.id && V.t ? V.t(`cp.${cp.id}.choice.${idx}`, ch.label) : ch.label;
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
    const title = cp.title && cp.id && V.t ? V.t(`cp.${cp.id}.title`, cp.title) : cp.title;
    const prompt = cp.prompt && cp.id && V.t ? V.t(`cp.${cp.id}.prompt`, cp.prompt) : cp.prompt;
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

  function getSubCfg() {
    const cfg = V.getCfg();
    return Object.assign({}, cfg.subtitles || {}, V.subtitles || {});
  }

  function resolveDefaultSubSpec() {
    if (globalOverrideSpec != null) return globalOverrideSpec;
    const subCfg = getSubCfg();
    return subCfg.layout || subCfg.position || 'center';
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
    if (subCfg.layout || subCfg.position) applySubLayout(subCfg.layout || subCfg.position);
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
      t: now, clock, alive: clock, playing: Boolean(V._isPlaying), pointer: V.pointer,
      lt, scene: sc, sceneIndex: idx, lineCue, speaking: Boolean(cue), energy: V.getSceneEnergy(sc, idx, lt),
    };
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
    let playPending = false, bgmPlayPending = false, targetSeekTime = null;

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
      if (!audio || !hooks.isPlaying() || !audio.paused || playPending) return;
      playPending = true;
      audio.playbackRate = playbackRate;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          playPending = false;
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
      if (bgmAudio.readyState >= 2 && computeBgmDrift(bgmAudio.currentTime, target.time, target.dur, bgmLoop) > 0.22) {
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
      if (audio && audio.error) audio = null;
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
      return Boolean(audio && !audioBlocked);
    }

    function tickMasterClock() {
      if (targetSeekTime == null && !audio.paused && !audio.seeking && audio.readyState >= 2) {
        keepBgmInSync(audio.currentTime);
        return audio.currentTime;
      }
      if (audio.paused && audio.readyState >= 1 && !audio.seeking) safePlayAudio();
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

    function createMasterAudio(src) {
      bindVisibilitySyncOnce();
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('loadedmetadata', () => {
        if (audio !== el) return;
        el.playbackRate = playbackRate;
        const nowVal = hooks.getNow();
        const target = targetSeekTime != null ? targetSeekTime : (nowVal > 0.05 ? nowVal : null);
        if (target != null) {
          try { el.currentTime = target; targetSeekTime = null; hooks.markSeekApplied(target); } catch {}
        }
        if (hooks.isPlaying() && el.paused) safePlayAudio();
      });
      el.addEventListener('seeked', () => { if (audio === el && hooks.isPlaying() && el.paused) safePlayAudio(); });
      el.addEventListener('canplay', () => { if (audio === el && hooks.isPlaying() && el.paused && !el.seeking) safePlayAudio(); });
      el.addEventListener('ended', () => { if (audio === el && hooks.isPlaying() && targetSeekTime == null) hooks.onEnded(); });
      el.addEventListener('error', () => {
        if (audio === el) { audio = null; if (!isRecord) hooks.onSoundUI(); }
      });
      el.src = src;
      el.load();
      return el;
    }

    function createBgmAudio(spec) {
      const el = new Audio();
      el.preload = 'auto';
      el.loop = bgmLoop;
      el.volume = spec.volume;
      el.muted = isAllMuted() || !bgmOn;
      el.addEventListener('loadedmetadata', () => {
        if (bgmAudio !== el) return;
        el.playbackRate = playbackRate;
        el.loop = bgmLoop;
        const target = resolveBgmTarget(el, resolveRefTime(), bgmLoop);
        if (target.time > 0.05) { try { el.currentTime = target.time; } catch {} }
        if (hooks.isPlaying() && !el.muted && el.paused && !target.ended) safePlayBgm();
      });
      el.addEventListener('error', () => {
        if (bgmAudio !== el) return;
        bgmAudio = null;
        hooks.onBgmUnavailable();
        hooks.onSoundUI();
      });
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
      hasBgm: () => Boolean(bgmAudio), getState,
    };
  };
})(globalThis.V = globalThis.V || {});

/* core/12-prefs-resume.js · 观看偏好（倍速/字幕/声音/配乐）持久化与按需断点续播（默认关闭 resume: false） */
(function (V) {
  if (typeof location === 'undefined') return;

  let lastFlushTs = 0;
  let lastSavedT = null;
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
    if (nextT === null || nextT === lastSavedT) return;
    lastSavedT = nextT;
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
  let showSubs = !params.has('nosubs'), playbackRate = 1, loopScene = false;
  let lastSeekTarget = -1, lastSeekAt = 0, activeCueIdx = -1;
  let webFull = false, savedFrameStyle = null, idleTimer = 0, osdTimer = 0;
  let inBar = false, lastPtrX = -9999, lastPtrY = -9999;
  const ptr = (V.pointer = V.pointer || {
    x: 960, y: 540, nx: 0, ny: 0, sx: 0, sy: 0, presence: 0, inside: false, down: false,
  });
  let wipeState = { name: '', handler: null, dom: null };
  const sandboxState = { active: false, entering: false, autoExitOnLast: true, returnTime: null, el: null, txtEl: null, backEl: null };
  const ui = {};
  let audioRt = null;

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

  function buildControlsBar(cfg, uiCfg) {
    const homeTitle = cfg.homeLabel || uiText('home');
    const homeLink = cfg.homeUrl === false
      ? null
      : h('a', { class: 'ctrl-home ctrl-icon-btn', href: cfg.homeUrl || '../', title: homeTitle, 'aria-label': homeTitle }, makeCtrlIcon(uiCfg.icons.home));
    const rateLabel = uiText('rate', { rate: '1.0x' });
    const rateWrap = uiCfg.rate
      ? h('div', { class: 'rate-wrap' },
          h('button', { class: 'ctrl-rbtn ctrl-icon-btn rate-trigger', 'data-act': 'rate', title: rateLabel, 'aria-label': rateLabel }, makeCtrlIcon(uiCfg.icons.rate)),
          h('div', { class: 'rate-menu' }))
      : null;
    const webLabel = uiText('webEnter');
    const webFullBtn = uiCfg.webFull
      ? h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'webfull', title: webLabel, 'aria-label': webLabel }, makeCtrlIcon(uiCfg.icons.webEnter))
      : null;
    const playLabel = uiText('play');
    const subsLabel = uiText('subsHide');
    const fullLabel = uiText('fullEnter');
    return h('div', { id: 'controls', 'data-interactive': '1' },
      homeLink,
      h('button', { class: 'ctrl-icon-btn', 'data-act': 'play', 'data-state': 'paused', 'aria-pressed': 'false', title: playLabel, 'aria-label': playLabel }, makeCtrlIcon(uiCfg.icons.play)),
      ...renderCustomControls('left', uiCfg),
      h('span', { class: 'time' }, '0:00'),
      h('div', { class: 'track' }, h('div', { class: 'fill' }), h('i', { class: 'thumb' }), h('div', { class: 'track-tip' })),
      h('div', { class: 'chap-wrap' },
        h('button', { class: 'chap-trigger', 'data-act': 'chap', title: uiText('chapTrigger') }, h('span', { class: 'chap-cur-txt' }), h('i', { class: 'chap-caret' }, makeCtrlIcon(uiCfg.icons.chapCaret))),
        h('div', { class: 'chap-menu' }, h('div', { class: 'chap-menu-hd' }, uiText('chapHeader')), h('div', { class: 'chap-list' }))),
      ...renderCustomControls('right', uiCfg),
      rateWrap,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'subs', title: subsLabel, 'aria-label': subsLabel }, makeCtrlIcon(uiCfg.icons.subsOn)),
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'mute', title: uiText('soundOnTip', { pct: 100 }), 'aria-label': uiText('soundLabel') }, makeCtrlIcon(uiCfg.icons.volumeOn)),
      h('div', { class: 'sound-menu' }),
      webFullBtn,
      h('button', { class: 'ctrl-rbtn ctrl-icon-btn', 'data-act': 'full', title: fullLabel, 'aria-label': fullLabel }, makeCtrlIcon(uiCfg.icons.fullEnter)));
  }

  V.mountStage = function () {
    const cfg = V.getCfg();
    const uiCfg = getUiCfg(cfg);
    const W = cfg.width || 1920, H = cfg.height || 1080;
    V.stageWidth = W;
    V.stageHeight = H;
    if (!ptr.inside) { ptr.x = W / 2; ptr.y = H / 2; }
    if (cfg.theme && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.style.setProperty('--stage-w', W + 'px');
    document.documentElement.style.setProperty('--stage-h', H + 'px');
    document.body.classList.toggle('ctrl-overlay', uiCfg.controlsMode === 'overlay');
    if (document.getElementById('stage')) return;

    const sbTxt = h('span', { class: 'v-sandbox-txt egg-ban-txt' }, uiText('sandboxActive'));
    const sbBack = h('button', { class: 'v-sandbox-back egg-back-btn', 'data-interactive': '1', type: 'button' }, uiText('sandboxBack'));
    const sbBar = h('div', { class: 'v-sandbox-bar egg-banner', 'data-interactive': '1' }, sbTxt, sbBack);
    const osdEl = h('div', { id: 'osd', 'aria-live': 'polite' });
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
      h('div', { id: 'start-hint' }, cfg.startHint || uiText('startHint')));

    document.body.prepend(vp, buildControlsBar(cfg, uiCfg));
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
      syncVideoClip(clip, lt, playing && !scrubbing);
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
    sc.ctx.idle = idle;
    sc.ctx.playing = playing && !scrubbing;
    sc.ctx.ended = ended;
    sc.ctx.pointer = ptr;
  }

  function runSceneUpdate(sc, lt, idle) {
    V._renderTick = (V._renderTick || 0) + 1;
    V._isPlaying = playing && !scrubbing;
    V._inSceneUpdate = true;
    try {
      sc.update(shouldContinueSceneAtEnd(sc, idle) ? lt + idle : lt, sc.ctx);
    } finally {
      V._inSceneUpdate = false;
    }
  }

  function render(t, nextIdle) {
    if (!V.scenes.length || !Number.isFinite(t)) return;
    const idle = RECORD ? 0 : (nextIdle === undefined ? idleSec : nextIdle);
    idleSec = idle;
    const prevT = prevRenderNow;
    now = clamp(t, 0, V.duration - 0.001);
    const clock = RECORD ? now : now + ambientOffset;
    prevRenderNow = now;
    V._now = now;
    V._clock = clock;
    if (RECORD) V._checkpointsRuntime.syncRecordCheckpoints(now);
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
    runSceneUpdate(sc, lt, idle);
    syncSceneVideoClips(lt);
    activeCueIdx = V._subtitlesRuntime.updateSubs(sc, idx, lt, now, clock, showSubs);
    V._layersRuntime.updateLayers(sc, idx, lt, now, activeCueIdx >= 0);
    if (!RECORD) V._checkpointsRuntime.checkSceneCheckpoints(sc, idx, prevT, now, { isRecord: false, playing, scrubbing, pause, play });
    const aState = audioRt ? audioRt.getState(now) : { hasAudio: false, muted: false, voiceOn: true, volume: 1 };
    V.emit('onRender', {
      now, clock, alive: clock, idle, ended, prevT, lt, scene: sc, sceneIndex: idx, activeCueIdx,
      playing, scrubbing, sandbox: sandboxState.active, pointer: ptr,
      hasAudio: aState.hasAudio, isRecord: RECORD, muted: aState.muted, voiceOn: aState.voiceOn !== false, volume: aState.volume,
    });
    if (!RECORD) updateUI();
  }

  function showUiHold() {
    inBar = true;
    clearTimeout(idleTimer);
    document.body.classList.add('ui-active');
  }

  function scheduleUiHide(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!inBar) document.body.classList.remove('ui-active');
    }, ms);
  }

  function flashUi(ms = 1500) {
    document.body.classList.add('ui-active');
    if (!inBar) scheduleUiHide(ms);
  }

  function releaseBarHold() {
    inBar = false;
    scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
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

  function advanceAudioClock(ts, rawDt) {
    lastTs = ts;
    const mTime = audioRt.tickMasterClock();
    if (mTime != null) {
      if (checkSceneLoop(mTime)) return;
      if (mTime >= V.duration - 0.01) finishPlayback();
      else render(mTime, 0);
      return;
    }
    if (shouldTickAmbientPause(current)) {
      ambientOffset += rawDt;
      render(now, 0);
    }
  }

  function advanceWallClock(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000) * playbackRate;
    lastTs = ts;
    if (checkSceneLoop(now + dt)) return;
    if (audioRt) audioRt.syncWithWallClock(now);
    if (now + dt >= V.duration - 0.002) finishPlayback();
    else render(now + dt, 0);
  }

  function frame(ts) {
    const rawDt = lastFrameTs > 0 ? clamp((ts - lastFrameTs) / 1000, 0, 0.1) : 0;
    lastFrameTs = ts;
    stepPointerSmoothing(rawDt);
    if (scrubbing) {
      lastTs = ts;
      if (current && current.live) render(now, 0);
    } else if (playing) {
      if (audioRt && audioRt.canUseMasterClock()) advanceAudioClock(ts, rawDt);
      else advanceWallClock(ts);
    } else if (shouldTickAmbientPause(current)) {
      ambientOffset += rawDt;
      idleSec += rawDt;
      render(now, idleSec);
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
    if (prev && !mode) {
      blurMenuInput(bar);
      if (!inBar) scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
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
    lastTs = performance.now();
    if (audioRt) audioRt.startPlayback();
    document.body.classList.add('playing');
    V.emit('onPlay', { now, playing: true });
    if (!RECORD) {
      if (!inBar) scheduleUiHide(getUiCfg(V.getCfg()).idleHideDelay);
      updateUI();
    }
  }

  function pause() {
    playing = false;
    idleSec = 0;
    ended = now >= V.duration - 0.01;
    document.body.classList.remove('playing');
    document.body.classList.toggle('is-ended', ended);
    if (audioRt) audioRt.pausePlayback();
    for (const clip of V._videoClips) if (clip.pause) clip.pause();
    V.emit('onPause', { now, ended, playing: false });
    if (!RECORD) updateUI();
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
    const target = clamp(t, 0, V.duration - 0.001);
    const ts = performance.now();
    if (!force && isRedundantSeek(target, ts)) return;
    lastTs = ts;
    idleSec = 0;
    lastSeekTarget = target;
    lastSeekAt = ts;
    if (V._checkpointsRuntime && V._checkpointsRuntime.onSeek) V._checkpointsRuntime.onSeek(target);
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
      const startX = e.clientX;
      let dragged = false, uncommittedT = null, lastAudioSeekTs = performance.now();
      scrubbing = true;
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
        scrubbing = false;
        document.body.classList.remove('scrubbing');
        if (uncommittedT != null) seek(uncommittedT, true);
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
    setBtnIcon(ui.webfull, webFull ? 'webExit' : 'webEnter', webFull ? icons.webExit : icons.webEnter, uiText(webFull ? 'webExit' : 'webEnter'), webFull);
    setBtnIcon(ui.full, osOn ? 'fullExit' : 'fullEnter', osOn ? icons.fullExit : icons.fullEnter, uiText(osOn ? 'fullExit' : 'fullEnter'), osOn);
    releaseBarHold();
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
    if (bar && bar.classList.contains('menu-open')) { setOpenMenu(bar, ''); e.preventDefault(); }
    else if (sandboxState.active) { exitSandbox(true); e.preventDefault(); }
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
    if (isEventOverBar(bar, e.target)) {
      resetPointerLeave();
      return;
    }
    applyStagePointerCoords(e);
  }

  function wakeFromPointer(bar, uiCfg, e, force) {
    const overBar = isPointerOverBar(bar, e);
    if (overBar) resetPointerLeave();
    else applyStagePointerCoords(e);
    if (!force && Math.abs(e.clientX - lastPtrX) < 1 && Math.abs(e.clientY - lastPtrY) < 1) return;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    if (overBar) showUiHold();
    else { inBar = false; flashUi(uiCfg.idleHideDelay); }
  }

  function isBarOverlayHidden(bar) {
    const b = document.body.classList;
    if (!(b.contains('ctrl-overlay') || b.contains('web-full') || b.contains('os-full'))) return false;
    if (!b.contains('playing')) return false;
    if (b.contains('ui-active') || b.contains('scrubbing') || b.contains('menu-open')) return false;
    return !(bar && bar.matches && bar.matches(':has(.chap-search:focus)'));
  }

  function bindBlindBarGuard(bar, uiCfg) {
    if (!bar) return;
    let blindPointerType = '';
    bar.addEventListener('pointerdown', e => {
      if (!isBarOverlayHidden(bar)) { blindPointerType = ''; return; }
      blindPointerType = e.pointerType || 'mouse';
      e.stopPropagation();
      e.preventDefault();
      flashUi(blindPointerType === 'touch' ? 2200 : uiCfg.idleHideDelay);
    }, true);
    bar.addEventListener('click', e => {
      if (!blindPointerType) return;
      const pt = blindPointerType;
      blindPointerType = '';
      e.stopPropagation();
      e.preventDefault();
      if (pt !== 'touch' && playing) pause();
    }, true);
  }

  function bindIdleWake(bar, uiCfg) {
    bindBlindBarGuard(bar, uiCfg);
    const clearOnLeave = () => {
      inBar = false;
      lastPtrX = -9999;
      lastPtrY = -9999;
      resetPointerLeave();
      scheduleUiHide(uiCfg.leaveHideDelay);
    };
    const clearDown = () => { ptr.down = false; };
    document.addEventListener('pointerenter', e => wakeFromPointer(bar, uiCfg, e, true));
    addEventListener('pointermove', e => wakeFromPointer(bar, uiCfg, e, false));
    if (bar) bar.addEventListener('pointerleave', () => { inBar = false; scheduleUiHide(uiCfg.idleHideDelay); });
    document.addEventListener('mouseleave', clearOnLeave);
    addEventListener('blur', clearOnLeave);
    addEventListener('pointerdown', e => {
      updatePointerFromEvent(bar, e);
      if (ptr.inside) ptr.down = true;
      if (e.pointerType === 'touch') flashUi(bar && bar.contains(e.target) ? 2200 : uiCfg.idleHideDelay);
    });
    addEventListener('pointerup', clearDown);
    addEventListener('pointercancel', clearDown);
    addEventListener('focusin', e => {
      if (bar && bar.contains(e.target)) flashUi(uiCfg.idleHideDelay);
    });
    flashUi(uiCfg.idleHideDelay);
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
    const label = uiText(key);
    ui.play.dataset.state = state;
    ui.play.setAttribute('aria-pressed', String(playing));
    swapBtnIcon(ui.play, key, icons[key], label);
  }

  function syncSubsBtnUI() {
    if (!ui.subs) return;
    const icons = getUiCfg(V.getCfg()).icons;
    const key = showSubs ? 'subsOn' : 'subsOff';
    ui.subs.classList.toggle('is-off', !showSubs);
    swapBtnIcon(ui.subs, key, icons[key], uiText(showSubs ? 'subsHide' : 'subsShow'));
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
    ui.subs.onclick = () => setSubs(!showSubs);
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

  function waitVideoMetadata(vid, timeoutMs = 2000) {
    return new Promise(resolve => {
      const done = ok => {
        clearTimeout(timer);
        vid.removeEventListener('loadedmetadata', onMeta);
        vid.removeEventListener('error', onErr);
        resolve(ok);
      };
      const onMeta = () => done(true);
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), timeoutMs);
      vid.addEventListener('loadedmetadata', onMeta, { once: true });
      vid.addEventListener('error', onErr, { once: true });
    });
  }

  async function seekVideoElementAsync(vid, targetSec) {
    if (vid.readyState === 0) {
      const ready = await waitVideoMetadata(vid, 2000);
      if (!ready || vid.readyState === 0) return;
    }
    if (Math.abs((vid.currentTime || 0) - targetSec) < 0.008 && !vid.seeking) return;
    await new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        vid.removeEventListener('seeked', done);
        vid.removeEventListener('error', done);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      vid.addEventListener('seeked', done, { once: true });
      vid.addEventListener('error', done, { once: true });
      try { vid.currentTime = targetSec; } catch { done(); }
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

  async function ensureLocaleAssetsLoaded(target) {
    if (shouldProbeLocalePack(target)) await loadOptionalScript(`locales/${target}.js`);
    if (V.activateCachedVoice && V.activateCachedVoice(target)) return;
    const cfg0 = V.getCfg();
    const baseTimings = cfg0.timingsScript || 'assets/voice/timings.js';
    const isSec = V.isSecondaryLocale ? V.isSecondaryLocale(target) : false;
    const targetTimings = isSec ? baseTimings.replace(/\.js$/i, `.${target}.js`) : baseTimings;
    const ok = await loadOptionalScript(targetTimings);
    if (ok && V.captureVoice) V.captureVoice(V.voice);
    else clearStaleVoiceIfNeeded();
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
  }

  function refreshLocalizedChrome(cfg, uiCfg) {
    if (sandboxState.txtEl && !sandboxState.active) sandboxState.txtEl.textContent = uiText('sandboxActive');
    if (sandboxState.backEl) sandboxState.backEl.textContent = uiText('sandboxBack');
    const hintEl = document.getElementById('start-hint');
    if (hintEl) hintEl.textContent = cfg.startHint || uiText('startHint');
    if (RECORD) return;
    const bar = document.getElementById('controls');
    if (!bar) return;
    syncStaticBarLabels(bar, cfg);
    mountTrackMarks(bar.querySelector('.track'), uiCfg);
    buildChapters(bar);
    buildSoundMenu(bar);
    syncRateBtnUI();
    syncSubsBtnUI();
    syncFullUI();
  }

  function resolveTargetLangCode(nextLang) {
    const trimmed = String(nextLang || '').trim();
    if (trimmed) return trimmed;
    return (V.getBaseLang && V.getBaseLang()) || '';
  }

  function applyPostLocaleReload(pos, wasPlaying, target) {
    if (V.syncDocLangAttrs) V.syncDocLangAttrs();
    if (current && current.root) current.root.remove();
    current = null;
    V.layout();
    const cfg = V.getCfg(), uiCfg = getUiCfg(cfg);
    if (cfg.title) document.title = cfg.title;
    mountHudTicks(uiCfg);
    if (audioRt) audioRt.reloadTracks(cfg);
    refreshLocalizedChrome(cfg, uiCfg);
    lastSeekTarget = -1;
    seek(resolveMappedPos(pos), true);
    if (wasPlaying && audioRt) audioRt.startPlayback();
    V.emit('onLocaleChange', { lang: V.getActiveLang(), duration: V.duration });
    const hit = V.getAvailableLocales ? V.getAvailableLocales().find(x => x.code.toLowerCase() === target.toLowerCase()) : null;
    if (hit) flashOsd(hit.label);
  }

  async function setLang(nextLang) {
    const target = resolveTargetLangCode(nextLang);
    const prevLang = V.getActiveLang();
    if (target === prevLang) return prevLang;
    const pos = captureLogicalPos();
    const wasPlaying = playing;
    if (wasPlaying && audioRt) audioRt.pausePlayback();
    V.resetCheckpoints();
    if (V.captureVoice && V.voice) V.captureVoice(V.voice);
    V.__langOverridden = true;
    V.__activeLang = target;
    await ensureLocaleAssetsLoaded(target);
    applyPostLocaleReload(pos, wasPlaying, target);
    return V.getActiveLang();
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

  function syncInitialLocaleState() {
    if (V.captureVoice && V.voice) V.captureVoice(V.voice);
    if (V.syncDocLangAttrs) V.syncDocLangAttrs();
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
    applySavedPrefs(savedPrefs);

    audioRt = V._createAudioRuntime({
      params,
      isRecord: RECORD,
      isPlaying: () => playing,
      getNow: () => now,
      getCurrentScene: () => current,
      markSeekApplied: target => { lastSeekTarget = target; lastSeekAt = performance.now(); },
      onSoundUI: syncSoundMenuUI,
      onAudioBlocked: () => flashOsd(uiText('osdBlocked'), 1800),
      onEnded: finishPlayback,
      onVisibilitySync: t => render(t, 0),
      onBgmUnavailable: syncSoundMenuUI,
    });
    audioRt.setRate(playbackRate);
    audioRt.initTracks(cfg, uiCfg, savedPrefs);

    V.seekTo = t => render(t, 0);
    V.seekToAsync = async t => { render(t, 0); await waitStageAssets(); };
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

    if (RECORD) document.body.classList.add('record');
    else buildUI(uiCfg);
    V.emit('onStart', V._playerCtl);

    fit();
    addEventListener('resize', () => { releaseBarHold(); fit(); });
    lastFrameTs = performance.now();
    ambientOffset = 0;
    idleSec = 0;
    const initPos = resolveInitialTime(uiCfg);
    if (initPos.t > 0) {
      seek(initPos.t);
      if (initPos.resumed) flashOsd(uiText('osdResumed', { time: fmtTime(initPos.t) }), 1200);
    } else {
      render(0, 0);
    }
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

  function clearStaleVoiceIfNeeded() {
    if (V.voice && V.isVoiceLocaleMatch && !V.isVoiceLocaleMatch(V.voice)) {
      V.voice = null;
    }
  }

  function shouldProbeLocalePack(lang) {
    if (!lang || V.locales[lang]) return false;
    if (V.isSecondaryLocale && V.isSecondaryLocale(lang)) return true;
    const base = V.getBaseLang ? V.getBaseLang() : '';
    const explicit = Boolean(V.__activeLang || params.get('lang'));
    return explicit && Boolean(!base || lang.toLowerCase() !== base.toLowerCase());
  }

  async function loadBootLocaleTimings(cfg, lang) {
    if (!lang || (V.isSecondaryLocale && !V.isSecondaryLocale(lang))) return;
    const baseTimings = cfg.timingsScript || 'assets/voice/timings.js';
    const langTimings = baseTimings.replace(/\.js$/i, `.${lang}.js`);
    if (langTimings === baseTimings) return;
    const ok = await loadOptionalScript(langTimings);
    if (ok && V.captureVoice) V.captureVoice(V.voice);
    else clearStaleVoiceIfNeeded();
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
    await ensureDynamicBootAssets();
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

