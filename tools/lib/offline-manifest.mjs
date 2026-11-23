// 构建期离线包清单生成与防呆提示注入（零第三方依赖）
import fs from 'node:fs';
import path from 'node:path';

export const OFFLINE_MANIFEST_FILE = 'offline-manifest.json';
export const OFFLINE_MANIFEST_MIME = 'application/vnd.html-video.offline-manifest+json';

const DEFAULT_EXCLUDE_NAMES = new Set([
  OFFLINE_MANIFEST_FILE,
  '_headers',
  '_redirects',
  '.DS_Store',
  'Thumbs.db',
]);

const DEFAULT_UNZIP_MESSAGE =
  '检测到离线资源未能加载。如果您在压缩包内直接双击打开，请先将整个压缩包完整解压到本地文件夹，再双击 index.html 观看。';

function toPosix(rel) {
  return rel.replaceAll('\\', '/');
}

function matchesRule(rel, rule) {
  if (typeof rule === 'function') return Boolean(rule(rel));
  if (rule instanceof RegExp) return rule.test(rel);
  const clean = toPosix(String(rule || '')).replace(/^\/+|\/+$/g, '');
  if (!clean) return false;
  return rel === clean || rel.startsWith(`${clean}/`);
}

function isExcludedEntry(rel, name, rules) {
  if (name.startsWith('.') || DEFAULT_EXCLUDE_NAMES.has(name) || rel.endsWith('.zip')) {
    return true;
  }
  return rules.some(rule => matchesRule(rel, rule));
}

function normalizeExcludeRules(exclude) {
  if (!exclude) return [];
  return Array.isArray(exclude) ? exclude : [exclude];
}

function walkOfflineDir(dir, prefix, rules, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkOfflineDir(full, rel, rules, out);
    } else if (entry.isFile() && !isExcludedEntry(rel, entry.name, rules)) {
      out.push({ path: rel, size: fs.statSync(full).size });
    }
  }
}

export function collectOfflineEntries(dir, { exclude } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  walkOfflineDir(dir, '', normalizeExcludeRules(exclude), out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function sanitizeRootName(rootName, dir) {
  const raw = String(rootName || path.basename(dir) || 'offline-pack').trim();
  const safe = raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'offline-pack';
}

export function writeOfflineManifest(dir, opts = {}) {
  const files = collectOfflineEntries(dir, { exclude: opts.exclude });
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  const rootName = sanitizeRootName(opts.rootName, dir);
  const filename = opts.filename ? path.basename(String(opts.filename)) : `${rootName}.zip`;
  const file = opts.file || OFFLINE_MANIFEST_FILE;
  const manifestPath = path.join(dir, file);
  const payload = {
    version: 1,
    rootName,
    filename,
    label: String(opts.label || ''),
    totalBytes,
    fileCount: files.length,
    files,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { file, manifestPath, rootName, filename, totalBytes, fileCount: files.length };
}

export function injectOfflineManifestLink(htmlPath, manifestHref = './offline-manifest.json') {
  if (!fs.existsSync(htmlPath)) return false;
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (html.includes('data-offline-pack') || !/<\/head\s*>/i.test(html)) return false;
  const tag = `  <link rel="alternate" type="${OFFLINE_MANIFEST_MIME}" data-offline-pack href="${manifestHref}">\n`;
  fs.writeFileSync(htmlPath, html.replace(/<\/head\s*>/i, tag + '$&'), 'utf8');
  return true;
}

export function injectOfflineUnzipGuard(htmlPath, { checkGlobal = 'V', message = DEFAULT_UNZIP_MESSAGE } = {}) {
  if (!fs.existsSync(htmlPath)) return false;
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (html.includes('data-offline-unzip-guard') || !/<\/body\s*>/i.test(html)) return false;
  const safeGlobal = JSON.stringify(String(checkGlobal || 'V'));
  const safeMsg = JSON.stringify(String(message || DEFAULT_UNZIP_MESSAGE));
  const script =
    `<script data-offline-unzip-guard>` +
    `(function(){function warn(){if(location.protocol!=='file:'||window[${safeGlobal}])return;` +
    `var box=document.createElement('div');box.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,0.9);color:#fff;font:600 18px/1.6 system-ui,sans-serif;text-align:center;';` +
    `box.textContent=${safeMsg};document.body.appendChild(box);}` +
    `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',warn,{once:true});else warn();})();` +
    `</script>\n`;
  fs.writeFileSync(htmlPath, html.replace(/<\/body\s*>/i, script + '$&'), 'utf8');
  return true;
}
