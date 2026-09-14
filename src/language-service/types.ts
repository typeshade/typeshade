// === Language service types (design doc §3) ===
//
// The names mirror LSP so an LSP adapter is a field-for-field pass-through, and Monaco's own
// one-based coordinates are a `+1` the Monaco adapter applies at its own boundary — nothing
// in this package or its types is one-based.

/** A zero-based editor position: `line` and `character` (a UTF-16 code unit offset) both start
 * at 0, following the Language Server Protocol convention. A Monaco adapter adds 1 to each of
 * these before displaying or accepting a position, since Monaco's own API is one-based. */
export interface TypeshadePosition {
  /** Zero-based line number. */
  readonly line: number
  /** Zero-based UTF-16 character offset within the line. */
  readonly character: number
}

/** A zero-based, half-open source range `[start, end)`, following the LSP convention. */
export interface TypeshadeRange {
  /** Inclusive start position of the range. */
  readonly start: TypeshadePosition
  /** Exclusive end position of the range. */
  readonly end: TypeshadePosition
}

/** UTF-16 source span used to map TypeShade information back into an editor. */
export interface TypeshadeTextSpan {
  /** UTF-16 offset where the span begins. */
  readonly start: number
  /** Length of the span, in UTF-16 code units. */
  readonly length: number
}

/** A range inside one specific document, identified by its `uri`. */
export interface TypeshadeLocation {
  /** The document the range is in. */
  readonly uri: string
  /** The range within that document. */
  readonly range: TypeshadeRange
}

/** A single text replacement within one document. */
export interface TypeshadeTextEdit {
  /** The range being replaced. */
  readonly range: TypeshadeRange
  /** The text that replaces it. */
  readonly newText: string
}

/** Diagnostic severity, following the LSP vocabulary. */
export type TypeshadeSeverity = 'error' | 'warning' | 'information' | 'hint'

/**
 * A diagnostic from either half of the pipeline: the TypeScript compiler analyzing the
 * document as ordinary TypeScript over the ambient lib, or the TypeShade front end analyzing
 * it as a shader. `source` tells the two apart so an adapter can separate them, and the
 * Playground can hide a TypeScript false positive without hiding a TypeShade one.
 */
export interface TypeshadeDiagnostic {
  /** The document this diagnostic was raised against. */
  readonly uri: string
  /** Zero-based half-open range the diagnostic covers. */
  readonly range: TypeshadeRange
  /** UTF-16 offset span the diagnostic covers, equivalent to `range`. */
  readonly span: TypeshadeTextSpan
  /** Diagnostic severity. */
  readonly severity: TypeshadeSeverity
  /** Human-readable diagnostic message. */
  readonly message: string
  /** A TypeShade diagnostic carries one of the `TS8xxx` strings from `compiler/ts/codes.ts`; a TypeScript diagnostic carries its numeric code. */
  readonly code: string | number
  /** Which half of the pipeline raised this diagnostic. */
  readonly source: 'typeshade' | 'typescript'
  /** Secondary locations relevant to the diagnostic, when it has any. */
  readonly relatedInformation?: readonly { location: TypeshadeLocation; message: string }[]
}

/** The editor icon/category a completion item is grouped and rendered under. */
export type TypeshadeCompletionKind =
  | 'keyword'
  | 'type'
  | 'function'
  | 'attribute'
  | 'builtin'
  | 'variable'
  | 'field'
  | 'struct'
  | 'resource'
  | 'snippet'

/** One item offered at a completion request. */
export interface TypeshadeCompletionItem {
  /** Text shown for the completion item. */
  readonly label: string
  /** Category used to pick an editor icon and grouping. */
  readonly kind: TypeshadeCompletionKind
  /** Short human-readable description shown alongside the label. */
  readonly detail?: string
  /** Markdown documentation shown when the item is highlighted. */
  readonly documentation?: string
  /** Plain text unless `insertTextFormat` is `'snippet'` (LSP snippet syntax, `$1`). */
  readonly insertText?: string
  /** Whether `insertText` is plain text or an LSP snippet. Defaults to `'plain'`. */
  readonly insertTextFormat?: 'plain' | 'snippet'
  /** Overrides `label` for sorting, when the natural sort order is wrong. */
  readonly sortText?: string
  /** Overrides `label` for prefix filtering, when the natural filter text is wrong. */
  readonly filterText?: string
  /** When present, adapters apply this edit instead of inserting at the cursor. */
  readonly textEdit?: TypeshadeTextEdit
}

/** Hover documentation for the symbol or token under the cursor. */
export interface TypeshadeHover {
  /** Rendered hover content, as one Markdown string. */
  readonly contents: string
  /** The range the hover documents. */
  readonly range: TypeshadeRange
}

/** The re-labelled symbol kind TypeShade reports for a document symbol, distinct from
 * TypeScript's own `ScriptElementKind` so an entry point or a GPU resource reads as what it
 * is rather than as a generic function or variable. */
export type TypeshadeSymbolKind =
  'function' | 'struct' | 'field' | 'resource' | 'constant' | 'variable' | 'parameter' | 'entry'

/** One entry in a document's outline. */
export interface TypeshadeDocumentSymbol {
  /** The symbol's name. */
  readonly name: string
  /** The symbol's re-labelled kind. */
  readonly kind: TypeshadeSymbolKind
  /** For an entry point: the pipeline stage (`'vertex'`, `'fragment'`, `'compute'`). */
  readonly detail?: string
  /** The full range of the declaration, including its body. */
  readonly range: TypeshadeRange
  /** The range of just the symbol's name, for the editor to reveal or select. */
  readonly selectionRange: TypeshadeRange
  /** Nested symbols, such as a struct's fields or a function's parameters. */
  readonly children?: readonly TypeshadeDocumentSymbol[]
}

/** Signature help for a call expression, following one signature and one active parameter. */
export interface TypeshadeSignatureHelp {
  /** Every overload available at the call site. */
  readonly signatures: readonly {
    /** The signature rendered as source text. */
    readonly label: string
    /** Markdown documentation for the signature as a whole. */
    readonly documentation?: string
    /** Each parameter's own label and documentation. */
    readonly parameters: readonly { label: string; documentation?: string }[]
  }[]
  /** Index into `signatures` of the overload currently selected. */
  readonly activeSignature: number
  /** Index of the parameter the cursor is currently inside. */
  readonly activeParameter: number
}

/** One token in the document's own order. Adapters encode this to LSP semantic-token deltas
 * or to Monaco's own token format; this shape commits to neither. */
export interface TypeshadeSemanticToken {
  /** Zero-based line the token starts on. */
  readonly line: number
  /** Zero-based UTF-16 character the token starts at. */
  readonly character: number
  /** Length of the token, in UTF-16 code units. */
  readonly length: number
  /** The token's semantic type. */
  readonly type: TypeshadeSemanticTokenType
  /** Modifiers that apply to this token. */
  readonly modifiers: readonly TypeshadeSemanticTokenModifier[]
}

/** The semantic-token type vocabulary a `TypeshadeSemanticToken` classifies into. */
export type TypeshadeSemanticTokenType =
  | 'type'
  | 'struct'
  | 'function'
  | 'parameter'
  | 'variable'
  | 'property'
  | 'decorator'
  | 'keyword'
  | 'number'
  | 'string'
  | 'operator'
  | 'builtin'
  | 'resource'

/** The semantic-token modifier vocabulary a `TypeshadeSemanticToken` may combine. */
export type TypeshadeSemanticTokenModifier =
  'declaration' | 'readonly' | 'entry' | 'gpu' | 'defaultLibrary'

/** The result of compiling a document to one shader target on demand. */
export interface TypeshadeCompiledOutput {
  /** The target the text was compiled for. */
  readonly target: 'wgsl' | 'glsl-vertex' | 'glsl-fragment'
  /** The compiled source text. */
  readonly text: string
  /** Diagnostics raised while compiling, if any. */
  readonly diagnostics: readonly TypeshadeDiagnostic[]
}
