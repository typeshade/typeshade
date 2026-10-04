---
id: '0038'
title: Accept derived class values where a read-only base view preserves their behavior
status: accepted
rules:
- '8.9'
surface:
- 16
- 26
- 27
- 28
- 30
- 32
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Update inheritance and base-value guidance and TS8003 fixtures to explain the proven read-only upcast; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Update class guidance and base-value diagnostic fixtures to accept proven read-only upcasts and retain truthful unsupported-polymorphism remedies; record this proposal in compiler-changes.md.
---

<!-- doc-refs: skip-file — a proposal records the authoring-surface change and its tests -->

## What changes

A derived class value may initialize or be passed to an existing base class value position
when the compiler proves that its base view is read-only and dispatch-equivalent. Rule 8.9
continues to lower methods to named functions, but no longer refuses every derived-to-base
value solely because the two classes have different struct names.

The initial supported case is the Material and LeafMaterial relationship in issue #429.
LeafMaterial adds fields and methods but does not override either Material method.
Material's methods only read its own fields. Passing that value to a Material constructor
parameter preserves the behavior used by the example without adding a runtime vtable.

The proof must consider inherited methods, accessors and function-valued instance members,
and calls they reach. It must reject an upcast if a derived override can change a call made
through the base, including an indirect call made from an inherited base method. A receiver
write, a mutating accessor or method, and a return of the concrete receiver are not equivalent
to a read-only base projection. A proof it cannot establish is a refusal, not permission to
discard behavior. Private and protected member access keeps its existing source rules.

The conversion constructs the base representation from the inherited fields in declared
order. Its input is evaluated once, even when it is a constructor or function call with side
effects, and argument evaluation retains source order. Nested field and array values follow
their existing value semantics. Projection must not introduce a new loss of observable
aliasing: a base view whose source can subsequently change through an alias requires a
retained receiver or is outside this initial proof. This change does not introduce object
identity, general runtime polymorphism, downcasts or a public representation member.

The initial alias proof may conservatively follow declaration identities and the class
member graph rather than infer arbitrary JavaScript alias relationships. The original
LeafMaterial local is constructed, passed immediately to Leaf and never subsequently
changed. That path must be accepted. A write to the source, to its projected fields or
through an escaped alias that the analysis cannot prove harmless must retain the current
refusal. A class-wide or source-use check must include direct property assignments as well
as method calls; the absence of mutating methods alone is not an alias proof. A name with
the same spelling in another lexical scope is a different declaration and cannot supply
either evidence of safety or evidence of mutation for this conversion.

One contextual conversion authority is used by arguments, annotated local initializers,
assignments, returns, field initializers and contextual object/array elements. Related values
must not be accepted at a call and refused when written in an equivalent initialization.
Unrelated structurally matching classes remain under the existing nominal struct rules.

## Why

Ordinary TypeScript accepts LeafMaterial where Material is declared. The original #429
constructor call fails in TypeShade despite needing none of the behavior for which the
current blanket refusal exists. A proven read-only upcast fixes that source compatibility
gap. Removing the mismatch without converting layouts produces invalid GPU calls; blindly
copying base fields can select the wrong override or detach receiver writes.

This proposal is intentionally a bounded compatibility improvement. Programs that require
dynamic dispatch through a base-typed value need concrete receiver retention and a separate
implementation, such as finite tagged payloads and generated branch dispatch. Completion of
this proposal must not be described as support for all ordinary TypeScript polymorphism.

## What it touches

Rule 8.9 distinguishes the accepted proof from the remaining runtime-dispatch restriction.
Surface sections 26 and 27 replace the unconditional base-value refusal with the accepted case and
its limitations; the guide's inheritance continuation currently falls under section 27.
Sections 16 and 28 keep value construction and refusal guidance accurate;
sections 30 and 32 are reviewed for statements that assume base types never hold derived
values. No export, diagnostic code or registered example is added or removed.

Implementation work covers a centralized class conversion/proof module in src/compiler/ts,
the ancestry and class-function information in context.ts, structs.ts and
lower/class-methods.ts, and contextual type checks in lower/expression-misc.ts,
lower/statement.ts and composite construction. Source compiler and language-service results
must agree. Documentation references and generated requirements are synchronized and reviewed.

Tests cover the original Material/LeafMaterial constructor argument, equivalent supported
initialization/assignment/return/composite contexts, namespace and generic ancestry, inherited
read-only methods, one-time evaluation and argument order, and compiler/editor agreement.
Negative cases cover direct and transitive overrides, accessor overrides, receiver mutation,
receiver returns, observable alias mutation, unrelated classes, and an unprovable dispatch
path. No unsupported case may be made to pass by silently slicing away its behavior.

A packed-package journey verifies the accepted case against an independent JavaScript
reference on the CPU and WebGPU. WGSL and GLSL ES 3.00 must compile the accepted lowered
representation through real compilers; existing oracle and differential gates continue to
hold across the three backends. Existing baseline tests for the blanket refusal are revised
to retain unsafe examples and add the safe case.

## What it owes downstream

The site updates inheritance/base-value prose, class guidance and diagnostic fixtures that
currently refuse the supported Material-style case. The editor updates its shader-authoring
guidance and compiler fixtures. Both explain the proof's limits without claiming that a GPU
backend makes general runtime dispatch impossible, and record this proposal's id when pinning
the implementing compiler.
