// === TypeScript type node -> TypeShade ShaderType (Phase 2+) ===

import ts from 'typescript';
import { typeKey, type ShaderType } from '../../core/ir/types.js';
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
  ALL_STORAGE_TEXTURE_FORMATS,
  READ_WRITE_STORAGE_FORMATS,
  WRITE_ONLY_STORAGE_FORMATS,
  storageFormatFeature,
  type StorageTextureFormat,
} from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { boundTypeArgument } from './generics.js';
import { genericStructName, isGenericClass } from './generic-structs.js';
import { TS_CODES, type TsCode } from './codes.js';

const vec3iT = { kind: 'vec', n: 3, elem: 'i32' } as const satisfies ShaderType;

/** Matrix name -> its (cols, rows), for the generic `matCxR<T>` arm. Derived from the same
 *  two loops {@link MAT_TYPE_NAMES} uses, so a name spellable bare is spellable generic. */
const MAT_SHAPE: Readonly<Record<string, readonly [2 | 3 | 4, 2 | 3 | 4]>> = Object.fromEntries(
  ([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).flatMap((rows) =>
      cols === rows
        ? [[`mat${cols}x${rows}`, [cols, rows]] as const, [`mat${cols}`, [cols, rows]] as const]
        : [[`mat${cols}x${rows}`, [cols, rows]] as const],
    ),
  ),
);

/** Every matrix name the surface spells, as the `matCxR` of wgsl.txt:4621 (C, R each 2, 3 or
 *  4) plus the `matN` shorthand both targets give a square one. GLSL ES 3.00 has all nine
 *  (glsl-es-300.txt:955-967), so the set is the same on both. `f32` is the default element;
 *  `mat3<f64>` and the rest go through the generic arm. */
const MAT_TYPE_NAMES: Readonly<Record<string, ShaderType>> = Object.fromEntries(
  ([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).flatMap((rows) => {
      const t = matT(cols, rows);
      return cols === rows
        ? [[`mat${cols}x${rows}`, t] as const, [`mat${cols}`, t] as const]
        : [[`mat${cols}x${rows}`, t] as const];
    }),
  ),
);

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
  vec2d: vec2f64T,
  vec3d: vec3f64T,
  vec4d: vec4f64T,
  vec2f64: vec2f64T,
  vec3f64: vec3f64T,
  vec4f64: vec4f64T,
};

/** The resource-handle types, which carry no value and appear only in a `declare const`
 *  (#8 A7). `sampler` takes no type argument, so it lives here beside the scalars; the
 *  `texture_*` names are generic and are handled in {@link mapGeneric}. */
const HANDLE_MAP: Readonly<Record<string, ShaderType>> = {
  sampler: samplerT,
  // A depth texture and the comparison sampler that reads it (roadmap 0.4 item 11). Bare names,
  // like `sampler`: a depth texture has no element type to write, every one is single-channel
  // float.
  sampler_comparison: samplerComparisonT,
  texture_depth_2d: textureDepth2dT,
  texture_depth_2d_array: textureDepth2dArrayT,
  texture_depth_cube: textureDepthCubeT,
  texture_depth_cube_array: textureDepthCubeArrayT,
  texture_depth_multisampled_2d: textureDepthMultisampled2dT,
};

/** The generic texture names and the `dim` each one carries. A cube and a 3d texture (roadmap
 *  0.4 item 12) are core in both targets and need nothing declared; the WebGPU-only ones each
 *  derive their capability from the binding. `texture_multisampled_2d` (item 13) was left out
 *  while nothing read it; `textureLoad(t, coords, sampleIndex)` does now. */
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

/** The storage texture names and the `dim` each one carries (roadmap 0.4 item 10). Separate
 *  from {@link TEXTURE_DIM} because the two take different type arguments: a sampled texture
 *  takes an element type, a storage texture takes a FORMAT and an ACCESS mode, both written as
 *  string literal types so `tsc` checks them before this compiler does. */
const STORAGE_TEXTURE_DIM: Readonly<Record<string, '2d' | '2d-array'>> = {
  texture_storage_2d: '2d',
  texture_storage_2d_array: '2d-array',
};

/** The handle type names — a sampler and every texture. One authority: `bindings.ts` reads
 *  this rather than keeping a second list that could drift from the map that does the mapping. */
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
  const cached = ALIAS_CACHE.get(sourceFile);
  if (cached) return cached;
  const out = new Map<string, ts.TypeNode>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue;
    if (ts.isTypeLiteralNode(stmt.type)) continue;
    if ((stmt.typeParameters?.length ?? 0) > 0) continue;
    // First declaration wins, as everywhere else in the front end; TypeScript reports the
    // duplicate itself.
    if (!out.has(stmt.name.text)) out.set(stmt.name.text, stmt.type);
  }
  ALIAS_CACHE.set(sourceFile, out);
  return out;
}

const ALIAS_CACHE = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.TypeNode>>();

/** The names the file declares as an `enum` (roadmap 0.3 item T1, #92). A member of a numeric
 *  enum is an integer constant, so the enum's name as a TYPE is `i32`, the type its members
 *  have. `module-const.ts` owns the members themselves and the refusal of a string enum. */
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

/** The retired module-variable wrapper, refused by name wherever it is written.
 *  `perInvocation<T>` (#83) was a second spelling of the variable a plain top-level `let`
 *  declares, and was removed (§24). It lives here rather than in module-vars.ts because
 *  module-vars.ts imports this file, and both refusals want the one sentence. */
export const RETIRED_VAR_WRAPPER = 'perInvocation';

/** The sentence an author who writes the retired wrapper gets. `fix` is the remedy for the
 *  site: a top-level `let` knows the author's own name and type argument, so it names the line
 *  they meant, and every other site says it with `name` and `T`. */
export const retiredWrapperMessage = (fix: string): string =>
  `${RETIRED_VAR_WRAPPER}<T> was removed: a top-level let is already the per-invocation ` +
  `variable. ${fix}`;

const CONTRACTS = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The interfaces of the file that declare a method: contracts a class implements, which a
 *  shader value cannot be, since a call through one would need to pick its body at run time. */
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

export function mapTsTypeToShaderType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics?: TsCompilerDiagnostic[],
): ShaderType | undefined {
  return mapType(typeNode, sourceFile, diagnostics, undefined);
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
    );
    return undefined;
  }

  if (ts.isArrayTypeNode(typeNode)) {
    pushDiag(diagnostics, sourceFile, typeNode, `T[] is a JS array type. Use array<T, N>.`);
    return undefined;
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNameOf(typeNode);
    // A type parameter of the instantiation being lowered, ahead of every other meaning of a
    // name, because a type parameter shadows in TypeScript too (roadmap 0.3 item T9, #92).
    if (name !== undefined) {
      const bound = boundTypeArgument(name);
      if (bound !== undefined) return bound;
    }
    if (name !== undefined && HANDLE_MAP[name]) {
      // Checked BEFORE the handle is returned: this arm runs ahead of the generic branch, so
      // `sampler<f32>` was accepted as a bare `sampler` and the type argument vanished.
      if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        pushDiag(diagnostics, sourceFile, typeNode, `${name} takes no type argument.`);
        return undefined;
      }
      return HANDLE_MAP[name];
    }
    // `Pair<f32>` names the struct the file collected for that set of type arguments, and a bare
    // `Grid` names the one its declared defaults give (roadmap 0.3 item T9, #92). Both are asked
    // before `mapGeneric`, which is the builtin generic names — `array<T, N>`, `uniform<T>` —
    // and would report "type arguments are not supported" for a class, and before the
    // capitalized-name arm below, which would make a struct of the name as written.
    // `N.Pair<f32>` is a dotted name, so `name` is undefined for it; the class it reaches is the
    // flattened `N_Pair` (#107), which is the name generic classes are keyed under too.
    const generic = name ?? dottedTypeName(typeNode.typeName);
    if (generic !== undefined && isGenericClass(generic, sourceFile)) {
      const instance = genericStructName(generic, typeNode.typeArguments, sourceFile);
      if (instance !== undefined) return structT(instance);
      // Arguments that name no layout — the wrong number of them, or one that is a type
      // parameter — were reported once, where the instances were collected. Recovering as a
      // struct of the written name is what an unknown capitalized name does below, and it keeps
      // the binding alive, so one mistake still reads as one sentence instead of a second
      // refusal here and an "Unknown identifier" at every read of it (T10, #111).
      return structT(generic);
    }
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      return mapGeneric(name, typeNode, sourceFile, diagnostics, resolving);
    }
    // `N.P` names the class `P` inside the namespace `N`, which the module emits as `N_P`
    // (#107). A dotted type name reaches here before the "unsupported reference" arm, which is
    // what it used to be.
    if (name === undefined) {
      const dotted = dottedTypeName(typeNode.typeName);
      if (dotted !== undefined && namespaceStructsOf(sourceFile).flattened.has(dotted)) {
        return structT(dotted);
      }
      pushDiag(
        diagnostics,
        sourceFile,
        typeNode,
        dotted === undefined
          ? `Unsupported type reference.`
          : `"${typeNode.getText(sourceFile)}" names no struct this file declares. A class ` +
              `inside a namespace is written "${dotted.split('_').join('.')}".`,
      );
      return undefined;
    }
    const mapped = SCALAR_AND_VEC_MAP[name];
    if (mapped !== undefined) return mapped;
    // A type alias of anything but an object type is another name for its target (T2, #92).
    // After the builtin names, so no alias can shadow `f32` or `vec3`, and before the
    // capitalized-name arm, so the alias resolves instead of becoming a struct of its own.
    if (enumNamesOf(sourceFile).has(name)) return i32T;
    const alias = aliasTargetsOf(sourceFile).get(name);
    if (alias !== undefined) {
      if (resolving?.has(name)) {
        // The chain as written, so a mutual cycle reads as one: "A -> B -> A".
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
      return mapType(alias, sourceFile, diagnostics, new Set([...(resolving ?? []), name]));
    }
    // A class declared inside a namespace is reachable by its short name from that namespace's
    // own bodies, which is where almost every use of it is (#107). The file's own declarations
    // win, and a short name two namespaces both declare is refused rather than guessed at:
    // resolving it properly needs the enclosing namespace, which a type annotation does not
    // carry here.
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
    // An interface that declares a method is a contract and never a value (Rule 6.9); it was
    // said so where it declares the method, once, and a type it names here names nothing.
    if (contractInterfaces(sourceFile).has(name)) return undefined;
    if (/^[A-Z]/.test(name)) return structT(name);
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `Unknown type "${name}". Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`,
    );
    return undefined;
  }

  // A tuple is a list of a length the type fixes, which is what `array<T, N>` is (roadmap 0.3
  // item T10, #92). Both targets take a fixed array in every position a tuple is written in,
  // a return included, so refusing `[f32, f32]` would be this compiler's limit and not the
  // GPU's. A tuple of several types is the one with no representation, and it says so.
  if (ts.isTupleTypeNode(typeNode)) return mapTuple(typeNode, sourceFile, diagnostics, resolving);

  // A union is more than one type, and a value has exactly one. The exception is the common
  // case: members that all denote the same type. `0 | 1 | 2` is an i32, `true | false` a bool,
  // `Meters | f32` an f32.
  if (ts.isUnionTypeNode(typeNode)) return mapUnion(typeNode, sourceFile, diagnostics, resolving);

  // An intersection with a brand is TypeScript's nominal-typing idiom, and a brand carries no
  // data: `f32 & { [m]: 'm' }` is an f32 that only a Meters may be passed to. Erase the brands
  // and what is left is the one type the value has.
  if (ts.isIntersectionTypeNode(typeNode)) {
    return mapIntersection(typeNode, sourceFile, diagnostics, resolving);
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

  // A function type anywhere but on a parameter of a function (Rule 8.18): a return, a field, a
  // variable, an element. A parameter that takes one is read before its type is mapped
  // (lower/function-types.ts), so what reaches here would be a value holding a function.
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

/** The keyword types a developer reaches for out of TypeScript habit, each with the shader
 *  type that is the thing they meant (roadmap 0.3 item T10, #92). The rest keep the general
 *  sentence: there is no useful advice to give for `any` beyond naming a type. */
const KEYWORD_ADVICE: Readonly<Partial<Record<ts.SyntaxKind, string>>> = {
  [ts.SyntaxKind.NumberKeyword]:
    'A number on the GPU has a width. Write f32 for a float, i32 or u32 for an integer.',
  [ts.SyntaxKind.BooleanKeyword]: 'TypeShade spells the boolean "bool".',
  [ts.SyntaxKind.StringKeyword]:
    'A string has no GPU representation: there is nothing for it to be at run time. Text that ' +
    'picks between cases is an enum, whose members are numbers.',
  [ts.SyntaxKind.SymbolKeyword]:
    'A symbol is a JS runtime value, and the GPU has no such type. A symbol used only as a ' +
    'brand key is erased, so "f32 & { readonly [k]: \'m\' }" is an f32; a symbol held as a ' +
    'value is not.',
  [ts.SyntaxKind.NullKeyword]:
    'There is no null on the GPU: a value of a type always exists. Carry a bool saying whether ' +
    'the value means anything.',
  [ts.SyntaxKind.UndefinedKeyword]:
    'There is no undefined on the GPU: a value of a type always exists. Carry a bool saying ' +
    'whether the value means anything.',
};

/** The type a literal type node denotes as a value: `1` an i32, `1.5` an f32, `true` a bool.
 *  Integer literals give i32 for the same reason an enum member does (T1): the shape they are
 *  written in, `0 | 1 | 2`, is the one an enum has. A string literal and `null` have no GPU
 *  representation, and return undefined so the caller can say which one it found. */
function literalBase(node: ts.TypeNode): ShaderType | undefined {
  if (!ts.isLiteralTypeNode(node)) return undefined;
  const lit = node.literal;
  if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword) {
    return boolT;
  }
  if (ts.isNumericLiteral(lit)) return numericBase(lit.text);
  if (ts.isPrefixUnaryExpression(lit) && ts.isNumericLiteral(lit.operand)) {
    return numericBase(lit.operand.text);
  }
  return undefined;
}

/** `1.` and `1e3` are floats the way a shader author writes them; `1` is an integer. */
const numericBase = (text: string): ShaderType => (/[.eE]/.test(text) ? f32T : i32T);

const isNullish = (node: ts.TypeNode): boolean =>
  node.kind === ts.SyntaxKind.NullKeyword ||
  node.kind === ts.SyntaxKind.UndefinedKeyword ||
  (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword);

const isStringLiteralType = (node: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal);

function mapUnion(
  typeNode: ts.UnionTypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
): ShaderType | undefined {
  // Mapped without diagnostics: a member that names nothing is reported once below, as part of
  // the sentence about the union, rather than as its own complaint about a type nobody wrote
  // on its own line.
  const mapped = typeNode.types.map(
    (m) => literalBase(m) ?? mapType(m, sourceFile, undefined, resolving),
  );
  const first = mapped[0];
  if (
    first !== undefined &&
    mapped.every((t) => t !== undefined && typeKey(t) === typeKey(first))
  ) {
    return first;
  }
  const text = typeNode.getText(sourceFile);
  if (typeNode.types.some(isStringLiteralType)) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `A string has no GPU representation, so "${text}" names no type a value can have. ` +
        `Write the cases as an enum, whose members are numbers.`,
    );
    return undefined;
  }
  if (typeNode.types.some(isNullish)) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `There is no null on the GPU, so "${text}" names no type: a value of a type always ` +
        `exists. Drop it from the union, and carry a bool saying whether the value means ` +
        `anything.`,
    );
    return undefined;
  }
  const a = typeNode.types[0]?.getText(sourceFile) ?? '?';
  const b = typeNode.types.find((t) => t.getText(sourceFile) !== a)?.getText(sourceFile) ?? '?';
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
  const mapped = parts.map((p) => mapType(p, sourceFile, undefined, resolving));
  const bad = mapped.findIndex((t) => t === undefined);
  // The element says why it names no type, on its own span. Re-run it for the message rather
  // than complaining about the tuple, which is not what is wrong.
  if (bad >= 0) return mapType(parts[bad], sourceFile, diagnostics, resolving);
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

/** Whether `node` is a brand: an object type whose every member is a property that no GPU
 *  value could carry, under a computed (symbol) key or typed as a string literal. Both are
 *  the nominal-typing idiom, both hold no data, and both are erased. */
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
): ShaderType | undefined {
  const carriers = typeNode.types.filter((t) => !isBrandType(t));
  if (carriers.length === 1) return mapType(carriers[0], sourceFile, diagnostics, resolving);
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

function mapGeneric(
  name: string | undefined,
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  resolving: ReadonlySet<string> | undefined,
): ShaderType | undefined {
  const args = typeNode.typeArguments ?? [];
  if (name === 'Array') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      'JS Array<T> is not a shader type. Use array<T, N>.',
    );
    return undefined;
  }
  if (name === 'array') {
    const elem = mapType(args[0], sourceFile, diagnostics, resolving);
    const nNode = args[1];
    // A negative length is a `PrefixUnaryExpression` inside the literal type, not a
    // `NumericLiteral` — read through the minus so `array<f32, -1>` is a length of -1 and
    // meets the rule below, rather than reading as a runtime-sized array.
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
    // `array<T, 0>` has no element and no use: WGSL requires N to be positive, and every
    // index into it is out of range. Refused at the type, so the author hears it once rather
    // than once per read (§51).
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
    if (elem) return arrayT(elem, n);
    return undefined;
  }
  if (name === 'uniform' || name === 'storage') {
    return mapType(args[0], sourceFile, diagnostics, resolving);
  }
  // `atomic<u32>` / `atomic<i32>` (roadmap 0.2 item 4): a location in storage memory for the
  // atomic builtins. Where it may be declared is decided by the declaration sites, not here.
  // The module-variable wrapper (§24) belongs on a top-level `let`; anywhere else it is a
  // misplaced declaration, not a type.
  if (name === 'workgroup') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      'workgroup<T> declares a module variable and belongs at the top of the file: let name: workgroup<T>.',
    );
    return undefined;
  }
  // The retired wrapper anywhere a type can stand. module-vars.ts catches it on a top-level
  // `let`, where every author who has written it will be, and puts their own name in the fix;
  // this arm is the rest of the file, where the name is simply gone. Without it the annotation
  // falls to `mapGeneric`'s tail and gets TS8002 "Type arguments are not supported yet", which
  // names neither the removal nor what to write.
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
    // `texture_2d<f32>` / `texture_2d_array<u32>` — the sampled element kind, which decides
    // both the WGSL spelling and which read intrinsics apply. Only the three native scalars;
    // WGSL has no f64 texture and a bool one is not a thing either.
    const dim = TEXTURE_DIM[name]!;
    // `?? 'f32'` used to stand here, so a type argument that is not a NAME at all —
    // `texture_2d<{ a: f32 }>`, `texture_2d<f32[]>` — silently became a `texture_2d<f32>`
    // rather than being reported. An omitted argument is the one shape that still defaults.
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
      // The emulation has one df64 body per DIMENSION, not per shape (DF64MatN, matmul,
      // matvec, transpose), so only a square matrix of doubles can be lowered. A non-square
      // one is refused HERE rather than accepted and raised as SD0041 from the backend.
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
  pushDiag(
    diagnostics,
    sourceFile,
    typeNode,
    `Type arguments are not supported yet (got "${name}<...>").`,
  );
  return undefined;
}

/** `texture_storage_2d<"rgba8unorm", "write">` (roadmap 0.4 item 10). Both arguments are
 *  string LITERAL types, which is what lets `tsc` check a mistyped format before this compiler
 *  sees the file and what keeps the spelling ordinary TypeScript.
 *
 *  Two things are refused here that Tint would not refuse. Tint compiles every format at every
 *  access mode; a real device does not, so a `read_write` on anything but the three
 *  single-channel 32-bit formats, and any format outside the sixteen core ones, is reported
 *  with the reason. Both were measured against a device rather than read off a spec: the
 *  spelling Tint takes and the device refuses passes the compile gate and then fails at
 *  `createBindGroupLayout`, which is a wrong program emitted without a diagnostic. */
function mapStorageTexture(
  name: string,
  dim: '2d' | '2d-array',
  args: readonly ts.TypeNode[],
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
): ShaderType | undefined {
  const written = (node: ts.TypeNode | undefined): string | undefined =>
    node !== undefined && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
      ? node.literal.text
      : undefined;
  const format = written(args[0]);
  if (
    format === undefined ||
    !(ALL_STORAGE_TEXTURE_FORMATS as readonly string[]).includes(format)
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `${name}<Format, Access> needs a texel format written as a string, one of ` +
        `${ALL_STORAGE_TEXTURE_FORMATS.map((f) => `"${f}"`).join(', ')}. ` +
        `All but the last are the formats every WebGPU device stores to with no feature ` +
        `requested, and "bgra8unorm" is the one that needs "bgra8unorm-storage"; a format ` +
        `outside them compiles and then fails when the host builds the bind group.`,
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  const access = written(args[1]) ?? 'write';
  if (access !== 'write' && access !== 'read' && access !== 'read_write') {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `${name}<Format, Access> Access is "write", "read" or "read_write"; got "${access}".`,
      TS_CODES.UNKNOWN_TYPE,
    );
    return undefined;
  }
  // A format that stores and nothing more (#147). Measured on two Chromium builds with every
  // adapter feature requested: `bgra8unorm` at `read-only` and at `read-write` is "Texture
  // format TextureFormat::BGRA8Unorm does not support storage texture access", while
  // `write-only` builds. Checked BEFORE the read_write list, so `<bgra8unorm, read_write>`
  // reads the reason that is about this format rather than the one about read_write in general.
  if (access !== 'write' && (WRITE_ONLY_STORAGE_FORMATS as readonly string[]).includes(format)) {
    const feature = storageFormatFeature(format as StorageTextureFormat);
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${format}" is "write" only. A device that requested ` +
        `"${feature ?? "the format's feature"}" stores to it and does not load from it, so ` +
        `"${access}" is refused at the bind group whatever Tint says about the module. ` +
        `Write to it and read the same texture through a sampled binding.`,
      TS_CODES.UNKNOWN_TYPE,
    );
  } else if (
    access === 'read_write' &&
    !(READ_WRITE_STORAGE_FORMATS as readonly string[]).includes(format)
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      typeNode,
      `"${format}" cannot be read_write. A device stores AND loads through the same binding ` +
        `only at ${READ_WRITE_STORAGE_FORMATS.map((f) => `"${f}"`).join(', ')}; every other ` +
        `format is "write" or "read", one at a time. Take two bindings over the same texture ` +
        `if this one has to be both.`,
      TS_CODES.UNKNOWN_TYPE,
    );
    // Reported, and the type is still returned below: it is a well-formed storage texture that
    // no device will bind, not a name that means nothing. Keeping it keeps the binding alive,
    // so this reads as the one sentence it is instead of trailing an "Unknown identifier" at
    // every use (T10, #111). A module carrying an error emits nothing, so the spelling never
    // reaches a device anyway.
  }
  return { kind: 'storage-texture', dim, format: format as StorageTextureFormat, access };
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

/** `N.P` as the flattened `N_P`, or undefined when the type name is not a chain of
 *  identifiers. */
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
  /** Every flattened name a namespace class takes: `N_P`, `A_B_P`. */
  readonly flattened: ReadonlySet<string>;
  /** The short name each was written under, to the flattened names that carry it. */
  readonly short: ReadonlyMap<string, string[]>;
  /** Every struct name the file declares at its top level, which wins over a short name. */
  readonly topLevel: ReadonlySet<string>;
}

const NS_STRUCT_CACHE = new WeakMap<ts.SourceFile, NamespaceStructs>();

/** The classes a file declares inside its namespaces, by both names (#107). Cached per source
 *  file the way the alias and enum tables are, since every annotation in the file asks. */
function namespaceStructsOf(sourceFile: ts.SourceFile): NamespaceStructs {
  const hit = NS_STRUCT_CACHE.get(sourceFile);
  if (hit) return hit;
  const flattened = new Set<string>();
  const short = new Map<string, string[]>();
  const topLevel = new Set<string>();
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
      if (prefix === '' || !ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const full = `${prefix}_${stmt.name.text}`;
      flattened.add(full);
      const prior = short.get(stmt.name.text);
      if (prior) prior.push(full);
      else short.set(stmt.name.text, [full]);
    }
  };
  walk(sourceFile.statements, '');
  const value: NamespaceStructs = { flattened, short, topLevel };
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
