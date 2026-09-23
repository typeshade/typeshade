// ═══ Capability-reachability ratchet (X-GIS #1681 A3) ═══
//
// A `Capability` is a PROMISE to an author: declare it (or write the shape that derives
// it) and the DSL will let you use the feature. Three of the nine keep only half of that
// promise — the declaration rides in `enables`, a `capProfile` row accepts it, the
// emitted source even carries a directive, and there is NOTHING an author can then
// write that uses it:
//
//   f16        `enable f16;` on WGSL, but `Scalar` is f32|i32|u32|bool (ir/types.ts:9)
//              and every scalar/vector/matrix type keys off it, so no f16 VALUE can be
//              declared. On WebGPU this is worse than a no-op: `enable f16;` requires
//              the `shader-f16` device feature, so a module that enables it and uses
//              nothing can FAIL pipeline creation on a device that lacks it.
//   subgroups  same shape — `enable subgroups;` and not one subgroup intrinsic behind it.
//   multiview  emits `#extension GL_OVR_multiview2 : require` and renders SINGLE-VIEW:
//              neither `layout(num_views = N) in;` nor `gl_ViewID_OVR` is authorable.
//
// This gate turns that from prose scattered across three doc comments into DATA. Every
// capability names a WITNESS — the concrete thing that lets an author actually USE it —
// and the witness is RESOLVED against the real surface: a module shape is fed to the
// real `requiredCaps`, a type constant is looked up on the real `core/ir` barrel and
// spelled by a real backend, an intrinsic id is looked up in the real registry, a
// `@builtin` id is driven through a real GLSL emit. Nothing here resolves against a
// string this file also owns — a hardcoded list would prove only that the list exists.
//
// SHRINK-ONLY IN BOTH DIRECTIONS, the earth-literal-ratchet contract
// (shared/src/earth-literal-ratchet.test.ts):
//   - a capability whose witness does NOT resolve and is not allowlisted → RED;
//   - an allowlisted capability whose witness DOES resolve → RED, so the entry must be
//     deleted in the same commit that made the cap reachable.
// A NEW capability cannot slip past either: `WITNESSES` is `Record<Capability, Witness>`,
// so adding a union member without a witness fails `tsc -p shader-dsl/tsconfig.tests.json`
// (the second half of `bun run build`), and the new entry then has to resolve or be
// allowlisted with a reason.
//
// NON-VACUITY (X-GIS #996 / CLAUDE.md §12 — "the authority itself is seen"): the resolver is
// probed per kind with BOTH a known-good and a known-bad witness, so a resolver that
// broke into always-true or always-false cannot carry the two ratchet arms above.

import { describe, it, expect } from 'vitest'
import * as IR from '../ir/index.js'
import {
  module,
  fn,
  vec4,
  f32T,
  u32T,
  vec4fT,
  texture2dMsfT,
  arrayT,
  type Capability,
  type DeclarableCapability,
  type ModuleDecl,
  type ShaderType,
} from '../ir/index.js'
import { isKnownIntrinsic } from '../intrinsics.js'
import { requiredCaps } from '../passes/required-caps.js'
import { reflect } from '../reflect.js'
import { emitModule, wgslBackend } from './wgsl.js'
import { emitGlslModule, glslEs300Backend } from './glsl.js'
import { compile } from '../../compiler/ts/compile.js'
import { ALL_CAPABILITIES } from '../ir/nodes.js'

// ── The probe module: the smallest thing that emits on BOTH backends ──
const fragProbe = (enables?: readonly DeclarableCapability[]): ModuleDecl =>
  module({
    enables,
    funcs: [
      fn('fs_probe', {}, () => vec4(1, 0, 0, 1), { stage: 'fragment', retAttr: '@location(0)' }),
    ],
  })

/** The probe with ONE entry param carrying `@builtin(<id>)`. Every entry param goes
 *  through the GLSL writer's `builtinInRead` whether the body reads it or not
 *  (backends/glsl.ts — main() gathers each param before the call), so an unmapped
 *  builtin throws here rather than silently emitting nothing. */
const builtinProbe = (id: string): ModuleDecl => {
  const base = fragProbe()
  return {
    ...base,
    funcs: base.funcs.map((f) => ({
      ...f,
      params: [{ name: 'probe', type: u32T, builtin: id, attr: `@builtin(${id})` }],
    })),
  }
}

// ── Witness kinds ──
//
// Each names a DIFFERENT authoring surface, and each resolves by asking that surface,
// never by consulting a table in this file.
type Witness =
  /** A module SHAPE the author writes; resolves iff the real `requiredCaps` derives the
   *  capability from it. The witness for the three DERIVED caps. */
  | { readonly kind: 'moduleShape'; readonly what: string; readonly build: () => ModuleDecl }
  /** A `ShaderType` constant on the public `core/ir` barrel (`f32T`, `u32T`, …) — the
   *  thing an author needs before a VALUE of the capability's type can exist. Resolves
   *  iff the export is there AND a real backend can spell it. */
  | { readonly kind: 'typeConstant'; readonly id: string }
  /** An intrinsic id that must exist in the real registry (`core/intrinsics.ts`). */
  | { readonly kind: 'intrinsic'; readonly id: string }
  /** A `@builtin(<id>)` an entry may read; resolves iff a real GLSL emit accepts it. */
  | { readonly kind: 'builtin'; readonly id: string }
  /** "Host-side only, nothing to author" — the capability changes what the DEVICE can
   *  do, not what the source may spell, so the WHOLE authoring surface is: declare it and
   *  the host learns of it. Resolves iff some backend carries the cap with NO directive
   *  (zero emitted bytes), `reflect().requiredFeatures` reports it, and the emit really is
   *  byte-identical to the enables-free one. A cap whose row carries a directive fails
   *  this by construction — which is what stops `hostOnly` becoming a rubber stamp. */
  | { readonly kind: 'hostOnly'; readonly cap: DeclarableCapability }

const hostOnly = (cap: DeclarableCapability): Witness => ({ kind: 'hostOnly', cap })

/** Human-readable identity of a witness — used in the failure messages so the report
 *  names the missing surface, not merely the capability. */
const describeWitness = (w: Witness): string => {
  switch (w.kind) {
    case 'moduleShape':
      return `module shape: ${w.what}`
    case 'typeConstant':
      return `ShaderType constant \`${w.id}\` on core/ir`
    case 'intrinsic':
      return `intrinsic \`${w.id}\` in the registry`
    case 'builtin':
      return `@builtin(${w.id}) readable by an entry`
    case 'hostOnly':
      return `host-side only (declare \`${w.cap}\` → reflect().requiredFeatures), nothing to author`
  }
}

// ── The resolvers — every one asks the REAL surface ──

const resolveModuleShape = (cap: Capability, build: () => ModuleDecl): boolean =>
  requiredCaps(build()).includes(cap)

const resolveTypeConstant = (id: string): boolean => {
  const v = (IR as unknown as Record<string, unknown>)[id]
  if (v === undefined || typeof v !== 'object' || v === null || !('kind' in v)) return false
  try {
    return wgslBackend.typeName(v as ShaderType).length > 0
  } catch {
    return false
  }
}

const resolveBuiltin = (id: string): boolean => {
  try {
    return emitGlslModule(builtinProbe(id), 'fragment').length > 0
  } catch {
    return false
  }
}

const resolveHostOnly = (cap: DeclarableCapability): boolean => {
  // A backend that SUPPORTS the cap and spends no source bytes on it. `directive`
  // present ⇒ the feature does have a source token, so "nothing to author" is a lie.
  const zeroCost = [glslEs300Backend, wgslBackend].find(
    (be) => be.capProfile[cap] !== undefined && be.capProfile[cap]?.directive === undefined,
  )
  if (zeroCost === undefined) return false
  const emitOn = (m: ModuleDecl): string =>
    zeroCost === wgslBackend ? emitModule(m) : emitGlslModule(m, 'fragment')
  try {
    // The host must LEARN of it (that is the entire surface) …
    if (!reflect(fragProbe([cap])).requiredFeatures.includes(cap)) return false
    // … and declaring it must move zero bytes.
    return emitOn(fragProbe([cap])) === emitOn(fragProbe())
  } catch {
    return false
  }
}

const resolve = (cap: Capability, w: Witness): boolean => {
  switch (w.kind) {
    case 'moduleShape':
      return resolveModuleShape(cap, w.build)
    case 'typeConstant':
      return resolveTypeConstant(w.id)
    case 'intrinsic':
      return isKnownIntrinsic(w.id)
    case 'builtin':
      return resolveBuiltin(w.id)
    case 'hostOnly':
      return resolveHostOnly(w.cap)
  }
}

// ── THE WITNESS TABLE ──
//
// Total over `Capability` by TYPE: a new union member with no entry here is a compile
// error, which is the half of the shrink-only contract a runtime scan cannot provide
// (the union has no runtime enumeration).
const WITNESSES: Readonly<Record<Capability, Witness>> = {
  // ── DERIVED resource caps — the witness is the module SHAPE requiredCaps reads. ──
  storageBuffer: {
    kind: 'moduleShape',
    what: "a binding with space 'storage'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'data',
          space: 'storage',
          access: 'read',
          type: arrayT(f32T),
        },
      ],
      funcs: [],
    }),
  },
  compute: {
    kind: 'moduleShape',
    what: "a func with stage 'compute'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'cs_probe',
          stage: 'compute',
          workgroupSize: 64,
          params: [],
          ret: { kind: 'void' },
          body: [],
        },
      ],
    }),
  },
  msaaTextureLoad: {
    kind: 'moduleShape',
    what: "a texture binding with dim '2d-ms'",
    build: () => ({
      consts: [],
      structs: [],
      // `AddressSpace` is uniform|storage; a texture binding rides the uniform space
      // (the resource kind lives in `type`, which is what requiredCaps reads).
      bindings: [{ group: 0, binding: 0, name: 'src', space: 'uniform', type: texture2dMsfT }],
      funcs: [],
    }),
  },
  storageTexture: {
    kind: 'moduleShape',
    what: "a binding whose type kind is 'storage-texture'",
    build: () => ({
      consts: [],
      structs: [],
      // A storage texture rides the uniform space the same way a sampled one does: it is a
      // handle, and the resource kind lives in `type`, which is what requiredCaps reads.
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'dst',
          space: 'uniform',
          type: { kind: 'storage-texture', dim: '2d', format: 'rgba8unorm', access: 'write' },
        },
      ],
      funcs: [],
    }),
  },

  // #147: the one storage FORMAT that is not core. Its witness is the same module shape with
  // `bgra8unorm` written where `rgba8unorm` is above, because the format is what requiredCaps
  // reads for this cap.
  bgra8unormStorage: {
    kind: 'moduleShape',
    what: "a storage-texture binding whose format is 'bgra8unorm'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'dst',
          space: 'uniform',
          type: { kind: 'storage-texture', dim: '2d', format: 'bgra8unorm', access: 'write' },
        },
      ],
      funcs: [],
    }),
  },

  // Roadmap 0.4 item 12: a 1d or cube-array texture binding, and a textureGather call. Each is
  // derived from the module's shape, so each resolves through the real requiredCaps.
  texture1d: {
    kind: 'moduleShape',
    what: "a texture binding with dim '1d'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'ramp',
          space: 'uniform',
          type: { kind: 'texture', dim: '1d', elem: 'f32' },
        },
      ],
      funcs: [],
    }),
  },
  textureCubeArray: {
    kind: 'moduleShape',
    what: "a texture binding with dim 'cube-array'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'envs',
          space: 'uniform',
          type: { kind: 'texture', dim: 'cube-array', elem: 'f32' },
        },
      ],
      funcs: [],
    }),
  },
  textureGather: {
    kind: 'moduleShape',
    what: 'a call to textureGather in a function body',
    build: () => ({
      consts: [],
      structs: [],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'atlas',
          space: 'uniform',
          type: { kind: 'texture', dim: '2d', elem: 'f32' },
        },
        { group: 0, binding: 1, name: 'smp', space: 'uniform', type: { kind: 'sampler' } },
      ],
      funcs: [
        {
          name: 'gather_probe',
          params: [],
          ret: { kind: 'vec', n: 4, elem: 'f32' },
          body: [
            {
              s: 'return',
              expr: {
                op: 'call',
                type: { kind: 'vec', n: 4, elem: 'f32' },
                fn: 'textureGather',
                args: [
                  { op: 'lit', type: { kind: 'scalar', scalar: 'i32' }, value: 0 },
                  {
                    op: 'varref',
                    type: { kind: 'texture', dim: '2d', elem: 'f32' },
                    name: 'atlas',
                  },
                  { op: 'varref', type: { kind: 'sampler' }, name: 'smp' },
                  { op: 'lit', type: { kind: 'vec', n: 2, elem: 'f32' }, value: 0 },
                ],
              },
            },
          ],
        },
      ],
    }),
  },

  // #152: the packed 4x8 integer family, derived from a call the same way textureGather is.
  packed4x8Dot: {
    kind: 'moduleShape',
    what: 'a call to dot4U8Packed in a function body',
    build: () => ({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'packed_probe',
          params: [],
          ret: { kind: 'scalar', scalar: 'u32' },
          body: [
            {
              s: 'return',
              expr: {
                op: 'call',
                type: { kind: 'scalar', scalar: 'u32' },
                fn: 'dot4U8Packed',
                args: [
                  { op: 'lit', type: { kind: 'scalar', scalar: 'u32' }, value: 0x01010101 },
                  { op: 'lit', type: { kind: 'scalar', scalar: 'u32' }, value: 0x01010101 },
                ],
              },
            },
          ],
        },
      ],
    }),
  },

  // ── OPT-IN caps whose whole surface is host activation. ──
  floatRenderTarget: hostOnly('floatRenderTarget'),
  float32Blend: hostOnly('float32Blend'),
  float32Filterable: hostOnly('float32Filterable'),

  // ── OPT-IN caps that promise an AUTHORING surface. ──
  // f16 needs a value type before anything can be f16: the repo's scalar constants are
  // `f32T` / `i32T` / `u32T` / `boolT`, so the missing one is `f16T` (and, behind it, an
  // `'f16'` member of `Scalar` — ir/types.ts:9 — that every vector/matrix arm keys off).
  f16: { kind: 'typeConstant', id: 'f16T' },
  // subgroups stopped being intrinsic-only when the two subgroup BUILT-IN VALUES gained
  // their stage rules and their derived capability (§50): `@builtin(subgroup_invocation_id)`
  // on a compute or fragment entry emits `enable subgroups;` and reports the host feature,
  // with no subgroup intrinsic anywhere. That is a source witness, so the witness is the
  // module shape — the same kind the other two extension-gated ids use. The intrinsic family
  // (`subgroupAdd`, `subgroupBallot`, …) is still absent and is still a separate debt, but
  // it is no longer what makes the CAPABILITY reachable.
  subgroups: {
    kind: 'moduleShape',
    what: "an entry parameter with builtin 'subgroup_invocation_id'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'fs_probe',
          stage: 'fragment',
          params: [
            {
              name: 'sid',
              type: u32T,
              attr: '@builtin(subgroup_invocation_id)',
              builtin: 'subgroup_invocation_id',
            },
          ],
          ret: vec4fT,
          body: [],
        },
      ],
    }),
  },
  // The two extension-gated BUILT-IN VALUES (§50). The witness is the module SHAPE, not the
  // `builtin` kind above: that one resolves through a GLSL emit, and neither id has any GLSL
  // ES 3.00 mapping — the whole point of the capability is that the module fails closed
  // there. What makes each reachable is that spelling the id derives the cap, which is what
  // `requiredCaps` is asked here.
  clipDistances: {
    kind: 'moduleShape',
    what: "a struct field with builtin 'clip_distances'",
    build: () => ({
      consts: [],
      structs: [
        {
          name: 'VsOut',
          fields: [
            { name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' },
            {
              name: 'cd',
              type: arrayT(f32T, 4),
              attr: '@builtin(clip_distances)',
              builtin: 'clip_distances',
            },
          ],
        },
      ],
      bindings: [],
      funcs: [],
    }),
  },
  primitiveIndex: {
    kind: 'moduleShape',
    what: "an entry parameter with builtin 'primitive_index'",
    build: () => ({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'fs_probe',
          stage: 'fragment',
          params: [
            {
              name: 'pi',
              type: u32T,
              attr: '@builtin(primitive_index)',
              builtin: 'primitive_index',
            },
          ],
          ret: vec4fT,
          body: [],
        },
      ],
    }),
  },
  // Dual-source blending (§53): the witness is the module SHAPE, like the two extension-gated
  // built-in values above — `@blend_src` on a fragment output derives the capability, because
  // WGSL refuses the attribute without `enable dual_source_blending;`.
  dualSourceBlending: {
    kind: 'moduleShape',
    what: 'a struct field with blendSrc set',
    build: () => ({
      consts: [],
      structs: [
        {
          name: 'Out',
          fields: [
            {
              name: 'a',
              type: vec4fT,
              attr: '@location(0) @blend_src(0)',
              location: 0,
              blendSrc: 0,
            },
            {
              name: 'b',
              type: vec4fT,
              attr: '@location(0) @blend_src(1)',
              location: 0,
              blendSrc: 1,
            },
          ],
        },
      ],
      bindings: [],
      funcs: [],
    }),
  },
  // multiview needs BOTH halves: a per-view id to read (`gl_ViewID_OVR`, which this DSL
  // would spell `@builtin(view_index)`) and the `layout(num_views = N) in;` qualifier.
  // The builtin is the half a witness can resolve mechanically; the qualifier has no
  // authoring surface at all, so a resolving witness here is necessary, not sufficient.
  multiview: { kind: 'builtin', id: 'view_index' },
}

/** Capabilities that are KNOWINGLY unreachable — declarable, gated, directive-emitting,
 *  and with nothing behind them. Each entry is a debt with a reason and an issue, not a
 *  waiver: the arms below fail if one becomes reachable and the entry survives. */
const UNREACHABLE_ALLOWLIST: Readonly<Partial<Record<Capability, string>>> = {
  // X-GIS #1681 A3 — `enable f16;` emits on WGSL, but `Scalar` (ir/types.ts:9) is
  // f32|i32|u32|bool and every scalar/vector/matrix type keys off it, so no f16 value
  // can be declared, passed, or returned. Reachable only once `Scalar` gains 'f16' and
  // the type constants / promotion rules follow.
  f16: 'no f16 value type — Scalar is f32|i32|u32|bool (ir/types.ts:9) — X-GIS #1681',
  // X-GIS #1681 A3 — the GLSL row emits `#extension GL_OVR_multiview2 : require` and the
  // module still renders SINGLE-VIEW: `layout(num_views = N) in;` is unspellable and
  // `gl_ViewID_OVR` has no `@builtin` mapping. The cap exists to prove the `#extension`
  // path end to end (backends/glsl.ts GLSL_CAP_PROFILE says so in its own comment), and
  // this entry is the machine-checked version of that admission.
  multiview: 'directive-only — no gl_ViewID_OVR / num_views authoring surface — X-GIS #1681',
}

describe('capability reachability (X-GIS #1681 A3)', () => {
  // ── NON-VACUITY (X-GIS #996) — the resolver SEES a known-good witness of every kind, and
  // does NOT see a known-bad one. Without both halves a resolver stuck at true would
  // green the ratchet arm and one stuck at false would green the allowlist arm.
  it('resolver sanity — every witness kind distinguishes a real surface from a missing one', () => {
    const probes: ReadonlyArray<readonly [string, Capability, Witness, boolean]> = [
      // moduleShape: the shape that DOES derive the cap vs a module without it.
      // The + probe builds its OWN storage binding rather than reusing
      // `WITNESSES.storageBuffer`. Sharing the table's entry here would make this arm red
      // for two different reasons — a broken RESOLVER and a broken WITNESS — and the whole
      // job of this arm is to tell those apart, so the failure message can name the
      // severed half (CLAUDE.md §12). Every other probe below is already self-contained;
      // this one was the exception.
      [
        'moduleShape +',
        'storageBuffer',
        {
          kind: 'moduleShape',
          what: "a module carrying a binding with space 'storage'",
          build: () => ({
            consts: [],
            structs: [],
            bindings: [
              {
                group: 0,
                binding: 0,
                name: 'probe_data',
                space: 'storage',
                access: 'read',
                type: arrayT(f32T),
              },
            ],
            funcs: [],
          }),
        },
        true,
      ],
      [
        'moduleShape -',
        'storageBuffer',
        {
          kind: 'moduleShape',
          what: 'a module with no storage binding',
          build: () => fragProbe(),
        },
        false,
      ],
      // typeConstant: a scalar constant that really is exported vs one that never was.
      ['typeConstant +', 'f16', { kind: 'typeConstant', id: 'f32T' }, true],
      ['typeConstant -', 'f16', { kind: 'typeConstant', id: 'f128T' }, false],
      // intrinsic: a registry id vs a nonexistent one.
      ['intrinsic +', 'subgroups', { kind: 'intrinsic', id: 'sin' }, true],
      ['intrinsic -', 'subgroups', { kind: 'intrinsic', id: 'notAnIntrinsic' }, false],
      // builtin: one the GLSL writer maps vs one it does not.
      ['builtin +', 'multiview', { kind: 'builtin', id: 'front_facing' }, true],
      ['builtin -', 'multiview', { kind: 'builtin', id: 'not_a_builtin' }, false],
      // hostOnly: a genuinely zero-byte cap vs one whose row carries a directive (f16 on
      // WGSL) — "nothing to author" must not be satisfiable by a cap with a source token.
      ['hostOnly +', 'floatRenderTarget', hostOnly('floatRenderTarget'), true],
      ['hostOnly -', 'f16', hostOnly('f16'), false],
    ]
    expect(
      probes
        .filter(([, cap, w, want]) => resolve(cap, w) !== want)
        .map(([label]) => label)
        .sort(),
      'The witness RESOLVER is broken — it no longer distinguishes a present authoring ' +
        'surface from an absent one, so both ratchet arms below are vacuous. Fix the ' +
        'resolver (or the probe, if the surface it names legitimately moved) before ' +
        'trusting anything else in this file.',
    ).toEqual([])
  })

  // ── The witness table is not stale (X-GIS #996's companion assertion) ──
  it('every witnessed capability is one a backend actually profiles', () => {
    const profiled = new Set<string>([
      ...Object.keys(glslEs300Backend.capProfile),
      ...Object.keys(wgslBackend.capProfile),
    ])
    expect(
      Object.keys(WITNESSES)
        .filter((c) => !profiled.has(c))
        .sort(),
      'Capability with a witness here but NO row in either backend capProfile — the ' +
        'cap is unsupported everywhere and the witness is pointing at nothing. Delete ' +
        'the capability, or give some backend a row.',
    ).toEqual([])
  })

  // ── ARM 1 — no unreachable capability outside the allowlist ──
  it('every capability outside the allowlist has a witness that RESOLVES', () => {
    const unreachable = (Object.keys(WITNESSES) as Capability[])
      .filter((c) => UNREACHABLE_ALLOWLIST[c] === undefined)
      .filter((c) => !resolve(c, WITNESSES[c]))
      .map((c) => `${c} (witness: ${describeWitness(WITNESSES[c])})`)
      .sort()
    expect(
      unreachable,
      'Capability an author can DECLARE but cannot USE — its witness does not resolve ' +
        'against the real surface. That is not a harmless no-op: on WebGPU an `enable`d ' +
        'feature is a device requirement, so a module that enables it and uses nothing ' +
        'can fail pipeline creation on a device that lacks it. Build the authoring ' +
        'surface the witness names instead; if the capability is genuinely principled ' +
        'without one, add it to UNREACHABLE_ALLOWLIST here, in this commit, with a ' +
        'rationale and an issue number.',
    ).toEqual([])
  })

  // ── ARM 2 — the allowlist only shrinks ──
  it('an allowlisted capability that BECAME reachable must lose its entry', () => {
    const stale = (Object.keys(UNREACHABLE_ALLOWLIST) as Capability[])
      .filter((c) => resolve(c, WITNESSES[c]))
      .sort()
    expect(
      stale,
      'Allowlisted capability is now REACHABLE — its witness resolves. Delete the ' +
        'UNREACHABLE_ALLOWLIST entry in the SAME commit that made it reachable; this ' +
        'ratchet shrinks in both directions, so a stale exemption is a failure, not slack.',
    ).toEqual([])
  })

  // ── The allowlist entries must be reasons, not placeholders ──
  it('every allowlist entry states a reason and cites an issue', () => {
    expect(
      Object.entries(UNREACHABLE_ALLOWLIST)
        .filter(([, reason]) => reason === undefined || !/#\d+/.test(reason))
        .map(([cap]) => cap)
        .sort(),
      'UNREACHABLE_ALLOWLIST entry with no issue number — an exemption nobody can trace ' +
        'is an exemption nobody will remove.',
    ).toEqual([])
  })
})

// ═══ S3 — a `"use typeshade"` SOURCE witness per capability ═══
//
// The arms above prove the BACKEND profiles each capability: a module shape, a type constant,
// an intrinsic id or a `@builtin` id resolves against the real surface. That is a statement
// about the IR, and the IR is not the surface most authors write. The spec audit of
// 2026-09-21 (#144, tests-critique S3) asked the next question: can a capability be reached
// from `"use typeshade"` SOURCE, and does `reflect().requiredFeatures` then name it — which is
// what the host reads to decide whether to request the device feature.
//
// Twelve of the eighteen can. The other six are listed with a reason, and — where a program
// could exist at all — with the very program that will become the witness once the gap closes,
// so the list shrinks by measurement rather than by anyone remembering to look. It was seven of
// thirteen until #164 added `packed4x8Dot` and `bgra8unormStorage` and #146 added
// `clipDistances`, `primitiveIndex` and `dualSourceBlending` — all five reachable, and the
// claims-every-capability arm is what caught each time that they were unaccounted for.

/** A capability an author can reach by writing a program, and the program. Each is compiled
 *  below and `reflect().requiredFeatures` must name the capability. */
const SOURCE_WITNESSES: Readonly<Partial<Record<Capability, string>>> = {
  // The three #146 added (§50) are each derived from a `@builtin(...)` id or an attribute an
  // author WRITES, so all three are reachable and belong here rather than on the list below.
  // Measured: `reflect().requiredFeatures` is exactly `["clipDistances"]`, `["primitiveIndex"]`
  // and `["dualSourceBlending"]` for these three programs.
  clipDistances: `"use typeshade";
class Clip {
  @builtin("position") pos: vec4;
  @builtin("clip_distances") cd: array<f32, 4>;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  return { pos: vec4(0., 0., 0., 1.), cd: array<f32, 4>(1., 1., 1., 1.) };
}
`,
  primitiveIndex: `"use typeshade";
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V, @builtin("primitive_index") pi: u32): vec4 {
  return vec4(f32(pi), 0., 0., 1.);
}
`,
  // Not a builtin id but an ATTRIBUTE pair: two `@location(0)` outputs distinguished by
  // `@blend_src`, which is the shape WGSL gives dual-source blending (#158, §53).
  dualSourceBlending: `"use typeshade";
class Dual {
  @location(0) @blend_src(0) a: vec4;
  @location(0) @blend_src(1) b: vec4;
}
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): Dual {
  const c = vec4(v.uv, 0., 1.);
  return { a: c, b: c };
}
`,
  // Both arrived with #164 and both are reachable, so they are witnesses rather than entries on
  // the list below: measured, `reflect().requiredFeatures` is exactly `["packed4x8Dot"]` for the
  // first and includes `"bgra8unormStorage"` for the second.
  packed4x8Dot: `"use typeshade";
interface U {
  a: u32;
  b: u32;
}
declare const u: uniform<U>;
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  const d = dot4U8Packed(u.a, u.b);
  return vec4(f32(d), 0., 0., 1.);
}
`,
  // The format is part of the TYPE, so the capability is reached by declaring the binding —
  // there is no builtin to call for it.
  bgra8unormStorage: `"use typeshade";
declare const dst: texture_storage_2d<"bgra8unorm", "write">;
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  textureStore(dst, vec2i(0, 0), vec4(1., 0., 0., 1.));
}
`,
  storageBuffer: `"use typeshade";
declare let out: storage<array<f32>>;
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = 1.;
}
`,
  compute: `"use typeshade";
declare let out: storage<array<f32>>;
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = 1.;
}
`,
  msaaTextureLoad: `"use typeshade";
declare const ms: texture_multisampled_2d<f32>;
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return textureLoad(ms, vec2i(0, 0), 0);
}
`,
  storageTexture: `"use typeshade";
declare const dst: texture_storage_2d<"rgba8unorm", "write">;
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  textureStore(dst, vec2i(0, 0), vec4(1., 0., 0., 1.));
}
`,
  texture1d: `"use typeshade";
declare const ramp: texture_1d<f32>;
declare const smp: sampler;
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return textureSampleLevel(ramp, smp, v.uv.x, 0.);
}
`,
  textureCubeArray: `"use typeshade";
declare const envs: texture_cube_array<f32>;
declare const smp: sampler;
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return textureSampleLevel(envs, smp, vec3(0., 0., 1.), 0, 0.);
}
`,
  textureGather: `"use typeshade";
declare const atlas: texture_2d<f32>;
declare const smp: sampler;
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return textureGather(0, atlas, smp, v.uv);
}
`,
}

/** A capability no `"use typeshade"` program reaches today. `probe` is the program that WILL
 *  be the witness once the gap closes — it is compiled below and must still fail, so an entry
 *  cannot outlive its reason. A host-only capability has no probe by construction: nothing in
 *  a module implies it, which is what `hostOnly` means in the witness table above. */
const NO_SOURCE_WITNESS: Readonly<
  Partial<Record<Capability, { readonly reason: string; readonly probe?: string }>>
> = {
  f16: {
    reason:
      'no f16 value type — `Scalar` is f32|i32|u32|bool (ir/types.ts); deferred by docs/roadmap.md:245 (After 1.0) and filed as #153',
    probe: `"use typeshade";
export function f(): f32 {
  const a: f16 = 1.;
  return f32(a);
}
`,
  },
  subgroups: {
    reason:
      'no subgroup intrinsic in the registry; docs/roadmap.md:247 "A WebGPU extension with no WebGL2 equivalent and no oracle meaning yet"',
    probe: `"use typeshade";
export function f(x: f32): f32 {
  return subgroupAdd(x);
}
`,
  },
  multiview: {
    reason:
      'directive-only — `@builtin("view_index")` has no spelling and `layout(num_views = N) in;` none at all; the builtin half rides #146',
    probe: `"use typeshade";
class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("view_index") vi: u32): Clip {
  return { pos: vec4(f32(vi), 0., 0., 1.) };
}
`,
  },
  // The three host-only capabilities. A device feature that changes what a FORMAT can do is
  // not implied by anything in a shader: the same module is valid with and without it, so
  // there is no program to write. `hostOnly` in the witness table above says the same thing.
  floatRenderTarget: {
    reason: 'host-only: a device feature about the render-target FORMAT, which no module implies',
  },
  float32Blend: {
    reason: 'host-only: a device feature about BLENDING an f32 target, which no module implies',
  },
  float32Filterable: {
    reason: 'host-only: a device feature about FILTERING an f32 texture, which no module implies',
  },
}

describe('every capability has a "use typeshade" source witness (S3)', () => {
  it('claims every capability exactly once, as reachable from source or as not', () => {
    const unclaimed = ALL_CAPABILITIES.filter(
      (cap) => !(cap in SOURCE_WITNESSES) && !(cap in NO_SOURCE_WITNESS),
    )
    expect(unclaimed).toEqual([])
    const both = ALL_CAPABILITIES.filter(
      (cap) => cap in SOURCE_WITNESSES && cap in NO_SOURCE_WITNESS,
    )
    expect(both).toEqual([])
  })

  it('compiles every source witness clean, and reflect().requiredFeatures names the capability', () => {
    const wrong: string[] = []
    for (const [cap, src] of Object.entries(SOURCE_WITNESSES)) {
      const result = compile(src)
      const errors = result.diagnostics.filter((d) => d.category === 'error')
      if (errors.length > 0) {
        wrong.push(`${cap}: ${errors[0]?.message ?? ''}`)
        continue
      }
      if (result.module === undefined) {
        wrong.push(`${cap}: compiled with no module`)
        continue
      }
      const features = reflect(result.module).requiredFeatures
      if (!features.includes(cap as Capability)) {
        wrong.push(`${cap}: requiredFeatures is ${JSON.stringify(features)}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('loses the NO_SOURCE_WITNESS entry of a capability an author can now reach', () => {
    // Shrink-only by measurement: the probe is the program the entry says cannot be written.
    const reachable: string[] = []
    for (const [cap, entry] of Object.entries(NO_SOURCE_WITNESS)) {
      if (entry.probe === undefined) continue
      const result = compile(entry.probe)
      const errors = result.diagnostics.filter((d) => d.category === 'error')
      if (errors.length === 0) reachable.push(cap)
    }
    expect(
      reachable,
      'This capability now compiles from source — move it to SOURCE_WITNESSES in the same ' +
        'commit, so the host learns it needs the device feature.',
    ).toEqual([])
  })

  it('states a reason that cites an issue, a roadmap row or the host-only rule', () => {
    const vague = Object.entries(NO_SOURCE_WITNESS)
      .filter(([, entry]) => !/#\d+|roadmap|host-only/.test(entry.reason))
      .map(([cap]) => cap)
    expect(vague).toEqual([])
  })
})
