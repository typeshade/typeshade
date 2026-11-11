// === One place that builds a TsCompilerDiagnostic, so every site agrees on its span ===

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES, type TsCode } from './codes.js';
import type { SourceSpan } from '../../core/ir/span.js';

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
  const startPos = sourceFile.getLineAndCharacterOfPosition(start);
  const endPos = sourceFile.getLineAndCharacterOfPosition(end);
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
  };
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
  const fallback = sourceFile.statements[0];
  const start = node ? node.getStart(sourceFile) : (fallback?.getStart(sourceFile) ?? 0);
  const end = node ? node.getEnd() : (fallback?.getEnd() ?? start);
  return diagnosticForSpan(sourceFile, start, end, message, code, category);
}

/**
 * Builds the diagnostic from a {@link SourceSpan} the IR carries, for a rule answered on the
 * module rather than at a `ts.Node`: the uniformity walk sees a `call` and its span, not the
 * `ts.CallExpression` it came from. A node with no span — one a pass synthesised — falls back
 * to `node`, which is the enclosing declaration the caller passes.
 */
export function diagnosticAtSpan(
  sourceFile: ts.SourceFile,
  span: SourceSpan | undefined,
  fallback: ts.Node | undefined,
  message: string,
  code: TsCode,
  category: TsCompilerDiagnostic['category'] = 'error',
): TsCompilerDiagnostic {
  if (span === undefined) return makeDiagnostic(sourceFile, fallback, message, code, category);
  return diagnosticForSpan(
    sourceFile,
    span.start,
    span.start + span.length,
    message,
    code,
    category,
  );
}

/**
 * Builds a diagnostic from a raw UTF-16 `start`/`length` span rather than from a node, for a
 * caller whose offending name is recorded as a span and not as a `ts.Node`: the declared-symbol
 * table (`symbols.ts`) keeps the span of every name it lowered, and the reserved-name check
 * (#103) reports on exactly those. Same fields, same conversion; only the source of the span
 * differs.
 */
export function makeSpanDiagnostic(
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
  message: string,
  code: TsCode,
  category: TsCompilerDiagnostic['category'] = 'error',
): TsCompilerDiagnostic {
  return diagnosticForSpan(sourceFile, start, start + length, message, code, category);
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
  );
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
    const start = Math.min(d.start ?? 0, sourceFile.text.length);
    const end = Math.min(start + (d.length ?? 0), sourceFile.text.length);
    return diagnosticForSpan(
      sourceFile,
      start,
      end,
      ts.flattenDiagnosticMessageText(d.messageText, ' '),
      TS_CODES.SYNTAX,
      categoryOf(d.category),
    );
  });
}

function categoryOf(category: ts.DiagnosticCategory): TsCompilerDiagnostic['category'] {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error';
    case ts.DiagnosticCategory.Warning:
      return 'warning';
    default:
      return 'message';
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
    .parseDiagnostics;
  if (recorded) return recorded;
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
  };
  return ts
    .createProgram([sourceFile.fileName], { noResolve: true, noLib: true, types: [] }, host)
    .getSyntacticDiagnostics(sourceFile);
}

/**
 * Drops, in place, each diagnostic that repeats an earlier one word for word at the same span of
 * the same file. A body is lowered once for every instance of a generic function and every set
 * of functions handed to one, and a name the file's own pass resolves is resolved again where a
 * body maps it; each says its mistake once (Rule 12.4).
 */
export function dropRepeatedDiagnostics(diagnostics: TsCompilerDiagnostic[]): void {
  const seen = new Set<string>();
  let kept = 0;
  for (const d of diagnostics) {
    const key = [d.fileName, d.start, d.length, d.code ?? '', d.message].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics[kept++] = d;
  }
  diagnostics.length = kept;
}

/**
 * Puts the diagnostics of one file in document order, in place: span start, then span length (the
 * enclosed span before the enclosing one). The passes of the compiler run one after another, so
 * their order is the order of the passes, and the editor lists the same diagnostics in document
 * order (`byDocumentOrder` in `src/language-service/service.ts`). One order in both halves keeps
 * the first diagnostic the same (Rules 12.5 and 12.7). The sort is stable, so two diagnostics
 * on one span keep the order of the passes. A list that holds more than one file stays as it is.
 */
export function sortDiagnosticsByPosition(diagnostics: TsCompilerDiagnostic[]): void {
  const file = diagnostics[0]?.fileName;
  if (diagnostics.some((d) => d.fileName !== file)) return;
  diagnostics.sort((a, b) => a.start - b.start || a.length - b.length);
}

/**
 * Puts the diagnostics of `fileName` in a list that holds several files in document order, in
 * place, among themselves: each stays in a slot one of them held, and the diagnostics of the
 * other files stay where they are. A linked program's list holds what it reports in the files
 * it imports beside what it reports in the file it starts from (#1186).
 */
export function sortFileDiagnosticsByPosition(
  diagnostics: TsCompilerDiagnostic[],
  fileName: string,
): void {
  const slots: number[] = [];
  diagnostics.forEach((d, i) => {
    if (d.fileName === fileName) slots.push(i);
  });
  const own = slots
    .map((i) => diagnostics[i]!)
    .sort((a, b) => a.start - b.start || a.length - b.length);
  slots.forEach((slot, i) => {
    diagnostics[slot] = own[i]!;
  });
}

// === A refusal a use makes, about a declaration another file of the program holds (#1186) ===
//
// Some refusals are true of a program and not of the file that declares what they name: an
// entry gives a field of an imported struct no location, or a call instantiates an imported
// generic function with a type its body refuses. The declaring file's own program accepts the
// declaration, so its document has nothing to show, and the mistake is in the program that
// uses it. The compiler reports such a refusal in the file the program starts from, at the
// use, as it reports a builtin a stage cannot call (`TS8099`) at the entry, and keeps the place
// the sentence is about as a related site. Neither is a field of `TsCompilerDiagnostic`: both
// are read through the functions here, by the linker's mapping, the language service and the
// tests of both halves.

/** A place in a file of the program, in that file's own offsets; lines and characters are
 *  one-based, as a diagnostic's are. */
export interface DiagnosticSite {
  readonly fileName: string;
  readonly start: number;
  readonly length: number;
  readonly line: number;
  readonly character: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

const USES = new WeakMap<TsCompilerDiagnostic, { start: number; end: number }[]>();
const RELATED = new WeakMap<TsCompilerDiagnostic, readonly DiagnosticSite[]>();

/** Records `use` as a use that makes `diagnostic` a refusal: the entry's parameter or result
 *  that takes a struct, the call that instantiates a generic function. A later call records a
 *  use further out (the call of the function that holds the first use). */
export function noteUse(
  diagnostic: TsCompilerDiagnostic,
  use: ts.Node | undefined,
  sourceFile: ts.SourceFile,
): void {
  if (use === undefined) return;
  const uses = USES.get(diagnostic) ?? [];
  uses.push({ start: use.getStart(sourceFile), end: use.getEnd() });
  USES.set(diagnostic, uses);
}

/** The uses {@link noteUse} recorded for `diagnostic`, innermost first, as `[start, end)` spans
 *  of the source it was raised in. */
export function usesOf(
  diagnostic: TsCompilerDiagnostic,
): readonly { readonly start: number; readonly end: number }[] {
  return USES.get(diagnostic) ?? [];
}

/** Gives `copy`, a diagnostic made from `diagnostic` with another sentence, the uses recorded
 *  for `diagnostic`. */
export function keepUses(copy: TsCompilerDiagnostic, diagnostic: TsCompilerDiagnostic): void {
  const uses = USES.get(diagnostic);
  if (uses !== undefined) USES.set(copy, [...uses]);
}

/** Records the places `diagnostic` is about in other files of its program. */
export function setRelatedSites(
  diagnostic: TsCompilerDiagnostic,
  sites: readonly DiagnosticSite[],
): void {
  if (sites.length > 0) RELATED.set(diagnostic, sites);
}

/** The places `diagnostic` is about in other files of its program: the declaration a refusal
 *  reported at a use names. Empty for a diagnostic that stands where its mistake is. */
export function relatedSitesOf(diagnostic: TsCompilerDiagnostic): readonly DiagnosticSite[] {
  return RELATED.get(diagnostic) ?? [];
}
