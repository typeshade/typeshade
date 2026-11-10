// A guard for the tests that hold the CPU tier to the libm (change 0042). Test code only.
//
// A test that compares a CPU result with the libm's routine passes on an engine whose `Math`
// gives the same bits at the test's operands, whichever of the two the CPU tier calls. V8's
// `Math.tan`, `Math.asin`, `Math.acos`, `Math.atan` and `Math.atan2` do at the operands of the
// wiring tests. So those tests run with the engine's function replaced by one that throws: a
// CPU path that still reaches the engine fails by name.

/** A function of the engine's `Math` that the CPU tier must not call. */
export type EngineMathName =
  'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'atan2' | 'exp' | 'log' | 'log2';

/** Run `f` with each function `names` of the engine's `Math` replaced by one that throws, and
 *  put the functions back afterwards, also when `f` throws. `f` is synchronous. */
export function withEngineMathRefused<R>(names: readonly EngineMathName[], f: () => R): R {
  const math = Math as unknown as Record<string, (...args: number[]) => number>;
  const kept = names.map((name) => [name, math[name]!] as const);
  try {
    for (const name of names) {
      math[name] = (): number => {
        throw new Error(`the CPU tier called the engine's Math.${name}`);
      };
    }
    return f();
  } finally {
    for (const [name, original] of kept) math[name] = original;
  }
}
