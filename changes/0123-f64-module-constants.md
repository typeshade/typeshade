---
id: '0123'
title: Scalar f64 module constants retain their precision when folded
status: implemented
rules:
  - '6.3'
surface:
  - 12
  - 39
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Document scalar f64 module constants and their precision boundaries, validate construct examples with the new compiler pin, and record 0123.
  - repo: vscode-typeshade
    what: Update module-constant guidance and verify f64 hover and refusals after adopting the compiler pin; record 0123.
  - repo: typeaudio
    what: Recheck the module-constant workaround reported in issue 967 when adopting; record 0123.
---

**Document control**

| Field                         | Record                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0123, implemented in the compiler; downstream adoption remains pending.                                                                                               |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship.                                                          |
| Request source                | Part 2 of issue [#967](https://github.com/typeshade/typeshade/issues/967). Part 1, refusal cascades, was delivered in PR #1043.                                                |
| Applicability / Effectivity   | The TypeScript front end's scalar module constants, including namespace constants and unwritten static fields. CPU, WGSL and GLSL ES 3.00 outputs. Release version unassigned. |
| Review baseline               | `main` at `bb838514a842acfe3e257396182f0f82a60abbc4`.                                                                                                                          |
| Review and revision authority | Proposal [PR #1048](https://github.com/typeshade/typeshade/pull/1048). Git records revisions; its accepted merge makes the decision effective.                                 |

## What changes

Permit a scalar `f64` module constant under Rule 6.3. Its initializer must fold to a finite
JavaScript double, with both words of the existing GPU `f32` pair finite. The CPU oracle
keeps that double. Both GPU targets receive the existing split literal pair, not a call to an
emulation helper at module scope. The CPU preserves negative zero; the GPU zero sign follows
the existing split and emit behavior and is not guaranteed. Underflow follows the existing split.

```ts
"use typeshade";

const TAU: f64 = 2 * Math.PI;
const HALF: f64 = TAU / 2;
const NARROW: f32 = 0.1;
const WIDE: f64 = f64(NARROW);
const ROOT: f64 = sqrt(f64(2));

export function phase(x: f64): f64 {
  return x / TAU + HALF + WIDE + ROOT;
}
```

The existing literal contextual typing applies. Pure numeric literals and `Math` constants
in an `f64` context retain their JavaScript double value. Explicit `f64(...)`, earlier whole
scalar constants, unary minus and the existing `+`, `-`, `*`, `/` operations are eligible when
their typed operands are constant. A divisor must be nonzero. Existing type checks still apply;
an annotation does not silently convert a call of another type.

An explicit `f32(...)` or a reference to an earlier `f32` constant establishes an `f32`
precision boundary. Read an earlier scalar constant's existing known value rounded to `f32`;
do not change how that earlier declaration is compiled. This is the recorded compile-time
scalar value, not a promise to reproduce an earlier builtin expression's GPU evaluation.
Existing `f32` builtin constants can retain an expression for the GPU and a different
double-precision value for the oracle; the new path rounds the latter. Within the new initializer,
arithmetic and builtin calls performed as `f32` round their operands and result to `f32` at
each operation or call. This specifies call boundaries, not a builtin's internal implementation. Widening keeps
that rounded value exactly; subsequent `f64` arithmetic uses JavaScript double precision.
Thus `f64(f32(0.1))` is `Math.fround(0.1)`, and with `const A: f32 = 16777216`,
`f64((A + 1) - A)` is zero. Parentheses and unary minus cannot erase a written narrow.
Literal-only `f64(1 / 3)` retains the double. Preserve the syntax's precision boundaries
before an internal fold can discard them.

For calls whose operands are `f64`, keep exactly the ten existing scalar builtins:
`abs`, `cos`, `floor`, `fract`, `max`, `min`, `mix`, `round`, `sin`, and `sqrt`.
Evaluate these constant calls through the CPU oracle's definitions, including ties-to-even
`round`, then split the final value once. This is a stated exception to surface section 12's
general rule that a builtin call remains in the emitted constant expression. Narrowed `f32`
subexpressions retain their existing eligible builtins and explicit rounding boundaries.
No additional operation becomes legal merely because its arguments are constant.

Use existing `TS8003` for an unrepresentable final value and identify the declaration and a
remedy. Keep existing refusals for declared functions, resources, field or element reads,
nonconstant operands, unsupported `f64` builtins and operators. Refused declarations and their
dependent declarations must retain the single-diagnostic behavior fixed in PR #1043.

The same collector gives namespace constants and unwritten static fields this behavior under
the existing Rule 8.13 and surface section 26 contract. Imports, exports and generated host
faces retain their existing resolution and scalar `number` representation. This proposal adds
no aggregate constant form, public type, runtime option or diagnostic code. It does not change
the existing `f32`, `i32`, `u32` or `bool` module-constant paths or runtime expression semantics.
Rule 4.4's CPU double versus approximate GPU pair remains in force; this is not binary64 range
or bit-for-bit CPU/GPU equality.

## Why

Issue #967 needs a shared `f64` value outside a function. The scalar collector currently
refuses the type. Extending only its whitelist would truncate the value as an integer; keeping
a builtin `valueExpr` would instead produce an illegal module-scope `df64_*` call. The existing
IR already carries an `f64` scalar constant and the lowering pass already splits its `cpuValue`.
The missing work is a typed, bounded constant evaluation path in the front end.

Globally changing the integer/loop constant folder would affect unrelated existing behavior.
Using it without a precision boundary would also recover precision an explicit `f32` discarded.
The new path is confined to `f64` module initializers, with the declared semantics tested at
both the compiler and editor boundaries. GPU helper calls cannot implement module constants,
and reinterpreting a pair as native binary64 would promise range the GPU representation lacks.

## What it touches

- Rule 6.3: the `f64` scalar evaluation and precision-boundary contract.
- Surface sections 12 and 39: allowed module constants, folding, range and examples.
- Module-constant collection and its internal typed evaluation support, with existing scalar
  paths preserved; tests for namespace, static, import/export and host-face consumers.
- Relevant authoring guidance, requirement links and changelog entries.
- No new exports, diagnostic codes, registered examples or dependencies.

### Draft impact estimate

Known work includes preserving typed precision boundaries, producing scalar `ConstDecl` values,
checking finite pair range and testing both halves. Existing accepted programs retain their
behavior. This newly accepted source form has a build-time evaluation cost; duration, bundle
size and resource costs are unestimated. Downstream adoption is optional until a repository
moves its compiler pin and consumes this proposal. No performance improvement is claimed.

Required functional evidence:

1. Literal, arithmetic, prior constant, `Math` constant and all ten eligible `f64` builtin
   initializers; existing qualified namespace resolution, unwritten static, import/export and
   host-face paths. Integer builtin subexpressions retain their signed or unsigned semantics.
2. Explicit and nested `f32` boundaries, earlier `f32` references, cancellation across `f32`
   arithmetic, negative zero, finite pair endpoints and overflow. Existing four scalar paths
   retain their behavior.
3. Full diagnostic code, text and location for refusals, with no dependent-use cascade.
   Each author-facing case reads the compiler and language service on the same source, and
   accepted `f64` declarations have an `f64` hover.
4. CPU values and pair values agree with their specified precision; both fp64 flavors emit
   valid WGSL and GLSL, with no module-scope helper calls. Actual Tint and GLSL compilation,
   GPU/CPU comparisons within the existing emulation accuracy for normal-range samples, and a
   packed-package journey exercise constants in an exported function. Underflow and signed
   zero tests assert the documented split/emit behavior, not relative-error or zero-sign guarantees.
5. Focused regressions, build, lint, format, applicable GPU gates and required current-head CI.

Required document evidence: `docs:impact`, `docs:refs`, proposal scope and traceability checks.
After updating Rule 6.3 and the surface, sync requirements, read changed items and clear/review
only those actually checked. Review authoring and enforcement references named by impact.

### Approval and plan record

On 2026-11-06 UTC, the owner repeated the instruction to continue remaining work, with the
standing instruction to merge this session's PRs. Codex used that delegated authority to
select the scope in PR #1048 after independent precision and normative-scope reviews of draft
`3207ba0c`. The reviewed revision is that draft plus this PR's explicit builtin call-boundary
rounding, normal-range validation limit and correction that GPU zero sign is not guaranteed.
PR #1048 merged this scope as accepted at `1dc24a566910ff6a4e7bfc1cf8ec1755a9668cd4`.
No implementation was included in that proposal-only PR.

Codex owns compiler implementation and validation in this session. Milestones are the accepted
proposal merge, a separate implementing PR with the functional and document evidence above,
and its merge after required current-head CI passes. The declared impacts and checks are final
for this scope. No delivery date or resource estimate is promised. Downstream assignments are
unconfirmed and those obligations remain pending.

### Configuration and validation record

The accepted baseline is PR #1048's merge above. Compiler implementation is commit
`c50cac710166211b2958bb350e06170a82ff4c05` on branch
`feat/967-f64-module-constants`; integration commit `0d42dda9` includes main's switch validation
from PR #1049. Codex implemented and validated this configuration on 2026-11-06 UTC. The
separate implementation PR and required current-head CI provide its merge evidence.
PR #1051 also integrates main `093f6c609dacf91a783c0b8b9d96981bcea16cf7`, including PR #1050's
inherited static-read wording fix. The merge was automatic and added no implementation changes
beyond PR #1050.

Delivered behavior includes typed scalar folding, explicit and nested precision boundaries,
finite-pair refusals, inferred declarations, namespace/static/import/export paths and the
original issue's captured local. Speculative lowering publishes only the selected expression
and narrowing records. Existing scalar calculation paths remain unchanged.

Independent review found float-to-integer range checks using unrounded values, inference that
could fail before discovering an f64, partial literal folding that depended on grouping, and
refusal cascades. Each was corrected and covered by regressions. The shipped-program parity
gate also exposed the existing Math constant properties as `number` in the ambient library
while the compiler records `f32`; the eight properties now match. Contextual f64 literal values
remain full precision. No new name, operation or API export was added, and the parity gate's
shrink-only exception table was not enlarged.

Observed functional validation:

- Six focused compiler suites passed 232 tests. Broader numeric, optional-value, hover and
  expression-parity checks were run; the Math parity discrepancy above was corrected. The
  final Math, builtin-signature and API-surface run passed 210 tests, and the final integrated
  f64/switch run passed 53 tests. These runs overlap and their counts are not additive.
- After integrating PR #1050, the f64 constant, static-read wording and switch-validation
  suites passed all 61 tests together. Requirement synchronization and Doorstop also passed.
- Build, lint, format and bundle-boundary checks passed. Runtime bundle budgets did not change.
- The compile gate passed 203 WGSL programs on Tint, 139 GLSL programs and 130 render pipelines,
  plus 15 compute and 10 fragment entry calls, with no failures.
- The packed-package gate passed 37 journeys and 132 runs, plus project initialization, host
  imports, host examples and offline automatic fusion. The new journey checks 192 outputs,
  including 41 untouched tail values; both WebGPU flavors and WebGL2 agree with its independent
  reference within `2.64e-15`, below the `1e-12` limit. CPU results match exactly.
- A separate GPU probe also exercised WebGL2 pass layouts of 2048 by 2048 and 16 by 2 words.
  The small layout spans 10 input and 12 output layers. Both ordinary fragment GLSL flavors
  compiled and linked, and a deliberately invalid shader was refused. The WebGL2 compute
  pass uses the existing common flavor; selecting an integer WGSL flavor does not select a
  different GL compute program. No two-flavor GL compute claim is made.

The implementation PR retains the check commands and results; the regression tests and journey
retain the reproducible source. Local configuration: Bun 1.4.4, Node 24.22.1, TypeScript 5.6.3,
Vitest 5.0.5, Doorstop 3.2, Playwright 1.64.1 and Chromium 156.0.8078.4 with SwiftShader. Node
is newer than the repository's 24.19.0 pin, so pinned CI remains required. The full unit,
TypeScript-version, render, performance and GPU differential gates were not rerun locally;
required current-head CI must pass before merge. Native GPU hardware was not measured.

Document validation: impact references were read, no dead references remain, requirements were
synchronized, Rule 6.3 was reviewed and the linked surface items were checked and cleared.
Doorstop passed. Graph indexing, caller traces and change analysis covered 136 impacted symbols.
No design deviation is open. All downstream obligations below remain pending.

## What it owes downstream

Website baseline `bca213452566152ed4b1b55dbdf8294c10d9a33a` was inspected. Its
"src/lib/typescript-lowering.ts" has function-local f64 examples. Add module-level guidance
there and check "src/i18n/en.ts", "src/i18n/ko.ts", "content/guide/ko/fp64.md" and
"content/guide/ko/values-and-mutation.md" when adopting. Validate with the pinned compiler's
construct build, `check:i18n` and `check:guide`; sample checks alone do not run the constructs.

Editor baseline `db3f4171d6ea4689d6048d2252b6553da4599906` was inspected. Update
"plugins/typeshade/skills/typeshade/references/language.md" and review the adjacent diagnostic
reference. Its skill tests compile shader fences; tsserver fixtures should verify clean
diagnostics, `f64` hover and the refused declaration. Both repositories currently pin compiler
`3e1e8420a5313e045beb175131148920bfdc2d07`. The quoted paths identify downstream files.

TypeAudio supplied the issue's use case. Recheck any function-local workaround against the new
compiler before moving it to module scope. Its current checkout was not inspected here, so no
specific migration or completed validation is claimed.

Each adopting repository records 0123 in "compiler-changes.md" with its compiler pin. No name
is removed or renamed. All downstream work remains pending; owners and dates are unassigned.
