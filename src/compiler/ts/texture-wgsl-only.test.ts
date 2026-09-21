// The WGSL-only textures and reads (roadmap 0.4 item 12, second half): texture_1d, texture_cube_array
// (and its depth twin), textureGather and textureGatherCompare.
//
// GLSL ES 3.00 has none of them, measured on a WebGL2 driver: `sampler1D` is a reserved word,
// `samplerCubeArray` needs an extension the driver refuses, and `textureGather` arrived in ES
// 3.10. So each is a DERIVED capability with a WGSL row and no GLSL row, the pattern a storage
// texture set: the gate fails the module closed on GLSL before any emit, and `reflect()` tells
// the host which of the three the module needs. On Tint every shape below was measured accepted
// (`scratchpad/item12-probe.mts`), gather in any stage.
//
// The design is read straight off the spec (§17.7.2, §17.7.3) and Tint's `core.def`: the
// component comes FIRST on a colour texture and is absent on a depth one; the layer follows the
// coordinate on an array; the reference follows the layer on the compare form; a 1d texture is
// addressed by one number and has no bias or gradient sampling; a cube array samples like a cube
// with a layer.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { reflect } from '../../core/reflect.js'
import { compileModule } from '../../core/oracle.js'
import { FRAGMENT_ONLY_CALLS } from './lower/function.js'
import { FRAGMENT_ONLY_IDS } from '../../core/passes/lint/rules/fragment-only-builtin.js'
import { INTRINSICS } from '../../core/intrinsics.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

const wgslOf = (src: string): string => {
  const r = compile(src)
  expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
  return r.wgsl ?? ''
}

const DECLS = `declare const ramp: texture_1d<f32>
declare const envs: texture_cube_array<f32>
declare const atlas: texture_2d<f32>
declare const pages: texture_2d_array<f32>
declare const env: texture_cube<f32>
declare const smp: sampler
declare const shadow: texture_depth_2d
declare const shadows: texture_depth_cube_array
declare const shadowSmp: sampler_comparison`

const fragment = (body: string, decls = DECLS): string => `"use typeshade"
${decls}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const dir: vec3 = normalize(vec3(p.xy, 1.))
${body}
}
`

describe('the three capabilities, derived from the module', () => {
  it('a 1d texture needs texture1d, a cube array textureCubeArray, a gather textureGather', () => {
    // Each case declares only what it uses: a capability is derived from every binding the
    // module declares, referenced or not, as it is for a storage texture.
    const one = compile(
      fragment(
        `  return textureSample(ramp, smp, p.x)`,
        `declare const ramp: texture_1d<f32>
declare const smp: sampler`,
      ),
    )
    expect(reflect(one.module).requiredFeatures).toEqual(['texture1d'])
    const arr = compile(
      fragment(
        `  return textureSample(envs, smp, dir, 2)`,
        `declare const envs: texture_cube_array<f32>
declare const smp: sampler`,
      ),
    )
    expect(reflect(arr.module).requiredFeatures).toEqual(['textureCubeArray'])
    const gather = compile(
      fragment(
        `  return textureGather(0, atlas, smp, p.xy)`,
        `declare const atlas: texture_2d<f32>
declare const smp: sampler`,
      ),
    )
    expect(reflect(gather.module).requiredFeatures).toEqual(['textureGather'])
    // The depth cube array rides the same capability as the colour one.
    const depth = compile(
      fragment(
        `  return vec4(textureSampleCompare(shadows, shadowSmp, dir, 1, 0.5))`,
        `declare const shadows: texture_depth_cube_array
declare const shadowSmp: sampler_comparison`,
      ),
    )
    expect(reflect(depth.module).requiredFeatures).toEqual(['textureCubeArray'])
    // All three at once, in the order the capability list keeps.
    const all = compile(
      fragment(`  return textureGather(0, atlas, smp, p.xy) + textureSample(ramp, smp, p.x)`),
    )
    expect([...reflect(all.module).requiredFeatures].sort()).toEqual([
      'texture1d',
      'textureCubeArray',
      'textureGather',
    ])
  })

  it('emits WGSL and no GLSL: the gate fails the module closed on GLSL ES 3.00', () => {
    const r = compile(
      fragment(`  return textureGather(0, atlas, smp, p.xy) + textureSample(ramp, smp, p.x)`),
    )
    expect(r.wgsl).toContain('textureGather(0, atlas, smp, p.xy)')
    expect(r.glsl).toBeUndefined()
  })

  it('is not declarable: the capability comes from the shape, never from enables', () => {
    // `DeclarableCapability` excludes the three at the type level; this pins the runtime row.
    const r = compile(fragment(`  return textureSample(envs, smp, dir, 0)`))
    const caps = reflect(r.module).requiredFeatures
    expect(caps).toContain('textureCubeArray')
    expect(caps).not.toContain('storageTexture')
  })
})

describe('texture_1d: one number in, a texel out', () => {
  it('samples, samples at a level and fetches by one coordinate', () => {
    const wgsl = wgslOf(
      fragment(`  const a = textureSample(ramp, smp, p.x)
  const b = textureSampleLevel(ramp, smp, p.x, 0.)
  const c = textureLoad(ramp, 3, 0)
  return a + b + c`),
    )
    expect(wgsl).toContain('var ramp: texture_1d<f32>;')
    expect(wgsl).toContain('textureSample(ramp, smp, p.x)')
    expect(wgsl).toContain('textureSampleLevel(ramp, smp, p.x, 0.0)')
    expect(wgsl).toContain('textureLoad(ramp, 3, 0u)')
  })

  it('answers textureDimensions one wide, as a u32', () => {
    const wgsl = wgslOf(
      fragment(`  const w = textureDimensions(ramp)
  return vec4(f32(w))`),
    )
    expect(wgsl).toContain('let w = textureDimensions(ramp);')
    expect(wgsl).toContain('f32(w)')
  })

  it('refuses a vec2 coordinate, an f32 fetch coordinate, a bias, a gradient and textureNumLayers, each in one sentence', () => {
    expect(errorsOf(fragment(`  return textureSample(ramp, smp, p.xy)`))).toEqual([
      'textureSample on a texture_1d<f32> takes a single f32 coordinate; got vec2<f32>.',
    ])
    // A bare `3` is retargeted to an i32 (the test above); an f32 EXPRESSION is refused where
    // Tint would refuse the generated `textureLoad(t, 3.0, 0u)`.
    expect(errorsOf(fragment(`  return textureLoad(ramp, p.x, 0)`))).toEqual([
      'textureLoad on a texture_1d<f32> takes an integer coordinate, an i32 or a u32; got f32.',
    ])
    expect(errorsOf(fragment(`  return textureSampleBias(ramp, smp, p.x, 1.)`))).toEqual([
      'textureSampleBias has no texture_1d form on WGSL; a texture_1d<f32> is read with textureSample, textureSampleLevel or textureLoad.',
    ])
    expect(errorsOf(fragment(`  return textureSampleGrad(ramp, smp, p.x, p.x, p.x)`))).toEqual([
      'textureSampleGrad has no texture_1d form on WGSL; a texture_1d<f32> is read with textureSample, textureSampleLevel or textureLoad.',
    ])
    expect(errorsOf(fragment(`  return vec4(f32(textureNumLayers(ramp)))`))).toEqual([
      'textureNumLayers needs a texture_2d_array; a texture_1d has no layers.',
    ])
  })

  it('refuses an integer coordinate on a 1d SAMPLE, literal or not', () => {
    // A sampled read is by normalised f32 coordinate whatever the dim. The literal exemption
    // that lets `textureLoad(ramp, 3, 0)` spell its integer used to be tested on the FOLDED
    // value and applied to the sampled reads too, where no retarget follows: `u32(2)` folded
    // to a lit, skipped the element check, and emitted `textureSample(ramp, smp, 2u)` — "no
    // matching call" on Tint with no diagnostic here. `i32(2)` survived only by accident, the
    // writer spelling an i32 lit bare so WGSL read it as abstract-int.
    expect(errorsOf(fragment(`  return textureSample(ramp, smp, u32(2))`))).toEqual([
      'textureSample on a texture_1d<f32> takes an f32 coordinate; got u32.',
    ])
    expect(errorsOf(fragment(`  return textureSample(ramp, smp, i32(2))`))).toEqual([
      'textureSample on a texture_1d<f32> takes an f32 coordinate; got i32.',
    ])
    expect(errorsOf(fragment(`  return textureSampleLevel(ramp, smp, u32(2), 0.)`))).toEqual([
      'textureSampleLevel on a texture_1d<f32> takes an f32 coordinate; got u32.',
    ])
    // A BARE number in a sampled slot is an f32 already and stays clean, as does the integer
    // coordinate of a fetch, which is where the exemption belongs.
    expect(errorsOf(fragment(`  return textureSample(ramp, smp, 2)`))).toEqual([])
    expect(errorsOf(fragment(`  return textureLoad(ramp, 2, 0)`))).toEqual([])
    expect(errorsOf(fragment(`  return textureLoad(ramp, u32(2), 0)`))).toEqual([])
  })

  it('takes an integer 1d texture through textureLoad', () => {
    const wgsl = wgslOf(
      fragment(
        `  const v = textureLoad(ids, 2, 0)
  return vec4(f32(v.x))`,
        `declare const ids: texture_1d<u32>`,
      ),
    )
    expect(wgsl).toContain('var ids: texture_1d<u32>;')
  })
})

describe('texture_cube_array: a cube with a layer', () => {
  it('samples with the layer after the direction, on every sampling form', () => {
    const wgsl = wgslOf(
      fragment(`  const a = textureSample(envs, smp, dir, 1)
  const b = textureSampleLevel(envs, smp, dir, 1, 2.)
  const c = textureSampleBias(envs, smp, dir, 1, 0.5)
  const d = textureSampleGrad(envs, smp, dir, 1, dir, dir)
  return a + b + c + d + vec4(f32(textureNumLayers(envs)))`),
    )
    expect(wgsl).toContain('var envs: texture_cube_array<f32>;')
    expect(wgsl).toContain('textureSample(envs, smp, dir, 1)')
    expect(wgsl).toContain('textureSampleLevel(envs, smp, dir, 1, 2.0)')
    expect(wgsl).toContain('textureSampleBias(envs, smp, dir, 1, 0.5)')
    expect(wgsl).toContain('textureSampleGrad(envs, smp, dir, 1, dir, dir)')
    expect(wgsl).toContain('textureNumLayers(envs)')
  })

  it('compares a depth cube array by direction, layer, then reference', () => {
    const wgsl = wgslOf(
      fragment(`  const a = textureSampleCompare(shadows, shadowSmp, dir, 2, 0.5)
  const b = textureSampleCompareLevel(shadows, shadowSmp, dir, 2, 0.5)
  return vec4(a, b, f32(textureNumLayers(shadows)), 1.)`),
    )
    expect(wgsl).toContain('var shadows: texture_depth_cube_array;')
    expect(wgsl).toContain('textureSampleCompare(shadows, shadowSmp, dir, 2, 0.5)')
    expect(wgsl).toContain('textureSampleCompareLevel(shadows, shadowSmp, dir, 2, 0.5)')
  })

  it('refuses a texel fetch and a vec2 direction, as on a cube', () => {
    expect(errorsOf(fragment(`  return textureLoad(envs, vec3i(0), 0)`))).toEqual([
      'textureLoad has no cube form on either target: a texture_cube_array<f32> is looked up by direction, so read it with textureSample or textureSampleLevel.',
    ])
    expect(errorsOf(fragment(`  return textureSample(envs, smp, p.xy, 0)`))).toEqual([
      'textureSample on a texture_cube_array<f32> takes a vec3 direction; got vec2<f32>.',
    ])
  })

  it('is fragment-only in the implicit forms, under the name the author wrote', () => {
    const compute = (call: string): string => `"use typeshade"
${DECLS}
declare let out: storage<array<vec4>>
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  const dir: vec3 = vec3(1., 0., 0.)
  out[gid.x] = ${call}
}
`
    // The plain sample too: its cube-array id was in neither fragment-only table, so a
    // compute or vertex entry sampling one compiled clean and Tint refused the WGSL.
    expect(errorsOf(compute('textureSample(envs, smp, dir, 0)'))).toEqual([
      '"textureSample" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
    expect(errorsOf(compute('textureSampleBias(envs, smp, dir, 0, 1.)'))).toEqual([
      '"textureSampleBias" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
    expect(
      errorsOf(compute('vec4(textureSampleCompare(shadows, shadowSmp, dir, 0, 0.5))')),
    ).toEqual([
      '"textureSampleCompare" is only valid in a fragment shader; "cs" is a compute entry.',
    ])
  })

  it('textureSample on a cube array is fragment-only in every stage', () => {
    // The compute arm above is one half. A VERTEX entry is the other, and used to be answered
    // by the backend lint instead of the front end for the plain `texture_2d` id
    // (tests-critique T1b, control T1c): both stages, both dims, one sentence, one span.
    const vertex = (call: string): string => `"use typeshade"
${DECLS}
class Clip { @builtin("position") pos: vec4 }
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const dir: vec3 = vec3(0., 0., 1.)
  return { pos: ${call} }
}
`
    expect(errorsOf(vertex('textureSample(envs, smp, dir, 0)'))).toEqual([
      '"textureSample" is only valid in a fragment shader; "vs" is a vertex entry.',
    ])
    expect(errorsOf(vertex('textureSample(atlas, smp, vec2(0., 0.))'))).toEqual([
      '"textureSample" is only valid in a fragment shader; "vs" is a vertex entry.',
    ])
    expect(errorsOf(vertex('textureSample(pages, smp, vec2(0., 0.), 0)'))).toEqual([
      '"textureSample" is only valid in a fragment shader; "vs" is a vertex entry.',
    ])
    // The explicit-LOD twin is what the message points at, and it is legal here.
    expect(errorsOf(vertex('textureSampleLevel(atlas, smp, vec2(0., 0.), 0.)'))).toEqual([])
  })
})

// Two hand lists in two layers stay equal only if something compares them (tests-critique
// P1-27). The front end's `FRAGMENT_ONLY_CALLS` reports at the entry, in the author's file,
// with the call chain; the core lint's `FRAGMENT_ONLY_IDS` is the EDSL's only gate and reports
// at emit. Both ways of missing an id have happened: `textureSample` on a `texture_cube_array`
// was in NEITHER table and reached Tint (T1b, fixed by #143), and `textureSample` itself was in
// the lint and not the front end until #145. Neither table may drift from the other.
describe('the two fragment-only tables hold the same ids', () => {
  it('the front end and the lint agree, id for id', () => {
    expect([...FRAGMENT_ONLY_CALLS].sort()).toEqual([...FRAGMENT_ONLY_IDS.keys()].sort())
  })

  it('and they hold exactly the reads whose level of detail is implicit', () => {
    // Derived from the intrinsic catalogue by shape rather than copied: every sampling id
    // whose LOD is implicit (the plain sample, the bias that shifts it, the depth comparison
    // that needs it), plus the derivatives themselves. `…Level`, `…Grad` and every gather take
    // no derivative and are legal in any stage — `fwidth` has no catalogue row of its own
    // (it expands), so it is named beside the two it expands into.
    const implicit = Object.keys(INTRINSICS)
      .filter(
        (id) =>
          /^textureSample(Array|Cube|CubeArray)?$/.test(id) ||
          /^textureSampleBias/.test(id) ||
          /^textureSampleCompare(?!Level)/.test(id) ||
          /^(dpdx|dpdy|fwidth)/.test(id),
      )
      .concat('fwidth')
    expect([...FRAGMENT_ONLY_CALLS].sort()).toEqual([...new Set(implicit)].sort())
  })
})

describe('textureGather: four texels, one channel each', () => {
  it('takes the component first on a colour texture, and the layer after the coordinate', () => {
    const wgsl = wgslOf(
      fragment(`  const r = textureGather(0, atlas, smp, p.xy)
  const a = textureGather(3, pages, smp, p.xy, 1)
  const c = textureGather(1, env, smp, dir)
  const ca = textureGather(2, envs, smp, dir, 0)
  return r + a + c + ca`),
    )
    expect(wgsl).toContain('textureGather(0, atlas, smp, p.xy)')
    expect(wgsl).toContain('textureGather(3, pages, smp, p.xy, 1)')
    expect(wgsl).toContain('textureGather(1, env, smp, dir)')
    expect(wgsl).toContain('textureGather(2, envs, smp, dir, 0)')
  })

  it('takes no component on a depth texture, and the reference last on the compare form', () => {
    const wgsl = wgslOf(
      fragment(`  const d = textureGather(shadow, smp, p.xy)
  const c = textureGatherCompare(shadow, shadowSmp, p.xy, 0.5)
  const ca = textureGatherCompare(shadows, shadowSmp, dir, 1, 0.5)
  return d + c + ca`),
    )
    expect(wgsl).toContain('textureGather(shadow, smp, p.xy)')
    expect(wgsl).toContain('textureGatherCompare(shadow, shadowSmp, p.xy, 0.5)')
    expect(wgsl).toContain('textureGatherCompare(shadows, shadowSmp, dir, 1, 0.5)')
  })

  it('yields a vec4 of the texture element: a u32 cube gathers as vec4<u32>', () => {
    const wgsl = wgslOf(
      fragment(
        `  const g = textureGather(0, ids, smp, dir)
  return vec4(f32(g.x), f32(g.y), 0., 1.)`,
        `declare const ids: texture_cube<u32>
declare const smp: sampler`,
      ),
    )
    expect(wgsl).toContain('var ids: texture_cube<u32>;')
    expect(wgsl).toContain('let g = textureGather(0, ids, smp, dir);')
  })

  it('is legal in a compute entry: no implicit derivative is taken', () => {
    const r = compile(`"use typeshade"
${DECLS}
declare let out: storage<array<vec4>>
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = textureGather(0, atlas, smp, vec2(0.5)) + textureGatherCompare(shadow, shadowSmp, vec2(0.5), 0.5)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('textureGather(0, atlas, smp,')
  })

  it('refuses a component that is not a whole number from 0 to 3 written in the call', () => {
    expect(errorsOf(fragment(`  return textureGather(4, atlas, smp, p.xy)`))[0]).toContain(
      "textureGather's component must be a whole number from 0 to 3 written in the call",
    )
    expect(
      errorsOf(
        fragment(`  const c = 1
  return textureGather(c, atlas, smp, p.xy)`),
      )[0],
    ).toContain('written in the call')
  })

  it('refuses a component on a depth texture, and its absence on a colour one', () => {
    expect(errorsOf(fragment(`  return textureGather(0, shadow, smp, p.xy)`))).toEqual([
      'textureGather on a texture_depth_2d takes no component: a depth texture has one channel. Write textureGather(tex, smp, coords).',
    ])
    expect(errorsOf(fragment(`  return textureGather(atlas, smp, p.xy)`))).toEqual([
      'textureGather on a texture_2d<f32> takes the component first: textureGather(0, tex, smp, coords) reads the red channel of the four texels.',
    ])
  })

  it('refuses the wrong sampler kind in either direction, and a colour texture in the compare form', () => {
    expect(errorsOf(fragment(`  return textureGather(0, atlas, shadowSmp, p.xy)`))[0]).toContain(
      'textureGather reads through an ordinary sampler; got sampler_comparison',
    )
    expect(
      errorsOf(fragment(`  return textureGatherCompare(shadow, smp, p.xy, 0.5)`))[0],
    ).toContain('textureGatherCompare compares through a sampler_comparison; got sampler')
    expect(
      errorsOf(fragment(`  return textureGatherCompare(atlas, shadowSmp, p.xy, 0.5)`))[0],
    ).toContain('textureGatherCompare compares against a depth texture')
  })

  it('refuses a 1d or 3d texture, which have no gather form on WGSL', () => {
    expect(errorsOf(fragment(`  return textureGather(0, ramp, smp, p.x)`))).toEqual([
      'textureGather gathers a 2d, 2d-array, cube or cube-array texture; a texture_1d<f32> has no gather form on WGSL.',
    ])
  })
})

describe('what the host is told', () => {
  it('reflects the view dimensions 1d and cube-array, and the depth cube array', () => {
    const r = compile(
      fragment(
        `  return textureSample(ramp, smp, p.x) + textureSample(envs, smp, dir, 0) * textureSampleCompare(shadows, shadowSmp, dir, 0, 0.5)`,
      ),
    )
    const entries = reflect(r.module).bindGroups.flatMap((g) => g.entries)
    expect(entries.find((e) => e.name === 'ramp')!.textureDim).toBe('1d')
    expect(entries.find((e) => e.name === 'envs')!.textureDim).toBe('cube-array')
    const s = entries.find((e) => e.name === 'shadows')!
    expect(s.textureDim).toBe('cube-array')
    expect(s.textureDepth).toBe(true)
  })
})

describe('the CPU twins', () => {
  it('yield opaque black for a colour gather, the far plane for a depth gather, 1 for a compare, and 1 for a 1d size', () => {
    const r = compile(
      fragment(`  const g = textureGather(0, atlas, smp, p.xy)
  const d = textureGather(shadow, smp, p.xy)
  const c = textureGatherCompare(shadow, shadowSmp, p.xy, 0.5)
  const w = f32(textureDimensions(ramp))
  return vec4(g.a * 0.5, d.x * 0.25, c.y, w)`),
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const cm = compileModule(r.module, { gpuStubs: true })
    for (const h of [
      'ramp',
      'envs',
      'atlas',
      'pages',
      'env',
      'smp',
      'shadow',
      'shadows',
      'shadowSmp',
    ])
      cm.setBinding(h, 0)
    expect(cm.fns['fs']!([10, 20, 0, 1])).toEqual([0.5, 0.25, 1, 1])
  })
})
