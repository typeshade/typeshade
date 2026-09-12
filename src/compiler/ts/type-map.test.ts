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
  typeKey,
} from '../../core/ir/types.js'

function parseType(annotation: string): {
  typeNode: ts.TypeNode
  sourceFile: ts.SourceFile
} {
  // Wrap in a dummy parameter so we always get a TypeNode.
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
    expect(typeKey(type!)).toBe('i32')
    expect(diagnostics).toEqual([])
  })

  it('maps u32 -> u32T', () => {
    const { type, diagnostics } = map('u32')
    expect(type).toBe(u32T)
    expect(typeKey(type!)).toBe('u32')
    expect(diagnostics).toEqual([])
  })

  it('maps bool -> boolT', () => {
    const { type, diagnostics } = map('bool')
    expect(type).toBe(boolT)
    expect(typeKey(type!)).toBe('bool')
    expect(diagnostics).toEqual([])
  })

  it('maps vec2 -> vec2fT', () => {
    const { type, diagnostics } = map('vec2')
    expect(type).toBe(vec2fT)
    expect(typeKey(type!)).toBe('vec2<f32>')
    expect(diagnostics).toEqual([])
  })

  it('maps vec3 -> vec3fT', () => {
    const { type, diagnostics } = map('vec3')
    expect(type).toBe(vec3fT)
    expect(typeKey(type!)).toBe('vec3<f32>')
    expect(diagnostics).toEqual([])
  })

  it('maps vec4 -> vec4fT', () => {
    const { type, diagnostics } = map('vec4')
    expect(type).toBe(vec4fT)
    expect(typeKey(type!)).toBe('vec4<f32>')
    expect(diagnostics).toEqual([])
  })

  it('lookupTypeName covers the full Phase 2 table', () => {
    expect(lookupTypeName('f32')).toBe(f32T)
    expect(lookupTypeName('i32')).toBe(i32T)
    expect(lookupTypeName('u32')).toBe(u32T)
    expect(lookupTypeName('bool')).toBe(boolT)
    expect(lookupTypeName('vec2')).toBe(vec2fT)
    expect(lookupTypeName('vec3')).toBe(vec3fT)
    expect(lookupTypeName('vec4')).toBe(vec4fT)
    expect(lookupTypeName('unknown')).toBeUndefined()
  })

  it('SUPPORTED_TYPE_NAMES lists every Phase 2 name', () => {
    expect(SUPPORTED_TYPE_NAMES).toEqual(
      expect.arrayContaining(['f32', 'i32', 'u32', 'bool', 'vec2', 'vec3', 'vec4']),
    )
    expect(SUPPORTED_TYPE_NAMES).toHaveLength(7)
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
    expect(diagnostics[0]!.category).toBe('error')
    expect(diagnostics[0]!.message).toMatch(/Missing type annotation/)
  })

  it('rejects keyword types (number, boolean, string, any)', () => {
    for (const kw of ['number', 'boolean', 'string', 'any', 'unknown', 'void']) {
      const { type, diagnostics } = map(kw)
      expect(type).toBeUndefined()
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]!.message).toMatch(/Keyword type|not a TypeShade type/)
    }
  })

  it('rejects unknown type references', () => {
    const { type, diagnostics } = map('float')
    expect(type).toBeUndefined()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.message).toMatch(/Unknown type "float"/)
  })

  it('rejects type arguments (vec2<f32>)', () => {
    const { type, diagnostics } = map('vec2<f32>')
    expect(type).toBeUndefined()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.message).toMatch(/Type arguments are not supported/)
  })

  it('rejects element-specialised short names not yet in Phase 2', () => {
    for (const name of ['vec2u', 'vec2i', 'vec3u', 'f64']) {
      const { type, diagnostics } = map(name)
      expect(type).toBeUndefined()
      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('rejects array and union types', () => {
    const { type: arrType, diagnostics: arrDiag } = map('f32[]')
    expect(arrType).toBeUndefined()
    expect(arrDiag.length).toBeGreaterThanOrEqual(1)

    const { type: unionType, diagnostics: unionDiag } = map('f32 | i32')
    expect(unionType).toBeUndefined()
    expect(unionDiag.length).toBeGreaterThanOrEqual(1)
  })

  it('records fileName and 1-based line/character on diagnostics', () => {
    const { diagnostics } = map('number')
    expect(diagnostics[0]!.fileName).toBe('type-map-test.ts')
    expect(diagnostics[0]!.line).toBeGreaterThanOrEqual(1)
    expect(diagnostics[0]!.character).toBeGreaterThanOrEqual(1)
  })

  it('works without a diagnostics array (silent failure)', () => {
    const { typeNode, sourceFile } = parseType('number')
    const type = mapTsTypeToShaderType(typeNode, sourceFile)
    expect(type).toBeUndefined()
  })
})
