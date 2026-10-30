// Compare committed WGSL goldens before/after change 0105 on one SwiftShader device.
// node scripts/bench-copy-elision.mjs [--base REF] [--head REF] [--samples 21]
// Results include raw samples; pipeline creation and readback are outside render timing.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inPage } from '../journeys/_bench.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: '6d61f62a' },
    'base-dir': { type: 'string' },
    head: { type: 'string', default: '72d34e21' },
    samples: { type: 'string', default: '21' },
    warmup: { type: 'string', default: '5' },
    output: { type: 'string', default: 'artifacts/copy-elision-swiftshader.json' },
  },
});
const samples = Number(values.samples),
  warmup = Number(values.warmup);
if (!Number.isInteger(samples) || samples < 3 || !Number.isInteger(warmup) || warmup < 1)
  throw new Error('Require samples >= 3 and warmup >= 1');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const revisions = [
  values['base-dir'] ? `WORKTREE:${resolve(values['base-dir'])}` : values.base,
  values.head,
].map((ref) =>
  ref.startsWith('WORKTREE') ? ref : git('rev-parse', '--verify', `${ref}^{commit}`),
);
const names = ['rt-renderer-class', 'capsule-corp-namek-class'];
const corpus = names.map((name) => ({
  name,
  shaders: revisions.map((ref) => {
    const path = `examples/__emit-goldens__/${name}.wgsl`;
    const code =
      ref === 'WORKTREE'
        ? readFileSync(path, 'utf8')
        : ref.startsWith('WORKTREE:')
          ? readFileSync(join(ref.slice('WORKTREE:'.length), path), 'utf8')
          : git('show', `${ref}:${path}`);
    return { code, sha256: createHash('sha256').update(code).digest('hex') };
  }),
}));

async function measure({ corpus, samples, warmup }) {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const info = adapter.info;
  const adapterInfo = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
  if (!/swiftshader/i.test(JSON.stringify(adapterInfo))) throw new Error('Expected SwiftShader');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : [],
  });
  const errors = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  device.pushErrorScope('validation');
  const broken = device.createShaderModule({ code: 'this is deliberately invalid WGSL' });
  if (!(await broken.getCompilationInfo()).messages.some((m) => m.type === 'error'))
    throw new Error('Compile instrument missed invalid WGSL');
  await device.popErrorScope();
  const difference = (a, b) => {
    if (a.length !== b.length) throw new Error('Pixel lengths differ');
    let bytes = 0,
      maxDelta = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) bytes++;
      maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i]));
    }
    return { differingBytes: bytes, maxChannelDelta: maxDelta };
  };
  if (difference([0, 1], [0, 2]).differingBytes !== 1) throw new Error('Pixel instrument failed');
  const rows = [];
  for (const item of corpus) {
    const pipelines = [],
      pipelineMs = [];
    for (const shader of item.shaders) {
      device.pushErrorScope('validation');
      const started = performance.now();
      const module = device.createShaderModule({ code: shader.code });
      const messages = (await module.getCompilationInfo()).messages;
      if (messages.some((m) => m.type === 'error')) throw new Error(JSON.stringify(messages));
      pipelines.push(
        await device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: {
            module,
            entryPoint: item.name === 'rt-renderer-class' ? 'fs' : 'main',
            targets: [{ format: 'rgba8unorm' }],
          },
          primitive: { topology: 'triangle-list' },
        }),
      );
      pipelineMs.push(performance.now() - started);
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
    }
    for (const size of [48, 96]) {
      device.pushErrorScope('validation');
      const uniform = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const groups = pipelines.map((p) =>
        device.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uniform } }],
        }),
      );
      const texture = device.createTexture({
        size: [size, size],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const view = texture.createView();
      const stride = Math.ceil((size * 4) / 256) * 256;
      const pixels = device.createBuffer({
        size: stride * size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const query = timestamps ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
      const resolved = timestamps
        ? device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          })
        : null;
      const readTime = timestamps
        ? device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          })
        : null;
      function setFrame(time) {
        const data =
          item.name === 'rt-renderer-class'
            ? [size, size, time, 0, 0, 0, 0, 0]
            : [time, 0, size, size, 0, 0, 0, 0];
        device.queue.writeBuffer(uniform, 0, new Float32Array(data));
      }
      async function render(index, readPixels = false) {
        const start = performance.now();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
          ...(query
            ? {
                timestampWrites: {
                  querySet: query,
                  beginningOfPassWriteIndex: 0,
                  endOfPassWriteIndex: 1,
                },
              }
            : {}),
        });
        pass.setPipeline(pipelines[index]);
        pass.setBindGroup(0, groups[index]);
        pass.draw(3);
        pass.end();
        if (query) {
          encoder.resolveQuerySet(query, 0, 2, resolved, 0);
          encoder.copyBufferToBuffer(resolved, 0, readTime, 0, 16);
        }
        if (readPixels)
          encoder.copyTextureToBuffer({ texture }, { buffer: pixels, bytesPerRow: stride }, [
            size,
            size,
          ]);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        const wallMs = performance.now() - start;
        let gpuMs = null;
        if (readTime) {
          await readTime.mapAsync(GPUMapMode.READ);
          const ts = new BigUint64Array(readTime.getMappedRange());
          gpuMs = Number(ts[1] - ts[0]) / 1e6;
          readTime.unmap();
          if (!(gpuMs > 0)) throw new Error('Nonpositive timestamp');
        }
        if (readPixels) {
          await pixels.mapAsync(GPUMapMode.READ);
          const raw = new Uint8Array(pixels.getMappedRange());
          const packed = new Uint8Array(size * size * 4);
          for (let y = 0; y < size; y++)
            packed.set(raw.subarray(y * stride, y * stride + size * 4), y * size * 4);
          pixels.unmap();
          return packed;
        }
        return { wallMs, gpuMs };
      }
      const correctness = [];
      for (const time of [0, 1.25, 3]) {
        setFrame(time);
        const before = await render(0, true),
          after = await render(1, true),
          repeated = await render(1, true);
        const diff = difference(before, after),
          repeat = difference(after, repeated);
        const colors = new Set();
        for (let i = 0; i < after.length; i += 4) colors.add(after.slice(i, i + 4).join(','));
        if (colors.size < 2 || repeat.differingBytes)
          throw new Error('Blank or nondeterministic render');
        correctness.push({
          time,
          ...diff,
          repeatDifferingBytes: repeat.differingBytes,
          distinctColors: colors.size,
        });
      }
      setFrame(1.25);
      await device.queue.onSubmittedWorkDone();
      for (let i = 0; i < warmup; i++)
        for (const index of i % 2 ? [1, 0] : [0, 1]) await render(index);
      const timings = [[], []];
      for (let i = 0; i < samples; i++)
        for (const index of i % 2 ? [1, 0] : [0, 1]) timings[index].push(await render(index));
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
      rows.push({ name: item.name, size, pipelineMs, correctness, timings });
      uniform.destroy();
      texture.destroy();
      pixels.destroy();
      query?.destroy();
      resolved?.destroy();
      readTime?.destroy();
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  device.destroy();
  return { adapter: adapterInfo, timestampQuery: timestamps, userAgent: navigator.userAgent, rows };
}
const result = await inPage({ modules: {}, measure, options: { corpus, samples, warmup } });
const median = (a) => {
  const s = [...a].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
};
for (const row of result.rows) {
  row.summary = ['wallMs', 'gpuMs']
    .filter((key) => row.timings[0][0][key] !== null)
    .map((metric) => {
      const stats = row.timings.map((ts) => {
        const xs = ts.map((t) => t[metric]),
          mid = median(xs);
        return {
          median: mid,
          min: Math.min(...xs),
          max: Math.max(...xs),
          mad: median(xs.map((x) => Math.abs(x - mid))),
        };
      });
      return {
        metric,
        before: stats[0],
        after: stats[1],
        changePercent: (stats[1].median / stats[0].median - 1) * 100,
      };
    });
}
const report = {
  recordedAt: new Date().toISOString(),
  revisions,
  samples,
  warmup,
  cpu: cpus()[0]?.model,
  cpuCount: cpus().length,
  shaders: corpus.map(({ name, shaders }) => ({ name, sha256: shaders.map((s) => s.sha256) })),
  ...result,
};
mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      output: values.output,
      adapter: report.adapter,
      rows: report.rows.map(({ name, size, correctness, summary }) => ({
        name,
        size,
        correctness,
        summary,
      })),
    },
    null,
    2,
  ),
);
if (result.rows.some((row) => row.correctness.some((c) => c.differingBytes))) process.exitCode = 1;
