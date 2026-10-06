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
//
// `isolate: false` (2026-10-06): a worker keeps the modules it loaded from one test file to the
// next. With isolation each of the ~400 files loaded the compiler and TypeScript again, and that
// load was most of the suite's time: collect 371 s summed against 704 s of tests. Measured on
// 7aa2bd39 on a 4-core container, the suite took 8.0 min isolated and 4.5 min without, 8554
// tests passed both ways, and again in a shuffled file order (seed 528) under `CI=true`. A test
// that changes shared state (a `configure()`, a spy on `console`) restores it in a `finally`, so
// the next file in the worker starts from the defaults.
//
// The TypeShade plugin (`src/vite.ts`) is in the pipeline because Vitest runs on Vite, so
// `src/vite.test.ts` imports a `.shade.ts` through it and calls what it exports, the way a host
// file does (change 0009). It touches nothing else: a file not named `*.shade.ts` passes through,
// unless it is a shader under another name, which no test imports.
import { defineConfig } from 'vitest/config';
import { typeshade } from './src/vite.js';

export default defineConfig({
  plugins: [typeshade()],
  test: {
    include: ['src/**/*.test.ts', 'examples/**/*.test.ts'],
    testTimeout: 90_000,
    isolate: false,
  },
});
