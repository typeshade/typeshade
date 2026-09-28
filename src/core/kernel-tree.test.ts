// Verifies: Rule 7.2, Rule 8.22 (docs/language-design.md; traced in reqs/).
//
// A kernel function's reduction loop means the tree order (change 0013, part 3): each iteration
// from the identity, 256 at a time by the workgroup tree, then the partials the same way. The
// oracle (the interpreter) and the generated CPU code both run it, and give the same bits as
// the tree written out here; the WebGPU tier is held to the same reference by the import
// journey (`scripts/user-journey.ts`). A loop the proof refuses keeps the sequential order.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModule } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import { KERNEL_TREE, kernelTree, treeIdentity } from './kernel-tree.js';

const f = Math.fround;

/** The tree order, written out: blocks of 256 folded at stride 128 down to 1, the last padded
 *  with `id`, then the partials the same way until one is left. */
function reference(values: readonly number[], op: (a: number, b: number) => number, id: number) {
  const level = (vs: readonly number[]): number[] => {
    const out: number[] = [];
    for (let b = 0; b < vs.length; b += 256) {
      const w = Array.from({ length: 256 }, (_, t) => (b + t < vs.length ? vs[b + t]! : id));
      for (let s = 128; s > 0; s >>= 1) for (let t = 0; t < s; t++) w[t] = op(w[t]!, w[t + s]!);
      out.push(w[0]!);
    }
    return out;
  };
  let l = level(values);
  while (l.length > 1) l = level(l);
  return l[0]!;
}

/** Both CPU backends, in the precision given, on one kernel function. */
function both(source: string, fn: string, precision: 'f32' | 'f64' = 'f32') {
  const r = compile(`"use typeshade";\n${source}`, { fileName: 'm.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const interp = compileModule(r.module, { precision }).fns[fn]!;
  const js = compileModuleJs(r.module, { precision }).fns[fn]!;
  return (...args: unknown[]): unknown => {
    const a = interp(...(structuredClone(args) as never[]));
    const b = js(...(structuredClone(args) as never[]));
    expect(b).toEqual(a);
    if (typeof a === 'number') expect(Object.is(a, b)).toBe(true);
    return a;
  };
}

const SUM = `export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}`;

describe('a reduction loop of a kernel function (Rule 7.2)', () => {
  it('sums an f32 array in the tree order, over two levels of partials', () => {
    const total = both(SUM, 'total');
    const xs = Array.from({ length: 300000 }, (_, i) => f(Math.sin(i) * 1000.123));
    const tree = f(0 + reference(xs, (a, b) => f(a + b), -0));
    let sequential = 0;
    for (const x of xs) sequential = f(sequential + x);
    expect(total(xs)).toBe(tree);
    // The order is the meaning: the sequential reading is a different number.
    expect(tree).not.toBe(sequential);
  });

  it('folds an integer sum, a product, min, max and a vector the same way', () => {
    const ints = Array.from({ length: 1000 }, (_, i) => (i % 7) - 3);
    expect(
      both(
        `export function t(xs: array<i32>): i32 { let n: i32 = 5; for (const x of xs) { n += x; } return n; }`,
        't',
      )(ints),
    ).toBe(5 + ints.reduce((a, b) => a + b, 0));
    const xs = Array.from({ length: 700 }, (_, i) => f(1 + (i % 5) * 1e-3));
    expect(
      both(
        `export function p(xs: array<f32>): f32 { let q = 1.; for (const x of xs) { q *= x; } return q; }`,
        'p',
      )(xs),
    ).toBe(f(1 * reference(xs, (a, b) => f(a * b), 1)));
    expect(
      both(
        `export function lo(xs: array<f32>): vec2 { let a = 1e30; let b = -1e30; for (const x of xs) { a = min(a, x); b = max(x, b); } return vec2(a, b); }`,
        'lo',
      )(xs),
    ).toEqual([Math.min(...xs), Math.max(...xs)]);
    const vs = Array.from({ length: 600 }, (_, i) => [f(i * 0.1), 1, f(-i * 0.3)]);
    const sum = (k: number) =>
      f(
        0 +
          reference(
            vs.map((v) => v[k]!),
            (a, b) => f(a + b),
            -0,
          ),
      );
    expect(
      both(
        `export function vsum(xs: array<vec3>): vec3 { let s = vec3(0.); for (const v of xs) { s += v; } return s; }`,
        'vsum',
      )(vs),
    ).toEqual([sum(0), sum(1), sum(2)]);
  });

  it('counts an iteration that continues as the identity, and a loop that runs none leaves the variable', () => {
    const odd = both(
      `export function odd(xs: array<f32>): f32 { let s = 0.; for (let i: u32 = 0; i < xs.length; i++) { if (i % 2 === 0) { continue; } s += xs[i]; } return s; }`,
      'odd',
    );
    const xs = Array.from({ length: 900 }, (_, i) => f(i * 0.37));
    expect(odd(xs)).toBe(
      f(
        0 +
          reference(
            xs.map((x, i) => (i % 2 === 0 ? -0 : x)),
            (a, b) => f(a + b),
            -0,
          ),
      ),
    );
    const keep = both(
      `export function keep(xs: array<f32>): f32 { let s = -0.; for (const x of xs) { s += x; } return s; }`,
      'keep',
    );
    expect(Object.is(keep([]), -0)).toBe(true);
  });

  it('runs the tree in f64 too, where the CPU backends compute in doubles', () => {
    const total = both(SUM, 'total', 'f64');
    const xs = Array.from({ length: 5000 }, (_, i) => Math.sin(i) * 1000.123);
    expect(total(xs)).toBe(0 + reference(xs, (a, b) => a + b, -0));
  });

  it('keeps the sequential order in a loop the proof refuses', () => {
    const scan = both(
      `export function scan(xs: array<f32>): f32 { let s = 0.; for (let i: u32 = 0; i < xs.length; i++) { s = s + xs[i]; xs[i] = s; } return s; }`,
      'scan',
    );
    const xs = Array.from({ length: 1000 }, (_, i) => f(Math.sin(i) * 1000.123));
    let sequential = 0;
    for (const x of xs) sequential = f(sequential + x);
    expect(scan(xs)).toBe(sequential);
  });
});

describe('kernelTree', () => {
  it('folds even a single value with the identity, as the loop dispatch does', () => {
    const add = (a: unknown, b: unknown) => (a as number) + (b as number);
    expect(kernelTree([], add, () => -0)).toBeUndefined();
    expect(
      Object.is(
        kernelTree([-0], add, () => -0),
        -0,
      ),
    ).toBe(true);
    expect(kernelTree([1, 2, 3], add, () => -0)).toBe(6);
    expect(KERNEL_TREE).toBe(256);
  });

  it('gives each operator the identity that leaves every value as it is', () => {
    expect(Object.is(treeIdentity('+', 'f32'), -0)).toBe(true);
    expect(treeIdentity('+', 'i32')).toBe(0);
    expect(treeIdentity('&', 'u32')).toBe(0xffffffff);
    expect(treeIdentity('&', 'i32')).toBe(-1);
    expect(treeIdentity('min', 'f32')).toBe(3.4028234663852886e38);
    expect(treeIdentity('max', 'f64')).toBe(-Infinity);
    expect(treeIdentity('max', 'i32')).toBe(-2147483648);
    expect(treeIdentity('min', 'u32')).toBe(0xffffffff);
    expect(treeIdentity('&', 'bool')).toBe(true);
  });
});
