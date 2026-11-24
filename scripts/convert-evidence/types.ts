import type { EvidenceLiteral } from './literals.js';

export type SegmentClass =
  'exact' | 'inside-large' | 'between' | 'out-of-bounds' | 'test-file' | 'non-ts' | 'outside-src';

export const CLASS_ORDER: readonly SegmentClass[] = [
  'exact',
  'inside-large',
  'between',
  'out-of-bounds',
  'test-file',
  'non-ts',
  'outside-src',
];

export const NO_ROW_WORD = 'no-row-word-nearby';

export interface SegmentResult {
  readonly literal: EvidenceLiteral;
  readonly index: number;
  readonly rowId: string;
  readonly original: string;
  readonly path: string;
  readonly class: SegmentClass;
  readonly reason: string;
  readonly proposed: string | undefined;
  readonly cited: readonly string[];
  readonly stale: boolean;
  readonly blocked: string | undefined;
  readonly eligible: boolean;
}
