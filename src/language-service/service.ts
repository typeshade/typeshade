// === createTypeshadeLanguageService: the TypeshadeLanguageService of design doc §4 ===

import ts from 'typescript'
import { emitModule } from '../core/backends/wgsl.js'
import { emitGlslModule } from '../core/backends/glsl.js'
import { compileTsSource } from '../compiler/ts/source-file.js'
import { TypeshadeHost, type TypeshadeLanguageServiceHost } from './host.js'
import { getTypeScriptDiagnostics, getTypeshadeDiagnostics } from './diagnostics.js'
import { getCompletions } from './completions.js'
import { getHover } from './hover.js'
import {
  getDefinition,
  getDocumentSymbols,
  getReferences,
  prepareRename,
  rename,
} from './navigation.js'
import { getSignatureHelp } from './signature.js'
import { getSemanticTokens } from './semantic-tokens.js'
import { offsetAt, positionAt } from './positions.js'
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
  TypeshadeSignatureHelp,
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
      return getDefinition(languageService, program(), uri, offset)
    },

    getReferences(uri, position, options) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      const offset = offsetAt(sourceFile, position)
      return getReferences(languageService, program(), uri, offset, options)
    },

    getDocumentSymbols(uri) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      return getDocumentSymbols(sourceFile)
    },

    getSignatureHelp(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return undefined
      const offset = offsetAt(sourceFile, position)
      return getSignatureHelp(languageService, uri, offset)
    },

    prepareRename(uri, position) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return undefined
      const offset = offsetAt(sourceFile, position)
      return prepareRename(languageService, sourceFile, uri, offset)
    },

    rename(uri, position, newName) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return {}
      const offset = offsetAt(sourceFile, position)
      return rename(languageService, program(), sourceFile, uri, offset, newName)
    },

    getSemanticTokens(uri, range) {
      const sourceFile = sourceFileOf(uri)
      if (!sourceFile) return []
      return getSemanticTokens(languageService, sourceFile, uri, range)
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
}
