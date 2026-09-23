// ═══ Determinism report (roadmap 0.7 item 22) ═══
//
// Three things are pinned. The report lists exactly the operations WGSL §15.7.4 lets differ by
// driver (and the ones the GLSL ES 3.00 spelling may answer differently), with the spec's
// bound, count and sites, in first-appearance order, and nothing for a module whose every
// operation has one answer. Emulated doubles are their own kind and integer arithmetic is
// never listed. And `accuracyOf` places EVERY id the compiler can emit, so a new builtin
// cannot be added without deciding which column it belongs in.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { INTRINSICS, PORTABLE_INTRINSICS } from '../intrinsics.js';
import { BUILTINS } from '../cpu-runtime.js';
import { accuracyOf, determinismReport } from './determinism.js';

function moduleOf(source: string) {
  const r = compile(source);
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  expect(errors, errors.map((d) => `${d.line}:${d.character} ${d.message}`).join('\n')).toEqual([]);
  return r;
}

const rows = (r: ReturnType<typeof compile>) =>
  r.determinism.map((e) => [e.op, e.elem, e.kind, e.count, e.where]);

describe('determinismReport', () => {
  it('is empty for a module whose every operation is correctly rounded or exact', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32, b: f32, n: i32, v: vec3): f32 {
  const q: i32 = n / 3;
  const w: vec3 = v * 2. + abs(v);
  return abs(a) + floor(b) * 2. - min(a, b) + clamp(a, 0., 1.) + f32(q) + w.x + step(0.5, a);
}`);
    expect(r.determinism).toEqual([]);
    expect(determinismReport(r.module)).toEqual([]);
  });

  it('lists each bounded operation once with the spec bound, its count and its sites, in first-appearance order', () => {
    const r = moduleOf(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;

class Color {
  @location(0) color: vec4;
}

function shade(x: f32, y: f32): f32 {
  return sin(x) / y + fma(x, y, 1.);
}

@fragment
export function fs(@location(0) uv: vec2): Color {
  const s: f32 = shade(uv.x, uv.y) + Math.sin(uv.x);
  const d: f32 = dpdx(uv.x);
  const t: vec4 = textureSample(tex, smp, uv);
  return { color: t * s + d };
}`);
    // Pre-order over each statement's expression: the outer `/` is met before the `sin`
    // inside it, and `shade` (a call to the module's own helper) is not a row.
    expect(rows(r)).toEqual([
      ['/', 'f32', 'ulp', 1, ['shade']],
      ['sin', 'f32', 'absolute', 2, ['shade', 'fs']],
      ['fma', 'f32', 'inherited', 1, ['shade']],
      ['dpdx', 'f32', 'unbounded', 1, ['fs']],
      ['textureSample', 'f32', 'filtered', 1, ['fs']],
    ]);
    const by = (op: string) => r.determinism.find((e) => e.op === op)!;
    expect(by('sin').accuracy).toBe('2^-11 absolute error for x in [-π, π]');
    expect(by('/').accuracy).toBe('2.5 ULP for a divisor with magnitude in [2^-126, 2^126]');
    expect(by('fma').accuracy).toBe('inherited from x * y + z');
    expect(by('fma').note).toMatch(/GLSL ES 3\.00 has no fma/);
    expect(by('sin').note).toBeUndefined();
    expect(by('textureSample').accuracy).toMatch(/implementation-defined/);
  });

  it('counts every occurrence, in a condition, a loop header or an assignment as much as in a let', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32, b: f32): f32 {
  let x: f32 = sin(a) + sin(b);
  if (sin(a) > 0.) {
    x = exp(a) + sqrt(a);
  }
  for (let i: i32 = 0; i < 4; i++) {
    x += pow(a, 2.);
  }
  return x;
}`);
    expect(rows(r)).toEqual([
      ['sin', 'f32', 'absolute', 3, ['f']],
      ['exp', 'f32', 'ulp', 1, ['f']],
      ['sqrt', 'f32', 'inherited', 1, ['f']],
      ['pow', 'f32', 'inherited', 1, ['f']],
    ]);
  });

  it('lists a vector builtin and the matrix products, which are sums of products and not the component-wise star', () => {
    const r = moduleOf(`"use typeshade";
export function xform(m: mat4, p: vec4, n: vec3, k: f32): vec4 {
  const unit: vec3 = normalize(n);
  const twice: mat4 = m * m;
  return twice * p + vec4(unit, 1.) * k;
}`);
    expect(rows(r)).toEqual([
      ['normalize', 'f32', 'inherited', 1, ['xform']],
      ['mat * mat', 'f32', 'inherited', 1, ['xform']],
      ['mat * vec', 'f32', 'inherited', 1, ['xform']],
    ]);
    expect(r.determinism[1]!.accuracy).toBe(
      'inherited from the matrix product, each element a sum of products',
    );
    expect(r.determinism[2]!.accuracy).toBe(
      'inherited from dot(transpose(m)[i], v) for component i',
    );
  });

  it('reads a module constant initializer, attributed to the constant', () => {
    const r = moduleOf(`"use typeshade";
const K: f32 = sin(1.);
export function f(a: f32): f32 {
  return a * K;
}`);
    expect(rows(r)).toEqual([['sin', 'f32', 'absolute', 1, ['K']]]);
  });

  it('lists emulated f64 arithmetic, floor and the bounded builtins as their own kind, and keeps abs exact on a double', () => {
    const r = moduleOf(`"use typeshade";
export function g(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  const y: f64 = f64(b);
  const z: f64 = floor(x) + fract(y);
  return f32(abs(x * y + sqrt(x)) + z);
}`);
    expect(rows(r).map((row) => row.slice(0, 3))).toEqual([
      ['+', 'f64', 'emulated'],
      ['floor', 'f64', 'emulated'],
      ['fract', 'f64', 'emulated'],
      ['*', 'f64', 'emulated'],
      ['sqrt', 'f64', 'emulated'],
    ]);
    for (const e of r.determinism) expect(e.accuracy).toMatch(/^emulated double/);
  });

  it('separates the f32 and f64 uses of one operation into two rows', () => {
    const r = moduleOf(`"use typeshade";
export function h(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  return a / b + f32(x / f64(b));
}`);
    expect(rows(r).map((row) => row.slice(0, 3))).toEqual([
      ['/', 'f32', 'ulp'],
      ['/', 'f64', 'emulated'],
    ]);
  });

  it('lists fract as inherited, with the tiny negative case in the bound', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32): f32 {
  return fract(a);
}`);
    expect(rows(r)).toEqual([['fract', 'f32', 'inherited', 1, ['f']]]);
    expect(r.determinism[0]!.accuracy).toMatch(/1 - 2\^-24 for a tiny negative x/);
  });

  it('lists a gather as filtered, and no longer lists ldexp at all', () => {
    // `ldexp` WAS a `target` row here, on a GLSL spelling that built 2^e from one biased
    // exponent and gave +Inf at e = 128 (#141). The spelling now builds it in two halves, and
    // a sweep of every legal exponent, -149 to 128, found the GLSL and WGSL answers identical
    // for x = 1.0 and x = 0.75 — 278 of 278, where the old one missed 22. An operation with one
    // answer on both targets does not belong in this report, so the row is gone and the gather
    // is the only one left.
    const r = moduleOf(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;
export function f(uv: vec2, c: vec4): vec4 {
  const scaled: f32 = ldexp(c.x, 3);
  return textureGather(0, tex, smp, uv) * scaled;
}`);
    expect(rows(r).map((row) => row.slice(0, 3))).toEqual([['textureGather', 'f32', 'filtered']]);
    expect(r.determinism[0]!.accuracy).toMatch(/which four/);
  });

  it("never lists integer arithmetic, comparisons or a call to the module's own helper", () => {
    const r = moduleOf(`"use typeshade";
function twice(n: u32): u32 {
  return n * 2;
}
export function k(a: i32, b: i32, n: u32): i32 {
  const m: u32 = (twice(n) / 3) % 5;
  return select(a / b, a % b, a < b) + i32(m);
}`);
    expect(r.determinism).toEqual([]);
  });

  it('is computed on the partial module when the front end reports an error', () => {
    const r = compile(`"use typeshade";
export function ok(a: f32): f32 {
  return sin(a);
}
export function bad(a: f32): f32 {
  return nonsense(a);
}`);
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true);
    expect(r.wgsl).toBeUndefined();
    expect(r.determinism.map((e) => e.op)).toContain('sin');
  });
});

describe('accuracyOf', () => {
  const everyId = [
    ...Object.keys(INTRINSICS),
    ...PORTABLE_INTRINSICS,
    ...Object.keys(BUILTINS),
    '+',
    '-',
    '*',
    '/',
    '%',
    '&',
    '|',
    '^',
    '<<',
    '>>',
    'mat * vec',
    'vec * mat',
    'mat * mat',
  ];

  it('places every id the compiler can emit in the exact column or in the table (a new builtin must choose)', () => {
    const unplaced = everyId.filter((id) => accuracyOf(id) === undefined);
    expect(
      unplaced,
      'add each to F32_ACCURACY, EXACT_OPS or EXACT_PREFIXES in determinism.ts',
    ).toEqual([]);
  });

  it('answers exact for the operations const-fold folds except fract, and a bound for the rest', () => {
    for (const op of [
      'abs',
      'floor',
      'ceil',
      'trunc',
      'round',
      'sign',
      'min',
      'max',
      'clamp',
      'saturate',
      'step',
      '+',
      '-',
      '*',
    ]) {
      expect(accuracyOf(op), op).toEqual({ kind: 'exact' });
    }
    expect(accuracyOf('fract')?.kind).toBe('inherited');
    expect(accuracyOf('sin')?.kind).toBe('absolute');
    expect(accuracyOf('exp')?.kind).toBe('ulp');
    expect(accuracyOf('pow')?.kind).toBe('inherited');
    expect(accuracyOf('mat * vec')?.kind).toBe('inherited');
    expect(accuracyOf('determinant')?.kind).toBe('unbounded');
    expect(accuracyOf('textureSampleCompareLevelArray')?.kind).toBe('filtered');
    expect(accuracyOf('textureGather')?.kind).toBe('filtered');
    // `ldexp` left the `target` column with #141: the GLSL scale is built in two halves now,
    // and a sweep of every legal exponent found the two targets identical on all 278.
    expect(accuracyOf('ldexp')?.kind).toBe('exact');
    expect(accuracyOf('pack2x16snorm')?.kind).toBe('target');
    expect(accuracyOf('pack2x16float')?.kind).toBe('exact');
    expect(accuracyOf('textureLoad')?.kind).toBe('exact');
    expect(accuracyOf('atomicAdd')?.kind).toBe('exact');
    expect(accuracyOf('no-such-builtin')).toBeUndefined();
  });
});

// The rows #150 added, pinned by VALUE rather than only by "is placed somewhere": both are
// load-bearing claims in §44 and the CHANGELOG, and the structural test above only forces a new
// id into one column or the other, not into the right one.
describe('the pack and quantize rows say what the emitted code actually does', () => {
  it('quantizeToF16 is a target row at every width, with the reason in the note', () => {
    for (const id of [
      'quantizeToF16',
      'quantizeToF16Vec2',
      'quantizeToF16Vec3',
      'quantizeToF16Vec4',
    ]) {
      const a = accuracyOf(id)!;
      expect(a.kind, id).toBe('target');
      // WGSL settles the conversion; the GLSL half round trip does not pin its rounding.
      expect('note' in a && a.note, id).toMatch(/packHalf2x16/);
      // The three measured divergences, not just the tie.
      expect('note' in a && a.note, id).toMatch(/halfway/);
      expect('note' in a && a.note, id).toMatch(/NaN/);
      expect('note' in a && a.note, id).toMatch(/subnormal/);
    }
  });

  it('lists a pack, whose float kind is the one it READS', () => {
    // Every `pack` row was unreachable. The walk takes a node's float kind from its RESULT
    // type, and a pack answers a `u32` of bytes, so `floatElemOf` returned `undefined` and the
    // node was dropped before `accuracyOf` was asked — four `target` rows, two of them older
    // than the 4x8 pair, describing a divergence the report could not report. Measured before
    // the fix, this module reported an EMPTY list.
    const r = moduleOf(`"use typeshade";
declare let out: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = pack4x8unorm(vec4(0.5, 0.5, 0.5, 0.5));
  out[1] = pack4x8snorm(vec4(0.5, 0.5, 0.5, 0.5));
  out[2] = pack2x16unorm(vec2(0.5, 0.5));
  out[3] = pack2x16snorm(vec2(0.5, 0.5));
}`);
    expect(r.determinism.map((e) => [e.op, e.elem, e.kind])).toEqual([
      ['pack4x8unorm', 'f32', 'target'],
      ['pack4x8snorm', 'f32', 'target'],
      ['pack2x16unorm', 'f32', 'target'],
      ['pack2x16snorm', 'f32', 'target'],
    ]);
    // `every` on the list above would be vacuously true on an empty one, and `toEqual` already
    // pins the whole list, so the claim worth adding here is the one the list cannot make: the
    // INTEGER work beside the packs — the `u32` stores and the index arithmetic — is still not
    // listed, which is what keeps this from being "report anything with a float argument".
    expect(r.determinism.map((e) => e.op)).not.toContain('*');
    expect(r.determinism.map((e) => e.op)).not.toContain('+');
  });

  // #175: the same "the result type hides the row" drop the packs just left behind, on the one
  // operation where the pass cannot fix it. `accuracyOf` gives every `textureGather*` id the
  // `filtered` row, and that row is about WHICH four texels the footprint selects — which is
  // implementation-defined whatever the texture's element. But a gather on a `texture_2d<u32>`
  // answers a `vec4<u32>`, and `DeterminismEntry.elem` is the public `'f32' | 'f64'`, so there
  // is no float kind to report it under. Measured: the f32 texture lists the row, the u32 and
  // i32 ones list nothing. Closing it means widening an exported union, which is a decision
  // about the report's shape and not a fix inside this pass.
  it.fails('#175: a gather on an integer texture is filtered too, and is not listed', () => {
    const r = moduleOf(`"use typeshade";
declare const tex: texture_2d<u32>;
declare const smp: sampler;
declare let out: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = textureGather(0, tex, smp, vec2(0.5, 0.5)).x;
}`);
    expect(r.determinism.map((e) => [e.op, e.kind])).toEqual([['textureGather', 'filtered']]);
  });

  it('both 4x8 packs are target rows: a driver rounds the exact half to even', () => {
    // `pack4x8unorm` was promoted to `exact` on a measurement that only holds when Tint
    // CONST-EVALUATES the call. Swept at RUNTIME over 511 inputs e = i/510, a WGSL driver and
    // the GLSL inline parted on 34 of them — i = 1 packs 0 on WGSL and 1 on GLSL, i = 5 packs
    // 2 and 3 — and a WGSL-only self-check, one shader computing both the builtin and
    // `floor(0.5 + 255 * e)`, disagrees with ITSELF on the same 34. So the driver rounds the
    // tie to even while the inline, and WGSL's own written rule, round it up. The CPU oracle
    // sides with GLSL — it rounds the scale in f32, the way both targets do (see the oracle's
    // own test) — so on those 34 it answers what a WebGL2 driver answers and not what a WGSL
    // driver answers, which is exactly the oracle/GPU equality `exact` is supposed to promise
    // and cannot here.
    //
    // The lesson is the const/runtime split: a constant argument is folded by the shader
    // compiler and answers its own way, so a measurement taken on literals says nothing about
    // the instruction a driver issues. The same split was already visible in this lane on
    // `ldexp(1.0, -149)`, const-evaluated to a subnormal and flushed to zero at runtime.
    for (const id of ['pack4x8unorm', 'pack4x8snorm']) {
      const a = accuracyOf(id)!;
      expect(a.kind, id).toBe('target');
      expect('note' in a && a.note, id).toMatch(/half|even/);
    }

    // The 2x16 packs are NATIVE GLSL builtins, defined with round(), so no spelling of ours
    // can reach them and they stay `target` on the mechanism the unorm row just left behind.
    for (const id of ['pack2x16unorm', 'pack2x16snorm']) {
      const a = accuracyOf(id)!;
      expect(a.kind, id).toBe('target');
      expect('note' in a && a.note, id).toMatch(/round\(\)/);
    }
  });
});
