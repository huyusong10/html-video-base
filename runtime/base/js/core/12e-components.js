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
