// ═══ S4 — the compiler's stage sets equal the sets core.def states ═══
//
// WHAT THIS CLOSES. WGSL restricts some builtins to some entry stages: "Must only be used in a
// fragment shader stage" for the implicit-derivative reads (`wgsl.txt:23438, 24435, 24601,
// 24720`), a fragment-or-compute rule for texture writes and atomics, a compute-only rule for
// the barriers. This package states those rules in TWO hand-written places, in two layers —
// `FRAGMENT_ONLY_CALLS` in the front end (`compiler/ts/lower/function.ts`) and
// `FRAGMENT_ONLY_IDS` in the core lint (`passes/lint/rules/fragment-only-builtin.ts`) — so
// every new id has to be REMEMBERED twice. It was not: the spec audit of 2026-09-21 (#144)
// found `textureSampleCubeArray` in neither list, and a vertex entry sampling a cube array
// compiled clean here and was refused by Tint (fixed in #143).
//
// The fix for the class, rather than for the case, is this file: the sets are DERIVED from
// Tint's own `@stage(...)` attributes (`fixtures/coredef-stages.json`, baked by
// `scripts/bake-coredef-textures.ts`) and compared with the compiler's. A new id in the
// catalogue whose WGSL name is staged is therefore claimed here or the suite fails.
//
// WHY BY WGSL NAME. The catalogue's ids are finer than WGSL's names — `textureSample`,
// `textureSampleArray` and `textureSampleCubeArray` all SPELL `textureSample` — and the stage
// rule belongs to the name. So each id is mapped to the name its WGSL spelling emits, and the
// rule is looked up under that.
//
// WHAT THIS FILE DOES NOT DECIDE. Three names (`textureDimensions`, `textureLoad`,
// `textureNumLayers`) are staged for SOME overloads only — the writable-storage ones — and no
// id-level set can express that. They are recorded below and left to
// `coredef-texture-overloads.test.ts`, which claims each overload separately.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '../../compiler/ts/compile.js'
import { INTRINSICS, PORTABLE_INTRINSICS, PRE_EMIT_INTRINSICS } from '../intrinsics.js'
import { FRAGMENT_ONLY_CALLS, NOT_IN_VERTEX_CALLS } from '../../compiler/ts/lower/function.js'
import { FRAGMENT_ONLY_IDS } from '../passes/lint/rules/fragment-only-builtin.js'

interface StageRow {
  readonly fn: string
  /** One entry per DISTINCT `@stage(...)` across the name's overloads; `'any'` for an
   *  overload that carries none. Two entries mean the name's overloads disagree. */
  readonly stageSets: readonly string[]
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'coredef-stages.json'),
    'utf8',
  ),
) as { readonly rows: readonly StageRow[] }

const namesWith = (set: string): string[] =>
  fixture.rows.filter((r) => r.stageSets.length === 1 && r.stageSets[0] === set).map((r) => r.fn)

/** Names every overload of which is `@stage("fragment")`. */
const FRAGMENT_ONLY_NAMES = new Set(namesWith('fragment'))
/** Names every overload of which is `@stage("fragment", "compute")`. */
const NOT_IN_VERTEX_NAMES = new Set(namesWith('fragment,compute'))
/** Names every overload of which is `@stage("compute")`. */
const COMPUTE_ONLY_NAMES = new Set(namesWith('compute'))
/** Names whose overloads DISAGREE — the rule is per-overload, not per-name. */
const MIXED_NAMES = fixture.rows.filter((r) => r.stageSets.length > 1).map((r) => r.fn)

/** The WGSL call name an id emits, or `null` when its spelling is not a plain call (an
 *  inlined operator) or one target has no form for it at all. */
function wgslNameOf(id: string): string | null {
  const spelling = (INTRINSICS as Readonly<Record<string, { wgsl(a: readonly string[]): string }>>)[
    id
  ]
  if (spelling === undefined) return id // portable and pre-emit ids spell as themselves
  let text: string
  try {
    text = spelling.wgsl(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  } catch {
    return null
  }
  return /^([A-Za-z_]\w*)\s*\(/.exec(text)?.[1] ?? null
}

const CATALOGUE = [
  ...Object.keys(INTRINSICS),
  ...PORTABLE_INTRINSICS,
  ...PRE_EMIT_INTRINSICS,
].sort()

const idsSpelling = (names: ReadonlySet<string>): string[] =>
  CATALOGUE.filter((id) => {
    const name = wgslNameOf(id)
    return name !== null && names.has(name)
  })

/** A staged `core.def` name this package has no catalogue id for. Each entry says why, and the
 *  list is shrink-only: the arm below fails a name that HAS gained an id but kept its entry. */
const SUBGROUPS =
  'subgroup operations: docs/roadmap.md:247 "A WebGPU extension with no WebGL2 equivalent and no oracle meaning yet"'

const NOT_IN_CATALOGUE: Readonly<Record<string, string>> = {
  // The 25 subgroup names, listed one by one rather than matched by prefix: a prefix would
  // swallow a future `subgroupSomething` this package DOES spell.
  ...Object.fromEntries(
    [
      'subgroupAdd',
      'subgroupAll',
      'subgroupAnd',
      'subgroupAny',
      'subgroupBallot',
      'subgroupBroadcast',
      'subgroupBroadcastFirst',
      'subgroupElect',
      'subgroupExclusiveAdd',
      'subgroupExclusiveMul',
      'subgroupInclusiveAdd',
      'subgroupInclusiveMul',
      'subgroupMatrixMultiplyAccumulate',
      'subgroupMatrixScalarAdd',
      'subgroupMatrixScalarMultiply',
      'subgroupMatrixScalarSubtract',
      'subgroupMax',
      'subgroupMin',
      'subgroupMul',
      'subgroupOr',
      'subgroupShuffle',
      'subgroupShuffleDown',
      'subgroupShuffleUp',
      'subgroupShuffleXor',
      'subgroupXor',
    ].map((name) => [name, SUBGROUPS]),
  ),
  inputAttachmentLoad:
    'input attachments are a WebGPU extension with no WebGL2 equivalent; nothing in this package spells one',
  quadBroadcast:
    'quad operations: docs/roadmap.md:247 "no WebGL2 equivalent and no oracle meaning yet"',
  quadSwapDiagonal: 'quad operations: docs/roadmap.md:247',
  quadSwapX: 'quad operations: docs/roadmap.md:247',
  quadSwapY: 'quad operations: docs/roadmap.md:247',
  textureBarrier:
    '`textureBarrier()` is WGSL-only and belongs behind a capability (audit G15/T14); issue #152',
  atomicCompareExchangeWeak: 'audit G12: absent, WGSL-only behind a capability; issue #152',
  atomicStoreMax: 'audit G13: `atomic<vec2<u32>>` min/max, proposed After 1.0 in #144 §8',
  atomicStoreMin: 'audit G13: proposed After 1.0 in #144 §8',
}

/** An id this package does NOT refuse from a vertex entry although `core.def` stages its name
 *  `fragment, compute`. Every row is a program the front end accepts and a device rejects at
 *  pipeline creation, so this is a defect list; it is shrink-only (the arm below fails a row
 *  that has started to be refused). */
const VERTEX_GAPS: Readonly<Record<string, string>> = {
  // Audit G34: `lower/atomics.ts` carries no stage check, so an atomic in a `@vertex` entry
  // compiles clean. Not yet filed as its own issue; tracked in #162 with the builtins family.
  atomicAdd: 'audit G34, #162',
  atomicAnd: 'audit G34, #162',
  atomicExchange: 'audit G34, #162',
  atomicLoad: 'audit G34, #162',
  atomicMax: 'audit G34, #162',
  atomicMin: 'audit G34, #162',
  atomicOr: 'audit G34, #162',
  atomicStore: 'audit G34, #162',
  atomicSub: 'audit G34, #162',
  atomicXor: 'audit G34, #162',
}

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

describe('the compiler stage sets equal the sets core.def states (S4)', () => {
  it('reads a fixture that actually carries the three stage rules', () => {
    // A fixture that parsed to nothing would make every arm below vacuously green.
    expect([...FRAGMENT_ONLY_NAMES]).toContain('textureSample')
    expect([...NOT_IN_VERTEX_NAMES]).toContain('textureStore')
    expect([...COMPUTE_ONLY_NAMES]).toContain('workgroupBarrier')
  })

  it('names every staged builtin either by a catalogue id or by an explicit absence', () => {
    const spelled = new Set(CATALOGUE.map(wgslNameOf).filter((n): n is string => n !== null))
    const unaccounted = fixture.rows
      .map((r) => r.fn)
      .filter((fn) => !spelled.has(fn) && !(fn in NOT_IN_CATALOGUE))
    expect(unaccounted).toEqual([])
  })

  it('loses the NOT_IN_CATALOGUE entry of a name that has since gained an id', () => {
    const spelled = new Set(CATALOGUE.map(wgslNameOf).filter((n): n is string => n !== null))
    expect(Object.keys(NOT_IN_CATALOGUE).filter((fn) => spelled.has(fn))).toEqual([])
  })

  it('gates exactly the ids whose WGSL name core.def stages "fragment", in the two layers together', () => {
    // The union, not either set: the front end reports some ids and the core lint the rest,
    // and which layer owns an id is an implementation detail. What must hold is that no id
    // falls between them — which is precisely how `textureSampleCubeArray` was lost.
    const gated = [...new Set([...FRAGMENT_ONLY_CALLS, ...FRAGMENT_ONLY_IDS.keys()])].sort()
    expect(gated).toEqual(idsSpelling(FRAGMENT_ONLY_NAMES))
  })

  it('gates no id whose WGSL name core.def leaves unstaged, so a fix cannot be over-eager', () => {
    // `textureGather` carries no `@stage` row: it takes no implicit derivative and is legal in
    // any stage, which Tint confirms. A "gate everything named texture*" fix would break it.
    const overGated = [...FRAGMENT_ONLY_CALLS, ...FRAGMENT_ONLY_IDS.keys()].filter((id) => {
      const name = wgslNameOf(id)
      return name === null || !FRAGMENT_ONLY_NAMES.has(name)
    })
    expect(overGated).toEqual([])
  })

  it('refuses from a vertex entry every id whose WGSL name core.def stages "fragment, compute"', () => {
    const missing = idsSpelling(NOT_IN_VERTEX_NAMES).filter(
      (id) => !NOT_IN_VERTEX_CALLS.has(id) && !(id in VERTEX_GAPS),
    )
    expect(missing).toEqual([])
  })

  it('loses the VERTEX_GAPS entry of an id the compiler has since learned to refuse', () => {
    expect(Object.keys(VERTEX_GAPS).filter((id) => NOT_IN_VERTEX_CALLS.has(id))).toEqual([])
  })

  it('refuses a compute-only builtin from a vertex and from a fragment entry', () => {
    // The barriers are gated at the call site (`lower/barriers.ts`) rather than through a set,
    // so this arm measures the behaviour instead of reading a constant.
    const ids = idsSpelling(COMPUTE_ONLY_NAMES)
    expect(ids).toEqual(['storageBarrier', 'workgroupBarrier'])
    for (const id of ids) {
      const fragment = `"use typeshade"
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  ${id}()
  return vec4(0., 0., 0., 1.)
}
`
      const vertex = `"use typeshade"
class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  ${id}()
  return { pos: vec4(0., 0., 0., 1.) }
}
`
      const compute = `"use typeshade"
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  ${id}()
}
`
      expect(errorsOf(fragment), `${id} in a fragment entry`).toEqual([
        `${id}() belongs in a compute entry or a function it calls; a fragment entry has no workgroup to wait for.`,
      ])
      expect(errorsOf(vertex), `${id} in a vertex entry`).toEqual([
        `${id}() belongs in a compute entry or a function it calls; a vertex entry has no workgroup to wait for.`,
      ])
      expect(errorsOf(compute), `${id} in a compute entry`).toEqual([])
    }
  })

  it('records the names whose overloads DISAGREE about the stage, which no id-level set can express', () => {
    // `textureLoad` on a sampled texture is legal in a vertex entry and on a WRITABLE storage
    // texture is not. The rule is per-overload, and `coredef-texture-overloads.test.ts` claims
    // each overload with its own witness. This arm exists so the class stays visible here.
    expect(MIXED_NAMES).toEqual(['textureDimensions', 'textureLoad', 'textureNumLayers'])
  })
})
