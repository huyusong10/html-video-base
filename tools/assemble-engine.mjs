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

fs.writeFileSync(OUT_ENGINE, parts.join('\n\n'), 'utf8');
fs.writeFileSync(
  OUT_ESM,
  `import './engine.js';\nexport const V = globalThis.V;\nexport default globalThis.V;\n`,
  'utf8'
);
console.log(`Assembled ${coreFiles.length} microkernel modules -> runtime/base/js/engine.js`);
