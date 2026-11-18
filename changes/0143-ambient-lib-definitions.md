---
id: '0143'
title: An editor can go to the definition of an ambient name such as `u32`, `vec3` or `mix` and read its declaration in a file on disk
status: accepted
rules: []
surface: []
exports:
  - createTypeshadeLanguageService
  - TypeshadeLanguageServiceHost
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: vscode-typeshade
    what: The plugin build writes lib.typeshade.d.ts beside the plugin from the bundled compiler's SHADE_DTS, the plugin passes its uri as ambientLibUri, a tsserver test shows go-to-definition on mix landing on its declaration, and compiler-changes.md records 0143
  - repo: typeshade.github.io
    what: The language-service page names the optional host field ambientLibUri beside readDocument, and the editor page's feature list is rechecked for go to definition on a built-in name; compiler-changes.md records 0143
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0143, status `accepted`.                                                                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | 2026-11-18, Asia/Seoul. The date is the drafting date of both revisions. The repository owner made the request in conversation on 2026-11-18. An AI agent session drafted the text. Nobody has approved it.                                                                                                                                                                                  |
| Applicability / Effectivity   | The `./language-service` subpath: `src/language-service/host.ts`, `src/language-service/service.ts`, `src/language-service/navigation.ts`, `src/language-service/ambient.ts` and their tests; `docs/language-service-api.md`. Adapters that create the language service, the tsserver plugin of vscode-typeshade first. No release version is assigned. TypeShade has no release yet (OD-6). |
| Review baseline               | `origin/main` at `efa97ce938f7fff569a611d8bb2a6d7e8c779dd9`.                                                                                                                                                                                                                                                                                                                                 |
| Review and revision authority | [PR #1390](https://github.com/typeshade/typeshade/pull/1390). Revision 1 is `4eb2c1c6551be53e4e0303ef3847a2633915313c`. Revision 2 answers the independent review below and settles the open decisions of revision 1. Git records the revisions of this file. The review and merge records of the PR will record the decisions.                                                              |

## What changes

**Today.** The language service serves the ambient library (`SHADE_DTS`) as the virtual file
`AMBIENT_LIB_URI` (`typeshade:shade.d.ts`, `src/language-service/host.ts`). `locationsFrom` in
`src/language-service/navigation.ts` drops every location in that file. `getDefinition` and
`getReferences` both go through it. So go-to-definition on an ambient name (`f32`, `u32`,
`vec3`, `mix`, `textureSample` and the rest) shows nothing in the editor. The service has no
type-definition operation; the vscode-typeshade plugin answers that request with
`getDefinition`, so it shows nothing too.

**Proposed.** An adapter can give the language service a uri for the ambient library. When it
does, the service treats that uri as the ambient library's file:

1. The host gains one optional field, `ambientLibUri`, in `TypeshadeLanguageServiceHost`.
   Every other host field and every location already speaks in uris (`readDocument(uri)`,
   `TypeshadeLocation.uri`).
2. `getDefinition` reports a location in the ambient library at `ambientLibUri`, with the same
   range. Without the field, it drops the location as it does today.
3. `getReferences` reports only the declaration entry (`isDefinition`) of the ambient library,
   at `ambientLibUri`. It still drops every other location in the ambient library. The library
   names `f32` 266 times; those uses are not the author's references. `locationsFrom` gains a
   parameter for this, because definitions and references share it today.
4. `positionAt` and `offsetAt` accept `ambientLibUri` and resolve it to the ambient library's
   source file. Today they return line 0 or offset 0 for a uri that is not a program file
   (`service.ts`, `positionAt`/`offsetAt`). The vscode-typeshade plugin converts every range to
   an offset span through `offsetAt`, so without this step every definition would open at the
   top of the file.
5. `openDocument` with `ambientLibUri` does nothing. An adapter that forwards every opened file
   would otherwise put the whole vocabulary in the program a second time.
6. `SHADE_DTS` gains a JSDoc block before each type declaration that `TYPE_DOCS`
   (`src/language-service/docs.ts`) describes, rendered as `ambient.ts` already renders
   `FUNCTION_DOCS` for functions. Today `type u32 = …` and `interface vec3 {` carry no comment,
   so a definition on a type would land on bare TypeScript. Hover does not change: for a type
   name it answers from `TYPE_DOCS` before it asks TypeScript (`hover.ts`, the `isTypeName`
   branch).

The adapter writes the file: the exact text the service holds (`ambientLib` when the adapter
sets it, else `SHADE_DTS`), under the name `lib.typeshade.d.ts`, which follows TypeScript's own
`lib.es5.d.ts`. The host still reads and writes no file system (its header comment). The
service does not check the file. An adapter that bundles the compiler generates the file from
the same build, so the file and the service cannot disagree.

Exclusions:

- Rename still refuses an ambient name. `definesInAmbientLib` and `rename` test the internal
  file name `AMBIENT_LIB_URI`, which does not change.
- No author-facing name, rule, diagnostic code, surface section or example changes. The
  declarations change only by comments.
- Hover, completion and signature help do not change.

Example, before and after. A `"use typeshade"` file calls `mix(x, x, 0.5)` and declares
`a: u32`.

- Before (measured on 2026-11-18, tsserver 5.6.3, the plugin built against this tree):
  go-to-definition on `mix` and on `u32` returns no location.
- After, with `ambientLibUri` set: go-to-definition on `mix` opens `lib.typeshade.d.ts` at

  ```ts
  /**
   * Returns `a * (1 - t) + b * t`. `t` is a scalar or the same shape as `a` and `b`. `f64` vectors accept an `f32` blend factor.
   */
  declare function mix<V extends vec2 | vec3 | vec4>(a0: V, a1: V, a2: (f32)): V
  ```

  and the nine overloads after it. Go-to-definition on `u32` opens it at

  ```ts
  /** 32-bit unsigned integer value. */
  type u32 = number & { readonly [u32Tag]?: true }
  ```

  The comment line is the one item 6 adds.

## Why

**Problem.** An author cannot find the signature of an ambient function or the members of an
ambient type from the editor. The owner reported this. Measured on 2026-11-18 with tsserver
5.6.3 and the tsserver plugin built against this tree:

- Go-to-definition on `u32`, `vec3` and `mix` returned `[]`.
- Hover on a type shows one sentence from `TYPE_DOCS`, for `u32` "32-bit unsigned integer
  value."
- Hover on `mix` shows `function mix(a: vec3, b: vec3, t: number): vec3 (+9 overloads)`.
  Signature help lists the 10 overloads one at a time.

The `SHADE_DTS` text has 8706 lines, with 740 `declare function` lines and 823 JSDoc blocks.
It is the one authority for the author-facing names (`docs/language-design.md`, §2.1: "The set
of author-facing names is exactly the set of names the ambient library ... declares").

**What the file is, and is not.** The file is the editor's type layer. It is not a second
statement of the language:

- It is deliberately wider than the compiler. The scalar brands are optional, so `f32` and
  `u32` are mutually assignable there, a false negative the compiler's own checks catch
  (`ambient.ts`, the comment above the scalar brands). `ambient-parity.test.ts` holds the
  difference to the cases its header names.
- It names the types it declares for its own use (`ScalarOf`, `VecFor3`, `Numeric`, `LaneKeys`),
  and a generated overload names its parameters by position (`a0`, `a1`, `a2`).
- Four scalar types are brands (`type u32 = number & { readonly [u32Tag]?: true }`): 5 lines of
  the file hold `Tag]?: true`. 49 lines hold a tag of any kind; most are the vector, matrix and
  texture tags.

So a definition shows an author how the editor types a name, and the compiler stays the
authority on what it accepts. The header comment of `navigation.ts` dropped these locations
for this reason ("not the bundled `.d.ts`"). This proposal keeps the reason in view: item 6
puts a sentence of TypeShade documentation on every type the author lands on, and the
owner's question below asks whether the remaining TypeScript encoding is acceptable to show.

**Alternatives.**

| Alternative                                                    | Reason not chosen                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) Keep dropping ambient locations (status quo).              | Authors cannot browse overloads or members from the editor. The owner reported this.                                                                                                                                                                                                       |
| (b) Commit a hand-kept copy of the `.d.ts`.                    | It breaks the "One authority" rule of `AGENTS.md`. A second copy agrees with `SHADE_DTS` only until someone edits one of them.                                                                                                                                                             |
| (c) Point locations at the package's `./shade` export.         | The export maps to `dist/shade.d.ts` (`package.json`), the same text, written by `scripts/emit-shade-dts.ts` at build time. A bundled adapter such as vscode-typeshade vendors the compiler as source and ships no `dist/`. This proposal lets such an adapter write the same text itself. |
| (d) Show richer hover text only.                               | It helps for a type, but it does not let an author browse overloads or the members of a type.                                                                                                                                                                                              |
| (e) The service writes the file, or reads it back to check it. | The host is free of file-system access by design, and a browser adapter has no file system. The service does own every conversion of the ambient ranges (items 2 to 5), so no adapter has to map them.                                                                                     |
| (f) Point readers at the site's language reference only.       | typeshade.github.io already renders `SHADE_DTS` as one page per name (`src/lib/language-reference.ts` there <!-- doc-refs: skip — a file in the site repository -->). That needs a browser and a published build; go-to-definition works offline and on the compiler in use.               |

**Context, not part of this proposal.** A separate pull request,
[PR #1389](https://github.com/typeshade/typeshade/pull/1389), adds
`bun run editor:plugin` <!-- doc-refs: skip — the script comes from a separate pull request -->,
which writes `.cache/editor-plugin/lib.typeshade.d.ts` for reading in this repository. That file
gives a reader the text but not navigation from the editor.

**Assumptions.**

- An adapter that has a file system can write one file of about 8706 lines when it is built or
  installed.
- An editor that opens the reported uri shows it as an ordinary file. Edits to it have no effect
  on the service, which holds its own text, and item 5 keeps it out of the program.

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md`:

- OD-3. It adds nothing an author must learn: no name, construct or rule. It changes what the
  editor shows. An author who uses go-to-definition does read the TypeScript encoding described
  under "What the file is, and is not". This is a question for the owner (below).
- OD-4. Before the owner decides, the agent shows the before and after example above and the
  findings of the independent review.
- OD-6. No release exists, so the new field owes no compatibility release.

The proposal reverses no entry.

**Question for the owner.** Is it acceptable that go-to-definition shows the editor's type
layer, which is wider than the compiler and names helper types such as `ScalarOf`, with a
TypeShade sentence on each type? The drafter recommends yes: the alternative is no definition
at all, and the compiler's diagnostics stay the authority. The owner answered yes on 2026-11-18
(Approval and plan record).

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, rule, diagnostic code or surface form.
It adds one optional field to the options of the editor API, `TypeshadeLanguageServiceHost`,
and comments to the ambient declarations.

## What it touches

- `exports`, `createTypeshadeLanguageService`: its result reports ambient definitions and the
  ambient declaration entry of references at `ambientLibUri`, resolves `positionAt` and
  `offsetAt` for that uri, and ignores `openDocument` for it.
- `exports`, `TypeshadeLanguageServiceHost`: gains the optional field `ambientLibUri`.
- `rules`, `surface`, `codes`, `examples`, `names`: empty. `docs/language-design.md` and
  `docs/use-typeshade-surface.md` mention the ambient library, but no rule or numbered surface
  section states that navigation drops ambient locations. The JSDoc of item 6 adds no name.
- `docs/language-service-api.md`, sections [The service](../docs/language-service-api.md#4-the-service)
  and [Adapter contracts](../docs/language-service-api.md#7-adapter-contracts): the new host
  field, the ambient uri's behavior and the adapter's duty to write the file.
- `src/__api__/surface.md` changes by the new field, through `bun run bake:api-surface`.
- The header comments of `navigation.ts` and `host.ts` state the new behavior.

Required evidence at implementation:

1. A test: with `ambientLibUri` set, `getDefinition` on `u32`, `vec3` and `mix` returns
   locations at that uri, and the text of `SHADE_DTS` at each range is the name.
2. A test: `offsetAt(ambientLibUri, range.start)` of such a location is the offset of the
   declaration in `SHADE_DTS`, not 0, and `positionAt` inverts it.
3. A test: `getReferences` on `f32` with `ambientLibUri` set returns the document's own
   references plus exactly one location at that uri.
4. A test: with no `ambientLibUri`, every result equals today's.
5. A test: `rename` and `prepareRename` still refuse an ambient name with `ambientLibUri` set,
   and `openDocument(ambientLibUri, …)` adds no file to the program.
6. A test: `SHADE_DTS` has a JSDoc block before each declaration that `TYPE_DOCS` names, and
   hover on a type name is unchanged.
7. A real tsserver run with the plugin built against the implementation: go-to-definition on
   `mix` returns a span whose text is `mix` in `lib.typeshade.d.ts`.
8. `bun run build`, `bun run test` and `bun run changes:check` pass, and `bun run docs:impact`
   is read.

### Draft impact estimate

Known impacts:

- Compiler repository: `host.ts` gains one optional field. `service.ts` passes it on, resolves
  it in `positionAt` and `offsetAt`, and ignores it in `openDocument`. `navigation.ts` maps the
  uri in `locationsFrom`, with a parameter that keeps only the declaration entry for references.
  `ambient.ts` renders `TYPE_DOCS` before each described type.
- The site's language reference reads `SHADE_DTS` (`src/lib/language-reference.ts` there <!-- doc-refs: skip — a file in the site repository -->). The
  new comments may appear on its type pages; that is a recheck, not a known break.
- Compatibility: an adapter that sets nothing sees no change, except the new comments in the
  ambient text.
- Dependencies and tools: none added.

Estimates:

- Compiler work is small to medium: one field, the uri in three service methods and one
  navigation helper, a JSDoc rendering loop, seven tests and one document. Effort in hours is
  unestimated.
- vscode-typeshade work is small: its build writes one file and the plugin passes one uri.
  Effort is unestimated.
- typeshade.github.io work is small: one line on the language-service page. Effort is
  unestimated.

### Drafter's resolutions of revision 1's open decisions

The owner's standing rule for this work lets the drafter settle open decisions. Each is a
proposal until the owner accepts this document.

1. The field is `ambientLibUri`, not `ambientLibPath`: the host and every location speak in
   uris. The independent reviewer recommended the same.
2. References report only the declaration entry in the ambient library (item 3). Go-to-definition
   reports every ambient definition (item 2).
3. The tag lines stay as they are. Item 6 adds a TypeShade sentence above each described type,
   so an author who lands on a brand reads what the type is.
4. The service does not check the file. An adapter generates the file from the same build as
   the service it bundles, which removes the drift the check would detect.
5. vscode-typeshade generates the file beside the plugin when it builds, not in global storage
   (shared across extension versions) and not in the workspace (a project's tsconfig could pull
   the declarations into ordinary TypeScript files).

### Independent review record

- Reviewer: an AI review agent (`omo-native-code-reviewer`, task `st_01a1ee7b`) that did not
  write the proposal, on 2026-11-18, against revision 1 (`4eb2c1c6`). It read the proposal, the
  documents the procedure names and the code, and argued against the proposal.
- Verdict on revision 1: request changes, with three blocking findings.

| #   | Finding (the reviewer's, condensed)                                                                                                      | Answer in revision 2                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCKING. The plugin converts ranges through `offsetAt`, which returns 0 for a uri that is not a program file, so definitions open at 0. | Fixed: item 4 resolves the uri in `positionAt` and `offsetAt`; evidence 2 and 7 test it. The drafter confirmed the claim in `service.ts`. |
| 2   | BLOCKING. The claim that JSDoc beside the types explains them is false: `type u32` and `interface vec3` have no comment.                 | Fixed: item 6 adds the comment from `TYPE_DOCS`; the example shows the line it adds. Confirmed in the generated text.                     |
| 3   | BLOCKING. References have no drop of their own; the second `continue` is in `rename`.                                                    | Fixed: item 3 and the impact estimate add a parameter to `locationsFrom`. Confirmed in `navigation.ts`.                                   |
| 4   | The 49 tag lines are mostly vector, matrix and texture tags; 4 scalar types are brands.                                                  | Fixed in "What the file is, and is not".                                                                                                  |
| 5   | Type definition is no service operation; the plugin maps it to definition.                                                               | Fixed: "Today" says so, and the proposal no longer claims a type-definition change.                                                       |
| 6   | The file is wider than the compiler; presenting it as a reference needs a sentence and an owner question (OD-3, Rule 12.7).              | Fixed: "What the file is, and is not" and the question for the owner.                                                                     |
| 7   | Alternative (c) misses the `./shade` export and generation at build time.                                                                | Fixed: alternative (c) is restated, and resolution 5 generates the file at build time.                                                    |
| 8   | An adapter that opens the written file as a document declares the vocabulary twice.                                                      | Fixed: item 5 ignores `openDocument` for the uri; evidence 5 tests it.                                                                    |
| 9   | `docs/language-service-api.md` defines the host interface and is not listed.                                                             | Fixed: listed under "What it touches".                                                                                                    |
| 10  | The site's playground drops an unknown uri, so it is unaffected; its editor page lists go to definition and needs a recheck.             | Kept as a downstream recheck in the front matter.                                                                                         |
| 11  | The rename exclusion is correct as stated.                                                                                               | No change needed.                                                                                                                         |

Open findings for the owner: none blocking. The owner answered the question under "Owner's
decisions" on 2026-11-18.

### Approval and plan record

- Decision: on 2026-11-18, Asia/Seoul, the agent asked the owner three questions in the
  conversation: whether to merge PR #1389, whether to accept this proposal, merge it and
  implement it, and whether go-to-definition may show the editor's type layer. Each question
  named a recommended option. The owner answered "승인" (approved). By the owner's standing
  convention, a bare "승인" approves the recommended option of each question. So the owner
  accepted this proposal, approved its implementation, and answered the question under
  "Owner's decisions" with yes. PR #1389 merged the same day as `9d165449`.
- Approved revision: revision 2 (`624d2b70`) with this record and the `accepted` status. The
  merge of [PR #1390](https://github.com/typeshade/typeshade/pull/1390) records the exact commit.
- Scope: items 1 to 6 under "What changes", the exclusions, and the five resolutions above. The
  front matter is final for the compiler: `exports` names `createTypeshadeLanguageService` and
  `TypeshadeLanguageServiceHost`, and nothing else.
- Responsibilities: an AI agent session implements the compiler change in one pull request whose
  commits say `Change: 0143`. vscode-typeshade and typeshade.github.io owe the work in "What it
  owes downstream" when their pins carry the change. The owner merges or delegates the merge
  under `CLAUDE.md`.
- Milestones: (1) the compiler pull request, merged when its required checks are green; (2) the
  downstream pin updates, in each repository's own pull request. No date is set.
- Required validation: the eight items under "Required evidence at implementation".
- Resources: not established.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
commits and PRs with `Change: 0143`, the delivered configuration, and the observed results of
the tests and checks listed under What it touches. Functional validation and the document audit
will be recorded separately.

## What it owes downstream

- **vscode-typeshade.** Its build writes `lib.typeshade.d.ts` beside the plugin from the
  bundled compiler's `SHADE_DTS`. The plugin passes that file's uri as `ambientLibUri`. A
  tsserver test shows go-to-definition on `mix` landing on its declaration. It records 0143 in
  `compiler-changes.md` <!-- doc-refs: skip — a file in the downstream repository --> when its
  pin carries this change.
- **typeshade.github.io.** Its language-service page names `ambientLibUri` beside
  `readDocument`. Its editor page lists go to definition among the plugin's features; that line
  is rechecked for built-in names. Its language reference may show the new type comments. It
  records 0143 in `compiler-changes.md` <!-- doc-refs: skip — a file in the downstream repository -->.

All downstream obligations stay pending until the compiler implementation and the pins exist.
