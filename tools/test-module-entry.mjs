import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = path.resolve(process.argv[2]);
fs.mkdirSync(workspace, { recursive: true });
const root = fs.mkdtempSync(path.join(workspace, 'project-'));
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, 'dist');
assert.equal(path.relative(root, dist), 'dist', 'All destructive bundle probes must stay in the private fixture');
fs.mkdirSync(path.join(root, 'videos/demo'), { recursive: true });
fs.writeFileSync(path.join(root, 'videos/demo/index.html'), '<h1>Demo</h1>');
fs.mkdirSync(dist);
const marker = path.join(dist, 'previous-build.txt');
fs.writeFileSync(marker, 'preserve previous output');

for (const [name, args] of [
  ['bundle.mjs', []], ['cli.mjs', ['init', 'unrequested']],
  ['render.mjs', []], ['audit-visual.mjs', []], ['verify-sync.mjs', []],
]) {
  const main = path.join(root, name);
  fs.writeFileSync(main, `import ${JSON.stringify(pathToFileURL(path.join(toolsDir, name)).href)};console.log(${JSON.stringify('import complete: ' + name)});`);
  const result = spawnSync(process.execPath, [main, ...args], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, VIDEO_PROJECT_ROOT: root },
  });
  assert.equal(result.status, 0, `Library import must not run the ${name} CLI:\n${result.stderr}`);
  assert.ok(fs.existsSync(marker), 'Importing the bundler must preserve existing output');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve previous output');
  assert.equal(fs.existsSync(path.join(root, 'videos/unrequested')), false, 'Importing the CLI must not process its caller arguments');
  assert.equal(result.stdout.trim(), 'import complete: ' + name, 'A library import must not produce CLI output');
}

const directOut = path.resolve(root, 'direct-dist');
assert.equal(path.relative(root, directOut), 'direct-dist');
const direct = spawnSync(process.execPath, [path.join(toolsDir, 'bundle.mjs'), 'demo', '--single', '--out', directOut], {
  cwd: root, encoding: 'utf8', env: { ...process.env, VIDEO_PROJECT_ROOT: root },
});
assert.equal(direct.status, 0, direct.stderr);
assert.ok(fs.existsSync(path.join(directOut, 'index.html')), 'Direct tool execution must still invoke its CLI');
console.log('Same-name library imports preserve output and caller arguments; direct CLI execution PASSED.');
