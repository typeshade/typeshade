import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

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
