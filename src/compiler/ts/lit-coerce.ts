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

/** Whether every leaf of `node` is an integer literal — the literal itself, one behind
 *  parentheses or a unary minus, or the two sides of `+ - * /` over such leaves.
 *
 *  This is what separates "an integer written without a decimal point" from "a number that
 *  happens to fold to a whole one". {@link retargetIntLit} folds BEFORE it retargets, so
 *  without this check `return 2.5 + 0.5` in a `u32` function emitted `return 3u;` — floats
 *  written as floats, silently retyped, which is the opposite of what §13 says the rule is. */
export function isIntegerLiteralTree(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isIntegerLiteralTree(node.expression)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isIntegerLiteralTree(node.operand)
  }
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind
    const arith =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken ||
      k === ts.SyntaxKind.SlashToken
    return arith && isIntegerLiteralTree(node.left) && isIntegerLiteralTree(node.right)
  }
  return isIntegerLiteralNode(node)
}

/** Whether `v` is exactly representable in `target`. The retarget produced the literal by
 *  folding, so nothing downstream would have caught an out-of-range one: `return -1` in a
 *  `u32` function reported a type mismatch before this item and then became a silent `-1`
 *  that only the backend refused. Out of range, the expression is left exactly as it was and
 *  the type check that always covered it fires again. */
export function fitsTarget(v: number, target: ShaderType): boolean {
  if (!Number.isInteger(v)) return false
  return typeKey(target) === 'u32' ? v >= 0 && v <= 4294967295 : v >= -2147483648 && v <= 2147483647
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
  if (!fitsTarget(folded.value, peer)) return expr
  return { op: 'lit', type: peer, value: folded.value }
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
 *  program that compiles today is lowered differently. What the `isIntScalar` guard protects
 *  is the IR SHAPE, which is what `fn()` is the oracle for: without it the fold inside
 *  {@link retargetIntLit} would run against an f32 target and rewrite `1 + 1` into a single
 *  `lit 2` at sites that built a `binop` before. `1 + 1`, not `1. + 1.`: the guard is this
 *  function's first statement, so the float-written form does reach it, but with the guard
 *  deleted it is stopped one line later by {@link isIntegerLiteralTree}, which rejects the `.`,
 *  so that form cannot tell whether the guard is there. The emitted TEXT would not move either way — the
 *  emit-level constant folder collapses both — so only an IR assertion can see the difference,
 *  and `int-lit-context.test.ts` carries one, on `1 + 1`.
 *
 *  Only what is WRITTEN as an integer is retargeted ({@link isIntegerLiteralTree}), and only
 *  when the value fits the target, so `return 2.5 + 0.5` and `return -1` in a `u32` function
 *  keep the diagnostics they always had.
 *
 *  A conditional is retargeted through its arms, so `c ? 1 : 2` in a u32 position is a
 *  `select` of two u32 literals rather than a select of two f32 ones. */
export function retargetIntLitCtx(expr: Expr, node: ts.Expression, target: ShaderType): Expr {
  if (!isIntScalar(target)) return expr
  const inner = stripParens(node)
  if (!ts.isConditionalExpression(inner) && !isIntegerLiteralTree(inner)) return expr
  if (expr.op === 'select' && ts.isConditionalExpression(inner)) {
    const ifTrue = retargetIntLitCtx(expr.ifTrue, inner.whenTrue, target)
    const ifFalse = retargetIntLitCtx(expr.ifFalse, inner.whenFalse, target)
    if (ifTrue === expr.ifTrue && ifFalse === expr.ifFalse) return expr
    if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) return expr
    return { ...expr, type: ifTrue.type, ifTrue, ifFalse }
  }
  return retargetIntLit(expr, node, target)
}

/** The DECLARATION-site retarget: {@link retargetIntLitCtx}, and where that declines, the
 *  acceptance `let`/`const` and the `for` init had before this item existed.
 *
 *  That acceptance was a plain `init.op === 'lit'` retarget to the annotated type, so a literal
 *  WRITTEN as a float but valued as an integer took the declared integer type: `let y: i32 = 0.`
 *  emitted `var y: i32 = 0;`, `let y: u32 = 0.` emitted `0u`, and `let y: i32 = 1e3` emitted
 *  `1000`. {@link retargetIntLitCtx} alone refuses those, because {@link isIntegerLiteralTree}
 *  rejects any text carrying `.` or `e` — which turned three shapes that compiled into TS8003.
 *
 *  So the fallback is exactly the old rule and nothing wider: a single `lit` as lowered, an
 *  integral value, inside the target's range. A non-integral one (`let y: i32 = 1.5`) is left
 *  alone and keeps its mismatch, as it had at emit before, and so is any arithmetic or a
 *  negated float (`2.5 + 0.5`, `-1.`): those lower to a `binop` or a `unop`, which the old
 *  rule never matched either. Only the two DECLARATION sites use this — a
 *  return, an argument and a field never had the acceptance, so there is nothing there to
 *  preserve. */
export function retargetDeclaredIntLit(expr: Expr, node: ts.Expression, target: ShaderType): Expr {
  const byContext = retargetIntLitCtx(expr, node, target)
  if (byContext !== expr || !isIntScalar(target)) return byContext
  // The lowered expression itself, NOT a folded one: `-1.` lowers to a `unop` and `2. + 3.` to
  // a `binop`, and neither matched `init.op === 'lit'` before this item, so neither is accepted
  // now. Folding first widened the rule to ten shapes that had always been a mismatch.
  if (expr.op !== 'lit' || typeof expr.value !== 'number') return expr
  if (!fitsTarget(expr.value, target)) return expr
  return { op: 'lit', type: target, value: expr.value }
}
