# TypeShade Language Service: API draft

Status: **draft** for review. Written against `feat/language-service-core` (PR #6) plus the
zero-based coordinate change on this branch. Nothing here is frozen. The purpose is to fix the
shape of the layer that the Playground (Monaco) and a future Language Server (LSP, VS Code)
both consume, so the two never diverge.

Related: `docs/use-typeshade-surface.md` (the language), `docs/use-typeshade-plan.md` (compiler
phases, Phase 22 "Tooling"), typeshade/typeshade#8 (authoring ergonomics survey, item A13 on the
ambient `.d.ts`).

## 0. What PR #6 first shipped

This section describes the language service as PR #6 first shipped it, before the rebuild: a
string-based, table-driven Stage 1 service with no TypeScript program behind it. It is kept here
for the record. Sections 1 through 11 describe the service as it has been rebuilt on this branch.

The PR #6 shape below still exists today, as `src/language-service.ts`, a compatibility shim over
the rebuilt service (§4). Its exported names are unchanged from what PR #6 shipped:
`TypeshadePosition`, `TypeshadeRange`, `TypeshadeDiagnostic`, `TypeshadeCompletionItem`,
`TypeshadeHover`, and the `TypeshadeLanguageService` class with its `getDiagnostics`,
`getCompletions`, `getHover`, `getPosition`, and `getOffset` methods. What changed is the
implementation behind them: each call now opens a temporary document on
`createTypeshadeLanguageService`, runs the real service, and closes the document again, rather
than analyzing the source string itself. So the sketch below is still an accurate description of
this file's public surface, with two corrections: `TypeshadeDiagnostic.range` is no longer a
guessed width-1 span, and `TypeshadeCompletionItem` is written out with its actual field types
(a previous edit of this doc reflowed that block down to bare property names):

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
  readonly range: TypeshadeRange // from the compiler's own start/length, not width 1 anymore
  readonly span: TypeshadeTextSpan
}
export interface TypeshadeCompletionItem {
  readonly label: string
  readonly kind: 'keyword' | 'type' | 'function' | 'attribute' | 'value'
  readonly detail: string
  readonly insertText?: string
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
  /** Ambient declarations for the TypeShade globals (`f32`, `vec4`, `uniform<T>`, `@vertex`, ...). Defaults to the bundled `SHADE_DTS` string (§9: not yet a shipped `shade.d.ts` file). */
  readonly ambientLib?: string
  /** Resolves a relative import from a document to another document uri, for multi-file units.
   * Default: resolves the specifier's `./` and `../` segments against the containing uri's own
   * path, keeping that uri's scheme and authority (`file://`) or leading `/` intact; a `.js` or
   * `.mjs` specifier is rewritten to `.ts`, and a specifier with no extension at all gets `.ts`
   * appended (`host.ts`'s `joinPath`/`defaultResolveImport`). */
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
`getHover(source, position)`, `getPosition(source, offset)`): rather than adding a new one-shot
`analyze` method, the PR #6 class is kept as it was, in `src/language-service.ts`, as a
compatibility shim over `createTypeshadeLanguageService`. Each call opens a temporary document
under the class's own `fileName`, runs the real service, and closes the document again, all
under PR #6's original method names (§0). The Playground still has its own reason to move onto
the document API directly (`openDocument`/`updateDocument`/`closeDocument`) in the same change
that fixes its loading bugs, because it needs `updateDocument` to stop re-parsing the whole file
twice per keystroke; the shim exists for other PR #6 callers, not for the Playground.

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

Syntax errors are their own case, not part of the stage-3 checks above. `compileTsSource`,
`compileTsSources`, and `compile()` surface TypeScript's own parse errors (an unclosed
parenthesis, a missing brace) as TypeShade diagnostics carrying the code `SYNTAX` (`TS8030`), and
a file with one is not lowered or emitted at all, so `vec4(3.14` no longer produces WGSL the way
it once did. Inside the language service, `getDiagnostics` drops the compiler's `SYNTAX` copies:
the same errors already reach the editor from TypeScript's own syntactic diagnostics, under their
real `TS1005`-style codes, so a broken paren is never underlined twice.

The TypeScript program is built by a `ts.LanguageServiceHost` whose script snapshots are the
service's documents plus the ambient lib. `getScriptVersion` follows the document version, so
TypeScript reuses unchanged files. The TypeShade analysis runs on `program.getSourceFile(uri)`,
never on a second parse.

## 6. TypeScript diagnostics that the ambient lib cannot silence

Measured on the official `hello.shade.ts` sample under `strict: true` with the current
hand-written declarations (see the Playground audit): TS2304 (`builtin` not found), TS2564
(class fields without initializers), TS2349 (`@location(0)` collides with the DOM global
`Location`), TS1206 (decorators are not valid here, for function decorators). Policy:

- The bundled ambient lib (`SHADE_DTS`, §9) declares the attributes as decorator factories and
  the GPU types as nominal branded types, so TS2304 and TS2349 disappear (the lib is compiled
  with `lib: []` so DOM globals never enter the program).
- The program is created with `strictPropertyInitialization: false` and
  `experimentalDecorators: true`; TS2564 disappears.
- TS1206 cannot be configured away for decorators on function declarations. The service drops
  it when the decorated node is a top-level function (exported or not) in a `"use typeshade"`
  file, because the TypeShade grammar defines that position. Any other filtered code is listed
  in one table in the source with the reason, and a test asserts the sample produces zero
  TypeScript diagnostics.
- GPU scalars (`f32`, `i32`, `u32`, `f64`) are nominal too, but the brand property that keeps
  them apart is optional, not required (`ambient.ts`'s `scalarBrands`). A required brand made a
  return value, a local, or a `dot`/`length` result typed `number` fail to satisfy an
  `f32`-typed position on every ordinary program, since nothing in the authoring surface ever
  hands back a value that already carries the brand. An optional brand keeps `f32`/`i32`/`u32`/
  `f64` distinct from vector and struct types and from a bare `number` in the parameter
  positions the compiler cares about, while still letting a plain `number` widen into any of
  them; what it does not do is keep the scalar types distinct from each other, so a `u32` value
  is structurally assignable where an `f32` is expected. That mirrors the tradeoff this section
  already makes for swizzles, a false negative in the editor over a false positive on valid
  code, and the compiler's own type checks still catch the scalar mixing that TypeScript's
  structural check lets through.

Two more gaps the ambient lib cannot close by itself, because both are about names the lib was
never going to declare: a misspelled attribute (`@vertx`) has no ambient declaration to resolve
against, so TypeScript says nothing about it at all, and the compiler's own `checkAttributeName`
(`builtin-check.ts`, called from both `structs.ts`'s field decorators and the entry function's
own decorator checks) reports it as `ATTRIBUTE_NAME` with a "Did you mean ...?" edit-distance
suggestion. Likewise, a struct field used as entry-point input or output with neither
`@builtin(...)` nor `@location(...)` type-checks fine as ordinary TypeScript, since it is just an
unattributed property, but WGSL rejects it; `structs.ts`'s field collection feeds the entry
function's own check, which reports it as `STRUCT_FIELD_MISSING_ATTR` before it ever reaches the
backend as invalid emitted WGSL.

TypeShade's own diagnostic codes added since this document's first draft (`compiler/ts/codes.ts`;
each meaning copied from that file's own comment):

| Code     | Name                       | Meaning                                                                                                                                                                                                                          |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TS8017` | `SWITCH_CASE`               | Invalid `switch` case: not a numeric literal, or a fall-through case body.                                                                                                                                                       |
| `TS8018` | `ASSIGN_TARGET`             | An assignment or `++`/`--` target that is not a writable name (not an identifier, unknown, or a non-writable parameter). Assigning to a known immutable binding is `CONST_ASSIGN` instead.                                      |
| `TS8019` | `ARITY_MISMATCH`            | Wrong number of arguments, elements, or fields at a call or constructor site.                                                                                                                                                    |
| `TS8020` | `FUNCTION_SHAPE`            | A function declaration or parameter shape TypeShade does not support (missing name or body, optional/rest/destructured parameter).                                                                                              |
| `TS8021` | `RETURN_SHAPE`              | A `return` shape problem: bare `return` where a value is required, or a function with no return type annotation.                                                                                                                |
| `TS8022` | `UNKNOWN_NAME`              | Reference to a name TypeShade cannot resolve (identifier, struct field, or struct shape) that is not a function call (`UNKNOWN_FN`) or a type name (`UNKNOWN_TYPE`).                                                             |
| `TS8023` | `DUPLICATE_SYMBOL`          | The same function or binding name declared twice in one scope.                                                                                                                                                                   |
| `TS8024` | `BUILTIN_NAME`              | `@builtin("...")` names an id outside WGSL's builtin vocabulary (`WgslBuiltinName` in `core/sot.ts`).                                                                                                                            |
| `TS8025` | `BUILTIN_STAGE`             | A `@builtin(...)` id used as the wrong stage's input or output, e.g. `frag_depth` on a vertex return, or `front_facing` on a vertex parameter.                                                                                   |
| `TS8026` | `WORKGROUP_SHAPE`           | `@compute([x, y, z])` with `y` or `z` other than `1`: the backend only carries the first workgroup axis today, so a shape it would silently drop is rejected instead.                                                           |
| `TS8027` | `MAT_UNSUPPORTED`           | `mat2`/`mat3`: not implemented (only `mat4`/`mat4x4` maps to a real WGSL type), so authoring one is rejected instead of silently widening to `mat4x4`.                                                                           |
| `TS8028` | `ATTRIBUTE_NAME`            | A decorator identifier outside the attribute vocabulary `"use typeshade"` defines (`@vertex`, `@fragment`, `@compute`, `@builtin`, `@location`), e.g. a misspelled `@vertx`: without this, the decorated function or field just silently stops being an entry point or an I/O field. |
| `TS8029` | `STRUCT_FIELD_MISSING_ATTR` | A field of a struct used as an entry function's parameter or return type carries neither `@builtin(...)` nor `@location(...)`: WGSL rejects an entry-IO struct member with no attribute, so this is caught at the front end instead of reaching the backend as invalid emitted WGSL. |
| `TS8030` | `SYNTAX`                    | A TypeScript parse error (an unclosed parenthesis, a missing brace, an unexpected token) in a `"use typeshade"` file, carried through as a TypeShade diagnostic so a `compile()` caller sees it without running `tsc`. The language service drops these in favour of TypeScript's own syntactic diagnostics, which carry the real `TS1005`-style code. |
| `TS8099` | `UNSUPPORTED`               | Catch-all for a diagnostic whose site does not yet deserve its own code; the one code that is not assigned sequentially, so it stays parked past the sequential range instead of at its head.                                    |

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
- Diagnostics are computed per request and cached per `(uri, version)` (`service.ts`'s
  `diagnosticsCache`); a second call for the same document version returns the cached list
  instead of re-running the TypeScript and TypeShade analyses. `getDocumentSymbols` and
  `getSemanticTokens` are not cached: each call re-runs the front end against the document's
  current `ts.SourceFile`, even when nothing has changed since the previous call. Caching those
  two the same way is a follow-up (§10).
- The front-end analysis is separable from emit: `compileTsSource` takes an `emit: false`
  option that still parses, analyzes, and lowers to IR but skips `packModule`/WGSL emission, and
  `getDiagnostics` passes it, so diagnostics never produce shader text.
- Nothing in the service is asynchronous. Cancellation is the adapter's concern (drop results
  whose version is stale).

## 9. Packaging

- `package.json` `exports` has the `"./language-service": "./src/language-service/index.ts"`
  subpath, and it now has built `.js`/`.d.ts` behind it: `tsc --build` emits
  `dist/src/language-service/index.js` + `.d.ts`, and the manifest inside the npm tarball —
  derived from this same `exports` map by `scripts/publish-manifest.ts` — points the subpath
  there. In the repository and for a submodule consumer the subpath still resolves to source.
- `typescript` is a `peerDependencies` entry (`>=5.0.0`), marked optional in
  `peerDependenciesMeta` rather than a plain `dependencies` entry: a consumer that never touches
  `./language-service` installs nothing extra, and one that does supplies its own `typescript`.
  `AGENTS.md`'s "no runtime dependencies" line is true of the package's core subpaths only now;
  `./language-service` is the one exception.
- Deferred: there is still no `shade.d.ts` file in the package, and no `"types"` entry pointing
  at one. The ambient declarations exist only as the `SHADE_DTS` string exported from
  `./language-service` (`ambient.ts`), which the service loads itself as a virtual library file.
  A `tsc` user authoring `.shade.ts` files outside the service (the Vite plugin, a bare
  `tsconfig`) has no bundled `.d.ts` to point `"types"` at yet.
- Public exports are governed by `src/__api__/surface.md` and `api-doc-coverage.test.ts` like
  everything else.

## 10. Order of work

1. **Done: zero-based coordinates and `TypeshadeRange`** on PR #6. Adapters add 1.
2. **Done: compiler positions.** `TsCompilerDiagnostic` gained `start`/`length`/`endLine`/
   `endCharacter`, every `makeDiagnostic` call requires a `code`. The service's `span`/`range`
   come straight from these instead of a guessed width of 1.
3. **Done: document store and TypeScript host.** `createTypeshadeLanguageService`,
   `open/update/closeDocument`, the ambient lib (still only the `SHADE_DTS` string, not a
   shipped `shade.d.ts` file, see §9), `positionAt`/`offsetAt`. Stage 1 methods reimplemented on
   the TypeScript service plus the front end; the PR #6 class survives as the
   `src/language-service.ts` compatibility shim (§0, §4) rather than the `analyze()`
   convenience once planned here.
4. **Done: Stage 2** methods, delegating to TypeScript with TypeShade re-labelling.
5. **Done: Stage 3** checks in the compiler front end: builtin allow-list, stage compatibility,
   workgroup shape, return annotation, plus two added during the review pass that also landed
   on this branch, a misspelled attribute (`ATTRIBUTE_NAME`) and a struct field missing
   `@builtin`/`@location` (`STRUCT_FIELD_MISSING_ATTR`); all surfaced as coded diagnostics (§6).
6. **Partly done: packaging.** The `./language-service` exports subpath and the `typescript`
   peer dependency have landed (§9). Still missing: a built `dist/`, an npm publish, and a
   shipped `shade.d.ts` file with a `"types"` entry.
7. **Not started: Monaco adapter** in the site, replacing the Playground's inline logic; the
   Playground pins the published package or the public subpath, never a deep path.
8. **Not started: LSP adapter and the `vscode-typeshade`** repository, server (document sync,
   JSON-RPC, token encoding) and extension (client, TextMate grammar reused from the site's
   `typeshade-syntax.mjs`).
9. **Not started: MCP adapter.** The same "adapters convert, the service decides" rule as §1
   applies here too; nothing in this repository or a sibling one implements it yet.
10. **Not started: caching for `getDocumentSymbols` and `getSemanticTokens`** (§8). Both re-run
    the front end on every call today; only `getDiagnostics` is cached.
11. **Not started: minor findings from the review pass** that landed the fixes in items 3, 4
    and 5 above. `rename` will rewrite the `"use typeshade"` directive itself if it is the
    token under the cursor; the diagnostics cache is not invalidated when an imported document
    changes, only when the importing document itself does; completion triggers fire inside
    comments and string literals; `getCompiledOutput` swallows an emit exception into an empty
    output string instead of reporting it as a diagnostic; and `nodeAtPosition` is duplicated
    across `navigation.ts`, `diagnostics.ts`, `hover.ts`, and `completions.ts` instead of
    shared from one place.

## 11. Open questions

- ~~Package name for the published service~~ — decided: the package publishes as the unscoped
  `typeshade`. Both npm placeholders (`typeshade` and `@typeshade/core`, reserved 2026-09-07 at
  `0.0.0`) belong to the project owner; `@typeshade/core` stays reserved for a later split and
  nothing is published to it.
- Whether `.shade.ts` should be recognised by extension in editors before the file is parsed,
  or only by the `"use typeshade"` directive (the compiler uses the directive; the Vite plugin
  uses the extension).
- Multi-file: `compileTsSources` exists in two incompatible forms (`module.ts`, `sources.ts`);
  the document store needs the record form with structs and bindings collected across files.
- Bundle strategy for the browser: worker only, or also a lexical tier without `typescript`
  for the first paint.
