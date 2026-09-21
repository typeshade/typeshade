// ═══ Determinism report (roadmap 0.7 item 22) ═══
//
// Three things are pinned. The report lists exactly the operations WGSL §15.7.4 lets differ by
// driver, with the spec's bound, count and functions, in first-appearance order, and nothing
// for a module whose every operation has one answer. Emulated doubles are their own kind and
// integer arithmetic is never listed. And `accuracyOf` places EVERY id the compiler can emit,
// so a new builtin cannot be added without deciding which column it belongs in.

import { describe, expect, it } from 'vitest'
import { compile } from '../../compiler/ts/compile.js'
import { INTRINSICS, PORTABLE_INTRINSICS } from '../intrinsics.js'
import { BUILTINS } from '../cpu-runtime.js'
import { accuracyOf, determinismReport } from './determinism.js'

function moduleOf(source: string) {
  const r = compile(source)
  const errors = r.diagnostics.filter((d) => d.category === 'error')
  expect(errors, errors.map((d) => `${d.line}:${d.character} ${d.message}`).join('\n')).toEqual([])
  return r
}

describe('determinismReport', () => {
  it('is empty for a module whose every operation is correctly rounded or exact', () => {
    const r = moduleOf(`"use typeshade";
export function f(a: f32, b: f32, n: i32): f32 {
  const q: i32 = n / 3;
  return abs(a) + floor(b) * 2. - min(a, b) + clamp(a, 0., 1.) + f32(q) + fract(a);
}`)
    expect(r.determinism).toEqual([])
    expect(determinismReport(r.module)).toEqual([])
  })

  it('lists each bounded operation once with the spec bound, its count and its functions, in first-appearance order', () => {
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
}`)
    const rows = r.determinism
    expect(rows.map((e) => [e.op, e.elem, e.kind, e.count, e.functions])).toEqual([
      ['sin', 'f32', 'absolute', 2, ['shade', 'fs']],
      ['/', 'f32', 'ulp', 1, ['shade']],
      ['fma', 'f32', 'inherited', 1, ['shade']],
      ['dpdx', 'f32', 'unbounded', 1, ['fs']],
      ['textureSample', 'f32', 'filtered', 1, ['fs']],
    ])
    const by = (op: string) => rows.find((e) => e.op === op)!
    expect(by('sin').accuracy).toBe('2^-11 absolute error for x in [-π, π]')
    expect(by('/').accuracy).toBe('2.5 ULP for a divisor with magnitude in [2^-126, 2^126]')
    expect(by('fma').accuracy).toBe('inherited from x * y + z')
    expect(by('fma').note).toMatch(/GLSL ES 3\.00 has no fma/)
    expect(by('sin').note).toBeUndefined()
    expect(by('textureSample').accuracy).toMatch(/implementation-defined/)
  })

  it('lists emulated f64 arithmetic and builtins as their own kind, and keeps the exact builtins exact on a double', () => {
    const r = moduleOf(`"use typeshade";
export function g(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  const y: f64 = f64(b);
  return f32(abs(x * y + sqrt(x)));
}`)
    expect(r.determinism.map((e) => [e.op, e.elem, e.kind])).toEqual([
      ['*', 'f64', 'emulated'],
      ['sqrt', 'f64', 'emulated'],
      ['+', 'f64', 'emulated'],
    ])
    for (const e of r.determinism) expect(e.accuracy).toMatch(/^emulated double/)
  })

  it('separates the f32 and f64 uses of one operation into two rows', () => {
    const r = moduleOf(`"use typeshade";
export function h(a: f32, b: f32): f32 {
  const x: f64 = f64(a);
  return a / b + f32(x / f64(b));
}`)
    expect(r.determinism.map((e) => [e.op, e.elem, e.kind])).toEqual([
      ['/', 'f32', 'ulp'],
      ['/', 'f64', 'emulated'],
    ])
  })

  it("never lists integer arithmetic, comparisons or a call to the module's own helper", () => {
    const r = moduleOf(`"use typeshade";
function twice(n: u32): u32 {
  return n * 2;
}
export function k(a: i32, b: i32, n: u32): i32 {
  const m: u32 = (twice(n) / 3) % 5;
  return select(a / b, a % b, a < b) + i32(m);
}`)
    expect(r.determinism).toEqual([])
  })

  it('is computed on the partial module when the front end reports an error', () => {
    const r = compile(`"use typeshade";
export function ok(a: f32): f32 {
  return sin(a);
}
export function bad(a: f32): f32 {
  return nonsense(a);
}`)
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true)
    expect(r.wgsl).toBeUndefined()
    expect(r.determinism.map((e) => e.op)).toContain('sin')
  })
})

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
  ]

  it('places every id the compiler can emit in the exact column or in the table (a new builtin must choose)', () => {
    const unplaced = everyId.filter((id) => accuracyOf(id) === undefined)
    expect(
      unplaced,
      'add each to F32_ACCURACY, EXACT_OPS or EXACT_PREFIXES in determinism.ts',
    ).toEqual([])
  })

  it('answers exact for the operations const-fold folds, and a bound for the transcendentals', () => {
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
      'fract',
      'step',
      '+',
      '-',
      '*',
    ]) {
      expect(accuracyOf(op), op).toEqual({ kind: 'exact' })
    }
    expect(accuracyOf('sin')?.kind).toBe('absolute')
    expect(accuracyOf('exp')?.kind).toBe('ulp')
    expect(accuracyOf('pow')?.kind).toBe('inherited')
    expect(accuracyOf('determinant')?.kind).toBe('unbounded')
    expect(accuracyOf('textureSampleCompareLevelArray')?.kind).toBe('filtered')
    expect(accuracyOf('textureGather')?.kind).toBe('exact')
    expect(accuracyOf('textureLoad')?.kind).toBe('exact')
    expect(accuracyOf('atomicAdd')?.kind).toBe('exact')
    expect(accuracyOf('no-such-builtin')).toBeUndefined()
  })
})
