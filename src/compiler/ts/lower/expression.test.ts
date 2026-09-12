// Phase 3 tests: expression lowering TS AST -> TypeShade Expr

import { describe, expect, it } from 'vitest'
import { lowerExpression } from './expression.js'
import { LoweringScope } from '../context.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { f32T, i32T, boolT } from '../../../core/ir/types.js'
import type { Expr } from '../../../core/ir/nodes.js'
import ts from 'typescript'

function parseExpr(source: string): { expr: ts.Expression; sourceFile: ts.SourceFile } {
  const text = `const __e = ${source}`
  const sourceFile = ts.createSourceFile('expr-test.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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
  return { expr: lowerExpression(node, sourceFile, scope, diagnostics), diagnostics }
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
    expect(lower('1')).toMatchObject({ expr: { op: 'lit', type: f32T, value: 1 }, diagnostics: [] })
  })

  it('lowers true/false to lit bool', () => {
    expect(lower('true').expr).toEqual({ op: 'lit', type: boolT, value: true })
    expect(lower('false').expr).toEqual({ op: 'lit', type: boolT, value: false })
  })

  it('lowers a param identifier to param expr', () => {
    expect(lower('a', withParams).expr).toEqual({ op: 'param', type: f32T, name: 'a' })
  })

  it('lowers a local identifier to varref', () => {
    expect(
      lower('x', (s) => {
        s.define({ kind: 'local', name: 'x', type: f32T, mutable: true })
      }).expr,
    ).toEqual({ op: 'varref', type: f32T, name: 'x' })
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
  })

  it('lowers -, *, /', () => {
    for (const [src, bop] of [
      ['a - b', '-'],
      ['a * b', '*'],
      ['a / b', '/'],
    ] as const) {
      const { expr } = lower(src, withParams)
      expect(expr!.op).toBe('binop')
      if (expr!.op === 'binop') expect(expr.bop).toBe(bop)
    }
  })

  it('lowers -a to unop', () => {
    expect(lower('-a', withParams).expr).toEqual({
      op: 'unop',
      type: f32T,
      a: { op: 'param', type: f32T, name: 'a' },
    })
  })

  it('lowers !flag to compare with false', () => {
    const { expr } = lower('!flag', withParams)
    expect(expr!.op).toBe('compare')
  })

  it('rejects ! on non-bool', () => {
    expect(lower('!a', withParams).diagnostics[0]!.message).toMatch(/bool operand/)
  })

  it('lowers comparisons to compare expr', () => {
    for (const src of ['a < b', 'a > b', 'a <= b', 'a >= b', 'a === b', 'a !== b']) {
      expect(lower(src, withParams).expr!.op).toBe('compare')
    }
  })

  it('rejects non-strict == and !=', () => {
    expect(lower('a == b', withParams).diagnostics[0]!.message).toMatch(/strict equality/)
    expect(lower('a != b', withParams).diagnostics[0]!.message).toMatch(/strict equality/)
  })

  it('lowers parenthesized expressions', () => {
    const { expr } = lower('(a + b) * 2', withParams)
    expect(expr!.op).toBe('binop')
  })

  it('lowers a % b to truncated binop %, never call(mod)', () => {
    const { expr, diagnostics } = lower('a % b', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') expect(expr.bop).toBe('%')
  })

  it('lowers mod(a, b) to floor-mod call', () => {
    const { expr, diagnostics } = lower('mod(a, b)', withParams)
    expect(diagnostics).toEqual([])
    expect(expr!.op).toBe('call')
    if (expr!.op === 'call') expect(expr.fn).toBe('mod')
  })

  it('lowers bitwise & | ^ << >>', () => {
    for (const src of ['i & j', 'i | j', 'i ^ j', 'i << j', 'i >> j']) {
      expect(lower(src, withParams).expr!.op).toBe('binop')
    }
  })

  it('rejects unsigned >>> shift', () => {
    expect(lower('i >>> j', withParams).diagnostics[0]!.message).toMatch(/>>>/)
  })

  it('lowers logical && and ||', () => {
    expect(lower('flag && c', withParams).expr!.op).toBe('logical')
    expect(lower('flag || c', withParams).expr!.op).toBe('logical')
  })

  it('rejects logical ops on non-bool', () => {
    expect(lower('a && b', withParams).diagnostics[0]!.message).toMatch(/bool operands/)
  })

  it('rejects type-mismatched arithmetic', () => {
    const { expr, diagnostics } = lower('a + flag', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/type mismatch/i)
  })

  it('lowers chained arithmetic with left-assoc shape', () => {
    const { expr } = lower('a + b * 2', withParams)
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') expect(expr.b.op).toBe('binop')
  })

  it('lowers nested parentheses', () => {
    expect(lower('((a))', withParams).expr).toEqual({ op: 'param', type: f32T, name: 'a' })
  })

  it('lowers float literal 1.5', () => {
    expect(lower('1.5').expr).toEqual({ op: 'lit', type: f32T, value: 1.5 })
  })

  it('lowers a % b after % policy', () => {
    const { expr } = lower('a % b', withParams)
    expect(expr!.op).toBe('binop')
    if (expr!.op === 'binop') expect(expr.bop).toBe('%')
  })

  it('rejects call to unknown free function foo()', () => {
    const { expr, diagnostics } = lower('foo(a)', withParams)
    expect(expr).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/Unknown function|Function calls|Phase 6/)
  })

  it('diagnostic includes line and character', () => {
    const { diagnostics } = lower('missing')
    expect(diagnostics[0]!.line).toBeGreaterThanOrEqual(1)
    expect(diagnostics[0]!.category).toBe('error')
  })
})
