// 将 runtime/base/js/core/*.js 按顺序组装为单文件同步入口 runtime/base/js/engine.js（零外部构建依赖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = path.join(PKG_ROOT, 'runtime/base/js/core');
const OUT_ENGINE = path.join(PKG_ROOT, 'runtime/base/js/engine.js');
const OUT_ESM = path.join(PKG_ROOT, 'runtime/base/js/index.mjs');

const coreFiles = fs.readdirSync(CORE_DIR).filter(f => f.endsWith('.js')).sort();
const parts = [
  '/* HTML Video Base v2.0 · Microkernel Runtime (Auto-assembled from runtime/base/js/core/*.js) */',
  ...coreFiles.map(f => fs.readFileSync(path.join(CORE_DIR, f), 'utf8').trim()),
  '',
];
const assembled = parts.join('\n\n');

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT_ENGINE)
    ? fs.readFileSync(OUT_ENGINE, 'utf8').replace(/\r\n/g, '\n')
    : '';
  if (existing !== assembled.replace(/\r\n/g, '\n')) {
    console.error('❌ runtime/base/js/engine.js is out of sync with core/*.js. Run: npm run assemble');
    process.exit(1);
  }
  console.log('✅ Engine assembly check PASSED.');
  process.exit(0);
}

fs.writeFileSync(OUT_ENGINE, assembled, 'utf8');
fs.writeFileSync(
  OUT_ESM,
  `import './engine.js';\nexport const V = globalThis.V;\nexport default globalThis.V;\n`,
  'utf8'
);
console.log(`Assembled ${coreFiles.length} microkernel modules -> runtime/base/js/engine.js`);
