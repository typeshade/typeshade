// Phase 1 tests: "use typeshade" detection and compileTsSource entry point.

import { describe, expect, it } from 'vitest'
import {
  compileTsSource,
  isTypeshadeSource,
  USE_TYPESHADE,
  hasUseTypeshadeDirective,
  findUseTypeshadeDirective,
  isUseTypeshadeDirective,
} from './index.js'
import ts from 'typescript'

describe('Phase 1 — "use typeshade" directive', () => {
  it('detects a top-level double-quoted directive', () => {
    const source = `"use typeshade";\nexport function f(): void {}`
    expect(isTypeshadeSource(source)).toBe(true)
    const result = compileTsSource(source)
    expect(result.hasDirective).toBe(true)
    expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('detects a top-level single-quoted directive', () => {
    const source = `'use typeshade';\nfunction g(): void {}`
    expect(isTypeshadeSource(source)).toBe(true)
    expect(compileTsSource(source).hasDirective).toBe(true)
  })

  it('detects the directive when it is the only statement', () => {
    const source = `"use typeshade";`
    expect(isTypeshadeSource(source)).toBe(true)
    const result = compileTsSource(source)
    expect(result.hasDirective).toBe(true)
    expect(result.funcs).toEqual([])
  })

  it('detects the directive after an import declaration', () => {
    const source = `
      import { something } from './other.js';
      "use typeshade";
      export function add(a: f32, b: f32): f32 { return a + b; }
    `
    expect(isTypeshadeSource(source)).toBe(true)
    expect(compileTsSource(source).hasDirective).toBe(true)
  })

  it('detects the directive after other top-level statements', () => {
    const source = `
      const prelude = 1;
      "use typeshade";
      export function h(): void {}
    `
    expect(isTypeshadeSource(source)).toBe(true)
    expect(compileTsSource(source).hasDirective).toBe(true)
  })

  it('detects the first directive when multiple are present', () => {
    const source = `
      "use typeshade";
      "use typeshade";
      function f(): void {}
    `
    const sf = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true)
    expect(findUseTypeshadeDirective(sf)).toBeDefined()
    expect(compileTsSource(source).hasDirective).toBe(true)
  })

  it('returns hasDirective=false when the directive is absent', () => {
    const source = `export function add(a: number, b: number): number {\n  return a + b;\n}`
    expect(isTypeshadeSource(source)).toBe(false)
    const result = compileTsSource(source)
    expect(result.hasDirective).toBe(false)
    expect(result.funcs).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('returns hasDirective=false for an empty source', () => {
    expect(isTypeshadeSource('')).toBe(false)
    const result = compileTsSource('')
    expect(result.hasDirective).toBe(false)
    expect(result.funcs).toEqual([])
  })

  it('emits an error diagnostic when requireDirective is true and directive is missing', () => {
    const result = compileTsSource('const x = 1;', { requireDirective: true })
    expect(result.hasDirective).toBe(false)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]!.category).toBe('error')
    expect(result.diagnostics[0]!.message).toContain(USE_TYPESHADE)
  })

  it('does not emit diagnostics when requireDirective is false and directive is missing', () => {
    const result = compileTsSource('const x = 1;', { requireDirective: false })
    expect(result.diagnostics).toEqual([])
  })

  it('ignores the directive when it appears only inside a function body', () => {
    const source = `
      function outer() {
        "use typeshade";
        return 1;
      }
    `
    expect(isTypeshadeSource(source)).toBe(false)
    expect(compileTsSource(source).hasDirective).toBe(false)
  })

  it('ignores the directive inside a block or namespace', () => {
    const source = `
      {
        "use typeshade";
      }
      namespace N {
        "use typeshade";
      }
    `
    expect(isTypeshadeSource(source)).toBe(false)
  })

  it('rejects a directive with wrong casing', () => {
    expect(isTypeshadeSource('"Use TypeShade";')).toBe(false)
    expect(isTypeshadeSource('"USE TYPESHADE";')).toBe(false)
  })

  it('rejects a directive with leading/trailing whitespace inside quotes', () => {
    expect(isTypeshadeSource('" use typeshade ";')).toBe(false)
  })

  it('rejects a directive with extra internal whitespace', () => {
    expect(isTypeshadeSource('"use  typeshade";')).toBe(false)
  })

  it('rejects a template-literal form of the directive', () => {
    expect(isTypeshadeSource('`use typeshade`;')).toBe(false)
  })

  it('rejects a concatenated or parenthesized non-literal expression', () => {
    expect(isTypeshadeSource('"use " + "typeshade";')).toBe(false)
    expect(isTypeshadeSource('("use typeshade");')).toBe(false)
  })

  it('rejects a near-miss string', () => {
    expect(isTypeshadeSource('"use typeshade!";')).toBe(false)
  })

  it('findUseTypeshadeDirective returns the statement node', () => {
    const source = `"use typeshade";\nconst x = 1;`
    const sf = ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true)
    const dir = findUseTypeshadeDirective(sf)
    expect(dir).toBeDefined()
    expect(ts.isExpressionStatement(dir!)).toBe(true)
    expect(hasUseTypeshadeDirective(sf)).toBe(true)
    expect(isUseTypeshadeDirective(dir!)).toBe(true)
  })

  it('findUseTypeshadeDirective returns undefined when absent', () => {
    const sf = ts.createSourceFile('t.ts', 'const x = 1;', ts.ScriptTarget.Latest, true)
    expect(findUseTypeshadeDirective(sf)).toBeUndefined()
  })

  it('isUseTypeshadeDirective returns false for non-expression statements', () => {
    const sf = ts.createSourceFile('t.ts', 'function f() {}\nconst x = 1;', ts.ScriptTarget.Latest, true)
    for (const stmt of sf.statements) expect(isUseTypeshadeDirective(stmt)).toBe(false)
  })

  it('preserves the SourceFile for later phases', () => {
    const source = `"use typeshade";\nexport function transform(a: f32, b: f32): f32 {\n  return a + b;\n}`
    const result = compileTsSource(source, { fileName: 'transform.ts' })
    expect(result.sourceFile.fileName).toBe('transform.ts')
  })

  it('uses the default fileName when none is provided', () => {
    expect(compileTsSource('"use typeshade";').sourceFile.fileName).toBe('typeshade-input.ts')
  })

  it('lowers transform() once the frontend is connected', () => {
    const withDir = compileTsSource(`
      "use typeshade";
      export function transform(a: f32, b: f32): f32 {
        const x = a + b;
        return x * 2;
      }
    `)
    expect(withDir.funcs.map((f) => f.name)).toEqual(['transform'])
    expect(withDir.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(compileTsSource('export function f() {}').funcs).toEqual([])
  })

  it('exposes the exact directive string constant', () => {
    expect(USE_TYPESHADE).toBe('use typeshade')
  })
})
