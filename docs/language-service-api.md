# TypeShade Language Service — API draft

Status: **draft** for review. Written against `feat/language-service-core` (PR #6) plus the
zero-based coordinate change on this branch. Nothing here is frozen. The purpose is to fix the
shape of the layer that the Playground (Monaco) and a future Language Server (LSP, VS Code)
both consume, so the two never diverge.

Related: `docs/use-typeshade-surface.md` (the language), `docs/use-typeshade-plan.md` (compiler
phases, Phase 22 "Tooling"), typeshade/typeshade#8 (authoring ergonomics survey, item A13 on the
ambient `.d.ts`).

## 0. What exists on this branch

The string-based Stage 1 service from PR #6, with the coordinate change applied. This is the
starting point the rest of the document moves away from:

```ts
export interface TypeshadePosition {
  readonly line: number
  readonly character: number
} // zero-based
export interface TypeshadeRange {
  readonly start: TypeshadePosition
  readonly end: TypeshadePosition
} // half-open
export interface TypeshadeTextSpan {
  readonly start: number
  readonly length: number
} // UTF-16 offsets
export interface TypeshadeDiagnostic {
  readonly message: string
  readonly category: 'error' | 'warning' | 'message'
  readonly code?: string
  readonly fileName: string
  readonly range: TypeshadeRange // width 1 until the compiler reports an end position
  readonly span: TypeshadeTextSpan
}
export interface TypeshadeCompletionItem {
  label
  kind
  detail
  insertText?
}
export interface TypeshadeHover {
  readonly contents: readonly string[]
  readonly span: TypeshadeTextSpan
  readonly range: TypeshadeRange
}

export class TypeshadeLanguageService {
  constructor(options?: { fileName?: string })
  getDiagnostics(source: string): readonly TypeshadeDiagnostic[]
  getCompletions(source: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[]
  getHover(source: string, position: TypeshadePosition): TypeshadeHover | undefined
  getPosition(source: string, offset: number): TypeshadePosition
  getOffset(source: string, position: TypeshadePosition): number
}
```

Every conversion goes through the parsed `ts.SourceFile` (`getLineStarts`,
`getPositionOfLineAndCharacter`, `getLineAndCharacterOfPosition`) with clamping, so CRLF sources
and positions past the end of the file are handled. Completion and hover are still table-driven
(no TypeScript program yet); that is what §4 and §5 change.

## 1. Layering

```
Language Core            compiler/ts front-end: parse, directive, types, structs, bindings,
                         lowering, diagnostics with source positions; tables of the vocabulary
        ↓
Language Service         this document: editor-neutral, document-based, LSP-shaped API
        ↓
   ┌────┴─────┐
 Monaco     LSP          thin adapters: coordinate +1 for Monaco, JSON-RPC for LSP
   ↓          ↓
Playground  VS Code
```

Rules that follow from the picture:

- The service lives in the compiler repository (`typeshade/typeshade`) as its own entry point,
  because everything it needs (diagnostic positions, `SUPPORTED_TYPE_NAMES`, `WgslBuiltinName`,
  attribute grammar, diagnostic codes) is compiler-internal and changes together with the
  compiler. Target location `src/language-service/`, published as the package subpath
  `./language-service`.
- The service never imports a DOM or Node API. It takes text and positions and returns data.
  It may import `typescript` (it already does) and the compiler front-end. It must not import
  the emit backends except through the one method that produces compiled output on demand.
- Adapters do coordinate conversion, debouncing, marker ownership, JSON-RPC, and nothing
  semantic. If an adapter grows logic about TypeShade, that logic belongs in the service.
- The Language Server and the VS Code extension live in a separate repository
  (`typeshade/vscode-typeshade`, server and client together) and depend on the published
  package. They are not started until the package installs from npm (see §9).

## 2. Conventions

| Topic              | Convention                                                                    | Why                                                                                          |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Positions          | `{ line, character }`, both zero-based, `character` in UTF-16 code units      | LSP default (`positionEncoding: utf-16`); Monaco adds 1 on its side                          |
| Ranges             | `{ start, end }`, half-open, `end` exclusive                                  | LSP                                                                                          |
| Offsets            | UTF-16 code unit index into the document text                                 | matches `ts.SourceFile` positions, so no conversion layer between TypeScript and the service |
| Documents          | identified by a `uri` string; the service holds the text                      | needed for multi-file (`import`) and for incremental reuse                                   |
| Versions           | optional integer per document, monotonic                                      | lets adapters drop stale results                                                             |
| Diagnostics source | every diagnostic carries `source: 'typeshade'` or `'typescript'` and a `code` | adapters can separate the two, and the Playground can hide TypeScript false positives        |
| Line endings       | derived from the parsed `ts.SourceFile` line map, never by splitting on `\n`  | CRLF sources were off by one per line in the first version                                   |
| Markdown           | hover and completion documentation are Markdown strings                       | LSP `MarkupContent`, Monaco `IMarkdownString`                                                |

## 3. Types

The names mirror LSP so the LSP adapter is a field-for-field pass-through.

```ts
export interface TypeshadePosition {
  readonly line: number
  readonly character: number
}
export interface TypeshadeRange {
  readonly start: TypeshadePosition
  readonly end: TypeshadePosition
}
export interface TypeshadeTextSpan {
  readonly start: number
  readonly length: number
}
export interface TypeshadeLocation {
  readonly uri: string
  readonly range: TypeshadeRange
}
export interface TypeshadeTextEdit {
  readonly range: TypeshadeRange
  readonly newText: string
}

export type TypeshadeSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface TypeshadeDiagnostic {
  readonly uri: string
  readonly range: TypeshadeRange
  readonly span: TypeshadeTextSpan
  readonly severity: TypeshadeSeverity
  readonly message: string
  /** Stable code: TypeShade codes are `TS8xxx` strings from `compiler/ts/codes.ts`; TypeScript codes are numbers. */
  readonly code: string | number
  readonly source: 'typeshade' | 'typescript'
  readonly relatedInformation?: readonly { location: TypeshadeLocation; message: string }[]
}

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

export interface TypeshadeCompletionItem {
  readonly label: string
  readonly kind: TypeshadeCompletionKind
  readonly detail?: string
  readonly documentation?: string
  /** Plain text unless `insertTextFormat` is `'snippet'` (LSP snippet syntax, `$1`). */
  readonly insertText?: string
  readonly insertTextFormat?: 'plain' | 'snippet'
  readonly sortText?: string
  readonly filterText?: string
  /** When present, adapters apply this edit instead of inserting at the cursor. */
  readonly textEdit?: TypeshadeTextEdit
}

export interface TypeshadeHover {
  readonly contents: string
  readonly range: TypeshadeRange
}

export type TypeshadeSymbolKind =
  'function' | 'struct' | 'field' | 'resource' | 'constant' | 'variable' | 'parameter' | 'entry'

export interface TypeshadeDocumentSymbol {
  readonly name: string
  readonly kind: TypeshadeSymbolKind
  /** For entries: the stage. */
  readonly detail?: string
  readonly range: TypeshadeRange
  readonly selectionRange: TypeshadeRange
  readonly children?: readonly TypeshadeDocumentSymbol[]
}

export interface TypeshadeSignatureHelp {
  readonly signatures: readonly {
    readonly label: string
    readonly documentation?: string
    readonly parameters: readonly { label: string; documentation?: string }[]
  }[]
  readonly activeSignature: number
  readonly activeParameter: number
}

/** One token in the document's own order. Adapters encode to LSP deltas or Monaco's format. */
export interface TypeshadeSemanticToken {
  readonly line: number
  readonly character: number
  readonly length: number
  readonly type: TypeshadeSemanticTokenType
  readonly modifiers: readonly TypeshadeSemanticTokenModifier[]
}
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
export type TypeshadeSemanticTokenModifier =
  'declaration' | 'readonly' | 'entry' | 'gpu' | 'defaultLibrary'

export interface TypeshadeCompiledOutput {
  readonly target: 'wgsl' | 'glsl-vertex' | 'glsl-fragment'
  readonly text: string
  readonly diagnostics: readonly TypeshadeDiagnostic[]
}
```

## 4. The service

```ts
export interface TypeshadeLanguageServiceHost {
  /** Ambient declarations for the TypeShade globals (`f32`, `vec4`, `uniform<T>`, `@vertex`, ...). Defaults to the bundled `shade.d.ts`. */
  readonly ambientLib?: string
  /** Resolves a relative import from a document to another document uri, for multi-file units. Default: same directory, `.ts` appended. */
  readonly resolveImport?: (fromUri: string, specifier: string) => string | undefined
  /** Reads a document the adapter has not opened (an imported file). Return undefined when unknown. */
  readonly readDocument?: (uri: string) => string | undefined
}

export function createTypeshadeLanguageService(
  host?: TypeshadeLanguageServiceHost,
): TypeshadeLanguageService

export interface TypeshadeLanguageService {
  // Documents
  openDocument(uri: string, text: string, version?: number): void
  updateDocument(uri: string, text: string, version?: number): void
  closeDocument(uri: string): void

  // Stage 1
  getDiagnostics(uri: string): readonly TypeshadeDiagnostic[]
  getCompletions(uri: string, position: TypeshadePosition): readonly TypeshadeCompletionItem[]
  getHover(uri: string, position: TypeshadePosition): TypeshadeHover | undefined

  // Stage 2
  getDefinition(uri: string, position: TypeshadePosition): readonly TypeshadeLocation[]
  getReferences(
    uri: string,
    position: TypeshadePosition,
    options?: { includeDeclaration?: boolean },
  ): readonly TypeshadeLocation[]
  getDocumentSymbols(uri: string): readonly TypeshadeDocumentSymbol[]
  getSignatureHelp(uri: string, position: TypeshadePosition): TypeshadeSignatureHelp | undefined
  prepareRename(
    uri: string,
    position: TypeshadePosition,
  ): { range: TypeshadeRange; placeholder: string } | undefined
  rename(
    uri: string,
    position: TypeshadePosition,
    newName: string,
  ): Readonly<Record<string, readonly TypeshadeTextEdit[]>>
  getSemanticTokens(uri: string, range?: TypeshadeRange): readonly TypeshadeSemanticToken[]

  // Stage 3 (TypeShade-specific)
  /** Compiles on demand for an output pane. Never called per keystroke by the service itself. */
  getCompiledOutput(
    uri: string,
    target: TypeshadeCompiledOutput['target'],
  ): TypeshadeCompiledOutput | undefined

  // Conversions (the only place offsets and positions meet)
  positionAt(uri: string, offset: number): TypeshadePosition
  offsetAt(uri: string, position: TypeshadePosition): number
}
```

Migration from the PR #6 shape (`getDiagnostics(source)`, `getCompletions(source, position)`,
`getHover(source, position)`, `getPosition(source, offset)`): the string-based methods become a
one-shot convenience `analyze(text, fileName?)` that opens a temporary document, runs Stage 1
and closes it. The Playground moves to the document API in the same change that fixes its
loading bugs, because it needs `updateDocument` to stop re-parsing the whole file twice per
keystroke.

## 5. Where each answer comes from

The strategy's formula is _TypeScript Language Service + TypeShade semantic layer_. Concretely:

| Method                                                                               | TypeScript Language Service (over the ambient lib)                                    | TypeShade layer                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDiagnostics`                                                                     | syntax and semantic diagnostics, filtered (§6)                                        | `compileTsSource`-style analysis of the front-end only (no emit), with `range` from `node.getStart()`/`node.getEnd()`; stage-3 checks: builtin name allow-list (`WgslBuiltinName`), builtin-to-stage compatibility, `@compute` workgroup shape, missing return annotation as an error |
| `getCompletions`                                                                     | user symbols in scope (functions, struct fields, resources, locals), keywords         | context items: after `@` the attribute list, inside `@builtin("` the `WgslBuiltinName` list filtered by the enclosing stage, in a type position `SUPPORTED_TYPE_NAMES`, snippets for `vec2/3/4(...)`, entry function templates                                                        |
| `getHover`                                                                           | quick info for user symbols, with the TypeShade type name where TS would say `number` | documentation table for GPU types, attributes and builtins, shared with the site's reference pages; the emitted WGSL type for a struct field                                                                                                                                          |
| `getDefinition`, `getReferences`, `rename`, `getDocumentSymbols`, `getSignatureHelp` | TypeScript, unchanged                                                                 | symbol kinds re-labelled (`entry`, `resource`, `struct`) using the front-end's collected declarations                                                                                                                                                                                 |
| `getSemanticTokens`                                                                  | TypeScript classifications                                                            | GPU types as `type`+`gpu`, entries as `function`+`entry`, resources, builtin strings inside `@builtin(...)`                                                                                                                                                                           |
| `getCompiledOutput`                                                                  | none                                                                                  | `compileTsSource` / GLSL emit, on demand                                                                                                                                                                                                                                              |

The TypeScript program is built by a `ts.LanguageServiceHost` whose script snapshots are the
service's documents plus the ambient lib. `getScriptVersion` follows the document version, so
TypeScript reuses unchanged files. The TypeShade analysis runs on `program.getSourceFile(uri)`,
never on a second parse.

## 6. TypeScript diagnostics that the ambient lib cannot silence

Measured on the official `hello.shade.ts` sample under `strict: true` with the current
hand-written declarations (see the Playground audit): TS2304 (`builtin` not found), TS2564
(class fields without initializers), TS2349 (`@location(0)` collides with the DOM global
`Location`), TS1206 (decorators are not valid here, for function decorators). Policy:

- The bundled `shade.d.ts` declares the attributes as decorator factories and the GPU types as
  nominal branded types, so TS2304 and TS2349 disappear (the lib is compiled with `lib: []`
  so DOM globals never enter the program).
- The program is created with `strictPropertyInitialization: false` and
  `experimentalDecorators: true`; TS2564 disappears.
- TS1206 cannot be configured away for decorators on function declarations. The service drops
  it when the decorated node is a top-level exported function in a `"use typeshade"` file,
  because the TypeShade grammar defines that position. Any other filtered code is listed in
  one table in the source with the reason, and a test asserts the sample produces zero
  TypeScript diagnostics.

## 7. Adapter contracts

Monaco (Playground):

- `toMonaco(position) = { lineNumber: line + 1, column: character + 1 }`, and back. The only
  `+1` in the codebase lives in this adapter.
- One marker owner, `typeshade`, fed from `getDiagnostics` only. The built-in TypeScript
  worker's own diagnostics are turned off (`noSemanticValidation`, `noSyntaxValidation`), or
  the service's TypeScript diagnostics are shown and the worker's are not; never both.
- Debounce lives here (`onDidChangeModelContent` → `updateDocument` → `getDiagnostics`).
- The output pane calls `getCompiledOutput` after diagnostics report zero errors, or on an
  explicit button, so the compiler never runs twice per keystroke.
- The service runs in a web worker; the payload is the compiler plus `typescript` (about 1.2 MB
  gzipped today), which is acceptable off the main thread and unacceptable on it.

LSP (VS Code):

- Positions, ranges, diagnostics, completion items, hover, locations, text edits, symbols,
  signature help and semantic tokens map field for field; the server only encodes semantic
  tokens as deltas and rename results as a `WorkspaceEdit`.
- `textDocument/didOpen|didChange|didClose` map to the three document methods; full-text sync
  first, incremental later without an API change (the service receives the whole text either
  way).
- The server holds no TypeShade knowledge. Its size is a measure of drift.

## 8. Incrementality and performance

- One `ts.LanguageService` per service instance; documents are snapshots with versions.
- Diagnostics and symbols are computed per request and cached per `(uri, version)`.
- The front-end analysis must be separable from emit: today `compileTsSource` lowers and emits
  WGSL in one call. Phase 1 of the work adds an `analyzeTsSource` (or an option that skips
  emit) so `getDiagnostics` never produces shader text.
- Nothing in the service is asynchronous. Cancellation is the adapter's concern (drop results
  whose version is stale).

## 9. Packaging

- `package.json` `exports` gains `"./language-service": "./src/language-service/index.ts"` now,
  and the built `.js`/`.d.ts` once the package publishes a `dist/`.
- `typescript` moves from `devDependencies` to `dependencies` (or `peerDependencies` with a
  range); the service imports it at runtime.
- The ambient `shade.d.ts` ships in the package (`"types": ["typeshade/shade"]` for `tsc`
  users, and the same text loaded by the service), so the editor and the compiler agree on one
  vocabulary.
- Public exports are governed by `src/__api__/surface.md` and `api-doc-coverage.test.ts` like
  everything else.

## 10. Order of work

1. **Zero-based coordinates and `TypeshadeRange`** on PR #6 (this branch). Adapters add 1.
2. **Compiler positions**: `TsCompilerDiagnostic` gains `end` (or `span`), every `pushDiag`
   passes `node.getEnd()`, the `diag()` helpers in `lower/*.ts` require a `code`. The service's
   `span.length` stops being 1.
3. **Document store and TypeScript host**: `createTypeshadeLanguageService`, `open/update/
closeDocument`, the ambient `shade.d.ts`, `positionAt/offsetAt`, `analyze()` convenience.
   Stage 1 methods reimplemented on the TypeScript service plus the front-end.
4. **Stage 2** methods, all delegating to TypeScript with TypeShade re-labelling.
5. **Stage 3** checks in the compiler front-end (builtin allow-list, stage compatibility,
   workgroup shape, return annotation), surfaced as coded diagnostics.
6. **Packaging**: exports subpath, `typescript` dependency, `dist/`, npm publish.
7. **Monaco adapter** in the site, replacing the Playground's inline logic; the Playground pins
   the published package or the public subpath, never a deep path.
8. **`vscode-typeshade`** repository: LSP server (document sync, JSON-RPC, token encoding) and
   extension (client, TextMate grammar reused from the site's `typeshade-syntax.mjs`).

## 11. Open questions

- Package name for the published service (`typeshade`, `@typeshade/core`, or the current
  `@xgis/shader-dsl`); the two `0.0.0` placeholders on npm need an owner and a plan.
- Whether `.shade.ts` should be recognised by extension in editors before the file is parsed,
  or only by the `"use typeshade"` directive (the compiler uses the directive; the Vite plugin
  uses the extension).
- Multi-file: `compileTsSources` exists in two incompatible forms (`module.ts`, `sources.ts`);
  the document store needs the record form with structs and bindings collected across files.
- Bundle strategy for the browser: worker only, or also a lexical tier without `typescript`
  for the first paint.
