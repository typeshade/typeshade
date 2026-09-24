---
id: '0009'
title: An ordinary TypeScript file imports a `.shade.ts` and calls its exported functions, which run on the CPU tier, with host types that plain `tsc` reads
status: accepted
rules:
- '3.1'
- '3.8'
- '8.20'
- '8.21'
- '11.7'
surface:
- 64
exports:
- typeshade
- TypeshadeVitePlugin
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The "No runtime" copy (en and ko runtimeH/runtimeP and the motivation FAQ's no-runtime line, README.md, PRODUCT.md, llms.txt), and the quick start and front-page install, which gain the import path (the plugin line, two tsconfig lines, typeshade sync); the API reference's "every export" sentence and a typeshade/vite entry; the Korean guide sections AUTHORING.md changes, re-translated
- repo: vscode-typeshade
  what: The skill's compiler-only claims (SKILL.md intro, description and host section, references/host.md) rewritten around the import; docs/design.md §1.6, §1.8 and §8 item 9 (a host file now reads a generated host view; createShaderTsconfig adds moduleSuffixes), §1.4's "not the rule" for .shade.ts and the .shade.js specifier convention; a tsserver fixture for a host file that calls an export
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Roadmap item 16 is the import: an ordinary `.ts` file imports a `.shade.ts` and calls what it
exports. This proposal is its first half. A host file can call the module's exported functions,
and they run on the CPU tier. Calling an entry point on a GPU (a hand-written `@compute` entry, a
fragment entry that draws a frame), `configure({ prefer })` and the WebGPU and WebGL2 tiers are
the second half, a later proposal. It builds on the contract this one fixes (see "What comes
next").

Today a host file cannot import a shader module at all. `src/compiler/ts/vite.ts` default-exports
a JSON pack. It is not on any subpath, and it drops overrides, module variables and enables. The
host program cannot type-check the import either: see "Why".

After this change:

```ts
// terrain.shade.ts
'use typeshade';

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

export default defineConfig({ plugins: [typeshade()] });
```

```ts
// app.ts, ordinary TypeScript under the project's own tsconfig and lib
import { height } from './terrain.shade.ts';

const h = height([0.5, 0.5], [1, 0.5, 2, 0.25]); // a number, computed as the GPU would, on the CPU
```

- **The call is the whole API** (roadmap, "The run layer has no import"). `height` is a plain
  synchronous function. The generated module runs the oracle's generated code for it, at `f32`
  precision (Rule 11.7). No device, buffer or compile step appears in user code, and
  `typescript` is needed at build time only.
- **Which exports a host can call** (Rule 8.20): an exported function that:
  - is not an entry point;
  - is not generic and takes no function;
  - has a host value for each parameter and for its result;
  - reaches no binding and no GPU-only builtin.

  The host face also carries an exported constant and an `enum` (as values), and an exported
  struct (as a type). Every other export is declared `never` in the host view, with a comment
  saying why and which proposal adds it. So a call of one is a type error at the host's own
  line, not a crash.

- **Host values** (surface §64, Rule 8.21) are the representation the CPU tier already uses
  (`src/core/cpu-runtime.ts`):

  | TypeShade type                            | argument                                                   | result         |
  | ----------------------------------------- | ---------------------------------------------------------- | -------------- |
  | `f32`, `f64`                              | `number` (an `f32` is rounded as a buffer write rounds it) | `number`       |
  | `i32`, `u32`                              | `number`, an integer in the type's range                   | `number`       |
  | `bool`                                    | `boolean`                                                  | `boolean`      |
  | `vecN` and its `f`, `i`, `u`, `f64` forms | `readonly [number, …]` of N                                | `[number, …]`  |
  | `vecNb`                                   | `readonly [boolean, …]` of N                               | `[boolean, …]` |
  | `matCxR`                                  | `readonly number[]` of C×R, column-major                   | `number[]`     |
  | `array<T, N>`                             | `readonly T[]` of N                                        | `T[]`          |
  | a struct                                  | an object of its fields                                    | the same       |
  | an `enum`                                 | the member's number                                        | the same       |

  An argument is checked and converted: an `ArrayLike` of the right length becomes an array. A
  value that does not fit is refused with a `TypeError` naming the function, the parameter and
  its TypeShade type. A result never aliases an argument (Rule 8.8). Runtime-sized arrays,
  atomics, textures, samplers and bindings have no host value in this proposal: they belong to
  item 15 and to the second half.

- **The host program type-checks with plain `tsc`, with precise types.** The plugin writes a
  _host view_ beside each shader module, `terrain.shade.typeshade.ts`:

  ```ts
  // Generated by typeshade from terrain.shade.ts. Do not edit; `typeshade sync` rewrites it.
  export declare function height(
    p: readonly [number, number],
    k: readonly [number, number, number, number],
  ): number;
  ```

  The project's `tsconfig` gains two lines. With them, TypeScript resolves
  `./terrain.shade.ts` to the view, while Vite still resolves it to the source:

  ```jsonc
  "moduleSuffixes": [".typeshade", ""],
  "exclude": ["src/**/*.shade.ts"]
  ```

  The plugin rewrites a view when its module changes, in `vite dev` and in `vite build`.
  `typeshade sync` writes every view for a clean checkout before `tsc` runs. Its home is the
  `prepare` script, as `svelte-kit sync` is SvelteKit's. The views are generated files and are
  git-ignored.

- **The shader module is picked by its name** (Rule 3.8): `*.shade.ts`, whose first statement is
  the directive (Rule 3.1). A host import of a `.ts` file that begins with the directive is
  refused at build time, with the rename. A shader module with compile errors fails the build,
  with each `TS80xx` diagnostic at its file, line and column.
- **One file per shader module.** A `.shade.ts` that imports another `.shade.ts` stays `TS8004`,
  as it is in `compile()` and in the editor today. The multi-file path waits for #187, whose
  editor half decides whether it is real.

## Why

Item 16 is the item the rest of the second half of 1.0 stands on:

- X2, X5 and X6 each need it;
- X1 needs it and item 15;
- B1's desugaring (#198 step 3) and the rendering design (#204) build on its plugin and its
  calling contract.

The roadmap orders it first in 0.5 ("Items 14 to 17, 16 first"). Four things stood in the way,
and this proposal settles each on measurements. The measurements were taken on TypeScript 5.6.3
(the repository's pin), with a packed tarball installed in a fresh project and a strict host
`tsconfig` (`lib: ["es2022", "dom"]`, `moduleResolution: "bundler"`).

**1. The host program cannot read the shader source.** "The shape of just run" says that "the
source signature is the host signature and nothing has to be generated for the editor". That
does not hold. TypeScript resolves `./terrain.shade.ts` to the source file itself, and the source
cannot type-check in a host program:

| Host setup                                 | `tsc` errors | Host types                                     |
| ------------------------------------------ | ------------ | ---------------------------------------------- |
| a plain import                             | 29           | every shader-typed parameter is silently `any` |
| + `exclude: ["**/*.shade.ts"]`             | 29           | the import pulls the source back in            |
| + `types: ["typeshade/shade"]`             | 28           | `[0.5, 0.5]` is not a `vec2` (the brand)       |
| + `skipLibCheck`, `experimentalDecorators` | 11 or more   | the same                                       |

The errors are of three kinds:

- `TS1206` on every decorator on a function or a parameter. It is a grammar error, so no
  declaration file removes it.
- The shader vocabulary colliding with the DOM: `@location(0)` resolves to `window.location`,
  `length(p.xy)` to `window.length`, and `Math` and `console` are redeclared.
- The branded vector types, which a host array does not satisfy.

So the host must read something other than the source. What decides the mechanism is where
TypeScript lets a generated file win:

| Mechanism                                                                           | Result                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| a sibling `terrain.shade.d.ts`                                                      | 29: a `.ts` beats a `.d.ts` at the same stem                                                   |
| `declare module '*.shade.ts'`                                                       | 29: a wildcard is used only when no file resolves, and it gives `any` besides                  |
| `rootDirs`, or `paths` with a relative import                                       | 29                                                                                             |
| project references                                                                  | red: the shader project cannot build (TS1206), and tsserver reads the source anyway            |
| `allowArbitraryExtensions` + `terrain.d.shade.ts`                                   | 0, but only for the spelling `./terrain.shade`, plus `exclude`                                 |
| `paths` or `package.json#imports`, with a bare `~shade/terrain` or `#shade/terrain` | 0, but a new spelling, `exclude`, and a Vite alias                                             |
| `./terrain.shade.mjs` + a generated `terrain.shade.d.mts`                           | 0 with no flag, but an odd spelling, `exclude`, and a plugin `resolveId`                       |
| a vue-tsc-style checker that serves the view in memory                              | 0 with no `tsconfig` change, but it replaces `tsc`, and every other TS-program tool sees `any` |
| **`moduleSuffixes: [".typeshade", ""]` + a generated `.typeshade.ts`**              | **0 in `tsc` and tsserver, precise types, the roadmap's own spelling; two `tsconfig` lines**   |

The chosen row keeps `import … from './terrain.shade.ts'`. `tsc` and tsserver were measured.
typescript-eslint's type-aware rules and `vitest --typecheck` build their program from the same
`tsconfig`, so they resolve the import the same way. Vite ignores `moduleSuffixes`, so the bundle
reads the source through the plugin. That was measured on Vite 7.3.6.

The view must be a `.ts`, not a `.d.ts`: a `.d.ts` at that name still loses to the source, which
was measured at 29 errors. The suffix must name the tool. With `.host`, an unrelated
`import './server.ts'` resolved to a `server.host.ts` beside it. With `.typeshade` it resolved to
`server.ts`, and `./terrain.shade.ts` resolved to the view. A wrong-length vector
(`height([0.5], …)`) is a type error at the host's line.

Before the views exist, on a clean checkout, `tsc` falls back to the source and reports the 29
errors. create-vite's `build` script runs `tsc` before `vite build`, so a plugin hook is too
late. That is why `typeshade sync` exists, and why `prepare` is its home.

**2. Host values were undefined.** The roadmap's host line calls `height(vec2(0.5, 0.5), k)`.
The only `vec2` a host can import today is the IR builder, which returns a node. Passed to the
CPU code, that node gives `NaN` silently. The CPU tier represents vectors as `number[]`, matrices
as flat column-major arrays and structs as objects. A `Float32Array` passed as a vector is wrong
in silence: `a + b` gave the string `"1,210,20"`. So this proposal takes the representation the
oracle already has, types it precisely in the view, and converts or refuses at the call (Rule
8.21). The roadmap line becomes `height([0.5, 0.5], k)`.

**3. The CPU tier's precision.** `compileModuleJs` defaults to the `f64` algebra oracle, "blind by
construction to f32 rounding" (`src/core/oracle.ts`). Its `'f32'` mode is "a correctly-rounding
f32 machine over the same IR". A host call computes what the GPU would, so it runs in `'f32'`
(Rule 11.7).

**4. What an export is.** The IR does not keep the source's export list. A generic function
exists only as its instances (`ident_f32`), and a function that takes a function only per use
(`apply_sq`). A class method becomes `P_len`, and an enum becomes the constants `Mode_A` and
`Mode_B`. So the host face is computed from the source's exports and the lowering's symbol
table, not from the IR's function list (Rule 8.20).

Alternatives considered:

- **A vue-tsc-style checker** (`typeshade check` serving the views in memory), which needs no
  `tsconfig` line. It replaces `tsc` in the build script. Every other tool that builds a program
  from the `tsconfig` sees the source, and so `any` and 29 errors: typescript-eslint,
  `vitest --typecheck`, and editors without the extension. The two `tsconfig` lines reach all of
  them. If the maintainer weighs zero `tsconfig` lines above that, this is the one to take, and
  the rest of the proposal stands unchanged.
- **Ship `unplugin` as a dependency**, as roadmap row 16 names it. The site's build refuses any
  runtime dependency but `typescript` (`typeshade.github.io` `src/lib/examples.ts`). `AGENTS.md`
  states one runtime dependency, and the editor's bundles admit no third-party code. The plugin
  is instead a Vite and Rollup plugin object with no import, as `src/compiler/ts/vite.ts` already
  is. An unplugin adapter for webpack, esbuild and Rspack can follow as an optional peer, when
  someone asks for one of them.
- **Run the CPU code through `new Function` at run time**, as `compileModuleJs` does. That needs
  `unsafe-eval`, which a strict CSP forbids. It also ships the IR and the code generator, and the
  generator alone is 92 KiB minified.
  The plugin instead emits the generated code as module code, which the bundler minifies, and
  `typeshade/runtime` holds only its helpers.
- **Every export returns a `Promise`**, so that no later tier changes a call site. A helper that
  cannot run on a GPU would then cost an `await` for nothing. That is the implicit cost
  `docs/dx.md` principle 4 forbids. The later tiers take new shapes instead: an entry point, and
  a runtime-sized array parameter (item 15). Those are asynchronous from the day they appear, so
  a synchronous call site stays synchronous (Rule 8.21).

## What it touches

- **Rule 3.1.** The rationale says the directive tells "the compiler, the language service, and
  the bundler". It will say that the bundler and the host's `tsconfig` read the file name first
  (Rule 3.8).
- **Rule 3.8 (new).** A shader module that host code imports is named `*.shade.ts`, and a host
  import of a `.ts` that begins with the directive is refused. The plugin enforces it.
- **Rule 8.20 (new).** Which exports are callable from host code, and that every other export is
  in the host view as `never`, with the reason.
- **Rule 8.21 (new).** A host call passes and returns host values by value, checks and converts
  each argument, returns no alias, and is synchronous, which no later tier changes.
- **Rule 11.7 (new).** The CPU tier is the oracle's generated code at `f32` precision.
- **Surface §64 (new): "Calling a module from host code".** It is the next free number (Rule 3.7),
  and no open branch claims it. It holds the host value table, the host face of each kind of
  export, the host view and its two `tsconfig` lines, and a module whose snippets the doc-snippet
  suite compiles.
- **Exports.** `typeshade/vite` is a new subpath, baked into `src/__api__/surface.md` (Rule 11.6),
  with two exports:
  - `typeshade()`, the plugin;
  - `TypeshadeVitePlugin`, the structural type it returns.

  `typeshade/runtime` is a new subpath, listed in `NOT_API_SUBPATHS`. Only generated modules
  import it, from the same package version as the plugin that wrote them.

- **No code, no example.** A build refusal carries the module's own `TS80xx` diagnostics. A call
  refusal is a `TypeError` at run time.
- **Code.**
  - `src/vite.ts` and `src/runtime.ts` are new entry points. `package.json` gains `./vite`,
    `./runtime`. The `typeshade` bin that #210 added (`src/cli/bin.ts`, beside `check`) gains
    `sync`.
  - `src/compiler/ts/host-face.ts` (new) computes the callable set, the host types, the view
    text and the generated module text.
  - `src/core/cpu-codegen.ts` returns the source it generates next to what it returns today.
    `compileModuleJs` is unchanged.
  - `src/compiler/ts/vite.ts` is deleted, because the new plugin replaces it. Its test,
    `vite.test.ts`, moves to the new plugin, and the comment in `examples/_shade.ts` that names
    it is updated.
  - `src/api-surface.test.ts` gains `./vite`. `src/api-doc-coverage.test.ts` gains `./vite` in
    `API_SUBPATHS` and `./runtime` in `NOT_API_SUBPATHS`, with the reason.
- **Docs that become false or incomplete,** each fixed in the implementing pull request:
  - `README.md`: "no runtime dependency", "does not own the rendering or compute runtime", and
    the list of subpaths.
  - `src/AGENTS.md`: the entry-points table and the `vite.ts` line.
  - `AUTHORING.md`: "Importing", and a new section for the host call.
  - `docs/use-typeshade.md`: "Host code never imports a TypeShade runtime", and the
    `typeshadeVite()` paragraph.
  - `docs/runtime-architecture.md`: §5, §15 and §20. This proposal answers §20's open questions
    for the CPU half.
  - `docs/dx.md`:
    - "A caller passes `number`, `Float32Array` and the vector types";
    - "There is no configuration";
    - the Zero-configuration bar, which becomes "the lines the setup lists, each checked by the
      journey";
    - "the primary path is not built yet".
  - `docs/roadmap.md`:
    - "the source signature is the host signature";
    - `height(vec2(0.5, 0.5), k)`;
    - row 16, which splits into this half and the GPU half;
    - row X2.
  - `docs/language-service-api.md`: the open question of extension against directive, which is
    decided here.
  - `examples/README.md`: "They are not importable TypeScript modules".
  - `journeys/README.md`: "TypeShade has no runtime".
  - `docs/use-typeshade-plan.md`, `docs/debugging.md` and `docs/benchmark-typescript.md`, which
    cite `vite.ts`.
  - A CHANGELOG entry (Rule 13.8).
- **Tests.**
  - `src/compiler/ts/host-face.test.ts`:
    - the callable set, with one case per exclusion of Rule 8.20;
    - the view text for every row of §64's table;
    - the argument checks and conversions, including a `Float32Array` vector and each refusal;
    - that a returned value aliases no argument;
    - that every call equals `compileModule(m, { precision: 'f32' })` on inputs where the `f32`
      and `f64` results part.
  - `src/vite.test.ts` drives the plugin's hooks. Vitest runs on Vite, so a test file imports a
    `.shade.ts` through the plugin and calls the export. It also covers:
    - the Rule 3.8 refusal;
    - a module with errors failing the build with its diagnostics;
    - `typeshade sync` writing and checking the views.
  - **A journey (the X2 check).** A fresh project with `vite` and `typescript` installs the
    tarball, adds the documented lines, and runs `typeshade sync`. It then checks:
    - `tsc` reports 0 errors, and a deliberately wrong host call is caught;
    - `vite build` succeeds;
    - Node runs the bundle, and each call matches the plain-JavaScript reference.

## What it owes downstream

**typeshade.github.io**

- **The "No runtime" copy.** A runtime now ships with an application that imports a
  `.shade.ts`. The places that say otherwise:
  - `runtimeH` and `runtimeP` in `src/i18n/en.ts` and `ko.ts` (the WebGPU and WebGL2 concept
    page);
  - "There is no TypeShade runtime" in `README.md`, and "There is no TypeShade runtime to ship
    with the application" in the motivation page's answer to "What does the compiler produce?"
    (`motivation` in `en.ts` and `ko.ts`);
  - `PRODUCT.md`'s "No runtime dependency ships with an application";
  - `src/pages/llms.txt.ts`.
- **The quick start and the front-page install** gain the import path:
  - the `vite.config` line;
  - the two `tsconfig` lines;
  - `typeshade sync` in `prepare`;
  - the `.gitignore` line.

  The WebGPU host section becomes the escape hatch it is.

- **The API reference** reads only the root barrel (`src/lib/api.ts`). Two things change:
  - "Every export of the typeshade package" is no longer true;
  - `typeshade/vite` needs an entry.
- **The Korean guide.** `content/guide/ko/overview.md` translates `AUTHORING.md`'s "Importing",
  which this changes. The new host-call section needs its own page. `bun run check:guide` names
  both.
- **Not owed yet.** The GPU ownership table ("No TypeShade code touches a WebGPU object") and the
  "host owns runtime objects" copy stay true until the second half. The site's runtime-dependency
  guard stays green, because this adds no dependency.

**vscode-typeshade**

- **The skill.**
  - `references/host.md` says "has no runtime" and "a `.shade.ts` file is never imported as a
    module at run time".
  - `SKILL.md` says "It is a compiler only", its host section shows only `compile()` and
    `reflect()`, and its description triggers only on wiring the emitted text into host code.
    Each is rewritten around the import.
- **`docs/design.md`.**
  - §1.6 leaves the host side as plain TypeScript, where a vector type is unresolved. A host file
    now reads the generated view instead.
  - §1.8 and §8 item 9: the `typeshade.createShaderTsconfig` remedy adds `moduleSuffixes` beside
    its `exclude`. On its own, `exclude` does not stop an import from pulling the source back in.
  - §1.4 calls `.shade.ts` "a convention … It is not the rule". For a host import it now is the
    rule (Rule 3.8). The directive stays the rule for what a shader is, which is the part §1.4
    relies on.
  - The `./x.shade.js` specifier convention (§1.6 and `packages/tsserver-plugin/src/fixtures.ts`)
    meets the roadmap's `./x.shade.ts`.
  - The preview-scope reason, which quotes the compiler's "ships the authoring and emit surface
    only", loses its premise.
- **A new tsserver fixture:** a host file that imports a `.shade.ts` through its view and calls an
  export with vector arguments.

## What comes next

These follow in their own proposals and keep every call site this one creates:

- **The GPU half of item 16:**
  - a hand-written `@compute` entry, called with its bindings as one trailing object and an
    invocation count, returning the bindings it wrote. It runs on WebGPU, with the CPU tier's
    `dispatch` as the fallback. GLSL ES 3.00 has no compute stage.
  - a fragment entry, drawing one frame into a canvas, with the full-screen triangle when the
    module has no `@vertex`. It runs on WebGPU, then WebGL2.
  - `configure({ prefer })`.
  - The site's `shader-runtime.ts` and `compute-runner.ts` are the measured starting point.
- **Item 15:** a runtime-sized array parameter and the loop that becomes a kernel. Its calls are
  asynchronous from the start.
- **X5:** `grad(f, 'k')` on an imported function. #187: the multi-file module, with its editor
  half.

## Decisions for the reviewer

Accepting this proposal accepts each of these. Each is the recommendation above, and each can be
changed before acceptance without touching the rest:

1. The host view with `moduleSuffixes` and `exclude` (two `tsconfig` lines, generated `.typeshade.ts`
   files, `typeshade sync` in `prepare`), over a checker that replaces `tsc`.
2. The suffix `.typeshade`, over the shorter `.host`, which captured an unrelated `server.host.ts`.
3. A plugin with no dependency, over `unplugin`.
4. Host values as `number`, `boolean`, arrays and objects, with a `vecN` typed as a tuple; no host
   `vec2()` constructor.
5. A synchronous CPU call for a helper, forever; the GPU tiers take new shapes, which are
   asynchronous.
6. The first half alone: the GPU entry calls in a proposal of their own.
