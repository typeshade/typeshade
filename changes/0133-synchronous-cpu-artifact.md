---
id: '0133'
title: 'A host can emit a kernel function as a synchronous CPU function over its own typed arrays'
status: accepted
rules:
  - '11.8'
  - '11.24'
surface:
  - 65
exports:
  - emitCpuKernel
  - CpuKernelArtifact
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeaudio
    what: Replace the private graph code-generator adapter with `emitCpuKernel`, keep the shared reproduction fixtures, and record 0133 in compiler-changes.md when the pin passes the implementation.
  - repo: typeshade.github.io
    what: Document `emitCpuKernel` beside the asynchronous kernel call in the host-call reference, and retire the build-only CPU adapter of the TypeAudio studio once its engine adopts the artifact.
  - repo: vscode-typeshade
    what: Check completion and hover for `emitCpuKernel` and `CpuKernelArtifact`, and document the artifact apart from the asynchronous kernel call.
---

<!-- doc-refs: skip-file — this proposal names exports, a rule and a surface subsection that do not exist before its implementation -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0133`, `status: accepted`. The front matter is the lifecycle authority. `0133` was free on `origin/main` at the review baseline, in the changes directory and in the open pull requests.                                                                                                                               |
| Date and attribution          | First drafted 2026-11-06 UTC by Codex, on pull request #1037 (draft, not merged). Rewritten 2026-11-24 UTC by a Claude agent for the orchestrating session. The date records authorship. The decision date is in the approval record.                                                                                                   |
| Applicability / Effectivity   | `docs/language-design.md` Rules 11.7 and 11.8 and a new Rule 11.24; `docs/use-typeshade-surface.md` section 65; the package root exports; a new file of `src/core/cpu-codegen/`. The language and the shader vocabulary do not change. Release version unassigned (OD-6).                                                               |
| Review baseline               | `typeshade/typeshade` `origin/main` at `be2e83de6ba5cdaddc2b8f19a74f98061bad78fe` (the merge of PR #1545). The old draft's baseline was `324251dfe7755f78041eb44a1bfe85e4294e12dd`. TypeAudio at `575b42baa13ee666cc050b25da1e63720dfbf6e4` and Web at `769f3e7818329e1cc936048afb56e8724f34a9d3` are the evidence the old draft cited. |
| Review and revision authority | This revision supersedes pull request #1037. Pull request #1555 carries this revision. Git records revisions. Review and merge records are the decision evidence.                                                                                                                                                                       |

## What changes

A host program can turn one kernel function of a `"use typeshade"` source into a synchronous function.
The function runs on typed arrays that the caller owns and has already allocated.
It writes those arrays before it returns, and it returns nothing.

The change adds one function and one type to the package root.

- `emitCpuKernel(source, options)` compiles `source` as `compile()` does. It returns a `CpuKernelArtifact`.
- `options` is an inline object type, not an export. `entry` names the kernel function (Rule 8.22). `fileName`, `readDocument` and `resolveImport` mean what they mean in `CompileOptions`.
- `CpuKernelArtifact` has three read-only fields.
  - `code`: the text of an ES module. It has one static import, of `typeshade/runtime/internal`, and one export, the function, under the name of `entry`.
  - `name`: that export name.
  - `parameters`: the kernel's parameters in order. Each is `{ name, type }`, with `type` spelled as the shader spells it: `f32`, `i32`, `u32`, `bool`, `array<f32>`, `array<i32>` or `array<u32>`.

An array parameter is the caller's array, as Rule 8.23 says (change 0142). Its host value is the typed array of its element: `Float32Array`, `Int32Array` or `Uint32Array`.
The function reads and writes that typed array in place. The author writes no qualifier (OD-5).

The artifact computes what the CPU tier computes for a host call of the same function, bit for bit (Rule 11.7).
It differs in three ways.

- It is not a call. It joins no queue, and no microtask is needed before the arrays hold their values (Rule 11.8).
- It runs the kernel's loops in order, on one thread, as the CPU tier runs the function as written.
- It allocates nothing that the compiler can see in its closure.

The emitter refuses a kernel whose closure it cannot show to be free of these:

- an explicit heap allocation (an object, array or closure literal, a spread, `new`, a method that returns a new array);
- a Promise, `async`, `await` or a dynamic `import()`;
- `new Function` or `eval`;
- a host-array clone;
- a GPU resource.

The check covers the generated function and the builtin implementations it reaches.
A form that the check cannot classify is refused.
The refusal is a thrown `TypeShadeError` that names the kernel, the reason and the source location where one exists.
It carries an existing code: `SD0020` for a program that `compile()` refuses, `SD0030` for a kernel the artifact does not support yet.
No new code is added.

Each refusal of the second kind is "not supported yet", never "impossible" (OD-9, OD-10, OD-11).
These forms are refused at the first contract, and each is the compiler's work to admit later:

- `push` onto an array, and an array the kernel makes and returns (OD-10);
- a `Map` or a `Set`;
- a texture or a barrier (Rule 11.7 gives the CPU tier texture memory; the artifact does not use it yet);
- a vector, a matrix or a struct value, because the CPU tier holds one as a JavaScript array or object. The compiler may later rewrite such a value into scalars (OD-9), and the artifact then admits it with no change to its type;
- a result: the function returns `void`;
- a call to a user function whose generated code allocates. A call whose generated code the check shows to be free of allocation is admitted.

What an author writes does not change: no name, rule of the language, code, example or form (Rule 11.19 is untouched).
The host picks the entry by name when it emits. The source carries no marker for it (OD-3).

Rule 11.24 (new) states the artifact's contract: the inputs, the typed-array host values, the equality with the CPU tier, the refusals and the closure check.
Rule 11.8 gets one sentence: the artifact is not a kernel call and is outside the queue it describes.
Surface section 65 gets a subsection that shows the example below.

**Before and after, one host example.**
The kernel is the same in both. This is the source, `gain.shade.ts`:

```ts
"use typeshade";

export function gain(out: array<f32>, k: f32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = out[i] * k;
  }
}
```

Before: the host calls the kernel as a host call, which returns a Promise.
The Web Audio API copies the output when `process()` returns, so the samples can play one quantum late
(`typeaudio/docs/compiler-asks.md`, ask F).
The workaround imports `src/core/cpu-codegen.ts`, strips generated lines and scans the text.

```ts
import { gain } from "./gain.shade.ts";

class Gain extends AudioWorkletProcessor {
  process(_inputs: Float32Array[][], [[out]]: Float32Array[][]) {
    void gain(out, 0.5);
    return true;
  }
}
```

After: the host emits the artifact once, before playback.
The worklet imports the emitted module and calls an ordinary function.

```ts
import { emitCpuKernel } from "typeshade";

const artifact = emitCpuKernel(source, { entry: "gain", fileName: "gain.shade.ts" });
```

```ts
import { gain } from "./gain.artifact.js";

class Gain extends AudioWorkletProcessor {
  process(_inputs: Float32Array[][], [[out]]: Float32Array[][]) {
    gain(out, 0.5);
    return true;
  }
}
```

## Why

TypeAudio's ask F (`typeaudio/docs/compiler-asks.md`, "F. A worklet build of the CPU tier", with its "Web feedback update (2026-11-06 UTC)") records the need.
`process()` hands its output arrays back when it returns.
A kernel call is asynchronous from the start (Rule 8.21, surface section 65).
A browser that follows the Web Audio API copies the outputs before the microtask checkpoint, so a call that fills them later plays one quantum late.
That Chromium 153 reads the arrays after the checkpoint is an observation of one browser.
It is not a contract the engine can rest on (TypeAudio `docs/records/02-worklet-container.md`, observed 2026-11-02).

The same ask records the workaround.
TypeAudio's graph adapter imports the compiler's private generator, requests `f32`, rejects fallbacks, removes the generated `$.inout.values` publication, and scans the text for allocations.
Each downstream that does this depends on generator details and on a builtin allowlist that it audits by hand.
Pull request #961 of this repository (closed) is an earlier case of the same allocation in the CPU tier's generated code.

Alternatives, with the reason each is not chosen:

1. Make every kernel call synchronous. This breaks the queue contract of Rule 11.8 and every caller that awaits.
2. Keep the private generator import. Each downstream then owns compiler internals.
3. Compile inside the audio callback. The work does not fit a stable callback budget.
4. Add a synchronous variant to every generated host module. This adds an export to every shader module, and the Vite plugin cannot serve TypeAudio, whose graph code generator builds source at run time.
5. Mark a function in the source (a decorator or an attribute). This adds an author-facing construct for what the host can say when it emits (OD-3).

Chosen: one ahead-of-time emitter. It keeps every kernel call as it is, takes the source the host already holds, and gives the closure check one place to live.

### Decisions

Each decision has the recommended option, which this proposal adopts.
The check against `docs/owner-decisions.md` is in the last column.

| Id  | Question                                   | Adopted option                                                                                                                                                                                                                             | Entries                                                                  |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| D1  | What does the emitter take?                | The source text and `entry`, with the file options of `compile()`. Not an IR module.                                                                                                                                                       | OD-1 (the source is read by TypeShade's own compiler); Rule 11.19        |
| D2  | How many exports?                          | Two: `emitCpuKernel` and `CpuKernelArtifact`. `CpuKernelOptions` is an inline type, not an export.                                                                                                                                         | OD-3 (the smallest surface)                                              |
| D3  | Does the source mark the kernel?           | No. The host names the entry when it emits.                                                                                                                                                                                                | OD-3, OD-2 (no stage or attribute is added or changed)                   |
| D4  | What does a refusal look like?             | A thrown `TypeShadeError` with `SD0020` or `SD0030`. Each reason says "not supported yet" where that is true. No new code.                                                                                                                 | OD-9, OD-10, OD-11                                                       |
| D5  | Which forms does the first contract admit? | Whatever the closure check shows to be free of allocation: scalar and typed-array parameters, scalar locals, control flow, and calls it can clear. Widening is compiler work and needs no proposal while the two exports keep their shape. | OD-3, OD-9, OD-10                                                        |
| D6  | Who validates the buffers?                 | The host. The function does not check the kind or the length of a typed array. `parameters` gives the host what it needs. A store past the end is dropped, as on every tier (Rule 8.22).                                                   | OD-5 (the array is the caller's object); OD-6 (no compatibility promise) |
| D7  | What does the function return?             | `void`. A result is not supported yet. Adding one later reshapes `CpuKernelArtifact`, so it needs an amendment.                                                                                                                            | OD-9                                                                     |
| D8  | Where does the contract live in the rules? | A new Rule 11.24, and one sentence in Rule 11.8. Rule 8.21 and Rule 11.7 stay as they are.                                                                                                                                                 | OD-1 (no change to the language's rules)                                 |
| D9  | Does the artifact outlive its compiler?    | No. The `code` and the `typeshade/runtime/internal` of the same version are one deployment unit. Nothing promises a cross-version artifact.                                                                                                | OD-6                                                                     |
| D10 | Is a fuse plan an artifact?                | No. A chain is several artifacts that the host calls in order. A synchronous fuse plan is not in this proposal, and ask F keeps it open.                                                                                                   | OD-3                                                                     |

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md`.
It reverses none of them.

- OD-1. The source is a `"use typeshade"` file that the compiler reads. The artifact is a host API over it. No TypeScript tool decides anything here.
- OD-2. The proposal adds and changes no stage or attribute.
- OD-3. The host's need is met by the compiler's work. The author writes nothing new. The only exports are a function and its result type.
- OD-4. The before and after of the host example are in "What changes". The owner did not read them before this decision (see the approval record).
- OD-5. An array parameter is the caller's object, with no qualifier.
- OD-6. Nothing is released. The proposal promises no cross-version artifact and owes no warning release.
- OD-9. The artifact need not look like the source. The compiler may rewrite a form to admit it. A refusal says "not supported yet".
- OD-10. `push` and the array a kernel makes are refused as "not supported yet", not as impossible.
- OD-11. The artifact is the CPU tier's work. No refusal rests on what an API lacks. No tier is dropped.
- OD-7 and OD-8 do not apply: the proposal adds no number literal rule and no decorator.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule of the language, diagnostic code or surface form.
It is compiler work, as `changes/README.md` ("A need from a downstream repository") asks.
The compiler already generates the CPU code. What it lacks is a public way to emit that code for one kernel as a synchronous function.
Rule 11.24 is a rule about a host API, not about what an author can write.
No issue of this repository holds ask F. Pull request #1037 and this file are its record.

## What it touches

- Rule 11.24 (new): the artifact's contract, its equality with the CPU tier and its refusals.
- Rule 11.8: one sentence that says the artifact is not a kernel call and joins no queue.
- Surface section 65: a subsection for the artifact, with the example above.
- `emitCpuKernel` and `CpuKernelArtifact` at the package root: `src/__api__/surface.md` (`bun run bake:api-surface`) and their JSDoc, which the API reference and the editor show.
- The emitter, in a new file of `src/core/cpu-codegen/`. `src/core/cpu-codegen.ts` has 2081 lines and is in the file-size baseline, so it does not grow (`CLAUDE.md`, File size). A file of `src/` has no comment (`CLAUDE.md`, Comments).
- The closure check: a scan of the generated function and of the builtin implementations it reaches.
- `reqs/`: a Doorstop item for Rule 11.24 (`bun run reqs:sync`), which a person reads and reviews.
- `docs:impact` lists any other prose that the implementation makes false. The implementing pull request works through that list.

No example, diagnostic code, author-facing name or `exports-removed` entry changes.
The both-halves test rule (`CLAUDE.md`, A test reads both halves) does not apply: an author writes nothing new, and no `TS8xxx` code is added.

### Draft impact estimate

This is an additive host API. Existing kernel calls, generated host modules and emit goldens keep their behavior.
The emitter reuses `generateModuleJs` with `precision: 'f32'`, and separates direct-buffer publication from the host-call wrapper.
Cost recorded: the editor shows no diagnostic for a kernel that `compile()` accepts and the artifact refuses.
`emitCpuKernel` is the check. The editor's shader vocabulary does not change.
Cost recorded: a wrong typed-array kind or a short array gives wrong bits and no error (D6). The host validates first.
Cost recorded: the artifact imports a subpath named `typeshade/runtime/internal`. A consumer's bundler resolves it.
Duration and cost of the work: unknown. No estimate has a basis yet.

Required functional evidence, to be produced by the implementation:

1. Each admitted kernel gives, through the artifact, the bits that the CPU tier's host call gives, on inputs where `f32` and `f64` answers part (the pattern of `src/compiler/ts/host-face.test.ts`).
2. The caller's arrays hold their values when the function returns, with no Promise and no microtask.
3. A seeded state kept in a caller buffer survives across consecutive calls with the same bits as one long call.
4. A planted allocation, a Promise, a dynamic `import()`, `new Function`, a clone and a refused form each make the emitter throw, with the reason.
5. A packed tarball loads the emitted module under a strict content security policy and in an `AudioWorklet`. Chromium and one other engine are reported apart. A check that cannot run is reported as not run.
6. The existing emit goldens, the CPU and GPU regression gates and the host-call tests still pass.

Required document evidence: `scripts/changes.ts`, `bun run docs:refs`, `bun run docs:impact`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C`, the API-surface bake and the prettier check.
Timing reports show the compile and load cost apart from the cold and warm run. They do not establish a hard real-time bound.

### Independent review record

Not run. This revision has no review by an agent or a person that did not write it.
`changes/README.md` (Independent review) requires one before the owner decides.
The owner delegated the decision on 2026-11-24 (approval record below).
The orchestrating session records here whether it ran a review or waived it, with the findings and each answer.
Until then, this record is open.

### Approval and plan record

- Decision. [decision, owner, 2026-11-24] The owner said in the conversation, in Korean: "제대로 다시, 저의 의견이 사실 필요 없거든요" (do it properly again, my opinion is not actually needed). The owner thereby delegated the triage decisions to the orchestrating session. The session decided to accept the direction. Its ground: TypeAudio's rule says the compiler side decides how to meet a downstream need, and the compiler's work meets this one (OD-3).
- Decisions D1 to D10. The orchestrating session adopted the recommended option of each (table in "Why"). The owner did not read the options or the before and after example before this record. This is a deviation from OD-4 and from `changes/README.md`. Its disposition is open: the owner can read the example in "What changes" before saying "merge".
- Merge. `CLAUDE.md` (Merging) keeps a new proposal for the owner's word "merge". The owner's delegation of 2026-11-24 is recorded here. It is not that word.
- Pull request. #1555 carries this revision.
- Supersedes. Pull request #1037 (draft). It carried the earlier draft of 2026-11-06 with `emitCpuKernel`, `CpuKernelArtifact` and `CpuKernelOptions`, at baseline `324251df`. This revision drops `CpuKernelOptions` as an export (D2). It also drops the old list of refused forms in favour of the closure check (D5).
- Approved revision and scope. The revision of this file that the pull request merges. The scope is the front matter: Rules 11.8 and 11.24, surface section 65, and the two exports.
- Responsibilities and milestones. Not assigned. No schedule is agreed.
- Open at acceptance: the independent review (above); the owner's reading of the example; the implementation; the downstream work below.

### Configuration and validation record

This record does not yet apply. No implementation, no downstream adoption and no check of the artifact has run.
Delivery will require the accepted revision, the implementing commits and pull requests, the delivered configuration, the observed results of the checks listed above, and a record of each deviation.
Compiler status `implemented` will not establish downstream completion.

## What it owes downstream

- `typeaudio`. Replace the private graph code-generator adapter with `emitCpuKernel` only after the artifact passes the shared reproduction fixtures and a worklet check.
  Keep the section F row of `docs/compiler-asks.md`, and link this proposal there. Record 0133 in `compiler-changes.md` when the pin passes the implementation (`scripts/downstream-impact.ts` fails the pin pull request until it does).
  The engine keeps domain validation, parameter smoothing, graph state, scheduling and sample-rate policy. It also keeps the buffer validation of D6.
  Items 1 and 3 of ask F that this proposal does not meet stay open: no dynamic `import()` in the planner of `fuse()`, and a synchronous `fuse` plan.
- `typeshade.github.io` (the site, and Web). Document `emitCpuKernel` apart from the asynchronous kernel call, after its pin carries the implementation.
  The build-only synthesizer adapter needs its own equivalence check before it goes. Published pages describe the artifact only after the pinned compiler supports it.
- `vscode-typeshade`. Check completion and hover for the two exports against the package that carries them, and say that the editor shows no diagnostic for a kernel the artifact refuses. No shader-language completion or syntax changes.

All three obligations are pending. A compiler merge alone does not complete any of them.
