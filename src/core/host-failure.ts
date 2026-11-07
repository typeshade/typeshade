// Implements: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).
import type { ResidentArrayState } from './resident.js';

/** Private generated incoming-content facts (0129). An empty list is complete, with no reads.
 *  Missing facts are an older artifact: conservatively treat every Resident as a read. */
export type IncomingReads = readonly string[] | undefined;

/** Refuse the first failed content input in declared order. A plan can provisionally supply a
 *  handle through an earlier approved writer, without clearing its real error before success. */
export function checkIncoming(
  states: readonly ResidentArrayState[],
  supplied?: ReadonlySet<ResidentArrayState>,
): void {
  for (const s of states) if (!supplied?.has(s) && s.error !== undefined) throw s.error;
}
