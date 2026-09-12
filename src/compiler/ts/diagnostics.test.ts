// Diagnostics surface: intentional errors must not throw; locations + messages

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

function diag(source: string) {
  const r = compileTsSource(source)
  return r
}

describe('diagnostics (use typeshade)', () => {
  it('does not throw on any intentional error sample', () => {
    const samples = [
      `"use typeshade";\nexport function bad(a: string): f32 { return 1; }`,
      `"use typeshade";\nexport function f(): f32 { return missing; }`,
      `"use typeshade";\nexport function f(a: f32): f32 { if (a) return 1; return 0; }`,
      `"use typeshade";\nexport function f(a: f32, b: f32): bool { return a == b; }`,
      `"use typeshade";\nexport function f(): f32 { const x = 1.; x = 2.; return x; }`,
      `"use typeshade";\nexport function f(a?: f32): f32 { return 0; }`,
    ]
    for (const s of samples) {
      expect(() => compileTsSource(s)).not.toThrow()
      const r = compileTsSource(s)
      expect(r.hasDirective).toBe(true)
      expect(r.diagnostics.length).toBeGreaterThan(0)
      for (const d of r.diagnostics) {
        expect(d.line).toBeGreaterThanOrEqual(1)
        expect(d.character).toBeGreaterThanOrEqual(1)
        expect(['error', 'warning', 'message']).toContain(d.category)
        expect(d.message.length).toBeGreaterThan(0)
      }
    }
  })

  it('string param type yields diagnostic and skips or soft-fails function', () => {
    const r = diag(`"use typeshade";\nexport function bad(a: string): f32 { return 1; }`)
    expect(r.diagnostics.some((d) => /string|TypeShade type/i.test(d.message))).toBe(true)
  })

  it('requireDirective emits error when directive missing', () => {
    const r = compileTsSource('export function f(): void {}', { requireDirective: true })
    expect(r.hasDirective).toBe(false)
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true)
  })

  it('valid transform has zero error diagnostics', () => {
    const r = diag(`
      "use typeshade";
      export function transform(a: f32, b: f32): f32 {
        const x = a + b;
        return x * 2;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs).toHaveLength(1)
  })
})
