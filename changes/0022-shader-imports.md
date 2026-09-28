---
id: '0022'
title: A `"use typeshade"` file imports what another one exports, and `compile()`, the Vite plugin, `typeshade check` and the editor all follow the import
status: accepted
rules:
- '3.2'
- '3.9'
- '8.9'
- '8.13'
- '8.20'
- '9.5'
surface:
- 64
- 68
exports:
- CompileOptions
- CompileTsSourceOptions
- TypeshadeVitePlugin
exports-removed: []
codes:
- TS8072
examples:
- imported-noise
downstream:
- repo: typeshade.github.io
  what: The TS8004 error-code page's fix (import it from the file that declares it), a new TS8072 page with a trigger and a fix, en and ko; the copy that calls one file the whole program or a compilation unit; the Playground and the build-time example compile (shade-examples.ts, the language worker's service and compile()), which pass a readDocument so the imported-noise example opens with its library; the example in the gallery, the picker and the Korean blurbs; the language service page, which names readDocument and resolveImport; the Korean guide sections AUTHORING.md changes
- repo: vscode-typeshade
  what: The tsserver test that pins TS8004 on a call across two shaders flips, and the TS2305-after-rename assertions follow the merge that keeps TS8072; the skill's "One file is one module" rule and its TS8004, language, diagnostics and host references; the MCP server's compile and run tools and the extension's reflection, entry list and Run Entry pass a readDocument; docs/design.md §1.7 and docs/agents.md §8 item 3 record the change
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Today a `"use typeshade"` file cannot use what another one exports through any public path.
Measured on `main` at `9fbe5ef`, with `main.shade.ts` importing `lighten` from `lib.shade.ts`:

| Path                                                                           | What it reports                                                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `compile(main)`                                                                | `TS8004 Unknown function "lighten". Declare it in this file, or import it from another shader module.`                                         |
| the Vite plugin (`hostFace`)                                                   | the build fails with the same `TS8004`                                                                                                         |
| `typeshade check main.shade.ts lib.shade.ts`                                   | the same `TS8004`, with both files handed in                                                                                                   |
| the language service (the editor, the tsserver plugin, the MCP server)         | TypeScript resolves the import (no `TS2307`), and the TypeShade half reports the same `TS8004`: an error on a line its TypeScript half accepts |
| `compileTsSources(files, entry)` in `src/compiler/ts/module.ts`, a deep import | 0 diagnostics                                                                                                                                  |

Every public path compiles one file (`compileTsSource`), so the call is an unknown function. The
one function that follows an import, `compileTsSources`, is exported from no subpath (#187), and it
follows functions only:

| What the two files write                                        | What `compileTsSources` reports                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `import { Light }`, a class                                     | `TS8099 "lib.shade.ts" has no function "Light".`                                           |
| `Light` named without an import                                 | `TS8002 Unknown type "Light".` (TypeScript: `TS2304`)                                      |
| `import { Mode }`, an `enum`                                    | `TS8099 "lib.shade.ts" has no function "Mode".`, then `TS8022 Unknown identifier "Mode".`  |
| `import { SCALE }`, a constant                                  | `TS8099`, then `TS8022 Unknown identifier "SCALE".`                                        |
| the library's own function reads the library's own `const K`    | `TS8022 Unknown identifier "K".`: constants are collected from the entry file only         |
| `import { twice }`, a generic function                          | `TS8003 Argument 1 of "twice" type mismatch.`                                              |
| `export { g } from "./lib.shade.ts"`, a re-export               | `TS8099 "index.shade.ts" has no function "g".`                                             |
| `from "./lib.js"`, which the language service reads as `lib.ts` | `TS8099 Cannot resolve import "./lib.js" from "main.shade.ts" (looked for "lib.js.ts").`   |
| two files that each declare a private `function h`              | 0 diagnostics, and WGSL with two `fn h`, which `validate()` refuses (`SD0020`, `dup-func`) |

The documentation disagrees with itself about all of this. `docs/use-typeshade.md` shows a
two-file program under "Modules" and says "User code uses `import` / `export`"; the fence passes
only because the doc-snippets test hands it to `compileTsSources`. Surface §64 says the opposite:
"A `.shade.ts` that imports another `.shade.ts` is still `TS8004`: one file is one module." That
was decided on purpose: 0009 kept one file per module until #187's editor half was settled.

After this change, one file holds a library and another uses it:

```ts
// noise.shade.ts
"use typeshade";

function hash32(x: u32): u32 {
  const a = (x ^ (x >> 16)) * 0x85ebca77;
  const b = (a ^ (a >> 13)) * 0xc2b2ae3d;
  return b ^ (b >> 16);
}

function hash(p: vec2): f32 {
  const h = hash32(u32(i32(p.x)) ^ hash32(u32(i32(p.y))));
  return f32(h >> 8) * 5.9604644775390625e-8;
}

export function noise(p: vec2): f32 {
  const i = floor(p);
  const f = fract(p);
  const u: vec2 = f * f * (vec2(3.) - f * 2.);
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y,
  );
}

export function fbm(p: vec2): f32 {
  return noise(p) * 0.5 + noise(p * 2.02) * 0.25 + noise(p * 4.08) * 0.125;
}
```

```ts
// clouds.shade.ts
"use typeshade";
import { fbm } from "./noise.shade.ts";

class Uniforms {
  time: f32;
}

declare const U: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}

@fragment
export function fs(vo: VsOut): vec4 {
  const f = fbm(vo.uv * 6. + vec2(U.time * 0.1, 0.));
  return vec4(vec3(f), 1.);
}
```

`compile()` of `clouds.shade.ts`, the Vite plugin, `typeshade check` and the editor each accept it,
and each emits or checks one module: `vs`, `fs` and the four functions of `noise.shade.ts` they
reach.

### What a file may import (Rule 3.9)

- **Every declaration a file can make at the top level can be exported and imported:** a
  function, generic ones and ones that take a function included; a class, an interface or a type
  alias; an `enum`; a module constant; an override; a binding; a module variable; a `namespace`.
- **The forms:** `import { a, b as c } from "./x.shade.ts"`, `import type` and an inline `type`,
  `import * as x from "./x.shade.ts"` read one name at a time (`x.fbm(p)`), and the re-exports
  `export { a } from`, `export { a as b } from` and `export * from`. A file that only re-exports
  (an `index.shade.ts`) is a module like any other.
- **Refused, with `TS8072` (below):** a default import or export, an import that names nothing
  (`import "./x.shade.ts"`), `import(...)` and `require`, a module namespace used as a value, a
  package (a bare specifier), a file that does not begin with the directive, and a name the file
  does not export.

### The specifier

A specifier is relative (`./`, `../`) and is resolved against the importing file's path:
`./noise.shade.ts` as written, `./noise.shade.js` and `./noise.shade.mjs` as `.ts`, and `.ts`
appended to any other path. It is the rule the language service applies today
(`defaultResolveImport` in `src/language-service/host.ts`), and `./lib.shade.js` is the spelling
the editor extension's fixtures already write. It moves where the compiler reads it too, so the two halves
cannot resolve one specifier to two files (`AGENTS.md#gate-discipline`, one authority). The move
fixes one case on the way: that function reads `.shade` in `./noise.shade` as an extension and
appends nothing.

A file is a shader module by its directive (Rule 3.1), as it is to the compiler and the editor
today; its name does not decide it. `*.shade.ts` stays the name a host imports (Rule 3.8).

### One program, one module

A compile starts from one file, the entry: the source handed to `compile()`, the module the Vite
plugin transforms, the document the editor analyses. The entry and the shader files it imports,
directly or through another, are one program, and the program emits one WGSL module, one pair of
GLSL ES 3.00 stages and one CPU module.

- **What the module holds:** the entry file's declarations and what it re-exports, and, of each
  imported file, the declarations those reach through calls, types and reads. An imported file's
  own entry points are left out otherwise: nothing may call one (Rule 8.6), and a library that
  carries a demo entry of its own imports without it or the bindings it reads.
- **Scope is TypeScript's.** A declaration is named in its own file and, when exported, in the
  files that import it. A private `hash` in two files is two functions.
- **One namespace in the emitted module.** A declaration is emitted under its written name (Rule
  3.2) unless that name would make it answer for a name it is not: a declaration of another file
  with the same name, or a builtin that another file calls and that this declaration would hide
  (Rule 9.5). It is then emitted as `stem_name`, where `stem` is its file's name without
  `.shade.ts` or `.ts`, with a number appended while that is taken too (Rule 3.5). Between two
  declarations, the one emitted later is renamed, and the entry file is emitted first, then each
  imported file in import order, so the entry's own names are the ones kept.
- **An entry point and a binding are never renamed.** The pipeline, `reflect()` and an entry
  call's `bindings` (Rule 8.24) know them by name, so two bindings of one name in one module stay
  `TS8023`, naming both files, as `compileTsSources` reports them today. A `declare` binding with
  no slot is numbered after the bindings of the files emitted before it, so an import never moves
  the entry's own slots.
- **Each file's module scope is its own.** A file's constants, module variables, overrides,
  bindings, structs, enums and namespaces are declared in it and read by its functions, whether
  or not it is the entry. The entry-only rule for constants and module variables goes.
- **Per program, not per file:** a generic function or class is compiled once per set of type
  arguments the program uses (Rule 8.9), and a static field is a module constant when nothing in
  the program writes it (Rule 8.13).
- **A file may import a file that imports it.** A cycle of imports is a cycle of declarations,
  which has no order to get wrong. A cycle of calls through it stays refused (Rule 8.4), as does a
  constant whose value depends on itself.

### What `TS8072` says

One code for every import the compiler does not follow (Rule 3.7 claims the next free number, and
Rule 12.1 shapes each text). Proposed texts, pinned by the implementing tests (Rule 12.5):

| What the file writes                         | `TS8072`                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| a path that names no file                    | `Cannot find the shader module "./nosie.shade.ts" (looked for "src/nosie.shade.ts").`                                                           |
| a file the compile cannot read               | `"./noise.shade.ts" was not read: this compile has no readDocument. Pass compile() a readDocument that returns the file's text.`                |
| a file without the directive                 | `"./util.ts" is not a shader module: it does not begin with "use typeshade". A shader module imports only another shader module.`               |
| a package                                    | `"shade-noise" is a package, and a shader module imports only a file, by a relative path such as "./noise.shade.ts".`                           |
| a name the file declares and does not export | `"noise.shade.ts" declares "hash" and does not export it. Export it there, or declare what you need in this file.`                              |
| a name the file does not declare             | `"noise.shade.ts" has no export "fmb". Did you mean "fbm"?` (the name-lookup order of §12, which already lists "an import")                     |
| a default import or export                   | `A shader module has no default export. Import the names you use: import { fbm } from "./noise.shade.ts".`                                      |
| an import that names nothing                 | `This import names nothing, and importing a shader module does nothing else. Import the names you use: import { fbm } from "./noise.shade.ts".` |
| `import(...)` or `require(...)`              | `A shader module is imported by an import declaration at the top of the file: import { fbm } from "./noise.shade.ts".`                          |
| a module namespace used as a value           | `"noise" is a module namespace, read one name at a time (noise.fbm). It is not a value.`                                                        |

In the editor, TypeScript finds some of the same mistakes (`TS2307`, `TS2305`, `TS2459`). One
mistake reads as one diagnostic (Rule 12.4): each pair joins `SAME_MISTAKE` in
`src/language-service/diagnostics.ts`, which keeps the compiler's diagnostic, as it keeps `TS8004`
over `TS2304` today.

`TS8004`'s and `TS8002`'s remedy, "or import it from another shader module", becomes true on every
path, and its text does not change.

### The API

- **`compile(source, options)`** takes the two hooks the language service already names
  (`TypeshadeLanguageServiceHost`): `readDocument(fileName)`, which returns an imported file's
  text or `undefined`, and `resolveImport(fromFile, specifier)`, which defaults to the rule above.
  `fileName` is the entry's path, and imports resolve against it. A compile with no `readDocument`
  reads nothing, so a single file compiles as it does today, and an import in it is `TS8072`.

  ```ts
  import { existsSync, readFileSync } from 'node:fs';
  import { compile } from 'typeshade';

  const read = (fileName: string) =>
    existsSync(fileName) ? readFileSync(fileName, 'utf8') : undefined;
  const r = compile(read('src/clouds.shade.ts')!, {
    fileName: 'src/clouds.shade.ts',
    readDocument: read,
  });
  ```

  A diagnostic located in an imported file carries that file's `fileName` and offsets into that
  file, which `TsCompilerDiagnostic` can already say. `module` is the whole program.

- **`compileTsSource(source, options)`** takes the same two options, since the host face and the
  language service lower through it.
- **`compileTsSources` stays internal.** #187 proposed exporting it; this proposal does not (the
  first decision below). The doc-snippets test and the debugger's two-file test move to
  `compile()` with a `readDocument` over their record of files.
- **The Vite plugin** reads each import from disk through the same hook and calls
  `this.addWatchFile` for each file the program reads, so `vite dev` transforms the importer
  again when a file it imports changes. `TypeshadeVitePlugin.transform` gains that `this`. The
  host face is the entry file's exports and re-exports (Rule 8.20); a struct from another file in
  one of their signatures is written into the host view as its host type, so a view never imports
  another view. The generated module carries the whole program, so one shader module's generated
  code never imports another's.
- **`typeshade check` and `typeshade sync`** read imports from disk through the same hooks
  (`checkDocuments` already takes `readDocument`). A diagnostic located in a file the command was
  not given is reported under that file's path, once.
- **The language service** analyses a document as the entry of its program: its TypeShade half
  reads each import the way its TypeScript half already does, an open document's text first and
  `readDocument` otherwise. A document's list is the diagnostics located in it, so an error in an
  imported file is shown on that file, as `tsc` shows it. The analysis cache's `dependencyKey`
  already follows a document's imports; it follows them transitively, so an edit to a file two
  imports away reaches the entry.
- **The debugger** already steps across files (`src/core/debug/step-multifile.test.ts`): each
  statement's span carries its own file. It changes nowhere but in the compile it is handed.

## Why

- **`docs/dx.md` principle 8:** "TypeShade code is shared the way TypeScript code is", and "Today
  this is the gap that blocks an ecosystem." That principle's test is package imports (roadmap
  X6); relative imports between files are the step it stands on.
- **#187, the owner's own measurement:** the engine works and no consumer can reach it. Its four
  items are this proposal's API, the specifier, the editor half, and the gate example.
- **The copies it costs today.** `domain-warp-twin`, `kaleidoscope-twin`, `ocean-twin`,
  `starfield-twin` and `voronoi-twin` each carry their own hash and value noise, and #184 was
  the one wrong hash all of them had copied.
- **The editor's two halves disagree about one line (Rule 12.7).** Its TypeScript half resolves
  the import and types the call; its TypeShade half refuses the same call with `TS8004`. The
  compiler's own multi-file path accepts the program, so the refusal is the one-file path's
  answer, not the language's.

Alternatives considered:

- **Export `compileTsSources` as it is** (#187 item 1). The caller finds and reads the whole
  import graph and hands it in as an array, so each caller writes its own resolution, and the
  plugin's, the command's and the editor's can disagree. It follows functions only, and it
  leaves `compile()`, the plugin, the command and the editor as they are, which is where the
  refusal is met.
- **Follow imports in the bundler only.** Vite would compile the importer with its imports and
  every other path would stay one file: `compile()`, `typeshade check` and the editor would refuse
  a program the build accepts, which is Rule 12.7 broken the other way.
- **Import functions only**, as `compileTsSources` does, and keep the rest per file. A noise
  library works; a shared `Camera` struct, a `PI`-style constant or an `enum` does not, and each
  kind left out is one more place where TypeScript accepts the import and the compiler refuses it.
- **Refuse a name two files declare**, as `TS8023` does for two structs today. TypeScript lets two
  files each keep a private `hash`, and a library's private helpers would then decide what every
  file that imports it may call its own.
- **Emit every declaration of every imported file.** It is what `compileTsSources` does. A library
  with a demo entry would put that entry and its bindings into every module that imports one
  function of it.

## What it touches

- **Rule 3.9 (new):** a shader file imports another's exports by a relative specifier; the entry
  and the files it imports are one program, which emits one module; each file keeps TypeScript's
  scope; what may be imported, and what is refused with `TS8072`.
- **Rule 3.2:** "the compiler must emit a declared name as written" gains its one exception: a
  declaration whose name another declaration of the module keeps, or whose name would hide a
  builtin another file calls, takes the generated name `stem_name`; an entry point and a binding
  are never renamed.
- **Rule 8.9:** "once per set of type arguments the file uses" becomes "the program uses".
- **Rule 8.13:** "when nothing in the file writes it" becomes "nothing in the program".
- **Rule 8.20:** a module's host face includes what it re-exports, and a struct another file
  declares is a type of the host face where an export's signature names it.
- **Rule 9.5:** "A function the file declares" becomes "the file declares or imports".
- **Surface §68 (new), "Importing another shader module":** the next free number (Rule 3.7). The
  forms, the specifier, one program and one module, the names the module emits, the refusals.
- **Surface §64:** "one file is one module" goes; the plugin follows imports, watches the files it
  read, and writes a view with no import of another view.
- **`CompileOptions`** and **`CompileTsSourceOptions`** gain `readDocument` and `resolveImport`.
- **`TypeshadeVitePlugin`:** `transform` takes Rollup's plugin context as `this`, for
  `addWatchFile`.
- **`TS8072` (new):** every import the compiler does not follow, with the texts above.
- **Example `imported-noise` (new):** `examples/imported-noise.shade.ts`, a fragment entry that
  draws the `fbm` of `examples/lib/noise.shade.ts`. The library sits in a subdirectory, so it is
  not an example of its own; the compile gate reads it through the example's import, on Tint and
  on WebGL2 (#187 item 4). The five twins keep their copies here; moving them into the library is
  its own change, since it moves their goldens.
- **Code.**
  - `src/compiler/ts/module.ts`: the program. It links the files before it lowers, so every
    collector (classes, enums, namespaces, generics, constants, bindings) runs over the linked
    program the way it runs over one file today, rather than learning files one at a time.
  - `src/compiler/ts/compile.ts`, `src/compiler/ts/source-file.ts`: the two hooks.
  - `src/language-service/host.ts`: the specifier rule moves to a module both halves import.
  - `src/language-service/service.ts`: the TypeShade half analyses the program, and the
    `dependencyKey` follows imports transitively.
  - `src/language-service/check.ts`, `src/cli/`: the command reads imports and reports each
    diagnostic under its own file.
  - `src/vite.ts`, `src/compiler/ts/host-face.ts`: the plugin's hook, `addWatchFile`, the host
    view's struct types.
  - `src/compiler/ts/codes.ts`: `TS8072`.
- **Docs.** `AUTHORING.md` gains a section on importing another shader module.
  `docs/use-typeshade.md`'s "Unit", "Modules" and "Compiling" say what `compile()` follows, and
  lose "Bundling several files into one compilation unit is **not** on the public surface yet".
  `docs/roadmap.md` (".shade.ts files already import each other", items 14 and X6), `docs/dx.md`
  principle 8 (a package import becomes `TS8072`, and the single-file `TS8004` goes),
  `docs/language-service-api.md` §11 (naming a struct in an import) and `src/AGENTS.md`'s
  `module.ts` row follow. A CHANGELOG entry (Rule 13.8).
- **Tests.**
  - A two-file parity test in `src/language-service/`, on the same sources for both halves (Rule
    12.7, and "A test reads both halves" in `CLAUDE.md`): `compile()` with `readDocument` and the
    service's `getDiagnostics` accept each row of the second table above, and each `TS8072` row
    is refused by both with the same text.
  - The emitted names: two files with a private `hash` each compile, `validate()` accepts the
    module, and the CPU oracle returns each file's own answer (measured today: `validate()`
    refuses the module with `SD0020`).
  - A library with an entry of its own, imported for one function, adds neither the entry nor its
    bindings to the importer's module.
  - The Vite plugin: a `.shade.ts` that imports another compiles, the view is written, and an
    edit to the imported file is watched. The import journey (`journeys/_host-import/`) gains a
    host call of a function that calls into an imported file.
  - `typeshade check` of one file whose import holds an error reports it under the imported file.
  - The compile gate runs `imported-noise`, and the example's golden is baked.

## What it owes downstream

Found by searching each repository for the one-file assumption and for every name above.

**typeshade.github.io**

- **Error codes.** The `TS8004` page (`src/lib/error-codes.ts`) fixes an unknown function only by
  declaring it in the file; it gains the import, with a two-file example compiled with a
  `readDocument`. Its one-line description, "A call to a function the file neither declares nor
  imports" (`src/i18n/en.ts`, `ko.ts`), becomes true and stays. A new `TS8072` page with a trigger
  and a fix, in both locales, as 0012 and 0014 added theirs.
- **The copy that says a file is the whole program:** "a shader compilation unit", "the file is
  the whole program", "`import` and `export` define reusable program boundaries", and the
  Playground's "the editor holds this example's own file" (`src/i18n/en.ts` and `ko.ts`, and
  `DESIGN.md`'s matching lines) say that a program is the file and the files it imports.
- **The Playground and the build-time compile.** `src/lib/shade-examples.ts` compiles each example
  with `compile(readFileSync(...))`, and the Playground's language worker creates its service with
  no host and calls `compile(text)`; both pass a `readDocument` over the example's directory, so
  `imported-noise` compiles with `lib/noise.shade.ts`. `src/lib/playground-examples.ts` lists the
  new id (its directory scan does not read `lib/`, so the library is not an example there either),
  and the gallery, the picker and the Korean blurbs gain it. The Playground keeps one editor; the
  page says which file the example imports.
- **The language service page** (`LanguageServicePage.astro` and its copy) names `readDocument`
  and `resolveImport`, the hooks through which the service follows an import. The API reference
  lists the two new `compile()` options.
- **The Korean guide:** the sections `AUTHORING.md` gains (`bun run check:guide` lists them).

**vscode-typeshade**

- **The tsserver test** "resolves an import between two shaders"
  (`packages/tsserver-plugin/src/tsserver.test.ts`) asserts the `TS8004` on the cross-file call;
  it asserts none. The assertions there, in `documents.test.ts` and in the MCP server's
  `tools.test.ts` that expect TypeScript's `TS2305` after the export is renamed follow the merge
  that keeps `TS8072` for that mistake (Rule 12.4). `packages/vscode-typeshade/src/model.test.ts`
  gains the same assertion, and the MCP fixture that imports `double` without calling it can
  call it.
- **The skill.** SKILL.md's rule "One file is one module ... Keep each shader self-contained" and
  its `TS8004` line, `references/language.md` ("copy helpers"; `new` on the file's own classes),
  `references/diagnostics.md` (`TS8004`, `TS8013`) and `references/host.md`'s one-file
  `compile(readFileSync(...))` recipes, which gain a `readDocument`.
- **One-file compiles in the adapters.** The MCP server's `compile` and `run` tools
  (`packages/mcp-server/src/tools.ts`) and the extension's reflection tab, entry list and Run
  Entry (`packages/vscode-typeshade/src/model.ts`, `compileTsSource(document.text)`) pass a
  `readDocument`. The extension's own `readDocument` answers from open documents only; it reads a
  file on disk that carries the directive, as the tsserver plugin's does.
- **`docs/design.md` §1.7** (the compiler's multi-file story, and naming a struct in an import
  as still open) and **`docs/agents.md` §8 item 3** (the decision to report `TS8004` as the
  compiler does) record the change; the debug adapter's `launch` compiles with a `readDocument`.

## What comes next

- **Roadmap X6:** a bare specifier resolved through `node_modules`, so a library of TypeShade
  functions is published and imported by name. With the resolver a hook, this is a change to the
  resolver and not to the program.
- **The five twins' noise** moved into `examples/lib/noise.shade.ts`.
- **A Playground with more than one file**, if the site wants one beyond what the example needs.

## Decisions for the reviewer

Accepting this proposal accepts each of these. Each is the recommendation above, and each can be
changed before acceptance without touching the rest:

1. The API is two hooks on `compile()` and `compileTsSource`, `readDocument` and `resolveImport`,
   named and behaving as the language service's, and `compileTsSources` stays internal; not an
   exported array API (#187 item 1).
2. Everything a file can declare at the top level can be exported and imported, with named
   imports, type imports, `import * as` read one name at a time, and re-exports. Default exports,
   imports that name nothing, `import(...)` and `require` are refused with `TS8072`.
3. The module holds the entry file's declarations and what it re-exports, and, of the imported
   files, only what those reach; an imported file's entry points are left out unless the entry
   file re-exports them.
4. Two files may declare one name. The declaration emitted first keeps it (the entry file's before
   an imported file's), and the other becomes `stem_name`, as does a declaration that would hide a
   builtin another file calls. An entry point and a binding are never renamed, so two bindings of
   one name in one module stay refused.
5. One specifier rule for the compiler and the editor: relative only, `.js` and `.mjs` read as
   `.ts`, `.ts` appended to anything else. A package import is refused until X6.
6. A shader module is known by its directive (Rule 3.1), not by its name; importing a file without
   the directive is refused.
7. A diagnostic located in an imported file belongs to that file: `compile()` and `typeshade check`
   report it with that file's name, and the editor shows it on that file, not on the importer.
8. One new code, `TS8072`, for every import the compiler does not follow.
