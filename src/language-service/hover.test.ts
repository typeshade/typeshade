import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'
import { spellShaderType } from './hover.js'
import {
  arrayT,
  boolT,
  f32T,
  f64T,
  i32T,
  mat4x4fT,
  samplerT,
  structT,
  texture2dArrayfT,
  texture2dMsfT,
  texture2dfT,
  u32T,
  vec3f64T,
  vec3fT,
  vec3uT,
  voidT,
  type ShaderType,
} from '../core/ir/types.js'

describe('getHover', () => {
  it('documents a GPU type name in a type position', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\nexport function f(): vec4 {\n  return vec4(0., 0., 0., 1.)\n}\n'
    service.openDocument('a.ts', source)
    const offset = source.indexOf('vec4')
    const position = service.positionAt('a.ts', offset)
    const hover = service.getHover('a.ts', position)
    expect(hover?.contents).toContain('four-component')
  })

  it('documents an attribute name', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n@vertex\nexport function vs(): f32 {\n  return 1\n}\n'
    service.openDocument('b.ts', source)
    const offset = source.indexOf('@vertex') + 2
    const position = service.positionAt('b.ts', offset)
    const hover = service.getHover('b.ts', position)
    expect(hover?.contents).toContain('vertex')
    expect(hover?.contents.toLowerCase()).toContain('entry point')
  })

  it('documents a builtin name inside @builtin("...")', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nclass Clip {\n  @builtin("vertex_index") i: u32\n}\n'
    service.openDocument('c.ts', source)
    const offset = source.indexOf('vertex_index') + 2
    const position = service.positionAt('c.ts', offset)
    const hover = service.getHover('c.ts', position)
    expect(hover?.contents).toContain('vertex')
  })

  it('falls back to TypeScript quick info for a user-defined function', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nexport function origin(): f32 {\n  return 1\n}\n'
    service.openDocument('d.ts', source)
    const offset = source.indexOf('origin')
    const position = service.positionAt('d.ts', offset)
    const hover = service.getHover('d.ts', position)
    expect(hover?.contents).toContain('origin')
    expect(hover?.contents).toContain('f32')
  })

  it('returns undefined off in whitespace with nothing to document', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n\n\nexport function f(): f32 {\n  return 1\n}\n'
    service.openDocument('e.ts', source)
    const position = service.positionAt('e.ts', source.indexOf('\n\n\n') + 1)
    expect(service.getHover('e.ts', position)).toBeUndefined()
  })
})

describe('getHover: resource bindings (from the cached front-end analysis, §8)', () => {
  const source =
    '"use typeshade";\n' +
    'class Camera {\n' +
    '  position: vec4\n' +
    '}\n' +
    'declare const camera: uniform<Camera>\n' +
    '@fragment\n' +
    'export function fs(): vec4 {\n' +
    '  const local = camera\n' +
    '  return camera.position\n' +
    '}\n'

  it('adds the address space and @group/@binding slot under the quick info of a binding', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('r.ts', source)
    const position = service.positionAt('r.ts', source.lastIndexOf('camera.position'))
    const hover = service.getHover('r.ts', position)
    expect(hover?.contents).toContain('const camera: Camera')
    expect(hover?.contents).toContain('uniform resource at @group(0) @binding(0)')
  })

  it('says nothing about a binding for a local that merely holds one', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('r.ts', source)
    const position = service.positionAt('r.ts', source.indexOf('local'))
    const hover = service.getHover('r.ts', position)
    expect(hover?.contents).toContain('local')
    expect(hover?.contents).not.toContain('@binding')
  })
})

describe("getHover: the compiler's type for a symbol declared in this document", () => {
  // The types below are the ones the FRONT END gave each declaration. TypeScript, over the
  // ambient lib, says `number` for `x`, `0.5` for `half` and `vec3` for `v`, because the GPU
  // scalar types brand `number` optionally and a bare numeric literal is assignable to all of
  // them (`ambient.ts`); none of those three is what the compiler lowered.
  const source = [
    '"use typeshade";',
    'class Vertex {',
    '  @location(0) pos: vec3',
    '}',
    'declare const camera: uniform<Vertex>',
    'const K: f32 = 2.;',
    'export function clamp01(x: f32): f32 {',
    '  return x;',
    '}',
    '@fragment',
    'export function fs(v: vec3, p: Vertex): vec4 {',
    '  let x = 1.;',
    '  const half = 0.5;',
    '  let n = u32(1);',
    '  {',
    '    let x = u32(7);',
    '    n = x;',
    '  }',
    '  return vec4(x * K, half, p.pos.x, clamp01(v.x));',
    '}',
  ].join('\n')

  function hoverAt(offset: number): string | undefined {
    const service = createTypeshadeLanguageService()
    service.openDocument('t.ts', source)
    return service.getHover('t.ts', service.positionAt('t.ts', offset))?.contents
  }

  it('shows f32, not number, for a local bound to a numeric literal', () => {
    const declaration = hoverAt(source.indexOf('let x = 1.') + 4)
    expect(declaration).toContain('let x: f32')
    expect(declaration).not.toContain('number')
  })

  it('shows the same f32 at a use of that local', () => {
    const use = hoverAt(source.indexOf('x * K'))
    expect(use).toContain('let x: f32')
    expect(use).not.toContain('number')
  })

  it('shows f32 for a const bound to a fractional literal, not the literal type', () => {
    expect(hoverAt(source.indexOf('const half') + 6)).toContain('const half: f32')
    expect(hoverAt(source.lastIndexOf('half'))).toContain('const half: f32')
  })

  it('shows u32 for a local bound to a u32 conversion', () => {
    expect(hoverAt(source.indexOf('let n = u32') + 4)).toContain('let n: u32')
  })

  it('spells a parameter with the WGSL element type', () => {
    expect(hoverAt(source.indexOf('v: vec3'))).toContain('(parameter) v: vec3<f32>')
    expect(hoverAt(source.indexOf('v.x'))).toContain('(parameter) v: vec3<f32>')
  })

  it('shows a module const with the compiler type', () => {
    expect(hoverAt(source.indexOf('const K') + 6)).toContain('const K: f32')
    expect(hoverAt(source.indexOf('K, half'))).toContain('const K: f32')
  })

  it('shows a function signature with the compiler types', () => {
    expect(hoverAt(source.indexOf('function clamp01') + 9)).toContain(
      'function clamp01(x: f32): f32',
    )
    expect(hoverAt(source.indexOf('clamp01(v.x)'))).toContain('function clamp01(x: f32): f32')
  })

  it('resolves a shadowing declaration by position, outer and inner', () => {
    expect(hoverAt(source.indexOf('let x = u32(7)') + 4)).toContain('let x: u32')
    expect(hoverAt(source.indexOf('n = x') + 4)).toContain('let x: u32')
    expect(hoverAt(source.indexOf('let x = 1.') + 4)).toContain('let x: f32')
  })

  it('shows a struct field access with the field type the compiler collected', () => {
    expect(hoverAt(source.indexOf('p.pos.x') + 2)).toContain('(property) Vertex.pos: vec3<f32>')
  })

  it('keeps the resource line under a binding, and names its struct', () => {
    const hover = hoverAt(source.indexOf('camera'))
    expect(hover).toContain('const camera: Vertex')
    expect(hover).toContain('uniform resource at @group(0) @binding(0)')
  })

  it("leaves TypeScript's quick info for a data class name", () => {
    expect(hoverAt(source.indexOf('class Vertex') + 6)).toContain('class Vertex')
  })
})

describe('getHover: a symbol declared in another document', () => {
  it("keeps TypeScript's quick info, since the compiler's table is this document's", () => {
    const service = createTypeshadeLanguageService()
    service.openDocument(
      '/lib.ts',
      '"use typeshade"\nexport const K = 1.\nexport function k(): f32 {\n  return 1.\n}\n',
    )
    const main =
      '"use typeshade"\nimport { k, K } from "./lib.ts"\nexport function f(): f32 {\n  return k() * K\n}\n'
    service.openDocument('/main.ts', main)
    const hover = service.getHover(
      '/main.ts',
      service.positionAt('/main.ts', main.indexOf('* K') + 2),
    )
    // `K` is declared in `/lib.ts`, so `/main.ts`'s symbol table says nothing about it and
    // TypeScript answers, exactly as before: a span belongs to the file it indexes.
    expect(hover?.contents).toContain('const K: 1')
  })
})

describe('spellShaderType', () => {
  // One row per `ShaderType` kind, so a new kind (or a changed spelling) shows up here as a
  // diff. The f64 family is the reason this function exists at all: `wgslType` throws SD0040
  // on it, because no backend may write a pre-lowering type, and a hover still has to name it.
  const rows: readonly (readonly [ShaderType, string])[] = [
    [f32T, 'f32'],
    [i32T, 'i32'],
    [u32T, 'u32'],
    [boolT, 'bool'],
    [f64T, 'f64'],
    [vec3fT, 'vec3<f32>'],
    [vec3uT, 'vec3<u32>'],
    [vec3f64T, 'vec3<f64>'],
    [mat4x4fT, 'mat4x4<f32>'],
    [{ kind: 'mat', n: 4, elem: 'f64' }, 'mat4x4<f64>'],
    [structT('Camera'), 'Camera'],
    [arrayT(f32T, 4), 'array<f32, 4>'],
    [arrayT(f32T), 'array<f32>'],
    [arrayT(vec3f64T, 2), 'array<vec3<f64>, 2>'],
    [texture2dfT, 'texture_2d<f32>'],
    [texture2dArrayfT, 'texture_2d_array<f32>'],
    [texture2dMsfT, 'texture_multisampled_2d<f32>'],
    [samplerT, 'sampler'],
    [voidT, 'void'],
  ]

  for (const [type, spelling] of rows) {
    it(`spells ${spelling}`, () => {
      expect(spellShaderType(type)).toBe(spelling)
    })
  }
})
