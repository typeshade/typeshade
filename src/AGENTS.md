<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-03 | Updated: 2026-09-28 -->

# src

## Purpose

All source of the `typeshade` package. Two layers share one IR. The `"use typeshade"` front end
(`compiler/ts/`) lowers an ordinary TypeScript file into that IR; `core/` holds the IR, the
lower-level EDSL (`fn`, `Let` / `Var`, `If` / `Switch`, `.assign()`), the one neutral emit walk,
the WGSL and GLSL ES 3.00 writers, the CPU f64 oracle, the pass pipeline and the layout layer.
Concrete shaders live in `examples/` and in consuming projects, never here.

## Entry points

Every file below but the last is a `package.json` `exports` subpath, and every one of those but
`runtime.ts` is public API: `API_SUBPATHS` in `api-subpaths.ts`, the one list that
`api-doc-coverage.test.ts` and `api-surface.test.ts` both read. `__api__/surface.md` lists every
symbol the API subpaths export; it is generated (`bun run bake:api-surface`) and
`api-surface.test.ts` fails when it and the tree disagree.

| File                  | Subpath                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | `.`: `compile()` and the source compiler, the EDSL, the emitters, `reflect`, `validate`. The only surface most consumers need.                                                      |
| `dev.ts`              | `./dev`: lint, `diagnose()` / `formatReport()`, source tracing, optimizer measurement. Dev-time only.                                                                               |
| `debug.ts`            | `./debug`: stepping one invocation on the CPU (`startDebugSession`), for IDE adapters and the Playground (`docs/debugging.md`).                                                     |
| `compute.ts`          | `./compute`: `createComputeRunner`, one dispatch for a `portable: true` kernel across WebGPU, WebGL2 and the CPU.                                                                   |
| `emit-prod.ts`        | `./emit-prod`: ship-time text plugins (`obfuscate`, minify, type aliasing) and `decodeShaderLog` to map a driver error back.                                                        |
| `vite.ts`             | `./vite`: `typeshade()`, the Vite plugin a host project imports a `.shade.ts` through (surface §64), with its `console` option (`TypeshadeViteOptions`), and `TypeshadeVitePlugin`. |
| `runtime.ts`          | `./runtime`: the program runtime (change 0025, Rule 11.11), `createRuntime` and its types, over `runtime/`; no compiler in its closure.                                             |
| `runtime-internal.ts` | `./runtime/internal`: not API. What a module the plugin generates imports (the CPU tier's runtime and the host-value checks).                                                       |
| `runtime/`            | The program runtime: `runtime.ts` (device, frames, submit, console), `program.ts` (pipelines, layouts, binding by name), `resources.ts`, `gpu.ts`.                                  |
| `language-service/`   | `./language-service`: the editor-neutral, document-based service (`createTypeshadeLanguageService`) and `SHADE_DTS`.                                                                |
| `core/ir/index.ts`    | `./core/ir`: the IR barrel. The one piece of `core/` that is published; everything else under `core/` is private.                                                                   |
| `language-service.ts` | Not a subpath: a compatibility adapter keeping the older string-based `TypeshadeLanguageService` API over the real service.                                                         |

## Key directories

### `compiler/ts/`: the `"use typeshade"` front end

| File                          | What it is                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compiler/ts/compile.ts`      | `compile()`: front end, then both emitters and the oracle. Shader text exists only when no error diagnostic was raised.                                                                                                                                                     |
| `compiler/ts/source-file.ts`  | `compileTsSource`: one file to IR, and a file that imports through the linker. Imports `typescript` at module scope, which is why it is a required peer.                                                                                                                    |
| `compiler/ts/link.ts`         | `linkProgram` (Rule 3.9): a file and the shader files it imports, linked into one source the front end lowers, with each position mapped back to its file.                                                                                                                  |
| `compiler/ts/specifier.ts`    | The one rule a specifier resolves by, for the compiler and the language service.                                                                                                                                                                                            |
| `compiler/ts/module.ts`       | `compileTsSources`: the in-tree form that takes a program's files as a list and keeps each one whole.                                                                                                                                                                       |
| `compiler/ts/lower/`          | Statement, expression, call and function lowering (`function.ts` runs signatures, then bodies).                                                                                                                                                                             |
| `compiler/ts/semantic.ts`     | Refuses host control flow once per node; resolves `new` targets and names nothing declares by declaration, not spelling (Rule 2.1); refuses a declaration that binds `eval` or `arguments`, as strict mode does, and an `import()` or `require()` the linker cannot follow. |
| `compiler/ts/codes.ts`        | The `TS8nnn` diagnostic codes. Numbers are never reused.                                                                                                                                                                                                                    |
| `compiler/ts/semicolons.ts`   | The shader-source `;` inserter behind `bun run format:semicolons`.                                                                                                                                                                                                          |
| `compiler/ts/host-face.ts`    | The host face of a module (Rules 8.20, 8.21, 8.24): the exports a host can call, the host view `tsc` reads, and the generated module, with each callable entry's WGSL and binding layouts.                                                                                  |
| `compiler/ts/kernel-loops.ts` | `TS8070`: a kernel function's refused loop, worded in the author's names and lines from the proof's facts (Rule 8.22).                                                                                                                                                      |

### `core/`: IR, emit and backends

| File                                          | What it is                                                                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/ir/types.ts`, `core/ir/nodes.ts`        | `ShaderType` and the typed constants; the `Expr` / `Stmt` unions and the module declarations (`ConstDecl`, `StructDecl`, `FuncDecl`, …).                                                                          |
| `core/ir/node.ts`, `core/ir/builder.ts`       | `Node<K>` (chaining operators, `.assign()`) and `ReadonlyNode<K>`; the `Builder`, `fn` / `externFn` / `module`, `constExpr`, `Let` / `Var`.                                                                       |
| `core/ir/visit.ts`                            | One walker per operation over the closed `Expr` / `Stmt` unions, so a new node kind reaches every pass.                                                                                                           |
| `core/emit.ts`                                | The one neutral tree walk, and `lowerForBackend`, the shared pre-emit pipeline (below).                                                                                                                           |
| `core/backend.ts`                             | The `Backend` contract: type / literal / intrinsic spelling, the divergent fragments, capabilities, `UnsupportedFeatureError`.                                                                                    |
| `core/intrinsics.ts`                          | Neutral intrinsic ids mapped to each target's spelling. Only divergent intrinsics need an entry.                                                                                                                  |
| `core/backends/wgsl.ts`                       | The WGSL backend and `emitModule`. `wgsl-ptr.ts` spells `inout` parameters as pointers.                                                                                                                           |
| `core/backends/glsl.ts`                       | The GLSL ES 3.00 backend (`emitGlslModule`, `emitGlslStages`): std140 UBOs, entry IO as varyings, storage as data textures, WGSL's integer answers (`glsl-int.ts`, Rule 11.12).                                   |
| `core/oracle.ts`, `core/cpu-codegen.ts`       | The CPU f64 tree-walk interpreter and its `new Function` twin, both over the one op library in `core/cpu-runtime.ts`.                                                                                             |
| `core/cpu-codegen-runtime.ts`                 | The runtime object the generated CPU code closes over (the factory's `$`), apart from the generator, so a module the host imports ships it alone.                                                                 |
| `core/host-values.ts`, `core/host-runtime.ts` | The host-value boundary of a host call (Rule 8.21), and what a generated host module imports (Rule 11.7).                                                                                                         |
| `core/host-entry.ts`                          | A `@compute` entry called from host code (Rule 8.24): packing by the layouts the plugin writes, the WebGPU dispatch and readback, the CPU-tier dispatch, and the `_console` readback where the plugin records it. |
| `core/host-compute.ts`                        | A `@compute` entry's call (Rules 8.24 and 11.8): it runs in the call queue, on the tiers `configure` orders, with a `Resident` bound as its device buffer.                                                        |
| `core/host-draw.ts`                           | A full-screen `@fragment` entry drawn from host code (Rule 8.24): the canvas's tier, WebGPU, WebGL2 (framebuffer and flipped copy) and the CPU pixel loop.                                                        |
| `core/host-kernel.ts`                         | A kernel function called from host code (Rule 8.21): the length check, one WebGPU dispatch per loop with in-place readback, the fold of a reduction's partials level by level, and the CPU tier.                  |
| `core/console-print.ts`                       | The printed console line (surface §66): the tier, the file and line and the invocation before an event's arguments, for both tiers of the call layer and the program runtime.                                     |
| `core/kernel-tree.ts`                         | The tree order a kernel function's reduction is combined in on every tier (Rule 7.2): `kernelTree`, which the CPU backends call, and each operator's identity.                                                    |
| `core/resident.ts`                            | `resident`, `Resident` and `configure` (Rule 11.8): a host value kept on the device across kernel and entry calls and the program runtime's bindings, the order the calls run in, and the order of the tiers.     |
| `core/host-kernel-gl.ts`                      | A kernel function's loops on WebGL2 (Rule 11.8): the runtime's own context, one fragment program per loop into an `R32UI` target, the data textures and the readback.                                             |
| `core/reflect.ts`, `core/sot.ts`              | Pipeline reflection (bind groups, std140 / std430 layouts, entry IO); declare-once IO structs and resources.                                                                                                      |
| `core/manifest.ts`                            | The compiled program's manifest (Rule 11.10): `buildManifest`, which `packModule` and the generated module's default export call, from the IR alone.                                                              |
| `core/vertex-layout.ts`                       | The vertex buffer a `@vertex` entry reads (Rule 6.8), tightly packed, which `reflect()` and the manifest share.                                                                                                   |
| `core/diagnostics/`                           | `codes.ts` (frozen `SDnnnn` catalogue), `error.ts` (`TypeShadeError`), `loc.ts` (opt-in source tracing), `report.ts` (`diagnose()`).                                                                              |
| `core/fp64/`                                  | The df64 emulation library (float and integer flavors) that `core/passes/fp64-lower.ts` rewrites `f64` into.                                                                                                      |
| `core/builtins/`                              | Tint's overload table baked from `core.def` (`coredef.ts`), the claim on each row (`overlay.ts`), and the row types both halves read (0017).                                                                      |
| `core/debug/`                                 | The stepping interpreter (`interp.ts`), sessions, launch config, watch expressions, lockstep workgroup dispatch.                                                                                                  |
| `core/compute/runner.ts`                      | The engine behind `./compute`.                                                                                                                                                                                    |
| `core/testing/`                               | Test utilities only: seeded random IR and kernel functions (exact ones for the GPU differential), a kernel plan (`kernel-plan.ts`), a function drawn on WebGL2 (`draw-harness.ts`), span stamping and stripping.  |

Most other `core/*.ts` files are the production-emit and host-integration layer:
`emit-minify.ts`, `emit-alias.ts`, `shader-lex.ts`, `decode-log.ts`, `emit-prune.ts`,
`emit-identity.ts`, `fragment.ts` (declarations without a stage wrapper), `registry.ts`,
`variant-family.ts`, `variant-link.ts`, `semantic-diff.ts` and `measure.ts`.

### `core/passes/`

| Path                                  | What it is                                                                                                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/passes/validate.ts`             | `validate()` throws `ValidationError` on the first `CORE_RULES` error at every emit; `lintModule()` runs the full `RULES`.                                                                                                                                                       |
| `core/passes/lint/`                   | The lint engine (one registry, one traversal), `presets.ts`, and `rules/`, one rule per file.                                                                                                                                                                                    |
| `core/passes/required-caps.ts`        | `requiredCaps` / `assertCaps`: the fail-closed capability gate.                                                                                                                                                                                                                  |
| `core/passes/match-lower.ts`          | `lowerModule`: each `matchExpr` becomes a hoisted `var` plus a `switch`, so the emit walk never sees one.                                                                                                                                                                        |
| `core/passes/fp64-lower.ts`           | The single authority for `f64` semantics: `f64` IR to `vec2<f32>` and `df64_*` calls.                                                                                                                                                                                            |
| `core/passes/console-buffer.ts`       | Under `compile(src, { console: 'gpu' })`, rewrites each recorded `console` call into writes to the `_console` storage buffer (Rule 6.11, surface §66).                                                                                                                           |
| `core/passes/parallel-loop.ts`        | `proveKernels`: the independence proof of a kernel function's loops (Rule 8.22), R1 to R6, as facts in IR names.                                                                                                                                                                 |
| `core/passes/kernel-lower.ts`         | `lowerKernel`: a kernel function whose loops the proof accepts, lowered to one `@compute` entry per loop, a workgroup tree and a fold entry for a loop that reduces, an atomic for a scatter, a range function the call runs first and a tail that gives the result (Rule 8.22). |
| `core/passes/access.ts`               | How each builtin uses each argument (a value, the length `arrayLength` measures, an atomic's place, the texture `textureStore` writes), and `eachOperand`, which hands an analysis the operands of one expression with that access (#348).                                       |
| `core/passes/const-expr.ts`           | `settleConstExprs`: a constant expression WGSL would refuse to evaluate (a zero divisor, a shift past 31, an overflow, crossed `clamp` bounds) given its value at run time, after every optimizer tier (#368).                                                                   |
| `core/passes/opt/`                    | `autoVars`, `cse`, and the `optimize` fixpoint (const / copy propagation, folding, dead branches, LICM, DCE). `expr-utils.ts` is the shared traversal.                                                                                                                           |
| `core/passes/compose.ts`              | `composeModule(base, swaps)`: swaps tagged `placeholder` statements. Strict by default.                                                                                                                                                                                          |
| `core/passes/mangle.ts`, `inline*.ts` | Identifier mangling for `obfuscate`; function inlining.                                                                                                                                                                                                                          |

### `core/spec-conformance/`

Test-only. It checks the compiler against outside authorities instead of lists this repository
maintains. `fixtures/*.json` are generated from Tint's `core.def` (`bun run bake:coredef`) and the
WGSL spec's names (`bun run bake:wgsl-names`); never hand-edit them.
`coredef-texture-overloads.test.ts` makes every texture overload supported or deferred with a
reason, `stage-rules.test.ts` checks the stage-restricted builtin sets (read from
`compiler/ts/lower/function.ts` and `core/passes/lint/rules/fragment-only-builtin.ts`),
`surface-names.test.ts` holds every author-facing name to WGSL, ECMAScript or the extension
table of `docs/language-design.md` §9, and `argument-access.test.ts` holds
`core/passes/access.ts` to every `core.def` overload TypeShade takes.

## For AI Agents

### Working in this directory

- **One IR, three backends, one walk.** Control flow is emitted once, in `core/emit.ts`; a
  backend supplies spelling and the divergent fragments (`core/backend.ts`). A new target
  implements `Backend`; it never forks the walk. A new divergent intrinsic is one entry in
  `core/intrinsics.ts`.
- **What an operation reads and writes is one table.** An analysis that walks an expression's
  operands asks `eachOperand` in `core/passes/access.ts`, and never tests a builtin's name for
  what it does with an argument (`arrayLength` measures its array and reads no element; an
  atomic's first argument is a place). Three analyses each learned `arrayLength` on their own,
  and the fourth, which had not, kept a correct loop off the GPU (#345). A new builtin that takes
  a pointer gets its row there, or `argument-access.test.ts` fails.
- **The pre-emit pipeline is shared.** `lowerForBackend` runs `validate`, `assertCaps`,
  `assertBuiltins`, then `autoVars`, `lowerModule`, `fp64Lower`, `selectComposite`, the
  backend's own lowerings, its `optimize` at any tier, and `settleConstExprs`, which gives a
  constant expression the target would refuse to evaluate its value at run time (#368). Put a
  target-neutral rewrite there, not in a backend.
- **Mutability is a type split.** Produced values and `Var` are `Node` (has `.assign`); a `Let`,
  a parameter and a module constant are `ReadonlyNode`, so assigning one is a `tsc` error. The
  runtime is one class, so emit is unaffected. `autoVars` turns `const x = expr; x.assign(…)`
  into a real `var` on every backend.
- **Never unify a constant's two values.** `ConstDecl.wgslValue` is the shader literal,
  `cpuValue` the full-precision one the oracle uses. A vec / array / struct constant sets
  `valueExpr` instead (author it with `constExpr`), and it wins on every backend.
- **The oracle is an f64 algebra oracle.** It does not see f32 rounding (`core/passes/precision.ts`
  is the f32 mode). `raw` and un-swapped `placeholder` statements throw there.
- **`raw` statements are GPU-only and paired per target.** GLSL emits the `glsl` payload and
  throws `UnsupportedFeatureError` when it is missing. An un-swapped `placeholder` is a comment
  in WGSL and a throw in GLSL; run `composeModule` first.
- **`matchExpr` never reaches `emitExpr`.** `lowerModule` hoists it; a leak throws.
- **Source locations are a side table.** `core/diagnostics/loc.ts` keys a `WeakMap` by node
  identity, so emit is unchanged and tracing is off by default. Lowering rebuilds nodes, so call
  `getLoc` only on the authored module.
- **Authoring surface changes follow `docs/language-design.md`.** A name an author can write
  comes from WGSL, ECMAScript or the §9 extension table; cite the rule in the pull request.
- **Publishing.** `core/` stays private apart from `core/ir`. A new export changes
  `__api__/surface.md`: re-bake with `bun run bake:api-surface` and commit the diff.

### Testing requirements

- Tests are co-located (`*.test.ts` beside the file). Examples and their emit goldens
  (`examples/__emit-goldens__/`) are tested from `examples/`.
- `bun run test`: the vitest suite over `src/**` and `examples/**`.
- `bun run build`: the type check, including the `@ts-expect-error` probes in the
  `core/ir/*.test.ts` files; a stale directive fails it.
- `bun run gate:compile`: every registered example compiled by Tint and a WebGL2 context, and
  every entry of the `.shade.ts` examples called on each tier. Run it for any change to emitted
  text or to the runtime.
- `bun run gate:journeys` (after `build`): the packed tarball checked the way a user meets it.
- After writing shader source, `bun run format:semicolons`; before pushing, `bun run lint` and
  `bun run format:check`.

<!-- MANUAL: notes below this line are preserved on regeneration -->
