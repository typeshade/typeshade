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
export type TextureElem = 'f32' | 'u32' | 'i32';

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
  | 'bgra8unorm';

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
] as const satisfies readonly StorageTextureFormat[];

/** How a shader may touch a storage texture. WGSL spells these `write`, `read` and
 *  `read_write`; WebGPU's bind group layout spells the same three `write-only`, `read-only` and
 *  `read-write`, which is what {@link storageTextureLayoutAccess} converts to. */
export type StorageTextureAccess = 'write' | 'read' | 'read_write';

/** The formats a device takes at `read_write` access, which is the three single-channel 32-bit
 *  ones and no others (measured, as {@link StorageTextureFormat} describes). Every other format
 *  is `write` or `read`, one at a time. Tint compiles `texture_storage_2d<rgba8unorm,
 *  read_write>` happily, so this list is the only thing standing between that spelling and a
 *  device error the compile gate never reaches. */
export const READ_WRITE_STORAGE_FORMATS = [
  'r32uint',
  'r32sint',
  'r32float',
] as const satisfies readonly StorageTextureFormat[];

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
] as const satisfies readonly StorageTextureFormat[];

/** The device feature a format needs before any device will store to it, or undefined when the
 *  format is core. The name is WebGPU's own, as `GPUAdapter.features` reports it, so a host can
 *  pass it straight to `requestDevice({ requiredFeatures })`. */
export const storageFormatFeature = (format: StorageTextureFormat): string | undefined =>
  format === 'bgra8unorm' ? 'bgra8unorm-storage' : undefined;

/** The type of one texel of a storage texture, which its format's channel kind decides: a
 *  `…uint` format loads and stores `vec4<u32>`, a `…sint` format `vec4<i32>`, and every other
 *  one — unorm, snorm and float — `vec4<f32>`. Tint enforces this (`no matching call to
 *  'textureStore(texture_storage_2d<rgba8uint, write>, vec2<i32>, vec4<f32>)'`), so a front end
 *  that checks it first can say the same thing in its own words and name the fix. */
export const storageTexel = (format: StorageTextureFormat): TextureElem =>
  format.endsWith('uint') ? 'u32' : format.endsWith('sint') ? 'i32' : 'f32';

/** What WebGPU's `GPUStorageTextureBindingLayout.access` calls a WGSL access mode. The two
 *  vocabularies differ by a hyphen and a word, and a host passing the WGSL spelling straight
 *  through gets a validation error, so reflection carries the host's spelling. */
export const storageTextureLayoutAccess = (
  access: StorageTextureAccess,
): 'write-only' | 'read-only' | 'read-write' =>
  access === 'write' ? 'write-only' : access === 'read' ? 'read-only' : 'read-write';
