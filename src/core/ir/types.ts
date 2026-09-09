// ═══ Shader DSL — IR types ═══
//
// ShaderType (the runtime type descriptor), the branded type constants, the
// type-level key machinery (KeyOf/ElemKey/ScalarKey) that powers the
// compile-time type-safety gate, and the type predicates/helpers. No Node
// dependency — this is the leaf of the core/ir import DAG
// (types ← nodes ← node ← builder).

/** The four native scalar kinds: the ones WGSL and GLSL ES 3.00 both represent directly in
 *  hardware, and the set a `ShaderType` of `kind: 'scalar'` can carry. When a binary operator
 *  mixes two of them, the result follows the native promotion order `f32` > `i32` > `u32`.
 *  Emulated double precision is a separate `ShaderType` kind, {@link f64T}, so it never enters
 *  native promotion and every code path that switches on the scalar kind decides about it
 *  separately (see {@link ShaderType}).
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type Scalar = 'f32' | 'i32' | 'u32' | 'bool'

/** The element type of a sampled texture: WGSL's `texture_2d<T>` type parameter, or GLSL ES
 *  3.00's sampler prefix (`f32` is `sampler2D`, `u32` is `usampler2D`, `i32` is `isampler2D`).
 *  All three are core in both targets.
 *
 *  An integer texture is unfilterable: interpolating integer texels is undefined, and WGSL
 *  rejects `textureSample` on a `texture_2d<u32>`. GLSL would accept `texture(usampler2D, …)`
 *  with nearest filtering, but a construct that compiles on WebGL2 and cannot be expressed on
 *  WebGPU is what authoring once for both targets is meant to rule out. Read an integer
 *  texture with {@link textureLoad}, {@link textureDimensions} and {@link textureNumLayers};
 *  {@link textureSample} and {@link textureSampleLevel} on an integer key are `tsc` errors.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type TextureElem = 'f32' | 'u32' | 'i32'

/** The runtime type descriptor for every value the DSL can represent: a plain, comparable
 *  discriminated union, so a `switch (t.kind)` over it is exhaustively checked by `tsc` at
 *  every site that must decide what to do with a shape ({@link typeKey}, {@link wgslLayout},
 *  both backends' emit walkers). Do not build one as an object literal. Use the named constants
 *  (`f32T`, `vec3fT`, …) or the {@link structT} and {@link arrayT} constructors, which keep the
 *  `as const satisfies ShaderType` narrowing that {@link KeyOf} depends on to resolve a precise
 *  string key instead of `string`. {@link typeKey} turns any `ShaderType` into that same key at
 *  runtime; `KeyOf<T>` is its type-level mirror, which lets {@link Node} carry the key as a
 *  compile-time phantom so a type mismatch is a `tsc` error instead of an `SD0002` thrown when
 *  the authoring code runs.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type ShaderType =
  | { readonly kind: 'scalar'; readonly scalar: Scalar }
  // Emulated double precision (df64): a LOGICAL scalar that lowers to a
  // vec2<f32> (x = hi, y = lo) before emit (passes/fp64-lower.ts). Its OWN kind
  // — not a Scalar — so it never participates in the native scalar promotion
  // (binResultType) and every `t.kind` switch is forced to decide about it.
  | { readonly kind: 'f64' }
  // A vector of emulated doubles: lowers to `struct DF64VecN { hi: vecN<f32>,
  // lo: vecN<f32> }` before emit — the EFTs are lane-valid, so componentwise
  // arithmetic runs on whole vecN hi/lo planes. Own kind, same rationale.
  | { readonly kind: 'vec64'; readonly n: 2 | 3 | 4 }
  | { readonly kind: 'vec'; readonly n: 2 | 3 | 4; readonly elem: 'f32' | 'i32' | 'u32' }
  // A matrix. elem 'f32' is native (matNxN<f32>); elem 'f64' is emulated double
  // precision — it lowers to `struct DF64MatN { c0..c(N-1): DF64VecN }` (columns
  // of df64), and matmul / mat·vec / transpose compose the SCALAR df64 EFTs the
  // same way length/dot do. Own elem arm, so every `t.kind === 'mat'` consumer is
  // forced to decide about f64 (verified-by-construction).
  | { readonly kind: 'mat'; readonly n: 2 | 3 | 4; readonly elem: 'f32' | 'f64' }
  | { readonly kind: 'struct'; readonly name: string }
  | { readonly kind: 'array'; readonly elem: ShaderType; readonly size?: number }
  // A sampled texture. '2d-array' (#1651) is CORE in both targets — WGSL
  // texture_2d_array<f32>, GLSL ES 3.00 sampler2DArray — so it needs no Capability
  // (pinned by required-caps.test.ts); '2d-ms' still fails closed on GLSL.
  //
  // Split into TWO arms (#1703) so a multisampled INTEGER texture is unrepresentable
  // by CONSTRUCTION rather than a runtime throw: '2d'/'2d-array' carry any
  // TextureElem, '2d-ms' is pinned to f32. Narrowing still works off `dim` alone —
  // every existing `t.dim === '…'` switch reads the same.
  | { readonly kind: 'texture'; readonly dim: '2d' | '2d-array'; readonly elem: TextureElem }
  | { readonly kind: 'texture'; readonly dim: '2d-ms'; readonly elem: 'f32' }
  | { readonly kind: 'sampler' }
  | { readonly kind: 'void' }

// `as const satisfies` keeps each constant's LITERAL type (so KeyOf<typeof f32T>
// resolves to the precise key 'f32' / 'vec2<f32>' …) while still checking it is
// a valid ShaderType — the basis for the compile-time type-safety gate (AC4).
/** The `f32` scalar type, the DSL's default numeric type: what a bare numeric literal lifts to
 *  (`lift(3)` is a `Node<'f32'>`) and what most builtins (`sin`, `mix`, `length`, …) return. Use
 *  it to type an `fn` parameter, a `resource` or uniform field, or a struct field that must
 *  hold a native float; for emulated double precision use {@link f64T}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const f32T = { kind: 'scalar', scalar: 'f32' } as const satisfies ShaderType
/** The emulated double-precision scalar type. It is a logical `f64`, since no GPU has one: a
 *  value typed `f64T` is an unevaluated pair of f32 values, a high part and a low part holding
 *  the residual the high part could not represent, and a pass that runs before emit rewrites
 *  every operation on it into arithmetic on that pair. The pair carries about 48 significand
 *  bits at f32's exponent range, against f32's 24, so it costs one f32 pair per value and no
 *  real 64-bit register.
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
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, module, uniformStruct, sqrt, toF32, f64T, f32T } from '@xgis/shader-dsl'
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
export const f64T = { kind: 'f64' } as const satisfies ShaderType
/** A 2-component emulated-double vector, logically `vec2<f64>`. Before emit it is rewritten
 *  into a struct of two `vec2<f32>` planes, `hi` and `lo`, and componentwise arithmetic runs on
 *  the whole planes at once. The usual carrier for a position in world units that must
 *  survive far more than f32's roughly 7 significant digits; see {@link f64T} for what is
 *  emulated and what it costs.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec2f64T = { kind: 'vec64', n: 2 } as const satisfies ShaderType
/** A 3-component emulated-double vector; see {@link vec2f64T} for how it is emitted and when
 *  to prefer the emulated-double family over plain {@link vec3fT}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec3f64T = { kind: 'vec64', n: 3 } as const satisfies ShaderType
/** A 4-component emulated-double vector; see {@link vec2f64T} for how it is emitted and when
 *  to prefer the emulated-double family over plain {@link vec4fT}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec4f64T = { kind: 'vec64', n: 4 } as const satisfies ShaderType
/** The `i32` scalar type, the DSL's signed-integer type: the result type of the {@link i32}
 *  cast, and the type a non-integer {@link matchExpr} scrutinee is cast to before emit, since
 *  WGSL's `switch` only accepts integer scrutinees. Use it for signed-integer `fn` parameters
 *  and fields; for an unsigned count or index, prefer {@link u32T}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const i32T = { kind: 'scalar', scalar: 'i32' } as const satisfies ShaderType
/** The `u32` scalar type, the DSL's unsigned-integer type: counts, indices, and the compute and
 *  vertex builtins that are unsigned by spec (`builtin('vertex_index', u32T)`; the vector form
 *  is `builtin('global_invocation_id', vec3uT)`). Prefer it to {@link i32T} whenever the value
 *  can never be negative; the type then documents the invariant.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const u32T = { kind: 'scalar', scalar: 'u32' } as const satisfies ShaderType
/** The `bool` scalar type: the type of every comparison (`.lt`, `.eq`, …) and logical (`.and`,
 *  `.or`) result, the required return type of a boolean-returning `fn`, and the type an
 *  {@link If} condition is checked against when the authoring code runs.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const boolT = { kind: 'scalar', scalar: 'bool' } as const satisfies ShaderType
/** A native `vec2<f32>`, the most common vector type in the DSL: screen and UV coordinates and
 *  2D positions, such as a `uv: location(0, vec2fT)` fragment-input field or a
 *  `resolution: vec2fT` uniform. Build a value with the {@link vec2} constructor; use
 *  {@link vec2f64T} instead when the value needs more precision than f32 offers.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec2fT = { kind: 'vec', n: 2, elem: 'f32' } as const satisfies ShaderType
/** A native `vec3<f32>`, the usual carrier for a world-space position or direction, such as
 *  the `p: vec3fT` parameter of a signed-distance scene function.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec3fT = { kind: 'vec', n: 3, elem: 'f32' } as const satisfies ShaderType
/** A native `vec4<f32>`: an RGBA colour or a homogeneous clip-space position. Types the
 *  `pos: builtin('position', vec4fT)` vertex-output field, a `location(0, vec4fT)`
 *  fragment-output field, and any RGBA uniform field.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec4fT = { kind: 'vec', n: 4, elem: 'f32' } as const satisfies ShaderType
/** A native `vec2<u32>`, a 2-wide unsigned-integer field, such as a packed pick-ID varying
 *  declared `location(1, vec2uT, 'flat')`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec2uT = { kind: 'vec', n: 2, elem: 'u32' } as const satisfies ShaderType
/** A native `vec3<u32>`, chiefly the type of the compute `global_invocation_id` builtin
 *  (`builtin('global_invocation_id', vec3uT)`).
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec3uT = { kind: 'vec', n: 3, elem: 'u32' } as const satisfies ShaderType
/** A native `vec4<u32>`, a 4-wide unsigned-integer resource or uniform field, such as the
 *  parameter block of a compute kernel (`resource('params', vec4uT, { … })`).
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec4uT = { kind: 'vec', n: 4, elem: 'u32' } as const satisfies ShaderType
/** A native `vec2<i32>`. Build a value with the {@link vec2i} constructor, for example a texel
 *  coordinate for {@link textureLoad}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec2iT = { kind: 'vec', n: 2, elem: 'i32' } as const satisfies ShaderType
/** A native `vec4<i32>`, completing the signed-integer vector family alongside {@link vec2iT}.
 *  Use it to type an `fn` parameter, `resource` or struct field declared as `vec4<i32>`; build
 *  a value with `construct(vec4iT, [...])` or read one with `.at()` against this type.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const vec4iT = { kind: 'vec', n: 4, elem: 'i32' } as const satisfies ShaderType
/** A native `mat4x4<f32>`, the model-view-projection or view matrix type of a typical
 *  per-frame uniform (`mvp: mat4x4fT`). It is the only native float matrix size with a named
 *  constant: a 2×2 or 3×3 float matrix lays out differently under the WGSL and GLSL std140
 *  rules and is rejected.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const mat4x4fT = { kind: 'mat', n: 4, elem: 'f32' } as const satisfies ShaderType
/** A 2×2 emulated-double matrix, logically `mat2x2<f64>`. Before emit it is rewritten into a
 *  struct of two {@link vec2f64T} columns, and {@link mulMat64}, {@link transformMat64} and
 *  {@link transpose64} on it compose the scalar double-double error-free transforms the same
 *  way `length` and `dot` on {@link vec2f64T} do.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const mat2f64T = { kind: 'mat', n: 2, elem: 'f64' } as const satisfies ShaderType
/** A 3×3 emulated-double matrix; see {@link mat2f64T} for how it is emitted and the matrix
 *  operations available on it.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const mat3f64T = { kind: 'mat', n: 3, elem: 'f64' } as const satisfies ShaderType
/** A 4×4 emulated-double matrix; see {@link mat2f64T} for how it is emitted and the matrix
 *  operations available on it.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const mat4f64T = { kind: 'mat', n: 4, elem: 'f64' } as const satisfies ShaderType
/** A sampled 2D float texture (WGSL `texture_2d<f32>`, GLSL ES 3.00 `sampler2D`): the ordinary
 *  single-layer binding type behind {@link textureSample} and {@link textureLoad}, for colour
 *  ramps, lookup tables and atlases (`resource('atlas_tex', texture2dfT, { … })`). For exact
 *  integer texels use {@link texture2duT} or {@link texture2diT}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2dfT = { kind: 'texture', dim: '2d', elem: 'f32' } as const satisfies ShaderType
/** A multisampled 2D texture (WGSL `texture_multisampled_2d<f32>`, GLSL `sampler2DMS`): the
 *  resolve-source binding for an MSAA render target, read one sample at a time with
 *  `textureLoad(tex, coord, sampleIndex)` inside a per-sample averaging loop. A host that
 *  chooses the type at emit time (`sampleCount > 1 ? texture2dMsfT : texture2dfT`) can serve
 *  both the MSAA and the single-sample path from one shader source.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2dMsfT = {
  kind: 'texture',
  dim: '2d-ms',
  elem: 'f32',
} as const satisfies ShaderType
/** A sampled 2D array texture (WGSL `texture_2d_array<f32>`, GLSL ES 3.00 `sampler2DArray`):
 *  one texture object with N independently addressable layers (a tile atlas, a glyph page
 *  set, a stack of lookup tables). The layer is an argument of each sample call, so N layers
 *  cost one binding slot and one bind-group switch. Core in both targets, so it needs no
 *  {@link Capability}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2dArrayfT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'f32',
} as const satisfies ShaderType
/** An unsigned-integer 2D texture (WGSL `texture_2d<u32>`, GLSL ES 3.00 `usampler2D`). Read it
 *  with {@link textureLoad}, which returns a `vec4<u32>`. It carries exact 32-bit values, which
 *  makes it the right backing for an id, packed-colour or bitfield lookup that must reach the
 *  GPU unchanged. It is unfilterable: {@link textureSample} on it is a `tsc` error (see
 *  {@link TextureElem}).
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2duT = { kind: 'texture', dim: '2d', elem: 'u32' } as const satisfies ShaderType
/** A signed-integer 2D texture (WGSL `texture_2d<i32>`, GLSL ES 3.00 `isampler2D`): the signed
 *  twin of {@link texture2duT}, with the same load-only contract.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2diT = { kind: 'texture', dim: '2d', elem: 'i32' } as const satisfies ShaderType
/** An unsigned-integer 2D array texture (WGSL `texture_2d_array<u32>`, GLSL ES 3.00
 *  `usampler2DArray`): {@link texture2dArrayfT}'s layer model with {@link texture2duT}'s exact
 *  integer texels.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2dArrayuT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'u32',
} as const satisfies ShaderType
/** A signed-integer 2D array texture (WGSL `texture_2d_array<i32>`, GLSL ES 3.00
 *  `isampler2DArray`): the signed twin of {@link texture2dArrayuT}.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const texture2dArrayiT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'i32',
} as const satisfies ShaderType
/** The sampler resource type (WGSL `sampler`; in GLSL, the sampler half of the combined
 *  texture-sampler). Always declared as its own `resource()` binding next to a texture type
 *  ({@link texture2dfT} and its siblings); {@link textureSample} and {@link textureSampleLevel}
 *  take both. For example, `resource('atlas_sampler', samplerT, { group: 0, binding: 1 })`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const samplerT = { kind: 'sampler' } as const satisfies ShaderType
/** The absent-value type: the return type of an `fn` whose body never returns a value (a
 *  statement-only vertex mutator, a compute entry point). Return-type inference falls back to
 *  it when it finds no `Return` in a body, so you rarely need to write it explicitly.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const voidT = { kind: 'void' } as const satisfies ShaderType
/** Builds the `ShaderType` for a named struct: the type you pass wherever a struct-typed value
 *  is authored (a `b.var(name, structT('VsOut'))` local, an `fn` parameter, an array element
 *  via {@link arrayT}). Two calls with the same `name` compare equal under {@link typeKey} and
 *  {@link typeEq} regardless of identity, since the key is the name string alone; the field
 *  list is never compared here. Prefer the higher-level {@link ioStruct} and
 *  {@link uniformStruct} declarators for new code, which return a typed accessor built on top
 *  of this; call `structT` directly when you already have a {@link StructDecl} and need its
 *  bare `ShaderType`.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param name The struct's declared name; it becomes the type's key, `struct:<name>`.
 *  @returns A `{ kind: 'struct', name }` descriptor whose `name` keeps its literal type.
 *
 *  @example
 *  ```ts
 *  import { structT, typeEq } from '@xgis/shader-dsl'
 *
 *  // Equality is by name only.
 *  typeEq(structT('DF64Vec2'), structT('DF64Vec2')) // true
 *  ```
 */
export const structT = <N extends string>(
  name: N,
): { readonly kind: 'struct'; readonly name: N } => ({
  kind: 'struct',
  name,
})
/** Builds the `ShaderType` for an array. Pass `size` for a fixed-length array (`array<T, N>`);
 *  omit it for a runtime-sized one (`array<T>`). Both `elem` and `size` keep their literal
 *  types so {@link KeyOf} spells the exact `array<…>` key that {@link typeKey} produces.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param elem The element type, itself a literal-typed `ShaderType`.
 *  @param size The fixed element count, or `undefined` for a runtime-sized array.
 *  @returns A `{ kind: 'array', elem, size }` descriptor that keeps both literal types.
 */
export const arrayT = <E extends ShaderType, S extends number | undefined = undefined>(
  elem: E,
  size?: S,
): { readonly kind: 'array'; readonly elem: E; readonly size: S } => ({
  kind: 'array',
  elem,
  size: size as S,
})

// Type-level key of a ShaderType literal — the phantom carried by Node<K>.
/** Turns a `ShaderType` literal into the precise string key that {@link Node} carries as its
 *  compile-time phantom: `KeyOf<typeof vec3fT>` resolves to `'vec3<f32>'`, so a `vec2` and
 *  `vec3` operand mismatch fails `tsc` before the runtime `SD0002` check in {@link typeKey} and
 *  {@link typeEq} would catch it. It narrows only against a `T` that kept its literal shape
 *  (the `as const satisfies ShaderType` constants in this module, or a {@link structT} or
 *  {@link arrayT} result); a widened `ShaderType` collapses to the `string` fallback. Every arm
 *  mirrors one `case` of {@link typeKey}, and a new `ShaderType` variant needs an arm in both.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @typeParam T The `ShaderType` (or a subset of it) to resolve a key for.
 */
export type KeyOf<T> = T extends { kind: 'scalar'; scalar: infer S extends string }
  ? S
  : T extends { kind: 'f64' }
    ? 'f64'
    : T extends { kind: 'vec64'; n: infer N extends number }
      ? `vec${N}<f64>`
      : T extends { kind: 'vec'; n: infer N extends number; elem: infer E extends string }
        ? `vec${N}<${E}>`
        : T extends { kind: 'mat'; n: infer N extends number; elem: infer E extends string }
          ? `mat${N}x${N}<${E}>`
          : // #2456 — struct / array / void arms. typeKey has emitted `struct:Name`,
            // `array<K,N>` and `void` since forever; KeyOf had no arm for any of them, so
            // every struct-typed and array-typed node fell through to the `string` fallback
            // — the phantom key that swallowed `construct`, `arrayLit` and both struct
            // declarators' `.construct` (D4.1 in docs/plans/2026-09-01-…).
            T extends { kind: 'struct'; name: infer N extends string }
            ? `struct:${N}`
            : T extends { kind: 'array'; elem: infer E; size: infer S }
              ? S extends number
                ? `array<${KeyOf<E>},${S}>`
                : `array<${KeyOf<E>}>`
              : T extends { kind: 'void' }
                ? 'void'
                : // #763 X6 — texture/sampler arms (spellings match typeKey()): resource()
                  // promised a SPECIFIC key (`Node<'texture_2d<f32>'>`) but these fell through
                  // to `string`, so a texture/sampler argument swap type-checked.
                  T extends { kind: 'texture'; dim: '2d-ms' }
                  ? 'texture_multisampled_2d<f32>'
                  : // #1651 — arm ORDER is immaterial here: the dims are exact literals, so
                    // `{ dim: '2d-array' }` never extends `{ dim: '2d' }` regardless of which
                    // arm comes first. The real hazard is a MISSING arm — it drops an array
                    // resource() node through to the `string` fallback, where it matches no
                    // authoring overload at all (the failure is a confusing "no overload
                    // matches", not a key mismatch).
                    // #1703 — `elem` is INFERRED, not hardcoded to f32: a texture2duT resource
                    // must land on `texture_2d<u32>`, and a hardcoded `<f32>` would silently
                    // hand an integer texture the FLOAT key, where textureSample's overload
                    // accepts it and naga rejects the emitted WGSL.
                    T extends { kind: 'texture'; dim: '2d-array'; elem: infer E extends string }
                    ? `texture_2d_array<${E}>`
                    : T extends { kind: 'texture'; dim: '2d'; elem: infer E extends string }
                      ? `texture_2d<${E}>`
                      : T extends { kind: 'sampler' }
                        ? 'sampler'
                        : string
/** Element key of a vector key (`vec3<u32>` → `u32`); identity for scalars. */
export type ElemKey<K extends string> = K extends `vec${number}<${infer E}>` ? E : K
/** The key form of {@link Scalar} without `'bool'`: the set accepted wherever the DSL needs an
 *  indexable or comparable native scalar, such as array indices (`.at(i, elem)`), bitwise-op
 *  operands, and {@link matchExpr} or {@link Switch} scrutinees. `'f64'` and `'bool'` are
 *  excluded because a `Switch` scrutinee must become a WGSL `switch`, which only accepts
 *  integer cases, and an array index or bit-op operand is never boolean.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export type ScalarKey = 'f32' | 'i32' | 'u32'

/** The runtime twin of {@link KeyOf}: turns any `ShaderType` value, literal or widened, into
 *  its canonical string key (`'vec3<f32>'`, `'mat4x4<f32>'`, `'texture_2d_array<f32>'`, …).
 *  Error messages use it (`SD0002`, `SD0004`: "expected vec3<f32>, got vec4<f32>"), and
 *  {@link typeEq} compares two types by it. Every `case` mirrors one arm of `KeyOf`; if they
 *  disagree, a value type-checks at author time but throws a spurious mismatch when the
 *  authoring code runs, or the reverse.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param t The type to spell.
 *  @returns The canonical key string.
 *
 *  @example
 *  ```ts
 *  import { typeKey, vec3fT, texture2dArrayfT } from '@xgis/shader-dsl'
 *
 *  typeKey(vec3fT) // 'vec3<f32>'
 *  typeKey(texture2dArrayfT) // 'texture_2d_array<f32>'
 *  ```
 */
export function typeKey(t: ShaderType): string {
  switch (t.kind) {
    case 'scalar':
      return t.scalar
    case 'f64':
      return 'f64'
    case 'vec64':
      return `vec${t.n}<f64>`
    case 'vec':
      return `vec${t.n}<${t.elem}>`
    case 'mat':
      return `mat${t.n}x${t.n}<${t.elem}>`
    case 'struct':
      return `struct:${t.name}`
    case 'array':
      return t.size !== undefined
        ? `array<${typeKey(t.elem)},${t.size}>`
        : `array<${typeKey(t.elem)}>`
    case 'texture':
      // Every dim is spelled EXPLICITLY — a `texture_${t.dim}<…>` template would emit
      // the invalid `texture_2d-array<f32>` for the array arm (and '2d-ms' already
      // needed its own spelling). Must stay byte-identical to KeyOf's arms above.
      // Exhaustive switch: a NEW dim fails compilation here instead of silently
      // falling open to the 2d spelling.
      switch (t.dim) {
        case '2d-ms':
          return `texture_multisampled_2d<${t.elem}>`
        case '2d-array':
          return `texture_2d_array<${t.elem}>`
        case '2d':
          return `texture_2d<${t.elem}>`
        default:
          // Exhaustiveness on the whole ARM, not on `t.dim` (#1703): the texture type
          // is now a two-arm union, so once every dim is handled `t` itself is `never`
          // and `t.dim` no longer exists to check. A new dim (or a new arm) still
          // fails compilation right here.
          return t satisfies never
      }
    case 'sampler':
      return 'sampler'
    case 'void':
      return 'void'
  }
}

/** Structural equality for `ShaderType`: two types are equal when their {@link typeKey} strings
 *  match, so a constant like `boolT` compares equal to a freshly built `{ kind: 'scalar',
 *  scalar: 'bool' }` object even though they are different references. This is the check every
 *  binary-op, assignment and `fn`-argument type gate runs before raising `SD0002` ("type
 *  mismatch"). Compare two `ShaderType`s with this function: `===` compares references, and a
 *  deep equal is slower for the same answer.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param a The first type.
 *  @param b The second type.
 *  @returns `true` when both spell the same key.
 *
 *  @example
 *  ```ts
 *  import { typeEq, boolT } from '@xgis/shader-dsl'
 *
 *  typeEq(boolT, { kind: 'scalar', scalar: 'bool' }) // true: same key, different object
 *  ```
 */
export function typeEq(a: ShaderType, b: ShaderType): boolean {
  return typeKey(a) === typeKey(b)
}

/** Narrows a `ShaderType` to the native `{ kind: 'vec' }` arm, whose `elem` is `'f32' | 'i32' |
 *  'u32'`. The emulated-double vector is the separate `'vec64'` kind; test for it with
 *  {@link isVec64}. Binary-op type resolution uses it (`isMat(a) && isVec(b)`, `isVec(a) &&
 *  isScalar(b)`) to decide between a vector-scalar broadcast, a matrix-vector product and a
 *  same-kind op, and the `.x`/`.y`/`.r`/`.g` swizzle guards use it to reject a non-vector
 *  receiver.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isVec, vec3fT, f32T } from '@xgis/shader-dsl'
 *
 *  isVec(vec3fT) // true
 *  isVec(f32T) // false
 *  ```
 */
export const isVec = (t: ShaderType): t is Extract<ShaderType, { kind: 'vec' }> => t.kind === 'vec'
/** Narrows a `ShaderType` to the native `{ kind: 'scalar' }` arm (`f32`, `i32`, `u32`, `bool`).
 *  It is `false` for {@link f64T}, which is its own kind so that this predicate does not treat
 *  it as a scalar. Arithmetic type resolution uses it to detect the vector-scalar broadcast
 *  case (`isVec(a) && isScalar(b)` and its mirror), where the vector operand's type is the
 *  result.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isScalar, f32T, f64T } from '@xgis/shader-dsl'
 *
 *  isScalar(f32T) // true
 *  isScalar(f64T) // false: f64 is its own ShaderType kind
 *  ```
 */
export const isScalar = (t: ShaderType): t is Extract<ShaderType, { kind: 'scalar' }> =>
  t.kind === 'scalar'
/** Narrows a `ShaderType` to the `{ kind: 'mat' }` arm. It matches both `elem: 'f32'` (native
 *  `matNxN<f32>`) and `elem: 'f64'` (emulated, emitted as a struct of double-double columns);
 *  use {@link isMat64} when the distinction matters. Binary-op type resolution checks it before
 *  a matrix-vector or matrix-matrix product.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isMat, mat4x4fT, mat2f64T } from '@xgis/shader-dsl'
 *
 *  isMat(mat4x4fT) // true
 *  isMat(mat2f64T) // also true; use isMat64 to tell them apart
 *  ```
 */
export const isMat = (t: ShaderType): t is Extract<ShaderType, { kind: 'mat' }> => t.kind === 'mat'
/** Narrows a `ShaderType` to an emulated-double matrix (`matNxN<f64>`, see {@link mat2f64T}),
 *  which is emitted as a struct of double-double columns.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 */
export const isMat64 = (
  t: ShaderType,
): t is Extract<ShaderType, { kind: 'mat' }> & { elem: 'f64' } =>
  t.kind === 'mat' && t.elem === 'f64'
/** Narrows a `ShaderType` to the emulated-double scalar arm ({@link f64T}). Arithmetic type
 *  resolution checks it first, before native scalar promotion, so an `f64` operand always wins
 *  the result type over a plain `f32` or number. Mixing `f64` with an `i32`, `u32` or `bool`
 *  operand throws `SD0004`, since emulated double precision only widens from f32 and number.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isF64, f64T, f32T } from '@xgis/shader-dsl'
 *
 *  isF64(f64T) // true
 *  isF64(f32T) // false
 *  ```
 */
export const isF64 = (t: ShaderType): t is Extract<ShaderType, { kind: 'f64' }> => t.kind === 'f64'
/** Narrows a `ShaderType` to the emulated-double vector arm ({@link vec2f64T} and its 3- and
 *  4-wide siblings). It is distinct from {@link isVec}, which matches only the native `vec` kind
 *  and is `false` for an emulated-double vector. Component access (`.comp()` and swizzles)
 *  accepts either `isVec(t) || isVec64(t)`, since both kinds support it, each through its own
 *  emitted form.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isVec64, vec2f64T, vec2fT } from '@xgis/shader-dsl'
 *
 *  isVec64(vec2f64T) // true
 *  isVec64(vec2fT) // false: a native vec, use isVec for that
 *  ```
 */
export const isVec64 = (t: ShaderType): t is Extract<ShaderType, { kind: 'vec64' }> =>
  t.kind === 'vec64'
