// === Argument checks for the free math builtins (roadmap 0.2 item 9, #57, §10) ===
//
// The math builtins were lowered by arity alone: `dot(a, b)` with a `vec3` and a `vec2`, or
// `clamp(v, 0., 1.)` with a vector `v`, drew no diagnostic and emitted a call Tint refuses with
// "no matching call to 'dot(vec3<f32>, vec2<f32>)'". The editor's ambient signatures caught
// the first shape but not one whose arguments TypeScript had already typed `number`
// (`dot(a * s, b * s)`), and `compile()` caught neither. This file is the check WGSL applies,
// written once per signature shape: the componentwise builtins take arguments of one type,
// `mix` alone blends by a scalar of the vectors' element kind, `refract` takes a scalar eta,
// `ldexp` an integer exponent of its `x`'s shape, `extractBits` and `insertBits` a `u32` offset
// and count, `cross` two `vec3<f32>`, `transpose` and `determinant` a matrix, and `mod` a
// vector against a scalar of its kind as its floor-mod spelling does. Each rule names the
// offending argument and, where one exists, the fix: splat the scalar, cast one side, or give
// the vectors one size. An emulated double (`f64`, a `vec64`) is left to the fp64 pass, which
// has its own lifting rules.

import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { typeKey } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES } from '../codes.js'

type Elem = 'f32' | 'i32' | 'u32' | 'bool' | 'f64'

/** A scalar (`n` 1) or vector of a numeric or bool element kind; a matrix, struct, array,
 *  texture or sampler has no shape here. */
interface Shape {
  readonly elem: Elem
  readonly n: 1 | 2 | 3 | 4
}

function shapeOf(t: ShaderType): Shape | undefined {
  switch (t.kind) {
    case 'scalar':
      return { elem: t.scalar, n: 1 }
    case 'f64':
      return { elem: 'f64', n: 1 }
    case 'vec':
      return { elem: t.elem, n: t.n }
    case 'vec64':
      return { elem: 'f64', n: t.n }
    default:
      return undefined
  }
}

const FLOAT: readonly Elem[] = ['f32', 'f64']
const INT: readonly Elem[] = ['i32', 'u32']
const NUMERIC: readonly Elem[] = ['f32', 'f64', 'i32', 'u32']
/** `sign` is defined for floats and signed integers; a `u32` has no sign to take. */
const SIGNED: readonly Elem[] = ['f32', 'f64', 'i32']

/** What an argument after the first must be, measured against the first. */
type Role =
  /** The first argument's type exactly (`min(a, b)`, `clamp(x, lo, hi)`). */
  | 'same'
  /** The first argument's type, or a scalar of its element kind (`mix`'s factor, `mod`'s divisor). */
  | 'sameOrScalar'
  /** A scalar of the first argument's element kind (`refract`'s eta). */
  | 'scalar'
  /** An `i32`, or a vector of them of the first argument's size (`ldexp`'s exponent). */
  | 'i32Of'
  /** A `u32` scalar (`extractBits`' and `insertBits`' offset and count). */
  | 'u32'

interface Spec {
  /** The element kinds the first argument may have. */
  readonly elems: readonly Elem[]
  /** The first argument must be a vector. */
  readonly vector?: true
  /** The first argument must be a `vec3` (`cross`). */
  readonly vec3?: true
  /** The role of each later argument; `same` when not listed. */
  readonly roles?: Readonly<Record<number, Role>>
}

const same = (elems: readonly Elem[]): Spec => ({ elems })
const FLOAT_SAME = same(FLOAT)

/** One entry per free math builtin the surface lowers as a `call`; `f32` (a cast), `select`,
 *  `any` and `all` are lowered elsewhere and are not here. A name without an entry is checked
 *  by arity alone, as before.
 *
 *  Exported for `math-args.test.ts`, which iterates it: the table is the contract, so the suite
 *  that pins the contract must be driven BY the table rather than by a second hand list beside
 *  it. Not on the public barrel. */
export const MATH_ARG_SPECS: Readonly<Record<string, Spec>> = {
  // Componentwise on floats.
  acos: FLOAT_SAME,
  acosh: FLOAT_SAME,
  asin: FLOAT_SAME,
  asinh: FLOAT_SAME,
  atan: FLOAT_SAME,
  atanh: FLOAT_SAME,
  atan2: FLOAT_SAME,
  ceil: FLOAT_SAME,
  cos: FLOAT_SAME,
  cosh: FLOAT_SAME,
  degrees: FLOAT_SAME,
  exp: FLOAT_SAME,
  exp2: FLOAT_SAME,
  floor: FLOAT_SAME,
  fma: FLOAT_SAME,
  fract: FLOAT_SAME,
  inverseSqrt: FLOAT_SAME,
  log: FLOAT_SAME,
  log2: FLOAT_SAME,
  pow: FLOAT_SAME,
  radians: FLOAT_SAME,
  round: FLOAT_SAME,
  saturate: FLOAT_SAME,
  sin: FLOAT_SAME,
  sinh: FLOAT_SAME,
  smoothstep: FLOAT_SAME,
  sqrt: FLOAT_SAME,
  step: FLOAT_SAME,
  tan: FLOAT_SAME,
  tanh: FLOAT_SAME,
  trunc: FLOAT_SAME,
  // The derivatives, on floats.
  dpdx: FLOAT_SAME,
  dpdy: FLOAT_SAME,
  fwidth: FLOAT_SAME,
  dpdxCoarse: FLOAT_SAME,
  dpdxFine: FLOAT_SAME,
  dpdyCoarse: FLOAT_SAME,
  dpdyFine: FLOAT_SAME,
  fwidthCoarse: FLOAT_SAME,
  fwidthFine: FLOAT_SAME,
  // Componentwise on any number.
  abs: same(NUMERIC),
  sign: same(SIGNED),
  min: same(NUMERIC),
  max: same(NUMERIC),
  clamp: same(NUMERIC),
  // The blends: `mix(a, b, t)` takes `t` as the vectors' type or a scalar of their kind, which
  // WGSL and GLSL both spell; `mod(x, y)` takes a scalar `y` against a vector `x`, which its
  // floor-mod spelling on WGSL and GLSL's `mod(vec, float)` both accept.
  mix: { elems: FLOAT, roles: { 2: 'sameOrScalar' } },
  mod: { elems: FLOAT, roles: { 1: 'sameOrScalar' } },
  // Lengths and products: `length` and `distance` take a scalar or a vector, `dot` vectors of
  // any numeric kind, the geometry four float vectors.
  length: FLOAT_SAME,
  distance: FLOAT_SAME,
  dot: { elems: NUMERIC, vector: true },
  normalize: { elems: FLOAT, vector: true },
  cross: { elems: FLOAT, vector: true, vec3: true },
  reflect: { elems: FLOAT, vector: true },
  refract: { elems: FLOAT, vector: true, roles: { 2: 'scalar' } },
  faceForward: { elems: FLOAT, vector: true },
  ldexp: { elems: FLOAT, roles: { 1: 'i32Of' } },
  // The bit builtins, on integers.
  countOneBits: same(INT),
  reverseBits: same(INT),
  countLeadingZeros: same(INT),
  countTrailingZeros: same(INT),
  firstLeadingBit: same(INT),
  firstTrailingBit: same(INT),
  extractBits: { elems: INT, roles: { 1: 'u32', 2: 'u32' } },
  insertBits: { elems: INT, roles: { 2: 'u32', 3: 'u32' } },
}

/** Whether the builtin `fn` has a form on the element kind `elem`: `min` on an i32, yes; `pow`,
 *  no. A name without a spec is taken to have one, as before the check existed. */
export function mathTakesElem(fn: string, elem: string): boolean {
  const spec = MATH_ARG_SPECS[fn]
  return spec === undefined || (spec.elems as readonly string[]).includes(elem)
}

/** The builtins that take a matrix, checked apart from the shapes above. */
const MATRIX_FNS: ReadonlySet<string> = new Set(['transpose', 'determinant'])

const VEC_SUFFIX: Readonly<Record<string, string>> = { f32: '', i32: 'i', u32: 'u', bool: 'b' }

/** How the surface writes `t`'s vector of `n` (`vec3`, `vec2i`, `vec4u`), for a fix. */
function vectorSpelling(elem: Elem, n: number): string {
  return `vec${n}${VEC_SUFFIX[elem] ?? ''}`
}

function classWord(elems: readonly Elem[]): string {
  if (elems === FLOAT) return 'an f32, or a vector of them'
  if (elems === INT) return 'an i32 or u32, or a vector of them'
  if (elems === SIGNED) return 'an f32 or i32, or a vector of them'
  return 'a number, or a vector of them'
}

/** The fix for two shapes that had to agree, or an empty string where none is short enough
 *  to say: a scalar beside a vector of its kind is splatted, two kinds of one shape are cast,
 *  two vector sizes are a rewrite. */
function sameFix(first: Shape, other: Shape): string {
  if (first.elem === other.elem) {
    if (first.n !== 1 && other.n === 1) {
      return ` Splat the scalar to the vector's size: ${vectorSpelling(first.elem, first.n)}(x).`
    }
    if (first.n === 1 && other.n !== 1) {
      return ` Splat the scalar to the vector's size: ${vectorSpelling(other.elem, other.n)}(x).`
    }
    return ' Give the vectors one size.'
  }
  if (first.n === other.n && first.elem !== 'bool' && other.elem !== 'bool') {
    const cast = (s: Shape): string =>
      s.n === 1 ? `${s.elem}(x)` : `${vectorSpelling(s.elem, s.n)}(x)`
    return ` Cast one side: ${cast(first)} or ${cast(other)}.`
  }
  return ''
}

/** Checks the arguments of the math builtin `fn` (already at its arity) against its
 *  signature, pushing one diagnostic on the first argument that does not fit.
 *
 *  @param fn The canonical builtin id (`atan2`, not the `atan` it was written as).
 *  @param display The name as written, for the message (`Math.min`, `atan`).
 *  @returns `true` when the call is well formed. */
export function checkMathArgs(
  fn: string,
  display: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const refuse = (index: number, message: string): false => {
    diagnostics.push(
      makeDiagnostic(sourceFile, node.arguments[index] ?? node, message, TS_CODES.MATH_ARGUMENT),
    )
    return false
  }
  const first = args[0]
  if (first === undefined) return true
  if (MATRIX_FNS.has(fn)) {
    if (first.type.kind !== 'mat') {
      return refuse(0, `${display} takes a matrix; got ${typeKey(first.type)}.`)
    }
    return true
  }
  const spec = MATH_ARG_SPECS[fn]
  if (spec === undefined) return true
  const shapes = args.map((a) => shapeOf(a.type))
  // An emulated double is the fp64 pass's business: it lifts an f32 beside an f64 itself.
  if (shapes.some((s) => s?.elem === 'f64')) return true
  const head = shapes[0]
  if (head === undefined || !spec.elems.includes(head.elem)) {
    return refuse(0, `${display} takes ${classWord(spec.elems)}; got ${typeKey(first.type)}.`)
  }
  if (spec.vec3 && head.n !== 3) {
    return refuse(
      0,
      `${display} takes two ${vectorSpelling(head.elem, 3)}; got ${typeKey(first.type)}.`,
    )
  }
  if (spec.vector && head.n === 1) {
    return refuse(0, `${display} takes vectors; got ${typeKey(first.type)}.`)
  }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    const shape = shapes[i]
    const role: Role = spec.roles?.[i] ?? 'same'
    const got = typeKey(arg.type)
    switch (role) {
      case 'same':
        if (shape !== undefined && shape.elem === head.elem && shape.n === head.n) break
        return refuse(
          i,
          `${display} takes arguments of one type; the first is ${typeKey(first.type)}, this one ${got}.` +
            (shape === undefined ? '' : sameFix(head, shape)),
        )
      case 'sameOrScalar':
        if (
          shape !== undefined &&
          shape.elem === head.elem &&
          (shape.n === head.n || shape.n === 1)
        ) {
          break
        }
        return refuse(
          i,
          `${display} takes this argument as ${typeKey(first.type)}, the first argument's type, or as ` +
            `a scalar ${head.elem}; got ${got}.`,
        )
      case 'scalar':
        if (shape !== undefined && shape.elem === head.elem && shape.n === 1) break
        return refuse(i, `${display} takes a scalar ${head.elem} here; got ${got}.`)
      case 'i32Of':
        if (shape !== undefined && shape.elem === 'i32' && shape.n === head.n) break
        return refuse(
          i,
          head.n === 1
            ? `${display} takes an i32 exponent; got ${got}.`
            : `${display} takes a ${vectorSpelling('i32', head.n)} exponent for a ` +
                `${typeKey(first.type)} x, one component each; got ${got}.`,
        )
      case 'u32':
        if (shape !== undefined && shape.elem === 'u32' && shape.n === 1) break
        return refuse(i, `${display} takes a u32 offset and count; got ${got}.`)
    }
  }
  return true
}
