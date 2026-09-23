// === The TypeScript LanguageServiceHost over an in-memory document store (design doc §4, §6, §8) ===
//
// One `ts.LanguageService` per `TypeshadeHost` instance (§8). Documents are script snapshots
// keyed by uri, `getScriptVersion` changes whenever a document's text changes (and with the
// adapter's own version) so TypeScript reuses an unchanged file's parse/bind/check work and
// never keeps a stale one, and the ambient lib rides along as one more virtual file rather than
// a real path on disk — the host never touches a filesystem or a DOM API.

import ts from 'typescript';
import { SHADE_DTS } from './ambient.js';

/**
 * Configuration for a `TypeshadeHost` / `createTypeshadeLanguageService` instance (design doc §4).
 */
export interface TypeshadeLanguageServiceHost {
  /** Ambient declarations for the TypeShade globals (`f32`, `vec4`, `uniform<T>`, `@vertex`, and
   * the rest of the authoring vocabulary). Defaults to the bundled `SHADE_DTS`. */
  readonly ambientLib?: string;
  /** Resolves a relative import from a document to another document's uri, for multi-file
   * units. Default: same directory, with a `.ts` extension appended when the specifier has
   * none. */
  readonly resolveImport?: (fromUri: string, specifier: string) => string | undefined;
  /** Reads a document the adapter has not opened itself (an imported file). Return `undefined`
   * when the uri is unknown; the import is then reported as unresolved. */
  readonly readDocument?: (uri: string) => string | undefined;
}

/** The uri the ambient TypeShade declarations are served under. Never a real document: it
 * never appears in `openDocument`/`updateDocument`/`closeDocument`, and no diagnostic is ever
 * requested for it directly (a broken ambient lib fails `ambient.test.ts`'s zero-diagnostics
 * assertion instead, at the callsite that owns the text). */
export const AMBIENT_LIB_URI = 'typeshade:shade.d.ts';

/** `getDefaultLibFileName` must return *something* — TypeScript's language service calls it
 * unconditionally — but `compilerOptions.lib: []` means it is never actually loaded as a
 * source file (verified: `getProgram().getSourceFiles()` contains only the ambient lib and the
 * open documents). Its snapshot is the empty string so a stray reference is at least well-formed. */
const NO_LIB_URI = 'typeshade:no-lib.d.ts';

/**
 * The compiler options every `TypeshadeHost` program uses (design doc §6). `lib: []` with
 * `SHADE_DTS` supplying the vocabulary keeps the program from ever seeing a DOM or Node global;
 * `experimentalDecorators` and `strictPropertyInitialization: false` are the two settings §6
 * measured as removing a real false-positive class (TS2564) rather than merely convenient.
 */
export function typeshadeCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: [],
    types: [],
    strict: true,
    experimentalDecorators: true,
    strictPropertyInitialization: false,
    noEmit: true,
    skipLibCheck: false,
  };
}

/** The default `resolveImport`: same directory as `fromUri`, with a trailing `.js`/`.mjs`
 * specifier rewritten to `.ts` (matching `tsc`'s own Bundler/NodeNext resolution, and the
 * extension this repository's own source uses everywhere) and a `.ts` extension appended when
 * the specifier has none at all. No `node:path` — the host must stay filesystem-free so it can
 * run in a browser worker (design doc §1, §7). */
function defaultResolveImport(fromUri: string, specifier: string): string {
  const dir = fromUri.includes('/') ? fromUri.slice(0, fromUri.lastIndexOf('/') + 1) : '';
  const joined = joinPath(dir, specifier);
  const rewritten = joined.replace(/\.m?js$/, '.ts');
  return /\.[a-zA-Z0-9]+$/.test(rewritten) ? rewritten : `${rewritten}.ts`;
}

/** Joins `dir` (a uri prefix ending in `/`, or `''`) with `specifier`, resolving only the
 * specifier's own `.`/`..` segments against `dir`'s path. `dir`'s own scheme and authority
 * (`file://`) or leading `/` are matched once up front and reattached verbatim rather than
 * re-split with everything else — re-splitting the whole concatenated string on `/` (the
 * previous approach) silently ate a `file://` authority's slashes and an absolute uri's leading
 * `/`, so `./lib.ts` from `file:///main.ts` resolved to `file:/lib.ts` and from `/main.ts` to
 * `lib.ts`, neither of which is ever an open document's uri. */
function joinPath(dir: string, specifier: string): string {
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/{0,2}/.exec(dir);
  const prefix = scheme ? scheme[0] : '';
  const pathPart = dir.slice(prefix.length);
  const isAbsolute = pathPart.startsWith('/');
  const out: string[] = [];
  for (const seg of `${pathPart}${specifier}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return prefix + (isAbsolute ? '/' : '') + out.join('/');
}

/** One open or updated document: its text, the version an adapter supplied (or the store's
 * own monotonic counter when none was given), and the store-wide `revision` at which its text
 * last changed. */
interface StoredDocument {
  text: string;
  version: number;
  revision: number;
}

/** A file pulled in through `readDocument` because an open document imports it: its text as
 * read, and the store-wide `revision` of that read. */
interface ImportedDocument {
  text: string;
  revision: number;
}

/**
 * A `ts.LanguageServiceHost` over an in-memory document store, plus the document-lifecycle
 * methods (`openDocument`/`updateDocument`/`closeDocument`) `service.ts` delegates straight
 * through to. A relative import from an open document resolves through `resolveImport` (or the
 * same-directory default) and is read through `readDocument` when it names a file the adapter
 * has not opened itself — both no-ops when the host option is absent, in which case an
 * unresolvable relative import is reported by TypeScript as any other unresolved module.
 */
export class TypeshadeHost implements ts.LanguageServiceHost {
  private readonly docs = new Map<string, StoredDocument>();
  private readonly imported = new Map<string, ImportedDocument>();
  private nextVersion = 1;
  /** Counts every text change the store has seen, across all documents, so that a script
   * version derived from it never repeats for a uri whose text differs (design doc §7). */
  private revision = 0;
  private readonly ambientLib: string;
  private readonly resolveImport: (fromUri: string, specifier: string) => string | undefined;
  private readonly readDocument: (uri: string) => string | undefined;

  constructor(hostOptions: TypeshadeLanguageServiceHost = {}) {
    this.ambientLib = hostOptions.ambientLib ?? SHADE_DTS;
    this.resolveImport = hostOptions.resolveImport ?? defaultResolveImport;
    this.readDocument = hostOptions.readDocument ?? (() => undefined);
  }

  // ── document lifecycle ──────────────────────────────────────────────────────────────────

  /** Opens or replaces a document's text. `version` defaults to the store's own monotonic
   * counter when the adapter does not track versions itself. */
  openDocument(uri: string, text: string, version?: number): void {
    this.store(uri, text, version);
  }

  /** Updates an already-open document's text; behaves like `openDocument` if it was not open. */
  updateDocument(uri: string, text: string, version?: number): void {
    this.store(uri, text, version);
  }

  /** Stores `text` for `uri`, taking a new `revision` only when the text differs from what the
   * store holds for that uri, so an unchanged text under a new version keeps its revision and a
   * changed text under the same version (or none) gets a new one either way. A copy of the
   * same uri pulled in through `readDocument` is dropped: the open document is the only text
   * the program sees for it from here on. */
  private store(uri: string, text: string, version: number | undefined): void {
    const current = this.docs.get(uri);
    const revision =
      current !== undefined && current.text === text ? current.revision : ++this.revision;
    this.docs.set(uri, { text, version: version ?? this.nextVersion++, revision });
    this.imported.delete(uri);
  }

  /** Removes a document from the store. It stops appearing in `getScriptFileNames`, so
   * TypeScript drops it from the program on the next request; if another open document imports
   * it, that request resolves the import again and re-reads the file through `readDocument`
   * (a copy read earlier is dropped here too), so the importer sees the current text and not
   * the closed document's. */
  closeDocument(uri: string): void {
    this.docs.delete(uri);
    this.imported.delete(uri);
  }

  /** Whether `uri` is currently an open document (not an imported, adapter-unopened file). */
  hasDocument(uri: string): boolean {
    return this.docs.has(uri);
  }

  /** The text of an open document, or of a file pulled in only through `readDocument`. */
  getDocumentText(uri: string): string | undefined {
    return this.docs.get(uri)?.text ?? this.imported.get(uri)?.text;
  }

  /** Every currently open document's uri. */
  openUris(): readonly string[] {
    return [...this.docs.keys()];
  }

  /** The uri a `specifier` written in `fromUri` resolves to through `resolveImport`, or
   * `undefined` for a bare (non-relative) specifier or one the host cannot resolve. The same
   * rule `resolveModuleNameLiterals` applies to TypeScript's own module resolution, exposed so
   * `service.ts` can key its per-document caches on the versions of the documents a file
   * imports (design doc §8), without a second resolution rule that could drift from this one. */
  resolveImportUri(fromUri: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    return this.resolveImport(fromUri, specifier);
  }

  // ── ts.LanguageServiceHost ───────────────────────────────────────────────────────────────

  getScriptFileNames(): string[] {
    return [AMBIENT_LIB_URI, ...this.docs.keys(), ...this.imported.keys()];
  }

  /** The version TypeScript compares to decide whether to reuse a file (design doc §7): the
   * adapter's version and the store's revision for an open document, so it changes whenever
   * the text changes even when the adapter repeats or omits the version; `imported.<revision>`
   * for a file read through `readDocument`, a space that cannot collide with an adapter's
   * version so opening such a file in the editor is always seen as a change; `'0'` for a uri
   * the store does not hold at all. */
  getScriptVersion(uri: string): string {
    if (uri === AMBIENT_LIB_URI) return '1';
    const doc = this.docs.get(uri);
    if (doc) return `${doc.version}.${doc.revision}`;
    const imported = this.imported.get(uri);
    if (imported) return `imported.${imported.revision}`;
    return '0';
  }

  getScriptSnapshot(uri: string): ts.IScriptSnapshot | undefined {
    if (uri === AMBIENT_LIB_URI) return ts.ScriptSnapshot.fromString(this.ambientLib);
    if (uri === NO_LIB_URI) return ts.ScriptSnapshot.fromString('');
    const text = this.getDocumentText(uri);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  }

  getCurrentDirectory(): string {
    return '/';
  }

  getCompilationSettings(): ts.CompilerOptions {
    return typeshadeCompilerOptions();
  }

  getDefaultLibFileName(): string {
    return NO_LIB_URI;
  }

  useCaseSensitiveFileNames(): boolean {
    return true;
  }

  fileExists(uri: string): boolean {
    return (
      uri === AMBIENT_LIB_URI || uri === NO_LIB_URI || this.docs.has(uri) || this.imported.has(uri)
    );
  }

  readFile(uri: string): string | undefined {
    if (uri === AMBIENT_LIB_URI) return this.ambientLib;
    if (uri === NO_LIB_URI) return '';
    return this.getDocumentText(uri);
  }

  directoryExists(): boolean {
    return true;
  }

  getDirectories(): string[] {
    return [];
  }

  resolveModuleNameLiterals(
    moduleLiterals: readonly ts.StringLiteralLike[],
    containingFile: string,
  ): readonly ts.ResolvedModuleWithFailedLookupLocations[] {
    return moduleLiterals.map((literal) => {
      const resolvedUri = this.resolveImportUri(containingFile, literal.text);
      if (resolvedUri === undefined) return { resolvedModule: undefined };
      if (!this.docs.has(resolvedUri) && !this.imported.has(resolvedUri)) {
        const text = this.readDocument(resolvedUri);
        if (text === undefined) return { resolvedModule: undefined };
        this.imported.set(resolvedUri, { text, revision: ++this.revision });
      }
      return {
        resolvedModule: {
          resolvedFileName: resolvedUri,
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
        },
      };
    });
  }
}
