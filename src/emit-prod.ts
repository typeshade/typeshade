// ═══ Shader DSL — production-emit plugins (`@xgis/shader-dsl/emit-prod`) ═══
//
// Ship-time transforms for the emitted shader text, composed the Vite/Webpack
// way: each transform is a named EmitPlugin, and you pass a `{ plugins: [...] }`
// bag to the emit call. Deliberately on its OWN subpath — the core emit path
// carries only the neutral plugin seam, so a runtime-emit consumer that never
// imports this module bundles ZERO bytes of it. This is where the
// production-emit axis grows (a forced-inline plugin is the planned next
// resident); the main barrel stays runtime-only, the same split
// `@xgis/shader-dsl/dev` made for the lint/measure tooling (#740 R2b).
//
// Typical build-time use:
//
//   import { obfuscate, decodeShaderLog } from '@xgis/shader-dsl/emit-prod'
//   const renames = new Map<string, string>()
//   const fs = emitGlslModule(m, 'fragment', {
//     parens: 'minimal',
//     plugins: obfuscate({ renames }),
//   })
//   // …keep `renames` out of the bundle; it is what turns a shipped driver
//   // error back into authored names:
//   console.error(decodeShaderLog(info.messages[0].message, renames))
//
// Every renderable example is compiled AND pixel-compared through obfuscate()
// on real Tint + ANGLE by playground/e2e/_emit-obfuscate-gate.spec.ts.

import type { EmitPlugin } from './core/emit.js'
import { mangleModule } from './core/passes/mangle.js'
import { minifyShaderText, type MinifyOptions } from './core/emit-minify.js'
import { aliasShaderTypes } from './core/emit-alias.js'
import { pruneRedundantPrototypes } from './core/emit-prune.js'
import {
  forceInline as inlineModule,
  type InlineOpaque,
  type InlineDecision,
} from './core/passes/force-inline.js'

export type { EmitPlugin, EmitOptions } from './core/emit.js'
export { minifyShaderText, type MinifyOptions } from './core/emit-minify.js'
export { aliasShaderTypes } from './core/emit-alias.js'
export { pruneRedundantPrototypes } from './core/emit-prune.js'
export { decodeShaderLog, invertRenames, type DecodedName } from './core/decode-log.js'
export { mangleModule, type MangleResult } from './core/passes/mangle.js'
export type { InlineOpaque, InlineDecision } from './core/passes/force-inline.js'

/** Identifier-mangling plugin: renames the authored vocabulary to short names, and returns
 *  the mapping so a production driver log can be read back.
 *
 *  It renames helper function names, plain struct names, module constants including the
 *  injected `df64_` emulation library, the params of ordinary helpers, and every local. Names
 *  come from a bijective base-52 pool, `a`, `b`, through `Z`, then `aa`. One pool names the
 *  module scope, and a fresh pool names each function's own scope, so the short end of the
 *  alphabet is reused in every function instead of the counter climbing. That reuse is where
 *  the bytes are, since the optimizer's own generated temporaries are the heaviest identifier
 *  cost in the shipped text.
 *
 *  Five things are never renamed, because each is an ABI name someone outside the shader
 *  resolves by:
 *
 *  - entry-point names, which a pipeline names in `entryPoint`;
 *  - entry-point param names, because a non-struct entry param is the GLSL varying name, and
 *    the fragment side spells it from the param while the vertex side spells the same varying
 *    from its return struct's field name, in a separate emit call, so renaming one side links
 *    to nothing. Helper params have no such reader and are renamed;
 *  - binding names, the fp64 guard binding included, which hosts resolve by name;
 *  - binding-struct names, which are the GLSL uniform block tags;
 *  - struct field names, which std140 packing and the vertex-to-fragment varying link both
 *    read by name.
 *
 *  So a host driven by {@link reflect} binds unchanged.
 *
 *  Renaming is deterministic per module, in declaration order, which the two GLSL stage emits
 *  depend on: they are separate calls, and a program links only if both agree on the shared
 *  names.
 *
 *  Pass a `Map` as `renames` and it receives the authored-to-emitted mapping, the table
 *  {@link decodeShaderLog} inverts. A function-scoped entry is keyed `authoredFn.authoredName`,
 *  since those names are reused. Keep the map out of the shipped bundle.
 *
 *  A module containing a raw statement is returned unchanged, with an empty rename map: raw
 *  text can reference any name textually, nothing reads into it, and a rename around it would
 *  break the reference. One raw statement therefore makes this a no-op for the whole module.
 *
 *  It runs in the IR stage.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @param opts - `renames`, a map to receive the authored-to-emitted table.
 *  @returns the plugin, for an emit call's `plugins` array.
 *
 *  @example
 *  ```ts
 *  import { mangle, minify } from '@xgis/shader-dsl/emit-prod'
 *  import { emitModule } from '@xgis/shader-dsl'
 *
 *  const renames = new Map<string, string>()
 *  const wgsl = emitModule(MODULE, { plugins: [mangle({ renames }), minify()] })
 *  ```
 *
 *  @see {@link obfuscate} for the standard preset.
 *  @see {@link decodeShaderLog} for reading a driver log through the map.
 */
export function mangle(opts?: { renames?: Map<string, string> }): EmitPlugin {
  return {
    name: 'mangle',
    transformIR: (lowered) => {
      const r = mangleModule(lowered)
      if (opts?.renames) for (const [from, to] of r.renames) opts.renames.set(from, to)
      return r.module
    },
  }
}

/** Text-minification plugin: compacts the emitted string without changing what it means.
 *
 *  It lexes the text and re-emits the token stream, writing a separator only where leaving it
 *  out would merge the boundary. That is decided by re-lexing the pair and checking the first
 *  token is still the first token, the same maximal-munch rule the real compilers apply, so
 *  one rule covers every operator pair: `a- -b` keeps its space, while `)->f32` and `a=b*c`
 *  lose theirs. Neither language has string literals, so a `//` always starts a comment and
 *  whitespace is never significant inside a token, which is what makes the rule sound.
 *
 *  Comments go, line comments and block comments alike. Preprocessor directives keep their own
 *  line, since `#version` and `#extension` must sit on one, with internal runs collapsed to a
 *  single space. A trailing comma before a closer is dropped.
 *
 *  Numeric literals are canonicalised losslessly. Leading zeros of the integer part, trailing
 *  zeros of the fraction, a `+` and leading zeros in the exponent, and a `.` made redundant by
 *  an exponent all go: `0.500` becomes `.5`, `1.0` becomes `1.`, `1.0e-07` becomes `1e-7`. The
 *  exponent spelling is taken wherever the fixed form pays for zeros, `.0001` becomes `1e-4`
 *  and `1000000.` becomes `1e6`, which is exact because only the decimal point moves. No
 *  significand digit is ever dropped, and a float with no exponent always keeps its `.`, since
 *  `1` is an integer in WGSL.
 *
 *  `{ numbers: 'f32' }` goes further and re-spells each float as the shortest decimal that
 *  rounds to the same f32. `0.800000011920929` is the f64 printout of the f32 nearest 0.8, and
 *  `.8` loads identical bits. That is exact, because a decimal float literal
 *  in an f32 context is rounded to f32 by the compiler, and this emitter spells only bool,
 *  i32, u32 and f32 literals. It is a claim about the context, so the mode stands down to the
 *  lossless canonicalisation for any shader whose token stream mentions `f16`, where the
 *  context may not be f32. `{ numbers: false }` leaves literals exactly as emitted, which is
 *  what you want when diffing against a hand-checked baseline.
 *
 *  The pass is idempotent, and it runs in the text stage.
 *
 *  {@link minifyShaderText} is the raw function it wraps, for a string you already hold.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @param opts - `numbers`: `true` for the lossless canonicalisation (the default), `'f32'` for
 *    the shortest f32-exact spelling, `false` to leave literals alone.
 *  @returns the plugin, for an emit call's `plugins` array.
 *
 *  @example
 *  ```ts
 *  import { minify } from '@xgis/shader-dsl/emit-prod'
 *  import { emitGlslModule } from '@xgis/shader-dsl'
 *
 *  const fs = emitGlslModule(MODULE, 'fragment', { plugins: [minify({ numbers: 'f32' })] })
 *  ```
 *
 *  @see {@link minifyShaderText} for the function behind it.
 *  @see {@link obfuscate} for the preset that includes it.
 */
export function minify(opts?: MinifyOptions): EmitPlugin {
  return { name: 'minify', transformText: (code) => minifyShaderText(code, opts) }
}

/** Call-graph-flattening plugin: inlines every helper it can at all its call sites, so those
 *  functions vanish from the output and a reader has no structure left to follow.
 *
 *  A single-return helper inlines by expression substitution, its body becoming the expression
 *  at each call. A multi-statement helper with a single exit inlines by lifting its statements
 *  into the caller ahead of the call, which is sound because shader code is pure, so computing
 *  a value earlier in the same block changes no result. The lifted prelude may contain control
 *  flow.
 *
 *  What it leaves alone: entry points and recursive functions, always; a helper whose body it
 *  cannot lift, which is one with a second exit, with a `break` or `continue` that would bind
 *  to the caller's loop, with a `discard`, or with a raw statement; and, at the default
 *  `opaque: 'keep'`, the injected `df64_` emulation library, whose bodies carry a
 *  do-not-optimize flag.
 *
 *  `opaque` is the one axis, and its three values are a ladder. `'keep'` never touches an
 *  opaque helper, which on an fp64 module means the emit does not move at all, since the
 *  emulation library is all there is to inline there. `'single-call'` also unlocks an opaque
 *  helper with exactly one call site, where removing the declaration and its one call
 *  duplicates nothing. `'all'` unlocks every one, so the library leaves the output entirely
 *  and the call graph really does disappear, at five to twenty-seven times the emitted bytes.
 *  Values are unchanged at every setting. `maxGrowth` caps how far the module's operation
 *  count may grow while unlocking, as a multiplier, and with a budget helpers are unlocked
 *  cheapest first; omitted, it is unlimited.
 *
 *  It is not a size win. A helper called from several sites is duplicated at each, and the
 *  following {@link minify} only recovers the whitespace. Duplicated text is not duplicated
 *  work, though: flattening is followed by a re-hoisting pass, so a value several inlined
 *  copies derive from the same argument is still computed once.
 *
 *  It runs in the IR stage, so place it before {@link mangle} in the array. It is opt-in and
 *  not part of {@link obfuscate}, so no existing output moves.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @param opts - `opaque` to unlock the emulation library, `maxGrowth` to cap how far the
 *    module's operation count may grow, and `report` to receive one decision per helper
 *    considered.
 *  @returns the plugin, for an emit call's `plugins` array.
 *
 *  @example
 *  ```ts
 *  import { inline, obfuscate } from '@xgis/shader-dsl/emit-prod'
 *  import { emitModule } from '@xgis/shader-dsl'
 *
 *  const wgsl = emitModule(MODULE, { plugins: [inline(), ...obfuscate()] })
 *  ```
 *
 *  @see {@link InlineDecision} for what `report` collects.
 *  @see {@link obfuscate} for the preset it goes in front of.
 */
export function inline(opts?: {
  opaque?: InlineOpaque
  maxGrowth?: number
  report?: InlineDecision[]
}): EmitPlugin {
  const opaque = opts?.opaque ?? 'keep'
  return {
    name: 'inline',
    transformIR: (m) =>
      inlineModule(m, opaque, { maxGrowth: opts?.maxGrowth, report: opts?.report }),
  }
}

/** Type-name aliasing plugin: gives each heavily used type a one-character name, declares it
 *  once, and rewrites every spelling of it, constructor position included.
 *
 *  Each target has its own spelling for the declaration. WGSL takes `alias A=vec2<f32>;`, and
 *  GLSL ES 3.00 takes `#define A vec2`. Both accept the short name everywhere the type was
 *  spelled, so `A(1.,2.)` is a constructor call on either.
 *
 *  Type names are the heaviest identifiers {@link mangle} may not touch, since both languages
 *  reserve them, and after mangling they are the largest remaining category in the shipped
 *  text.
 *
 *  A spelling must pay for its own declaration or it is skipped, so a type used once, a lone
 *  `mat4x3<f32>`, is left alone.
 *
 *  Alias names are drawn only from spellings that occur nowhere else in the text. A GLSL
 *  `#define` is textual and module-wide, so a name that already exists as an identifier would
 *  be captured by the macro.
 *
 *  A type token carrying a precision qualifier is never rewritten, because macro expansion
 *  inside a `precision` statement is a corner not worth the two lines it would save.
 *
 *  The pass splices by token offset, so it composes in either order with {@link minify} and
 *  leaves the rest of the formatting untouched. It reports `type` to `alias` into the same
 *  `renames` map {@link mangle} fills, in the same authored-to-emitted direction, so one map
 *  decodes both.
 *
 *  It runs in the text stage.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @param opts - `renames`, the same map {@link mangle} takes.
 *  @returns the plugin, for an emit call's `plugins` array.
 *
 *  @example
 *  ```ts
 *  import { mangle, aliasTypes } from '@xgis/shader-dsl/emit-prod'
 *  import { emitModule } from '@xgis/shader-dsl'
 *
 *  const renames = new Map<string, string>()
 *  const wgsl = emitModule(MODULE, { plugins: [mangle({ renames }), aliasTypes({ renames })] })
 *  ```
 *
 *  @see {@link decodeShaderLog} for reading a log through the shared map.
 */
export function aliasTypes(opts?: { renames?: Map<string, string> }): EmitPlugin {
  return {
    name: 'alias-types',
    transformText: (code) => aliasShaderTypes(code, opts?.renames),
  }
}

/** Forward-prototype pruning plugin, for GLSL ES 3.00.
 *
 *  A prototype is redundant exactly when the definition already declares the function at every
 *  one of its uses, which is decidable from the token stream, and those are the ones this
 *  drops. It keeps three kinds, each because it cannot prove the prototype is redundant: a
 *  function with no definition in this text, which is an extern body the host splices in; a
 *  call that appears before the definition; and a declarator whose shape it does not
 *  recognise.
 *
 *  On source the GLSL backend authored, this usually finds nothing, since the backend
 *  topologically sorts its own function section and emits a prototype only where the call
 *  graph forces one. It earns its place on the GLSL the backend did not author: hand-written
 *  raw text, host-spliced fragments, and the backend's own fallback when it cannot sort, which
 *  a raw helper body triggers by hiding its calls from the IR walk.
 *
 *  It is a no-op on WGSL, which resolves module-scope declarations out of order and has no
 *  prototype syntax at all.
 *
 *  It runs in the text stage.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @returns the plugin, for an emit call's `plugins` array.
 *
 *  @example
 *  ```ts
 *  import { prune, minify } from '@xgis/shader-dsl/emit-prod'
 *  import { emitGlslModule } from '@xgis/shader-dsl'
 *
 *  const fs = emitGlslModule(MODULE, 'fragment', { plugins: [prune(), minify()] })
 *  ```
 *
 *  @see {@link obfuscate} for the preset that includes it.
 */
export function prune(): EmitPlugin {
  return { name: 'prune-prototypes', transformText: pruneRedundantPrototypes }
}

/** The standard production preset. It expands, in order, to
 *  `[mangle(opts), prune(), aliasTypes(opts), minify({ numbers: 'f32' })]`: rename the
 *  authored vocabulary, drop the redundant GLSL prototypes, shorten the type vocabulary
 *  mangling may not rename, then compact the text with f32-exact literal re-spelling. Spread
 *  it into a `plugins` array, and pair it with `parens: 'minimal'` for the smallest shipped
 *  shader.
 *
 *  Plugins fire in two stages. Every plugin's `transformIR` runs, in array order, before the
 *  module is assembled into text, and then every plugin's `transformText` runs, in array
 *  order, over that text. So the IR-stage plugins, {@link inline} and {@link mangle}, compose
 *  in the order you list them and always run ahead of the text-stage ones, {@link prune},
 *  {@link aliasTypes} and {@link minify}, which compose in array order among themselves.
 *  Putting `inline()` in front of the spread is therefore enough to order it correctly.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @param opts - `renames`, the map both {@link mangle} and {@link aliasTypes} report into.
 *  @returns the four plugins, in order, to spread into a `plugins` array.
 *
 *  @example
 *  ```ts
 *  import { obfuscate, decodeShaderLog } from '@xgis/shader-dsl/emit-prod'
 *  import { emitGlslModule } from '@xgis/shader-dsl'
 *
 *  const renames = new Map<string, string>()
 *  const fs = emitGlslModule(MODULE, 'fragment', {
 *    parens: 'minimal',
 *    plugins: obfuscate({ renames }),
 *  })
 *  console.error(decodeShaderLog(driverLog, renames))
 *  ```
 *
 *  @see {@link inline} for the opt-in plugin that goes in front of it.
 *  @see {@link semanticDiff} for asserting the production emit is the development one.
 */
export function obfuscate(opts?: { renames?: Map<string, string> }): EmitPlugin[] {
  return [mangle(opts), prune(), aliasTypes(opts), minify({ numbers: 'f32' })]
}
