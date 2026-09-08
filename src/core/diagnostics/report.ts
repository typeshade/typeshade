// ═══ Shader DSL — unified diagnostics report ═══
//
// `diagnose(m, opts?)` is the single "what's wrong with this module?" entry: it runs the
// lint ruleset and (optionally) a NON-throwing capability check against a backend, then
// returns one structured report. Unlike `validate()` (which throws on the first emit-time
// gate) and `assertCaps()` (which throws on the first missing cap), `diagnose()` collects
// everything so an author sees lint + capability problems together. `formatReport()` renders
// it as an ESLint/Rust-style block — code, severity, fn, file:line:col (when traced), hint.
//
// It composes the existing infra (lint / summarize / requiredCaps) — no re-implementation,
// and it runs over the AUTHORED module (before lowering), so reported `loc`s resolve.

import type { ModuleDecl } from '../ir/index.js'
import { Capabilities, type Backend } from '../backend.js'
import {
  lint,
  summarize,
  type Diagnostic,
  type LintSummary,
  type LintConfig,
} from '../passes/lint/engine.js'
import { RULES, CORE_RULES } from '../passes/lint/rules/index.js'
import { requiredCaps } from '../passes/required-caps.js'
import { formatLoc } from './error.js'

/** Options for {@link diagnose}. Every field is optional; the default is "run the full ruleset
 *  and check no backend".
 *
 *  Exported from `@xgis/shader-dsl/dev`.
 */
export interface DiagnoseOptions {
  /** Which ruleset to run — 'all' (full RULES, default) or 'core' (emit-time CORE_RULES). */
  readonly rules?: 'core' | 'all'
  /** When given, also report any capability the backend cannot cover (non-throwing). */
  readonly backend?: Backend
  /** Per-rule severity / options overrides, forwarded to the lint engine. */
  readonly config?: LintConfig
}

/** What {@link diagnose} returns: every {@link Diagnostic} it found, plus the {@link LintSummary}
 *  counts over the same set. The two are consistent by construction — the summary is computed
 *  from that exact array, not gathered separately — so `summary.errors > 0` is the cheap way to
 *  decide whether emit should proceed, and `diagnostics` is what you render.
 *
 *  The array is in no promised order; sort it yourself if you present it.
 *
 *  Exported from `@xgis/shader-dsl/dev`.
 *
 *  @example
 *  ```ts
 *  import { diagnose, formatReport } from '@xgis/shader-dsl/dev'
 *
 *  const report = diagnose(MODULE, { backend: wgslBackend })
 *  if (report.summary.errors > 0) throw new Error(formatReport(report))
 *  ```
 */
export interface DiagnosticReport {
  readonly diagnostics: readonly Diagnostic[]
  readonly summary: LintSummary
}

/** Ask one question of a module, "what is wrong with this?", and get every answer at once.
 *  It runs the lint ruleset and, when a backend is given, a capability check, and collects
 *  both into one report. It never throws.
 *
 *  Two options steer it. `rules` picks the ruleset: `'all'`, the default, runs the full set,
 *  including the style rules emit does not gate on; `'core'` runs only what {@link validate}
 *  runs. `backend` adds the capability check: the module's required caps are compared against
 *  that backend's own capability profile, and a shortfall arrives as a diagnostic with code
 *  `SD0030` naming the missing ids, where {@link emitModule} would have thrown.
 *
 *  It is read-only over the IR and never on the emit path, and it runs over the authored
 *  module, before lowering rebuilds the nodes, which is what lets each diagnostic resolve a
 *  source location when {@link setSourceTracing} is on.
 *
 *  {@link formatReport} renders the result the way a compiler does: one block per diagnostic,
 *  severity and code and rule id on the first line, the function in parentheses, the
 *  `--> file:line:col` line when a location resolved, the message, and a `hint:` line where
 *  the rule offers a remedy, ending with a count of errors and warnings. Sort the
 *  `diagnostics` array yourself if you present it some other way; it is in no promised order.
 *
 *  Exported from `@xgis/shader-dsl/dev`.
 *
 *  @param m - the authored module to inspect.
 *  @param opts - the ruleset, an optional backend to check capabilities against, and per-rule
 *    severity overrides.
 *  @returns every diagnostic found, with the summary counts over the same set.
 *
 *  @example
 *  ```ts
 *  import { diagnose, formatReport } from '@xgis/shader-dsl/dev'
 *  import { wgslBackend } from '@xgis/shader-dsl'
 *
 *  const report = diagnose(MODULE, { rules: 'all', backend: wgslBackend })
 *  if (report.summary.errors > 0) console.log(formatReport(report))
 *  // error[SD0107] no-assign-to-let  (fn rim_alpha)
 *  //   --> src/shaders/line.ts:721:9
 *  //   assignment to immutable 'let' binding 'x'
 *  //   hint: declare the binding with Var() instead of Let() to mutate it
 *  // 1 error, 0 warnings
 *  ```
 *
 *  @see {@link validate} for the throwing, emit-time gate.
 *  @see {@link formatReport} for the rendering shown above.
 */
export function diagnose(m: ModuleDecl, opts?: DiagnoseOptions): DiagnosticReport {
  const rules = opts?.rules === 'core' ? CORE_RULES : RULES
  const diagnostics: Diagnostic[] = [...lint(m, rules, opts?.config)]

  if (opts?.backend) {
    const req = requiredCaps(m)
    // Derived from the backend's ONE capability authority, exactly as assertCaps does
    // (#1670) — this non-throwing check and the throwing gate must not read two
    // different surfaces. Built once per call, over 9 keys.
    const caps = Capabilities.fromProfile(opts.backend.capProfile)
    if (!caps.covers(req)) {
      const missing = caps.missing(req)
      diagnostics.push({
        ruleId: 'unsupported-capability',
        severity: 'error',
        code: 'SD0030',
        message: `backend '${opts.backend.id}' cannot emit this module — missing capabilities: ${missing.join(', ')}`,
      })
    }
  }

  return { diagnostics, summary: summarize(diagnostics) }
}

const SEVERITY_ORDER = { error: 0, warning: 1 } as const

/** Render a DiagnosticReport as a human-readable, severity-sorted block report. */
export function formatReport(report: DiagnosticReport): string {
  const { diagnostics, summary } = report
  if (diagnostics.length === 0) return 'no diagnostics'

  const blocks = [...diagnostics]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((d) => {
      const code = d.code ? `[${d.code}]` : ''
      const fn = d.fn ? `  (fn ${d.fn})` : ''
      const lines = [`${d.severity}${code} ${d.ruleId}${fn}`]
      if (d.loc) lines.push(`  --> ${formatLoc(d.loc)}`)
      lines.push(`  ${d.message}`)
      if (d.hint) lines.push(`  hint: ${d.hint}`)
      return lines.join('\n')
    })

  const footer = `${summary.errors} error${summary.errors === 1 ? '' : 's'}, ${summary.warnings} warning${summary.warnings === 1 ? '' : 's'}`
  return [...blocks, footer].join('\n\n')
}
