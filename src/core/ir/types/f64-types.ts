import type { ShaderType } from './shader-type.js';

/** The emulated double-precision scalar type. It is a logical `f64`: WGSL and GLSL ES 3.00
 *  have no native double-precision shader type, even on a GPU whose hardware supports double precision.
 *  A value typed `f64T` is an unevaluated pair of f32 values, a high part and a low part holding
 *  the residual the high part could not represent. A pass before emit rewrites every operation
 *  on it into arithmetic on that pair. The pair carries about 48 significand bits at f32's
 *  exponent range, against f32's 24. This software representation uses one f32 pair per value
 *  without requiring native 64-bit floating-point shader support.
 *
 *  The authoring surface is the same as f32's; only the declared type differs. Declare a
 *  parameter, a uniform field or a struct field `f64T` and the operators, the comparisons and
 *  the builtins read exactly as they do for f32.
 *
 *  These operations are emulated: `+`, `-`, `*`, `/`, all comparisons, `neg`, `abs`, `min`,
 *  `max`, `sqrt`, `mix` with an f32 interpolant, `floor`, `fract`, `sin` and `cos`, and on the
 *  vector types {@link vec2f64T} and its siblings also `dot`, `length`, `distance` and
 *  `normalize`. Anything else on an f64 operand fails at emit with `SD0041`, naming the
 *  operation: narrow explicitly with {@link toF32} first. `%` and the bitwise operators are
 *  rejected at author time, since neither has a meaning on a two-part value.
 *
 *  Conversion goes one way implicitly. An f32 widens to f64 in arithmetic, exactly, and
 *  {@link toF64} or a bare number literal does it explicitly; a JavaScript number is already a
 *  double, so a literal splits losslessly at build time. Narrowing is always explicit,
 *  {@link toF32}, and loses precision. Mixing f64 with an integer or a boolean is `SD0004` at
 *  author time.
 *
 *  An f64 varying is rejected with `SD0044`: interpolating a high and low pair independently
 *  is numerically wrong. Narrow to f32 for the varying, or carry the two parts as two f32
 *  locations and rebuild them with {@link f64FromParts}.
 *
 *  `sin` and `cos` are less accurate than the arithmetic. They use a three-stage argument
 *  reduction, a tabled angle addition and a short Taylor series on the remainder, and the
 *  truncation floors the relative error at about 2^-36 for the transcendental itself, which
 *  then degrades with the argument's magnitude through the reduction. That is still far past
 *  f32, whose sine of an argument near 2^24 is noise.
 *
 *  Each f64 operation costs several to ten times an f32 one, so opt in per value: declare f64
 *  only where the precision is needed.
 *
 *  A module doing f64 arithmetic gets a guard texture injected automatically: a 1 by 1
 *  `texture_2d<f32>` binding named `_fp64` whose texel, always 1.0, multiplies the
 *  error-compensation terms so a downstream compiler cannot fold them away. {@link fp64Guard}
 *  pins its slot.
 *
 *  Exported from `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, module, uniformStruct, sqrt, toF32, f64T, f32T } from 'typeshade/core/ir'
 *
 *  const U = uniformStruct('U', { group: 0, binding: 0, as: 'u' }, { origin: f64T })
 *
 *  // The operators are unchanged; only the declared type says f64.
 *  const k = fn('k', { x: f64T, s: f32T }, ({ x, s }) => toF32(sqrt(x.add(U.field.origin).mul(s))))
 *  const m = module({ uses: [U], funcs: [k] })
 *  ```
 *
 *  @see {@link splitF64} for packing a host-side double into the pair.
 *  @see {@link fp64Guard} for the guard texture and its slot.
 *  @see {@link recommendFp64Flavor} for choosing the emulation flavour per device.
 */
export const f64T = { kind: 'f64' } as const satisfies ShaderType;
/** A 2-component emulated-double vector, logically `vec2<f64>`. Before emit it is rewritten
 *  into a struct of two `vec2<f32>` planes, `hi` and `lo`, and componentwise arithmetic runs on
 *  the whole planes at once. The usual carrier for a position in world units that must
 *  survive far more than f32's roughly 7 significant digits; see {@link f64T} for what is
 *  emulated and what it costs.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec2f64T = { kind: 'vec64', n: 2 } as const satisfies ShaderType;
/** A 3-component emulated-double vector; see {@link vec2f64T} for how it is emitted and when
 *  to prefer the emulated-double family over plain {@link vec3fT}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec3f64T = { kind: 'vec64', n: 3 } as const satisfies ShaderType;
/** A 4-component emulated-double vector; see {@link vec2f64T} for how it is emitted and when
 *  to prefer the emulated-double family over plain {@link vec4fT}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec4f64T = { kind: 'vec64', n: 4 } as const satisfies ShaderType;
/** A 2×2 emulated-double matrix, logically `mat2x2<f64>`. Before emit it is rewritten into a
 *  struct of two {@link vec2f64T} columns, and {@link mulMat64}, {@link transformMat64} and
 *  {@link transpose64} on it compose the scalar double-double error-free transforms the same
 *  way `length` and `dot` on {@link vec2f64T} do.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const mat2f64T = {
  kind: 'mat',
  cols: 2,
  rows: 2,
  elem: 'f64',
} as const satisfies ShaderType;
/** A 3×3 emulated-double matrix; see {@link mat2f64T} for how it is emitted and the matrix
 *  operations available on it.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const mat3f64T = {
  kind: 'mat',
  cols: 3,
  rows: 3,
  elem: 'f64',
} as const satisfies ShaderType;
/** A 4×4 emulated-double matrix; see {@link mat2f64T} for how it is emitted and the matrix
 *  operations available on it.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const mat4f64T = {
  kind: 'mat',
  cols: 4,
  rows: 4,
  elem: 'f64',
} as const satisfies ShaderType;
