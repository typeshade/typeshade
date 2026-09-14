// === One place that builds a TsCompilerDiagnostic, so every site agrees on its span ===

import ts from 'typescript'
import type { TsCompilerDiagnostic } from './source-file.js'
import { TS_CODES, type TsCode } from './codes.js'

/**
 * Builds the diagnostic from a raw `[start, end)` UTF-16 span, converting it into the
 * one-based `line`/`character`/`endLine`/`endCharacter` fields every consumer reads.
 */
function diagnosticForSpan(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
  message: string,
  code: TsCode,
  category: TsCompilerDiagnostic['category'],
): TsCompilerDiagnostic {
  const startPos = sourceFile.getLineAndCharacterOfPosition(start)
  const endPos = sourceFile.getLineAndCharacterOfPosition(end)
  return {
    message,
    fileName: sourceFile.fileName,
    line: startPos.line + 1,
    character: startPos.character + 1,
    endLine: endPos.line + 1,
    endCharacter: endPos.character + 1,
    category,
    code,
    start,
    length: end - start,
  }
}

/**
 * Builds a `TsCompilerDiagnostic` whose span comes from `node`: `node.getStart(sourceFile)`
 * through `node.getEnd()`, converted into the one-based `line`/`character`/`endLine`/
 * `endCharacter` fields plus the raw UTF-16 `start`/`length` offsets. When `node` is
 * `undefined` — a missing directive, a whole-module backend failure, or any other diagnostic
 * with no single offending node — the span covers the file's first statement instead, or
 * `start: 0, length: 0` when the file has no statements at all. `code` is required: a call
 * site with no code that obviously fits should use `TS_CODES.UNSUPPORTED` rather than pass
 * one in that does not describe the message.
 */
export function makeDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  message: string,
  code: TsCode,
  category: TsCompilerDiagnostic['category'] = 'error',
): TsCompilerDiagnostic {
  const fallback = sourceFile.statements[0]
  const start = node ? node.getStart(sourceFile) : (fallback?.getStart(sourceFile) ?? 0)
  const end = node ? node.getEnd() : (fallback?.getEnd() ?? start)
  return diagnosticForSpan(sourceFile, start, end, message, code, category)
}

/**
 * The one shape every emit-time failure takes: a backend (WGSL or GLSL) threw on a module
 * the front end accepted, so the throw becomes a `BACKEND`-coded diagnostic carrying the
 * backend's own message, anchored on the file's first statement (the failure has no single
 * offending node). `compileTsSource`, `compileTsSources` and `compile` all report an emit
 * failure through this so a caller sees one diagnostic, never an exception. The category is
 * `error` for the WGSL emitter, whose text is the program; `compile()` passes `warning` for
 * the GLSL stage of a vertex+fragment module, because a module whose WGSL emitted has
 * compiled even when the second target cannot take it.
 */
export function backendDiagnostic(
  sourceFile: ts.SourceFile,
  error: unknown,
  category: TsCompilerDiagnostic['category'] = 'error',
): TsCompilerDiagnostic {
  return makeDiagnostic(
    sourceFile,
    undefined,
    `Backend emit failed: ${error instanceof Error ? error.message : String(error)}`,
    TS_CODES.BACKEND,
    category,
  )
}

/**
 * TypeScript's own parse errors for `sourceFile` (an unclosed parenthesis, a missing brace, an
 * unexpected token) as `SYNTAX`-coded diagnostics, each with the parser's span and message. A
 * caller that gets a non-empty list back has a file whose tree is the parser's best recovery,
 * not the author's program, and must not lower it: `compileTsSource` and `compileTsSources`
 * return these as the whole answer for such a file.
 */
export function syntaxDiagnostics(sourceFile: ts.SourceFile): TsCompilerDiagnostic[] {
  return parseDiagnosticsOf(sourceFile).map((d) => {
    const start = Math.min(d.start ?? 0, sourceFile.text.length)
    const end = Math.min(start + (d.length ?? 0), sourceFile.text.length)
    return diagnosticForSpan(
      sourceFile,
      start,
      end,
      ts.flattenDiagnosticMessageText(d.messageText, ' '),
      TS_CODES.SYNTAX,
      categoryOf(d.category),
    )
  })
}

function categoryOf(category: ts.DiagnosticCategory): TsCompilerDiagnostic['category'] {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error'
    case ts.DiagnosticCategory.Warning:
      return 'warning'
    default:
      return 'message'
  }
}

/**
 * The parser records its errors on the `SourceFile` it returns, and
 * `program.getSyntacticDiagnostics` reads that same list. The field is not in the public
 * typings, so it is read through a structural type here; should a future TypeScript stop
 * exposing it, a throwaway single-file program (no lib, no module resolution) asks the public
 * API for the same list.
 */
function parseDiagnosticsOf(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  const recorded = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics
  if (recorded) return recorded
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === sourceFile.fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => name === sourceFile.fileName,
    readFile: () => undefined,
  }
  return ts
    .createProgram([sourceFile.fileName], { noResolve: true, noLib: true, types: [] }, host)
    .getSyntacticDiagnostics(sourceFile)
}
