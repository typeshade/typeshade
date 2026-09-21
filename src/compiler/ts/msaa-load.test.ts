// Multisampled loads (roadmap 0.4 item 13). The type existed (`texture_multisampled_2d`, the
// `msaaTextureLoad` capability, X-GIS #1703) and nothing read it; this is the read. A
// multisampled texture "cannot be used with a sampler" (WGSL §6.6.3): the one read it has is
// `textureLoad(t, coords, sampleIndex)`, one sample at a time, and `textureNumSamples(t)` is how
// many there are. The depth twin, `texture_depth_multisampled_2d`, is the depth attachment of an
// MSAA target and is loaded the same way, yielding an f32.
//
// WGSL-only: GLSL ES 3.00 has no `sampler2DMS` (that is ES 3.10), so the binding derives
// `msaaTextureLoad` and the gate fails the module closed on GLSL before any emit. The element is
// no longer pinned to f32: §6.6.3 parameterises the type by f32, i32 or u32, and the pin bought
// nothing once GLSL fails closed by capability.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { reflect } from '../../core/reflect.js'
import { compileModule } from '../../core/oracle.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

const wgslOf = (src: string): string => {
  const r = compile(src)
  expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
  return r.wgsl ?? ''
}

const DECLS = `declare const msaa: texture_multisampled_2d<f32>
declare const depthMs: texture_depth_multisampled_2d
declare const smp: sampler
declare const shadowSmp: sampler_comparison`

const fragment = (body: string, decls = DECLS): string => `"use typeshade"
${decls}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const c: vec2i = vec2i(p.xy)
${body}
}
`

describe('the reads a multisampled texture has', () => {
  it('loads one sample by coordinate and sample index, on the colour and the depth twin', () => {
    const wgsl = wgslOf(
      fragment(`  const a = textureLoad(msaa, c, 0)
  const b = textureLoad(msaa, c, 3)
  const d = textureLoad(depthMs, c, 1)
  return (a + b) * d`),
    )
    expect(wgsl).toContain('var msaa: texture_multisampled_2d<f32>;')
    expect(wgsl).toContain('var depthMs: texture_depth_multisampled_2d;')
    expect(wgsl).toContain('textureLoad(msaa, c, 0u)')
    expect(wgsl).toContain('textureLoad(msaa, c, 3u)')
    // The depth load is an f32, so it multiplies the vec4 as a scalar.
    expect(wgsl).toContain('let d = textureLoad(depthMs, c, 1u);')
    expect(wgsl).toContain('((a + b) * d)')
  })

  it('answers textureNumSamples and textureDimensions', () => {
    const wgsl = wgslOf(
      fragment(`  const n = textureNumSamples(msaa)
  const m = textureNumSamples(depthMs)
  const s = textureDimensions(msaa)
  return vec4(f32(n), f32(m), f32(s.x), 1.)`),
    )
    expect(wgsl).toContain('let n = textureNumSamples(msaa);')
    expect(wgsl).toContain('let m = textureNumSamples(depthMs);')
    expect(wgsl).toContain('let s = textureDimensions(msaa);')
  })

  it('takes an integer multisampled texture, as the spec parameterises the type', () => {
    const wgsl = wgslOf(
      fragment(
        `  const v = textureLoad(ids, c, 0)
  return vec4(f32(v.x))`,
        `declare const ids: texture_multisampled_2d<u32>`,
      ),
    )
    expect(wgsl).toContain('var ids: texture_multisampled_2d<u32>;')
  })

  it('is WGSL-only under msaaTextureLoad, for the colour and the depth twin alike', () => {
    const colour = compile(
      fragment(
        `  return textureLoad(msaa, c, 0)`,
        `declare const msaa: texture_multisampled_2d<f32>`,
      ),
    )
    expect(reflect(colour.module).requiredFeatures).toEqual(['msaaTextureLoad'])
    expect(colour.glsl).toBeUndefined()
    const depth = compile(
      fragment(
        `  return vec4(textureLoad(depthMs, c, 0))`,
        `declare const depthMs: texture_depth_multisampled_2d`,
      ),
    )
    expect(reflect(depth.module).requiredFeatures).toEqual(['msaaTextureLoad'])
    expect(depth.glsl).toBeUndefined()
  })
})

describe('what a multisampled texture cannot do, each in one sentence', () => {
  it('refuses every sampling, comparison and gather form, naming the load', () => {
    for (const call of [
      'textureSample(msaa, smp, p.xy)',
      'textureSampleLevel(msaa, smp, p.xy, 0.)',
      'textureSampleBias(msaa, smp, p.xy, 1.)',
      'textureSampleGrad(msaa, smp, p.xy, p.xy, p.xy)',
    ]) {
      const errors = errorsOf(fragment(`  return vec4(${call})`))
      expect(errors, call).toHaveLength(1)
      expect(errors[0]).toContain(
        'cannot read a texture_multisampled_2d<f32>: a multisampled texture cannot be used with a sampler',
      )
      expect(errors[0]).toContain('textureLoad(t, coords, sampleIndex)')
    }
    // A gather is routed by its own rule first (the component comes before the texture), and
    // its refusal names the dims that do gather; one sentence either way.
    expect(errorsOf(fragment(`  return textureGather(0, msaa, smp, p.xy)`))).toEqual([
      'textureGather gathers a 2d, 2d-array, cube or cube-array texture; a texture_multisampled_2d<f32> has no gather form on WGSL.',
    ])
    expect(
      errorsOf(fragment(`  return textureGatherCompare(depthMs, shadowSmp, p.xy, 0.5)`)),
    ).toEqual([
      'textureGatherCompare gathers a 2d, 2d-array, cube or cube-array texture; a texture_depth_multisampled_2d has no gather form on WGSL.',
    ])
    for (const call of [
      'textureSampleCompare(depthMs, shadowSmp, p.xy, 0.5)',
      'textureSampleCompareLevel(depthMs, shadowSmp, p.xy, 0.5)',
    ]) {
      const errors = errorsOf(fragment(`  return vec4(${call})`))
      expect(errors, call).toHaveLength(1)
      expect(errors[0]).toContain('cannot read a texture_depth_multisampled_2d')
    }
  })

  it('refuses textureNumLayers, a fractional sample index and a vec3 coordinate', () => {
    expect(errorsOf(fragment(`  return vec4(f32(textureNumLayers(msaa)))`))).toEqual([
      'textureNumLayers needs an array texture; a texture_multisampled_2d<f32> has samples, not layers, and textureNumSamples(t) is their count.',
    ])
    expect(errorsOf(fragment(`  return textureLoad(msaa, c, 1.5)`))[0]).toContain(
      'A texture sample index must be a whole number of 0 or more, got 1.5',
    )
    expect(errorsOf(fragment(`  return textureLoad(msaa, vec3i(0), 0)`))).toEqual([
      'textureLoad on a texture_multisampled_2d<f32> takes a vec2 coordinate; got vec3<i32>.',
    ])
  })

  it('refuses textureNumSamples on a single-sample texture', () => {
    expect(
      errorsOf(
        fragment(
          `  return vec4(f32(textureNumSamples(tex)))`,
          `declare const tex: texture_2d<f32>`,
        ),
      ),
    ).toEqual([
      'textureNumSamples takes a texture_multisampled_2d; a texture_2d<f32> has one sample per texel.',
    ])
  })
})

describe('what the host is told', () => {
  it('reflects the multisampled view for both twins, with textureDepth on the depth one', () => {
    const r = compile(fragment(`  return textureLoad(msaa, c, 0) * textureLoad(depthMs, c, 0)`))
    const entries = reflect(r.module).bindGroups.flatMap((g) => g.entries)
    const colour = entries.find((e) => e.name === 'msaa')!
    expect(colour.textureDim).toBe('2d-ms')
    expect(colour.textureElem).toBe('f32')
    const depth = entries.find((e) => e.name === 'depthMs')!
    expect(depth.textureDim).toBe('2d-ms')
    expect(depth.textureDepth).toBe(true)
    expect(depth.textureElem).toBeUndefined()
  })
})

describe('the CPU twins', () => {
  it('yield opaque black for a sample, the far plane for a depth sample, one sample per texel and a 1×1 size', () => {
    const r = compile(
      fragment(`  const a = textureLoad(msaa, c, 0)
  const d = textureLoad(depthMs, c, 0)
  const n = f32(textureNumSamples(msaa))
  const s = f32(textureDimensions(msaa).x)
  return vec4(a.a * 0.5, d * 0.25, n, s)`),
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const cm = compileModule(r.module, { gpuStubs: true })
    for (const h of ['msaa', 'depthMs', 'smp', 'shadowSmp']) cm.setBinding(h, 0)
    expect(cm.fns['fs']!([10, 20, 0, 1])).toEqual([0.5, 0.25, 1, 1])
  })
})
