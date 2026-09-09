// ═══ Shader DSL — structured error + source location ═══
//
// One canonical error shape (`ShaderDslError`) carrying a stable `code` (see ./codes),
// an optional one-line `hint`, and an optional authored-source `loc` (see ./loc). The
// `dslError(code, detail?)` factory composes a readable `.message` from the catalogue
// entry + the dynamic detail, and is the single replacement for the package's former
// bare `throw new Error('shader-dsl: …')` sites.
//
// The two pre-existing public error classes (ValidationError, UnsupportedFeatureError)
// subclass this so `instanceof` / `.name` checks in consumers keep working, while every
// thrown error now carries a code the host can branch on.

import { CODES, type ErrorCode, type ErrorCodeDef } from './codes.js'

/** A pointer back into the AUTHORED TypeScript — the first stack frame outside this
 *  package, captured (opt-in) when source tracing is on. Never emitted into WGSL/GLSL. */
export interface SourceLoc {
  readonly file: string
  readonly line: number
  readonly col: number
}

/** `file:line:col` — the shared one-line spelling of a SourceLoc (reused by the
 *  aggregated validation message and by formatReport). */
export const formatLoc = (loc: SourceLoc): string => `${loc.file}:${loc.line}:${loc.col}`

/** The error class this package throws. Every coded failure, whether an authoring-time type
 *  mismatch, a validation failure, or a feature a backend cannot emit, arrives as this class or
 *  a subclass of it, so `catch (e) { if (e instanceof ShaderDslError) … }` handles all of them.
 *
 *  Branch on {@link ShaderDslError.code}. The code is an `SD####` string from the append-only
 *  catalogue {@link CODES}; codes are never renumbered, so the code is the stable part of the
 *  error. `.message` combines the catalogue summary with the detail of this particular failure
 *  and may be reworded between releases.
 *
 *  `hint` is the catalogue's one-line fix for the code, where it has one. `loc` points into the
 *  TypeScript that built the node (the file, line and column of the author's own call), and is
 *  present only when source tracing was on at the time the node was built; turn it on with
 *  `setSourceTracing(true)` from `@xgis/shader-dsl/dev`. Treat both fields as optional.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @example
 *  ```ts
 *  import { ShaderDslError } from '@xgis/shader-dsl'
 *
 *  try {
 *    buildModule()
 *  } catch (e) {
 *    if (e instanceof ShaderDslError && e.code === 'SD0002') {
 *      // binary op on mismatched vectors: report it against the author's own source
 *      console.error(e.message, e.loc)
 *    } else throw e
 *  }
 *  ```
 */
export class ShaderDslError extends Error {
  /** The stable `SD####` catalogue code. Branch on this field. */
  readonly code: string
  /** The catalogue's one-line fix, where the code has one. Absent otherwise. */
  readonly hint?: string
  /** Where in the author's TypeScript the offending node was built. Present only when source
   *  tracing was on at that time (`setSourceTracing(true)` from `@xgis/shader-dsl/dev`), so
   *  treat it as optional. */
  readonly loc?: SourceLoc
  constructor(opts: { code: string; message: string; hint?: string; loc?: SourceLoc }) {
    super(opts.message)
    this.name = 'ShaderDslError'
    this.code = opts.code
    this.hint = opts.hint
    this.loc = opts.loc
  }
}

/** Compose the human message for a coded error: a `shader-dsl [SD####]: <summary>` head,
 *  the dynamic `detail` (if any), then indented `hint:` / `at file:line:col` lines. */
export function formatMessage(
  code: string,
  summary: string,
  opts?: { detail?: string; hint?: string; loc?: SourceLoc },
): string {
  let msg = `shader-dsl [${code}]: ${summary}`
  if (opts?.detail) msg += ` — ${opts.detail}`
  if (opts?.loc) msg += `\n  at ${formatLoc(opts.loc)}`
  if (opts?.hint) msg += `\n  hint: ${opts.hint}`
  return msg
}

/** Build a coded ShaderDslError from the catalogue. `detail` carries the dynamic part
 *  of the message (the offending types / names); `opts.hint` overrides the catalogue
 *  hint when a call site has a more specific one. */
export function dslError(
  code: ErrorCode,
  detail?: string,
  opts?: { hint?: string; loc?: SourceLoc },
): ShaderDslError {
  const def: ErrorCodeDef = CODES[code]
  const hint = opts?.hint ?? def.hint
  return new ShaderDslError({
    code,
    message: formatMessage(code, def.summary, { detail, hint, loc: opts?.loc }),
    hint,
    loc: opts?.loc,
  })
}
