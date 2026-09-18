// === Statement lowering ===

import ts from 'typescript'
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { isVec, isVec64, typeKey, u32T } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope, irNameOf, readOnlyPhrase, type Binding } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { refuseAtomicDeclaration } from './atomics.js'
import { lowerBarrierStatement } from './barriers.js'
import { isBarrierIntrinsic } from '../../../core/intrinsics.js'
import { broadcastResultType, numericMismatch, retargetLit } from '../numeric.js'
import { retargetDeclaredIntLit, retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { lowerCall } from './expression-call.js'
import { lowerArrayLiteral } from './expression-array.js'
import { lowerFor, lowerSwitch, lowerUpdate, lowerWhile } from './control.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { foldNumericLit } from '../lit-coerce.js'
import { foldConstNumber, foldConstComponents } from '../loop-bound.js'
import { TS_CODES, type TsCode } from '../codes.js'

const ASSIGN_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: '+',
  [ts.SyntaxKind.MinusEqualsToken]: '-',
  [ts.SyntaxKind.AsteriskEqualsToken]: '*',
  [ts.SyntaxKind.SlashEqualsToken]: '/',
  [ts.SyntaxKind.PercentEqualsToken]: '%',
}

/** The bitwise compound assignments (#8 A10). Separate from {@link ASSIGN_OP} because they
 *  carry a rule the arithmetic five do not: the target must be an integer scalar. The
 *  `assignOp` IR node and both CPU backends have always taken them — the oracle's own
 *  comment names `x >>= y` on an i32 target — so this is the spelling catching up, not a
 *  new operation. */
const BITWISE_ASSIGN_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.AmpersandEqualsToken]: '&',
  [ts.SyntaxKind.BarEqualsToken]: '|',
  [ts.SyntaxKind.CaretEqualsToken]: '^',
  [ts.SyntaxKind.LessThanLessThanEqualsToken]: '<<',
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: '>>',
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

/** Lowers one TypeScript statement, then stamps every IR statement it produced with `node`'s
 *  source span unless a finer capture site already stamped one (`withSpan` keeps the first).
 *  Doing it here, at the one place every statement kind passes through, is what makes span
 *  capture total: a new statement kind inherits it by being lowered, not by remembering to
 *  call something. A `ts.Block` lowers to its own inner statements, each of which already
 *  carries its own span, so the blanket stamp is a no-op there. */
export function lowerStatement(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  const lowered = lowerStatementNode(node, sourceFile, scope, diagnostics)
  if (lowered === undefined) return undefined
  if (Array.isArray(lowered)) {
    for (const s of lowered) withSpan(s, sourceFile, node)
    return lowered
  }
  return withSpan(lowered, sourceFile, node)
}

function lowerStatementNode(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  if (ts.isBlock(node)) return lowerBlock(node, sourceFile, scope, diagnostics)
  if (ts.isReturnStatement(node)) {
    if (!node.expression) return { s: 'return' }
    // The declared return type is the context an object literal needs: `return { pos, uv }`
    // in a function declared VsOut builds a VsOut, even when another struct has the same
    // fields (#8 A11).
    const expr = lowerExpression(
      node.expression,
      sourceFile,
      scope,
      diagnostics,
      scope.returnType(),
    )
    if (!expr) return undefined
    // `return 0` takes the declared return type when that type is i32 or u32 (#8 A3).
    const ret = scope.returnType()
    return { s: 'return', expr: ret ? retargetIntLitCtx(expr, node.expression, ret) : expr }
  }
  if (ts.isIfStatement(node)) return lowerIf(node, sourceFile, scope, diagnostics)
  if (ts.isForStatement(node)) return lowerFor(node, sourceFile, scope, diagnostics)
  if (ts.isWhileStatement(node)) return lowerWhile(node, sourceFile, scope, diagnostics)
  if (ts.isSwitchStatement(node)) return lowerSwitch(node, sourceFile, scope, diagnostics)
  if (ts.isBreakStatement(node)) {
    // The message has always said "loop or switch"; only the loop half was checked, so the
    // `break` every TypeScript author ends a `case` with was rejected by the very sentence
    // that said it was allowed (#8 A10). lowerSwitch drops a TRAILING break — the IR switch
    // has no fall-through and each backend writes its own case terminator — so this reaches
    // the IR only for a break that leaves the switch early, which is a real statement.
    if (!scope.inLoop() && !scope.inSwitch()) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'break is only valid inside a loop or switch.',
        TS_CODES.BREAK_OUTSIDE,
      )
      return undefined
    }
    return { s: 'break' }
  }
  if (ts.isContinueStatement(node)) {
    if (!scope.inLoop()) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'continue is only valid inside a loop.',
        TS_CODES.BREAK_OUTSIDE,
      )
      return undefined
    }
    return { s: 'continue' }
  }
  if (ts.isVariableStatement(node))
    return lowerVariableStatement(node, sourceFile, scope, diagnostics)
  if (ts.isExpressionStatement(node))
    return lowerExpressionStatement(node, sourceFile, scope, diagnostics)
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported statement "${truncate(node.getText(sourceFile))}".`,
    TS_CODES.UNSUPPORTED,
  )
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
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Use "const" or "let". The JS "var" keyword is not supported.',
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  // One declarator is the overwhelmingly common case, and there the statement IS the
  // declaration: stamping the declarator alone gives a span starting after the `const`/`let`
  // keyword, so a breakpoint on that line points mid-statement. Several declarators genuinely
  // lower to several IR statements, and there each must span its own, or stepping through
  // `const a = 1, b = 2` highlights the whole line twice.
  const single = node.declarationList.declarations.length === 1
  const results: Stmt[] = []
  for (const decl of node.declarationList.declarations) {
    // The node whose span the lowered statement takes, decided here because only this level
    // knows how many declarators there are.
    const one = lowerVariableDeclaration(
      decl,
      isConst,
      sourceFile,
      scope,
      diagnostics,
      single ? node : decl,
    )
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
  spanNode: ts.Node = decl,
): Stmt | undefined {
  if (!ts.isIdentifier(decl.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      'Destructuring is not supported.',
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  const name = decl.name.text
  if (scope.hasInCurrent(name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      `Duplicate binding "${name}" in this scope.`,
      TS_CODES.DUPLICATE_SYMBOL,
    )
    return undefined
  }
  let annotated: ShaderType | undefined
  if (decl.type) {
    annotated = mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    if (!annotated) return undefined
    if (refuseAtomicDeclaration(annotated, decl.type, sourceFile, diagnostics, 'a local'))
      return undefined
  }
  if (!decl.initializer) {
    // `let x: f32;` — declare now, assign later (#8 A10). WGSL's `var x: f32;` and GLSL's
    // `float x;` are the same statement, `Stmt.var.init` has always been optional, and the
    // EDSL spells it `Var(f32T)`; only this surface insisted on a value. A `const` has
    // nothing to assign later, and an unannotated `let` has no type to declare, so both
    // keep a refusal — now one that says which of the two is missing.
    if (isConst) {
      pushDiag(
        diagnostics,
        sourceFile,
        decl,
        `"const ${name}" requires an initializer.`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    if (!annotated) {
      pushDiag(
        diagnostics,
        sourceFile,
        decl,
        `"let ${name}" without an initializer needs a type annotation, e.g. let ${name}: f32;`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    const bound = defineLocal(
      name,
      annotated,
      true,
      undefined,
      decl,
      sourceFile,
      scope,
      diagnostics,
    )
    if (!bound) return undefined
    return withSpan(
      { s: 'var', name: irNameOf(bound), type: annotated } as Stmt,
      sourceFile,
      spanNode,
    )
  }
  // `const xs: array<f32, 3> = [1., 2., 3.]` (#8 A16). A list carries no type of its own, so it
  // is lowered AGAINST the annotation instead of on its own, and refused where there is none.
  // From here it is the ordinary `construct` the `array<f32, 3>(...)` call builds, so the rest
  // of this function — the type check, the binding, the span — does not know the difference.
  // Every other initializer takes the annotation as its CONTEXT (#8 A11), which is the weaker
  // form of the same idea: an object literal reads it to pick its struct, a bare integer
  // literal to take its type, and everything else ignores it.
  let init: Expr | undefined
  if (ts.isArrayLiteralExpression(decl.initializer)) {
    if (!annotated) {
      const kw = isConst ? 'const' : 'let'
      pushDiag(
        diagnostics,
        sourceFile,
        decl,
        `"${kw} ${name}" needs an array type annotation to take a list, e.g. ${kw} ${name}: array<f32, ${decl.initializer.elements.length}> = [...].`,
        TS_CODES.UNKNOWN_TYPE,
      )
      return undefined
    }
    init = lowerArrayLiteral(decl.initializer, annotated, sourceFile, scope, diagnostics)
  } else {
    init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics, annotated)
  }
  if (!init) return undefined
  // A call that returns nothing has nothing to bind: `const x = store(1)` emitted
  // `let x = store(1u);`, which Tint refuses, with no diagnostic.
  if (init.type.kind === 'void') {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.initializer,
      `"${truncate(decl.initializer.getText(sourceFile))}" returns nothing, so it cannot initialize "${name}"; call it on its own line.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (annotated) {
    if (init.op === 'lit' && typeof init.value === 'boolean' && typeKey(annotated) === 'bool') {
      init = { op: 'lit', type: annotated, value: init.value }
    } else {
      // `let j: i32 = -1` takes its declared type like any other position (#8 A3, issue #40).
      // A negative literal is a PrefixUnaryExpression, not a NumericLiteral, so the
      // `init.op === 'lit'` special case this replaces never fired for one and the author was
      // told to cast an integer they had already written. `retargetDeclaredIntLit` keeps that
      // old special case as its fallback — `let y: i32 = 0.` and `let y: i32 = 1e3` compiled
      // before this item and still do — while `let j: i32 = 1.5` stays refused, since the
      // fallback takes an integral value only and the type check below catches the rest.
      init = retargetDeclaredIntLit(init, decl.initializer, annotated)
    }
  }
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      numericMismatch(`let/const ${name}`, annotated, init.type),
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  const bindingType = annotated ?? init.type
  const constValue = init.op === 'lit' ? init.value : undefined
  // `const a = src` keeps the name it copies, so `a.length` on a storage array is answered the
  // way `src.length` is (#46). Only a bare name; an element or a field is a different value.
  const aliasOf = init.op === 'varref' ? init.name : undefined
  const bound = defineLocal(
    name,
    bindingType,
    !isConst,
    constValue,
    decl,
    sourceFile,
    scope,
    diagnostics,
    aliasOf,
  )
  if (!bound) return undefined
  // The statement carries the IR name, `p_1` for a `p` that shadows or follows another `p` in
  // the function (#38); the symbol table and every diagnostic keep the source name.
  const ir = irNameOf(bound)
  if (isConst) return withSpan({ s: 'let', name: ir, expr: init } as Stmt, sourceFile, spanNode)
  return withSpan({ s: 'var', name: ir, type: bindingType, init } as Stmt, sourceFile, spanNode)
}

/** Register a local binding, turning the scope's throw into a diagnostic on the declaration.
 *  Shared by the two declaration shapes — with an initializer and without.
 *
 *  @returns the binding as the scope stored it, with the IR name the statement must carry,
 *  or `undefined` after pushing a diagnostic. */
function defineLocal(
  name: string,
  type: ShaderType,
  mutable: boolean,
  constValue: number | boolean | undefined,
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  aliasOf?: string,
): Binding | undefined {
  let bound: Binding
  try {
    bound = scope.define({
      kind: 'local',
      name,
      type,
      mutable,
      constValue,
      ...(aliasOf !== undefined ? { aliasOf } : {}),
    })
  } catch (e) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      e instanceof Error ? e.message : String(e),
      TS_CODES.DUPLICATE_SYMBOL,
    )
    return undefined
  }
  // #51 records the NAME's span with the declared type, for hover; the caller's `withSpan`
  // records the STATEMENT's, for stepping (#32). Complementary, and both wanted. This sits
  // here rather than at the one call site it had, so the declaration WITHOUT an initializer
  // (`let x: f32;`) is recorded too — the editor should know a name the language now accepts.
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'local', type, mutable })
  return bound
}

function lowerExpressionStatement(
  node: ts.ExpressionStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const expr = node.expression
  // `discard;` — WGSL's fragment kill, which the IR already carries as its own statement and
  // both writers spell (`discard;` in WGSL, `discard;` in GLSL ES 3.00). It reads to the TS
  // parser as an expression statement naming `discard`, so it is caught here, before the
  // identifier is looked up as a value and reported as unknown.
  if (ts.isIdentifier(expr) && expr.text === 'discard' && !scope.resolve('discard')) {
    return { s: 'discard' }
  }
  // `store(gid.x);` — a call whose value is dropped, kept for its effect (#47). It lowers
  // through the same path a call in an expression takes, so the callee, arity and argument
  // rules are the ones every call gets; only the statement form is new. A value-returning
  // builtin may stand alone too (`max(a, b);` is legal TypeScript), and the optimizer drops
  // it as the nothing it computes. What may not stand alone is a value that is not a call at
  // all: a vector constructor, a `select`, an array fold. Those build and drop, and TypeShade
  // says so rather than emitting a statement neither target has a use for.
  if (ts.isCallExpression(expr)) {
    // A barrier is a statement and nothing else (§25): lowered here, where it stands alone,
    // with its placement rules; in expression position `lowerCall` refuses it. A function the
    // file declares under the name keeps the call, as with every builtin name.
    if (
      ts.isIdentifier(expr.expression) &&
      isBarrierIntrinsic(expr.expression.text) &&
      scope.resolveCallee(expr.expression.text) === undefined
    ) {
      const barrier = lowerBarrierStatement(
        expr.expression.text,
        expr,
        sourceFile,
        scope,
        diagnostics,
      )
      return barrier ? { s: 'call', expr: barrier } : undefined
    }
    const call = lowerCall(expr, sourceFile, scope, diagnostics)
    if (!call) return undefined
    if (call.op !== 'call') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${truncate(node.getText(sourceFile))}" builds a value and drops it. Only a function call may stand alone as a statement; assign the value or remove the line.`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    return { s: 'call', expr: call }
  }
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    return lowerUpdate(expr, sourceFile, scope, diagnostics)
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return lowerAssign(expr.left, expr.right, sourceFile, scope, diagnostics)
  }
  if (ts.isBinaryExpression(expr)) {
    const bop = ASSIGN_OP[expr.operatorToken.kind]
    if (bop !== undefined)
      return lowerAssignOp(expr.left, bop, expr.right, sourceFile, scope, diagnostics)
    const bit = BITWISE_ASSIGN_OP[expr.operatorToken.kind]
    if (bit !== undefined)
      return lowerBitwiseAssignOp(expr.left, bit, expr.right, sourceFile, scope, diagnostics)
    if (expr.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken) {
      // The same refusal `a >>> b` gets in lowerBinary, so the two spellings of an
      // unsupported operator do not disagree about why they are unsupported.
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Unsigned right shift >>>= is not supported.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression statement "${truncate(node.getText(sourceFile))}".`,
    TS_CODES.UNSUPPORTED,
  )
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
  // The target's type is the context for the right-hand side, so `o = { x: 1., y: 2. }` knows
  // which struct it builds the same way `const o: A = { … }` does (#8 A11). An assignment
  // target is a DECLARED position: the name was annotated where it was declared, and the
  // lvalue carries that type here. Without this the literal fell through to the
  // unique-struct fallback and a second struct of the same shape refused it.
  let value = lowerExpression(right, sourceFile, scope, diagnostics, target.type)
  if (!value) return undefined
  // `x = 2` takes the target's type when it is i32 or u32 (#8 A3); the compound form already
  // did through lowerAssignOp.
  value = retargetIntLitCtx(value, right, target.type)
  if (typeKey(target.type) !== typeKey(value.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      numericMismatch(`assign to ${typeKey(target.type)}`, target.type, value.type),
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return { s: 'assign', target, expr: value }
}

/**
 * Lower `y <<= 1` and its four siblings (`>>=`, `&=`, `|=`, `^=`) — #8 A10.
 *
 * Kept apart from {@link lowerAssignOp} for one reason: the bitwise operators are defined
 * on integers only, and this is a form nothing accepted before, so refusing a float target
 * here rejects no source that compiles today. (`a & b` as an EXPRESSION has no such guard
 * and emits `(a & b)` for two `f32`s, which is not valid WGSL — a pre-existing hole that
 * tightening would break passing source, so it is left for its own change.)
 *
 * @returns the `assignOp` statement, or `undefined` after pushing a diagnostic.
 */
function lowerBitwiseAssignOp(
  left: ts.Expression,
  bop: BinOp,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const target = lowerLValue(left, sourceFile, scope, diagnostics)
  if (!target) return undefined
  const k = typeKey(target.type)
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      left,
      `Bitwise "${bop}=" needs an i32 or u32 target, got ${k}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  let value = lowerExpression(right, sourceFile, scope, diagnostics)
  if (!value) return undefined
  // A SHIFT amount is a u32 whatever the target is: WGSL's only scalar overload is
  // `e1 << e2` with `e2: u32`, so `y <<= k` with an i32 `k` on an i32 target emitted
  // `y <<= k;`, which Tint refuses (`no matching overload for 'operator <<= (i32, i32)'`),
  // while the one spelling it accepts — a u32 amount — was refused here by the equality rule.
  // An integer literal takes u32, an i32 amount goes through the `u32(...)` cast the surface
  // already has, and GLSL ES 3.00 allows the mixed signedness that produces. `&`, `|` and `^`
  // keep the equality rule: there both operands must be the one type on both targets.
  const isShift = bop === '<<' || bop === '>>'
  const want = isShift ? u32T : target.type
  // Folded first, so a leading minus is part of the number: `y |= -2` reaches here as a unop
  // over a literal, which the `op === 'lit'` retype below never matched, and the author was
  // told their i32 target could not take an f32.
  const folded = foldNumericLit(value)
  if (folded.op === 'lit' && typeof folded.value === 'number' && Number.isInteger(folded.value)) {
    if (folded.value < 0 && (isShift || typeKey(want) === 'u32')) {
      pushDiag(
        diagnostics,
        sourceFile,
        right,
        isShift
          ? `Bitwise "${bop}=" needs a non-negative shift amount, got ${String(folded.value)}.`
          : `Bitwise "${bop}=" on a u32 target needs a non-negative value, got ${String(folded.value)}.`,
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    value = { op: 'lit', type: want, value: folded.value }
  }
  // A constant amount of 32 or more has no bit to shift into: WGSL makes it a shader-creation
  // error and GLSL ES 3.00 leaves the result undefined, so it is refused here, as the negative
  // amount above is. The fold is the one the loop bound uses, so `16 + 16` and a module const
  // are caught with the literal; a runtime amount is left alone, since WGSL masks it (#71).
  const amount = isShift ? foldConstNumber(value, scope) : undefined
  if (amount !== undefined && amount >= 32) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      `Bitwise "${bop}=" needs a shift amount less than 32, got ${String(amount)}: a 32-bit integer has no bit to shift into.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (isShift && typeKey(value.type) === 'i32') {
    value = { op: 'call', type: u32T, fn: 'u32', args: [value] }
  }
  if (typeKey(value.type) !== typeKey(want)) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      isShift
        ? `Bitwise "${bop}=" needs an i32 or u32 shift amount, got ${typeKey(value.type)}.`
        : numericMismatch(`${bop}=`, target.type, value.type),
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  return { s: 'assignOp', target, bop, expr: value }
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
  let value = lowerExpression(right, sourceFile, scope, diagnostics)
  if (!value) return undefined
  // The same refusal `a / b` gets in lowerBinary (#68): a divisor proven zero is undefined on
  // every invocation, and `x /= 0.` is the same program as `x = x / 0.`.
  if ((bop === '/' || bop === '%') && foldConstComponents(value, scope)?.some((v) => v === 0)) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      `Division by zero: "${right.getText(sourceFile)}" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (value.op === 'lit' && typeof value.value === 'number' && isNumericScalar(target.type)) {
    value = { op: 'lit', type: target.type, value: value.value }
  } else if (isVec(target.type) || isVec64(target.type)) {
    // `v *= 2` with an integer vector target types the literal as the element kind; a
    // non-integer literal stays f32 and is diagnosed below instead of being truncated. A
    // vec64 target makes the literal an f64 so the full double reaches the fp64 pass.
    value = retargetLit(value, right, target.type)
  }
  if (typeKey(target.type) !== typeKey(value.type)) {
    // `v += s` with a vector target and a scalar of its element kind follows the same
    // broadcast rule as `v + s`; the result must still be the target's own type.
    const broadcast = broadcastResultType(target.type, value.type, bop)
    if (!broadcast || typeKey(broadcast) !== typeKey(target.type)) {
      const message =
        broadcast !== undefined
          ? `Type mismatch: cannot ${bop}= ${typeKey(target.type)} and ${typeKey(value.type)}. ` +
            `The result would be ${typeKey(broadcast)}, which does not fit the ${typeKey(target.type)} ` +
            `target; assign it to a vector, or reduce the vector to a scalar first.`
          : numericMismatch(`${bop}=`, target.type, value.type)
      pushDiag(diagnostics, sourceFile, right, message, TS_CODES.TYPE_MISMATCH)
      return undefined
    }
    if (isVec64(target.type)) {
      // The fp64 pass only lowers an assignOp on a vec64 target when the value is a vec64
      // too (it throws SD0041 for a scalar), while its binop arm widens a scalar operand. So
      // `w *= s` on a vec64 target is spelled as `w = w * s`, which emits and evaluates as
      // the binary form does.
      return {
        s: 'assign',
        target,
        expr: { op: 'binop', type: target.type, bop, a: target, b: value },
      }
    }
  }
  return { s: 'assignOp', target, bop, expr: value }
}

export function lowerLValue(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // `(v) = a` and `(v).x = a` name the same targets `v = a` and `v.x = a` do, so the
  // parentheses come off once, here, rather than in each branch below (where only the member
  // walk looked through them, and the fallback message then denied its own input).
  const node = ts.isParenthesizedExpression(expression) ? unwrapParens(expression) : expression
  if (ts.isPropertyAccessExpression(node)) {
    return lowerMemberLValue(node, sourceFile, scope, diagnostics)
  }
  if (ts.isElementAccessExpression(node)) {
    // The root of the chain decides writability, exactly as it does for a member target:
    // `cam.xs[i] = 1.` on a uniform and `p.xs[i] = 1.` on a parameter used to reach the
    // backend, because the binding was resolved only when the base was a bare identifier.
    if (!checkRootWritable(node, sourceFile, scope, diagnostics)) return undefined
    const idx = lowerExpression(node, sourceFile, scope, diagnostics)
    if (!idx || idx.op !== 'index') return undefined
    // The lvalue carries its own span (docs/debugging.md §5 decision 3): a debugger stopped on
    // this statement can highlight what is about to change, not just the line it is on.
    return withSpan(idx, sourceFile, node)
  }
  if (!ts.isIdentifier(node)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Assignment target must be a name, or a field, component or element of one.',
      TS_CODES.ASSIGN_TARGET,
    )
    return undefined
  }
  const binding = scope.resolve(node.text)
  if (!binding) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to unknown name "${node.text}".`,
      // UNKNOWN_NAME, not ASSIGN_TARGET: the name does not resolve, which is what every
      // other unresolved-identifier site in the lowerer reports (expression.ts, the property
      // and call lowerers). ASSIGN_TARGET is about the SHAPE of the target — "must be an
      // identifier" — and this target is a perfectly good identifier that names nothing.
      // `lowerUpdate` raises the same message, and now the same code, for `nope++`.
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  if (!binding.mutable) {
    const ro = readOnlyPhrase(binding.kind)
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to "${node.text}" — it is ${ro}.`,
      TS_CODES.CONST_ASSIGN,
    )
    return undefined
  }
  if (binding.kind === 'param')
    return withSpan(
      { op: 'param', type: binding.type, name: irNameOf(binding) } as Expr,
      sourceFile,
      node,
    )
  return withSpan(
    { op: 'varref', type: binding.type, name: irNameOf(binding) } as Expr,
    sourceFile,
    node,
  )
}

/** A write through `v.x`, `ps[i].a` or `o.pos` lands on the binding at the root of the
 *  chain, so that is the binding whose writability decides it: the same parameter and const
 *  checks the identifier and element-access targets already make, made on the root instead
 *  of on the chain. Returns the root identifier, or undefined for a chain rooted in
 *  something that is not a name (a call result, a constructor). */
function rootLValueName(node: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(node)) return node
  if (ts.isParenthesizedExpression(node)) return rootLValueName(node.expression)
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return rootLValueName(node.expression)
  }
  return undefined
}

/** Lowers `v.x`, `o.pos`, `ps[i].a` and `o.pos.x` as an assignment target. The IR `assign`
 *  target already takes a `member` — the EDSL spells the same write `o.pos.assign(v)`, and
 *  WGSL, GLSL ES 3.00 and the CPU oracle all assign a struct field or a single vector
 *  component in place — so the member expression `lowerExpression` already builds for the
 *  read is the target verbatim. Two things are checked that a read does not care about: the
 *  root binding must be writable, and a swizzle target must name exactly one component,
 *  which is what WGSL allows (`v.xy = …` is rejected there too). */
function unwrapParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrapParens(node.expression) : node
}

/** The writability of the binding at the root of a member or element chain, diagnosed. Shared
 *  by both branches of {@link lowerLValue} so a write through a field and a write through an
 *  element answer the same way: a write lands on the root, so the root is what has to accept
 *  it. Returns false having pushed a diagnostic. */
function checkRootWritable(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const root = rootLValueName(node)
  if (!root) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Assignment target must be a name, or a field, component or element of one.',
      TS_CODES.ASSIGN_TARGET,
    )
    return false
  }
  const binding = scope.resolve(root.text)
  if (!binding) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to unknown name "${root.text}".`,
      // The same code as the bare-identifier arm above, for the same sentence: the root of a
      // chain that names nothing is an unresolved identifier, not a target of the wrong shape.
      TS_CODES.UNKNOWN_NAME,
    )
    return false
  }
  if (binding.kind === 'param') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot write through parameter "${root.text}" — parameters are not writable. Use a local or storage.`,
      TS_CODES.ASSIGN_TARGET,
    )
    return false
  }
  if (!binding.mutable) {
    // readOnlyPhrase, not a local ternary: #18 gave a binding its own BindingKind, so the
    // message can say WHICH of the two a name is — and the root of a chain deserves the same
    // sentence a bare name gets.
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to "${root.text}" — it is ${readOnlyPhrase(binding.kind)}.`,
      TS_CODES.CONST_ASSIGN,
    )
    return false
  }
  return true
}

function lowerMemberLValue(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (!checkRootWritable(node.expression, sourceFile, scope, diagnostics)) return undefined
  const target = lowerExpression(node, sourceFile, scope, diagnostics)
  if (!target) return undefined
  if (target.op !== 'member') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to "${truncate(node.getText(sourceFile))}" — it is not a field, component or element.`,
      TS_CODES.ASSIGN_TARGET,
    )
    return undefined
  }
  // Only a `vec` base reaches here with a multi-character field: parseSwizzle rejects every
  // other base (a vec64 included) before a member is built, and a struct field name of more
  // than one character is a field, not a swizzle.
  const base = target.base.type
  if (isVec(base) && target.field.length > 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to the swizzle ".${target.field}" — WGSL writes one component at a time. ` +
        `Assign each component (e.g. v.x = …; v.y = …), or build a whole ${typeKey(base)} and assign that.`,
      TS_CODES.ASSIGN_TARGET,
    )
    return undefined
  }
  return target
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
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `if condition must be bool, got ${typeKey(cond.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
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
  scope.enterBranch()
  try {
    if (ts.isBlock(node)) return lowerBlock(node, sourceFile, scope, diagnostics)
    scope.push()
    try {
      const one = lowerStatement(node, sourceFile, scope, diagnostics)
      if (!one) return []
      return Array.isArray(one) ? one : [one]
    } finally {
      scope.pop()
    }
  } finally {
    scope.exitBranch()
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
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}
