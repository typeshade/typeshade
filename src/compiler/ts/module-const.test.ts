import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

describe('module const', () => {
  it('folds LIMIT: i32 = 16 to a module ConstDecl + constref', () => {
    const r = compileTsSource(`
      "use typeshade";
      const LIMIT: i32 = 16;
      export function f(): i32 { return LIMIT; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.consts[0]?.name).toBe('LIMIT')
    expect(r.consts[0]?.cpuValue).toBe(16)
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('constref')
    expect(r.wgsl).toMatch(/const LIMIT/)
  })

  it('folds const expressions and later consts', () => {
    const r = compileTsSource(`
      "use typeshade";
      const A: i32 = 4;
      const B: i32 = A + A;
      export function f(): i32 { return B; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.consts.map((c) => c.cpuValue)).toEqual([4, 8])
  })

  it('lets two functions read the same module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const GAIN: f32 = 2.;
      export function a(x: f32): f32 { return x * GAIN; }
      export function b(x: f32): f32 { return x + GAIN; }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs).toHaveLength(2)
  })

  it('rejects assigning to a module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const LIMIT: i32 = 16;
      export function f(): i32 {
        LIMIT = 1;
        return LIMIT;
      }
    `)
    expect(r.diagnostics.some((d) => /const|immutable|assign/i.test(d.message))).toBe(true)
  })

  it('rejects a non-foldable module const', () => {
    const r = compileTsSource(`
      "use typeshade";
      const BAD: f32 = foo;
      export function f(): f32 { return BAD; }
    `)
    expect(r.diagnostics.some((d) => /foldable|Unknown identifier|Module const/.test(d.message))).toBe(true)
  })

  it('still rejects top-level let', () => {
    const r = compileTsSource(`
      "use typeshade";
      let acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(true)
  })
})
