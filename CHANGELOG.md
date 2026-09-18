# Changelog

All notable changes to `typeshade` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts where TypeShade was separated from the X-GIS monorepo. Everything before that
— the IR, the three backends, the pass pipeline, and the breaking changes that shaped them — is
in [`docs/HISTORY.md`](docs/HISTORY.md), kept as its generator produced it. Nothing in this
repository has been published to npm; **`0.1.0` will be the first release**.

## [Unreleased]

### Added

- **A plain top-level `let` is a per-invocation variable** (§24, from the review of #82):
  `let seed: u32 = 7` emits `var<private> seed: u32 = 7u;`, a plain global on GLSL ES 3.00, and
  starts over at every host-facing call on the CPU, exactly as `perInvocation<u32>` does. That
  wrapper stays as the explicit spelling and `workgroup<T>` stays required, since workgroup
  memory has no TypeScript counterpart. Without an annotation the type is the initializer's by
  the `const` rule. For both spellings an array takes a list and a struct an object literal as a
  constant initializer, and a math builtin over constants counts as one (#73). A `let` with
  neither type nor initializer, a resource type without `declare`, and a list without an array
  type are TS8033 with the fix. Before this a plain top-level `let` was TS8014.
- **Barriers and `dispatch`** (roadmap 0.2 item 5, design #82, step 2): `workgroupBarrier()`
  and `storageBarrier()` as statements, in a compute entry or a helper and never inside an
  `if` or `switch` body (TS8034 with the reason), emitted bare on WGSL and treated as effects
  by the optimizer. `compileModule(m).dispatch(entry, workgroups)` and the codegen's twin run a
  `@compute` entry over the workgroups of its declared size with every invocation of a
  workgroup in lockstep at each barrier, the compute builtins filled in, workgroup memory zero
  per workgroup and per-invocation variables at their initializers; a workgroup whose
  invocations disagree about a barrier is an error naming the line and the counts. A direct
  `fns` call or a debug session on a kernel with a barrier names `dispatch`. The `workgroup-reduce` example sums
  64 values through workgroup memory, WGSL-only.
- **Module variables** (roadmap 0.2 item 5, design #82): `let tile: workgroup<array<f32, 64>>`
  is WGSL's `var<workgroup>`, memory one workgroup's invocations share, zero at the start of
  each workgroup; `let seed: perInvocation<u32> = 7` is WGSL's `var<private>`, a value each
  invocation owns for its run, at its constant initializer. The name is not `private<T>`
  because TypeScript reserves the word. A `workgroup` array may hold atomics and the §23
  builtins take the location. GLSL ES 3.00 spells a per-invocation variable as a plain global
  and has no form for workgroup memory. The IR gains `ModuleDecl.vars` (`ModuleVarDecl`), which
  `reflect()` does not report; the effect table counts a write to one; the oracle, codegen and
  debugger hold per-invocation storage that starts over at every host-facing call and one
  implicit workgroup's memory for the module's lifetime. A `const` with a wrapper, a
  `workgroup` initializer, a type the space cannot hold, a non-constant initializer or
  workgroup memory read from a vertex or fragment entry is TS8033 with the fix. Barriers and
  the lockstep dispatch are the entry above.
- **Atomics** (roadmap 0.2 item 4): `atomic<u32>` and `atomic<i32>` inside a `let` storage
  binding (an array element, a storage struct field, a bare binding), and the ten builtins
  `atomicLoad`, `atomicStore`, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`,
  `atomicOr`, `atomicXor` and `atomicExchange`. The location is written as the plain expression
  and WGSL receives the pointer, `atomicAdd(&bins[i], 1u)`; a read-modify-write returns the
  value the location held before. A plain read or assignment of an atomic, a `const` binding,
  a wrong value type or an atomic declared outside storage is refused with the fix. The
  optimizer treats every atomic builtin as an effect and the effect table counts an atomic
  write as a write to its binding; the CPU oracle, codegen and debugger run atomics as
  in-order reads and writes. GLSL ES 3.00 has none, so such a module emits WGSL alone; the
  `atomic-histogram` example is WGSL-only. The IR gains the `atomic` type kind, `atomicU32T`,
  `atomicI32T`, `ATOMIC_INTRINSICS` and `isAtomicIntrinsic` on the public barrel.
- **`arrayLength`** (#46): `xs.length` on a runtime-sized storage array, and the explicit
  `arrayLength(xs)`, read the bound buffer's length at run time as WGSL `arrayLength(&xs)`, a
  `u32`. The operand is the binding or a trailing array field of a storage struct; an element,
  a sized array or an array outside storage is refused with the fix that applies. The CPU
  oracle reads the bound array's length. GLSL ES 3.00 has no form, and the `array-length`
  example is WGSL-only.
- **A call as a statement** in `"use typeshade"` (#47): `store(gid.x)` with its result dropped
  lowers to the IR's new `call` statement, which WGSL spells bare for a user function and
  behind `_ = ` for a value-returning builtin, GLSL ES 3.00 spells bare, and the CPU oracle,
  codegen and debugger run for its effect. The optimizer gains an effect table
  (`passes/effects.ts`): a call to a function that writes a binding is never deduplicated,
  hoisted or dropped, and a read of that binding is never shared across it. The EDSL gets
  `Call(node)` for the same statement.
- The **`"use typeshade"` compiler surface**: a TypeScript source file opts in with the
  file-level directive and is compiled by `compile()` into the shared IR, then emitted as WGSL
  and GLSL ES 3.00. `compile`, `compileTsSource`, `isTypeshadeSource` and the directive helpers
  are on the public barrel.
- The **language service** (`typeshade/language-service`): diagnostics, completions, hover,
  definition, references, document symbols, signature help, rename, semantic tokens and
  compiled output, over a document store, with the ambient declarations the TypeScript program
  is checked against derived from the compiler's own tables.
- Vector-against-scalar **broadcast** in `"use typeshade"` arithmetic, and the surface-B
  authoring ergonomics (compound assignment, scalar-cast methods, free arithmetic functions).
- The **`.shade.ts` example corpus**, wired into the registry, the tests and the compile gate,
  each paired with the `fn()` example it mirrors and pinned by a twin diff.
- **`src/__api__/surface.md`**, a committed snapshot of every public export and its shape, with
  `bun run bake:api-surface` to re-bake it. A public-surface change cannot land without
  appearing in a diff.
- The package ships **built output**. `tsc --build` emits `dist/src/…`, `dist/examples/…` and
  `dist/shade.d.ts`; the manifest inside the npm tarball is derived from the repository's own
  `exports` map by `scripts/publish-manifest.ts` and points every subpath at it. In this
  repository, and for a git-submodule consumer, `exports` still resolves to `./src/*.ts`.
- **`typeshade/shade`**, a types-only subpath resolving to `dist/shade.d.ts`. It is the ambient
  authoring declarations, written out of `SHADE_DTS` at build time, so a `tsc` user outside the
  language service can put `"types": ["typeshade/shade"]` in a `lib: []` project. README has
  what it covers and what it does not.
- **Releases are cut by creating a GitHub release.** `.github/workflows/publish.yml` re-runs
  CI, builds, checks the tag against `package.json`, proves the packed tarball installs and
  imports, and publishes with provenance. [`RELEASING.md`](RELEASING.md) is the checklist.

### Changed

- **The package is `typeshade`.** It was `@xgis/shader-dsl`, a workspace of the X-GIS monorepo,
  which was never published to npm. Every `Exported from …` JSDoc line, every documentation and
  example import, and the subpaths (`typeshade/dev`, `typeshade/debug`, `typeshade/compute`,
  `typeshade/emit-prod`, `typeshade/core/ir`, `typeshade/language-service`) move with it.
- **`XGIS_SHADER_DSL_TRACE` is now `TYPESHADE_TRACE`.** No alias — nothing is published yet.
- The copyright line of `LICENSE` and `package.json`'s `author` name the owner,
  `Seungup Noh <seungup.noh@gmail.com>`, rather than X-GIS.
- Every comment reference to an X-GIS issue or pull request reads `(X-GIS #1234)`, so it cannot
  be mistaken for an issue in this repository.
- The generated monorepo-era changelog moved to `docs/HISTORY.md`; this file replaces it.
- **`ShaderDslError` is now `TypeShadeError`.** `ShaderDslError` stays exported as a
  `@deprecated` alias of the same class, so `instanceof` keeps working; what it cannot preserve
  is `error.name`, which reads `TypeShadeError` on every instance.
- **Error messages are prefixed `typeshade`, not `shader-dsl`** — the coded head
  `typeshade [SD0002]: …` from `formatMessage`, and the uncoded `typeshade: …` /
  `typeshade/cpu: …` throws. The `SD####` codes themselves are unchanged: they are documented
  and tested everywhere, and a new letter pair would collide with TypeScript's `TS####`.
- The cross-instance registry keys are `Symbol.for('typeshade.*')` rather than
  `Symbol.for('xgis.shader-dsl.*')`, and the GLSL compute-emulation path injects a fragment
  position parameter named `typeshade_frag_pos`.

### Fixed

- **A multi-file program's module variables reached the WGSL.** `compileTsSources` took the
  bare-functions emit whenever the entry had no module constant, so an entry with a
  per-invocation or workgroup variable and no `const` emitted functions that read a variable
  the text never declared. It now emits the module form when either exists. A top-level `let`
  in a file that is not the entry is TS8014 with where the declaration goes, instead of
  vanishing (roadmap item 14 carries the other files' declarations).
- **A call that returns nothing cannot initialize a local**: `const x = store(1)` emitted
  `let x = store(1u);`, which Tint refuses, with no diagnostic; it is TS8003 now with "call it
  on its own line".
- **Block scope reaches the IR** (#38): two sequential `for (let i ...)` loops, a `p` in a loop
  body beside a `p` in an `if` arm, and an inner `p` that shadows an outer one or a parameter
  all lower now. The second and later declarations of a name in one function take the IR name
  `i_1`, `p_1`, and so on; the first keeps the source name, resolution is unchanged, and
  diagnostics and the symbol table keep the author's spelling. Before, both bindings took one
  name and the emit refused the module with `SD0112` at line 1.
- **A shift by 32 or more is refused** (#71): `x >> 33`, `x >> (16 + 16)` and `x <<= 32` are
  TS8003 with the amount they fold to. They compiled clean and emitted `33u` for Tint to refuse,
  while GLSL ES 3.00 left the result undefined.
- **Division by a constant zero is refused wherever it is lowered** (#68): in a function body, in
  a compound `/=` or `%=`, and in a module const, with the divisor named. The proof is
  componentwise and follows negation, vector arithmetic and a vector const's initializer, the
  three shapes the earlier check in the const collector missed. A parameter that repeats a module
  const's name is TS8023 on the parameter, where it threw out of `compileTsSource` before. A
  vector module const's placeholder `cpuValue` no longer reads as the value 0 in a function's
  scope.
- **A float `%=` reaches GLSL ES 3.00 as `floatMod`** (#20): `x %= 0.7` is written
  `x = (x - 0.7 * trunc(x / 0.7));`, the spelling the binary `%` already took. The compound
  assignment wrote `x %= 0.7;`, which GLSL refuses for floats; WGSL is unchanged.
- **`typescript` is a required peer dependency** (`>=5.0.0 <6`), not an optional one.
  `src/index.ts` re-exports `compile` from a module that imports `typescript` at module scope,
  so `import { emitModule } from 'typeshade'` failed with `ERR_MODULE_NOT_FOUND` on a clean
  install. The upper bound is measured: unbounded, npm resolved TypeScript 7.0.2, whose default
  export carries no `SyntaxKind`, and the package threw at module load. No source changed: the
  manifest was describing the package wrongly.
- f64 vector constructors compose and validate their element types, and the canonical
  `vecNf64` type names resolve.

### Removed

- `scripts/monorepo-context.ts` and the test arms that asked which tree the package was being
  built in. There is one tree now.
