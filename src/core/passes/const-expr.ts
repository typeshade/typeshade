// === A constant expression the target refuses is given its value at run time (#368) ===
//
// WGSL evaluates a const-expression when it creates the shader, and makes some of them a
// shader-creation error: a value its rules leave undefined for constants, although the same
// operation on a value the shader computes has an answer. An operand becomes a constant in two
// ways a program the front end accepts can reach:
//
//   - the optimizer makes one: `x - x`, `x ^ x` and `x * 0` fold to 0 on integers, a `select`
//     on a literal folds to one arm, and const-prop moves a local's literal into its uses;
//   - the author writes one with constants, a literal or a module `const`, where the front end
//     refuses a divisor it proves zero and a shift amount past 31 (Rule 7.4), and a `clamp`
//     whose bounds cross and an `f32` value past the range (Rule 12.6, #373, #374). An `i32`
//     literal is spelled with no suffix, so WGSL reads it as an abstract integer, and an
//     operation on two of them is refused when its value does not fit the `i32` it meets.
//
// Measured on Tint (Chromium, SwiftShader), each in a `@compute` entry over a storage array
// `data`, with `x` and `y` read from it:
//
//   data[1] = (7u / 0u);            integer division by zero is invalid
//   data[1] = (x / 0);              integer division by zero is invalid
//   data[1] = (7u % 0u);            integer division by zero is invalid
//   data[1] = (y << 33u);           shift left value must be less than the bit width of the
//                                   lhs, which is 32
//   data[1] = (y >> 40u);           shift right value must be less than the bit width of the
//                                   lhs, which is 32
//   (x + (S << 31u)), S: i32 = 3    shift left operation results in sign change
//   (x + (S << 31u)), S: u32 = 3    '3 << 31' cannot be represented as 'u32'
//   (x + (3 << 31u))                value 6442450944 cannot be represented as 'i32'
//   (x + (2147483647 + 1))          value 2147483648 cannot be represented as 'i32'
//   (x + (-2147483648 / -1))        value 2147483648 cannot be represented as 'i32'
//   (x + (-(-2147483648)))          value 2147483648 cannot be represented as 'i32'
//   (x + (M / -1)), M: i32 = MIN    '-2147483648 / -1' cannot be represented as 'i32'
//   (x + (M % -1)), M: i32 = MIN    '-2147483648 % -1' cannot be represented as 'i32'
//   (x + u32(-1))                   value -1 cannot be represented as 'u32'
//   (x / u32(-0.25))                integer division by zero is invalid
//   (x % u32(K)), K: f32 = 0.5      integer division by zero is invalid
//   clamp(x, 5u, 2u)                clamp called with 'low' (5) greater than 'high' (2)
//
// and their neighbours, which Tint accepts: `S * 1000000000` and `S + 1` over a concrete `i32`
// constant wrap, as do `-M` and `(-2147483648 % -1)`; `u32(N)` for an `i32` constant `N = -1`;
// `S << 31u` for `S: i32 = -1` and for `S: u32 = 1`; `y / 0.0` on an `f32` the shader computes;
// `x / u32(K)` for `K: f32 = 1.5`.
//
// Each program above has an answer when the operand is not a constant: an integer `x / 0` is
// `x` and `x % 0` is 0, a shift amount is taken modulo 32, integer arithmetic wraps, `u32(e)`
// keeps the bits of an `i32`, and an integer `clamp` is `min(max(e, low), high)`. The CPU
// oracle computes exactly that (`intDiv`, `intRem` and `clampVal` in `cpu-runtime.ts`), and so
// does a GPU the moment the operand is not constant. This pass writes that answer where WGSL
// would refuse to compute it: the zero of a divisor becomes a 1 (`x / 1` is `x`, `x % 1` is 0),
// a shift amount keeps its low five bits, an operation over constants that Tint refuses for a
// value its type cannot hold becomes the wrapped value, and a `clamp` whose constant bounds
// cross becomes `min(max(e, low), high)`, which is one of the two answers WGSL allows a float
// `clamp` and the only one it allows an integer one. It changes no value the target computes;
// it spells the value so that the target will compute it.
//
// It runs after every optimizer tier, O0 included, because an author's constants reach O0 and
// the optimizer's reach every tier above it. It is neutral: GLSL ES 3.00 leaves a division by
// zero, a shift past the width and a `clamp` with crossed bounds undefined, so both targets
// get the WGSL answer. ANGLE (Chromium, SwiftShader) compiled `uint a = (7u / 0u);` in a
// fragment program with `WARNING: 0:14: '/' : Divide by zero error during constant folding`
// and a value of its own choosing, and `(S << 31u)` and `clamp(k, 5u, 2u)` with no word; the
// settled program compiles with none. It rewrites only what WGSL would refuse, so a module that
// compiled before emits the same bytes. What it cannot evaluate it leaves alone: a float
// operation over constants (its rounding is the target's), and any operand that is not a
// const-expression (a `let` is not one, whatever it holds).

import type { BinOp, Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { typeKey } from '../ir/types.js';
import { mapStmtExpr } from '../ir/visit.js';
import { scalarBin } from '../scalar-arith.js';
import { exprHasEffect, fnWrites, type FnWrites } from './effects.js';
import { mapExpr } from './opt/ir-transform.js';
import { intElemOf, wrapInt } from './opt/expr-utils.js';

/** A constant's value, one number per component; a scalar has one. */
type Components = readonly number[];

/** What evaluation reads: the module's constants by name, and each node's value once asked.
 *  The pass asks for an operand's value at every operation above it, so without the memo a deep
 *  expression would be walked once per level. The IR is immutable, so a node's value cannot change;
 *  the constants' own initializers are evaluated without one, while the table still fills. */
interface Env {
  readonly consts: ReadonlyMap<string, Components>;
  readonly memo?: WeakMap<Expr, Components | null>;
}

const SWIZZLE = 'xyzwrgba';
const I32_MIN = -2147483648;

/** The element of a scalar or vector type, or undefined for any other kind. */
function elemOf(t: ShaderType): string | undefined {
  return t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
}

/** `f` over two component lists, a one-component list standing for its value in every
 *  component, as WGSL broadcasts a scalar against a vector. Undefined when the lengths meet no
 *  other way. */
function zip(
  a: Components,
  b: Components,
  f: (x: number, y: number) => number,
): number[] | undefined {
  if (a.length !== b.length && a.length !== 1 && b.length !== 1) return undefined;
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) =>
    f(a[a.length === 1 ? 0 : i]!, b[b.length === 1 ? 0 : i]!),
  );
}

/** An integer builtin over constants, as the target computes it, or undefined. */
function builtinValue(
  fn: string,
  args: readonly Components[],
  int: 'i32' | 'u32',
): number[] | undefined {
  const [a, b, c] = args;
  switch (fn) {
    case 'abs':
      return args.length === 1 ? a!.map((v) => wrapInt(Math.abs(v), int)) : undefined;
    case 'min':
      return args.length === 2 ? zip(a!, b!, Math.min) : undefined;
    case 'max':
      return args.length === 2 ? zip(a!, b!, Math.max) : undefined;
    case 'clamp': {
      const lo = args.length === 3 ? zip(a!, b!, Math.max) : undefined;
      return lo === undefined ? undefined : zip(lo, c!, Math.min);
    }
    default:
      return undefined;
  }
}

/**
 * The value of `e` where `e` is a const-expression this evaluates, one number per component,
 * else undefined: a literal, a module constant, a vector built from those, a component of one,
 * a `select` on a literal, an integer operation over those, and an integer `abs`, `min`, `max`,
 * `clamp` or conversion of them, a float constant's included. An integer is evaluated as the
 * target computes it at run time: it wraps, `x / 0` is `x` and a shift takes its amount modulo
 * 32 (`scalarBin`, the oracle's). A float is taken only as it is written, since the rounding of
 * its arithmetic is the target's.
 */
function constValue(e: Expr, env: Env): Components | undefined {
  const hit = env.memo?.get(e);
  if (hit !== undefined) return hit ?? undefined;
  const v = evaluate(e, env);
  env.memo?.set(e, v ?? null);
  return v;
}

/** {@link constValue} of one node, its operands through the memo. */
function evaluate(e: Expr, env: Env): Components | undefined {
  const int = intElemOf(e.type);
  switch (e.op) {
    case 'lit':
      if (typeof e.value !== 'number') return undefined;
      return e.type.kind === 'vec' ? Array<number>(e.type.n).fill(e.value) : [e.value];
    case 'constref':
      return env.consts.get(e.name);
    case 'construct': {
      if (e.type.kind !== 'vec') return undefined;
      const parts: number[] = [];
      for (const a of e.args) {
        // A constructor over another element type converts, which is not evaluated here.
        if (elemOf(a.type) !== e.type.elem) return undefined;
        const v = constValue(a, env);
        if (v === undefined) return undefined;
        parts.push(...v);
      }
      if (parts.length === 1) return Array<number>(e.type.n).fill(parts[0]!);
      return parts.length === e.type.n ? parts : undefined;
    }
    case 'unop': {
      const a = constValue(e.a, env);
      return a?.map((v) => (int === undefined ? -v : wrapInt(-v, int)));
    }
    case 'binop': {
      if (int === undefined) return undefined;
      const a = constValue(e.a, env);
      const b = a && constValue(e.b, env);
      return a && b && zip(a, b, (x, y) => scalarBin(e.bop, x, y, int));
    }
    case 'member': {
      if (e.base.type.kind !== 'vec') return undefined;
      const base = constValue(e.base, env);
      if (base === undefined) return undefined;
      const picked = [...e.field].map((ch) => base[SWIZZLE.indexOf(ch) % 4]);
      return picked.every((v) => v !== undefined) ? (picked as number[]) : undefined;
    }
    case 'index': {
      if (e.base.type.kind !== 'vec') return undefined;
      const base = constValue(e.base, env);
      const i = base && constValue(e.idx, env);
      const v = base !== undefined && i?.length === 1 ? base[i[0]!] : undefined;
      return v === undefined ? undefined : [v];
    }
    case 'select': {
      // A const-expression only when every argument is one, the arm not taken included.
      if (e.cond.op !== 'lit' || typeof e.cond.value !== 'boolean') return undefined;
      const t = constValue(e.ifTrue, env);
      const f = t && constValue(e.ifFalse, env);
      return t && f && (e.cond.value ? t : f);
    }
    case 'call': {
      if (e.declRef !== undefined || int === undefined) return undefined;
      if ((e.fn === 'i32' || e.fn === 'u32') && e.args.length === 1 && e.type.kind === 'scalar') {
        const arg = e.args[0]!;
        if (arg.type.kind === 'scalar' && arg.type.scalar === 'f32')
          return truncated(arg, int, env);
      }
      const args: Components[] = [];
      for (const a of e.args) {
        if (intElemOf(a.type) === undefined) return undefined;
        const v = constValue(a, env);
        if (v === undefined) return undefined;
        args.push(v);
      }
      // `i32(e)` and `u32(e)` keep the bits of the other integer type.
      if ((e.fn === 'i32' || e.fn === 'u32') && args.length === 1 && e.type.kind === 'scalar')
        return args[0]!.length === 1 ? [wrapInt(args[0]![0]!, int)] : undefined;
      return builtinValue(e.fn, args, int);
    }
    default:
      return undefined;
  }
}

/** `i32(f)` or `u32(f)` of a float constant: its value truncated toward zero, as WGSL converts
 *  one, or undefined outside the integer's range. A literal is an abstract float to WGSL, which
 *  converts the value as written (`u32(-0.25)` is 0). A named `f32` constant is its `f32` value,
 *  so it is taken only where that and the value as written truncate alike: `u32(0.1)` is 0 in
 *  either reading, and `u32(2.99999999)` is 2 or 3. */
function truncated(arg: Expr, int: 'i32' | 'u32', env: Env): Components | undefined {
  const v = constValue(arg, env);
  if (v === undefined || v.length !== 1) return undefined;
  // `+ 0` makes the -0 that `Math.trunc(-0.25)` gives a 0.
  const t = Math.trunc(v[0]!) + 0;
  const literal = arg.op === 'lit' || (arg.op === 'unop' && arg.a.op === 'lit');
  if (!literal && Math.trunc(Math.fround(v[0]!)) + 0 !== t) return undefined;
  const lo = int === 'i32' ? I32_MIN : 0;
  const hi = int === 'i32' ? 2147483647 : 4294967295;
  return t >= lo && t <= hi ? [t] : undefined;
}

/** `values` spelled as a constant of type `t`: a literal, or a vector constructor of literals
 *  (a vector-typed literal has no spelling on either target). */
function spell(values: Components, t: ShaderType): Expr {
  if (t.kind !== 'vec') return { op: 'lit', type: t, value: values[0]! };
  const elem: ShaderType = { kind: 'scalar', scalar: t.elem };
  return {
    op: 'construct',
    type: t,
    args: Array.from({ length: t.n }, (_, i) => ({
      op: 'lit' as const,
      type: elem,
      value: values[values.length === 1 ? 0 : i]!,
    })),
  };
}

/** Whether WGSL reads `e` as an abstract integer: an `i32` literal, which both backends spell
 *  with no suffix, or a negation or an operation over those alone. A module constant, a `u32`
 *  literal and a constructor are concrete. The value of an abstract one must fit the `i32` it
 *  becomes; a concrete `+`, `-` or `*` wraps instead, which Tint accepts. */
function isAbstract(e: Expr): boolean {
  if (e.type.kind !== 'scalar' || e.type.scalar !== 'i32') return false;
  switch (e.op) {
    case 'lit':
      return true;
    case 'unop':
      return isAbstract(e.a);
    case 'binop':
      // A shift's type is its left operand's; its amount is a `u32` either way.
      return isAbstract(e.a) && (e.bop === '<<' || e.bop === '>>' || isAbstract(e.b));
    default:
      return false;
  }
}

/** Whether WGSL refuses `e`, an integer operation over the constants `a` and `b`: a shift left
 *  or a division whose exact value `int` cannot hold, `i32`'s most negative value `% -1` over a
 *  concrete operand, and an abstract `+`, `-` or `*` whose value does not fit an `i32`. */
function refusedOverConstants(
  e: Extract<Expr, { op: 'binop' }>,
  a: Components,
  b: Components,
  int: 'i32' | 'u32',
): boolean {
  const lo = int === 'i32' ? I32_MIN : 0;
  const hi = int === 'i32' ? 2147483647 : 4294967295;
  const abstract = isAbstract(e);
  const refused = zip(a, b, (x, y) => {
    let exact: number;
    switch (e.bop) {
      case '+':
      case '-':
      case '*':
        if (!abstract) return 0;
        exact = e.bop === '+' ? x + y : e.bop === '-' ? x - y : x * y;
        break;
      case '/':
        exact = y === 0 ? x : Math.trunc(x / y);
        break;
      case '%':
        return !abstract && int === 'i32' && x === I32_MIN && y === -1 ? 1 : 0;
      case '<<':
        exact = x * 2 ** (y & 31);
        break;
      default:
        return 0;
    }
    return exact < lo || exact > hi ? 1 : 0;
  });
  return refused !== undefined && refused.includes(1);
}

/** `b`, the right operand of an integer `bop`, without the constant WGSL refuses there: each
 *  zero of a divisor is a 1, and each shift amount keeps its low five bits. */
function settleRight(bop: BinOp, b: Expr, env: Env): Expr {
  if (intElemOf(b.type) === undefined) return b;
  const v = constValue(b, env);
  if (v === undefined) return b;
  if ((bop === '/' || bop === '%') && v.includes(0))
    return spell(
      v.map((x) => (x === 0 ? 1 : x)),
      b.type,
    );
  if ((bop === '<<' || bop === '>>') && v.some((x) => x > 31))
    return spell(
      v.map((x) => x & 31),
      b.type,
    );
  return b;
}

/** The rewrite of one node whose children are already settled. `writes` is computed the first
 *  time a dropped operand needs it. */
function settleNode(e: Expr, env: Env, writes: () => FnWrites): Expr {
  const int = intElemOf(e.type);
  if (int === undefined) {
    // A `clamp` whose constant bounds cross, on floats as on integers.
    if (e.op === 'call' && e.fn === 'clamp') return settleClamp(e, env);
    return e;
  }
  switch (e.op) {
    case 'binop': {
      const b = settleRight(e.bop, e.b, env);
      if (b !== e.b && (e.bop === '/' || e.bop === '%')) {
        const d = constValue(b, env);
        if (d !== undefined && d.every((x) => x === 1)) {
          // `a / 1` is `a`, and `a % 1` is 0 unless `a` has an effect to keep.
          if (e.bop === '/' && typeKey(e.a.type) === typeKey(e.type)) return e.a;
          if (e.bop === '%' && !exprHasEffect(e.a, writes())) return spell([0], e.type);
        }
      }
      const r = b === e.b ? e : { ...e, b };
      const x = constValue(r.a, env);
      const y = x && constValue(r.b, env);
      if (x === undefined || y === undefined || !refusedOverConstants(r, x, y, int)) return r;
      const v = zip(x, y, (p, q) => scalarBin(r.bop, p, q, int));
      return v === undefined ? r : spell(v, r.type);
    }
    case 'unop': {
      // `-(-2147483648)` over an abstract integer is the one negation an `i32` cannot hold; it
      // wraps to itself, as the negation of a concrete one does.
      const a = isAbstract(e) ? constValue(e.a, env) : undefined;
      if (a === undefined || !a.includes(I32_MIN)) return e;
      return spell(
        a.map((v) => wrapInt(-v, int)),
        e.type,
      );
    }
    case 'call': {
      if (e.fn === 'clamp') return settleClamp(e, env);
      // `u32(-1)` over an abstract integer: the bits of the `i32`, as the conversion of a
      // concrete one keeps them.
      if (e.fn !== 'u32' || e.declRef !== undefined || e.args.length !== 1) return e;
      const arg = e.args[0]!;
      if (!isAbstract(arg)) return e;
      const v = constValue(arg, env);
      return v === undefined || v[0]! >= 0 ? e : spell([wrapInt(v[0]!, 'u32')], e.type);
    }
    default:
      return e;
  }
}

/** `clamp(e, low, high)` with constant bounds that cross in some component, as
 *  `min(max(e, low), high)`; any other call as it is. */
function settleClamp(e: Extract<Expr, { op: 'call' }>, env: Env): Expr {
  if (e.declRef !== undefined || e.args.length !== 3) return e;
  const [x, low, high] = e.args as [Expr, Expr, Expr];
  const lo = constValue(low, env);
  const hi = lo && constValue(high, env);
  const crossed = lo && hi && zip(lo, hi, (l, h) => (l > h ? 1 : 0));
  if (crossed === undefined || !crossed.includes(1)) return e;
  const max: Expr = { op: 'call', type: e.type, fn: 'max', args: [x, low] };
  return { op: 'call', type: e.type, fn: 'min', args: [max, high] };
}

/** One statement, its expressions settled bottom-up; a compound `/=`, `%=`, `<<=` or `>>=`
 *  also gets its right operand settled as the operator's. */
function settleStmt(s: Stmt, f: (e: Expr) => Expr, env: Env): Stmt {
  const r = mapStmtExpr(
    s,
    (e) => mapExpr(e, f),
    (b) => settleStmt(b, f, env),
  );
  if (r.s !== 'assignOp' || intElemOf(r.target.type) === undefined) return r;
  const expr = settleRight(r.bop, r.expr, env);
  return expr === r.expr ? r : { ...r, expr };
}

/**
 * Give each constant expression WGSL would refuse to evaluate the value it has at run time: a
 * zero of an integer divisor becomes a 1, a shift amount keeps its low five bits, an integer
 * operation over constants whose value its type cannot hold becomes the wrapped value, and a
 * `clamp` whose constant bounds cross becomes `min(max(e, low), high)`. See the head of this
 * file for what Tint refuses and why each answer is the one the target computes.
 *
 * Pure (module -> module); a module with nothing to settle is returned with equal contents.
 */
export function settleConstExprs(m: ModuleDecl): ModuleDecl {
  const consts = new Map<string, Components>();
  let table: FnWrites | undefined;
  const writes = (): FnWrites => (table ??= fnWrites(m));
  // In declaration order, so a constant reads only the ones before it.
  const early: Env = { consts };
  const settledConsts = m.consts.map((c) => {
    const valueExpr =
      c.valueExpr === undefined
        ? undefined
        : mapExpr(c.valueExpr, (e) => settleNode(e, early, writes));
    const value =
      valueExpr !== undefined
        ? constValue(valueExpr, early)
        : c.type.kind === 'scalar' && c.type.scalar !== 'bool'
          ? [c.wgslValue]
          : undefined;
    if (value !== undefined) consts.set(c.name, value);
    return valueExpr === undefined ? c : { ...c, valueExpr };
  });
  const env: Env = { consts, memo: new WeakMap() };
  const f = (e: Expr): Expr => settleNode(e, env, writes);
  return {
    ...m,
    consts: settledConsts,
    ...(m.vars !== undefined
      ? {
          vars: m.vars.map((v) => (v.init === undefined ? v : { ...v, init: mapExpr(v.init, f) })),
        }
      : {}),
    funcs: m.funcs.map((fn) => ({ ...fn, body: fn.body.map((s) => settleStmt(s, f, env)) })),
  };
}
