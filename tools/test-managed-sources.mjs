import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PKG_ROOT } from './lib/paths.mjs';
import { withAuditSession } from './audit-session.mjs';

const core = ['01-registry.js', '12c-frame.js', '12d-sources.js'].map(name =>
  fs.readFileSync(path.join(PKG_ROOT, 'runtime/base/js/core', name), 'utf8')).join('\n');
const environment = { mode: 'record', isRecord: true, pptMode: false };
const dormant = { V: { environment }, console };
vm.runInNewContext(core, dormant);
const idle = dormant.V.managedSource({ id: 'metadata-only', element() { throw new Error('DOM must remain lazy'); }, prepare() {} });
assert.equal(idle.status, 'idle', 'Metadata registration must not require browser globals');

const replies = [], signals = [];
let receiver, releases = 0;
const parent = { postMessage: message => replies.push(message) };
const clientContext = { parent, AbortController, DOMException, console,
  addEventListener(type, callback) { receiver = callback; }, removeEventListener() {} };
vm.runInNewContext(fs.readFileSync(path.join(PKG_ROOT, 'runtime/base/js/frame-client.js'), 'utf8'), clientContext);
const client = clientContext.VFrameClient.connect({ origin: 'https://parent.test',
  initialize: ({ signal }) => { signals.push(signal); }, prepare() {}, dispose() { releases++; } });
const hello = session => receiver({ source: parent, origin: 'https://parent.test',
  data: { protocol: 'html-video-source-v1', sourceId: 'model', type: 'hello', session } });
hello('old'); hello('new');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(signals.length, 1, 'A superseded initialization must not borrow the next session signal');
assert.equal(signals[0].aborted, false);
assert.equal(replies.filter(message => message.type === 'ready').length, 1);
assert.equal(replies.find(message => message.type === 'ready').session, 'new');
const disposeMessage = { source: parent, origin: 'https://parent.test', data: {
  protocol: 'html-video-source-v1', sourceId: 'model', type: 'dispose', session: 'new' } };
receiver(disposeMessage); receiver(disposeMessage);
await client.dispose();
assert.equal(releases, 2, 'Each session must release resources once, including parent disposal');

const cleanupErrors = [];
clientContext.console = { error: error => cleanupErrors.push(error.message) };
let restartAttempts = 0, cleanupAttempts = 0;
const retryClient = clientContext.VFrameClient.connect({ origin: 'https://parent.test',
  initialize() { restartAttempts++; }, prepare() {},
  dispose() { if (++cleanupAttempts === 1) throw new Error('Transient cleanup failure'); },
});
for (const session of ['cleanup-first', 'cleanup-failed', 'cleanup-retry']) {
  hello(session);
  await new Promise(resolve => setTimeout(resolve, 0));
}
assert.equal(replies.find(message => message.session === 'cleanup-failed').type, 'error', 'A failed cleanup must reject that initialization');
assert.equal(replies.find(message => message.session === 'cleanup-retry').type, 'ready', 'A later connection must retry cleanup and initialize');
assert.equal(cleanupAttempts, 2);
assert.equal(restartAttempts, 2);
assert.deepEqual(cleanupErrors, ['Transient cleanup failure']);
await retryClient.dispose();

const messages = [];
const context = { V: { environment, getSceneEnergy: () => 0 }, AbortController, DOMException,
  performance, setTimeout, clearTimeout, console: { error: error => messages.push(error.message) } };
vm.runInNewContext(core, context);
const V = context.V;
assert.throws(() => V._frameRuntime.signal(null), error => error.name === 'AbortError', 'A missing frame must not return an uninitialized signal');
const scene = { start: 0 };
function render(index, time) {
  const frame = V._frameRuntime.begin(scene, index, time, time, 0, { isRecord: true, playing: false });
  V.emit('onRender', { frame });
  return { frame, prepared: V._frameRuntime.prepare(frame) };
}
const delay = time => new Promise(resolve => setTimeout(resolve, time));
const host = { isConnected: true, style: { visibility: '' } };
let initialized = 0, prepared = 0, disposed = 0;
const visibilityChanges = [];
const source = V.managedSource({ id: 'native', element: () => host, active: frame => frame.sceneIndex === 0,
  timeoutMs: 10, readyTimeoutMs: 200,
  async initialize({ signal }) { initialized++; await delay(40); assert.equal(signal.aborted, false); return 'model'; },
  prepare(state, frame, { data }) { prepared++; assert.equal(data, 'model'); assert.equal(state.value, 2); },
  dispose() { disposed++; },
  onVisibilityChange(visible) { visibilityChanges.push(visible); },
});
source.setState({ value: 1 });
const firstRender = render(0, 0.1);
const firstSignal = V._frameRuntime.signal(firstRender.frame);
assert.equal(firstSignal.aborted, false);
const first = firstRender.prepared.catch(error => error.name);
await delay(2);
source.setState({ value: 2 });
const last = render(0, 0.2);
assert.equal(firstSignal.aborted, true, 'Beginning a new frame must cancel the previous frame signal');
assert.throws(() => V._frameRuntime.signal(firstRender.frame), error => error.name === 'AbortError', 'Expired frames must not borrow the current frame signal');
await last.prepared;
await V._frameRuntime.prepare(last.frame);
assert.equal(await first, 'AbortError');
assert.equal(initialized, 1, 'New frames must share initialization');
assert.equal(prepared, 1, 'A frame must apply the submitted state once');
await render(1, 0.3).prepared;
assert.equal(host.style.visibility, 'hidden', 'Inactive scene ownership must hide the host');
source.setState(null);
await render(0, 0.4).prepared;
assert.equal(host.style.visibility, 'hidden');
assert.deepEqual(visibilityChanges, [true, false], 'Visibility callbacks must only run when scene ownership changes');
source.dispose(); source.dispose();
assert.equal(disposed, 1);

let failInitialization = true, attempts = 0;
const retry = V.managedSource({ id: 'retry', element: () => host, readyTimeoutMs: 15,
  initialize() { attempts++; return failInitialization ? new Promise(() => {}) : Promise.resolve(); },
  prepare() {},
});
retry.setState({ value: 1 });
for (let i = 0; i < 6; i++) { render(0, i).prepared.catch(() => {}); await delay(4); }
assert.equal(retry.status, 'failed', 'Initialization timeout must survive continuous new frames');
assert.equal(attempts, 1);
assert.equal(messages.filter(message => message.includes('retry')).length, 1, 'Shared initialization errors must be reported once');
failInitialization = false;
await retry.retry();
await render(0, 7).prepared;
assert.equal(attempts, 2);
retry.dispose();
let finishLoadingPaint;
const loadingPaint = new Promise(resolve => { finishLoadingPaint = resolve; });
V._loading = { waitForPaint: () => loadingPaint };
const afterPaint = V.managedSource({ id: 'after-loading-paint', element: () => host, readyTimeoutMs: 10,
  initialize: () => 'ready', prepare() {} });
const paintedReady = afterPaint.ready();
await delay(25);
assert.equal(afterPaint.status, 'loading', 'Waiting for UI paint must not consume the initialization timeout');
finishLoadingPaint();
assert.equal(await paintedReady, 'ready');
await afterPaint.dispose();
delete V._loading;
let timedOutAttempts = 0, finishTimedOut;
const slow = V.managedSource({ id: 'slow', element: () => host, timeoutMs: 20,
  initialize() { timedOutAttempts++; },
  prepare() { if (timedOutAttempts === 1) return new Promise(resolve => { finishTimedOut = resolve; }); },
});
slow.setState({});
await assert.rejects(render(0, 8).prepared, /slow.*Preparation timed out after 20ms/);
finishTimedOut();
await delay(0);
assert.equal(slow.status, 'failed', 'Late completion must not clear the timeout');
assert.equal(V._frameRuntime.readiness().failed, true, 'A current timeout must expose a retryable failure');
await V._frameRuntime.retryActive();
await render(0, 9).prepared;
assert.equal(timedOutAttempts, 2);
assert.equal(slow.status, 'ready');
await slow.dispose();

let rejectOldFrame, markPrepareStarted;
const prepareStarted = new Promise(resolve => { markPrepareStarted = resolve; });
const superseded = V.managedSource({ id: 'superseded', element: () => host,
  prepare(state) {
    if (!state.outdated) return;
    markPrepareStarted();
    return new Promise((_, reject) => { rejectOldFrame = reject; });
  },
});
superseded.setState({ outdated: true });
const cancelledFrame = assert.rejects(render(0, 10).prepared, error => error.name === 'AbortError');
await prepareStarted;
superseded.setState({ outdated: false });
await render(0, 11).prepared;
await cancelledFrame;
rejectOldFrame(new Error('late failure'));
await delay(0);
assert.equal(superseded.status, 'ready', 'A superseded frame failure must not affect a newer frame');
await superseded.dispose();
const throwingDispose = V.managedSource({ id: 'throwing-dispose', element: () => host, prepare() {},
  dispose() { throw new Error('Cleanup failed'); },
});
let cleanupPromise;
assert.doesNotThrow(() => { cleanupPromise = throwingDispose.dispose(); }, 'Synchronous teardown errors must be returned through the cleanup Promise');
assert.equal(cleanupPromise, throwingDispose.dispose(), 'Repeated disposal must share a rejected cleanup Promise');
await assert.rejects(cleanupPromise, /Cleanup failed/);
for (const value of [null, 'text']) {
  const failing = V.managedSource({ id: `value-init-${value}`, element: () => host,
    initialize() { throw value; }, prepare() {},
  });
  await assert.rejects(failing.ready(), error => error.cause === value && error.message.endsWith(String(value)));
  await failing.dispose();
  const remove = V.frameSource({ id: `value-prepare-${value}`, element: () => host, prepare() { throw value; } });
  await assert.rejects(render(0, 9).prepared, error => error.cause === value && error.message.endsWith(String(value)));
  remove();
}
let reportedValue;
const observer = { onFrameError({ error }) { reportedValue = error; throw 'Observer failure'; } };
V.use(observer);
assert.doesNotThrow(() => V._frameRuntime.report(null), 'Errors in an error observer must not escape the reporting path');
assert.equal(reportedValue.message, 'null');
assert.equal(reportedValue.cause, null);
assert.equal(messages.filter(message => message === 'onFrameError callback failed: Observer failure').length, 1);
V.plugins.splice(V.plugins.indexOf(observer), 1);

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/managed-sources-'));
const videoDir = path.join(root, 'videos/demo');
fs.mkdirSync(videoDir, { recursive: true });
fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><style>#controls,#hud,#subs,#start-hint{display:none!important}iframe{width:320px;height:180px;border:0}</style><body><script src="../base/js/engine.js"></script><script>if(!V.environment)V.environment={mode:"record",isRecord:true,pptMode:false}</script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={width:320,height:180,fps:2,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(videoDir, 'error-probe.html'), '<!doctype html><body><script src="../base/js/engine.js"></script><script>V.getSceneEnergy=()=>0;</script>');
fs.writeFileSync(path.join(videoDir, 'scenes.js'), `
let host;
const managed=V.iframeSource({id:'screen',src:'child.html',element:()=>host,active:()=>!window.sourceHidden});
V.scene({duration:1,lines:[],build(root){host=document.createElement('iframe');root.append(host);},
update(t){managed.setState({color:t<0.5?'#00dd44':'#ff2255',delay:t<0.5?25:1});}});
`);
fs.writeFileSync(path.join(videoDir, 'child.html'), `<!doctype html><body style="margin:0"><script src="../base/js/frame-client.js"></script><script>
window.applied=0;
window.initializationFailure=new URLSearchParams(location.search).get('failInit');
addEventListener('message',event=>{if(event.data?.type==='prepare')window.lastRequest=event.data;});
window.client=VFrameClient.connect({initialize(){
 if(window.initializationFailure==='null')throw null;
 if(window.initializationFailure==='text')throw 'text';
 return new Promise(resolve=>setTimeout(resolve,35));
},async prepare(state,frame,{signal}){
 if('failure' in state)throw state.failure;
 const request=window.lastRequest;
 parent.postMessage({...request,type:'complete',requestId:request.requestId+999,frameId:frame.id},location.origin);
 await new Promise(resolve=>setTimeout(resolve,state.delay));
 if(signal.aborted)throw new DOMException('Cancelled','AbortError');
 document.body.style.background=state.color;window.applied++;
}});
</script>`);

await withAuditSession({ projectRoot: root }, async audit => {
  const video = await audit.openVideo('demo');
  const green = await video.capture(0.1);
  const red = await video.capture(0.8);
  assert.ok(!green.image.equals(red.image), 'The parent must wait for actual prepared iframe pixels');
  await video.page.evaluate(() => { window.sourceHidden = true; });
  await video.seek(0.8);
  assert.equal(await video.page.locator('iframe').evaluate(el => el.style.display), '', 'Recording must retain iframe layout while hiding scene visibility');
  await video.page.evaluate(() => { window.sourceHidden = false; });
  const forged = await video.page.evaluate(async () => {
    const pending = V.seekToAsync(0.1);
    const child = document.querySelector('iframe').contentWindow;
    while (child.lastRequest.frame.id !== V.getFrameState().id) await new Promise(resolve => setTimeout(resolve, 1));
    const data = { ...child.lastRequest, type: 'complete', frameId: V.getFrameState().id };
    dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data }));
    dispatchEvent(new MessageEvent('message', { source: child, origin: 'https://wrong.invalid', data }));
    await pending;
    return child.document.body.style.background;
  });
  assert.equal(forged, 'rgb(0, 221, 68)', 'Wrong source or origin must not acknowledge a pending frame');
  assert.ok(green.image.equals((await video.capture(0.1)).image));
  const result = await video.page.evaluate(async () => {
    const old = V.seekToAsync(0.1).catch(error => error.name);
    await new Promise(resolve => setTimeout(resolve, 5));
    const frame = await V.seekToAsync(0.8);
    return [await old, frame.now];
  });
  assert.deepEqual(result, ['AbortError', 0.8]);
  await video.page.waitForTimeout(30);
  const child = video.page.frames()[1];
  assert.equal(await child.evaluate(() => document.body.style.background), 'rgb(255, 34, 85)');
  const count = await child.evaluate(() => applied);
  await video.seek(0.8);
  assert.equal(await child.evaluate(() => applied), count + 1, 'setState must not issue a second sync request');
  const pageErrors = [];
  video.page.on('pageerror', error => pageErrors.push(error.message));
  const detached = await video.page.evaluate(async () => {
    const listeners = new Set();
    const add = window.addEventListener, remove = window.removeEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === 'message') listeners.add(listener);
      return add.call(this, type, listener, options);
    };
    window.removeEventListener = function (type, listener, options) {
      if (type === 'message') listeners.delete(listener);
      return remove.call(this, type, listener, options);
    };
    try {
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const source = V.iframeSource({ id: 'detached', src: 'child.html', element: () => frame });
      source.setState({ color: '#123456', delay: 50 });
      await source.ready();
      const abortListeners = new Map();
      const addAbort = AbortSignal.prototype.addEventListener, removeAbort = AbortSignal.prototype.removeEventListener;
      AbortSignal.prototype.addEventListener = function (type, listener, options) {
        if (type === 'abort') {
          if (!abortListeners.has(this)) abortListeners.set(this, new Set());
          abortListeners.get(this).add(listener);
        }
        return addAbort.call(this, type, listener, options);
      };
      AbortSignal.prototype.removeEventListener = function (type, listener, options) {
        if (type === 'abort') abortListeners.get(this)?.delete(listener);
        return removeAbort.call(this, type, listener, options);
      };
      let sendFailure, remainingSignalListeners;
      try {
        source.setState({ callback() {} });
        sendFailure = await V.seekToAsync(0.8).then(() => 'resolved', error => error.cause?.name);
        source.setState({ color: '#123456', delay: 1 });
        await V.seekToAsync(0.8);
        remainingSignalListeners = [...abortListeners].filter(([signal]) => !signal.aborted)
          .reduce((total, [, handlers]) => total + handlers.size, 0);
      } finally {
        AbortSignal.prototype.addEventListener = addAbort;
        AbortSignal.prototype.removeEventListener = removeAbort;
      }
      source.setState({ color: '#123456', delay: 50 });
      const child = frame.contentWindow;
      const pending = V.seekToAsync(0.1).catch(error => error.name);
      const deadline = performance.now() + 1000;
      while (child.lastRequest?.frame.id !== V.getFrameState().id) {
        if (performance.now() > deadline) throw new Error('Detached fixture did not receive a preparation request');
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      frame.remove();
      const disposing = source.dispose();
      const sharedDisposal = disposing === source.dispose();
      await disposing;
      return { sendFailure, remainingSignalListeners, pending: await pending, sharedDisposal, remainingListeners: listeners.size };
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
    }
  });
  assert.equal(detached.sendFailure, 'DataCloneError', 'Uncloneable iframe state must reject its preparation');
  assert.equal(detached.remainingSignalListeners, 0, 'A failed send must remove its pending request listener before a valid frame retries');
  assert.equal(detached.pending, 'AbortError', 'Removing an iframe then disposing its source must cancel the pending frame');
  assert.equal(detached.sharedDisposal, true);
  assert.equal(detached.remainingListeners, 0, 'A detached iframe must not retain its message listener after disposal');
  assert.deepEqual(pageErrors, [], 'Detached iframe cancellation must not throw from AbortSignal listeners');
  assert.deepEqual(video.issues, []);
  const errorPage = await audit.openPage('/demo/error-probe.html');
  const errorPageErrors = [];
  errorPage.on('pageerror', error => errorPageErrors.push(error.message));
  const errorValues = await errorPage.evaluate(async () => {
    const results = [];
    V.use({ onFrameError() { throw 'Observer failure'; } });
    for (const value of [null, 'text']) {
      const element = document.createElement('iframe');
      document.body.append(element);
      const source = V.iframeSource({ id: `error-${value}`, src: `child.html?failInit=${value}`, element: () => element,
        readyTimeoutMs: 1000, timeoutMs: 1000,
      });
      const initialization = await source.ready().then(() => 'resolved', error => error.message);
      element.contentWindow.initializationFailure = false;
      await source.retry();
      source.setState({ failure: value });
      const frame = V._frameRuntime.begin({ start: 0 }, 0, 0, 0, 0, { isRecord: true });
      const preparation = await V._frameRuntime.prepare(frame).then(() => 'resolved', error => error.message);
      source.setState({ color: '#123456', delay: 1 });
      const recovered = V._frameRuntime.begin({ start: 0 }, 0, 1, 1, 0, { isRecord: true });
      await V._frameRuntime.prepare(recovered);
      results.push({ value, initialization, preparation, recovered: element.contentWindow.client.frameId === recovered.id });
      await source.dispose();
      element.remove();
    }
    return results;
  });
  for (const result of errorValues) {
    assert.ok(result.initialization.endsWith(String(result.value)), 'Iframe initialization must return the original rejected value as its error message');
    assert.ok(result.preparation.endsWith(String(result.value)), 'Iframe preparation must return the original rejected value as its error message');
    assert.equal(result.recovered, true, 'A rejected iframe frame must permit a later valid frame');
  }
  assert.deepEqual(errorPageErrors, [], 'Iframe callbacks and throwing error observers must not produce unhandled rejections');
  await errorPage.close();
});
console.log('Managed source initialization, timeout/retry, error values, cleanup failures, frame signals, iframe matching and detached cancellation PASSED.', root);
