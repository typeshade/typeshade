import ts from 'typescript'
import type { Expr, Stmt } from '../../../core/ir/nodes.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import { analyzeCountedFor, loopConditionError } from '../loop-bound.js'
import { lowerExpression } from './expression.js'
import { lowerStatement, lowerStatements } from './statement.js'

export function lowerFor(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (!node.condition) {
    pushDiag(diagnostics, sourceFile, node, 'for is missing an exit condition; infinite loops are not allowed.')
    return undefined
  }
  if (!node.initializer || !ts.isVariableDeclarationList(node.initializer)) {
    pushDiag(diagnostics, sourceFile, node, 'for-init must be `let i: i32 = <const>`.')
    return undefined
  }
  scope.push()
  try {
    const initStmts = lowerStatements(
      [ts.factory.createVariableStatement(undefined, node.initializer)] as unknown as ts.Statement[],
      sourceFile,
      scope,
      diagnostics,
    )
    // factory node has no real positions; lower the original list via a synthetic walk.
    void initStmts
  } finally {
    scope.pop()
  }
  return lowerForFromParts(node, sourceFile, scope, diagnostics)
}

function lowerForFromParts(
  node: ts.ForStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const list = node.initializer as ts.VariableDeclarationList
  scope.push()
  scope.enterLoop()
  try {
    const initNode = list.declarations[0]
    if (!initNode || !ts.isIdentifier(initNode.name)) {
      pushDiag(diagnostics, sourceFile, node, 'for-init must declare one identifier.')
      return undefined
    }
    const fakeVar = ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList(list.declarations, ts.NodeFlags.Let),
    )
    // Reuse statement lowering on the original VariableDeclarationList by wrapping.
    const initStmt = lowerInitList(list, sourceFile, scope, diagnostics)
    if (!initStmt) return undefined
    const cond = lowerExpression(node.condition!, sourceFile, scope, diagnostics)
    if (!cond) return undefined
    if (typeKey(cond.type) !== 'bool') {
      pushDiag(diagnostics, sourceFile, node.condition!, `for condition must be bool, got ${typeKey(cond.type)}.`)
      return undefined
    }
    if (!node.incrementor) {
      pushDiag(diagnostics, sourceFile, node, 'for-update is required (e.g. i++).')
      return undefined
    }
    const update = lowerUpdate(node.incrementor, sourceFile, scope, diagnostics)
    if (!update) return undefined
    const counted = analyzeCountedFor(initStmt, cond, update, scope)
    if (!counted.ok) {
      pushDiag(diagnostics, sourceFile, node, counted.message)
      return undefined
    }
    const body = lowerBody(node.statement, sourceFile, scope, diagnostics)
    return { s: 'for', init: initStmt, cond, update, body }
  } finally {
    scope.exitLoop()
    scope.pop()
  }
}

function lowerInitList(
  list: ts.VariableDeclarationList,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const wrapped: ts.VariableStatement = {
    ...((list.parent && ts.isVariableStatement(list.parent) ? list.parent : undefined) as ts.VariableStatement),
    kind: ts.SyntaxKind.VariableStatement,
    declarationList: list,
    modifiers: undefined,
    parent: list.parent,
    flags: list.flags,
  } as ts.VariableStatement
  if (list.parent && ts.isVariableStatement(list.parent)) {
    const out = lowerStatement(list.parent, sourceFile, scope, diagnostics)
    if (!out) return undefined
    return Array.isArray(out) ? out[0] : out
  }
  // ForStatement initializer is a VariableDeclarationList, not a VariableStatement.
  const asStmt = ts.factory.createVariableStatement(undefined, list)
  Object.assign(asStmt.declarationList, { parent: asStmt })
  const out = lowerStatement(asStmt, sourceFile, scope, diagnostics)
  if (!out) return undefined
  return Array.isArray(out) ? out[0] : out
  void wrapped
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
    pushDiag(diagnostics, sourceFile, node, err)
    return undefined
  }
  pushDiag(diagnostics, sourceFile, node, 'while is only accepted with a constant-false condition; use a counted for.')
  return undefined
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
    pushDiag(diagnostics, sourceFile, node.expression, `switch scrutinee must be i32 or u32, got ${k}.`)
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
      pushDiag(diagnostics, sourceFile, clause, 'switch case must be a numeric literal.')
      continue
    }
    if (clause.statements.length === 0) {
      pushDiag(diagnostics, sourceFile, clause, 'switch case fall-through is not allowed.')
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
      pushDiag(diagnostics, sourceFile, expr, 'Unsupported update operator.')
      return undefined
    }
    const targetExpr = expr.operand
    if (!ts.isIdentifier(targetExpr)) {
      pushDiag(diagnostics, sourceFile, expr, '++/-- target must be an identifier.')
      return undefined
    }
    const binding = scope.resolve(targetExpr.text)
    if (!binding || !binding.mutable) {
      pushDiag(diagnostics, sourceFile, expr, `Cannot assign to "${targetExpr.text}" — it is declared with const.`)
      return undefined
    }
    const target: Expr =
      binding.kind === 'param'
        ? { op: 'param', type: binding.type, name: binding.name }
        : { op: 'varref', type: binding.type, name: binding.name }
    const one: Expr = { op: 'lit', type: binding.type, value: 1 }
    return { s: 'assignOp', target, bop: op === ts.SyntaxKind.PlusPlusToken ? '+' : '-', expr: one }
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
    const left = expr.left
    if (!ts.isIdentifier(left)) return undefined
    const binding = scope.resolve(left.text)
    if (!binding) return undefined
    const rhs = lowerExpression(expr.right, sourceFile, scope, diagnostics)
    if (!rhs) return undefined
    const target: Expr =
      binding.kind === 'param'
        ? { op: 'param', type: binding.type, name: binding.name }
        : { op: 'varref', type: binding.type, name: binding.name }
    return { s: 'assignOp', target, bop: '+', expr: rhs }
  }
  pushDiag(diagnostics, sourceFile, expr, 'Unsupported for-update.')
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
): void {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  diagnostics.push({ message, fileName: sourceFile.fileName, line: line + 1, character: character + 1, category: 'error' })
}
