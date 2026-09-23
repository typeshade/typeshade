import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { typeKey } from '../../core/ir/types.js'

describe('ternary / index / for / while', () => {
  it('lowers cond ? a : b to select', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(c: bool, a: f32, b: f32): f32 {
        return c ? a : b;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('select')
  })

  it('lowers v[i] to index', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: vec3, i: i32): f32 {
        return v[i];
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('index')
  })

  it('lowers for (let i: i32 = 0; i < n; i++)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(n: i32): i32 {
        let acc: i32 = 0;
        for (let i: i32 = 0; i < n; i++) {
          acc = acc + i;
        }
        return acc;
      }
    `)
    // A runtime bound is a counted loop (Rule 7.5, #203): the header is emitted as written.
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const loop = r.funcs[0]!.body.find((s) => s.s === 'for')
    expect(loop?.s === 'for' && loop.cond.op === 'compare' && loop.cond.b.op).toBe('param')
  })

  it('lowers while to a for with the same condition', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(n: i32): i32 {
        let i: i32 = 0;
        while (i < n) {
          i++;
        }
        return i;
      }
    `)
    // An open loop (Rule 7.5): the condition is kept, and the counter the IR's one loop form
    // needs is an i32 whatever the condition compares.
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const loop = r.funcs[0]!.body.find((s) => s.s === 'for')
    expect(loop?.s === 'for' && loop.cond.op === 'compare' && loop.cond.b.op).toBe('param')
    expect(loop?.s === 'for' && loop.init.s === 'var' && typeKey(loop.init.type)).toBe('i32')
  })

  it('rejects break outside a loop', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        break;
      }
    `)
    expect(r.diagnostics.some((d) => /break/.test(d.message))).toBe(true)
  })

  it('emits WGSL for a ternary helper', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(c: bool, a: f32, b: f32): f32 {
        return c ? a : b;
      }
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toBeTruthy()
    expect(r.wgsl).toMatch(/fn pick/)
    expect(r.wgsl).toMatch(/select\(/)
  })
})
