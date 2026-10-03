---
id: '0036'
title: Infer an unannotated local integer from its declared uses
status: accepted
rules:
- '5.1'
surface:
- 13
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Update numeric literal inference guidance and playground diagnostic expectations; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Update authoring guidance and numeric inference diagnostic fixtures; record this proposal in compiler-changes.md.
---

## What changes

An unannotated function-local `let` or `const` initialized by an integer-written literal may take the scalar integer type its declared uses require. For example, `let objectIndex = -1;` followed by `poo(objectIndex)` takes `i32` when `poo` declares an `i32` parameter. Parentheses and a leading minus are part of that literal.

Inference uses declaration identity so a same-named variable in another scope cannot affect the result. The first implementation covers direct arguments of declared functions. If uses require conflicting concrete types, such as `i32` and `f32`, the compiler reports `TS8003` with an annotation or cast remedy rather than choosing whichever use it sees first. Calls that declare no resolvable parameter type cannot establish a type.

Where uses establish no integer type, the current `f32` default remains. An annotation or explicit cast, a float-written initializer, a module constant and a loop induction variable keep their existing rules. The chosen integer type must hold the initializer's value under Rule 5.4. There is still no implicit conversion between concrete types under Rule 5.3.

The opt-in `TS8053` warning applies only to declarations that still take the undecided `f32` default. This change does not flip that default or close the deprecation window tracked by issue #148.

## Why

Issue #429 shows an integer object index becoming `f32` before its only use, which already states `i32`. Delaying that decision improves authoring without making all integer-written locals integers or silently inserting conversions.

## What it touches

Rule 5.1 and surface §13 describe how local uses constrain an integer-written initializer and how conflicting demands are diagnosed. The source compiler adds a binding-aware analysis before local lowering, reuses the existing literal retargeting and range checks, and coordinates the existing integer-literal deprecation reporter. The language service must expose the same inferred type and diagnostics as compilation.

Affected implementation files include `src/compiler/ts/lower/function.ts`, `src/compiler/ts/lower/statement.ts`, `src/compiler/ts/context.ts`, `src/compiler/ts/source-file.ts`, `src/compiler/ts/integer-literal-deprecation.ts`, and a new local numeric inference module. Existing literal helpers in `src/compiler/ts/lit-coerce.ts` may be reused or adjusted within the unchanged range policy. Language service integration and tests change where required for agreement. Generated rule and surface requirements are synchronized and reviewed.

Tests cover the reported direct-call case, unchanged no-demand and float-written defaults, conflicting demands in both source orders, negative and out-of-range initializers, explicit annotations and casts, nested shadowing, and compiler/editor agreement. A user journey holds the accepted case to CPU, WGSL and GLSL behavior.

## What it owes downstream

The site updates numeric literal inference guidance and playground diagnostic expectations. The editor updates authoring guidance and numeric inference fixtures. Both record this proposal's id when pinning the compiler that implements it.
