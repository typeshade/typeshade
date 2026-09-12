// === Expression lowering ===
import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveLangConst } from '../math-alias.js'
import { numericMismatch } from '../numeric.js'
import { retargetIntLit } from '../lit-coerce.js'
import { lowerIndex, lowerSelect, matVecMul } from './index-select.js'
import { lowerCall } from './expression-call.js'
import { lowerObjectLiteral, lowerPropertyAccess } from './expression-prop.js'

const ARITH: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusToken]: '+',
  [ts.SyntaxKind.MinusToken]: '-',
  [ts.SyntaxKind.AsteriskToken]: '*',
  [ts.SyntaxKind.SlashToken]: '/',
  [ts.SyntaxKind.PercentToken]: '%',
}
const BITWISE: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.AmpersandToken]: '&',
  [ts.SyntaxKind.BarToken]: '|',
  [ts.SyntaxKind.CaretToken]: '^',
  [ts.SyntaxKind.LessThanLessThanToken]: '<<',
  [ts.SyntaxKind.GreaterThanGreaterThanToken]: '>>',
}
const LOGICAL: Readonly<Record<number, LogOp>> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: '&&',
  [ts.SyntaxKind.BarBarToken]: '||',
}
const COMPARE: Readonly<Record<number, CmpOp>> = {
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.GreaterThanToken]: '>',
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!=',
}

export function lowerExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (ts.isParenthesizedExpression(node)) return lowerExpression(node.expression, sourceFile, scope, diagnostics)
  if (ts.isIdentifier(node)) return lowerIdentifier(node, sourceFile, scope, diagnostics)
  if (ts.isNumericLiteral(node)) return { op: 'lit', type: f32T, value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { op: 'lit', type: boolT, value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { op: 'lit', type: boolT, value: false }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
      pushDiag(diagnostics, sourceFile, node, '++/-- is a statement, not a value.')
      return undefined
    }
    if (ts.isPrefixUnaryExpression(node)) return lowerPrefixUnary(node, sourceFile, scope, diagnostics)
  }
  if (ts.isObjectLiteralExpression(node)) return lowerObjectLiteral(node, sourceFile, scope, diagnostics)
  if (ts.isBinaryExpression(node)) return lowerBinary(node, sourceFile, scope, diagnostics)
  if (ts.isCallExpression(node)) return lowerCall(node, sourceFile, scope, diagnostics)
  if (ts.isPropertyAccessExpression(node)) return lowerPropertyAccess(node, sourceFile, scope, diagnostics)
  if (ts.isElementAccessExpression(node)) return lowerIndex(node, sourceFile, scope, diagnostics)
  if (ts.isConditionalExpression(node)) return lowerSelect(node, sourceFile, scope, diagnostics)
  pushDiag(diagnostics, sourceFile, node, `Unsupported expression "${node.getText(sourceFile)}".`)
  return undefined
}

function lowerIdentifier(
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const binding = scope.resolve(node.text)
  if (!binding) {
    const c = resolveLangConst(node.text)
    if (c !== undefined) return { op: 'lit', type: f32T, value: c }
    pushDiag(diagnostics, sourceFile, node, `Unknown identifier "${node.text}".`)
    return undefined
  }
  if (binding.kind === 'param') return { op: 'param', type: binding.type, name: binding.name }
  if (binding.kind === 'module') return { op: 'constref', type: binding.type, name: binding.name }
  return { op: 'varref', type: binding.type, name: binding.name }
}

function lowerPrefixUnary(
  node: ts.PrefixUnaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const operand = lowerExpression(node.operand, sourceFile, scope, diagnostics)
  if (!operand) return undefined
  if (node.operator === ts.SyntaxKind.MinusToken) return { op: 'unop', type: operand.type, a: operand }
  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    if (typeKey(operand.type) !== 'bool') {
      pushDiag(diagnostics, sourceFile, node, `Unary "!" requires a bool operand, got ${typeKey(operand.type)}.`)
      return undefined
    }
    return { op: 'compare', type: boolT, cop: '==', a: operand, b: { op: 'lit', type: boolT, value: false } }
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported unary operator.')
  return undefined
}

function pair(left: Expr, right: Expr, lNode: ts.Expression, rNode: ts.Expression): [Expr, Expr] {
  return [retargetIntLit(left, lNode, right.type), retargetIntLit(right, rNode, left.type)]
}

function lowerBinary(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  let left = lowerExpression(node.left, sourceFile, scope, diagnostics)
  let right = lowerExpression(node.right, sourceFile, scope, diagnostics)
  if (!left || !right) return undefined
  ;[left, right] = pair(left, right, node.left, node.right)
  const arith = ARITH[node.operatorToken.kind]
  if (arith !== undefined) {
    if (arith === '*') {
      const mixed = matVecMul(left, right)
      if (mixed) return mixed
    }
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(diagnostics, sourceFile, node, numericMismatch('add/sub/mul/div/%', left.type, right.type))
      return undefined
    }
    return { op: 'binop', type: left.type, bop: arith, a: left, b: right }
  }
  const bit = BITWISE[node.operatorToken.kind]
  if (bit !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(diagnostics, sourceFile, node, numericMismatch('bitwise', left.type, right.type))
      return undefined
    }
    return { op: 'binop', type: left.type, bop: bit, a: left, b: right }
  }
  const log = LOGICAL[node.operatorToken.kind]
  if (log !== undefined) {
    if (typeKey(left.type) !== 'bool' || typeKey(right.type) !== 'bool') {
      pushDiag(diagnostics, sourceFile, node, `Logical "${log}" requires bool operands.`)
      return undefined
    }
    return { op: 'logical', type: boolT, lop: log, a: left, b: right }
  }
  const cmp = COMPARE[node.operatorToken.kind]
  if (cmp !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(diagnostics, sourceFile, node, numericMismatch('compare', left.type, right.type))
      return undefined
    }
    return { op: 'compare', type: boolT, cop: cmp, a: left, b: right }
  }
  if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) {
    pushDiag(diagnostics, sourceFile, node, 'Use strict equality === / !==.')
    return undefined
  }
  if (node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    pushDiag(diagnostics, sourceFile, node, 'Unsigned right shift >>> is not supported.')
    return undefined
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported binary operator.')
  return undefined
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

export function exprType(expr: Expr): ShaderType {
  return expr.type
}
