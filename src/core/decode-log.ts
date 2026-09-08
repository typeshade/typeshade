// ═══ Shader DSL — decoding a production driver log ═══
//
// `mangle({ renames })` and `aliasTypes({ renames })` fill a Map because the
// emitted text is unreadable on purpose: a driver error from a shipped build
// says `no matching overload for operator -` in function `b`, at a `d` of type
// `l`. The Map is the shader source map. This is the half that USES it.
//
// The map is authored → emitted, and inverting it is where the honesty lives:
//   • module-scope names (helper fns, plain structs, module consts) and type
//     aliases invert UNIQUELY — one `b`, one authored name. These are what a
//     driver names, and they decode cleanly.
//   • function-scoped names (params, locals) deliberately REUSE the short end of
//     the alphabet in every function, so one `f` inverts to many authored names.
//     Guessing one would be worse than saying so.
//
// So an ambiguous name is annotated with its candidates rather than replaced,
// and the caller sees which it is. Nothing here runs at emit time; it is a
// build/debug tool that a shipped bundle never imports (`/emit-prod`).

/** How a decoded name was resolved — the count is the ambiguity. */
export interface DecodedName {
  readonly emitted: string
  /** Authored names that could have produced it, in the map's insertion order. */
  readonly authored: readonly string[]
}

const KEY_SCOPE = /^(.+)\.([^.]+)$/

/** Invert an authored → emitted rename map. A function-scoped key
 *  (`authoredFn.authoredName`) contributes its LOCAL half, qualified back to the
 *  function it came from, so `noise.coordinate → f` inverts to
 *  `f → 'coordinate (in noise)'`. */
export function invertRenames(
  renames: ReadonlyMap<string, string>,
): ReadonlyMap<string, DecodedName> {
  const byEmitted = new Map<string, string[]>()
  for (const [from, to] of renames) {
    const scoped = KEY_SCOPE.exec(from)
    // A type spelling is the one key that legitimately contains no scope but may
    // contain punctuation (`vec2<f32>`); it is not a `fn.local` pair.
    const label = scoped !== null && !/[<>]/.test(from) ? `${scoped[2]!} (in ${scoped[1]!})` : from
    const list = byEmitted.get(to)
    if (list) list.push(label)
    else byEmitted.set(to, [label])
  }
  const out = new Map<string, DecodedName>()
  for (const [emitted, authored] of byEmitted) out.set(emitted, { emitted, authored })
  return out
}

/** Rewrite a driver log or a GPU capture back into authored names, using the map
 *  {@link mangle} and {@link aliasTypes} filled.
 *
 *  Substitution is token-wise. Only whole identifiers are looked up, so the driver's own prose,
 *  its line and column numbers and its source excerpts come through untouched, where a
 *  substring replace of a name like `b` would corrupt every word containing it.
 *
 *  A name that inverts uniquely is replaced. Module-scope names, helper functions, plain
 *  structs, module constants and type aliases are unique by construction, and they are what a
 *  driver actually names, so those decode cleanly.
 *
 *  A name that inverts to several is annotated instead of guessed at:
 *  `f⟨coordinate (in noise) | tint (in shade)⟩`. Function-scoped names are deliberately reused
 *  across functions, which is where the byte saving comes from, so one emitted name can stand
 *  for several authored ones, and picking one would be a guess the log cannot support.
 *
 *  {@link invertRenames} exposes the same table as data, one entry per emitted name with the
 *  authored candidates in the map's insertion order, for a caller that wants to present the
 *  ambiguity its own way.
 *
 *  Nothing here runs at emit time. Keep the map and this decoder out of the shipped bundle;
 *  both live on the production-emit subpath.
 *
 *  Exported from `@xgis/shader-dsl/emit-prod`.
 *
 *  @param log - the driver message to decode.
 *  @param renames - the authored-to-emitted map the emit plugins filled.
 *  @returns the log with every recognised identifier replaced or annotated.
 *
 *  @example
 *  ```ts
 *  import { obfuscate, decodeShaderLog } from '@xgis/shader-dsl/emit-prod'
 *
 *  const renames = new Map<string, string>()
 *  const wgsl = emitModule(MODULE, { plugins: obfuscate({ renames }) })
 *  console.error(decodeShaderLog(info.messages[0].message, renames))
 *  ```
 *
 *  @see {@link invertRenames} for the same table as data.
 *  @see {@link mangle} for what fills the map.
 */
export function decodeShaderLog(log: string, renames: ReadonlyMap<string, string>): string {
  const table = invertRenames(renames)
  if (table.size === 0) return log
  return log.replace(/[A-Za-z_]\w*/g, (word) => {
    const hit = table.get(word)
    if (hit === undefined) return word
    return hit.authored.length === 1 ? hit.authored[0]! : `${word}⟨${hit.authored.join(' | ')}⟩`
  })
}
