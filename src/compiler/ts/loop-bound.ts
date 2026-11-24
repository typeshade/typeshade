export { analyzeCountedFor, boundWrittenIn } from './loop-bound/counted-for.js';
export type { CountedLoop } from './loop-bound/counted-for.js';
// Implements: Rule 7.5
// Implements: Rule 7.4 (docs/language-design.md; traced in reqs/).

export {
  constShiftAmountOutOfRange,
  constCallOutsideDomain,
  constF32OutOfRange,
  crossedClampBounds,
} from './loop-bound/const-proofs.js';
export { openLoopError } from './loop-bound/open-loop.js';
export { foldConstComponents } from './loop-bound/const-components.js';
export { forUpdateRefusal } from './loop-bound/step.js';
export { foldConstNumber, foldConstBool, foldConstValue } from './loop-bound/fold-const.js';
