// for / while must have a compile-time-constant exit bound.

import type { Expr } from '../../core/ir/nodes.js'
import type { LoweringScope } from './context.js'

export function constNumeric(expr: Expr, scope: LoweringScope): number | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'number') return expr.value
  if (expr.op === 'unop' && expr.a.op === 'lit' && typeof expr.a.value === 'number') {
    return -expr.a.value
  }
  if (expr.op === 'varref') {
    const b = scope.resolve(expr.name)
    if (b && !b.mutable && typeof b.constValue === 'number') return b.constValue
  }
  return undefined
}

export function constBool(expr: Expr, scope: LoweringScope): boolean | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'boolean') return expr.value
  if (expr.op === 'varref') {
    const b = scope.resolve(expr.name)
    if (b && !b.mutable && typeof b.constValue === 'boolean') return b.constValue
  }
  return undefined
}

export function loopBoundError(cond: Expr, scope: LoweringScope): string | undefined {
  const b = constBool(cond, scope)
  if (b === false) return undefined
  if (b === true) {
    return 'Infinite loop: condition is constantly true. for/while needs a constant exit bound (e.g. i < 16).'
  }
  if (cond.op === 'compare') {
    const left = constNumeric(cond.a, scope)
    const right = constNumeric(cond.b, scope)
    if (left !== undefined || right !== undefined) return undefined
    return (
      'for/while exit bound must be a compile-time constant ' +
      '(literal or const), e.g. `i < 16` or `i < LIMIT`. Runtime bounds like `i < n` are not allowed.'
    )
  }
  return (
    'for/while condition must compare against a compile-time constant bound ' +
    '(e.g. `i < 16`). Logical / runtime conditions are not allowed.'
  )
}
