import { relatedSitesOf } from '../../compiler/ts/diagnostic.js';
import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';
import type { FieldFacts } from './field-line.js';

export function refusalCode(
  analysis: CompileTsSourceResult,
  facts: FieldFacts,
  fileName: string,
  start: number,
): string | undefined {
  if (facts.location !== undefined || facts.builtin === true) return undefined;
  const covers = (at: { fileName: string; start: number; length: number }): boolean =>
    at.fileName === fileName && at.start <= start && start < at.start + at.length;
  return analysis.diagnostics.find(
    (d) => d.category === 'error' && (covers(d) || relatedSitesOf(d).some(covers)),
  )?.code;
}
