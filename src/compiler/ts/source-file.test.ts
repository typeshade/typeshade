// Phase 1 tests: "use typeshade" detection and compileTsSource entry point.

import { describe, expect, it } from 'vitest'
import {
  compileTsSource,
  isTypeshadeSource,
  USE_TYPESHADE,
  hasUseTypeshadeDirective,
  findUseTypeshadeDirective,
} from './index.js'
import ts from 'typescript'

describe('Phase 1 — "use typeshade" directive', () => {
  it('detects a top-level double-quoted directive', () => {
    const source = `"use typeshade";\nexport function f(): void {}`
    expect(isTypeshadeSource(source)).toBe(true)

    const result = compileTsSource(source)
    expect(result.hasDirective).toBe(true)
    expect(result.funcs).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('detects a top-level single-quoted directive', () => {
    const source = `'use typeshade';\nfunction g() {}`
    expect(isTypeshadeSource(source)).toBe(true)
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

  it('emits an error diagnostic when requireDirective is true and directive is missing', () => {
    const result = compileTsSource('const x = 1;', { requireDirective: true })
    expect(result.hasDirective).toBe(false)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]!.category).toBe('error')
    expect(result.diagnostics[0]!.message).toContain(USE_TYPESHADE)
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

  it('rejects a directive with wrong casing or extra whitespace inside quotes', () => {
    expect(isTypeshadeSource('"Use TypeShade";')).toBe(false)
    expect(isTypeshadeSource('" use typeshade ";')).toBe(false)
    expect(isTypeshadeSource('"use  typeshade";')).toBe(false)
  })

  it('findUseTypeshadeDirective returns the statement node', () => {
    const source = `"use typeshade";\nconst x = 1;`
    const sf = ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true)
    const dir = findUseTypeshadeDirective(sf)
    expect(dir).toBeDefined()
    expect(ts.isExpressionStatement(dir!)).toBe(true)
    expect(hasUseTypeshadeDirective(sf)).toBe(true)
  })

  it('preserves the SourceFile for later phases', () => {
    const source = `"use typeshade";\nexport function transform(a: f32, b: f32): f32 {\n  return a + b;\n}`
    const result = compileTsSource(source, { fileName: 'transform.ts' })
    expect(result.sourceFile.fileName).toBe('transform.ts')
    expect(result.sourceFile.statements.length).toBeGreaterThan(0)
  })
})
