---
id: '0143'
title: An editor can go to the definition of an ambient name such as `u32`, `vec3` or `mix` and read its declaration in a file on disk
status: draft
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
    what: The tsserver plugin writes lib.typeshade.d.ts to a file it owns (the extension's global storage, or beside the plugin), passes that path to the language service, and records 0143 in compiler-changes.md
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0143, status `draft`.                                                                                                                                                                                                                                                                                            |
| Date and attribution          | 2026-11-18, Asia/Seoul. The date is the drafting date. The repository owner made the request in conversation on 2026-11-18. An AI agent session drafted the text. Nobody has approved it.                                                                                                                                 |
| Applicability / Effectivity   | The `./language-service` subpath: `src/language-service/navigation.ts`, `src/language-service/host.ts`, `src/language-service/service.ts` and their tests. Adapters that create the language service, the tsserver plugin of vscode-typeshade first. No release version is assigned. TypeShade has no release yet (OD-6). |
| Review baseline               | `origin/main` at `efa97ce938f7fff569a611d8bb2a6d7e8c779dd9`.                                                                                                                                                                                                                                                              |
| Review and revision authority | No PR is assigned yet. Git records the revisions of this file. The review and merge records of its PR will record the decisions.                                                                                                                                                                                          |

## What changes

**Today.** The language service serves the ambient library (`SHADE_DTS`) as the virtual file
`AMBIENT_LIB_URI` (`typeshade:shade.d.ts`, `src/language-service/host.ts`). `locationsFrom` in
`src/language-service/navigation.ts` drops every location in that file. So go-to-definition,
find-references and go-to-type-definition on an ambient name (`f32`, `u32`, `vec3`, `mix`,
`textureSample` and the rest) show nothing in the editor.

**Proposed.** The adapter can give the language service a file path for the ambient library.
When it gives one, the service reports each ambient location at that path, with the same text
span, and stops dropping it. When it gives none, the service behaves as it does today.

1. The adapter writes the ambient library text byte-for-byte to a file named
   `lib.typeshade.d.ts`. The name follows TypeScript's own `lib.es5.d.ts`.
2. The adapter passes the path of that file in a new optional field of
   `TypeshadeLanguageServiceHost`. This draft calls the field `ambientLibPath`. Decision 1 settles
   the name.
3. The service keeps `AMBIENT_LIB_URI` as the program's internal file name. Only the location it
   reports changes: the uri becomes `ambientLibPath`, and the range stays the range TypeScript
   gave in `AMBIENT_LIB_URI`.

The text the adapter writes is the text the service holds: `ambientLib` when the adapter sets
it, else `SHADE_DTS`. Because the bytes are equal, every text span stays valid in the file. The
host itself still reads and writes no file system (header comment of
`src/language-service/host.ts`). The adapter owns the file.

Exclusions:

- Rename still refuses an ambient name. The refusal (`navigation.ts`, the predicate that
  `prepareRename` and `rename` share) tests the internal file name, which does not change.
- The ambient library text does not change, and no author-facing name, rule, diagnostic code or
  surface section changes.
- Hover, completion and signature help do not change.

Example, before and after, for go-to-definition on `mix` in a `"use typeshade"` file:

- Before: the editor reports no definition.
- After, with `ambientLibPath` set: the editor opens `lib.typeshade.d.ts` at the
  `declare function mix` overloads and their JSDoc blocks.

## Why

**Problem.** An author cannot find the signature of an ambient function or the members of an
ambient type from the editor. The owner reported this. The agent session measured it on
2026-11-18 with tsserver 5.6.3 and the tsserver plugin built against this tree:

- Go-to-definition on `u32`, `vec3` and `mix` returned `[]`.
- Hover on a type shows one line of documentation. For `u32` the line is "32-bit unsigned
  integer value."
- Hover on `mix` shows `function mix(a: vec3, b: vec3, t: number): vec3 (+9 overloads)`.
  Signature help lists the 10 overloads one at a time.

The `SHADE_DTS` text has 8706 lines, with 740 `declare function` lines and 823 JSDoc blocks. It
is readable as a reference, and it is the one authority for the author-facing names
(`docs/language-design.md`, §2.1: "The set of author-facing names is exactly the set
of names the ambient library ... declares").

**The prior design reason.** The header comment of `navigation.ts` says that a request for the
definition of `vec4` gets nothing, "not the bundled `.d.ts`". The bundled text encodes each
scalar type as a TypeScript brand, for example
`type u32 = number & { readonly [u32Tag]?: true }`, generated by `ambient.ts`. The agent
session counted 49 such tag lines in the text. A reader can find these lines confusing. They
are a small part of 8706 lines, and the JSDoc beside them says what each type is. Decision 3
asks whether to annotate or reshape them.

**Alternatives.**

| Alternative                                       | Reason not chosen                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Keep dropping ambient locations (status quo). | Authors cannot find signatures or members. The owner reported this.                                                                               |
| (b) Commit a hand-kept copy of the `.d.ts`.       | It breaks the "One authority" rule of `AGENTS.md`. A second copy agrees with `SHADE_DTS` only until someone edits one of them.                    |
| (c) Point locations at `dist/shade.d.ts`.         | `scripts/emit-shade-dts.ts` writes that file only during a build. It is absent in a source checkout and can be stale against the running service. |
| (d) Show richer hover text only.                  | It helps for a type, but it does not let an author browse overloads or the members of a type.                                                     |
| (e) The service writes the file itself.           | The host is free of file-system access by design, and a browser adapter has no file system. The adapter knows where it can write.                 |

**Context, not part of this proposal.** A separate pull request adds an interim step:
`bun run editor:plugin` <!-- doc-refs: skip — the script comes from a separate pull request --> writes `.cache/editor-plugin/lib.typeshade.d.ts` for reading. That file
gives a reader the text but not navigation from the editor.

**Assumptions.**

- An adapter that has a file system can write one file of about 8706 lines at start-up and
  again when the compiler it bundles changes.
- An editor that opens the reported path shows it read-only or as an ordinary file. Edits to it
  have no effect on the service, which holds its own text.

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md`:

- OD-3. It adds nothing an author must learn. It changes only what the editor shows.
- OD-4. Before the owner decides, the agent shows the before and after example above and the
  open decisions below.
- OD-6. No release exists, so the new option owes no compatibility release.

The proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, rule, diagnostic code or surface form.
It adds one optional field to the options of the editor API, `TypeshadeLanguageServiceHost`.

## What it touches

- `exports`, `createTypeshadeLanguageService`: its result reports ambient locations at
  `ambientLibPath` when the host sets it.
- `exports`, `TypeshadeLanguageServiceHost`: gains the optional field `ambientLibPath` (name per
  decision 1).
- `rules`, `surface`, `codes`, `examples`, `names`: empty. `docs/language-design.md` and
  `docs/use-typeshade-surface.md` mention the ambient library, but no rule or numbered surface
  section states that navigation drops ambient locations.
- `src/__api__/surface.md` changes by the new field, through `bun run bake:api-surface`.

Required evidence at implementation:

- A test in `src/language-service/navigation.test.ts` or `symbols.test.ts`: with
  `ambientLibPath` set, go-to-definition on `u32`, `vec3` and `mix` returns locations at that
  path, and the text at each range equals the declared name.
- A test: with no `ambientLibPath`, the results equal today's results.
- A test: rename and `prepareRename` still refuse an ambient name with `ambientLibPath` set.
- `bun run build`, `bun run test` and `bun run changes:check` pass.
- `bun run docs:impact` is read, and the header comments of `navigation.ts` and `host.ts` are
  brought up to date.

### Draft impact estimate

Known impacts:

- Compiler repository: `locationsFrom` and the reference path in `navigation.ts` (the drop at
  the two `AMBIENT_LIB_URI` tests) map the uri instead of skipping it when the path is set.
  `host.ts` gains one optional field. `service.ts` passes it through.
- Compatibility: an adapter that sets nothing sees no change.
- Dependencies and tools: none added.

Estimates:

- Compiler work is small: one field, one uri mapping, three tests. Basis: the drop is two
  `continue` statements in one file. Effort in hours is unestimated.
- vscode-typeshade work is small to medium: write a file, pass its path, and keep the file
  current when the bundled compiler changes. Effort is unestimated.
- Find-references on a common type such as `f32` can return many ambient locations. The effect
  on the editor's reference list is unestimated (decision 2).
- typeshade.github.io: no page is known to describe the drop. A search of that repository has
  not been done, so the entry is not declared. The search is required before acceptance.

Open decisions to resolve before acceptance:

1. The name of the field: `ambientLibPath`, or another name such as `ambientLibFile`.
2. Whether find-references includes ambient locations, or only go-to-definition and
   go-to-type-definition do.
3. Whether to annotate the 49 brand tag lines with a JSDoc note, reshape them, or leave them as
   they are.
4. Whether the service checks that the file at the path holds the same text, or trusts the
   adapter. The host reads no file system today, so a check would need the adapter's
   `readDocument`.
5. Where vscode-typeshade writes the file: the extension's global storage, or beside the
   plugin.

### Independent review record

No independent review has been performed. Before the owner decides, an agent or a person that
did not write this proposal reviews it against `changes/README.md#independent-review`. The
record will name the reviewer, the date, the revision reviewed, each finding and the answer to
each finding.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's actual decision, the PR
review and merge reference, the approved revision of this file, the resolved open decisions,
the assigned responsibilities and the required validation evidence.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
commits and PRs with `Change: 0143`, the delivered configuration, and the observed results of
the tests and checks listed under What it touches. Functional validation and the document audit
will be recorded separately.

## What it owes downstream

- **vscode-typeshade.** Expected work: the tsserver plugin writes `lib.typeshade.d.ts` from the
  bundled compiler's `SHADE_DTS` to a file the extension owns, and passes its path as
  `ambientLibPath`. It rewrites the file when the bundled compiler changes. It records 0143 in
  `compiler-changes.md` <!-- doc-refs: skip — a file in the downstream repository --> when its
  pin carries this change. No page or test there is known to describe the old behavior; a
  search is pending.
- **typeshade.github.io.** Not declared. A search for pages that say go-to-definition shows
  nothing on an ambient name is pending (see Draft impact estimate).

All downstream obligations stay pending until the compiler implementation and the pins exist.
