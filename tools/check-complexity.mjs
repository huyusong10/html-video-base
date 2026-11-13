// 全仓圈复杂度（Cyclomatic Complexity）硬门禁校验器（限制：所有 JS/MJS 与 Python 函数 CC < 15）
// 用法：node tools/check-complexity.mjs [--max 14]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CC = parseMaxArg(process.argv.slice(2), 14);
const SKIP_DIRS = new Set(['node_modules', '.git', '.runtime', 'vendor', '__pycache__', 'dist']);
const NON_METHOD_KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
const METHOD_PREV = new Set(['{', ',', ';', '}', 'async', 'get', 'set', 'static']);
const BRANCH_KW = new Set(['if', 'for', 'while', 'do', 'case', 'catch']);
const BRANCH_OPS = new Set(['&&', '||', '??', '?.', '&&=', '||=', '??=']);
const REGEX_PREV = new Set([
  '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '~', '^', '<', '>',
  '&&', '||', '??', '&&=', '||=', '??=', '=>', '===', '!==', '==', '!=', '<=', '>=',
  'return', 'typeof', 'void', 'case', 'in', 'of', 'await', 'yield', 'throw', 'delete', 'else',
]);
const MULTI_OPS = ['===', '!==', '&&=', '||=', '??=', '=>', '?.', '??', '&&', '||', '<=', '>=', '==', '!=', '++', '--'];

function parseMaxArg(args, fallback) {
  const idx = args.indexOf('--max');
  if (idx < 0) return fallback;
  return Number(args[idx + 1]) || fallback;
}

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(m?js|py)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function skipQuoted(src, i, quote) {
  let pos = i + 1;
  while (pos < src.length) {
    if (src[pos] === '\\') { pos += 2; continue; }
    if (src[pos] === quote) return pos + 1;
    pos++;
  }
  return pos;
}

function skipRegexFlags(src, pos) {
  let end = pos;
  while (end < src.length && /[a-z]/i.test(src[end])) end++;
  return end;
}

function skipRegex(src, i) {
  let pos = i + 1;
  let inClass = false;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === '\\') { pos += 2; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return skipRegexFlags(src, pos + 1);
    pos++;
  }
  return pos;
}

function canStartRegex(prevTok) {
  return !prevTok || REGEX_PREV.has(prevTok.val);
}

function readOperator(src, i) {
  for (const op of MULTI_OPS) {
    if (src.startsWith(op, i)) return { type: 'op', val: op, end: i + op.length };
  }
  return { type: 'punc', val: src[i], end: i + 1 };
}

function buildLineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function getLine(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function skipComment(src, i) {
  if (src[i + 1] === '/') {
    const nl = src.indexOf('\n', i + 2);
    return nl < 0 ? src.length : nl + 1;
  }
  const end = src.indexOf('*/', i + 2);
  return end < 0 ? src.length : end + 2;
}

function readWordOrNum(src, i, line) {
  let end = i + 1;
  while (end < src.length && /[\w$]/.test(src[end])) end++;
  return { type: 'id', val: src.slice(i, end), line, end };
}

function tokenizeTemplate(src, startIdx, tokens, lineStarts) {
  let i = startIdx + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '`') return i + 1;
    if (src[i] === '$' && src[i + 1] === '{') {
      tokens.push({ type: 'punc', val: '(', line: getLine(lineStarts, i) });
      i = tokenizeJsRange(src, i + 2, tokens, lineStarts, true);
      tokens.push({ type: 'punc', val: ')', line: getLine(lineStarts, i) });
      continue;
    }
    i++;
  }
  return i;
}

function isCommentStart(src, i) {
  return src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*');
}

function readNextToken(src, i, tokens, lineStarts) {
  const ch = src[i];
  const line = getLine(lineStarts, i);
  if (ch === '\'' || ch === '"') {
    tokens.push({ type: 'str', val: '""', line });
    return skipQuoted(src, i, ch);
  }
  if (ch === '`') {
    tokens.push({ type: 'str', val: '``', line });
    return tokenizeTemplate(src, i, tokens, lineStarts);
  }
  if (ch === '/' && canStartRegex(tokens[tokens.length - 1])) {
    tokens.push({ type: 'regex', val: '//', line });
    return skipRegex(src, i);
  }
  if (/[\w$]/.test(ch)) {
    const tok = readWordOrNum(src, i, line);
    tokens.push({ type: tok.type, val: tok.val, line });
    return tok.end;
  }
  const op = readOperator(src, i);
  tokens.push({ type: op.type, val: op.val, line });
  return op.end;
}

function tokenizeJsRange(src, startIdx, tokens, lineStarts, stopAtBrace = false) {
  let i = startIdx;
  let braceDepth = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (isCommentStart(src, i)) { i = skipComment(src, i); continue; }
    if (stopAtBrace && src[i] === '}') {
      if (braceDepth === 0) return i + 1;
      braceDepth--;
    } else if (stopAtBrace && src[i] === '{') {
      braceDepth++;
    }
    i = readNextToken(src, i, tokens, lineStarts);
  }
  return i;
}

function findMatchingParen(tokens, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].val === '(') depth++;
    else if (tokens[i].val === ')' && --depth === 0) return i;
  }
  return -1;
}

function tokVal(tokens, idx) {
  return idx >= 0 && idx < tokens.length ? tokens[idx].val : '';
}

function tokType(tokens, idx) {
  return idx >= 0 && idx < tokens.length ? tokens[idx].type : '';
}

function parseFuncKeyword(tokens, i) {
  let cur = i + 1 + (tokVal(tokens, i + 1) === '*' ? 1 : 0);
  const name = tokType(tokens, cur) === 'id' ? tokens[cur++].val : '<anonymous>';
  if (tokVal(tokens, cur) !== '(') return null;
  const closeIdx = findMatchingParen(tokens, cur);
  if (closeIdx < 0 || tokVal(tokens, closeIdx + 1) !== '{') return null;
  return { name, line: tokens[i].line, bodyStart: closeIdx + 1, kind: 'block' };
}

function parseArrowFunc(tokens, i) {
  const name = tokType(tokens, i - 1) === 'id' ? `arrow(${tokens[i - 1].val})` : '<arrow>';
  const kind = tokVal(tokens, i + 1) === '{' ? 'block' : 'expr';
  return { name, line: tokens[i].line, bodyStart: i + 1, kind };
}

function parseMethodFunc(tokens, i) {
  const t = tokens[i];
  if (NON_METHOD_KW.has(t.val) || tokVal(tokens, i + 1) !== '(') return null;
  if (!METHOD_PREV.has(tokVal(tokens, i - 1))) return null;
  const closeIdx = findMatchingParen(tokens, i + 1);
  if (closeIdx < 0 || tokVal(tokens, closeIdx + 1) !== '{') return null;
  return { name: t.val, line: t.line, bodyStart: closeIdx + 1, kind: 'block' };
}

function detectFunctionAt(tokens, i) {
  const t = tokens[i];
  if (t.val === 'function') return parseFuncKeyword(tokens, i);
  if (t.val === '=>') return parseArrowFunc(tokens, i);
  if (t.type === 'id') return parseMethodFunc(tokens, i);
  return null;
}

function isDecisionToken(tok, nextVal) {
  if (BRANCH_KW.has(tok.val) || BRANCH_OPS.has(tok.val)) return true;
  return tok.val === '?' && nextVal !== '.' && nextVal !== '?';
}

function shouldEndExprArrow(tok, d) {
  if (d.paren < 0 || d.bracket < 0 || d.brace < 0) return true;
  if (d.paren !== 0 || d.bracket !== 0 || d.brace !== 0) return false;
  return tok.val === ',' || tok.val === ';';
}

const DEPTH_DELTAS = {
  '{': ['brace', 1],
  '}': ['brace', -1],
  '(': ['paren', 1],
  ')': ['paren', -1],
  '[': ['bracket', 1],
  ']': ['bracket', -1],
};

function applyBracketDelta(top, val) {
  const delta = DEPTH_DELTAS[val];
  if (!delta) return false;
  top[delta[0]] += delta[1];
  return val === '}' && top.kind === 'block' && top.brace === 0;
}

function collectPendingFunctions(tokens) {
  const map = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const fn = detectFunctionAt(tokens, i);
    if (fn && !map.has(fn.bodyStart)) map.set(fn.bodyStart, fn);
  }
  return map;
}

function analyzeJsFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const tokens = [];
  tokenizeJsRange(src, 0, tokens, buildLineStarts(src), false);

  const results = [];
  const stack = [{ name: '<module>', line: 1, cc: 1, kind: 'root', brace: 0, paren: 0, bracket: 0 }];
  const pendingStarts = collectPendingFunctions(tokens);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const fnStart = pendingStarts.get(i);
    if (fnStart) {
      const initBrace = fnStart.kind === 'block' ? 1 : 0;
      stack.push({ name: fnStart.name, line: fnStart.line, cc: 1, kind: fnStart.kind, brace: initBrace, paren: 0, bracket: 0 });
      if (initBrace) continue;
    }

    while (stack[stack.length - 1].kind === 'expr' && shouldEndExprArrow(tok, stack[stack.length - 1])) {
      results.push(stack.pop());
    }

    if (applyBracketDelta(stack[stack.length - 1], tok.val)) {
      results.push(stack.pop());
      continue;
    }

    if (isDecisionToken(tok, tokVal(tokens, i + 1))) {
      stack[stack.length - 1].cc++;
    }
  }

  while (stack.length > 1) results.push(stack.pop());
  return results.map(r => ({ file: filePath, name: r.name, line: r.line, cc: r.cc }));
}

const PY_AST_SCRIPT = `
import ast, json, sys

BRANCH_TYPES = (ast.If, ast.IfExp, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler)

def node_branch_cost(node):
    if isinstance(node, BRANCH_TYPES):
        return 1
    if hasattr(ast, 'MatchCase') and isinstance(node, ast.MatchCase):
        return 1
    if isinstance(node, ast.BoolOp):
        return len(node.values) - 1
    if isinstance(node, ast.comprehension):
        return 1 + len(node.ifs)
    return 0

def count_scope_cc(root):
    cc = 1
    stack = list(ast.iter_child_nodes(root))
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        cc += node_branch_cost(node)
        stack.extend(ast.iter_child_nodes(node))
    return cc

out = []
for fp in sys.argv[1:]:
    with open(fp, encoding='utf-8') as f:
        tree = ast.parse(f.read(), filename=fp)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append({'file': fp, 'name': node.name, 'line': node.lineno, 'cc': count_scope_cc(node)})
print(json.dumps(out))
`;

function findPythonBin() {
  for (const bin of [process.env.PYTHON_BIN, 'python', 'python3'].filter(Boolean)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return bin;
  }
  return null;
}

function analyzePyFiles(pyFiles) {
  if (!pyFiles.length) return [];
  const py = findPythonBin();
  if (!py) throw new Error('Python interpreter required to check .py cyclomatic complexity.');
  const r = spawnSync(py, ['-c', PY_AST_SCRIPT, ...pyFiles], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Python AST check failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const allFiles = collectSourceFiles(PKG_ROOT);
const jsFiles = allFiles.filter(f => /\.(m?js)$/.test(f));
const pyFiles = allFiles.filter(f => f.endsWith('.py'));

const records = [
  ...jsFiles.flatMap(analyzeJsFile),
  ...analyzePyFiles(pyFiles),
];

const violations = records.filter(r => r.cc > MAX_CC).sort((a, b) => b.cc - a.cc);
const peak = records.reduce((m, r) => (r.cc > m ? r.cc : m), 0);

if (violations.length > 0) {
  console.error(`❌ Cyclomatic complexity check FAILED (${violations.length} function(s) > ${MAX_CC}):`);
  for (const v of violations) {
    console.error(`  [CC=${v.cc}] ${path.relative(PKG_ROOT, v.file)}:${v.line} -> ${v.name}`);
  }
  process.exit(1);
}

console.log(`✅ Cyclomatic complexity check PASSED: ${records.length} functions across ${allFiles.length} files (peak CC=${peak} <= ${MAX_CC} < 15).`);
