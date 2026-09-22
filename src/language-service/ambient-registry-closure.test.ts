// ═══ S2 — the ambient library and the lowerer are the same surface ═══
//
// WHAT THIS CLOSES. Four authorities describe the same set of callable names: the ambient
// library the editor type-checks against (`ambient.ts`, `SHADE_DTS`), the intrinsic registry
// the backends spell from (`core/intrinsics.ts`), the doc table the hovers read
// (`language-service/docs.ts`) and the CPU oracle's own tables. Until now they were reconciled
// PAIRWISE and by hand: `docs.test.ts` pins ambient ↔ docs, `oracle-backend-parity.test.ts`
// pins registry ↔ CPU. Nobody pinned ambient ↔ LOWERER, which is the pair an author feels:
//
//   declared but not lowerable   the editor is green and `compile()` reports TS8004 —
//                                the worst shape, because the surface promised it.
//   lowerable but not declared   the compiler takes a program `tsc` refuses, so the example
//                                corpus compiles and the editor underlines it in red.
//
// Both directions are asserted here, both with an allowlist that states a reason per entry,
// and both allowlists are shrink-only BY MEASUREMENT: a name that has since become lowerable
// (or declared) fails the arm that holds its entry, so the lists cannot rot.
//
// WHAT THIS DOES NOT DO, and the measurement behind that. The audit's tests critique asked for
// a companion (its row P1-38): parse `SHADE_DTS` with the TypeScript compiler API, synthesise
// ONE CALL per declared overload from its parameter types, and assert that the generated
// program both type-checks and compiles. That is not here, and the reason is a count. The
// critique measured 121 `declare function` overloads; there are 329 today, over 59 distinct
// parameter types, and eight of those are generic or union shapes — `T`, `E`, `F`, `A`,
// `StorageTexel<F>`, `texture_2d<E> | texture_2d_array<E>` and two more — whose argument needs
// the constraint solver `tsc` has and a lookup table does not. A sweep built on a table would
// either skip them, leaving an allowlist larger than the assertion, or synthesise a wrong call
// and pin a wrong answer. The closure below is the half that CAN be asserted exactly, and the
// critique's own note says P1-38's findings would surface here as its failures.
//
// HOW "LOWERABLE" IS DERIVED. Not from a hand list: from the registries themselves — the
// catalogue (`INTRINSICS` ∪ `PORTABLE_INTRINSICS` ∪ `PRE_EMIT_INTRINSICS`), the WGSL surface
// name each id spells under, and the alias tables the front end resolves `Math.*` and the
// breadth builtins through. The authoring FORMS that are not registry rows at all — the vector
// constructors, `array`, the attribute decorators, the binding forms — are the one remaining
// hand list, and every entry in it carries a `compile()` witness, so it is a claim the
// compiler checks rather than a fourth list to keep in step.
import { describe, expect, it } from 'vitest'
import { SHADE_DTS } from './ambient.js'
import { INTRINSICS, PORTABLE_INTRINSICS, PRE_EMIT_INTRINSICS } from '../core/intrinsics.js'
import {
  BREADTH_BUILTINS,
  MATH_CONST_ALIAS,
  MATH_EXPAND_ALIAS,
  MATH_FN_ALIAS,
  USER_FIRST_BUILTINS,
} from '../compiler/ts/math-alias.js'
import { compile } from '../compiler/ts/compile.js'

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

/** `interface MathObject { … }` — the `Math.*` half of the surface, whose members are declared
 *  as an interface rather than as free functions. Sliced out by name so a member of some other
 *  interface cannot drift in. */
function mathObjectMembers(dts: string): string[] {
  const start = dts.indexOf('interface MathObject {')
  if (start < 0) return []
  const end = dts.indexOf('\n}', start)
  const body = dts.slice(start, end < 0 ? undefined : end)
  return [...body.matchAll(/^\s{2}(\w+)\s*[(<]/gm)].map((m) => m[1] ?? '')
}

/** Every name the EDITOR admits: the free `declare function` overloads and the `Math.*`
 *  members. Both halves, because the closure below is only as wide as what it reads. */
const DECLARED: readonly string[] = [
  ...new Set([
    ...[...SHADE_DTS.matchAll(/declare function (\w+)[(<]/g)].map((m) => m[1] ?? ''),
    ...mathObjectMembers(SHADE_DTS),
  ]),
].sort()

const CATALOGUE: readonly string[] = [
  ...Object.keys(INTRINSICS),
  ...PORTABLE_INTRINSICS,
  ...PRE_EMIT_INTRINSICS,
].sort()

/** The name an id is WRITTEN under: `textureSampleArray` and `textureSampleCubeArray` are
 *  overload-selection ids whose author-facing spelling is `textureSample`. An id whose
 *  spelling is not a plain call (`mod` inlines to `%`) is written under its own id. */
function surfaceNameOf(id: string): string {
  const spelling = (INTRINSICS as Readonly<Record<string, { wgsl(a: readonly string[]): string }>>)[
    id
  ]
  if (spelling === undefined) return id
  let text: string
  try {
    text = spelling.wgsl(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  } catch {
    return id
  }
  return /^([A-Za-z_]\w*)\s*\(/.exec(text)?.[1] ?? id
}

/** The authoring forms that are not registry rows: constructors, `array`, the attribute
 *  decorators and the two binding forms. Each carries a program that proves the lowerer takes
 *  it, so this list cannot claim something the compiler refuses. */
const EXPRESSION_FORMS: Readonly<Record<string, string>> = {
  vec2: 'vec2(0., 0.)',
  vec3: 'vec3(0., 0., 0.)',
  vec4: 'vec4(0., 0., 0., 1.)',
  vec2f: 'vec2f(0., 0.)',
  vec3f: 'vec3f(0., 0., 0.)',
  vec4f: 'vec4f(0., 0., 0., 1.)',
  vec2i: 'vec2i(0, 0)',
  vec3i: 'vec3i(0, 0, 0)',
  vec4i: 'vec4i(0, 0, 0, 1)',
  vec2u: 'vec2u(0, 0)',
  vec3u: 'vec3u(0, 0, 0)',
  vec4u: 'vec4u(0, 0, 0, 1)',
  vec2b: 'vec2b(true, false)',
  vec3b: 'vec3b(true, false, true)',
  vec4b: 'vec4b(true, false, true, false)',
  vec2f64: 'vec2f64(f64(0.), f64(0.))',
  vec3f64: 'vec3f64(f64(0.), f64(0.), f64(0.))',
  vec4f64: 'vec4f64(f64(0.), f64(0.), f64(0.), f64(0.))',
  array: 'array<f32, 2>(0., 1.)',
  fill: 'fill<f32, 2>(0.)',
  random: 'random(0.5)',
}

/** The forms that are written in a DECLARATION rather than in an expression. One program
 *  exercises all eleven, which is also the shape every example opens with. The last four are
 *  the entry-IO and uniformity attributes #158 and #161 added (§53, §54); they are listed here
 *  rather than excused on `DECLARED_NOT_LOWERABLE` because the witness below really does
 *  compile them and each one really does reach the emitted WGSL. */
const DECLARATION_FORMS: readonly string[] = [
  'builtin',
  'location',
  'vertex',
  'fragment',
  'compute',
  'uniform',
  'storage',
  'interpolate',
  'invariant',
  'blend_src',
  'diagnostic',
]

const DECLARATION_WITNESS = `"use typeshade"
interface U {
  k: f32;
}
declare const un: uniform<U>
declare let out: storage<array<f32>>
class V {
  @builtin("position") @invariant pos: vec4;
  @location(0) uv: vec2;
  @location(1) @interpolate("flat") id: u32;
}
class Dual {
  @location(0) @blend_src(0) a: vec4;
  @location(0) @blend_src(1) b: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): V {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.), id: i }
}
@fragment
@diagnostic("off", "derivative_uniformity")
export function fs(v: V): Dual {
  const c = vec4(un.k, 0., 0., 1.)
  return { a: c, b: c }
}
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = un.k
}
`

const LOWERABLE: ReadonlySet<string> = new Set([
  ...CATALOGUE,
  ...CATALOGUE.map(surfaceNameOf),
  ...Object.keys(MATH_FN_ALIAS),
  ...Object.keys(MATH_EXPAND_ALIAS),
  ...Object.keys(MATH_CONST_ALIAS),
  ...BREADTH_BUILTINS,
  ...USER_FIRST_BUILTINS,
  ...Object.keys(EXPRESSION_FORMS),
  ...DECLARATION_FORMS,
])

/** Declared in the ambient library and NOT lowerable — the editor promises what `compile()`
 *  refuses. Empty today; an entry needs the program that shows the refusal, and the issue. */
const DECLARED_NOT_LOWERABLE: Readonly<Record<string, string>> = {}

/** A catalogue id whose surface name the ambient library does NOT declare, on purpose. Each
 *  reason says which surface owns the id instead. */
const EDSL_ONLY = (what: string, issue: string): string =>
  `${what}; reachable from the EDSL only, with no front-end route (${issue})`
const INTERNAL = (what: string): string => `${what}; an internal id a writer emits, never authored`

// EIGHT IDS LEFT THIS LIST when #164 landed, and the shrink arm below named every one: the
// `pack2x16*`/`unpack2x16*` family plus `pack4x8unorm`/`unpack4x8unorm`, each of which the IR
// and both backends had always spelled while nothing on this surface could name it. `bitcastU32`
// and `bitcastF32` stay, because the authoring spelling is `bitcast<T>(e)` — one declared name
// over two catalogue ids, which is a mapping this list cannot express and #150 left as is.
const AUTHORABLE_NOT_DECLARED: Readonly<Record<string, string>> = {
  bitcastU32: EDSL_ONLY('audit G11: `bitcast<T>(e)` has no authoring spelling', '#150'),
  bitcastF32: EDSL_ONLY('audit G11: `bitcast<T>(e)` has no authoring spelling', '#150'),
  f64FromParts: EDSL_ONLY('audit F64-13: the f64 lane bridge has no author spelling', '#151'),
  f64Parts: EDSL_ONLY('audit F64-13: the f64 lane bridge has no author spelling', '#151'),
  // An OPERATOR, not a name: `~` (#160, §52) is spelled by syntax, and the ambient library
  // declares functions, so there is nothing for it to declare — the same reason `+` and `*`
  // never appear here. Not a deferral and not an omission: the row is authorable today, and
  // `examples/__emit-goldens__/bit-bump.wgsl` carries the `~rolled` it emits.
  '~': 'an operator is spelled by syntax, not by a name, so the ambient library has nothing to declare for it (#160 added it, §52)',
  storageFetchF32: INTERNAL('the GLSL storage-emulation fetch helper'),
  storageFetchI32: INTERNAL('the GLSL storage-emulation fetch helper'),
  storageFetchU32: INTERNAL('the GLSL storage-emulation fetch helper'),
}

describe('the ambient library and the lowerer are the same surface (S2)', () => {
  it('reads both sides, and both HALVES of the declared side, so no arm below is vacuous', () => {
    expect(DECLARED.length).toBeGreaterThan(100)
    expect(CATALOGUE.length).toBeGreaterThan(100)
    expect(DECLARED).toContain('textureSample')
    expect(CATALOGUE).toContain('textureSampleCubeArray')
    // The `Math.*` half is read by a slice of the `.d.ts` text, which a rename of the
    // interface or a reindent would silently empty — and an empty half is a subset of
    // everything, so `declared ⊆ lowerable` would pass over nothing.
    expect(mathObjectMembers(SHADE_DTS).length).toBeGreaterThan(20)
    expect(mathObjectMembers(SHADE_DTS)).toContain('acosh')
  })

  it('lowers every authoring form this file claims is one, witness by witness', () => {
    // The hand list earns its place by being checked: a form here that `compile()` refuses
    // would otherwise widen LOWERABLE and hide a real declared-but-refused name.
    const refused: string[] = []
    for (const [name, expr] of Object.entries(EXPRESSION_FORMS)) {
      const errors = errorsOf(`"use typeshade"
export function f(): f32 {
  const a = ${expr}
  return 0.
}
`)
      if (errors.length > 0) refused.push(`${name}: ${errors[0] ?? ''}`)
    }
    expect(refused).toEqual([])
    expect(errorsOf(DECLARATION_WITNESS)).toEqual([])
  })

  it('refuses a name that is in no registry, so TS8004 is the signal this suite reads', () => {
    // The instrument check: if an unknown call compiled clean, "declared ⊆ lowerable" would
    // be true of every possible name and this file would prove nothing.
    expect(
      errorsOf(`"use typeshade"
export function f(): f32 {
  const a = notAnIntrinsicAnywhere(0.5)
  return 0.
}
`),
    ).not.toEqual([])
  })

  it('declares nothing the lowerer cannot take: declared ⊆ lowerable', () => {
    const orphans = DECLARED.filter(
      (name) => !LOWERABLE.has(name) && !(name in DECLARED_NOT_LOWERABLE),
    )
    expect(orphans).toEqual([])
  })

  it('takes nothing the editor would underline: authorable ⊆ declared', () => {
    const undeclared = CATALOGUE.filter(
      (id) => !DECLARED.includes(surfaceNameOf(id)) && !(id in AUTHORABLE_NOT_DECLARED),
    )
    expect(undeclared).toEqual([])
  })

  it('loses the AUTHORABLE_NOT_DECLARED entry of an id the ambient library has since declared', () => {
    const declared = Object.keys(AUTHORABLE_NOT_DECLARED).filter((id) =>
      DECLARED.includes(surfaceNameOf(id)),
    )
    expect(declared).toEqual([])
  })

  it('names, for every allowlisted id, the surface that owns it instead', () => {
    const vague = Object.entries(AUTHORABLE_NOT_DECLARED).filter(
      ([, reason]) => !/#\d+|internal id/.test(reason),
    )
    expect(vague.map(([id]) => id)).toEqual([])
  })

  it('keeps every allowlisted id a row of the catalogue, so a removed id loses its entry', () => {
    expect(Object.keys(AUTHORABLE_NOT_DECLARED).filter((id) => !CATALOGUE.includes(id))).toEqual([])
    expect(Object.keys(DECLARED_NOT_LOWERABLE).filter((n) => !DECLARED.includes(n))).toEqual([])
  })
})
