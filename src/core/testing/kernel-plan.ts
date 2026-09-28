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

/**
 * Run kernel function `fn` of `m` through `plan` on the f32 oracle, as its call does on WebGPU.
 * `args` are the function's parameters in order, an array as a JavaScript array of its elements;
 * they are copied, and the copies written in place and returned.
 */
export function runKernelPlan(
  m: ModuleDecl,
  fn: string,
  plan: KernelPlan,
  args: readonly CpuValue[],
  fault?: PlanFault,
): KernelRun {
  const f = m.funcs.find((x) => x.name === fn);
  if (f === undefined) throw new Error(`runKernelPlan: no function "${fn}"`);
  const host = compileModule({ ...m, funcs: [...m.funcs, ...plan.ranges] }, { precision: 'f32' });
  const device = compileModule(plan.module, { precision: 'f32' });
  const values = args.map(copy);
  const isArray = (i: number): boolean => f.params[i]!.type.kind === 'array';
  // The range functions and the tail read an array only by its length, as the call hands it them.
  const lengths = values.map((v, i) =>
    isArray(i) ? ({ length: (v as unknown[]).length } as unknown as CpuValue) : v,
  );
  f.params.forEach((p, i) => {
    if (isArray(i)) device.setBinding(p.name, values[i]!);
  });
  const folded: CpuValue[] = [];
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
      for (const v of vars) folded.push(identityOf(v.op, v.type));
      continue;
    }
    const args_: Record<string, CpuValue> = { _start: start, _n: n, _in: 0, _out: 0 };
    f.params.forEach((p, i) => {
      if (!isArray(i)) args_[p.name] = values[i]!;
    });
    const bind = (): void => device.setBinding(plan.argsBinding, { ...args_ });
    bind();
    const first = grid(Math.ceil(n / loop.wg));
    if (vars.length === 0) {
      device.dispatch(loop.entry, first.wg);
      continue;
    }
    const levels: { wg: [number, number, number]; slots: number; count: number }[] = [];
    let count = Math.ceil(n / loop.wg);
    let slots = first.slots;
    while (count > 1) {
      const next = grid(Math.ceil(count / KERNEL_TREE));
      levels.push({ ...next, count });
      slots += next.slots;
      count = Math.ceil(count / KERNEL_TREE);
    }
    const parts = vars.map((v) => {
      const part = Array.from({ length: slots }, () => zeroOf(v.type));
      device.setBinding(v.binding, part as unknown as CpuValue);
      return part;
    });
    device.dispatch(loop.entry, first.wg);
    let at = 0;
    let out = first.slots;
    for (const level of levels) {
      args_._n = fault === 'drop-last-partial' ? level.count - 1 : level.count;
      args_._in = at;
      args_._out = out;
      bind();
      device.dispatch(loop.reduce!.entry, level.wg);
      at = out;
      out += level.slots;
    }
    for (const part of parts) folded.push(copy(part[at]!));
  }
  const result = plan.tail === undefined ? undefined : host.fns[plan.tail]!(...lengths, ...folded);
  return { result, arrays: values.filter((_, i) => isArray(i)) };
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
