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
