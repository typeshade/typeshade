// ═══ What a subgroup pre-fold would save a reduction, measured on a device (#536) ═══
//
//   bun run bench:subgroup-reduce [--samples 31] [--warmup 5] [--n 1048576] [--hardware]
//                                 [--output artifacts/subgroup-reduce.json]
//
// A kernel function that reduces (`s += xs[i]`) runs at a workgroup of 256 and folds the 256
// values by the workgroup tree: eight barriers per workgroup, then one dispatch per level of
// partials (`src/core/passes/kernel-lower.ts`, `src/core/kernel-tree.ts`, Rule 7.2). WGSL's
// `subgroups` extension folds a subgroup's lanes in one instruction, with no barrier. Before a
// proposal spends a design on it, this script measures what the change would buy, on the device
// it runs on, for the two things it could change:
//
//   reduce    the compiler's own emit of `total` (f32) and `totalU` (u32), dispatched step for
//             step as the call layer does, against the same reduction hand-written three ways in
//             the compiler's own layout: `tree` (the compiler's shape, to prove the hand-written
//             modules time like the emit), `subgroup` (one `subgroupAdd` per subgroup, lane 0
//             then sums the `num_subgroups` partials: correct on any lane-to-subgroup mapping),
//             and `subgroup/2` (two `subgroupAdd` levels, correct only where the lanes of a
//             subgroup are consecutive `local_invocation_index` values, which the probe below
//             checks and the result check catches). `map` reads and writes each element once
//             with no fold: the floor a reduction cannot go below on this device.
//   atomic    the pre-reduction before `atomicAdd` that typeshade/radiance asked for (#536):
//             each lane adds into one counter (`lane`), or a subgroup folds first and one lane adds
//             (`subgroup`), or the workgroup tree folds first and lane 0 adds (`tree`, what the
//             compiler could do with no extension). `one` is one counter for every lane; `bins`
//             gives each run of 1024 consecutive elements its own bin, so a workgroup of 256
//             always shares one bin and the pre-reduction stays exact on any lane mapping.
//
// Every variant computes the same value, which is checked against the sum computed in JavaScript
// (the inputs are small integers, so an f32 sum is exact in every order), and every variant of a
// family runs the same dispatches with the same uniform words, so the only difference timed is
// the fold. The GPU time is the sum of the compute passes' timestamps where the device has
// `timestamp-query`; the wall time is from the submit to `queue.onSubmittedWorkDone()`. The cases
// take turns, sample by sample, so drift falls on all of them alike. The probe reports the
// adapter's `subgroupMinSize` and `subgroupMaxSize`, the `subgroup_size` one workgroup saw, and
// whether its subgroups were consecutive lanes.
//
// A measurement, not a gate: it enforces no threshold, and a difference on SwiftShader (the device
// in this container and in CI) says what a CPU executing WebGPU does with a subgroup, not what a
// GPU does. `--hardware` launches Chromium on the machine's own adapter (`docs/performance.md`);
// `TYPESHADE_CHROMIUM` names another Chromium. The result goes to `--output` with every sample,
// the adapter, the commit and the WGSL of every variant, so a number can be traced to its
// configuration.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compile, emitModule } from '../src/index.js';
import { proveKernels } from '../src/core/passes/parallel-loop.js';
import { lowerKernel } from '../src/core/passes/kernel-lower.js';
import { scheduleKernelPlan } from '../src/core/testing/kernel-plan.js';
import type { CpuValue } from '../src/core/cpu-runtime.js';
import { inPage, median } from '../journeys/_bench.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values: flags } = parseArgs({
  options: {
    samples: { type: 'string', default: '31' },
    warmup: { type: 'string', default: '5' },
    n: { type: 'string', default: String(1 << 20) },
    hardware: { type: 'boolean', default: false },
    output: { type: 'string', default: 'artifacts/subgroup-reduce.json' },
  },
});
const samples = Number(flags.samples);
const warmup = Number(flags.warmup);
const n = Number(flags.n);
if (!Number.isInteger(samples) || samples < 1)
  throw new Error('--samples is a positive whole number');
if (!Number.isInteger(warmup) || warmup < 0) throw new Error('--warmup is a whole number');
if (!Number.isInteger(n) || n < 1024 || n % 1024 !== 0)
  throw new Error('--n is a multiple of 1024, at least 1024');

// ─── The inputs, and what every variant must compute ───

/** The element at `i` of the f32 input, a small integer, so every order sums it exactly. */
const F32_AT = '((i % 7) - 3)';
/** The element at `i` of the u32 input. */
const U32_AT = '(i % 7)';
const f32At = (i: number): number => (i % 7) - 3;
const u32At = (i: number): number => i % 7;
/** Each run of `1 << BIN_SHIFT` consecutive elements shares one bin: four workgroups of 256. */
const BIN_SHIFT = 10;
const expectF32 = Array.from({ length: n }, (_, i) => f32At(i)).reduce((p, q) => p + q, 0);
const expectU32 = Array.from({ length: n }, (_, i) => u32At(i)).reduce((p, q) => p + q, 0);
const expectBins = Array.from({ length: n >> BIN_SHIFT }, (_, b) => {
  let s = 0;
  for (let i = b << BIN_SHIFT; i < (b + 1) << BIN_SHIFT; i++) s += u32At(i);
  return s;
});

// ─── The compiler's emit: the reference each hand-written variant is measured against ───

const SOURCE = `"use typeshade";
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
export function totalU(xs: array<u32>): u32 {
  let s: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
`;

type Elem = 'f32' | 'u32';
interface Step {
  readonly entry: string;
  readonly wg: readonly [number, number, number];
  /** The words of the plan's uniform, `_start`, `_n`, `_in`, `_out`. */
  readonly uniform: readonly number[];
}
/** What `@binding(2)` holds for a case. */
type Second =
  | { readonly kind: 'partials'; readonly words: number; readonly at: number }
  | { readonly kind: 'out'; readonly words: number }
  | { readonly kind: 'atomic'; readonly words: number };
interface CaseSpec {
  readonly name: string;
  readonly family: 'reduce' | 'atomic';
  readonly elem: Elem;
  readonly wgsl: string;
  readonly steps: readonly Step[];
  readonly second: Second;
  readonly expect: { readonly kind: 'sum'; readonly value: number } | { readonly kind: 'bins' };
  /** Needs the `subgroups` feature; skipped on a device without it. */
  readonly subgroups: boolean;
  /** Correct only where a subgroup's lanes are consecutive `local_invocation_index` values. */
  readonly assumesConsecutive: boolean;
}

const compiled = compile(SOURCE);
if (compiled.diagnostics.length > 0)
  throw new Error(
    `the source does not compile: ${compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`,
  );
const module = compiled.module;

/** The compiler's plan of `fn` over `n` elements: its WGSL, its dispatches, and the slot its
 *  folded value ends in. Every hand-written variant of the same element type reuses the steps. */
function compilerCase(fn: string, elem: Elem): CaseSpec {
  const f = module.funcs.find((x) => x.name === fn);
  if (f === undefined) throw new Error(`no function ${fn}`);
  const proof = proveKernels(module).find((p) => p.fn === fn);
  if (proof === undefined || proof.shape !== undefined || proof.loops.some((l) => !l.ok))
    throw new Error(`the proof does not accept ${fn}`);
  const plan = lowerKernel(f, module, proof);
  if ('noGpu' in plan) throw new Error(`${fn} does not lower: ${plan.noGpu}`);
  const at = elem === 'f32' ? f32At : u32At;
  const schedule = scheduleKernelPlan(module, fn, plan, [
    Array.from({ length: n }, (_, i) => at(i)) as unknown as CpuValue,
  ]);
  const struct = plan.module.structs.find((s) => s.name === plan.argsStruct);
  if (struct === undefined) throw new Error(`${fn} has no ${plan.argsStruct} struct`);
  const fields = struct.fields.map((x) => x.name);
  const steps = schedule.steps.map((s): Step => ({
    entry: s.entry,
    wg: s.workgroups,
    uniform: fields.map((name) => {
      const v = s.args[name];
      if (typeof v !== 'number') throw new Error(`the uniform's ${name} is not a number`);
      return v;
    }),
  }));
  const partial = schedule.partials[0];
  const fold = schedule.folds[0];
  if (partial === undefined || fold === undefined || !('at' in fold))
    throw new Error(`${fn} has no partials to read`);
  return {
    name: `${elem}/compiler`,
    family: 'reduce',
    elem,
    wgsl: emitModule(plan.module),
    steps,
    second: { kind: 'partials', words: partial.slots, at: fold.at },
    expect: { kind: 'sum', value: elem === 'f32' ? expectF32 : expectU32 },
    subgroups: false,
    assumesConsecutive: false,
  };
}

// ─── The hand-written variants, in the compiler's layout ───

type Fold = 'tree' | 'subgroup' | 'subgroup/2';

const ident = (elem: Elem): string => (elem === 'f32' ? '0.0' : '0u');

/** The module's head: the uniform, the input, `@binding(2)` and the workgroup array. */
function head(elem: Elem, second: 'partials' | 'atomic' | 'out', subgroups: boolean): string {
  const bind2 =
    second === 'atomic'
      ? 'var<storage, read_write> bins: array<atomic<u32>>;'
      : `var<storage, read_write> sums: array<${elem}>;`;
  return `${subgroups ? 'enable subgroups;\n\n' : ''}struct Args {
  _start: u32,
  _n: u32,
  _in: u32,
  _out: u32,
}

var<workgroup> tree: array<${elem}, 256>;

@group(0) @binding(0) var<uniform> args: Args;
@group(0) @binding(1) var<storage, read> xs: array<${elem}>;
@group(0) @binding(2) ${bind2}
`;
}

/** The entry's parameters: the compiler's four, and the subgroup built-in values where the fold
 *  reads them. */
function params(subgroups: boolean): string {
  return (
    '@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>, ' +
    '@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32' +
    (subgroups
      ? ', @builtin(subgroup_invocation_id) sgi: u32, @builtin(subgroup_size) sgs: u32, ' +
        '@builtin(subgroup_id) sgid: u32, @builtin(num_subgroups) nsg: u32'
      : '')
  );
}

/** The lane scaffold the compiler emits (change 0096): `k`, the workgroup's index, the whole
 *  workgroup's return past the trip count, and the lane's value `x`, the identity past it. */
function scaffold(elem: Elem, read: string): string {
  return `  let k = gid.x + gid.y * (nwg.x * 256u);
  let group = wid.x + wid.y * nwg.x;
  if (group * 256u >= args._n) {
    return;
  }
  let live = k < args._n;
  let kc = min(k, args._n - 1u);
  let x = select(${ident(elem)}, ${read}, live);
`;
}

/** The fold of `x` over the workgroup into `s` on lane 0, by `fold`. The tree is the compiler's
 *  shape, barrier for barrier. */
function foldInto(elem: Elem, fold: Fold): string {
  if (fold === 'tree') {
    const lines = ['  tree[lid] = x;', '  workgroupBarrier();'];
    for (let stride = 128; stride > 0; stride >>= 1) {
      lines.push(
        `  if (lid < ${stride}u) {`,
        `    tree[lid] = tree[lid] + tree[lid + ${stride}u];`,
        '  }',
      );
      if (stride > 1) lines.push('  workgroupBarrier();');
    }
    lines.push('  let s = tree[0];');
    return `${lines.join('\n')}\n`;
  }
  const z = ident(elem);
  // One `subgroupAdd` per subgroup; its lane 0 keeps the subgroup's value.
  const first = `  let v = subgroupAdd(x);
  if (sgi == 0u) {
    tree[sgid] = v;
  }
  workgroupBarrier();
`;
  if (fold === 'subgroup')
    // Lane 0 sums the `num_subgroups` partials, whatever lanes each subgroup held.
    return `${first}  var s = ${z};
  if (lid == 0u) {
    for (var j = 0u; j < nsg; j++) {
      s = s + tree[j];
    }
  }
`;
  // A second level: the lanes under `num_subgroups` read a partial each and fold again, which
  // leaves one value per subgroup that held such lanes: the first ceil(nsg / sgs) subgroups,
  // where a subgroup's lanes are consecutive.
  return `${first}  var y = ${z};
  if (lid < nsg) {
    y = tree[lid];
  }
  let w = subgroupAdd(y);
  workgroupBarrier();
  if (sgi == 0u) {
    tree[sgid] = w;
  }
  workgroupBarrier();
  var s = ${z};
  if (lid == 0u) {
    let m = (nsg + sgs - 1u) / sgs;
    for (var j = 0u; j < m; j++) {
      s = s + tree[j];
    }
  }
`;
}

/** A reduction in the compiler's two entries, `loop` over the input and `fold` over a level of
 *  partials, folded by `fold`. */
function reduceCase(elem: Elem, fold: Fold, steps: readonly Step[], second: Second): CaseSpec {
  const sg = fold !== 'tree';
  const entry = (name: string, read: string, out: string): string =>
    `@compute @workgroup_size(256)
fn ${name}(${params(sg)}) {
${scaffold(elem, read)}${foldInto(elem, fold)}  if (lid == 0u) {
    sums[${out}] = s;
  }
}
`;
  const wgsl =
    head(elem, 'partials', sg) +
    '\n' +
    entry('iterate', 'xs[args._start + kc]', 'group') +
    '\n' +
    entry('fold', 'sums[args._in + kc]', 'args._out + group');
  // The compiler's steps name its entries; the hand-written module names them `iterate` and `fold`.
  const renamed = steps.map((s) => ({
    ...s,
    entry: s.entry.endsWith('_fold') ? 'fold' : 'iterate',
  }));
  return {
    name: `${elem}/${fold}`,
    family: 'reduce',
    elem,
    wgsl,
    steps: renamed,
    second,
    expect: { kind: 'sum', value: elem === 'f32' ? expectF32 : expectU32 },
    subgroups: sg,
    assumesConsecutive: fold === 'subgroup/2',
  };
}

/** Each element read once and written once, no fold: the floor. */
function mapCase(elem: Elem, loop: Step): CaseSpec {
  const wgsl = `${head(elem, 'out', false)}
@compute @workgroup_size(256)
fn iterate(${params(false)}) {
${scaffold(elem, 'xs[args._start + kc]')}  if (live) {
    sums[k] = x + x;
  }
}
`;
  return {
    name: `${elem}/map`,
    family: 'reduce',
    elem,
    wgsl,
    steps: [{ ...loop, entry: 'iterate' }],
    second: { kind: 'out', words: n },
    // The check reads `sums[0]`, which is `2 * xs[0]`.
    expect: { kind: 'sum', value: 2 * (elem === 'f32' ? f32At(0) : u32At(0)) },
    subgroups: false,
    assumesConsecutive: false,
  };
}

type Pre = 'lane' | 'subgroup' | 'tree';

/** `atomicAdd` into one counter, or into the bin of each run of 1024 elements, after no
 *  pre-reduction, a subgroup's, or the workgroup tree's. */
function atomicCase(pre: Pre, bins: boolean, loop: Step): CaseSpec {
  const sg = pre === 'subgroup';
  const bin = bins ? `kc >> ${BIN_SHIFT}u` : '0u';
  let body: string;
  if (pre === 'lane')
    body = `  if (live) {
    atomicAdd(&bins[${bin}], x);
  }
`;
  else if (pre === 'subgroup')
    body = `  let v = subgroupAdd(x);
  if (subgroupElect()) {
    atomicAdd(&bins[${bin}], v);
  }
`;
  else
    body = `${foldInto('u32', 'tree')}  if (lid == 0u) {
    atomicAdd(&bins[${bin}], s);
  }
`;
  const wgsl = `${head('u32', 'atomic', sg)}
@compute @workgroup_size(256)
fn iterate(${params(sg)}) {
${scaffold('u32', 'xs[args._start + kc]')}${body}}
`;
  return {
    name: `atomic/${pre}/${bins ? 'bins' : 'one'}`,
    family: 'atomic',
    elem: 'u32',
    wgsl,
    steps: [{ ...loop, entry: 'iterate' }],
    second: { kind: 'atomic', words: bins ? n >> BIN_SHIFT : 1 },
    expect: bins ? { kind: 'bins' } : { kind: 'sum', value: expectU32 },
    subgroups: sg,
    assumesConsecutive: false,
  };
}

/** One workgroup writes what it saw of its subgroups: `subgroup_id` and
 *  `subgroup_invocation_id` per lane, then `subgroup_size` and `num_subgroups`. */
const PROBE = `enable subgroups;

@group(0) @binding(0) var<storage, read_write> out: array<u32>;

@compute @workgroup_size(256)
fn probe(@builtin(local_invocation_index) lid: u32, @builtin(subgroup_invocation_id) sgi: u32,
         @builtin(subgroup_size) sgs: u32, @builtin(subgroup_id) sgid: u32,
         @builtin(num_subgroups) nsg: u32) {
  out[lid] = sgid;
  out[256u + lid] = sgi;
  if (lid == 0u) {
    out[512] = sgs;
    out[513] = nsg;
  }
}
`;

const cases: CaseSpec[] = [];
for (const [fn, elem] of [
  ['total', 'f32'],
  ['totalU', 'u32'],
] as const) {
  const c = compilerCase(fn, elem);
  cases.push(c);
  for (const fold of ['tree', 'subgroup', 'subgroup/2'] as const)
    cases.push(reduceCase(elem, fold, c.steps, c.second));
  cases.push(mapCase(elem, c.steps[0]!));
}
const loopStep = cases[0]!.steps[0]!;
for (const bins of [false, true])
  for (const pre of ['lane', 'subgroup', 'tree'] as const)
    cases.push(atomicCase(pre, bins, loopStep));

// ─── In the page ───

interface Sample {
  readonly wallMs: number;
  /** `null` where the device did not measure the passes. */
  readonly gpuMs: number | null;
}
interface CaseResult {
  readonly samples: Sample[];
  /** What the check of the value found: `ok`, or what differed. */
  readonly check: string;
  /** A Tint or validation error that kept the case from running. */
  readonly error?: string;
  readonly skipped?: string;
}
interface Measured {
  readonly adapter: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    subgroupMinSize: number | null;
    subgroupMaxSize: number | null;
  };
  readonly features: { subgroups: boolean; timestampQuery: boolean };
  readonly userAgent: string;
  readonly probe:
    { subgroupSize: number; numSubgroups: number; consecutive: boolean } | { error: string } | null;
  readonly cases: Record<string, CaseResult>;
}

/** Runs INSIDE the page: compiles every case's module, runs its steps once per sample with a
 *  timestamp around each pass, and checks the value the first measured run gave. */
async function measure(opts: {
  n: number;
  samples: number;
  warmup: number;
  cases: readonly CaseSpec[];
  probe: string;
  f32At: string;
  u32At: string;
  expectBins: readonly number[];
}): Promise<Measured> {
  const gpu = (navigator as unknown as { gpu: GPU }).gpu;
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error('WebGPU gave no adapter');
  const timestampQuery = adapter.features.has('timestamp-query');
  const subgroups = adapter.features.has('subgroups');
  const required: GPUFeatureName[] = [];
  if (timestampQuery) required.push('timestamp-query');
  if (subgroups) required.push('subgroups' as GPUFeatureName);
  const device = await adapter.requestDevice({ requiredFeatures: required });
  const info = adapter.info as GPUAdapterInfo & {
    subgroupMinSize?: number;
    subgroupMaxSize?: number;
  };
  const { queue } = device;

  // The inputs, from the formulas, so that nothing large crosses into the page.
  const f32 = new Float32Array(opts.n);
  const u32 = new Uint32Array(opts.n);
  const f32At = new Function('i', `return ${opts.f32At};`) as (i: number) => number;
  const u32At = new Function('i', `return ${opts.u32At};`) as (i: number) => number;
  for (let i = 0; i < opts.n; i++) {
    f32[i] = f32At(i);
    u32[i] = u32At(i);
  }
  // An `ArrayBuffer`, not a typed array: TypeScript 5.7 and later type `new Float32Array(n)` over
  // `ArrayBufferLike`, which `writeBuffer` refuses, and the pinned 5.6 has no type argument to say
  // otherwise; the buffer itself is one spelling both accept.
  const upload = (data: ArrayBuffer): GPUBuffer => {
    const b = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    queue.writeBuffer(b, 0, data);
    return b;
  };
  const inputs = { f32: upload(f32.buffer as ArrayBuffer), u32: upload(u32.buffer as ArrayBuffer) };
  const uniform = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // The probe: one workgroup's view of its subgroups.
  let probe: Measured['probe'] = null;
  if (subgroups) {
    device.pushErrorScope('validation');
    try {
      const m = device.createShaderModule({ code: opts.probe });
      const errors = (await m.getCompilationInfo()).messages.filter((x) => x.type === 'error');
      if (errors.length > 0) throw new Error(`Tint: ${errors.map((x) => x.message).join('; ')}`);
      const out = device.createBuffer({
        size: 514 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: m, entryPoint: 'probe' },
      });
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: out } }],
      });
      const staging = device.createBuffer({
        size: out.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(1);
      pass.end();
      enc.copyBufferToBuffer(out, 0, staging, 0, out.size);
      queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      const sgs = words[512]!;
      let consecutive = sgs > 0;
      for (let lid = 0; lid < 256 && consecutive; lid++)
        consecutive =
          words[lid] === Math.floor(lid / sgs) && words[256 + lid] === lid % sgs && consecutive;
      probe = { subgroupSize: sgs, numSubgroups: words[513]!, consecutive };
      const scope = await device.popErrorScope();
      if (scope !== null) probe = { error: scope.message };
    } catch (e) {
      await device.popErrorScope().catch(() => null);
      probe = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Each case: its pipelines, its own `@binding(2)` buffer, and a bind group per entry.
  interface Ready {
    readonly spec: CaseSpec;
    readonly pipelines: Map<string, { pipeline: GPUComputePipeline; group: GPUBindGroup }>;
    readonly second: GPUBuffer;
    readonly staging: GPUBuffer;
    readonly zero: ArrayBuffer | null;
  }
  const results: Record<string, CaseResult> = {};
  const ready: Ready[] = [];
  for (const spec of opts.cases) {
    if (spec.subgroups && !subgroups) {
      results[spec.name] = {
        samples: [],
        check: 'not run',
        skipped: 'the adapter has no `subgroups` feature',
      };
      continue;
    }
    device.pushErrorScope('validation');
    try {
      const m = device.createShaderModule({ code: spec.wgsl });
      const errors = (await m.getCompilationInfo()).messages
        .filter((x) => x.type === 'error')
        .map((x) => `${String(x.lineNum)}:${String(x.linePos)} ${x.message}`);
      if (errors.length > 0) throw new Error(`Tint: ${errors.join('; ')}`);
      const second = device.createBuffer({
        size: Math.max(4, spec.second.words * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const staging = device.createBuffer({
        size: second.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage' },
          },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });
      const group = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: inputs[spec.elem] } },
          { binding: 2, resource: { buffer: second } },
        ],
      });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      const pipelines = new Map<string, { pipeline: GPUComputePipeline; group: GPUBindGroup }>();
      for (const s of spec.steps) {
        if (pipelines.has(s.entry)) continue;
        const pipeline = await device.createComputePipelineAsync({
          layout,
          compute: { module: m, entryPoint: s.entry },
        });
        pipelines.set(s.entry, { pipeline, group });
      }
      const scope = await device.popErrorScope();
      if (scope !== null) throw new Error(`validation: ${scope.message}`);
      ready.push({
        spec,
        pipelines,
        second,
        staging,
        zero: spec.second.kind === 'atomic' ? new ArrayBuffer(spec.second.words * 4) : null,
      });
      results[spec.name] = { samples: [], check: 'not checked' };
    } catch (e) {
      await device.popErrorScope().catch(() => null);
      results[spec.name] = {
        samples: [],
        check: 'not run',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // One timestamp pair per pass; a case has at most eight steps.
  const QUERIES = 16;
  const querySet = timestampQuery
    ? device.createQuerySet({ type: 'timestamp', count: QUERIES })
    : null;
  const resolved = device.createBuffer({
    size: QUERIES * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const times = device.createBuffer({
    size: QUERIES * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  /** One run of a case: its steps, each in its own pass, in one submission. */
  const once = async (r: Ready, check: boolean): Promise<Sample> => {
    if (r.zero !== null) queue.writeBuffer(r.second, 0, r.zero);
    const start = performance.now();
    // The uniform changes between steps, so each step is its own submission, as the call layer's
    // steps are; the wall time spans them all.
    r.spec.steps.forEach((s, i) => {
      queue.writeBuffer(uniform, 0, new Uint32Array(s.uniform));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass(
        querySet === null
          ? {}
          : {
              timestampWrites: {
                querySet,
                beginningOfPassWriteIndex: 2 * i,
                endOfPassWriteIndex: 2 * i + 1,
              },
            },
      );
      const p = r.pipelines.get(s.entry)!;
      pass.setPipeline(p.pipeline);
      pass.setBindGroup(0, p.group);
      pass.dispatchWorkgroups(s.wg[0], s.wg[1], s.wg[2]);
      pass.end();
      if (i === r.spec.steps.length - 1) {
        if (querySet !== null) {
          enc.resolveQuerySet(querySet, 0, 2 * r.spec.steps.length, resolved, 0);
          enc.copyBufferToBuffer(resolved, 0, times, 0, resolved.size);
        }
        if (check) enc.copyBufferToBuffer(r.second, 0, r.staging, 0, r.second.size);
      }
      queue.submit([enc.finish()]);
    });
    await queue.onSubmittedWorkDone();
    const wallMs = performance.now() - start;
    let gpuMs: number | null = null;
    if (querySet !== null) {
      await times.mapAsync(GPUMapMode.READ);
      const t = new BigUint64Array(times.getMappedRange().slice(0));
      times.unmap();
      let ns = 0n;
      for (let i = 0; i < r.spec.steps.length; i++) ns += t[2 * i + 1]! - t[2 * i]!;
      gpuMs = Number(ns) / 1e6;
    }
    if (check) {
      await r.staging.mapAsync(GPUMapMode.READ);
      const bytes = r.staging.getMappedRange().slice(0);
      r.staging.unmap();
      const words = r.spec.elem === 'f32' ? new Float32Array(bytes) : new Uint32Array(bytes);
      let found = 'ok';
      if (r.spec.expect.kind === 'sum') {
        const at = r.spec.second.kind === 'partials' ? r.spec.second.at : 0;
        const got = words[at]!;
        if (got !== r.spec.expect.value)
          found = `expected ${String(r.spec.expect.value)}, read ${String(got)} at slot ${String(at)}`;
      } else {
        for (let b = 0; b < opts.expectBins.length; b++)
          if (words[b] !== opts.expectBins[b]) {
            found = `bin ${String(b)}: expected ${String(opts.expectBins[b])}, read ${String(words[b])}`;
            break;
          }
      }
      results[r.spec.name] = { ...results[r.spec.name]!, check: found };
    }
    return { wallMs, gpuMs };
  };

  for (let i = 0; i < opts.warmup; i++) for (const r of ready) await once(r, false);
  for (let i = 0; i < opts.samples; i++)
    for (const r of ready) results[r.spec.name]!.samples.push(await once(r, i === 0));

  return {
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      subgroupMinSize: info.subgroupMinSize ?? null,
      subgroupMaxSize: info.subgroupMaxSize ?? null,
    },
    features: { subgroups, timestampQuery },
    userAgent: navigator.userAgent,
    probe,
    cases: results,
  };
}

const measured = (await inPage({
  modules: {},
  measure,
  options: { n, samples, warmup, cases, probe: PROBE, f32At: F32_AT, u32At: U32_AT, expectBins },
  hardware: flags.hardware,
})) as Measured;

// ─── The report ───

const round = (x: number): number => Number(x.toFixed(3));
interface Row {
  readonly name: string;
  readonly steps: number;
  readonly gpuMs: number | null;
  readonly gpuMinMs: number | null;
  readonly gpuMaxMs: number | null;
  readonly wallMs: number | null;
  /** This case's time over its family's reference: `<elem>/compiler`, or `atomic/lane/<bins>`. */
  readonly vsReference: string;
  readonly check: string;
}
const timeOf = (r: CaseResult): number | null => {
  if (r.samples.length === 0) return null;
  const gpu = r.samples.map((s) => s.gpuMs);
  return gpu.every((g): g is number => g !== null)
    ? median(gpu)
    : median(r.samples.map((s) => s.wallMs));
};
const referenceOf = (c: CaseSpec): string =>
  c.family === 'reduce'
    ? `${c.elem}/compiler`
    : `atomic/lane/${c.name.endsWith('/bins') ? 'bins' : 'one'}`;
const rows: Row[] = cases.map((c) => {
  const r = measured.cases[c.name]!;
  const gpu = r.samples.map((s) => s.gpuMs);
  const allGpu = r.samples.length > 0 && gpu.every((g): g is number => g !== null);
  const mine = timeOf(r);
  const ref = timeOf(measured.cases[referenceOf(c)]!);
  return {
    name: c.name,
    steps: c.steps.length,
    gpuMs: allGpu ? round(median(gpu as number[])) : null,
    gpuMinMs: allGpu ? round(Math.min(...(gpu as number[]))) : null,
    gpuMaxMs: allGpu ? round(Math.max(...(gpu as number[]))) : null,
    wallMs: r.samples.length > 0 ? round(median(r.samples.map((s) => s.wallMs))) : null,
    vsReference:
      mine === null || ref === null ? 'n/a' : `${(mine / ref).toFixed(2)}x ${referenceOf(c)}`,
    check: r.error ?? r.skipped ?? r.check,
  };
});
const key = `${measured.adapter.vendor || 'unknown'}-${measured.adapter.architecture || 'unknown'}`;
const software = /swiftshader/i.test(
  `${measured.adapter.vendor} ${measured.adapter.architecture} ${measured.adapter.description}`,
);
console.log(
  `subgroup reduce: ${key}${measured.adapter.device ? ` (${measured.adapter.device})` : ''}` +
    `${software ? ', a software device' : ''}; subgroups ${measured.features.subgroups ? 'yes' : 'no'}` +
    ` (adapter sizes ${String(measured.adapter.subgroupMinSize)}..${String(measured.adapter.subgroupMaxSize)}); ` +
    `timestamp-query ${measured.features.timestampQuery ? 'yes' : 'no'}; n = ${String(n)}, ` +
    `${String(samples)} sample(s) after ${String(warmup)} warm-up run(s)`,
);
if (measured.probe !== null)
  console.log(
    'error' in measured.probe
      ? `probe: ${measured.probe.error}`
      : `probe: one workgroup of 256 saw subgroup_size ${String(measured.probe.subgroupSize)}, ` +
          `num_subgroups ${String(measured.probe.numSubgroups)}, lanes of a subgroup consecutive: ` +
          `${measured.probe.consecutive ? 'yes' : 'NO'}`,
  );
console.table(
  rows.map((r) => ({
    ...r,
    gpuMs: r.gpuMs ?? 'n/a',
    gpuMinMs: r.gpuMinMs ?? 'n/a',
    gpuMaxMs: r.gpuMaxMs ?? 'n/a',
    wallMs: r.wallMs ?? 'n/a',
  })),
);

// A variant that ran and computed another value is a finding, and a failure of this run, but
// for the one that assumes consecutive lanes on a device whose probe said they are not.
let failed = false;
for (const c of cases) {
  const r = measured.cases[c.name]!;
  if (r.error !== undefined) {
    console.error(`FAIL ${c.name}: ${r.error}`);
    failed = true;
  } else if (r.samples.length > 0 && r.check !== 'ok') {
    const excused =
      c.assumesConsecutive &&
      measured.probe !== null &&
      !('error' in measured.probe) &&
      !measured.probe.consecutive;
    console.error(`${excused ? 'note' : 'FAIL'} ${c.name}: ${r.check}`);
    if (!excused) failed = true;
  }
}
const ran = cases.filter((c) => (measured.cases[c.name]?.samples.length ?? 0) > 0).length;
if (ran < 2) {
  console.error('FAIL fewer than two cases ran; nothing was compared');
  failed = true;
}

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
const record = {
  adapterKey: key,
  adapter: measured.adapter,
  software,
  cpu: `${cpus()[0]?.model.trim() ?? 'unknown'} x${String(cpus().length)}`,
  features: measured.features,
  probe: measured.probe,
  userAgent: measured.userAgent,
  commit,
  recordedAt: new Date().toISOString(),
  n,
  samples,
  warmup,
  rows,
  cases: cases.map((c) => ({
    name: c.name,
    family: c.family,
    elem: c.elem,
    steps: c.steps,
    wgslSha256: createHash('sha256').update(c.wgsl).digest('hex'),
    wgsl: c.wgsl,
    result: measured.cases[c.name],
  })),
};
const output = resolve(ROOT, flags.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${output} at ${commit.slice(0, 8)}`);
if (failed) process.exit(1);
