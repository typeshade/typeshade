import type { ShaderType } from './shader-type.js';

/** Narrows a `ShaderType` to the native `{ kind: 'vec' }` arm, whose `elem` is `'f32' | 'i32' |
 *  'u32'`. The emulated-double vector is the separate `'vec64'` kind; test for it with
 *  {@link isVec64}. Binary-op type resolution uses it (`isMat(a) && isVec(b)`, `isVec(a) &&
 *  isScalar(b)`) to decide between a vector-scalar broadcast, a matrix-vector product and a
 *  same-kind op, and the `.x`/`.y`/`.r`/`.g` swizzle guards use it to reject a non-vector
 *  receiver.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isVec } from 'typeshade'
 *  import { vec3fT, f32T } from 'typeshade/core/ir'
 *
 *  isVec(vec3fT) // true
 *  isVec(f32T) // false
 *  ```
 */
export const isVec = (t: ShaderType): t is Extract<ShaderType, { kind: 'vec' }> => t.kind === 'vec';
/** Narrows a `ShaderType` to the native `{ kind: 'scalar' }` arm (`f32`, `i32`, `u32`, `bool`).
 *  It is `false` for {@link f64T}, which is its own kind so that this predicate does not treat
 *  it as a scalar. Arithmetic type resolution uses it to detect the vector-scalar broadcast
 *  case (`isVec(a) && isScalar(b)` and its mirror), where the vector operand's type is the
 *  result.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isScalar } from 'typeshade'
 *  import { f32T, f64T } from 'typeshade/core/ir'
 *
 *  isScalar(f32T) // true
 *  isScalar(f64T) // false: f64 is its own ShaderType kind
 *  ```
 */
export const isScalar = (t: ShaderType): t is Extract<ShaderType, { kind: 'scalar' }> =>
  t.kind === 'scalar';
/** Narrows a `ShaderType` to the `{ kind: 'mat' }` arm. It matches both `elem: 'f32'` (native
 *  `matNxN<f32>`) and `elem: 'f64'` (emulated, emitted as a struct of double-double columns);
 *  use {@link isMat64} when the distinction matters. Binary-op type resolution checks it before
 *  a matrix-vector or matrix-matrix product.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isMat } from 'typeshade'
 *  import { mat4x4fT, mat2f64T } from 'typeshade/core/ir'
 *
 *  isMat(mat4x4fT) // true
 *  isMat(mat2f64T) // also true; use isMat64 to tell them apart
 *  ```
 */
export const isMat = (t: ShaderType): t is Extract<ShaderType, { kind: 'mat' }> => t.kind === 'mat';
/** Narrows a `ShaderType` to an emulated-double matrix (`matNxN<f64>`, see {@link mat2f64T}),
 *  which is emitted as a struct of double-double columns.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const isMat64 = (
  t: ShaderType,
): t is Extract<ShaderType, { kind: 'mat' }> & { elem: 'f64' } =>
  t.kind === 'mat' && t.elem === 'f64';
/** Narrows a `ShaderType` to the emulated-double scalar arm ({@link f64T}). Arithmetic type
 *  resolution checks it first, before native scalar promotion, so an `f64` operand always wins
 *  the result type over a plain `f32` or number. Mixing `f64` with an `i32`, `u32` or `bool`
 *  operand throws `SD0004`, since emulated double precision only widens from f32 and number.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isF64 } from 'typeshade'
 *  import { f64T, f32T } from 'typeshade/core/ir'
 *
 *  isF64(f64T) // true
 *  isF64(f32T) // false
 *  ```
 */
export const isF64 = (t: ShaderType): t is Extract<ShaderType, { kind: 'f64' }> => t.kind === 'f64';
/** Narrows a `ShaderType` to the emulated-double vector arm ({@link vec2f64T} and its 3- and
 *  4-wide siblings). It is distinct from {@link isVec}, which matches only the native `vec` kind
 *  and is `false` for an emulated-double vector. Component access (`.comp()` and swizzles)
 *  accepts either `isVec(t) || isVec64(t)`, since both kinds support it, each through its own
 *  emitted form.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isVec64 } from 'typeshade'
 *  import { vec2f64T, vec2fT } from 'typeshade/core/ir'
 *
 *  isVec64(vec2f64T) // true
 *  isVec64(vec2fT) // false: a native vec, use isVec for that
 *  ```
 */
export const isVec64 = (t: ShaderType): t is Extract<ShaderType, { kind: 'vec64' }> =>
  t.kind === 'vec64';
