/* Optional entry script. It runs before the player and needs no stylesheet. */
(function () {
  if (typeof location === 'undefined' || !document.body) return;
  const params = new URLSearchParams(location.search);
  if (params.has('record') || params.has('capture')) return;

  const V = globalThis.V = globalThis.V || {};
  if (V._loading) return;

  const lang = document.documentElement.lang.toLowerCase();
  let labels = ['Loading…', 'Loading failed', 'Retry'];
  if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(lang)) labels = ['正在載入…', '載入失敗', '重試'];
  else if (lang === 'zh' || lang.startsWith('zh-')) labels = ['正在加载…', '加载失败', '重试'];

  const style = document.createElement('style');
  style.textContent = `
    #video-loading {
      position: fixed; inset: 0; z-index: 1000;
      display: grid; place-items: center; background: #0f172a; color: #f8fafc;
      font: 500 16px/1.5 system-ui, sans-serif;
    }
    #video-loading > div { display: flex; align-items: center; gap: 12px; }
    #video-loading button {
      padding: 4px 12px; font: inherit; color: inherit; background: transparent;
      border: 1px solid currentColor; border-radius: 6px; cursor: pointer;
    }
  `;
  document.head.append(style);

  const screen = document.createElement('div');
  screen.id = 'video-loading';
  const row = document.createElement('div');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = labels[0];
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = labels[2];
  retry.hidden = true;
  retry.onclick = () => location.reload();
  row.append(status, retry);
  screen.append(row);
  document.body.append(screen);

  const locked = [];
  function lock(element) {
    if (element && !element.inert) {
      element.inert = true;
      locked.push(element);
    }
  }

  function blockKeys(event) {
    if (screen.contains(event.target)) return;
    event.stopImmediatePropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab' && !retry.hidden) retry.focus();
    event.preventDefault();
  }
  window.addEventListener('keydown', blockKeys, true);

  function fail() {
    status.textContent = labels[1];
    retry.hidden = false;
    if (document.hasFocus()) retry.focus();
  }

  function finish() {
    window.removeEventListener('keydown', blockKeys, true);
    for (const element of locked.splice(0)) element.inert = false;
    screen.remove();
  }

  function waitForPaint() {
    if (document.hidden) return Promise.resolve();
    return new Promise(resolve => {
      // Give the loading UI a paint before work that can occupy the main thread.
      const deadline = setTimeout(resolve, 100);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(deadline);
        resolve();
      }));
    });
  }

  V._loading = { fail, finish, lock, waitForPaint, isActive: () => screen.isConnected };
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof V.boot !== 'function' && screen.isConnected) fail();
  }, { once: true });
})();
