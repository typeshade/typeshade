# The compiler owns performance: a design note

This note records a design discussion between the owner and an agent, held on 2026-10-29 to
2026-11-02. It is not a rule and not an approved design. Each part that changes a rule, a public
export or the surface needs its own proposal in `changes/` (`changes/README.md`). The note keeps
facts, inferences, proposals and open decisions apart, and labels each one.

Baseline: `main` at `1cb928fd`. The WGSL citations are to the WGSL working draft at
`https://gpuweb.github.io/gpuweb/wgsl/`, read on 2026-10-30.

## 1. The principle

**Owner's direction.** Making compiled code fast is the compiler's job. A program written in
TypeShade must become faster when the compiler improves, with no change to its source.

**Owner's direction.** Device differences belong to the compiler and the device runtime. An author
must not have to know what the device supports. An `enable` that an author writes is against this.

**Fact.** Changes 0103, 0104 and 0105 follow the principle. Each removes copies of a struct or an
array in the emitted WGSL, and no source changes (Rule 8.28). Issues #122 (inlining class methods), #841, #847 and #850
(optimizations of the emitted code) work in the same direction.

**Fact.** Rule 1.5 states half of the principle: the representation of a form ECMAScript defines
is the compiler's, and it may change between versions while every observable answer stays the one
Rule 1.1 defines. `docs/computing-platform-plan.md` (Compiler owns semantics) and `docs/roadmap.md`
(The DX bar: item 15 makes the same call faster without changing it) say the same in their scope.

**Fact.** No rule states the other half: that a later compiler never makes a program slower.

**Proposal.** State the missing half as a design rule, beside Rule 1.5:

> Performance is the compiler's responsibility. No optimization requires the author to change the
> source. The same source gives the same values with a later compiler, and runs as fast or faster.

## 2. Knowing the performance

**Fact.** Over the 148 WGSL emit goldens, change 0105 moved these counts (a text search): pointer
parameters 93 to 223, methods that take their object by value 72 to 6, calls of an `_into` copy 30
to 69. These are counts of emitted text, not times.

**Fact.** `bun run gate:perf` (`docs/performance.md`) measures a fixed corpus on a WebGPU device.
The numbers that decide anything come from a hardware adapter (`docs/hardware-notes.md`).

**Inference.** The copies change 0105 removed matter most for a large struct, for an array read at
a dynamic index and for a whole storage element. A small struct gains little, since a driver
usually inlines the call and splits the struct into registers.

**Inference.** Reading a `read_write` storage element in place can cost more than one copy when
the same field is read many times, since a driver cannot always prove that no alias writes it.

**Proposal.** "As fast or faster" needs a regression gate on a hardware adapter. Which runner has
one is a repository setting, and the owner decides it.

## 3. The order of an `f32` sum

**Owner's direction.** The language, not the hardware, fixes the order in which an `f32` sum is
combined. Three meanings are wanted:

1. a fixed pairwise tree, defined as the language's meaning;
2. a strict sum, exact whatever the order;
3. a fast sum, in any order, with a difference allowed, which the author opts in to.

**Fact.** Meaning 1 exists. Rule 8.22 combines a kernel function's reduction in the tree order on
every tier: blocks of 256, at stride 128, then 64, down to 1, slot `t` becomes
`slot[t] op slot[t + s]` (`src/core/kernel-tree.ts`). The tree is interleaved: it pairs slots that
are `s` apart, not neighbours.

**Fact.** WGSL does not fix the bits of an `f32` operation:

- A correctly rounded result may be rounded up or down. WGSL specifies no rounding mode (§15.7.4).
- An implementation may reassociate operations (§15.7.5).
- The inputs and outputs of the operations in §15.7.4 may be flushed to zero. An implementation
  may ignore the sign of a zero (§15.7.2).
- An implementation may assume that no overflow, infinity or NaN is present (the Finite Math
  Assumption, §15.7.2).

**Inference.** So the bit equality of the GPU and the CPU oracle for an `f32` reduction is an
observed result, which a gate checks on the devices it runs on. The WGSL text cannot guarantee it.
Only integer arithmetic has bits that WGSL fixes.

**Fact.** Issue #852 asks for a numerical contract that would authorize an `f32` rewrite that
changes rounding, and states that the contract is a design rule that needs a proposal. The `fast`
mode below is one such contract.

**Proposal.** Four modes of an `f32` reduction:

| Mode           | What the language fixes                                             | What the guarantee rests on                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ordered`      | the fixed tree; each step is one `f32` operation                    | The order is the language's. Each step rounds as WGSL allows. Bit equality across tiers is an observed result, recorded in the determinism report.                                                   |
| `exact`        | the exact sum, rounded once                                         | An integer accumulator. The `f32` bits are read as `u32` from memory, so no flush applies, and the exponent bits decide an infinity or a NaN. WGSL fixes these bits. The order does not change them. |
| `reproducible` | one result whatever the order, not always the correctly rounded one | A binned sum, of the ReproBLAS kind. It costs less than `exact`.                                                                                                                                     |
| `fast`         | any order, within a bound                                           | The compiler records a bound such as `n·u·Σ\|x\|` in the determinism report, beside the `order` row it has today.                                                                                    |

**Proposal.** The CPU oracle computes the `exact` sum. Each other mode is then checked against one
reference: bit equality for `ordered`, the bound for `fast`.

**Proposal.** Replace the interleaved tree with an adjacent pairwise tree, where slot `t` becomes
`slot[2t] op slot[2t + 1]`. It keeps the iteration order, so it is correct for every associative
operator, also one that does not commute (a quaternion product, a matrix product, a segment
combine). It takes the steps inside a subgroup first and needs barriers only after them. Its error
bound grows as `log₂ n`. The cost: the bits of an `f32` sum change, so this changes the language.

## 4. Pattern recognition that breaks easily

**Owner's direction.** Three remedies:

1. normalize the IR before matching;
2. give the author a means to state the intent;
3. make a performance contract a compile error.

**Fact.** A kernel loop that the proof refuses runs on the CPU, and the compiler warns with
`TS8070 KERNEL_LOOP_ON_CPU`, in the author's names (Rule 8.22). The program stays correct either
way. It is a performance signal, not yet a contract: the warning does not stop the build.

**Fact.** A name an author can write comes from WGSL, from ECMAScript as TypeScript spells it, or
from the extension table in `docs/language-design.md` §9 (Rule 2.1).

**Proposal.** Recognize the algebraic structure, not the syntax: a value carried across the
iterations of a loop and combined by an associative operator. `s += x`, `s = x + s`, two adds in
one iteration, an add inside a helper and `if (c) s += x` (a `select` of the identity) are one
structure.

**Proposal.** Normalize only where the value is kept. `if (x > m) m = x` is not `max(m, x)` when
`x` is a NaN, and WGSL does not fix the NaN result of `max`. Such a rewrite is made only where it
is proved equal. The normalization rules become part of the language document. A rewrite that
changes rounding is #852's numerical contract, not a normalization.

**Proposal.** The intent is a statement of the operator's properties: associative, with an
identity, and commutative. An author's combine function on a struct (an argmin, Welford's mean
and variance, a quaternion product) can carry it:

- associative with an identity: the `ordered` tree;
- also commutative: any order, an atomic or a subgroup operation.

**Proposal.** A performance contract names a target and the lowering it requires. When the
compiler cannot give that lowering, it is an error that names the fact that blocks it, where
`TS8070` is a warning today. A later
compiler that breaks a contract is then caught by the author's build. A program becomes faster
when the compiler improves, and never becomes slower without a signal.

## 5. Compaction

**Owner's direction.** Two forms:

1. an order-preserving compaction in three phases: count each block, an exclusive scan of the
   counts, a scatter;
2. a type that states that the order is not needed.

**Fact.** Form 1 exists. A kernel function's loop appends with `out.push(v)` in the order of the
iterations on every tier, in the three phases above (change 0078).

**Inference.** A one-pass scan with decoupled look-back needs one workgroup to make progress while
another waits on it. WebGPU does not promise that progress between workgroups, so the look-back
can hang on some devices.

**Proposal.** Keep the three phases, and make each faster inside a workgroup:

- count with `subgroupBallot` and `countOneBits`;
- find the local offsets with `subgroupExclusiveAdd`, which is exact on integers;
- count in the loop that makes the values;
- recompute or store the value for the scatter, as the compiler's cost model chooses.

**Proposal.** The unordered type gives only observations that do not depend on the order: the
count, a commutative reduction, a sort, a membership test. An index (`out[0]`) needs a sort first,
and a sort needs a total order with a tie-break. The stored order may then change from run to run,
and every result a program can observe stays the same. The oracle compares as a multiset. The
lowering takes one atomic per workgroup.

**Fact.** Changes 0078, 0080 and 0094 each leave an unordered append or map to a separate
proposal. Change 0078 cites TypeCV's Rule 1.3, which asks that such an operation say so, with its
own spelling and determinism report row. The unordered type above is one spelling of that.

**Fact.** Issue #539 asks for a stable sort of `u32` keys with values, which the unordered type's
sort needs.

**Fact.** ECMAScript's `Set` keeps the insertion order, so no existing name means "unordered". The
type needs a new name in the §9 extension table (Rule 2.1).

## 6. Device differences

**Owner's direction.** When a device is found to compute differently, add a branch then, as the
emulated double already does for Apple and the other platforms.

**Fact.** The emulated double has two flavors, `'float'` and `'integer'` (`src/core/passes/fp64-lower.ts`,
change 0085). `createDevice({ fp64Flavor: 'auto' })` selects `'integer'` from Apple or Metal
signals on the device, and `'float'` otherwise (`src/runtime/device.ts`). The defect it answers,
float error-free transforms folded by Apple Metal and ANGLE through FXC, was found by its symptom
in a downstream repository (X-GIS #915).

**Fact.** A WGSL module that spells `enable subgroups;` fails to compile on a device without the
feature. A branch inside the shader cannot choose between a subgroup form and another form.

**Fact.** A device difference is already met by a lowering, not by the author: on D3D12 (NVIDIA
Blackwell), a workgroup whose idle lanes return before heavy loops hangs the device, so a lane past
the trip count runs the last iteration instead (Rule 8.22, `docs/hardware-notes.md` A1, #703).

**Proposal.** The branch is a variant that the host selects: the compiler emits each variant, and
the runtime chooses one when it opens the device, as the emulated double does.

**Proposal.** Select by a probe, not by the vendor's name: a small known-answer test that runs when
the device opens, and a variant is used only where its result equals the oracle's. A device with
unknown signals then still gets the right variant.

**Inference.** A probe covers the cases it tests. A difference that only some values show can
escape it, so the differential gate between tiers stays.

**Inference.** With selection by probe, the modes of section 3 and the change of tree can wait
until a program needs them, for example an author's combine that does not commute.

## 7. Removing `enable`

**Owner's direction.** Remove every `enable` an author writes. The device and runtime environment
of the host decides.

**Fact.** Rule 10.1 says that a capability comes from the shape the file writes. The string
directive `"enable <ext>"` beside `"use typeshade"` covers an extension the shape cannot imply
(#168, closing #146). It reaches `f16`, `subgroups`, the float render-target family and
`multiview` (`ModuleDecl.enables`, `src/core/ir/nodes.ts`).

**Fact.** Change 0117 (`changes/0117-subgroup-operations.md`, implemented in #919) makes the 21
subgroup built-in functions and `subgroup_id` and `num_subgroups` authorable. A call derives the
`subgroups` capability, and the `"enable subgroups"` directive stays for a file that uses none of
them. On the CPU oracle and on GLSL ES 3.00 a subgroup is one invocation (Rule 11.21). Its
Alternatives section names a compiler-internal subgroup reduction as a later proposal.

**Proposal.** Three kinds of capability, each decided without the author:

1. A strategy the compiler chooses (a subgroup reduction, the emulated double's flavor): the
   compiler emits the variants, and the runtime selects one by feature and probe. The author never
   sees it.
2. A capability the source implies (an `f16` type, `@builtin("view_index")`): the compiler derives
   it from the shape. A device without it gets a lowering that keeps the value. For `f16`, compute
   in `f32` and round to `f16` after each operation. A device without multiview draws once for
   each view, with the view index as a uniform.
3. A capability of a host resource (a float render target, a float blend, a float filter): the
   runtime sees the texture format when it creates the pipeline, and requests the feature then.

**Inference, to verify.** For `+`, `-`, `×`, `÷` and `sqrt`, an `f32` result rounded to `f16`
equals the `f16` result, since `f32` has 24 significand bits, more than `2 × 11 + 2`.

**Proposal.** A lowering that a device without a capability gets must keep the value. It gives the
same bits, or a result within a bound the language states, or the device refuses the program with a
clear reason. Only an opt-in such as `fast` may differ, and the determinism report records it.

**Fact.** Rule 1.5's second sentence already states the refusal: a form the compiler cannot
represent on a target is refused there in one sentence, or a call the CPU tier can run runs there
and says why. `docs/computing-platform-plan.md` asks that an allowed whole-call fallback preserve
the authored contract and be observable. The proposal above extends both to a lowering for a
missing device capability.
Without this, one program gives different values on different devices with no signal, and the
author has to care about the device after all.

**Proposal.** The output of a compile becomes a set of variants and a table from capabilities and
probes to variants, in the manifest. `requiredFeatures` (Rule 10.2) belongs to each variant.

**Related issues.** #130 (every feature emits on both targets), #153 (`f16`, wired type and emit
first), #536 (subgroups as authorable capabilities, still open after change 0117), #67 (one source,
many pipelines through override axes) and #97 (the compiler manages the CPU and GPU boundary).

**What it would touch.** Rules 10.1 to 10.4. `ModuleDecl.enables`, a public export, which needs a
deprecation first. The `"enable subgroups"` directive that change 0117 keeps. Pages of
`typeshade.github.io` and files of `vscode-typeshade` that name `enable` or `enables`, which those
repositories fix when their pin moves.

## 8. Open decisions

Each needs the owner's decision before a proposal is drafted on it.

1. Whether the principle of section 1 becomes a design rule.
2. Whether the canonical tree becomes the adjacent pairwise tree, and when (section 3).
3. Which strict mode: `exact`, `reproducible`, both, or neither yet, and how the `fast` mode
   relates to Rule 11.22, which refuses a rewrite the compiler cannot prove exact and from which
   `fast` is excluded until a proposal amends the rule (change 0131; section 3).
4. Whether a variant is selected by vendor signals or by a probe (section 6).
5. How the direction of section 7 relates to change 0117, which keeps an author's
   `"enable subgroups"` and makes the subgroup functions authorable.
6. Whether the work is one proposal or several, and in which order.
