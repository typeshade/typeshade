import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('constant loop bounds', () => {
  it('accepts i < 16', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 16; i++) s = s + i;
        return s;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('accepts a const LIMIT bound', () => {
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

  it('rejects i < n (runtime bound)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(n: i32): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < n; i++) s = s + i;
        return s;
      }
    `)
    expect(r.diagnostics.some((d) => /constant/.test(d.message))).toBe(true)
  })

  it('rejects while (true)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        while (true) { break; }
      }
    `)
    expect(r.diagnostics.some((d) => /Infinite loop|constant/.test(d.message))).toBe(true)
  })

  it('rejects for (;;)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        for (;;) { break; }
      }
    `)
    expect(r.diagnostics.some((d) => /exit condition|infinite/i.test(d.message))).toBe(true)
  })
})
