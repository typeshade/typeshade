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

TypeShade ships the authoring and emit surface only, with no runtime dependency. Creating pipelines, binding resources and issuing draws stay with the host application.

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

The tarball ships compiled ESM with type declarations, so `import { compile } from 'typeshade'` needs no TypeScript toolchain. Alongside them it ships the `.ts` sources the declaration maps point at, so "go to definition" lands on real source. The public subpaths are `typeshade`, `typeshade/dev`, `typeshade/debug`, `typeshade/compute`, `typeshade/emit-prod`, `typeshade/core/ir`, `typeshade/examples` and `typeshade/language-service`. `typescript` is a peer dependency (`>=5.0.0 <6`) and npm installs it for you: `compile()` is a TypeScript front end, so the main entry needs the parser at run time. TypeScript 7 is excluded deliberately, because its `ts.SyntaxKind` is not the one this compiler reads and the package throws on import against it.

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

The same authoring model is used by the documentation and the compiler's official surface reference. The host consumes the generated shader source; TypeShade does not own the rendering or compute runtime.

Every `"use typeshade"` block in this README, `AUTHORING.md`, `docs/` and `examples/*.md` compiles with the current compiler; `src/compiler/ts/doc-snippets.test.ts` extracts them and fails the build on any error diagnostic. Grammar that the compiler does not accept yet stays in [`docs/use-typeshade-surface.md`](./docs/use-typeshade-surface.md), marked as a target, and is not copied here.

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

There are 214 of those across the 71 files. The second is arithmetic on a vector: TypeScript has no operator overloading, so `a + b` or `2.0 * v` on a GPU vector type is TS2362, TS2363 or TS2365 at the operator, with TS2322, TS2345 or TS2769 where the result is used, and TS2339 on a swizzle of a local the result was stored in (`const uv = p.xy * s; uv.x`), since TypeScript declared that local a `number`. That is 328 errors in 57 of the files, covered below.

TS1206 fires on `@vertex` / `@fragment` / `@compute` and on `@builtin(...)` parameters, because TypeScript does not allow decorators on function declarations or their parameters at all. No `.d.ts` can turn that off, because it is a grammar rule rather than a resolution failure. The language service drops it for exactly those positions, since the TypeShade grammar defines them; `tsc` on its own cannot. So the practical shape of this subpath is:

- **Covered.** Every type, resource and builtin name resolves: `f32`, `vec4`, `mat4`, `array<T>`, `uniform<T>`, `storage<T>`, `storage<T, "read_write">`, the `Math` aliases, `@builtin(...)` ids. Wrong types, misspelled fields and wrong arities are caught, and so is a write to a resource that is read-only: `src[i] = x` on a `declare const src: storage<array<f32>>` is TS2542 and `camera.fov = 1.` on a `uniform<Camera>` is TS2540, which is the write `compile()` refuses with `TS8005`. A `storage<T, "read_write">` binding is writable in the editor exactly as it is in the compiler.
- **Not covered.** TS1206 on stage and `@builtin` decorators. Expect it on every entry point, and filter it in your build if the noise matters. Arithmetic operators on vector and matrix values: the compiler accepts `a + b` on two `vec3`s, and `tsc` reports it, because the ambient types cannot overload an operator. The language service does better: it reads the local with the type the compiler gave it, so the editor shows no error there and completes `uv.` (#162). A WHOLE-binding write — `s = 1.` on a `declare const s: storage<f32, "read_write">`, as opposed to the `out[i] = x` and `p.field = x` a kernel actually writes — is TS2588 in the editor, because a binding is `declare const` and TypeScript will not assign to a const whatever its value type is; the compiler emits it, and `"use typeshade"` surface §49 has the row. Swizzles outside the `x`/`y`/`z`/`w`, `r`/`g`/`b`/`a` and `xy`/`xyz`/`xyzw`/`rg`/`rgb`/`rgba` set are not type-checked (they compile correctly; the editor just does not see them).
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
