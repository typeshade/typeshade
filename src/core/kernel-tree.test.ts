// Verifies: Rule 7.2, Rule 8.22 (docs/language-design.md; traced in reqs/).
//
// A kernel function's reduction loop means the tree order (change 0013, part 3): each iteration
// from the identity, 256 at a time by the workgroup tree, then the partials the same way. The
// oracle (the interpreter) and the generated CPU code both run it, and give the same bits as
// the tree written out here; the WebGPU tier is held to the same reference by the import
// journey (`scripts/user-journey.ts`). A loop the proof refuses keeps the sequential order.
// The stepping debugger is a third walk over the IR, and a stepped run returns the same bits
// (docs/debugging.md §2.5, #362).

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModule } from './oracle.js';
import { compileModuleJs, generateModuleJs } from './cpu-codegen.js';
import { KERNEL_TREE, kernelTree, treeIdentity } from './kernel-tree.js';
import { startDebugSession } from './debug/session.js';
import { treeLoops } from './passes/parallel-loop.js';
import { createTypeshadeLanguageService } from '../language-service/service.js';

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

  it('combines a variable that may hold nothing through the helper, as the interpreter does', () => {
    // `shade` returns nothing for a negative `p.x` (a `discard`), so `s` starts as nothing, and
    // the loop's result is combined with it after the tree: per component, that would read a
    // component of nothing, where the helper takes it as a scalar (cpu-codegen.ts, "Operands
    // that may be missing").
    const source = `function shade(p: vec2): vec3 { if (p.x < 0.) { discard; } return vec3(1.); }
export function total(xs: array<vec3>, p: vec2): vec3 {
  let s = shade(p);
  for (const v of xs) { s += v; }
  return s;
}`;
    // The instrument: the loop is a reduction, so the generated code combines through the tree.
    const r = compile(`"use typeshade";\n${source}`, { fileName: 'm.shade.ts' });
    expect(generateModuleJs(r.module).fns.join('\n')).toContain('$.tree(');
    const xs = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    for (const precision of ['f32', 'f64'] as const) {
      const total = both(source, 'total', precision);
      expect(total(xs, [1, 0])).toEqual([6, 8, 10]);
      expect(total(xs, [-1, 0])).toEqual([NaN, NaN, NaN]);
    }
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

// ─── the stepping debugger (docs/debugging.md §2.5) ──────────────────────────────────────────

/** A value as text, with `-0`, NaN and the infinities kept, so that comparing two of them tells
 *  apart what `Object.is` does and a failure prints both. */
const bits = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    typeof x === 'number' && (Object.is(x, -0) || !Number.isFinite(x))
      ? Object.is(x, -0)
        ? '-0'
        : String(x)
      : x,
  );

let editor: ReturnType<typeof createTypeshadeLanguageService> | undefined;
let documents = 0;

/**
 * One function on the three walks over the IR that must agree: the interpreter, the generated CPU
 * code, and the stepping debugger run to its end. Each is handed its own copy of the arguments,
 * and the value each returns is compared bit for bit. The editor reads the same text and draws no
 * error where the compiler draws none (Rule 12.7), so what differs is the walks, not what either
 * half accepts. `trees` is how many loops the CPU tier folds in the tree order.
 */
function walks(source: string, fn: string, precision: 'f32' | 'f64' = 'f32') {
  const text = `"use typeshade";\n${source}`;
  const r = compile(text, { fileName: 'm.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  editor ??= createTypeshadeLanguageService();
  const uri = `stepped-${String(documents++)}.shade.ts`;
  editor.openDocument(uri, text);
  expect(editor.getDiagnostics(uri).filter((d) => d.severity === 'error')).toEqual([]);
  const interp = compileModule(r.module, { precision }).fns[fn]!;
  const js = compileModuleJs(r.module, { precision }).fns[fn]!;
  const run = (...args: unknown[]): unknown => {
    const copy = (): never[] => structuredClone(args) as never[];
    const want = interp(...copy());
    expect(bits(js(...copy()))).toBe(bits(want));
    const session = startDebugSession(r.module, fn, copy(), { precision });
    session.continue();
    expect(session.done).toBe(true);
    expect(bits(session.result)).toBe(bits(want));
    return want;
  };
  return Object.assign(run, { trees: treeLoops(r.module, r.module).size });
}

describe("a stepped run folds a kernel function's reduction in the tree order (#362)", () => {
  // Iteration order adds 1 to 1e8, which f32 rounds back to 1e8, and gets 1. The tree pairs 1e8
  // with -1e8 and 1 with 1, and gets 2. The stepper ran the loop in iteration order.
  const xs = [1e8, 1, -1e8, 1];

  it('returns what every tier returns for the issue: the sum of 1e8, 1, -1e8, 1 is 2', () => {
    const total = walks(SUM, 'total');
    expect(total.trees).toBe(1);
    expect(total(xs)).toBe(2);
    // The issue's own call: no options, so the session's default precision, f32.
    const { module } = compile(`"use typeshade";\n${SUM}`, { fileName: 'm.shade.ts' });
    const session = startDebugSession(module, 'total', [xs]);
    session.continue();
    expect(session.result).toBe(2);
  });

  it('agrees in f64 too, where the input does not show the order', () => {
    expect(walks(SUM, 'total', 'f64')(xs)).toBe(2);
  });

  it('folds `s = s + x`, a start value, a product, a vector and two variables the same way', () => {
    const spelt = walks(
      `export function t(xs: array<f32>): f32 { let s = 0.; for (const x of xs) { s = s + x; } return s; }`,
      't',
    );
    expect(spelt(xs)).toBe(2);
    // The variable's value before the loop is combined with the fold: 10 + 2. Iteration order
    // gives 9.
    const started = walks(
      `export function t(xs: array<f32>): f32 { let s = 10.; for (const x of xs) { s += x; } return s; }`,
      't',
    );
    expect(started(xs)).toBe(12);
    // 1e20 * 1e20 overflows f32, so iteration order gives Infinity; the tree multiplies each big
    // factor by a small one first and gets 1.
    const product = walks(
      `export function t(xs: array<f32>): f32 { let q = 1.; for (const x of xs) { q *= x; } return q; }`,
      't',
    );
    expect(product([1e20, 1e20, 1e-20, 1e-20])).toBe(1);
    const vs = [
      [1e8, 1],
      [1, 1],
      [-1e8, 1],
      [1, 1],
    ];
    const vector = walks(
      `export function t(xs: array<vec2>): vec2 { let s = vec2(0.); for (const v of xs) { s += v; } return s; }`,
      't',
    );
    expect(vector(vs)).toEqual([2, 4]);
    const two = walks(
      `export function t(xs: array<f32>): vec2 { let s = 0.; let n = 0.; for (const x of xs) { s += x; n += 1.; } return vec2(s, n); }`,
      't',
    );
    expect(two(xs)).toEqual([2, 4]);
  });

  it('folds an iteration that continues as the identity, and a reduction in a nested loop', () => {
    const odd = walks(
      `export function odd(xs: array<f32>): f32 { let s = 0.; for (let i: u32 = 0; i < xs.length; i++) { if (i % 2 === 0) { continue; } s += xs[i]; } return s; }`,
      'odd',
    );
    expect(odd([7, 1e8, 7, 1, 7, -1e8, 7, 1])).toBe(2);
    // Each iteration adds its element twice, from the identity: the sequence is 2e8, 2, -2e8, 2.
    const nested = walks(
      `export function t(xs: array<f32>): f32 { let s = 0.; for (let i: u32 = 0; i < xs.length; i++) { for (let j: u32 = 0; j < 2; j++) { s += xs[i]; } } return s; }`,
      't',
    );
    expect(nested.trees).toBe(1);
    expect(nested(xs)).toBe(4);
  });

  it('folds an emulated double in the tree order, and rounds an f32 combine only in f32', () => {
    const doubles = walks(
      `export function t(xs: array<f64>): f64 { let s: f64 = 0.; for (const x of xs) { s += x; } return s; }`,
      't',
    );
    expect(doubles([1e100, 1, -1e100, 1])).toBe(2);
    // 2^24 + 1 is not an f32: the combine rounds it, in the tree and in the variable.
    expect(walks(SUM, 'total', 'f32')([16777216, 1])).toBe(16777216);
    expect(walks(SUM, 'total', 'f64')([16777216, 1])).toBe(16777217);
  });

  it('leaves the variable as it was when the loop runs no iteration, and folds min, max and integers', () => {
    const keep = walks(
      `export function t(xs: array<f32>): f32 { let s = 5.; for (const x of xs) { s += x; } return s; }`,
      't',
    );
    expect(keep([])).toBe(5);
    const max = walks(
      `export function t(xs: array<f32>): f32 { let m = -1e30; for (const x of xs) { m = max(m, x); } return m; }`,
      't',
    );
    expect(max(xs)).toBe(1e8);
    const ints = walks(
      `export function t(xs: array<i32>): i32 { let n: i32 = 5; for (const x of xs) { n += x; } return n; }`,
      't',
    );
    expect(ints([1, 2, 3, -4, 2147483647])).toBe(-2147483642);
  });

  it('keeps iteration order in a loop the proof refuses, and in a function that is no kernel', () => {
    const scan = walks(
      `export function scan(xs: array<f32>): f32 { let s = 0.; for (let i: u32 = 0; i < xs.length; i++) { s = s + xs[i]; xs[i] = s; } return s; }`,
      'scan',
    );
    expect(scan.trees).toBe(0);
    expect(scan(xs)).toBe(1);
    // A sized array is no kernel function's: the loop runs as written, on every tier.
    const helper = walks(
      `function sum4(a: array<f32, 4>): f32 { let s = 0.; for (let i: u32 = 0; i < 4; i++) { s += a[i]; } return s; }`,
      'sum4',
    );
    expect(helper.trees).toBe(0);
    expect(helper(xs)).toBe(1);
  });
});
