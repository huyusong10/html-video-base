// 统一静态资源、虚拟 /base/* 路由、206 Range 寻道与零依赖 SSE 热重载（/__hmr）服务模块
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEOS_DIR, RUNTIME_BASE_DIR, TEMPLATES_DIR } from './paths.mjs';

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
  const rel = path.relative(dirPath, filePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
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
  if (normRel === 'index.html') {
    const hubFallback = path.join(TEMPLATES_DIR, 'hub/index.html');
    if (fs.existsSync(hubFallback)) return hubFallback;
  }
  return null;
}

function serveRangeResponse(req, res, fp, size, contentType) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) return false;
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (start >= size || end >= size || start > end) return false;
  res.writeHead(206, {
    'Content-Type': contentType,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(fp, { start, end }).pipe(res);
  return true;
}

function attachHmrWatchers(dirs, clients) {
  const watchers = [];
  let debounceTimer = null;

  const notify = filename => {
    if (!filename) return;
    const norm = String(filename).replace(/\\/g, '/');
    if (norm.includes('.runtime') || norm.endsWith('.tmp')) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const type = norm.endsWith('.css') ? 'css' : 'reload';
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
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (u.pathname === '/__hmr') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(':\n\n');
      hmrClients.add(res);
      req.on('close', () => hmrClients.delete(res));
      return;
    }

    const fp = resolveVirtualFile(decodeURIComponent(u.pathname), videosDir);
    if (!fp) { res.writeHead(404).end('Not Found'); return; }

    const stat = fs.statSync(fp);
    if (stat.isDirectory()) { res.writeHead(302, { Location: u.pathname + '/' + u.search }).end(); return; }

    const contentType = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
    if (req.headers.range && serveRangeResponse(req, res, fp, stat.size, contentType)) return;

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(fp).pipe(res);
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
