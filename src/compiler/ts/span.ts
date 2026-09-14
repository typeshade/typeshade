// === One place that turns a ts.Node into a SourceSpan, so every capture site agrees ===
//
// The twin of `diagnostic.ts`: that file turns a `ts.Node` into the span a diagnostic
// carries, this one turns the same node into the span an IR node carries. Both read
// `node.getStart(sourceFile)` through `node.getEnd()`, so a statement's span never covers
// its leading trivia and a breakpoint set on a comment line resolves to the statement after
// it, which is what an author expects.
//
// The line and character fields are ZERO-based here, while `TsCompilerDiagnostic`'s are
// one-based. That is deliberate and documented on `SourceSpan`: spans are read by the editor
// layer, which is zero-based throughout (`docs/language-service-api.md` §2), and changing the
// diagnostic shape is a breaking change with nothing to do with debugging.

import ts from 'typescript'
import type { SourceSpan } from '../../core/ir/span.js'

/** The span of `node` in `sourceFile`: its first non-trivia character through its end. */
export function spanOf(sourceFile: ts.SourceFile, node: ts.Node): SourceSpan {
  const start = node.getStart(sourceFile)
  const end = node.getEnd()
  const startPos = sourceFile.getLineAndCharacterOfPosition(start)
  const endPos = sourceFile.getLineAndCharacterOfPosition(end)
  return {
    file: sourceFile.fileName,
    start,
    length: end - start,
    line: startPos.line,
    character: startPos.character,
    endLine: endPos.line,
    endCharacter: endPos.character,
  }
}

/** Stamp `value` with `node`'s span and hand it back.
 *
 * It MUTATES rather than spreading, for two reasons: the IR shapes declare `span` readonly so
 * a consumer cannot set it, and `autoVars` keys a `Map` by Expr object identity, so a capture
 * site that rebuilt the node it was handed would break an invariant the emit path depends on.
 *
 * A value that already carries a span keeps it. That is what lets the statement-level capture
 * in `lowerStatement` be a blanket fallback: a site with a finer span (a single declarator of
 * a multi-declarator `let`, a `for`-init) stamps its own first, and the blanket pass leaves
 * it alone.
 */
export function withSpan<T extends object>(value: T, sourceFile: ts.SourceFile, node: ts.Node): T {
  const target = value as { span?: SourceSpan }
  if (target.span === undefined) target.span = spanOf(sourceFile, node)
  return value
}
