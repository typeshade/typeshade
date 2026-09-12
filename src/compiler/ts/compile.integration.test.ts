// End-to-end: "use typeshade" source -> FuncDecl (Phase 1-5)

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { typeKey } from '../../core/ir/types.js'

describe('compileTsSource integration', () => {
  it('lowers the Phase-1 milestone transform function', () => {
    const source = `
      "use typeshade";
      export function transform(a: f32, b: f32): f32 {
        const x = a + b;
        return x * 2;
      }
    `
    const result = compileTsSource(source)
    expect(result.hasDirective).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.funcs).toHaveLength(1)

    const fn = result.funcs[0]!
    expect(fn.name).toBe('transform')
    expect(fn.params).toHaveLength(2)
    expect(fn.params[0]!.name).toBe('a')
    expect(typeKey(fn.params[0]!.type)).toBe('f32')
    expect(typeKey(fn.ret)).toBe('f32')
    expect(fn.body.length).toBe(2)
    expect(fn.body[0]!.s).toBe('let')
    expect(fn.body[1]!.s).toBe('return')
    if (fn.body[0]!.s === 'let') {
      expect(fn.body[0].expr.op).toBe('binop')
    }
    if (fn.body[1]!.s === 'return' && fn.body[1].expr) {
      expect(fn.body[1].expr.op).toBe('binop')
    }
  })

  it('lowers assignment and if', () => {
    const source = `
      "use typeshade";
      export function step(x: f32, flag: bool): f32 {
        let y = x;
        if (flag) {
          y = y + 1;
        }
        return y;
      }
    `
    const result = compileTsSource(source)
    expect(result.diagnostics).toEqual([])
    expect(result.funcs).toHaveLength(1)
    const body = result.funcs[0]!.body
    expect(body.some((s) => s.s === 'var')).toBe(true)
    expect(body.some((s) => s.s === 'if')).toBe(true)
    expect(body.some((s) => s.s === 'return')).toBe(true)
  })

  it('reports diagnostics for bad types without throwing', () => {
    const source = `
      "use typeshade";
      export function bad(a: string): f32 {
        return 1;
      }
    `
    const result = compileTsSource(source)
    expect(result.hasDirective).toBe(true)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('returns empty funcs when directive is absent', () => {
    const result = compileTsSource('export function f(): void {}')
    expect(result.hasDirective).toBe(false)
    expect(result.funcs).toEqual([])
  })
})
