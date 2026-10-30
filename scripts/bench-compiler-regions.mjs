// Focused SwiftShader fixtures, not TypeCV or whole-application performance.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inPage, median } from '../journeys/_bench.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    output: { type: 'string', default: 'artifacts/regions-focused.json' },
    samples: { type: 'string', default: '61' },
    batch: { type: 'string', default: '8' },
  },
});
if (!values.base) throw new Error('Require --base');
const root = resolve(import.meta.dirname, '..'),
  base = resolve(values.base);
const samples = Number(values.samples),
  batch = Number(values.batch),
  n = 8192,
  warmup = 10;
if (![samples, batch].every(Number.isSafeInteger) || samples < 3 || batch < 1 || batch > 64)
  throw new Error('Invalid samples or batch');
const bodies = {
  chain: `
    function produce(base: u32): array<f32, 12> {
      let p: array<f32, 12> = fill<f32, 12>(0.);
      for (let j: u32 = 0; j < 12; j++) p[j] = data[base + j];
      return p;
    }
    function transform(p: array<f32, 12>): vec2f { return vec2f(p[0] * 3., p[11]); }
    function consume(p: vec2f): f32 { return p.x + p.y; }
    function evaluate(i: u32): f32 {
      const p = produce(i * 12);
      const transformed = transform(p);
      const result = consume(transformed);
      return result;
    }`,
  reads: `
    function evaluate(i: u32): f32 {
      stamp(i);
      const a = data[i] * 3.;
      const b = data[i];
      return a + b;
    }`,
  loop: `
    function evaluate(i: u32): f32 {
      stamp(i);
      let sum: f32 = 0.;
      for (let k: u32 = 0; k < 6; k++) sum += data[i] * f32(k + 1);
      return sum;
    }`,
  writes: `
    function write(i: u32): void { data[i] = 9.; }
    function evaluate(i: u32): f32 {
      data[i] = f32(i % 17 + 1);
      const a = data[i] + data[i];
      write(i);
      const b = data[i] + data[i];
      return a + b;
    }`,
};
const shaders = {},
  sources = {};
for (const [name, body] of Object.entries(bodies)) {
  const source = `"use typeshade";
    declare const data: storage<array<f32>, "read_write">;
    declare const output: storage<array<f32>, "read_write">;
    function stamp(i: u32): void { output[i] = 0.; }
    ${body}
    @compute([64]) export function main(@builtin("global_invocation_id") gid: vec3u): void {
      if (gid.x < ${n}) output[gid.x] = evaluate(gid.x);
    }`;
  sources[name] = source;
  shaders[name] = {};
  for (const [variant, cwd] of [
    ['before', base],
    ['after', root],
  ]) {
    const { compile } = await import(pathToFileURL(join(cwd, 'src/compiler/ts/compile.ts')).href);
    const result = compile(source);
    const errors = result.diagnostics.filter((d) => d.category === 'error');
    if (errors.length || !result.wgsl) throw new Error(JSON.stringify(errors));
    shaders[name][variant] = result.wgsl;
  }
  if (shaders[name].before === shaders[name].after) throw new Error(`${name}: unchanged shader`);
}
shaders.control = { before: shaders.chain.before, after: shaders.chain.before };

async function measure({ shaders, n, samples, warmup, batch }) {
  const adapter = await navigator.gpu.requestAdapter();
  if (
    !adapter ||
    !/swiftshader/i.test(adapter.info.architecture) ||
    !adapter.features.has('timestamp-query')
  )
    throw new Error('Require SwiftShader with timestamps');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const workloads = {},
    results = {},
    validation = {},
    instrument = {};
  const buffer = (size, usage, values) => {
    const b = device.createBuffer({ size, usage, mappedAtCreation: !!values });
    if (values) {
      new Float32Array(b.getMappedRange()).set(values);
      b.unmap();
    }
    return b;
  };
  const queries = device.createQuerySet({ type: 'timestamp', count: 2 });
  const resolved = buffer(16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC);
  const timestamp = buffer(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  for (const [name, variants] of Object.entries(shaders)) {
    workloads[name] = {};
    results[name] = { before: [], after: [] };
    validation[name] = {};
    for (const [variant, code] of Object.entries(variants)) {
      const module = device.createShaderModule({ code });
      const info = await module.getCompilationInfo();
      if (info.messages.some((m) => m.type === 'error'))
        throw new Error(JSON.stringify(info.messages));
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      const data = buffer(
        n * 12 * 4,
        GPUBufferUsage.STORAGE,
        Float32Array.from({ length: n * 12 }, (_, i) => (i % 17) + 1),
      );
      const output = buffer(n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: data } },
          { binding: 1, resource: { buffer: output } },
        ],
      });
      workloads[name][variant] = { pipeline, bind, output };
    }
  }
  const timed = async (work, count) => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass({
      timestampWrites: { querySet: queries, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    });
    pass.setPipeline(work.pipeline);
    pass.setBindGroup(0, work.bind);
    for (let i = 0; i < count; i++) pass.dispatchWorkgroups(n / 64);
    pass.end();
    encoder.resolveQuerySet(queries, 0, 2, resolved, 0);
    encoder.copyBufferToBuffer(resolved, 0, timestamp, 0, 16);
    device.queue.submit([encoder.finish()]);
    await timestamp.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(timestamp.getMappedRange()),
      ms = Number(t[1] - t[0]) / 1e6;
    timestamp.unmap();
    if (!Number.isFinite(ms) || ms <= 0) throw new Error('Invalid timestamp');
    return ms;
  };
  for (let i = 0; i < samples + warmup; i++)
    for (const name of Object.keys(workloads))
      for (const variant of i % 2 ? ['after', 'before'] : ['before', 'after']) {
        const ms = await timed(workloads[name][variant], batch);
        if (i >= warmup) results[name][variant].push(ms);
      }
  for (const [name, variants] of Object.entries(workloads)) {
    for (const [variant, work] of Object.entries(variants)) {
      const read = buffer(n * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(work.output, 0, read, 0, n * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const output = new Float32Array(read.getMappedRange());
      for (let i = 0; i < n; i++) {
        const expected =
          name === 'chain' || name === 'control'
            ? (((i * 12) % 17) + 1) * 3 + (((i * 12 + 11) % 17) + 1)
            : name === 'reads'
              ? ((i % 17) + 1) * 4
              : name === 'loop'
                ? ((i % 17) + 1) * 21
                : ((i % 17) + 1) * 2 + 18;
        if (!Object.is(output[i], expected))
          throw new Error(`${name}/${variant}/${i}: ${output[i]} != ${expected}`);
      }
      validation[name][variant] = { checked: n, mismatches: 0 };
      read.unmap();
      read.destroy();
    }
  }
  for (const variant of ['before', 'after']) {
    instrument[variant] = [];
    for (let j = 0; j < 5; j++)
      instrument[variant].push(await timed(workloads.chain[variant], batch * 4));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  device.destroy();
  return {
    adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture },
    results,
    validation,
    instrument,
  };
}
const measured = await inPage({
  modules: {},
  measure,
  options: { shaders, n, samples, warmup, batch },
});
for (const variant of ['before', 'after'])
  if (median(measured.instrument[variant]) / median(measured.results.chain[variant]) < 2)
    throw new Error('Four-batch sensitivity failed');
const summary = Object.entries(measured.results).map(([name, v]) => ({
  name,
  beforeMs: median(v.before) / batch,
  afterMs: median(v.after) / batch,
  pairedMedianChangePercent: median(v.before.map((t, i) => 100 * (v.after[i] / t - 1))),
}));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const report = {
  recordedAt: new Date().toISOString(),
  n,
  samples,
  warmup,
  batch,
  beforeRevision: git(base, 'rev-parse', 'HEAD'),
  beforeDiff: git(base, 'diff', '--', 'src'),
  afterRevision: git(root, 'rev-parse', 'HEAD'),
  afterDiff: git(root, 'diff', '--', 'src'),
  passSources: Object.fromEntries(
    ['connect-local-calls', 'storage-load-reuse', 'restructure-calls'].map((p) => [
      p,
      readFileSync(join(root, `src/core/passes/${p}.ts`), 'utf8'),
    ]),
  ),
  sources,
  shaders,
  shaderHashes: Object.fromEntries(
    Object.entries(shaders).map(([k, v]) => [
      k,
      Object.fromEntries(
        Object.entries(v).map(([side, text]) => [
          side,
          createHash('sha256').update(text).digest('hex'),
        ]),
      ),
    ]),
  ),
  ...measured,
  summary,
};
writeFileSync(resolve(values.output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
