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

The merged list `getDiagnostics` returns is in document order: by span start, then span length,
then source. The two halves interleave by position, so an editor's problem list never jumps
backwards from a TypeShade row to an earlier TypeScript one.

The merged list reads one diagnostic per mistake (Rule 12.4). A mistake both halves see used to
be reported by both: `y = 2.` on a `const` as TypeScript's TS2588 and the compiler's `TS8005`,
`g(x)` one argument short as TS2554 and `TS8019`, `colr` as TS2304 and `TS8022`. A person reads
past the second sentence, and a coding agent fixes both. `mergeDiagnostics` drops a report by
two rules, and only ever an error that another error already covers:

- **The same mistake.** A TypeScript error and a compiler error that its table pairs by code
  (TS2304, TS2552, TS2448 and TS2454 with the unknown-name codes `TS8022`, `TS8004`, `TS8002`
  and `TS8012`; TS2339 and TS2551 with `TS8022` and `TS8035`; TS2353 and TS2561 with `TS8010`;
  TS2694 and TS2749 with `TS8002`; TS2349 with `TS8004`; TS2588 and TS2540 with `TS8005`;
  TS2554 with `TS8019`; TS2322 with `TS8003`; TS2345 and TS2769 with `TS8003`, `TS8019` and
  `TS8036`), where one span contains the other, are one mistake. TypeScript's span is widened
  to the whole call for a code about a call, since TypeScript reports a failed overload on the
  callee (`max`) and the compiler on the argument at fault (`w`). The compiler's report is
  kept, always: it is what `compile()` and the build report, it names the remedy in the
  surface's words (Rule 12.1), where TypeScript's spells a brand's internals, and it is already
  the authority on what combines (TS2365 above). That holds for a misspelled name too. The
  compiler names the fix itself, at every place a name is written: TypeShade's spelling of a
  GLSL or HLSL name first (`FOREIGN_NAMES`, #218; `fmod` is the `%` operator, where
  TypeScript's guess by letters would be `mod`, which floors), then the name of the same kind
  spelled like it, by TypeScript's own spelling rule with a swap of two letters as one edit
  ("Did you mean "clamp"?"), so TypeScript's TS2552 has nothing to add. TS2741, TS2739 and
  TS2740 are TS2322 reported under the reason, members the value lacks, and are read as
  TS2322 by the table and the filters of §6.
- **TypeScript's own knock-on.** When TypeScript fails to resolve a call (TS2769, TS2345,
  TS2554), it still types the call from a signature that did not match, and the place the
  value reaches reports again: `return max(v, w)` with a `vec2` `w` added a TS2322 on the
  `return`. A TypeScript error about a value that comes from such a call, directly or through
  a local declared with no type, goes. TypeScript's own failure is the test, never a compiler
  error inside the value, because the compiler refuses what TypeScript types correctly: a
  function imported from another shader file is `TS8004` to the single-file compiler (#187),
  and TypeScript's TS2322 about what it returns stands.

`typeshade check` reads the same merged list, and adds from `compile()` only what the service
cannot compute: the backends' `TS8015` and the opt-in `TS8053`. That check is exported from this
subpath as `checkDocuments(docs, options)`, and as `checkOpenDocument(service, doc, options)` for
a tool that keeps its own service and documents open across requests, such as the MCP server in
typeshade/vscode-typeshade; calling it, rather than assembling the list again, is what keeps two
tools from giving two answers about one file (Rule 12.7). `FOREIGN_NAMES`, the GLSL and HLSL
names the compiler's refusals translate (#218), is exported beside it.

A test whose subject is TypeScript's own view (the ambient lib, the filters of §6) reads the two
halves unmerged, through `createTypeshadeLanguageServiceWith(host, analyze, { merge: false })`.

| Method                                                                               | TypeScript Language Service (over the ambient lib)                                                                                      | TypeShade layer                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDiagnostics`                                                                     | syntax and semantic diagnostics, filtered (§6)                                                                                          | `compileTsSource`-style analysis of the front-end only (no emit), with `range` from `node.getStart()`/`node.getEnd()`; stage-3 checks: builtin name allow-list (`WgslBuiltinName`), builtin-to-stage compatibility, `@compute` workgroup shape, missing return annotation as an error     |
| `getCompletions`                                                                     | user symbols in scope (functions, struct fields, resources, locals), keywords                                                           | context items: after `@` the attribute list, inside `@builtin("` the `WgslBuiltinName` list filtered by the enclosing stage, in a type position `SUPPORTED_TYPE_NAMES`, snippets for `vec2/3/4(...)`, entry function templates                                                            |
| `getHover`                                                                           | quick info for a symbol this document does not declare (an imported one, a host-side one), and the documentation section of every hover | the COMPILER's type for every name the front end declared in this document, read off `CompileTsSourceResult.symbols`; documentation table for GPU types, attributes and builtins, shared with the site's reference pages; a resource binding's address space and `@group`/`@binding` slot |
| `getDefinition`, `getReferences`, `rename`, `getDocumentSymbols`, `getSignatureHelp` | TypeScript, unchanged                                                                                                                   | symbol kinds re-labelled (`entry`, `resource`, `struct`) using the front-end's collected declarations                                                                                                                                                                                     |
| `getSemanticTokens`                                                                  | TypeScript classifications                                                                                                              | GPU types as `type`+`gpu`, entries as `function`+`entry`, resources, builtin strings inside `@builtin(...)`                                                                                                                                                                               |
| `getCompiledOutput`                                                                  | none                                                                                                                                    | `compileTsSource` / GLSL emit, on demand                                                                                                                                                                                                                                                  |

The type in a hover's first line is the front end's, not TypeScript's. The ambient GPU scalars
brand `number` optionally (`number & { readonly [f32Tag]?: true }`), so a bare literal is
assignable to `f32` without being one, and TypeScript infers `number`: `let x = 1.` used to hover
as `let x: number` while the compiler lowered it as `f32`. The front end records every name it
declares with the `ShaderType` it gave it and the span of the declared identifier, and
`getHover` joins the two through `getDefinitionAtPosition`, so the same `let x: f32` shows at the
declaration and at every use, and two shadowing declarations of one name are told apart by the
span TypeScript resolved to. A function with no return annotation hovers as the type its body
returns (Rule 8.19), which is the one TypeScript infers too; it hovered as `void`, beside a TS8021
warning, before that rule.

A caret at the END of a name answers for that name, the rule TypeScript's own quick info
follows. The shared `nodeAtPosition` helper tests a half-open span, so one offset past `k` in
`let k = 1.` is the whitespace after it and the hover used to fall through to TypeScript —
`let k: number` where the compiler lowered an `f32`
([#56](https://github.com/typeshade/typeshade/issues/56)). `getHover` resolves through
`touchingNodeAtPosition` now: a position inside a token still belongs to that token, and only a
position that lands in no identifier looks at the one ending exactly there. The end of a name is
where an editor leaves the caret after typing it, so it is the position a reader is most often
at. `nodeAtPosition` itself is unchanged, for the callers written against its half-open rule.

The documentation under a builtin's signature comes from the ambient lib itself. `ambient.ts`
writes a JSDoc block above every declaration it generates, from three tables in `docs.ts`:
`FUNCTION_DOCS` for the free math functions, the five expansions, the scalar casts, the vector
constructors, `array`, `fill`, `uniform`, `storage` and `random`; `CONSTANT_DOCS` for `PI`, `TAU`
and the other language constants; `MATH_MEMBER_DOCS` for every member of `Math`. TypeScript's
quick info carries that block, so a hover on `mix`, `vec3`, `PI` or `Math.sin` shows one to three
sentences of semantics under the signature, and a completion item's detail carries the same text.
`docs.test.ts` asserts that every `declare function`, every declared constant and every `Math`
member in `SHADE_DTS` has a block, and that the key set of `FUNCTION_DOCS` equals the set of
declared function names, so a new builtin cannot land undocumented. The GPU types, the attributes
and the `@builtin` ids keep their lookup tables (`TYPE_DOCS`, `ATTRIBUTE_DOCS`, `BUILTIN_DOCS`),
since those names are not declarations TypeScript would carry a JSDoc for.

Three kinds of name keep TypeScript's quick info instead. One this document does not declare (an
imported symbol, a host-side declaration) is not in this document's table at all, since a span
means nothing without the file it indexes. One the front end could not lower is never recorded
either, so `for (let j = 0; ...)`, which the loop-induction check rejects, still hovers as
`let j: number`, and so does `let a = d * 2.` where `d: f64` and the multiplication was refused:
the front end's own diagnostic on the same line says why. And a data class name keeps
`class Vertex`, which already says what the compiler would. The documentation section of every
hover is TypeScript's too. A resource binding is the one place TypeShade adds a line of its own
under the type: its address space and `@group`/`@binding` slot, read off the front end's
collected bindings, not off TypeScript.

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
  is structurally assignable where an `f32` is expected. That is a false negative in the editor
  chosen over a false positive on valid code, and the compiler's own type checks still catch the
  scalar mixing that TypeScript's structural check lets through.
- A vector declares every swizzle the compiler takes, not only its components and the prefix
  swizzles: `v.yx`, `v.xx`, `v.zyx` and `c.bgra`, one to four picks of one family within its
  size, each typed by its length (`vec2` for two). Each vector type is an interface of its own
  with the members written out, which costs the checker nothing measurable; the same members
  generated by a mapped type over template-literal keys made a check about twice as slow. A
  native vector also takes an index, a constant or a value (`v[i]`), as WGSL does. A completion
  lists the components and the prefix swizzles only, since the whole set is 680 names on a
  `vec4` (`completions.ts`).
- An object literal typed as a class that declares methods (`let rng: Rng = { state: 1 }`) is a
  class's value, which is its fields (Rule 6.9); TypeScript's TS2741 "Property 'next' is
  missing" (TS2739 and TS2740 for more than one) is dropped when every member it finds missing
  is a method or an accessor, and kept for a missing field.
- A storage array is writable in the editor exactly as it is in the compiler: `ambient.ts`'s
  `array<T, N>` declares a plain `[index: number]: T`, not a `readonly` one. `out[idx] = value`
  is the shape every compute kernel ends with (`examples/compute-reduction-twin.shade.ts`), and
  the compiler lowers it to a storage store, so the `readonly` this type first carried made
  TS2542 ("Index signature in type 'array<f32, number>' only permits reading") a false positive
  on the Playground's own compute sample. The brand and `length` stay `readonly`: neither is
  assignable in the source language, so `out.length = 2` keeps its TS2540.

### Vector and matrix arithmetic (issue #21)

`v * s`, `a + b`, `c.rgb * 0.5`, `m * v` and `v *= 2.` are the arithmetic a shader is written in,
and TypeScript rejects all of it. The ambient lib brands `vec2`/`vec3`/`vec4`, the `f64` vectors
and the matrices with a required unique-symbol property, and that brand is exactly what keeps a
`vec3` from satisfying a `vec2`; a branded object type is also not a `number`, which is what the
arithmetic check demands. Un-branding the vector types would take every real vector check with
them, so the service filters these diagnostics instead, deciding from the type checker rather
than from the syntax: each rule resolves the operand's TypeScript type and drops the diagnostic
only when that type carries one of `GPU_BRAND_TAGS` (`vecTag`, `vec64Tag`, `matTag`), matched
structurally as the `__@<tag>@<id>` property the checker reports, never by type name.

| Code     | Why it fires                                                                                                                                                                                                                                                                                                                          | Dropped when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TS2362` | The left operand of an arithmetic operation is not `number` (`v * s`, `c.rgb * 0.5`, `v *= 2.`).                                                                                                                                                                                                                                      | The left operand's own type carries a vector or matrix brand. Per operand, not "either operand", so the string in `v * "x"` still reports through TS2363.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `TS2363` | The right operand is not `number` (`m * v`, `2. * v`).                                                                                                                                                                                                                                                                                | The right operand's own type carries a vector or matrix brand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TS2365` | The operator cannot be applied to the two types (`a + b` on two `vec3`).                                                                                                                                                                                                                                                              | The operator is `+ - * / %` or a compound form of one, and either operand of the operation the code SPANS carries a brand. The spanned operation, not the innermost one starting at the same offset: a left-nested product starts where the operation it sits in starts, so asking the inner one made `n * 3. + v` report while `v + n * 3.` and `(n * 3.) + v` did not. A TS2365 from any other operator is left alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `TS2322` | Arithmetic on a branded type is typed `number`, so the vector position it flows into (a return annotation, a local, a struct field, an assignment target) looks unassignable.                                                                                                                                                         | The target type carries a vector or matrix brand AND the value either carries one too or does vector or matrix arithmetic anywhere inside it (`normalize(a * 2.)` is already a `number` by the time the call is typed). `let n: f32 = v` keeps its TS2322: a scalar target is a `number` to TypeScript, so that mismatch is not the brand's doing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `TS2345` | The same `number` reaches a CALL: an argument position that wants a vector or matrix (`vec4(u.tint.rgb * k, u.tint.a)`, `normalize(v * s)`, `mix(a, b * 0.5, t)`, a user function's `f(v * s)`), or an inferred parameter a sibling argument already poisoned (`dot(a * 2., b)`, reported on the good `b`).                           | The argument does vector or matrix arithmetic anywhere inside it AND the SHAPE that arithmetic would have produced (a `vec3 * f32` produces a `vec3`; `m * c` produces the vector, not the matrix) is one the parameter at that index accepts. For an overloaded ambient constructor that matched no overload: when SOME overload accepts that shape there. Or: the parameter's type is one of the signature's own type parameters (`dot<T extends Numeric>`), the argument is branded, and another argument's arithmetic, of exactly this argument's shape, decided `T`. Either way every OTHER argument of the call has to fit its own position too, measured the same way, because TypeScript reports only the first argument that fails. Arithmetic is required either way, so `vec4(1., c.a)`, `f(1.)` and `f(x)` with `x: f32` still report.                                                                                                                                                                                                                                                                                                                                                                                              |
| `TS2769` | No overload matches this call: the same `number` at a call whose callee is OVERLOADED. TypeScript names the parameter only when a single candidate has the arity of the call, which is why the vector constructors report TS2345 and the math functions, whose overloads share one arity, report this instead (`mix(a, b * 0.5, t)`). | The call does vector or matrix arithmetic somewhere AND some ONE overload accepts every argument once that arithmetic's shape is put back, each argument measured against that overload's own parameter and every inferred position of it settling on one shape. Asking a whole signature rather than each index against the union of all overloads is what keeps `mix(c * 0.5, vo.uv, 0.5)` reported: a `vec2` is a shape some overload takes second, but no overload takes a `vec3` first and a `vec2` second. Arithmetic is required, which is what keeps `mix(vec3i, vec3i, i32)` reporting, a call the front end lowers and Tint then rejects. The rule reads BOTH spans this code arrives on: TypeScript reports an overload failure on the ARGUMENT only when the first argument is the one that failed, and on the CALLEE identifier when a later one is, so `max(a, b * 2.)` with two `vec3` lands on `max` with no argument to ask about. The callee path drops the per-argument guard and rests on the whole-signature test alone, which is enough: the same call with a `vec2` `b` fits no overload and keeps reporting. Without that path 30 valid vector calls reported, every one of them arithmetic outside the first argument. |
| `TS2339` | A member read on a vector whose brand arithmetic dropped: `(n * 2.).xy`, or `lit.x` after `const lit = albedo * d`, which TypeScript types `number`.                                                                                                                                                                                  | The object's own TypeScript type carries no brand, and the shape restored the way the rules above restore it (a name's included, below) is a vector. The front end checks every swizzle itself and names a bad one (`TS8022 .w out of range on vec3<f32>`), so a real mistake is reported once, by the compiler. A value TypeScript still types as a vector keeps its TS2339, and so does a matrix, which has no members.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

A dropped diagnostic is not an unreported mistake. The compiler front end's own `TYPE_MISMATCH`
(`TS8003`) is the authority on which shapes combine, so `vec3(1.) + vec2(1.)` is reported once,
by the compiler, where leaving TypeScript's TS2365 in place would underline it twice.
`diagnostics.test.ts` pins both halves: every arithmetic shape above produces no
TypeScript-sourced diagnostic, and `v * "x"`, `1 * "x"` and `let n: f32 = v` still do.

**A name keeps the shape its declaration lost.** `const lit = albedo * d` declares `lit` as the
`number` the arithmetic is typed, so by the time `lit` is used there is no arithmetic left to
recognize, and every use reported: TS2345 and TS2769 at a call, TS2322 at an assignment or a
return, TS2339 at a swizzle. The service now reads
the type the front end gave each name the file declares (`CompileTsSourceResult.symbols`, the
table hover answers from). A name declared with no type annotation, whose TypeScript type
carries no brand while the compiler's is a vector or a matrix, counts as the arithmetic its
declaration did, with the compiler's shape: each rule above treats `normalize(lit)`,
`dot(lit, n)`, `return lit` and `lit.x` as it treats the same expressions over `albedo * d`.
`const t = normalize(n * 2.)` loses the brand the same way, through the `number` its type
parameter settles on, and is answered the same way. A name the compiler types as a scalar
stays a scalar, so `cross(dot(a, b), a)` spelled through a local keeps its TS2345. The shape is
spelled from the compiler's type and compared with shapes read off the ambient brands;
`diagnostics.test.ts` measures the two spellings against each other for every vector and
matrix type there is arithmetic on.

The TS2345 rule is narrower than the TS2322 rule it mirrors in one way, and deliberately: a
branded argument that reached a branded parameter with no arithmetic anywhere in the call is NOT
dropped. TS2322's both-branded case is covered by the compiler's `TYPE_MISMATCH`, but the ambient
math functions had no equivalent argument check in the front end when this rule was written
(`dot(vec3, vec2)` produced no compiler diagnostic at all; it is the compiler's `TS8036` since
#57), so TypeScript was the only thing reporting it, and a `vec2` still fails a `vec4` parameter
(`ambient.test.ts` pins that).

Comparing SHAPES rather than asking "is there a brand here, and arithmetic somewhere in this
call" is what keeps that guarantee once the call DOES contain arithmetic, which is the shape
almost every real line has. `dot(a * 2., b)` with two `vec3` is a false positive and is dropped;
`dot(a * 2., b)` with a `vec2` `b` is a real size mismatch and keeps its TS2345, because `vec2`
is not the `vec3` the arithmetic would have inferred for `T`. The same question is put to the
arguments TypeScript never reached (it stops at the first argument that fails a signature), so
`cross(a * 2., b)` with a `vec2` `b` is not silenced by the false positive on its first argument.
One false negative is left and is not otherwise visible: an argument AFTER the one this rule
dropped, wrong in a way that is not a vector shape (a string, a scalar of the wrong kind), is
still hidden, since TypeScript never reported it in the first place. For a user function and the
vector constructors the front end's own argument check (`TS8003`, `TS8019`) says it anyway, and
for the math builtins the front end's `TS8036` does (#57, roadmap 0.2 item 9).

What stays open, measured by running the service over every `.shade.ts` file on
`feat/porting-twins` (the corpus in issue #43, which carries the gradient twin too, and whose copy
of `hello-uniform-struct.shade.ts` is the un-annotated form). The first measurement, over the 17
files that branch then had, was 58 diagnostics: the TS2345 rule cleared 12 and the TS2365
spanned-operation fix 2 more, which took `hello-uniform-struct.shade.ts` to zero and left 44, as
two causes. 28 of them came from a product assigned to an un-annotated local, where the local is
declared `number`, the brand is gone at the declaration, and every later use reports (TS2339 on a
swizzle of it, TS2345 where it is handed to a call, TS2322 where it is assigned back); no rule
here could help with that then, because by then there is no arithmetic left in the expression to
recognize, and `const col: vec3 = ...` restored the brand. The name rule above now answers it
from the compiler's own type for the local. The other 16 were the generic math
signatures' own shape, which is not a diagnostic to filter but a declaration to fix, and they are
what the `mix` and all-scalar overloads below are for. `main`'s own `examples/` gate was already
green before any of this, because #18 annotated the one local that failed it (`const rgb: vec3 =
...`); what these rules and declarations buy is the twins, which cannot take that workaround, and
the reason #18 needed it.

Re-measured on the same branch's 19 `.shade.ts` files today, the corpus reports 16 diagnostics
across 7 files before the math declarations changed and 0 across all 19 after. Every one of the 16
was TS2345 and every one was the math signatures' shape: the un-annotated-local cause is no longer
in this corpus at all, the twins having been written with the annotation. The 16 split into the
two shapes the declarations now carry. 11 were `mix<T extends Numeric>(a: T, b: T, t: T)`
demanding a vector for the `t` that WGSL and GLSL take as a scalar, which is the line every
gradient, hillshade, ocean, tunnel, starfield, julia and domain-warp twin is written in
(`mix(u.bottom.rgb, u.top.rgb, t)`). 5 were a number literal beside an `f32` in one of the other
generic math calls: `T extends Numeric` has a primitive constraint, which is exactly the condition
under which TypeScript keeps a literal argument's literal type as an inference candidate, so
`smoothstep(0.3, 0.55, h)` on an `f32` `h` settled `T` to `0.3` and reported the perfectly good
`0.55` against it, and `step(horizon, y)` on a `const horizon = 0.58` reported `y`. Those
literal-against-literal messages read as fallout from the `mix` calls they sit inside, and they
are not: `smoothstep(0.3, 0.55, h)` alone reports the same thing. `feat/gradient-twin`'s own 10
files went from 1 to 0 over the same change.

WHAT THE LIB DECLARES for these functions, which is the half of that measurement the numbers do
not show. Every free math name carries an all-scalar overload, `(a0: number, ...): number` at its
own arity, ahead of the generic `<T extends Numeric>` shape it had before; that overload is what
stops a literal argument settling `T` to its own literal type. `mix` carries vector-with-scalar
overloads on top of it, in two families: `mix(vecN<f32>, vecN<f32>, f32)` for N = 2, 3, 4, the one
vector-beside-scalar call in this vocabulary that both Tint and ANGLE's GLSL ES 3.00 translator
accept, and `mix(vecNf64, vecNf64, f32)` for the same three arities, the one vec64 form the fp64
pass lowers (`core/passes/fp64-lower.ts` refuses every other one itself, with "mix() on vec64
needs a scalar f32 interpolant"). The generic same-shape overload stays last and still carries
`mix(vecN, vecN, vecN)`, `mix(f32, f32, f32)` and the integer vectors; `dot`, `distance`,
`length`, `normalize` and `cross` keep their hand-written signatures and gain nothing.

The vector-beside-scalar shapes deliberately NOT declared are the ones a GPU compiler refuses, and
they stay undeclared so that TypeScript is the thing reporting them: `clamp(vecN, s, s)` (Tint: `no
matching call to 'clamp(vec3<f32>, f32, f32)'`), `min(vecN, s)`, `max(vecN, s)`, `pow(vecN, s)`,
`step(vecN, s)`, and `mix` on an `i32` or `u32` vector. The mirrored forms draw TypeScript's
TS2769 too, but do not depend on it: `mathResultType` keys a call's result on its FIRST argument,
so `min(s, vecN)`, `max(s, vecN)`, `step(s, vecN)` and `smoothstep(s, s, vecN)` are already the
front end's own `TS8003`.

Four shapes both GPU compilers refuse were silent in the editor until the front end's argument
check for the math builtins (#57, `TS8036`, roadmap 0.2 item 9), and nothing on the declaration
side could have closed them. `mix`'s blend factor is declared `t: number`, wider than the `f32`
WGSL and GLSL ES 3.00 require, and narrowing it to `f32` closes none of them, measured: the scalar
brands are optional (see the bullet above), so an `i32`, a `u32` and an `f64` are each assignable
to `f32` too. `mix(vec3, vec3, i32)` (Tint: `no matching call to 'mix(vec3<f32>, vec3<f32>,
i32)'`), the `u32` form, and the `f64` form therefore all passed TypeScript; so did a blend
factor whose vector brand the arithmetic already erased, `mix(a, b, c * 2.)` with a `vec2` `c`,
which types as `number`, matches the declared overload outright, and never reaches the TS2769
rule to be judged. The `i32`, `u32` and erased-vector forms are the compiler's `TS8036` now, which
the service reports like any compiler diagnostic; the `f64` form belongs to the fp64 pass and is
still caught only at emit, as `SD0041`. `ambient.test.ts` pins each.

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

| Code     | Name                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TS8017` | `SWITCH_CASE`               | Invalid `switch` case: a label that is not an integer constant, does not fit the selector, or repeats another; an empty clause with no body below it to share (a trailing one, or one above `default:`); or `continue` in a switch no loop encloses.                                                                                                                                                                                                                                                                           |
| `TS8018` | `ASSIGN_TARGET`             | An assignment or `++`/`--` target that is not a writable name (not an identifier, unknown, or a non-writable parameter). Assigning to a known immutable binding is `CONST_ASSIGN` instead.                                                                                                                                                                                                                                                                                                                                     |
| `TS8019` | `ARITY_MISMATCH`            | Wrong number of arguments, elements, or fields at a call or constructor site.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TS8020` | `FUNCTION_SHAPE`            | A function declaration or parameter shape TypeShade does not support (missing name or body, optional/rest/destructured parameter).                                                                                                                                                                                                                                                                                                                                                                                             |
| `TS8021` | `RETURN_SHAPE`              | A `return` shape problem: bare `return` where a value is required, or an entry function with no return type annotation that returns a value.                                                                                                                                                                                                                                                                                                                                                                                   |
| `TS8022` | `UNKNOWN_NAME`              | Reference to a name TypeShade cannot resolve (identifier, struct field, or struct shape) that is not a function call (`UNKNOWN_FN`) or a type name (`UNKNOWN_TYPE`).                                                                                                                                                                                                                                                                                                                                                           |
| `TS8023` | `DUPLICATE_SYMBOL`          | The same function, binding, module constant or struct name declared twice in one scope. A struct counts whichever of the three spellings each declaration used: a class, an interface and a type alias of one name are one struct, not declarations that merge.                                                                                                                                                                                                                                                                |
| `TS8024` | `BUILTIN_NAME`              | `@builtin("...")` names an id outside WGSL's builtin vocabulary (`WgslBuiltinName` in `core/sot.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `TS8025` | `BUILTIN_STAGE`             | A `@builtin(...)` id used as the wrong stage's input or output, e.g. `frag_depth` on a vertex return, or `front_facing` on a vertex parameter.                                                                                                                                                                                                                                                                                                                                                                                 |
| `TS8026` | `WORKGROUP_SHAPE`           | A warning: `@compute([x, y, z])` exceeds one of WebGPU's default compute limits (`x` and `y` 256, `z` 64, 256 invocations in all), so a device requested without raising that limit refuses the pipeline. It was the error that refused a `y` or `z` other than `1` before the backend carried all three extents.                                                                                                                                                                                                              |
| `TS8037` | `WORKGROUP_ARG`             | `@compute(...)` with an argument that is not an array literal of one to three whole numbers (an object, a bare number, an identifier, an empty or four-wide array). It used to default to 64 with no diagnostic (#118).                                                                                                                                                                                                                                                                                                        |
| `TS8038` | `F64_ENTRY_IO`              | An emulated double (`f64`, a `vec64`) on an entry's IO boundary: a `@location` parameter, a `@location` field of an IO struct, or an entry's return (#151, surface doc §39). A varying interpolates each of the double's two `f32` words on its own; the remedy is to narrow with `f32(x)`, or read the double in the stage that needs it from a uniform or storage binding.                                                                                                                                                   |
| `TS8027` | `MAT_UNSUPPORTED`           | A non-square `matCxR<f64>`: the fp64 pass carries a square matrix of doubles only (`mat2`, `mat3`, `mat4`). Every `matCxR<f32>` is a type (#149), so this no longer marks `mat2`/`mat3`.                                                                                                                                                                                                                                                                                                                                       |
| `TS8028` | `ATTRIBUTE_NAME`            | A decorator identifier outside the attribute vocabulary `"use typeshade"` defines (`@vertex`, `@fragment`, `@compute`, `@builtin`, `@location`, `@interpolate`, `@invariant`, `@blend_src`, `@diagnostic`), e.g. a misspelled `@vertx`: without this, the decorated function or field just silently stops being an entry point or an I/O field.                                                                                                                                                                                |
| `TS8029` | `STRUCT_FIELD_MISSING_ATTR` | A field of a struct used as an entry function's parameter or return type carries neither `@builtin(...)` nor `@location(...)`: WGSL rejects an entry-IO struct member with no attribute, so this is caught at the front end instead of reaching the backend as invalid emitted WGSL.                                                                                                                                                                                                                                           |
| `TS8030` | `SYNTAX`                    | A TypeScript parse error (an unclosed parenthesis, a missing brace, an unexpected token) in a `"use typeshade"` file, carried through as a TypeShade diagnostic so a `compile()` caller sees it without running `tsc`. The language service drops these in favour of TypeScript's own syntactic diagnostics, which carry the real `TS1005`-style code.                                                                                                                                                                         |
| `TS8031` | `RECURSION`                 | A call cycle: a function that reaches itself, directly or through other functions. WGSL has no call stack, so Tint rejects the emitted module (`cyclic dependency found: 'a' -> 'b' -> 'a'`). Reported on the call that closes the cycle; a call on a value, an accessor and `new` are read as they lower. Before the optimizer, so a call in dead code counts (surface doc §4, §26).                                                                                                                                          |
| `TS8032` | `UNSIZED_ARRAY_LENGTH`      | `.length` or `arrayLength(x)` on an `array<T>` with no `N` that is not in storage: a `uniform<array<T>>`, a local or a parameter. A runtime-sized storage array reads its length as `arrayLength(&x)`; these shapes have no runtime length and need an explicit size.                                                                                                                                                                                                                                                          |
| `TS8033` | `MODULE_VAR`                | A module variable (a top-level `let`, per-invocation unless `workgroup<T>`) where its address space forbids: no type and no initializer, a resource type without `declare`, a `const` with a wrapper, a `workgroup` initializer, a type the space cannot hold, a non-constant initializer, or workgroup memory read from a vertex or fragment entry.                                                                                                                                                                           |
| `TS8034` | `BARRIER_PLACEMENT`         | `workgroupBarrier()` or `storageBarrier()` where a barrier cannot stand: in a vertex or fragment entry, which has no workgroup; or used as a value, since a barrier is a statement. A barrier under a branch is `UNIFORMITY` now (surface doc §54): what WGSL refuses is a branch on a value the invocations do not share, not a branch at all.                                                                                                                                                                                |
| `TS8035` | `CLASS_MEMBER`              | A class member shape the surface does not take, or a use the class rules refuse (#86, §26): a static field that holds a function, a decorator on a method, two methods of one name, `this` outside a method, a method called on the class or a static function on a value, a member the class lacks, a member a class that extends declares as another kind than its base, a `private`, `protected` or `#x` member named where TypeScript does not allow it, or a changing call on the copy a `return this` method hands back. |
| `TS8036` | `MATH_ARGUMENT`             | A math builtin called with arguments its signature does not take (#57): two shapes that had to agree (`dot(vec3, vec2)`, `clamp(v, 0., 1.)` on a vector), an element kind it has no form for, a scalar where a vector is due, `mix`'s factor, `refract`'s eta, `ldexp`'s exponent or a bit offset of the wrong shape, or `transpose` on a non-matrix.                                                                                                                                                                          |
| `TS8041` | `TEXTURE_ARGUMENT`          | A plain argument of a texture read the target has no overload for (#145): a coordinate or gradient of the wrong width for the texture's dim or of an element kind the read does not take (a sampled read is by normalised `f32`, a texel fetch by whole `i32`/`u32` texel), a layer, mip level or sample index that is not an integer or not a whole number of 0 or more, and a `level`, `bias` or `depth_ref` that is not an `f32`. Only a bare numeric literal is retargeted instead.                                        |
| `TS8050` | `ENABLE_NAME`               | A file-level `"enable <extension>";` directive (surface doc §50) naming an extension outside the vocabulary the WGSL backend's capability profile carries a directive for (`clip_distances`, `dual_source_blending`, `f16`, `primitive_index`, `subgroups`). A misspelled name would otherwise be an ordinary string expression statement and silently enable nothing.                                                                                                                                                         |
| `TS8051` | `LAYOUT`                    | A buffer binding's store type breaks one of WGSL's host-shareable rules (surface doc §51), which a struct hides from the type map: a `bool` field in a `uniform` or `storage` struct, a runtime-sized `array<T>` that is not its struct's last member, or a runtime-sized array in a uniform, whose type must be constructible.                                                                                                                                                                                                |
| `TS8052` | `UNIFORMITY`                | A call that needs uniform control flow — `textureSample` and the other implicit-LOD forms, the derivatives, or a barrier — reached under a condition that is not uniform across the invocations that run together (surface doc §54). A derivative is refused only when the control flow is definitely non-uniform; a barrier whenever it is not definitely uniform, which is what replaced `BARRIER_PLACEMENT`'s "inside any branch at all".                                                                                   |
| `TS8053` | `INT_LITERAL_DEPRECATION`   | A DEPRECATION warning, not an error: an integer-written literal in a declaration that declares no type still types as `f32` and will type as `i32` (surface doc §13, #148). Reported only when the caller passes `deprecations: true`; the compiler's behaviour has not changed, and the emitted bytes are identical with the flag on and off.                                                                                                                                                                                 |
| `TS8068` | `RESERVED_NAME`             | A declared name a target reserves, checked on the name the emit carries (`Cls_member`, `Ns_member`) rather than the one written (#103): an error for a WGSL keyword, reserved word, `__` prefix or bare `_`, since WGSL is the program; a warning for a GLSL ES 3.00 word, `gl_` prefix or `__` anywhere, since that target is a second one and the module still compiles for WebGPU. Not raised for a target the module never emits for, nor for a local, parameter or function name the GLSL writer renames itself.          |
| `TS8099` | `UNSUPPORTED`               | Catch-all for a diagnostic whose site does not yet deserve its own code; parked past the sequential range instead of at its head. (Codes from TS8038 on are drawn from per-branch blocks, so the sequence has gaps there — `codes.ts` says why.)                                                                                                                                                                                                                                                                               |

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

Document versions, for either adapter:

- `openDocument` and `updateDocument` take the adapter's version, and the service does not
  rely on it: the script version TypeScript compares (`TypeshadeHost.getScriptVersion`) is
  that version plus a store-wide revision that changes whenever the stored text changes, so a
  text change under a repeated version, or under no version at all, is seen as a change by
  TypeScript and by the caches of §8 alike. An unchanged text under a new version keeps its
  revision.
- A file pulled in through `readDocument` gets a version of its own, `imported.<revision>`,
  which cannot collide with an adapter's version; opening that uri in the editor replaces the
  read copy, closing it drops the copy so the next request re-reads the file.

## 8. Incrementality and performance

- One `ts.LanguageService` per service instance; documents are snapshots with versions.
- What is cached: one entry per document a request has asked about (`service.ts`'s `cache`),
  holding the front-end analysis of that document (`compileTsSource` over the program's own
  `ts.SourceFile`, with `emit: false` and `requireDirective: true`) and, once `getDiagnostics`
  has asked for them, the merged TypeScript and TypeShade diagnostics. `getDiagnostics`,
  `getDocumentSymbols`, `getSemanticTokens`, `getHover` and `getCompiledOutput` all read that
  one analysis, so an editor refresh that asks for all of them lowers the document once, not
  once per method. `getDiagnostics` and `getCompiledOutput` answer for open documents only;
  symbols, tokens and hover answer for any file the program holds, a file read through
  `readDocument` included, so such a file can hold an entry too, and every entry whose uri is
  not an open document is dropped whenever a document closes.
  `analysis-cache.test.ts` counts the runs through `createTypeshadeLanguageServiceWith`, a
  variant of the factory that takes the analysis function as a parameter; it is not exported
  from the subpath.
- How it invalidates: the entry is keyed by `dependencyKey(uri)`, the document's own script
  version followed by the version of every document it imports, transitively, each specifier
  resolved through the host's own import rule (`TypeshadeHost.resolveImportUri`, the method
  `resolveModuleNameLiterals` also uses) over every module reference in the file: the static
  `import`/`export ... from` declarations, an `import("...")` type, a dynamic `import("...")`
  call and an `import x = require("...")`, the same references the TypeScript program
  resolves. A request whose key differs from the stored one recomputes; `openDocument`,
  `updateDocument` and `closeDocument` also drop the document's own entry directly. So editing
  or closing an imported document refreshes the importing document's diagnostics on its next
  request without that document being touched: an edited import carries a new revision (§7);
  a closed one is re-read through `readDocument` when the host has one, under a new revision
  again, and otherwise drops to `getScriptVersion`'s `'0'`; each changes the key. A bare or
  unresolvable specifier contributes nothing to the key; TypeScript reports it from the
  importing file, whose version the key already carries.
- The front-end analysis is separable from emit: `compileTsSource` takes an `emit: false`
  option that still parses, analyzes, and lowers to IR but skips `packModule`/WGSL emission, and
  the cached analysis passes it, so diagnostics never produce shader text. `getCompiledOutput`
  is the one method that emits; when the backend throws (a compute-only module asked for a GLSL
  stage), the exception comes back as a `BACKEND` (`TS8015`) diagnostic on the file's first
  statement with `text: ''`, and the document's cached diagnostics stay as they were, since the
  failure is a fact about that target only.
- Nothing in the service is asynchronous. Cancellation is the adapter's concern (drop results
  whose version is stale).

## 9. Packaging

- `package.json` `exports` has the `"./language-service": "./src/language-service/index.ts"`
  subpath, and it now has built `.js`/`.d.ts` behind it: `tsc --build` emits
  `dist/src/language-service/index.js` + `.d.ts`, and the manifest inside the npm tarball —
  derived from this same `exports` map by `scripts/publish-manifest.ts` — points the subpath
  there. In the repository and for a submodule consumer the subpath still resolves to source.
- `typescript` is a `peerDependencies` entry, and as of the packaging work it is `>=5.0.0 <6`
  and NO LONGER optional. The `peerDependenciesMeta` optional flag was written on the premise
  that "a consumer that never touches `./language-service` installs nothing extra", and that
  premise is false: `src/compiler/ts/source-file.ts` imports `typescript` at module scope and
  `src/index.ts` re-exports `compile` from it, so a bare `import { emitModule } from 'typeshade'`
  loads the parser too. Measured on an installed tarball with no `typescript` present:
  `ERR_MODULE_NOT_FOUND: Cannot find package 'typescript' imported from
dist/src/compiler/ts/source-file.js`. npm installs a required peer automatically, so
  `npm install typeshade` now yields a working package. The upper bound is measured as well —
  npm resolved `>=5.0.0` to TypeScript 7.0.2, whose default export carries no `SyntaxKind`, and
  the package threw `Cannot read properties of undefined (reading 'PlusToken')` at module load.
  `AGENTS.md` no longer claims "no runtime dependencies"; the IR and the backends still have
  none, and the `"use typeshade"` front end is the exception.
- Landed since: the ambient declarations ship as a file too. `scripts/emit-shade-dts.ts` writes
  `dist/shade.d.ts` out of the `SHADE_DTS` string (`ambient.ts`, still the only authority) at
  build time, and the types-only subpath `typeshade/shade` resolves to it, so a `tsc` user
  authoring `.shade.ts` files outside the service can put `"types": ["typeshade/shade"]` in a
  `lib: []` project. Before that the string, which the service loads itself as a virtual
  library file, was the only form.
- Public exports are governed by `src/__api__/surface.md` and `api-doc-coverage.test.ts` like
  everything else.

## 10. Order of work

1. **Done: zero-based coordinates and `TypeshadeRange`** on PR #6. Adapters add 1.
2. **Done: compiler positions.** `TsCompilerDiagnostic` gained `start`/`length`/`endLine`/
   `endCharacter`, every `makeDiagnostic` call requires a `code`. The service's `span`/`range`
   come straight from these instead of a guessed width of 1.
3. **Done: document store and TypeScript host.** `createTypeshadeLanguageService`,
   `open/update/closeDocument`, the ambient lib (the `SHADE_DTS` string, shipped as
   `dist/shade.d.ts` behind `typeshade/shade` since, see §9), `positionAt`/`offsetAt`. Stage 1 methods reimplemented on
   the TypeScript service plus the front end; the PR #6 class survives as the
   `src/language-service.ts` compatibility shim (§0, §4) rather than the `analyze()`
   convenience once planned here.
4. **Done: Stage 2** methods, delegating to TypeScript with TypeShade re-labelling.
5. **Done: Stage 3** checks in the compiler front end: builtin allow-list, stage compatibility,
   workgroup shape, return annotation, plus two added during the review pass that also landed
   on this branch, a misspelled attribute (`ATTRIBUTE_NAME`) and a struct field missing
   `@builtin`/`@location` (`STRUCT_FIELD_MISSING_ATTR`); all surfaced as coded diagnostics (§6).
6. **Partly done: packaging.** The `./language-service` exports subpath, the `typescript`
   peer dependency, the built `dist/` and the shipped `dist/shade.d.ts` behind the
   `typeshade/shade` subpath have landed (§9). Still missing: an npm publish.
7. **Not started: Monaco adapter** in the site, replacing the Playground's inline logic; the
   Playground pins the published package or the public subpath, never a deep path.
8. **Not started: LSP adapter and the `vscode-typeshade`** repository, server (document sync,
   JSON-RPC, token encoding) and extension (client, TextMate grammar reused from the site's
   `typeshade-syntax.mjs`).
9. **Not started: MCP adapter.** The same "adapters convert, the service decides" rule as §1
   applies here too; nothing in this repository or a sibling one implements it yet.
10. **Done: one cached front-end analysis per document** (§8), read by `getDiagnostics`,
    `getDocumentSymbols`, `getSemanticTokens`, `getHover` and `getCompiledOutput`, keyed by the
    document's version and the versions of everything it imports.
11. **Done: the minor findings from the review pass** that landed the fixes in items 3, 4 and
    5 above, one commit each with a regression test. `rename` now refuses exactly what
    `prepareRename` refuses (the `"use typeshade"` directive string, a `@builtin(...)` id, an
    ambient name, a stage decorator), through one shared predicate; the diagnostics cache is
    keyed on imported document versions too (§8); completion context is decided from the
    syntax tree, so nothing TypeShade-specific is offered inside a comment, nothing at all
    inside a string except the builtin ids inside `@builtin("...")`, and the `vec2`/`vec3`/
    `vec4` snippets appear only where a value expression can start; `getCompiledOutput`
    reports an emit exception as a `BACKEND` diagnostic (§8); and `nodeAtPosition` is one
    exported helper in `positions.ts`.
12. **Not started: the rest.** The LSP adapter and `vscode-typeshade` (item 8), the MCP
    adapter (item 9), and the VS Code extension itself.

## 11. Open questions

- ~~Package name for the published service~~ — decided: the package publishes as the unscoped
  `typeshade`. Both npm placeholders (`typeshade` and `@typeshade/core`, reserved 2026-09-07 at
  `0.0.0`) belong to the project owner; `@typeshade/core` stays reserved for a later split and
  nothing is published to it.
- Whether `.shade.ts` should be recognised by extension in editors before the file is parsed,
  or only by the `"use typeshade"` directive (the compiler uses the directive; the Vite plugin
  uses the extension).
- ~~Multi-file: `compileTsSources` exists in two incompatible forms~~ — resolved: one form, in
  `module.ts`, taking a list of `{ fileName, source }` with an optional `entry`. `sources.ts` is
  deleted; the statement-level semantic check and the entry's module constants, which only it
  ran, are folded in (and the constants are now collected BEFORE the function bodies are
  lowered, which neither form did — a module constant referenced inside a function was
  `TS8022 Unknown identifier` in every multi-file program). The part of this question the
  document store actually needs, structs and bindings collected across a source set, landed
  with #74: every file's structs, bindings and overrides are merged into the one module, so a
  struct declared in one file resolves in another. What stays open is naming it in an import:
  `import { P } from "./types"` for a class `P` is `TS8099` (`"types.ts" has no function "P"`),
  since the resolver imports functions only, and the struct is used without importing it.
- Bundle strategy for the browser: worker only, or also a lexical tier without `typescript`
  for the first paint.
