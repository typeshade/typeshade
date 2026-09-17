// === Statement lowering ===

import ts from 'typescript'
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { isVec, isVec64, typeKey, u32T } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope, readOnlyPhrase } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { broadcastResultType, numericMismatch, retargetLit } from '../numeric.js'
import { lowerExpression } from './expression.js'
import { lowerFor, lowerSwitch, lowerUpdate, lowerWhile } from './control.js'
import { makeDiagnostic } from '../diagnostic.js'
import { withSpan } from '../span.js'
import { foldNumericLit } from '../lit-coerce.js'
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
    const expr = lowerExpression(node.expression, sourceFile, scope, diagnostics)
    if (!expr) return undefined
    return { s: 'return', expr }
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
    if (!defineLocal(name, annotated, true, undefined, decl, sourceFile, scope, diagnostics)) {
      return undefined
    }
    return withSpan({ s: 'var', name, type: annotated } as Stmt, sourceFile, spanNode)
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
  if (!defineLocal(name, bindingType, !isConst, constValue, decl, sourceFile, scope, diagnostics)) {
    return undefined
  }
  if (isConst) return withSpan({ s: 'let', name, expr: init } as Stmt, sourceFile, spanNode)
  return withSpan({ s: 'var', name, type: bindingType, init } as Stmt, sourceFile, spanNode)
}

/** Register a local binding, turning the scope's throw into a diagnostic on the declaration.
 *  Shared by the two declaration shapes — with an initializer and without.
 *
 *  @returns `true` when the binding was defined, `false` after pushing a diagnostic. */
function defineLocal(
  name: string,
  type: ShaderType,
  mutable: boolean,
  constValue: number | boolean | undefined,
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  try {
    scope.define({ kind: 'local', name, type, mutable, constValue })
  } catch (e) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      e instanceof Error ? e.message : String(e),
      TS_CODES.DUPLICATE_SYMBOL,
    )
    return false
  }
  // #51 records the NAME's span with the declared type, for hover; the caller's `withSpan`
  // records the STATEMENT's, for stepping (#32). Complementary, and both wanted. This sits
  // here rather than at the one call site it had, so the declaration WITHOUT an initializer
  // (`let x: f32;`) is recorded too — the editor should know a name the language now accepts.
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'local', type, mutable })
  return true
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
  const value = lowerExpression(right, sourceFile, scope, diagnostics)
  if (!value) return undefined
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

function lowerLValue(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (ts.isElementAccessExpression(node)) {
    const baseName = ts.isIdentifier(node.expression) ? node.expression.text : undefined
    const binding = baseName ? scope.resolve(baseName) : undefined
    if (binding?.kind === 'param') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot write through parameter "${baseName}" — parameters are not writable. Use a local or storage.`,
        TS_CODES.ASSIGN_TARGET,
      )
      return undefined
    }
    if (binding && !binding.mutable) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot assign to "${baseName}" — it is ${readOnlyPhrase(binding.kind)}.`,
        TS_CODES.CONST_ASSIGN,
      )
      return undefined
    }
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
      'Assignment target must be a simple identifier.',
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
      { op: 'param', type: binding.type, name: binding.name } as Expr,
      sourceFile,
      node,
    )
  return withSpan(
    { op: 'varref', type: binding.type, name: binding.name } as Expr,
    sourceFile,
    node,
  )
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
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}
