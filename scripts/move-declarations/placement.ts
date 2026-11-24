import ts from 'typescript';
import { directiveCount, type SegmentedSource } from './segments.js';

export interface Gap {
  readonly side: 'before' | 'after';
  readonly at: number;
  readonly label: string;
}

export function candidateGaps(source: ts.SourceFile, segmented: SegmentedSource): Gap[] {
  const imports = segmented.segments
    .filter((segment) => ts.isImportDeclaration(segment.node))
    .map((segment) => segment.index);
  if (imports.length === 0) {
    return [{ side: 'before', at: directiveCount(source), label: 'before the first declaration' }];
  }
  const gaps: Gap[] = [
    { side: 'after', at: imports[imports.length - 1]!, label: 'after the last import' },
    { side: 'before', at: imports[0]!, label: 'before the first import' },
  ];
  for (const at of imports.slice(0, -1).reverse()) {
    gaps.push({ side: 'after', at, label: `after the import at statement ${at}` });
  }
  return gaps;
}

export function insertionText(gap: Gap, source: ts.SourceFile, block: string): string {
  if (gap.side === 'after') return `\n${block}`;
  const next = source.statements[gap.at];
  return next !== undefined && ts.isImportDeclaration(next) ? `${block}\n` : `${block}\n\n`;
}
