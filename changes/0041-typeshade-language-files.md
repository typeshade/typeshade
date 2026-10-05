---
id: '0041'
title: A shader module is its own language file, `*.tsh`, with TypeScript's grammar and an enumerated set of grammar extensions
status: draft
rules:
- '1.4'
- '2.1'
- '2.5'
- '3.1'
- '3.8'
- '12.8'
- '13.6'
surface:
- 3
- 17
- 22
- 24
- 26
- 28
- 30
- 31
- 32
- 33
- 34
- 35
- 36
- 37
- 39
- 44
- 45
- 47
- 48
- 49
- 50
- 51
- 52
- 53
- 54
- 62
- 64
- 65
- 66
- 67
- 68
- 69
- 71
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Rename every shader file and specifier from `.shade.ts` to `.tsh`, give the Playground's Monaco a `typeshade` language over the service worker, rewrite the setup and import pages (host tsconfig line, host view name), and record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Contribute the `typeshade` language id for `*.tsh` with a TextMate grammar, serve it through a language server over the existing service in place of the tsserver plugin for shader files, keep the plugin's host-file duties, rewrite docs/design.md section 1 and re-run its measurement, update the MCP server, the skill and every fixture, and record this proposal in compiler-changes.md.
---

<!-- doc-refs: skip-file — a draft proposal names future rules, a future surface section and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0041`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                               |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction, from the owner's decisions in that conversation (the extension `.tsh`, the directive kept, sigils as the first grammar row).                                 |
| Applicability / Effectivity   | Shader source files and their names; `src/compiler/ts/specifier.ts`, `src/compiler/ts/link.ts`, `src/vite.ts`, `src/cli/`, `src/compiler/ts/host-face.ts`, `src/language-service/`, `scripts/changes.ts`, `examples/`, `journeys/`, the documents named below; the site and the editor. Release version unassigned. |
| Review baseline               | `origin/main` at `c9c0f47aaaa69b90dd7a320fb0be551286479bcc`.                                                                                                                                                                                                                                                        |
| Review and revision authority | [PR #447](https://github.com/typeshade/typeshade/pull/447). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                         |

## What changes

A shader module becomes a file of its own language. Its name ends in `.tsh`, its grammar is
TypeScript's grammar plus an enumerated table of grammar extensions, and its first statement
stays `"use typeshade"`. Nothing else about the language changes in this proposal: no grammar
row is added here, and every program that compiles today compiles unchanged after its file is
renamed. The grammar table starts empty; its first rows are proposed separately (pointer sigils
in the amendment of 0040, numeric literal suffixes in a proposal of their own).

### Before and after

| Today                                                                                                                     | After this proposal                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A shader module is `name.shade.ts`, a TypeScript file whose first statement is the directive.                             | A shader module is `name.tsh`, a TypeShade file whose first statement is the directive.                           |
| Its grammar is TypeScript's; the directive changes the meaning of what TypeScript parses.                                 | Its grammar is TypeScript's plus the rows of the grammar table (Rule 2.5); the directive keeps its meaning.       |
| A host file imports it as `./name.shade.ts`; `tsc` reads `name.shade.typeshade.ts` via `moduleSuffixes` and an `exclude`. | A host file imports it as `./name.tsh`; `tsc` reads `name.d.tsh.ts` via `allowArbitraryExtensions`. No `exclude`. |
| A shader file imports another as `./noise.shade.ts`.                                                                      | `./noise.tsh`.                                                                                                    |
| A package publishes `"typeshade": "./src/*.shade.ts"`.                                                                    | `"typeshade": "./src/*.tsh"`; the `default` condition stays JavaScript.                                           |
| The editor serves shader files through a tsserver plugin, replacing TypeScript's answers.                                 | The editor serves `*.tsh` through a language server over the same service; TypeScript never opens the file.       |
| Every tool that reads `.ts` reads the shader file: prettier, eslint, esbuild, Monaco's TS worker.                         | No tool reads it unless it opts in; the compiler, `tshc` and the editor are the readers.                          |

### The host boundary stays ordinary TypeScript

The contract a host project sees does not change in kind. The two artifacts the compiler already
produces for a host (`src/compiler/ts/host-face.ts`) stay what they are: a declaration-only host
view, and a generated JavaScript module. Only their names and the resolution rule move:

- The host view is `name.d.tsh.ts`, the file TypeScript 5.0 and later look for when a specifier
  ends in an extension TypeScript does not know and `allowArbitraryExtensions` is on. The host
  `tsconfig.json` needs that one line in place of today's `moduleSuffixes` line and `exclude`
  line. `tshc sync` writes the view as it does today.
- The generated module is what the Vite plugin returns for a `*.tsh` id, as it does for
  `*.shade.ts` today, registered ahead of Vite's esbuild transform. vitest follows Vite.
- A host project that emits with plain `tsc` can now import a shader module, which
  `allowImportingTsExtensions` forbade (it requires `noEmit`).
- Running a shader module in Node without a bundler is not supported today and is not added
  here. `tshc build`, writing `name.tsh.js` and `name.tsh.d.ts` beside the source, is a
  possible later item and is not part of this proposal.

The grammar of a `.tsh` file never leaves the compiler. What crosses to the host is JavaScript
and declaration files.

### The directive stays

`"use typeshade"` remains the first statement (Rule 3.1). The name now says the file's language
and the directive says the same thing; the redundancy costs nothing, every tool that identifies
a shader by its text keeps working, and the directive is where an author and an agent read what
the file is. Dropping it is a separate decision, to be taken on measurement.

### What the name decides and what the directive decides

Rule 3.8 keeps its shape with the names changed: a shader module is `*.tsh`; a `.ts` file that
begins with the directive is refused by the Vite plugin and the linker with the rename, as
today. The reason the plugin already gives (the bundler and the host `tsconfig` decide what an
import is before reading a statement of it) is unchanged.

### The grammar table

New Rule 2.5 adds the third kind of enumerated extension beside the names of §9.3: a grammar
extension is a row in a table in §2 of `docs/language-design.md`, with the construct, its
meaning, the prior it is spelled after, and the measurement that admitted it. The table is
shrink-only once a row is published, as §9.3 is. A row is added by a proposal of its own, by
the order Rule 13.6 gives for a name, extended here to a grammar row: the rationale, the row,
the surface section, the changelog entry. This proposal adds the table and no row.

### The editor

A `*.tsh` file is a document of the `typeshade` language id. TypeScript's own extension does
not claim it, so the first reason `vscode-typeshade/docs/design.md` §1.2 gave for a tsserver
plugin (TypeScript publishing its own diagnostics for the file) no longer holds. The service
is served by a language server, which §1.2 sizes as document sync, JSON-RPC and semantic token
encoding over the existing `TypeshadeLanguageService`. The service keeps building its
TypeScript program from a projection of the document (`src/language-service/projection.ts`),
which is the place a grammar row is rewritten into TypeScript the checker reads; with no row,
the projection is today's. The tsserver plugin keeps what it does for host `.ts` files.

### Migration

Rule 13.9 makes the rename a breaking change, so it ships in a `0.N.0`, in the two steps of
Rule 13.10 adapted to a rename: that release compiles both `*.shade.ts` and `*.tsh` and reports
each `*.shade.ts` under `--deprecations` with the rename; the next minor compiles `*.tsh` only.
`tshc migrate` renames files, rewrites specifiers in shader and host files, replaces the
`tsconfig.json` lines, and rewrites `exports` maps.

### Exclusions

- No grammar row. Pointer sigils (`&`, `*`) are the amendment of 0040; literal suffixes
  (`1u`, `1i`, `1.0f`) are their own proposal. Both depend on this one.
- No change to the language's meaning, the IR, the backends, the oracle or the runtime.
- No decision on the one-file design of roadmap item B1 beyond this: host code stays in `.ts`
  files; a `.tsh` file holds shader code. B2 and B3 do not depend on B1.
- No new dependency. A language server library for the editor is the editor repository's
  decision, with its own impact assessment.

## Why

### The one-shot rate of an agent decides it

The owner's criterion for the language is how well a coding agent writes a shader that
compiles first time. `README.md` already states the consequence for tools: a tool that reports
errors on correct code gets correct code rewritten, so `tshc check` is the check to hand an
agent, not `tsc`. `vscode-typeshade/docs/agents.md` §3.5 and §4 record that models reach for
the names they have read most and that the skill spends its words on what an agent gets wrong.

Two of the grammar rows the owner wants, pointer sigils and literal suffixes, are the spellings
of that prior (C, WGSL, GLSL) and cannot be parsed by TypeScript. Putting them in a `.ts` file
would make every tool that reads `.ts` by its name fail on the file: prettier, eslint,
esbuild, SWC, Babel, Monaco's TypeScript worker, and TypeScript's own editor extension. Each
project would carry ignore lines for each tool, an agent would have to know them, and the
failure mode without the editor plugin, or when the plugin does not load (§1.2 notes that
loading is opaque when it fails), is a file of syntax errors. A file whose name says its
language is ignored by those tools by default and served by the ones that opt in, and without
the extension it is plain text.

A file extension is also the signal a model conditions on most. A `.ts` file primes
TypeScript's grammar, in which `*p` reads as a mistake to fix. This part is an estimate and is
listed under the measurements below; the tooling consequences above do not depend on it.

### Precedent

TypeScript did not put JSX into `.ts`; it made `.tsx`. A directive (`"use strict"`) narrows or
re-interprets meaning and has never widened grammar, which is exactly how TypeShade has used
`"use typeshade"` until now. The project that widened a grammar behind a pragma was Flow
(`// @flow` in `.js`), and every tool in its ecosystem had to be taught its parser. Vue,
Svelte, Astro and MDX each have an extension and serve TypeScript's checker over virtual
code. This proposal puts TypeShade on that side: meaning by the directive, grammar by the name.

### The extension `.tsh`

The owner chose `.tsh` among `.shade`, `.tsh`, `.tspp` and `.tsp`. `.tsp` is TypeSpec's and
collides with its editor extension and language id. `.tspp` says nothing. `.tsh` is free, one
letter, and shaped like `.tsx`, so the name says "TypeScript's grammar plus something". Its
known costs, recorded so they are not rediscovered: it says less in an import line than
`.shade` would; a glob of the form `**/*.ts*` matches it, so a project that lints with such a
pattern needs an ignore; and the `.ts`-family shape can suggest that TypeScript tools read it,
which they do not. Rule 3.8 and the README say so in one sentence each.

### Targets are not definitions

Rule 1.2 says GLSL ES 3.00 is a target and not the definition of a construct. The same holds
for WGSL and for any later target: a restriction of the lower language (a reserved word, an
identifier rule, a pointer's spelling) is the backend's to escape, not the author's to avoid.
Proposal 0032 applied this to local names; new Rule 1.4 states it once for every target, and
0040's amendment and the extension of 0032 to every declaration kind cite it.

### The type the checker sees predicts the GPU

Rule 12.7 makes the editor and the compiler one vocabulary. For an agent the useful form is
one step further: the type TypeScript gives an expression, in the program the service builds,
must predict what the expression computes on the GPU, and a construct whose GPU meaning
TypeScript cannot see is refused rather than re-interpreted. New Rule 12.8 states it; the
divergences Rule 12.7 already records (a whole-binding write on a `const` binding, a short
class name across a namespace) are its list of exceptions, kept where they are.

### Alternatives considered

- **Sigils in `.ts` behind the directive.** Rejected for the tooling reasons above. It saves
  the rename and keeps the tsserver plugin, and costs a permanent set of per-project ignores
  and a syntax-error failure mode.
- **No grammar extension; references as a type.** A `Ref<T>` box with `ref(x)` and `.value`
  is parseable TypeScript and the checker enforces its contract. Rejected by the owner for the
  reason that a shader author's prior is `&x` and `*p`, and the type form reads as ceremony in
  shader code. It remains the shape of the projection: a sigil is rewritten into that box for
  the checker.
- **`.shade`.** Ranked first by the drafting agent for reading as "shader module" in an import
  line, for never matching a TypeScript glob, and for continuity with `.shade.ts`. The owner
  chose `.tsh`; the costs are recorded above.

### Unresolved decisions

- Whether the editor repository adopts a language-server framework (Volar.js) or writes the
  thin server §1.2 describes. Decided in that repository with a dependency impact assessment.
- Whether `tshc build` (a bundler-free path) is wanted. Not part of this proposal.
- Whether the directive stays required once the one-shot measurement below reports on it.

## What it touches

- Rule 1.4 (new): a target's restriction is the backend's to escape; WGSL, GLSL ES 3.00 and
  later targets alike.
- Rule 2.1: source (b) admits, beside ECMAScript's grammar as TypeScript spells it, the rows of
  the grammar table of Rule 2.5.
- Rule 2.5 (new): the grammar table, its columns, shrink-only, and that a row needs its own
  proposal.
- Rule 3.1: the directive remains the first statement of a `.tsh` file; the rationale names
  the file's language as the name's job and the directive's as the text's.
- Rule 3.8: `*.tsh`, `name.d.tsh.ts`, `allowArbitraryExtensions`, the refusal of a `.ts` that
  begins with the directive, and the one sentence on `**/*.ts*` globs.
- Rule 12.8 (new): the predictability rule, with Rule 12.7's divergence list as its exceptions.
- Rule 13.6: the order for adding a grammar row, after the order for a name.
- Surface §64, §67, §68: the host import, the entry call and the shader import, rewritten for
  `.tsh`, `name.d.tsh.ts` and the one tsconfig line. §66, §69: names in the host paths. §49:
  the editor's delivery vehicle for a `.tsh` file. §65, §62 and the sections listed only for a
  file name in an example header (3, 17, 22, 24, 26, 28, 30 to 37, 39, 44, 45, 47, 48, 50 to
  54): the name changes and nothing else. §71 (new): the `.tsh` file, the grammar table and
  how a row joins it; the number is the next free one as the tree makes it (Rule 3.7), after
  the §70 that 0040 claims.
- `src/compiler/ts/specifier.ts` (one rule for the compiler and the editor), `link.ts`,
  `source-file.ts`, `module.ts`: `.tsh` in place of `.shade.ts`, both accepted for the
  deprecation window.
- `src/vite.ts`: the id test, the host view name, the refusal text.
- `src/cli/run.ts`: `tshc sync` writes `name.d.tsh.ts`; `tshc migrate` is new; `tshc check`
  takes `*.tsh`.
- `src/compiler/ts/host-face.ts`: the host view's name and the comment that documents it.
- `src/language-service/`: a document's language is known by its name as well as its text;
  the service's host (`host.ts`) and `SHADE_DTS` unchanged.
- `scripts/changes.ts`: the example pattern `examples/NAME.tsh`; example ids are the basenames
  and do not change, so `examples: []` here is the declaration that no example is added or
  removed by the rename. The script's pattern changes in the same implementation.
- `examples/*.shade.ts` → `examples/*.tsh`; `journeys/` (host import, shade package, every
  journey's shader files); `README.md`, `AUTHORING.md`, `CHANGELOG.md` (an entry), `docs/*`
  wherever `.shade.ts` is named; `docs/roadmap.md`'s "Three rules" gains the sentence that a
  grammar row is earned by measurement, and item B1's note records the decision above.
- `docs/dx.md` principle 8 gains a sentence: a TypeShade file is shared as a package the way
  TypeScript is, and read by the tools that opt in.
- No export, no code, no example id. The refusal of a misnamed shader file reuses the Rule 3.8
  refusal the plugin already gives.

### Draft impact estimate

| Area                  | Expected work                                                                                                                                                   | Basis and uncertainty                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler and CLI      | Name rules in four files, the host view name, `tshc migrate`, the deprecation warning for `*.shade.ts`.                                                         | Mechanical; `rg '\.shade\.ts'` over `src/` lists every site. Gate: every example and journey emits byte-identical text after the rename. |
| Language service      | Language by name; no projection change.                                                                                                                         | Small. Parity tests unchanged.                                                                                                           |
| Documents             | 76 mentions in the surface, 21 in the design rules, 17 in the README, 13 in `AUTHORING.md`, 61 in the changelog (historical entries stay), the rest of `docs/`. | Counted with `rg -c` at the baseline. `bun run docs:impact` and `docs:refs` hold the set.                                                |
| Examples and journeys | 92 example files and every journey renamed; `journeys/_host-import` gains a plain-`tsc` project beside Vite.                                                    | `git mv`; the host journey's three paths (Vite, vitest, `tsc`) are the acceptance test of the boundary table.                            |
| Site                  | 101 mentions at the baseline; Playground language; setup pages.                                                                                                 | Counted with `rg -c` over `src/`. The site's `check:guide` lists the stale guide pages.                                                  |
| Editor                | 522 mentions at the baseline; language contribution, TextMate grammar, a language server, docs/design.md §1 rewritten, measurement re-run.                      | Counted with `rg -c`. The largest item; its size depends on the unresolved framework decision.                                           |
| Compatibility         | Breaking: the file name. Two-step per Rule 13.10. Programs unchanged.                                                                                           | Known.                                                                                                                                   |
| Dependencies          | None in this repository.                                                                                                                                        | Known.                                                                                                                                   |
| Duration and cost     | Unknown; not estimated.                                                                                                                                         | No basis established.                                                                                                                    |

### Measurements this proposal asks for

Rule 13.3 asks that a design a target might refuse be measured; this proposal's claims are
about tools and agents, so the measurements are these, recorded under `docs/measurements/` as
the editor repository records its own:

1. The host boundary table above, run as the three paths of `journeys/_host-import`.
2. The editor without the extension: a `.tsh` file opens as plain text with no diagnostics, and
   a `.ts` file with the directive and a sigil would not have. Recorded once in the editor
   repository's measurement.
3. The one-shot rate: the same shader tasks given to the same models with the file named `.ts`
   and `.tsh`, both carrying the directive, counting first-try `tshc check` passes, edits that
   remove a sigil, and invocations of `tsc`, `eslint` or `prettier` on the file. This is the
   estimate marked above; the harness is proposed separately and the number informs the
   directive decision, not this proposal's acceptance.

### Approval and plan record

This record does not yet apply. Acceptance requires the actual decision and its pull request
reference, the approved revision of this file, the finalized list of surface sections (the
numbers above are the tree's at the baseline), the editor repository's framework decision or
its deferral, and the assignment of the three measurements. No responsibility, milestone,
duration or cost is assigned by this draft.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with
`Change: 0041`; the byte-identical emit check over examples and journeys at the delivered
revision; the host journey's three paths green; `bun run docs:impact`, `docs:refs`,
`reqs:sync` and `doorstop -C` clean after the rule edits; the deprecation warning pinned by a
test; and, separately, the site's and the editor's pin pull requests with `0041` recorded in
their `compiler-changes.md`.

## What it owes downstream

**typeshade.github.io.** Every page that names `.shade.ts` (101 mentions over `src/` at the
baseline): the setup page's tsconfig lines, the host-import page, the shader-import page, the
gallery's file names, the Korean pages and the dictionary. The Playground registers a
`typeshade` language for Monaco over the service worker it already runs, so Monaco's
TypeScript worker no longer sees the document. `compiler-changes.md` records `0041` when the
pin moves.

**vscode-typeshade.** The language contribution for `*.tsh` with the `typeshade` id and a
TextMate grammar that includes TypeScript's; a language server over `TypeshadeLanguageService`
for `.tsh` documents, by the framework decision above; the tsserver plugin reduced to its
host-file duties; `docs/design.md` §1 rewritten with its measurement re-run; the MCP server's
file reading and the skill's examples and fixtures (522 mentions at the baseline) renamed; the
skill's text telling an agent what a `.tsh` file is and that `tsc`, `eslint` and `prettier`
do not read it. `compiler-changes.md` records `0041` when the pin moves.
