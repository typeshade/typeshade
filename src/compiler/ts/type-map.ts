// === TypeScript type node -> TypeShade ShaderType (Phase 2) ===

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
  mat4x4fT,
  structT,
  arrayT,
} from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'

const SCALAR_AND_VEC_MAP: Readonly<Record<string, ShaderType>> = {
  f32: f32T,
  i32: i32T,
  u32: u32T,
  bool: boolT,
  vec2: vec2fT,
  vec3: vec3fT,
  vec4: vec4fT,
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
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      const name = typeNameOf(typeNode)
      if (name === 'array') {
        const elem = mapTsTypeToShaderType(typeNode.typeArguments[0], sourceFile, diagnostics)
        const nNode = typeNode.typeArguments[1]
        const n =
          nNode && ts.isLiteralTypeNode(nNode) && ts.isNumericLiteral(nNode.literal)
            ? Number(nNode.literal.text)
            : undefined
        if (elem) return arrayT(elem, n)
      }
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        `Type arguments are not supported yet (got "${name}<...>").`,
      )
      return undefined
    }

    const name = typeNameOf(typeNode)
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

function typeNameOf(node: ts.TypeReferenceNode): string | undefined {
  const name = node.typeName
  if (ts.isIdentifier(name)) return name.text
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
