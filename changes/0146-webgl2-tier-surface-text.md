---
id: '0146'
title: The surface document and three rule texts say what the WebGL2 tier runs, and name its real gaps as not supported yet
status: accepted
rules:
  - '8.24'
  - '10.3'
  - '10.5'
  - '11.11'
  - '12.3'
surface:
  - 2
  - 12
  - 14
  - 18
  - 20
  - 23
  - 24
  - 33
  - 36
  - 37
  - 46
  - 47
  - 48
  - 53
  - 62
  - 65
  - 66
  - 67
  - 69
  - 71
  - 72
  - 74
  - 77
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Each page that quotes or paraphrases the thirteen sections says that WebGL2 has no atomics, no workgroup memory or no storage buffer. Search the pages (en and ko) for those claims and for the old reduction reason in §71. Each page follows the new text. compiler-changes.md records 0146
  - repo: vscode-typeshade
    what: The skill and any hover or completion text that repeat the same claims follow the new text. compiler-changes.md records 0146
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0146, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                              |
| Date and attribution          | 2026-11-23, UTC (the drafting date). An AI agent (Claude Code) drafted it for the owner, who said "네" on 2026-11-23 to drafting it. The owner's words in `docs/owner-decisions.md` (OD-11) are a decision about direction, not an approval of this text. |
| Applicability / Effectivity   | `docs/use-typeshade-surface.md` (thirteen sections) and `docs/language-design.md` (Rules 10.3, 10.5 and 11.11). No release version is assigned (OD-6: nothing is released).                                                                               |
| Review baseline               | `main` at `698af76f`, where the patches were made. Both patches also apply to `main` at `d31bfbff`.                                                                                                                                                       |
| Review and revision authority | Pull request #1441. Git records the revisions. The owner's go-ahead in the conversation is the review (CLAUDE.md, Merging), and the merge of #1441 records the decision.                                                                                  |

## What changes

This proposal changes no behaviour, export, diagnostic code or example. It changes the text of
thirteen sections of `docs/use-typeshade-surface.md` and the wording of three rule texts, so that
they match Rule 11.8, Rule 8.24, change 0054, change 0080 and OD-11. The three rule texts are
Rule 10.3, Rule 10.5 and Rule 11.11 of `docs/language-design.md`. The second OD-11 audit found
that each states a WebGL2 API fact as the reason for a refusal.

Today the surface document says in several places that WebGL2 has no atomics, no workgroup memory
or no storage buffer. Those are facts about the WebGL2 API. The rules say that the WebGL2 tier
runs a `@compute` entry as a pass program with read-write storage, barriers and atomic operations
(Rule 8.24, change 0054). OD-11 says that "WebGL2 has no X" is never a reason, by itself, that a
program does not run on the tier.

After this change, each passage does one of two things.

1. It states what the tier runs, and cites the rule or change.
2. It states a real gap as "not supported yet on the WebGL2 tier", with the rule or decision.

The passages, by section:

| Section | Passage                                                                                                                                     | Disposition                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §14     | A whole struct element of a storage array is not copied                                                                                     | Reworded neutrally: "this version does not copy ..." on the WebGL2 tier. No rule states it (open question 1).                                                                                           |
| §20     | "GLSL ES 3.00 has no form: it has no storage buffer"                                                                                        | Reworded: the GLSL writer has no form of a runtime-sized array. `compile()` emits WGSL alone. A `@compute` entry that reaches it runs on the tier as its pass program (change 0054, Rule 11.8).         |
| §23     | "GLSL ES 3.00 has no storage buffers and no atomics"                                                                                        | Reworded: the GLSL writer has no form of an atomic. A `@compute` entry that reaches no texture runs on the tier as its pass program in the phased order (change 0054, Rule 11.8).                       |
| §33     | "GLSL ES 3.00 has no image load/store", as a reason for WGSL only                                                                           | Kept as a fact about the GLSL emitter, reworded so that it says `compile()` emits no GLSL text. A storage texture on the tier is a runtime texture (§69, Rule 11.11).                                   |
| §46     | "WGSL-only ... GLSL ES 3.00 has no image load/store at all"                                                                                 | Reworded: `compile()` emits no GLSL text for an image load or store (§33).                                                                                                                              |
| §48     | "all three WebGPU-only"                                                                                                                     | Reworded: the GLSL writer fails closed; the pass program of change 0054 (Rule 11.8) is not made by that writer. The rules do not say which of the three builtins gets a form, so the text does not say. |
| §65     | "WebGL2 has no compute stage"; a reduction, a scatter or a write not at `i`                                                                 | Reworded: Rule 11.8 states what the tier takes. The rest "is not supported yet on the WebGL2 tier" and goes on to the CPU tier.                                                                         |
| §66     | "GLSL ES 3.00 has no storage buffer and records nothing"                                                                                    | Reworded: a GLSL program that `compile()` emits records nothing. Recording a console on the tier is "not supported yet" (§69, Rule 11.11).                                                              |
| §67     | "WebGL2 has no compute stage"; "WebGL2 has no storage buffer" in a draw                                                                     | The first is dropped. The second is a gap: "does not support a storage binding in a draw yet (OD-11)".                                                                                                  |
| §69     | "WebGL2 cannot ask a `WebGLTexture` its size"; "records no console"; "targets that blend or mask apart, because WebGL2 has one blend state" | Each is a gap: "not supported yet on the WebGL2 tier (Rule 11.11)". A lowering of each is TypeShade's work (OD-11). The text states no cause for the size one.                                          |
| §71     | The reduction reason: "which WebGL2 has no workgroup memory for"                                                                            | Reworded to the text of pull request #1437 (below).                                                                                                                                                     |
| §72     | Histogram: "WebGL2 has no atomics"                                                                                                          | A gap: the tier does not support a kernel function's atomic add yet (Rule 11.8).                                                                                                                        |
| §74     | "WebGL2 has no atomics, and runs no such function"                                                                                          | A gap: the tier does not support such a function yet (change 0080, Rule 11.8).                                                                                                                          |

**Rule texts (added 2026-11-23).** Each refusal stays as it is. Only the reason is reworded.

| Rule  | Passage                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.3  | `TS8015` stays "only for what the WebGL2 tier cannot do"; the example "whose format WebGL2 cannot render to"                | Reworded: "does not support yet (OD-11)"; the example ends "a format that is not supported yet on the WebGL2 tier (Rule 10.5)".                                                                                                                                                                                                                                                                                                                                         |
| 10.5  | "a format WebGL2 cannot render to is refused with that reason"                                                              | Reworded: the refusal is "not supported yet on the WebGL2 tier (Rule 10.5)"; a fallback is later work (OD-11).                                                                                                                                                                                                                                                                                                                                                          |
| 11.11 | "it refuses with a `TypeError` what WebGL2 has no form of (...)"                                                            | Reworded in two groups. The tier does not support the first group yet, and a fallback for each is later work (OD-11). The first group includes a texture bound from the depth attachment of the pass that draws: WebGPU samples a read-only depth attachment, so a fallback is TypeShade's work. The second group has no fallback meant: a `GPUCommandEncoder` and a pass's `GPURenderPassEncoder`, which are WebGPU objects. The runtime's refusal wording is #1470's. |
| 11.11 | The list item "a multisampled, layered, 3D or storage texture" (added 2026-11-23, by the owner's answer to open question 2) | Reworded: the item names "a storage texture in a draw". A compute entry's storage texture runs as its pass program (Rule 10.5, Rule 11.8).                                                                                                                                                                                                                                                                                                                              |

The list in Rule 11.11 keeps its items, and splits them as the table says, except the storage texture item (open question 2, answered
2026-11-23). Rule 10.5's first sentence, the
deferral of the GLSL lowering of the WGSL-only family, is the maintainer's and is not changed.
The mirrors `reqs/rules/RULE-1003.md`, `RULE-1005.md` and `RULE-1111.md` are generated by
`bun run reqs:sync`.

**The TS8015 message changes in the implementing pull request.** The diagnostic text built in
`src/core/passes/gl-compute.ts` (line 468 on `main` at `9c47626a`) changes with Rule 10.3. The
assertions that carry the old text change with it:
`src/runtime/runtime.test.ts`, `src/core/passes/gl-compute.test.ts`,
`src/language-service/check.test.ts` and `src/compiler/ts/compile.contract.test.ts`. The
implementing pull request also reads the related user-facing message "which this context cannot
render to" (`src/core/gl-compute.ts:923` on `main` at `d31bfbff`). It decides there whether that
text changes under Rule 10.5. It also updates the comment at `src/runtime/runtime.test.ts:2500`.
The compiler and the language service build the same text
(Rule 12.7), so both halves are asserted on the same source.

**Dependency on pull request #1437.** Pull request #1437 is merged. It changed two runtime texts
in `src/`. The kernel reduction reason is now `which the WebGL2 tier does not support yet
(Rule 11.8)` (`src/core/passes/kernel-lower-gl.ts`). The draw refusal text is in
`src/core/manifest.ts`. §71 quotes the first text, and §67 states the second in prose. The
dependency is met.

**The runtime refusals are not changed here.** On `main` at `698af76f`, the runtime's refusal
texts in `src/runtime/` (for example `gl-draw.ts` and `gl.ts`) state API facts as reasons. OD-11
forbids that. Rule 11.11 no longer claims one wording for them. Pull request #1470 (open, a bug fix
with `Change: none`) rewords them under OD-11. This proposal does not declare that work.

Before (§74):

> WebGL2 has no atomics, and runs no such function.

After (§74):

> The WebGL2 tier does not support such a function yet (change 0080, Rule 11.8).

**Conflict for the owner.** Two texts disagreed. The owner decided on 2026-11-23 which one governs.

- Fact: OD-11 says that "WebGL2 has no X" is never by itself a reason that a program does not run
  on the tier, and that a gap is worded "not supported yet on the <tier> tier (Rule N.M)".
- Fact: Rule 10.5 says that "a format WebGL2 cannot render to is refused with that reason". The
  `TS8015` text of Rule 10.3 and the code in `src/core/passes/gl-compute.ts` say "whose format
  WebGL2 cannot render to".
- Fact: `docs/owner-decisions.md` (Precedence 1 and 2) gives OD-11 precedence over other documents.
- [decision, owner, 2026-11-23] The owner was asked: "Should 0146 reword Rules 10.3, 10.5 and
  11.11 (the reason 'WebGL2 cannot render to that format') to 'not supported yet on the WebGL2
  tier (Rule N.M)', with the refusal itself unchanged?" The owner chose "규칙 문구를 바꿈". In
  English: reword the rule texts. The refusal stays, and only its reason changes.

Before (one refusal, `TS8015`, a `texture_storage_2d<rgba8snorm, write>` in a compute entry):

> compute entry 'cs' has no WebGL2 pass program: it reaches the texture_storage_2d<rgba8snorm, write> "t", whose format WebGL2 cannot render to

After:

> compute entry 'cs' has no WebGL2 pass program: it reaches the texture_storage_2d<rgba8snorm, write> "t", a format that is not supported yet on the WebGL2 tier (Rule 10.5)

## Why

Agents in several sessions read "WebGL2 has no X" in the surface document and concluded that a
program cannot run on the tier. That conclusion is false for atomics, workgroup memory and
read-write storage in a `@compute` entry (Rule 8.24, change 0054). The owner decided on
2026-11-23 that this is wrong (OD-11). The surface document is the text that authors and agents
read, so it must not say it.

The alternative is to leave the text and rely on OD-11 alone. That keeps a false sentence in a
normative-adjacent document. This proposal rejects it.

Assumption: where a passage keeps a gap, Rule 11.8 or the cited change states it. A gap that no
rule states is worded as "not supported yet", with no claim that the tier cannot do it. §14 is
not stated by a rule that this author found, so it says only what this version does. The forms
of the three builtins in §48 are not stated either, so §48 does not say. Both are the open
question (below).

## Owner's decisions

- OD-11: a feature WebGL2 lacks is TypeShade's work to provide, not a reason to drop the tier.
  This proposal applies it to the surface text.
- OD-3: the compiler's and the runtime's work provides the fallback, not the author.
- OD-9: a program need not translate one-to-one into a target language. The result is the same on
  every tier.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form.
It corrects the text of existing sections.

## What it touches

- Rules 10.3, 10.5 and 11.11 in `docs/language-design.md`: the wording of the reason, as in the
  table above. No behaviour changes. The patch is held in `p0146-rules.patch`, next to the
  surface patch. It edits the three rules and their generated mirrors `reqs/rules/RULE-1003.md`,
  `RULE-1005.md` and `RULE-1111.md`. `bun run reqs:sync` and `python scripts/doorstop-check.py -C`
  run in the implementing pull request, and a person reviews each changed RULE item
  (`reqs/README.md`).
- Code and tests, in the implementing pull request: the `TS8015` text in
  `src/core/passes/gl-compute.ts` and the four test files named above.
- Surface §14, §20, §23, §33, §46, §48, §65, §66, §67, §69, §71, §72, §74: the passages in the table above. The
  declaration is exactly the set that `scripts/changes.ts` finds in the diff.
- Exports, codes, examples and names: none. Rules 11.8 and 8.24 are read, not changed.
- Requirement items. The surface patch edits `reqs/surface/SURF-023.md`,
  `reqs/surface/SURF-074.md`, `reqs/surface/SURF-033.md` and `reqs/surface/SURF-066.md`, and
  adds the new items SURF-020 and SURF-048 in the same directory (`bun run reqs:sync` writes
  them). SURF-020, SURF-023, SURF-048 and SURF-074 carry a link to RULE-1108 (Rule 11.8).
  SURF-033 and SURF-066 carry a link to RULE-1111 (Rule 11.11). The implementing pull request
  needs `doorstop review SURF-020` and `doorstop review SURF-048` by a person who read each
  item, and the review of the changed links of the other four.
- Evidence the implementing pull request needs: `bun scripts/changes.ts`, `bun run docs:refs`,
  `bun run docs:impact`, `bun run reqs:sync`, and the review of the SURF items it flags.

### Draft impact estimate

Known: the surface document changes, with about 70 lines, and three rule texts change: Rule 11.11 in its list, its split of
items and its closing clause, and Rules 10.3 and 10.5 in one reason each. No code changes in this proposal. Unknown: the number of site and
editor passages that repeat the old claims; the downstream search sets it. A person must review
each changed SURF item in `reqs/` (`reqs/README.md`). Decision needed before acceptance: open
question 1, below.

**Open question for the owner.**

1. §14 and §48. Does the tier copy a whole struct element from a storage array, and which of
   `atomicCompareExchangeWeak`, `workgroupUniformLoad` and `textureBarrier` does the pass
   program give a form? Recommendation: keep the text as written until a test answers, and
   record the answer as a rule.
2. Rule 11.11 lists "a storage texture" among the forms the WebGL2 draw path refuses. Rule 11.8
   and Rule 8.24 run a storage texture in a `@compute` entry on the tier. The list did not say
   which use the item means.
   - [answer, owner, 2026-11-23] The owner was asked which use the item means. The owner chose
     "draw의 storage texture만". In English: only a storage texture in a draw.
   - The rules patch rewords the item of Rule 11.11 to name "a storage texture in a draw". A
     compute entry's storage texture runs as its pass program (Rule 10.5, Rule 11.8). The change
     is in the rule-text table.
   - Status: answered. Open question 1 stays open.

### Independent review record

- Reviewer: an AI agent that did not write the proposal.
- Date: 2026-11-23.
- Revision reviewed: `a20bb040`.
- Findings: 0 blocking, 2 should-fix, 3 nits.
- Verdict: approve after fixes. The fixes are in the revision after `a20bb040`.

| Finding | Class      | Answer                                                                                                                                                                     |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | should fix | §48 text and table row no longer call compare-exchange an atomic or `workgroupUniformLoad` a phase boundary. They say that the rules do not say which builtin gets a form. |
| 2       | should fix | §23 and §48 now say a `@compute` entry "that reaches no texture" (Rule 11.8).                                                                                              |
| 3       | nit        | §23 wording smoothed. The §14 and §67 replacement lines are broken.                                                                                                        |
| 4       | nit        | The §14 hedge now reads "this version does not copy ..." and is an open question.                                                                                          |
| 5       | nit        | The surface patch edits and adds SURF items. "What it touches" names them and the `doorstop review` of SURF-048.                                                           |
| 6       | note       | Open question 2 is a dependency on #1437. It moved to the dependency paragraph.                                                                                            |

The scope was widened after the OD-11 audit of 2026-11-23. The audit found passages in
sections the first scope did not name. This record lists the sections added: §20, §33, §46, §66
and §69. The audit's findings in §14, §23, §48, §72 and §74 were already in scope. The surface
patch was rebased on `main` at `18f7935e`. The widened scope has no independent review yet.

The scope was widened again on 2026-11-23, after the second OD-11 audit. It adds Rule 10.3, Rule
10.5 and Rule 11.11 (rule texts), the held patch `p0146-rules.patch`, and the `TS8015` message
and its four test files in the implementing pull request. This widening needs review.

An independent review ran on 2026-11-23 on the widened scope. It had 2 blocking findings and 5
non-blocking ones. Blocking 1: Rule 11.11 claimed a refusal wording that the runtime does not emit.
The rule now claims no wording, and the proposal says the runtime refusals are not changed.
Blocking 2: the "later work" clause covered items with no fallback meant. The rule now splits the
list into two groups, and only the first has a fallback (OD-11). The orchestrator then moved the
depth-attachment item into the first group: WebGPU samples a read-only depth attachment, so "no
tier takes" was not supported, and #1470 words it "not supported yet". Non-blocking, all fixed: #1437
recorded as merged; the §48 sentence states the writer only; the §69 sentence about the host
passing a size is removed; Applicability, Review baseline and the impact estimate corrected; the
TS8015 note names `runtime.test.ts:2500` and `gl-compute.ts:923`.

The owner answered the conflict and open question 2 on 2026-11-23. This record states only that
fact. The answers add no independent review.

### Approval and plan record

- Decision. [decision, owner, 2026-11-23] The owner answered the conflict ("규칙 문구를 바꿈",
  reword the rule texts) and open question 2 ("draw의 storage texture만", only a storage texture
  in a draw). [decision, owner, 2026-11-24] The owner said "병합 승인 및 추천안으로" (merge
  approved, with the recommended answers) and "9시 30분 까지 자율 진행 승인" (autonomous progress
  approved until 09:30). The merge of #1441 with `status: accepted` is the agreement.
- Approved revision and scope. The revision of this file that #1441 merges. The scope is the
  front matter: Rules 10.3, 10.5 and 11.11, and surface §14, §20, §23, §33, §46, §48, §65, §66,
  §67, §69, §71, §72 and §74. No export, code, example or name.
- Independent review. It ran on 2026-11-23 (the record above). Its two blocking findings are
  fixed in the revision this pull request merges.
- Open at acceptance. Open question 1 (which of `atomicCompareExchangeWeak`,
  `workgroupUniformLoad` and `textureBarrier` the pass program gives a form) stays open. The
  §48 text states only what the GLSL writer does, so acceptance approves no claim about them.
- Plan. One implementing pull request, with `Change: 0146`:
  1. Apply the held surface patch and the held rules patch on the base branch.
  2. Run `bun run reqs:sync`.
  3. Change the `TS8015` text in `src/core/passes/gl-compute.ts` and its four test files.
     Decide the text at `src/core/gl-compute.ts:923` under Rule 10.5.
  4. Assert both halves on the `TS8015` source (Rule 12.7).
- Responsibilities. An agent writes the implementing pull request. A person runs
  `doorstop review` for each changed RULE and SURF item, and for the new SURF-020 and SURF-048
  (`reqs/README.md`). The owner merges the implementing pull request, because it changes
  normative text.
- Required validation. The four required checks of CI, `bun run docs:refs`, `bun run
docs:impact`, `bun scripts/changes.ts` and `python scripts/doorstop-check.py -C` after the
  person's review.

### Configuration and validation record

This record does not yet apply. Delivery will require the checks of the section "What it
touches", with the configuration and the result of each.

## What it owes downstream

- `typeshade.github.io`: search the English and Korean pages for "no atomics", "no workgroup
  memory", "no storage buffer", "no compute stage" and the old reason "has no workgroup memory
  for". Each page that repeats one follows the new text. The site's pin of the compiler moves
  after the implementing change.
- `vscode-typeshade`: search the skill and the hover text for the same phrases. Each one follows
  the new text.

Both obligations are expected work. Responsibilities are agreed at acceptance. Both are pending.

### A1. The rest of the rules and the surface, after the third OD-11 audit (2026-11-24, status: accepted)

- Status: accepted. [decision, owner, 2026-11-24] The owner said "머지승인" (merge approved) for
  pull request #1502. A1 is part of the approved text from that merge. The two questions below
  were not answered; they stay open, and the rows stand as written until the owner answers.
- Baseline: `main` at `998659c4` for the audit. [fact] The scan found line numbers on `main` at
  `e96fd47d`. The held patch applies to `main` at `de7f742d`.
- A1 adds no author-facing name, no diagnostic code, no export and no example. `exports`,
  `exports-removed`, `codes`, `examples` and `names` stay empty. [fact] No refusal changes. Only
  the reason of each one changes.

#### Why A1 exists

1. [fact] The third OD-11 audit (2026-11-24) read `docs/language-design.md`,
   `docs/use-typeshade-surface.md` and `reqs/` after the first two audits. It confirmed 13
   passages that this proposal does not declare.
2. [fact] Each passage gives an API fact as the reason a form does not run on a tier. The
   fact is "GLSL ES 3.00 has no X", "WebGL2 has no X" or "the CPU tier cannot".
3. [fact] OD-11 (`docs/owner-decisions.md`) says such a fact is never by itself the reason. Where
   no fallback exists yet, the text says "not supported yet", with the rule.
4. [fact] `scripts/changes.ts` refuses an edit of these passages under `Change: 0146`. The rules
   and the sections are not in the lists above.
5. [proposal] A1 declares the passages, the rule numbers and the section numbers, so that the
   implementing pull request can edit them.

#### What A1 declares

[fact] A true API fact may stay where it does not read as the reason that the tier cannot run
the program. The new text keeps each measured fact in a parenthesis or a "measured, for the
record" sentence. Term use: "the GLSL backend" for the GLSL ES 3.00 writer. "The WebGL2 tier",
"the WebGPU tier" and "the CPU tier" for tiers.

| #   | Place                                             | Current text (short)                                                                                                                                   | New wording, and the rule it cites                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Surface §2, the `VsIn` comment                    | "WGSL only — GLSL ES 3.00 has no `linear`"                                                                                                             | "not supported yet on the WebGL2 tier (Rule 10.3)".                                                                                                                                                                                                                |
| 2   | Surface §12, module constants                     | An array of arrays "is refused: the GLSL ES 3.00 spelling ... is not one ANGLE accepts"                                                                | "is not supported yet in a module constant (Rule 1.2). The GLSL backend does not flatten it." The flat `array<f32, 4>` advice stays.                                                                                                                               |
| 3   | Surface §18, array literals                       | An array of arrays is refused: "GLSL ES 3.00 has none"                                                                                                 | "is not supported yet, list or call (Rule 1.2). The GLSL backend has no lowering for it on the WebGL2 tier. The compiler refuses it on every tier, so that the two targets agree." The Tint and context measurement stays, marked as an API fact.                  |
| 4   | Surface §24, workgroup memory                     | "Workgroup memory has no GLSL ES 3.00 declaration, so `compile()` emits no GLSL"                                                                       | "A module that declares workgroup memory has no GLSL half yet (Rule 10.5)." The sentence on a compute entry that runs as passes now cites Rule 11.8 too.                                                                                                           |
| 5   | Surface §36, three capabilities                   | "WGSL-only ... GLSL ES 3.00 has none of the three"                                                                                                     | "Three capabilities, derived. Not supported yet on the WebGL2 tier (Rule 10.5)." The lowering of `texture_1d`, `texture_cube_array` and `textureGather` is deferred. The driver measurements stay as API facts.                                                    |
| 6   | Surface §37, multisampled read                    | "WGSL-only ... GLSL ES 3.00 has no `sampler2DMS`"                                                                                                      | "Not supported yet on the WebGL2 tier (Rule 10.5)." The lowering of a multisampled read is deferred. `sampler2DMS` stays in a parenthesis.                                                                                                                         |
| 7   | Surface §47, packed bytes, the heading            | "WGSL-only, and not an extension"; "GLSL ES 3.00 has no dot product of packed bytes"                                                                   | Heading "Not supported yet on the WebGL2 tier, and not an extension". "The GLSL backend has no lowering for the eight packed-byte builtins yet (Rule 10.3)." No rule defers the family by name (open question 1).                                                  |
| 8   | Surface §53, two rows and one sentence            | "**no form**"; "GLSL ES 3.00 has no second source"; 'The two "no form" rows'                                                                           | "**not supported yet on the WebGL2 tier (Rule 10.3)**" in both GLSL cells, and 'The two "not supported yet" rows'.                                                                                                                                                 |
| 9   | Surface §62, names                                | "A compute kernel has no GLSL ES 3.00 form — that is the one stage the language does not have"                                                         | "A compute entry has no GLSL vertex or fragment text of its own (Rule 10.3). On WebGL2 the program runtime runs it as its pass program (Rule 11.8, Rule 8.24, change 0054)."                                                                                       |
| 10  | Surface §77, the example                          | "WGSL-only on the gallery, since it is a compute entry over storage buffers"                                                                           | "Not drawn on the gallery, because the gallery draws a render pair (Rule 11.3). The entry runs on WebGL2 as its pass program (Rule 8.24, change 0054), with a subgroup of one lane (Rule 11.21). Its GLSL lowering is not supported yet (Rule 10.5)."              |
| 11  | Rule 8.24, text and rationale; mirror `RULE-0824` | "an entry that reaches a barrier needs a GPU tier"; "a barrier needs the interpreter's generators to run in lockstep, which the runtime does not ship" | "is not supported yet on the CPU tier through the call (Rule 8.24). It runs on WebGPU or WebGL2 (Rule 11.8)." The oracle's `dispatch` runs it on the CPU (§25). The rationale says "the call does not run a barrier on the CPU tier yet".                          |
| 12  | Rule 8.24, the CPU clause; mirror `RULE-0824`     | "An entry the CPU tier cannot run (one that reaches a texture, or a call only a GPU computes) needs a GPU tier"                                        | "An entry that reaches a texture, or a call the CPU tier does not compute yet, is not supported yet on the CPU tier (Rule 8.24). It needs a GPU tier." The refusal and its `TypeError` stay.                                                                       |
| 13  | Rule 12.3, rationale; mirror `RULE-1203`          | "a warning on a module GLSL could never serve is not news"                                                                                             | "a warning on a module with no vertex or fragment program for the GLSL emit to carry is not news: its compute entries run on WebGL2 as pass programs (Rule 10.3, Rule 11.8)."                                                                                      |
| 14  | Appendix C, status `n/a`                          | "The platform has no such capability on this target, or the capability has no meaning"                                                                 | "The capability has no meaning in a program ..., or a rule gives the portable form that replaces it on this target. A platform that lacks the capability is not a reason by itself (OD-11)." The row names the reason, and for a WebGL2 row the rule (Rule 11.16). |

[fact] The audit counted 13 passages. Rows 1 and 8 are one audit entry: the `linear`
interpolation form in §2 and in §53. So the 14 rows are the 13 entries.

[fact] `docs/language-design.md` Rule 8.20 says "no builtin only a GPU computes". The audit named
it only as a neighbour of row 12. A1 does not edit it. [proposal] A later audit reads it.

#### The lists A1 adds to the front matter

1. `rules:` gains `'8.24'` and `'12.3'`. Rules 10.3, 10.5 and 11.11 stay.
2. `surface:` gains 2, 12, 18, 24, 36, 37, 47, 53, 62 and 77. The sections 14, 20, 23, 33, 46, 48,
   65, 66, 67, 69, 71, 72 and 74 stay.
3. [fact] Appendix C is not a numbered section and not a `**Rule N.M.**` paragraph.
   `scripts/changes.ts` counts neither for row 14. [fact] The held patch gives the tool this
   result: it touches Rule 8.24, Rule 12.3 and the ten sections above, and no other rule or section.
4. [fact] `scripts/changes.ts` reads the declared lists from proposals that are `accepted` on
   the base branch. It has no state for an amendment in draft. The lists count from the merge of
   the A1 pull request.

#### The reqs items

1. [fact] `bun run reqs:sync` on the held patch changes two RULE items: RULE-0824 and RULE-1203.
2. [fact] It changes seven SURF items: SURF-012, SURF-018, SURF-024, SURF-025, SURF-053, SURF-062
   and SURF-077. SURF-025 gains a link to RULE-0824, because §25 now names Rule 8.24.
3. [fact] It adds three SURF items, because §36, §37 and §47 had none: SURF-036, SURF-037 and
   SURF-047. SURF-036 and SURF-037 link RULE-1005. SURF-047 links RULE-1003.
4. [fact] SURF-064 and SURF-067 link RULE-0824, and they become suspect links after RULE-0824 changes.
5. [procedure] In the implementing pull request:
   1. Run `bun run reqs:sync`.
   2. Ask a person to read each item and run `doorstop review` for RULE-0824 and RULE-1203, and
      for SURF-036, SURF-037 and SURF-047.
   3. Ask the person to run `doorstop clear` for the suspect links and the changed SURF items.
6. [fact] An agent does not run `doorstop review` or `doorstop clear`.

#### One line before and after

Surface §47, the first sentence, in the held patch.

Before:

```text
GLSL ES 3.00 has no dot product of packed bytes, no byte pack and no byte unpack, so a module
using one of the eight derives the `packed4x8Dot` capability and fails closed on that target
```

After:

```text
The GLSL backend has no lowering for the eight packed-byte builtins yet (Rule 10.3). ... So a module
that uses one derives the `packed4x8Dot` capability and fails closed on that target.
```

[fact] The refusal is the same. The module still fails closed before any emit.

#### Held patch and checks

1. [fact] The text edits are held in `p0146a1.patch`, made in a scratch worktree of `main` at
   `de7f742d`. It edits `docs/language-design.md`, `docs/use-typeshade-surface.md` and 12 files
   of `reqs/`. [fact] `bun run reqs:sync` ran on it, and `prettier --check` and `bun run
docs:refs` pass on it.
2. [fact] The prettier formatter realigned the Appendix C table in `docs/language-design.md`. The
   patch includes that alignment.
3. [fact] The scratch patch is not part of this pull request. The implementing pull request
   applies it.

#### Questions for the owner

1. §47 and Rule 10.5. No rule defers the eight packed-byte builtins by name. Rule 10.5 lists 1d,
   multisampled, depth read, gather, cube array, storage texture, read-write storage, atomics and
   barriers. Row 7 cites only Rule 10.3, the fail-closed shape.
   - [recommendation] Keep row 7 as it is. Open a separate proposal if the family should join
     Rule 10.5, because the first sentence of Rule 10.5 is the maintainer's.
   - [answer, owner] Not given. The owner approved the merge of A1 on 2026-11-24 without an
     answer. The question stays open.
2. Appendix C row 14. The old text made "the platform has no such capability" a sufficient reason
   for `n/a`. Some `n/a` rows in `src/core/coverage/` may give only that reason.
   - [recommendation] The implementing pull request lists each such row and its target. It
     changes no status in A1. The owner decides each status change in its own record.
   - [answer, owner] Not given. The question stays open.

[fact] Rows 1 to 13 need no question. Each says "not supported yet" with a rule, and none says a
form is impossible where a rule says otherwise. Open question 1 of this proposal is not changed.

#### Verification and audit record

- Not run: the four required checks of CI. A1 changes no code.
- Ran on 2026-11-24 on the held patch, on `main` at `de7f742d`: `bun run reqs:sync`,
  `prettier --check docs reqs`, `bun run docs:refs` (0 dead references) and `bun scripts/changes.ts`
  (it names the two rules and ten sections above).
- Document audit: the table above is compared with the held patch. The documents and the
  records match the delivered patch. No independent review of A1 has run yet.
- Deviations: none open.
