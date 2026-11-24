import { logicalTypeKey as typeKey } from '../optional.js';
import type { CmpOp, Expr, Stmt } from '../../../core/ir/nodes.js';
import { eachOperand } from '../../../core/passes/access.js';
import { authorTypeText, type LoweringScope } from '../context.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { collectMutatedRoots } from '../../../core/passes/opt/expr-utils.js';
import { foldConstNumber } from './fold-const.js';
import { readCond } from './exit-compare.js';
import { readStep, stepText, forUpdateRefusal, stalls, type Step } from './step.js';

export function cmpHolds(cop: CmpOp, v: number, bound: number): boolean {
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
