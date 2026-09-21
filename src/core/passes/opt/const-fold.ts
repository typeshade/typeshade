// ═══ Shader DSL — constant folding pass (Optimization context) ═══
//
// Collapses literal-operand scalar arithmetic to a single literal. Runs
// bottom-up (via mapModuleExprs), so a nested literal tree folds in one pass.
//
// PRECISION: folds in f64, matching the CPU oracle — so oracle value-equality
// (the P2 correctness gate) holds EXACTLY. GPU-f32-precise folding (fround each
// step, to match the runtime f32 result bit-for-bit) is deferred to P3, when the
// real-GPU f32 differential exists to verify it. Only the IEEE-deterministic ops
// (+ - *) are folded; / is folded only when the divisor is non-zero; %, bitwise
// and shifts are left alone (semantics/precision care).
//
// Also folds literal CONTROL predicates (constexpr conditions): a `compare` of two
// number literals → a bool literal (mirroring the oracle's f32 `==`/`!=` fround
// rule so fold == oracle exactly), a `logical` of two bool literals, and a
// `select` whose cond folded to a bool literal → the chosen branch. These expose
// the dead branches that dead-branch.ts then removes.

import type { Expr, ModuleDecl } from '../../ir/index.js'
import { boolT } from '../../ir/index.js'
import { mapModuleExprs } from './ir-transform.js'
import { foldIntLit, intElemOf, wrapInt } from './expr-utils.js'
import { BUILTINS } from '../../cpu-runtime.js'

/** The builtins with one correct answer, folded over scalar literals (issue #73). Each of
 *  these is exact on every target, so the value JS computes is the value the GPU computes,
 *  and the oracle computes it through the same `BUILTINS` entry, so P2 equality holds by
 *  construction. The transcendental ones (`sin`, `pow`, `sqrt`, ...) are NOT here: WGSL gives
 *  them an accuracy bound, not a correctly rounded result, so a folded literal could differ
 *  from the driver's own value by ulps. They stay calls, and the driver folds them itself.
 *
 *  `fract` is the one entry whose "exact" needed checking rather than asserting (#141). It is
 *  INHERITED from `x - floor(x)`, and WGSL's note says `fract` of a tiny negative may be 1.0:
 *  for `x = -1e-30` the exact fraction 1 - 2^-30 lies between two f32 neighbours and WGSL fixes
 *  no rounding mode, so both 1.0 and the neighbour below are allowed. Folding in f64 and
 *  rounding to f32 picks 1.0 — one of the two.
 *
 *  Measured before leaving it in the set: `fract(-1e-30)` is exactly 1.0 on WGSL (Tint) AND on
 *  a WebGL2 driver, and `fract(-1e-7)` is 0.9999998807907104 on both. The two targets and the
 *  fold agree on this hardware, so the fold is not inventing a third answer. The spec freedom
 *  is real and another driver could take the other branch; that is a `target`-kind divergence
 *  for the determinism report to carry, not a reason for the optimizer to leave the call
 *  standing when both measured targets agree with it. */
const EXACT_BUILTINS: ReadonlySet<string> = new Set([
  'abs',
  'floor',
  'ceil',
  'trunc',
  'round',
  'sign',
  'min',
  'max',
  'clamp',
  'saturate',
  'fract',
  'step',
])

/** An INTEGER conversion of an integer literal, folded to the literal the target holds (#154).
 *
 *  This is not an optimization; it is the only spelling of the conversion both targets accept.
 *  WGSL spells a concrete `i32` literal with an `i` suffix and this backend deliberately does
 *  not, so an i32 literal in the emitted module is an ABSTRACT integer — and an AbstractInt
 *  argument to `u32()` must be representable in `u32`. Measured on Tint: `u32(-1)` is "value -1
 *  cannot be represented as 'u32'" while `u32(-1i)` compiles, and GLSL ES 3.00 compiles
 *  `uint(-1)` and answers 4294967295. Once const-prop has substituted a negative `i32` const
 *  into a `u32()` call, the module Tint sees is the one it refuses, and the compile gate cannot
 *  reach it because nothing in the source said `-1`.
 *
 *  Folding removes the question: `u32(-1)` becomes the literal `4294967295u`, which is the
 *  value BOTH targets compute for the conversion and which needs no suffix to say what it is.
 *  The wrap is {@link wrapInt}, the same reinterpretation the hardware performs and the one
 *  {@link foldIntLit} already uses for arithmetic. A FLOAT operand is not folded here: an
 *  out-of-range float conversion is where the two targets genuinely differ, and the front end
 *  refuses that one rather than picking a winner. */
function foldIntConvert(e: Extract<Expr, { op: 'call' }>): Expr | undefined {
  if (e.declRef !== undefined || (e.fn !== 'i32' && e.fn !== 'u32')) return undefined
  const to = intElemOf(e.type)
  if (to === undefined || e.args.length !== 1) return undefined
  const arg = e.args[0]!
  if (arg.op !== 'lit' || typeof arg.value !== 'number') return undefined
  const from = intElemOf(arg.type)
  if (from === undefined) return undefined
  return { op: 'lit', type: e.type, value: wrapInt(arg.value, to) }
}

function foldNode(e: Expr): Expr {
  if (e.op === 'call') {
    const converted = foldIntConvert(e)
    if (converted) return converted
  }
  if (
    e.op === 'call' &&
    e.declRef === undefined &&
    EXACT_BUILTINS.has(e.fn) &&
    e.type.kind === 'scalar' &&
    e.type.scalar !== 'bool' &&
    e.args.length > 0 &&
    e.args.every((a) => a.op === 'lit' && typeof a.value === 'number')
  ) {
    const f = BUILTINS[e.fn]
    const v = f ? f(...e.args.map((a) => (a as { value: number }).value)) : undefined
    if (typeof v === 'number' && Number.isFinite(v)) {
      const int = intElemOf(e.type)
      return { op: 'lit', type: e.type, value: int === undefined ? v : wrapInt(v, int) }
    }
  }
  if (
    e.op === 'binop' &&
    e.a.op === 'lit' &&
    e.b.op === 'lit' &&
    typeof e.a.value === 'number' &&
    typeof e.b.value === 'number'
  ) {
    const a = e.a.value,
      b = e.b.value
    const int = intElemOf(e.type)
    if (int !== undefined) {
      const iv = foldIntLit(e.bop, a, b, int)
      return iv === undefined ? e : { op: 'lit', type: e.type, value: iv }
    }
    let v: number | undefined
    switch (e.bop) {
      case '+':
        v = a + b
        break
      case '-':
        v = a - b
        break
      case '*':
        v = a * b
        break
      case '/':
        v = b !== 0 ? a / b : undefined
        break
      default:
        v = undefined // % / & | ^ << >> — float: left alone (see foldIntLit for integers)
    }
    if (v !== undefined) return { op: 'lit', type: e.type, value: v }
  }
  if (e.op === 'unop' && e.a.op === 'lit' && typeof e.a.value === 'number') {
    const int = intElemOf(e.type)
    // -INT_MIN wraps back to INT_MIN, and -(u32) is the two's-complement negation.
    return {
      op: 'lit',
      type: e.type,
      value: int === undefined ? -e.a.value : wrapInt(-e.a.value, int),
    }
  }
  // compare(lit, lit) -> bool lit. == / != fround f32 operands (matching the
  // oracle, oracle.ts:208); ordering stays f64 (the stricter mirror for thresholds).
  if (
    e.op === 'compare' &&
    e.a.op === 'lit' &&
    e.b.op === 'lit' &&
    typeof e.a.value === 'number' &&
    typeof e.b.value === 'number'
  ) {
    const f32 = e.a.type.kind === 'scalar' && e.a.type.scalar === 'f32'
    const a = e.a.value,
      b = e.b.value
    let v: boolean
    switch (e.cop) {
      case '<':
        v = a < b
        break
      case '>':
        v = a > b
        break
      case '<=':
        v = a <= b
        break
      case '>=':
        v = a >= b
        break
      case '==':
        v = f32 ? Math.fround(a) === Math.fround(b) : a === b
        break
      case '!=':
        v = f32 ? Math.fround(a) !== Math.fround(b) : a !== b
        break
    }
    return { op: 'lit', type: boolT, value: v }
  }
  // logical(lit bool, lit bool) -> bool lit. Both operands are literals here, so
  // there is nothing to short-circuit.
  if (
    e.op === 'logical' &&
    e.a.op === 'lit' &&
    e.b.op === 'lit' &&
    typeof e.a.value === 'boolean' &&
    typeof e.b.value === 'boolean'
  ) {
    const v = e.lop === '&&' ? e.a.value && e.b.value : e.a.value || e.b.value
    return { op: 'lit', type: boolT, value: v }
  }
  // select(lit cond, t, f) -> t | f (the dead arm is dropped).
  if (e.op === 'select' && e.cond.op === 'lit' && typeof e.cond.value === 'boolean') {
    return e.cond.value ? e.ifTrue : e.ifFalse
  }
  return e
}

/** Fold literal-operand arithmetic throughout a module. Pure (module -> module).
 *  Raw-Stmt fns are skipped (X-GIS #763 P1) — f64 pre-folding around a raw splice
 *  double-rounds vs the GPU's stepwise f32. */
export function constFold(m: ModuleDecl): ModuleDecl {
  return mapModuleExprs(m, foldNode, { skipRawBodies: true })
}
