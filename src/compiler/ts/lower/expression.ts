// === Expression lowering ===
import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { irNameOf, type LoweringScope } from '../context.js'
import { resolveLangConst } from '../math-alias.js'
import { foldConstComponents, foldConstNumber } from '../loop-bound.js'
import { broadcastResultType, numericMismatch, retargetLit } from '../numeric.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerIndex, lowerSelect, matVecMul } from './index-select.js'
import { refuseBareAtomic } from './atomics.js'
import { lowerCall } from './expression-call.js'
import { lowerNew, lowerThis } from './class-methods.js'
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
/** `x as T`, `<T>x` and `x satisfies T`: the operand, lowered against the claimed type when
 *  that type is one this surface knows, since the claim is the contextual type TypeScript
 *  gives it. `as const` claims no type of its own and is the operand unchanged.
 *
 *  A claim that names a type the operand does not have is refused: `as` and `satisfies` emit
 *  nothing, so the value would travel under a name it does not have, and the conversion the
 *  author meant has a spelling of its own. */
function lowerTypeClaim(
  node: ts.Expression,
  typeNode: ts.TypeNode,
  keyword: 'as' | 'satisfies',
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual: ShaderType | undefined,
): Expr | undefined {
  const operand = (node as ts.AsExpression | ts.SatisfiesExpression | ts.TypeAssertion).expression
  // `as const` is a literal's own type and names nothing this surface maps.
  const isConst =
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'const'
  const claimed = isConst ? undefined : mapTsTypeToShaderType(typeNode, sourceFile, /* quiet */ [])
  const lowered = lowerExpression(operand, sourceFile, scope, diagnostics, claimed ?? contextual)
  if (!lowered || claimed === undefined) return lowered
  if (typeKey(lowered.type) !== typeKey(claimed)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${keyword}" states a type, it does not convert: "${node.getText(sourceFile)}" is ` +
        `${typeKey(lowered.type)}, not ${typeNode.getText(sourceFile)}. Write ` +
        `${typeNode.getText(sourceFile)}(...) to convert, or drop the "${keyword}".`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return lowered
}

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
  // `this` and `new` belong to a class with members (#86): the method's object, and the
  // class's constructor function.
  if (node.kind === ts.SyntaxKind.ThisKeyword)
    return lowerThis(node, sourceFile, scope, diagnostics)
  if (ts.isNewExpression(node)) return lowerNew(node, sourceFile, scope, diagnostics)
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
  // TypeScript's type-level shapes (roadmap 0.3 item T7, #92). `x as T`, `<T>x`,
  // `x as const`, `x satisfies T` and `x!` are claims about a type, not conversions: each
  // emits exactly what its operand emits, which is what it does in TypeScript. A developer
  // writes them without thinking, and before this every one was
  // "TS8099 Unsupported expression".
  //
  // An assertion that names a DIFFERENT shader type is the one shape that does not pass, and
  // for the reason the rule gives: `0.5 as i32` would have to emit a conversion, and `as`
  // emits nothing, so a silent f32 would travel under an i32's name.
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return lowerTypeClaim(node, node.type, 'as', sourceFile, scope, diagnostics, contextual)
  }
  if (ts.isSatisfiesExpression(node)) {
    return lowerTypeClaim(node, node.type, 'satisfies', sourceFile, scope, diagnostics, contextual)
  }
  if (ts.isNonNullExpression(node)) {
    return lowerExpression(node.expression, sourceFile, scope, diagnostics, contextual)
  }
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
  if (ts.isArrayLiteralExpression(node)) {
    // A list is lowered against a declared `array<T, N>` (#8 A16), which only a declaration
    // gives it; anywhere else there is no type to fill, so say which spelling does work rather
    // than repeating the generic "Unsupported expression".
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A list is only an initializer: write it as "const xs: array<T, ${node.elements.length}> = [...]", or call array<T, ${node.elements.length}>(...) here.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
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
      return { op: 'param', type: binding.type, name: irNameOf(binding) }
    case 'module':
      return { op: 'constref', type: binding.type, name: binding.name }
    // A resource binding is a module-scope `var`, so it reads as a `varref` — the same shape
    // the fn() EDSL builds. `constref` here is what #14 was: invisible to the binding
    // reachability walk, which counts `varref` names alone. Spelled as an exhaustive switch
    // rather than a fallthrough so a fifth BindingKind cannot silently land on this arm.
    case 'modvar': {
      // Workgroup memory is a compute entry's alone (§24): a vertex or fragment entry that
      // names it is refused here, on the read, with the reason. A helper function has no
      // stage and passes; Tint decides for it from the entry that calls it.
      const stage = scope.currentStage()
      if (binding.space === 'workgroup' && (stage === 'vertex' || stage === 'fragment')) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"${node.text}" is workgroup memory, which only a compute entry has; a ${stage} entry cannot read or write it.`,
          TS_CODES.MODULE_VAR,
        )
        return undefined
      }
      if (refuseBareAtomic(binding.type, node, sourceFile, scope, diagnostics)) return undefined
      return { op: 'varref', type: binding.type, name: irNameOf(binding) }
    }
    case 'binding':
    case 'local':
      // A `storage<atomic<u32>>` binding is a location, not a value (lower/atomics.ts).
      if (refuseBareAtomic(binding.type, node, sourceFile, scope, diagnostics)) return undefined
      return { op: 'varref', type: binding.type, name: irNameOf(binding) }
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
    // `!m` on a vector of bools is componentwise (§27): the same compare-with-false the scalar
    // form lowers to, against a vector of falses, which WGSL spells `!m` too and GLSL `not(m)`.
    if (operand.type.kind === 'vec' && operand.type.elem === 'bool') {
      const no: Expr = { op: 'lit', type: boolT, value: false }
      return {
        op: 'compare',
        type: operand.type,
        cop: '==',
        a: operand,
        b: {
          op: 'construct',
          type: operand.type,
          args: Array.from({ length: operand.type.n }, () => no),
        },
      }
    }
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

/** Whether `e` is a divisor the constant folder proves is zero in at least one component. */
export function divisorIsZero(e: Expr, scope: LoweringScope): boolean {
  const parts = foldConstComponents(e, scope)
  return parts !== undefined && parts.some((v) => v === 0)
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
    // A divisor this can PROVE is zero (a literal, a scalar const, a vector constructor with a
    // zero component, arithmetic over those) is refused wherever a division is lowered, not
    // only inside a module constant's initializer (#68): Tint rejects `1.0 / 0.0` as a value
    // f32 cannot represent, ANGLE folds it with a warning, and the oracle would answer
    // Infinity or NaN. A divisor that does not fold is not proven anything and passes.
    if ((arith === '/' || arith === '%') && divisorIsZero(right, scope)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.right,
        `Division by zero: "${node.right.getText(sourceFile)}" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
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
    // A constant shift amount outside 0..31 has no bit to shift into: WGSL makes it a
    // shader-creation error and GLSL ES 3.00 leaves the result undefined (#71). The fold is
    // the loop bound's, so `16 + 16` and a module const are caught with the literal; a
    // runtime amount is left alone, since WGSL masks it to the low five bits.
    if (bit === '<<' || bit === '>>') {
      const amount = foldConstNumber(right, scope)
      if (amount !== undefined && (amount < 0 || amount >= 32)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.right,
          `A shift amount must be between 0 and 31, got ${String(amount)}: a 32-bit integer has no bit to shift into.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
    }
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
    // Two vectors compare componentwise and yield a vector of bools (§27), which `any`, `all`
    // and `select` take. An ordering on bools has no meaning on either target.
    if (left.type.kind === 'vec') {
      if (left.type.elem === 'bool' && cmp !== '==' && cmp !== '!=') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"${cmp}" has no meaning on ${typeKey(left.type)}: compare bool vectors with === or !==, or reduce them with any() or all().`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      return {
        op: 'compare',
        type: { kind: 'vec', n: left.type.n, elem: 'bool' },
        cop: cmp,
        a: left,
        b: right,
      }
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
