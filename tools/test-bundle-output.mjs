import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL('../.runtime/', import.meta.url));
fs.mkdirSync(runtime, { recursive: true });
const root = fs.mkdtempSync(path.join(runtime, 'bundle-output-'));
process.env.VIDEO_PROJECT_ROOT = root;
const { bundleSingleVideo, bundleStaticSite } = await import('./bundle.mjs');
const { startEphemeralVideoServer } = await import('./lib/http-static.mjs');
const course = path.join(root, 'videos/demo');
const assets = path.join(course, 'assets/models');
const shared = path.join(root, 'videos/assets/models');
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(shared, { recursive: true });
const entry = path.join(course, 'index.html');
const entryHtml = '<meta name="video-versioned-asset" content="assets/models/versioned.html"><iframe src="assets/models/plain.html"></iframe>';
const modelHtml = '<script src="../../../base/js/frame-client.js"></script><link rel="stylesheet" href="model.css">';
const sharedHtml = '<script src="../../../base/js/engine.js"></script>';
fs.writeFileSync(entry, entryHtml);
fs.writeFileSync(path.join(assets, 'plain.html'), modelHtml);
fs.writeFileSync(path.join(assets, 'versioned.html'), modelHtml);
fs.writeFileSync(path.join(assets, 'model.css'), '.probe{background-image:url(../../../assets/logo.svg)}');
fs.writeFileSync(path.join(assets, 'model.mjs'), 'import "../../../base/js/index.mjs"; import "../assets/local.mjs";');
fs.writeFileSync(path.join(shared, 'shared.html'), sharedHtml);

const web = path.join(root, 'published');
const single = path.join(web, 'embed/demo');
const site = path.join(web, 'site');

function checkFailedBuild(build, out, entryFile) {
  const previous = fs.readFileSync(entryFile);
  const sidecar = path.join(out, 'old-sidecar.txt');
  fs.writeFileSync(sidecar, 'last known good release');
  const copy = fs.cpSync;
  try {
    fs.cpSync = (source, ...args) => {
      if (source === course) {
        assert.deepEqual(fs.readFileSync(entryFile), previous, 'The old release stays available during the build');
        throw new Error('Injected copy failure: ENOSPC');
      }
      return copy(source, ...args);
    };
    assert.throws(build, /ENOSPC/);
  } finally { fs.cpSync = copy; }
  assert.deepEqual(fs.readFileSync(entryFile), previous);
  assert.equal(fs.readFileSync(sidecar, 'utf8'), 'last known good release');

  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, destination) => {
      if (path.basename(source) === 'next' && destination === out) throw new Error('Injected swap failure');
      return rename(source, destination);
    };
    assert.throws(build, /Injected swap failure/);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(entryFile), previous, 'A failed final rename must restore the previous release');
  assert.equal(fs.readFileSync(sidecar, 'utf8'), 'last known good release');
  assert.deepEqual(fs.readdirSync(path.dirname(out)).filter(name => name.startsWith('.html-video-bundle-')), []);
}

const buildSingle = () => bundleSingleVideo('demo', single, root);
const buildSite = () => bundleStaticSite(['demo'], site);
buildSingle();
buildSite();
checkFailedBuild(buildSingle, single, path.join(single, 'index.html'));
checkFailedBuild(buildSite, site, path.join(site, 'demo/index.html'));
buildSingle();
buildSite();
assert.equal(fs.existsSync(path.join(single, 'old-sidecar.txt')), false);
assert.equal(fs.existsSync(path.join(site, 'old-sidecar.txt')), false);

const outputAssets = path.join(single, 'assets/models');
assert.equal(fs.readFileSync(path.join(outputAssets, 'shared.html'), 'utf8'), sharedHtml);
assert.equal(fs.readFileSync(path.join(assets, 'plain.html'), 'utf8'), modelHtml);
assert.match(fs.readFileSync(path.join(outputAssets, 'model.css'), 'utf8'), /url\(\.\.\/\.\.\/assets\/logo\.svg\)/);
assert.equal(fs.readFileSync(path.join(outputAssets, 'model.mjs'), 'utf8'),
  'import "../../base/js/index.mjs"; import "../assets/local.mjs";');

const { srv, port } = await startEphemeralVideoServer({ videosDir: web });
try {
  const prefix = new URL('http://127.0.0.1:' + port + '/embed/demo/');
  const index = await (await fetch(prefix)).text();
  const versioned = index.match(/content="(assets\/models\/versioned\.sha256-[a-f0-9]+\.html)"/)?.[1];
  assert.ok(versioned);
  for (const rel of ['assets/models/plain.html', 'assets/models/versioned.html', versioned]) {
    const iframe = new URL(rel, prefix);
    const body = await (await fetch(iframe)).text();
    const script = new URL(body.match(/<script src="([^"]+)"/)[1], iframe);
    assert.equal(script.pathname, '/embed/demo/base/js/frame-client.js');
    assert.equal((await fetch(script)).status, 200);
  }
} finally {
  srv.closeAllConnections();
  await new Promise(resolve => srv.close(resolve));
}
console.log('Nested single-course iframe paths, failed copy, and failed final swap passed for release bundles.');
