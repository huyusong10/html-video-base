/* 可独立载入 iframe 的帧协议客户端；不依赖播放器或具体渲染器。 */
(function (root) {
  const PROTOCOL = 'html-video-source-v1';

  function aborted() { return new DOMException('Frame operation cancelled', 'AbortError'); }

  function parentOrigin(options) {
    if (options.origin) return options.origin;
    if (document.referrer) return new URL(document.referrer).origin;
    return location.origin;
  }

  root.VFrameClient = {
    connect(options) {
      if (typeof options?.prepare !== 'function') throw new TypeError('Frame client requires prepare(state,frame,context)');
      const origin = parentOrigin(options);
      if (!origin || origin === '*' || origin === 'null') throw new TypeError('Frame client requires an exact parent origin');
      let connection = null, initialization = null, lifetime = null, current = null;
      let ready = false, frameId = null, disposed = false;
      let cleanup = Promise.resolve();

      function reply(target, requestId, type, payload = {}) {
        target.window.postMessage({ protocol: PROTOCOL, type, requestId,
          sourceId: target.sourceId, session: target.session, ...payload }, target.origin);
      }

      function sameConnection(data) {
        return connection && connection.sourceId === data.sourceId && connection.session === data.session;
      }

      function cancelCurrent(requestId) {
        if (current && (requestId === undefined || current.id === requestId)) current.abort.abort();
      }

      function release() {
        if (!connection) return cleanup;
        connection = null;
        ready = false;
        cancelCurrent();
        lifetime?.abort();
        cleanup = cleanup.catch(() => {}).then(() => options.dispose?.());
        cleanup.catch(error => console.error(error));
        return cleanup;
      }

      function initialize(data, event) {
        if (!sameConnection(data)) {
          const previousCleanup = release();
          lifetime = new AbortController();
          ready = false;
          connection = { sourceId: data.sourceId, session: data.session, window: event.source, origin: event.origin };
          const initLifetime = lifetime;
          initialization = previousCleanup.then(() => {
            if (initLifetime.signal.aborted) throw aborted();
            return options.initialize?.({ signal: initLifetime.signal, mode: data.mode });
          });
        }
        const target = connection;
        const initLifetime = lifetime;
        initialization.then(() => {
          if (target !== connection || initLifetime.signal.aborted) return;
          ready = true;
          reply(target, 0, 'ready');
        }, error => {
          if (target === connection && error?.name !== 'AbortError') reply(target, 0, 'error', { message: error?.message ?? String(error) });
        });
      }

      async function prepare(data) {
        cancelCurrent();
        const target = connection;
        const request = { id: data.requestId, abort: new AbortController() };
        current = request;
        try {
          await initialization;
          if (request.abort.signal.aborted) throw aborted();
          await options.prepare(data.state, data.frame, { signal: request.abort.signal, mode: data.frame.isRecord ? 'record' : data.frame.pptMode ? 'ppt' : 'interactive' });
          if (request.abort.signal.aborted || target !== connection) throw aborted();
          frameId = data.frame.id;
          reply(target, data.requestId, 'complete', { frameId });
        } catch (error) {
          if (error?.name !== 'AbortError' && target === connection && !request.abort.signal.aborted) {
            reply(target, data.requestId, 'error', { message: error?.message ?? String(error) });
          }
        } finally { if (current === request) current = null; }
      }

      function receive(event) {
        const data = event.data;
        if (disposed || event.source !== root.parent || event.origin !== origin) return;
        if (data?.protocol !== PROTOCOL || typeof data.session !== 'string' || !data.sourceId) return;
        if (data.type === 'hello') { initialize(data, event); return; }
        if (!sameConnection(data)) return;
        if (data.type === 'prepare') prepare(data);
        else if (data.type === 'cancel') cancelCurrent(data.requestId);
        else if (data.type === 'dispose') release();
      }

      root.addEventListener('message', receive);
      return {
        get ready() { return ready; },
        get frameId() { return frameId; },
        dispose() {
          if (disposed) return cleanup;
          disposed = true;
          root.removeEventListener('message', receive);
          return release();
        },
      };
    },
  };
})(globalThis);
