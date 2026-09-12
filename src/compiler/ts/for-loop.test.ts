import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('Phase 9 for', () => {
  it('lowers for (let i: i32 = 0; i < 16; i++)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 16; i++) {
          s = s + i;
        }
        return s;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs[0]!.body.some((s) => s.s === 'for')).toBe(true)
    expect(r.wgsl).toMatch(/for\s*\(/)
  })

  it('accepts i += 2 and a folded 4 * 4 bound', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 4 * 4; i += 2) s = s + i;
        return s;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('accepts a local const LIMIT bound', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        const LIMIT: i32 = 8;
        let s: i32 = 0;
        for (let i: i32 = 0; i < LIMIT; i++) s = s + i;
        return s;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('rejects i < n', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(n: i32): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < n; i++) s = s + i;
        return s;
      }
    `)
    expect(r.diagnostics.some((d) => /constant bound|16/.test(d.message))).toBe(true)
  })

  it('rejects i-- against i < 8', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 8; i--) s = s + i;
        return s;
      }
    `)
    expect(r.diagnostics.some((d) => /does not exit|step/.test(d.message))).toBe(true)
  })

  it('lowers while (i < 8)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let i: i32 = 0;
        while (i < 8) { i++; }
        return i;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs[0]!.body.some((s) => s.s === 'for')).toBe(true)
  })

  it('allows break inside for', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 8; i++) {
          if (i > 3) break;
          s = s + i;
        }
        return s;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})
