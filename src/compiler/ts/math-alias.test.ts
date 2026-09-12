// Phase 7 Math.* alias lowering

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { lowerExpression } from './lower/expression.js'
import { LoweringScope } from './context.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { compileTsSource } from './source-file.js'
import { f32T, typeKey } from '../../core/ir/types.js'
import type { Expr } from '../../core/ir/nodes.js'
import { MATH_CONST_ALIAS, resolveMathFn } from './math-alias.js'

function parseExpr(source: string): { expr: ts.Expression; sourceFile: ts.SourceFile } {
  const text = `const __e = ${source}`
  const sourceFile = ts.createSourceFile(
    'math-test.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const stmt = sourceFile.statements[0] as ts.VariableStatement
  const init = stmt.declarationList.declarations[0]!.initializer
  if (!init) throw new Error(`no initializer for: ${source}`)
  return { expr: init, sourceFile }
}

function lower(source: string): { expr: Expr | undefined; diagnostics: TsCompilerDiagnostic[] } {
  const { expr: node, sourceFile } = parseExpr(source)
  const scope = new LoweringScope()
  scope.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
  scope.define({ kind: 'param', name: 'b', type: f32T, mutable: true })
  const diagnostics: TsCompilerDiagnostic[] = []
  return { expr: lowerExpression(node, sourceFile, scope, diagnostics), diagnostics }
}

describe('Phase 7 - Math aliases', () => {
  it('maps Math.sin to the sin intrinsic id', () => {
    expect(resolveMathFn('sin')).toBe('sin')
    expect(resolveMathFn('fround')).toBe('f32')
    expect(resolveMathFn('random')).toBeUndefined()
  })

  it('Math.sin(a) and sin(a) lower to the same call IR', () => {
    const math = lower('Math.sin(a)')
    const free = lower('sin(a)')
    expect(math.diagnostics).toEqual([])
    expect(free.diagnostics).toEqual([])
    expect(math.expr).toEqual(free.expr)
    expect(math.expr!.op).toBe('call')
    if (math.expr!.op === 'call') {
      expect(math.expr.fn).toBe('sin')
      expect(typeKey(math.expr.type)).toBe('f32')
      expect(math.expr.args[0]).toEqual({ op: 'param', type: f32T, name: 'a' })
    }
  })

  it('bakes Math.PI as f32 lit', () => {
    const { expr, diagnostics } = lower('Math.PI')
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({ op: 'lit', type: f32T, value: MATH_CONST_ALIAS.PI })
  })

  it('bakes Math.E as f32 lit', () => {
    const { expr, diagnostics } = lower('Math.E')
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('lit')
    if (expr!.op === 'lit') expect(expr.value).toBe(MATH_CONST_ALIAS.E)
  })

  it('rejects Math.random()', () => {
    const { expr, diagnostics } = lower('Math.random()')
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/not a TypeShade Math alias|random/)
  })

  it('rejects Math.sin used as a value', () => {
    const { expr, diagnostics } = lower('Math.sin')
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/function alias/)
  })

  it('rejects Math.PI()', () => {
    const { expr, diagnostics } = lower('Math.PI()')
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/constant/)
  })

  it('enforces Math.min arity 2', () => {
    const { expr, diagnostics } = lower('Math.min(a)')
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/expects 2/)
  })

  it('lowers Math.min(a, b) to call min', () => {
    const { expr, diagnostics } = lower('Math.min(a, b)')
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('call')
    if (expr!.op === 'call') expect(expr.fn).toBe('min')
  })

  it('lowers Math.atan2(a, b) to call atan2', () => {
    const { expr, diagnostics } = lower('Math.atan2(a, b)')
    expect(diagnostics).toEqual([])
    if (expr!.op === 'call') expect(expr.fn).toBe('atan2')
  })

  it('lowers Math.fround(a) to call f32', () => {
    const { expr, diagnostics } = lower('Math.fround(a)')
    expect(diagnostics).toEqual([])
    if (expr!.op === 'call') expect(expr.fn).toBe('f32')
  })

  it('compileTsSource accepts Math.sin in a function body', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function wave(x: f32): f32 {
        return Math.sin(x) * Math.PI;
      }
    `)
    expect(result.diagnostics).toEqual([])
    expect(result.funcs).toHaveLength(1)
    const ret = result.funcs[0]!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop') {
      expect(ret.expr.a.op).toBe('call')
      expect(ret.expr.b.op).toBe('lit')
    }
  })
})
