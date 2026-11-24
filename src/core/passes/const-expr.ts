/* Why: WGSL evaluates a const-expression when it creates the shader and makes some of them an
error (#368): an integer division by zero, a shift amount past 31, a shift left, sum, difference,
product, division or negation of abstract integers whose value its type cannot hold, `u32(-1)`,
and a `clamp` with crossed bounds. Measured on Tint (Chromium, SwiftShader); the same operation
on a value the shader computes has an answer, which the CPU oracle computes. ANGLE (the GLSL
path) compiled `uint a = (7u / 0u);` with `WARNING: '/' : Divide by zero error during constant
folding` and a value of its own choosing, so both targets get the WGSL answer. A float constant
converted to an integer saturates, and Tint saturates a literal at the ends of the integer range
but a named `f32` at the largest `f32` inside it (#578). Tint also evaluates a float operation
and an element of a constant array, so `x / u32(f32(0u) - 1.0)` and `x / u32(A[0])` for
`const A = array(-1., 2.)` are refused, and this pass does not settle them. */

import type { BinOp, Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { typeKey } from '../ir/types.js';
import { mapStmtExpr } from '../ir/visit.js';
import { scalarBin } from '../scalar-arith.js';
import { exprHasEffect, fnWrites, type FnWrites } from './effects.js';
import { mapExpr } from './opt/ir-transform.js';
import { intElemOf, wrapInt } from './opt/expr-utils.js';

type Components = readonly number[];

interface Env {
  readonly consts: ReadonlyMap<string, Components>;
  readonly memo?: WeakMap<Expr, Components | null>;
}

const SWIZZLE = 'xyzwrgba';
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;
const I32_MAX_F32 = 2147483520;
const U32_MAX_F32 = 4294967040;

function elemOf(t: ShaderType): string | undefined {
  return t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
}

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

function builtinValue(
  fn: string,
  args: readonly Components[],
  int: 'i32' | 'u32',
): number[] | undefined {
  const [a, b, c] = args;
  switch (fn) {
    case 'abs':
      return args.length === 1 ? a!.map((v) => wrapInt(Math.abs(v), int)) : undefined;
    case 'sign':
      return args.length === 1 ? a!.map((v) => wrapInt(Math.sign(v), int)) : undefined;
    case '~':
      return args.length === 1 ? a!.map((v) => wrapInt(~v, int)) : undefined;
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

function constValue(e: Expr, env: Env): Components | undefined {
  const hit = env.memo?.get(e);
  if (hit !== undefined) return hit ?? undefined;
  const v = evaluate(e, env);
  env.memo?.set(e, v ?? null);
  return v;
}

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
      const from = e.args.length === 1 ? e.args[0]!.type : undefined;
      if (int !== undefined && from?.kind === 'vec' && from.elem === 'f32' && from.n === e.type.n)
        return convertedVector(e.args[0]!, int, env);
      const parts: number[] = [];
      for (const a of e.args) {
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
      if ((e.fn === 'i32' || e.fn === 'u32') && args.length === 1 && e.type.kind === 'scalar')
        return args[0]!.length === 1 ? [wrapInt(args[0]![0]!, int)] : undefined;
      return builtinValue(e.fn, args, int);
    }
    default:
      return undefined;
  }
}

function floatToInt(v: number, int: 'i32' | 'u32', literal: boolean): number | undefined {
  if (!Number.isFinite(v)) return undefined;
  const lo = int === 'i32' ? I32_MIN : 0;
  const held = (x: number, hi: number): number => Math.min(hi, Math.max(lo, Math.trunc(x) + 0));
  if (literal) return held(v, int === 'i32' ? I32_MAX : U32_MAX);
  const hi = int === 'i32' ? I32_MAX_F32 : U32_MAX_F32;
  const t = held(v, hi);
  return held(Math.fround(v), hi) === t ? t : undefined;
}

function truncated(arg: Expr, int: 'i32' | 'u32', env: Env): Components | undefined {
  const v = constValue(arg, env);
  if (v === undefined || v.length !== 1) return undefined;
  const literal = arg.op === 'lit' || (arg.op === 'unop' && arg.a.op === 'lit');
  const t = floatToInt(v[0]!, int, literal);
  return t === undefined ? undefined : [t];
}

function convertedVector(arg: Expr, int: 'i32' | 'u32', env: Env): Components | undefined {
  const v = constValue(arg, env);
  if (v === undefined) return undefined;
  const out: number[] = [];
  for (const x of v) {
    const t = floatToInt(x, int, false);
    if (t === undefined) return undefined;
    out.push(t);
  }
  return out;
}

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

function isAbstract(e: Expr): boolean {
  if (e.type.kind !== 'scalar' || e.type.scalar !== 'i32') return false;
  switch (e.op) {
    case 'lit':
      return true;
    case 'unop':
      return isAbstract(e.a);
    case 'binop':
      return isAbstract(e.a) && (e.bop === '<<' || e.bop === '>>' || isAbstract(e.b));
    case 'call':
      return e.fn === '~' && e.args.length === 1 && isAbstract(e.args[0]!);
    default:
      return false;
  }
}

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

function settleNode(e: Expr, env: Env, writes: () => FnWrites): Expr {
  const int = intElemOf(e.type);
  if (int === undefined) {
    if (e.op === 'call' && e.fn === 'clamp') return settleClamp(e, env);
    return e;
  }
  switch (e.op) {
    case 'binop': {
      const b = settleRight(e.bop, e.b, env);
      if (b !== e.b && (e.bop === '/' || e.bop === '%')) {
        const d = constValue(b, env);
        if (d !== undefined && d.every((x) => x === 1)) {
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
      const a = isAbstract(e) ? constValue(e.a, env) : undefined;
      if (a === undefined || !a.includes(I32_MIN)) return e;
      return spell(
        a.map((v) => wrapInt(-v, int)),
        e.type,
      );
    }
    case 'call': {
      if (e.fn === 'clamp') return settleClamp(e, env);
      if (e.fn !== 'u32' || e.declRef !== undefined || e.args.length !== 1) return e;
      const arg = e.args[0]!;
      if (arg.op === 'select' && arg.type.kind === 'scalar') {
        const arm = (x: Expr): Expr => {
          if (!isAbstract(x)) return { op: 'call', type: e.type, fn: 'u32', args: [x] };
          const v = constValue(x, env);
          return v === undefined
            ? { op: 'call', type: e.type, fn: 'u32', args: [x] }
            : spell([wrapInt(v[0]!, 'u32')], e.type);
        };
        if (isAbstract(arg.ifTrue) || isAbstract(arg.ifFalse)) {
          return {
            op: 'select',
            type: e.type,
            cond: arg.cond,
            ifTrue: arm(arg.ifTrue),
            ifFalse: arm(arg.ifFalse),
          };
        }
      }
      if (!isAbstract(arg)) return e;
      const v = constValue(arg, env);
      return v === undefined || v[0]! >= 0 ? e : spell([wrapInt(v[0]!, 'u32')], e.type);
    }
    default:
      return e;
  }
}

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

export function settleConstExprs(m: ModuleDecl): ModuleDecl {
  const consts = new Map<string, Components>();
  let table: FnWrites | undefined;
  const writes = (): FnWrites => (table ??= fnWrites(m));
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
