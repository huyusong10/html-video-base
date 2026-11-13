// 统一静态资源、虚拟 /base/* 路由、206 Range 寻道与零依赖 SSE 热重载（/__hmr）服务模块
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEOS_DIR, RUNTIME_BASE_DIR, TEMPLATES_DIR, listVideoIds, loadVideoSandbox, getSandboxCfg } from './paths.mjs';

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
  const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeDecodePath(rawPath) {
  try { return decodeURIComponent(rawPath); } catch { return null; }
}

function pipeFileSafe(res, fp, opts) {
  const stream = fs.createReadStream(fp, opts);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function buildLiveManifestItem(projectRoot, id) {
  try {
    const { sandbox } = loadVideoSandbox(projectRoot, id, { ignoreBaked: false, requireTimings: false });
    const cfg = getSandboxCfg(sandbox.V);
    return {
      id,
      title: cfg.title || id,
      subtitle: cfg.subtitle || cfg.description || '',
      description: cfg.description || cfg.subtitle || '',
      duration: Math.round((sandbox.V.duration || 0) * 10) / 10,
      scenes: (sandbox.V.scenes || []).length,
      width: cfg.width || 1920,
      height: cfg.height || 1080,
      path: `./${id}/index.html`,
    };
  } catch {
    return { id, title: id, subtitle: '', description: '', duration: 0, scenes: 0, width: 1920, height: 1080, path: `./${id}/index.html` };
  }
}

function serveVirtualManifest(res, videosDir) {
  const projectRoot = path.dirname(path.resolve(videosDir));
  const items = listVideoIds(videosDir).map(id => buildLiveManifestItem(projectRoot, id));
  const body = `window.VIDEO_MANIFEST = ${JSON.stringify(items, null, 2)};\n`;
  res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
  res.end(body);
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
  const end = Math.min(m[2] ? parseInt(m[2], 10) : size - 1, size - 1);
  if (start >= size || start > end) return { unsat: true };
  return { start, end };
}

function serveRangeResponse(req, res, fp, size, contentType) {
  const parsed = parseByteRange(req.headers.range, size);
  if (!parsed) return false;
  if (parsed.unsat) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }).end();
    return true;
  }
  const { start, end } = parsed;
  res.writeHead(206, {
    'Content-Type': contentType,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else pipeFileSafe(res, fp, { start, end });
  return true;
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
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (u.pathname === '/__hmr') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(':\n\n');
      hmrClients.add(res);
      req.on('close', () => hmrClients.delete(res));
      return;
    }

    const decodedPath = safeDecodePath(u.pathname);
    if (!decodedPath) { res.writeHead(400).end('Bad Request'); return; }
    const fp = resolveVirtualFile(decodedPath, videosDir);
    if (!fp) {
      if (decodedPath === '/manifest.js') { serveVirtualManifest(res, videosDir); return; }
      res.writeHead(404).end('Not Found');
      return;
    }

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
    if (req.method === 'HEAD') res.end();
    else pipeFileSafe(res, fp);
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
