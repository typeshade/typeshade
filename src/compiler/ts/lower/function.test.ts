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

  it('lowers explicit builtin parameters as entry IO metadata', () => {
    const { node, sourceFile } = parseFn(`
      @compute([64, 1, 1])
      export function main(@builtin("global_invocation_id") gid: vec3u): void {}
    `)
    const diagnostics: TsCompilerDiagnostic[] = []
    const fn = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(diagnostics).toEqual([])
    expect(fn).toBeDefined()
    expect(fn!.stage).toBe('compute')
    expect(fn!.workgroupSize).toBe(64)
    expect(fn!.params).toHaveLength(1)
    expect(fn!.params[0]!.name).toBe('gid')
    expect(fn!.params[0]!.builtin).toBe('global_invocation_id')
    expect(typeKey(fn!.params[0]!.type)).toBe('vec3u')
  })

  it('does not inject implicit gid into a compute entry', () => {
    const { node, sourceFile } = parseFn(`
      @compute([64, 1, 1])
      export function main(): void { const x = gid.x; }
    `)
    const diagnostics: TsCompilerDiagnostic[] = []
    const fn = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(fn).toBeDefined()
    expect(diagnostics.some((d) => /Unknown identifier/i.test(d.message))).toBe(true)
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

  it('flags return type mismatch', () => {
    const { node, sourceFile } = parseFn(
      'function bad(a: f32): bool { return a; }',
    )
    const diagnostics: TsCompilerDiagnostic[] = []
    const f = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(f).toBeDefined()
    expect(diagnostics.some((d) => /return type mismatch/i.test(d.message))).toBe(true)
  })

  it('rejects optional parameters', () => {
    const { node, sourceFile } = parseFn(
      'function bad(a?: f32): f32 { return 0; }',
    )
    const diagnostics: TsCompilerDiagnostic[] = []
    const f = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(f).toBeUndefined()
    expect(diagnostics.some((d) => /Optional/i.test(d.message))).toBe(true)
  })

  it('body with const and return uses varref', () => {
    const { node, sourceFile } = parseFn(
      'function add(a: f32, b: f32): f32 { const x = a + b; return x; }',
    )
    const diagnostics: TsCompilerDiagnostic[] = []
    const f = lowerFunctionDeclaration(node, sourceFile, diagnostics)
    expect(diagnostics).toEqual([])
    expect(f!.body).toHaveLength(2)
    expect(f!.body[0]!.s).toBe('let')
    expect(f!.body[1]!.s).toBe('return')
    if (f!.body[1]!.s === 'return' && f!.body[1].expr) {
      expect(f!.body[1].expr.op).toBe('varref')
    }
  })
})
