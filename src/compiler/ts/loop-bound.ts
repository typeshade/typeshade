// Counted for/while: constant exit, integer induction, finite trips.

import type { CmpOp, Expr, Stmt } from '../../core/ir/nodes.js'
import { typeKey } from '../../core/ir/types.js'
import type { LoweringScope } from './context.js'
import { TS_CODES, type TsCode } from './codes.js'

export const MAX_LOOP_TRIPS = 256

export function foldConstNumber(expr: Expr, scope: LoweringScope): number | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'number') return expr.value
  if (expr.op === 'unop') {
    const x = foldConstNumber(expr.a, scope)
    return x === undefined ? undefined : -x
  }
  if (expr.op === 'constref') {
    const b = scope.resolve(expr.name)
    if (b && typeof b.constValue === 'number') return b.constValue
    return undefined
  }
  if (expr.op === 'varref') {
    const b = scope.resolve(expr.name)
    if (b && !b.mutable && typeof b.constValue === 'number') return b.constValue
    return undefined
  }
  if (expr.op === 'binop') {
    const a = foldConstNumber(expr.a, scope)
    const b = foldConstNumber(expr.b, scope)
    if (a === undefined || b === undefined) return undefined
    switch (expr.bop) {
      case '+':
        return a + b
      case '-':
        return a - b
      case '*':
        return a * b
      case '/':
        return b === 0 ? undefined : a / b
      case '%':
        return b === 0 ? undefined : a % b
      default:
        return undefined
    }
  }
  if (
    expr.op === 'call' &&
    (expr.fn === 'i32' || expr.fn === 'u32' || expr.fn === 'f32') &&
    expr.args[0]
  ) {
    const x = foldConstNumber(expr.args[0], scope)
    if (x === undefined) return undefined
    return expr.fn === 'f32' ? x : Math.trunc(x)
  }
  return undefined
}

export function foldConstBool(expr: Expr, scope: LoweringScope): boolean | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'boolean') return expr.value
  if (expr.op === 'varref') {
    const b = scope.resolve(expr.name)
    if (b && !b.mutable && typeof b.constValue === 'boolean') return b.constValue
  }
  return undefined
}

export function foldConstValue(expr: Expr, scope: LoweringScope): number | boolean | undefined {
  const n = foldConstNumber(expr, scope)
  if (n !== undefined) return n
  return foldConstBool(expr, scope)
}

function cmpHolds(cop: CmpOp, v: number, bound: number): boolean {
  switch (cop) {
    case '<':
      return v < bound
    case '>':
      return v > bound
    case '<=':
      return v <= bound
    case '>=':
      return v >= bound
    case '==':
      return v === bound
    case '!=':
      return v !== bound
  }
}

function flipCmp(cop: CmpOp): CmpOp {
  if (cop === '<') return '>'
  if (cop === '>') return '<'
  if (cop === '<=') return '>='
  if (cop === '>=') return '<='
  return cop
}

const isInduct = (e: Expr, name: string): boolean =>
  (e.op === 'varref' || e.op === 'param') && e.name === name

function readCond(
  cond: Expr,
  name: string,
  scope: LoweringScope,
): { cop: CmpOp; bound: number } | undefined {
  if (cond.op !== 'compare') return undefined
  if (isInduct(cond.a, name)) {
    const bound = foldConstNumber(cond.b, scope)
    return bound === undefined ? undefined : { cop: cond.cop, bound }
  }
  if (isInduct(cond.b, name)) {
    const bound = foldConstNumber(cond.a, scope)
    return bound === undefined ? undefined : { cop: flipCmp(cond.cop), bound }
  }
  return undefined
}

/** How a counted loop advances its induction variable: by ADDING a constant (`i++`,
 *  `i += 2`, `i -= 1`) or by MULTIPLYING or DIVIDING by one (`i *= 2`, `i /= 2`).
 *
 *  A multiplicative step is a real counted loop — a 64-wide halving reaches its bound in six
 *  iterations — and the only reason it was refused is that nothing here read it (#8 A15). */
type Step =
  | { readonly op: 'add'; readonly by: number }
  | { readonly op: 'mul'; readonly by: number }
  | { readonly op: 'div'; readonly by: number }

function readStep(update: Stmt, name: string, scope: LoweringScope): Step | undefined {
  if (update.s === 'assignOp') {
    if (!isInduct(update.target, name)) return undefined
    const c = foldConstNumber(update.expr, scope)
    if (c === undefined) return undefined
    if (update.bop === '+') return { op: 'add', by: c }
    if (update.bop === '-') return { op: 'add', by: -c }
    if (update.bop === '*') return { op: 'mul', by: c }
    if (update.bop === '/') return { op: 'div', by: c }
    return undefined
  }
  if (update.s === 'assign' && isInduct(update.target, name) && update.expr.op === 'binop') {
    const e = update.expr
    if (e.bop === '+') {
      const c = isInduct(e.a, name)
        ? foldConstNumber(e.b, scope)
        : isInduct(e.b, name)
          ? foldConstNumber(e.a, scope)
          : undefined
      return c === undefined ? undefined : { op: 'add', by: c }
    }
    if (e.bop === '-' && isInduct(e.a, name)) {
      const c = foldConstNumber(e.b, scope)
      return c === undefined ? undefined : { op: 'add', by: -c }
    }
    if (e.bop === '*') {
      const c = isInduct(e.a, name)
        ? foldConstNumber(e.b, scope)
        : isInduct(e.b, name)
          ? foldConstNumber(e.a, scope)
          : undefined
      return c === undefined ? undefined : { op: 'mul', by: c }
    }
    if (e.bop === '/' && isInduct(e.a, name)) {
      const c = foldConstNumber(e.b, scope)
      return c === undefined ? undefined : { op: 'div', by: c }
    }
  }
  return undefined
}

/** How the step reads back in a diagnostic, in the source's own spelling. */
function stepText(name: string, step: Step): string {
  if (step.op === 'add') return step.by < 0 ? `${name} -= ${-step.by}` : `${name} += ${step.by}`
  return `${name} ${step.op === 'mul' ? '*' : '/'}= ${step.by}`
}

export interface CountedLoop {
  readonly name: string
  readonly start: number
  readonly bound: number
  /** The additive step, or the factor for a multiplicative one; see {@link CountedLoop.stepOp}. */
  readonly step: number
  readonly stepOp: 'add' | 'mul' | 'div'
  readonly trips: number
}

export function analyzeCountedFor(
  init: Stmt,
  cond: Expr,
  update: Stmt,
  scope: LoweringScope,
): { ok: true; loop: CountedLoop } | { ok: false; message: string; code: TsCode } {
  if (init.s !== 'var' || !init.init) {
    return {
      ok: false,
      message: 'for-init must be `let i: i32 = <const>` (or u32).',
      code: TS_CODES.LOOP_INDUCTION,
    }
  }
  const k = typeKey(init.type)
  if (k !== 'i32' && k !== 'u32') {
    return {
      ok: false,
      message: `for induction must be i32 or u32, got ${k}.`,
      code: TS_CODES.LOOP_INDUCTION,
    }
  }
  const start = foldConstNumber(init.init, scope)
  if (start === undefined) {
    return {
      ok: false,
      message: `for-init "${init.name}" must start at a compile-time constant.`,
      code: TS_CODES.LOOP_BOUND,
    }
  }
  const condInfo = readCond(cond, init.name, scope)
  if (!condInfo) {
    return {
      ok: false,
      message: `for exit must compare "${init.name}" to a constant bound (e.g. ${init.name} < 16).`,
      code: TS_CODES.LOOP_BOUND,
    }
  }
  const step = readStep(update, init.name, scope)
  if (step === undefined) {
    return {
      ok: false,
      message: `for-update must be ${init.name}++ / ${init.name} += <const>, or ${init.name} *= / /= <const>.`,
      code: TS_CODES.LOOP_INDUCTION,
    }
  }
  const stall = stalls(step)
  if (stall) {
    return {
      ok: false,
      message: `for step "${stepText(init.name, step)}" never advances "${init.name}" — ${stall}`,
      code: TS_CODES.LOOP_INFINITE,
    }
  }
  const trips = countTrips(start, condInfo.cop, condInfo.bound, step, k)
  if (trips === undefined) {
    return {
      ok: false,
      message: `for (${init.name} = ${start}; ${init.name} ${condInfo.cop} ${condInfo.bound}; ${stepText(init.name, step)}) does not exit.`,
      code: TS_CODES.LOOP_INFINITE,
    }
  }
  if (trips > MAX_LOOP_TRIPS) {
    return {
      ok: false,
      message: `for trip count ${trips} exceeds ${MAX_LOOP_TRIPS}.`,
      code: TS_CODES.LOOP_BOUND,
    }
  }
  return {
    ok: true,
    loop: { name: init.name, start, bound: condInfo.bound, step: step.by, stepOp: step.op, trips },
  }
}

/** Why a step cannot move the induction variable, or undefined when it can. Each of these was
 *  one message — "step of i is 0" — which only ever fitted the first. */
function stalls(step: Step): string | undefined {
  if (step.op === 'add') return step.by === 0 ? 'a step of 0 leaves it where it is.' : undefined
  if (step.by === 1) return 'multiplying or dividing by 1 leaves it where it is.'
  if (step.by === 0) {
    return step.op === 'mul'
      ? 'multiplying by 0 pins it at 0.'
      : 'dividing by 0 is undefined on both targets.'
  }
  return undefined
}

/**
 * How many times the body runs, or undefined when the loop does not exit.
 *
 * An ADDITIVE step is counted arithmetically rather than by walking the sequence, and that is
 * the point of this half of #8 A15: walking it could only look `MAX_LOOP_TRIPS + 2` steps
 * ahead, so `for (let i = 0; i < 1024; i++)` — which exits, at 1024 — was reported as a loop
 * that "does not exit". A policy violation wore the words of a non-terminating loop, and the
 * author was told the wrong thing about their program. Counted exactly, 1024 is 1024 and the
 * message says it exceeds the limit.
 *
 * A MULTIPLICATIVE step is still walked, and that is exact too: multiplying or dividing by a
 * factor of at least 2 reaches any 32-bit bound within 32 iterations, so a walk that has not
 * exited by then is one that runs away — the same answer, reached the same way, in a handful
 * of steps rather than a bounded guess.
 */
function countTrips(
  start: number,
  cop: CmpOp,
  bound: number,
  step: Step,
  kind: string,
): number | undefined {
  const lo = kind === 'u32' ? 0 : -0x80000000
  const hi = kind === 'u32' ? 0xffffffff : 0x7fffffff
  if (start < lo || start > hi) return undefined
  if (!cmpHolds(cop, start, bound)) return 0
  if (step.op === 'add') return addTrips(start, cop, bound, step.by, lo, hi)
  // A division on an integer induction variable truncates, exactly as both targets do.
  const advance = (v: number): number => (step.op === 'mul' ? v * step.by : Math.trunc(v / step.by))
  let v = start
  for (let n = 0; n <= 64; n++) {
    if (v < lo || v > hi) return undefined
    if (!cmpHolds(cop, v, bound)) return n
    const next = advance(v)
    if (next === v) return undefined
    v = next
  }
  return undefined
}

/** The trip count of an additive loop, in closed form. `lo`/`hi` are the induction type's
 *  range: a loop that would have to leave it before the condition fails does not exit. */
function addTrips(
  start: number,
  cop: CmpOp,
  bound: number,
  step: number,
  lo: number,
  hi: number,
): number | undefined {
  // `==` and `!=` are about hitting one value, not about crossing a threshold.
  if (cop === '==') return start === bound ? (bound + step === bound ? undefined : 1) : 0
  if (cop === '!=') {
    const gap = bound - start
    if (gap === 0) return 0
    if (step === 0 || gap % step !== 0 || gap / step < 0) return undefined
    return gap / step
  }
  // The remaining four are `<`, `<=`, `>`, `>=`. Normalise to "how far is the last value that
  // still satisfies the condition", then divide by the step.
  const inclusive = cop === '<=' || cop === '>='
  const goingUp = cop === '<' || cop === '<='
  if (step === 0) return undefined
  if (goingUp !== step > 0) return undefined // stepping away from the bound
  const last = goingUp ? (inclusive ? bound : bound - 1) : inclusive ? bound : bound + 1
  const span = goingUp ? last - start : start - last
  if (span < 0) return 0
  const trips = Math.floor(span / Math.abs(step)) + 1
  // The value AFTER the final iteration has to be representable, since the loop computes it
  // before the condition rejects it.
  const end = start + trips * step
  if (end < lo || end > hi) return undefined
  return trips
}

export function loopConditionError(
  cond: Expr,
  scope: LoweringScope,
): { message: string; code: TsCode } | undefined {
  const b = foldConstBool(cond, scope)
  if (b === false) return undefined
  if (b === true) {
    return {
      message:
        'Infinite loop: condition is constantly true. Use a constant exit bound (e.g. i < 16).',
      code: TS_CODES.LOOP_INFINITE,
    }
  }
  if (cond.op === 'compare') {
    if (
      foldConstNumber(cond.a, scope) !== undefined ||
      foldConstNumber(cond.b, scope) !== undefined
    )
      return undefined
    return {
      message: 'while/for exit bound must be a compile-time constant. `i < n` is not allowed.',
      code: TS_CODES.LOOP_BOUND,
    }
  }
  return {
    message: 'Loop condition must compare against a compile-time constant bound (e.g. i < 16).',
    code: TS_CODES.LOOP_BOUND,
  }
}
