import { AnchorResolver } from '../symbol-anchors/resolve.js';
import { buildAnchors } from './anchors.js';
import type { EvidenceLiteral } from './literals.js';
import { classifyPart, type PartResult } from './parts.js';
import { rowWords, type RowWords } from './row-words.js';
import { SEGMENT_SEPARATOR, parseLineCitation } from './segments.js';
import { SourceIndex, type Decl, type IndexedFile } from './source-index.js';
import { hasRowWord } from './stale.js';
import { CLASS_ORDER, NO_ROW_WORD, type SegmentClass, type SegmentResult } from './types.js';

const SOURCE_PREFIX = 'src/';
const CITED_TEXT_LIMIT = 12;

function untouched(path: string): SegmentClass | undefined {
  if (path.endsWith('.test.ts')) return 'test-file';
  if (!path.endsWith('.ts')) return 'non-ts';
  return path.startsWith(SOURCE_PREFIX) ? undefined : 'outside-src';
}

const worst = (classes: readonly SegmentClass[]): SegmentClass =>
  classes.reduce((a, b) => (CLASS_ORDER.indexOf(b) > CLASS_ORDER.indexOf(a) ? b : a));

function citedLines(file: IndexedFile, ranges: readonly { from: number; to: number }[]): string[] {
  const out: string[] = [];
  for (const { from, to } of ranges) {
    for (let line = Math.max(1, from); line <= Math.min(to, file.lines.length); line += 1) {
      if (out.length < CITED_TEXT_LIMIT) out.push(`${line}: ${file.lines[line - 1]}`);
    }
  }
  return out;
}

export class Classifier {
  private readonly index: SourceIndex;
  private readonly resolver: AnchorResolver;

  constructor(root: string) {
    this.index = new SourceIndex(root);
    this.resolver = new AnchorResolver(root);
  }

  classify(literal: EvidenceLiteral, position: number, segment: string): SegmentResult | undefined {
    const citation = parseLineCitation(segment);
    if (citation === undefined) return undefined;
    const rowId = literal.covers[0] ?? literal.rowName;
    const base = {
      literal,
      index: position,
      rowId,
      original: segment,
      path: citation.path,
      proposed: undefined,
      cited: [] as string[],
      stale: false,
      blocked: undefined,
      eligible: false,
    };
    const skipped = untouched(citation.path);
    if (skipped !== undefined) return { ...base, class: skipped, reason: 'not converted' };
    const file = this.index.get(citation.path);
    if (file === undefined) {
      return { ...base, class: 'out-of-bounds', reason: `${citation.path} does not exist` };
    }
    const row = rowWords(literal.rowName, literal.covers);
    const parts = citation.ranges.map((range) => classifyPart(file, range.from, range.to, row));
    return this.assemble(base, citation, file, parts, row);
  }

  private assemble(
    base: Omit<SegmentResult, 'class' | 'reason'>,
    citation: NonNullable<ReturnType<typeof parseLineCitation>>,
    file: IndexedFile,
    parts: readonly PartResult[],
    row: RowWords,
  ): SegmentResult {
    const cls = worst(parts.map((part) => part.class));
    const reasons = parts.map((part) => part.reason).filter((reason) => reason !== '');
    const cited = citedLines(file, citation.ranges);
    const stale = parts.some((part, at) => {
      const range = citation.ranges[at]!;
      const decls: readonly Decl[] = part.matched;
      return !hasRowWord(file, range.from, range.to, decls, row);
    });
    const convertible = parts.every((part) => part.pieces.length > 0);
    const built = convertible
      ? buildAnchors(
          this.resolver,
          citation.path,
          parts.flatMap((part) => part.pieces),
        )
      : undefined;
    const proposed =
      built === undefined ? undefined : `${citation.path}#${built.text}${citation.comment}`;
    const writable = base.literal.quote !== undefined;
    const blocked = built?.blocked ?? (writable ? undefined : 'concatenated string');
    return {
      ...base,
      class: cls,
      reason: [...reasons, ...(stale ? [NO_ROW_WORD] : [])].join('; '),
      proposed,
      cited,
      stale,
      blocked,
      eligible: cls === 'exact' && !stale && blocked === undefined && proposed !== undefined,
    };
  }

  segmentsOf(literal: EvidenceLiteral): SegmentResult[] {
    return literal.value
      .split(SEGMENT_SEPARATOR)
      .flatMap((segment, at) => this.classify(literal, at, segment) ?? []);
  }
}
