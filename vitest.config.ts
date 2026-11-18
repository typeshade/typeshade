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
import type { Plugin } from 'vite';
import { typeshade } from './src/vite.js';

// Vitest 5 keeps transformed modules on disk between runs (`fsModuleCache`, on by default), keyed
// by a file's own content and the config. The TypeShade plugin's transform of a `*.shade.ts` reads
// the shader modules it imports (Rule 3.9) and writes the host view beside it, so a cached result
// would miss an edit to an imported module and skip the view. A shader module is never cached;
// every other module is.
const shaderModulesUncached: Plugin = {
  name: 'typeshade-shader-modules-uncached',
  configureVitest({ defineCacheKeyGenerator }) {
    defineCacheKeyGenerator(({ id }) =>
      id.split('?')[0]!.endsWith('.shade.ts') ? false : undefined,
    );
  },
};

// A file that calls `vi.mock` runs in a project of its own, with isolation (2026-10-19). A mock
// takes effect only for a module the worker loads after it, and without isolation an earlier file
// in the same worker has often loaded the mocked module already. `src/fuse.test.ts` mocks
// `core/gl-context.js` and `core/gl-compute.js`, and in a shuffled order (seed 11) four of its
// WebGL2-tier tests read the real `glContext` and failed. List such a file in `MOCKS`.
const MOCKS = ['src/fuse.test.ts', 'src/core/fuse-loading.test.ts'];

// This file ran slower after other tests in the shared-worker measurements.
// Give this file a fresh worker; retain module reuse for the rest of the suite.
const FP64 = ['src/core/fp64/df64-int-property.test.ts'];

// These files read the emitted text of a helper function: its name, its signature or its place in
// the emit. The inliner of `src/core/passes/inline-small.ts` removes such a helper, so the files run
// with it off (`src/core/testing/no-inlining.ts`). A file that tests behaviour does not belong here.
const NO_INLINING = [
  'src/compiler/ts/abstract-const.test.ts',
  'src/compiler/ts/array-destructuring.test.ts',
  'src/compiler/ts/array-length.test.ts',
  'src/compiler/ts/array-methods.test.ts',
  'src/compiler/ts/atomics.test.ts',
  'src/compiler/ts/block-scope.test.ts',
  'src/compiler/ts/builtin-breadth.test.ts',
  'src/compiler/ts/builtins.test.ts',
  'src/compiler/ts/class-methods.test.ts',
  'src/compiler/ts/class-statics.test.ts',
  'src/compiler/ts/class-syntax.test.ts',
  'src/compiler/ts/closures.test.ts',
  'src/compiler/ts/const-expr.test.ts',
  'src/compiler/ts/convert-ctor.test.ts',
  'src/compiler/ts/declared-builtin-names.test.ts',
  'src/compiler/ts/default-args.test.ts',
  'src/compiler/ts/definite-assignment.test.ts',
  'src/compiler/ts/function-shadowing.test.ts',
  'src/compiler/ts/generic-classes.test.ts',
  'src/compiler/ts/generics.test.ts',
  'src/compiler/ts/glsl-block-value.test.ts',
  'src/compiler/ts/higher-order.test.ts',
  'src/compiler/ts/honest-refusals-tuples.test.ts',
  'src/compiler/ts/honest-refusals.test.ts',
  'src/compiler/ts/host-entry.test.ts',
  'src/compiler/ts/host-kernel-gl-length.test.ts',
  'src/compiler/ts/host-kernel-push.test.ts',
  'src/compiler/ts/inheritance.test.ts',
  'src/compiler/ts/inout-params.test.ts',
  'src/compiler/ts/internal-ops.test.ts',
  'src/compiler/ts/kernel-loops.test.ts',
  'src/compiler/ts/kernel-project.test.ts',
  'src/compiler/ts/link.test.ts',
  'src/compiler/ts/local-functions.test.ts',
  'src/compiler/ts/local-places.test.ts',
  'src/compiler/ts/mixins.test.ts',
  'src/compiler/ts/module.test.ts',
  'src/compiler/ts/mutable-parameters.test.ts',
  'src/compiler/ts/namespace-class.test.ts',
  'src/compiler/ts/namespace.test.ts',
  'src/compiler/ts/new-expression.test.ts',
  'src/compiler/ts/operators-statements.test.ts',
  'src/compiler/ts/optional-values.test.ts',
  'src/compiler/ts/overloads.test.ts',
  'src/compiler/ts/pack.test.ts',
  'src/compiler/ts/packed-4x8.test.ts',
  'src/compiler/ts/reference-parameters.test.ts',
  'src/compiler/ts/reference-reads.test.ts',
  'src/compiler/ts/reserved-names.test.ts',
  'src/compiler/ts/return-inference.test.ts',
  'src/compiler/ts/sequence.test.ts',
  'src/compiler/ts/spread.test.ts',
  'src/compiler/ts/swizzle-assign.test.ts',
  'src/compiler/ts/tint-invalid.test.ts',
  'src/compiler/ts/type-alias.test.ts',
  'src/compiler/ts/uniform-layout.test.ts',
];

const NO_INLINING_MOCKS = ['src/fuse.test.ts'];

export default defineConfig({
  plugins: [typeshade(), shaderModulesUncached],
  test: {
    // Keep runtime dependency records. PR selection builds the static graph separately:
    // a conditional import absent from a recorded run must still reach its tests.
    experimental: { recordDependencies: true },
    testTimeout: 90_000,
    // One event-loop turn after every test, so a run of synchronous tests cannot starve the
    // worker's RPC replies for 60 s (the file says why; #783).
    setupFiles: ['./src/core/testing/yield-between-tests.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          include: ['src/**/*.test.ts', 'examples/**/*.test.ts'],
          exclude: ['**/node_modules/**', ...MOCKS, ...FP64, ...NO_INLINING],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'no-inlining',
          include: NO_INLINING,
          isolate: false,
          setupFiles: [
            './src/core/testing/yield-between-tests.ts',
            './src/core/testing/no-inlining.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'no-inlining-mocks',
          include: NO_INLINING_MOCKS,
          isolate: true,
          setupFiles: [
            './src/core/testing/yield-between-tests.ts',
            './src/core/testing/no-inlining.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'mocks',
          include: MOCKS.filter((f) => !NO_INLINING_MOCKS.includes(f)),
          isolate: true,
        },
      },
      {
        extends: true,
        test: { name: 'fp64', include: FP64, isolate: true },
      },
    ],
  },
});
