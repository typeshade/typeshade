// Implements: Rule 11.22 (docs/language-design.md; traced in reqs/).
//
// ═══ The `finite-math` numerical contract (change 0107, surface §78) ═══
//
// The rewrites the default optimizer refuses on floats because a NaN or an infinity can observe
// them (`opt/algebraic.ts`, its header), applied only inside a function whose author opted into
// `finite-math` (`FuncDecl.numerics`). Each rewrite's supported domain and error bound:
//
//   x * 0, 0 * x  ->  0     Domain: x finite. Exact, apart from the sign of the zero: a negative
//                           x gives -0 and the rewrite gives +0. Wrong for x = NaN or ±Inf (NaN).
//   x - x         ->  0     Domain: x finite. Exact (+0 either way). Wrong for NaN or ±Inf (NaN).
//   mix(a, b, 0)  ->  a     Domain: a and b finite. Exact: a * (1 - 0) + b * 0 is a, apart from
//                           the sign of a zero a. Wrong when b is NaN or ±Inf.
//   mix(a, b, 1)  ->  b     Domain: a and b finite. Exact: a * (1 - 1) + b * 1 is b, apart from
//                           the sign of a zero b. Wrong when a is NaN or ±Inf.
//
// Each holds only on native `f32` operands, scalar or vector (the IR has no `f16`). The pass runs after
// `specializeCalls`, which turns a constant argument into the literal these match, and before
// `fp64Lower`, while an emulated double still has its own type: an `f64` operand is never
// matched, so no rewrite reaches df64 arithmetic (Rule 4.4). An operand the rewrite drops must
// have no effect: a call that writes a binding, or an atomic, is kept.
//
// The CPU oracle does not run this pass. It keeps the source's meaning, and an opted-in function
// equals it bit for bit on finite inputs, apart from the sign of a zero (decision 3).

import type { Expr, FuncDecl, ModuleDecl, ShaderType } from '../ir/index.js';
import { mapStmt } from './opt/ir-transform.js';
import { bodyHasRaw, keyOf } from './opt/expr-utils.js';
import { exprHasEffect, fnWrites, type FnWrites } from './effects.js';

/** A native `f32` scalar or vector: the only types a `finite-math` rewrite matches. The IR has
 *  no `f16`. */
const isNativeFloat = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');

/** Whether `e` is the constant `v`: a literal, or a constructor whose every argument is. */
function isConst(e: Expr, v: number): boolean {
  if (e.op === 'lit') return typeof e.value === 'number' && e.value === v;
  if (e.op === 'construct' && e.type.kind === 'vec') {
    return e.args.length > 0 && e.args.every((a) => isConst(a, v));
  }
  return false;
}

/** The zero of an `f32` scalar or vector. */
function zeroOf(t: ShaderType): Expr {
  if (t.kind !== 'vec') return { op: 'lit', type: t, value: 0 };
  const elem: ShaderType = { kind: 'scalar', scalar: t.elem };
  return {
    op: 'construct',
    type: t,
    args: Array.from({ length: t.n }, (): Expr => ({ op: 'lit', type: elem, value: 0 })),
  };
}

/** One `finite-math` rewrite of `e`, whose children are already rewritten, or `e`. */
function rewrite(e: Expr, writes: FnWrites): Expr {
  if (!isNativeFloat(e.type)) return e;
  const pure = (x: Expr): boolean => !exprHasEffect(x, writes);
  if (e.op === 'binop') {
    if (!isNativeFloat(e.a.type) || !isNativeFloat(e.b.type)) return e;
    if (e.bop === '*') {
      if (isConst(e.b, 0) && pure(e.a)) return zeroOf(e.type);
      if (isConst(e.a, 0) && pure(e.b)) return zeroOf(e.type);
    }
    if (e.bop === '-' && keyOf(e.a) === keyOf(e.b) && pure(e.a)) return zeroOf(e.type);
    return e;
  }
  if (e.op === 'call' && e.fn === 'mix' && e.args.length === 3) {
    const [a, b, t] = e.args as [Expr, Expr, Expr];
    if (!isNativeFloat(a.type) || !isNativeFloat(b.type) || a.type.kind !== e.type.kind) return e;
    if (isConst(t, 0) && pure(b)) return a;
    if (isConst(t, 1) && pure(a)) return b;
  }
  return e;
}

/** Applies the `finite-math` rewrites to every function that opted into the class, and leaves
 *  every other function as it is. Identity for a module where no function did. A function with a
 *  raw statement is left alone, as `algebraicSimplify` leaves it. */
export function finiteMath(m: ModuleDecl): ModuleDecl {
  const opted = (f: FuncDecl): boolean =>
    f.numerics?.includes('finite-math') === true && !bodyHasRaw(f.body);
  if (!m.funcs.some(opted)) return m;
  const writes = fnWrites(m);
  const step = (e: Expr): Expr => rewrite(e, writes);
  return {
    ...m,
    funcs: m.funcs.map((f) => (opted(f) ? { ...f, body: f.body.map((s) => mapStmt(s, step)) } : f)),
  };
}
