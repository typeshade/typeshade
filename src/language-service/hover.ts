// === Hover: TypeScript quick info for user symbols, TypeShade docs for the vocabulary (§5) ===

import ts from 'typescript';
import { isBuiltinTypeLiteral } from '../compiler/ts/attribute-types.js';
import { relatedSitesOf } from '../compiler/ts/diagnostic.js';
import { entryNode } from '../compiler/ts/entry-locations.js';
import { qualifiersOf } from '../compiler/ts/lower/references.js';
import { linkedCompileOf, type CompileTsSourceResult } from '../compiler/ts/source-file.js';
import {
  abstractConstTableOf,
  copyCallAt,
  copyCallParamsAt,
  hasResultCopies,
  resultCopiesAt,
  type DeclaredSymbol,
} from '../compiler/ts/symbols.js';
import { ioAttrOf, retIoAttrOf } from '../core/ir/entry-io.js';
import type { FuncDecl } from '../core/ir/nodes.js';
import type { ShaderType } from '../core/ir/types.js';
import { wgslType } from '../core/backends/wgsl.js';
import { optionalInner, optionalAbsence } from '../compiler/ts/optional.js';
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js';
import { ATTRIBUTE_DOCS, BUILTIN_DOCS, TYPE_DOCS } from './docs.js';
import { rangeForSpan, touchingNodeAtPosition, wordSpan } from './positions.js';
import type { TypeshadeHover } from './types.js';
import {
  collectionKeyOf,
  keysOf,
  keyTypeText,
  recordOf,
  recordKeyText,
} from '../compiler/ts/key-types.js';

function isBuiltinStringLiteral(node: ts.Node): node is ts.StringLiteralLike {
  if (!ts.isStringLiteralLike(node)) return false;
  // The id of a `builtin<"…", T>` type (change 0111) reads as the decorator's argument does.
  if (isBuiltinTypeLiteral(node)) return true;
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === node
  );
}

function isAttributeName(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node)) return false;
  const parent = node.parent;
  // `@vertex` (a bare decorator) or `@builtin(...)`/`@location(...)` (a decorator factory call).
  if (ts.isDecorator(parent) && parent.expression === node) return true;
  return ts.isCallExpression(parent) && parent.expression === node && ts.isDecorator(parent.parent);
}

function isTypeName(node: ts.Node): node is ts.Identifier {
  return (
    ts.isIdentifier(node) && ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node
  );
}

/** The top-level variable declaration named `name` in `sourceFile`, if there is one. */
function topLevelVariableNamed(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl;
    }
  }
  return undefined;
}

/**
 * For an identifier that refers to one of the front end's collected resource bindings
 * (`analysis.bindings`: `uniform<T>(...)`, `storage<T>(...)` and the rest), the TypeShade line
 * the hover adds under TypeScript's quick info: the access mode, the address space and the
 * `@group`/`@binding` slot the emitted WGSL declares it at, none of which the TypeScript type
 * (`Camera`) says anything about. The name alone is not enough, since a local could shadow the
 * binding, so the identifier must resolve, per TypeScript, to the top-level declaration of that
 * name.
 */
function resourceBindingLine(
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
  node: ts.Node,
): string | undefined {
  if (!ts.isIdentifier(node)) return undefined;
  const binding = analysis.bindings.find((b) => b.name === node.text);
  if (binding === undefined) return undefined;
  const decl = topLevelVariableNamed(sourceFile, node.text);
  if (decl === undefined) return undefined;
  const declStart = decl.name.getStart(sourceFile);
  if (!defs.some((d) => d.fileName === uri && d.textSpan.start === declStart)) return undefined;
  return bindingLine(binding);
}

/** The line of a resource binding: its access mode, its address space and its slot. */
function bindingLine(binding: CompileTsSourceResult['bindings'][number]): string {
  // The access mode leads, so the line reads as WGSL's own `var<storage, read_write>` does and
  // so the address space and the slot keep their wording. A uniform has no mode to name.
  const mode = binding.space === 'storage' ? `${binding.access ?? 'read'} ` : '';
  const slot = `@group(${binding.group}) @binding(${binding.binding})`;
  return `${mode}${binding.space} resource at ${slot}`;
}

/** Whether `f` is an entry whose user-defined inputs and outputs stand at locations. */
const isRenderEntry = (f: FuncDecl): boolean => f.stage === 'vertex' || f.stage === 'fragment';

/** What a field of a struct can be, in the words of Rule 6.6's table and in the order a line
 *  names them. */
const ROLES = ['vertex attribute', 'value between stages', 'render target'] as const;

/** What a field of the struct `struct` is, by where the entries of `analysis` put the struct, in
 *  the words of Rule 6.6's table. Empty for a struct no vertex or fragment entry reads or
 *  returns. */
function rolesOfStruct(analysis: CompileTsSourceResult, struct: string): string[] {
  const is = (t: ShaderType): boolean => t.kind === 'struct' && t.name === struct;
  const entries = analysis.funcs.filter(isRenderEntry);
  const attribute = entries.some((f) => f.stage === 'vertex' && f.params.some((p) => is(p.type)));
  const between = entries.some((f) =>
    f.stage === 'vertex' ? is(f.ret) : f.params.some((p) => is(p.type)),
  );
  const target = entries.some((f) => f.stage === 'fragment' && is(f.ret));
  return ROLES.filter((_, i) => [attribute, between, target][i]);
}

/** What one program says of a struct's field: what the field is there (`rolesOfStruct`), and
 *  the location its IR carries, written or given. */
interface FieldFacts {
  readonly roles: readonly string[];
  readonly location: number | undefined;
  /** Whether the field is a built-in value, which stands at no location. */
  readonly builtin?: boolean;
}

/** What the program of `analysis` says of the field `name` of its struct `struct`, by the name
 *  the module emits the struct under. `undefined` when the module holds no such field. */
function fieldFacts(
  analysis: CompileTsSourceResult,
  struct: string | undefined,
  name: string,
): FieldFacts | undefined {
  const decl = analysis.structs.find((s) => s.decl.name === struct)?.decl;
  const field = decl?.fields.find((f) => f.name === name);
  if (decl === undefined || field === undefined) return undefined;
  const attr = ioAttrOf(field);
  return {
    roles: rolesOfStruct(analysis, decl.name),
    location: attr.location,
    builtin: attr.builtin !== undefined,
  };
}

/** The line for a field, from what one program says of it. */
function fieldLine(facts: FieldFacts | undefined): string | undefined {
  if (facts?.location === undefined) return undefined;
  const what = facts.roles.length > 0 ? facts.roles.join(' and ') : 'user-defined input or output';
  return `${what} at @location(${String(facts.location)})`;
}

/**
 * The field that the program of `analysis` declares at offset `start` of `fileName`, a file the
 * program links: the entry itself, or one it imports, directly or through another (Rule 3.9).
 *
 * The join is the declaration, by its file and its position. The linker lowered the program as
 * one source and kept, for every span of it, the file and the offsets the author wrote
 * (`LinkedProgram.map`), so a field is found where TypeScript says the hovered name is declared,
 * whatever the importing file calls its struct (`import { VsOut as V }`), however the import
 * reaches it (a re-export, a namespace) and whatever name the module emits the struct under
 * (`io_VsOut`, when two files declare a `VsOut`). The symbol's `struct` is that emitted name,
 * which is the name `analysis.structs` knows it by. `undefined` for a single-file program and
 * for a declaration the program did not keep.
 */
function linkedFieldAt(
  analysis: CompileTsSourceResult,
  fileName: string,
  start: number,
): DeclaredSymbol | undefined {
  const linked = linkedCompileOf(analysis);
  if (linked === undefined) return undefined;
  for (const symbol of linked.symbols) {
    if (symbol.kind !== 'field') continue;
    const written = linked.linked.map(symbol.start, symbol.start + symbol.length);
    if (written?.file.name === fileName && written.start === start) return symbol;
  }
  return undefined;
}

/**
 * How the lines of one hover name the documents `uris`: each by its base name
 * (`a.shade.ts`), which is what an import of it ends in. Where two of them have one base name,
 * each takes as many of its directories as tell it from the others (`lit/a.shade.ts` and
 * `unlit/a.shade.ts`), and the whole uri where no shorter text does.
 */
function shownNames(uris: readonly string[]): ReadonlyMap<string, string> {
  const segments = new Map(uris.map((uri) => [uri, uri.split(/[\\/]/).filter((s) => s !== '')]));
  const tail = (uri: string, n: number): string => segments.get(uri)!.slice(-n).join('/');
  const out = new Map<string, string>();
  for (const uri of uris) {
    const own = segments.get(uri)!;
    let n = 1;
    while (n < own.length && uris.some((u) => u !== uri && tail(u, n) === tail(uri, n))) n++;
    out.set(uri, n < own.length ? tail(uri, n) : uri);
  }
  return out;
}

/**
 * The lines for a field that the hovered document's own program gives no place among its
 * entries: the field's declaration at offset `start` of `fileName`, as the `programs` that link
 * that file have it. Each program is another open document's cached analysis, the one
 * `compile()` and `reflect()` of that document give.
 *
 * The programs that use the field's struct among their entries decide.
 *
 * - Every one gives the field one number: one line, with that number and everything the field
 *   is in those programs, and no file, since the line is true of each.
 * - They differ (a vertex input after another attribute in one program and first in the other),
 *   or one of them refused the field: one line for each program, with the file the program
 *   starts from (the owner's decisions of 2026-11-10, change 0135). A program that numbers the
 *   field has `… at @location(1) in a.shade.ts`. A program that refused it has
 *   `no location in b.shade.ts (TS8010)`, with the code of that program's own diagnostic about
 *   the field (`refusalCode`). The lines stand in the order of the documents' uris, so the hover
 *   does not depend on which document was opened first.
 * - No program uses the struct among its entries: the field has at most the location it
 *   writes, which every program reads the same, and the line is the one it has in one file.
 */
function fieldLinesAcross(
  programs: readonly HoverProgram[],
  fileName: string,
  start: number,
): readonly string[] {
  const found: {
    readonly uri: string;
    readonly facts: FieldFacts;
    readonly refusal: string | undefined;
  }[] = [];
  for (const program of programs) {
    const field = linkedFieldAt(program.analysis, fileName, start);
    const facts = field && fieldFacts(program.analysis, field.struct, field.name);
    if (facts !== undefined)
      found.push({
        uri: program.uri,
        facts,
        refusal: refusalCode(program.analysis, facts, fileName, start),
      });
  }
  const used = found.filter((f) => f.facts.roles.length > 0);
  const deciding = used.length > 0 ? used : found;
  const first = deciding[0];
  if (first === undefined) return [];
  const refused = deciding.some((f) => f.refusal !== undefined);
  if (!refused && deciding.every((f) => f.facts.location === first.facts.location)) {
    const line = fieldLine({
      roles: ROLES.filter((role) => deciding.some((f) => f.facts.roles.includes(role))),
      location: first.facts.location,
    });
    return line === undefined ? [] : [line];
  }
  const shown = deciding
    .filter((f) => f.facts.location !== undefined || f.refusal !== undefined)
    .sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  const names = shownNames(shown.map((f) => f.uri));
  return shown.map((f) =>
    f.facts.location !== undefined
      ? `${fieldLine(f.facts)!} in ${names.get(f.uri)!}`
      : `no location in ${names.get(f.uri)!} (${f.refusal!})`,
  );
}

/**
 * The code of the diagnostic with which the program of `analysis` refused to give the field at
 * offset `start` of `fileName` a location, or `undefined` when it did not refuse it: the field
 * has a location, it is a built-in value, or the program reports no error about it. The code is
 * read off the program's own diagnostics, the ones `compile()` of its document reports, so the
 * hover names no code the compiler did not give (Rule 12.7).
 */
function refusalCode(
  analysis: CompileTsSourceResult,
  facts: FieldFacts,
  fileName: string,
  start: number,
): string | undefined {
  if (facts.location !== undefined || facts.builtin === true) return undefined;
  const covers = (at: { fileName: string; start: number; length: number }): boolean =>
    at.fileName === fileName && at.start <= start && start < at.start + at.length;
  // A program that imports the struct reports the refusal at its own use of it, and the field
  // is that diagnostic's related site (#1186).
  return analysis.diagnostics.find(
    (d) => d.category === 'error' && (covers(d) || relatedSitesOf(d).some(covers)),
  )?.code;
}

/**
 * For a user-defined input or output of a vertex or fragment entry, the TypeShade line the hover
 * adds under the type: what the value is and the location it stands at, written
 * (`location<n, T>`) or given by the compiler (Rule 6.6, change 0135). The TypeScript type
 * (`vec2`) says nothing about the number, and it is the number a host reads from `reflect()`.
 *
 * The location is read off the IR of `analysis` with the reader `reflect()` and the backends
 * use (`ioAttrOf`, `retIoAttrOf`), after the front end numbered it (`giveEntryLocations`), so
 * the hover cannot name another number than the emitted module has (Rule 12.7). A value with no
 * location in the IR gets no line: a built-in value, a field of a struct no entry uses, and a
 * field or parameter the front end refused to number (`TS8010`).
 *
 * - A field of a struct has its line from `entryLocationLines`, which reads it across the files
 *   of the program.
 * - A `param` of a vertex or fragment entry that is no struct: a vertex attribute, or a value
 *   between stages.
 * - A `function` that is a fragment entry with a bare result: the render target it returns.
 */
function locationLine(
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  declared: DeclaredSymbol,
): string | undefined {
  const at = (what: string, location: number | undefined): string | undefined =>
    location === undefined ? undefined : `${what} at @location(${String(location)})`;
  if (declared.kind !== 'param' && declared.kind !== 'function') return undefined;
  // The entry the declaration belongs to: the function whose name, or whose parameter, it is.
  let node: ts.Node | undefined = nodeAt(sourceFile, declared.start);
  while (node !== undefined && !ts.isFunctionLike(node)) node = node.parent;
  if (node === undefined) return undefined;
  const entry = analysis.funcs.find(
    (f) => isRenderEntry(f) && entryNode(sourceFile, f.name) === node,
  );
  if (entry === undefined) return undefined;
  if (declared.kind === 'function') {
    if (entry.stage !== 'fragment' || entry.ret.kind === 'struct') return undefined;
    return at('returns a render target', retIoAttrOf(entry).location);
  }
  const param = entry.params.find((p) => p.name === declared.name);
  if (param === undefined || param.type.kind === 'struct') return undefined;
  return at(
    entry.stage === 'vertex' ? 'vertex attribute' : 'value between stages',
    ioAttrOf(param).location,
  );
}

/**
 * The line for the user-defined input or output under the cursor (`locationLine`), which for a
 * field holds across the files of a program (Rule 3.9):
 *
 * - `declared`, a field the front end recorded in this document, is read in this document's
 *   program.
 * - A field that another document declares (`v.uv`, where `import { VsOut } from "./io.shade.ts"`
 *   brought the struct) is found in this document's program by the declaration `defs` resolves
 *   it to (`linkedFieldAt`). Its number is the one `reflect()` gives for this document.
 * - A field whose struct no entry of this document's program reads or returns is read in the
 *   programs of the other open documents that link the declaring file (`fieldLinesAcross`).
 *   This is the declaring file's view of a struct that the files importing it use: the front
 *   end records nothing for a struct its own file never uses, so the declaration `defs` names
 *   is the whole join. `programs` is asked only then. It is the one case with more than one
 *   line: programs that give the field different numbers each have a line, with their file.
 */
function entryLocationLines(
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
  declared: DeclaredSymbol | undefined,
  programs: HoverPrograms,
): readonly string[] {
  const one = (line: string | undefined): readonly string[] => (line === undefined ? [] : [line]);
  if (declared !== undefined && declared.kind !== 'field')
    return one(locationLine(analysis, sourceFile, declared));
  const places =
    declared !== undefined
      ? [{ fileName: uri, start: declared.start }]
      : defs.map((d) => ({ fileName: d.fileName, start: d.textSpan.start }));
  for (const at of places) {
    const field = declared ?? linkedFieldAt(analysis, at.fileName, at.start);
    const own = field && fieldFacts(analysis, field.struct, field.name);
    if (own !== undefined && own.roles.length > 0) return one(fieldLine(own));
    const across = fieldLinesAcross(programs.linking(at.fileName), at.fileName, at.start);
    const lines = across.length > 0 ? across : one(fieldLine(own));
    if (lines.length > 0) return lines;
  }
  return [];
}

/** The program of one open document: the document's uri, and the service's cached analysis of
 *  it (`entryOf`, `service.ts`). */
export interface HoverProgram {
  readonly uri: string;
  readonly analysis: CompileTsSourceResult;
}

/**
 * The programs of the open documents, as the service keeps them. The hover asks for one only
 * where its own document's program does not answer.
 */
export interface HoverPrograms {
  /** The programs of the other open documents that link the file `declaringUri`, for a field
   *  that the hovered document's own program gives no place among its entries, or no symbol. */
  linking(declaringUri: string): readonly HoverProgram[];
  /** The program of the open document `uri` alone, or `undefined` when it is not open: for a
   *  name the hovered document imports and its program does not keep. */
  of(uri: string): HoverProgram | undefined;
}

/** How a hover names a struct, from the name the compiler's types carry (`structNamesOf`). */
export type StructNames = (emitted: string) => string;

/**
 * How a `ShaderType` is spelled in a hover: the WGSL spelling for everything a backend can
 * write, and the source spelling for the emulated-double types it cannot.
 *
 * `wgslType` alone is not enough. `f64`, `vecN<f64>` and `matNxN<f64>` are PRE-LOWERING types,
 * rewritten into `f32` pairs before any backend spells a type, so `wgslType` deliberately
 * throws SD0040 on them rather than emitting an invalid WGSL type. A hover still has to name
 * them, and the source spelling is the only one they have, so those three arms are spelled here,
 * with the array arm recursing through this function so `array<vec3<f64>, 4>` reaches them.
 * Key types, Record and collections retain their front-end spelling (change 0081).
 * Every other kind takes the WGSL spelling from `wgslType`, which is what the rest of the editor
 * already shows: a `vec3` hovers as `vec3<f32>` and a `mat4` as `mat4x4<f32>`, not as the
 * ambient alias the author typed. So there is exactly one place a GPU type is spelled for the
 * editor.
 */
export function spellShaderType(t: ShaderType, struct: StructNames = (name) => name): string {
  const spell = (inner: ShaderType): string => spellShaderType(inner, struct);
  // An optional value is spelled as TypeScript spells it (Rule 7.10, change 0088).
  const optional = optionalInner(t);
  if (optional !== undefined)
    return `${spell(optional)}${optionalAbsence(t)! & 2 ? ' | null' : ''}${optionalAbsence(t)! & 1 ? ' | undefined' : ''}`;
  const keys = keysOf(t);
  if (keys !== undefined) return keyTypeText(keys);
  const rec = recordOf(t);
  if (rec !== undefined && t.kind === 'array')
    return `Record<${recordKeyText(rec)}, ${spell(t.elem)}>`;
  if (t.kind === 'collection') {
    const members = keysOf(collectionKeyOf(t));
    const key = members === undefined ? t.key : keyTypeText(members);
    return t.value === undefined ? `Set<${key}>` : `Map<${key}, ${spell(t.value)}>`;
  }
  switch (t.kind) {
    // A struct is named as the hover's document names it, not as the module emits it.
    case 'struct':
      return struct(t.name);
    case 'f64':
      return 'f64';
    case 'vec64':
      return `vec${t.n}<f64>`;
    case 'mat':
      return t.elem === 'f64' ? `mat${t.cols}x${t.rows}<f64>` : wgslType(t);
    case 'array':
      return t.size !== undefined
        ? `array<${spell(t.elem)}, ${t.size}>`
        : `array<${spell(t.elem)}>`;
    default:
      return wgslType(t);
  }
}

/** The types the hover shows of `symbol`: its own, and each parameter's. */
const typesOf = (symbol: DeclaredSymbol): string =>
  [spellShaderType(symbol.type), ...(symbol.params ?? []).map((p) => spellShaderType(p.type))].join(
    '|',
  );

/** The symbols the front end recorded at one declaration, read as one: a symbol to show, and
 *  whether every one of them belongs to one struct. */
interface OneSymbol {
  readonly symbol: DeclaredSymbol;
  /** `false` for a field that more than one struct holds at this declaration, each with the
   *  same type: no one of them owns the hovered field. */
  readonly oneOwner: boolean;
}

/**
 * The one symbol among `at`, the symbols the front end recorded at one declaration, or
 * `undefined` when they differ in a type.
 *
 * - The front end lowers a generic function and a generic class once for each instance
 *   (`twice_f32`, `twice_vec3`; `Box_f32`, `Box_vec3`), and records each instance at the one
 *   declaration. Where the instances differ in a type, no one of them is the type of every use,
 *   and a hover must not show a use the type of another instance (Rule 12.7). Such a declaration
 *   keeps TypeScript's quick info, which names the instance of the use.
 * - A declaration can hold symbols of two kinds: a parameter property,
 *   `constructor(public center: vec2)`, is a `field` and a `param` at one name. `field` says
 *   which the hover is of: a property, or anything else.
 * - A field whose instances agree on its type keeps that type. Where more than one struct
 *   holds it (a field of a mixin, a field of a generic class whose type is no type parameter),
 *   `oneOwner` is false, and the hover names the owner as TypeScript does.
 */
function oneOf(at: readonly DeclaredSymbol[], field: boolean): OneSymbol | undefined {
  const ofKind = at.filter((s) => (s.kind === 'field') === field);
  const among = ofKind.length > 0 ? ofKind : at;
  const first = among[0];
  if (first === undefined) return undefined;
  if (!among.every((s) => s.kind === first.kind && typesOf(s) === typesOf(first))) return undefined;
  return { symbol: first, oneOwner: among.every((s) => s.struct === first.struct) };
}

/**
 * The symbol the front end declared at the position `defs` resolves to, or `undefined` when
 * TypeScript resolves the identifier to another file (an imported document, the ambient lib), to
 * something the front end never lowered, or to a declaration it lowered as instances of
 * different types (`oneOf`). `field` is whether the hover is of a property.
 *
 * The join is the declaration's start offset: a `DeclaredSymbol` spans the declared NAME
 * identifier, which is exactly what `getDefinitionAtPosition` returns for a local, a parameter,
 * a module const, a function, a class or a property. Going through TypeScript's resolution,
 * rather than matching on the name, is what makes a hover at a USE show the same type as a
 * hover at the declaration, and what tells two shadowing declarations of one name apart.
 */
function declaredSymbolAt(
  analysis: CompileTsSourceResult,
  uri: string,
  defs: readonly ts.DefinitionInfo[],
  field: boolean,
): OneSymbol | undefined {
  for (const def of defs) {
    if (def.fileName !== uri) continue;
    const at = analysis.symbols.filter((s) => s.start === def.textSpan.start);
    if (at.length > 0) return oneOf(at, field);
  }
  return undefined;
}

/** A symbol that the hovered document's own table does not hold, as the hover shows it. */
interface ImportedSymbol extends OneSymbol {
  /** The declaring file, and the offset of the declared name in it. */
  readonly sourceFile: ts.SourceFile;
  readonly start: number;
  /** Whether the symbol is a module variable, which the table records as a binding. */
  readonly moduleVar: boolean;
  /** The program the symbol was read in: its struct names and its parameters are that
   *  program's (`programIndexOf`). */
  readonly program: HoverProgram;
  /** The resource binding the symbol is in the hovered document's program, if it is one. */
  readonly binding: CompileTsSourceResult['bindings'][number] | undefined;
}

/**
 * Whether the hover in the declaring file reads the declaration named at `name` from the
 * compiler's table, so that the hover across an import must read it there too. The hover in one
 * file takes a recorded symbol only under the hovered name (`getHover`, `named`), which leaves
 * every member to TypeScript's quick info: a method, a getter and a static function are recorded
 * as `Ray.reach`, a member of a namespace as `Tone_map` and a member of an enum as `Mode_Lit`.
 * This is the same line, read off the declaration:
 *
 * - a `field` is a property of an interface, a type literal or a class, or a parameter
 *   property of a constructor: every field the table records;
 * - every other kind is a function or a variable declared at the top of its file.
 */
function readsFromCompiler(kind: DeclaredSymbol['kind'], name: ts.Node): boolean {
  const decl = name.parent;
  // Every `field` of the table is a property of a struct. A static field is none: the front
  // end records it as a constant under a longer name (`Ray_UP`), which the arm below refuses.
  if (kind === 'field') return true;
  if (kind === 'function') return ts.isFunctionDeclaration(decl) && ts.isSourceFile(decl.parent);
  if (kind === 'const' || kind === 'binding' || kind === 'override')
    return (
      ts.isVariableDeclaration(decl) &&
      ts.isVariableDeclarationList(decl.parent) &&
      ts.isVariableStatement(decl.parent.parent) &&
      ts.isSourceFile(decl.parent.parent.parent)
    );
  return false;
}

/**
 * The symbol that the program `program` declares where `defs` resolves the hovered name to, in
 * a file `declaredIn` takes that the program links (Rule 3.9): an imported field, function,
 * module constant, module variable, override or binding. `undefined` for a single-file program,
 * for a declaration the program did not keep, for one it lowered as instances of different
 * types (`oneOf`), and for a member, which keeps TypeScript's quick info as it does in one file
 * (`readsFromCompiler`). `field` is whether the hover is of a property.
 *
 * The join is the declaration, by its file and its position, as `linkedFieldAt` joins a field:
 * the linker kept, for every span of the linked source, the file and the offsets the author
 * wrote (`LinkedProgram.map`). So the type is the one the front end gave the declaration in THIS
 * program, the program `compile()` of its document compiles (Rule 12.7), and the hover computes
 * none.
 */
function importedSymbolAt(
  program: HoverProgram,
  defs: readonly ts.DefinitionInfo[],
  declaredIn: (fileName: string) => boolean,
  field: boolean,
): ImportedSymbol | undefined {
  const { analysis } = program;
  if (linkedCompileOf(analysis) === undefined) return undefined;
  const { declared } = programIndexOf(program);
  for (const def of defs) {
    if (!declaredIn(def.fileName)) continue;
    const here = declared.get(placeKey(def.fileName, def.textSpan.start));
    if (here === undefined) continue;
    const { sourceFile } = here;
    const one = oneOf(here.symbols, field);
    const name = nodeAt(sourceFile, def.textSpan.start);
    if (one === undefined || name === undefined || !ts.isIdentifier(name)) return undefined;
    const { symbol } = one;
    if (!readsFromCompiler(symbol.kind, name)) return undefined;
    return {
      ...one,
      sourceFile,
      start: def.textSpan.start,
      moduleVar: analysis.vars.some((v) => v.name === symbol.name),
      program,
      binding:
        symbol.kind === 'binding'
          ? analysis.bindings.find((b) => b.name === symbol.name)
          : undefined,
    };
  }
  return undefined;
}

/**
 * The symbol of a name that the hovered document imports and its own program does not keep (an
 * import no code uses yet), read in the declaring document's own program, when that document is
 * open (`programs.of`). The type is the one the declaring file's hover shows. The hovered
 * document's program has no such binding, so a binding has no resource line here.
 * `sourceFileOf` gives the declaring file as TypeScript holds it, the text the declaring
 * document's analysis read.
 */
function unlinkedSymbolAt(
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  programs: HoverPrograms,
  sourceFileOf: (fileName: string) => ts.SourceFile | undefined,
  field: boolean,
): ImportedSymbol | undefined {
  for (const def of defs) {
    if (def.fileName === uri) continue;
    const declaring = programs.of(def.fileName);
    const sourceFile = sourceFileOf(def.fileName);
    if (declaring === undefined || sourceFile === undefined) continue;
    const one = declaredSymbolAt(declaring.analysis, def.fileName, [def], field);
    const name = nodeAt(sourceFile, def.textSpan.start);
    if (one === undefined || name === undefined || !ts.isIdentifier(name)) continue;
    const { symbol } = one;
    // No member reaches here: an import names a top-level declaration, and the hovered program
    // keeps no symbol at it. A struct's name has no compiler's line and keeps TypeScript's.
    return {
      ...one,
      sourceFile,
      start: def.textSpan.start,
      moduleVar: declaring.analysis.vars.some((v) => v.name === symbol.name),
      program: declaring,
      binding: undefined,
    };
  }
  return undefined;
}

/**
 * `defs` with each overload signature of a function replaced by the function's implementation,
 * the one declaration with a body, which is the one the front end lowers and records, with its
 * qualifiers (Rule 8.25). TypeScript resolves a call of an overloaded function to a signature
 * that has no body, and the compiler's table has no symbol there.
 */
function implementationsOf(
  defs: readonly ts.DefinitionInfo[],
  sourceFileOf: (fileName: string) => ts.SourceFile | undefined,
): readonly ts.DefinitionInfo[] {
  return defs.map((def) => {
    const sourceFile = sourceFileOf(def.fileName);
    const name = sourceFile && nodeAt(sourceFile, def.textSpan.start);
    const decl = name?.parent;
    if (
      name === undefined ||
      !ts.isIdentifier(name) ||
      decl === undefined ||
      !ts.isFunctionDeclaration(decl) ||
      decl.body !== undefined
    )
      return def;
    const container = decl.parent;
    const statements: readonly ts.Statement[] =
      ts.isSourceFile(container) || ts.isModuleBlock(container) ? container.statements : [];
    const body = statements
      .filter(ts.isFunctionDeclaration)
      .find((st) => st.body !== undefined && st.name?.text === name.text);
    if (body?.name === undefined) return def;
    const start = body.name.getStart(sourceFile);
    return { ...def, textSpan: { start, length: body.name.getWidth(sourceFile) } };
  });
}

/** The place of a declared name: its file and the offset of the name in it. */
const placeKey = (fileName: string, start: number): string => `${fileName}\0${String(start)}`;

/** The names of the namespaces around `node`, the outermost first. */
function namespacesAround(node: ts.Node): string[] {
  const out: string[] = [];
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent)
    if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) out.unshift(n.name.text);
  return out;
}

/** A struct of a program, by its declaration. */
interface StructDecl {
  /** Where the author declared it. */
  readonly place: string;
  /** The declared name as the module has it, which the linker may have generated (`lib_Light`,
   *  `lib_Stage_VsOut` for a class of a renamed namespace), and as the author wrote it (`Light`,
   *  `Stage_VsOut`): the names of the namespaces around the declaration and the declared
   *  identifier, joined as the front end joins them. The struct's name is this part, then the
   *  arguments of an instance of a generic class (`_f32`). */
  readonly emitted: string;
  readonly written: string;
}

/** What a hover reads of a program beside a symbol: its structs by the name its types carry,
 *  and the places of the parameters the front end kept. */
interface ProgramIndex {
  readonly structs: ReadonlyMap<string, StructDecl>;
  readonly params: ReadonlySet<string>;
  /** For a program that links another file: the symbols the front end recorded at each place,
   *  with the linker's parse of the file the place is in. Empty for a program of one file,
   *  whose own table is read by its offsets. */
  readonly declared: ReadonlyMap<
    string,
    { readonly symbols: DeclaredSymbol[]; readonly sourceFile: ts.SourceFile }
  >;
}

/**
 * The index of `program`, made once for each analysis. For a program that links another file
 * it reads the linked table through the linker's map, so each place is the author's file and
 * offset. For a program of one file it reads the document's own table.
 */
function programIndexOf(program: HoverProgram): ProgramIndex {
  const known = programIndexes.get(program.analysis);
  if (known !== undefined) return known;
  const structs = new Map<string, StructDecl>();
  const params = new Set<string>();
  const declared = new Map<string, { symbols: DeclaredSymbol[]; sourceFile: ts.SourceFile }>();
  /** The declared name at the identifier `start` of `sourceFile`: its namespaces and itself. */
  const declaredName = (sourceFile: ts.SourceFile, start: number): string | undefined => {
    const id = nodeAt(sourceFile, start);
    return id === undefined || !ts.isIdentifier(id)
      ? undefined
      : [...namespacesAround(id), id.text].join('_');
  };
  const add = (
    symbol: DeclaredSymbol,
    place: string,
    emitted: string | undefined,
    written: string | undefined,
  ): void => {
    if (symbol.kind === 'param') params.add(place);
    // One emitted name is one struct of the module. Each instance of a generic class has a
    // name of its own, and so does each struct the linker renamed.
    if (symbol.kind === 'struct' && emitted !== undefined && written !== undefined)
      structs.set(symbol.name, { place, emitted, written });
  };
  const linked = linkedCompileOf(program.analysis);
  if (linked !== undefined) {
    for (const symbol of linked.symbols) {
      const end = symbol.start + symbol.length;
      const at = linked.linked.map(symbol.start, end);
      if (at === undefined) continue;
      const place = placeKey(at.file.name, at.start);
      const here = declared.get(place);
      if (here === undefined)
        declared.set(place, { symbols: [symbol], sourceFile: at.file.sourceFile });
      else here.symbols.push(symbol);
      if (symbol.kind === 'struct')
        add(
          symbol,
          place,
          declaredName(linked.sourceFile, symbol.start),
          declaredName(at.file.sourceFile, at.start),
        );
      else add(symbol, place, undefined, undefined);
    }
  } else {
    const { sourceFile } = program.analysis;
    for (const symbol of program.analysis.symbols) {
      if (symbol.kind !== 'param' && symbol.kind !== 'struct') continue;
      const written = symbol.kind === 'struct' ? declaredName(sourceFile, symbol.start) : undefined;
      add(symbol, placeKey(program.uri, symbol.start), written, written);
    }
  }
  const index = { structs, params, declared };
  programIndexes.set(program.analysis, index);
  return index;
}
const programIndexes = new WeakMap<CompileTsSourceResult, ProgramIndex>();

/**
 * The name `sourceFile` writes for each declaration it imports by name, by the declaration's
 * place: `L` for `import { Light as L }` and `import type { Light as L }`, `Lamp` for
 * `import { Lamp }` where another file has `export { Light as Lamp }`. TypeScript follows the
 * import to the declaration, and every declaration of the symbol has the name. A declaration
 * the file imports under two names has `undefined`: no one name is the file's.
 *
 * The places are offsets in other files, so the map is made once for each TypeScript program,
 * which is new whenever any document changes, and for each version of the document. Made only
 * when a hover has a struct to name.
 */
function importNamesOf(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker | undefined,
): ReadonlyMap<string, string | undefined> {
  if (checker === undefined) return new Map();
  let ofChecker = importNames.get(checker);
  if (ofChecker === undefined) {
    ofChecker = new WeakMap();
    importNames.set(checker, ofChecker);
  }
  const known = ofChecker.get(sourceFile);
  if (known !== undefined) return known;
  const out = new Map<string, string | undefined>();
  ofChecker.set(sourceFile, out);
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      // The name an import specifier declares is always an alias.
      const alias = checker.getSymbolAtLocation(spec.name);
      if (alias === undefined) continue;
      for (const decl of checker.getAliasedSymbol(alias).declarations ?? []) {
        const name = ts.getNameOfDeclaration(decl);
        if (name === undefined) continue;
        const place = placeKey(decl.getSourceFile().fileName, name.getStart());
        out.set(
          place,
          out.has(place) && out.get(place) !== spec.name.text ? undefined : spec.name.text,
        );
      }
    }
  }
  return out;
}
const importNames = new WeakMap<
  ts.TypeChecker,
  WeakMap<ts.SourceFile, Map<string, string | undefined>>
>();

/**
 * The name of a struct as the module has it, `name`, with its declared part `emitted` replaced by
 * `to`. The front end builds a struct's name as its declared part (`lib_Light`,
 * `lib_Stage_VsOut`) and, for an instance of a generic class, `_` and the arguments
 * (`lib_Box_f32`). The declared part is read from the declaration (`programIndexOf`), so this
 * replaces a known prefix: it searches no text. The arguments stay as the module spells them.
 */
function withDeclaredName(name: string, emitted: string, to: string): string {
  if (name === emitted) return to;
  return name.startsWith(`${emitted}_`) ? `${to}${name.slice(emitted.length)}` : name;
}

/**
 * How the hover in `sourceFile` names the structs of `program` (Rule 12.7; the owner's
 * decisions of 2026-11-10). The name is decided from the struct's declaration, never from a
 * text:
 *
 * 1. The compiler's type carries the name the module emits. `programIndexOf` gives that struct's
 *    declaration: the place the author declared it, and its declared part as the module has it
 *    and as the author wrote it (the namespaces around it and its identifier).
 * 2. Where the hovered document imports that declaration under exactly one name, the struct
 *    reads by that name, which is the one the document can write. Otherwise it reads by its
 *    declared name.
 * 3. A name the linker generated (`lib_Light`, `lib_Light_2`, `lib_Stage_VsOut`) is therefore
 *    never shown as the declared part of a struct's name, and a name the author wrote is never
 *    changed: a field's, a parameter's, the hovered symbol's own and every identifier that only
 *    holds such a name as a part.
 *
 * One part is not named this way: the arguments of an instance of a generic class keep the
 * module's spelling (`Box_lib_Light`), since the table records no link from an instance to the
 * declarations of its arguments.
 */
function structNamesOf(
  program: HoverProgram,
  sourceFile: ts.SourceFile,
  checker: () => ts.TypeChecker | undefined,
): StructNames {
  return (name) => {
    const decl = programIndexOf(program).structs.get(name);
    if (decl === undefined) return name;
    const imported = importNamesOf(sourceFile, checker()).get(decl.place);
    return withDeclaredName(name, decl.emitted, imported ?? decl.written);
  };
}

/**
 * The parameters of the function whose name is declared at offset `start` of `sourceFile`, as
 * a hover writes them: each with its qualifier (Rule 8.25), the name the author wrote and the
 * type the symbol `fn` of `program` has for it.
 *
 * The front end keeps no parameter that takes a function, so `fn.params` can be shorter than
 * the declaration's list, and the module may emit a parameter under a name of its own
 * (`lib_K`). The join is the declaration: a parameter is kept when the program recorded a
 * parameter at the place of its name (`programIndexOf`), and the kept parameters stand in the
 * order of `fn.params`. Where the two lists do not pair, the parameters are the names and the
 * types of `fn.params`, with no qualifier.
 */
function writtenParams(
  sourceFile: ts.SourceFile,
  start: number,
  program: HoverProgram,
  fn: DeclaredSymbol,
  struct: StructNames,
): string[] {
  const types = (fn.params ?? []).map((p) => spellShaderType(p.type, struct));
  let node: ts.Node | undefined = nodeAt(sourceFile, start);
  while (node !== undefined && !ts.isFunctionDeclaration(node)) node = node.parent;
  const { params } = programIndexOf(program);
  const kept = (node?.parameters ?? []).filter(
    (p) =>
      ts.isIdentifier(p.name) &&
      params.has(placeKey(sourceFile.fileName, p.name.getStart(sourceFile))),
  );
  if (kept.length !== types.length)
    return (fn.params ?? []).map((p, i) => `${p.name}: ${types[i]!}`);
  return kept.map((p, i) => {
    const q = qualifiersOf(p)[0]?.name;
    return `${q !== undefined ? `@${q} ` : ''}${(p.name as ts.Identifier).text}: ${types[i]!}`;
  });
}

/** The qualifier written on the parameter the front end recorded as `param`, `@inout` or `@out`
 *  (Rule 8.25), read off the declaration in the source. */
function qualifierOfParam(sourceFile: ts.SourceFile, param: DeclaredSymbol): string | undefined {
  let node: ts.Node | undefined = nodeAt(sourceFile, param.start);
  while (node !== undefined && !ts.isParameter(node)) node = node.parent;
  return node === undefined ? undefined : qualifiersOf(node)[0]?.name;
}

/** The innermost node of `sourceFile` that starts at or covers `pos`. */
function nodeAt(sourceFile: ts.SourceFile, pos: number): ts.Node | undefined {
  const holds = (n: ts.Node): boolean => n.getStart(sourceFile) <= pos && pos < n.getEnd();
  let found: ts.Node | undefined;
  let current: ts.Node | undefined = holds(sourceFile) ? sourceFile : undefined;
  // Children do not overlap and stand in source order, so the descent goes into the one child
  // that holds `pos`, found in a list by a binary search on the ends: a lookup costs the depth
  // of the node and the logarithm of each list, not the size of the file.
  while (current !== undefined) {
    found = current;
    let next: ts.Node | undefined;
    ts.forEachChild(
      current,
      (child) => {
        if (child.pos > pos) return true;
        if (holds(child)) {
          next = child;
          return true;
        }
        return undefined;
      },
      (children) => {
        let lo = 0;
        let hi = children.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (children[mid]!.getEnd() <= pos) lo = mid + 1;
          else hi = mid;
        }
        const child = children[lo];
        if (child === undefined) return undefined;
        if (holds(child)) next = child;
        return child.pos > pos || next !== undefined ? true : undefined;
      },
    );
    current = next;
  }
  return found;
}

/** What an `@inout` or `@out` parameter is, in one paragraph: the caller's place, and how each
 *  target spells it (Rule 8.25, surface section 70). */
function referenceLine(param: DeclaredSymbol, qualifier: string): string {
  return qualifier === 'out'
    ? `Names a place of the caller's that the function writes: write \`${param.name}\` before ` +
        `reading it, and on every path before returning. The caller passes a variable, which ` +
        `may have no value yet. WGSL takes it as a pointer, \`ptr<function, ` +
        `${wgslType(param.type)}>\` for a local; GLSL ES 3.00 as an \`out\` parameter.`
    : `Names the caller's place: reading \`${param.name}\` reads it, and assigning to it, or to ` +
        `a field, component or element of it, writes it. The caller passes a variable. WGSL ` +
        `takes it as a pointer, \`ptr<function, ${wgslType(param.type)}>\` for a local; GLSL ES ` +
        `3.00 as an \`inout\` parameter.`;
}

/**
 * The owner of the property `quickInfo` describes, as TypeScript names it: the parts of
 * `(property) Box<vec3>.n: i32` between the kind and the property's name. `undefined` when the
 * quick info has no such shape.
 */
function ownerOf(quickInfo: ts.QuickInfo): string | undefined {
  const parts = quickInfo.displayParts ?? [];
  const name = parts.map((p) => p.kind).lastIndexOf('propertyName');
  const space = parts.findIndex((p) => p.kind === 'space');
  if (name < 2 || space < 0 || space >= name || parts[name - 1]?.text !== '.') return undefined;
  return ts.displayPartsToString(parts.slice(space + 1, name - 1));
}

/**
 * The first line of the hover for a declaration the front end lowered, in TypeScript's own quick
 * info shapes so an editor renders it the way it renders everything else. `undefined` means keep
 * what TypeScript said: a data class is one, since `class Vertex` already names it and the
 * compiler's `struct:Vertex` would only be noise.
 */
function declarationLine(
  symbol: DeclaredSymbol,
  moduleVar: boolean,
  struct: StructNames,
  params: readonly string[],
  owner: string | undefined,
): string | undefined {
  const type = spellShaderType(symbol.type, struct);
  switch (symbol.kind) {
    case 'local':
      return `${symbol.mutable === false ? 'const' : 'let'} ${symbol.name}: ${type}`;
    case 'param':
      return `(parameter) ${symbol.name}: ${type}`;
    case 'const':
      return `const ${symbol.name}: ${type}`;
    // An override is declared `const` (Rule 6.1), and its type is the compiler's: `override<bool>`
    // reads `const flag: bool`, as the emitted `override flag: bool` does, where TypeScript's
    // quick info said `boolean`.
    case 'override':
      return `const ${symbol.name}: ${type}`;
    // A binding keeps `const name: T`, the shape TypeScript already uses for it: the address
    // space is on the resource line below, so spelling it `uniform<T>` here would say it twice.
    // The keyword is always `const` because a binding is always declared `const` (design rule
    // 6.1); what used to be read out of `symbol.mutable` here is the ACCESS MODE now, and the
    // resource line below is where it belongs, beside the address space it is part of.
    //
    // A module variable is recorded as a binding too (module-vars.ts), since it is mutable
    // module state with no layout, and it is declared `let` (Rule 6.5), so it says `let`.
    case 'binding':
      return `${moduleVar ? 'let' : 'const'} ${symbol.name}: ${type}`;
    case 'function':
      return `function ${symbol.name}(${params.join(', ')}): ${type}`;
    // The owner is the field's struct, or TypeScript's name for it where the front end
    // recorded the field for more than one struct (`oneOf`).
    case 'field':
      return `(property) ${owner ?? struct(symbol.struct ?? '')}.${symbol.name}: ${type}`;
    case 'struct':
      return undefined;
  }
}

/** "u32 or f32", "i32, u32 or f32": the types in the order of TypeShade's words (decision Q3). */
function typesInWords(types: readonly ShaderType[], struct: StructNames): string {
  const order = ['i32', 'u32', 'f32', 'f64'];
  const rank = (t: string): number => (order.includes(t) ? order.indexOf(t) : order.length);
  const spelled = [...new Set(types.map((t) => spellShaderType(t, struct)))].sort(
    (a, b) => rank(a) - rank(b),
  );
  return spelled.length <= 1
    ? (spelled[0] ?? '')
    : `${spelled.slice(0, -1).join(', ')} or ${spelled[spelled.length - 1]!}`;
}

/**
 * The first line of the hover of a function whose calls ask two or more result types, and of
 * a local in its body (Rule 8.19, change 0134 item 4; Amendment A1, "사본마다 추론"), or
 * `undefined` when `node` names neither. The function is lowered once for each type, so the
 * compiler's table records a type for each copy and no one of them is the type of every use. The
 * hover reads the compile's own facts (`resultCopiesAt`, `copyCallAt`) and computes none:
 *
 * - at a call, the result of the copy that call takes: `function g(): u32` in `vi + g()`;
 * - at the declaration, and at a call with no one copy, the result types in TypeShade's words:
 *   `function g() (u32 or f32 where it is called)`;
 * - at a local of its body that the copies type apart, each type:
 *   `let k (u32 or f32 where "g" is called)`.
 */
function resultCopiesLine(
  node: ts.Node,
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  sourceFile: ts.SourceFile,
  analysis: CompileTsSourceResult,
  struct: StructNames,
): string | undefined {
  if (!ts.isIdentifier(node)) return undefined;
  const def = defs.find((d) => d.fileName === uri);
  if (def === undefined) return undefined;
  const table = analysis.sourceFile;
  const at = def.textSpan.start;
  const fn = resultCopiesAt(table, at);
  // A call of a function its calls decide hovers as the copy it calls; a generic function's
  // instance records no declaration line, only its calls.
  const call = copyCallAt(table, node.getStart(sourceFile));
  const named = nodeAt(sourceFile, at);
  const decl = named?.parent;
  const generic =
    decl !== undefined &&
    ts.isFunctionLike(decl) &&
    ((decl as ts.SignatureDeclaration).typeParameters?.length ?? 0) > 0;
  if (fn !== undefined || (call !== undefined && generic)) {
    const fnNode =
      decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined
        ? decl.initializer
        : decl;
    // A generic function's instance shows the call's type arguments and the instance's
    // parameter types, `m<f32>(a: f32)`, as TypeScript names an instance.
    const instance = generic ? copyCallParamsAt(table, node.getStart(sourceFile)) : undefined;
    const written = fnNode !== undefined && ts.isFunctionLike(fnNode) ? fnNode.parameters : [];
    const params =
      instance !== undefined
        ? written
            .map((p, i) => {
              const t = instance[instance.length - written.length + i];
              return `${p.name.getText(sourceFile)}: ${t === undefined ? '?' : spellShaderType(t, struct)}`;
            })
            .join(', ')
        : written.map((p) => p.getText(sourceFile).replace(/\s+/g, ' ')).join(', ');
    const callNode = node.parent;
    const typeArgs =
      generic && ts.isCallExpression(callNode) && callNode.typeArguments !== undefined
        ? `<${callNode.typeArguments.map((a) => a.getText(sourceFile)).join(', ')}>`
        : '';
    const owner =
      decl !== undefined && ts.isClassElement(decl) && ts.isClassLike(decl.parent)
        ? `${decl.parent.name?.text ?? ''}.`
        : '';
    const one = fn !== undefined && fn.types.length === 1 ? fn.types[0] : undefined;
    const fixed = call ?? one;
    const result = fixed !== undefined ? spellShaderType(fixed, struct) : undefined;
    const words = `${typesInWords(fn?.types ?? [], struct)} where it is called`;
    if (decl !== undefined && ts.isGetAccessorDeclaration(decl)) {
      return `(getter) ${owner}${node.text}${result !== undefined ? `: ${result}` : ` (${words})`}`;
    }
    if (decl !== undefined && ts.isVariableDeclaration(decl)) {
      return `const ${node.text}: (${params}) => ${result ?? `(${words})`}`;
    }
    const head =
      decl !== undefined && ts.isMethodDeclaration(decl)
        ? `(method) ${owner}${node.text}(${params})`
        : decl !== undefined &&
            ts.isFunctionDeclaration(decl) &&
            !ts.isSourceFile(decl.parent) &&
            !ts.isModuleBlock(decl.parent)
          ? `(local function) ${node.text}(${params})`
          : `function ${node.text}${typeArgs}(${params})`;
    return result !== undefined ? `${head}: ${result}` : `${head} (${words})`;
  }
  const local = analysis.symbols.filter((s) => s.start === at && s.kind === 'local');
  if (local.length < 2 || local.every((s) => typesOf(s) === typesOf(local[0]!))) return undefined;
  // The function whose body declares the local, by the name its declaration gives it.
  let around: ts.Node | undefined = nodeAt(sourceFile, at);
  let copies: ReturnType<typeof resultCopiesAt>;
  for (; around !== undefined && copies === undefined; around = around.parent) {
    if (!ts.isFunctionLike(around)) continue;
    const name =
      (around as { name?: ts.Node }).name ??
      (ts.isVariableDeclaration(around.parent) ? around.parent.name : undefined);
    if (name !== undefined) copies = resultCopiesAt(table, name.getStart(sourceFile));
  }
  if (copies === undefined) return undefined;
  return (
    `${local[0]!.mutable === false ? 'const' : 'let'} ${node.text} ` +
    `(${typesInWords(
      local.map((s) => s.type),
      struct,
    )} where "${copies.name}" is called)`
  );
}

/**
 * The first line of the hover of a constant of no fixed type (Rule 5.1, change 0134 item 4), or
 * `undefined` when `node` names none. `defs` is where TypeScript resolves the name.
 *
 * Such a constant has no one type, so the compiler's table records its declaration at the type
 * of its emitted `f32` declaration, which is the type of no read but an `f32` one. The hover reads
 * the compile's own facts instead (`abstractConstTableOf`), and computes none:
 *
 * - at a read, the type that read took: `const K: u32` in `vi * K`, as the written number `3`
 *   takes `u32` there. A read in a file that imports the constant is read in that file's
 *   program, which the compile of its document compiles (Rule 12.7).
 * - at the declaration, and at a read with no one type (one lowered once per instance of a
 *   generic function at two types, one inside another such constant's initializer, one the
 *   program does not lower), the language's own words (decision Q3):
 *   `const K = 3 (i32, u32, f32 or f64 where it is read)`, and for a float-written constant
 *   `const C = 0.1 (f32 or f64 where it is read)`. In a file whose reads are all in the files
 *   that import it, nothing in the file decides, and these words are what the hover shows.
 *
 * A static field that no code writes is such a constant too (Rule 8.13): `static Z = 4 (…)` at
 * its declaration, `(property) S.Z: u32` at a read.
 */
function abstractConstLine(
  node: ts.Node,
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  sourceFile: ts.SourceFile,
  analysis: CompileTsSourceResult,
  checker: () => ts.TypeChecker | undefined,
  declaring: CompileTsSourceResult | undefined,
): string | undefined {
  if (!ts.isIdentifier(node) || defs.length === 0) return undefined;
  const declaredIn = (result: CompileTsSourceResult | undefined) =>
    (result === undefined ? undefined : abstractConstTableOf(result.sourceFile))?.decls.find((d) =>
      defs.some((def) => def.fileName === d.fileName && def.textSpan.start === d.start),
    );
  const table = abstractConstTableOf(analysis.sourceFile);
  // An import this document's program does not keep is read in the declaring document's own
  // program (`unlinkedSymbolAt`), which holds the declaration and none of this file's reads.
  const decl = declaredIn(analysis) ?? declaredIn(declaring);
  if (decl === undefined) return undefined;
  const name = node.text;
  const start = node.getStart(sourceFile);
  const access =
    ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      ? node.parent
      : undefined;
  if (decl.fileName !== uri || start !== decl.start) {
    // A read of a static field is the access that names it, `S.Z`.
    const spans = [node, ...(access !== undefined ? [access] : [])].map((n) => {
      const at = n.getStart(sourceFile);
      return { start: at, length: n.getEnd() - at };
    });
    const read = table?.reads.find((r) =>
      spans.some((s) => s.start === r.start && s.length === r.length),
    );
    if (read?.type != null) {
      const type = spellShaderType(read.type);
      // A read through a namespace names it as TypeScript does, by the namespace's own name
      // (`const Tone.GAMMA: f32`, also for `lib.Tone.GAMMA`). A namespace import
      // (`import * as lib`) is no part of the name: `lib.K` reads `const K`, as a named import
      // of it does.
      const left = access?.expression;
      const viaImport =
        left !== undefined &&
        (checker()
          ?.getSymbolAtLocation(left)
          ?.declarations?.some((d) => ts.isNamespaceImport(d)) ??
          false);
      const owner =
        left === undefined || viaImport
          ? undefined
          : ts.isPropertyAccessExpression(left)
            ? left.name.text
            : left.getText(sourceFile);
      if (decl.keyword === 'const')
        return owner === undefined ? `const ${name}: ${type}` : `const ${owner}.${name}: ${type}`;
      return owner === undefined
        ? `(property) ${name}: ${type}`
        : `(property) ${owner}.${name}: ${type}`;
    }
  }
  const types = decl.integerWritten ? 'i32, u32, f32 or f64' : 'f32 or f64';
  // The name an import or an export binds (`import { K }`, `import { K as Q }`) is an alias of
  // the constant, marked as TypeScript marks every such binding, so the alias is not read as the
  // constant's own name.
  const parent = node.parent;
  const alias =
    (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.name === node;
  return `${alias ? '(alias) ' : ''}${decl.keyword} ${name} = ${decl.written} (${types} where it is read)`;
}

/**
 * Hover at `offset` in `uri`: a TypeShade documentation sentence for a GPU type name, an
 * attribute, or a builtin string, and otherwise the symbol's type.
 *
 * That type comes from the COMPILER for a name declared in this document, read off
 * `analysis.symbols` (the service's cached front-end run for this document version, §8) through
 * the declaration TypeScript resolves the identifier to. TypeScript's own inference cannot be
 * trusted for it: the ambient GPU scalars brand `number` optionally, so `let x = 1.` infers
 * plain `number` where the front end lowered an `f32`, and `const half = 0.5` infers the literal
 * type `0.5`. A field, a function, a module constant, a module variable, an override and a
 * binding that another file of the document's program declares are read in that program too, by
 * their declaration (`importedSymbolAt`), under the name this document writes. Everything else
 * keeps TypeScript's quick info: a host-side declaration, a member (a method, a getter, a static
 * function, a member of a namespace or of an enum), a data class name (`class Vertex` already
 * says it), a declaration the front end lowered as more than one instance (`oneOf`), a
 * declaration the front end refused to lower and so never recorded (its own diagnostic on that
 * line says why), and the documentation section of every hover. A resource binding also gains
 * one line from `analysis`: its access mode, address space and `@group`/`@binding` slot. A
 * user-defined input or output of an entry gains one too: what it is and its location, written
 * or given by the compiler (Rule 6.6, change 0135). A field has that line across the files of a
 * program: `programs.linking` gives the programs of the other open documents that link a file,
 * for a field this document's program gives no place among its entries (`entryLocationLines`)
 * or no symbol. Where those programs give the field different numbers, each has a line of its
 * own, with its file. `programs.of` gives the program of one open document, for a name this
 * document imports and its program does not keep (`unlinkedSymbolAt`).
 *
 * A struct in a type, and the owner of a field, read by the name this document writes for the
 * struct's declaration (`structNamesOf`): no name the linker generated is shown, and no name an
 * author wrote is changed.
 */
export function getHover(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  analysis: CompileTsSourceResult,
  programs: HoverPrograms = { linking: () => [], of: () => undefined },
): TypeshadeHover | undefined {
  // The touching rule: a caret at the end of a name answers for that name (#56). TypeScript's
  // own quick info already works that way, which is why the fall-through below looked right at
  // such a position while quietly being TypeScript's answer instead of the compiler's.
  const node = touchingNodeAtPosition(sourceFile, offset);

  if (isBuiltinStringLiteral(node) && WGSL_BUILTIN_NAMES.includes(node.text)) {
    const doc = BUILTIN_DOCS[node.text];
    if (doc) {
      const span = { start: node.getStart() + 1, length: node.text.length };
      return { contents: `\`${node.text}\` — ${doc}`, range: rangeForSpan(sourceFile, span) };
    }
  }

  // `@workgroup_size` is WGSL's name, which the compiler reads on a kernel function only (proposal
  // 0067), so it is documented here beside the attributes the compiler reads.
  if (isAttributeName(node) && [...ATTRIBUTE_NAMES, 'workgroup_size'].includes(node.text)) {
    const doc = ATTRIBUTE_DOCS[node.text];
    if (doc) {
      const span = { start: node.getStart(), length: node.getWidth() };
      return { contents: `\`@${node.text}\` — ${doc}`, range: rangeForSpan(sourceFile, span) };
    }
  }

  if (isTypeName(node) && TYPE_DOCS[node.text]) {
    const span = { start: node.getStart(), length: node.getWidth() };
    return {
      contents: `\`${node.text}\` — ${TYPE_DOCS[node.text]}`,
      range: rangeForSpan(sourceFile, span),
    };
  }

  const wSpan = wordSpan(sourceFile.text, offset);
  const word = sourceFile.text.slice(wSpan.start, wSpan.start + wSpan.length);
  if (TYPE_DOCS[word] !== undefined && !ts.isIdentifier(node)) {
    return { contents: `\`${word}\` — ${TYPE_DOCS[word]}`, range: rangeForSpan(sourceFile, wSpan) };
  }

  const quickInfo = languageService.getQuickInfoAtPosition(uri, offset);
  if (!quickInfo) return undefined;
  // At most one definition query per hover, shared by the answers that need it, and only
  // when one of them could use the result. Two key off the identifier's text: a recorded
  // symbol's span covers the declared name, so a definition that lands on one necessarily has
  // that name, and a binding is matched by name outright. In a program of one file, an
  // identifier this document declares nothing of that name for (`max`, `vec3`) therefore cannot
  // change either answer, and pays TypeScript for no resolution.
  //
  // The location line of a field is the third answer, and it is asked for every property: the
  // front end records a field of this document only when the document uses its struct, and a
  // field that an imported document declares never, so no name of this document's stands for
  // either (`entryLocationLines`). Such a property still takes no recorded symbol of another
  // name as its declaration.
  const named =
    ts.isIdentifier(node) &&
    (analysis.symbols.some((s) => s.name === node.text) ||
      analysis.bindings.some((b) => b.name === node.text));
  const property =
    ts.isIdentifier(node) && quickInfo.kind === ts.ScriptElementKind.memberVariableElement;
  // The fourth answer is a symbol that another file of the program declares (Rule 3.9): no
  // name of this document's table stands for it, so a program that links another file asks
  // for the definition of every identifier.
  const linkedCompile = linkedCompileOf(analysis);
  const linked = ts.isIdentifier(node) && linkedCompile !== undefined;
  // The fifth is a constant of no fixed type (`abstractConstLine`): a member of a namespace or a
  // static field is recorded under a longer name, so a file that declares or reads one asks for
  // the definition of every identifier.
  const abstract =
    ts.isIdentifier(node) &&
    ((abstractConstTableOf(analysis.sourceFile)?.decls.length ?? 0) > 0 ||
      hasResultCopies(analysis.sourceFile));
  const defs = implementationsOf(
    named || property || linked || abstract
      ? (languageService.getDefinitionAtPosition(uri, offset) ?? [])
      : [],
    (fileName) => languageService.getProgram()?.getSourceFile(fileName),
  );
  const self: HoverProgram = { uri, analysis };
  const checker = (): ts.TypeChecker | undefined => languageService.getProgram()?.getTypeChecker();
  const own = named ? declaredSymbolAt(analysis, uri, defs, property) : undefined;
  const typescript = languageService.getProgram();
  // A name this document does not declare is read, in this order:
  // - in this document's program, where another file of it declares the name;
  // - for a field this document declares and its own program gives no symbol (the front end
  //   records a field only where its file uses the struct), in the programs of the open
  //   documents that link this file, as its location line is, where they give it one type;
  // - for a name this document imports and its program does not keep (no code uses it yet), in
  //   the declaring document's own program, when that document is open.
  const elsewhere = (): ImportedSymbol | undefined => {
    const inProgram = importedSymbolAt(self, defs, (fileName) => fileName !== uri, property);
    if (inProgram !== undefined) return inProgram;
    if (property && defs.some((d) => d.fileName === uri)) {
      const found = programs
        .linking(uri)
        .map((p) => importedSymbolAt(p, defs, (fileName) => fileName === uri, property))
        .filter((f) => f !== undefined);
      const first = found[0];
      if (first === undefined) return undefined;
      // The type decides. The owner is one only where every program gives the field one
      // struct, and the same one: each program's name for it is read as this document names
      // the struct, since two modules can emit one struct under two names.
      if (!found.every((f) => typesOf(f.symbol) === typesOf(first.symbol))) return undefined;
      const ownerIn = (f: ImportedSymbol): string =>
        structNamesOf(f.program, sourceFile, checker)(f.symbol.struct ?? '');
      return {
        ...first,
        oneOwner: found.every((f) => f.oneOwner && ownerIn(f) === ownerIn(first)),
      };
    }
    // The declaring document's own program answers only for a declaration the hovered program
    // dropped. Where the hovered program holds symbols there and refused them (instances of
    // different types, a member, a struct's name), the hover keeps TypeScript's quick info:
    // another program's instance is not this program's type.
    // Only a definition in a file of this program can be a declaration it holds, so a name of the
    // ambient library (`max`) builds no index.
    const files = new Set(linkedCompile?.linked.files.map((f) => f.name));
    const local = defs.filter((d) => d.fileName !== uri && files.has(d.fileName));
    if (local.length > 0) {
      const { declared } = programIndexOf(self);
      if (local.some((d) => declared.has(placeKey(d.fileName, d.textSpan.start)))) return undefined;
    }
    return unlinkedSymbolAt(
      defs,
      uri,
      programs,
      (fileName) => typescript?.getSourceFile(fileName),
      property,
    );
  };
  const imported = own !== undefined || !ts.isIdentifier(node) ? undefined : elsewhere();
  // `declared` is this document's own symbol: the answers below that read this document's
  // source at the symbol's offset take it alone.
  const declared = own?.symbol;
  const read = own ?? imported;
  // A symbol another file declares shows the name this document writes for it: the hovered
  // name, `bp` of `import { bump as bp }`, as signature help shows it (the owner's decision of
  // 2026-11-10). A field's name is the same in every file.
  const shown =
    declared ??
    (imported === undefined
      ? undefined
      : { ...imported.symbol, name: (node as ts.Identifier).text });
  // A module variable is recorded as a binding, and the module's variables tell the two apart,
  // by the name the module emits.
  const moduleVar =
    declared !== undefined
      ? analysis.vars.some((v) => v.name === declared.name)
      : imported?.moduleVar === true;
  // An `@inout` or `@out` parameter is a `param` to the symbol table, and its declaration
  // carries the qualifier (Rule 8.25).
  const qualifier = declared?.kind === 'param' ? qualifierOfParam(sourceFile, declared) : undefined;
  // The names of the program the symbol was read in, as this document writes them. Nothing
  // here runs for a hover that keeps TypeScript's quick info.
  const program = imported?.program ?? self;
  const struct = structNamesOf(program, sourceFile, checker);
  const line = (): string | undefined => {
    if (shown === undefined || read === undefined) return undefined;
    if (qualifier !== undefined)
      return `(parameter) @${qualifier} ${shown.name}: ${spellShaderType(shown.type, struct)}`;
    // A field that more than one struct holds has no one owner in the table. TypeScript's
    // quick info names the owner of the hovered use, part by part, up to the field's name.
    const owner = read.oneOwner ? undefined : ownerOf(quickInfo);
    if (!read.oneOwner && owner === undefined) return undefined;
    const params =
      shown.kind !== 'function'
        ? []
        : imported !== undefined
          ? writtenParams(imported.sourceFile, imported.start, program, shown, struct)
          : writtenParams(sourceFile, shown.start, program, shown, struct);
    return declarationLine(shown, moduleVar, struct, params, owner);
  };
  const display =
    abstractConstLine(
      node,
      defs,
      uri,
      sourceFile,
      analysis,
      checker,
      imported !== undefined && imported.program !== self ? imported.program.analysis : undefined,
    ) ??
    resultCopiesLine(node, defs, uri, sourceFile, analysis, struct) ??
    line() ??
    ts.displayPartsToString(quickInfo.displayParts);
  const documentation = ts.displayPartsToString(quickInfo.documentation);
  // A binding that another file declares has its slot in this document's program.
  const resource =
    imported?.binding !== undefined
      ? bindingLine(imported.binding)
      : resourceBindingLine(analysis, sourceFile, uri, defs, node);
  const sections = [`\`\`\`ts\n${display}\n\`\`\``];
  if (qualifier !== undefined) sections.push(referenceLine(declared!, qualifier));
  if (resource !== undefined) sections.push(resource);
  // The location line reads the definitions of a property alone, as it did before the hover
  // asked for the definition of every identifier of a linked program: another name is no field,
  // and must not start the analysis of the documents that link its declaring file. (The one
  // other document a name that is no field can read is the declaring document of an import
  // this program does not keep, `unlinkedSymbolAt`, and that is its own cache entry.)
  const fieldDefs = property || declared !== undefined ? defs : [];
  sections.push(...entryLocationLines(analysis, sourceFile, uri, fieldDefs, declared, programs));
  if (documentation) sections.push(documentation);
  return { contents: sections.join('\n\n'), range: rangeForSpan(sourceFile, quickInfo.textSpan) };
}
