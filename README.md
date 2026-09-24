<p align="center">
  <a href="https://typeshade.dev/">
    <img height="112" src="https://typeshade.dev/favicon.svg" alt="TypeShade">
  </a>
</p>

<p align="center">
  <a href="https://github.com/typeshade/typeshade/actions/workflows/ci.yml"><img src="https://github.com/typeshade/typeshade/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
</p>

<p align="center">
  <a href="https://typeshade.dev/guide/quick-start/">Quick start</a> |
  <a href="https://typeshade.dev/guide/language/">Language guide</a> |
  <a href="https://typeshade.dev/api/">API</a> |
  <a href="https://typeshade.dev/guide/examples/">Examples</a> |
  <a href="https://typeshade.dev/guide/checks/">Verification</a> |
  <a href="https://typeshade.dev/ko/">한국어</a>
</p>

# [TypeShade](https://typeshade.dev/)

**Write shaders in TypeScript. Start with `"use typeshade"`.**

TypeShade is a shader language and compiler built around the TypeScript authoring experience. A TypeScript source file opts into TypeShade with the file-level `"use typeshade"` directive, then uses TypeShade's typed resources, value layouts and shader-stage entry points.

- **TypeScript-shaped authoring.** Keep familiar functions, types, expressions and modules where they fit the GPU execution model.
- **GPU semantics at the language boundary.** `declare` resources, GPU value types and stage decorators make shader constraints explicit in the source.
- **One source, multiple targets.** The compiler lowers the TypeShade source to a shared IR and emits WGSL for WebGPU and GLSL ES 3.00 for WebGL2 where the example supports both.
- **Typed in the editor.** TypeScript catches wrong types and misspelled fields before shader code is emitted.
- **Reflection.** `reflect(module)` exposes bind groups, layouts and entry signatures from the same IR used for emission.

TypeShade ships the authoring and emit surface, with no GPU runtime. Creating pipelines, binding resources and issuing draws stay with the host application. A host file can also import a `.shade.ts` and call its helper functions, which run on the CPU at `f32` precision ([surface §64](./docs/use-typeshade-surface.md#64-calling-a-module-from-host-code)): that is how host code shares a shader's math. A `@compute` entry imported the same way runs on the GPU: `entry(bindings, workgroups)` dispatches it on WebGPU, and a full-screen fragment entry draws into a canvas as `entry(canvas, bindings)` ([surface §67](./docs/use-typeshade-surface.md#67-calling-an-entry-point-from-host-code)).

The author-facing grammar is frozen in [`docs/use-typeshade-surface.md`](./docs/use-typeshade-surface.md). The compiler internals and `fn()` / `module()` APIs remain useful for tests, IR equality and the example gallery, but product code should start with `"use typeshade"`.

## Getting started

Start with the [Quick start](https://typeshade.dev/guide/quick-start/) and then follow the [Language guide](https://typeshade.dev/guide/language/). The recommended order is:

1. `"use typeshade"` and the file boundary
2. Types and value layouts
3. Functions and control flow
4. GPU types and resources
5. Shader stages
6. Complete examples
7. API reference when you need compiler details

Install it from npm:

```bash
npm install typeshade
```

The tarball ships compiled ESM with type declarations, so `import { compile } from 'typeshade'` needs no TypeScript toolchain. Alongside them it ships the `.ts` sources the declaration maps point at, so "go to definition" lands on real source. The public subpaths are `typeshade`, `typeshade/dev`, `typeshade/debug`, `typeshade/compute`, `typeshade/emit-prod`, `typeshade/vite`, `typeshade/core/ir`, `typeshade/examples` and `typeshade/language-service`; `typeshade/runtime` is what a module the Vite plugin generates imports, and is not API. `typescript` is a peer dependency (`>=5.0.0 <6`) and npm installs it for you: `compile()` is a TypeScript front end, so the main entry needs the parser at run time. TypeScript 7 is excluded deliberately, because its `ts.SyntaxKind` is not the one this compiler reads and the package throws on import against it.

For repository development, or to pin a commit rather than a version, add TypeShade as a git submodule and compile it in place:

```bash
git submodule add https://github.com/typeshade/typeshade vendor/typeshade
tsc -p vendor/typeshade
```

Used that way the package resolves to TypeScript source, so the consuming build needs a toolchain that compiles it (Vite, `tsc`, esbuild). Every relative specifier carries an explicit `.js`.

## Language example

A minimal file-level shader starts with `"use typeshade"`. Resources are declared with `declare`, metadata lives on class fields, and shader stages are top-level exported functions. GPU builtins are explicit function parameters, so a shader never depends on an implicit `gid`, `vid`, or `pid` global.

```ts
"use typeshade";

class Camera {
  view: mat4;
  pos: vec3;
}

declare const camera: uniform<Camera>;
declare const pixels: storage<array<f32>, "read_write">;

@compute([64, 1, 1])
export function paint(@builtin("global_invocation_id") gid: vec3u) {
  const i = gid.x;
  pixels[i] = pixels[i] + camera.pos.x;
}
```

The same authoring model is used by the documentation and the compiler's official surface reference. The host consumes the generated shader source, or imports the module and calls its helpers on the CPU (surface §64); TypeShade does not own the GPU rendering or compute runtime.

Every `"use typeshade"` block in this README, `AUTHORING.md`, `docs/` and `examples/*.md` compiles with the current compiler; `src/compiler/ts/doc-snippets.test.ts` extracts them and fails the build on any error diagnostic. Grammar that the compiler does not accept yet stays in [`docs/use-typeshade-surface.md`](./docs/use-typeshade-surface.md), marked as a target, and is not copied here.

## Checking shaders from the command line

`typeshade check` reports what the editor reports for a `"use typeshade"` file, plus what the WGSL and GLSL backends report when `compile()` runs them, and exits non-zero on an error. It is the check to run in CI and the one to hand a coding agent: plain `tsc` over the same files reports errors the compiler does not have (next section), and a tool that reports errors on correct code gets correct code rewritten.

```sh
npx typeshade check src/                          # from the npm package
bun vendor/typeshade/src/cli/bin.ts check src/    # from a submodule, which resolves to source
```

A directory is searched for `*.shade.ts` files, skipping `node_modules`, `dist` and `.git`; a file named on the command line is checked whatever its name. Each diagnostic prints with the line it points at:

```text
src/light.shade.ts:4:10 - error TS8003: Type mismatch: cannot + vec3<f32> and vec2<f32>. Vectors must have the same size.

4   return base + glow * k
           ~~~~~~~~~~~~~~~

Found 1 error in 1 file (1 file checked).
```

`--format short` prints one line per diagnostic, and `--format json` prints the report as data: one-based lines and columns, the UTF-16 span, and `source`, `"typeshade"` or `"typescript"`, for the half that raised it. `--deprecations` adds the warnings `compile(source, { deprecations: true })` reports. The exit status is 0 when no error was found, 1 when one was, and 2 when the command could not run. Over the 73 `.shade.ts` examples it reports no error and 5 warnings, each a GLSL ES 3.00 shortfall `compile()` also reports as `TS8015`.

The same check is exported from `typeshade/language-service`, as `checkDocuments` and, for a tool that keeps its own language service open, `checkOpenDocument`, so a tool that reports on shader files gives the command's answer rather than one of its own.

What it inherits from the language service, it inherits whole:

- **Each file is analysed on its own**, so a function imported from another shader file is `TS8004` ([#187](https://github.com/typeshade/typeshade/issues/187)).
- **A mistake both halves see is reported once**, in the compiler's sentence, as the editor shows it: a write to a `const` is the compiler's `TS8005`, not that and TypeScript's `TS2588` beside it. A misspelled name is the compiler's too, which names the fix itself: `Unknown function "clmap". Did you mean "clamp"?`.

## Calling a shader's helpers from host code, on the CPU

A host file imports a `.shade.ts` and calls the helper functions it exports. **The call runs on the CPU, not on the GPU:** the module's own code, at `f32` precision, so a host-side height query, a picking test or a unit test computes what the shader computes, with plain values (a `vec2` is `[x, y]`, a struct an object). A `@compute` entry is the part that runs on the GPU: `await entry(bindings, workgroups)` dispatches it on WebGPU and reads what it wrote back into your arrays, and `entry(canvas, bindings)` draws a full-screen fragment entry into a canvas on WebGPU, then WebGL2 ([surface §67](./docs/use-typeshade-surface.md#67-calling-an-entry-point-from-host-code)). A function that loops over an `array<f32>` is a kernel function: `await render(k, 512, img)` runs each loop the compiler proves independent on the GPU, one invocation per iteration, and a loop it cannot prove runs on the CPU with a warning that names the line ([surface §65](./docs/use-typeshade-surface.md#65-a-loop-that-runs-as-a-kernel)).

```ts
import { height } from './terrain.shade.ts';

const h = height([0.5, 0.5], [1, 0.5, 2, 0.25]); // a number
```

The setup is the Vite plugin, two lines of the host `tsconfig.json`, and `typeshade sync` in `prepare`, which writes the host view `tsc` reads for the import (`terrain.shade.typeshade.ts`, git-ignored):

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

export default defineConfig({ plugins: [typeshade()] });
```

```jsonc
// tsconfig.json
"moduleSuffixes": [".typeshade", ""],
"exclude": ["src/**/*.shade.ts"]
```

What a host can call, the host value of each type, and what ships are in [surface §64](./docs/use-typeshade-surface.md#64-calling-a-module-from-host-code).

## Type-checking `.shade.ts` with tsc

The editor experience TypeShade supports is the language service (`typeshade/language-service`), which builds its own TypeScript program and knows which diagnostics to drop. For a project that wants plain `tsc` over its `.shade.ts` files as well, such as a Vite plugin build or a CI type-check, the package also ships the ambient declarations as a file:

```jsonc
// tsconfig.shade.json: a SEPARATE project, covering only the shader sources
{
  "compilerOptions": {
    "lib": [],
    "types": ["typeshade/shade"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "strict": true,
    "noEmit": true,
  },
  "include": ["src/**/*.shade.ts"],
}
```

`moduleResolution` has to be one that reads a package's `exports` map (`bundler`, `node16` or `nodenext`), because `typeshade/shade` is a subpath export. Without it TypeScript 5.x falls back to `node10`, which does not read `exports`: the entry is `TS2688 Cannot find type definition file for 'typeshade/shade'`, the stand-ins below never load, and every file fails with `TS2318 Cannot find global type 'Array'` and nine like it, so nothing in the shaders is checked.

`lib: []` is required, not a preference. `typeshade/shade` declares its own `Array`, `Function`, `Object`, `Math` and `Pick` stand-ins because a `"use typeshade"` file is not a JavaScript program and must not see the JavaScript standard library. Loading both puts the two sets of declarations in the same program: measured on `hello.shade.ts` with the default lib, that is 19 errors, most of them reported _inside_ `lib.es5.d.ts` and `lib.dom.d.ts` (`Duplicate identifier 'Pick'`, `Cannot redeclare block-scoped variable 'Math'`, `Duplicate index signature for type 'number'`). Keep the shader sources in their own project and they do not meet.

### What it covers, and what it does not

Configured as above, the 71 `.shade.ts` examples in this repository type-check with **two** classes of error left. The first is on every entry point:

```
hello.shade.ts(19,1):  error TS1206: Decorators are not valid here.
hello.shade.ts(20,20): error TS1206: Decorators are not valid here.
hello.shade.ts(33,1):  error TS1206: Decorators are not valid here.
```

There are 214 of those across the 71 files. The second is arithmetic on a vector: TypeScript has no operator overloading, so `a + b` or `2.0 * v` on a GPU vector type is TS2362, TS2363 or TS2365 at the operator, with TS2322, TS2345 or TS2769 where the result is used, and TS2339 on a swizzle of a local the result was stored in (`const uv = p.xy * s; uv.x`) or of a call of a function that returns it with no return type written (`glow(uv).x`), since TypeScript typed that local or that function a `number`. That is 328 errors in 57 of the files, covered below.

TS1206 fires on `@vertex` / `@fragment` / `@compute` and on `@builtin(...)` parameters, because TypeScript does not allow decorators on function declarations or their parameters at all. No `.d.ts` can turn that off, because it is a grammar rule rather than a resolution failure. The language service drops it for exactly those positions, since the TypeShade grammar defines them; `tsc` on its own cannot. So the practical shape of this subpath is:

- **Covered.** Every type, resource and builtin name resolves: `f32`, `vec4`, `mat4`, `array<T>`, `uniform<T>`, `storage<T>`, `storage<T, "read_write">`, the `Math` aliases, `@builtin(...)` ids. Wrong types, misspelled fields and wrong arities are caught, and so is a write to a resource that is read-only: `src[i] = x` on a `declare const src: storage<array<f32>>` is TS2542 and `camera.fov = 1.` on a `uniform<Camera>` is TS2540, which is the write `compile()` refuses with `TS8005`. A `storage<T, "read_write">` binding is writable in the editor exactly as it is in the compiler. A vector lane and an `f32` matrix column take a runtime index (`v[i]`, `m[i]`) as they do in the compiler, and a `mat4<f64>` takes no runtime index in either. Every swizzle the compiler takes type-checks, `v.yx`, `p.xz` and `c.bgra` included.
- **Not covered.** TS1206 on stage and `@builtin` decorators. Expect it on every entry point, and filter it in your build if the noise matters. Arithmetic operators on vector and matrix values: the compiler accepts `a + b` on two `vec3`s, and `tsc` reports it, because the ambient types cannot overload an operator. The language service does better: it reads the local, and a function that writes no return type, with the type the compiler gave it, so the editor shows no error there and completes `uv.` and `glow(uv).` (#162). A WHOLE-binding write — `s = 1.` on a `declare const s: storage<f32, "read_write">`, as opposed to the `out[i] = x` and `p.field = x` a kernel actually writes — is TS2588 in the editor, because a binding is `declare const` and TypeScript will not assign to a const whatever its value type is; the compiler emits it, and `"use typeshade"` surface §49 has the row. An index past the end (`m[4]` on a `mat4`, `v[4]` on a `vec4`) or an `f32` index is the compiler's to refuse, as it is on an `array`: the language service shows its `TS8016` or `TS8003`, and `tsc` says nothing.
- **The authority is still the compiler.** `compile()` reports what TypeShade actually accepts, and the compile gate gives the emitted WGSL and GLSL to real drivers. `typeshade/shade` is an editor and CI convenience layered on top, never a second definition of the language.

The file is generated from `SHADE_DTS` in `src/language-service/ambient.ts` at build time, so the declarations the service loads and the ones `tsc` reads are the same bytes.

## Documentation

The documentation is at [typeshade.dev](https://typeshade.dev/), in English and [Korean](https://typeshade.dev/ko/):

- [Introduction](https://typeshade.dev/guide/introduction/), the language boundary and TypeScript relationship
- [Quick start](https://typeshade.dev/guide/quick-start/), your first `"use typeshade"` shader
- [Language guide](https://typeshade.dev/guide/language/), types, functions, control flow, GPU types, resources and shader stages
- [Examples](https://typeshade.dev/guide/examples/), complete programs and generated targets
- [API reference](https://typeshade.dev/api/), public compiler APIs
- [Verification](https://typeshade.dev/guide/checks/), compiler and output checks
- [Compiler internals](https://typeshade.dev/guide/internals/), implementation-facing compiler documentation
- [The developer experience](docs/dx.md), what TypeShade asks of a TypeScript developer and the bar it is measured against
- [Roadmap to 1.0.0](docs/roadmap.md), the order of work and the two rules that decide what is in it
- [Runtime architecture](docs/runtime-architecture.md), the proposed boundary between the compiler, host runtime and GPU backends

The site is [typeshade/typeshade.github.io](https://github.com/typeshade/typeshade.github.io). It is the primary place to learn the language; this repository is the source of the compiler and authoring surface.

## Examples

[`examples/`](./examples) holds runnable shaders and compiler output tests. The gallery may retain `fn()` / `module()` authoring where those APIs are useful as IR equality or golden-test machinery. Product-facing examples should migrate toward `"use typeshade"` as the language surface supports them.

```bash
npx tsx examples/print.ts            # print WGSL, GLSL and reflection for every example
npx tsx examples/print.ts metaballs  # one, by id
```

## Develop

```bash
bun install
bun run build
bun run test
bun run gate:compile
```

`dist/` is gitignored. `bun run build` writes it: `dist/src/…`, `dist/examples/…` and `dist/shade.d.ts`, mirroring the source tree. `bun run manifest:publish` prints the manifest the npm tarball carries, which is the same `exports` map rewritten onto those paths, and reports any entry point the build did not produce.

Releases are cut by creating a GitHub release; [`RELEASING.md`](./RELEASING.md) is the checklist and [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) does the work.

The compile gate hands emitted shader code to the real target compilers and browser contexts used by the project. [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the build, tests and compile gate on pushes and pull requests.

## Contributing

Development happens in this repository. Run the commands under Develop before opening a pull request. Changes to compiler output may require updating the corresponding example golden files.

## License

MIT. See [`LICENSE`](./LICENSE).
