// ═══ A lowered kernel function's plan, run on the CPU oracle (#349) ═══
//
// `lowerKernel` (`passes/kernel-lower.ts`) turns a kernel function whose loops the proof accepts
// into what its call dispatches: a `@compute` entry per loop, a fold entry per loop that reduces,
// the range functions the call runs first and the tail that gives the result. `callKernel`
// (`host-kernel.ts`) runs that plan on WebGPU. This runs the same plan on the f32 oracle: the
// range functions and the tail on the function's own module, each entry through
// `CpuModule.dispatch`, and the partials folded level by level. The kernel function run on the
// oracle is the reference. Rule 7.2 folds a reduction in one tree on every tier, so the two
// agree bit for bit in f32, and a difference is a lowering that changed what the function
// computes (#361 was one).
//
// `scheduleKernelPlan` is the dispatch alone: every step in order, with its workgroups and the
// values of the plan's uniform, the partials each reduction folds into, and where its folded value
// ends up. The loops write no scalar a range reads (Rule 8.22), so the whole schedule is known
// before anything runs, but for a loop whose range the device holds (change 0094): its range
// entry runs first, and its entry's workgroups are read from the trip buffer the range entry
// wrote, when the step runs. A push or a reduction over such a range has its scratch sized for the
// cap its CPU-tier function gives, its count and store steps or its fold levels read their
// workgroups from the trip buffer too, and a push's length after the loop is read from there. `runKernelPlan` runs it on the oracle, and the GPU differential
// (`scripts/gpu-differential.ts`) runs the same schedule on WebGPU.
//
// It follows `callKernel`'s WebGPU tier step for step: the trip count, the grid that spills past
// 65535 workgroups into y, the levels of partials, and the identity a loop that runs no iteration
// folds to. It is a second copy of that sequence, because `callKernel` needs a device. The import
// journey runs `callKernel` itself on WebGPU. Test code only.

import type { CpuValue } from '../cpu-runtime.js';
import { pushedLength, startPushesAt } from '../push-count.js';
import type { ModuleDecl, ShaderType } from '../ir/index.js';
import { u32T } from '../ir/types.js';
import { compileModule } from '../oracle.js';
import { TRIP_PUSHED, TRIP_WORDS, tripWordsOf, type KernelPlan } from '../passes/kernel-lower.js';
import { KERNEL_TREE, treeIdentity } from '../kernel-tree.js';

/** What a call of a kernel function did: its result, and each array argument after it, and with
 *  held lengths (change 0094) the new length of each pushed array, by parameter. */
export interface KernelRun {
  readonly result: CpuValue | undefined;
  readonly arrays: readonly CpuValue[];
  readonly lengths?: Readonly<Record<string, number>>;
}

/** The held length a call passes for each pushed array it names (change 0094): the words of its
 *  `Resident<Uint32Array>`, and the element the length is at. */
export type HeldLengths = Readonly<
  Record<string, { readonly words: readonly number[]; readonly offset: number }>
>;

/** A step of the dispatch to run wrong on purpose, so a comparison can be shown to notice it. */
export type PlanFault =
  'skip-first-iteration' | 'drop-last-partial' | 'device-trip-one-less' | 'device-fold-one-less';

/** One dispatch: the entry, its workgroups, and the values of the plan's uniform. With
 *  `indirect` (change 0094), the workgroups are the three words of the trip buffer from that
 *  element, as they are when the step runs, and `workgroups` is not read. */
export interface PlanStep {
  readonly entry: string;
  readonly workgroups: readonly [number, number, number];
  readonly args: Readonly<Record<string, CpuValue>>;
  readonly indirect?: number;
  /** The element of the trip buffer a range entry writes from (change 0094). */
  readonly range?: number;
}

/** Where a reduced variable's folded value is once the steps have run: a slot of its partials'
 *  binding, or, for a loop that ran no iteration, the operator's identity; for a loop that pushes
 *  over a range the device holds (change 0094, stage 4), the word of the trip buffer its scan
 *  writes the length after the loop into. */
export type PlanFold =
  | { readonly binding: string; readonly at: number }
  | { readonly identity: CpuValue }
  | { readonly trip: number };

/** What a call dispatches for one set of arguments. */
export interface PlanSchedule {
  readonly steps: readonly PlanStep[];
  /** Each reduction's partials: its binding, its type, and how many slots it holds. */
  readonly partials: readonly {
    readonly binding: string;
    readonly type: ShaderType;
    readonly slots: number;
  }[];
  /** Each reduced variable, in loop order. */
  readonly folds: readonly PlanFold[];
  /** Each length word's binding (change 0094) and what it holds before the steps: the held
   *  length's words, or one zero for an array whose pushes start at 0. */
  readonly words: readonly {
    readonly binding: string;
    readonly param: string;
    readonly offset: number;
    readonly words: readonly number[];
  }[];
  /** The trip buffer of a range the device holds (change 0094): its two bindings, which are one
   *  buffer, and how many `u32`s it holds, zeros before the steps. */
  readonly trips?: { readonly write: string; readonly read: string; readonly words: number };
}

/** The dispatch of kernel function `fn` of `m` through `plan` for `args`, its parameters in order,
 *  an array as a JavaScript array of its elements. */
export function scheduleKernelPlan(
  m: ModuleDecl,
  fn: string,
  plan: KernelPlan,
  args: readonly CpuValue[],
  fault?: PlanFault,
  held: HeldLengths = {},
): PlanSchedule {
  const f = functionOf(m, fn);
  const host = compileModule({ ...m, funcs: [...m.funcs, ...plan.ranges] }, { precision: 'f32' });
  const lengths = lengthsOf(f.params, args);
  const scalars: Record<string, CpuValue> = {};
  f.params.forEach((p, i) => {
    if (p.type.kind !== 'array') scalars[p.name] = args[i]!;
  });
  const steps: PlanStep[] = [];
  const partials: PlanSchedule['partials'][number][] = [];
  const folds: PlanFold[] = [];
  // Where the entry that stores after the loops reads what each loop folded (change 0094):
  // `0xffffffff` for a loop that ran no iteration, which the entry combines as the identity.
  const ats: Record<string, CpuValue> = {};
  if (plan.finish !== undefined)
    plan.loops.forEach((l, j) => {
      if (l.reduce !== undefined) ats[`_at${String(j)}`] = NO_FOLD;
    });
  // The length words (change 0094): a held length's words at its element, or a zero of the
  // call's own, and where each is in the uniform.
  const words = (plan.words ?? []).map((w) => {
    const h = held[w.param];
    ats[w.field] = h?.offset ?? 0;
    return {
      binding: w.binding,
      param: w.param,
      offset: h?.offset ?? 0,
      words: h !== undefined ? [...h.words] : [0],
    };
  });
  for (const [j, loop] of plan.loops.entries()) {
    if (loop.device !== undefined) {
      // A range the device holds: the range entry, then the loop from the counts it wrote.
      const args = { ...scalars, _start: 0, _n: 0, _in: 0, _out: 0, ...ats };
      const at = loop.device.at;
      steps.push({ entry: loop.device.entry, workgroups: [1, 1, 1], args, range: at });
      // A loop that pushes or reduces over one (stage 4): its scratch sized for the cap of its
      // bound, `min(d, c)`, which the host computes, and every step from the counts.
      const capped =
        loop.device.cap === undefined
          ? undefined
          : (host.fns[loop.device.cap]!(...lengths) as unknown as readonly number[]);
      const cap = capped === undefined ? 0 : trips(loop.cop, loop.step, capped[0]!, capped[1]!);
      if (loop.push !== undefined) {
        steps.push({ entry: loop.push.count, workgroups: [1, 1, 1], args, indirect: at + 2 });
        steps.push({ entry: loop.push.scan, workgroups: [1, 1, 1], args });
        steps.push({ entry: loop.entry, workgroups: [1, 1, 1], args, indirect: at + 2 });
        partials.push({ binding: loop.push.binding, type: u32T, slots: cap + 1 });
        folds.push({ trip: at + TRIP_PUSHED });
        continue;
      }
      steps.push({ entry: loop.entry, workgroups: [1, 1, 1], args, indirect: at + 2 });
      const vars = loop.reduce?.vars ?? [];
      if (vars.length === 0) continue;
      const layout = levelsOf(cap, loop.wg);
      let from = 0;
      let out = layout.first;
      layout.levels.forEach((level, k) => {
        const word = at + TRIP_WORDS + 4 * k;
        steps.push({
          entry: loop.reduce!.entry,
          workgroups: [1, 1, 1],
          args: { ...args, _n: word, _in: from, _out: out },
          indirect: word + 1,
        });
        from = out;
        out += level;
      });
      for (const v of vars) {
        partials.push({ binding: v.binding, type: v.type, slots: out });
        folds.push({ binding: v.binding, at: from });
      }
      if (plan.finish !== undefined) ats[`_at${String(j)}`] = from;
      continue;
    }
    const range = host.fns[loop.range]!(...lengths) as unknown as readonly number[];
    let start = range[0]!;
    let n = trips(loop.cop, loop.step, start, range[1]!);
    if (fault === 'skip-first-iteration' && n > 0) {
      start += loop.step;
      n -= 1;
    }
    const vars = loop.reduce?.vars ?? [];
    // A loop that pushes onto an array with a length word runs its scan even with no iteration,
    // and slot 0 holds the length after it (change 0094).
    const word = (plan.words ?? []).some((w) => w.loops.includes(j));
    if (n === 0 && !word) {
      for (const v of vars) folds.push({ identity: identityOf(v.op, v.type) });
      // A loop that pushes and runs no iteration pushed nothing (change 0078).
      if (loop.push !== undefined) folds.push({ identity: 0 });
      // The entry that stores binds a slot of each, and reads none (change 0094).
      if (plan.finish !== undefined)
        for (const v of vars) partials.push({ binding: v.binding, type: v.type, slots: 1 });
      continue;
    }
    const step = (entry: string, workgroups: [number, number, number], at = {}): void => {
      steps.push({
        entry,
        workgroups,
        args: { ...scalars, _start: start, _n: n, _in: 0, _out: 0, ...ats, ...at },
      });
    };
    const first = grid(Math.ceil(n / loop.wg));
    if (loop.push !== undefined) {
      // Count, scan, store (change 0078): `n` counts become offsets in place, and the total is
      // at slot `n`, which the call reads back.
      if (n > 0) step(loop.push.count, first.wg);
      step(loop.push.scan, [1, 1, 1]);
      if (n > 0) step(loop.entry, first.wg);
      partials.push({ binding: loop.push.binding, type: u32T, slots: n + 1 });
      folds.push({ binding: loop.push.binding, at: n });
      continue;
    }
    step(loop.entry, first.wg);
    if (vars.length === 0) continue;
    let count = Math.ceil(n / loop.wg);
    let slots = first.slots;
    let at = 0;
    while (count > 1) {
      const next = grid(Math.ceil(count / KERNEL_TREE));
      step(loop.reduce!.entry, next.wg, {
        _n: fault === 'drop-last-partial' ? count - 1 : count,
        _in: at,
        _out: slots,
      });
      at = slots;
      slots += next.slots;
      count = Math.ceil(count / KERNEL_TREE);
    }
    for (const v of vars) {
      partials.push({ binding: v.binding, type: v.type, slots });
      folds.push({ binding: v.binding, at });
    }
    if (plan.finish !== undefined) ats[`_at${String(j)}`] = at;
  }
  // The stores after the loops: one invocation, after every loop (change 0094).
  if (plan.finish !== undefined)
    steps.push({
      entry: plan.finish.entry,
      workgroups: [1, 1, 1],
      args: { ...scalars, _start: 0, _n: 0, _in: 0, _out: 0, ...ats },
    });
  const tripBuffer =
    plan.trips === undefined
      ? undefined
      : {
          ...plan.trips,
          words: Math.max(
            ...plan.loops.map((l) =>
              l.device === undefined ? TRIP_WORDS : l.device.at + tripWordsOf(l),
            ),
          ),
        };
  return {
    steps,
    partials,
    folds,
    words,
    ...(tripBuffer !== undefined ? { trips: tripBuffer } : {}),
  };
}

/** The slot of `_at<j>` that says loop `j` ran no iteration (change 0094). */
const NO_FOLD = 0xffffffff;

/** The result of kernel function `fn` from what its loops folded, by the plan's tail on the CPU
 *  tier; undefined for a function that returns nothing. */
export function tailOf(
  m: ModuleDecl,
  fn: string,
  plan: KernelPlan,
  args: readonly CpuValue[],
  folded: readonly CpuValue[],
): CpuValue | undefined {
  if (plan.tail === undefined) return undefined;
  const host = compileModule({ ...m, funcs: [...m.funcs, ...plan.ranges] }, { precision: 'f32' });
  return host.fns[plan.tail]!(...lengthsOf(functionOf(m, fn).params, args), ...folded);
}

/**
 * Run kernel function `fn` of `m` through `plan` on the f32 oracle, as its call does on WebGPU.
 * `args` are copied, and the copies written in place and returned.
 */
export function runKernelPlan(
  m: ModuleDecl,
  fn: string,
  plan: KernelPlan,
  args: readonly CpuValue[],
  fault?: PlanFault,
  held?: HeldLengths,
): KernelRun {
  const f = functionOf(m, fn);
  const schedule = scheduleKernelPlan(m, fn, plan, args, fault, held);
  const device = compileModule(plan.module, { precision: 'f32' });
  const values = args.map(copy);
  f.params.forEach((p, i) => {
    // An array is the storage binding the lowering emitted it under (Rule 3.3).
    if (p.type.kind === 'array')
      device.setBinding(plan.bindingNames.get(p.name) ?? p.name, values[i]!);
  });
  const parts = new Map<string, CpuValue[]>();
  for (const p of schedule.partials) {
    const part = Array.from({ length: p.slots }, () => zeroOf(p.type));
    parts.set(p.binding, part);
    device.setBinding(p.binding, part as unknown as CpuValue);
  }
  // The length words (change 0094), which the scans advance.
  const words = schedule.words.map((w) => ({ ...w, words: [...w.words] }));
  for (const w of words) device.setBinding(w.binding, w.words as unknown as CpuValue);
  // The trip buffer (change 0094): one array under both of its bindings.
  const trips = new Array<number>(schedule.trips?.words ?? 0).fill(0);
  if (schedule.trips !== undefined) {
    device.setBinding(schedule.trips.write, trips as unknown as CpuValue);
    device.setBinding(schedule.trips.read, trips as unknown as CpuValue);
  }
  for (const s of schedule.steps) {
    device.setBinding(plan.argsBinding, { ...s.args });
    const wg: [number, number, number] =
      s.indirect === undefined
        ? (s.workgroups as [number, number, number])
        : [trips[s.indirect]!, trips[s.indirect + 1]!, trips[s.indirect + 2]!];
    device.dispatch(s.entry, wg);
    // The instrument: a range entry that counted one iteration too few (change 0094).
    if (fault === 'device-trip-one-less' && s.range !== undefined && trips[s.range + 1]! > 0)
      trips[s.range + 1] = trips[s.range + 1]! - 1;
    // The instrument of stage 4: a range entry that gave the first fold level of a reduction one
    // partial too few, so a level of one partial writes the identity.
    const folds = plan.loops.some((l) => l.device?.at === s.range && l.reduce !== undefined);
    const level = s.range === undefined || !folds ? undefined : s.range + TRIP_WORDS;
    if (fault === 'device-fold-one-less' && level !== undefined && trips[level]! > 0)
      trips[level] = trips[level]! - 1;
  }
  const folded = schedule.folds.map((x) =>
    'identity' in x
      ? x.identity
      : 'trip' in x
        ? trips[x.trip]!
        : copy(parts.get(x.binding)![x.at]!),
  );
  return {
    result: tailOf(m, fn, plan, values, folded),
    arrays: values.filter((_, i) => f.params[i]!.type.kind === 'array'),
    ...(held !== undefined ? { lengths: lengthsIn(words, held) } : {}),
  };
}

/** The new length of each held array, from its word after the steps (change 0094). */
function lengthsIn(
  words: readonly { readonly param: string; readonly offset: number; readonly words: number[] }[],
  held: HeldLengths,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of words) if (held[w.param] !== undefined) out[w.param] = w.words[w.offset]!;
  return out;
}

/** The f32 oracle of each module {@link runKernelHeld} ran, made once. */
const oracles = new WeakMap<ModuleDecl, ReturnType<typeof compileModule>>();

/**
 * Kernel function `fn` of `m` on the f32 oracle, called as a call with held lengths runs it on
 * the CPU tier (change 0094): each held array's pushes start at its length, and the run gives the
 * new length of each. `args` are copied, and the copies written in place and returned.
 */
export function runKernelHeld(
  m: ModuleDecl,
  fn: string,
  args: readonly CpuValue[],
  held: HeldLengths,
): KernelRun {
  const f = functionOf(m, fn);
  const values = args.map(copy);
  const at = (name: string): number => f.params.findIndex((p) => p.name === name);
  for (const [name, h] of Object.entries(held))
    startPushesAt(values[at(name)] as CpuValue[], h.words[h.offset]!);
  let oracle = oracles.get(m);
  if (oracle === undefined) oracles.set(m, (oracle = compileModule(m, { precision: 'f32' })));
  const result = oracle.fns[fn]!(...values);
  const lengths: Record<string, number> = {};
  for (const name of Object.keys(held))
    lengths[name] = pushedLength(values[at(name)] as CpuValue[]);
  return {
    result,
    arrays: values.filter((_, i) => f.params[i]!.type.kind === 'array'),
    lengths,
  };
}

function functionOf(m: ModuleDecl, fn: string): ModuleDecl['funcs'][number] {
  const f = m.funcs.find((x) => x.name === fn);
  if (f === undefined) throw new Error(`kernel-plan: no function "${fn}"`);
  return f;
}

/** The parameters as the range functions and the tail take them: each array by its length. */
function lengthsOf(
  params: ModuleDecl['funcs'][number]['params'],
  args: readonly CpuValue[],
): CpuValue[] {
  return args.map((v, i) =>
    params[i]!.type.kind === 'array'
      ? ({ length: (v as unknown[]).length } as unknown as CpuValue)
      : v,
  );
}

/** Iterations from `start` toward `bound` by `step`, as the loop's comparison counts them. */
function trips(cop: string, step: number, start: number, bound: number): number {
  const s = Math.abs(step);
  const span =
    cop === '<'
      ? bound - start
      : cop === '<='
        ? bound - start + 1
        : cop === '>'
          ? start - bound
          : start - bound + 1;
  return span <= 0 ? 0 : Math.ceil(span / s);
}

/** The workgroups of a dispatch of `groups`, past 65535 spilling into y, and how many that is. */
function grid(groups: number): { wg: [number, number, number]; slots: number } {
  const x = Math.max(1, Math.min(groups, 65535));
  const y = Math.ceil(groups / x);
  return { wg: [x, y, 1], slots: x * y };
}

/** The partials of a reduction over a range the device holds whose cap is `cap` (change 0094,
 *  stage 4), as `levelsOf` in `host-kernel.ts` lays them out: the loop's slots, and the slots of
 *  each fold level, one at least. */
function levelsOf(cap: number, wg: number): { first: number; levels: number[] } {
  const first = grid(Math.ceil(Math.max(cap, 1) / wg)).slots;
  const levels: number[] = [];
  let count = Math.ceil(cap / wg);
  while (count > 1) {
    levels.push(grid(Math.ceil(count / KERNEL_TREE)).slots);
    count = Math.ceil(count / KERNEL_TREE);
  }
  if (levels.length === 0) levels.push(1);
  return { first, levels };
}

/** What a reduction of `op` over no iteration folds to. */
function identityOf(op: Parameters<typeof treeIdentity>[0], t: ShaderType): CpuValue {
  const scalar = t.kind === 'vec' ? t.elem : (t as { scalar: string }).scalar;
  const one = treeIdentity(op, scalar) as number;
  return t.kind === 'vec' ? new Array<number>(t.n).fill(one) : one;
}

const zeroOf = (t: ShaderType): CpuValue => (t.kind === 'vec' ? new Array<number>(t.n).fill(0) : 0);

/** A deep copy of a CPU value: arrays, vectors and structs are written in place. */
export function copy(v: CpuValue): CpuValue {
  if (Array.isArray(v)) return (v as CpuValue[]).map(copy) as unknown as CpuValue;
  if (typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) as CpuValue;
  return v;
}
