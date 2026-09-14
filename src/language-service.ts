import ts from 'typescript'
import { compileTsSource, type TsCompilerDiagnostic } from './compiler/ts/source-file.js'

/**
 * Zero-based editor position: `line` and `character` (a UTF-16 code unit offset) both start
 * at 0, following the Language Server Protocol convention. Monaco adapters add 1 to each of
 * these before displaying or accepting a position, since Monaco's own API is one-based.
 */
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

/** UTF-16 source span used to map Typeshade information back into an editor. */
export interface TypeshadeTextSpan {
  /** UTF-16 offset where the span begins. */
  readonly start: number
  /** Length of the span, in UTF-16 code units. */
  readonly length: number
}

/**
 * Compiler diagnostic enriched with the source range and span that produced it.
 *
 * The compiler (`pushDiag` in `src/compiler/ts/type-map.ts`) reports its own `line`/`character`
 * as one-based values, built as `getLineAndCharacterOfPosition(...) + 1`. `range.start` is
 * derived from those one-based fields with
 * `ts.getPositionOfLineAndCharacter(sourceFile, line - 1, character - 1)`, clamped to the
 * file's line starts because that TypeScript helper throws on an out-of-range line or
 * character. The compiler does not yet report an end position for a diagnostic, so `span.length`
 * — and therefore the width of `range` — stays 1 for now.
 */
export interface TypeshadeDiagnostic {
  /** Human-readable diagnostic message. */
  readonly message: string
  /** Diagnostic severity. */
  readonly category: 'error' | 'warning' | 'message'
  /** Compiler-specific diagnostic code, when the diagnostic carries one. */
  readonly code?: string
  /** Name of the source file the diagnostic was raised against. */
  readonly fileName: string
  /** Zero-based half-open range the diagnostic covers. */
  readonly range: TypeshadeRange
  /** UTF-16 offset span the diagnostic covers, equivalent to `range`. */
  readonly span: TypeshadeTextSpan
}

/** Completion item exposed by the Typeshade language layer. */
export interface TypeshadeCompletionItem {
  /** Text shown for the completion item. */
  readonly label: string
  /** Category used to pick an editor icon and grouping. */
  readonly kind: 'keyword' | 'type' | 'function' | 'attribute' | 'value'
  /** Short human-readable description shown alongside the label. */
  readonly detail: string
  /** Snippet text to insert, when it differs from `label`. */
  readonly insertText?: string
}

/** Hover documentation and source span returned by the language layer. */
export interface TypeshadeHover {
  /** Rendered hover content, one entry per section. */
  readonly contents: readonly string[]
  /** UTF-16 offset span the hover documents. */
  readonly span: TypeshadeTextSpan
  /** Zero-based half-open range the hover documents, equivalent to `span`. */
  readonly range: TypeshadeRange
}

/** Configuration for a Typeshade language-service instance. */
export interface TypeshadeLanguageServiceOptions {
  /** File name used when parsing source text; carries no filesystem meaning. */
  readonly fileName?: string
}

const TYPES: readonly TypeshadeCompletionItem[] = [
  { label: 'vec2', kind: 'type', detail: 'TypeShade vector type' },
  { label: 'vec3', kind: 'type', detail: 'TypeShade vector type' },
  { label: 'vec4', kind: 'type', detail: 'TypeShade vector type' },
  { label: 'u32', kind: 'type', detail: '32-bit unsigned integer' },
  { label: 'i32', kind: 'type', detail: '32-bit signed integer' },
  { label: 'f32', kind: 'type', detail: '32-bit floating-point value' },
]

const ATTRIBUTES: readonly TypeshadeCompletionItem[] = [
  { label: '@builtin', kind: 'attribute', detail: 'Declare a WebGPU builtin binding' },
  { label: '@location', kind: 'attribute', detail: 'Declare a numeric shader location' },
  { label: '@vertex', kind: 'attribute', detail: 'Mark a vertex entry point' },
  { label: '@fragment', kind: 'attribute', detail: 'Mark a fragment entry point' },
]

const BUILTINS: readonly TypeshadeCompletionItem[] = [
  { label: 'position', kind: 'value', detail: 'Builtin vertex position' },
  { label: 'vertex_index', kind: 'value', detail: 'Builtin vertex index' },
  { label: 'instance_index', kind: 'value', detail: 'Builtin instance index' },
  { label: 'front_facing', kind: 'value', detail: 'Builtin fragment front-facing flag' },
  { label: 'frag_depth', kind: 'value', detail: 'Builtin fragment depth' },
]

const FUNCTIONS: readonly TypeshadeCompletionItem[] = [
  { label: 'vec2', kind: 'function', detail: 'Construct a vec2 value', insertText: 'vec2($1, $2)' },
  { label: 'vec3', kind: 'function', detail: 'Construct a vec3 value', insertText: 'vec3($1, $2, $3)' },
  { label: 'vec4', kind: 'function', detail: 'Construct a vec4 value', insertText: 'vec4($1, $2, $3, $4)' },
]

function isLineBreak(code: number): boolean {
  return code === 10 /* \n */ || code === 13 /* \r */
}

/**
 * Clamps a zero-based line/character pair into the bounds of `sourceFile`: the line into
 * `[0, lineCount - 1]`, and the character into `[0, lineLength]` where `lineLength` excludes
 * the line's own terminator (so a CRLF or LF line ending is never treated as addressable
 * character content). Used so a caller-supplied position — including one derived from a
 * one-based compiler diagnostic — never reaches `ts.getPositionOfLineAndCharacter` out of range,
 * since that helper throws on a bad line or character.
 */
function clampPosition(sourceFile: ts.SourceFile, line: number, character: number): { line: number; character: number } {
  const lineStarts = sourceFile.getLineStarts()
  const lineCount = lineStarts.length
  const clampedLine = Math.max(0, Math.min(line, lineCount - 1))
  const lineStart = lineStarts[clampedLine]!
  const lineEndWithBreak = clampedLine + 1 < lineCount ? lineStarts[clampedLine + 1]! : sourceFile.text.length
  let lineEnd = lineEndWithBreak
  while (lineEnd > lineStart && isLineBreak(sourceFile.text.charCodeAt(lineEnd - 1))) lineEnd--
  const lineLength = lineEnd - lineStart
  const clampedCharacter = Math.max(0, Math.min(character, lineLength))
  return { line: clampedLine, character: clampedCharacter }
}

/** Converts a zero-based editor position into a UTF-16 source offset, using the parsed source file so CRLF and LF line endings are both handled correctly. */
function offsetAt(sourceFile: ts.SourceFile, position: TypeshadePosition): number {
  const clamped = clampPosition(sourceFile, position.line, position.character)
  return ts.getPositionOfLineAndCharacter(sourceFile, clamped.line, clamped.character)
}

/** Converts a UTF-16 source offset into a zero-based editor position, using the parsed source file. */
function positionAt(sourceFile: ts.SourceFile, offset: number): TypeshadePosition {
  const clampedOffset = Math.max(0, Math.min(offset, sourceFile.text.length))
  const lc = ts.getLineAndCharacterOfPosition(sourceFile, clampedOffset)
  return { line: lc.line, character: lc.character }
}

/**
 * Builds the UTF-16 offset span for a compiler diagnostic. `diagnostic.line`/`character` are
 * one-based (see `pushDiag` in `src/compiler/ts/type-map.ts`), so they are converted to the
 * zero-based line/character `ts.getPositionOfLineAndCharacter` expects, then clamped into the
 * file's bounds before that call, since the raw compiler values can be out of range.
 */
function spanForDiagnostic(sourceFile: ts.SourceFile, diagnostic: TsCompilerDiagnostic): TypeshadeTextSpan {
  const clamped = clampPosition(sourceFile, diagnostic.line - 1, diagnostic.character - 1)
  const start = ts.getPositionOfLineAndCharacter(sourceFile, clamped.line, clamped.character)
  return { start, length: 1 }
}

/** Converts a UTF-16 offset span into the equivalent zero-based half-open range. */
function rangeForSpan(sourceFile: ts.SourceFile, span: TypeshadeTextSpan): TypeshadeRange {
  return { start: positionAt(sourceFile, span.start), end: positionAt(sourceFile, span.start + span.length) }
}

function wordSpan(source: string, offset: number): TypeshadeTextSpan {
  let start = offset
  let end = offset
  while (start > 0 && /[A-Za-z0-9_@]/.test(source[start - 1]!)) start--
  while (end < source.length && /[A-Za-z0-9_@]/.test(source[end]!)) end++
  return { start, length: end - start }
}

/** Provides Typeshade diagnostics, completion, hover, and position mapping for editor integrations. */
export class TypeshadeLanguageService {
  /** File name used when parsing source text; carries no filesystem meaning. */
  readonly fileName: string

  constructor(options: TypeshadeLanguageServiceOptions = {}) {
    this.fileName = options.fileName ?? 'typeshade-input.ts'
  }

  /** Returns compiler diagnostics with zero-based ranges and UTF-16 spans suitable for editor markers. */
  getDiagnostics(source: string): readonly TypeshadeDiagnostic[] {
    const result = compileTsSource(source, { fileName: this.fileName, requireDirective: true })
    return result.diagnostics.map((diagnostic) => {
      const span = spanForDiagnostic(result.sourceFile, diagnostic)
      return {
        message: diagnostic.message,
        category: diagnostic.category,
        code: diagnostic.code,
        fileName: diagnostic.fileName,
        range: rangeForSpan(result.sourceFile, span),
        span,
      }
    })
  }

  /** Returns context-aware Typeshade completion items at a zero-based editor position. */
  getCompletions(source: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[] {
    const sourceFile = ts.createSourceFile(this.fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const offset = offsetAt(sourceFile, position)
    const before = source.slice(0, offset)
    const attributeMatch = before.match(/@builtin\(\s*["']([^"']*)$/)
    if (attributeMatch) return BUILTINS.filter((item) => item.label.startsWith(attributeMatch[1]!))

    if (/@[A-Za-z]*$/.test(before)) return ATTRIBUTES
    if (/(?:^|[\s:(,])(?:v|ve|vec|u|i|f)[A-Za-z0-9_]*$/.test(before)) return [...TYPES, ...FUNCTIONS]
    return [...TYPES, ...ATTRIBUTES]
  }

  /** Returns hover documentation for known Typeshade types and attributes at a zero-based editor position. */
  getHover(source: string, position: TypeshadePosition): TypeshadeHover | undefined {
    const sourceFile = ts.createSourceFile(this.fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const offset = offsetAt(sourceFile, position)
    const span = wordSpan(source, offset)
    const word = source.slice(span.start, span.start + span.length)
    const descriptions: Record<string, string> = {
      vec2: '`vec2` — two-component shader vector.',
      vec3: '`vec3` — three-component shader vector.',
      vec4: '`vec4` — four-component shader vector.',
      u32: '`u32` — 32-bit unsigned integer shader type.',
      i32: '`i32` — 32-bit signed integer shader type.',
      f32: '`f32` — 32-bit floating-point shader type.',
      '@builtin': '`@builtin` — maps a field or parameter to a WebGPU builtin.',
      '@location': '`@location` — maps a field to a numeric shader location.',
      '@vertex': '`@vertex` — marks a function as a vertex entry point.',
      '@fragment': '`@fragment` — marks a function as a fragment entry point.',
    }
    const description = descriptions[word]
    return description ? { contents: [description], span, range: rangeForSpan(sourceFile, span) } : undefined
  }

  /** Converts a UTF-16 source offset into the zero-based position used by adapters; an offset past the end of the source clamps to the end. */
  getPosition(source: string, offset: number): TypeshadePosition {
    const sourceFile = ts.createSourceFile(this.fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    return positionAt(sourceFile, offset)
  }

  /** Converts a zero-based editor position into a UTF-16 source offset; a position past the end of the source clamps to the end. */
  getOffset(source: string, position: TypeshadePosition): number {
    const sourceFile = ts.createSourceFile(this.fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    return offsetAt(sourceFile, position)
  }
}
