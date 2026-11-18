import { setSmallInlining } from '../passes/specialize-and-inline.js';

// Why: a test whose subject is an emitted helper (its name, shape or place) reads the emit
// without the O2 inliner; wrapping the test body switches the inliner off for that test only.
export function keepHelpers<A extends unknown[], R>(body: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    setSmallInlining(false);
    let result: R;
    try {
      result = body(...args);
    } catch (e) {
      setSmallInlining(true);
      throw e;
    }
    if (result instanceof Promise) {
      return result.finally(() => setSmallInlining(true)) as R;
    }
    setSmallInlining(true);
    return result;
  };
}
