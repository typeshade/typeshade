// === Stage 2 navigation: definitions, references, symbols, rename (design doc §4, §5) ===
//
// Every method here delegates to the underlying `ts.LanguageService` and re-labels or filters
// its answer with TypeShade's own vocabulary: a location inside the ambient lib is never
// surfaced (a user asking for the definition of `vec4` gets nothing, not the bundled `.d.ts`),
// a document symbol's kind comes from the front end's own collected structs/bindings/consts
// rather than TypeScript's generic `class`/`variable`, and a rename refuses to touch the
// ambient vocabulary or a `@builtin(...)` string — neither is a renamable program symbol.

import ts from 'typescript'
import { compileTsSource } from '../compiler/ts/source-file.js'
import { AMBIENT_LIB_URI } from './host.js'
import { rangeForSpan } from './positions.js'
import { WGSL_BUILTIN_NAMES } from './ambient.js'
import type {
  TypeshadeDocumentSymbol,
  TypeshadeLocation,
  TypeshadeRange,
  TypeshadeSymbolKind,
  TypeshadeTextEdit,
} from './types.js'

function spanOfNode(node: ts.Node): { start: number; length: number } {
  return { start: node.getStart(), length: node.getEnd() - node.getStart() }
}

function nodeAtPosition(root: ts.Node, pos: number): ts.Node {
  let found: ts.Node = root
  const visit = (node: ts.Node): void => {
    if (pos >= node.getStart() && pos < node.getEnd()) {
      found = node
      node.forEachChild(visit)
    }
  }
  visit(root)
  return found
}

/** `ts.canHaveDecorators` says a function declaration cannot syntactically carry a decorator,
 * but the parser attaches `@vertex` etc. to it anyway (that mismatch is exactly why TS1206
 * fires; see `diagnostics.ts`), so a decorator must be read off `modifiers` directly rather
 * than through the `canHaveDecorators`-gated helper. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? []
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? []
  return modifiers.filter(ts.isDecorator)
}

function decoratorTextsOf(node: ts.Node, sourceFile: ts.SourceFile): readonly string[] {
  return decoratorsOf(node).map((d) => d.getText(sourceFile))
}

/** The pipeline stage a function declaration is an entry point for, or `undefined` when it is
 * a plain function — shared with `semantic-tokens.ts` so both agree on what counts as an
 * entry point. */
export function stageOf(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
): string | undefined {
  for (const text of decoratorTextsOf(node, sourceFile)) {
    if (/^@vertex\b/.test(text)) return 'vertex'
    if (/^@fragment\b/.test(text)) return 'fragment'
    if (/^@compute\b/.test(text)) return 'compute'
  }
  return undefined
}

/** Drops any entry whose `fileName` is the ambient lib's virtual uri — it is never a real
 * document (§4's own note on `AMBIENT_LIB_URI`), so a definition, reference or rename result
 * that lands there is simply not shown, rather than pointing an adapter at a uri it never
 * opened. */
function locationsFrom(
  program: ts.Program,
  entries: readonly { fileName: string; textSpan: ts.TextSpan }[],
): TypeshadeLocation[] {
  const out: TypeshadeLocation[] = []
  for (const entry of entries) {
    if (entry.fileName === AMBIENT_LIB_URI) continue
    const sf = program.getSourceFile(entry.fileName)
    if (!sf) continue
    out.push({ uri: entry.fileName, range: rangeForSpan(sf, entry.textSpan) })
  }
  return out
}

/** Every location `offset` in `uri` is defined at, with any ambient-lib result dropped. */
export function getDefinition(
  languageService: ts.LanguageService,
  program: ts.Program,
  uri: string,
  offset: number,
): TypeshadeLocation[] {
  const defs = languageService.getDefinitionAtPosition(uri, offset)
  if (!defs) return []
  return locationsFrom(program, defs)
}

/** Every reference to the symbol at `offset` in `uri`, with any ambient-lib result dropped. */
export function getReferences(
  languageService: ts.LanguageService,
  program: ts.Program,
  uri: string,
  offset: number,
  options?: { includeDeclaration?: boolean },
): TypeshadeLocation[] {
  const symbols = languageService.findReferences(uri, offset)
  if (!symbols) return []
  const includeDeclaration = options?.includeDeclaration ?? true
  const entries = symbols.flatMap((s) =>
    s.references.filter((r) => includeDeclaration || !r.isDefinition),
  )
  return locationsFrom(program, entries)
}

/** The outline of `sourceFile`: its structs, entries, functions, resources and constants,
 * re-labelled from the front end's own collected declarations (`compileTsSource`) rather than
 * TypeScript's generic `class`/`variable` kinds (design doc §5). */
export function getDocumentSymbols(sourceFile: ts.SourceFile): TypeshadeDocumentSymbol[] {
  const analysis = compileTsSource(sourceFile.text, {
    sourceFile,
    requireDirective: false,
    emit: false,
  })
  const structNames = new Set(analysis.structs.map((s) => s.decl.name))
  const bindingNames = new Set(analysis.bindings.map((b) => b.name))
  const constNames = new Set(analysis.consts.map((c) => c.name))

  const symbols: TypeshadeDocumentSymbol[] = []
  for (const stmt of sourceFile.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const kind: TypeshadeSymbolKind = structNames.has(stmt.name.text) ? 'struct' : 'variable'
      const children: TypeshadeDocumentSymbol[] = []
      for (const member of stmt.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
          children.push({
            name: member.name.text,
            kind: 'field',
            range: rangeForSpan(sourceFile, spanOfNode(member)),
            selectionRange: rangeForSpan(sourceFile, spanOfNode(member.name)),
          })
        }
      }
      symbols.push({
        name: stmt.name.text,
        kind,
        range: rangeForSpan(sourceFile, spanOfNode(stmt)),
        selectionRange: rangeForSpan(sourceFile, spanOfNode(stmt.name)),
        ...(children.length ? { children } : {}),
      })
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const stage = stageOf(stmt, sourceFile)
      const children: TypeshadeDocumentSymbol[] = []
      for (const param of stmt.parameters) {
        if (ts.isIdentifier(param.name)) {
          children.push({
            name: param.name.text,
            kind: 'parameter',
            range: rangeForSpan(sourceFile, spanOfNode(param)),
            selectionRange: rangeForSpan(sourceFile, spanOfNode(param.name)),
          })
        }
      }
      symbols.push({
        name: stmt.name.text,
        kind: stage ? 'entry' : 'function',
        ...(stage ? { detail: stage } : {}),
        range: rangeForSpan(sourceFile, spanOfNode(stmt)),
        selectionRange: rangeForSpan(sourceFile, spanOfNode(stmt.name)),
        ...(children.length ? { children } : {}),
      })
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const name = decl.name.text
        const kind: TypeshadeSymbolKind = bindingNames.has(name)
          ? 'resource'
          : constNames.has(name)
            ? 'constant'
            : 'variable'
        symbols.push({
          name,
          kind,
          range: rangeForSpan(sourceFile, spanOfNode(decl)),
          selectionRange: rangeForSpan(sourceFile, spanOfNode(decl.name)),
        })
      }
    }
  }
  return symbols
}

/** Whether the string literal at `offset` is a `@builtin("...")` id — not a renamable program
 * symbol, so `prepareRename`/`rename` refuse it explicitly rather than relying on
 * `ts.LanguageService` to say no on its own. */
function isBuiltinStringLiteralAt(sourceFile: ts.SourceFile, offset: number): boolean {
  const node = nodeAtPosition(sourceFile, offset)
  if (!ts.isStringLiteralLike(node)) return false
  const call = node.parent
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === node &&
    WGSL_BUILTIN_NAMES.includes(node.text)
  )
}

/** Whether the symbol at `offset` is (at least partly) declared in the ambient lib — a user
 * asking to rename `vec4` or `uniform` would otherwise get edits into the bundled `.d.ts`,
 * which is never a real document. */
function definesInAmbientLib(
  languageService: ts.LanguageService,
  uri: string,
  offset: number,
): boolean {
  const defs = languageService.getDefinitionAtPosition(uri, offset)
  return defs !== undefined && defs.some((d) => d.fileName === AMBIENT_LIB_URI)
}

/** Whether the symbol at `offset` in `uri` can be renamed, and its current display range —
 * `undefined` for a `@builtin(...)` string or a name defined in the ambient lib. */
export function prepareRename(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
): { range: TypeshadeRange; placeholder: string } | undefined {
  if (isBuiltinStringLiteralAt(sourceFile, offset)) return undefined
  if (definesInAmbientLib(languageService, uri, offset)) return undefined
  const info = languageService.getRenameInfo(uri, offset, {})
  if (!info.canRename) return undefined
  return { range: rangeForSpan(sourceFile, info.triggerSpan), placeholder: info.displayName }
}

/** Every edit, across every affected document, to rename the symbol at `offset` in `uri` to
 * `newName` — empty for a `@builtin(...)` string or a name defined in the ambient lib, and any
 * individual edit that would still land in the ambient lib is dropped defensively. */
export function rename(
  languageService: ts.LanguageService,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  uri: string,
  offset: number,
  newName: string,
): Readonly<Record<string, readonly TypeshadeTextEdit[]>> {
  if (isBuiltinStringLiteralAt(sourceFile, offset)) return {}
  if (definesInAmbientLib(languageService, uri, offset)) return {}
  const locations = languageService.findRenameLocations(uri, offset, false, false, false)
  if (!locations) return {}
  const out: Record<string, TypeshadeTextEdit[]> = {}
  for (const loc of locations) {
    if (loc.fileName === AMBIENT_LIB_URI) continue
    const sf = program.getSourceFile(loc.fileName)
    if (!sf) continue
    const edits = (out[loc.fileName] ??= [])
    edits.push({ range: rangeForSpan(sf, loc.textSpan), newText: newName })
  }
  return out
}
