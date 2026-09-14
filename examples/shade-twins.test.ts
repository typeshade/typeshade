// ═══ Twins — a `.shade.ts` file and the `fn()` example it claims to be ═══
//
// `docs/use-typeshade-surface.md` calls the EDSL corpus the IR-equality ORACLE for the
// source language. That only means something if some shader exists on both surfaces and
// something checks that they agree; until there was a twin, the sentence was aspirational.
// `examples/PORTING.md` classifies which of the 36 examples can be written in the source
// language today — two of them, at the time of writing — and this suite is what those two
// are FOR.
//
// Three jobs, in increasing strength:
//
//   1. THE CLAIM IS WELL-FORMED — every `twinOf` names an example that exists.
//   2. THE INTERFACE IS IDENTICAL — `reflect()` of the twin deep-equals `reflect()` of the
//      original. This is an assertion, not a golden, because there is no acceptable reason
//      for a twin's bind groups or entry points to differ from its original's: that would
//      not be "the same shader written differently", it would be a different shader.
//   3. THE BODIES ARE PINNED — a unified diff of the two WGSL emits, plus a structural
//      comparison of the two LOWERED modules with local names canonicalised. These are
//      goldens rather than assertions because the two surfaces legitimately differ (an EDSL
//      `const` is a build-time JavaScript binding; a source-language `const` is a shader
//      `let`), and the useful gate is that the DIFFERENCE does not move unnoticed.
//
// The goldens live in `__emit-goldens__/` with the emits they are derived from, so the one
// bake protocol in `_goldens.ts` covers them: `bun run bake:goldens` from the repo root.

import { describe, it, expect } from 'vitest'
import { shadeExamples, SHADE_TWINS } from './_shade.js'
import { examples } from './index.js'
import { checkGolden } from './_goldens.js'
import { unifiedDiff, twinReport } from './_twin-diff.js'
import { emitModule, reflect } from '../src/index.js'

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

// ── #14: bindings are invisible to stage reachability in source-compiled modules ──
//
// The source compiler encodes a binding read as `constref`; `stage-bindings.ts` counts only
// `varref`, so every binding of every `"use typeshade"` module reflects `stages: []` while
// its EDSL twin reflects the stage that reads it. Blanking the field on BOTH sides keeps the
// rest of the interface — group, binding, name, address space, access, resource kind, owner,
// struct name, and every entry point — compared for real instead of dropping the assertion.
// The arm below asserts the bug is STILL THERE, so when #14 lands it fails and takes this
// normalisation with it rather than leaving a permanent hole.
function withoutStages(r: ReturnType<typeof reflect>): unknown {
  return {
    ...r,
    bindGroups: r.bindGroups.map((g) => ({
      ...g,
      entries: g.entries.map(({ stages, ...rest }) => rest),
    })),
  }
}

describe('twins — the pipeline interface is identical, not merely similar', () => {
  for (const p of pairs) {
    it(`${p.twinId}: reflect() matches ${p.ofId} (stages excluded — #14)`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      // Bind groups, std140/std430 layouts and entry-point signatures. A twin that shifts a
      // binding or renames an entry point is not the same shader, however close the body is,
      // and no host that packed a buffer for one could drive the other.
      expect(withoutStages(reflect(twin.module))).toEqual(withoutStages(reflect(original.module)))
    })

    it(`${p.twinId}: #14 still reproduces — drop withoutStages() when this fails`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      const stagesOf = (m: typeof twin.module): string[] =>
        reflect(m).bindGroups.flatMap((g) => g.entries.flatMap((e) => [...e.stages]))
      // The original reaches its bindings; the twin reaches none. The day that stops being
      // true, #14 is fixed: delete this arm and the normalisation above, and let the
      // assertion compare reflections whole.
      expect(
        stagesOf(original.module).length,
        `${p.ofId}: the EDSL side should reach its bindings`,
      ).toBeGreaterThan(0)
      expect(stagesOf(twin.module), `${p.twinId}: #14 appears to be fixed`).toEqual([])
    })
  }
})

describe('twins — the emit difference is pinned', () => {
  for (const p of pairs) {
    it(`${p.twinId}: WGSL diff against ${p.ofId} is byte-stable`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      const diff = unifiedDiff(
        emitModule(original.module),
        emitModule(twin.module),
        `${p.ofId} (fn() EDSL)`,
        `${p.twinId} ("use typeshade")`,
      )
      checkGolden(`${p.twinId}.diff`, diff)
    })

    it(`${p.twinId}: lowered-module comparison against ${p.ofId} is byte-stable`, () => {
      const twin = p.twin
      const original = p.original
      expect(twin).toBeDefined()
      expect(original).toBeDefined()
      if (!twin || !original) return
      const report = twinReport(
        p.twinId,
        p.ofId,
        original.module,
        twin.module,
        emitModule(original.module),
        emitModule(twin.module),
      )
      checkGolden(`${p.twinId}.semantic.json`, `${JSON.stringify(report, null, 2)}\n`)
    })
  }
})
