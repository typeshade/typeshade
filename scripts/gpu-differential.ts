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
// values left out. GLSL ES 3.00's bare operators leave some inputs undefined: an integer `/` or
// `%` by zero, a `%` with a negative operand, a float that does not fit the integer it converts
// to. A driver answered otherwise than WGSL and the oracle there (#382), and the GLSL writer now
// settles each the way WGSL does (Rule 11.12). The harness's taint finds the runs that reach one,
// which are compared like the rest and counted, so the claim covers what the writer settles.
//
// THE CHAIN ARM. A fuse scope (`typeshade/fuse`, change 0058) runs the kernel calls a body makes
// as one plan, and fuses the consecutive calls the facts F1 to F6 allow into one dispatch. This arm
// draws chains with `generateChain` (`src/core/testing/random-ir.ts`): 2 to 6 calls of generated
// kernel functions over arrays the caller keeps, each call's output a new array unless the chain
// reuses one, with inputs drawn from earlier outputs, now and then a scalar, a helper call, a read
// at another index, a write at `2 * i`, a `continue`, a loop that starts late or steps by 2, and a
// call that runs over another count. In three chains of ten one call reduces (F6), mostly the
// last. The arrays the host reads nothing from after the chain are scratch arrays of the scope
// (`scope.scratch`): a fused entry holds one as a local where Rule 11.13 allows, with no buffer,
// and the plan makes it a zeroed buffer otherwise. Each chain runs at two sizes, the large one
// past a workgroup of 256 where the chain reduces, and two chains run again at 70,000 iterations,
// where the partials of a reduction need two levels of folds. The planner of `core/fuse-group.ts`
// groups the calls from their faces (`lowerFace`, `core/testing/fuse-chain.ts`, which builds a face
// from IR as `fuseRecord` does from a compiled source). A group of several calls is dispatched as
// the entry `fusedFor` builds, with the scratch arrays the planner contracted held as locals, and
// every other call as its own lowered plan. A call that reduces is dispatched as the runtime
// dispatches one: its loop, and then one dispatch of the fold entry for each level of partials,
// with the uniform's `c<m>__n`, `c<m>__in` and `c<m>__out` set for the level. The arm keeps the
// partials in one buffer of the job and gives the queue all the dispatches in one submission. How
// the runtime submits the levels is the call layer's own (`src/fuse.test.ts` and
// `journeys/loop-fuse` hold it), so the arm holds the dispatch sequence and the folded values. It
// dispatches the plan itself and does not run `fuse()`. Four claims are held:
//
//   - every array the chain writes that the host reads, and every result, is the same bit for bit
//     as the same calls run apart on the f32 oracle, with the exclusions above (the CPU tier never
//     fuses, Rule 11.7); a scratch array is left out, since the host never reads it;
//   - the groups the planner makes are the groups the facts F1 to F6 give for the chain as the
//     generator BUILT it (`modelGroups` reads no fact of any face), and the words it gives for each
//     group that stands apart name the same fact;
//   - the scratch arrays the planner holds as locals are those the facts give (every call that
//     names one is in the group, exactly one writes it, every access is at `i`, no call names its
//     length), and a local has no buffer: a stage that binds one is an error;
//   - the dispatches the device is given, counted where it is given them, are those groups', the
//     fold levels of a reduction among them.
//
// THE COMPUTE ARM. `gl-compute-arm.ts` runs compute entries on WebGL2 through the executor of
// change 0054 and holds every storage word to the executor's CPU model; it has its own
// instruments, below its header.
//
// WHY IT CANNOT BE VACUOUSLY GREEN (AGENTS.md#gate-discipline):
//
//   1. WebGPU and WebGL2 must be reachable: no adapter, device or context fails the gate.
//   2. Tint and the GLSL compiler must each REPORT a shader that is not a program before any
//      verdict is believed.
//   3. The corpus must reach what the claim is about. For WebGPU: plans that lower, a reduction
//      folded a level, a scatter's atomics, a struct array's layout, and a report with no row but
//      `order`. For the chains: fused groups, a group of three, the edges they keep in locals, the
//      values a call wrote, a group that stands apart for each fact the planner can fail on, the
//      scratch arrays held as locals and kept as buffers (for each clause of Rule 11.13 that
//      keeps one), the reductions fused as the last call of a group, the fold levels, and a
//      reduction folded in two levels with a result the f64 oracle gives too (`CHAIN_FLOORS`).
//      For WebGL2: the constructs the drift between the targets lived in (`DRAW_FLOORS`), a report
//      with no row, and enough values compared, enough of them reached by an input the bare GLSL
//      operator leaves undefined.
//   4. Each arm also runs one case wrong on purpose, and the comparison must report it: a plan
//      dispatched with its first iteration skipped, and a table uploaded a row off. The chain arm
//      runs seven: a fused group dispatched with its first iteration skipped, a face whose facts
//      say every read is at the counter (the grouping, and the values where the consumer uses what
//      it reads), a chain dispatched apart where the facts fuse (the dispatch count), a scratch
//      array held as a local against the facts (a stencil reads it), a scratch array that stays a
//      buffer and starts with other words than zeros, a fused reduction whose last level of
//      partials is not folded (the values, and the dispatch count) and one whose partials are
//      zeroed between the levels.
//
// Usage:  bun scripts/gpu-differential.ts            (from the package root)
//         TYPESHADE_CHROMIUM=/path/to/headless_shell bun scripts/gpu-differential.ts
//         TYPESHADE_DIFF_SEEDS=400 bun scripts/gpu-differential.ts   (a longer sweep, to hunt)
//
// A seed is one generated program, and the seeds of an arm are 1 to `TYPESHADE_DIFF_SEEDS`: a
// failure names the seed of the kernel function, the chain or the module, which is the seed
// `generateKernelModule`, `generateChain` or `generateModule` takes to build it again.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Page } from 'playwright';
import { compileModuleJs } from '../src/core/cpu-codegen.js';
import type { CpuStruct, CpuValue } from '../src/core/cpu-runtime.js';
import type { PackLayout } from '../src/core/manifest-types.js';
import { buildManifest } from '../src/core/manifest.js';
import { compileModule, type CpuModule } from '../src/core/oracle.js';
import { determinismReport } from '../src/core/passes/determinism.js';
import type { ModuleDecl } from '../src/core/ir/index.js';
import type { Group, GroupCall } from '../src/core/fuse-group.js';
import type { ComputeEntry } from '../src/core/host-entry.js';
import { lowerKernel, type KernelPlan } from '../src/core/passes/kernel-lower.js';
import { proveKernels } from '../src/core/passes/parallel-loop.js';
import {
  copy,
  runKernelPlan,
  scheduleKernelPlan,
  tailOf,
  type PlanFault,
  type PlanFold,
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
  callArgs,
  contractAgainstFacts,
  dispatchesOf,
  foldChain,
  foldLevels,
  fuseGroup,
  fusedRun,
  groupCallsOf,
  inputsOf,
  lengthOf,
  limitChain,
  localChain,
  localsStartingAtOne,
  lowerChain,
  modelGroups,
  planChain,
  readsAtCounter,
  reasonOf,
  runApart,
  runGrouped,
  scratchFates,
  scratchStencil,
  shapeOf,
  stencilChain,
  withScratchContents,
  tripsOf,
  type Fate,
  type GroupFault,
  type Inputs,
  type Lowered,
  type ModelGroup,
  type Outcome as ChainOutcome,
  type PlannedGroup,
  type Sizes,
} from '../src/core/testing/fuse-chain.js';
import {
  describeCorpus,
  generateChain,
  generateKernelModule,
  generateModule,
  type ChainArray,
  type ChainCorpus,
  type Corpus,
  mulberry32,
  type KernelCorpus,
} from '../src/core/testing/random-ir.js';
import { emitGlslModule, emitModule } from '../src/index.js';
import { computeArm } from './gl-compute-arm.js';
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
  /** Whether each pixel's run reached an input GLSL ES 3.00's bare operator leaves undefined,
   *  which the writer settles (Rule 11.12). */
  readonly settled: readonly boolean[];
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
      settled: run(taint, taintedName(f.name)).map((x) => x === 1),
      ...(refused !== undefined ? { refused } : {}),
      job: { id: key, frag, width: DRAW_W, height: DRAW_H, words: tableWords(d, sent) },
    };
  });
}

/** How many values a draw's comparison held to the oracle, how many of those a settled input
 *  reached, and how many it left out because the f32 oracle rounded them. */
interface DrawTally extends Tally {
  settled: number;
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
    if (tally !== undefined && k.settled[p]!) tally.settled += [k.want[p]].flat().length;
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
 *  compares, and those an input the bare GLSL operator leaves undefined reaches, must each reach
 *  about half of what 48 seeds give. */
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
const DRAW_COMPARED_FLOOR = 30000;
const DRAW_SETTLED_FLOOR = 20000;

/** The GLSL arm: each generated function drawn as a fragment program on WebGL2. */
async function webgl2Arm(page: Page): Promise<number> {
  const corpus = Array.from({ length: SEEDS }, (_, i) => generateModule(i + 1, { exact: true }));
  let failures = 0;
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
  // function whose oracle answers change under the shift, so a driver that agrees with the
  // oracle must report it. At pixel `p` the driver then computes pixel `q`'s answer, which is
  // the oracle's where the f32 oracle did not round it.
  // The oracle's cases are built a seed at a time, here and below, so a long sweep holds one
  // seed's in memory.
  const changes = (k: DrawCase): boolean =>
    k.refused === undefined &&
    k.want.some((v, p) => {
      const q = (p + 1) % k.want.length;
      return (
        JSON.stringify(k.want[q]) === JSON.stringify(k.exact[q]) &&
        firstDifference(v, k.want[q], 'k', k.exact[p]) !== undefined
      );
    });
  let shifted: DrawCase | undefined;
  for (const c of corpus) {
    shifted = drawCasesOf(c).find(changes);
    if (shifted !== undefined) break;
  }
  if (shifted === undefined) {
    console.error('FAIL  instrument: no drawn function changes when its table is a row off');
    return failures + 1;
  }
  const wrong = drawCasesOf(shifted.c, true).find((k) => k.d.fn.name === shifted.d.fn.name)!;

  let drawn = 0;
  let noted = 0;
  const tally: DrawTally = { compared: 0, rounded: 0, settled: 0 };
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
  // One seed at a time, so no one call to the page carries the whole corpus. The claim: every
  // drawn module's report lists nothing.
  const listed = new Map<string, string>();
  for (const c of corpus) {
    const mine = drawCasesOf(c);
    for (const k of mine)
      for (const r of determinismReport(k.d.module)) listed.set(`${r.op} (${r.kind})`, k.key);
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
  for (const [op, key] of listed) {
    console.error(`FAIL  the exact corpus uses ${op} (${key}), which has more than one answer`);
    failures += 1;
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
  // The writer settles what the bare operator leaves undefined (Rule 11.12), and the claim is
  // only as good as the corpus's reach into those inputs.
  if (tally.settled < DRAW_SETTLED_FLOOR) {
    console.error(
      `FAIL  ${String(tally.settled)} values reached an input the bare GLSL operator leaves undefined, under the floor of ${String(DRAW_SETTLED_FLOOR)}`,
    );
    failures += 1;
  }
  console.log(
    `glsl differential: ${String(drawn)} generated functions drawn on WebGL2, ${String(DRAW_W * DRAW_H)} argument lists each, against the f32 oracle · ` +
      `${String(tally.compared)} values bit for bit, ${String(tally.settled)} of them reached by an input the bare GLSL operator leaves undefined (Rule 11.12) · ` +
      `${String(tally.rounded)} the oracle rounded, left out · failures: ${String(failures)}`,
  );
  return failures;
}

/** Whether `want` is a value the f64 oracle gives too, with no NaN and no infinity: the f32 oracle
 *  did not round it, and the comparison holds the device to it bit for bit. */
function claimed(want: unknown, exact: unknown): boolean {
  if (Array.isArray(want)) return want.every((w, i) => claimed(w, (exact as unknown[])[i]));
  if (typeof want === 'object' && want !== null)
    return Object.entries(want).every(([k, w]) =>
      claimed(w, (exact as Record<string, unknown>)[k]),
    );
  return typeof want === 'number' && Number.isFinite(want) && want === exact;
}

/** What the chain arm's corpus must reach at the default 48 chains, at about a third of what they
 *  give: the groups fused, the calls in them, a group of three, the edges they keep in locals, the
 *  values compared and the values a call wrote, and the groups the planner keeps apart for each
 *  fact it can fail on (F1: a `continue`, no iteration; F2: the trip count, the start, the step;
 *  F3: a read or a write at another index; F4: two writes, a write after a read; F5: the buffers;
 *  F6: a call after a reduction). Then the scratch arrays: the chains with one a fused entry holds
 *  as a local, the chains with one that stays a buffer, and each clause of Rule 11.13 that keeps
 *  an array a buffer (`kept`). Then the reductions: the chains that end in one, the reductions
 *  fused as the last call of a group, the fold levels dispatched, and the most one reduction
 *  folded. */
const CHAIN_FLOORS = {
  fused: 28,
  members: 68,
  largest: 3,
  edges: 21,
  compared: 20000,
  written: 8000,
  refusals: [
    ['continues', 5],
    ['empty', 1],
    ['reduces', 1],
    ['trips', 25],
    ['start', 1],
    ['step', 1],
    ['waw', 2],
    ['war', 5],
    ['read', 4],
    ['write', 1],
    ['limit', 3],
  ],
  locals: 14,
  buffers: 50,
  chainsWithLocal: 6,
  chainsWithBuffer: 12,
  kept: [
    ['outside', 35],
    ['writers', 6],
    ['offset', 1],
    ['measured', 7],
  ],
  endingInReduction: 4,
  fusedReductions: 8,
  levels: 6,
  deepest: 2,
  deepFolded: 2,
} as const;

/** The sizes a chain runs at: `n` iterations for most of its calls, and `m` for the calls that run
 *  over another count. 70 is past one workgroup of 64, and not a multiple of it. 300 is past one
 *  workgroup of 256, the workgroup of a loop that reduces: its loop makes two partials, and one
 *  more dispatch folds them. */
const CHAIN_SIZES: readonly Sizes[] = [
  { n: 1, m: 2 },
  { n: 7, m: 3 },
  { n: 70, m: 33 },
  { n: 300, m: 129 },
];

/** A size past 65536 iterations, where a loop that reduces makes more than 256 partials: 274 of
 *  them, then 2, then 1, so that two dispatches fold the levels and the second reads what the first
 *  wrote from the place `_out` says (Rule 7.2). The f32 oracle takes seconds to run a generated
 *  chain over so many iterations, so the two chains that run at this size are built from source
 *  (`foldChain`). The fused module on the oracle takes longer still (`src/core/fuse-entry.test.ts`
 *  folds 70,000 elements in plain JavaScript for that reason), so only the device runs it. */
const DEEP_SIZE: Sizes = { n: 70000, m: 4000 };

/** One dispatch of a chain: its module and entry, the bindings of the entry (a uniform, or one
 *  of the job's arrays), its workgroups, and the words of its uniform. */
interface ChainDispatch {
  readonly wgsl: string;
  readonly entry: string;
  readonly bindings: readonly {
    readonly binding: number;
    readonly kind: 'uniform' | 'read-only-storage' | 'storage';
    readonly array?: number;
  }[];
  readonly wg: readonly [number, number, number];
  readonly uniform: readonly number[];
}

/** A stage of a chain: a dispatch, or the arrays of the job (by their place in it) zeroed where
 *  the job's fault puts them, the partials of a reduction between its levels. */
type ChainStage = ChainDispatch | { readonly clear: readonly number[] };

/** What the page runs: the arrays of a chain as 32-bit words, which stay in their buffers for the
 *  whole job, with the partials of its reductions after them, and its stages in order. They reach
 *  the queue in one submission, as the plan of a fuse scope does when nothing in it needs a read
 *  between two of them: the partials stay on the device between the levels of a reduction, each
 *  level with a uniform of its own. An array with no words has no buffer: it is a scratch array
 *  that an entry holds as a local, and a stage that binds it is an error. */
interface ChainJob {
  readonly id: string;
  readonly arrays: readonly { readonly words?: readonly number[]; readonly read: boolean }[];
  readonly stages: readonly ChainStage[];
}

interface ChainResult {
  readonly id: string;
  readonly error?: string;
  /** Each array read back, by its place in the job. */
  readonly read?: Readonly<Record<number, readonly number[]>>;
  /** The dispatches and the submissions the device was given while the job ran. */
  readonly dispatches: number;
  readonly submissions: number;
}

/** Runs INSIDE the browser: plain WebGPU, nothing from this package. The device is the one the
 *  other arm made, or a new one. The dispatches and submissions are counted where the device is
 *  given them: on the prototypes of the pass and of the queue. */
async function chainInPage(input: { jobs: ChainJob[]; broken?: string }): Promise<{
  adapter: string;
  limit: number;
  brokenReported?: boolean;
  results: ChainResult[];
}> {
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
  const counted = { dispatches: 0, submissions: 0 };
  const pass = GPUComputePassEncoder.prototype as unknown as {
    dispatchWorkgroups(...a: unknown[]): void;
  };
  const queue = GPUQueue.prototype as unknown as { submit(...a: unknown[]): void };
  const [dispatch, submit] = [pass.dispatchWorkgroups, queue.submit];
  pass.dispatchWorkgroups = function (this: unknown, ...a: unknown[]): void {
    counted.dispatches += 1;
    dispatch.apply(this, a);
  };
  queue.submit = function (this: unknown, ...a: unknown[]): void {
    counted.submissions += 1;
    submit.apply(this, a);
  };
  const results: ChainResult[] = [];
  try {
    for (const job of input.jobs) {
      device.pushErrorScope('validation');
      const made: GPUBuffer[] = [];
      const before = { ...counted };
      try {
        const modules = new Map<string, GPUShaderModule>();
        let bad: string | undefined;
        for (const s of job.stages) {
          if ('clear' in s || modules.has(s.wgsl) || bad !== undefined) continue;
          const module = device.createShaderModule({ code: s.wgsl });
          const errors = (await module.getCompilationInfo()).messages
            .filter((x) => x.type === 'error')
            .map((x) => `${String(x.lineNum)}:${String(x.linePos)} ${x.message}`);
          if (errors.length > 0) bad = `Tint: ${errors.join('; ')}`;
          else modules.set(s.wgsl, module);
        }
        if (bad !== undefined) {
          await device.popErrorScope();
          results.push({ id: job.id, error: bad, dispatches: 0, submissions: 0 });
          continue;
        }
        // A buffer is exactly its bytes: WGSL's `arrayLength` is the bound size over the stride.
        const buffers = job.arrays.map((a) => {
          if (a.words === undefined) return undefined;
          const buffer = device.createBuffer({
            size: Math.max(4, a.words.length * 4),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          });
          made.push(buffer);
          device.queue.writeBuffer(buffer, 0, new Uint32Array(a.words));
          return buffer;
        });
        const bufferOf = (i: number): GPUBuffer => {
          const buffer = buffers[i];
          if (buffer === undefined)
            throw new Error(`a stage reaches array ${String(i)}, which has no buffer`);
          return buffer;
        };
        const encoder = device.createCommandEncoder();
        for (const s of job.stages) {
          if ('clear' in s) {
            for (const i of s.clear) encoder.clearBuffer(bufferOf(i));
            continue;
          }
          const uniform = device.createBuffer({
            size: Math.max(16, s.uniform.length * 4),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          made.push(uniform);
          device.queue.writeBuffer(uniform, 0, new Uint32Array(s.uniform));
          const bgl = device.createBindGroupLayout({
            entries: s.bindings.map((b) => ({
              binding: b.binding,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: b.kind },
            })),
          });
          const pipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
            compute: { module: modules.get(s.wgsl)!, entryPoint: s.entry },
          });
          const group = device.createBindGroup({
            layout: bgl,
            entries: s.bindings.map((b) => ({
              binding: b.binding,
              resource: { buffer: b.array === undefined ? uniform : bufferOf(b.array) },
            })),
          });
          const p = encoder.beginComputePass();
          p.setPipeline(pipeline);
          p.setBindGroup(0, group);
          p.dispatchWorkgroups(s.wg[0], s.wg[1], s.wg[2]);
          p.end();
        }
        device.queue.submit([encoder.finish()]);
        const given = {
          dispatches: counted.dispatches - before.dispatches,
          submissions: counted.submissions - before.submissions,
        };
        const reads = job.arrays.flatMap((a, i) => (a.read ? [{ i, buffer: bufferOf(i) }] : []));
        const staging = reads.map(({ buffer }) => {
          const s = device.createBuffer({
            size: buffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          });
          made.push(s);
          return s;
        });
        const copy = device.createCommandEncoder();
        reads.forEach(({ buffer }, k) =>
          copy.copyBufferToBuffer(buffer, 0, staging[k]!, 0, buffer.size),
        );
        device.queue.submit([copy.finish()]);
        await Promise.all(staging.map((s) => s.mapAsync(GPUMapMode.READ)));
        const read: Record<number, number[]> = {};
        reads.forEach(({ i }, k) => {
          read[i] = Array.from(new Uint32Array(staging[k]!.getMappedRange().slice(0)));
          staging[k]!.unmap();
        });
        const scope = await device.popErrorScope();
        results.push(
          scope === null
            ? { id: job.id, read, ...given }
            : { id: job.id, error: `validation: ${scope.message}`, ...given },
        );
      } catch (e) {
        await device.popErrorScope();
        results.push({
          id: job.id,
          error: `threw: ${e instanceof Error ? e.message : String(e)}`,
          dispatches: 0,
          submissions: 0,
        });
      } finally {
        for (const b of made) b.destroy();
      }
    }
  } finally {
    pass.dispatchWorkgroups = dispatch;
    queue.submit = submit;
  }
  return {
    adapter: g.__adapter ?? '?',
    limit: device.limits.maxStorageBuffersPerShaderStage,
    ...(brokenReported !== undefined ? { brokenReported } : {}),
    results,
  };
}

/** The manifest of a module, built once. */
const manifests = new WeakMap<ModuleDecl, ReturnType<typeof buildManifest>>();
function layoutIn(m: ModuleDecl, name: string): PackLayout {
  let manifest = manifests.get(m);
  if (manifest === undefined) manifests.set(m, (manifest = buildManifest(m)));
  const b = manifest.bindings.find((x) => x.name === name);
  if (b?.layout === undefined) throw new Error(`gpu-differential: no layout for "${name}"`);
  return b.layout;
}

/** The words of a uniform struct: its layout's size, at least. */
const uniformWords = (l: PackLayout, v: unknown): number[] =>
  wordsOf(l, v as CpuValue, l.kind === 'struct' ? l.size : 4);

/** A chain at one size: the planner's groups, the groups the facts give, and the oracle's answer. */
interface ChainCase {
  readonly key: string;
  readonly c: ChainCorpus;
  readonly lows: readonly Lowered[];
  readonly sizes: Sizes;
  readonly inputs: Inputs;
  readonly calls: readonly GroupCall[];
  readonly groups: readonly Group[];
  readonly model: readonly ModelGroup[];
  readonly want: ChainOutcome;
  /** The same chain on the f64 oracle: where a value differs from `want`'s, the f32 run rounded
   *  it, and a driver that groups the arithmetic otherwise may round it otherwise (#378). */
  readonly exact: ChainOutcome;
}

/** Where a reduced variable is once the stages have run: a slot of its partials' array in the job,
 *  or, for a loop that ran no iteration, the identity of its operator. */
type ChainFold =
  | { readonly array: number; readonly at: number; readonly layout: PackLayout }
  | { readonly identity: CpuValue };

/** A job, or why a group of the plan has no entry, and for each call that reduces (by its place in
 *  the chain) where the variables it folds are. */
interface ChainStages {
  readonly job?: ChainJob;
  readonly none?: string;
  readonly folds: ReadonlyMap<number, readonly ChainFold[]>;
}

/** The calls with the partials of each reduction taken out of the face the planner reads: the
 *  planner of a chain that does not count them (F5). Only the planner sees them; the entry is built
 *  from the faces as they are. */
function withoutPartials(calls: readonly GroupCall[]): GroupCall[] {
  return calls.map((call) => {
    const gpu = call.k.gpu;
    if (gpu?.loops[0]?.reduce === undefined) return call;
    const loops = gpu.loops.map((l, i) => (i === 0 ? { ...l, reduce: undefined } : l));
    return { ...call, k: { ...call.k, gpu: { ...gpu, loops } } } as GroupCall;
  });
}

/** The job that runs `groups` of case `k` on the page: a fused group as the entry the builder made,
 *  in the dispatches `fusedRun` gives, and every other call as its own lowered plan, as
 *  `callKernel` dispatches it. A scratch array that a fused group holds as a local has no buffer.
 *  A call that reduces dispatches its loop and then one fold for each level of partials, over
 *  partials that stay in a buffer of the job. With a fault, every fused group is dispatched wrong
 *  on purpose. */
function chainJobOf(
  k: ChainCase,
  groups: readonly PlannedGroup[],
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  id: string,
  fault?: GroupFault,
): ChainStages {
  const { c, inputs } = k;
  const layouts = new Map<string, PackLayout>();
  c.calls.forEach((call, j) => {
    for (const a of call.access)
      if (!layouts.has(a.array)) layouts.set(a.array, layoutIn(lows[j]!.plan.module, a.param));
  });
  const at = (id: string): number => c.arrays.findIndex((a) => a.id === id);
  const locals = new Set(
    groups.flatMap((g) => (g.contracted ?? []).map((a) => (a as ChainArray).id)),
  );
  const stages: ChainStage[] = [];
  const folds = new Map<number, ChainFold[]>();
  const partials: { readonly words: readonly number[]; readonly read: boolean }[] = [];
  /** The partials of a reduction as arrays of the job, after the chain's own, by binding name. */
  const partialsOf = (
    m: ModuleDecl,
    schedule: readonly PlanSchedule['partials'][number][],
  ): Map<string, number> => {
    const out = new Map<string, number>();
    for (const p of schedule) {
      const l = layoutIn(m, p.binding);
      out.set(p.binding, c.arrays.length + partials.length);
      partials.push({
        words: new Array<number>(((l.kind === 'array' ? l.stride : 4) * p.slots) / 4).fill(0),
        read: true,
      });
    }
    return out;
  };
  const foldsOf = (
    m: ModuleDecl,
    run: readonly PlanFold[],
    where: ReadonlyMap<string, number>,
  ): ChainFold[] =>
    run.map((f) =>
      'identity' in f
        ? f
        : { array: where.get(f.binding)!, at: f.at, layout: layoutIn(m, f.binding) },
    );
  for (const g of groups) {
    if (g.calls.length > 1) {
      const built = fuseGroup(lows, calls, g.calls, g.contracted);
      if ('none' in built)
        return { none: `the group of ${g.calls.join(', ')}: ${built.none}`, folds };
      const { fused, arrays } = built;
      const run = fusedRun(c, lows, calls, g.calls, inputs, fused, fault);
      const where = partialsOf(fused.module, run.partials);
      const argsLayout = layoutIn(fused.module, fused.args.name);
      /** The bindings of an entry of the fused module: its uniform, the arrays its slots bind,
       *  and the partials of the reduction. */
      const bindingsOf = (entry: ComputeEntry): ChainDispatch['bindings'] =>
        entry.bindings.map((b) => {
          if (b.name === fused.args.name) return { binding: b.binding, kind: 'uniform' as const };
          const slot = fused.slots.find((x) => x.name === b.name);
          if (slot !== undefined)
            return {
              binding: b.binding,
              kind:
                slot.binding.rw === true ? ('storage' as const) : ('read-only-storage' as const),
              array: at((arrays[slot.array] as ChainArray).id),
            };
          const part = where.get(b.name);
          if (part === undefined)
            throw new Error(`gpu-differential: the entry binds "${b.name}", which no stage knows`);
          return { binding: b.binding, kind: 'storage' as const, array: part };
        });
      for (const st of run.steps) {
        if ('clear' in st) {
          stages.push({ clear: st.clear.map((name) => where.get(name)!) });
          continue;
        }
        const entry = st.entry === fused.entry.fn ? fused.entry : fused.reduce!.fold;
        stages.push({
          wgsl:
            fault === 'local-starts-at-one' && entry === fused.entry
              ? localsStartingAtOne(entry.wgsl, g.contracted?.length ?? 0)
              : entry.wgsl,
          entry: entry.fn,
          bindings: bindingsOf(entry),
          wg: st.wg,
          uniform: uniformWords(argsLayout, st.values),
        });
      }
      const last = g.calls[g.calls.length - 1]!;
      if (c.calls[last]!.reduces > 0) folds.set(last, foldsOf(fused.module, run.folds, where));
      continue;
    }
    const i = g.calls[0]!;
    const low = lows[i]!;
    const gpu = low.face.gpu!;
    const uniform = layoutIn(low.plan.module, low.plan.argsBinding);
    const schedule = scheduleKernelPlan(low.m, low.fn, low.plan, callArgs(c, i, inputs));
    const where = partialsOf(low.plan.module, schedule.partials);
    const reduce = gpu.loops[0]!.reduce;
    for (const s of schedule.steps) {
      // The entry that folds a level of partials reaches the partials and the uniform only.
      const folding = reduce !== undefined && s.entry === reduce.entry;
      stages.push({
        wgsl: gpu.wgsl,
        entry: s.entry,
        bindings: [
          { binding: gpu.args.binding, kind: 'uniform' },
          ...(folding
            ? []
            : gpu.arrays.map((b) => ({
                binding: b.binding,
                kind: b.rw === true ? ('storage' as const) : ('read-only-storage' as const),
                array: at(
                  (
                    c.calls[i]!.args[low.face.params.findIndex((p) => p.name === b.name)] as {
                      array: string;
                    }
                  ).array,
                ),
              }))),
          ...(reduce?.vars ?? []).map((v) => ({
            binding: v.binding.binding,
            kind: 'storage' as const,
            array: where.get(v.binding.name)!,
          })),
        ],
        wg: s.workgroups,
        uniform: uniformWords(uniform, s.args),
      });
    }
    if (reduce !== undefined) folds.set(i, foldsOf(low.plan.module, schedule.folds, where));
  }
  return {
    job: {
      id,
      arrays: [
        ...c.arrays.map((a) => ({
          ...(locals.has(a.id)
            ? {}
            : {
                words: wordsOf(layouts.get(a.id)!, inputs.arrays.get(a.id) as unknown as CpuValue),
              }),
          read: a.written && !a.scratch,
        })),
        ...partials,
      ],
      stages,
    },
    folds,
  };
}

/** What the GPU left, read back into the arrays a chain writes that the host reads, and the
 *  results its calls return: the CPU tail's, over the variables a call that reduces folded. */
function chainGot(
  k: ChainCase,
  r: ChainResult,
  folds: ReadonlyMap<number, readonly ChainFold[]>,
): ChainOutcome {
  const { c, lows, inputs } = k;
  const layouts = new Map<string, PackLayout>();
  c.calls.forEach((call, j) => {
    for (const a of call.access)
      if (!layouts.has(a.array)) layouts.set(a.array, layoutIn(lows[j]!.plan.module, a.param));
  });
  const arrays: Record<string, CpuValue> = {};
  c.arrays.forEach((a, i) => {
    if (a.written && !a.scratch)
      arrays[a.id] = unpack(viewOf(r.read![i]!), 0, layouts.get(a.id)!, lengthOf(a, k.sizes));
  });
  const results: Record<string, CpuValue> = {};
  c.calls.forEach((_, j) => {
    const low = lows[j]!;
    const folded = (folds.get(j) ?? []).map((f) => {
      if ('identity' in f) return f.identity;
      const stride = f.layout.kind === 'array' ? f.layout.stride : 4;
      const element = f.layout.kind === 'array' ? f.layout.element : f.layout;
      return unpack(viewOf(r.read![f.array]!), f.at * stride, element, 0);
    });
    const v = tailOf(low.m, low.fn, low.plan, callArgs(c, j, inputs), folded);
    if (v !== undefined) results[low.fn] = v;
  });
  return { arrays, results };
}

/** How many arrays the calls `idx` of a group read after an earlier call of the group wrote them:
 *  the edges a fused entry keeps in a local. */
function edgesIn(c: ChainCorpus, idx: readonly number[]): number {
  let edges = 0;
  idx.forEach((j, p) => {
    for (const a of c.calls[j]!.access)
      if (
        a.reads !== 'none' &&
        idx
          .slice(0, p)
          .some((i) => c.calls[i]!.access.some((w) => w.array === a.array && w.writes !== 'none'))
      )
        edges += 1;
  });
  return edges;
}

/** How many values of the arrays a chain writes that the host reads the calls changed, on the
 *  oracle: the values the comparison could not have held to the old contents. */
function writtenIn(k: ChainCase): number {
  let n = 0;
  for (const a of k.c.arrays) {
    if (!a.written || a.scratch) continue;
    const before = k.inputs.arrays.get(a.id)!;
    const after = k.want.arrays[a.id] as unknown as unknown[];
    for (let i = 0; i < before.length; i++)
      if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) n += 1;
  }
  return n;
}

/** The sizes a chain runs at: a small one and a large one, each by the seed. A chain with a call
 *  that reduces runs its large size at 300, where the loop makes two partials and one fold level
 *  follows. */
const sizesOf = (c: ChainCorpus): readonly [Sizes, Sizes] => [
  CHAIN_SIZES[c.seed % 2]!,
  CHAIN_SIZES[2 + (c.seed % 3 === 0 || c.calls.some((call) => call.reduces > 0) ? 1 : 0)]!,
];

/** Why the groups the planner made are not the groups the facts give, or undefined. The scratch
 *  arrays a group holds as locals are part of the groups. */
function groupingDifference(
  planned: readonly Group[],
  model: readonly ModelGroup[],
): string | undefined {
  const want = JSON.stringify(shapeOf(model));
  const got = JSON.stringify(shapeOf(planned));
  if (want !== got) return `the planner made ${got}, the facts give ${want}`;
  for (const [i, g] of planned.entries()) {
    const reason = reasonOf(g.why);
    if (reason !== model[i]!.because)
      return `group ${String(i)} stands apart for ${String(reason)} by the planner (${String(g.why)}), and for ${String(model[i]!.because)} by the facts`;
    const held = g.contracted.map((a) => (a as ChainArray).id).sort();
    const facts = [...model[i]!.contracted].sort();
    if (JSON.stringify(held) !== JSON.stringify(facts))
      return `group ${String(i)} holds ${JSON.stringify(held)} as locals by the planner, and ${JSON.stringify(facts)} by the facts`;
  }
  return undefined;
}

/** The chain arm: generated chains of kernel calls, fused where the facts allow on WebGPU, every
 *  array they write that the host reads and every result held to the same calls run apart on the
 *  f32 oracle. */
async function chainArm(page: Page): Promise<number> {
  const corpus = Array.from({ length: SEEDS }, (_, i) => generateChain(i + 1, { exact: true }));
  let failures = 0;
  let noted = 0;
  const note = (line: string): void => {
    failures += 1;
    if (noted++ < 20) console.log(`FAIL  ${line}`);
  };
  // The claim this arm compares bit for bit: the report lists nothing but `order`.
  const listed = new Map<string, number>();
  for (const c of corpus)
    for (const r of determinismReport(c.module))
      if (r.kind !== 'order') listed.set(`${r.op} (${r.kind})`, c.seed);
  for (const [op, seed] of listed)
    note(`the exact chains use ${op} (seed ${String(seed)}), which has more than one answer`);
  const faced = corpus.map((c) => ({ c, lows: lowerChain(c) }));
  for (const f of faced)
    if ('none' in f.lows) note(`chain seed ${String(f.c.seed)}: ${f.lows.none}`);
  const lowered = faced.flatMap((f) => ('none' in f.lows ? [] : [{ c: f.c, lows: f.lows }]));

  const first = await page.evaluate(chainInPage, { jobs: [], broken: 'fn broken( {' });
  console.log(
    `chain differential: the device binds ${String(first.limit)} storage buffers to a dispatch`,
  );
  if (first.brokenReported === true)
    console.log("instrument: Tint REPORTED a non-program, so a chain's verdict can fail");
  else note('instrument: Tint accepted a non-program, so every verdict below would be blind');
  const limit = first.limit;

  // The chain at each of its sizes, or at those of at least `least` iterations: the planner's
  // groups against the facts, and the oracle. `runs` numbers the sizes from the run it starts at,
  // which tells apart the inputs of the runs of one chain.
  const cases = (
    c: ChainCorpus,
    lows: readonly Lowered[],
    least = 0,
    sizes: readonly Sizes[] = sizesOf(c),
    runs = 0,
  ): ChainCase[] =>
    sizes.flatMap((size, i) => {
      if (size.n < least) return [];
      const inputs = inputsOf(c, size, c.seed + runs + i, scalarOf);
      const calls = groupCallsOf(c, lows, inputs);
      return [
        {
          key: `seed ${String(c.seed)} n=${String(size.n)} m=${String(size.m)}${(c.seed + runs + i) % 2 === 1 ? ' boundary' : ''}`,
          c,
          lows,
          sizes: size,
          inputs,
          calls,
          groups: planChain(c, calls, limit),
          model: modelGroups(c, size, limit),
          want: runApart(c, inputs, 'f32'),
          exact: runApart(c, inputs, 'f64'),
        },
      ];
    });

  // The instruments, each run wrong on purpose, on the first chain that shows them.
  //   - A fused group dispatched with its first iteration skipped. The oracle gives other values
  //     for it too, so a GPU that agrees with the oracle must report it.
  //   - A chain dispatched apart where the facts fuse. The device is given more dispatches than the
  //     facts give.
  //   - A face whose facts say every read is at the counter, as a compiler that took each read
  //     for one would write it. The planner fuses a group whose consumer reads another index, so
  //     the grouping differs from the facts'. The builder reads the producer's element in the
  //     place of the consumer's, which changes a value wherever the consumer uses it.
  //   - A scratch array held as a local against the facts: a call reads at another index a scratch
  //     array that the call before it wrote, and the two run as one group with the array a local.
  //     The entry reads the element the first call wrote, which changes a value wherever the
  //     second call uses what it reads.
  //   - A reduction fused with the calls before it, its last level of partials not folded, and
  //     again with its partials zeroed between the loop and the first fold. The folded value
  //     differs wherever the partials of the missing level or of the loop held something.
  //   - A scratch array that stays a buffer, started with words other than zeros. The plan makes
  //     it a zeroed buffer, and a call that writes it under a condition leaves the words it
  //     started with for the next call to read.
  interface Lies {
    readonly k: ChainCase;
    readonly lows: Lowered[];
    readonly calls: GroupCall[];
    readonly groups: Group[];
    /** Whether the oracle gives other values for it too, so that the device can be asked. */
    readonly changes: boolean;
  }
  const liesOf = (k: ChainCase): Lies | undefined => {
    if (!k.model.some((g) => g.because === 'read')) return undefined;
    const wrong = k.lows.map(readsAtCounter);
    const calls = groupCallsOf(k.c, wrong, k.inputs);
    const groups = planChain(k.c, calls, limit);
    if (groupingDifference(groups, k.model) === undefined) return undefined;
    // The planner holds a scratch array of a stencil as a local, which the builder refuses when a
    // call names its length: the plan is no instrument then.
    let run: ChainOutcome;
    try {
      run = runGrouped(k.c, wrong, calls, groups, k.inputs);
    } catch {
      return undefined;
    }
    return {
      k,
      lows: wrong,
      calls,
      groups,
      changes: firstDifference(k.want, run, 'chain', k.exact) !== undefined,
    };
  };
  /** The plan that holds a scratch array of a stencil as a local against the facts, if the oracle
   *  gives other values for it. */
  const contractedOf = (k: ChainCase): { k: ChainCase; groups: PlannedGroup[] } | undefined => {
    const stencil = scratchStencil(k.c, k.model);
    if (stencil === undefined) return undefined;
    const groups = contractAgainstFacts(k.groups, stencil);
    try {
      const run = runGrouped(k.c, k.lows, k.calls, groups, k.inputs);
      return firstDifference(k.want, run, 'chain', k.exact) !== undefined
        ? { k, groups }
        : undefined;
    } catch {
      return undefined;
    }
  };
  /** Whether `k` fuses a reduction with the calls before it and folds its partials in a level. */
  const foldedFused = (k: ChainCase): boolean =>
    k.groups.some(
      (g) =>
        g.fused &&
        k.c.calls[g.calls[g.calls.length - 1]!]!.reduces > 0 &&
        foldLevels(tripsOf(k.c.calls[g.calls[0]!]!, k.sizes)) > 0,
    );
  /** The case with the scratch arrays holding values in the place of zeros. */
  const dirty = (k: ChainCase): ChainCase => ({
    ...k,
    inputs: withScratchContents(k.c, k.inputs, k.c.seed, scalarOf),
  });
  /** Whether a plan that does not zero the scratch buffers gives other values on the oracle. */
  const unzeroedBy = (k: ChainCase): boolean => {
    const d = dirty(k);
    return (
      firstDifference(
        k.want,
        runGrouped(d.c, d.lows, d.calls, d.groups, d.inputs),
        'chain',
        k.exact,
      ) !== undefined
    );
  };
  const wrongBy = (k: ChainCase, fault: GroupFault): boolean =>
    firstDifference(
      k.want,
      runGrouped(k.c, k.lows, k.calls, k.groups, k.inputs, { fault }),
      'chain',
      k.exact,
    ) !== undefined;
  const probes: {
    skip?: ChainCase;
    apart?: ChainCase;
    lies?: Lies;
    contract?: { k: ChainCase; groups: PlannedGroup[] };
    short?: ChainCase;
    zeroed?: ChainCase;
    unzeroed?: ChainCase;
  } = {};
  for (const { c, lows } of lowered) {
    if (
      probes.skip !== undefined &&
      probes.apart !== undefined &&
      probes.lies !== undefined &&
      probes.short !== undefined &&
      probes.zeroed !== undefined &&
      probes.unzeroed !== undefined
    )
      break;
    for (const k of cases(c, lows)) {
      const fused = k.groups.some((g) => g.fused);
      if (probes.apart === undefined && fused) probes.apart = k;
      if (probes.skip === undefined && fused && k.sizes.n >= 8) {
        const wrong = runGrouped(k.c, k.lows, k.calls, k.groups, k.inputs, {
          fault: 'skip-first-iteration',
        });
        if (firstDifference(k.want, wrong, 'chain', k.exact) !== undefined) probes.skip = k;
      }
      if (probes.lies === undefined && k.sizes.n >= 8) probes.lies = liesOf(k);
      if (probes.short === undefined && foldedFused(k) && wrongBy(k, 'drop-last-level'))
        probes.short = k;
      if (probes.zeroed === undefined && foldedFused(k) && wrongBy(k, 'zero-partials'))
        probes.zeroed = k;
      if (probes.unzeroed === undefined && unzeroedBy(k)) probes.unzeroed = k;
    }
  }
  // A value changes only where the consumer uses what it reads, which a few chains in a hundred do:
  // chains past the corpus are drawn until one does, so that the device is asked too.
  for (let seed = SEEDS + 1; probes.lies?.changes !== true && seed <= SEEDS + 1000; seed++) {
    const c = generateChain(seed, { exact: true });
    if (!modelGroups(c, sizesOf(c)[1], limit).some((g) => g.because === 'read')) continue;
    const lows = lowerChain(c);
    if ('none' in lows) continue;
    for (const k of cases(c, lows, 8)) probes.lies = liesOf(k) ?? probes.lies;
  }
  // The same for a fused reduction whose partials hold something a missing level or a zeroing
  // changes.
  for (
    let seed = SEEDS + 1;
    (probes.short === undefined || probes.zeroed === undefined) && seed <= SEEDS + 1000;
    seed++
  ) {
    const c = generateChain(seed, { exact: true });
    if (!c.calls.some((call) => call.reduces > 0)) continue;
    const lows = lowerChain(c);
    if ('none' in lows) continue;
    for (const k of cases(c, lows, 8)) {
      if (probes.short === undefined && foldedFused(k) && wrongBy(k, 'drop-last-level'))
        probes.short = k;
      if (probes.zeroed === undefined && foldedFused(k) && wrongBy(k, 'zero-partials'))
        probes.zeroed = k;
    }
  }
  // The generator rarely draws a scratch array that a stencil keeps in storage together with a
  // value that depends on it (one chain in many hundreds), so the chain of this instrument is
  // built from source (`stencilChain`).
  {
    const c = stencilChain();
    const lows = lowerChain(c);
    if ('none' in lows) note(`instrument: the stencil chain: ${lows.none}`);
    else for (const k of cases(c, lows, 0, [{ n: 70, m: 33 }])) probes.contract ??= contractedOf(k);
  }
  for (const [what, k] of [
    ['a fused group dispatched with its first iteration skipped', probes.skip],
    ['a face whose facts say every read is at the counter', probes.lies],
    ['a chain dispatched apart where the planner fuses', probes.apart],
    ['a scratch array held as a local against the facts', probes.contract],
    ['a reduction fused with its last level of partials not folded', probes.short],
    ['a reduction fused with its partials zeroed between the levels', probes.zeroed],
    ['a scratch array that stays a buffer, started with other words than zeros', probes.unzeroed],
  ] as const)
    if (k === undefined) note(`instrument: no chain of the corpus shows ${what}`);
  // Each instrument is a job run wrong on purpose and what the comparison says of it.
  interface Instrument {
    readonly what: string;
    readonly stages: ChainStages;
    /** What reports it, or undefined when the comparison did not. */
    readonly report: (r: ChainResult, s: ChainStages) => string | undefined;
  }
  const differs = (k: ChainCase, r: ChainResult, s: ChainStages): string | undefined =>
    r.error === undefined
      ? firstDifference(k.want, chainGot(k, r, s.folds), 'chain', k.exact)
      : `did not run (${r.error})`;
  const dispatches = (k: ChainCase): number => dispatchesOf(k.c, k.sizes, k.model);
  const instruments: Instrument[] = [];
  const { skip, lies, apart, contract, short, zeroed, unzeroed } = probes;
  if (skip)
    instruments.push({
      what: 'a fused group dispatched with its first iteration skipped',
      stages: chainJobOf(skip, skip.groups, skip.lows, skip.calls, 'skip', 'skip-first-iteration'),
      report: (r, s) => {
        const d = differs(skip, r, s);
        return d !== undefined ? `(${d.slice(0, 100)})` : undefined;
      },
    });
  if (lies)
    instruments.push({
      what: 'a face whose facts say every read is at the counter',
      stages: chainJobOf(lies.k, lies.groups, lies.lows, lies.calls, 'lies'),
      report: (r, s) => {
        const grouping = groupingDifference(lies.groups, lies.k.model)!;
        const d = lies.changes ? differs(lies.k, r, s) : undefined;
        // The values on the GPU are asked for when the oracle gives other values for the plan.
        if (lies.changes && d === undefined) return undefined;
        return `by the grouping (${grouping.slice(0, 80)})${d !== undefined ? ` and by the GPU (${d.slice(0, 80)})` : ''}`;
      },
    });
  if (apart)
    instruments.push({
      what: 'a chain dispatched apart where the facts fuse',
      stages: chainJobOf(
        apart,
        apart.calls.map((_, i) => ({ calls: [i] })),
        apart.lows,
        apart.calls,
        'apart',
      ),
      report: (r) =>
        r.dispatches !== dispatches(apart)
          ? `by the dispatch count (${String(r.dispatches)} for the ${String(dispatches(apart))} the facts give)`
          : undefined,
    });
  if (contract)
    instruments.push({
      what: 'a scratch array held as a local against the facts',
      stages: chainJobOf(
        contract.k,
        contract.groups,
        contract.k.lows,
        contract.k.calls,
        'contract',
      ),
      report: (r, s) => {
        const d = differs(contract.k, r, s);
        return d !== undefined ? `(${d.slice(0, 100)})` : undefined;
      },
    });
  for (const [what, k, fault] of [
    ['a reduction fused with its last level of partials not folded', short, 'drop-last-level'],
    ['a reduction fused with its partials zeroed between the levels', zeroed, 'zero-partials'],
  ] as const)
    if (k)
      instruments.push({
        what,
        stages: chainJobOf(k, k.groups, k.lows, k.calls, fault, fault),
        report: (r, s) => {
          const d = differs(k, r, s);
          const byCount = r.dispatches !== dispatches(k);
          if (d === undefined && !byCount) return undefined;
          return [
            ...(d !== undefined ? [`by the GPU (${d.slice(0, 80)})`] : []),
            ...(byCount
              ? [
                  `by the dispatch count (${String(r.dispatches)} for the ${String(dispatches(k))} the facts give)`,
                ]
              : []),
          ].join(' and ');
        },
      });
  if (unzeroed)
    instruments.push({
      what: 'a scratch array that stays a buffer, started with other words than zeros',
      stages: chainJobOf(
        dirty(unzeroed),
        unzeroed.groups,
        unzeroed.lows,
        unzeroed.calls,
        'unzeroed',
      ),
      report: (r, s) => {
        const d = differs(unzeroed, r, s);
        return d !== undefined ? `(${d.slice(0, 100)})` : undefined;
      },
    });
  // Two chains built from source, for the faults the generated corpus does not reach: a planner
  // that does not count the partials of a reduction against the storage-buffer limit (F5), and a
  // scratch local that starts at one. Each is first checked against the facts, so that a REPORTED
  // instrument is the planner's or the entry's fault and not the chain's.
  const handBuilt = (c: ChainCorpus): ChainCase | undefined => {
    const lows = lowerChain(c);
    if ('none' in lows) {
      note(`instrument: the chain ${String(c.seed)} built from source: ${lows.none}`);
      return undefined;
    }
    const [k] = cases(c, lows, 0, [{ n: 70, m: 33 }]);
    const why = k === undefined ? 'it has no case' : groupingDifference(k.groups, k.model);
    if (k === undefined || why !== undefined) {
      note(
        `instrument: the chain ${String(c.seed)} built from source disagrees with its facts: ${String(why)}`,
      );
      return undefined;
    }
    return k;
  };
  const limitCase = handBuilt(limitChain());
  const localCase = handBuilt(localChain());
  if (limitCase) {
    const unpartialed = planChain(limitCase.c, withoutPartials(limitCase.calls), limit);
    instruments.push({
      what: 'a planner that does not count the partials of a reduction against the limit',
      stages: chainJobOf(limitCase, unpartialed, limitCase.lows, limitCase.calls, 'limit'),
      report: (r, s) => {
        const grouping = groupingDifference(unpartialed, limitCase.model);
        const d = differs(limitCase, r, s);
        if (grouping === undefined && d === undefined) return undefined;
        return [
          ...(grouping !== undefined ? [`by the grouping (${grouping.slice(0, 80)})`] : []),
          ...(d !== undefined ? [`by the GPU (${d.slice(0, 80)})`] : []),
        ].join(' and ');
      },
    });
  }
  if (localCase)
    instruments.push({
      what: 'a scratch local of a fused entry that starts at one, not zero',
      stages: chainJobOf(
        localCase,
        localCase.groups,
        localCase.lows,
        localCase.calls,
        'local',
        'local-starts-at-one',
      ),
      report: (r, s) => {
        const d = differs(localCase, r, s);
        return d !== undefined ? `(${d.slice(0, 100)})` : undefined;
      },
    });
  const bad = instruments.find((i) => i.stages.job === undefined);
  if (bad !== undefined) note(`instrument: ${bad.stages.none ?? 'a job has no stages'}`);
  else {
    const { results } = await page.evaluate(chainInPage, {
      jobs: instruments.map((i) => i.stages.job!),
    });
    instruments.forEach((inst, n) => {
      const text = inst.report(results[n]!, inst.stages);
      if (text !== undefined) console.log(`instrument: ${inst.what} was REPORTED ${text}`);
      else note(`instrument: ${inst.what} matched the oracle`);
    });
  }

  // The chains. One chain at a time, so no one call to the page carries the whole corpus. Two
  // chains built from source follow the corpus, at DEEP_SIZE: a reduction fused with the call
  // before it, and one that stands alone.
  const queue: { c: ChainCorpus; lows: readonly Lowered[]; sizes?: readonly Sizes[] }[] = [
    ...lowered,
  ];
  for (const c of [foldChain(true), foldChain(false)]) {
    const lows = lowerChain(c);
    if ('none' in lows) note(`the fold chain ${String(c.seed)}: ${lows.none}`);
    else queue.push({ c, lows, sizes: [DEEP_SIZE] });
  }
  const tally: Tally = { compared: 0, rounded: 0 };
  // The runs at DEEP_SIZE count apart, so that the floors speak of the sizes every chain runs at.
  const deepTally: Tally = { compared: 0, rounded: 0 };
  const reach = {
    chains: 0,
    calls: 0,
    runs: 0,
    deep: 0,
    dispatches: 0,
    groups: 0,
    fused: 0,
    members: 0,
    largest: 0,
    edges: 0,
    written: 0,
    locals: 0,
    buffers: 0,
    reducing: 0,
    fusedReductions: 0,
    levels: 0,
    deepest: 0,
    deepFolded: 0,
  };
  const withLocal = new Set<number>();
  const withBuffer = new Set<number>();
  const endingInReduction = new Set<number>();
  const keptFor = new Map<Fate, number>();
  const apartFor = new Map<string, number>();
  for (const { c, lows, sizes } of queue) {
    const mine = cases(c, lows, 0, sizes);
    if (sizes === undefined) {
      reach.chains += 1;
      if (c.calls[c.calls.length - 1]!.reduces > 0) endingInReduction.add(c.seed);
    }
    const jobs: { k: ChainCase; stages: ChainStages }[] = mine.map((k) => ({
      k,
      stages: chainJobOf(k, k.groups, k.lows, k.calls, k.key),
    }));
    for (const { k, stages } of jobs)
      if (stages.job === undefined) note(`${k.key}: ${stages.none ?? 'no job'}`);
    const run = jobs.filter((j) => j.stages.job !== undefined);
    const { results } = await page.evaluate(chainInPage, { jobs: run.map((j) => j.stages.job!) });
    run.forEach(({ k, stages }, i) => {
      const r = results[i]!;
      reach.runs += 1;
      if (k.sizes === DEEP_SIZE) reach.deep += 1;
      reach.calls += k.c.calls.length;
      reach.dispatches += r.dispatches;
      reach.groups += k.groups.length;
      for (const g of k.groups) {
        if (g.fused) {
          reach.fused += 1;
          reach.members += g.calls.length;
          reach.largest = Math.max(reach.largest, g.calls.length);
          reach.edges += edgesIn(k.c, g.calls);
        }
        const why = reasonOf(g.why);
        if (why !== undefined) apartFor.set(why, (apartFor.get(why) ?? 0) + 1);
      }
      // The scratch arrays the facts hold as locals, and the clause that keeps each of the others
      // a buffer.
      for (const fate of scratchFates(k.c, k.model).values()) {
        if (fate === 'local') {
          reach.locals += 1;
          withLocal.add(k.c.seed);
        } else {
          reach.buffers += 1;
          withBuffer.add(k.c.seed);
          keptFor.set(fate, (keptFor.get(fate) ?? 0) + 1);
        }
      }
      // The calls that reduce, and the levels of partials the facts fold them in.
      k.model.forEach((g) => {
        const last = g.calls[g.calls.length - 1]!;
        const trips = tripsOf(k.c.calls[g.calls[0]!]!, k.sizes);
        if (k.c.calls[last]!.reduces === 0) return;
        reach.reducing += 1;
        if (g.calls.length > 1) reach.fusedReductions += 1;
        if (trips === 0) return;
        reach.levels += foldLevels(trips);
        reach.deepest = Math.max(reach.deepest, foldLevels(trips));
      });
      // The groups against the facts, the dispatches the device was given against both, and the
      // bits against the oracle.
      const grouping = groupingDifference(k.groups, k.model);
      if (grouping !== undefined) note(`${k.key}: ${grouping}`);
      const expected = dispatchesOf(k.c, k.sizes, k.model);
      if (r.error === undefined && r.dispatches !== expected)
        note(
          `${k.key}: the device was given ${String(r.dispatches)} dispatches, and the facts give ${String(expected)}`,
        );
      if (r.error === undefined && r.submissions !== 1)
        note(
          `${k.key}: the device was given ${String(r.submissions)} submissions, and the plan makes one`,
        );
      const deepRun = k.sizes === DEEP_SIZE;
      const diff =
        r.error ??
        firstDifference(
          k.want,
          chainGot(k, r, stages.folds),
          'chain',
          k.exact,
          deepRun ? deepTally : tally,
        );
      if (diff !== undefined) note(`${k.key}: ${diff}`);
      if (!deepRun) reach.written += writtenIn(k);
      // A reduction that folded in two levels says something only where the oracle's f32 sum is
      // the f64 one: a sum the f32 run rounded carries no claim.
      if (deepRun && r.error === undefined && diff === undefined)
        for (const g of k.model) {
          const fn = k.c.calls[g.calls[g.calls.length - 1]!]!;
          const [want, exact] = [k.want.results[fn.fn], k.exact.results[fn.fn]];
          if (fn.reduces > 0 && want !== undefined && claimed(want, exact)) reach.deepFolded += 1;
        }
    });
  }
  for (const [name, t] of [
    ['', tally],
    [` at ${String(DEEP_SIZE.n)}`, deepTally],
  ] as const)
    if (t.rounded * 10 > t.compared)
      note(
        `the oracle rounded ${String(t.rounded)} values against ${String(t.compared)} compared${name}, over a tenth`,
      );
  // What the claim is about must be in the corpus: fused groups, a group of three, each fact the
  // planner refuses on, the scratch arrays held as locals and kept as buffers, and the reductions.
  for (const [what, got, floor] of [
    ['fused groups', reach.fused, CHAIN_FLOORS.fused],
    ['calls in fused groups', reach.members, CHAIN_FLOORS.members],
    ['the largest group', reach.largest, CHAIN_FLOORS.largest],
    ['edges in fused groups', reach.edges, CHAIN_FLOORS.edges],
    ['values compared', tally.compared, CHAIN_FLOORS.compared],
    ['values a call wrote', reach.written, CHAIN_FLOORS.written],
    ...CHAIN_FLOORS.refusals.map(
      ([why, n]) => [`groups apart for ${why}`, apartFor.get(why) ?? 0, n] as const,
    ),
    ['scratch arrays held as locals', reach.locals, CHAIN_FLOORS.locals],
    ['scratch arrays kept as buffers', reach.buffers, CHAIN_FLOORS.buffers],
    ['chains with a scratch array held as a local', withLocal.size, CHAIN_FLOORS.chainsWithLocal],
    [
      'chains with a scratch array kept as a buffer',
      withBuffer.size,
      CHAIN_FLOORS.chainsWithBuffer,
    ],
    ...CHAIN_FLOORS.kept.map(
      ([why, n]) =>
        [`scratch arrays kept as buffers for ${why}`, keptFor.get(why) ?? 0, n] as const,
    ),
    ['chains that end in a reduction', endingInReduction.size, CHAIN_FLOORS.endingInReduction],
    [
      'reductions fused as the last call of a group',
      reach.fusedReductions,
      CHAIN_FLOORS.fusedReductions,
    ],
    ['fold levels dispatched', reach.levels, CHAIN_FLOORS.levels],
    ['fold levels one reduction folded in', reach.deepest, CHAIN_FLOORS.deepest],
    [
      `reductions folded in two levels with a result the f64 oracle gives too`,
      reach.deepFolded,
      CHAIN_FLOORS.deepFolded,
    ],
  ] as const)
    if (got < floor)
      note(`the chains reach ${String(got)} ${what}, under the floor of ${String(floor)}`);
  const text = (m: ReadonlyMap<string, number>): string =>
    [...m].map(([why, n]) => `${why} ${String(n)}`).join(', ');
  console.log(
    `chain differential: ${String(reach.chains)} generated chains of kernel calls, ${String(reach.runs)} runs (two sizes each, ${String(reach.deep)} again at ${String(DEEP_SIZE.n)}) of ${String(reach.calls)} calls in ${String(reach.dispatches)} dispatches on WebGPU · ` +
      `${String(reach.fused)} groups fused (${String(reach.members)} calls, the largest of ${String(reach.largest)}, ${String(reach.edges)} edges kept in locals), ${String(reach.groups - reach.fused)} stood apart (${text(apartFor)}) · ` +
      `${String(reach.locals)} scratch arrays held as locals (${String(withLocal.size)} chains), ${String(reach.buffers)} kept as buffers in ${String(withBuffer.size)} chains (${text(keptFor)}) · ` +
      `${String(endingInReduction.size)} chains end in a reduction, ${String(reach.reducing)} reductions run (${String(reach.fusedReductions)} fused as the last call of a group) in ${String(reach.levels)} fold levels, the most of one ${String(reach.deepest)} · ` +
      `${String(tally.compared)} values bit for bit against the f32 oracle, ${String(reach.written)} of them written by a call (${String(tally.rounded)} the oracle rounded, left out), and ${String(deepTally.compared)} at ${String(DEEP_SIZE.n)} (${String(deepTally.rounded)} left out, ${String(reach.deepFolded)} reduction results among them) · failures: ${String(failures)}`,
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
    failures += await chainArm(page);
    failures += await webgl2Arm(page);
    failures += await computeArm(page);
  } finally {
    await browser.close();
    server.close();
  }
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
