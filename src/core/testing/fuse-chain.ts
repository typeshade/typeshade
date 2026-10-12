// ═══ A generated chain of kernel calls, grouped by the fuse planner and run apart (change 0058) ═══
//
// `generateChain` (`random-ir.ts`) draws a chain: kernel functions in one module, and the calls to
// make over arrays the caller keeps. This file turns one into what the fuse scope works on, and
// into what holds the scope to account, with no browser:
//
//   faces    `lowerFace`: the face of each kernel function with its fuse record, built from the IR
//            the way `fuseRecord` (`compiler/ts/host-face.ts`) builds it from a compiled source.
//            The generator writes IR and no source, so the face cannot come from `hostFace`.
//            `random-chain.test.ts` holds the two to each other on a source both can read.
//   planner  `groupCallsOf` feeds the planner (`core/fuse-group.ts`) the faces, the arrays and the
//            ranges the range functions give, as the scope's plan does.
//   model    `modelGroups` gives the groups the facts F1 to F5 allow, from the chain as the
//            generator BUILT it. It reads no fact the compiler wrote, so a fact the proof gets
//            wrong, or a planner that reads one wrong, makes the two disagree.
//   apart    `runApart` runs the calls one after another on the oracle, in `f32` or `f64`. The
//            CPU tier never fuses, so this is what a fused plan must give (Rule 11.7).
//   fused    `fuseGroup` builds the entry of a group, and `runGrouped` runs a plan's groups on the
//            oracle: a fused group as the entry the builder made, the others as their own lowered
//            plans. A group the planner refused can be run fused anyway, and a fault can be run
//            on purpose, so that a comparison can be shown to see them.
//
// `scripts/gpu-differential.ts` runs the same groups on WebGPU. Test code only.

import { emitModule, lowerWgsl } from '../backends/wgsl.js';
import type { CpuValue } from '../cpu-runtime.js';
import { fusedFor, uniformFor, type Fused } from '../fuse-entry.js';
import { assignSlots, type GroupCall } from '../fuse-group.js';
import type { EntryBinding, Layout } from '../host-entry.js';
import type {
  FuseArray,
  FuseLoop,
  KernelFace,
  KernelFuse,
  KernelLoop,
  KernelParam,
} from '../host-kernel.js';
import type { FuncDecl, ModuleDecl, ShaderType } from '../ir/index.js';
import { toPortable } from '../ir/portable.js';
import { layoutOf, calleesOf, closureOf } from '../manifest.js';
import { compileModule } from '../oracle.js';
import { fnWrites } from '../passes/effects.js';
import { lowerKernel, type KernelPlan } from '../passes/kernel-lower.js';
import { proveKernels } from '../passes/parallel-loop.js';
import type { OptLevel } from '../passes/opt/optimize.js';
import { VERSION } from '../version.js';
import { authorTypeText } from '../../compiler/ts/context.js';
import { bareArrays, hostTypeOf } from '../../compiler/ts/host-face.js';
import { describeRead } from '../../compiler/ts/kernel-loops.js';
import { copy, runKernelPlan, scheduleKernelPlan, tailOf } from './kernel-plan.js';
import { mulberry32, type ChainArray, type ChainCall, type ChainCorpus } from './random-ir.js';

// ─── faces ───────────────────────────────────────────────────────────────────────────────────

/** A kernel function as the call layer holds it: its face, with the fuse record, and the plan the
 *  face was made from, which runs the call on its own. */
export interface Lowered {
  readonly face: KernelFace;
  readonly m: ModuleDecl;
  readonly fn: string;
  readonly plan: KernelPlan;
}

/** A type as the face spells it: `array<f32>`, a struct by name. */
function spell(t: ShaderType): string {
  if (t.kind === 'struct') return t.name;
  if (t.kind === 'array')
    return t.size === undefined ? `array<${spell(t.elem)}>` : `array<${spell(t.elem)}, ${t.size}>`;
  return authorTypeText(t);
}

/** The lowered module without the helpers its entries do not reach, and without the spans:
 *  `reachedBy` of `host-face.ts`. A helper has no identity but its name, and the planner shares
 *  one by its origin and name. */
function reachedBy(m: ModuleDecl): ModuleDecl {
  const helpers = new Set(m.funcs.filter((g) => g.stage === undefined).map((g) => g.name));
  const callees = new Map(m.funcs.map((g) => [g.name, calleesOf(g, helpers)]));
  const keep = new Set<string>();
  for (const g of m.funcs)
    if (g.stage !== undefined) for (const name of closureOf(g.name, callees)) keep.add(name);
  return {
    ...m,
    funcs: m.funcs
      .filter((g) => keep.has(g.name))
      .map(({ span: _span, nameSpan: _nameSpan, ...g }): FuncDecl => g),
  };
}

/**
 * The face of kernel function `fn` of `m` under `typeshade({ fuse: true })`, or why it has none.
 * It follows `kernelFace` and `fuseRecord` of `compiler/ts/host-face.ts` for a function whose
 * loops lower and none of them reduces, as `random-chain.test.ts` holds: the parameters, what the
 * WebGPU tier dispatches, and the fuse record, which is the facts of each loop in the author's
 * words and the lowered module cut to what its entries reach, as portable IR.
 */
export function lowerFace(m: ModuleDecl, fn: string, origin: string): Lowered | { none: string } {
  const f = m.funcs.find((x) => x.name === fn);
  if (f === undefined) return { none: `no function "${fn}"` };
  const proof = proveKernels(m).find((p) => p.fn === fn);
  if (proof === undefined) return { none: 'it was not proved' };
  const plan = lowerKernel(f, m, proof);
  if ('noGpu' in plan) return { none: plan.noGpu };
  if (plan.loops.some((l) => l.reduce !== undefined)) return { none: 'it reduces' };
  const structs = new Map(plan.module.structs.map((s) => [s.name, s]));
  const written = fnWrites(m).get(fn) ?? new Set<string>();
  const params: KernelParam[] = [];
  for (const p of f.params) {
    if (p.type.kind === 'array' && p.type.size === undefined) {
      const layout = layoutOf(p.type, 'std430', structs, authorTypeText);
      if ('none' in layout) return { none: `parameter "${p.name}": ${layout.none}` };
      params.push({
        name: p.name,
        k: 'array',
        layout: layout as Layout & { k: 'a' },
        writes: written.has(p.name),
        s: spell(p.type),
      });
      continue;
    }
    const t = hostTypeOf(p.type, structs);
    if ('none' in t) return { none: `parameter "${p.name}": ${t.none}` };
    params.push({ name: p.name, k: 'value', type: t });
  }
  const result = hostTypeOf(f.ret, structs);
  if ('none' in result) return { none: `its result: ${result.none}` };
  const argsLayout = layoutOf(
    { kind: 'struct', name: plan.argsStruct },
    'std140',
    structs,
    authorTypeText,
  );
  if ('none' in argsLayout) return { none: argsLayout.none };
  const arrays = plan.module.bindings.filter((b) => b.name !== plan.argsBinding);
  const loops = plan.loops.map((l): KernelLoop => ({
    entry: l.entry,
    range: l.range,
    cop: l.cop,
    step: l.step,
    writes: l.writes,
    checks: l.checks,
    wg: l.wg,
  }));
  const arrayParams = f.params
    .filter((p) => p.type.kind === 'array' && p.type.size === undefined)
    .map((p) => p.name);
  const facts = plan.loops.map((l, j): FuseLoop => {
    const v = proof.loops[j]!;
    if (!v.ok) throw new Error(`${fn}: loop ${j + 1} lowered without an accepted proof`);
    const reached: FuseArray[] = [];
    for (const param of arrayParams) {
      const store = v.stores.find((x) => x.name === param);
      const fact = store ?? v.reads.find((x) => x.name === param);
      if (fact === undefined) continue;
      const first = describeRead(f, fact);
      reached.push({
        param,
        access: store === undefined ? 'read' : store.readBack ? 'readwrite' : 'write',
        atI: fact.atI,
        ...(first !== undefined ? { first } : {}),
      });
    }
    const bare = bareArrays(f, plan, l, arrayParams);
    return {
      entry: l.entry,
      wg: l.wg,
      arrays: reached,
      ...(bare.length > 0 ? { bare } : {}),
      reduces: false,
      scatters: v.writes.some((w) => w.kind === 'scatter'),
      continues: l.continues,
      iterates: l.iterates,
      iteration: l.iteration,
    };
  });
  const fuse: KernelFuse = { origin, facts, ir: toPortable(reachedBy(plan.module), VERSION) };
  const face: KernelFace = {
    name: fn,
    fn,
    params,
    result,
    fuse,
    gpu: {
      wgsl: emitModule(plan.module),
      args: {
        name: plan.argsBinding,
        group: 0,
        binding: 0,
        space: 'uniform',
        writes: false,
        layout: argsLayout,
        s: plan.argsStruct,
      },
      arrays: arrays.map((b): EntryBinding => {
        const p = params.find((x) => x.name === b.name) as KernelParam & { k: 'array' };
        return {
          name: b.name,
          group: b.group,
          binding: b.binding,
          space: 'storage',
          writes: p.writes,
          ...(b.access === 'read_write' ? { rw: true as const } : {}),
          layout: p.layout,
          s: p.s,
        };
      }),
      loops,
      ...(plan.tail !== undefined ? { tail: plan.tail } : {}),
    },
  };
  return { face, m, fn, plan };
}

/** The faces of every call of `c`, or why one call has none. A chain the generator draws has
 *  none that fails; the test holds that. */
export function lowerChain(c: ChainCorpus): Lowered[] | { none: string } {
  const out: Lowered[] = [];
  for (const call of c.calls) {
    const r = lowerFace(c.module, call.fn, `chain-${c.seed}`);
    if ('none' in r) return { none: `${call.fn}: ${r.none}` };
    out.push(r);
  }
  return out;
}

/** The face of `low` as a compiler would write it if it took every read of an array the loop does
 *  not write for a read at the loop's counter: a wrong fact, to show that a comparison reports a
 *  planner fed one. The builder then reads the producer's element in the place of the consumer's. */
export function readsAtCounter(low: Lowered): Lowered {
  const fuse = low.face.fuse!;
  return {
    ...low,
    face: {
      ...low.face,
      fuse: {
        ...fuse,
        facts: fuse.facts.map((f) => ({
          ...f,
          arrays: f.arrays.map((a) =>
            a.access === 'read' ? { param: a.param, access: a.access, atI: true } : a,
          ),
        })),
      },
    },
  };
}

// ─── inputs ──────────────────────────────────────────────────────────────────────────────────

/** The two array lengths a chain runs at: `n`, and `m` for the calls that run over another count. */
export interface Sizes {
  readonly n: number;
  readonly m: number;
}

/** How many elements array `a` holds. */
export const lengthOf = (a: ChainArray, s: Sizes): number => s[a.length.of] * a.length.times;

/** How many iterations call `call` runs: the loop counts from its start by its step while it is
 *  below the length of the array that bounds it. */
export function tripsOf(call: ChainCall, s: Sizes): number {
  const length = s[call.over];
  return length <= call.start ? 0 : Math.ceil((length - call.start) / call.step);
}

/** One scalar of `kind`, a boundary value when `boundary`. A corpus brings its own pool, so that
 *  a unit test draws every float and the GPU differential draws only the ones it can hold bit
 *  for bit. */
export type ScalarOf = (
  kind: 'f32' | 'i32' | 'u32',
  rnd: () => number,
  boundary: boolean,
) => number;

/** What a chain starts with: the contents of every array, by id, and the scalars each call is
 *  given, in the order of its scalar parameters. */
export interface Inputs {
  readonly arrays: ReadonlyMap<string, readonly CpuValue[]>;
  readonly scalars: readonly (readonly CpuValue[])[];
}

/** A value of type `t`, drawn with `scalarOf`. */
function valueOf(
  t: ShaderType,
  c: ChainCorpus,
  rnd: () => number,
  boundary: boolean,
  scalarOf: ScalarOf,
): CpuValue {
  if (t.kind === 'scalar') return scalarOf(t.scalar as 'f32', rnd, boundary);
  if (t.kind === 'vec')
    return Array.from({ length: t.n }, () => scalarOf(t.elem as 'f32', rnd, boundary));
  if (t.kind === 'struct')
    return Object.fromEntries(
      c.module.structs
        .find((s) => s.name === t.name)!
        .fields.map((f) => [f.name, valueOf(f.type, c, rnd, boundary, scalarOf)]),
    );
  throw new Error(`no generated value of ${t.kind}`);
}

/** The starting contents of a chain of lengths `s`. Every array starts with values, the ones a
 *  call writes included: where a call writes nothing, the old contents are what a later call
 *  reads. `variant` tells apart the runs of one chain; half the draws are at the boundaries. */
export function inputsOf(c: ChainCorpus, s: Sizes, variant: number, scalarOf: ScalarOf): Inputs {
  const rnd = mulberry32(c.seed * 7919 + s.n * 31 + s.m * 5 + variant);
  const boundary = variant % 2 === 1;
  const arrays = new Map<string, readonly CpuValue[]>();
  for (const a of c.arrays)
    arrays.set(
      a.id,
      Array.from({ length: lengthOf(a, s) }, () => valueOf(a.elem, c, rnd, boundary, scalarOf)),
    );
  const scalars = c.calls.map((call) =>
    call.args.flatMap((a) =>
      'scalar' in a ? [valueOf(a.scalar, c, rnd, boundary, scalarOf)] : [],
    ),
  );
  return { arrays, scalars };
}

/** The arguments of call `j`, in the order of its parameters: the arrays of `store`, or by
 *  default the arrays the chain starts with, and the call's scalars. */
export function callArgs(
  c: ChainCorpus,
  j: number,
  inputs: Inputs,
  store?: ReadonlyMap<string, CpuValue>,
): CpuValue[] {
  let next = 0;
  return c.calls[j]!.args.map((a) =>
    'array' in a
      ? (store?.get(a.array) ?? (inputs.arrays.get(a.array) as unknown as CpuValue))
      : inputs.scalars[j]![next++]!,
  );
}

// ─── apart ───────────────────────────────────────────────────────────────────────────────────

/** What a chain left: every array a call writes, by id, and every result a call returns, by the
 *  call's function. */
export interface Outcome {
  readonly arrays: Readonly<Record<string, CpuValue>>;
  readonly results: Readonly<Record<string, CpuValue>>;
}

/** The final contents of the arrays a call writes, and the results, from the store a run left. */
function outcomeOf(
  c: ChainCorpus,
  store: ReadonlyMap<string, CpuValue>,
  results: Map<string, CpuValue>,
): Outcome {
  return {
    arrays: Object.fromEntries(
      c.arrays.filter((a) => a.written).map((a) => [a.id, store.get(a.id)!]),
    ),
    results: Object.fromEntries(results),
  };
}

/** The calls of `c` one after another, each as the kernel function itself on the oracle at
 *  `precision`: the CPU tier, which never fuses (Rule 11.7). */
export function runApart(c: ChainCorpus, inputs: Inputs, precision: 'f32' | 'f64'): Outcome {
  const cpu = compileModule(c.module, { precision });
  const store = new Map<string, CpuValue>(
    [...inputs.arrays].map(([id, v]) => [id, copy(v as unknown as CpuValue)]),
  );
  const results = new Map<string, CpuValue>();
  c.calls.forEach((call, j) => {
    const r = cpu.fns[call.fn]!(...callArgs(c, j, inputs, store));
    if (r !== undefined) results.set(call.fn, r);
  });
  return outcomeOf(c, store, results);
}

// ─── the planner, and the model of it ────────────────────────────────────────────────────────

/** What the planner reads of each call: its face, its arrays by identity (the `ChainArray`
 *  object), the range its range function gives, and the tier. */
export function groupCallsOf(
  c: ChainCorpus,
  lows: readonly Lowered[],
  inputs: Inputs,
): GroupCall[] {
  const byId = new Map(c.arrays.map((a) => [a.id, a]));
  return c.calls.map((call, j) => {
    const low = lows[j]!;
    const first = scheduleKernelPlan(low.m, call.fn, low.plan, callArgs(c, j, inputs)).steps[0];
    return {
      k: low.face,
      arrays: call.args.map((a) => ('array' in a ? byId.get(a.array) : undefined)),
      range:
        first === undefined
          ? { start: 0, n: 0 }
          : { start: first.args['_start'] as number, n: first.args['_n'] as number },
      tier: 'webgpu',
    };
  });
}

/** Why the planner keeps a call out of the group before it: the fact that fails, in the order the
 *  planner checks them. */
export type Reason =
  'continues' | 'empty' | 'trips' | 'start' | 'step' | 'waw' | 'war' | 'read' | 'write' | 'limit';

/** A group the model expects, as indices into the chain's calls. */
export interface ModelGroup {
  readonly calls: readonly number[];
  /** Why the group stands apart from the one before it; absent for the first group. */
  readonly because?: Reason;
}

/** How a call reaches one array, from the chain as it was built. */
interface Reach {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly atI: boolean;
}

/** The arrays call `call` is given, with how it reaches each. An array it only measures is in
 *  the list, since the fused entry binds it. */
function reaches(call: ChainCall): Map<string, Reach> {
  const out = new Map<string, Reach>();
  for (const a of call.access)
    out.set(a.array, {
      reads: a.reads !== 'none',
      writes: a.writes !== 'none',
      atI: a.reads !== 'shifted' && a.writes !== 'strided',
    });
  return out;
}

/**
 * The groups the facts F1 to F5 give for chain `c` at sizes `s`, on a device that binds `limit`
 * storage buffers to a dispatch. It restates the rules of `core/fuse-group.ts` over what the
 * generator recorded, and reads no fact of any face.
 */
export function modelGroups(c: ChainCorpus, s: Sizes, limit: number): ModelGroup[] {
  const info = c.calls.map((call) => {
    const trips = tripsOf(call, s);
    return {
      call,
      trips,
      apart: call.continues ? ('continues' as const) : trips === 0 ? ('empty' as const) : undefined,
      by: reaches(call),
    };
  });
  const groups: { calls: number[]; because?: Reason }[] = [];
  const refusal = (members: readonly number[], next: number): Reason | undefined => {
    const n = info[next]!;
    const last = info[members[members.length - 1]!]!;
    if (n.apart !== undefined) return n.apart;
    if (last.apart !== undefined) return last.apart;
    const first = info[members[0]!]!;
    if (first.trips !== n.trips) return 'trips';
    if (first.call.start !== n.call.start) return 'start';
    if (first.call.step !== n.call.step) return 'step';
    for (const m of members.map((g) => info[g]!))
      for (const [id, mine] of m.by) {
        const theirs = n.by.get(id);
        if (theirs === undefined) continue;
        if (mine.writes && theirs.writes) return 'waw';
        if (theirs.writes && mine.reads) return 'war';
        if (mine.writes && theirs.reads) {
          if (!theirs.atI) return 'read';
          if (!mine.atI) return 'write';
        }
      }
    const bound = new Set<string>();
    for (const g of members) for (const id of info[g]!.by.keys()) bound.add(id);
    for (const id of n.by.keys()) bound.add(id);
    return bound.size > limit ? 'limit' : undefined;
  };
  info.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const no = last === undefined ? undefined : refusal(last.calls, i);
    if (last !== undefined && no === undefined) last.calls.push(i);
    else groups.push({ calls: [i], ...(no !== undefined ? { because: no } : {}) });
  });
  return groups;
}

/** The reason in the words of a `why` the planner gave, or undefined for words it does not give. */
export function reasonOf(why: string | undefined): Reason | undefined {
  if (why === undefined) return undefined;
  const m = /^\S+ and \S+ run as two dispatches because (.*)$/.exec(why);
  if (m === null) return undefined;
  const t = m[1]!;
  if (/^the trip counts differ/.test(t)) return 'trips';
  if (/^the loops start at different indices/.test(t)) return 'start';
  if (/^the loops step by different amounts/.test(t)) return 'step';
  if (/^one dispatch would bind \d+ storage buffers/.test(t)) return 'limit';
  if (/^\S+ writes an array \S+ also writes$/.test(t)) return 'waw';
  if (/^\S+ writes an array \S+ reads$/.test(t)) return 'war';
  if (/^\S+ reads `/.test(t)) return 'read';
  if (/^\S+ writes `/.test(t)) return 'write';
  if (/^\S+ has a loop with a `continue`$/.test(t)) return 'continues';
  if (/^\S+ has a loop that runs no iteration$/.test(t)) return 'empty';
  return undefined;
}

/** The groups as lists of call indices, for a comparison. */
export const shapeOf = (gs: readonly { readonly calls: readonly number[] }[]): number[][] =>
  gs.map((g) => [...g.calls]);

// ─── fused ───────────────────────────────────────────────────────────────────────────────────

/** The entry of the calls `idx` of a chain as one group, and the array each of its slots binds.
 *  The planner is not asked: a group it refused can be built too. */
export function fuseGroup(
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
): { fused: Fused; arrays: readonly object[] } | { none: string } {
  const { slots, arrays } = assignSlots(idx.map((i) => calls[i]!));
  const fused = fusedFor(idx.map((i, m) => ({ k: lows[i]!.face, slots: slots[m]! })));
  return 'none' in fused ? fused : { fused, arrays };
}

/** A fault to run on purpose: the first iteration of every fused group skipped, so that its entry
 *  is dispatched for one iteration fewer, starting one step later. */
export type GroupFault = 'skip-first-iteration';

/** The uniform of a fused group, with its fault, and how many invocations it dispatches. */
export function fusedUniform(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
  inputs: Inputs,
  fault?: GroupFault,
): { values: Record<string, unknown>; n: number } {
  const skip = fault === 'skip-first-iteration';
  const values = uniformFor(
    idx.map((i) => {
      const range = calls[i]!.range!;
      return {
        k: lows[i]!.face,
        hosts: callArgs(c, i, inputs),
        range: skip
          ? { start: range.start + c.calls[i]!.step, n: range.n - 1 }
          : { start: range.start, n: range.n },
      };
    }),
  );
  return { values, n: calls[idx[0]!]!.range!.n - (skip ? 1 : 0) };
}

/**
 * The plan `groups` of chain `c` on the oracle at `f32`: a group of more than one call as the
 * fused entry the builder made, run as one dispatch (at `level`, the passes the writer runs
 * first), and every other call as its own lowered plan. The results are the CPU tail's, as the
 * runtime gives them. With a fault, every fused group is run wrong on purpose.
 */
export function runGrouped(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  groups: readonly { readonly calls: readonly number[] }[],
  inputs: Inputs,
  opts: { level?: OptLevel; fault?: GroupFault } = {},
): Outcome {
  const store = new Map<string, CpuValue>(
    [...inputs.arrays].map(([id, v]) => [id, copy(v as unknown as CpuValue)]),
  );
  const results = new Map<string, CpuValue>();
  for (const g of groups) {
    if (g.calls.length > 1) {
      const built = fuseGroup(lows, calls, g.calls);
      if ('none' in built) throw new Error(`the group of ${g.calls.join(', ')}: ${built.none}`);
      const { fused, arrays } = built;
      const cpu = compileModule(
        opts.level === undefined ? fused.module : lowerWgsl(fused.module, opts.level),
        { precision: 'f32' },
      );
      const u = fusedUniform(c, lows, calls, g.calls, inputs, opts.fault);
      cpu.setBinding(fused.args.name, u.values as unknown as CpuValue);
      fused.slots.forEach((slot, i) =>
        cpu.setBinding(slot.name, store.get((arrays[i] as ChainArray).id)! as unknown as CpuValue),
      );
      if (u.n > 0) cpu.dispatch(fused.entry.fn, Math.ceil(u.n / fused.wg));
      for (const i of g.calls) {
        const low = lows[i]!;
        const r = tailOf(low.m, low.fn, low.plan, callArgs(c, i, inputs, store), []);
        if (r !== undefined) results.set(low.fn, r);
      }
      continue;
    }
    const i = g.calls[0]!;
    const low = lows[i]!;
    const args = callArgs(c, i, inputs, store);
    const run = runKernelPlan(low.m, low.fn, low.plan, args);
    let at = 0;
    for (const a of c.calls[i]!.args) if ('array' in a) store.set(a.array, run.arrays[at++]!);
    if (run.result !== undefined) results.set(low.fn, run.result);
  }
  return outcomeOf(c, store, results);
}
