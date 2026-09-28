// The user-journey harness. `scripts/user-journey.ts` copies this directory into a fresh project
// that has installed the packed `typeshade` tarball, and runs this file there with Node. So it
// sees exactly what a user sees: the published exports, the compiled `dist/`, the README's
// `tsconfig.shade.json`, and a real WebGPU device. It imports nothing from the repository.
//
// For each journey (a directory holding `*.shade.ts` sources and a `journey.mjs` host), it
// checks that:
//
//   1. `compile()` accepts every source with no diagnostic at all, error or warning;
//   2. the language service (`typeshade/language-service`) reports nothing on it;
//   3. `tsc -p tsconfig.shade.json`, the README's file, reports only the error classes the
//      README documents (decorators, and operators on vectors);
//   4. each run, on WebGPU, produces what the journey's plain-JavaScript reference computes;
//   5. the same run on the CPU oracle (`compileModule`) produces it too.
//
// A run of a kernel function (`kind: 'kernel'`, change 0013) is called with the journey's own
// host values. It runs here on the CPU oracle, and on WebGPU through the import, which is how a
// host calls one and which `journeys/_host-import` checks (`scripts/user-journey.ts`).

import { compile, reflect, compileModule, decodeConsole } from 'typeshade';
import { createTypeshadeLanguageService } from 'typeshade/language-service';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'journeys';
const PLAYWRIGHT = process.env.TYPESHADE_PLAYWRIGHT;
const CHROMIUM = process.env.TYPESHADE_CHROMIUM || undefined;
if (!PLAYWRIGHT) throw new Error('TYPESHADE_PLAYWRIGHT must point at playwright/index.mjs');
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);

/** The `tsc` codes the README documents as what plain `tsc` cannot see through. */
const TSC_DOCUMENTED = new Set([
  'TS1206',
  'TS2322',
  'TS2339',
  'TS2345',
  'TS2362',
  'TS2363',
  'TS2365',
  'TS2769',
]);

const failures = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

const journeys = readdirSync(ROOT)
  .filter((d) => !d.startsWith('_') && statSync(join(ROOT, d)).isDirectory())
  .sort();
if (journeys.length === 0) throw new Error('no journeys found: the harness is broken');

// ---- 1 and 2: the compiler and the editor -------------------------------------------------------
const service = createTypeshadeLanguageService();
const compiled = new Map();
for (const id of journeys) {
  for (const file of readdirSync(join(ROOT, id)).filter((f) => f.endsWith('.shade.ts'))) {
    const path = join(ROOT, id, file);
    const source = readFileSync(path, 'utf8');
    const r = compile(source, { fileName: path });
    for (const d of r.diagnostics) fail(path, `compile() ${d.category} ${d.code}: ${d.message}`);
    if (!r.wgsl) fail(path, 'compile() emitted no WGSL');
    compiled.set(path, r);
    service.openDocument(path, source);
    for (const d of service.getDiagnostics(path)) {
      fail(path, `editor ${d.source} ${String(d.code)}: ${d.message}`);
    }
  }
}

// ---- 3: plain tsc, through the README's tsconfig ------------------------------------------------
{
  const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.shade.json', '--pretty', 'false'], {
    encoding: 'utf8',
  });
  const lines = `${tsc.stdout}${tsc.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
  const counts = {};
  for (const line of lines) {
    const code = /error (TS\d+)/.exec(line)[1];
    counts[code] = (counts[code] ?? 0) + 1;
    if (!TSC_DOCUMENTED.has(code)) fail('tsc -p tsconfig.shade.json', line.trim());
  }
  console.log(`tsc (README tsconfig): ${JSON.stringify(counts)}`);
}

// ---- 4 and 5: WebGPU and the CPU oracle ---------------------------------------------------------
/** A typed array as the page can receive it. */
const wire = (a) => ({
  type: a instanceof Uint32Array ? 'u32' : a instanceof Int32Array ? 'i32' : 'f32',
  data: [...a],
});

/** Every binding of group 0, as a bind group layout entry needs it. */
function layoutOf(module, console) {
  const group = reflect(module, console ? { console: 'gpu' } : undefined).bindGroups.find(
    (g) => g.group === 0,
  );
  return (group?.entries ?? []).map((e) => ({
    binding: e.binding,
    name: e.name,
    type: e.space === 'uniform' ? 'uniform' : e.access === 'read' ? 'read-only-storage' : 'storage',
  }));
}

const jobs = [];
const kernels = [];
for (const id of journeys) {
  const spec = (await import(pathToFileURL(join(process.cwd(), ROOT, id, 'journey.mjs')).href))
    .default;
  for (const [n, run] of spec.runs.entries()) {
    const path = join(ROOT, id, run.shader);
    const r = compiled.get(path);
    if (!r?.wgsl) continue;
    // A kernel function (change 0013) runs on WebGPU through the import, which
    // `journeys/_host-import` checks; here it runs on the CPU oracle.
    if (run.kind === 'kernel') {
      kernels.push({ id: `${id}#${n}`, run, module: r.module, spec });
      continue;
    }
    const bindings = Object.fromEntries(
      Object.entries(run.bindings).map(([k, v]) => [k, wire(v.gpu)]),
    );
    // A run with `console` is compiled again with the WGSL recording its console calls, and
    // the harness binds the `_console` buffer the reflection reports (surface §66).
    let wgsl = r.wgsl;
    let consoleLog;
    if (run.console) {
      const rc = compile(readFileSync(path, 'utf8'), { fileName: path, console: 'gpu' });
      for (const d of rc.diagnostics)
        fail(path, `compile({ console: 'gpu' }) ${d.category} ${d.code}: ${d.message}`);
      if (!rc.wgsl || !rc.console) {
        fail(path, "compile({ console: 'gpu' }) recorded no console call");
        continue;
      }
      wgsl = rc.wgsl;
      consoleLog = rc.console;
      bindings._console = wire(new Uint32Array(2 + run.console.capacity));
    }
    jobs.push({
      id: `${id}#${n}`,
      spec,
      run,
      module: r.module,
      wgsl,
      consoleLog,
      layout: layoutOf(r.module, run.console !== undefined),
      bindings,
    });
  }
}

/** Runs INSIDE the page: plain WebGPU, nothing from this package. */
async function runOnGpu(job) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code: job.wgsl });
  const info = await module.getCompilationInfo();
  const stages =
    job.kind === 'render'
      ? GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
      : GPUShaderStage.COMPUTE;
  // A writable storage buffer (the `_console` buffer of a render) is the fragment stage's
  // alone: WebGPU refuses one the vertex stage can see.
  const bgl = device.createBindGroupLayout({
    entries: job.layout.map((l) => ({
      binding: l.binding,
      visibility: job.kind === 'render' && l.type === 'storage' ? GPUShaderStage.FRAGMENT : stages,
      buffer: { type: l.type },
    })),
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const buffers = {};
  for (const l of job.layout) {
    const b = job.bindings[l.name];
    if (!b) throw new Error(`the journey supplies no data for binding "${l.name}"`);
    const Ctor = b.type === 'u32' ? Uint32Array : b.type === 'i32' ? Int32Array : Float32Array;
    const bytes = new Ctor(b.data);
    const usage =
      (l.type === 'uniform' ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST;
    const buffer = device.createBuffer({ size: Math.max(16, bytes.byteLength), usage });
    device.queue.writeBuffer(buffer, 0, bytes);
    buffers[l.name] = { buffer, size: bytes.byteLength };
  }
  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: job.layout.map((l) => ({
      binding: l.binding,
      resource: { buffer: buffers[l.name].buffer },
    })),
  });
  const encoder = device.createCommandEncoder();
  let readback;
  let consoleReadback;
  if (job.kind === 'compute') {
    const pipeline = device.createComputePipeline({
      layout,
      compute: { module, entryPoint: job.entry },
    });
    for (let i = 0; i < job.repeat; i++) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(...job.workgroups);
      pass.end();
    }
    const { buffer, size } = buffers[job.read];
    readback = {
      buffer: device.createBuffer({
        size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      float: true,
    };
    encoder.copyBufferToBuffer(buffer, 0, readback.buffer, 0, size);
    if (job.readConsole) {
      const c = buffers._console;
      readback.console = device.createBuffer({
        size: c.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder.copyBufferToBuffer(c.buffer, 0, readback.console, 0, c.size);
    }
  } else {
    const [w, h] = job.size;
    const format = 'rgba8unorm';
    const pipeline = device.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: job.vertex },
      fragment: { module, entryPoint: job.fragment, targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const texture = device.createTexture({
      size: [w, h],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    if (job.scissor) pass.setScissorRect(...job.scissor);
    pass.draw(3);
    pass.end();
    if (job.readConsole) {
      const c = buffers._console;
      consoleReadback = device.createBuffer({
        size: c.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder.copyBufferToBuffer(c.buffer, 0, consoleReadback, 0, c.size);
    }
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    readback = {
      buffer: device.createBuffer({
        size: bytesPerRow * h,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      float: false,
      bytesPerRow,
    };
    encoder.copyTextureToBuffer({ texture }, { buffer: readback.buffer, bytesPerRow }, [w, h]);
  }
  device.queue.submit([encoder.finish()]);
  await readback.buffer.mapAsync(GPUMapMode.READ);
  const raw = readback.buffer.getMappedRange().slice(0);
  let consoleWords = null;
  const consoleBuffer = readback.console ?? consoleReadback;
  if (consoleBuffer) {
    await consoleBuffer.mapAsync(GPUMapMode.READ);
    consoleWords = [...new Uint32Array(consoleBuffer.getMappedRange().slice(0))];
  }
  const error = await device.popErrorScope();
  let values;
  if (readback.float) values = [...new Float32Array(raw)];
  else {
    const [w, h] = job.size;
    const px = new Uint8Array(raw);
    values = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w * 4; x++) values.push(px[y * readback.bytesPerRow + x] / 255);
  }
  return {
    values,
    consoleWords,
    error: error ? error.message : null,
    messages: info.messages.map((m) => `${m.type}: ${m.message}`),
  };
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
});
// WebGPU needs a secure context, and http://127.0.0.1 is one.
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>typeshade journeys</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);

/** Where two lists of console lines first differ, or '' when they agree: the method and the
 *  invocation exactly, a number in the arguments to `tolerance` of its size (or of 1). */
function firstDifference(got, want, tolerance) {
  if (got.length !== want.length) return `${got.length} lines, expected ${want.length}`;
  const same = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number')
      return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = Object.keys(b);
      return keys.length === Object.keys(a).length && keys.every((k) => same(a[k], b[k]));
    }
    return a === b;
  };
  for (let i = 0; i < want.length; i++) {
    const g = got[i];
    const w = want[i];
    if (
      g.method !== w.method ||
      JSON.stringify(g.invocation) !== JSON.stringify(w.invocation) ||
      !same(g.args, w.args)
    )
      return `line ${i}: ${JSON.stringify(g)} for ${JSON.stringify(w)}`;
  }
  return '';
}

const worst = (got, want, tolerance) => {
  if (got.length < want.length)
    return { ok: false, text: `${got.length} values, expected ${want.length}` };
  let max = 0;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(got[i] - want[i]) / Math.max(1, Math.abs(want[i]));
    max = Number.isNaN(d) ? Infinity : Math.max(max, d);
  }
  return { ok: max <= tolerance, text: max.toExponential(2) };
};

for (const job of jobs) {
  const { run } = job;
  let expected;
  // A scissor rectangle keeps the pixels it covers; the others keep the clear value, 0.
  const inside = (x, y) =>
    !run.scissor ||
    (x >= run.scissor[0] &&
      x < run.scissor[0] + run.scissor[2] &&
      y >= run.scissor[1] &&
      y < run.scissor[1] + run.scissor[3]);
  if (run.kind === 'render') {
    const [w, h] = run.size;
    expected = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        expected.push(
          ...(inside(x, y) ? run.expected(x, y) : [0, 0, 0, 0]).map((c) =>
            Math.min(1, Math.max(0, c)),
          ),
        );
  } else expected = run.expected();

  // WebGPU.
  let gpu;
  try {
    gpu = await page.evaluate(runOnGpu, {
      kind: run.kind,
      wgsl: job.wgsl,
      layout: job.layout,
      bindings: job.bindings,
      entry: run.entry,
      workgroups: run.workgroups,
      repeat: run.repeat ?? 1,
      read: run.read,
      vertex: run.vertex,
      fragment: run.fragment,
      size: run.size,
      scissor: run.scissor,
      readConsole: job.consoleLog !== undefined,
    });
  } catch (e) {
    fail(job.id, `WebGPU threw: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (gpu.error) fail(job.id, `WebGPU validation: ${gpu.error}`);
  for (const m of gpu.messages) fail(job.id, `createShaderModule ${m}`);
  const g = worst(gpu.values, expected, run.tolerance);
  if (!g.ok) fail(job.id, `WebGPU result off by ${g.text} (tolerance ${run.tolerance})`);

  // The CPU oracle, and the console lines it delivers to the sink.
  let cpuValues;
  const cpuLines = [];
  // The pixel a render's fragment entry is running for, which is the invocation a line
  // decoded from WebGPU carries (surface §66).
  let pixel;
  try {
    const m = compileModule(job.module, {
      ...(run.gpuStubs ? { gpuStubs: true } : {}),
      consoleSink: (e) =>
        cpuLines.push({ method: e.method, args: e.args, invocation: e.invocation ?? pixel }),
    });
    for (const [name, b] of Object.entries(run.bindings))
      m.setBinding(name, structuredClone(b.cpu));
    if (run.kind === 'render') {
      const [w, h] = run.size;
      cpuValues = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!inside(x, y)) {
            cpuValues.push(0, 0, 0, 0);
            continue;
          }
          pixel = [x, y, 0];
          const color = run.fragmentColor(m.fns[run.fragment](...run.fragmentArgs(x, y)));
          // What an rgba8unorm target stores: clamped, rounded to 1/255.
          cpuValues.push(...color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255) / 255));
        }
    } else {
      const bound = structuredClone(run.bindings[run.read].cpu);
      m.setBinding(run.read, bound);
      for (let i = 0; i < (run.repeat ?? 1); i++) m.dispatch(run.entry, run.workgroups);
      cpuValues = run.flattenCpu ? run.flattenCpu(bound) : bound;
    }
  } catch (e) {
    fail(job.id, `CPU oracle threw: ${e.message}`);
    continue;
  }
  const c = worst(cpuValues, expected, run.tolerance);
  if (!c.ok) fail(job.id, `CPU oracle result off by ${c.text} (tolerance ${run.tolerance})`);

  // The console lines: decoded from WebGPU, delivered on the CPU, and the host's own, all equal.
  if (job.consoleLog) {
    const want = run.console.expected();
    const tolerance = run.console.tolerance ?? 0;
    const decoded = decodeConsole(new Uint32Array(gpu.consoleWords ?? []), job.consoleLog);
    const gpuLines = decoded.events.map((e) => ({
      method: e.method,
      args: e.args,
      invocation: [...e.invocation],
    }));
    const cpuPlain = cpuLines.map((l) => ({ ...l, invocation: [...l.invocation] }));
    if (run.console.kept === undefined) {
      if (decoded.dropped > 0) fail(job.id, `WebGPU dropped ${decoded.dropped} console lines`);
      const off = firstDifference(gpuLines, want, tolerance);
      if (off) fail(job.id, `WebGPU console lines differ from the host's: ${off}`);
    } else {
      // A buffer with room for `kept` lines: that many whole lines, the rest counted as
      // dropped, and each kept line is its own pixel's. Which ones are kept is the GPU's order.
      if (
        gpuLines.length !== run.console.kept ||
        decoded.dropped !== want.length - run.console.kept
      )
        fail(
          job.id,
          `WebGPU kept ${gpuLines.length} console lines and dropped ${decoded.dropped}; expected ${run.console.kept} and ${want.length - run.console.kept}`,
        );
      const byInvocation = new Map(want.map((l) => [l.invocation.join(','), l]));
      for (const l of gpuLines) {
        const own = byInvocation.get(l.invocation.join(','));
        const off = own ? firstDifference([l], [own], tolerance) : 'no such invocation';
        if (off) fail(job.id, `a kept WebGPU console line is not its own: ${off}`);
      }
    }
    const offCpu = firstDifference(cpuPlain, want, tolerance);
    if (offCpu) fail(job.id, `CPU oracle console lines differ from the host's: ${offCpu}`);
    console.log(
      `     ${job.id.padEnd(16)} console: ${gpuLines.length} lines from WebGPU` +
        (decoded.dropped > 0 ? `, ${decoded.dropped} dropped` : ''),
    );
  }
  console.log(
    `${g.ok && c.ok ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}: ${expected.length} values, worst relative error WebGPU ${g.text}, CPU oracle ${c.text}`,
  );
}
await browser.close();
server.close();

// A kernel function on the CPU oracle: called with the journey's own host values, `repeat`
// times, and the array it writes read back.
for (const job of kernels) {
  const { run } = job;
  const expected = run.expected();
  let values;
  try {
    const m = compileModule(job.module);
    const args = structuredClone(run.args);
    for (let i = 0; i < (run.repeat ?? 1); i++) m.fns[run.fn](...Object.values(args));
    values = run.flatten(args[run.read]);
  } catch (e) {
    fail(job.id, `CPU oracle threw: ${e.message}`);
    continue;
  }
  const c = worst(values, expected, run.tolerance);
  if (!c.ok) fail(job.id, `CPU oracle result off by ${c.text} (tolerance ${run.tolerance})`);
  console.log(
    `${c.ok ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}: ${expected.length} values, worst relative error CPU oracle ${c.text} (WebGPU through the import journey)`,
  );
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(
  `\n${journeys.length} journeys, ${jobs.length + kernels.length} runs: every check passed.`,
);
