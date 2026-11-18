import { it } from 'vitest';
import { setSmallInlining } from '../passes/specialize-and-inline.js';

/** Why: a test whose subject is an emitted function (a lowered name, a respelled builtin, a
 *  linker name) runs with the O2 small-function inliner off, and puts it back after. */
export const itNoInlining = (name: string, fn: () => void | Promise<void>, timeout?: number) =>
  it(
    name,
    async () => {
      setSmallInlining(false);
      try {
        await fn();
      } finally {
        setSmallInlining(true);
      }
    },
    timeout,
  );
