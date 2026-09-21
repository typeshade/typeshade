// ═══ `@diagnostic("off", "derivative_uniformity")` on an entry (§54) ═══
//
// WGSL's `derivative_uniformity` rule has default severity `error` (wgsl.txt:1646-1648), and
// an author who knows their sample is under a branch the invocations do not share — because
// the texture is a lookup table, or the branch is uniform in a way no analysis can see — has
// one way to say so: a diagnostic filter. WGSL spells it two ways, `@diagnostic(...)` on a
// function and `diagnostic(...);` at module scope (wgsl.txt:13186-13190). Both were measured
// ACCEPTED on Chromium 141 and 153.
//
// The author writes the ATTRIBUTE, on the entry, because that is where the decision belongs.
// It emits the MODULE-SCOPE directive, because WGSL's function attribute covers that
// function's own body and not the functions it calls — and a sample is as often in a helper as
// in the entry, so the attribute form would switch off a rule the module still breaks
// elsewhere. One spelling in, the one that means what the author meant out.

import ts from 'typescript'
import type { DiagnosticDirective } from '../../core/ir/nodes.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'
import type { TsCompilerDiagnostic } from './source-file.js'

/** The severities WGSL's diagnostic filter takes. */
const SEVERITIES = ['off', 'info', 'warning', 'error'] as const

/** The rules this compiler knows how to answer for. `derivative_uniformity` is the one it
 *  ANALYSES, so it is the one an author can switch off and change what the compiler does; a
 *  name outside this list would emit a directive with nothing behind it. */
const RULES = ['derivative_uniformity'] as const

/** The `diagnostic(...)` directives the file's entries ask for, deduplicated and in source
 *  order. A wrong severity or an unknown rule is reported and contributes nothing, so a typo
 *  does not silently switch a rule off — or leave one on that the author meant to silence. */
export function collectDiagnosticDirectives(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): DiagnosticDirective[] {
  const out: DiagnosticDirective[] = []
  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt)) continue
    // A decorator on a top-level `function` parses as a MODIFIER, not through
    // `getDecorators`, which is why `function.ts` has `decoratorsOf`; the same shape here.
    const mods: readonly ts.ModifierLike[] = stmt.modifiers ?? []
    const decorators = mods.filter(ts.isDecorator)
    for (const d of decorators) {
      if (!ts.isCallExpression(d.expression)) continue
      if (!ts.isIdentifier(d.expression.expression)) continue
      if (d.expression.expression.text !== 'diagnostic') continue
      const args = d.expression.arguments.map((a) =>
        ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : undefined,
      )
      const [severity, rule] = args
      if (args.length !== 2 || severity === undefined || rule === undefined) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            d,
            `@diagnostic takes a severity and a rule, as strings: ` +
              `@diagnostic("off", "derivative_uniformity").`,
            TS_CODES.ATTRIBUTE_NAME,
          ),
        )
        continue
      }
      if (!(SEVERITIES as readonly string[]).includes(severity)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            d,
            `"${severity}" is not a diagnostic severity. WGSL has: ${SEVERITIES.join(', ')}.`,
            TS_CODES.ATTRIBUTE_NAME,
          ),
        )
        continue
      }
      if (!(RULES as readonly string[]).includes(rule)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            d,
            `"${rule}" is not a rule this compiler analyses. It knows: ${RULES.join(', ')}.`,
            TS_CODES.ATTRIBUTE_NAME,
          ),
        )
        continue
      }
      const directive: DiagnosticDirective = {
        severity: severity as DiagnosticDirective['severity'],
        rule,
      }
      if (!out.some((x) => x.severity === directive.severity && x.rule === directive.rule)) {
        out.push(directive)
      }
    }
  }
  return out
}

/** Whether the file has switched `derivative_uniformity` off. The analysis then stays silent:
 *  the author has said they want the module as written, and WGSL will not refuse it either. */
export function derivativeUniformityOff(directives: readonly DiagnosticDirective[]): boolean {
  return directives.some((d) => d.rule === 'derivative_uniformity' && d.severity === 'off')
}
