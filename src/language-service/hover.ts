import ts from 'typescript';
import { isBuiltinTypeLiteral } from '../compiler/ts/attribute-types.js';
import { relatedSitesOf } from '../compiler/ts/diagnostic.js';
import { entryNode } from '../compiler/ts/entry-locations.js';
import { referenceOf } from '../compiler/ts/lower/references.js';
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
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js';
import { ATTRIBUTE_DOCS, BUILTIN_DOCS, TYPE_DOCS } from './docs.js';
import { rangeForSpan, touchingNodeAtPosition, wordSpan } from './positions.js';
import type { TypeshadeHover } from './types.js';
import { nodeAt } from './hover/node-at.js';
import type { HoverProgram, HoverPrograms, StructNames } from './hover/types.js';
import { spellShaderType, typesOf } from './hover/spell-type.js';
export { spellShaderType } from './hover/spell-type.js';
export type { HoverProgram, HoverPrograms, StructNames } from './hover/types.js';

function isBuiltinStringLiteral(node: ts.Node): node is ts.StringLiteralLike {
  if (!ts.isStringLiteralLike(node)) return false;
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
  if (ts.isDecorator(parent) && parent.expression === node) return true;
  return ts.isCallExpression(parent) && parent.expression === node && ts.isDecorator(parent.parent);
}

function isTypeName(node: ts.Node): node is ts.Identifier {
  return (
    ts.isIdentifier(node) && ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node
  );
}

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

function bindingLine(binding: CompileTsSourceResult['bindings'][number]): string {
  const mode = binding.space === 'storage' ? `${binding.access ?? 'read'} ` : '';
  const slot = `@group(${binding.group}) @binding(${binding.binding})`;
  return `${mode}${binding.space} resource at ${slot}`;
}

const isRenderEntry = (f: FuncDecl): boolean => f.stage === 'vertex' || f.stage === 'fragment';

const ROLES = ['vertex attribute', 'value between stages', 'render target'] as const;

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

interface FieldFacts {
  readonly roles: readonly string[];
  readonly location: number | undefined;
  readonly builtin?: boolean;
}

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

function fieldLine(facts: FieldFacts | undefined): string | undefined {
  if (facts?.location === undefined) return undefined;
  const what = facts.roles.length > 0 ? facts.roles.join(' and ') : 'user-defined input or output';
  return `${what} at @location(${String(facts.location)})`;
}

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

function refusalCode(
  analysis: CompileTsSourceResult,
  facts: FieldFacts,
  fileName: string,
  start: number,
): string | undefined {
  if (facts.location !== undefined || facts.builtin === true) return undefined;
  const covers = (at: { fileName: string; start: number; length: number }): boolean =>
    at.fileName === fileName && at.start <= start && start < at.start + at.length;
  return analysis.diagnostics.find(
    (d) => d.category === 'error' && (covers(d) || relatedSitesOf(d).some(covers)),
  )?.code;
}

function locationLine(
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  declared: DeclaredSymbol,
): string | undefined {
  const at = (what: string, location: number | undefined): string | undefined =>
    location === undefined ? undefined : `${what} at @location(${String(location)})`;
  if (declared.kind !== 'param' && declared.kind !== 'function') return undefined;
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

interface OneSymbol {
  readonly symbol: DeclaredSymbol;
  readonly oneOwner: boolean;
}

function oneOf(at: readonly DeclaredSymbol[], field: boolean): OneSymbol | undefined {
  const ofKind = at.filter((s) => (s.kind === 'field') === field);
  const among = ofKind.length > 0 ? ofKind : at;
  const first = among[0];
  if (first === undefined) return undefined;
  if (!among.every((s) => s.kind === first.kind && typesOf(s) === typesOf(first))) return undefined;
  return { symbol: first, oneOwner: among.every((s) => s.struct === first.struct) };
}

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

interface ImportedSymbol extends OneSymbol {
  readonly sourceFile: ts.SourceFile;
  readonly start: number;
  readonly moduleVar: boolean;
  readonly program: HoverProgram;
  readonly binding: CompileTsSourceResult['bindings'][number] | undefined;
}

function readsFromCompiler(kind: DeclaredSymbol['kind'], name: ts.Node): boolean {
  const decl = name.parent;
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

const placeKey = (fileName: string, start: number): string => `${fileName}\0${String(start)}`;

function namespacesAround(node: ts.Node): string[] {
  const out: string[] = [];
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent)
    if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) out.unshift(n.name.text);
  return out;
}

interface StructDecl {
  readonly place: string;
  readonly emitted: string;
  readonly written: string;
}

interface ProgramIndex {
  readonly structs: ReadonlyMap<string, StructDecl>;
  readonly params: ReadonlySet<string>;
  readonly declared: ReadonlyMap<
    string,
    { readonly symbols: DeclaredSymbol[]; readonly sourceFile: ts.SourceFile }
  >;
}

function programIndexOf(program: HoverProgram): ProgramIndex {
  const known = programIndexes.get(program.analysis);
  if (known !== undefined) return known;
  const structs = new Map<string, StructDecl>();
  const params = new Set<string>();
  const declared = new Map<string, { symbols: DeclaredSymbol[]; sourceFile: ts.SourceFile }>();
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

function withDeclaredName(name: string, emitted: string, to: string): string {
  if (name === emitted) return to;
  return name.startsWith(`${emitted}_`) ? `${to}${name.slice(emitted.length)}` : name;
}

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
  // Why: the front end keeps no parameter that takes a function, so `fn.params` can be shorter than the declaration's list.
  if (kept.length !== types.length)
    return (fn.params ?? []).map((p, i) => `${p.name}: ${types[i]!}`);
  return kept.map((p, i) => `${(p.name as ts.Identifier).text}: ${types[i]!}`);
}

function isReferenceParam(sourceFile: ts.SourceFile, param: DeclaredSymbol): boolean {
  let node: ts.Node | undefined = nodeAt(sourceFile, param.start);
  while (node !== undefined && !ts.isParameter(node)) node = node.parent;
  return (
    node !== undefined &&
    ts.isFunctionDeclaration(node.parent) &&
    referenceOf(node, sourceFile) !== undefined
  );
}

function referenceLine(param: DeclaredSymbol): string {
  return (
    `The caller's object: this function writes it. Assigning to a field or an element of ` +
    `\`${param.name}\` changes the object the caller passed. WGSL takes it as a pointer, ` +
    `\`ptr<function, ${wgslType(param.type)}>\` for a local; GLSL ES 3.00 as an \`inout\` parameter.`
  );
}

function ownerOf(quickInfo: ts.QuickInfo): string | undefined {
  const parts = quickInfo.displayParts ?? [];
  const name = parts.map((p) => p.kind).lastIndexOf('propertyName');
  const space = parts.findIndex((p) => p.kind === 'space');
  if (name < 2 || space < 0 || space >= name || parts[name - 1]?.text !== '.') return undefined;
  return ts.displayPartsToString(parts.slice(space + 1, name - 1));
}

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
    case 'override':
      return `const ${symbol.name}: ${type}`;
    case 'binding':
      return `${moduleVar ? 'let' : 'const'} ${symbol.name}: ${type}`;
    case 'function':
      return `function ${symbol.name}(${params.join(', ')}): ${type}`;
    case 'field':
      return `(property) ${owner ?? struct(symbol.struct ?? '')}.${symbol.name}: ${type}`;
    case 'struct':
      return undefined;
  }
}

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

function importedCallLine(
  node: ts.Node,
  declared: string | undefined,
  quickInfo: string,
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  analysis: CompileTsSourceResult,
  sourceFile: ts.SourceFile,
  struct: StructNames,
): string | undefined {
  if (!ts.isIdentifier(node) || defs.length === 0 || defs.some((d) => d.fileName === uri)) {
    return undefined;
  }
  const access = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
  const call = access ? node.parent.parent : node.parent;
  if (!ts.isCallExpression(call) || call.expression !== (access ? node.parent : node)) {
    return undefined;
  }
  const at = [node.getStart(sourceFile), call.expression.getStart(sourceFile)];
  const type = at.map((o) => copyCallAt(analysis.sourceFile, o)).find((t) => t !== undefined);
  if (type === undefined) return undefined;
  const result = spellShaderType(type, struct);
  const base = declared ?? quickInfo;
  const typeArgs =
    call.typeArguments === undefined
      ? ''
      : `<${call.typeArguments.map((a) => a.getText(sourceFile)).join(', ')}>`;
  if (/=> [^()]*$/.test(base)) return base.replace(/=> [^()]*$/, `=> ${result}`);
  if (!/\): [^()]*$/.test(base)) return undefined;
  const withArgs =
    typeArgs === '' || base.includes(`${node.text}<`)
      ? base
      : base.replace(new RegExp(`(^|[ .])${node.text}\\(`), `$1${node.text}${typeArgs}(`);
  return withArgs.replace(/\): [^()]*$/, `): ${result}`);
}

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
  const decl = declaredIn(analysis) ?? declaredIn(declaring);
  if (decl === undefined) return undefined;
  const name = node.text;
  const start = node.getStart(sourceFile);
  const access =
    ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      ? node.parent
      : undefined;
  if (decl.fileName !== uri || start !== decl.start) {
    const spans = [node, ...(access !== undefined ? [access] : [])].map((n) => {
      const at = n.getStart(sourceFile);
      return { start: at, length: n.getEnd() - at };
    });
    const read = table?.reads.find((r) =>
      spans.some((s) => s.start === r.start && s.length === r.length),
    );
    if (read?.type != null) {
      const type = spellShaderType(read.type);
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
  const parent = node.parent;
  const alias =
    (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.name === node;
  return `${alias ? '(alias) ' : ''}${decl.keyword} ${name} = ${decl.written} (${types} where it is read)`;
}

// Why: Rule 6.6 puts the location of an entry input or output in the hover, read from the IR that reflect() reads.
// Why: Rule 7.10 spells an optional value in the hover as TypeScript does.
export function getHover(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  analysis: CompileTsSourceResult,
  programs: HoverPrograms = { linking: () => [], of: () => undefined },
): TypeshadeHover | undefined {
  const node = touchingNodeAtPosition(sourceFile, offset);

  if (isBuiltinStringLiteral(node) && WGSL_BUILTIN_NAMES.includes(node.text)) {
    const doc = BUILTIN_DOCS[node.text];
    if (doc) {
      const span = { start: node.getStart() + 1, length: node.text.length };
      return { contents: `\`${node.text}\` — ${doc}`, range: rangeForSpan(sourceFile, span) };
    }
  }

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
  // Why: a definition query costs TypeScript a resolution, so a hover asks at most once and only where a recorded symbol, a binding, a property, a linked program or an abstract constant could use the answer.
  const named =
    ts.isIdentifier(node) &&
    (analysis.symbols.some((s) => s.name === node.text) ||
      analysis.bindings.some((b) => b.name === node.text));
  const property =
    ts.isIdentifier(node) && quickInfo.kind === ts.ScriptElementKind.memberVariableElement;
  const linkedCompile = linkedCompileOf(analysis);
  const linked = ts.isIdentifier(node) && linkedCompile !== undefined;
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
      if (!found.every((f) => typesOf(f.symbol) === typesOf(first.symbol))) return undefined;
      const ownerIn = (f: ImportedSymbol): string =>
        structNamesOf(f.program, sourceFile, checker)(f.symbol.struct ?? '');
      return {
        ...first,
        oneOwner: found.every((f) => f.oneOwner && ownerIn(f) === ownerIn(first)),
      };
    }
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
  const declared = own?.symbol;
  const read = own ?? imported;
  const shown =
    declared ??
    (imported === undefined
      ? undefined
      : { ...imported.symbol, name: (node as ts.Identifier).text });
  const moduleVar =
    declared !== undefined
      ? analysis.vars.some((v) => v.name === declared.name)
      : imported?.moduleVar === true;
  const isReference = declared?.kind === 'param' && isReferenceParam(sourceFile, declared);
  const program = imported?.program ?? self;
  const struct = structNamesOf(program, sourceFile, checker);
  const line = (): string | undefined => {
    if (shown === undefined || read === undefined) return undefined;
    if (isReference) return `(parameter) ${shown.name}: ${spellShaderType(shown.type, struct)}`;
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
    importedCallLine(
      node,
      imported?.symbol.kind === 'function' ? line() : undefined,
      ts.displayPartsToString(quickInfo.displayParts),
      defs,
      uri,
      analysis,
      sourceFile,
      struct,
    ) ??
    line() ??
    ts.displayPartsToString(quickInfo.displayParts);
  const documentation = ts.displayPartsToString(quickInfo.documentation);
  const resource =
    imported?.binding !== undefined
      ? bindingLine(imported.binding)
      : resourceBindingLine(analysis, sourceFile, uri, defs, node);
  const sections = [`\`\`\`ts\n${display}\n\`\`\``];
  if (isReference) sections.push(referenceLine(declared!));
  if (resource !== undefined) sections.push(resource);
  const fieldDefs = property || declared !== undefined ? defs : [];
  sections.push(...entryLocationLines(analysis, sourceFile, uri, fieldDefs, declared, programs));
  if (documentation) sections.push(documentation);
  return { contents: sections.join('\n\n'), range: rangeForSpan(sourceFile, quickInfo.textSpan) };
}
