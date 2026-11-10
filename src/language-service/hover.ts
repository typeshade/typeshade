// === Hover: TypeScript quick info for user symbols, TypeShade docs for the vocabulary (§5) ===

import ts from 'typescript';
import { isBuiltinTypeLiteral } from '../compiler/ts/attribute-types.js';
import { entryNode } from '../compiler/ts/entry-locations.js';
import { qualifiersOf } from '../compiler/ts/lower/references.js';
import {
  linkedCompileOf,
  type CompileTsSourceResult,
  type LinkedCompile,
} from '../compiler/ts/source-file.js';
import type { DeclaredSymbol } from '../compiler/ts/symbols.js';
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
 *   `no location in b.shade.ts (TS8010)`, with the code of that program's own diagnostic on the
 *   field (`refusalCode`). The lines stand in the order of the documents' uris, so the hover
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
 * has a location, it is a built-in value, or the program reports no error on it. The code is
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
  return analysis.diagnostics.find(
    (d) =>
      d.category === 'error' &&
      d.fileName === fileName &&
      d.start <= start &&
      start < d.start + d.length,
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
    const across = fieldLinesAcross(programs(at.fileName), at.fileName, at.start);
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
 * The programs of the other open documents that link the file `declaringUri`. The hover asks
 * for them only for a field its own document's program gives no place among its entries.
 */
export type HoverPrograms = (declaringUri: string) => readonly HoverProgram[];

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
export function spellShaderType(t: ShaderType): string {
  // An optional value is spelled as TypeScript spells it (Rule 7.10, change 0088).
  const optional = optionalInner(t);
  if (optional !== undefined)
    return `${spellShaderType(optional)}${optionalAbsence(t)! & 2 ? ' | null' : ''}${optionalAbsence(t)! & 1 ? ' | undefined' : ''}`;
  const keys = keysOf(t);
  if (keys !== undefined) return keyTypeText(keys);
  const rec = recordOf(t);
  if (rec !== undefined && t.kind === 'array')
    return `Record<${recordKeyText(rec)}, ${spellShaderType(t.elem)}>`;
  if (t.kind === 'collection') {
    const members = keysOf(collectionKeyOf(t));
    const key = members === undefined ? t.key : keyTypeText(members);
    return t.value === undefined ? `Set<${key}>` : `Map<${key}, ${spellShaderType(t.value)}>`;
  }
  switch (t.kind) {
    case 'f64':
      return 'f64';
    case 'vec64':
      return `vec${t.n}<f64>`;
    case 'mat':
      return t.elem === 'f64' ? `mat${t.cols}x${t.rows}<f64>` : wgslType(t);
    case 'array':
      return t.size !== undefined
        ? `array<${spellShaderType(t.elem)}, ${t.size}>`
        : `array<${spellShaderType(t.elem)}>`;
    default:
      return wgslType(t);
  }
}

/** What the hover shows of `symbol` but its name: its kind, its struct and each type. Two symbols
 *  at one declaration with one such text read the same in a hover. */
const shapeOf = (symbol: DeclaredSymbol): string =>
  [
    symbol.kind,
    symbol.struct ?? '',
    spellShaderType(symbol.type),
    ...(symbol.params ?? []).map((p) => spellShaderType(p.type)),
  ].join('|');

/**
 * The one symbol among `at`, the symbols the front end recorded at one declaration, or
 * `undefined` when they differ. The front end lowers a generic function and a generic class
 * once for each instance (`twice_f32`, `twice_vec3`; `Box_f32`, `Box_vec3`), and records each
 * instance at the one declaration. No one of them is the type of every call, and a hover must
 * not show a call the type of another instance (Rule 12.7), so such a declaration keeps
 * TypeScript's quick info, which names the instance of the call.
 */
function oneOf(at: readonly DeclaredSymbol[]): DeclaredSymbol | undefined {
  const first = at[0];
  return first !== undefined && at.every((s) => shapeOf(s) === shapeOf(first)) ? first : undefined;
}

/**
 * The symbol the front end declared at the position `defs` resolves to, or `undefined` when
 * TypeScript resolves the identifier to another file (an imported document, the ambient lib), to
 * something the front end never lowered, or to a declaration it lowered as more than one
 * instance (`oneOf`).
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
): DeclaredSymbol | undefined {
  for (const def of defs) {
    if (def.fileName !== uri) continue;
    const at = analysis.symbols.filter((s) => s.start === def.textSpan.start);
    if (at.length > 0) return oneOf(at);
  }
  return undefined;
}

/** A symbol that another file declares, as the hover shows it. */
interface ImportedSymbol {
  /** The symbol as the program that declares it has it, under the names its module emits. */
  readonly symbol: DeclaredSymbol;
  /** The declaring file, and the offset of the declared name in it. */
  readonly sourceFile: ts.SourceFile;
  readonly start: number;
  /** Whether the symbol is a module variable, which the table records as a binding. */
  readonly moduleVar: boolean;
  /** The linked program the symbol was read in, whose generated names its types may carry.
   *  `undefined` for a program of one file, which generates none. */
  readonly linked: LinkedCompile | undefined;
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
 * - a `field` is a property of an interface, a type literal or a class;
 * - every other kind is a function or a variable declared at the top of its file.
 */
function readsFromCompiler(kind: DeclaredSymbol['kind'], name: ts.Node): boolean {
  const decl = name.parent;
  // A static field is no `field` to the table: the front end records it as a constant under a
  // longer name (`Ray_UP`), so it never reaches this arm.
  if (kind === 'field') return ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl);
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
 * The symbol that the program of `analysis` declares where `defs` resolves the hovered name to,
 * in a file `declaredIn` takes that the program links (Rule 3.9): an imported field, function,
 * module constant, module variable, override or binding. `undefined` for a single-file program,
 * for a declaration the program did not keep, for one it lowered as more than one instance
 * (`oneOf`), and for a member, which keeps TypeScript's quick info as it does in one file
 * (`readsFromCompiler`).
 *
 * The join is the declaration, by its file and its position, as `linkedFieldAt` joins a field:
 * the linker kept, for every span of the linked source, the file and the offsets the author
 * wrote (`LinkedProgram.map`). So the type is the one the front end gave the declaration in THIS
 * program, the program `compile()` of the hovered document compiles (Rule 12.7), and the hover
 * computes none.
 */
function importedSymbolAt(
  analysis: CompileTsSourceResult,
  defs: readonly ts.DefinitionInfo[],
  declaredIn: (fileName: string) => boolean,
): ImportedSymbol | undefined {
  const linked = linkedCompileOf(analysis);
  if (linked === undefined) return undefined;
  for (const def of defs) {
    if (!declaredIn(def.fileName)) continue;
    const at: DeclaredSymbol[] = [];
    let sourceFile: ts.SourceFile | undefined;
    for (const symbol of linked.symbols) {
      const written = linked.linked.map(symbol.start, symbol.start + symbol.length);
      if (written?.file.name !== def.fileName || written.start !== def.textSpan.start) continue;
      at.push(symbol);
      sourceFile = written.file.sourceFile;
    }
    if (sourceFile === undefined) continue;
    const symbol = oneOf(at);
    const name = nodeAt(sourceFile, def.textSpan.start);
    if (symbol === undefined || name === undefined || !ts.isIdentifier(name)) return undefined;
    if (!readsFromCompiler(symbol.kind, name)) return undefined;
    return {
      symbol,
      sourceFile,
      start: def.textSpan.start,
      moduleVar: analysis.vars.some((v) => v.name === symbol.name),
      linked,
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
 * open: `programs` gives it among the programs that link the declaring file. The type is the one
 * the declaring file's hover shows. The hovered document's program has no such binding, so a
 * binding has no resource line here. `sourceFileOf` gives the declaring file as TypeScript holds
 * it, the text the declaring document's analysis read.
 */
function unlinkedSymbolAt(
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  programs: HoverPrograms,
  sourceFileOf: (fileName: string) => ts.SourceFile | undefined,
): ImportedSymbol | undefined {
  for (const def of defs) {
    if (def.fileName === uri) continue;
    const declaring = programs(def.fileName).find((p) => p.uri === def.fileName);
    const sourceFile = sourceFileOf(def.fileName);
    if (declaring === undefined || sourceFile === undefined) continue;
    const symbol = declaredSymbolAt(declaring.analysis, def.fileName, [def]);
    const name = nodeAt(sourceFile, def.textSpan.start);
    if (symbol === undefined || name === undefined || !ts.isIdentifier(name)) continue;
    // The declaring file's hover reads a symbol under the hovered name alone.
    if (symbol.name !== name.text || !readsFromCompiler(symbol.kind, name)) continue;
    return {
      symbol,
      sourceFile,
      start: def.textSpan.start,
      moduleVar: declaring.analysis.vars.some((v) => v.name === symbol.name),
      linked: linkedCompileOf(declaring.analysis),
      binding: undefined,
    };
  }
  return undefined;
}

/** `text` with each name of `names` that stands in it as an identifier, or as the head of one
 *  the front end built from it (`lib_Box` in `lib_Box_f32`), replaced by what the map gives. */
function renamed(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [from, to] of names) {
    if (!out.includes(from)) continue;
    const word = from.replace(/[$]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![A-Za-z0-9$])${word}(?![A-Za-z0-9$])`, 'g'), to);
  }
  return out;
}

/**
 * The names the linker generated for the program of `linked`, each with the name the author
 * wrote. Where two files declare one name, the module emits one of them under a name of its own
 * (`lib_Light`, `lib_K`, Rule 3.2), and the front end spells a type and a parameter by that
 * name. No author wrote it, and no file of the program may write it (`fresh`,
 * `src/compiler/ts/link.ts`), so a hover replaces it wherever it stands: in a struct's name, in
 * the type of a value and in a parameter's name. The pair is read, not guessed: the name in the
 * linked source at a symbol's span, and the text the author wrote at the span the linker maps it
 * to (`LinkedProgram.map`).
 */
function generatedNames(linked: LinkedCompile): ReadonlyMap<string, string> {
  const known = generated.get(linked);
  if (known !== undefined) return known;
  const out = new Map<string, string>();
  for (const symbol of linked.symbols) {
    const end = symbol.start + symbol.length;
    const emitted = linked.sourceFile.text.slice(symbol.start, end);
    const at = linked.linked.map(symbol.start, end);
    if (at === undefined) continue;
    const written = at.file.sourceFile.text.slice(at.start, at.end);
    if (written !== emitted && written !== '') out.set(emitted, written);
  }
  generated.set(linked, out);
  return out;
}
const generated = new WeakMap<LinkedCompile, ReadonlyMap<string, string>>();

/**
 * The structs that `sourceFile` imports under a name of its own (`import { Light as L }`), each
 * by the name the module of `linked` emits it under, with that name of its own. A hover in a
 * file shows a name as that file writes it (the owner's decision of 2026-11-10), so the type of
 * a value and the struct of a field read `L` there. A struct the file reaches another way (a
 * namespace import, the type of an imported function's parameter) keeps its declared name.
 */
function importedStructNames(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker | undefined,
  linked: LinkedCompile,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (checker === undefined) return out;
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      if (spec.propertyName === undefined) continue;
      const alias = checker.getSymbolAtLocation(spec.name);
      const target =
        alias !== undefined && alias.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(alias)
          : undefined;
      const decl = target?.declarations?.[0];
      const name = decl === undefined ? undefined : ts.getNameOfDeclaration(decl);
      if (decl === undefined || name === undefined) continue;
      const fileName = decl.getSourceFile().fileName;
      const start = name.getStart();
      for (const symbol of linked.symbols) {
        if (symbol.kind !== 'struct') continue;
        const end = symbol.start + symbol.length;
        const at = linked.linked.map(symbol.start, end);
        if (at?.file.name !== fileName || at.start !== start) continue;
        out.set(linked.sourceFile.text.slice(symbol.start, end), spec.name.text);
      }
    }
  }
  return out;
}

/** The qualifier written on the parameter the front end recorded as `param`, `@inout` or `@out`
 *  (Rule 8.25), read off the declaration in the source. */
function qualifierOfParam(sourceFile: ts.SourceFile, param: DeclaredSymbol): string | undefined {
  let node: ts.Node | undefined = nodeAt(sourceFile, param.start);
  while (node !== undefined && !ts.isParameter(node)) node = node.parent;
  return node === undefined ? undefined : qualifiersOf(node)[0]?.name;
}

/** The qualifier of each parameter of the function whose name is declared at offset `start` of
 *  `sourceFile`, in the order of the parameters. The order is the join: the module may emit a
 *  parameter under a name of its own. */
function qualifiersOfFunction(
  sourceFile: ts.SourceFile,
  start: number,
): readonly (string | undefined)[] {
  let node: ts.Node | undefined = nodeAt(sourceFile, start);
  while (node !== undefined && !ts.isFunctionDeclaration(node)) node = node.parent;
  return (node?.parameters ?? []).map((p) => qualifiersOf(p)[0]?.name);
}

/** The innermost node of `sourceFile` that starts at or covers `pos`. */
function nodeAt(sourceFile: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (pos < n.getStart(sourceFile) || pos >= n.getEnd()) return;
    found = n;
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
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
 * The first line of the hover for a declaration the front end lowered, in TypeScript's own quick
 * info shapes so an editor renders it the way it renders everything else. `undefined` means keep
 * what TypeScript said: a data class is one, since `class Vertex` already names it and the
 * compiler's `struct:Vertex` would only be noise.
 */
function declarationLine(
  symbol: DeclaredSymbol,
  moduleVar: boolean,
  qualifiers: readonly (string | undefined)[] = [],
): string | undefined {
  const type = spellShaderType(symbol.type);
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
    case 'function': {
      const params = (symbol.params ?? [])
        .map((p, i) => {
          const q = qualifiers[i];
          // The qualifier as an author writes it, before the parameter: `@inout v: f32`
          // (Rule 8.25, change 0137).
          return `${q !== undefined ? `@${q} ` : ''}${p.name}: ${spellShaderType(p.type)}`;
        })
        .join(', ');
      return `function ${symbol.name}(${params}): ${type}`;
    }
    case 'field':
      return `(property) ${symbol.struct}.${symbol.name}: ${type}`;
    case 'struct':
      return undefined;
  }
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
 * program: `programs` gives the analyses of the other open documents that link a file, for a
 * field this document's program gives no place among its entries (`entryLocationLines`). Where
 * those programs give the field different numbers, each has a line of its own, with its file.
 */
export function getHover(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  analysis: CompileTsSourceResult,
  programs: HoverPrograms = () => [],
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
  const defs =
    named || property || linked ? (languageService.getDefinitionAtPosition(uri, offset) ?? []) : [];
  const own = named ? declaredSymbolAt(analysis, uri, defs) : undefined;
  const typescript = languageService.getProgram();
  // A name this document does not declare is read, in this order:
  // - in this document's program, where another file of it declares the name;
  // - for a field this document declares and its own program gives no symbol (the front end
  //   records a field only where its file uses the struct), in the programs of the open
  //   documents that link this file, as its location line is, where they agree (`oneOf`);
  // - for a name this document imports and its program does not keep (no code uses it yet), in
  //   the declaring document's own program, when that document is open.
  const elsewhere = (): ImportedSymbol | undefined => {
    const inProgram = importedSymbolAt(analysis, defs, (fileName) => fileName !== uri);
    if (inProgram !== undefined) return inProgram;
    if (property && defs.some((d) => d.fileName === uri)) {
      const found = programs(uri)
        .map((p) => importedSymbolAt(p.analysis, defs, (fileName) => fileName === uri))
        .filter((f) => f !== undefined);
      // The struct's name is each program's own, so only the type decides here.
      const first = found[0];
      const agree = found.every(
        (f) => spellShaderType(f.symbol.type) === spellShaderType(first!.symbol.type),
      );
      return agree ? first : undefined;
    }
    return unlinkedSymbolAt(defs, uri, programs, (fileName) => typescript?.getSourceFile(fileName));
  };
  const imported = own !== undefined || !ts.isIdentifier(node) ? undefined : elsewhere();
  // `declared` is this document's own symbol: the answers below that read this document's
  // source at the symbol's offset take it alone.
  const declared = own;
  // A symbol another file declares shows the name this document writes for it: the hovered
  // name, `bp` of `import { bump as bp }`, as signature help shows it (the owner's decision of
  // 2026-11-10). A field's name is the same in every file.
  const shown =
    own ??
    (imported === undefined
      ? undefined
      : { ...imported.symbol, name: (node as ts.Identifier).text });
  // A module variable is recorded as a binding, and the module's variables tell the two apart,
  // by the name the module emits.
  const moduleVar =
    own !== undefined
      ? analysis.vars.some((v) => v.name === own.name)
      : imported?.moduleVar === true;
  // An `@inout` or `@out` parameter is a `param` to the symbol table, and its declaration
  // carries the qualifier (Rule 8.25).
  const qualifier = declared?.kind === 'param' ? qualifierOfParam(sourceFile, declared) : undefined;
  const compilers =
    (qualifier !== undefined
      ? `(parameter) @${qualifier} ${declared!.name}: ${spellShaderType(declared!.type)}`
      : undefined) ??
    (shown !== undefined
      ? declarationLine(
          shown,
          moduleVar,
          shown.kind !== 'function'
            ? undefined
            : own !== undefined
              ? qualifiersOfFunction(sourceFile, own.start)
              : qualifiersOfFunction(imported!.sourceFile, imported!.start),
        )
      : undefined);
  // The compiler's line spells a struct and a parameter by the name the module emits. Each
  // name the linker generated reads as the author wrote it, and a struct this document imports
  // under a name of its own reads by that name. The names are those of the program the symbol
  // was read in, which is this document's unless another program answered.
  const readIn = imported !== undefined ? imported.linked : linkedCompile;
  const aliases =
    readIn !== undefined && readIn === linkedCompile
      ? importedStructNames(sourceFile, typescript?.getTypeChecker(), readIn)
      : undefined;
  const display =
    compilers === undefined
      ? ts.displayPartsToString(quickInfo.displayParts)
      : readIn === undefined
        ? compilers
        : renamed(
            aliases === undefined ? compilers : renamed(compilers, aliases),
            generatedNames(readIn),
          );
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
  // and must not start the analysis of another document.
  const fieldDefs = property || declared !== undefined ? defs : [];
  sections.push(...entryLocationLines(analysis, sourceFile, uri, fieldDefs, declared, programs));
  if (documentation) sections.push(documentation);
  return { contents: sections.join('\n\n'), range: rangeForSpan(sourceFile, quickInfo.textSpan) };
}
