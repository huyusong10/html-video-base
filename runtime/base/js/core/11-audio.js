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
    if (isVoiceLocaleMatch() && V.voice.bgmSrc) return { src: V.voice.bgmSrc, volume: 1 };
    const src = localizeFallbackMedia(extractRawBgmSrc(cfg), 'bgmSrc');
    return src ? { src, volume: resolveRawBgmVolume(cfg) } : null;
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

  V._createAudioRuntime = function (hooks) {
    const { params, isRecord } = hooks;
    let audio = null, bgmAudio = null, playbackRate = 1, bgmLoop = true;
    let voiceOn = !params.has('novoice'), bgmOn = !params.has('nobgm'), muted = false;
    let audioBlocked = false, unlockArmed = false, playPending = false, bgmPlayPending = false, targetSeekTime = null;

    function isAllMuted() {
      if (muted) return true;
      const activeVoice = audio ? voiceOn : (!bgmAudio && voiceOn);
      const activeBgm = Boolean(bgmAudio) && bgmOn;
      return !activeVoice && !activeBgm;
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
      if (!audioBlocked) return;
      audioBlocked = false;
      if (hooks.isPlaying()) startPlayback();
    }

    function armBlockedUnlock() {
      if (unlockArmed) return;
      unlockArmed = true;
      document.addEventListener('pointerdown', unlockBlockedAudio, true);
      document.addEventListener('keydown', unlockBlockedAudio, true);
    }

    function safePlayAudio() {
      if (!audio || !hooks.isPlaying() || !audio.paused || playPending) return;
      playPending = true;
      audio.playbackRate = playbackRate;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { playPending = false; audioBlocked = false; })
         .catch(err => {
           playPending = false;
           if (err && err.name === 'NotAllowedError') { audioBlocked = true; armBlockedUnlock(); }
         });
      } else {
        playPending = false;
      }
    }

    function handleBgmPlayErr(err) {
      bgmPlayPending = false;
      if (err && err.name === 'NotAllowedError') {
        audioBlocked = true;
        armBlockedUnlock();
      }
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

    function resolveSoundBtnSpec() {
      const allOff = isAllMuted();
      if (allOff) return ['volumeMute', '取消静音（M）'];
      if (bgmAudio && (!audio || !voiceOn) && bgmOn) return ['volumeBgm', '声音设置：仅背景音乐（M 静音 / B 开关配乐）'];
      if (bgmAudio && voiceOn && !bgmOn) return ['volumeVoice', '声音设置：已关背景乐（M 静音 / B 恢复配乐）'];
      return ['volumeOn', bgmAudio ? '声音设置（M 静音 / B 开关配乐）' : '静音（M）'];
    }

    function emitAndSync() {
      const allOff = isAllMuted();
      const voiceActive = Boolean(audio || !bgmAudio) && !allOff && voiceOn;
      if (audio) audio.muted = allOff || !voiceOn;
      syncBgmPlaybackNow();
      hooks.onSoundUI();
      V.emit('onSoundChange', {
        muted: allOff,
        voiceOn: voiceActive,
        bgmOn: Boolean(bgmAudio) && !allOff && bgmOn,
        rawMuted: muted,
        rawVoiceOn: voiceOn,
        rawBgmOn: bgmOn,
      });
    }

    function setBgm(on) {
      bgmOn = Boolean(on);
      if (bgmOn && muted) muted = false;
      emitAndSync();
    }

    function setVoice(on) {
      voiceOn = Boolean(on);
      if (voiceOn && muted) muted = false;
      emitAndSync();
    }

    function setMuted(nextMuted) {
      muted = Boolean(nextMuted);
      if (!muted && isAllMuted()) {
        if (audio || !bgmAudio) voiceOn = true;
        else bgmOn = true;
      }
      emitAndSync();
    }

    function toggleVoiceFromMenu() {
      if (isAllMuted()) { muted = false; voiceOn = true; bgmOn = false; emitAndSync(); }
      else setVoice(!voiceOn);
    }

    function toggleBgmFromMenu() {
      if (isAllMuted()) { muted = false; voiceOn = false; bgmOn = true; emitAndSync(); }
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

    function createMasterAudio(src) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('loadedmetadata', () => {
        el.playbackRate = playbackRate;
        const nowVal = hooks.getNow();
        const target = targetSeekTime != null ? targetSeekTime : (nowVal > 0.05 ? nowVal : null);
        if (target != null) {
          try { el.currentTime = target; targetSeekTime = null; hooks.markSeekApplied(target); } catch {}
        }
        if (hooks.isPlaying() && el.paused) safePlayAudio();
      });
      el.addEventListener('seeked', () => { if (hooks.isPlaying() && el.paused) safePlayAudio(); });
      el.addEventListener('canplay', () => { if (hooks.isPlaying() && el.paused && !el.seeking) safePlayAudio(); });
      el.addEventListener('ended', () => { if (hooks.isPlaying() && targetSeekTime == null) hooks.onEnded(); });
      el.addEventListener('error', () => {
        if (audio === el) { audio = null; if (!isRecord) hooks.onSoundUI(); }
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && hooks.isPlaying() && !el.paused && !el.seeking && targetSeekTime == null && el.readyState >= 2) hooks.onVisibilitySync(el.currentTime);
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

    function applySavedSoundPrefs(savedPrefs) {
      if (!savedPrefs) return;
      if (typeof savedPrefs.muted === 'boolean') muted = savedPrefs.muted;
      if (typeof savedPrefs.voice === 'boolean' && !params.has('novoice')) voiceOn = savedPrefs.voice;
      if (typeof savedPrefs.bgm === 'boolean' && !params.has('nobgm') && !params.has('bgm')) bgmOn = savedPrefs.bgm;
    }

    function initTracks(cfg, uiCfg, savedPrefs) {
      bgmLoop = !(cfg.bgm && typeof cfg.bgm === 'object' && cfg.bgm.loop === false);
      if (uiCfg.bgmDefault === false && !params.has('bgm')) bgmOn = false;
      applySavedSoundPrefs(savedPrefs);
      const audioSrc = resolveAudioSource(cfg, isRecord);
      if (audioSrc) {
        audio = createMasterAudio(audioSrc);
        audio.muted = isAllMuted() || !voiceOn;
      }
      const bgmSpec = resolveBgmTrackSpec(cfg, isRecord);
      if (bgmSpec) bgmAudio = createBgmAudio(bgmSpec);
    }

    function getState(nowVal) {
      const allOff = isAllMuted();
      return {
        hasAudio: Boolean(audio),
        hasBgm: Boolean(bgmAudio),
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
      initTracks, startPlayback, pausePlayback, seekTracks, setRate,
      setBgm, setVoice, setMuted, toggleVoiceFromMenu, toggleBgmFromMenu,
      isAllMuted, resolveSoundBtnSpec, canUseMasterClock,
      tickMasterClock, syncWithWallClock: keepBgmInSync,
      hasBgm: () => Boolean(bgmAudio), getState,
    };
  };
})(globalThis.V = globalThis.V || {});
