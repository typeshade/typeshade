# Structure analysis: import cycles and load-time effects

This document records one measurement of the import graph of `src/` and one proposal for `src/compiler/ts`.
The [structure refactoring plan](structure-refactoring-plan.md) uses it as evidence.
It changes no author-facing name, rule, diagnostic or emitted output.

Labels: **Fact** is a measured statement. **Proposal** is a suggestion that no one has decided. **Open** waits for an action or an answer.

## 1. Purpose and status

Fact: the numbers of sections 2 to 7 were measured on `dc1df1fe` on 2026-11-24.
`main` moved on after that commit. The numbers of section 7.3 for the checker were measured on `1a864657` on the same day.

Fact: the measuring scripts are not in the repository. They ran in a session scratch directory.
Section 2 describes the method, so a reader can repeat it.

Proposal: the module tree of section 8 and the steps of section 9 are not decided.
Each step is its own pull request, shown to the owner before it starts where the plan says so.

## 2. Method

Fact: the measurement used the TypeScript compiler API (TypeScript 5.6.3) and no other parser.

1. List the files: `git ls-files src`, `.ts` files, without `.d.ts` and without `*.test.ts`. The result is 617 files.
2. Build one `ts.Program` over them. Settings: target ES2022, `NodeNext` modules, `strict`, no ambient types.
3. Resolve each relative specifier of an `import` or `export ... from` to a file. A specifier of a package is not an edge.
4. Merge the declarations of one file pair into one edge. The edge keeps the imported symbols and the class of each symbol.
5. Classify each symbol by its use, with the type checker (section 3).
6. Run `prog.emit` and read the imports that the emitted JavaScript keeps. Compare them with the classes of step 5.
7. Find the strongly connected components with an iterative Tarjan algorithm. A cycle is a component of more than one file.
8. Repeat step 7 over three edge sets (section 4).
9. For each component, find a small set of feedback edges. This is a heuristic, so the set is an upper bound on the minimum.
   Order the files by a greedy rule: a file with no outgoing edge goes last, and a file with no incoming edge goes first.
   Then move each file to the position with the fewest backward edges, until no move helps.
   A feedback edge is an edge that goes backward in the final order.
10. Simulate each proposed step (section 9). Move the named declarations to a new file in the edge list.
    Point each importer at the new file. Count the components again.
    The simulation assumes that a moved declaration does not depend on its old file. A step can break that assumption.
11. Read the top-level statements of each file from its syntax tree and classify them (section 7).
12. Assign each file of `src/compiler/ts` to a proposed module by its name pattern (section 8).
    Count the edges that go from a lower module to a module above it in the order.

Fact: the dynamic `import()` calls are not edges. The graph records 8 of them, for example in `src/cli/bin.ts` and `src/compiler/ts/growing-load.ts`.

## 3. Edge classes

Fact: the graph has 617 files and 3,339 file-level edges.
The classes are exact. Checked against the real `tsc` emit, the JavaScript keeps exactly the classes iii, iv and ivm.
The check found 0 mismatches over 3,339 edges.

| Class | Meaning                                                                       | Edges | Kept by the emit |
| ----- | ----------------------------------------------------------------------------- | ----- | ---------------- |
| i     | Type-only by syntax (`import type`, `export type`, or all specifiers `type`)  | 742   | no               |
| ii    | Type-only by use: a value-form import whose bindings are all used as types    | 3     | no               |
| iii   | Value edge, used only inside function bodies                                  | 2,261 | yes              |
| iv    | Value edge, used when the module loads                                        | 326   | yes              |
| ivm   | Value edge, used at load only inside callbacks that a top-level call receives | 7     | yes              |
| Total |                                                                               | 3,339 |                  |

Fact: the emitted graph has 2,594 edges (classes iii, iv and ivm: 2,261 + 326 + 7).
The load-time graph has 326 edges (class iv). With class ivm it has 333, and the cycles are the same.

Proposal, a reading of the table: an edge of class iii is a cycle that the JavaScript tolerates.
The call happens after every module has loaded. A cycle of class iii edges is a design cost, not a load error.
A cycle with a class iv edge is a load-order rule.

## 4. Cycles

Fact: the number and size of cycles under the three edge sets.

| Edge set                     | Edges | Cycles | Files in cycles | Sizes of the cycles                |
| ---------------------------- | ----- | ------ | --------------- | ---------------------------------- |
| All imports (G0)             | 3,339 | 14     | 184             | 139, 8, 5, 5, 4, 4, 3, 3, 3, 2 x 5 |
| Emitted imports (G1)         | 2,594 | 10     | 80              | 46, 9, 6, 5, 4, 2 x 5              |
| Load-time imports (class iv) | 326   | 1      | 2               | 2                                  |

Fact: the largest cycle of G0 has 139 files. All are in `src/compiler/ts`.
The 139 files hold the four compiler cycles of G1 (46, 9, 6 and 5 files) and the type-only edges that join them.
The only load-time cycle is `src/core/sot.ts` with `src/core/ir/index.ts`.

Fact: the feedback edges of the 139-file cycle number 76 over all imports, and 30 over emitted imports for the 46-file cycle.
Section 5 lists the 30.

### 4.1 The cycles of G1 other than the 46-file cycle

Fact: each row lists the closing edges that the heuristic chose. A symbol list is the symbols of the edge.

| Size | Files                                                                                                                                                                                             | Closing edges                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9    | `src/compiler/ts/abstract-const.ts`, `context.ts`, `lit-coerce.ts`, `type-map.ts`, `generic-structs.ts`, `written-context.ts`, `use-inference.ts`, `inferred-origin.ts`, `remedies/candidates.ts` | `generic-structs.ts` to `type-map.ts` (`mapTsTypeToShaderType`); `written-context.ts` to `type-map.ts` (`authorTypeName`); `inferred-origin.ts` to `use-inference.ts` (`isOpenCounter`, `InferredValue`) |
| 6    | `src/compiler/ts/builtin-check.ts`, `builtin-check/unread-site.ts`, `builtin-type-form.ts`, `mixins.ts`, `structs.ts`, `lower/new-target.ts`                                                      | `builtin-check.ts` to `builtin-check/unread-site.ts` (`unreadDecoratorSite`, `unreadDecoratorRefusal`); `mixins.ts` to `structs.ts` (`initializerType`)                                                  |
| 5    | `src/compiler/ts/object-reference.ts`, `object-reference/written.ts`, `new-object.ts`, `source-types.ts`, `lower/array-constructor/form.ts`                                                       | `object-reference.ts` to `new-object.ts` (`aliasedCall`), to `source-types.ts` (`Reader`) and to `object-reference/written.ts` (`takesThePlace`, `accessorMayWrite`)                                     |
| 4    | `src/core/passes/effects.ts`, `core/passes/opt/expr-utils.ts`, `expr-utils/hoisting.ts`, `expr-utils/roots.ts`                                                                                    | `core/passes/effects.ts` to `core/passes/opt/expr-utils.ts` (`bodyHasRaw`, `collectLocals`)                                                                                                              |
| 2    | `src/core/ir/index.ts`, `src/core/sot.ts`                                                                                                                                                         | `core/sot.ts` to `core/ir/index.ts`, class iv (21 symbols: `Node`, `structT`, `bindingRef`, `construct`, `member`, and more). The only load-time cycle.                                                  |
| 2    | `src/core/manifest.ts`, `src/core/passes/gl-compute.ts`                                                                                                                                           | `core/passes/gl-compute.ts` to `core/manifest.ts` (`layoutOf`)                                                                                                                                           |
| 2    | `src/compiler/ts/lower/function.ts`, `lower/function/type-arguments.ts`                                                                                                                           | `lower/function.ts` to `lower/function/type-arguments.ts` (`arrayLengthParameters`, `typeArgumentsFor`)                                                                                                  |
| 2    | `src/core/debug/phased.ts`, `src/core/debug/dispatch.ts`                                                                                                                                          | `core/debug/dispatch.ts` to `core/debug/phased.ts` (`runPlan`)                                                                                                                                           |
| 2    | `src/core/passes/grad.ts`, `src/core/passes/grad-reverse.ts`                                                                                                                                      | `core/passes/grad.ts` to `core/passes/grad-reverse.ts` (`gradReverse`)                                                                                                                                   |

### 4.2 The cycles that exist only with type-only edges

Fact: these cycles are in G0. In the emitted graph, each one is either gone or smaller. The closing edge is a type import, or a value edge that has no way back in the emitted graph.

| Size | Files                                                                                                                                                                             | Closing edges (class)                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8    | `src/core/reflect.ts`, `emit.ts`, `backend.ts`, `spelling-plan.ts`, `passes/spell-names.ts`, `passes/rename-predeclared.ts`, `passes/spell-externs.ts`, `passes/required-caps.ts` | `core/backend.ts` to `core/emit.ts` (i, `ParenMode`)                                                                                                                                                    |
| 5    | `src/core/subgroup-probe.ts`, `host-entry.ts`, `manifest-types.ts`, `manifest.ts`, `passes/gl-compute.ts`                                                                         | `core/manifest-types.ts` to `core/host-entry.ts` (i, `Layout`); `core/subgroup-probe.ts` to `core/host-entry.ts` (i, `GpuBuffer`, `GpuDevice`); `core/passes/gl-compute.ts` to `core/manifest.ts` (iii) |
| 5    | `src/runtime/resources.ts`, `host-types.ts`, `resource.ts`, `program.ts`, `runtime.ts`                                                                                            | `runtime/resource.ts` to `runtime/host-types.ts` (i); `runtime/resources.ts` to `runtime/program.ts` (i, `CompareFunction`); `runtime/runtime.ts` to `runtime/program.ts` (iii)                         |
| 4    | `src/core/owner.ts`, `resident.ts`, `host-failure.ts`, `fuse-scope.ts`                                                                                                            | `core/host-failure.ts` to `core/resident.ts` (i, `ResidentArrayState`); `core/resident.ts` to `core/owner.ts` (i, `CallOwner`)                                                                          |
| 3    | `src/core/ir/nodes.ts`, `span.ts`, `derived-capabilities.ts`                                                                                                                      | `core/ir/nodes.ts` to `core/ir/span.ts` (i, `SourceSpan`) and to `core/ir/derived-capabilities.ts` (i, `DerivedCapability`)                                                                             |
| 3    | `src/core/debug/phased.ts`, `debug/dispatch.ts`, `oracle.ts`                                                                                                                      | `core/debug/dispatch.ts` to `core/debug/phased.ts` (iii); `core/oracle.ts` to `core/debug/dispatch.ts` (iii)                                                                                            |
| 3    | `src/core/host-kernel.ts`, `host-arity.ts`, `host-kernel-push.ts`                                                                                                                 | `core/host-kernel.ts` to `core/host-arity.ts` (iv, `arityError`, `heldArgument`) and to `core/host-kernel-push.ts` (iii, `dispatchPush`)                                                                |
| 2    | `src/core/pushed-index.ts`, `src/core/cpu-runtime.ts`                                                                                                                             | `core/cpu-runtime.ts` to `core/pushed-index.ts` (iv, `PUSHED_BUILTINS`, `pushOnto`)                                                                                                                     |
| 2    | `src/cli/init.ts`, `src/cli/run.ts`                                                                                                                                               | `cli/run.ts` to `cli/init.ts` (iii, `initializeProject`)                                                                                                                                                |
| 2    | `src/core/fuse-record.ts`, `src/core/fuse-plan.ts`                                                                                                                                | `core/fuse-plan.ts` to `core/fuse-record.ts` (iv, mostly re-exports)                                                                                                                                    |

Fact: two cycles of G0 contain a smaller cycle of G1. The 3-file debug cycle contains `phased.ts` with `dispatch.ts`.
The 5-file `subgroup-probe` cycle contains `manifest.ts` with `gl-compute.ts`.
The cycles of 8, 5 (`runtime`), 4 (`owner`), 3 (`ir/nodes`), 3 (`host-kernel`) and 2 (`pushed-index`, `cli`, `fuse-record`) files have no cycle of emitted imports inside them.

## 5. The 46-file cycle of emitted imports

Fact: the cycle holds 35 files of `src/compiler/ts/lower/` and 11 other files:
`module-vars.ts`, `module-vars/untyped-list.ts`, `module-const.ts`, `narrowing.ts`, `storage-access.ts`, `stage-restrictions.ts`,
`refused-names.ts`, `class-upcasts.ts`, `bindings.ts`, `semantic.ts` and `semantic/strict-mode.ts` (all in `src/compiler/ts/`).

Fact: 30 feedback edges break it. Each is class iii, a use inside a function body.
The group letters and the grouping are a Proposal. The list of edges is a Fact.
All paths below are under `src/compiler/ts/`.

### 5.1 Group A: a child file imports a helper of its parent or a sibling (9 edges, mechanical)

| From                                     | To                                 | Symbols                                                                                       |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `lower/array-constructor/from.ts`        | `lower/array-constructor/lower.ts` | `constantLength`, `Lowering`                                                                  |
| `lower/array-methods/named-function.ts`  | `lower/array-methods.ts`           | `push`                                                                                        |
| `lower/array-methods/value-refusals.ts`  | `lower/array-methods.ts`           | `push`                                                                                        |
| `lower/expression-array/element.ts`      | `lower/expression-array.ts`        | `pushDiag`                                                                                    |
| `lower/expression-call/gather.ts`        | `lower/expression-call.ts`         | `foldConstComponent`, `vecArg`, `floatArg`, `intArg`, `arity`, `pushDiag`                     |
| `lower/expression-call/storage-depth.ts` | `lower/expression-call.ts`         | `lowerMultisampledCall`, `vecArg`, `floatArg`, `intArg`, `dimsArgs`, `arity`, `pushDiag`      |
| `lower/statement/writable.ts`            | `lower/statement.ts`               | `isComposite`, `constCopyWrite`, `rootLValueName`, `staticRootOf`, `unwrapParens`, `pushDiag` |
| `lower/atomics.ts`                       | `lower/expression-prop.ts`         | `rootedIn`                                                                                    |
| `lower/references.ts`                    | `lower/statement/writable.ts`      | `checkPlaceWritable`                                                                          |

Fact: the sources of the edges name no group. The assignment of the last two edges (`atomics.ts`, `references.ts`) and of `array-constructor/from.ts` to A is the analyst's reading.

### 5.2 Group B: dispatcher recursion (13 edges, design)

The dispatchers are `lowerExpression`, `lowerStatement`, `lowerStatements` and `lowerLValue`. Each helper file calls back into the dispatcher.

| From                              | To                                 | Symbols                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lower/atomics.ts`                | `lower/expression.ts`              | `lowerExpression`                                                                                                                                                                                                                                                          |
| `lower/control.ts`                | `lower/statement.ts`               | `lowerDeclarationList`, `lowerExpressionAsStatement`, `lowerLValue`, `lowerStatement`, `lowerStatements`                                                                                                                                                                   |
| `lower/control/switch.ts`         | `lower/statement.ts`               | `lowerStatements`                                                                                                                                                                                                                                                          |
| `lower/class-methods/mutating.ts` | `lower/statement.ts`               | `lowerLValue`                                                                                                                                                                                                                                                              |
| `lower/optional-values.ts`        | `lower/statement.ts`               | `lowerLValue`                                                                                                                                                                                                                                                              |
| `lower/references.ts`             | `lower/statement.ts`               | `lowerLValue`                                                                                                                                                                                                                                                              |
| `lower/expression.ts`             | `lower/index-select.ts`            | `lowerIndex`, `lowerSelect`, `matVecMul`                                                                                                                                                                                                                                   |
| `lower/expression.ts`             | `lower/expression-array.ts`        | `lowerArrayLiteral`, `refuseListSpread`                                                                                                                                                                                                                                    |
| `lower/expression.ts`             | `lower/expression-call.ts`         | `builtinCalleeNames`                                                                                                                                                                                                                                                       |
| `lower/expression.ts`             | `lower/class-methods.ts`           | `lowerThis`                                                                                                                                                                                                                                                                |
| `lower/expression.ts`             | `lower/array-constructor/lower.ts` | `lowerCallOrArray`, `lowerNewOrArray`                                                                                                                                                                                                                                      |
| `lower/expression.ts`             | `lower/expression-prop.ts`         | `lowerObjectLiteral`, `lowerPropertyAccess`                                                                                                                                                                                                                                |
| `lower/expression.ts`             | `lower/optional-values.ts`         | `lowerNullish`, `lowerOptionalEquality`, `lowerOptionalOperand`, `lowerOptionalRead`, `lowerUndefinedTest`, `lowerUndefinedValue`, `convertOptional`, `noteValueType`, `optionalConditionSentence`, `refuseNonNull`, `refuseOptionalUse`, `refuseOptionalWhereInnerWanted` |

### 5.3 Group C: class helpers of `lower/class-methods.ts` (4 edges, mechanical, a registry moves)

| From                              | To                                | Symbols                                                                                                               |
| --------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `class-upcasts.ts`                | `lower/class-methods.ts`          | `classFunctionOf`, `ClassFunction`                                                                                    |
| `lower/class-access.ts`           | `lower/class-methods.ts`          | `MISSING_HALF`, `NO_SUPER`, `classFunctionOf`, `isCollidedFunction`, `methodFnName`, `superFieldKey`, `ClassFunction` |
| `lower/class-methods/mutating.ts` | `lower/class-methods.ts`          | `ClassFunction`, `pushDiag`, `unparen`, `declaringClassOf`                                                            |
| `lower/class-access.ts`           | `lower/class-methods/mutating.ts` | `mutatingReceiver`                                                                                                    |

Fact: `classFunctionOf` reads a registry that `lower/class-methods.ts` owns. Moving it moves that state.

### 5.4 Group D: pure name helpers of `module-const.ts` (2 edges)

| From                    | To                | Symbols                                                                         |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `lower/class-access.ts` | `module-const.ts` | `staticConstName`                                                               |
| `module-vars.ts`        | `module-const.ts` | `declaredCallIn`, `isFoldableConstExpr`, `staticConstName`, `writtenModuleName` |

### 5.5 Group E: sentence builders that `semantic.ts` reads (2 edges)

| From          | To                         | Symbols                                                                  |
| ------------- | -------------------------- | ------------------------------------------------------------------------ |
| `semantic.ts` | `lower/expression.ts`      | `builtinValueNames`, `unknownIdentifierSentence`, `unknownValueSentence` |
| `semantic.ts` | `lower/expression-call.ts` | `unknownFunctionSentence`                                                |

Fact: 9 + 13 + 4 + 2 + 2 = 30 edges.

## 6. Hubs

Fact: the five files with the most importers inside the 139-file cycle, over all edge classes.

| File                                | Importers | Lines (`graph.json`) | Note                                                                           |
| ----------------------------------- | --------- | -------------------- | ------------------------------------------------------------------------------ |
| `src/compiler/ts/source-file.ts`    | 91        | 1,071                | 90 edges import only `TsCompilerDiagnostic`; the file orchestrates the compile |
| `src/compiler/ts/context.ts`        | 74        | 1,426                | The shared compile context                                                     |
| `src/compiler/ts/diagnostic.ts`     | 70        | 340                  | Diagnostic construction                                                        |
| `src/compiler/ts/optional.ts`       | 58        | 580                  | Optional-value types                                                           |
| `src/compiler/ts/abstract-const.ts` | 35        | 4,437                | Abstract constants; pull requests #1493 and #1498 edit it                      |

Fact: `source-file.ts` is the orchestrator, and it sits at the bottom of the layering.
It sits there because the interface `TsCompilerDiagnostic` lives in it.
The graph holds 90 edges whose only symbol is `TsCompilerDiagnostic`, and 99 edges that carry it.

Fact: the line counts of `graph.json` differ by one from `scripts/file-size-baseline.json` for some files
(`abstract-const.ts`: 4,437 and 4,436). The baseline rule does not count a final newline.

## 7. Load-time effects

### 7.1 Top-level units that run code when the module loads

Fact: the analysis classified the top-level statements of the 617 files by its own syntax rule.
It read 11,927 statements. A unit is active when it is a `let`, a non-declaration statement, a class with a static member or an `extends` expression,
or a `const` whose initializer calls a function or builds an object with `new` outside a function body.
The result is 638 active units in 223 files. The 16 test-support files of the product tree are included.

| Class                                                    | Units | Meaning                                                                                                                       |
| -------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| A, empty container                                       | 193   | `new WeakMap()`, `new Map()`, `new Set()` or `[]` as a cache or a registry holder                                             |
| B, literal table                                         | 200   | 151 `new Map` or `new Set` of a literal, 49 `Object.freeze`, `Object.fromEntries`, `Symbol` or an immediately called function |
| C, `let` module state                                    | 52    | Mutable state of a module                                                                                                     |
| D, top-level statement                                   | 28    | A statement that is not a declaration (section 7.2)                                                                           |
| E, calls into other functions at load                    | 164   | Derived tables and pure IR builders, and 10 scratch typed arrays or views                                                     |
| F, class with a static member or an `extends` expression | 1     | `ProjectedInputView` in `src/core/host-entry.ts`                                                                              |
| Total                                                    | 638   |                                                                                                                               |

Fact: classes D and F together hold 29 units. Class E was not reviewed unit by unit.

Fact: the 10 scratch units are `F32`, `U32`, `I32` in `src/core/console.ts`; `_bitcastView`, `_f64View` in `src/core/cpu-runtime.ts`;
`LITTLE_ENDIAN` in `src/core/host-entry.ts`; `orderView` in `src/core/host-kernel.ts`; `SLOTS` in `src/core/kernel-tree.ts`;
`view` in `src/core/testing/gl-model.ts` and `view` in `src/core/testing/libm-reference.ts`.

### 7.2 Classes D and F by kind

| Kind                           | Units | Where                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration by side effect    | 9     | The table below                                                                                                                                                                                                                                                                                               |
| `"use typeshade"` directive    | 8     | `src/algorithms/index.shade.ts`, `maps.shade.ts`, `reduce.shade.ts`, `scan.shade.ts`, `src/core/libm/explog.shade.ts`, `invtrig.shade.ts`, `trig.shade.ts`, `src/random/index.shade.ts` (line 1 of each). Not an effect.                                                                                      |
| Test setup in the product tree | 4     | `src/core/testing/no-inlining.ts` lines 4 to 6, `src/core/testing/yield-between-tests.ts` line 20                                                                                                                                                                                                             |
| Other                          | 8     | `src/cli/bin.ts:82` (the entry run); `src/core/fp64/df64-int.ts:378,379,380` (table fill); `src/core/ir/builder.ts:427` (a `globalThis` guard); `src/language-service/ambient.ts:68` (table fill); `src/runtime/program.ts:247` (`void [...]`); `src/core/host-entry.ts:1470` (class `extends` an expression) |

The registrations:

| Path and line                  | Unit                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| `src/core/ir/builder.ts:456`   | `installStmtSink({ ... })`                                                  |
| `src/core/ir/node.ts:812`      | `Object.defineProperty(ReadonlyNode.prototype, NODE_BRAND, ...)`            |
| `src/core/resident.ts:444`     | `resourceProbes.push(...)`                                                  |
| `src/fuse.ts:17`               | `fuseSlot.open = ...`                                                       |
| `src/runtime/device.ts:882`    | `ownerInUse.of = ...`                                                       |
| `src/runtime/resource.ts:1154` | `Object.defineProperty` on the prototypes of `UniformRoot` and `BufferRoot` |
| `src/runtime/resource.ts:1434` | `resourceProbes.push(...)`                                                  |
| `src/runtime/resource.ts:1443` | `resources.of = resourceOf`                                                 |
| `src/runtime/resource.ts:1467` | `resources.structs = ...`                                                   |

Fact: `src/compiler/ts` holds 234 active units of classes A, B, C and E, and none of class D or F. It has no registration.

### 7.3 Two counting rules

Fact: `bun scripts/move-purity.ts --clean-report` ran on `main` at `1a864657` on 2026-11-24. The two rules differ.

| Item                      | The analysis (`dc1df1fe`)                           | `--clean-report` (`1a864657`)                                                          |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Files read                | 617                                                 | 617                                                                                    |
| Top-level items read      | 11,927 statements                                   | 8,210 top-level units                                                                  |
| Rule for active           | Any call, `new`, `let` or non-declaration statement | Allow-list of syntax kinds (`scripts/move-purity/accepted-kinds.ts`); in doubt, active |
| Active units              | 638                                                 | 494                                                                                    |
| Files with an active unit | 223                                                 | 139                                                                                    |
| Files in a cycle          | 80 (emitted edges)                                  | 80 (value edges)                                                                       |
| Clean files               | not computed                                        | 418 of 617                                                                             |

Fact: the checker accepts `new WeakMap()`, `new Map` of literal entries and `Object.freeze` of a literal as evaluation-free.
The analysis counts them as active.
Inference: this is the main cause of the gap of 144 active units (638 and 494). It was not checked.
The two sets were not compared unit by unit, so no statement of inclusion holds.

Fact: 41 of the 123 non-test files of `scripts/file-size-baseline.json` are clean by the checker. They hold 36,054 lines.
Of the other 82, 34 are in a cycle and 48 have an active unit only. The plan lists the 41 files (decision D12).

## 8. Proposed module tree for `src/compiler/ts`

Proposal, not decided: group the 212 files (75,084 lines) into 11 modules and move the 16 test-support files out of the product tree.
Rule of the tree: a module imports only the modules above it in the list, and only through its `index.ts`.

```text
src/compiler/ts/
  wording/           10 files   2,076 lines  codes, diagnostic (with TsCompilerDiagnostic), removed, foreign, unknown and refused names, render-part, remedies
  syntax/            29 files   5,190 lines  helpers that read the syntax tree only
  types/             10 files   3,511 lines  type-map, optional, generics, inferred-origin, generic-structs, mixins
  analysis/          21 files   9,801 lines  abstract-const, lit-coerce, loop-bound, index-bound, numeric, narrowing, math
  scope/              5 files   2,765 lines  context, symbols, use-inference, written-context
  rules/             11 files   4,226 lines  semantic, stage-restrictions, kernel-loops, class-upcasts, builtin-check, definite, recursion, storage-access, sequence
  lower/             76 files  31,331 lines  expressions, statements, functions and class bodies
  declarations/      12 files   7,110 lines  module-const, module-vars, bindings, overrides, structs, entry-locations, program-refusals
  host-face/         14 files   4,625 lines  host-side faces and contracts
  link/               2 files   1,722 lines  linking of programs
  compile/            6 files   1,605 lines  compile, source-file, libm-source, index
  testing-support/   16 files   1,122 lines  moved out of the product tree
```

Fact: the 16 test-support files are `builtins-halves.ts`, `texture-dims-halves.ts`, `growing-load.ts`, the seven files of `growing-programs/`,
the four files of `issue-1261-differential/` and the two files of `remedy-lines/` (all in `src/compiler/ts/`).

Fact: file-level edges that go from a module to a module above it in the list (upward edges).
Today there are 159, of which 104 are type-only by syntax and 55 are emitted. After step 1 of section 9 there are 70, and all 55 emitted edges remain.

| From to (upward)             | Today | After step 1 |
| ---------------------------- | ----- | ------------ |
| `lower` to `compile`         | 50    | 0            |
| `declarations` to `compile`  | 11    | 0            |
| `rules` to `lower`           | 10    | 10           |
| `analysis` to `scope`        | 9     | 9            |
| `rules` to `compile`         | 9     | 1            |
| `lower` to `declarations`    | 9     | 9            |
| `syntax` to `types`          | 6     | 6            |
| `types` to `compile`         | 6     | 0            |
| `syntax` to `compile`        | 5     | 0            |
| `types` to `scope`           | 5     | 5            |
| `wording` to `compile`       | 4     | 0            |
| `types` to `analysis`        | 4     | 4            |
| `analysis` to `lower`        | 4     | 4            |
| `analysis` to `compile`      | 3     | 0            |
| `syntax` to `scope`          | 3     | 3            |
| Other pairs (16 pairs today) | 21    | 19           |
| Total                        | 159   | 70           |

Fact: the rows sum to 159 today and to 70 after step 1.
"After step 1" counts the 90 edges whose only symbol is `TsCompilerDiagnostic` as pointing to `diagnostic.ts` in `wording`.
Four edges to `compile` carry other symbols and stay: `rules` 1, `host-face` 2 and `link` 1.
The 16 other pairs have 2 edges each for `scope` to `declarations`, `scope` to `lower`, `rules` to `declarations`, `host-face` to `compile` and `link` to `compile`,
and 1 edge each for 11 more pairs. After step 1 the 21 edges become 19.

## 9. The first ten steps

Proposal: one pull request for each step. The largest cycle is shown after each step, for all imports and for emitted imports.
The sizes come from the simulation of section 2, step 10. They assume that a moved declaration does not depend on its old file.

| Step | Change                                                                                                                                                                                                                  | Kind                    | G0  | G1  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --- | --- |
| 0    | Baseline                                                                                                                                                                                                                |                         | 139 | 46  |
| 1    | Move `TsCompilerDiagnostic` from `source-file.ts` to `diagnostic.ts`. Leave `export type { TsCompilerDiagnostic } from './diagnostic.js'` in `source-file.ts`, so `abstract-const.ts` needs no edit while #1498 is open | mechanical              | 106 | 46  |
| 2    | Move the link types to a file `link-types.ts`                                                                                                                                                                           | mechanical              | 106 | 46  |
| 3    | Move the model types to files of their own: `CollectedStruct`, `PrivateField`, `RestrictedField`, `FieldInit`, `ClassFunction`, `Receiver`, `FunctionShape`, `VarSite`, `ExpandId`                                      | mechanical              | 54  | 46  |
| 4    | Move the pure name helpers of `module-const.ts` to `module-names.ts` (group D)                                                                                                                                          | mechanical              | 53  | 43  |
| 5    | Move the sentence builders to `unknown-names.ts` (group E)                                                                                                                                                              | mechanical              | 53  | 43  |
| 6    | Move the helpers of a parent file down into sibling files of `lower/` (group A)                                                                                                                                         | mechanical              | 49  | 40  |
| 7    | Move the class helpers into a class-model file. The registry state moves with `classFunctionOf` (group C)                                                                                                               | mechanical, state moves | 48  | 39  |
| 8    | Split `lowerLValue` out of `lower/statement.ts`                                                                                                                                                                         | design-light            | 48  | 32  |
| 9    | Add a port file for `lowerExpression` and `placeOf`, filled from a new `index.ts` of the module `lower` (group B). It turns an import cycle into a load-order rule                                                      | design                  | 39  | 9   |
| 10   | Move `AbstractConst` and `Carried` to a file `types.ts` in the directory `abstract-const`, after #1498 merges                                                                                                           | mechanical              | 39  | 9   |

Fact: steps 1 and 2 leave G1 at 46, so they do not shorten the cycle that the JavaScript sees. They shorten the type graph.
Step 9 is the only step that removes most of the emitted cycle.

Open: the sizes after step 10 are 39 (G0) and 9 (G1). The plan for the rest of the 9-file emitted cycle
(`abstract-const.ts`, `context.ts`, `type-map.ts` and `use-inference.ts`) is not drawn up.

## 10. Risks

Proposal, risks of the steps and of the tree:

1. A port file turns a cycle into a load-order rule (step 9). A module that fills the port must load before the first call.
   An import cycle fails visibly. A port that is not filled fails at the first call. A test or an assert must hold the rule.
2. Some moves carry module state (step 7). The registry that `classFunctionOf` reads is a class A unit.
   A pure move of a unit keeps its text. A second copy of the state is a behaviour change.
3. The import-boundary rule breaks direct imports into `src/compiler/ts` internals. This is not yet counted for tests, `scripts/` and `src/core/testing`.
   The non-test files of `src/` outside `src/compiler/ts` make 82 edges to 35 of its files, and none through `src/compiler/ts/index.ts`.
   Of the 82 edges, 63 come from `src/language-service`, 8 from `src/core`, 5 from `src/cli`, 4 from `src/index.ts` and 2 from `src/vite.ts`.
4. `context.ts`, `source-file.ts` and `abstract-const.ts` stay hubs. All three stay above 400 lines after steps 1 to 10.
   A hub is a design cost that no move of types removes.
5. The simulation assumes that a moved declaration does not depend on its old file. A declaration that does depend on it adds an edge back.
6. Pull requests #1493 and #1498 edit `abstract-const.ts`. Step 10 waits for them (plan, section 7.1).

## 11. Limits of the measurement

- One commit, `dc1df1fe`. The tree changed after it. The tool of section 7.3 gives the numbers of `1a864657` for its own rule only.
- File-level edges only. A symbol-level cycle can exist inside a file and is not seen.
- The feedback-edge sets are heuristic. A smaller set may exist.
- The classes use the type checker over a program without the package settings of the repository.
  The check against the real emit found 0 mismatches, so the classes hold for this tree.
- Test files are not in the graph. Their imports into `src/compiler/ts` are not counted.
- A dynamic `import()` is not an edge. Packages are not in the graph.
- The proposed module of each file comes from a name pattern, not from a read of each file.
  A file that matches no pattern would fail the measurement, and none did.
- The simulation moves symbols in a model of the graph. It does not compile the result.
- The load-time classes read the syntax tree. A load-time effect through a call into another module is class E and was not read unit by unit.
