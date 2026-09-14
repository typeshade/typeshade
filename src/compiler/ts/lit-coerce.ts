import ts from 'typescript'
import type { Expr } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'

export function isIntegerLiteralNode(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isIntegerLiteralNode(node.expression)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isIntegerLiteralNode(node.operand)
  }
  if (!ts.isNumericLiteral(node)) return false
  return !/[.eE]/.test(node.getText())
}

export function isIntScalar(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'i32' || k === 'u32'
}

export function foldNumericLit(expr: Expr): Expr {
  if (expr.op === 'unop' && expr.a.op === 'lit' && typeof expr.a.value === 'number') {
    return { op: 'lit', type: expr.type, value: -expr.a.value }
  }
  if (
    expr.op === 'binop' &&
    (expr.bop === '+' || expr.bop === '-' || expr.bop === '*' || expr.bop === '/')
  ) {
    const a = foldNumericLit(expr.a)
    const b = foldNumericLit(expr.b)
    if (
      a.op === 'lit' &&
      b.op === 'lit' &&
      typeof a.value === 'number' &&
      typeof b.value === 'number'
    ) {
      const v =
        expr.bop === '+'
          ? a.value + b.value
          : expr.bop === '-'
            ? a.value - b.value
            : expr.bop === '*'
              ? a.value * b.value
              : b.value === 0
                ? undefined
                : a.value / b.value
      if (v !== undefined) return { op: 'lit', type: expr.type, value: v }
    }
  }
  return expr
}

export function retargetIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  const folded = foldNumericLit(expr)
  if (folded.op !== 'lit' || typeof folded.value !== 'number') return folded
  if (!isIntScalar(peer)) return folded
  if (!isIntegerLiteralNode(node) && folded === expr) return folded
  if (!isIntegerLiteralNode(node) && !Number.isInteger(folded.value)) return folded
  if (!isIntegerLiteralNode(node) && expr.op !== 'unop' && expr.op !== 'binop') return folded
  if (!isIntegerLiteralNode(node) && expr.op === 'lit') return folded
  return { op: 'lit', type: peer, value: Math.trunc(folded.value) }
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node
}

/** A bare integer literal takes the type the context around it declares (#8 A3).
 *
 *  `return 0` in a function declared `u32`, `g(1)` where `g` takes an i32, `{ id: 0 }` for a
 *  u32 field, `vec3u(1, 2, 3)`, `min(i, 4)` with `i` an i32 — WGSL's abstract integers do
 *  this, and the EDSL does it through `liftAgainst`. Only a context that states an integer
 *  type changes anything: for every other target the expression is returned untouched, so no
 *  program that compiles today is lowered differently (in particular the fold inside
 *  {@link retargetIntLit} never runs against an f32 target, where it would rewrite
 *  `1. + 1.` to `2.` and move the emitted text).
 *
 *  A conditional is retargeted through its arms, so `c ? 1 : 2` in a u32 position is a
 *  `select` of two u32 literals rather than a select of two f32 ones. */
export function retargetIntLitCtx(expr: Expr, node: ts.Expression, target: ShaderType): Expr {
  if (!isIntScalar(target)) return expr
  const inner = stripParens(node)
  if (expr.op === 'select' && ts.isConditionalExpression(inner)) {
    const ifTrue = retargetIntLitCtx(expr.ifTrue, inner.whenTrue, target)
    const ifFalse = retargetIntLitCtx(expr.ifFalse, inner.whenFalse, target)
    if (ifTrue === expr.ifTrue && ifFalse === expr.ifFalse) return expr
    if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) return expr
    return { ...expr, type: ifTrue.type, ifTrue, ifFalse }
  }
  return retargetIntLit(expr, node, target)
}
