import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

const SOURCE =
  '"use typeshade";\n' +
  'class Camera {\n' +
  '  view: mat4\n' +
  '}\n' +
  'declare const camera: uniform<Camera>\n' +
  'const TWO = 2.\n' +
  '@vertex\n' +
  'export function vs(@builtin("vertex_index") i: u32): Camera {\n' +
  '  return camera\n' +
  '}\n'

describe("getDocumentSymbols: re-labelled with the front end's own declarations", () => {
  it('classifies a struct, an entry, a resource, and a constant', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const symbols = service.getDocumentSymbols('a.ts')
    const byName = new Map(symbols.map((s) => [s.name, s]))
    expect(byName.get('Camera')?.kind).toBe('struct')
    expect(byName.get('camera')?.kind).toBe('resource')
    expect(byName.get('TWO')?.kind).toBe('constant')
    expect(byName.get('vs')?.kind).toBe('entry')
    expect(byName.get('vs')?.detail).toBe('vertex')
    expect(byName.get('vs')?.children?.map((c) => c.name)).toEqual(['i'])
  })
})

describe('getDefinition / getReferences', () => {
  it('finds the definition of a resource used inside a function body', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const useOffset = SOURCE.lastIndexOf('camera')
    const position = service.positionAt('a.ts', useOffset)
    const defs = service.getDefinition('a.ts', position)
    expect(defs.length).toBeGreaterThan(0)
    expect(defs[0]!.uri).toBe('a.ts')
  })

  it('finds every reference to a resource, and can exclude its declaration', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const declOffset = SOURCE.indexOf('camera:')
    const position = service.positionAt('a.ts', declOffset)
    const withDecl = service.getReferences('a.ts', position, { includeDeclaration: true })
    const withoutDecl = service.getReferences('a.ts', position, { includeDeclaration: false })
    expect(withDecl.length).toBe(withoutDecl.length + 1)
  })
})

describe('prepareRename / rename', () => {
  it('renames a user function across its declaration and its call site', () => {
    const source =
      '"use typeshade";\nexport function origin(): f32 {\n  return 1\n}\nexport function f(): f32 {\n  return origin()\n}\n'
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', source)
    const position = service.positionAt('a.ts', source.indexOf('origin'))
    const prepared = service.prepareRename('a.ts', position)
    expect(prepared?.placeholder).toBe('origin')
    const edits = service.rename('a.ts', position, 'start')
    expect(edits['a.ts']?.length).toBe(2)
  })
})

describe('getSemanticTokens', () => {
  it('marks the entry function name with the entry modifier and a GPU-typed parameter', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const tokens = service.getSemanticTokens('a.ts')
    const vs = tokens.find((t) => t.type === 'function' && t.modifiers.includes('entry'))
    expect(vs).toBeDefined()
    const struct = tokens.find((t) => t.type === 'struct')
    expect(struct).toBeDefined()
  })
})
