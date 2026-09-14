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

The tarball ships compiled ESM with type declarations — `import { compile } from 'typeshade'` needs no TypeScript toolchain — alongside the `.ts` sources the declaration maps point at, so "go to definition" lands on real source. The public subpaths are `typeshade`, `typeshade/dev`, `typeshade/compute`, `typeshade/emit-prod`, `typeshade/core/ir`, `typeshade/examples` and `typeshade/language-service`. `typescript` is an optional peer dependency, needed only by `typeshade/language-service`.

For repository development, or to pin a commit rather than a version, add TypeShade as a git submodule and compile it in place:

```bash
git submodule add https://github.com/typeshade/typeshade vendor/typeshade
tsc -p vendor/typeshade
```

Used that way the package resolves to TypeScript source, so the consuming build needs a toolchain that compiles it (Vite, `tsc`, esbuild). Every relative specifier carries an explicit `.js`.

## Language example

A minimal file-level shader starts with `"use typeshade"`. Resources are declared with `declare`, metadata lives on class fields, and shader stages are top-level exported functions. GPU builtins are explicit function parameters, so a shader never depends on an implicit `gid`, `vid`, or `pid` global.

```ts
"use typeshade"

class Camera {
  view: mat4
  pos: vec3
}

declare const camera: uniform<Camera>
declare let pixels: storage<array<f32>>

@compute([64, 1, 1])
export function paint(@builtin("global_invocation_id") gid: vec3u) {
  const i = gid.x
  pixels[i] = pixels[i] + camera.pos.x
}
```

The same authoring model is used by the documentation and the compiler's official surface reference. The host consumes the generated shader source; TypeShade does not own the rendering or compute runtime.

Every `"use typeshade"` block in this README and in `docs/` compiles with the current compiler; `src/compiler/ts/doc-snippets.test.ts` extracts them and fails the build on any error diagnostic. Grammar that the compiler does not accept yet stays in [`docs/use-typeshade-surface.md`](./docs/use-typeshade-surface.md), marked as a target, and is not copied here.

## Documentation

The documentation is at [typeshade.dev](https://typeshade.dev/), in English and [Korean](https://typeshade.dev/ko/):

- [Introduction](https://typeshade.dev/guide/introduction/), the language boundary and TypeScript relationship
- [Quick start](https://typeshade.dev/guide/quick-start/), your first `"use typeshade"` shader
- [Language guide](https://typeshade.dev/guide/language/), types, functions, control flow, GPU types, resources and shader stages
- [Examples](https://typeshade.dev/guide/examples/), complete programs and generated targets
- [API reference](https://typeshade.dev/api/), public compiler APIs
- [Verification](https://typeshade.dev/guide/checks/), compiler and output checks
- [Compiler internals](https://typeshade.dev/guide/internals/), implementation-facing compiler documentation

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

`dist/` is gitignored. `bun run build` writes it: `dist/src/…` and `dist/examples/…`, mirroring the source tree. `bun run manifest:publish` prints the manifest the npm tarball carries — the same `exports` map rewritten onto those paths — and reports any entry point the build did not produce.

The compile gate hands emitted shader code to the real target compilers and browser contexts used by the project. [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the build, tests and compile gate on pushes and pull requests.

## Contributing

Development happens in this repository. Run the commands under Develop before opening a pull request. Changes to compiler output may require updating the corresponding example golden files.

## License

MIT. See [`LICENSE`](./LICENSE).
