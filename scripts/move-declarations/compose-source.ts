import { insertionText, type Gap } from './placement.js';
import type { SourceAnalysis } from './references.js';
import type { SegmentedSource } from './segments.js';

export interface SourceEdit {
  readonly moved: ReadonlySet<number>;
  readonly importEdits: ReadonlyMap<number, readonly string[]>;
  readonly block: string;
}

export function composeSource(
  analysis: SourceAnalysis,
  segmented: SegmentedSource,
  edit: SourceEdit,
  gap: Gap,
): string {
  const { source } = analysis;
  const text = source.text;
  const unitOf = new Map(analysis.units.map((unit, index) => [unit.node, index]));
  const insert = edit.block.length > 0 ? insertionText(gap, source, edit.block) : '';
  const pieces: string[] = [segmented.prefix];
  for (const segment of segmented.segments) {
    if (gap.side === 'before' && gap.at === segment.index) pieces.push(insert);
    const unit = unitOf.get(segment.node);
    const replacement = edit.importEdits.get(segment.index);
    if (unit !== undefined && edit.moved.has(unit)) pieces.push('');
    else if (replacement === undefined) pieces.push(text.slice(segment.from, segment.to));
    else {
      const leading = text.slice(segment.from, segment.node.getStart(source));
      const trailing = text.slice(segment.node.end, segment.to);
      if (replacement.length === 0) pieces.push(/\S/.test(leading) ? leading : '');
      else pieces.push(leading + replacement.join('\n') + trailing);
    }
    if (gap.side === 'after' && gap.at === segment.index) pieces.push(insert);
  }
  if (gap.side === 'before' && gap.at >= segmented.segments.length) pieces.push(insert);
  pieces.push(segmented.tail);
  return pieces.join('');
}
