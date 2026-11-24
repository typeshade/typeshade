import { workingCoverageTexts } from '../move-purity/line-citations.js';
import { Classifier } from './classify.js';
import { findEvidenceLiterals } from './literals.js';
import type { SegmentResult } from './types.js';

export interface Filters {
  readonly file?: string | undefined;
  readonly cited?: string | undefined;
}

export interface Analysis {
  readonly results: readonly SegmentResult[];
  readonly texts: ReadonlyMap<string, string>;
}

const matchesFile = (path: string, wanted: string | undefined): boolean =>
  wanted === undefined || path === wanted || path.endsWith(`/${wanted}`);

export function analyze(root: string, filters: Filters = {}): Analysis {
  const texts = workingCoverageTexts(root);
  const classifier = new Classifier(root);
  const results: SegmentResult[] = [];
  for (const [file, text] of texts) {
    if (!matchesFile(file, filters.file)) continue;
    for (const literal of findEvidenceLiterals(file, text)) {
      for (const result of classifier.segmentsOf(literal)) {
        if (filters.cited === undefined || result.path === filters.cited) results.push(result);
      }
    }
  }
  return { results, texts };
}
