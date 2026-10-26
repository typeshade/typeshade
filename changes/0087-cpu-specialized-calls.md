---
id: '0087'
title: A host calls a function that takes a function on the CPU oracle by its written name, passing the module function it hands over
status: draft
rules:
  - '8.18'
surface:
  - 14
exports:
  - CpuModule
  - CpuCopy
  - FuncDecl
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The CPU oracle guide (English from AUTHORING.md, Korean content/guide/ko/the-cpu-oracle.md) stops saying that every function is in `fns` under its declared name and gains `copies` and `copyOf`. The API reference follows the pinned source. compiler-changes.md records 0087 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0087. Front-matter status is `draft`. The front matter is authoritative for identity and lifecycle state.                                                                                                                                                                                                                                                                               |
| Date and attribution          | Authored 2026-10-26, UTC. The date is the authorship date. It is not an approval date. Drafted by a Claude Code agent. Git authorship is not an approval signature.                                                                                                                                                                                                                              |
| Request source                | The repository owner, Seungup, asked in a Claude Code session on 2026-10-26 which compiler improvements the work on the downstream library TypePlot revealed. The owner then said "진행하세요" (proceed) to the drafting of proposals. This proposal covers the CPU oracle as a verification tool for downstream libraries. No GitHub issue is recorded. The request is not an acceptance.       |
| Applicability / effectivity   | The front end's copies of a function that takes a function (`src/compiler/ts/lower/function.ts`), the IR declaration `FuncDecl` (`src/core/ir/nodes.ts`), the CPU oracle (`src/core/oracle.ts`, `compileModule`) and its generated code (`src/core/cpu-codegen.ts`, `compileModuleJs`). WGSL, GLSL ES 3.00, the host face and the program runtime do not change. No release version is assigned. |
| Review baseline               | `main` at `e03ff7ea74bb8d6c7398d2310b2a53cc7e582227`, read on 2026-10-26. The evidence source TypePlot was read at its `main`, `32e15ed65a4fbd64ed87f699f74cefa08be601b1`, and its branch `check/parametric-coverage`, `2f9e8bff7c4bbaf6ddd4f6fb0becd6e0f45ac5b4`. TypePlot pins this compiler at `91c2fe31de045ebf0e5f2c333ac98b95cc460280`.                                                    |
| Review and revision authority | No PR is assigned yet. Git records the revisions of this file. The review and merge of the proposal-only pull request will record the decision. This document does not name the hash of the commit that contains it.                                                                                                                                                                             |

## What changes

A function that takes a function (Rule 8.18) exists in the IR only as its copies, one for each set
of functions that the module's calls hand it. The CPU oracle today exposes each copy under the
name the front end gave it, such as `projectedScalarDistance_sample`. It exposes no function under
the written name `projectedScalarDistance`. A host that wants to run the shared function on the
CPU must guess the generated name.

This proposal gives the CPU oracle a record of each copy and a lookup by the written name. The
proposal has four parts.

### 1. The IR records what each copy is

Each copy that the front end makes for Rule 8.18 carries a new optional `FuncDecl` field,
`copyOf`. It records three facts:

- `name`: the name the author wrote for the function that takes a function, as diagnostics show
  it (`projectedScalarDistance`, or `Swarm.each` for a method).
- `functions`: for each parameter of function type, in declaration order, the parameter's
  written name, its position in the written parameter list and the `FuncDecl` name of the module
  function handed over.
- `captures`: the names of the parameters that the copy takes ahead of its own for what the
  functions handed over capture (Rule 8.17). The list is empty when nothing is captured.

A function handed on through a parameter records the function that was handed over first. In
`apply(f, x)` that calls `inner(f, x)`, the copy `inner_sq` records `sq`, as the copy calls it
today. A function that is not a copy has no `copyOf`. The WGSL and GLSL ES 3.00 writers do not
read the field, so no emitted byte changes (Rule 11.1). The portable IR keeps the field, since it
is plain JSON.

### 2. `CpuModule.copies` lists the copies

`compileModule(m)` and `compileModuleJs(m)` return a `CpuModule` with a new read-only member,
`copies`. It is a list of `CpuCopy` records, one for each `FuncDecl` with a `copyOf`:

```ts
interface CpuCopy {
  /** The written name of the function that takes a function. */
  readonly name: string;
  /** The file that declares it, from the declaration's span; absent without a span. */
  readonly file?: string;
  /** The key of the copy in `fns`. The compiler chooses it; it is not a contract. */
  readonly fn: string;
  /** Each parameter of function type: its written name, its written position, and the key
   *  in `fns` of the module function handed over. */
  readonly functions: readonly {
    readonly param: string;
    readonly index: number;
    readonly fn: string;
  }[];
  /** The parameters the copy takes first, for what the functions handed over capture. */
  readonly captures: readonly string[];
}
```

The names in `fns` do not change. A host that reads `fns` by key keeps working.

### 3. `CpuModule.copyOf` returns the copy for the functions a host names

`copyOf(name, functions)` takes the written name and an object that maps each parameter of
function type to a function of the same module's `fns`. It returns the copy's function from
`fns`, the same function object. TypePlot's coverage check would read:

```ts
const cpu = compileModuleJs(result.module, { gpuStubs: true, precision: 'f32' });
const distance3D = cpu.copyOf('projectedScalarDistance', { sample: cpu.fns.sample });
distance3D(pixel, u, false); // the written call projectedScalarDistance(sample, pixel, u, false)
```

The returned function takes the value parameters of the written function, in their written
order, after the names in `captures`. The parameters of function type are left out, since the
copy is already the call with those functions. A host looks up a copy once and calls it many
times, so a call adds no lookup.

`copyOf` compares each function by identity with the entries of the module's own `fns`. It
throws an `Error` before anything runs, with a message that names the problem:

- No function of that written name takes a function. The message lists the written names in
  `copies`.
- The object misses a parameter of function type, or names a parameter that is not one. The
  message lists the parameters of function type.
- A value is not a function of this module's `fns`: a JavaScript function, or a function of
  another `CpuModule`. A copy calls a function of the module, so a host function has no copy.
- The module has no copy for that set of functions. The message lists each set the module's
  calls hand over, such as `{ sample: sample }`, and says that a copy exists only for a set of
  functions a call in the module hands over (Rule 8.18).
- Two copies match: two files declare a function of that written name, or a generic function
  has one copy for each set of type arguments. The message names the `fn` and `file` of each.
  The host chooses from `copies`.

### 4. Rule 8.18 says what a host may depend on

Rule 8.18 gains one sentence. The name of a copy is the compiler's choice, and the names in the
rule (`apply_sq`, `apply_run_f`) show its present form only. The CPU oracle lists each copy with
the written name and the functions handed over, and `copyOf` finds it (change 0087). Surface §14,
in "A function that takes a function", gains a paragraph and an example of `copyOf`.

### Not in this change

- The host face. A host file that imports a module still cannot call a function that takes a
  function (Rule 8.20). That call runs on a GPU tier first, and its callback would have to be an
  export of the same module. A separate proposal can take it.
- `CompileResult.eval`. It builds its own CPU module, so a host holds none of its functions to
  pass. It keeps taking the emitted name.
- A generic function's instances (Rule 8.9). `copyOf` finds a copy by functions, not by type
  arguments. A generic function that also takes a function is listed in `copies`. `copyOf`
  refuses it when the functions alone do not choose one copy.
- A helper that the linker renames because two files declare one name (`shared_helper`). Part
  "Why" records the observation. This change corrects the sentence that describes it, and it adds
  no lookup for it.
- A JavaScript function as a callback. The oracle evaluates the IR (Rule 1.3), and a JavaScript
  function is not IR.

## Why

### The evidence from TypePlot

TypePlot draws every plot through shared TypeShade functions that take the user's curve as a
parameter of function type. Its shared shader declares the types
`type ScalarCurve = (x: f32) => f32;` and `type SpaceCurve = (t: f32) => vec3;` (TypePlot
`shaders/plot.shade.ts` lines 64 and 65 at `32e15ed`). <!-- doc-refs: skip — a file in TypePlot, not in this tree -->
Examples are `scalarField(sample: ScalarCurve, …)` at line 231,
`projectedScalarDistance(sample: ScalarCurve, pixel: vec2, u: PlotUniforms, jumps: bool)` at line
635, `trajectoryDistance(trajectory: SpaceCurve, …)` at line 863 and
`pickTrajectory(trajectory: SpaceCurve, …)` at line 1444. The wrapper that TypePlot generates
declares `sample` and `trajectory` and hands them to these functions (TypePlot
`src/plot-source.ts` lines 125 to 144 at `32e15ed`). <!-- doc-refs: skip — a file in TypePlot, not in this tree -->

TypePlot's curve coverage check runs these functions on the CPU oracle and compares them with an
exact ground truth. TypePlot's `CLAUDE.md` (line 15 at `32e15ed`) records the owner's approval of
the check on 2026-10-26. The check finds each copy by a name prefix:

- At `32e15ed`, `specialized()` in TypePlot `scripts/coverage-check.ts` (lines 166 to 177) <!-- doc-refs: skip — a file in TypePlot, not in this tree -->
  keeps the keys of `cpu.fns` that start with `${name}_`. It throws when it does not find exactly
  one. Lines 368 to 373 use it for `projectedScalarDistance` and `scalarField`.
- On `check/parametric-coverage` at `2f9e8bf`, the same function is at line 249. Lines 472 to 478
  and 540 use it for `trajectoryDistance`, `scalarField`, `projectedScalarDistance` and
  `pickTrajectory`.
- The check casts the result of `compileModuleJs` to its own interface with
  `(...args: unknown[]) => unknown` functions (lines 21 to 25 and 194 to 201 at `32e15ed`).

The check works only while the generated names keep their present form. It cannot pass a
callback of its choosing: it gets the one copy that the plot program happens to make.

### Measurements on the review baseline

These observations were made on 2026-10-26 with Bun 1.4.4, on the worktree of this proposal at
`e03ff7e`, with `compile()` and `compileModuleJs()` from `src/index.ts`. They are observed
results, not proposals.

1. TypePlot's scalar plot program, built by `plotSource` of TypePlot `main` with the callback
   `return sin(3 * x);`, compiles with no error. A scratch copy of `plotSource` read the three
   shader files from disk in place of its `?source` imports. Its `fns` holds
   `projectedScalarDistance_sample`, `scalarField_sample`, `plot2D_sample`,
   `trajectoryDistance_trajectory` and `pickTrajectory_trajectory`. It holds no key
   `projectedScalarDistance` and no key `scalarField`.
2. In one file, `apply(sq, x)`, `apply(cube, x)` and `apply((y) => y + 3., x)` give the keys
   `apply_sq`, `apply_cube` and `apply_useBoth_f`. A copy of `inner(f, x)`, reached through
   `apply`'s parameter, is `inner_sq`. No key is `apply`.
3. Two files: a shared file declares `apply(f: Curve, x: f32)` and also an exported function
   that the author named `apply_sample`. The root file declares `sample` and calls
   `apply(sample, x)`. The written function keeps `apply_sample`, and the copy becomes
   `apply_sample_1`. The prefix `apply_` matches three keys: `apply_sample`, `apply_sample_1` and
   `apply_run_f`.
4. Two files that each declare a private `helper`: the shared file's one is `shared_helper` in
   `fns`.

The names come from three places in `src/compiler/ts/lower/function.ts`. `freshName` (line 840)
adds `_1`, `_2` to a name that the module already has. A copy of a function of the file joins its
instance name and the handed functions' names (lines 906 to 909). A copy of a local function
(line 1080) and of a method (line 1329) do the same. The linker in `src/compiler/ts/link.ts`
prefixes a file's stem to a colliding name (`fresh`, line 989). So a copy's name depends on every
other name in the program, and the prefix search is not reliable.

Measurement 4 also shows a difference between the documents and the code.
`AUTHORING.md#naming-the-functions-in-a-module` says "The CPU oracle calls each function by the
name the file gave it", and `AUTHORING.md#compiling-a-module-for-the-cpu` says that entry points
and helpers are in `fns` "under the names they were declared with". Neither holds for a copy or
for a renamed helper. The implementation corrects both sentences.

### Alternatives

- **Document the generated names as a contract.** Rule 8.18 already shows names such as
  `apply_sq`. A contract would have to fix the collision suffix, the linker's file stem and the
  names of local functions written in a call (`useBoth_f`). Measurement 3 shows that the suffix
  depends on names elsewhere in the program, so a host still could not compute the name from the
  call it wrote. The contract would also freeze the front end's naming. Rejected.
- **Install a dispatcher in `fns` under the written name**, so that
  `cpu.fns.projectedScalarDistance(cpu.fns.sample, pixel, u, false)` reads like the shader. This
  was the first design considered. `fns` is typed
  `Record<string, (...args: CpuValue[]) => CpuValue>`, and `CpuValue` holds no function
  (`src/core/cpu-runtime.ts`), so every caller's typing of `fns` would widen. A written name can
  also equal the key of another function in `fns`, as measurement 3 shows for `apply_sample`.
  Each call would repeat the lookup in a per-pixel loop. `copyOf` gives the same call with one
  lookup and no change to `fns`. Rejected; listed again under the unresolved decisions.
- **Pass the callback by its name as a string.** A string would be the generated name again for
  a function written in a call (`useBoth_f`). Identity with `fns` needs no name. Rejected.
- **Let a JavaScript function be the callback.** The oracle would then evaluate code that is not
  the IR and that the GPU never runs, outside `f32` rounding. That contradicts Rule 1.3, the
  reason a host compares with the oracle. Rejected.
- **A wrapper export in the downstream shader.** TypePlot could export
  `distance3D(pixel, u, jumps)` that calls `projectedScalarDistance(sample, pixel, u, jumps)`.
  This works on the baseline with no compiler change. It changes the shader under test, and each
  pair of callback and function needs one. It stays available to TypePlot until this change ships.
- **List the copies in `reflect(m)` instead of `CpuModule`.** The list names functions of the
  IR, so `reflect()` could carry it too. The problem is on the CPU side, and `copyOf` needs the
  module's own `fns`. This draft puts the list on `CpuModule` and leaves `reflect()` unchanged.

### Assumptions

- Every copy is made at one of the three places named above, so the front end can stamp
  `copyOf` at each. The implementation confirms this against `src/compiler/ts/higher-order.test.ts`.
- A pass that renames functions after the front end, for a production emit, does not run before
  `compileModule`. A pass that does rename must rename the names in `copyOf` too.

### Unresolved decisions

These decisions are open. Acceptance records each disposition.

1. **The names.** `FuncDecl.copyOf`, `CpuModule.copies`, `CpuModule.copyOf` and `CpuCopy` use the
   word "copy" of Rule 8.18. The alternatives are "specialization" and "instance". Rule 8.9 uses
   "instance" for a generic function.
2. **The form of the functions argument.** This draft takes an object keyed by parameter name.
   The alternative is the functions in the order of the parameters of function type.
3. **The dispatcher in `fns`.** Whether to install it beside `copyOf`, with the wider type.
4. **Captures.** This draft returns a copy with captures, and the host supplies the captured
   values first. The alternative refuses a copy with captures in `copyOf`.
5. **Methods and local functions.** This draft lists their copies and finds them by the name
   diagnostics show (`Swarm.each`). The alternative lists functions of a file or namespace only.
6. **The linker's renamed helpers.** Whether a later change records the written name of every
   function, which would also give `shared_helper` a lookup by `helper` and its file.
7. **vscode-typeshade.** Its skill references were not inspected in this session. Before
   acceptance, search them for `compileModule`, `CpuModule` and `fns`. Add a `downstream` entry
   if they describe the names.

## What it touches

- **Rule 8.18.** One sentence: the name of a copy is not a contract, and the CPU oracle lists
  each copy and finds it by the written name and the functions handed over (part 4). The rule's
  "Enforced by" gains the test that pins `copies` and `copyOf`.
- **Surface §14.** "A function that takes a function" gains the paragraph and example of part 4.
- **Export `FuncDecl`.** It gains the optional field `copyOf` (part 1).
- **Export `CpuModule`.** It gains `copies` and `copyOf` (parts 2 and 3). `compileModule` and
  `compileModuleJs` return it, so both gain them with no change to their own signatures.
- **Export `CpuCopy`.** The new record type of part 2.
- **No diagnostic code and no example.** The refusals of `copyOf` are runtime errors of a host
  call, not compiler diagnostics.

The documents that describe the old behavior also change: `AUTHORING.md#the-cpu-oracle` gains
`copies` and `copyOf`, and the two sentences that measurement 4 contradicts are corrected. The
row for `apply(sq, x)` in `docs/language-design.md` §7.2 and the rationale of Rule 8.20 ("a host
call names no such copy") are read again at implementation. Rule 8.20 is about the host face and
stays true. `CHANGELOG.md` records the delivered change.

### Draft impact estimate

Known technical work, by area:

- **Front end.** `src/compiler/ts/lower/function.ts`: stamp `copyOf` where each copy is made
  (the instance of a function of the file, the copy of a local function and the copy of a
  method). Each site already holds the written name (`writtenAs`, `shownOf`), the parameters of
  function type and the targets.
- **IR.** `src/core/ir/nodes.ts`: the optional field and its documentation. The IR builder and
  the EDSL do not set it.
- **Oracle.** `src/core/oracle.ts` and `src/core/cpu-codegen.ts`: build `copies` from
  `m.funcs`, and `copyOf` over the public `fns` table. One shared helper serves both, so the two
  paths cannot drift. Where a module has private variables, the public `fns` wrapper is the one
  returned, as today.
- **Public surface.** Export `CpuCopy` from `typeshade`, and bake `src/__api__/surface.md`.
- **Documents.** Rule 8.18, surface §14, `AUTHORING.md`, `CHANGELOG.md`, and the requirement
  records of Rule 8.18 under `reqs/` with their review workflow.

Compatibility: the change is additive. Existing keys of `fns`, emitted WGSL and GLSL, goldens and
the host face do not change. A host that builds an object typed as `CpuModule` itself fails to
type-check until it adds the two members. No such object exists in this repository outside the
two functions that return one.

Dependencies: none. No other proposal blocks this one.

Downstream effort: the site's CPU oracle guide in two languages. TypePlot, which is not a
downstream repository of `scripts/changes.ts`, can replace `specialized()` when its pin moves.

Duration and cost: unknown. No estimate is established.

Required functional validation, for the implementation:

1. Pin `copies` for each kind of copy: a function of the file, a function handed on through a
   parameter (`inner_sq` records `sq`), an arrow function written in a call, a local function, a
   method, a copy with captures and a generic function that takes a function.
2. Pin a name collision (`apply_sample_1`) and a two-file program in which `copyOf` finds the
   copy by the written name and the callback, with no use of the generated name.
3. Assert each refusal of `copyOf` with its message: an unknown name, a missing or extra
   parameter, a JavaScript function, a function of another `CpuModule`, a set with no copy and
   an ambiguous name.
4. Hold `compileModule` and `compileModuleJs` to the same `copies` and to `Object.is`-equal
   results through `copyOf`, as `src/core/cpu-codegen.test.ts` holds `fns`.
5. Reproduce the TypePlot pattern from this repository's own sources: a shared file whose
   functions take a curve, and a root file that hands over `sample`.
6. Show that the WGSL and GLSL goldens do not change, and that a portable IR round trip keeps
   `copyOf`.
7. Run the build, the unit suite, the compile gate and the API surface bake.

Required document validation: proposal shape, `docs:refs`, `docs:impact`, the IfChange check,
`reqs:sync` with the Doorstop check and the review of Rule 8.18, and the accepted-proposal scope
check (`changes:check`).

### Approval and plan record

This record does not yet apply. The proposal is a draft, and no PR is assigned. Acceptance will
require the actual decision of the owner or a Code Owner review, the merge of the proposal-only
pull request with `status: accepted`, the approved revision, the disposition of each unresolved
decision, and the assigned responsibilities. No approver, milestone, duration or cost is
recorded here.

### Configuration and validation record

This record does not yet apply. No implementation exists. Delivery will require the
implementation commits and pull requests that say `Change: 0087`, the delivered configuration
(commit and tool versions), the actor and the observed results of the functional and document
validation listed above. Any deviation from this text needs a recorded disposition.

The draft checks of this document are recorded on its pull request when they run. They validate
the document only, not a behavior.

## What it owes downstream

- **typeshade.github.io.** The English CPU oracle guide follows `AUTHORING.md#the-cpu-oracle`.
  The Korean page `content/guide/ko/the-cpu-oracle.md` says, at lines 14 to 18 of the site's <!-- doc-refs: skip — a file in typeshade.github.io -->
  `main` at `f1eb89c`, that every function is in `fns` under the name it was declared with. It
  must describe the copies, `copies` and `copyOf`. The API reference is generated from the
  pinned compiler's source. `compiler-changes.md` records 0087 when the pin moves. <!-- doc-refs: skip — a file in typeshade.github.io -->
- **vscode-typeshade, radiance, typenn, typecv.** No entry is declared. typecv at `5e1c95c` names
  neither `compileModule` nor `fns`. radiance and typenn were not inspected in this session.
  vscode-typeshade is unresolved decision 7.
- **TypePlot (evidence source, not a downstream repository).** When its pin carries this change,
  `specialized()` in its coverage check can become `cpu.copyOf(name, { sample: cpu.fns.sample })`
  or `{ trajectory: cpu.fns.trajectory }`. No delivery is claimed.

Downstream work, pins and validation remain pending. No downstream delivery is claimed by this
draft.
