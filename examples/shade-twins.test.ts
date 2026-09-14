// ═══ Twins — a `.shade.ts` file and the `fn()` example it claims to be ═══
//
// `docs/use-typeshade-surface.md` calls the EDSL corpus the IR-equality ORACLE for the
// source language. That only means something if some shader exists on both surfaces and
// something checks that they agree; until there was a twin, the sentence was aspirational.
// `examples/PORTING.md` (landed in #12) classifies which of the 36 examples the compiler
// accepts as source today, and why the rest are blocked. This suite is what a twin written
// from that classification is FOR. Two are registered here: `compute-reduction-twin`, and
// `gradient-twin`, which #14 held back until a binding read lowered to a `varref` rather than
// a `constref`, the defect that had `reflect()` blanking every binding's `stages`.
//
// Three jobs, in increasing strength:
//
//   1. THE CLAIM IS WELL-FORMED — every `twinOf` names an example that exists.
//   2. THE INTERFACE IS IDENTICAL — `reflect()` of the twin deep-equals `reflect()` of the
//      original, whole. An assertion, not a golden: there is no acceptable reason for a
//      twin's bind groups, reached stages or entry points to differ from its original's.
//      Not covered by `semanticDiff` below — that compares the authored modules, while
//      `reflect()` is the derived host-facing view, and the gap between them is exactly
//      where #14 lived.
//   3. THE DIFFERENCE IS PINNED — `semanticDiff()`'s four buckets, and a unified diff of
//      the two WGSL texts. Goldens rather than assertions because the two surfaces
//      legitimately differ (an EDSL `const` is a build-time JavaScript binding; a
//      source-language `const` is a shader `let`), and the useful gate is that the
//      DIFFERENCE does not move unnoticed.
//
// READ THE TWO GOLDENS AS THE DIFFERENT THINGS THEY ARE. `semanticDiff` compares the
// AUTHORED modules, before `autoVars` materialises the EDSL's assignment-to-a-value-node
// into a real `var`. So a shader whose emits differ by one identifier can still show a whole
// function as changed in the structural golden: on the EDSL side the vertex body is still
// `assign (construct vec2 …) = …`, which has no counterpart in a source-compiled body and
// drags its literals into the `constants` bucket with it. `gradient-twin` is exactly that
// case — its `.diff` golden is two names and two extra `let`s. The structural golden is the
// record that neither side moved; the text diff is the one to read for what they spell.
//
// The goldens live in `__emit-goldens__/` with the emits they are derived from, so the one
// bake protocol in `_goldens.ts` covers them: `UPDATE_EMIT_GOLDENS=1`.

import { describe, it, expect } from 'vitest'
import { shadeExamples, SHADE_TWINS } from './_shade.js'
import { examples } from './index.js'
import { checkGolden } from './_goldens.js'
import { unifiedDiff } from './_twin-diff.js'
import { emitModule, reflect, semanticDiff, isSemanticallyEqual } from '../src/index.js'

/** The registered twins, paired with the EDSL example each mirrors. Resolved once so a
 *  missing original fails the well-formedness arm below rather than every arm at once. */
const pairs = [...SHADE_TWINS].map(([twinId, ofId]) => ({
  twinId,
  ofId,
  twin: shadeExamples.find((e) => e.id === twinId),
  original: examples.find((e) => e.id === ofId),
}))

describe('twins — the claim is well-formed', () => {
  it('there is at least one twin (the suite is not vacuously green)', () => {
    // Every arm below iterates `pairs`, and an empty list passes all of them. This is the
    // floor that stops `twinOf` being dropped from every entry and the suite still greening.
    expect(pairs.length).toBeGreaterThanOrEqual(1)
  })

  it('every twinOf names a registered example, and every twin is registered', () => {
    for (const p of pairs) {
      expect(p.twin, `${p.twinId}: declared as a twin but not in shadeExamples`).toBeDefined()
      expect(p.original, `${p.twinId}: twinOf "${p.ofId}" is not an examples id`).toBeDefined()
    }
  })
})

describe('twins — the pipeline interface is identical, not merely similar', () => {
  for (const p of pairs) {
    it(`${p.twinId}: reflect() matches ${p.ofId}`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      // Bind groups, std140/std430 layouts, the stages that reach each binding, and every
      // entry-point signature. A twin that shifts a binding or renames an entry point is not
      // the same shader, however close the body is, and no host that packed a buffer for one
      // could drive the other.
      //
      // This compared reflections with `stages` blanked until #14: a source-compiled module
      // encoded a binding read as `constref`, which the reachability walk does not count, so
      // every binding reflected `stages: []`. The exclusion carried an arm asserting the bug
      // still reproduced, and that arm is what failed when #14 landed — which is how both it
      // and the exclusion came to be deleted here rather than outliving the bug.
      expect(reflect(twin.module)).toEqual(reflect(original.module))
    })
  }
})

describe('twins — the difference is pinned', () => {
  for (const p of pairs) {
    it(`${p.twinId}: semanticDiff against ${p.ofId} is byte-stable`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      // The public comparison, defaults and all: `names` and `declOrder` are ignored, so
      // what survives is what the two surfaces genuinely built differently.
      const diff = semanticDiff(original.module, twin.module)
      checkGolden(
        `${p.twinId}.semantic.json`,
        `${JSON.stringify({ twin: p.twinId, of: p.ofId, equal: isSemanticallyEqual(diff), diff }, null, 2)}\n`,
      )
    })

    it(`${p.twinId}: WGSL diff against ${p.ofId} is byte-stable`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      // Spelling, which semanticDiff deliberately does not report.
      const diff = unifiedDiff(
        emitModule(original.module),
        emitModule(twin.module),
        `${p.ofId} (fn() EDSL)`,
        `${p.twinId} ("use typeshade")`,
      )
      checkGolden(`${p.twinId}.diff`, diff)
    })
  }
})
