// ═══ The `.shade.ts` corpus — `"use typeshade"` source, wrapped as registry entries ═══
//
// Seven example files opened with `"use typeshade"` and shipped in this directory
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
    id: 'hello-uniform-struct',
    title: 'Hello uniform block',
    blurb:
      'The uniform that DOES have a GLSL ES 3.00 form: a `Uniforms` class behind `uniform<T>` lays out as a std140 block on both targets, so unlike `hello-uniform` this one emits and links on WebGL2. The first source-compiled example with a binding and a renderable GLSL pair — the configuration whose absence let #14 hide.',
    renderable: true,
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
    id: 'array-literal-ramp',
    title: 'Array literals',
    blurb:
      'A fullscreen triangle whose corners come from two `array<f32, 3>` lists and whose colour comes from an `array<vec3, 3>` of stops weighted by an `array<i32, 3>` — a list at every element type the initializer form takes, through Tint and a real WebGL2 context.',
    renderable: true,
  },
  {
    id: 'twin-structs',
    title: 'Twin IO structs',
    blurb:
      'Two IO structs with identical fields, a vertex output and a fragment input, with object literals in all three positions that declare which one they build: a return type, an annotation and a parameter type. The case matching field names alone cannot decide.',
    renderable: true,
  },
  {
    id: 'bitfield-bands',
    title: 'Bitfield bands',
    blurb:
      'A fullscreen triangle whose colour is chosen by a `switch` over a band index built with `&=`, `|=`, `<<=`, `>>=` and `^=`, with `let x: f32` declared before it is assigned and the varyings returned as `{ pos, uv }` shorthand.',
    renderable: true,
  },
  {
    id: 'textured-quad',
    title: 'Texture, sampler and overrides',
    blurb:
      'A fullscreen triangle sampling a `texture_2d<f32>` through a `sampler`, tinted by two `override<f32>` specialization constants — WGSL declares the handles and the overrides, GLSL ES 3.00 fuses texture and sampler into one `sampler2D` and spells each override as a `#define`.',
    renderable: true,
  },
  {
    id: 'palette-const',
    title: 'Module vector and array constants',
    blurb:
      'A fullscreen triangle banded by a module-scope `array<vec4, 3>` palette and an `array<f32, 3>` of stops, with a `vec3` constant built from an earlier scalar one — every shape a module constant can now take, read from both stages.',
    renderable: true,
  },
  {
    id: 'convert-grid',
    title: 'Converting constructors',
    blurb:
      'A fullscreen triangle whose corner comes from `vec2(vec2u(...))` and whose colour comes from an `f32`→`u32`→`f32` round trip — the element-converting constructor in both directions and at both ends of the pipeline.',
    renderable: true,
  },
  {
    id: 'module-const',
    title: 'Module constants',
    blurb:
      'A module-scope constant of every scalar type the compiler allows — `u32`, `i32`, `f32`, `bool` — each one used, so the compile gate hands every spelling to Tint and to a real WebGL2 context.',
    renderable: true,
  },
  {
    id: 'hillshade-twin',
    title: 'Hillshade (source twin)',
    blurb:
      '`hillshade.ts` written in the source language: the Horn 3x3 gradient over a procedural height field, lit by a sun azimuth. The cartographic twin — the shading maths reads the same on both surfaces because it is all plain arithmetic.',
    renderable: true,
    twinOf: 'hillshade',
  },
  {
    id: 'plasma-twin',
    title: 'Plasma (source twin)',
    blurb:
      '`shadertoy-plasma.ts` written in the source language: three interfering sine waves, the same wave at three phase offsets becoming the three colour channels. The smallest fullscreen twin there is.',
    renderable: true,
    twinOf: 'plasma',
  },
  {
    id: 'julia-twin',
    title: 'Julia set (source twin)',
    blurb:
      '`julia.ts` written in the source language: the escape-time iteration as a `for` loop with a `break`, and the orbiting constant handed over to the pointer through a `mix`.',
    renderable: true,
    twinOf: 'julia',
  },
  {
    id: 'mandelbrot-twin',
    title: 'Mandelbrot set (source twin)',
    blurb:
      "`mandelbrot.ts` written in the source language: the same smooth escape-time colouring, with the EDSL's `.neg()` spelled as the unary minus it always was.",
    renderable: true,
    twinOf: 'mandelbrot',
  },
  {
    id: 'domain-warp-twin',
    title: 'Domain warping (source twin)',
    blurb:
      '`domain-warp.ts` written in the source language: hash, value noise and a 4-octave fbm as three plain helper functions, then fed their own output twice over. The twin with the deepest call graph.',
    renderable: true,
    twinOf: 'domain-warp',
  },
  {
    id: 'tunnel-twin',
    title: 'Tunnel (source twin)',
    blurb:
      '`tunnel.ts` written in the source language: polar coordinates with 1/r for the receding wall, twisted by an angle that grows with depth.',
    renderable: true,
    twinOf: 'tunnel',
  },
  {
    id: 'ocean-twin',
    title: 'Ocean horizon (source twin)',
    blurb:
      '`ocean.ts` written in the source language: the fBm octave accumulator as a `for` loop over three mutated locals, where the EDSL mutates three auto-vars. Sky and sea both evaluated, blended by a horizon step.',
    renderable: true,
    twinOf: 'ocean',
  },
  {
    id: 'starfield-twin',
    title: 'Starfield (source twin)',
    blurb:
      '`starfield.ts` written in the source language: three parallax layers accumulated into one mutated `vec3` local across a `for` loop, each cell hashed for whether it holds a star.',
    renderable: true,
    twinOf: 'starfield',
  },
  {
    id: 'kaleidoscope-twin',
    title: 'Kaleidoscope (source twin)',
    blurb:
      '`kaleidoscope.ts` written in the source language: the polar mirror fold through `mod`, the portable floor-mod, so the negative angles `atan2` produces wrap identically on both targets.',
    renderable: true,
    twinOf: 'kaleidoscope',
  },
  {
    id: 'gradient-twin',
    title: 'Gradient pass (source twin)',
    blurb:
      '`gradient-pass.ts` written in the source language instead of built with `fn()` / `module()` — the same shader through the other surface, with a uniform block both targets lay out and a GLSL pair that links.',
    renderable: true,
    twinOf: 'gradient',
  },
  {
    id: 'cutout',
    title: 'Cutout (source language)',
    blurb:
      "`discard` in a helper the fragment entry calls, with `fwidth` softening the rim and `saturate`, `exp2` and `**` shaping the falloff — the example that carries #8 A6's spellings to Tint and a real WebGL2 context. Renders a circular cutout with a radial centre-to-rim gradient.",
    renderable: true,
  },
  {
    id: 'compute-reduction-twin',
    title: 'Compute reduction (source twin)',
    blurb:
      "`compute-reduction.ts` written in the source language: the EDSL's `reduce()` combinator spelled as the `for` loop it expands into. WGSL-only like its original — GLSL ES 3.00 has no compute stage.",
    renderable: false,
    twinOf: 'compute-reduction',
  },
  {
    id: 'array-length',
    title: 'Runtime array length',
    blurb:
      "The bounds guard every kernel over a runtime-sized storage array needs: `src.length` reads the bound buffer's length as WGSL `arrayLength(&src)`, a `u32`, so the guard is real where it once folded to `gid.x >= 0u` and returned every invocation (#46). WGSL-only: GLSL ES 3.00 has no storage buffers.",
    renderable: false,
  },
  {
    id: 'block-scope',
    title: 'Block scope',
    blurb:
      'Two sequential loops over `i`, a `p` in a loop body beside a `p` in an `if` arm, and an inner `p` that shadows the outer one: the block scoping TypeScript has and the IR now follows, with the second declaration of each name emitted as `i_1`, `p_1` (#38). Also a float `%=` for GLSL ES 3.00 (#20) and a shift inside 0 to 31 (#71). Renders concentric rings.',
    renderable: true,
  },
  {
    id: 'atomic-histogram',
    title: 'Atomic histogram',
    blurb:
      'Many invocations count into one bin at once with `atomicAdd(bins[bin], 1)`, one indivisible step each; a storage struct field and a bare `storage<atomic<u32>>` binding show the other two shapes of location, and the value an atomic returns is what it held before. WGSL-only: GLSL ES 3.00 has no storage buffers and no atomics.',
    renderable: false,
  },
  {
    id: 'private-state',
    title: 'Per-invocation state',
    blurb:
      "`let seed: perInvocation<u32>` is WGSL's `var<private>`, one copy per invocation that every function of the invocation shares: a random-number generator keeps its state in it instead of threading a seed through each call (§24). GLSL ES 3.00 spells it as a plain global, so it renders on both targets. Renders a hash-noise field.",
    renderable: true,
  },
  {
    id: 'workgroup-scratch',
    title: 'Workgroup scratch memory',
    blurb:
      "`let tile: workgroup<array<f32, 64>>` is WGSL's `var<workgroup>`, one copy per workgroup its invocations share, here as scratch each invocation owns a slot of, beside a workgroup array of atomics and a per-invocation counter (§24). WGSL-only: WebGL2 has no compute stage and no workgroup memory.",
    renderable: false,
  },
  {
    id: 'workgroup-reduce',
    title: 'Workgroup reduction',
    blurb:
      '64 invocations sum 64 values into one through workgroup memory, with `workgroupBarrier()` ordering the rounds (§25). On the CPU it runs through `dispatch`, which holds every invocation of a workgroup at each barrier; a workgroup whose invocations disagree about a barrier is refused with the line and the counts. WGSL-only: WebGL2 has no compute stage.',
    renderable: false,
  },
  {
    id: 'default-args',
    title: 'Default parameter values',
    blurb:
      "Three helpers with default parameters, each called with a different argument omitted (§14). Neither target has default arguments, so the emitted function keeps every parameter and the call site carries the value: `vignette(v.uv)` emits `vignette(v.uv, 0.8, 1.35)`. A default may read a module const and call a helper, since it is lowered once in the module's scope.",
    renderable: true,
  },
  {
    id: 'shape-inheritance',
    title: 'Inheritance',
    blurb:
      "An `abstract class Shape` with a concrete method and an abstract one, two classes that extend it, and one that extends a subclass and calls `super` (§26). A struct is flat, with the base's fields first, and dispatch is static: a class inherits a method by lowering the base's body again with `this` typed as itself, so `coverage` calls each class's own `sdf` and no `Shape_coverage` is emitted.",
    renderable: true,
  },
  {
    id: 'bare-position',
    title: 'A vertex that returns only the position',
    blurb:
      'The smallest render pair: a vertex entry whose return is typed `vec4`, which carries `@builtin(position)` on its own, and a fragment entry that reads `@builtin(position)` and returns one colour. Nothing travels between the stages, so no I/O struct is needed. On GLSL ES 3.00 the return is `gl_Position`, which is not a varying and links nothing.',
    renderable: true,
  },
  {
    id: 'tuple-and-brand',
    title: 'A tuple and a branded alias',
    blurb:
      "A tuple is a list of a length the type fixes, which is what `array<T, N>` is, so `[f32, f32]` IS `array<f32, 2>` (§28): it is returned, taken as a parameter and written as a list at the call site, and the emitted WGSL and GLSL know only the array. A brand, `f32 & { readonly [m]: 'm' }`, is the nominal-typing idiom; it carries no data, so it is erased and the parameter is an f32.",
    renderable: true,
  },
  {
    id: 'ray-class',
    title: 'Class methods',
    blurb:
      'A `class Ray` with a constructor, a method and a static function, and a `class Sphere` whose `hit(ray)` method returns the distance along the ray (§26). Each method is a function whose first parameter is the struct, so both targets carry it as written; a fullscreen triangle shades the sphere by its normal.',
    renderable: true,
  },
  {
    id: 'particle-step',
    title: 'Methods that change their object',
    blurb:
      'A `class Particle` whose `step`, `bounce` and `tick` assign to `this`, called on a storage element: each takes and returns the struct and the call statement writes the receiver back, `ps[gid.x] = Particle_tick(ps[gid.x], dt)` (§26). WGSL-only: a storage buffer and a compute stage have no WebGL2 form.',
    renderable: false,
  },
  {
    id: 'bool-select',
    title: 'Boolean vectors',
    blurb:
      'A comparison of two vectors is a vector of bools (§27): `v.uv > vec2(0.5)` masks the screen, `select` picks a colour per channel from two palettes through it, and `all`/`any` of the mask tint the corners. WGSL spells the comparison as an operator, GLSL ES 3.00 as `lessThan`/`greaterThan` with `mix`; the gate runs both.',
    renderable: true,
  },
  {
    id: 'bit-bump',
    title: 'Builtin breadth',
    blurb:
      '`reflect`, `refract` and `faceForward` light a bump, `transpose` and `determinant` read the host matrix, and the bit builtins (`firstLeadingBit`, `reverseBits`, `countOneBits`, `extractBits`, `insertBits`) band the screen, with `fwidthCoarse` marking where a band starts (§10). GLSL ES 3.00 spells several of them differently and casts `findMSB` back to `uint`; the gate runs both.',
    renderable: true,
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
