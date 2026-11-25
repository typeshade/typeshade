import type { ShaderType } from './shader-type.js';

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
