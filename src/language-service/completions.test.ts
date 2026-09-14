import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

describe('getCompletions: TypeShade context items', () => {
  it('offers the attribute list right after @', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\n@ver'
    service.openDocument('a.ts', source)
    const items = service.getCompletions('a.ts', { line: 1, character: 4 })
    expect(items.map((i) => i.label)).toContain('@vertex')
    expect(items.every((i) => i.kind === 'attribute')).toBe(true)
  })

  it('offers WgslBuiltinName entries inside @builtin("', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nclass Clip {\n  @builtin("ver") pos: vec4\n}\n'
    service.openDocument('b.ts', source)
    const offset = source.indexOf('"ver') + 4
    const position = service.positionAt('b.ts', offset)
    const items = service.getCompletions('b.ts', position)
    expect(items.map((i) => i.label)).toContain('vertex_index')
    expect(items.every((i) => i.kind === 'builtin')).toBe(true)
  })

  it('filters @builtin(" completions to the enclosing function\'s stage', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\n@fragment\nexport function fs(@builtin("") x: u32): f32 {\n  return x\n}\n'
    service.openDocument('c.ts', source)
    const offset = source.indexOf('@builtin("') + '@builtin("'.length
    const position = service.positionAt('c.ts', offset)
    const items = service.getCompletions('c.ts', position)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('position')
    expect(labels).not.toContain('vertex_index')
  })

  it('offers vec2/vec3/vec4 as snippet completions', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade";\nexport function f(): vec4 {\n  return vec\n}\n'
    service.openDocument('d.ts', source)
    const offset = source.lastIndexOf('vec') + 3
    const position = service.positionAt('d.ts', offset)
    const items = service.getCompletions('d.ts', position)
    const vec4Item = items.find((i) => i.label === 'vec4')
    expect(vec4Item?.kind).toBe('snippet')
    expect(vec4Item?.insertTextFormat).toBe('snippet')
    expect(vec4Item?.insertText).toContain('vec4(')
  })

  it('dedupes completion items by label', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade";\nexport function f(): vec4 {\n  return vec4(0., 0., 0., 1.)\n}\n'
    service.openDocument('e.ts', source)
    const offset = source.indexOf('return vec4')
    const position = service.positionAt('e.ts', offset)
    const items = service.getCompletions('e.ts', position)
    const labels = items.map((i) => i.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
