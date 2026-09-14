// === TypeScript + TypeShade diagnostics, merged into one TypeshadeDiagnostic list (§5, §6) ===

import ts from 'typescript'
import { compileTsSource } from '../compiler/ts/source-file.js'
import { clampSpan, rangeForSpan, spanForDiagnostic } from './positions.js'
import type { TypeshadeDiagnostic, TypeshadeSeverity } from './types.js'

/**
 * One TypeScript diagnostic code the ambient lib cannot silence, and the rule that decides
 * whether one occurrence of it is a real problem or the false positive §6 measured. Kept as one
 * table, per file, rather than scattered `if` statements, so every filtered code and its reason
 * is visible in one place.
 */
interface DiagnosticFilterRule {
  /** The numeric TypeScript diagnostic code this rule may drop. */
  readonly code: number
  /** Why this code is filtered here instead of by the ambient lib. */
  readonly reason: string
  /** Returns `true` when this specific occurrence is the known false positive and should be
   * dropped; `false` lets it through as a real diagnostic. */
  readonly when: (sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic) => boolean
}

/**
 * Finds the innermost node of `root` whose span contains `pos`, by a plain recursive descent —
 * `ts.getTokenAtPosition` is compiler-internal and not part of the public `typescript` API.
 */
function nodeAtPosition(root: ts.Node, pos: number): ts.Node {
  let found: ts.Node = root
  const visit = (node: ts.Node): void => {
    if (pos >= node.getStart() && pos < node.getEnd()) {
      found = node
      node.forEachChild(visit)
    }
  }
  visit(root)
  return found
}

/**
 * A top-level function declaration, exported or not. `lower/function.ts`'s
 * `lowerSourceFunctions` is the authority on what counts as a `"use typeshade"` entry point —
 * it collects every `sourceFile.statements.filter(ts.isFunctionDeclaration)` with no `export`
 * requirement at all, so `@vertex`/`@fragment`/`@compute` on a non-exported top-level function
 * compiles and emits today. The old `export`-only predicate here disagreed with that and left
 * TS1206 red on a program the compiler accepts outright.
 */
function isTopLevelFunctionDeclaration(node: ts.Node): node is ts.FunctionDeclaration {
  return ts.isFunctionDeclaration(node) && node.parent !== undefined && ts.isSourceFile(node.parent)
}

/**
 * TS1206 ("Decorators are not valid here") fires on a function declaration's own decorator
 * (`@vertex`) and on a parameter decorator (`@builtin("vertex_index")`) alike, because legacy
 * decorators are grammatically valid only on a class, its members, or their parameters — never
 * on a plain function declaration. `"use typeshade"` deliberately puts `@vertex`/`@fragment`/
 * `@compute` on a top-level function (exported or not — see `isTopLevelFunctionDeclaration`)
 * and `@builtin`/`@location` on that function's parameters, so this is the one syntax-level
 * restriction no ambient `.d.ts` can configure away (§6); this predicate recognizes exactly
 * that shape, on the entry function itself or on one of its parameters, so any other TS1206
 * (a decorator TypeShade does not define) still surfaces.
 */
function isDecoratorOnTopLevelFunction(
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): boolean {
  const pos = diagnostic.start ?? 0
  let node: ts.Node | undefined = nodeAtPosition(sourceFile, pos)
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent
  if (node === undefined) return false
  const decorated = node.parent
  if (decorated === undefined) return false
  if (isTopLevelFunctionDeclaration(decorated)) return true
  if (ts.isParameter(decorated) && decorated.parent !== undefined) {
    return isTopLevelFunctionDeclaration(decorated.parent)
  }
  return false
}

const TS_DIAGNOSTIC_FILTERS: readonly DiagnosticFilterRule[] = [
  {
    code: 1206,
    reason:
      '@vertex/@fragment/@compute on a top-level function, and @builtin/@location on that ' +
      'function\'s parameters, are exactly the grammar "use typeshade" defines (the compiler ' +
      'does not require export either — see lower/function.ts) — legacy decorators otherwise ' +
      'forbid a function declaration or its parameters as a target, and no compiler option ' +
      'relaxes that. See design doc §6.',
    when: isDecoratorOnTopLevelFunction,
  },
]

function isFiltered(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): boolean {
  return TS_DIAGNOSTIC_FILTERS.some(
    (rule) => rule.code === diagnostic.code && rule.when(sourceFile, diagnostic),
  )
}

function severityOfTs(category: ts.DiagnosticCategory): TypeshadeSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error'
    case ts.DiagnosticCategory.Warning:
      return 'warning'
    case ts.DiagnosticCategory.Suggestion:
      return 'hint'
    default:
      return 'information'
  }
}

function severityOfTypeshade(category: 'error' | 'warning' | 'message'): TypeshadeSeverity {
  return category === 'message' ? 'information' : category
}

function toTypeshadeDiagnostic(
  uri: string,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): TypeshadeDiagnostic {
  const span = clampSpan(sourceFile, diagnostic.start ?? 0, diagnostic.length ?? 0)
  return {
    uri,
    span,
    range: rangeForSpan(sourceFile, span),
    severity: severityOfTs(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    code: diagnostic.code,
    source: 'typescript',
  }
}

/**
 * Returns `sourceFile`'s TypeScript syntactic and semantic diagnostics from `languageService`,
 * mapped to `TypeshadeDiagnostic` with `source: 'typescript'`, with `TS_DIAGNOSTIC_FILTERS`
 * applied (§6). `uri` is the document's uri, threaded through for the returned diagnostics'
 * `uri` field (`sourceFile.fileName` inside the language service's program is the same value,
 * but naming it explicitly keeps this function agnostic to that detail).
 */
export function getTypeScriptDiagnostics(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
): TypeshadeDiagnostic[] {
  const raw = [
    ...languageService.getSyntacticDiagnostics(uri),
    ...languageService.getSemanticDiagnostics(uri),
  ]
  return raw
    .filter((d) => !isFiltered(sourceFile, d))
    .map((d) => toTypeshadeDiagnostic(uri, sourceFile, d))
}

/**
 * Returns `sourceFile`'s TypeShade diagnostics — the front end's own analysis, run with
 * `{ emit: false }` so `getDiagnostics` never produces shader text (§8) and with `sourceFile`
 * passed straight through so the front end never re-parses text the language service's program
 * already parsed (§5). Mapped to `TypeshadeDiagnostic` with `source: 'typeshade'` and the
 * `TS8xxx` codes from `compiler/ts/codes.ts`.
 */
export function getTypeshadeDiagnostics(
  sourceFile: ts.SourceFile,
  uri: string,
): TypeshadeDiagnostic[] {
  const result = compileTsSource(sourceFile.text, {
    sourceFile,
    requireDirective: true,
    emit: false,
  })
  return result.diagnostics.map((d) => {
    const span = spanForDiagnostic(sourceFile, d)
    return {
      uri,
      span,
      range: rangeForSpan(sourceFile, span),
      severity: severityOfTypeshade(d.category),
      message: d.message,
      code: d.code ?? 'TS8099',
      source: 'typeshade' as const,
    }
  })
}
