---
id: '0110'
title: A class is its struct and its functions in every place a struct or a function can be, and a class arm of the differential gate holds each exported class's methods to one result on every tier, on the host and on the oracle
status: implemented
rules:
  - '8.29'
surface:
  - 26
  - 65
  - 71
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The pages that copy surface §26 (classes), §65 (kernel functions) and §71 (fuse), in English and in Korean, gain the rule's paragraph and the two sentences on a method called on an element; `compiler-changes.md` records 0110 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's class and kernel-function references say that a changing method called on an element is a write to that element, as an `@inout` argument is, and that a class is one thing on every tier and on the host; `compiler-changes.md` records 0110 when the pin moves.
  - repo: typenn
    what: Nothing must change. A module written as a class gains the guarantee the arm holds; `compiler-changes.md` records 0110 when the pin moves.
  - repo: typecv
    what: Nothing must change. The same guarantee as for typenn; `compiler-changes.md` records 0110 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a rule, an arm, a journey, tests and text its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0110, `status: implemented`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC); see Approval and plan record. Pull request #883 implements it, the host leg of the arm included (Configuration and validation record).                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                   |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, asked what it takes to advance the compiler's class support so that it is consistent ("고도화하려면 어떻게 되어야하나요? 일관되어야 의미 있어보이는데"). The agent proposed the rule sentence below and a class arm of the differential gate. The owner approved the drafting ("승인"). Proposals 0108 (pull request #871) and 0109 (pull request #872) are the related drafts of the same session. No GitHub issue is recorded.                                                                                        |
| Applicability / effectivity   | `docs/language-design.md` (a new rule in §8, numbered per D1), `reqs/` (its item), `docs/use-typeshade-surface.md` §26, §65 and §71, `scripts/gpu-differential.ts` and a new `scripts/class-arm.ts`, a new `journeys/class-twins/`, `src/core/fuse-plan.test.ts` and `src/compiler/ts/kernel-loops.test.ts` (D4), and the CI job `compile gate (Tint + WebGL2)`, which runs `bun run gate:differential`. The lowering, the proof, the planner, the host face and reflection do not change by this proposal; what the arm finds in them is fixed under its rule. No release version is assigned. |
| Review baseline               | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review and revision authority | Pull request [#873](https://github.com/typeshade/typeshade/pull/873) (branch `claude/proposal-0110-class-consistency`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                         |

## What changes

**Before.** The compiler lowers a class to a struct and to functions (§26): `new P(…)` is
`P_new(…)`, and nothing is allocated; a method is a function over its object, `P_len(self_, …)`;
a method that changes its object takes it by reference, as an `@inout` parameter, by the model of
change 0040 (`src/compiler/ts/lower/class-methods.ts`); a generic class is its instances
(Rule 8.9); an abstract class is a base and never a value. The kernel proof counts an `@inout`
argument as a write at the argument's place (`writesIn` in `src/core/passes/parallel-loop.ts`,
rules R3 and R5 of §65), so a changing method called on `voices[v]` is a write to `voices[v]`.

No rule states that a class means one thing in every place it can stand, and no gate holds it.
`scripts/gpu-differential.ts` has a GLSL arm, a chain arm, a compute arm and a common-module
arm, and none runs a class's methods across the tiers. The planner's facts (§71) are tested on
loops written inline, not through methods. The host face declares a class a type (proposal 0109
changes that). Reflection reports no method and no constructor.

**After.**

1. **The rule.** `docs/language-design.md` §8 gains a rule, numbered 8.29 at the baseline (D1):

   > **Rule 8.29.** A class is its struct and its functions. Every rule that applies to a struct
   > applies to the class's fields, and every rule that applies to a function applies to its
   > constructor, its methods, its accessors and its static functions, in every place a struct or
   > a function can be: a binding, a local, a workgroup variable, a kernel function's array, a
   > `Resident`, the host face, the CPU tier, the oracle, the host view, reflection and a package.
   > A method that changes its object (Rule 8.10) is, at a call, a write to the object it is
   > called on, as an `@inout` argument is (Rule 8.25), for the proof of Rule 8.22 and for the
   > facts of Rule 11.13. Where a place admits a function under a condition (Rule 8.20), it admits
   > a method under the same condition and refuses it with the same reason. Construction is a
   > call of the constructor wherever it happens.

   The rule states no symmetry it cannot keep. A method that reaches a binding, a workgroup
   variable or a builtin only a GPU computes has no host call, and the host view says so with the
   reason (Rule 8.20). A host call of a method runs on the CPU tier and never dispatches (0109).
   A read of a `Resident` is asynchronous (Rule 11.8). The rule's Rationale, Derives from and
   Enforced by lines name §26, change 0040, proposal 0109, the class arm and the tests of D4.

2. **The class arm.** `scripts/class-arm.ts`, run by `scripts/gpu-differential.ts` under
   `bun run gate:differential`, which the CI job `compile gate (Tint + WebGL2)` runs today. No
   new job and no change to the ruleset (D3).
   - **Corpus (D2).** Every exported class of `examples/*.shade.ts` and of a dedicated
     `journeys/class-twins/` module that has at least one admissible method. A method is
     admissible under Rule 8.20's conditions: not generic, takes no function, has a host value for
     each parameter and for its result, and reaches no binding, no workgroup variable and no
     builtin only a GPU computes. A class with no admissible method is listed as skipped, with the
     reason.
   - **Twin modules.** For each class `C`, the arm writes a `"use typeshade"` module that imports
     `C` (§68) and declares, for each admissible method `m`: an entry `twin_m`, `@compute([64])`,
     over `storage<array<C>, "read_write">`, an array of the method's arguments and an output
     array; and a kernel function `loop_m(out, xs: array<C>, args)` whose loop does the same per
     element (§65). The arguments and the constructor's arguments are drawn by `typeshade/random`
     from the element's index, so every leg sees the same inputs. The entry builds its element
     with `new C(…)` from drawn arguments when `C` declares a constructor the arm can call, and
     from the initializers otherwise, calls `m` on it, and stores the result and the element back.
   - **Legs.** (a) The entry on WebGPU, on WebGL2 where its tier runs it (change 0054), and on
     the CPU tier (change 0092). (b) The kernel function on WebGPU, on WebGL2 where it lowers,
     and on the CPU tier. (c) The host class of proposal 0109 on the CPU tier, `new C(…)` and
     `m(…)`, once 0109 is implemented; until then the arm prints `host leg: not available
(change 0109)` and holds the other legs. (d) The oracle, `compileModule` in `f32` mode, the
     reference (Rule 11.1).
   - **The claim.** For every element, the result of `m` and every field of the element after
     the call are the same bits on every leg as on the oracle, except where the determinism
     report (§38) lists a row for an operation the method reaches, where the distance is within
     32 ULP or 2^-11, as the common-module arm holds (§72). The arm prints the largest distance it
     saw, per leg.
   - **The instrument.** One case runs wrong on purpose per run, one element given the next
     element's arguments on one leg, and the comparison must report it. A gate that cannot fail
     cannot pass.
   - **Refusals.** A leg a tier refuses (GLSL ES 3.00 cannot spell `.length` or an atomic) is
     named, and the method is held on the tiers that run it, as the common-module arm does (D5).

3. **The facts through a method (D4).** A test holds that a chain of kernel functions whose loops
   call methods on elements plans as the same chain written inline: the same `groups` and the
   same `dispatches`, or the same `why` where a fact fails. One case per form, in
   `src/core/fuse-plan.test.ts` for the facts and in `src/compiler/ts/kernel-loops.test.ts` for
   the proof: a changing method on an element, a reading method, a static function, and a method
   that calls a helper with an `@inout` argument.

4. **The surface.** §26 gains a paragraph that states the rule in the author's terms, with the
   gate that holds it. §65 gains one sentence: a changing method called on an element of an array
   parameter is a write to that element at that index, as an `@inout` argument is, so
   `voices[v].tick()` is a write at `v`, which R3 admits. §71 gains one sentence: the facts read a
   method call's accesses through the object it is called on, so a chain of methods fuses as the
   same chain written inline.

**Not in this proposal.** No change to the lowering, the proof, the planner, the host face or
reflection is proposed. A place the arm finds where a class differs from its struct and its
functions is a bug, fixed in an implementing pull request of this proposal with `Change: 0110`,
or a stated exception added to the rule by an amendment with the owner's decision. Reflection of
methods and constructors, metadata decorators on classes and fields, generic classes in the host
view and a host file's import of a package's shader module are later proposals, each judged
against this rule.

## Why

**The problem.** A library whose units are classes rests on one assumption: a class written once
means the same thing wherever it stands, on the GPU, on the CPU tier, on the host and on the
oracle. The compiler's core already lowers it that way, but nothing says so, and nothing holds
it. The host face treats a class as a type, which 0109 corrects. The kernel proof treats a
changing method's object as an `@inout` argument by construction, and no test pins it. The
planner's facts are tested inline only. Reflection reports no method. A later change to any
boundary layer can treat a method unlike a function with no check turning red. The audio library
the owner is designing, and the classes TypeNN and TypeCV may adopt, need the guarantee and not
the coincidence.

**Evidence** at the review baseline. `src/compiler/ts/lower/class-methods.ts`: "A method that
changes its object takes it BY REFERENCE: `mode: 'inout'`", and the `self_` parameter with that
mode. `src/core/passes/parallel-loop.ts`, `writesIn`: "Every write in `body`: assignments,
`inout` arguments, atomics and texture stores", and the loop that pushes a write for each `inout`
argument of a call. `scripts/gpu-differential.ts`: the GLSL, chain, compute and common-module
arms, each with one case run wrong on purpose. `src/core/reflect.ts`: no method and no
constructor. Rule 8.20: "an exported struct is a type of it".

**The request.** The owner asked on 2026-11-02 how the class support should be advanced, and said
that it is meaningful only if it is consistent. The agent's answer was that the core is
consistent and the boundary layers are not, and that the advance is one rule and one gate.

**Alternatives.**

- State it in the documentation only. A rule with no check drifts, which is the failure
  `changes/README.md` records as the origin of this process.
- Pin it in unit tests, feature by feature. Scattered, with no single sentence a later proposal
  is judged against.
- A rule and an arm. Chosen. It is the shape Rule 11.20 already has for the common modules: a
  sentence in the rules, and "the differential gate holds that".

**Assumptions.** The arm can write a twin module from a class's members as the host face reads
them (`hostFace`, `src/compiler/ts/host-face.ts`), and compile it through `compile()` and the
module the Vite plugin generates, as the common-module arm compiles its calls. The entry leg on
the CPU tier runs through the passes of change 0092. The host leg depends on 0109.

**Decisions, resolved at acceptance** (Approval and plan record).

- **D1.** The number and the section: Rule 8.29 in §8 (the draft), since the rule is about
  functions and the places they stand, or a rule in §6 beside Rule 6.9. The open proposals 0106
  and 0107 claim no number in §8 at the baseline.
- **D2.** The corpus: every admissible exported class of `examples/*.shade.ts` and
  `journeys/class-twins/` (the draft), or the journey alone. The draft takes both: the examples
  for breadth, the journey for a bank of units with state, the shape an audio library needs.
- **D3.** Where the arm runs: under `gate:differential` in the existing `compile gate (Tint +
WebGL2)` job (the draft), or a job of its own. A new job is a required check the ruleset
  names, which is the owner's to change. The draft adds none.
- **D4.** Fusion through methods: a fact the rule requires and the test holds (the draft), or an
  aspiration recorded as open. The draft requires it: when a chain written inline fuses, the
  same chain written as methods fuses, or the report says which fact fails in the author's
  words.
- **D5.** The WebGL2 legs: required where the twin has a WebGL2 tier and skipped with the reason
  where GLSL ES 3.00 cannot spell what the method reaches (the draft), as the common-module arm
  does.

## What it touches

- **Rule 8.29.** New: the sentence in item 1, with its Rationale, Derives from and Enforced by
  lines.
- **surface 26.** The paragraph of item 4, in the author's terms, with the gate.
- **surface 65.** The sentence that a changing method called on an element is a write at that
  index, as an `@inout` argument is.
- **surface 71.** The sentence that the facts read a method call's accesses through its object.
- **exports, codes, examples: none.** The arm is a script under `gate:differential`, the journey
  is a journey, and no diagnostic is added.

**Implementation.** `scripts/class-arm.ts` (new) and the switch and summary lines in
`scripts/gpu-differential.ts`; `journeys/class-twins/` (new); the two tests of D4; the rule and
its `reqs/` item, synced and reviewed; the three sections.

**Validation.** The arm green on WebGPU and on WebGL2 in headless Chromium, with the wrong case
reported, on the examples' classes and the journey; the two tests of D4; `bun run docs:refs`,
`bun run docs:impact`, `bun run reqs:sync` and `python scripts/doorstop-check.py -C` for the
rule and the three sections.

### Draft impact estimate

Known work: the twin generator and the arm, with the common-module arm as the template; the
journey; the two tests; the rule and the three sections. Compatibility: no program changes; a
place the arm finds inconsistent becomes a fix under this proposal. Dependencies: 0109 for the
host leg, none for the other three. CI time: the arm adds runs to `gate:differential`, not
measured. Downstream: the two documentation repositories update their copies of the three
sections. Duration and cost: unknown, no basis for an estimate.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("승인", approve), in answer to the agent's report that pull request #873 was green and
ready for review and that D1 to D5 would be accepted as drafted by that word. D1 to D5 are
accepted as drafted: Rule 8.29 in §8; the corpus is every admissible exported class of
`examples/*.shade.ts` and `journeys/class-twins/`; the arm runs under `gate:differential` in the
existing `compile gate (Tint + WebGL2)` job; fusion through methods is a fact the rule requires
and the test holds; the WebGL2 legs are required where the twin has a WebGL2 tier and skipped
with the reason otherwise. The approved revision is the one this record is part of. The merge of
[#873](https://github.com/typeshade/typeshade/pull/873) with `status: accepted` records the
decision.

Responsibilities: an agent of this repository implements the rule, the arm, the journey, the two
tests and the three sections in pull requests whose commits say `Change: 0110`. The host leg of
the arm follows the implementation of proposal 0109. No milestone date is assigned. No duration
or cost estimate is established.

### Configuration and validation record

Accepted revision: the file as merged in #873 (`main` at
`9afe73abdf7e39597fd1aad951e39b28a7dae425`). Implementation: pull request
[#883](https://github.com/typeshade/typeshade/pull/883), branch `claude/0110-class-consistency`,
commits with `Change: 0110`, by a Claude Code agent: `dedb532` (the journey), `7a42103` (the class
arm), `be95734` (the tests of D4), `e5f52da` (Rule 8.29), `de9f81f` (the three sections),
`72850ed`, `9b6d3af`, `bb51ae9` and `e1f1f47` (merges of `main` at `48b315a`, `391f8dc`, `4072eba`
and `7f4e916`), `0c85280` (the first form of this record), `399b84b` (the merge of `main` at
`9dbc298`, which carries change 0109), `d05f26c` (the host leg) and the commit of this entry.
Delivered configuration:

- `docs/language-design.md`: Rule 8.29 in §8 (D1), the sentence of item 1 with its Rationale,
  Derives from and Enforced by lines. `reqs/` synced: RULE-0829 is new, and SURF-026, SURF-065
  and SURF-071 link it; each was read and reviewed with `doorstop review`, and cleared with
  `doorstop clear` when the host leg changed the rule's Enforced by line.
- `scripts/class-arm.ts` (new), run by `scripts/gpu-differential.ts` under the arm name `class`,
  in the default arm list of `bun run gate:differential`, which the CI job
  `compile gate (Tint + WebGL2)` runs (D3), with the host leg (c) on the host class of
  change 0109. `AGENTS.md` and `src/AGENTS.md` describe it.
- `journeys/class-twins/` (new), `units.shade.ts` and `journey.mjs`: the corpus module of D2 and a
  journey of its own. `journeys/README.md` names it.
- `src/core/fuse-plan.test.ts` (new) for the facts and `src/compiler/ts/kernel-loops.test.ts` for
  the proof (D4).
- `docs/use-typeshade-surface.md`: the paragraph of item 4 in §26, and its sentences in §65 and
  §71.

The corpus the arm found. The 101 files of `examples/*.shade.ts` export no class (78 of them
declare classes, and none exports one), so the corpus is the seven exported classes of
`journeys/class-twins/units.shade.ts`. The arm still reads the examples, so a class an example
exports later joins the corpus. Six classes and 13 members are held: `OnePole` (`tick`, `peek`,
`set cutoff`, `coefficient`), `GainPole` (`process`, and `tick`, `peek` and `set cutoff` from its
base), `Phasor` (`tick`, `get saw`), `Envelope` (`step`, built from its initializers), `Counter`
(`skip`, which hands a field to an `@inout` parameter) and `Pan` (`apply`, a vector result). Two
are skipped with the host face's reason: `Wavetable`, whose one member reaches the binding
`table`, and `Phasor.shaped`, which takes a function.

Functional validation, local, 2026-11-02 (UTC), Bun 1.4.4, Node 22.23.4, TypeScript 5.6.3,
Vitest 5.0.5, Chromium headless shell 1243 (Chrome for Testing 153.0.8010.12) on SwiftShader:

- `TYPESHADE_DIFF_ARMS=class bun scripts/gpu-differential.ts` on `d05f26c`, with the host leg:
  failures 0 on 9 legs, 67,200 values. `host/cpu` holds the 13 members on the host class of
  change 0109 at 0 ULP and 0 absolute over 8,400 values, and the host class refuses
  `Phasor.shaped` and `Wavetable.next` with the reason a function has. 88 member legs are held
  bit for bit and 16 under the envelope of the `fract` row. The instrument is still reported at
  element 0. The host leg can fail: run once with each numeric constructor argument of the host
  class made one greater, it reported 11 of the 13 members on `host/cpu` and exited 1; the two
  it did not report take no such argument, and the file was then restored.
- `TYPESHADE_DIFF_ARMS=class bun scripts/gpu-differential.ts` on `7a42103`, `9b6d3af`, `bb51ae9`
  and `e1f1f47`, before the host leg: failures 0, the same counts on each. Every leg that ran is bit for bit: the largest
  distance is 0 ULP and 0 absolute on `entry/webgpu`, `entry/webgl2`, `entry/cpu`, `entry/oracle`,
  `kernel/webgpu`, `kernel/cpu` and `kernel/oracle`, 8,400 values each. 77 member legs are held
  bit for bit and 14 under the envelope of the `fract` row (the two members of `Phasor`), at
  distance 0. `kernel/webgl2` compares nothing: Rule 11.8 refuses each twin kernel function there,
  with the face's reason (`loop 1 writes more than one array, and WebGL2 draws one`; for the two
  setters, `loop 1 writes "xs", whose element is not one f32, i32 or u32`). The instrument:
  `OnePole.tick` on `entry/webgpu` with element 0 given element 1's arguments, reported at
  element 0. The arm printed `host leg: not available (change 0109)`.
- `bun run gate:differential`, every arm, on `72850ed`, `9b6d3af` and `d05f26c`: failures 0 on
  each arm (kernel, chain, GLSL, compute, common modules and classes).
- `bunx vitest run src/compiler/ts/kernel-loops.test.ts src/core/fuse-plan.test.ts` on `9b6d3af`,
  `bb51ae9`, `e1f1f47` and `d05f26c`: 66 tests pass, 19 of them new. No form showed the facts or the proof
  treating a member unlike the inline form; the one difference is the order the proof lists a
  statement's stores in, which the planner does not read.
- `bun run test` on `72850ed`: 11,691 tests pass and 9 fail, in `src/affected-tests.test.ts` and
  `src/doc-test-selection.test.ts`. The same 9 fail on `main` at `391f8dc` in the same container,
  run apart: their fixture runs Vitest in a temporary git repository, and this container does not
  give the selection they expect. On `9b6d3af`: 11,723 pass and 10 fail, the same 9 and one
  90-second timeout in `src/compiler/ts/host-draw.test.ts` (a `tsc` type check) while the
  differential gate ran beside the suite; that file passes alone, 19 tests. On `bb51ae9`: 11,737
  pass and 9 fail, the same 9.
- `bun run gate:journeys` on `72850ed`, `9b6d3af` and `bb51ae9`: 34 journeys, 123 runs, every
  check passed; `class-twins` gives the reference's values exactly on WebGPU and WebGL2.
- `bun run build`, `bun run lint` and `bun run format:check` on `72850ed`, `9b6d3af`, `bb51ae9`,
  `e1f1f47` and `d05f26c`: pass. `bun run check` is not run: `package.json` has no such script.

Document validation on `d05f26c`: `bun run docs:refs` (0 dead references in 1,413 files);
`bun scripts/doc-impact.ts --base origin/main --check` (every review item read);
`bun scripts/ifchange.ts --base origin/main`; `bun scripts/changes.ts --base origin/main` (the
change touches Rule 8.29 and surface §26, §65 and §71, as declared); `bun run reqs:sync -- --check`
and `python scripts/doorstop-check.py -C` and `-C -e -F`, Doorstop 3.2, clean.

Deviations:

- The legs. Besides legs (a), (b) and (d), the arm runs the twin's entry and kernel function on
  the oracle itself and holds them to the same reference. Closed by this record: two more places
  of Rule 8.29 are held, and nothing else changes.
- The members. The arm holds getters, setters and static functions besides methods, as Rule 8.29
  names them, and every member through the constructor. Closed by this record.
- The inputs and the two callers. The arguments are drawn on the host by `typeshade/random`'s
  `hash32` and `uniform` from the element's index, and every leg is given the same array. The
  entry calls the member on a local, and the kernel function calls it on the element of its array
  (`xs[i].m(…)`), the form of §65's new sentence. Closed by this record, the reading of item 2.
- Appendix B. The host half of Rule 8.29 was not enforced while an exported class was a type of
  the host face, with no method; Appendix B recorded it, and §26 said so. Closed on 2026-11-02
  (UTC) by `d05f26c`, after change 0109 reached `main` (`9dbc298`, #890): the host leg (c) holds
  each member on the host class, as the class arm's run on `d05f26c` above shows, and the row of
  Appendix B and the sentence of §26 are removed.
- The journey's wavetable voice keeps its position inside the table. Its first form,
  `table[this.at % arrayLength(table)]`, failed the WebGL2 leg of the CI check
  `user journeys (packed tarball, WebGPU)` on `dedb532`. The cause, reproduced here: the pass
  program of change 0054 spells an `arrayLength` inside a storage index `_phx_len_table` and never
  declares it, since `Words.place` in `src/core/passes/memory-words.ts` lowers the index with
  `lowerExpr(e.idx)` and drops the set of lengths. An entry with no class fails the same way
  (`out[g] = xs[(g + 3) % arrayLength(xs)]`). Filed as issue #900 and fixed by pull request #939
  (squash commit `b3bf0af8`, 2026-11-02). The journey keeps its form. Closed.
- `TS8070` names a class's static function and static field by their emitted names
  (`"Voice_tally"`, `"Voice_count"`), where Rule 8.22 asks for the author's names: `Wording.name`
  in `src/compiler/ts/kernel-loops.ts` maps only the names of the kernel function's own scope. The
  member form and the inline form agree, so D4's clause does not cover it, and a namespace's
  functions share it. Filed as issue #908 and fixed by pull request #953 (squash commit
  `a659ae36`, 2026-11-02): the sentence names the author's names for a static function, a
  static field, a method, a constructor and a namespace's functions. Closed.

Pending: none in this repository.

## What it owes downstream

- **typeshade.github.io.** The pages that copy §26, §65 and §71, in English and in Korean, gain
  the rule's paragraph and the two sentences; `compiler-changes.md` records 0110 when the pin
  moves.
- **vscode-typeshade.** The skill's class and kernel-function references say that a changing
  method called on an element is a write to that element, as an `@inout` argument is, and that a
  class is one thing on every tier and on the host; `compiler-changes.md` records 0110 when the
  pin moves.
- **typenn, typecv.** Nothing must change. A module written as a class gains the guarantee the
  arm holds; `compiler-changes.md` records 0110 in each when its pin moves.
