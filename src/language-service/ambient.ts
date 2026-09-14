// === The ambient declarations for the TypeShade globals (design doc §4, §6) ===
//
// `SHADE_DTS` is loaded by `host.ts` as a virtual library file so a TypeScript program over a
// `"use typeshade"` file sees `f32`, `vec4`, `uniform<T>`, `@vertex`, and the rest of the
// authoring vocabulary with zero false positives on a valid program (§6). The vocabulary is
// derived from the compiler's own tables — `SUPPORTED_TYPE_NAMES` and `SCALAR_CAST` from
// `compiler/ts/type-map.ts`/`numeric.ts`, and the Math aliases from `compiler/ts/math-alias.ts`
// — rather than retyped by hand, so the two cannot drift silently; `ambient.test.ts` also
// cross-checks the one piece with no runtime witness (`WgslBuiltinName`, a type-only union) by
// parsing `core/sot.ts` with the TypeScript compiler API.
//
// GPU scalar types are branded nominal types: `type f32 = number & { readonly [tag]: true }`,
// with a REQUIRED (not optional) unique-symbol property, so `f32` and `u32` are not assignable
// to each other while a plain numeric literal — which every "use typeshade" program passes to
// `vec4(...)`, an `if`, or a `let` with no annotation — still widens to `number` and flows
// anywhere a `number` is accepted. Vector types are branded the same way, keyed by a
// `[elementKind, arity]` tuple so `vec2`/`vec3`/`vec4` and their `i`/`u`/`f64` variants are all
// distinct, and additionally carry real `x`/`y`/`z`/`w`/`r`/`g`/`b`/`a` component fields (plus
// the `xy`/`xyz`/`xyzw` and `rg`/`rgb`/`rgba` prefix swizzles) so member access type-checks;
// see the "Known limitation" note below `VecOf` for what this does not cover.

import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js'
import { SCALAR_CAST } from '../compiler/ts/numeric.js'
import { MATH_FN_ARITY, MATH_EXPAND_ALIAS, LANG_CONST } from '../compiler/ts/math-alias.js'

type VecElem = 'f32' | 'i32' | 'u32' | 'f64'

/** Every `vecN`/`vecNf`/`vecNi`/`vecNu`/`vecNf64` name in `SUPPORTED_TYPE_NAMES`, mapped to its
 * element kind — derived by pattern, not retyped, so a new vector alias in `type-map.ts` is
 * picked up automatically (and `ambient.test.ts` asserts every `SUPPORTED_TYPE_NAMES` entry is
 * accounted for by this map or the scalar/mat handling below, so a name that fits no pattern is
 * never silently skipped). `vecNd` is a bare alias for the same `vecNf64` brand, not a
 * constructor name — see `VEC_CTOR_NAMES` below. */
const VEC_TYPE_ELEM = new Map<string, VecElem>()
for (const name of SUPPORTED_TYPE_NAMES) {
  const m = /^vec([234])(f64|f|i|u|d)?$/.exec(name)
  if (!m) continue
  const suffix = m[2]
  const elem: VecElem =
    suffix === undefined || suffix === 'f'
      ? 'f32'
      : suffix === 'i'
        ? 'i32'
        : suffix === 'u'
          ? 'u32'
          : 'f64'
  VEC_TYPE_ELEM.set(name, elem)
}

/** The subset of `VEC_TYPE_ELEM` keys that are also valid *constructor* call names — the
 * compiler's `VEC_CTOR` table in `lower/expression-call.ts` (private; not re-derived here
 * because it carries no vocabulary `type-map.ts` does not already have) accepts `vec2`/`vec3`/
 * `vec4` and their `f`/`i`/`u`/`f64` suffixes but never the bare `d` suffix — `vec2d(...)` is
 * not a function, only a type name. */
const VEC_CTOR_NAMES = [...VEC_TYPE_ELEM.keys()].filter((name) => !/d$/.test(name))

/** WGSL builtin ids `@builtin(...)` accepts, mirroring `WgslBuiltinName` in `core/sot.ts`
 * exactly (a type-only union with no runtime witness, so it cannot be imported — `ambient.
 * test.ts` parses `sot.ts` with the TypeScript compiler API and asserts this literal list
 * stays in sync with it). Declared as a completion/hover data source too — see
 * `completions.ts`. */
export const WGSL_BUILTIN_NAMES: readonly string[] = [
  'vertex_index',
  'instance_index',
  'position',
  'front_facing',
  'frag_depth',
  'sample_index',
  'sample_mask',
  'local_invocation_id',
  'local_invocation_index',
  'global_invocation_id',
  'workgroup_id',
  'num_workgroups',
  'subgroup_invocation_id',
  'subgroup_size',
  'clip_distances',
]

/**
 * The attribute names the compiler parses as decorators, per `lower/function.ts`'s
 * `parseStage`/`stringDecorator`/`numberDecorator` and `structs.ts`'s field decorators.
 * `interpolate`/`align`/`size`/`ignore` are NOT included: `structs.ts` only ever *rejects*
 * `@align` (`"@align on a field is not applied"`) and neither the struct nor the function
 * lowering recognizes `interpolate`, `size`, or `ignore` at all — grepping the lowering
 * confirms only these five are load-bearing today. See the phase report for this deviation
 * from the design doc's speculative list.
 */
export const ATTRIBUTE_NAMES: readonly string[] = [
  'vertex',
  'fragment',
  'compute',
  'builtin',
  'location',
]

const vecCtorOverloads = (name: string, elem: VecElem): string => {
  const n = Number(name.match(/\d/)![0]) as 2 | 3 | 4
  const type = vecTypeName(elem, n)
  const lines: string[] = []
  if (n === 2) {
    lines.push(`declare function ${name}(x: number, y: number): ${type}`)
  } else if (n === 3) {
    lines.push(`declare function ${name}(x: number, y: number, z: number): ${type}`)
    lines.push(`declare function ${name}(v: ${vecTypeName(elem, 2)}, z: number): ${type}`)
  } else {
    lines.push(`declare function ${name}(x: number, y: number, z: number, w: number): ${type}`)
    lines.push(`declare function ${name}(v: ${vecTypeName(elem, 3)}, w: number): ${type}`)
    lines.push(
      `declare function ${name}(v: ${vecTypeName(elem, 2)}, z: number, w: number): ${type}`,
    )
  }
  lines.push(`declare function ${name}(scalar: number): ${type}`)
  return lines.join('\n')
}

/** The canonical brand-type name for one (element, arity) pair — `vec2`/`vec3`/`vec4` for
 * `f32` (the default element every bare `vecN` name maps to), `vecNi`/`vecNu`/`vecNf64`
 * otherwise. Used both to declare the type aliases and to reference them from constructor
 * and swizzle signatures, so the two can never name two different types for one pair. */
function vecTypeName(elem: VecElem, n: 2 | 3 | 4): string {
  if (elem === 'f32') return `vec${n}`
  if (elem === 'f64') return `vec${n}f64`
  return `vec${n}${elem === 'i32' ? 'i' : 'u'}`
}

/** Math free functions callable without a `Math.` prefix (GLSL-style), from `MATH_FN_ARITY` —
 * every key except `f32` (that key exists only because `Math.fround` aliases to the `f32`
 * scalar cast id; the callable name `f32` is the cast declared separately below, and the
 * compiler's own call lowering checks `SCALAR_CAST` before it ever reaches the canonical-math
 * path, so a second `f32` overload here would be dead vocabulary, never a real ambiguity). */
const FREE_MATH_NAMES = Object.keys(MATH_FN_ARITY).filter((name) => name !== 'f32')

/** Real GLSL semantics for the handful of free math functions whose signature is not simply
 * "same numeric type in, same numeric type out" — `dot`/`distance`/`length` reduce a vector to
 * a scalar, `cross` is vec3-only, `normalize` preserves its vector's shape. Declared by hand
 * because `MATH_FN_ARITY` records arity only, not shape. */
const SPECIAL_MATH_SIGNATURES: Readonly<Record<string, string>> = {
  dot: 'declare function dot<T extends Numeric>(a: T, b: T): number',
  distance: 'declare function distance<T extends Numeric>(a: T, b: T): number',
  length: 'declare function length<T extends Numeric>(a: T): number',
  normalize: 'declare function normalize<T extends Numeric>(a: T): T',
  cross: 'declare function cross(a: vec3, b: vec3): vec3',
}

function freeMathSignature(name: string): string {
  const special = SPECIAL_MATH_SIGNATURES[name]
  if (special) return special
  const arity = MATH_FN_ARITY[name]!
  const params = Array.from({ length: arity }, (_, i) => `a${i}: T`).join(', ')
  return `declare function ${name}<T extends Numeric>(${params}): T`
}

const EXPAND_NAMES = Object.keys(MATH_EXPAND_ALIAS)
const LANG_CONST_NAMES = Object.keys(LANG_CONST)
const SCALAR_CAST_NAMES = Object.keys(SCALAR_CAST)

const scalarBrands = ['f32', 'i32', 'u32', 'f64']
  .map(
    (name) =>
      `declare const ${name}Tag: unique symbol\ntype ${name} = number & { readonly [${name}Tag]: true }`,
  )
  .join('\n')

const vecTypeAliases = [...VEC_TYPE_ELEM.entries()]
  .map(([name, elem]) => {
    const n = Number(name.match(/\d/)![0]) as 2 | 3 | 4
    const canonical = vecTypeName(elem, n)
    return name === canonical ? '' : `type ${name} = ${canonical}`
  })
  .filter(Boolean)
  .join('\n')

const vecCtors = VEC_CTOR_NAMES.map((name) =>
  vecCtorOverloads(name, VEC_TYPE_ELEM.get(name)!),
).join('\n')

const scalarCasts = SCALAR_CAST_NAMES.map(
  (name) => `declare function ${name}(x: number): ${name}`,
).join('\n')

const freeMath = FREE_MATH_NAMES.map(freeMathSignature).join('\n')
const expandFns = EXPAND_NAMES.map(
  (name) => `declare function ${name}<T extends Numeric>(...args: T[]): T`,
).join('\n')
const langConsts = LANG_CONST_NAMES.map((name) => `declare const ${name}: number`).join('\n')

/**
 * The ambient declarations for every TypeShade global: the GPU scalar and vector/matrix types,
 * `array`/`uniform`/`storage`, the attribute decorators, the vector constructors, the scalar
 * casts, and the GLSL-style free math functions plus `Math.*`. Loaded by `host.ts` as a virtual
 * library file (`compilerOptions.lib: []`, this file supplying everything a `"use typeshade"`
 * program needs) so the editor and the compiler agree on one vocabulary (design doc §9).
 *
 * KNOWN LIMITATION (swizzles): the compiler accepts any 1-4-letter combination from one
 * component family (`.xyzw` or `.rgba`), including repeats and non-prefix orders (`.yx`,
 * `.xx`). Typing that fully needs a template-literal-generated key domain; this file instead
 * declares the components individually (`x`/`y`/`z`/`w`/`r`/`g`/`b`/`a`) plus the common
 * prefix swizzles (`xy`/`xyz`/`xyzw`, `rg`/`rgb`/`rgba`), which covers ordinary authoring and
 * every span this phase's examples and tests exercise. A swizzle outside that set is still
 * compiled correctly — it is only unseen by the *editor's* type-checking, which stays a false
 * negative (no red squiggle on invalid input) rather than the false positive §6 forbids.
 */
export const SHADE_DTS = `// Generated ambient declarations for TypeShade authoring — see ambient.ts.

${scalarBrands}
type bool = boolean

declare const vecTag: unique symbol
type ScalarOf<S extends 'f32' | 'i32' | 'u32'> = S extends 'f32' ? f32 : S extends 'i32' ? i32 : u32
type ComponentKeys<N extends 2 | 3 | 4> = N extends 2
  ? 'x' | 'y' | 'r' | 'g' | 'xy' | 'rg'
  : N extends 3
    ? 'x' | 'y' | 'z' | 'r' | 'g' | 'b' | 'xy' | 'rg' | 'xyz' | 'rgb'
    : 'x' | 'y' | 'z' | 'w' | 'r' | 'g' | 'b' | 'a' | 'xy' | 'rg' | 'xyz' | 'rgb' | 'xyzw' | 'rgba'
type VecOf<S extends 'f32' | 'i32' | 'u32', N extends 2 | 3 | 4> = {
  readonly [vecTag]: readonly [S, N]
} & Pick<
  {
    x: ScalarOf<S>
    y: ScalarOf<S>
    z: ScalarOf<S>
    w: ScalarOf<S>
    r: ScalarOf<S>
    g: ScalarOf<S>
    b: ScalarOf<S>
    a: ScalarOf<S>
    xy: VecOf<S, 2>
    rg: VecOf<S, 2>
    xyz: VecOf<S, 3>
    rgb: VecOf<S, 3>
    xyzw: VecOf<S, 4>
    rgba: VecOf<S, 4>
  },
  ComponentKeys<N>
>
type vec2 = VecOf<'f32', 2>
type vec3 = VecOf<'f32', 3>
type vec4 = VecOf<'f32', 4>
type vec2i = VecOf<'i32', 2>
type vec3i = VecOf<'i32', 3>
type vec4i = VecOf<'i32', 4>
type vec2u = VecOf<'u32', 2>
type vec3u = VecOf<'u32', 3>
type vec4u = VecOf<'u32', 4>

declare const vec64Tag: unique symbol
/** \`f64\` vectors carry no swizzle members: \`swizzle.ts\`'s \`parseSwizzle\` only accepts
 * \`kind: 'vec'\` (the f32/i32/u32 family above), never \`kind: 'vec64'\`. */
type Vec64<N extends 2 | 3 | 4> = { readonly [vec64Tag]: N }
type vec2f64 = Vec64<2>
type vec3f64 = Vec64<3>
type vec4f64 = Vec64<4>

${vecTypeAliases}

type Numeric = number | vec2 | vec3 | vec4 | vec2i | vec3i | vec4i | vec2u | vec3u | vec4u

declare const matTag: unique symbol
type Mat<E extends string, N extends 2 | 3 | 4> = { readonly [matTag]: readonly [E, N] }
type mat4x4<T extends f32 | f64 = f32> = Mat<T extends f64 ? 'f64' : 'f32', 4>
type mat4<T extends f32 | f64 = f32> = mat4x4<T>
type mat2<T extends f32 | f64 = f32> = Mat<T extends f64 ? 'f64' : 'f32', 2>
type mat3<T extends f32 | f64 = f32> = Mat<T extends f64 ? 'f64' : 'f32', 3>

declare const arrayTag: unique symbol
type array<T, N extends number = number> = { readonly [arrayTag]: readonly [T, N]; readonly length: N } & {
  readonly [index: number]: T
}
declare function array<T, N extends number>(...values: readonly T[]): array<T, N>
declare function fill<T, N extends number>(value: T): array<T, N>

/** Transparent: a binding's declared value type IS \`T\` everywhere it is referenced in a
 * function body (\`bindings.ts\` unwraps the wrapper once when collecting the binding), so the
 * type alias is an identity rather than an opaque wrapper. */
type uniform<T> = T
type storage<T> = T
declare function uniform<T>(): T
declare function storage<T>(): T

${vecCtors}

${scalarCasts}

${freeMath}

${expandFns}

${langConsts}

interface MathObject {
${Object.keys({
  abs: 0,
  acos: 0,
  acosh: 0,
  asin: 0,
  asinh: 0,
  atan: 0,
  atanh: 0,
  ceil: 0,
  cos: 0,
  cosh: 0,
  exp: 0,
  floor: 0,
  fround: 0,
  log: 0,
  log2: 0,
  round: 0,
  sign: 0,
  sin: 0,
  sinh: 0,
  sqrt: 0,
  tan: 0,
  tanh: 0,
  trunc: 0,
})
  .map((name) => `  ${name}(x: number): number`)
  .join('\n')}
  atan2(y: number, x: number): number
  max(a: number, b: number): number
  min(a: number, b: number): number
  pow(base: number, exponent: number): number
  random(): number
  readonly E: number
  readonly LN10: number
  readonly LN2: number
  readonly LOG10E: number
  readonly LOG2E: number
  readonly PI: number
  readonly SQRT1_2: number
  readonly SQRT2: number
}
declare const Math: MathObject

declare function builtin(name: string): (target: unknown, context?: unknown) => void
declare function location(n: number): (target: unknown, context?: unknown) => void
declare function vertex(target: Function, context?: unknown): void
declare function fragment(target: Function, context?: unknown): void
declare function compute(workgroupSize: readonly number[]): (target: Function, context?: unknown) => void
declare function compute(target: Function, context?: unknown): void

interface Array<T> {
  readonly length: number
  [n: number]: T
}
interface Boolean {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
`
