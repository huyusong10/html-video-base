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
    prepareStartup() {
      return Promise.all(Array.from(sources.values(), source => source.prepareStartup?.()));
    },
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
