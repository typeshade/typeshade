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

import { describe, it, expect } from 'vitest'
import { examples } from './index.js'
import { shadeExamples } from './_shade.js'
import { emitModule, emitGlslModule } from '../src/index.js'
import type { ModuleDecl } from '../src/index.js'

const corpus = [...examples, ...shadeExamples].filter((e) => (e.module.bindings ?? []).length > 0)

const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Is `name` spelled anywhere in `src` as a whole identifier? The declaration counts as a
 *  mention, which is harmless: a declared binding satisfies the invariant either way. */
const mentions = (src: string, name: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${rx(name)}([^A-Za-z0-9_]|$)`).test(src)

/** Does `src` DECLARE a binding called `name`, in the spelling that target uses?
 *  WGSL:  `@group(0) @binding(0) var<uniform> u: Uniforms;`
 *  GLSL:  `layout(std140) uniform Uniforms { … } u;`, or `uniform sampler2D atlas;` */
function declares(src: string, name: string, target: 'wgsl' | 'glsl'): boolean {
  const n = rx(name)
  if (target === 'wgsl')
    return new RegExp(`@binding\\(\\d+\\)\\s+var(<[^>]*>)?\\s+${n}\\s*:`).test(src)
  return (
    new RegExp(`\\}\\s*${n}\\s*;`).test(src) ||
    new RegExp(`\\buniform\\b[^;{]*\\b${n}\\s*;`).test(src)
  )
}

const stageOf = (m: ModuleDecl, stage: 'vertex' | 'fragment'): boolean =>
  (m.funcs ?? []).some((f) => f.stage === stage)

/** Every (example, target, source) the sweep actually looked at, so the arms below can prove
 *  they were not vacuous. A GLSL stage the backend REFUSES is not a violation — a refusal is
 *  the honest outcome for a construct with no GLSL ES 3.00 form, and it emits no text. */
const seen: { id: string; target: 'wgsl' | 'glsl'; label: string; src: string; names: string[] }[] =
  []
for (const ex of corpus) {
  const names = (ex.module.bindings ?? []).map((b) => b.name)
  seen.push({ id: ex.id, target: 'wgsl', label: 'wgsl', src: emitModule(ex.module), names })
  for (const stage of ['vertex', 'fragment'] as const) {
    if (!stageOf(ex.module, stage)) continue
    try {
      seen.push({
        id: ex.id,
        target: 'glsl',
        label: `glsl:${stage}`,
        src: emitGlslModule(ex.module, stage),
        names,
      })
    } catch {
      // A refusal declares nothing and uses nothing. `hello-uniform` is the live case: GLSL
      // ES 3.00 has no std140 block for a loose scalar uniform, so both stages throw.
    }
  }
}

describe('every binding a stage mentions is a binding that stage declares', () => {
  it('the sweep is not vacuous', () => {
    // Two floors. The corpus must be non-empty, and the regexes must actually match
    // something — a `declares()` that matched nothing would green every arm below.
    expect(corpus.length).toBeGreaterThanOrEqual(10)
    const declared = seen.filter((s) => s.names.some((n) => declares(s.src, n, s.target)))
    expect(declared.length).toBeGreaterThanOrEqual(10)
  })

  it('covers both corpora, not just the one that had the bug', () => {
    const ids = new Set(seen.map((s) => s.id))
    expect([...examples].some((e) => ids.has(e.id))).toBe(true)
    expect([...shadeExamples].some((e) => ids.has(e.id))).toBe(true)
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
