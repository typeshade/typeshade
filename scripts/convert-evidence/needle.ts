import { identifiersOf, type RowWords } from './row-words.js';
import type { Decl } from './source-index.js';

const STOP = new Set([
  'readonly',
  'return',
  'string',
  'number',
  'boolean',
  'export',
  'import',
  'function',
  'undefined',
  'typeof',
  'instanceof',
  'static',
  'public',
  'private',
  'protected',
  'declare',
  'abstract',
  'extends',
  'implements',
  'interface',
  'unknown',
  'default',
  'switch',
  'throw',
]);

const CITED_TOKEN_LENGTH = 6;

export function countOf(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
    count += 1;
  }
  return count;
}

const usable = (needle: string): boolean => !/["|]/.test(needle) && !needle.includes('; ');

function bestOf(decl: Decl, candidates: readonly string[]): string | undefined {
  return candidates.find(
    (needle) =>
      usable(needle) &&
      needle !== decl.symbol &&
      needle !== decl.member &&
      countOf(decl.text, needle) === 1,
  );
}

export function chooseNeedle(decl: Decl, citedText: string, row: RowWords): string | undefined {
  const fromRow = bestOf(decl, row.tokens);
  if (fromRow !== undefined) return fromRow;
  const fromLines = identifiersOf(citedText)
    .filter((token) => token.length >= CITED_TOKEN_LENGTH && !STOP.has(token))
    .sort((left, right) => right.length - left.length);
  return bestOf(decl, fromLines);
}
