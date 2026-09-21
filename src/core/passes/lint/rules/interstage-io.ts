import type { LintRule } from '../engine.js'
import type { FuncDecl, StructDecl, StructField } from '../../../ir/nodes.js'
import { typeKey, type ShaderType } from '../../../ir/types.js'

/** One `@location(n)` slot as a stage declares it. */
interface Varying {
  readonly location: number
  readonly type: ShaderType
  readonly interpolate?: string
  readonly where: string
}

/** One slot that does not line up, with the fragment entry it was read into so a front end
 *  can point the diagnostic at that declaration. */
export interface InterstageMismatch {
  readonly fragment: string
  readonly message: string
}

/** The varyings a struct declares, or the single one a bare `@location` parameter is. */
function varyings(
  structs: readonly StructDecl[],
  type: ShaderType,
  own: { location?: number; interpolate?: string },
  where: string,
): Varying[] {
  if (own.location !== undefined) {
    return [{ location: own.location, type, interpolate: own.interpolate, where }]
  }
  if (type.kind !== 'struct') return []
  const s = structs.find((x) => x.name === type.name)
  if (!s) return []
  const out: Varying[] = []
  for (const f of s.fields as readonly StructField[]) {
    if (f.location === undefined) continue
    out.push({
      location: f.location,
      type: f.type,
      interpolate: f.interpolate,
      where: `${s.name}.${f.name}`,
    })
  }
  return out
}

const shown = (i: string | undefined): string =>
  i === undefined ? 'no @interpolate' : `@interpolate(${i})`

/** Every interstage slot that does not line up between the module's one vertex entry and its
 *  one fragment entry.
 *
 *  WGSL's rule (wgsl.txt:14935-14938): for every `@location(n)` a fragment entry takes, the
 *  vertex entry must produce one at `n` with the SAME type and the same interpolation. Two
 *  structs — one per stage, which is what an author writes when the fragment reads a subset —
 *  let the two drift: a `vec2` output read as a `vec3` input emitted clean WGSL and clean
 *  GLSL, and the failure arrived at pipeline creation in a message naming neither struct nor
 *  field. A vertex output the fragment does not read is fine; WGSL only constrains the
 *  slots the fragment names.
 *
 *  Answered only when the module has EXACTLY one vertex entry and one fragment entry. With
 *  several of either, which pipeline pairs with which is the host's choice and is not readable
 *  from the module; one of each is the shape the GLSL writer emits and the shape this can
 *  speak about without guessing.
 *
 *  Pure, and exported, because two callers ask the same question: the CORE lint rule below,
 *  which covers every authoring surface at every emit, and the `"use typeshade"` front end,
 *  which can additionally point at the line. */
export function interstageMismatches(
  structs: readonly StructDecl[],
  funcs: readonly FuncDecl[],
): InterstageMismatch[] {
  const vs = funcs.filter((f) => f.stage === 'vertex')
  const fs = funcs.filter((f) => f.stage === 'fragment')
  if (vs.length !== 1 || fs.length !== 1) return []
  const vertex = vs[0]!
  const fragment = fs[0]!
  // A vertex entry's bare (non-struct) return is `@builtin(position)`, never a varying, so
  // only its struct return can carry one.
  const outAt = new Map<number, Varying>()
  for (const v of varyings(structs, vertex.ret, {}, `${vertex.name}'s return`)) {
    outAt.set(v.location, v)
  }
  const found: InterstageMismatch[] = []
  const say = (message: string): void => void found.push({ fragment: fragment.name, message })
  for (const p of fragment.params) {
    for (const want of varyings(structs, p.type, p, `${fragment.name}'s parameter "${p.name}"`)) {
      const have = outAt.get(want.location)
      const slot = `@location(${String(want.location)})`
      if (have === undefined) {
        say(`${want.where} reads ${slot}, which "${vertex.name}" does not produce.`)
        continue
      }
      if (typeKey(have.type) !== typeKey(want.type)) {
        say(
          `${slot} leaves "${vertex.name}" as ${typeKey(have.type)} (${have.where}) and ` +
            `enters "${fragment.name}" as ${typeKey(want.type)} (${want.where}); ` +
            `an interstage slot is one type on both sides.`,
        )
        continue
      }
      if ((have.interpolate ?? '') !== (want.interpolate ?? '')) {
        say(
          `${slot} leaves "${vertex.name}" with ${shown(have.interpolate)} (${have.where}) and ` +
            `enters "${fragment.name}" with ${shown(want.interpolate)} (${want.where}); ` +
            `an interstage slot is interpolated one way on both sides.`,
        )
      }
    }
  }
  return found
}

/** A vertex output and the fragment input that reads it must agree, slot for slot (§53).
 *
 *  CORE, and on the IR, for the reason `builtin-value-type` is: both writers emit the two
 *  declarations from the same fields, so the rule belongs where they read them and not in one
 *  front end. GLSL ES 3.00 links a varying by NAME as well as by slot, so a mismatch there is
 *  a link error the compile gate would catch — but only for a renderable module, and only
 *  after the text is written. The front end runs {@link interstageMismatches} too, because it
 *  can point at the authoring line and this cannot. */
export const interstageIo: LintRule = {
  id: 'interstage-io',
  description: 'a fragment input must match the vertex output at its @location',
  severity: 'error',
  category: 'correctness',
  create: (ctx) => ({
    Module(m) {
      for (const f of interstageMismatches(m.structs, m.funcs)) {
        ctx.report(`interstage IO: ${f.message}`, { code: 'SD0021' })
      }
    },
  }),
}
