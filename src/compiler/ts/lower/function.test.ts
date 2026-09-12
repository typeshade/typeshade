// Phase 5 unit tests: function lowering

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { lowerFunctionDeclaration, lowerSourceFunctions } from './function.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { typeKey } from '../../../core/ir/types.js'

function parseFn(source: string): {
  node: ts.FunctionDeclaration
  sourceFile: ts.SourceFile
} {
  const sourceFile = ts.createSourceFile(
    'fn-test.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const node = sourceFile.statements.find(ts.isFunctionDeclaration)
  if (!node) throw new Error('no function')
  return { node, sourceFile }
}

describe('Phase 5 - function lowering', () => {
  it('lowers named function with params and return', () => {
    const { node, sourceFile } = parseFn(
      'export function add(a: f32, b: f32): f32 { return a + b; }',
    )
    const diagnostics: TsCompilerDiagnostic[] = []
    const fn = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(diagnostics).toEqual([])
    expect(fn!.name).toBe('add')
    expect(fn!.params.map((p) => p.name)).toEqual(['a', 'b'])
    expect(typeKey(fn!.ret)).toBe('f32')
    expect(fn!.body[0]!.s).toBe('return')
  })

  it('lowers void return', () => {
    const { node, sourceFile } = parseFn('function noop(): void { return; }')
    const diagnostics: TsCompilerDiagnostic[] = []
    const fn = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(fn).toBeDefined()
    expect(typeKey(fn!.ret)).toBe('void')
  })

  it('rejects missing param type', () => {
    const { node, sourceFile } = parseFn('function f(a): f32 { return a; }')
    const diagnostics: TsCompilerDiagnostic[] = []
    const fn = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(fn).toBeUndefined()
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it('lowerSourceFunctions collects all top-level functions (export optional)', () => {
    const sourceFile = ts.createSourceFile(
      'multi.ts',
      `"use typeshade";
      function helper(x: f32): f32 { return x; }
      export function main(x: f32): f32 { return helper(x); }
      `,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const diagnostics: TsCompilerDiagnostic[] = []
    const funcs = lowerSourceFunctions(sourceFile, diagnostics)
    expect(funcs.map((f) => f.name).sort()).toEqual(['helper', 'main'])
  })
})
