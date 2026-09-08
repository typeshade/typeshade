<!-- Generated: 2026-06-23 | Updated: 2026-09-08 -->

# TypeShade (`@xgis/shader-dsl`)

## Purpose

A zero-dependency TypeScript shader DSL. A shader is authored once as a typed node graph
(the IR). Three backends emit it over one shared tree walk: a WGSL writer, a GLSL ES 3.00
writer, and a CPU f64 oracle that evaluates the same IR on the host in double precision.
The authoring surface is plain TypeScript: `const x = expr`, method operators, `.assign()`,
`fn()` with an inferred return type, and `If` / `Switch`. `AUTHORING.md` is the guide.

## Key files

| File | What it is |
| --- | --- |
| `package.json` | `@xgis/shader-dsl`, ESM, no runtime dependencies. `main` and `exports` point at `src/index.ts`; consumers compile the TypeScript. Scripts: `build`, `test`, `gate:compile`. |
| `tsconfig.json` | Standalone project. It extends the package-local `tsconfig.base.json`; nothing tracked here may name a path outside this tree, or the vendored copy stops compiling. `tsc --build` (`bun run build`) is the canonical type check. |
| `vitest.config.ts` | Test config: `src/**` and `examples/**` specs, 30 s timeout because the df64 property suites run 8 to 16 s. |
| `scripts/compile-gate.ts` | `bun run gate:compile`. Emits every registered example and hands the WGSL to Tint (Chromium's headless WebGPU) and both GLSL ES 3.00 stages to a real WebGL2 context. Each compiler is fed a broken shader first, so an instrument that cannot fail cannot pass. |
| `.github/workflows/ci.yml` | Type check, unit suite and compile gate on every push and pull request. |
| `AUTHORING.md` | The authoring guide. Read it before writing a shader. |
| `src/index.ts` | The public barrel and the only import surface for consumers. `core/` is private. |

## Subdirectories

| Directory | Purpose |
| --- | --- |
| `src/` | All source. `core/` holds the IR, the neutral emitter and backend contract, the pass pipeline and the layout layer. The entry points beside it (`index.ts`, `dev.ts`, `compute.ts`, `emit-prod.ts`) are the public surface. Concrete shader graphs live in consuming projects. See `src/AGENTS.md`. |

## Working in this repository

- Read `AUTHORING.md` first. Several older patterns are gone (`Var` / `Let` names,
  `.field()` / `.of()` / `.get()`, `entryFn` / `computeFn`, `callFn('name')`, `constRef('PI')`,
  explicit `fn()` return tokens, free `assign()`). Use the current forms.
- Emit changes come in two kinds. A byte-identical change (a pure authoring refactor) is
  gated by the emit goldens. A semantic change (the emitted text changes) needs the CPU
  oracle parity gate and a real compile through `bun run gate:compile`.
- `core/` is private. Do not widen the public barrel to export it.

## Tests

- `bun run build`: `tsc --build` (dist and `.d.ts`), then `tsc -p tsconfig.tests.json`, the
  noEmit pass over tests, examples and scripts.
- `bun run test`: vitest over `src/**` and `examples/**` (146 test files).
- `bun run gate:compile`: every registered example emitted and compiled. Needs Chromium once:
  `./node_modules/.bin/playwright install --only-shell chromium`.

## Patterns

- One IR, three backends, one tree walk. A new emit feature goes into the shared walk, or
  the CPU oracle and the GLSL writer drift.
- The auto-var pass relies on Expr object identity and runs on all three backends.
- Module constants are scalar dual-precision by default (`ConstDecl.wgslValue` truncated,
  `cpuValue` full precision, for example `PI`). A non-scalar constant (vec, array, struct)
  sets `ConstDecl.valueExpr` instead: a constant-foldable literal Expr that every backend
  uses. Author one with `constExpr(name, type, valueNode)`.

## Dependencies

- None at runtime. Dev only: `typescript`, `vitest`, `@types/node`, `@webgpu/types` and
  `playwright` for the compile gate.
- No dependency on any host. What a host must supply, such as the projection spec list, is
  injected through `configureProjections()`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
