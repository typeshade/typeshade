import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { typeKey } from '../../core/ir/types.js'

describe('advance: construct, member, same-file call, PI', () => {
  it('lowers PI as f32 lit', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 { return PI; }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr) {
      expect(ret.expr.op).toBe('lit')
    }
  })

  it('constructs vec3 and reads .x', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): f32 {
        const v = vec3(a, 0, 1);
        return v.x;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const body = r.funcs[0]!.body
    expect(body[0]!.s).toBe('let')
    if (body[0]!.s === 'let') expect(body[0].expr.op).toBe('construct')
    if (body[1]!.s === 'return' && body[1].expr) {
      expect(body[1].expr.op).toBe('member')
      if (body[1].expr.op === 'member') {
        expect(body[1].expr.field).toBe('x')
        expect(typeKey(body[1].expr.type)).toBe('f32')
      }
    }
  })

  it('swizzles vec3.xy to vec2', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32): vec2 {
        const v = vec3(a, a, a);
        return v.xy;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[1]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'member') {
      expect(ret.expr.field).toBe('xy')
      expect(typeKey(ret.expr.type)).toBe('vec2<f32>')
    }
  })

  it('splats vec3(1)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): vec3 {
        return vec3(1);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'construct') {
      expect(ret.expr.args).toHaveLength(3)
    }
  })

  it('same-file call uses declRef and matches arity', () => {
    const r = compileTsSource(`
      "use typeshade";
      function square(x: f32): f32 { return x * x; }
      export function foo(x: f32): f32 { return square(x) + 1; }
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.funcs.map((f) => f.name)).toEqual(['square', 'foo'])
    const ret = r.funcs[1]!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop') {
      expect(ret.expr.a.op).toBe('call')
      if (ret.expr.a.op === 'call') {
        expect(ret.expr.a.fn).toBe('square')
        expect(ret.expr.a.declRef?.name).toBe('square')
      }
    }
  })

  it('forward call to a function declared later', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function foo(x: f32): f32 { return bar(x); }
      function bar(x: f32): f32 { return x; }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'call') {
      expect(ret.expr.fn).toBe('bar')
      expect(ret.expr.declRef?.name).toBe('bar')
    }
  })

  it('rejects wrong arity on user call', () => {
    const r = compileTsSource(`
      "use typeshade";
      function square(x: f32): f32 { return x * x; }
      export function foo(x: f32): f32 { return square(x, x); }
    `)
    expect(r.diagnostics.some((d) => /expects 1/.test(d.message))).toBe(true)
  })
})
