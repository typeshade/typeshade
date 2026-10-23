# Authoring shaders with `typeshade`

After this page you know what one TypeScript source turns into, how to import the
compiler, and which page of this guide answers which question. The samples are written
against the source in this repository, and `examples/` holds complete shaders written the
same way.

### What you write and what comes out

You write a shader as an ordinary TypeScript file whose first statement is the directive
`"use typeshade"`. The file uses TypeScript's own syntax: `function`, `const` and `let`,
`if`, `for`, `class`, operators and literals. The types are the GPU's: `f32`, `u32`, `vec3`,
`mat4`, `array<f32, 16>`. A decorator such as `@fragment` marks the function the GPU calls.
A wrong type or a misspelt field is an error in your editor, at the line you wrote.

Three places carry the structure. A top-level `export function` with a stage decorator
(`@vertex`, `@fragment` or `@compute`) is an entry point: the function the GPU calls, once
per vertex, per fragment or per compute invocation. Every other function is a helper it
calls. A `declare const` with a type such as `uniform<T>` or `storage<T>` is a resource the
host binds. A `class`, an `interface` or a `type` alias is a struct.

```ts
"use typeshade";

// One helper. The return type is the one the body returns.
export function ringMask(uv: vec2, radius: f32): f32 {
  return abs(length(uv) - radius);
}
```

`compile()` reads that source and returns the module and its outputs:

- `wgsl` is WGSL, the shading language WebGPU accepts.
- `glsl` is `{ vertex, fragment }`, GLSL ES 3.00 source for WebGL2, for a module that has a
  vertex and a fragment entry point.
- `module` is the compiled module. The other calls of the package read it.
- `diagnostics` lists every error and warning, each with its code, line and column.

The module is the input to the rest of the package:

- `emitModule(m)` and `emitGlslStages(m)` emit it again, under options you choose.
- `compileModule(m)` returns the CPU oracle: the same program evaluated in JavaScript with
  every value a double, which gives you the mathematically intended answer to compare a GPU
  run against.
- `reflect(m)` returns the metadata a host needs to build the pipeline: bind groups, the
  std140 and std430 byte layouts a uniform or storage buffer has to match, vertex
  attributes and entry signatures.

```ts
import { compile, compileModule, reflect } from 'typeshade'

const { wgsl, diagnostics, module: m } = compile(source) // source: the file above, as text
const cpu = compileModule(m) // cpu.fns.ringMask([0.3, 0.4], 0.5) === 0
const meta = reflect(m) // bind groups, layouts, entry signatures
```

`wgsl` holds this:

```wgsl
fn ringMask(uv: vec2<f32>, radius: f32) -> f32 {
  return abs((length(uv) - radius));
}
```

The names you wrote survive into the output, the parameter types became WGSL types, and
the return type came from the body. The optimizer adds bindings of its own where a
subexpression repeats, so an emitted body can carry a name you did not write.

A fixed-length array can be read with a local binding pattern: `const [first, , last] = xs`.
A shorter pattern is allowed; omitted positions still count toward the source length.
`const [a, b]: [u32, u32] = [1, 2]` supplies an explicit homogeneous tuple type. Without an
annotation, `const [a, b] = [1., 2.]` uses the same inference as `array(1., 2.)`.
Nested object/array patterns and getters work, with each receiver evaluated once. The bound
values are local copies, and numeric conversions still require explicit constructors.
Rest, defaults, vector iteration and patterns on runtime-sized arrays remain unsupported.
See `docs/use-typeshade-surface.md` §14 and §18.

### Importing

A shader file imports nothing from the package: the types, the builtins and the decorators
are the language's own. Host code imports the compiler and the calls that read its result
from the package root:

```ts
import { compile, emitModule, emitGlslStages, reflect, compileModule } from 'typeshade'
```

Other subpaths carry surface you do not need in order to compile and emit, and an import
you never write costs nothing in your bundle:

- `typeshade/runtime` loads a compiled program and runs it on WebGPU or on WebGL2, with no
  compiler in the bundle. `docs/use-typeshade-surface.md` §69 has it.
- `typeshade/vite` has the Vite plugin through which an ordinary host file imports a
  `.shade.ts` and calls its helper functions, which run on the CPU. See
  [Calling a module's helpers from host code](#calling-a-modules-helpers-from-host-code).
- `typeshade/dev` has the development tooling: lint reports, optimizer measurement
  and source locations in errors.
- `typeshade/emit-prod` has the ship-time text plugins that mangle, minify and
  obfuscate the emitted source.
- `typeshade/compute` has the runner that dispatches a portable compute kernel on
  whichever backend the host has.
- `typeshade/debug` steps one invocation of a `"use typeshade"` shader on the CPU
  oracle: it stops at each statement the author wrote, reports the source span and the
  frame's locals, and resolves breakpoints by line. It also carries the launch configuration
  that describes such a run as data, keyed by what the entry declares rather than by argument
  position, with a baked JSON Schema for a `launch.json` and a formatter that renders a value
  in the shader type its author wrote. It is what an editor's debug adapter and the
  Playground's step panel are both built on. See `docs/debugging.md`.
- `typeshade/core/ir` is the IR builder, for an engine or a tool that assembles a module in
  code instead of compiling a source. It has no stability promise before 1.0, and this guide
  does not use it: [`docs/ir-builder.md`](docs/ir-builder.md) does.

This package ships the compiler, and the small runtime a host import runs on. The shaders
themselves live in your repository and import the package like any other dependency.

### How this guide is ordered

The pages are in learning order, one topic each, and reading them in order the first time
is the shortest path. After that, each page stands on its own. Per-function detail lives
on that function's reference page, and every rule and refusal of the language is in
`docs/use-typeshade-surface.md`.

The pages that follow, in order:

- [Your first shader](/guide/authoring/your-first-shader/): write a file with a vertex
  and a fragment entry point, and compile it for both targets.
- [Values and mutation](/guide/authoring/values-and-mutation/): make a value, give it a
  type, and change it.
- [Functions and entry points](/guide/authoring/functions-and-entry-points/): declare a
  helper, an entry point, and the module that carries them.
- [Control flow](/guide/authoring/control-flow/): branch, loop, dispatch on an integer and
  return early.
- [Layouts and resources](/guide/authoring/layouts-and-resources/): declare an IO struct,
  a uniform block, a storage buffer or a texture once, and read the fields back with
  types.
- [Emitting and reflection](/guide/authoring/emitting-and-reflection/): emit WGSL and
  GLSL, and read the pipeline metadata a host binds against.
- [The CPU oracle](/guide/authoring/the-cpu-oracle/): run the same module in double
  precision and compare its numbers against a GPU run.
- [Diagnostics](/guide/authoring/diagnostics/): read a coded error, and collect every
  failure in a module into one report.
- [Conditional programs](/guide/authoring/conditional-programs/): build one specialized
  program per feature combination.
- [Capabilities & extensions](/guide/authoring/capabilities-extensions/): declare the GPU
  features a module's emit depends on, and check a booted device against them.
- [fp64](/guide/authoring/fp64/): get double precision on hardware that has only floats.
- [GLSL float precision](/guide/authoring/glsl-float-precision/): emit a GLSL stage at
  mediump, and see what that changes in the source.
- [Production emit](/guide/authoring/production-emit/): mangle, minify and obfuscate the
  shipped source, and read a driver log back through the renaming.
- [Migrating a GLSL shader](/guide/authoring/migrating-a-glsl-shader/): look up the GLSL
  construct in front of you and see how it is spelled here.

If you have never used this package, start with the next page. If you are here to port a
shader you already have, read Migrating a GLSL shader first and follow its links back.

## Your first shader

After this page you have a shader written in TypeScript with two entry points, the same
module emitted once as WGSL for WebGPU and once as GLSL ES 3.00 for WebGL2, and you know
which call produced each string. The shader fills the screen with a colour gradient.

The file starts with the directive, and everything after it is the shader:

```ts
"use typeshade";
```

The names a shader uses come from the language, not from an import. `f32`, `u32`, `vec2`
and `vec4` are types where a declaration needs a type, and `vec2(…)` and `vec4(…)` build a
value where an expression needs one. Arithmetic is TypeScript's own operators: `x * 4. - 1.`
is a multiply and a subtract.

### A vertex entry point

An _entry point_ is a function the GPU calls directly: once per vertex, once per fragment,
or once per compute invocation. This page uses the first two. You mark one with a stage
decorator, `@vertex`, `@fragment` or `@compute`, on a top-level `export function`. Every
other function you write is a plain helper.

The vertex stage runs once per vertex. It produces the clip space position and whatever
the fragment stage needs from it, packed in an _IO struct_: a class whose fields each carry
an attribute. `@builtin("position")` marks the value the hardware itself consumes, and
`@location(0)` marks a value that is interpolated across the triangle and read back by the
fragment stage.

```ts
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
```

WGSL fixes the type of every builtin but `clip_distances`, so the compiler checks the type
you write against the id: `@builtin("position")` on anything but a `vec4` is an error.

This shader has no vertex buffer. It draws three vertices that cover the screen, and it
derives their positions from the vertex index alone. A stage input is an ordinary
parameter with the same attribute:

```ts
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}
```

`vi` is a `u32`, and `f32(vi & 1)` converts it. A number written without a decimal point
takes the integer type of the operand beside it, so `vi & 1` needs no `u32(1)`; a number
written with one, `4.`, is an `f32`. The object literal takes the struct the return type
declares, so a missing or misspelt field is an error.

### A fragment entry point

The fragment stage runs once per candidate pixel and returns a colour. It takes the vertex
output as a parameter, so the fields declared on `VsOut` are what it reads: `vo.uv` is a
`vec2` with `.x` and `.y` on it.

```ts
@fragment
export function fs(vo: VsOut): vec4 {
  const shade = 1. - vo.uv.y;
  return vec4(vo.uv.x, shade, 0.5, 1.);
}
```

A bare fragment return goes to `@location(0)`, the first colour attachment, so nothing
is written for it. A struct return carries one `@location(n)` field per colour attachment.

### Assembling the module

A _module_ is the unit that emits, and a file is one. Everything the file declares is in
it: the struct, the two entries and any helper they call. Put together, the file reads:

```ts
"use typeshade";

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}

@fragment
export function fs(vo: VsOut): vec4 {
  const shade = 1. - vo.uv.y;
  return vec4(vo.uv.x, shade, 0.5, 1.);
}
```

A file that imports another shader file is one module with it:
[Functions and entry points](/guide/authoring/functions-and-entry-points/) has the form.

### Emitting both targets

`compile(source)` returns the whole module as one WGSL string, both entries included:

```ts
import { compile } from 'typeshade'

const { wgsl, glsl, diagnostics } = compile(source) // source: the file above, as text
```

```wgsl
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let shade = (1.0 - vo.uv.y);
  return vec4<f32>(vo.uv.x, shade, 0.5, 1.0);
}
```

GLSL ES 3.00 compiles one stage at a time, each source with its own `main`, so GLSL comes
back one string per stage. `glsl` is `{ vertex, fragment }`, from a single lowering of the
module, the pass that rewrites the IR into the shapes the target can spell:

```glsl
#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float x = ((float((vi & 1u)) * 4.0) - 1.0);
  float y = ((float((vi >> 1u)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = vec2(((x * 0.5) + 0.5), ((y * 0.5) + 0.5));
}
```

```glsl
#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float shade = (1.0 - uv.y);
  _ret = vec4(uv.x, shade, 0.5, 1.0);
}
```

The source was the same for both strings. The differences between the two outputs are the
ones each language forces: the IO struct becomes a matching `out` and `in` pair of
varyings, the fragment return becomes a declared output variable, the builtin position
becomes `gl_Position`, and `gl_VertexID` is a signed int so the `u32` parameter picks up a
cast. `diagnostics` is empty for this file; a file with an error has no `wgsl` and no
`glsl`, and its diagnostics say why.

### Where to go next

[Values and mutation](/guide/authoring/values-and-mutation/) covers `const` and `let`, and
how a variable is changed.
[Functions and entry points](/guide/authoring/functions-and-entry-points/) has the rest of
what a function and an entry point take, including the compute stage.
[Layouts and resources](/guide/authoring/layouts-and-resources/) is how a uniform block, a
storage buffer or a texture is declared once and read everywhere.
[Emitting and reflection](/guide/authoring/emitting-and-reflection/) covers the other emit
calls and the pipeline metadata a host binds from.

## Values and mutation

After this page you can write an intermediate value, give it a type where the code needs
one, mutate it, and tell a constant from a variable.

### Types

A type is written where a declaration needs one: a parameter, a return, a struct field, a
resource, an annotated local. The names are WGSL's, written the way TypeScript writes a
type.

```ts
"use typeshade";

export function scale(v: vec2, k: f32): vec2 {
  return v * k;
}
```

`f32` is the float scalar, and the type a number written with a decimal point has. `u32`
and `i32` are the integer scalars, `bool` is what every comparison produces, and `vec2`,
`vec3` and `vec4` are the float vectors. The unsigned vectors are `vec2u`, `vec3u` and
`vec4u`, the signed ones `vec2i`, `vec3i` and `vec4i`, and a matrix is `mat4` or any
`matCxR`. `array<T, N>` is a fixed length array of another type.

Each vector type has a constructor of the same name that builds a value: `vec3(1., 2., 3.)`
and `vec3u(1, 2, 3)`. A number written without a decimal point takes the element kind, so
`vec3u(1, 2, 3)` emits `vec3<u32>(1u, 2u, 3u)`.

Handed **one whole vector of the same size**, the constructor converts rather than composes:
`vec3(v)` on a `vec3u` is WGSL's `vec3<f32>(v)`, every component through the scalar
conversion, and the CPU oracle computes the same. A float source saturates into an integer
target and `i32`/`u32` reinterpret two's-complement, on every target: GLSL ES 3.00 leaves an
out-of-range source undefined, so the GLSL writer spells the conversion through `_f2i` and
`_f2u`, which saturate as WGSL does (Rule 11.12).

### Plain const bindings

Author every intermediate value as a plain `const`. There is nothing to wrap it in:

```ts
const ab = b - a;
const len2 = dot(ab, ab);
```

A `const` holds its value for the rest of the block, and assigning to one is an error. The
emit pass decides for each value whether it becomes an inlined expression, a shared `let`
(its common subexpression cache) or a named `let` of its own. That decision is not yours to
write down.

The GLSL target adds one hoist of its own. An argument to a struct constructor whose value
comes from a function that can `discard` is bound to a local variable immediately before
the constructor call. It happens on every GLSL emit, so there is nothing to mark in the
source, and the WGSL output is unaffected.

### let and const

`let` declares a variable you mean to change, and `const` a value you do not. The type
comes from the initial value, or from an annotation, with or without an initial value.

```ts
const d = length(p) - 1.; // let d = …;   read only
let t = 0.; // var t: f32 = 0.0;
let hits: u32 = 0; // var hits: u32 = 0u;
```

A `const` and a module constant are read-only, and assigning to one is `TS8005` at the line
that writes it. Declare with `let` when you mean to mutate. A parameter is a copy of the
value the call passes, so a write to it changes the copy and leaves the caller's variable
alone; [A function that changes its caller's variable](#a-function-that-changes-its-callers-variable)
is the form that writes the caller's.

A variable read before it is assigned on every path is `TS8075`, by TypeScript's own rule.
A derivative such as `fwidth` needs a value of its own for a different reason: WGSL requires
the call in uniform control flow, so bind it to a `const` outside the branch that reads it.

### Mutation and compound assignment

A write is TypeScript's own assignment. `x = v` writes a value, and `+=`, `-=`, `*=` and
`/=` are the compound updates. `++` and `--` step a numeric scalar.

```ts
let minDist = 1e10;
minDist = min(minDist, d);
winding += 1; // emits `winding += 1`
o.pos = vec4(pos, 0., 1.); // a struct field is a target too
o.pos.x = 2.; // and a component of one
```

The two spellings of an update differ in the emitted text, not in meaning: `acc += x` emits
`acc += x` and `acc = acc + x` emits `acc = (acc + x)`.

A swizzle target names exactly one component, as in WGSL: `v.xy = …` is refused, so assign
each component, or build the whole vector and assign that. Binding a value to another name
copies it, as it does on both GPU targets: after `let w = v; w.x = 100.;`, `v` is unchanged.
`docs/use-typeshade-surface.md` §9 has every target and refusal.

### Operators

Arithmetic, comparison, bitwise operations, component access and indexing are
TypeScript's operators, and they mean what WGSL means by them:

| category   | written                                           |
| ---------- | ------------------------------------------------- |
| arithmetic | `+ - * / % ` and unary `-`                        |
| compound   | `+= -= *= /= %=` · `++ --`                        |
| comparison | `< > <= >= == !=` (and `===`, `!==`)              |
| logical    | `&& \|\| !`                                       |
| bitwise    | `& \| ^ << >> ~`                                  |
| casts      | `f32(x) i32(x) u32(x) bool(x) f64(x)`             |
| components | `.x .y .z .w` · `.r .g .b .a` · `.xy .rgb .zxy …` |
| index      | `xs[i]`                                           |
| ternary    | `c ? a : b`                                       |
| power      | `a ** b`, which is `pow(a, b)`                    |

A few operations are builtin functions. `select(f, t, c)` is WGSL's own, so mind the
argument order: the condition is last, and `select(f, t, c)` is `c ? t : f`. `mod(x, y)` is
the floor modulo, the one to reach for wherever an operand can be negative, as in domain
repetition and angle folds; `%` is WGSL's truncating remainder and behaves differently on
negative operands. `radians` and `degrees` convert angles, so a conversion constant of
your own never has to be written or rounded.

```ts
const inside = d < 0. && u >= 0.;
const shade = inside ? 1. : 0.;
const cell = mod(p.x, 2.) - 1.;
const lonRad = radians(lon);
const latDeg = degrees(latRad);
```

### Number literals

A number written with a decimal point is an `f32`. A number written without one takes the
type its position declares, which is WGSL's abstract-integer rule:

```ts
x + 1.; // f32 x → x + 1.0
flags & 1; // u32 flags → flags & 1u
mode == 2; // u32 mode → mode == 2u
vec4(pos, 0., 1.); // float components
vec2u(0, 1); // → u32 components
```

The position may be a declared type (`let n: u32 = 16`), the operand beside it, a parameter
the call passes it to, a struct field or a vector constructor's element. In every float
position the literal stays an `f32`, so `mix(a, b, 1)` is `mix(a, b, 1.0)`. There is no
implicit conversion between types: an `i32` value where a `u32` is declared is an error, and
the cast is written. `docs/use-typeshade-surface.md` §13 has every position.

Negative literals take the type the same way. `x * -6.`, `x + -0.25` and `vec3(-1., 0., 1.)`
emit the signed literal on both targets, so the sign belongs in the number.

### Module constants

A top-level `const` is a module constant: declared once, emitted as a `const` on both
targets, and evaluated by the CPU oracle as well. A vector or an array constant carries its
value as an expression every backend emits:

```ts
"use typeshade";

const PI: f32 = 3.14159265;
const SKY = vec4(0.4, 0.6, 0.9, 1.);
const PALETTE = array<vec4, 3>(vec4(1., 0., 0., 1.), vec4(0., 1., 0., 1.), vec4(0., 0., 1., 1.));

export function area(r: f32): f32 {
  return r * r * PI;
}

export function tint(i: i32): vec4 {
  return PALETTE[i] * SKY;
}
```

The value must be constant: a literal, a constant declared earlier in the file, a
constructor over those, arithmetic over those, or a math builtin over those
(`const K: f32 = sin(1.)`). A constant read in a function is a name the editor resolves, so
a renamed or misspelt constant is an error at every use site.

## Functions and entry points

After this page you can declare a helper, call it from another function, write an entry
point for the vertex, fragment or compute stage, and assemble the module that carries them.

### Declaring a function

A `function` declaration authors every function in a shader, both plain helpers and the
entry points a pipeline runs. Its parameters are typed, and its body is ordinary
TypeScript.

```ts
"use typeshade";

// Helper: the return type is f32, the type the body returns.
export function distToSegment(p: vec2, a: vec2, b: vec2): f32 {
  const ab = b - a;
  const len2 = dot(ab, ab);
  const t = clamp(dot(p - a, ab) / max(len2, 1e-10), 0., 1.);
  const segDist = length(p - a - ab * t);
  return len2 < 1e-10 ? length(p - a) : segDist;
}
```

A parameter may carry a name that GLSL reserves, such as `sample`, `filter` or `texture`.
The IR keeps the name and the GLSL backend renames it at emit. A local function, a
function declared inside another, and a function that takes a function are TypeScript
shapes the surface takes too (`docs/use-typeshade-surface.md` §14).

### Return types

Leave the return type out and it is the type the body returns, as TypeScript infers it.
Every `return` is checked against that type, so a wrongly typed return is a compile error.
A body that returns nothing is `void`.

```ts
"use typeshade";

declare const outputB: storage<array<f32>, "read_write">;

// Inferred: dot() yields f32, so luma returns f32.
export function luma(c: vec3) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Inferred too: this one writes into a storage buffer and returns no value, so it is void.
export function store(i: u32, v: f32) {
  outputB[i] = v;
}

// Written: a return from inside a branch is an ordinary return.
export function firstHit(d: f32): f32 {
  if (d < 0.) {
    return 0.;
  }
  return d;
}
```

### Calling a function

A call passes its arguments by position, as TypeScript does, and the compiler checks
their number and their types against the declaration. A function the file declares or
imports wins over a builtin of the same name.

```ts
const d = distToSegment(uv, p0, p1);
```

A default parameter value is filled in at the call site, and a function may take another
function as a parameter, which every call names where it is in scope
(`docs/use-typeshade-surface.md` §14). Recursion is refused, because WGSL has no call stack.

### Entry points

An entry point is a top-level `export function` with a stage decorator: `@vertex`,
`@fragment` or `@compute`. A compute entry takes its workgroup size in the decorator,
`@compute([64])` or `@compute([8, 8])`, and a bare `@compute` takes the default of 64.

```ts
"use typeshade";

const WINDOW: u32 = 8;

declare const params: uniform<vec4u>;
declare const input: storage<array<f32>>;
declare const output: storage<array<f32>, "read_write">;

@compute([64])
export function reduceWindows(@builtin("global_invocation_id") gid: vec3u): void {
  const idx = gid.x;
  if (idx >= params.x) {
    return;
  }
  const base = idx * WINDOW;
  let acc = 0.;
  for (let k: u32 = 0; k < WINDOW; k++) {
    acc += input[base + k];
  }
  output[idx] = acc;
}
```

The guard leaves the function before its last statement with a plain `return`.
[Control flow](/guide/authoring/control-flow/) covers early exits.

A workgroup size may instead be an `override<u32>` name shared with a workgroup scratch
array's outer length. Ordinary TypeScript can choose the specialization from the input
shape and pass it through `program.compute(entry, { constants })`, or through an imported
entry's optional third argument, `entry(bindings, groups, { constants })`. A program pipeline
reports the resolved `pipeline.workgroupShape`. Entry calls, including calls in `device.fuse()`,
use the selected shape without changing the supplied workgroup count. See
[`docs/use-typeshade-surface.md` §3](docs/use-typeshade-surface.md#3-entries--function-decorators-and-explicit-builtins),
[`§15`](docs/use-typeshade-surface.md#15-textures-samplers-and-overrides),
[`§24`](docs/use-typeshade-surface.md#24-module-variables) and
[`§69`](docs/use-typeshade-surface.md#69-running-a-compiled-program) for the source form,
limits and host call.

### Stage parameters

A stage takes its inputs as attributed parameters. `@builtin("id")` declares a value the
hardware supplies, such as `"vertex_index"`, `"position"` or `"global_invocation_id"`, and
`@location(n)` declares a numbered slot that carries data between stages. The same two
attributes describe the fields of an IO struct, a class both stages then share;
[Layouts and resources](/guide/authoring/layouts-and-resources/) has the interpolation
modes.

```ts
"use typeshade";

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

interface Gradient {
  top: vec4;
  bottom: vec4;
  mixBias: f32;
}

declare const u: uniform<Gradient>;

@vertex
export function vsFull(@builtin("vertex_index") idx: u32): VsOut {
  let pos = vec2(-1., -1.);
  if (idx == 1) {
    pos = vec2(3., -1.);
  } else if (idx == 2) {
    pos = vec2(-1., 3.);
  }
  return { pos: vec4(pos, 0., 1.), uv: vec2((pos.x + 1.) * 0.5, (pos.y + 1.) * 0.5) };
}

@fragment
export function fsGradient(vo: VsOut): vec4 {
  const t = vo.uv.y + u.mixBias;
  const rgb = mix(u.bottom.rgb, u.top.rgb, t);
  return vec4(rgb, 1.);
}
```

A fragment entry that returns a plain value gets `@location(0)`, the first colour
attachment, without asking. A vertex entry that returns a plain `vec4` returns the
position. An entry that returns a struct carries the attributes in the struct fields.

### Assembling a module

A file is a module: its functions, its structs, its constants and its resources are what
emit together. The WGSL carries every function the file declares, in the order the file
declares them, since WGSL lets a function call one declared after it. Each GLSL stage
carries only the functions its entry reaches, a callee before its caller, as GLSL ES 3.00
requires.

A file imports what another shader file exports, as any TypeScript module does. The file
you compile and the shader files it imports, directly or through another, are one program,
and the program becomes one module. What your file reaches in an imported file comes with
it, its helpers, structs, constants and bindings; the imported file's own entry points do
not.

```ts
// noise.shade.ts
"use typeshade";

export function hash(p: vec2): f32 {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// clouds.shade.ts
"use typeshade";

import { hash } from "./noise.shade.ts";

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(hash(uv), hash(uv * 2.), 0., 1.);
}
```

[A shader module that imports another](#a-shader-module-that-imports-another) has the host
call that compiles such a program.

### Naming the functions in a module

A function is emitted under the name you declared it with, on both targets, unless that target
cannot use the name. A function whose name a target reserves, `use` in WGSL for instance, is
emitted as `use_` on that target. An entry point named like a builtin is emitted under a fresh
name too. The host still creates the pipeline by the name you wrote, since the record names both.

The compiler gives a helper another name in two more cases. A helper named like a builtin, a
`fract` of your own, is emitted as `fract_`, and every call through the declaration with it,
because WGSL would hide the builtin and GLSL ES 3.00 refuses the redeclaration. Two files
of one program that each declare a private helper of one name emit the second under a name
of its own. The CPU oracle calls each function by the name the file gave it.
`docs/use-typeshade-surface.md` §62 has the names each target reserves.

## Control flow

After this page you can branch, loop and dispatch inside a shader body, and you can tell a
statement that picks what to do from an expression that picks a value. Each form is
TypeScript's own, and each emits the WGSL and GLSL statement of the same shape.

### if, else if and else

`if` takes a `bool`. There is no truthiness: `if (n)` on a number is refused, so write the
comparison, `if (n != 0)`.

```ts
if (idx == 1) {
  pos = vec2(3., -1.);
} else if (idx == 2) {
  pos = vec2(-1., 3.);
} else {
  pos = vec2(-1., -1.);
}
```

`!` is logical negation, so a guard on the false case reads `if (!hit)`.

### for and while

`for` is the counted loop: an integer counter, a constant step, and an exit that compares
the counter to a bound the body does not write. The bound may be a value the program learns
at run time, a uniform, a parameter or a storage array's `.length`.

```ts
let acc = 0.;
for (let i: u32 = 0; i < 64; i++) {
  acc += f32(i);
}
```

The counter needs no annotation when its start is a non-negative literal and the bound is a
`u32`; otherwise it is an `i32`. A step that moves the counter away from its bound is
refused with `TS8007`, because the loop would not exit. `while (cond)` is the open loop, for
a loop with no counter.

```ts
let n: u32 = start;
let steps: u32 = 0;
while (n != 1) {
  n = select(n / 2, 3 * n + 1, (n & 1) == 1);
  steps++;
}
```

`docs/use-typeshade-surface.md` §17 has every loop header the compiler takes, and why it
refuses the rest.

### Break, continue and discard

Three statements end a piece of work early. `break` exits the nearest enclosing loop, or
the current switch case. `continue` skips to the next iteration of the nearest enclosing
loop. `discard` kills the current fragment invocation with no colour or depth write, and
belongs in a fragment stage.

```ts
"use typeshade";

declare const dists: storage<array<f32>>;

@fragment
export function fs(@location(0) alpha: f32, @location(1) @interpolate("flat") count: u32): vec4 {
  let nearest = 1e10;
  for (let i: u32 = 0; i < count; i++) {
    const d = dists[i];
    if (d < 0.) {
      continue; // no distance recorded, next iteration
    }
    if (d < 0.001) {
      break; // close enough, leave the loop
    }
    nearest = min(nearest, d);
  }
  if (alpha < 0.01) {
    discard;
  }
  return vec4(nearest, 0., 0., alpha);
}
```

`discard` is allowed in a fragment entry, and in a helper as long as no vertex or compute
entry can reach it: the check closes over the call graph, and a refusal names the helper
and the entry.

### Switch

`switch` dispatches on a single integer value, the _scrutinee_, which is an `i32` or a
`u32`. Each `case` label is a constant, and `default` is the optional fall-through arm. It
lowers to a real `switch` on both targets.

```ts
let radiusPx = rawRadius;
switch (sizeMode) {
  case 1:
    radiusPx = rawRadius / viewport.z;
    break;
  case 2:
    radiusPx = rawRadius * dpr;
    break;
  default:
    break;
}
```

A case ends in `break` or `return`. WGSL has no fall-through, so a case that runs into the
next one is refused with the remedy.

### Choosing a value

The ternary `c ? a : b` picks a value by a condition. It is WGSL's `select`, so both arms
are evaluated and one is chosen, which suits a pair of cheap values:

```ts
const dir = segLen < 1e-6 ? vec2(1., 0.) : segVec / segLen;
```

When an arm is expensive, or a chain of conditions picks among several values, declare the
variable and assign it in an `if` chain, so the GPU runs only the arm it takes:

```ts
let clip: vec4;
if (projParams.x < 0.5) {
  clip = mvp * vec4(rel2d, 0., 1.);
} else if (projParams.x < 6.5) {
  clip = mvp * vec4(relG, 0., 1.);
} else {
  clip = mvp * vec4(ecefRtc, 1.);
}
```

### Folding a loop with reduce

An _accumulator_ is a value carried from one iteration of a loop to the next. An array's
`reduce` carries one for you: `xs.reduce(f, init)` runs `acc = f(acc, value, index)` from
`init`, left to right, as TypeScript runs it.

```ts
"use typeshade";

export function nearestOf(p: vec2, pts: array<vec2, 8>): f32 {
  return pts.reduce((acc, q) => min(acc, length(p - q)), 1e10);
}
```

The call emits the loop and the variable it updates, the same code as writing `let` plus
`for` plus the assignment yourself. `map`, `forEach`, `some` and `every` are there too, and
all but `map` work on a runtime-sized storage array (`docs/use-typeshade-surface.md` §63).

### Dispatch on an enum

A numeric `enum` declares a set of named integer constants, and each member is a module
constant, so a member can stand in a `case` label:

```ts
"use typeshade";

enum Kind {
  Line,
  Fill,
  Stroke,
}

export function colorOf(kind: i32, line: vec4, fill: vec4, stroke: vec4): vec4 {
  switch (kind) {
    case Kind.Line:
      return line;
    case Kind.Fill:
      return fill;
    default:
      return stroke;
  }
}
```

`Kind.Fill` reads the constant, `1`, and the enum's name as a type is `i32`. A member the
enum does not declare is an error where it is read. A string member is refused, because no
GPU type holds one.

### Early returns

A `return` inside a branch or a loop leaves the function, as it does in TypeScript:

```ts
"use typeshade";

export function sign01(winding: i32, minDist: f32): f32 {
  if (winding != 0) {
    return 1. - minDist;
  }
  return 1. + minDist;
}
```

A function that returns a value must return one on every path. A path that falls off the
end of a value-returning function is an error at compile.

## Layouts and resources

After this page you can declare a vertex, uniform, storage or texture layout once and read
every field off that one declaration.

A layout is the agreement between a shader and the pipeline that feeds it: the fields one
stage hands to the next, the uniform block a draw call binds, the buffers and textures at
each slot. Each is a declaration in the file. A struct is a `class`, an `interface` or a
`type` alias, and a resource is a `declare const` whose type says what it holds. Because
every read names a declared field, a field name or a field type you get wrong is an error at
the line that reads it.

### IO structs

An IO struct is a group of fields that crosses a stage boundary: a vertex stage returns
it and a fragment stage takes it as a parameter. It is a `class`, because only a class
field can carry a decorator, and every field carries a stage attribute.
`@builtin("id")` declares a value the hardware supplies, and takes a WGSL builtin id such as
`"position"` or `"vertex_index"`; an id WGSL does not define is an error. `@location(n)`
declares a numbered slot, with an optional `@interpolate("flat")`, `@interpolate("linear")`
or `@interpolate("perspective")`. An integer field gets `flat` without asking, because both
targets require it for an integer varying. `"flat"` and `"perspective"` are the modes both
targets support; `"linear"` has no GLSL ES 3.00 form, so a module that uses it has no GLSL.

```ts
"use typeshade";

class VsIn {
  @location(0) xy: vec2;
  @location(1) uv: vec2;
}

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
  @location(1) vis: f32;
  @location(2) id: u32; // an integer varying: flat on both targets
}

// A vertex entry returns the struct. The object literal takes the declared struct,
// so a missing or extra field is an error.
@vertex
export function vsMain(v: VsIn, @builtin("instance_index") inst: u32): VsOut {
  const pos = vec4(v.xy, 0., 1.);
  return { pos: pos, uv: v.uv, vis: 1., id: inst };
}

// Read fields off a parameter declared with the struct.
@fragment
export function fsMain(input: VsOut): vec4 {
  if (input.vis < 0.) {
    discard;
  }
  return vec4(input.uv, f32(input.id), 1.);
}
```

A vertex entry's `@location` inputs are vertex attributes, loose parameters or the fields of
a struct parameter such as `VsIn`, and `reflect()` reports their buffer layout. A struct
value built over several statements is a `let` of the struct type whose fields you assign.

### Uniform blocks

A uniform block is a struct the host fills once per draw and every invocation reads. Declare
the struct, then the binding, with `declare const` and no initializer: the type is
`uniform<T>`. Read a field by name. The result is an ordinary value, so component access and
math chain straight off it. A uniform is read-only, so assigning to a field is an error in
the editor and at compile.

```ts
"use typeshade";

interface Uniforms {
  mvp: mat4;
  projParams: vec4;
  rasterParams: vec4;
}

declare const u: uniform<Uniforms>;

@vertex
export function vs(@location(0) pos: vec3): vec4 {
  const opacity = u.rasterParams.x;
  return u.mvp * vec4(pos, opacity);
}
```

The slot is the declaration's place in the file: each `declare const` takes the next binding
of group 0, and `reflect()` reports it to the host. `uniform<T>` takes no access mode, since a
uniform buffer is read-only.

A uniform may also hold one scalar or vector, `declare const mode: uniform<u32>`, on WGSL.
GLSL ES 3.00 spells a uniform binding as a std140 block, so a module that targets WebGL2 puts
the value in a struct; for a scalar uniform `compile()` keeps the WGSL and reports the GLSL
half as a `TS8015` warning. The surface reference has every form and each refusal:
`docs/use-typeshade-surface.md` §1.

### Plain structs

A struct that never crosses a stage boundary has no attribute on its fields: the element
type of a storage buffer, or a struct nested inside another one. Write it as a `class`, an
`interface` or a `type` alias over an object type; the three are one struct.

```ts
"use typeshade";

class ShapeSegment {
  kind: u32;
  colorIdx: u32;
  flags: u32;
  pad: u32;
  p0: vec2;
  p1: vec2;
  p2: vec2;
  p3: vec2;
}

declare const segments: storage<array<ShapeSegment>>;

export function segmentLength(i: u32): f32 {
  const seg = segments[i];
  return length(seg.p1 - seg.p0);
}
```

A `class` is always part of the module. A `type` or an `interface` is part of it when
something uses it: a binding, a parameter, a return, a local or a field of another used
struct. One that nothing uses is left alone, since it may be a host-side shape.

### Storage buffers

A storage buffer is a bound array whose length comes from the buffer the host binds.
Declare it with `declare const` and no initializer. The access mode is the second type
argument: `storage<T>` is a `read` binding, and `storage<T, "read_write">` is a writable
one. Index the array as you index any array:

```ts
"use typeshade";

declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

@compute([64, 1, 1])
export function twice(@builtin("global_invocation_id") gid: vec3u): void {
  dst[gid.x] = src[gid.x] * 2.0;
}
```

The two declarations emit `var<storage, read> src: array<f32>;` and
`var<storage, read_write> dst: array<f32>;`, at bindings 0 and 1 of group 0, in source order.
A write to `src` is an error in the editor and at compile. The element can be a struct, a
scalar or a vector, so `storage<array<vec4>>` holds one `vec4` for each element, and
`src.length` is the bound buffer's element count.

GLSL ES 3.00 has no storage buffer object, so a read binding lowers to a data-texture fetch
at emit and the shader source stays as written. On the GLSL target the host allocates that
data texture, and its internal format has to match the sampler the lowering declares: R32F
for a float array, R32UI for `array<u32>` and `array<vecN<u32>>`, R32I for `array<i32>` and
`array<vecN<i32>>`. A vector element takes its std430 lanes, so a `vec4u` is four texels. A
struct element takes R32F when its fields are all floats, and R32UI when it has a `u32` or
`i32` field: upload its std430 bytes as a `Uint32Array`, and the shader reads its float fields
back through `uintBitsToFloat`. Nothing checks the pairing at runtime, so allocate from the
binding's `glslDataTexture` in `reflect()` (`'r32f'`, `'r32ui'` or `'r32i'`) instead of
tracking it separately.

That lowering only gathers. A `"read_write"` binding that a vertex or fragment entry
reaches therefore has no GLSL form: `compile()` keeps the WGSL, leaves `glsl` undefined and
reports a `TS8015` warning. A compute entry writes one on WebGL2 through its pass program,
which [Portable compute kernels](#portable-compute-kernels) describes.

### Textures and samplers

A texture and a sampler are written bare, with no `uniform<>` or `storage<>` wrapper,
because a handle lives in no address space. The type decides what a read accepts:
`texture_2d<f32>` is a 2D texture of filtered floats, and `sampler` is the object that
carries the filtering and wrap state. Each takes the next binding slot in declaration order,
like any other resource.

```ts
"use typeshade";

declare const tex: texture_2d<f32>;
declare const texSampler: sampler;

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const c = textureSample(tex, texSampler, uv); // fragment only
  const cv = textureSampleLevel(tex, texSampler, uv, 0.); // any stage
  const size = textureDimensions(tex); // vec2u, the extent in texels
  return c + cv * f32(size.x);
}
```

`textureSample` takes its mip level from screen-space derivatives, which only a fragment
invocation has, so it is fragment-only: a use that a vertex or compute entry reaches is an
error naming the entry. Read an explicit level with `textureSampleLevel(tex, smp, uv, level)`,
which is legal in every stage. The derivative builtins `fwidth`, `dpdx` and `dpdy` are
fragment-only for the same reason and have no vertex or compute form, so precompute the
quantity there and pass it in. On GLSL ES 3.00 the texture and the sampler fuse into one
`sampler2D`, and the sampler argument disappears from the call.

### Array and integer textures

A 2D array texture holds N layers behind one binding, with the layer picked on each call, so
an atlas of any depth costs one slot. Declare it as `texture_2d_array<f32>`. The same read
functions cover it: the texture's type selects the array form, and the `layer` argument then
becomes required. A layer is an `i32` and a `textureLoad` level a `u32`, so a bare number
takes the right type. `textureDimensions` reports width and height only, for an array
texture too, and the layer count is the separate `textureNumLayers`, which returns a `u32`.

An integer texture holds exact 32-bit texels, for an id map, a packed colour table or a
bitfield lookup. `texture_2d<u32>` and `texture_2d<i32>` declare the 2D forms, and
`texture_2d_array<u32>` and `texture_2d_array<i32>` the array twins. The result of a load
follows the texture's element, `vec4u` off an unsigned one and `vec4i` off a signed one.
`textureSample` and `textureSampleLevel` refuse an integer texture and name `textureLoad`
instead, because filtering is a weighted average and WGSL has no sampling form for an
integer texture at all.

```ts
"use typeshade";

declare const atlas: texture_2d_array<f32>;
declare const atlasSampler: sampler;
declare const ids: texture_2d<u32>;

@fragment
export function fs(@builtin("position") p: vec4, @location(0) uv: vec2): vec4 {
  const layer: i32 = 2;
  const a = textureSample(atlas, atlasSampler, uv, layer); // implicit LOD, fragment only
  const b = textureSampleLevel(atlas, atlasSampler, uv, layer, 0.); // explicit LOD, any stage
  const c = textureLoad(atlas, vec2i(0, 0), layer, 0); // unfiltered texel fetch
  const n = textureNumLayers(atlas); // u32
  const id = textureLoad(ids, vec2i(p.xy), 0); // vec4u
  const size = textureDimensions(ids); // vec2u, as for any other texture
  return a + b + c + vec4(f32(n), f32(id.x), f32(size.x), 1.);
}
```

`reflect()` reports each texture binding's dimension and element, which is what a host needs
to create a matching view and to pick the sample type for it. Getting that pairing wrong
raises nothing at runtime: a texture whose format disagrees with its sampler type is
incomplete, and a fetch on it silently returns zero. The cube, 3D, depth, multisampled and
storage textures are in `docs/use-typeshade-surface.md` §33 to §37.

## Emitting and reflection

After this page you can turn a module into WGSL, into both GLSL stages, or into a fragment
a host composes into its own program, and you can read the pipeline metadata a host binds
from.

Emitting turns the IR a module holds into source text for one target. Reflection is the
other half of the same module: a description of what the shader expects, as data, so the
code that allocates buffers, builds bind groups and sets a vertex layout reads it off the
module instead of repeating it by hand. Both are read-only over the IR, so calling either
one leaves the module you pass exactly as it was.

The samples on this page read the module `compile()` returns, named `m`, for this source:

```ts
"use typeshade";

interface Uniforms {
  time: f32;
  tint: vec4;
}

declare const u: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@location(0) xy: vec2): VsOut {
  return { pos: vec4(xy, 0., 1.), uv: xy * 0.5 + 0.5 };
}

@fragment
export function fs(vo: VsOut): vec4 {
  return u.tint * (0.5 + 0.5 * sin(u.time + vo.uv.x));
}
```

### Emitting WGSL

`compile()` already returns the WGSL as `wgsl`. `emitModule(m)` returns the same string from
the module, and takes the options a build varies: an optimization level, the parenthesis
mode, the f64 flavor and a plugin chain. It runs the pre-emit checks first, so a module that
does not validate, or that needs a capability the target lacks, throws a coded error at the
emit call.

```ts
import { compile, emitModule, emitModuleAt, emitIdentity } from 'typeshade'

const { module: m } = compile(source)
const wgsl = emitModule(m) // the same string as compile(source).wgsl

// The same module at an explicit optimization level. 'O2' is what emitModule runs and is
// byte-identical to it; 'O0' is the lowered module with no optimizer pass.
const naive = emitModuleAt(m, 'O0')

// A one-line identity for one emit configuration, for a build to compare:
emitIdentity('wgsl') // 'wgsl;parens=full;fp64=float;plugins=-#069d5f95'
```

An emit is a configuration as well as a module. Parenthesis mode, the f64 flavor, pinned
override values and the plugin chain all change the emitted bytes, and two files produced
by two of those configurations look like an unexplained diff. `emitIdentity(target, opts)`
folds the configuration into a readable summary plus a digest of it. Write it beside an
artifact you commit and compare it after a build: equal stamps mean the same configuration
produced both, and different stamps name the axis that moved.

### Emitting GLSL ES 3.00

A WebGL2 program is two shaders compiled separately, so the GLSL backend spells one stage
per call. `emitGlslStages(m)` returns both stages of one module and pays the shared
lowering once for the pair; it is what `compile()` returns as `glsl`.

```ts
import { emitGlslModule, emitGlslStages } from 'typeshade'

const { vertex, fragment } = emitGlslStages(m)

// One stage on its own, byte-identical to that member of the pair.
const fs = emitGlslModule(m, 'fragment')

// Omit the stage for the whole module in one string. It carries every entry point, so it
// is for reading and diffing and does not compile as a stage.
const whole = emitGlslModule(m)
```

Each string carries its own `#version 300 es` line, the precision preamble, and only the
declarations that stage reaches. The two stages still agree on every shared name, because
the lowering is deterministic, so the pair links. `emitGlslStages` also takes
`vertexEntry` and `fragmentEntry` for a module that carries several entry points in one
stage, and naming them keeps the single lowering. GLSL has one `main()` per stage, so such a
stage with no entry named is refused, by `emitGlslStages` and `emitGlslModule` alike, and
`compile()` reports it as a `TS8015` warning with `glsl` left undefined. The GLSL calls take the WGSL emit
options plus their own; the `GlslEmitOptions` reference lists them.

### Module fragments

A module fragment is a piece of a program: the declarations and helpers with no version
header and, by default, no entry point, for a host that owns the final program and pastes
ours into it. It is what to reach for where a GLSL host codebase would write `#include`.
`emitGlslFragment(m, stage)` returns one for GLSL and `emitFragment(m)` for WGSL, both in
the same shape.

```ts
import { emitFragment, emitGlslFragment } from 'typeshade'

const f = emitGlslFragment(m, 'fragment')

f.source // 'struct VsOut {\n  vec4 pos;\n  vec2 uv;\n};…', the declarations and helpers
f.preamble // ['#version 300 es', 'precision highp float;', 'precision highp int;']
f.declares // { functions, structs, bindings, consts, overrides, entryPoints }
f.requires // [], the symbols this fragment calls and does not define

// Keep the entry points, and the WGSL twin:
const w = emitFragment(m, { entryPoints: true })
```

The preamble comes back as data so the composer merges and de-duplicates those lines across
every fragment it assembles. Nothing is dropped, so nobody has to strip a header with a
regular expression. `declares` is the manifest of what `source` defines, which a composer
can check for a collision before it concatenates, and `requires` lists what the host's own
prelude has to supply. Entry points are excluded unless you ask for them, and they are
listed in `declares.entryPoints` either way, because they still decide the stage scope:
which helpers, structs and bindings the fragment carries is what that stage needs. A
fragment runs the same pre-emit checks a whole-module emit runs.

### What reflect returns

`reflect(m)` describes a module as target-neutral data. Target-neutral means `reflect`
takes only a module, with no backend argument, so one reflection describes the WGSL emit
and the GLSL emit of that module at once.

```ts
import { reflect } from 'typeshade'

const r = reflect(m)

r.bindGroups // [{ group: 0, entries: [{ group: 0, binding: 0, name: 'u', space: 'uniform',
//                 resourceKind: 'uniform-buffer', owner: 'module',
//                 structName: 'Uniforms', stages: ['fragment'] }] }]
r.uniforms // [{ name: 'Uniforms', size: 32, align: 16, fields: [
//              { name: 'time', type: 'f32', offset: 0, align: 4, size: 4 }, … ] }]
r.storage // std430 layouts for a storage binding declared directly as a struct
r.vertex // { attributes: [{ name: 'xy', location: 0, type: 'vec2<f32>', offset: 0 }], arrayStride: 8 }
r.entries // [{ name: 'vs', stage: 'vertex', inputs: ['vec2<f32>'], output: 'struct:VsOut', io }, …]
r.overrides // the pipeline constants a host supplies per variant
r.requiredFeatures // the capabilities a host must have active before it creates a pipeline
r.requiredLanguageFeatures // the WGSL language features the browser must implement
r.requires // host-provided globals the module references and does not declare
```

`uniforms` is std140 and `storage` is std430, the two byte layouts the targets use for a
uniform block and for a storage buffer. Each one gives every field its offset, alignment and
size, plus the struct's own size already rounded up to its alignment, so that size is the
stride for an array of the struct as well. A `storage<array<T>>` binding is an array of the
element type, so it appears in `bindGroups` and `storage` has no entry for it. To get that
element's std430 stride, or the layout of any struct the module declares, call `wgslLayout`
on its declaration, as in
`wgslLayout(m.structs.find((s) => s.name === 'ShapeSegment')!, 'std430')` for the struct
[Layouts and resources](/guide/authoring/layouts-and-resources/) declares. `vertex` is
`undefined` for a module whose vertex entry takes no `location` parameters.

`packModule(m)` gathers the same facts into one plain-JSON manifest, the program's WGSL, its
bindings with their byte layouts, its entries and its WebGL2 programs, which a build writes
to disk and `typeshade/runtime` loads (`docs/use-typeshade-surface.md` §69).

### Binding from reflection

A host walks `bindGroups` and creates one resource per entry. Three fields carry the
decision.

```ts
import { reachFrom, reflect, stageOf } from 'typeshade'

for (const group of reflect(m).bindGroups) {
  for (const e of group.entries) {
    if (e.owner === 'host') continue // the surrounding renderer allocates this one
    e.resourceKind // 'uniform-buffer' | 'storage-buffer' | 'texture' | 'sampler'
    e.stages // ['fragment'], ordered vertex, fragment, compute
  }
}

// The same reachability question for an entry set you choose yourself:
const reach = reachFrom(
  m,
  m.funcs.filter((f) => stageOf(f) === 'fragment'),
)
reach.bindings // Set { 'u' }, the binding names that stage reads
reach.fns // the call-graph closure from those entries, the entries included
```

`owner` says who owns the resource. It is `'module'` when the module declares the binding
and the host allocates it from this reflection, which is every binding a `"use typeshade"`
file declares. `resourceKind` says what to create, and a texture entry
also carries `textureDim` and `textureElem`, the two axes a view needs, which
[Layouts and resources](/guide/authoring/layouts-and-resources/) covers from the
authoring side, and `sampleType`, the word its bind group layout takes. A depth texture is
`'depth'` and an integer one `'uint'` or `'sint'`. An `f32` texture is `'float'` where a call
gives it a sampler, and `'unfilterable-float'` where the program only loads, measures or counts
it, which is what a 32-bit float texture such as `r32float` needs. `stages` says which stages
reach the binding, which is the visibility mask a
WebGPU bind group layout entry requires and the per-stage assignment a WebGL2 host makes for
uniform block points and texture units.

The bind groups include a binding a lowering injects as well as the ones you declared. The
[fp64](/guide/authoring/fp64/) lowering adds a texture binding named `_fp64`, the guard
texture that page describes, to a module whose emulated helpers read it, and a host that
binds from this reflection binds it without knowing that. Pass `reflect` the same `fp64Flavor` the emit will get, so the reflection
describes the program that will run.

## The CPU oracle

After this page you can run a module on the CPU in double precision and compare its numbers
against what a GPU produced.

The CPU oracle is a third backend over the same IR the WGSL and GLSL writers read. It
evaluates the module in JavaScript, with no device and no browser, and every function in the
module becomes a callable you pass numbers to and read numbers back from. It answers what the
shader should compute, which is the reference a GPU run is held against when a pixel comes out
wrong. It runs the same validation the two GPU writers run, so a module it rejects is a module
they would reject too.

### Compiling a module for the CPU

`compileModule(m)` returns a `CpuModule`: a `fns` record keyed by function name, plus a
`setBinding` method for the resources the module reads. Entry points and helpers are both in
`fns`, under the names they were declared with. Values crossing the boundary are plain
JavaScript. A scalar is a `number` or a `boolean`, a vector or a matrix is a flat `number[]`,
and a struct is an object keyed by field name.

```ts
"use typeshade";

export function len(p: vec2): f32 {
  return sqrt(dot(p, p));
}
```

```ts
import { compile, compileModule } from 'typeshade'

const cpu = compileModule(compile(source).module) // source: the file above, as text
cpu.fns.len([3, 4]) // → 5
```

`compileModule` walks the IR node by node on every call. `compileModuleJs(m)` takes the same
arguments and returns the same shape, and it walks each function body once, emits JavaScript
source for it and builds that source with `new Function`. Reach for it when the same module
runs thousands of times, on a per-frame path or across a whole buffer of rows. A body it cannot
generate falls back to the interpreter for that one function, so a module can be part compiled
and part interpreted with no change at the call site. The one case a caller handles is a host
that forbids `eval`, where `new Function` itself throws and `compileModule` is the way through.

`compile()` returns an `eval(name, args)` of its own beside the module, for a quick call. And
with the Vite plugin, host code calls an exported helper directly, as
[Calling a module's helpers from host code](#calling-a-modules-helpers-from-host-code) shows.

### Bindings and calls

A binding is a resource the pipeline supplies: a uniform block, a storage buffer, a texture, a
sampler. The oracle has no GPU memory behind those, so you supply each value with
`setBinding(name, value)` before the first call. The name is the one the `declare const`
carries. `reflect(m).bindGroups` lists every binding a host must fill, including the ones a
lowering injects. The oracle asks only for the ones a function it runs actually reads, so a
module with f64 arithmetic needs no value for the injected `_fp64` guard texture that
[fp64](/guide/authoring/fp64/) describes. A binding a function reads and nothing set throws
`typeshade/cpu: unbound <name>`.

```ts
"use typeshade";

interface Params {
  scale: f32;
}

declare const u: uniform<Params>;
declare const data: storage<array<f32>>;

export function scaleAt(i: u32): f32 {
  return data[i] * u.scale;
}
```

```ts
const m = compile(source).module // source: the file above, as text
const cpu = compileModule(m)
cpu.setBinding('u', { scale: 2 }) // a uniform block: an object keyed by field name
cpu.setBinding('data', [1, 2, 3]) // a buffer: one flat array
cpu.fns.scaleAt(2) // → 6
```

Arrays and structs are held by reference, so a `read_write` storage buffer is written in place:
bind an array, run the calls, then read that same array back for the results. An `f64` value is
one JavaScript number on this side. The GPU carries it as a pair of f32 values, a high part
and a low part, and `splitF64(x)` returns that pair for the host to pack into the buffer, so
the two sides describe the same number in the shape each one needs.

### The f64 and f32 precision modes

Both compile functions take a `precision` option, and it decides how f32 arithmetic is
evaluated. Under `'f64'`, the default, every operation runs in JavaScript's double precision
with no rounding in between, so the result is the mathematically intended one to 53 significand
bits. Use it to ask whether the module picked the right operations in the right order. It is
blind by construction to an error that appears only once a value is squeezed into 32 bits.

Under `'f32'`, every f32-typed operation rounds to f32 afterwards, with an infinity on
overflow, over the same module the GPU backends are given. Use it to ask whether the target
computes this value, and a comparison against a GPU readback can then be an ulp-scale one
instead of a tolerance wide enough to hide a real disagreement.

```ts
"use typeshade";

export function acc(a: f32, b: f32): f32 {
  return a + b;
}
```

```ts
const m = compile(source).module // source: the file above, as text

compileModule(m).fns.acc(1, 2 ** -30) // → 1.0000000009313226
compileModule(m, { precision: 'f32' }).fns.acc(1, 2 ** -30) // → 1
```

The mode is separate from the emulated `f64` type, which [fp64](/guide/authoring/fp64/)
covers. It stays a full double here while the GPU runs it as a pair of f32 values carrying
about 48 significand bits. The WGSL, GLSL and CPU results for such a module agree within
that width.

A comparison then reads the buffer the GPU wrote and walks it against the same module on the
CPU, one row at a time.

```ts
import { compileModuleJs } from 'typeshade'

// m: the module of the bindings sample above.
const cpu = compileModuleJs(m, { precision: 'f32' })
cpu.setBinding('u', { scale: 2 })
cpu.setBinding('data', Array.from(rows)) // rows: the input the GPU run was given

// gpuOut: the Float32Array read back from that GPU run.
for (let i = 0; i < gpuOut.length; i++) {
  const expected = cpu.fns.scaleAt(i) as number
  if (Math.abs(gpuOut[i] - expected) > 1e-6) {
    throw new Error(`row ${i}: GPU ${gpuOut[i]}, CPU ${expected}`)
  }
}
```

### Calls with no CPU meaning

Some calls throw when a call reaches them. The GPU-only intrinsics have nothing to compute
from: the texture reads `textureSample`, `textureSampleLevel`, `textureLoad` and their array,
bias, grad, gather and depth-comparison forms, `textureStore`, the queries
`textureDimensions` and `textureNumLayers`, and the derivatives `dpdx`, `dpdy` and `fwidth`
with their coarse and fine forms. The full set is exported as `ORACLE_GPU_STUB_NAMES`. A
module the IR builder assembled can also hold a raw statement, target text the oracle never
reads ([`docs/ir-builder.md`](docs/ir-builder.md)).

Compiling with `{ gpuStubs: true }` turns those intrinsics into placeholder values: opaque
black for a texture read, zero for a derivative, a 1 by 1 size for `textureDimensions` and
one layer for `textureNumLayers`. The throw names the intrinsic and that option. Pass it
when a stand-in value is acceptable for the question being asked, such as checking the
geometry a fragment function computes around a sample it does not depend on. The binding
still has to be set, because the module reads the texture and sampler variables before the
call is stubbed.

```ts
"use typeshade";

declare const tex: texture_2d<f32>;
declare const smp: sampler;

@fragment
export function shade(@location(0) uv: vec2): vec4 {
  return textureSample(tex, smp, uv);
}
```

```ts
const cpu = compileModule(compile(source).module, { gpuStubs: true })

cpu.setBinding('tex', 0) // the value is never read under a stub
cpu.setBinding('smp', 0)
cpu.fns.shade([0.5, 0.5]) // → [0, 0, 0, 1]
```

### Derivatives with grad

`grad(m, fn, param)` differentiates a function of the module with respect to one of its
parameters and returns `{ module, name }`: the module with a new function added, which takes
the same arguments as `fn` and returns `d fn / d param` at them, with the type of `fn`'s
result. The new function is ordinary IR, so the oracle runs it, and the WGSL and GLSL writers
emit it for an entry that calls it.

```ts
"use typeshade";

export function wave(x: f32, k: f32): f32 {
  return sin(k * x) * k;
}
```

```ts
import { compile, compileModule, grad } from 'typeshade'

const m = compile(source).module // source: the file above, as text
const d = grad(m, 'wave', 'k')

compileModule(d.module).fns[d.name](0.5, 2) // → cos(1) * 0.5 * 2 + sin(1) = 1.3817…
```

It works in forward mode: every `f32`, float vector and float matrix gets a derivative beside
its value, and `if`, `switch` and `for` carry both through their bodies. A call to another
function of the module goes through a helper, `g_jvp`, generated once per callee. The
component-wise builtins have their textbook rules; `floor`, `ceil`, `round`, `trunc`, `sign`
and `step` have a zero derivative, which is the derivative everywhere but at their jumps. For a
vector parameter, pass `{ direction: [...] }` and the result is the derivative along it.

A construct with no derivative rule is refused with `SD0118` naming it, a texture sample, a
derivative builtin or a struct the parameter would flow into among them, and only when the
parameter reaches it; the pass never returns a zero derivative it did not derive. The generated
function is checked against a central finite difference on the oracle, which is how to check
one of your own.

`grad(m, fn, wrt, { mode: 'reverse' })` differentiates with respect to every name of `wrt` at
once (change 0056). The new function, `<fn>_vjp` by default, takes the same arguments followed
by a seed `dy` of the result's type, and returns a struct with one field for each name: the
vector-Jacobian product `dy · d fn / d name`. One call gives the whole gradient, so it is the
mode to use when the parameters are many and the result is small, as in a loss. On the CPU the
struct is an object, and `d.adjoints` names its field for each parameter.

```ts
const r = grad(m, 'wave', ['x', 'k'], { mode: 'reverse' })
compileModule(r.module).fns[r.name](0.5, 2, 1) // → { x: …, k: … }
```

Reverse mode runs the function's body forward, then sweeps it backward. It keeps what the
backward sweep reads in the function's own variables, so it allocates no buffer. It
differentiates the same arithmetic, builtins, branches and calls as forward mode, and a jump
still has a zero derivative.

A loop is swept backward under a checkpoint schedule in function memory. Its trip count comes
from the header of a counted `for`, or from a count sweep that runs a `while` or a loop with a
`break` once more. The loop's state is saved every `ceil(N / C)` iterations into `C` slots
(`opts.checkpoints`, 32 by default), and each segment is run again from its slot. Up to `C²`
iterations the body runs about three times forward and once backward. Past `C²` the time grows
as `N² / C`. `d.tapeBytes` reports the function memory the schedule takes per call. A call or a
`discard` whose effect would repeat when an iteration runs again is refused with `SD0118`, and so
is a write to a module variable or a binding.

`opts.custom` gives a function an author-written adjoint: `{ custom: { g: 'g_adjoint' } }` makes
each call to `g` take its adjoints from `g_adjoint(g's arguments, dy)`, which returns a struct
with a field for each float parameter of `g`. Use it for a recurrence you can invert, such as
the transmittance of front-to-back compositing.

`gradCheck(m, fn, { wrt, at, mode })` compares a derivative of either mode with a central
difference on the `f64` oracle at the argument lists `at`, and returns `{ ok, checked, worst }`.
`worst` names the parameter, the point and the components where the two part.

### Calling a module's helpers from host code

A `"use typeshade"` module is also a module your application can import. With the Vite plugin in
place, an ordinary `.ts` file imports a `.shade.ts` and calls the helper functions it exports.
Each call runs that function's code **on the CPU**, not on the GPU, at `f32` precision, the way a
GPU would round it. It is how host code shares a shader's math, for a height query, a picking
test or a unit test. A `@compute` entry imported the same way runs on the GPU instead: `await
entry(bindings, workgroups)` dispatches it on WebGPU and reads what it wrote back into your arrays,
and `entry(bindings, workgroups, { constants: { WIDTH: 32 } })` selects declared overrides
with the same validation as `program.compute`. A plan keeps its existing submission and reports
the selected workgroup shape. CPU calls use generated closures with the same constants;
WebGL2 supports the declared default workgroup shape and array lengths. An imported fragment
entry called as `entry(canvas, bindings)` draws a full-screen fragment entry into a canvas
(`docs/use-typeshade-surface.md` §67):

```ts
// app.ts, ordinary TypeScript: terrain.shade.ts exports `height(p: vec2, k: vec4): f32`
import { height } from './terrain.shade.ts'

const h = height([0.5, 0.5], [1, 0.5, 2, 0.25]) // a number
```

For a complete compute example, read
[`host-compute.shade.ts`](examples/hosts/host-compute/host-compute.shade.ts) and its
[`host.ts`](examples/hosts/host-compute/host.ts). `run()` keeps the authored defaults.
`runSpecialized()` selects `GAIN` in a direct call, then selects `WIDTH` in `device.fuse()`.
It sizes the dispatch with `Math.ceil(n / width)` and checks bounds in the shader, so 259
elements include a partly occupied last workgroup. On WebGPU its entry group reports
`workgroupShapes: [[32, 1, 1]]`, one dispatch and one submission. A later `output.read()` is a
separate readback. WebGL2 keeps the default width of 64 while still selecting ordinary constants.
The CPU tier uses the selected shape and constants, but cannot execute a barrier.

Repeated normalized constants reuse the pipeline on the same device, entry and fp64 flavor.
Choose among a small set of measured sizes rather than creating a new pipeline for every input
length. The runtime checks names, scalar ranges, workgroup dimensions and shared-memory limits;
selection does not choose an optimal size or change the caller's workgroup count. Values are
captured when the entry is called, including while a plan is recorded.

The values are plain: a scalar is a `number` or a `boolean`, a vector a tuple (`[x, y]`), a
matrix a flat column-major array, an `array<T, N>` an array and a struct an object. The call
checks each argument and throws a `TypeError` naming the parameter when one does not fit, and
what it returns is a fresh value. It is synchronous.

What a host can call is an exported function that is not an entry point, not generic, takes no
function, and reaches no binding and no GPU-only builtin. Everything else the module exports
appears to the host as `never`, with the reason, so calling it is a type error where you wrote
the call. The setup is four lines, a plugin in `vite.config.ts`, two in `tsconfig.json` and
`tshc sync` in `prepare`. The surface reference has them, with the full table of host
values: `docs/use-typeshade-surface.md` §64.

### A loop over an array

An exported function that takes an array with no size, `array<T>`, is a kernel function: host
code awaits it, and its array is the caller's, written in place. Each `for` at the top of its body
runs on the GPU, one invocation per iteration, when the compiler proves that no iteration touches
what another one does, and on the CPU otherwise, with a `TS8070` warning that names the line and
the remedy (`docs/use-typeshade-surface.md` §65).

The dispatch is that top-level loop's, so a loop nested in it runs whole inside each invocation:
a grid written as two nested loops is one invocation per row. When each cell should be its own
invocation, write the grid as one flat loop, `for (let i: u32 = 0; i < w * h; i++)`, and take
`x = i % w` and `y = i / w` from the index.

A kernel function may set the workgroup size of its loops with `@workgroup_size([128])`, one whole number in the array, as `@compute([128])` sets an entry's (`docs/use-typeshade-surface.md` §3 and §65). A loop that reduces always runs in workgroups of 256, so a reduction in such a function is refused with `TS8077`: move the reduction into a function of its own.

A kernel function may also take a texture (`docs/use-typeshade-surface.md` §65): a
`texture_2d<f32>` it reads with `textureLoad`, and a 2D storage texture, `texture_storage_2d<F, A>`,
which makes the function a kernel function and which its loop stores into at
`vec2u(i % w, i / w)`. Make the storage texture with `device.texture({ size, format, storage: true })`
and call the function normally: it selects that texture's owner (change 0085). Use `device.fuse()`
for an ordered scope. A texture call runs on WebGPU, and on the CPU
tier where there is none: a device of the CPU tier holds its textures in memory, and an
`ImageData` is copied there. WebGL2 does not run it yet.

### A chain of calls in one dispatch

A host that calls several kernel functions over the same data pays a dispatch, and a submission,
for each call. `fuse` from `typeshade/fuse` records the calls its body makes and runs them
together: in one submission, and, when each call reads what the one before it wrote at the same
index, as one dispatch. `device.fuse()` needs no registration import; the named `fuse` remains available.
The Vite plugin and `hostFace()` write eligible kernels' fusion facts by default.
`fuse: false` omits them to reduce generated size; `fuse: true` keeps the default.
An ordinary call can still use private input projection with those facts present. Resident and fused calls retain the full layout.
These three kernel functions are one dispatch:

```ts
"use typeshade";

export function add(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}

export function mul(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}

export function relu(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
```

```ts
import { resident } from 'typeshade/runtime'
import { fuse } from 'typeshade/fuse'
import { add, mul, relu } from './ops.shade.ts'

const out = resident(n, 'f32') // zeros, with no upload; a, b and c are resident arrays too
const report = await fuse((scope) => {
  const t = scope.scratch(n)
  const u = scope.scratch(n)
  add(t, a, b)
  mul(u, t, c)
  relu(out, u)
})
report.dispatches // 1
const y = await out.read()
```

A device owner's `device.fuse()` uses the same recorder without a registration import (change 0085).
It runs the body synchronously and loads its local executor after reserving the queue position.
Deploy all emitted chunks. The named `fuse` import remains supported for default-owner arrays.

Three habits make a chain fuse. Write each function with one loop, and index every array with the
loop's counter alone, `out[i] = a[i] + b[i]`: a call joins the one before it when it reads what
that call wrote at the same index. Keep an intermediate in a scratch array, `scope.scratch(n)`,
and not in a `resident` the host reads: a fused group holds a scratch array in a variable of its
own, so no buffer is made for `t` and `u` above, and `read()` of one is an error. End a chain with
a reduction when you want its sum: `total(u)` as the last call of the scope takes the calls before
it into its own loop, and nothing joins a group after a reduction.

An entry call (`@compute`) in the body is recorded too. It runs as a dispatch of its own, in the
order the body made it: no kernel call joins it, and it joins none. Its storage arrays with no
size are `resident(...)` values, and a host array in its place is a `TypeError`.

A call stands apart from the one before it, and runs as a dispatch of its own, when it reads a
neighbour (`t[i - 1]`, `t[i ^ 1]`), writes at another index (`out[2 * i]`), writes what the call
before it reads, runs over another count, or has a second loop, a `continue` or a scatter. It
stands apart too when the group would bind more storage buffers than the device allows, when the
module has no fusion facts (`fuse: false`, or older generated code), and on WebGL2 and the CPU tier, which never fuse. The
arrays and the results are the same either way: fusing changes the dispatches and nothing else.

The report says which calls fused and why the others did not, in your names. `report.groups`
lists the groups in order, each with its `calls`, whether it is `fused`, and, for a group that
stands apart from the one before it, a `why`:

```text
mul and blur run as two dispatches because blur reads `t[i - 1]` (line 9)
```

`report.dispatches` and `report.submissions` count what the plan gave the device. The surface
reference has every fact the plan checks, each wording of the report and of the errors, the
scratch arrays and the tiers: `docs/use-typeshade-surface.md` §71.

### A shader module that imports another

A `"use typeshade"` file imports what another one exports, as any TypeScript module does:
`import { fbm } from './noise.shade.ts'`. The file you compile and the shader files it imports,
directly or through another, are one program, and the program becomes one module. What your file
reaches in an imported file comes with it, its helpers, structs, constants and bindings, and the
imported file's own entry points do not. Each file keeps its own scope, so two files can each have
a private `hash`; the module emits the second one under a name of its own.

`compile()` reads what a source imports through a `readDocument` you pass it, which returns a
file's text by its path, or `undefined` when there is none. The Vite plugin, `tshc check`,
`tshc sync` and the editor read the files themselves.

```ts
import { existsSync, readFileSync } from 'node:fs'
import { compile } from 'typeshade'

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)
const { wgsl, diagnostics } = compile(read('src/clouds.shade.ts')!, {
  fileName: 'src/clouds.shade.ts',
  readDocument: read,
})
```

A shader library installs from npm like any other package, and a shader file imports it by the
package's name: `import { fbm } from 'shade-noise'`. The package is found in `node_modules` from
the importing file's directory up, as Node finds one, and the file read is the one its
`package.json` publishes under the `typeshade` condition of `exports`, beside the JavaScript it
publishes for host code:

```json
{
  "name": "shade-noise",
  "exports": {
    ".": { "typeshade": "./src/index.shade.ts", "default": "./dist/index.js" },
    "./*": { "typeshade": "./src/*.shade.ts" }
  }
}
```

`'shade-noise'` reads the package's `src/index.shade.ts`, and `'shade-noise/hash'` the
`hash.shade.ts` beside it. A package with no `exports` is imported by the path of its file,
`'shade-noise/noise.shade.ts'`. `readDocument` is asked for each `package.json` too, so the `read`
above follows a package with no change. A program holds one copy of a package version however
many dependencies reach it, and a helper of a package that the module renames is named for the
package and its file, `shade_noise_noise_hash`.

A mistake in an imported file is reported at that file, line and column. An import the compiler
cannot follow is a `TS8072` on the import: a path that names no file, a file that does not begin
with the directive, a package no `node_modules` holds, a subpath its `exports` does not name, a
name the file does not export, a default import. The surface reference has every form an import
takes, the names the module emits and each refusal: `docs/use-typeshade-surface.md` §68.

### A function that changes its caller's variable

A parameter is a copy of the value the call passes, so a write to it leaves the caller alone. To
change the caller's variable, declare the parameter `@inout`, GLSL's qualifier, and pass the
variable itself. Inside the function the parameter is the caller's variable: read it, assign to
it, and reach its fields as you would reach `this` in a method. A parameter the function only
writes is `@out`: it starts with no value, so write it before reading it, and on every path.

```ts
"use typeshade";

class Ray {
  origin: vec3;
  dir: vec3;
}

function swap(@inout a: f32, @inout b: f32): void {
  const t = a;
  a = b;
  b = t;
}

function add(a: f32, b: f32, @out c: f32): void {
  c = a + b;
}

function advance(@inout r: Ray, t: f32): void {
  r.origin = r.origin + r.dir * t;
}

export function demo(): f32 {
  let x: f32 = 1.;
  let y: f32 = 2.;
  swap(x, y); // x is 2. and y is 1.
  let s: f32;
  add(x, y, s); // s is 3.
  let r = new Ray();
  r.dir = vec3(1., 0., 0.);
  advance(r, 3.); // r.origin.x is 3.
  return x + s + r.origin.x;
}
```

WGSL receives a pointer, `swap(&x, &y)` with `*a = *b` in the body, and GLSL ES 3.00 an `inout`
parameter; the CPU oracle copies the value in and stores it back. The argument is a `let`, a
module variable, an element of a `read_write` storage binding, or a field or an element of one;
a value, a literal and a vector's component are refused with `TS8073`. One call may not take two
references to one variable that the function writes, `swap(x, x)`, which is `TS8074`. A read
before a variable is assigned, or an `@out` parameter read before it is written, is `TS8075`. A
function of the file or of a namespace takes a qualifier; a method, an entry and a local
function take values, and a local function inside such a function may still read and write the
parameter, as it reads and writes any variable around it. There is no `@in`: a parameter with no
qualifier is GLSL's `in`. The surface reference has every rule and refusal:
`docs/use-typeshade-surface.md` §70.

## Diagnostics

After this page you can read a diagnostic, branch your own code on the code it carries,
get every failure in a module in one report, and find the line an error came from.

A diagnostic is one problem found in one program: a stable code, a severity of error or
warning, a message, and the place in the source it belongs to. Two kinds reach a host.
`compile()` reports what is wrong with a source as a list of diagnostics, with `TS8` codes,
and never throws. A call that reads a module, an emit, `reflect` or the oracle, throws a
`TypeShadeError` with an `SD` code when the module cannot be done what was asked.

### Coded errors

`compile()` returns `diagnostics`, and each one carries its `code`, its `category`, its
`message`, the `fileName` and the 1-based `line` and `character` where it starts, with
`endLine` and `endCharacter` where it ends. A source with an error has no `wgsl` and no
`glsl`, because a partial module is never written out as shader text.

```ts
import { compile } from 'typeshade'

const { diagnostics } = compile(source, { fileName: 'rim.shade.ts' })
for (const d of diagnostics) {
  console.error(`${d.fileName}:${d.line}:${d.character} ${d.code} ${d.message}`)
}
```

For a `rim.shade.ts` that declares `edge` with `const` and assigns to it on line 5, the loop
prints:

```
rim.shade.ts:5:3 TS8005 Cannot assign to "edge" — it is declared with const.
```

Every coded failure a host call raises is a `TypeShadeError`. It carries a `code` from a
frozen catalogue, a composed `message`, and a `hint` where the catalogue has a one-line
remedy for that code. `ValidationError` and `UnsupportedFeatureError` are subclasses, so one
`instanceof TypeShadeError` handler catches every coded failure.

```ts
import { TypeShadeError, emitGlslModule } from 'typeshade'

try {
  emitGlslModule(m, 'fragment')
} catch (e) {
  if (e instanceof TypeShadeError) console.error(e.code, e.message, e.hint)
  throw e
}
```

For a module whose varying is `@interpolate("linear")`, which GLSL ES 3.00 has no form for,
the call throws an `UnsupportedFeatureError` with the code `SD0030` and this message:

```
glsl-es300: @interpolate("linear") has no GLSL ES 3.00 form — that spec has smooth, flat and centroid, and linear (desktop `noperspective`) is none of them. Use "perspective", or keep the shader WGSL-only.
```

`compile()` reports the same failure as a `TS8015` warning and keeps the WGSL.

### Branching on a code

The code is the half of a diagnostic to write your own code against. A `TS8` code is never
renumbered (Rule 12.2), and the `SD` codes come from an append-only catalogue, so a branch on
one keeps working. Branch on the code, and show the message to the author.

```ts
const errors = compile(source).diagnostics.filter((d) => d.category === 'error')
if (errors.some((d) => d.code === 'TS8005')) {
  // a write to a const: report it against the author's own source
}
```

### Every failure at once

`compile()` collects every diagnostic of a source in one call, so a source with three
mistakes reports three. One mistake reads as one diagnostic (Rule 12.4): a refused
declaration does not also draw an error at every line that uses its name. The
`category` separates an `error`, which leaves no shader text, from a `warning`, which says
how the program could be written better or which target it cannot reach.

A module you change after `compile()`, or one an engine assembles, is checked by
`validate(m)`. It runs the emit-time rules over the module: no duplicate function or struct
name, no binding collision, every path of a value-returning function returns, call sites
that match the declarations they call. `emitModule` and the GLSL emitters run it first, so a
module that breaks one of them fails at the emit call with a coded error instead of at
`createShaderModule` with a driver message. `validate` collects every error before it
throws, and the `ValidationError` carries them on `.diagnostics`.

```ts
import { emitModule, ValidationError } from 'typeshade'

try {
  emitModule(m)
} catch (e) {
  if (e instanceof ValidationError) {
    for (const d of e.diagnostics) console.error(d.ruleId, d.fn, d.message)
  } else throw e
}
```

A module that carries the function `same` twice reports:

```
typeshade [SD0020]: module validation failed (1 error):
  - dup-func: duplicate function 'same'
```

### The diagnose report

`diagnose(m)`, on the `typeshade/dev` subpath, is the "what is wrong with this module?"
entry. It runs the lint ruleset, adds a capability check when you pass a backend, and
returns a report of every diagnostic plus a summary counting them. It never throws and it
never changes the module, so it is safe to call on a module you are about to emit.
`formatReport` renders the report as text. `lintModule(m)` runs the same ruleset and hands
back the diagnostics as a plain array, with no summary and no capability check.

```ts
import { compile, wgslBackend } from 'typeshade'
import { diagnose, formatReport } from 'typeshade/dev'

const report = diagnose(compile(source).module, { rules: 'all', backend: wgslBackend })
if (report.summary.errors + report.summary.warnings > 0) console.error(formatReport(report))
```

For a source whose `same(a: f32, b: f32)` returns `a == b ? 1. : 0.`, the report reads:

```
warning no-float-eq  (fn same)
  f32 '==' in fn 'same' — exact float equality is unreliable

0 errors, 1 warning
```

`rules: 'all'` is wider than the emit-time set: naming, nesting depth, dead bindings, float
equality and single exit. Some of those rules were written for modules the IR builder
assembles. `single-exit` asks a function for one `return`, so it reports each early return a
`"use typeshade"` function writes; read it as a style note, not a fault. `rules: 'core'`
narrows the run to the set `validate` uses. The `backend` option adds one `SD0030`
diagnostic naming every capability the backend cannot cover, which is the non-throwing twin
of the gate `emitModule` runs:

```
error[SD0030] unsupported-capability
  backend 'glsl-es300' cannot emit this module — missing capabilities: compute, subgroups
```

### Source locations

Every `compile()` diagnostic carries its place, as the samples above show, and a diagnostic
in a file the source imports names that file. Nothing has to be turned on for it.

The module keeps the places too. Each statement the compiler builds carries the span of the
source it came from, and `sourceSpanOf(stmt)` reads it: the file, the offsets and the line
and character where it starts and ends. The debugger of `typeshade/debug` resolves its
breakpoints and reports its steps by these spans. Locations never reach the emitted shader.
A module the IR builder assembles records a location only with source tracing turned on,
which [`docs/ir-builder.md`](docs/ir-builder.md) describes.

## Conditional programs

After this page you can decide which of several programs to build from one codebase, tell
when a variant is one constant instead of a different program, hand the choice to a host
that owns the defines, and name the result so a cache cannot serve one variant for
another.

A shader that has to differ by feature, elevation present or absent, 3D or flat, is where a
GLSL codebase reaches for `#define` and a ladder of `#ifdef`. This package has no
preprocessor. A program is a file and what it imports, so the thing that varies is which
file you compile, and the code the variants share is a file they both import. The emitted
program carries the winning variant's code with no dispatch chain around it.

Three questions hide under "the program changes", and each one has its own answer: the shape
of the program differs, a single value differs, or the choice belongs to the host. A
capability the device may or may not have is a fourth question, and
[Capabilities & extensions](/guide/authoring/capabilities-extensions/) answers it.

### One file per variant

To specialize is to build one program for one set of choices. Write each variant as an entry
file, and put what they share in a file each one imports:

```ts
// terrain.shade.ts
"use typeshade";

export function shadeHeight(h: f32): vec4 {
  return vec4(h, h * 0.5, 0., 1.);
}

// terrain-flat.shade.ts
"use typeshade";

import { shadeHeight } from "./terrain.shade.ts";

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return shadeHeight(0.);
}

// terrain-dem.shade.ts
"use typeshade";

import { shadeHeight } from "./terrain.shade.ts";

declare const dem: texture_2d<f32>;
declare const demSampler: sampler;

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return shadeHeight(textureSample(dem, demSampler, uv).x);
}
```

The host picks the file:

```ts
import { compile } from 'typeshade'

// read: the readDocument of "A shader module that imports another"
const buildTerrain = (hasElevation: boolean) => {
  const fileName = hasElevation ? 'terrain-dem.shade.ts' : 'terrain-flat.shade.ts'
  return compile(read(fileName)!, { fileName, readDocument: read })
}
```

The bindings move with the shape here, and that is the reason to prefer this over a
preprocessor. In the flat variant the elevation texture is never declared, so it is absent
from `reflect()`, absent from the bind group layout, and the host creates no resource for
it. A `const` flag and a plain `if` would not do that: the branch is emitted as written and
the declared texture stays in the module, which is how a disabled feature still costs a
binding slot.

Some choices cannot be made until draw time. Those stay as a runtime branch on a uniform,
which the GPU evaluates. Specializing is for a choice you already know when you build.

### A value that differs with override

If every variant would emit the same program with one constant changed, specializing
multiplies pipelines for nothing. Declare a specialization constant instead, with
`override<T>`. A specialization constant is a module-scope value whose read stays symbolic
through every pass and is pinned by the host when it creates the pipeline.

```ts
"use typeshade";

const quality: override<f32> = 1.;

export function shade(base: f32): f32 {
  let acc = base;
  if (quality > 1.) {
    acc = acc * 2. + 0.5;
  }
  return acc;
}

@fragment
export function fs(@location(0) v: f32): vec4 {
  return vec4(shade(v), 0., 0., 1.);
}
```

WGSL emits `override quality: f32 = 1.0;` and the host pins it through the pipeline's
`constants`. GLSL ES 3.00 has no driver-side equivalent, so the backend emits a `#define`
with the default. The program runtime pins it from `render({ constants })` or
`compute(entry, { constants })`; an imported compute entry accepts the same record in its
third argument. A host that emits GLSL itself supplies
`emitGlslModule(m, 'fragment', { overrideValues: { quality: 2 } })`. These paths read
the declared constants from `reflect().overrides`. WebGL2 compute keeps the default workgroup
shape and array lengths even when ordinary override values change.

Because the read stays opaque to the optimizer, the branch above survives every pass and
the driver removes it per pipeline variant, which is the classic ubershader mechanism. The
rule of thumb: if two variants would compile to the same instruction sequence with one
literal changed, that is an override; if they compile to different code, that is a
separate file.

### Axes the host decides

An axis is one thing the program varies on, together with the list of values it can take.
One point in the axis space is a variant. When the host picks the point at runtime, from
state you do not own, the matrix itself becomes the authored thing: `variantFamily` takes
the axes, a function that builds the module for one point, and a key derivation, and builds
every point.

```ts
import { compile, variantFamily } from 'typeshade'

const family = variantFamily({
  axes: { elevation: ['flat', 'dem'] },
  build: ({ elevation }) => {
    const fileName = `terrain-${elevation}.shade.ts`
    return compile(read(fileName)!, { fileName, readDocument: read }).module
  },
  key: ({ elevation }) => `terrain:${elevation}`,
})

family.keys // ['terrain:flat', 'terrain:dem']
family.emit('wgsl') // Map { 'terrain:flat' => '…', 'terrain:dem' => '…' }
family.get('terrain:dem')?.reflection // that variant's own reflection
```

Every variant carries its module, its own reflection and its key, and `emit` returns one
preprocessor-free source per key for either target. For a GLSL host that already owns the
define, `emitGuarded` lowers the same matrix into a single source with a generated `#if`
ladder, one arm per key, each arm the same code `emit` produces with the preamble every arm
shares hoisted above the ladder. `variantFamily`'s reference page covers that shape and
what it asks of the variants.

### The identity of a specialized program

A specialized program is a different program, so every axis you specialize on has to appear
in every key that names it. That means the id of a cached pipeline, and the id of a baked
artifact that serves bytes without compiling again. The key takes the same facts the
choice of file takes.

```ts
const keyFor = (hasElevation: boolean, method: number) =>
  `${hasElevation ? 'dem' : 'flat'}:${method}`
```

The failure a short key causes carries no error. A key that names less than the build
reads hands one variant's compiled shader to another variant's draw: it compiles, it links,
it renders, and the pixels are wrong. If you add an axis to a build, add it to the key in
the same commit. `variantFamily` asks for the key as a function of the axes, and throws
when two points produce the same key, which turns the same mistake into a build-time
error.

## Capabilities & extensions

After this page you can declare the GPU features a module needs, read what each one costs on
each target, check a booted device against them, and tell which module shapes fail closed
instead of emitting.

A capability is a neutral id for a GPU feature a module's emit depends on, such as rendering
into a float texture or blending into one.

### Declaring a capability

Most capabilities declare themselves. Writing `@builtin("clip_distances")`,
`@builtin("primitive_index")`, a subgroup built-in value or `@blend_src(n)` derives the
capability the use needs, and so does a storage binding, a compute entry or a texture of a
kind one target lacks. An extension no use derives is turned on by a string directive beside
`"use typeshade"`, one per line, with WGSL's own name:

```ts
"use typeshade";
"enable subgroups";

@compute([64])
export function k(@builtin("global_invocation_id") gid: vec3u) {
}
```

The vocabulary is fixed and target-neutral, so a raw `EXT_*` or `OVR_*` string never appears
in a source. Each id folds into the capability gate that runs before any writer touches the
module, so a backend that cannot spell the feature throws `UnsupportedFeatureError`
(`SD0030`) naming the capability, and no source the driver would reject is ever produced.

Four capabilities have no spelling in a source: `floatRenderTarget`, `float32Blend`,
`float32Filterable` and `multiview`. Three are activated by the host and cost the shader no
token, and the fourth is a GLSL `#extension`. A host that needs one lists it in the
compiled module's `enables`:

```ts
import { compile, type ModuleDecl } from 'typeshade'

const m: ModuleDecl = { ...compile(source).module, enables: ['floatRenderTarget'] }
```

### What each id needs per target

Two different costs hide behind one id. A _host feature_ is something the host must activate
before it creates a pipeline: `gl.getExtension('EXT_color_buffer_float')` on WebGL2, a
`requiredFeatures` entry on WebGPU. A _source directive_ is a token the emitted shader
itself must carry, `#extension … : require` on GLSL ES 3.00 and `enable …;` on WGSL, which
the backend writes for you, deduped and sorted, right after the `#version` line on GLSL and
ahead of the declarations on WGSL.

A capability can need either half, both halves, or neither.

| `enables` id         | WebGL2 and GLSL ES 3.00                                         | WebGPU and WGSL                                                          |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `floatRenderTarget`  | host feature `EXT_color_buffer_float`                           | core, nothing to request                                                 |
| `float32Blend`       | host feature `EXT_float_blend`                                  | host feature `float32-blendable`                                         |
| `float32Filterable`  | host feature `OES_texture_float_linear`                         | host feature `float32-filterable`                                        |
| `multiview`          | directive `GL_OVR_multiview2` and host feature `OVR_multiview2` | unsupported, fails closed                                                |
| `f16`                | unsupported, fails closed                                       | directive `f16` and host feature `shader-f16`                            |
| `subgroups`          | unsupported, fails closed                                       | directive `subgroups` and host feature `subgroups`                       |
| `clipDistances`      | unsupported, fails closed                                       | directive `clip_distances` and host feature `clip-distances`             |
| `primitiveIndex`     | unsupported, fails closed                                       | directive `primitive_index` and host feature `primitive-index`           |
| `dualSourceBlending` | unsupported, fails closed                                       | directive `dual_source_blending` and host feature `dual-source-blending` |
| `bgra8unormStorage`  | unsupported, fails closed                                       | host feature `bgra8unorm-storage`, derived                               |
| `packed4x8Dot`       | unsupported, fails closed                                       | core, derived; a language feature to check                               |

The bottom five rows are the ones nothing declares by hand. Writing
`@builtin("clip_distances")`, `@builtin("primitive_index")` or `@blend_src(n)` derives the
capability, because WGSL refuses each of those without the matching `enable`; a
`"bgra8unorm"` storage texture and a call into the packed 4x8 family derive theirs from the
binding and from the call. `f16`, which no use can derive, and `subgroups`, for a file that
reads neither subgroup built-in value, are spelled as the string directive above.

A capability with a host half and no source half costs zero emitted bytes: declaring it
moves no byte of the shader. The `32` in `float32Blend` and `float32Filterable` is
load-bearing, because both underlying features are 32-bit float only, while
`EXT_color_buffer_float` covers 16-bit and 32-bit targets, which is why `floatRenderTarget`
carries no bit width.

`capabilityMatrix` reports the same information as data, derived from the backends
themselves, so a tool or a page can print it without transcribing it:

```ts
import { capabilityMatrix, glslEs300Backend, wgslBackend } from 'typeshade'

capabilityMatrix([wgslBackend, glslEs300Backend])
// → [{ capability: 'storageBuffer', support: { wgsl: 'native', 'glsl-es300': 'unsupported' },
//      declarable: false },
//     …,
//     { capability: 'f16', support: { wgsl: 'directive', 'glsl-es300': 'unsupported' },
//      declarable: true }]
```

The result has one row per capability, eighteen in a fixed order, including the nine a
module's shape derives and never declares (`storageBuffer` through `textureGather`, then
`bgra8unormStorage` and `packed4x8Dot`), which come back with `declarable: false`.

Two notes before you trust a row.

- Support is not the same as reachability. `f16` and `multiview` are supported on the target
  the table says and neither is authorable today, because there is no `f16` scalar type and
  no way to spell `layout(num_views = N) in;` or read `gl_ViewID_OVR`. A module declaring
  `multiview` emits the directive and renders single-view. The other four are reachable:
  `clipDistances`, `primitiveIndex` and `dualSourceBlending` are what their attributes need,
  and `subgroups` is reached by `@builtin("subgroup_invocation_id")` or
  `@builtin("subgroup_size")` on a
  compute or fragment entry — the subgroup INTRINSICS (`subgroupAdd` and friends) are still
  absent, which is a separate gap from the capability. Whether a given adapter HAS one of the
  four is what `reflect().requiredFeatures` is for, and a device only HAS an optional feature
  if `requestDevice` was asked for it — the compile gate does exactly that, deriving the list
  from the corpus, which is how `examples/clip-planes.shade.ts` compiles on its Tint. Its
  software adapter offers `clip-distances` and `subgroups` but not `primitive-index`, so that
  one row's host string is unconfirmed here.
- An unsupported cell is a hard stop by design: the emit throws. To ask before you emit,
  `diagnose(m, { backend })` reports the same missing capability as an `SD0030` diagnostic
  and never throws.

### Derived and implied capabilities

Some capabilities are derived, which means they are read off the module's shape and never
declared. A storage binding implies `storageBuffer`, a compute entry implies `compute`, a
multisampled texture load implies `msaaTextureLoad`, a storage-texture binding implies
`storageTexture`, a 1D texture implies `texture1d`, a cube-array texture implies
`textureCubeArray`, a `textureGather` call implies `textureGather`, and a call to one of the
eight packed 4x8 integer builtins implies `packed4x8Dot`. `bgra8unormStorage` is
derived from a binding's FORMAT rather than its kind: `bgra8unorm` is the one storage format
that is not core, and a device refuses the bind group layout unless it requested
`bgra8unorm-storage` (measured — and Tint compiles the module either way, so nothing but this
capability carries the requirement to the host). A module's `enables` is typed to exclude
every derived id, so naming one is a type error.

A capability is not the only thing a host may have to check. A WGSL _language_ feature is a
property of the browser's shading-language implementation rather than of the device, so it is
not requested at `requestDevice` at all. `reflect().requiredLanguageFeatures` lists the ones a
module's source uses, for `navigator.gpu.wgslLanguageFeatures` to answer. The WGSL writer emits
`requires readonly_and_readwrite_storage_textures;` for a storage texture bound `read` or
`read_write`, and no directive for the packed 4x8 family, which compiles without one.

One capability can also imply another. `float32Blend` pulls in `floatRenderTarget`, because
blending into a float target needs that target to be renderable as a colour attachment
first, and with only `EXT_float_blend` active the framebuffer comes back incomplete.
`reflect().requiredFeatures` reports the closure, so a module that declares one gets both:

```ts
const m: ModuleDecl = { ...compile(source).module, enables: ['float32Blend'] }
reflect(m).requiredFeatures // ['float32Blend', 'floatRenderTarget']
```

The list is always present, and empty for a module that needs nothing.

### Verifying at boot

Declaring a capability activates nothing. Device features are fixed when the device is
created, well before a module is emitted: WebGPU's `requiredFeatures` are settled at
`requestDevice` and a feature missing there can never be added later, and a WebGL2 context
has whatever extensions were fetched on it. Asking at pipeline-creation time is too late.

So the author's job is to verify that the booted device covers what the module needs, and to
fail loudly when it does not. `reflect().requiredFeatures` gives neutral ids, because
reflection takes a module and knows no target, so translate them through `hostFeaturesFor`,
which returns the concrete strings one backend's host needs. It skips every capability with
no host half, so there are no holes to hand a driver:

```ts
import { hostFeaturesFor, reflect, glslEs300Backend, wgslBackend } from 'typeshade'

// WebGL2: verify the already-booted context has each extension.
for (const ext of hostFeaturesFor(glslEs300Backend, reflect(m).requiredFeatures)) {
  if (!gl.getExtension(ext)) throw new Error(`WebGL2 lacks ${ext}`)
}

// WebGPU: feed the same lookup into requestDevice, at boot.
const device = await adapter.requestDevice({
  requiredFeatures: hostFeaturesFor(wgslBackend, reflect(m).requiredFeatures) as GPUFeatureName[],
})
```

`typeshade/runtime` does the WebGPU half for you: a runtime that requests its own device asks
for the features its programs need.
For kernel-call owners, pass instance requirements to `createDevice({ limits, features })`.
A supplied device must already enable them. Constructor options keep independent libraries
from depending on which default-owner call runs first.

### Choosing between two modules

A capability states a hard requirement, so it is the wrong tool for a feature you can live
without. A fallback is two modules and one decision, made at boot where the device is
already known:

```ts
const caps = reflect(fancy).requiredFeatures
const ok = hostFeaturesFor(glslEs300Backend, caps).every((e) => gl.getExtension(e))
const m = ok ? fancy : plain // two modules, one decision, made once
```

Each module still declares what it needs, so the one you did not pick would have failed
closed if you had picked it on a device that cannot run it.

### Portable compute kernels

A `"use typeshade"` compute entry runs on both backends. On WebGPU it is a `@compute` entry
point. On WebGL2, which has no compute stage, it runs as a pass program: a full-screen draw
per pass into a texture, which the compiler writes and the manifest carries
(change 0054). The program runtime chooses the tier, so the host code is the same on both.

```ts
"use typeshade";

declare const field: storage<array<f32>>;
declare const outColor: storage<array<u32>, "read_write">;

@compute([64])
export function evalField(@builtin("global_invocation_id") gid: vec3u): void {
  const i = gid.x;
  if (i >= arrayLength(field)) {
    return;
  }
  outColor[i] = pack4x8unorm(vec4(field[i], 0., 0., 1.));
}
```

```ts
import { compile, packModule } from 'typeshade'

const program = packModule(compile(source).module)
program.gl?.computes // { evalField: … }, the pass program WebGL2 runs
```

`program.gl.computes` holds each compute entry's pass program, or the reason it has none.
`typeshade/runtime` runs it with `rt.load(program).compute('evalField')` on whichever tier the
device is (`docs/use-typeshade-surface.md` §69). Barriers, workgroup memory and atomics run in
the WebGL2 tier's passes too, in an order WGSL allows (`changes/0054-webgl2-compute.md`). An
entry with no pass program, one that reads a 1D, cube-array or multisampled texture for
instance, is refused by the runtime with its reason. The IR builder also has a narrower
`portable` tier, a gather-only kernel the GLSL writer lowers to one fragment shader, which
[`docs/ir-builder.md`](docs/ir-builder.md) describes.

## fp64

After this page you can declare a double-precision value in a shader, know which operations
it supports, and bind the guard texture the emulation needs.

A GPU has no 64-bit float type. In this package `f64` is emulated: one value is a pair of
`f32` numbers, a high part and a low part, and the number is their unevaluated sum. That
gives about 48 bits of significand, the fraction bits that decide how many digits a value
keeps, over the ordinary f32 exponent range. A value near 1e8, a position in world units
for one, where one f32 step is already 8 units, still resolves detail far below one unit.
You write `f64` as a type like any other, and a pass rewrites every f64 into a `vec2<f32>`
and injects the emulation functions the shader then calls, before any backend sees it. WGSL,
GLSL and the CPU oracle agree on the results.

The 48 bits assume the GPU rounds f32 `+`, `-` and `*` to nearest, ties to even. Every shipping
GPU does, but neither specification promises it: GLSL ES 3.00 leaves the rounding mode undefined
and lets a subnormal flush to zero, and WGSL fixes no rounding mode. The figure rests on that
hardware practice; §39 of `docs/use-typeshade-surface.md` has the detail.

### Declaring an f64 value

Write `f64` where you would write `f32`: in a uniform field, in a parameter, in a local. The
operators, the comparisons and the builtins keep their spelling, so a body converted from f32
usually changes only in its signature.

```ts
"use typeshade";

class Uniforms {
  origin: f64; // one vec2<f32> slot: the host writes splitF64(value)
}

declare const u: uniform<Uniforms>;

export function k(x: f64, s: f32): f32 {
  return f32(sqrt((x + u.origin) * s));
}
```

Nothing on the module announces fp64. The lowering pass finds the f64 types itself.

### Conversions

An f32 widens to f64 implicitly beside an f64, and the widen is exact, so `x + dx` for an f64
`x` and an f32 `dx` needs no conversion. `f64(x)` is the explicit spelling of that widen, for
a value that has to be f64 before it meets any arithmetic. A literal in a position the
surrounding type declares `f64`, a declaration, a parameter, a field or the other side of an
operator, keeps the whole double, and so does `f64(0.1)`. Narrowing is always explicit:
`f32(x)` adds the two halves back together and gives an f32, losing the extra precision.
`%` and the integer casts `i32(x)` and `u32(x)` on an f64 are refused; narrow to `f32` first.

```ts
"use typeshade";

export function g(a: f32, b: f64): f32 {
  const widened = f64(a); // exact
  const lit: f64 = 1e-9; // a literal in a declared f64 position keeps the double
  return f32(widened + lit + b); // the explicit narrow
}
```

There is no author-facing way to split a double into its two words and rebuild it. A double
two stages need is read in each of them from a uniform or a storage binding, or narrowed to
an `f32` at the boundary.

### The operations f64 supports

The four arithmetic operations, every comparison, `abs`, `cos`, `floor`, `fract`, `max`,
`min`, `mix`, `round`, `sin` and `sqrt` accept f64 operands. Anything else on an f64 operand
is refused at the call, naming that list and the narrow to write, so narrow the value with
`f32(x)` first and finish that part of the computation in f32. `sin` and `cos` are less
accurate than the arithmetic around them. Relative error for the transcendental itself
floors at about 2^-36, and it grows with the size of the argument through the range
reduction.

```ts
"use typeshade";

// A triangle wave on a coordinate that has outgrown f32.
export function stripe(x: f64): f32 {
  const y = x * 0.5;
  const f = y - floor(y);
  return f32(min(f, 1. - f));
}
```

### The guard texture

A shader compiler may reassociate float arithmetic, and reassociation deletes exactly the
small correction terms this emulation is built on. Every emitted helper therefore threads a
value the compiler cannot see through those terms: a 1 read from a texture. Any module whose
f64 arithmetic calls one of those helpers gets a `texture_2d<f32>` binding named `_fp64`
injected for it, at group 0 and the first free binding, and it appears in `reflect()` as an
ordinary 2D texture. A module that only compares, widens, narrows, negates or scales f64
values by a power of two calls none of them and gets no binding, so a host reads `reflect()`
rather than binding `_fp64` to every pipeline. The host binds a 1 by 1 texture whose texel
reads exactly 1.0, white RGBA8 or R32F holding 1.0.
The value lives in a texture because some drivers specialize a pipeline on the uniform
values they observe and re-optimize it, which folds the correction terms away again; no
compiler treats a texel as a constant.

Each function that does f64 arithmetic reads the texel once, at the top of its body, and
passes it to the helpers as a parameter, so a loop reads it before it starts rather than on
every iteration. On GLSL the texture is declared `uniform highp sampler2D _fp64;`: GLSL ES
3.00 gives `sampler2D` a default precision of lowp in both stages, and a texel fetch returns
its sampler's precision.

Two things to do at the host. If the bind group layout is fixed, pin the slot: add
`fp64Guard({ group, binding }).binding` to the module's bindings. And on Apple GPUs the guard
is not enough, because the platform's default fast math collapses the float lowering anyway.
Pass whatever device signals you have to `recommendFp64Flavor` and hand the result to the
emit as `fp64Flavor`; on those devices it selects an integer lowering, which needs no guard
binding at all.

```ts
// m: the module of the first example on this page.
import { emitModule, fp64Guard, recommendFp64Flavor, type ModuleDecl } from 'typeshade'

const pinned: ModuleDecl = {
  ...m,
  bindings: [...m.bindings, fp64Guard({ group: 0, binding: 3 }).binding],
}

const flavor = recommendFp64Flavor({ userAgent: navigator.userAgent })
const wgsl = emitModule(pinned, { fp64Flavor: flavor })
```

The emulation owns two name spaces in the emitted shader. A function name starting with
`df64_`, or a struct name starting with `DF64Vec` or `DF64Mat`, fails emit with `SD0043`.

### Packing and layout

An f64 uniform field occupies one plain `vec2<f32>` slot, size 8 and align 8. Pack it on the
host with `splitF64(x)`, which returns the `[hi, lo]` pair in the order the shader reads it.
A value interpolated from the vertex stage to the fragment stage, a varying, cannot be f64,
because interpolating a hi/lo pair across a triangle is numerically wrong: an f64 on an
entry's `@location` parameter, an IO struct field or an entry's return is refused. Interpolate
an f32 quantity instead, or carry the value in a uniform and do the f64 arithmetic in the
fragment stage. A scalar f64 vertex input is the one exception, since it is a buffer read and
the pair fits its one slot.

```ts
import { splitF64 } from 'typeshade'

const [hi, lo] = splitF64(-8_234_567.890123)
new Float32Array(uniformBuffer, 0, 2).set([hi, lo])
```

### Vectors

`vec2f64`, `vec3f64` and `vec4f64` are the vector types, built with `vec2f64(x, y)` and its
siblings. Components, swizzles, componentwise arithmetic with f64, f32 and number broadcast,
the componentwise builtins of the scalar list but `sqrt`, plus `normalize`, and the reductions
`dot`, `length` and `distance`, which give back an f64, all read the same as their f32
counterparts. A lane is a read: `v.x = …` is refused, so rebuild the whole vector. `vec3(v)`
narrows one per lane. A vector lowers to a struct holding a hi plane and a lo plane, so
componentwise work runs once for the whole vector.

```ts
"use typeshade";

class P {
  center: vec2f64;
}

declare const p: uniform<P>;

export function d(x: f64, y: f64): f32 {
  const q = vec2f64(x, y) - p.center;
  return f32(dot(q, q)); // the subtraction and the dot both run in f64
}
```

A vector uniform field takes its struct layout: 16 bytes for two components, 32 bytes for
three or four under std140. A vector vertex attribute would need two slots and is refused.

### What it costs

One f64 operation is several f32 operations, ten or more for a multiply or an add. So opt in
per value: hold the coordinates that need the range in f64, narrow as soon as the difference
is small enough for f32, and let the rest of the shader run at f32 speed.

```ts
"use typeshade";

// The subtraction needs the range; the shading after it does not.
export function shade(world: f64, camera: f64): f32 {
  return f32(world - camera) * 0.5 + 0.5;
}
```

Two f64 multiplies cost less, with nothing to write differently. `x * x` is a square, about
30% cheaper than a general multiply, as long as computing `x` has no side effect, such as a
call that writes a storage binding. A multiply or a divide by a power-of-two literal, `2.0`,
`0.5` or `-4.0`, scales the two f32 words and nothing else, which is exact barring overflow and
underflow: two f32 operations, none for `1.0`, and a sign change for `-1.0`. A scale that can grow the value
(by more than 1) applies to a value computed at run time; a constant keeps the general
multiply, so that WGSL, which evaluates constants while it creates the shader and refuses one
that overflows, never has to.

One example in the gallery, `examples/fp64-lane-stripes.shade.ts`, runs one formula on both
types side by side, and shows the f32 half collapsing to a flat field while the f64 half
keeps its stripes.

## GLSL float precision

After this page you know when to emit a GLSL stage at mediump, what that one option
changes in the emitted source, and which parts of the header it leaves alone.

GLSL ES 3.00 has no implicit precision for floats, so the emitted source declares one.
The backend writes `precision highp float;` at the top of every stage, and every float
in that stage takes it. A mobile GPU pays real bandwidth and power for highp arithmetic
and highp varyings, and the precision qualifier is the only lever the language gives for
that, so the GLSL emit options carry a knob for it.

### The floatPrecision option

`emitGlslModule` and `emitGlslStages` accept a `floatPrecision` value of `'highp'` or
`'mediump'` in their options bag:

```ts
import { emitGlslModule } from 'typeshade'

const fs = emitGlslModule(m, 'fragment', { floatPrecision: 'mediump' })
```

`'highp'` is the default and it is byte-neutral: omitting the option gives the same bytes
as passing it. `'mediump'` moves exactly one token in the whole emit, the qualifier on the
float line.

The choice happens at build time. It is an emit option, so it is not a runtime probe of
the device the program will run on. If you cache emitted source, put the precision into
the cache key, because a key without it can hand a mediump program back to a caller that
asked for highp.

### What a whole-stage default covers

mediump is roughly fp16: about three decimal digits of significand over a range of about
±65504. The default applies to the whole stage, so it covers positions, values in world
units, varyings and every intermediate value in the stage, including the ones you were not
thinking about when you reached for it. A value that needs more than three significant
digits, a position in world units for one, does not survive. f32 itself already collapses
once a value grows past its seven digits, which is why the
[fp64](/guide/authoring/fp64/) emulation exists at all.

Use mediump for a stage whose output is a bounded, low dynamic range colour. Keep highp
on a stage that computes a position, a value in world units, or an f64 value. Since
the option is per emit call, a program can take one qualifier in its vertex stage and
another in its fragment stage:

```ts
import { emitGlslModule } from 'typeshade'

const vertex = emitGlslModule(m, 'vertex') // positions stay highp
const fragment = emitGlslModule(m, 'fragment', { floatPrecision: 'mediump' })
```

`emitGlslStages(m, opts)` takes the same options bag and applies it to both stages, so
use it when both stages want the same qualifier and you want the shared lowering it pays
for once.

### What stays highp

The option spells the float line and nothing else. Two other precision lines in the
header are load-bearing and stay at highp under either setting.

`precision highp int;` is one of them. A GLSL ES 3.00 fragment shader has no default int
precision at all, so the line has to be there, and both the index math that reads a storage
buffer through a data texture and the integer half of a bitcast need the full int range.
Lowering it would turn a bandwidth choice into a wrong result.

The sampler lines are the other. GLSL ES 3.00 predeclares a default precision for
`sampler2D` and `samplerCube` only, so a module that declares a `sampler2DArray`, a
`usampler2D` or an `isampler2DArray` gets its own `precision highp <type>;` line for each
shape it uses, and `precision highp float;` does not cover them. Those lines are a
compile requirement, so they keep their qualifier. A fragment stage that samples one
`sampler2DArray`, emitted at mediump, opens with:

```glsl
#version 300 es
precision mediump float;
precision highp int;
precision highp sampler2DArray;
```

### What a CI run cannot tell you

A build can check two things about this option. The header shape is pinned in the
backend's unit tests. Whether the source compiles and links is a question for a real
driver, and both settings pass it identically, apart from the one token.

The numeric effect is a different question, and a desktop rasterizer cannot answer it. One
such stack reports mediump as a 10-bit format through `getShaderPrecisionFormat` and then
computes a mediump shader at f32, so a probe that should lose a bit returns the highp
answer. A GPU stack is free to do that, and a shader compiler is free to reassociate the
arithmetic a precision probe uses, because GLSL ES 3.00 has no qualifier that forbids
reassociation, so the two cases look the same from outside the driver. What follows is the
part to carry with you: no pixel comparison in CI can distinguish a mediump emit from a
highp one, so the bandwidth win, the banding mediump can introduce and the range clipping
are all verifiable only on real mobile hardware.

What a build can assert is that the option changed one line and left the rest of the emit
alone:

```ts
import { emitGlslModule } from 'typeshade'

const highp = emitGlslModule(m, 'fragment')
const mediump = emitGlslModule(m, 'fragment', { floatPrecision: 'mediump' })

mediump.replace('precision mediump float;', 'precision highp float;') === highp // true
```

So treat the option as a decision about a device you have in your hand. Emit mediump for
a colour stage, look at it on the phone you are shipping to, and keep highp everywhere a
coordinate flows.

## Production emit

After this page you can compose the ship-time transforms into an emit call, and read a
driver log that comes back in the renamed text.

A bundler minifies your JavaScript and never touches the shader string you hand to
`createShaderModule` or to `gl.shaderSource`. The transforms here do that half. They live
on their own subpath, `typeshade/emit-prod`, so a build that never imports it
bundles none of them and a plain emit call keeps the bytes it has.

The samples on this page read the module `m` that `compile()` returns for this source:

```ts
"use typeshade";

interface Params {
  tint: vec4;
}

declare const u: uniform<Params>;

function noise(p: vec2): f32 {
  const coordinate = floor(p * 4.);
  return fract(sin(dot(coordinate, vec2(12.9898, 78.233))) * 43758.5453);
}

function terrainShade(uv: vec2): vec4 {
  const h = noise(uv);
  return vec4(h, h * 0.5, 0.25, 1.) * u.tint;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi & 1) * 4. - 1., f32(vi >> 1) * 4. - 1., 0., 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return terrainShade(p.xy * 0.01);
}
```

### The plugin bag

An emit plugin is an `EmitPlugin`, a named transform you pass to an emit call, the way a
Vite or Webpack plugin is passed to a build. Both `emitModule` and `emitGlslModule` take a
`plugins` array in their options. A plugin acts in one of two stages: `transformIR`
rewrites the module before it is assembled, `transformText` rewrites the emitted string.
Every IR stage runs before any text stage, and within a stage they run in array order.

```ts
import { emitModule, emitGlslModule } from 'typeshade'
import { mangle, minify, obfuscate } from 'typeshade/emit-prod'

const renames = new Map<string, string>()
const wgsl = emitModule(m, { plugins: [mangle({ renames }), minify()] })

// obfuscate() is the standard preset: [mangle, prune, aliasTypes, minify]
const vs = emitGlslModule(m, 'vertex', { plugins: obfuscate() })
const fs = emitGlslModule(m, 'fragment', { parens: 'minimal', plugins: obfuscate() })
```

`parens: 'minimal'` sits in the emit options beside `plugins`, because parenthesis is a
decision the emitter makes while writing the text. It omits a paren only where WGSL and
GLSL ES 3.00 define the same precedence: unary minus over `*`, `/` and `%` over `+` and
`-`. Relational, logical, bitwise and shift operators keep their parens, because WGSL
gives them no chaining precedence. It never reassociates, so `a + (b + c)` keeps its
parens. The default `'full'` leaves every emitted byte alone. `packModule(m, { emit })`
takes the same options, so the manifest a runtime loads carries the shipped text.

### Shorter names

Mangling is renaming the identifiers the emitted text does not need to keep. `mangle()`
renames helper functions, plain structs, module consts, helper parameters and every local
to short base-52 names, `a`, `b`, and on to `aa`. Function-scoped names restart from the
same pool in every function, so the short end of the alphabet is reused instead of
counting upward, and that reuse is where most of the bytes are. The rename is
deterministic per module, so the two GLSL stage emits agree on every shared name and the
program still links.

Pass a `Map` as `renames` and you receive authored to emitted names. That map is the
shader source map. Keep it out of the shipped bundle.

```ts
const renames = new Map<string, string>()
const wgsl = emitModule(m, { plugins: [mangle({ renames })] })

renames.get('terrainShade') // 'b'
renames.get('noise.coordinate') // 'd'; a function-scoped key is `authoredFn.authoredName`
```

### Smaller text

Three plugins shrink the text itself.

`minify()` lexes the emitted source and re-emits the token stream, writing a separator
only where the two neighbours would otherwise merge into one token. Comments go, `#`
directives keep their own line, and numeric literals are canonicalized without changing
their value, so `0.500` becomes `.5`. `{ numbers: 'f32' }` re-spells each float as the
shortest decimal that rounds to the same f32. Pass `{ numbers: false }` when diffing
against a hand-checked baseline.

`aliasTypes()` gives each heavily used type a short name and declares it once, WGSL
`alias A=vec2<f32>;` and GLSL `#define A vec2`. Both targets accept the short name
everywhere the type was spelled, constructor position included. Both languages reserve
type names, so `mangle()` may not touch them and they are the largest category left after
mangling. A spelling that would not pay for its own declaration is skipped. It reports
type to alias into the same `renames` map.

`prune()` drops GLSL forward prototypes whose definition already declares the function at
each of its uses, and keeps every other one. It is a no-op on WGSL. The GLSL backend
emits a prototype only where the call graph forces one, so reach for this on GLSL the
backend did not author, such as a fragment a host splices in.

```ts
import { aliasTypes, minify, minifyShaderText, prune } from 'typeshade/emit-prod'

const glsl = emitGlslModule(m, 'fragment', {
  parens: 'minimal',
  plugins: [prune(), aliasTypes({ renames }), minify({ numbers: 'f32' })],
})

minifyShaderText(wgsl, { numbers: 'f32' }) // the same pass over a string you hold
```

### Inlining

`inline()` flattens the call graph. Every safely inlinable helper is inlined at all its
call sites, so those functions disappear from the output. Single-return helpers inline by
expression substitution, and single-exit multi-statement helpers inline by lifting their
statements into the caller. Entry points and recursive functions are always left intact.

It is not a size win, because a helper called from several places is duplicated at each
one. The point is removing structure a reader could follow, so pair it with `mangle()` and
`minify()`. The preset leaves it out. Place it before `mangle()`, since both act in the IR
stage.

Its one axis is `opaque`, which decides what happens to helpers carrying the
do-not-optimize flag that the f64 lowering stamps on the emulation library it injects.
`'keep'`, the default, leaves them alone. `'single-call'` also unlocks the ones with one
call site, where removing the declaration and its call duplicates nothing. `'all'` unlocks
every one, and costs 5.1x to 27.2x the emitted bytes. `maxGrowth` caps how far the
module's operation count may grow while unlocking, as a multiplier, and `report` collects
one decision per flagged helper considered.

```ts
import { inline, obfuscate, type InlineDecision } from 'typeshade/emit-prod'

const decisions: InlineDecision[] = []
const shipped = emitModule(m, {
  parens: 'minimal',
  plugins: [inline({ opaque: 'all', maxGrowth: 4, report: decisions }), ...obfuscate()],
})

decisions // [{ fn, callSites, ops, growth, inlined, reason: 'inlined' | 'over-budget' | 'not-inlinable' }, …]
```

### Decoding a driver log

The shipped text is unreadable on purpose, so a driver error reads
`no matching overload in 'b' for arg of type 'f'`. `decodeShaderLog(log, renames)` turns
that back into authored names. Substitution is token-wise, so the driver's own prose, its
line numbers and its source excerpts are untouched, and a short name inside a longer word is
never a hit. Decoding is a build-time step, so the decoder and the map both stay on the
`emit-prod` subpath and out of the shipped bundle.

A name that inverts uniquely is replaced, which covers module-scope names and type
aliases, the ones a driver actually names. A function-scoped name is reused across
functions on purpose, so one that inverts to several candidates is annotated with all of
them. `invertRenames(renames)` hands you the table as data.

```ts
import { decodeShaderLog, invertRenames, obfuscate } from 'typeshade/emit-prod'

const renames = new Map<string, string>()
emitModule(m, { parens: 'minimal', plugins: obfuscate({ renames }) })

decodeShaderLog("no matching overload in 'b' for arg of type 'f'", renames)
// "no matching overload in 'terrainShade' for arg of type 'vec2<f32>'"

decodeShaderLog('undeclared identifier d', renames)
// 'undeclared identifier d⟨coordinate (in noise) | h (in terrainShade)⟩'

invertRenames(renames).get('b') // { emitted: 'b', authored: ['terrainShade'] }
```

### Names that are never renamed

Some names are the interface a host resolves at run time, so mangling them would break the
binding. Five kinds are left alone. Entry-point names, because a WebGPU pipeline names its
`entryPoint`. Entry-point parameter names, because a non-struct entry parameter is the GLSL
varying name, and the vertex side spells that varying from its return struct's field name in
a separate emit call. Binding names, including the `_fp64` guard, because hosts resolve them
by name. Binding-struct names, because that is the GLSL uniform block tag. Struct field
names, because they carry std140 packing and because GLSL varyings link the two stages by
name. A module the IR builder assembled with a raw statement in it is left unmangled
altogether ([`docs/ir-builder.md`](docs/ir-builder.md)).

```ts
const renames = new Map<string, string>()
emitModule(m, { parens: 'minimal', plugins: obfuscate({ renames }) })

renames.get('terrainShade') // 'b', a helper function
renames.get('vec2<f32>') // 'f', a type alias
renames.has('u') // false; a binding name a host resolves
renames.has('fs') // false; an entry-point name a pipeline names
```

### Proving the shipped module is the one you tested

`semanticDiff(dev, prod)` reports the differences between two modules in four buckets, and
a production pipeline moves lines into some of them by design. Hand it the same plugin
array as `transforms` and every difference your declared pipeline provably causes is
classified out of those buckets into `explained`, each entry naming the plugin, the bucket
and the fact line.

```ts
import { isSemanticallyEqual, semanticDiff } from 'typeshade'
import { inline, obfuscate } from 'typeshade/emit-prod'

// devModule: the module you tested; prodModule: the one the production pipeline ships.
const d = semanticDiff(devModule, prodModule, { transforms: [inline(), ...obfuscate()] })

isSemanticallyEqual(d) // true when prod differs from dev only as the declared pipeline dictates
d.explained // [{ transform: 'inline', bucket: 'controlFlow', line: '…' }, …]
```

Classification is by construction. A line moves to `explained` only when applying the
declared plugin's own `transformIR` to the dev side actually removes it from the diff, so
a regression that resembles an optimizer rewrite stays in its bucket and a parity gate
budgets only the residue. Text-stage plugins explain nothing, because the comparator never
sees emitted text, so declaring the whole production array is safe.

Over the example corpus in this repository `obfuscate()` with `parens: 'minimal'` takes
plain emit from 182,437 characters to 93,753, and two gates hold it to its properties.
`examples/minify-safety.test.ts` asserts that the lexed token stream and every literal's
f32 value survive minification and that the pass is idempotent.
`examples/reserved-word-safety.test.ts` runs the corpus through `obfuscate()` and through
`[inline(), ...obfuscate()]` and asserts that neither plugin invents a name either
language reserves.

## Migrating a GLSL shader

After this page you can take the GLSL construct in front of you, look up how it is spelled
in a `"use typeshade"` file, and see what that spelling turns into on each target. The rest
of this guide is ordered for someone writing a new shader. This page is ordered for someone
holding a working GLSL ES 3.00 shader and asking what each line becomes.

### The construct table

A construct here is one piece of GLSL source you have to account for: a uniform block, a
preprocessor branch, an `#include`, an extension directive. Find the row, follow the
spelling to the page that explains it, and read the note for what changes.

| GLSL construct                                 | `"use typeshade"` spelling                                                          | WGSL result                                     | Notes                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uniform Block { … } name;`                    | [`declare const name: uniform<Block>`](/guide/authoring/layouts-and-resources/)     | `@group`/`@binding` `var<uniform>`              | the std140 layout comes from `reflect()`, so no offset is counted by hand                                                                                              |
| a loose `uniform float u_x;`                   | a field of a uniform struct                                                         | a field of a `var<uniform>` struct              | `declare const u_x: uniform<f32>` is WGSL-only, since GLSL ES 3.00 spells a uniform binding as a std140 block                                                          |
| a symbol or a block the host prelude declares  | none; the IR builder's `externVar`, `hostUniform` and `hostBlock`                   | the same reference, spelled per target          | [`docs/ir-builder.md`](docs/ir-builder.md) has them                                                                                                                    |
| `in` / `out` / `inout` on a function parameter | none / [`@out`, `@inout`](#a-function-that-changes-its-callers-variable)            | a pointer parameter                             | a parameter with no qualifier is GLSL's `in`                                                                                                                           |
| `#ifdef FEATURE` where this module decides     | [one file per variant](/guide/authoring/conditional-programs/)                      | no preprocessor                                 | the variant that does not declare a binding never has it                                                                                                               |
| `#ifdef FEATURE` where the host decides        | [`variantFamily`](/guide/authoring/conditional-programs/)                           | one module per point in the matrix              | `emitGuarded` generates the `#if` ladder for a GLSL host that owns the define, and every arm is byte-identical to the standalone variant                               |
| a variant that changes only a value            | [`override<T>` with `overrideValues`](/guide/authoring/conditional-programs/)       | `override` plus pipeline constants              | building a separate variant for this multiplies pipelines for nothing                                                                                                  |
| `#include "helper.glsl"`                       | [`import` from another shader file](/guide/authoring/functions-and-entry-points/)   | one module                                      | for a host that composes its own program, `emitGlslFragment` and `emitFragment` return a module fragment                                                               |
| `precision mediump float;`                     | [the `floatPrecision` emit option](/guide/authoring/glsl-float-precision/)          | nothing, since WGSL has no precision qualifiers | it sets the stage-wide default at emit                                                                                                                                 |
| `usampler2D` and `isampler2D`                  | [`texture_2d<u32>` and `texture_2d<i32>`](/guide/authoring/layouts-and-resources/)  | `texture_2d<u32>` and `texture_2d<i32>`         | the sampler precision line is emitted for you                                                                                                                          |
| `#extension … : require`                       | [the use that needs it, or `"enable …"`](/guide/authoring/capabilities-extensions/) | `enable …;`                                     | fails closed with SD0030 on a backend whose profile has no row. That page also says which capabilities survive on WGSL                                                 |
| comparing two emits after an optimizer pass    | [`semanticDiff`](/guide/authoring/production-emit/)                                 | the same                                        | compares IR and reflection, so folding and renaming do not drown the diff. Declare the production plugins as `transforms` and their rewrites classify into `explained` |

A block this module owns is the most common first row. Declare the struct and the binding,
and read the fields by name:

```ts
"use typeshade";

interface Camera {
  u_matrix: mat4;
  u_viewport_px: vec2;
}

// uniform Camera { mat4 u_matrix; vec2 u_viewport_px; } u_camera;
declare const u_camera: uniform<Camera>;

@vertex
export function vs(@location(0) pos: vec2): vec4 {
  return u_camera.u_matrix * vec4(pos / u_camera.u_viewport_px, 0., 1.);
}
```

### Builtin values

A builtin is a value the hardware supplies to a stage. The vocabulary for them is WGSL's,
written as `@builtin("id")` on a parameter or a struct field, so a `gl_*` spelling or a typo
is an error that names TypeShade's spelling. Each backend then spells the id its own way.

| GLSL global                        | `"use typeshade"` spelling                               | Notes                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gl_Position`                      | `@builtin("position")` on the vertex output              | writes `gl_Position` on GLSL. A vertex entry that returns a bare `vec4` returns the position                                                                                                     |
| `gl_FragCoord`                     | `@builtin("position")` on a fragment input               | reads `gl_FragCoord` on GLSL. Mind the y origin: GL window space is bottom-left and WGSL framebuffer space is top-left, so flip per target, or derive a y-symmetric value, before consuming `.y` |
| `gl_VertexID`                      | `@builtin("vertex_index") vi: u32`                       | GLSL wraps the read as `uint(gl_VertexID)`, since the surface types it u32 and GLSL's is int                                                                                                     |
| `gl_InstanceID`                    | `@builtin("instance_index") ii: u32`                     | the same `uint()` wrap                                                                                                                                                                           |
| `gl_FrontFacing`                   | `@builtin("front_facing") front: bool`                   |                                                                                                                                                                                                  |
| `gl_FragDepth`                     | `@builtin("frag_depth")` on a field of the return struct |                                                                                                                                                                                                  |
| `gl_PointSize` and `gl_PointCoord` | unsupported on both writers                              | point size caps vary per vendor, and WebGPU point primitives are always one pixel. Expand an instanced quad in the vertex stage and interpolate a `@location(n)` corner uv                       |
| float `mod(x, y)`                  | the builtin `mod()`                                      | that is floor-mod. `%` is trunc-mod, which is WGSL's semantics and spells portably on GLSL too. Pick by the semantics you mean on negative operands                                              |

A fragment stage reads the framebuffer coordinate through the same `position` builtin the
vertex stage writes, and writes the depth through a field of its return struct:

```ts
"use typeshade";

class FragOut {
  @location(0) color: vec4;
  @builtin("frag_depth") depth: f32;
}

@fragment
export function fsCoord(@builtin("position") pos: vec4): FragOut {
  return { color: vec4(pos.x * 0.001, pos.y * 0.001, 0., 1.), depth: 0.5 };
}
```

### Targeting WebGL2 only

Nothing on this page narrows what the GLSL writer can express. The neutral names are
spellings, and several of the rules behind them exist to make WebGL2 output more defined:
`round` emits `roundEven`, and float `%` emits a trunc-mod that GLSL ES 3.00 compiles.

A file that uses something only WGSL has, a scalar uniform, a `"read_write"` storage binding
in a draw or `@interpolate("linear")`, still compiles: `compile()` keeps the WGSL, leaves
`glsl` undefined and says why in a `TS8015` warning. The reverse has no spelling. A GLSL
construct the language does not model, `gl_PointSize` for one, cannot be written in a
`"use typeshade"` file. An engine that must emit one builds that statement with the IR
builder's raw statements, which [`docs/ir-builder.md`](docs/ir-builder.md) describes, with
what a raw statement costs the rest of the module.
