// ═══ WGSL's scalar arithmetic on JavaScript numbers ═══
//
// The binary operators and the builtins with one correct answer, as the CPU backends and
// constant folding compute them: WGSL's integer arithmetic, two's-complement with truncating
// `/` and `%`, plain double arithmetic for a float, and `min`, `max`, `round` and the rest of
// `EXACT_BUILTINS`. Apart from `cpu-runtime.ts`, whose builtin tables are built when it loads,
// so that the emitters fold a constant with the same functions without carrying the CPU tier:
// the load-time emitter's bundle (`typeshade/emit`, change 0025) reaches this file and not that
// one. `atomicStep` is here for the same reason: the WebGL2 executor (`gl-compute.ts`) resolves
// atomic operations with it, and the program runtime (`typeshade/runtime`) carries the executor
// and not the CPU tier.

import type { BinOp } from './ir/nodes.js';

/** The numeric kind a binary op evaluates in. WGSL integer arithmetic is two's-complement
 *  modulo 2^32 with truncating `/` and `%` (`x / 0 = x`, `x % 0 = 0`, i32 `MIN / -1 = MIN`);
 *  JS number arithmetic is none of that, so every integer op in `scalarBin` is spelled
 *  kind-directed (X-GIS #2274). `'f32'` covers every float kind (f32 and the lowered f64 lanes):
 *  plain f64 JS arithmetic, the f64-algebra caveat in `cpu-runtime.ts`'s header. Derived from the
 *  STATIC operand type by `numKindOf`; both CPU backends pass it (the codegen bakes it into
 *  the generated JS). */
export type NumKind = 'f32' | 'i32' | 'u32';

/** Two's-complement wrap of an integer-valued double into the kind's 32-bit range —
 *  `| 0` for i32, `>>> 0` for u32 (ToInt32/ToUint32 are exact modulo-2^32 reductions for
 *  any finite double). Also normalises `-0` to `0`. Identity for the float kind. */
export const wrapInt = (v: number, kind: NumKind): number =>
  kind === 'i32' ? v | 0 : kind === 'u32' ? v >>> 0 : v;

/** WGSL integer division: truncating; `x / 0 = x`; i32 `MIN / -1` wraps back to MIN. */
export const intDiv = (a: number, b: number, kind: NumKind): number =>
  b === 0 ? a : wrapInt(Math.trunc(a / b), kind);

/** WGSL integer remainder: `x % 0 = 0`; i32 `MIN % -1 = 0`; otherwise JS `%` (trunc-rem,
 *  the same sign rule as C and WGSL: `-7 % 2 = -1`). */
export const intRem = (a: number, b: number, kind: NumKind): number =>
  b === 0 ? 0 : wrapInt(a % b, kind);

export function scalarBin(bop: BinOp, a: number, b: number, kind: NumKind = 'f32'): number {
  const int = kind !== 'f32';
  switch (bop) {
    case '+':
      return int ? wrapInt(a + b, kind) : a + b;
    case '-':
      return int ? wrapInt(a - b, kind) : a - b;
    case '*':
      // Math.imul is the wrapping 32-bit product; `a * b` in f64 loses bits above 2^53
      // and would wrap the WRONG value (the same rule const-fold's foldIntLit follows).
      return int ? wrapInt(Math.imul(a, b), kind) : a * b;
    case '/':
      return int ? intDiv(a, b, kind) : a / b;
    case '%':
      return int ? intRem(a, b, kind) : a % b;
    // Bitwise — JS `& | ^ <<` produce int32; the kind decides the sign of the result:
    // i32 keeps it (`-1 & -1` is -1), u32 normalises with `>>> 0`. The float kind is
    // unreachable here (validate's `mixed-scalar` rejects a float operand) and falls
    // into the u32 spelling, the historical default.
    case '&':
      return kind === 'i32' ? a & b : (a & b) >>> 0;
    case '|':
      return kind === 'i32' ? a | b : (a | b) >>> 0;
    case '^':
      return kind === 'i32' ? a ^ b : (a ^ b) >>> 0;
    case '<<':
      return kind === 'i32' ? a << b : (a << b) >>> 0;
    // i32 uses arithmetic shift (sign-preserving JS `>>`); u32 uses logical `>>>`.
    case '>>':
      return kind === 'i32' ? a >> b : a >>> b;
  }
}

/** WGSL `min`: when one operand is NaN, the other is returned, where `Math.min` propagates the
 *  NaN (X-GIS #2274). GLSL ES 3.00 leaves NaN behaviour undefined; WGSL is the canonical
 *  target. */
export const minNum = (a: number, b: number): number =>
  a !== a ? b : b !== b ? a : Math.min(a, b);
/** WGSL `max`, with `min`'s rule for a NaN operand. */
export const maxNum = (a: number, b: number): number =>
  a !== a ? b : b !== b ? a : Math.max(a, b);

/** WGSL and GLSL ES `round`: a halfway case goes to the nearest EVEN integer, unlike JS
 *  `Math.round` (ties toward +∞). round(2.5)=2, round(3.5)=4, round(-2.5)=-2. */
export const roundTiesToEven = (x: number): number => {
  const f = Math.floor(x),
    d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
};

/** The builtins with one correct answer, on scalar operands (issue #73): what constant folding
 *  computes for a call of one over literals (`passes/opt/const-fold.ts`), and what the CPU
 *  tier's `BUILTINS` apply component by component, so the fold and the oracle agree by
 *  construction. Each is exact on every target, so the value JS computes is the value the GPU
 *  computes. The transcendental ones (`sin`, `pow`, `sqrt`, ...) are NOT here: WGSL gives them
 *  an accuracy bound, not a correctly rounded result, so a folded literal could differ from the
 *  driver's own value by ulps. They stay calls, and the driver folds them itself.
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
export const EXACT_BUILTINS = {
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  round: roundTiesToEven,
  sign: Math.sign,
  min: minNum,
  max: maxNum,
  // clamp(e, lo, hi) = min(max(e, lo), hi), the formula WGSL lists first and the one GLSL ES
  // 3.00 defines, so clamp(NaN, lo, hi) is lo.
  clamp: (x: number, lo: number, hi: number): number => minNum(maxNum(x, lo), hi),
  saturate: (x: number): number => minNum(maxNum(x, 0), 1),
  fract: (x: number): number => x - Math.floor(x),
  step: (edge: number, x: number): number => (x < edge ? 0 : 1),
} as const satisfies Readonly<Record<string, (...args: number[]) => number>>;

/** One atomic builtin applied on the CPU (roadmap 0.2 item 4). The oracle runs invocations one
 *  after another, so an atomic is a plain read-modify-write of its location; this is the
 *  arithmetic of each builtin and what it hands back: the value the location held BEFORE the
 *  update for every read-modify-write form (`atomicAdd` ... `atomicExchange`), the current
 *  value for `atomicLoad`. `atomicStore` has no value on the GPU; its `result` is the old
 *  value and every caller drops it. Integer arithmetic wraps the way the GPU's does. */
export function atomicStep(
  fn: string,
  old: number,
  arg: number,
  kind: NumKind,
  /** The value to STORE, for `atomicCompareExchangeWeak` alone (#152), where `arg` is the value
   *  to compare against. Every other builtin takes one operand and ignores this. */
  store?: number,
): {
  readonly next: number;
  readonly result: number | { readonly old_value: number; readonly exchanged: boolean };
} {
  switch (fn) {
    // `atomicCompareExchangeWeak(&x, cmp, val)` stores `val` only when the location holds
    // `cmp`, and answers the contents it held BEFORE the call plus whether the store happened
    // (wgsl.txt:25584). The field names are WGSL's own, in snake_case: measured on Tint,
    // `r.oldValue` is "struct member oldValue not found".
    //
    // "Weak" names a hardware licence to fail spuriously, which this oracle does not exercise:
    // one invocation at a time, so a comparison that holds cannot be beaten to the location.
    // A device may answer `exchanged: false` where this answers true, and a shader that loops
    // until it succeeds — which is the shape WGSL documents — is correct on both.
    case 'atomicCompareExchangeWeak': {
      const exchanged = old === arg;
      return {
        next: exchanged ? wrapInt(store ?? 0, kind) : old,
        result: { old_value: old, exchanged },
      };
    }
    case 'atomicLoad':
      return { next: old, result: old };
    case 'atomicStore':
    case 'atomicExchange':
      return { next: wrapInt(arg, kind), result: old };
    case 'atomicAdd':
      return { next: wrapInt(old + arg, kind), result: old };
    case 'atomicSub':
      return { next: wrapInt(old - arg, kind), result: old };
    case 'atomicMin':
      return { next: Math.min(old, arg), result: old };
    case 'atomicMax':
      return { next: Math.max(old, arg), result: old };
    case 'atomicAnd':
      return { next: wrapInt(old & arg, kind), result: old };
    case 'atomicOr':
      return { next: wrapInt(old | arg, kind), result: old };
    case 'atomicXor':
      return { next: wrapInt(old ^ arg, kind), result: old };
    default:
      throw new Error(`typeshade/cpu: '${fn}' is not an atomic builtin`);
  }
}
