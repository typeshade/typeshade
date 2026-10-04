---
id: '0037'
title: Infer local integers from declared member and assignment contexts
status: implemented
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
  what: Extend numeric inference guidance and Playground constructor, method and assignment hover and diagnostic fixtures; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Extend authoring inference guidance and constructor, method and assignment hover and diagnostic fixtures; record this proposal in compiler-changes.md.
---

## What changes

Proposal 0036 lets an unannotated function-local `let` or `const` initialized by an integer-written literal take `i32` or `u32` from direct arguments of declared nongeneric functions. Extend the declared contexts that can establish the same demand to constructor arguments, instance and static method arguments, and explicitly typed initialization and simple assignment.

For example, `let objectIndex = -1` followed by `new HitRecord(objectIndex)` takes `i32` when the corresponding constructor parameter declares `i32`. A call `record.accept(objectIndex)` or `HitRecord.accept(objectIndex)` establishes the same demand when its resolved member parameter declares that type. An inherited constructor or method supplies its declared signature; an override supplies its own.

A simple assignment can establish a demand in either direction. In `let selected: i32 = objectIndex` or `selected = objectIndex`, the explicitly typed destination supplies `i32`. In `objectIndex = record.objectIndex`, a resolved field explicitly declared as `i32` supplies that type. The right-hand side must establish its type independently of `objectIndex`; a cycle, an unresolved receiver or a compound assignment establishes no demand. This is not general inference through arithmetic or a change to the types of already typed values.

Resolve candidates, class names and receiver bindings by declaration identity. A shadowing variable or parameter cannot name an outer class, and same-named locals in separate scopes cannot contribute demands to each other. An instance receiver can be established by an explicit class annotation, an independently resolved construction, or the enclosing class's `this` and `super`. Static members resolve against the class declaration. Follow inherited members without choosing a member merely because its spelling matches.

A concrete scalar annotation independent of generic type arguments can supply a demand in a generic class or member. A generic parameter whose concrete type has not been established independently cannot supply one. This proposal does not infer a generic argument from the local whose scalar type it is deciding, or change proposal 0036's nongeneric direct-function scope.

The initializer must still be an integer-written literal, with optional parentheses and a leading minus. A unique integer demand chooses `i32` or `u32`. Conflicting concrete scalar demands reuse `TS8003` and its explicit annotation or cast remedy, independent of source order. Where no integer demand is established, the `f32` default remains. Explicit annotations and casts, float-written initializers, module constants and loop induction variables retain their existing rules. The initializer must fit the chosen integer type under Rule 5.4; Rule 5.3 still forbids implicit conversion between concrete types.

The opt-in `TS8053` warning continues to apply only to declarations that retain the undecided `f32` default. Compilation, the warning pass and language-service hover use the same demand analysis.

## Why

Issue #429 passes an integer object index to a constructor whose parameter already declares `i32`. The initial implementation covered direct function arguments, leaving this ordinary class authoring pattern dependent on an extra annotation. Constructor and member calls should communicate an explicitly declared scalar type as direct function calls do. The example also assigns an explicitly typed object-index field back to the local, which states the same requirement.

Ordinary TypeScript permits these numeric uses because its scalar numeric type is `number`. TypeShade retains its concrete shader scalar types while taking their requirements from the declarations the program already writes.

## What it touches

Rule 5.1 and surface §13 describe the additional contexts and unchanged conflict policy. Implementation extends `src/compiler/ts/local-numeric-inference.ts`, retaining a memoized binding-aware source analysis and reusing existing source resolution and literal range helpers. Shared source declaration resolution may be extracted or adjusted in `src/compiler/ts/lower/closures.ts`, `src/compiler/ts/lower/class-access.ts`, `src/compiler/ts/lower/class-methods.ts`, and a new private helper beside the numeric inference module. Declaration lowering and warning coordination may adjust `src/compiler/ts/lower/statement.ts`, `src/compiler/ts/lower/function.ts`, `src/compiler/ts/context.ts`, `src/compiler/ts/source-file.ts`, `src/compiler/ts/integer-literal-deprecation.ts`, and `src/compiler/ts/lit-coerce.ts` as needed. Language-service integration changes only as needed to expose the same inferred type and diagnostics.

No new TypeScript program or public export is required. Resolution must not depend on the emitted-name presentation registry or on whichever generic instantiation happens to lower first. No second independently maintained class or member registry is introduced.

Tests extend `src/compiler/ts/local-numeric-inference.test.ts` and related numeric context, deprecation and language-service suites. They cover the reported constructor and field-assignment case, instance and static methods, inheritance and overriding, concrete scalar parameters in generic classes, unresolved contexts, binding and class shadowing, conflicts in both source orders, unchanged defaults and casts, range errors, and compile/editor/warning agreement. A packed user journey exercises the accepted contexts against an independent JavaScript reference, the CPU oracle and WebGPU, with GPU language compilation held to the existing gates. Journey registration and `journeys/README.md` change with it. Generated rule and surface requirements are synchronized and reviewed. Authoring prose that still restricts inference to direct functions is updated with the implementation.

## What it owes downstream

The site and editor extend their numeric inference guidance and constructor, member-call and assignment hover or diagnostic fixtures. Both record this proposal's id when pinning the implementing compiler. Existing explicit casts and annotations remain valid examples and need no source rewrite.
