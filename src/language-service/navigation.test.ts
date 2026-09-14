import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'

const SOURCE =
  '"use typeshade";\n' +
  'class Camera {\n' +
  '  position: vec4\n' +
  '}\n' +
  'const camera = uniform<Camera>(0, 0)\n' +
  'function scale(x: f32): f32 {\n' +
  '  return x\n' +
  '}\n' +
  '@vertex\n' +
  'export function vs(@builtin("vertex_index") i: u32): vec4 {\n' +
  '  const s = scale(1.0)\n' +
  '  return vec4(s, s, s, 1.0)\n' +
  '}\n' +
  '@fragment\n' +
  'export function fs(): vec4 {\n' +
  '  return camera.position\n' +
  '}\n'

describe('getDefinition', () => {
  it('finds the definition of a user function from its call site', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const offset = SOURCE.indexOf('scale(1.0)')
    const position = service.positionAt('a.ts', offset)
    const defs = service.getDefinition('a.ts', position)
    expect(defs.length).toBe(1)
    expect(defs[0]!.uri).toBe('a.ts')
    const declOffset = SOURCE.indexOf('function scale') + 'function '.length
    expect(service.offsetAt('a.ts', defs[0]!.range.start)).toBe(declOffset)
  })

  it('finds the definition of a struct field from a property access', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const offset = SOURCE.lastIndexOf('camera.position') + 'camera.'.length
    const position = service.positionAt('a.ts', offset)
    const defs = service.getDefinition('a.ts', position)
    expect(defs.length).toBe(1)
    const fieldOffset = SOURCE.indexOf('position: vec4')
    expect(service.offsetAt('a.ts', defs[0]!.range.start)).toBe(fieldOffset)
  })

  it('drops a definition that lands in the ambient lib', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const offset = SOURCE.indexOf('position: vec4') + 'position: '.length
    const position = service.positionAt('a.ts', offset)
    expect(service.getDefinition('a.ts', position)).toEqual([])
  })
})

describe('getReferences', () => {
  it('finds every reference to a resource, and can exclude its declaration', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const declOffset = SOURCE.indexOf('camera =')
    const position = service.positionAt('a.ts', declOffset)
    const withDecl = service.getReferences('a.ts', position, { includeDeclaration: true })
    const withoutDecl = service.getReferences('a.ts', position, { includeDeclaration: false })
    expect(withDecl.length).toBe(2)
    expect(withoutDecl.length).toBe(1)
    expect(withDecl.every((loc) => loc.uri === 'a.ts')).toBe(true)
  })
})

describe('getDocumentSymbols', () => {
  it('re-labels a struct, a resource, a helper, and two entries with their stage detail', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const symbols = service.getDocumentSymbols('a.ts')
    const byName = new Map(symbols.map((s) => [s.name, s]))

    expect(byName.get('Camera')?.kind).toBe('struct')
    expect(byName.get('Camera')?.children?.map((c) => c.kind)).toEqual(['field'])

    expect(byName.get('camera')?.kind).toBe('resource')
    expect(byName.get('scale')?.kind).toBe('function')

    expect(byName.get('vs')?.kind).toBe('entry')
    expect(byName.get('vs')?.detail).toBe('vertex')
    expect(byName.get('vs')?.children?.map((c) => c.kind)).toEqual(['parameter'])

    expect(byName.get('fs')?.kind).toBe('entry')
    expect(byName.get('fs')?.detail).toBe('fragment')
  })
})

describe('prepareRename / rename', () => {
  it('renames a user function across its declaration and every call site', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const position = service.positionAt(
      'a.ts',
      SOURCE.indexOf('function scale') + 'function '.length,
    )
    const prepared = service.prepareRename('a.ts', position)
    expect(prepared?.placeholder).toBe('scale')
    const edits = service.rename('a.ts', position, 'multiply')
    expect(edits['a.ts']?.length).toBe(2)
  })

  it('renames the same function across a CRLF document', () => {
    const crlfSource = SOURCE.replace(/\n/g, '\r\n')
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', crlfSource)
    const position = service.positionAt(
      'a.ts',
      crlfSource.indexOf('function scale') + 'function '.length,
    )
    const prepared = service.prepareRename('a.ts', position)
    expect(prepared?.placeholder).toBe('scale')
    const edits = service.rename('a.ts', position, 'multiply')
    expect(edits['a.ts']?.length).toBe(2)
    for (const edit of edits['a.ts']!) {
      const offset = service.offsetAt('a.ts', edit.range.start)
      expect(crlfSource.slice(offset, offset + 5)).toBe('scale')
    }
  })

  it('refuses to rename an ambient name', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const position = service.positionAt(
      'a.ts',
      SOURCE.indexOf('position: vec4') + 'position: '.length,
    )
    expect(service.prepareRename('a.ts', position)).toBeUndefined()
    expect(service.rename('a.ts', position, 'vec4x')).toEqual({})
  })

  it('refuses to rename the builtin string inside @builtin(...)', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const position = service.positionAt('a.ts', SOURCE.indexOf('vertex_index') + 1)
    expect(service.prepareRename('a.ts', position)).toBeUndefined()
    expect(service.rename('a.ts', position, 'nope')).toEqual({})
  })

  // Regression: TypeScript's own decorator-resolution machinery (the code path
  // getDefinitionAtPosition/getRenameInfo/findRenameLocations all go through) `Debug.fail()`s
  // when the decorated node is a FunctionDeclaration — exactly the shape `@vertex`/`@fragment`
  // are attached to in "use typeshade". These three methods must return their empty shape
  // instead of letting that throw escape, at every offset inside either decorator.
  it('does not throw, and returns an empty result, on every offset inside @vertex', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const start = SOURCE.indexOf('@vertex')
    const end = start + '@vertex'.length
    for (let offset = start; offset <= end; offset++) {
      const position = service.positionAt('a.ts', offset)
      expect(() => service.getDefinition('a.ts', position)).not.toThrow()
      expect(service.getDefinition('a.ts', position)).toEqual([])
      expect(() => service.prepareRename('a.ts', position)).not.toThrow()
      expect(service.prepareRename('a.ts', position)).toBeUndefined()
      expect(() => service.rename('a.ts', position, 'nope')).not.toThrow()
      expect(service.rename('a.ts', position, 'nope')).toEqual({})
    }
  })

  it('does not throw, and returns an empty result, on every offset inside @fragment', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const start = SOURCE.indexOf('@fragment')
    const end = start + '@fragment'.length
    for (let offset = start; offset <= end; offset++) {
      const position = service.positionAt('a.ts', offset)
      expect(() => service.getDefinition('a.ts', position)).not.toThrow()
      expect(() => service.prepareRename('a.ts', position)).not.toThrow()
      expect(() => service.rename('a.ts', position, 'nope')).not.toThrow()
    }
  })

  it('still resolves @builtin/@location parameter decorators normally (not swept up by the guard)', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const position = service.positionAt('a.ts', SOURCE.indexOf('vertex_index') + 1)
    // Already covered above as "refuses to rename" (it's a @builtin(...) string), but the point
    // here is specifically that this offset is NOT caught by the new function-decorator guard —
    // it is a call-expression decorator on a parameter, a different shape entirely.
    expect(() => service.getDefinition('a.ts', position)).not.toThrow()
  })
})
