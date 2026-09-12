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

```ts
compileTsSources({ 'math.ts': mathSrc, 'app.ts': appSrc }, { entry: 'app.ts' })
```

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

## What this is not

- Not GPU.js `"use gpu"` mid-function.
- Not a draw helper.
- Not a second type system. `ShaderType` is the only IR type.
- The `fn()` EDSL remains valid and is what IR equality tests against.
