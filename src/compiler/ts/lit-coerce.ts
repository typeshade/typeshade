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
  return !/[.eE]/.test(node.text)
}

export function isIntScalar(t: ShaderType): boolean {
  const k = typeKey(t)
  return k === 'i32' || k === 'u32'
}

export function retargetIntLit(expr: Expr, node: ts.Expression, peer: ShaderType): Expr {
  if (expr.op !== 'lit' || typeof expr.value !== 'number') return expr
  if (!isIntScalar(peer) || !isIntegerLiteralNode(node)) return expr
  return { op: 'lit', type: peer, value: Math.trunc(expr.value) }
}
