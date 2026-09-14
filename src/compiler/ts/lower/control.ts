import ts from 'typescript'
import type { Expr, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { analyzeCountedFor, loopConditionError } from '../loop-bound.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { lowerExpression } from './expression.js'
import { lowerStatement, lowerStatements } from './statement.js'

export function lowerFor(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (!node.condition) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for is missing an exit condition; infinite loops are not allowed.',
      TS_CODES.LOOP_INFINITE,
    )
    return undefined
  }
  if (!node.initializer || !ts.isVariableDeclarationList(node.initializer)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for-init must be `let i: i32 = <const>`.',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  if (!node.incrementor) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'for-update is required (e.g. i++).',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  scope.push()
  scope.enterLoop()
  try {
    const initStmt = lowerForInit(node.initializer, sourceFile, scope, diagnostics)
    if (!initStmt) return undefined
    // The `for` header's own two statements never pass through `lowerStatement`, so the
    // blanket stamp there does not reach them; give each the span of the clause it came from
    // rather than the whole loop's, so stepping a loop highlights `i = 0` and `i++`.
    withSpan(initStmt, sourceFile, node.initializer)
    const cond = lowerExpression(node.condition, sourceFile, scope, diagnostics)
    if (!cond) return undefined
    if (typeKey(cond.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node.condition,
        `for condition must be bool, got ${typeKey(cond.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    const update = lowerUpdate(node.incrementor, sourceFile, scope, diagnostics)
    if (!update) return undefined
    withSpan(update, sourceFile, node.incrementor)
    const counted = analyzeCountedFor(initStmt, cond, update, scope)
    if (!counted.ok) {
      pushDiag(diagnostics, sourceFile, node, counted.message, counted.code)
      return undefined
    }
    return {
      s: 'for',
      init: initStmt,
      cond,
      update,
      body: lowerBody(node.statement, sourceFile, scope, diagnostics),
    }
  } finally {
    scope.exitLoop()
    scope.pop()
  }
}

function lowerForInit(
  list: ts.VariableDeclarationList,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const decl = list.declarations[0]
  if (!decl || list.declarations.length !== 1 || !ts.isIdentifier(decl.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-init must declare exactly one identifier.',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  if ((list.flags & ts.NodeFlags.Let) === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      list,
      'for-init must be `let` (mutable induction).',
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  const name = decl.name.text
  if (!decl.initializer) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `for-init "${name}" requires an initializer.`,
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined
  let init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  if (annotated && init.op === 'lit' && typeof init.value === 'number') {
    init = { op: 'lit', type: annotated, value: init.value }
  }
  const type: ShaderType = annotated ?? init.type
  const k = typeKey(type)
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `for induction must be i32 or u32, got ${k}.`,
      TS_CODES.LOOP_INDUCTION,
    )
    return undefined
  }
  scope.define({
    kind: 'local',
    name,
    type,
    mutable: true,
    constValue: init.op === 'lit' ? init.value : undefined,
  })
  return { s: 'var', name, type, init }
}

export function lowerWhile(
  node: ts.WhileStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const cond = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!cond) return undefined
  const err = loopConditionError(cond, scope)
  if (err) {
    pushDiag(diagnostics, sourceFile, node, err.message, err.code)
    return undefined
  }
  scope.enterLoop()
  try {
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics)
    const i32 = cond.op === 'compare' ? cond.a.type : cond.type
    const w = { op: 'varref' as const, type: i32, name: '_w' }
    return {
      s: 'for',
      init: { s: 'var', name: '_w', type: i32, init: { op: 'lit', type: i32, value: 0 } },
      cond,
      update: {
        s: 'assign',
        target: w,
        expr: { op: 'binop', type: i32, bop: '+', a: w, b: { op: 'lit', type: i32, value: 1 } },
      },
      body,
    }
  } finally {
    scope.exitLoop()
  }
}

export function lowerSwitch(
  node: ts.SwitchStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const scrut = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!scrut) return undefined
  const k = typeKey(scrut.type)
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `switch scrutinee must be i32 or u32, got ${k}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const cases: { value: number; body: readonly Stmt[] }[] = []
  let defaultBody: readonly Stmt[] | undefined
  for (const clause of node.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) {
      defaultBody = lowerStatements(clause.statements, sourceFile, scope, diagnostics)
      continue
    }
    if (!clause.expression || !ts.isNumericLiteral(clause.expression)) {
      pushDiag(
        diagnostics,
        sourceFile,
        clause,
        'switch case must be a numeric literal.',
        TS_CODES.SWITCH_CASE,
      )
      continue
    }
    if (clause.statements.length === 0) {
      pushDiag(
        diagnostics,
        sourceFile,
        clause,
        'switch case fall-through is not allowed.',
        TS_CODES.SWITCH_CASE,
      )
      continue
    }
    cases.push({
      value: Number(clause.expression.text),
      body: lowerStatements(clause.statements, sourceFile, scope, diagnostics),
    })
  }
  return { s: 'switch', scrut, cases, defaultBody }
}

export function lowerUpdate(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    const op = expr.operator
    if (op !== ts.SyntaxKind.PlusPlusToken && op !== ts.SyntaxKind.MinusMinusToken) {
      pushDiag(diagnostics, sourceFile, expr, 'Unsupported update operator.', TS_CODES.UNSUPPORTED)
      return undefined
    }
    const targetExpr = expr.operand
    if (!ts.isIdentifier(targetExpr)) {
      pushDiag(
        diagnostics,
        sourceFile,
        expr,
        '++/-- target must be an identifier.',
        TS_CODES.ASSIGN_TARGET,
      )
      return undefined
    }
    const binding = scope.resolve(targetExpr.text)
    if (!binding || !binding.mutable) {
      pushDiag(
        diagnostics,
        sourceFile,
        expr,
        `Cannot assign to "${targetExpr.text}" — it is declared with const.`,
        TS_CODES.CONST_ASSIGN,
      )
      return undefined
    }
    const target: Expr =
      binding.kind === 'param'
        ? { op: 'param', type: binding.type, name: binding.name }
        : { op: 'varref', type: binding.type, name: binding.name }
    return {
      s: 'assign',
      target,
      expr: {
        op: 'binop',
        type: binding.type,
        bop: op === ts.SyntaxKind.PlusPlusToken ? '+' : '-',
        a: target,
        b: { op: 'lit', type: binding.type, value: 1 },
      },
    }
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
    const left = expr.left
    if (!ts.isIdentifier(left)) return undefined
    const binding = scope.resolve(left.text)
    if (!binding) return undefined
    let rhs = lowerExpression(expr.right, sourceFile, scope, diagnostics)
    if (!rhs) return undefined
    if (rhs.op === 'lit' && typeof rhs.value === 'number') {
      rhs = { op: 'lit', type: binding.type, value: rhs.value }
    }
    const target: Expr =
      binding.kind === 'param'
        ? { op: 'param', type: binding.type, name: binding.name }
        : { op: 'varref', type: binding.type, name: binding.name }
    return { s: 'assignOp', target, bop: '+', expr: rhs }
  }
  pushDiag(diagnostics, sourceFile, expr, 'Unsupported for-update.', TS_CODES.UNSUPPORTED)
  return undefined
}

function lowerBody(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  if (ts.isBlock(node)) return lowerStatements(node.statements, sourceFile, scope, diagnostics)
  const one = lowerStatement(node, sourceFile, scope, diagnostics)
  if (!one) return []
  return Array.isArray(one) ? one : [one]
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
