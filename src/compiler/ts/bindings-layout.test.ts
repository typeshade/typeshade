import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { collectBindings } from './bindings.js'

function collect(src: string) {
  const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const diagnostics: { message: string }[] = []
  return { bindings: collectBindings(sf, diagnostics as never), diagnostics }
}

describe('binding layout', () => {
  it('errors when two resources share a slot', () => {
    const r = collect(`
      const a = uniform<f32>(0);
      const b = uniform<f32>(0);
    `)
    expect(r.diagnostics.some((d) => /used by "a" and "b"/.test(d.message))).toBe(true)
  })

  it('errors when auto fills a slot already taken', () => {
    const r = collect(`
      let xs = storage<f32>();
      const scale = uniform<f32>(0);
    `)
    expect(r.diagnostics.some((d) => /@binding\(0\)/.test(d.message))).toBe(true)
  })

  it('allows a hole after an explicit high slot', () => {
    const r = collect(`
      const camera = uniform<f32>(2);
      let xs = storage<f32>();
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.bindings.map((b) => b.binding)).toEqual([2, 3])
  })
})
