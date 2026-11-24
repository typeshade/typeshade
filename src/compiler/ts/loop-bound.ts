// Implements: Rule 7.5
// Implements: Rule 7.4 (docs/language-design.md; traced in reqs/).

import { logicalTypeKey as typeKey } from './optional.js';
import type { CmpOp, Expr, Stmt } from '../../core/ir/nodes.js';
import { type ShaderType } from '../../core/ir/types.js';
import { eachExpr } from '../../core/ir/visit.js';
import { eachOperand } from '../../core/passes/access.js';
import { authorTypeText, type LoweringScope } from './context.js';
import { TS_CODES, type TsCode } from './codes.js';
import { shiftAmountOutOfRange } from './lit-coerce.js';
import { collectMutatedRoots, intElemOf, wrapInt } from '../../core/passes/opt/expr-utils.js';
import { foldConstNumber, foldConstBool } from './loop-bound/fold-const.js';
export { foldConstNumber, foldConstBool, foldConstValue } from './loop-bound/fold-const.js';

function cmpHolds(cop: CmpOp, v: number, bound: number): boolean {
  switch (cop) {
    case '<':
      return v < bound;
    case '>':
      return v > bound;
    case '<=':
      return v <= bound;
    case '>=':
      return v >= bound;
    case '==':
      return v === bound;
    case '!=':
      return v !== bound;
  }
}

function flipCmp(cop: CmpOp): CmpOp {
  if (cop === '<') return '>';
  if (cop === '>') return '<';
  if (cop === '<=') return '>=';
  if (cop === '>=') return '<=';
  return cop;
}

const isInduct = (e: Expr, name: string): boolean =>
  (e.op === 'varref' || e.op === 'param') && e.name === name;

interface ExitCompare {
  readonly cop: CmpOp;
  readonly bound: Expr;
  readonly value: number | undefined;
}

function readCond(cond: Expr, name: string, scope: LoweringScope): ExitCompare | undefined {
  if (cond.op !== 'compare') return undefined;
  if (isInduct(cond.a, name) && !mentions(cond.b, name)) {
    return { cop: cond.cop, bound: cond.b, value: foldConstNumber(cond.b, scope) };
  }
  if (isInduct(cond.b, name) && !mentions(cond.a, name)) {
    return { cop: flipCmp(cond.cop), bound: cond.a, value: foldConstNumber(cond.a, scope) };
  }
  return undefined;
}

function mentions(e: Expr, name: string): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if ((x.op === 'varref' || x.op === 'param') && x.name === name) hit = true;
  });
  return hit;
}

type Step =
  | { readonly op: 'add'; readonly by: number }
  | { readonly op: 'mul'; readonly by: number }
  | { readonly op: 'div'; readonly by: number };

function readStep(update: Stmt, name: string, scope: LoweringScope): Step | undefined {
  if (update.s === 'assignOp') {
    if (!isInduct(update.target, name)) return undefined;
    const c = foldConstNumber(update.expr, scope);
    if (c === undefined) return undefined;
    if (update.bop === '+') return { op: 'add', by: c };
    if (update.bop === '-') return { op: 'add', by: -c };
    if (update.bop === '*') return { op: 'mul', by: c };
    if (update.bop === '/') return { op: 'div', by: c };
    return undefined;
  }
  if (update.s === 'assign' && isInduct(update.target, name) && update.expr.op === 'binop') {
    const e = update.expr;
    if (e.bop === '+') {
      const c = isInduct(e.a, name)
        ? foldConstNumber(e.b, scope)
        : isInduct(e.b, name)
          ? foldConstNumber(e.a, scope)
          : undefined;
      return c === undefined ? undefined : { op: 'add', by: c };
    }
    if (e.bop === '-' && isInduct(e.a, name)) {
      const c = foldConstNumber(e.b, scope);
      return c === undefined ? undefined : { op: 'add', by: -c };
    }
  }
  return undefined;
}

function stepText(name: string, step: Step): string {
  if (step.op === 'add') return step.by < 0 ? `${name} -= ${-step.by}` : `${name} += ${step.by}`;
  return `${name} ${step.op === 'mul' ? '*' : '/'}= ${step.by}`;
}

export function forUpdateRefusal(shown: string): string {
  return `for-update must be ${shown}++ / ${shown} += <const>, or ${shown} *= / /= <const>.`;
}

export interface CountedLoop {
  readonly name: string;
  readonly op: 'add' | 'mul' | 'div';
  readonly start?: number;
  readonly bound?: number;
  readonly step: number;
  readonly trips?: number;
}

type Refusal = { ok: false; message: string; code: TsCode; endless: boolean };

export function analyzeCountedFor(
  init: Stmt,
  cond: Expr,
  update: Stmt,
  scope: LoweringScope,
): { ok: true; loop: CountedLoop } | Refusal {
  if (init.s !== 'var' || !init.init) {
    return {
      ok: false,
      message: 'for-init must be `let i: i32 = <start>` or `let i: u32 = <start>`.',
      code: TS_CODES.LOOP_INDUCTION,
      endless: false,
    };
  }
  const k = typeKey(init.type);
  if (k !== 'i32' && k !== 'u32') {
    return {
      ok: false,
      message: `for induction must be i32 or u32, got ${authorTypeText(init.type)}.`,
      code: TS_CODES.LOOP_INDUCTION,
      endless: false,
    };
  }
  const shown = scope.resolveIr(init.name)?.name ?? init.name;
  const start = foldConstNumber(init.init, scope);
  const exit = readCond(cond, init.name, scope);
  if (!exit) {
    return {
      ok: false,
      message:
        `for exit must compare "${shown}" to a bound (e.g. ${shown} < 16, or ${shown} < n). ` +
        `A loop that ends some other way is an open loop.`,
      code: TS_CODES.LOOP_BOUND,
      endless: false,
    };
  }
  const step = readStep(update, init.name, scope);
  if (step === undefined) {
    return {
      ok: false,
      message: forUpdateRefusal(shown),
      code: TS_CODES.LOOP_INDUCTION,
      endless: false,
    };
  }
  const stall = stalls(step);
  if (stall) {
    return {
      ok: false,
      message: `for step "${stepText(shown, step)}" never advances "${shown}": ${stall}`,
      code: TS_CODES.LOOP_INFINITE,
      endless: start !== undefined && exit.value !== undefined,
    };
  }
  if (start === undefined || exit.value === undefined) {
    const refused = runtimeHeader(shown, start, exit.cop, step);
    return refused ?? { ok: true, loop: { name: init.name, op: step.op, start, step: step.by } };
  }
  const bound = exit.value;
  const trips = countTrips(start, exit.cop, bound, step, k);
  if (!trips.ok) {
    const header = `for (${shown} = ${start}; ${shown} ${exit.cop} ${bound}; ${stepText(shown, step)})`;
    return trips.why === 'range'
      ? {
          ok: false,
          message: `${header} walks "${shown}" outside the range of ${k} before the condition fails.`,
          code: TS_CODES.LOOP_BOUND,
          endless: true,
        }
      : {
          ok: false,
          message: `${header} does not exit.`,
          code: TS_CODES.LOOP_INFINITE,
          endless: true,
        };
  }
  return {
    ok: true,
    loop: { name: init.name, op: step.op, start, bound, step: step.by, trips: trips.n },
  };
}

export function boundWrittenIn(
  cond: Expr,
  name: string,
  scope: LoweringScope,
  body: readonly Stmt[],
): string | undefined {
  const exit = readCond(cond, name, scope);
  if (!exit || exit.value !== undefined) return undefined;
  const written = new Set<string>();
  collectMutatedRoots(body, written);
  let hit: string | undefined;
  eachBoundRead(exit.bound, (x) => {
    if (hit !== undefined) return;
    if ((x.op === 'varref' || x.op === 'param' || x.op === 'externref') && written.has(x.name)) {
      hit = scope.resolveIr(x.name)?.name ?? x.name;
    }
  });
  return hit;
}

function eachBoundRead(e: Expr, visit: (e: Expr) => void): void {
  visit(e);
  eachOperand(e, (c, access) => {
    if (access !== 'length') eachBoundRead(c, visit);
  });
}

function runtimeHeader(
  shown: string,
  start: number | undefined,
  cop: CmpOp,
  step: Step,
): Refusal | undefined {
  const text = stepText(shown, step);
  if (cop === '==' || cop === '!=') {
    return {
      ok: false,
      message:
        `for exit "${shown} ${cop} <bound>" with a runtime bound exits only if "${text}" lands ` +
        `on it exactly. Compare with <, <=, > or >=.`,
      code: TS_CODES.LOOP_BOUND,
      endless: false,
    };
  }
  const goingUp = cop === '<' || cop === '<=';
  if (step.op === 'add') {
    if (goingUp !== step.by > 0) {
      return {
        ok: false,
        message: `for step "${text}" moves "${shown}" away from a bound it compares with ${cop}, so the loop does not exit once it starts.`,
        code: TS_CODES.LOOP_INFINITE,
        endless: false,
      };
    }
    return undefined;
  }
  if (!Number.isInteger(step.by) || step.by < 2) {
    return {
      ok: false,
      message: `for step "${text}" with a runtime start or bound needs a whole factor of 2 or more, so its direction is known.`,
      code: TS_CODES.LOOP_BOUND,
      endless: false,
    };
  }
  if (goingUp !== (step.op === 'mul')) {
    return {
      ok: false,
      message: `for step "${text}" moves "${shown}" away from a bound it compares with ${cop}, so the loop does not exit once it starts.`,
      code: TS_CODES.LOOP_INFINITE,
      endless: false,
    };
  }
  if (step.op === 'mul' && start !== undefined && start <= 0) {
    return {
      ok: false,
      message:
        start === 0
          ? `for step "${text}" never advances "${shown}": multiplying pins it at 0.`
          : `for step "${text}" from ${start} moves "${shown}" away from a bound it compares with ${cop}.`,
      code: TS_CODES.LOOP_INFINITE,
      endless: false,
    };
  }
  return undefined;
}

function stalls(step: Step): string | undefined {
  if (step.op === 'add') return step.by === 0 ? 'a step of 0 leaves it where it is.' : undefined;
  if (step.by === 1) return 'multiplying or dividing by 1 leaves it where it is.';
  if (step.by === 0) {
    return step.op === 'mul' ? 'multiplying by 0 pins it at 0.' : 'dividing by 0 cannot move it.';
  }
  return undefined;
}

type Trips =
  | { readonly ok: true; readonly n: number }
  | { readonly ok: false; readonly why: 'noexit' | 'range' };

const NO_EXIT: Trips = { ok: false, why: 'noexit' };
const OUT_OF_RANGE: Trips = { ok: false, why: 'range' };

function countTrips(start: number, cop: CmpOp, bound: number, step: Step, kind: string): Trips {
  const lo = kind === 'u32' ? 0 : -0x80000000;
  const hi = kind === 'u32' ? 0xffffffff : 0x7fffffff;
  if (start < lo || start > hi) return OUT_OF_RANGE;
  if (!cmpHolds(cop, start, bound)) return { ok: true, n: 0 };
  if (step.op === 'add') return addTrips(start, cop, bound, step.by, lo, hi);
  const advance = (v: number): number =>
    step.op === 'mul' ? v * step.by : Math.trunc(v / step.by);
  let v = start;
  for (let n = 0; n <= 64; n++) {
    if (v < lo || v > hi) return OUT_OF_RANGE;
    if (!cmpHolds(cop, v, bound)) return { ok: true, n };
    const next = advance(v);
    if (next === v) return NO_EXIT;
    v = next;
  }
  return NO_EXIT;
}

function addTrips(
  start: number,
  cop: CmpOp,
  bound: number,
  step: number,
  lo: number,
  hi: number,
): Trips {
  if (cop === '==') {
    if (start !== bound) return { ok: true, n: 0 };
    return bound + step === bound ? NO_EXIT : { ok: true, n: 1 };
  }
  if (cop === '!=') {
    const gap = bound - start;
    if (gap === 0) return { ok: true, n: 0 };
    if (step === 0 || gap % step !== 0 || gap / step < 0) return NO_EXIT;
    return { ok: true, n: gap / step };
  }
  const inclusive = cop === '<=' || cop === '>=';
  const goingUp = cop === '<' || cop === '<=';
  if (step === 0) return NO_EXIT;
  if (goingUp !== step > 0) return NO_EXIT;
  const last = goingUp ? (inclusive ? bound : bound - 1) : inclusive ? bound : bound + 1;
  const span = goingUp ? last - start : start - last;
  if (span < 0) return { ok: true, n: 0 };
  const trips = Math.floor(span / Math.abs(step)) + 1;
  const end = start + trips * step;
  if (end < lo || end > hi) return OUT_OF_RANGE;
  return { ok: true, n: trips };
}

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

/* Why: Tint checks the domain or range of these builtins when every argument is constant (#613,
 *  measured on Tint in Chromium 141.0.7390.37): `exp(89.0)`, `exp2(128.0)`, `sinh(90.0)`,
 *  `cosh(90.0)`, `degrees(1e37)`, `ldexp(1.0, 128)`, `fma(1e30, 1e30, 0.0)` and `pow(10.0, 40.0)`
 *  "cannot be represented as 'f32'". */
const CONST_CALLS: Readonly<Record<string, (...xs: number[]) => number>> = {
  pow: (a, b) => Math.pow(a!, b!),
  sqrt: (x) => Math.sqrt(x!),
  inverseSqrt: (x) => 1 / Math.sqrt(x!),
  log: (x) => (x! > 0 ? Math.log(x!) : Number.NaN),
  log2: (x) => (x! > 0 ? Math.log2(x!) : Number.NaN),
  exp: (x) => Math.exp(x!),
  exp2: (x) => Math.pow(2, x!),
  sinh: (x) => Math.sinh(x!),
  cosh: (x) => Math.cosh(x!),
  degrees: (x) => (x! * 180) / Math.PI,
  ldexp: (x, e) => x! * Math.pow(2, e!),
  fma: (a, b, c) => a! * b! + c!,
};

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

const isF32Valued = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');

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

export function foldConstComponents(
  e: Expr,
  scope: LoweringScope,
  valueExprs?: ReadonlyMap<string, Expr>,
  seen: ReadonlySet<string> = new Set(),
  round: (v: number) => number = (v) => v,
  calls = false,
): number[] | undefined {
  const fold = (x: Expr, s: ReadonlySet<string> = seen): number[] | undefined =>
    foldConstComponents(x, scope, valueExprs, s, round, calls);
  switch (e.op) {
    case 'lit':
      return typeof e.value === 'number' ? [round(e.value)] : undefined;
    case 'unop': {
      const a = fold(e.a);
      return a === undefined ? undefined : a.map((v) => -v);
    }
    case 'construct': {
      if (e.type.kind !== 'vec') return undefined;
      const parts: number[] = [];
      for (const a of e.args) {
        const c = fold(a);
        if (c === undefined) return undefined;
        parts.push(...c);
      }
      if (parts.length === 1 && e.type.n > 1)
        return Array.from({ length: e.type.n }, () => parts[0]!);
      return parts.length === e.type.n ? parts : undefined;
    }
    case 'constref': {
      if (seen.has(e.name)) return undefined;
      const value = valueExprs?.get(e.name) ?? scope.resolveIr(e.name)?.valueExpr;
      if (value !== undefined) return fold(value, new Set([...seen, e.name]));
      const n = foldConstNumber(e, scope);
      return n === undefined ? undefined : [round(n)];
    }
    case 'varref': {
      const n = foldConstNumber(e, scope);
      return n === undefined ? undefined : [round(n)];
    }
    case 'binop': {
      const a = fold(e.a);
      const b = fold(e.b);
      if (a === undefined || b === undefined) return undefined;
      if (a.length !== 1 && b.length !== 1 && a.length !== b.length) return undefined;
      const n = Math.max(a.length, b.length);
      const at = (xs: number[], i: number): number => xs[xs.length === 1 ? 0 : i]!;
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = at(a, i);
        const y = at(b, i);
        switch (e.bop) {
          case '+':
            out.push(round(x + y));
            break;
          case '-':
            out.push(round(x - y));
            break;
          case '*':
            out.push(round(x * y));
            break;
          case '/':
            if (y === 0) return undefined;
            out.push(round(x / y));
            break;
          default:
            return undefined;
        }
      }
      return out;
    }
    case 'call': {
      const at = CONST_CALLS[e.fn];
      if (!calls || at === undefined || e.declRef !== undefined || !isF32Valued(e.type))
        return undefined;
      const args: number[][] = [];
      for (const a of e.args) {
        const c = fold(a);
        if (c === undefined) return undefined;
        args.push(c);
      }
      const n = Math.max(...args.map((c) => c.length));
      if (args.some((c) => c.length !== 1 && c.length !== n)) return undefined;
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = round(at(...args.map((c) => c[c.length === 1 ? 0 : i]!)));
        if (Number.isNaN(v)) return undefined;
        out.push(v);
      }
      return out;
    }
    default:
      return undefined;
  }
}
