// === Statement lowering ===

import ts from 'typescript'
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { isVec, isVec64, typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { LoweringScope, readOnlyPhrase } from '../context.js'
import { mapTsTypeToShaderType } from '../type-map.js'
import { broadcastResultType, numericMismatch, retargetLit } from '../numeric.js'
import { lowerExpression } from './expression.js'
import { lowerFor, lowerSwitch, lowerUpdate, lowerWhile } from './control.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

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
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      `"${isConst ? 'const' : 'let'} ${name}" requires an initializer.`,
      TS_CODES.UNSUPPORTED,
    )
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
  try {
    scope.define({ kind: 'local', name, type: bindingType, mutable: !isConst, constValue })
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
  scope.recordDeclaration(sourceFile, decl.name, {
    name,
    kind: 'local',
    type: bindingType,
    mutable: !isConst,
  })
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
    if (bop !== undefined)
      return lowerAssignOp(expr.left, bop, expr.right, sourceFile, scope, diagnostics)
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
    return idx
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
  if (binding.kind === 'param') return { op: 'param', type: binding.type, name: binding.name }
  return { op: 'varref', type: binding.type, name: binding.name }
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
