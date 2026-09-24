// ═══ shader-dsl examples — emit goldens (X-GIS #763 V3) ═══
//
// Byte-equal drift gate over EVERY example module's emitted WGSL (and, for the
// renderable ones, both GLSL ES 3.00 stages) — the same per-commit pinning the
// polygon composer gets from polygon-variant-diff.test.ts, extended to the whole
// public example surface. This is what turns "emitModule(...).length > 50" into a
// real assertion: any emitter/optimizer/example change that perturbs a single byte
// of shipped output shows up as a reviewed golden diff, not a silent drift.
//
// Re-bake protocol (intentional emit changes): re-run with the env flag set —
//   bun run bake:goldens        (package.json: the three golden suites under the flag)
//   (equivalently: UPDATE_EMIT_GOLDENS=1 bunx vitest run examples/emit-goldens.test.ts)
// — then commit the refreshed __emit-goldens__/ alongside the emitter change.
//
// The bake protocol itself (the env flag, the CRLF normalisation, the two failure messages)
// moved to `_goldens.ts` when `shade-examples.test.ts` began pinning the `"use typeshade"`
// corpus into the same directory: two copies of it is how one suite comes to be baked and
// the other left red against the files that bake just rewrote.
//
// Verifies: Rule 3.2, Rule 7.2, Rule 11.4 (docs/language-design.md; traced in reqs/).

import { describe, it, expect } from 'vitest';
import { examples } from './index.js';
import { checkGolden } from './_goldens.js';
import { emitModule, emitGlslModule } from '../src/index.js';

describe('shader-dsl examples — emit goldens', () => {
  it('covers every registered example (registry growth forces a bake, not a skip)', () => {
    expect(examples.length).toBeGreaterThanOrEqual(10);
  });

  for (const ex of examples) {
    it(`${ex.id}: WGSL emit is byte-stable`, () => {
      checkGolden(`${ex.id}.wgsl`, emitModule(ex.module));
    });
  }

  for (const ex of examples.filter((e) => e.renderable)) {
    it(`${ex.id}: GLSL ES 3.00 emits (vertex + fragment) are byte-stable`, () => {
      checkGolden(`${ex.id}.vertex.glsl`, emitGlslModule(ex.module, 'vertex'));
      checkGolden(`${ex.id}.fragment.glsl`, emitGlslModule(ex.module, 'fragment'));
    });
  }
});
