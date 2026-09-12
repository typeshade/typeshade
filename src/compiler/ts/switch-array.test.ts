import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { compileTsSource } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'

function map(src: string) {
  const sf = ts.createSourceFile('t.ts', `type X = ${src}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = sf.statements[0] as ts.TypeAliasDeclaration
  const diagnostics: { message: string }[] = []
  return { type: mapTsTypeToShaderType(alias.type, sf, diagnostics as never), diagnostics }
}

describe('switch', () => {
  it('lowers integer cases + default', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(x: i32, a: f32, b: f32, c: f32): f32 {
        switch (x) {
          case 0: return a;
          case 1: return b;
          default: return c;
        }
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs[0]!.body.some((s) => s.s === 'switch')).toBe(true)
    expect(r.wgsl).toMatch(/switch/)
  })

  it('rejects a float scrutinee', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(x: f32, a: f32): f32 {
        switch (x) { default: return a; }
      }
    `)
    expect(r.diagnostics.some((d) => /i32 or u32/.test(d.message))).toBe(true)
  })

  it('rejects case fall-through', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function pick(x: i32, a: f32): f32 {
        switch (x) {
          case 0:
          case 1: return a;
          default: return a;
        }
      }
    `)
    expect(r.diagnostics.some((d) => /fall-through/.test(d.message))).toBe(true)
  })
})

describe('array<T, N>', () => {
  it('maps array<f32, 4>', () => {
    const r = map('array<f32, 4>')
    expect(r.diagnostics).toEqual([])
    expect(r.type).toMatchObject({ kind: 'array', size: 4 })
  })

  it('indexes an array parameter', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>, i: i32): f32 {
        return xs[i];
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('index')
  })
})
