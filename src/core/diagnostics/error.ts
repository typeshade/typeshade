// ═══ Shader DSL — structured error + source location ═══
//
// One canonical error shape (`TypeShadeError`) carrying a stable `code` (see ./codes),
// an optional one-line `hint`, and an optional authored-source `loc` (see ./loc). The
// `dslError(code, detail?)` factory composes a readable `.message` from the catalogue
// entry + the dynamic detail, and is the single replacement for the package's former
// bare `throw new Error('typeshade: …')` sites, which now read `typeshade: …`.
//
// NAME. It was `ShaderDslError`, after the package's old name. `ShaderDslError` is still
// exported, as an alias of this same class with a `@deprecated` tag, so an `instanceof` or a
// `.name` check written against the design documents still resolves at 0.1.0. `.name` on an
// instance reads `TypeShadeError`; an alias cannot change that, and a consumer comparing the
// string rather than using `instanceof` sees the new one. That is the intended direction.
//
// The two pre-existing public error classes (ValidationError, UnsupportedFeatureError)
// subclass this so `instanceof` / `.name` checks in consumers keep working, while every
// thrown error now carries a code the host can branch on.

import { CODES, type ErrorCode, type ErrorCodeDef } from './codes.js';

/** A pointer back into the AUTHORED TypeScript — the first stack frame outside this
 *  package, captured (opt-in) when source tracing is on. Never emitted into WGSL/GLSL. */
export interface SourceLoc {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

/** `file:line:col` — the shared one-line spelling of a SourceLoc (reused by the
 *  aggregated validation message and by formatReport). */
export const formatLoc = (loc: SourceLoc): string => `${loc.file}:${loc.line}:${loc.col}`;

/** The error class this package throws. Every coded failure, whether an authoring-time type
 *  mismatch, a validation failure, or a feature a backend cannot emit, arrives as this class or
 *  a subclass of it, so `catch (e) { if (e instanceof TypeShadeError) … }` handles all of them.
 *
 *  Branch on {@link TypeShadeError.code}. The code is an `SD####` string from the append-only
 *  catalogue {@link CODES}; codes are never renumbered, so the code is the stable part of the
 *  error. `.message` combines the catalogue summary with the detail of this particular failure
 *  and may be reworded between releases.
 *
 *  `hint` is the catalogue's one-line fix for the code, where it has one. `loc` points into the
 *  TypeScript that built the node (the file, line and column of the author's own call), and is
 *  present only when source tracing was on at the time the node was built; turn it on with
 *  `setSourceTracing(true)` from `typeshade/dev`. Treat both fields as optional.
 *
 *  Exported from `typeshade`.
 *
 *  @example
 *  ```ts
 *  import { TypeShadeError } from 'typeshade'
 *
 *  try {
 *    buildModule()
 *  } catch (e) {
 *    if (e instanceof TypeShadeError && e.code === 'SD0002') {
 *      // binary op on mismatched vectors: report it against the author's own source
 *      console.error(e.message, e.loc)
 *    } else throw e
 *  }
 *  ```
 */
export class TypeShadeError extends Error {
  /** The stable `SD####` catalogue code. Branch on this field. */
  readonly code: string;
  /** The catalogue's one-line fix, where the code has one. Absent otherwise. */
  readonly hint?: string;
  /** Where in the author's TypeScript the offending node was built. Present only when source
   *  tracing was on at that time (`setSourceTracing(true)` from `typeshade/dev`), so
   *  treat it as optional. */
  readonly loc?: SourceLoc;
  constructor(opts: { code: string; message: string; hint?: string; loc?: SourceLoc }) {
    super(opts.message);
    this.name = 'TypeShadeError';
    this.code = opts.code;
    this.hint = opts.hint;
    this.loc = opts.loc;
  }
}

/** The former name of {@link TypeShadeError}, kept so code written against the design
 *  documents and the pre-0.1.0 sources keeps resolving. It is the SAME class, not a subclass,
 *  so `instanceof` behaves identically in both directions. What it cannot preserve is
 *  `error.name`, which reads `TypeShadeError` on every instance — a consumer matching that
 *  string must use the new spelling.
 *
 *  Exported from `typeshade`.
 *
 *  @deprecated Use {@link TypeShadeError}. This alias exists for the 0.1.0 release and is a
 *  candidate for removal in the first release that may break consumers.
 */
export const ShaderDslError = TypeShadeError;
/** The former name of {@link TypeShadeError} as a TYPE. Same caveats as the value alias.
 *
 *  Exported from `typeshade`.
 *
 *  @deprecated Use {@link TypeShadeError}. */
export type ShaderDslError = TypeShadeError;

/** Compose the human message for a coded error: a `typeshade [SD####]: <summary>` head,
 *  the dynamic `detail` (if any), then indented `hint:` / `at file:line:col` lines. */
export function formatMessage(
  code: string,
  summary: string,
  opts?: { detail?: string; hint?: string; loc?: SourceLoc },
): string {
  let msg = `typeshade [${code}]: ${summary}`;
  if (opts?.detail) msg += ` — ${opts.detail}`;
  if (opts?.loc) msg += `\n  at ${formatLoc(opts.loc)}`;
  if (opts?.hint) msg += `\n  hint: ${opts.hint}`;
  return msg;
}

/** Build a coded TypeShadeError from the catalogue. `detail` carries the dynamic part
 *  of the message (the offending types / names); `opts.hint` overrides the catalogue
 *  hint when a call site has a more specific one. */
export function dslError(
  code: ErrorCode,
  detail?: string,
  opts?: { hint?: string; loc?: SourceLoc },
): TypeShadeError {
  const def: ErrorCodeDef = CODES[code];
  const hint = opts?.hint ?? def.hint;
  return new TypeShadeError({
    code,
    message: formatMessage(code, def.summary, { detail, hint, loc: opts?.loc }),
    hint,
    loc: opts?.loc,
  });
}
