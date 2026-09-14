// === The TypeScript LanguageServiceHost over an in-memory document store (design doc §4, §6, §8) ===
//
// One `ts.LanguageService` per `TypeshadeHost` instance (§8). Documents are script snapshots
// keyed by uri, `getScriptVersion` follows the document's own version so TypeScript reuses an
// unchanged file's parse/bind/check work, and the ambient lib rides along as one more virtual
// file rather than a real path on disk — the host never touches a filesystem or a DOM API.

import ts from 'typescript'
import { SHADE_DTS } from './ambient.js'

/**
 * Configuration for a `TypeshadeHost` / `createTypeshadeLanguageService` instance (design doc §4).
 */
export interface TypeshadeLanguageServiceHost {
  /** Ambient declarations for the TypeShade globals (`f32`, `vec4`, `uniform<T>`, `@vertex`, and
   * the rest of the authoring vocabulary). Defaults to the bundled `SHADE_DTS`. */
  readonly ambientLib?: string
  /** Resolves a relative import from a document to another document's uri, for multi-file
   * units. Default: same directory, with a `.ts` extension appended when the specifier has
   * none. */
  readonly resolveImport?: (fromUri: string, specifier: string) => string | undefined
  /** Reads a document the adapter has not opened itself (an imported file). Return `undefined`
   * when the uri is unknown; the import is then reported as unresolved. */
  readonly readDocument?: (uri: string) => string | undefined
}

/** The uri the ambient TypeShade declarations are served under. Never a real document: it
 * never appears in `openDocument`/`updateDocument`/`closeDocument`, and no diagnostic is ever
 * requested for it directly (a broken ambient lib fails `ambient.test.ts`'s zero-diagnostics
 * assertion instead, at the callsite that owns the text). */
export const AMBIENT_LIB_URI = 'typeshade:shade.d.ts'

/** `getDefaultLibFileName` must return *something* — TypeScript's language service calls it
 * unconditionally — but `compilerOptions.lib: []` means it is never actually loaded as a
 * source file (verified: `getProgram().getSourceFiles()` contains only the ambient lib and the
 * open documents). Its snapshot is the empty string so a stray reference is at least well-formed. */
const NO_LIB_URI = 'typeshade:no-lib.d.ts'

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
  }
}

/** The default `resolveImport`: same directory as `fromUri`, with a `.ts` extension appended
 * when the specifier has none. No `node:path` — the host must stay filesystem-free so it can
 * run in a browser worker (design doc §1, §7). */
function defaultResolveImport(fromUri: string, specifier: string): string {
  const dir = fromUri.includes('/') ? fromUri.slice(0, fromUri.lastIndexOf('/') + 1) : ''
  const joined = joinPath(dir, specifier)
  return /\.[a-zA-Z0-9]+$/.test(joined) ? joined : `${joined}.ts`
}

function joinPath(dir: string, specifier: string): string {
  const segments = `${dir}${specifier}`.split('/')
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** One open or updated document: its text and the version an adapter supplied (or the store's
 * own monotonic counter when none was given). */
interface StoredDocument {
  text: string
  version: number
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
  private readonly docs = new Map<string, StoredDocument>()
  private readonly imported = new Map<string, string>()
  private nextVersion = 1
  private readonly ambientLib: string
  private readonly resolveImport: (fromUri: string, specifier: string) => string | undefined
  private readonly readDocument: (uri: string) => string | undefined

  constructor(hostOptions: TypeshadeLanguageServiceHost = {}) {
    this.ambientLib = hostOptions.ambientLib ?? SHADE_DTS
    this.resolveImport = hostOptions.resolveImport ?? defaultResolveImport
    this.readDocument = hostOptions.readDocument ?? (() => undefined)
  }

  // ── document lifecycle ──────────────────────────────────────────────────────────────────

  /** Opens or replaces a document's text. `version` defaults to the store's own monotonic
   * counter when the adapter does not track versions itself. */
  openDocument(uri: string, text: string, version?: number): void {
    this.docs.set(uri, { text, version: version ?? this.nextVersion++ })
  }

  /** Updates an already-open document's text; behaves like `openDocument` if it was not open. */
  updateDocument(uri: string, text: string, version?: number): void {
    this.docs.set(uri, { text, version: version ?? this.nextVersion++ })
  }

  /** Removes a document from the store. It stops appearing in `getScriptFileNames`, so
   * TypeScript drops it from the program on the next request. */
  closeDocument(uri: string): void {
    this.docs.delete(uri)
  }

  /** Whether `uri` is currently an open document (not an imported, adapter-unopened file). */
  hasDocument(uri: string): boolean {
    return this.docs.has(uri)
  }

  /** The text of an open document, or of a file pulled in only through `readDocument`. */
  getDocumentText(uri: string): string | undefined {
    return this.docs.get(uri)?.text ?? this.imported.get(uri)
  }

  /** Every currently open document's uri. */
  openUris(): readonly string[] {
    return [...this.docs.keys()]
  }

  // ── ts.LanguageServiceHost ───────────────────────────────────────────────────────────────

  getScriptFileNames(): string[] {
    return [AMBIENT_LIB_URI, ...this.docs.keys(), ...this.imported.keys()]
  }

  getScriptVersion(uri: string): string {
    if (uri === AMBIENT_LIB_URI) return '1'
    const doc = this.docs.get(uri)
    if (doc) return String(doc.version)
    return this.imported.has(uri) ? '1' : '0'
  }

  getScriptSnapshot(uri: string): ts.IScriptSnapshot | undefined {
    if (uri === AMBIENT_LIB_URI) return ts.ScriptSnapshot.fromString(this.ambientLib)
    if (uri === NO_LIB_URI) return ts.ScriptSnapshot.fromString('')
    const text = this.getDocumentText(uri)
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
  }

  getCurrentDirectory(): string {
    return '/'
  }

  getCompilationSettings(): ts.CompilerOptions {
    return typeshadeCompilerOptions()
  }

  getDefaultLibFileName(): string {
    return NO_LIB_URI
  }

  useCaseSensitiveFileNames(): boolean {
    return true
  }

  fileExists(uri: string): boolean {
    return (
      uri === AMBIENT_LIB_URI || uri === NO_LIB_URI || this.docs.has(uri) || this.imported.has(uri)
    )
  }

  readFile(uri: string): string | undefined {
    if (uri === AMBIENT_LIB_URI) return this.ambientLib
    if (uri === NO_LIB_URI) return ''
    return this.getDocumentText(uri)
  }

  directoryExists(): boolean {
    return true
  }

  getDirectories(): string[] {
    return []
  }

  resolveModuleNameLiterals(
    moduleLiterals: readonly ts.StringLiteralLike[],
    containingFile: string,
  ): readonly ts.ResolvedModuleWithFailedLookupLocations[] {
    return moduleLiterals.map((literal) => {
      const specifier = literal.text
      if (!specifier.startsWith('.')) return { resolvedModule: undefined }
      const resolvedUri = this.resolveImport(containingFile, specifier)
      if (resolvedUri === undefined) return { resolvedModule: undefined }
      if (!this.docs.has(resolvedUri) && !this.imported.has(resolvedUri)) {
        const text = this.readDocument(resolvedUri)
        if (text === undefined) return { resolvedModule: undefined }
        this.imported.set(resolvedUri, text)
      }
      return {
        resolvedModule: {
          resolvedFileName: resolvedUri,
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
        },
      }
    })
  }
}
