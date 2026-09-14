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
`glsl` is present whenever the GLSL ES 3.00 backend can emit the module, a single render
stage included; a compute-only module has `wgsl` and no `glsl`, with no diagnostic, since
GLSL ES 3.00 has no compute stage. A WGSL emitter that throws on a program the front end
accepted is reported as a `TS8015` error, not an exception. A GLSL emitter that throws on a
module with a `@vertex` or `@fragment` entry (a `@compute` entry beside them, a storage
binding the GLSL emulation cannot spell) is a `TS8015` warning: the module compiled, `wgsl`
stays and only `glsl` is `undefined`. `module` is always present,
but it is partial when there is an error.

Every statement and every function in `module` carries the span of the source it was lowered
from, read with `sourceSpanOf(node)`:

<!-- doc-snippets: skip — a host-side snippet, not a compilation unit -->

```ts
import { compile, sourceSpanOf } from '@xgis/shader-dsl'

const { module } = compile(appSrc)
const span = sourceSpanOf(module.funcs[0]!.body[0]!)
// { file, start, length, line, character, endLine, endCharacter }
// lines and characters zero-based, offsets in UTF-16 code units
```

A call the author wrote and an assignment's target carry one too. It is `undefined` for a node
the `fn()` EDSL authored, which has no source to point at, and for one the compiler synthesised
rather than lowered: the counter a `while` becomes, a value `autoVars` materialises, a call the
front end expands a shorthand into. That is what a debugger reads to stop on the line an author
wrote; `docs/debugging.md` is the design.

`@xgis/shader-dsl/debug` is the layer that reads them. It steps one invocation on the CPU
oracle, stopping before each statement the author wrote:

<!-- doc-snippets: skip - a host-side snippet, not a compilation unit -->

```ts
import { compile } from '@xgis/shader-dsl'
import { startDebugSession } from '@xgis/shader-dsl/debug'

const { module } = compile(appSrc, { fileName: 'blur.shade.ts' })
const s = startDebugSession(module, 'fs', [0.5], {
  breakpoints: [{ file: 'blur.shade.ts', line: 12 }],
})
s.continue()
console.log(s.pause?.span.line, [...(s.pause?.frames[0]?.locals ?? [])])
s.stepIn()
```

One invocation, not a frame: a full 1920x1080 pass is about two million of them, and stepping
is for the one that is wrong. It is the same walk over the same IR the WGSL and GLSL writers
emit, checked against the oracle over every registered example, so what it shows is what the
program computes rather than a second opinion about it.

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
