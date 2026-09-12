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
  <a href="https://typeshade.dev/guide/authoring/">Guide</a> |
  <a href="https://typeshade.dev/api/">API</a> |
  <a href="https://typeshade.dev/guide/examples/">Examples</a> |
  <a href="https://typeshade.dev/guide/checks/">Verification</a> |
  <a href="https://typeshade.dev/ko/">한국어</a>
</p>

# [TypeShade](https://typeshade.dev/)

Write a shader once in TypeScript, get WGSL for WebGPU and GLSL ES 3.00 for WebGL2, and run
the same module on the CPU in double precision to check the compiler's output.

The official author surface is a TypeScript file that starts with `"use typeshade"`.
`fn()` stays as the IR equality oracle used by tests and the example gallery.

- **One source, two targets.** Typed TypeScript lowers onto one intermediate representation
  and emits WGSL for WebGPU and GLSL ES 3.00 for WebGL2.
- **Checked against the CPU.** The same module compiles to a double-precision CPU function
  from the same source. The compile gate hands every example emit to Tint and to a real
  WebGL2 context.
- **Typed in the editor.** A misspelt uniform field or a wrong-typed return is a TypeScript
  error before anything is emitted.
- **Reflection.** `reflect(module)` returns bind groups, std140 and std430 layouts and entry
  signatures from the same IR, so the host does not derive them by hand.

TypeShade ships the authoring and emit surface only, with no runtime dependencies. Creating
pipelines, binding resources and issuing draws stay with the host. SPIR-V, MSL and HLSL are
reached through naga or Tint from the WGSL output.

The language surface is frozen in [`docs/use-typeshade-surface.md`](./docs/use-typeshade-surface.md).

## Getting started

The repository root is the package, so add it as a git submodule and compile it in place:

```bash
git submodule add https://github.com/typeshade/typeshade vendor/typeshade
tsc -p vendor/typeshade
```

The package ships TypeScript source: `main` and `exports` point at `./src/*.ts`. The consuming
build needs a toolchain that compiles TypeScript (Vite, `tsc`, esbuild). Every relative
specifier carries an explicit `.js`.

```ts
import { compileTsSource, emitModule, reflect } from './vendor/typeshade/src/index.js'
```

The [Example](#example) below is the official file-level surface. The gallery under
`examples/` still authors with `fn()` so emit goldens stay stable. The manifest is `0.0.1`
as `@xgis/shader-dsl` until the `0.1.0` rename to `typeshade`.

## Documentation

The documentation is at [typeshade.dev](https://typeshade.dev/), in English and
[Korean](https://typeshade.dev/ko/):

- [Introduction](https://typeshade.dev/guide/introduction/), why one shader source for both targets
- [Quick start](https://typeshade.dev/guide/quick-start/), the install and a first shader
- [Authoring guide](https://typeshade.dev/guide/authoring/), rendered from [`AUTHORING.md`](./AUTHORING.md)
- [API reference](https://typeshade.dev/api/), one page per public export
- [Examples](https://typeshade.dev/guide/examples/), every example in the registry
- [Verification](https://typeshade.dev/guide/checks/), CPU oracle, compile gate, goldens

The site is [typeshade/typeshade.github.io](https://github.com/typeshade/typeshade.github.io).
It pins a commit of this repository. Pin target after the `"use typeshade"` land:
`f2ed88be618a8c5d22b9bcc0d7493681227e6240`.

## Example

A file-level vertex and fragment pass. Language builtins are global. The host compiles the
source string and keeps the raw WGSL.

```ts
import { compileTsSource, emitModule, reflect } from './vendor/typeshade/src/index.js'

const src = `
"use typeshade";

class Clip {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const x = i === 1u ? 3. : i === 2u ? -1. : -1.;
  const y = i === 1u ? -1. : i === 2u ? 3. : -1.;
  return { pos: vec4(x, y, 0., 1.) };
}

@fragment
export function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) };
}
`

const m = compileTsSource(src).module
console.log(emitModule(m))
console.log(reflect(m))
```

The emitted WGSL has the same IR shape as a `fn()` module:

```wgsl
struct Clip {
  @builtin(position) pos: vec4<f32>,
}
struct Color {
  @location(0) color: vec4<f32>,
}
@vertex
fn vs(@builtin(vertex_index) i: u32) -> Clip { … }
@fragment
fn fs() -> Color { … }
```

Resources use `declare` plus a space wrapper. Field metadata lives on class fields only.

```ts
"use typeshade";

class Camera {
  @align(16) view: mat4;
  pos: vec3;
}

declare const camera: uniform<Camera>;
declare let pixels: storage<array<f32>>;

@compute([64, 1, 1])
export function paint() {
  const i = gid.x;
  pixels[i] = pixels[i] + camera.pos.x;
}
```

`fn()` / `module()` remain public. Tests treat them as the IR equality oracle. Product code
should use `"use typeshade"`.

The std140 / std430 offset engine is also available as `wgslLayout(struct, 'std140' | 'std430')`.

## Examples

[`examples/`](./examples) holds 36 runnable shaders with no runtime dependency: effects,
fractals, emulated-double demonstrations and a compute kernel. 35 of them emit WGSL, GLSL ES
3.00 and reflection from one source; the compute kernel emits WGSL and reflection only.

```bash
npx tsx examples/print.ts            # print WGSL, GLSL and reflection for every example
npx tsx examples/print.ts metaballs  # one, by id
```

The renderable ones are exported from [`examples/index.ts`](./examples/index.ts). The
fullscreen head they share is in [`examples/_fullscreen.ts`](./examples/_fullscreen.ts).

## Develop

```bash
bun install
bun run build          # tsc --build to dist/ with .d.ts, then a noEmit check
bun run test           # vitest
bun run gate:compile   # every registered example, compiled by the real compilers
```

`dist/` is gitignored.

The compile gate hands every emit to Tint inside Chromium's headless WebGPU, and both GLSL ES
3.00 stages to a real WebGL2 context:

```bash
./node_modules/.bin/playwright install --only-shell chromium
```

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the build, the tests and the
compile gate on every push and pull request.

## Contributing

Development happens in this repository. Run the commands under Develop before opening a pull
request. A change to an example's emit must update its golden file under
[`examples/__emit-goldens__/`](./examples/__emit-goldens__):
`UPDATE_EMIT_GOLDENS=1 bun run test` rewrites the goldens.

## License

MIT. See [`LICENSE`](./LICENSE).
