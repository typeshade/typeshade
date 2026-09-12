// === TypeScript type node -> TypeShade ShaderType (Phase 2) ===
//
// Maps the small set of type names allowed inside a "use typeshade" source
// onto the existing IR type tokens (f32T, vec2fT, ...). Unsupported types
// produce a diagnostic and return undefined; no new type system is invented.
//
// Phase 2 minimum surface:
//   f32 | i32 | u32 | bool | vec2 | vec3 | vec4
//
// Element-specialised short names (vec2u, vec2i, ...) and WGSL-style
// type-arguments (vec2<f32>) are reserved for a later phase.

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
} from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'

/** Short names accepted in "use typeshade" sources -> IR tokens. */
const SCALAR_AND_VEC_MAP: Readonly<Record<string, ShaderType>> = {
  f32: f32T,
  i32: i32T,
  u32: u32T,
  bool: boolT,
  vec2: vec2fT,
  vec3: vec3fT,
  vec4: vec4fT,
}

/** Human-readable list of supported type names (for diagnostic messages). */
export const SUPPORTED_TYPE_NAMES: readonly string[] = Object.keys(SCALAR_AND_VEC_MAP)

/**
 * Map a TypeScript type node to a TypeShade {@link ShaderType}.
 *
 * Supported forms (Phase 2):
 * - TypeReference with identifier `f32` | `i32` | `u32` | `bool` | `vec2` | `vec3` | `vec4`
 *   (no type arguments)
 *
 * Everything else yields `undefined` and, when `diagnostics` is provided, a
 * single error diagnostic pointing at the type node.
 */
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
      'Missing type annotation. "use typeshade" parameters and returns require an explicit type (f32, i32, u32, bool, vec2, vec3, or vec4).',
    )
    return undefined
  }

  // TypeReferenceNode: f32, vec2, ...
  if (ts.isTypeReferenceNode(typeNode)) {
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      // vec2<f32> etc. - not in Phase 2
      const name = typeNameOf(typeNode)
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        `Type arguments are not supported yet (got "${name}<...>"). Use the short name "${name}" for f32 vectors, or wait for a later phase.`,
      )
      return undefined
    }

    const name = typeNameOf(typeNode)
    if (name === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        `Unsupported type reference. Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`,
      )
      return undefined
    }

    const mapped = SCALAR_AND_VEC_MAP[name]
    if (mapped === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        `Unknown type "${name}". Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`,
      )
      return undefined
    }
    return mapped
  }

  // Keyword types (number, boolean, string, any, ...) are not used in "use typeshade".
  // ts.isKeywordTypeNode is not available on all TypeScript 5.x builds we target;
  // SyntaxKind keyword checks are stable.
  if (isKeywordTypeSyntax(typeNode)) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `Keyword type "${typeNode.getText(sourceFile)}" is not a TypeShade type. Use f32, i32, u32, bool, vec2, vec3, or vec4.`,
    )
    return undefined
  }

  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `Unsupported type syntax "${typeNode.getText(sourceFile)}". Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`,
  )
  return undefined
}

/**
 * Resolve the simple identifier name of a TypeReferenceNode
 * (e.g. `vec2` from `vec2` or a qualified name is rejected).
 */
function typeNameOf(node: ts.TypeReferenceNode): string | undefined {
  const name = node.typeName
  if (ts.isIdentifier(name)) return name.text
  // QualifiedName (Foo.Bar) - not supported
  return undefined
}

function isKeywordTypeSyntax(node: ts.TypeNode): boolean {
  // Keyword type nodes are scattered across SyntaxKind; test the ones we care about.
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

/** Lookup table export for tests and tooling. */
export function lookupTypeName(name: string): ShaderType | undefined {
  return SCALAR_AND_VEC_MAP[name]
}
