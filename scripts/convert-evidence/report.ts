import { CLASS_ORDER, type SegmentClass, type SegmentResult } from './types.js';

export type ClassCounts = Partial<Record<SegmentClass, number>> & {
  total: number;
  eligible: number;
};

export interface QueueEntry {
  readonly file: string;
  readonly row: string;
  readonly segment: string;
  readonly cited: readonly string[];
  readonly proposed: string | null;
  readonly class: SegmentClass;
  readonly reason: string;
}

export interface Report {
  readonly totals: ClassCounts;
  readonly byCoverageFile: Record<string, ClassCounts>;
  readonly byCitedFile: Record<string, ClassCounts>;
  readonly queue: readonly QueueEntry[];
}

const convertible = (result: SegmentResult): boolean =>
  CLASS_ORDER.indexOf(result.class) < CLASS_ORDER.indexOf('test-file');

function tally(into: Record<string, ClassCounts>, key: string, result: SegmentResult): void {
  const counts = (into[key] ??= { total: 0, eligible: 0 });
  counts.total += 1;
  counts[result.class] = (counts[result.class] ?? 0) + 1;
  if (result.eligible) counts.eligible += 1;
}

export const queueEntry = (result: SegmentResult): QueueEntry => ({
  file: result.literal.file,
  row: result.rowId,
  segment: result.original,
  cited: result.cited,
  proposed: result.proposed ?? null,
  class: result.class,
  reason: [result.reason, result.blocked ?? ''].filter((text) => text !== '').join('; '),
});

export function buildReport(results: readonly SegmentResult[]): Report {
  const all: Record<string, ClassCounts> = {};
  const byCoverageFile: Record<string, ClassCounts> = {};
  const byCitedFile: Record<string, ClassCounts> = {};
  for (const result of results) {
    tally(all, 'all', result);
    tally(byCoverageFile, result.literal.file, result);
    tally(byCitedFile, result.path, result);
  }
  return {
    totals: all.all ?? { total: 0, eligible: 0 },
    byCoverageFile,
    byCitedFile,
    queue: results.filter((result) => convertible(result) && !result.eligible).map(queueEntry),
  };
}

const TOP = 10;

export function formatReport(report: Report): string[] {
  const lines = [`segments: ${report.totals.total}`];
  for (const name of CLASS_ORDER) lines.push(`  ${name}: ${report.totals[name] ?? 0}`);
  lines.push(`eligible for --write --only exact: ${report.totals.eligible}`);
  lines.push(`review queue: ${report.queue.length}`);
  lines.push('by coverage file:');
  for (const [file, counts] of Object.entries(report.byCoverageFile)) {
    lines.push(
      `  ${file}: ${counts.total} (exact ${counts.exact ?? 0}, eligible ${counts.eligible})`,
    );
  }
  lines.push(`cited files with the most eligible segments (top ${TOP}):`);
  const top = Object.entries(report.byCitedFile)
    .sort(([, a], [, b]) => b.eligible - a.eligible)
    .slice(0, TOP);
  for (const [file, counts] of top) lines.push(`  ${file}: ${counts.eligible} of ${counts.total}`);
  return lines;
}
