// Depth textures and comparison samplers (roadmap 0.4 item 11).
//
// The texture a shadow map is: single-channel float with no element type of its own, read by
// COMPARISON — a reference depth against the texel, through a `sampler_comparison`, yielding
// how much of the filter footprint passed. Its own IR kind, for the reason a storage texture
// has one: it is a different thing at every site (no element, yields f32 not vec4, only some
// calls apply), so every `kind === 'texture'` switch keeps meaning "sampled" and a site that
// must decide fails to compile until it does. The comparison-ness stays on the SAMPLER, as WGSL
// has it, so the IR keeps modelling its closest target.
//
// Unlike a storage texture this is PORTABLE: both targets have a spelling. WGSL keeps two
// bindings; GLSL ES 3.00 fuses them into one `sampler2DShadow` and folds the reference INTO the
// coordinate — `texture(t, vec3(uv, ref))`, and `vec4(uv, layer, ref)` on the array — which is
// the neutral-id machinery the array layer already uses. Measured on Tint and on a WebGL2
// driver, both of which take every accepted shape below and refuse every refused one; the
// front end says each refusal first, in the author's own file, and `tsc` says it too through
// the ambient lib (`ambient.test.ts` runs the example under it).

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

const DECLS = `declare const shadowMap: texture_depth_2d
declare const shadowSmp: sampler_comparison`

const fragment = (body: string, decls = DECLS): string => `"use typeshade"
${decls}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
${body}
}
`

describe('the two bindings, on both targets', () => {
  it('declares a depth texture and a comparison sampler as handles', () => {
    const { wgsl, glsl } = both(
      fragment(`  const lit = textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5)
  return vec4(lit, lit, lit, 1.)`),
    )
    expect(wgsl).toContain('@group(0) @binding(0) var shadowMap: texture_depth_2d;')
    expect(wgsl).toContain('@group(0) @binding(1) var shadowSmp: sampler_comparison;')
    // GLSL fuses the two into ONE combined shadow sampler; the sampler binding emits nothing.
    expect(glsl).toContain('uniform sampler2DShadow shadowMap;')
    expect(glsl).not.toContain('shadowSmp')
  })

  it('declares a precision for the shadow sampler, which GLSL gives no default', () => {
    // GLSL ES 3.00 §4.5.4 defaults sampler2D and samplerCube only; a shadow sampler with no
    // precision line fails to compile on a real driver.
    const { glsl } = both(
      fragment(`  return vec4(textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5))`),
    )
    expect(glsl).toContain('precision highp sampler2DShadow;')
  })

  it('is portable: no capability, and GLSL is emitted', () => {
    const r = compile(
      fragment(`  return vec4(textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5))`),
    )
    expect(r.glsl).toBeDefined()
    expect(reflect(r.module).requiredFeatures).toEqual([])
  })
})

describe('the comparison reads', () => {
  it('folds the reference into the GLSL coordinate, and keeps it an argument on WGSL', () => {
    const { wgsl, glsl } = both(
      fragment(`  const lit = textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5)
  const lit0 = textureSampleCompareLevel(shadowMap, shadowSmp, p.xy, 0.25)
  return vec4(lit, lit0, 0., 1.)`),
    )
    expect(wgsl).toContain('textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5)')
    expect(wgsl).toContain('textureSampleCompareLevel(shadowMap, shadowSmp, p.xy, 0.25)')
    expect(glsl).toContain('texture(shadowMap, vec3(p.xy, 0.5))')
    // `…Level` samples level 0 by definition, which is what textureLod at 0.0 is.
    expect(glsl).toContain('textureLod(shadowMap, vec3(p.xy, 0.25), 0.0)')
  })

  it('yields an f32, not a texel', () => {
    const { wgsl } = both(
      fragment(`  const lit = textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5)
  return vec4(lit * 2., 0., 0., 1.)`),
    )
    // Scalar arithmetic on the result: a vec4 result would have been refused by the multiply.
    expect(wgsl).toContain('let lit = textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5);')
    expect(wgsl).toContain('(lit * 2.0)')
  })

  it('takes the array form with the layer before the reference, folding both on GLSL', () => {
    const { wgsl, glsl } = both(
      fragment(
        `  const lit = textureSampleCompare(maps, shadowSmp, p.xy, 1, 0.5)
  return vec4(lit, f32(textureNumLayers(maps)), 0., 1.)`,
        `declare const maps: texture_depth_2d_array
declare const shadowSmp: sampler_comparison`,
      ),
    )
    expect(wgsl).toContain('var maps: texture_depth_2d_array;')
    expect(wgsl).toContain('textureSampleCompare(maps, shadowSmp, p.xy, 1, 0.5)')
    expect(glsl).toContain('uniform sampler2DArrayShadow maps;')
    expect(glsl).toContain('precision highp sampler2DArrayShadow;')
    expect(glsl).toContain('texture(maps, vec4(p.xy, float(1), 0.5))')
  })

  it('spells level 0 on the ARRAY shadow as textureGrad with zero gradients, on GLSL', () => {
    // GLSL ES 3.00 defines `textureLod` for `sampler2DShadow` but NOT for
    // `sampler2DArrayShadow` — "no matching overloaded function found" on a WebGL2 driver,
    // which the compile gate caught on the first bake of the example. A zero gradient is a
    // level of detail of -infinity, clamped to the base level: level 0, spelled the one way the
    // target can spell it, and legal in a vertex stage too.
    const { wgsl, glsl } = both(
      fragment(
        `  const lit = textureSampleCompareLevel(maps, shadowSmp, p.xy, 2, 0.5)
  return vec4(lit, 0., 0., 1.)`,
        `declare const maps: texture_depth_2d_array
declare const shadowSmp: sampler_comparison`,
      ),
    )
    expect(wgsl).toContain('textureSampleCompareLevel(maps, shadowSmp, p.xy, 2, 0.5)')
    expect(glsl).toContain('textureGrad(maps, vec4(p.xy, float(2), 0.5), vec2(0.0), vec2(0.0))')
    expect(glsl).not.toContain('textureLod(maps')
  })

  it('answers textureDimensions on a depth texture', () => {
    const { wgsl, glsl } = both(
      fragment(`  const s = textureDimensions(shadowMap)
  return vec4(f32(s.x), f32(s.y), 0., 1.)`),
    )
    expect(wgsl).toContain('textureDimensions(shadowMap)')
    expect(glsl).toContain('textureSize(shadowMap, 0)')
  })
})

describe('the two sampler kinds are not interchangeable, and this says so first', () => {
  it('refuses an ordinary sampler in a comparison', () => {
    const errors = errorsOf(
      fragment(
        `  return vec4(textureSampleCompare(shadowMap, smp, p.xy, 0.5))`,
        `declare const shadowMap: texture_depth_2d
declare const smp: sampler`,
      ),
    )
    expect(errors[0]).toContain('compares through a sampler_comparison; got sampler')
    expect(errors[0]).toContain('declare const smp: sampler_comparison')
  })

  it('refuses a comparison sampler in a plain sample', () => {
    const errors = errorsOf(
      fragment(
        `  return textureSample(tex, shadowSmp, p.xy)`,
        `declare const tex: texture_2d<f32>
declare const shadowSmp: sampler_comparison`,
      ),
    )
    expect(errors[0]).toContain('filters a texel through an ordinary sampler')
    expect(errors[0]).toContain('reads a texture_depth_2d with textureSampleCompare')
  })

  it('refuses a comparison against a colour texture, naming the declaration to write', () => {
    const errors = errorsOf(
      fragment(
        `  return vec4(textureSampleCompare(tex, shadowSmp, p.xy, 0.5))`,
        `declare const tex: texture_2d<f32>
declare const shadowSmp: sampler_comparison`,
      ),
    )
    expect(errors[0]).toContain('"texture_2d<f32>" is a sampled colour texture with no depth')
    expect(errors[0]).toContain('"texture_depth_2d"')
  })
})

describe('what is fragment-only, and what is not', () => {
  const compute = (call: string): string => `"use typeshade"
${DECLS}
declare let out: storage<array<f32>>
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = ${call}
}
`
  it('refuses textureSampleCompare in a compute entry, as Tint does', () => {
    // Tint: "built-in cannot be used by compute pipeline stage" — the implicit level of detail
    // needs the derivatives only a fragment quad has.
    const errors = errorsOf(compute('textureSampleCompare(shadowMap, shadowSmp, vec2(0.5), 0.5)'))
    expect(errors).toEqual([
      '"textureSampleCompare" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
  })

  it('takes textureSampleCompareLevel in any stage', () => {
    const r = compile(compute('textureSampleCompareLevel(shadowMap, shadowSmp, vec2(0.5), 0.5)'))
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('textureSampleCompareLevel(shadowMap, shadowSmp,')
  })
})

describe('a plain read of a depth texture is refused for now, with the reason', () => {
  it('names the read that does apply and why the plain one waits', () => {
    const errors = errorsOf(fragment(`  return vec4(textureLoad(shadowMap, vec2i(0, 0), 0))`))
    expect(errors[0]).toContain('is read by comparison: textureSampleCompare(tex, smp, uv, ref)')
    // The reason is GLSL's fused sampler, whose type the READ decides.
    expect(errors[0]).toContain('needs separate samplers, which a later item adds')
  })

  it('is not a module variable', () => {
    const errors = errorsOf(`"use typeshade";
let shadowMap: texture_depth_2d;
declare const shadowSmp: sampler_comparison;
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5));
}
`)
    expect(errors[0]).toContain('a depth texture is a resource, declared bare with "declare const"')
  })
})

describe('what the host is told', () => {
  it('reflects a depth texture as a texture with sampleType depth, and the sampler as comparison', () => {
    const r = compile(
      fragment(
        `  const a = textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5)
  const b = textureSampleCompareLevel(maps, shadowSmp, p.xy, 0, 0.5)
  return vec4(a, b, 0., 1.)`,
        `${DECLS}
declare const maps: texture_depth_2d_array`,
      ),
    )
    const entries = reflect(r.module).bindGroups.flatMap((g) => g.entries)
    const map = entries.find((e) => e.name === 'shadowMap')!
    // The SAME layout member as a sampled texture (`GPUBindGroupLayoutEntry.texture`), with
    // `sampleType: 'depth'`; a storage texture needs another member and is its own kind.
    expect(map.resourceKind).toBe('texture')
    expect(map.textureDim).toBe('2d')
    expect(map.textureDepth).toBe(true)
    expect(map.textureElem).toBeUndefined()
    const arr = entries.find((e) => e.name === 'maps')!
    expect(arr.textureDim).toBe('2d-array')
    expect(arr.textureDepth).toBe(true)
    const smp = entries.find((e) => e.name === 'shadowSmp')!
    expect(smp.resourceKind).toBe('sampler')
    expect(smp.samplerComparison).toBe(true)
    // Absent on every other kind, so a host never reads absence as "not depth" on a buffer.
    for (const e of entries.filter(
      (x) => x.resourceKind !== 'texture' && x.resourceKind !== 'sampler',
    )) {
      expect(e.textureDepth).toBeUndefined()
      expect(e.samplerComparison).toBeUndefined()
    }
  })
})

describe('the CPU twin', () => {
  it('yields 1, the identity for the lighting multiply', () => {
    // The oracle has no texture memory. A comparison yields a FACTOR, and the placeholder that
    // leaves the rest of the shader alone is the identity for the multiply it feeds — not the
    // opaque black a texel read yields, since a texel has no identity and a factor does.
    // (`eval` runs under gpuStubs; the codegen twin of every catalogued intrinsic is pinned by
    // oracle-backend-parity O5, so this pins the VALUE, not the parity.)
    const r = compile(
      fragment(`  const lit = textureSampleCompare(shadowMap, shadowSmp, p.xy, 0.5)
  const lit0 = textureSampleCompareLevel(shadowMap, shadowSmp, p.xy, 0.5)
  return vec4(lit * 0.5, lit0 * 0.25, 0., 1.)`),
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // The handles have to be BOUND for the entry to run, even though the stubbed read never
    // touches them: a texture binding on the CPU is a placeholder, as it is for every sampled
    // texture the oracle evaluates.
    const cm = compileModule(r.module, { gpuStubs: true })
    cm.setBinding('shadowMap', 0)
    cm.setBinding('shadowSmp', 0)
    // `fns[name]` takes one value per parameter (variadic); `eval` takes an args array.
    expect(cm.fns['fs']!([10, 20, 0, 1])).toEqual([0.5, 0.25, 0, 1])
  })
})
