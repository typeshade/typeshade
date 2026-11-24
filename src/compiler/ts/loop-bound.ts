import { cmpHolds } from './loop-bound/counted-for.js';
export { analyzeCountedFor, boundWrittenIn } from './loop-bound/counted-for.js';
export type { CountedLoop } from './loop-bound/counted-for.js';
// Implements: Rule 7.4 (docs/language-design.md; traced in reqs/).

import { logicalTypeKey as typeKey } from './optional.js';
import type { Expr } from '../../core/ir/nodes.js';
import { eachExpr } from '../../core/ir/visit.js';
import { type LoweringScope } from './context.js';
import { TS_CODES, type TsCode } from './codes.js';
import { shiftAmountOutOfRange } from './lit-coerce.js';
import { intElemOf, wrapInt } from '../../core/passes/opt/expr-utils.js';
import { foldConstNumber, foldConstBool } from './loop-bound/fold-const.js';
import { isF32Valued, foldConstComponents } from './loop-bound/const-components.js';
export { foldConstComponents } from './loop-bound/const-components.js';
export { forUpdateRefusal } from './loop-bound/step.js';
export { foldConstNumber, foldConstBool, foldConstValue } from './loop-bound/fold-const.js';

function foldConstCond(expr: Expr, scope: LoweringScope): boolean | undefined {
  const known = foldConstBool(expr, scope);
  if (known !== undefined) return known;
  if (expr.op === 'constref' || expr.op === 'varref' || expr.op === 'param') {
    const b = scope.resolveIr(expr.name);
    if (!b || typeKey(b.type) !== 'bool' || (expr.op !== 'constref' && b.mutable)) {
      return undefined;
    }
    const v = b.constValue;
    return typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : undefined;
  }
  if (expr.op === 'logical') {
    const a = foldConstCond(expr.a, scope);
    const b = foldConstCond(expr.b, scope);
    const decides = expr.lop === '||';
    if (a === decides || b === decides) return decides;
    return a === undefined || b === undefined ? undefined : !decides;
  }
  if (expr.op === 'compare' && typeKey(expr.type) === 'bool') {
    const a = exactOperand(expr.a, scope);
    const b = exactOperand(expr.b, scope);
    return a === undefined || b === undefined ? undefined : cmpHolds(expr.cop, a, b);
  }
  return undefined;
}

function exactOperand(e: Expr, scope: LoweringScope): number | undefined {
  const b = foldConstCond(e, scope);
  if (b !== undefined) return Number(b);
  let integral = true;
  eachExpr(e, (x) => {
    if (intElemOf(x.type) === undefined && typeKey(x.type) !== 'bool') integral = false;
  });
  if (integral) return foldConstNumber(e, scope);
  const leaf = e.op === 'unop' ? e.a : e;
  if (leaf.op !== 'lit' && leaf.op !== 'constref') return undefined;
  const v = foldConstNumber(e, scope);
  return v !== undefined && Math.fround(v) === v ? v : undefined;
}

export function openLoopError(
  cond: Expr,
  scope: LoweringScope,
  hasExit: boolean,
  loop: string,
): { message: string; code: TsCode } | undefined {
  if (foldConstCond(cond, scope) !== true || hasExit) return undefined;
  return {
    message:
      `${loop} has no break or return in its body, so it never ends. Leave it ` +
      'with a break, or write the exit into the condition.',
    code: TS_CODES.LOOP_INFINITE,
  };
}

export function constShiftAmountOutOfRange(amount: Expr, scope: LoweringScope): number | undefined {
  if (amount.type.kind !== 'vec') {
    const n = foldConstNumber(amount, scope);
    return n !== undefined && shiftAmountOutOfRange(n) ? n : undefined;
  }
  const parts = foldConstComponents(amount, scope);
  if (parts === undefined || !parts.every((v) => Number.isInteger(v))) return undefined;
  const int = intElemOf(amount.type);
  return parts.map((v) => (int === undefined ? v : wrapInt(v, int))).find(shiftAmountOutOfRange);
}

/* Why: WGSL evaluates a call whose arguments are all constant when it creates the shader, and an
 *  argument outside the domain is a shader-creation error (WGSL §15.7.2, #613, Rule 12.6).
 *  Measured on Tint (Chromium 141.0.7390.37, SwiftShader):
 *
 *    pow(-2.0, 0.5), pow(-2.0, 2.0)   '-2.0 ^ 2.0' cannot be represented as 'abstract-float'
 *    pow(0.0, -1.0), pow(0.0, 0.0)    '0.0 ^ 0.0' cannot be represented as 'abstract-float'
 *    sqrt(-1.0)                       sqrt must be called with a value >= 0
 *    inverseSqrt(0.0)                 inverseSqrt must be called with a value > 0
 *    log(0.0), log2(-1.0)             log must be called with a value > 0
 *    acos(1.5), asin(-1.5)            acos must be called with a value in the range [-1 .. 1] (inclusive)
 *    acosh(0.5)                       acosh must be called with a value >= 1.0
 *    atanh(1.0)                       atanh must be called with a value in the range (-1 .. 1) (exclusive)
 *    smoothstep(1.0, 1.0, x)          smoothstep called with 'low' (1.0) equal to 'high' (1.0),
 *                                     with a constant `x` and with a run-time one
 *    normalize(vec2(0.0, 0.0))        zero length vector can not be normalized
 *
 *  and accepted: pow(-0.0, 2.0), pow(0.0, 2.0), pow(2.0, 0.5), sqrt(-0.0), log(1.0), acos(-1.0),
 *  acosh(1.0), atanh(0.5), smoothstep(2.0, 1.0, 0.5) (crossed edges are not refused), and every
 *  other call with a run-time argument (`pow(-2.0, x)`, `pow(x, -1.0)`). */
export function constCallOutsideDomain(
  fn: string,
  args: readonly Expr[],
  scope: LoweringScope,
):
  { readonly index: number; readonly values: readonly number[]; readonly why: string } | undefined {
  const checked = fn === 'smoothstep' ? args.slice(0, 2) : args;
  if (!checked.every((a) => isF32Valued(a.type))) return undefined;
  const exact = checked.map((a) =>
    foldConstComponents(a, scope, undefined, undefined, undefined, true),
  );
  const steps = checked.map((a) =>
    foldConstComponents(a, scope, undefined, undefined, Math.fround, true),
  );
  if (exact.some((c) => c === undefined) || steps.some((c) => c === undefined)) return undefined;
  const width = Math.max(...exact.map((c) => c!.length));
  const at = (cs: (number[] | undefined)[], i: number): number[] =>
    cs.map((c) => c![c!.length === 1 ? 0 : i]!);
  const why = (xs: readonly number[]): string | undefined => {
    const [a, b] = xs as [number, number];
    switch (fn) {
      case 'pow':
        if (a < 0) return `the base ${show(a)} is below 0`;
        if (a === 0 && b <= 0) return `the base is 0 and the exponent ${show(b)} is not above 0`;
        return undefined;
      case 'sqrt':
        return a < 0 ? `${show(a)} is below 0` : undefined;
      case 'inverseSqrt':
      case 'log':
      case 'log2':
        return a <= 0 ? `${show(a)} is not above 0` : undefined;
      case 'acos':
      case 'asin':
        return Math.abs(a) > 1 ? `${show(a)} is outside [-1, 1]` : undefined;
      case 'acosh':
        return a < 1 ? `${show(a)} is below 1` : undefined;
      case 'atanh':
        return Math.abs(a) >= 1 ? `${show(a)} is outside (-1, 1)` : undefined;
      case 'smoothstep':
        return a === b ? `the low and the high edge are both ${show(a)}` : undefined;
      default:
        return undefined;
    }
  };
  if (fn === 'normalize') {
    const zero = (c: number[] | undefined): boolean => c!.every((v) => v === 0);
    return zero(exact[0]) && zero(steps[0])
      ? { index: -1, values: exact[0]!, why: 'the vector is zero, which has no direction' }
      : undefined;
  }
  for (let i = 0; i < width; i++) {
    const reason = why(at(exact, i));
    if (reason !== undefined && why(at(steps, i)) !== undefined) {
      return { index: width > 1 ? i : -1, values: at(exact, i), why: reason };
    }
  }
  return undefined;
}

function show(v: number): string {
  return String(Number(v.toPrecision(6)));
}

const MAX_F32 = 3.4028234663852886e38;

export function constF32OutOfRange(e: Expr, scope: LoweringScope): number | undefined {
  if (!isF32Valued(e.type)) return undefined;
  const exact = foldConstComponents(e, scope, undefined, undefined, undefined, true);
  const past = (v: number): boolean => Number.isFinite(v) && Math.abs(v) > MAX_F32;
  if (exact === undefined || !exact.some(past)) return undefined;
  const steps = foldConstComponents(e, scope, undefined, undefined, Math.fround, true);
  if (steps === undefined || steps.length !== exact.length) return undefined;
  return exact.find((v, i) => past(v) && !Number.isFinite(steps[i]!));
}

export function crossedClampBounds(
  low: Expr,
  high: Expr,
  scope: LoweringScope,
): { readonly index: number; readonly low: number; readonly high: number } | undefined {
  const lo = foldConstComponents(low, scope);
  const hi = foldConstComponents(high, scope);
  if (lo === undefined || hi === undefined || lo.length !== hi.length) return undefined;
  const int = intElemOf(low.type);
  if (int !== undefined) {
    if (![...lo, ...hi].every((v) => Number.isInteger(v))) return undefined;
    const index = lo.findIndex((v, i) => wrapInt(v, int) > wrapInt(hi[i]!, int));
    return index < 0
      ? undefined
      : { index, low: wrapInt(lo[index]!, int), high: wrapInt(hi[index]!, int) };
  }
  if (!isF32Valued(low.type)) return undefined;
  const loSteps = foldConstComponents(low, scope, undefined, undefined, Math.fround);
  const hiSteps = foldConstComponents(high, scope, undefined, undefined, Math.fround);
  if (loSteps === undefined || hiSteps === undefined) return undefined;
  const index = lo.findIndex(
    (v, i) => Math.fround(v) > Math.fround(hi[i]!) && loSteps[i]! > hiSteps[i]!,
  );
  return index < 0 ? undefined : { index, low: lo[index]!, high: hi[index]! };
}
