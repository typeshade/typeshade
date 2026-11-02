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

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0108, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC); see Approval and plan record.                                                                                                                                                                                                                   |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                     |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, while designing an audio library on the compiler. The owner asked whether a built module keeps the author's function comments ("빌드된 파일의 함수 주석이라던가 지원되는지"). The agent reported that the host view carries none. The owner approved the drafting of this proposal ("승인"). No GitHub issue is recorded. |
| Applicability / effectivity   | The host view that `hostFace` writes (`src/compiler/ts/host-face.ts`, `viewText`), its description in `docs/use-typeshade-surface.md` §64, and `src/compiler/ts/host-face.test.ts`. The generated module, the CPU tier, the rules, the exports, the diagnostic codes and the examples do not change. No release version is assigned.                                                              |
| Review baseline               | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02.                                                                                                                                                                                                                                                                                        |
| Review and revision authority | Pull request [#871](https://github.com/typeshade/typeshade/pull/871) (branch `claude/proposal-0108-host-view-docs`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                              |

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
the kernel and compute sentences gain item 3's sentence.

**Validation.** `src/compiler/ts/host-face.test.ts` gains one case for each row of item 1: a
helper, a constant, an `enum` with a member comment, a struct with a field comment, a `@compute`
entry, a kernel function, a fragment entry, a `never` export, a re-export, two blocks on one
declaration (D1), and a module with no JSDoc, whose view differs from today's only by item 3's
sentence. The host programs that file type-checks against a view keep passing, since no type
changes. `tshc sync --check` over the examples' views is the document validation that every
example's view carries its comments.

### Draft impact estimate

Known work: reading the JSDoc blocks in the export collection of `host-face.ts`; printing them in
`viewText`; the test cases above; the §64 text and listing. Compatibility: no host type changes;
every view of a module with JSDoc is rewritten once by `tshc sync` on the next build. Bundle: no
change to the generated module. Downstream: the two documentation repositories update their copy
of the §64 listing. Duration and cost: unknown, no basis for an estimate.

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

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
pull requests with `Change: 0108` in their commits, the delivered configuration, the observed
results of the functional validation (the test cases above and `tshc sync --check`) and the
document validation (`bun run docs:refs`, `bun run docs:impact`, the §64 listing checked against
a generated view). Required future evidence is not a completed result.

## What it owes downstream

- **typeshade.github.io.** The page that copies the host-view paragraph of §64 and its listing,
  in English and in Korean, shows the author's comment in the listing and says the view carries
  it; `compiler-changes.md` records 0108 when the pin moves.
- **vscode-typeshade.** The skill's host reference (`references/host.md`) where it quotes a host
  view, and any fixture that pins a view's text, gain the author's comment and the queue
  sentence; `compiler-changes.md` records 0108 when the pin moves.
- **typenn, typecv.** Nothing must change. Their generated views gain the comments of their
  shader modules on the next pin; `compiler-changes.md` records 0108 in each when its pin moves.
