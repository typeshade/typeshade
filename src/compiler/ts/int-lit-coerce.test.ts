import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('integer literal matches peer type', () => {
  it('allows i === 0 when i is u32', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(i: u32): bool {
        return i === 0;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('allows i + 1 when i is u32', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(i: u32): u32 {
        return i + 1;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('still rejects 0. against u32', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(i: u32): bool {
        return i === 0.;
      }
    `)
    expect(r.diagnostics.some((d) => /mismatch|u32|f32/.test(d.message))).toBe(true)
  })
})
