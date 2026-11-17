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

const messages = [];
const context = { V: { environment, getSceneEnergy: () => 0 }, AbortController, DOMException,
  performance, setTimeout, clearTimeout, console: { error: error => messages.push(error.message) } };
vm.runInNewContext(core, context);
const V = context.V;
const scene = { start: 0 };
function render(index, time) {
  const frame = V._frameRuntime.begin(scene, index, time, time, 0, { isRecord: true, playing: false });
  V.emit('onRender', { frame });
  return { frame, prepared: V._frameRuntime.prepare(frame) };
}
const delay = time => new Promise(resolve => setTimeout(resolve, time));
const host = { isConnected: true, style: { visibility: '' } };
let initialized = 0, prepared = 0, disposed = 0;
const source = V.managedSource({ id: 'native', element: () => host, active: frame => frame.sceneIndex === 0,
  timeoutMs: 10, readyTimeoutMs: 200,
  async initialize({ signal }) { initialized++; await delay(40); assert.equal(signal.aborted, false); return 'model'; },
  prepare(state, frame, { data }) { prepared++; assert.equal(data, 'model'); assert.equal(state.value, 2); },
  dispose() { disposed++; },
});
source.setState({ value: 1 });
const first = render(0, 0.1).prepared.catch(error => error.name);
await delay(2);
source.setState({ value: 2 });
const last = render(0, 0.2);
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
const slow = V.managedSource({ id: 'slow', element: () => host, timeoutMs: 5, prepare: () => new Promise(() => {}) });
slow.setState({});
await assert.rejects(render(0, 8).prepared, /slow.*Preparation timed out after 5ms/);
slow.dispose();

const root = fs.mkdtempSync(path.join(PKG_ROOT, '.runtime/managed-sources-'));
const videoDir = path.join(root, 'videos/demo');
fs.mkdirSync(videoDir, { recursive: true });
fs.writeFileSync(path.join(videoDir, 'index.html'), '<!doctype html><link rel="stylesheet" href="../base/css/base.css"><style>#controls,#hud,#subs,#start-hint{display:none!important}iframe{width:320px;height:180px;border:0}</style><body><script src="../base/js/engine.js"></script><script>if(!V.environment)V.environment={mode:"record",isRecord:true,pptMode:false}</script><script src="video.config.js"></script><script src="scenes.js"></script><script>V.boot()</script>');
fs.writeFileSync(path.join(videoDir, 'video.config.js'), 'V.config={width:320,height:180,fps:2,audioSrc:false,bgm:false,ui:{persist:false},sceneScripts:["scenes.js"]};');
fs.writeFileSync(path.join(videoDir, 'scenes.js'), `
let host;
const managed=V.iframeSource({id:'screen',src:'child.html',element:()=>host});
V.scene({duration:1,lines:[],build(root){host=document.createElement('iframe');root.append(host);},
update(t){managed.setState({color:t<0.5?'#00dd44':'#ff2255',delay:t<0.5?25:1});}});
`);
fs.writeFileSync(path.join(videoDir, 'child.html'), `<!doctype html><body style="margin:0"><script src="../base/js/frame-client.js"></script><script>
window.applied=0;
addEventListener('message',event=>{if(event.data?.type==='prepare')window.lastRequest=event.data;});
window.client=VFrameClient.connect({initialize:()=>new Promise(resolve=>setTimeout(resolve,35)),async prepare(state,frame,{signal}){
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
  assert.deepEqual(video.issues, []);
});
console.log('Managed source initialization, timeout/retry, scene visibility, iframe matching and cancellation PASSED.', root);
