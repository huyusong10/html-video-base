/* core/11-audio.js · 解说干声与背景音乐双轨独立加载、寻道防漂移同步与声音状态机 */
(function (V) {
  if (typeof location === 'undefined') return;

  function resolveAudioSource(cfg, isRecord) {
    if (cfg.audioSrc === false || isRecord) return null;
    return (V.voice && V.voice.src) || cfg.audioSrc || null;
  }

  function resolveBgmSource(cfg, isRecord) {
    if (cfg.audioSrc === false || cfg.bgm === false || cfg.bgmSrc === false || isRecord) return null;
    return (V.voice && V.voice.bgmSrc) || cfg.bgmSrc || null;
  }

  V._createAudioRuntime = function (hooks) {
    const { params, isRecord } = hooks;
    let audio = null, bgmAudio = null, playbackRate = 1;
    let voiceOn = !params.has('novoice'), bgmOn = !params.has('nobgm'), muted = false;
    let audioBlocked = false, unlockArmed = false, playPending = false, bgmPlayPending = false, targetSeekTime = null;

    function isAllMuted() {
      return muted || (!voiceOn && (!bgmAudio || !bgmOn));
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

    function safePlayBgm() {
      if (!bgmAudio || !hooks.isPlaying() || bgmAudio.muted || !bgmAudio.paused || bgmPlayPending) return;
      bgmPlayPending = true;
      bgmAudio.playbackRate = playbackRate;
      const p = bgmAudio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { bgmPlayPending = false; }).catch(() => { bgmPlayPending = false; });
      } else {
        bgmPlayPending = false;
      }
    }

    function syncBgmPlaybackNow() {
      if (!bgmAudio) return;
      bgmAudio.muted = isAllMuted() || !bgmOn;
      bgmAudio.playbackRate = playbackRate;
      if (!hooks.isPlaying() || bgmAudio.muted) { bgmAudio.pause(); return; }
      const refT = resolveRefTime();
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

    function resolveSoundBtnSpec() {
      const allOff = isAllMuted();
      if (allOff) return ['volumeMute', '取消静音（M）'];
      if (bgmAudio && !voiceOn && bgmOn) return ['volumeBgm', '声音设置：仅背景音乐（M 静音 / B 开关配乐）'];
      if (bgmAudio && voiceOn && !bgmOn) return ['volumeVoice', '声音设置：已关背景乐（M 静音 / B 恢复配乐）'];
      return ['volumeOn', bgmAudio ? '声音设置（M 静音 / B 开关配乐）' : '静音（M）'];
    }

    function emitAndSync() {
      const allOff = isAllMuted();
      if (audio) audio.muted = allOff || !voiceOn;
      syncBgmPlaybackNow();
      hooks.onSoundUI();
      V.emit('onSoundChange', {
        muted: allOff,
        voiceOn: !allOff && voiceOn,
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
      if (!muted && !voiceOn && (!bgmAudio || !bgmOn)) voiceOn = true;
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
      if (bgmAudio && bgmAudio.readyState >= 1) {
        try { bgmAudio.currentTime = nowVal; } catch {}
      }
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

    function createBgmAudio(src) {
      const el = new Audio();
      el.preload = 'auto';
      el.muted = isAllMuted() || !bgmOn;
      el.addEventListener('loadedmetadata', () => {
        el.playbackRate = playbackRate;
        const refT = resolveRefTime();
        if (refT > 0.05) { try { el.currentTime = refT; } catch {} }
        if (hooks.isPlaying() && !el.muted && el.paused) safePlayBgm();
      });
      el.addEventListener('error', () => {
        if (bgmAudio !== el) return;
        bgmAudio = null;
        hooks.onBgmUnavailable();
        hooks.onSoundUI();
      });
      el.src = src;
      el.load();
      return el;
    }

    function initTracks(cfg, uiCfg, savedPrefs) {
      if (uiCfg.bgmDefault === false && !params.has('bgm')) bgmOn = false;
      if (savedPrefs) {
        if (typeof savedPrefs.muted === 'boolean') muted = savedPrefs.muted;
        if (typeof savedPrefs.voice === 'boolean' && !params.has('novoice')) voiceOn = savedPrefs.voice;
        if (typeof savedPrefs.bgm === 'boolean' && !params.has('nobgm') && !params.has('bgm')) bgmOn = savedPrefs.bgm;
      }
      const audioSrc = resolveAudioSource(cfg, isRecord);
      if (audioSrc) {
        audio = createMasterAudio(audioSrc);
        audio.muted = isAllMuted() || !voiceOn;
      }
      const bgmSrc = resolveBgmSource(cfg, isRecord);
      if (bgmSrc) bgmAudio = createBgmAudio(bgmSrc);
    }

    function getState(nowVal) {
      const allOff = isAllMuted();
      return {
        hasAudio: Boolean(audio),
        hasBgm: Boolean(bgmAudio),
        muted: allOff,
        voiceOn: !allOff && voiceOn,
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
      tickMasterClock, hasBgm: () => Boolean(bgmAudio), getState,
    };
  };
})(globalThis.V = globalThis.V || {});
