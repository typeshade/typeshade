---
id: '0086'
title: Destructure fixed-length arrays and homogeneous tuples into local bindings
status: accepted
rules: []
surface:
  - 14
  - 18
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Explain fixed-array binding patterns in the TypeScript and array guides, update Playground examples and diagnostic fixtures, and record 0086 when the compiler pin moves.
  - repo: vscode-typeshade
    what: Update the authoring skill's destructuring guidance and editor fixtures, and record 0086 when the compiler pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0086; accepted. The front matter is authoritative.                                                                                                                                                                                                                                                               |
| Date and attribution          | Authored 2026-10-23, UTC, by Codex. The user requested improvements to unsupported TypeScript patterns and selected staged work on feasible items. The user explicitly requested that existing language rules remain. These are request records, not proposal acceptance or a merge.                                   |
| Applicability / Effectivity   | Function-local variable declarations in the TypeScript front end and their editor representation. WGSL, GLSL ES 3.00 and both CPU paths use existing array reads and local declarations. No release version is assigned.                                                                                               |
| Review baseline               | Reproduction and local inspection: `212d26d2fb9fb6dd39b72674e537653fb0f7e888`, with the earlier session's uncommitted type-claim fixes. Remote main inspected: `05915c3bd80965467c269473faf9cc1839c51e9b`; its statement lowerer still refuses array binding patterns. Local code has not been rebased to remote main. |
| Review and revision authority | No PR is assigned at authorship. Git records revisions; PR review and merge records establish acceptance. A draft and an agent's implementation recommendation do not establish approval.                                                                                                                              |

[Proposal PR #750](https://github.com/typeshade/typeshade/pull/750) was opened on 2026-10-23, UTC.
The user approved this proposal in the task conversation on 2026-10-23, UTC, authorizing its
acceptance and merge. No production implementation is included in the proposal PR.

## What changes

Accept array binding patterns in function-local `const` and `let` declarations when the
source is a homogeneous array with a statically known length. Existing homogeneous tuple
types are the same array representation and participate in the same rule.

The following source currently produces `TS8099` at the inspected local baseline:

```ts
"use typeshade";
export function endpoints(xs: array<f32, 3>): f32 {
  const [first, , last] = xs;
  return first + last;
}
```

Under this proposal, its bindings are the reads `xs[0]` and `xs[2]`. The omitted position
advances the source index and creates no local. The constructor, array length, element type,
numeric conversion policy and writability rules do not change.

The first implementation covers:

- `const [a, b] = xs` and `let [a, b] = xs`, including omitted positions and fewer bound
  elements than the source length.
- A tuple or fixed-array annotation on the declaration. It supplies the initializer's
  existing contextual type and must agree with its source under the current type rules.
- A homogeneous array literal initializer, including `const [a, b] = [1., 2.]`. Without an
  annotation, infer its fixed length and element type by the existing `array(...)` policy.
  This is a binding-pattern context, not general inference for every bare array literal.
- Nested array and object binding patterns when each array's length and each object's
  layout are known. Reuse ordinary field access, access control and getter handling.
- A source expression such as a helper call. Evaluate the source once, and preserve source
  order and the existing value-copy semantics. Evaluate nested receivers once wherever
  repeating them would repeat an observable operation. A binding copies a value; it does
  not introduce an alias into the source array or change its address space.
- An empty binding pattern on an otherwise valid fixed-array source. Preserve effects of
  evaluating the source even when no element is bound.

For every bound identifier, preserve the existing `let` or `const` behavior, lexical scope,
capture behavior, declaration identity, source location and editor type. A pattern's reads
must not write its source. A mutable local bound from a uniform or readonly array is a local
copy, not a writable view of that resource.

Reject a binding that requires an element past the source's known length. An omitted element
still consumes a position. Do not synthesize `undefined`, a nullable type or a zero value for
a missing element. Reject mixed-type tuple literals under the existing array-layout rules.
Unannotated integer literal elements keep the current `f32` default, rather than taking a new
type from subsequent uses of an individual bound name.

This phase does not add rest elements, defaults, destructuring assignment, destructured
parameters, destructuring in `for...of`, vector iteration, user-defined iterators,
runtime-sized or specialization-sized array patterns, or zero-length GPU arrays. Those forms
retain truthful diagnostics. Ordinary object binding patterns keep their existing behavior.
No design rule, public export or diagnostic code is added, removed or renumbered.

## Why

The compiler already has fixed-array values, array indexing, homogeneous tuples and local
declarations. Array binding patterns can compose those operations without a new runtime value
or backend statement kind. Requiring an author to manually name every index is a front-end
limitation rather than a change to the shader's data layout.

The current refusal is in `src/compiler/ts/lower/statement.ts` and is pinned in
`src/compiler/ts/destructuring.test.ts`. It tells the author to replace the pattern with
component or index reads. This proposal makes the fixed-array version of that replacement
the compiler's job while leaving vector representation and numeric rules intact.

Keeping index reads as the only spelling preserves today's implementation but leaves a common
TypeScript pattern unsupported. Adding general iterable destructuring would require iterator,
missing-element and rest-value semantics beyond the existing GPU value model. This draft
chooses the statically bounded array case first.

## What it touches

- Surface section 14 replaces the blanket array-pattern refusal with the supported binding
  cases and the remaining restrictions. Surface section 18 describes homogeneous array
  literal inference specifically in a binding-pattern initializer.
- `src/compiler/ts/lower/statement.ts` generalizes the binding-pattern walk to array elements,
  omitted positions and nesting. It uses existing array index and local declaration nodes.
  It supplies an annotation as context or infers a homogeneous literal by the existing
  array-constructor policy. It must not implement numeric conversion by relabeling a type.
- `src/compiler/ts/lower/expression-array.ts` may expose or share the existing element and
  length inference for this initializer context. The general expression fallback retains its
  existing requirement for a type or an explicit array constructor.
- `src/compiler/ts/definite.ts`, `src/compiler/ts/semantic.ts`,
  `src/compiler/ts/lower/closures.ts`, `src/compiler/ts/local-numeric-inference.ts` and
  `src/compiler/ts/symbols.ts` are audited for declaration identity, capture, initialized
  bindings and identifier spans. Change only what the new patterns require; do not broaden
  local numeric inference or suppress unrelated diagnostics.
- `src/compiler/ts/destructuring.test.ts`, relevant array, scope, closure and language-service
  tests, and `src/compiler/ts/remedy-lines.test.ts` replace obsolete refusal expectations and
  verify the remaining remedies. Add a packed user journey and describe it in
  `journeys/README.md`.
- `AUTHORING.md` explains the accepted patterns. `CHANGELOG.md` records the delivered change.
  Synchronize the affected surface records under `reqs/` and follow their review workflow.
  The design rules, scalar and vector conversion semantics, ambient scalar types and runtime
  dependencies remain unchanged.

### Draft impact estimate

The expected implementation is front-end lowering and editor integration over existing IR.
No new backend node, public API or dependency is planned. Existing valid programs retain their
behavior; newly accepted sources are the binding forms above. Implementation time, downstream
effort and cost are unestimated. Any need for a new representation or a design-rule change is
a scope deviation requiring review before implementation continues.

Required functional validation:

1. Cover `const`, mutable `let`, omissions, shorter patterns, typed tuple initializers,
   inferred homogeneous literals, nested array/object patterns and fixed arrays of structs.
2. Verify that integer and float element types are preserved, implicit conversions are still
   refused, and the unchanged literal range and inference rules apply.
3. Test a source call with observable effects, nested receivers, and an empty pattern to prove
   the required number and order of evaluations. Use independent expected values rather than
   only snapshots of the lowering implementation.
4. Cover shadowing, closures, reserved authored names, duplicate bindings, readonly sources,
   local copies, private members and getters. Compare editor diagnostics and hover locations
   with the front end's symbol and expression tables.
5. Keep negative tests for overlong patterns, rest/default forms, unknown-length sources,
   non-arrays and mixed element layouts. A rejected declaration must not add cascaded unknown
   name errors at every later use.
6. Run the build, appropriate compiler/editor tests, full unit suite, real compile gate and
   packed user-journey gate. Hold the journey to an independent JavaScript reference on the
   supported GPU targets and both CPU paths. Existing emit goldens must remain unchanged for
   programs that do not use the new syntax.

Required document validation: proposal shape, document references, formatting, document impact,
paired-file checks, affected requirement records and the accepted-proposal scope gate.
Record actual commands, tested revisions and results when they run. Earlier validation of
type-claim fixes does not validate array destructuring.

Draft checks on 2026-10-23, UTC, used the local baseline and uncommitted worktree described
above: `src/changes.test.ts` and `src/doc-references.test.ts` passed all 30 tests with Vitest,
two workers and the dot reporter. Prettier and `git diff --check` passed. These observations
validate the draft document, not an implementation of the new syntax.

### Approval and plan record

On 2026-10-23, UTC, the user answered "승인" to the request to approve and merge proposal
PR #750 as accepted. The reviewed proposal revision was commit
`10bd1e9954a66f8cdb4098435ec16ae491bb30bb` (content blob
`a2c050f9fc24dfe24b3392101d91fc58006d53c5`). This decision accepts the scope and validation
plan above, with existing numeric, layout and readonly rules preserved.

Codex is responsible for the requested proposal merge and compiler implementation in this
task. Site/editor pin delivery and their maintainers' assignments remain separate pending
work. No calendar milestone, duration or cost estimate was agreed. The proposal PR's actual
merge record establishes the accepted implementation base; this approval record does not
invent its future merge hash or functional results.

### Configuration and validation record

This record does not yet apply. Delivery requires the accepted revision, actual implementation
commits and PR, the tested compiler configuration, retained functional and document results,
disposition of scope deviations and an explicit list of pending downstream work. The current
compiler still refuses the new array binding forms. No implementation is claimed here.

### Staged follow-up

This proposal is the first batch, not completion of the earlier unsupported-pattern inventory.
Candidate later batches are destructured value parameters; defaults that depend on previous
parameters; fixed-size argument/list spread and rest values; explicit generic vector
constructors; and compile-time type resolution for concrete generic interfaces, object aliases
and type operators. Each needs its own scope and compatibility review before implementation.
Bottom-tested loops and expression-form updates also need an IR and evaluation-order review.

Ordinary JavaScript runtime facilities, async scheduling, exceptions, runtime function values,
nullable values, dynamic object shapes and implicit numeric conversion are outside this staged
syntax work. Existing working support for closures, generic functions/classes, independent
default arguments, object spread and fixed-array higher-order methods is preserved.

## What it owes downstream

The site must update the TypeScript destructuring guidance and array examples to show fixed
array patterns and their bounds. Review its Playground diagnostic fixtures for the previous
blanket refusal. Generated surface material follows the pinned compiler; independently
written prose must be updated too.

The editor must update the destructuring paragraph in its authoring skill's language reference
and any fixtures that expect every array binding pattern to fail. Array-pattern hover and
navigation must use the compiler's bound identifiers and element types, including omitted and
nested positions.

Downstream inspection found an explicit blanket refusal in the
[editor language reference](https://github.com/typeshade/vscode-typeshade/blob/main/plugins/typeshade/skills/typeshade/references/language.md):
"Destructuring a vector or a struct works (`const { x, y } = v`); an array pattern does not."
The site's
[declaration guide route](https://github.com/typeshade/typeshade.github.io/blob/main/src/pages/guide/language/from-typescript/declarations.astro)
delegates its content to a shared page component; follow that component to update the actual
prose in both locales rather than editing the wrapper alone. The language-example registry
and Playground diagnostic test were inspected without finding an array-pattern refusal;
that limited search does not establish that the whole site has no other affected content.

Both repositories must record 0086 in their compiler-change records when their pins move.
Downstream implementation owners, precise content edits, pin PRs and validation results remain
pending. No downstream delivery is claimed by accepting or implementing the compiler proposal.
