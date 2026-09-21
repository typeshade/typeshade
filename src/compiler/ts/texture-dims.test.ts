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

// P0-6 of the spec audit's tests critique (#155). `wgsl.txt:25081`, `:24615`, `:24734` type
// `level`, `bias` and `depth_ref` as `f32`; `intArg` (`lower/expression-call.ts`) retypes a
// LITERAL and early-returns on anything else, so a non-constant `i32` is emitted unchanged.
//
// THE VALUE COMES FROM A UNIFORM ON PURPOSE. Written as `const l: i32 = 2` the front end folds
// it to the literal `2`, and a WGSL integer literal is an abstract-int that converts to `f32`
// by itself — measured on Tint on 2026-09-21, which ACCEPTS that program. The defect needs a
// value no constant folder can reach.
//
// ALSO PINNED IN `src/language-service/ambient.test.ts`, from the other side: there the same
// two programs are asked whether the EDITOR reports them, which is a different layer and a
// different fix. Closing #145 flips the rows in both files.
describe('the scalar arguments have the type the spec gives them', () => {
  // `dref`, not `ref`: a uniform field name reaches the emitted WGSL verbatim, and `ref` is a
  // WGSL reserved keyword — Tint would refuse the module for THAT, before ever reaching the
  // overload check these rows are about, and the refusal quoted below would be a fiction.
  const SCALAR_DECLS = `interface U {
  lvl: i32;
  bias: i32;
  dref: i32;
}
declare const u: uniform<U>
declare const atlas: texture_2d<f32>
declare const shadowMap: texture_depth_2d
declare const cmp: sampler_comparison
declare const smp: sampler`

  const scalar = (body: string): string => `"use typeshade"
${SCALAR_DECLS}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
${body}
}
`

  const LEVEL = scalar('  return textureSampleLevel(atlas, smp, p.xy, u.lvl)')
  const BIAS = scalar('  return textureSampleBias(atlas, smp, p.xy, u.bias)')
  const DEPTH_REF = scalar(
    '  return vec4(textureSampleCompare(shadowMap, cmp, p.xy, u.dref), 0., 0., 1.)',
  )

  it('passes an integer variable straight through today, which is the Tint-invalid shape', () => {
    // Tint, measured 2026-09-21: "no matching call to
    // 'textureSampleLevel(texture_2d<f32>, sampler, vec2<f32>, i32)'".
    expect(compile(LEVEL).wgsl ?? '').toContain('textureSampleLevel(atlas, smp, p.xy, u.lvl)')
    expect(compile(BIAS).wgsl ?? '').toContain('textureSampleBias(atlas, smp, p.xy, u.bias)')
    expect(compile(DEPTH_REF).wgsl ?? '').toContain(
      'textureSampleCompare(shadowMap, cmp, p.xy, u.dref)',
    )
  })

  it.fails('refuses an integer variable as a level, naming f32 — flipped by #145', () => {
    expect(errorsOf(LEVEL)).not.toEqual([])
  })

  it.fails('refuses an integer variable as a bias, naming f32 — flipped by #145', () => {
    expect(errorsOf(BIAS)).not.toEqual([])
  })

  it.fails('refuses an integer variable as a reference depth, naming f32 — flipped by #145', () => {
    expect(errorsOf(DEPTH_REF)).not.toEqual([])
  })
})
