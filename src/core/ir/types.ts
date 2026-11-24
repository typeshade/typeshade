import type { ShaderType } from './types/shader-type.js';
export {
  texture2dfT,
  texture2dMsfT,
  texture2dArrayfT,
  texture2duT,
  texture2diT,
  texture2dArrayuT,
  texture2dArrayiT,
  samplerT,
  samplerComparisonT,
  textureDepth2dT,
  textureDepth2dArrayT,
  textureDepthCubeT,
  textureCubefT,
  texture3dfT,
  texture1dfT,
  textureCubeArrayfT,
  textureDepthCubeArrayT,
  textureDepthMultisampled2dT,
} from './types/texture-types.js';
export { mat4x4fT, matT } from './types/matrix-types.js';
export {
  f64T,
  vec2f64T,
  vec3f64T,
  vec4f64T,
  mat2f64T,
  mat3f64T,
  mat4f64T,
} from './types/f64-types.js';
export {
  vec2fT,
  vec3fT,
  vec4fT,
  vec2uT,
  vec3uT,
  vec4uT,
  vec2bT,
  vec3bT,
  vec4bT,
  vec2iT,
  vec3iT,
  vec4iT,
} from './types/vector-types.js';
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
