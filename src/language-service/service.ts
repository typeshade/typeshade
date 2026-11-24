import { TS_CODES } from '../compiler/ts/codes.js';
import {
  isAbstractDivisionRefusal,
  markProjectedAnnotations,
  markProjectedReader,
} from '../compiler/ts/abstract-const.js';
import { relatedSitesOf } from '../compiler/ts/diagnostic.js';
import ts from 'typescript';
import { emitModule } from '../core/backends/wgsl.js';
import { emitGlslModule } from '../core/backends/glsl.js';
import { compileTsSource, type CompileTsSourceResult } from '../compiler/ts/source-file.js';
import type { ImportHooks } from '../compiler/ts/link.js';
import { AMBIENT_LIB_URI, TypeshadeHost, type TypeshadeLanguageServiceHost } from './host.js';
import { normalizeSourcePath } from '../compiler/ts/specifier.js';
import { importSpecifiersOf } from './service/import-specifiers.js';
import { backendDiagnostic } from '../compiler/ts/diagnostic.js';
import { renderPart } from '../compiler/ts/render-part.js';
import { emittedStructDecls } from '../compiler/ts/structs.js';
import {
  fromCompilerDiagnostic,
  getTypeScriptDiagnostics,
  getTypeshadeDiagnostics,
  mergeDiagnostics,
} from './diagnostics.js';
import { getCompletions } from './completions.js';
import { getHover, type HoverProgram } from './hover.js';
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
import type { TypeshadeDiagnostic, TypeshadePosition } from './types.js';
import type {
  TypeshadeLanguageService,
  AnalyzeSourceFile,
  TypeshadeLanguageServiceTestOptions,
} from './service/types.js';
import { projected } from './service/projected.js';
export type {
  TypeshadeLanguageService,
  AnalyzeSourceFile,
  TypeshadeLanguageServiceTestOptions,
} from './service/types.js';

export type { TypeshadeLanguageServiceHost } from './host.js';
export { AMBIENT_LIB_URI } from './host.js';

export const analyzeSourceFile: AnalyzeSourceFile = (sourceFile, imports) =>
  compileTsSource(sourceFile.text, {
    sourceFile,
    requireDirective: true,
    emit: false,
    ...imports,
  });

interface DocumentCacheEntry {
  readonly key: string;
  readonly analysis: CompileTsSourceResult;
  diagnostics?: readonly TypeshadeDiagnostic[];
}

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

export function createTypeshadeLanguageServiceWith(
  host: TypeshadeLanguageServiceHost,
  analyze: AnalyzeSourceFile,
  options: TypeshadeLanguageServiceTestOptions = {},
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

  function ambientOrSelf(uri: string): string {
    return tsHost.ambientLibUri !== undefined && normalizeSourcePath(uri) === tsHost.ambientLibUri
      ? AMBIENT_LIB_URI
      : uri;
  }

  const imports: ImportHooks = {
    readDocument: (uri) =>
      sourceFileOf(uri)?.text ?? tsHost.getDocumentText(uri) ?? tsHost.readOutsideProgram(uri),
    resolveImport: (fromUri, specifier) => tsHost.resolveImportUri(fromUri, specifier),
  };
  markProjectedReader(imports.readDocument!, (uri) => tsHost.projectionOf(uri)?.insertionStarts());

  function dependencyKey(uri: string): string {
    return dependenciesOf(uri)
      .map((u) => `${u}@${tsHost.getScriptVersion(u)}`)
      .join('|');
  }

  function dependenciesOf(uri: string): string[] {
    const current = program();
    const seen = new Set<string>();
    const visit = (u: string): void => {
      if (seen.has(u)) return;
      seen.add(u);
      const sf = current.getSourceFile(u);
      if (!sf) return;
      for (const specifier of importSpecifiersOf(sf)) {
        const dep = tsHost.resolveImportUri(u, specifier);
        if (dep !== undefined) visit(dep);
      }
    };
    visit(uri);
    return [...seen];
  }

  function programsLinking(uri: string, declaringUri: string): HoverProgram[] {
    const out: HoverProgram[] = [];
    for (const open of tsHost.openUris()) {
      if (open === uri || !dependenciesOf(open).includes(declaringUri)) continue;
      const sourceFile = sourceFileOf(open);
      if (sourceFile !== undefined)
        out.push({ uri: open, analysis: entryOf(open, sourceFile).analysis });
    }
    return out;
  }

  function programOf(uri: string): HoverProgram | undefined {
    if (!tsHost.hasDocument(uri)) return undefined;
    const sourceFile = sourceFileOf(uri);
    return sourceFile === undefined
      ? undefined
      : { uri: sourceFile.fileName, analysis: entryOf(sourceFile.fileName, sourceFile).analysis };
  }

  function entryOf(uri: string, sourceFile: ts.SourceFile): DocumentCacheEntry {
    const key = dependencyKey(uri);
    const cached = cache.get(uri);
    if (cached && cached.key === key) return cached;
    const projection = tsHost.projectionOf(uri);
    if (projection !== undefined)
      markProjectedAnnotations(
        sourceFile,
        projection.insertionStarts(),
        projection.insertionLengths(),
      );
    const entry: DocumentCacheEntry = { key, analysis: analyze(sourceFile, imports) };
    cache.set(uri, entry);
    return entry;
  }

  function diagnosticsOf(uri: string, sourceFile: ts.SourceFile): readonly TypeshadeDiagnostic[] {
    const entry = entryOf(uri, sourceFile);
    entry.diagnostics ??= mergeDiagnostics(
      sourceFile,
      getTypeScriptDiagnostics(languageService, sourceFile, uri),
      getTypeshadeDiagnostics(entry.analysis, sourceFile, uri),
      options.merge === false ? undefined : entry.analysis,
      languageService.getProgram()?.getTypeChecker(),
    ).sort(byDocumentOrder);
    const own = entry.diagnostics;
    const sites: { start: TypeshadePosition; end: TypeshadePosition }[] = [];
    for (const program of programsLinking(uri, uri)) {
      for (const d of program.analysis.diagnostics) {
        if (!isAbstractDivisionRefusal(d)) continue;
        for (const site of relatedSitesOf(d)) {
          if (site.fileName !== sourceFile.fileName) continue;
          sites.push({
            start: { line: site.line - 1, character: site.character - 1 },
            end: { line: site.endLine - 1, character: site.endCharacter - 1 },
          });
        }
      }
    }
    if (sites.length === 0) return own;
    const before = (a: TypeshadePosition, b: TypeshadePosition): boolean =>
      a.line < b.line || (a.line === b.line && a.character <= b.character);
    return own.filter(
      (o) =>
        !(
          o.code === TS_CODES.TYPE_MISMATCH &&
          o.severity === 'error' &&
          !isAbstractDivisionRefusal({ code: String(o.code), message: o.message }) &&
          sites.some((site) => before(o.range.start, site.start) && before(site.end, o.range.end))
        ),
    );
  }

  const inner: TypeshadeLanguageService = {
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
      return getHover(languageService, sourceFile, uri, offset, entryOf(uri, sourceFile).analysis, {
        linking: (declaringUri) => programsLinking(sourceFile.fileName, declaringUri),
        of: (other) => programOf(other),
      });
    },

    getDefinition(uri, position) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      const offset = offsetAt(sourceFile, position);
      return getDefinition(languageService, program(), uri, offset, tsHost.ambientLibUri);
    },

    getReferences(uri, position, options) {
      const sourceFile = sourceFileOf(uri);
      if (!sourceFile) return [];
      const offset = offsetAt(sourceFile, position);
      return getReferences(languageService, program(), uri, offset, options, tsHost.ambientLibUri);
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
      for (const diagnostic of analysis.diagnostics) {
        if (diagnostic.fileName === sourceFile.fileName) continue;
        const imported = sourceFileOf(diagnostic.fileName);
        if (imported !== undefined)
          diagnostics.push(fromCompilerDiagnostic(imported, diagnostic.fileName, diagnostic));
      }
      const hasError =
        diagnostics.some((d) => d.severity === 'error') ||
        analysis.diagnostics.some((d) => d.category === 'error');
      let outputText = '';
      if (!hasError) {
        const moduleDecl = {
          consts: [...analysis.consts],
          structs: emittedStructDecls(analysis.structs),
          bindings: [...analysis.bindings],
          funcs: [...analysis.funcs],
          overrides: [...analysis.overrides],
          vars: [...analysis.vars],
          enables: [...analysis.enables],
        };
        let wgsl: string | undefined;
        try {
          wgsl = emitModule(moduleDecl);
        } catch (e) {
          diagnostics.push(
            fromCompilerDiagnostic(sourceFile, uri, backendDiagnostic(sourceFile, e)),
          );
        }
        if (wgsl !== undefined) {
          if (target === 'wgsl') outputText = wgsl;
          else {
            const hasRenderEntry = moduleDecl.funcs.some(
              (f) => f.stage === 'vertex' || f.stage === 'fragment',
            );
            try {
              outputText = emitGlslModule(
                hasRenderEntry ? renderPart(moduleDecl) : moduleDecl,
                target === 'glsl-vertex' ? 'vertex' : 'fragment',
              );
            } catch (e) {
              if (hasRenderEntry)
                diagnostics.push(
                  fromCompilerDiagnostic(
                    sourceFile,
                    uri,
                    backendDiagnostic(sourceFile, e, 'warning'),
                  ),
                );
            }
          }
        }
      }
      return { target, text: outputText, diagnostics };
    },

    positionAt(uri, offset) {
      const sourceFile = sourceFileOf(ambientOrSelf(uri));
      if (!sourceFile) return { line: 0, character: 0 };
      return positionAt(sourceFile, offset);
    },

    offsetAt(uri, position) {
      const sourceFile = sourceFileOf(ambientOrSelf(uri));
      if (!sourceFile) return 0;
      return offsetAt(sourceFile, position);
    },
  };
  const service = projected(inner, (uri) => tsHost.projectionOf(uri));
  readers.set(service, {
    readDocument: (uri) => tsHost.getDocumentText(uri) ?? host.readDocument?.(uri),
    resolveImport: (fromUri, specifier) => tsHost.resolveImportUri(fromUri, specifier),
  });
  return service;
}

const readers = new WeakMap<TypeshadeLanguageService, ImportHooks>();

export function importHooksOf(service: TypeshadeLanguageService): ImportHooks {
  return readers.get(service) ?? {};
}
