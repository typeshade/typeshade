import { setVarToLet } from '../passes/opt/var-to-let.js';

// Why: a test whose subject is the declaration of a `var` that O2 would turn into a `let` and
// fold away reads the emit without that promotion; wrapping the test body switches it off for
// that test only.
export function keepVars<A extends unknown[], R>(body: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    setVarToLet(false);
    let result: R;
    try {
      result = body(...args);
    } catch (e) {
      setVarToLet(true);
      throw e;
    }
    if (result instanceof Promise) {
      return result.finally(() => setVarToLet(true)) as R;
    }
    setVarToLet(true);
    return result;
  };
}
