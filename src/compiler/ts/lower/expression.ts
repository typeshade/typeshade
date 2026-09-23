// === Expression lowering ===
import ts from 'typescript'
import type { Expr, BinOp, CmpOp, LogOp } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, boolT, i32T, u32T, isF64, isVec64, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { irNameOf, type LoweringScope } from '../context.js'
import { resolveLangConst } from '../math-alias.js'
import { foldConstComponents, foldConstNumber } from '../loop-bound.js'
import {
  broadcastResultType,
  f64WidenResultType,
  numericMismatch,
  retargetLit,
} from '../numeric.js'
import {
  foldNumericLit,
  retargetIntLitCtx,
  shiftAmountMessage,
  shiftAmountOutOfRange,
} from '../lit-coerce.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { lowerIndex, lowerSelect, matVecMul } from './index-select.js'
import { lowerArrayLiteral } from './expression-array.js'
import { refuseBareAtomic } from './atomics.js'
import { lowerCall } from './expression-call.js'
import { lowerNew, lowerThis } from './class-methods.js'
import { lowerObjectLiteral, lowerPropertyAccess } from './expression-prop.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { TS_CODES, type TsCode } from '../codes.js'
import { unknownNameAlreadyReported } from '../refused-names.js'

const ARITH: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusToken]: '+',
  [ts.SyntaxKind.MinusToken]: '-',
  [ts.SyntaxKind.AsteriskToken]: '*',
  [ts.SyntaxKind.SlashToken]: '/',
  [ts.SyntaxKind.PercentToken]: '%',
}
/** The largest finite f32, `(2 - 2^-23) * 2^127`. A literal past it has no f32 to be. */
const MAX_F32 = 3.4028234663852886e38

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
  if (ts.isNumericLiteral(node)) {
    const v = Number(node.text)
    // A decimal float literal that overflows f32 is a shader-creation error in WGSL and
    // implementation-defined in GLSL ES 3.00 (§52). `1e40` reached the writer, which printed
    // `1e+40` — a value f32 cannot hold, so the shader ran on a number nobody wrote. An
    // Magnitude alone decides, with no "is it integer-written" test: `1e40` IS a whole
    // number to JavaScript, and the integer kinds a literal can be retargeted to bound at
    // ±2^31 and 2^32, far below this. So a value past the f32 range has no target type at
    // all, and `lit-coerce.ts`'s own bound check never sees it.
    if (Number.isFinite(v) && Math.abs(v) > MAX_F32) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${node.text} is outside the range of f32 (about ±3.4e38), and there is no wider ` +
          `type here for it to take.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'lit', type: f32T, value: v }
  }
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
    // A list is lowered against a declared `array<T, N>` (#8 A16), which a declaration gives
    // it — and so does any other position that declares one: a return whose function is
    // declared `array<f32, 2>`, an argument whose parameter is, a field of a struct being
    // built. Those are exactly the positions a tuple is written in (roadmap 0.3 item T10,
    // #92), and each already carries its declared type here as `contextual`.
    if (contextual?.kind === 'array') {
      return lowerArrayLiteral(node, contextual, sourceFile, scope, diagnostics)
    }
    // With no type declared anywhere there is nothing to fill, so say which spelling does work
    // rather than repeating the generic "Unsupported expression".
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A list takes its type from the position it is written in: declare one, as "const xs: array<T, ${node.elements.length}> = [...]" or a return type, or call array<T, ${node.elements.length}>(...) here.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  // `super` (roadmap 0.3 item T5, #92). A method a class inherits is lowered into that class,
  // so an ordinary inherited call needs no `super`; what `super` is for is a method that
  // OVERRIDES another and wants the base's body, and a derived constructor, which TypeScript
  // requires to call `super(...)`. Neither has a form here yet, and the generic
  // "Unsupported expression" said nothing about what to write instead.
  if (node.kind === ts.SyntaxKind.SuperKeyword) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"super" has no form here yet. A class inherits its base's methods already, so a call ` +
        `that does not override needs no "super"; for one that does, give the base's body a ` +
        `method of its own name and call that from both.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A string has no GPU representation: there is nothing for it to be at run time, and no ` +
        `instruction takes one. Text that picks between cases is an enum, whose members are ` +
        `numbers; text a human reads belongs on the host.`,
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

/** The two operators that ask what a value is at run time, and why neither can (roadmap 0.3
 *  item T10, #92). Both are read before the operands are lowered. */
const RUNTIME_TYPE_TEST: Readonly<Partial<Record<ts.SyntaxKind, string>>> = {
  [ts.SyntaxKind.InstanceOfKeyword]:
    '"instanceof" asks what a value is at run time. A struct on the GPU is its fields and ' +
    'nothing else — no type tag to read — and every call this file emits is resolved at ' +
    'compile time, so a base-typed value is its base. Give the struct a field saying which ' +
    'kind it holds, and branch on that.',
  [ts.SyntaxKind.InKeyword]:
    '"in" asks which fields a value has at run time. A struct on the GPU has exactly the ' +
    'fields its type declares, known at compile time, so the answer is already in the type: ' +
    'write the field access.',
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
    // A name whose declaration was refused, or one an error already covers, says nothing
    // more: the refusal is the one diagnostic for the one mistake (Rule 12.4, #171).
    if (unknownNameAlreadyReported(node, node.text, sourceFile, diagnostics)) return undefined
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
  if (node.operator === ts.SyntaxKind.MinusToken) {
    // WGSL defines unary `-` for the signed and floating kinds and their vectors, and NOT for
    // u32 (§52): `-u` on a u32 emitted `(-u)` and Tint answered `no matching overload for
    // 'operator - (u32)'`. The two spellings that do work are named, because "unsupported"
    // alone leaves an author guessing which one they wanted.
    const k = operand.type.kind === 'vec' ? operand.type.elem : typeKey(operand.type)
    if (k === 'u32') {
      // The two spellings are written for the operand's OWN width: `0u - x` and `i32(x)` are
      // not expressions on a `vec4u`, so a vector operand is told `vec4u(0u) - x` and
      // `vec4i(x)`, which is what an author would have to write.
      const n = operand.type.kind === 'vec' ? operand.type.n : 0
      const zero = n === 0 ? '0u' : `vec${String(n)}u(0u)`
      const signed = n === 0 ? 'i32(x)' : `vec${String(n)}i(x)`
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "-" is not defined on ${typeKey(operand.type)}; WGSL has no negation for an ` +
          `unsigned integer. Write ${zero} - x to wrap, or ${signed} to change kind first.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return { op: 'unop', type: operand.type, a: operand }
  }
  // Unary `+` is the identity WGSL and GLSL both give it, so it lowers to its operand and
  // emits nothing (§52). Refusing it meant a program that reads `+1.` in a list of signed
  // constants had to drop the sign that made the list line up.
  if (node.operator === ts.SyntaxKind.PlusToken) {
    const k = operand.type.kind === 'vec' ? operand.type.elem : typeKey(operand.type)
    if (k === 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "+" requires a numeric operand, got ${typeKey(operand.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    return operand
  }
  // `~x`, the bitwise complement (§52). Both targets spell it `~x`; it is an INTRINSIC rather
  // than an IR `unop`, because that node is negation-only and carries no operator field.
  if (node.operator === ts.SyntaxKind.TildeToken) {
    const k = operand.type.kind === 'vec' ? operand.type.elem : typeKey(operand.type)
    if (k !== 'i32' && k !== 'u32') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unary "~" requires an i32 or u32 operand, got ${typeKey(operand.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    // The intrinsic id is the OPERATOR, not a name: CSE keys a call by `fn` alone
    // (passes/opt/expr-utils.ts), so an id an author can also spell — `bitNot` — would let a
    // user function of that name and `~x` share one key and fold into each other, silently,
    // on the GPU and in the oracle alike. `~` is not a TypeScript identifier, so no author
    // declaration can collide with it.
    return { op: 'call', type: operand.type, fn: '~', args: [operand] }
  }
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
  // Read before the operands: `d instanceof B` would lower `B` first and report "Unknown
  // identifier B" — a complaint about the one part of the line that is spelled right
  // (roadmap 0.3 item T10, #92).
  const asked = RUNTIME_TYPE_TEST[node.operatorToken.kind]
  if (asked !== undefined) {
    pushDiag(diagnostics, sourceFile, node, asked, TS_CODES.UNSUPPORTED)
    return undefined
  }
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
      // An f32 beside a scalar f64 widens exactly, as it does in the fn() EDSL and as the
      // fp64 pass's contract states (#151 F64-02).
      const widened = f64WidenResultType(left.type, right.type, arith)
      if (widened) return { op: 'binop', type: widened, bop: arith, a: left, b: right }
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(node.operatorToken.getText(sourceFile), left.type, right.type),
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    // WGSL gives a matrix `+`, `-` and `*` and no `/` or `%` (and GLSL ES 3.00 agrees). Two
    // matrices of one shape pass the key check above without ever reaching `binResultType`,
    // so `m / n` was accepted here and emitted `(a / b)`, which both compilers refuse.
    if (left.type.kind === 'mat' && (arith === '/' || arith === '%')) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot ${arith} ${typeKey(left.type)}: a matrix has + - and * on both targets and no ` +
          `${arith}. Divide the columns, or multiply by the inverse you computed.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    // WGSL's matrix product cancels the shared dimension — `matKxR * matCxK -> matCxR`, so
    // the left operand's COLUMN count must equal the right operand's ROW count. `matVecMul`
    // above types every pair that meets and returns undefined for one that does not, which
    // then falls to the key check; but two matrices of ONE non-square shape have one key, so
    // nothing looked at their dimensions and the pair was typed as the left operand.
    // `mat2x3 * mat2x3` reached Tint as `(a * b)` and came back "no matching overload for
    // 'operator * (mat2x3<f32>, mat2x3<f32>)'" (#169). `binResultType` already refuses it in
    // the fn() EDSL (SD0001), so this is the two surfaces agreeing again.
    if (
      arith === '*' &&
      left.type.kind === 'mat' &&
      right.type.kind === 'mat' &&
      left.type.cols !== right.type.rows
    ) {
      const meets =
        typeKey(left.type) === typeKey(right.type)
          ? ` transpose(${node.right.getText(sourceFile)}) turns this pair into one that meets.`
          : ''
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Type mismatch: cannot * ${typeKey(left.type)} and ${typeKey(right.type)}. WGSL's ` +
          `matrix product is matKxR * matCxK -> matCxR: the left operand's ` +
          `${String(left.type.cols)} columns must meet the right operand's ` +
          `${String(right.type.rows)} rows.${meets}`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    // `%` is the one arithmetic operator the emulation has no body for: there is no
    // df64 remainder, and `binResultType` refuses the pair in the fn() EDSL for the same
    // reason. Same-typed operands pass the key check above, so without this the program
    // reached emit and came back as a span-less SD0041 (#151).
    if (arith === '%' && (isF64(left.type) || isVec64(left.type))) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot % ${typeKey(left.type)}: the emulated double has no remainder — the fp64 ` +
          `pass has a df64 body for + - * / and the comparisons only. Narrow first, e.g. ` +
          `${isF64(left.type) ? 'f32(x) % f32(y)' : `vec${(left.type as { n: number }).n}(v) % vec${(left.type as { n: number }).n}(w)`}.`,
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
    const isShift = bit === '<<' || bit === '>>'
    if (isShift) {
      const amount = foldConstNumber(right, scope)
      if (amount !== undefined && shiftAmountOutOfRange(amount)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.right,
          shiftAmountMessage(amount),
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
    }
    // A SHIFT amount is a u32 whatever the target is (§52). WGSL's only scalar overload is
    // `e1 << e2` with `e2: u32`, so `x << n` with an i32 `n` emitted `(x << n)`, which Tint
    // refuses with `no matching overload for 'operator << (i32, i32)'` — while `x << 1u`, the
    // one spelling it accepts, was refused HERE by the equal-types rule below. The compound
    // path (`y <<= n`) already did this; the binary path did not, which is the whole of row
    // L38. An integer literal takes u32, an i32 amount goes through the `u32(...)` cast the
    // surface already has, and GLSL ES 3.00 allows the mixed signedness that produces
    // (glsl-es-300.txt §5.9: the operands of a shift need not have the same type). `&`, `|`
    // and `^` keep the equality rule: there both operands must be one type on both targets.
    if (isShift) {
      // An integer-WRITTEN literal still types f32 by default (roadmap item 25), so
      // `1 << 0` — the way a bit flag is spelled — arrived here as two f32s. Retarget each
      // side to the kind a shift is defined for before the check below reads it; the amount
      // is then retyped to u32 again a few lines on, which is idempotent for a literal.
      left = retargetIntLitCtx(left, node.left, i32T)
      right = retargetIntLitCtx(right, node.right, u32T)
      // A shift is defined componentwise, so read the ELEMENT kind: `vec2u << vec2u` is a
      // shift of two lanes, not a type error. The width rule below keeps the two sides the
      // same shape, which is what both targets accept.
      const amountKind = intElem(right.type)
      if (amountKind === undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.right,
          `Bitwise "${bit}" needs an i32 or u32 shift amount, got ${typeKey(right.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      const targetKind = intElem(left.type)
      if (targetKind === undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node.left,
          `Bitwise "${bit}" needs an i32 or u32 target, got ${typeKey(left.type)}.`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      // WGSL's vector overload is `vecN<T> << vecN<u32>` — the amount is a vector of the SAME
      // width, never a scalar broadcast (Tint: `no matching overload for 'operator << (vec2<u32>,
      // u32)'`). GLSL ES 3.00 §5.9 does allow the scalar form, so refusing it here is what keeps
      // one source compiling on both; splat the amount to say it explicitly.
      const lanes = laneCount(left.type)
      if (lanes !== laneCount(right.type)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `Bitwise "${bit}" shifts ${typeKey(left.type)} by ${typeKey(right.type)}: a shift amount ` +
            `has the width of its target. Splat it, e.g. ${typeKey(left.type)} << vec${String(lanes)}u(n).`,
          TS_CODES.TYPE_MISMATCH,
        )
        return undefined
      }
      // A bare literal amount is retyped rather than wrapped, so `x << 1` stays one token.
      const folded = foldNumericLit(right)
      const amountT: ShaderType = lanes === 1 ? u32T : { kind: 'vec', n: lanes, elem: 'u32' }
      const amount: Expr =
        folded.op === 'lit' && typeof folded.value === 'number' && Number.isInteger(folded.value)
          ? { op: 'lit', type: u32T, value: folded.value }
          : amountKind === 'i32'
            ? lanes === 1
              ? { op: 'call', type: u32T, fn: 'u32', args: [right] }
              : { op: 'construct', type: amountT, args: [right] }
            : right
      return { op: 'binop', type: left.type, bop: bit, a: left, b: amount }
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
    // An f32 compared against a scalar f64 widens exactly, the same rule the arithmetic
    // follows and the one `binResultType` applies in the fn() EDSL, whose `f64.lt(f32)`
    // builds and emits. Without it `s < t` was a mismatch while `s - t < 0.` was not (#151).
    if (f64WidenResultType(left.type, right.type, '-') !== undefined) {
      return { op: 'compare', type: boolT, cop: cmp, a: left, b: right }
    }
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

/** The integer element kind of a shift/bitwise operand — the scalar's own kind, or a
 *  vector's element — or undefined when the type is not an integer one. */
function intElem(t: ShaderType): 'i32' | 'u32' | undefined {
  const k = t.kind === 'vec' ? t.elem : typeKey(t)
  return k === 'i32' || k === 'u32' ? k : undefined
}

/** How many lanes a value carries: a vector's width, 1 for a scalar. */
function laneCount(t: ShaderType): 1 | 2 | 3 | 4 {
  return t.kind === 'vec' ? t.n : 1
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
