import ts from 'typescript'
import { compileTsSource, type TsCompilerDiagnostic } from './compiler/ts/source-file.js'

/** One-based editor position used by Typeshade editor adapters. */
export interface TypeshadePosition {
  readonly line: number
  readonly character: number
}

/** UTF-16 source span used to map Typeshade information back into an editor. */
export interface TypeshadeTextSpan {
  readonly start: number
  readonly length: number
}

/** Compiler diagnostic enriched with the source span that produced it. */
export interface TypeshadeDiagnostic extends TsCompilerDiagnostic {
  readonly start: number
  readonly length: number
}

/** Completion item exposed by the Typeshade language layer. */
export interface TypeshadeCompletionItem {
  readonly label: string
  readonly kind: 'keyword' | 'type' | 'function' | 'attribute' | 'value'
  readonly detail: string
  readonly insertText?: string
}

/** Hover documentation and source span returned by the language layer. */
export interface TypeshadeHover {
  readonly contents: readonly string[]
  readonly span: TypeshadeTextSpan
}

/** Configuration for a Typeshade language-service instance. */
export interface TypeshadeLanguageServiceOptions {
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

function offsetAt(source: string, position: TypeshadePosition): number {
  const lines = source.split(/\r?\n/)
  const line = Math.max(0, Math.min(position.line - 1, lines.length - 1))
  return lines.slice(0, line).reduce((sum, value) => sum + value.length + 1, 0) + Math.max(0, position.character - 1)
}

function positionAt(sourceFile: ts.SourceFile, offset: number): TypeshadePosition {
  const lc = ts.getLineAndCharacterOfPosition(sourceFile, Math.max(0, Math.min(offset, sourceFile.getFullText().length)))
  return { line: lc.line + 1, character: lc.character + 1 }
}

function spanForDiagnostic(sourceFile: ts.SourceFile, diagnostic: TsCompilerDiagnostic): TypeshadeTextSpan {
  const start = ts.getPositionOfLineAndCharacter(sourceFile, Math.max(0, diagnostic.line - 1), Math.max(0, diagnostic.character - 1))
  return { start, length: 1 }
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
  readonly fileName: string

  constructor(options: TypeshadeLanguageServiceOptions = {}) {
    this.fileName = options.fileName ?? 'typeshade-input.ts'
  }

  /** Returns compiler diagnostics with source offsets suitable for editor markers. */
  getDiagnostics(source: string): readonly TypeshadeDiagnostic[] {
    const result = compileTsSource(source, { fileName: this.fileName, requireDirective: true })
    return result.diagnostics.map((diagnostic) => ({ ...diagnostic, ...spanForDiagnostic(result.sourceFile, diagnostic) }))
  }

  /** Returns context-aware Typeshade completion items at an editor position. */
  getCompletions(source: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[] {
    const offset = offsetAt(source, position)
    const before = source.slice(0, offset)
    const attributeMatch = before.match(/@builtin\(\s*["']([^"']*)$/)
    if (attributeMatch) return BUILTINS.filter((item) => item.label.startsWith(attributeMatch[1]!))

    if (/@[A-Za-z]*$/.test(before)) return ATTRIBUTES
    if (/(?:^|[\s:(,])(?:v|ve|vec|u|i|f)[A-Za-z0-9_]*$/.test(before)) return [...TYPES, ...FUNCTIONS]
    return [...TYPES, ...ATTRIBUTES]
  }

  /** Returns hover documentation for known Typeshade types and attributes. */
  getHover(source: string, position: TypeshadePosition): TypeshadeHover | undefined {
    const offset = offsetAt(source, position)
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
    return description ? { contents: [description], span } : undefined
  }

  /** Converts a UTF-16 source offset into the one-based position used by adapters. */
  getPosition(source: string, offset: number): TypeshadePosition {
    const file = ts.createSourceFile(this.fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    return positionAt(file, offset)
  }
}
