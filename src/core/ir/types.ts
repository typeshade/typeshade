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
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type TextureElem = 'f32' | 'u32' | 'i32'

/** The texel formats a storage texture may carry, which is WebGPU's set of formats every device
 *  supports with `STORAGE_BINDING` and no optional feature (roadmap 0.4 item 10).
 *
 *  Measured rather than read off a spec: a real device was asked to build a bind group layout
 *  for each format at each access mode, and these sixteen are the ones a device with NOTHING
 *  requested took. The tiered texture-format formats (`r8unorm`, `rg8unorm`, `rgb10a2unorm`,
 *  `rg16float` and their siblings) are not here: a module naming one compiles on Tint and then
 *  fails at `createBindGroupLayout`, which is a wrong program emitted without a diagnostic.
 *
 *  `bgra8unorm` IS here, as the seventeenth and the only one that is not core (#147). It is
 *  measured too, on two independent Chromium builds: a device with no feature requested refuses
 *  it ("Texture format TextureFormat::BGRA8Unorm does not support storage texture access
 *  StorageTextureAccess::WriteOnly"), a device that requested `bgra8unorm-storage` takes it at
 *  `write`, and BOTH refuse it at `read` and `read_write`. Tint accepts every one of those
 *  spellings, so the compile gate cannot see the difference and a capability is what carries
 *  it: a module using the format needs `bgra8unormStorage`, which `reflect().requiredFeatures`
 *  hands the host as the feature to request. {@link WRITE_ONLY_STORAGE_FORMATS} is the access
 *  half of the same measurement. */
export type StorageTextureFormat =
  | 'rgba8unorm'
  | 'rgba8snorm'
  | 'rgba8uint'
  | 'rgba8sint'
  | 'rgba16uint'
  | 'rgba16sint'
  | 'rgba16float'
  | 'r32uint'
  | 'r32sint'
  | 'r32float'
  | 'rg32uint'
  | 'rg32sint'
  | 'rg32float'
  | 'rgba32uint'
  | 'rgba32sint'
  | 'rgba32float'
  | 'bgra8unorm'

/** Every {@link StorageTextureFormat}, as a runtime value: the list a front end validates a
 *  written name against and a doc generator iterates. A union type has no runtime form, so the
 *  list is written out and `satisfies` keeps it in step. */
export const ALL_STORAGE_TEXTURE_FORMATS = [
  'rgba8unorm',
  'rgba8snorm',
  'rgba8uint',
  'rgba8sint',
  'rgba16uint',
  'rgba16sint',
  'rgba16float',
  'r32uint',
  'r32sint',
  'r32float',
  'rg32uint',
  'rg32sint',
  'rg32float',
  'rgba32uint',
  'rgba32sint',
  'rgba32float',
  'bgra8unorm',
] as const satisfies readonly StorageTextureFormat[]

/** How a shader may touch a storage texture. WGSL spells these `write`, `read` and
 *  `read_write`; WebGPU's bind group layout spells the same three `write-only`, `read-only` and
 *  `read-write`, which is what {@link storageTextureLayoutAccess} converts to. */
export type StorageTextureAccess = 'write' | 'read' | 'read_write'

/** The formats a device takes at `read_write` access, which is the three single-channel 32-bit
 *  ones and no others (measured, as {@link StorageTextureFormat} describes). Every other format
 *  is `write` or `read`, one at a time. Tint compiles `texture_storage_2d<rgba8unorm,
 *  read_write>` happily, so this list is the only thing standing between that spelling and a
 *  device error the compile gate never reaches. */
export const READ_WRITE_STORAGE_FORMATS = [
  'r32uint',
  'r32sint',
  'r32float',
] as const satisfies readonly StorageTextureFormat[]

/** The formats a device takes at `write` and at NO other access mode, which today is
 *  `bgra8unorm` alone (#147). Every other {@link StorageTextureFormat} loads as well as stores,
 *  and the three in {@link READ_WRITE_STORAGE_FORMATS} do both through one binding.
 *
 *  Measured, on two Chromium builds with every adapter feature requested: `bgra8unorm` at
 *  `read-only` and at `read-write` is "Texture format TextureFormat::BGRA8Unorm does not
 *  support storage texture access", while `write-only` builds. Tint compiles all three, so this
 *  list is the only thing between the two spellings and a device error no shader compiler
 *  reaches. */
export const WRITE_ONLY_STORAGE_FORMATS = [
  'bgra8unorm',
] as const satisfies readonly StorageTextureFormat[]

/** The device feature a format needs before any device will store to it, or undefined when the
 *  format is core. The name is WebGPU's own, as `GPUAdapter.features` reports it, so a host can
 *  pass it straight to `requestDevice({ requiredFeatures })`. */
export const storageFormatFeature = (format: StorageTextureFormat): string | undefined =>
  format === 'bgra8unorm' ? 'bgra8unorm-storage' : undefined

/** The type of one texel of a storage texture, which its format's channel kind decides: a
 *  `…uint` format loads and stores `vec4<u32>`, a `…sint` format `vec4<i32>`, and every other
 *  one — unorm, snorm and float — `vec4<f32>`. Tint enforces this (`no matching call to
 *  'textureStore(texture_storage_2d<rgba8uint, write>, vec2<i32>, vec4<f32>)'`), so a front end
 *  that checks it first can say the same thing in its own words and name the fix. */
export const storageTexel = (format: StorageTextureFormat): TextureElem =>
  format.endsWith('uint') ? 'u32' : format.endsWith('sint') ? 'i32' : 'f32'

/** What WebGPU's `GPUStorageTextureBindingLayout.access` calls a WGSL access mode. The two
 *  vocabularies differ by a hyphen and a word, and a host passing the WGSL spelling straight
 *  through gets a validation error, so reflection carries the host's spelling. */
export const storageTextureLayoutAccess = (
  access: StorageTextureAccess,
): 'write-only' | 'read-only' | 'read-write' =>
  access === 'write' ? 'write-only' : access === 'read' ? 'read-only' : 'read-write'

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
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
  | { readonly kind: 'vec'; readonly n: 2 | 3 | 4; readonly elem: 'f32' | 'i32' | 'u32' | 'bool' }
  // A matrix. elem 'f32' is native (matNxN<f32>); elem 'f64' is emulated double
  // precision — it lowers to `struct DF64MatN { c0..c(N-1): DF64VecN }` (columns
  // of df64), and matmul / mat·vec / transpose compose the SCALAR df64 EFTs the
  // same way length/dot do. Own elem arm, so every `t.kind === 'mat'` consumer is
  // forced to decide about f64 (verified-by-construction).
  | { readonly kind: 'mat'; readonly n: 2 | 3 | 4; readonly elem: 'f32' | 'f64' }
  | { readonly kind: 'struct'; readonly name: string }
  | { readonly kind: 'array'; readonly elem: ShaderType; readonly size?: number }
  // An atomic integer (roadmap 0.2 item 4): `atomic<u32>` / `atomic<i32>`, a location in
  // storage memory that the `atomic*` builtins read, write and update as one step. Its OWN
  // kind, not a flag on `scalar`, so it never reaches the arithmetic, the constant folder or
  // an assignment: the only things that take one are the atomic builtins, which take it as a
  // location rather than a value.
  | { readonly kind: 'atomic'; readonly elem: 'u32' | 'i32' }
  // A sampled texture. '2d-array' (X-GIS #1651) is CORE in both targets — WGSL
  // texture_2d_array<f32>, GLSL ES 3.00 sampler2DArray — so it needs no Capability
  // (pinned by required-caps.test.ts); '2d-ms' still fails closed on GLSL.
  //
  // '2d-ms' (roadmap 0.4 item 13) carries any TextureElem too: WGSL §6.6.3 parameterises
  // `texture_multisampled_2d` by f32, i32 or u32, and `textureLoad` yields `vec4<T>`. It used
  // to be pinned to f32 in an arm of its own (X-GIS #1703), when nothing read it; the spec is
  // the authority now, and GLSL ES 3.00 fails closed by the `msaaTextureLoad` capability
  // whatever the element, so the pin bought nothing.
  //
  // 'cube' and '3d' (roadmap 0.4 item 12) are core in both targets too — WGSL `texture_cube`
  // and `texture_3d`, GLSL ES 3.00 `samplerCube` and `sampler3D` — so neither needs a
  // Capability. A cube is addressed by a DIRECTION and a 3d texture by a `vec3` coordinate; that
  // width rides on this type, so one neutral read id covers every dim and the front end checks
  // the coordinate against the dim at each call.
  | {
      readonly kind: 'texture'
      readonly dim: '2d' | '2d-array' | 'cube' | '3d' | '1d' | 'cube-array' | '2d-ms'
      readonly elem: TextureElem
    }
  // A storage texture (roadmap 0.4 item 10): an image a shader reads and writes by texel
  // coordinate, with no sampler and no filtering. Its OWN kind rather than another `dim` on
  // `texture`, because the two are different things at every site that touches one: a sampled
  // texture is read through a sampler and carries an element type, a storage texture is
  // addressed directly and carries a FORMAT and an ACCESS mode. Keeping them apart means every
  // existing `t.kind === 'texture'` switch keeps meaning "sampled", and a site that must decide
  // about storage textures fails to compile until it does.
  //
  // WebGPU only. GLSL ES 3.00 has no image load/store at all — that is ES 3.1 — so the GLSL
  // backend fails closed, as it does for storage buffers and atomics.
  | {
      readonly kind: 'storage-texture'
      readonly dim: '2d' | '2d-array'
      readonly format: StorageTextureFormat
      readonly access: StorageTextureAccess
    }
  // A depth texture (roadmap 0.4 item 11): the texture a shadow map is. Its OWN kind, for the
  // reason the storage texture above has one — it is a different thing at every site. It has no
  // element type (every depth texture is single-channel float), a read of one yields `f32` and
  // not `vec4`, and only some calls apply to it. WGSL spells it `texture_depth_2d`; GLSL ES
  // 3.00 fuses it with its sampler, and WHICH combined sampler depends on how it is used —
  // `sampler2DShadow` when compared, `sampler2D` when plainly sampled — which is what the GLSL
  // backend derives from the calls rather than from this type.
  //
  // 'cube' (roadmap 0.4 item 12) is the shadow map of a point light, looked up by the direction
  // from the light; both targets have it (`texture_depth_cube`, `samplerCubeShadow`).
  //
  // '2d-ms' (roadmap 0.4 item 13) is a multisampled depth attachment read one sample at a time,
  // `texture_depth_multisampled_2d`; it cannot be sampled or compared (§6.6.3), only loaded.
  | {
      readonly kind: 'depth-texture'
      readonly dim: '2d' | '2d-array' | 'cube' | 'cube-array' | '2d-ms'
    }
  | { readonly kind: 'sampler' }
  // A comparison sampler (roadmap 0.4 item 11): the one `textureSampleCompare` takes, which
  // compares a reference value against the texel and returns how much of the filter footprint
  // passed rather than the texel itself. Its own kind rather than a flag on `sampler`, so a
  // site that must tell the two apart cannot read one as the other by accident — Tint refuses
  // both substitutions ("no matching call"), and so does this.
  | { readonly kind: 'sampler-comparison' }
  | { readonly kind: 'void' }

// `as const satisfies` keeps each constant's LITERAL type (so KeyOf<typeof f32T>
// resolves to the precise key 'f32' / 'vec2<f32>' …) while still checking it is
// a valid ShaderType — the basis for the compile-time type-safety gate (AC4).
/** The `f32` scalar type, the DSL's default numeric type: what a bare numeric literal lifts to
 *  (`lift(3)` is a `Node<'f32'>`) and what most builtins (`sin`, `mix`, `length`, …) return. Use
 *  it to type an `fn` parameter, a `resource` or uniform field, or a struct field that must
 *  hold a native float; for emulated double precision use {@link f64T}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { fn, module, uniformStruct, sqrt, toF32, f64T, f32T } from 'typeshade'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec2f64T = { kind: 'vec64', n: 2 } as const satisfies ShaderType
/** A 3-component emulated-double vector; see {@link vec2f64T} for how it is emitted and when
 *  to prefer the emulated-double family over plain {@link vec3fT}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec3f64T = { kind: 'vec64', n: 3 } as const satisfies ShaderType
/** A 4-component emulated-double vector; see {@link vec2f64T} for how it is emitted and when
 *  to prefer the emulated-double family over plain {@link vec4fT}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec4f64T = { kind: 'vec64', n: 4 } as const satisfies ShaderType
/** The `i32` scalar type, the DSL's signed-integer type: the result type of the {@link i32}
 *  cast, and the type a non-integer {@link matchExpr} scrutinee is cast to before emit, since
 *  WGSL's `switch` only accepts integer scrutinees. Use it for signed-integer `fn` parameters
 *  and fields; for an unsigned count or index, prefer {@link u32T}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const i32T = { kind: 'scalar', scalar: 'i32' } as const satisfies ShaderType
/** The `u32` scalar type, the DSL's unsigned-integer type: counts, indices, and the compute and
 *  vertex builtins that are unsigned by spec (`builtin('vertex_index', u32T)`; the vector form
 *  is `builtin('global_invocation_id', vec3uT)`). Prefer it to {@link i32T} whenever the value
 *  can never be negative; the type then documents the invariant.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const u32T = { kind: 'scalar', scalar: 'u32' } as const satisfies ShaderType
/** The `bool` scalar type: the type of every comparison (`.lt`, `.eq`, …) and logical (`.and`,
 *  `.or`) result, the required return type of a boolean-returning `fn`, and the type an
 *  {@link If} condition is checked against when the authoring code runs.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const boolT = { kind: 'scalar', scalar: 'bool' } as const satisfies ShaderType

/** `atomic<u32>`: an unsigned 32-bit integer in storage memory that many invocations update
 *  at once through the `atomic*` builtins (`atomicAdd`, `atomicLoad`, ...). It is a location,
 *  not a value: it cannot be read, assigned or used in arithmetic directly.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const atomicU32T = { kind: 'atomic', elem: 'u32' } as const satisfies ShaderType

/** `atomic<i32>`: the signed twin of {@link atomicU32T}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const atomicI32T = { kind: 'atomic', elem: 'i32' } as const satisfies ShaderType
/** A native `vec2<f32>`, the most common vector type in the DSL: screen and UV coordinates and
 *  2D positions, such as a `uv: location(0, vec2fT)` fragment-input field or a
 *  `resolution: vec2fT` uniform. Build a value with the {@link vec2} constructor; use
 *  {@link vec2f64T} instead when the value needs more precision than f32 offers.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec2fT = { kind: 'vec', n: 2, elem: 'f32' } as const satisfies ShaderType
/** A native `vec3<f32>`, the usual carrier for a world-space position or direction, such as
 *  the `p: vec3fT` parameter of a signed-distance scene function.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec3fT = { kind: 'vec', n: 3, elem: 'f32' } as const satisfies ShaderType
/** A native `vec4<f32>`: an RGBA colour or a homogeneous clip-space position. Types the
 *  `pos: builtin('position', vec4fT)` vertex-output field, a `location(0, vec4fT)`
 *  fragment-output field, and any RGBA uniform field.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec4fT = { kind: 'vec', n: 4, elem: 'f32' } as const satisfies ShaderType
/** A native `vec2<u32>`, a 2-wide unsigned-integer field, such as a packed pick-ID varying
 *  declared `location(1, vec2uT, 'flat')`.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec2uT = { kind: 'vec', n: 2, elem: 'u32' } as const satisfies ShaderType
/** A native `vec3<u32>`, chiefly the type of the compute `global_invocation_id` builtin
 *  (`builtin('global_invocation_id', vec3uT)`).
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec3uT = { kind: 'vec', n: 3, elem: 'u32' } as const satisfies ShaderType
/** A native `vec4<u32>`, a 4-wide unsigned-integer resource or uniform field, such as the
 *  parameter block of a compute kernel (`resource('params', vec4uT, { … })`).
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec4uT = { kind: 'vec', n: 4, elem: 'u32' } as const satisfies ShaderType

/** `vec2<bool>`: what a comparison of two `vec2` values yields, componentwise (roadmap 0.2
 *  item 7). `any`, `all` and a componentwise `select` take it. Not host-shareable. */
export const vec2bT = { kind: 'vec', n: 2, elem: 'bool' } as const satisfies ShaderType
/** `vec3<bool>`: the componentwise comparison of two three-component vectors. */
export const vec3bT = { kind: 'vec', n: 3, elem: 'bool' } as const satisfies ShaderType
/** `vec4<bool>`: the componentwise comparison of two four-component vectors. */
export const vec4bT = { kind: 'vec', n: 4, elem: 'bool' } as const satisfies ShaderType
/** A native `vec2<i32>`. Build a value with the {@link vec2i} constructor, for example a texel
 *  coordinate for {@link textureLoad}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec2iT = { kind: 'vec', n: 2, elem: 'i32' } as const satisfies ShaderType
/** A native `vec3<i32>`, the signed-integer counterpart of {@link vec3uT} — a texel coordinate
 *  into an array texture, a signed grid cell. Build a value with the {@link vec3i} constructor.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec3iT = { kind: 'vec', n: 3, elem: 'i32' } as const satisfies ShaderType
/** A native `vec4<i32>`, completing the signed-integer vector family alongside {@link vec2iT}.
 *  Use it to type an `fn` parameter, `resource` or struct field declared as `vec4<i32>`; build
 *  a value with `construct(vec4iT, [...])` or read one with `.at()` against this type.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const vec4iT = { kind: 'vec', n: 4, elem: 'i32' } as const satisfies ShaderType
/** A native `mat4x4<f32>`, the model-view-projection or view matrix type of a typical
 *  per-frame uniform (`mvp: mat4x4fT`). It is the only native float matrix size with a named
 *  constant: a 2×2 or 3×3 float matrix lays out differently under the WGSL and GLSL std140
 *  rules and is rejected.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const mat4x4fT = { kind: 'mat', n: 4, elem: 'f32' } as const satisfies ShaderType
/** A 2×2 emulated-double matrix, logically `mat2x2<f64>`. Before emit it is rewritten into a
 *  struct of two {@link vec2f64T} columns, and {@link mulMat64}, {@link transformMat64} and
 *  {@link transpose64} on it compose the scalar double-double error-free transforms the same
 *  way `length` and `dot` on {@link vec2f64T} do.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const mat2f64T = { kind: 'mat', n: 2, elem: 'f64' } as const satisfies ShaderType
/** A 3×3 emulated-double matrix; see {@link mat2f64T} for how it is emitted and the matrix
 *  operations available on it.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const mat3f64T = { kind: 'mat', n: 3, elem: 'f64' } as const satisfies ShaderType
/** A 4×4 emulated-double matrix; see {@link mat2f64T} for how it is emitted and the matrix
 *  operations available on it.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const mat4f64T = { kind: 'mat', n: 4, elem: 'f64' } as const satisfies ShaderType
/** A sampled 2D float texture (WGSL `texture_2d<f32>`, GLSL ES 3.00 `sampler2D`): the ordinary
 *  single-layer binding type behind {@link textureSample} and {@link textureLoad}, for colour
 *  ramps, lookup tables and atlases (`resource('atlas_tex', texture2dfT, { … })`). For exact
 *  integer texels use {@link texture2duT} or {@link texture2diT}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const texture2dfT = { kind: 'texture', dim: '2d', elem: 'f32' } as const satisfies ShaderType
/** A multisampled 2D texture (WGSL `texture_multisampled_2d<f32>`, GLSL `sampler2DMS`): the
 *  resolve-source binding for an MSAA render target, read one sample at a time with
 *  `textureLoad(tex, coord, sampleIndex)` inside a per-sample averaging loop. A host that
 *  chooses the type at emit time (`sampleCount > 1 ? texture2dMsfT : texture2dfT`) can serve
 *  both the MSAA and the single-sample path from one shader source.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const texture2duT = { kind: 'texture', dim: '2d', elem: 'u32' } as const satisfies ShaderType
/** A signed-integer 2D texture (WGSL `texture_2d<i32>`, GLSL ES 3.00 `isampler2D`): the signed
 *  twin of {@link texture2duT}, with the same load-only contract.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const texture2diT = { kind: 'texture', dim: '2d', elem: 'i32' } as const satisfies ShaderType
/** An unsigned-integer 2D array texture (WGSL `texture_2d_array<u32>`, GLSL ES 3.00
 *  `usampler2DArray`): {@link texture2dArrayfT}'s layer model with {@link texture2duT}'s exact
 *  integer texels.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const texture2dArrayuT = {
  kind: 'texture',
  dim: '2d-array',
  elem: 'u32',
} as const satisfies ShaderType
/** A signed-integer 2D array texture (WGSL `texture_2d_array<i32>`, GLSL ES 3.00
 *  `isampler2DArray`): the signed twin of {@link texture2dArrayuT}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const samplerT = { kind: 'sampler' } as const satisfies ShaderType

/** The comparison sampler `textureSampleCompare` takes (roadmap 0.4 item 11): it compares a
 *  reference value against the texel and yields how much of the filter footprint passed, rather
 *  than the texel itself. Not interchangeable with {@link samplerT} in either direction.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const samplerComparisonT = { kind: 'sampler-comparison' } as const satisfies ShaderType

/** A 2D depth texture — the texture a shadow map is (roadmap 0.4 item 11). Single-channel
 *  float with no element type of its own, and a read of one yields `f32`, not `vec4`.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureDepth2dT = { kind: 'depth-texture', dim: '2d' } as const satisfies ShaderType

/** An array of 2D depth textures, the shape a cascaded shadow map takes (roadmap 0.4 item 11).
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureDepth2dArrayT = {
  kind: 'depth-texture',
  dim: '2d-array',
} as const satisfies ShaderType
/** A cube depth texture (WGSL `texture_depth_cube`, GLSL ES 3.00 `samplerCubeShadow`): the
 *  shadow map of a point light, compared by the direction from the light (roadmap 0.4 item 12).
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureDepthCubeT = {
  kind: 'depth-texture',
  dim: 'cube',
} as const satisfies ShaderType
/** A sampled float cube texture (WGSL `texture_cube<f32>`, GLSL ES 3.00 `samplerCube`): six
 *  faces looked up by a `vec3` DIRECTION rather than a coordinate, the shape an environment map
 *  or a skybox takes (roadmap 0.4 item 12). Core in both targets, so it needs no
 *  {@link Capability}. A cube is only ever sampled: neither target has a texel fetch for one.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureCubefT = {
  kind: 'texture',
  dim: 'cube',
  elem: 'f32',
} as const satisfies ShaderType
/** A sampled float 3D texture (WGSL `texture_3d<f32>`, GLSL ES 3.00 `sampler3D`): a volume
 *  addressed by a `vec3` coordinate, the shape a colour-grading lookup table or a density field
 *  takes (roadmap 0.4 item 12). Core in both targets, so it needs no {@link Capability}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const texture3dfT = {
  kind: 'texture',
  dim: '3d',
  elem: 'f32',
} as const satisfies ShaderType
/** A sampled float 1D texture (WGSL `texture_1d<f32>`): a row of texels addressed by one `f32`,
 *  the shape a transfer function or a colour ramp takes (roadmap 0.4 item 12). WebGPU only:
 *  GLSL ES 3.00 has no `sampler1D` (the word is reserved), so a module carrying one needs the
 *  `texture1d` {@link Capability}, which the GLSL backend has no row for.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const texture1dfT = {
  kind: 'texture',
  dim: '1d',
  elem: 'f32',
} as const satisfies ShaderType
/** An array of float cube textures (WGSL `texture_cube_array<f32>`): N environment maps in one
 *  binding, looked up by a `vec3` direction and a layer (roadmap 0.4 item 12). WebGPU only: GLSL
 *  ES 3.00 has no `samplerCubeArray` and a WebGL2 driver refuses the extension, so a module
 *  carrying one needs the `textureCubeArray` {@link Capability}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureCubeArrayfT = {
  kind: 'texture',
  dim: 'cube-array',
  elem: 'f32',
} as const satisfies ShaderType
/** An array of cube depth textures (WGSL `texture_depth_cube_array`): the shadow maps of N point
 *  lights in one binding (roadmap 0.4 item 12). WebGPU only, like {@link textureCubeArrayfT}.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureDepthCubeArrayT = {
  kind: 'depth-texture',
  dim: 'cube-array',
} as const satisfies ShaderType
/** A multisampled depth texture (WGSL `texture_depth_multisampled_2d`): the depth attachment of
 *  an MSAA render target, read one sample at a time with `textureLoad(t, coords, sampleIndex)`
 *  and never sampled or compared (roadmap 0.4 item 13). WebGPU only, under `msaaTextureLoad`:
 *  GLSL ES 3.00 has no `sampler2DMS` (that is ES 3.10).
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export const textureDepthMultisampled2dT = {
  kind: 'depth-texture',
  dim: '2d-ms',
} as const satisfies ShaderType
/** The absent-value type: the return type of an `fn` whose body never returns a value (a
 *  statement-only vertex mutator, a compute entry point). Return-type inference falls back to
 *  it when it finds no `Return` in a body, so you rarely need to write it explicitly.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @param name The struct's declared name; it becomes the type's key, `struct:<name>`.
 *  @returns A `{ kind: 'struct', name }` descriptor whose `name` keeps its literal type.
 *
 *  @example
 *  ```ts
 *  import { structT, typeEq } from 'typeshade'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
          : // X-GIS #2456 — struct / array / void arms. typeKey has emitted `struct:Name`,
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
              : T extends { kind: 'atomic'; elem: infer E extends string }
                ? `atomic<${E}>`
                : T extends { kind: 'void' }
                  ? 'void'
                  : // X-GIS #763 X6 — texture/sampler arms (spellings match typeKey()): resource()
                    // promised a SPECIFIC key (`Node<'texture_2d<f32>'>`) but these fell through
                    // to `string`, so a texture/sampler argument swap type-checked.
                    T extends { kind: 'texture'; dim: '2d-ms'; elem: infer E extends string }
                    ? `texture_multisampled_2d<${E}>`
                    : // X-GIS #1651 — arm ORDER is immaterial here: the dims are exact literals, so
                      // `{ dim: '2d-array' }` never extends `{ dim: '2d' }` regardless of which
                      // arm comes first. The real hazard is a MISSING arm — it drops an array
                      // resource() node through to the `string` fallback, where it matches no
                      // authoring overload at all (the failure is a confusing "no overload
                      // matches", not a key mismatch).
                      // X-GIS #1703 — `elem` is INFERRED, not hardcoded to f32: a texture2duT resource
                      // must land on `texture_2d<u32>`, and a hardcoded `<f32>` would silently
                      // hand an integer texture the FLOAT key, where textureSample's overload
                      // accepts it and naga rejects the emitted WGSL.
                      T extends { kind: 'texture'; dim: '2d-array'; elem: infer E extends string }
                      ? `texture_2d_array<${E}>`
                      : T extends { kind: 'texture'; dim: '2d'; elem: infer E extends string }
                        ? `texture_2d<${E}>`
                        : // Roadmap 0.4 item 12 — the cube and 3d arms, so a resource() of one lands
                          // on its own key rather than the `string` fallback.
                          T extends { kind: 'texture'; dim: 'cube'; elem: infer E extends string }
                          ? `texture_cube<${E}>`
                          : T extends { kind: 'texture'; dim: '3d'; elem: infer E extends string }
                            ? `texture_3d<${E}>`
                            : T extends { kind: 'texture'; dim: '1d'; elem: infer E extends string }
                              ? `texture_1d<${E}>`
                              : T extends {
                                    kind: 'texture'
                                    dim: 'cube-array'
                                    elem: infer E extends string
                                  }
                                ? `texture_cube_array<${E}>`
                                : T extends { kind: 'sampler' }
                                  ? 'sampler'
                                  : string
/** Element key of a vector key (`vec3<u32>` → `u32`); identity for scalars. */
export type ElemKey<K extends string> = K extends `vec${number}<${infer E}>` ? E : K

// Drop a `,<digits>` suffix from the LAST comma-separated position of an array key's inner
// text, which is where the size lives. Written as a right-recursion rather than a single
// `${infer E},${infer N}` match because TS takes the FIRST comma for such a pattern, and an
// element key may contain one: `array<array<f32,2>,3>` would otherwise yield `array<f32`.
type DropArraySize<S extends string> = S extends `${infer A},${infer B}`
  ? B extends `${number}`
    ? A
    : `${A},${DropArraySize<B>}`
  : S

/** Element key of an array key: `array<f32,4>` → `'f32'`, `array<vec3<f32>>` → `'vec3<f32>'`,
 *  and `never` for a key that is not an array. It is the inverse of the `array` arm of
 *  {@link KeyOf}, and it is what lets `xs.at(i)` know the element type without being told
 *  again — the declaration already said it.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @typeParam K The array key to take the element of.
 */
export type ArrayElemKey<K extends string> = K extends `array<${infer Inner}>`
  ? DropArraySize<Inner>
  : never
/** The key form of {@link Scalar} without `'bool'`: the set accepted wherever the DSL needs an
 *  indexable or comparable native scalar, such as array indices (`.at(i, elem)`), bitwise-op
 *  operands, and {@link matchExpr} or {@link Switch} scrutinees. `'f64'` and `'bool'` are
 *  excluded because a `Switch` scrutinee must become a WGSL `switch`, which only accepts
 *  integer cases, and an array index or bit-op operand is never boolean.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type ScalarKey = 'f32' | 'i32' | 'u32'

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
 *  import { typeKey, vec3fT, texture2dArrayfT } from 'typeshade'
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
        case 'cube':
          return `texture_cube<${t.elem}>`
        case '3d':
          return `texture_3d<${t.elem}>`
        case '1d':
          return `texture_1d<${t.elem}>`
        case 'cube-array':
          return `texture_cube_array<${t.elem}>`
        default:
          // Exhaustiveness on the whole ARM, not on `t.dim` (X-GIS #1703): the texture type
          // is now a two-arm union, so once every dim is handled `t` itself is `never`
          // and `t.dim` no longer exists to check. A new dim (or a new arm) still
          // fails compilation right here.
          return t satisfies never
      }
    case 'storage-texture':
      // Spelled as WGSL spells it, so the key a host or a golden reads is the declaration's
      // own text. `dim` is written out for the same reason `texture` writes it out.
      return t.dim === '2d-array'
        ? `texture_storage_2d_array<${t.format}, ${t.access}>`
        : `texture_storage_2d<${t.format}, ${t.access}>`
    case 'atomic':
      return `atomic<${t.elem}>`
    case 'depth-texture':
      // Spelled as WGSL spells it, so the key a host or a golden reads is the declaration's
      // own text; `dim` is written out for the reason the sampled texture writes it out.
      switch (t.dim) {
        case '2d':
          return 'texture_depth_2d'
        case '2d-array':
          return 'texture_depth_2d_array'
        case 'cube':
          return 'texture_depth_cube'
        case 'cube-array':
          return 'texture_depth_cube_array'
        case '2d-ms':
          return 'texture_depth_multisampled_2d'
      }
    case 'sampler':
      return 'sampler'
    case 'sampler-comparison':
      return 'sampler_comparison'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @param a The first type.
 *  @param b The second type.
 *  @returns `true` when both spell the same key.
 *
 *  @example
 *  ```ts
 *  import { typeEq, boolT } from 'typeshade'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isVec, vec3fT, f32T } from 'typeshade'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isScalar, f32T, f64T } from 'typeshade'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isMat, mat4x4fT, mat2f64T } from 'typeshade'
 *
 *  isMat(mat4x4fT) // true
 *  isMat(mat2f64T) // also true; use isMat64 to tell them apart
 *  ```
 */
export const isMat = (t: ShaderType): t is Extract<ShaderType, { kind: 'mat' }> => t.kind === 'mat'
/** Narrows a `ShaderType` to an emulated-double matrix (`matNxN<f64>`, see {@link mat2f64T}),
 *  which is emitted as a struct of double-double columns.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isF64, f64T, f32T } from 'typeshade'
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
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @example
 *  ```ts
 *  import { isVec64, vec2f64T, vec2fT } from 'typeshade'
 *
 *  isVec64(vec2f64T) // true
 *  isVec64(vec2fT) // false: a native vec, use isVec for that
 *  ```
 */
export const isVec64 = (t: ShaderType): t is Extract<ShaderType, { kind: 'vec64' }> =>
  t.kind === 'vec64'
