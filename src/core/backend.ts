// ═══ Shader DSL — the Backend plugin contract ═══
//
// A Backend is a target writer (WGSL, GLSL ES 3.00, later SPIR-V/MSL). The emit
// driver is generic; it calls into the backend for every target-specific
// decision. The IR carries no target lexemes — all spelling lives here.
//
// S1 scope: the type + literal spelling surface + a capability model. The
// intrinsic-spelling surface (`intrinsic`) and the IO/resource lowering are
// threaded in later steps; until then the WGSL writer keeps its inline spelling
// and remains byte-identical.

import type {
  ShaderType,
  ConstDecl,
  OverrideDecl,
  StructDecl,
  BindingDecl,
  FuncDecl,
  ModuleDecl,
  Capability,
  RawStmt,
} from './ir/index.js'
import { ALL_CAPABILITIES } from './ir/nodes.js'
import { ShaderDslError } from './diagnostics/error.js'
import type { ParenMode } from './emit.js'

// The `Capability` vocabulary lives with the IR data shapes (ir/nodes.ts) — a module
// DECLARES the caps it needs there (surfaced publicly via the ir barrel). This file is
// the BACKEND side: which caps a target HAS (Capabilities), consuming the type only.

/** What one capability costs on one target: the row of a backend's `capProfile`. Both
 *  fields are optional and mean different things.
 *
 *  An empty row (`{}`) means the target supports the capability outright, with no directive
 *  and no host activation (storage buffers on WGSL, float render targets on WebGPU). */
export interface CapSupport {
  /** The token the emitted source must carry for this target to accept the feature: WGSL
   *  `enable <directive>;`, GLSL ES 3.00 `#extension <directive> : require`. When absent,
   *  the feature adds nothing to the emitted source. */
  readonly directive?: string
  /** What the host must activate before pipeline creation:
   *  `gl.getExtension('<hostFeature>')` on WebGL2, a `requiredFeatures: ['<hostFeature>']`
   *  entry on WebGPU. When absent, the feature is core on that target and there is nothing
   *  to request. */
  readonly hostFeature?: string
}

/** A backend's capability table, and the single authority for what its target supports.
 *  Membership is support: a capability with a row can be emitted on this target, and a
 *  capability without one makes emit throw {@link UnsupportedFeatureError} naming it.
 *  Everything else is derived from the same rows: coverage from the keys
 *  (`Capabilities.fromProfile`), the source directive header from each row's `directive`,
 *  and the host activation list from each row's `hostFeature` ({@link hostFeaturesFor}), so
 *  the three cannot disagree. */
export type CapProfile = Readonly<Partial<Record<Capability, CapSupport>>>

/** The set of capabilities a backend supports, built from its `capProfile` with
 *  `Capabilities.fromProfile(backend.capProfile)`. Membership in the profile's keys is
 *  support, so the set and the profile are one fact.
 *
 *  The capability gate that runs before every emit uses it: it derives what a module needs
 *  (a storage binding needs `storageBuffer`, a `@compute` entry needs `compute`, a multisampled
 *  texture load needs `msaaTextureLoad`, plus whatever the module lists in `enables`), calls
 *  `covers(reqs)`, and on a miss calls `missing(reqs)` to name the capabilities the target
 *  cannot emit. The thrown {@link UnsupportedFeatureError} then reads "backend 'glsl-es300'
 *  cannot emit this module: missing capabilities: compute", with the whole module as context.
 *  This is why the GLSL ES 3.00 `capProfile` has no row for `storageBuffer`, `compute`, or
 *  `msaaTextureLoad`: the gate refuses the module before the writer sees it.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export class Capabilities {
  constructor(private readonly set: ReadonlySet<Capability>) {}
  /** The capabilities a `capProfile` declares, read from its keys. Build coverage this way
   *  so that profile membership and capability coverage stay one fact. */
  static fromProfile(profile: CapProfile): Capabilities {
    // Filter explicitly-undefined rows: `exactOptionalPropertyTypes` is OFF in this
    // repo, so `{ f16: undefined }` typechecks as a CapProfile and its key would
    // otherwise count as support for a cap the target cannot spell.
    return new Capabilities(
      new Set(
        Object.entries(profile)
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k) as Capability[],
      ),
    )
  }
  has(c: Capability): boolean {
    return this.set.has(c)
  }
  /** True iff this target supports everything `reqs` needs. */
  covers(reqs: Iterable<Capability>): boolean {
    for (const c of reqs) if (!this.set.has(c)) return false
    return true
  }
  missing(reqs: Iterable<Capability>): Capability[] {
    const m: Capability[] = []
    for (const c of reqs) if (!this.set.has(c)) m.push(c)
    return m
  }
}

/** Translate neutral capability ids into the feature strings one target's host has to
 *  activate before it creates a pipeline. On WebGL2 those are extension names for
 *  `gl.getExtension`, and on WebGPU they are feature names for
 *  `requestDevice({ requiredFeatures })`.
 *
 *  Feed it `reflect(m).requiredFeatures`, which reports the ids neutrally because reflection
 *  takes a module and never a backend.
 *
 *  It skips every id with no host half. A capability that is core on this target, or one the
 *  backend covers by emitting a source directive, contributes nothing. That is why this is a
 *  function: a `map` over the profile at each call site yields `undefined` holes a host then
 *  hands to `getExtension` verbatim. The returned list has no holes.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param be - the backend whose capability profile does the translating.
 *  @param caps - the neutral ids, usually `reflect(m).requiredFeatures`.
 *  @returns the host-side feature strings, in the order the ids arrived, with the id-less ones
 *    dropped.
 *
 *  @example
 *  ```ts
 *  import { hostFeaturesFor, reflect, glslEs300Backend, wgslBackend } from '@xgis/shader-dsl'
 *
 *  const caps = reflect(MODULE).requiredFeatures
 *
 *  for (const ext of hostFeaturesFor(glslEs300Backend, caps)) {
 *    if (!gl.getExtension(ext)) throw new Error(`WebGL2 lacks ${ext}`)
 *  }
 *
 *  const device = await adapter.requestDevice({
 *    requiredFeatures: hostFeaturesFor(wgslBackend, caps),
 *  })
 *  ```
 *
 *  @see {@link reflect} for where the ids come from.
 *  @see {@link capabilityMatrix} for which target can spell which id.
 */
export function hostFeaturesFor(be: Backend, caps: readonly Capability[]): readonly string[] {
  return caps.flatMap((c) => {
    const h = be.capProfile[c]?.hostFeature
    return h === undefined ? [] : [h]
  })
}

/** The contract a target writer implements. The package ships two backends, WGSL and GLSL
 *  ES 3.00, and the shared emit driver never branches on which one it is writing for: every
 *  target-specific decision (how types, literals and intrinsic calls are spelled, the handful
 *  of statement fragments that differ between targets, and the module-level declarations) is
 *  a method call into whichever `Backend` the caller passed.
 *
 *  `capProfile` is the one member that spells no code. The capability gate reads it before any
 *  of the methods run, so a module that needs a capability the target lacks throws
 *  {@link UnsupportedFeatureError}, naming the missing capabilities, before the backend can
 *  emit source the driver would reject. The GLSL ES 3.00 profile has no row for
 *  `storageBuffer`, `compute` or `msaaTextureLoad`, because WebGL2 has neither compute shaders
 *  nor multisampled texture loads, while the WGSL profile gives the same three an empty row:
 *  core, nothing to declare or activate. A capability can also be core on one target and an
 *  extension on the other: `floatRenderTarget` is `{}` on WGSL and needs
 *  `EXT_color_buffer_float` activated on GLSL. A backend whose target cannot represent a
 *  declaration (GLSL has no syntax for a struct or binding at a bare emit site) throws the
 *  same error from that method.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface Backend {
  readonly id: string
  /** The capability table for this target: neutral capability id to `{ directive?,
   *  hostFeature? }`, and the only capability authority a backend carries. Coverage is
   *  `Capabilities.fromProfile(capProfile)`, `modulePreamble` reads the `directive` fields
   *  off the same rows, and {@link hostFeaturesFor} reads the `hostFeature` fields, so a
   *  capability cannot be supported without its directive, or directed without being
   *  supported. A target gains support for a feature by gaining one row. */
  readonly capProfile: CapProfile
  /** Optional. The `@builtin(<id>)` ids this target lacks, each mapped to the message tail
   *  printed after `<backend id>: @builtin(<id>)`. A pre-pass that runs beside the
   *  capability gate throws {@link UnsupportedFeatureError} for any of them, so the problem
   *  is named at the author's module with the whole module as context. A backend whose own
   *  input/output translation already rejects every builtin it cannot map (GLSL ES 3.00
   *  does) omits this. */
  readonly absentBuiltins?: ReadonlyMap<string, string>
  /** Spell a type for this target (e.g. WGSL `vec3<f32>` vs GLSL `vec3`). */
  typeName(t: ShaderType): string
  /** Spell a scalar literal for this target (e.g. WGSL `1u` vs GLSL `1`). */
  literal(value: number | boolean, t: ShaderType): string
  /** Spell an intrinsic or builtin call from already-emitted argument strings.
   *  `name` is the WGSL id of the function (the call node's `fn`, plus the reserved
   *  `'select'`). The WGSL writer emits `name(args)` as is; the GLSL writer remaps the
   *  names that differ (textureSample to texture, unpack4x8unorm to unpackUnorm4x8,
   *  bitcast<u32> to floatBitsToUint, select(f, t, c) to a ternary) and passes the rest
   *  through. Calls to user-defined functions also arrive here and pass through unchanged. */
  intrinsic(name: string, args: string[]): string

  // ── Divergent statement/declaration fragments ──
  // The control-flow walk (if/for/switch/return/assign/…) is shared in
  // core/emit.ts; only these fragments differ between targets. Each returns the
  // fragment WITHOUT leading indentation or trailing `;` (the walk adds those),
  // except constDecl which is a full line.
  /** `let n = init` (WGSL, type inferred) vs `T n = init` (GLSL). */
  localLet(name: string, type: ShaderType, init: string): string
  /** `var n: T[= init]` (WGSL) vs `T n[= init]` (GLSL). */
  localVar(name: string, type: ShaderType, init?: string): string
  /** A module-level const declaration line, incl. trailing `;`:
   *  `const n: T = v;` (WGSL) vs `const T n = v;` (GLSL). */
  constDecl(name: string, type: ShaderType, value: string): string
  /** A `switch` case label: `${v}u` for a u32 scrutinee on WGSL; `${v}` on GLSL. */
  caseLabel(value: number, scrutType: ShaderType): string
  /** The `switch` head: `switch ${scrut} {` (WGSL) vs `switch (${scrut}) {` (GLSL). */
  switchHead(scrut: string): string
  /** Optional. Spelling for `%` on float operands, for a target whose native `%` accepts
   *  integers only. GLSL ES 3.00 rejects float `%`, so the GLSL backend provides this. The
   *  operand texts arrive fully parenthesized (single atoms aside), and the returned
   *  expression must be wrapped in its own parentheses and must reproduce WGSL float `%`
   *  semantics: truncated modulo, `a - b * trunc(a / b)`. GLSL `mod()` is floor modulo and
   *  gives a different answer for negative operands, so it is the wrong choice here. When
   *  absent, the native `%` is emitted. */
  readonly floatMod?: (a: string, b: string) => string
  /** Optional. A terminator written at the end of every `switch` case. WGSL cases do not
   *  fall through, so the WGSL backend omits this. GLSL follows C and does fall through, so
   *  the GLSL backend returns `break;`; without it every `match()` arm would run into the
   *  next and the function would return the last arm's value. */
  readonly caseBreak?: string
  /** A `raw` statement, the escape hatch that splices source text verbatim. It takes the
   *  whole node because the node carries one payload per target (`wgsl` and `glsl`); each
   *  backend picks its own side here, and the shared emit walk stays target-blind. A
   *  backend whose side is absent throws {@link UnsupportedFeatureError} (`SD0030`). */
  rawStmt(s: RawStmt): string
  /** A `placeholder` statement that no composition step replaced before emit. The WGSL
   *  backend emits a comment carrying the tag; the GLSL backend throws
   *  {@link UnsupportedFeatureError}. */
  placeholderStmt(tag: string): string

  // ── Module-level declaration surface ──
  // The module assembly walk (validate → assertCaps → autoVars → lowerModule →
  // optimize → assemble) is shared in core/emit.ts (`emitModule`); only these
  // per-declaration spellings differ between targets. A backend that does not
  // support a declaration (e.g. GLSL ES bindings/structs) fails closed here.
  /** A module-level const declaration line, incl. trailing `;`. */
  emitConst(c: ConstDecl): string
  /** Optional. A module-level specialization constant declaration. The WGSL writer emits
   *  `override name: T = default;`, which the host can override at pipeline creation through
   *  `constants: {}`. The GLSL writer emits an `#ifndef` / `#define` / `#endif` block that
   *  supplies the default; the host specializes by emitting again with `emitGlslModule`'s
   *  `overrideValues`, which the emitter places after the `#version` line, since a `#define`
   *  ahead of `#version` is invalid GLSL. A backend with no such construct omits this, and
   *  module assembly skips overrides for that target. */
  emitOverride?(o: OverrideDecl): string
  /** A struct declaration block. */
  emitStruct(s: StructDecl): string
  /** A resource binding declaration line. */
  emitBinding(b: BindingDecl): string
  /** A function declaration block: the signature and the emitted body. `parens` selects
   *  how many parentheses the shared expression walk writes, `'full'` or `'minimal'`;
   *  omitted means `'full'`. A backend forwards it to the body emitter. */
  emitFunc(f: FuncDecl, parens?: ParenMode): string
  /** The backend's emit-time optimization of the lowered module. Both shipped backends
   *  run the same optimization pipeline; the hook is per backend so that a target can
   *  choose differently without a change to the shared driver. It runs after the
   *  lowering passes and before the module is assembled into source. */
  optimize(lowered: ModuleDecl): ModuleDecl
  /** Optional. The module header carrying the source-level directives the module's
   *  declared capabilities need on this target: one line per `m.enables` entry whose
   *  `capProfile` row has a `directive` (WGSL `enable <d>;`, GLSL ES 3.00
   *  `#extension <d> : require`), deduplicated and sorted so the byte order is
   *  deterministic.
   *
   *  The contract is the same for every backend: the directive lines joined by `'\n'`,
   *  with no trailing separator, and `''` when there is nothing to direct (every declared
   *  capability is host-side, or none is declared). The caller separates the header from
   *  what follows and decides where it lands, because the two targets have different legal
   *  slots: the WGSL driver prepends it to the whole module with a blank line after it, and
   *  the GLSL assembler splices it in after `#version 300 es`, since GLSL ES 3.00 requires
   *  `#version` to lead the file and `#extension` to precede any non-preprocessor token.
   *  Both call it with the module as authored: `enables` is an authoring-level declaration,
   *  and reading it off the lowered module would make the header depend on every pass
   *  preserving it. */
  modulePreamble?(m: ModuleDecl): string
}

/** Thrown when a module needs a feature the target backend does not support, with code
 *  `SD0030`. The capability gate that runs before every emit throws it naming the missing
 *  capabilities, and an individual backend method throws it when asked for a construct its
 *  target cannot express. No source is produced in either case. */
export class UnsupportedFeatureError extends ShaderDslError {
  constructor(message: string) {
    super({ code: 'SD0030', message })
    this.name = 'UnsupportedFeatureError'
  }
}

// ── Capability × backend matrix (#1717) ──────────────────────────────────────

/** How one backend supports one capability.
 *  - `'native'`: supported, with nothing to emit and nothing for the host to turn on.
 *  - `'directive'`: supported, and the emitted source declares it (`enable f16;`,
 *    `#extension … : require`). The emitter writes the line.
 *  - `'host-feature'`: supported, and the host must activate it before pipeline creation
 *    (a WebGPU device feature or a WebGL2 extension). {@link hostFeaturesFor} looks it up.
 *  - `'unsupported'`: the target has no row, and emit throws {@link UnsupportedFeatureError}
 *    (`SD0030`) before writing any source.
 *
 *  A row can be both directive and host-feature; `'directive'` wins in that case, because
 *  it is the half a reader of the emitted source can see. */
export type CapSupportKind = 'native' | 'directive' | 'host-feature' | 'unsupported'

/** One row of the capability matrix: a capability and how each backend supports it. */
export interface CapabilityRow {
  readonly capability: Capability
  /** Keyed by `Backend.id`, one entry per backend passed in. */
  readonly support: Readonly<Record<string, CapSupportKind>>
  /** Whether a module may name this capability in `enables`. False for the three
   *  capabilities derived from a module's shape (`storageBuffer`, `compute` and
   *  `msaaTextureLoad`), which {@link DeclarableCapability} excludes from `enables`. */
  readonly declarable: boolean
}

/** Report which backend can spell which capability, as one row per capability with a support
 *  class per backend.
 *
 *  The support classes are read from each backend's own `capProfile` table, so the matrix
 *  cannot go stale against the thing it describes. A row
 *  reads `'native'` when the target needs nothing, `'directive'` when the backend emits a
 *  source line for it, `'host-feature'` when the host activates it before pipeline creation,
 *  and `'unsupported'` when that target has no row at all. A capability may need both halves,
 *  a directive and a host feature, and the class names the one that decides the row.
 *
 *  Support is not reachability. A capability can have a profile row and no way to author it:
 *  a row says the backend would emit the directive, and whether the DSL has a construct that
 *  needs it is a separate question. Read a row as a fact about the emit, and check the
 *  authoring surface separately.
 *
 *  A missing row is a hard stop by design, and it is no hint to work around. Emit throws
 *  `UnsupportedFeatureError` with `SD0030` naming the capability, and no source the driver
 *  would reject is produced.
 *
 *  `declarable` is false for the three capabilities derived from a module's shape,
 *  `storageBuffer`, `compute` and `msaaTextureLoad`, which `enables` cannot name.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param backends - the backends to compare, in the column order you want.
 *  @returns one row per capability, in the canonical capability order.
 *
 *  @example
 *  ```ts
 *  import { capabilityMatrix, wgslBackend, glslEs300Backend } from '@xgis/shader-dsl'
 *
 *  capabilityMatrix([wgslBackend, glslEs300Backend])
 *  // [{ capability: 'storageBuffer',
 *  //    support: { wgsl: 'native', 'glsl-es300': 'unsupported' }, declarable: false },
 *  //  …,
 *  //  { capability: 'f16',
 *  //    support: { wgsl: 'directive', 'glsl-es300': 'unsupported' }, declarable: true }]
 *  ```
 *
 *  @see {@link hostFeaturesFor} for the host half of a row.
 *  @see {@link ModuleDecl} for where a declarable capability is named.
 */
export function capabilityMatrix(backends: readonly Backend[]): readonly CapabilityRow[] {
  return ALL_CAPABILITIES.map((capability) => ({
    capability,
    support: Object.fromEntries(
      backends.map((be) => {
        const row = be.capProfile[capability]
        return [
          be.id,
          row === undefined
            ? 'unsupported'
            : row.directive
              ? 'directive'
              : row.hostFeature
                ? 'host-feature'
                : 'native',
        ]
      }),
    ),
    declarable: !DERIVED_CAPABILITIES.has(capability),
  }))
}

/** The three caps `requiredCaps` derives from a module's SHAPE — a storage binding, a
 *  `@compute` entry, an MSAA texture load — and which `DeclarableCapability` therefore
 *  makes unrepresentable in `enables` (#1681 A2). */
const DERIVED_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'storageBuffer',
  'compute',
  'msaaTextureLoad',
])
