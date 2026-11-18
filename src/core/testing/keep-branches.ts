import { setIfConversion } from '../passes/opt/if-convert.js';

// Why: a test whose subject is the `if` that another pass emits or places reads the emit without
// the O2 if-conversion; wrapping the test body switches the conversion off for that test only.
export function keepBranches<A extends unknown[], R>(body: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    setIfConversion(false);
    let result: R;
    try {
      result = body(...args);
    } catch (e) {
      setIfConversion(true);
      throw e;
    }
    if (result instanceof Promise) {
      return result.finally(() => setIfConversion(true)) as R;
    }
    setIfConversion(true);
    return result;
  };
}
