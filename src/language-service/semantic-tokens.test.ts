import { describe, expect, it } from 'vitest'
import { createTypeshadeLanguageService } from './service.js'
import type { TypeshadeSemanticToken } from './types.js'

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

function tokenAt(
  tokens: readonly TypeshadeSemanticToken[],
  service: ReturnType<typeof createTypeshadeLanguageService>,
  uri: string,
  offset: number,
): TypeshadeSemanticToken | undefined {
  const position = service.positionAt(uri, offset)
  return tokens.find((t) => t.line === position.line && t.character === position.character)
}

describe('getSemanticTokens', () => {
  it('gives a struct-field GPU type the type+gpu classification', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const tokens = service.getSemanticTokens('a.ts')
    const token = tokenAt(
      tokens,
      service,
      'a.ts',
      SOURCE.indexOf('vec4', SOURCE.indexOf('position')),
    )
    expect(token?.type).toBe('type')
    expect(token?.modifiers).toContain('gpu')
  })

  it('classifies the struct name as struct and the resource as resource everywhere it appears', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const tokens = service.getSemanticTokens('a.ts')
    const structToken = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('Camera'))
    expect(structToken?.type).toBe('struct')

    const declToken = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('camera ='))
    expect(declToken?.type).toBe('resource')
    const useToken = tokenAt(tokens, service, 'a.ts', SOURCE.lastIndexOf('camera.position'))
    expect(useToken?.type).toBe('resource')
  })

  it('marks both entry functions function+entry, with the decorator and builtin id classified too', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const tokens = service.getSemanticTokens('a.ts')

    const vsToken = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('vs('))
    expect(vsToken?.type).toBe('function')
    expect(vsToken?.modifiers).toContain('entry')

    const fsToken = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('fs('))
    expect(fsToken?.type).toBe('function')
    expect(fsToken?.modifiers).toContain('entry')

    const vertexDecorator = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('vertex'))
    expect(vertexDecorator?.type).toBe('decorator')

    const builtinDecorator = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('builtin('))
    expect(builtinDecorator?.type).toBe('decorator')

    const builtinId = tokenAt(tokens, service, 'a.ts', SOURCE.indexOf('vertex_index'))
    expect(builtinId?.type).toBe('builtin')
  })

  it('does not classify an ordinary helper function as an entry', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', SOURCE)
    const tokens = service.getSemanticTokens('a.ts')
    const scaleToken = tokenAt(
      tokens,
      service,
      'a.ts',
      SOURCE.indexOf('function scale') + 'function '.length,
    )
    expect(scaleToken?.type).toBe('function')
    expect(scaleToken?.modifiers).not.toContain('entry')
  })

  it('keeps token positions correct across a CRLF document', () => {
    const crlfSource = SOURCE.replace(/\n/g, '\r\n')
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', crlfSource)
    const tokens = service.getSemanticTokens('a.ts')
    const builtinId = tokenAt(tokens, service, 'a.ts', crlfSource.indexOf('vertex_index'))
    expect(builtinId?.type).toBe('builtin')
    const expectedLine =
      crlfSource.slice(0, crlfSource.indexOf('vertex_index')).split('\r\n').length - 1
    expect(builtinId?.line).toBe(expectedLine)
  })
})
