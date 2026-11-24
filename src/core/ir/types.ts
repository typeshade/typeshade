import type { ShaderType } from './types/shader-type.js';
export { f32T, i32T, u32T, boolT, atomicU32T, atomicI32T, voidT } from './types/scalar-types.js';
export type { KeyOf, ElemKey, ArrayElemKey, ScalarKey } from './types/key-of.js';
export { isVec, isScalar, isMat, isMat64, isF64, isVec64 } from './types/predicates.js';
export { CAS_RESULT_STRUCTS, casResultT } from './types/cas-result.js';
export type { Scalar, ShaderType } from './types/shader-type.js';
export {
  ALL_STORAGE_TEXTURE_FORMATS,
  READ_WRITE_STORAGE_FORMATS,
  WRITE_ONLY_STORAGE_FORMATS,
  storageFormatFeature,
  storageTexel,
  storageTextureLayoutAccess,
} from './types/storage-texture.js';
export type {
  TextureElem,
  StorageTextureFormat,
  StorageTextureAccess,
} from './types/storage-texture.js';
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
/** A native `vec2<f32>`, the most common vector type in the DSL: screen and UV coordinates and
 *  2D positions, such as a `uv: location(0, vec2fT)` fragment-input field or a
 *  `resolution: vec2fT` uniform. Build a value with the {@link vec2} constructor; use
 *  {@link vec2f64T} instead when the value needs more precision than f32 offers.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec2fT = { kind: 'vec', n: 2, elem: 'f32' } as const satisfies ShaderType;
/** A native `vec3<f32>`, the usual carrier for a world-space position or direction, such as
 *  the `p: vec3fT` parameter of a signed-distance scene function.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec3fT = { kind: 'vec', n: 3, elem: 'f32' } as const satisfies ShaderType;
/** A native `vec4<f32>`: an RGBA colour or a homogeneous clip-space position. Types the
 *  `pos: builtin('position', vec4fT)` vertex-output field, a `location(0, vec4fT)`
 *  fragment-output field, and any RGBA uniform field.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec4fT = { kind: 'vec', n: 4, elem: 'f32' } as const satisfies ShaderType;
/** A native `vec2<u32>`, a 2-wide unsigned-integer field, such as a packed pick-ID varying
 *  declared `location(1, vec2uT, 'flat')`.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec2uT = { kind: 'vec', n: 2, elem: 'u32' } as const satisfies ShaderType;
/** A native `vec3<u32>`, chiefly the type of the compute `global_invocation_id` builtin
 *  (`builtin('global_invocation_id', vec3uT)`).
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec3uT = { kind: 'vec', n: 3, elem: 'u32' } as const satisfies ShaderType;
/** A native `vec4<u32>`, a 4-wide unsigned-integer resource or uniform field, such as the
 *  parameter block of a compute kernel (`resource('params', vec4uT, { … })`).
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec4uT = { kind: 'vec', n: 4, elem: 'u32' } as const satisfies ShaderType;

/** `vec2<bool>`: what a comparison of two `vec2` values yields, componentwise (roadmap 0.2
 *  item 7). `any`, `all` and a componentwise `select` take it. Not host-shareable. */
export const vec2bT = { kind: 'vec', n: 2, elem: 'bool' } as const satisfies ShaderType;
/** `vec3<bool>`: the componentwise comparison of two three-component vectors. */
export const vec3bT = { kind: 'vec', n: 3, elem: 'bool' } as const satisfies ShaderType;
/** `vec4<bool>`: the componentwise comparison of two four-component vectors. */
export const vec4bT = { kind: 'vec', n: 4, elem: 'bool' } as const satisfies ShaderType;
/** A native `vec2<i32>`. Build a value with the {@link vec2i} constructor, for example a texel
 *  coordinate for {@link textureLoad}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec2iT = { kind: 'vec', n: 2, elem: 'i32' } as const satisfies ShaderType;
/** A native `vec3<i32>`, the signed-integer counterpart of {@link vec3uT} — a texel coordinate
 *  into an array texture, a signed grid cell. Build a value with the {@link vec3i} constructor.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec3iT = { kind: 'vec', n: 3, elem: 'i32' } as const satisfies ShaderType;
/** A native `vec4<i32>`, completing the signed-integer vector family alongside {@link vec2iT}.
 *  Use it to type an `fn` parameter, `resource` or struct field declared as `vec4<i32>`; build
 *  a value with `construct(vec4iT, [...])` or read one with `.at()` against this type.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const vec4iT = { kind: 'vec', n: 4, elem: 'i32' } as const satisfies ShaderType;
/** A native `mat4x4<f32>`, the model-view-projection or view matrix type of a typical
 *  per-frame uniform (`mvp: mat4x4fT`). Every `matCxR<f32>` is spellable — build one with
 *  {@link matT} — and this is the one with a named constant because it is the one a renderer
 *  reaches for. (It was once the ONLY float matrix, on the recorded ground that "a 2×2 or 3×3
 *  float matrix lays out differently under the WGSL and GLSL std140 rules". Measured on real
 *  ANGLE and Tint, that is half right: a 2×2 does diverge and a 3×3 does not, and what
 *  actually decides is the ROW count — see the `mat` arm of {@link ShaderType} and
 *  `wgslLayout`.)
 *
 *  Exported from `typeshade/core/ir`.
 */
export const mat4x4fT = {
  kind: 'mat',
  cols: 4,
  rows: 4,
  elem: 'f32',
} as const satisfies ShaderType;
/** Any `matCxR<f32>` or `matCxR<f64>`: `cols` columns of `rows` components each, column-major
 *  as both targets are. The named constants above are the shapes with a spelling of their own;
 *  this is how the front end and a host build the other six.
 *
 *  Exported from `typeshade/core/ir`.
 *
 *  @param cols Number of columns — the `C` of `matCxR`.
 *  @param rows Number of rows — the `R` of `matCxR`, and the component count of one column.
 *  @param elem `'f32'` for a native matrix, `'f64'` for the emulated-double one (square only).
 *
 *  @example
 *  ```ts
 *  import { typeKey } from 'typeshade'
 *  import { matT } from 'typeshade/core/ir'
 *
 *  typeKey(matT(2, 3)) // 'mat2x3<f32>'
 *  ```
 */
export const matT = (
  cols: 2 | 3 | 4,
  rows: 2 | 3 | 4,
  elem: 'f32' | 'f64' = 'f32',
): Extract<ShaderType, { kind: 'mat' }> => ({ kind: 'mat', cols, rows, elem });
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
/** A sampled 2D float texture (WGSL `texture_2d<f32>`, GLSL ES 3.00 `sampler2D`): the ordinary
 *  single-layer binding type behind {@link textureSample} and {@link textureLoad}, for colour
 *  ramps, lookup tables and atlases (`resource('atlas_tex', texture2dfT, { … })`). For exact
 *  integer texels use {@link texture2duT} or {@link texture2diT}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2dfT = {
  kind: 'texture',
  dim: '2d',
  elem: 'f32',
} as const satisfies ShaderType;
/** A multisampled 2D texture (WGSL `texture_multisampled_2d<f32>`, GLSL `sampler2DMS`): the
 *  resolve-source binding for an MSAA render target, read one sample at a time with
 *  `textureLoad(tex, coord, sampleIndex)` inside a per-sample averaging loop. A host that
 *  chooses the type at emit time (`sampleCount > 1 ? texture2dMsfT : texture2dfT`) can serve
 *  both the MSAA and the single-sample path from one shader source.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2dMsfT = {
  kind: 'texture',
  dim: '2d-ms',
  elem: 'f32',
} as const satisfies ShaderType;
/** A sampled 2D array texture (WGSL `texture_2d_array<f32>`, GLSL ES 3.00 `sampler2DArray`):
 *  one texture object with N independently addressable layers (a tile atlas, a glyph page
 *  set, a stack of lookup tables). The layer is an argument of each sample call, so N layers
 *  cost one binding slot and one bind-group switch. Core in both targets, so it needs no
 *  {@link Capability}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2dArrayfT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'f32',
} as const satisfies ShaderType;
/** An unsigned-integer 2D texture (WGSL `texture_2d<u32>`, GLSL ES 3.00 `usampler2D`). Read it
 *  with {@link textureLoad}, which returns a `vec4<u32>`. It carries exact 32-bit values, which
 *  makes it the right backing for an id, packed-colour or bitfield lookup that must reach the
 *  GPU unchanged. It is unfilterable: {@link textureSample} on it is a `tsc` error (see
 *  {@link TextureElem}).
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2duT = {
  kind: 'texture',
  dim: '2d',
  elem: 'u32',
} as const satisfies ShaderType;
/** A signed-integer 2D texture (WGSL `texture_2d<i32>`, GLSL ES 3.00 `isampler2D`): the signed
 *  twin of {@link texture2duT}, with the same load-only contract.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2diT = {
  kind: 'texture',
  dim: '2d',
  elem: 'i32',
} as const satisfies ShaderType;
/** An unsigned-integer 2D array texture (WGSL `texture_2d_array<u32>`, GLSL ES 3.00
 *  `usampler2DArray`): {@link texture2dArrayfT}'s layer model with {@link texture2duT}'s exact
 *  integer texels.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2dArrayuT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'u32',
} as const satisfies ShaderType;
/** A signed-integer 2D array texture (WGSL `texture_2d_array<i32>`, GLSL ES 3.00
 *  `isampler2DArray`): the signed twin of {@link texture2dArrayuT}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture2dArrayiT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'i32',
} as const satisfies ShaderType;
/** The sampler resource type (WGSL `sampler`; in GLSL, the sampler half of the combined
 *  texture-sampler). Always declared as its own `resource()` binding next to a texture type
 *  ({@link texture2dfT} and its siblings); {@link textureSample} and {@link textureSampleLevel}
 *  take both. For example, `resource('atlas_sampler', samplerT, { group: 0, binding: 1 })`.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const samplerT = { kind: 'sampler' } as const satisfies ShaderType;

/** The comparison sampler `textureSampleCompare` takes (roadmap 0.4 item 11): it compares a
 *  reference value against the texel and yields how much of the filter footprint passed, rather
 *  than the texel itself. Not interchangeable with {@link samplerT} in either direction.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const samplerComparisonT = { kind: 'sampler-comparison' } as const satisfies ShaderType;

/** A 2D depth texture — the texture a shadow map is (roadmap 0.4 item 11). Single-channel
 *  float with no element type of its own, and a read of one yields `f32`, not `vec4`.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureDepth2dT = { kind: 'depth-texture', dim: '2d' } as const satisfies ShaderType;

/** An array of 2D depth textures, the shape a cascaded shadow map takes (roadmap 0.4 item 11).
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureDepth2dArrayT = {
  kind: 'depth-texture',
  dim: '2d-array',
} as const satisfies ShaderType;
/** A cube depth texture (WGSL `texture_depth_cube`, GLSL ES 3.00 `samplerCubeShadow`): the
 *  shadow map of a point light, compared by the direction from the light (roadmap 0.4 item 12).
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureDepthCubeT = {
  kind: 'depth-texture',
  dim: 'cube',
} as const satisfies ShaderType;
/** A sampled float cube texture (WGSL `texture_cube<f32>`, GLSL ES 3.00 `samplerCube`): six
 *  faces looked up by a `vec3` DIRECTION rather than a coordinate, the shape an environment map
 *  or a skybox takes (roadmap 0.4 item 12). Core in both targets, so it needs no
 *  {@link Capability}. A cube is only ever sampled: neither target has a texel fetch for one.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureCubefT = {
  kind: 'texture',
  dim: 'cube',
  elem: 'f32',
} as const satisfies ShaderType;
/** A sampled float 3D texture (WGSL `texture_3d<f32>`, GLSL ES 3.00 `sampler3D`): a volume
 *  addressed by a `vec3` coordinate, the shape a colour-grading lookup table or a density field
 *  takes (roadmap 0.4 item 12). Core in both targets, so it needs no {@link Capability}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture3dfT = {
  kind: 'texture',
  dim: '3d',
  elem: 'f32',
} as const satisfies ShaderType;
/** A sampled float 1D texture (WGSL `texture_1d<f32>`): a row of texels addressed by one `f32`,
 *  the shape a transfer function or a colour ramp takes (roadmap 0.4 item 12). WebGPU only:
 *  the GLSL lowering of a 1d texture is not supported yet (Rule 10.5), so a module carrying one
 *  needs the `texture1d` {@link Capability}, which the GLSL backend has no row for.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const texture1dfT = {
  kind: 'texture',
  dim: '1d',
  elem: 'f32',
} as const satisfies ShaderType;
/** An array of float cube textures (WGSL `texture_cube_array<f32>`): N environment maps in one
 *  binding, looked up by a `vec3` direction and a layer (roadmap 0.4 item 12). WebGPU only: the
 *  GLSL lowering of a cube array is not supported yet (Rule 10.5), so a module carrying one
 *  needs the `textureCubeArray` {@link Capability}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureCubeArrayfT = {
  kind: 'texture',
  dim: 'cube-array',
  elem: 'f32',
} as const satisfies ShaderType;
/** An array of cube depth textures (WGSL `texture_depth_cube_array`): the shadow maps of N point
 *  lights in one binding (roadmap 0.4 item 12). WebGPU only, like {@link textureCubeArrayfT}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureDepthCubeArrayT = {
  kind: 'depth-texture',
  dim: 'cube-array',
} as const satisfies ShaderType;
/** A multisampled depth texture (WGSL `texture_depth_multisampled_2d`): the depth attachment of
 *  an MSAA render target, read one sample at a time with `textureLoad(t, coords, sampleIndex)`
 *  and never sampled or compared (roadmap 0.4 item 13). WebGPU only, under `msaaTextureLoad`:
 *  the GLSL lowering of a multisampled texture is not supported yet (Rule 10.5).
 *
 *  Exported from `typeshade/core/ir`.
 */
export const textureDepthMultisampled2dT = {
  kind: 'depth-texture',
  dim: '2d-ms',
} as const satisfies ShaderType;
/** Builds the `ShaderType` for a named struct: the type you pass wherever a struct-typed value
 *  is authored (a `b.var(name, structT('VsOut'))` local, an `fn` parameter, an array element
 *  via {@link arrayT}). Two calls with the same `name` compare equal under {@link typeKey} and
 *  {@link typeEq} regardless of identity, since the key is the name string alone; the field
 *  list is never compared here. Prefer the higher-level {@link ioStruct} and
 *  {@link uniformStruct} declarators for new code, which return a typed accessor built on top
 *  of this; call `structT` directly when you already have a {@link StructDecl} and need its
 *  bare `ShaderType`.
 *
 *  Exported from `typeshade/core/ir`.
 *
 *  @param name The struct's declared name; it becomes the type's key, `struct:<name>`.
 *  @returns A `{ kind: 'struct', name }` descriptor whose `name` keeps its literal type.
 *
 *  @example
 *  ```ts
 *  import { typeEq } from 'typeshade'
 *  import { structT } from 'typeshade/core/ir'
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
});
/** Builds the `ShaderType` for an array. Pass `size` for a fixed-length array (`array<T, N>`);
 *  omit it for a runtime-sized one (`array<T>`). Both `elem` and `size` keep their literal
 *  types so {@link KeyOf} spells the exact `array<…>` key that {@link typeKey} produces.
 *
 *  Exported from `typeshade/core/ir`.
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
});

/** The runtime twin of {@link KeyOf}: turns any `ShaderType` value, literal or widened, into
 *  its canonical string key (`'vec3<f32>'`, `'mat4x4<f32>'`, `'texture_2d_array<f32>'`, …).
 *  Error messages use it (`SD0002`, `SD0004`: "expected vec3<f32>, got vec4<f32>"), and
 *  {@link typeEq} compares two types by it. Every `case` mirrors one arm of `KeyOf`; if they
 *  disagree, a value type-checks at author time but throws a spurious mismatch when the
 *  authoring code runs, or the reverse.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @param t The type to spell.
 *  @returns The canonical key string.
 *
 *  @example
 *  ```ts
 *  import { typeKey } from 'typeshade'
 *  import { vec3fT, texture2dArrayfT } from 'typeshade/core/ir'
 *
 *  typeKey(vec3fT) // 'vec3<f32>'
 *  typeKey(texture2dArrayfT) // 'texture_2d_array<f32>'
 *  ```
 */
export function typeKey(t: ShaderType): string {
  switch (t.kind) {
    case 'scalar':
      return t.scalar;
    case 'f64':
      return 'f64';
    case 'vec64':
      return `vec${t.n}<f64>`;
    case 'vec':
      return `vec${t.n}<${t.elem}>`;
    case 'mat':
      return `mat${t.cols}x${t.rows}<${t.elem}>`;
    case 'struct':
      return `struct:${t.name}`;
    case 'array':
      return t.size !== undefined
        ? `array<${typeKey(t.elem)},${t.sizeOverride ?? t.size}>`
        : `array<${typeKey(t.elem)}>`;
    case 'texture':
      switch (t.dim) {
        case '2d-ms':
          return `texture_multisampled_2d<${t.elem}>`;
        case '2d-array':
          return `texture_2d_array<${t.elem}>`;
        case '2d':
          return `texture_2d<${t.elem}>`;
        case 'cube':
          return `texture_cube<${t.elem}>`;
        case '3d':
          return `texture_3d<${t.elem}>`;
        case '1d':
          return `texture_1d<${t.elem}>`;
        case 'cube-array':
          return `texture_cube_array<${t.elem}>`;
        default:
          return t satisfies never;
      }
    case 'storage-texture':
      return t.dim === '2d-array'
        ? `texture_storage_2d_array<${t.format}, ${t.access}>`
        : `texture_storage_2d<${t.format}, ${t.access}>`;
    case 'atomic':
      return `atomic<${t.elem}>`;
    case 'depth-texture':
      switch (t.dim) {
        case '2d':
          return 'texture_depth_2d';
        case '2d-array':
          return 'texture_depth_2d_array';
        case 'cube':
          return 'texture_depth_cube';
        case 'cube-array':
          return 'texture_depth_cube_array';
        case '2d-ms':
          return 'texture_depth_multisampled_2d';
      }
    case 'sampler':
      return 'sampler';
    case 'sampler-comparison':
      return 'sampler_comparison';
    case 'collection':
      return t.value === undefined ? `Set<${t.key}>` : `Map<${t.key},${typeKey(t.value)}>`;
    case 'void':
      return 'void';
  }
}

/** Structural equality for `ShaderType`: two types are equal when their {@link typeKey} strings
 *  match, so a constant like `boolT` compares equal to a freshly built `{ kind: 'scalar',
 *  scalar: 'bool' }` object even though they are different references. This is the check every
 *  binary-op, assignment and `fn`-argument type gate runs before raising `SD0002` ("type
 *  mismatch"). Compare two `ShaderType`s with this function: `===` compares references, and a
 *  deep equal is slower for the same answer.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @param a The first type.
 *  @param b The second type.
 *  @returns `true` when both spell the same key.
 *
 *  @example
 *  ```ts
 *  import { typeEq } from 'typeshade'
 *  import { boolT } from 'typeshade/core/ir'
 *
 *  typeEq(boolT, { kind: 'scalar', scalar: 'bool' }) // true: same key, different object
 *  ```
 */
export function typeEq(a: ShaderType, b: ShaderType): boolean {
  return typeKey(a) === typeKey(b);
}
