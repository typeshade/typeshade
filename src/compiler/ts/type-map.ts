// === TypeScript type node -> TypeShade ShaderType (Phase 2+) ===

import ts from 'typescript'
import type { ShaderType } from '../../core/ir/types.js'
import {
  f32T,
  i32T,
  u32T,
  boolT,
  vec2fT,
  vec3fT,
  vec4fT,
  vec2uT,
  vec3uT,
  vec4uT,
  vec2iT,
  vec4iT,
  mat4x4fT,
  structT,
  arrayT,
} from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'

const vec3iT = { kind: 'vec', n: 3, elem: 'i32' } as const satisfies ShaderType

const SCALAR_AND_VEC_MAP: Readonly<Record<string, ShaderType>> = {
  f32: f32T,
  i32: i32T,
  u32: u32T,
  bool: boolT,
  vec2: vec2fT,
  vec3: vec3fT,
  vec4: vec4fT,
  vec2f: vec2fT,
  vec3f: vec3fT,
  vec4f: vec4fT,
  vec2u: vec2uT,
  vec3u: vec3uT,
  vec4u: vec4uT,
  vec2i: vec2iT,
  vec3i: vec3iT,
  vec4i: vec4iT,
  mat4: mat4x4fT,
  mat4x4: mat4x4fT,
}

export const SUPPORTED_TYPE_NAMES: readonly string[] = Object.keys(SCALAR_AND_VEC_MAP)

export function mapTsTypeToShaderType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics?: TsCompilerDiagnostic[],
): ShaderType | undefined {
  if (typeNode === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      'Missing type annotation. "use typeshade" parameters and returns require an explicit type.',
    )
    return undefined
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNameOf(typeNode)
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      return mapGeneric(name, typeNode, sourceFile, diagnostics)
    }
    if (name === undefined) {
      pushDiag(diagnostics, sourceFile, typeNode, `Unsupported type reference.`)
      return undefined
    }
    const mapped = SCALAR_AND_VEC_MAP[name]
    if (mapped !== undefined) return mapped
    if (/^[A-Z]/.test(name)) return structT(name)
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `Unknown type "${name}". Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`,
    )
    return undefined
  }

  if (isKeywordTypeSyntax(typeNode)) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `Keyword type "${typeNode.getText(sourceFile)}" is not a TypeShade type.`,
    )
    return undefined
  }

  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `Unsupported type syntax "${typeNode.getText(sourceFile)}".`,
  )
  return undefined
}

function mapGeneric(
  name: string | undefined,
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics?: TsCompilerDiagnostic[],
): ShaderType | undefined {
  const args = typeNode.typeArguments ?? []
  if (name === 'array') {
    const elem = mapTsTypeToShaderType(args[0], sourceFile, diagnostics)
    const nNode = args[1]
    const n =
      nNode && ts.isLiteralTypeNode(nNode) && ts.isNumericLiteral(nNode.literal)
        ? Number(nNode.literal.text)
        : undefined
    if (elem) return arrayT(elem, n)
    return undefined
  }
  if (name === 'uniform' || name === 'storage') {
    return mapTsTypeToShaderType(args[0], sourceFile, diagnostics)
  }
  if (name === 'vec2' || name === 'vec3' || name === 'vec4') {
    const n = Number(name.slice(3)) as 2 | 3 | 4
    const elemName = typeNameOfArg(args[0])
    if (elemName === 'f32' || elemName === 'i32' || elemName === 'u32') {
      return { kind: 'vec', n, elem: elemName }
    }
    pushDiag(diagnostics, sourceFile, typeNode, `${name}<T> T must be f32, i32, or u32.`)
    return undefined
  }
  if (name === 'mat2' || name === 'mat3' || name === 'mat4' || name === 'mat4x4') {
    const elemName = typeNameOfArg(args[0])
    if (elemName === 'u32' || elemName === 'i32' || elemName === 'bool') {
      pushDiag(diagnostics, sourceFile, typeNode, `mat4 is floating-point only (mat4<f32>).`)
      return undefined
    }
    if (elemName === 'f32' || elemName === undefined) return mat4x4fT
    pushDiag(diagnostics, sourceFile, typeNode, `mat4<T> T must be f32.`)
    return undefined
  }
  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `Type arguments are not supported yet (got "${name}<...>").`,
  )
  return undefined
}

function typeNameOf(node: ts.TypeReferenceNode): string | undefined {
  const name = node.typeName
  if (ts.isIdentifier(name)) return name.text
  return undefined
}

function typeNameOfArg(node: ts.TypeNode | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return node.typeName.text
  return undefined
}

function isKeywordTypeSyntax(node: ts.TypeNode): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.BooleanKeyword:
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.NeverKeyword:
    case ts.SyntaxKind.ObjectKeyword:
    case ts.SyntaxKind.BigIntKeyword:
    case ts.SyntaxKind.SymbolKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.NullKeyword:
      return true
    default:
      return false
  }
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[] | undefined,
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  message: string,
): void {
  if (!diagnostics) return
  const { line, character } = node
    ? sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    : { line: 0, character: 0 }
  diagnostics.push({
    message,
    fileName: sourceFile.fileName,
    line: line + 1,
    character: character + 1,
    category: 'error',
  })
}

export function lookupTypeName(name: string): ShaderType | undefined {
  return SCALAR_AND_VEC_MAP[name]
}
