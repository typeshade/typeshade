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

- **One source, two targets.** A shader written as typed expressions and statements in
  TypeScript emits WGSL for WebGPU and GLSL ES 3.00 for WebGL2 from one intermediate
  representation.
- **Checked against the CPU.** The same module compiles to a double-precision CPU function
  from the same source, a reference the GPU outputs are compared against, and the compile
  gate hands every example's emit to Tint and to a real WebGL2 context.
- **Typed in the editor.** A misspelt uniform field or a wrong-typed return is a TypeScript
  error in the editor, before anything is emitted.
- **Reflection.** `reflect(module)` returns bind groups, std140 and std430 layouts and entry
  signatures from the same intermediate representation, so the host does not derive them by
  hand.

TypeShade ships the authoring and emit surface only, with no runtime dependencies. Your
shaders live in your repository and import this package; creating pipelines, binding
resources and issuing draws stay with the host. SPIR-V, MSL and HLSL are reached through naga
or Tint from the WGSL output, and there is no third emitter.

## Getting started

The repository root is the package, so add it as a git submodule and compile it in place:

```bash
git submodule add https://github.com/typeshade/typeshade vendor/typeshade
tsc -p vendor/typeshade
```

The package ships TypeScript source: `main` and `exports` point at `./src/*.ts`, so the
consuming build needs a toolchain that compiles TypeScript (Vite, `tsc`, esbuild). Every
relative specifier carries an explicit `.js`, so the `dist/` that `tsc -p .` produces works
under Node's ESM resolver and its `.d.ts` files type-check under `moduleResolution: nodenext`.
A fresh clone type-checks with `tsc -p .` and no `node_modules` anywhere up the tree;
`src/self-contained.test.ts` checks this.

Import from the submodule path:

```ts
import { emitModule, reflect } from './vendor/typeshade/src/index.js'
```

The [Example](#example) below imports from `@xgis/shader-dsl` instead, the package name the
manifest carries today; the submodule path resolves to the same entry. The
[quick start](https://typeshade.dev/guide/quick-start/) runs a complete file, the gradient
example, from the import line to the WGSL it emits.

**Release state.** The manifest is at version `0.0.1`. `0.1.0` is the release the npm name
`typeshade` is reserved for, and the manifest and the imports are renamed at that tag. Until
then both are named `@xgis/shader-dsl`, and the old name stays as an alias for one major
version after the rename.

## Documentation

The documentation is at [typeshade.dev](https://typeshade.dev/), in English and
[Korean](https://typeshade.dev/ko/):

- [Introduction](https://typeshade.dev/guide/introduction/), why one shader source for both
  targets
- [Quick start](https://typeshade.dev/guide/quick-start/), the install and a first shader
- [Authoring guide](https://typeshade.dev/guide/authoring/), rendered from
  [`AUTHORING.md`](./AUTHORING.md) in this repository: `fn` and `module`, the layout
  declarators, control flow, value combinators, diagnostics and reflection
- [API reference](https://typeshade.dev/api/), one page per public export, generated from
  this repository's source
- [Examples](https://typeshade.dev/guide/examples/), every example in the registry with what
  it emits
- [Verification](https://typeshade.dev/guide/checks/), what runs on every push: the CPU
  function in double precision, the compile gate and the golden files

The site is its own repository,
[typeshade/typeshade.github.io](https://github.com/typeshade/typeshade.github.io). It pins a
commit of this one, and the guide and the reference move when the pin does: pull requests
there improve the pages, and pull requests here improve the guide and the reference text.

## Example

A fullscreen gradient pass that emits WGSL and prints its reflection:

```ts
import {
  fn,
  module,
  vec2,
  vec4,
  f32,
  mix,
  f32T,
  u32T,
  vec2fT,
  vec4fT,
  If,
  reflect,
  emitModule,
  ioStruct,
  builtin,
  location,
  uniformStruct,
} from '@xgis/shader-dsl'

const U = uniformStruct(
  'Uniforms',
  { group: 0, binding: 0, as: 'u' },
  { top: vec4fT, bottom: vec4fT, mix_bias: f32T },
)
const VsOut = ioStruct('VsOut', { pos: builtin('position', vec4fT), uv: location(0, vec2fT) })

const vs = fn(
  'vs_full',
  { idx: builtin('vertex_index', u32T) },
  (p) => {
    const pos = vec2(-1, -1)
    If(p.idx.eq(1), () => {
      pos.assign(vec2(3, -1))
    }).elif(p.idx.eq(2), () => {
      pos.assign(vec2(-1, 3))
    })
    return VsOut.construct({
      pos: vec4(pos, 0, 1),
      uv: vec2(pos.x.add(1).mul(0.5), pos.y.add(1).mul(0.5)),
    })
  },
  { stage: 'vertex' },
)

const fs = fn(
  'fs_gradient',
  { in: VsOut.type },
  (p) => {
    const pin = VsOut.of(p.in)
    const rgb = mix(U.field.bottom.rgb, U.field.top.rgb, pin.uv.y.add(U.field.mix_bias))
    return vec4(rgb, f32(1))
  },
  { stage: 'fragment', retAttr: '@location(0)' },
)

const m = module({ structs: [U.struct, VsOut.decl], bindings: [U.binding], funcs: [vs, fs] })

console.log(emitModule(m)) // WGSL string
console.log(reflect(m)) // pipeline metadata
```

The emitted WGSL:

```wgsl
struct Uniforms {
  top: vec4<f32>,
  bottom: vec4<f32>,
  mix_bias: f32,
}
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@vertex
fn vs_full(@builtin(vertex_index) idx: u32) -> VsOut { … }
@fragment
fn fs_gradient(in: VsOut) -> @location(0) vec4<f32> { … }
```

`reflect(m)` returns the bind-group entries, the std140 uniform layout and the entry-point
signatures, so the host does not derive them by hand:

```jsonc
{
  "bindGroups": [
    {
      "group": 0,
      "entries": [
        {
          "group": 0,
          "binding": 0,
          "name": "u",
          "space": "uniform",
          "resourceKind": "uniform-buffer",
          "structName": "Uniforms",
        },
      ],
    },
  ],
  "uniforms": [
    {
      "name": "Uniforms",
      "size": 48,
      "align": 16,
      "fields": [
        { "name": "top", "type": "vec4<f32>", "offset": 0, "align": 16, "size": 16 },
        { "name": "bottom", "type": "vec4<f32>", "offset": 16, "align": 16, "size": 16 },
        { "name": "mix_bias", "type": "f32", "offset": 32, "align": 4, "size": 4 },
      ],
    },
  ],
  "storage": [],
  "entries": [
    { "name": "vs_full", "stage": "vertex", "inputs": ["u32"], "output": "struct:VsOut" },
    {
      "name": "fs_gradient",
      "stage": "fragment",
      "inputs": ["struct:VsOut"],
      "output": "vec4<f32>",
    },
  ],
}
```

The std140 / std430 offset engine is also available on its own as
`wgslLayout(struct, 'std140' | 'std430')`.

## Examples

[`examples/`](./examples) holds 36 runnable shaders with no runtime dependency: effects
(plasma, voronoi, domain warping, fBm clouds, metaballs, ocean, starfield, truchet,
kaleidoscope, a tunnel, a raymarched sphere and a raymarched box field), fractals (julia,
mandelbrot), 13 emulated-double demonstrations (a deep zoom, cancellation, a sine sweep, a
clock, julia and mandelbrot at f64, the burning ship and a Newton basin) and a compute
kernel. 35 of them emit WGSL, GLSL ES 3.00 and reflection from one source; the compute
kernel emits WGSL and reflection only, because GLSL ES 3.00 has no compute stage:

```bash
npx tsx examples/print.ts            # print WGSL, GLSL and reflection for every example
npx tsx examples/print.ts metaballs  # one, by id
```

The renderable ones are exported from [`examples/index.ts`](./examples/index.ts), so a host
page can mount them on either backend; the [site](https://typeshade.dev/) runs them live.
The fullscreen head they share, the uniform block, the `VsOut` struct and the vertex stage,
is in [`examples/_fullscreen.ts`](./examples/_fullscreen.ts), so a fullscreen example
declares only its fragment stage and its extra uniform fields. The
[examples page](https://typeshade.dev/guide/examples/) lists every one with what it emits.

## Develop

```bash
bun install
bun run build          # tsc --build to dist/ with .d.ts, then a noEmit check of tests, examples and scripts
bun run test           # vitest, 146 test files
bun run gate:compile   # every registered example, emitted and compiled by the real compilers
```

`dist/` is gitignored.

The compile gate hands every emit to the compiler that would receive it in production: the
WGSL to Tint inside Chromium's headless WebGPU, and both GLSL ES 3.00 stages to a real WebGL2
context. It needs Playwright's Chromium once:

```bash
./node_modules/.bin/playwright install --only-shell chromium
```

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the build, the tests and the
compile gate on every push and pull request. The
[verification page](https://typeshade.dev/guide/checks/) describes what each one covers.

## Contributing

Development happens in this repository. Issues and pull requests are welcome. Run the
commands under Develop before opening a pull request; CI runs the same ones on it. A change
to an example's emit must update its golden file under
[`examples/__emit-goldens__/`](./examples/__emit-goldens__): `UPDATE_EMIT_GOLDENS=1 bun run test`
rewrites the goldens, and [`examples/emit-goldens.test.ts`](./examples/emit-goldens.test.ts)
reads that variable. A change to the guide or to an export's documentation reaches the site
at its next pin of this repository.

## License

MIT. See [`LICENSE`](./LICENSE).
