import { locate } from './locate.js';
import { chooseNeedle } from './needle.js';
import type { RowWords } from './row-words.js';
import { anchorOf, sizeOf, type Decl, type IndexedFile } from './source-index.js';
import type { SegmentClass } from './types.js';

const EXACT_LIMIT = 40;
const MANY_LIMIT = 3;
const CITED_LINES_FOR_NEEDLE = 12;

export interface Piece {
  readonly decl: Decl;
  readonly needle: string | undefined;
}

export interface PartResult {
  readonly class: SegmentClass;
  readonly reason: string;
  readonly pieces: readonly Piece[];
  readonly matched: readonly Decl[];
}

const textOfLines = (file: IndexedFile, from: number, to: number): string =>
  file.lines.slice(from - 1, Math.min(to, from - 1 + CITED_LINES_FOR_NEEDLE)).join('\n');

export function classifyPart(
  file: IndexedFile,
  from: number,
  to: number,
  row: RowWords,
): PartResult {
  if (from < 1 || to < from || to > file.lines.length) {
    return {
      class: 'out-of-bounds',
      reason: `lines ${from}-${to} lie outside the file of ${file.lines.length} lines`,
      pieces: [],
      matched: [],
    };
  }
  const found = locate(file.decls, from, to);
  if (found.kind === 'none') {
    return {
      class: 'between',
      reason: `lines ${from}-${to} lie in no declaration`,
      pieces: [],
      matched: [],
    };
  }
  if (found.kind === 'one') {
    const { decl } = found;
    const exact = (decl.from === from && decl.to === to) || sizeOf(decl) <= EXACT_LIMIT;
    if (exact) {
      return { class: 'exact', reason: '', pieces: [{ decl, needle: undefined }], matched: [decl] };
    }
    const needle = chooseNeedle(decl, textOfLines(file, from, to), row);
    return {
      class: 'inside-large',
      reason: `inside ${anchorOf(decl)} of ${sizeOf(decl)} lines`,
      pieces: [{ decl, needle }],
      matched: [decl],
    };
  }
  const covered = (decl: Decl): boolean => from <= decl.from && to >= decl.to;
  const exact =
    found.decls.length <= MANY_LIMIT &&
    found.decls.every((decl) => covered(decl) || sizeOf(decl) <= EXACT_LIMIT);
  return {
    class: exact ? 'exact' : 'inside-large',
    reason: exact ? '' : `spans ${found.decls.length} declarations`,
    pieces: found.decls.map((decl) => ({ decl, needle: undefined })),
    matched: found.decls,
  };
}
