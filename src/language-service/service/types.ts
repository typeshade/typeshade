import type ts from 'typescript';
import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';
import type { ImportHooks } from '../../compiler/ts/link.js';
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
} from '../types.js';

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

export type AnalyzeSourceFile = (
  sourceFile: ts.SourceFile,
  imports?: ImportHooks,
) => CompileTsSourceResult;

export interface TypeshadeLanguageServiceTestOptions {
  readonly merge?: boolean;
}
