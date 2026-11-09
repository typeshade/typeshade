// === Stage 2 navigation: definitions, references, symbols, rename (design doc §4, §5) ===
//
// Every method here delegates to the underlying `ts.LanguageService` and re-labels or filters
// its answer with TypeShade's own vocabulary: a location inside the ambient lib is never
// surfaced (a user asking for the definition of `vec4` gets nothing, not the bundled `.d.ts`),
// a document symbol's kind comes from the front end's own collected structs/bindings/consts
// rather than TypeScript's generic `class`/`variable`, and a rename refuses to touch the
// ambient vocabulary, a `@builtin(...)` string or the `"use typeshade"` directive — none is a
// renamable program symbol, and `prepareRename` and `rename` share one predicate for that.

import ts from 'typescript';
import { declaresEntry, stageCallOf } from '../compiler/ts/stage-call.js';
import type { CompileTsSourceResult } from '../compiler/ts/source-file.js';
import { isUseTypeshadeDirective } from '../compiler/ts/directive.js';
import { AMBIENT_LIB_URI } from './host.js';
import { nodeAtPosition, rangeForSpan } from './positions.js';
import { WGSL_BUILTIN_NAMES } from './ambient.js';
import type {
  TypeshadeDocumentSymbol,
  TypeshadeLocation,
  TypeshadeRange,
  TypeshadeSymbolKind,
  TypeshadeTextEdit,
} from './types.js';

function spanOfNode(node: ts.Node): { start: number; length: number } {
  return { start: node.getStart(), length: node.getEnd() - node.getStart() };
}

/**
 * Whether `offset` in `sourceFile` lands on a decorator that is no call, `@vertex`, `@fragment`
 * or a bare `@compute`, on a `ts.FunctionDeclaration` (a stage attribute, Rule 8.1, change 0130).
 * `ts.getDefinitionAtPosition` resolves such a decorator through its call-signature machinery,
 * which switches on the decorated node's kind and `Debug.fail()`s on a function declaration
 * (measured on TypeScript 5.6.3 and 6.0.2), so definition, and the rename guard that asks for a
 * definition, must refuse the position before calling into `ts`. A decorator that is a call,
 * `@compute([WG])` or `@workgroup_size([n])`, resolves: definition, references, rename and quick
 * info at its name and inside its argument are TypeScript's (change 0130, The editor, item 4).
 * A decorator on a parameter of a function that is no class member, a qualifier `@inout` or
 * `@out` (Rule 8.25, change 0137), throws in definition and in rename alike
 * (`getEffectiveDecoratorArguments`), so it is refused too.
 */
function isDecoratorOnFunctionDeclarationAt(sourceFile: ts.SourceFile, offset: number): boolean {
  const onDecorator = (pos: number): boolean => {
    let node: ts.Node | undefined = nodeAtPosition(sourceFile, pos);
    while (node !== undefined) {
      if (ts.isDecorator(node)) {
        const decorated = node.parent;
        if (ts.isFunctionDeclaration(decorated)) return !ts.isCallExpression(node.expression);
        // A parameter qualifier, `@inout a: f32`, on a parameter of a function that is no class
        // member (Rule 8.25, change 0137): TypeScript throws on it as on a decorator of the
        // function itself, where a method's or a constructor's parameter decorator resolves.
        return (
          ts.isParameter(decorated) &&
          (ts.isFunctionDeclaration(decorated.parent) ||
            ts.isFunctionExpression(decorated.parent) ||
            ts.isArrowFunction(decorated.parent))
        );
      }
      node = node.parent;
    }
    return false;
  };
  // `nodeAtPosition`'s span test is `start <= pos < end`, so the position immediately after the
  // decorator's last character (e.g. right after `@vertex`, before the newline) is already
  // outside it by that test — yet `ts`'s own position-based APIs still resolve a cursor there as
  // touching the preceding token (the same "adjacent token" convention every LSP cursor position
  // follows), and still throw. Checking `offset - 1` as well as `offset` matches that.
  return onDecorator(offset) || (offset > 0 && onDecorator(offset - 1));
}

/** `ts.canHaveDecorators` says a function declaration cannot syntactically carry a decorator,
 * but the parser attaches `@vertex` etc. to it anyway (that mismatch is exactly why TS1206
 * fires; see `diagnostics.ts`), so a decorator must be read off `modifiers` directly rather
 * than through the `canHaveDecorators`-gated helper. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? [];
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? [];
  return modifiers.filter(ts.isDecorator);
}

function decoratorTextsOf(node: ts.Node, sourceFile: ts.SourceFile): readonly string[] {
  return decoratorsOf(node).map((d) => d.getText(sourceFile));
}

/** The pipeline stage a function declaration is an entry point for, or `undefined` when it is
 * a plain function — shared with `semantic-tokens.ts` so both agree on what counts as an
 * entry point. */
export function stageOf(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
): string | undefined {
  for (const text of decoratorTextsOf(node, sourceFile)) {
    if (/^@vertex\b/.test(text)) return 'vertex';
    if (/^@fragment\b/.test(text)) return 'fragment';
    if (/^@compute\b/.test(text)) return 'compute';
  }
  return undefined;
}

/** Drops any entry whose `fileName` is the ambient lib's virtual uri — it is never a real
 * document (§4's own note on `AMBIENT_LIB_URI`), so a definition, reference or rename result
 * that lands there is simply not shown, rather than pointing an adapter at a uri it never
 * opened. */
function locationsFrom(
  program: ts.Program,
  entries: readonly { fileName: string; textSpan: ts.TextSpan }[],
): TypeshadeLocation[] {
  const out: TypeshadeLocation[] = [];
  for (const entry of entries) {
    if (entry.fileName === AMBIENT_LIB_URI) continue;
    const sf = program.getSourceFile(entry.fileName);
    if (!sf) continue;
    out.push({ uri: entry.fileName, range: rangeForSpan(sf, entry.textSpan) });
  }
  return out;
}

/** Every location `offset` in `uri` is defined at, with any ambient-lib result dropped. Returns
 * `[]` without calling into `ts` when `offset` is on a stage attribute that is no call,
 * `@vertex`, `@fragment` or a bare `@compute` — TypeScript's own decorator-resolution code cannot
 * handle that target and throws (`Error: Debug Failure.`) rather than returning `undefined`. */
export function getDefinition(
  languageService: ts.LanguageService,
  program: ts.Program,
  uri: string,
  offset: number,
): TypeshadeLocation[] {
  const sourceFile = program.getSourceFile(uri);
  if (sourceFile && isDecoratorOnFunctionDeclarationAt(sourceFile, offset)) return [];
  const defs = languageService.getDefinitionAtPosition(uri, offset);
  if (!defs) return [];
  return locationsFrom(program, defs);
}

/** Every reference to the symbol at `offset` in `uri`, with any ambient-lib result dropped. */
export function getReferences(
  languageService: ts.LanguageService,
  program: ts.Program,
  uri: string,
  offset: number,
  options?: { includeDeclaration?: boolean },
): TypeshadeLocation[] {
  const symbols = languageService.findReferences(uri, offset);
  if (!symbols) return [];
  const includeDeclaration = options?.includeDeclaration ?? true;
  const entries = symbols.flatMap((s) =>
    s.references.filter((r) => includeDeclaration || !r.isDefinition),
  );
  return locationsFrom(program, entries);
}

/** The name and members of an `interface X { … }` or a `type X = { … }`, or undefined for any
 *  other statement — the two struct spellings that are not a class. */
function interfaceOrAliasMembers(
  stmt: ts.Statement,
): { nameNode: ts.Identifier; members: readonly ts.TypeElement[] } | undefined {
  if (ts.isInterfaceDeclaration(stmt)) return { nameNode: stmt.name, members: stmt.members };
  if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
    return { nameNode: stmt.name, members: stmt.type.members };
  }
  return undefined;
}

/** The outline of `sourceFile`: its structs, entries, functions, resources and constants,
 * re-labelled from the front end's own collected declarations (`analysis`, the service's one
 * cached `compileTsSource` run for this document version, §8) rather than TypeScript's generic
 * `class`/`variable` kinds (design doc §5). */
export function getDocumentSymbols(
  sourceFile: ts.SourceFile,
  analysis: CompileTsSourceResult,
): TypeshadeDocumentSymbol[] {
  const structNames = new Set(analysis.structs.map((s) => s.decl.name));
  const bindingNames = new Set(analysis.bindings.map((b) => b.name));
  const constNames = new Set(analysis.consts.map((c) => c.name));

  const symbols: TypeshadeDocumentSymbol[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const kind: TypeshadeSymbolKind = structNames.has(stmt.name.text) ? 'struct' : 'variable';
      const children: TypeshadeDocumentSymbol[] = [];
      for (const member of stmt.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
          children.push({
            name: member.name.text,
            kind: 'field',
            range: rangeForSpan(sourceFile, spanOfNode(member)),
            selectionRange: rangeForSpan(sourceFile, spanOfNode(member.name)),
          });
        }
      }
      symbols.push({
        name: stmt.name.text,
        kind,
        range: rangeForSpan(sourceFile, spanOfNode(stmt)),
        selectionRange: rangeForSpan(sourceFile, spanOfNode(stmt.name)),
        ...(children.length ? { children } : {}),
      });
    } else if (interfaceOrAliasMembers(stmt)) {
      // A struct written as `interface X { … }` or `type X = { … }` (#8 A4). Only the names
      // the analysis actually collected are structs: an object type nothing refers to is a
      // host-shaped declaration, not a shader type, and is left out of the outline as it is
      // left out of the emit.
      const { nameNode, members } = interfaceOrAliasMembers(stmt)!;
      if (structNames.has(nameNode.text)) {
        const children: TypeshadeDocumentSymbol[] = [];
        for (const member of members) {
          if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
            children.push({
              name: member.name.text,
              kind: 'field',
              range: rangeForSpan(sourceFile, spanOfNode(member)),
              selectionRange: rangeForSpan(sourceFile, spanOfNode(member.name)),
            });
          }
        }
        symbols.push({
          name: nameNode.text,
          kind: 'struct',
          range: rangeForSpan(sourceFile, spanOfNode(stmt)),
          selectionRange: rangeForSpan(sourceFile, spanOfNode(nameNode)),
          ...(children.length ? { children } : {}),
        });
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const stage = stageOf(stmt, sourceFile);
      const children: TypeshadeDocumentSymbol[] = [];
      for (const param of stmt.parameters) {
        if (ts.isIdentifier(param.name)) {
          children.push({
            name: param.name.text,
            kind: 'parameter',
            range: rangeForSpan(sourceFile, spanOfNode(param)),
            selectionRange: rangeForSpan(sourceFile, spanOfNode(param.name)),
          });
        }
      }
      symbols.push({
        name: stmt.name.text,
        kind: stage ? 'entry' : 'function',
        ...(stage ? { detail: stage } : {}),
        range: rangeForSpan(sourceFile, spanOfNode(stmt)),
        selectionRange: rangeForSpan(sourceFile, spanOfNode(stmt.name)),
        ...(children.length ? { children } : {}),
      });
    } else if (ts.isVariableStatement(stmt) && stageCallOf(stmt) !== undefined) {
      // `const vs = vertex(function vs(…) { … })`, the stage call of change 0111: an entry, as
      // a decorated function is, or a kernel function under `workgroup_size([…], f)`.
      const sc = stageCallOf(stmt)!;
      const stage = declaresEntry(sc.callee) ? sc.callee : undefined;
      const children: TypeshadeDocumentSymbol[] = [];
      for (const param of sc.fn.parameters) {
        if (ts.isIdentifier(param.name)) {
          children.push({
            name: param.name.text,
            kind: 'parameter',
            range: rangeForSpan(sourceFile, spanOfNode(param)),
            selectionRange: rangeForSpan(sourceFile, spanOfNode(param.name)),
          });
        }
      }
      symbols.push({
        name: sc.declaration.name.text,
        kind: stage ? 'entry' : 'function',
        ...(stage ? { detail: stage } : {}),
        range: rangeForSpan(sourceFile, spanOfNode(stmt)),
        selectionRange: rangeForSpan(sourceFile, spanOfNode(sc.declaration.name)),
        ...(children.length ? { children } : {}),
      });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const kind: TypeshadeSymbolKind = bindingNames.has(name)
          ? 'resource'
          : constNames.has(name)
            ? 'constant'
            : 'variable';
        symbols.push({
          name,
          kind,
          range: rangeForSpan(sourceFile, spanOfNode(decl)),
          selectionRange: rangeForSpan(sourceFile, spanOfNode(decl.name)),
        });
      }
    }
  }
  return symbols;
}

/** Whether the string literal at `offset` is a `@builtin("...")` id, not a renamable program
 * symbol. */
function isBuiltinStringLiteralAt(sourceFile: ts.SourceFile, offset: number): boolean {
  const node = nodeAtPosition(sourceFile, offset);
  if (!ts.isStringLiteralLike(node)) return false;
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === node &&
    WGSL_BUILTIN_NAMES.includes(node.text)
  );
}

/** Whether `offset` is on the `"use typeshade"` directive string itself. `ts.getRenameInfo`
 * already says no to it (a plain string literal has no symbol), but `ts.findRenameLocations`
 * treats a string literal as renamable and rewrites every identical literal in the program,
 * which is how `rename` used to turn the directive into `"nope"` while `prepareRename` had
 * refused the same position. */
function isUseTypeshadeDirectiveAt(sourceFile: ts.SourceFile, offset: number): boolean {
  const node = nodeAtPosition(sourceFile, offset);
  return ts.isStringLiteral(node) && isUseTypeshadeDirective(node.parent);
}

/** Whether the symbol at `offset` is (at least partly) declared in the ambient lib: a user
 * asking to rename `vec4` or `uniform` would otherwise get edits into the bundled `.d.ts`,
 * which is never a real document. */
function definesInAmbientLib(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): boolean {
  const defs = languageService.getDefinitionAtPosition(uri, offset);
  return defs !== undefined && defs.some((d) => d.fileName === AMBIENT_LIB_URI);
}

/**
 * The one predicate both `prepareRename` and `rename` consult, so the two can never disagree
 * about a position: `true` for the `"use typeshade"` directive string, a `@builtin(...)` id
 * string, a stage attribute that is no call, `@vertex`, `@fragment` or a bare `@compute` (see
 * `isDecoratorOnFunctionDeclarationAt`: the ambient-lib check below asks `ts` for its definition,
 * which throws there), and a name defined in the ambient lib, `compute` in `@compute([WG])`
 * among them. A name inside an attribute's argument, `WG`, is renamed as anywhere else. Everything else is left to
 * `ts.getRenameInfo`'s own `canRename` verdict, which `rename` also honours by going through
 * `prepareRename` first.
 */
function isRenameRefusedAt(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): boolean {
  return (
    isUseTypeshadeDirectiveAt(sourceFile, offset) ||
    isBuiltinStringLiteralAt(sourceFile, offset) ||
    isDecoratorOnFunctionDeclarationAt(sourceFile, offset) ||
    definesInAmbientLib(languageService, uri, offset)
  );
}

/** Whether the symbol at `offset` in `uri` can be renamed, and its current display range;
 * `undefined` for every position `isRenameRefusedAt` names, and for anything else
 * `ts.getRenameInfo` reports as not renamable. */
export function prepareRename(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): { range: TypeshadeRange; placeholder: string } | undefined {
  if (isRenameRefusedAt(languageService, sourceFile, uri, offset)) return undefined;
  const info = languageService.getRenameInfo(uri, offset, {});
  if (!info.canRename) return undefined;
  return { range: rangeForSpan(sourceFile, info.triggerSpan), placeholder: info.displayName };
}

/** Every edit, across every affected document, to rename the symbol at `offset` in `uri` to
 * `newName`. Empty (`{}`) exactly when `prepareRename` returns `undefined` for the same
 * position, since it runs `prepareRename` first: `ts.findRenameLocations` on its own is more
 * permissive than `ts.getRenameInfo` (it rewrites any string literal, including the
 * `"use typeshade"` directive) and the two must not disagree. Any individual edit that would
 * still land in the ambient lib is dropped defensively. */
export function rename(
  languageService: ts.LanguageService,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  newName: string,
): Readonly<Record<string, readonly TypeshadeTextEdit[]>> {
  if (prepareRename(languageService, sourceFile, uri, offset) === undefined) return {};
  const locations = languageService.findRenameLocations(uri, offset, false, false, false);
  if (!locations) return {};
  const out: Record<string, TypeshadeTextEdit[]> = {};
  for (const loc of locations) {
    if (loc.fileName === AMBIENT_LIB_URI) continue;
    const sf = program.getSourceFile(loc.fileName);
    if (!sf) continue;
    const edits = (out[loc.fileName] ??= []);
    edits.push({ range: rangeForSpan(sf, loc.textSpan), newText: newName });
  }
  return out;
}
