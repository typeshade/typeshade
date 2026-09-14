# Official author surface: `"use typeshade"`

TypeShade’s public language is TypeScript. A file that starts with `"use typeshade"` is a
shader compilation unit. It lowers to the same IR the `fn()` EDSL builds. Host code never
imports a TypeShade runtime — only emitted WGSL/GLSL and a slot table.

## Unit

```ts
"use typeshade"

export function add(a: f32, b: f32): f32 {
  return a + b
}
```

- Language builtins (`f32`, `vec3`, `sin`, `vec4(...)`) are global. No import.
- User code uses `import` / `export`. Only relative named imports.
- `Math.sin` / `Math.PI` are aliases onto the same IR.

## Modules

```ts
// math.ts
"use typeshade"
export function square(x: f32): f32 {
  return x * x
}

// app.ts
"use typeshade"
import { square } from "./math"
export function foo(x: f32): f32 {
  return square(x) + 1.
}
```

## Compiling

The public entry points take **one** source string:

```ts
import { compile, compileTsSource } from '@xgis/shader-dsl'

const { diagnostics, module, wgsl, glsl, eval: run } = compile(appSrc)

// Lower-level: IR + WGSL, no GLSL and no CPU eval.
const r = compileTsSource(appSrc, { fileName: 'app.ts' })
r.diagnostics.filter((d) => d.category === 'error') // must be empty
```

`compile()` never hands back shader text for a program that did not compile. When any
diagnostic has category `error`, `wgsl` and `glsl` are `undefined` and `run` throws an error
that names the first error diagnostic. When there is no error, `wgsl` is always present and
`glsl` is present only for a module with both a `@vertex` and a `@fragment` entry that the
GLSL ES 3.00 backend can emit; a compute-only module has `wgsl` and no `glsl`. A WGSL emitter
that throws on a program the front end accepted is reported as a `TS8015` error, not an
exception. A GLSL emitter that throws on a `@vertex` plus `@fragment` module (a `@compute`
entry beside them, a storage binding the GLSL emulation cannot spell) is a `TS8015` warning:
the module compiled, `wgsl` stays and only `glsl` is `undefined`. `module` is always present,
but it is partial when there is an error.

A file without `"use typeshade"` is a `TS8001` error from both entry points. Pass
`requireDirective: false` to `compileTsSource` to get the silently empty result instead, for a
probe that only reads `hasDirective`.

Bundling several files into one compilation unit is **not** on the public surface yet.
`compileTsSources(files, { entry })` in `src/compiler/ts/sources.ts` does it — it takes a
`Record<fileName, source>` — but it is reachable only by a deep import and is not exported
from the package entry.

## Graphics

```ts
class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

declare const camera: uniform<Camera>

@vertex
export function vs(vin: VsIn): VsOut { /* ... */ }

@fragment
export function fs(v: VsOut): Color { /* ... */ }
```

## Host

```ts
const p = packModule(module)
device.createShaderModule({ code: p.wgsl })
// p.bindings, p.vertexLayout, p.glsl
```

Vite: `typeshadeVite()` turns `*.shade.ts` into `export default pack`.

`packModule` (`src/compiler/ts/pack.ts`) and `typeshadeVite` (`src/compiler/ts/vite.ts`) are
in the same state as `compileTsSources`: real, tested, but deep imports rather than package
entry exports.

## What this is not

- Not GPU.js `"use gpu"` mid-function.
- Not a draw helper.
- Not a second type system. `ShaderType` is the only IR type.
- The `fn()` EDSL remains valid and is what IR equality tests against.
