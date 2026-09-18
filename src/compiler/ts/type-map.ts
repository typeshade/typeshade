// === TypeScript type node -> TypeShade ShaderType (Phase 2+) ===

import ts from 'typescript'
import type { ShaderType } from '../../core/ir/types.js'
import {
  f32T,
  f64T,
  i32T,
  u32T,
  boolT,
  vec2fT,
  vec3fT,
  vec4fT,
  vec2f64T,
  vec3f64T,
  vec4f64T,
  vec2uT,
  vec2bT,
  vec3bT,
  vec4bT,
  vec3uT,
  vec4uT,
  vec2iT,
  vec4iT,
  mat4x4fT,
  structT,
  arrayT,
  samplerT,
} from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES, type TsCode } from './codes.js'

const vec3iT = { kind: 'vec', n: 3, elem: 'i32' } as const satisfies ShaderType

const SCALAR_AND_VEC_MAP: Readonly<Record<string, ShaderType>> = {
  f32: f32T,
  f64: f64T,
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
  vec2b: vec2bT,
  vec3b: vec3bT,
  vec4b: vec4bT,
  mat4: mat4x4fT,
  mat4x4: mat4x4fT,
  vec2d: vec2f64T,
  vec3d: vec3f64T,
  vec4d: vec4f64T,
  vec2f64: vec2f64T,
  vec3f64: vec3f64T,
  vec4f64: vec4f64T,
}

/** The resource-handle types, which carry no value and appear only in a `declare const`
 *  (#8 A7). `sampler` takes no type argument, so it lives here beside the scalars; the
 *  `texture_*` names are generic and are handled in {@link mapGeneric}. */
const HANDLE_MAP: Readonly<Record<string, ShaderType>> = {
  sampler: samplerT,
}

/** The generic texture names and the `dim` each one carries. A `2d-ms` texture is left out:
 *  the multisampled load never reaches emit on either backend this compiler targets, and a
 *  name that maps to a type no shader can use is worse than no name. */
const TEXTURE_DIM: Readonly<Record<string, '2d' | '2d-array'>> = {
  texture_2d: '2d',
  texture_2d_array: '2d-array',
}

/** The handle type names — a sampler and every texture. One authority: `bindings.ts` reads
 *  this rather than keeping a second list that could drift from the map that does the mapping. */
export const HANDLE_TYPE_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(HANDLE_MAP),
  ...Object.keys(TEXTURE_DIM),
])

export const SUPPORTED_TYPE_NAMES: readonly string[] = [
  ...Object.keys(SCALAR_AND_VEC_MAP),
  ...Object.keys(HANDLE_MAP),
  ...Object.keys(TEXTURE_DIM),
]

/** The file's type aliases that are NOT object types, by name (roadmap 0.3 item T2, #92).
 *  `type Meters = f32`, `type Color = vec3`, `type Grid = array<f32, 16>`: ordinary TypeScript
 *  for "another name for this type", and the shape a developer reaches for before any of the
 *  GPU ones. An alias of an object type (`type P = { x: f32 }`) is a STRUCT and is collected by
 *  `structs.ts`, so it is left out here; a generic alias has no one target type and is left to
 *  the generic refusal.
 *
 *  Measured before this: the alias fell through to the capitalized-name arm below and became a
 *  struct named after itself, so `type Meters = f32` made `m * 0.5` "cannot * struct:Meters and
 *  f32" and a lowercase alias was an unknown type. */
function aliasTargetsOf(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.TypeNode> {
  const cached = ALIAS_CACHE.get(sourceFile)
  if (cached) return cached
  const out = new Map<string, ts.TypeNode>()
  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (ts.isTypeLiteralNode(stmt.type)) continue
    if ((stmt.typeParameters?.length ?? 0) > 0) continue
    // First declaration wins, as everywhere else in the front end; TypeScript reports the
    // duplicate itself.
    if (!out.has(stmt.name.text)) out.set(stmt.name.text, stmt.type)
  }
  ALIAS_CACHE.set(sourceFile, out)
  return out
}

const ALIAS_CACHE = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.TypeNode>>()

/** The names the file declares as an `enum` (roadmap 0.3 item T1, #92). A member of a numeric
 *  enum is an integer constant, so the enum's name as a TYPE is `i32`, the type its members
 *  have. `module-const.ts` owns the members themselves and the refusal of a string enum. */
function enumNamesOf(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = ENUM_CACHE.get(sourceFile)
  if (cached) return cached
  const out = new Set<string>()
  for (const stmt of sourceFile.statements) {
    if (ts.isEnumDeclaration(stmt)) out.add(stmt.name.text)
  }
  ENUM_CACHE.set(sourceFile, out)
  return out
}

const ENUM_CACHE = new WeakMap<ts.SourceFile, ReadonlySet<string>>()

export function mapTsTypeToShaderType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics?: TsCompilerDiagnostic[],
): ShaderType | undefined {
  return mapType(typeNode, sourceFile, diagnostics, undefined)
}

/** {@link mapTsTypeToShaderType} plus the alias names already being resolved, which is how a
 *  cycle (`type A = B; type B = A`) stops instead of recursing forever. */
function mapType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
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

  if (ts.isArrayTypeNode(typeNode)) {
    pushDiag(diagnostics, sourceFile, typeNode, `T[] is a JS array type. Use array<T, N>.`)
    return undefined
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNameOf(typeNode)
    if (name !== undefined && HANDLE_MAP[name]) {
      // Checked BEFORE the handle is returned: this arm runs ahead of the generic branch, so
      // `sampler<f32>` was accepted as a bare `sampler` and the type argument vanished.
      if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        pushDiag(diagnostics, sourceFile, typeNode, `${name} takes no type argument.`)
        return undefined
      }
      return HANDLE_MAP[name]
    }
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      return mapGeneric(name, typeNode, sourceFile, diagnostics, resolving)
    }
    if (name === undefined) {
      pushDiag(diagnostics, sourceFile, typeNode, `Unsupported type reference.`)
      return undefined
    }
    const mapped = SCALAR_AND_VEC_MAP[name]
    if (mapped !== undefined) return mapped
    // A type alias of anything but an object type is another name for its target (T2, #92).
    // After the builtin names, so no alias can shadow `f32` or `vec3`, and before the
    // capitalized-name arm, so the alias resolves instead of becoming a struct of its own.
    if (enumNamesOf(sourceFile).has(name)) return i32T
    const alias = aliasTargetsOf(sourceFile).get(name)
    if (alias !== undefined) {
      if (resolving?.has(name)) {
        // The chain as written, so a mutual cycle reads as one: "A -> B -> A".
        const chain = [...resolving.values()]
        const cycle = [...chain.slice(chain.indexOf(name)), name].join(' -> ')
        pushDiag(
          diagnostics,
          sourceFile,
          typeNode,
          `Type alias "${name}" is defined in terms of itself (${cycle}), so it names no type.`,
        )
        return undefined
      }
      return mapType(alias, sourceFile, diagnostics, new Set([...(resolving ?? []), name]))
    }
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
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
): ShaderType | undefined {
  const args = typeNode.typeArguments ?? []
  if (name === 'Array') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      'JS Array<T> is not a shader type. Use array<T, N>.',
    )
    return undefined
  }
  if (name === 'array') {
    const elem = mapType(args[0], sourceFile, diagnostics, resolving)
    const nNode = args[1]
    const n =
      nNode && ts.isLiteralTypeNode(nNode) && ts.isNumericLiteral(nNode.literal)
        ? Number(nNode.literal.text)
        : undefined
    if (elem) return arrayT(elem, n)
    return undefined
  }
  if (name === 'uniform' || name === 'storage') {
    return mapType(args[0], sourceFile, diagnostics, resolving)
  }
  // `atomic<u32>` / `atomic<i32>` (roadmap 0.2 item 4): a location in storage memory for the
  // atomic builtins. Where it may be declared is decided by the declaration sites, not here.
  // The module-variable wrappers (§24) belong on a top-level `let`; anywhere else they are a
  // misplaced declaration, not a type.
  if (name === 'workgroup' || name === 'perInvocation') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `${name}<T> declares a module variable and belongs at the top of the file: let name: ${name}<T>.`,
    )
    return undefined
  }
  if (name === 'atomic') {
    const elemName = typeNameOfArg(args[0])
    if (elemName === 'u32' || elemName === 'i32') return { kind: 'atomic', elem: elemName }
    pushDiag(diagnostics, sourceFile, typeNode, `atomic<T> T must be u32 or i32.`)
    return undefined
  }
  if (name === 'vec2' || name === 'vec3' || name === 'vec4') {
    const n = Number(name.slice(3)) as 2 | 3 | 4
    const elemName = typeNameOfArg(args[0])
    if (elemName === 'f64') return { kind: 'vec64', n }
    if (elemName === 'f32' || elemName === 'i32' || elemName === 'u32') {
      return { kind: 'vec', n, elem: elemName }
    }
    pushDiag(diagnostics, sourceFile, typeNode, `${name}<T> T must be f32, i32, u32, or f64.`)
    return undefined
  }
  if (name === 'mat2' || name === 'mat3') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${name}" is not supported yet (only mat4/mat4x4 maps to a real WGSL type); using it would silently emit mat4x4.`,
      TS_CODES.MAT_UNSUPPORTED,
    )
    return undefined
  }
  if (name !== undefined && TEXTURE_DIM[name]) {
    // `texture_2d<f32>` / `texture_2d_array<u32>` — the sampled element kind, which decides
    // both the WGSL spelling and which read intrinsics apply. Only the three native scalars;
    // WGSL has no f64 texture and a bool one is not a thing either.
    const dim = TEXTURE_DIM[name]!
    // `?? 'f32'` used to stand here, so a type argument that is not a NAME at all —
    // `texture_2d<{ a: f32 }>`, `texture_2d<f32[]>` — silently became a `texture_2d<f32>`
    // rather than being reported. An omitted argument is the one shape that still defaults.
    const elemName = args[0] === undefined ? 'f32' : typeNameOfArg(args[0])
    if (elemName !== 'f32' && elemName !== 'i32' && elemName !== 'u32') {
      pushDiag(diagnostics, sourceFile, typeNode, `${name}<T> T must be f32, i32, or u32.`)
      return undefined
    }
    return { kind: 'texture', dim, elem: elemName }
  }
  if (name === 'mat4' || name === 'mat4x4') {
    const elemName = typeNameOfArg(args[0])
    if (elemName === 'u32' || elemName === 'i32' || elemName === 'bool') {
      pushDiag(diagnostics, sourceFile, typeNode, `mat4 is floating-point only (mat4<f32>).`)
      return undefined
    }
    if (elemName === 'f64') return { kind: 'mat', n: 4, elem: 'f64' }
    if (elemName === 'f32' || elemName === undefined) return mat4x4fT
    pushDiag(diagnostics, sourceFile, typeNode, `mat4<T> T must be f32 or f64.`)
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
  code: TsCode = TS_CODES.UNKNOWN_TYPE,
): void {
  if (!diagnostics) return
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}

export function lookupTypeName(name: string): ShaderType | undefined {
  return SCALAR_AND_VEC_MAP[name]
}
