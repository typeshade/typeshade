// ═══ The `.shade.ts` corpus — `"use typeshade"` source, wrapped as registry entries ═══
//
// Five example files opened with `"use typeshade"` and shipped in this directory
// (`hello.shade.ts` and friends). Until now they were authored and then left dangling: no
// test emitted them, the compile gate never saw them, and nothing in the package would have
// noticed if a compiler change turned one into a shader that no longer compiles. This file
// is the missing wire — it gives each one the same `ShaderExample` shape the `fn()` EDSL
// examples have, so every consumer that reads `module` + `renderable` takes both corpora
// without caring which surface wrote them.
//
// WHY THESE ARE NOT IN `examples` (index.ts). The obvious move is to append them to the
// curated registry. It does not work, and the reason is worth writing down so the next
// reader does not re-try it: `examples` is consumed at BUILD TIME by typeshade.github.io
// (`src/lib/examples.ts`), and three of its gates fail on any entry added here —
//
//   1. `wgslOnlyExample()` throws unless EXACTLY ONE registered example refuses to emit
//      GLSL. `compute-reduction` is that one; `hello-uniform` would be a second.
//   2. `checkedBlurbs()` throws unless every registered id has a hand-written description
//      in EVERY locale (src/i18n/en.ts, ko.ts) — five new ids, ten new lines, in a
//      repository this change does not touch.
//   3. `ExamplesPage.astro` groups rows through `e.categories[x.category]`, a typed record
//      with exactly `cartographic | generic | compute` keys. A fourth category is a type
//      error in the site build.
//
// So the split is not squeamishness about the existing 36: appending would break the site
// the next time it re-pins this submodule, and the fix belongs in that repository, in the
// same change that decides how a `"use typeshade"` example should be PRESENTED. Until
// then the corpus is wired to everything that lives here — the gate and the goldens below
// — and to nothing that lives there.
//
// WHY IT READS THE FILESYSTEM. A `.shade.ts` file is not an importable TypeScript module.
// It is source TEXT for `compile()`: `vec4` and `u32` are the shader language's types, not
// declared TypeScript ones, and `tsconfig.tests.json` excludes the whole pattern from the
// type check for exactly that reason. There is no binding to import, so the wrapper reads
// the bytes and compiles them. That makes this module node-only, which is what the leading
// underscore has meant in this directory since `_scan.ts`: a helper, not an example, and
// not importable from a browser build. `examples/index.ts` stays runtime-free.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../src/index.js'
import type { ShaderExample } from './_shared.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The extension that marks a TypeShade source module — the same one `src/compiler/ts/vite.ts`
 *  filters on, so the corpus on disk and the bundler plugin agree on what a shade module is. */
export const SHADE_EXT = '.shade.ts'

/** The hand-written half of a `.shade.ts` registration: everything `compile()` cannot infer. */
interface ShadeSpec {
  /** Registry id. Also the golden filename stem, so it must not collide with an `examples` id. */
  readonly id: string
  readonly title: string
  readonly blurb: string
  /** Has a GLSL ES 3.00 form — both stages emit AND link. Authored, never derived: a flag
   *  computed by try/catch around the emitter agrees with the emitter by construction, and
   *  the compile gate would then have nothing left to catch. */
  readonly renderable: boolean
  /** The `examples` id this file is the source-language TWIN of: the same shader, authored
   *  through the other surface. Set it and `shade-twins.test.ts` pins the two emits side by
   *  side and compares the lowered modules — which is what turns "the EDSL corpus is the
   *  oracle" from a claim in the surface document into something a suite can fail on. */
  readonly twinOf?: string
}

/** The curated order, and the one place a `.shade.ts` file is registered.
 *
 *  `file` is `${id}${SHADE_EXT}` for every entry, which is why it is not spelled out: the
 *  drift arm in `shade-examples.test.ts` compares this list against the `*.shade.ts` files
 *  on disk in both directions, so a sixth file that nobody registers fails the suite rather
 *  than going quietly missing the way these five did. */
const SHADE_ORDER: readonly ShadeSpec[] = [
  {
    id: 'hello',
    title: 'Hello triangle',
    blurb:
      'The smallest complete TypeShade program — a vertex stage that positions three corners from `vertex_index` and a fragment stage that paints them flat red. Both stages, two IO structs, no resources.',
    renderable: true,
  },
  {
    id: 'hello-vsout',
    title: 'Hello varyings',
    blurb:
      'The triangle again, now carrying a `uv` varying from the vertex stage into the fragment stage through a shared `VsOut` class — the `@builtin("position")` + `@location(0)` pair that every interpolated value rides.',
    renderable: true,
  },
  {
    id: 'hello-vsin',
    title: 'Hello vertex attributes',
    blurb:
      'Vertex input from a buffer rather than from `vertex_index`: a `VsIn` class of `@location`-tagged attributes becomes GLSL `in` declarations and WGSL struct parameters from the one declaration.',
    renderable: true,
  },
  {
    id: 'hello-uniform',
    title: 'Hello uniform',
    blurb:
      'A bare `declare const scale: uniform<f32>` — the shortest resource declaration there is. WGSL takes a loose scalar uniform; GLSL ES 3.00 has no std140 block to put one in, so this example emits WGSL alone.',
    // GLSL ES 3.00 refuses the vertex stage outright (`uniform binding 'scale' must be a
    // struct (a std140 UBO block)`), so there is no stage pair to compile or link.
    renderable: false,
  },
  {
    id: 'hello-camera',
    title: 'Hello camera uniform',
    blurb:
      'A `Camera` class of `mat4` + `vec3` behind `uniform<Camera>`, read by a plain helper function. Shows the std140 block both backends lay out, and that a module needs no entry point to be a module.',
    // No `@vertex` / `@fragment` in the file: both GLSL stages emit, but what they emit is a
    // uniform block and a helper with no `main()`, which is not a linkable program.
    renderable: false,
  },
  {
    id: 'compute-reduction-twin',
    title: 'Compute reduction (source twin)',
    blurb:
      "`compute-reduction.ts` written in the source language: the EDSL's `reduce()` combinator spelled as the `for` loop it expands into. WGSL-only like its original — GLSL ES 3.00 has no compute stage.",
    renderable: false,
    twinOf: 'compute-reduction',
  },
]

/**
 * Compile one `.shade.ts` file into the registry shape the EDSL examples use.
 *
 * A compile error THROWS rather than registering a half-built module. The alternative —
 * registering whatever came back — is the failure this whole file exists to close: an
 * example that silently stops being a program, with every gate still green because the gate
 * is handed an empty module. A warning is not that: `compile()` reports a GLSL ES 3.00
 * refusal of a module whose WGSL exists as a `TS8015` warning (hello-uniform's loose scalar
 * uniform is one), and such an example is still a program, with `renderable: false` saying
 * which target it lacks.
 *
 * @param spec - the hand-written half of the registration.
 * @returns the example, with `module` compiled from the file's own bytes.
 * @throws when the file is missing, or when `compile()` reports an error diagnostic.
 */
function shadeExample(spec: ShadeSpec): ShaderExample {
  const file = `${spec.id}${SHADE_EXT}`
  const source = readFileSync(join(HERE, file), 'utf8')
  const { diagnostics, module } = compile(source)
  const errors = diagnostics.filter((d) => d.category === 'error')
  if (errors.length > 0) {
    const lines = errors.map(
      (d) => `  ${d.category} ${d.line}:${d.character} ${d.code ?? '—'} ${d.message}`,
    )
    throw new Error(`typeshade: ${file} does not compile\n${lines.join('\n')}`)
  }
  return {
    id: spec.id,
    title: spec.title,
    blurb: spec.blurb,
    category: 'source',
    file,
    module,
    renderable: spec.renderable,
  }
}

/** Every `"use typeshade"` example, compiled. Iterated by `scripts/compile-gate.ts` and
 *  `shade-examples.test.ts` alongside `examples`. */
export const shadeExamples: readonly ShaderExample[] = SHADE_ORDER.map((spec) => shadeExample(spec))

/** Twin id → the `examples` id it mirrors, for the entries that claim one. Kept here rather
 *  than on `ShaderExample` because the relationship belongs to this corpus: an EDSL example
 *  has no twin field to fill in, and `_shared.ts` is the shape the site consumes. */
export const SHADE_TWINS: ReadonlyMap<string, string> = new Map(
  SHADE_ORDER.flatMap((spec) =>
    spec.twinOf === undefined ? [] : [[spec.id, spec.twinOf] as const],
  ),
)
