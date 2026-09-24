# Official author surface: `"use typeshade"`

TypeShade’s public language is TypeScript. A file that starts with `"use typeshade"` is a
shader compilation unit. It lowers to the same IR the `fn()` EDSL builds. A host either takes the
emitted WGSL/GLSL and a slot table and runs them itself, or imports a `*.shade.ts` through the Vite
plugin and calls its exported functions, which run on the CPU tier through `typeshade/runtime`
(surface §64).

## Unit

```ts
"use typeshade";

export function add(a: f32, b: f32): f32 {
  return a + b;
}
```

- Language builtins (`f32`, `vec3`, `sin`, `vec4(...)`) are global. No import.
- User code uses `import` / `export`. Only relative named imports.
- `Math.sin` / `Math.PI` are aliases onto the same IR.

## Modules

```ts
// math.ts
"use typeshade";
export function square(x: f32): f32 {
  return x * x;
}

// app.ts
"use typeshade";
import { square } from "./math";
export function foo(x: f32): f32 {
  return square(x) + 1.;
}
```

## Compiling

The public entry points take **one** source string:

```ts
import { compile, compileTsSource } from 'typeshade'

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
import { compile, sourceSpanOf } from 'typeshade'

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

`typeshade/debug` is the layer that reads them. It steps one invocation on the CPU
oracle, stopping before each statement the author wrote:

<!-- doc-snippets: skip - a host-side snippet, not a compilation unit -->

```ts
import { compile } from 'typeshade'
import { startDebugSession } from 'typeshade/debug'

// Name the file. A breakpoint's `file` is matched against the file the spans name, and this
// option is what names it: compiled without it, every span says `typeshade-input.ts` and a
// file-qualified breakpoint would match nothing. The name is not carried verbatim, because
// TypeScript path-normalizes what it is handed; the matching normalizes both sides the same
// way, so the spelling you pass here is the spelling a breakpoint can use.
const { module } = compile(appSrc, { fileName: 'blur.shade.ts' })

const s = startDebugSession(module, 'fs', [[0.3, 0.4]], {
  breakpoints: [{ file: 'blur.shade.ts', line: 4 }],
})
s.pause.span.line // 3, the entry's first statement; s.pause.reason is 'entry'
s.continue()
s.pause.span.line // 4, and s.pause.reason is now 'breakpoint'
;[...s.pause.frames[0].locals] // [['uv', [0.3, 0.4]], ['r', 0.5]]
s.stepIn() // line 5
```

Lines are zero-based, as `SourceSpan` and the language service are. A breakpoint matches the
line a statement STARTS on, so one on a blank line or on a closing brace never fires.

One invocation, not a frame: a full 1920x1080 pass is about two million of them, and stepping
is for the one that is wrong. It is the same walk over the same IR the WGSL and GLSL writers
emit, checked against the oracle over every registered example, so what it shows is what the
program computes rather than a second opinion about it.

Positional arguments are what `startDebugSession` takes, which means a caller has to know that
`fs`'s third parameter is the one carrying `@location(1)`. `startDebugSessionFromConfig` takes
the run as data instead, keyed by what the author declared, and that is the one call an
editor's debug adapter or a `launch.json` makes:

<!-- doc-snippets: skip - a host-side snippet, not a compilation unit -->

```ts
import { startDebugSessionFromConfig } from 'typeshade/debug'

const s = startDebugSessionFromConfig(module, {
  entry: 'fs',
  invocation: { position: [100.5, 50.5, 0, 1], inputs: { uv: [0.5, 0.25] } },
  bindings: { camera: { pos: [0, 0, 5] } },
  breakpoints: [{ file: 'blur.shade.ts', line: 4 }],
})
```

`entry` is the only key you have to write. Every other value defaults to the zero of its
declared type, with two exceptions that a zero would misrepresent: a fragment `position`
defaults to `[0, 0, 0, 1]`, because a `w` of zero makes every perspective divide `NaN`, and
`front_facing` defaults to `true`, because `false` is the case a single-sided draw never runs.
A compute entry derives `local_invocation_id`, `workgroup_id` and `local_invocation_index`
from the `global_invocation_id` you give it and the entry's own `@compute([x, y, z])` size, and
`num_workgroups` from `dispatch`; supply one of a derived pair yourself and it is checked
rather than overwritten, so an id that contradicts its derivation is an error naming both.

A configuration that does not fit the module throws a `DebugConfigError` before the shader runs
a statement, and it reports every problem it can see at once: a misspelled builtin alongside a
uniform of the wrong shape, rather than one error per attempt. `DEBUG_LAUNCH_SCHEMA` is the
same shape as JSON Schema, for validating a `launch.json` in an editor that reads one.
`docs/debugging.md` §4 is the reference for both.

A file without `"use typeshade"` is a `TS8001` error from both entry points. Pass
`requireDirective: false` to `compileTsSource` to get the silently empty result instead, for a
probe that only reads `hasDirective`.

Bundling several files into one compilation unit is **not** on the public surface yet.
`compileTsSources(files, entry)` in `src/compiler/ts/module.ts` does it — it takes a list of
`{ fileName, source }` and the entry's file name — but it is reachable only by a deep import
and is not exported from the package entry.

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

`packModule` (`src/compiler/ts/pack.ts`) is exported from the package entry.

Vite: `typeshade()` from `typeshade/vite` lets a host file import a `*.shade.ts` and call what
it exports (surface §64). The import is the module's own functions on the CPU tier, with a host
view beside each module that `tsc` reads; it is not a pack of the emitted text.

## What this is not

- Not GPU.js `"use gpu"` mid-function.
- Not a draw helper.
- Not a second type system. `ShaderType` is the only IR type.
- The `fn()` EDSL remains valid and is what IR equality tests against.
