// Controlled complete-call comparison for change 0082. No result leaves this process.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { hostFace } from '../src/compiler/ts/host-face.js';

mkdirSync('.cache', { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'typeshade-layout-'));
try {
  const output = process.argv[2] ?? '.cache/kernel-layout-bench.json';
  const runtime = resolve('src/core/host-runtime.ts');
  const imports: string[] = [];
  const cases: string[] = [];
  for (const reads of [1, 4, 8]) {
    const source = `"use typeshade";
class Item { ${Array.from({ length: 8 }, (_, i) => `f${i}:f32;`).join(' ')} }
export function sample(xs:array<Item>,out:array<f32>){
 for(let i:u32=0;i<xs.length;i++){out[i]=${Array.from({ length: reads }, (_, i) => `xs[i].f${i}`).join('+')};}
}
export function warm(xs:array<f32>,out:array<f32>){for(let i:u32=0;i<xs.length;i++){out[i]=xs[i];}}`;
    const h = hostFace(source, { fileName: `/layout-${reads}.shade.ts`, runtime });
    if (h.diagnostics.length) throw new Error(JSON.stringify(h.diagnostics));
    const e = h.exports!.find((e) => e.name === 'sample');
    if (e?.kind !== 'kernel' || !e.face.gpu) throw new Error('Missing kernel');
    for (const variant of ['full', 'projected']) {
      const id = `r${reads}_${variant}`;
      const face =
        variant === 'full' ? { ...e.face, gpu: { ...e.face.gpu, projected: undefined } } : e.face;
      const serialized = JSON.stringify(e.face);
      if (h.code!.split(serialized).length !== 2) throw new Error('Kernel metadata is not unique');
      writeFileSync(join(dir, `${id}.js`), h.code!.replace(serialized, JSON.stringify(face)));
      imports.push(`import * as ${id} from './${id}.js';`);
      cases.push(
        `{reads:${reads},variant:${JSON.stringify(variant)},module:${id},face:${JSON.stringify(face)}}`,
      );
    }
  }
  const browserSource = `
${imports.join('\n')}
import {configure} from ${JSON.stringify(runtime)};
import {checkCall} from ${JSON.stringify(resolve('src/core/host-kernel.ts'))};
import {packed,projectInputLayout} from ${JSON.stringify(resolve('src/core/host-entry.ts'))};
const cases=[${cases.join(',')}];
const now=()=>performance.now();
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const adapter=await navigator.gpu.requestAdapter();
if(!adapter)throw Error('No adapter');
configure({prefer:['webgpu'],features:adapter.features.has('timestamp-query')?['timestamp-query']:[]});
let device;
const request=GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice=async function(d){return device=await request.call(this,d);};
const nativeBuffer=GPUDevice.prototype.createBuffer;
const owned=new Map();let live=0,active=false,peak=0,uploaded=0,passes=0;
GPUDevice.prototype.createBuffer=function(d){const b=nativeBuffer.call(this,d);owned.set(b,d.size);live+=d.size;if(active)peak=Math.max(peak,live);return b;};
const destroy=GPUBuffer.prototype.destroy;
GPUBuffer.prototype.destroy=function(){if(owned.has(this)){live-=owned.get(this);owned.delete(this);}return destroy.call(this);};
const write=GPUQueue.prototype.writeBuffer;
GPUQueue.prototype.writeBuffer=function(b,o,data,at=0,size){if(active){const unit=data.BYTES_PER_ELEMENT??1;uploaded+=size===undefined?data.byteLength-at*unit:size*unit;}return write.call(this,b,o,data,at,size);};
await cases[0].module.warm(new Float32Array([1]),new Float32Array(1));
const timed=device.features.has('timestamp-query');
const stamps=timed?device.createQuerySet({type:'timestamp',count:2}):null;
const resolved=timed?nativeBuffer.call(device,{size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}):null;
const read=timed?nativeBuffer.call(device,{size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}):null;
const measured=new WeakSet();
const begin=GPUCommandEncoder.prototype.beginComputePass;
GPUCommandEncoder.prototype.beginComputePass=function(d={}){if(active&&timed){if(measured.has(this))throw Error('Expected one pass');measured.add(this);passes++;return begin.call(this,{...d,timestampWrites:{querySet:stamps,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});}return begin.call(this,d);};
const finish=GPUCommandEncoder.prototype.finish;
GPUCommandEncoder.prototype.finish=function(...args){if(measured.has(this)){this.resolveQuerySet(stamps,0,2,resolved,0);this.copyBufferToBuffer(resolved,0,read,0,16);}return finish.apply(this,args);};
const matches=(out,xs,reads)=>{for(let i=0;i<out.length;i++){let expected=0;for(let f=0;f<reads;f++)expected=Math.fround(expected+xs[i]['f'+f]);if(!Object.is(out[i],expected))return false;}return true;};
const rows=[];
for(const n of [1,16384,65536,262144]){
 const xs=Array.from({length:n},(_,i)=>Object.fromEntries(Array.from({length:8},(_,f)=>['f'+f,(i%16)/8+f])));
 for(const reads of [1,4,8]){
  const group=cases.filter(c=>c.reads===reads);
  const samples=new Map(group.map(c=>[c,{validationMs:[],packingMs:[],wallMs:[],gpuNs:[],peakBufferBytes:[],uploadBytes:[],coldMs:null}]));
  for(let round=-2;round<15;round++)for(const c of round%2===0?group:[...group].reverse()){
   const out=new Float32Array(n);const s=samples.get(c);
   const logical=c.face.params.find(p=>p.name==='xs');
   const binding=(c.variant==='projected'?c.face.gpu.projected?.arrays:c.face.gpu.arrays)?.find(b=>b.name==='xs')??c.face.gpu.arrays.find(b=>b.name==='xs');
   if(binding.layout.st!==logical.layout.st)projectInputLayout(logical.layout,binding.layout);
   let start=now();checkCall({F:{},$:{bindings:{},vars:{}}},{...c.face,gpu:undefined},2,[xs,out]);const validation=now()-start;
   start=now();const bytes=packed(binding,xs);const packing=now()-start;
   uploaded=0;peak=live;passes=0;active=true;start=now();
   try{await c.module.sample(xs,out);}finally{active=false;}
   const wall=now()-start;
   let gpu=null;if(timed){if(passes!==1)throw Error('Expected one timed pass');await read.mapAsync(GPUMapMode.READ);const t=new BigUint64Array(read.getMappedRange());gpu=Number(t[1]-t[0]);read.unmap();}
   if(!matches(out,xs,reads))throw Error('Output mismatch');
   out[0]+=1;if(matches(out,xs,reads))throw Error('Corruption probe is blind');
   if(round===-2)s.coldMs=wall;
   if(round>=0){s.validationMs.push(validation);s.packingMs.push(packing);s.wallMs.push(wall);if(gpu!==null&&gpu>0)s.gpuNs.push(gpu);s.peakBufferBytes.push(peak);s.uploadBytes.push(uploaded);}
   s.inputBytes=bytes.byteLength;
  }
  for(const c of group){const s=samples.get(c);rows.push({n,reads,variant:c.variant,...s,medians:Object.fromEntries(Object.entries(s).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length?median(v):null]))});}
 }
}
if(timed){stamps.destroy();resolved.destroy();read.destroy();}
globalThis.layoutReport={date:new Date().toISOString(),adapter:Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info?.[k]??''])),software:/swiftshader|llvmpipe|software rasterizer/i.test([adapter.info?.description,adapter.info?.architecture,adapter.info?.device].join(' '))||adapter.isFallbackAdapter===true,timestamps:timed,rows};
`;
  writeFileSync(join(dir, 'page.js'), browserSource);
  const bundlePath = join(dir, 'bundle.js');
  execFileSync(
    process.execPath,
    ['build', join(dir, 'page.js'), '--target', 'browser', '--outfile', bundlePath],
    { stdio: 'pipe' },
  );
  const js = readFileSync(bundlePath, 'utf8');
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: [
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      ...(process.env['TYPESHADE_LAYOUT_SOFTWARE'] === '1'
        ? [
            '--enable-unsafe-swiftshader',
            '--use-vulkan=swiftshader',
            '--use-angle=swiftshader',
            '--enable-features=Vulkan',
          ]
        : []),
    ],
  });
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/page.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/page.js' ? js : '<script type="module" src="/page.js"></script>');
  });
  try {
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local port');
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await Promise.race([
      page.waitForFunction('globalThis.layoutReport', undefined, { timeout: 600000 }),
      new Promise<never>((_ok, fail) => page.once('pageerror', fail)),
    ]);
    if (errors.length) throw new Error(errors.join('\n'));
    const report = (await page.evaluate('globalThis.layoutReport')) as { rows: unknown[] };
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(
      `kernel layout: ${report.rows.length} controlled rows, 15 wall samples each; saved ${output}`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
    await browser.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
