import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

const root = path.resolve(process.argv[2]);
fs.mkdirSync(root, { recursive: true });
const moduleUrl = new URL('./lib/http-static.mjs', import.meta.url).href;
const results = [];
for (const mode of ['stat', 'stream', 'truncate', 'grow', 'partial']) {
  const file = path.join(root, mode + '.txt');
  fs.writeFileSync(file, 'requested file');
  const code = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import net from 'node:net';
import { startEphemeralVideoServer } from ${JSON.stringify(moduleUrl)};
const root=${JSON.stringify(root)}, target=${JSON.stringify(file)};
const key=${JSON.stringify(mode === 'stat' ? 'statSync' : 'createReadStream')};
const mode=${JSON.stringify(mode)};
const original=fs[key];
let changed=false;
fs[key]=function(file,...args){
  if(file===target&&!changed){
    changed=true;
    if(mode==='partial'){
      let sent=false;
      const stream=new Readable({read(){if(sent)return;sent=true;this.push('part');setTimeout(()=>this.destroy(new Error('read failed')),25);}});
      process.nextTick(()=>stream.emit('open',0));return stream;
    }
    if(mode==='truncate')fs.writeFileSync(target,'part');
    else if(mode==='grow')fs.appendFileSync(target,' appended');
    else fs.unlinkSync(target);
  }
  return original.call(this,file,...args);
};
const {srv,port}=await startEphemeralVideoServer({videosDir:root});
try {
  const start=performance.now();
  const raw=mode==='grow'?await new Promise((resolve,reject)=>{
    const chunks=[];const socket=net.createConnection({host:'127.0.0.1',port});
    socket.on('connect',()=>socket.write('GET /grow.txt HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n'));
    socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>resolve(Buffer.concat(chunks)));socket.on('error',reject);
  }):null;
  const response=raw?{status:200}:await fetch('http://127.0.0.1:'+port+'/'+${JSON.stringify(mode + '.txt')},{signal:AbortSignal.timeout(2000)});
  let body='',error;
  if(raw){
    const split=raw.indexOf('\\r\\n\\r\\n');const head=raw.subarray(0,split).toString();body=raw.subarray(split+4).toString();
    assert.equal(Buffer.byteLength(body),Number(/content-length: (\\d+)/i.exec(head)[1]),'Sent bytes must match the declared response length');
  }else{
    console.log(JSON.stringify({phase:'headers',status:response.status,headers:[...response.headers]}));
    try{body=await response.text();}catch(err){error=err;}
  }
  if(mode==='partial'||mode==='truncate'){
    assert.ok(error,'A partial body must be rejected');
    assert.notEqual(error.name,'TimeoutError','A broken stream must close promptly');
    assert.ok(performance.now()-start<1500,'A broken stream must not wait for keep-alive timeout');
  }else if(mode==='grow'){
    assert.equal(body,'requested file','File growth must not exceed the declared response length');
  }else assert.equal(response.status,404,'A file removed during a request must return 404');
  fs[key]=original;fs.writeFileSync(target,'healthy again');
  assert.equal(await(await fetch('http://127.0.0.1:'+port+'/'+${JSON.stringify(mode + '.txt')})).text(),'healthy again');
  console.log(JSON.stringify({status:response.status,body,error:error?.name}));
} finally {srv.closeAllConnections();await new Promise(resolve=>srv.close(resolve));}`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
  results.push({ mode, status: r.status, error: String(r.error || ''), stdout: r.stdout, stderr: r.stderr });
}
for (const result of results) {
  assert.equal(result.status, 0, `${result.mode}: File changes must not crash or hang the HTTP server\n${result.stdout}\n${result.stderr}\n${result.error}`);
}

fs.writeFileSync(path.join(root, 'regular.txt'), '0123456789');
fs.writeFileSync(path.join(root, 'empty.txt'), '');
const { srv, port } = await startEphemeralVideoServer({ videosDir: root });
try {
  const cases = [
    { file: 'regular.txt', status: 200, length: 10, body: '0123456789' },
    { file: 'regular.txt', method: 'HEAD', status: 200, length: 10, body: '' },
    { file: 'regular.txt', range: 'bytes=2-5', status: 206, length: 4, body: '2345' },
    { file: 'regular.txt', method: 'HEAD', range: 'bytes=2-5', status: 206, length: 4, body: '' },
    { file: 'empty.txt', status: 200, length: 0, body: '' },
    { file: 'empty.txt', method: 'HEAD', status: 200, length: 0, body: '' },
    { file: 'empty.txt', range: 'bytes=0-', status: 416, body: '' },
  ];
  for (const spec of cases) {
    const response = await fetch(`http://127.0.0.1:${port}/${spec.file}`, { method: spec.method, headers: spec.range ? { Range: spec.range } : {} });
    assert.equal(response.status, spec.status);
    if (spec.length !== undefined) assert.equal(response.headers.get('content-length'), String(spec.length));
    assert.equal(await response.text(), spec.body);
  }
} finally {
  srv.closeAllConnections();
  await new Promise(resolve => srv.close(resolve));
}
console.log('HTTP file mutation, interrupted stream, HEAD, empty file and Range regressions PASSED.');
