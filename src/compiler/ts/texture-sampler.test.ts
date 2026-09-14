// Textures, samplers and override constants in "use typeshade" (#8 A7): the three resource
// declarations the surface had no spelling for, and the reads that take them.
//
// None of it is a new IR shape. `ShaderType` has had `texture` and `sampler` kinds and
// `ModuleDecl.overrides` has had `OverrideDecl` all along; the EDSL builds them with
// `resource(name, texture2dfT, …)` and `overrideConst(name, type, default)`, and both backends
// already emit every form. What was missing was a way to say it in source.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { compile } from './compile.js'
import { typeKey } from '../../core/ir/types.js'

function wgslOf(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics).toEqual([])
  return r.wgsl!
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`)
  expect(r.diagnostics.length).toBeGreaterThan(0)
  return r.diagnostics[0]!.message
}

const TEX = 'declare const tex: texture_2d<f32>\ndeclare const smp: sampler\n'
const ARR = 'declare const atlas: texture_2d_array<f32>\ndeclare const smp: sampler\n'

describe('a texture and a sampler declaration', () => {
  it('is a binding with a handle type, written bare', () => {
    const r = compileTsSource(`"use typeshade";\n${TEX}export function f(): f32 {\n  return 1.;\n}`)
    expect(r.diagnostics).toEqual([])
    expect(r.bindings.map((b) => [b.name, typeKey(b.type), b.binding])).toEqual([
      ['tex', 'texture_2d<f32>', 0],
      ['smp', 'sampler', 1],
    ])
  })

  it('emits the WGSL handle declarations, and fuses into a sampler2D on GLSL', () => {
    const c = compile(`
      "use typeshade";
      ${TEX}
      class VsOut {
        @builtin("position") pos: vec4
        @location(0) uv: vec2
      }
      class Color {
        @location(0) color: vec4
      }
      @vertex
      export function vs(@builtin("vertex_index") i: u32): VsOut {
        return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
      }
      @fragment
      export function fs(v: VsOut): Color {
        return { color: textureSample(tex, smp, v.uv) };
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('@group(0) @binding(0) var tex: texture_2d<f32>;')
    expect(c.wgsl).toContain('@group(0) @binding(1) var smp: sampler;')
    // GLSL ES 3.00 has no separate sampler object: the pair becomes one combined sampler,
    // and the sampler argument disappears from the call.
    expect(c.glsl?.fragment).toContain('uniform sampler2D tex;')
    expect(c.glsl?.fragment).toContain('texture(tex, uv)')
  })

  it('takes the integer element kinds and the array dimension', () => {
    const w = wgslOf(`
      declare const ti: texture_2d<i32>
      declare const tu: texture_2d<u32>
      declare const ta: texture_2d_array<f32>
      export function f(): f32 {
        return 1.;
      }
    `)
    expect(w).toContain('var ti: texture_2d<i32>;')
    expect(w).toContain('var tu: texture_2d<u32>;')
    expect(w).toContain('var ta: texture_2d_array<f32>;')
  })

  it('refuses a handle declared let, and an element kind that is not a native scalar', () => {
    expect(
      diagnose('declare let tex: texture_2d<f32>\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('"tex" is a texture_2d; declare it const, not let.')
    expect(
      diagnose('declare const tex: texture_2d<f64>\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('texture_2d<T> T must be f32, i32, or u32.')
  })
})

describe('textureSample and its siblings', () => {
  it('picks the neutral id from the texture, not from an argument count', () => {
    // A 2D array sample is the id `textureSampleArray`, which WGSL spells textureSample with a
    // layer argument and GLSL folds into a vec3 coordinate — the same choice the EDSL's
    // overload makes, so the two surfaces build the same node.
    const r = compileTsSource(
      `"use typeshade";\n${ARR}export function f(uv: vec2): vec4 {\n  return textureSample(atlas, smp, uv, 1);\n}`,
    )
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]!
    if (ret.s !== 'return' || ret.expr?.op !== 'call') throw new Error('expected a call')
    expect(ret.expr.fn).toBe('textureSampleArray')
    expect(typeKey(ret.expr.type)).toBe('vec4<f32>')
  })

  it('types a layer as an i32 and a textureLoad level as a u32', () => {
    // A bare number lowers to f32 here, and `textureLoad(t, c, 0.0)` is not valid WGSL — the
    // bug the EDSL fixed in its own layerArg/levelArg, fixed the same way and to the same
    // types so the two surfaces emit the same text.
    expect(
      wgslOf(
        `${ARR}export function f(uv: vec2): vec4 {\n  return textureSample(atlas, smp, uv, 1);\n}`,
      ),
    ).toContain('textureSample(atlas, smp, uv, 1)')
    expect(
      wgslOf(
        'declare const t: texture_2d<u32>\nexport function f(c: vec2i): vec4u {\n  return textureLoad(t, c, 0);\n}',
      ),
    ).toContain('textureLoad(t, c, 0u)')
    expect(
      wgslOf(
        'declare const t: texture_2d_array<u32>\nexport function f(c: vec2i): vec4u {\n  return textureLoad(t, c, 2, 0);\n}',
      ),
    ).toContain('textureLoad(t, c, 2, 0u)')
  })

  it('carries the texture element into the result type', () => {
    expect(
      wgslOf(
        'declare const t: texture_2d<i32>\nexport function f(c: vec2i): vec4i {\n  return textureLoad(t, c, 0);\n}',
      ),
    ).toContain('-> vec4<i32>')
    expect(
      wgslOf(`${TEX}export function f(): vec2u {\n  return textureDimensions(tex);\n}`),
    ).toContain('-> vec2<u32>')
    expect(
      wgslOf(`${ARR}export function f(): u32 {\n  return textureNumLayers(atlas);\n}`),
    ).toContain('-> u32')
  })

  it('refuses a sampled read of an integer texture, a layer query on a plain 2D, and a bad arity', () => {
    expect(
      diagnose(
        'declare const t: texture_2d<u32>\ndeclare const smp: sampler\nexport function f(uv: vec2): vec4u {\n  return textureSample(t, smp, uv);\n}',
      ),
    ).toBe('textureSample needs a float texture; texture_2d<u32> is read with textureLoad.')
    expect(diagnose(`${TEX}export function f(): u32 {\n  return textureNumLayers(tex);\n}`)).toBe(
      'textureNumLayers needs a texture_2d_array; a plain 2D texture has no layers.',
    )
    // The expected count follows the TEXTURE's shape, so the message names it.
    expect(
      diagnose(
        `${ARR}export function f(uv: vec2): vec4 {\n  return textureSample(atlas, smp, uv);\n}`,
      ),
    ).toBe('textureSample on a texture_2d_array<f32> expects 4 argument(s), got 3.')
    expect(
      diagnose('export function f(uv: vec2): vec4 {\n  return textureSample(uv, uv, uv);\n}'),
    ).toBe('textureSample takes a texture as its first argument.')
  })
})

describe('override constants', () => {
  it('declares with a stated default, or the type zero without one', () => {
    const r = compileTsSource(`
      "use typeshade";
      declare const quality: override<f32>
      const steps: override<i32> = 8
      const fancy: override<bool> = true
      const bias: override<f32> = -0.5
      export function f(): f32 {
        return quality;
      }
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.overrides.map((o) => [o.name, typeKey(o.type), o.default])).toEqual([
      ['quality', 'f32', 0],
      ['steps', 'i32', 8],
      ['fancy', 'bool', true],
      ['bias', 'f32', -0.5],
    ])
  })

  it('emits an override on WGSL and a #define on GLSL, and takes no bind slot', () => {
    // A render entry, because `compile()` returns `glsl` only for a module that has stages to
    // emit — and the #define is what a GLSL ES 3.00 target has in place of a specialization
    // constant, so it is worth asserting on the real stage rather than on the module form.
    const c = compile(`
      "use typeshade";
      const quality: override<f32> = 0.5
      // A STRUCT uniform, not a loose scalar: GLSL ES 3.00 has no default-block home for the
      // latter and refuses the module, which would leave the GLSL half undefined for a reason
      // that has nothing to do with overrides.
      class U {
        k: f32
      }
      declare const camera: uniform<U>
      class VsOut {
        @builtin("position") pos: vec4
      }
      class Color {
        @location(0) color: vec4
      }
      @vertex
      export function vs(@builtin("vertex_index") i: u32): VsOut {
        return { pos: vec4(0., 0., 0., 1.) };
      }
      @fragment
      export function fs(): Color {
        return { color: vec4(quality * camera.k, 0., 0., 1.) };
      }
    `)
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(c.wgsl).toContain('override quality: f32 = 0.5;')
    expect(c.glsl?.fragment).toContain('#define quality 0.5')
    // The uniform still takes binding 0: an override is not a binding.
    expect(c.module.bindings.map((b) => [b.name, b.binding])).toEqual([['camera', 0]])
  })

  it('reads as an overrideref, which no pass folds', () => {
    const r = compileTsSource(`
      "use typeshade";
      const quality: override<f32> = 2.
      export function f(): f32 {
        return quality * 2.;
      }
    `)
    expect(r.diagnostics).toEqual([])
    const ret = r.funcs[0]!.body[0]!
    if (ret.s !== 'return' || ret.expr?.op !== 'binop') throw new Error('expected a binop')
    expect(ret.expr.a.op).toBe('overrideref')
    // …and it is still a binop in the emit: a module const would have folded to 4.0.
    expect(r.wgsl).toContain('(quality * 2.0)')
  })

  it('refuses a non-scalar type, a non-literal default, a let, and a write', () => {
    expect(
      diagnose('const v: override<vec3> = 1.\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "v" must be f32, i32, u32 or bool, not vec3<f32>.')
    expect(
      diagnose(
        'const k: f32 = 2.\nconst q: override<f32> = k\nexport function f(): f32 {\n  return q;\n}',
      ),
    ).toContain('default must be a literal')
    expect(
      diagnose('declare let q: override<f32>\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "q" must be const, not let.')
    expect(
      diagnose(
        'const q: override<f32> = 1.\nexport function f(): f32 {\n  q = 2.;\n  return q;\n}',
      ),
    ).toBe('Cannot assign to "q" — it is an override constant, set by the pipeline.')
  })
})
