import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { resolveMathExpand, isCanonicalMathFn } from './math-alias.js'

describe('missing Math + shader free math', () => {
  it('classifies expansions and free names', () => {
    expect(resolveMathExpand('log10')).toBe('log10')
    expect(resolveMathExpand('hypot')).toBe('hypot')
    expect(isCanonicalMathFn('clamp')).toBe(true)
    expect(isCanonicalMathFn('length')).toBe(true)
    expect(isCanonicalMathFn('inverseSqrt')).toBe(true)
  })

  it('log10(x) expands to log(x) * LOG10E', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 { return log10(x); }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop') {
      expect(ret.expr.bop).toBe('*')
      if (ret.expr.a.op === 'call') expect(ret.expr.a.fn).toBe('log')
    }
  })

  it('Math.log10 === log10', () => {
    const a = compileTsSource(`"use typeshade"; export function f(x: f32): f32 { return log10(x); }`)
    const b = compileTsSource(`"use typeshade"; export function f(x: f32): f32 { return Math.log10(x); }`)
    expect(a.diagnostics).toEqual([])
    expect(b.diagnostics).toEqual([])
    expect(a.funcs[0]!.body).toEqual(b.funcs[0]!.body)
  })

  it('cbrt(x) expands to pow(x, 1/3)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 { return Math.cbrt(x); }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call') expect(ret.expr.fn).toBe('pow')
  })

  it('hypot(a,b) expands to length(vec2)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): f32 { return hypot(a, b); }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call') expect(ret.expr.fn).toBe('length')
  })

  it('clamp / mix / length are free functions', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32, uv: vec2): f32 {
        const a = clamp(x, 0, 1);
        const b = mix(a, 1, 0.5);
        return length(uv) + b;
      }
    `)
    expect(r.diagnostics).toEqual([])
  })

  it('log1p / expm1 expand', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 { return log1p(x) + expm1(x); }
    `)
    expect(r.diagnostics).toEqual([])
  })
})
