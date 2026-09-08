# TypeShade

[![ci](https://github.com/typeshade/typeshade/actions/workflows/ci.yml/badge.svg)](https://github.com/typeshade/typeshade/actions/workflows/ci.yml)

TypeShade is a TypeScript library for writing shaders. You write a shader once, as typed
expressions and statements in TypeScript, and one intermediate representation emits WGSL for
WebGPU and GLSL ES 3.00 for WebGL2. The same source also runs on the CPU in double precision,
so the two GPU outputs can be checked against it. It is a TSL-style graph (three.js Shading
Language) with a type checker, an optimizer, a lint pass and pipeline reflection. It has no
runtime dependencies and is MIT licensed.

TypeShade ships the authoring and emit surface only. Your application's shaders live in your
repository and import this package.

> **Status: pre-release.** `0.1.0` is not published. The npm name `typeshade` is reserved for
> it. Until that tag, the manifest and the imports are named `@xgis/shader-dsl`; the old name
> stays as an alias for one major version after the rename.

## What works today

- **Authoring.** Typed IR, layout declarators for structs and buffers, control flow and
  value combinators. See [`AUTHORING.md`](./AUTHORING.md).
- **Type checking.** Node types are checked at compile time. A wrong-typed return or a
  misspelt field is a TypeScript error in the editor.
- **Optimizer.** Common subexpression elimination, dead code elimination, loop-invariant
  code motion, constant folding, algebraic simplification, and automatic `var` / `let`.
- **Validation and lint.** Coded errors (`SD####`), an aggregated `validate()`, and
  `diagnose()` / `formatReport()` with opt-in source locations.
- **CPU oracle.** Compile the same module to an f64 CPU function and compare it with the
  GPU output.
- **Reflection.** `reflect(module)` returns bind groups, std140 / std430 layouts and entry
  signatures. It is read-only over the IR and never runs on the emit path.
- **WGSL backend.** Byte-stable output.
- **GLSL ES 3.00 backend.** Vertex and fragment entry IO, std140 uniform blocks and multiple
  render targets, compiled and render-verified on a real WebGL2 context (see `examples/`).
  A read-only storage buffer lowers to a data texture by default. Writes, unsupported
  shapes and MSAA loads fail with an error. Compute emulation is opt-in.
- **Emulated f64.** Two-f32 lowering for `+ - * /`, comparisons, `abs`, `min`, `max`,
  `sqrt`, `mix`, `floor`, `fract` and the vector reductions, with a per-device flavor probe.
  Transcendental functions are not emulated; an unsupported op fails with `SD0041`.
- **`semanticDiff`.** Compares two modules' interface, resources, constants and control-flow
  skeleton. A review aid for emit changes. It does not compare expression trees.
- **`variantFamily`.** One module, N specialised emits with a shared prelude, validated as
  a unit. In production use.
- **Portable compute.** The gather-only shape (`out[gid.x] = f(reads)`, 1-D `gid`, one `u32`
  storage output written once) lowers to both WebGPU and the WebGL2 emulation. Anything
  else is rejected at emit time (`SD0110` / `SD0111`).

SPIR-V, MSL and HLSL are reached through naga or Tint from the WGSL output. There is no
third emitter, and none is planned: it would triple every parity check for no new rendering
surface.

## Use it as a submodule

The repository root is the package, so it compiles on its own:

```bash
git submodule add https://github.com/typeshade/typeshade vendor/typeshade
tsc -p vendor/typeshade
```

A fresh clone type-checks with `tsc -p .` and no `node_modules` anywhere up the tree. Every
`extends` in this package resolves inside it, and nothing tracked here names a path outside
it. `src/self-contained.test.ts` checks this.

Two things to know:

- **It ships TypeScript source.** `main` and `exports` point at `./src/*.ts`, so the
  consuming build needs a toolchain that compiles TypeScript (Vite, `tsc`, esbuild). Every
  relative specifier carries an explicit `.js`, so the `dist/` that `tsc -p .` produces works
  under Node's own ESM resolver and its `.d.ts` files type-check under
  `moduleResolution: nodenext`.
- **Nothing here needs `allowImportingTsExtensions`.** `src/` and `examples/` write `./x.js`,
  the TypeScript ESM convention.

## Develop

```bash
bun install
bun run build          # tsc --build to dist/ with .d.ts, then a noEmit check of tests, examples and scripts
bun run test           # vitest, 146 test files
bun run gate:compile   # every registered example, emitted and compiled by the real compilers
```

`dist/` is gitignored.

The compile gate hands every emit to the compiler that would receive it in production: the
WGSL to Tint inside Chromium's headless WebGPU, and both GLSL ES 3.00 stages to a real
WebGL2 context. It needs Playwright's Chromium once:

```bash
./node_modules/.bin/playwright install --only-shell chromium
```

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs all three on every push and
pull request.

## Example: author, emit WGSL, reflect

A fullscreen gradient pass in about 20 lines that emits WGSL and prints its reflection:

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

[`examples/`](./examples) holds 36 runnable, runtime-free shaders: three cartographic ones
(graticule, hillshade, choropleth ramp), nineteen generic effects (plasma, voronoi, julia,
mandelbrot, fBm clouds, domain warping, raymarched sphere, raymarched box field, tunnel,
metaballs, ocean, starfield, truchet, kaleidoscope, beating heart, gradient, discard cutout,
override quality, texture-array LOD), thirteen that exercise the emulated-double tier (deep
zoom, RTC, Loran, Mercator tiles, the fractal set at f64, cancellation, a sine sweep), and one
compute kernel. Each emits WGSL, GLSL ES 3.00 and reflection from one source:

```bash
npx tsx examples/print.ts            # print WGSL, GLSL and reflection for every example
npx tsx examples/print.ts hillshade  # one, by id
```

The renderable ones are exported from `examples/index.ts`, so a host page can mount them on
either backend. See [`examples/README.md`](./examples/README.md).

## Authoring guide

[`AUTHORING.md`](./AUTHORING.md) covers `fn` and `module`, the layout declarators, control
flow, value combinators and the reflection surface.

## Contributing

Issues are welcome here. Until development moves into this repository, changes land
[upstream](https://github.com/X-GIS/X-GIS/tree/main/shader-dsl) and this tree is
fast-forwarded from there, so a pull request opened here cannot be merged yet.

## License

MIT. See [`LICENSE`](./LICENSE).
