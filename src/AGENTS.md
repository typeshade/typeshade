<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-03 | Updated: 2026-09-23 -->

# src

## Purpose

All source of the `typeshade` package. Two layers share one IR. The `"use typeshade"` front end
(`compiler/ts/`) lowers an ordinary TypeScript file into that IR; `core/` holds the IR, the
lower-level EDSL (`fn`, `Let` / `Var`, `If` / `Switch`, `.assign()`), the one neutral emit walk,
the WGSL and GLSL ES 3.00 writers, the CPU f64 oracle, the pass pipeline and the layout layer.
Concrete shaders live in `examples/` and in consuming projects, never here.

## Entry points

Every file below but the last is a `package.json` `exports` subpath. `__api__/surface.md` lists every symbol
they export; it is generated (`bun run bake:api-surface`) and `api-surface.test.ts` fails when it
and the tree disagree.

| File                  | Subpath                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | `.`: `compile()` and the source compiler, the EDSL, the emitters, `reflect`, `validate`. The only surface most consumers need.              |
| `dev.ts`              | `./dev`: lint, `diagnose()` / `formatReport()`, source tracing, optimizer measurement. Dev-time only.                                       |
| `debug.ts`            | `./debug`: stepping one invocation on the CPU (`startDebugSession`), for IDE adapters and the Playground (`docs/debugging.md`).             |
| `compute.ts`          | `./compute`: `createComputeRunner`, one dispatch for a `portable: true` kernel across WebGPU, WebGL2 and the CPU.                           |
| `emit-prod.ts`        | `./emit-prod`: ship-time text plugins (`obfuscate`, minify, type aliasing) and `decodeShaderLog` to map a driver error back.                |
| `vite.ts`             | `./vite`: `typeshade()`, the Vite plugin a host project imports a `.shade.ts` through (surface §64), and `TypeshadeVitePlugin`.             |
| `runtime.ts`          | `./runtime`: not API. What a module the plugin generates imports (the CPU tier's runtime and the host-value checks), and nothing else does. |
| `language-service/`   | `./language-service`: the editor-neutral, document-based service (`createTypeshadeLanguageService`) and `SHADE_DTS`.                        |
| `core/ir/index.ts`    | `./core/ir`: the IR barrel. The one piece of `core/` that is published; everything else under `core/` is private.                           |
| `language-service.ts` | Not a subpath: a compatibility adapter keeping the older string-based `TypeshadeLanguageService` API over the real service.                 |

## Key directories

### `compiler/ts/`: the `"use typeshade"` front end

| File                         | What it is                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compiler/ts/compile.ts`     | `compile()`: front end, then both emitters and the oracle. Shader text exists only when no error diagnostic was raised.                                                                    |
| `compiler/ts/source-file.ts` | `compileTsSource`: one file to IR. Imports `typescript` at module scope, which is why it is a required peer.                                                                               |
| `compiler/ts/module.ts`      | `compileTsSources`: a multi-file program joined by relative imports.                                                                                                                       |
| `compiler/ts/lower/`         | Statement, expression, call and function lowering (`function.ts` runs signatures, then bodies).                                                                                            |
| `compiler/ts/semantic.ts`    | Refuses host / JavaScript surface inside a `"use typeshade"` file.                                                                                                                         |
| `compiler/ts/codes.ts`       | The `TS8nnn` diagnostic codes. Numbers are never reused.                                                                                                                                   |
| `compiler/ts/semicolons.ts`  | The shader-source `;` inserter behind `bun run format:semicolons`.                                                                                                                         |
| `compiler/ts/host-face.ts`   | The host face of a module (Rules 8.20, 8.21, 8.24): the exports a host can call, the host view `tsc` reads, and the generated module, with each callable entry's WGSL and binding layouts. |

### `core/`: IR, emit and backends

| File                                          | What it is                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/ir/types.ts`, `core/ir/nodes.ts`        | `ShaderType` and the typed constants; the `Expr` / `Stmt` unions and the module declarations (`ConstDecl`, `StructDecl`, `FuncDecl`, …).                     |
| `core/ir/node.ts`, `core/ir/builder.ts`       | `Node<K>` (chaining operators, `.assign()`) and `ReadonlyNode<K>`; the `Builder`, `fn` / `externFn` / `module`, `constExpr`, `Let` / `Var`.                  |
| `core/ir/visit.ts`                            | One walker per operation over the closed `Expr` / `Stmt` unions, so a new node kind reaches every pass.                                                      |
| `core/emit.ts`                                | The one neutral tree walk, and `lowerForBackend`, the shared pre-emit pipeline (below).                                                                      |
| `core/backend.ts`                             | The `Backend` contract: type / literal / intrinsic spelling, the divergent fragments, capabilities, `UnsupportedFeatureError`.                               |
| `core/intrinsics.ts`                          | Neutral intrinsic ids mapped to each target's spelling. Only divergent intrinsics need an entry.                                                             |
| `core/backends/wgsl.ts`                       | The WGSL backend and `emitModule`. `wgsl-ptr.ts` spells `inout` parameters as pointers.                                                                      |
| `core/backends/glsl.ts`                       | The GLSL ES 3.00 backend (`emitGlslModule`, `emitGlslStages`): std140 UBOs, entry IO as varyings, storage as data textures.                                  |
| `core/oracle.ts`, `core/cpu-codegen.ts`       | The CPU f64 tree-walk interpreter and its `new Function` twin, both over the one op library in `core/cpu-runtime.ts`.                                        |
| `core/cpu-codegen-runtime.ts`                 | The runtime object the generated CPU code closes over (the factory's `$`), apart from the generator, so a module the host imports ships it alone.            |
| `core/host-values.ts`, `core/host-runtime.ts` | The host-value boundary of a host call (Rule 8.21), and what a generated host module imports (Rule 11.7).                                                    |
| `core/host-entry.ts`                          | A `@compute` entry called from host code (Rule 8.24): packing by the layouts the plugin writes, the WebGPU dispatch and readback, and the CPU-tier dispatch. |
| `core/host-draw.ts`                           | A full-screen `@fragment` entry drawn from host code (Rule 8.24): the canvas's tier, WebGPU, WebGL2 (framebuffer and flipped copy) and the CPU pixel loop.   |
| `core/reflect.ts`, `core/sot.ts`              | Pipeline reflection (bind groups, std140 / std430 layouts, entry IO); declare-once IO structs and resources.                                                 |
| `core/diagnostics/`                           | `codes.ts` (frozen `SDnnnn` catalogue), `error.ts` (`TypeShadeError`), `loc.ts` (opt-in source tracing), `report.ts` (`diagnose()`).                         |
| `core/fp64/`                                  | The df64 emulation library (float and integer flavors) that `core/passes/fp64-lower.ts` rewrites `f64` into.                                                 |
| `core/debug/`                                 | The stepping interpreter (`interp.ts`), sessions, launch config, watch expressions, lockstep workgroup dispatch.                                             |
| `core/compute/runner.ts`                      | The engine behind `./compute`.                                                                                                                               |
| `core/testing/`                               | Test utilities only: a seeded random-IR generator and span stamping / stripping.                                                                             |

Most other `core/*.ts` files are the production-emit and host-integration layer:
`emit-minify.ts`, `emit-alias.ts`, `shader-lex.ts`, `decode-log.ts`, `emit-prune.ts`,
`emit-identity.ts`, `fragment.ts` (declarations without a stage wrapper), `registry.ts`,
`variant-family.ts`, `variant-link.ts`, `semantic-diff.ts` and `measure.ts`.

### `core/passes/`

| Path                                  | What it is                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/passes/validate.ts`             | `validate()` throws `ValidationError` on the first `CORE_RULES` error at every emit; `lintModule()` runs the full `RULES`.                             |
| `core/passes/lint/`                   | The lint engine (one registry, one traversal), `presets.ts`, and `rules/`, one rule per file.                                                          |
| `core/passes/required-caps.ts`        | `requiredCaps` / `assertCaps`: the fail-closed capability gate.                                                                                        |
| `core/passes/match-lower.ts`          | `lowerModule`: each `matchExpr` becomes a hoisted `var` plus a `switch`, so the emit walk never sees one.                                              |
| `core/passes/fp64-lower.ts`           | The single authority for `f64` semantics: `f64` IR to `vec2<f32>` and `df64_*` calls.                                                                  |
| `core/passes/console-buffer.ts`       | Under `compile(src, { console: 'gpu' })`, rewrites each recorded `console` call into writes to the `_console` storage buffer (Rule 6.11, surface §66). |
| `core/passes/opt/`                    | `autoVars`, `cse`, and the `optimize` fixpoint (const / copy propagation, folding, dead branches, LICM, DCE). `expr-utils.ts` is the shared traversal. |
| `core/passes/compose.ts`              | `composeModule(base, swaps)`: swaps tagged `placeholder` statements. Strict by default.                                                                |
| `core/passes/mangle.ts`, `inline*.ts` | Identifier mangling for `obfuscate`; function inlining.                                                                                                |

### `core/spec-conformance/`

Test-only. It checks the compiler against outside authorities instead of lists this repository
maintains. `fixtures/*.json` are generated from Tint's `core.def` (`bun run bake:coredef`) and the
WGSL spec's names (`bun run bake:wgsl-names`); never hand-edit them.
`coredef-texture-overloads.test.ts` makes every texture overload supported or deferred with a
reason, `stage-rules.test.ts` checks the stage-restricted builtin sets (read from
`compiler/ts/lower/function.ts` and `core/passes/lint/rules/fragment-only-builtin.ts`), and
`surface-names.test.ts` holds every author-facing name to WGSL, ECMAScript or the extension
table of `docs/language-design.md` §9.

## For AI Agents

### Working in this directory

- **One IR, three backends, one walk.** Control flow is emitted once, in `core/emit.ts`; a
  backend supplies spelling and the divergent fragments (`core/backend.ts`). A new target
  implements `Backend`; it never forks the walk. A new divergent intrinsic is one entry in
  `core/intrinsics.ts`.
- **The pre-emit pipeline is shared.** `lowerForBackend` runs `validate`, `assertCaps`,
  `assertBuiltins`, then `autoVars`, `lowerModule`, `fp64Lower`, `selectComposite`, the
  backend's own lowerings and its `optimize`. Put a target-neutral rewrite there, not in a backend.
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
- `bun run gate:compile`: every registered example compiled by Tint and a WebGL2 context. Run it
  for any change to emitted text.
- `bun run gate:journeys` (after `build`): the packed tarball checked the way a user meets it.
- After writing shader source, `bun run format:semicolons`; before pushing, `bun run lint` and
  `bun run format:check`.

<!-- MANUAL: notes below this line are preserved on regeneration -->
