---
id: '0108'
title: A host file reads the author's JSDoc of each export of a shader module in the host view, before the sentence the compiler writes for a call
status: accepted
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

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0108, `status: accepted`: items 1 to 3 are implemented by pull request [#887](https://github.com/typeshade/typeshade/pull/887) (see Configuration and validation record), and item 4 (Amendment 1) awaits its implementation. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC) and Amendment 1 later the same day; see Approval and plan record. |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                          |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, while designing an audio library on the compiler. The owner asked whether a built module keeps the author's function comments ("빌드된 파일의 함수 주석이라던가 지원되는지"). The agent reported that the host view carries none. The owner approved the drafting of this proposal ("승인"). No GitHub issue is recorded.                      |
| Applicability / effectivity   | The host view that `hostFace` writes (`src/compiler/ts/host-face.ts`, `viewText`), its description in `docs/use-typeshade-surface.md` §64, and `src/compiler/ts/host-face.test.ts`. The generated module, the CPU tier, the rules, the exports, the diagnostic codes and the examples do not change. No release version is assigned.                                                                                   |
| Review baseline               | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02.                                                                                                                                                                                                                                                                                                             |
| Review and revision authority | Pull request [#871](https://github.com/typeshade/typeshade/pull/871) (branch `claude/proposal-0108-host-view-docs`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                   |
| Amendment 1                   | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction, on the branch `claude/0108-amend-members`. It widens item 1 to the members of an exported class (item 4, decision D4), after change 0109 made an exported class a value of the host face. Items 1 to 3, their approval and their record do not change. The merge of its pull request with `status: accepted` records the decision.          |

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
   constructor, a method, each half of an accessor, a static field and a static method. A member
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
- **D4 (Amendment 1).** Which members of an exported class: every member the view declares (the
  amendment), or the methods alone. The amendment carries every member, because a host that
  builds an instance reads the constructor, calls the methods, reads the accessors and calls a
  static member on the class.

**Amendment 1 (2026-11-02).** Change 0109, accepted the same day as this proposal, made an
exported class a value of the host face, and its listing shows the comment of the method `tick`
in the view as one of this proposal. The implementation of this proposal (#887) found that item
1 names the members of an `enum` and the fields of a struct and nothing more, and did not widen
it. The owner's question that started this proposal was about the comments of functions, and a
unit's `tick` is the function a host developer hovers. Item 4 closes the gap between the two
accepted texts.

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

Open item:

- The comment of a constructor, a method, an accessor and a static member of an exported class is
  not carried. Change 0109 declares those members, and the listing in `changes/0109-host-classes.md`
  shows the comment of a method (`tick`) as one of "proposal 0108". The approved text of 0108 names
  the members of an `enum` and the fields of a struct, so this change does not widen it. A member
  that is declared `never` keeps the sentence of change 0109. Amendment 1 widens the approved text
  to those members (item 4, D4). Its implementation is pending and extends this record when it
  lands.

Pending: the implementation of item 4 (Amendment 1). The downstream work is as listed in "What it
owes downstream".

## What it owes downstream

- **typeshade.github.io.** The page that copies the host-view paragraph of §64 and its listing,
  in English and in Korean, shows the author's comment in the listing and says the view carries
  it; `compiler-changes.md` records 0108 when the pin moves.
- **vscode-typeshade.** The skill's host reference (`references/host.md`) where it quotes a host
  view, and any fixture that pins a view's text, gain the author's comment and the queue
  sentence; `compiler-changes.md` records 0108 when the pin moves.
- **typenn, typecv.** Nothing must change. Their generated views gain the comments of their
  shader modules on the next pin; `compiler-changes.md` records 0108 in each when its pin moves.
