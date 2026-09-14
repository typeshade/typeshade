// === Offset/position/range conversion over a ts.SourceFile, with clamping ===
//
// Every conversion goes through the parsed `ts.SourceFile` (`getLineStarts`,
// `getPositionOfLineAndCharacter`, `getLineAndCharacterOfPosition`), never by splitting the
// text on `\n`, so a CRLF source and a position past the end of the file are both handled the
// same way everywhere in the service.

import ts from 'typescript'
import type { TsCompilerDiagnostic } from '../compiler/ts/source-file.js'
import type { TypeshadePosition, TypeshadeRange, TypeshadeTextSpan } from './types.js'

function isLineBreak(code: number): boolean {
  return code === 10 /* \n */ || code === 13 /* \r */
}

/**
 * Clamps a zero-based line/character pair into the bounds of `sourceFile`: the line into
 * `[0, lineCount - 1]`, and the character into `[0, lineLength]` where `lineLength` excludes
 * the line's own terminator (so a CRLF or LF line ending is never treated as addressable
 * character content). Used so a caller-supplied position never reaches
 * `ts.getPositionOfLineAndCharacter` out of range, since that helper throws on a bad line or
 * character.
 */
export function clampPosition(
  sourceFile: ts.SourceFile,
  line: number,
  character: number,
): { line: number; character: number } {
  const lineStarts = sourceFile.getLineStarts()
  const lineCount = lineStarts.length
  const clampedLine = Math.max(0, Math.min(line, lineCount - 1))
  const lineStart = lineStarts[clampedLine]!
  const lineEndWithBreak =
    clampedLine + 1 < lineCount ? lineStarts[clampedLine + 1]! : sourceFile.text.length
  let lineEnd = lineEndWithBreak
  while (lineEnd > lineStart && isLineBreak(sourceFile.text.charCodeAt(lineEnd - 1))) lineEnd--
  const lineLength = lineEnd - lineStart
  const clampedCharacter = Math.max(0, Math.min(character, lineLength))
  return { line: clampedLine, character: clampedCharacter }
}

/** Converts a zero-based editor position into a UTF-16 source offset, using the parsed source
 * file so CRLF and LF line endings are both handled correctly. */
export function offsetAt(sourceFile: ts.SourceFile, position: TypeshadePosition): number {
  const clamped = clampPosition(sourceFile, position.line, position.character)
  return ts.getPositionOfLineAndCharacter(sourceFile, clamped.line, clamped.character)
}

/** Converts a UTF-16 source offset into a zero-based editor position, using the parsed source
 * file. An offset past the end of the source clamps to the end. */
export function positionAt(sourceFile: ts.SourceFile, offset: number): TypeshadePosition {
  const clampedOffset = Math.max(0, Math.min(offset, sourceFile.text.length))
  const lc = ts.getLineAndCharacterOfPosition(sourceFile, clampedOffset)
  return { line: lc.line, character: lc.character }
}

/** Converts a UTF-16 offset span into the equivalent zero-based half-open range. */
export function rangeForSpan(sourceFile: ts.SourceFile, span: TypeshadeTextSpan): TypeshadeRange {
  return {
    start: positionAt(sourceFile, span.start),
    end: positionAt(sourceFile, span.start + span.length),
  }
}

/** Converts a zero-based half-open range into the equivalent UTF-16 offset span. */
export function spanForRange(sourceFile: ts.SourceFile, range: TypeshadeRange): TypeshadeTextSpan {
  const start = offsetAt(sourceFile, range.start)
  const end = offsetAt(sourceFile, range.end)
  return { start, length: Math.max(0, end - start) }
}

/** Clamps a raw `start`/`length` UTF-16 offset pair into `sourceFile`'s bounds. Shared by
 * `spanForDiagnostic` (a `TsCompilerDiagnostic`'s own fields) and any other diagnostic source
 * that already reports plain offsets, such as a `ts.Diagnostic`. */
export function clampSpan(
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): TypeshadeTextSpan {
  const max = sourceFile.text.length
  const clampedStart = Math.max(0, Math.min(start, max))
  const end = Math.max(clampedStart, Math.min(start + length, max))
  return { start: clampedStart, length: end - clampedStart }
}

/**
 * Builds the UTF-16 offset span for a compiler diagnostic directly from its own `start`/
 * `length` (real node bounds, or the file's first statement when the diagnostic has no node —
 * see `TsCompilerDiagnostic`), clamped into the file's bounds in case the source the
 * diagnostic was computed against differs from `sourceFile`.
 */
export function spanForDiagnostic(
  sourceFile: ts.SourceFile,
  diagnostic: TsCompilerDiagnostic,
): TypeshadeTextSpan {
  return clampSpan(sourceFile, diagnostic.start, diagnostic.length)
}

/** Returns the maximal identifier-like span (letters, digits, `_`, `@`) around `offset` — the
 * "word" a hover or a `@`-prefixed completion request is anchored to. */
export function wordSpan(source: string, offset: number): TypeshadeTextSpan {
  let start = offset
  let end = offset
  while (start > 0 && /[A-Za-z0-9_@]/.test(source[start - 1]!)) start--
  while (end < source.length && /[A-Za-z0-9_@]/.test(source[end]!)) end++
  return { start, length: end - start }
}
