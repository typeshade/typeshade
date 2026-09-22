// Cube and 3D textures, bias and gradient sampling (roadmap 0.4 item 12, the portable half).
//
// A cube texture is six faces looked up by a DIRECTION; a 3D texture is a volume addressed by
// a `vec3` coordinate. Both are core in both targets — WGSL `texture_cube` / `texture_3d`, GLSL
// ES 3.00 `samplerCube` / `sampler3D` — so neither needs a capability, and a module carrying one
// emits both halves. The coordinate's width rides on the IR type, so the read ids are the ones a
// 2d texture already has; what is new is that the front end checks the width against the dim,
// and says so in the author's file before either target refuses the generated code.
//
// `textureSampleBias` and `textureSampleGrad` are the two sampling forms this surface lacked.
// Measured on Tint and on a WebGL2 driver: a bias needs the implicit derivatives and is
// fragment-only on BOTH (Tint: "built-in cannot be used by compute pipeline stage"; the driver:
// "no matching overloaded function" for `texture(s, uv, bias)` in a vertex stage); explicit
// gradients are legal in any stage on both. `textureLod` has no `samplerCubeShadow` overload,
// the same gap the 2d array shadow has, so level 0 on a depth cube is `textureGrad` with zero
// gradients — three wide, because the gradients have the coordinate's width.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { reflect } from '../../core/reflect.js'
import { compileModule } from '../../core/oracle.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

const both = (src: string): { wgsl: string; glsl: string } => {
  const r = compile(src)
  expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
  return { wgsl: r.wgsl ?? '', glsl: r.glsl?.fragment ?? '' }
}

const DECLS = `declare const env: texture_cube<f32>
declare const lut: texture_3d<f32>
declare const atlas: texture_2d<f32>
declare const pages: texture_2d_array<f32>
declare const smp: sampler`

const fragment = (body: string, decls = DECLS): string => `"use typeshade"
${decls}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const dir: vec3 = normalize(vec3(p.xy, 1.))
${body}
}
`

describe('the two new dims, on both targets', () => {
  it('declares a cube and a 3d texture as handles, fused into samplerCube and sampler3D on GLSL', () => {
    const { wgsl, glsl } = both(
      fragment(`  const a = textureSample(env, smp, dir)
  const b = textureSample(lut, smp, dir)
  return a + b`),
    )
    expect(wgsl).toContain('var env: texture_cube<f32>;')
    expect(wgsl).toContain('var lut: texture_3d<f32>;')
    expect(glsl).toContain('uniform samplerCube env;')
    expect(glsl).toContain('uniform sampler3D lut;')
  })

  it('declares a precision for sampler3D, which GLSL gives no default, and none for samplerCube, which it does', () => {
    // GLSL ES 3.00 §4.5.4 predeclares a default precision for `sampler2D` and `samplerCube`
    // only; every other sampler type needs its own line or a real driver refuses the shader.
    const { glsl } = both(
      fragment(`  return textureSample(env, smp, dir) + textureSample(lut, smp, dir)`),
    )
    expect(glsl).toContain('precision highp sampler3D;')
    expect(glsl).not.toContain('precision highp samplerCube;')
  })

  it('is portable: no capability, and GLSL is emitted', () => {
    const r = compile(
      fragment(`  return textureSample(env, smp, dir) + textureSample(lut, smp, dir)`),
    )
    expect(r.glsl).toBeDefined()
    expect(reflect(r.module).requiredFeatures).toEqual([])
  })

  it('spells an integer 3d texture with the prefix, as the 2d one is', () => {
    const { wgsl, glsl } = both(
      fragment(
        `  const v = textureLoad(ids, vec3i(1, 2, 3), 0)
  return vec4(f32(v.x), 0., 0., 1.)`,
        `declare const ids: texture_3d<u32>`,
      ),
    )
    expect(wgsl).toContain('var ids: texture_3d<u32>;')
    expect(glsl).toContain('uniform usampler3D ids;')
    expect(glsl).toContain('precision highp usampler3D;')
  })
})

describe('the reads, by direction and by vec3 coordinate', () => {
  it('samples a cube by direction and a 3d texture by coordinate with the SAME ids a 2d texture has', () => {
    const { wgsl, glsl } = both(
      fragment(`  const a = textureSample(env, smp, dir)
  const b = textureSample(lut, smp, dir)
  return a + b`),
    )
    expect(wgsl).toContain('textureSample(env, smp, dir)')
    expect(wgsl).toContain('textureSample(lut, smp, dir)')
    expect(glsl).toContain('texture(env, dir)')
    expect(glsl).toContain('texture(lut, dir)')
  })

  it('takes an explicit level on both', () => {
    const { wgsl, glsl } = both(
      fragment(
        `  return textureSampleLevel(env, smp, dir, 2.) + textureSampleLevel(lut, smp, dir, 0.)`,
      ),
    )
    expect(wgsl).toContain('textureSampleLevel(env, smp, dir, 2.0)')
    expect(glsl).toContain('textureLod(env, dir, 2.0)')
    expect(glsl).toContain('textureLod(lut, dir, 0.0)')
  })

  it('fetches a texel of a 3d texture by vec3i, and refuses the fetch on a cube, which neither target has', () => {
    const { wgsl, glsl } = both(fragment(`  return textureLoad(lut, vec3i(1, 2, 3), 0)`))
    expect(wgsl).toContain('textureLoad(lut, ')
    expect(glsl).toContain('texelFetch(lut, ')
    expect(errorsOf(fragment(`  return textureLoad(env, vec3i(0, 0, 0), 0)`))).toEqual([
      'textureLoad has no cube form on either target: a texture_cube<f32> is looked up by ' +
        'direction, so read it with textureSample or textureSampleLevel.',
    ])
  })

  it('answers textureDimensions three wide on a 3d texture and two wide on a cube', () => {
    const { wgsl, glsl } = both(
      fragment(`  const s3 = textureDimensions(lut)
  const sc = textureDimensions(env)
  return vec4(f32(s3.z), f32(sc.x), 0., 1.)`),
    )
    // The 3d size is its own id on GLSL, since the 2d wrapper's uvec2() would drop the depth.
    expect(wgsl).toContain('textureDimensions(lut)')
    expect(glsl).toContain('uvec3(textureSize(lut, 0))')
    // A cube's size is the size of one face, two wide on both targets: the 2d id.
    expect(wgsl).toContain('textureDimensions(env)')
    expect(glsl).toContain('uvec2(textureSize(env, 0))')
  })

  it('refuses textureNumLayers on a cube and on a 3d texture, naming what each has instead', () => {
    expect(errorsOf(fragment(`  return vec4(f32(textureNumLayers(env)))`))).toEqual([
      'textureNumLayers needs a texture_2d_array or a texture_cube_array; a texture_cube has six faces, not layers.',
    ])
    expect(errorsOf(fragment(`  return vec4(f32(textureNumLayers(lut)))`))).toEqual([
      'textureNumLayers needs a texture_2d_array; a texture_3d has depth, not layers: ' +
        'textureDimensions(t).z is its slice count.',
    ])
  })
})

describe('bias and gradients', () => {
  it('shifts the level of detail by a bias on every dim, folding the layer on the array', () => {
    const { wgsl, glsl } = both(
      fragment(`  const a = textureSampleBias(atlas, smp, p.xy, 1.)
  const b = textureSampleBias(pages, smp, p.xy, 2, 1.)
  const c = textureSampleBias(env, smp, dir, 0.5)
  return a + b + c`),
    )
    expect(wgsl).toContain('textureSampleBias(atlas, smp, p.xy, 1.0)')
    expect(wgsl).toContain('textureSampleBias(pages, smp, p.xy, 2, 1.0)')
    expect(wgsl).toContain('textureSampleBias(env, smp, dir, 0.5)')
    expect(glsl).toContain('texture(atlas, p.xy, 1.0)')
    expect(glsl).toContain('texture(pages, vec3(p.xy, float(2)), 1.0)')
    expect(glsl).toContain('texture(env, dir, 0.5)')
  })

  it("takes explicit gradients of the coordinate's width, folding the layer on the array", () => {
    const { wgsl, glsl } = both(
      fragment(`  const dx: vec2 = vec2(0.01, 0.)
  const dy: vec2 = vec2(0., 0.01)
  const d3: vec3 = vec3(0.01)
  const a = textureSampleGrad(atlas, smp, p.xy, dx, dy)
  const b = textureSampleGrad(pages, smp, p.xy, 1, dx, dy)
  const c = textureSampleGrad(env, smp, dir, d3, d3)
  return a + b + c`),
    )
    expect(wgsl).toContain('textureSampleGrad(atlas, smp, p.xy, dx, dy)')
    expect(wgsl).toContain('textureSampleGrad(pages, smp, p.xy, 1, dx, dy)')
    expect(wgsl).toContain('textureSampleGrad(env, smp, dir, d3, d3)')
    expect(glsl).toContain('textureGrad(atlas, p.xy, dx, dy)')
    expect(glsl).toContain('textureGrad(pages, vec3(p.xy, float(1)), dx, dy)')
    expect(glsl).toContain('textureGrad(env, dir, d3, d3)')
  })

  const compute = (call: string): string => `"use typeshade"
${DECLS}
declare let out: storage<array<vec4>>
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const dir: vec3 = vec3(1., 0., 0.)
  out[gid.x] = ${call}
}
`
  it('refuses textureSampleBias in a compute entry, as both targets do', () => {
    // A bias shifts the IMPLICIT level of detail, which needs the derivatives only a fragment
    // quad has; Tint and a WebGL2 driver both refuse it outside a fragment stage.
    expect(errorsOf(compute('textureSampleBias(env, smp, dir, 1.)'))).toEqual([
      '"textureSampleBias" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
    expect(errorsOf(compute('textureSampleBias(pages, smp, dir.xy, 0, 1.)'))).toEqual([
      '"textureSampleBias" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
  })

  it('takes textureSampleGrad in any stage', () => {
    const r = compile(compute('textureSampleGrad(env, smp, dir, dir, dir)'))
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('textureSampleGrad(env, smp, dir, dir, dir)')
  })
})

describe('the coordinate has the width the dim decides, and this says so first', () => {
  it('refuses a vec2 on a cube, naming the direction', () => {
    expect(errorsOf(fragment(`  return textureSample(env, smp, p.xy)`))).toEqual([
      'textureSample on a texture_cube<f32> takes a vec3 direction; got vec2<f32>.',
    ])
  })

  it('refuses a vec3 on a 2d texture', () => {
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, dir, 0.)`))).toEqual([
      'textureSampleLevel on a texture_2d<f32> takes a vec2 coordinate; got vec3<f32>.',
    ])
  })

  it('refuses a vec2i fetch on a 3d texture', () => {
    expect(errorsOf(fragment(`  return textureLoad(lut, vec2i(0, 0), 0)`))).toEqual([
      'textureLoad on a texture_3d<f32> takes a vec3 coordinate; got vec2<i32>.',
    ])
  })

  it('refuses a gradient of the wrong width', () => {
    expect(
      errorsOf(fragment(`  return textureSampleGrad(env, smp, dir, vec2(0.), vec2(0.))`)),
    ).toEqual(['textureSampleGrad on a texture_cube<f32> takes a vec3 gradient; got vec2<f32>.'])
  })

  it('refuses a coordinate of the right width and the wrong element kind', () => {
    // The width was all that was checked, so `textureSample(atlas, smp, vec2i(0, 0))` emitted
    // `textureSample(atlas, smp, vec2<i32>(0, 0))` and `textureLoad(atlas, vec2(0., 0.), 0)` a
    // float fetch coordinate — both "no matching call" on Tint. A sampled read is by
    // normalised f32 coordinate, a texel fetch by whole texel (wgsl.txt:24435, 24129).
    expect(errorsOf(fragment(`  return textureSample(atlas, smp, vec2i(0, 0))`))).toEqual([
      'textureSample on a texture_2d<f32> takes an f32 coordinate; got vec2<i32>.',
    ])
    expect(errorsOf(fragment(`  return textureLoad(atlas, vec2(0., 0.), 0)`))).toEqual([
      'textureLoad on a texture_2d<f32> takes an integer coordinate, an i32 or a u32; got vec2<f32>.',
    ])
    expect(errorsOf(fragment(`  return textureSample(env, smp, vec3i(0, 0, 1))`))).toEqual([
      'textureSample on a texture_cube<f32> takes an f32 coordinate; got vec3<i32>.',
    ])
    // A u32 fetch coordinate is the other integer WGSL takes, and stays as written.
    expect(errorsOf(fragment(`  return textureLoad(atlas, vec2u(u32(0), u32(0)), 0)`))).toEqual([])
  })
})

// The scalar arguments of a texture read (#145). `intArg` retargeted a whole-number LITERAL and
// returned everything else unchanged, so a variable of the wrong type reached the backend: an
// `i32` level emitted `textureSampleLevel(t, s, p.xy, 2)` and an `f32` layer emitted
// `textureSampleLevel(t, s, p.xy, 1.0, 0.0)`, each of which Tint refuses with "no matching call"
// while GLSL ES 3.00 silently rounds. WGSL types `level`, `bias` and `depth_ref` `f32`
// (wgsl.txt:25081, 24615, 24734) and a layer, mip level and sample index an integer (24155).
describe('the scalar arguments are checked, not just the literals', () => {
  it('refuses an integer variable as level, bias and depth_ref, naming f32', () => {
    expect(
      errorsOf(
        fragment(`  const l: i32 = 2
  return textureSampleLevel(atlas, smp, p.xy, l)`),
      ),
    ).toEqual(['textureSampleLevel level must be an f32; got i32. Write f32(l).'])
    expect(
      errorsOf(
        fragment(`  const b: i32 = 1
  return textureSampleBias(atlas, smp, p.xy, b)`),
      ),
    ).toEqual(['textureSampleBias bias must be an f32; got i32. Write f32(b).'])
    expect(
      errorsOf(
        fragment(
          `  const r: i32 = 1
  return vec4(textureSampleCompare(shadow, shadowSmp, p.xy, r))`,
          `${DECLS}
declare const shadow: texture_depth_2d
declare const shadowSmp: sampler_comparison`,
        ),
      ),
    ).toEqual(['textureSampleCompare depth_ref must be an f32; got i32. Write f32(r).'])
    // A u32 is no better than an i32: WGSL has exactly the f32 overload.
    expect(
      errorsOf(
        fragment(`  const l: u32 = u32(2)
  return textureSampleLevel(atlas, smp, p.xy, l)`),
      ),
    ).toEqual(['textureSampleLevel level must be an f32; got u32. Write f32(l).'])
    // The f32 the call takes stays as written, and a whole-number literal is still retargeted.
    expect(
      errorsOf(
        fragment(`  const l: f32 = 2.
  return textureSampleLevel(atlas, smp, p.xy, l)`),
      ),
    ).toEqual([])
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, p.xy, 0)`))).toEqual([])
  })

  it('refuses a float variable as layer, mip level and sample index, naming the integers', () => {
    expect(
      errorsOf(
        fragment(`  const k: f32 = 1.
  return textureSampleLevel(pages, smp, p.xy, k, 0.)`),
      ),
    ).toEqual(['textureSampleLevel layer must be an i32 or a u32; got f32. Write i32(k).'])
    expect(
      errorsOf(
        fragment(`  const l: f32 = 2.
  return textureLoad(atlas, vec2i(0, 0), l)`),
      ),
    ).toEqual(['textureLoad mip level must be an i32 or a u32; got f32. Write u32(l).'])
    expect(
      errorsOf(
        fragment(
          `  const si: f32 = 1.
  return textureLoad(ms, vec2i(0, 0), si)`,
          `${DECLS}
declare const ms: texture_multisampled_2d<f32>`,
        ),
      ),
    ).toEqual(['textureLoad sample index must be an i32 or a u32; got f32. Write u32(si).'])
  })

  it('answers an explicit cast like any other expression, rather than deleting it', () => {
    // A BARE number is the call's to type — it has none of its own on this surface — so
    // `textureSampleLevel(t, s, uv, 0)` emits `0.0` and `textureLoad(t, c, 0)` emits the
    // integer. `i32(0)` is not bare: it says what it is. Retargeting on the FOLDED value
    // treated the two alike and silently emitted `0.0` for the cast, while refusing the same
    // mistake spelled `const l: i32 = 0` — one author told to write a cast, another's deleted.
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, p.xy, i32(0))`))).toEqual([
      'textureSampleLevel level must be an f32; got i32. Write f32(i32(0)).',
    ])
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, p.xy, u32(2))`))).toEqual([
      'textureSampleLevel level must be an f32; got u32. Write f32(u32(2)).',
    ])
    expect(errorsOf(fragment(`  return textureLoad(atlas, vec2i(0, 0), f32(1))`))).toEqual([
      'textureLoad mip level must be an i32 or a u32; got f32. Write u32(f32(1)).',
    ])
    // The bare forms are untouched, which is the whole point of the distinction.
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, p.xy, 0)`))).toEqual([])
    expect(errorsOf(fragment(`  return textureLoad(atlas, vec2i(0, 0), 0)`))).toEqual([])
  })

  it('refuses an emulated double in a float slot, where it used to be narrowed', () => {
    // `floatArg` folded first and accepted any numeric literal, so `f64(1e300)` became an
    // f32-typed literal carrying the full double and emitted
    // `textureSampleLevel(atlas, smp, p.xy, 1e+300)` — "cannot be represented as 'f32'" on
    // Tint. An f64 in a float slot is now answered like an f64 anywhere else.
    //
    // For an out-of-f32-range LITERAL the answer now comes one step earlier still, from §52's
    // range check at the literal itself, and it is the better of the two: the slot message
    // would advise `f32(f64(1e300))`, which is infinity. The value still never reaches the
    // emit, which is what this row exists to hold.
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, p.xy, f64(1e300))`))).toEqual(
      [
        '1e+300 is outside the range of f32 (about ±3.4e38), and there is no wider type here for it to take.',
      ],
    )
    expect(errorsOf(fragment(`  return textureSampleLevel(atlas, smp, p.xy, f64(1.))`))).toEqual([
      'textureSampleLevel level must be an f32; got f64. Write f32(f64(1.)).',
    ])
  })

  it('refuses an emulated double as a coordinate, naming the element and not the width', () => {
    // A `vec2f64` has the width a 2d texture wants; what is wrong with it is the element. The
    // width gate used to reject it first and say "takes a vec2 coordinate; got vec2<f64>",
    // which names a width that is right.
    expect(
      errorsOf(
        fragment(`  const c = vec2f64(f64(0.), f64(0.))
  return textureSample(atlas, smp, c)`),
      ),
    ).toEqual(['textureSample on a texture_2d<f32> takes an f32 coordinate; got vec2<f64>.'])
  })

  it('cuts a long argument short rather than smearing the message', () => {
    // The span already points at the argument; the "Write f32(...)" half is a reminder of the
    // shape, not a transcript.
    expect(
      errorsOf(
        fragment(
          `  const l: i32 = 2
  return textureSampleLevel(atlas, smp, p.xy, l + l + l + l + l + l + l + l)`,
        ),
      ),
    ).toEqual([
      'textureSampleLevel level must be an f32; got i32. Write f32(l + l + l + l + l + l +…).',
    ])
  })

  it('reports every shape under TS8041, code and sentence pinned together', () => {
    // The tests above read `.message` alone, so the CODE was only ever asserted through the
    // language service's `from:` labels — nothing here would have caught a site that pushed the
    // right sentence under the wrong code, or a renumber. The code is part of the contract: it
    // is what an editor filters on and what `codes.ts` promises never to reuse.
    //
    // One case per `TS_CODES.TEXTURE_ARGUMENT` site in `lowerTextureCall`, so a site that drifts
    // off the code fails here rather than in a consumer's rule file.
    const coded = (src: string) =>
      compileTsSource(src)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => `${d.code} ${d.message}`)

    // 1. The coordinate's WIDTH against the texture's dim.
    expect(coded(fragment(`  return textureSample(env, smp, p.xy)`))).toEqual([
      'TS8041 textureSample on a texture_cube<f32> takes a vec3 direction; got vec2<f32>.',
    ])
    // 2. The coordinate's ELEMENT kind: normalised reads are f32, a texel fetch is an integer.
    expect(coded(fragment(`  return textureSample(atlas, smp, vec2i(0, 0))`))).toEqual([
      'TS8041 textureSample on a texture_2d<f32> takes an f32 coordinate; got vec2<i32>.',
    ])
    expect(coded(fragment(`  return textureLoad(atlas, p.xy, 0)`))).toEqual([
      'TS8041 textureLoad on a texture_2d<f32> takes an integer coordinate, an i32 or a u32; ' +
        'got vec2<f32>.',
    ])
    // 3. An f32 scalar slot — level, bias, depth_ref.
    expect(
      coded(
        fragment(`  const l: i32 = 2
  return textureSampleLevel(atlas, smp, p.xy, l)`),
      ),
    ).toEqual(['TS8041 textureSampleLevel level must be an f32; got i32. Write f32(l).'])
    // 4. An INTEGER scalar slot given a value with a float type of its own.
    expect(
      coded(
        fragment(`  const a: f32 = 1.
  return textureSampleLevel(pages, smp, p.xy, a, 0.)`),
      ),
    ).toEqual(['TS8041 textureSampleLevel layer must be an i32 or a u32; got f32. Write i32(a).'])
    // 5. A literal in an integer slot that cannot be an index.
    expect(coded(fragment(`  return textureSampleLevel(pages, smp, p.xy, -1, 0.)`))).toEqual([
      'TS8041 A texture layer must be a whole number of 0 or more, got -1. WGSL rejects ' +
        'a fractional or negative one and GLSL ES 3.00 silently rounds it, so the two targets ' +
        'would disagree.',
    ])
  })
})

describe('an integer cube is declared, and only textureGather reads it', () => {
  it('refuses textureSample on it, naming the read that applies', () => {
    // A cube has no texel fetch on either target and sampling is float-only, so the one read an
    // integer cube has is a gather (roadmap 0.4 item 12, the WGSL-only half).
    const errors = errorsOf(
      fragment(
        `  return vec4(textureSample(ids, smp, dir))`,
        `declare const ids: texture_cube<u32>
declare const smp: sampler`,
      ),
    )
    expect(errors).toEqual([
      'textureSample needs a float texture; texture_cube<u32> is read with textureGather.',
    ])
  })
})

describe('the depth cube', () => {
  const D = `declare const pointShadow: texture_depth_cube
declare const shadowSmp: sampler_comparison`

  it('compares by direction, folding the reference into a vec4 on GLSL', () => {
    const { wgsl, glsl } = both(
      fragment(`  return vec4(textureSampleCompare(pointShadow, shadowSmp, dir, 0.5))`, D),
    )
    expect(wgsl).toContain('var pointShadow: texture_depth_cube;')
    expect(wgsl).toContain('textureSampleCompare(pointShadow, shadowSmp, dir, 0.5)')
    expect(glsl).toContain('uniform samplerCubeShadow pointShadow;')
    expect(glsl).toContain('precision highp samplerCubeShadow;')
    expect(glsl).toContain('texture(pointShadow, vec4(dir, 0.5))')
  })

  it('spells level 0 as textureGrad with zero vec3 gradients on GLSL', () => {
    // `textureLod` has no `samplerCubeShadow` overload in GLSL ES 3.00 (measured, the same gap
    // the 2d array shadow has); a zero gradient is level 0, three wide here.
    const { wgsl, glsl } = both(
      fragment(`  return vec4(textureSampleCompareLevel(pointShadow, shadowSmp, dir, 0.5))`, D),
    )
    expect(wgsl).toContain('textureSampleCompareLevel(pointShadow, shadowSmp, dir, 0.5)')
    expect(glsl).toContain('textureGrad(pointShadow, vec4(dir, 0.5), vec3(0.0), vec3(0.0))')
    expect(glsl).not.toContain('textureLod(pointShadow')
  })

  it('refuses a vec2 coordinate on it, and textureNumLayers', () => {
    expect(
      errorsOf(
        fragment(`  return vec4(textureSampleCompare(pointShadow, shadowSmp, p.xy, 0.5))`, D),
      ),
    ).toEqual([
      'textureSampleCompare on a texture_depth_cube takes a vec3 direction; got vec2<f32>.',
    ])
    expect(errorsOf(fragment(`  return vec4(f32(textureNumLayers(pointShadow)))`, D))).toEqual([
      'textureNumLayers needs a texture_depth_2d_array or a texture_depth_cube_array; a texture_depth_cube has six faces, not layers.',
    ])
  })

  it('is fragment-only in the implicit form, as the 2d one is', () => {
    const errors = errorsOf(`"use typeshade"
${D}
declare let out: storage<array<f32>>
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = textureSampleCompare(pointShadow, shadowSmp, vec3(1., 0., 0.), 0.5)
}
`)
    expect(errors).toEqual([
      '"textureSampleCompare" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
  })
})

describe('what the host is told', () => {
  it('reflects the view dimension a host creates: cube and 3d', () => {
    const r = compile(
      fragment(
        `  const a = textureSample(env, smp, dir) + textureSample(lut, smp, dir)
  const lit = textureSampleCompare(pointShadow, shadowSmp, dir, 0.5)
  return a * lit`,
        `${DECLS}
declare const pointShadow: texture_depth_cube
declare const shadowSmp: sampler_comparison`,
      ),
    )
    const entries = reflect(r.module).bindGroups.flatMap((g) => g.entries)
    const env = entries.find((e) => e.name === 'env')!
    expect(env.resourceKind).toBe('texture')
    expect(env.textureDim).toBe('cube')
    expect(env.textureElem).toBe('f32')
    const lut = entries.find((e) => e.name === 'lut')!
    expect(lut.textureDim).toBe('3d')
    const shadow = entries.find((e) => e.name === 'pointShadow')!
    expect(shadow.textureDim).toBe('cube')
    expect(shadow.textureDepth).toBe(true)
    expect(shadow.textureElem).toBeUndefined()
  })
})

describe('the CPU twin', () => {
  it('yields opaque black for the new reads, 1 for the cube comparison and 1×1×1 for a 3d size', () => {
    const r = compile(
      fragment(
        `  const a = textureSampleBias(atlas, smp, p.xy, 1.)
  const b = textureSampleGrad(env, smp, dir, dir, dir)
  const lit = textureSampleCompare(pointShadow, shadowSmp, dir, 0.5)
  const depth = f32(textureDimensions(lut).z)
  return vec4(a.a * 0.5, b.a * 0.25, lit, depth)`,
        `${DECLS}
declare const pointShadow: texture_depth_cube
declare const shadowSmp: sampler_comparison`,
      ),
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const cm = compileModule(r.module, { gpuStubs: true })
    for (const h of ['env', 'lut', 'atlas', 'pages', 'smp', 'pointShadow', 'shadowSmp'])
      cm.setBinding(h, 0)
    expect(cm.fns['fs']!([10, 20, 0, 1])).toEqual([0.5, 0.25, 1, 1])
  })
})

// The level query and the unsigned coordinate (#147). Both were measured before they were
// written: `textureDimensions(t, 0)` and `textureLoad(t, vec2u(0, 0), 0u)` are accepted by
// Tint, `uvec2(textureSize(t, int(0)))` compiles on a WebGL2 driver — and
// `texelFetch(t, uvec2(0u, 0u), 0)` is "no matching overloaded function found" there, which is
// what the compiler was emitting.
describe('a texture is asked about a level, and fetched by either integer', () => {
  it('takes an explicit level on textureDimensions, on both targets', () => {
    const { wgsl, glsl } = both(
      fragment(`  const d = textureDimensions(atlas, 0)
  return vec4(f32(d.x), 0., 0., 1.)`),
    )
    expect(wgsl).toContain('textureDimensions(atlas, 0u)')
    // The GLSL column already spelled the 2-argument form; only the front end refused it.
    expect(glsl).toContain('uvec2(textureSize(atlas, int(0u)))')
    // The level-less form is untouched.
    const plain = both(
      fragment(`  const d = textureDimensions(atlas)
  return vec4(f32(d.x), 0., 0., 1.)`),
    )
    expect(plain.wgsl).toContain('textureDimensions(atlas)')
    expect(plain.glsl).toContain('uvec2(textureSize(atlas, 0))')
  })

  it('takes a level on a 3d texture, whose size is three wide', () => {
    const { wgsl, glsl } = both(
      fragment(`  const d = textureDimensions(lut, 1)
  return vec4(f32(d.z), 0., 0., 1.)`),
    )
    expect(wgsl).toContain('textureDimensions(lut, 1u)')
    expect(glsl).toContain('uvec3(textureSize(lut, int(1u)))')
  })

  it('refuses a level that is not a whole number, and a third argument', () => {
    expect(
      errorsOf(
        fragment(`  const d = textureDimensions(atlas, 1.5)
  return vec4(f32(d.x), 0., 0., 1.)`),
      )[0],
    ).toContain('must be a whole number of 0 or more')
    expect(
      errorsOf(
        fragment(`  const d = textureDimensions(atlas, 0, 0)
  return vec4(f32(d.x), 0., 0., 1.)`),
      )[0],
    ).toBe(
      'textureDimensions on a texture_2d<f32> expects 1 argument(s), or 2 with an explicit mip level, got 3.',
    )
  })

  it('takes an unsigned coordinate and a u32 variable as layer and level', () => {
    // WGSL's texel coordinate is "i32, or u32"; GLSL's texelFetch takes the signed one only,
    // so an unsigned coordinate is wrapped in the signed constructor of the texture's width.
    // The level is a `u32` const, which the folder replaces with its value — what matters
    // here is that an unsigned COORDINATE reaches both targets in a form each one takes.
    const { wgsl, glsl } = both(
      fragment(`  const c = vec2u(u32(1), u32(2))
  return textureLoad(atlas, c, u32(0))`),
    )
    expect(wgsl).toContain('textureLoad(atlas, c, 0u)')
    expect(glsl).toContain('texelFetch(atlas, ivec2(c), int(0u))')
    // The SIGNED coordinate keeps the spelling every existing program already emits.
    const signed = both(fragment(`  return textureLoad(atlas, vec2i(1, 2), 0)`))
    expect(signed.glsl).toContain('texelFetch(atlas, ivec2(1, 2), int(0u))')
    expect(signed.glsl).not.toContain('ivec2(ivec2(')
  })

  it('wraps an unsigned coordinate on a 3d and an array fetch too', () => {
    const three = both(
      fragment(`  const c = vec3u(u32(0), u32(0), u32(0))
  return textureLoad(lut, c, 0)`),
    )
    expect(three.glsl).toContain('texelFetch(lut, ivec3(c), int(0u))')
    const arr = both(
      fragment(`  const c = vec2u(u32(0), u32(0))
  return textureLoad(pages, c, 0, 0)`),
    )
    expect(arr.glsl).toContain('texelFetch(pages, ivec3(ivec2(c), int(0)), int(0u))')
  })
})
