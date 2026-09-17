// === Expression lowering ===
import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveLangConst } from '../math-alias.js'
import { broadcastResultType, numericMismatch, retargetLit } from '../numeric.js'
import { lowerIndex, lowerSelect, matVecMul } from './index-select.js'
import { lowerCall } from './expression-call.js'
import { lowerObjectLiteral, lowerPropertyAccess } from './expression-prop.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'

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

/**
 * Lower one TypeScript expression.
 *
 * `contextual` is the type the POSITION declares, when it declares one: a function's return
 * type, a `let`/`const` annotation, or a parameter type. Exactly one expression shape reads
 * it — an object literal, whose struct cannot be inferred from the literal itself (#8 A11) —
 * and every other shape ignores it, which is why it is an optional trailing argument rather
 * than a parameter threaded through the whole walk. A caller that has no type to offer passes
 * nothing and gets the behaviour it always had.
 */
export function lowerExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  if (ts.isParenthesizedExpression(node))
    return lowerExpression(node.expression, sourceFile, scope, diagnostics, contextual)
  if (ts.isIdentifier(node)) return lowerIdentifier(node, sourceFile, scope, diagnostics)
  if (ts.isNumericLiteral(node)) return { op: 'lit', type: f32T, value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { op: 'lit', type: boolT, value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { op: 'lit', type: boolT, value: false }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    if (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        '++/-- is a statement, not a value.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    if (ts.isPrefixUnaryExpression(node))
      return lowerPrefixUnary(node, sourceFile, scope, diagnostics)
  }
  if (ts.isObjectLiteralExpression(node))
    return lowerObjectLiteral(node, sourceFile, scope, diagnostics, contextual)
  if (ts.isBinaryExpression(node)) return lowerBinary(node, sourceFile, scope, diagnostics)
  if (ts.isCallExpression(node)) {
    const call = lowerCall(node, sourceFile, scope, diagnostics)
    // The one expression kind that carries a span in this increment: stepping into a helper
    // has to tell two calls in one statement apart. A call that lowered to something else —
    // an intrinsic the front end expands, a constructor — keeps no span, since the node it
    // produced is no longer a call site.
    return call?.op === 'call' ? withSpan(call, sourceFile, node) : call
  }
  if (ts.isPropertyAccessExpression(node))
    return lowerPropertyAccess(node, sourceFile, scope, diagnostics)
  if (ts.isElementAccessExpression(node)) return lowerIndex(node, sourceFile, scope, diagnostics)
  if (ts.isConditionalExpression(node))
    return lowerSelect(node, sourceFile, scope, diagnostics, contextual)
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression "${node.getText(sourceFile)}".`,
    TS_CODES.UNSUPPORTED,
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
    const c = resolveLangConst(node.text)
    if (c !== undefined) return { op: 'lit', type: f32T, value: c }
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Unknown identifier "${node.text}".`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  switch (binding.kind) {
    case 'param':
      return { op: 'param', type: binding.type, name: binding.name }
    case 'module':
      return { op: 'constref', type: binding.type, name: binding.name }
    // A resource binding is a module-scope `var`, so it reads as a `varref` — the same shape
    // the fn() EDSL builds. `constref` here is what #14 was: invisible to the binding
    // reachability walk, which counts `varref` names alone. Spelled as an exhaustive switch
    // rather than a fallthrough so a fifth BindingKind cannot silently land on this arm.
    case 'binding':
    case 'local':
      return { op: 'varref', type: binding.type, name: binding.name }
    // A specialization constant is its own IR node: the optimizer must never fold an
    // overrideref, since its value is not known until the pipeline is built (#8 A7).
    case 'override':
      return { op: 'overrideref', type: binding.type, name: binding.name }
    default: {
      const never: never = binding.kind
      throw new Error(`typeshade: unhandled BindingKind ${String(never)}`)
    }
  }
}

function lowerPrefixUnary(
  node: ts.PrefixUnaryExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const operand = lowerExpression(node.operand, sourceFile, scope, diagnostics)
  if (!operand) return undefined
  if (node.operator === ts.SyntaxKind.MinusToken)
    return { op: 'unop', type: operand.type, a: operand }
  if (node.operator === ts.SyntaxKind.ExclamationToken) {
    if (typeKey(operand.type) !== 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "!" requires a bool operand, got ${typeKey(operand.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return {
      op: 'compare',
      type: boolT,
      cop: '==',
      a: operand,
      b: { op: 'lit', type: boolT, value: false },
    }
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported unary operator.', TS_CODES.UNSUPPORTED)
  return undefined
}

/** Retargets a bare numeric literal on either side to its peer's kind. The peer of a literal
 *  that meets a vector is the vector's element scalar (`v * 2` with `v: vec3<u32>` types the
 *  `2` as u32, and against a vec64 the literal becomes an f64 carrying the full double); a
 *  scalar peer is taken as is, so `i + 1` with `i: u32` behaves as before. */
function pair(left: Expr, right: Expr, lNode: ts.Expression, rNode: ts.Expression): [Expr, Expr] {
  return [retargetLit(left, lNode, right.type), retargetLit(right, rNode, left.type)]
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
      // A vector against a scalar of its element kind broadcasts, as it does in WGSL, GLSL and
      // the fn() EDSL; the result is the vector's type and the operand order stays as written.
      const broadcast = broadcastResultType(left.type, right.type, arith)
      if (broadcast) return { op: 'binop', type: broadcast, bop: arith, a: left, b: right }
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(node.operatorToken.getText(sourceFile), left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'binop', type: left.type, bop: arith, a: left, b: right }
  }
  // `a ** b` is WGSL's and GLSL's pow(a, b); TypeScript's exponent operator is the only
  // arithmetic token with no binop of its own. pow is component-wise over equal types on both
  // targets, so the two operands must agree — and it is defined for FLOATS only, so an
  // integer pair is refused here rather than emitted as `pow(i32, i32)`, which Tint answers
  // with "no matching call to 'pow(i32, i32)'" and ANGLE with "no matching overloaded
  // function".
  if (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Type mismatch: cannot ** ${typeKey(left.type)} and ${typeKey(right.type)}. ` +
          '** is pow(a, b), which takes two values of one type; ' +
          'splat the exponent, e.g. v ** vec3(2.).',
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    if (!isFloatPowOperand(left.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot ** ${typeKey(left.type)}. ** is pow(a, b), which WGSL and GLSL ES 3.00 define ` +
          'for f32 only; cast first, e.g. f32(a) ** f32(b).',
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'call', type: left.type, fn: 'pow', args: [left, right] }
  }
  const bit = BITWISE[node.operatorToken.kind]
  if (bit !== undefined) {
    if (typeKey(left.type) !== typeKey(right.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch('bitwise', left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
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
        `Logical "${log}" requires bool operands.`,
        TS_CODES.TYPE_MISMATCH,
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
        numericMismatch('compare', left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'compare', type: boolT, cop: cmp, a: left, b: right }
  }
  if (
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    pushDiag(diagnostics, sourceFile, node, 'Use strict equality === / !==.', TS_CODES.UNSUPPORTED)
    return undefined
  }
  if (node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Unsigned right shift >>> is not supported.',
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  pushDiag(diagnostics, sourceFile, node, 'Unsupported binary operator.', TS_CODES.UNSUPPORTED)
  return undefined
}

/** `pow` is float-only on both targets: an f32 scalar, or a vector of f32. An emulated-double
 *  is out too — there is no df64 pow. */
function isFloatPowOperand(t: ShaderType): boolean {
  if (t.kind === 'vec') return t.elem === 'f32'
  return typeKey(t) === 'f32'
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

export function exprType(expr: Expr): ShaderType {
  return expr.type
}
