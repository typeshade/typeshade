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
  if (expr.op === 'binop' && (expr.bop === '+' || expr.bop === '-' || expr.bop === '*' || expr.bop === '/')) {
    const a = foldNumericLit(expr.a)
    const b = foldNumericLit(expr.b)
    if (a.op === 'lit' && b.op === 'lit' && typeof a.value === 'number' && typeof b.value === 'number') {
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
