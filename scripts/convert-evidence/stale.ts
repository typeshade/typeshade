import type { RowWords } from './row-words.js';
import type { Decl, IndexedFile } from './source-index.js';

const WINDOW = 3;

export function hasRowWord(
  file: IndexedFile,
  from: number,
  to: number,
  decls: readonly Decl[],
  row: RowWords,
): boolean {
  if (row.words.length === 0) return false;
  const near = file.lines
    .slice(Math.max(0, from - 1 - WINDOW), Math.min(file.lines.length, to + WINDOW))
    .join('\n');
  const haystack = [near, ...decls.map((decl) => decl.text)].join('\n').toLowerCase();
  return row.words.some((word) => haystack.includes(word));
}
