/* core/01-registry.js · 微内核注册表与开放扩展契约（Plugin / Transition / Control / Preset / Layer / Locale） */
(function (V) {
  V.scenes = V.scenes || [];
  V.layers = V.layers || [];
  V.plugins = V.plugins || [];
  V.transitions = V.transitions || {};
  V.controls = V.controls || [];
  V.presets = V.presets || {};
  V.locales = V.locales || {};
  V.subtitles = V.subtitles || {};
  V.customIcons = V.customIcons || {};
  V.config = V.config || {};
  V.c = V.c || {};
  V.checkpointState = V.checkpointState || {};
  V._videoClips = V._videoClips || new Set();

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
    return na === nb || na.split('-')[0] === nb.split('-')[0];
  }

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
    return Object.assign({}, a || {}, b || {});
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
    return merged;
  };
})(globalThis.V = globalThis.V || {});
