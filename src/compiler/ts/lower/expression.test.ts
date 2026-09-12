// Phase 3 tests: expression lowering TS AST -> TypeShade Expr

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { lowerExpression } from './expression.js'
import { LoweringScope } from '../context.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { f32T, i32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { Expr } from '../../../core/ir/nodes.js'

function parseExpr(source: string): { expr: ts.Expression; sourceFile: ts.SourceFile } {
  const text = `const __e = ${source}`
  const sourceFile = ts.createSourceFile(
    'expr-test.ts',
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

function lower(
  source: string,
  scopeInit?: (s: LoweringScope) => void,
): { expr: Expr | undefined; diagnostics: TsCompilerDiagnostic[] } {
  const { expr: node, sourceFile } = parseExpr(source)
  const scope = new LoweringScope()
  scopeInit?.(scope)
  const diagnostics: TsCompilerDiagnostic[] = []
  const expr = lowerExpression(node, sourceFile, scope, diagnostics)
  return { expr, diagnostics }
}

function withParams(scope: LoweringScope): void {
  scope.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
  scope.define({ kind: 'param', name: 'b', type: f32T, mutable: true })
  scope.define({ kind: 'param', name: 'flag', type: boolT, mutable: true })
  scope.define({ kind: 'param', name: 'i', type: i32T, mutable: true })
  scope.define({ kind: 'param', name: 'j', type: i32T, mutable: true })
  scope.define({ kind: 'param', name: 'c', type: boolT, mutable: true })
}

describe('Phase 3 - expression lowering', () => {
  it('lowers a numeric literal to lit f32', () => {
    const { expr, diagnostics } = lower('1')
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({ op: 'lit', type: f32T, value: 1 })
  })

  it('lowers true/false to lit bool', () => {
    expect(lower('true').expr).toEqual({ op: 'lit', type: boolT, value: true })
    expect(lower('false').expr).toEqual({ op: 'lit', type: boolT, value: false })
  })

  it('lowers a param identifier to param expr', () => {
    const { expr, diagnostics } = lower('a', withParams)
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({ op: 'param', type: f32T, name: 'a' })
  })

  it('lowers a local identifier to varref', () => {
    const { expr, diagnostics } = lower('x', (s) => {
      s.define({ kind: 'local', name: 'x', type: f32T, mutable: true })
    })
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({ op: 'varref', type: f32T, name: 'x' })
  })

  it('errors on unknown identifier', () => {
    const { expr, diagnostics } = lower('missing')
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/Unknown identifier/)
  })

  it('lowers a + b to binop', () => {
    const { expr, diagnostics } = lower('a + b', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') {
      expect(expr.bop).toBe('+')
      expect(typeKey(expr.type)).toBe('f32')
      expect(expr.a).toEqual({ op: 'param', type: f32T, name: 'a' })
      expect(expr.b).toEqual({ op: 'param', type: f32T, name: 'b' })
    }
  })

  it('lowers -, *, /', () => {
    for (const [src, bop] of [
      ['a - b', '-'],
      ['a * b', '*'],
      ['a / b', '/'],
    ] as const) {
      const { expr, diagnostics } = lower(src, withParams)
      expect(diagnostics).toEqual([])
      expect(expr!.op).toBe('binop')
      if (expr!.op === 'binop') expect(expr.bop).toBe(bop)
    }
  })

  it('lowers -a to unop', () => {
    const { expr, diagnostics } = lower('-a', withParams)
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({
      op: 'unop',
      type: f32T,
      a: { op: 'param', type: f32T, name: 'a' },
    })
  })

  it('lowers !flag to compare with false', () => {
    const { expr, diagnostics } = lower('!flag', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('compare')
    if (expr!.op === 'compare') {
      expect(expr.cop).toBe('==')
      expect(expr.b).toEqual({ op: 'lit', type: boolT, value: false })
    }
  })

  it('rejects ! on non-bool', () => {
    const { expr, diagnostics } = lower('!a', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/bool operand/)
  })

  it('lowers comparisons to compare expr', () => {
    for (const [src, cop] of [
      ['a < b', '<'],
      ['a > b', '>'],
      ['a <= b', '<='],
      ['a >= b', '>='],
      ['a === b', '=='],
      ['a !== b', '!='],
    ] as const) {
      const { expr, diagnostics } = lower(src, withParams)
      expect(diagnostics).toEqual([])
      expect(expr!.op).toBe('compare')
      if (expr!.op === 'compare') {
        expect(expr.cop).toBe(cop)
        expect(typeKey(expr.type)).toBe('bool')
      }
    }
  })

  it('rejects non-strict == and !=', () => {
    const eq = lower('a == b', withParams)
    expect(eq.expr).toBeUndefined()
    expect(eq.diagnostics[0]!.message).toMatch(/strict equality/)

    const ne = lower('a != b', withParams)
    expect(ne.expr).toBeUndefined()
    expect(ne.diagnostics[0]!.message).toMatch(/strict equality/)
  })

  it('lowers parenthesized expressions', () => {
    const { expr, diagnostics } = lower('(a + b) * 2', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') {
      expect(expr.bop).toBe('*')
      expect(expr.a.op).toBe('binop')
      expect(expr.b).toEqual({ op: 'lit', type: f32T, value: 2 })
    }
  })

  it('lowers a % b to truncated binop %, never call(mod)', () => {
    const { expr, diagnostics } = lower('a % b', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('binop')
    expect(expr!.op).not.toBe('call')
    if (expr!.op === 'binop') {
      expect(expr.bop).toBe('%')
      expect(typeKey(expr.type)).toBe('f32')
      expect(expr.a).toEqual({ op: 'param', type: f32T, name: 'a' })
      expect(expr.b).toEqual({ op: 'param', type: f32T, name: 'b' })
    }
  })

  it('diagnoses mod(a, b) as Phase 6 floor-mod, not %', () => {
    const { expr, diagnostics } = lower('mod(a, b)', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics.length).toBeGreaterThanOrEqual(1)
    expect(diagnostics[0]!.message).toMatch(/floor-modulo|Phase 6/)
    expect(diagnostics[0]!.message).toMatch(/%/)
  })

  it('lowers bitwise & | ^ << >>', () => {
    for (const [src, bop] of [
      ['i & j', '&'],
      ['i | j', '|'],
      ['i ^ j', '^'],
      ['i << j', '<<'],
      ['i >> j', '>>'],
    ] as const) {
      const { expr, diagnostics } = lower(src, withParams)
      expect(diagnostics).toEqual([])
      expect(expr!.op).toBe('binop')
      if (expr!.op === 'binop') expect(expr.bop).toBe(bop)
    }
  })

  it('rejects unsigned >>> shift', () => {
    const { expr, diagnostics } = lower('i >>> j', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/>>>/)
  })

  it('lowers logical && and ||', () => {
    for (const [src, lop] of [
      ['flag && c', '&&'],
      ['flag || c', '||'],
    ] as const) {
      const { expr, diagnostics } = lower(src, withParams)
      expect(diagnostics).toEqual([])
      expect(expr!.op).toBe('logical')
      if (expr!.op === 'logical') {
        expect(expr.lop).toBe(lop)
        expect(typeKey(expr.type)).toBe('bool')
      }
    }
  })

  it('rejects logical ops on non-bool', () => {
    const { expr, diagnostics } = lower('a && b', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/bool operands/)
  })

  it('rejects type-mismatched arithmetic', () => {
    const { expr, diagnostics } = lower('a + flag', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/type mismatch/)
  })

  it('lowers chained arithmetic with left-assoc shape', () => {
    const { expr, diagnostics } = lower('a + b * 2', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') {
      expect(expr.bop).toBe('+')
      expect(expr.b.op).toBe('binop')
      if (expr.b.op === 'binop') expect(expr.b.bop).toBe('*')
    }
  })

  it('lowers nested parentheses', () => {
    const { expr, diagnostics } = lower('((a))', withParams)
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({ op: 'param', type: f32T, name: 'a' })
  })

  it('lowers float literal 1.5', () => {
    const { expr, diagnostics } = lower('1.5')
    expect(diagnostics).toEqual([])
    expect(expr).toEqual({ op: 'lit', type: f32T, value: 1.5 })
  })

  it('lowers a % b after % policy', () => {
    const { expr, diagnostics } = lower('a % b', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') expect(expr.bop).toBe('%')
  })

  it('rejects call to unknown free function foo()', () => {
    const { expr, diagnostics } = lower('foo(a)', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/Phase 3|Function calls|Phase 6/)
  })

  it('diagnostic includes line and character', () => {
    const { diagnostics } = lower('missing')
    expect(diagnostics[0]!.line).toBeGreaterThanOrEqual(1)
    expect(diagnostics[0]!.character).toBeGreaterThanOrEqual(1)
    expect(diagnostics[0]!.category).toBe('error')
  })
})
