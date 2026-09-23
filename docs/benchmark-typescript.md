# Benchmark against the TypeScript project

<!-- doc-refs: skip-file — a measurement of the tree at d5c7305 and of three other repositories; its paths name those trees, not this one -->

This document measures TypeShade against the TypeScript project: what microsoft/TypeScript does as
a language, a compiler, a language service, a tooling project, a testing and CI project, and a
release and documentation project, and what of that TypeShade should adopt in its next phase. Three
reference clones were read: microsoft/TypeScript at `release-5.9` (`7e133bea`), the
TypeScript-implemented compiler, cited below as `ts59/`; microsoft/TypeScript at `main`
(`879f986`), the current repository layout with the Go implementation, cited as `ts-main/`; and
microsoft/TypeScript-Website (`61332a7`), cited as `web/`. Those three prefixes are relative to the
respective clone roots. A path with no prefix is relative to this repository; a path under
`typeshade.github.io/` is in the site repository.

Four surveys assessed 77 practices. Overlapping entries were merged, which leaves 71. Each practice
below is four parts: what TypeScript does, what TypeShade has today, the gap between them, and the
adoption step with its size. Sizes are S, M and L. Priorities are `now`, `next`, `later` and
`skip`; the skipped practices are collected in the last section with the reason each one does not
transfer to a shader compiler.

The TypeShade half is a measurement of the tree this document was written against (no later than
`d5c7305`), and its counts and line references describe that tree: `src/compiler/ts/codes.ts`, for
one, has since grown from 30 codes to 44 (TS8001 to TS8038 with TS8011 retired, TS8041, TS8050 to
TS8053, TS8068 and TS8099).

## Diagnostics

### One authoritative message table

**TypeScript.** Every user-visible string lives in exactly one JSON file keyed by its English text,
each entry carrying a category (Error, Message, Suggestion) and a unique numeric code: 2121 entries,
2121 distinct codes, 1345 Error, 755 Message, 21 Suggestion. The generator enforces uniqueness
within one snapshot of the table; nothing in either clone states a policy on reusing a retired code.
Codes are allocated in ranges by phase: 1xxx syntactic (462), 2xxx semantic (537), 4xxx declaration
emit (111), 5xxx options (66), 6xxx CLI and messages (489), 7xxx implicit-any (55), 8xxx JS files,
JSDoc and rename (36), 9xxx isolated declaration emit (34), 17xxx JSX (73), 8xxxx suggestions (10)
and 9xxxx code-action descriptions (247). CONTRIBUTING tells contributors that all user-visible
strings go there. The table is the durable asset: the Go reimplementation carries the same table
under the same file name and the same schema, its generator reading the same `category`, `code`,
`reportsUnnecessary`, `reportsDeprecated` and `elidedInCompatabilityPyramid` fields with a comment
marking that last misspelling as [sic] in Strada; the two differ only by ordinary branch drift, 2136
entries at main against 2121 at release-5.9, not by a re-numbering
(`ts59/src/compiler/diagnosticMessages.json`, first entry at line 2, code 1002;
`ts59/CONTRIBUTING.md:270-273`; `ts-main/tsc/internal/diagnostics/diagnosticMessages.json`;
`ts-main/tsc/internal/diagnostics/generate.go:31-40`).

**TypeShade.** Two registries, neither of which is a message table for the front end. TS8xxx is a
code enum with prose doc comments and no messages, 30 codes, TS8001 to TS8030 with TS8011 retired,
plus TS8099 (`src/compiler/ts/codes.ts:4` and `:8-53`), and the message text is composed inline at
the raise sites, 42 `makeDiagnostic` calls and 127 `pushDiag` calls over 21 files, where
`makeDiagnostic` takes a free-form string (`src/compiler/ts/diagnostic.ts:46-58`). SD#### is a real
table of code, summary and optional hint, 35 entries, but it belongs to the runtime DSL builder API
(`src/core/diagnostics/codes.ts:45+`).

**Gap.** There is no single place that says what a TypeShade error says. Changing a message is a
source edit in one of 21 files, invisible in review as a message change; nothing can enumerate the
messages; and the two code spaces are documented in different files with different vocabularies and
never reconcile.

**Adoption (L).** Add `src/compiler/ts/messages.ts`: one frozen record keyed by TS8xxx code with
`{ code, category, template, hint? }`, and change `makeDiagnostic` and `pushDiag` to take a table
key plus arguments instead of a string. Port the 169 raise sites in batches, starting with the codes
used once or twice (SWITCH_CASE, STRUCT_FIELD, BREAK_OUTSIDE, UNKNOWN_FN). Leave SD#### as the DSL's
own table and cross-reference the two from one doc page rather than merging them, since they
describe two different authoring surfaces.

### Messages as templates with numbered placeholders

**TypeScript.** 899 of the 2121 messages are format strings with `{0}` and `{1}` placeholders, so
the invariant text is separable from the arguments supplied at the raise site, which is what makes a
message diffable, translatable and keyable (`ts59/src/compiler/diagnosticMessages.json:10`, code
1005, and `:18`, code 1007 with two placeholders).

**TypeShade.** Messages are template literals assembled at the raise site, and some are built by
dedicated prose functions: `numericMismatch` returns ten different whole sentences for one code,
seven of them with their own remedy text baked in (`src/compiler/ts/numeric.ts:90-153`; the three
that carry no remedy are at `:93`, `:113` and `:152`). The SD catalogue does make the split, summary
plus per-throw detail (`src/core/diagnostics/error.ts:80-90`), so the project already knows the
pattern on the DSL side.

**Gap.** A message change cannot be reviewed as such, no consumer can key on a message shape, and
localization is impossible. The site already hits this: the Playground hard-codes a Korean
replacement for exactly one code because it cannot get a translated message from the compiler.

**Adoption (M).** When messages move into the table, write them as templates with `{0}` placeholders
and add `formatMessage(code, ...args)`. Split the ten branches of `numericMismatch` into either
ten codes or one code with a remedy slot, so the remedy text is a table row rather than a
concatenation. Once templates exist, a `messages.ko.ts` keyed by the same codes replaces the
Playground's TS8001 special case.

### Generated message map with a uniqueness gate

**TypeScript.** A build script reads the JSON and writes two generated artifacts, a named
`Diagnostics.X` constant per message so raise sites reference a symbol and not a string, and a key
to message JSON that is the localization surface; it throws if two entries share a code. Both
generated files are gitignored and the task is wired into the build as `generate-diagnostics`, and
the Go port repeats the whole arrangement with a generator, a generated Go map and gzipped
per-locale tables (`ts59/scripts/processDiagnosticMessages.mjs:56-75` and `:78-107`;
`ts59/Herebyfile.mjs:87-92`; `ts59/.gitignore:23-26`;
`ts-main/tsc/internal/diagnostics/generate.go` and its `loc/*.json.gz`).

**TypeShade.** The SD catalogue has a hand-written test asserting well-formed SD#### keys,
uniqueness, non-empty summaries and an inline snapshot of every key, so adding or removing a code is
a reviewed diff (`src/core/diagnostics/codes.test.ts:5-64`). TS8xxx has no such test, and the
documentation table of TS8xxx codes is a hand-copy of the doc comments in `codes.ts`
(`docs/language-service-api.md:428-444`); there is no `codes.test.ts` under `src/compiler/ts/`.

**Gap.** TS8xxx has no uniqueness or well-formedness gate and no snapshot, so a duplicated or
malformed code ships silently, and the documentation table drifts from `codes.ts` the moment a code
is added.

**Adoption (S).** Two pieces. Add `src/compiler/ts/codes.test.ts` mirroring
`src/core/diagnostics/codes.test.ts`: every key matches `TS8\d{3}`, values are unique, each has a
message-table row once the table lands, plus an inline snapshot of the key list. Then add
`scripts/gen-error-docs.ts` that emits the documentation table and the site's error index rows from
the tables, so the docs cannot drift. Do not build a code generator for the raise sites; 30 codes do
not need one.

### Related information on a diagnostic

**TypeScript.** A diagnostic can carry `DiagnosticRelatedInformation` entries, each with its own
file, span and message; `addRelatedInfo` attaches them and it is used at 75 sites in the compiler,
`relatedInformation` is on the public `Diagnostic` type, and the pretty formatter renders each
related entry with its own location line and its own indented code frame
(`ts59/src/compiler/utilities.ts:10285-10295`; `ts59/src/compiler/types.ts:7264`;
`ts59/src/compiler/program.ts:796-807`).

**TypeShade.** `TypeshadeDiagnostic` declares an optional `relatedInformation` field and nothing in
the repository ever sets it; it is the only occurrence of the identifier in `src/` outside the
generated surface snapshot (`src/language-service/types.ts:74`; `src/__api__/surface.md:1231`). The
adapter that converts a TypeScript diagnostic builds the object without it
(`src/language-service/diagnostics.ts:352-366`), so TypeScript's own related spans are discarded
before they reach the editor, and `TsCompilerDiagnostic` has no such field at all.

**Gap.** Messages that involve two places say so in prose instead of pointing: the duplicate binding
message names both owners in text, as do the duplicate function and duplicate module const messages.
And TypeScript's own related spans, which cost nothing to forward, are thrown away.

**Adoption (S).** Two steps, the first immediately. In `toTypeshadeDiagnostic`, map
`d.relatedInformation` into the field that already exists, converting each entry's span the way the
primary span is converted, about a dozen lines plus a test. Then add `relatedInformation` to
`TsCompilerDiagnostic` and populate it at the four sites that already name a second location in
prose: duplicate `@binding` in a group (`bindings.ts`), duplicate function, duplicate module const,
and the entry-IO struct field check in `lower/function.ts`.

### A pretty formatter with a source code frame

**TypeScript.** `formatDiagnosticsWithColorAndContext` prints file, line and column, the colored
category name, a grey `TS<code>:`, the flattened message, the offending source line with an
underline run under the span, then every related-information block with its own location and frame;
watch mode prints through it (`ts59/src/compiler/program.ts:779-811`;
`ts59/src/compiler/watch.ts:137`).

**TypeShade.** `formatReport` renders a lint `DiagnosticReport` as severity, code, rule id, an arrow
line with file, line and column, the message and a hint line, with no source excerpt and no caret
(`src/core/diagnostics/report.ts:138-151`), and the lint engine's own `formatDiagnostics` is one
line per diagnostic (`src/core/passes/lint/engine.ts:311-319`). Neither takes the front end's
`TsCompilerDiagnostic` list, which does carry `start`, `length`, `line`, `character`, `endLine` and
`endCharacter` (`src/compiler/ts/source-file.ts:50-65`). There is no `bin` entry in `package.json`,
so the only renderer of a TS8xxx diagnostic today is the site Playground's DOM list
(`typeshade.github.io/src/scripts/playground.ts:960-982`).

**Gap.** The front end computes exact spans and nothing renders them. A `compile()` caller in a test
or a script prints raw objects, and the spans that cost real work to get right are invisible outside
the editor.

**Adoption (M).** Add `formatTsDiagnostics(source, diagnostics)` under `src/compiler/ts/` producing
the TypeScript shape: path, line and column, `error TS8003:`, the message, the offending source line
with a caret run under the span, a hint line, and related-information blocks once those land. Use it
in vitest failure output and in any future CLI; the Playground keeps its Monaco markers.

### No catch-all code

**TypeScript.** There is no generic code: 2121 messages, 2121 distinct codes, and a message cannot
exist without a table row, so a code is never optional (uniqueness enforced at
`ts59/scripts/processDiagnosticMessages.mjs:65-75`). Downstream machinery depends on it, since a
code fix registers on specific numeric codes and dispatches through a code-to-fixes map
(`ts59/src/services/codefixes/addMissingConst.ts:28-31`; `ts59/src/services/codeFixProvider.ts:28`
and `:52-62`).

**TypeShade.** TS8099 UNSUPPORTED is deliberate and documented as the catch-all for a site that does
not yet deserve its own code (`src/compiler/ts/codes.ts:4-6` and `:52`). It is used at 39 raise
sites, the second heaviest code after TYPE_MISMATCH at 44, with ARITY_MISMATCH at 20, and 22 of the
30 codes are used at five sites or fewer.

**Gap.** About one in five raise sites is invisible to anything keyed on a code: a quick fix, a docs
link, an error index row, a Korean message. The sites hiding behind UNSUPPORTED are the "TypeShade
does not support this" messages a newcomer most needs a documented page for.

**Adoption (M).** Triage the 39 sites in one sweep together with the message table and group them
into roughly six new codes: unsupported statement form, unsupported expression form, unsupported
type form, unsupported call target, unsupported literal, unsupported host construct. Keep UNSUPPORTED
only for genuine one-offs and add an assertion in the codes test that its usage count does not grow.

### Per-message metadata for editor rendering

**TypeScript.** Table entries carry optional `reportsUnnecessary` (9 entries, for example code 6133,
declared but never read) and `reportsDeprecated` (3 entries, for example code 6385). The flags are
threaded from the table through diagnostic construction and the builder into the public diagnostic,
where an editor renders them faded or struck through rather than as red squiggles, and the
Suggestion category with `computeSuggestionDiagnostics` powers the grey suggestion layer that code
fixes also attach to (`ts59/src/compiler/diagnosticMessages.json:5175-5179` and `:5890-5893`;
`ts59/src/compiler/utilities.ts:8558,8583`; `ts59/src/compiler/builder.ts:576`;
`ts59/src/services/suggestionDiagnostics.ts:68`).

**TypeShade.** `TypeshadeSeverity` includes `hint` and `information`, and TypeScript's Suggestion
category maps to `hint`, so the channel exists for forwarded TypeScript suggestions
(`src/language-service/diagnostics.ts:335-345`). No TypeShade diagnostic is ever raised at suggestion
severity, and there is no tag concept on `TypeshadeDiagnostic`
(`src/language-service/types.ts:58-75`); the two non-error TypeShade diagnostics are the missing
return annotation warning (`src/compiler/ts/lower/function.ts:219-227`) and the warning `compile()`
raises when the GLSL stage refuses a module whose WGSL emitted, which is deliberate
(`src/compiler/ts/compile.ts:101-107`; `src/compiler/ts/diagnostic.ts:64-66`).

**Gap.** Nothing TypeShade reports can render as faded-unused or deprecated, and TypeShade never
raises a suggestion of its own even where the analysis already exists, for an unused local, a struct
field never read, or a `Var` that is never reassigned, which the lint engine already detects on the
DSL side.

**Adoption (M).** Add an optional `tags` field, `('unnecessary' | 'deprecated')[]`, to
`TypeshadeDiagnostic` and set it from the message-table row once the table lands. Then ship one
producer to prove it: a suggestion-severity diagnostic for a declared-but-unread local in a
`"use typeshade"` function, paired with the remove-unused quick fix. Deprecation can wait until the
surface has anything deprecated.

### A documented error index

**TypeScript.** TypeScript does not ship one, and that is worth stating plainly. Neither clone
contains a per-code documentation page: the website's page tree has only branding and dev pages
(`web/packages/typescriptlang-org/src/pages`), and the only prose about errors is one handbook
chapter that teaches how to read an elaboration rather than documenting codes
(`web/packages/documentation/copy/en/handbook-v2/Understanding Errors.md:1-56`). The message table
itself is the de-facto index, the generated key-to-message JSON is what localizers and third-party
error-explanation sites consume (`ts59/scripts/processDiagnosticMessages.mjs:113-127`), and the
Playground shows errors inline (`web/packages/playground/src/sidebar/showErrors.ts`).

**TypeShade.** The closest artifact is a hand-copied table in the language-service design doc
covering only TS8017 to TS8099 (`docs/language-service-api.md:428-444`); the language surface doc
has a six-row table of diagnostic situations with no codes
(`docs/use-typeshade-surface.md:202-212`); the site has no errors page, its only documentation trees
being guide, api and ko (`typeshade.github.io/src/pages`); and the SD catalogue is documented only
as an API surface dump (`src/__api__/surface.md:808-813`).

**Gap.** There is no URL for "what is TS8010", and the two code spaces are documented in two
repositories in two vocabularies. A user who hits SD0044 through the `"use typeshade"` path has
nowhere to look.

**Adoption (M).** Generate an `/errors` page per language on typeshade.dev from the two tables, one
row per code with summary, hint and the source path that raises it, plus a short why-this-exists
paragraph for the ten heaviest codes. Generate it with the same script that emits the documentation
table so it cannot drift, and put the URL into the message table so the formatter and the Playground
pane can link each diagnostic to its row. This is more than TypeScript does, and it is cheap at 65
codes where it would be prohibitive at 2121.

### The spelling suggestion as structured fix data

**TypeScript.** `getSpellingSuggestion` computes the nearest candidate and feeds 58 "Did you mean"
messages, and `fixSpelling` turns the same suggestion into an applied edit, so the suggestion is
computed once and then both reported and fixable (`ts59/src/compiler/core.ts:2167`;
`ts59/src/services/codefixes/fixSpelling.ts`; the 58 entries in
`ts59/src/compiler/diagnosticMessages.json`).

**TypeShade.** The front end computes an edit-distance suggestion for an unknown builtin and for an
unknown attribute using one shared rule so both hints agree, then concatenates it into the message
string and discards the structured value (`src/compiler/ts/builtin-check.ts:104-110`, `:148-153`,
`:236-244`).

**Gap.** The hardest part of the fix, choosing the replacement text, is already done and thrown away
into prose. The editor can only tell the user what to type.

**Adoption (S).** Carry the suggestion as structured data rather than only inside the message: add
an optional `fixData` field to `TsCompilerDiagnostic`, the replacement text plus the span to
replace, and set it at the two builtin-check sites. The quick fix is then a one-line text replace,
which makes it the cheapest first entry in the fix registry and the one that proves the whole path
end to end.

### One diagnostic identity across the pipeline

**TypeScript.** A diagnostic raised anywhere in the compiler keeps its code and category all the way
to the CLI, the public API and the editor; there is no boundary at which a code degrades into text
(`ts59/src/compiler/utilities.ts:8558-8583`, where code and flags are copied into every constructed
diagnostic). The strongest evidence is the Go rewrite on main, which reimplemented the compiler in
another language and kept the same message table under the same file name and schema, 2136 entries
against 5.9's 2121, so every code survived a full reimplementation
(`ts-main/tsc/internal/diagnostics/diagnosticMessages.json`, `generate.go:31-40` and
`diagnostics_generated.go`).

**TypeShade.** The front end and the runtime DSL have separate identities and the boundary between
them loses information. When emit throws, `compileTsSource` catches the exception and re-raises the
text under TS8015 as a backend-emit-failed message with `e.message` glued on
(`src/compiler/ts/source-file.ts:159-163`, whose `backendDiagnostic` is the one shape every
emit-time failure takes, `src/compiler/ts/diagnostic.ts:68-80`), so a `TypeShadeError`'s SD code,
its catalogue hint and its captured `loc` are all flattened into a string
(`src/core/diagnostics/error.ts:60-77`).

**Gap.** A user who trips SD0044 through the `"use typeshade"` path sees TS8015 with SD text
embedded in the message. No consumer can branch on the real code, the Playground cannot translate
it, the error index cannot link it, and no quick fix can attach to it even though the SD catalogue
already carries a hint that names the remedy.

**Adoption (S).** In that catch, test for `TypeShadeError` and carry its fields through instead of
stringifying: keep TS8015 as the front-end code, add `relatedCode` set to `e.code`, set the
diagnostic's hint from `e.hint`, and put the SD code in the message at a fixed position so the error
index can resolve both spaces. About fifteen lines plus a test that an emit failure from a known SD
code preserves that code. Do it inside `backendDiagnostic`, so the two other emit boundaries that
already report through it, `compile()`'s WGSL and GLSL catches, get the same treatment for free.

## Testing and CI

### Directive-driven compiler test cases

**TypeScript.** Every compiler test is a single source file in a case directory whose first lines
carry `// @option: value` directives, compiler options plus the harness-only `// @filename` that
splits one file into several compilation units. The harness parses the directives, compiles the
case, and writes one baseline file per output kind next to a reference copy; the test is the diff.
There are 6367 `.ts` cases in `ts59/tests/cases/compiler`, 3547 `// @filename` occurrences, 1161
cases carrying two or more of them and so compiling as several units, and 46629 files under
`ts59/tests/baselines/reference` (`ts59/tests/cases/compiler/moduleResolutionWithSymlinks.ts:1-22`,
a case with `// @noImplicitReferences`, `// @traceResolution`, three `// @filename` units and
a `// @symlink`; `ts59/src/testRunner/compilerRunner.ts:88-104`, one `it` per output kind per case
for errors, module-resolution trace, sourcemap record, JS output, sourcemap output, types and
symbols; `ts59/CONTRIBUTING.md:212-250`).

**TypeShade.** Tests are hand-written vitest files, one per feature, with the shader source inlined
as a template string and the expectations written as `expect` calls, 227 `*.test.ts` files. The only
per-case baseline is emit: `checkGolden` pins each registered example's WGSL and both GLSL ES 3.00
stages byte for byte into `examples/__emit-goldens__`, 116 files of which 42 are `.wgsl`, 72
`.glsl`, one `.json` and one `.diff` (`examples/emit-goldens.test.ts:32-45`;
`examples/_goldens.ts:38-53`). There is no case directory, no directive header, no multi-file case
and no error baseline; the diagnostics suite inlines six error sources in an array and asserts only
that each threw nothing, produced at least one diagnostic, and that each diagnostic carries a
one-based position, a category from a three-value set and a non-empty message
(`src/compiler/ts/diagnostics.test.ts:13-35`).

**Gap.** TypeShade pins emit only for the 42 registered examples, which are curated showcase
shaders, not for the feature cases the compiler tests actually exercise. A feature test asserts a
substring or a `toBeGreaterThan(0)` rather than the whole output, so most of what the compiler
produced on that input is unwatched, and there is no way to vary one case across targets or options
(wgsl against glsl, minified or not, fp64 flavor float or integer) without hand-writing each
combination.

**Adoption (L).** Add `tests/cases/` with one `.shade.ts` per case and a header of
`// @target: wgsl,glsl`, `// @minify: true`, `// @fp64: integer` and `// @filename: helper.ts`
directives. Write a small parser, the directive grammar being a regex over leading
`// @name: value` lines with `// @filename` splitting the body, plus a runner that feeds each
configuration through `compileTsSource` and writes `tests/baselines/local/<case>.<target>`, then
reuses the existing `checkGolden` comparison against `tests/baselines/reference`. Start by
converting the fifteen cases in `src/compiler/ts/diagnostics.test.ts` and
`src/compiler/ts/stage.test.ts`, keep the rest of the vitest suites as they are, and let the case
directory grow with new features.

### A per-case type and symbol baseline

**TypeScript.** Besides the `.js` and `.errors.txt` baselines, each compiler case emits a `.types`
file, the type of every expression, and a `.symbols` file, the symbol every identifier resolved to,
produced by the type writer and compared as a baseline. This is how a checker change that silently
widens or narrows an inference shows up as a reviewable diff rather than as a green test
(`ts59/src/testRunner/compilerRunner.ts:104` and `:320`; `ts59/src/harness/typeWriter.ts`;
`ts59/CONTRIBUTING.md:246-248`).

**TypeShade.** Nothing records inferred types per expression. Type behaviour is asserted indirectly,
through the emitted text, through a targeted expectation in a feature test
(`src/compiler/ts/f64-types.test.ts`, `src/compiler/ts/numeric.test.ts`), or through hover text in
the language service tests, which is the only place an inferred type is read back and only as a
substring (`src/language-service/hover.test.ts:41-48`).

**Gap.** TypeShade's live inference bugs are exactly the class this baseline catches: a numeric
literal local that reports `number` instead of `f32`, an index expression that reports TS2542.
Today a change to literal typing or to vector broadcast can alter what every expression in the tree
is inferred as while every emit golden stays byte-identical, because the emitted WGSL spelling did
not move, and no test would see it.

**Adoption (M).** Add a `.types` writer to the case runner: walk the compiled source file, ask the
TypeShade checker for the type of each expression node, and print `<source text> : <type>` one line
per expression into `tests/baselines/reference/<case>.types`. Reuse the existing `_goldens.ts`
compare-or-bake protocol. Roughly 100 lines of walker plus the baseline plumbing once the case
directory exists.

### Marker-based fixtures for service and code action tests

**TypeScript.** Language service behaviour is tested in a dedicated DSL: the test file is source
written behind `////` prefixes, with `/**/` or `/*1*/` markers for cursor positions and `[| ... |]`
for ranges, followed by an imperative script of `goTo.marker("1")`,
`verify.completions({ marker, exact })`, `verify.quickInfoIs(...)`,
`verify.codeFix({ description, newFileContent })`, `verify.codeFixAll({ fixId, fixAllDescription,
newFileContent })`, `verify.renameInfoSucceeded(...)`. There are 6298 `.ts` tests in
`ts59/tests/cases/fourslash` plus 243 more under `server/`, of which 1142 call `verify.codeFix`, 137
call `verify.codeFixAll` and 664 name a refactor, backed by a 5286-line implementation, a
2049-line verify surface with 194 methods, and a 964-line declaration file that is both the type
surface and the syntax guide (`ts59/tests/cases/fourslash/fourslash.ts:1-27`;
`ts59/tests/cases/fourslash/codeFixAddMissingConstInForOfLoop1.ts`, a whole test in 8 lines;
`ts59/tests/cases/fourslash/codeFixAddMissingMember.ts`, a complete codeFix test in 18 lines;
`ts59/tests/cases/fourslash/codeFixSpelling1.ts`, 9 lines through `verify.rangeAfterCodeFix`;
`ts59/src/harness/fourslashImpl.ts:3443,3457` and `:4775-5000`;
`ts59/src/harness/fourslashInterfaceImpl.ts`).

**TypeShade.** Twelve hand-written vitest files, 1932 lines and 116 `it` blocks total, most of them
repeating the same four steps: construct the service, inline the source as a string, locate the
cursor with `source.indexOf(...)` plus an arithmetic offset, convert with `positionAt`, then assert
on the raw result object (`src/language-service/completions.test.ts:5-36`, with
`const offset = source.indexOf('"ver') + 4` and
`const offset = source.indexOf('@builtin("') + '@builtin("'.length`;
`src/language-service/hover.test.ts:28-35`; and `service.test.ts` with 23 cases,
`completions.test.ts` 22, `ambient.test.ts` 14, `navigation.test.ts` 14, `host.test.ts` 8,
`diagnostics.test.ts` 7, `hover.test.ts` 7, `analysis-cache.test.ts` 5, `semantic-tokens.test.ts` 5,
`symbols.test.ts` 5, `positions.test.ts` 4, `signature.test.ts` 2). One file has already grown out
of the arithmetic: `completions.test.ts:65-71` defines a shared `completionsAt(service, uri, source,
cursor)` that takes the cursor as text and asserts it was found, and the second half of the file
uses it. No helper applies returned edits: `rename` is the one method that produces them
(`src/language-service/service.ts:82-87`) and no test applies them.

**Gap.** The cursor position is computed by string arithmetic in every test, which is the part most
likely to be silently wrong: `indexOf('vertex_index') + 2` names no position a reader can check, and
an edit to the sample source moves it without failing. There is no shared vocabulary for "the
completion list is exactly this", "the rename range is these spans" or "applying the fix produces
this file", so each new service feature arrives with a new hand-rolled shape of assertion, cross-file
cases cannot be expressed at all, and the cost per case is the reason 116 cases is thin for a service
with 11 query methods.

**Adoption (M).** Do not port fourslash. Write a fixture of roughly 150 lines,
`src/language-service/_fixture.ts`, that takes a source string containing `/*1*/` markers and
`[|...|]` ranges, strips them, opens the document on a fresh service and returns
`{ service, uri, marker(n), range(n), text }`, plus the verbs over it: `completionsExact(marker,
labels)`, `hoverContains(marker, text)`, `renameSpans(marker, ranges)`,
`expectCodeFix({ source, marker, fixName, expected })`, which applies the returned edits and
compares the whole resulting text, and `expectFixAll` for the batch. Generalise
`completions.test.ts`'s own `completionsAt` into it rather than starting from nothing, convert
`completions.test.ts` and `hover.test.ts` first so the marker arithmetic disappears from the two
files that have the most of it, write it together with the first quick fix, then require every new
service test to use it. Add `// @filename:` support only when the service gains a multi-document
case.

### A one-command accept-baselines step

**TypeScript.** `hereby baseline-accept` copies `tests/baselines/local` over
`tests/baselines/reference` and honours `.delete` markers to remove dropped baselines, and
CONTRIBUTING documents it as the workflow after reviewing a diff. The CI test job runs it on failure
and prints the staged diff so the PR author sees exactly which baselines moved, the baselines job
uploads the whole thing as a `fix_baselines.patch` artifact, and a bot-run workflow re-runs the
tests, accepts baselines, applies lint fixes and pushes the commit
(`ts59/Herebyfile.mjs:857-886`; `ts59/.github/workflows/ci.yml:133-138` and `:386-412`;
`ts59/.github/workflows/accept-baselines-fix-lints.yaml:19-40`; `ts59/CONTRIBUTING.md:251-266`).

**TypeShade.** The bake protocol exists and is documented in four places, but the documented command
does not exist in this repository: `_goldens.ts` and both golden suites tell the author to run
`bun run bake:goldens` from the repo root (`examples/_goldens.ts:23-25` and `:47-51`;
`examples/emit-goldens.test.ts:11-14`; `examples/shade-examples.test.ts:16`), while `package.json`
defines only `bake:api-surface` (`package.json:58-66`). From the standalone checkout the instruction
fails and the author has to reconstruct `UPDATE_EMIT_GOLDENS=1 vitest run` from a comment. CI prints
only the vitest diff and nothing is uploaded (`.github/workflows/ci.yml:36-47`).

**Gap.** The single command a contributor needs after an intentional emit change is broken in the
repository that ships the tests. A failing golden costs a search through source comments instead of
a copy-paste, which is the friction that makes people edit the golden by hand.

**Adoption (S).** Add
`"bake:goldens": "UPDATE_EMIT_GOLDENS=1 vitest run examples/emit-goldens.test.ts examples/shade-examples.test.ts examples/shade-twins.test.ts"`
and `"bake": "bun run bake:goldens && bun run bake:api-surface"` to `package.json`, fix the four
comments that say "from the repo root", and add a CI step under `check` that runs on failure,
re-bakes, and uploads `git diff` as an artifact named `goldens.patch`.

### Orphan and missing baseline detection

**TypeScript.** A dedicated CI job deletes `tests/baselines/reference` entirely, runs the full
suite, accepts every baseline the run produced, and classifies the git diff: files added or copied
are missing baselines, modified files are drifted baselines, deleted files are unused baselines left
behind by a removed or renamed test, and all three fail the job
(`ts59/.github/workflows/ci.yml:366-412`, the `baselines` job with `print_diff ACR "Missing
baselines"`, `print_diff MTUXB "Modified baselines"` and `print_diff D "Unused baselines"`).

**TypeShade.** Drift and missing-file are both caught: `checkGolden` fails when the file is absent
and when the bytes differ, and the suites carry floors so an empty registry cannot green them
(`examples/_goldens.ts:38-53`; `examples/emit-goldens.test.ts:29-31`, `examples.length >= 10`, a
floor and not a set comparison). Orphans are not caught for the EDSL corpus, since nothing
enumerates `examples/__emit-goldens__` and compares it to the set of files the suites expect. The
`.shade.ts` corpus does have a two-directional check, but only between the directory and the
registry, not between the registry and the goldens
(`examples/shade-examples.test.ts:51-58`).

**Gap.** 116 committed golden files and no test that says which of them should exist. A rename
leaves the old WGSL golden in the tree and adds a new one, and the diff a reviewer sees looks like
an addition rather than a move.

**Adoption (S).** Have `checkGolden` record each filename it touched in a module-level set, and add
one final test in `examples/emit-goldens.test.ts` that reads `readdirSync(GOLDEN_DIR)` and asserts it
equals that set. Follow the pattern already in `examples/shade-examples.test.ts:51-58`, comparing
sorted arrays in one assertion so a rename shows both halves at once. Under 30 lines.

### A nightly prerelease from main

**TypeScript.** A scheduled workflow runs at 07:00 UTC daily: it runs the full test suite against a
version stamped by `hereby configure-nightly`, builds the LKG and runs `npm publish --tag next`, so
anyone can install `typescript@next` and check whether a bug is already fixed; a second workflow
does the same for the insiders tag on `repository_dispatch`, and CONTRIBUTING points bug reporters
at the nightly (`ts59/.github/workflows/nightly.yaml:1-63`; `ts59/Herebyfile.mjs:951-956`;
`ts59/.github/workflows/insiders.yaml:1-40`; `ts59/CONTRIBUTING.md:33`).

**TypeShade.** No publish of any kind. `package.json` is at version 0.0.1 with
`publishConfig.access: public` and no npm workflow and no release tags (`package.json:3` and
`:83-85`; `.github/workflows/ci.yml`, the only workflow, with no publish job); the generated
changelog states outright that the repo ships no versioned releases and carries no git tags
(`CHANGELOG.md:20`), and consumers are told to pin a mirror SHA (`src/api-surface.test.ts:20-25`).

**Gap.** There is nothing a user of typeshade.dev can install to try a fix, and nothing an issue
reporter can be asked to reproduce against. Every consumer integration is a SHA pin, which makes "is
this already fixed on main" a git operation rather than an install.

**Adoption (M).** Add `.github/workflows/nightly.yml` on a daily cron: run build, test and
`gate:compile`, stamp the version as `0.0.1-dev.<yyyymmdd>` with a small script, taking
`ts59/scripts/configurePrerelease.mjs` as the model, and `npm publish --tag next` under an
`NPM_TOKEN` secret. Gate the publish job on the test job the way `nightly.yaml` does with
`needs: [test]`. Do this before the issue-repro bot, since the bot needs something to bisect
against.

### A perf benchmark in the test gate

**TypeScript.** The Go-implementation repository runs benchmarks in CI on every PR: the go-test job
runs `go test -run=- -bench=. -benchtime=1x ./...` with no Node present, and the main test job runs
`npx hereby test:benchmarks` right after the compiler tests on every matrix entry, with CONTRIBUTING
documenting `npx hereby test:all` as the target that also runs benchmarks
(`ts-main/.github/workflows/ci.yml:81-82` and `:148-152`; `ts-main/CONTRIBUTING.md:104`). Absolute
per-PR comparison against the base branch is done outside the repository; the in-repo practice is
that a benchmark which fails to build or run breaks the build.

**TypeShade.** No benchmark of any kind: nothing in `package.json:58-66`, nothing in `scripts`
(which holds `bake-api-surface.ts`, `compile-gate.ts` and `monorepo-context.ts` only), no file whose
name contains bench. The only timing signal is accidental, the df64 property suites taking 8 to 16
seconds per test and forcing the vitest timeout to 30 seconds (`vitest.config.ts:6-9` and `:15`).

**Gap.** Compile time is a first-class property of a language service, since the service recompiles
on every keystroke and the diagnostics cache exists precisely because it is not fast enough to redo.
Nothing measures it, so a checker change that doubles the cost of a 200-line shader lands silently
and is discovered as editor lag.

**Adoption (M).** Add `scripts/bench.ts` that compiles each registered example N times and prints a
table of milliseconds per phase (parse, check, lower, emit WGSL, emit GLSL, reflect), plus a second
pass measuring the language-service round trip (`openDocument`, then `getDiagnostics`, then
`getCompletions`) on the largest example. Wire it as `"bench": "bun scripts/bench.ts"` and run it in
the check job so a benchmark that throws fails CI. Compare against the base branch only once the
numbers are stable enough to have a threshold; TypeScript itself keeps that comparison out of the
repository.

### A CI matrix over operating systems and runtimes

**TypeScript.** The test job runs a matrix of 15 entries, Node 14, 16, 18, 20, 22 and 24 on ubuntu
and windows, macOS on 24 and 16 only with the other four macOS rows commented out as too expensive,
plus one `lts/*` `--no-bundle` entry, with `fail-fast: false` and a `skip` flag that trims the matrix
inside merge queues; the Go repository does the same shape with runner, race mode, noembed and
concurrent-test-programs variants (`ts59/.github/workflows/ci.yml:27-120`, the commented macOS rows
at `:53-57`, `:65-69`, `:77-81` and `:101-105`; `ts-main/.github/workflows/ci.yml:84-120`).

**TypeShade.** Two jobs, both `runs-on: ubuntu-latest`, both on `bun-version: latest`, with no
matrix and no Node entry at all (`.github/workflows/ci.yml:36-47` and `:49-60`). The package declares
`engines: node >=20` (`package.json:26-28`) and a TypeScript peer range of `>=5.0.0`
(`package.json:75-77`) while the devDependency is 5.6.3 (`package.json:67-74`).

**Gap.** Two dimensions are untested and both are claimed in `package.json`. The package is run only
under bun, so a Node-only incompatibility (bun's `node:fs` and path behaviour differ in corners the
golden helper touches) ships unnoticed, and it is compiled only against TypeScript 5.6.3 while
`api-surface.test.ts` explicitly depends on compiler-internal behaviour that moves across TypeScript
versions.

**Adoption (S).** Give the check job a matrix of three entries,
`{runner: bun, os: ubuntu-latest}`, `{runner: node, node-version: 20, os: ubuntu-latest}` and
`{runner: node, node-version: 24, os: windows-latest}`, with `fail-fast: false`, using
`npx vitest run` on the Node entries. Add a second small matrix axis on the TypeScript devDependency
(5.6 and latest) for the check job only; the windows entry also exercises the CRLF normalisation
that `_goldens.ts` and `api-surface.test.ts` both claim to handle and that nothing currently runs.
Leave `compile-gate` on ubuntu only, since it needs SwiftShader.

### A smoke test over the published package

**TypeScript.** Two separate jobs. `self-check` builds tsc, deletes the built sources and rebuilds
with `--built`, proving the compiler compiles itself; `smoke` produces the LKG, runs `npm pack`,
installs the tarball into an empty scratch directory, runs `npx tsc --version`, pipes a status
request into `npx tsserver` and checks the module format of both entry points with
`ts59/scripts/checkModuleFormat.mjs`, proving the published package works from a consumer's install
(`ts59/.github/workflows/ci.yml:347-365` and `:249-288`).

**TypeShade.** The self-check analogue exists and is stronger than TypeScript's: `compile-gate`
hands every emitted WGSL to Tint and both GLSL stages to a real WebGL2 context, and it validates the
instrument first by feeding each compiler a deliberately broken shader that the compiler must
report, with a `TYPESHADE_GATE_CUT` arm that proves the gate can name a broken example
(`scripts/compile-gate.ts:1-43`; `.github/workflows/ci.yml:36-60`). The smoke half is missing:
`main` and `exports` point at `src/*.ts` so consumers compile the sources (`package.json:29-38`),
`files` ships src plus the tsconfigs (`package.json:39-53`), and nothing ever packs, installs or
imports the package as a consumer would (`package.json:58-66`).

**Gap.** Nothing checks that the published package resolves. `exports` names seven subpaths, six
against `./src/*.ts` and `./examples` against `./examples/index.ts` outside src, while
`API_SUBPATHS` pins only five of them; the `files` list excludes `**/*.test.ts` and
`__emit-goldens__` with negated patterns, and the consumer is expected to typecheck the sources with
their own tsconfig. Any one of those can break, a missing file in `files`, a subpath renamed in
exports and not in files, a relative import the consumer's `moduleResolution` cannot follow, without
a single test failing, because every test imports by relative path inside the repo.

**Adoption (M).** Add a `smoke` job: `npm pack`, then in a temp directory
`npm init -y && npm install <tarball> typescript`, write a consumer file that imports each of the
seven subpaths named in `package.json:30-38` and calls one function from each, and run
`tsc --noEmit` plus `node` over it. Import all seven rather than reusing the `API_SUBPATHS` list
from `src/api-surface.test.ts:69`, which deliberately omits `./compute` and `./examples` and would
leave those two unproven; assert instead that `API_SUBPATHS` is a subset of the exports keys, so the
smoke file and the surface gate cannot disagree about the five they share.

### Format and lint enforced in CI

**TypeScript.** Three separate always-required jobs: `format` runs `npx dprint check` with a cache,
`lint` runs the custom eslint rule set, and `knip` runs an unused-export check, all three listed in
the `required` job's `needs` so none can be skipped. There is a committed `knip.jsonc` and
`eslint.config.mjs`, and a `run-eslint-rules-tests` task that tests the custom rules themselves
(`ts59/.github/workflows/ci.yml:174-218` and `:414-425`; `ts59/knip.jsonc`;
`ts59/eslint.config.mjs`; `ts59/Herebyfile.mjs:553-605`).

**TypeShade.** `format:check` is defined in `package.json:63-65` and `.prettierrc.json` and
`.prettierignore` are committed, but no CI job runs it: the workflow runs only `bun run build`,
`bun run test` and `bun run gate:compile` (`.github/workflows/ci.yml:36-60`). There is no linter at
all, no eslint in devDependencies and no eslint config file (`package.json:67-74`), and no
unused-export check.

**Gap.** The formatter is a convention that CI does not hold, so formatting drifts and a later
`bun run format` produces a reformat commit that buries a real change. The missing unused-export
check matters more than usual here: `src/__api__/surface.md` is a committed list of 399 exports on
`.` alone, and an export that stops being used internally still stays in that snapshot, so
`surface.md` grows monotonically with nothing to say a symbol became dead.

**Adoption (S).** Two lines in `.github/workflows/ci.yml`: add `- run: bun run format:check` to the
existing `check` job after `bun install`. Then add a separate `lint` job with eslint plus
typescript-eslint using a small starting rule set (`no-floating-promises`, `no-unused-vars`,
`consistent-type-imports`), which is the one that needs a config file and a pass over 227 test files
to settle. Do the format line now and the lint job as a follow-up; knip can wait until the
dead-export question is actually live.

### An issue-repro bot

**TypeScript.** A daily workflow, and a `repository_dispatch` the bot triggers on demand, runs the
Twoslash Repro Action over issues that contain code samples, re-compiles each against the current
build and reports which repros still reproduce. It takes a `bisect` input that accepts revision
labels such as `good v4.7.3 bad main` or infers the range, so a regression can be attributed to a
commit from an issue comment (`ts59/.github/workflows/twoslash-repros.yaml:1-68`, including the
bot-provided `distinct_id`, `source_issue`, `requesting_user` and `status_comment` inputs and the
`blob:none` full-depth checkout that bisect needs).

**TypeShade.** No issue automation, no bot and no scheduled workflow of any kind; the three triggers
in `.github/workflows/ci.yml:20-26` are push to main, pull_request and workflow_dispatch, and
`ci.yml` is the only file in `.github/workflows`.

**Gap.** The mechanism does fit, since a `"use typeshade"` code block in an issue is exactly the
unit `compileTsSource` takes and the compile gate would say whether the emit is still a program.
What is missing is everything the mechanism sits on: there is no published build to bisect against,
no issue corpus, and no bot identity.

**Adoption (L).** Not yet. The bisect half is useless without the nightly publish and the repro half
is useless without issue traffic, so this is downstream of both. When it becomes worth doing, the
cheap first version is a scheduled job that extracts fenced typescript blocks tagged with a
`typeshade-repro` label from open issues, runs each through `compileTsSource` plus `emitModule`, and
comments the diagnostics, without bisect.

### A reducible sample count for the property suites

**TypeScript.** The test runner forks worker processes and distributes tasks from a host, exposed as
`hereby runtests-parallel` with `--workers=<n>`. The test config supports `shards` and `shardId` for
splitting a run across CI machines, a `--light` mode that skips the expensive invariant assertions,
and `--keepFailed` for re-running only the last failures
(`ts59/src/testRunner/parallel/host.ts:1-40`; `ts59/src/testRunner/runner.ts:96-146`;
`ts59/src/harness/harnessIO.ts:174-217`, `shouldAssertInvariants = !lightMode`;
`ts59/Herebyfile.mjs:814-838`).

**TypeShade.** Vitest's default worker pool, no shard flag, and a global 30-second per-test timeout
raised from vitest's 5-second default solely because the df64 property suites need it
(`vitest.config.ts:6-9` and `:15`). The sample count is a hardcoded `const N = 20000`, identical on
a developer laptop and a 4-core CI container, and the flakiness is documented in the file itself:
the suite measured 58 s on one runner and 65 s on another, and vitest's worker RPC to its host times
out at 60 s, so the file added an event-loop turn every 1000 samples to keep the reply readable
(`src/core/fp64/df64-int-property.test.ts:84` and `:86-101`; `df64-property.test.ts:92` carries the
same constant, while the sibling suites `df64-sincos.test.ts` and `df64-known-answer.test.ts` sweep
fixed small bounds instead and have no `const N`).

**Gap.** The suite is deterministic, a seeded mulberry32 with no `Math.random`, so it is not flaky
in its assertions; it is flaky in its wall clock, and the only knob is a timeout already raised
sixfold. There is no way to run a cheaper sweep on a PR and the full sweep on a schedule, and as
more property suites are added the whole suite drifts toward the same cliff.

**Adoption (S).** Replace `const N = 20000` with
`const N = Number(process.env.TYPESHADE_SAMPLES ?? 20000)` in the two files that have it,
`src/core/fp64/df64-int-property.test.ts:84` and `src/core/fp64/df64-property.test.ts:92`, set
`TYPESHADE_SAMPLES=4000` in the CI check job, and run the full 20000 in the nightly workflow. Keep
the assertions and seeds identical so a failure at 4000 is a real failure. The other two df64 suites
need nothing: their loops are fixed small bounds, not a sample sweep.

### A public API baseline with its own CI signal

**TypeScript.** The bundled `typescript.d.ts`, 11437 lines including the `ts.server.protocol`
namespace, is checked in as a baseline under `ts59/tests/baselines/reference/api/typescript.d.ts`,
and a unit test reads the freshly built d.ts and runs it through the ordinary baseline machinery
with `PrintDiff`, so an API change fails the run with a diff
(`ts59/src/testRunner/unittests/publicApi.ts:9-28`). The Go repository runs it as its own CI step,
`npx hereby test:api` (`ts-main/.github/workflows/ci.yml:221`), and a second CI job comments on any
PR whose diff touches the baseline, pointing the author at the wiki's API Breaking Changes page and
naming the two people who must be told (`ts59/.github/workflows/pr-modified-files.yml:121-135`).

**TypeShade.** Already adopted, and in one respect ahead: `src/__api__/surface.md` records not only
the exported names per subpath but one line of shape per definition, member lists with optionality
and spelled-out unions, 1245 lines covering 399 exports on `.` plus four other subpaths, with 31
exports on `./language-service` (`src/__api__/surface.md:1-13` and `:722-757`). The reader carries
three anti-vacuity arms, a per-subpath export floor, a no-blank-kind-or-shape arm, and an arm
rejecting compiler-internal symbol ids such as `__@iterator@173` that would re-bake the file on a
TypeScript upgrade (`src/api-surface.test.ts:1-50` and `:242-283`), `bun run bake:api-surface` is
the re-bake (`scripts/bake-api-surface.ts`; `package.json:62`), and
`src/api-doc-coverage.test.ts:1-20` fails when a public export has no doc comment, which TypeScript
has no equivalent of.

**Gap.** Small and specific, on two axes. The gate runs inside the ordinary vitest run, so it fails
alongside 226 other test files and its diff is buried in the middle of the output rather than
reported as its own signal, which is exactly why TypeScript makes it a distinct CI step. And nothing
distinguishes an addition from a removal or a shape change, so nothing tells a reviewer that a given
diff is a break for a consumer; TypeScript solves that with a bot and a wiki page rather than with
tooling.

**Adoption (S).** Add
`"test:api": "vitest run src/api-surface.test.ts src/api-doc-coverage.test.ts"` to `package.json`
and give it its own job in `ci.yml` alongside `check`, so a surface change is a named red check on
the PR, with no change to the test itself. Then add `docs/api-breaking-changes.md` with one section
per release or per mirror SHA range, and a line in the PR template (or in `AGENTS.md`, which the
repo already uses for this kind of rule) saying that a diff which removes a line from
`src/__api__/surface.md` or changes a line in its shapes section must add an entry there.
Optionally teach `bake:api-surface` to print removals and shape changes separately from additions so
the reviewer sees the classification without reading the whole diff.

### A size metric against the base branch

**TypeScript.** A `package-size` job that runs only on pull_request checks out both the PR and the
base branch, builds the LKG in each, and runs `checkPackageSize.mjs` comparing the two, writing the
result to the GitHub step summary so the delta is visible on the PR without opening logs
(`ts59/.github/workflows/ci.yml:289-330`).

**TypeShade.** No size measurement. Emitted shader size is pinned only implicitly, as bytes inside
the goldens, and there is a minify path whose whole purpose is to make the output smaller with
nothing reporting by how much (`src/core/emit-minify.test.ts`, `src/core/emit-prune.test.ts`,
`examples/minify-safety.test.ts`); the npm package size is source size, since exports point at
sources (`package.json:26-35`).

**Gap.** For a shader compiler the interesting size is not the npm package but the emitted shader,
WGSL and GLSL length per example, minified and not. That number is the entire value of the prune and
minify passes and nothing states it, so a pass that regresses output size by 20 percent shows up
only as a large golden diff that a reviewer reads as "the text changed".

**Adoption (M).** Add a step to the check job that, on pull_request, emits every example at both
minify settings for both targets in the PR tree and in the base tree and writes a per-example
byte-count table with deltas to `$GITHUB_STEP_SUMMARY`; the dual-checkout shape at
`ts59/.github/workflows/ci.yml:289-330` is directly reusable. Cheap version first: print the table
for the PR only, with no base comparison, which needs no second checkout.

### A coverage run per commit

**TypeScript.** A dedicated coverage job runs the full suite with `--coverage`, uploads the result
as an artifact, and posts it to codecov with OIDC, disabled for fork PRs
(`ts59/.github/workflows/ci.yml:140-172`).

**TypeShade.** No coverage instrumentation, no reporter and no threshold; vitest supports it with a
flag and a provider dependency and neither is configured (`vitest.config.ts:12-17`;
`package.json:60`; `.github/workflows/ci.yml:36-47`).

**Gap.** 227 test files with no statement on what is unreached. The specific blind spot worth
knowing about is the backends: `src/core/backends` has ten test files against a WGSL and a GLSL
emitter plus a legalizer, and the goldens only exercise the 42 example shaders, so whole emitter
branches, the absent-builtin fallbacks and the GLSL legalization paths, may have no coverage at all
while the suite is green.

**Adoption (S).** Add `@vitest/coverage-v8`, set
`coverage: { provider: 'v8', reporter: ['text-summary','json'] }` in `vitest.config.ts`, and add a
CI step that prints the summary. Do not set a global threshold, which becomes a number people game;
read the per-directory numbers once for `src/core/backends` and `src/language-service` and turn
whatever holes that reveals into tests.

## Language service and editor tooling

### A tsserver plugin as the delivery vehicle

**TypeScript.** tsserver loads a plugin named in tsconfig `compilerOptions.plugins`, calls its
factory with `{ typescript }`, and hands `create()` a `PluginCreateInfo` carrying the project, the
real `LanguageService`, the `LanguageServiceHost`, the `ServerHost`, the `Session` and the plugin's
own config entry. Whatever `create()` returns replaces the project's language service, and tsserver
patches any method the returned object is missing back from the original, so a plugin only overrides
the handful it cares about; the canonical plugin body is a pass-through proxy over every key of the
original service with one or two methods wrapped (`ts59/src/server/project.ts:251-271` and
`:2144-2178`; `ts59/src/compiler/types.ts:7358-7360` and `:7506`;
`ts59/src/harness/harnessLanguageService.ts:21-32` and `:507-517`;
`ts59/src/testRunner/unittests/tsserver/plugins.ts:24-42`).

**TypeShade.** No plugin exists anywhere. The service is a standalone `createTypeshadeLanguageService`
that builds its own `ts.LanguageService` over its own document store and its own compiler options
(`lib: []`, `types: []`, `experimentalDecorators: true`, `strictPropertyInitialization: false`) with
the ambient lib served as a virtual file at `typeshade:shade.d.ts`
(`src/language-service/service.ts:50-102`; `src/language-service/host.ts:15-25`, `:41-58`, `:32`
and `:218`). The design doc assumes an LSP server in a separate repository as the only editor path
and marks it not started (`docs/language-service-api.md`, section 1 and section 10 item
8); `package.json` has no `bin`, no `plugins` and no vscode entry.

**Gap.** Feasible, with one hard boundary. A plugin can decorate what it is given: filter the known
TypeScript false positives per file, the TS1206 rule already exists in `diagnostics.ts`, append
TypeShade diagnostics from the front end, merge the attribute and builtin completion items, and
rewrite quick info so a local reads `f32` rather than `number`. What it cannot do is change the
program: `PluginCreateInfo` hands over a `LanguageService` built from the user's own tsconfig, so
`lib: []`, `types: []`, `experimentalDecorators` and `strictPropertyInitialization: false` are the
user's settings and the ambient lib is not in the program unless a real `shade.d.ts` is installed
and referenced. Today that file does not exist, `SHADE_DTS` being only a string the service loads
virtually, which section 9 already lists as deferred, so TS2304 and TS2349 would come back for
plugin users unless the plugin holds its own private `createTypeshadeLanguageService` per
`"use typeshade"` file, which is how the Vue and Svelte plugins work.

**Adoption (L).** Ship the `shade.d.ts` file and `"types"` entry that section 9 defers first, then
add a `packages/typeshade-plugin` whose `create(info)` returns a `makeDefaultProxy`-style proxy over
`info.languageService`, keeping one private `createTypeshadeLanguageService` keyed by file for
documents whose text carries the directive. Override exactly five methods:
`getSemanticDiagnostics` (drop the filtered codes, concat the TypeShade list),
`getSyntacticDiagnostics` (pass through), `getCompletionsAtPosition` (concat TypeShade context
items), `getQuickInfoAtPosition` (replace the type text with the shader type) and
`getEncodedSemanticClassifications` (add the gpu, entry and resource modifiers). Write down in the
same PR the tsconfig settings a plugin user must set, since the plugin cannot set them, and
implement `onConfigurationChanged` so the editor's `configurePlugin` command can toggle the
diagnostic filter without a restart.

### The editor client in the compiler repository

**TypeScript.** TypeScript's current main is the Go implementation, and its VS Code extension lives
inside the compiler repository as `packages/vscode-typescript` plus a nightly twin; `git ls-tree`
on main lists `packages/typescript`, `packages/vscode-typescript` and
`packages/vscode-typescript-nightly`. It speaks LSP through `vscode-languageclient/node`, not the
tsserver protocol (`ts-main/packages/vscode-typescript/src/client.ts:1-42`), declares the extension
`native-preview` with `js/ts.trace.server` and tsdk settings
(`ts-main/packages/vscode-typescript/package.json`), and registers its own extra features, multi
document highlight, hover verbosity, auto insert and source definition, as client-side additions on
top of the standard LSP surface (`ts-main/packages/vscode-typescript/src/languageFeatures/`).

**TypeShade.** The design doc rules that the Language Server and the VS Code extension live in a
separate repository, `typeshade/vscode-typeshade`, and are not started until the package installs
from npm (`docs/language-service-api.md`, section 1 last bullet and section 10 item 8). Neither
repository nor extension exists, and `package.json` has no `bin` and no workspace `packages/`.

**Gap.** TypeShade's separation rule was set before this benchmark. TypeScript, which has far more
reason to keep an editor client out of the compiler repo, does the opposite on main: client and
server version together in one repo, so a protocol change and its client change land in one PR. A
separate `vscode-typeshade` repo makes every protocol change a two-repo dance while the service is
still moving weekly, which is the phase TypeShade is in.

**Adoption (L).** Amend design doc section 1 to put the LSP server and the VS Code client in this
repository as `packages/typeshade-lsp` and `packages/vscode-typeshade`, with the same rule
TypeScript follows: the client may add editor-only features, never shader semantics. Keep the
published npm package boundary as it is, since a workspace package does not change what
`typeshade` exports, and reuse the site's `typeshade-syntax.mjs` TextMate grammar in the
client rather than writing a second one.

### Editor semantics in the service, adapters as conversion

**TypeScript.** The formatting README states the formatter is not exported publicly and all usage
comes through the language server, and the VS Code client on main is a client, holding transport,
configuration middleware and a few editor-only feature registrations, with the semantics in the
server it talks to (`ts59/src/services/formatting/README.md`, closing paragraph;
`ts-main/packages/vscode-typescript/src/client.ts:1-42` and
`ts-main/packages/vscode-typescript/src/configurationMiddleware.ts`).

**TypeShade.** The rule is written and is not followed. Design doc section 1 says adapters do
coordinate conversion, debouncing, marker ownership, JSON-RPC and nothing semantic, and that if an
adapter grows logic about TypeShade, that logic belongs in the service
(`docs/language-service-api.md`, section 1 rules and section 10 item 7). The Playground is 1282
lines that import the PR #6 compatibility shim by a deep path into a vendored checkout rather than
the `./language-service` subpath, construct `new TypeshadeLanguageService({ fileName })`, then call
`getDiagnostics(source)`, `getCompletions(model.getValue(), ...)` and `getHover(model.getValue(),
...)` with the whole text on every request, re-opening and re-closing a temporary document per
keystroke, and hold their own Monaco severity mapping
(`typeshade.github.io/src/scripts/playground.ts:6-23`, `:429`, `:995`, `:1218`, `:1235` and
`:987-1010`; `src/language-service.ts:1-6`). The Monaco adapter is listed as not started.

**Gap.** The one rule the design doc states most firmly is the one currently broken, and in the
direction that costs the most: the only shipped consumer uses the compatibility shim rather than the
document API, so it pays a full open and close per keystroke, and it holds Monaco severity and
marker logic that a future VS Code client will have to reimplement rather than reuse. Every
additional week of Playground features written this way is work the LSP adapter will duplicate.

**Adoption (M).** Add `src/language-service/monaco.ts` exported as the `./language-service/monaco`
subpath: it owns the plus-one coordinate conversion, the single `typeshade` marker owner, the
completion kind mapping and the debounce, and calls `openDocument`, `updateDocument` and
`closeDocument` on one long-lived service. Move the corresponding code out of `playground.ts` and
have the site import the subpath, not a deep vendored path. That fixes the per-keystroke re-parse
the design doc already flags and gives the LSP server a reference adapter to copy. Do it before the
plugin or LSP work starts, since it decides what those two get to reuse.

### The protocol as a written artifact

**TypeScript.** `ts59/src/server/protocol.ts:50-207` declares `CommandTypes` with 114 named
commands, public and `@internal` ones side by side with deprecations marked in place, and every
request, response and argument interface next to it carries prose doc comments;
`ts59/src/server/session.ts:3404-3813` maps each command to one handler, 112 handler entries in one
table. A CI job comments on any PR that touches `protocol.ts`, naming the four people who review
protocol changes and reminding the author that consumers depend on it
(`ts59/.github/workflows/pr-modified-files.yml:108-119`).

**TypeShade.** `docs/language-service-api.md` is 594 lines and is the protocol document, but it is
headed "draft for review, nothing here is frozen" (`:1-6`), its section 0 documents the superseded
PR #6 shape at length (`:12-77`), and the interface in section 4 is a hand copy of the one in
`service.ts` (`:267-308` against `src/language-service/service.ts:50-102`: the same sixteen members
in the same order with identical signatures today, the code's own doc comments being the richer
text, and nothing that would catch it if they diverged). Nothing checks the two against each
other.

**Gap.** TypeShade has the prose but not the artifact. There is no single enumerated list of
operations that an adapter author can hold against the code, no generated table, and no check that
fails when a method is added to `TypeshadeLanguageService` and not to the document. The doc's own
"nothing is frozen" line tells an adapter author not to rely on it, which is the opposite of what a
protocol document is for.

**Adoption (M).** Split the document: move section 0 into a short appendix or delete it now that the
shim exists, and promote sections 2, 3, 4 and 7 to a frozen contract with a status line saying so.
Generate the section 4 method table from `src/language-service/service.ts` with the same TypeScript
compiler API reader `api-surface.test.ts` already uses, write it into the doc between markers, and
add a test that fails when the generated block and the interface disagree, so a new method cannot
land undocumented. Then add the equivalent of TypeScript's PR notice as a line in `AGENTS.md`: a
change to the `service.ts` interface is a protocol change and says so in its PR body.

### A custom protocol command for compiled output

**TypeScript.** `Session.addProtocolHandler(command, handler)` lets a plugin register a brand new
protocol command at load time, refusing a duplicate, and the plugin gets the `Session` through
`PluginCreateInfo.session`; the test plugin uses exactly this to add a command of its own and answer
it from the language service (`ts59/src/server/session.ts:3815-3820`;
`ts59/src/server/project.ts:251-257`; `ts59/src/testRunner/unittests/tsserver/plugins.ts:27-37`).

**TypeShade.** `getCompiledOutput(uri, target)` exists on the service and returns the WGSL or GLSL
text with its diagnostics (`src/language-service/service.ts:91-96` and `:344-386`), but nothing
transports it to an editor; its only consumer is the Playground, which calls the service directly in
the page (`docs/language-service-api.md`, section 7).

**Gap.** `getCompiledOutput` is the one TypeShade method with no counterpart anywhere in TypeScript's
interface, which means no standard protocol or LSP request carries it. Without a deliberate
transport, a plugin or LSP server would simply drop the most distinctive thing the service can do,
showing the emitted shader beside the source.

**Adoption (S).** Define one custom command name now, `typeshade/compiledOutput`, with its request
and response shapes written into design doc section 7 next to the adapter contracts. Under the
plugin, register it with `info.session.addProtocolHandler`; under LSP, expose the same payload as a
`workspace/executeCommand`; in Monaco it is a direct call. One name and one payload shape across all
three, so the VS Code side panel and the Playground output pane are the same feature.

### Quick fixes registered against diagnostic codes

**TypeScript.** `registerCodeFix` puts each fix in a multimap keyed by the error codes it handles,
and `getSupportedErrorCodes` reports that key set so an editor knows which squiggles are actionable;
a registration declares `errorCodes` and `getCodeActions`, which builds text changes through a
`ChangeTracker`, and the public entry point dispatches by the code the editor passes. 73 files under
`ts59/src/services/codefixes` hold 72 registrations, and the action's own description is a
message-table entry in the 95xxx range, so fix titles are translated like everything else
(`ts59/src/services/codefixes/addMissingConst.ts:27-45`;
`ts59/src/services/codeFixProvider.ts:28`, `:29-62`, `:52-62`, `:64-68`, `:69-84`, `:85-90`;
`ts59/src/services/services.ts:2688-2699`; `ts59/src/services/types.ts:657-658`;
`ts59/src/compiler/diagnosticMessages.json:7866-7869`, code 95081, the fix description). The
spelling fix is registered for twelve codes, ten of them the "Did you mean" family and two of them
JSX cases (`ts59/src/services/codefixes/fixSpelling.ts:46-74`).

**TypeShade.** None. There is no `getCodeFixes`, no code action and no text-edit production anywhere
in the language service, which exposes completions, hover, navigation, semantic tokens, signature
help, symbols, rename and diagnostics (`src/language-service/service.ts:50-102`; there is no codefix
or codeaction module under `src/language-service/`, and a grep for `getCodeFixes` or `CodeAction`
over `src` returns nothing). The only fix concept in the repository is the lint engine's
`rule.fix(module)` returning a module, implemented by two rules, which rewrites IR and produces no
source edits (`src/core/passes/lint/engine.ts:89-91` and `:352-367`;
`src/core/passes/lint/rules/no-self-assign.ts:24`; `prefer-let-over-var.ts:80`).

**Gap.** TypeShade computes the answer and makes the user retype it. The int/float mismatch message
says to cast with `f32()` or `i32()` or `u32()`; the entry-IO struct field message says the field
needs `@builtin(...)` or `@location(...)`; the unknown attribute and unknown builtin messages already
compute and print a nearest-match suggestion
(`src/compiler/ts/builtin-check.ts:126-132`, `:147-149` and `:235-237`; the codes are tabulated at
`docs/language-service-api.md`, section 6). At least four codes are mechanically fixable, and this
is the single highest value missing feature group for an authoring language, because the diagnostics
are already precise and already carry spans.

**Adoption (L).** Add `getCodeFixes(uri, range, codes?)` to `TypeshadeLanguageService` returning
`{ description, edits, fixId? }`, backed by `src/language-service/codefixes/` with a
`registerCodeFix({ codes, create })` multimap keyed by the TS8xxx string, mirroring
`codeFixProvider.ts`, and export a `getSupportedFixCodes()` so an adapter can mark which diagnostics
are actionable. Ship four fixes first, chosen because the message already names the edit: TS8028 and
TS8024 spelling, replacing the token span with the suggestion the compiler already computed; TS8029
insert `@location(n)` with the next free location on that struct; TS8003 int and float mismatch,
wrapping the offending operand in `f32()`, `i32()` or `u32()`; and TS8021 insert the return type
annotation the front end already inferred. Make `suggestBuiltinName` and `suggestAttributeName`
return the suggestion to the fix directly instead of the fix re-parsing it out of the message text,
and put the fix titles in the message table so they translate with everything else.

### Fix-all across a document

**TypeScript.** A fix declares `fixIds` and `getAllCodeActions`; `codeFixAll` walks every diagnostic
in scope carrying the fix's codes and applies the same change through a single `ChangeTracker`, and
the public `getCombinedCodeFix` is the batch entry point. 67 of the 72 registrations carry a
`fixId`, the fix-all description is its own message-table entry, and the `fixId` is stripped from a
single action when fewer than two diagnostics in the file are fixable, so the editor does not offer
a pointless batch (`ts59/src/services/codeFixProvider.ts:69-80`, `:92-96` and `:110-118`;
`ts59/src/services/services.ts:2700`; `ts59/src/services/codefixes/addMissingConst.ts:37-44`;
`ts59/src/compiler/diagnosticMessages.json:7870`).

**TypeShade.** Nothing at source-text level. The nearest analogue is the lint engine's `applyFixes`,
which folds a whole module through every fixable rule at once; it has no per-diagnostic scope, no
per-rule selection and produces IR, not edits, and its doc comment notes the caller must re-verify
the emitted WGSL afterwards (`src/core/passes/lint/engine.ts:349-367`).

**Gap.** There is no gap today because there are no fixes, but it becomes one the moment the fix
registry lands, and retrofitting a batch mode onto fixes that were written one-shot is more work
than designing for it.

**Adoption (M).** Design the fix registry with TypeScript's split from the first commit:
`getActions` for one diagnostic and `getAllActions` for every diagnostic in the document sharing the
fix's codes, a `fixId` string per fix, and the rule that a batch is only offered when two or more
diagnostics are fixable. Implement the batch for the two fixes that actually repeat, the spelling
fix and the `@location` insertion, since a file with one unattributed struct field usually has
several.

### A change tracker for edit-producing features

**TypeScript.** One `ChangeTracker` class is the single way code fixes, refactors, organize imports
and file rename edits produce text. It is created from a context, accumulates typed operations
(delete a node, replace a node with nodes, insert at top of file, insert a modifier, insert a JSDoc
tag, insert into a list after a node, parenthesize an expression), then `getChanges()` renders them
all to `FileTextChanges` in one pass with formatting applied and an optional validator over the
non-formatted text; `ChangeTracker.with(context, cb)` is the idiom every fix uses and
`applyChanges(text, changes)` applies a change list to a string for tests. It is 1869 lines, which is
the measure of how much of this is not trivial (`ts59/src/services/textChanges.ts:493-506`,
`:524-605`, `:607-664`, `:1179-1190`, `:1364`).

**TypeShade.** `TypeshadeTextEdit` exists as a type, a range plus replacement text
(`src/language-service/types.ts:41-47`), and `rename` returns a record of uri to edits
(`src/language-service/service.ts:82-87`; `src/language-service/navigation.ts`), but the edits come
straight from TypeScript's `findRenameLocations` and nothing in the repo constructs an edit of its
own. There is no builder, no overlap check and no apply helper.

**Gap.** The moment the code fixes land, three or four fixes will each splice strings by hand and
each get trivia and ordering slightly differently. TypeScript's answer is one tracker. TypeShade
does not need the node-printing half of it, since its fixes replace identifiers and insert
attributes rather than whole declarations, but it does need the collection, ordering and overlap
half.

**Adoption (S).** Write `src/language-service/edits.ts` with an `EditBuilder` that holds a per-uri
list and exposes `replaceRange`, `replaceNode(node, text)`, `insertBefore(node, text)` and
`insertAt(offset, text)` taking `ts.Node`s so spans come from `getStart()` and `getEnd()` the way
diagnostics already do, plus a `build()` that sorts descending by start, asserts no two edits
overlap, and returns the `Record<uri, TypeshadeTextEdit[]>` shape rename already returns. Add
`applyEdits(text, edits)` for tests, have every code fix go through it and nothing else, and do not
port the node printer or the formatting pass.

### Refactors as a selection-driven catalogue

**TypeScript.** `getApplicableRefactors` lists what is offered at a position or range,
`getEditsForRefactor` computes the edits for a chosen refactor and action, and
`getMoveToRefactoringFileSuggestions` supplies extra arguments for the interactive ones;
`ts59/src/services/refactorProvider.ts` registers them and `ts59/src/services/refactors/` holds 16
files with 15 `registerRefactor` calls, each naming its kinds (for example
`refactor.extract.function`) plus `getAvailableActions` and `getEditsForAction`
(`ts59/src/services/refactors/extractSymbol.ts:180-187`; `ts59/src/services/types.ts:676-678`;
`ts59/src/services/services.ts:3294-3297` and `:3321-3332`). The catalogue includes extract function
and constant, extract type, inline variable, convert to optional chain, convert parameters to a
destructured object, and move to file. A refactor is deliberately a separate axis from a code fix:
it applies to correct code and is offered by selection, not by error code.

**TypeShade.** None, and no equivalent concept. The service has no selection-driven action of any
kind, the only structural rewrite in the repository is rename
(`src/language-service/service.ts:50-102`), and the documented order of work lists no refactor stage
(`docs/language-service-api.md:540-583`).

**Gap.** The generic refactors, extract function, convert to arrow, move to file, are mostly wrong
for a shader unit, where a function must obey WGSL rules and a file is a compilation unit with its
own bindings. The shader-specific ones are genuinely valuable and have no equivalent anywhere else:
convert class struct to type alias and back, which is the mechanical inverse of the documented rule
that field metadata requires a class field while plain data may be a type alias, so a class with no
decorated field converts by pure syntax; turn a loose entry parameter list into an IO struct with
`@location` indices assigned; split one entry point into vertex and fragment halves; promote a
constant to an `override`. Extract helper function is natural given that the front end already
lowers a set of top-level functions, but it needs free-variable analysis over the selection plus a
check that the extracted body carries no entry attribute and no host statement.

**Adoption (L).** Later, after quick fixes have proved the edit builder. Then add
`getApplicableRefactors(uri, range)` and
`getEditsForRefactor(uri, range, refactorName, actionName)` with a registry mirroring the code fix
one (kinds, `getAvailable`, `getEdits`), and ship one refactor first: extract entry IO into a
struct, which exercises the hard parts, multi-node edits, attribute index assignment and a new
declaration inserted at the right place. Convert class struct to type alias and back is the second,
verified by recompiling the file and asserting identical WGSL. Extract function should wait until
the front end exposes the scope information `lower/function.ts` already computes, because a wrong
extraction silently changes emitted shader code. Do not port TypeScript's generic refactors and say
so in the design doc so nobody tries.

### Inlay hints

**TypeScript.** `provideInlayHints(fileName, span, preferences)` is a first-class language service
member backed by `ts59/src/services/inlayHints.ts`, reached over the protocol as `provideInlayHints`,
and the hints are preference-gated per category, parameter names, variable types, return types and
enum member values (`ts59/src/services/types.ts:628`; `ts59/src/server/protocol.ts:202`;
`ts59/src/server/session.ts:3804-3806`; the four preference flags at
`ts59/src/compiler/types.ts:10478-10485`).

**TypeShade.** Nothing. The service has hover, which is pull-based
(`src/language-service/hover.ts`), and semantic tokens, which colour but do not annotate
(`src/language-service/service.ts:50-102`). The design doc's own table says hover is where the
TypeShade type name replaces TypeScript's `number` (`docs/language-service-api.md`, section 5
`getHover` row).

**Gap.** Inlay hints fit a shader language better than they fit TypeScript, because the three things
a shader author most wants to see are all inferred and all invisible in the source: the GPU type of
an unannotated local, where `f32` against `i32` decides whether a division truncates, the
`@location` index the compiler assigned to a struct field, and the group and binding slot the
reflection pass gave a resource. All three are already computed by the front end and by `pack.ts`.

**Adoption (M).** Add `getInlayHints(uri, range)` returning `{ position, label, kind }` and implement
three kinds behind flags on the host: the inferred shader type after a `let` or `const` with no
annotation, the resolved `@location(n)` on an entry IO struct field that has none written, and the
group and binding pair beside each resource declaration. Source all three from the cached front-end
analysis the diagnostics path already builds, so there is no second parse.

### A suggestion channel separate from errors

**TypeScript.** `getSuggestionDiagnostics(fileName)` is its own member with its own file and its own
protocol command, `suggestionDiagnosticsSync`, documented in the interface as proactively suggesting
refactors as opposed to indicating incorrect runtime behaviour, and editors render them differently
from errors (`ts59/src/services/types.ts:506-513`; `ts59/src/services/suggestionDiagnostics.ts`;
`ts59/src/server/protocol.ts:98`).

**TypeShade.** One `getDiagnostics(uri)` returning everything
(`src/language-service/service.ts:58-59` and `:270-275`; `src/language-service/diagnostics.ts`),
with a four-value severity vocabulary that includes `hint` but nothing that produces a hint today
(`src/language-service/types.ts:49-50`); the merged list is TypeScript diagnostics plus TypeShade
diagnostics, both of them errors and warnings.

**Gap.** A shader compiler has an unusually rich supply of advice that is not an error: a dynamically
indexed array that will be lowered to a branch chain, an unused varying that still costs an
interpolator slot, or a `pow(x, 2.0)` that should be a multiply. Putting those in `getDiagnostics` would make the
error count wrong and would make the Playground's "zero errors, now compile" gate unreliable, since
that gate reads the same list.

**Adoption (M).** Add `getSuggestionDiagnostics(uri)` returning the same `TypeshadeDiagnostic` shape
with `severity: 'hint'`, computed from the same cached front-end analysis so there is no second
parse, and keep `getDiagnostics` exactly as it is. Seed it with two shader-specific hints, an unused
entry IO field and a dynamic index into a fixed-size array. State in design doc section 7 that
adapters must give it a separate marker owner from `getDiagnostics`, and that the Playground's
compile gate reads only `getDiagnostics`.

### The rest of the navigation family

**TypeScript.** Beyond definition and references the interface carries
`getDocumentHighlights(fileName, position, filesToSearch)`, `getTypeDefinitionAtPosition`,
`getImplementationAtPosition`, `getFileReferences(fileName)` and `getDefinitionAndBoundSpan`, each
with its own protocol command and, for highlights, a dedicated file
(`ts59/src/services/types.ts:606-623`; `ts59/src/services/documentHighlights.ts`;
`ts59/src/server/protocol.ts:107-109` and `:83-85`).

**TypeShade.** `getDefinition` and `getReferences` only, both delegating to TypeScript and
re-labelling results (`src/language-service/service.ts:66-72`; `src/language-service/navigation.ts`).

**Gap.** Document highlights is the visible one: highlighting every occurrence of the identifier
under the cursor is the feature users notice immediately and is the cheapest of the four, since it
is `getReferences` restricted to the current document. Type definition and implementation have
little meaning in a language with no interfaces and no classes, and file references, which files
import this shader, becomes meaningful only with multi-file units.

**Adoption (S).** Add `getDocumentHighlights(uri, position)` now, implemented as `getReferences`
filtered to `uri` with a read or write kind per location, a handful of lines over what
`navigation.ts` already does. Skip `getTypeDefinitionAtPosition` and `getImplementationAtPosition`
and say why in the design doc, that TypeShade has no nominal supertypes or interfaces for them to
land on, and add `getFileReferences` with the multi-file document store, not before.

### Call hierarchy

**TypeScript.** Three language service members, `prepareCallHierarchy`,
`provideCallHierarchyIncomingCalls` and `provideCallHierarchyOutgoingCalls`, backed by
`ts59/src/services/callHierarchy.ts`, each with its own protocol command
(`ts59/src/services/types.ts:624-626`; `ts59/src/server/protocol.ts:199-201`).

**TypeShade.** None. `getReferences` and `getDefinition` delegate to TypeScript and
`getDocumentSymbols` gives an outline with children, but there is no call graph view
(`src/language-service/service.ts:66-74`; `src/language-service/navigation.ts`).

**Gap.** Shader files are small, so the generic "navigate a large call graph" motivation is weak. The
shader-specific motivation is not: WGSL forbids recursion, every function is ultimately reachable
from an entry point or is dead, and a helper's behaviour depends on which stage calls it, since a
`@builtin` valid under `@fragment` is invalid under `@vertex`. The interesting query is therefore
which entry points reach this function, which is incoming calls transitively closed to entries.

**Adoption (M).** Defer the generic three-method port. When it comes, implement it over the front
end's collected `FuncDecl` list rather than over TypeScript's references, and make the incoming call
result carry the reachable entry stages, so the answer to "which stage am I in" is one keystroke.
Until then, record the same information cheaply as a hover line on a helper function, reached from
`@vertex vs_main`, which needs no new protocol method.

### Outlining spans and folding ranges

**TypeScript.** `getOutliningSpans(fileName)` is served by
`ts59/src/services/outliningElementsCollector.ts` and reaches editors as the `getOutliningSpans`
command; it covers more than braces, including comment regions and `#region` markers
(`ts59/src/services/types.ts:630`; `ts59/src/server/protocol.ts:147-149`).

**TypeShade.** No outlining. `getDocumentSymbols` returns a nested tree with `range` and
`selectionRange` per symbol, which is the same information for declarations but is consumed as an
outline, not as folding regions (`src/language-service/service.ts:74`;
`src/language-service/types.ts:126-140`).

**Gap.** Real but nearly free, and its value depends entirely on the delivery vehicle. Under a
tsserver plugin, or in Monaco with the TypeScript worker present, the editor already folds a
`.shade.ts` file because it is TypeScript, so TypeShade would add nothing. Only a standalone LSP
server that owns the file type has to provide it, and even then it can be derived from what
`getDocumentSymbols` already returns.

**Adoption (S).** Do not write a collector. When the LSP server lands, have the server synthesise
folding ranges from the `range` field of `getDocumentSymbols`, one range per struct and per
function, plus a trivial brace scan, which is a dozen lines in the adapter. Revisit a real
`getOutliningSpans` only if TypeShade ever gains a construct whose folding boundaries are not a
symbol's range.

### Workspace-wide symbol search

**TypeScript.** Three distinct navigation members: `getNavigateToItems(searchValue, ...)` searches
symbols across the project with a fuzzy pattern matcher, `getNavigationBarItems` gives the
dual-column bar shape, and `getNavigationTree` gives the nested tree, with
`ts59/src/services/patternMatcher.ts` as the shared matcher (`ts59/src/services/types.ts:620-622`;
`ts59/src/services/navigateTo.ts`).

**TypeShade.** `getDocumentSymbols(uri)` only, per document. The front-end analysis it reads is
already cached per document and per dependency key, so a second call costs nothing
(`src/language-service/service.ts:74` and `:305-309`, reading `entryOf` at `:230-237`;
`docs/language-service-api.md:486-498` and `:567-569`, which record that cache as done).

**Gap.** There is no way to ask where the `pbr` helper is across a multi-file shader unit. The
service already holds every open document plus the imported ones, so the data is there; only the
query is missing. It matters once multi-file units work, which design doc section 11 lists as an
open item.

**Adoption (S).** Add `getWorkspaceSymbols(query, maxResults?)` returning `TypeshadeDocumentSymbol`
plus a `uri`, implemented as `getDocumentSymbols` over every open and imported document with a
simple prefix and camel case match, and skip TypeScript's full pattern matcher. Land it in the same
change that fixes the multi-file document store. No new caching work is needed: the per-document
analysis is already cached, so the query is a loop over open and imported documents.

### Cancellation and delayed diagnostics

**TypeScript.** The host supplies a `HostCancellationToken` with a single
`isCancellationRequested()`, which the checker polls. On the server side, `geterr` computes nothing
synchronously: it starts a multistep operation that delays by the client-supplied number of
milliseconds and yields between files, so a new keystroke cancels the outstanding check rather than
queueing behind it (`ts59/src/services/types.ts:254-256`; `ts59/src/server/session.ts:3636-3639`
and `:365-405`).

**TypeShade.** Nothing in the service is asynchronous and there is no cancellation token; the design
doc assigns cancellation to the adapter, which is told to drop results whose version is stale
(`docs/language-service-api.md`, section 8 last bullet). Diagnostics are cached per uri and
dependency key (`src/language-service/service.ts:186` and `:239-247`), the Playground debounces in
its own Monaco glue, and the host interface exposes only `ambientLib`, `resolveImport` and
`readDocument` (`src/language-service/host.ts:15-25`).

**Gap.** Smaller than it looks, and the reason is file size: a shader is tens to a few hundred lines
with a `lib: []` program, so a full check is milliseconds, not the seconds a real TypeScript project
takes. The stale result problem the adapter solves by version is the real one and is already solved.
What is missing shows up only in one place, a very large generated shader or a multi-file unit,
where a run to completion on a keystroke is wasted work.

**Adoption (S).** Later, and cheaply when it comes: add an optional
`getCancellationToken?(): { isCancellationRequested(): boolean }` to
`TypeshadeLanguageServiceHost`, pass it to `ts.createLanguageService` as its third argument, which
TypeScript's own host contract accepts, and check it once between the TypeScript half and the
TypeShade half of `getDiagnostics`. Do not build a multistep operation or an async surface; the
synchronous design in section 8 is right for this file size and should be kept as a stated decision,
not drifted away from.

## Website and Playground

### Twoslash in documentation samples

**TypeScript.** A fence marked ` ```ts twoslash ` is run through the real compiler before rendering.
The twoslash pass returns `staticQuickInfos`, the hover type of every identifier, `errors` with
code, line, character and rendered message, and a generated `playgroundURL`, and the renderer draws
hovers and error bubbles from that data. Inline comment directives set compiler flags, declare
expected error codes (`// @errors: 2322`), cut away setup code (`/// ---cut---`) and switch the
sample to show emitted JS or `.d.ts` through `showEmit` and `showEmittedFile`, and the site wires it
in as a remark plugin at build time (`web/packages/ts-twoslasher/README.md`;
`web/packages/typescriptlang-org/gatsby-config.js:153`;
`web/docs/Converting Twoslash Code Samples.md`).

**TypeShade.** Guide code samples are plain syntax highlighting: `TypeShadeCode.astro` is 13 lines,
a thin wrapper over astro-expressive-code's `<Code>` with a lang and a title and no type data
(`typeshade.github.io/src/components/TypeShadeCode.astro`). One sample is an exception, hand-built:
`DiagnosticBlock.astro` renders a snippet with a wavy underline plus the compiler's own message,
where the message comes from running the real TypeScript compiler over one fixture file at build
time (`typeshade.github.io/src/components/DiagnosticBlock.astro`;
`typeshade.github.io/src/lib/typed-error.ts:1-10`). The ingredient twoslash needs already exists in
the compiler: an editor-neutral language service with `getDiagnostics`, `getHover`,
`getSignatureHelp`, `getSemanticTokens` and `getCompiledOutput`
(`src/language-service/service.ts:50-102`; `src/language-service/hover.ts:91-98`).

**Gap.** Every code sample on typeshade.dev is a picture of code. A reader cannot see what `vec2` or
`uv` is, cannot see which line the compiler rejects, and has no proof the sample still compiles. The
one page that does show a diagnostic proves the machinery works and also proves it does not
generalise, since it is a bespoke component around a single fixture. TypeShade is in a better
position than TypeScript was, because its language service answers hover and diagnostics for exactly
the language the samples are written in and runs in Node at build time with no network.

**Adoption (L).** Add a remark plugin beside `typeshade.github.io/src/lib/remark-api-links.mjs` that
handles a fence marked `typeshade twoslash`: open the source on `createTypeshadeLanguageService`,
call `getDiagnostics` over the file and `getHover` at each identifier span, then hand
expressive-code the same text plus a hover title per token and a marked line per diagnostic. Support
two directives first, `// @errors: TS8010`, so a sample that stops producing exactly those codes
fails the build, and a `---cut---` line for setup code, reusing the build-time compile pattern in
`typed-error.ts`. Second pass: emit the `#code=` Playground link for each sample the way twoslash
emits `playgroundURL`.

### Documentation samples compiled at build time

**TypeScript.** A lint script walks every markdown file under `copy/` for every language, parses it
and runs the twoslash pass over each sample, collecting failures with the file path and the
compiler's message and exiting non-zero, so a handbook sample that stops compiling fails the build
in the translations as well as in English
(`web/packages/documentation/scripts/lintTwoslashErrors.js`).

**TypeShade.** The compiler repo has the right gate for half the surface:
`src/compiler/ts/doc-snippets.test.ts` extracts every ` ```ts ` fence that carries the
`"use typeshade"` directive and compiles it, single-file or multi-file, and a fence that mentions the
directive but fits neither shape fails rather than being skipped, with a documented skip marker that
requires a reason. Its file list is `README.md` plus `docs/*.md`
(`src/compiler/ts/doc-snippets.test.ts:42-49`), which does not include `AUTHORING.md`, and
`AUTHORING.md` is what the site renders as the whole compiler internals section. The site's own
samples, in the dictionaries and in the Korean translation files, are never compiled: the site build
runs check-style, check-copy, check-i18n, check-guide and check-api, none of which compile anything
(`typeshade.github.io/package.json`), and translations are held to the English code blocks byte for
byte while neither side is compiled
(`typeshade.github.io/scripts/check-guide-translations.ts:22-24`).

**Gap.** The prose a reader actually reads on typeshade.dev is the least-checked code in the
project. `AUTHORING.md` is rendered as the internals guide and its fences are not compiled, the
dictionaries' inline samples are not compiled, and the Korean translations are held byte-identical
to English blocks that were themselves never compiled, so a broken sample is faithfully mirrored
into Korean.

**Adoption (M).** Two steps. In the compiler repo add `AUTHORING.md` to `DOC_FILES` in
`src/compiler/ts/doc-snippets.test.ts`, one line, and fix whatever it reports. In the site repo add
`scripts/check-snippets.ts` that pulls every fence out of `src/i18n/en.ts` and
`content/guide/ko/*.md` and runs `compileTsSource` on the ones carrying the directive, wired into
the build beside check-api. This is also the precondition for the twoslash work above, since the
same extraction feeds both.

### The Playground share URL scheme

**TypeScript.** The hash carries the program and the query carries the setup:
`#code/<lzstring-compressed>` is the current form, `#src=<urlencoded>` the legacy form,
`#example/<id>` opens a named sample and `#show-examples` triggers UI, while queries change the
environment, `?ts=3.9.2` with `ts=next` for nightly and `ts=dev` for a local build,
`?filetype=js|ts|dts`, and any compiler flag as `?flag=value`. Decoding tries the compressed form,
falls back to a double-decoded form for links that got re-encoded, and falls back again to a
localStorage copy of the last session (`web/packages/playground/README.md`, the Link Syntax section;
`web/packages/sandbox/src/getInitialCode.ts`).

**TypeShade.** A self-describing scheme with no library: `#code=<z|u><base64url>`, where `z` is
deflate-raw through `CompressionStream` and `u` is the plain bytes, so a link written in one browser
opens in another; alongside it `#example=<id>`, and the emit options written only when they differ
from the default (opt, parens, minify, precision), so an untouched example keeps a short link. The
fragment is read before the first render, so the panes paint once under the link's settings, and a
browser test asserts the round trip
(`typeshade.github.io/src/scripts/playground.ts:306-369` and `:1128-1150`;
`typeshade.github.io/scripts/check-playground.mjs`, check 18).

**Gap.** Small, and TypeShade's scheme is the better one: no lz-string dependency, a prefix byte
that says how the payload was packed, and short links for untouched examples. Two things TypeScript
has that TypeShade does not. There is no local draft fallback, so a reader who reloads without a
share link loses the edit. And nothing generates these links from the documentation, where
TypeScript's twoslash emits a `playgroundURL` for every sample automatically.

**Adoption (S).** Add a localStorage draft fallback in `openingSource`, after the code and example
branches, mirroring `getInitialCode.ts`. Then export the encoder as a small build-time module so the
site can attach an "Open in the Playground" link to every guide sample; this pairs with the twoslash
work and needs the same fence extraction.

### The compiler version in the Playground link

**TypeScript.** `?ts=<version>` selects the compiler the Playground runs, including `ts=next` for
the nightly build and `ts=dev` for a local developer build, and the selectable list is not
hand-maintained: a bootstrap script fetches `releases.json` and `pre-releases.json` from the
Playground CDN, works out whether the current beta and RC should appear, and writes the version list
into the sandbox, which exposes it as `supportedVersions`. The bug report template then asks for a
Playground link, so a report carries its compiler version implicitly
(`web/packages/playground/README.md`; `web/packages/sandbox/script/downloadReleases.js`;
`web/packages/sandbox/src/monacoTSVersions.ts`; `web/packages/sandbox/src/index.ts:383-391`).

**TypeShade.** The site header carries a version menu, but it is a label, `v{facts.mirrorVersion}`,
a prerelease note and three links, Releases, Changelog and the pinned commit
(`typeshade.github.io/src/components/SiteHeader.astro:45-56` and `:103-110`). The Playground bundles
exactly one compiler, the submodule at the pinned commit, the site documents one version by design
(`typeshade.github.io/DESIGN.md`, the Versions section), and the share link records the source and
the emit options but not which compiler produced the output
(`typeshade.github.io/src/scripts/playground.ts:356-369`).

**Gap.** A shared Playground link is undated. When 0.1.0 and 0.2.0 both exist, a link that
reproduced a bug last month will silently reproduce something else, and an issue that cites a link
will not say against what. TypeScript solved this before it needed a version dropdown, by putting
the version in the URL.

**Adoption (S).** Do not build a multi-version selector yet, since there is one published version.
Do put the version in the link now: write `v=<facts.mirrorVersion>-<pinnedCommit short>` into the
fragment in `writeHash`, show it in the Playground's status line, and when a link carries a version
other than the loaded one, say so in the status line rather than pretending. That single field is
what makes the issue template worth having, and it is the hook a real selector would later hang on.

### A bug report exported from the Playground

**TypeScript.** The Playground has an exporter that builds a GitHub issue body from the current
sandbox, diffing the active compiler options against the compiler's own defaults so only the flags
that actually differ appear in the report, and also exports to CodeSandbox and to the TS AST viewer;
the bug report form, which lives in the compiler repository rather than the website one, then asks
for that link as its optional Playground Link field (`web/packages/playground/src/exporter.ts:29-70`
and `:193`; `ts-main/.github/ISSUE_TEMPLATE/bug_report.yml:47-59`, `required: false`).

**TypeShade.** Nothing. The Playground can compile, emit three targets, reflect and rasterise on the
CPU, and there is no way to turn a wrong result into a report; reporting is not among the eighteen
behaviours the Playground check enumerates
(`typeshade.github.io/scripts/check-playground.mjs:6-26`), and the repository's bugs URL points at a
plain issue tracker with no form (`package.json`, the `bugs` field).

**Gap.** The Playground is where a reader will first see a wrong emit, and it is a dead end. Every
report that does arrive will be missing the two things that matter, the exact source and the exact
emit options.

**Adoption (S).** Add a "Report this" button that opens the issue form prefilled from the current
state: the `#code=` link, the emit options that differ from the default, which `writeHash` already
computes, the pinned version and commit, the selected target tab, and the first diagnostic if there
is one. Do this in the same change as the issue template, since the template's required fields and
the button's payload must match.

### A Playground plugin model

**TypeScript.** The Playground defines a `PlaygroundPlugin` interface (id, displayName, didMount,
modelChanged, modelChangedDebounce) and hands each plugin a utils object with a shared design
system, element helpers and a tab notification badge; plugins are loaded from npm at runtime by id
and a script lists the published ones. The built-in sidebar tabs are themselves plugins, one file
each, so JS, `.d.ts`, errors, types, runtime logs and the AST view are all the same shape
(`web/packages/playground/src/index.ts:36-50` and `:703`;
`web/packages/playground/src/pluginUtils.ts`; `web/packages/playground/src/sidebar/`;
`web/packages/playground/scripts/getListOfPluginsFromNPM.js`).

**TypeShade.** The panes are fixed markup, a source pane, an output pane with three tabs (WGSL, GLSL
vertex, GLSL fragment), a reflection pane and a CPU canvas pane with a resolution picker, all driven
by one 1282-line script, so adding a pane means editing that script
(`typeshade.github.io/src/components/Playground.astro:136-178`;
`typeshade.github.io/src/scripts/playground.ts`).

**Gap.** No extension point, and more importantly no internal seam. TypeScript's plugin API exists
because third parties ship Playground plugins; TypeShade has no third-party tool ecosystem and one
maintainer, so a published plugin API would be surface nobody uses. The part worth copying is that
TypeScript's own tabs are plugins, which is why adding one is a file rather than a diff through a
large script.

**Adoption (M).** Do not publish a plugin API, since there is no third-party audience for it and it
would freeze the Playground's internals before they have settled. Do adopt the internal shape: split
`typeshade.github.io/src/scripts/playground.ts` so each pane is a module exporting
`{ id, title, onSourceChange(module, container) }`, with the current four as the first four. The
panes worth adding next, an emit-pass profile, a bind group and layout diagram from `reflect()`, and
a WGSL to GLSL diff, then cost one file each. Revisit a public API only if someone asks to ship a
pane.

## Documentation and localization

### Get started pages per audience

**TypeScript.** The first nav group is four parallel introductions written for different
backgrounds, plus a tooling tutorial, under a summary that says so, "Quick introductions based on
your background or preference", so a reader coming from object-oriented languages and a reader
coming from functional ones get different first pages that meet them in the language they already
know (`web/packages/documentation/copy/en/get-started/`, holding
`TS for the New Programmer.md`, `TS for JS Programmers.md`, `TS for OOPers.md` and
`TS for Functional Programmers.md`;
`web/packages/documentation/scripts/generateDocsNavigationPerLanguage.js:31-41`).

**TypeShade.** One Get started group with three entries, Introduction, Quick start and Playground.
Every reader gets the same Introduction, which explains the language boundary, what stays familiar
from TypeScript and what the compiler produces, and there is one concept page for the mapping at
`/guide/typescript-and-webgpu/` (`typeshade.github.io/DESIGN.md`; `typeshade.github.io/src/lib/links.ts`;
`typeshade.github.io/src/pages/guide/`).

**Gap.** TypeShade's three plausible arrivals need opposite things and get the same page. A
TypeScript developer who has never written a shader needs what a fragment entry point is and why
`console.log` prints only when the shader runs on the CPU. A WGSL or GLSL author needs a translation table and a straight answer on
what is missing. A three.js, deck.gl or PixiJS user needs where the emitted string goes in a
renderer they already have. Today the WGSL author reads an introduction that explains TypeScript to
them, and the renderer user has to infer the integration from the Quick start.

**Adoption (M).** Add `/guide/get-started/` with three short pages in the dictionaries, keeping Quick
start as the practical fourth: TypeShade for TypeScript developers (the GPU execution model, one
entry point per pixel, what has no CPU equivalent), TypeShade for WGSL and GLSL authors (a
two-column table from WGSL declarations to TypeShade ones, and what the compiler will not accept),
and TypeShade in a WebGPU or WebGL renderer (module in, WGSL and reflection out, the host code
around it). Each is one screen. Move the existing Introduction to be the shared "why" page they all
link to.

### A cheat sheet

**TypeScript.** The Reference group carries a non-markdown entry pointing at a cheat sheet page,
described as "Syntax overviews for common code", sitting alongside the prose reference rather than
inside it (`web/packages/documentation/scripts/generateDocsNavigationPerLanguage.js:76-80`).

**TypeShade.** The language guide is six topic pages, types, functions, control flow, GPU types,
resources and stages, plus a generated per-export API reference, and there is no single page that
shows the whole surface at once (`typeshade.github.io/src/lib/links.ts`;
`typeshade.github.io/DESIGN.md`, one page per public export under `/api/`).

**Gap.** A shader author works with the language in one hand and the target in the other, and there
is no page they can keep open that says "this TypeShade form becomes this WGSL and this GLSL". Six
navigations and a per-export reference are the wrong shape for that question. This is a bigger win
for TypeShade than for TypeScript, because TypeShade has a second column TypeScript does not have,
the emitted text.

**Adoption (M).** Add `/guide/cheat-sheet/` as one long page of tables, generated at build time
rather than written: for each area (declarations, types and swizzles, operators, intrinsics,
resource declarations, stage decorators, builtins) a row of authored TypeShade, the WGSL it emits
and the GLSL it emits, read from the intrinsics registry and produced by running the compiler the
way `typeshade.github.io/src/lib/api.ts` and `typeshade.github.io/src/lib/use-typeshade-emit.ts`
already do. Generated means it cannot go stale at the next pin, which is the failure mode every
hand-written cheat sheet has.

### A formal localization workflow

**TypeScript.** Translations live in a separate repository,
microsoft/TypeScript-Website-Localizations, and are pulled into a build on demand with a docs-sync
command, with the build treating them as optional (`web/README.md:4` and `:20-21`). The nav
generator walks every language directory under `copy/`, validates each non-English file with a
language-specific validator, and lists a page in a language only when that file exists, falling back
to English otherwise (`web/packages/documentation/scripts/generateDocsNavigationPerLanguage.js:194-221`);
site chrome strings are a separate mechanism, react-intl keys documented in their own page
(`web/docs/How i18n Works For Site Copy.md`).

**TypeShade.** A stricter, in-repo model. Chrome copy is two typed dictionaries, `ko` typed against
`en`, so a missing string is a type error (`typeshade.github.io/src/i18n/`;
`typeshade.github.io/scripts/check-i18n.mjs`). The guide is translated file by file under
`content/guide/ko/`, each file recording the sha256 of the English body it was translated from, so
moving the pin fails the build and names the sections that changed, a glossary fixes the Korean for
each term and lists the words that stay English
(`typeshade.github.io/content/guide/GLOSSARY.md`), and the checker holds a translation to the
English code blocks byte for byte, the same inline spans, numerals, link targets and heading count,
plus Korean rules: 합쇼체, no exclamation marks, a forbidden-calque list, and no five sentences in a
row on the same ending (`typeshade.github.io/scripts/check-guide-translations.ts:1-90`). A separate
check estimates label widths from font advance widths so a translation cannot reflow the layout
(`typeshade.github.io/.claude/skills/typeshade-site/SKILL.md`).

**Gap.** The process is better than TypeScript's on quality and worse on access. It is documented
only in an agent-facing skill file and a design document, it requires the full site toolchain (bun,
the vendored compiler submodule, the font subsetter) to run, and adding a third language means
hand-adding routes, a dictionary and a Korean-style font subset. A volunteer translator today has
nowhere to read what is expected of them.

**Adoption (S).** Keep the model and do not split into a localizations repository, which exists at
TypeScript's scale because hundreds of translators cannot all run the site build. Write
`content/guide/TRANSLATING.md` instead: the four steps (copy the English section, record its sha256,
run `bun run check:guide`, run `bun run check:copy` for width), the glossary's role, the list of what
stays English, and the exact failure messages a translator will see. Then shorten the Languages
section of `DESIGN.md` to point at it. Revisit the separate repo only when a second language arrives
with a translator who is not the maintainer.

### A runbook for moving the pin

**TypeScript.** `web/docs/New TypeScript Version.md` is a step-by-step runbook for updating the
website to a new compiler release, estimated at 15 to 30 minutes: change the pinned version in the
overrides field, reinstall, empty the twoslash cache, add any new handbook pages with the required
front matter, register them in the nav generator, update the TSConfig reference and JSON schema flag
by flag as the build fails incrementally, run the tests and refresh snapshots, then copy the release
notes in. It is organised by release stage, beta then RC then release.

**TypeShade.** The same operation is a much larger one here and is written down nowhere as a
procedure. Moving `vendor/shader-dsl` to a new commit changes every measured number on the site, the
whole generated API reference, the examples table, the internals pages cut out of `AUTHORING.md`,
and invalidates the recorded sha256 of every Korean guide section that changed. The build enforces
all of that (`typeshade.github.io/DESIGN.md`, "Things the build checks", where
`src/lib/examples.ts` holds every number and asserts the pinned compiler still matches the copy;
`typeshade.github.io/scripts/check-guide-translations.ts` and
`typeshade.github.io/src/lib/guide-translations.ts`, which refuse a file whose recorded hash is not
the pinned section's), and the skill file describes the change procedure for copy and layout
(`typeshade.github.io/.claude/skills/typeshade-site/SKILL.md`), but there is no page that says what
to do when the pin moves.

**Gap.** The most error-prone recurring operation in the project has no runbook. The checks will
catch the mistakes, which is why this is not urgent, but the order of operations (re-translate
before or after re-capturing stills, when to rerun `check:playground`, what to do when the API
reference loses an export the copy links to) has to be rediscovered each time.

**Adoption (S).** Write `docs/moving-the-pin.md` in the site repo, in the same style as TypeScript's:
update the submodule and commit the pin; run `bun run build`, which names every stale translation
hash, every reference drift and every number that no longer matches; re-translate the sections it
names and record the new hashes; rerun until clean; run `capture:stills` and `capture:og` if any
shader or the social card changed; run `check:playground`; run the QA trio; note any export removed
from the barrel that `links.ts` or the copy referenced. Link it from `DESIGN.md` and from the site
README's Checks section.

### A front matter contract and a generated sidebar

**TypeScript.** Every documentation file carries `title`, `layout`, `permalink` and `oneline`, and
the site build fails without them; the sidebar is one hand-written array in a generator script,
called the definitive navigation source, which walks every language directory, validates each
localized markdown file, and emits a typed `getDocumentationNavForLanguage` function that the site,
the epub and the rest consume
(`web/packages/documentation/copy/en/handbook-v2/Everyday Types.md:1-6`;
`web/packages/documentation/scripts/generateDocsNavigationPerLanguage.js:9-20` and `:194-241`;
`web/docs/New TypeScript Version.md`, "Or the site will fail the build").

**TypeShade.** The sidebar is a typed function rather than a generated file:
`sidebar(locale, sections, openCategory, path)` builds the six groups from a central links record
and the dictionaries, so a destination that does not exist is a type error and the reference's pager
order is derived rather than listed (`typeshade.github.io/src/lib/links.ts:20-62`;
`typeshade.github.io/src/lib/api-nav.ts`). Guide pages are Astro components with no front matter,
the `AUTHORING.md` sections are cut by a content loader, and the Korean translations do carry front
matter (id, the sha256 of the English body, sourceLine) and are validated
(`typeshade.github.io/content/guide/ko/overview.md:1-5`;
`typeshade.github.io/src/lib/guide-translations.ts:46-63`;
`typeshade.github.io/scripts/check-guide-translations.ts`).

**Gap.** None worth closing. TypeShade's version is stronger than TypeScript's on the axis that
matters: the navigation is type-checked against real destinations instead of being a hand-kept array
of file paths validated at generation time, and a missing translation is a type error rather than a
silent English fallback.

**Adoption (S).** No change; keep `sidebar()` as the single source. The one thing to carry over is
the field list: if a hand-written markdown page is ever added under `content/`, a cheat sheet or
release notes, give it `title` and `oneline` front matter and have the sidebar entry and the search
snippet read from the file, so a page's own description is not duplicated in the dictionary. Record
that decision in the "Structure of the site" section of `DESIGN.md` so the next page added follows
it.

## Release and governance

### Release notes per version

**TypeScript.** One markdown file per released version, going back to 1.1, each with the same front
matter and a permalink under `/docs/handbook/release-notes/`, plus a written procedure for producing
them: the prose comes from a separate blog-posts repository, is copied into the release-notes folder
with a header copied from the previous release, and twoslash may be added to its samples
(`web/packages/documentation/copy/en/release-notes/`, 48 files from `TypeScript 1.1.md` through
`TypeScript 6.0.md`; `web/docs/New TypeScript Version.md`, the Release Notes section).

**TypeShade.** No release notes and no releases. The changelog is generated from git history and
says so in its own body, that the repo ships no versioned releases and carries no git tags, so
entries are grouped by month; its entries are squash-merge subjects, and every PR link points at the
private monorepo this repository was split out of (`CHANGELOG.md:1-24` and `:30-50`). The generator
that wrote it, `scripts/emit-changelog.ts`, is named in the file's own header but lives in that
monorepo and is in neither of these repositories: `scripts/` holds `bake-api-surface.ts`,
`compile-gate.ts` and `monorepo-context.ts` only. The site's header version menu links straight to
the changelog (`typeshade.github.io/src/lib/links.ts`;
`typeshade.github.io/src/components/SiteHeader.astro:53`).

**Gap.** Two problems, one urgent. The public changelog of a public project links every entry into a
repository readers cannot open, and names a monorepo the site is careful never to name anywhere
else. And there is no per-version story at all, so a reader upgrading has nothing to read and the
site's version menu leads to a wall of commit subjects grouped by month.

**Adoption (M).** First, and immediately: get the private PR links and the Repository line out of
the published `CHANGELOG.md`, so the public changelog cites only the public repository and its own
short hashes. The generator cannot be changed from here, so do it in this tree: add a small
`scripts/` rewriter over the committed file and run it as part of the checks, or rewrite the header
by hand once and stop regenerating the file here. Then cut 0.1.0 with a tag and write
`/guide/release-notes/0.1.0/` as a real page in both languages, three sections, what the language
gained, what changed in emitted output, what breaks. Keep the generated changelog as the
commit-level record beneath it, the way TypeScript keeps both a changelog and release notes.

### Release and version bump automation

**TypeScript.** Four workflows, all bot-triggerable. `new-release-branch.yaml` takes a branch name,
package version and major.minor, creates the branch, rewrites the version in `package.json`, in the
compiler's `corePublic.ts` and in the public API baseline, runs the LKG build and the full test
suite, commits as the bot and pushes; `set-version.yaml` is the same script against a branch that
already exists; `lkg.yml` refreshes the last-known-good build on a release branch; and
`release-branch-artifact.yaml` runs on every push to `release-*`, installs browsers, validates that
a browser can import the package, builds LKG, packs a tarball and uploads it as an artifact. Each
takes bot-supplied inputs, a distinct id, the source issue, the requesting user and a status
comment, so the release is driven from an issue comment and reports back there
(`ts59/.github/workflows/new-release-branch.yaml`; `ts59/.github/workflows/set-version.yaml`;
`ts59/.github/workflows/lkg.yml`; `ts59/.github/workflows/release-branch-artifact.yaml`).

**TypeShade.** No release automation of any kind and no releases. The package is at 0.0.1 with
`publishConfig.access` public and nothing that publishes, CI is one workflow with two jobs, a
typecheck plus unit tests and the compile gate against Tint and a real WebGL2 context, and the
changelog states there are no tags (`.github/workflows/ci.yml`; `package.json`; `CHANGELOG.md`).
Meanwhile the site is already built on the assumption that releases exist: the header shows a
version, the footer shows the pinned commit, and the version menu links to a Releases page
(`typeshade.github.io/src/components/SiteHeader.astro:45-56`;
`typeshade.github.io/src/lib/links.ts`).

**Gap.** Cutting 0.1.0 today is a manual sequence nobody has written down, and the site already
links a Releases page that will be empty. TypeScript's release machinery is mostly about servicing
several live majors at once, which does not apply, but the core of it does: a version bump and a
tested artifact should be one dispatch, not a memory.

**Adoption (M).** Add one `workflow_dispatch` workflow, `release.yml`, taking a version: bump
`package.json`, run `bun run build`, `bun run test` and `bun run gate:compile`, fail on any of them,
tag `v<version>`, create the GitHub release with the release-notes file as its body, and publish to
npm. Skip the release-branch fan-out, the LKG bootstrap and the per-branch artifact, since
TypeScript needs those because it services old majors and because its compiler is built by itself,
and a pre-1.0 shader compiler with a single supported version needs neither. Do this in the same
phase as the 0.1.0 release notes, since the workflow consumes the notes file.

### Issue templates with a required reproduction

**TypeScript.** Five issue forms, not free text. The bug form requires search terms so future
searchers find the issue, requires version and regression information from a fill-in-the-blank list,
asks for a Playground share link, asks for the same code inline, and requires actual and expected
behaviour, with guidance stating that a report is slower to investigate if the sample is long or
pulls in external libraries; a config file turns off blank issues entirely and routes questions to
Stack Overflow, Discord, the FAQ wiki and the website repository
(`ts-main/.github/ISSUE_TEMPLATE/bug_report.yml`; `ts-main/.github/ISSUE_TEMPLATE/config.yml`; the
same directory also holds `feature_request.yml`, `lib_change.yml`, `module_resolution.yml` and
`other.yml`).

**TypeShade.** No issue templates in either repository. The compiler repo's `.github` holds one
file, `workflows/ci.yml`; the site repo's holds `workflows/deploy.yml`; and the package points its
bugs URL at the bare issue tracker (`package.json`).

**Gap.** For a compiler, a report without the input and the expected output is unactionable, and
that is the default shape of a free-form issue. TypeShade has an extra required field TypeScript
does not: which target the report is about, since the same source goes to WGSL, GLSL ES 3.00 and the
CPU oracle and a bug is usually in one of them.

**Adoption (S).** Add `.github/ISSUE_TEMPLATE/` to the compiler repo with `bug_report.yml` requiring
a Playground link (`#code=`), the target (WGSL, GLSL ES 3.00, CPU oracle, reflection, all), the
emitted output received, the output expected, and the version and pinned commit; plus
`feature_request.yml` and `config.yml` with `blank_issues_enabled: false` and a contact link to the
site's guide and to the site repo for site issues. Ship it in the same change as the Playground's
report button so the button's payload fills the form's fields exactly.

### A pull request template

**TypeScript.** A comment-block checklist that the author deletes or fills: an associated issue in
the Backlog milestone is marked required, the branch is up to date with main, the three commands
have been run (test, lint, check:format), and there are new or updated tests. The visible body is
the single line "Fixes #", and it closes with a request not to send typo-only PRs, stating that each
PR costs review and maintenance work (`ts-main/.github/pull_request_template.md`).

**TypeShade.** No PR template in either repository. The commands a PR must pass are known but live
in agent-facing documents: `AGENTS.md` lists build, test and `gate:compile` and states the two kinds
of emit change, and the site's skill file lists the build, QA and screenshot procedure
(`typeshade.github.io/.claude/skills/typeshade-site/SKILL.md`, "Procedure for any change to copy or
layout", steps 1 to 6). A human contributor reading only the README gets three commands and no
mention of the goldens or the oracle parity gate (`README.md`, the Contributing section).

**Gap.** The project's most important review rule, that an emit change needs either a golden or an
oracle parity run plus a real compile, is stated only where an agent will read it. A PR arrives with
no statement of which kind of change it is.

**Adoption (S).** Add `.github/pull_request_template.md` to both repos. Compiler: "Fixes #", then a
checklist of `bun run build`, `bun run test` and `bun run gate:compile`, and a required one-line
answer to "byte-identical emit or semantic emit change?" with the corresponding evidence, goldens
updated, or oracle parity plus compile gate output. Site: `bun run build`,
`bun run check:playground`, `qa:links`, `qa:seo`, `qa:openseo`, and the screenshots at 390 and 1440
in both languages that the skill already requires. Both are lifted from documents that already
exist, so the work is transcription.

### SECURITY.md

**TypeScript.** A root `SECURITY.md` that says explicitly not to report vulnerabilities through
public issues, names a private reporting channel, states a response window, and lists what a report
should contain, affected file paths, configuration needed to reproduce, step-by-step instructions
and impact. Alongside it, main ships a skill aimed at security researchers that states the threat
model up front, that tsc is a build tool and not a sandbox, followed by what it does and does not
guarantee (`ts-main/SECURITY.md`; `ts-main/.github/skills/security-report-check/SKILL.md`).

**TypeShade.** Neither repository has a `SECURITY.md`. There is no stated threat model and no
private reporting route, so a vulnerability report would arrive as a public issue.

**Gap.** TypeShade has a sharper threat-model question than TypeScript does, and no answer written
down. It compiles untrusted TypeScript, it evaluates the IR on the host in the CPU oracle, it
rasterises in browser workers in the Playground, and it emits text handed to a GPU driver's shader
compiler. Someone will ask about at least the oracle.

**Adoption (S).** Add `SECURITY.md` to the compiler repo, and a one-line pointer from the site repo,
with two parts: the reporting route, GitHub private vulnerability reporting, which is enough for a
solo project and needs no address; and a short threat model borrowed from TypeScript's skill,
stating that the compiler does not execute the shader it compiles, that the CPU oracle does evaluate
the IR on the host and should be treated as running the input, that emitted WGSL and GLSL are handed
to the platform's own compiler, and that compiling untrusted source is not a sandboxed operation.

### A contributor guide with an AI assistance policy

**TypeScript.** The main branch's `CONTRIBUTING.md` opens with "Use of AI Assistance" before
anything else: AI-authored patches are acceptable if the author has read and understands the result
and discloses it, undisclosed AI-looking PRs are closed without review, and bulk agent-driven
contributions are refused outright with the reasoning spelled out, that volume scales with compute
budget rather than engagement, that duplicates cost more to triage than the fix saved, and that a
relay between maintainer and model is worse than the maintainer running the tools directly. A
subsection is addressed to autonomous agents themselves, telling them not to open PRs as part of a
queue-driven workflow and to surface the section to their operator if instructed otherwise, and
automated summary comments are banned; then come prerequisites, setup, the task list, where tests
live and the exact command list to run before submitting (`ts-main/CONTRIBUTING.md`). The 5.9 branch
carries the same issue-logging sections and a longer task list, including an "Adding a Test" section
that names the directory a new case goes in, states the metadata tag format, shows a worked
multi-file example and notes that filenames must be unique across all tests, and a "Managing the
baselines" section that lists which baseline files exist, gives the exact git diff command to review
them, names `hereby diff` and the DIFF environment variable, and gives the accept command with the
warning that apparently unrelated baseline changes are clues
(`ts59/CONTRIBUTING.md:212-266` and the command reference at `:75-90`).

**TypeShade.** No `CONTRIBUTING.md` in either repository. What exists is agent-facing: `AGENTS.md`
(key files, subdirectories, the two kinds of emit change, the three commands, the patterns to
preserve, with the whole test section at `AGENTS.md:41-46`), `src/AGENTS.md`, and the site's
`typeshade.github.io/.claude/skills/typeshade-site/SKILL.md` (voice, layout references, the Korean
rules, the review procedure). The README's Contributing section is three sentences pointing at the
four Develop commands and saying that a change to compiler output may need the example goldens
updated (`README.md:107-118` and `:120-122`); it does not mention the CPU oracle parity gate, the
two kinds of emit change, or the re-bake command. The real test knowledge lives in the long
explanatory headers on individual test files, which are excellent but are found only by opening the
file that already failed (`examples/emit-goldens.test.ts:1-24`; `src/api-surface.test.ts:1-50`).

**Gap.** This project is built largely by agents and has nothing written about what that means for
contributions from outside: it will receive agent-generated PRs and has no stated policy, no
disclosure requirement and no statement of which review it will not do. It also has no human-facing
contribution guide at all, so the emit-change rule and the compile gate's Chromium prerequisite are
discoverable only by reading an agent file, and a contributor who hits a failing golden or a failing
surface snapshot has to find the right source comment to learn the re-bake command. The README names
the goldens but not the gate that decides whether a golden update is even the right evidence.

**Adoption (M).** Write `CONTRIBUTING.md` in the compiler repo with four parts. Prerequisites and
commands: `bun install`, `bun run build`, `bun run test`, `bun run gate:compile`, and the one-time
`playwright install --only-shell chromium` the CI workflow documents. The four gates and what each
one proves (typecheck, unit, compile gate, surface snapshot), where a new test goes (feature suite
under `src/`, example under `examples/` with its registry entry, golden under `__emit-goldens__` via
bake), and how to review and accept a golden diff, lifting the text from the existing file headers
rather than writing new prose. The review rule lifted verbatim from `AGENTS.md`: a byte-identical
emit change is gated by the goldens, a semantic emit change needs the CPU oracle parity gate and a
real compile through the gate. And an AI-assistance section modelled on TypeScript's, with the
disclosure requirement and the refusal of queue-driven bulk PRs, including the paragraph addressed
to agents. Add a short `CONTRIBUTING.md` to the site repo pointing at `DESIGN.md` and the build's
check order.

### CODE_OF_CONDUCT.md

**TypeScript.** One line at the repository root adopting an existing code of conduct by reference,
with a contact address and a link to its FAQ, and no bespoke text (`ts-main/CODE_OF_CONDUCT.md`).

**TypeShade.** Neither repository has one, in either root or `.github`.

**Gap.** A project that publishes a site, asks for contributions and has a public issue tracker has
no stated conduct expectation and no route for reporting a problem, and GitHub shows its absence in
the community profile.

**Adoption (S).** Add `CODE_OF_CONDUCT.md` to the compiler repo adopting Contributor Covenant 2.1 by
reference, with one contact address, following TypeScript's shape of adopting rather than writing.
The site repo can carry the same file or a pointer. This is minutes of work and removes a visible
hole.

### SUPPORT.md

**TypeScript.** A root `SUPPORT.md` separating three things: where to file issues, with an
instruction to search first; where to ask questions instead, Stack Overflow and Discord; and what
the support policy actually is, including which fixes get serviced and where commercial support
exists (`ts-main/SUPPORT.md`).

**TypeShade.** Nothing. The README carries a Status line saying the project is pre-release and the
public authoring model may change (`typeshade.github.io/README.md`) and a two-sentence Contributing
section (`README.md`). There is no statement of what is supported, what is not, or where to ask.

**Gap.** A pre-release compiler with a polished site invites expectations it cannot meet. Without a
support statement, every question arrives as an issue and every issue implies a commitment.

**Adoption (S).** Add `SUPPORT.md` to the compiler repo: issues are for bugs and suggestions and
must carry a Playground link; the language surface is pre-release and may change, linking the README
Status line; the frozen part is `docs/use-typeshade-surface.md`, which the README already calls the
author-facing grammar; there is no commercial support. Ship it with the issue templates, since the
templates' `config.yml` contact links should point at it.

### Agent instructions in .github

**TypeScript.** Instructions for coding agents sit where the tooling looks for them.
`ts-main/.github/copilot-instructions.md` gives the directory map, the build tool, a critical block
naming the one command that must pass before a session ends, the compiler-test file format with a
worked example, the order to implement in (write the failing test, accept baselines, then fix), and
a PR description template that explicitly overrides the agent's own defaults. Beside it,
`ts-main/.github/agents/replay-minimizer.md` holds a named agent with a trigger-phrase description
and a full procedure, and `ts-main/.github/skills/` holds three skills with YAML front matter
covering testing, commit restacking and the security threat model
(`compiler-and-fourslash-tests/SKILL.md`, `restack/SKILL.md`, `security-report-check/SKILL.md`).

**TypeShade.** The instructions themselves are good and specific, and they are in the wrong place
for anything but the tool that wrote them: the compiler's `AGENTS.md` is a root file with key files,
subdirectories, the working rules and the test commands, `src/AGENTS.md` sits beside it, and the
site's instructions are a Claude skill under
`typeshade.github.io/.claude/skills/typeshade-site/SKILL.md`. Neither repo has anything under
`.github` beyond a workflow.

**Gap.** Placement, and a missing critical block. An agent arriving through GitHub's own coding
agent looks in `.github/copilot-instructions.md` and finds nothing, so it will not learn that
`gate:compile` exists or that emit changes need the oracle. `AGENTS.md` also states the commands
without stating that they must all pass before a change is proposed, which is the one thing
TypeScript's file shouts.

**Adoption (S).** Add `.github/copilot-instructions.md` to both repos, short, pointing at `AGENTS.md`
and `DESIGN.md` respectively and repeating the must-pass commands in a critical block: compiler,
`bun run build` and `bun run test` and `bun run gate:compile`; site, `bun run build` and
`bun run check:playground` and the QA trio. Move the site's review procedure out of `.claude/skills`
into `.github/skills/typeshade-site/SKILL.md` so it is not tied to one vendor, leaving a pointer
behind, and add the same emit-change rule to the copilot file, since it is the rule most likely to
be violated by an agent that only reads one file.

### Stale-issue automation

**TypeScript.** A daily workflow closes issues by label rather than by age: it lists open issues
carrying any of eleven triage labels (Duplicate, Unactionable, Not a Defect, External, Working as
Intended, Question, Out of Scope, Declined, Won't Fix, Too Complex, Design Limitation) that have not
been updated in two days, and closes each as not planned with a comment explaining the label.
Nothing is closed for being merely old, and the two-day window is a grace period after a human
applied the label (`ts-main/.github/workflows/close-issues.yml`).

**TypeShade.** No issue automation; the compiler repo's only workflow is CI
(`.github/workflows/ci.yml`) and the site repo's only workflow is deploy
(`typeshade.github.io/.github/workflows/deploy.yml`).

**Gap.** None today, because there is no issue volume to manage. Worth noting what TypeScript's
design says: it is not a stale bot, and automating closure of untriaged issues by age would be the
opposite practice, which TypeScript deliberately does not do.

**Adoption (S).** Later, when there is a triage backlog to manage rather than a hypothetical one.
When that happens, copy `close-issues.yml` with a smaller label set (Duplicate, Question, Working as
intended, Won't fix, Out of scope) and keep the two-day-after-labelling design, a human labels and
the bot closes with the reason. Do not install an age-based stale bot; on a pre-1.0 project it would
close the reports that are hardest to reproduce, which are the valuable ones.

## Summary table

Sorted by priority, then by size. The practice names are the subsection headings above.

| Practice                                                | Size | Priority |
| ------------------------------------------------------- | ---- | -------- |
| Generated message map with a uniqueness gate            | S    | now      |
| Related information on a diagnostic                     | S    | now      |
| The spelling suggestion as structured fix data          | S    | now      |
| One diagnostic identity across the pipeline             | S    | now      |
| A one-command accept-baselines step                     | S    | now      |
| Orphan and missing baseline detection                   | S    | now      |
| A CI matrix over operating systems and runtimes         | S    | now      |
| Format and lint enforced in CI                          | S    | now      |
| A reducible sample count for the property suites        | S    | now      |
| A public API baseline with its own CI signal            | S    | now      |
| Issue templates with a required reproduction            | S    | now      |
| A pull request template                                 | S    | now      |
| SECURITY.md                                             | S    | now      |
| Marker-based fixtures for service and code action tests | M    | now      |
| Editor semantics in the service, adapters as conversion | M    | now      |
| The protocol as a written artifact                      | M    | now      |
| Documentation samples compiled at build time            | M    | now      |
| Get started pages per audience                          | M    | now      |
| Release notes per version                               | M    | now      |
| Release and version bump automation                     | M    | now      |
| A contributor guide with an AI assistance policy        | M    | now      |
| Quick fixes registered against diagnostic codes         | L    | now      |
| Twoslash in documentation samples                       | L    | now      |
| A change tracker for edit-producing features            | S    | next     |
| A custom protocol command for compiled output           | S    | next     |
| The rest of the navigation family                       | S    | next     |
| The Playground share URL scheme                         | S    | next     |
| The compiler version in the Playground link             | S    | next     |
| A bug report exported from the Playground               | S    | next     |
| A formal localization workflow                          | S    | next     |
| A runbook for moving the pin                            | S    | next     |
| CODE_OF_CONDUCT.md                                      | S    | next     |
| SUPPORT.md                                              | S    | next     |
| Agent instructions in .github                           | S    | next     |
| Messages as templates with numbered placeholders        | M    | next     |
| A pretty formatter with a source code frame             | M    | next     |
| No catch-all code                                       | M    | next     |
| A documented error index                                | M    | next     |
| A per-case type and symbol baseline                     | M    | next     |
| A perf benchmark in the test gate                       | M    | next     |
| A smoke test over the published package                 | M    | next     |
| Fix-all across a document                               | M    | next     |
| Inlay hints                                             | M    | next     |
| A suggestion channel separate from errors               | M    | next     |
| A cheat sheet                                           | M    | next     |
| One authoritative message table                         | L    | next     |
| Directive-driven compiler test cases                    | L    | next     |
| A tsserver plugin as the delivery vehicle               | L    | next     |
| The editor client in the compiler repository            | L    | next     |
| Outlining spans and folding ranges                      | S    | later    |
| Workspace-wide symbol search                            | S    | later    |
| Cancellation and delayed diagnostics                    | S    | later    |
| A coverage run per commit                               | S    | later    |
| A front matter contract and a generated sidebar         | S    | later    |
| Stale-issue automation                                  | S    | later    |
| Per-message metadata for editor rendering               | M    | later    |
| A nightly prerelease from main                          | M    | later    |
| A size metric against the base branch                   | M    | later    |
| Call hierarchy                                          | M    | later    |
| A Playground plugin model                               | M    | later    |
| An issue-repro bot                                      | L    | later    |
| Refactors as a selection-driven catalogue               | L    | later    |
| Per-message flags for an external reporting pipeline    | S    | skip     |
| An LKG bootstrap                                        | S    | skip     |
| Content mapper contributions                            | S    | skip     |
| The getExternalFiles plugin hook                        | S    | skip     |
| The small per-keystroke editor features                 | S    | skip     |
| A versioned documentation site                          | S    | skip     |
| CODEOWNERS                                              | S    | skip     |
| Formatting and smart indent as service operations       | M    | skip     |
| A real-world-code corpus runner                         | L    | skip     |

71 practices: 23 now, 26 next, 13 later, 9 skip.

## Adoption order

1. Strip the private monorepo links and the Repository line from the committed `CHANGELOG.md`,
   because a public project's public changelog currently cites a repository its readers cannot open.
   The generator that wrote it lives in the private monorepo and is not in this tree, so this is
   either a post-processing script under `scripts/` or a one-time hand rewrite of the header.
2. Add `bun run format:check` to the check job, two lines, so the formatter becomes a gate rather
   than a convention and later diffs stay readable.
3. Add the `bake:goldens` and `bake` scripts and the CI step that uploads `goldens.patch`, so the
   command four files already tell contributors to run exists.
4. Assert that the golden directory equals the set of files `checkGolden` touched, so a renamed
   example leaves no orphan behind.
5. Split the API surface gate into its own `test:api` job and start `docs/api-breaking-changes.md`,
   so a surface change is a named red check and a removal is classified as one.
6. Give the check job a matrix over Node and Windows and a second TypeScript version, since the
   package claims `engines: node >=20` and a peer range of `>=5.0.0` and is tested against neither.
7. Add `src/compiler/ts/codes.test.ts` and generate the TS8xxx documentation table from the code
   tables, so a duplicated code cannot ship and the table cannot drift.
8. Carry a `TypeShadeError`'s code and hint through the emit boundary instead of stringifying them,
   inside `backendDiagnostic` so all three emit catches get it at once.
9. Map TypeScript's `relatedInformation` into the field that already exists on
   `TypeshadeDiagnostic`, then set it at the four TypeShade sites that name a second location in
   prose.
10. Carry the builtin and attribute spelling suggestion as structured `fixData` on the diagnostic,
    which makes the first quick fix a one-line replace once the fix registry lands.

The next work after these ten is the fix registry itself, with the marker fixture written alongside
it, and the Monaco adapter subpath that decides what the plugin and the LSP server get to reuse.

## What does not transfer

### Per-message flags for an external reporting pipeline

Four TypeScript messages, the call and construct signature return type incompatibility family, codes
2202 to 2205, carry `elidedInCompatabilityPyramid`, and the generator threads it into the generated
map as a positional argument purely so a downstream compatibility report can collapse those
elaborations (`ts59/src/compiler/diagnosticMessages.json`;
`ts59/scripts/processDiagnosticMessages.mjs:8-10` and `:96-102`). TypeShade's two code tables carry
only code, summary and hint (`src/compiler/ts/codes.ts`; `src/core/diagnostics/codes.ts`) and there
is no reporting consumer anywhere in `scripts/`. The flag exists to serve one internal ecosystem
report over a 2121-message table where a few elaboration families would swamp the aggregate;
TypeShade has 30 front-end codes, no aggregate report and no consumer that would read the field, so
copying it adds a column nothing reads. Revisit only if TypeShade ever publishes error statistics
across a corpus of shaders.

### An LKG bootstrap

`hereby LKG` copies the built compiler into a checked-in lib directory after verifying every
expected output exists, the nightly publishes from it, and the self-check job rebuilds the sources
with `--built` to prove the new compiler can compile itself
(`ts59/Herebyfile.mjs:900-937`; `ts59/.github/workflows/ci.yml:347-365`). TypeShade's compiler is
TypeScript compiled by tsc and TypeShade compiles shader source, so there is no bootstrap cycle:
`bun run build` is `tsc --build` with the TypeScript version pinned as an ordinary devDependency
(`package.json:59` and `:72`). The genuine analogue, proving the built artifact works, is covered by
the smoke test above and by the compile gate, which is a stronger external oracle than a self-build
because Tint and ANGLE are not TypeShade's own code.

### A real-world-code corpus runner

TypeScript's test runner is a fixed list of six in-repo suite kinds, conformance, compiler,
fourslash, fourslash-server, project and transpile (`ts59/src/testRunner/runner.ts:58-74`); the
third-party-corpus work runs entirely outside the repository, where infrastructure compiles large
third-party repositories and whole Docker images to find regressions no hand-written case predicts;
the error-deltas pipeline that drives this is external to the repository and is itself watched by a
weekly workflow that files an issue if it stops producing results
(`ts59/.github/workflows/error-deltas-watchdog.yaml:1-45`). There is no third-party TypeShade corpus
to run, and the equivalent external-oracle role is already filled by the compile gate, which hands
every emit to Tint inside Chromium's WebGPU and to ANGLE through a real WebGL2 context, both on
SwiftShader, and feeds each compiler a shader that is not a program first
(`scripts/compile-gate.ts:5-43`; `.github/workflows/ci.yml:49-60`). The gap is the corpus, not the
runner, and the corpus does not exist. Revisit after the nightly publish gives third parties
something to pin; the watchdog specifically should wait until TypeShade has at least two scheduled
workflows worth watching.

### Content mapper contributions

On main, the Go server registers dynamic LSP capabilities under a `content-mapper-` registration
prefix, and the VS Code extension collects `ContentMapperContribution` records from other
extensions, each naming a set of file extensions and a manifest with an executable to run, validates
them, and forwards them to the server
(`ts-main/packages/vscode-typescript/src/contentMapperContributions.ts:1-96`;
`ts-main/packages/vscode-typescript/src/client.ts:44-60`). Content mapping exists so a `.vue` or
`.svelte` file, which the TypeScript parser cannot read, can be turned into TypeScript the server
can; a `.shade.ts` file already is TypeScript and is already in the program, so there is nothing to
map (`src/compiler/ts/directive.ts`; `src/compiler/ts/vite.ts`). What is worth copying is only the
underlying discipline, that the recognition rule is written down once and both halves obey it:
settle the open question in section 11 of `docs/language-service-api.md` by declaring the directive
authoritative for semantics and the `.shade.ts` extension authoritative only for tool activation,
which files an editor wakes the plugin on and which files Vite transforms, and state that in one
place both `directive.ts` and `vite.ts` cite.

### The getExternalFiles plugin hook

`PluginModule.getExternalFiles(project, updateLevel)` lets a plugin name extra files; the project
collects them from every plugin, creates a `ScriptInfo` for each and attaches it, and the code
comments state plainly that these files are not in the program, which is why the `ScriptInfo` has to
be made explicitly, and `getScriptFileNames` confirms it by returning root files plus typing files
and never external files (`ts59/src/server/project.ts:1094-1106`, `:1756-1773` and `:698-711`).
TypeShade's own host does the equivalent job differently, serving the ambient lib and imported
documents through `fileExists` and `readFile` (`src/language-service/host.ts:15-25` and `:240-250`).
The hook would buy TypeShade nothing: `.shade.ts` files are inside the program already, and the one
file that is outside, the ambient lib, cannot be added this way because external files are not
program roots, so reaching for `getExternalFiles` to inject `shade.d.ts` would look like it works
and silently would not. The real fix is the shipped `shade.d.ts` with a `"types"` entry that section
9 already defers, or a private per-file `createTypeshadeLanguageService` inside the plugin. Revisit
if a `.shade.wgsl` or a raw `.wgsl` sidecar ever becomes part of a unit, since that is the case the
hook was built for.

### The small per-keystroke editor features

Six members serve brace matching, linked editing, doc comment templates, todo comments, brace
completion and the JSX closing tag, each with its own protocol command
(`ts59/src/services/types.ts:631-632`, `:639-641` and `:646-647`;
`ts59/src/server/protocol.ts:51-57` and `:149-152`). TypeShade has none of the six
(`src/language-service/service.ts:50-102`), and that is a gap on paper only: every one of them is
syntax level and `.shade.ts` is TypeScript, so a plugin delivery gets all six free from the service
it proxies and Monaco gets them from its TypeScript language support, while the JSX one is
meaningless here. Under the plugin, do not override them;
under the future LSP server, do not advertise their capabilities. Write this down in design doc
section 4 as an explicit non-goal so the interface does not grow them by imitation.

### A versioned documentation site

TypeScript does not version its documentation: there is one copy of the handbook and reference for
all versions, the version-specific content is the release-notes folder, and the version selector
lives in the Playground rather than in the docs, with no per-version path prefix anywhere in the
documentation tree (`web/packages/documentation/copy/en/`, holding get-started, handbook-v1,
handbook-v2, reference, tutorials and release-notes among others, and no version-prefixed
directories; `web/packages/playground/README.md`). TypeShade's plan already matches that and is
deliberately deferred: the site documents one version, the one vendored at the pinned commit, and
when a later version diverges, older documentation moves under a path prefix while the unprefixed
path stays latest (`typeshade.github.io/DESIGN.md`, the Versions section). Building it now would
multiply the build's cost, since every number, every reference page and every translation hash is
derived from one pin, to serve a version history that does not exist. Do the two cheap substitutes
instead, the release-notes pages and the version recorded in the Playground share link, and revisit
only at the trigger `DESIGN.md` already names, a breaking language change that makes a live page
wrong for the current release.

### CODEOWNERS

Neither TypeScript checkout carries a CODEOWNERS file: the 5.9 branch keeps a plain list of the team
members whose review counts, read by a PR workflow (`ts59/.github/pr_owners.txt`;
`ts59/.github/workflows/pr-modified-files.yml`), and main has dropped even that, its `.github`
listing containing no CODEOWNERS and no `pr_owners.txt`. TypeShade has none either. CODEOWNERS
routes review to people and there is one maintainer, so it would add a required-reviewer gate on
every pull request and route it back to the person who opened it; the evidence points the same way,
since TypeScript with a dozen compiler maintainers uses a plain owners list on the release branch
and dropped it on main rather than adopting CODEOWNERS. Revisit if a second maintainer joins and the
repositories need different reviewers for compiler and site.

### Formatting and smart indent as service operations

A whole subsystem under `ts59/src/services/formatting`, rules, rules map, formatting scanner and
smart indenter, backs `getFormattingEditsForRange`, `getFormattingEditsForDocument`,
`getFormattingEditsAfterKeystroke` and `getIndentationAtPosition`, and its README states that the
reason it exists is not the format command but every language service operation that inserts or
modifies code, and that it is not exported publicly
(`ts59/src/services/formatting/README.md:1-33`; `ts59/src/services/types.ts:635-637` and `:633`).
TypeShade has no formatting in the service (`src/language-service/service.ts:50-102`) and formats
itself with Prettier through the `format` and `format:check` scripts. The gap should stay open: a
`.shade.ts` file is a TypeScript file, so the editor's own TypeScript formatter and the user's
Prettier already format it, a TypeShade formatter would be a second opinion fighting the first, and
a tsserver plugin that overrode `getFormattingEditsForDocument` would break formatting for the rest
of the user's project if it ever mis-detected a file. Do not add the four methods, and have the
future LSP server not advertise the documentFormatting or documentRangeFormatting capabilities.
Take only the indentation lesson: when a code fix inserts a line, an added `@location(0)` on a
struct field or an added return type, compute the leading whitespace from the line the anchor node
starts on rather than emitting a bare newline, which is a few lines inside the `EditBuilder` and not
a subsystem.
