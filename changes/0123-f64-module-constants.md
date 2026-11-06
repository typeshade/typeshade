---
id: '0123'
title: Scalar f64 module constants retain their precision when folded
status: draft
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
| Identity and status           | Proposal 0123, draft.                                                                                                                                                          |
| Date and attribution          | Authored 2026-11-06 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship.                                                          |
| Request source                | Part 2 of issue [#967](https://github.com/typeshade/typeshade/issues/967). Part 1, refusal cascades, was delivered in PR #1043.                                                |
| Applicability / Effectivity   | The TypeScript front end's scalar module constants, including namespace constants and unwritten static fields. CPU, WGSL and GLSL ES 3.00 outputs. Release version unassigned. |
| Review baseline               | `main` at `bb838514a842acfe3e257396182f0f82a60abbc4`.                                                                                                                          |
| Review and revision authority | No PR is assigned yet. Git records revisions; the proposal PR's accepted merge makes the decision effective.                                                                   |

## What changes

Permit a scalar `f64` module constant under Rule 6.3. Its initializer must fold to a finite
JavaScript double, with both words of the existing GPU `f32` pair finite. The CPU oracle
keeps that double. Both GPU targets receive the existing split literal pair, not a call to an
emulation helper at module scope. CPU negative zero and the split pair's high-word sign are
retained; the sum of the pair need not retain negative zero. Underflow follows the existing split.

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
double-precision value for the oracle; the new path rounds the latter. Within the new initializer, arithmetic
performed as `f32` rounds its operands and result to `f32` at each operation. Widening keeps
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
   initializers; namespace, unwritten static, import/export and host-face paths.
2. Explicit and nested `f32` boundaries, earlier `f32` references, cancellation across `f32`
   arithmetic, negative zero, finite pair endpoints and overflow. Existing four scalar paths
   retain their behavior.
3. Full diagnostic code, text and location for refusals, with no dependent-use cascade.
   Each author-facing case reads the compiler and language service on the same source, and
   accepted `f64` declarations have an `f64` hover.
4. CPU values and pair values agree with their specified precision; both fp64 flavors emit
   valid WGSL and GLSL, with no module-scope helper calls. Actual Tint and GLSL compilation,
   GPU/CPU comparisons within the existing emulation accuracy, and a packed-package journey
   exercise constants in an exported function.
5. Focused regressions, build, lint, format, applicable GPU gates and required current-head CI.

Required document evidence: `docs:impact`, `docs:refs`, proposal scope and traceability checks.
After updating Rule 6.3 and the surface, sync requirements, read changed items and clear/review
only those actually checked. Review authoring and enforcement references named by impact.

### Approval and plan record

This record does not yet apply. Acceptance requires independent review of the typed precision
boundaries, range and unchanged scope, plus the functional and document validation plan above.
The proposal must merge as accepted before implementation starts.

### Configuration and validation record

This record does not yet apply. Delivery requires the accepted revision, separate implementation
PR, tested configuration and actual functional and document results. Proposal review is not an
implementation result. Record remaining work and downstream adoption separately.

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
