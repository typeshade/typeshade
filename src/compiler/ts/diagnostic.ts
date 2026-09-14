// === One place that builds a TsCompilerDiagnostic, so every site agrees on its span ===

import ts from 'typescript'
import type { TsCompilerDiagnostic } from './source-file.js'
import type { TsCode } from './codes.js'

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
