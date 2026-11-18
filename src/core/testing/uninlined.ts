import { setSmallInlining } from '../passes/specialize-and-inline.js';

// Why: a test of an emitted helper's name reads the emit the O2 inliner would have folded away.
export function uninlined<T>(run: () => T): T {
  setSmallInlining(false);
  try {
    return run();
  } finally {
    setSmallInlining(true);
  }
}
