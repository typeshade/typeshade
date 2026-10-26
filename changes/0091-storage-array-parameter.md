---
id: '0091'
title: A helper function takes a storage binding by reference, as a parameter of the binding's own storage type, so one helper serves every binding its callers pass
status: draft
rules:
  - '8.8'
  - '8.22'
  - '8.23'
  - '8.26'
surface:
  - 20
  - 65
  - 70
  - 76
exports: []
exports-removed: []
codes: []
examples:
  - storage-parameters
downstream:
  - repo: typeshade.github.io
    what: Document the storage parameter on the function and storage-binding pages and its new surface section, update the fixtures that quote the TS8020 remedy, show the storage-parameters example, in both locales, and record 0091 when the pin moves.
  - repo: vscode-typeshade
    what: Replace the skill's statement that a helper reads a binding only by its name, update the fixtures that quote the TS8020 remedy, and record 0091 when the pin moves.
  - repo: typecv
    what: Decide in phase 10 step C1 of docs/library-structure.md whether the one bundle-adjustment module uses storage parameters or the shared-module form that compiles today, and record 0091 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names a rule, a surface section, an example and tests that a later implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0091`, `status: draft`. The front matter is the identity and lifecycle authority. Renumbered from `0088` on 2026-10-26, UTC: PR #765 claimed `0088` before this draft's file was written, and PR #766 claims `0089`.                                                                                                                                                                                                                                                                                            |
| Date and attribution          | Written on 2026-10-26, UTC. The date records authorship, not an approval. A Claude Code sub-agent (Claude Opus 5.5) drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. TypeCV's owner decided on 2026-10-26 to open TypeCV's request C1 as a TypeShade proposal (TypeCV `docs/library-structure.md`, section 7, item 7). Sources: that document and `docs/audits/2026-10-26-kernel-style.md` at TypeCV `48e2711`, this tree, and the probes in "Why". No approver is recorded. |
| Applicability / Effectivity   | The front end's parameter lowering (`src/compiler/ts/lower/function.ts`, `src/compiler/ts/lower/runtime-array.ts`, the per-call copies of `src/compiler/ts/lower/function-types.ts` and `function-args.ts`), the host face (`src/compiler/ts/host-face.ts`) and the language service. The IR, the three backends and the runtime are not expected to change. No release version is assigned.                                                                                                                                     |
| Review baseline               | `main` at `e03ff7ea74bb8d6c7398d2310b2a53cc7e582227`. TypeCV evidence: `main` at `48e2711dbea8649c74e26baf2ca364951ab5a1dc`, whose compiler pin is `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc` (`package.json` line 60).                                                                                                                                                                                                                                                                                                          |
| Review and revision authority | [PR #767](https://github.com/typeshade/typeshade/pull/767), a proposal-only draft opened on 2026-10-26, UTC. The first revision, commit `d377342`, preceded the pull request. Git records the revisions. The review and the merge of PR #767 record the decision.                                                                                                                                                                                                                                                                |

## What changes

**Proposal.** A helper function may take a storage binding as a parameter. The parameter's type
is the binding's own type, `storage<T, A>`. The caller passes the binding by its name, and the
helper reads and writes it in place. The compiler makes one copy of the helper for each binding
its calls pass, as it makes one copy of a function for each function its calls pass (Rule 8.18).
Each target then reads an ordinary function that names the binding. No pointer type reaches a
target.

### Before and after

The proposed source below is refused today with `TS8020` in the compiler and in the editor.

```ts
"use typeshade";

declare const scene: storage<array<f32>, "read_write">;
declare const trial: storage<array<f32>, "read_write">;
declare const cost: storage<array<f32>, "read_write">;

// Reads either binding. A read-only parameter takes a read_write binding too.
function poseSum(from: storage<array<f32>>, camera: u32): f32 {
  let s = 0.;
  for (let j: u32 = 0; j < 12; j++) {
    s += from[camera * 12 + j];
  }
  return s;
}

@compute([64])
export function compare(@builtin("global_invocation_id") gid: vec3u) {
  cost[gid.x] = poseSum(trial, gid.x) - poseSum(scene, gid.x);
}
```

Today the helper must name its binding, or choose one with a flag at run time:

```ts
function poseSum(camera: u32, candidate: bool): f32 {
  let s = 0.;
  for (let j: u32 = 0; j < 12; j++) {
    s += candidate ? trial[camera * 12 + j] : scene[camera * 12 + j];
  }
  return s;
}
```

With the proposal, the WGSL holds two functions, one for each binding the calls pass. Each
reads its binding by name, as the second form reads it today:

```wgsl
fn poseSum_trial(camera: u32) -> f32 { /* … trial[camera * 12u + j] … */ }
fn poseSum_scene(camera: u32) -> f32 { /* … scene[camera * 12u + j] … */ }
```

The names follow the spelling plan (Rule 3.2). Diagnostics, the debugger and the authored IR
keep the name `poseSum`.

### The rule (proposed Rule 8.26)

- **Where.** A function declared at the top of a file or of a namespace may take one, and so may
  a generic function, which is then compiled once for each set of type arguments and bindings.
  A local function may capture one (Rule 8.17). An entry, a kernel function (Rule 8.22), a
  method, a constructor and an accessor may not.
- **The argument.** A storage binding declared with the same `T`, by its name. A `'read'`
  parameter takes a `'read'` or a `'read_write'` binding. A `'read_write'` parameter takes a
  `'read_write'` binding only. A storage parameter of the calling function is passed on as
  itself.
- **By reference.** The body reads the elements and `.length`. It writes the elements when `A`
  is `'read_write'`. It cannot assign the parameter whole, copy it into a `let`, return it or
  store it, since the binding itself cannot be copied (surface §20). A `const` that names it is
  the parameter, as a `const` that names a binding is the binding (surface §20).
- **One copy per binding tuple.** The function is compiled once for each tuple of bindings its
  calls pass. Two storage parameters may take one binding: both names then read and write that
  one binding, in program order, on every target.
- **The host.** Such a function has no host value for the parameter, so a host cannot call it
  (Rule 8.20). The host view declares it `never`, with the reason.
- **Kernel functions do not change.** Their `array<T>` parameters stay the host's arrays (Rules
  8.22 and 8.23). A function whose array parameter is written `storage<T, A>` is a helper, not a
  kernel function, even when it is exported.

### What each target writes

| The source          | WGSL                       | GLSL ES 3.00 (the WebGL2 pass program, change 0054) | CPU (oracle, generated code, debugger) |
| ------------------- | -------------------------- | --------------------------------------------------- | -------------------------------------- |
| the parameter       | none; one copy per binding | none; the same copy                                 | none; the same copy                    |
| `from[i]` in a copy | `scene[i]`                 | the pass program's read of `scene`                  | the bound array's element              |
| `from.length`       | `arrayLength(&scene)`      | the bound length                                    | the bound array's length               |
| the call            | `poseSum_scene(c)`         | `poseSum_scene(c)`                                  | `poseSum_scene(c)`                     |

**Inference.** A copy is the helper's body with the binding in place of the parameter. So a
program that read the binding by name before gives the same bits on every tier. The tests below
must establish it.

### Refusals

No diagnostic code is added. Each refusal uses the code of the same mistake today, with a new
text that names the parameter and the remedy (Rule 12.5).

| What the source writes                                                                     | Code                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| a local array, a value parameter, an element or a uniform as the argument                  | `TS8073`                                                     |
| a `'read'` binding passed to a `'read_write'` parameter                                    | `TS8073`                                                     |
| a binding whose `T` differs from the parameter's                                           | `TS8003`                                                     |
| `c ? scene : trial`, a binding chosen at run time                                          | `TS8099`, as Rule 8.18 refuses a function chosen at run time |
| a storage parameter on an entry, a kernel function, a method, a constructor or an accessor | `TS8020`                                                     |
| a whole assignment, a `let` copy or a return of the parameter                              | the code the same use of the binding has today (surface §20) |

### Exclusions

- No pointer type on any target. Decision D1 keeps the WGSL pointer form open.
- No field of a storage struct as the argument (`b.xs`). Decision D2.
- No kernel function's array passed to a storage parameter. Decision D3.
- No `uniform<T>` or workgroup parameter by reference. A uniform struct passes by value today,
  and a workgroup place passes by `@inout` (Rule 8.25).
- No slice of a binding. Change 0040 lists slices as a separate proposal.
- No module parameterized by constants ("Alternatives considered").

## Why

### TypeCV's evidence

**Fact** (TypeCV `docs/library-structure.md` at `48e2711`, sections 1 and 6, row C1). TypeCV's
two GPU bundle-adjustment routes repeat "896 of 1,125 kernel lines" and "at least 538 of 1,043
host lines". Row C1 names the limit: "`TS8020`: a storage array cannot be a helper's parameter, so
a helper that reads a binding belongs to the file that declares it". It asks for "a helper that
takes a storage array by reference, or a module parameterized by constants that a file
instantiates twice". Its estimate is about 900 lines. This proposal concerns the kernel lines
only; the host lines are TypeCV's phase 6 and need no compiler change.

**Fact** (TypeCV `docs/audits/2026-10-26-kernel-style.md` at `48e2711`, section 6, rank 1, and
probe P4). `bundle.shade.ts` and `joint-focal.shade.ts` differ in record sizes: 18 against 21
cross words, `6C` against `6C + 1` vectors, and `array<f64, 6>` against `<f64, 7>` tiles. Probe
P4, a plain helper that takes `array<f32>`, gave `TS8020`.

**Fact** (the same structure document, section 5, phase 10, and section 4, rule 6). TypeCV
schedules "C1: one BA module, after R03", with the gate "every BA digest and WebGPU BA test
unchanged". No sparse-scene kernel may change before R03.

### What the compiler refuses today, and why

**Fact** (`main` at `e03ff7e`; each probe read both halves on the same source, as
`src/compiler/ts/reference-parameters.test.ts` does).

| Probe                                                                    | `compile()` and the language service                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| a plain helper takes `array<f32>`; an entry passes a binding             | `TS8020` in both halves                                                                            |
| the same helper, exported                                                | `TS8099` in both: "is a kernel function, which host code calls … so no function can call it"       |
| a helper takes `@inout xs: array<f32>`                                   | `TS8020` in both                                                                                   |
| a helper takes `xs: storage<array<f32>, "read_write">`                   | `TS8020` in both                                                                                   |
| a helper takes `@inout x: f32`; an entry passes `data[i]` and `other[i]` | accepted in both; WGSL `fn bump(x: ptr<storage, f32, read_write>)`, called as `bump(&data[gid.x])` |
| a helper reads `data` or `other` by name, chosen by a `bool`             | accepted in both                                                                                   |

- **Fact.** `refuseRuntimeArraySignature` in `src/compiler/ts/lower/runtime-array.ts` gives the
  refusal: "Give it a size, array<f32, N>, or read the binding by its name inside the function
  instead." Its file comment gives the reason: Tint refuses a runtime-sized array outside the
  storage address space ("runtime-sized arrays can only be used in the <storage> address space").
- **Fact** (Rule 8.22). An exported function that takes `array<T>` is a kernel function, and no
  function may call a kernel function (Rule 8.6). So a shared module cannot export a helper that
  takes `array<T>`.
- **Fact** (Rule 8.25 and surface §70). A reference to a storage element is a WGSL pointer,
  `ptr<storage, T, read_write>`. It relies on WGSL's `unrestricted_pointer_parameters`. The
  coverage note in `src/core/coverage/wgsl.ts` records that Tint (Chromium headless shell 1194,
  2026-10-12) compiles a storage pointer parameter with and without
  `requires unrestricted_pointer_parameters;`. GLSL ES 3.00 spells the reference as an `inout`
  parameter, which copies in and out, and the CPU paths copy in and store back.
- **Inference.** A whole runtime-sized array does not fit that model. GLSL ES 3.00 has no array
  of unknown length to copy into. On the CPU, a copy in and a store back would copy the whole
  bound array at each call. A copy of the function per binding needs no copy of the array.
- **Fact** (change 0040, "What a later proposal may add"). Change 0040 lists, as a separate
  proposal, "Read-only references: a parameter that reads a large value or a runtime-sized array
  in place, without a copy". Its fourth amendment removed the qualifier `@in`, since TypeScript
  does not parse `@in`. This proposal is that item, for storage bindings, with the access mode
  carried by the type instead of a qualifier.

### What TypeCV can do today

**Fact** (probe, `main` at `e03ff7e`). Two entry files imported one shared module that declares a
storage binding and a workgroup tile. The shared module's generic helper took each file's own
control struct by value (Rule 8.9) and synchronized with `workgroupBarrier()`. The two files
declared different `BundleControl` classes. `compile()` gave no diagnostic for either file. Each
WGSL held a copy `sumRows_BundleControl`, and each host view carried the entry. The WGSL was not
given to Tint.

**Fact** (difflib over TypeCV `48e2711`). `bundle.shade.ts` shares 955 raw lines and 945
non-blank lines verbatim with `joint-focal.shade.ts`. Of the 945, 668 are in entry bodies, 206 in
helper bodies and 71 in declarations. 93 read `control.`, and 285 name one of the 13 storage
bindings both files declare. Those 13 declarations are identical in both files. Only
`joint-focal.shade.ts` declares `focal`, `schur` and `schurCross`. One shared line uses
`cameraTile`, the tile whose element type differs. Three helpers of `bundle.shade.ts` and four of
`joint-focal.shade.ts` take a `candidate: bool` that chooses between `trial` and `scene`.

**Inference.** TypeCV can remove most of the kernel duplication today, with no compiler change
and no layout change. A shared module declares the 13 common bindings and the identical tiles,
and holds the shared helpers and entry bodies. Each helper takes the file's control struct
through a generic parameter. Each file keeps its own control struct, its own extra bindings and a
thin wrapper per entry. The estimate is about 700 lines: the 945 shared lines once, less about
230 wrapper lines (29 entries with shared lines, two files, about 4 lines each). The basis is the
counts above and an assumed wrapper size.

**Inference.** This proposal adds what that form cannot give: a helper over whichever binding
its caller names, without a runtime flag; route-specific bindings passed into shared code; and a
shared module or a shader package (change 0024) whose helpers do not fix the binding names of
their users. For TypeCV's two routes the extra saving is tens of lines (the seven `candidate`
helpers). Its main value is general.

### Alternatives considered

1. **No compiler change, the shared-module form above.** About 700 TypeCV lines, measured to
   compile. It fixes one set of binding names for the shared code, and it keeps runtime flags
   where a helper serves two bindings. A shader package cannot offer a helper over its user's
   storage. Kept as TypeCV's option; not a reason to reject the proposal.
2. **TypeCV's stated alternative: a shared bindings module with one control struct.** About 900
   lines (TypeCV's estimate), and entries re-exported with no wrapper. **Inference.** It changes
   the fixed route's uniform layout, for example by giving its `BundleControl` the field
   `cgIterations`, so its host packing changes. Not the TypeShade answer; it is TypeCV's to
   choose.
3. **A module parameterized by constants, instantiated twice.** It could also absorb the lines
   that differ only by constants (18 against 21, 6 against 7). It needs a new semantics: several
   instances of one file in one program, where Rule 3.9 gives each file one scope. It also needs
   a spelling: ECMAScript's import attribute grammar takes a string literal as each value.
   **Inference.** It is the largest compiler change of the three: the linker, the instance
   names, the diagnostics per instance and the editor's reading of an instantiated module.
   Deferred to its own proposal.
4. **`@inout xs: array<T>`, Rule 8.25's qualifier on a whole array.** Rule 8.25 refuses a
   read-only binding as the argument, and TypeScript cannot parse `@in`. **Inference.** Its GLSL
   and CPU model copies the place, which an array of unknown length does not allow. Rejected.
5. **A plain `xs: array<T>` on a helper, with `TS8020` lifted.** An exported helper of that
   shape is a kernel function (Rule 8.22). A shared module could not export it. Rejected.
6. **The WGSL pointer form**, `ptr<storage, T, A>`, with copies on GLSL ES 3.00 only. One WGSL
   function serves every binding, as Rule 8.25's element references do. It relies on
   `unrestricted_pointer_parameters`, which this draft did not measure on other WebGPU
   implementations. It brings WGSL's alias refusal (`TS8074`) when two parameters take one
   written binding. It needs a Tint measurement of `arrayLength` through a pointer parameter
   (Rule 13.3). And WGSL and GLSL would take two paths. Decision D1; not this draft's choice.

### Unresolved decisions

- **D1. The WGSL form.** Copies on every target (this draft), or pointers on WGSL. The copies
  need no language extension and no alias rule. Pointers keep one function in the WGSL.
- **D2. A field of a storage struct as the argument** (`b.xs`, which `arrayLength` accepts,
  surface §20). Accepted in the first version, or later.
- **D3. Kernel functions.** Whether a kernel function's loop may pass its array to a storage
  parameter. The proof (Rule 8.22, R3 to R5) would then read the callee's accesses as the loop's,
  and the field analysis of change 0082 would follow them.
- **D4. Size.** Whether the compiler warns when one helper has more copies than a set number. No
  measurement of code size exists.

## What it touches

- **Rule 8.8.** Its exceptions to "passed by value" gain a parameter typed `storage<T, A>`
  (Rule 8.26).
- **Rule 8.22.** A parameter written `storage<T, A>` is no array that makes a kernel function.
  A storage parameter on a kernel function is refused.
- **Rule 8.23.** Its "Enforced by" says `parseParams` refuses an unsized array parameter "on any
  other" function (`TS8020`); that sentence gains the exception of Rule 8.26.
- **Rule 8.26 (new).** The storage parameter: where it may appear, its argument, by reference,
  one copy per binding tuple, the host view and the refusals.
- **Surface §20.** "An unsized array lives in a storage binding alone" gains the storage
  parameter, and the `TS8020` remedy names it.
- **Surface §65.** "Any other function that takes an array with no size is refused (TS8020, §20)"
  gains the exception.
- **Surface §70.** The refusal of a read-only binding as an `@inout` argument names the storage
  parameter as the way to pass a whole binding.
- **Surface §76 (new).** "A storage binding as a parameter": the rule, the per-target table, the
  refusals and a shared-module example.
- **Example `storage-parameters` (new).** A helper over two bindings and one passed on, compiled
  through the compile gate.
- **Code.** `src/compiler/ts/lower/function.ts` (`parseParams`), `src/compiler/ts/lower/runtime-array.ts`
  (the refusal and its remedy), the copies on the model of `src/compiler/ts/lower/function-types.ts`
  and `src/compiler/ts/lower/function-args.ts`, `src/compiler/ts/host-face.ts` (the `never`
  reason) and the language service (no `TS8020` for the spelling; hover shows `storage<T, A>`).
- **Tests.** Both halves on the same source, on the shape of
  `src/language-service/ambient-parity.test.ts`: diagnostics with code and text, hover, the WGSL,
  every CPU path (the oracle at both precisions, the generated code, the optimized module and the
  debugger) and the WebGL2 pass program. A packed journey runs the example on WebGPU, WebGL2 and
  the CPU against an independent JavaScript reference.
- **Not touched.** No export, no diagnostic code, no IR node, no backend and no runtime file.

### Draft impact estimate

**Known.** The change is additive: every program that compiles today compiles to the same text.
The copies are ordinary functions, so no backend change is expected. No dependency is added.

**Estimate.** The compiler work is front-end work of the size of Rule 8.18's per-function
copies, which `src/compiler/ts/lower/function-types.ts` (137 lines) and `function-args.ts` (283
lines) implement, plus the editor's parity and the tests. Duration and cost are unestimated.
TypeCV's saving: about 700 kernel lines with or without this change (the shared-module form), and
tens of lines more with it. **Inference**, on the basis given in "Why".

**Compatibility.** Additive. The remedy text of `TS8020` changes, which downstream fixtures may
quote.

**Decisions before acceptance:** D1 and D2. D3 and D4 may stay open.

### Approval and plan record

This record does not yet apply. Acceptance requires the actual decision and its pull-request
reference, the approved revision of this file, the decisions D1 and D2, the final rule text of
Rule 8.26 and the final surface declarations, and any assignment of responsibilities and
milestones. This draft assigns no responsibility, milestone, duration or cost.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with
`Change: 0091`; the tests above, green; `bun run gate:compile` with the new example;
`bun run gate:journeys` with the new journey; emit goldens unchanged for every program that does
not use the spelling; `bun run build`, `bun run lint`, `bun run format:check` and `bun run test`;
`bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C -e -F`, with Rule 8.26 reviewed (`doorstop review`) after a
person reads it. Downstream pins are tracked apart.

## What it owes downstream

This draft did not search the site or the editor repository. The work below is expected work; a
search of each repository for `TS8020`, for its remedy text and for "by its name" fixes the
list.

**typeshade.github.io.** The pages that describe helper parameters and storage bindings gain the
storage parameter and the new surface section, in English and Korean. Diagnostic fixtures that
quote the `TS8020` remedy change with it. The gallery shows the `storage-parameters` example.

**vscode-typeshade.** The skill's language reference gains the storage parameter wherever it
says that a helper reads a binding only by its name. Fixtures that quote the `TS8020` remedy
change. Hover shows the parameter as `storage<T, A>`.

**typecv.** Expected work, decided by TypeCV:

- Phase 10 step C1 (after R03, TypeCV section 4 rule 6) may take the shared-module form, which
  compiles today, or wait for this change.
- **Inference.** Under either form, the gate of C1 stays as TypeCV wrote it: every BA digest and
  WebGPU BA test unchanged.
- Record 0091 in `compiler-changes.md` when the pin moves.
