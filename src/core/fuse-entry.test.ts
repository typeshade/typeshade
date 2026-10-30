// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/): the scaffold of a lane past the
// trip count in a fused group (change 0096).
// The fused entry (change 0058, steps 3 and 4): the module built from the loop IR that each kernel
// function's face carries under `typeshade({ fuse: true })`, held to the same calls run one after
// another. Both run on the CPU oracle, which computes in `f32` and rounds each operation, so a
// fused group must give every array of the chain, the intermediate ones included, bit for bit what
// the calls give: the unfused reference is each function's own lowered plan
// (`core/testing/kernel-plan.ts`), and the fused side is built from the faces alone, with no
// source, no proof and no lowering, as the runtime builds it. The fused module is run as built, and
// again after the passes the WGSL writer runs at `O1` and `O2` (`lowerWgsl`), since the optimizer
// sees the group as one function. Node has no WebGPU: the WGSL is compiled by Tint in
// `journeys/loop-fuse`.
//
// A scratch array (step 4) the group holds as a local is in no binding, so the fused run never
// writes it: the comparison leaves the scratch arrays out, and checks that they are untouched.
//
// Instrument first (AGENTS.md#gate-discipline): the comparison must notice a fused module built
// wrong on purpose. The chains the planner refuses are fused anyway, and must differ, and so must
// a scratch array contracted against the facts.
//
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compile } from '../compiler/ts/compile.js';
import { hostFace } from '../compiler/ts/host-face.js';
import { emitModule, lowerWgsl } from './backends/wgsl.js';
import { fusedFor, uniformFor, type Fused } from './fuse-entry.js';
import { assignSlots, groupCalls, type GroupCall } from './fuse-group.js';
import type { KernelFace } from './host-kernel.js';
import type { ModuleDecl } from './ir/nodes.js';
import { compileModule, type CpuValue } from './oracle.js';
import { kernelTree } from './kernel-tree.js';
import type { OptLevel } from './passes/opt/optimize.js';
import { proveKernels } from './passes/parallel-loop.js';
import { lowerKernel, type KernelPlan } from './passes/kernel-lower.js';
import {
  copy,
  runKernelPlan,
  scheduleKernelPlan,
  tailOf,
  type PlanFault,
} from './testing/kernel-plan.js';

const RUNTIME = resolve(__dirname, 'host-runtime.ts');

// ─── the sources ─────────────────────────────────────────────────────────────────────────────

/** File A. `act` is its private helper. */
const OPS = `"use typeshade";
function act(x: f32): f32 { return x * x; }
export function add(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function mul(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}
export function relu(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
export function scale(out: array<f32>, x: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * k;
  }
}
export function square(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = act(x[i]);
  }
}
export function copy(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i];
  }
}
export function fill0(out: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = 0.;
  }
}
export function addt(out: array<f32>, t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + a[i];
  }
}
export function bump(xs: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + 1.;
  }
}
export function positive(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    if (x[i] > 0.) {
      out[i] = x[i];
    }
  }
}
export function stepper(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 3; i < out.length; i += 2) {
    out[i] = x[i] + 1.;
  }
}
export function lenscale(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * f32(x.length);
  }
}
export function iadd(out: array<i32>, a: array<i32>, b: array<i32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function imul(out: array<i32>, a: array<i32>, b: array<i32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}
export function vadd(out: array<vec2<f32>>, a: array<vec2<f32>>, b: array<vec2<f32>>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function vscale(out: array<vec2<f32>>, x: array<vec2<f32>>, k: f32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * k;
  }
}
export function addd(out: array<f64>, a: array<f64>, b: array<f64>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function muld(out: array<f64>, a: array<f64>, b: array<f64>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}
class Particle {
  pos: vec4;
  vel: vec4;
}
class Sim {
  dt: f32;
  gravity: f32;
}
export function step(particles: array<Particle>, sim: Sim): void {
  for (let i: u32 = 0; i < particles.length; i++) {
    const p = particles[i];
    particles[i] = {
      pos: p.pos + p.vel * sim.dt,
      vel: vec4(p.vel.x, p.vel.y - sim.gravity * sim.dt, p.vel.z, 0),
    };
  }
}
export function speed(out: array<f32>, particles: array<Particle>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = length(particles[i].vel.xyz);
  }
}
export function pairsum(out: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + t[i ^ 1];
  }
}
export function stride(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < x.length; i++) {
    out[2 * i] = x[i];
  }
}
export function shiftdown(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 1; i < x.length; i++) {
    out[i - 1] = x[i];
  }
}
export function copyfrom1(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = x[i];
  }
}
export function skipneg(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    if (x[i] < 0.) {
      continue;
    }
    out[i] = x[i];
  }
}
export function dot(a: array<f32>, b: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}
export function sum(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
export function spread(xs: array<f32>): vec2 {
  let s = 0.;
  let m = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
    m = max(m, xs[i]);
  }
  return vec2(s, m);
}
export function sumscaled(xs: array<f32>, k: f32): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i] * k;
  }
  return s;
}
export function isum(xs: array<i32>): i32 {
  let s: i32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
export function sumd(xs: array<f64>): f64 {
  let s: f64 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
export function sumnz(xs: array<f32>): f32 {
  let s = -0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
export function sumpair(t: array<f32>, a: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < t.length; i++) {
    s += t[i] + a[i];
  }
  return s;
}
export function sumstencil(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i] + xs[i ^ 1];
  }
  return s;
}
export function sumlen(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i] * f32(xs.length);
  }
  return s;
}
export function stats(xs: array<f32>, out: array<f32>): f32 {
  let s = 0.;
  let m = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * 2.;
    s += xs[i];
    m = max(m, xs[i]);
  }
  return s / f32(xs.length) + m;
}
export function sumafter(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 3; i < xs.length; i += 2) {
    s += xs[i];
  }
  return s;
}
export function sumnegs(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] < 0.) {
      continue;
    }
    s += xs[i];
  }
  return s;
}
`;

/** File B. Its private helper is also called `act`, and it is another function. */
const POST = `"use typeshade";
function act(x: f32): f32 { return max(x, 0.) + 1.; }
export function bias(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = act(x[i]);
  }
}
// Kernel functions that declare their workgroup size (proposal 0067, F7).
@workgroup_size([128])
export function triple(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * 3.;
  }
}
@workgroup_size([64])
export function quad(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * 4.;
  }
}
`;

interface Loaded {
  /** What the generated module carries for each kernel function. */
  readonly faces: ReadonlyMap<string, KernelFace>;
  /** What the compiler lowered for it, to run the calls apart. */
  readonly plans: ReadonlyMap<string, { readonly m: ModuleDecl; readonly plan: KernelPlan }>;
}

function load(source: string, fileName: string): Loaded {
  const g = hostFace(source, { fileName, runtime: RUNTIME, fuse: true });
  expect(g.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const faces = new Map<string, KernelFace>();
  for (const e of g.exports ?? []) if (e.kind === 'kernel') faces.set(e.name, e.face);
  const r = compile(source, { fileName });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const plans = new Map<string, { m: ModuleDecl; plan: KernelPlan }>();
  for (const proof of proveKernels(r.module)) {
    const f = r.module.funcs.find((x) => x.name === proof.fn)!;
    const plan = lowerKernel(f, r.module, proof);
    if (!('noGpu' in plan)) plans.set(proof.fn, { m: r.module, plan });
  }
  return { faces, plans };
}

// Array parameters named by reserved words (Rule 3.3, #602): WGSL reserves `filter`'s and `std`'s
// spellings, so each binding is emitted under a fresh name, and the fused entry must not name them.
const RESERVED = `"use typeshade";
export function reservedScale(out: array<f32>, filter: array<f32>) {
  for (let i: u32 = 0; i < arrayLength(out); i++) {
    out[i] = filter[i] * 2.0;
  }
}
export function reservedShift(out: array<f32>, std: array<f32>) {
  for (let i: u32 = 0; i < arrayLength(out); i++) {
    out[i] = std[i] + 1.0;
  }
}
`;

// A parameter whose fresh spelling another name would take: `filter_` is a module value here and
// a parameter of the second call, so the first call's `filter` gets `filter_1`.
const COLLIDE = `"use typeshade";
const filter_: f32 = 3.0;
export function collideScale(out: array<f32>, filter: array<f32>) {
  for (let i: u32 = 0; i < arrayLength(out); i++) {
    out[i] = filter[i] * filter_;
  }
}
export function collideShift(out: array<f32>, filter_: array<f32>, mean: array<f32>) {
  for (let i: u32 = 0; i < arrayLength(out); i++) {
    out[i] = filter_[i] + mean[i];
  }
}
`;

const A = load(OPS, '/app/ops.shade.ts');
const B = load(POST, '/app/post.shade.ts');
const C = load(RESERVED, '/app/reserved.shade.ts');
const D = load(COLLIDE, '/app/collide.shade.ts');
const lib = (fn: string): { file: Loaded; face: KernelFace } => {
  const file = B.faces.has(fn) ? B : C.faces.has(fn) ? C : D.faces.has(fn) ? D : A;
  return { file, face: file.faces.get(fn)! };
};

// ─── chains ──────────────────────────────────────────────────────────────────────────────────

/** An array of the chain, known by identity. */
class Arr {
  constructor(readonly id: string) {}
}
const arr = (id: string): Arr => new Arr(id);
type Store = Map<Arr, CpuValue[]>;

/** One call: the kernel function, and its arguments in parameter order: an array of the chain, or
 *  a value (a number, or a struct as an object). */
interface Step {
  readonly fn: string;
  readonly args: readonly (Arr | number | object)[];
}
const step = (fn: string, ...args: (Arr | number | object)[]): Step => ({ fn, args });

const N = 70; // more than a workgroup of 64, and not a multiple of it
const rnd = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 10 - 5;
};
const data = (seed: number, n = N): number[] =>
  Array.from(
    { length: n },
    (
      (r) => () =>
        Math.fround(r())
    )(rnd(seed)),
  );
const zeros = (n = N): number[] => new Array<number>(n).fill(0);

const cloneStore = (s: Store): Store =>
  new Map([...s].map(([t, v]) => [t, copy(v as never) as never]));

/** Whether two values hold the same bits: `Object.is` per element, so -0 differs from +0. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return Object.is(a, b);
}

/** The arrays of the store that differ between two runs, by id; `skip` are left out. */
const differing = (x: Store, y: Store, skip: readonly Arr[] = []): string[] =>
  [...x].flatMap(([t, v]) => (skip.includes(t) || same(v, y.get(t)) ? [] : [t.id]));

/** What the planner reads of a step. */
function groupCall(s: Step, store: Store): GroupCall {
  const { file, face } = lib(s.fn);
  const ref = file.plans.get(s.fn)!;
  const f = ref.m.funcs.find((x) => x.name === s.fn)!;
  const values = s.args.map((a) => (a instanceof Arr ? ([...store.get(a)!] as CpuValue) : a));
  const first = scheduleKernelPlan(ref.m, s.fn, ref.plan, values as CpuValue[]).steps[0];
  return {
    k: face,
    arrays: f.params.map((p, i) => (p.type.kind === 'array' ? (s.args[i] as Arr) : undefined)),
    range:
      first === undefined
        ? { start: 0, n: 0 }
        : { start: first.args['_start'] as number, n: first.args['_n'] as number },
    tier: 'webgpu',
  };
}

/** The calls one after another, each as its own lowered plan on the oracle. `results` gets what
 *  each call returns, in order. */
function apart(steps: readonly Step[], init: Store, results: (CpuValue | undefined)[] = []): Store {
  const store = cloneStore(init);
  for (const s of steps) {
    const { file } = lib(s.fn);
    const ref = file.plans.get(s.fn)!;
    const f = ref.m.funcs.find((x) => x.name === s.fn)!;
    const values = s.args.map((a) => (a instanceof Arr ? ([...store.get(a)!] as CpuValue) : a));
    const run = runKernelPlan(ref.m, s.fn, ref.plan, values as CpuValue[]);
    results.push(run.result);
    let at = 0;
    f.params.forEach((p, i) => {
      if (p.type.kind === 'array') store.set(s.args[i] as Arr, run.arrays[at++] as CpuValue[]);
    });
  }
  return store;
}

/** The calls as one group on the oracle: the entry built from the faces, one dispatch. `level`
 *  runs the passes the writer runs first. `force` fuses a group the planner refused. `scratch`
 *  are the scratch arrays of the scope: the planner decides which of them the entry holds as
 *  locals. `forced` are arrays contracted whatever the planner says, to show what a wrong
 *  contraction does. */
function together(
  steps: readonly Step[],
  init: Store,
  level?: OptLevel,
  force = false,
  scratch: readonly Arr[] = [],
  forced: readonly Arr[] = [],
  fault?: PlanFault,
  grid?: [number, number, number],
): {
  store: Store;
  fused: Fused;
  contracted: Arr[];
  result?: CpuValue | undefined;
  dispatches: number;
} {
  const calls = steps.map((s) => groupCall(s, init));
  const groups = groupCalls(calls, 8, new Set(scratch));
  if (!force)
    expect(
      groups.map((g) => g.calls.length),
      'the planner makes one group',
    ).toEqual([steps.length]);
  const { slots, arrays } = assignSlots(calls);
  const held = (forced.length > 0 ? forced : force ? [] : groups[0]!.contracted) as Arr[];
  const fused = fusedFor(
    steps.map((_, m) => ({ k: calls[m]!.k, slots: slots[m]! })),
    arrays.flatMap((a, at) => (held.includes(a as Arr) ? [at] : [])),
  );
  if ('none' in fused) throw new Error(fused.none);
  const store = cloneStore(init);
  const cpu = compileModule(level === undefined ? fused.module : lowerWgsl(fused.module, level), {
    precision: 'f32',
  });
  const uniform = uniformFor(
    steps.map((s, m) => ({ k: calls[m]!.k, hosts: s.args, range: calls[m]!.range! })),
  );
  cpu.setBinding(fused.args.name, uniform as unknown as CpuValue);
  // An array the entry holds as a local has no slot, so it is bound to nothing.
  fused.slots.forEach((slot) =>
    cpu.setBinding(slot.name, store.get(arrays[slot.array] as Arr)! as unknown as CpuValue),
  );
  if (fused.reduce === undefined) {
    cpu.dispatch(fused.entry.fn, grid ?? Math.ceil(calls[0]!.range!.n / fused.wg));
    return { store, fused, contracted: held, dispatches: 1 };
  }
  // F6: the group's dispatches are the last call's own schedule, its loop entry and then one fold
  // entry for each level of partials (`scheduleKernelPlan`), with the merged uniform's fields for
  // `_n`, `_in` and `_out` set for each, as the runtime sets them.
  const last = steps[steps.length - 1]!;
  const ref = lib(last.fn).file.plans.get(last.fn)!;
  const values = last.args.map((a) => (a instanceof Arr ? ([...store.get(a)!] as CpuValue) : a));
  const schedule = scheduleKernelPlan(ref.m, last.fn, ref.plan, values as CpuValue[], fault);
  const parts = new Map<string, CpuValue[]>();
  for (const p of schedule.partials) {
    const part = Array.from({ length: p.slots }, () =>
      p.type.kind === 'vec' ? vecZero(p.type.n) : 0,
    );
    parts.set(p.binding, part as CpuValue[]);
    cpu.setBinding(p.binding, part as unknown as CpuValue);
  }
  const { fields } = fused.reduce;
  for (const st of schedule.steps) {
    cpu.setBinding(fused.args.name, {
      ...uniform,
      [fields.n]: st.args['_n'] as number,
      [fields.in]: st.args['_in'] as number,
      [fields.out]: st.args['_out'] as number,
    } as unknown as CpuValue);
    const entry = st.entry === ref.plan.loops[0]!.entry ? fused.entry : fused.reduce.fold;
    cpu.dispatch(entry.fn, st.workgroups as [number, number, number]);
  }
  const folded = schedule.folds.map((f) =>
    'identity' in f ? f.identity : copy(parts.get(f.binding)![f.at]!),
  );
  const result = tailOf(ref.m, last.fn, ref.plan, values as CpuValue[], folded);
  return { store, fused, contracted: held, result, dispatches: schedule.steps.length };
}

const vecZero = (n: number): CpuValue => new Array<number>(n).fill(0) as unknown as CpuValue;

const LEVELS: readonly (OptLevel | undefined)[] = [undefined, 'O1', 'O2'];

/** One chain: the steps, the arrays and their starting contents. */
interface Chain {
  readonly title: string;
  readonly steps: readonly Step[];
  readonly init: Store;
  /** The levels to run the fused module at; all of them by default. The passes of `O1` and `O2`
   *  lower an `f64` to two `f32`s, which the oracle cannot hold an array of numbers for. */
  readonly levels?: readonly (OptLevel | undefined)[];
}

const [a, b, c, t, u, v, w, out, ps] = ['a', 'b', 'c', 't', 'u', 'v', 'w', 'out', 'ps'].map(
  arr,
) as [Arr, Arr, Arr, Arr, Arr, Arr, Arr, Arr, Arr];

const fresh = (...named: [Arr, number[]?][]): Store =>
  new Map(named.map(([x, init]) => [x, (init ?? zeros()) as CpuValue[]] as const));

/** The chains the planner makes one group of. */
const FUSED: readonly Chain[] = [
  {
    title: 'add -> mul -> relu',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('relu', out, u)],
    init: fresh([a, data(1)], [b, data(2)], [c, data(3)], [t], [u], [out]),
  },
  {
    title: 'a diamond: t feeds mul and the last add, and u feeds the last add',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('add', v, t, u), step('relu', out, v)],
    init: fresh([a, data(4)], [b, data(5)], [c, data(6)], [t], [u], [v], [out]),
  },
  {
    title: 'a repeated leaf: add(t, a, b), mul(u, t, a) bind a once',
    steps: [step('add', t, a, b), step('mul', u, t, a)],
    init: fresh([a, data(7)], [b, data(8)], [t], [u]),
  },
  {
    title: 'five calls, a scalar parameter in two of them',
    steps: [
      step('add', t, a, b),
      step('mul', u, t, c),
      step('scale', v, u, 0.5),
      step('relu', w, v),
      step('scale', out, w, 3),
    ],
    init: fresh([a, data(9)], [b, data(10)], [c, data(11)], [t], [u], [v], [w], [out]),
  },
  {
    title: 'helpers: file A, the same helper twice, and file B, another function by the same name',
    steps: [step('square', t, a), step('square', u, t), step('bias', out, u)],
    init: fresh([a, data(12)], [t], [u], [out]),
  },
  {
    title: 'a loop that starts at 3 and steps by 2',
    steps: [step('stepper', t, a), step('stepper', u, t)],
    init: fresh([a, data(13)], [t, data(14)], [u, data(15)]),
  },
  {
    title: 'a signed zero: fill0, then addt over inputs that hold -0',
    steps: [step('fill0', t), step('addt', out, t, a)],
    init: fresh([a, data(16).map((x, i) => (i % 3 === 0 ? -0 : x))], [t, data(17)], [out]),
  },
  {
    title: 'a producer that writes only where x > 0, over an array that was not zero',
    steps: [step('positive', t, a), step('copy', out, t)],
    init: fresh([a, data(18)], [t, data(19)], [out]),
  },
  {
    title: 'an in-place call, then a call that reads what it wrote',
    steps: [step('bump', a), step('relu', out, a)],
    init: fresh([a, data(20)], [out]),
  },
  {
    title: 'a call that measures an array another wrote',
    steps: [step('add', t, a, b), step('lenscale', out, t)],
    init: fresh([a, data(21)], [b, data(22)], [t], [out]),
  },
  {
    title: 'arrays of vec2<f32>, and an edge that is a vec2',
    steps: [step('vadd', t, a, b), step('vscale', out, t, 2)],
    init: new Map<Arr, CpuValue[]>([
      [a, Array.from({ length: N }, (_, i) => [data(23)[i]!, data(24)[i]!] as unknown as CpuValue)],
      [b, Array.from({ length: N }, (_, i) => [data(25)[i]!, data(26)[i]!] as unknown as CpuValue)],
      [t, Array.from({ length: N }, () => [0, 0] as unknown as CpuValue)],
      [out, Array.from({ length: N }, () => [0, 0] as unknown as CpuValue)],
    ]),
  },
  {
    title: 'an array of structs and a struct parameter, and an edge that is a struct',
    steps: [step('step', ps, { dt: 0.5, gravity: 2 }), step('speed', out, ps)],
    init: new Map<Arr, CpuValue[]>([
      [
        ps,
        Array.from({ length: N }, (_, i) => ({
          pos: [data(41)[i]!, data(42)[i]!, data(43)[i]!, 1],
          vel: [data(44)[i]!, data(45)[i]!, data(46)[i]!, 0],
        })) as unknown as CpuValue[],
      ],
      [out, zeros() as CpuValue[]],
    ]),
  },
  // A map of the default size and a map that declares 128: the group runs at 128 (F7).
  {
    title: 'a map of 64, then a map that declares 128',
    steps: [step('square', t, a), step('triple', out, t)],
    init: fresh([a, data(61)], [t], [out]),
  },
  {
    title: 'a map that declares 128, then a map of 64, which takes its size',
    steps: [step('triple', t, a), step('square', out, t)],
    init: fresh([a, data(62)], [t], [out]),
  },
  {
    title: 'two maps that declare 128',
    steps: [step('triple', t, a), step('triple', out, t)],
    init: fresh([a, data(63)], [t], [out]),
  },
  {
    title: 'f64 arrays',
    levels: [undefined],
    steps: [step('addd', t, a, b), step('muld', out, t, c)],
    init: fresh(
      [a, data(27).map((x) => x * 1.0000001)],
      [b, data(28).map((x) => x / 3)],
      [c, data(29)],
      [t],
      [out],
    ),
  },
];

describe('a fused group of reserved parameter names (Rule 3.3, #602)', () => {
  const x = arr('x');
  const t = arr('t');
  const out = arr('out');
  const steps = [step('reservedScale', t, x), step('reservedShift', out, t)];
  const init = fresh([x, data(91)], [t], [out]);

  it('names no reserved word in the fused entry', () => {
    const { fused } = together(steps, init, undefined, false, [t]);
    expect(fused.entry.wgsl).not.toMatch(/\b(filter|std)\b/);
    expect(fused.entry.bindings.map((b) => b.name)).not.toContain('filter');
  });

  it('computes what its calls compute, at every level', () => {
    const want = apart(steps, init);
    for (const level of LEVELS) {
      const { store } = together(steps, init, level);
      expect(differing(want, store), `at ${level ?? 'the module as built'}`).toEqual([]);
    }
  });
});

describe('a fused group whose fresh spellings would collide (Rule 3.3, #602)', () => {
  const x = arr('x');
  const m = arr('m');
  const t = arr('t');
  const out = arr('out');
  const steps = [step('collideScale', t, x), step('collideShift', out, t, m)];
  const init = fresh([x, data(92)], [m, data(93)], [t], [out]);

  it('computes what its calls compute, at every level', () => {
    const want = apart(steps, init);
    for (const level of LEVELS) {
      const { store } = together(steps, init, level);
      expect(differing(want, store), `at ${level ?? 'the module as built'}`).toEqual([]);
    }
  });
});

describe('a fused group computes what its calls compute, bit for bit', () => {
  it.each(FUSED.map((ch) => [ch.title, ch] as const))('%s', (_title, ch) => {
    const want = apart(ch.steps, ch.init);
    // The chain changes something: the oracle comparison below is not between two untouched stores.
    expect(differing(ch.init, want).length).toBeGreaterThan(0);
    for (const level of ch.levels ?? LEVELS) {
      const { store } = together(ch.steps, ch.init, level);
      expect(differing(want, store), `at ${level ?? 'the module as built'}`).toEqual([]);
    }
  });

  it('keeps every array a call wrote in storage, the intermediate ones too', () => {
    const ch = FUSED[0]!;
    const { store, fused } = together(ch.steps, ch.init);
    expect(store.get(t)).toEqual(apart(ch.steps, ch.init).get(t));
    expect(store.get(u)).toEqual(apart(ch.steps, ch.init).get(u));
    expect(fused.slots.filter((s) => s.written).map((s) => s.binding.rw)).toEqual([
      true,
      true,
      true,
    ]);
  });
});

// ─── scratch arrays ──────────────────────────────────────────────────────────────────────────

/** Integers in `-9..9`, so that an `i32` chain does not overflow. */
const ints = (seed: number, n = N): number[] => data(seed, n).map((x) => Math.trunc(x * 2));

/** A chain in which some arrays are scratch arrays of the scope. A scratch array holds zeros when
 *  the plan starts, as a new buffer does. */
interface ScratchChain extends Chain {
  /** The scratch arrays of the scope. */
  readonly scratch: readonly Arr[];
  /** The ones the planner contracts: the entry holds them as locals. */
  readonly locals: readonly Arr[];
}

const SCRATCHED: readonly ScratchChain[] = [
  {
    title: 'add -> relu, the edge a scratch array',
    steps: [step('add', t, a, b), step('relu', out, t)],
    init: fresh([a, data(51)], [b, data(52)], [t], [out]),
    scratch: [t],
    locals: [t],
  },
  {
    title: 'add -> mul -> relu, two scratch arrays',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('relu', out, u)],
    init: fresh([a, data(53)], [b, data(54)], [c, data(55)], [t], [u], [out]),
    scratch: [t, u],
    locals: [t, u],
  },
  {
    title: 'add -> mul -> scale(0.5) -> relu, three scratch arrays and a scalar parameter',
    steps: [
      step('add', t, a, b),
      step('mul', u, t, c),
      step('scale', v, u, 0.5),
      step('relu', out, v),
    ],
    init: fresh([a, data(56)], [b, data(57)], [c, data(58)], [t], [u], [v], [out]),
    scratch: [t, u, v],
    locals: [t, u, v],
  },
  {
    title: 'a diamond: t feeds mul and the last add, and u feeds the last add',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('add', v, t, u), step('relu', out, v)],
    init: fresh([a, data(59)], [b, data(60)], [c, data(61)], [t], [u], [v], [out]),
    scratch: [t, u, v],
    locals: [t, u, v],
  },
  {
    title: 'one scratch array and one resident: the resident keeps its write',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('relu', out, u)],
    init: fresh([a, data(62)], [b, data(63)], [c, data(64)], [t], [u], [out]),
    scratch: [t],
    locals: [t],
  },
  {
    // R1 finding 27: a `let` local lets the optimizer fold `0.0 + -0.0` to `-0.0` at O2.
    title: 'a signed zero: fill0 into a scratch array, then addt over inputs that hold -0',
    steps: [step('fill0', t), step('addt', out, t, a)],
    init: fresh([a, data(65).map((x, i) => (i % 3 === 0 ? -0 : x))], [t], [out]),
    scratch: [t],
    locals: [t],
  },
  {
    title: 'a producer that writes only where x > 0: the scratch array holds zeros elsewhere',
    steps: [step('positive', t, a), step('copy', out, t)],
    init: fresh([a, data(66)], [t], [out]),
    scratch: [t],
    locals: [t],
  },
  {
    title: 'an in-place call on a scratch array, then a call that reads it',
    steps: [step('bump', t), step('relu', out, t)],
    init: fresh([t], [out]),
    scratch: [t],
    locals: [t],
  },
  {
    title: 'a loop that starts at 3 and steps by 2, between scratch arrays',
    steps: [step('stepper', t, a), step('stepper', out, t)],
    init: fresh([a, data(67)], [t], [out, data(68)]),
    scratch: [t],
    locals: [t],
  },
  {
    title: 'an i32 scratch array',
    levels: undefined,
    steps: [step('iadd', t, a, b), step('imul', out, t, c)],
    init: fresh([a, ints(69)], [b, ints(70)], [c, ints(71)], [t], [out]),
    scratch: [t],
    locals: [t],
  },
  {
    title: 'a call that measures the scratch array: lenscale names x.length, so it stays a buffer',
    steps: [step('add', t, a, b), step('lenscale', out, t)],
    init: fresh([a, data(72)], [b, data(73)], [t], [out]),
    scratch: [t],
    locals: [],
  },
];

describe('a scratch array a fused group holds as a local', () => {
  it.each(SCRATCHED.map((ch) => [ch.title, ch] as const))('%s', (_title, ch) => {
    const want = apart(ch.steps, ch.init);
    // The chain changes something: the comparison below is not between two untouched stores.
    expect(differing(ch.init, want).length).toBeGreaterThan(0);
    for (const level of ch.levels ?? LEVELS) {
      const at = `at ${level ?? 'the module as built'}`;
      const { store, contracted } = together(ch.steps, ch.init, level, false, ch.scratch);
      expect(contracted, at).toEqual(ch.locals);
      // Every array but the locals holds what the calls wrote, the other scratch arrays included.
      expect(differing(want, store, ch.locals), at).toEqual([]);
      // The entry holds a local and writes none: the array it was bound to nowhere is untouched.
      for (const x of ch.locals)
        expect(same(store.get(x), ch.init.get(x)), `${x.id} ${at}`).toBe(true);
    }
  });

  it('binds no buffer for a scratch array, and declares one var local of its type', () => {
    const ch = SCRATCHED[1]!;
    const { fused } = together(ch.steps, ch.init, undefined, false, ch.scratch);
    const wgsl = fused.entry.wgsl;
    // a, b, c and out: the uniform and four storage arrays. t and u are slots 0 and 3.
    expect(fused.entry.bindings.map((x) => [x.binding, x.space])).toEqual([
      [0, 'uniform'],
      [1, 'storage'],
      [2, 'storage'],
      [3, 'storage'],
      [4, 'storage'],
    ]);
    expect(fused.slots.map((x) => x.array)).toEqual([1, 2, 4, 5]);
    expect(wgsl.match(/var<storage, read_write>/g)).toHaveLength(1);
    expect(wgsl.match(/var<storage, read>/g)).toHaveLength(3);
    expect(wgsl.match(/var _fs\d+: f32;/g)).toHaveLength(2);
    // The writers write the local and the readers read it, with the index dropped.
    expect(wgsl).toMatch(/_fs0 = \(_fr1\[_fc0_i\] \+ _fr2\[_fc0_i\]\);/);
    expect(wgsl).toMatch(/_fs3 = \(_fs0 \* _fr4\[_fc1_i\]\);/);
    expect(wgsl).not.toMatch(/_fr0|_fr3/);
    // No edge local: nothing is loaded back from storage.
    expect(wgsl).not.toMatch(/_fe\d/);
    expect(wgsl).toBe(emitModule(fused.module));
  });

  it('declares the locals before the first statement of a call, and starts them at zero', () => {
    const ch = SCRATCHED[6]!;
    const { fused } = together(ch.steps, ch.init, undefined, false, ch.scratch);
    const body = fused.entry.wgsl;
    // `var` with no initializer is zero in WGSL; the declaration comes before the first call's code.
    expect(body.indexOf('var _fs0: f32;')).toBeGreaterThan(0);
    expect(body.indexOf('var _fs0: f32;')).toBeLessThan(body.indexOf('_fc0_i'));
    expect(body).not.toMatch(/var _fs0: f32 =/);
  });

  it('keeps a scratch array a call measures a buffer, which the entry binds', () => {
    const ch = SCRATCHED[SCRATCHED.length - 1]!;
    const { fused } = together(ch.steps, ch.init, undefined, false, ch.scratch);
    // t, a, b and out are bound, and no local stands for t.
    expect(fused.slots.map((x) => x.array)).toEqual([0, 1, 2, 3]);
    expect(fused.entry.wgsl).not.toMatch(/var _fs/);
    expect(fused.entry.wgsl).toMatch(/arrayLength\(&_fr0\)/);
  });

  it('builds no entry that holds a measured array as a local, whatever the planner says', () => {
    const steps = [step('add', t, a, b), step('lenscale', out, t)];
    const calls = steps.map((x) => groupCall(x, fresh([a, data(1)], [b, data(2)], [t], [out])));
    const { slots } = assignSlots(calls);
    // The facts say `lenscale` names `x.length`; a stale or wrong plan is stopped here too.
    expect(
      fusedFor(
        calls.map((x, m) => ({ k: x.k, slots: slots[m]! })),
        [0],
      ),
    ).toEqual({ none: 'lenscale() measures an array the entry holds as a local' });
  });

  it('builds no entry that holds an array of vectors as a local', () => {
    const steps = [step('vadd', t, a, b), step('vscale', out, t, 2)];
    const init = new Map<Arr, CpuValue[]>([
      [a, Array.from({ length: N }, () => [1, 2] as unknown as CpuValue)],
      [b, Array.from({ length: N }, () => [3, 4] as unknown as CpuValue)],
      [t, Array.from({ length: N }, () => [0, 0] as unknown as CpuValue)],
      [out, Array.from({ length: N }, () => [0, 0] as unknown as CpuValue)],
    ]);
    const calls = steps.map((x) => groupCall(x, init));
    const { slots } = assignSlots(calls);
    const r = fusedFor(
      calls.map((x, m) => ({ k: x.k, slots: slots[m]! })),
      [0],
    );
    expect(r).toEqual({ none: 'an array of vec2<f32> cannot be held as a local' });
  });

  it('keeps one entry for a shape and another for another set of locals', () => {
    const ch = SCRATCHED[1]!;
    const calls = ch.steps.map((x) => groupCall(x, ch.init));
    const { slots } = assignSlots(calls);
    const members = calls.map((x, m) => ({ k: x.k, slots: slots[m]! }));
    const both = fusedFor(members, [0, 3]) as Fused;
    // The same locals, in any order, on other arrays of other lengths: one entry.
    const longer = fresh(
      ...[a, b, c, t, u, out].map((x, i): [Arr, number[]?] => [x, data(80 + i, 300)]),
    );
    const again = assignSlots(ch.steps.map((x) => groupCall(x, longer)));
    expect(
      fusedFor(
        ch.steps.map((x, m) => ({ k: groupCall(x, longer).k, slots: again.slots[m]! })),
        [3, 0],
      ),
    ).toBe(both);
    // No locals, one local, the other one: three more entries, with three more modules.
    const none = fusedFor(members) as Fused;
    const one = fusedFor(members, [0]) as Fused;
    const other = fusedFor(members, [3]) as Fused;
    expect(new Set([both, none, one, other]).size).toBe(4);
    expect(none.slots).toHaveLength(6);
    expect(one.slots).toHaveLength(5);
    expect(other.slots).toHaveLength(5);
    expect(both.slots).toHaveLength(4);
  });
});

// ─── a reduction as the last call (F6) ────────────────────────────────────────────────────────

/** A group whose last call reduces: the calls before it are the prologue of its iteration. */
interface ReducedChain extends Chain {
  /** The scratch arrays of the scope; the planner decides which of them are locals. */
  readonly scratch?: readonly Arr[];
  /** The ones the planner holds as locals. */
  readonly locals?: readonly Arr[];
  /** The fold levels after the loop's own dispatch: its partials are folded this many times. */
  readonly folds: number;
}

const ramp = (n: number, seed: number): number[] => data(seed, n);
/** `-0` at every `every`th place. */
const withNegZero = (xs: number[], every: number): number[] =>
  xs.map((x, i) => (i % every === 0 ? -0 : x));

const REDUCED: readonly ReducedChain[] = [
  {
    title: 'add -> dot over 70: the edge is a scratch array, and the loop has one workgroup',
    steps: [step('add', t, a, b), step('dot', t, c)],
    init: fresh([a, data(101)], [b, data(102)], [c, data(103)], [t]),
    scratch: [t],
    locals: [t],
    folds: 0,
  },
  {
    title: 'add -> dot over 1000: four partials, one fold level',
    steps: [step('add', t, a, b), step('dot', t, c)],
    init: fresh([a, ramp(1000, 104)], [b, ramp(1000, 105)], [c, ramp(1000, 106)], [t, zeros(1000)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'relu -> square -> sum over 2000: a kept edge and a scratch edge, one fold level',
    steps: [step('relu', t, a), step('square', u, t), step('sum', u)],
    init: fresh([a, ramp(2000, 107)], [t, zeros(2000)], [u, zeros(2000)]),
    scratch: [u],
    locals: [u],
    folds: 1,
  },
  {
    title: 'add -> mul -> sum over 600 with both edges scratch arrays',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('sum', u)],
    init: fresh(
      [a, ramp(600, 108)],
      [b, ramp(600, 109)],
      [c, ramp(600, 110)],
      [t, zeros(600)],
      [u, zeros(600)],
    ),
    scratch: [t, u],
    locals: [t, u],
    folds: 1,
  },
  {
    title: 'the same chain with both edges kept in storage: the prologue writes t and u',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('sum', u)],
    init: fresh(
      [a, ramp(600, 108)],
      [b, ramp(600, 109)],
      [c, ramp(600, 110)],
      [t, ramp(600, 157)],
      [u, ramp(600, 158)],
    ),
    scratch: [],
    locals: [],
    folds: 1,
  },
  {
    title: 'a reduction of two variables, a sum and a max, over a scratch edge',
    steps: [step('add', t, a, b), step('spread', t)],
    init: fresh([a, ramp(700, 111)], [b, ramp(700, 112)], [t, zeros(700)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'a scalar parameter in the prologue and one in the reduction',
    steps: [step('scale', t, a, 0.5), step('sumscaled', t, 3)],
    init: fresh([a, ramp(700, 113)], [t, zeros(700)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'loops that start at 3 and step by 2, so 499 iterations and two workgroups',
    steps: [step('stepper', t, a), step('sumafter', t)],
    init: fresh([a, ramp(1000, 114)], [t, ramp(1000, 115)]),
    scratch: [],
    locals: [],
    folds: 1,
  },
  {
    title: 'a reduction that writes an array of its own, beside the sum and the max',
    steps: [step('add', t, a, b), step('stats', t, out)],
    init: fresh([a, ramp(600, 116)], [b, ramp(600, 117)], [t, zeros(600)], [out, zeros(600)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'helpers of two files in the prologue, and the sum after them',
    steps: [step('square', t, a), step('bias', u, t), step('sum', u)],
    init: fresh([a, ramp(520, 118)], [t, zeros(520)], [u, zeros(520)]),
    scratch: [t, u],
    locals: [t, u],
    folds: 1,
  },
  {
    // R1 finding 27 in a reduction: -0 through the prologue into the sum, which starts at -0.
    title: 'a signed zero: copy of an array of -0, then a sum that starts at -0',
    steps: [step('copy', t, a), step('sumnz', t)],
    init: fresh([a, new Array<number>(300).fill(-0)], [t, zeros(300)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'a signed zero: fill0, then a sum of t + a over inputs that hold -0',
    steps: [step('fill0', t), step('sumpair', t, a)],
    init: fresh([a, withNegZero(ramp(300, 119), 3)], [t, ramp(300, 120)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'a producer that writes only where x > 0, over an array that was not zero (a kept edge)',
    steps: [step('positive', t, a), step('sum', t)],
    init: fresh([a, ramp(700, 121)], [t, ramp(700, 122)]),
    scratch: [],
    locals: [],
    folds: 1,
  },
  {
    title: 'the same over a scratch array: it holds zeros where nothing wrote',
    steps: [step('positive', t, a), step('sum', t)],
    init: fresh([a, ramp(700, 123)], [t, zeros(700)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'a reduction that measures the scratch array: it names t.length, so t stays a buffer',
    steps: [step('add', t, a, b), step('sumlen', t)],
    init: fresh([a, ramp(300, 124)], [b, ramp(300, 125)], [t, zeros(300)]),
    scratch: [t],
    locals: [],
    folds: 1,
  },
  {
    title: 'a repeated leaf: add(t, a, b) and dot(t, a) bind a once',
    steps: [step('add', t, a, b), step('dot', t, a)],
    init: fresh([a, ramp(520, 151)], [b, ramp(520, 152)], [t, zeros(520)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    title: 'an i32 sum over an i32 scratch array',
    steps: [step('iadd', t, a, b), step('isum', t)],
    init: fresh([a, ints(153, 600)], [b, ints(154, 600)], [t, zeros(600)]),
    scratch: [t],
    locals: [t],
    folds: 1,
  },
  {
    // The oracle holds an f64 array as numbers, which the passes of O1 and O2 lower to two f32s.
    title: 'an f64 sum over f64 arrays, with the _fp64 guard on both entries',
    levels: [undefined],
    steps: [step('addd', t, a, b), step('sumd', t)],
    init: fresh(
      [a, ramp(300, 155).map((x) => x * 1.0000001)],
      [b, ramp(300, 156).map((x) => x / 3)],
      [t, zeros(300)],
    ),
    folds: 1,
  },
  {
    title: 'a vec2 reduction over a prologue of two calls, the edge between them a scratch array',
    steps: [step('add', t, a, b), step('mul', u, t, c), step('spread', u)],
    init: fresh(
      [a, ramp(257, 126)],
      [b, ramp(257, 127)],
      [c, ramp(257, 128)],
      [t, zeros(257)],
      [u, zeros(257)],
    ),
    scratch: [t, u],
    locals: [t, u],
    folds: 1,
  },
];

describe('a fused group that ends in a reduction computes what its calls compute, bit for bit', () => {
  it.each(REDUCED.map((ch) => [ch.title, ch] as const))('%s', (_title, ch) => {
    const results: (CpuValue | undefined)[] = [];
    const want = apart(ch.steps, ch.init, results);
    // The chain changes something: the comparison below is not between two untouched stores.
    expect(differing(ch.init, want).length).toBeGreaterThan(0);
    for (const level of ch.levels ?? LEVELS) {
      const at = `at ${level ?? 'the module as built'}`;
      const got = together(ch.steps, ch.init, level, false, ch.scratch ?? []);
      expect(got.contracted, at).toEqual(ch.locals ?? []);
      // The loop's dispatch, and one fold entry for each level of partials.
      expect(got.dispatches, at).toBe(1 + ch.folds);
      // Every array but the locals holds what the calls wrote.
      expect(differing(want, got.store, ch.locals ?? []), at).toEqual([]);
      // The reduction's result is the tail's, over what the levels folded.
      expect(same(got.result, results[results.length - 1]), `${at}: ${String(got.result)}`).toBe(
        true,
      );
    }
  });

  it('gives the sum of an array of -0 as -0, the bits the calls give', () => {
    const ch = REDUCED.find((x) => x.title.startsWith('a signed zero: copy'))!;
    const results: (CpuValue | undefined)[] = [];
    apart(ch.steps, ch.init, results);
    // The case holds a -0 that a sum which lost its sign would show.
    expect(Object.is(results[1], -0)).toBe(true);
    for (const level of LEVELS)
      expect(
        Object.is(together(ch.steps, ch.init, level, false, ch.scratch ?? []).result, -0),
        `at ${level ?? 'the module as built'}`,
      ).toBe(true);
  });

  it('folds 70000 elements by two levels of partials, as built', () => {
    // 274 workgroups of 256, then 2 of them, then 1: the loop's dispatch and two fold levels. The
    // oracle takes about 14 s to run the one dispatch of the loop and the two of the folds, so
    // only the module as built runs, and the reference is the tree order in plain JavaScript
    // (`kernelTree`, Rule 7.2) over the values the calls give, without the three calls run apart.
    const n = 70000;
    const ch: ReducedChain = {
      title: '',
      steps: [step('relu', t, a), step('square', u, t), step('sum', u)],
      init: fresh([a, ramp(n, 129)], [t, zeros(n)], [u, zeros(n)]),
      scratch: [u],
      locals: [u],
      levels: [undefined],
      folds: 2,
    };
    const got = together(ch.steps, ch.init, undefined, false, ch.scratch ?? []);
    expect(got.dispatches).toBe(3);
    expect(got.contracted).toEqual([u]);
    // t keeps its write: relu of the input. u is a local, and the entry never writes the array.
    const input = ch.init.get(a) as number[];
    const kept = input.map((x) => Math.max(x, 0));
    expect(same(got.store.get(t), kept)).toBe(true);
    expect(same(got.store.get(u), zeros(n))).toBe(true);
    // The sum of the squares in the tree order, from `let s = 0.`.
    const squares = kept.map((x) => Math.fround(x * x));
    const folded = kernelTree(
      squares,
      (x, y) => Math.fround((x as number) + (y as number)),
      () => -0,
    ) as number;
    expect(same(got.result, Math.fround(0 + folded))).toBe(true);
  }, 240_000);
});

describe('the comparison notices a fused module that is wrong', () => {
  it('sees a stencil fused anyway, which reads what a later index writes', () => {
    const steps = [step('add', t, a, b), step('pairsum', out, t)];
    const init = fresh([a, data(30)], [b, data(31)], [t], [out]);
    const calls = steps.map((s) => groupCall(s, init));
    // The planner refuses it, and says why in the words of the fact.
    const groups = groupCalls(calls, 8);
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toMatch(
      /^add and pairsum run as two dispatches because pairsum reads `t\[i \^ 1\]` \(line \d+\)$/,
    );
    const { store } = together(steps, init, undefined, true);
    expect(differing(apart(steps, init), store)).toContain('out');
  });

  it('sees a write at i - 1 fused with a read at i, which a later index writes', () => {
    // shiftdown(t, a) writes t[i - 1] for i from 1, and copyfrom1(out, t) reads t[i] for i from 1.
    const steps = [step('shiftdown', t, a), step('copyfrom1', out, t)];
    const init = fresh([a, data(32)], [t], [out]);
    const calls = steps.map((s) => groupCall(s, init));
    const groups = groupCalls(calls, 8);
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toMatch(
      /^shiftdown and copyfrom1 run as two dispatches because shiftdown writes `out\[i - 1\]` \(line \d+\)$/,
    );
    const { store } = together(steps, init, undefined, true);
    expect(differing(apart(steps, init), store)).toContain('out');
  });

  it('sees a loop that continues fused anyway, whose return would end the calls after it', () => {
    const steps = [step('skipneg', t, a), step('add', out, t, b)];
    const init = fresh([a, data(33)], [b, data(34)], [t], [out]);
    const calls = steps.map((s) => groupCall(s, init));
    expect(groupCalls(calls, 8)[1]!.why).toBe(
      'skipneg and add run as two dispatches because skipneg has a loop with a `continue`',
    );
    // The builder refuses to build it as well, since it would end every call after it.
    const fused = fusedFor(
      steps.map((_, m) => ({ k: calls[m]!.k, slots: assignSlots(calls).slots[m]! })),
    );
    expect(fused).toEqual({
      none: 'skipneg() returns inside its loop, which would end the others',
    });
  });

  it('refuses a strided write when a later call reads the array', () => {
    const steps = [step('stride', t, a), step('copy', out, t)];
    const init = fresh([a, data(35, 35)], [t, zeros()], [out, zeros(35)]);
    const calls = steps.map((s) => groupCall(s, init));
    const groups = groupCalls(calls, 8);
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toMatch(
      /^stride and copy run as two dispatches because stride writes `out\[2 \* i\]` \(line \d+\)$/,
    );
  });
});

describe('the comparison notices a reduction fused against the facts', () => {
  it('sees a stencil in the reduction fused anyway, which reads what a later index writes', () => {
    const steps = [step('add', t, a, b), step('sumstencil', t)];
    const init = fresh([a, ramp(300, 140)], [b, ramp(301 - 1, 141)], [t, zeros(300)]);
    const calls = steps.map((x) => groupCall(x, init));
    // The planner refuses it, and says why in the words of the fact.
    const groups = groupCalls(calls, 8);
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toMatch(
      /^add and sumstencil run as two dispatches because sumstencil reads `xs\[i \^ 1\]` \(line \d+\)$/,
    );
    const results: (CpuValue | undefined)[] = [];
    const want = apart(steps, init, results);
    // Forced into one group, thread i reads t[i ^ 1] before, or after, the thread that writes it.
    const wrong = together(steps, init, undefined, true);
    expect(same(wrong.result, results[1])).toBe(false);
    expect(differing(want, wrong.store)).toEqual([]);
  });

  it('sees a sum fused with a prologue that writes the array it reads one index late', () => {
    // shiftdown(t, a) writes t[i - 1] for i from 1; the sum reads t[i] for i from 0.
    const steps = [step('shiftdown', t, a), step('sum', t)];
    const init = fresh([a, ramp(300, 142)], [t, ramp(300, 143)]);
    const calls = steps.map((x) => groupCall(x, init));
    expect(groupCalls(calls, 8).map((g) => g.calls)).toEqual([[0], [1]]);
    const results: (CpuValue | undefined)[] = [];
    apart(steps, init, results);
    expect(same(together(steps, init, undefined, true).result, results[1])).toBe(false);
  });

  it.each<PlanFault>(['drop-last-partial', 'skip-first-iteration'])(
    'sees a fold that is wrong (%s), whatever the prologue computes',
    (fault) => {
      const ch = REDUCED.find((x) => x.title.startsWith('add -> dot over 1000'))!;
      const results: (CpuValue | undefined)[] = [];
      apart(ch.steps, ch.init, results);
      const right = together(ch.steps, ch.init, undefined, false, ch.scratch ?? []);
      const wrong = together(ch.steps, ch.init, undefined, false, ch.scratch ?? [], [], fault);
      expect(same(right.result, results[1])).toBe(true);
      expect(same(wrong.result, results[1])).toBe(false);
    },
  );

  it('refuses a reduction that has a continue of its own, which the planner keeps apart', () => {
    const steps = [step('add', t, a, b), step('sumnegs', t)];
    const init = fresh([a, ramp(300, 144)], [b, ramp(300, 145)], [t, zeros(300)]);
    const groups = groupCalls(
      steps.map((x) => groupCall(x, init)),
      8,
    );
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toBe(
      'add and sumnegs run as two dispatches because sumnegs has a loop with a `continue`',
    );
  });

  it('keeps a reduction apart when its loop runs another range than the call before it', () => {
    const steps = [step('stepper', t, a), step('sum', t)];
    const init = fresh([a, ramp(70, 146)], [t, ramp(70, 147)]);
    const groups = groupCalls(
      steps.map((x) => groupCall(x, init)),
      8,
    );
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    // stepper counts from 3 by 2 to 70: 34 iterations; the sum counts 70.
    expect(groups[1]!.why).toBe(
      'stepper and sum run as two dispatches because the trip counts differ (34 and 70)',
    );
  });

  it('builds no entry where a call that reduces is not the last of its group', () => {
    const steps = [step('sum', t), step('add', u, t, a)];
    const calls = steps.map((x) => groupCall(x, fresh([a, data(1)], [t], [u])));
    const { slots } = assignSlots(calls);
    expect(fusedFor(calls.map((x, m) => ({ k: x.k, slots: slots[m]! })))).toEqual({
      none: 'sum() reduces, and only the last call of a group may',
    });
    // Two calls that reduce: the first is not the last.
    const twice = [step('sum', t), step('sum', t)].map((x) => groupCall(x, fresh([t])));
    expect(fusedFor(twice.map((x) => ({ k: x.k, slots: [0] })))).toEqual({
      none: 'sum() reduces, and only the last call of a group may',
    });
  });
});

describe('the comparison notices a scratch array contracted against the facts', () => {
  it('sees a stencil over a scratch array contracted anyway: the index is dropped, and so is the neighbour', () => {
    const steps = [step('add', t, a, b), step('pairsum', out, t)];
    const init = fresh([a, data(90)], [b, data(91)], [t], [out]);
    const calls = steps.map((x) => groupCall(x, init));
    // The planner refuses the pair, so it contracts nothing, and says why in the words of the fact.
    const groups = groupCalls(calls, 8, new Set([t]));
    expect(groups.map((g) => [g.calls, g.contracted])).toEqual([
      [[0], []],
      [[1], []],
    ]);
    expect(groups[1]!.why).toMatch(
      /^add and pairsum run as two dispatches because pairsum reads `t\[i \^ 1\]` \(line \d+\)$/,
    );
    const want = apart(steps, init);
    // Forced into one entry with `t` a local, `pairsum` reads `t[i]` for `t[i ^ 1]`: a wrong answer.
    const wrong = together(steps, init, undefined, true, [t], [t]);
    expect(wrong.contracted).toEqual([t]);
    expect(differing(want, wrong.store, [t])).toContain('out');
    // Forced with `t` a buffer, it is the race the unfused calls do not have: also wrong.
    expect(differing(want, together(steps, init, undefined, true).store)).toContain('out');
  });

  it('sees a read of a shifted index contracted anyway', () => {
    // shiftdown writes t[i - 1]; copyfrom1 reads t[i], which a later index of shiftdown writes.
    const steps = [step('shiftdown', t, a), step('copyfrom1', out, t)];
    const init = fresh([a, data(92)], [t], [out]);
    const calls = steps.map((x) => groupCall(x, init));
    expect(groupCalls(calls, 8, new Set([t])).map((g) => g.contracted)).toEqual([[], []]);
    const wrong = together(steps, init, undefined, true, [t], [t]);
    expect(differing(apart(steps, init), wrong.store, [t])).toContain('out');
  });

  it('sees a write that is not at i contracted anyway', () => {
    // stride writes out[2 * i]; the local takes every thread's write for its own element.
    const steps = [step('stride', t, a), step('copy', out, t)];
    const init = fresh([a, data(93, 35)], [t, zeros()], [out, zeros()]);
    const calls = steps.map((x) => groupCall(x, init));
    expect(groupCalls(calls, 8, new Set([t])).map((g) => g.contracted)).toEqual([[], []]);
    const wrong = together(steps, init, undefined, true, [t], [t]);
    expect(differing(apart(steps, init), wrong.store, [t])).toContain('out');
  });
});

describe('the entry', () => {
  const ch = FUSED[0]!;

  it('is one compute entry with one binding for each distinct array and one merged uniform', () => {
    const { fused } = together(ch.steps, ch.init);
    const wgsl = fused.entry.wgsl;
    expect(wgsl.match(/@compute/g)).toHaveLength(1);
    // t, a, b, u, c, out: six arrays, and the uniform.
    expect(fused.entry.bindings.map((x) => [x.binding, x.space])).toEqual([
      [0, 'uniform'],
      [1, 'storage'],
      [2, 'storage'],
      [3, 'storage'],
      [4, 'storage'],
      [5, 'storage'],
      [6, 'storage'],
    ]);
    expect(wgsl.match(/var<storage, read_write>/g)).toHaveLength(3);
    expect(wgsl.match(/var<storage, read>/g)).toHaveLength(3);
    expect(fused.entry.fn).toBe('fused_add_mul_relu');
    expect(fused.entry.name).toBe('add+mul+relu');
    expect(fused.entry.wg).toEqual([64, 1, 1]);
    expect(fused.entry.params).toEqual(['global_invocation_id', 'num_workgroups', 'workgroup_id']);
    // The text is what the writer emits for the module, and one scaffold stands for the group
    // (change 0096): the return of a workgroup wholly past the trip count, one flag, one clamp.
    expect(wgsl).toBe(emitModule(fused.module));
    expect(wgsl.match(/\) >= _fargs\.c0__n\)/g)).toHaveLength(1);
    expect(wgsl.match(/let _live = \(_k < _fargs\.c0__n\);/g)).toHaveLength(1);
    expect(wgsl.match(/let _kc = min\(_k, \(_fargs\.c0__n - 1u\)\);/g)).toHaveLength(1);
  });

  it('binds an array two calls share once, whatever the parameters are called', () => {
    const rep = FUSED[2]!;
    const { fused } = together(rep.steps, rep.init);
    // t, a, b, u: `a` is a parameter of both calls and one binding.
    expect(fused.slots).toHaveLength(4);
    expect(fused.module.bindings).toHaveLength(5);
  });

  it('reads an edge from a var local, never a let', () => {
    const { fused } = together(ch.steps, ch.init);
    // The producers keep their writes, and the later call reads the local.
    expect(fused.entry.wgsl).toMatch(/var _fe0: f32;/);
    expect(fused.entry.wgsl).toMatch(/var _fe1: f32;/);
    expect(fused.entry.wgsl).not.toMatch(/let _fe/);
    expect(fused.entry.wgsl).toMatch(/_fr0\[_fc0_i\] = /);
    expect(fused.entry.wgsl).toMatch(/_fe0 = _fr0\[_fc0_i\];/);
  });

  it('a group with an edge runs every iteration under the lane flag, after the locals (change 0096, decision D2)', () => {
    // A lane past the trip count would read, through the edge's local, what the writer's lane
    // wrote for iteration n - 1 in the same dispatch; so the group skips its iterations as one.
    const { fused } = together(ch.steps, ch.init);
    expect(fused.entry.wgsl).toMatch(
      /let _kc = min\(_k, \(_fargs\.c0__n - 1u\)\);\n(\s+var _f\w+: f32;\n)+\s+if \(_live\) \{\n(.*\n)*?\s+let _fc0_i = /,
    );
    // The entry ends with the group's one block: no iteration follows it.
    expect(fused.entry.wgsl.trimEnd()).toMatch(/\n  \}\n\}$/);
    // A group with no edge keeps the clamped form: each write masked, no block around the
    // iterations. Both calls read `pa`, and neither reads what the other writes.
    const pa = arr('pa');
    const pt = arr('pt');
    const po = arr('po');
    const plain = together(
      [step('square', pt, pa), step('triple', po, pa)],
      fresh([pa, data(71, 300)], [pt, zeros(300)], [po, zeros(300)]),
    );
    expect(plain.fused.entry.wgsl).not.toMatch(/var _fe\d+: /);
    expect(plain.fused.entry.wgsl).toMatch(
      /let _kc = min\(_k, \(_fargs\.c0__n - 1u\)\);\n(\s+let _gv\d+ = u32\(_kc\);\n)?\s+let _fc0_i = /,
    );
    expect(plain.fused.entry.wgsl).not.toMatch(/\n  if \(_live\) \{\n\s+let _fc0_i = /);
  });

  it('includes a helper once for each (origin, name), and renames the other file`s', () => {
    const h = FUSED[4]!;
    const { fused } = together(h.steps, h.init);
    const names = fused.module.funcs.map((f) => f.name);
    // file A's act (used twice, one function) and file B's act (renamed), and the entry.
    expect(names.filter((n) => n !== fused.entry.fn)).toEqual(['act', '_fh1_act']);
  });

  it('declares the guard of an emulated f64 as a binding the runtime supplies', () => {
    const d = FUSED[FUSED.length - 1]!;
    const { fused } = together(d.steps, d.init);
    const guard = fused.entry.bindings.find((x) => x.name === '_fp64');
    expect(guard).toMatchObject({ space: 'texture', guard: true, group: 0 });
    expect(fused.entry.wgsl).toMatch(/var _fp64: texture_2d<f32>/);
    expect(fused.entry.wgsl).toMatch(/@group\(0\) @binding\(\d+\) var _fp64/);
  });

  it('builds the entry of the integer flavor apart, with no guard on either entry (change 0073)', () => {
    const map = FUSED[FUSED.length - 1]!;
    const reduced = REDUCED.find((x) => x.title.startsWith('an f64 sum'))!;
    for (const d of [map, reduced]) {
      const calls = d.steps.map((s) => groupCall(s, d.init));
      const { slots } = assignSlots(calls);
      const members = d.steps.map((_, m) => ({ k: calls[m]!.k, slots: slots[m]! }));
      const float = fusedFor(members) as Fused;
      const integer = fusedFor(members, [], 'integer') as Fused;
      expect('none' in integer).toBe(false);
      expect(integer).not.toBe(float);
      expect(float.entry.wgsl).toMatch(/var _fp64: texture_2d<f32>/);
      expect(integer.entry.wgsl).not.toContain('_fp64');
      expect(integer.entry.wgsl).toContain('fn df64_ipack');
      expect(integer.reduce === undefined).toBe(d === map);
      for (const entry of [integer.entry, ...(integer.reduce ? [integer.reduce.fold] : [])])
        expect(entry.bindings.find((x) => x.name === '_fp64')).toBeUndefined();
      // Each flavor's entry is built once for its shape.
      expect(fusedFor(members, [], 'integer')).toBe(integer);
      expect(fusedFor(members)).toBe(float);
    }
  });

  it('builds no entry from a face with no fuse record, or from IR of another version', () => {
    const k = A.faces.get('add')!;
    const bare: KernelFace = { ...k };
    delete (bare as { fuse?: unknown }).fuse;
    expect(
      fusedFor([
        { k: bare, slots: [0, 1, 2] },
        { k: A.faces.get('mul')!, slots: [3, 0, 4] },
      ]),
    ).toEqual({
      none: 'add() carries no fuse record of one loop',
    });
    const old: KernelFace = {
      ...k,
      fuse: { ...k.fuse!, ir: { ...k.fuse!.ir, version: '0.0.0-old' } },
    };
    const r = fusedFor([
      { k: old, slots: [0, 1, 2] },
      { k: A.faces.get('mul')!, slots: [3, 0, 4] },
    ]);
    expect('none' in r && r.none).toMatch(
      /^add\(\) was built by typeshade 0\.0\.0-old, and this runtime is typeshade /,
    );
  });

  it('builds no entry where two calls write one array, which the planner refuses', () => {
    const calls = [step('add', t, a, b), step('mul', t, a, c)].map((s) =>
      groupCall(s, fresh([a, data(1)], [b, data(2)], [c, data(3)], [t])),
    );
    const { slots } = assignSlots(calls);
    expect(fusedFor(calls.map((x, m) => ({ k: x.k, slots: slots[m]! })))).toEqual({
      none: 'add() and mul() both write one array',
    });
  });

  it('builds no entry where two files declare one name differently', () => {
    const left = load(
      `"use typeshade";\nconst SCALE: f32 = 2.;\nexport function scaled(out: array<f32>, x: array<f32>): void {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[i] * SCALE;\n  }\n}\n`,
      '/app/left.shade.ts',
    );
    const right = load(
      `"use typeshade";\nconst SCALE: f32 = 3.;\nexport function scaledAgain(out: array<f32>, x: array<f32>): void {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[i] * SCALE;\n  }\n}\n`,
      '/app/right.shade.ts',
    );
    const r = fusedFor([
      { k: left.faces.get('scaled')!, slots: [0, 1] },
      { k: right.faces.get('scaledAgain')!, slots: [2, 0] },
    ]);
    expect(r).toEqual({
      none: 'const "SCALE" is declared differently in /app/left.shade.ts and in /app/right.shade.ts',
    });
  });
});

describe('the entry of a group that ends in a reduction', () => {
  // relu(t, a) keeps t in storage; square(u, t) and sum(u) hold u as a local.
  const ch = REDUCED[2]!;
  const built = () => together(ch.steps, ch.init, undefined, false, ch.scratch ?? []);

  it('is the loop entry and the fold entry of the last call in one module, both at the workgroup of 256', () => {
    const { fused } = built();
    const wgsl = fused.entry.wgsl;
    expect(fused.wg).toBe(256);
    expect(fused.entry.fn).toBe('fused_relu_square_sum');
    expect(fused.reduce!.fold.fn).toBe('fused_relu_square_sum_fold');
    // One module: the two entries read the same text, and the producers' 64 is nowhere in it.
    expect(fused.reduce!.fold.wgsl).toBe(wgsl);
    expect(wgsl).toBe(emitModule(fused.module));
    expect(wgsl.match(/@compute @workgroup_size\(256\)/g)).toHaveLength(2);
    expect(wgsl).not.toMatch(/workgroup_size\(64\)/);
    expect(fused.entry.wg).toEqual([256, 1, 1]);
    expect(fused.reduce!.fold.wg).toEqual([256, 1, 1]);
    const tree = [
      'global_invocation_id',
      'num_workgroups',
      'workgroup_id',
      'local_invocation_index',
    ];
    expect(fused.entry.params).toEqual(tree);
    expect(fused.reduce!.fold.params).toEqual(tree);
    // The reduction's own struct and workgroup array, declared once.
    expect(wgsl.match(/struct sum_loop0_Sums/g)).toHaveLength(1);
    expect(wgsl.match(/var<workgroup> sum_loop0_tree_s: array<f32, 256>;/g)).toHaveLength(1);
    // One scaffold on the trip count: the loop entry's, and no index of a producer. A lane past
    // the trip count runs the last iteration through the helper and gives the tree the identity
    // (change 0096). The helper builds its struct through a pointer (change 0105).
    expect(wgsl).toMatch(/let _live = \(_k < _fargs\.c2__n\);/);
    expect(wgsl).toMatch(
      /var _ran: sum_loop0_Sums;\n\s+fused_relu_square_sum_iteration_into\(&_ran, _kc, _live\);\n\s+if \(_live\) \{\n\s+_sums = _ran;/,
    );
    expect(wgsl).not.toMatch(/_k >= /);
    expect(wgsl).not.toMatch(/relu_loop0|square_loop0|sum_loop0_iteration/);
  });

  it('binds the arrays and then the partials, and the fold binds the uniform and the partials', () => {
    const { fused } = built();
    // The uniform, t and a (the arrays the entry binds: u is a local), then the sum's partials.
    expect(fused.entry.bindings.map((x) => [x.name, x.binding, x.space])).toEqual([
      ['_fargs', 0, 'uniform'],
      ['_fr0', 1, 'storage'],
      ['_fr1', 2, 'storage'],
      ['sum_loop0_s', 3, 'storage'],
    ]);
    expect(fused.reduce!.fold.bindings.map((x) => [x.name, x.binding, x.space])).toEqual([
      ['_fargs', 0, 'uniform'],
      ['sum_loop0_s', 3, 'storage'],
    ]);
    expect(fused.reduce!.vars.map((v) => [v.name, v.op, v.scalar, v.n, v.binding.binding])).toEqual(
      [['s', '+', 'f32', 1, 3]],
    );
    expect(fused.reduce!.fields).toEqual({ n: 'c2__n', in: 'c2__in', out: 'c2__out' });
    // The module numbers them the same way.
    expect(fused.module.bindings.map((x) => [x.name, x.binding])).toEqual([
      ['_fargs', 0],
      ['_fr0', 1],
      ['_fr1', 2],
      ['sum_loop0_s', 3],
    ]);
    // The slots are the arrays: the partials are not among them.
    expect(fused.slots.map((x) => x.array)).toEqual([0, 1]);
  });

  it('runs the calls before the last as a prologue of the helper, which takes the index as its parameter', () => {
    const { fused } = built();
    const wgsl = fused.entry.wgsl;
    const at = wgsl.indexOf(
      'fn fused_relu_square_sum_iteration_into(_dst: ptr<function, sum_loop0_Sums>, _k: u32, _live: bool) {',
    );
    expect(at).toBeGreaterThan(0);
    const helper = wgsl.slice(at, wgsl.indexOf('\n}\n', at));
    // The local of the scratch array and the local of the edge come first, as the entry's would.
    expect(helper).toMatch(/^[^\n]*\n\s+var _fs2: f32;\n\s+var _fe0: f32;\n/);
    // The producers: each counts from its own start, from the index the helper is given.
    expect(helper).toMatch(/_fc0_i = \(_fargs\.c0__start \+ _cse0\)/);
    expect(helper).toMatch(/_fr0\[_fc0_i\] = max\(_fr1\[_fc0_i\], 0\.0\);/);
    // The kept edge: t is written to storage, and the next call reads it from the local.
    expect(helper).toMatch(/_fe0 = _fr0\[_fc0_i\];/);
    expect(helper).toMatch(/_fs2 = act\(_fe0\);/);
    // The reduction's own iteration follows: from the identity, then the body, then the sums.
    expect(helper.indexOf('_fs2 = act')).toBeLessThan(
      helper.indexOf('_fc2_s = bitcast<f32>(2147483648u)'),
    );
    expect(helper).toMatch(/_fc2_s \+= _fs2;/);
    expect(helper).toMatch(/\(\*_dst\) = sum_loop0_Sums\(_fc2_s\);/);
    // No other function takes the index as a parameter, and the entries still index the invocation.
    expect(wgsl.match(/_k: u32, _live: bool\)/g)).toHaveLength(1);
    expect(wgsl.match(/let _k = /g)).toHaveLength(2);
  });

  it('includes the helpers of the calls before the last once, and no helper of the reduction itself', () => {
    const h = REDUCED.find((x) => x.title.startsWith('helpers of two files'))!;
    const { fused } = together(h.steps, h.init, undefined, false, h.scratch ?? []);
    const names = fused.module.funcs.map((f) => f.name);
    // File A's act, file B's act (renamed), the helper that runs the iteration, and the two entries.
    expect(names).toEqual([
      'act',
      '_fh1_act',
      'fused_square_bias_sum_iteration',
      'fused_square_bias_sum',
      'fused_square_bias_sum_fold',
    ]);
  });

  it('binds the _fp64 guard of an emulated f64 on both entries', () => {
    const d = REDUCED.find((x) => x.title.startsWith('an f64 sum'))!;
    const { fused } = together(d.steps, d.init);
    for (const entry of [fused.entry, fused.reduce!.fold]) {
      const guard = entry.bindings.find((x) => x.name === '_fp64');
      expect(guard).toMatchObject({ space: 'texture', guard: true, group: 0 });
    }
    expect(fused.entry.wgsl).toMatch(/@group\(0\) @binding\(\d+\) var _fp64: texture_2d<f32>/);
    // The partials are an array of f64 numbers, as the face of the reduction lays them out.
    expect(fused.reduce!.vars.map((v) => [v.name, v.scalar, v.binding.s])).toEqual([
      ['s', 'f64', 'array<f64>'],
    ]);
  });

  it('declares a partials binding for each variable the reduction folds', () => {
    const v = REDUCED.find((x) => x.title.startsWith('a reduction of two variables'))!;
    const { fused } = together(v.steps, v.init, undefined, false, v.scratch ?? []);
    expect(fused.reduce!.vars.map((x) => [x.name, x.binding.name, x.binding.binding])).toEqual([
      ['s', 'spread_loop0_s', 3],
      ['m', 'spread_loop0_m', 4],
    ]);
    // `t` is a local, so the arrays the entry binds are `a` and `b`, the slots 1 and 2.
    expect(fused.entry.bindings.map((x) => x.name)).toEqual([
      '_fargs',
      '_fr1',
      '_fr2',
      'spread_loop0_s',
      'spread_loop0_m',
    ]);
  });

  it('gives the merged uniform a start and a count for each call, and `_in` and `_out` for the reduction', () => {
    const calls = ch.steps.map((x) => groupCall(x, ch.init));
    const u = uniformFor(
      ch.steps.map((x, m) => ({ k: calls[m]!.k, hosts: x.args, range: calls[m]!.range! })),
    );
    expect(u).toEqual({
      c0__start: 0,
      c0__n: 2000,
      c1__start: 0,
      c1__n: 2000,
      c2__start: 0,
      c2__n: 2000,
      c2__in: 0,
      c2__out: 0,
    });
  });

  it('is built once for a shape, whatever the lengths, with the fold part of the shape', () => {
    const calls = ch.steps.map((x) => groupCall(x, ch.init));
    const { slots } = assignSlots(calls);
    const members = calls.map((x, m) => ({ k: x.k, slots: slots[m]! }));
    const one = fusedFor(members, [2]) as Fused;
    expect(one.reduce).toBeDefined();
    const longer = fresh(...[a, t, u].map((x, i): [Arr, number[]?] => [x, data(150 + i, 300)]));
    const again = ch.steps.map((x) => groupCall(x, longer));
    expect(
      fusedFor(
        again.map((x, m) => ({ k: x.k, slots: assignSlots(again).slots[m]! })),
        [2],
      ),
    ).toBe(one);
    // The same calls with the scratch array a buffer are another entry.
    expect(fusedFor(members)).not.toBe(one);
  });

  it('builds no entry from a record whose reduction lacks its helper, or its fold entry', () => {
    const k = A.faces.get('sum')!;
    const lacking = (
      change: Partial<NonNullable<KernelFace['fuse']>['facts'][number]>,
    ): KernelFace => ({
      ...k,
      fuse: { ...k.fuse!, facts: [{ ...k.fuse!.facts[0]!, ...change }] },
    });
    const members = (face: KernelFace) => [
      { k: A.faces.get('relu')!, slots: [0, 1] },
      { k: face, slots: [0] },
    ];
    const none =
      'sum() has no reducing entry "sum_loop0" with its helper and fold entry in its fuse record';
    expect(fusedFor(members(lacking({ fold: 'nowhere' })))).toEqual({ none });
    expect(fusedFor(members(lacking({ iterates: 'nowhere' })))).toEqual({ none });
    expect(fusedFor(members(lacking({ iteration: 2 })))).toEqual({ none });
  });
});

describe('the cache', () => {
  const ch = FUSED[0]!;
  const members = (steps: readonly Step[], init: Store) => {
    const calls = steps.map((s) => groupCall(s, init));
    const { slots } = assignSlots(calls);
    return steps.map((_, m) => ({ k: calls[m]!.k, slots: slots[m]! }));
  };

  it('keeps one entry for a shape, whatever the lengths and the values', () => {
    const one = fusedFor(members(ch.steps, ch.init));
    // Other arrays of other lengths with other contents, and other scalars: one shape.
    const longer = fresh(
      ...[a, b, c, t, u, out].map((x, i): [Arr, number[]?] => [x, data(40 + i, 300)]),
    );
    const two = fusedFor(members(ch.steps, longer));
    expect(two).toBe(one);
    const scaled = [step('scale', t, a, 1), step('relu', out, t)];
    const x = fusedFor(members(scaled, fresh([a, data(1)], [t], [out])));
    const y = fusedFor(
      members(
        [step('scale', t, a, 99), step('relu', out, t)],
        fresh([a, data(2, 9)], [t, zeros(9)], [out, zeros(9)]),
      ),
    );
    expect(y).toBe(x);
  });

  it('makes another entry for another arrays pattern, another order or another call', () => {
    const one = fusedFor(members(ch.steps, ch.init)) as Fused;
    // add(t, a, b), mul(u, t, a): the slot of mul's `b` is another array's.
    const other = fusedFor(
      members(
        [step('add', t, a, b), step('mul', u, t, a), step('relu', out, u)],
        fresh([a, data(1)], [b, data(2)], [t], [u], [out]),
      ),
    ) as Fused;
    expect(other).not.toBe(one);
    expect(other.entry).not.toBe(one.entry);
    // One call fewer.
    const shorter = fusedFor(members(ch.steps.slice(0, 2), ch.init)) as Fused;
    expect(shorter).not.toBe(one);
  });

  it('keeps a failure for its shape too', () => {
    const k = A.faces.get('add')!;
    const bare: KernelFace = { ...k };
    delete (bare as { fuse?: unknown }).fuse;
    const m = [
      { k: bare, slots: [0, 1, 2] },
      { k: A.faces.get('mul')!, slots: [3, 0, 4] },
    ];
    expect(fusedFor(m)).toBe(fusedFor(m));
  });
});

// ─── the size of a group (proposal 0067, F7) ─────────────────────────────────────────────────

describe('a fused group runs at the size its calls declare', () => {
  it('builds one entry at 128 for a map of 64 and a map that declares 128, with the index at 128', () => {
    const { fused } = together(
      [step('square', t, a), step('triple', out, t)],
      fresh([a, data(64)], [t], [out]),
    );
    expect(fused.wg).toBe(128);
    expect(fused.entry.wg).toEqual([128, 1, 1]);
    const wgsl = fused.entry.wgsl;
    expect(wgsl.match(/@compute @workgroup_size\(128\)/g)).toHaveLength(1);
    expect(wgsl).not.toMatch(/workgroup_size\(64\)/);
    // The invocation index counts in workgroups of 128, though the first call was built at 64.
    expect(wgsl).toMatch(/let _k = \(_gid\.x \+ \(_gid\.y \* \(_nwg\.x \* 128u\)\)\);/);
  });

  it('splits a chain whose declared sizes differ, and says both sizes', () => {
    const init = fresh([a, data(65)], [t], [out]);
    const calls = [step('triple', t, a), step('quad', out, t)].map((s) => groupCall(s, init));
    const groups = groupCalls(calls, 8);
    expect(groups.map((g) => g.calls)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toBe(
      'triple and quad run as two dispatches because workgroup size 64 of quad() differs from 128 of triple()',
    );
  });
});

describe('a fused group of size 128 numbers its invocations across workgroups (proposal 0067)', () => {
  // 300 elements are three workgroups of 128, the last one partly past the end.
  const M = 300;
  const chain = (): { steps: Step[]; init: Store } => ({
    steps: [step('square', t, a), step('triple', out, t)],
    init: fresh([a, data(71, M)], [t, zeros(M)], [out, zeros(M)]),
  });

  it('matches the calls run apart when the length is not a multiple of the size', () => {
    const { steps, init } = chain();
    const want = apart(steps, init);
    const { store, fused } = together(steps, init);
    expect(fused.wg).toBe(128);
    expect(differing(want, store)).toEqual([]);
  });

  it('matches when the dispatch spills into y, as one past 65535 workgroups does', () => {
    const { steps, init } = chain();
    const want = apart(steps, init);
    // A grid of 2 by 2 workgroups: the index is gid.x + gid.y * (nwg.x * 128), so the fourth
    // workgroup starts at element 384, past the end, and no element runs twice.
    const { store } = together(steps, init, undefined, false, [], [], undefined, [2, 2, 1]);
    expect(differing(want, store)).toEqual([]);
  });
});
