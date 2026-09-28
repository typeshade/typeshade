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
import { proveKernels, type KernelProof } from './parallel-loop.js';

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
