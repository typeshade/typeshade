import type { TextureElem, StorageTextureFormat, StorageTextureAccess } from './storage-texture.js';

/** The four native scalar kinds: the ones WGSL and GLSL ES 3.00 both represent directly in
 *  hardware, and the set a `ShaderType` of `kind: 'scalar'` can carry. When a binary operator
 *  mixes two of them, the result follows the native promotion order `f32` > `i32` > `u32`.
 *  Emulated double precision is a separate `ShaderType` kind, {@link f64T}, so it never enters
 *  native promotion and every code path that switches on the scalar kind decides about it
 *  separately (see {@link ShaderType}).
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type Scalar = 'f32' | 'i32' | 'u32' | 'bool';

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
  // A matrix of `cols` columns and `rows` rows, which is WGSL's `matCxR<T>` and GLSL's
  // `matCxR` (`matN` when square). Column-major on every target, so a column is a `vecR` and
  // indexing one with `m[j]` yields that column.
  //
  // COLS AND ROWS, not one `n`: the nine shapes are not interchangeable, and a single `n`
  // could only ever spell the three square ones. It also could not carry the fact the layout
  // layer needs, which is that the ROW count alone decides the column stride — measured on
  // ANGLE, every std140 column rounds up to 16 bytes, while WGSL's stride is
  // AlignOf(vecR<f32>), so a two-ROW matrix (mat2x2, mat3x2, mat4x2) lays out differently on
  // the two targets and every other shape agrees (#149).
  //
  // elem 'f32' is native; elem 'f64' is emulated double precision — it lowers to
  // `struct DF64MatN { c0..c(N-1): DF64VecN }` (columns of df64), and matmul / mat·vec /
  // transpose compose the SCALAR df64 EFTs the same way length/dot do. The emulation is
  // SQUARE-ONLY (the pass has a body per dimension, not per shape), so a non-square f64
  // matrix is refused where it is written rather than lowered. Own elem arm, so every
  // `t.kind === 'mat'` consumer is forced to decide about f64 (verified-by-construction).
  | {
      readonly kind: 'mat';
      readonly cols: 2 | 3 | 4;
      readonly rows: 2 | 3 | 4;
      readonly elem: 'f32' | 'f64';
    }
  | { readonly kind: 'struct'; readonly name: string }
  | {
      readonly kind: 'array';
      readonly elem: ShaderType;
      readonly size?: number;
      /** Pipeline override used as this array's symbolic outer extent. `size` remains the
       *  positive default extent for reflection and the CPU oracle. */
      readonly sizeOverride?: string;
    }
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
      readonly kind: 'texture';
      readonly dim: '2d' | '2d-array' | 'cube' | '3d' | '1d' | 'cube-array' | '2d-ms';
      readonly elem: TextureElem;
    }
  // A storage texture (roadmap 0.4 item 10): an image a shader reads and writes by texel
  // coordinate, with no sampler and no filtering. Its OWN kind rather than another `dim` on
  // `texture`, because the two are different things at every site that touches one: a sampled
  // texture is read through a sampler and carries an element type, a storage texture is
  // addressed directly and carries a FORMAT and an ACCESS mode. Keeping them apart means every
  // existing `t.kind === 'texture'` switch keeps meaning "sampled", and a site that must decide
  // about storage textures fails to compile until it does.
  //
  // WebGPU only. The GLSL lowering of an image load or store is not supported yet (Rule 10.5),
  // so the GLSL backend fails closed, as it does for storage buffers and atomics.
  | {
      readonly kind: 'storage-texture';
      readonly dim: '2d' | '2d-array';
      readonly format: StorageTextureFormat;
      readonly access: StorageTextureAccess;
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
      readonly kind: 'depth-texture';
      readonly dim: '2d' | '2d-array' | 'cube' | 'cube-array' | '2d-ms';
    }
  | { readonly kind: 'sampler' }
  // A comparison sampler (roadmap 0.4 item 11): the one `textureSampleCompare` takes, which
  // compares a reference value against the texel and returns how much of the filter footprint
  // passed rather than the texel itself. Its own kind rather than a flag on `sampler`, so a
  // site that must tell the two apart cannot read one as the other by accident — Tint refuses
  // both substitutions ("no matching call"), and so does this.
  | { readonly kind: 'sampler-comparison' }
  // ECMAScript's `Set<K>` (no `value`) or `Map<K, V>` (change 0080): the type of a kernel
  // function's parameter only (Rule 8.22), which the host passes by reference. Its OWN kind, so
  // every site that switches on a type decides about it. No shader function takes one: a kernel
  // function is not emitted as one, and the WebGPU tier lowers what its loops do to buffers.
  | {
      readonly kind: 'collection';
      readonly key: 'u32' | 'i32' | 'f32';
      readonly value?: ShaderType;
    }
  | { readonly kind: 'void' };
