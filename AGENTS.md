<!-- Generated: 2026-06-23 | Updated: 2026-09-23 -->

# TypeShade (`typeshade`)

## Purpose

A near-zero-dependency TypeScript shader DSL (`typescript` itself is the one runtime peer, for
the `"use typeshade"` front end; the IR and the three backends need nothing). A shader is
authored once as a typed node graph
(the IR). Three backends emit it over one shared tree walk: a WGSL writer, a GLSL ES 3.00
writer, and a CPU f64 oracle that evaluates the same IR on the host in double precision.
The authoring surface is plain TypeScript: `const x = expr`, method operators, `.assign()`,
`fn()` with an inferred return type, and `If` / `Switch`. `AUTHORING.md` is the guide.

## Key files

| File                          | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                | `typeshade`, ESM. One runtime dependency: `typescript`, as a REQUIRED peer pinned to `>=5.0.0 <7`, because `compile()` is a TypeScript front end, so the `.` entry imports the parser at module scope and TypeScript 7 throws on import. `main` and `exports` point at `src/index.ts`: in THIS tree, and for a submodule consumer, the package resolves to source. The npm tarball is different: `scripts/publish-manifest.ts` derives a dist-facing manifest from the same `exports` map at publish time. Scripts: `build`, `test`, `gate:compile`, `gate:differential`, `gate:journeys`, `gate:render`, `bake:goldens` (re-bakes the emit goldens after an intended emit change), `bake:api-surface`, `manifest:publish`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tsconfig.json`               | Standalone project, and the EMITTING one: `rootDir: "."` / `outDir: "./dist"` over `src/` plus the `examples/index.ts` closure, so `dist/` mirrors the source tree (`dist/src/…`, `dist/examples/…`) and the `../src/…` specifiers `tsc` copies verbatim into the emitted examples still resolve. It extends the package-local `tsconfig.base.json`; nothing tracked here may name a path outside this tree, or the vendored copy stops compiling. `tsc --build` (`bun run build`) is the canonical type check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `vitest.config.ts`            | Test config: `src/**` and `examples/**` specs, a 90 s timeout because the df64 property suites run 8 to 20 s per test, and `isolate: false`, so a worker loads the compiler once rather than once per file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/compile-gate.ts`     | `bun run gate:compile`. Emits every registered example, and the WGSL each kernel function of one lowers to (change 0013), and hands the WGSL to Tint (Chromium's headless WebGPU) and both GLSL ES 3.00 stages to a real WebGL2 context. Each compiler is fed a broken shader first, so an instrument that cannot fail cannot pass. Its passes leg draws every example drawn in several passes on WebGL2 and checks that one reading a frame before differs from the same frame drawn with no history, then draws each on WebGPU, where frame 30 must match WebGL2's (change 0026). Its entry-call leg (`scripts/entry-calls.ts`) then calls every `@compute` and full-screen `@fragment` entry of the `.shade.ts` examples, and the compute cases no example has (`scripts/compute-case.ts`: a compute entry that loads and samples a texture, which both WebGL2 tiers must run), through the host module the Vite plugin generates, on each tier it has, against WebGPU, and dispatches each compute entry once more through the program runtime from the module's manifest (change 0025), on WebGPU and on its WebGL2 tier (change 0054). The program cases of the same file reach a texture the call layer has no host value for (a 2D array, 3D, cube and two depth textures; three storage textures across a barrier), so they are dispatched by the program runtime alone, and its WebGL2 tier must match WebGPU on the storage array and on every storage texture read back as bytes. Its render case (`scripts/render-case.ts`, #392) then draws three small programs through the program runtime as a host does, on WebGPU, on WebGL2 and into a WebGL2 canvas (a sky behind everything, indexed draws from typed arrays and from the host's own buffers under a reversed depth test, a second pass that loads colour and depth, and vertices a shader pulls from storage), holds the colour and the depth it reads back to a picture computed in JavaScript, and requires the same frames drawn under a wrong depth test to differ from that picture. |
| `scripts/render-rt-golden.ts` | `bun run gate:render`. Renders the class-based 3D SDF example on headless WebGPU, reads its RGBA8 pixels back, and compares them exactly with the committed render golden; `UPDATE_RT_GOLDEN=1` deliberately refreshes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/gpu-differential.ts` | `bun run gate:differential`. Lowers generated kernel functions (`generateKernelModule`'s exact mode, #349), dispatches each plan on headless WebGPU step for step as `callKernel` does, and holds every array and result to the `f32` oracle bit for bit, leaving out a value the oracle itself rounds (#378). Then draws `generateModule`'s exact functions on WebGL2 (`core/testing/draw-harness.ts`) and holds every pixel to the oracle the same way, the inputs GLSL ES 3.00's bare operators leave undefined included, which the writer settles (Rule 11.12). Then runs compute entries on WebGL2 through the executor of change 0054 (`scripts/gl-compute-arm.ts`: the proposal's program list and every example compute entry that binds no texture, each in the executor's own layout and again in layers of 32 words) and holds every storage word to the executor's CPU model (`core/testing/gl-model.ts`), an `f32` within 3 ULP only where the determinism report lists an ULP operation. Tint and the GLSL compiler must report a broken shader, the corpus must reach reductions, scatters, struct arrays and the constructs past drift lived in, a plan dispatched wrong, a table uploaded a row off and a compute input changed must be reported, and the compute corpus must reach a barrier, an atomic and a full-log cut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `.github/workflows/ci.yml`    | Type check, unit suite (its tests that load TypeScript again on 5.9 and 6.0, #259), the bundle boundary of the runtime and the emitter (Rule 11.11), compile gate and the GPU differential, user journeys and the RT render gate on every push and every pull request that changes code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `AUTHORING.md`                | The authoring guide. Read it before writing a shader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/index.ts`                | The public barrel and the only import surface for consumers. `core/` is private.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/cli/`                    | The `tshc` command (`bin` in `package.json`). The check itself is `src/language-service/check.ts` (the language service's merged diagnostics plus `compile()`'s backend ones, exported from `typeshade/language-service` so other tools call it rather than copy it), `format.ts` prints them, `run.ts` is the command over an injected host, and `bin.ts` is the one file in `src/` that touches Node (dynamically, so the library build keeps `types: []`). `sync` writes the host view of each `*.shade.ts` (surface §64). Run it here with `bun src/cli/bin.ts check <paths>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Subdirectories

| Directory | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`    | All source. `core/` holds the IR, the neutral emitter and backend contract, the pass pipeline and the layout layer. The entry points beside it (`index.ts`, `dev.ts`, `compute.ts`, `emit-prod.ts`, `vite.ts`) are the public surface, `runtime.ts` the program runtime and `emit.ts` its load-time emitter among them; `runtime-internal.ts` is what a module the Vite plugin generates imports. Concrete shader graphs live in consuming projects. See `src/AGENTS.md`. |

## Working in this repository

- Read `AUTHORING.md` first. Several older patterns are gone (`Var` / `Let` names,
  `.field()` / `.of()` / `.get()`, `entryFn` / `computeFn`, `callFn('name')`, `constRef('PI')`,
  explicit `fn()` return tokens, free `assign()`). Use the current forms.
- Emit changes come in two kinds. A byte-identical change (a pure authoring refactor) is
  gated by the emit goldens. A semantic change (the emitted text changes) needs the CPU
  oracle parity gate and a real compile through `bun run gate:compile`.
- `core/` is private. Do not widen the public barrel to export it.
- Shader source ends every statement with `;`, as the guide spells `"use typeshade";`. That
  covers the `examples/*.shade.ts` files, the `"use typeshade"` fences in the docs, every fence
  in `docs/use-typeshade-surface.md`, and the inline sources the tests compile. Do not write
  the `;` by hand: run `bun run format:semicolons` after writing shader source (`--check` lists
  what is missing without writing). It inserts a `;` only where the parser already ended a
  statement, so the program means the same thing afterwards. `src/compiler/ts/semicolons.test.ts`
  fails `bun run test` on a missing one. Prettier cannot do this part: it does not parse a
  decorated top-level function (`*.shade.ts` is prettierignored) and does not format a string a
  test compiles. It leaves Markdown fences alone too (`embeddedLanguageFormatting: "off"` for
  `*.md`), because the docs' shader fences are hand-formatted.
- Everything else is Prettier (`semi: true`, `.prettierrc.json`) and ESLint
  (`typescript-eslint` recommended, `eslint.config.mjs`; a `_` prefix marks a binding unused on
  purpose). `bun run format` writes both kinds of `;`; `bun run format:check` and
  `bun run lint` are CI steps, so run them before pushing.

## Tests

<!-- LINT.IfChange(tests) -->

- `bun run build`: `tsc --build` (dist and `.d.ts`), then `tsc -p tsconfig.tests.json`, the
  noEmit pass over tests, examples and scripts.
- `bun run lint` (ESLint) and `bun run format:check` (Prettier, then the shader-source `;`).
- `bun run test`: vitest over `src/**` and `examples/**`.
- `bun run gate:boundary`: `typeshade/runtime` and `typeshade/emit` reach no file of
  `src/compiler/` and no package, and each minified, gzipped bundle stays between its floor and
  its budget in `scripts/bundle-budget.json` (Rule 11.11); CI's `typecheck + unit` job runs it.
- `bun run gate:compile`: every registered example emitted and compiled, and a function declared
  under every name a writer renames (change 0029). Needs Chromium once:
  `./node_modules/.bin/playwright install --only-shell chromium`.
- MNIST WebGL2 validation CI (`.github/workflows/mnist-webgl2-validation.yml`):
  after building and installing Playwright Chromium, run
  `node --experimental-strip-types journeys/mnist/test-webgl2.mjs --stagesOnly`;
  require the actual WebGL2 runtime and compare each compute stage against the independent
  f64 reference; the same workflow exercises synthetic training and the real 1,024/1,000
  MNIST subset with five epochs. These are separate from full 60,000/10,000 MNIST and do
  not establish hardware GPU performance (the CI WebGL2 renderer may be SwiftShader).
- `bun run gate:differential`: generated kernel functions (`generateKernelModule(seed, { exact: true })`)
  lowered and dispatched on headless WebGPU as `callKernel` dispatches them, every array they
  write and every result held to the `f32` oracle bit for bit; a value the oracle itself rounds
  carries no claim, since a driver may reassociate (#378). Then `generateModule(seed, { exact: true })`'s
  functions drawn as fragment programs on WebGL2, every pixel held to the oracle the same way,
  including a floor of values reached by an input GLSL ES 3.00's bare operators leave undefined,
  which the writer settles (Rule 11.12). CI's compile-gate job runs it.
- `bun run gate:render`: the class-based 3D SDF example is rendered on headless WebGPU and its 48x48 RGBA8 pixels are compared exactly with the committed image golden. Use `UPDATE_RT_GOLDEN=1 bun run gate:render` only for an intentional golden refresh.
- `bun run gate:journeys` (after `build`): the packed tarball installed into a fresh project,
  and every program in `journeys/` checked the way a user meets it: `compile()`, the language
  service, the README's `tsconfig.shade.json` <!-- doc-refs: skip — the file a user writes, not one in this tree -->, WebGPU and the CPU oracle against the journey's
  own JavaScript reference. A change that improves what a user can write adds its journey
  (`journeys/README.md`).
- CI's traceability job: `doorstop -C -e -F` over `reqs/` and the traceability matrix as an
  artifact (`reqs/README.md`). On a pull request, the `check` job also runs `docs:impact --check`,
  `ifchange.ts` and `changes.ts` against the base.
- CI's `typecheck + unit (TypeScript X)` checks, the `typescript-versions` job: `bun run build` and
  the unit tests that can load TypeScript again with `typescript` replaced by the newest 5.x (5.9.3)
  and by 6.0 (6.0.3), the versions the editors that load the language service ship (#259).
  `scripts/typescript-tests.ts` lists those tests (an import of `typescript`, of a `.shade` module,
  a child process or a dynamic import, at any depth); a test that never loads TypeScript runs in
  `check` only, since it gives the same result on every version. `check` installs the 5.6.3
  that `package.json` pins, and a newer TypeScript reports what it does not (TS2454 on workgroup
  memory from 5.7, #247) and prints types the API surface reader has to settle
  (`src/api-surface.test.ts`). The 6.0 leg is why the peer range takes 6.x. To run one leg here,
  install its version in a copy of the tree that has its own `node_modules` (`bun install`, then
  `bun add --no-save typescript@6.0.3`), never in one other checkouts share.
- CI's `change scope` job: a pull request that changes only documents (a `.md` file outside
  `src/`, or a Doorstop item under `reqs/`) runs `typecheck + unit` and `traceability (Doorstop)`,
  which read them, and skips the TypeScript legs, the compile gate, the user journeys and the
  render gate. On such a pull request `typecheck + unit` still builds, lints and checks the format,
  but runs only the unit tests that can read a document: `scripts/doc-tests.ts` lists them (an
  import of `node:fs` or a child process, of a `?raw` or `.md` / `.json` / `.txt` file, or a
  dynamic import, at any depth), and a test that cannot read a file gives the same result whatever
  the documents say. A skipped job reports success to the ruleset. A push to `main`, a dispatch and
  a release run every job, the whole unit suite among them.

<!-- LINT.ThenChange() -->

## Gate discipline

Code comments cite this section (`AGENTS.md#gate-discipline`) where a test or script is built
around one of its rules.

- **Prove the instrument before believing a zero.** A gate that iterates a set passes on an
  empty set, and a blind probe reports zero, which reads as a clean result. So each gate first
  shows it can see a failure, in its own named test: the compile gate feeds each compiler a
  broken shader, a scan asserts a floor on how much it read, a resolver is probed with a
  known-inside and a known-outside target.
- **One authority.** A list derived from another (the published entry points from `exports`,
  the WGSL `enable` lines from the capability table) is read from its source, never kept by
  hand beside it. A second copy agrees with the first only until someone edits one of them.
- **Shell out without a shell.** A test or script runs `git` and other tools with an argument
  array (`execFileSync`), captures the output, and throws on a non-zero exit. A silently empty
  result is how a scan gate goes vacuous.

## Docs follow the code

A change is not finished while a sentence anywhere in the tree still describes the code before
it. The prose is large (the guide, the design rules, the surface, these maps), so keeping it
true is a set of steps with tools, each an industry practice, not a memory:

<!-- LINT.IfChange(docs-follow-the-code) -->

- **Agree the change before writing it.** A change that alters a design rule, a public export
  or what the site and the editor show (a surface section, a diagnostic code, the set of
  examples) starts as a proposal in `changes/`, merged with `status: accepted` before the
  implementation. It names everything the change will touch and the work each downstream
  repository will owe. Each implementing commit says `Change: NNNN`, and
  `scripts/changes.ts` (`bun run changes:check`) fails a diff that reaches past what its
  proposal declared, or that needs a proposal and names none. `changes/README.md` has the
  criteria and the lifecycle; a caught change that truly needs no proposal says why with
  `Change: none, <reason>`.
- **Read the impact before you commit.** `bun run docs:impact` lists what the prose owes the
  working tree against `main`. _Must fix_: a name or file the change removes that a sentence
  still names on a line the change did not touch. _Review_: every sentence that names a file
  the change modifies, a public export whose shape changed in `src/__api__/surface.md`, or a
  rule of `docs/language-design.md` whose text changed. Read each one and fix what is no longer
  true, in the same commit. `CHANGELOG.md` and `docs/HISTORY.md` record the past and are exempt.
  A proposal in `changes/` names the spelling it replaces, so a removed name it mentions is
  no _must fix_ either.
- **Every reference resolves.** `src/doc-references.test.ts` (in `bun run test`; the same list
  is `bun run docs:refs`) fails on a path, a heading anchor, a numbered section, a `Rule N.M`,
  a diagnostic code or a `bun run` script that the prose or a code comment names and the tree
  does not have. Cite a document without numbered headings by its heading slug
  (`AUTHORING.md#fp64`), never as "§11": a count is true only until a section is inserted above
  it. A sentence that must name something absent says why: `<!-- doc-refs: skip — reason -->`.
- **Rules are traced, and a changed rule makes what depends on it suspect.** `reqs/` holds the
  design rules as [Doorstop](https://doorstop.readthedocs.io) items, derived by
  `bun run reqs:sync`. Each rule names the files that verify it, and each of those files names
  the rule back (`Verifies: Rule N.M`). A change to a rule's text marks the rule unreviewed and
  the surface sections that explain it suspect, and `doorstop -C` fails until each one is read
  and reviewed or cleared. `reqs/README.md` has the steps.
- **Mark the pairs no name reveals.** Two places that must change together (an allowlist and the
  table that lists the same rows, the CI jobs and the list of gates above) are marked with
  Google's `LINT.IfChange(label)` / `LINT.ThenChange(path:label)` comments. A diff that changes
  one block and not its targets fails `scripts/ifchange.ts`, unless the commit message says why
  with `NO_IFTTT=<reason>`.
- **Claude Code enforces it.** `.claude/settings.json` runs `bun scripts/doc-impact.ts --hook`
  before every `git commit`. The hook blocks the commit on a must-fix, a dead reference, an unmet
  `ThenChange`, stale `reqs/`, a Doorstop error (when `doorstop` is installed), or a change that
  needs a proposal and does not stay inside an accepted one. It also blocks on open
  review items until the message carries a `Docs-Impact:` trailer saying what you found
  (`Docs-Impact: reviewed, AUTHORING.md#fp64 still holds`, or `Docs-Impact: none, test-only`).
  The trailer answers only the review list; a must-fix or a suspect link is fixed or reviewed,
  never declared away.
- **The repositories that vendor the compiler are held too.** The site and the editor
  extension run `scripts/downstream-impact.ts` from the pinned compiler on every compiler-pin
  pull request. It fails while a downstream file still names an export or file the pin removes,
  and while a proposal the pin implements names that repository in `downstream` and the
  repository's `compiler-changes.md` does not record its id. <!-- doc-refs: skip — a file in each downstream repository -->
  It also fails when a compiler `LINT.ThenChange(//typeshade.github.io/…)` or
  `//vscode-typeshade/…` target did not change with its block. They run `ifchange.ts` over their
  own tree with `TYPESHADE_DOCS_ROOT`, and their `.claude/settings.json` runs the same check as
  a commit hook (`downstream-impact.ts --hook`).
- **CI enforces it for everyone.** On a pull request, the `check` job runs
  `docs:impact --check`, `ifchange.ts` and `changes.ts` (reading the commit messages and the
  pull request's description for the `Change:` line), and the traceability job runs `doorstop -C -e -F`.
  `.github/CODEOWNERS` puts the normative documents, `reqs/`, `changes/` and these tools under
  review.

<!-- LINT.ThenChange() -->

## Patterns

- One IR, three backends, one tree walk. A new emit feature goes into the shared walk, or
  the CPU oracle and the GLSL writer drift.
- The auto-var pass relies on Expr object identity and runs on all three backends.
- Module constants are scalar dual-precision by default (`ConstDecl.wgslValue` truncated,
  `cpuValue` full precision, for example `PI`). A non-scalar constant (vec, array, struct)
  sets `ConstDecl.valueExpr` instead: a constant-foldable literal Expr that every backend
  uses. Author one with `constExpr(name, type, valueNode)`.

## Dependencies

- One at runtime: `typescript`, a REQUIRED peer (`>=5.0.0 <7`). `src/compiler/ts/source-file.ts`
  imports it at module scope and `src/index.ts` re-exports `compile` from there, so it is not
  optional and not confined to `./language-service`; the upper bound is measured, not cautious
  (TypeScript 7's default export has no `SyntaxKind`, and the package throws on import). The IR,
  the emitter and the three backends still need nothing. Dev only: `vitest`, `@types/node`,
  `@webgpu/types` and `playwright` for the compile gate.
- No dependency on any host: nothing under `src/` imports a consumer, and what a host decides
  reaches the compiler through the public API (a variant family's axes, a capability profile).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

## Controlled proposals and everyday answers

Apply these defaults to future work and conversations in this repository.

### Proposal documents and processing

- Start each new proposal from `changes/TEMPLATE.md`. Follow `changes/README.md` for the
  document structure, evidence records and lifecycle. Keep the existing front-matter schema.
- Record the document's applicability, review baseline and revision source. Describe the
  meaning of each date. Identify authors and decision owners only from actual evidence.
- Keep proposed behavior, approved decisions and delivered behavior distinguishable.
  In a draft, describe the reason, alternatives, proposed scope, estimated impact and open
  decisions. Identify unknown estimates as unestimated.
- Treat `draft`, `accepted` and `implemented` as distinct stages. Retain `archived` and
  `withdrawn` as the existing terminal states. Follow the merged-acceptance requirement before
  implementation. An agent's review recommendation does not substitute for that agreement.
- Fill approval records from the actual reviewed revision and review/merge decision. Fill
  implementation records from actual commits, configuration and retained validation evidence.
  Mark later-stage records as not applicable until the corresponding transition.
- Distinguish functional validation from document validation. Track compiler completion and
  downstream adoption separately. Report unperformed checks and unfinished obligations accurately.
- Use STE-inspired writing principles: concise sentences, consistent terms and active voice
  when the actor is known. Write procedural steps in the imperative, with one action per step
  as this repository's local convention. Keep descriptive text separate from procedures.
  Preserve exact technical identifiers and code semantics. Do not claim full ASD-STE100
  compliance from style edits or AI generation.
- Preserve historical proposals unless the current task requires their revision. Apply the
  new structure to new proposals and to proposals revised under the current task.

### Everyday questions and answers

- Answer the question directly, using the user's language and the level of detail it needs.
  A simple explanation does not require a proposal document or formal lifecycle labels.
- Distinguish existing facts, inferences, proposed changes, accepted decisions and observed
  results when the distinction affects the answer. Use short labels only when useful.
- Support claims about current code or completed work with the relevant file, revision or
  check result. Identify uncertainty and missing evidence. Keep hypothetical examples clearly
  separate from currently supported syntax and behavior.
- Preserve one meaning for each technical term. Prefer short active sentences. Use numbered
  steps when the user needs a procedure; keep one action in each step.
- State what changed and what was actually checked when reporting completed work. Identify
  material limitations. A planned check does not establish a passing result.
- Ask only for information needed to resolve an important ambiguity or a required decision.
  Continue authorized independent work while waiting. Honor existing authorization and avoid
  repeated permission requests for the same action.
