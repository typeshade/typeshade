// Implements: Rule 4.1, Rule 4.8, Rule 6.6 (docs/language-design.md; traced in reqs/).

import { logicalTypeKey as typeKey } from './optional.js';
import ts from 'typescript';
import { ATTRIBUTE_TYPES, attributeArgumentsOf, builtinNameOf } from './attribute-types.js';
import { type ShaderType } from '../../core/ir/types.js';
import { WGSL_BUILTIN_TYPES, type FixedTypeBuiltinName } from '../../core/sot.js';
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
  matT,
  structT,
  arrayT,
  samplerT,
  samplerComparisonT,
  textureDepth2dT,
  textureDepth2dArrayT,
  textureDepthCubeT,
  textureDepthCubeArrayT,
  textureDepthMultisampled2dT,
} from '../../core/ir/types.js';
import { mapStorageTexture } from './type-map/storage-texture.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { writtenName } from './context.js';
import { boundTypeArgument } from './generics.js';
import { genericStructName, isGenericClass } from './generic-structs.js';
import { TS_CODES, type TsCode } from './codes.js';
import {
  declaredValueNamesOf,
  namesInScope,
  unknownNameSentence,
  type NameScopes,
} from './unknown-names.js';
import { isIntegerWritten } from './lit-coerce.js';
import {
  mayBeOptional,
  optionalT,
  optionalInner,
  optionalAbsence,
  type Absence,
  refuseOptionalAt,
} from './optional.js';
import { namespaceClassAround } from './namespaces.js';
import { collectionKeyT, keyTypeT, keysOf, numericDomainT, recordT } from './key-types.js';
import { LIBRARY_TYPE_NAMES } from './type-map/library-type-names.js';
export { LIBRARY_TYPE_NAMES };
import { isReadonlyArrayOperator } from './type-map/readonly-array.js';

const vec3iT = { kind: 'vec', n: 3, elem: 'i32' } as const satisfies ShaderType;

const MAT_SHAPE: Readonly<Record<string, readonly [2 | 3 | 4, 2 | 3 | 4]>> = Object.fromEntries(
  ([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).flatMap((rows) =>
      cols === rows
        ? [[`mat${cols}x${rows}`, [cols, rows]] as const, [`mat${cols}`, [cols, rows]] as const]
        : [[`mat${cols}x${rows}`, [cols, rows]] as const],
    ),
  ),
);

// Why: wgsl.txt:4621 and glsl-es-300.txt:955-967 give a matrix of 2, 3 or 4 columns and rows on
// both targets.
const MAT_TYPE_NAMES: Readonly<Record<string, ShaderType>> = Object.fromEntries([
  ...([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).flatMap((rows) => {
      const t = matT(cols, rows);
      return cols === rows
        ? [[`mat${cols}x${rows}`, t] as const, [`mat${cols}`, t] as const]
        : [[`mat${cols}x${rows}`, t] as const];
    }),
  ),
  ...([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).map((rows) => [`mat${cols}x${rows}f`, matT(cols, rows)] as const),
  ),
]);

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
  ...MAT_TYPE_NAMES,
  vec2f64: vec2f64T,
  vec3f64: vec3f64T,
  vec4f64: vec4f64T,
  vec2d: vec2f64T,
  vec3d: vec3f64T,
  vec4d: vec4f64T,
};

const AUTHOR_NAME_BY_KEY: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>();
  for (const [name, t] of Object.entries(SCALAR_AND_VEC_MAP)) {
    const key = typeKey(t);
    if (!out.has(key)) out.set(key, name);
  }
  return out;
})();

const spell = (t: ShaderType): string => authorTypeName(t) ?? typeKey(t);

export function authorTypeName(t: ShaderType): string | undefined {
  return AUTHOR_NAME_BY_KEY.get(typeKey(t));
}

const HANDLE_MAP: Readonly<Record<string, ShaderType>> = {
  sampler: samplerT,
  sampler_comparison: samplerComparisonT,
  texture_depth_2d: textureDepth2dT,
  texture_depth_2d_array: textureDepth2dArrayT,
  texture_depth_cube: textureDepthCubeT,
  texture_depth_cube_array: textureDepthCubeArrayT,
  texture_depth_multisampled_2d: textureDepthMultisampled2dT,
};

const TEXTURE_DIM: Readonly<
  Record<string, '2d' | '2d-array' | 'cube' | '3d' | '1d' | 'cube-array' | '2d-ms'>
> = {
  texture_2d: '2d',
  texture_2d_array: '2d-array',
  texture_cube: 'cube',
  texture_3d: '3d',
  texture_1d: '1d',
  texture_cube_array: 'cube-array',
  texture_multisampled_2d: '2d-ms',
};

const STORAGE_TEXTURE_DIM: Readonly<Record<string, '2d' | '2d-array'>> = {
  texture_storage_2d: '2d',
  texture_storage_2d_array: '2d-array',
};

export const HANDLE_TYPE_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(HANDLE_MAP),
  ...Object.keys(TEXTURE_DIM),
  ...Object.keys(STORAGE_TEXTURE_DIM),
]);

export const SUPPORTED_TYPE_NAMES: readonly string[] = [
  ...Object.keys(SCALAR_AND_VEC_MAP),
  ...Object.keys(HANDLE_MAP),
  ...Object.keys(TEXTURE_DIM),
  ...Object.keys(STORAGE_TEXTURE_DIM),
];

export const BUILTIN_TYPE_NAMES: readonly string[] = [
  ...SUPPORTED_TYPE_NAMES,
  'array',
  'uniform',
  'storage',
  'workgroup',
  'atomic',
  'override',
  ...Object.keys(ATTRIBUTE_TYPES),
];

export function aliasTargetsOf(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.TypeNode> {
  const cached = ALIAS_CACHE.get(sourceFile);
  if (cached) return cached;
  const out = new Map<string, ts.TypeNode>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue;
    if (ts.isTypeLiteralNode(stmt.type)) continue;
    if ((stmt.typeParameters?.length ?? 0) > 0) continue;
    if (!out.has(stmt.name.text)) out.set(stmt.name.text, stmt.type);
  }
  ALIAS_CACHE.set(sourceFile, out);
  return out;
}

const ALIAS_CACHE = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.TypeNode>>();

function enumNamesOf(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = ENUM_CACHE.get(sourceFile);
  if (cached) return cached;
  const out = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isEnumDeclaration(stmt)) out.add(stmt.name.text);
  }
  ENUM_CACHE.set(sourceFile, out);
  return out;
}

const ENUM_CACHE = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

export function declaredTypeNamesOf(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = DECLARED_TYPES.get(sourceFile);
  if (cached) return cached;
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (
      (ts.isClassDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isEnumDeclaration(n) ||
        ts.isModuleDeclaration(n) ||
        ts.isImportSpecifier(n) ||
        ts.isImportClause(n)) &&
      n.name !== undefined &&
      ts.isIdentifier(n.name)
    ) {
      out.add(n.name.text);
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  DECLARED_TYPES.set(sourceFile, out);
  return out;
}

const DECLARED_TYPES = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

const LIBRARY_TYPE_REMEDY: Readonly<Record<string, string>> = {
  Number: 'Write f32, i32 or u32.',
  Boolean: 'Write bool.',
  Array: 'Write array<T, N>.',
};

const libraryTypeMessage = (name: string): string => {
  const remedy = LIBRARY_TYPE_REMEDY[name];
  const mistake = `"${name}" is not a shader type: the library declares it for TypeScript's own use.`;
  return remedy === undefined ? mistake : `${mistake} ${remedy}`;
};

const LIBRARY_CALL_REMEDY: Readonly<Record<string, string>> = {
  Number: 'Write f32(x), i32(x) or u32(x).',
  Boolean: 'Write bool(x).',
};

const LIBRARY_OBJECTS: Readonly<Record<string, string>> = {
  Math: 'Math.sin(x)',
  console: 'console.log(x)',
};

export function libraryNameSentence(
  name: string,
  as: 'value' | 'callee' | 'class',
): string | undefined {
  if (LIBRARY_TYPE_NAMES.has(name)) {
    const mistake = `"${name}" is a type, not a value: the library declares it for TypeScript's own use.`;
    const remedy = as === 'callee' ? LIBRARY_CALL_REMEDY[name] : undefined;
    return remedy === undefined ? mistake : `${mistake} ${remedy}`;
  }
  const what = as === 'value' ? 'value' : as === 'callee' ? 'function' : 'class';
  const call = LIBRARY_OBJECTS[name];
  if (call !== undefined) {
    return `"${name}" is an object of functions, not a ${what}. Call one of them, ${call}.`;
  }
  if (name === 'Symbol') {
    return `"Symbol" is no ${what} a shader has: the library declares it for TypeScript's own use.`;
  }
  return undefined;
}

function isTypeParameterAround(node: ts.Node, name: string): boolean {
  const infers = (n: ts.Node): boolean =>
    (ts.isInferTypeNode(n) && n.typeParameter.name.text === name) ||
    (ts.forEachChild(n, infers) ?? false);
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    const params = (at as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      .typeParameters;
    if (params?.some((p) => p.name.text === name)) return true;
    if (ts.isMappedTypeNode(at) && at.typeParameter.name.text === name) return true;
    if (ts.isConditionalTypeNode(at) && infers(at.extendsType)) return true;
  }
  return false;
}

export function fileDeclaresType(node: ts.Node, name: string, sourceFile: ts.SourceFile): boolean {
  return declaredTypeNamesOf(sourceFile).has(name) || isTypeParameterAround(node, name);
}

const GENERIC_TYPE_NAMES: ReadonlySet<string> = new Set([
  'array',
  'atomic',
  'ptr',
  'uniform',
  'storage',
  'workgroup',
  'override',
  ...Object.keys(ATTRIBUTE_TYPES),
]);

export const isLibraryTypeName = (name: string): boolean =>
  LIBRARY_TYPE_NAMES.has(name) ||
  SUPPORTED_TYPE_NAMES.includes(name) ||
  GENERIC_TYPE_NAMES.has(name) ||
  lookupTypeName(name) !== undefined;

export const unknownTypeSentence = (name: string, declared: NameScopes): string =>
  unknownNameSentence(
    `Unknown type "${name}".`,
    name,
    [...declared, BUILTIN_TYPE_NAMES],
    /^[A-Z]/.test(name)
      ? 'Declare it in this file, or import it from another shader module.'
      : `Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`,
  );

const MAPS_ITS_ARGUMENT: ReadonlySet<string> = new Set([
  'array',
  'uniform',
  'storage',
  'workgroup',
  'override',
]);

function mappedWhereWritten(generic: ts.TypeReferenceNode, sourceFile: ts.SourceFile): boolean {
  for (let at: ts.Node = generic; ; at = at.parent) {
    const outer = at.parent;
    if (ts.isNewExpression(outer)) return false;
    if (!ts.isTypeReferenceNode(outer)) return true;
    const name = typeNameOf(outer) ?? dottedTypeName(outer.typeName);
    if (isGenericClass(name, sourceFile)) return false;
    if (name === undefined || !MAPS_ITS_ARGUMENT.has(name)) return true;
    if (fileDeclaresType(outer, name, sourceFile)) return true;
  }
}

function namesNoType(node: ts.Node, name: string, sourceFile: ts.SourceFile): boolean {
  return (
    !isLibraryTypeName(name) &&
    boundTypeArgument(name) === undefined &&
    !fileDeclaresType(node, name, sourceFile)
  );
}

function saidByOuterGeneric(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const outer = node.parent;
  return (
    ts.isTypeReferenceNode(outer) &&
    ts.isIdentifier(outer.typeName) &&
    isLibraryTypeName(outer.typeName.text) &&
    !MAPS_ITS_ARGUMENT.has(outer.typeName.text) &&
    !fileDeclaresType(outer, outer.typeName.text, sourceFile) &&
    mappedWhereWritten(outer, sourceFile)
  );
}

export function undeclaredTypeName(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ts.Identifier | undefined {
  let id: ts.Node;
  let isClassBase = false;
  if (ts.isTypeReferenceNode(node)) {
    if (
      ts.isTypeReferenceNode(node.parent) &&
      ts.isIdentifier(node.parent.typeName) &&
      node.parent.typeName.text === 'array' &&
      node.parent.typeArguments?.[1] === node
    ) {
      return undefined;
    }
    id = node.typeName;
  } else if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent)) {
    id = node.expression;
    isClassBase =
      node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent);
  } else {
    return undefined;
  }
  if (!ts.isIdentifier(id) || (node.typeArguments?.length ?? 0) > 0) return undefined;
  if (saidByOuterGeneric(node, sourceFile)) return undefined;
  const name = id.text;
  if (
    name === 'const' ||
    name === RETIRED_VAR_WRAPPER ||
    (isClassBase && declaredValueNamesOf(sourceFile).has(name))
  ) {
    return undefined;
  }
  return namesNoType(node, name, sourceFile) ? id : undefined;
}

export function undeclaredGenericBase(
  node: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
): ts.Identifier | undefined {
  const id = node.typeName;
  if (!ts.isIdentifier(id) || (node.typeArguments?.length ?? 0) === 0) return undefined;
  if (saidByOuterGeneric(node, sourceFile)) return undefined;
  return namesNoType(node, id.text, sourceFile) ? id : undefined;
}

export const writesUndeclaredType = (node: ts.Node, sourceFile: ts.SourceFile): boolean =>
  undeclaredTypeName(node, sourceFile) !== undefined ||
  (ts.forEachChild(node, (child) => writesUndeclaredType(child, sourceFile) || undefined) ?? false);

export const RETIRED_VAR_WRAPPER = 'perInvocation';

export const retiredWrapperMessage = (fix: string): string =>
  `${RETIRED_VAR_WRAPPER}<T> was removed: a top-level let is already the per-invocation ` +
  `variable. ${fix}`;

const CONTRACTS = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

function contractInterfaces(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = CONTRACTS.get(sourceFile);
  if (cached !== undefined) return cached;
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && n.members.some(ts.isMethodSignature)) out.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
  CONTRACTS.set(sourceFile, out);
  return out;
}

const REFUSED_TYPES = new WeakMap<ts.SourceFile, Set<string>>();

export function setRefusedGenerics(sourceFile: ts.SourceFile, names: ReadonlySet<string>): void {
  REFUSED_TYPES.set(sourceFile, new Set(names));
}

export function refuseTypeName(sourceFile: ts.SourceFile, name: string): void {
  const names = REFUSED_TYPES.get(sourceFile) ?? new Set<string>();
  names.add(name);
  REFUSED_TYPES.set(sourceFile, names);
}

export function writesRefusedType(typeNode: ts.Node, sourceFile: ts.SourceFile): boolean {
  const refused = REFUSED_TYPES.get(sourceFile);
  if (refused === undefined || refused.size === 0) return false;
  const aliases = aliasTargetsOf(sourceFile);
  const followed = new Set<string>();
  const walk = (node: ts.Node): boolean => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      if (refused.has(name)) return true;
      const target = aliases.get(name);
      if (target !== undefined && !followed.has(name)) {
        followed.add(name);
        if (walk(target)) return true;
      }
    }
    return ts.forEachChild(node, (child) => (walk(child) ? true : undefined)) === true;
  };
  return walk(typeNode);
}

export function mapTsTypeToShaderType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics?: TsCompilerDiagnostic[],
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  return mapType(typeNode, sourceFile, diagnostics, undefined, sizeOverrides);
}

function mapType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  if (typeNode === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      'Missing type annotation. "use typeshade" parameters and returns require an explicit type.',
    );
    return undefined;
  }

  if (ts.isArrayTypeNode(typeNode)) {
    return unsizedArray(typeNode.elementType, sourceFile, diagnostics, resolving, sizeOverrides);
  }
  if (isReadonlyArrayOperator(typeNode)) {
    return unsizedArray(
      typeNode.type.elementType,
      sourceFile,
      diagnostics,
      resolving,
      sizeOverrides,
    );
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNameOf(typeNode);
    if (name !== undefined) {
      const bound = boundTypeArgument(name);
      if (bound !== undefined) return bound;
    }
    if (name !== undefined && HANDLE_MAP[name]) {
      if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        pushDiag(diagnostics, sourceFile, typeNode, `${name} takes no type argument.`);
        return undefined;
      }
      return HANDLE_MAP[name];
    }
    const generic = name ?? dottedTypeName(typeNode.typeName);
    if (generic !== undefined && isGenericClass(generic, sourceFile)) {
      const instance = genericStructName(generic, typeNode.typeArguments, sourceFile);
      if (instance !== undefined) return structT(instance);
      if (typeNode.typeArguments?.some((a) => writesUndeclaredType(a, sourceFile))) {
        return undefined;
      }
      return structT(generic);
    }
    if (name !== undefined && REFUSED_TYPES.get(sourceFile)?.has(name) === true) {
      return undefined;
    }
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      return mapGeneric(name, typeNode, sourceFile, diagnostics, resolving, sizeOverrides);
    }
    if (name === undefined) {
      const dotted = dottedTypeName(typeNode.typeName);
      if (dotted !== undefined && namespaceStructsOf(sourceFile).flattened.has(dotted)) {
        return structT(dotted);
      }
      if (dotted !== undefined && namespaceStructsOf(sourceFile).types.has(dotted)) {
        return undefined;
      }
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        dotted === undefined
          ? `Unsupported type reference.`
          : unknownNameSentence(
              `"${typeNode.getText(sourceFile)}" names no struct this file declares.`,
              dotted.split('_').join('.'),
              [[...namespaceStructsOf(sourceFile).flattened].map((f) => f.split('_').join('.'))],
            ),
      );
      return undefined;
    }
    const mapped = SCALAR_AND_VEC_MAP[name];
    if (mapped !== undefined) return mapped;
    const around = namespaceClassAround(typeNode, name);
    if (around !== undefined) return structT(around);
    if (enumNamesOf(sourceFile).has(name))
      return numericDomainT(i32T, () => numericRecordValues(typeNode, sourceFile));
    const alias = aliasTargetsOf(sourceFile).get(name);
    if (alias !== undefined) {
      if (resolving?.has(name)) {
        const chain = [...resolving.values()];
        const cycle = [...chain.slice(chain.indexOf(name)), name].join(' -> ');
        pushDiag(
          diagnostics,
          sourceFile,
          typeNode,
          `Type alias "${name}" is defined in terms of itself (${cycle}), so it names no type.`,
        );
        return undefined;
      }
      return mapType(
        alias,
        sourceFile,
        diagnostics,
        new Set([...(resolving ?? []), name]),
        sizeOverrides,
      );
    }
    const ns = namespaceStructsOf(sourceFile);
    if (!ns.topLevel.has(name)) {
      const candidates = ns.short.get(name);
      if (candidates !== undefined && candidates.length === 1) return structT(candidates[0]!);
      if (candidates !== undefined && candidates.length > 1) {
        pushDiag(
          diagnostics,
          sourceFile,
          typeNode,
          `"${name}" is declared in ${candidates.length} namespaces (${candidates
            .map((c) => `"${c.split('_').join('.')}"`)
            .join(', ')}). Write the one you mean.`,
        );
        return undefined;
      }
    }
    if (contractInterfaces(sourceFile).has(name)) return undefined;
    const declared = namesInScope(typeNode, 'type');
    if (declared.some((group) => group.includes(name))) return structT(name);
    if (LIBRARY_TYPE_NAMES.has(name)) {
      pushDiag(diagnostics, sourceFile, typeNode.typeName, libraryTypeMessage(name));
      return undefined;
    }
    pushDiag(diagnostics, sourceFile, typeNode.typeName, unknownTypeSentence(name, declared));
    return undefined;
  }

  if (ts.isTupleTypeNode(typeNode))
    return mapTuple(typeNode, sourceFile, diagnostics, resolving, sizeOverrides);

  if (isStringLiteralType(typeNode)) return keyTypeT([stringLiteralText(typeNode)]);

  if (ts.isUnionTypeNode(typeNode))
    return mapUnion(typeNode, sourceFile, diagnostics, resolving, sizeOverrides);

  if (ts.isIntersectionTypeNode(typeNode)) {
    return mapIntersection(typeNode, sourceFile, diagnostics, resolving, sizeOverrides);
  }

  if (isKeywordTypeSyntax(typeNode)) {
    const text = typeNode.getText(sourceFile);
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      KEYWORD_ADVICE[typeNode.kind] ?? `Keyword type "${text}" is not a TypeShade type.`,
    );
    return undefined;
  }
  if (isNull(typeNode)) {
    pushDiag(diagnostics, sourceFile, typeNode, KEYWORD_ADVICE[ts.SyntaxKind.NullKeyword]!);
    return undefined;
  }

  if (ts.isFunctionTypeNode(typeNode)) {
    const text = typeNode.getText(sourceFile);
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${text}" is a function type, and nothing a shader holds is a function: a function ` +
        `takes one as a parameter, "f: ${text}", and a call hands it a function by its name ` +
        `or as an arrow function written there (Rule 8.18).`,
    );
    return undefined;
  }

  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `Unsupported type syntax "${typeNode.getText(sourceFile)}".`,
  );
  return undefined;
}

const KEYWORD_ADVICE: Readonly<Partial<Record<ts.SyntaxKind, string>>> = {
  [ts.SyntaxKind.NumberKeyword]:
    'A number on the GPU has a width. Write f32 for a float, i32 or u32 for an integer.',
  [ts.SyntaxKind.BooleanKeyword]: 'TypeShade spells the boolean "bool".',
  [ts.SyntaxKind.StringKeyword]:
    'A string has no GPU representation: there is nothing for it to be at run time. Text that ' +
    'picks between cases is a key type, a union of string literals such as "a" | "b", whose ' +
    'values the GPU holds as ids.',
  [ts.SyntaxKind.SymbolKeyword]:
    'A symbol is a JS runtime value, and the GPU has no such type. A symbol used only as a ' +
    'brand key is erased, so "f32 & { readonly [k]: \'m\' }" is an f32; a symbol held as a ' +
    'value is not.',
  [ts.SyntaxKind.NullKeyword]:
    'null alone is an absent value and no payload type. Write "T | null" for a value that may be absent: ' +
    'the compiler carries whether the value is there (Rule 7.10).',
  [ts.SyntaxKind.UndefinedKeyword]:
    'undefined alone is the absent value and no type. Write "T | undefined" for a value that ' +
    'may be absent: the compiler carries whether the value is there (Rule 7.10).',
};

function literalBase(node: ts.TypeNode): ShaderType | undefined {
  if (!ts.isLiteralTypeNode(node)) return undefined;
  const lit = node.literal;
  if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword) {
    return boolT;
  }
  if (ts.isNumericLiteral(lit)) return numericBase(lit);
  if (ts.isPrefixUnaryExpression(lit) && ts.isNumericLiteral(lit.operand)) {
    return numericBase(lit.operand);
  }
  return undefined;
}

const numericBase = (lit: ts.NumericLiteral): ShaderType => (isIntegerWritten(lit) ? i32T : f32T);

const isNull = (node: ts.TypeNode): boolean =>
  node.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword);

const isStringLiteralType = (node: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal);

const stringLiteralText = (node: ts.TypeNode): string =>
  ((node as ts.LiteralTypeNode).literal as ts.StringLiteral).text;

function mapUnion(
  typeNode: ts.UnionTypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  if (typeNode.types.every(isStringLiteralType)) {
    return keyTypeT(typeNode.types.map(stringLiteralText));
  }
  const text = typeNode.getText(sourceFile);
  const members = typeNode.types.filter(
    (m) => !isNull(m) && m.kind !== ts.SyntaxKind.UndefinedKeyword,
  );
  let absence =
    (typeNode.types.some(isNull) ? 2 : 0) |
    (typeNode.types.some((m) => m.kind === ts.SyntaxKind.UndefinedKeyword) ? 1 : 0);
  const mapped = members.map((m) => {
    const t = literalBase(m) ?? mapType(m, sourceFile, undefined, resolving, sizeOverrides);
    if (t === undefined) return undefined;
    absence |= optionalAbsence(t) ?? 0;
    return optionalInner(t) ?? t;
  });
  const optional = absence !== 0;
  const first = mapped[0];
  if (
    first !== undefined &&
    mapped.every((t) => t !== undefined && typeKey(t) === typeKey(first))
  ) {
    const one =
      typeKey(first) === 'i32' && !optional
        ? numericDomainT(first, () => numericRecordValues(typeNode, sourceFile))
        : first;
    if (!optional) return one;
    if (mayBeOptional(one)) return optionalT(one, absence as Absence);
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${text}" would hold a ${authorTypeName(one) ?? members[0]!.getText(sourceFile)} and a flag saying ` +
        `whether it is there, and an optional holds what a function-scope struct field may: a ` +
        `scalar, a vector, a matrix, an array with a size or a struct.`,
    );
    return undefined;
  }
  if (optional && members.length === 1) {
    mapType(members[0]!, sourceFile, diagnostics, resolving, sizeOverrides);
    return undefined;
  }
  if (typeNode.types.some(isStringLiteralType)) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `The union ${text} mixes string literals with other types, and a value has one type. A union of ` +
        `string literals alone is a key type, whose values the GPU holds as u32 ids.`,
    );
    return undefined;
  }
  const a = members[0]?.getText(sourceFile) ?? '?';
  const b = members.find((t) => t.getText(sourceFile) !== a)?.getText(sourceFile) ?? '?';
  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `A union is more than one type and a GPU value has exactly one, so "${text}" would have ` +
      `to be ${a} in one place and ${b} in another. Write one function per type.`,
  );
  return undefined;
}

function mapTuple(
  typeNode: ts.TupleTypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  const text = typeNode.getText(sourceFile);
  const elements = typeNode.elements;
  if (elements.length === 0) {
    pushDiag(diagnostics, sourceFile, typeNode, `"${text}" holds nothing, so it names no type.`);
    return undefined;
  }
  const loose = elements.find(
    (e) =>
      ts.isRestTypeNode(e) ||
      ts.isOptionalTypeNode(e) ||
      (ts.isNamedTupleMember(e) && (e.dotDotDotToken ?? e.questionToken) !== undefined),
  );
  if (loose !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      loose,
      `"${text}" does not fix its length, and every array on the GPU outside storage has a ` +
        `length known at compile time. Write the elements out, or declare array<T, N>.`,
    );
    return undefined;
  }
  const parts = elements.map((e) => (ts.isNamedTupleMember(e) ? e.type : e));
  const mapped = parts.map((p) => mapType(p, sourceFile, undefined, resolving, sizeOverrides));
  const bad = mapped.findIndex((t) => t === undefined);
  if (bad >= 0) return mapType(parts[bad], sourceFile, diagnostics, resolving, sizeOverrides);
  const head = mapped[0];
  if (head === undefined) return undefined;
  const odd = mapped.findIndex((t) => t !== undefined && typeKey(t) !== typeKey(head));
  if (odd > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${text}" holds a ${parts[0]?.getText(sourceFile) ?? '?'} and a ` +
        `${parts[odd]?.getText(sourceFile) ?? '?'}. A list of one type is array<T, N>; a list ` +
        `of several is a struct, so declare one with a field per element and return that.`,
    );
    return undefined;
  }
  return arrayT(head, elements.length);
}

function isBrandType(node: ts.TypeNode): boolean {
  if (!ts.isTypeLiteralNode(node)) return false;
  return node.members.every(
    (m) =>
      ts.isPropertySignature(m) &&
      (ts.isComputedPropertyName(m.name) || (m.type !== undefined && isStringLiteralType(m.type))),
  );
}

function mapIntersection(
  typeNode: ts.IntersectionTypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  const carriers = typeNode.types.filter((t) => !isBrandType(t));
  if (carriers.length === 1)
    return mapType(carriers[0], sourceFile, diagnostics, resolving, sizeOverrides);
  const text = typeNode.getText(sourceFile);
  if (carriers.length === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${text}" is brands alone. A brand says which values a type accepts; it carries no ` +
        `data, so something has to carry the value. Intersect it with f32, vec3 or a struct.`,
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `An intersection is one value in every one of its types at once, and ` +
      `${carriers[0]?.getText(sourceFile) ?? '?'} and ` +
      `${carriers[1]?.getText(sourceFile) ?? '?'} have different layouts, so no GPU value is ` +
      `both. Only a brand is erased: a property under a "unique symbol" key, or one typed as ` +
      `a string literal.`,
  );
  return undefined;
}

function unsizedArray(
  written: ts.TypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides: Parameters<typeof mapType>[4],
): ShaderType | undefined {
  let elemNode = written;
  while (ts.isParenthesizedTypeNode(elemNode)) elemNode = elemNode.type;
  const elem = withoutCollections(() =>
    mapType(elemNode, sourceFile, diagnostics, resolving, sizeOverrides),
  );
  return elem === undefined ? undefined : arrayT(elem, undefined);
}

function mapGeneric(
  name: string | undefined,
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  const args = typeNode.typeArguments ?? [];
  if ((name === 'Array' || name === 'ReadonlyArray') && args.length === 1) {
    return unsizedArray(args[0]!, sourceFile, diagnostics, resolving, sizeOverrides);
  }
  if (name === 'Array' || name === 'ReadonlyArray') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `${name}<T> takes one type argument, the element. A list with a size is array<T, N>.`,
    );
    return undefined;
  }
  if (name === 'Map' || name === 'Set')
    return mapCollection(name, typeNode, sourceFile, diagnostics, resolving);
  if (name === 'Record' && !namesInScope(typeNode, 'type').some((g) => g.includes(name)))
    return mapRecord(typeNode, sourceFile, diagnostics, resolving, sizeOverrides);
  if (name === 'array') {
    const elem = withoutCollections(() =>
      mapType(args[0], sourceFile, diagnostics, resolving, sizeOverrides),
    );
    const nNode = args[1];
    const nLiteral = nNode && ts.isLiteralTypeNode(nNode) ? nNode.literal : undefined;
    const n =
      nLiteral && ts.isNumericLiteral(nLiteral)
        ? Number(nLiteral.text)
        : nLiteral &&
            ts.isPrefixUnaryExpression(nLiteral) &&
            nLiteral.operator === ts.SyntaxKind.MinusToken &&
            ts.isNumericLiteral(nLiteral.operand)
          ? -Number(nLiteral.operand.text)
          : undefined;
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
      pushDiag(
        diagnostics,
        sourceFile,
        nNode ?? typeNode,
        `array<T, ${String(n)}> is not a list. A list's length is a whole number of 1 or ` +
          `more; a list whose length the shader does not know is array<T> in storage.`,
      );
      return undefined;
    }
    if (nNode !== undefined && ts.isTypeReferenceNode(nNode) && ts.isIdentifier(nNode.typeName)) {
      const sizeName = nNode.typeName.text;
      const size = sizeOverrides?.get(sizeName);
      if (
        size === undefined ||
        size.type.kind !== 'scalar' ||
        (size.type.scalar !== 'u32' && size.type.scalar !== 'i32') ||
        typeof size.default !== 'number' ||
        !Number.isInteger(size.default) ||
        size.default < 1
      ) {
        pushDiag(
          diagnostics,
          sourceFile,
          nNode,
          `The outer size of a workgroup array must name an integer override with a positive ` +
            `default; "${writtenName(nNode.typeName)}" does not.`,
        );
        return undefined;
      }
      if (elem) return { kind: 'array', elem, size: size.default, sizeOverride: sizeName };
      return undefined;
    }
    if (elem === undefined) return undefined;
    return arrayT(elem, n);
  }
  if (name === 'uniform' || name === 'storage') {
    return mapType(args[0], sourceFile, diagnostics, resolving, sizeOverrides);
  }
  if (name !== undefined && Object.hasOwn(ATTRIBUTE_TYPES, name)) {
    const value = attributeArgumentsOf(typeNode).value;
    if (value !== undefined)
      return mapType(value, sourceFile, diagnostics, resolving, sizeOverrides);
    const id = name === 'builtin' ? builtinNameOf(typeNode) : undefined;
    if (id !== undefined) {
      return Object.hasOwn(WGSL_BUILTIN_TYPES, id)
        ? (WGSL_BUILTIN_TYPES[id as FixedTypeBuiltinName] as ShaderType)
        : undefined;
    }
  }
  if (name === 'workgroup') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      'workgroup<T> declares a module variable and belongs at the top of the file: let name: workgroup<T>.',
    );
    return undefined;
  }
  if (name === RETIRED_VAR_WRAPPER) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      retiredWrapperMessage('Drop the wrapper and write let name: T.'),
      TS_CODES.MODULE_VAR,
    );
    return undefined;
  }
  if (name === 'atomic') {
    const elemName = typeNameOfArg(args[0]);
    if (elemName === 'u32' || elemName === 'i32') return { kind: 'atomic', elem: elemName };
    pushDiag(diagnostics, sourceFile, typeNode, `atomic<T> T must be u32 or i32.`);
    return undefined;
  }
  if (name === 'vec2' || name === 'vec3' || name === 'vec4') {
    const n = Number(name.slice(3)) as 2 | 3 | 4;
    const elemName = typeNameOfArg(args[0]);
    if (elemName === 'f64') return { kind: 'vec64', n };
    if (elemName === 'f32' || elemName === 'i32' || elemName === 'u32') {
      return { kind: 'vec', n, elem: elemName };
    }
    pushDiag(diagnostics, sourceFile, typeNode, `${name}<T> T must be f32, i32, u32, or f64.`);
    return undefined;
  }
  if (name !== undefined && TEXTURE_DIM[name]) {
    const dim = TEXTURE_DIM[name]!;
    const elemName = args[0] === undefined ? 'f32' : typeNameOfArg(args[0]);
    if (elemName !== 'f32' && elemName !== 'i32' && elemName !== 'u32') {
      pushDiag(diagnostics, sourceFile, typeNode, `${name}<T> T must be f32, i32, or u32.`);
      return undefined;
    }
    return { kind: 'texture', dim, elem: elemName };
  }
  if (name !== undefined && STORAGE_TEXTURE_DIM[name]) {
    return mapStorageTexture(
      name,
      STORAGE_TEXTURE_DIM[name]!,
      args,
      typeNode,
      sourceFile,
      diagnostics,
    );
  }
  const matShape = name === undefined ? undefined : MAT_SHAPE[name];
  if (matShape !== undefined) {
    const [cols, rows] = matShape;
    const elemName = typeNameOfArg(args[0]);
    if (elemName === 'u32' || elemName === 'i32' || elemName === 'bool') {
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        `${name} is floating-point only (${name}<f32>). WGSL gives matCxR<T> only f32, f16 ` +
          `and AbstractFloat (wgsl.txt:4621), and GLSL ES 3.00 has no integer matrix either.`,
      );
      return undefined;
    }
    if (elemName === 'f64') {
      if (cols !== rows) {
        pushDiag(
          diagnostics,
          sourceFile,
          typeNode,
          `${name}<f64> has no emulated-double form: the fp64 pass carries a square matrix ` +
            `of doubles only (mat2, mat3, mat4). Declare it ${name} and narrow, or use a ` +
            `square shape.`,
          TS_CODES.MAT_UNSUPPORTED,
        );
        return undefined;
      }
      return matT(cols, rows, 'f64');
    }
    if (elemName === 'f32' || elemName === undefined) return matT(cols, rows);
    pushDiag(diagnostics, sourceFile, typeNode, `${name}<T> T must be f32 or f64.`);
    return undefined;
  }
  const base = undeclaredGenericBase(typeNode, sourceFile);
  if (base !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      base,
      unknownTypeSentence(base.text, namesInScope(typeNode, 'type')),
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `Type arguments are not supported yet (got "${
      ts.isIdentifier(typeNode.typeName) ? writtenName(typeNode.typeName) : name
    }<...>").`,
  );
  return undefined;
}

function typeNameOf(node: ts.TypeReferenceNode): string | undefined {
  const name = node.typeName;
  if (ts.isIdentifier(name)) return name.text;
  return undefined;
}

function typeNameOfArg(node: ts.TypeNode | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return node.typeName.text;
  return undefined;
}

function dottedTypeName(name: ts.EntityName): string | undefined {
  const parts: string[] = [];
  let node: ts.EntityName = name;
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text);
      return parts.join('_');
    }
    parts.unshift(node.right.text);
    node = node.left;
  }
}

interface NamespaceStructs {
  readonly flattened: ReadonlySet<string>;
  readonly short: ReadonlyMap<string, string[]>;
  readonly topLevel: ReadonlySet<string>;
  readonly types: ReadonlySet<string>;
}

const NS_STRUCT_CACHE = new WeakMap<ts.SourceFile, NamespaceStructs>();

function namespaceStructsOf(sourceFile: ts.SourceFile): NamespaceStructs {
  const hit = NS_STRUCT_CACHE.get(sourceFile);
  if (hit) return hit;
  const flattened = new Set<string>();
  const short = new Map<string, string[]>();
  const topLevel = new Set<string>();
  const types = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name) topLevel.add(stmt.name.text);
    if (ts.isInterfaceDeclaration(stmt)) topLevel.add(stmt.name.text);
    if (ts.isTypeAliasDeclaration(stmt)) topLevel.add(stmt.name.text);
  }
  const walk = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const stmt of statements) {
      if (ts.isModuleDeclaration(stmt) && stmt.body) {
        const inner = prefix === '' ? stmt.name.text : `${prefix}_${stmt.name.text}`;
        if (ts.isModuleBlock(stmt.body)) walk(stmt.body.statements, inner);
        else if (ts.isModuleDeclaration(stmt.body)) walk([stmt.body], inner);
        continue;
      }
      if (prefix !== '' && (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))) {
        types.add(`${prefix}_${stmt.name.text}`);
      }
      if (prefix === '' || !ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const full = `${prefix}_${stmt.name.text}`;
      flattened.add(full);
      const prior = short.get(stmt.name.text);
      if (prior) prior.push(full);
      else short.set(stmt.name.text, [full]);
    }
  };
  walk(sourceFile.statements, '');
  const value: NamespaceStructs = { flattened, short, topLevel, types };
  NS_STRUCT_CACHE.set(sourceFile, value);
  return value;
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
      return true;
    default:
      return false;
  }
}

let collectionsHere = false;

export function withCollections<T>(fn: () => T): T {
  const was = collectionsHere;
  collectionsHere = true;
  try {
    return fn();
  } finally {
    collectionsHere = was;
  }
}

const MAP_VALUE_KINDS: ReadonlySet<ShaderType['kind']> = new Set([
  'scalar',
  'f64',
  'vec',
  'vec64',
  'mat',
  'struct',
  'array',
]);

function mapCollection(
  name: 'Map' | 'Set',
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
): ShaderType | undefined {
  const spelled = name === 'Map' ? 'Map<K, V>' : 'Set<K>';
  if (!collectionsHere) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `A ${spelled} is a kernel function's parameter only: an exported function that takes an array with no size (Rule 8.22). Take it as a parameter of that function.`,
    );
    return undefined;
  }
  const args = typeNode.typeArguments ?? [];
  if (args.length !== (name === 'Map' ? 2 : 1)) {
    pushDiag(diagnostics, sourceFile, typeNode, `${name} takes the type arguments ${spelled}.`);
    return undefined;
  }
  const keyType = mapType(args[0], sourceFile, undefined, resolving, undefined);
  const keys = keysOf(keyType);
  const key = keys !== undefined ? 'u32' : typeNameOfArg(args[0]);
  if (key !== 'u32' && key !== 'i32' && key !== 'f32') {
    pushDiag(
      diagnostics,
      sourceFile,
      args[0] ?? typeNode,
      `The key K of a ${spelled} is u32, i32, f32 or a union of string literals: an open string or a shader object has no key id for ECMAScript to compare.`,
    );
    return undefined;
  }
  if (name === 'Set') return collectionKeyT({ kind: 'collection', key }, keyType!);
  const value = withoutCollections(() =>
    mapType(args[1], sourceFile, diagnostics, resolving, undefined),
  );
  if (value === undefined) return undefined;
  if (refuseOptionalAt(value, args[1] ?? typeNode, 'a Map value', sourceFile, diagnostics, spell))
    return undefined;
  if (!MAP_VALUE_KINDS.has(value.kind) || (value.kind === 'array' && value.size === undefined)) {
    pushDiag(
      diagnostics,
      sourceFile,
      args[1] ?? typeNode,
      `The value V of a Map<K, V> is a type an array may hold: a scalar, a vector, a matrix, a struct or an array with a size.`,
    );
    return undefined;
  }
  return collectionKeyT({ kind: 'collection', key, value }, keyType!);
}

function withoutCollections<T>(fn: () => T): T {
  const was = collectionsHere;
  collectionsHere = false;
  try {
    return fn();
  } finally {
    collectionsHere = was;
  }
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[] | undefined,
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  message: string,
  code: TsCode = TS_CODES.UNKNOWN_TYPE,
): void {
  if (!diagnostics) return;
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

export function lookupTypeName(name: string): ShaderType | undefined {
  return SCALAR_AND_VEC_MAP[name];
}

function mapRecord(
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
  sizeOverrides?: ReadonlyMap<
    string,
    { readonly type: ShaderType; readonly default: number | boolean }
  >,
): ShaderType | undefined {
  const args = typeNode.typeArguments ?? [];
  if (args.length !== 2) {
    pushDiag(diagnostics, sourceFile, typeNode, 'Record takes the type arguments Record<K, V>.');
    return undefined;
  }
  const key = mapType(args[0], sourceFile, undefined, resolving, sizeOverrides);
  const values = keysOf(key) !== undefined ? undefined : numericRecordValues(args[0]!, sourceFile);
  if (values !== undefined && (values.length === 0 || values.some((v, i) => v !== i))) {
    pushDiag(
      diagnostics,
      sourceFile,
      args[0]!,
      `A numeric Record<K, V> needs the values 0 through N-1; "${args[0]!.getText(sourceFile)}" has ${values.length === 0 ? 'no values' : values.join(', ')}. Use consecutive values starting at 0.`,
    );
    return undefined;
  }
  if (keysOf(key) === undefined && values === undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      args[0]!,
      `The key K of a Record<K, V> is a union of string literals, an enum or a union of integer literals with values 0 through N-1; ` +
        `"${args[0]!.getText(sourceFile)}" is none. An array or a Map is ` +
        `the type for an open set of keys.`,
    );
    return undefined;
  }
  const elem = mapType(args[1], sourceFile, diagnostics, resolving, sizeOverrides);
  if (elem === undefined) return undefined;
  if (refuseOptionalAt(elem, args[1]!, 'a Record value', sourceFile, diagnostics, spell))
    return undefined;
  if (elem.kind === 'collection' || (elem.kind === 'array' && elem.size === undefined)) {
    pushDiag(
      diagnostics,
      sourceFile,
      args[1]!,
      `The value V of a Record<K, V> is a type an array of a fixed size holds, and ` +
        `"${args[1]!.getText(sourceFile)}" is none.`,
    );
    return undefined;
  }
  return recordT(values === undefined ? key! : numericDomainT(i32T, () => values), elem, values);
}

function numericRecordValues(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
): readonly number[] | undefined {
  let query = NUMERIC_RECORD_QUERIES.get(sourceFile);
  if (query === undefined) {
    const copy = ts.createSourceFile(
      sourceFile.fileName,
      sourceFile.text,
      ts.ScriptTarget.Latest,
      true,
    );
    const host: ts.CompilerHost = {
      getSourceFile: (name) => (name === copy.fileName ? copy : undefined),
      getDefaultLibFileName: () => '',
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (name) => name === copy.fileName,
      readFile: () => undefined,
    };
    const checker = ts
      .createProgram([copy.fileName], { noLib: true, noResolve: true, types: [] }, host)
      .getTypeChecker();
    const nodes = new Map<string, ts.TypeNode>();
    const walk = (n: ts.Node): void => {
      if (ts.isTypeNode(n)) nodes.set(`${n.getStart(copy)}:${n.end}`, n);
      ts.forEachChild(n, walk);
    };
    walk(copy);
    query = (original) => {
      const cloned = nodes.get(`${original.getStart(sourceFile)}:${original.end}`);
      if (cloned === undefined) return undefined;
      const type = checker.getTypeFromTypeNode(cloned);
      if (type.symbol?.declarations?.some((d) => ts.isEnumDeclaration(d) && d.members.length === 0))
        return [];
      const members = type.isUnion() ? type.types : [type];
      if (!members.every((t) => t.isNumberLiteral())) return undefined;
      return [...new Set(members.map((t) => (t as ts.NumberLiteralType).value))].sort(
        (a, b) => a - b,
      );
    };
    NUMERIC_RECORD_QUERIES.set(sourceFile, query);
  }
  return query(node);
}

const NUMERIC_RECORD_QUERIES = new WeakMap<
  ts.SourceFile,
  (node: ts.TypeNode) => readonly number[] | undefined
>();
