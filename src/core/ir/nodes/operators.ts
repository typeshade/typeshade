/** The operator tag on `Expr.binop`: arithmetic (`+ - * /`), remainder (`%`) and
 *  bitwise (`& | ^ << >>`). Each is spelled the same way in WGSL and GLSL and evaluated
 *  the same way by the CPU backend. On floats `%` is a truncating remainder, so its sign
 *  follows the dividend: WGSL's native `%` behaves this way, and the GLSL backend writes
 *  `a - b * trunc(a / b)` because GLSL ES 3.00's own `%` is integer-only. When a negative
 *  operand is possible and a floor modulo is wanted, use {@link mod}, which is floor-mod on
 *  every target; the `.mod()` method on `Node` emits this truncating `%`. For integer
 *  operands the CPU backend follows WGSL: two's-complement wrap, truncating `/` with
 *  `x / 0 = x` and `x % 0 = 0`, and `<<`/`>>` as logical shifts on `u32`, with `>>` on
 *  `i32` an arithmetic (sign-preserving) shift.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type BinOp = '+' | '-' | '*' | '/' | '%' | '&' | '|' | '^' | '<<' | '>>';
/** The operator tag on `Expr.compare`: the six relational operators. A comparison
 *  produces a `bool`, or a `vecN<bool>` when the operands are vectors. The WGSL, GLSL
 *  and CPU backends spell or evaluate it identically.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type CmpOp = '<' | '>' | '<=' | '>=' | '==' | '!=';
/** The operator tag on `Expr.logical`: the short-circuiting boolean operators `&&` and
 *  `||`. Both operands and the result are `bool`. It is a separate `Expr.op` from
 *  `binop` because WGSL and GLSL give `&&` and `||` short-circuit evaluation, which a
 *  plain binary operator does not have.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type LogOp = '&&' | '||';
