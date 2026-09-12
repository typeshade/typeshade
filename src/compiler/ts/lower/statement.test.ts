// Phase 4 tests: statement lowering

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { lowerStatements, lowerStatement } from './statement.js'
import { LoweringScope } from '../context.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { f32T, i32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { Stmt } from '../../../core/ir/nodes.js'

function parseStmts(body: string): {
  statements: ts.NodeArray<ts.Statement>
  sourceFile: ts.SourceFile
} {
  const text = `function __f() {\n${body}\n}`
  const sourceFile = ts.createSourceFile(
    'stmt-test.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const fn = sourceFile.statements[0] as ts.FunctionDeclaration
  return { statements: fn.body!.statements, sourceFile }
}

function lower(body: string, scopeInit?: (s: LoweringScope) => void): {
  stmts: Stmt[]
  diagnostics: TsCompilerDiagnostic[]
  scope: LoweringScope
} {
  const { statements, sourceFile } = parseStmts(body)
  const scope = new LoweringScope()
  scopeInit?.(scope)
  const diagnostics: TsCompilerDiagnostic[] = []
  const stmts = lowerStatements(statements, sourceFile, scope, diagnostics)
  return { stmts, diagnostics, scope }
}

describe('Phase 4 - statement lowering', () => {
  it('lowers const x = 0. to let with f32 lit', () => {
    const { stmts, diagnostics } = lower('const x = 0.;')
    expect(diagnostics).toEqual([])
    expect(stmts).toHaveLength(1)
    expect(stmts[0]).toEqual({
      s: 'let',
      name: 'x',
      expr: { op: 'lit', type: f32T, value: 0 },
    })
  })

  it('lowers let a = 0. to var with f32', () => {
    const { stmts, diagnostics } = lower('let a = 0.;')
    expect(diagnostics).toEqual([])
    expect(stmts[0]!.s).toBe('var')
    if (stmts[0]!.s === 'var') {
      expect(stmts[0].name).toBe('a')
      expect(typeKey(stmts[0].type)).toBe('f32')
      expect(stmts[0].init).toEqual({ op: 'lit', type: f32T, value: 0 })
    }
  })

  it('lowers let a: i32 = 0 with i32 lit retarget', () => {
    const { stmts, diagnostics } = lower('let a: i32 = 0;')
    expect(diagnostics).toEqual([])
    expect(stmts[0]!.s).toBe('var')
    if (stmts[0]!.s === 'var') {
      expect(typeKey(stmts[0].type)).toBe('i32')
      expect(stmts[0].init).toEqual({ op: 'lit', type: i32T, value: 0 })
    }
  })

  it('registers local in scope for later expressions', () => {
    const { stmts, diagnostics, scope } = lower('const x = 1.;\nreturn x;')
    expect(diagnostics).toEqual([])
    expect(stmts).toHaveLength(2)
    expect(stmts[1]).toEqual({
      s: 'return',
      expr: { op: 'varref', type: f32T, name: 'x' },
    })
    expect(scope.resolve('x')?.kind).toBe('local')
  })

  it('lowers return with expression', () => {
    const { stmts, diagnostics } = lower('return 1.;', (s) => {
      s.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
    })
    expect(diagnostics).toEqual([])
    expect(stmts[0]).toEqual({ s: 'return', expr: { op: 'lit', type: f32T, value: 1 } })
  })

  it('lowers if / else', () => {
    const { stmts, diagnostics } = lower(
      'if (flag) { return 1.; } else { return 0.; }',
      (s) => {
        s.define({ kind: 'param', name: 'flag', type: boolT, mutable: true })
      },
    )
    expect(diagnostics).toEqual([])
    expect(stmts[0]!.s).toBe('if')
    if (stmts[0]!.s === 'if') {
      expect(stmts[0].arms).toHaveLength(1)
      expect(stmts[0].arms[0]!.body[0]!.s).toBe('return')
      expect(stmts[0].elseBody?.[0]?.s).toBe('return')
    }
  })

  it('lowers else-if chain into multiple arms', () => {
    const { stmts, diagnostics } = lower(
      `if (a) { return 1.; } else if (b) { return 2.; } else { return 0.; }`,
      (s) => {
        s.define({ kind: 'param', name: 'a', type: boolT, mutable: true })
        s.define({ kind: 'param', name: 'b', type: boolT, mutable: true })
      },
    )
    expect(diagnostics).toEqual([])
    expect(stmts[0]!.s).toBe('if')
    if (stmts[0]!.s === 'if') {
      expect(stmts[0].arms.length).toBe(2)
      expect(stmts[0].elseBody).toBeDefined()
    }
  })

  it('rejects JS var keyword', () => {
    const { diagnostics } = lower('var x = 1;')
    expect(diagnostics[0]!.message).toMatch(/const.*let/)
  })

  it('rejects type mismatch on annotation', () => {
    const { diagnostics } = lower('let a: bool = 1.;')
    expect(diagnostics.some((d) => /Type mismatch/.test(d.message))).toBe(true)
  })

  it('rejects non-bool if condition', () => {
    const { diagnostics } = lower('if (a) { return 1.; }', (s) => {
      s.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
    })
    expect(diagnostics[0]!.message).toMatch(/bool/)
  })

  it('const x = a + b uses expression lowering', () => {
    const { stmts, diagnostics } = lower('const x = a + b;\nreturn x;', (s) => {
      s.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
      s.define({ kind: 'param', name: 'b', type: f32T, mutable: true })
    })
    expect(diagnostics).toEqual([])
    expect(stmts[0]!.s).toBe('let')
    if (stmts[0]!.s === 'let') {
      expect(stmts[0].expr.op).toBe('binop')
    }
  })

  it('lowers x = expr to assign', () => {
    const { stmts, diagnostics } = lower('let y = a;\ny = b;', (s) => {
      s.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
      s.define({ kind: 'param', name: 'b', type: f32T, mutable: true })
    })
    expect(diagnostics).toEqual([])
    expect(stmts.some((st) => st.s === 'assign')).toBe(true)
  })

  it('lowers y += 1 to assignOp', () => {
    const { stmts, diagnostics } = lower('let y = a;\ny += 1;', (s) => {
      s.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
    })
    expect(diagnostics).toEqual([])
    const op = stmts.find((st) => st.s === 'assignOp')
    expect(op).toBeDefined()
    if (op && op.s === 'assignOp') expect(op.bop).toBe('+')
  })

  it('rejects assign to const', () => {
    const { diagnostics } = lower('const x = 1.;\nx = 2.;')
    expect(diagnostics.some((d) => /const|immutable/i.test(d.message))).toBe(true)
  })

  it('block scope does not leak const from if body', () => {
    const { stmts, diagnostics, scope } = lower(
      'if (flag) { const inner = 1.; }\nreturn a;',
      (s) => {
        s.define({ kind: 'param', name: 'flag', type: boolT, mutable: true })
        s.define({ kind: 'param', name: 'a', type: f32T, mutable: true })
      },
    )
    expect(diagnostics).toEqual([])
    expect(scope.resolve('inner')).toBeUndefined()
  })

  it('rejects duplicate const in same scope', () => {
    const { diagnostics } = lower('const x = 1.;\nconst x = 2.;')
    expect(diagnostics.some((d) => /Duplicate/i.test(d.message))).toBe(true)
  })

  it('lowers bare return', () => {
    const { stmts, diagnostics } = lower('return;')
    expect(diagnostics).toEqual([])
    expect(stmts[0]).toEqual({ s: 'return' })
  })

  it('rejects JS var keyword message mentions const/let', () => {
    const { diagnostics } = lower('var z = 1;')
    expect(diagnostics[0]!.message).toMatch(/const|let/)
  })
})
