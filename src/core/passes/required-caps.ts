// ═══ Shader DSL — capability analysis + gate (Codegen/Backends context) ═══
//
// requiredCaps(module) derives the GPU features a module needs; assertCaps gates
// emit on the target backend covering them, failing closed (UnsupportedFeatureError)
// instead of a silent mis-emit. Wired at the top of every emit entry (X-GIS #9) so the
// fail-closed promise is real, not the GLSL writer's ad-hoc per-construct throws.
// assertBuiltins is its sibling for the target's BUILTIN VOCABULARY (X-GIS #1672) — same
// place, same voice, per-backend sets.

import { stageOf, type ModuleDecl, type Capability } from '../ir/index.js'
import { Capabilities, type Backend, UnsupportedFeatureError } from '../backend.js'
import { collectFnRefs } from '../ir/collect-refs.js'
import { TEXTURE_GATHER_IDS } from '../intrinsics.js'

/** Capability DEPENDENCIES (X-GIS #1670) — declaring the key implies needing the values, so a
 *  host activating off `reflect().requiredFeatures` gets the whole set rather than the
 *  half the author happened to name.
 *
 *  `float32Blend ⇒ floatRenderTarget` was discovered the expensive way, in this repo's
 *  own WebGL2 device: rhi-webgl2/src/rhi-webgl2.ts ~:668-676 ANDs `EXT_color_buffer_float`
 *  with `EXT_float_blend` before enabling either, because blending INTO a float target
 *  needs that target to be color-renderable first — with only EXT_float_blend the FBO is
 *  INCOMPLETE and every draw raises GL_INVALID_FRAMEBUFFER_OPERATION. Encoding it here
 *  means a module says `enables: ['float32Blend']` and the host still learns it must
 *  activate both. */
const CAP_IMPLIES: Readonly<Partial<Record<Capability, readonly Capability[]>>> = {
  float32Blend: ['floatRenderTarget'],
}

/** The `@builtin(<id>)` ids WGSL puts behind an `enable` extension, and the neutral
 *  {@link Capability} each one derives (§50). Spelling the id is the declaration: WGSL refuses
 *  the id itself without the extension, so there is nothing an author could usefully say that
 *  the use does not already say. Ids WGSL gives away for free are absent, which is most of
 *  them. */
const BUILTIN_CAPS: Readonly<Record<string, Capability>> = {
  clip_distances: 'clipDistances',
  primitive_index: 'primitiveIndex',
  subgroup_invocation_id: 'subgroups',
  subgroup_size: 'subgroups',
}

/** Every `@builtin(<id>)` this module spells, from the structured `builtin` field on an IO
 *  struct member, an entry parameter and a bare `retAttr`-authored return — the three places a
 *  backend can spell one, exactly as `assertBuiltins` enumerates them. */
function* moduleBuiltins(m: ModuleDecl): Generator<string> {
  for (const s of m.structs) for (const f of s.fields) if (f.builtin !== undefined) yield f.builtin
  for (const f of m.funcs) {
    for (const p of f.params) if (p.builtin !== undefined) yield p.builtin
    if (f.retBuiltin !== undefined) yield f.retBuiltin
  }
}

/** A WGSL *language* extension — what a `requires` directive names, as opposed to the device
 *  features `enable` names. It is reported by
 *  `reflect().requiredLanguageFeatures` so a host can check it against
 *  `navigator.gpu.wgslLanguageFeatures`, and the WGSL writer emits the directive for it.
 *
 *  One row today. `uniform_buffer_standard_layout` is NOT one: the Tint the compile gate runs
 *  refuses the directive outright (`feature 'uniform_buffer_standard_layout' is not
 *  supported`, measured 2026-09-21), and nothing this compiler emits asks for it anyway — the
 *  layout layer reports a uniform array under std140's 16-byte element stride
 *  (`reflect.ts`'s `typeLayout`), so a module never depends on the device relaxing the
 *  rule. */
export type LanguageFeature = 'readonly_and_readwrite_storage_textures'

/** The WGSL language features this module's emit requires, sorted and deduplicated.
 *
 *  A storage texture bound `read` or `read_write` is the one row: core WGSL gives a storage
 *  texture `write` only, and reading one back is the `readonly_and_readwrite_storage_textures`
 *  extension. `requires readonly_and_readwrite_storage_textures;` is accepted by the Tint the
 *  gate runs (measured 2026-09-21), so the directive is emitted rather than merely reported. */
export function requiredLanguageFeatures(m: ModuleDecl): LanguageFeature[] {
  const out = new Set<LanguageFeature>()
  for (const b of m.bindings) {
    if (b.type.kind === 'storage-texture' && b.type.access !== 'write') {
      out.add('readonly_and_readwrite_storage_textures')
    }
  }
  return [...out].sort()
}

/** The capabilities a module's emit requires. */
export function requiredCaps(m: ModuleDecl): Capability[] {
  const caps = new Set<Capability>()
  for (const b of m.bindings) {
    if (b.space === 'storage') caps.add('storageBuffer')
    // The depth twin rides the same capability (roadmap 0.4 item 13).
    if ((b.type.kind === 'texture' || b.type.kind === 'depth-texture') && b.type.dim === '2d-ms')
      caps.add('msaaTextureLoad')
    // A storage texture is WebGPU-only (roadmap 0.4 item 10): GLSL ES 3.00 has no image
    // load/store, so the capability is what fails a module closed on that target rather than
    // letting it reach `glslType` and throw from inside the emit.
    if (b.type.kind === 'storage-texture') caps.add('storageTexture')
    // A 1d or a cube-array texture is WebGPU-only too (roadmap 0.4 item 12): GLSL ES 3.00 has
    // no `sampler1D` (a reserved word) and no `samplerCubeArray` (a WebGL2 driver refuses the
    // extension). The depth cube array rides the same capability as the colour one.
    if (b.type.kind === 'texture' && b.type.dim === '1d') caps.add('texture1d')
    if (
      (b.type.kind === 'texture' || b.type.kind === 'depth-texture') &&
      b.type.dim === 'cube-array'
    )
      caps.add('textureCubeArray')
  }
  // A textureGather call is a capability of the CALLS, not of a binding (roadmap 0.4 item 12):
  // the texture it reads is an ordinary 2d or cube one. GLSL ES 3.00 has no gather (ES 3.10).
  for (const f of m.funcs) {
    const refs = collectFnRefs(f)
    for (const id of TEXTURE_GATHER_IDS) if (refs.calls.has(id)) caps.add('textureGather')
  }
  for (const f of m.funcs) {
    // stageOf reads structured `stage` first (X-GIS #763 S2) — a hand-built
    // `{ stage: 'compute' }` decl without attrs must NOT slip past the gate.
    if (stageOf(f) === 'compute') caps.add('compute')
  }
  // Extension-gated BUILT-IN VALUES (§50): WGSL refuses `@builtin(clip_distances)` and
  // `@builtin(primitive_index)` unless the module enables the matching extension, and the
  // subgroup pair needs `enable subgroups;` the same way — measured on Tint, `use of
  // '@builtin(clip_distances)' requires enabling extension 'clip_distances'`. So the cap is
  // DERIVED from the use rather than declared: an author who writes the builtin gets the
  // directive and the host feature without naming either, and `reflect().requiredFeatures`
  // tells the host what to request. Reads the structured `builtin` field, the same authority
  // `assertBuiltins` reads, so a hand-built decl carrying only `attr` is treated the same way
  // there and here.
  for (const b of moduleBuiltins(m)) {
    const cap = BUILTIN_CAPS[b]
    if (cap !== undefined) caps.add(cap)
  }
  // OPT-IN language-feature caps (X-GIS #628) — f16 / subgroups the author turned on. Folded
  // in here so assertCaps gates them exactly like the derived resource caps (fail-closed
  // on GLSL); the WGSL backend then emits the matching `enable <ext>;` for each.
  for (const c of m.enables ?? []) caps.add(c)
  // Transitive closure over CAP_IMPLIES, to a fixed point. Today's table is depth 1, so
  // one pass would do — written as a loop anyway, because a future row implying a cap
  // that itself implies another must not need this code re-read to stay correct.
  let grew = true
  while (grew) {
    grew = false
    for (const c of [...caps]) {
      for (const dep of CAP_IMPLIES[c] ?? []) {
        if (caps.has(dep)) continue
        caps.add(dep)
        grew = true
      }
    }
  }
  return [...caps]
}

/** Throw UnsupportedFeatureError if `m` names a `@builtin(...)` id the target does
 *  not have (X-GIS #1672) — the builtin-vocabulary twin of the capability gate above, run
 *  from the same place (lowerForBackend) so BOTH backends share one mechanism with
 *  per-target sets (`Backend.absentBuiltins`). The GLSL writer keeps its own
 *  rejection (builtinIn/builtinOut, whose messages name the missing gl_* mapping)
 *  and declares no set, so this pass is a no-op for it; the WGSL writer had NO such
 *  rejection at all — it spelled `@builtin(point_size)` verbatim and the module died
 *  at naga, far from the author.
 *
 *  STRUCTURED FIELD ONLY (X-GIS #740 R3): `attr` is the emit SPELLING, the `builtin` field
 *  is the semantic source. Every sot-authored IO (`builtin(name, type)`) and every
 *  builder-made entry param carries it; a hand-built decl literal carrying only
 *  `attr: '@builtin(x)'` is outside that contract and is skipped here (the GLSL
 *  writer's ioAttr keeps a regex fallback for those legacy fixtures — this gate
 *  deliberately does not replicate it, so the structured field stays the one
 *  authority a target-vocabulary decision reads). */
export function assertBuiltins(backend: Backend, m: ModuleDecl): void {
  const absent = backend.absentBuiltins
  if (absent === undefined) return
  const check = (b: string | undefined): void => {
    const why = b === undefined ? undefined : absent.get(b)
    if (why !== undefined) throw new UnsupportedFeatureError(`${backend.id}: @builtin(${b}) ${why}`)
  }
  // Every place a backend can SPELL a builtin attr: an IO struct field, an entry
  // param, and a bare return authored as `retAttr: builtin(name, T)` — the builder
  // preserves that FieldSpec's id as `retBuiltin` (X-GIS #1672 review finding: it used to
  // be discarded, leaving retAttr the one structured-authoring path this gate missed).
  for (const s of m.structs) for (const sf of s.fields) check(sf.builtin)
  for (const f of m.funcs) {
    for (const p of f.params) check(p.builtin)
    check(f.retBuiltin)
  }
}

/** Throw UnsupportedFeatureError if `backend` cannot cover everything `m` needs. */
export function assertCaps(backend: Backend, m: ModuleDecl): void {
  const req = requiredCaps(m)
  // Coverage is DERIVED from the one authority (X-GIS #1670) — the backend carries the
  // `capProfile` table and nothing else; a cached `caps` field beside it was a second
  // place the same fact could live. Built once per call, over 9 keys.
  const caps = Capabilities.fromProfile(backend.capProfile)
  if (!caps.covers(req)) {
    const missing = caps.missing(req)
    throw new UnsupportedFeatureError(
      `backend '${backend.id}' cannot emit this module — missing capabilities: ${missing.join(', ')}`,
    )
  }
}
