// === Expression lowering ===
import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp, FuncDecl } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, i32T, vec2fT, vec3fT, vec4fT, structT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import {
  expectedArity,
  isCanonicalMathFn,
  resolveLangConst,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js'
import { expandMath } from '../math-expand.js'
import { parseSwizzle } from '../swizzle.js'
import { lowerRandomHash } from '../random-hash.js'
import { SCALAR_CAST, lowerScalarCast, numericMismatch } from '../numeric.js'
import { retargetIntLit } from '../lit-coerce.js'
import { lowerIndex, lowerSelect, matVecMul } from './index-select.js'
import { fillArray, noneOf, unrollMinMax, unrollPred, unrollSum, unrollZip } from '../array-ops.js'
import { mapTsTypeToShaderType } from '../type-map.js'

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
const VEC_CTOR: Readonly<Record<string, { n: number; type: ShaderType }>> = {
  vec2: { n: 2, type: vec2fT },
  vec2f: { n: 2, type: vec2fT },
  vec3: { n: 3, type: vec3fT },
  vec3f: { n: 3, type: vec3fT },
  vec4: { n: 4, type: vec4fT },
  vec4f: { n: 4, type: vec4fT },
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
