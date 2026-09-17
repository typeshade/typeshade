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

describe('what the review of #54 found (the four majors)', () => {
  it('checks an override default against its declared type', () => {
    // `defaultValue` only asked whether the initializer was a literal, so
    // `const fancy: override<bool> = 1` emitted `override fancy: bool = 1.0;` — Tint: "cannot
    // convert value of type 'abstract-float' to type 'bool'", ANGLE: "boolean expression
    // expected". `OverrideDecl.default` is a `number | boolean`, so both spellings fit the
    // field and both backends print what they are given; nothing downstream could catch it.
    expect(
      diagnose('const fancy: override<bool> = 1\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "fancy" is bool; its default must be true or false.')
    expect(
      diagnose('const q: override<f32> = true\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "q" is f32; its default must be a number.')
    expect(
      diagnose('const q: override<i32> = false\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "q" is i32; its default must be a number.')
    expect(
      diagnose('const q: override<i32> = 1.5\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "q" is i32; its default must be a whole number.')
    expect(
      diagnose('const q: override<u32> = -1\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('override "q" is u32; its default cannot be negative.')
    // …and every well-typed default still lands, negative i32 included.
    for (const [src, want] of [
      ['const q: override<bool> = true', 'override q: bool = true;'],
      ['const q: override<f32> = 1.5', 'override q: f32 = 1.5;'],
      ['const q: override<i32> = -2', 'override q: i32 = -2;'],
      ['declare const q: override<bool>', 'override q: bool = false;'],
    ] as const) {
      const r = compileTsSource(
        `"use typeshade";\n${src}\nexport function f(): f32 {\n  return 1.;\n}`,
      )
      expect(r.diagnostics).toEqual([])
      expect(r.wgsl).toContain(want)
    }
  })

  it('reports a repeated or colliding module-scope name instead of throwing', () => {
    // `scope.define` THROWS on a repeat, and it was the first thing to see these — so
    // `compile()` raised an exception and the language service's `getDiagnostics()` did too,
    // where the merge base had shown a squiggle.
    for (const [src, want] of [
      ['const q: override<f32> = 1.\nconst q: override<f32> = 2.', 'Duplicate override "q".'],
      [
        'declare const tex: texture_2d<f32>\ndeclare const tex: texture_2d<f32>',
        'Duplicate resource "tex".',
      ],
      ['declare const u: uniform<f32>\ndeclare const u: uniform<f32>', 'Duplicate resource "u".'],
      [
        'const q: f32 = 1.\nconst q: override<f32> = 2.',
        '"q" is declared as a module const and as an override; one module-scope name means one thing.',
      ],
      [
        // The #define check below sees this one first and drops the override, so the
        // cross-collector message never fires — but it is REPORTED either way, which is the
        // property under test: a repeat must not leave through `scope.define`.
        'declare const u: uniform<f32>\nconst u: override<f32> = 1.',
        'override "u" collides with a struct field or resource of that name. On GLSL ES 3.00 ' +
          'an override is a #define, so it would rewrite that declaration; rename the override.',
      ],
    ] as const) {
      const body = `"use typeshade";\n${src}\nexport function f(): f32 {\n  return 1.;\n}`
      expect(() => compileTsSource(body)).not.toThrow()
      expect(compileTsSource(body).diagnostics.map((d) => d.message)).toContain(want)
    }
  })

  it('refuses an override whose name the GLSL #define would capture', () => {
    // On GLSL ES 3.00 an override is a `#define`, and a #define rewrites every later
    // occurrence of its name — a declaration included. `const uv: override<f32> = 0.85` beside
    // a `@location(0) uv` varying emitted `#define uv 0.85` above `in vec2 uv;`, which ANGLE
    // reads as `in vec2 0.85;`. WGSL was fine and nothing said so.
    const prog = (name: string): string => `
      "use typeshade";
      class VsOut {
        @builtin("position") pos: vec4
        @location(0) uv: vec2
      }
      class Color {
        @location(0) color: vec4
      }
      class U {
        k: f32
      }
      declare const params: uniform<U>
      const ${name}: override<f32> = 0.85
      @vertex
      export function vs(@builtin("vertex_index") i: u32): VsOut {
        return { pos: vec4(f32(i), 0., 0., 1.), uv: vec2(0., 0.) };
      }
      @fragment
      export function fs(v: VsOut): Color {
        return { color: vec4(v.uv, ${name} + params.k, 1.) };
      }
    `
    for (const name of ['uv', 'color', 'k', 'params']) {
      expect(diagnose(prog(name))).toContain(`override "${name}" collides with a struct field`)
    }
    // A name of its own still compiles, and the #define is still what GLSL gets.
    const ok = compile(prog('quality'))
    expect(ok.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(ok.glsl?.fragment).toContain('#define quality 0.85')
  })

  it('refuses a fractional or negative texture layer and mip level', () => {
    // `intArg` bailed on these and its comment claimed a downstream check that does not exist.
    // `textureLoad(t, c, 2.5)` and `textureSample(atlas, smp, uv, 1.5)` emitted with zero
    // diagnostics; Tint refuses the WGSL and GLSL ES 3.00 silently rounds — the divergence the
    // EDSL's own layerArg/levelArg raise SD0015 for.
    const prog = (call: string): string => `
      "use typeshade";
      class Color {
        @location(0) color: vec4
      }
      declare const atlas: texture_2d_array<f32>
      declare const tex: texture_2d<f32>
      declare const smp: sampler
      @fragment
      export function fs(@builtin("position") p: vec4): Color {
        const c: vec2i = vec2i(i32(0), i32(0));
        return { color: ${call} };
      }
    `
    expect(diagnose(prog('textureLoad(tex, c, 2.5)'))).toBe(
      'A texture mip level must be a whole number of 0 or more, got 2.5. WGSL rejects a ' +
        'fractional or negative one and GLSL ES 3.00 silently rounds it, so the two targets ' +
        'would disagree.',
    )
    expect(diagnose(prog('textureLoad(tex, c, -1)'))).toContain('got -1')
    expect(diagnose(prog('textureSample(atlas, smp, p.xy, 1.5)'))).toContain(
      'A texture layer must be a whole number of 0 or more, got 1.5',
    )
    expect(diagnose(prog('textureSample(atlas, smp, p.xy, -1)'))).toContain('layer')
    expect(diagnose(prog('textureLoad(atlas, c, 1, 2.5)'))).toContain('mip level')
    // …and a whole one still lowers to the integer the neutral id wants.
    const ok = compile(prog('textureLoad(atlas, c, 1, 2)'))
    expect(ok.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(ok.wgsl).toContain('textureLoad(atlas, c, 1, 2u)')
  })
})

describe('the smaller findings of that review', () => {
  it('reports a texture element that is not a type name, rather than defaulting to f32', () => {
    // `typeNameOfArg(args[0]) ?? 'f32'` made `texture_2d<{ a: f32 }>` a `texture_2d<f32>`.
    for (const t of ['texture_2d<{ a: f32 }>', 'texture_2d<f32[]>', 'texture_2d<bool>']) {
      expect(diagnose(`declare const t: ${t}\nexport function f(): f32 {\n  return 1.;\n}`)).toBe(
        'texture_2d<T> T must be f32, i32, or u32.',
      )
    }
  })

  it('refuses a type argument on a sampler, and a handle inside uniform<>', () => {
    expect(
      diagnose('declare const s: sampler<f32>\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toBe('sampler takes no type argument.')
    expect(
      diagnose('declare const s: uniform<sampler>\nexport function f(): f32 {\n  return 1.;\n}'),
    ).toContain('is a sampler; it is declared bare, not inside uniform<...>')
    expect(
      diagnose(
        'declare const s: uniform<texture_2d<f32>>\nexport function f(): f32 {\n  return 1.;\n}',
      ),
    ).toContain('is a texture; it is declared bare, not inside uniform<...>')
  })
})
