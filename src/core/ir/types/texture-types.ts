import type { ShaderType } from './shader-type.js';

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
