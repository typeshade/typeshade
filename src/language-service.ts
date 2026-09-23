// === Compatibility shim over the real service in src/language-service/ (design doc §4 migration) ===
//
// PR #6's `TypeshadeLanguageService` took a source string on every call; the real service
// (`./language-service/`) is document-based. This class keeps PR #6's exact method signatures
// working by opening a temporary document on the real service for the duration of each call —
// so `TypeshadeLanguageService` is now a thin adapter, not a second implementation.

import {
  createTypeshadeLanguageService,
  type TypeshadeLanguageService as RealService,
} from './language-service/index.js';

/**
 * Zero-based editor position: `line` and `character` (a UTF-16 code unit offset) both start
 * at 0, following the Language Server Protocol convention. Monaco adapters add 1 to each of
 * these before displaying or accepting a position, since Monaco's own API is one-based.
 */
export interface TypeshadePosition {
  /** Zero-based line number. */
  readonly line: number;
  /** Zero-based UTF-16 character offset within the line. */
  readonly character: number;
}

/** A zero-based, half-open source range `[start, end)`, following the LSP convention. */
export interface TypeshadeRange {
  /** Inclusive start position of the range. */
  readonly start: TypeshadePosition;
  /** Exclusive end position of the range. */
  readonly end: TypeshadePosition;
}

/** UTF-16 source span used to map Typeshade information back into an editor. */
export interface TypeshadeTextSpan {
  /** UTF-16 offset where the span begins. */
  readonly start: number;
  /** Length of the span, in UTF-16 code units. */
  readonly length: number;
}

/**
 * Compiler diagnostic enriched with the source range and span that produced it.
 *
 * `span`/`range` come directly from the compiler's own `start`/`length` (see
 * `TsCompilerDiagnostic` in `src/compiler/ts/source-file.ts`), which already cover the
 * offending node — `node.getStart(sourceFile)` through `node.getEnd()` — or the file's first
 * statement when the diagnostic has no node behind it. Nothing here recomputes a
 * one-character span from `line`/`character` any more.
 */
export interface TypeshadeDiagnostic {
  /** Human-readable diagnostic message. */
  readonly message: string;
  /** Diagnostic severity. */
  readonly category: 'error' | 'warning' | 'message';
  /** Compiler-specific diagnostic code, when the diagnostic carries one. */
  readonly code?: string;
  /** Name of the source file the diagnostic was raised against. */
  readonly fileName: string;
  /** Zero-based half-open range the diagnostic covers. */
  readonly range: TypeshadeRange;
  /** UTF-16 offset span the diagnostic covers, equivalent to `range`. */
  readonly span: TypeshadeTextSpan;
}

/** Completion item exposed by the Typeshade language layer. */
export interface TypeshadeCompletionItem {
  /** Text shown for the completion item. */
  readonly label: string;
  /** Category used to pick an editor icon and grouping. */
  readonly kind: 'keyword' | 'type' | 'function' | 'attribute' | 'value';
  /** Short human-readable description shown alongside the label. */
  readonly detail: string;
  /** Snippet text to insert, when it differs from `label`. */
  readonly insertText?: string;
}

/** Hover documentation and source span returned by the language layer. */
export interface TypeshadeHover {
  /** Rendered hover content, one entry per section. */
  readonly contents: readonly string[];
  /** UTF-16 offset span the hover documents. */
  readonly span: TypeshadeTextSpan;
  /** Zero-based half-open range the hover documents, equivalent to `span`. */
  readonly range: TypeshadeRange;
}

/** Configuration for a Typeshade language-service instance. */
export interface TypeshadeLanguageServiceOptions {
  /** File name used when parsing source text; carries no filesystem meaning. */
  readonly fileName?: string;
}

/** Maps the real service's `TypeshadeSeverity` (which adds `'information'`/`'hint'`) onto PR
 * #6's three-way `category`, since nothing this shim's diagnostics table produces is a hint. */
function toLegacyCategory(
  severity: 'error' | 'warning' | 'information' | 'hint',
): 'error' | 'warning' | 'message' {
  if (severity === 'error' || severity === 'warning') return severity;
  return 'message';
}

function toLegacyCompletionKind(
  kind:
    | 'keyword'
    | 'type'
    | 'function'
    | 'attribute'
    | 'builtin'
    | 'variable'
    | 'field'
    | 'struct'
    | 'resource'
    | 'snippet',
): 'keyword' | 'type' | 'function' | 'attribute' | 'value' {
  if (kind === 'keyword' || kind === 'type' || kind === 'function' || kind === 'attribute')
    return kind;
  if (kind === 'snippet') return 'function';
  return 'value';
}

/** Provides Typeshade diagnostics, completion, hover, and position mapping for editor integrations. */
export class TypeshadeLanguageService {
  /** File name used when parsing source text; carries no filesystem meaning. */
  readonly fileName: string;

  #service: RealService;

  constructor(options: TypeshadeLanguageServiceOptions = {}) {
    this.fileName = options.fileName ?? 'typeshade-input.ts';
    this.#service = createTypeshadeLanguageService();
  }

  /** Opens `source` as a temporary document under `this.fileName`, runs `fn`, and closes it. */
  #withDocument<T>(source: string, fn: (uri: string) => T): T {
    const uri = this.fileName;
    this.#service.openDocument(uri, source);
    try {
      return fn(uri);
    } finally {
      this.#service.closeDocument(uri);
    }
  }

  /** Returns compiler diagnostics with zero-based ranges and UTF-16 spans suitable for editor markers. */
  getDiagnostics(source: string): readonly TypeshadeDiagnostic[] {
    return this.#withDocument(source, (uri) =>
      this.#service.getDiagnostics(uri).map((d) => ({
        message: d.message,
        category: toLegacyCategory(d.severity),
        code: typeof d.code === 'string' ? d.code : String(d.code),
        fileName: uri,
        range: d.range,
        span: d.span,
      })),
    );
  }

  /** Returns context-aware Typeshade completion items at a zero-based editor position. */
  getCompletions(source: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[] {
    return this.#withDocument(source, (uri) =>
      this.#service.getCompletions(uri, position).map((item) => ({
        label: item.label,
        kind: toLegacyCompletionKind(item.kind),
        detail: item.detail ?? '',
        ...(item.insertText ? { insertText: item.insertText } : {}),
      })),
    );
  }

  /** Returns hover documentation for known Typeshade types and attributes at a zero-based editor position. */
  getHover(source: string, position: TypeshadePosition): TypeshadeHover | undefined {
    return this.#withDocument(source, (uri) => {
      const hover = this.#service.getHover(uri, position);
      if (!hover) return undefined;
      const start = this.#service.offsetAt(uri, hover.range.start);
      const end = this.#service.offsetAt(uri, hover.range.end);
      return {
        contents: [hover.contents],
        span: { start, length: end - start },
        range: hover.range,
      };
    });
  }

  /** Converts a UTF-16 source offset into the zero-based position used by adapters; an offset past the end of the source clamps to the end. */
  getPosition(source: string, offset: number): TypeshadePosition {
    return this.#withDocument(source, (uri) => this.#service.positionAt(uri, offset));
  }

  /** Converts a zero-based editor position into a UTF-16 source offset; a position past the end of the source clamps to the end. */
  getOffset(source: string, position: TypeshadePosition): number {
    return this.#withDocument(source, (uri) => this.#service.offsetAt(uri, position));
  }
}
