import { it } from 'vitest';
import { setSmallInlining } from '../passes/specialize-and-inline.js';

async function withoutInlining(fn: () => void | Promise<void>): Promise<void> {
  setSmallInlining(false);
  try {
    await fn();
  } finally {
    setSmallInlining(true);
  }
}

// Why: a test whose subject is an emitted function (a lowered name, a respelled builtin, a
// linker name) runs with the O2 small-function inliner off, and puts it back after.
export const itNoInlining = Object.assign(
  (name: string, fn: () => void | Promise<void>, timeout?: number) =>
    it(name, () => withoutInlining(fn), timeout),
  {
    each:
      <T extends unknown[]>(cases: readonly T[]) =>
      (name: string, fn: (...args: T) => void | Promise<void>) =>
        it.each(cases)(name, (...args) => withoutInlining(() => fn(...(args as unknown as T)))),
  },
);
