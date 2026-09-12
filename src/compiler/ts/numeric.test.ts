import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { typeKey } from '../../core/ir/types.js'

describe('i32 / u32 mixed arithmetic', () => {
  it('rejects i32 + u32 with an explicit-cast hint', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: i32, b: u32): i32 {
        return a + b;
      }
    `)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics[0]!.message).toMatch(/i32 and u32/)
    expect(r.diagnostics[0]!.message).toMatch(/i32\(|u32\(/)
  })

  it('rejects i32 * u32 the same way', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: i32, b: u32): i32 {
        return a * b;
      }
    `)
    expect(r.diagnostics[0]!.message).toMatch(/no implicit integer conversion/)
  })

  it('accepts a + i32(b)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: i32, b: u32): i32 {
        return a + i32(b);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop') {
      expect(ret.expr.b.op).toBe('call')
      if (ret.expr.b.op === 'call') expect(ret.expr.b.fn).toBe('i32')
    }
  })

  it('accepts u32(a) + b', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: i32, b: u32): u32 {
        return u32(a) + b;
      }
    `)
    expect(r.diagnostics).toEqual([])
  })

  it('i32(1) is a typed integer lit', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        return i32(1) + i32(2);
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop') {
      expect(ret.expr.a.op).toBe('lit')
      if (ret.expr.a.op === 'lit') expect(typeKey(ret.expr.a.type)).toBe('i32')
    }
  })

  it('let a: i32 = 1 then add u32 needs a cast', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(b: u32): i32 {
        const a: i32 = 1;
        return a + b;
      }
    `)
    expect(r.diagnostics.some((d) => /i32 and u32/.test(d.message))).toBe(true)
  })

  it('rejects i32 + f32 without cast', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: i32, x: f32): f32 {
        return a + x;
      }
    `)
    expect(r.diagnostics[0]!.message).toMatch(/int\/float|f32/)
  })
})
