// 统一静态资源、虚拟 /base/* 路由、206 Range 寻道与零依赖 SSE 热重载（/__hmr）服务模块
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEOS_DIR, RUNTIME_BASE_DIR } from './paths.mjs';
import { PPTX_MIME, readPageWithPptxDownload } from './pptx-assets.mjs';
import { assetVersion, hashAsset, IMMUTABLE_ASSET_CACHE } from './versioned-assets.mjs';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pptx': PPTX_MIME,
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

function isInsideDir(filePath, dirPath) {
  const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeDecodePath(rawPath) {
  try { return decodeURIComponent(rawPath); } catch { return null; }
}

function parseRequestUrl(req) {
  try { return new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return null; }
}

function pipeFileSafe(res, fp, { status = 200, headers, range }) {
  const stream = fs.createReadStream(fp, range);
  let opened = false;
  stream.on('open', () => {
    opened = true;
    res.writeHead(status, headers);
  });
  stream.on('error', err => {
    if (opened || res.headersSent) { res.destroy(); return; }
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Length': 0 }).end();
  });
  stream.on('end', () => {
    if (stream.bytesRead !== Number(headers['Content-Length'])) res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function resolveVirtualFile(pathname, videosDir) {
  let rel = pathname;
  if (rel.endsWith('/')) rel += 'index.html';
  const normRel = path.normalize(rel).replace(/^[/\\]+/, '');

  const localPath = path.join(videosDir, normRel);
  if (isInsideDir(localPath, videosDir) && fs.existsSync(localPath)) {
    return localPath;
  }
  if (normRel === 'base' || normRel.startsWith('base' + path.sep)) {
    const sub = normRel.slice(4).replace(/^[/\\]+/, '');
    const pkgBasePath = path.join(RUNTIME_BASE_DIR, sub);
    if (isInsideDir(pkgBasePath, RUNTIME_BASE_DIR) && fs.existsSync(pkgBasePath)) return pkgBasePath;
  }
  return null;
}

function sendNotModified(req, res, headers) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const tag = headers.ETag.replace(/^W\//, '');
  const candidates = (req.headers['if-none-match'] || '').match(/(?:W\/)?"[^"]*"|\*/g) || [];
  if (!candidates.some(candidate => candidate === '*' || candidate.replace(/^W\//, '') === tag)) return false;
  res.writeHead(304, headers).end();
  return true;
}

function fileCacheHeaders(file, stat) {
  const version = assetVersion(file);
  if (version) return { ETag: `"${version}"`, 'Cache-Control': IMMUTABLE_ASSET_CACHE };
  return { ETag: `W/"${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}"`, 'Cache-Control': 'no-cache' };
}

function servePageWithPptxDownload(req, res, filePath) {
  if (path.basename(filePath) !== 'index.html') return false;
  let html;
  try { html = readPageWithPptxDownload(path.dirname(filePath)); }
  catch { return false; }
  if (html === null) return false;

  const cache = { ETag: `"${hashAsset(html)}"`, 'Cache-Control': 'no-cache' };
  if (sendNotModified(req, res, cache)) return true;
  res.writeHead(200, {
    'Content-Type': MIME['.html'],
    'Content-Length': Buffer.byteLength(html),
    ...cache,
  });
  res.end(req.method === 'HEAD' ? undefined : html);
  return true;
}

const MAX_OPEN_RANGE = 4 * 1024 * 1024;

function parseByteRange(rangeHeader, size) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
  if (!m) return null;
  if (!m[1] && !m[2]) return { unsat: true };
  if (!m[1]) {
    const suf = parseInt(m[2], 10);
    if (suf <= 0 || size <= 0) return { unsat: true };
    return { start: Math.max(0, size - suf), end: size - 1 };
  }
  const start = parseInt(m[1], 10);
  const rawEnd = m[2] ? parseInt(m[2], 10) : start + MAX_OPEN_RANGE - 1;
  const end = Math.min(rawEnd, size - 1);
  if (start >= size || start > end) return { unsat: true };
  return { start, end };
}

function serveRangeResponse(req, res, fp, size, headers) {
  const validator = req.headers['if-range'];
  if (validator && (headers.ETag.startsWith('W/') || validator !== headers.ETag)) return false;
  const parsed = parseByteRange(req.headers.range, size);
  if (!parsed) return false;
  if (parsed.unsat) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }).end();
    return true;
  }
  const { start, end } = parsed;
  const partial = {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': end - start + 1,
  };
  if (req.method === 'HEAD') res.writeHead(206, partial).end();
  else pipeFileSafe(res, fp, { status: 206, headers: partial, range: { start, end } });
  return true;
}

function serveStaticFile(req, res, file, stat) {
  const cache = fileCacheHeaders(file, stat);
  if (sendNotModified(req, res, cache)) return;
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    ...cache,
  };
  if (req.headers.range && serveRangeResponse(req, res, file, stat.size, headers)) return;
  if (req.method === 'HEAD' || stat.size === 0) res.writeHead(200, headers).end();
  else pipeFileSafe(res, file, { headers, range: { start: 0, end: stat.size - 1 } });
}

function attachHmrWatchers(dirs, clients) {
  const watchers = [];
  let debounceTimer = null;
  let needReload = false;

  const notify = filename => {
    if (!filename) return;
    const norm = String(filename).replace(/\\/g, '/');
    if (norm.includes('.runtime') || norm.endsWith('.tmp') || norm.includes('.tmp.')) return;
    if (!norm.endsWith('.css')) needReload = true;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const type = needReload ? 'reload' : 'css';
      needReload = false;
      const payload = `data: ${JSON.stringify({ type, file: norm })}\n\n`;
      for (const res of clients) {
        try { res.write(payload); } catch { clients.delete(res); }
      }
    }, 80);
  };

  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    try { watchers.push(fs.watch(d, { recursive: true }, (_ev, file) => notify(file))); } catch {}
  }
  return () => watchers.forEach(w => { try { w.close(); } catch {} });
}

export function createVideoHttpServer({ videosDir = VIDEOS_DIR, watch = false } = {}) {
  const hmrClients = new Set();
  const stopWatch = watch ? attachHmrWatchers([videosDir, RUNTIME_BASE_DIR], hmrClients) : () => {};

  const srv = http.createServer((req, res) => {
    const u = parseRequestUrl(req);
    if (!u) { res.writeHead(400).end('Bad Request'); return; }
    if (u.pathname === '/__hmr') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(':\n\n');
      hmrClients.add(res);
      const hb = setInterval(() => { try { res.write(':\n\n'); } catch { hmrClients.delete(res); } }, 20000);
      if (hb.unref) hb.unref();
      req.on('close', () => { clearInterval(hb); hmrClients.delete(res); });
      return;
    }

    const decodedPath = safeDecodePath(u.pathname);
    if (!decodedPath) { res.writeHead(400).end('Bad Request'); return; }
    const fp = resolveVirtualFile(decodedPath, videosDir);
    if (!fp) {
      res.writeHead(404).end('Not Found');
      return;
    }

    let stat;
    try { stat = fs.statSync(fp); } catch { res.writeHead(404).end('Not Found'); return; }
    if (stat.isDirectory()) { res.writeHead(302, { Location: u.pathname + '/' + u.search }).end(); return; }
    if (servePageWithPptxDownload(req, res, fp)) return;
    serveStaticFile(req, res, fp, stat);
  });

  const origClose = srv.close.bind(srv);
  srv.close = cb => {
    stopWatch();
    for (const c of hmrClients) { try { c.end(); } catch {} }
    hmrClients.clear();
    return origClose(cb);
  };
  return srv;
}

export function startEphemeralVideoServer(opts = {}) {
  const srv = createVideoHttpServer(opts);
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
