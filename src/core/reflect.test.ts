import { describe, it, expect } from 'vitest'
import { wgslLayout, reflect } from './reflect.js'
import {
  mat4x4fT,
  vec4fT,
  vec3fT,
  f32T,
  f64T,
  u32T,
  texture2dfT,
  texture2dMsfT,
  texture2dArrayfT,
  texture2duT,
  texture2diT,
  texture2dArrayuT,
  samplerT,
  samplerComparisonT,
  fn,
  module,
  vec4,
  toF32,
  type StructDecl,
  type ModuleDecl,
  type ShaderType,
} from './ir/index.js'
import { uniformStruct } from './sot.js'

const struct = (
  name: string,
  fields: [string, StructDecl['fields'][number]['type']][],
): StructDecl => ({ name, fields: fields.map(([n, t]) => ({ name: n, type: t })) })

describe('wgslLayout — std140 / std430 offset engine', () => {
  it('anchors to the shipping point Uniforms offsets (mat4x4 + 5×vec4 = 144 bytes)', () => {
    // These offsets are the contract runtime/.../point-uniform-layout.test.ts asserts
    // against the shipping CPU packer (slot×4 = byte): mvp@0 proj@16 viewport@20 … size 36 slots.
    const U = struct('Uniforms', [
      ['mvp', mat4x4fT],
      ['proj_params', vec4fT],
      ['viewport', vec4fT],
      ['cam_ecef_h', vec4fT],
      ['cam_ecef_l', vec4fT],
      ['circle_params', vec4fT],
    ])
    const L = wgslLayout(U, 'std140')
    expect(Object.fromEntries(L.fields.map((f) => [f.name, f.offset]))).toEqual({
      mvp: 0,
      proj_params: 64,
      viewport: 80,
      cam_ecef_h: 96,
      cam_ecef_l: 112,
      circle_params: 128,
    })
    expect(L.size).toBe(144)
    expect(L.align).toBe(16)
  })

  it('vec3 has align 16 / size 12 (the classic std140 trap)', () => {
    const S = struct('S', [
      ['a', f32T],
      ['b', vec3fT],
      ['c', f32T],
    ])
    const L = wgslLayout(S, 'std140')
    expect(L.fields.map((f) => f.offset)).toEqual([0, 16, 28]) // a@0, b aligns to 16, c@28
    expect(L.size).toBe(32)
  })

  it('std140 rounds struct base alignment up to 16; std430 uses natural alignment', () => {
    const Inner = struct('Inner', [
      ['x', f32T],
      ['y', f32T],
    ])
    expect(wgslLayout(Inner, 'std140')).toMatchObject({ align: 16, size: 16 })
    expect(wgslLayout(Inner, 'std430')).toMatchObject({ align: 4, size: 8 })
  })

  it('f64 occupies its lowered vec2<f32> slot (8/8) — authored and lowered layouts agree', () => {
    const S = struct('S', [
      ['a', f32T], // @0
      ['origin', f64T], // aligns to 8 → @8, size 8 (hi, lo)
      ['b', f32T], // @16
    ])
    const L = wgslLayout(S, 'std140')
    expect(L.fields.map((f) => f.offset)).toEqual([0, 8, 16])
    // Hosts pack the pair with splitF64: hi at offset, lo at offset+4.
    expect(L.fields[1]).toMatchObject({ size: 8, align: 8 })
  })
})

describe('reflect — f64 vertex attribute', () => {
  it('an f64 @location param reflects as one 8-byte (vec2<f32>) attribute slot', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'vs',
          params: [
            { name: 'idx', type: u32T, builtin: 'vertex_index' },
            { name: 'pos_x', type: f64T, location: 0 },
            { name: 'weight', type: f32T, location: 1 },
          ],
          ret: { kind: 'void' },
          attrs: ['@vertex'],
          stage: 'vertex',
          body: [],
        },
      ],
    }
    const v = reflect(m).vertex!
    expect(v.attributes).toEqual([
      { name: 'pos_x', location: 0, type: 'f64', offset: 0 },
      { name: 'weight', location: 1, type: 'f32', offset: 8 },
    ])
    expect(v.arrayStride).toBe(12)
  })
})

describe('reflect — module metadata walker', () => {
  it('recovers bind groups, std140 uniform layout, and entry signatures', () => {
    const U = struct('Uniforms', [
      ['mvp', mat4x4fT],
      ['viewport', vec4fT],
    ])
    const m: ModuleDecl = {
      consts: [],
      structs: [U],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'u',
          space: 'uniform',
          type: { kind: 'struct', name: 'Uniforms' },
        },
      ],
      funcs: [
        { name: 'vs', params: [], ret: { kind: 'void' }, attrs: ['@vertex'], body: [] },
        {
          name: 'cs',
          params: [],
          ret: { kind: 'void' },
          attrs: ['@compute', '@workgroup_size(64)'],
          body: [],
        },
      ],
    }
    const r = reflect(m)
    expect(r.bindGroups).toEqual([
      {
        group: 0,
        entries: [
          {
            group: 0,
            binding: 0,
            name: 'u',
            space: 'uniform',
            resourceKind: 'uniform-buffer',
            owner: 'module',
            structName: 'Uniforms',
            // X-GIS #1906 — the entries here have empty bodies, so nothing reaches `u`.
            // `bindGroups` still lists it: empty is a fact, not a gap.
            stages: [],
          },
        ],
      },
    ])
    expect(r.uniforms[0]?.size).toBe(80) // mat4x4(64) + vec4(16)
    expect(r.entries.map((e) => e.stage)).toEqual(['vertex', 'compute'])
    expect(r.entries.find((e) => e.stage === 'compute')?.workgroupSize).toBe(64)
  })
})

// X-GIS #1651 — `resourceKind: 'texture'` alone under-describes a texture binding: a host
// creating the bind group needs the DIM to pick a 2d / 2d-array / multisampled view.
// textureDim is therefore set on EVERY texture entry (never "only when interesting" —
// that would make `undefined` mean both "a 2d texture" and "not a texture").
// X-GIS #1703 adds the second axis: dim alone still under-describes the binding, because a
// host must ALSO know whether the view is float or integer — WebGPU's sampleType must
// be 'uint'/'sint' and WebGL2 must back it with R32UI/R32I. textureElem carries the
// same always-set contract as textureDim, for the same reason.
describe('reflect — texture bind entries carry their dim (X-GIS #1651) and element (X-GIS #1703)', () => {
  it('sets textureDim + textureElem on every texture entry and on no other kind', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [
        { group: 0, binding: 0, name: 'flat_tex', space: 'uniform', type: texture2dfT },
        { group: 0, binding: 1, name: 'atlas', space: 'uniform', type: texture2dArrayfT },
        { group: 0, binding: 2, name: 'ms_tex', space: 'uniform', type: texture2dMsfT },
        { group: 0, binding: 3, name: 'samp', space: 'uniform', type: samplerT },
        { group: 0, binding: 4, name: 'ids', space: 'uniform', type: texture2duT },
        { group: 0, binding: 5, name: 'deltas', space: 'uniform', type: texture2diT },
        { group: 0, binding: 6, name: 'id_atlas', space: 'uniform', type: texture2dArrayuT },
      ],
      funcs: [],
    }
    // `stages: []` on every row: the fixture declares no entry point, so no stage
    // reaches any of these bindings (X-GIS #1906).
    expect(reflect(m).bindGroups[0]?.entries).toEqual([
      {
        group: 0,
        binding: 0,
        name: 'flat_tex',
        space: 'uniform',
        resourceKind: 'texture',
        owner: 'module',
        stages: [],
        textureDim: '2d',
        textureElem: 'f32',
      },
      {
        group: 0,
        binding: 1,
        name: 'atlas',
        space: 'uniform',
        resourceKind: 'texture',
        owner: 'module',
        stages: [],
        textureDim: '2d-array',
        textureElem: 'f32',
      },
      {
        group: 0,
        binding: 2,
        name: 'ms_tex',
        space: 'uniform',
        resourceKind: 'texture',
        owner: 'module',
        stages: [],
        textureDim: '2d-ms',
        textureElem: 'f32',
      },
      // the sampler entry carries NEITHER field — both are texture-only
      {
        group: 0,
        binding: 3,
        name: 'samp',
        space: 'uniform',
        resourceKind: 'sampler',
        owner: 'module',
        stages: [],
      },
      // X-GIS #1703 — the two axes are INDEPENDENT: same dim, different element, and the
      // array/integer combination reports both.
      {
        group: 0,
        binding: 4,
        name: 'ids',
        space: 'uniform',
        resourceKind: 'texture',
        owner: 'module',
        stages: [],
        textureDim: '2d',
        textureElem: 'u32',
      },
      {
        group: 0,
        binding: 5,
        name: 'deltas',
        space: 'uniform',
        resourceKind: 'texture',
        owner: 'module',
        stages: [],
        textureDim: '2d',
        textureElem: 'i32',
      },
      {
        group: 0,
        binding: 6,
        name: 'id_atlas',
        space: 'uniform',
        resourceKind: 'texture',
        owner: 'module',
        stages: [],
        textureDim: '2d-array',
        textureElem: 'u32',
      },
    ])
  })
})

describe('reflect() reports the bindings a LOWERING injects, not just the declared ones (X-GIS #1724)', () => {
  // The `_fp64` anti-fast-math guard is auto-injected by fp64Lower, inside emit. Before this,
  // the emitted source declared a binding reflect() did not report, so a host building its
  // bind group from the reflection never bound the guard the shader samples. On WebGPU that
  // is a validation error; on WebGL2 there is no error at all — the sampler stays on its
  // default unit and the guard silently reads a value that is not 1.0.
  const f64Module = () => {
    const U = uniformStruct('U', { group: 0, binding: 0, as: 'u' }, { epoch: f64T })
    return module({
      uses: [U],
      funcs: [
        // An ADD in df64 — one of the helpers that genuinely reads the guard (the
        // comparisons do not, which is why the injection is conditional).
        fn('fs', {}, () => vec4(toF32(U.field.epoch.add(1.0)), 0.0, 0.0, 1.0), {
          stage: 'fragment',
        }),
      ],
    })
  }

  it('reports `_fp64` for a module that uses f64 arithmetic', () => {
    const names = reflect(f64Module()).bindGroups.flatMap((g) => g.entries.map((e) => e.name))
    expect(names).toContain('_fp64')
  })

  it('describes it completely enough to actually bind', () => {
    // A name alone is not bindable. `resourceKind` + `textureDim` + `textureElem` are what a
    // host needs to create the 1x1 texture the guard requires.
    const e = reflect(f64Module())
      .bindGroups.flatMap((g) => g.entries)
      .find((x) => x.name === '_fp64')!
    expect(e).toMatchObject({ resourceKind: 'texture', textureDim: '2d', textureElem: 'f32' })
    expect(e.owner).toBe('module') // ours to create, not the host's to supply
  })

  it("reports NO guard for the 'integer' flavor, which never reads one", () => {
    // The arm that makes the two above mean something: if reflect() simply appended `_fp64`
    // to every f64 module, this would fail. It is the lowering's decision, and the lowering
    // makes a different one here — so a host on Apple/Metal (recommendFp64Flavor picks
    // 'integer') is told to bind exactly what that emit declares.
    const names = reflect(f64Module(), { fp64Flavor: 'integer' }).bindGroups.flatMap((g) =>
      g.entries.map((e) => e.name),
    )
    expect(names).not.toContain('_fp64')
    expect(names).toContain('u') // …and the module's own bindings are still all there
  })

  it('leaves a module without f64 completely untouched', () => {
    const U = uniformStruct('P', { group: 0, binding: 0, as: 'p' }, { k: f32T })
    const plain = module({
      uses: [U],
      funcs: [fn('fs', {}, () => vec4(U.field.k, 0.0, 0.0, 1.0), { stage: 'fragment' })],
    })
    expect(reflect(plain).bindGroups.flatMap((g) => g.entries.map((e) => e.name))).toEqual(['p'])
  })
})

// ═══ P1-23 of #155 — every handle kind the IR can hold, reflected ═══
//
// `reflect()` is what a host reads to build a bind group layout, and it is pinned at CORE level
// for three texture shapes only (2d, 2d-array, 2d-ms, each f32, plus one sampler). Every other
// handle — 1d, 3d, cube, cube array, the integer elements, the five depth dims, the storage
// textures at three access modes, the comparison sampler — is pinned only through a compiler
// suite, where the front end sits in between. So a `reflect()` change the front end happens to
// mask (a dropped field, a renamed access spelling) passes everything.
//
// This is the table, built from the IR type directly. `group`, `binding`, `name`, `space`,
// `owner` and `stages` are dropped from the comparison: they come from the binding, not from
// its TYPE, and the arms above already pin them.
describe('reflect — every handle kind the IR can hold', () => {
  const entryFor = (type: ShaderType): Record<string, unknown> => {
    const m = {
      consts: [],
      structs: [],
      bindings: [{ group: 0, binding: 0, name: 'h', space: 'uniform', type }],
      funcs: [],
    } as unknown as ModuleDecl
    const entry = reflect(m).bindGroups[0]?.entries[0] as unknown as Record<string, unknown>
    const { group, binding, name, space, owner, stages, ...rest } = entry
    // The six `void`s satisfy `noUnusedLocals`: the destructure exists to REMOVE those keys
    // from `rest`, not to read them, and the rest element is the only part used.
    void group
    void binding
    void name
    void space
    void owner
    void stages
    return rest
  }

  const sampled = (dim: string, elem: string): ShaderType =>
    ({ kind: 'texture', dim, elem }) as unknown as ShaderType
  const depth = (dim: string): ShaderType =>
    ({ kind: 'depth-texture', dim }) as unknown as ShaderType
  const storage = (dim: string, format: string, access: string): ShaderType =>
    ({ kind: 'storage-texture', dim, format, access }) as unknown as ShaderType

  const DIMS = ['1d', '2d', '2d-array', '3d', 'cube', 'cube-array', '2d-ms'] as const
  const ELEMS = ['f32', 'i32', 'u32'] as const

  it('carries the dim and the element of every sampled texture, for every pair', () => {
    const wrong: string[] = []
    for (const elem of ELEMS) {
      for (const dim of DIMS) {
        const got = entryFor(sampled(dim, elem))
        const want = { resourceKind: 'texture', textureDim: dim, textureElem: elem }
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          wrong.push(`${dim}<${elem}>: ${JSON.stringify(got)}`)
        }
      }
    }
    expect(wrong).toEqual([])
    // The floor: 21 pairs, so a `DIMS` or `ELEMS` that shrank to nothing cannot green the arm.
    expect(DIMS.length * ELEMS.length).toBe(21)
  })

  it('marks a depth texture by textureDepth and gives it NO element, on every dim', () => {
    // Deliberate, and the shape a host needs: WebGPU's `sampleType` for a depth binding is
    // 'depth', not a float/uint/sint the element would name.
    for (const dim of ['2d', '2d-array', 'cube', 'cube-array', '2d-ms'] as const) {
      expect(entryFor(depth(dim)), dim).toEqual({
        resourceKind: 'texture',
        textureDim: dim,
        textureDepth: true,
      })
    }
  })

  it('spells the storage access the way WebGPU does, at every access mode and dim', () => {
    // `read-only` appears in no other suite; the compiler tests reach write-only and
    // read-write only. The three spellings are the `GPUStorageTextureAccess` values a host
    // passes straight through to `createBindGroupLayout`.
    for (const dim of ['1d', '2d', '2d-array', '3d'] as const) {
      expect(entryFor(storage(dim, 'rgba8unorm', 'write')), dim).toEqual({
        resourceKind: 'storage-texture',
        textureDim: dim,
        storageFormat: 'rgba8unorm',
        storageAccess: 'write-only',
      })
      expect(entryFor(storage(dim, 'rgba8unorm', 'read')), dim).toEqual({
        resourceKind: 'storage-texture',
        textureDim: dim,
        storageFormat: 'rgba8unorm',
        storageAccess: 'read-only',
      })
      expect(entryFor(storage(dim, 'r32float', 'read_write')), dim).toEqual({
        resourceKind: 'storage-texture',
        textureDim: dim,
        storageFormat: 'r32float',
        storageAccess: 'read-write',
      })
    }
  })

  it('tells a comparison sampler from a filtering one, which is a different bind-group type', () => {
    expect(entryFor(samplerT)).toEqual({ resourceKind: 'sampler' })
    expect(entryFor(samplerComparisonT)).toEqual({
      resourceKind: 'sampler',
      samplerComparison: true,
    })
  })
})
