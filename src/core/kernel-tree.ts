// ═══ The tree order a kernel function's reduction is combined in (Rule 7.2, Rule 8.22, change 0013) ═══
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
import type { ShaderType } from './ir/types.js';

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

/**
 * A fresh identity of `op` in the type of the variable a reduction combines into: the identity of
 * one component, in every component of a vector. An emulated `f64`, alone or as the element of a
 * vector, takes the `f64` identity. What each iteration of a reduction loop starts from, in the
 * oracle and in the stepping debugger, which run the loop on the CPU as the GPU's invocations do.
 */
export function reductionIdentity(op: TreeOp, type: ShaderType): CpuValue {
  const scalar = type.kind === 'scalar' ? type.scalar : type.kind === 'vec' ? type.elem : 'f64';
  const one = treeIdentity(op, scalar) as CpuValue;
  return type.kind === 'vec' || type.kind === 'vec64'
    ? (new Array<CpuValue>(type.n).fill(one) as unknown as CpuValue)
    : one;
}

// ─── the scatter accumulation of a kernel loop (Rule 7.2, change 0056 slice 2a) ───────────────

/** One element's contributions in one loop: the iteration each came from, in increasing order,
 *  and the value that iteration left in the element. */
interface Bag {
  readonly pos: number[];
  readonly val: number[];
}

/** A canonical array index, as a property key spells it (`"0"`, `"17"`, never `"017"`). */
const INDEX_KEY = /^(0|[1-9]\d*)$/;

/**
 * The state of one run of a kernel loop that adds `f32` (or `f64`) values into parameter arrays at
 * computed indices (`g[idx[i]] += x[i]`, change 0056 item 3, option C).
 *
 * Within one iteration, the contributions to one element are added in program order: the
 * iteration's sum starts from the identity of `+` (`-0`), so the body reads and writes its sum
 * through {@link view}. At the end of each iteration, the sums it made are kept per element with
 * the iteration's number ({@link end}). At the end of the loop ({@link finish}), the sums to one
 * element are folded by the 256-wide tree of {@link kernelTree}, over the iterations in iteration
 * order, and the result is added to the element's value from before the loop.
 *
 * The fold is the dense `kernelTree` over every iteration, with the identity where an iteration
 * gave nothing. It is computed over the iterations that gave one, and the two agree: an empty slot
 * is skipped, where the dense fold would add `-0`, and `x + -0` is `x` for every `x`, including
 * `-0`. The run is for the CPU tier only: the GPU-tier proof refuses the form
 * (`parallel-loop.ts`, {@link ProofOptions}).
 */
export class ScatterRun {
  private readonly part: Map<number, number>[];
  private readonly bags: Map<number, Bag>[];
  private readonly views: number[][];
  private iter = 0;

  /** @param arrays - the target arrays, the real ones, in the order the loop names them.
   *  @param f32 - whether a combine rounds to `f32`. */
  constructor(
    private readonly arrays: readonly number[][],
    private readonly f32: boolean,
  ) {
    this.part = arrays.map(() => new Map<number, number>());
    this.bags = arrays.map(() => new Map<number, Bag>());
    this.views = arrays.map((a, j) => this.viewOf(a, j));
  }

  /** The number of (element, iteration) contributions the run has kept, summed over its arrays.
   *  The scratch the loop holds before {@link finish}; `scripts/scatter-scratch.ts` measures it. */
  get contributions(): number {
    let n = 0;
    for (const bags of this.bags) for (const b of bags.values()) n += b.pos.length;
    return n;
  }

  /** Target `j` as the loop body sees it: reads give the iteration's sum, writes set it. */
  view(j: number): number[] {
    return this.views[j]!;
  }

  /** Target `j` itself, which holds the element values from before the loop until {@link finish}. */
  real(j: number): number[] {
    return this.arrays[j]!;
  }

  private viewOf(a: number[], j: number): number[] {
    return new Proxy(a, {
      get: (t, p) => {
        if (typeof p === 'string' && INDEX_KEY.test(p)) return this.get(j, Number(p));
        // No receiver: a typed array's `length` getter throws on the proxy that wraps it.
        return Reflect.get(t, p) as unknown;
      },
      set: (t, p, v: number) => {
        if (typeof p === 'string' && INDEX_KEY.test(p)) this.put(j, Number(p), v);
        else Reflect.set(t, p, v);
        return true;
      },
    });
  }

  private get(j: number, k: number): number {
    return this.part[j]!.get(k) ?? -0;
  }

  private put(j: number, k: number, v: number): void {
    this.part[j]!.set(k, v);
  }

  /** The end of one iteration: each element it wrote is kept with this iteration's number. */
  end(): void {
    this.arrays.forEach((_, j) => {
      for (const [k, v] of this.part[j]!) {
        let bag = this.bags[j]!.get(k);
        if (bag === undefined) this.bags[j]!.set(k, (bag = { pos: [], val: [] }));
        bag.pos.push(this.iter);
        bag.val.push(v);
      }
      this.part[j]!.clear();
    });
    this.iter++;
  }

  /** The end of the loop: each element is combined with its value from before the loop. */
  finish(): void {
    this.arrays.forEach((a, j) => {
      for (const [k, bag] of this.bags[j]!) {
        const sum = foldBag(bag, this.iter, this.f32)!;
        a[k] = this.f32 ? Math.fround(a[k]! + sum) : a[k]! + sum;
      }
      this.bags[j]!.clear();
    });
  }
}

/** The 256 slots one block folds in, reused: a slot that no contribution reached holds `undefined`,
 *  which is the identity, so an empty slot costs no combine. */
const SLOTS: (number | undefined)[] = new Array<number | undefined>(KERNEL_TREE);

/** The tree fold of one element's contributions over `n` iterations: {@link kernelTree} with the
 *  identity at every iteration that gave none, computed over the blocks that hold one. */
function foldBag(bag: Bag, n: number, f32: boolean): number | undefined {
  let pos = bag.pos;
  let val = bag.val;
  let len = n;
  do {
    const nextPos: number[] = [];
    const nextVal: number[] = [];
    for (let p = 0; p < pos.length;) {
      const block = Math.floor(pos[p]! / KERNEL_TREE);
      SLOTS.fill(undefined);
      for (; p < pos.length && Math.floor(pos[p]! / KERNEL_TREE) === block; p++)
        SLOTS[pos[p]! - block * KERNEL_TREE] = val[p]!;
      // Stride 128, then 64, down to 1: slot t becomes slot[t] op slot[t + s], the identity where a
      // slot is empty. Within one stride every write is below s and every read is at or above s, so
      // the slots of one stride are independent.
      for (let s = KERNEL_TREE >> 1; s > 0; s >>= 1)
        for (let t = 0; t < s; t++) {
          const b = SLOTS[t + s];
          if (b === undefined) continue;
          const a = SLOTS[t];
          SLOTS[t] = a === undefined ? b : f32 ? Math.fround(a + b) : a + b;
        }
      const r = SLOTS[0];
      if (r !== undefined) {
        nextPos.push(block);
        nextVal.push(r);
      }
    }
    pos = nextPos;
    val = nextVal;
    len = Math.ceil(len / KERNEL_TREE);
  } while (len > 1);
  return val[0];
}
