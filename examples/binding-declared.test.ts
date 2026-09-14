// ═══ A stage that USES a binding also DECLARES it (#14) ═══
//
// #14 was silent output: a source-compiled module encoded a binding read as `Expr.constref`,
// the binding-reachability walk counts `Expr.varref`, so no stage reached any binding — and
// the GLSL writer, which asks that walk what to declare, emitted the uses without the
// declaration:
//
//   in vec2 uv;
//   layout(location = 0) out vec4 _ret;
//   void main() {
//     float t = (uv.y + u.mix_bias);   // WebGL2: "'u' : undeclared identifier"
//
// Byte-stable goldens did not catch it (they pin whatever is emitted, right or wrong), and
// the compile gate did not either, because the only `.shade.ts` examples with a binding were
// `renderable: false` and so never reached WebGL2. This is the gate that does not depend on
// someone adding the right example: it sweeps BOTH corpora and states the invariant directly.
//
// BOTH SIDES ARE READ OFF THE EMITTED TEXT, never off `reflect()`. The walk that decides
// which bindings a stage declares is the thing under test; a gate that asked it what was
// declared would agree with the bug and pass. Asking the bytes cannot.
//
// The floors below are not ceremony. The first cut of this file used a local
// `f.stage === stage` predicate, and the EDSL corpus carries its stage in `attrs` rather
// than in `stage` — so every EDSL example was skipped and the sweep ran ZERO GLSL arms while
// every arm reported green. Each half of the invariant now has to prove it examined
// something, and the GLSL arms are counted separately from the WGSL ones, because a floor
// that adds them together is exactly the floor that missed it.

import { describe, it, expect } from 'vitest'
import { examples } from './index.js'
import { shadeExamples } from './_shade.js'
import { emitModule, emitGlslModule, stageOf } from '../src/index.js'

const corpus = [...examples, ...shadeExamples].filter((e) => (e.module.bindings ?? []).length > 0)

const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Is `name` spelled anywhere in `src` as a whole identifier? The declaration counts as a
 *  mention, which is harmless: a declared binding satisfies the invariant either way. */
const mentions = (src: string, name: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${rx(name)}([^A-Za-z0-9_]|$)`).test(src)

/** Does `src` DECLARE a binding called `name`, in the spelling that target uses?
 *  WGSL:  `@group(0) @binding(0) var<uniform> u: Uniforms;`
 *  GLSL:  `layout(std140) uniform Uniforms { … } u;`, or `uniform sampler2D atlas;`
 *
 *  The block form is anchored to the `uniform`/`buffer` keyword rather than to any closing
 *  brace: `} name;` alone would also match a plain struct declaration that happens to end in
 *  the binding's name, and a gate that accepts the wrong shape can pass while the
 *  declaration is missing. */
function declares(src: string, name: string, target: 'wgsl' | 'glsl'): boolean {
  const n = rx(name)
  if (target === 'wgsl')
    return new RegExp(`@binding\\(\\d+\\)\\s+var(<[^>]*>)?\\s+${n}\\s*:`).test(src)
  return (
    new RegExp(`\\b(uniform|buffer)\\b[^;]*\\{[^}]*\\}\\s*${n}\\s*;`).test(src) ||
    new RegExp(`\\b(uniform|buffer)\\b[^;{]*\\b${n}\\s*;`).test(src)
  )
}

interface Emitted {
  readonly id: string
  readonly target: 'wgsl' | 'glsl'
  readonly label: string
  readonly src: string
  readonly names: readonly string[]
}
/** A stage the GLSL backend REFUSED. A refusal declares nothing and uses nothing, so it is
 *  not a violation — but it must not be swallowed either: a bare `catch` is how an arm can
 *  vanish without anyone noticing it stopped running. */
interface Refusal {
  readonly id: string
  readonly stage: string
  readonly message: string
}

const seen: Emitted[] = []
const refused: Refusal[] = []
for (const ex of corpus) {
  const names = (ex.module.bindings ?? []).map((b) => b.name)
  seen.push({ id: ex.id, target: 'wgsl', label: 'wgsl', src: emitModule(ex.module), names })
  for (const stage of ['vertex', 'fragment'] as const) {
    // The CANONICAL helper: the EDSL corpus carries its stage in `attrs`, the source compiler
    // in `stage`, and `stageOf` is the one place that knows both.
    if (!(ex.module.funcs ?? []).some((f) => stageOf(f) === stage)) continue
    try {
      seen.push({
        id: ex.id,
        target: 'glsl',
        label: `glsl:${stage}`,
        src: emitGlslModule(ex.module, stage),
        names,
      })
    } catch (e) {
      refused.push({ id: ex.id, stage, message: e instanceof Error ? e.message : String(e) })
    }
  }
}

/** Every GLSL stage the backend refuses today, and why. Pinned so a NEW refusal (a stage
 *  that silently stopped emitting) and a VANISHED one (a refusal that became a silent bad
 *  emit) both fail here rather than shrinking the sweep unnoticed. */
const EXPECTED_REFUSALS: readonly { id: string; stage: string; match: RegExp }[] = [
  // One entry, not two: `hello-uniform` declares only a fragment stage, so the vertex stage
  // is never swept. Calling `emitGlslModule(m, 'vertex')` on it directly does throw the same
  // way — but a stage the module does not have is not a stage this gate examines.
  { id: 'hello-uniform', stage: 'fragment', match: /must be a struct \(a std140 UBO block\)/ },
]

describe('every binding a stage mentions is a binding that stage declares', () => {
  it('the sweep examined both halves of the invariant, on both targets', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(10)
    // Counted per target. Adding them together is the floor that let a zero-GLSL sweep pass.
    const glsl = seen.filter((s) => s.target === 'glsl')
    const wgsl = seen.filter((s) => s.target === 'wgsl')
    expect(wgsl.length, 'WGSL arms').toBeGreaterThanOrEqual(10)
    expect(glsl.length, 'GLSL arms').toBeGreaterThanOrEqual(50)
    // Both halves of "mentioned ⇒ declared" must have something to say. A dead `declares()`
    // greens every arm; so does a dead `mentions()`.
    expect(
      seen.filter((s) => s.names.some((n) => declares(s.src, n, s.target))).length,
      'sources that declare a binding',
    ).toBeGreaterThanOrEqual(10)
    expect(
      seen.filter((s) => s.names.some((n) => mentions(s.src, n))).length,
      'sources that mention a binding',
    ).toBeGreaterThanOrEqual(10)
  })

  it('covers both corpora, on both targets', () => {
    const ids = (t: 'wgsl' | 'glsl'): Set<string> =>
      new Set(seen.filter((s) => s.target === t).map((s) => s.id))
    for (const t of ['wgsl', 'glsl'] as const) {
      expect(
        [...examples].some((e) => ids(t).has(e.id)),
        `EDSL on ${t}`,
      ).toBe(true)
      expect(
        [...shadeExamples].some((e) => ids(t).has(e.id)),
        `shade on ${t}`,
      ).toBe(true)
    }
  })

  it('the GLSL refusals are the expected ones, and only those', () => {
    expect(refused.map((r) => `${r.id}:${r.stage}`).sort()).toEqual(
      EXPECTED_REFUSALS.map((r) => `${r.id}:${r.stage}`).sort(),
    )
    for (const e of EXPECTED_REFUSALS) {
      const got = refused.find((r) => r.id === e.id && r.stage === e.stage)
      expect(got?.message, `${e.id}:${e.stage}`).toMatch(e.match)
    }
  })

  for (const s of seen) {
    it(`${s.id} (${s.label})`, () => {
      const used = s.names.filter((n) => mentions(s.src, n))
      const undeclared = used.filter((n) => !declares(s.src, n, s.target))
      expect(
        undeclared,
        `${s.id} ${s.label}: mentions ${undeclared.join(', ')} without declaring it`,
      ).toEqual([])
    })
  }
})
