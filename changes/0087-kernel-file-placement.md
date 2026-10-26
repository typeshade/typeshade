---
id: '0087'
title: A shader module sits in any directory beside its host module, and `tsc` reads its host view from a build directory instead of the source tree
status: draft
rules:
  - '3.8'
surface:
  - 64
exports:
  - TypeshadeViteOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Describe the build-directory placement of host views beside the moduleSuffixes setup on the setup and host-import pages, in both locales, and record 0087 when the pin moves.
  - repo: vscode-typeshade
    what: Offer the build-directory placement in the shader-tsconfig remedy, describe it in the skill's host setup, update every fixture that expects a host view beside its module, and record 0087 when the pin moves.
  - repo: typecv
    what: Revise phase 1a and the gpu/ subdirectory rule of section 3.1 of docs/library-structure.md, adopt a views project in the type-check and declaration builds, and record 0087 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names options and files that a later implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0087`, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                          |
| Date and attribution          | Written on 2026-10-26, UTC. The date records authorship, not an approval. A Claude Code sub-agent (Claude Opus 5.5) drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. Sources: TypeCV's `docs/library-structure.md` and `docs/audits/2026-10-26-kernel-style.md` at TypeCV `48e2711`, this tree, and the measurements in "Why". No approver is recorded. |
| Applicability / Effectivity   | The host view of a shader module and its placement: `src/compiler/ts/host-face.ts` (`hostViewPath`), `src/vite.ts`, `src/cli/run.ts` (`tshc sync`, `tshc check`), `src/cli/init.ts` (`tshc init`), Rule 3.8, surface §64 and `README.md`. Host projects on TypeScript 5.6.3, 5.9.3 and 6.0.3 were measured. No release version is assigned.                                                                 |
| Review baseline               | `main` at `e03ff7ea74bb8d6c7398d2310b2a53cc7e582227`. TypeCV evidence: `main` at `48e2711dbea8649c74e26baf2ca364951ab5a1dc`, whose compiler pin is `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc` (`package.json` line 60, `package-lock.json` line 2059).                                                                                                                                                      |
| Review and revision authority | [PR #763](https://github.com/typeshade/typeshade/pull/763), a proposal-only draft opened on 2026-10-26, UTC. The first revision, commit `a51bfe3`, preceded the pull request. Git records the revisions. The review and the merge of PR #763 record the decision.                                                                                                                                           |

## What changes

**Proposal.** A project may keep each shader module in any directory, beside the host module
that imports it. The name `*.shade.ts` selects a shader module. No directory has a meaning to
any TypeShade tool. A project may also move every host view out of its source tree. TypeScript
then reads each view from a build directory, through a project reference, with no
`moduleSuffixes`. The placement beside the module (change 0009) stays the default.

### Before and after

| Today, at `e03ff7e`                                                                                        | With the build-directory placement                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The plugin and `tshc sync` write `name.shade.typeshade.ts` beside each module.                             | They write `name.shade.d.ts` in the `outDir` of the project's views project, at the module's path relative to that project's `rootDir`.              |
| The host `tsconfig` sets `moduleSuffixes: [".typeshade", ""]` and `exclude: ["**/*.shade.ts"]`.            | The host `tsconfig` names the views project in `references` and sets `disableSourceOfProjectReferenceRedirect`. Its `include` may match the modules. |
| An emitting `tsc` emits each view as `name.shade.typeshade.js` and `.d.ts`, which a library deletes again. | An emitting `tsc` emits no view. The views may be the package's own declarations.                                                                    |
| `.gitignore` names `*.shade.typeshade.ts`.                                                                 | `.gitignore` names the build directory.                                                                                                              |
| A view of a deleted module stays in the source tree until someone deletes it.                              | `tshc sync` owns the build directory and deletes each view whose module is gone.                                                                     |
| `tshc init` refuses a host project that emits declarations.                                                | `tshc init --views` configures such a project too.                                                                                                   |

### The views project

The views project is a `tsconfig` file whose sources are the shader modules and whose outputs
are their host views. TypeShade writes those outputs. `tsc` never builds the project.

```jsonc
// tsconfig.views.json, written once by tshc init --views
{
  "compilerOptions": {
    "composite": true,
    "emitDeclarationOnly": true,
    "rootDir": ".",
    "outDir": ".typeshade/views",
    "allowImportingTsExtensions": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": [],
    "types": []
  },
  "include": ["**/*.shade.ts"],
  "exclude": ["node_modules", "dist", ".typeshade"]
}
```

```jsonc
// tsconfig.json, the host project's own: two lines in place of moduleSuffixes and exclude
"compilerOptions": { "disableSourceOfProjectReferenceRedirect": true },
"references": [{ "path": "./tsconfig.views.json" }]
```

A host file still imports `./terrain.shade.ts`. `tsc -p tsconfig.json` and the editor read
`.typeshade/views/src/terrain.shade.d.ts` for that import. Vite still reads the source through
the plugin. The view's text is the text `hostFace` returns today. **Fact** (the view writer in
`src/compiler/ts/host-face.ts`). It holds declarations only: `import type` lines, `export declare`
statements, interfaces, type aliases and a declared default export. **Inference.** That text is
valid as a `.d.ts`; this draft compiled only a hand-written view as one.

The parts of the proposal:

1. `tshc sync --views <tsconfig>` writes each view in the views project's `outDir`. It deletes
   each view whose module is gone. With `--check` it fails on a missing, stale or foreign view.
2. `typeshade({ views: './tsconfig.views.json' })` makes the Vite plugin write each view there
   and nowhere else. `TypeshadeViteOptions` gains the member `views`.
3. `tshc check --views <tsconfig>` checks the shader modules that the views project selects.
   So one configuration names the shader modules for every tool.
4. `tshc init --views` writes the views project, the two host lines, the ignore entry and the
   scripts. It accepts a host project that emits declarations. It refuses a project with a
   script that runs `tsc -b` or `tsc --build`, for the reason in "Why".
5. A library may set the views project's `outDir` to its declaration directory. Its published
   declarations then hold each view beside the host declarations that import it.

### What the project's `tsc` checks

**Fact.** Plain `tsc` cannot type-check a shader module in a host program. Three causes hold
(`README.md`, "Type-checking `.shade.ts` with tsc"):

- `TS1206` on every stage and `@builtin` decorator. It is a grammar error. No declaration file
  removes it, and `experimentalDecorators` does not either.
- `TS2362`, `TS2363` and `TS2365` on vector arithmetic, since TypeScript cannot overload an
  operator.
- The `lib` collision: the shader vocabulary needs `lib: []`, and a host program needs its own
  `lib`.

**Proposal.** The project's configuration selects the shader modules, through the views
project's `include`. `tshc check` checks them with the language service and `compile()`, as it
does today. `tsc` checks the host files against the views. This proposal does not make `tsc`
read a shader module. "Alternatives considered" gives the reason.

### Exclusions

- The default placement, `tshc sync` without `--views` and `tshc init` without `--views` do
  not change.
- No JavaScript is emitted for a shader module outside a bundler. Decision D3 keeps it open.
- A host import of a package's `.shade.ts` stays "Not yet" (surface §68). The project
  reference redirects only the views project's own files.
- `tsc -b` (`--build`) over a configuration that references the views project is not
  supported. It builds the views project with `tsc` and overwrites the views ("Why").
- No rule other than Rule 3.8, no diagnostic code, no example, no IR node, no backend and no
  runtime behaviour changes.

## Why

### TypeCV's evidence

**Fact** (TypeCV `docs/library-structure.md` at `48e2711`, section 2, "The build split", counted
on TypeCV `5e1c95c`). TypeCV selects GPU code by directory:

- `tsconfig.json` (`npm run typecheck`) and `tsconfig.build.json` (`npm run build:core`)
  exclude `src/gpu`.
- `tsconfig.gpu.json` includes `src/gpu/**/*.ts` only. It sets
  `moduleSuffixes: [".typeshade", ""]`, so a kernel import resolves to its generated host view.
- `scripts/build-gpu.mjs` deletes the generated views under `src/gpu` before and after the
  build (lines 14 and 43). It deletes the emitted `.shade.typeshade.d.ts` files from
  `dist/types/gpu` (line 41).
- `.prettierignore` lists 27 kernel files by path.
- `tsc` with the core settings reports 166 errors on `slic.shade.ts`, 8 of them `TS1206`.

**Fact.** That count was reproduced on 2026-10-26 with TypeScript 5.9.3 and TypeCV's core
compiler options: 166 errors, 158 `TS2304` and 8 `TS1206`.

**Fact** (the same document, sections 1 and 3.1, section 4 rule 4, phase 1a and section 7 item
13). `src/gpu` holds 90 `.ts` files, 89 of them in one flat directory. The accepted structure
puts a `gpu/` subdirectory in every area. Phase 1a changes five configuration files to select
those subdirectories. Section 4 rule 4 records an **Inference**: "A kernel file leaves no alias,
since `typeshade/vite` compiles every `*.shade.ts` that a bundle reads as a shader module."

**Fact** (TypeCV `docs/design-rules.md` at `48e2711`, Rule 3.3). What TypeShade cannot do yet
becomes a proposal in TypeShade's `changes/`, not a workaround inside TypeCV.

### What in TypeShade causes the split

- **Fact.** Every TypeShade tool selects a shader module by its name, in any directory:
  `isShaderModulePath` in `src/compiler/ts/host-face.ts` for the Vite plugin, and the
  `SHADE_SUFFIX` walk in `src/cli/run.ts` for `tshc check` and `tshc sync`. `tshc init`
  excludes `**/*.shade.ts`, a name pattern (`src/cli/init.ts`).
- **Fact.** `hostViewPath` places each view beside its module. No option places it elsewhere.
- **Fact** (change 0009, measured on TypeScript 5.6.3). For an import spelled
  `./terrain.shade.ts`, `tsc` reads the source unless a `.ts` view sits beside it under
  `moduleSuffixes`. A sibling `.d.ts`, a wildcard module declaration, `rootDirs` and `paths`
  failed.
- **Fact** (change 0009). Project references failed for two recorded reasons: "the shader
  project cannot build (TS1206), and tsserver reads the source anyway". This proposal answers
  both. TypeShade, not `tsc`, writes the referenced project's outputs.
  `disableSourceOfProjectReferenceRedirect` turns off the editor's source redirect (measured
  below).
- **Fact** (measured below on TypeScript 5.9.3 and 6.0.3). An emitting `tsc` emits a co-located view as
  `terrain.shade.typeshade.js` (`export {};`) and `terrain.shade.typeshade.d.ts`. It rewrites
  the host's import to `./terrain.shade.js`, which no tool writes.
- **Fact.** `tshc init` refuses a host project that emits declarations (`src/cli/init.ts`).
- **Inference.** A library that emits declarations with `tsc` therefore keeps generated views
  in its source tree. Its emit then picks the views up, and its build deletes them. TypeCV's
  directory selection is the workaround it chose for those costs. The name rule is not the
  cause.

### Measurements of 2026-10-26

Configuration: Linux, Node 22.22.0, TypeScript 5.6.3 (this repository's pin), 5.9.3 (TypeCV's)
and 6.0.3 (the newest leg of CI's `typecheck + unit` checks). The probe projects were scratch
directories outside both repositories. A host file imported `./terrain.shade.ts`, a decorated
shader module. A second host file called its function with a wrong-length vector. The view was a
hand-written `.d.ts` with the types `hostFace` gives. Every row gave the same result on all three
versions, except the last row. That row needs `rewriteRelativeImportExtensions`, which
TypeScript 5.6.3 does not have, so it ran on 5.9.3 and 6.0.3.

| Case                                                                                               | Result                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `tsc -p` on the host, with the reference and the view                                              | One error, `TS2345`, at the wrong-length call. `tsc` read the view and not the source, with no `moduleSuffixes` and no `exclude`. |
| The same host with no reference (control)                                                          | 2 `TS1206` and 10 `TS2304` from the source.                                                                                       |
| The view missing                                                                                   | One `TS6305` that names the missing view and its source.                                                                          |
| `tsc -b` on the host                                                                               | Exit 1. `tsc` built the views project and overwrote the view with shader types (`height(p: vec2, k: vec4): f32`).                 |
| The views project with `noEmit`, or without `composite`                                            | `TS6310` or `TS6306`. The views project therefore cannot be the shader-check project `tsconfig.shade.json`.                       |
| An emitting host (`emitDeclarationOnly`) with the views project's `outDir` as its own              | No error. The host wrote its `.d.ts` files and left the view beside them. It wrote no view of its own.                            |
| A consumer that imports a published `.d.ts` which names `./terrain.shade.ts`                       | One `TS2345` at its wrong-length call. It read `terrain.shade.d.ts` beside the importing file.                                    |
| A language service with tsserver's default source redirect                                         | The program read the source, and the wrong-length call was not reported: the shader types degrade to `any`.                       |
| The same, with `disableSourceOfProjectReferenceRedirect` in the host `tsconfig`                    | The program read the view, and `TS2345` was reported.                                                                             |
| Today's co-located view under an emitting `tsc` (`declaration`, `rewriteRelativeImportExtensions`) | `tsc` wrote `terrain.shade.typeshade.js` (`export {};`) and its `.d.ts`, and rewrote the import to `./terrain.shade.js`.          |

**Fact** (TypeScript 5.9.3, `lib/typescript.js` line 127071). `createProgram` uses the source
of a referenced project only when the host asks for it and the option
`disableSourceOfProjectReferenceRedirect` is not set. **Inference.** tsserver, typescript-eslint
and `vitest --typecheck` build their programs through that function, so they read the view with
the option set. Only the language-service API path was run; tsserver, typescript-eslint and
vitest were not run.

**Fact** (measured with `hostFace` at `e03ff7e`). A shader module whose only statement after the
directive is `export * from "./new/k.shade.ts"` compiles. Its generated module is byte-identical
to its target's, and its host view carries the target's `@compute` entry. **Inference.** A moved
kernel file can leave an alias at its old path. A bundle that reads both paths holds two copies
of the compiled module.

### Alternatives considered

1. **Keep the directory convention and document it.** No compiler work. **Inference.** Every
   library that emits declarations repeats TypeCV's split, its view cleanup and its second
   configuration, and a kernel cannot sit beside its host module. Rejected because the cost
   recurs in each project.
2. **A TypeShade configuration file with a glob**, such as a `typeshade.config.json` that names
   the shader modules and a views directory. It selects files, but it does not change how `tsc`
   resolves an import, so `moduleSuffixes` and the views in the tree stay. It also duplicates
   the file set that a `tsconfig` already holds, against the "one authority" rule
   (`AGENTS.md#gate-discipline`). Rejected.
3. **A TypeScript language-service plugin** that serves each view in memory. It covers the
   editor only. tsserver loads such a plugin from `compilerOptions.plugins`, and `tsc` ignores
   that option, so a type check in CI does not see the plugin. Rejected as the mechanism. The
   editor's existing tsserver plugin is not affected.
4. **A `tshc` type check that serves the views in memory**, in the manner of vue-tsc. Change 0009
   measured and rejected it: it replaces `tsc` in the build script, and every other tool that
   builds a program from the `tsconfig` reads the source. That still holds.
5. **A file extension that TypeScript does not read**, such as `.tsh` (change 0041, withdrawn
   on 2026-10-05). With no `.ts` file at the import path, `allowArbitraryExtensions` and
   `rootDirs` could find a view in a build directory (**Inference**; not measured). The owner
   withdrew 0041 because no grammar extension needed a file extension of its own. A rename only
   to move the views renames every shader file in every downstream repository. Rejected.
6. **A decorator spelling that `tsc` accepts**, so the project's own `tsc` reads a shader
   module. It removes only `TS1206`. The operator errors and the `lib` collision remain, and
   every entry point in every repository changes. Rejected; it would need its own proposal.
7. **The build-directory placement as the only placement.** `tsc -b` breaks with it (measured),
   and create-vite's templates run `tsc -b`. Rejected. The two placements coexist.

### Unresolved decisions

- **D1. Spelling.** The option names `views` and `--views`, and the file name
  `tsconfig.views.json`. An alternative is a views project that `tshc sync` generates under
  `.typeshade/`, which a clean checkout lacks until `prepare` runs.
- **D2. The default `outDir`.** `.typeshade/views`, or the declaration directory of a library,
  measured above.
- **D3. JavaScript emit.** Whether the same directory also takes the generated module,
  `name.shade.js`, so a project that emits with `tsc` runs a host module without a bundler.
  Change 0041 named that a possible `tshc build`. This draft leaves it out. The generated
  module is plain ESM that imports only `typeshade/runtime/internal` (`hostFace` at `e03ff7e`).
- **D4. `tsc -b`.** Whether `tshc init --views` refuses a project with a `tsc -b` script (this
  draft) or only warns. In either case `tshc sync --check` reports a view that `tsc` overwrote,
  since such a view lacks the generator's first line.
- **D5. Defaults.** Whether `tshc init` later selects the build-directory placement for a
  project with no `tsc -b` script.

## What it touches

- **Rule 3.8.** Its text adds "in any directory of its project" and states that the name, not a
  directory, selects a shader module. It names both placements of the view. Its rationale names
  the project-reference redirect as the mechanism of the second placement. Its "Enforced by"
  adds the tests below.
- **Surface §64.** "The host view" and the manual setup gain the build-directory placement: the
  views project, the two host lines, `tshc sync --views`, the plugin's `views` option and the
  `tsc -b` limit.
- **`TypeshadeViteOptions`** (`typeshade/vite`) gains the optional member `views`. The existing
  members do not change. `bun run bake:api-surface` records the new shape.
- **Code.** `src/compiler/ts/host-face.ts`: `hostViewPath` takes a placement. `src/vite.ts`:
  the `views` option. `src/cli/run.ts`: `--views` for `sync` and `check`, the pruning and the
  foreign-view check. `src/cli/init.ts`: `--views`.
- **Tests.** `src/vite.test.ts`, `src/cli/run.test.ts` and `src/cli/init.test.ts`. A packed
  journey runs the measurements above against the tarball: modules in nested directories
  beside their host modules, `tsc -p`, `vite build`, a declaration build into a shared
  directory, a consumer project, the editor's redirect through the language service, and a
  planted `tsc -b` overwrite that `tshc sync --check` must catch. `journeys/README.md`
  describes it.
- **Documents.** `README.md` (host setup), `docs/runtime-architecture.md` (the host import
  answer), `CHANGELOG.md`, and the `reqs/` items of Rule 3.8 and surface §64 through
  `bun run reqs:sync` and their Doorstop review.
- **Not touched.** No diagnostic code and no example. The default placement and its journeys
  stay byte-identical.

### Draft impact estimate

**Known.** The change is additive and opt-in. A project without `--views` sees no change. The
compiler, the IR, the backends and the runtime do not change. No dependency is added; the
mechanism is TypeScript's own project references.

**Estimate.** The basis is the size of the code it extends. The code change is small: one path
function, one plugin option, two CLI flags and one initializer mode (`src/vite.ts` has 197 lines,
`src/cli/run.ts` 322, `src/cli/init.ts` 292). The new journey is the largest part of the
validation. Duration and cost are unestimated.

**Compatibility.** Additive. `tsc -b` projects keep the default placement. TypeScript 5.0 to
5.5 were not measured; project references and the redirect option predate 5.0 (**Inference**).

**Decisions before acceptance:** D1, D2 and D4. D3 and D5 may stay open.

### Approval and plan record

This record does not yet apply. Acceptance requires the actual decision and its pull-request
reference, the approved revision of this file, the decisions D1, D2 and D4, the final surface
and export declarations, and any assignment of responsibilities and milestones. This draft
assigns no responsibility, milestone, duration or cost.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with
`Change: 0087`; the unit tests above; the new journey green in `bun run gate:journeys`; the
existing host-import and initializer journeys unchanged; `bun run build`, `bun run lint`,
`bun run format:check` and `bun run test`; `bun run docs:impact`, `bun run docs:refs`,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C -e -F`; and the TypeScript 5.9.3
and 6.0.3 legs. The downstream pins and their `compiler-changes.md` records are tracked apart.

## What it owes downstream

**typeshade.github.io.** The setup page and the host-import page show the `moduleSuffixes`
lines and the view beside the module. They gain the build-directory placement, its two host
lines and its `tsc -b` limit, in English and Korean. The default setup they show stays.

**vscode-typeshade.** The shader-tsconfig remedy, which adds `moduleSuffixes` today (change
0009), offers the build-directory placement as a second choice. The skill's host setup
describes it. Any fixture or code that expects the view beside its module also accepts a view
in a views project's `outDir`. The editor's own TypeScript reads the view only with
`disableSourceOfProjectReferenceRedirect` set (measured).

**typecv.** Expected work, after a pin that carries this change:

- Revise phase 1a and the "GPU code in `gpu/` subdirectories" rule of section 3.1 of
  `docs/library-structure.md`: a kernel file may sit beside its host module.
- Name a views project in the type-check and declaration configurations. Drop
  `moduleSuffixes`, and drop the view cleanup of `scripts/build-gpu.mjs` (lines 14, 41 and 43).
- **Inference.** The CPU build (`tsconfig.build.json`) must still leave out every module that
  reaches a kernel, since `tsc` emits no JavaScript for a shader module (decision D3). It can
  select its files by its entry's import closure rather than by directory. That choice is
  TypeCV's.
- **Fact.** `.prettierignore` can name `*.shade.ts` by pattern today, as this repository's
  `.prettierignore` does. Prettier still cannot parse a decorated top-level function.
- **Inference** (from the alias measurement above). A moved kernel file can leave a re-export
  alias at its old path, which revises the inference of section 4 rule 4. A bundle that reads
  both paths holds two copies. The alias was compiled with `hostFace`, not bundled by Vite.
- Record 0087 in `compiler-changes.md` when the pin moves.

No other downstream repository owes work. The placement is opt-in, and the default does not
change.
