/* 浏览器端按需生成标准 STORE ZIP 离线包（零第三方依赖，仅在 HTTP(S) 下启用） */
(function (root) {
  const UTF8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  let crcTable = null;

  function isFileProtocol() {
    return typeof location !== 'undefined' && location.protocol === 'file:';
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function encodeUtf8(str) {
    if (UTF8) return UTF8.encode(String(str || ''));
    const raw = unescape(encodeURIComponent(String(str || '')));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function getCrcTable() {
    if (crcTable) return crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    crcTable = table;
    return table;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosTimeDate(now = new Date()) {
    const year = Math.max(1980, now.getFullYear()) - 1980;
    const date = (year << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    return { time, date };
  }

  function encodeLocalHeader(nameBytes, size, crc, dos) {
    const buf = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, dos.time, true);
    dv.setUint16(12, dos.date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    buf.set(nameBytes, 30);
    return buf;
  }

  function encodeCentralHeader(nameBytes, size, crc, dos, offset) {
    const buf = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, dos.time, true);
    dv.setUint16(14, dos.date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, offset, true);
    buf.set(nameBytes, 46);
    return buf;
  }

  function encodeEocd(count, centralSize, centralOffset) {
    const buf = new Uint8Array(22);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, count, true);
    dv.setUint16(10, count, true);
    dv.setUint32(12, centralSize, true);
    dv.setUint32(16, centralOffset, true);
    dv.setUint16(20, 0, true);
    return buf;
  }

  function buildStoreZipBlob(entries) {
    if (entries.length > 0xffff) throw new Error('Archive exceeds 65535 entries');
    const dos = dosTimeDate();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;

    for (const entry of entries) {
      const nameBytes = encodeUtf8(entry.name);
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
      const nextEnd = offset + 30 + nameBytes.length + data.length;
      if (nextEnd >= 0xffffffff) throw new Error('Archive exceeds standard 4 GB ZIP limit');
      const crc = crc32(data);
      const localHdr = encodeLocalHeader(nameBytes, data.length, crc, dos);
      const centralHdr = encodeCentralHeader(nameBytes, data.length, crc, dos, offset);
      localParts.push(localHdr, data);
      centralParts.push(centralHdr);
      offset = nextEnd;
      centralSize += centralHdr.length;
    }

    const eocd = encodeEocd(entries.length, centralSize, offset);
    return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
  }

  function abortErr() {
    return new DOMException('Offline pack download cancelled', 'AbortError');
  }

  function delayMs(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(abortErr()); return; }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        reject(abortErr());
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function probeManifest(manifestUrl, { signal } = {}) {
    if (isFileProtocol() || !manifestUrl) return null;
    try {
      const res = await fetch(new URL(manifestUrl, location.href).toString(), { signal, cache: 'no-cache' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && Array.isArray(data.files) ? data : null;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return null;
    }
  }

  async function fetchBinaryWithRetry(url, { signal, retries = 2 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw abortErr();
      try {
        const res = await fetch(url, { signal });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        lastError = new Error(`HTTP ${res.status} loading ${url}`);
        if (res.status < 500 && res.status !== 429) throw lastError;
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        lastError = err;
      }
      if (attempt < retries) await delayMs(180 * (attempt + 1), signal);
    }
    throw lastError || new Error(`Failed loading ${url}`);
  }

  function prefixEntryName(rootName, relPath) {
    const cleanRel = String(relPath || '').replace(/^\/+/, '');
    return rootName ? `${rootName}/${cleanRel}` : cleanRel;
  }

  function calcTotalBytes(files, manifestTotal) {
    const explicit = Number(manifestTotal);
    if (explicit > 0) return explicit;
    return files.reduce((sum, item) => sum + (Number(item?.size) || 0), 0);
  }

  function emitProgress(onProgress, phase, loadedFiles, totalFiles, loadedBytes, totalBytes) {
    if (typeof onProgress !== 'function') return;
    const percent = totalBytes > 0
      ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
      : (totalFiles > 0 ? Math.min(100, Math.round((loadedFiles / totalFiles) * 100)) : 100);
    onProgress({ phase, loadedFiles, totalFiles, loadedBytes, totalBytes, percent });
  }

  async function downloadAllEntries(manifest, baseUrl, opts) {
    const files = manifest.files;
    const results = new Array(files.length);
    const totalFiles = files.length;
    const totalBytes = calcTotalBytes(files, manifest.totalBytes);
    const concurrency = Math.max(1, Math.min(opts.concurrency || 6, Math.max(1, totalFiles)));
    let nextIdx = 0;
    let loadedFiles = 0;
    let loadedBytes = 0;

    async function worker() {
      while (nextIdx < totalFiles) {
        const idx = nextIdx++;
        const item = files[idx];
        const fileUrl = new URL(item.path, baseUrl).toString();
        const data = await fetchBinaryWithRetry(fileUrl, { signal: opts.signal, retries: opts.retries ?? 2 });
        results[idx] = { name: prefixEntryName(manifest.rootName, item.path), data };
        loadedFiles++;
        loadedBytes += data.length;
        emitProgress(opts.onProgress, 'downloading', loadedFiles, totalFiles, loadedBytes, totalBytes);
      }
    }

    emitProgress(opts.onProgress, 'downloading', 0, totalFiles, 0, totalBytes);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { entries: results, totalFiles, totalBytes: loadedBytes || totalBytes };
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function downloadOfflinePack(manifestUrl, opts = {}) {
    if (isFileProtocol()) throw new Error('Offline download is unavailable under file:// protocol');
    const manifest = await probeManifest(manifestUrl, { signal: opts.signal });
    if (!manifest) throw new Error('Offline manifest is unavailable or invalid');
    const baseUrl = new URL('./', new URL(manifestUrl, location.href));
    const { entries, totalFiles, totalBytes } = await downloadAllEntries(manifest, baseUrl, opts);
    emitProgress(opts.onProgress, 'packing', totalFiles, totalFiles, totalBytes, totalBytes);
    const blob = buildStoreZipBlob(entries);
    const filename = opts.filename || manifest.filename || 'offline-pack.zip';
    if (opts.triggerDownload !== false) triggerBlobDownload(blob, filename);
    emitProgress(opts.onProgress, 'done', totalFiles, totalFiles, totalBytes, totalBytes);
    return { blob, filename, totalFiles, totalBytes };
  }

  const api = {
    isFileProtocol,
    formatBytes,
    crc32,
    buildStoreZipBlob,
    probeManifest,
    downloadOfflinePack,
  };

  root.HtmlVideoOfflinePack = api;
  if (root.V && typeof root.V === 'object') root.V.offlinePack = api;
})(globalThis);
