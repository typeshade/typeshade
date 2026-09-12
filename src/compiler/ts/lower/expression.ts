// === Expression lowering: TS AST -> TypeShade Expr (Phase 3) ===
//
// Supported forms:
//   identifiers (param / local via LoweringScope)
//   numeric / boolean literals
//   a + b | a - b | a * b | a / b
//   -a | !a
//   a < b | a > b | a <= b | a >= b | a === b | a !== b
//
// Produces plain Expr data shapes from core/ir/nodes — the same shapes
// the existing fn() authoring path builds.

import ts from 'typescript'
import type { Expr, BinOp, CmpOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'

const ARITH: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusToken]: '+',
  [ts.SyntaxKind.MinusToken]: '-',
  [ts.SyntaxKind.AsteriskToken]: '*',
  [ts.SyntaxKind.SlashToken]: '/',
}

const COMPARE: Readonly<Record<number, CmpOp>> = {
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.GreaterThanToken]: '>',
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!=',
}

/**
 * Lower a TypeScript expression node to a TypeShade {@link Expr}.
 * Returns undefined and pushes a diagnostic on unsupported forms.
 */
export function lowerExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (ts.isParenthesizedExpression(node)) {
    return lowerExpression(node.expression, sourceFile, scope, diagnostics)
  }

  if (ts.isIdentifier(node)) {
    return lowerIdentifier(node, sourceFile, scope, diagnostics)
  }

  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text)
    return { op: 'lit', type: f32T, value }
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { op: 'lit', type: boolT, value: true }
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { op: 'lit', type: boolT, value: false }
  }

  if (ts.isPrefixUnaryExpression(node)) {
    return lowerPrefixUnary(node, sourceFile, scope, diagnostics)
  }

  if (ts.isBinaryExpression(node)) {
    return lowerBinary(node, sourceFile, scope, diagnostics)
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression "${node.getText(sourceFile)}". Phase 3 supports literals, identifiers, + - * /, unary - !, and comparisons.`,
  )
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
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Unknown identifier "${node.text}". It is not a parameter or local in scope.`,
    )
    return undefined
  }
  if (binding.kind === 'param') {
    return { op: 'param', type: binding.type, name: binding.name }
  }
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

  if (node.operator === ts.SyntaxKind.MinusToken) {
    return { op: 'unop', type: operand.type, a: operand }
  }

  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    if (typeKey(operand.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "!" requires a bool operand, got ${typeKey(operand.type)}.`,
      )
      return undefined
    }
    const falseLit: Expr = { op: 'lit', type: boolT, value: false }
    return {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: operand,
      b: falseLit,
    }
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported unary operator in "${node.getText(sourceFile)}". Phase 3 supports "-" and "!".`,
  )
  return undefined
}

function lowerBinary(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const left = lowerExpression(node.left, sourceFile, scope, diagnostics)
  const right = lowerExpression(node.right, sourceFile, scope, diagnostics)
  if (!left || !right) return undefined

  const arith = ARITH[node.operatorToken.kind]
  if (arith !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Arithmetic operand type mismatch: ${typeKey(left.type)} vs ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'binop', type: left.type, bop: arith, a: left, b: right }
  }

  const cmp = COMPARE[node.operatorToken.kind]
  if (cmp !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Comparison operand type mismatch: ${typeKey(left.type)} vs ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'compare', type: boolT, cop: cmp, a: left, b: right }
  }

  if (
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Use strict equality "=== / !==" in "use typeshade" sources (got "${node.operatorToken.getText(sourceFile)}").`,
    )
    return undefined
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported binary operator "${node.operatorToken.getText(sourceFile)}". Phase 3 supports + - * / and comparisons.`,
  )
  return undefined
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): void {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  diagnostics.push({
    message,
    fileName: sourceFile.fileName,
    line: line + 1,
    character: character + 1,
    category: 'error',
  })
}

/** Exported for tests: result type of a successfully lowered expression. */
export function exprType(expr: Expr): ShaderType {
  return expr.type
}
