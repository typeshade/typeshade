import type { ShaderType } from './shader-type.js';

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
