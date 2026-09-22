// ═══ Shader DSL — the df64 twin tables (what f64 arithmetic the pass can lower) ═══
//
// The ONE list of builtins the fp64 lowering pass has an emulated-double body for, kept in a
// leaf module because two halves of the compiler read it and neither may drift from the other:
//
//   - passes/fp64-lower.ts maps each id to the df64 helper it rewrites the call into;
//   - the `"use typeshade"` front end (compiler/ts/lower/math-args.ts) refuses every OTHER
//     builtin at the CALL SPAN, with this list in the message, instead of accepting the
//     program and raising SD0041 from the backend after the author has left the call behind
//     (#151 F64-08).
//
// A leaf, so the front end does not pull the pass (and through it the whole df64 helper
// library, which builds every helper's IR at module load) into the language service.
// Everything here is names only.

/** Builtin id → the df64 helper that replaces a call on SCALAR f64 operands. */
export const F64_SCALAR_TWIN_FN: Readonly<Record<string, string>> = {
  sqrt: 'df64_sqrt',
  abs: 'df64_abs',
  floor: 'df64_floor',
  fract: 'df64_fract',
  // `df64_round`, not `df64_nint`: WGSL's `round` breaks ties to the even integer and `nint`
  // breaks them toward +∞, the convention the mod-2π reduction needs (fp64/df64-lib.ts).
  round: 'df64_round',
  min: 'df64_min',
  max: 'df64_max',
  mix: 'df64_mix',
  sin: 'df64_sin',
  cos: 'df64_cos',
}

/** Builtin id → the shape of its componentwise `df64_vN_*` twin on a `vec64` operand. */
export const F64_VEC_TWIN_KIND: Readonly<Record<string, 'unary' | 'binary' | 'mix'>> = {
  abs: 'unary',
  floor: 'unary',
  fract: 'unary',
  round: 'unary',
  normalize: 'unary',
  sin: 'unary',
  cos: 'unary',
  min: 'binary',
  max: 'binary',
  mix: 'mix',
}

/** The cross-lane reductions on a `vec64`: composed from the SCALAR df64 helpers rather than
 *  from a `df64_vN_*` twin (a dot product has to accumulate in extended precision anyway), so
 *  they are not in {@link F64_VEC_TWIN_KIND} and are listed here. Each yields an `f64`. */
export const F64_VEC_REDUCTIONS: readonly string[] = ['dot', 'length', 'distance']

/** Every builtin the pass lowers on a scalar `f64`, sorted, for a refusal message. */
export const F64_SCALAR_TWINS: readonly string[] = Object.keys(F64_SCALAR_TWIN_FN).sort()

/** Every builtin the pass lowers on a `vec64`, sorted, for a refusal message. */
export const F64_VEC_TWINS: readonly string[] = [
  ...Object.keys(F64_VEC_TWIN_KIND),
  ...F64_VEC_REDUCTIONS,
].sort()
