// ═══ Shader DSL — variant families: the axes a HOST decides at runtime (#1712) ═══
//
// AUTHORING.md §11 is right that a preprocessor is unnecessary when WE decide the variant:
// a builder parameter plus a plain `if` is strictly better, because the losing arm is
// never built and its bindings never declared. The case §11 does not cover is when the
// HOST decides — MapLibre sets TERRAIN3D and a family of OVERLAY_DRAPE_* per draw from map
// state, and our shaders must agree with defines we do not own.
//
// The answer is not to hand-write `#ifdef` ladders around emitted functions. That output
// cannot exist on WGSL at all (no preprocessor), it is untyped text where a missing
// `#endif` or a misspelled define is invisible to `validate()` and `reflect()`, and it
// leaves reflection describing ONE emitted string while the host can select N programs.
//
// So the matrix itself becomes the authored thing:
//
//   family.variants            per-variant module + reflection + a stable key
//   family.emit(target)        one preprocessor-free source per key — the WGSL path,
//                              and the one a pipeline cache should prefer everywhere
//   family.emitGuarded(...)    GLSL-only, opt-in: ONE source with a GENERATED #if ladder,
//                              for a host that owns the define
//   family.emitGuardedFragment(...)
//                              the same ladder as a header-less FRAGMENT (#1711), since the
//                              reported shape puts the ladder inside an #include — and an
//                              include cannot carry a second #version
//
// `emitGuarded` is a lowering of a typed matrix, not hand-written text — which is what
// makes it checkable. Every arm is byte-identical to the corresponding standalone variant
// (`selectGuardedArm` recovers it, and the tests assert that for every variant), so the
// preprocessor buys the host its define without the WGSL path paying anything.
//
// The `key` is the part that outlives the rest. AUTHORING.md §11's identity rule — every
// axis you specialise on must appear in every key that names the program — is prose today,
// and `map/src/shaders/baked/ids.ts:64-70` records the near-miss it already cost. A key
// DERIVED from the axes cannot omit one.

import type { ModuleDecl } from './ir/index.js'
import { reflect, type Reflection } from './reflect.js'
import { emitGlslFragment, type GlslEmitOptions } from './backends/glsl.js'
import { emitModule } from './backends/wgsl.js'
import type { EmitOptions } from './emit.js'
import type { EmitFragment, FragmentDeclares } from './fragment.js'

/** One point in the axis space: each axis name mapped to one of its declared values. */
export type AxisValues<A extends Record<string, readonly unknown[]>> = {
  readonly [K in keyof A]: A[K][number]
}

/** What `variantFamily` is given. */
export interface VariantFamilySpec<A extends Record<string, readonly unknown[]>> {
  /** The axes, each as the list of values the host can select. */
  readonly axes: A
  /** Build the module for one point in the space. Ordinary TypeScript branching: read the
   *  axis values and construct only what this point needs, so the losing arm is never built. */
  readonly build: (axes: AxisValues<A>) => ModuleDecl
  /** The program's identity. Must mention every axis `build` reads: two points that derive
   *  the same key would share one cache id while naming different programs, and
   *  {@link variantFamily} throws when that happens. Derive it from `axes`; a key written by
   *  hand is how an axis gets left out. */
  readonly key: (axes: AxisValues<A>) => string
}

/** One built variant. */
export interface Variant<A extends Record<string, readonly unknown[]>> {
  readonly key: string
  readonly axes: AxisValues<A>
  readonly module: ModuleDecl
  /** This variant's own {@link reflect} result, so each program the host can select is
   *  described separately. */
  readonly reflection: Reflection
}

/** How to spell each axis value as a preprocessor define for `emitGuarded`. A boolean axis
 *  takes a single name, defined when true; any other axis takes one name per value. */
export type GuardDefines<A extends Record<string, readonly unknown[]>> = {
  readonly [K in keyof A]: string | Readonly<Record<string, string>>
}

/** A built family. */
export interface VariantFamily<A extends Record<string, readonly unknown[]>> {
  readonly variants: readonly Variant<A>[]
  /** Every key, in `variants` order: the id set a pipeline cache keys its programs by. */
  readonly keys: readonly string[]
  /** Look one variant up by key; `undefined` when the key names no variant. */
  get(key: string): Variant<A> | undefined
  /** One preprocessor-free source per key. The only shape WGSL can take, and the one a
   *  pipeline cache should prefer on GLSL too. */
  emit(target: 'wgsl', opts?: EmitOptions): ReadonlyMap<string, string>
  emit(
    target: 'glsl-es300',
    opts?: GlslEmitOptions & { stage?: 'vertex' | 'fragment' },
  ): ReadonlyMap<string, string>
  /** One GLSL source whose arms are selected by preprocessor defines the host owns.
   *
   *  Opt in to this when the host already sets the define per draw and cannot pick a source
   *  per variant; otherwise prefer {@link VariantFamily.emit}. GLSL only, because the arms
   *  are selected by the GLSL preprocessor. Every arm is byte-identical to the corresponding
   *  `emit()` source, so a program selected through the ladder is the same program as the
   *  standalone variant.
   *
   *  @throws `Error` when the variants disagree about their preamble: `#version` must lead
   *    the file, so a single guarded source can carry only one preamble, and picking one
   *    variant's would emit a program whose precision or extensions are wrong for the other
   *    arms. Emit such variants separately. */
  emitGuarded(
    defines: GuardDefines<A>,
    opts?: GlslEmitOptions & { stage?: 'vertex' | 'fragment' },
  ): string
  /** The same generated ladder as {@link VariantFamily.emitGuarded}, returned as a
   *  header-less fragment for a host that owns the program and composes these declarations
   *  into it.
   *
   *  `emitGuarded` returns a whole stage, preamble included. A ladder pasted into a host
   *  program through an `#include` cannot carry a second `#version`, so here the preamble
   *  comes back as data, exactly as {@link emitGlslFragment} returns it, and
   *  `[...preamble, '', source].join('\n')` reproduces `emitGuarded`'s output byte for byte.
   *
   *  `declares` and `requires` are the union across the arms, since the host's preprocessor
   *  picks the arm and the composer cannot know which: every name any arm declares is one
   *  the host's prelude must not collide with, and every symbol any arm needs is one the host
   *  must provide. Throws for a preamble mismatch exactly as `emitGuarded` does. */
  emitGuardedFragment(
    defines: GuardDefines<A>,
    opts?: GlslEmitOptions & { stage?: 'vertex' | 'fragment' },
  ): EmitFragment
}

/** The cartesian product of the axes, in declaration order — the FIRST axis varies
 *  slowest, so the enumeration reads like nested loops written in the same order. */
function product<A extends Record<string, readonly unknown[]>>(axes: A): AxisValues<A>[] {
  let rows: Record<string, unknown>[] = [{}]
  for (const name of Object.keys(axes)) {
    const values = axes[name] as readonly unknown[]
    if (values.length === 0)
      throw new Error(`shader-dsl: variantFamily axis '${name}' declares no values`)
    rows = rows.flatMap((r) => values.map((v) => ({ ...r, [name]: v })))
  }
  return rows as AxisValues<A>[]
}

/** The `#if` condition selecting one variant: every axis's define, conjoined. */
function guardCondition<A extends Record<string, readonly unknown[]>>(
  axes: AxisValues<A>,
  defines: GuardDefines<A>,
): string {
  const terms: string[] = []
  for (const name of Object.keys(axes)) {
    const spec = defines[name as keyof A]
    const value = (axes as Record<string, unknown>)[name]
    if (typeof spec === 'string') {
      if (typeof value !== 'boolean')
        throw new Error(
          `shader-dsl: variantFamily axis '${name}' has non-boolean value ${JSON.stringify(value)}` +
            ` but a single define name — give it one define per value`,
        )
      terms.push(value ? `defined(${spec})` : `!defined(${spec})`)
    } else {
      const named = spec[String(value)]
      if (named === undefined)
        throw new Error(
          `shader-dsl: variantFamily axis '${name}' value ${JSON.stringify(value)} has no define`,
        )
      terms.push(`defined(${named})`)
    }
  }
  return terms.join(' && ')
}

/** Recover the arm a set of defined macros selects from an `emitGuarded` source.
 *
 *  Understands only the ladder shape `emitGuarded` generates: `#if`, `#elif` and `#endif` at
 *  column 0, with conditions built from `defined(X)` and `!defined(X)` joined by `&&`. Use it
 *  to assert, in a test or a build step, that the arm the host's defines select equals the
 *  standalone variant from {@link VariantFamily.emit}, without running a compiler.
 *
 *  @param source - output of {@link VariantFamily.emitGuarded}.
 *  @param defined - the macro names the host would have defined.
 *  @returns the selected arm's text, or `undefined` when no arm matches.
 *  @throws `Error` when a condition in `source` is not of the form the ladder generates.
 */
export function selectGuardedArm(source: string, defined: Iterable<string>): string | undefined {
  const on = new Set(defined)
  const holds = (cond: string): boolean =>
    cond.split('&&').every((raw) => {
      const t = raw.trim()
      const neg = t.startsWith('!')
      const m = /^!?defined\(([^)]+)\)$/.exec(t)
      if (!m) throw new Error(`shader-dsl: selectGuardedArm cannot read condition '${t}'`)
      return neg ? !on.has(m[1]!) : on.has(m[1]!)
    })

  const lines = source.split('\n')
  let active: string[] | undefined
  let collecting = false
  for (const line of lines) {
    if (line.startsWith('#if ') || line.startsWith('#elif ')) {
      collecting = active === undefined && holds(line.slice(line.indexOf(' ') + 1))
      if (collecting) active = []
      continue
    }
    if (line.startsWith('#endif')) {
      collecting = false
      continue
    }
    if (collecting) active!.push(line)
  }
  return active?.join('\n')
}

/** Build a family of shader variants from a typed axis matrix. Give it the axes a host can
 *  select, a builder for one point in the space, and a key derivation, and it builds every
 *  point once.
 *
 *  Each axis is a name mapped to the list of values the host chooses among, so the family is
 *  the product of the axes and every point is type-checked: the builder receives one value per
 *  axis, and a typo in an axis name is a tsc error. The builder is ordinary TypeScript, so the
 *  variation is a plain `if` and the losing arm is never built, which means its bindings are
 *  never declared and never reach {@link reflect}.
 *
 *  `variants` holds one entry per point: the axis values, the built {@link ModuleDecl}, its
 *  {@link reflect} result, and the derived key. `keys` lists those keys and `get(key)` looks a
 *  variant up. The key is the part that outlives everything else, because a specialized
 *  program is a different program and every axis has to appear in every key that names it: a
 *  pipeline cache keyed without an axis serves one variant's program to another variant's
 *  draw, which compiles, links, renders and is wrong. Deriving the key from the axis values is
 *  what makes omitting one impossible, and two points deriving the same key throws here.
 *
 *  `emit(target)` returns one preprocessor-free source per key. That is the WGSL path, and it
 *  is what a pipeline cache should prefer on either target.
 *
 *  `emitGuarded(defines, opts)` is the GLSL-only alternative, for a host that owns the define
 *  and decides at draw time. It generates one source with an `#if` ladder over the arms, one
 *  arm per variant, from the same typed matrix, so the ladder can be checked against that
 *  matrix. Every arm is byte-identical to the standalone variant of the same key,
 *  which is what keeps the guarded and unguarded paths from being two programs.
 *
 *  `emitGuardedFragment(defines, opts)` returns the same ladder as a header-less fragment: the
 *  `source`, and the `preamble`, the declares and the requires as data. It exists because the
 *  ladder usually goes inside an include, and an include cannot carry a second `#version`.
 *  Joining the preamble to the source reproduces `emitGuarded` byte for byte.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param spec - the axes, the per-point builder, and the key derivation.
 *  @returns the built family: every variant with its module, reflection and key, plus the
 *    three emit shapes.
 *  @throws `Error` when an axis declares no values, or when two points derive the same key,
 *    which means the key does not name every axis the builder read.
 *
 *  @example
 *  ```ts
 *  import { variantFamily } from '@xgis/shader-dsl'
 *
 *  const family = variantFamily({
 *    axes: { shadows: [false, true], blend: ['add', 'mix'] },
 *    build: ({ shadows, blend }) => buildModule(shadows, blend),
 *    key: ({ shadows, blend }) => `${shadows ? 's' : 'n'}:${blend}`,
 *  })
 *
 *  family.emit('wgsl') // four sources, keyed
 *  family.emitGuarded({ shadows: 'SHADOWS', blend: { add: 'BLEND_ADD', mix: 'BLEND_MIX' } })
 *  ```
 *
 *  @see {@link composeModule} for a variant that differs by one statement list.
 *  @see {@link overrideConst} when the variants differ only in a value.
 */
export function variantFamily<A extends Record<string, readonly unknown[]>>(
  spec: VariantFamilySpec<A>,
): VariantFamily<A> {
  const variants: Variant<A>[] = product(spec.axes).map((axes) => {
    const m = spec.build(axes)
    return { key: spec.key(axes), axes, module: m, reflection: reflect(m) }
  })

  const byKey = new Map<string, Variant<A>>()
  for (const v of variants) {
    if (byKey.has(v.key))
      throw new Error(
        `shader-dsl: variantFamily key collision '${v.key}' — the key must mention every` +
          ` axis the builder reads, or two different programs share one cache id`,
      )
    byKey.set(v.key, v)
  }

  const emit = (
    target: 'wgsl' | 'glsl-es300',
    opts?: (EmitOptions | GlslEmitOptions) & { stage?: 'vertex' | 'fragment' },
  ): ReadonlyMap<string, string> =>
    new Map(
      variants.map((v) => [
        v.key,
        target === 'wgsl'
          ? emitModule(v.module, opts)
          : emitGuardedArmSource(v, opts as GlslEmitOptions & { stage?: 'vertex' | 'fragment' }),
      ]),
    )

  return {
    variants,
    keys: variants.map((v) => v.key),
    get: (k) => byKey.get(k),
    emit: emit as VariantFamily<A>['emit'],
    emitGuarded(defines, opts) {
      const { preamble, ladder } = buildGuarded(variants, defines, opts)
      return [...preamble, '', ...ladder, '#endif', ''].join('\n')
    },
    emitGuardedFragment(defines, opts) {
      const { preamble, ladder, declares, requires } = buildGuarded(variants, defines, opts)
      // Same pieces, joined one level up by the composer instead of here — which is what
      // makes `[...preamble, '', source]` reproduce emitGuarded byte for byte.
      return { source: [...ladder, '#endif', ''].join('\n'), preamble, declares, requires }
    },
  }
}

/** De-duplicate, preserving first-seen order — deterministic without imposing an order the
 *  per-arm manifests do not have (theirs is emit order, not alphabetical). */
const union = (lists: readonly (readonly string[])[]): readonly string[] => [
  ...new Set(lists.flat()),
]

/** The pieces both guarded emits are made of: the ONE preamble every arm must agree on, the
 *  `#if`/`#elif` arms, and the manifests unioned across them.
 *
 *  Shared so the two entry points cannot drift — the string form and the fragment form
 *  differ only in who joins the preamble to the ladder. */
function buildGuarded<A extends Record<string, readonly unknown[]>>(
  variants: readonly Variant<A>[],
  defines: GuardDefines<A>,
  opts?: GlslEmitOptions & { stage?: 'vertex' | 'fragment' },
): {
  preamble: readonly string[]
  ladder: readonly string[]
  declares: FragmentDeclares
  requires: readonly string[]
} {
  const frags = variants.map((v) => ({
    v,
    f: emitGlslFragment(v.module, opts?.stage, { ...opts, entryPoints: true }),
  }))
  const preamble = frags[0]!.f.preamble
  for (const { v, f } of frags)
    if (f.preamble.join('\n') !== preamble.join('\n'))
      throw new Error(
        `shader-dsl: variantFamily.emitGuarded — variant '${v.key}' needs a different` +
          ` preamble than '${frags[0]!.v.key}':\n  ${f.preamble.join(' | ')}\n  vs\n  ` +
          `${preamble.join(' | ')}\nOne guarded source can carry only one #version` +
          ` block, so these variants cannot share it — emit them separately.`,
      )
  const ladder = frags.map(({ v, f }, i) => {
    const head = `#${i === 0 ? 'if' : 'elif'} ${guardCondition(v.axes, defines)}`
    return `${head}\n${f.source.replace(/\n$/, '')}`
  })
  const d = frags.map(({ f }) => f.declares)
  return {
    preamble,
    ladder,
    declares: {
      functions: union(d.map((x) => x.functions)),
      structs: union(d.map((x) => x.structs)),
      bindings: union(d.map((x) => x.bindings)),
      consts: union(d.map((x) => x.consts)),
      overrides: union(d.map((x) => x.overrides)),
      entryPoints: union(d.map((x) => x.entryPoints)),
    },
    requires: union(frags.map(({ f }) => f.requires)),
  }
}

/** `emit('glsl-es300')`'s per-key source: the WHOLE stage, preamble included, since a
 *  standalone variant owns its own header. */
function emitGuardedArmSource(
  v: { readonly module: ModuleDecl },
  opts?: GlslEmitOptions & { stage?: 'vertex' | 'fragment' },
): string {
  const f = emitGlslFragment(v.module, opts?.stage, { ...opts, entryPoints: true })
  return [...f.preamble, '', f.source].join('\n')
}
