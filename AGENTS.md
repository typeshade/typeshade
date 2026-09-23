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

| File                       | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`             | `typeshade`, ESM. One runtime dependency: `typescript`, as a REQUIRED peer pinned to `>=5.0.0 <6`, because `compile()` is a TypeScript front end, so the `.` entry imports the parser at module scope and TypeScript 7 throws on import. `main` and `exports` point at `src/index.ts`: in THIS tree, and for a submodule consumer, the package resolves to source. The npm tarball is different: `scripts/publish-manifest.ts` derives a dist-facing manifest from the same `exports` map at publish time. Scripts: `build`, `test`, `gate:compile`, `gate:journeys`, `bake:api-surface`, `manifest:publish`. |
| `tsconfig.json`            | Standalone project, and the EMITTING one: `rootDir: "."` / `outDir: "./dist"` over `src/` plus the `examples/index.ts` closure, so `dist/` mirrors the source tree (`dist/src/…`, `dist/examples/…`) and the `../src/…` specifiers `tsc` copies verbatim into the emitted examples still resolve. It extends the package-local `tsconfig.base.json`; nothing tracked here may name a path outside this tree, or the vendored copy stops compiling. `tsc --build` (`bun run build`) is the canonical type check.                                                                                               |
| `vitest.config.ts`         | Test config: `src/**` and `examples/**` specs, 30 s timeout because the df64 property suites run 8 to 16 s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/compile-gate.ts`  | `bun run gate:compile`. Emits every registered example and hands the WGSL to Tint (Chromium's headless WebGPU) and both GLSL ES 3.00 stages to a real WebGL2 context. Each compiler is fed a broken shader first, so an instrument that cannot fail cannot pass.                                                                                                                                                                                                                                                                                                                                              |
| `.github/workflows/ci.yml` | Type check, unit suite, compile gate and user journeys on every push and pull request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AUTHORING.md`             | The authoring guide. Read it before writing a shader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/index.ts`             | The public barrel and the only import surface for consumers. `core/` is private.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Subdirectories

| Directory | Purpose                                                                                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`    | All source. `core/` holds the IR, the neutral emitter and backend contract, the pass pipeline and the layout layer. The entry points beside it (`index.ts`, `dev.ts`, `compute.ts`, `emit-prod.ts`) are the public surface. Concrete shader graphs live in consuming projects. See `src/AGENTS.md`. |

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
- `bun run gate:compile`: every registered example emitted and compiled. Needs Chromium once:
  `./node_modules/.bin/playwright install --only-shell chromium`.
- `bun run gate:journeys` (after `build`): the packed tarball installed into a fresh project,
  and every program in `journeys/` checked the way a user meets it: `compile()`, the language
  service, the README's `tsconfig.shade.json` <!-- doc-refs: skip — the file a user writes, not one in this tree -->, WebGPU and the CPU oracle against the journey's
  own JavaScript reference. A change that improves what a user can write adds its journey
  (`journeys/README.md`).
- CI's traceability job: `doorstop -C -e -F` over `reqs/` and the traceability matrix as an
  artifact (`reqs/README.md`). On a pull request, the `check` job also runs `docs:impact --check`,
  `ifchange.ts` and `changes.ts` against the base.

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

- One at runtime: `typescript`, a REQUIRED peer (`>=5.0.0 <6`). `src/compiler/ts/source-file.ts`
  imports it at module scope and `src/index.ts` re-exports `compile` from there, so it is not
  optional and not confined to `./language-service`; the upper bound is measured, not cautious
  (TypeScript 7's default export has no `SyntaxKind`, and the package throws on import). The IR,
  the emitter and the three backends still need nothing. Dev only: `vitest`, `@types/node`,
  `@webgpu/types` and `playwright` for the compile gate.
- No dependency on any host: nothing under `src/` imports a consumer, and what a host decides
  reaches the compiler through the public API (a variant family's axes, a capability profile).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
