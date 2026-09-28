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
// before anything runs. `runKernelPlan` runs it on the oracle, and the GPU differential
// (`scripts/gpu-differential.ts`) runs the same schedule on WebGPU.
//
// It follows `callKernel`'s WebGPU tier step for step: the trip count, the grid that spills past
// 65535 workgroups into y, the levels of partials, and the identity a loop that runs no iteration
// folds to. It is a second copy of that sequence, because `callKernel` needs a device. The import
// journey runs `callKernel` itself on WebGPU. Test code only.

import type { CpuValue } from '../cpu-runtime.js';
import type { ModuleDecl, ShaderType } from '../ir/index.js';
import { compileModule } from '../oracle.js';
import type { KernelPlan } from '../passes/kernel-lower.js';
import { KERNEL_TREE, treeIdentity } from '../kernel-tree.js';

/** What a call of a kernel function did: its result, and each array argument after it. */
export interface KernelRun {
  readonly result: CpuValue | undefined;
  readonly arrays: readonly CpuValue[];
}

/** A step of the dispatch to run wrong on purpose, so a comparison can be shown to notice it. */
export type PlanFault = 'skip-first-iteration' | 'drop-last-partial';

/** One dispatch: the entry, its workgroups, and the values of the plan's uniform. */
export interface PlanStep {
  readonly entry: string;
  readonly workgroups: readonly [number, number, number];
  readonly args: Readonly<Record<string, CpuValue>>;
}

/** Where a reduced variable's folded value is once the steps have run: a slot of its partials'
 *  binding, or, for a loop that ran no iteration, the operator's identity. */
export type PlanFold =
  { readonly binding: string; readonly at: number } | { readonly identity: CpuValue };

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
}

/** The dispatch of kernel function `fn` of `m` through `plan` for `args`, its parameters in order,
 *  an array as a JavaScript array of its elements. */
export function scheduleKernelPlan(
  m: ModuleDecl,
  fn: string,
  plan: KernelPlan,
  args: readonly CpuValue[],
  fault?: PlanFault,
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
  for (const loop of plan.loops) {
    const range = host.fns[loop.range]!(...lengths) as unknown as readonly number[];
    let start = range[0]!;
    let n = trips(loop.cop, loop.step, start, range[1]!);
    if (fault === 'skip-first-iteration' && n > 0) {
      start += loop.step;
      n -= 1;
    }
    const vars = loop.reduce?.vars ?? [];
    if (n === 0) {
      for (const v of vars) folds.push({ identity: identityOf(v.op, v.type) });
      continue;
    }
    const step = (entry: string, workgroups: [number, number, number], at = {}): void => {
      steps.push({
        entry,
        workgroups,
        args: { ...scalars, _start: start, _n: n, _in: 0, _out: 0, ...at },
      });
    };
    const first = grid(Math.ceil(n / loop.wg));
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
  }
  return { steps, partials, folds };
}

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
): KernelRun {
  const f = functionOf(m, fn);
  const schedule = scheduleKernelPlan(m, fn, plan, args, fault);
  const device = compileModule(plan.module, { precision: 'f32' });
  const values = args.map(copy);
  f.params.forEach((p, i) => {
    if (p.type.kind === 'array') device.setBinding(p.name, values[i]!);
  });
  const parts = new Map<string, CpuValue[]>();
  for (const p of schedule.partials) {
    const part = Array.from({ length: p.slots }, () => zeroOf(p.type));
    parts.set(p.binding, part);
    device.setBinding(p.binding, part as unknown as CpuValue);
  }
  for (const s of schedule.steps) {
    device.setBinding(plan.argsBinding, { ...s.args });
    device.dispatch(s.entry, s.workgroups as [number, number, number]);
  }
  const folded = schedule.folds.map((x) =>
    'identity' in x ? x.identity : copy(parts.get(x.binding)![x.at]!),
  );
  return {
    result: tailOf(m, fn, plan, values, folded),
    arrays: values.filter((_, i) => f.params[i]!.type.kind === 'array'),
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
