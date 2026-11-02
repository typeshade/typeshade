// ═══ The host type family: each host value spelled as the shader spells it (change 0116) ═══
//
// A host file reads a shader module through its host view (surface §64), and the view types each
// host value of Rule 8.21. This file gives each of those values the name the shader writes: one
// type for each authorable value type of Appendix A of `docs/language-design.md`, exported from
// `typeshade/runtime` as types only. A host file imports the names from there, the view imports
// the ones it spells, and a shader file has the same names from the ambient library. The two
// kinds of file meet only in the view.
//
// THE VALUES DO NOT CHANGE. Each type is a name for a host value of Rule 8.21:
//
//   - A scalar is the `number` it was (a `boolean` for `bool`), with its shader name as an
//     optional phantom property, a flavor. A plain literal is one, `const k: f32 = 0.1`, and an
//     `f32` is a `number`: TypeScript does not apply its weak-type check to a member of an
//     intersection. Two names are not assignable to each other, since the types of the optional
//     property differ, so a conditional type tells an `f32` from a `u32`.
//   - A vector is a `readonly` tuple of its scalar: `vec3` is `readonly [f32, f32, f32]`, and
//     `vec3u` is `readonly [u32, u32, u32]` (decision D5).
//   - A matrix is a `readonly` tuple of its C×R scalars, column-major, with its name as a scalar
//     has its name. A `mat2x2` has as many components as a `vec4`, and the name is what tells
//     the two apart where `array<T>` asks, as it tells a `mat2x3` from a `mat3x2`.
//   - `array<T>` is what a kernel function's array with no size takes: the typed array of the
//     scalar of `T`, a vector's components one after another, or an array of structs, each with
//     its `Resident` (decision D3). `array<T, N>` is a `readonly T[]` (decision D4).
//
// No name is declared for a type that has no host value: an atomic, a texture, a sampler, a
// binding, an override, a workgroup variable. A struct, an enum, a key type and a `Record` keep
// the names the view declares for them. `host-types.test.ts` holds the names to the ambient
// library one for one (Rule 12.7), and the flavor to its behaviour on each TypeScript version CI
// runs.
//
// Types only: nothing here is a value, so this file adds no byte to a bundle.

import type { Resident } from '../core/resident.js';

/** The key of the phantom property that holds a shader name. It is declared and never made: no
 *  value has the property, and no value of the family needs it. */
declare const tag: unique symbol;

// ─── scalars ─────────────────────────────────────────────────────────────────────────────────

/** An `f32` as a host value (Rule 8.21): a `number`, which a call rounds as a buffer write
 *  rounds it. A plain number is an `f32`; a value of another name of the family is not. */
export type f32 = number & { readonly [tag]?: 'f32' };
/** An `f64` (Rule 4.4) as a host value: a `number`, kept as a double. */
export type f64 = number & { readonly [tag]?: 'f64' };
/** An `i32` as a host value: a `number`, a whole number in the `i32` range, which a call
 *  checks. */
export type i32 = number & { readonly [tag]?: 'i32' };
/** A `u32` as a host value: a `number`, a whole number from 0 to 4294967295, which a call
 *  checks. */
export type u32 = number & { readonly [tag]?: 'u32' };
/** A `bool` as a host value: a `boolean`, with its name as a number has its name (decision
 *  D6). */
export type bool = boolean & { readonly [tag]?: 'bool' };

// ─── vectors ─────────────────────────────────────────────────────────────────────────────────

/** A `vec2`, the vector of two `f32`, as a host value: a `readonly` tuple of two `f32`. */
export type vec2 = readonly [f32, f32];
/** A `vec3`, the vector of three `f32`, as a host value: a `readonly` tuple of three `f32`. */
export type vec3 = readonly [f32, f32, f32];
/** A `vec4`, the vector of four `f32`, as a host value: a `readonly` tuple of four `f32`. */
export type vec4 = readonly [f32, f32, f32, f32];
/** WGSL's `vec2f`, the same type as {@link vec2}. */
export type vec2f = vec2;
/** WGSL's `vec3f`, the same type as {@link vec3}. */
export type vec3f = vec3;
/** WGSL's `vec4f`, the same type as {@link vec4}. */
export type vec4f = vec4;
/** A `vec2i` as a host value: a `readonly` tuple of two `i32`. */
export type vec2i = readonly [i32, i32];
/** A `vec3i` as a host value: a `readonly` tuple of three `i32`. */
export type vec3i = readonly [i32, i32, i32];
/** A `vec4i` as a host value: a `readonly` tuple of four `i32`. */
export type vec4i = readonly [i32, i32, i32, i32];
/** A `vec2u` as a host value: a `readonly` tuple of two `u32`. */
export type vec2u = readonly [u32, u32];
/** A `vec3u` as a host value: a `readonly` tuple of three `u32`. */
export type vec3u = readonly [u32, u32, u32];
/** A `vec4u` as a host value: a `readonly` tuple of four `u32`. */
export type vec4u = readonly [u32, u32, u32, u32];
/** A `vec2b` as a host value: a `readonly` tuple of two `bool`. */
export type vec2b = readonly [bool, bool];
/** A `vec3b` as a host value: a `readonly` tuple of three `bool`. */
export type vec3b = readonly [bool, bool, bool];
/** A `vec4b` as a host value: a `readonly` tuple of four `bool`. */
export type vec4b = readonly [bool, bool, bool, bool];
/** A `vec2f64` (Rule 4.4) as a host value: a `readonly` tuple of two `f64`. */
export type vec2f64 = readonly [f64, f64];
/** A `vec3f64` (Rule 4.4) as a host value: a `readonly` tuple of three `f64`. */
export type vec3f64 = readonly [f64, f64, f64];
/** A `vec4f64` (Rule 4.4) as a host value: a `readonly` tuple of four `f64`. */
export type vec4f64 = readonly [f64, f64, f64, f64];
/** `vec2d`, the short spelling of {@link vec2f64}, the same type. */
export type vec2d = vec2f64;
/** `vec3d`, the short spelling of {@link vec3f64}, the same type. */
export type vec3d = vec3f64;
/** `vec4d`, the short spelling of {@link vec4f64}, the same type. */
export type vec4d = vec4f64;

// ─── matrices ────────────────────────────────────────────────────────────────────────────────

/** A `mat2x2` as a host value: a `readonly` tuple of its 4 components, column-major.
 *  `mat2x2<f64>` holds `f64` components (Rule 4.4). */
export type mat2x2<T extends f32 | f64 = f32> = readonly [T, T, T, T] & {
  readonly [tag]?: 'mat2x2';
};
/** A `mat2x3`, 2 columns of 3 rows, as a host value: a `readonly` tuple of its 6 components,
 *  column-major. */
export type mat2x3 = readonly [f32, f32, f32, f32, f32, f32] & { readonly [tag]?: 'mat2x3' };
/** A `mat2x4`, 2 columns of 4 rows, as a host value: a `readonly` tuple of its 8 components,
 *  column-major. */
export type mat2x4 = readonly [f32, f32, f32, f32, f32, f32, f32, f32] & {
  readonly [tag]?: 'mat2x4';
};
/** A `mat3x2`, 3 columns of 2 rows, as a host value: a `readonly` tuple of its 6 components,
 *  column-major. */
export type mat3x2 = readonly [f32, f32, f32, f32, f32, f32] & { readonly [tag]?: 'mat3x2' };
/** A `mat3x3` as a host value: a `readonly` tuple of its 9 components, column-major.
 *  `mat3x3<f64>` holds `f64` components (Rule 4.4). */
export type mat3x3<T extends f32 | f64 = f32> = readonly [T, T, T, T, T, T, T, T, T] & {
  readonly [tag]?: 'mat3x3';
};
/** A `mat3x4`, 3 columns of 4 rows, as a host value: a `readonly` tuple of its 12 components,
 *  column-major. */
export type mat3x4 = readonly [f32, f32, f32, f32, f32, f32, f32, f32, f32, f32, f32, f32] & {
  readonly [tag]?: 'mat3x4';
};
/** A `mat4x2`, 4 columns of 2 rows, as a host value: a `readonly` tuple of its 8 components,
 *  column-major. */
export type mat4x2 = readonly [f32, f32, f32, f32, f32, f32, f32, f32] & {
  readonly [tag]?: 'mat4x2';
};
/** A `mat4x3`, 4 columns of 3 rows, as a host value: a `readonly` tuple of its 12 components,
 *  column-major. */
export type mat4x3 = readonly [f32, f32, f32, f32, f32, f32, f32, f32, f32, f32, f32, f32] & {
  readonly [tag]?: 'mat4x3';
};
/** A `mat4x4` as a host value: a `readonly` tuple of its 16 components, column-major.
 *  `mat4x4<f64>` holds `f64` components (Rule 4.4). */
export type mat4x4<T extends f32 | f64 = f32> = readonly [
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
  T,
] & { readonly [tag]?: 'mat4x4' };
/** `mat2`, the short spelling of {@link mat2x2}, the same type. */
export type mat2<T extends f32 | f64 = f32> = mat2x2<T>;
/** `mat3`, the short spelling of {@link mat3x3}, the same type. */
export type mat3<T extends f32 | f64 = f32> = mat3x3<T>;
/** `mat4`, the short spelling of {@link mat4x4}, the same type. */
export type mat4<T extends f32 | f64 = f32> = mat4x4<T>;
/** WGSL's `mat2x2f`, the same type as {@link mat2x2}. */
export type mat2x2f = mat2x2;
/** WGSL's `mat2x3f`, the same type as {@link mat2x3}. */
export type mat2x3f = mat2x3;
/** WGSL's `mat2x4f`, the same type as {@link mat2x4}. */
export type mat2x4f = mat2x4;
/** WGSL's `mat3x2f`, the same type as {@link mat3x2}. */
export type mat3x2f = mat3x2;
/** WGSL's `mat3x3f`, the same type as {@link mat3x3}. */
export type mat3x3f = mat3x3;
/** WGSL's `mat3x4f`, the same type as {@link mat3x4}. */
export type mat3x4f = mat3x4;
/** WGSL's `mat4x2f`, the same type as {@link mat4x2}. */
export type mat4x2f = mat4x2;
/** WGSL's `mat4x3f`, the same type as {@link mat4x3}. */
export type mat4x3f = mat4x3;
/** WGSL's `mat4x4f`, the same type as {@link mat4x4}. */
export type mat4x4f = mat4x4;

// ─── arrays ──────────────────────────────────────────────────────────────────────────────────

/** The typed array that holds an array with no size of a scalar, by the scalar's name (Rule
 *  8.21). */
interface TypedArrays {
  readonly f32: Float32Array;
  readonly f64: Float64Array;
  readonly i32: Int32Array;
  readonly u32: Uint32Array;
}

/** The shader name a type of the family carries, or `never` for a type that carries none: a
 *  vector, whose scalar carries it, or a struct. Read through `keyof`, since a weak type does not
 *  decide a conditional type the way it decides an assignment. */
type NameOf<T> = typeof tag extends keyof T ? Exclude<T[typeof tag], undefined> : never;

/** The typed array of the scalar named `N`, or `never` for a name that has none (`bool`, a
 *  matrix). */
type Typed<N> = N extends keyof TypedArrays ? TypedArrays[N] : never;

/** The typed array an array with no size of `T` is on the host: the scalar's for a scalar `T`,
 *  and for a vector `T` the scalar's, with the components one after another; `never` for any
 *  other `T`, a matrix and a struct among them. */
type Packed<T> = [NameOf<T>] extends [never]
  ? T extends readonly unknown[]
    ? T['length'] extends 2 | 3 | 4
      ? Typed<NameOf<T[0]>>
      : never
    : never
  : Typed<NameOf<T>>;

/** An array with no size of `T` on the host: its typed array, or a `readonly T[]` where `T` has
 *  none, each also as a {@link Resident} of it (decision D3). */
type Unsized<T> = [Packed<T>] extends [never]
  ? readonly T[] | Resident<T[]>
  : Packed<T> | Resident<Packed<T>>;

/**
 * An `array<T>` with no size as a host value, what a kernel function's array takes (Rule 8.21):
 * the typed array of the scalar of `T` (`Float32Array` for `f32`, `Float64Array` for `f64`,
 * `Int32Array` for `i32`, `Uint32Array` for `u32`), the same for a vector `T` with its
 * components one after another, and a `readonly T[]` for any other `T`, a struct or a matrix;
 * each also as a {@link Resident} of it (decision D3). `array<T, N>`, an array with a size, is a
 * `readonly T[]` of `N` values (decision D4).
 *
 * A variable that holds a resident array keeps the `Resident` spelling:
 * `Resident<Float32Array>`.
 */
export type array<T, N extends number = number> = number extends N ? Unsized<T> : readonly T[];
