// === Statement lowering ===

import ts from 'typescript'
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { numericMismatch } from '../numeric.js'
import { lowerExpression } from './expression.js'
import { lowerFor, lowerSwitch, lowerUpdate, lowerWhile } from './control.js'

const ASSIGN_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: '+',
  [ts.SyntaxKind.MinusEqualsToken]: '-',
  [ts.SyntaxKind.AsteriskEqualsToken]: '*',
  [ts.SyntaxKind.SlashEqualsToken]: '/',
  [ts.SyntaxKind.PercentEqualsToken]: '%',
}

export function lowerStatements(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const out: Stmt[] = []
  for (const stmt of statements) {
    const lowered = lowerStatement(stmt, sourceFile, scope, diagnostics)
    if (lowered === undefined) continue
    if (Array.isArray(lowered)) out.push(...lowered)
    else out.push(lowered)
  }
  return out
}

export function lowerStatement(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  if (ts.isBlock(node)) return lowerBlock(node, sourceFile, scope, diagnostics)
  if (ts.isReturnStatement(node)) {
    if (!node.expression) return { s: 'return' }
    const expr = lowerExpression(node.expression, sourceFile, scope, diagnostics)
    if (!expr) return undefined
    return { s: 'return', expr }
  }
  if (ts.isIfStatement(node)) return lowerIf(node, sourceFile, scope, diagnostics)
  if (ts.isForStatement(node)) return lowerFor(node, sourceFile, scope, diagnostics)
  if (ts.isWhileStatement(node)) return lowerWhile(node, sourceFile, scope, diagnostics)
  if (ts.isSwitchStatement(node)) return lowerSwitch(node, sourceFile, scope, diagnostics)
  if (ts.isBreakStatement(node)) {
    if (!scope.inLoop()) {
      pushDiag(diagnostics, sourceFile, node, 'break is only valid inside a loop or switch.')
      return undefined
    }
    return { s: 'break' }
  }
  if (ts.isContinueStatement(node)) {
    if (!scope.inLoop()) {
      pushDiag(diagnostics, sourceFile, node, 'continue is only valid inside a loop.')
      return undefined
    }
    return { s: 'continue' }
  }
  if (ts.isVariableStatement(node)) return lowerVariableStatement(node, sourceFile, scope, diagnostics)
  if (ts.isExpressionStatement(node)) return lowerExpressionStatement(node, sourceFile, scope, diagnostics)
  pushDiag(diagnostics, sourceFile, node, `Unsupported statement "${truncate(node.getText(sourceFile))}".`)
  return undefined
}

function lowerBlock(
  node: ts.Block,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  scope.push()
  try {
    return lowerStatements(node.statements, sourceFile, scope, diagnostics)
  } finally {
    scope.pop()
  }
}

function lowerVariableStatement(
  node: ts.VariableStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  const flags = node.declarationList.flags
  const isConst = (flags & ts.NodeFlags.Const) !== 0
  const isLet = (flags & ts.NodeFlags.Let) !== 0
  if (!isConst && !isLet) {
    pushDiag(diagnostics, sourceFile, node, 'Use "const" or "let". The JS "var" keyword is not supported.')
    return undefined
  }
  const results: Stmt[] = []
  for (const decl of node.declarationList.declarations) {
    const one = lowerVariableDeclaration(decl, isConst, sourceFile, scope, diagnostics)
    if (one) results.push(one)
  }
  if (results.length === 0) return undefined
  return results.length === 1 ? results[0] : results
}

function lowerVariableDeclaration(
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  if (!ts.isIdentifier(decl.name)) {
    pushDiag(diagnostics, sourceFile, decl.name, 'Destructuring is not supported.')
    return undefined
  }
  const name = decl.name.text
  if (scope.hasInCurrent(name)) {
    pushDiag(diagnostics, sourceFile, decl.name, `Duplicate binding "${name}" in this scope.`)
    return undefined
  }
  let annotated: ShaderType | undefined
  if (decl.type) {
    annotated = mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    if (!annotated) return undefined
  }
  if (!decl.initializer) {
    pushDiag(diagnostics, sourceFile, decl, `"${isConst ? 'const' : 'let'} ${name}" requires an initializer.`)
    return undefined
  }
  let init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics)
  if (!init) return undefined
  if (annotated && init.op === 'lit') {
    if (typeof init.value === 'number' && isNumericScalar(annotated)) {
      init = { op: 'lit', type: annotated, value: init.value }
    } else if (typeof init.value === 'boolean' && typeKey(annotated) === 'bool') {
      init = { op: 'lit', type: annotated, value: init.value }
    }
  }
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    pushDiag(diagnostics, sourceFile, decl, numericMismatch(`let/const ${name}`, annotated, init.type))
    return undefined
  }
  const bindingType = annotated ?? init.type
  const constValue = isConst && init.op === 'lit' ? init.value : undefined
  try {
    scope.define({ kind: 'local', name, type: bindingType, mutable: !isConst, constValue })
  } catch (e) {
    pushDiag(diagnostics, sourceFile, decl.name, e instanceof Error ? e.message : String(e))
    return undefined
  }
  if (isConst) return { s: 'let', name, expr: init }
  return { s: 'var', name, type: bindingType, init }
}

function lowerExpressionStatement(
  node: ts.ExpressionStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const expr = node.expression
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    return lowerUpdate(expr, sourceFile, scope, diagnostics)
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return lowerAssign(expr.left, expr.right, sourceFile, scope, diagnostics)
  }
  if (ts.isBinaryExpression(expr)) {
    const bop = ASSIGN_OP[expr.operatorToken.kind]
    if (bop !== undefined) return lowerAssignOp(expr.left, bop, expr.right, sourceFile, scope, diagnostics)
  }
  pushDiag(diagnostics, sourceFile, node, `Unsupported expression statement "${truncate(node.getText(sourceFile))}".`)
  return undefined
}

function lowerAssign(
  left: ts.Expression,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const target = lowerLValue(left, sourceFile, scope, diagnostics)
  if (!target) return undefined
  const value = lowerExpression(right, sourceFile, scope, diagnostics)
  if (!value) return undefined
  if (typeKey(target.type) !== typeKey(value.type)) {
    pushDiag(diagnostics, sourceFile, right, numericMismatch(`assign to ${typeKey(target.type)}`, target.type, value.type))
    return undefined
  }
  return { s: 'assign', target, expr: value }
}

function lowerAssignOp(
  left: ts.Expression,
  bop: BinOp,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const target = lowerLValue(left, sourceFile, scope, diagnostics)
  if (!target) return undefined
  const value = lowerExpression(right, sourceFile, scope, diagnostics)
  if (!value) return undefined
  if (typeKey(target.type) !== typeKey(value.type)) {
    pushDiag(diagnostics, sourceFile, right, numericMismatch(`${bop}=`, target.type, value.type))
    return undefined
  }
  return { s: 'assignOp', target, bop, expr: value }
}

function lowerLValue(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (!ts.isIdentifier(node)) {
    pushDiag(diagnostics, sourceFile, node, 'Assignment target must be a simple identifier.')
    return undefined
  }
  const binding = scope.resolve(node.text)
  if (!binding) {
    pushDiag(diagnostics, sourceFile, node, `Cannot assign to unknown name "${node.text}".`)
    return undefined
  }
  if (!binding.mutable) {
    pushDiag(diagnostics, sourceFile, node, `Cannot assign to "${node.text}" — it is declared with const.`)
    return undefined
  }
  if (binding.kind === 'param') return { op: 'param', type: binding.type, name: binding.name }
  return { op: 'varref', type: binding.type, name: binding.name }
}

function lowerIf(
  node: ts.IfStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const cond = lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (!cond) return undefined
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(diagnostics, sourceFile, node.expression, `if condition must be bool, got ${typeKey(cond.type)}.`)
    return undefined
  }
  const thenBody = lowerBranch(node.thenStatement, sourceFile, scope, diagnostics)
  const ifArms: { cond: Expr; body: readonly Stmt[] }[] = [{ cond, body: thenBody }]
  let elseBody: readonly Stmt[] | undefined
  if (node.elseStatement) {
    if (ts.isIfStatement(node.elseStatement)) {
      const nested = lowerIf(node.elseStatement, sourceFile, scope, diagnostics)
      if (nested && nested.s === 'if') {
        ifArms.push(...nested.arms)
        elseBody = nested.elseBody
      }
    } else {
      elseBody = lowerBranch(node.elseStatement, sourceFile, scope, diagnostics)
    }
  }
  return { s: 'if', arms: ifArms, elseBody }
}

function lowerBranch(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  if (ts.isBlock(node)) return lowerBlock(node, sourceFile, scope, diagnostics)
  scope.push()
  try {
    const one = lowerStatement(node, sourceFile, scope, diagnostics)
    if (!one) return []
    return Array.isArray(one) ? one : [one]
  } finally {
    scope.pop()
  }
}

function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'f32' || k === 'i32' || k === 'u32'
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

function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}
