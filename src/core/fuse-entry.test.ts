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
// It carries no rule tag yet: the rule it verifies is written by a later step of the change,
// which tags this file then (`reqs/README.md`).

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
import type { OptLevel } from './passes/opt/optimize.js';
import { proveKernels } from './passes/parallel-loop.js';
import { lowerKernel, type KernelPlan } from './passes/kernel-lower.js';
import { copy, runKernelPlan, scheduleKernelPlan } from './testing/kernel-plan.js';

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
`;

/** File B. Its private helper is also called `act`, and it is another function. */
const POST = `"use typeshade";
function act(x: f32): f32 { return max(x, 0.) + 1.; }
export function bias(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = act(x[i]);
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

const A = load(OPS, '/app/ops.shade.ts');
const B = load(POST, '/app/post.shade.ts');
const lib = (fn: string): { file: Loaded; face: KernelFace } => {
  const file = B.faces.has(fn) ? B : A;
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

/** The calls one after another, each as its own lowered plan on the oracle. */
function apart(steps: readonly Step[], init: Store): Store {
  const store = cloneStore(init);
  for (const s of steps) {
    const { file } = lib(s.fn);
    const ref = file.plans.get(s.fn)!;
    const f = ref.m.funcs.find((x) => x.name === s.fn)!;
    const values = s.args.map((a) => (a instanceof Arr ? ([...store.get(a)!] as CpuValue) : a));
    const run = runKernelPlan(ref.m, s.fn, ref.plan, values as CpuValue[]);
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
): { store: Store; fused: Fused; contracted: Arr[] } {
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
  cpu.setBinding(
    fused.args.name,
    uniformFor(
      steps.map((s, m) => ({ k: calls[m]!.k, hosts: s.args, range: calls[m]!.range! })),
    ) as unknown as CpuValue,
  );
  // An array the entry holds as a local has no slot, so it is bound to nothing.
  fused.slots.forEach((slot) =>
    cpu.setBinding(slot.name, store.get(arrays[slot.array] as Arr)! as unknown as CpuValue),
  );
  cpu.dispatch(fused.entry.fn, Math.ceil(calls[0]!.range!.n / fused.wg));
  return { store, fused, contracted: held };
}

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
    expect(fused.entry.params).toEqual(['global_invocation_id', 'num_workgroups']);
    // The text is what the writer emits for the module, and one guard stands for the group.
    expect(wgsl).toBe(emitModule(fused.module));
    expect(wgsl.match(/_k >= /g)).toHaveLength(1);
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
