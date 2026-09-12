// Counted for/while: constant exit, integer induction, finite trips.

import type { CmpOp, Expr, Stmt } from '../../core/ir/nodes.js'
import { typeKey } from '../../core/ir/types.js'
import type { LoweringScope } from './context.js'

export const MAX_LOOP_TRIPS = 256

export function foldConstNumber(expr: Expr, scope: LoweringScope): number | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'number') return expr.value
  if (expr.op === 'unop') {
    const x = foldConstNumber(expr.a, scope)
    return x === undefined ? undefined : -x
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
  if (expr.op === 'call' && (expr.fn === 'i32' || expr.fn === 'u32' || expr.fn === 'f32') && expr.args[0]) {
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

function readCond(cond: Expr, name: string, scope: LoweringScope): { cop: CmpOp; bound: number } | undefined {
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

function readStep(update: Stmt, name: string, scope: LoweringScope): number | undefined {
  if (update.s === 'assignOp') {
    if (!isInduct(update.target, name)) return undefined
    const c = foldConstNumber(update.expr, scope)
    if (c === undefined) return undefined
    if (update.bop === '+') return c
    if (update.bop === '-') return -c
    return undefined
  }
  if (update.s === 'assign' && isInduct(update.target, name) && update.expr.op === 'binop') {
    const e = update.expr
    if (e.bop === '+') {
      if (isInduct(e.a, name)) return foldConstNumber(e.b, scope)
      if (isInduct(e.b, name)) return foldConstNumber(e.a, scope)
    }
    if (e.bop === '-' && isInduct(e.a, name)) {
      const c = foldConstNumber(e.b, scope)
      return c === undefined ? undefined : -c
    }
  }
  return undefined
}

export interface CountedLoop {
  readonly name: string
  readonly start: number
  readonly bound: number
  readonly step: number
  readonly trips: number
}

export function analyzeCountedFor(
  init: Stmt,
  cond: Expr,
  update: Stmt,
  scope: LoweringScope,
): { ok: true; loop: CountedLoop } | { ok: false; message: string } {
  if (init.s !== 'var' || !init.init) {
    return { ok: false, message: 'for-init must be `let i: i32 = <const>` (or u32).' }
  }
  const k = typeKey(init.type)
  if (k !== 'i32' && k !== 'u32') {
    return { ok: false, message: `for induction must be i32 or u32, got ${k}.` }
  }
  const start = foldConstNumber(init.init, scope)
  if (start === undefined) {
    return { ok: false, message: `for-init "${init.name}" must start at a compile-time constant.` }
  }
  const condInfo = readCond(cond, init.name, scope)
  if (!condInfo) {
    return {
      ok: false,
      message: `for exit must compare "${init.name}" to a constant bound (e.g. ${init.name} < 16).`,
    }
  }
  const step = readStep(update, init.name, scope)
  if (step === undefined) {
    return { ok: false, message: `for-update must be ${init.name}++ / ${init.name} += <const>.` }
  }
  if (step === 0) {
    return { ok: false, message: `for step of "${init.name}" is 0 — the loop never advances.` }
  }
  const trips = countTrips(start, condInfo.cop, condInfo.bound, step, k)
  if (trips === undefined) {
    return {
      ok: false,
      message: `for (${init.name} = ${start}; ${init.name} ${condInfo.cop} ${condInfo.bound}; step ${step}) does not exit.`,
    }
  }
  if (trips > MAX_LOOP_TRIPS) {
    return { ok: false, message: `for trip count ${trips} exceeds ${MAX_LOOP_TRIPS}.` }
  }
  return { ok: true, loop: { name: init.name, start, bound: condInfo.bound, step, trips } }
}

function countTrips(start: number, cop: CmpOp, bound: number, step: number, kind: string): number | undefined {
  const lo = kind === 'u32' ? 0 : -0x80000000
  const hi = kind === 'u32' ? 0xffffffff : 0x7fffffff
  const seq: number[] = []
  let v = start
  for (let g = 0; g < MAX_LOOP_TRIPS + 2; g++) {
    if (v < lo || v > hi) return undefined
    if (!cmpHolds(cop, v, bound)) return seq.length
    seq.push(v)
    v += step
  }
  return undefined
}

export function loopConditionError(cond: Expr, scope: LoweringScope): string | undefined {
  const b = foldConstBool(cond, scope)
  if (b === false) return undefined
  if (b === true) {
    return 'Infinite loop: condition is constantly true. Use a constant exit bound (e.g. i < 16).'
  }
  if (cond.op === 'compare') {
    if (foldConstNumber(cond.a, scope) !== undefined || foldConstNumber(cond.b, scope) !== undefined) return undefined
    return 'while/for exit bound must be a compile-time constant. `i < n` is not allowed.'
  }
  return 'Loop condition must compare against a compile-time constant bound (e.g. i < 16).'
}
