// Verifies: Rule 7.2, Rule 8.22 (docs/language-design.md; traced in reqs/).
//
// An `f32` scatter with `+=` at a computed index in a kernel function's loop (change 0056, slice
// 2a, option C). The CPU tier folds the contributions to one element in the tree order of Rule 7.2:
// within one iteration, in program order; across iterations, by the 256-wide tree over the
// iteration numbers. The GPU-tier proof still refuses the form (TS8070), so no GPU lowering sees
// it. The tests hold the three CPU walks (the oracle, the generated code and the stepper) to one
// reference, bit for bit, and show that the reference can fail.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { startDebugSession } from '../debug/session.js';
import type { CpuValue } from '../cpu-runtime.js';
import { proveKernels } from './parallel-loop.js';
import { determinismReport } from './determinism.js';
import { KERNEL_TREE } from '../kernel-tree.js';

const f = Math.fround;

const SCATTER = `"use typeshade";
export function scat(g: array<f32>, idx: array<u32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) {
    g[idx[i]] += x[i];
  }
}`;

/** The same loop with two contributions per iteration, to the same element and program order. */
const TWO = `"use typeshade";
export function scat2(g: array<f32>, idx: array<u32>, x: array<f32>, y: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) {
    g[idx[i]] += x[i];
    g[idx[i]] += y[i];
  }
}`;

/** The reference of Rule 7.2 for a scatter, written out densely and independently of `ScatterRun`.
 *  For each element, each iteration's sum starts from `-0` and adds its contributions in program
 *  order; the per-iteration sums (`-0` where an iteration gave none) are folded in blocks of 256 by
 *  the workgroup tree, then the partials the same way until one is left; the element then becomes
 *  its value before the loop plus that fold. */
function reference(
  g0: readonly number[],
  contributions: readonly (readonly [number, number])[][],
  round: (x: number) => number = f,
): number[] {
  const g = [...g0];
  const elements = new Set<number>();
  for (const it of contributions) for (const [k] of it) elements.add(k);
  for (const k of [...elements].sort((a, b) => a - b)) {
    const perIter = contributions.map((it) => {
      let s = -0;
      for (const [e, v] of it) if (e === k) s = round(s + v);
      return s;
    });
    g[k] = round(g[k]! + tree(perIter, round));
  }
  return g;
}

/** The workgroup tree over `values`, as Rule 7.2 writes it, each sum rounded by `round`. */
function tree(values: readonly number[], round: (x: number) => number = f): number {
  const level = (vs: readonly number[]): number[] => {
    const out: number[] = [];
    for (let b = 0; b < vs.length; b += KERNEL_TREE) {
      const w = Array.from({ length: KERNEL_TREE }, (_, t) =>
        b + t < vs.length ? vs[b + t]! : -0,
      );
      for (let s = KERNEL_TREE >> 1; s > 0; s >>= 1)
        for (let t = 0; t < s; t++) w[t] = round(w[t]! + w[t + s]!);
      out.push(w[0]!);
    }
    return out;
  };
  let l = level(values);
  if (l.length === 0) return -0;
  while (l.length > 1) l = level(l);
  return l[0]!;
}

/** Left-to-right in iteration order, which is what TypeScript means and what the tree replaces. */
function naive(
  g0: readonly number[],
  contributions: readonly (readonly [number, number])[][],
  round: (x: number) => number = f,
) {
  const g = [...g0];
  for (const it of contributions) for (const [k, v] of it) g[k] = round(g[k]! + v);
  return g;
}

/** A value as text, with `-0` and the non-finite values kept, so `toEqual` tells them apart. */
const bits = (xs: unknown): string =>
  JSON.stringify(xs, (_, x: unknown) =>
    typeof x === 'number' && (Object.is(x, -0) || !Number.isFinite(x))
      ? Object.is(x, -0)
        ? '-0'
        : String(x)
      : x,
  );

/** Compile `source`, run `fn` on the oracle, the generated code and the stepper, on copies of
 *  `args`, and return the arrays each walk leaves. A walk that disagrees with another throws. */
function walks(
  source: string,
  fn: string,
  args: readonly number[][],
  precision: 'f32' | 'f64' = 'f32',
): number[][] {
  const values = args as unknown as readonly CpuValue[];
  const r = compile(source, { fileName: 'm.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  // The generated functions take their arrays as they are; the typing of `fns` is per value, so the
  // array arguments go through `unknown` here, once.
  type Call = (...xs: unknown[]) => unknown;
  const interp = compileModule(r.module, { precision }).fns[fn] as unknown as Call;
  const js = compileModuleJs(r.module, { precision }).fns[fn] as unknown as Call;
  const copy = (): CpuValue[] => structuredClone(values) as CpuValue[];
  const a = copy();
  interp(...a);
  const b = copy();
  js(...b);
  expect(bits(b)).toBe(bits(a));
  const c = copy();
  const session = startDebugSession(r.module, fn, c, { precision });
  session.continue();
  expect(session.done).toBe(true);
  expect(bits(c)).toBe(bits(a));
  return a as unknown as number[][];
}

/** The contributions of `scat` on `g`, `idx` and `x`: one iteration `i` adds `x[i]` to `idx[i]`. */
const single = (idx: number[], x: number[]): (readonly [number, number])[][] =>
  x.map((v, i) => [[idx[i]!, v] as const]);

describe('an f32 scatter with += folds each element in the tree order (change 0056, option C)', () => {
  it('gives 2 for 1e8, 1, -1e8, 1 into one element, where left-to-right gives 1', () => {
    const g0 = [0];
    const idx = [0, 0, 0, 0];
    const x = [1e8, 1, -1e8, 1];
    const [g] = walks(SCATTER, 'scat', [g0, idx, x]);
    // Iteration order: 1e8 + 1 rounds back to 1e8, then the sum is 0, then 1.
    expect(naive([0], single(idx, x))[0]).toBe(1);
    // Tree order: the pairs (1e8, -1e8) and (1, 1) fold to 0 and 2, then to 2.
    expect(g).toEqual([2]);
    expect(g).toEqual(reference(g0, single(idx, x)));
  });

  it('adds the fold to the element before the loop', () => {
    const [g] = walks(SCATTER, 'scat', [[10], [0, 0, 0, 0], [1e8, 1, -1e8, 1]]);
    expect(g).toEqual([12]);
  });

  it('adds in program order within one iteration, and across iterations by the tree', () => {
    // Iteration 0 adds 1e8 then 1 to element 0: in f32, 1e8 + 1 is 1e8. Iteration 1 adds -1e8
    // and iteration 2 adds 1. Left-to-right gives 1; the tree over the three iterations gives 0.
    const g0 = [0];
    const x = [1e8, -1e8, 1];
    const y = [1, 0, 0];
    const contributions = [
      [
        [0, 1e8],
        [0, 1],
      ],
      [
        [0, -1e8],
        [0, 0],
      ],
      [
        [0, 1],
        [0, 0],
      ],
    ] as (readonly [number, number])[][];
    const [g] = walks(TWO, 'scat2', [g0, [0, 0, 0], x, y]);
    expect(g).toEqual(reference(g0, contributions));
    expect(g).toEqual([0]);
    expect(naive(g0, contributions)).toEqual([1]);
  });

  it('equals the reference bit for bit on a random scatter over several elements and 700 iterations', () => {
    const rnd = mulberry32(0x0056);
    const n = 700;
    const elements = 5;
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * elements));
    const x = Array.from({ length: n }, () => f(mixed(rnd)));
    const g0 = Array.from({ length: elements }, () => f(mixed(rnd)));
    const [g] = walks(SCATTER, 'scat', [g0, idx, x]);
    expect(bits(g)).toBe(bits(reference(g0, single(idx, x))));
    // The tree differs from left-to-right on this input, so the test does not pass by accident.
    expect(bits(naive(g0, single(idx, x)))).not.toBe(bits(g));
  });

  it('equals the reference at f64 too, where the contributions are not rounded', () => {
    const rnd = mulberry32(7);
    const n = 300;
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * 3));
    const x = Array.from({ length: n }, () => mixed(rnd));
    const g0 = [0.5, -2, 3];
    const [g] = walks(SCATTER, 'scat', [g0, idx, x], 'f64');
    expect(bits(g)).toBe(bits(reference(g0, single(idx, x), (v) => v)));
  });

  it('keeps the walks equal when an element gets no contribution (the identity is -0)', () => {
    const g0 = [-0, 4];
    const [g] = walks(SCATTER, 'scat', [g0, [1, 1], [-0, 0]]);
    // Element 0 gets nothing and stays -0; element 1 gets 0 + -0 + 0 = 0 and stays 4.
    expect(bits(g)).toBe(bits(reference(g0, single([1, 1], [-0, 0]))));
    expect(bits(g)).toBe(bits([-0, 4]));
  });
});

describe('the instrument can fail (AGENTS.md#gate-discipline)', () => {
  it('a left-to-right fold would fail the order test, and the comparison says so', () => {
    const g0 = [0];
    const idx = [0, 0, 0, 0];
    const x = [1e8, 1, -1e8, 1];
    const [g] = walks(SCATTER, 'scat', [g0, idx, x]);
    const wrong = naive(g0, single(idx, x));
    expect(() => expect(wrong).toEqual(g)).toThrow();
  });

  it('a reference that drops the tree fails on random data, and the comparison says so', () => {
    const rnd = mulberry32(0x0056);
    const idx = Array.from({ length: 700 }, () => Math.floor(rnd() * 5));
    const x = Array.from({ length: 700 }, () => f(mixed(rnd)));
    const g0 = Array.from({ length: 5 }, () => f(mixed(rnd)));
    const [g] = walks(SCATTER, 'scat', [g0, idx, x]);
    expect(() => expect(bits(naive(g0, single(idx, x)))).toBe(bits(g))).toThrow();
  });
});

describe('the GPU tiers do not take the form (Rule 8.22, TS8070 stays)', () => {
  it('the default proof refuses an f32 scatter, and the CPU-tier proof accepts it', () => {
    const r = compile(SCATTER, { fileName: 'm.shade.ts' });
    const gpu = proveKernels(r.module)[0]!;
    expect(gpu.loops[0]!.ok).toBe(false);
    const cpu = proveKernels(r.module, { cpuScatterF32: true })[0]!;
    const v = cpu.loops[0]!;
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.writes).toEqual([{ kind: 'scatter', name: 'g', op: '+', float: true }]);
  });

  it('the compiler still says TS8070 for the loop, so the GPU route is not taken', () => {
    const r = compile(SCATTER, { fileName: 'm.shade.ts' });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['TS8070']);
  });

  it('an f32 scatter that compiles today with an index the proof can show distinct stays affine', () => {
    const src = `"use typeshade";
export function add(g: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) {
    g[i] += x[i];
  }
}`;
    const r = compile(src, { fileName: 'm.shade.ts' });
    const cpu = proveKernels(r.module, { cpuScatterF32: true })[0]!;
    const v = cpu.loops[0]!;
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.writes.map((w) => w.kind)).toEqual(['affine']);
  });
});

describe('the determinism report lists the scatter as an order row (surface §38)', () => {
  it('has one order row for f32 + at the scatter, in the function that holds it', () => {
    const r = compile(SCATTER, { fileName: 'm.shade.ts' });
    const rows = determinismReport(r.module).filter((e) => e.kind === 'order');
    expect(rows).toEqual([
      expect.objectContaining({
        op: '+',
        elem: 'f32',
        kind: 'order',
        where: ['scat'],
        accuracy: expect.stringContaining('on the CPU tier'),
      }),
    ]);
  });
});

/** A seeded generator, so the random tests run the same values every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value of mixed magnitude, so that rounding shows: 1e-3 to 1e8, both signs. */
function mixed(rnd: () => number): number {
  const sign = rnd() < 0.5 ? -1 : 1;
  return sign * Math.pow(10, rnd() * 11 - 3);
}
