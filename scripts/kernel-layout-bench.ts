// Compare physical layouts, not a new compiler feature. All kernels use today's lowering.
// Run: TYPESHADE_CHROMIUM=/path/to/chromium bun scripts/kernel-layout-bench.ts --output=file.json
// --software explicitly selects SwiftShader. Without it, record whichever adapter is available.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostFace } from '../src/compiler/ts/host-face.js';
import { packed, readInto, Misfit } from '../src/core/host-entry.js';
import type { KernelFace } from '../src/core/host-kernel.js';

type Variant = 'aos-full' | 'aos-live' | 'soa-full' | 'soa-live';
interface Job {
  variant: Variant;
  reads: number;
  write: boolean;
  fields: number;
  source: string;
  gpu: NonNullable<KernelFace['gpu']>;
}
interface Distribution {
  median: number;
  min: number;
  max: number;
  samples: number[];
}

function distribution(samples: number[]): Distribution {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    samples,
  };
}

function makeJob(variant: Variant, reads: number, write: boolean): Job {
  const fields = variant.endsWith('full') ? 8 : write ? 2 : reads;
  const soa = variant.startsWith('soa');
  const field = (f: number) =>
    soa
      ? f === 0
        ? 'data[i]'
        : `${write ? 'other' : 'data'}[${write ? f - 1 : f} * n + i]`
      : `data[i].f${f}`;
  const source = `"use typeshade";
${soa ? '' : `class Item { ${Array.from({ length: fields }, (_, f) => `f${f}: f32;`).join(' ')} }`}
export function run(data: array<${soa ? 'f32' : 'Item'}>, ${soa && write ? 'other: array<f32>, ' : ''}out: array<f32>, n: u32) {
  for (let i: u32 = 0; i < out.length; i++) {
    ${write ? `${field(0)} = ${field(1)} * 2. + 1.;` : ''}
    out[i] = ${write ? field(0) : Array.from({ length: reads }, (_, f) => field(f)).join(' + ')};
  }
}`;
  const face = hostFace(source, { fileName: 'layout.shade.ts' });
  const errors = face.diagnostics.filter((d) => d.category === 'error');
  if (errors.length) throw new Error(errors.map((d) => d.message).join('\n'));
  const kernel = face.exports?.find((e) => e.kind === 'kernel');
  if (kernel?.kind !== 'kernel' || !kernel.face.gpu)
    throw new Error(
      `The ${variant} read-${reads} write-${write} case did not lower to WebGPU: ` +
        JSON.stringify(face.diagnostics),
    );
  return { variant, fields, reads, write, source, gpu: kernel.face.gpu };
}

/** Each host alternative validates all eight logical fields, including omitted columns.
 * This prototype covers only plain data objects with scalar f32 fields, not general JS objects. */
function validate(rows: Record<string, number>[]): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      throw new Misfit(`[${i}]`, 'not an object');
    for (let f = 0; f < 8; f++)
      if (typeof row[`f${f}`] !== 'number')
        throw new Misfit(`[${i}].f${f}`, 'missing or nonnumeric field');
  }
}

function hostMeasurements(jobs: Job[], sizes: number[], reps: number) {
  const full = jobs.find((j) => j.variant === 'aos-full')!;
  const binding = full.gpu.arrays.find((b) => b.name === 'data')!;
  const results = [];
  let sink = 0;
  const time = (f: () => void) => {
    for (let i = 0; i < 3; i++) f();
    const samples = [];
    for (let i = 0; i < reps; i++) {
      const start = performance.now();
      f();
      samples.push(performance.now() - start);
    }
    return distribution(samples);
  };
  for (const n of sizes) {
    const rows = Array.from({ length: n }, (_, i) =>
      Object.fromEntries(Array.from({ length: 8 }, (_, f) => [`f${f}`, (i % 64) / 8 + f])),
    );
    validate(rows);
    const bad = { ...rows[0]!, f7: 'wrong' };
    let refused = false;
    try {
      validate([bad as unknown as Record<string, number>]);
    } catch (e) {
      refused = e instanceof Misfit && e.path === '[0].f7';
    }
    if (!refused) throw new Error('The host validator missed an invalid omitted field.');
    const validation = time(() => validate(rows));
    const productionPack = time(() => {
      const bytes = packed(binding, rows);
      sink += new DataView(bytes).getFloat32(bytes.byteLength - 4, true);
    });
    for (const fields of [1, 2, 4, 8]) {
      for (const soa of [false, true]) {
        const gather = (): Float32Array => {
          const bytes = new Float32Array(n * fields);
          for (let i = 0; i < n; i++)
            for (let f = 0; f < fields; f++)
              bytes[soa ? f * n + i : i * fields + f] = rows[i]![`f${f}`]!;
          return bytes;
        };
        const bytes = gather();
        for (let i = 0; i < n; i++)
          for (let f = 0; f < fields; f++)
            if (bytes[soa ? f * n + i : i * fields + f] !== Math.fround(rows[i]![`f${f}`]!))
              throw new Error('The host gather changed a value.');
        const gatherTime = time(() => {
          const got = gather();
          sink += got[got.length - 1]!;
        });
        const checkedGather = time(() => {
          validate(rows);
          const got = gather();
          sink += got[got.length - 1]!;
        });
        // A partial write returns only f0; merge into the existing logical objects.
        for (let i = 0; i < n; i++) bytes[soa ? i : i * fields] = Math.fround(rows[i]!.f1! * 2 + 1);
        const merge = time(() => {
          for (let i = 0; i < n; i++) rows[i]!.f0 = bytes[soa ? i : i * fields]!;
        });
        if (rows[n - 1]!.f7 !== ((n - 1) % 64) / 8 + 7)
          throw new Error('Partial writeback changed an untouched field.');
        for (let i = 0; i < n; i++) {
          if (rows[i]!.f0 !== Math.fround(rows[i]!.f1! * 2 + 1))
            throw new Error('Partial writeback did not update f0.');
          rows[i]!.f0 = (i % 64) / 8;
        }
        results.push({
          n,
          fields,
          layout: soa ? 'soa' : 'aos',
          bytes: bytes.byteLength,
          validation,
          gather: gatherTime,
          checkedGather,
          mergeOneField: merge,
        });
      }
    }
    const bytes = packed(binding, rows);
    const productionRead = time(() => void readInto(new DataView(bytes), 0, binding.layout, rows));
    results.push({
      n,
      layout: 'production-aos',
      bytes: bytes.byteLength,
      validation: null,
      packedWithChecks: productionPack,
      readAllFields: productionRead,
    });
  }
  return { results, sink, instrument: 'invalid unused f7 rejected; partial writeback retains f7' };
}

/** This function is serialized into Chromium; keep its runtime dependencies inside it. */
async function gpuMeasurements(input: {
  jobs: Job[];
  sizes: number[];
  reps: number;
  warmup: number;
}) {
  const summary = (samples: number[]): Distribution => {
    const s = [...samples].sort((a, b) => a - b);
    return { median: s[Math.floor(s.length / 2)]!, min: s[0]!, max: s[s.length - 1]!, samples };
  };
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter; no timing result is valid.');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : [],
  });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  device.pushErrorScope('validation');
  const bad = device.createShaderModule({ code: 'not a WGSL program' });
  if (!(await bad.getCompilationInfo()).messages.some((m) => m.type === 'error'))
    throw new Error('The shader compiler failed its rejection probe.');
  await device.popErrorScope();
  const info = adapter.info;
  const metadata = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: info.isFallbackAdapter,
    timestamps,
    userAgent: navigator.userAgent,
    maxStorageBuffers: device.limits.maxStorageBuffersPerShaderStage,
  };
  const results = [];
  let checkedValues = 0;
  let corruptionProbes = 0;
  const value = (i: number, f: number) => (i % 64) / 8 + f;
  const createBuffer = (size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({ size: Math.max(4, size), usage });
  const read = async (buffer: GPUBuffer, bytes: number) => {
    const staging = createBuffer(bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return data;
  };
  try {
    for (const n of input.sizes) {
      for (const workload of [
        { reads: 1, write: false },
        { reads: 4, write: false },
        { reads: 8, write: false },
        { reads: 2, write: true },
      ]) {
        const states = [];
        for (const job of input.jobs.filter(
          (j) => j.reads === workload.reads && j.write === workload.write,
        )) {
          const module = device.createShaderModule({ code: job.gpu.wgsl });
          const messages = (await module.getCompilationInfo()).messages;
          if (messages.some((m) => m.type === 'error')) throw new Error(JSON.stringify(messages));
          const loop = job.gpu.loops[0]!;
          const pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module, entryPoint: loop.entry },
          });
          const soa = job.variant.startsWith('soa');
          const physical = new Float32Array(n * job.fields);
          for (let i = 0; i < n; i++)
            for (let f = 0; f < job.fields; f++)
              physical[soa ? f * n + i : i * job.fields + f] = value(i, f);
          // Separate the written column from readonly columns. Today's loop proof refuses
          // a read at n+i in the same array it writes at i (TS8070), even for disjoint planes.
          const split = soa && job.write;
          const dataBytes = split ? n * 4 : physical.byteLength;
          const data = createBuffer(
            dataBytes,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          );
          const other = split
            ? createBuffer(
                (job.fields - 1) * n * 4,
                GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
              )
            : undefined;
          const out = createBuffer(n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
          const args = job.gpu.args;
          if (args.layout.k !== 'o') throw new Error('Unexpected uniform layout.');
          const uniformBytes = new ArrayBuffer(args.layout.sz);
          const uv = new DataView(uniformBytes);
          for (const [name, offset] of args.layout.f)
            uv.setUint32(offset, name === 'n' || name === '_n' ? n : 0, true);
          const uniform = createBuffer(
            uniformBytes.byteLength,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          );
          device.queue.writeBuffer(data, 0, physical.subarray(0, dataBytes / 4));
          if (other) device.queue.writeBuffer(other, 0, physical.subarray(n));
          device.queue.writeBuffer(uniform, 0, uniformBytes);
          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: args.binding, resource: { buffer: uniform } },
              ...job.gpu.arrays.map((b) => ({
                binding: b.binding,
                resource: { buffer: b.name === 'data' ? data : b.name === 'other' ? other! : out },
              })),
            ],
          });
          const query = timestamps
            ? device.createQuerySet({ type: 'timestamp', count: 2 })
            : undefined;
          const resolved = query
            ? createBuffer(16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC)
            : undefined;
          const queryRead = query
            ? createBuffer(16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
            : undefined;
          const batch = n <= 1024 ? 16 : n <= 65536 ? 4 : 1;
          const wall: number[] = [];
          const gpu: number[] = [];
          const dispatch = async (timed: boolean) => {
            const start = performance.now();
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass(
              query
                ? {
                    timestampWrites: {
                      querySet: query,
                      beginningOfPassWriteIndex: 0,
                      endOfPassWriteIndex: 1,
                    },
                  }
                : {},
            );
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            for (let i = 0; i < batch; i++) pass.dispatchWorkgroups(Math.ceil(n / loop.wg));
            pass.end();
            if (query) {
              encoder.resolveQuerySet(query, 0, 2, resolved!, 0);
              encoder.copyBufferToBuffer(resolved!, 0, queryRead!, 0, 16);
            }
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            const elapsed = (performance.now() - start) / batch;
            if (queryRead) {
              await queryRead.mapAsync(GPUMapMode.READ);
              const ts = new BigUint64Array(queryRead.getMappedRange());
              const ns = Number(ts[1]! - ts[0]!) / batch;
              queryRead.unmap();
              if (!(ns > 0)) throw new Error('Device timing is zero; increase the dispatch batch.');
              if (timed) gpu.push(ns);
            }
            if (timed) wall.push(elapsed);
          };
          const verify = async () => {
            const got = await read(out, n * 4);
            const expect = (i: number) => {
              if (job.write) return value(i, 1) * 2 + 1;
              let sum = 0;
              for (let f = 0; f < job.reads; f++) sum += value(i, f);
              return sum;
            };
            const check = (xs: Float32Array) => {
              for (let i = 0; i < n; i++)
                if (xs[i] !== expect(i)) throw new Error(`Wrong output ${job.variant} at ${i}.`);
            };
            check(got);
            checkedValues += n;
            got[0] = got[0]! + 1;
            let caught = false;
            try {
              check(got);
            } catch {
              caught = true;
            }
            if (!caught) throw new Error('The output comparison missed a corrupt value.');
            corruptionProbes++;
            if (job.write) {
              const changed = new Float32Array(physical.length);
              changed.set(await read(data, dataBytes));
              if (other) changed.set(await read(other, (job.fields - 1) * n * 4), n);
              const checkFields = () => {
                for (let i = 0; i < n; i++)
                  for (let f = 0; f < job.fields; f++) {
                    const at = soa ? f * n + i : i * job.fields + f;
                    if (changed[at] !== (f === 0 ? expect(i) : value(i, f)))
                      throw new Error(`Wrong field ${f} at ${i}.`);
                  }
              };
              checkFields();
              checkedValues += n * job.fields;
              changed[soa ? n : 1] = -99;
              caught = false;
              try {
                checkFields();
              } catch {
                caught = true;
              }
              if (!caught)
                throw new Error('The field comparison missed a corrupt untouched field.');
              corruptionProbes++;
            }
          };
          states.push({
            job,
            dispatch,
            verify,
            wall,
            gpu,
            batch,
            destroy: () =>
              [data, other, out, uniform, resolved, queryRead, query].forEach((x) => x?.destroy()),
          });
        }
        try {
          for (const state of states) {
            for (let i = 0; i < input.warmup; i++) await state.dispatch(false);
            await state.verify();
          }
          // Rotate the first alternative each round instead of timing one layout's full run first.
          for (let rep = 0; rep < input.reps; rep++)
            for (let j = 0; j < states.length; j++)
              await states[(rep + j) % states.length]!.dispatch(true);
          for (const state of states) {
            await state.verify();
            results.push({
              n,
              variant: state.job.variant,
              reads: workload.reads,
              write: workload.write,
              fields: state.job.fields,
              storageBytes: n * (state.job.fields + 1) * 4,
              storageBuffers: state.job.gpu.arrays.length,
              workgroupSize: state.job.gpu.loops[0]!.wg,
              batch: state.batch,
              wallMsPerDispatch: summary(state.wall),
              deviceNsPerDispatch: timestamps ? summary(state.gpu) : null,
            });
          }
        } finally {
          for (const state of states) state.destroy();
        }
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return {
      metadata,
      results,
      checkedValues,
      corruptionProbes,
      instrument: 'invalid WGSL rejected; wrong output and untouched fields rejected',
    };
  } finally {
    device.destroy();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (key: string, fallback: string) =>
    args.find((s) => s.startsWith(`${key}=`))?.slice(key.length + 1) ?? fallback;
  const sizes = option('--sizes', '1024,65536,1048576').split(',').map(Number);
  const reps = Number(option('--reps', '11'));
  if ([...sizes, reps].some((n) => !Number.isSafeInteger(n) || n < 1) || reps < 3)
    throw new Error('Sizes must be positive integers and repetitions at least three.');
  const variants: Variant[] = ['aos-full', 'aos-live', 'soa-full', 'soa-live'];
  const jobs = [
    { reads: 1, write: false },
    { reads: 4, write: false },
    { reads: 8, write: false },
    { reads: 2, write: true },
  ].flatMap((w) => variants.map((v) => makeJob(v, w.reads, w.write)));
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port.');
  const software = args.includes('--software');
  const launchArgs = [
    '--enable-unsafe-webgpu',
    ...(software
      ? [
          '--enable-unsafe-swiftshader',
          '--use-angle=swiftshader',
          '--use-vulkan=swiftshader',
          '--enable-features=Vulkan',
        ]
      : []),
  ];
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
      args: launchArgs,
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    console.log('Measuring WebGPU layouts; compilation and initial uploads are outside timing.');
    const gpu = await page.evaluate(gpuMeasurements, { jobs, sizes, reps, warmup: 3 });
    await browser.close();
    browser = undefined;
    console.log(`Adapter: ${JSON.stringify(gpu.metadata)}`);
    console.log(`Verified ${gpu.checkedValues} values; ${gpu.corruptionProbes} rejection probes.`);
    for (const r of gpu.results)
      console.log(
        `${r.n} ${r.write ? 'write-f0' : `read-${r.reads}`} ${r.variant}: ` +
          `${r.wallMsPerDispatch.median.toFixed(4)} ms wall, ` +
          `${r.deviceNsPerDispatch?.median.toFixed(0) ?? 'unavailable'} ns device, ${r.storageBytes} bytes`,
      );
    console.log('Measuring host validation, gathering and partial writeback.');
    const host = hostMeasurements(jobs, sizes, reps);
    // Record vec3 payload/stride from the same compiler layout that packs a real kernel.
    const vectors = ['pos: vec3; mass: f32;', 'pos: vec3; vel: vec3;'].map((fields) => {
      const source = `"use typeshade"; class P { ${fields} }
export function run(data: array<P>, out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = data[i].pos.x; }
}`;
      const face = hostFace(source, { fileName: 'vec3.shade.ts' });
      const e = face.exports?.find((e) => e.kind === 'kernel');
      if (e?.kind !== 'kernel' || !e.face.gpu)
        throw new Error('The vec3 layout probe did not compile.');
      return { fields, layout: e.face.gpu.arrays.find((b) => b.name === 'data')!.layout };
    });
    const baseBinding = jobs[0]!.gpu.arrays.find((b) => b.name === 'data')!;
    const coldRow = Object.fromEntries(
      Array.from({ length: 8 }, (_, f) => [`f${f}`, f === 7 ? 0.1 : f]),
    );
    const coldHost = [{ ...coldRow }];
    const coldBytes = packed(baseBinding, coldHost);
    readInto(new DataView(coldBytes), 0, baseBinding.layout, coldHost);
    if (coldHost[0]!.f7 !== Math.fround(0.1) || coldHost[0]!.f7 === coldRow.f7)
      throw new Error('The cold-field rounding compatibility probe changed.');
    const report = {
      date: new Date().toISOString(),
      instrumentSha256: createHash('sha256')
        .update(readFileSync(new URL(import.meta.url)))
        .digest('hex'),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      compilerSourceChanges: execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src'], {
        encoding: 'utf8',
      }).trim(),
      runtime: {
        bun: (globalThis as { Bun?: { version: string } }).Bun?.version,
        platform: process.platform,
        arch: process.arch,
      },
      command: process.argv.slice(1),
      launchArgs,
      reps,
      warmup: 3,
      sizes,
      gpu,
      host,
      vectors,
      compatibility: {
        coldF32: {
          input: coldRow.f7,
          fullPackAndReadInto: coldHost[0]!.f7,
          naiveSelectiveCopyback: coldRow.f7,
        },
        conclusion: 'Omitting an untouched field from copyback can change observable f32 rounding.',
      },
      jobs,
    };
    const output = option('--output', 'kernel-layout-results.json');
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`Wrote ${output}`);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

if (import.meta.main) await main();
