---
id: '0035'
title: Classes without instance fields remain constructible shader values
status: accepted
rules:
- '8.9'
- '8.21'
surface:
- 2
- 16
- 26
- 28
- 29
- 32
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Update class construction and TS8010/TS8035 explanations to accept fieldless classes; document the internal GPU representation and empty host value.
- repo: vscode-typeshade
  what: Update class authoring guidance and diagnostic fixtures that refuse fieldless classes or construction of static-only classes.
---

<!-- doc-refs: skip-file — a proposal records the authoring-surface change and its tests -->

## What changes

A class need not declare an instance field to be a shader value. `class Empty {}` followed by
`new Empty()` is accepted. A class containing only instance methods, accessors, or static members
is accepted too. Its methods, constructor, inherited members, `super` calls, namespace-qualified
uses, mixin applications and generic instances follow the existing class rules (Rule 8.9).
Abstract classes remain bases and cannot be constructed directly.

An empty class retains an empty authored field list. The CPU oracle and host calls represent its
value as `{}` (Rule 8.21), including when it is nested in another value. Existing constructor
side effects and evaluation order remain observable. Generated representation members are not
source members: they do not become visible to field lookup, object literals, spreads,
destructuring, inheritance, host interfaces, or the debugger.

GPU lowering supplies a nonempty internal representation for a fieldless class and consistently
rewrites its constructions. Reflection and packing account for that representation's byte size,
alignment and array stride without exposing a generated field as an author-written member.
Nested uniform and storage values must agree with the emitted representation. A synthetic
`u32` member is sufficient: its natural layout occupies four bytes, while std140 gives the empty
class a sixteen-byte footprint. A derived class with real inherited or own fields needs no
synthetic field inherited from an empty base.

A static-only class may continue to emit only its static functions when nothing uses it as a
value. Constructing or passing that class as a value must provide its fieldless representation.
This change does not extend the empty-interface or empty-object-type surface.

## Why

Issue #428 contains method-only `Tree`, `Scene` and `PathTracer` classes. Their source is valid
class authoring; WGSL's prohibition of empty structs is a representation obligation for the
compiler. Requiring an unused source field or rewriting the classes as free functions imposes
that target restriction on authors. Retaining class types and the existing receiver lowering
also preserves static dispatch, constructor effects and inheritance without a second method
calling convention.

## What it touches

Rule 8.9 states that an empty instance field list does not prevent class construction or method
dispatch. Rule 8.21 records the empty host object and the distinction between authored fields
and internal GPU storage. Surface sections 2 and 16 describe fieldless class values and their
object representation; section 26 removes empty/static-only construction refusals; sections
28, 29 and 32 keep the value-type, mixin and generic explanations consistent.

The implementation touches class collection and inheritance in `src/compiler/ts/structs.ts`,
construction and receiver lowering in `src/compiler/ts/lower/class-methods.ts`, and any source
type/object-literal resolution needed to retain the empty authored shape. It adds a shared
backend representation pass under `src/core/passes/`, integrates it with both ordinary and
profiled emission in `src/core/emit.ts`, and keeps layout/reflection and uniform/storage packing
consistent. Host-face generation, runtime host-value conversion and debugging must retain the
empty authored object where they encounter this representation. Generated rule and surface
traceability records are updated with the normative documentation.

Focused compiler tests cover an empty class, method-only and static-only classes, `this` calls,
accessors, constructors with effects, `return this`, empty and nonempty inheritance chains,
overrides with `super`, namespaces, mixins and generic instantiation. Existing empty-interface
and empty-type refusals remain pinned. Backend tests compile the generated WGSL and GLSL and
compare class-method answers with the CPU oracle. Layout and runtime tests cover an empty class
as a nested field and array element in uniform/storage values, checking offsets, stride and
round trips without exposing synthetic members. A journey under `journeys/` exercises fieldless
construction through the packed compiler and language service; its index is updated too.

## What it owes downstream

The site updates its class construction examples, reference explanations for TS8010 and TS8035,
and authoring text that says a class must have a field. Its compiler pin records this proposal
and documents the empty host value and reflected GPU footprint.

The editor updates the corresponding authoring guidance and diagnostic fixtures, including
method-only, static-only and generic fieldless classes, and records this proposal with its
compiler pin. No diagnostic code is removed: TS8010 and TS8035 retain their other meanings.
