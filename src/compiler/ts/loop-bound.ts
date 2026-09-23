// Counted `for`, open `while` (Rule 7.5): an integer induction variable, a constant step, a
// bound the body does not move; exact trip counts when the whole header is constant.
//
// Implements: Rule 7.4 (docs/language-design.md; traced in reqs/).

import type { CmpOp, Expr, Stmt } from '../../core/ir/nodes.js';
import { typeKey } from '../../core/ir/types.js';
import { eachExpr, mapChildren } from '../../core/ir/visit.js';
import type { LoweringScope } from './context.js';
import { TS_CODES, type TsCode } from './codes.js';
import { BUILTINS } from '../../core/cpu-runtime.js';
import { isConstEvaluableMathFn } from './math-alias.js';
import {
  collectMutatedRoots,
  foldIntLit,
  intElemOf,
  wrapInt,
} from '../../core/passes/opt/expr-utils.js';

export function foldConstNumber(expr: Expr, scope: LoweringScope): number | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'number') return expr.value;
  if (expr.op === 'unop') {
    const x = foldConstNumber(expr.a, scope);
    if (x === undefined) return undefined;
    // Wrapped when the type is an integer, for the reason the binop arm below carries.
    const int = intElemOf(expr.type);
    return int === undefined ? -x : wrapInt(-x, int);
  }
  // `resolveIr`, not `resolve`: the node already carries the IR name, which for a local that
  // shadows or follows another of the same source name is `p_1`, a name `resolve` does not
  // know, or worse knows as some other declaration (#38).
  if (expr.op === 'constref') {
    const b = scope.resolveIr(expr.name);
    if (b && typeof b.constValue === 'number') return b.constValue;
    return undefined;
  }
  // A `param` too: a local function's parameter for a `const` it captures carries the
  // constant (Rule 8.17); a declared parameter is never one.
  if (expr.op === 'varref' || expr.op === 'param') {
    const b = scope.resolveIr(expr.name);
    if (b && !b.mutable && typeof b.constValue === 'number') return b.constValue;
    return undefined;
  }
  if (expr.op === 'binop') {
    const a = foldConstNumber(expr.a, scope);
    const b = foldConstNumber(expr.b, scope);
    if (a === undefined || b === undefined) return undefined;
    // An INTEGER-typed operation is folded the way the hardware performs it, through the same
    // helper the const-fold pass uses (#154). Folding it in doubles gave this function a
    // different answer from the one the emitted module carries — `i32 100000 * 100000` is
    // 1410065408 on both targets and 10000000000 here, `u32 0 - 1` is 4294967295 there and -1
    // here, and `i32 1 / 2` is 0 there and 0.5 here. Every caller compares this value against
    // something the GPU will compute (a loop's trip count, a divisor, a conversion's range), so
    // a second set of arithmetic rules was a second set of answers.
    const int = intElemOf(expr.type);
    if (int !== undefined) return foldIntLit(expr.bop, a, b, int);
    switch (expr.bop) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b === 0 ? undefined : a / b;
      case '%':
        return b === 0 ? undefined : a % b;
      // The integer operators, on operands this has already proven are numbers. A bit flag
      // written `1 << 2` is a constant in TypeScript and in WGSL, and it is the shape a
      // numeric enum is most often given (roadmap 0.3 item T1, #92); folding it here is also
      // what lets it bound a loop. Non-integers are left alone: `1.5 << 1` is not arithmetic
      // either language performs.
      case '<<':
      case '>>':
      case '&':
      case '|':
      case '^': {
        if (!Number.isInteger(a) || !Number.isInteger(b)) return undefined;
        if ((expr.bop === '<<' || expr.bop === '>>') && (b < 0 || b > 31)) return undefined;
        switch (expr.bop) {
          case '<<':
            return a << b;
          case '>>':
            return a >> b;
          case '&':
            return a & b;
          case '|':
            return a | b;
          default:
            return a ^ b;
        }
      }
      default:
        return undefined;
    }
  }
  if (
    expr.op === 'call' &&
    (expr.fn === 'i32' || expr.fn === 'u32' || expr.fn === 'f32') &&
    expr.args[0]
  ) {
    const x = foldConstNumber(expr.args[0], scope);
    if (x === undefined) return undefined;
    // The conversion wraps into the target, which is what `foldIntConvert` emits and what both
    // targets compute: `u32(-1i)` is 4294967295, not -1.
    return expr.fn === 'f32' ? x : wrapInt(Math.trunc(x), expr.fn);
  }
  // A math builtin over constant arguments (issue #73). Not a declared function of the same
  // name (`declRef`), whose body this does not run, and only the intrinsics the oracle's
  // BUILTINS table computes, which is the value the CPU backends give the same call.
  if (expr.op === 'call' && expr.declRef === undefined && isConstEvaluableMathFn(expr.fn)) {
    const f = BUILTINS[expr.fn];
    if (!f) return undefined;
    const args: number[] = [];
    for (const a of expr.args) {
      const x = foldConstNumber(a, scope);
      if (x === undefined) return undefined;
      args.push(x);
    }
    const v = f(...args);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

export function foldConstBool(expr: Expr, scope: LoweringScope): boolean | undefined {
  if (expr.op === 'lit' && typeof expr.value === 'boolean') return expr.value;
  if (expr.op === 'varref' || expr.op === 'param') {
    const b = scope.resolveIr(expr.name);
    if (b && !b.mutable && typeof b.constValue === 'boolean') return b.constValue;
  }
  return undefined;
}

export function foldConstValue(expr: Expr, scope: LoweringScope): number | boolean | undefined {
  const n = foldConstNumber(expr, scope);
  if (n !== undefined) return n;
  return foldConstBool(expr, scope);
}

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

/** The exit compare `i <cop> bound`, normalised so the induction variable is on the left.
 *  `bound` is the expression as lowered, and `value` its folded number when it is a
 *  compile-time constant; a bound that is not one is a runtime value (Rule 7.5). */
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

/** Whether `e` reads the IR name `name` anywhere. `i < i * 2` compares the induction variable
 *  to itself, which is not a bound. */
function mentions(e: Expr, name: string): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if ((x.op === 'varref' || x.op === 'param') && x.name === name) hit = true;
  });
  return hit;
}

/** How a counted loop advances its induction variable: by ADDING a constant (`i++`,
 *  `i += 2`, `i -= 1`) or by MULTIPLYING or DIVIDING by one (`i *= 2`, `i /= 2`).
 *
 *  A multiplicative step is a real counted loop — a 64-wide halving reaches its bound in six
 *  iterations — and the only reason it was refused is that nothing here read it (#8 A15). */
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
  // The only `assign` update `lowerUpdate` builds is the `i++` / `i--` pair, which it writes
  // as `i = i + 1` / `i = i - 1`. A source-level `i = i * 2` is refused there as an unsupported
  // for-update and never reaches this function, so there is no `*` or `/` arm here: one would
  // read as support this surface does not have.
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

/** How the step reads back in a diagnostic. Not the source's own spelling: `i++` and `i--`
 *  reach here as `i += 1` and `i -= 1`, because `lowerUpdate` turns both into an add of 1 and
 *  the counter never sees the increment form. One normal form for the four update shapes is
 *  what lets `for step "i += 0" never advances "i"` and `for step "i *= 1" never advances "i"`
 *  be the same sentence. */
function stepText(name: string, step: Step): string {
  if (step.op === 'add') return step.by < 0 ? `${name} -= ${-step.by}` : `${name} += ${step.by}`;
  return `${name} ${step.op === 'mul' ? '*' : '/'}= ${step.by}`;
}

/** What the analysis concluded about an accepted counted loop. Nothing reads it yet: the
 *  caller branches on `ok` and lowers the `for` it already has. So this carries the numbers a
 *  reader would want and no more, and in particular not the step's OPERATION: a field for it
 *  would be one more thing written and never read. `step` is the addend for an additive loop
 *  and the factor for a multiplicative one. `start`, `bound` and `trips` are present when the
 *  header folds to constants, and absent when the start or the bound is a runtime value
 *  (Rule 7.5): such a loop is still counted, by a count known only when it runs. */
export interface CountedLoop {
  readonly name: string;
  readonly start?: number;
  readonly bound?: number;
  readonly step: number;
  readonly trips?: number;
}

type Refusal = { ok: false; message: string; code: TsCode };

export function analyzeCountedFor(
  init: Stmt,
  cond: Expr,
  update: Stmt,
  scope: LoweringScope,
): { ok: true; loop: CountedLoop } | Refusal {
  if (init.s !== 'var' || !init.init) {
    return {
      ok: false,
      message: 'for-init must be `let i: i32 = <start>` (or u32).',
      code: TS_CODES.LOOP_INDUCTION,
    };
  }
  const k = typeKey(init.type);
  if (k !== 'i32' && k !== 'u32') {
    return {
      ok: false,
      message: `for induction must be i32 or u32, got ${k}.`,
      code: TS_CODES.LOOP_INDUCTION,
    };
  }
  // Messages name the counter as the author spelled it; the IR name a second `i` carries is
  // `i_1` (#38), and `readCond`/`readStep` match on that one.
  const shown = scope.resolveIr(init.name)?.name ?? init.name;
  // The start runs once, before the first test, so any value of the counter's type will do:
  // `for (let i = lid.x; i < n; i += 64u)` is the strided loop every compute kernel writes.
  const start = foldConstNumber(init.init, scope);
  const exit = readCond(cond, init.name, scope);
  if (!exit) {
    return {
      ok: false,
      message:
        `for exit must compare "${shown}" to a bound (e.g. ${shown} < 16, or ${shown} < n). ` +
        `A loop that ends some other way is a while loop.`,
      code: TS_CODES.LOOP_BOUND,
    };
  }
  const step = readStep(update, init.name, scope);
  if (step === undefined) {
    return {
      ok: false,
      message: `for-update must be ${shown}++ / ${shown} += <const>, or ${shown} *= / /= <const>.`,
      code: TS_CODES.LOOP_INDUCTION,
    };
  }
  const stall = stalls(step);
  if (stall) {
    return {
      ok: false,
      message: `for step "${stepText(shown, step)}" never advances "${shown}": ${stall}`,
      code: TS_CODES.LOOP_INFINITE,
    };
  }
  if (start === undefined || exit.value === undefined) {
    const refused = runtimeHeader(shown, start, exit.cop, step);
    return refused ?? { ok: true, loop: { name: init.name, start, step: step.by } };
  }
  const bound = exit.value;
  const trips = countTrips(start, exit.cop, bound, step, k);
  if (!trips.ok) {
    const header = `for (${shown} = ${start}; ${shown} ${exit.cop} ${bound}; ${stepText(shown, step)})`;
    // Two different mistakes, and they used to share the first sentence. A loop whose step
    // steps away from the bound never exits. A loop like `for (i = 1; i < 2147483647; i *= 3)`
    // does reach its bound, but only after `i` has left the range of `i32`, so what the
    // hardware actually does there is an overflow, not an exit. The second wants a bound or a
    // start the type can hold, which is a statement about the BOUND, so it takes TS8006.
    return trips.why === 'range'
      ? {
          ok: false,
          message: `${header} walks "${shown}" outside the range of ${k} before the condition fails.`,
          code: TS_CODES.LOOP_BOUND,
        }
      : { ok: false, message: `${header} does not exit.`, code: TS_CODES.LOOP_INFINITE };
  }
  // No ceiling on the count (Rule 7.5, #203): a trip count is a fact about the program, and
  // neither target limits it. The exact count is what the unroller and a reader get.
  return { ok: true, loop: { name: init.name, start, bound, step: step.by, trips: trips.n } };
}

/**
 * The name the loop's bound reads and its body writes, or undefined when the body leaves the
 * bound alone (Rule 7.5). A bound that moves inside the loop does not bound it: the loop is
 * open, and the remedy is a `while`, which says so. Only the body's own writes are seen here;
 * a write made by a function the body calls is not, because the functions of the file are
 * lowered one at a time (Appendix B).
 */
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

/** Every node of a loop bound whose value the loop body could move. A runtime-sized storage
 *  array's length is not one: it is fixed when the host binds the buffer, so `arrayLength(xs)`
 *  (what `xs.length` lowers to) reads no element of `xs`, and a body that writes `xs[i]` leaves
 *  it where it was. Without this, `for (let i = 0; i < xs.length; i++) { xs[i] = ... }`, the
 *  loop Rule 7.5 is written around, was refused as a loop whose body writes its bound. A
 *  fixed-size array's `.length` is already a literal by the time it gets here. */
function eachBoundRead(e: Expr, visit: (e: Expr) => void): void {
  if (e.op === 'call' && e.fn === 'arrayLength') return;
  visit(e);
  mapChildren(e, (c) => {
    eachBoundRead(c, visit);
    return c;
  });
}

/**
 * What can still be proved about a header whose start or bound is a runtime value, or
 * undefined when that is enough to count it by (Rule 7.5).
 *
 * The count is unknown, but the DIRECTION is not: the step is a constant, so whether it moves
 * the counter toward the bound is a fact of the header. A step that moves away is the loop
 * that does not exit, as it is with a constant bound. `==` and `!=` are refused because they
 * exit only when the step lands on the bound exactly, which a runtime bound cannot promise. A
 * multiplicative step moves toward a larger bound only from a positive start and toward a
 * smaller one only while the counter is not yet 0, so its factor has to be a positive whole
 * number, and a constant start of 0 is the loop that never moves.
 *
 * What this does not prove, because the value is not known before the loop runs: that the
 * counter reaches the bound before it leaves its type. `i <= n` with `n` at the type's
 * maximum never fails, `i += 4` wraps past a bound within 4 of it, and `i *= 2` from a runtime
 * start of 0 never moves. Both targets and the
 * CPU agree on what such a loop does; Appendix B of `docs/language-design.md` records it.
 */
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
    };
  }
  const goingUp = cop === '<' || cop === '<=';
  if (step.op === 'add') {
    if (goingUp !== step.by > 0) {
      return {
        ok: false,
        message: `for step "${text}" moves "${shown}" away from a bound it compares with ${cop}, so the loop does not exit once it starts.`,
        code: TS_CODES.LOOP_INFINITE,
      };
    }
    return undefined;
  }
  if (!Number.isInteger(step.by) || step.by < 2) {
    return {
      ok: false,
      message: `for step "${text}" with a runtime start or bound needs a whole factor of 2 or more, so its direction is known.`,
      code: TS_CODES.LOOP_BOUND,
    };
  }
  if (goingUp !== (step.op === 'mul')) {
    return {
      ok: false,
      message: `for step "${text}" moves "${shown}" away from a bound it compares with ${cop}, so the loop does not exit once it starts.`,
      code: TS_CODES.LOOP_INFINITE,
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
    };
  }
  return undefined;
}

/** Why a step cannot move the induction variable, or undefined when it can. All four cases
 *  used to share one message, "step of i is 0", which only ever fitted the first of them. */
function stalls(step: Step): string | undefined {
  if (step.op === 'add') return step.by === 0 ? 'a step of 0 leaves it where it is.' : undefined;
  if (step.by === 1) return 'multiplying or dividing by 1 leaves it where it is.';
  if (step.by === 0) {
    return step.op === 'mul' ? 'multiplying by 0 pins it at 0.' : 'dividing by 0 cannot move it.';
  }
  return undefined;
}

/** A trip count, or the reason there is not one. The two reasons were one `undefined` and
 *  therefore one sentence: `noexit` is a step that moves away from the bound and never
 *  satisfies it, `range` is a loop that does reach its bound but only after the induction
 *  variable has left what its type can hold. */
type Trips =
  | { readonly ok: true; readonly n: number }
  | { readonly ok: false; readonly why: 'noexit' | 'range' };

const NO_EXIT: Trips = { ok: false, why: 'noexit' };
const OUT_OF_RANGE: Trips = { ok: false, why: 'range' };

/**
 * How many times the body runs, or why it has no finite count.
 *
 * An ADDITIVE step is counted arithmetically rather than by walking the sequence, and that is
 * the point of this half of #8 A15: walking it could only look `MAX_LOOP_TRIPS + 2` steps
 * ahead, so `for (let i = 0; i < 1024; i++)`, which exits at 1024, was reported as a loop that
 * "does not exit". A policy violation wore the words of a non-terminating loop, and the author
 * was told the wrong thing about their program. Counted exactly, 1024 is 1024 and the message
 * says it exceeds the limit.
 *
 * A MULTIPLICATIVE step is still walked, and that is exact too: each step either leaves the
 * 32-bit range, stops moving, or fails the condition, and the first two end the walk. The
 * budget is 64 checks rather than the 32 a factor of 2 would need, because the factor is only
 * required to be a compile-time constant: a factor between 1 and 2 climbs more slowly (1.5
 * needs 52 steps to cross 2^30), and such a program is refused later by the literal check
 * rather than here. 64 covers every factor the walk can be handed and is still a handful of
 * steps rather than a bounded guess.
 */
function countTrips(start: number, cop: CmpOp, bound: number, step: Step, kind: string): Trips {
  const lo = kind === 'u32' ? 0 : -0x80000000;
  const hi = kind === 'u32' ? 0xffffffff : 0x7fffffff;
  if (start < lo || start > hi) return OUT_OF_RANGE;
  if (!cmpHolds(cop, start, bound)) return { ok: true, n: 0 };
  if (step.op === 'add') return addTrips(start, cop, bound, step.by, lo, hi);
  // A division on an integer induction variable truncates, exactly as both targets do.
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

/** The trip count of an additive loop, in closed form. `lo`/`hi` are the induction type's
 *  range: a loop that would have to leave it before the condition fails does not exit. */
function addTrips(
  start: number,
  cop: CmpOp,
  bound: number,
  step: number,
  lo: number,
  hi: number,
): Trips {
  // `==` and `!=` are about hitting one value, not about crossing a threshold.
  if (cop === '==') {
    if (start !== bound) return { ok: true, n: 0 };
    return bound + step === bound ? NO_EXIT : { ok: true, n: 1 };
  }
  if (cop === '!=') {
    const gap = bound - start;
    if (gap === 0) return { ok: true, n: 0 };
    if (step === 0 || gap % step !== 0 || gap / step < 0) return NO_EXIT;
    // No range check here, unlike the four threshold arms below, and it is not an omission.
    // This arm only counts when the walk lands EXACTLY on the bound (`gap % step !== 0` is
    // refused above), so every value it visits lies between the start and the bound, and the
    // value after the final iteration IS the bound. Both ends are already in range: the start
    // is checked in `countTrips`, and a bound the type cannot hold is a literal the type
    // cannot hold, which is refused where it is spelled (an integer literal outside i32 does
    // not take the induction variable's type, so the comparison is a type mismatch). The four
    // arms below need their check because they stop at the last value that still SATISFIES
    // the condition and then take one more step past it, which is a value no literal names.
    return { ok: true, n: gap / step };
  }
  // The remaining four are `<`, `<=`, `>`, `>=`. Normalise to "how far is the last value that
  // still satisfies the condition", then divide by the step.
  const inclusive = cop === '<=' || cop === '>=';
  const goingUp = cop === '<' || cop === '<=';
  if (step === 0) return NO_EXIT;
  if (goingUp !== step > 0) return NO_EXIT; // stepping away from the bound
  const last = goingUp ? (inclusive ? bound : bound - 1) : inclusive ? bound : bound + 1;
  const span = goingUp ? last - start : start - last;
  if (span < 0) return { ok: true, n: 0 };
  const trips = Math.floor(span / Math.abs(step)) + 1;
  // The value AFTER the final iteration has to be representable, since the loop computes it
  // before the condition rejects it.
  const end = start + trips * step;
  if (end < lo || end > hi) return OUT_OF_RANGE;
  return { ok: true, n: trips };
}

/**
 * Why a `while` cannot run as written, or undefined when it can (Rule 7.5).
 *
 * A `while` is an OPEN loop: it ends when its condition fails, or at a `break` or a `return`
 * in its body, and nothing about it is counted. A BVH traversal (`while (sp > 0)`) and an
 * iterative solver are written this way, and both targets accept it. What is refused is the
 * one open loop that certainly never ends: a condition that is constantly true, with no
 * `break` or `return` in the body to leave it by. `hasExit` answers the second half, since
 * that is a question about the source body and not the condition.
 */
export function openLoopError(
  cond: Expr,
  scope: LoweringScope,
  hasExit: boolean,
): { message: string; code: TsCode } | undefined {
  if (foldConstBool(cond, scope) !== true || hasExit) return undefined;
  return {
    message:
      'while (true) has no break or return in its body, so it never ends. Leave it with a ' +
      'break, or write the exit into the condition.',
    code: TS_CODES.LOOP_INFINITE,
  };
}

/** The components of a constant vector or scalar expression, or undefined when any part does not
 *  fold: a literal, a scalar const, a vector constructor over those (one scalar splats), a
 *  negation, and `+ - * /` over those with the vector-against-scalar broadcast the language has.
 *  `valueExprs` is the module-constant collector's table of whole vector constants, so
 *  `const STEP = SIZE * 0.5` folds through `SIZE`; a body has no such table and folds literals
 *  and scalar consts alone. A division whose own divisor is zero is not folded, since its value
 *  is the thing in question. Written for the zero-divisor proof (#68), where a false negative
 *  (a zero this cannot see) only lets Tint refuse the module later, and a false positive would
 *  refuse a program that runs; integer division is computed in floating point here, which can
 *  miss an integer zero (`1 / 2`) but never invent one. */
export function foldConstComponents(
  e: Expr,
  scope: LoweringScope,
  valueExprs?: ReadonlyMap<string, Expr>,
  seen: ReadonlySet<string> = new Set(),
): number[] | undefined {
  const fold = (x: Expr, s: ReadonlySet<string> = seen): number[] | undefined =>
    foldConstComponents(x, scope, valueExprs, s);
  switch (e.op) {
    case 'lit':
      return typeof e.value === 'number' ? [e.value] : undefined;
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
      // The collector hands the earlier consts' initializers in `valueExprs`; inside a function
      // body the binding itself carries the one a vector const was declared with.
      const value = valueExprs?.get(e.name) ?? scope.resolveIr(e.name)?.valueExpr;
      if (value !== undefined) return fold(value, new Set([...seen, e.name]));
      const n = foldConstNumber(e, scope);
      return n === undefined ? undefined : [n];
    }
    case 'varref': {
      const n = foldConstNumber(e, scope);
      return n === undefined ? undefined : [n];
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
            out.push(x + y);
            break;
          case '-':
            out.push(x - y);
            break;
          case '*':
            out.push(x * y);
            break;
          case '/':
            if (y === 0) return undefined;
            out.push(x / y);
            break;
          default:
            return undefined;
        }
      }
      return out;
    }
    default:
      return undefined;
  }
}
