// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
//
// The independence proof of a kernel function's loops (change 0013), over the programs #252
// measured it on: every order-independent loop the hand-written `@compute` entries of the corpus
// stand for, which it accepts, and the textbook dependences, which it refuses for the reason a
// reader would give. Among them are the `inout` cases #252's prototype first got wrong (M1,
// finding 1): a call that writes through a reference looks like a read at the call site, and
// must count as a write there.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { proveKernels, type KernelProof, type LoopRead, type LoopStore } from './parallel-loop.js';
import { lowerKernel } from './kernel-lower.js';
import { callArgAccess, eachOperand, type Access } from './access.js';
import type { Expr, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';

function proof(body: string): KernelProof {
  const r = compile(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const proofs = proveKernels(r.module);
  expect(proofs).toHaveLength(1);
  return proofs[0]!;
}

/** What the proof says about the one loop of the one kernel function: `map`, `reduce` and the
 *  reduction ops, or the refusal's rule and reason. */
function verdict(body: string): string {
  const p = proof(body);
  expect(p.shape).toBeUndefined();
  const v = p.loops[0]!;
  if (!v.ok) return `${v.refusal.rule} ${'why' in v.refusal ? v.refusal.why : 'call'}`;
  const writes = v.writes.map((w) => `${w.kind} ${w.name}`);
  const reductions = v.reductions.map((r) => `${r.op} ${r.name}`);
  return [...writes, ...reductions].join(', ');
}

describe('the proof accepts a loop whose iterations touch nothing another one touches', () => {
  it.each([
    [
      "the roadmap's render",
      `export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
  }
}`,
      'affine out',
    ],
    [
      'a gather',
      `export function gather(a: array<f32>, idx: array<u32>, b: array<f32>) {
  for (let i: u32 = 0; i < b.length; i++) { b[i] = a[idx[i]]; }
}`,
      'affine b',
    ],
    [
      'a stencil into another array',
      `export function stencil(a: array<f32>, b: array<f32>) {
  for (let i: u32 = 1; i < b.length - 1; i++) { b[i] = a[i - 1] + a[i + 1]; }
}`,
      'affine b',
    ],
    [
      'a step of 2, read and written at i',
      `export function axpy(x: array<f32>, y: array<f32>) {
  for (let i: u32 = 0; i < y.length; i += 2) { y[i] = 2. * x[i] + y[i]; }
}`,
      'affine y',
    ],
    [
      'a stride of 3 (R3b)',
      `export function stride(out: array<f32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) { out[i * 3] = 1.; out[i * 3 + 1] = 2.; out[i * 3 + 2] = 3.; }
}`,
      'affine out',
    ],
    [
      'row-major over a nested loop (R3c)',
      `export function tile(out: array<f32>, w: u32, h: u32) {
  for (let y: u32 = 0; y < h; y++) { for (let x: u32 = 0; x < w; x++) { out[y * w + x] = f32(x + y); } }
}`,
      'row-major out',
    ],
    [
      'one index whose coefficient the call checks (R3b)',
      `export function scaled(out: array<f32>, n: u32, stride: u32) {
  for (let i: u32 = 0; i < n; i++) { out[i * stride] = 1.; }
}`,
      'scaled out',
    ],
    [
      'a struct array written in place',
      `class P { pos: vec4; vel: vec4; }
export function step(ps: array<P>, dt: f32) {
  for (let i: u32 = 0; i < ps.length; i++) { ps[i].pos = ps[i].pos + ps[i].vel * dt; }
}`,
      'affine ps',
    ],
    [
      'a method that writes the element it is called on',
      `class P {
  pos: vec4;
  vel: vec4;
  advance(dt: f32) { this.pos = this.pos + this.vel * dt; }
}
export function step(ps: array<P>, dt: f32) {
  for (let i: u32 = 0; i < ps.length; i++) { ps[i].advance(dt); }
}`,
      'affine ps',
    ],
    [
      'per-iteration state inside the loop',
      `export function nearest(a: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    let best = 1e30;
    for (let j: u32 = 0; j < a.length; j++) { best = min(best, abs(a[j] - f32(i))); }
    out[i] = best;
  }
}`,
      'affine out',
    ],
    [
      'a sum (R3e)',
      `export function total(xs: array<f32>): f32 { let s = 0.; for (const x of xs) { s += x; } return s; }`,
      '+ s',
    ],
    [
      'a mean and a variance, two sums',
      `export function moments(xs: array<f32>): vec2 {
  let s = 0.;
  let q = 0.;
  for (const x of xs) { s += x; q += x * x; }
  return vec2(s, q);
}`,
      '+ s, + q',
    ],
    [
      'a maximum written as s = max(s, e)',
      `export function largest(xs: array<f32>): f32 { let m = -1e30; for (const x of xs) { m = max(m, x); } return m; }`,
      'max m',
    ],
    [
      'a histogram, a scatter reduction (R3f)',
      `export function histogram(xs: array<u32>, bins: array<u32>) { for (const x of xs) { bins[x % 16] += 1; } }`,
      'scatter bins',
    ],
    [
      'a body that reads the length of the array it writes, which no iteration moves (#345)',
      `export function fill(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = f32(out.length); }
}`,
      'affine out',
    ],
    [
      'a volume stencil that bounds its +z neighbour by the length of what it writes (#345)',
      `export function diffuse(d: array<f32>, out: array<f32>, w: u32, h: u32, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) {
    const zf = i + w * h < out.length ? i + w * h : i;
    out[i] = d[i] + k * (d[zf] - d[i]);
  }
}`,
      'affine out',
    ],
  ])('%s', (_name, body, want) => {
    expect(verdict(body)).toBe(want);
  });
});

describe('the proof refuses a loop whose iterations depend on each other, for its reason', () => {
  it.each([
    [
      'a while loop (R1)',
      `export function fill(a: array<f32>) { let i: u32 = 0; while (i < a.length) { a[i] = 1.; i++; } }`,
      'R1 while',
    ],
    [
      'a multiplicative step (R1)',
      `export function halve(a: array<f32>) { for (let s: u32 = 64; s > 0; s /= 2) { a[s] = 1.; } }`,
      'R1 step',
    ],
    [
      'an early exit (R2)',
      `export function find(a: array<f32>): u32 {
  for (let i: u32 = 0; i < a.length; i++) { if (a[i] > 1.) { return i; } }
  return 0;
}`,
      'R2 return',
    ],
    [
      "a break of the loop's own (R2)",
      `export function upto(a: array<f32>) { for (let i: u32 = 0; i < a.length; i++) { if (a[i] > 1.) { break; } a[i] = 0.; } }`,
      'R2 break',
    ],
    [
      'argmin, a carried pair (R3)',
      `export function argmin(a: array<f32>): u32 {
  let best = 1e30;
  let at: u32 = 0;
  for (let i: u32 = 0; i < a.length; i++) { if (a[i] < best) { best = a[i]; at = i; } }
  return at;
}`,
      'R3 carried',
    ],
    [
      'a scatter at an index iterations can share (R3)',
      `export function scatter(a: array<f32>, idx: array<u32>, b: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) { b[idx[i]] = a[i]; }
}`,
      'R3 shared',
    ],
    [
      'a prefix sum (R4)',
      `export function prefix(out: array<f32>) { for (let i: u32 = 1; i < out.length; i++) { out[i] = out[i] + out[i - 1]; } }`,
      'R4 reads-written',
    ],
    [
      'in-place smoothing (R4)',
      `export function blur(a: array<f32>) { for (let i: u32 = 1; i < a.length; i++) { a[i] = (a[i] + a[i - 1]) * 0.5; } }`,
      'R4 reads-written',
    ],
    [
      'a call that bumps a counter (R5)',
      `let calls: u32 = 0;
function tally(): u32 { calls += 1; return calls; }
export function count(a: array<u32>) { for (let i: u32 = 0; i < a.length; i++) { a[i] = tally(); } }`,
      'R5 call',
    ],
    [
      'a console call (R6)',
      `export function noisy(a: array<f32>) { for (let i: u32 = 0; i < a.length; i++) { console.log(a[i]); a[i] = 1.; } }`,
      'R6 console',
    ],
    [
      'a guarded minimum, which v1 does not take (R3)',
      `export function guarded(a: array<f32>, out: array<f32>) {
  let near = 1e30;
  for (let i: u32 = 0; i < a.length; i++) { if (a[i] > 0. && a[i] < near) { near = a[i]; } }
  out[0] = near;
}`,
      'R3 carried',
    ],
  ])('%s', (_name, body, want) => {
    const p = proof(body);
    const v = p.loops[0]!;
    expect(v.ok).toBe(false);
    if (!v.ok)
      expect(`${v.refusal.rule} ${'why' in v.refusal ? v.refusal.why : 'call'}`).toBe(want);
  });
});

describe('an inout argument is a write at the call (#252, M1 finding 1)', () => {
  it.each([
    [
      'a method on an outer object, whose state carries',
      `class Random {
  state: u32;
  next(): u32 { this.state = this.state * 1664525 + 1013904223; return this.state; }
}
export function noise(out: array<u32>) {
  let rng = new Random();
  rng.state = 7;
  for (let i: u32 = 0; i < out.length; i++) { out[i] = rng.next(); }
}`,
    ],
    [
      'a method on an outer object, called with no result',
      `class Body {
  x: f32;
  v: f32;
  advance(dt: f32) { this.x = this.x + this.v * dt; }
}
export function run(out: array<f32>, dt: f32) {
  let b = new Body();
  for (let i: u32 = 0; i < out.length; i++) { b.advance(dt); out[i] = b.x; }
}`,
    ],
    [
      'a local function that writes a variable it captures',
      `export function glow(out: array<f32>) {
  let total = 0.;
  const bump = (x: f32) => { total = total * 0.5 + x; };
  for (let i: u32 = 0; i < out.length; i++) { bump(f32(i)); out[i] = total; }
}`,
    ],
  ])('refuses %s', (_name, body) => {
    const v = proof(body).loops.at(-1)!;
    expect(v.ok).toBe(false);
  });
});

describe("the body's shape", () => {
  it('runs the whole function on the CPU for a write outside its loops', () => {
    const p = proof(`export function f(a: array<f32>) {
  a[0] = 1.;
  for (let i: u32 = 0; i < a.length; i++) { a[i] = 2.; }
}`);
    expect(p.shape).toMatchObject({ why: 'outside', what: 'a' });
  });

  it('asks to split a function whose later loop reads what an earlier one reduces', () => {
    const p = proof(`export function normalize(a: array<f32>) {
  let s = 0.;
  for (const x of a) { s += x; }
  for (let i: u32 = 0; i < a.length; i++) { a[i] = a[i] / s; }
}`);
    expect(p.shape).toMatchObject({ why: 'split', name: 's' });
  });
});

describe('a call through a declaration named like a builtin reads its arguments (Rule 9.5)', () => {
  // `access.ts` says how a builtin uses each argument, by the builtin's name. A call of a
  // function the module declares under that name reaches the declaration (change 0029), which
  // takes each argument by value: a declared `atomicAdd(a: f32, b: f32)` writes no atomic, and
  // `xs[i]` is a read. Keyed on the name alone, the proof read an atomic's place and refused the
  // loop for a result that depends on the order of the invocations.
  const SRC = `function atomicAdd(a: f32, b: f32): f32 { return a + b; }
export function bump(xs: array<f32>, ys: array<f32>) {
  for (let i: u32 = 0; i < ys.length; i++) { ys[i] = atomicAdd(xs[i], 1.); }
}`;

  it('accepts the loop, as a map that writes ys and reads xs', () => {
    expect(verdict(SRC)).toBe('affine ys');
  });

  it('hands each argument over as a value, and a builtin call its access', () => {
    const r = compile(`"use typeshade";\n${SRC}\n`, { fileName: 'm.shade.ts' });
    const calls: (Expr & { op: 'call' })[] = [];
    const visit = (e: Expr): void =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && x.fn === 'atomicAdd') calls.push(x);
      });
    const walk = (s: Stmt): void => eachStmtExpr(s, visit, walk);
    for (const f of r.module.funcs) f.body.forEach(walk);
    expect(calls).toHaveLength(1);
    const declared = calls[0]!;
    expect(declared.declRef).toBeDefined();
    const seen: Access[] = [];
    eachOperand(declared, (_, a) => seen.push(a));
    expect(seen).toEqual(['value', 'value']);
    expect(callArgAccess(declared, 0)).toBe('value');
    const { declRef: _declRef, ...builtin } = declared;
    expect(callArgAccess(builtin, 0)).toBe('atomic-update');
  });
});

// ─── the index facts of an accepted loop (change 0058, F3) ───────────────────────────────────

describe('the index facts: every access of an array, at exactly the counter or not', () => {
  // The planner of `typeshade/fuse` fuses a consumer with the producer of an array only when
  // both reach it at `i`: a stencil, a gather and a shifted read each have to say "not at i".
  // The facts add nothing to the verdict: a loop accepted before is accepted now.

  /** The reads and the stores of the one loop of the one kernel function in `body`. */
  function facts(body: string): {
    reads: readonly LoopRead[];
    stores: readonly LoopStore[];
  } {
    const v = proof(body).loops[0]!;
    if (!v.ok) throw new Error(`refused: ${v.refusal.rule}`);
    return v;
  }
  const summary = (fs: readonly (LoopRead | LoopStore)[]): string =>
    fs
      .map(
        (r) => `${r.name}:${r.atI ? 'i' : 'not-i'}${'readBack' in r && r.readBack ? '+back' : ''}`,
      )
      .join(' ');

  it.each([
    [
      'two inputs at i',
      `export function add(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = a[i] + b[i]; }
}`,
      'a:i b:i',
    ],
    [
      'one input at i',
      `export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = max(x[i], 0.); }
}`,
      'x:i',
    ],
    [
      'a stencil: one read is not at i',
      `export function blur(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 1; i < out.length - 1; i++) { out[i] = t[i - 1] + t[i] + t[i + 1]; }
}`,
      't:not-i',
    ],
    [
      'a gather: the table is not read at i, the index array is',
      `export function gather(out: array<f32>, table: array<f32>, ix: array<u32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = table[ix[i]]; }
}`,
      'table:not-i ix:i',
    ],
    [
      'through a constant let',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { const j = i; out[i] = x[j]; }
}`,
      'x:i',
    ],
    [
      'through a cast',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = x[u32(i)]; }
}`,
      'x:i',
    ],
    [
      'i + 0 is i, i + 1 is not',
      `export function f(out: array<f32>, x: array<f32>, y: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = x[i + 0] + y[i + 1]; }
}`,
      'x:i y:not-i',
    ],
    [
      'a step of 2 reads at i',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i += 2) { out[i] = x[i]; }
}`,
      'x:i',
    ],
    [
      'a stride: 2 * i is not i',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = x[i * 2]; }
}`,
      'x:not-i',
    ],
    [
      'an element of a struct array',
      `class P { pos: vec4; }
export function f(out: array<P>, ps: array<P>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i].pos = ps[i].pos; }
}`,
      'ps:i',
    ],
    [
      'a shifted element of a struct array',
      `class P { pos: vec4; }
export function f(out: array<P>, ps: array<P>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i].pos = ps[i + 1].pos; }
}`,
      'ps:not-i',
    ],
    [
      'inside a nested loop, still at i',
      `export function f(out: array<f32>, x: array<f32>, w: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    let s = 0.;
    for (let k: u32 = 0; k < 4; k++) { s += x[i] * w[k]; }
    out[i] = s;
  }
}`,
      'x:i w:not-i',
    ],
    [
      'an array the loop writes is no read fact',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = out[i] + x[i]; }
}`,
      'x:i',
    ],
    [
      '.length reads no element',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = f32(x.length); }
}`,
      '',
    ],
    [
      'a scalar parameter is no array',
      `export function f(out: array<f32>, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = k; }
}`,
      '',
    ],
    [
      'an array indexed by a loop-invariant value',
      `export function f(out: array<f32>, x: array<f32>, n: u32) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = x[n]; }
}`,
      'x:not-i',
    ],
    [
      'the element of a for…of, read at its counter',
      `export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) { s += x; }
  return s;
}`,
      'xs:i',
    ],
  ])('a read-only array: %s', (_name, body, want) => {
    expect(summary(facts(body).reads)).toBe(want);
  });

  it('names the FIRST read that is not at i, and the line it is on', () => {
    const { reads } = facts(`export function blur(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i] + t[i + 1];
    out[i] = out[i] + t[i - 1];
  }
}`);
    const t = reads.find((r) => r.name === 't')!;
    expect(t.atI).toBe(false);
    // `t[i + 1]` comes before `t[i - 1]` in the source
    const place = t.first!.place;
    expect(place.op).toBe('index');
    expect(place.op === 'index' && place.idx.op === 'binop' && place.idx.bop).toBe('+');
    // zero-based: the fourth line of the source, after the directive and the two above it
    expect(t.first!.at?.line).toBe(3);
  });

  it('keeps the order the arrays are first read in', () => {
    const { reads } = facts(`export function f(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = b[i] + a[i]; }
}`);
    expect(summary(reads)).toBe('b:i a:i');
  });

  it.each([
    [
      'a write at i',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = x[i]; }
}`,
      'out:i',
    ],
    [
      'a write at i that reads the element back (R4)',
      `export function axpy(x: array<f32>, y: array<f32>) {
  for (let i: u32 = 0; i < y.length; i++) { y[i] = 2. * x[i] + y[i]; }
}`,
      'y:i+back',
    ],
    [
      'a write at i that adds to the element (op=), which reads it',
      `export function f(y: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < y.length; i++) { y[i] += x[i]; }
}`,
      'y:i+back',
    ],
    [
      'a write through a reference a call takes, which reads the element first',
      `function bump(@inout v: f32): void { v += 1.; }
export function inc(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { bump(out[i]); }
}`,
      'out:i+back',
    ],
    [
      'a write at i + 1',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length - 1; i++) { out[i + 1] = x[i]; }
}`,
      'out:not-i',
    ],
    [
      'a write at 2 * i, read back at 2 * i',
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) { out[2 * i] = x[i]; out[2 * i] += 1.; }
}`,
      'out:not-i+back',
    ],
    [
      'a write at i * k, which the call checks',
      `export function f(out: array<f32>, x: array<f32>, k: u32) {
  for (let i: u32 = 0; i < x.length; i++) { out[i * k] = x[i]; }
}`,
      'out:not-i',
    ],
    [
      'an element of a struct array, in place',
      `class P { pos: vec4; vel: vec4; }
export function step(ps: array<P>, dt: f32) {
  for (let i: u32 = 0; i < ps.length; i++) { ps[i].pos = ps[i].pos + ps[i].vel * dt; }
}`,
      'ps:i+back',
    ],
    [
      'two arrays, one at i and one not',
      `export function f(a: array<f32>, b: array<f32>, x: array<f32>) {
  for (let i: u32 = 1; i < x.length; i++) { a[i] = x[i]; b[i - 1] = x[i]; }
}`,
      'a:i b:not-i',
    ],
    [
      'a scatter at a computed index',
      `export function histogram(xs: array<f32>, bins: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { bins[u32(xs[i])] += 1; }
}`,
      'bins:not-i',
    ],
  ])('a written array: %s', (_name, body, want) => {
    expect(summary(facts(body).stores)).toBe(want);
  });

  it('names the first write that is not at i, and the line it is on', () => {
    const { stores } = facts(`export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) {
    out[2 * i + 1] = x[i];
    out[2 * i] = x[i];
  }
}`);
    const out = stores[0]!;
    expect(out.atI).toBe(false);
    // `out[2 * i + 1]` comes before `out[2 * i]` in the source
    const place = out.first!.place;
    expect(place.op).toBe('index');
    expect(place.op === 'index' && place.idx.op === 'binop' && place.idx.bop).toBe('+');
    expect(out.first!.at?.line).toBe(3);
  });

  it('agrees with the checks the lowering makes of each affine write', () => {
    // `checks` is what the call verifies against the array's length: a write at `a*i + c` per
    // c. The write is at exactly i when the one check of the array is `a = 1, c = 0`.
    const compiled = (body: string) => {
      const r = compile(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' });
      const f = r.module.funcs.find((x) => x.kernel === true)!;
      const p = proveKernels(r.module).find((x) => x.fn === f.name)!;
      const plan = lowerKernel(f, r.module, p);
      if ('noGpu' in plan) throw new Error(plan.noGpu);
      const v = p.loops[0]!;
      if (!v.ok) throw new Error('refused');
      return { checks: plan.loops[0]!.checks, stores: v.stores };
    };
    for (const index of ['i', 'i + 1', '2 * i', '3 * i + 2', 'i * 1', '1 * i + 0']) {
      const { checks, stores } = compiled(`export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < x.length; i++) { out[${index}] = x[i]; }
}`);
      const atI = checks.length === 1 && checks[0]!.a === 1 && checks[0]!.c === 0;
      expect([index, stores[0]!.atI]).toEqual([index, atI]);
    }
  });

  it('records a reduction loop as the loop it is: what it reads, and no store', () => {
    const total = facts(`export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) { s += x; }
  return s;
}`);
    expect([summary(total.reads), summary(total.stores)]).toEqual(['xs:i', '']);
    const stats = facts(`export function stats(xs: array<f32>, out: array<f32>): f32 {
  let s = 0.;
  let m = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i] * 2.;
    s += xs[i];
    m = max(m, xs[i]);
  }
  return s / f32(xs.length) + m;
}`);
    expect([summary(stats.reads), summary(stats.stores)]).toEqual(['xs:i', 'out:i']);
  });

  it('adds a fact and refuses nothing: a loop that was accepted is still accepted', () => {
    const v = proof(`export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = x[i + 1]; }
}`).loops[0]!;
    expect(v.ok).toBe(true);
  });
});
