// Phase 2 tests: TypeScript type node -> TypeShade ShaderType mapping.

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  mapTsTypeToShaderType,
  lookupTypeName,
  SUPPORTED_TYPE_NAMES,
} from './type-map.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import {
  f32T,
  i32T,
  u32T,
  boolT,
  vec2fT,
  vec3fT,
  vec4fT,
  vec3uT,
  typeKey,
} from '../../core/ir/types.js'

function parseType(annotation: string): {
  typeNode: ts.TypeNode
  sourceFile: ts.SourceFile
} {
  const source = `function _f(x: ${annotation}) {}`
  const sourceFile = ts.createSourceFile(
    'type-map-test.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const fn = sourceFile.statements[0] as ts.FunctionDeclaration
  const param = fn.parameters[0]!
  const typeNode = param.type
  if (!typeNode) throw new Error(`failed to parse type: ${annotation}`)
  return { typeNode, sourceFile }
}

function map(annotation: string): {
  type: ReturnType<typeof mapTsTypeToShaderType>
  diagnostics: TsCompilerDiagnostic[]
} {
  const { typeNode, sourceFile } = parseType(annotation)
  const diagnostics: TsCompilerDiagnostic[] = []
  const type = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics)
  return { type, diagnostics }
}

describe('Phase 2 - type mapping', () => {
  it('maps f32 -> f32T', () => {
    const { type, diagnostics } = map('f32')
    expect(type).toBe(f32T)
    expect(typeKey(type!)).toBe('f32')
    expect(diagnostics).toEqual([])
  })

  it('maps i32 -> i32T', () => {
    const { type, diagnostics } = map('i32')
    expect(type).toBe(i32T)
    expect(diagnostics).toEqual([])
  })

  it('maps u32 -> u32T', () => {
    const { type, diagnostics } = map('u32')
    expect(type).toBe(u32T)
    expect(diagnostics).toEqual([])
  })

  it('maps bool -> boolT', () => {
    const { type, diagnostics } = map('bool')
    expect(type).toBe(boolT)
    expect(diagnostics).toEqual([])
  })

  it('maps vec2 -> vec2fT', () => {
    const { type, diagnostics } = map('vec2')
    expect(type).toBe(vec2fT)
    expect(diagnostics).toEqual([])
  })

  it('maps vec3 -> vec3fT', () => {
    const { type, diagnostics } = map('vec3')
    expect(type).toBe(vec3fT)
    expect(diagnostics).toEqual([])
  })

  it('maps vec4 -> vec4fT', () => {
    const { type, diagnostics } = map('vec4')
    expect(type).toBe(vec4fT)
    expect(diagnostics).toEqual([])
  })

  it('lookupTypeName covers the Phase 2 table', () => {
    expect(lookupTypeName('f32')).toBe(f32T)
    expect(lookupTypeName('vec3u')).toBe(vec3uT)
    expect(lookupTypeName('unknown')).toBeUndefined()
  })

  it('SUPPORTED_TYPE_NAMES lists every short name', () => {
    expect(SUPPORTED_TYPE_NAMES).toEqual(
      expect.arrayContaining(['f32', 'i32', 'u32', 'bool', 'vec2', 'vec3', 'vec4', 'vec3u', 'mat4']),
    )
    expect(SUPPORTED_TYPE_NAMES.length).toBeGreaterThanOrEqual(7)
  })

  it('returns undefined and a diagnostic when the type node is missing', () => {
    const sourceFile = ts.createSourceFile(
      't.ts',
      'function f(x) {}',
      ts.ScriptTarget.Latest,
      true,
    )
    const diagnostics: TsCompilerDiagnostic[] = []
    const type = mapTsTypeToShaderType(undefined, sourceFile, diagnostics)
    expect(type).toBeUndefined()
    expect(diagnostics).toHaveLength(1)
  })

  it('rejects keyword types (number, boolean, string, any)', () => {
    for (const kw of ['number', 'boolean', 'string', 'any', 'unknown', 'void']) {
      const { type, diagnostics } = map(kw)
      expect(type).toBeUndefined()
      expect(diagnostics).toHaveLength(1)
    }
  })

  it('rejects unknown type references', () => {
    const { type, diagnostics } = map('float')
    expect(type).toBeUndefined()
    expect(diagnostics[0]!.message).toMatch(/Unknown type "float"/)
  })

  it('maps vec2<f32> and vec3<u32>', () => {
    expect(map('vec2<f32>').diagnostics).toEqual([])
    expect(typeKey(map('vec2<f32>').type!)).toBe('vec2<f32>')
    expect(typeKey(map('vec3<u32>').type!)).toBe('vec3<u32>')
  })

  it('maps vec3u', () => {
    const { type, diagnostics } = map('vec3u')
    expect(diagnostics).toEqual([])
    expect(type).toBe(vec3uT)
  })

  it('rejects array postfix and union types', () => {
    expect(map('f32[]').type).toBeUndefined()
    expect(map('f32 | i32').type).toBeUndefined()
  })

  it('records fileName and 1-based line/character on diagnostics', () => {
    const { diagnostics } = map('number')
    expect(diagnostics[0]!.fileName).toBe('type-map-test.ts')
    expect(diagnostics[0]!.line).toBeGreaterThanOrEqual(1)
  })

  it('works without a diagnostics array (silent failure)', () => {
    const { typeNode, sourceFile } = parseType('number')
    expect(mapTsTypeToShaderType(typeNode, sourceFile)).toBeUndefined()
  })
})
