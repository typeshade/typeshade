// The value constructors: the names a call builds a value of a type with (Rule 9.5).
//
// A function the file declares wins over every builtin function of its name, and a value
// constructor is the one thing that does not, as a type name wins over a type alias of the same
// name (Rule 4.2): a declaration named like a scalar cast, a vector, a matrix or `array` does not
// take a call of that name. `bool` and `f64` are the exception, and stay the declaration's
// (`USER_FIRST_BUILTINS`): files declared functions under those two names before an addition made
// them callable, and an addition may not change what a program means.
//
// Implements: Rule 9.5 (docs/language-design.md; traced in reqs/).

import { SCALAR_CAST } from '../numeric.js';
import { USER_FIRST_BUILTINS } from '../math-alias.js';

/** The element kinds a vector constructor spells: the three native scalars, the emulated
 *  double the fp64 pass assembles, and bool (§27). */
export type VecCtorElem = 'f32' | 'i32' | 'u32' | 'f64' | 'bool';

export const VEC_CTOR: Readonly<Record<string, { n: 2 | 3 | 4; elem: VecCtorElem }>> = {
  vec2: { n: 2, elem: 'f32' },
  vec2f: { n: 2, elem: 'f32' },
  vec2i: { n: 2, elem: 'i32' },
  vec2u: { n: 2, elem: 'u32' },
  vec2f64: { n: 2, elem: 'f64' },
  vec3: { n: 3, elem: 'f32' },
  vec3f: { n: 3, elem: 'f32' },
  vec3i: { n: 3, elem: 'i32' },
  vec3u: { n: 3, elem: 'u32' },
  vec3f64: { n: 3, elem: 'f64' },
  vec4: { n: 4, elem: 'f32' },
  vec4f: { n: 4, elem: 'f32' },
  vec4i: { n: 4, elem: 'i32' },
  vec4u: { n: 4, elem: 'u32' },
  vec4f64: { n: 4, elem: 'f64' },
  // Vectors of bools (§27): what a vector comparison yields, and a constructor for one.
  vec2b: { n: 2, elem: 'bool' },
  vec3b: { n: 3, elem: 'bool' },
  vec4b: { n: 4, elem: 'bool' },
};

/** Matrix constructor name -> its shape. Every `matCxR` of wgsl.txt:4621, its predeclared
 *  `matCxRf` alias (#183), and the `matN` shorthand for a square one, matching the type names
 *  `type-map.ts` accepts, so a type an author can declare is a value an author can build. */
export const MAT_CTOR: Readonly<Record<string, { cols: 2 | 3 | 4; rows: 2 | 3 | 4 }>> =
  Object.fromEntries(
    ([2, 3, 4] as const).flatMap((cols) =>
      ([2, 3, 4] as const).flatMap((rows) => [
        [`mat${cols}x${rows}`, { cols, rows }] as const,
        [`mat${cols}x${rows}f`, { cols, rows }] as const,
        ...(cols === rows ? [[`mat${cols}`, { cols, rows }] as const] : []),
      ]),
    ),
  );

/** Whether a call of `name` builds a value: a scalar cast, a vector, a matrix or `array`, which
 *  keeps its precedence over a function of the file (Rule 9.5), `bool` and `f64` excepted. */
export function isValueConstructor(name: string): boolean {
  return (
    name === 'array' ||
    (Object.hasOwn(SCALAR_CAST, name) && !USER_FIRST_BUILTINS.has(name)) ||
    Object.hasOwn(VEC_CTOR, name) ||
    Object.hasOwn(MAT_CTOR, name)
  );
}

/** What is said of a function handed by its name to `taker` (a fold, an array method, a function
 *  that takes one) when `name` is a value constructor the file also declares a function of: the
 *  call of the name is the constructor, so a callback that follows the call would be one, and no
 *  callback is a constructor. */
export const constructorCallbackMessage = (name: string, taker: string): string =>
  `"${name}" is a value constructor, and a declared function of that name does not take its call ` +
  `(Rule 9.5); ${taker} takes a function declared in this file under another name.`;
