// === createTypeshadeLanguageService: the TypeshadeLanguageService of design doc §4 ===

import ts from 'typescript';
import { emitModule } from '../core/backends/wgsl.js';
import { emitGlslModule } from '../core/backends/glsl.js';
import { compileTsSource, type CompileTsSourceResult } from '../compiler/ts/source-file.js';
import { TypeshadeHost, type TypeshadeLanguageServiceHost } from './host.js';
import { TS_CODES } from '../compiler/ts/codes.js';
import { makeDiagnostic } from '../compiler/ts/diagnostic.js';
import { emittedStructDecls } from '../compiler/ts/structs.js';
import {
  fromCompilerDiagnostic,
  getTypeScriptDiagnostics,
  getTypeshadeDiagnostics,
} from './diagnostics.js';
import { getCompletions } from './completions.js';
import { getHover } from './hover.js';
import {
  getDefinition,
  getDocumentSymbols,
  getReferences,
  prepareRename,
  rename,
} from './navigation.js';
import { getSignatureHelp } from './signature.js';
import { getSemanticTokens } from './semantic-tokens.js';
import { offsetAt, positionAt } from './positions.js';
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
} from './types.js';

export type { TypeshadeLanguageServiceHost } from './host.js';
export { AMBIENT_LIB_URI } from './host.js';

/**
 * The full editor-neutral, document-based Typeshade language service surface (design doc §4).
 * One instance owns one `ts.LanguageService` over its own document store; adapters (Monaco,
 * LSP) send text and positions and read back data — nothing here is asynchronous, and
 * cancellation of a stale request is the adapter's own concern (§8).
 */
export interface TypeshadeLanguageService {
  /** Opens a document, or replaces it if already open. */
  openDocument(uri: string, text: string, version?: number): void;
  /** Updates an open document's text. */
  updateDocument(uri: string, text: string, version?: number): void;
  /** Closes a document; it is dropped from the underlying TypeScript program. */
  closeDocument(uri: string): void;

  /** TypeScript and TypeShade diagnostics for `uri`, merged (§5, §6) and in document order: by
   *  span start, then span length, then source. Empty when `uri` is not open. */
  getDiagnostics(uri: string): readonly TypeshadeDiagnostic[];
  /** Completion items at `position` in `uri` (§5). */
  getCompletions(uri: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[];
  /** Hover documentation at `position` in `uri`, or `undefined` when there is none (§5). */
  getHover(uri: string, position: TypeshadePosition): TypeshadeHover | undefined;

  /** Every location `position` in `uri` is defined at. */
  getDefinition(uri: string, position: TypeshadePosition): readonly TypeshadeLocation[];
  /** Every reference to the symbol at `position` in `uri`. */
  getReferences(
    uri: string,
    position: TypeshadePosition,
    options?: { includeDeclaration?: boolean },
  ): readonly TypeshadeLocation[];
  /** The outline of `uri`: its structs, entries, functions, resources and constants. */
  getDocumentSymbols(uri: string): readonly TypeshadeDocumentSymbol[];
  /** Signature help for the call expression at `position` in `uri`. */
  getSignatureHelp(uri: string, position: TypeshadePosition): TypeshadeSignatureHelp | undefined;
  /** Whether the symbol at `position` in `uri` can be renamed, and its current display range. */
  prepareRename(
    uri: string,
    position: TypeshadePosition,
  ): { range: TypeshadeRange; placeholder: string } | undefined;
  /** Every edit, across every affected document, to rename the symbol at `position` to `newName`. */
  rename(
    uri: string,
    position: TypeshadePosition,
    newName: string,
  ): Readonly<Record<string, readonly TypeshadeTextEdit[]>>;
  /** Semantic tokens for `uri`, optionally restricted to `range`. */
  getSemanticTokens(uri: string, range?: TypeshadeRange): readonly TypeshadeSemanticToken[];

  /** Compiles `uri` on demand for an output pane. Never called per keystroke by the service
   * itself (§7, §8). `undefined` when `uri` is not open. */
  getCompiledOutput(
    uri: string,
    target: TypeshadeCompiledOutput['target'],
  ): TypeshadeCompiledOutput | undefined;

  /** Converts a UTF-16 offset into `uri`'s document into a zero-based editor position. */
  positionAt(uri: string, offset: number): TypeshadePosition;
  /** Converts a zero-based editor position in `uri`'s document into a UTF-16 offset. */
  offsetAt(uri: string, position: TypeshadePosition): number;
}

/**
 * The front-end analysis of one document: `compileTsSource` over the program's own
 * `ts.SourceFile`, with `emit: false` so no shader text is produced and `requireDirective:
 * true` so a file without `"use typeshade"` reports that as a diagnostic (§8). Every method
 * that reads the front end (diagnostics, symbols, semantic tokens, hover, compiled output)
 * reads one cached result of this per document version instead of running it itself.
 */
export type AnalyzeSourceFile = (sourceFile: ts.SourceFile) => CompileTsSourceResult;

/** The production `AnalyzeSourceFile`. */
export const analyzeSourceFile: AnalyzeSourceFile = (sourceFile) =>
  compileTsSource(sourceFile.text, { sourceFile, requireDirective: true, emit: false });

/** Everything the service has computed about one document under one `dependencyKey`
 * (design doc §8): the front-end analysis, always, and the merged diagnostics once
 * `getDiagnostics` has asked for them. */
interface DocumentCacheEntry {
  /** The `dependencyKey` the entry was computed under. */
  readonly key: string;
  readonly analysis: CompileTsSourceResult;
  diagnostics?: readonly TypeshadeDiagnostic[];
}

/**
 * The module specifier of every module reference in `sourceFile` that the TypeScript program
 * resolves through `resolveModuleNameLiterals`: the static `import ... from '...'` and
 * `export ... from '...'` declarations, and, anywhere in the tree, an `import("...")` type
 * (`typeof import("./c.js")`), a dynamic `import("...")` call and an `import x = require("...")`
 * reference. Read back off the tree so a cache key can follow the same edges the program does:
 * a key built from the top-level declarations alone went stale when the referenced module
 * reached the file only through an `import(...)` type.
 */
function importSpecifiersOf(sourceFile: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) out.push(specifier.text);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        out.push(argument.literal.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) {
      out.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** Document order for the merged list: span start, then span length (the enclosed row before
 *  the enclosing one), then source, so the two halves interleave by position. Without it the
 *  TypeShade rows all followed the TypeScript rows, and a problem list read 28:1 before 27:3. */
function byDocumentOrder(a: TypeshadeDiagnostic, b: TypeshadeDiagnostic): number {
  return (
    a.span.start - b.span.start ||
    a.span.length - b.span.length ||
    (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
  );
}
/**
 * Creates a Typeshade language service (design doc §4). `host` configures the ambient lib and
 * multi-file import resolution (`TypeshadeLanguageServiceHost`, defined in `host.ts`); omit it
 * for the bundled ambient lib and same-directory relative-import resolution.
 */
export function createTypeshadeLanguageService(
  host: TypeshadeLanguageServiceHost = {},
): TypeshadeLanguageService {
  return createTypeshadeLanguageServiceWith(host, analyzeSourceFile);
}

/**
 * `createTypeshadeLanguageService` with the front-end analysis function supplied by the
 * caller. Not exported from the `./language-service` subpath: it exists so a test can wrap
 * `analyzeSourceFile` in a counter and assert the front end runs once per document version
 * (§8) without mocking the compiler module.
 */
export function createTypeshadeLanguageServiceWith(
  host: TypeshadeLanguageServiceHost,
  analyze: AnalyzeSourceFile,
): TypeshadeLanguageService {
  const tsHost = new TypeshadeHost(host);
  const languageService = ts.createLanguageService(tsHost, ts.createDocumentRegistry());
  const cache = new Map<string, DocumentCacheEntry>();

  function program(): ts.Program {
    const p = languageService.getProgram();
    if (!p) throw new Error('TypeshadeLanguageService: no active TypeScript program');
    return p;
  }

  function sourceFileOf(uri: string): ts.SourceFile | undefined {
    return program().getSourceFile(uri);
  }

  /**
   * The cache key for everything computed about `uri` (design doc §8): its own script version
   * followed by the version of every document it imports, transitively, each resolved through
   * the host's `resolveImportUri` over the file's static import and export declarations. A
   * key made of `uri`'s version alone went stale whenever an imported document changed or was
   * closed, since neither touches the importing document's version; here a changed import
   * bumps its own version and a closed one drops to `getScriptVersion`'s `'0'`, so both
   * produce a different key and a fresh computation. An unresolvable specifier contributes
   * nothing: TypeScript reports it as unresolved from the importing file itself, whose
   * version the key already carries.
   */
  function dependencyKey(uri: string): string {
    const current = program();
    const parts: string[] = [];
    const seen = new Set<string>();
    const visit = (u: string): void => {
      if (seen.has(u)) return;
      seen.add(u);
      parts.push(`${u}@${tsHost.getScriptVersion(u)}`);
      const sf = current.getSourceFile(u);
      if (!sf) return;
      for (const specifier of importSpecifiersOf(sf)) {
        const dep = tsHost.resolveImportUri(u, specifier);
        if (dep !== undefined) visit(dep);
      }
    };
    visit(uri);
    return parts.join('|');
  }

  /** The cache entry for `uri` under its current `dependencyKey`, computing the front-end
   * analysis of `sourceFile` when there is none or the key has moved on. */
  function entryOf(uri: string, sourceFile: ts.SourceFile): DocumentCacheEntry {
    const key = dependencyKey(uri);
    const cached = cache.get(uri);
    if (cached && cached.key === key) return cached;
    const entry: DocumentCacheEntry = { key, analysis: analyze(sourceFile) };
    cache.set(uri, entry);
    return entry;
  }

  /** `uri`'s merged TypeScript and TypeShade diagnostics, computed once per cache entry. */
  function diagnosticsOf(uri: string, sourceFile: ts.SourceFile): readonly TypeshadeDiagnostic[] {
    const entry = entryOf(uri, sourceFile);
    entry.diagnostics ??= [
      ...getTypeScriptDiagnostics(languageService, sourceFile, uri, entry.analysis),
      ...getTypeshadeDiagnostics(entry.analysis, sourceFile, uri),
    ].sort(byDocumentOrder);
    return entry.diagnostics;
  }

  return {
    openDocument(uri, text, version) {
      tsHost.openDocument(uri, text, version);
      cache.delete(uri);
    },

    updateDocument(uri, text, version) {
      tsHost.updateDocument(uri, text, version);
      cache.delete(uri);
    },

    closeDocument(uri) {
      tsHost.closeDocument(uri);
      // Symbols, tokens and hover answer for any file the program holds, a file pulled in
      // only through readDocument included, and such a uri is never closed itself; its entry
      // goes when a document closes, which is when the program's file set changes.
      for (const cached of cache.keys()) {
        if (!tsHost.hasDocument(cached)) cache.delete(cached);
      }
    },

    getDiagnostics(uri) {
      if (!tsHost.hasDocument(uri)) return [];
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      return diagnosticsOf(uri, sourceFile);
    },

    getCompletions(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      const offset = offsetAt(sourceFile, position);
      return getCompletions(languageService, sourceFile, uri, offset);
    },

    getHover(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return undefined;
      const offset = offsetAt(sourceFile, position);
      return getHover(languageService, sourceFile, uri, offset, entryOf(uri, sourceFile).analysis);
    },

    getDefinition(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      const offset = offsetAt(sourceFile, position);
      return getDefinition(languageService, program(), uri, offset);
    },

    getReferences(uri, position, options) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      const offset = offsetAt(sourceFile, position);
      return getReferences(languageService, program(), uri, offset, options);
    },

    getDocumentSymbols(uri) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      return getDocumentSymbols(sourceFile, entryOf(uri, sourceFile).analysis);
    },

    getSignatureHelp(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return undefined;
      const offset = offsetAt(sourceFile, position);
      return getSignatureHelp(languageService, uri, offset);
    },

    prepareRename(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return undefined;
      const offset = offsetAt(sourceFile, position);
      return prepareRename(languageService, sourceFile, uri, offset);
    },

    rename(uri, position, newName) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return {};
      const offset = offsetAt(sourceFile, position);
      return rename(languageService, program(), sourceFile, uri, offset, newName);
    },

    getSemanticTokens(uri, range) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      return getSemanticTokens(
        languageService,
        sourceFile,
        uri,
        entryOf(uri, sourceFile).analysis,
        range,
      );
    },

    getCompiledOutput(uri, target) {
      if (!tsHost.hasDocument(uri)) return undefined;
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return undefined;
      const { analysis } = entryOf(uri, sourceFile);
      const diagnostics = [...diagnosticsOf(uri, sourceFile)];
      const hasError = diagnostics.some((d) => d.severity === 'error');
      let outputText = '';
      if (!hasError) {
        const moduleDecl = {
          consts: [...analysis.consts],
          structs: emittedStructDecls(analysis.structs),
          bindings: [...analysis.bindings],
          funcs: [...analysis.funcs],
          vars: [...analysis.vars],
        };
        try {
          outputText =
            target === 'wgsl'
              ? emitModule(moduleDecl)
              : emitGlslModule(moduleDecl, target === 'glsl-vertex' ? 'vertex' : 'fragment');
        } catch (e) {
          // A backend refusing the module (a compute-only module asked for GLSL, a feature
          // GLSL ES 3.00 cannot express) is a fact about this document and target, so it is
          // reported the way compileTsSource reports its own emit failure: as a BACKEND
          // diagnostic on the first statement, with the empty text an output pane can show.
          const message = e instanceof Error ? e.message : String(e);
          diagnostics.push(
            fromCompilerDiagnostic(
              sourceFile,
              uri,
              makeDiagnostic(
                sourceFile,
                undefined,
                `Backend emit failed for ${target}: ${message}`,
                TS_CODES.BACKEND,
              ),
            ),
          );
        }
      }
      return { target, text: outputText, diagnostics };
    },

    positionAt(uri, offset) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return { line: 0, character: 0 };
      return positionAt(sourceFile, offset);
    },

    offsetAt(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return 0;
      return offsetAt(sourceFile, position);
    },
  };
}
