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
