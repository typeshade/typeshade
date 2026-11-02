---
id: '0108'
title: A host file reads the author's JSDoc of each export of a shader module in the host view, before the sentence the compiler writes for a call
status: implemented
rules: []
surface:
  - 64
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The page that copies the host-view paragraph and listing of surface §64 (en and ko) shows the author's comment in the listing and says that the view carries it; `compiler-changes.md` records 0108 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (`references/host.md`) where it quotes a host view, and any fixture that pins a view's text, gain the author's comment and the queue sentence; `compiler-changes.md` records 0108 when the pin moves.
  - repo: typenn
    what: Nothing must change. Its generated views gain the comments of its shader modules on the next pin; `compiler-changes.md` records 0108 when the pin moves.
  - repo: typecv
    what: Nothing must change. Its generated views gain the comments of its shader modules on the next pin; `compiler-changes.md` records 0108 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names tests and text its implementation adds -->

**Document control**

| Field | Record |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Identity and status | Proposal 0108, `status: implemented`: items 1 to 3 are implemented by pull request [#887](https://github.com/typeshade/typeshade/pull/887), and item 4 (Amendment 1) by pull request [#937](https://github.com/typeshade/typeshade/pull/937) (see Configuration and validation record). The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC), Amendment 1 later the same day and Amendment 2 (the static field) the same day; see Approval and plan record. |
| Date and attribution | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature. |
| Request source | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, while designing an audio library on the compiler. The owner asked whether a built module keeps the author's function comments ("빌드된 파일의 함수 주석이라던가 지원되는지"). The agent reported that the host view carries none. The owner approved the drafting of this proposal ("승인"). No GitHub issue is recorded. |
| Applicability / effectivity | The host view that `hostFace` writes (`src/compiler/ts/host-face.ts`, `viewText`), its description in `docs/use-typeshade-surface.md` §64, and `src/compiler/ts/host-face.test.ts`. The generated module, the CPU tier, the rules, the exports, the diagnostic codes and the examples do not change. No release version is assigned. |
| Review baseline | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02. |
| Review and revision authority | Pull request [#871](https://github.com/typeshade/typeshade/pull/871) (branch `claude/proposal-0108-host-view-docs`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it. |
| \1 | Amendment 2 | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction, on the branch `claude/0108-amend-static-field`. It removes \"a static field\" from the members item 4 lists, which closes the open deviation of the Configuration and validation record: the view declares no static field (surface §26, change 0109), so its comment has no line to stand on. Items 1 to 3, item 4's other members, decisions D1 to D4, their approval and their record do not change. The owner approved it on 2026-11-02 (UTC); the merge of its pull request records the decision. | \n |

## What changes

**Before.** The host view (§64) declares each export of a shader module for the host's type
checker. `viewText` writes a helper, a constant, an `enum` and a struct as a bare declaration,
with no comment. It writes a sentence of its own for a `@compute` entry, a kernel function and a
full-screen `@fragment` entry, and `Not callable from host code (Rule 8.20): <reason>.` for an
export the host cannot use. The JSDoc the author wrote above the export is not read. A host file
that hovers `height` sees `height(p: readonly [number, number], k: …): number` and nothing else.
It cannot open the shader source for it, because `moduleSuffixes` resolves the import to the
view.

**After.**

1. **The author's JSDoc is in the view.** For every export the view declares, the view carries
   each JSDoc block (`/** … */`) attached to the exported declaration in the source, verbatim, in
   source order: on a function, a constant, an `enum` and each of its members, a struct (`class`,
   `interface`, `type`) and each of its fields, a `@compute` entry, a kernel function, a
   full-screen `@fragment` entry, and an export declared `never`. A re-export of another shader
   file's declaration (§68) carries that file's comment. A `//` comment and a `/* */` comment are
   not JSDoc and are not copied. A comment inside a body is not copied.
2. **The compiler's sentence follows the author's.** Where the view writes a sentence today (the
   three call sentences and the `Not callable` reason), that sentence stands in the same JSDoc
   block after the author's text, separated by one empty comment line. A hover then shows the
   author's words first and the contract second. An export with no JSDoc in the source keeps
   today's block.
3. **The call sentence says how a queued call is awaited.** The sentence for a kernel function
   gains: `A call whose written arrays are all Residents and that returns nothing may be made
without await: it is queued and runs in order, and read() of a Resident it writes waits for
it and throws its error (Rule 11.8); the signature returning void is that call.` The sentence
   for a `@compute` entry gains the same sentence about its bindings. The surface already states
   both facts (Rule 8.21, §65, §71). The view says them where the developer reads.
4. **The members of an exported class carry their comments (Amendment 1).** For a class the view
   declares as `export declare class` (change 0109, Rule 8.20), the view carries the JSDoc blocks
   attached to each member it declares, on the member's line, as item 1 does for a field: a
   constructor, a method, each half of an accessor and a static method (a static field is the
   module constant `Cls_Field` of surface §26, has no line in the view and carries none,
   Amendment 2). A member
   the view declares `never` carries the author's blocks first and the sentence of change 0109 at
   the end of the last block, as item 2 says for an export. A member the view takes from an
   exported base class stands in the base with its comment. A member a flat declaration takes from
   its base carries the blocks of the base member. An overload signature without a body is not
   carried: the face reads the implementation.

The §64 listing of `terrain.shade.ts` reads as follows once `height` carries a comment:

```ts
"use typeshade";

/** The height of the terrain at `p`, from the four wave constants `k`. */
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
```

```ts
// Generated by typeshade from terrain.shade.ts. Do not edit; `tshc sync` rewrites it.

/** The height of the terrain at `p`, from the four wave constants `k`. */
export declare function height(p: readonly [number, number], k: readonly [number, number, number, number]): number;
```

**Not in this proposal.** The view does not render Markdown, translate, check a `@param` tag
against the parameters, or give the manifest's default export a comment of its own. A sentence
rendered from a metadata decorator on a field or a class is a later proposal, which adds its
sentences to the same block. The generated module (`code`) does not change: a comment adds
nothing to a bundle.

**A consequence.** A view is text, and `tshc sync --check` compares it with the source's view.
An edit to a JSDoc alone makes the view stale, and `vite dev` and `tshc sync` rewrite it, as they
do for any edit today.

## Why

**The problem.** The host side of a shader module is read in the host view, never in the
source. So the documentation an author writes above a helper reaches no host developer: the
editor's hover on `height` in a host file shows a signature and no sentence. The three call
sentences the view writes are the compiler's. They say what the call does with the device, not
what the function computes. `docs/dx.md` principle 2 says the door under the hood speaks the
source language, and principle 3 that every failure names the line the developer wrote. A hover
that says nothing of what the author wrote is the same gap one step earlier.

**Evidence.** `viewText` in `src/compiler/ts/host-face.ts` at the review baseline: the
`function`, `const`, `enum` and `struct` cases push a declaration and no comment; the `compute`,
`kernel` and `fragment` cases push a generated sentence; the `never` case pushes the reason. No
case reads the JSDoc of the declaration. The front end already holds the `ts.SourceFile` of the
module and of each shader file it imports (`readDocument`), so the comment text is at hand.

**The request.** The owner, designing an audio library whose units are classes and functions in
`.shade.ts` files, asked on 2026-11-02 whether a built module supports function comments. The
answer at the baseline is no. The owner also observed that an imported kernel function is
asynchronous. Item 3 says in the view what §65 and §71 say about queuing, since the view is
where the question is asked.

**Alternatives.**

- Generate declarations from the shader source with `tsc --declaration`. Not possible: the
  source does not type-check as TypeScript (§64: its decorators are TS1206, its vocabulary meets
  the DOM's), which is why the view exists.
- Leave the view as it is and point the developer at the shader file. The import resolves to
  the view, and "go to definition" stops there. That gap is a separate proposal (a declaration
  map for the view), and this one does not depend on it.
- Copy the comments. Chosen: the smallest change that puts the author's words where the host
  reads.

**Assumptions.** TypeScript attaches JSDoc blocks to declarations (`node.jsDoc`,
`ts.getJSDocCommentsAndTags`) on the AST the front end already parses. A JSDoc block cannot
contain `*/`, so a verbatim copy is a valid comment.

**Decisions, resolved at acceptance** (Approval and plan record).

- **D1.** Which blocks: every JSDoc block attached to the declaration, in source order (the
  draft), or the last one only, as TypeScript's own hover shows. The draft copies all, so that
  nothing an author wrote is dropped.
- **D2.** Tags: copied verbatim and not checked (the draft), or `@param` names checked against
  the parameters with a diagnostic. The draft does not check. A wrong tag is the author's, as it
  is in any TypeScript file.
- **D3.** Member comments of a struct: on the field line of the `export interface` (the draft),
  or dropped. The draft keeps them, since a host that builds the object reads the field names.
  \1- **D5 (Amendment 2).** A static field: dropped from item 4's list (the amendment), or declared\n in the host class by a change to Rules 8.20 and 8.21 so that its comment has a line. The\n amendment drops it: a static field is the module constant `Cls_Field` (surface §26), change\n 0109 declares the static functions of a class and no field, and `carriesComment` already admits\n a static property declaration, so a later change that declares static fields needs no new\n reader.\n
  **Amendment 1 (2026-11-02).** Change 0109, accepted the same day as this proposal, made an
  exported class a value of the host face, and its listing shows the comment of the method `tick`
  in the view as one of this proposal. The implementation of this proposal (#887) found that item
  1 names the members of an `enum` and the fields of a struct and nothing more, and did not widen
  it. The owner's question that started this proposal was about the comments of functions, and a
  unit's `tick` is the function a host developer hovers. Item 4 closes the gap between the two
  accepted texts.

**Amendment 2 (2026-11-02).** The implementation of item 4 (pull request #937) found that the
view declares no static field, so the comment of a static field has no line to stand on, and
recorded the difference as an open deviation. The amendment removes "a static field" from item
4's list and resolves D5. The delivered work does not change.

## What it touches

- **surface 64.** The host-view paragraph and its listing: the view carries the author's JSDoc,
  the compiler's sentence follows it, and the kernel and entry sentences gain the queue sentence.
- **rules: none.** Rule 8.20 (what a host can call), Rule 8.21 (host values) and Rule 11.8 (the
  tiers and the kernel queue) do not change. The view says what they say.
- **exports, codes, examples: none.** `hostFace` keeps its signature and the shape of its result
  (`view`, `code`, `diagnostics`). No diagnostic is added. The examples do not change, and their
  views gain the comments the examples already carry.

**Implementation.** `src/compiler/ts/host-face.ts`: each `HostExport` carries the JSDoc blocks of
its declaration, and of each member for a struct and an `enum`, read from the source file or the
imported shader file; `viewText` prints them before the declaration and before its own sentence;
the kernel and compute sentences gain item 3's sentence. Amendment 1: `carriesComment` in
`src/compiler/ts/host-docs.ts` admits a constructor, a method, each half of an accessor and a
static member of an exported class, and `classView` in `src/compiler/ts/host-face.ts` writes
their blocks on the member lines, with the sentence of change 0109 at the end of the last block
of a member declared `never`.

**Validation.** `src/compiler/ts/host-face.test.ts` gains one case for each row of item 1: a
helper, a constant, an `enum` with a member comment, a struct with a field comment, a `@compute`
entry, a kernel function, a fragment entry, a `never` export, a re-export, two blocks on one
declaration (D1), and a module with no JSDoc, whose view differs from today's only by item 3's
sentence. The host programs that file type-checks against a view keep passing, since no type
changes. `tshc sync --check` over the examples' views is the document validation that every
example's view carries its comments. Amendment 1: `host-face.test.ts` gains one case for each of
a constructor, a method, a getter and a setter, a static field, a static method, a member
declared `never` and a member a derived class takes from its base, and one case that reads the
editor's hover on a method call in a host file (Rule 12.7). The `OnePole` listing of §64 shows
the comment of `tick` on its line.

### Draft impact estimate

Known work: reading the JSDoc blocks in the export collection of `host-face.ts`; printing them in
`viewText`; the test cases above; the §64 text and listing. Compatibility: no host type changes;
every view of a module with JSDoc is rewritten once by `tshc sync` on the next build. Bundle: no
change to the generated module. Downstream: the two documentation repositories update their copy
of the §64 listing. Duration and cost: unknown, no basis for an estimate. Amendment 1: the reader
admits the other member kinds, the printer writes them, the test cases and the §64 listing; no
host type changes, and the view of a module whose classes carry member comments is rewritten
once.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("승인", approve), in answer to the agent's report that listed pull requests #871 and #872
with their open decisions and the draft's recommendations, and asked for the word that accepts
them as drafted. D1 to D3 are accepted as drafted: every JSDoc block attached to the declaration is copied, in source order; tags are copied verbatim and not checked; a struct's field comments stand on the field lines of its `export interface`. The approved revision is the one
this record is part of. The merge of [#871](https://github.com/typeshade/typeshade/pull/871)
with `status: accepted` records the decision.

Responsibilities: an agent of this repository implements items 1 to 3 and the §64 text in pull requests
whose commits say `Change: 0108`. No milestone date is assigned. No duration or cost estimate is
established.

**Amendment 1.** The owner approved the amendment in the Claude Code session on 2026-11-02 (UTC),
in Korean ("승인", approve), in answer to the agent's report that the accepted texts of 0108 and
0109 disagree on the members of a class, and to the agent's proposal to widen 0108 to those
members. D4 is accepted as drafted: every member the view declares. The merge of the pull request
of the branch `claude/0108-amend-members` with `status: accepted` records the decision. An agent
implements item 4 in a pull request whose commits say `Change: 0108`, after the implementation of
change 0116 lands, because both change `src/compiler/ts/host-face.ts`. The record of that work
extends the Configuration and validation record below.

**Amendment 2.** The owner (Seungup) approved the amendment in the Claude Code session on
2026-11-02 (UTC), in Korean ("추천대로", as recommended), in answer to the orchestrator's report
that recommended it. D5 is accepted as drafted: a static field is dropped from item 4's list. The
approved revision is the one this record is part of. The merge of its pull request records the
decision. No implementation is owed: the delivered work of #937 already follows the amended text.

### Configuration and validation record

Accepted revision: the file as merged in [#871](https://github.com/typeshade/typeshade/pull/871)
(`main` at `f458fa7d78ee6c1fb22e222d496db35a5fc53330`). Implementation: pull request
[#887](https://github.com/typeshade/typeshade/pull/887), branch `claude/0108-host-view-jsdoc`, by a
Claude Code agent. The work started from `main` at `78a9060f96857710c17902bb95d0d93d2210c08f`.

Commits with `Change: 0108`:

- `e15d3139`: the reader, the printer, the tests, the baked views of `typeshade/algorithms` and
  `typeshade/random`, and the `src/AGENTS.md` map.
- `119c6777`: surface §64, `reqs/surface/SURF-064.md` and `CHANGELOG.md`.
- `b44f5736`: the comments of the fields a struct inherits.
- `89df17ce`: one comment of `src/compiler/ts/host-docs.ts` is reworded.
- `13af0cf2`: the first version of this record.
- `d264b5d3`: the merge of change 0109, which adapts 0108 to the class view (see below).
- The commit that rewrites this record after that merge.

Commits `1abbc4b2`, `079d0bf1`, `419266ce` and `215f14e5` merge `origin/main` at `c33f7438`, at
`aa337168`, at `30a659e0` and at `4072eba4` into the branch. Each says `Change: none`, because the
changes in it are those of `main`. The local commit policy read the first, the third and the
fourth merge as a change of what `main` made, so the `Docs-Impact:` trailer of each says that the
listed locations were not read there. The second merge needed no trailer. The third merge had two
conflicts, both lists: the first bullet of `Added` in `CHANGELOG.md` (both bullets stay) and the
table of `compiler/ts/` in `src/AGENTS.md` (the table of `main` stays, and the two rows of this
branch are applied to it again). The other three merges had none.

Commit `d264b5d3` merges `origin/main` at `9dbc2985`, which holds change 0109 (#890): an exported
class is `export declare class` in the host view. It says `Change: 0108`, because it adapts the
work of this change to the class view, and it is made with `--no-verify`. The `commit-msg` check
reads a merge against its first parent (issue #901), so the text of Rules 8.20 and 8.21 that
change 0109 wrote on `main` showed as a change of this commit. The message of the commit says so
and names what the merge resolved. The file checks of `bun run precommit` pass on the staged merge,
and `bun scripts/changes.ts --base origin/main` reads the pull request range, where this branch
touches surface §64 alone. The merge had two conflicts:

- `src/compiler/ts/host-face.ts`, two blocks. The list of exports is the `FaceExport` list of
  change 0109 with the map of comments of this change. The result of `hostFace` reports the
  exports as change 0109 does (`logged.map(reported)`) and gives the map to `viewText`.
- `src/AGENTS.md`, one block. The `host-face.ts` row has the edit of each change. The
  `host-docs.ts` row stays.

`CHANGELOG.md`, surface §64, `reqs/surface/SURF-064.md` and `host-face.test.ts` merged without a
conflict. The merge then needed these edits, so that both proposals hold. The approved text of
0108 names the members of an `enum` and the fields of a struct, so the edits go no further:

- The view carries the comment of an exported class above it, and the comment of each field of the
  class on the line of the field. A class that extends an exported class declares its own fields,
  so the comment of an inherited field stands in the base.
- A class with a field that has no host value is written as change 0109 writes it. The sentence of
  the view stands at the end of the last block of the author's comment, and the fields carry theirs.
- The comment of a constructor, a method, an accessor and a static member is not read (open item
  below).
- Five tests of 0108 changed, because a class is no longer an `export interface`. Two tests were
  added. The paragraphs "The author's comments" of §64, the listing of `OnePole` and the entry of
  `CHANGELOG.md` say what the view carries for a class.

Delivered configuration:

- `src/compiler/ts/host-docs.ts` (new). `exportDocs` reads the JSDoc blocks attached to an exported
  declaration, to each `enum` member and to each field of a struct or of an exported class.
  `commentLines` writes them. A linked module's declaration is found again in its own file through
  `LinkedProgram.map`, because the linker drops the JSDoc above a statement. `carriesComment`
  admits a member of an `enum`, a property signature and a property declaration that is not
  static. A constructor, a method, an accessor and a static member are not read.
- `src/compiler/ts/host-face.ts`. `hostFace` reads the comments of each export and gives them to
  `viewText`. `viewText` writes the blocks above the export. It writes the sentence of its own at
  the end of the last block, after one empty comment line. `fieldsBody` and `enumBody` write a
  struct, a class with a field that has no host value, and an `enum` over several lines when one
  of their fields or members has a comment. `classView` writes the comment of the class and the
  comment of each of its fields. `queuedCall` is the sentence of item 3, in the sentence of a
  kernel function and of a `@compute` entry.
- `HostExport`, `HostFace` and `src/__api__/surface.md` do not change.
- `docs/use-typeshade-surface.md` §64: the listing of `terrain.shade.ts` and of its view, the
  comment of the class in the view listing of `OnePole`, and the paragraphs "The author's
  comments". `reqs/surface/SURF-064.md` links Rule 11.8 now, because §64 cites it. The item is
  reviewed.
- `src/compiler/ts/host-face.test.ts`: 20 new cases. One case for each row of item 1 (a helper, a
  constant, an `enum` with a member comment, a struct with a field comment, a `@compute` entry, a
  kernel function, a fragment entry, an export declared `never`, a re-export), two blocks on one
  declaration (D1), tags (D2), the fields a struct inherits, a class and a class with a field that
  has no host value, a module with no JSDoc whose view differs from the old one by the queue
  sentence alone, and four edge cases. One case reads the hover of the editor.
- `src/algorithms/view.ts` and `src/random/view.ts`: baked again with
  `bun scripts/bake-common-modules.ts`. `face.ts` and `index.ts` of both are byte for byte as
  before, so the generated module does not change.
- `src/AGENTS.md` (the `host-face.ts` row and a row for `host-docs.ts`) and `CHANGELOG.md` (one
  entry under `[Unreleased]`, `Added`).
- No rule, export, diagnostic code or example changes.

Functional validation, run by the agent on 2026-11-02 UTC (Linux, Bun 1.4.4, Node 22, TypeScript
5.6.3 unless a line says another version). The repository has no `bun run check` script. The
`check` job of CI gathers the source checks (lint, format, bundle boundary, policy) and the unit
shards, which build first. The first line below runs the same build, lint and format commands.

- `bun run build`, `bun run lint` and `bun run format:check` on `d264b5d3`: each exits 0.
- `bunx vitest run src/compiler/ts` on `d264b5d3`: 181 test files and 4,438 tests; 4,437 passed
  and 1 is a todo. The directory holds `host-face.test.ts` (42 tests: 22 before this change and 20
  new) and `host-class.test.ts` (change 0109).
- `bun run test` on `d264b5d3`: 508 test files and 11,882 tests. 506 files and 11,868 tests
  passed, 4 tests were skipped, 1 is a todo, and 9 tests failed. The 9 are in
  `src/affected-tests.test.ts` (5) and `src/doc-test-selection.test.ts` (4). The same 9 fail on
  `78a9060f`, the base, in this container, so this change does not cause them. The cause is not
  investigated. The same 9 failed on `1abbc4b2`, on `079d0bf1` and on `419266ce`.
- `bunx vitest run` on `src/compiler/ts/host-face.test.ts`, `src/compiler/ts/host-class.test.ts`,
  `src/common-modules.test.ts` and `src/language-service/host-face-export.test.ts`, on TypeScript
  5.9.3 and on 6.0.3, in a copy of the tree with its own `node_modules` (`bun add --no-save`), on
  `d264b5d3`: 80 tests passed on each.
- `bun scripts/bake-common-modules.ts --check` and `bun run gate:boundary` on `d264b5d3`: each
  exits 0.
- `TYPESHADE_CHROMIUM=/usr/bin/google-chrome bun run gate:journeys` on `d264b5d3` (Chrome for
  Testing 153.0.8010.12): "33 journeys, 120 runs: every check passed", exits 0. The journeys hold
  the class of change 0109 and several modules with JSDoc.
- `bun src/cli/bin.ts sync examples`, then `bun src/cli/bin.ts sync --check examples`, on
  `d264b5d3`: 113 views, all up to date. `bunx tsc -p examples/hosts/tsconfig.json --noEmit` exits
  0 with those views. One view, `normal-matrix`, carries an author's comment, the only one the
  examples have on an export.
- Not run: `bun run gate:compile`, `bun run gate:differential`, `bun run gate:render` and
  `bun run gate:perf`. This change emits no WGSL or GLSL, and the generated module is byte for byte
  as before. CI runs these gates.

Document validation:

- `bun run docs:refs` on `d264b5d3`: 0 dead references.
- `bun scripts/doc-impact.ts --base origin/main --check` on `d264b5d3`: exits 0. It lists 4 review
  subjects (`src/compiler/ts/host-face.ts`, `src/compiler/ts/host-docs.ts`,
  `src/algorithms/view.ts`, `src/random/view.ts`). Each sentence was read. `src/AGENTS.md:61` and
  the row for `host-docs.ts` say what the view carries. The others still hold, and no must-fix item
  is open.
- `bun run reqs:sync` writes no change, and `python3 scripts/doorstop-check.py -C -e -F` exits 0,
  on `d264b5d3`. `SURF-064` is reviewed after reading §64 and the rules it links (3.8, 8.20, 8.21,
  11.7, 11.8); the stamps of the links to Rules 8.20 and 8.21 are those of change 0109.
- `bun scripts/changes.ts --base origin/main` and `bun scripts/ifchange.ts --base origin/main` on
  `d264b5d3`: "This change touches surface §64", with no problem listed, and exit 0.
- The two view listings of §64, of `terrain.shade.ts` and of `OnePole` in `filters.shade.ts`,
  against the view that `hostFace` generates for the listed source: the 7 view lines of each are
  generated lines, in the generated order. The comment above `height` and the comment above
  `OnePole` are the generated ones.

Deviations from the approved text, each closed by this record:

- Where the blocks travel. The approved text says each `HostExport` carries the blocks. `HostExport`
  is an export in `src/__api__/surface.md`, and the front matter declares `exports: []`. So the
  blocks travel beside the exports, in a map by export name. `HostExport` and `HostFace` keep their
  shape, as "What it touches" says.
- A module of its own. The approved text names `src/compiler/ts/host-face.ts` for the
  implementation. The reading and the writing of comments are in `src/compiler/ts/host-docs.ts`, so
  that `host-face.ts` changes by one call and the cases of `viewText`.
- Inherited fields. Item 1 says "a struct and each of its fields". The view writes a derived
  declaration with the fields of its base, except a class that extends an exported class, which
  declares its own fields. A field with no block of its own takes the blocks of the base's field,
  as TypeScript's hover does. §64 says so.
- Work the approved text does not list: the baked views of `typeshade/algorithms` and
  `typeshade/random` (held by `src/common-modules.test.ts`), the `CHANGELOG.md` entry and the new
  link of `SURF-064`. None of them changes a rule, an export, a diagnostic code or an example.

Observations, none of them a deviation:

- The queue sentence is written for every kernel function and every `@compute` entry, as the
  approved text says. An entry that has no `void` signature gets it too.
- A JSDoc above a body-less overload signature is not carried. The face reads the implementation.
  The approved text does not cover overloads. No next action is planned.

Open item, closed by item 4:

- The comment of a constructor, a method, an accessor and a static member of an exported class was
  not carried. Change 0109 declares those members, and the listing in `changes/0109-host-classes.md`
  shows the comment of a method (`tick`) as one of "proposal 0108". The approved text of 0108 names
  the members of an `enum` and the fields of a struct, so this change does not widen it. A member
  that is declared `never` keeps the sentence of change 0109. Amendment 1 widened the approved text
  to those members (item 4, D4). Commit `890b1315` delivers item 4 and closes this item. The
  section "Item 4 (Amendment 1)" below extends this record.

Pending: no work of this repository. The downstream work is as listed in "What it owes
downstream". The open items of item 4 are listed in its section below.

**Item 4 (Amendment 1).** Accepted revision: the file as merged in
[#915](https://github.com/typeshade/typeshade/pull/915) (squash `bb82036b`), which holds
Amendment 1. Implementation: pull request [#937](https://github.com/typeshade/typeshade/pull/937),
branch `claude/0108-member-docs`, by a Claude Code agent. The work started from `main` at
`7bff5e0a6ac20e13fdb28849ced37bb8e9b89458` (the merge of #928) on 2026-11-02 (UTC).

Commits with `Change: 0108`:

- `890b1315`: the reader, the printer, the tests and the `src/AGENTS.md` row. It delivers item 4.
- `acf13710`: surface §64 and `CHANGELOG.md`.
- `461d37a0`: the test of a class that a module re-exports, and two reworded comments.
- `8992b873`: each case of item 4 holds its source to no diagnostic from `compile()` and from the
  language service.
- `d6796627`: the merge of change 0116 (see below).
- The commit that rewrites this record.

Commit `2b04b964` merges `origin/main` at `14566606` into the branch. It says `Change: none`,
because the changes in it are those of `main`. It had no conflict. The policy check
`bun run precommit --message-file` passed the staged merge, since #932 (on `main`) judges a merge
by what it adds beyond its parents (issue #901). The hooks are not installed in this worktree, so
no hook ran at commit time.

Commit `d6796627` merges `origin/main` at `9822490f` into the branch. `main` holds change 0116
([#918](https://github.com/typeshade/typeshade/pull/918): the view spells each type with the host
type family of `src/runtime/host-types.ts`) and the pull requests #933, #936, #940, #941 and #942.
The commit says `Change: 0108`, because it adapts the work of this change to the spelling of
change 0116. The merge had five conflicts. Each is resolved so that both changes hold:

- `src/compiler/ts/host-face.ts`, four blocks in `memberLines` and `classView`. `memberLines`
  keeps the `MemberView` of item 4 and takes the `args` parameter of change 0116, so each argument
  is spelled `argType(p.type, args)`. `classView` takes `args` too.
- `src/compiler/ts/host-face.test.ts` and `src/compiler/ts/host-class.test.ts`, one block each. The
  pinned lines of a class with comments take the family's names (`f32`) and the comment of `tick`.
- `docs/use-typeshade-surface.md`, two blocks in §64. The listing of the view of `OnePole` has
  `f32` and the comment of `tick`, and the sentence that said that the comment of a method is not
  copied is gone.
- `src/AGENTS.md`, one block. The row of `host-face.ts` is that of change 0116, and the row of
  `host-docs.ts` is that of item 4.

`CHANGELOG.md` merged without a conflict, and both entries stand. The twelve cases of item 4 then
took the family's names in their pinned texts. `bun run precommit --message-file` passed the staged
merge, so the commit needed no `--no-verify`.

Delivered configuration:

- `src/compiler/ts/host-docs.ts`. `carriesComment` admits a constructor, a method, each half of an
  accessor and a field, a static one among them. A constructor or a method with no body is an
  overload signature and is not read. An abstract method has no body and is read. `memberKey`
  names where `ExportDocs.members` keeps the blocks of a member (`tick`, `static unit`,
  `get gain`, `static set gain`), and `CONSTRUCTOR` names where it keeps the constructor's. A member
  with no block of its own takes the blocks of the member of that name in a base, as a field does.
  A class that has a constructor of its own takes none from the constructor of a base.
- `src/compiler/ts/host-face.ts`. `memberLines` returns a `MemberView` for each member: its
  declarations, the keys of the blocks above each one, and the reason of a member declared `never`.
  `classView` writes the blocks of the constructor and of each member on its line. Both take the
  `args` parameter of change 0116, so the types of the members are spelled with the host type
  family. For a member declared `never` it writes the author's blocks first and the sentence of
  change 0109 at the end of the last block. `notCallable` is that sentence, which the `never`
  export uses too. A member of a class that is declared as the member of the class above it is not
  written again, as before, so it stands in the base with its comment. A class declared without
  `extends` writes each member it takes with the blocks of the base member.
- Item 4 changes none of `HostExport`, `HostFace` and `src/__api__/surface.md`.
- `src/compiler/ts/host-face.test.ts`: 56 tests, 12 more than `main` at `9822490f`. There is one
  case for each of a constructor, a method, a getter and a setter, a static field, a static method,
  a member declared `never` and a member a derived class takes from its base. One more case reads
  the editor's hover on a method call in a host file, and on a constructor, an accessor, a static
  method and a member declared `never`. Four more cases cover an abstract member, a flat
  declaration whose base stands in another file, a class that a module re-exports, and an overload
  signature. Every case holds its source to no diagnostic from `compile()` and from the language
  service (Rule 12.7). The test that kept the other members of a class as change 0109 declares
  them now holds item 4.
- `src/compiler/ts/host-class.test.ts`: the expected view of `OnePole` has the comment of `tick`.
  The pinned views of the 12 cases and of this one are spelled with the family's names (`f32`).
- `docs/use-typeshade-surface.md` §64: the paragraphs "The author's comments" and the listing of
  the view of `OnePole`, which shows the comment of `tick` on its line, spelled with `f32`.
- `CHANGELOG.md`: the entry of 0108 under `[Unreleased]`, `Added`, says what a class carries.
- `src/AGENTS.md`: the row of `host-docs.ts`.
- `reqs/surface/SURF-064.md` does not change. Its text and its links are as before, so
  `bun run reqs:sync` writes no change and Doorstop flags no item.
- No rule, export, diagnostic code or example changes. Item 4 changes no baked view of
  `typeshade/algorithms` and `typeshade/random` and no view of the examples, because no class of
  them has a comment on a member.

Functional validation, run by the agent on 2026-11-02 UTC (Linux, Bun 1.4.4, Node 22.23.4, TypeScript
5.6.3 unless a line says another version), on `d6796627` unless a line says another commit:

- `bun run build`, `bun run lint` and `bun run format:check` on `d6796627`: each exits 0. The
  first run of `bun run build` on this commit ended on SIGTERM, with no TypeScript error; the
  cause was not investigated, and the second run exits 0. The generated views of `examples/` were
  removed before the build. They are git-ignored files that `tsc --build` also
  reads: with them present it reports TS6133 in `examples/kernel-image-invert.shade.typeshade.ts`,
  an unused `Resident` import that this change does not touch.
- `bunx vitest run src/compiler/ts src/language-service` on `d6796627`: 212 test files and 5,652
  tests; 5,651 passed and 1 is a todo. `host-face.test.ts` holds 56 of them and
  `host-class.test.ts` 22.
- `bun run test` on `d6796627`: 517 test files and 12,057 tests. 515 files and 12,043 tests passed,
  4 tests were skipped, 1 is a todo, and 9 tests failed. The 9 are in `src/affected-tests.test.ts`
  (5) and `src/doc-test-selection.test.ts` (4). They pass when `NODE_OPTIONS` is unset (next line).
  The session that ordered this work named the container's `NODE_OPTIONS` as their cause; this work
  did not investigate it.
- `env -u NODE_OPTIONS bunx vitest run src/affected-tests.test.ts src/doc-test-selection.test.ts`
  on `d6796627`: 2 test files and 88 tests; all pass.
- `bunx vitest run` on `src/compiler/ts/host-face.test.ts`, `src/compiler/ts/host-class.test.ts`,
  `src/common-modules.test.ts` and `src/language-service/host-face-export.test.ts`, on TypeScript
  5.9.3 and on 6.0.3, in a copy of the tree with its own `node_modules` (`bun add --no-save`), at
  `d6796627`: 96 tests passed on each.
- `bun scripts/bake-common-modules.ts --check` and `bun run gate:boundary` on `d6796627`: each
  exits 0.
- `bun src/cli/bin.ts sync examples`, then `bun src/cli/bin.ts sync --check examples`, on
  `d6796627`: 114 views, all up to date. `bunx tsc -p examples/hosts/tsconfig.json --noEmit` exits
  0 with those views. No view of the examples has a comment on a class member.
- `bun run gate:journeys` on `d6796627`, with `TYPESHADE_CHROMIUM` set to the headless shell of
  Chromium revision 1243:
  `/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.
  The result is "34 journeys, 123 runs: every check passed", and the exit code is 0. The import
  journey type-checks and bundles `journeys/_host-import/src/filters.shade.ts`. Its class `OnePole`
  has a commented method, and the view `hostFace` writes for that file has the comment of `tick` on
  its line. The run left a `vite` process behind (issue #923), which was stopped.
- The same checks ran earlier on `2b04b964` and `8992b873`, before the merge of change 0116. Each
  passed, and `bun run test` failed in the same 9 tests. The lines above replace them.
- Not run: `bun run gate:compile`, `bun run gate:differential`, `bun run gate:render` and
  `bun run gate:perf`. This change emits no WGSL or GLSL, and the generated module is as before.
  CI runs these gates.

Document validation:

- `bun run docs:refs` on `d6796627`: 0 dead references in 1,435 files.
- `bun scripts/doc-impact.ts --base origin/main --check` on `d6796627`: exits 0. It lists 2 review
  subjects (`src/compiler/ts/host-docs.ts` and `src/compiler/ts/host-face.ts`) with 18 locations.
  Each location was read. `src/AGENTS.md:65` is updated in this change. The others name
  `host-face.ts` as an owner or as the test that pins a rule (`docs/language-design.md` lines 964,
  986, 1021, 1034, 1056, 1380, 1405 and 1427, `docs/computing-platform-plan.md:80`,
  `docs/debugging.md:491`, `docs/runtime-architecture.md:288`, `docs/use-typeshade-plan.md:294`,
  `src/AGENTS.md:64` and `:257`, and the proposals 0048, 0082 and 0085). They say nothing of the
  comments of class members and still hold. Lines 964 and 986 and the row at `src/AGENTS.md:64`
  were read again after the merge of change 0116. No must-fix item is open.
- `bun run reqs:sync` writes no change, and `python3 scripts/doorstop-check.py -C -e -F` exits 0, on
  `d6796627`. `SURF-064` is not flagged, because its text and its links did not change in this
  work, so no `doorstop review` or `doorstop clear` ran. §64 and the rules it links (3.8, 8.20,
  8.21, 11.7 and 11.8) were read.
- `bun scripts/changes.ts --base origin/main` on `d6796627`: "This change touches surface §64", with
  no problem listed, and exits 0. `bun scripts/ifchange.ts --base origin/main`: exits 0.
- The listing of the view of `OnePole` in §64, against the view that `hostFace` generates for the
  listed source: the 8 lines of the class are the generated lines, in the generated order, and the
  `run` line is the generated line. The listing of `terrain.shade.ts` and its view are those of
  change 0116 and do not change here.

Deviations from the approved text, each with its disposition:

- A static field. Item 4 lists a static field among the members that carry a comment. The view
  declares no static field: a static field is the module constant `Cls_Field` (surface §26), and
  change 0109 declares the static functions of a class and no field. The comment of a static field
  has no line to stand on. Item 4 says "each member it declares", and the delivered work follows
  that rule: the comment of a static field is not carried, and that of a static method beside it
  is. `carriesComment` admits a static property declaration, so the reader is ready if a later
  change declares static fields. The case "leaves the comment of a static field out" of
  `host-face.test.ts` pins this. Disposition: closed by Amendment 2 (2026-11-02), which removes "a static field" from item
  4 and makes the delivered work the approved text.
- The order of delivery. The Approval and plan record puts item 4 after the implementation of
  change 0116, because both change `src/compiler/ts/host-face.ts`. This pull request was prepared
  while pull request #918 (change 0116) was open. #918 merged into `main` as `9822490f` before this
  pull request was finished, and commit `d6796627` takes it into the branch with `host-face.ts`
  resolved so that both changes hold. Disposition: closed by `d6796627`.
- Work the approved text does not list: four test cases beyond the eight it names (an abstract
  member, a flat declaration with a base in another file, a class a module re-exports, an overload
  signature), the rewrite of one test of the first implementation, the new expectation in
  `host-class.test.ts` and the `notCallable` helper. None of them changes a rule, an export, a
  diagnostic code or an example. Disposition: closed by this record.

Observations, none of them a deviation:

- A member of a class that has the same declaration as the member of the exported class above it
  is not written again, whatever its comment. So an override with its own comment and the same
  host declaration shows the comment of the base. The approved text says that a member the view
  takes from an exported base class stands in the base with its comment. No next action is planned;
  a later amendment may have the view write such an override again.
- A getter and a setter that are declared `never` stand on one line. That line carries the blocks of
  the getter, then those of the setter, then the sentence. The editor shows the last block of a
  declaration, so a hover shows the block of the setter and the sentence.
- The constructor line of a class carries the comment of the constructor the class runs: its own,
  or the nearest above it. A derived class declared with `extends` repeats that line, with the same
  comment, as it repeats the line before this change.
- A field that a class writes with a private name (`#x`, Rule 8.12) is declared `private x` in the
  view, and its comment was not carried, because `memberName` read no private name. This predates
  item 4: item 1 names the fields of a class. Filed as issue #951 and fixed by pull request #963
  (squash commit `a61c861b`, 2026-11-02): the `private x` line carries the blocks of `#x`.
- An overload signature with no body is now part of the approved text (item 4). The first record
  above says that the approved text did not cover it.

Open items:

- The static field: closed by Amendment 2.
- The private-name field in the observations above: fixed by #963 (`a61c861b`).
- Not run: `bun run gate:compile`, `bun run gate:differential`, `bun run gate:render` and
  `bun run gate:perf`. This change emits no WGSL or GLSL, and the generated module is as before.
  CI runs these gates.
- The downstream work is as listed in "What it owes downstream".

## What it owes downstream

- **typeshade.github.io.** The page that copies the host-view paragraph of §64 and its listing,
  in English and in Korean, shows the author's comment in the listing and says the view carries
  it; `compiler-changes.md` records 0108 when the pin moves.
- **vscode-typeshade.** The skill's host reference (`references/host.md`) where it quotes a host
  view, and any fixture that pins a view's text, gain the author's comment and the queue
  sentence; `compiler-changes.md` records 0108 when the pin moves.
- **typenn, typecv.** Nothing must change. Their generated views gain the comments of their
  shader modules on the next pin; `compiler-changes.md` records 0108 in each when its pin moves.
