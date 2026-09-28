// ═══ The GPU differential: generated programs on WebGPU and WebGL2 against the f32 oracle (#349) ═══
//
// WHAT IT PROVES. `src/core/testing/random-kernel-differential.test.ts` holds each generated kernel
// function's lowered plan to the function on the f32 oracle, with the plan run on the oracle too.
// This gate runs the same plans on a GPU: each plan's WGSL is compiled by Tint in Chromium's
// WebGPU, dispatched step for step as `callKernel` does (`scheduleKernelPlan`), and every array the
// function writes, and its result, is compared with the kernel function run on the f32 oracle.
//
// BIT FOR BIT. The corpus is `generateKernelModule(seed, { exact: true })`: only the operations
// the determinism report (`src/core/passes/determinism.ts`, Rule 11.5) gives one answer on every
// target. The report lists nothing for these programs but `order` rows, a float reduction that
// every tier folds in Rule 7.2's one tree, so a GPU must write the oracle's values exactly. Two
// kinds of value carry no claim, and are left out of the comparison: one the oracle computes as
// NaN or an infinity (WGSL §15.7.2 lets a GPU produce another value there), and a subnormal f32,
// which a GPU may flush to zero (§15.7.3). A zero's sign carries no claim either: for `min(0, -0)`
// SwiftShader, the oracle and the spec's formula give three answers. The inputs are finite
// normal values.
//
// IN ANY GROUPING. WGSL lets a driver reassociate arithmetic (§15.7.5), and SwiftShader groups
// two constants across the operation between them: `3.5 + (0.001 - x)` came back as
// `(3.5 + 0.001) - x`, 1 ULP from the oracle, and `(x + 1e8) - 1e8` as `x` (#378). So the
// corpus's float literals and inputs are small dyadic numbers (a multiple of 1/8, 11 bits at
// most), whose sums and products round in no grouping, and a value the f32 oracle rounds anyway
// (it differs from the f64 oracle's) carries no claim and is counted apart. The count must stay
// under a tenth of the values compared, or the corpus says too little.
//
// THE GLSL ARM. The same run draws the functions of `generateModule(seed, { exact: true })` on
// WebGL2, in the context the compile gate uses. Each function is drawn through `drawnFunction`
// (`src/core/testing/draw-harness.ts`): a `@fragment` entry whose every pixel reads its own
// arguments from a uniform table and writes the bits of the function's result into an `RGBA32UI`
// target. Every pixel is compared with the function on the f32 oracle, bit for bit, with the same
// values left out. One more kind of value carries no claim on GLSL: one that an input GLSL ES 3.00
// leaves undefined reached. Those inputs are an integer `/` or `%` by zero, a `%` with a negative
// operand, and a float that does not fit the integer it converts to. There a driver answers
// otherwise than WGSL and the oracle (#382). The harness's taint finds those runs on the oracle,
// and they are counted apart.
//
// WHY IT CANNOT BE VACUOUSLY GREEN (AGENTS.md#gate-discipline):
//
//   1. WebGPU and WebGL2 must be reachable: no adapter, device or context fails the gate.
//   2. Tint and the GLSL compiler must each REPORT a shader that is not a program before any
//      verdict is believed.
//   3. The corpus must reach what the claim is about. For WebGPU: plans that lower, a reduction
//      folded a level, a scatter's atomics, a struct array's layout, and a report with no row but
//      `order`. For WebGL2: the constructs the drift between the targets lived in (`DRAW_FLOORS`),
//      a report with no row, and enough values compared.
//   4. Each arm also runs one case wrong on purpose, and the comparison must report it: a plan
//      dispatched with its first iteration skipped, and a table uploaded a row off.
//
// Usage:  bun scripts/gpu-differential.ts            (from the package root)
//         TYPESHADE_CHROMIUM=/path/to/headless_shell bun scripts/gpu-differential.ts
//         TYPESHADE_DIFF_SEEDS=400 bun scripts/gpu-differential.ts   (a longer sweep, to hunt)

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Page } from 'playwright';
import { compileModuleJs } from '../src/core/cpu-codegen.js';
import type { CpuStruct, CpuValue } from '../src/core/cpu-runtime.js';
import type { PackLayout } from '../src/core/manifest-types.js';
import { buildManifest } from '../src/core/manifest.js';
import { compileModule, type CpuModule } from '../src/core/oracle.js';
import { determinismReport } from '../src/core/passes/determinism.js';
import { lowerKernel, type KernelPlan } from '../src/core/passes/kernel-lower.js';
import { proveKernels } from '../src/core/passes/parallel-loop.js';
import {
  copy,
  runKernelPlan,
  scheduleKernelPlan,
  tailOf,
  type PlanFault,
  type PlanSchedule,
} from '../src/core/testing/kernel-plan.js';
import {
  drawnFunction,
  pixelValue,
  tableWords,
  taintedName,
  taintGlslUndefined,
  type DrawnFunction,
} from '../src/core/testing/draw-harness.js';
import {
  describeCorpus,
  generateKernelModule,
  generateModule,
  type Corpus,
  mulberry32,
  type KernelCorpus,
} from '../src/core/testing/random-ir.js';
import { emitGlslModule, emitModule } from '../src/index.js';
import type { ShaderType, StructDecl } from '../src/index.js';

/** The flags that make WebGPU exist on SwiftShader, as the compile gate launches it. */
const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
  '--enable-features=Vulkan',
];

const SEEDS = Number(process.env['TYPESHADE_DIFF_SEEDS'] ?? 48);
/** `[n, h]`: every array but a scatter target holds `n`, a scatter target `h`. 5000 folds a
 *  reduction's 20 partials a level. */
const SIZES = [
  [1, 1],
  [7, 3],
  [300, 13],
  [5000, 29],
] as const;

// ─── the jobs ────────────────────────────────────────────────────────────────────────────────

/** One buffer of a job, its bytes as 32-bit words, so a float crosses to the page bit for bit. */
interface JobBuffer {
  readonly binding: number;
  readonly kind: 'uniform' | 'read-only-storage' | 'storage';
  readonly words: readonly number[];
  readonly read: boolean;
}

/** What the page runs: a plan's WGSL, its buffers, the bindings each entry reaches (its bind
 *  group, as `callKernel` makes one per entry), and each dispatch with its uniform's words. */
interface Job {
  readonly id: string;
  readonly wgsl: string;
  readonly buffers: readonly JobBuffer[];
  readonly entries: Readonly<Record<string, readonly number[]>>;
  readonly steps: readonly {
    readonly entry: string;
    readonly wg: readonly [number, number, number];
    readonly uniform: readonly number[];
  }[];
}

interface JobResult {
  readonly id: string;
  readonly error?: string;
  /** Each read buffer's words, by binding. */
  readonly read?: Readonly<Record<number, readonly number[]>>;
}

/** A call of one generated kernel function, its plan and schedule, and the oracle's answer. */
interface Case {
  readonly c: KernelCorpus;
  readonly key: string;
  readonly plan: KernelPlan;
  readonly args: readonly CpuValue[];
  readonly schedule: PlanSchedule;
  readonly want: Outcome;
  /** The same call on the f64 oracle: where a value differs from `want`'s, the f32 run rounded
   *  it, and a driver that groups the arithmetic otherwise may round it otherwise (#378). */
  readonly exact: Outcome;
  readonly job: Job;
}

interface Outcome {
  readonly result: CpuValue | undefined;
  readonly arrays: readonly CpuValue[];
}

/** A finite, normal f32 or zero: the half of the pool at the boundaries, the rest spread. A
 *  float is a multiple of 1/8 below 100 in magnitude, 11 bits at most, so that a sum or a product
 *  of two rounds in no order (#378). */
function scalarOf(s: string, rnd: () => number, boundary: boolean): number {
  if (s === 'i32') {
    const pool = [0, 1, -1, 2, -2147483648, 2147483647, 255, -7];
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : (Math.floor(rnd() * 4e9) - 2e9) | 0;
  }
  if (s === 'u32') {
    const pool = [0, 1, 2, 4294967295, 2147483648, 255];
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : Math.floor(rnd() * 4294967296) >>> 0;
  }
  const pool = [0, -0, 1, -1, 0.5, 2, 1000, -1000];
  return boundary ? pool[Math.floor(rnd() * pool.length)]! : Math.round((rnd() - 0.5) * 1600) / 8;
}

function valueOf(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
  rnd: () => number,
  boundary: boolean,
): CpuValue {
  if (t.kind === 'scalar') return scalarOf(t.scalar, rnd, boundary);
  if (t.kind === 'vec') return Array.from({ length: t.n }, () => scalarOf(t.elem, rnd, boundary));
  if (t.kind === 'struct')
    return Object.fromEntries(
      structs.get(t.name)!.fields.map((f) => [f.name, valueOf(f.type, structs, rnd, boundary)]),
    );
  throw new Error(`no generated value of ${t.kind}`);
}

function argsOf(c: KernelCorpus, n: number, h: number, boundary: boolean): CpuValue[] {
  const rnd = mulberry32(c.seed * 7919 + n * 31 + h + (boundary ? 1 : 0));
  const structs = new Map(c.module.structs.map((s) => [s.name, s]));
  const f = c.module.funcs.find((x) => x.name === c.kernel)!;
  return f.params.map((p) => {
    if (p.type.kind !== 'array') return valueOf(p.type, structs, rnd, boundary);
    const elem = p.type.elem;
    const length = c.arrays.find((a) => a.name === p.name)!.role === 'scatter' ? h : n;
    return Array.from({ length }, () =>
      valueOf(elem, structs, rnd, boundary),
    ) as unknown as CpuValue;
  });
}

// ─── bytes, by the manifest's layouts ─────────────────────────────────────────────────────────

function sizeOf(l: PackLayout, v: CpuValue): number {
  switch (l.kind) {
    case 'scalar':
      return 4;
    case 'vector':
      return 4 * l.size;
    case 'array':
      return (l.length ?? (v as unknown[]).length) * l.stride;
    case 'struct':
      return l.size;
    case 'matrix':
      return l.columns * l.columnStride;
  }
}

function packInto(dv: DataView, at: number, l: PackLayout, v: CpuValue): void {
  const write = (o: number, t: string, x: number): void => {
    if (t === 'f32') dv.setFloat32(o, x, true);
    else if (t === 'i32') dv.setInt32(o, x, true);
    else if (t === 'u32') dv.setUint32(o, x, true);
    else throw new Error(`gpu-differential: no ${t} in a generated buffer`);
  };
  switch (l.kind) {
    case 'scalar':
      write(at, l.type, v as number);
      return;
    case 'vector':
      (v as number[]).forEach((x, j) => write(at + 4 * j, l.type, x));
      return;
    case 'array':
      (v as unknown as CpuValue[]).forEach((e, i) => packInto(dv, at + i * l.stride, l.element, e));
      return;
    case 'struct':
      for (const f of l.fields) packInto(dv, at + f.offset, f.layout, (v as CpuStruct)[f.name]!);
      return;
    case 'matrix':
      throw new Error('gpu-differential: no matrix in a generated buffer');
  }
}

function unpack(dv: DataView, at: number, l: PackLayout, count: number): CpuValue {
  const read = (o: number, t: string): number =>
    t === 'f32'
      ? dv.getFloat32(o, true)
      : t === 'i32'
        ? dv.getInt32(o, true)
        : dv.getUint32(o, true);
  switch (l.kind) {
    case 'scalar':
      return read(at, l.type);
    case 'vector':
      return Array.from({ length: l.size }, (_, j) => read(at + 4 * j, l.type));
    case 'array':
      return Array.from({ length: l.length ?? count }, (_, i) =>
        unpack(dv, at + i * l.stride, l.element, 0),
      ) as unknown as CpuValue;
    case 'struct':
      return Object.fromEntries(
        l.fields.map((f) => [f.name, unpack(dv, at + f.offset, f.layout, 0)]),
      );
    case 'matrix':
      throw new Error('gpu-differential: no matrix in a generated buffer');
  }
}

/** `v` packed by `l` as 32-bit words, in a buffer of at least `min` bytes. */
function wordsOf(l: PackLayout, v: CpuValue, min = 4): number[] {
  const bytes = Math.max(min, sizeOf(l, v));
  const buf = new ArrayBuffer(Math.ceil(bytes / 4) * 4);
  packInto(new DataView(buf), 0, l, v);
  return [...new Uint32Array(buf)];
}

const viewOf = (words: readonly number[]): DataView => new DataView(Uint32Array.from(words).buffer);

// ─── building a case ─────────────────────────────────────────────────────────────────────────

function caseOf(
  c: KernelCorpus,
  plan: KernelPlan,
  args: readonly CpuValue[],
  key: string,
  fault?: PlanFault,
): Case {
  const f = c.module.funcs.find((x) => x.name === c.kernel)!;
  const manifest = buildManifest(plan.module);
  const bindingOf = (name: string) => {
    const b = manifest.bindings.find((x) => x.name === name);
    if (b?.layout === undefined) throw new Error(`gpu-differential: no layout for "${name}"`);
    if (b.group !== 0) throw new Error(`gpu-differential: "${name}" is not in group 0`);
    return b as typeof b & { layout: PackLayout };
  };
  const schedule = scheduleKernelPlan(c.module, c.kernel, plan, args, fault);
  const uniform = bindingOf(plan.argsBinding);
  const buffers: JobBuffer[] = [
    {
      binding: uniform.binding,
      kind: 'uniform',
      words: new Array<number>(
        Math.ceil(uniform.layout.kind === 'struct' ? uniform.layout.size / 4 : 1),
      ).fill(0),
      read: false,
    },
  ];
  f.params.forEach((p, i) => {
    if (p.type.kind !== 'array') return;
    const b = bindingOf(p.name);
    buffers.push({
      binding: b.binding,
      kind: b.access === 'read_write' ? 'storage' : 'read-only-storage',
      words: wordsOf(b.layout, args[i]!),
      read: b.access === 'read_write',
    });
  });
  for (const part of schedule.partials) {
    const b = bindingOf(part.binding);
    const stride = b.layout.kind === 'array' ? b.layout.stride : 4;
    buffers.push({
      binding: b.binding,
      kind: 'storage',
      words: new Array<number>((part.slots * stride) / 4).fill(0),
      read: true,
    });
  }
  const outcome = (precision: 'f32' | 'f64'): Outcome => {
    const values = args.map(copy);
    const result = compileModule(c.module, { precision }).fns[c.kernel]!(...values);
    return { result, arrays: values.filter((_, i) => f.params[i]!.type.kind === 'array') };
  };
  const entries: Record<string, number[]> = {};
  for (const e of manifest.entries)
    entries[e.name] = (e.bindings ?? []).map((b) => bindingOf(b.name).binding);
  return {
    c,
    key,
    plan,
    args,
    schedule,
    want: outcome('f32'),
    exact: outcome('f64'),
    job: {
      id: key,
      wgsl: emitModule(plan.module),
      buffers,
      entries,
      steps: schedule.steps.map((s) => ({
        entry: s.entry,
        wg: s.workgroups,
        uniform: wordsOf(
          uniform.layout,
          s.args as unknown as CpuValue,
          uniform.layout.kind === 'struct' ? uniform.layout.size : 4,
        ),
      })),
    },
  };
}

/** What the GPU wrote, read back into the arrays and the result the call returns. */
function gotOf(k: Case, r: JobResult): { result: CpuValue | undefined; arrays: CpuValue[] } {
  const f = k.c.module.funcs.find((x) => x.name === k.c.kernel)!;
  const manifest = buildManifest(k.plan.module);
  const layoutOf = (name: string) => manifest.bindings.find((b) => b.name === name)!;
  const arrays: CpuValue[] = [];
  f.params.forEach((p, i) => {
    if (p.type.kind !== 'array') return;
    const b = layoutOf(p.name);
    const n = (k.args[i] as unknown[]).length;
    arrays.push(
      b.access === 'read_write'
        ? unpack(viewOf(r.read![b.binding]!), 0, b.layout!, n)
        : copy(k.args[i]!),
    );
  });
  const folded = k.schedule.folds.map((x) => {
    if ('identity' in x) return x.identity;
    const b = layoutOf(x.binding);
    const l = b.layout!;
    const stride = l.kind === 'array' ? l.stride : 4;
    const element = l.kind === 'array' ? l.element : l;
    return unpack(viewOf(r.read![b.binding]!), x.at * stride, element, 0);
  });
  return { result: tailOf(k.c.module, k.c.kernel, k.plan, k.args, folded), arrays };
}

// ─── the comparison ──────────────────────────────────────────────────────────────────────────

/** A value WGSL lets a GPU compute otherwise: NaN, an infinity, or an f32 subnormal. */
const noClaim = (x: number): boolean => !Number.isFinite(x) || (x !== 0 && Math.abs(x) < 2 ** -126);

/** How many values a comparison held to the oracle, and how many it left out because the f32
 *  oracle rounded them. */
interface Tally {
  compared: number;
  rounded: number;
}

/** The first place `got` differs from `want`, bit for bit, where WGSL makes a claim. With `exact`,
 *  the f64 oracle's answer, a value the f32 run rounded carries no claim: WGSL lets a driver
 *  reassociate (§15.7.5), and the arithmetic it groups otherwise rounds otherwise (#378). */
function firstDifference(
  want: unknown,
  got: unknown,
  path: string,
  exact?: unknown,
  tally?: Tally,
): string | undefined {
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length)
      return `${path}: ${JSON.stringify(want).slice(0, 80)} ≠ ${JSON.stringify(got).slice(0, 80)}`;
    for (let i = 0; i < want.length; i++) {
      const at = exact === undefined ? undefined : (exact as unknown[])[i];
      const d = firstDifference(want[i], got[i], `${path}[${String(i)}]`, at, tally);
      if (d !== undefined) return d;
    }
    return undefined;
  }
  if (typeof want === 'object' && want !== null) {
    for (const [k, v] of Object.entries(want)) {
      const at = exact === undefined ? undefined : (exact as Record<string, unknown>)[k];
      const d = firstDifference(v, (got as Record<string, unknown>)[k], `${path}.${k}`, at, tally);
      if (d !== undefined) return d;
    }
    return undefined;
  }
  if (typeof want === 'number' && typeof exact === 'number' && want !== exact) {
    if (tally !== undefined) tally.rounded += 1;
    return undefined;
  }
  if (tally !== undefined) tally.compared += 1;
  // A zero's sign carries no claim: SwiftShader's `min(0, -0)` is -0 and the oracle's and the
  // spec's formula each give another answer (#349), and a sign never reaches a nonzero value in
  // this corpus, which divides by no float.
  if (want === 0 && got === 0) return undefined;
  if (typeof want === 'number' && noClaim(want)) {
    // A subnormal may be flushed to a zero of either sign; NaN and infinities carry no claim.
    if (Number.isFinite(want) && typeof got === 'number' && got === 0) return undefined;
    if (!Number.isFinite(want)) return undefined;
  }
  return Object.is(want, got) ? undefined : `${path}: oracle ${String(want)} ≠ gpu ${String(got)}`;
}

// ─── the page ────────────────────────────────────────────────────────────────────────────────

/** A page on loopback, a secure context, so `navigator.gpu` exists. */
function serve(): Promise<Server> {
  return new Promise((resolveServer) => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>typeshade gpu differential</title>');
    });
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

/** Runs INSIDE the browser: plain WebGPU, nothing from this package. The device is kept on the
 *  page between calls. */
async function runInPage(input: {
  jobs: Job[];
  broken?: string;
}): Promise<{ adapter: string; brokenReported?: boolean; results: JobResult[] }> {
  const g = globalThis as unknown as { __device?: GPUDevice; __adapter?: string };
  if (g.__device === undefined) {
    if (!('gpu' in navigator) || navigator.gpu === undefined)
      throw new Error('navigator.gpu is absent: WebGPU is not reachable in this browser');
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) throw new Error('requestAdapter() returned null: no WebGPU adapter');
    g.__device = await adapter.requestDevice();
    const info = adapter.info;
    g.__adapter = `${info.vendor || '?'} / ${info.architecture || '?'} / ${info.description || info.device || '?'}`;
  }
  const device = g.__device;
  let brokenReported: boolean | undefined;
  if (input.broken !== undefined) {
    const m = device.createShaderModule({ code: input.broken });
    brokenReported = (await m.getCompilationInfo()).messages.some((x) => x.type === 'error');
  }
  const results: JobResult[] = [];
  for (const job of input.jobs) {
    device.pushErrorScope('validation');
    const made: GPUBuffer[] = [];
    try {
      const module = device.createShaderModule({ code: job.wgsl });
      const errors = (await module.getCompilationInfo()).messages
        .filter((x) => x.type === 'error')
        .map((x) => `${String(x.lineNum)}:${String(x.linePos)} ${x.message}`);
      if (errors.length > 0) {
        await device.popErrorScope();
        results.push({ id: job.id, error: `Tint: ${errors.join('; ')}` });
        continue;
      }
      // A buffer is exactly its bytes: WGSL's `arrayLength` is the bound size over the stride, so a
      // padded buffer would lengthen every runtime-sized array (#367).
      const buffers = job.buffers.map((b) => {
        const size = Math.max(4, b.words.length * 4);
        const usage =
          (b.kind === 'uniform' ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC;
        const buffer = device.createBuffer({ size, usage });
        made.push(buffer);
        device.queue.writeBuffer(buffer, 0, new Uint32Array(b.words));
        return buffer;
      });
      // Each entry's own bind group, of the bindings it reaches: every buffer at once would pass
      // the limit of eight storage buffers a stage may bind.
      const run = new Map<string, { pipeline: GPUComputePipeline; group: GPUBindGroup }>();
      for (const s of job.steps) {
        if (run.has(s.entry)) continue;
        const reached = job.buffers.flatMap((b, i) =>
          job.entries[s.entry]!.includes(b.binding) ? [{ b, buffer: buffers[i]! }] : [],
        );
        const bgl = device.createBindGroupLayout({
          entries: reached.map(({ b }) => ({
            binding: b.binding,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: b.kind },
          })),
        });
        const pipeline = device.createComputePipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
          compute: { module, entryPoint: s.entry },
        });
        const group = device.createBindGroup({
          layout: bgl,
          entries: reached.map(({ b, buffer }) => ({ binding: b.binding, resource: { buffer } })),
        });
        run.set(s.entry, { pipeline, group });
      }
      const u = job.buffers.findIndex((b) => b.kind === 'uniform');
      for (const s of job.steps) {
        device.queue.writeBuffer(buffers[u]!, 0, new Uint32Array(s.uniform));
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(run.get(s.entry)!.pipeline);
        pass.setBindGroup(0, run.get(s.entry)!.group);
        pass.dispatchWorkgroups(s.wg[0], s.wg[1], s.wg[2]);
        pass.end();
        device.queue.submit([encoder.finish()]);
      }
      const reads = job.buffers.flatMap((b, i) => (b.read ? [{ b, buffer: buffers[i]! }] : []));
      const staging = reads.map(({ buffer }) => {
        const s = device.createBuffer({
          size: buffer.size,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        made.push(s);
        return s;
      });
      const encoder = device.createCommandEncoder();
      reads.forEach(({ buffer }, k) =>
        encoder.copyBufferToBuffer(buffer, 0, staging[k]!, 0, buffer.size),
      );
      device.queue.submit([encoder.finish()]);
      await Promise.all(staging.map((s) => s.mapAsync(GPUMapMode.READ)));
      const read: Record<number, number[]> = {};
      reads.forEach(({ b }, k) => {
        read[b.binding] = Array.from(new Uint32Array(staging[k]!.getMappedRange().slice(0)));
        staging[k]!.unmap();
      });
      const scope = await device.popErrorScope();
      results.push(
        scope === null
          ? { id: job.id, read }
          : { id: job.id, error: `validation: ${scope.message}` },
      );
    } catch (e) {
      await device.popErrorScope();
      results.push({ id: job.id, error: `threw: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      for (const b of made) b.destroy();
    }
  }
  return {
    adapter: g.__adapter ?? '?',
    ...(brokenReported !== undefined ? { brokenReported } : {}),
    results,
  };
}

// ─── the GLSL arm: generated functions drawn on WebGL2 ────────────────────────────────────────

/** A draw's size: one argument list per pixel. */
const DRAW_W = 16;
const DRAW_H = 8;

/** What the page draws: a generated function's GLSL fragment program, and its table's words. */
interface DrawJob {
  readonly id: string;
  readonly frag: string;
  readonly width: number;
  readonly height: number;
  readonly words: readonly number[];
}

interface DrawResult {
  readonly id: string;
  readonly error?: string;
  /** The target's texels, four words each, as `readPixels` returns them. */
  readonly words?: readonly number[];
}

/** One generated function drawn once, with the oracle's answer at each pixel. */
interface DrawCase {
  readonly key: string;
  readonly c: Corpus;
  readonly d: DrawnFunction;
  readonly args: readonly (readonly CpuValue[])[];
  readonly want: readonly CpuValue[];
  /** The f64 oracle's answer at each pixel: where it differs from `want`'s, the f32 run rounded. */
  readonly exact: readonly CpuValue[];
  /** Whether each pixel's run reached an input GLSL ES 3.00 leaves undefined (#382). */
  readonly undefinedOnGlsl: readonly boolean[];
  /** Why the GLSL writer refused the module, when it did: then there is nothing to draw. */
  readonly refused?: string;
  readonly job: DrawJob;
}

/** Each function of `c` drawn once, the oracle run at every pixel. The oracle is the generated
 *  CPU code, which `random-ir-differential.test.ts` holds to the interpreter bit for bit. With
 *  `rowOff`, the page gets each pixel the next pixel's arguments: a table uploaded wrong. */
function drawCasesOf(c: Corpus, rowOff = false): DrawCase[] {
  const f32 = compileModuleJs(c.module, { precision: 'f32' });
  const f64 = compileModuleJs(c.module, { precision: 'f64' });
  const taint = compileModuleJs(taintGlslUndefined(c.module), { precision: 'f32' });
  return c.module.funcs.map((f, i) => {
    const d = drawnFunction(c.module, f.name, DRAW_W, DRAW_H);
    const rnd = mulberry32(c.seed * 7919 + i * 31);
    const args = Array.from({ length: DRAW_W * DRAW_H }, (_, p) =>
      f.params.map((q) => valueOf(q.type, new Map(), rnd, p % 2 === 0)),
    );
    const run = (m: CpuModule, name: string): CpuValue[] =>
      args.map((xs) => m.fns[name]!(...xs.map(copy)));
    const sent = rowOff ? args.map((_, p) => args[(p + 1) % args.length]!) : args;
    const key = `seed ${String(c.seed)} ${f.name}${rowOff ? ' (a row off)' : ''}`;
    let frag = '';
    let refused: string | undefined;
    try {
      frag = emitGlslModule(d.module, 'fragment');
    } catch (e) {
      refused = `the GLSL writer refused it: ${e instanceof Error ? e.message : String(e)}`;
    }
    return {
      key,
      c,
      d,
      args,
      want: run(f32, f.name),
      exact: run(f64, f.name),
      undefinedOnGlsl: run(taint, taintedName(f.name)).map((x) => x === 1),
      ...(refused !== undefined ? { refused } : {}),
      job: { id: key, frag, width: DRAW_W, height: DRAW_H, words: tableWords(d, sent) },
    };
  });
}

/** How many values a draw's comparison held to the oracle, left out because the f32 oracle
 *  rounded them, and left out because an input GLSL leaves undefined reached them (#382). */
interface DrawTally extends Tally {
  undefinedOnGlsl: number;
}

/** The first pixel where the draw differs from the oracle, bit for bit, where it makes a claim. */
function drawDifference(
  k: DrawCase,
  r: DrawResult | undefined,
  tally?: DrawTally,
): string | undefined {
  if (k.refused !== undefined) return k.refused;
  if (r === undefined) return 'the page returned no result';
  if (r.error !== undefined) return r.error;
  const words = r.words!;
  for (let p = 0; p < k.want.length; p++) {
    if (k.undefinedOnGlsl[p]!) {
      if (tally !== undefined) tally.undefinedOnGlsl += [k.want[p]].flat().length;
      continue;
    }
    const got = pixelValue(k.d.fn.ret, words.slice(4 * p, 4 * p + 4));
    const at = `${k.d.fn.name}(${k.args[p]!.map((x) => JSON.stringify(x)).join(', ')})`;
    const diff = firstDifference(k.want[p], got, at, k.exact[p], tally);
    if (diff !== undefined) return diff.replace(' gpu ', ' webgl2 ');
  }
  return undefined;
}

/** Runs INSIDE the browser: plain WebGL2, nothing from this package. Each job's fragment program
 *  is drawn over a full-screen triangle into an `RGBA32UI` target, its table in the one uniform
 *  block it declares, and the target is read back. */
function drawInPage(input: { jobs: DrawJob[]; broken?: string }): {
  renderer: string;
  brokenReported?: boolean;
  results: DrawResult[];
} {
  const g = globalThis as unknown as { __gl?: WebGL2RenderingContext };
  if (g.__gl === undefined) {
    const made = document.createElement('canvas').getContext('webgl2');
    if (made === null)
      throw new Error('getContext("webgl2") returned null: WebGL2 is not reachable');
    g.__gl = made;
  }
  const gl = g.__gl;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    debug === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
  );
  // The runtime's full-screen triangle (`core/host-draw.ts`), at the near plane.
  const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, -1.0, 1.0);
}`;
  const shader = (type: number, src: string): { s: WebGLShader; log?: string } => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) === true
      ? { s }
      : { s, log: gl.getShaderInfoLog(s) ?? '' };
  };
  let brokenReported: boolean | undefined;
  if (input.broken !== undefined) {
    const b = shader(gl.FRAGMENT_SHADER, input.broken);
    brokenReported = b.log !== undefined;
    gl.deleteShader(b.s);
  }
  const results: DrawResult[] = [];
  for (const job of input.jobs) {
    const vs = shader(gl.VERTEX_SHADER, vertex);
    const fs = shader(gl.FRAGMENT_SHADER, job.frag);
    const program = gl.createProgram()!;
    const ubo = gl.createBuffer();
    const target = gl.createTexture();
    const fbo = gl.createFramebuffer();
    try {
      if (fs.log !== undefined) {
        results.push({ id: job.id, error: `WebGL2 refused the program: ${fs.log}` });
        continue;
      }
      gl.attachShader(program, vs.s);
      gl.attachShader(program, fs.s);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        results.push({
          id: job.id,
          error: `WebGL2 refused the program: ${gl.getProgramInfoLog(program) ?? ''}`,
        });
        continue;
      }
      gl.useProgram(program);
      // The table is the one block; a function that reads no argument leaves it unused.
      const blocks = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS) as number;
      if (blocks > 1) {
        results.push({
          id: job.id,
          error: `${String(blocks)} uniform blocks, not the table alone`,
        });
        continue;
      }
      if (blocks === 1) {
        gl.uniformBlockBinding(program, 0, 0);
        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferData(gl.UNIFORM_BUFFER, new Uint32Array(job.words), gl.STATIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
      }
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, job.width, job.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        results.push({
          id: job.id,
          error: `the RGBA32UI target is incomplete (0x${status.toString(16)})`,
        });
        continue;
      }
      gl.viewport(0, 0, job.width, job.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const texels = new Uint32Array(job.width * job.height * 4);
      gl.readPixels(0, 0, job.width, job.height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, texels);
      const error = gl.getError();
      results.push(
        error === gl.NO_ERROR
          ? { id: job.id, words: [...texels] }
          : { id: job.id, error: `WebGL2 error 0x${error.toString(16)}` },
      );
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(target);
      gl.deleteBuffer(ubo);
      gl.deleteProgram(program);
      gl.deleteShader(vs.s);
      gl.deleteShader(fs.s);
    }
  }
  return { renderer, ...(brokenReported !== undefined ? { brokenReported } : {}), results };
}

// ─── the gate ────────────────────────────────────────────────────────────────────────────────

/** The WebGPU arm: each generated kernel function's plan dispatched on WebGPU. */
async function webgpuArm(page: Page): Promise<number> {
  const corpus = Array.from({ length: SEEDS }, (_, i) =>
    generateKernelModule(i + 1, { exact: true }),
  );
  let failures = 0;
  // The claim this gate compares bit for bit: the report lists nothing but `order`.
  const listed = new Map<string, number>();
  for (const c of corpus)
    for (const r of determinismReport(c.module))
      if (r.kind !== 'order') listed.set(`${r.op} (${r.kind})`, c.seed);
  for (const [op, seed] of listed) {
    console.error(
      `FAIL  the exact corpus uses ${op} (seed ${String(seed)}), which has more than one answer`,
    );
    failures += 1;
  }
  const lowered = corpus.flatMap((c) => {
    const proof = proveKernels(c.module).find((p) => p.fn === c.kernel)!;
    if (proof.shape !== undefined || proof.loops.some((l) => !l.ok)) return [];
    const plan = lowerKernel(
      c.module.funcs.find((x) => x.name === c.kernel)!,
      c.module,
      proof,
    );
    return 'noGpu' in plan ? [] : [{ c, plan }];
  });
  const cases = lowered.flatMap(({ c, plan }) =>
    SIZES.flatMap(([n, h]) =>
      [false, true].map((boundary) =>
        caseOf(
          c,
          plan,
          argsOf(c, n, h, boundary),
          `seed ${String(c.seed)} n=${String(n)} h=${String(h)}${boundary ? ' boundary' : ''}`,
        ),
      ),
    ),
  );
  // The instrument's own corpus floor: what the claim is about has to be in it.
  const reach = {
    plans: lowered.length,
    folded: lowered.filter(({ plan }) => plan.loops.some((l) => l.reduce !== undefined)).length,
    scatters: lowered.filter(({ plan }) =>
      plan.module.bindings.some((b) => b.type.kind === 'array' && b.type.elem.kind === 'atomic'),
    ).length,
    structs: lowered.filter(({ plan }) =>
      plan.module.bindings.some((b) => b.type.kind === 'array' && b.type.elem.kind === 'struct'),
    ).length,
  };
  for (const [what, floor] of [
    ['plans', 20],
    ['folded', 10],
    ['scatters', 5],
    ['structs', 3],
  ] as const) {
    if (reach[what] < floor) {
      console.error(
        `FAIL  the corpus reaches ${String(reach[what])} ${what}, under its floor of ${String(floor)}`,
      );
      failures += 1;
    }
  }
  // One plan dispatched wrong on purpose, its first iteration skipped: the first call whose
  // oracle run of the faulty plan already disagrees, so a GPU that agrees with the oracle must
  // report it too.
  const probe = cases.find(
    (k) =>
      firstDifference(
        k.want,
        runKernelPlan(k.c.module, k.c.kernel, k.plan, k.args, 'skip-first-iteration'),
        'k',
        k.exact,
      ) !== undefined,
  );
  if (probe === undefined) {
    console.error(
      'FAIL  instrument: no call of the corpus changes when its first iteration is skipped',
    );
    return failures + 1;
  }
  const wrong = caseOf(
    probe.c,
    probe.plan,
    probe.args,
    `${probe.key} (skip-first-iteration)`,
    'skip-first-iteration',
  );

  let compared = 0;
  let noted = 0;
  const tally: Tally = { compared: 0, rounded: 0 };
  const first = await page.evaluate(runInPage, { jobs: [wrong.job], broken: 'fn broken( {' });
  console.log(`gpu differential: WebGPU adapter ${first.adapter}`);
  if (first.brokenReported === true)
    console.log('instrument: Tint REPORTED a non-program, so a verdict can fail');
  else {
    console.error(
      'FAIL  instrument: Tint accepted a non-program, so every verdict below would be blind',
    );
    failures += 1;
  }
  const w = first.results[0]!;
  const wrongDiff =
    w.error === undefined
      ? firstDifference(wrong.want, gotOf(wrong, w), 'k', wrong.exact)
      : undefined;
  if (wrongDiff !== undefined)
    console.log(
      `instrument: a plan dispatched wrong on purpose was REPORTED (${wrongDiff.slice(0, 100)})`,
    );
  else {
    console.error(
      `FAIL  instrument: a plan with its first iteration skipped ${w.error !== undefined ? `did not run (${w.error})` : 'matched the oracle'}`,
    );
    failures += 1;
  }
  // One seed at a time, so no one call to the page carries the whole corpus.
  for (const { c } of lowered) {
    const mine = cases.filter((k) => k.c === c);
    const { results } = await page.evaluate(runInPage, { jobs: mine.map((k) => k.job) });
    mine.forEach((k, i) => {
      const r = results[i]!;
      compared += 1;
      const diff = r.error ?? firstDifference(k.want, gotOf(k, r), 'k', k.exact, tally);
      if (diff === undefined) return;
      failures += 1;
      if (noted++ < 20) console.log(`FAIL  ${k.key}: ${diff}`);
    });
  }
  // The values the oracle rounded carry no claim. If they were most of the corpus, a green run
  // would say little: the corpus must keep them under a tenth of what it compares.
  if (tally.rounded * 10 > tally.compared) {
    console.error(
      `FAIL  the oracle rounded ${String(tally.rounded)} values against ${String(tally.compared)} compared, over a tenth`,
    );
    failures += 1;
  }
  console.log(
    `gpu differential: ${String(SEEDS)} generated kernel functions, ${String(reach.plans)} of them lowered ` +
      `(${String(reach.folded)} fold a reduction, ${String(reach.scatters)} scatter by atomics, ${String(reach.structs)} write a struct array) · ` +
      `${String(compared)} calls on WebGPU against the f32 oracle, ${String(tally.compared)} values bit for bit ` +
      `(${String(tally.rounded)} the oracle rounded, left out) · failures: ${String(failures)}`,
  );
  return failures;
}

/** What the GLSL arm's corpus must reach: the constructs the drift between the targets lived in
 *  (`CHANGELOG.md`'s Fixed entries), at about a third of what 48 seeds generate. The values it
 *  compares must reach half of what 48 seeds compare. */
const DRAW_FLOORS = [
  ['switchContinue', 190],
  ['accumulatorLoop', 90],
  ['convert', 440],
  ['int/', 50],
  ['int%', 40],
  ['intShift', 75],
  ['callFn', 330],
  ['select', 1100],
] as const;
const DRAW_COMPARED_FLOOR = 10000;

/** The GLSL arm: each generated function drawn as a fragment program on WebGL2. */
async function webgl2Arm(page: Page): Promise<number> {
  const corpus = Array.from({ length: SEEDS }, (_, i) => generateModule(i + 1, { exact: true }));
  let failures = 0;
  const cases = corpus.flatMap((c) => drawCasesOf(c));
  // The claim: every drawn module's report lists nothing.
  const listed = new Map<string, string>();
  for (const k of cases)
    for (const r of determinismReport(k.d.module)) listed.set(`${r.op} (${r.kind})`, k.key);
  for (const [op, key] of listed) {
    console.error(`FAIL  the exact corpus uses ${op} (${key}), which has more than one answer`);
    failures += 1;
  }
  const features = describeCorpus(corpus);
  for (const [what, floor] of DRAW_FLOORS) {
    if ((features[what] ?? 0) < floor) {
      console.error(
        `FAIL  the corpus reaches ${String(features[what] ?? 0)} ${what}, under its floor of ${String(floor)}`,
      );
      failures += 1;
    }
  }
  // One function drawn wrong on purpose, each pixel given the next pixel's arguments: the first
  // function whose oracle answers change under the shift, at a pixel whose answer and whose
  // neighbour's both carry a claim, so a driver that agrees with the oracle must report it.
  // At pixel `p` the driver then computes pixel `q`'s answer, which is the oracle's where `q`'s
  // run reached nothing GLSL leaves undefined and the f32 oracle did not round it.
  const shifted = cases.find(
    (k) =>
      k.refused === undefined &&
      k.want.some((v, p) => {
        const q = (p + 1) % k.want.length;
        return (
          !k.undefinedOnGlsl[p]! &&
          !k.undefinedOnGlsl[q]! &&
          JSON.stringify(k.want[q]) === JSON.stringify(k.exact[q]) &&
          firstDifference(v, k.want[q], 'k', k.exact[p]) !== undefined
        );
      }),
  );
  if (shifted === undefined) {
    console.error('FAIL  instrument: no drawn function changes when its table is a row off');
    return failures + 1;
  }
  const wrong = drawCasesOf(shifted.c, true).find((k) => k.d.fn.name === shifted.d.fn.name)!;

  let drawn = 0;
  let noted = 0;
  const tally: DrawTally = { compared: 0, rounded: 0, undefinedOnGlsl: 0 };
  const first = await page.evaluate(drawInPage, {
    jobs: [wrong.job],
    broken: '#version 300 es\nvoid main( {',
  });
  console.log(`glsl differential: WebGL2 renderer ${first.renderer}`);
  if (first.brokenReported === true)
    console.log('instrument: the GLSL compiler REPORTED a non-program, so a verdict can fail');
  else {
    console.error(
      'FAIL  instrument: the GLSL compiler accepted a non-program, so every verdict below would be blind',
    );
    failures += 1;
  }
  const w = first.results[0]!;
  const wrongDiff = w.error === undefined ? drawDifference(wrong, w) : undefined;
  if (wrongDiff !== undefined)
    console.log(
      `instrument: a table uploaded a row off on purpose was REPORTED (${wrongDiff.slice(0, 100)})`,
    );
  else {
    console.error(
      `FAIL  instrument: a table a row off ${w.error !== undefined ? `did not draw (${w.error})` : 'matched the oracle'}`,
    );
    failures += 1;
  }
  // One seed at a time, so no one call to the page carries the whole corpus.
  for (const c of corpus) {
    const mine = cases.filter((k) => k.c === c);
    const { results } = await page.evaluate(drawInPage, {
      jobs: mine.filter((k) => k.refused === undefined).map((k) => k.job),
    });
    const byId = new Map(results.map((r) => [r.id, r]));
    mine.forEach((k) => {
      drawn += 1;
      const diff = drawDifference(k, byId.get(k.key), tally);
      if (diff === undefined) return;
      failures += 1;
      if (noted++ < 20) console.log(`FAIL  ${k.key}: ${diff.slice(0, 300)}`);
    });
  }
  if (tally.rounded * 10 > tally.compared) {
    console.error(
      `FAIL  the oracle rounded ${String(tally.rounded)} values against ${String(tally.compared)} compared, over a tenth`,
    );
    failures += 1;
  }
  if (tally.compared < DRAW_COMPARED_FLOOR) {
    console.error(
      `FAIL  the arm compared ${String(tally.compared)} values, under its floor of ${String(DRAW_COMPARED_FLOOR)}`,
    );
    failures += 1;
  }
  console.log(
    `glsl differential: ${String(drawn)} generated functions drawn on WebGL2, ${String(DRAW_W * DRAW_H)} argument lists each, against the f32 oracle · ` +
      `${String(tally.compared)} values bit for bit (${String(tally.rounded)} the oracle rounded, ` +
      `${String(tally.undefinedOnGlsl)} an input GLSL leaves undefined reached (#382), left out) · failures: ${String(failures)}`,
  );
  return failures;
}

async function main(): Promise<number> {
  const server = await serve();
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: CHROMIUM_ARGS,
  });
  let failures = 0;
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${String(port)}/`);
    failures += await webgpuArm(page);
    failures += await webgl2Arm(page);
  } finally {
    await browser.close();
    server.close();
  }
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
