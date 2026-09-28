// === The TypeScript LanguageServiceHost over an in-memory document store (design doc §4, §6, §8) ===
//
// One `ts.LanguageService` per `TypeshadeHost` instance (§8). Documents are script snapshots
// keyed by uri, `getScriptVersion` changes whenever a document's text changes (and with the
// adapter's own version) so TypeScript reuses an unchanged file's parse/bind/check work and
// never keeps a stale one, and the ambient lib rides along as one more virtual file rather than
// a real path on disk — the host never touches a filesystem or a DOM API.

import ts from 'typescript';
import { SHADE_DTS } from './ambient.js';
import { Projection, planInsertions } from './projection.js';
import { packageKey, packageOf, resolveSpecifierFile } from '../compiler/ts/specifier.js';
import type { ImportHooks } from '../compiler/ts/link.js';

/**
 * Configuration for a `TypeshadeHost` / `createTypeshadeLanguageService` instance (design doc §4).
 */
export interface TypeshadeLanguageServiceHost {
  /** Ambient declarations for the TypeShade globals (`f32`, `vec4`, `uniform<T>`, `@vertex`, and
   * the rest of the authoring vocabulary). Defaults to the bundled `SHADE_DTS`. */
  readonly ambientLib?: string;
  /** Resolves an import from a document to another document's uri, for multi-file units.
   * Default: `resolveSpecifier` (`src/compiler/ts/specifier.ts`), the rule the compiler follows
   * an import by too: a relative path against the importing document's directory, `.js` and
   * `.mjs` read as `.ts`, and `.ts` appended to any other path; any other specifier a package,
   * found in `node_modules` from the document's directory up and read through its
   * `package.json` (proposal 0024). */
  readonly resolveImport?: (fromUri: string, specifier: string) => string | undefined;
  /** Reads a document the adapter has not opened itself (an imported file), and a package's
   * `package.json`, which the default `resolveImport` reads to find a package. Return
   * `undefined` when the uri is unknown; the import is then reported as unresolved. */
  readonly readDocument?: (uri: string) => string | undefined;
}

/** Whether `uri` names a `package.json`, which the resolution rule reads to find a package. */
const isPackageJson = (uri: string): boolean =>
  uri === 'package.json' || uri.endsWith('/package.json');

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

/** One open or updated document: its text, the version an adapter supplied (or the store's
 * own monotonic counter when none was given), and the store-wide `revision` at which its text
 * last changed. */
interface StoredDocument {
  text: string;
  version: number;
  revision: number;
  /** The text TypeScript reads for this document (`projection.ts`), computed on first use. */
  projection?: Projection;
  /** What the projection was planned against: this document's imports, transitively, each
   *  with the revision of its text then. A projection reads the types of what the document
   *  imports (Rule 3.9), so an edit to one of them plans it again. */
  projectedAgainst?: string;
  /** The store revision `projectedAgainst` was last checked at: nothing changed since, nothing
   *  to check. */
  checkedAt?: number;
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
  /** Each `package.json` the rule has read, until the next change to the store: an edit, or a
   *  document opened or closed, reads them again, so an install is seen at the next keystroke. */
  private readonly manifests = new Map<string, string | undefined>();
  private nextVersion = 1;
  /** Counts every text change the store has seen, across all documents, so that a script
   * version derived from it never repeats for a uri whose text differs (design doc §7). */
  private revision = 0;
  private readonly ambientLib: string;
  private readonly resolveImport: (fromUri: string, specifier: string) => string | undefined;
  private readonly readDocument: (uri: string) => string | undefined;

  constructor(hostOptions: TypeshadeLanguageServiceHost = {}) {
    this.ambientLib = hostOptions.ambientLib ?? SHADE_DTS;
    this.resolveImport =
      hostOptions.resolveImport ??
      ((fromUri, specifier) => resolveSpecifierFile(fromUri, specifier, this.readPackageJson));
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
    this.manifests.clear();
  }

  /** Removes a document from the store. It stops appearing in `getScriptFileNames`, so
   * TypeScript drops it from the program on the next request; if another open document imports
   * it, that request resolves the import again and re-reads the file through `readDocument`
   * (a copy read earlier is dropped here too), so the importer sees the current text and not
   * the closed document's. */
  closeDocument(uri: string): void {
    this.docs.delete(uri);
    this.imported.delete(uri);
    this.manifests.clear();
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
   * `undefined` for one the host cannot resolve. The same rule `resolveModuleNameLiterals`
   * applies to TypeScript's own module resolution, exposed so `service.ts` can key its
   * per-document caches on the versions of the documents a file imports (design doc §8), and
   * the front end can follow the same file, without a second resolution rule that could drift
   * from this one. */
  resolveImportUri(fromUri: string, specifier: string): string | undefined {
    return this.resolveImport(fromUri, specifier);
  }

  /** A `package.json` as the rule reads it: an open document's text, else the adapter's
   * `readDocument`, read once until the store next changes. `undefined` for any other uri. */
  readonly readPackageJson = (uri: string): string | undefined => {
    if (!isPackageJson(uri)) return undefined;
    if (!this.manifests.has(uri)) {
      this.manifests.set(uri, this.docs.get(uri)?.text ?? this.readDocument(uri));
    }
    return this.manifests.get(uri);
  };

  /** A file the front end reads that the TypeScript program does not hold: a `package.json`,
   * as the rule read it, or a file an import resolves to that TypeScript does not read (a
   * package's JavaScript, which the front end reads to say it is no shader module, or a file a
   * refusal suggests), through the adapter's `readDocument`. */
  readOutsideProgram(uri: string): string | undefined {
    return isPackageJson(uri) ? this.readPackageJson(uri) : this.readDocument(uri);
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
    if (doc) {
      // The projection first: planned again against a changed import, it moves the revision.
      this.projectionOf(uri);
      return `${doc.version}.${doc.revision}`;
    }
    const imported = this.imported.get(uri);
    if (imported) return `imported.${imported.revision}`;
    return '0';
  }

  getScriptSnapshot(uri: string): ts.IScriptSnapshot | undefined {
    if (uri === AMBIENT_LIB_URI) return ts.ScriptSnapshot.fromString(this.ambientLib);
    if (uri === NO_LIB_URI) return ts.ScriptSnapshot.fromString('');
    const text = this.programText(uri);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  }

  /** An open document as TypeScript reads it: with the types TypeScript cannot infer written
   * in (`projection.ts`, #162). `undefined` for a uri that is not an open document, whose text
   * the program reads as written. */
  projectionOf(uri: string): Projection | undefined {
    const doc = this.docs.get(uri);
    if (!doc) return undefined;
    if (doc.projection !== undefined && doc.checkedAt === this.revision) return doc.projection;
    const against = this.importRevisions(uri, doc.text);
    if (doc.projection === undefined || doc.projectedAgainst !== against) {
      const next = new Projection(doc.text, planInsertions(doc.text, uri, this.imports));
      // A new plan for the same text is a new text for TypeScript only when it writes something
      // else; then the document takes a new revision, so its script version moves with it.
      if (doc.projection !== undefined && next.projected !== doc.projection.projected) {
        doc.revision = ++this.revision;
      }
      doc.projection = next;
      doc.projectedAgainst = against;
    }
    doc.checkedAt = this.revision;
    return doc.projection;
  }

  /** How the front end reads what a document imports when it plans the projection: an open
   *  document's text or one already read, else the adapter's `readDocument`, resolved by the
   *  one rule `resolveImportUri` applies. */
  private readonly imports: ImportHooks = {
    readDocument: (uri) => this.getDocumentText(uri) ?? this.readDocument(uri),
    resolveImport: (fromUri, specifier) => this.resolveImportUri(fromUri, specifier),
  };

  /** Every document `uri` imports, transitively, with the revision of the text the store holds
   *  for it, as one key: it moves when any of them changes. Empty for a document that imports
   *  nothing, which is most, and then costs one scan of the text. */
  private importRevisions(uri: string, text: string): string {
    const parts: string[] = [];
    const seen = new Set<string>([uri]);
    const visit = (from: string, source: string): void => {
      for (const ref of ts.preProcessFile(source, true, false).importedFiles) {
        const dep = this.resolveImportUri(from, ref.fileName);
        if (dep === undefined || seen.has(dep)) continue;
        seen.add(dep);
        const open = this.docs.get(dep);
        const read = this.imported.get(dep);
        parts.push(`${dep}@${open?.revision ?? (read ? `r${read.revision}` : '-')}`);
        const depText = open?.text ?? read?.text;
        if (depText !== undefined) visit(dep, depText);
      }
    };
    visit(uri, text);
    return parts.join('|');
  }

  /** The text the TypeScript program holds for `uri`. */
  private programText(uri: string): string | undefined {
    return this.projectionOf(uri)?.projected ?? this.imported.get(uri)?.text;
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
    return this.programText(uri);
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
      // A package's JavaScript is no module TypeScript reads here: the import is unresolved,
      // and the front end's TS8072 says what it resolved to (surface §68).
      if (resolvedUri === undefined || !/\.[mc]?tsx?$/.test(resolvedUri)) {
        return { resolvedModule: undefined };
      }
      if (!this.docs.has(resolvedUri) && !this.imported.has(resolvedUri)) {
        const text = this.readDocument(resolvedUri);
        if (text === undefined) return { resolvedModule: undefined };
        this.imported.set(resolvedUri, { text, revision: ++this.revision });
      }
      // One copy of a package version, as the linker holds one (surface §68): TypeScript reads
      // a second path to the same name, version and file as the first.
      const pkg = packageOf(resolvedUri, this.readPackageJson);
      const packageId =
        pkg === undefined || packageKey(pkg) === undefined
          ? undefined
          : { name: pkg.name, subModuleName: pkg.path, version: pkg.version! };
      return {
        resolvedModule: {
          resolvedFileName: resolvedUri,
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
          ...(packageId === undefined ? {} : { packageId }),
        },
      };
    });
  }
}
