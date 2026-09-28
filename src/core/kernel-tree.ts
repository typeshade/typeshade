// ═══ The tree order a kernel function's reduction is combined in (Rule 7.2, change 0013) ═══
//
// A reduction loop of a kernel function, `for (…) { s += xs[i]; }`, means one order of
// combining: the one the GPU runs. Each iteration starts from the operator's identity and
// combines what it contributes into its own value. The values are taken 256 at a time, in
// iteration order, the last block padded with the identity, and each block is folded by the
// workgroup tree: at stride 128, then 64, down to 1, slot `t` becomes `slot[t] op slot[t + s]`.
// That gives one partial per block. While more than one partial is left, the partials are
// folded the same way. Finally the variable becomes `s op result`, and a loop that ran no
// iteration leaves it as it was.
//
// The WebGPU tier runs this as a dispatch of the loop and then one per level of partials
// (`core/passes/kernel-lower.ts`); the CPU tier and the oracle run it here, so every tier
// computes the same bits. For an integer operator, `min` and `max` the order changes nothing;
// for an `f32` or `f64` sum or product it is what the loop means, which is why the proof
// (`parallel-loop.ts`) accepts one.
//
// This file is part of `typeshade/runtime`: the generated CPU code calls it through `$`.

import type { CpuValue } from './cpu-runtime.js';

/** How many values the workgroup tree folds at once: the workgroup size of a reduction. */
export const KERNEL_TREE = 256;

/** The operators a reduction combines with. */
export type TreeOp = '+' | '*' | '&' | '|' | '^' | 'min' | 'max';

/**
 * Fold `values` in the tree order: blocks of {@link KERNEL_TREE}, each by the workgroup tree,
 * then the partials the same way until one is left.
 *
 * @param values - each iteration's contribution, in iteration order. Not modified.
 * @param combine - `a op b`, rounded as the variable's type is; it must return a new value.
 * @param identity - a fresh identity of the operator for the variable's type.
 * @returns the fold, or `undefined` for no values.
 */
export function kernelTree(
  values: readonly CpuValue[],
  combine: (a: CpuValue, b: CpuValue) => CpuValue,
  identity: () => CpuValue,
): CpuValue | undefined {
  if (values.length === 0) return undefined;
  // The loop's own dispatch folds its block even when it is the only one.
  let level = blocks(values, combine, identity);
  while (level.length > 1) level = blocks(level, combine, identity);
  return level[0];
}

function blocks(
  values: readonly CpuValue[],
  combine: (a: CpuValue, b: CpuValue) => CpuValue,
  identity: () => CpuValue,
): CpuValue[] {
  const out: CpuValue[] = [];
  const slot: CpuValue[] = new Array<CpuValue>(KERNEL_TREE);
  for (let b = 0; b < values.length; b += KERNEL_TREE) {
    for (let t = 0; t < KERNEL_TREE; t++)
      slot[t] = b + t < values.length ? values[b + t]! : identity();
    for (let s = KERNEL_TREE >> 1; s > 0; s >>= 1)
      for (let t = 0; t < s; t++) slot[t] = combine(slot[t]!, slot[t + s]!);
    out.push(slot[0]!);
  }
  return out;
}

/** The largest finite `f32`, `(2 - 2^-23) * 2^127`. */
const F32_MAX = 3.4028234663852886e38;

/**
 * The identity of `op` for one component of `scalar`: the value `x op identity` leaves `x`
 * as it is, `-0` for a float sum so that a sum of `-0` stays `-0`. An `f32` `min` and `max`
 * start from the largest finite value of their sign: WGSL refuses an infinity in a constant
 * expression and lets a driver assume none at run time, so only an infinity in the data folds
 * differently, to that finite value, and every tier does the same.
 */
export function treeIdentity(op: TreeOp, scalar: string): number | boolean {
  if (scalar === 'bool') return op === '&';
  if (scalar === 'f32' && (op === 'min' || op === 'max')) return op === 'min' ? F32_MAX : -F32_MAX;
  const float = scalar === 'f32' || scalar === 'f64' || scalar === 'f16';
  switch (op) {
    case '+':
      return float ? -0 : 0;
    case '*':
      return 1;
    case '|':
    case '^':
      return 0;
    case '&':
      return scalar === 'u32' ? 0xffffffff : -1;
    case 'min':
      return float ? Infinity : scalar === 'u32' ? 0xffffffff : 2147483647;
    case 'max':
      return float ? -Infinity : scalar === 'u32' ? 0 : -2147483648;
  }
}
