// === Expression lowering: TS AST -> TypeShade Expr (Phase 3) ===
//
// Supported forms:
//   identifiers (param / local via LoweringScope)
//   numeric / boolean literals
//   a + b | a - b | a * b | a / b | a % b
//   bitwise: a & b | a | b | a ^ b | a << b | a >> b
//   logical: a && b | a || b
//   -a | !a
//   a < b | a > b | a <= b | a >= b | a === b | a !== b
//
// Produces plain Expr data shapes from core/ir/nodes — the same shapes
// the existing fn() authoring path builds.
//
// --- Modulo: two different TypeShade meanings (do not conflate) ---
//
//   TS / WGSL operator  a % b
//     → IR { op: 'binop', bop: '%' }   (TRUNCATED mod, sign of dividend)
//     Same as Node.prototype.mod / WGSL `%` / JS `%`.
//     Example: (-1) % 4  →  -1
//
//   Free function  mod(x, y)  in the EDSL (core/ir/node.ts)
//     → IR { op: 'call', name: 'mod', ... }  (FLOOR mod, sign of divisor)
//     Portable wrap used for angles / domain repetition.
//     Example: mod(-1, 4)  →  3
//
// "use typeshade" source uses the TS operator `%` for the first meaning.
// The free-function form is a CallExpression and is handled in Phase 6;
// until then we emit a targeted diagnostic so authors do not assume
// `mod(a, b)` already lowers to floor-mod.

import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'

/** Arithmetic binops. `%` is TRUNCATED modulo (see file header). */
const ARITH: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusToken]: '+',
  [ts.SyntaxKind.MinusToken]: '-',
  [ts.SyntaxKind.AsteriskToken]: '*',
  [ts.SyntaxKind.SlashToken]: '/',
  // Truncated mod → binop '%'. NOT the free-function floor-mod `mod(x,y)`.
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

  // CallExpression: not lowered in Phase 3. Special-case `mod(...)` so authors
  // do not confuse the free-function floor-mod with the `%` operator.
  if (ts.isCallExpression(node)) {
    return lowerCallStub(node, sourceFile, diagnostics)
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression "${node.getText(sourceFile)}". Phase 3 supports literals, identifiers, arithmetic (+ - * / %), bitwise, logical, unary - !, and comparisons.`,
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

  const bit = BITWISE[node.operatorToken.kind]
  if (bit !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Bitwise operand type mismatch: ${typeKey(left.type)} vs ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'binop', type: left.type, bop: bit, a: left, b: right }
  }

  const log = LOGICAL[node.operatorToken.kind]
  if (log !== undefined) {
    if (typeKey(left.type) !== 'bool' || typeKey(right.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Logical "${log}" requires bool operands, got ${typeKey(left.type)} and ${typeKey(right.type)}.`,
      )
      return undefined
    }
    return { op: 'logical', type: boolT, lop: log, a: left, b: right }
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

  if (node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Unsigned right shift ">>>" is not supported. Use ">>" (WGSL/GLSL have no >>>).',
    )
    return undefined
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported binary operator "${node.operatorToken.getText(sourceFile)}". Phase 3 supports + - * / %, bitwise, logical, and comparisons.`,
  )
  return undefined
}

/**
 * Phase 3 does not lower calls. `mod(a, b)` gets an explicit diagnostic pointing
 * authors at `%` (truncated) vs Phase 6 free-function floor-mod.
 */
function lowerCallStub(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): undefined {
  const callee = node.expression
  const name = ts.isIdentifier(callee) ? callee.text : undefined
  if (name === 'mod') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'mod(x, y) is TypeShade floor-modulo (sign of divisor) and is not lowered until Phase 6 (function call). ' +
        'For truncated modulo matching WGSL/JS "%", write "a % b" instead (IR binop "%").',
    )
    return undefined
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Function calls are not lowered in Phase 3 (got "${node.getText(sourceFile)}"). See Phase 6.`,
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
