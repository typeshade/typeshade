// ═══ Shader DSL — module validation (lint engine front-end) ═══
//
// A pre-emit static check over an AUTHORED ModuleDecl, run at the TOP of emitModule /
// emitGlslModule / compileModule (BEFORE lowerModule). It runs the lint ruleset
// (passes/lint/rules.ts) over the module and throws ValidationError on the first
// error-severity diagnostic, so a structurally-invalid module surfaces at authoring
// time instead of as opaque WGSL the driver later rejects.
//
// The rules live in the lint engine (a registry + a single-traversal dispatcher) so
// the ruleset scales: add a rule there, no change here. SCOPE: only rules that
// PROVABLY hold for every shader — incl. the runtime-composed variants — are wired as
// 'error' (dup-name, binding-collision, all-paths-return, mixed-scalar, single-exit).
// Name-resolution rules stay deferred: the compiler/composer inject consts/uniforms as
// raw WGSL referenced by plain name, so a name rule cannot tell an injected name from a
// typo (it once broke the polygon VT variant on `OPACITY` at runtime).

import type { ModuleDecl } from '../ir/index.js'
import { lint, type Diagnostic, type LintConfig } from './lint/engine.js'
import { RULES, CORE_RULES } from './lint/rules/index.js'
import { ShaderDslError, formatLoc } from '../diagnostics/error.js'

/** Render every error diagnostic on its own line — `[SD####] (fn X) message @ file:line:col`
 *  — so an aggregated validation failure shows ALL problems, not just the first. */
function formatValidationMessage(diags: readonly Diagnostic[]): string {
  const head = `shader-dsl [SD0020]: module validation failed (${diags.length} error${diags.length === 1 ? '' : 's'}):`
  const lines = diags.map((d) => {
    const code = d.code ? `[${d.code}] ` : ''
    const fn = d.fn ? ` (fn ${d.fn})` : ''
    const at = d.loc ? ` @ ${formatLoc(d.loc)}` : ''
    return `  - ${code}${d.ruleId}${fn}: ${d.message}${at}`
  })
  return [head, ...lines].join('\n')
}

/** Thrown by `validate()` when a module fails an emit-time gate. Subclasses
 *  {@link ShaderDslError} and carries code `SD0020`, so an `instanceof ShaderDslError` handler
 *  still catches it and a code-based one still routes it.
 *
 *  The reason to catch this specific class is {@link ValidationError.diagnostics}: `validate()`
 *  collects EVERY error-severity diagnostic before throwing, not just the first, so one throw
 *  reports the whole failing surface. `.message` renders the same list as text; the array is
 *  what you present in a UI.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/dev`.
 *
 *  @example
 *  ```ts
 *  import { ValidationError } from '@xgis/shader-dsl'
 *
 *  try {
 *    validate(MODULE)
 *  } catch (e) {
 *    if (e instanceof ValidationError) for (const d of e.diagnostics) report(d.ruleId, d.message)
 *    else throw e
 *  }
 *  ```
 */
export class ValidationError extends ShaderDslError {
  /** Every error-severity diagnostic that caused the failure (not just the first). */
  readonly diagnostics: readonly Diagnostic[]
  constructor(diags: readonly Diagnostic[]) {
    super({ code: 'SD0020', message: formatValidationMessage(diags) })
    this.name = 'ValidationError'
    this.diagnostics = diags
  }
}

/** Run the lint ruleset and return all diagnostics (errors + warnings). Does not
 *  throw — callers that want the full report (e.g. a static-analysis test) use this. */
export function lintModule(m: ModuleDecl, config?: LintConfig): Diagnostic[] {
  return lint(m, RULES, config)
}

/** Check an authored module against the structural rules every emit depends on, and throw a
 *  {@link ValidationError} when any of them fails.
 *
 *  {@link emitModule}, {@link emitGlslModule} and {@link compileModule} each run this first,
 *  before any lowering, so a structurally invalid module surfaces at the authoring line
 *  instead of as source a driver rejects. Call it directly when you want that answer without
 *  emitting.
 *
 *  One error reports every failure. `validate` collects every
 *  error-severity diagnostic, and the throw carries them all on `err.diagnostics`; the
 *  message renders the same list as text. Each diagnostic names its `code` (`SD0107` and its
 *  siblings), the `rule` that raised it, the `fn` it was found in, and, with
 *  {@link setSourceTracing} on, the `file:line:col` that authored the node.
 *
 *  It runs the core ruleset, the invariants that hold for every module, including
 *  runtime-composed variants and compute kernels that legitimately return early. The
 *  opinionated style rules are lint-only; run {@link lintModule} or {@link diagnose} for
 *  those.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/dev`.
 *
 *  @param m - the authored module, before any lowering pass rebuilds its nodes.
 *  @throws {@link ValidationError} carrying every error-severity diagnostic, with code
 *    `SD0020`.
 *
 *  @example
 *  ```ts
 *  import { validate, ValidationError } from '@xgis/shader-dsl'
 *
 *  try {
 *    validate(MODULE)
 *  } catch (e) {
 *    if (e instanceof ValidationError) for (const d of e.diagnostics) report(d.code, d.message)
 *    else throw e
 *  }
 *  ```
 *
 *  @see {@link diagnose} for the non-throwing report, lint and capabilities together.
 *  @see {@link setSourceTracing} for `file:line:col` on each diagnostic.
 */
export function validate(m: ModuleDecl): void {
  const errors = lint(m, CORE_RULES).filter((d) => d.severity === 'error')
  if (errors.length) throw new ValidationError(errors)
}
