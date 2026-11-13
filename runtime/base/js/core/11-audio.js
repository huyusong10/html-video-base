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
