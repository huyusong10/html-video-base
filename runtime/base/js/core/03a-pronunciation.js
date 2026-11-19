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
