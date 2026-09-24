// === `typeshade check`: the whole answer about a set of `"use typeshade"` files, host-free ===
//
// One call that says whether a file compiles, in the words an editor would show for it. It is
// the union of two answers that already exist:
//
// - the language service's merged list (TypeScript over the ambient lib, with the false
//   positives `language-service/diagnostics.ts` filters, plus the TypeShade front end), so a
//   command-line check and the editor never disagree about a line (Rule 12.7); and
// - `compile()`'s own list, for what the service never runs: the backends. The service
//   analyses with `emit: false`, so a WGSL emitter that throws (a `TS8015` error) or a GLSL
//   shortfall on a render module (a `TS8015` warning, Rule 12.3) reaches no editor, and a
//   check that stopped at the service would call a file clean that `compile()` refuses.
//
// Plain `tsc` over the same files is the thing this replaces. Configured as the README
// describes, it reports TS1206 on every entry point and TS2362/TS2363/TS2365/TS2322/TS2345/
// TS2769 on vector arithmetic the compiler accepts (542 errors over the 71 examples, none of
// them real), because a `tsc` run loads no language-service plugin. A person learns to skip
// them; a coding agent treats a compiler's output as the truth and "fixes" correct code.
//
// Nothing here touches a filesystem or a process: the caller hands in the documents and gets
// data back (`src/cli/run.ts` is the command, `src/cli/bin.ts` the Node host), which is what
// lets the whole check be tested in memory and keeps `src/` free of host types.
//
// ONE CHECK. It is exported from `typeshade/language-service` so that a tool which keeps its
// own service, the MCP server in typeshade/vscode-typeshade among them, calls
// `checkOpenDocument` rather than assembling the same list again: two copies of it are two
// answers about one file as soon as either changes (Rule 12.7).

import { compile } from '../compiler/ts/compile.js';
import { TS_CODES } from '../compiler/ts/codes.js';
import type { TsCompilerDiagnostic } from '../compiler/ts/source-file.js';
import { createTypeshadeLanguageService, type TypeshadeLanguageService } from './service.js';
import type { TypeshadeDiagnostic } from './types.js';

/** One file to check.
 *
 *  Exported from `typeshade/language-service`. */
export interface CheckDocument {
  /** The name the file is reported under: a path relative to the working directory. */
  readonly path: string;
  /** The document's identity inside the language service, and the name its imports resolve
   *  against: an absolute path when the host has one, otherwise `path` itself. */
  readonly uri: string;
  readonly text: string;
}

/** How one check is set up.
 *
 *  Exported from `typeshade/language-service`. */
export interface CheckOptions {
  /** Reads an imported file the caller did not hand in, by the uri an import resolves to.
   *  Omitted, an import of a file outside the checked set is reported as unresolved. */
  readonly readDocument?: (uri: string) => string | undefined;
  /** Also report the deprecation warnings `compile({ deprecations: true })` reports (§13). */
  readonly deprecations?: boolean;
}

/** One diagnostic as the command reports it: one-based lines and columns, as `tsc` and
 *  `TsCompilerDiagnostic` print them, and the UTF-16 span they are derived from.
 *
 *  Exported from `typeshade/language-service`. */
export interface CheckDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  /** UTF-16 offset of the span's start in the file. */
  readonly offset: number;
  /** Length of the span in UTF-16 code units. */
  readonly length: number;
  readonly severity: 'error' | 'warning' | 'info';
  /** `TS8003` for a TypeShade diagnostic, `TS2322` for a TypeScript one. */
  readonly code: string;
  /** Which half of the pipeline raised it: the TypeShade compiler, or TypeScript's checker over
   *  the ambient lib. */
  readonly source: 'typeshade' | 'typescript';
  readonly message: string;
}

/** Everything one check found, in file order and, within a file, in document order.
 *
 *  Exported from `typeshade/language-service`. */
export interface CheckReport {
  readonly files: readonly string[];
  readonly diagnostics: readonly CheckDiagnostic[];
  readonly errors: number;
  readonly warnings: number;
}

/** Lines and columns of `offset` in `text`, one-based. */
function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function fromService(doc: CheckDocument, d: TypeshadeDiagnostic): CheckDiagnostic {
  return {
    file: doc.path,
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    offset: d.span.start,
    length: d.span.length,
    severity: d.severity === 'error' || d.severity === 'warning' ? d.severity : 'info',
    code: typeof d.code === 'number' ? `TS${d.code}` : d.code,
    source: d.source,
    message: d.message,
  };
}

function fromCompiler(doc: CheckDocument, d: TsCompilerDiagnostic): CheckDiagnostic {
  const start = lineColumnAt(doc.text, d.start);
  const end = lineColumnAt(doc.text, d.start + d.length);
  return {
    file: doc.path,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    offset: d.start,
    length: d.length,
    severity: d.category === 'message' ? 'info' : d.category,
    code: d.code ?? TS_CODES.UNSUPPORTED,
    source: 'typeshade',
    message: d.message,
  };
}

const sameReport = (a: CheckDiagnostic, b: CheckDiagnostic): boolean =>
  a.code === b.code && a.offset === b.offset && a.length === b.length;

/**
 * One document's diagnostics, as `typeshade check` reports them: `service`'s merged list for
 * `doc.uri`, which the caller has opened in `service`, and then what `compile()` adds that the
 * service does not compute. In document order.
 *
 * For a tool that keeps one service and its documents open across requests, so that an import
 * resolves against the documents it holds: an editor host, or the MCP server in
 * typeshade/vscode-typeshade. `checkDocuments` is this over a service of its own.
 *
 * Exported from `typeshade/language-service`.
 */
export function checkOpenDocument(
  service: TypeshadeLanguageService,
  doc: CheckDocument,
  options: Pick<CheckOptions, 'deprecations'> = {},
): CheckDiagnostic[] {
  const found = service
    .getDiagnostics(doc.uri)
    .filter((d) => d.uri === doc.uri)
    .map((d) => fromService(doc, d));
  // The compiler's own run adds what the service does not compute, and nothing else: the
  // backends' verdict (`TS8015`, which an analysis with `emit: false` never reaches) and the
  // opt-in deprecations (`TS8053`). Every other front-end diagnostic is already in the
  // service's list, which keeps the compiler's report where TypeScript and the compiler report
  // one mistake (`mergeDiagnostics`, Rule 12.4: an unknown name is the compiler's `TS8004` or
  // `TS8022` with its "Did you mean", and TypeScript's `TS2552` beside it is dropped), or was
  // left out of it on purpose: a parse error is TypeScript's own `TS1005`-style row in place of
  // the compiler's `TS8030` copy of it.
  const compiled = compile(doc.text, {
    fileName: doc.path,
    ...(options.deprecations === true ? { deprecations: true } : {}),
  });
  for (const d of compiled.diagnostics) {
    if (d.code !== TS_CODES.BACKEND && d.code !== TS_CODES.INT_LITERAL_DEPRECATION) continue;
    const row = fromCompiler(doc, d);
    if (!found.some((f) => sameReport(f, row))) found.push(row);
  }
  return found.sort((a, b) => a.offset - b.offset || a.length - b.length);
}

/**
 * Checks every document and returns what was found.
 *
 * Each document is analysed on its own: it is opened in the service, read, and closed before
 * the next one opens. A `"use typeshade"` file with no `import` or `export` is a TypeScript
 * SCRIPT, whose top-level names are global, so two such files open in one program would report
 * each other's `class VsOut` as a duplicate — a diagnostic about the check, not about either
 * file. One service still serves them all, so the ambient lib is parsed once.
 *
 * Exported from `typeshade/language-service`.
 */
export function checkDocuments(
  docs: readonly CheckDocument[],
  options: CheckOptions = {},
): CheckReport {
  const service = createTypeshadeLanguageService(
    options.readDocument === undefined ? {} : { readDocument: options.readDocument },
  );
  const diagnostics: CheckDiagnostic[] = [];
  for (const doc of docs) {
    service.openDocument(doc.uri, doc.text);
    diagnostics.push(...checkOpenDocument(service, doc, options));
    service.closeDocument(doc.uri);
  }
  return {
    files: docs.map((d) => d.path),
    diagnostics,
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
  };
}
