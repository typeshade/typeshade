import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { typeKey } from '../../core/ir/types.js'
import { parseSwizzle } from './swizzle.js'
import { vec2fT, vec3fT, vec4fT, f32T } from '../../core/ir/types.js'

describe('swizzle', () => {
  it('parses .yx and rejects mix/range', () => {
    const ok = parseSwizzle(vec3fT, 'yx')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(typeKey(ok.type)).toBe('vec2<f32>')
    expect(parseSwizzle(vec2fT, 'z').ok).toBe(false)
    expect(parseSwizzle(vec3fT, 'xg').ok).toBe(false)
    expect(parseSwizzle(f32T, 'x').ok).toBe(false)
  })

  it('allows .xx duplicate and .rgba on vec4', () => {
    const xx = parseSwizzle(vec2fT, 'xx')
    expect(xx.ok).toBe(true)
    const rgba = parseSwizzle(vec4fT, 'rgba')
    expect(rgba.ok).toBe(true)
    if (rgba.ok) expect(typeKey(rgba.type)).toBe('vec4<f32>')
  })

  it('lowers v.swizzle("yxz") to member', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): vec3 {
        const v = vec3(a, 1, 2);
        return v.swizzle("yxz");
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[1]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'member') {
      expect(ret.expr.field).toBe('yxz')
      expect(typeKey(ret.expr.type)).toBe('vec3<f32>')
    }
  })

  it('diagnoses mixed swizzle in source', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): f32 {
        const v = vec3(a, 1, 2);
        return v.xg;
      }
    `)
    expect(r.diagnostics.some((d) => /mixes xyzw and rgba/.test(d.message))).toBe(true)
  })
})

describe('random(seed)', () => {
  it('lowers random(x) to fract(sin(x)*k)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 {
        return random(x);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr) {
      expect(ret.expr.op).toBe('call')
      if (ret.expr.op === 'call') expect(ret.expr.fn).toBe('fract')
    }
  })

  it('lowers random(uv) via dot', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(uv: vec2): f32 {
        return random(uv);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call') {
      expect(ret.expr.fn).toBe('fract')
    }
  })

  it('Math.random(x) aliases random(x)', () => {
    const a = compileTsSource(`"use typeshade"; export function f(x: f32): f32 { return random(x); }`)
    const b = compileTsSource(`"use typeshade"; export function f(x: f32): f32 { return Math.random(x); }`)
    expect(a.diagnostics).toEqual([])
    expect(b.diagnostics).toEqual([])
    expect(a.funcs[0]!.body).toEqual(b.funcs[0]!.body)
  })

  it('rejects argument-less random()', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 { return random(); }
    `)
    expect(r.diagnostics.some((d) => /seed/.test(d.message))).toBe(true)
  })
})
