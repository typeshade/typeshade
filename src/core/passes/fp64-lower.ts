import type {
  Expr,
  Stmt,
  FuncDecl,
  ModuleDecl,
  StructDecl,
  BindingDecl,
  ConstDecl,
  ModuleVarDecl,
  BinOp,
  CmpOp,
} from '../ir/nodes.js';
import { stageOf } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { F64_SCALAR_TWIN_FN, F64_VEC_TWIN_KIND } from '../fp64/twins.js';
import {
  type ShaderType,
  f32T,
  u32T,
  boolT,
  vec2fT,
  isF64,
  isVec64,
  isMat64,
  structT,
  typeKey,
} from '../ir/types.js';
import { dslError } from '../diagnostics/error.js';
import {
  DF64_FNS,
  DF64_ORDER,
  DF64_VEC_STRUCTS,
  DF64_MAT_STRUCTS,
  FP64_GUARD_NAME,
  FP64_GUARD_TYPE,
  splitF64,
} from '../fp64/df64-lib.js';
import { DF64_FNS_INT, DF64_ORDER_INT } from '../fp64/df64-int.js';
import { intElemOf, keyOf } from './opt/expr-utils.js';
import { exprHasEffect, fnWrites, type FnWrites } from './effects.js';

/** Which arithmetic primitives back the emulated-double (`df64`) helper functions that
 *  {@link fp64Lower} injects. Both flavours compute the same values; they differ in what a
 *  target's shader compiler is able to do to them.
 *
 *  - `'float'`: the default. Error-free transforms written in float arithmetic, protected from
 *    constant folding by a runtime guard binding, `_fp64`, that the host fills with `1.0`.
 *  - `'integer'`: the `twoSum`, `twoProd`, division and square-root leaves are written in
 *    integer bit arithmetic; the compositions above them are shared with `'float'`. A fast-math
 *    pass cannot reassociate integer operations, so the hi/lo split survives on compilers that
 *    fold the float form (Apple Metal, and the ANGLE Direct3D 11 path through FXC). No guard
 *    binding is injected, because the integer bodies never read it.
 *
 *  Choose `'integer'` when a target's compiler folds the float primitives. The symptom is
 *  emulated-double results degrading to f32 precision on one platform while every other target
 *  is fine. {@link recommendFp64Flavor} picks a flavour from a device's adapter or renderer
 *  information.
 *
 *  Exported from `typeshade`.
 */
export type Fp64Flavor = 'float' | 'integer';

/** Options for {@link fp64Lower}.
 *
 *  Exported from `typeshade`.
 */
export interface Fp64LowerOptions {
  /** Which primitives back the injected `df64_*` helper functions. Omitting it selects
   *  `'float'`; see {@link Fp64Flavor} for when `'integer'` is the right choice. */
  readonly flavor?: Fp64Flavor;
}
import { isKnownIntrinsic } from '../intrinsics.js';

function containsF64(t: ShaderType): boolean {
  if (isF64(t) || isVec64(t) || isMat64(t)) return true;
  if (t.kind === 'array') return containsF64(t.elem);
  return false;
}

const vec64StructName = (n: 2 | 3 | 4): string => `DF64Vec${n}`;
const mat64StructName = (n: 2 | 3 | 4): string => `DF64Mat${n}`;
const vecFT = (n: 2 | 3 | 4): ShaderType => ({ kind: 'vec', n, elem: 'f32' });

function mapType(t: ShaderType): ShaderType {
  if (isF64(t)) return vec2fT;
  if (isVec64(t)) return structT(vec64StructName(t.n));
  if (isMat64(t)) return structT(mat64StructName(mat64Dim(t)));
  if (t.kind === 'array' && containsF64(t.elem))
    return {
      ...t,
      elem: mapType(t.elem),
    };
  return t;
}

const BINOP_FN: Partial<Record<BinOp, string>> = {
  '+': 'df64_add',
  '-': 'df64_sub',
  '*': 'df64_mul',
  '/': 'df64_div',
};
const CMP_FN: Record<CmpOp, string> = {
  '<': 'df64_lt',
  '>': 'df64_gt',
  '<=': 'df64_le',
  '>=': 'df64_ge',
  '==': 'df64_eq',
  '!=': 'df64_ne',
};
const CALL_FN = F64_SCALAR_TWIN_FN;
const VEC_CALL_KIND = F64_VEC_TWIN_KIND;

const mat64Dim = (t: Extract<ShaderType, { kind: 'mat' }>): 2 | 3 | 4 => {
  if (t.cols !== t.rows) throw dslError('SD0041', `${typeKey(t)} — the df64 matrices are square`);
  return t.cols;
};

const litF32 = (v: number): Expr => ({ op: 'lit', type: f32T, value: v });
const pairLit = (v: number): Expr => {
  const [hi, lo] = splitF64(v);
  return { op: 'construct', type: vec2fT, args: [litF32(hi), litF32(lo)] };
};
const widen = (x: Expr): Expr => ({ op: 'construct', type: vec2fT, args: [x, litF32(0)] });

const opaqueF32 = (v: number): Expr => ({
  op: 'call',
  type: f32T,
  fn: 'bitcastF32',
  args: [{ op: 'call', type: u32T, fn: 'bitcastU32', args: [litF32(v)] }],
});

const RENORM_ZERO: Expr = { op: 'construct', type: vec2fT, args: [opaqueF32(0), opaqueF32(0)] };

const VEC_BINOP_FN: Partial<Record<BinOp, string>> = {
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
};
const VEC_CMP_FN: Record<CmpOp, string> = {
  '<': 'lt',
  '>': 'gt',
  '<=': 'le',
  '>=': 'ge',
  '==': 'eq',
  '!=': 'ne',
};
const plane = (base: Expr, n: 2 | 3 | 4, which: 'hi' | 'lo'): Expr => ({
  op: 'member',
  type: vecFT(n),
  base,
  field: which,
});
const laneSwizzle = (base: Expr, n: 2 | 3 | 4, comps: string): Expr => {
  const pick = (which: 'hi' | 'lo'): Expr => ({
    op: 'member',
    type: comps.length === 1 ? f32T : vecFT(comps.length as 2 | 3 | 4),
    base: plane(base, n, which),
    field: comps,
  });
  return comps.length === 1
    ? { op: 'construct', type: vec2fT, args: [pick('hi'), pick('lo')] }
    : {
        op: 'construct',
        type: structT(vec64StructName(comps.length as 2 | 3 | 4)),
        args: [pick('hi'), pick('lo')],
      };
};
const splatPair = (pair: Expr, n: 2 | 3 | 4): Expr => {
  const comp = (c: 'x' | 'y'): Expr => ({ op: 'member', type: f32T, base: pair, field: c });
  const fill = (c: 'x' | 'y'): Expr => ({ op: 'construct', type: vecFT(n), args: [comp(c)] });
  return { op: 'construct', type: structT(vec64StructName(n)), args: [fill('x'), fill('y')] };
};

interface LowerCtx {
  readonly used: Set<string>;
  readonly vecWidths: Set<2 | 3 | 4>;
  readonly matWidths: Set<2 | 3 | 4>;
  readonly writes: FnWrites;
  readonly runtimeNames: ReadonlyMap<string, string>;
  readonly constTypes: ReadonlySet<string>;
  readonly fnNames: ReadonlySet<string>;
}

function callHelper(ctx: LowerCtx, name: string, type: ShaderType, args: Expr[]): Expr {
  ctx.used.add(name);
  return { op: 'call', type, fn: name, args };
}

const isHelperOutput = (x: Expr): boolean =>
  (x.op === 'call' && x.fn.startsWith('df64_')) || (isScaledPair(x) && isHelperOutput(x.a));

// Why: a driver's fast-math (Apple Metal, ANGLE over FXC) drops the loaded lo word of a pair before
// a cancelling op; the twoSum of df64_add(x, 0) computes it again, and no test can run those drivers.
const renormForCancel = (ctx: LowerCtx, x: Expr): Expr =>
  isHelperOutput(x) ? x : callHelper(ctx, 'df64_add', vec2fT, [x, RENORM_ZERO]);

const renormForCancelVec = (ctx: LowerCtx, x: Expr, n: 2 | 3 | 4): Expr =>
  isHelperOutput(x)
    ? x
    : callHelper(ctx, `df64_v${n}_add`, structT(vec64StructName(n)), [
        x,
        splatPair(RENORM_ZERO, n),
      ]);

const oneValue = (a: Expr, b: Expr, ctx: LowerCtx): boolean =>
  typeKey(a.type) === typeKey(b.type) && keyOf(a) === keyOf(b) && !exprHasEffect(a, ctx.writes);

function literalValue(x: Expr): number | undefined {
  if (x.op === 'call' && x.fn === 'f64' && x.args.length === 1) return literalValue(x.args[0]!);
  if (x.op !== 'lit' || typeof x.value !== 'number') return undefined;
  return isF64(x.type) || (x.type.kind === 'scalar' && x.type.scalar === 'f32')
    ? x.value
    : undefined;
}

function exactScale(x: Expr, divide: boolean): number | undefined {
  const c = literalValue(x);
  if (c === undefined) return undefined;
  const s = divide ? 1 / c : c;
  const m = Math.abs(s);
  if (!(m >= 2 ** -126 && m <= 2 ** 127)) return undefined;
  return 2 ** Math.round(Math.log2(m)) === m ? s : undefined;
}

function isScaledPair(x: Expr): x is Extract<Expr, { op: 'binop' }> {
  return (
    x.op === 'binop' && x.bop === '*' && typeKey(x.type) === typeKey(vec2fT) && x.b.op === 'lit'
  );
}

function scalePair(pair: Expr, s: number): Expr {
  if (s === 1) return pair;
  if (s === -1) return { op: 'unop', type: vec2fT, a: pair };
  return { op: 'binop', type: vec2fT, bop: '*', a: pair, b: litF32(s) };
}

function runtimeValue(x: Expr, ctx: LowerCtx): boolean {
  const rt = (y: Expr): boolean => runtimeValue(y, ctx);
  const namedNonScalar = (t: ShaderType): boolean =>
    t.kind !== 'scalar' && !ctx.constTypes.has(typeKey(t));
  switch (x.op) {
    case 'varref':
      return ctx.runtimeNames.get(x.name) === typeKey(x.type) || namedNonScalar(x.type);
    case 'param':
      return namedNonScalar(x.type);
    case 'call':
      return x.fn.startsWith('df64_') || ctx.fnNames.has(x.fn) || x.args.some(rt);
    case 'member':
    case 'index':
      return rt(x.base);
    case 'unop':
      return rt(x.a);
    case 'construct':
      return x.args.some(rt);
    case 'binop':
      return intElemOf(x.type) === undefined && (rt(x.a) || rt(x.b));
    case 'select':
      return rt(x.ifTrue) && rt(x.ifFalse);
    default:
      return false;
  }
}

// Why: WGSL evaluates a const-expression when it creates the shader module and an override-expression
// when it creates the pipeline, and a result outside the f32 range is an error there, not an infinity.
const scaleIsSafe = (pair: Expr, s: number, ctx: LowerCtx): boolean =>
  Math.abs(s) <= 1 || runtimeValue(pair, ctx);

function vecPlanes(v: Expr, n: 2 | 3 | 4): [hi: Expr, lo: Expr] | undefined {
  if (v.op === 'construct' && v.args.length === 2) return [v.args[0]!, v.args[1]!];
  const named = (x: Expr): boolean =>
    x.op === 'varref' || x.op === 'param' || x.op === 'constref'
      ? true
      : x.op === 'member'
        ? named(x.base)
        : x.op === 'index'
          ? named(x.base) && (x.idx.op === 'lit' || named(x.idx))
          : false;
  return named(v) ? [plane(v, n, 'hi'), plane(v, n, 'lo')] : undefined;
}

function scaleVec(planes: [Expr, Expr], n: 2 | 3 | 4, s: number): Expr {
  const scaled = (p: Expr): Expr =>
    s === -1
      ? { op: 'unop', type: vecFT(n), a: p }
      : { op: 'binop', type: vecFT(n), bop: '*', a: p, b: litF32(s) };
  return {
    op: 'construct',
    type: structT(vec64StructName(n)),
    args: [scaled(planes[0]), scaled(planes[1])],
  };
}

function once(f: () => Expr): () => Expr {
  let v: Expr | undefined;
  return () => (v ??= f());
}

function cheapMulDiv(
  bop: '*' | '/',
  a: Expr,
  b: Expr,
  ctx: LowerCtx,
  la: () => Expr,
  lb: () => Expr,
): Expr | undefined {
  const sb = exactScale(b, bop === '/');
  if (sb !== undefined && scaleIsSafe(la(), sb, ctx)) return scalePair(la(), sb);
  if (bop === '/') return undefined;
  const sa = exactScale(a, false);
  if (sa !== undefined && scaleIsSafe(lb(), sa, ctx)) return scalePair(lb(), sa);
  return isF64(a.type) && oneValue(a, b, ctx)
    ? callHelper(ctx, 'df64_sqr', vec2fT, [la()])
    : undefined;
}

function lowerExpr(e: Expr, ctx: LowerCtx): Expr {
  const walk = (x: Expr): Expr => lowerExpr(x, ctx);
  if (isVec64(e.type)) ctx.vecWidths.add(e.type.n);
  if (isMat64(e.type)) {
    const n = mat64Dim(e.type);
    ctx.matWidths.add(n);
    ctx.vecWidths.add(n);
  }
  const pairOperand = (x: Expr): Expr => {
    if (isF64(x.type)) return walk(x);
    if (x.type.kind === 'scalar' && x.type.scalar === 'f32') return widen(walk(x));
    throw dslError('SD0041', `f64 op with a ${typeKey(x.type)} operand`);
  };
  const vecOperand = (x: Expr, n: 2 | 3 | 4): Expr => {
    if (isVec64(x.type)) return walk(x);
    return splatPair(pairOperand(x), n);
  };
  const lane = (lowered: Expr, n: 2 | 3 | 4, i: number): Expr =>
    laneSwizzle(lowered, n, 'xyzw'[i]!);

  switch (e.op) {
    case 'lit':
      return isF64(e.type) ? pairLit(e.value as number) : e;
    case 'constref':
    case 'externref':
    case 'overrideref':
    case 'param':
    case 'varref':
      return containsF64(e.type) ? { ...e, type: mapType(e.type) } : e;
    case 'binop': {
      if (isMat64(e.a.type)) {
        if (e.bop !== '*') throw dslError('SD0041', `binary op '${e.bop}' on ${typeKey(e.a.type)}`);
        const n = mat64Dim(e.a.type);
        if (isMat64(e.b.type))
          return callHelper(ctx, `df64_m${n}_matmul`, structT(mat64StructName(n)), [
            walk(e.a),
            walk(e.b),
          ]);
        if (isVec64(e.b.type))
          return callHelper(ctx, `df64_m${n}_matvec`, structT(vec64StructName(n)), [
            walk(e.a),
            walk(e.b),
          ]);
        throw dslError('SD0041', `matNxN<f64> '*' with a ${typeKey(e.b.type)} operand`);
      }
      if (isVec64(e.type)) {
        const n = e.type.n;
        const op = VEC_BINOP_FN[e.bop];
        if (op === undefined)
          throw dslError('SD0041', `binary op '${e.bop}' on ${typeKey(e.type)}`);
        const va = once(() => vecOperand(e.a, n));
        const vb = once(() => vecOperand(e.b, n));
        if (op === 'mul' || op === 'div') {
          const sb = isVec64(e.a.type) ? exactScale(e.b, op === 'div') : undefined;
          const sa = op === 'mul' && isVec64(e.b.type) ? exactScale(e.a, false) : undefined;
          const [lv, s] = sb !== undefined ? [va, sb] : [vb, sa];
          if (s !== undefined) {
            if (s === 1) return lv();
            const planes = vecPlanes(lv(), n);
            if (planes !== undefined && scaleIsSafe(lv(), s, ctx)) return scaleVec(planes, n, s);
          }
        }
        const renorm = (x: Expr): Expr =>
          op === 'sub' || op === 'div' ? renormForCancelVec(ctx, x, n) : x;
        return callHelper(ctx, `df64_v${n}_${op}`, structT(vec64StructName(n)), [
          renorm(va()),
          renorm(vb()),
        ]);
      }
      if (isF64(e.type)) {
        const fnName = BINOP_FN[e.bop];
        if (fnName === undefined)
          throw dslError('SD0041', `binary op '${e.bop}' on ${typeKey(e.a.type)}`);
        const la = once(() => pairOperand(e.a));
        const lb = once(() => pairOperand(e.b));
        if (e.bop === '*' || e.bop === '/') {
          const cheap = cheapMulDiv(e.bop, e.a, e.b, ctx, la, lb);
          if (cheap !== undefined) return cheap;
        }
        const renorm = (x: Expr): Expr =>
          fnName === 'df64_sub' || fnName === 'df64_div' ? renormForCancel(ctx, x) : x;
        return callHelper(ctx, fnName, vec2fT, [renorm(la()), renorm(lb())]);
      }
      return { ...e, a: walk(e.a), b: walk(e.b) };
    }
    case 'unop': {
      if (isF64(e.type)) return { op: 'unop', type: vec2fT, a: pairOperand(e.a) };
      if (isVec64(e.type)) {
        const n = e.type.n;
        const base = walk(e.a);
        const negPlane = (which: 'hi' | 'lo'): Expr => ({
          op: 'unop',
          type: vecFT(n),
          a: plane(base, n, which),
        });
        return {
          op: 'construct',
          type: structT(vec64StructName(n)),
          args: [negPlane('hi'), negPlane('lo')],
        };
      }
      return { ...e, a: walk(e.a) };
    }
    case 'compare':
      if (isF64(e.a.type) || isF64(e.b.type)) {
        return callHelper(ctx, CMP_FN[e.cop], boolT, [pairOperand(e.a), pairOperand(e.b)]);
      }
      if (isVec64(e.a.type) || isVec64(e.b.type)) {
        const t = e.a.type;
        if (
          !isVec64(t) ||
          typeKey(e.b.type) !== typeKey(t) ||
          typeKey(e.type) !== typeKey({ kind: 'vec', n: t.n, elem: 'bool' })
        ) {
          throw dslError(
            'SD0041',
            `compare '${e.cop}' of ${typeKey(e.a.type)} and ${typeKey(e.b.type)} typed ` +
              `${typeKey(e.type)}; two vec64s of one width compare into a vector of bools`,
          );
        }
        return callHelper(ctx, `df64_v${t.n}_${VEC_CMP_FN[e.cop]}`, e.type, [walk(e.a), walk(e.b)]);
      }
      return { ...e, a: walk(e.a), b: walk(e.b) };
    case 'logical':
      return { ...e, a: walk(e.a), b: walk(e.b) };
    case 'call': {
      if (e.fn === 'f64') {
        const a = e.args[0]!;
        return isF64(a.type) ? walk(a) : widen(walk(a));
      }
      if (e.fn === 'f64FromParts') {
        return { op: 'construct', type: vec2fT, args: [walk(e.args[0]!), walk(e.args[1]!)] };
      }
      if (e.fn === 'f64Parts') {
        return walk(e.args[0]!);
      }
      if (e.fn === 'f32' && e.args.length === 1 && isF64(e.args[0]!.type)) {
        return callHelper(ctx, 'df64_narrow', f32T, [walk(e.args[0]!)]);
      }
      if (e.fn === 'transpose' && isMat64(e.args[0]!.type)) {
        const n = mat64Dim(e.args[0]!.type);
        return callHelper(ctx, `df64_m${n}_transpose`, structT(mat64StructName(n)), [
          walk(e.args[0]!),
        ]);
      }
      if (isMat64(e.type) || e.args.some((a) => isMat64(a.type))) {
        if (isKnownIntrinsic(e.fn)) throw dslError('SD0041', `${e.fn}() on mat64 operands`);
      }
      if (
        (e.fn === 'dot' || e.fn === 'length' || e.fn === 'distance') &&
        isVec64(e.args[0]!.type)
      ) {
        const n = (e.args[0]!.type as Extract<ShaderType, { kind: 'vec64' }>).n;
        // Why: df64_sqr takes a lane once where df64_mul(li, li) took it twice, but every lane still spells
        // the lowered vector in its hi and its lo swizzle, so a call inside it runs 2n times unless CSE
        // merges the copies, which is wrong for a call that writes. That predates the square; not fixed here.
        const sumSquares = (laneAt: (i: number) => Expr): Expr => {
          let acc: Expr | undefined;
          for (let i = 0; i < n; i++) {
            const sq = callHelper(ctx, 'df64_sqr', vec2fT, [laneAt(i)]);
            acc = acc === undefined ? sq : callHelper(ctx, 'df64_add', vec2fT, [acc, sq]);
          }
          return acc!;
        };
        if (e.fn === 'dot') {
          if (oneValue(e.args[0]!, e.args[1]!, ctx)) {
            const v = walk(e.args[0]!);
            return sumSquares((i) => lane(v, n, i));
          }
          const a = walk(e.args[0]!);
          const b = walk(e.args[1]!);
          let acc: Expr | undefined;
          for (let i = 0; i < n; i++) {
            const prod = callHelper(ctx, 'df64_mul', vec2fT, [lane(a, n, i), lane(b, n, i)]);
            acc = acc === undefined ? prod : callHelper(ctx, 'df64_add', vec2fT, [acc, prod]);
          }
          return acc!;
        }
        if (e.fn === 'length') {
          const a = walk(e.args[0]!);
          return callHelper(ctx, 'df64_sqrt', vec2fT, [sumSquares((i) => lane(a, n, i))]);
        }
        const a = walk(e.args[0]!);
        const b = walk(e.args[1]!);
        return callHelper(ctx, 'df64_sqrt', vec2fT, [
          sumSquares((i) =>
            callHelper(ctx, 'df64_sub', vec2fT, [
              renormForCancel(ctx, lane(a, n, i)),
              renormForCancel(ctx, lane(b, n, i)),
            ]),
          ),
        ]);
      }
      if (isVec64(e.type) && VEC_CALL_KIND[e.fn] !== undefined) {
        const n = e.type.n;
        const sTy = structT(vec64StructName(n));
        const kind = VEC_CALL_KIND[e.fn]!;
        if (kind === 'unary') {
          const arg = vecOperand(e.args[0]!, n);
          const cancels =
            e.fn === 'fract' ||
            e.fn === 'round' ||
            e.fn === 'normalize' ||
            e.fn === 'sin' ||
            e.fn === 'cos';
          const a = cancels ? renormForCancelVec(ctx, arg, n) : arg;
          return callHelper(ctx, `df64_v${n}_${e.fn}`, sTy, [a]);
        }
        if (kind === 'binary') {
          return callHelper(ctx, `df64_v${n}_${e.fn}`, sTy, [
            vecOperand(e.args[0]!, n),
            vecOperand(e.args[1]!, n),
          ]);
        }
        const t = e.args[2]!;
        if (!(t.type.kind === 'scalar' && t.type.scalar === 'f32')) {
          throw dslError(
            'SD0041',
            `mix() on vec64 needs a scalar f32 interpolant, got ${typeKey(t.type)}`,
          );
        }
        return callHelper(ctx, `df64_v${n}_mix`, sTy, [
          renormForCancelVec(ctx, vecOperand(e.args[0]!, n), n),
          renormForCancelVec(ctx, vecOperand(e.args[1]!, n), n),
          walk(t),
        ]);
      }
      if (isVec64(e.type) || e.args.some((a) => isVec64(a.type))) {
        if (isKnownIntrinsic(e.fn) || e.fn === 'i32' || e.fn === 'u32' || e.fn === 'f32') {
          throw dslError('SD0041', `${e.fn}() on vec64 operands`);
        }
      }
      const touchesF64 = isF64(e.type) || e.args.some((a) => isF64(a.type));
      if (touchesF64) {
        const mapped = CALL_FN[e.fn];
        if (mapped !== undefined) {
          if (e.fn === 'mix') {
            const t = e.args[2]!;
            if (isF64(t.type))
              throw dslError('SD0041', 'mix() interpolant t must be f32 (narrow it with toF32)');
            return callHelper(ctx, mapped, vec2fT, [
              renormForCancel(ctx, pairOperand(e.args[0]!)),
              renormForCancel(ctx, pairOperand(e.args[1]!)),
              walk(t),
            ]);
          }
          if (e.fn === 'fract' || e.fn === 'round' || e.fn === 'sin' || e.fn === 'cos') {
            return callHelper(ctx, mapped, vec2fT, [renormForCancel(ctx, pairOperand(e.args[0]!))]);
          }
          const ret = isF64(e.type) ? vec2fT : mapType(e.type);
          return callHelper(ctx, mapped, ret, e.args.map(pairOperand));
        }
        if (isKnownIntrinsic(e.fn) || e.fn === 'i32' || e.fn === 'u32') {
          throw dslError('SD0041', `${e.fn}() on f64 operands`);
        }
      }
      return { ...e, type: mapType(e.type), args: e.args.map(walk) };
    }
    case 'member':
      if (isVec64(e.base.type)) {
        return laneSwizzle(walk(e.base), e.base.type.n, e.field);
      }
      return { ...e, type: mapType(e.type), base: walk(e.base) };
    case 'construct': {
      if (e.type.kind === 'vec64') {
        const n = e.type.n;
        const pairs = e.args.map(pairOperand);
        const planeOf = (c: 'x' | 'y'): Expr => ({
          op: 'construct',
          type: vecFT(n),
          args: pairs.map((pr): Expr => ({ op: 'member', type: f32T, base: pr, field: c })),
        });
        return {
          op: 'construct',
          type: structT(vec64StructName(n)),
          args: [planeOf('x'), planeOf('y')],
        };
      }
      if (e.type.kind === 'mat' && e.type.elem === 'f64') {
        const n = mat64Dim(e.type);
        return {
          op: 'construct',
          type: structT(mat64StructName(n)),
          args: e.args.map((a) => vecOperand(a, n)),
        };
      }
      if (
        (e.type.kind === 'vec' || e.type.kind === 'mat') &&
        e.args.some((a) => isF64(a.type) || isVec64(a.type))
      ) {
        throw dslError('SD0041', `${typeKey(e.type)} constructor with an f64 component`);
      }
      return { ...e, type: mapType(e.type), args: e.args.map(walk) };
    }
    case 'select':
      return {
        ...e,
        type: mapType(e.type),
        cond: walk(e.cond),
        ifTrue: walk(e.ifTrue),
        ifFalse: walk(e.ifFalse),
      };
    case 'index':
      return { ...e, type: mapType(e.type), base: walk(e.base), idx: walk(e.idx) };
    case 'matchExpr': {
      if (isF64(e.scrutinee.type))
        throw dslError('SD0041', 'matchExpr scrutinee must be an integer scalar, got f64');
      return {
        ...e,
        type: mapType(e.type),
        scrutinee: walk(e.scrutinee),
        cases: e.cases.map(([v, x]) => [v, walk(x)] as const),
        default: walk(e.default),
      };
    }
  }
}

function lowerStmt(s: Stmt, ctx: LowerCtx): Stmt {
  const walk = (x: Expr): Expr => lowerExpr(x, ctx);
  switch (s.s) {
    case 'let':
      return { ...s, expr: walk(s.expr) };
    case 'var':
      return {
        ...s,
        type: mapType(s.type),
        ...(s.init !== undefined ? { init: walk(s.init) } : {}),
      };
    case 'assign': {
      if (isVec64(s.target.type) && !isVec64(s.expr.type)) {
        throw dslError(
          'SD0041',
          `assign of ${typeKey(s.expr.type)} to a ${typeKey(s.target.type)} target`,
        );
      }
      if (isF64(s.target.type) && !isF64(s.expr.type)) {
        const value =
          s.expr.type.kind === 'scalar' && s.expr.type.scalar === 'f32'
            ? widen(walk(s.expr))
            : (() => {
                throw dslError('SD0041', `assign of ${typeKey(s.expr.type)} to an f64 target`);
              })();
        return { s: 'assign', target: walk(s.target), expr: value };
      }
      return { ...s, target: walk(s.target), expr: walk(s.expr) };
    }
    case 'call':
      return { ...s, expr: walk(s.expr) };
    case 'assignOp': {
      if (isVec64(s.target.type)) {
        const n = s.target.type.n;
        const op = VEC_BINOP_FN[s.bop];
        if (op === undefined)
          throw dslError('SD0041', `compound assign '${s.bop}=' on ${typeKey(s.target.type)}`);
        const target = lowerExpr(s.target, ctx);
        ctx.used.add(`df64_v${n}_${op}`);
        const rhs = isVec64(s.expr.type)
          ? lowerExpr(s.expr, ctx)
          : (() => {
              throw dslError('SD0041', `'${s.bop}=' of ${typeKey(s.expr.type)} on vec64`);
            })();
        return {
          s: 'assign',
          target,
          expr: {
            op: 'call',
            type: structT(vec64StructName(n)),
            fn: `df64_v${n}_${op}`,
            args: [target, rhs],
          },
        };
      }
      if (isF64(s.target.type)) {
        const fnName = BINOP_FN[s.bop];
        if (fnName === undefined) throw dslError('SD0041', `compound assign '${s.bop}=' on f64`);
        const target = walk(s.target);
        const rhs = once(() =>
          isF64(s.expr.type)
            ? walk(s.expr)
            : s.expr.type.kind === 'scalar' && s.expr.type.scalar === 'f32'
              ? widen(walk(s.expr))
              : (() => {
                  throw dslError('SD0041', `'${s.bop}=' of ${typeKey(s.expr.type)} on f64`);
                })(),
        );
        if (s.bop === '*' || s.bop === '/') {
          const cheap = cheapMulDiv(s.bop, s.target, s.expr, ctx, () => target, rhs);
          if (cheap !== undefined) return { s: 'assign', target, expr: cheap };
        }
        ctx.used.add(fnName);
        return {
          s: 'assign',
          target,
          expr: { op: 'call', type: vec2fT, fn: fnName, args: [target, rhs()] },
        };
      }
      return { ...s, target: walk(s.target), expr: walk(s.expr) };
    }
    case 'return':
      return s.expr !== undefined ? { ...s, expr: walk(s.expr) } : s;
    case 'if':
      return {
        ...s,
        arms: s.arms.map((arm) => ({
          cond: walk(arm.cond),
          body: arm.body.map((b) => lowerStmt(b, ctx)),
        })),
        ...(s.elseBody ? { elseBody: s.elseBody.map((b) => lowerStmt(b, ctx)) } : {}),
      };
    case 'for':
      return {
        ...s,
        init: lowerStmt(s.init, ctx),
        cond: walk(s.cond),
        update: lowerStmt(s.update, ctx),
        body: s.body.map((b) => lowerStmt(b, ctx)),
      };
    case 'switch':
      return {
        ...s,
        scrut: walk(s.scrut),
        cases: s.cases.map((c) => ({ ...c, body: c.body.map((b) => lowerStmt(b, ctx)) })),
        ...(s.defaultBody ? { defaultBody: s.defaultBody.map((b) => lowerStmt(b, ctx)) } : {}),
      };
    case 'break':
    case 'continue':
    case 'discard':
    case 'placeholder':
    case 'raw':
      return s;
  }
}

function exprHasF64(e: Expr): boolean {
  if (containsF64(e.type)) return true;
  switch (e.op) {
    case 'lit':
    case 'constref':
    case 'externref':
    case 'overrideref':
    case 'param':
    case 'varref':
      return false;
    case 'binop':
    case 'compare':
    case 'logical':
      return exprHasF64(e.a) || exprHasF64(e.b);
    case 'unop':
      return exprHasF64(e.a);
    case 'call':
    case 'construct':
      return e.args.some(exprHasF64);
    case 'member':
      return exprHasF64(e.base);
    case 'select':
      return exprHasF64(e.cond) || exprHasF64(e.ifTrue) || exprHasF64(e.ifFalse);
    case 'index':
      return exprHasF64(e.base) || exprHasF64(e.idx);
    case 'matchExpr':
      return (
        exprHasF64(e.scrutinee) || e.cases.some(([, v]) => exprHasF64(v)) || exprHasF64(e.default)
      );
  }
}

function stmtHasF64(s: Stmt): boolean {
  switch (s.s) {
    case 'let':
      return exprHasF64(s.expr);
    case 'var':
      return containsF64(s.type) || (s.init !== undefined && exprHasF64(s.init));
    case 'assign':
    case 'assignOp':
      return exprHasF64(s.target) || exprHasF64(s.expr);
    case 'return':
      return s.expr !== undefined && exprHasF64(s.expr);
    case 'call':
      return exprHasF64(s.expr);
    case 'if':
      return (
        s.arms.some((a) => exprHasF64(a.cond) || a.body.some(stmtHasF64)) ||
        (s.elseBody?.some(stmtHasF64) ?? false)
      );
    case 'for':
      return (
        stmtHasF64(s.init) || exprHasF64(s.cond) || stmtHasF64(s.update) || s.body.some(stmtHasF64)
      );
    case 'switch':
      return (
        exprHasF64(s.scrut) ||
        s.cases.some((c) => c.body.some(stmtHasF64)) ||
        (s.defaultBody?.some(stmtHasF64) ?? false)
      );
    default:
      return false;
  }
}

function moduleUsesF64(m: ModuleDecl): boolean {
  return (
    m.consts.some((c) => containsF64(c.type)) ||
    m.structs.some((s) => s.fields.some((f) => containsF64(f.type))) ||
    m.bindings.some((b) => containsF64(b.type)) ||
    m.funcs.some(
      (f) =>
        containsF64(f.ret) || f.params.some((p) => containsF64(p.type)) || f.body.some(stmtHasF64),
    )
  );
}

function helperCallees(d: FuncDecl): string[] {
  const out = new Set<string>();
  for (const s of d.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && x.fn.startsWith('df64_')) out.add(x.fn);
      }),
    );
  return [...out];
}

function helperClosure(
  used: ReadonlySet<string>,
  fns: ReadonlyMap<string, FuncDecl>,
  order: readonly FuncDecl[],
): FuncDecl[] {
  const need = new Set(used);
  const queue = [...used];
  while (queue.length) {
    const d = fns.get(queue.pop()!);
    if (!d) continue;
    for (const callee of helperCallees(d)) {
      if (!need.has(callee)) {
        need.add(callee);
        queue.push(callee);
      }
    }
  }
  return order.filter((d) => need.has(d.name));
}

const GUARD_VALUE = '_fp64_g';

const isGuardFetch = (x: Expr): boolean => x.op === 'call' && x.fn === 'f64Guard';

const guardFetch = (): Expr => ({ op: 'call', type: f32T, fn: 'f64Guard', args: [] });

const isGuarded = (x: Expr): boolean =>
  isGuardFetch(x) ||
  (x.op === 'binop' && x.bop === '*' && (isGuardFetch(x.a) || isGuardFetch(x.b)));

export function foldGuardChain(e: Expr): Expr {
  const r = mapChildren(e, foldGuardChain);
  if (r.op !== 'binop' || r.bop !== '*') return r;
  const other = isGuardFetch(r.b) ? r.a : isGuardFetch(r.a) ? r.b : undefined;
  return other !== undefined && isGuarded(other) && typeKey(other.type) === typeKey(r.type)
    ? other
    : r;
}

function guardUsers(decls: readonly FuncDecl[]): Set<string> {
  const users = new Set<string>();
  const callees = new Map<string, string[]>();
  for (const d of decls) {
    let reads = false;
    for (const s of d.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if (isGuardFetch(x)) reads = true;
        }),
      );
    if (reads) users.add(d.name);
    callees.set(d.name, helperCallees(d));
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, cs] of callees)
      if (!users.has(name) && cs.some((c) => users.has(c))) {
        users.add(name);
        grew = true;
      }
  }
  return users;
}

function passGuard(e: Expr, users: ReadonlySet<string>, g: Expr): Expr {
  if (isGuardFetch(e)) return g;
  const r = mapChildren(e, (c) => passGuard(c, users, g));
  if (r.op !== 'call' || !users.has(r.fn)) return r;
  const { declRef: _stale, ...call } = r;
  return { ...call, args: [...r.args, g] };
}

// Why: WGSL's uniformity analysis reads `var<private>` as non-uniform, and Tint then refuses an f64
// comparison that decides a branch around `textureSample`; a parameter is as uniform as its arguments.
function threadHelper(d: FuncDecl, users: ReadonlySet<string>): FuncDecl {
  if (!users.has(d.name)) return d;
  const g: Expr = { op: 'param', type: f32T, name: GUARD_VALUE };
  return {
    ...d,
    params: [...d.params, { name: GUARD_VALUE, type: f32T }],
    body: d.body.map((s) => mapStmtExpr(s, (e) => passGuard(foldGuardChain(e), users, g))),
  };
}

function boundNames(f: FuncDecl): Set<string> {
  const names = new Set(f.params.map((p) => p.name));
  const visit = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') names.add(s.name);
    eachStmtExpr(s, () => {}, visit);
  };
  for (const s of f.body) visit(s);
  return names;
}

function bodyHas(f: FuncDecl, hit: (x: Expr) => boolean): boolean {
  let found = false;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (hit(x)) found = true;
      }),
    );
  return found;
}

function readsGuardOnce(f: FuncDecl): boolean {
  const first = f.body[0];
  if (first?.s !== 'let' || !isGuardFetch(first.expr)) return false;
  let n = 0;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (isGuardFetch(x)) n++;
      }),
    );
  return n === 1;
}

export function hoistGuardFetch(m: ModuleDecl): ModuleDecl {
  if (!m.funcs.some((f) => bodyHas(f, isGuardFetch) && !readsGuardOnce(f))) return m;
  const replace = (g: Expr): ((e: Expr) => Expr) => {
    const r = (e: Expr): Expr => (isGuardFetch(e) ? g : mapChildren(e, r));
    return r;
  };
  const moduleNames = new Set<string>([
    ...m.bindings.map((b) => b.name),
    ...m.consts.map((c) => c.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...(m.externs ?? []).map((v) => v.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...m.funcs.map((f) => f.name),
  ]);
  const funcs = m.funcs.map((f) => {
    if (!bodyHas(f, isGuardFetch) || readsGuardOnce(f)) return f;
    const taken = boundNames(f);
    let name = GUARD_VALUE;
    for (let i = 1; taken.has(name) || moduleNames.has(name); i++) name = `${GUARD_VALUE}${i}`;
    const to = replace({ op: 'varref', type: f32T, name });
    return {
      ...f,
      body: [
        { s: 'let' as const, name, expr: guardFetch() },
        ...f.body.map((s) => mapStmtExpr(s, to)),
      ],
    };
  });
  return { ...m, funcs };
}

interface GuardPlan {
  readonly users: ReadonlySet<string>;
  readonly helpers: ReadonlyMap<string, FuncDecl>;
}
const GUARD_PLANS = new WeakMap<readonly FuncDecl[], GuardPlan>();
function guardPlan(order: readonly FuncDecl[]): GuardPlan {
  let plan = GUARD_PLANS.get(order);
  if (plan === undefined) {
    const users = guardUsers(order);
    plan = { users, helpers: new Map(order.map((d) => [d.name, threadHelper(d, users)])) };
    GUARD_PLANS.set(order, plan);
  }
  return plan;
}

function injectGuard(bindings: BindingDecl[]): void {
  const at = bindings.findIndex((b) => b.name === FP64_GUARD_NAME);
  if (at >= 0) {
    const existing = bindings[at]!;
    if (typeKey(existing.type) !== typeKey(FP64_GUARD_TYPE)) {
      throw dslError(
        'SD0042',
        `binding '${FP64_GUARD_NAME}' exists but is ${existing.space} ${typeKey(existing.type)}`,
      );
    }
    if (existing.precision === undefined) bindings[at] = { ...existing, precision: 'highp' };
  } else {
    const g0 = bindings.filter((b) => b.group === 0);
    const slot = g0.length ? Math.max(...g0.map((b) => b.binding)) + 1 : 0;
    bindings.push({
      group: 0,
      binding: slot,
      name: FP64_GUARD_NAME,
      space: 'uniform',
      // Why: a texture, since a driver (Windows, NVIDIA) specializes a pipeline on a uniform's value and folds the guard away.
      type: FP64_GUARD_TYPE,
      // Why: GLSL ES 3.00 gives `sampler2D` a default precision of lowp in both stages.
      precision: 'highp',
    });
  }
}

/** Rewrite every f64 value in a module into its two-f32 emulation, so that no backend has to
 *  spell the type. An f64 scalar becomes a `vec2<f32>` holding a (hi, lo) pair, `vecN<f64>`
 *  becomes a `DF64VecN` struct of two `vecN<f32>` planes, `matNxN<f64>` becomes a `DF64MatN`
 *  struct, and the arithmetic, comparisons and supported builtins over them become calls to
 *  injected `df64_*` helper functions, which are appended to the module's funcs. A module with
 *  no f64 anywhere is returned as the same object.
 *
 *  Supported on f64 operands: `+ - * /`, negation, the six comparisons, `sqrt`, `abs`, `min`,
 *  `max`, `mix` (with an f32 interpolant), `floor`, `fract`, `sin`, `cos`, widening from f32 and
 *  narrowing to f32. On `vecN<f64>` additionally `dot`, `length`, `distance`, `normalize` and
 *  the componentwise forms of the list above; on `matNxN<f64>`, `*` and `transpose`. Any other
 *  builtin on an f64 operand throws; narrow the operand to f32 first when you need one.
 *
 *  Two kinds of multiply take a cheaper form. `x * x`, when `x` has no side effect, is
 *  `df64_sqr(x)`, the multiply specialised to one operand. A multiply by a power-of-two
 *  literal, or a divide by such a literal, scales the two words of the pair by an f32 literal,
 *  which is exact barring overflow and underflow. A scale that can grow the value (|s| > 1)
 *  is taken only when `x` is computed at run time, so that WGSL never evaluates a constant
 *  that overflows while it creates the shader; a constant `x` keeps the general multiply.
 *
 *  When an injected helper reads the runtime guard, the pass also declares the `_fp64` guard
 *  binding at group 0, first index past the module's own group-0 bindings. Declare
 *  {@link fp64Guard} in the module to pin that slot yourself. The host writes `1.0` into it.
 *  Those helpers take the guard as a trailing `_fp64_g: f32` parameter rather than fetching
 *  it themselves, and every call of one from the module's own functions passes the texel
 *  fetch as that argument. The emit functions then read it once per function, into a `let`
 *  named `_fp64_g` at the top of the body, after the optimizer has run.
 *
 *  The emit functions run this pass for you; pass `fp64Flavor` in {@link EmitOptions} to select
 *  the flavour there. Call it directly when you want to inspect the lowered module.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to lower.
 *  @param opts - `flavor` selects which primitives back the helpers; see {@link Fp64Flavor}.
 *  @returns a new module with its f64 declarations and bodies rewritten and the helper functions
 *    appended, or `m` itself when it contains no f64.
 *  @throws SD0041 for an operation on f64 operands that has no emulation.
 *  @throws SD0042 when the module declares a `_fp64` binding whose type differs from the guard's.
 *  @throws SD0043 when the module declares a function named `df64_*` or a struct named
 *    `DF64Vec*` or `DF64Mat*`; those names are reserved for the injected helpers.
 *  @throws SD0044 for an f64 in an interpolated `@location` struct field, a fragment input, or a
 *    stage entry's return value; interpolating a (hi, lo) pair is numerically wrong.
 *
 *  @example
 *  ```ts
 *  import { fp64Lower } from 'typeshade'
 *
 *  // authored: a ModuleDecl whose functions use f64
 *  const lowered = fp64Lower(authored, { flavor: 'integer' })
 *  // lowered.funcs ends with the df64_* helpers the module needs
 *  ```
 */
export function fp64Lower(m: ModuleDecl, opts?: Fp64LowerOptions): ModuleDecl {
  if (!moduleUsesF64(m)) return m;
  const integer = opts?.flavor === 'integer';
  const REG_FNS = integer ? DF64_FNS_INT : DF64_FNS;
  const REG_ORDER = integer ? DF64_ORDER_INT : DF64_ORDER;

  for (const f of m.funcs) {
    if (f.name.startsWith('df64_')) throw dslError('SD0043', `fn '${f.name}'`);
  }
  for (const st of m.structs) {
    if (st.name.startsWith('DF64Vec') || st.name.startsWith('DF64Mat'))
      throw dslError('SD0043', `struct '${st.name}'`);
  }

  const ctx: LowerCtx = {
    used: new Set(),
    vecWidths: new Set(),
    matWidths: new Set(),
    writes: fnWrites(m),
    runtimeNames: new Map(
      [...m.bindings, ...(m.vars ?? [])].map((d) => [d.name, typeKey(mapType(d.type))]),
    ),
    constTypes: new Set(m.consts.map((c) => typeKey(mapType(c.type)))),
    fnNames: new Set(m.funcs.map((f) => f.name)),
  };
  const recordWidths = (t: ShaderType): void => {
    if (isVec64(t)) ctx.vecWidths.add(t.n);
    // A mat width forces its vec width — DF64MatN nests DF64VecN columns.
    else if (isMat64(t)) {
      const n = mat64Dim(t);
      ctx.matWidths.add(n);
      ctx.vecWidths.add(n);
    } else if (t.kind === 'array') recordWidths(t.elem);
  };

  const consts: ConstDecl[] = m.consts.map((c) => {
    if (!containsF64(c.type)) return c;
    recordWidths(c.type);
    const valueExpr = c.valueExpr !== undefined ? lowerExpr(c.valueExpr, ctx) : pairLit(c.cpuValue);
    return { name: c.name, type: mapType(c.type), wgslValue: 0, cpuValue: 0, valueExpr };
  });

  const structs: StructDecl[] = m.structs.map((s) => {
    if (!s.fields.some((f) => containsF64(f.type))) return s;
    return {
      ...s,
      fields: s.fields.map((f) => {
        if (!containsF64(f.type)) return f;
        if (f.location !== undefined) throw dslError('SD0044', `${s.name}.${f.name}`);
        recordWidths(f.type);
        return { ...f, type: mapType(f.type) };
      }),
    };
  });

  const bindings: BindingDecl[] = m.bindings.map((b) => {
    if (!containsF64(b.type)) return b;
    recordWidths(b.type);
    return { ...b, type: mapType(b.type) };
  });

  const vars: ModuleVarDecl[] | undefined = m.vars?.map((v) => {
    if (!containsF64(v.type)) return v;
    recordWidths(v.type);
    return {
      ...v,
      type: mapType(v.type),
      ...(v.init !== undefined ? { init: lowerExpr(v.init, ctx) } : {}),
    };
  });

  const funcs: FuncDecl[] = m.funcs.map((f) => {
    const stage = stageOf(f);
    const params = f.params.map((p) => {
      if (!containsF64(p.type)) return p;
      if (stage === 'fragment' && p.location !== undefined)
        throw dslError('SD0044', `fragment input '${p.name}'`);
      if (p.location !== undefined && isVec64(p.type))
        throw dslError(
          'SD0041',
          `vec64 vertex attribute '${p.name}' — pass hi/lo as two vecN<f32> @locations and rebuild lanes with f64FromParts`,
        );
      recordWidths(p.type);
      return { ...p, type: mapType(p.type) };
    });
    let ret = f.ret;
    if (containsF64(f.ret)) {
      if (stage !== undefined) throw dslError('SD0044', `${stage} entry '${f.name}' return`);
      recordWidths(f.ret);
      ret = mapType(f.ret);
    }
    const body = f.body.map((s) => lowerStmt(s, ctx));
    return { ...f, params, ret, body };
  });

  for (const n of [2, 3, 4] as const) {
    if (ctx.vecWidths.has(n)) structs.push(DF64_VEC_STRUCTS.get(n)!);
  }
  for (const n of [2, 3, 4] as const) {
    if (ctx.matWidths.has(n)) structs.push(DF64_MAT_STRUCTS.get(n)!);
  }

  const plan = guardPlan(REG_ORDER);
  const helpers = helperClosure(ctx.used, REG_FNS, REG_ORDER).map((d) => ({
    ...plan.helpers.get(d.name)!,
    opaque: true,
  }));
  // Why: Tint and Dawn drop a binding the shader never reads from a `layout: 'auto'` bind-group layout,
  // and the bind group then no longer matches (a draw that does nothing on D3D12 with NVIDIA).
  if (helpers.some((d) => plan.users.has(d.name))) injectGuard(bindings);
  const threaded = funcs.map((f) =>
    bodyHas(f, (x) => x.op === 'call' && plan.users.has(x.fn))
      ? {
          ...f,
          body: f.body.map((s) => mapStmtExpr(s, (e) => passGuard(e, plan.users, guardFetch()))),
        }
      : f,
  );
  const guardedConsts = consts.map((c) =>
    c.valueExpr === undefined
      ? c
      : { ...c, valueExpr: passGuard(c.valueExpr, plan.users, guardFetch()) },
  );

  return {
    ...m,
    consts: guardedConsts,
    structs,
    bindings,
    ...(vars !== undefined ? { vars } : {}),
    funcs: [...threaded, ...helpers],
  };
}
