---
id: '0031'
title: Reassign a value parameter through a local copy without changing the caller
status: accepted
rules:
- '7.2'
- '8.8'
- '8.17'
surface:
- 14
- 26
- 52
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Review the functions and constructs explanations generated from surface sections 14, 26 and 52 and replace the whole-parameter TS8018 refusal with value-local reassignment
- repo: vscode-typeshade
  what: Update the plugin skill's references/language.md and references/diagnostics.md parameter-write guidance and TS8018 examples; keep other invalid assignment targets refused
---

<!-- doc-refs: skip-file — a draft proposal names planned changes and files in downstream repositories -->

## What changes

The user authorized local implementation on 2026-10-03. This proposal remains a draft
until publication and merge; local authorization does not claim base-branch acceptance.

A function may reassign its own value parameter, including a scalar, vector, matrix,
fixed-size array or struct. Plain assignment, compound assignment and integer updates
change a local initialized from the argument. The caller's value is unchanged. This applies
to a helper, an entry, a method, a constructor and an accessor, including generic and
higher-order copies of those bodies. It adds no reference parameter to the authoring surface.

Today every whole-parameter write is refused as TS8018, and the author must add and write a
local explicitly. Issue #431 supplies a complete shader whose only compiler errors are nine
writes to `col`, a `vec3` parameter of two methods. The local-copy remedy already compiles.
After this proposal is accepted, those writes should compile with that same value semantics.

For example, `shade(col: vec3) { col += vec3(0.1); return col; }` lowers to a function taking
an immutable input and declaring a mutable local initialized from it. Every body read and
write of that parameter resolves to the local. WGSL cannot redeclare a parameter's name in
the function's outer scope, so the compiler retains the input's authored name and gives the
local a fresh name. Collision avoidance must use the existing name allocator. Parameter order,
types, attributes and reflection remain those of the authored signature, and debugging
must show `col` as the current local value rather than the hidden input.

A local function that captures a reassigned parameter captures this local. A capture that
writes it uses the same reference already used for an enclosing local under Rule 8.17; that
reference does not reach the caller. Detecting a whole write must respect declaration
identity and shadowing, including writes reached through captured local functions, rather
than matching identifier text.

Once whole-rebound, the parameter is an ordinary mutable value local, including its fields,
components and elements. Parameters with no whole write retain their read-only place
restriction. This proposal does not broaden writes to resource handles, function-valued parameters or the
reference-backed runtime arrays of kernel functions (Rule 8.23). Those retain their existing
rules and diagnostics. A struct's whole rebinding uses TypeShade's existing value-copy
semantics, not JavaScript object identity.

## Why

TypeScript and GLSL authors routinely reassign parameters to build a result. Requiring a
manual local in every such function makes importing an otherwise supported shader harder.
WGSL's immutable parameters are an emit restriction a local can satisfy, rather than a
reason the source language must refuse rebinding.

The refusal was a deliberate resolution of #160, documented in surface section 52 and
pinned by `tint-invalid.test.ts`. A same-name `var col = col` is invalid WGSL, so removing
the refusal alone is not a fix. Giving the local a fresh name and resolving the body to it solves
that collision. Changing the parameter to an `inout` reference would instead change the
caller and violate Rule 8.8; it is not this proposal's meaning.

## What it touches

- Rule 7.2 records the TypeScript-to-WGSL local-copy mapping and identifier divergence.
- Rule 8.8 states that whole-parameter rebinding changes only a local copy, while its
  pass-by-value and kernel-array exception remain in force.
- Rule 8.17 specifies that a captured rebound parameter is the mutable local shared by
  closures, including writes from those closures.
- Surface section 14 explains function parameter rebinding; section 26 applies it to class
  bodies; section 52 replaces the TS8018 whole-parameter refusal and its historical rationale.
- `src/compiler/ts/lower/function.ts` and the class/local-function lowering paths establish
  the input-to-local binding before lowering a body. `lower/statement.ts` retains refusals
  for excluded targets. Scope and capture analysis must agree on the declaration's local.
- Update the affected requirements with `reqs:sync` and review their suspect links. Review
  `AUTHORING.md`, the compiler directory maps and diagnostic guidance for stale claims.
- Update the existing whole-parameter refusal assertions in `operators-statements.test.ts`,
  `tint-invalid.test.ts` and `closures.test.ts`. Add regressions for reads before the first
  write, conditional and repeated writes, shadowing, name collisions, integer updates,
  compound writes, methods, entry IO attributes, generic/higher-order copies and closures.
  A caller test must prove its argument is unchanged. Cover struct/array copy isolation on
  the oracle, codegen and stepping debugger as well as scalar/vector results.
- Add a journey for parameter rebinding, checked against an independent JavaScript
  reference. Compile representative output with Tint and GLSL ES 3.00, hold CPU backends to
  the reference, and run the emit and journey gates. Unwritten parameters must keep their
  existing emitted form. No new public export or diagnostic code is required.

## What it owes downstream

The site consumes the normative surface for its construct/reference material. Review its
function and class pages and any example stating that a parameter needs a manual local,
including `content/guide/ko/functions-and-entry-points.md`, at the compiler pin.

The editor plugin's `plugins/typeshade/skills/typeshade/references/diagnostics.md` explicitly
lists a parameter write under TS8018 with the remedy to copy into a `let`. Replace only
whole-value rebinding there, retain the invalid swizzle and vector-update cases, and review
its `references/language.md` function and mutation guidance. Both repositories record 0031
in `compiler-changes.md` when they pin an implementation.
