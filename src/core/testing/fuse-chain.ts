// ═══ A generated chain of kernel calls, grouped by the fuse planner and run apart (change 0058) ═══
//
// `generateChain` (`random-ir.ts`) draws a chain: kernel functions in one module, and the calls to
// make over arrays the caller keeps. A chain may hold scratch arrays, intermediates the host never
// reads, and may reduce in one of its calls. This file turns one into what the fuse scope works on,
// and into what holds the scope to account, with no browser:
//
//   faces    `lowerFace`: the face of each kernel function with its fuse record, built from the IR
//            the way `fuseRecord` (`compiler/ts/host-face.ts`) builds it from a compiled source.
//            The generator writes IR and no source, so the face cannot come from `hostFace`.
//            `random-chain.test.ts` holds the two to each other on a source both can read.
//   planner  `groupCallsOf` feeds the planner (`core/fuse-group.ts`) the faces, the arrays and the
//            ranges the range functions give, as the scope's plan does. `planChain` adds the
//            scratch arrays of the scope, which the planner holds as locals where it may.
//   model    `modelGroups` gives the groups the facts F1 to F6 allow, from the chain as the
//            generator BUILT it, and the scratch arrays each fused group holds as locals. It reads
//            no fact the compiler wrote, so a fact the proof gets wrong, or a planner that reads
//            one wrong, makes the two disagree. `dispatchesOf` gives the dispatches those groups
//            make, the fold levels of a reduction among them.
//   apart    `runApart` runs the calls one after another on the oracle, in `f32` or `f64`. The
//            CPU tier never fuses, so this is what a fused plan must give (Rule 11.7). A scratch
//            array holds zeros when the plan starts, and the outcome leaves it out: the host never
//            reads it.
//   fused    `fuseGroup` builds the entry of a group, `fusedRun` gives the dispatches of that entry
//            (a reduction's loop, and then one fold for each level of partials), and `runGrouped`
//            runs a plan's groups on the oracle: a fused group as the entry the builder made, the
//            others as their own lowered plans. A group the planner refused can be run fused
//            anyway, a scratch array can be held as a local against the facts, and a fault can be
//            run on purpose, so that a comparison can be shown to see them.
//   built    `stencilChain` and `foldChain` are chains written as source, for what the generator
//            draws rarely (a stencil read of a scratch array that changes a value) or cannot
//            afford (a reduction over 65,537 iterations or more, which the f32 oracle takes
//            seconds to run).
//
// `scripts/gpu-differential.ts` runs the same groups on WebGPU. Test code only.

import { emitModule, lowerWgsl } from '../backends/wgsl.js';
import type { CpuValue } from '../cpu-runtime.js';
import { fusedFor, uniformFor, type Fused } from '../fuse-entry.js';
import { assignSlots, groupCalls, type Group, type GroupCall } from '../fuse-group.js';
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
import { f32T } from '../ir/index.js';
import { toPortable } from '../ir/portable.js';
import { KERNEL_TREE } from '../kernel-tree.js';
import { layoutOf, calleesOf, closureOf } from '../manifest.js';
import { compileModule } from '../oracle.js';
import { fnWrites } from '../passes/effects.js';
import { lowerKernel, type KernelPlan } from '../passes/kernel-lower.js';
import { proveKernels } from '../passes/parallel-loop.js';
import type { OptLevel } from '../passes/opt/optimize.js';
import { VERSION } from '../version.js';
import { compile } from '../../compiler/ts/compile.js';
import { authorTypeText } from '../../compiler/ts/context.js';
import { bareArrays, hostTypeOf } from '../../compiler/ts/host-face.js';
import { describeRead } from '../../compiler/ts/kernel-loops.js';
import {
  copy,
  runKernelPlan,
  scheduleKernelPlan,
  tailOf,
  type PlanFold,
  type PlanSchedule,
} from './kernel-plan.js';
import {
  mulberry32,
  type ChainAccess,
  type ChainArray,
  type ChainCall,
  type ChainCorpus,
} from './random-ir.js';

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
 * loops lower, as `random-chain.test.ts` holds: the parameters, what the WebGPU tier dispatches
 * (the partials of a loop that reduces among it), and the fuse record, which is the facts of each
 * loop in the author's words and the lowered module cut to what its entries reach, as portable IR.
 */
export function lowerFace(m: ModuleDecl, fn: string, origin: string): Lowered | { none: string } {
  const f = m.funcs.find((x) => x.name === fn);
  if (f === undefined) return { none: `no function "${fn}"` };
  const proof = proveKernels(m).find((p) => p.fn === fn);
  if (proof === undefined) return { none: 'it was not proved' };
  const plan = lowerKernel(f, m, proof);
  if ('noGpu' in plan) return { none: plan.noGpu };
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
  // The partials of a loop that reduces are bindings of the module, and no parameter's.
  const partNames = new Set(
    plan.loops.flatMap((l) => (l.reduce?.vars ?? []).map((v) => v.binding)),
  );
  const arrays = plan.module.bindings.filter(
    (b) => b.name !== plan.argsBinding && !partNames.has(b.name),
  );
  const loops: KernelLoop[] = [];
  for (const l of plan.loops) {
    const plain = {
      entry: l.entry,
      range: l.range,
      cop: l.cop,
      step: l.step,
      writes: l.writes,
      checks: l.checks,
      wg: l.wg,
    };
    if (l.reduce === undefined) {
      loops.push(plain);
      continue;
    }
    const vars: NonNullable<KernelLoop['reduce']>['vars'][number][] = [];
    for (const v of l.reduce.vars) {
      const b = plan.module.bindings.find((x) => x.name === v.binding)!;
      const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
      if ('none' in layout) return { none: layout.none };
      const t = v.type;
      vars.push({
        name: v.name,
        op: v.op,
        scalar: (t.kind === 'f64' || t.kind === 'vec64'
          ? 'f64'
          : t.kind === 'vec'
            ? t.elem
            : (t as { scalar: string }).scalar) as 'f32',
        n: t.kind === 'vec' || t.kind === 'vec64' ? t.n : 1,
        binding: {
          name: b.name,
          group: b.group,
          binding: b.binding,
          space: 'storage',
          writes: true,
          rw: true,
          layout,
          s: spell(b.type),
        },
      });
    }
    loops.push({ ...plain, reduce: { entry: l.reduce.entry, vars } });
  }
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
      ...(l.reduce !== undefined ? { fold: l.reduce.entry } : {}),
      wg: l.wg,
      arrays: reached,
      ...(bare.length > 0 ? { bare } : {}),
      reduces: l.reduce !== undefined,
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

/** The face of `low` as a compiler would write it if it took no loop for one that reduces: a wrong
 *  fact, to show that a comparison reports a planner fed one. The planner then lets a call join
 *  after the reduction, and does not count its partials in the buffers a dispatch binds. */
export function forgetsReduction(low: Lowered): Lowered {
  const fuse = low.face.fuse!;
  return {
    ...low,
    face: {
      ...low.face,
      fuse: {
        ...fuse,
        facts: fuse.facts.map(({ fold: _fold, ...f }) => ({ ...f, reduces: false })),
      },
    },
  };
}

/** The face of `low` as a compiler would write it if it never noticed that an iteration names the
 *  length of an array (`t.length`): a wrong fact, to show that a comparison reports a planner fed
 *  one. The planner then holds a scratch array as a local that the entry cannot measure. */
export function forgetsLength(low: Lowered): Lowered {
  const fuse = low.face.fuse!;
  return {
    ...low,
    face: {
      ...low.face,
      fuse: { ...fuse, facts: fuse.facts.map(({ bare: _bare, ...f }) => f) },
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
 *  reads. A scratch array starts with zeros, as the scope makes it, and so reads where no call
 *  wrote. `variant` tells apart the runs of one chain; half the draws are at the boundaries. */
export function inputsOf(c: ChainCorpus, s: Sizes, variant: number, scalarOf: ScalarOf): Inputs {
  const rnd = mulberry32(c.seed * 7919 + s.n * 31 + s.m * 5 + variant);
  const boundary = variant % 2 === 1;
  const arrays = new Map<string, readonly CpuValue[]>();
  for (const a of c.arrays)
    arrays.set(
      a.id,
      Array.from({ length: lengthOf(a, s) }, () =>
        a.scratch ? (0 as CpuValue) : valueOf(a.elem, c, rnd, boundary, scalarOf),
      ),
    );
  const scalars = c.calls.map((call) =>
    call.args.flatMap((a) =>
      'scalar' in a ? [valueOf(a.scalar, c, rnd, boundary, scalarOf)] : [],
    ),
  );
  return { arrays, scalars };
}

/** `inputs` with the scratch arrays of `c` holding values in the place of zeros, drawn with
 *  `scalarOf`: what a plan that does not zero a scratch buffer would start from. */
export function withScratchContents(
  c: ChainCorpus,
  inputs: Inputs,
  variant: number,
  scalarOf: ScalarOf,
): Inputs {
  const rnd = mulberry32(c.seed * 104729 + variant);
  const arrays = new Map(inputs.arrays);
  for (const a of c.arrays)
    if (a.scratch)
      arrays.set(
        a.id,
        Array.from({ length: inputs.arrays.get(a.id)!.length }, () =>
          valueOf(a.elem, c, rnd, false, scalarOf),
        ),
      );
  return { arrays, scalars: inputs.scalars };
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

/** What a chain left: every array a call writes that the host reads, by id, and every result a call
 *  returns, by the call's function. A scratch array is not among them: the host never reads it. */
export interface Outcome {
  readonly arrays: Readonly<Record<string, CpuValue>>;
  readonly results: Readonly<Record<string, CpuValue>>;
}

/** The final contents of the arrays a call writes and the host reads, and the results, from the
 *  store a run left. */
function outcomeOf(
  c: ChainCorpus,
  store: ReadonlyMap<string, CpuValue>,
  results: Map<string, CpuValue>,
): Outcome {
  return {
    arrays: Object.fromEntries(
      c.arrays.filter((a) => a.written && !a.scratch).map((a) => [a.id, store.get(a.id)!]),
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

/** The groups the planner makes of `calls` (from {@link groupCallsOf}) with the scratch arrays of
 *  the scope, which a fused group holds as locals where Rule 11.13 allows. */
export function planChain(c: ChainCorpus, calls: readonly GroupCall[], limit: number): Group[] {
  return groupCalls(calls, limit, new Set(c.arrays.filter((a) => a.scratch)));
}

/** Why the planner keeps a call out of the group before it: the fact that fails, in the order the
 *  planner checks them. */
export type Reason =
  | 'continues'
  | 'empty'
  | 'reduces'
  | 'trips'
  | 'start'
  | 'step'
  | 'waw'
  | 'war'
  | 'read'
  | 'write'
  | 'limit';

/** A group the model expects, as indices into the chain's calls. */
export interface ModelGroup {
  readonly calls: readonly number[];
  /** Why the group stands apart from the one before it; absent for the first group. */
  readonly because?: Reason;
  /** The scratch arrays, by id, that the entry of the group holds as locals: none for a group of
   *  one call, which runs as it runs outside a scope. */
  readonly contracted: readonly string[];
}

/** How a call reaches one array, from the chain as it was built. */
interface Reach {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly atI: boolean;
  /** The iteration names the array's length. */
  readonly measures: boolean;
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
      measures: a.measures,
    });
  return out;
}

/**
 * The groups the facts F1 to F6 give for chain `c` at sizes `s`, on a device that binds `limit`
 * storage buffers to a dispatch, and the scratch arrays each group holds as locals. It restates
 * the rules of `core/fuse-group.ts` over what the generator recorded, and reads no fact of any
 * face.
 *
 * A scratch array is a local of a fused group when every call of the chain that names it is in
 * the group, exactly one of them writes it, every access of it is at exactly `i`, and none names
 * its length (Rule 11.13). F5 counts the array as a buffer until the last call that names it has
 * joined, and counts one partials binding for each variable a call that reduces folds.
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
  const scratch = c.arrays.filter((a) => a.scratch).map((a) => a.id);
  const held = (members: readonly number[]): Set<string> => {
    const out = new Set<string>();
    for (const id of scratch) {
      const users = info.flatMap((m, i) => (m.by.has(id) ? [i] : []));
      if (users.length === 0 || !users.every((i) => members.includes(i))) continue;
      const seen = users.map((i) => info[i]!.by.get(id)!);
      if (seen.filter((r) => r.writes).length === 1 && seen.every((r) => r.atI && !r.measures))
        out.add(id);
    }
    return out;
  };
  const groups: { calls: number[]; because?: Reason }[] = [];
  const refusal = (members: readonly number[], next: number): Reason | undefined => {
    const n = info[next]!;
    const last = info[members[members.length - 1]!]!;
    if (n.apart !== undefined) return n.apart;
    if (last.apart !== undefined) return last.apart;
    // F6: a call that reduces is the last of its group.
    if (last.call.reduces > 0) return 'reduces';
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
    for (const id of held([...members, next])) bound.delete(id);
    return bound.size + n.call.reduces > limit ? 'limit' : undefined;
  };
  info.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const no = last === undefined ? undefined : refusal(last.calls, i);
    if (last !== undefined && no === undefined) last.calls.push(i);
    else groups.push({ calls: [i], ...(no !== undefined ? { because: no } : {}) });
  });
  return groups.map((g) => ({
    ...g,
    contracted: g.calls.length > 1 ? [...held(g.calls)] : [],
  }));
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
  if (/^\S+ reduces$/.test(t)) return 'reduces';
  return undefined;
}

/** The groups as lists of call indices, for a comparison. */
export const shapeOf = (gs: readonly { readonly calls: readonly number[] }[]): number[][] =>
  gs.map((g) => [...g.calls]);

/** How many dispatches reduce a loop of `trips` iterations to one value after its own: a loop
 *  makes one partial for each 256 iterations (Rule 7.2), and a dispatch folds 256 partials into
 *  one, until one is left. */
export function foldLevels(trips: number): number {
  let levels = 0;
  for (let partials = Math.ceil(trips / KERNEL_TREE); partials > 1; levels++)
    partials = Math.ceil(partials / KERNEL_TREE);
  return levels;
}

/** The dispatches the groups of `model` make at sizes `s`: one for each group that runs an
 *  iteration, and one for each level of partials of a group that ends in a call that reduces. */
export function dispatchesOf(c: ChainCorpus, s: Sizes, model: readonly ModelGroup[]): number {
  let n = 0;
  for (const g of model) {
    const trips = tripsOf(c.calls[g.calls[0]!]!, s);
    if (trips === 0) continue;
    n += 1 + (c.calls[g.calls[g.calls.length - 1]!]!.reduces > 0 ? foldLevels(trips) : 0);
  }
  return n;
}

/** What becomes of a scratch array by the facts: a local of one fused group, or a buffer, and for
 *  a buffer the first clause of Rule 11.13 that keeps it one. `outside`: a call that is not in
 *  one fused group with the others names it. `writers`: not exactly one call writes it. `offset`:
 *  an access of it is not at `i`. `measured`: a call names its length. */
export type Fate = 'local' | 'outside' | 'writers' | 'offset' | 'measured';

/** The fate of each scratch array of `c` under `groups`, the groups the facts give. */
export function scratchFates(c: ChainCorpus, groups: readonly ModelGroup[]): Map<string, Fate> {
  const fates = new Map<string, Fate>();
  for (const a of c.arrays) {
    if (!a.scratch) continue;
    const users = c.calls.flatMap((call, j) =>
      call.access.some((x) => x.array === a.id) ? [j] : [],
    );
    const seen = users.map((j) => reaches(c.calls[j]!).get(a.id)!);
    const home = groups.find((g) => users.every((j) => g.calls.includes(j)));
    fates.set(
      a.id,
      home?.contracted.includes(a.id) === true
        ? 'local'
        : home === undefined || home.calls.length < 2
          ? 'outside'
          : seen.filter((r) => r.writes).length !== 1
            ? 'writers'
            : seen.some((r) => !r.atI)
              ? 'offset'
              : 'measured',
    );
  }
  return fates;
}

// ─── fused ───────────────────────────────────────────────────────────────────────────────────

/** A group of a plan to run: the calls, and the scratch arrays (the `ChainArray` objects) its entry
 *  holds as locals. A planner's {@link Group} is one. */
export interface PlannedGroup {
  readonly calls: readonly number[];
  readonly contracted?: readonly object[];
}

/** The entry of the calls `idx` of a chain as one group, with `contracted` held as locals, and the
 *  array each of its slots binds. The planner is not asked: a group it refused can be built too. */
export function fuseGroup(
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
  contracted: readonly object[] = [],
): { fused: Fused; arrays: readonly object[] } | { none: string } {
  const { slots, arrays } = assignSlots(idx.map((i) => calls[i]!));
  const fused = fusedFor(
    idx.map((i, m) => ({ k: lows[i]!.face, slots: slots[m]! })),
    arrays.flatMap((a, at) => (contracted.includes(a) ? [at] : [])),
  );
  return 'none' in fused ? fused : { fused, arrays };
}

/** A fault to run on purpose: the first iteration of every fused group skipped, so that its entry
 *  is dispatched for one iteration fewer, starting one step later; the last level of partials of a
 *  fused group that reduces not folded; its partials zeroed after the loop's dispatch and before
 *  the first fold; or each scratch local of a fused entry starting at one, not zero. */
export type GroupFault =
  'skip-first-iteration' | 'drop-last-level' | 'zero-partials' | 'local-starts-at-one';

/**
 * The WGSL of a fused entry with each scratch local it holds started at one, not zero (the fault
 * `local-starts-at-one`). The entry declares a scratch local as `var _fs<at>: f32;` (Rule 11.13:
 * a `var` starts at zero), and the fault gives each one an initial value. `locals` is how many the
 * group holds, and a different count of declarations is an error.
 */
export function localsStartingAtOne(wgsl: string, locals: number): string {
  let n = 0;
  const out = wgsl.replace(/var (_fs\d+): f32;/g, (_, name: string) => {
    n += 1;
    return `var ${name}: f32 = 1.0;`;
  });
  if (n !== locals)
    throw new Error(`the entry declares ${n} scratch locals, and the group holds ${locals}`);
  return out;
}

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

/** One step of the dispatch of a fused group: a dispatch of an entry of its module with the values
 *  of its uniform, or the partials of the reduction zeroed (the fault `zero-partials`). */
export type GroupStep =
  | {
      readonly entry: string;
      readonly wg: readonly [number, number, number];
      readonly values: Record<string, unknown>;
    }
  | { readonly clear: readonly string[] };

/** What a fused group dispatches, in order, and for a group that ends in a call that reduces the
 *  partials it folds into and where the folded values are once the steps have run. */
export interface FusedRun {
  readonly steps: readonly GroupStep[];
  readonly partials: PlanSchedule['partials'];
  readonly folds: readonly PlanFold[];
}

/**
 * The dispatches of the fused group `idx` of chain `c`, built as `fused`. A group of maps is one
 * dispatch. A group that ends in a call that reduces is that call's reduction as the runtime runs
 * it: the loop's dispatch, and then one dispatch of the fold entry for each level of partials,
 * with the uniform's `_n`, `_in` and `_out` of the last call (`c<m>__n`, `c<m>__in`, `c<m>__out`)
 * set for the level. The dispatches are the same whatever submits them, one at a time or together.
 * With a fault, the group is dispatched wrong on purpose.
 */
export function fusedRun(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  idx: readonly number[],
  inputs: Inputs,
  fused: Fused,
  fault?: GroupFault,
): FusedRun {
  const u = fusedUniform(c, lows, calls, idx, inputs, fault);
  const reduce = fused.reduce;
  if (reduce === undefined)
    return {
      steps:
        u.n > 0
          ? [{ entry: fused.entry.fn, wg: [Math.ceil(u.n / fused.wg), 1, 1], values: u.values }]
          : [],
      partials: [],
      folds: [],
    };
  const last = idx[idx.length - 1]!;
  const low = lows[last]!;
  const schedule = scheduleKernelPlan(
    low.m,
    low.fn,
    low.plan,
    callArgs(c, last, inputs),
    fault === 'skip-first-iteration' ? fault : undefined,
  );
  const loop = low.plan.loops[0]!.entry;
  let steps: GroupStep[] = schedule.steps.map((st) => ({
    entry: st.entry === loop ? fused.entry.fn : reduce.fold.fn,
    wg: st.workgroups,
    values: {
      ...u.values,
      [reduce.fields.n]: st.args['_n'],
      [reduce.fields.in]: st.args['_in'],
      [reduce.fields.out]: st.args['_out'],
    },
  }));
  if (fault === 'drop-last-level' && steps.length > 1) steps = steps.slice(0, -1);
  if (fault === 'zero-partials' && steps.length > 1)
    steps = [steps[0]!, { clear: schedule.partials.map((p) => p.binding) }, ...steps.slice(1)];
  return { steps, partials: schedule.partials, folds: schedule.folds };
}

/**
 * The dispatches the plan `groups` of chain `c` makes: the steps of a fused group (`fusedRun`), and
 * for every other call the steps of its own lowered plan (`scheduleKernelPlan`), a loop that
 * reduces with one step for each level of partials. `dispatchesOf` gives the same count from the
 * facts alone, which a test holds to this one.
 */
export function plannedDispatches(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  groups: readonly PlannedGroup[],
  inputs: Inputs,
): number {
  let n = 0;
  for (const g of groups) {
    if (g.calls.length > 1) {
      const built = fuseGroup(lows, calls, g.calls, g.contracted);
      if ('none' in built) throw new Error(`the group of ${g.calls.join(', ')}: ${built.none}`);
      n += fusedRun(c, lows, calls, g.calls, inputs, built.fused).steps.length;
      continue;
    }
    const i = g.calls[0]!;
    const low = lows[i]!;
    n += scheduleKernelPlan(low.m, low.fn, low.plan, callArgs(c, i, inputs)).steps.length;
  }
  return n;
}

/** The zero of one element of a partials array. */
const zeroOf = (t: ShaderType): CpuValue =>
  (t.kind === 'vec' ? new Array<number>(t.n).fill(0) : 0) as CpuValue;

/**
 * The plan `groups` of chain `c` on the oracle at `f32`: a group of more than one call as the
 * fused entry the builder made, run as its dispatches (at `level`, the passes the writer runs
 * first), and every other call as its own lowered plan. A scratch array that a group holds as a
 * local (`contracted`) has no store entry, so a call that runs apart and names it is an error. The
 * results are the CPU tail's, as the runtime gives them, over what the folds of a reduction left.
 * With a fault, every fused group is run wrong on purpose.
 */
export function runGrouped(
  c: ChainCorpus,
  lows: readonly Lowered[],
  calls: readonly GroupCall[],
  groups: readonly PlannedGroup[],
  inputs: Inputs,
  opts: { level?: OptLevel; fault?: GroupFault } = {},
): Outcome {
  const locals = new Set(
    groups.flatMap((g) => (g.contracted ?? []).map((a) => (a as ChainArray).id)),
  );
  const store = new Map<string, CpuValue>(
    [...inputs.arrays]
      .filter(([id]) => !locals.has(id))
      .map(([id, v]) => [id, copy(v as unknown as CpuValue)]),
  );
  const results = new Map<string, CpuValue>();
  for (const g of groups) {
    if (g.calls.length > 1) {
      const built = fuseGroup(lows, calls, g.calls, g.contracted);
      if ('none' in built) throw new Error(`the group of ${g.calls.join(', ')}: ${built.none}`);
      const { fused, arrays } = built;
      const cpu = compileModule(
        opts.level === undefined ? fused.module : lowerWgsl(fused.module, opts.level),
        { precision: 'f32' },
      );
      // An array the entry holds as a local has no slot, so nothing is bound to it.
      fused.slots.forEach((slot) =>
        cpu.setBinding(
          slot.name,
          store.get((arrays[slot.array] as ChainArray).id)! as unknown as CpuValue,
        ),
      );
      const run = fusedRun(c, lows, calls, g.calls, inputs, fused, opts.fault);
      const parts = new Map<string, CpuValue[]>();
      for (const p of run.partials) {
        const part = Array.from({ length: p.slots }, () => zeroOf(p.type));
        parts.set(p.binding, part);
        cpu.setBinding(p.binding, part as unknown as CpuValue);
      }
      for (const st of run.steps) {
        if ('clear' in st) {
          for (const name of st.clear) {
            const part = parts.get(name)!;
            const type = run.partials.find((p) => p.binding === name)!.type;
            for (let k = 0; k < part.length; k++) part[k] = zeroOf(type);
          }
          continue;
        }
        cpu.setBinding(fused.args.name, st.values as unknown as CpuValue);
        cpu.dispatch(st.entry, st.wg as [number, number, number]);
      }
      const folded = run.folds.map((f) =>
        'identity' in f ? f.identity : copy(parts.get(f.binding)![f.at]!),
      );
      g.calls.forEach((i, m) => {
        const low = lows[i]!;
        const r = tailOf(
          low.m,
          low.fn,
          low.plan,
          callArgs(c, i, inputs, store),
          m === g.calls.length - 1 ? folded : [],
        );
        if (r !== undefined) results.set(low.fn, r);
      });
      continue;
    }
    const i = g.calls[0]!;
    const low = lows[i]!;
    for (const a of c.calls[i]!.args)
      if ('array' in a && locals.has(a.array))
        throw new Error(`${low.fn} names ${a.array}, which a group holds as a local`);
    const args = callArgs(c, i, inputs, store);
    const run = runKernelPlan(low.m, low.fn, low.plan, args);
    let at = 0;
    for (const a of c.calls[i]!.args) if ('array' in a) store.set(a.array, run.arrays[at++]!);
    if (run.result !== undefined) results.set(low.fn, run.result);
  }
  return outcomeOf(c, store, results);
}

/** Where a chain has a scratch array that a stencil keeps in storage: the groups `at - 1` and `at`
 *  stand apart because the call `q` that opens group `at` reads `array` at another index (F3), the
 *  call `p` that is alone in group `at - 1` wrote it at `i`, and only `p` and `q` name it. */
export interface Stencil {
  readonly at: number;
  readonly array: ChainArray;
}

/** The first {@link Stencil} of chain `c`, by the groups the facts give. */
export function scratchStencil(c: ChainCorpus, model: readonly ModelGroup[]): Stencil | undefined {
  for (let at = 1; at < model.length; at++) {
    if (model[at]!.because !== 'read' || model[at - 1]!.calls.length !== 1) continue;
    const [p, q] = [model[at - 1]!.calls[0]!, model[at]!.calls[0]!];
    const array = c.arrays.find((a) => {
      if (!a.scratch) return false;
      const users = c.calls.flatMap((call, j) =>
        call.access.some((x) => x.array === a.id) ? [j] : [],
      );
      const by = (j: number): ChainAccess => c.calls[j]!.access.find((x) => x.array === a.id)!;
      return (
        users.length === 2 &&
        users.every((j) => j === p || j === q) &&
        by(p).writes === 'i' &&
        by(q).reads === 'shifted' &&
        !by(p).measures &&
        !by(q).measures
      );
    });
    if (array !== undefined) return { at, array };
  }
  return undefined;
}

/**
 * The plan `groups` with the pair of `stencil` run as one group that holds the scratch array as a
 * local, against the facts: the entry reads the element `p` wrote in the place of the one `q` asks
 * for. The calls of `q`'s group after `q` run apart. Every other group is the planner's.
 */
export function contractAgainstFacts(
  groups: readonly PlannedGroup[],
  stencil: Stencil,
): PlannedGroup[] {
  const { at, array } = stencil;
  return [
    ...groups.slice(0, at - 1),
    { calls: [groups[at - 1]!.calls[0]!, groups[at]!.calls[0]!], contracted: [array] },
    ...groups[at]!.calls.slice(1).map((j) => ({ calls: [j] })),
    ...groups.slice(at + 1),
  ];
}

/** The access of one array parameter, for a chain built from source. */
const accessOf = (
  param: string,
  array: string,
  reads: ChainAccess['reads'],
  writes: ChainAccess['writes'],
): ChainAccess => ({ param, array, reads, writes, conditional: false, measures: false });

/** An array of `n` elements of a chain built from source. */
const arrayOfN = (id: string, o: { written: boolean; scratch: boolean }): ChainArray => ({
  id,
  elem: f32T,
  length: { of: 'n', times: 1 },
  ...o,
});

/**
 * A chain of two calls built from source, for an instrument that needs the shape of {@link Stencil}
 * and a value that depends on it, which the generator rarely draws together. `produce` writes the
 * scratch array `t` at `i`, and `stencil` reads it at `i` and at `i ^ 1`, an element another
 * invocation writes (F3). The planner keeps the two calls apart. A plan that holds `t` as a local
 * against the facts gives `stencil` the element `produce` wrote for `i` in the place of the pair's,
 * and `out` differs wherever the two hold other values. The pair is in range for an even length.
 */
export function stencilChain(): ChainCorpus {
  const source = `"use typeshade";
export function produce(t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < t.length; i++) {
    t[i] = a[i] * 2. + 1.;
  }
}
export function stencil(out: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + t[i ^ 1];
  }
}
`;
  const r = compile(source, { fileName: '/app/stencil.shade.ts' });
  return {
    module: r.module,
    seed: 0,
    features: {},
    arrays: [
      arrayOfN('x0', { written: true, scratch: true }),
      arrayOfN('x1', { written: false, scratch: false }),
      arrayOfN('x2', { written: true, scratch: false }),
    ],
    calls: [
      {
        fn: 'produce',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x0' }, { array: 'x1' }],
        access: [accessOf('t', 'x0', 'none', 'i'), accessOf('a', 'x1', 'i', 'none')],
        continues: false,
        reduces: 0,
      },
      {
        fn: 'stencil',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x2' }, { array: 'x0' }],
        access: [accessOf('out', 'x2', 'none', 'i'), accessOf('t', 'x0', 'shifted', 'none')],
        continues: false,
        reduces: 0,
      },
    ],
  };
}

/**
 * A chain that reduces over more iterations than one level of partials folds, built from source:
 * the generator cannot afford the size, since the f32 oracle takes seconds to run a generated body
 * over 65,537 iterations or more. `total` folds two variables, a sum and a maximum. With `fused`,
 * `scale` writes the scratch array `t` before it, and the planner fuses the two with `t` a local;
 * otherwise `total` is the only call and stands alone. At 70,000 iterations the loop makes 274
 * partials, a fold makes 2 of them and a second fold makes 1 (Rule 7.2), and the second reads
 * what the first wrote from the place `_out` says. The seeds are negative: they are not drawn.
 */
export function foldChain(fused: boolean): ChainCorpus {
  const source = `"use typeshade";
export function scale(t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < t.length; i++) {
    t[i] = a[i] * 2. + 1.;
  }
}
export function total(t: array<f32>): f32 {
  let s: f32 = 0.;
  let hi: f32 = -1000.;
  for (let i: u32 = 0; i < t.length; i++) {
    s += t[i];
    hi = max(hi, t[i]);
  }
  return s + hi;
}
`;
  const r = compile(source, { fileName: '/app/fold.shade.ts' });
  return fused
    ? {
        module: r.module,
        seed: -1,
        features: {},
        arrays: [
          arrayOfN('x0', { written: true, scratch: true }),
          arrayOfN('x1', { written: false, scratch: false }),
        ],
        calls: [
          {
            fn: 'scale',
            over: 'n',
            start: 0,
            step: 1,
            args: [{ array: 'x0' }, { array: 'x1' }],
            access: [accessOf('t', 'x0', 'none', 'i'), accessOf('a', 'x1', 'i', 'none')],
            continues: false,
            reduces: 0,
          },
          {
            fn: 'total',
            over: 'n',
            start: 0,
            step: 1,
            args: [{ array: 'x0' }],
            access: [accessOf('t', 'x0', 'i', 'none')],
            continues: false,
            reduces: 2,
          },
        ],
      }
    : {
        module: r.module,
        seed: -2,
        features: {},
        arrays: [arrayOfN('x0', { written: false, scratch: false })],
        calls: [
          {
            fn: 'total',
            over: 'n',
            start: 0,
            step: 1,
            args: [{ array: 'x0' }],
            access: [accessOf('t', 'x0', 'i', 'none')],
            continues: false,
            reduces: 2,
          },
        ],
      };
}

/**
 * A chain of five calls built from source, for the instrument of the storage-buffer limit: four
 * maps over distinct arrays, and a sum over the output of the last of them. The four maps bind
 * eight arrays, which is exactly the limit of eight storage buffers, so the group of the four
 * fits without the partials. The sum binds no array the four do not, but its loop folds one
 * variable, so one partials binding joins the eight: nine, past the limit (F5). The facts give
 * two groups, `[0..3]` and `[4]`; a planner that does not count the partials fuses all five.
 */
export function limitChain(): ChainCorpus {
  const source = `"use typeshade";
export function scaleA(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 2. + 1.;
  }
}
export function scaleB(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 3. + 2.;
  }
}
export function scaleC(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 4. + 3.;
  }
}
export function scaleD(o: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = a[i] * 5. + 4.;
  }
}
export function sum(t: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < t.length; i++) {
    s += t[i];
  }
  return s;
}
`;
  const r = compile(source, { fileName: '/app/limit.shade.ts' });
  const map = (fn: string, o: string, a: string): ChainCorpus['calls'][number] => ({
    fn,
    over: 'n',
    start: 0,
    step: 1,
    args: [{ array: o }, { array: a }],
    access: [accessOf('o', o, 'none', 'i'), accessOf('a', a, 'i', 'none')],
    continues: false,
    reduces: 0,
  });
  return {
    module: r.module,
    seed: -3,
    features: {},
    arrays: [
      arrayOfN('x0', { written: true, scratch: false }),
      arrayOfN('x1', { written: false, scratch: false }),
      arrayOfN('x2', { written: true, scratch: false }),
      arrayOfN('x3', { written: false, scratch: false }),
      arrayOfN('x4', { written: true, scratch: false }),
      arrayOfN('x5', { written: false, scratch: false }),
      arrayOfN('x6', { written: true, scratch: false }),
      arrayOfN('x7', { written: false, scratch: false }),
    ],
    calls: [
      map('scaleA', 'x0', 'x1'),
      map('scaleB', 'x2', 'x3'),
      map('scaleC', 'x4', 'x5'),
      map('scaleD', 'x6', 'x7'),
      {
        fn: 'sum',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x6' }],
        access: [accessOf('t', 'x6', 'i', 'none')],
        continues: false,
        reduces: 1,
      },
    ],
  };
}

/**
 * A chain of two calls built from source, for the instrument of a scratch array that a fused
 * entry holds as a local and starts at zero. `accumulate` adds into the scratch array `t` at `i`,
 * so `t[i] += a[i]` reads the value `t` started with before it writes; it is the only writer of
 * `t`. `spread` reads `t` at `i` and writes `out` at `i`. The planner fuses the two with `t` a
 * local (Rule 11.13), and the initial value of `t` reaches `out` wherever `accumulate` adds to it.
 */
export function localChain(): ChainCorpus {
  const source = `"use typeshade";
export function accumulate(t: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < t.length; i++) {
    t[i] += a[i];
  }
}
export function spread(o: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < o.length; i++) {
    o[i] = t[i] * 2.;
  }
}
`;
  const r = compile(source, { fileName: '/app/accumulate.shade.ts' });
  return {
    module: r.module,
    seed: -4,
    features: {},
    arrays: [
      arrayOfN('x0', { written: true, scratch: true }),
      arrayOfN('x1', { written: false, scratch: false }),
      arrayOfN('x2', { written: true, scratch: false }),
    ],
    calls: [
      {
        fn: 'accumulate',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x0' }, { array: 'x1' }],
        access: [accessOf('t', 'x0', 'i', 'i'), accessOf('a', 'x1', 'i', 'none')],
        continues: false,
        reduces: 0,
      },
      {
        fn: 'spread',
        over: 'n',
        start: 0,
        step: 1,
        args: [{ array: 'x2' }, { array: 'x0' }],
        access: [accessOf('o', 'x2', 'none', 'i'), accessOf('t', 'x0', 'i', 'none')],
        continues: false,
        reduces: 0,
      },
    ],
  };
}
