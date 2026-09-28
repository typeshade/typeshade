---
id: '0024'
title: A `"use typeshade"` file imports a shader module from an installed package by the package's name, and every path resolves it by one rule
status: accepted
rules:
- '3.2'
- '3.9'
surface:
- 64
- 68
exports: []
exports-removed: []
codes:
- TS8072
examples: []
downstream:
- repo: typeshade.github.io
  what: The language service page's paragraph on imports (documentsP3, en and ko), which says a document imports another by a relative path, gains packages and package.json; the Korean guide sections AUTHORING.md changes (bun run check:guide lists them); the TS8072 page, whose sentences are the registry's; nothing in the Playground, which has no node_modules
- repo: vscode-typeshade
  what: The readers that serve only a file beginning with the directive (the extension's shaderReader, the tsserver plugin's reader, the MCP server's workspace reader) serve package.json too; the skill's rule 10, its TS8072 row and references/language.md, diagnostics.md and host.md say a package is followed; a tsserver test and an MCP tools test import a fixture package; docs/design.md §1.7 records the change
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

A shader file can import another by a relative path since change 0022. It cannot import one
that a package installed, by the package's name. Measured on `main` at `77b77c0`, with
`shade-noise` installed in `node_modules` and its `noise.shade.ts` beginning with the directive:

| The importing file writes                                             | Today                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `import { fbm } from "shade-noise"`                                   | `TS8072 "shade-noise" is a package, and a shader module imports only a file of its own program, …` |
| `import { fbm } from "shade-noise/noise.shade.ts"`                    | the same refusal                                                                                   |
| `import { fbm } from "./node_modules/shade-noise/src/noise.shade.ts"` | compiles, and breaks with the next install that lays `node_modules` out differently                |

After this change the first two compile, the same way on every path: `compile()`, the Vite
plugin, `typeshade check`, `typeshade sync` and the language service. Nothing changes for a
relative import.

### The specifier

A specifier that is not relative names a package: `name` or `@scope/name`, then an optional
subpath, `shade-noise` or `shade-noise/noise`. The package is the first
`node_modules/<name>/package.json` found from the importing file's directory up to the root,
which is the order Node and TypeScript search in.

- **With `exports`,** the subpath (`.` for the name alone) is looked up in `exports` as Node and
  TypeScript's `bundler` resolution look it up: a string target, a map of subpaths with `*`
  patterns, conditions tried in the order `typeshade`, `import`, `default`, an array's first
  valid target, and `null` blocking a path. The target is a file inside the package.
- **Without `exports`,** a subpath names a file of the package, read by the rule for a relative
  specifier: `.js` and `.mjs` read as `.ts`, and `.ts` appended to any other path. The name
  alone names nothing, and is refused with the file to write instead.
- The file must begin with the directive (Rule 3.1), as a relatively imported one must.
- A package's own imports resolve by the same rule: a relative one against the package's file,
  a package it depends on from that file's directory up.

The `typeshade` condition lets one package publish JavaScript for hosts and its shader modules
side by side, the way `types` sits beside `import` for TypeScript:

```json
{
  "name": "shade-noise",
  "version": "1.2.0",
  "exports": {
    ".": { "typeshade": "./src/index.shade.ts", "default": "./dist/index.js" },
    "./*": { "typeshade": "./src/*.shade.ts" }
  }
}
```

`import { fbm } from "shade-noise"` reads `src/index.shade.ts`, and
`import { hash } from "shade-noise/hash"` reads `src/hash.shade.ts`. A package that publishes
only shader modules needs no condition: `"exports": { "./*": "./src/*.shade.ts" }` resolves
through `default`.

### One copy of one package version

A program holds one copy of a package version. A file of a package is keyed by the package's
`name`, its `version` and the file's path inside it, so two paths that reach one version, as a
pnpm layout gives each dependent its own link to a package, read one set of files: a binding
the package declares is declared once, and its functions are emitted once. Two versions of a
package are two sets of files with their own scope, as two relative files are (Rule 3.9).

### The names a package's file emits (Rule 3.2)

A declaration of a package's file keeps its written name unless a declaration emitted before
it holds that name, as a relative file's does. When it is renamed, its stem is the package's
name made a name and then the file's stem, `shade_noise_noise_hash`, so the WGSL says where the
function came from. Two versions of one package that both rename a declaration are told apart
by the number the linker already appends, `shade_noise_noise_hash_2`.

### What `TS8072` says

The row for a package leaves the table in surface §68, and these join it:

| What the file writes                                 | `TS8072`                                                                                                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a package no `node_modules` holds                    | `Cannot find the package "shade-noise" (looked in node_modules from "src" up).`                                                                                                                       |
| a subpath `exports` does not name, or maps to `null` | `"shade-noise" does not export "./warp": its package.json "exports" names no module for it.`                                                                                                          |
| the name alone, with no `exports`                    | `"shade-noise" has no module to import by its name alone: its package.json has no "exports". Import one of its files, such as "shade-noise/noise.shade.ts".`                                          |
| a target that does not begin with the directive      | `"shade-noise" resolves to "node_modules/shade-noise/dist/index.js", which does not begin with "use typeshade". A package publishes its shader modules under the "typeshade" condition of "exports".` |
| a `#` specifier (a package's `imports` field)        | `"#noise" names a package's own import map, which a shader module does not read. Import the file by a relative path.`                                                                                 |

A use of what the import would have bound reports nothing more (Rule 12.4), and the editor
merges TypeScript's report of the same mistake into the one `TS8072`, as it does today.

### How each path reads a package

- **`compile()`.** Its default resolver reads `package.json` files through `readDocument`, so a
  host that reads from disk follows a package with no change. `resolveImport` still replaces the
  rule for a host that wants its own. A compile with no `readDocument` reads nothing, and the
  package is not found.
- **The language service.** The same rule, through its host's `readDocument`. TypeScript's half
  resolves through it (`resolveModuleNameLiterals` in `src/language-service/host.ts`), so the
  editor and the compiler read one file for one import.
- **The Vite plugin, `typeshade check` and `typeshade sync`** read from disk and follow a
  package; the plugin watches each file of it that the module read.
- **`readDocument` is asked for `package.json`** as well as for shader modules. A host that
  serves only a file that begins with the directive serves `package.json` too.

## Why

`docs/dx.md` principle 8 is that TypeShade code is shared the way TypeScript code is, and its
test is whether a developer can use a library of TypeShade functions from npm without copying
its files. Change 0022 made relative imports the step this stands on, and its "What comes next"
named this change: with the resolver a hook, a package is a change to the resolver and not to
the program. It is roadmap X6.

Alternatives considered:

- **Let TypeScript resolve for the editor and write a second resolver for the compiler.**
  TypeScript's `bundler` resolution with `customConditions: ["typeshade"]` finds the same file
  in most layouts, but two implementations of one rule drift, which is why
  `src/compiler/ts/specifier.ts` is the one rule for both halves. Rejected.
- **Resolve the `types` condition.** It names declarations for a host program, not the shader
  source the program is built from. Rejected.
- **Key a package file by its real path, through a `realPath` hook every host passes.** A
  browser has no real path, and the rule would move into each host. A version's content is
  fixed on the registry, which is what keying by name and version relies on. Chosen: name and
  version, with `resolveImport` left for a host that wants its own rule.
- **Keep packages refused, and document relative paths into `node_modules`.** Such a path
  depends on how the package manager laid the directory out (hoisting, pnpm's store) and
  publishes nothing. Rejected.
- **A TypeShade registry or a `typeshade install` command.** npm is the registry, and a shader
  library ships in the same package as the host code that uses it. Rejected.

## What it touches

- **Rule 3.9:** its specifier sentence gains packages and the resolution above; "a package"
  leaves the list of what `TS8072` refuses, and the package refusals join it; one copy of one
  package version.
- **Rule 3.2:** the stem of a declaration a package's file emits.
- **Surface §68:** the specifier paragraph and the `package.json` example, one copy per version,
  the stem, the refusal table, and how each path reads a package (`package.json` through
  `readDocument`).
- **Surface §64:** the Vite plugin follows a package import from a shader module; a host file
  that imports a package's `.shade.ts` itself is not in this change (below).
- **`TS8072`:** the sentences above; the package sentence goes. The code and its number stay.
- **Tests:** the resolution forms (a string and a conditional `exports`, a `*` pattern, a subpath
  with no `exports`, a scoped package, `node_modules` two directories up, a package importing a
  package) in `src/compiler/ts/specifier.test.ts`; one copy of a version reached by two paths,
  two versions as two copies, the package stem and each refusal in `src/compiler/ts/link.test.ts`,
  on both halves as its table already reads them; `src/vite.test.ts` and the CLI tests with a
  fixture package; and a user journey that installs a packed fixture package with npm into a Vite
  project, so a real `node_modules` layout is read.
- **Docs:** `AUTHORING.md`'s sentence that a package is not supported yet, `docs/dx.md`
  principle 8, `docs/roadmap.md` X6, `docs/language-service-api.md` (the service asks
  `readDocument` for `package.json`), and `CHANGELOG.md`.

## What it owes downstream

**typeshade.github.io**

- **The language service page** (`LanguageServicePage.astro`, `documentsP3` in `en.ts` and
  `ko.ts`) says a document imports another by a relative path; it gains a package, and says the
  service asks `readDocument` for `package.json`.
- **The Korean guide:** the sections `AUTHORING.md` changes (`bun run check:guide` lists them).
- **The `TS8072` page** reads its sentences from the registry; nothing to write by hand.
- **The Playground** has no `node_modules`, so a package import there is the "Cannot find the
  package" refusal, which needs no change.

**vscode-typeshade**

- **The readers** that serve only a file beginning with the directive serve `package.json` too:
  the extension's `shaderReader` (`packages/vscode-typeshade/src/model.ts`), the tsserver
  plugin's reader, and the MCP server's workspace reader.
- **The skill:** SKILL.md rule 10 and its `TS8072` row stop listing a package as refused;
  `references/language.md` gains a package import beside the two-file example,
  `references/diagnostics.md` the new sentences, `references/host.md` the `package.json`
  reads.
- **Tests:** a tsserver test and an MCP tools test import a fixture package.
- **`docs/design.md` §1.7** records the change.

## Not in this change

- **A host file importing a package's `.shade.ts` through the Vite plugin.** The plugin writes
  a module's host view beside it, and a package's directory is not the project's to write. A
  package could ship its view, or the plugin could write it to a cache; a later change.
- **The compiler version a package was written for.** A package states it as a
  `peerDependencies` range on `typeshade`, which npm checks.
- **A package's `imports` map** (`#internal` specifiers) is refused, as above.

## Decisions for the reviewer

Accepting this proposal accepts each of these, and each is the recommendation the draft made. The
maintainer accepted them on 2026-09-28:

1. **A package file is keyed by the package's name and version**, not by a `realPath` hook each
   host passes: it works in a browser and needs no host change, and `resolveImport` stays for a
   host that wants its own rule.
2. **The conditions are `typeshade`, then `import`, then `default`**, so a package of shader
   modules alone publishes with a plain `exports`, and one that also ships JavaScript names its
   shader modules under `typeshade`.
3. **A package file's stem is the package's name, then the file's stem**, so the WGSL says where a
   renamed declaration came from; two versions that rename one declaration are told apart by the
   number the linker appends.
