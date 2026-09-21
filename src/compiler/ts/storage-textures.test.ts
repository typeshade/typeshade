// Storage textures and `textureStore` (roadmap 0.4 item 10).
//
// An image a shader reads and writes by texel coordinate, with no sampler and no filtering.
// Its OWN IR kind rather than another `dim` on `texture`: a sampled texture is read through a
// sampler and carries an element type, a storage one is addressed directly and carries a FORMAT
// and an ACCESS mode, and keeping them apart makes every site that must decide about storage
// textures fail to compile until it does.
//
// The format and the access mode are written as string LITERAL types, which is what lets `tsc`
// check a mistyped format in the editor before this compiler sees the file — the ambient lib
// carries the same sixteen formats, the same read_write rule and a conditional type for the
// texel, so the editor and the compiler refuse the same programs.
//
// Two of the refusals below are things TINT DOES NOT REFUSE, and that is the point of them.
// Tint compiles a shader; a device binds one. Tint accepts every format at every access mode,
// while a real device accepts `read_write` at three formats only and accepts no format outside
// the sixteen without a feature request. Both were measured by asking a device to build a bind
// group layout for each pair. A spelling Tint takes and a device refuses passes the compile
// gate and then fails at `createBindGroupLayout` — the shape issue #113 was.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { reflect } from '../../core/reflect.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

const wgslOf = (src: string): string => {
  const r = compile(src)
  expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
  return r.wgsl ?? ''
}

const compute = (bindings: string, body: string): string => `"use typeshade"
${bindings}
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
${body}
}
`

describe('the binding', () => {
  it('declares as a handle, with the format and the access inside the type', () => {
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1., 0., 0., 1.))`,
      ),
    )
    // No address space: a storage texture is a handle, like a sampled texture and a sampler,
    // even though it is written through.
    expect(wgsl).toContain('@group(0) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;')
    expect(wgsl).toContain(
      'textureStore(dst, vec2<i32>(i32(gid.x), 0), vec4<f32>(1.0, 0.0, 0.0, 1.0));',
    )
  })

  it('takes the array form', () => {
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d_array<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), 0, vec4(1., 0., 0., 1.))`,
      ),
    )
    expect(wgsl).toContain('var dst: texture_storage_2d_array<rgba8unorm, write>;')
  })

  it('retypes the array layer to an integer, and refuses a fractional one', () => {
    // A bare `0` lowers to an f32 on this surface; WGSL's storage forms take an integer layer,
    // so `0.0` was emitted and Tint refused it ("no matching call"). Found by the spec audit.
    const store = wgslOf(
      compute(
        `declare const dst: texture_storage_2d_array<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), 0, vec4(1., 0., 0., 1.))`,
      ),
    )
    expect(store).toContain(
      'textureStore(dst, vec2<i32>(i32(gid.x), 0), 0, vec4<f32>(1.0, 0.0, 0.0, 1.0));',
    )
    const load = wgslOf(
      compute(
        `declare const src: texture_storage_2d_array<"r32float", "read">\ndeclare let out: storage<array<vec4>>`,
        `  out[gid.x] = textureLoad(src, vec2i(0, 0), 1)`,
      ),
    )
    expect(load).toContain('textureLoad(src, vec2<i32>(0, 0), 1)')
    expect(
      errorsOf(
        compute(
          `declare const dst: texture_storage_2d_array<"rgba8unorm", "write">`,
          `  textureStore(dst, vec2i(0, 0), 1.5, vec4(1., 0., 0., 1.))`,
        ),
      ),
    ).toEqual([
      'A texture layer must be a whole number of 0 or more, got 1.5. WGSL rejects a fractional or negative one and GLSL ES 3.00 silently rounds it, so the two targets would disagree.',
    ])
  })

  it('refuses textureStore in a vertex entry, and in a helper the entry reaches', () => {
    // Tint's table gives textureStore @stage("fragment", "compute"); a vertex entry writing a
    // texture compiled clean here and failed at pipeline creation. Found by the spec audit.
    const vertex = (fns: string): string => `"use typeshade"
declare const dst: texture_storage_2d<"rgba8unorm", "write">
class Clip {
  @builtin("position") pos: vec4;
}
${fns}
`
    expect(
      errorsOf(
        vertex(`@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  textureStore(dst, vec2i(0, 0), vec4(1., 0., 0., 1.))
  return { pos: vec4(0., 0., 0., 1.) }
}`),
      ),
    ).toEqual([
      '"textureStore" is not valid in a vertex shader; "vs" is a vertex entry. WGSL allows a texture write in a fragment or compute stage only.',
    ])
    expect(
      errorsOf(
        vertex(`function write(): void {
  textureStore(dst, vec2i(0, 0), vec4(1., 0., 0., 1.))
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  write()
  return { pos: vec4(0., 0., 0., 1.) }
}`),
      ),
    ).toEqual([
      '"textureStore" is not valid in a vertex shader; "write" is reachable from the vertex entry "vs". WGSL allows a texture write in a fragment or compute stage only.',
    ])
  })

  it('defaults the access mode to write, as the ambient lib does', () => {
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1.))`,
      ),
    )
    expect(wgsl).toContain('texture_storage_2d<rgba8unorm, write>')
  })

  it('is not a module variable', () => {
    const errors = errorsOf(`"use typeshade"
let dst: texture_storage_2d<"rgba8unorm", "write">
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  textureStore(dst, vec2i(0, 0), vec4(1.))
}
`)
    expect(errors[0]).toContain(
      'a storage texture is a resource, declared bare with "declare const"',
    )
  })
})

describe('what the format decides', () => {
  it('stores a vec4u to an integer format', () => {
    const wgsl = wgslOf(
      compute(
        `declare const ids: texture_storage_2d<"rgba8uint", "write">`,
        `  textureStore(ids, vec2i(0, 0), vec4u(gid.x, gid.y, u32(1), u32(255)))`,
      ),
    )
    expect(wgsl).toContain('texture_storage_2d<rgba8uint, write>')
    expect(wgsl).toContain('vec4<u32>(gid.x, gid.y, 1u, 255u)')
  })

  it('refuses the wrong texel type, as Tint does, in its own words', () => {
    const errors = errorsOf(
      compute(
        `declare const ids: texture_storage_2d<"rgba8uint", "write">`,
        `  textureStore(ids, vec2i(0, 0), vec4(1.))`,
      ),
    )
    expect(errors[0]).toContain('stores a vec4<u32>; got vec4<f32>')
    expect(errors[0]).toContain('a "…uint" format stores a vec4u')
  })
})

describe('what the access mode decides', () => {
  it('refuses a load from a write-only texture', () => {
    const errors = errorsOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(0, 0), textureLoad(dst, vec2i(0, 0)))`,
      ),
    )
    expect(errors[0]).toContain('is write-only, so textureLoad cannot read it')
  })

  it('refuses a store to a read-only texture', () => {
    const errors = errorsOf(
      compute(
        `declare const src: texture_storage_2d<"rgba8unorm", "read">`,
        `  textureStore(src, vec2i(0, 0), vec4(1.))`,
      ),
    )
    expect(errors[0]).toContain('is read-only, so textureStore cannot write it')
  })

  it('takes both ways on a format a device reads and writes', () => {
    const wgsl = wgslOf(
      compute(
        `declare const acc: texture_storage_2d<"r32float", "read_write">`,
        `  const old = textureLoad(acc, vec2i(0, 0))\n  textureStore(acc, vec2i(0, 0), vec4(old.x + 1., 0., 0., 0.))`,
      ),
    )
    expect(wgsl).toContain('texture_storage_2d<r32float, read_write>')
    expect(wgsl).toContain('textureLoad(acc,')
    expect(wgsl).toContain('textureStore(acc,')
  })
})

describe('what a DEVICE refuses and Tint does not', () => {
  it('refuses read_write on a format no device reads and writes, in one sentence', () => {
    // Tint compiles `texture_storage_2d<rgba8unorm, read_write>` without a word. A device
    // answers "Texture format TextureFormat::RGBA8Unorm does not support storage texture access
    // StorageTextureAccess::ReadWrite" at createBindGroupLayout, which no compile gate reaches.
    const errors = errorsOf(
      compute(
        `declare const acc: texture_storage_2d<"rgba8unorm", "read_write">`,
        `  textureStore(acc, vec2i(0, 0), vec4(1.))`,
      ),
    )
    // The type is still returned after the report, so this is the WHOLE of what it says: no
    // second refusal at the use and no "Unknown identifier" at every read of the binding.
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"rgba8unorm" cannot be read_write')
    expect(errors[0]).toContain('"r32uint", "r32sint", "r32float"')
  })

  it('refuses a format outside the sixteen every device stores to', () => {
    const errors = errorsOf(
      compute(
        `declare const dst: texture_storage_2d<"rg16float", "write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(1.))`,
      ),
    )
    expect(errors[0]).toContain('needs a texel format written as a string')
    expect(errors[0]).toContain('fails when the host builds the bind group')
  })
})

describe('a sampled texture and a storage one are different things', () => {
  it('refuses textureStore on a sampled texture, naming the declaration to write', () => {
    const errors = errorsOf(
      compute(`declare const tex: texture_2d<f32>`, `  textureStore(tex, vec2i(0, 0), vec4(1.))`),
    )
    expect(errors[0]).toContain('is a sampled texture, which is read through a sampler')
    expect(errors[0]).toContain('texture_storage_2d<"rgba8unorm", "write">')
  })

  it('refuses textureSample on a storage texture, naming what does read it', () => {
    const errors = errorsOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "read">\ndeclare const smp: sampler`,
        `  const v = textureSample(dst, smp, vec2(0.5))\n  const _keep = v.x`,
      ),
    )
    expect(errors[0]).toContain('is a storage texture, which is read and written by texel')
    expect(errors[0]).toContain('textureLoad and textureStore')
  })
})

describe('what the host is told', () => {
  it('reflects the format and the access in WebGPU spelling', () => {
    const r = compile(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">\ndeclare const acc: texture_storage_2d_array<"r32float", "read_write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(1.))\n  textureStore(acc, vec2i(0, 0), 0, textureLoad(acc, vec2i(0, 0), 0))`,
      ),
    )
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
    const entries = reflect(r.module).bindGroups.flatMap((g) => g.entries)
    const dst = entries.find((e) => e.name === 'dst')!
    expect(dst.resourceKind).toBe('storage-texture')
    expect(dst.storageFormat).toBe('rgba8unorm')
    // WebGPU's spelling, not WGSL's: a host passing `write` through gets a validation error.
    expect(dst.storageAccess).toBe('write-only')
    expect(dst.textureDim).toBe('2d')
    const acc = entries.find((e) => e.name === 'acc')!
    expect(acc.storageFormat).toBe('r32float')
    expect(acc.storageAccess).toBe('read-write')
    expect(acc.textureDim).toBe('2d-array')
  })

  it('requires the storageTexture capability, so GLSL fails closed', () => {
    const r = compile(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(1.))`,
      ),
    )
    expect(reflect(r.module).requiredFeatures).toContain('storageTexture')
    // GLSL ES 3.00 has no image load/store — that is ES 3.10 — so the module emits WGSL alone.
    expect(
      compile(
        compute(
          `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
          `  textureStore(dst, vec2i(0, 0), vec4(1.))`,
        ),
      ).glsl,
    ).toBeUndefined()
  })
})

describe('the write is an effect', () => {
  it('survives an optimizer that drops a pure call', () => {
    // A `textureStore` returns nothing, so a pass that treated it as pure would drop every one
    // of them and emit an entry whose body does nothing at all.
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(0.25))\n  textureStore(dst, vec2i(1, 0), vec4(0.5))\n  textureStore(dst, vec2i(2, 0), vec4(0.75))`,
      ),
    )
    expect(wgsl.match(/textureStore\(/g)).toHaveLength(3)
  })
})
