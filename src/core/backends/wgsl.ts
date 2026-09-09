// ═══ Shader DSL — WGSL backend ═══
//
// Lowers a ModuleDecl to a WGSL string for device.createShaderModule. The
// statement/expression walk is the SHARED neutral emitter (core/emit.ts); this
// file provides the WGSL Backend (type/literal/intrinsic spelling + the divergent
// declaration fragments) and the WGSL module assembly (struct/binding/func/const
// + the matchExpr lowering pass). WGSL output is byte-identical to the pre-refactor
// emit — the wgslBackend fragments reproduce the exact former strings.

import type {
  ShaderType,
  Expr,
  ConstDecl,
  StructDecl,
  BindingDecl,
  FuncDecl,
  ModuleDecl,
} from '../ir/index.js'
import { UnsupportedFeatureError, type Backend, type CapProfile } from '../backend.js'
import {
  emitExpr as emitExprNeutral,
  emitBody,
  emitModule as emitModuleDriver,
  emitModuleAt as emitModuleAtDriver,
  emitModuleFragment as emitFragmentDriver,
  lowerForBackend,
  type EmitOptions,
} from '../emit.js'
import type { EmitFragment } from '../fragment.js'
import { lowerModule } from '../passes/match-lower.js'
import { fixpoint, autoVars, type OptLevel } from '../passes/opt/index.js'
import { spellIntrinsic } from '../intrinsics.js'
import { fp64Lower } from '../passes/fp64-lower.js'
import { dslError } from '../diagnostics/error.js'

/** Spell a {@link ShaderType} as WGSL type syntax (`f32`, `vec2<f32>`, `array<u32, 4>`, …).
 *
 *  @internal Exported for the backend's own use. The public entry point for producing WGSL
 *  is {@link emitModule}.
 *
 *  @throws `SD0040` if `t` is an `f64` or `vec64` type, or a matrix of `f64`. Those types
 *  exist only before the double-precision lowering pass ({@link fp64Lower}, which every emit
 *  runs) rewrites them to `vec2<f32>` and the `DF64` struct types. Reaching one here means
 *  that pass did not run, and the error is raised so a shader never ships with its double
 *  precision quietly reduced to single precision. */
export function wgslType(t: ShaderType): string {
  switch (t.kind) {
    case 'scalar':
      return t.scalar
    // f64/vec64 are PRE-LOWERING types only: fp64Lower (run inside
    // lowerForBackend) rewrites them to vec2<f32> / DF64VecN structs before any
    // backend spells a type. Reaching these arms means the pass was bypassed —
    // fail loud, never emit.
    case 'f64':
      throw dslError('SD0040', 'wgslType(f64)')
    case 'vec64':
      throw dslError('SD0040', `wgslType(vec${t.n}<f64>)`)
    case 'vec':
      return `vec${t.n}<${t.elem}>`
    case 'mat':
      // matNxN<f64> is a PRE-LOWERING type too (→ DF64MatN); reaching here means
      // fp64Lower was bypassed — fail loud, never spell an invalid mat<f64>.
      if (t.elem === 'f64') throw dslError('SD0040', `wgslType(mat${t.n}x${t.n}<f64>)`)
      return `mat${t.n}x${t.n}<${t.elem}>`
    case 'struct':
      return t.name
    case 'array':
      return t.size !== undefined
        ? `array<${wgslType(t.elem)}, ${t.size}>`
        : `array<${wgslType(t.elem)}>`
    case 'texture':
      // Spelled per dim, never templated: '2d-array' is `texture_2d_array<f32>` in
      // WGSL (a `texture_${t.dim}` template would emit `texture_2d-array<f32>`).
      // Exhaustive: a new dim must fail compilation, not fall open to the 2d spelling.
      switch (t.dim) {
        case '2d-ms':
          return `texture_multisampled_2d<${t.elem}>`
        case '2d-array':
          return `texture_2d_array<${t.elem}>`
        case '2d':
          return `texture_2d<${t.elem}>`
        default:
          // Exhaustiveness on the ARM (#1703) — see typeKey's twin: with the texture
          // type a two-arm union, `t` is `never` here and has no `.dim` to check.
          return t satisfies never
      }
    case 'sampler':
      return 'sampler'
    case 'void':
      return 'void'
  }
}

/** Spell `v` as an `f32` literal, in the form WGSL and GLSL share: an integer-looking value
 *  gets a `.0` suffix so a float context never sees an integer literal.
 *
 *  @throws `SD0017` if `v` is not finite. Neither WGSL nor GLSL has a NaN or Infinity
 *  literal, so `String(v)` would place an unparseable token in the module. */
export function f32Lit(v: number): string {
  if (!Number.isFinite(v)) throw dslError('SD0017', `f32 literal ${v}`)
  const s = String(v)
  return /[.eE]/.test(s) ? s : `${s}.0`
}

/** Spell `v` as the body of an `i32` or `u32` literal (no suffix), in the form WGSL and GLSL
 *  share.
 *
 *  @throws `SD0017` if `v` is not an integer or lies outside the 32-bit range of `scalar`.
 *  WGSL rejects `2147483648` as an `i32` literal, and a fractional or out-of-range value
 *  printed verbatim is a compile error on both targets. */
export function intLit(v: number, scalar: 'i32' | 'u32'): string {
  const lo = scalar === 'i32' ? -2147483648 : 0
  const hi = scalar === 'i32' ? 2147483647 : 4294967295
  if (!Number.isInteger(v) || v < lo || v > hi) throw dslError('SD0017', `${scalar} literal ${v}`)
  return `${v}`
}

function lit(value: number | boolean, t: ShaderType): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (t.kind === 'scalar' && t.scalar === 'u32') return `${intLit(value, 'u32')}u`
  if (t.kind === 'scalar' && t.scalar === 'i32') return intLit(value, 'i32')
  return f32Lit(value)
}

function paramAttr(p: { builtin?: string; location?: number; attr?: string }): string {
  if (p.attr) return `${p.attr} `
  if (p.builtin) return `@builtin(${p.builtin}) `
  if (p.location !== undefined) return `@location(${p.location}) `
  return ''
}

/** THE WGSL capability table (#1670) — what this target supports, what each cap costs
 *  in the emitted source (`directive`), and what the host must request of the adapter
 *  (`hostFeature`). Coverage derives from these KEYS (`Capabilities.fromProfile`),
 *  `modulePreamble` from these `directive`s, and the host list from these
 *  `hostFeature`s (`hostFeaturesFor`), so none of the three can disagree; it replaced
 *  the hand-synced `caps`-set + `WGSL_ENABLE`-map pair (CLAUDE.md §12 second-ratchet).
 *
 *  The WGSL writer can SPELL every row here; whether a given adapter HAS an optional
 *  feature is a runtime probe the RHI owns — it opts a module in via `enables` only
 *  after confirming the device feature (#628).
 *
 *  NO `multiview` row, deliberately: WebGPU has no OVR_multiview2 equivalent, so a
 *  module declaring it must fail closed here (SD0030 naming 'multiview') rather than
 *  emit a module the device cannot honour. That fail-closed half is half of what makes
 *  the GLSL `#extension` path meaningful — pinned by extension-profile.test.ts, so the
 *  absence is an asserted invariant rather than this comment's word for it.
 *
 *  `satisfies` (not a `: CapProfile` annotation): the annotation would widen every row
 *  to `CapSupport` and lose the literal `hostFeature` strings, which is exactly what a
 *  reader — and the profile-pin test — needs to see. It still type-checks the KEYS
 *  against `Capability`, so a renamed cap id cannot leave a stale row behind. */
const WGSL_CAP_PROFILE = {
  // Derived resource caps — core WGSL, nothing to declare or request.
  storageBuffer: {},
  compute: {},
  msaaTextureLoad: {},
  // Opt-in LANGUAGE features — a WGSL `enable` directive AND a device feature.
  f16: { directive: 'f16', hostFeature: 'shader-f16' },
  subgroups: { directive: 'subgroups', hostFeature: 'subgroups' },
  // Opt-in DEVICE features (#1670) — no WGSL directive exists for any of these; the
  // host activates them at requestDevice time (or they are core).
  floatRenderTarget: {}, // core in WebGPU: an rgba32float render target needs no feature
  float32Blend: { hostFeature: 'float32-blendable' },
  float32Filterable: { hostFeature: 'float32-filterable' },
} satisfies CapProfile

/** `@builtin(<id>)` ids that do NOT exist in WGSL (#1672), each mapped to the message
 *  tail the shared pre-pass prints after `wgsl: @builtin(<id>)`. Every one of them is a
 *  GLSL-ism an author can reach for — `point_size`/`point_coord` are the gl_PointSize /
 *  gl_PointCoord pair, and `frag_coord` is the GLSL spelling of the fragment-input
 *  `position`. The GLSL writer used to ACCEPT `frag_coord` as an alias, which made a
 *  module authored against it die only when this writer ran (works-on-WebGL2,
 *  fails-on-WebGPU); it now fails closed on BOTH writers with the same remedy
 *  (backends/glsl.ts BUILTIN_IN_REMEDY). Each of these used to be emitted VERBATIM into
 *  the module string (struct field attr / param attr) and rejected by naga with no line
 *  back to the authoring site. The set is a DENYLIST, not a WGSL allowlist: a builtin
 *  the DSL has not met yet must keep emitting, so a new WGSL builtin never needs a
 *  table edit here to be usable. */
const WGSL_ABSENT_BUILTINS: ReadonlyMap<string, string> = new Map([
  [
    'point_size',
    'does not exist in WGSL — WebGPU point-list primitives are always 1px. Expand an instanced quad in the vertex stage instead (see map/src/shaders/dsl/point.ts).',
  ],
  [
    'point_coord',
    'does not exist in WGSL — there is no point-sprite coordinate. Interpolate a @location(n) corner uv from the expanded quad instead (see map/src/shaders/dsl/point.ts).',
  ],
  [
    'frag_coord',
    'does not exist in WGSL — the fragment-stage framebuffer coordinate (GLSL gl_FragCoord) is @builtin(position) on a fragment entry parameter.',
  ],
])

/** The WGSL target: a {@link Backend} that spells types, literals, intrinsics and module
 *  declarations for `device.createShaderModule`. Pass it to any API that takes a backend,
 *  such as {@link hostFeaturesFor} or {@link capabilityMatrix}. The WGSL emitters in this
 *  module ({@link emitModule}, {@link emitFragment}, {@link emitFuncs}, …) are already
 *  bound to it. */
export const wgslBackend: Backend = {
  id: 'wgsl',
  capProfile: WGSL_CAP_PROFILE,
  absentBuiltins: WGSL_ABSENT_BUILTINS,
  typeName: wgslType,
  literal: lit,
  // WGSL spells every intrinsic / user call as `name(args)`; the reserved
  // `'select'` id is WGSL select(falseVal, trueVal, cond).
  intrinsic: (name, args) => spellIntrinsic('wgsl', name, args),
  localLet: (name, _type, init) => `let ${name} = ${init}`,
  localVar: (name, type, init) =>
    init !== undefined
      ? `var ${name}: ${wgslType(type)} = ${init}`
      : `var ${name}: ${wgslType(type)}`,
  constDecl: (name, type, value) => `const ${name}: ${wgslType(type)} = ${value};`,
  caseLabel: (value, scrutType) =>
    scrutType.kind === 'scalar' && scrutType.scalar === 'u32' ? `${value}u` : `${value}`,
  switchHead: (scrut) => `switch ${scrut} {`,
  // #1671 — emit THIS target's payload; a raw carrying only the GLSL spelling is
  // a hard build failure here, not a stringified `undefined` in the module body.
  rawStmt: (s) => {
    if (s.wgsl !== undefined) return s.wgsl
    // Mirrors the GLSL side: the at-least-one union guarantees a `glsl` side
    // here, but tsc cannot discriminate the union on a non-unit-typed property —
    // so narrow the PROPERTY locally instead of asserting; `''` is unreachable.
    const glsl = s.glsl ?? ''
    throw new UnsupportedFeatureError(
      `wgsl: raw Stmt carries no wgsl payload (glsl-only raw: '${glsl.slice(0, 40)}') — supply a wgsl spelling for this statement`,
    )
  },
  placeholderStmt: (tag) => `// __placeholder: ${tag}`,
  // ── Module-decl surface (the WGSL spellings, lifted from the former free fns) ──
  emitConst: (c) =>
    wgslBackend.constDecl(
      c.name,
      c.type,
      c.valueExpr ? emitExprNeutral(c.valueExpr, wgslBackend) : f32Lit(c.wgslValue),
    ),
  // #923 — a pipeline specialization constant: a module-scope `override` the host
  // specializes via createRenderPipeline({ constants: { name } }). The default value
  // uses the same scalar spelling as any literal (1.0 / 2u / true), so the module
  // compiles standalone and a branch guarded by the override is dead-code-eliminated
  // by the DRIVER once specialized.
  emitOverride: (o) => `override ${o.name}: ${wgslType(o.type)} = ${lit(o.default, o.type)};`,
  emitStruct: (s) => {
    const fields = s.fields
      .map((f) => `  ${f.attr ? `${f.attr} ` : ''}${f.name}: ${wgslType(f.type)},`)
      .join('\n')
    return `struct ${s.name} {\n${fields}\n}`
  },
  emitBinding: (b) => {
    // texture / sampler are handle types — no address space (`var x: T;`).
    if (b.type.kind === 'texture' || b.type.kind === 'sampler') {
      return `@group(${b.group}) @binding(${b.binding}) var ${b.name}: ${wgslType(b.type)};`
    }
    const space = b.space === 'storage' ? `storage, ${b.access ?? 'read'}` : 'uniform'
    return `@group(${b.group}) @binding(${b.binding}) var<${space}> ${b.name}: ${wgslType(b.type)};`
  },
  emitFunc: (f, parens) => {
    const params = f.params.map((p) => `${paramAttr(p)}${p.name}: ${wgslType(p.type)}`).join(', ')
    const ret =
      f.ret.kind === 'void' ? '' : ` -> ${f.retAttr ? `${f.retAttr} ` : ''}${wgslType(f.ret)}`
    const attrs = f.attrs && f.attrs.length ? `${f.attrs.join(' ')}\n` : ''
    return `${attrs}fn ${f.name}(${params})${ret} {\n${emitBody(f.body, 1, wgslBackend, parens)}\n}`
  },
  // WGSL's emit-time optimizer: the full pipeline run to a fixed point — const/copy
  // propagation, const-fold (incl. literal compare/logical/select), algebraic
  // identities, dead-branch elim, cse auto-cache, licm, dce. Authors write plain
  // inline exprs; the optimizer folds constants, drops dead code, and binds reuse for
  // them. Correctness: oracle value-equality (unit) + the real-GPU optimizer-parity
  // gate (_optimizer-gpu-parity). Every pass skips a fn containing a raw Stmt (the
  // polygon composer's _mcSS fill/stroke), so those precision-critical paths are
  // emitted verbatim, untouched.
  optimize: (m) => fixpoint(m),
  // The WGSL `enable`-directive header (#628): one `enable <ext>;` per declared cap
  // whose PROFILE ROW carries a directive (#1670 — the host-side rows contribute
  // nothing), deduped + sorted for a deterministic byte order. Bare lines, NO trailing
  // separator — the one contract every backend's preamble keeps (backend.ts); the blank
  // line before the first declaration is added by emit.ts's `directiveHeader`, which
  // owns this target's slot. Empty when the module opts into nothing (or into host-side
  // caps only), so enables-free emit stays byte-identical. assertCaps (run in
  // lowerForBackend, before this string is used) has already guaranteed this backend
  // covers every declared cap.
  modulePreamble: (m) => {
    // Read through `wgslBackend.capProfile` (the emitConst/constDecl self-reference
    // idiom above), not the narrow `satisfies`-typed literal: the literal's type has no
    // key for a cap this target does not support, so indexing it by an arbitrary
    // `Capability` would not typecheck. It is the same object either way.
    const dirs = (m.enables ?? [])
      .map((c) => wgslBackend.capProfile[c]?.directive)
      .filter((d): d is string => d !== undefined)
    if (dirs.length === 0) return ''
    return [...new Set(dirs)]
      .sort()
      .map((d) => `enable ${d};`)
      .join('\n')
  },
}

/** Emit one {@link Expr} as WGSL source text, using {@link wgslBackend} with the default
 *  `'full'` parenthesisation. The expression is written as given; the lowering and
 *  optimization passes that {@link emitModule} runs do not run here. */
export const emitExpr = (e: Expr): string => emitExprNeutral(e, wgslBackend)

// The module-decl emit functions live as wgslBackend methods; these thin wrappers keep the
// existing export names + signatures. Only two of the four have a consumer through the
// package entry — see each doc comment, and #1697 for the surface question.

/** Emit one {@link ConstDecl} as a WGSL `const` line, without the surrounding module.
 *
 *  Use it to compose a shader out of separately authored pieces: emit the constants once,
 *  keep the string, and concatenate it with the rest of the source. The line is identical to
 *  the one {@link emitModule} writes for the same declaration, so a piece emitted here and a
 *  module emitted there agree, which is what makes concatenation safe.
 *
 *  The declaration is written as given: the passes {@link emitModule} runs before writing a
 *  module do not run here, so pass a declaration that needs none of them. The caveat on
 *  {@link emitFuncs} applies equally. */
export const emitConst = (c: ConstDecl): string => wgslBackend.emitConst(c)

/** Emit one {@link StructDecl} as a WGSL `struct` block.
 *
 *  @internal Exported for the backend's own use. A struct is meaningful only alongside the
 *  bindings and functions that use it, which {@link emitModule} emits together. */
export const emitStruct = (s: StructDecl): string => wgslBackend.emitStruct(s)

/** Emit one {@link BindingDecl} as a WGSL `@group(…) @binding(…) var` line.
 *
 *  @internal Exported for the backend's own use. Group and binding indices are assigned
 *  across the whole module, so a line emitted alone can disagree with the layout
 *  {@link reflect} reports for that module. Use {@link emitModule}. */
export const emitBinding = (b: BindingDecl): string => wgslBackend.emitBinding(b)

/** Emit one {@link FuncDecl} as a WGSL function, exactly as given.
 *
 *  Prefer {@link emitFuncs} for authored functions. This function skips every pass
 *  {@link emitModule} runs before writing: {@link autoVars}, `match` lowering
 *  ({@link lowerModule}), double-precision lowering ({@link fp64Lower}) and the optimizer.
 *  A function that still contains a `match` expression or an `f64` type therefore throws,
 *  because those constructs exist only before lowering, and a function the optimizer would
 *  have simplified is written as authored. Use it only when the declaration needs none of
 *  those passes, such as a hand-written helper built from plain `f32` arithmetic.
 *
 *  Parenthesisation is always `'full'`. {@link emitModule} passes its `parens` option down
 *  to the same speller, so a module emitted with `parens: 'minimal'` spells the same function
 *  with fewer parentheses. A function emitted here matches its text inside a module emitted
 *  with the default option, and may differ from its text inside a `'minimal'` one. */
export const emitFunc = (f: FuncDecl): string => wgslBackend.emitFunc(f)

/** Emit a list of functions as WGSL, joined by blank lines, through the same lowering and
 *  optimization passes {@link emitModule} runs. Constant folding, dead-code removal and reuse
 *  binding apply exactly as they would inside a full module, so the text matches the function
 *  section {@link emitModule} would write for the same declarations.
 *
 *  A bare list of functions is not a complete module, so validation and the capability check
 *  are skipped; only the passes the spelling needs run. {@link emitFragment} runs the full
 *  set when the declarations form a module. */
export function emitFuncs(funcs: readonly FuncDecl[]): string {
  const lowered = fixpoint(
    fp64Lower(lowerModule(autoVars({ consts: [], structs: [], bindings: [], funcs: [...funcs] }))),
  )
  return lowered.funcs.map((f) => wgslBackend.emitFunc(f)).join('\n\n')
}

/** Alias of {@link emitFuncs}.
 *
 *  @deprecated Use {@link emitFuncs}. Its name describes what the function does, which is to
 *  run the full optimization pipeline; the `Csed` suffix names only one of its passes. */
export const emitFuncsCsed = emitFuncs

/** Emit a {@link ModuleDecl} as a complete WGSL module string, ready for
 *  `device.createShaderModule`. Runs validation, the capability check, the lowering passes and
 *  the optimizer, then assembles the `enable` directives, structs, bindings, constants and
 *  functions.
 *
 *  `opts` is an optional {@link EmitOptions}: `plugins` for emit-time transforms such as the
 *  production ones on the `@xgis/shader-dsl/emit-prod` subpath, and `parens` to choose how
 *  many parentheses the expressions carry. */
export const emitModule = (m: ModuleDecl, opts?: EmitOptions): string =>
  emitModuleDriver(m, wgslBackend, opts)

/** Emit a {@link ModuleDecl} as a WGSL fragment for a host that assembles the final module
 *  itself: the declarations and helper functions without the `enable` directive header and,
 *  unless `opts.entryPoints` is `true`, without the stage entry points. Where GLSL would use
 *  `#include`, a WGSL host composes by concatenating fragments, so the directives it must
 *  place at the top of the module come back in the result's `preamble` field, and what the
 *  fragment declares and requires comes back alongside (see {@link EmitFragment}).
 *
 *  Prefer this over concatenating {@link emitFuncs} and {@link emitConst} output. This
 *  function runs the same validation and capability check as {@link emitModule}, so it never
 *  writes a module that {@link validate} or the capability check would have rejected. */
export const emitFragment = (
  m: ModuleDecl,
  opts?: EmitOptions & { entryPoints?: boolean },
): EmitFragment => emitFragmentDriver(m, wgslBackend, opts)

/** Emit a {@link ModuleDecl} as WGSL at an explicit optimization level. `emitModuleAt(m, 'O2')`
 *  produces the same string as `emitModule(m)`; `'O0'` skips the optimizer and writes the
 *  lowered module as authored; `'O1'` runs only the passes that cannot change a computed
 *  value. Useful for debug builds and for comparing emitted size across levels. See
 *  {@link OptLevel}. */
export const emitModuleAt = (m: ModuleDecl, level: OptLevel): string =>
  emitModuleAtDriver(m, wgslBackend, level)

/** Run the passes {@link emitModule} runs before writing text (validation, the capability
 *  check, {@link autoVars}, {@link lowerModule} and the optimizer at `level`) and return the
 *  resulting {@link ModuleDecl}. The string emit and this function share one recipe, so a tool
 *  that inspects the lowered module (an instruction count, for example) sees exactly the
 *  module {@link emitModuleAt} would write at the same level. */
export const lowerWgsl = (m: ModuleDecl, level: OptLevel): ModuleDecl =>
  lowerForBackend(m, wgslBackend, level)
