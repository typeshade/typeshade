// The STANDALONE tree's vitest config — the mirror repository and a consumer checkout, where
// `bun run test` runs from this directory. Inside the monorepo the same files run from the
// root `vitest.config.ts`, which never reads this one (vitest resolves the config of the
// directory it is invoked from; a nested config is not a project of the root's).
//
// `testTimeout` mirrors the root config's value, and is the reason this file exists: the
// df64 property suites (`src/core/fp64/df64-int-property.test.ts`) sample random inputs for
// 8–16 s per test on a 4-core container, and vitest's 5 s default fails four of them in a
// tree that has no other config to say otherwise (measured 2026-09-07, X-GIS #2660).
//
// Raised from 30 s to 90 s on 2026-09-14, because 30 s was not the headroom it looked like.
// Measured on an idle container, the two slowest tests in that file are `floor / fract match
// f64 up to 2^40` at 14.1 s and `'div': worst error inside the float-flavor tolerance` at
// 13.4 s — already half the budget before any contention. On a loaded CI runner the same two
// came back at 19.9 s and a timeout, so the whole file sits one busy runner away from red on
// any branch, whatever that branch changed. A test that takes 14 s idle needs a limit set
// against its loaded cost, not its idle one; 90 s is ~6x the idle worst case. This is a
// ceiling, not a budget — a test that actually hangs still fails, just later.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'examples/**/*.test.ts'],
    testTimeout: 90_000,
  },
});
