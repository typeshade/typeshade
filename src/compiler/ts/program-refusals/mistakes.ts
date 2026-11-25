import ts from 'typescript';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { relatedSitesOf } from '../diagnostic.js';

export interface Span {
  readonly fileName: string;
  readonly start: number;
  readonly length: number;
}

// Why: the linker drops an imported declaration's `export` and `default` with the whitespace
// after them, so a comment after them stays and the node maps from the token after it, where the
// file's own program reads it from `export`.
const samePlace = (a: Span, b: Span, textOf: (fileName: string) => string | undefined): boolean => {
  if (a.fileName !== b.fileName || a.start + a.length !== b.start + b.length) return false;
  if (a.start === b.start) return true;
  const between = textOf(a.fileName)?.slice(Math.min(a.start, b.start), Math.max(a.start, b.start));
  return between !== undefined && onlyExportBetween(between);
};

function onlyExportBetween(text: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true);
  scanner.setText(text);
  let exported = false;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.ExportKeyword) exported = true;
    else if (token !== ts.SyntaxKind.DefaultKeyword) return false;
  }
  return exported;
}

export const mistakeKey = (code: string | undefined, sentence: string): string =>
  [code ?? '', sentence].join('\u0000');

export type Mistakes = ReadonlyMap<string, readonly { site: Span; places: readonly Span[] }[]>;

export function mistakesOf(diagnostics: readonly TsCompilerDiagnostic[]): Mistakes {
  const out = new Map<string, { site: Span; places: Span[] }[]>();
  for (const d of diagnostics) {
    if (d.category !== 'error') continue;
    const related = relatedSitesOf(d);
    const key = mistakeKey(d.code, d.message);
    const list = out.get(key) ?? [];
    out.set(key, list);
    for (const site of related.length > 0 ? related : [d]) list.push({ site, places: [d] });
  }
  return out;
}

export const reports = (
  mistakes: Mistakes,
  key: string,
  site: Span,
  place: Span,
  textOf: (fileName: string) => string | undefined,
): boolean =>
  (mistakes.get(key) ?? []).some(
    (m) => samePlace(m.site, site, textOf) && m.places.some((at) => samePlace(at, place, textOf)),
  );
