// ═══ The `"use typeshade"` examples — drift gate + emit goldens ═══
//
// `hello.shade.ts` and its four siblings shipped in this directory with nothing watching
// them: no suite emitted them, the compile gate iterated `examples` and never saw them, and
// a compiler change that stopped one from being a program would have landed green. This is
// the suite that closes that, and it has three jobs:
//
//   1. DRIFT — the `*.shade.ts` files on disk and the `shadeExamples` registrations agree,
//      in both directions. That is the check with no other symptom: add a sixth file, forget
//      to register it, and it is simply absent — exactly how these five came to be dangling.
//      It is `registry-drift.test.ts`'s argument, applied to the corpus that scan cannot see
//      (`discoverExamples` looks for `export const … : ShaderExample =`, and a `.shade.ts`
//      file is shader source, not a TypeScript module that could contain one).
//   2. GOLDENS — every example's WGSL, and both GLSL ES 3.00 stages for the renderable ones,
//      pinned byte-for-byte in `__emit-goldens__/` through the shared `_goldens.ts` protocol.
//      Same bake command as the EDSL corpus: `bun run bake:goldens` from the repo root.
//   3. THE `renderable` FLAG IS A CLAIM, SO IT IS CHECKED — `renderable: true` must emit
//      both stages, and `renderable: false` must be a REFUSAL the emitter actually makes,
//      not a way to opt out of the compile gate. A flag nobody checks is how a shader
//      quietly stops having a GLSL form while the registry still says it has one.
//
// What this suite cannot say is whether the pinned bytes are a PROGRAM — byte-stability is
// not validity. `scripts/compile-gate.ts` answers that, and it now iterates this corpus too:
// every WGSL here goes to Tint and every renderable GLSL pair to a real WebGL2 context.

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shadeExamples, SHADE_EXT, SHADE_REFUSALS, SHADE_TWINS, NO_ENTRY_POINT } from './_shade.js'
import { examples } from './index.js'
import { checkGolden } from './_goldens.js'
import { emitModule, emitGlslModule, reflect } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Every `.shade.ts` file actually sitting in this directory, id-sorted. The id is the
 *  basename without the extension — the one convention `_shade.ts` relies on to find a
 *  file from its registration. */
const onDisk = readdirSync(HERE)
  .filter((f) => f.endsWith(SHADE_EXT))
  .map((f) => f.slice(0, -SHADE_EXT.length))
  .sort()

describe('"use typeshade" examples — the directory and the registry agree', () => {
  it('the scan found the corpus (it is not vacuously empty)', () => {
    // Both arms below compare sets, and two empty sets are equal. This is the
    // reader-is-broken floor that stops a filename-convention change from greening the file.
    expect(onDisk.length).toBeGreaterThanOrEqual(5)
    expect(shadeExamples.length).toBeGreaterThanOrEqual(5)
  })

  it('every .shade.ts file is registered, and every registration has a file', () => {
    // Both directions in one assertion, so a diff shows the unregistered file and the stale
    // registration together rather than one failing run each.
    expect([...shadeExamples].map((e) => e.id).sort()).toEqual(onDisk)
  })

  it('each registration names its own file', () => {
    for (const ex of shadeExamples) expect(ex.file, ex.id).toBe(`${ex.id}${SHADE_EXT}`)
  })

  it('no id collides with the EDSL registry', () => {
    // Not hygiene: the two corpora bake into ONE `__emit-goldens__/` directory, keyed by id.
    // A shared id means two suites writing one golden file, and whichever ran last wins.
    const edsl = new Set(examples.map((e) => e.id))
    expect(shadeExamples.filter((e) => edsl.has(e.id)).map((e) => e.id)).toEqual([])
  })

  it('every example carries the source category and reflects a pipeline', () => {
    for (const ex of shadeExamples) {
      expect(ex.category, ex.id).toBe('source')
      expect(reflect(ex.module), ex.id).toBeTruthy()
    }
  })
})

describe('"use typeshade" examples — the renderable flag is checked, not trusted', () => {
  it('every renderable example emits both GLSL ES 3.00 stages, with a main() in each', () => {
    const renderable = shadeExamples.filter((e) => e.renderable)
    expect(renderable.length).toBeGreaterThan(0)
    for (const ex of renderable) {
      const vs = emitGlslModule(ex.module, 'vertex')
      const fs = emitGlslModule(ex.module, 'fragment')
      for (const src of [vs, fs]) {
        expect(src.startsWith('#version 300 es'), ex.id).toBe(true)
        // A stage with no entry point emits its declarations and nothing else — which
        // compiles and then fails to LINK. Catch it here rather than in the browser gate.
        expect(src, ex.id).toContain('void main()')
        // scalar casts must be GLSL-spelled (float/int/uint), never the WGSL f32()/i32()/u32()
        expect(src, ex.id).not.toMatch(/\b(f32|i32|u32)\(/)
        // `in` is a GLSL reserved word — never emitted as a bare identifier
        expect(src, ex.id).not.toMatch(/\b(VsOut|vec[234]|float) in\b/)
      }
      // gl_VertexID is `int`; a u32 vertex_index param must be cast for overload resolution.
      // Only the examples that ask for the builtin have one to cast — `hello-vsin` reads its
      // position from a vertex buffer instead.
      if (emitModule(ex.module).includes('vertex_index')) {
        expect(vs, ex.id).toContain('uint(gl_VertexID)')
      }
    }
  })

  it('every non-renderable example is one the GLSL backend genuinely cannot serve', () => {
    const opaque = shadeExamples.filter((e) => !e.renderable)
    expect(opaque.length).toBeGreaterThan(0)
    for (const ex of opaque) {
      // Two shapes of refusal, and the flag is honest under either: the backend THROWS for a
      // construct it has no GLSL ES 3.00 form for (a loose scalar uniform has no std140
      // block), or it emits a stage with no `main()` because the module declares no entry
      // point. What must never happen is a clean, linkable pair hiding behind the flag —
      // that would be an example opting out of the compile gate for free.
      const refused = (stage: 'vertex' | 'fragment'): boolean => {
        try {
          return !emitGlslModule(ex.module, stage).includes('void main()')
        } catch {
          return true
        }
      }
      expect(refused('vertex') || refused('fragment'), ex.id).toBe(true)
    }
  })
})

describe('"use typeshade" examples — emit goldens', () => {
  it('covers every registered example (corpus growth forces a bake, not a skip)', () => {
    expect(shadeExamples.length).toBeGreaterThanOrEqual(5)
  })

  for (const ex of shadeExamples) {
    it(`${ex.id}: WGSL emit is byte-stable`, () => {
      checkGolden(`${ex.id}.wgsl`, emitModule(ex.module))
    })
  }

  for (const ex of shadeExamples.filter((e) => e.renderable)) {
    it(`${ex.id}: GLSL ES 3.00 emits (vertex + fragment) are byte-stable`, () => {
      checkGolden(`${ex.id}.vertex.glsl`, emitGlslModule(ex.module, 'vertex'))
      checkGolden(`${ex.id}.fragment.glsl`, emitGlslModule(ex.module, 'fragment'))
    })
  }
})

// ═══ P1-40 and P1-41 of #155 ═══
//
// The arms above check coverage in ONE direction — every example has its goldens — and accept
// ANY refusal as evidence for `renderable: false`. Both leave a hole a rename walks through:
// a golden whose example was renamed stays in `__emit-goldens__/` forever, still green,
// because nothing asks the reverse question; and an example that stops being renderable for a
// NEW reason (a capability it did not need before) keeps its flag and its silence.
describe('"use typeshade" examples — the goldens and the refusals are both exact', () => {
  /** Every golden file the two registries imply, by the protocol each suite uses:
   *  `<id>.wgsl` for every example, both GLSL stages for a renderable one, and — for a
   *  `.shade.ts` file that claims a twin — the `.diff` and `.semantic.json` the twin suites
   *  bake beside them. */
  const expectedGoldens = (): string[] => {
    const want = new Set<string>()
    for (const ex of [...examples, ...shadeExamples]) {
      want.add(`${ex.id}.wgsl`)
      if (ex.renderable) {
        want.add(`${ex.id}.vertex.glsl`)
        want.add(`${ex.id}.fragment.glsl`)
      }
    }
    for (const id of SHADE_TWINS.keys()) {
      want.add(`${id}.diff`)
      want.add(`${id}.semantic.json`)
    }
    return [...want].sort()
  }

  it('bakes exactly the goldens the registries imply — no missing file, and no orphan', () => {
    // The orphan half is the new one: a renamed example leaves its old goldens behind, and
    // they are never read again, so every suite stays green while the directory rots.
    const onDiskGoldens = readdirSync(join(HERE, '__emit-goldens__')).sort()
    expect(onDiskGoldens).toEqual(expectedGoldens())
  })

  it('states a refusal reason for every non-renderable example, and no reason for a renderable one', () => {
    const nonRenderable = shadeExamples
      .filter((e) => !e.renderable)
      .map((e) => e.id)
      .sort()
    expect([...SHADE_REFUSALS.keys()].sort()).toEqual(nonRenderable)
    expect(nonRenderable.length).toBeGreaterThan(0)
  })

  it('refuses every non-renderable example FOR THE REASON its registration states', () => {
    // The 'genuinely cannot serve' arm above accepts ANY refusal, so an example that lost
    // its GLSL form for a new
    // reason — a capability it did not need before — keeps a flag that now means something
    // else. Naming the reason in the registry is what turns the flag into a claim.
    const wrong: string[] = []
    for (const ex of shadeExamples.filter((e) => !e.renderable)) {
      const reason = SHADE_REFUSALS.get(ex.id) ?? ''
      const seen = (['vertex', 'fragment'] as const).map((stage) => {
        try {
          return emitGlslModule(ex.module, stage).includes('void main()')
            ? 'emits a main()'
            : NO_ENTRY_POINT
        } catch (e) {
          return e instanceof Error ? e.message : String(e)
        }
      })
      if (!seen.some((s) => s.includes(reason))) {
        wrong.push(`${ex.id}: states ${JSON.stringify(reason)}, got ${JSON.stringify(seen)}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('names a reason that is a refusal, not a shrug', () => {
    // A reason of `''` would match every message above and green the arm for free.
    for (const [id, reason] of SHADE_REFUSALS) {
      expect(reason.length, id).toBeGreaterThan(10)
    }
  })
})
