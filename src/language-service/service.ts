// === createTypeshadeLanguageService: the TypeshadeLanguageService of design doc §4 ===

import ts from 'typescript'
import { emitModule } from '../core/backends/wgsl.js'
import { emitGlslModule } from '../core/backends/glsl.js'
import { compileTsSource } from '../compiler/ts/source-file.js'
import { TypeshadeHost, type TypeshadeLanguageServiceHost } from './host.js'
import { getTypeScriptDiagnostics, getTypeshadeDiagnostics } from './diagnostics.js'
import { getCompletions } from './completions.js'
import { getHover } from './hover.js'
import { offsetAt, positionAt, rangeForSpan } from './positions.js'
import { TYPE_DOCS } from './docs.js'
import { WGSL_BUILTIN_NAMES } from './ambient.js'
import type {
  TypeshadeCompiledOutput,
  TypeshadeCompletionItem,
  TypeshadeDiagnostic,
  TypeshadeDocumentSymbol,
  TypeshadeHover,
  TypeshadeLocation,
  TypeshadePosition,
  TypeshadeRange,
  TypeshadeSemanticToken,
  TypeshadeSemanticTokenModifier,
  TypeshadeSemanticTokenType,
  TypeshadeSignatureHelp,
  TypeshadeSymbolKind,
  TypeshadeTextEdit,
} from './types.js'

export type { TypeshadeLanguageServiceHost } from './host.js'
export { AMBIENT_LIB_URI } from './host.js'

/**
 * The full editor-neutral, document-based Typeshade language service surface (design doc §4).
 * One instance owns one `ts.LanguageService` over its own document store; adapters (Monaco,
 * LSP) send text and positions and read back data — nothing here is asynchronous, and
 * cancellation of a stale request is the adapter's own concern (§8).
 */
export interface TypeshadeLanguageService {
  /** Opens a document, or replaces it if already open. */
  openDocument(uri: string, text: string, version?: number): void
  /** Updates an open document's text. */
  updateDocument(uri: string, text: string, version?: number): void
  /** Closes a document; it is dropped from the underlying TypeScript program. */
  closeDocument(uri: string): void

  /** TypeScript and TypeShade diagnostics for `uri`, merged (§5, §6). Empty when `uri` is not open. */
  getDiagnostics(uri: string): readonly TypeshadeDiagnostic[]
  /** Completion items at `position` in `uri` (§5). */
  getCompletions(uri: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[]
  /** Hover documentation at `position` in `uri`, or `undefined` when there is none (§5). */
  getHover(uri: string, position: TypeshadePosition): TypeshadeHover | undefined

  /** Every location `position` in `uri` is defined at. */
  getDefinition(uri: string, position: TypeshadePosition): readonly TypeshadeLocation[]
  /** Every reference to the symbol at `position` in `uri`. */
  getReferences(
    uri: string,
    position: TypeshadePosition,
    options?: { includeDeclaration?: boolean },
  ): readonly TypeshadeLocation[]
  /** The outline of `uri`: its structs, entries, functions, resources and constants. */
  getDocumentSymbols(uri: string): readonly TypeshadeDocumentSymbol[]
  /** Signature help for the call expression at `position` in `uri`. */
  getSignatureHelp(uri: string, position: TypeshadePosition): TypeshadeSignatureHelp | undefined
  /** Whether the symbol at `position` in `uri` can be renamed, and its current display range. */
  prepareRename(
    uri: string,
    position: TypeshadePosition,
  ): { range: TypeshadeRange; placeholder: string } | undefined
  /** Every edit, across every affected document, to rename the symbol at `position` to `newName`. */
  rename(
    uri: string,
    position: TypeshadePosition,
    newName: string,
  ): Readonly<Record<string, readonly TypeshadeTextEdit[]>>
  /** Semantic tokens for `uri`, optionally restricted to `range`. */
  getSemanticTokens(uri: string, range?: TypeshadeRange): readonly TypeshadeSemanticToken[]

  /** Compiles `uri` on demand for an output pane. Never called per keystroke by the service
   * itself (§7, §8). `undefined` when `uri` is not open. */
  getCompiledOutput(
    uri: string,
    target: TypeshadeCompiledOutput['target'],
  ): TypeshadeCompiledOutput | undefined

  /** Converts a UTF-16 offset into `uri`'s document into a zero-based editor position. */
  positionAt(uri: string, offset: number): TypeshadePosition
  /** Converts a zero-based editor position in `uri`'s document into a UTF-16 offset. */
  offsetAt(uri: string, position: TypeshadePosition): number
}

interface DiagnosticsCacheEntry {
  readonly version: string
  readonly diagnostics: readonly TypeshadeDiagnostic[]
}

function spanOfNode(node: ts.Node): { start: number; length: number } {
  return { start: node.getStart(), length: node.getEnd() - node.getStart() }
}

/** See the identical note in `completions.ts`: `ts.canHaveDecorators` says a function
 * declaration cannot syntactically carry a decorator, but the parser attaches `@vertex` etc.
 * to it anyway, so decorators must be read off `modifiers` directly rather than through the
 * `canHaveDecorators`-gated helper. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) return ts.getDecorators(node) ?? []
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? []
  return modifiers.filter(ts.isDecorator)
}

function decoratorTextsOf(node: ts.Node, sourceFile: ts.SourceFile): readonly string[] {
  return decoratorsOf(node).map((d) => d.getText(sourceFile))
}

function stageOf(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): string | undefined {
  for (const text of decoratorTextsOf(node, sourceFile)) {
    if (/^@vertex\b/.test(text)) return 'vertex'
    if (/^@fragment\b/.test(text)) return 'fragment'
    if (/^@compute\b/.test(text)) return 'compute'
  }
  return undefined
}

/** Maps `SyntaxKind` values that read as TypeShade "keywords" for semantic tokens — the
 * authoring surface's own control-flow and declaration vocabulary, not every JS keyword. */
const KEYWORD_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.LetKeyword,
  ts.SyntaxKind.VarKeyword,
  ts.SyntaxKind.FunctionKeyword,
  ts.SyntaxKind.ClassKeyword,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.IfKeyword,
  ts.SyntaxKind.ElseKeyword,
  ts.SyntaxKind.ForKeyword,
  ts.SyntaxKind.WhileKeyword,
  ts.SyntaxKind.SwitchKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.BreakKeyword,
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.DefaultKeyword,
])

/**
 * Creates a Typeshade language service (design doc §4). `host` configures the ambient lib and
 * multi-file import resolution (`TypeshadeLanguageServiceHost`, defined in `host.ts`); omit it
 * for the bundled ambient lib and same-directory relative-import resolution.
 */
export function createTypeshadeLanguageService(
  host: TypeshadeLanguageServiceHost = {},
): TypeshadeLanguageService {
  const tsHost = new TypeshadeHost(host)
  const languageService = ts.createLanguageService(tsHost, ts.createDocumentRegistry())
  const diagnosticsCache = new Map<string, DiagnosticsCacheEntry>()

  function program(): ts.Program {
    const p = languageService.getProgram()
    if (!p) throw new Error('TypeshadeLanguageService: no active TypeScript program')
    return p
  }

  function sourceFileOf(uri: string): ts.SourceFile | undefined {
    return program().getSourceFile(uri)
  }

  function locationsFrom(
    entries: readonly { fileName: string; textSpan: ts.TextSpan }[],
  ): TypeshadeLocation[] {
    const out: TypeshadeLocation[] = []
    for (const entry of entries) {
      const sf = program().getSourceFile(entry.fileName)
      if (!sf) continue
      out.push({ uri: entry.fileName, range: rangeForSpan(sf, entry.textSpan) })
    }
    return out
  }

  return {
    openDocument(uri, text, version) {
      tsHost.openDocument(uri, text, version)
      diagnosticsCache.delete(uri)
    },

    updateDocument(uri, text, version) {
      tsHost.updateDocument(uri, text, version)
      diagnosticsCache.delete(uri)
    },

    closeDocument(uri) {
      tsHost.closeDocument(uri)
      diagnosticsCache.delete(uri)
    },

    getDiagnostics(uri) {
      if (!tsHost.hasDocument(uri)) return []
      const version = tsHost.getScriptVersion(uri)
      const cached = diagnosticsCache.get(uri)
      if (cached && cached.version === version) return cached.diagnostics
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      const diagnostics = [
        ...getTypeScriptDiagnostics(languageService, sourceFile, uri),
        ...getTypeshadeDiagnostics(sourceFile, uri),
      ]
      diagnosticsCache.set(uri, { version, diagnostics })
      return diagnostics
    },

    getCompletions(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      const offset = offsetAt(sourceFile, position)
      return getCompletions(languageService, sourceFile, uri, offset)
    },

    getHover(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return undefined
      const offset = offsetAt(sourceFile, position)
      return getHover(languageService, sourceFile, uri, offset)
    },

    getDefinition(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      const offset = offsetAt(sourceFile, position)
      const defs = languageService.getDefinitionAtPosition(uri, offset)
      if (!defs) return []
      return locationsFrom(defs)
    },

    getReferences(uri, position, options) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      const offset = offsetAt(sourceFile, position)
      const symbols = languageService.findReferences(uri, offset)
      if (!symbols) return []
      const includeDeclaration = options?.includeDeclaration ?? true
      const entries = symbols.flatMap((s) =>
        s.references.filter((r) => includeDeclaration || !r.isDefinition),
      )
      return locationsFrom(entries)
    },

    getDocumentSymbols(uri) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      return documentSymbolsOf(sourceFile)
    },

    getSignatureHelp(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return undefined
      const offset = offsetAt(sourceFile, position)
      const items = languageService.getSignatureHelpItems(uri, offset, undefined)
      if (!items) return undefined
      return {
        signatures: items.items.map((item) => ({
          label:
            ts.displayPartsToString(item.prefixDisplayParts) +
            item.parameters
              .map((p) => ts.displayPartsToString(p.displayParts))
              .join(ts.displayPartsToString(item.separatorDisplayParts)) +
            ts.displayPartsToString(item.suffixDisplayParts),
          documentation: ts.displayPartsToString(item.documentation) || undefined,
          parameters: item.parameters.map((p) => ({
            label: ts.displayPartsToString(p.displayParts),
            documentation: ts.displayPartsToString(p.documentation) || undefined,
          })),
        })),
        activeSignature: items.selectedItemIndex,
        activeParameter: items.argumentIndex,
      }
    },

    prepareRename(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return undefined
      const offset = offsetAt(sourceFile, position)
      const info = languageService.getRenameInfo(uri, offset, {})
      if (!info.canRename) return undefined
      return { range: rangeForSpan(sourceFile, info.triggerSpan), placeholder: info.displayName }
    },

    rename(uri, position, newName) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return {}
      const offset = offsetAt(sourceFile, position)
      const locations = languageService.findRenameLocations(uri, offset, false, false, false)
      if (!locations) return {}
      const out: Record<string, TypeshadeTextEdit[]> = {}
      for (const loc of locations) {
        const sf = program().getSourceFile(loc.fileName)
        if (!sf) continue
        const edits = (out[loc.fileName] ??= [])
        edits.push({ range: rangeForSpan(sf, loc.textSpan), newText: newName })
      }
      return out
    },

    getSemanticTokens(uri, range) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      return semanticTokensOf(sourceFile, range)
    },

    getCompiledOutput(uri, target) {
      const text = tsHost.getDocumentText(uri)
      if (text === undefined) return undefined
      const sourceFile = sourceFileOf(uri)
      const analysis = compileTsSource(text, {
        fileName: uri,
        sourceFile,
        requireDirective: true,
        emit: false,
      })
      const diagnostics: TypeshadeDiagnostic[] = sourceFile
        ? [
            ...getTypeScriptDiagnostics(languageService, sourceFile, uri),
            ...getTypeshadeDiagnostics(sourceFile, uri),
          ]
        : []
      const hasError = diagnostics.some((d) => d.severity === 'error')
      let outputText = ''
      if (!hasError) {
        const moduleDecl = {
          consts: [...analysis.consts],
          structs: analysis.structs.map((s) => s.decl),
          bindings: [...analysis.bindings],
          funcs: [...analysis.funcs],
        }
        try {
          outputText =
            target === 'wgsl'
              ? emitModule(moduleDecl)
              : emitGlslModule(moduleDecl, target === 'glsl-vertex' ? 'vertex' : 'fragment')
        } catch {
          outputText = ''
        }
      }
      return { target, text: outputText, diagnostics }
    },

    positionAt(uri, offset) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return { line: 0, character: 0 }
      return positionAt(sourceFile, offset)
    },

    offsetAt(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return 0
      return offsetAt(sourceFile, position)
    },
  }

  // ── document symbols (§5: re-labelled using the front end's own collected declarations) ──
  function documentSymbolsOf(sourceFile: ts.SourceFile): TypeshadeDocumentSymbol[] {
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

  // ── semantic tokens: a direct AST walk (§5) ──
  //
  // TypeScript's own `getSemanticClassifications` does not distinguish a function name from a
  // property from a plain identifier finely enough for this taxonomy (functions, properties and
  // ordinary variables are all just `identifier`), so this walks the tree itself instead of
  // layering onto that API — one pass produces the base classification (type/struct/function/
  // parameter/variable/property/keyword/number/string) and the TypeShade enrichments
  // (decorator, builtin, gpu/entry/readonly modifiers) together, rather than two systems that
  // could disagree about the same token.
  function semanticTokensOf(
    sourceFile: ts.SourceFile,
    range?: TypeshadeRange,
  ): TypeshadeSemanticToken[] {
    const analysis = compileTsSource(sourceFile.text, {
      sourceFile,
      requireDirective: false,
      emit: false,
    })
    const bindingNames = new Set(analysis.bindings.map((b) => b.name))
    const constNames = new Set(analysis.consts.map((c) => c.name))
    const lo = range ? offsetAt(sourceFile, range.start) : 0
    const hi = range ? offsetAt(sourceFile, range.end) : sourceFile.text.length

    const tokens: {
      start: number
      length: number
      type: TypeshadeSemanticTokenType
      modifiers: TypeshadeSemanticTokenModifier[]
    }[] = []
    const push = (
      start: number,
      length: number,
      type: TypeshadeSemanticTokenType,
      modifiers: readonly TypeshadeSemanticTokenModifier[] = [],
    ): void => {
      if (start + length < lo || start > hi) return
      tokens.push({ start, length, type, modifiers: [...modifiers] })
    }

    const visit = (node: ts.Node): void => {
      if (KEYWORD_KINDS.has(node.kind)) {
        push(node.getStart(), node.getWidth(), 'keyword')
      } else if (ts.isNumericLiteral(node)) {
        push(node.getStart(), node.getWidth(), 'number')
      } else if (ts.isDecorator(node)) {
        const expr = ts.isCallExpression(node.expression)
          ? node.expression.expression
          : node.expression
        if (ts.isIdentifier(expr)) push(expr.getStart(), expr.getWidth(), 'decorator')
      } else if (
        ts.isStringLiteralLike(node) &&
        ts.isCallExpression(node.parent) &&
        ts.isIdentifier(node.parent.expression) &&
        node.parent.expression.text === 'builtin' &&
        WGSL_BUILTIN_NAMES.includes(node.text)
      ) {
        push(node.getStart() + 1, node.text.length, 'builtin')
      } else if (ts.isStringLiteralLike(node)) {
        push(node.getStart(), node.getWidth(), 'string')
      } else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const modifiers: TypeshadeSemanticTokenModifier[] = TYPE_DOCS[node.typeName.text]
          ? ['gpu']
          : []
        push(node.typeName.getStart(), node.typeName.getWidth(), 'type', modifiers)
      } else if (ts.isClassDeclaration(node) && node.name) {
        push(node.name.getStart(), node.name.getWidth(), 'struct', ['declaration'])
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const stage = stageOf(node, sourceFile)
        push(
          node.name.getStart(),
          node.name.getWidth(),
          'function',
          stage ? ['declaration', 'entry'] : ['declaration'],
        )
      } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        push(node.name.getStart(), node.name.getWidth(), 'parameter', ['declaration'])
      } else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
        push(node.name.getStart(), node.name.getWidth(), 'property', ['declaration'])
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        ts.isSourceFile(node.parent.parent.parent)
      ) {
        const name = node.name.text
        const isConstDecl = (node.parent.flags & ts.NodeFlags.Const) !== 0
        const modifiers: TypeshadeSemanticTokenModifier[] = ['declaration']
        if (isConstDecl) modifiers.push('readonly')
        const type: TypeshadeSemanticTokenType = bindingNames.has(name) ? 'resource' : 'variable'
        if (bindingNames.has(name) || constNames.has(name)) modifiers.push('gpu')
        push(node.name.getStart(), node.name.getWidth(), type, modifiers)
      } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
        push(node.name.getStart(), node.name.getWidth(), 'property')
      } else if (ts.isIdentifier(node) && !ts.isDecorator(node.parent)) {
        push(node.getStart(), node.getWidth(), 'variable')
      }
      node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)

    tokens.sort((a, b) => a.start - b.start)
    return tokens.map((t) => {
      const pos = positionAt(sourceFile, t.start)
      return {
        line: pos.line,
        character: pos.character,
        length: t.length,
        type: t.type,
        modifiers: t.modifiers,
      }
    })
  }
}
