# Authoring shaders with `@xgis/shader-dsl`

After this page you know what one TypeScript source turns into, how to import the
authoring surface, and which page of this guide answers which question. The samples are
written against the source in this repository, and `examples/` holds complete shaders
authored the same way.

### What you write and what comes out

You write a shader as typed expressions and statements in TypeScript. Each expression you
build is a node: a small typed object that records an operation and its operands. The
graph of nodes is the intermediate representation, the IR, and the IR is what the package
compiles. You do not assemble shader text by hand, so a wrong type or a misspelt field is
a TypeScript error in your editor.

Two calls carry the structure. `fn` declares a function: its parameters, its body, and,
for an entry point, the stage it runs at. An entry point is the function the GPU calls,
once per vertex, per fragment or per compute invocation; every other function is a helper
it calls. `module` gathers the functions, the structs they use, the resources they read
and the constants they share into one module value.

That module value is the input to four outputs:

- `emitModule` returns WGSL, the shading language WebGPU accepts.
- `emitGlslStages` returns `{ vertex, fragment }`, GLSL ES 3.00 source for WebGL2, for a
  module that has both a vertex and a fragment entry point.
- `compileModule` returns the CPU oracle: the same IR evaluated in JavaScript with every
  value a double, which gives you the mathematically intended answer to compare a GPU run
  against.
- `reflect` returns the metadata a host needs to build the pipeline: bind groups, the
  std140 and std430 byte layouts a uniform or storage buffer has to match, vertex
  attributes and entry signatures.

```ts
import { fn, module, abs, length, f32T, vec2fT, emitModule, compileModule, reflect } from '@xgis/shader-dsl'

// One helper. The return type is inferred from the value the body returns.
const ringMask = fn('ring_mask', { uv: vec2fT, radius: f32T }, (p) =>
  abs(length(p.uv).sub(p.radius)),
)

const m = module({ funcs: [ringMask] })

const wgsl = emitModule(m) // WGSL source, as a string
const cpu = compileModule(m) // cpu.fns.ring_mask([0.3, 0.4], 0.5) === 0
const meta = reflect(m) // bind groups, layouts, entry signatures
```

`emitModule(m)` gives you this:

```wgsl
fn ring_mask(uv: vec2<f32>, radius: f32) -> f32 {
  return abs((length(uv) - radius));
}
```

The names you passed survive into the output, the parameter types became WGSL types, and
the return type came from the body. The optimizer adds bindings of its own where a
subexpression repeats, so an emitted body can carry a name you did not write.

### Importing

Author from the package root. It re-exports the whole authoring and emit surface: the IR,
the layout declarators, the WGSL and GLSL backends, the validator, the CPU oracle and
`reflect`.

```ts
import { fn, module, vec4, If, Switch, when, emitModule, reflect } from '@xgis/shader-dsl'
import { ioStruct, uniformStruct, structDecl, builtin, location, storageBuffer, resource } from '@xgis/shader-dsl'
```

Other subpaths carry surface you do not need in order to author and emit, and an import
you never write costs nothing in your bundle:

- `@xgis/shader-dsl/dev` has the development tooling: lint reports, optimizer measurement
  and source locations in errors.
- `@xgis/shader-dsl/emit-prod` has the ship-time text plugins that mangle, minify and
  obfuscate the emitted source.
- `@xgis/shader-dsl/compute` has the runner that dispatches a portable compute kernel on
  whichever backend the host has.

This package ships the authoring surface. The shaders themselves live in your repository
and import the package like any other dependency.

### How this guide is ordered

The pages are in learning order, one topic each, and reading them in order the first time
is the shortest path. After that, each page stands on its own. Per-function detail lives
on that function's reference page, which every first mention here links to.

The pages that follow, in order:

- [Your first shader](/guide/authoring/your-first-shader/): write a module with a vertex
  and a fragment entry point, and emit it for both targets.
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
- [Raw statements](/guide/authoring/raw-statements/): splice a hand-written statement into
  a module, and know what it costs on each target.
- [Migrating a GLSL shader](/guide/authoring/migrating-a-glsl-shader/): look up the GLSL
  construct in front of you and see how it is spelled here.

If you have never used this package, start with the next page. If you are here to port a
shader you already have, read Migrating a GLSL shader first and follow its links back.

## Your first shader

After this page you have a shader module written in TypeScript with two entry points, the
same module emitted once as WGSL for WebGPU and once as GLSL ES 3.00 for WebGL2, and you
know which call produced each string. The shader fills the screen with a colour gradient.

Everything the page uses comes from the package barrel:

```ts
import {
  fn,
  module,
  ioStruct,
  builtin,
  location,
  emitModule,
  emitGlslStages,
  u32,
  toF32,
  f32,
  vec2,
  vec4,
  u32T,
  vec2fT,
  vec4fT,
} from '@xgis/shader-dsl'
```

Two kinds of name appear there. `u32T`, `vec2fT` and `vec4fT` are *type tokens*, which is
what you write where a declaration needs a type. `f32`, `vec2` and `vec4` build a *node*,
a typed expression the graph is made of. A node carries its type in TypeScript, and you
build larger expressions by calling methods on it: `x.mul(4).sub(1)` is a multiply and a
subtract.

### A vertex entry point

An *entry point* is a function the GPU calls directly: once per vertex, once per fragment,
or once per compute invocation. This page uses the first two. You declare one with `fn`
and `opts.stage`. Everything else you write is a plain helper, declared with the same
`fn`.

The vertex stage runs once per vertex. It produces the clip space position and whatever
the fragment stage needs from it, packed in an *IO struct*: a record of fields where each
field carries an attribute. `builtin('position', …)` marks the value the hardware itself
consumes, and `location(0, …)` marks a value that is interpolated across the triangle and
read back by the fragment stage.

```ts
const VsOut = ioStruct('VsOut', {
  pos: builtin('position', vec4fT),
  uv: location(0, vec2fT),
})
```

This shader has no vertex buffer. It draws three vertices that cover the screen, and it
derives their positions from the vertex index alone. Stage attributed params go in the
same param record as ordinary ones, using the same `builtin` and `location` helpers:

```ts
const vs = fn(
  'vs',
  { vi: builtin('vertex_index', u32T) },
  ({ vi }) => {
    const x = toF32(vi.bitAnd(u32(1))).mul(4).sub(1)
    const y = toF32(vi.shr(u32(1))).mul(4).sub(1)
    return VsOut.construct({
      pos: vec4(x, y, 0, 1),
      uv: vec2(x.mul(0.5).add(0.5), y.mul(0.5).add(0.5)),
    })
  },
  { stage: 'vertex' },
)
```

The body receives the params as typed nodes, so `vi` is a `u32` node and `toF32` converts
it to `f32`. The return type is inferred from the value the body returns, here the struct
built by `VsOut.construct`.

### A fragment entry point

The fragment stage runs once per candidate pixel and returns a colour. It takes the vertex
output as a param, so the fields declared on `VsOut` are what it reads: `vo.uv` gives back
a `vec2<f32>` node with `.x` and `.y` on it.

```ts
const fs = fn(
  'fs',
  { vo: VsOut },
  ({ vo }) => {
    const shade = f32(1).sub(vo.uv.y)
    return vec4(vo.uv.x, shade, 0.5, 1)
  },
  { stage: 'fragment', retAttr: '@location(0)' },
)
```

`retAttr` attaches an attribute to a return value that is not a struct. `@location(0)` is
the first colour attachment.

A number literal takes its type from the operand next to it, so
`vec4(vo.uv.x, shade, 0.5, 1)` needs no wrapper. You write `f32(1)` where there is nothing
to infer from, here because a bare number carries no methods and `sub` has to be called on
something.

### Assembling the module

A *module* is the unit that emits. `module` takes arrays of consts, structs, bindings and
funcs, and each field defaults to empty, so this shader declares two of them:

```ts
const gradient = module({
  structs: [VsOut.decl],
  funcs: [vs, fs],
})
```

`VsOut.decl` is the struct declaration behind the handle. The handle is what you construct
values with and read fields off; the declaration is what the module emits. Order in
`funcs` is the emit order, so keep a function after the ones it calls.

### Emitting both targets

`emitModule(gradient)` returns the whole module as one WGSL string, both entries included:

```wgsl
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let _cse0 = ((f32((vi & 1u)) * 4.0) - 1.0);
  let _cse1 = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(_cse0, _cse1, 0.0, 1.0), vec2<f32>(((_cse0 * 0.5) + 0.5), ((_cse1 * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  return vec4<f32>(vo.uv.x, (1.0 - vo.uv.y), 0.5, 1.0);
}
```

GLSL ES 3.00 compiles one stage at a time, each source with its own `main`, so GLSL comes
back one string per stage. `emitGlslStages(gradient)` returns `{ vertex, fragment }` from
a single lowering of the module, the pass that rewrites the IR into the shapes the target
can spell:

```glsl
#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float _cse0 = ((float((vi & 1u)) * 4.0) - 1.0);
  float _cse1 = ((float((vi >> 1u)) * 4.0) - 1.0);
  gl_Position = vec4(_cse0, _cse1, 0.0, 1.0);
  uv = vec2(((_cse0 * 0.5) + 0.5), ((_cse1 * 0.5) + 0.5));
}
```

```glsl
#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  _ret = vec4(uv.x, (1.0 - uv.y), 0.5, 1.0);
}
```

The source was the same for both calls. The differences between the two outputs are the
ones each language forces: the IO struct becomes a matching `out` and `in` pair of
varyings, the fragment return becomes a declared output variable, the builtin position
becomes `gl_Position`, and `gl_VertexID` is a signed int so the `u32` param picks up a
cast. Emitting does not change the module, so you can emit it for either target, in either
order, as many times as you like.

### Where to go next

`Let` and `Var` force a value to carry a name of its own, and
[Values and mutation](/guide/authoring/values-and-mutation/) covers when a name is required
and how `.assign` mutates a value.
[Functions and entry points](/guide/authoring/functions-and-entry-points/) has the rest of
what `fn` and `module` accept, including the compute stage.
[Layouts and resources](/guide/authoring/layouts-and-resources/) is how a uniform block, a
vertex layout or a texture is declared once and read everywhere.
[Emitting and reflection](/guide/authoring/emitting-and-reflection/) covers the other emit
entry points and the pipeline metadata a host binds from.

## Values and mutation

After this page you can write an intermediate value, give it a type where the code needs
one, mutate it, and tell when a value has to carry a name of its own.

### Type tokens

A *type token* is a value that names a shader type. Every one ends in `T`. You write a
token where a declaration needs a type: a function parameter, a struct field, a bound
resource, an array's element type. A token names a type, so it never stands in for a
value, though a few value builders take one as an argument, as `arrayLit` and `.at` do
below.

```ts
const scale = fn('scale', { v: vec2fT, k: f32T }, ({ v, k }) => v.mul(k))
```

`f32T` is the float scalar and the type a bare number falls back to when there is no
operand to take a type from. `u32T` and `i32T` are the integer scalars, `boolT` is what
every comparison produces, and `vec2fT`, `vec3fT`, `vec4fT` are the float vectors. The
unsigned twins are `vec2uT`, `vec3uT` and `vec4uT`, the signed ones `vec2iT` and
`vec4iT`. `arrayT(elem, n)` builds a fixed length array type out of another token.

### Plain const bindings

Author every intermediate value as a plain JavaScript `const`. There is nothing to wrap it
in:

```ts
const ab = b.sub(a)
const len2 = dot(ab, ab)
```

The const holds a node, and a node remembers how it was built, so using the name twice uses
the same expression twice. The emit pass then decides for each value whether it becomes an
inlined expression, a shared `let` (its common subexpression cache), or a `var`. That
decision is not yours to write down.

The GLSL target adds one hoist of its own. An argument to a struct constructor whose value
comes from a function that can `discard` is bound to a local variable immediately before
the constructor call. It happens on every GLSL emit, so there is nothing to mark in the
source, and the WGSL output is unaffected.

### Let and Var

Two functions give a value a name when the name has to exist. `Let(value)` binds the value
once and hands back a read-only node. `Var(init)` declares a mutable variable; the type
comes from the initial value, or you pass a type token, with or without an initial value.
Both take an optional leading name string, which becomes the name in the emitted source.
Leave the name out and the binding takes a function-unique auto name (`_v0`, `_v1`), so
pass a name wherever you want to read the emitted source.

```ts
const d = Let('d', length(p).sub(1)) // let d = …;   bound once, read only
const t = Var('t', f32(0)) // var t: f32 = 0.0;
const hits = Var('hits', u32T) // var hits: u32;
```

A `Let` binding, a function parameter and a module constant are read-only nodes. They
carry every method that reads a value and none that writes one, so assigning to them is a
`tsc` error at the authoring line. Declare with `Var` when you mean to mutate.

A `Let` stops being a matter of taste inside a loop that mutates a variable. The
subexpression cache cannot share a value that reads a mutated variable, because the value
differs at every read, so a value derived from that mutated variable and read twice is
re-emitted at each use until you bind it with `Let`. A derivative such as `fwidth` needs a
name for a different reason: WGSL requires the call in uniform control flow, so bind it
with `Let` outside the branch that reads it.

### Mutation with assign

JavaScript cannot overload `=`, so mutation is a method on the value being written.
`.assign(v)` is the only one, and a node carries no compound method: `add` is the pure
expression, so `x += v` is written `x.assign(x.add(v))`.

```ts
const min_dist = f32(1e10) // a plain const…
min_dist.assign(min(min_dist, d)) // …becomes a var because something assigns to it
winding.assign(winding.add(1)) // no addAssign; the pure op plus assign
o.pos.assign(vec4(pos, 0, 1)) // a struct field is a target too
```

Assigning to a plain `const` is enough to make it a variable in the emitted source. You do
not have to see that coming and declare a `Var` up front.

### Operator methods

Arithmetic, comparison, bitwise operations, component access and indexing are all methods
on a node, for the same reason mutation is:

| category   | methods                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| arithmetic | `.add .sub .mul .div .mod .neg`                                          |
| comparison | `.lt .gt .le .ge .eq .ne`                                                |
| logical    | `.and .or`                                                               |
| bitwise    | `.bitAnd .bitOr .bitXor .shl .shr`                                       |
| components | `.x .y .z .w` · `.r .g .b .a` · `.rgb .xy .xyz …` · `.swizzle<R>('zxy')` |
| index      | `.at(i, elemType)`                                                       |
| ternary    | `cond.select(a, b)`                                                      |

A few operations are free functions. `select(cond, a, b)` is the free spelling of
`.select`, for the times the condition is not the value you want to read first. `mod(x, y)`
is the floor modulo, the one to reach for wherever an operand can be negative, as in domain
repetition and angle folds; the `.mod` method is `%` and behaves differently on negative
operands. `radians` and `degrees` convert angles, so a conversion constant of your own
never has to be written or rounded.

```ts
const inside = d.lt(0).and(u.ge(0))
const shade = select(inside, 1, 0)
const cell = mod(p.x, 2).sub(1)
const lonRad = radians(lon)
const latDeg = degrees(latRad)
```

### Number literals

A bare number lifts to the type of the operand beside it, so most of the time the wrapper
is unnecessary:

```ts
x.add(1) // f32 x → x + 1.0
flags.bitAnd(1) // u32 flags → flags & 1u
mode.eq(2) // u32 → mode == 2u
vec4(pos, 0, 1) // components lift to the vector's element type
vec2u(0, 1) // → u32 components
```

The same lift works inside vector and struct constructors and inside `min`, `max`, `clamp`,
`mix`, `pow` and `smoothstep`. Keep an explicit `f32(0.5)` or `u32(16)` where there is
nothing to infer from: a standalone constant, the type anchoring first argument of a math
builtin, or a literal you want to call a method on, as in `f32(1).sub(v)`.

Negative literals lift the same way. `x.mul(-6)`, `.add(-0.25)` and `vec3(-1, 0, 1)` emit
the signed literal on both targets, so the sign belongs in the number.

### Module constants

A module constant is declared once, emitted as a `const` on both targets, and evaluated by
the CPU oracle as well. A scalar whose GPU and CPU values differ, one that the shader
should see truncated and the oracle should see in full, is declared with `constDecl`:

```ts
const PI = constDecl('PI', f32T, { wgsl: 3.14159265, cpu: Math.PI })
const area = fn('area', { r: f32T }, ({ r }) => r.mul(r).mul(PI.node))
```

`constDecl` hands back a handle with two halves. `PI.decl` is the declaration the module
carries, and `PI.node` is the typed reference you read inside a function body, so a
renamed or misspelled constant is a `tsc` error at every use site.

A constant that is not a scalar, a colour, a palette, a struct, is declared with
`constExpr` from a literal node the compiler can fold. `arrayLit(elem, ...items)` builds
the array literal to hand it:

```ts
const SKY = constExpr('SKY', vec4fT, vec4(0.4, 0.6, 0.9, 1))
const PALETTE = constExpr('PALETTE', arrayT(vec4fT, 3), arrayLit(vec4fT, c0, c1, c2))
```

`PI.decl` and the `constExpr` results go in the module's `consts` array. Read a
`constDecl` through `PI.node`. A `constExpr` constant is read with
`constRef('SKY', vec4fT)`, where the name is a string the type checker cannot check for
you.

## Functions and entry points

After this page you can declare a helper, call it from another function, write an entry
point for the vertex, fragment or compute stage, and assemble the module that carries them.

### Declaring a function

`fn` authors every function in a shader, both plain helpers and the entry points a pipeline
runs. It takes an optional name, a record of parameters keyed by name, and a body. The body
receives the typed parameter nodes as its first argument, so destructuring that argument
gives you one node per parameter.

```ts
// Helper: return type inferred as f32 from `return select(...)`.
export const dist_to_segment = fn(
  'dist_to_segment',
  { p: vec2fT, a: vec2fT, b: vec2fT },
  ({ p, a, b }) => {
    const ab = b.sub(a)
    const len2 = dot(ab, ab)
    const t = clamp(dot(p.sub(a), ab).div(max(len2, 1e-10)), 0, 1)
    const segDist = length(p.sub(a).sub(ab.mul(t)))
    return select(len2.lt(1e-10), length(p.sub(a)), segDist)
  },
)
```

What `fn` returns is a handle, one object that is both the callable and the function
declaration. You call the handle directly, and you list it in a module.

A parameter may carry a name that GLSL reserves, such as `in`, `sample`, `filter` or
`texture`. The IR keeps the name and the GLSL backend renames it at emit. JavaScript
destructuring cannot bind such a name, so write `({ in: inp }) => …`.

### Return types

Leave the return type out and it is inferred from the value the body returns. The body's
native `return` is checked against that type, so a wrongly typed return is a compile error.

Pass an explicit type token in two cases. The first is a body whose value leaves through an
ambient `Return()` inside a nested closure, which TypeScript cannot see. The second is a
function that returns nothing at all, which passes `voidT`.

```ts
// Inferred: dot() yields f32, so luma returns f32.
const luma = fn('luma', { c: vec3fT }, ({ c }) => dot(c, vec3(0.2126, 0.7152, 0.0722)))

// Pinned: this one writes into a storage buffer and returns no value.
const store = fn('store', { i: u32T, v: f32T }, voidT, ({ i, v }) => {
  outputB.at(i).assign(v)
})
```

### Calling a function

A handle accepts a single object keyed by parameter name. That form checks argument names,
types and completeness, and it autocompletes. A handle also accepts positional arguments,
which TypeScript does not check for arity, type or order, so a swap of two arguments of the
same type compiles.

`externFn` is the call-only counterpart. It declares the signature of a function whose body
is linked in at emit from elsewhere, so you get a typed call now and there is no declaration
to list in a module. Use a real `fn` handle whenever the callee can be imported at the call
site.

```ts
const d = dist_to_segment({ p: uv, a: p0, b: p1 })
const same = dist_to_segment(uv, p0, p1) // the unchecked form

const toneMap = externFn('host_tone_map', { c: vec4fT }, vec4fT)
const mapped = toneMap({ c: colour })
```

### Entry points

An entry point is a `fn` whose options carry `stage`, one of `'vertex'`, `'fragment'` or
`'compute'`. A compute entry also takes `workgroupSize`, which defaults to 64 and emits
`@compute @workgroup_size(N)`.

```ts
const WINDOW = u32(8)
const params = resource('params', vec4uT, { group: 0, binding: 2 })

const reduceKernel = fn(
  'reduce_windows',
  { gid: builtin('global_invocation_id', vec3uT) },
  voidT,
  ({ gid }) => {
    const idx = gid.x
    If(idx.ge(params.node.x), () => {
      Return()
    })
    const base = idx.mul(WINDOW)
    // …fold WINDOW input elements into one output element…
  },
  { stage: 'compute', workgroupSize: 64, allowEarlyReturn: true },
)
```

The guard leaves the function before its last statement, so the options also carry
`allowEarlyReturn: true`. [Control flow](/guide/authoring/control-flow/) covers early exits
and that option.

### Stage parameters

A stage passes its inputs through attributed parameters. `builtin(name, type)` declares a
value the hardware supplies, such as `'vertex_index'`, `'position'` or
`'global_invocation_id'`. `location(n, type)` declares a numbered slot that carries data
between stages. The same two helpers describe the fields of an IO struct, which `ioStruct`
declares once and both stages then share;
[Layouts and resources](/guide/authoring/layouts-and-resources/) has the field map, the
interpolation modes and the accessors the handle carries.

```ts
const VsOut = ioStruct('VsOut', {
  pos: builtin('position', vec4fT),
  uv: location(0, vec2fT),
})

const vsFull = fn(
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

// U is a uniform block declared alongside these functions.
const fsGradient = fn(
  'fs_gradient',
  { vo: VsOut },
  (p) => {
    const t = p.vo.uv.y.add(U.field.mix_bias)
    const rgb = mix(U.field.bottom.rgb, U.field.top.rgb, t)
    return vec4(rgb, f32(1))
  },
  { stage: 'fragment', retAttr: '@location(0)' },
)
```

A stage function that returns a plain value attaches its attribute with `retAttr`, as
`fs_gradient` does above. A stage function that returns a struct carries the attributes in
the struct fields.

### Assembling a module

`module` collects the declarations that emit together, and every one of its fields is
optional. `consts`, `structs`, `bindings` and `funcs` take declarations directly, and `uses`
takes handles that carry their own, the form
[Layouts and resources](/guide/authoring/layouts-and-resources/) uses. A module also carries
the `overrides` of [Conditional programs](/guide/authoring/conditional-programs/) and the
`enables` of [Capabilities & extensions](/guide/authoring/capabilities-extensions/).

```ts
const gradientModule = module({
  structs: [U.struct, VsOut.decl],
  bindings: [U.binding],
  funcs: [vsFull, fsGradient],
})
```

Order in the `funcs` array is the emit order. Keep callees before their callers, because GLSL
ES 3.00 requires a declaration before its use, and a fixed order keeps the emitted bytes the
same from run to run. A function you reach through a handle call but do not list is collected
for you and placed before the function that calls it, which means an entry-point-only list
also emits in a valid order.

### Naming the functions in a module

A `fn` without a name gets a placeholder name. To name functions once, pass `funcs` as a
record: each key becomes the emitted name of its function, and key order is the emit order.

```ts
module({ funcs: { dist_to_segment, vs_full: vsFull, fs_gradient: fsGradient } })
```

Record keys are deterministic, so this form is safe for byte-compared snapshots and for
functions referenced by string. Keep the array form when the list is spread across several
sources or post-processed as data. One caution: a record key renames the shared declaration,
so a function already assembled into another module under a different name throws instead of
corrupting that module's emit.

## Control flow

After this page you can branch, loop and dispatch inside a shader body, and you can tell a
statement form from a value form. A *statement form* pushes code onto the body being built
and hands back no value you can bind, the way `If` and `Loop` do. A *value form* builds
the same branch internally and returns a node you can bind to a `const`, the way `when` and
`matchEnum` do. Reach for a value form when the branch exists to pick a value, and for a
statement form when it exists to do something.

### If, elif and else

`If(cond, body)` takes a `bool` node and a zero argument closure. The body authors into the
innermost open scope, so there is no builder object to thread through it. Chain
`.elif(cond, body)` and `.else(body)` on the result.

```ts
If(p.idx.eq(1), () => {
  pos.assign(vec2(3, -1))
})
  .elif(p.idx.eq(2), () => {
    pos.assign(vec2(-1, 3))
  })
  .else(() => {
    pos.assign(vec2(-1, -1))
  })
```

These are statements. A body that ends in a native `return value` is not read as a value
the chain produces. To leave the enclosing function from inside a branch, use `Return` or
`ReturnIf`, covered at the end of this page.

### Loop

`Loop` is the C style for loop. It takes the counter's initial value, a condition, a body,
and an optional step that defaults to `+1`. An optional leading name string names the
counter in the emitted source.

```ts
Loop(
  u32(0),
  (i) => i.lt(u32(64)), // the condition receives the counter…
  (i) => {
    // …and so does the body, so declare (i) here too
    acc.assign(acc.add(toF32(i)))
  },
)
```

Both callbacks receive the counter. A body written `() => {}` that mentions `i` is legal
JavaScript closure syntax, and `i` is undefined there: `tsc` reports `Cannot find name 'i'`
at the authoring line. The counter arrives as a mutable node, so assigning to it inside the
body is allowed.

An error thrown while a body is being built carries the body it came from, so the message
starts with the function and the body kind, for example `in Loop body`.

### Break, continue and discard

Three terminators end a piece of work early. `Break()` exits the nearest enclosing loop, or
the current switch case. `Continue()` skips to the next iteration of the nearest enclosing
loop. `Discard()` kills the current fragment invocation with no colour or depth write, and
belongs in a fragment stage. An `If` or `Switch` body nested in a loop is not itself a loop
boundary, so a `Break()` inside a guard targets the loop around the guard.

```ts
const dists = Var('dists', arrayT(f32T, 64))

Loop(u32(0), (i) => i.lt(count), (i) => {
  const d = Let(dists.at(i, f32T))
  If(d.lt(0), () => Continue()) // no distance recorded, next iteration
  If(d.lt(0.001), () => Break()) // close enough, leave the loop
  nearest.assign(min(nearest, d))
})

If(alpha.lt(0.01), () => {
  Discard()
})
```

### Switch

`Switch(scrut)` dispatches on a single integer value, the *scrutinee*, which is an `i32` or
a `u32` node. `.case(n, body)` adds a case label and `.default(body)` adds the optional
default arm and closes the chain. It lowers to a real `switch` on both targets.

`Switch` is a statement, so a switch that picks a value declares the variable first and
assigns to it in the arms:

```ts
const radiusPx = Var(rawRadius)
Switch(sizeMode)
  .case(1, () => radiusPx.assign(rawRadius.div(viewport.z)))
  .case(2, () => radiusPx.assign(rawRadius.mul(dpr)))
  .default(() => {}) // the default arm may be empty, and it terminates the chain
```

The value form of the same dispatch is `matchExpr(scrutinee, cases, default)`, which
returns the result as a node. Its arms are `[caseValue, value]` pairs and its default is the
fall-through value.

### Choosing a value with when

`when` is the condition side value form. It takes values only: no name, no type token, with
the result type inferred from the arms. The two argument shapes are a two arm form and an
N arm form, where the first arm whose condition holds wins.

```ts
// two arms
const dir = when(
  segLen.lt(1e-6),
  () => vec2(1, 0),
  () => segVec.div(segLen),
)

// N arms: an array of [condition, () => value] pairs, then the else value
const clip = when(
  [
    [projParams.x.lt(0.5), () => transformMat4(mvp, vec4(rel2d, 0, 1))],
    [projParams.x.lt(6.5), () => transformMat4(mvp, vec4(relG, 0, 1))],
  ],
  () => transformMat4(mvp, vec4(ecefRtc, 1)),
)
```

`when` declares the variable and the if chain internally and returns the result node, so
the emitted code is what the hand written `var v; if (…) v = …` gives you. Each arm is a
thunk, so its value is built inside that arm's branch. A `Let` written in an arm lands in
that branch, and the GPU runs only the branch it takes. `select(cond, a, b)` is the eager
two way alternative: both arms are evaluated and one is chosen, which suits a pair of
cheap values. Use `when` for dispatch on conditions or ranges, and `Switch` or `matchExpr`
when there is a single integer scrutinee.

### Folding a loop with reduce

An *accumulator* is a value carried from one iteration of a loop to the next. `reduce`
carries one for you. It takes the accumulator's initial value, then the loop's initial
counter, condition, body and optional step. The body returns the next accumulator, and
`reduce` returns the final one for use after the loop.

```ts
const best = reduce(
  f32(1e10),
  u32(0),
  (i) => i.le(STEPS),
  (acc, i) => {
    const q = bezierPoint(i)
    return min(acc, length(p.sub(q)))
  },
  u32(1),
)
```

`reduce` declares the variable, the loop and the assignment internally, so this emits the
same code as writing `Var` plus `Loop` plus `assign` yourself.

### Exhaustive dispatch with enumU32

`enumU32` declares a `u32` enum from a name to value map, and `matchEnum` dispatches on it
with one arm per member. The arms object has to cover every member: leave one out, or add a
key that is no member, and `tsc` reports it, so adding a member surfaces every site that
has to handle it. The dispatch lowers to the same `matchExpr` the hand written form gives.

```ts
const Kind = enumU32({ Line: 0, Fill: 1, Stroke: 2 })

const color = matchEnum(seg.kind, Kind, {
  Line: () => lineColor,
  Fill: () => fillColor,
  Stroke: () => strokeColor, // drop an arm and it is a compile error
})
```

`Kind.members.Fill` is a `Node<'u32'>` literal you can compare against, and `Kind.values`
holds the raw integers the case labels use. Prefer `matchEnum` over a bare `Switch` whenever
the case set is closed: a forgotten case is a compile error, so it never reaches a pixel.

### Early returns

A native `return value` inside a control flow body is not an early exit, because that would
read as a silent fall-through. Write early exits with `Return(value)`, or with
`ReturnIf(cond, value)` for a guard clause, which emits what `If(cond, () => Return(value))`
emits.

```ts
If(winding.ne(0), () => {
  Return(f32(1).sub(min_dist))
})
Return(f32(1).add(min_dist))
```

The same guard on one line:

```ts
ReturnIf(winding.ne(0), f32(1).sub(min_dist))
Return(f32(1).add(min_dist))
```

The final `return value` of a `fn` body is native TypeScript and stays type checked, so
that one needs nothing. `Return` and `ReturnIf` are for exits from inside an `If`, a `Loop`
or a `Switch`. The single exit rule that `diagnose` runs asks a function for one return, as
its last statement. Pass `{ allowEarlyReturn: true }` as the last argument to `fn` to say
the early exit is deliberate, and the rule stops reporting it.

## Layouts and resources

After this page you can declare a vertex, uniform, storage or texture layout once and read
every field off that one declaration.

A layout is the agreement between a shader and the pipeline that feeds it: the fields one
stage hands to the next, the uniform block a draw call binds, the buffers and textures at
each slot. Each helper takes the layout once, as a field map or as an element type, and
returns a handle that carries whatever declarations that layout needs together with the
typed accessors for it. Because the accessors come off the same object as the declaration,
a field name or a field type you get wrong is a TypeScript error at the authoring line.
Pass the handles to `module({ uses: [...] })` and the module collects whatever declarations
each one carries.

### IO structs

An IO struct is a group of fields that crosses a stage boundary: a vertex stage returns
it and a fragment stage takes it as a parameter. `ioStruct` declares one from a name and a
field map, and every field carries a stage attribute. `builtin(name, type)` declares a value
the hardware supplies, and takes a WGSL builtin id such as `'position'` or `'vertex_index'`,
typed as a closed union, so a name WGSL does not define is a `tsc` error. `location(n, type)`
declares a numbered slot, with an optional interpolation mode of `'flat'`, `'linear'` or
`'perspective'`; `'flat'` is the mode both targets support.

```ts
const VsOut = ioStruct('VsOut', {
  pos: builtin('position', vec4fT),
  uv: location(0, vec2fT),
  vis: location(1, f32T),
  view_w: location(2, f32T),
})

// A vertex fn returns the struct. `construct` builds the value in one expression,
// so a missing or extra field is a TS error.
const vs = fn(
  'vs_main',
  { xy: location(0, vec2fT), uv: location(1, vec2fT) },
  (p) => {
    const pos = vec4(p.xy, 0, 1)
    return VsOut.construct({ pos, uv: p.uv, vis: f32(1), view_w: pos.w })
  },
  { stage: 'vertex' },
)

// Read fields off a parameter declared with the handle.
const fs = fn(
  'fs_main',
  { input: VsOut },
  (p) => {
    If(p.input.vis.lt(0), () => {
      Discard()
    })
    return vec4(p.input.uv, 0, 1)
  },
  { stage: 'fragment' },
)
```

`VsOut.var('out')` is the third form. It declares a mutable var of the struct and hands back
assignable fields, for an output you build over several statements. To read fields off a
value you hold as a plain node, use `VsOut.of(node)`.

### Uniform blocks

A uniform block is a struct the host fills once per draw and every invocation reads.
`uniformStruct` declares the struct and its binding in one call: the WGSL type name, the
slot (`group`, `binding`, and `as` for the variable name), then the field map. Read a field
with `.field.<name>`. The result is an ordinary node, so component access and math chain
straight off it. Uniform fields are read-only in WGSL, and the handle types them that way,
so assigning to one is a `tsc` error.

```ts
const U = uniformStruct(
  'Uniforms',
  { group: 0, binding: 0, as: 'u' },
  {
    mvp: mat4x4fT,
    proj_params: vec4fT,
    raster_params: vec4fT,
  },
)

const opacity = U.field.raster_params.x
const m = U.field.mvp
```

### Plain structs

`structDecl` declares a struct that never crosses a stage boundary: the element type of a
storage buffer, or a struct nested inside another one. Its fields are plain types with no
stage attribute, which is the whole difference from an IO struct. The handle has the same
shape, plus a positional `.get(node, 'field')` reader for call sites that pull many fields
off one shorthand.

```ts
export const ShapeSegment = structDecl('ShapeSegment', {
  kind: u32T,
  color_idx: u32T,
  flags: u32T,
  _pad: u32T,
  p0: vec2fT,
  p1: vec2fT,
  p2: vec2fT,
  p3: vec2fT,
})
```

### Storage buffers

A storage buffer is a bound `array<Element>` whose length comes from the buffer the host
binds. `storageBuffer` declares one from its element alone, either a struct handle or a
scalar or vector type, and `.at(i)` is the element accessor: the typed field proxy for a
struct element, the element node itself for a scalar or vector one. `access` fixes the write
capability at the type level. Under `'read'` the fields are read-only and assigning to one is
a `tsc` error; under `'read_write'` they are assignable.

```ts
const segmentsB = storageBuffer('segments', ShapeSegment, { group: 0, binding: 9, access: 'read' })

const seg = segmentsB.at(i)
seg.p0 // → Node<'vec2<f32>'>
seg.kind // → Node<'u32'>

const featIds = storageBuffer('feat_ids', u32T, { group: 0, binding: 10, access: 'read' })
featIds.at(i) // → Node<'u32'>
```

GLSL ES 3.00 has no storage buffer object, so a read binding lowers to a data-texture fetch
at emit and the shader source stays as written. On the GLSL target the host allocates that
data texture, and its internal format has to match the sampler the lowering declares: R32F
for a float array, R32UI for `array<u32>`, R32I for `array<i32>`. Nothing checks the pairing
at runtime, so read the element off `reflect()` instead of tracking it separately.

That lowering only gathers, so a `'read_write'` binding on the GLSL target is a build-time
error. Prefer `'read'` unless the module is WGSL-only. A `'read_write'` binding in a module
that also targets GLSL stays invisible until the first GLSL emit.

### Textures and samplers

`resource` declares a bound value that has no fields of its own, which covers textures and
samplers. The type token decides what the access node accepts: `texture2dfT` for a 2D
texture of filtered floats, `samplerT` for a sampler, which is the object that carries the
filtering and wrap state. `.node` keeps the specific type, so a texture and a sampler passed
in the wrong order is caught by `tsc`.

```ts
const tex = resource('tex', texture2dfT, { group: 0, binding: 1 })
const texSampler = resource('tex_sampler', samplerT, { group: 0, binding: 2 })

const c = textureSample(tex.node, texSampler.node, uv) // fragment only
const cv = textureSampleLevel(tex.node, texSampler.node, uv, 0) // any stage
const size = textureDimensions(tex.node) // → Node<'vec2<u32>'>, the extent in texels
```

`textureSample` takes its mip level from screen-space derivatives, which only a fragment
invocation has, so it is fragment-only and a vertex or compute use is an SD0109 lint error.
Read an explicit level with `textureSampleLevel(tex, smp, uv, level)`, which is legal in
every stage. The derivative builtins `fwidth`, `dpdx` and `dpdy` are fragment-only for the
same reason and have no vertex or compute form, so precompute the quantity there and pass it
in.

### Array and integer textures

A 2D array texture holds N layers behind one binding, with the layer picked on each call, so
an atlas of any depth costs one slot. Declare it with `texture2dArrayfT`. The same three read
functions cover it: the first argument's type selects the array form, and the `layer`
argument then becomes required. A plain number layer lifts to an integer literal.
`textureDimensions` reports width and height only, for an array texture too, and the layer
count is the separate `textureNumLayers`, which returns `u32`; wrap it in `toF32` for float
math.

An integer texture holds exact 32-bit texels, for an id map, a packed colour table or a
bitfield lookup. `texture2duT` and `texture2diT` declare the 2D forms, and
`texture2dArrayuT` and `texture2dArrayiT` the array twins. The result of a load follows the
texture's element, `vec4<u32>` off an unsigned one and `vec4<i32>` off a signed one, so
assigning it to the wrong type is a `tsc` error. `textureSample` and `textureSampleLevel`
reject these types at `tsc`, because filtering is a weighted average and WGSL has no
sampling form for an integer texture at all. What an integer texture offers is `textureLoad`,
`textureDimensions` and `textureNumLayers`.

```ts
const atlas = resource('atlas', texture2dArrayfT, { group: 0, binding: 4 })
const atlasSampler = resource('atlas_sampler', samplerT, { group: 0, binding: 5 })

textureSample(atlas.node, atlasSampler.node, uv, layer) // implicit LOD, fragment only
textureSampleLevel(atlas.node, atlasSampler.node, uv, layer, level) // explicit LOD, any stage
textureLoad(atlas.node, coord, layer, level) // unfiltered texel fetch
textureNumLayers(atlas.node) // → Node<'u32'>

const ids = resource('ids', texture2duT, { group: 0, binding: 3 })

textureLoad(ids.node, coord, 0) // → Node<'vec4<u32>'>
textureDimensions(ids.node) // → Node<'vec2<u32>'>, same as any other texture
```

`reflect()` reports each texture binding's dimension and element, which is what a host needs
to create a matching view and to pick the sample type for it. Getting that pairing wrong
raises nothing at runtime: a texture whose format disagrees with its sampler type is
incomplete, and a fetch on it silently returns zero.

## Emitting and reflection

After this page you can turn a module into WGSL, into both GLSL stages, or into a fragment
a host composes into its own program, and you can read the pipeline metadata a host binds
from.

Emitting turns the IR a module holds into source text for one target. Reflection is the
other half of the same module: a description of what the shader expects, as data, so the
code that allocates buffers, builds bind groups and sets a vertex layout reads it off the
module instead of repeating it by hand. Both are read-only over the IR, so calling either
one leaves the module you pass exactly as it was.

### Emitting WGSL

`emitModule(m)` returns the whole module as one WGSL string: the module's consts, structs,
bindings and functions, with each entry point carrying its stage attribute. It runs the
pre-emit checks first, so a module that does not validate, or that needs a capability the
target lacks, throws a coded error at the emit call.

```ts
import { emitModule, emitModuleAt, emitIdentity } from '@xgis/shader-dsl'

const wgsl = emitModule(m)

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
lowering once for the pair.

```ts
import { emitGlslModule, emitGlslStages } from '@xgis/shader-dsl'

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
stage, and naming them keeps the single lowering. The GLSL calls take the WGSL emit
options plus their own; the `GlslEmitOptions` reference lists them.

### Module fragments

A module fragment is a piece of a program: the declarations and helpers with no version
header and, by default, no entry point, for a host that owns the final program and pastes
ours into it. It is what to reach for where a GLSL codebase would write `#include`.
`emitGlslFragment(m, stage)` returns one for GLSL and `emitFragment(m)` for WGSL, both in
the same shape.

```ts
import { emitFragment, emitGlslFragment } from '@xgis/shader-dsl'

const f = emitGlslFragment(m, 'fragment')

f.source // 'struct VsOut {\n  vec4 pos;\n …', the declarations and helpers
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
import { reflect } from '@xgis/shader-dsl'

const r = reflect(m)

r.bindGroups // [{ group: 0, entries: [{ group: 0, binding: 0, name: 'U', space: 'uniform',
//                 resourceKind: 'uniform-buffer', owner: 'module',
//                 structName: 'Uniforms', stages: ['fragment'] }] }]
r.uniforms // [{ name: 'Uniforms', size: 32, align: 16, fields: [
//              { name: 'time', type: 'f32', offset: 0, align: 4, size: 4 }, … ] }]
r.storage // std430 layouts for a storage binding declared directly as a struct
r.vertex // { attributes: [{ name, location, type, offset }], arrayStride }
r.entries // [{ name: 'vs', stage: 'vertex', inputs: ['u32'], output: 'struct:VsOut', io }, …]
r.overrides // the pipeline constants a host supplies per variant
r.requiredFeatures // the capabilities a host must have active before it creates a pipeline
r.requires // host-provided globals the module references and does not declare
```

`uniforms` is std140 and `storage` is std430, the two byte layouts the targets use for a
uniform block and for a storage buffer. Each one gives every field its offset, alignment and
size, plus the struct's own size already rounded up to its alignment, so that size is the
stride for an array of the struct as well. A binding declared with `storageBuffer` is an
array of the element type you pass, so it appears in `bindGroups` and `storage` has no entry
for it. To get that element's std430 stride, or the layout of any `structDecl` handle you
hold on its own with no module around it, call `wgslLayout` on the handle's `decl`, as in
`wgslLayout(ShapeSegment.decl, 'std430')` for the struct
[Layouts and resources](/guide/authoring/layouts-and-resources/) declares. `vertex` is
`undefined` for a module whose vertex entry takes no `location` parameters.

### Binding from reflection

A host walks `bindGroups` and creates one resource per entry. Three fields carry the
decision.

```ts
import { reachFrom, reflect, stageOf } from '@xgis/shader-dsl'

for (const group of reflect(m).bindGroups) {
  for (const e of group.entries) {
    if (e.owner === 'host') continue // the surrounding renderer allocates this one
    e.resourceKind // 'uniform-buffer' | 'storage-buffer' | 'texture' | 'sampler'
    e.stages // ['fragment'], ordered vertex, fragment, compute
  }
}

// The same reachability question for an entry set you choose yourself:
const reach = reachFrom(m, m.funcs.filter((f) => stageOf(f) === 'fragment'))
reach.bindings // Set { 'U' }, the binding names that stage reads
reach.fns // the call-graph closure from those entries, the entries included
```

`owner` says who owns the resource. It is `'module'` when the module declares the binding
and the host allocates it from this reflection, and `'host'` when the host that owns the
pipeline declares it and its layout is the authority. The list stays complete under both,
because a host still has to know about a binding it owns. `resourceKind` says what to create, and a texture entry
also carries `textureDim` and `textureElem`, the two axes a view and a sample type need,
which [Layouts and resources](/guide/authoring/layouts-and-resources/) covers from the
authoring side. `stages` says which stages reach the binding, which is the visibility mask a
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
import { module, fn, vec2fT, dot, sqrt, compileModule } from '@xgis/shader-dsl'

const len = fn('len', { p: vec2fT }, ({ p }) => sqrt(dot(p, p)))
const m = module({ funcs: [len] })

const cpu = compileModule(m)
cpu.fns.len([3, 4]) // → 5
```

`compileModule` walks the IR node by node on every call. `compileModuleJs(m)` takes the same
arguments and returns the same shape, and it walks each function body once, emits JavaScript
source for it and builds that source with `new Function`. Reach for it when the same module
runs thousands of times, on a per-frame path or across a whole buffer of rows. A body it cannot
generate falls back to the interpreter for that one function, so a module can be part compiled
and part interpreted with no change at the call site. The one case a caller handles is a host
that forbids `eval`, where `new Function` itself throws and `compileModule` is the way through.

### Bindings and calls

A binding is a resource the pipeline supplies: a uniform block, a storage buffer, a texture, a
sampler. The oracle has no GPU memory behind those, so you supply each value with
`setBinding(name, value)` before the first call. The name is the one the declaration carries,
which is the `as` name for a uniform struct and the declared name for a storage buffer or a
`resource`. `reflect(m).bindGroups` lists every binding a host must fill, including the ones a
lowering injects. The oracle asks only for the ones a function it runs actually reads, so a
module with f64 arithmetic needs no value for the injected `_fp64` guard texture that
[fp64](/guide/authoring/fp64/) describes. A binding a function reads and nothing set throws
`shader-dsl/cpu: unbound <name>`.

```ts
import { module, fn, uniformStruct, storageBuffer, f32T, u32T, compileModule } from '@xgis/shader-dsl'

const U = uniformStruct('U', { group: 0, binding: 0, as: 'u' }, { scale: f32T })
const data = storageBuffer('data', f32T, { group: 0, binding: 1, access: 'read' })

const scale_at = fn('scale_at', { i: u32T }, ({ i }) => data.at(i).mul(U.field.scale))
const m = module({ uses: [U, data], funcs: [scale_at] })

const cpu = compileModule(m)
cpu.setBinding('u', { scale: 2 }) // a uniform block: an object keyed by field name
cpu.setBinding('data', [1, 2, 3]) // a buffer: one flat array
cpu.fns.scale_at(2) // → 6
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
import { module, fn, f32T, compileModule } from '@xgis/shader-dsl'

const acc = fn('acc', { a: f32T, b: f32T }, ({ a, b }) => a.add(b))
const m = module({ funcs: [acc] })

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
import { compileModuleJs } from '@xgis/shader-dsl'

// m: the module from the bindings sample above.
const cpu = compileModuleJs(m, { precision: 'f32' })
cpu.setBinding('u', { scale: 2 })
cpu.setBinding('data', Array.from(rows)) // rows: the input the GPU run was given

// gpuOut: the Float32Array read back from that GPU run.
for (let i = 0; i < gpuOut.length; i++) {
  const expected = cpu.fns.scale_at(i) as number
  if (Math.abs(gpuOut[i] - expected) > 1e-6) {
    throw new Error(`row ${i}: GPU ${gpuOut[i]}, CPU ${expected}`)
  }
}
```

### Calls with no CPU meaning

Three things throw when a call reaches them. A `rawStmt` payload is target text the IR never
reads, so it has no evaluation here whichever spelling it carries. A placeholder that no
composer swapped throws with its tag, which localizes the missing splice. The GPU-only
intrinsics have nothing to compute from: the texture reads `textureSample`,
`textureSampleLevel`, `textureLoad` and their array forms, the queries `textureDimensions` and
`textureNumLayers`, and the derivatives `dpdx`, `dpdy` and `fwidth`. The set is exported as
`ORACLE_GPU_STUB_NAMES`.

Compiling with `{ gpuStubs: true }` turns those intrinsics into placeholder values: opaque
black for a texture read, zero for a derivative, a 1 by 1 size for `textureDimensions` and
one layer for `textureNumLayers`. The throw names the intrinsic and that option. Pass it
when a stand-in value is acceptable for the question being asked, such as checking the
geometry a fragment function computes around a sample it does not depend on. The binding
still has to be set, because the module reads the texture and sampler variables before the
call is stubbed.

```ts
import { module, fn, resource, texture2dfT, samplerT, vec2fT, textureSample, compileModule } from '@xgis/shader-dsl'

const tex = resource('tex', texture2dfT, { group: 0, binding: 0 })
const smp = resource('smp', samplerT, { group: 0, binding: 1 })

const shade = fn('shade', { uv: vec2fT }, ({ uv }) => textureSample(tex.node, smp.node, uv), {
  stage: 'fragment',
})
const cpu = compileModule(module({ uses: [tex, smp], funcs: [shade] }), { gpuStubs: true })

cpu.setBinding('tex', 0) // the value is never read under a stub
cpu.setBinding('smp', 0)
cpu.fns.shade([0.5, 0.5]) // → [0, 0, 0, 1]
```

## Diagnostics

After this page you can read a coded error, branch your own code on the code it carries,
get every failure in a module in one report, and print the TypeScript line an error came
from.

A diagnostic is one problem found in one module: the id of the rule that found it, a
severity of error or warning, a message, and when they are available, a stable code, the
function it sits in, a one-line hint and a source location. A thrown error carries the
same `message`, `code`, `hint` and `loc`. A report entry adds the rule id, the severity and
the function it sits in.

### Coded errors

Every coded failure this package raises is a `ShaderDslError`. It carries a `code` from a
frozen catalogue, a composed `message`, and a `hint` where the catalogue has a one-line
remedy for that code. `ValidationError` is a subclass, so one `instanceof ShaderDslError`
handler catches every coded failure.

```ts
import { ShaderDslError, emitModule } from '@xgis/shader-dsl'

try {
  emitModule(buildModule())
} catch (e) {
  if (e instanceof ShaderDslError) console.error(e.code, e.message, e.hint)
  throw e
}
```

Type mismatches surface while you build the module, before any emit call, because the
builders check their operands as they run. Adding a `vec2f` to a `vec3f` throws `SD0002`.
The message opens with the code and the catalogue summary,
`shader-dsl [SD0002]: binary op on mismatched vectors`, then carries the operator and the
two types it was given, `+: vec2<f32> vs vec3<f32>`. Under it comes the hint line,
`both operands must be the same vector type, or one must be a scalar`.

### Branching on a code

The code is the half of an error to write your own code against. Codes are `SD####`
strings from an append-only catalogue and are never renumbered, so a branch on one keeps
working. Messages compose the catalogue summary with the detail of the particular failure
and are free to be reworded, so a branch on message text does not.

```ts
try {
  buildModule()
} catch (e) {
  if (e instanceof ShaderDslError && e.code === 'SD0002') {
    // a binary op on mismatched vectors: report it against the author's own source
    console.error(e.message, e.loc)
  } else throw e
}
```

### Every failure at once

`validate(m)` runs the emit-time rules over an authored module. They include the structural
invariants that hold for every module: no duplicate function or struct name, no binding
collision, every path of a value-returning function returns, no mixed scalar arithmetic,
call sites that match the declarations they call, no two locals in one function sharing a
name. `emitModule` and the GLSL emitters run it first, so a module that breaks one of them
fails at the emit call with a coded error instead of at `createShaderModule` with a driver
message.

`validate` collects every error before it throws. The `ValidationError` it throws renders
them all in its message and carries the array on `.diagnostics`, which is the one to
present in a UI.

```ts
import { emitModule, ValidationError } from '@xgis/shader-dsl'

try {
  emitModule(m)
} catch (e) {
  if (e instanceof ValidationError) {
    for (const d of e.diagnostics) console.error(d.ruleId, d.fn, d.message)
  } else throw e
}
```

A module that declares `ramp` twice and has a `band` function falling out of an `If`
without returning reports both problems in one throw:

```
shader-dsl [SD0020]: module validation failed (2 errors):
  - dup-func: duplicate function 'ramp'
  - all-paths-return (fn band): fn 'band' returns non-void but a code path falls through without return
```

### The diagnose report

`diagnose(m)` is the "what is wrong with this module?" entry. It runs the full lint
ruleset, adds a capability check when you pass a backend, and returns a report of every
diagnostic plus a summary counting them. It never throws and it never changes the module,
so it is safe to call on a module you are about to emit. `formatReport` renders the report
as text. `lintModule(m)` runs the same full ruleset and hands back the diagnostics as a
plain array, with no summary and no capability check.

The full ruleset is wider than the emit-time set: naming, nesting depth, dead bindings,
float equality, single exit, assignment to an immutable binding. Those reach you here and
nowhere else. The last one is the `Let` then `.assign()` mistake, which emits WGSL a driver
rejects, so it is worth a `diagnose` run before you ship a shader.

```ts
import { wgslBackend } from '@xgis/shader-dsl'
import { diagnose, formatReport } from '@xgis/shader-dsl/dev'

const report = diagnose(m, { rules: 'all', backend: wgslBackend })
if (report.summary.errors > 0) console.error(formatReport(report))
```

For a `rim.ts` that binds `edge` with `Let` and assigns to it on line 8, the report opens
with the severity, the code, the rule and the function, then the location:

```
error[SD0107] no-assign-to-let  (fn rim_alpha)
  --> rim.ts:8:14
```

Under those two lines comes the rule's own message, which names the binding and the function
it sits in and says that assigning to a `let` is invalid WGSL, then the hint,
`declare the binding with Var() instead of Let() to mutate it`. The run ends with its
counts, `1 error, 0 warnings`. The path is the one the stack reports for the authoring file,
shortened here.

`rules: 'core'` narrows the run to the same set `validate` uses, and the `backend` option
adds one `SD0030` diagnostic naming every capability the backend cannot cover, which is the
non-throwing twin of the gate `emitModule` runs.

### Source locations

The `-->` line above is the TypeScript that built the offending statement. Capturing it is
off by default, because it costs a stack walk per authored node. With it off no stack is
walked at all, so leaving the switch in place costs nothing. Turn it on for a development
or test run:

```ts
import { setSourceTracing } from '@xgis/shader-dsl/dev'

setSourceTracing(true)
```

Setting `XGIS_SHADER_DSL_TRACE=1` in the environment turns it on for the whole process,
which is the way to get locations out of a test run without editing the test. Locations
never reach the emitted shader: WGSL and GLSL come out byte-identical with tracing on and
with it off. Because capture is optional, `loc` on an error and on a diagnostic is optional
too, so read it as a field that may be absent.

## Conditional programs

After this page you can decide which of several programs to build from one source, tell
when a variant is one constant instead of a different program, hand the choice to a host
that owns the defines, and name the result so a cache cannot serve one variant for
another.

A shader that has to differ by feature, elevation present or absent, 3D or flat, is where a
GLSL codebase reaches for `#define` and a ladder of `#ifdef`. This package has no
preprocessor. A module is an ordinary JavaScript value returned by an ordinary function, so
the thing that varies is a function parameter, and a plain `if` decides what goes into the
IR. The arm that loses is never built, so nothing has to be stripped later, and the
emitted program carries the winning arm's math with no dispatch chain around it.

Three questions hide under "the program changes", and each one has its own answer: the shape
of the program differs, a single value differs, or the choice belongs to the host. A
capability the device may or may not have is a fourth question, and
[Capabilities & extensions](/guide/authoring/capabilities-extensions/) answers it.

### A builder parameter and a plain if

To specialize is to build one program for one set of choices, with the choices made in
TypeScript before the module exists. Write the builder to take the fact and branch on it.

```ts
import { fn, module, f32, resource, samplerT, texture2dfT, textureSample, vec2fT } from '@xgis/shader-dsl'

const dem = resource('dem', texture2dfT, { group: 0, binding: 0 })
const demSampler = resource('dem_sampler', samplerT, { group: 0, binding: 1 })

const buildTerrain = (hasElevation: boolean) => {
  const height = fn('height', { uv: vec2fT }, ({ uv }) =>
    hasElevation ? textureSample(dem.node, demSampler.node, uv).x : f32(0),
  )
  return module({
    bindings: hasElevation ? [dem.binding, demSampler.binding] : [],
    funcs: [height],
  })
}
```

The bindings move with the shape here, and that is the reason to prefer this over a
preprocessor. With `hasElevation` false the elevation texture is never declared, so it is
absent from `reflect()`, absent from the bind group layout, and the host creates no
resource for it. An `#ifdef` leaves the declaration in the source and leaves the layout to
be kept in sync by hand, which is how a disabled feature still costs a binding slot.

Some choices cannot be made until draw time. Those stay as a runtime branch, and `when`
gives you a value picked by a condition the GPU evaluates. Specializing is for a choice you
already know while you build.

### Statement slots with composeModule

Variants sometimes share a whole module and differ in one run of statements inside one
function. Mark the seam with `b.placeholder('tag')` in the base module and fill it per
variant with `composeModule`. A placeholder is a marker statement carrying a tag, and a
swap is the list of statements that replaces it.

```ts
import { composeModule, fn, module, vec4, vec4fT, type Stmt } from '@xgis/shader-dsl'

const base = module({
  funcs: [
    fn('fill_color', {}, vec4fT, (_p, b) => {
      b.placeholder('fill')
    }),
  ],
})

const solid: Stmt[] = [{ s: 'return', expr: vec4(1, 0, 0, 1).expr }]
const composed = composeModule(base, { fill: solid })
```

`composeModule` descends into `if`, `for` and `switch` bodies, and returns a new module
with the function bodies rewritten and everything else carried through. It fills statement
slots, so it contributes no consts, structs or bindings, and it is no substitute for an
`#include`. Its reference page covers what it does with a slot you left unfilled and with a
swap key that matches no placeholder.

### A value that differs with override

If every variant would emit the same program with one constant changed, specializing
multiplies pipelines for nothing. Declare a specialization constant instead, with
`overrideConst`. A specialization constant is a module-scope value whose read stays
symbolic through every DSL pass and is pinned by the host when it creates the pipeline.

```ts
import { f32, f32T, If, Var, fn, module, overrideConst } from '@xgis/shader-dsl'

const quality = overrideConst('quality', f32T, 1.0)

const shade = fn('shade', { base: f32T }, ({ base }) => {
  const acc = Var(base)
  If(quality.node.gt(f32(1)), () => {
    acc.assign(acc.mul(f32(2)).add(f32(0.5)))
  })
  return acc
})

const m = module({ overrides: [quality.decl], funcs: [shade] })
```

WGSL emits `override quality: f32 = 1.0;` and the host pins it through the pipeline's
`constants`. GLSL ES 3.00 has no driver-side equivalent, so the backend emits a default
that lets the module compile on its own, and a host that wants another value re-emits
with `emitGlslModule(m, 'fragment', { overrideValues: { quality: 2 } })`. Both host shapes
read the set of constants to supply from `reflect().overrides`.

Because the read stays opaque to the optimizer, the branch above survives every pass and
the driver removes it per pipeline variant, which is the classic ubershader mechanism. The
rule of thumb: if two variants would compile to the same instruction sequence with one
literal changed, that is an override; if they compile to different code, that is a
build-time parameter.

### Axes the host decides

An axis is one thing the program varies on, together with the list of values it can take.
One point in the axis space is a variant. When the host picks the point at runtime, from
state you do not own, the matrix itself becomes the authored thing: `variantFamily` takes
the axes, a builder for one point, and a key derivation, and builds every point.

```ts
import { fn, f32T, module, variantFamily } from '@xgis/shader-dsl'

const family = variantFamily({
  axes: { quality: ['low', 'high'] },
  build: ({ quality }) =>
    module({
      funcs: [fn('shade', { x: f32T }, ({ x }) => (quality === 'high' ? x.mul(2).add(0.5) : x))],
    }),
  key: ({ quality }) => `shade:${quality}`,
})

family.keys // ['shade:low', 'shade:high']
family.emit('wgsl') // Map { 'shade:low' => '…', 'shade:high' => '…' }
family.get('shade:high')?.reflection // that variant's own reflection
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
artifact that serves bytes without running the builder. The key takes the same facts the
builder takes.

```ts
const keyFor = (hasElevation: boolean, method: number) =>
  `${hasElevation ? 'dem' : 'flat'}:${method}`
```

The failure a short key causes carries no error. A key that names less than the builder
reads hands one variant's compiled shader to another variant's draw: it compiles, it links,
it renders, and the pixels are wrong. If you add an axis to a builder, add it to the key in
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

A module lists the features it needs in `enables`:

```ts
module({ enables: ['floatRenderTarget'], funcs: [vs, fs] })
```

The vocabulary is fixed and target-neutral, so a raw `EXT_*` or `OVR_*` string never appears
in a module. Each id folds into the capability gate that runs before any writer touches the
module, so a backend that cannot spell the feature throws `UnsupportedFeatureError`
(`SD0030`) naming the capability, and no source the driver would reject is ever produced.

### What each id needs per target

Two different costs hide behind one id. A *host feature* is something the host must activate
before it creates a pipeline: `gl.getExtension('EXT_color_buffer_float')` on WebGL2, a
`requiredFeatures` entry on WebGPU. A *source directive* is a token the emitted shader
itself must carry, `#extension … : require` on GLSL ES 3.00 and `enable …;` on WGSL, which
the backend writes for you, deduped and sorted, right after the `#version` line on GLSL and
ahead of the declarations on WGSL.

A capability can need either half, both halves, or neither.

| `enables` id | WebGL2 and GLSL ES 3.00 | WebGPU and WGSL |
| --- | --- | --- |
| `floatRenderTarget` | host feature `EXT_color_buffer_float` | core, nothing to request |
| `float32Blend` | host feature `EXT_float_blend` | host feature `float32-blendable` |
| `float32Filterable` | host feature `OES_texture_float_linear` | host feature `float32-filterable` |
| `multiview` | directive `GL_OVR_multiview2` and host feature `OVR_multiview2` | unsupported, fails closed |
| `f16` | unsupported, fails closed | directive `f16` and host feature `shader-f16` |
| `subgroups` | unsupported, fails closed | directive `subgroups` and host feature `subgroups` |

A capability with a host half and no source half costs zero emitted bytes: declaring it
moves no byte of the shader. The `32` in `float32Blend` and `float32Filterable` is
load-bearing, because both underlying features are 32-bit float only, while
`EXT_color_buffer_float` covers 16-bit and 32-bit targets, which is why `floatRenderTarget`
carries no bit width.

`capabilityMatrix` reports the same information as data, derived from the backends
themselves, so a tool or a page can print it without transcribing it:

```ts
capabilityMatrix([wgslBackend, glslEs300Backend])
// → [{ capability: 'storageBuffer', support: { wgsl: 'native', 'glsl-es300': 'unsupported' },
//      declarable: false },
//     …,
//     { capability: 'f16', support: { wgsl: 'directive', 'glsl-es300': 'unsupported' },
//      declarable: true }]
```

The result has one row per capability, in a fixed order, including the three a module never
declares, which come back with `declarable: false`.

Two notes before you trust a row.

- Support is not the same as reachability. `f16`, `subgroups` and `multiview` are supported
  on the target the table says, and none of the three is authorable today, because there is
  no `f16` scalar type, no subgroup intrinsic, and no way to spell
  `layout(num_views = N) in;` or read `gl_ViewID_OVR`. A module declaring `multiview` emits
  the directive and renders single-view.
- An unsupported cell is a hard stop by design: the emit throws. To ask before you emit,
  `diagnose(m, { backend })` reports the same missing capability as an `SD0030` diagnostic
  and never throws.

### Derived and implied capabilities

Three capabilities are derived, which means they are read off the module's shape and never
declared. A storage binding implies `storageBuffer`, a compute entry implies `compute`, and
a multisampled texture load implies `msaaTextureLoad`. `enables` is typed to exclude those
three, so naming one is a compile error.

One capability can also imply another. `float32Blend` pulls in `floatRenderTarget`, because
blending into a float target needs that target to be renderable as a colour attachment
first, and with only `EXT_float_blend` active the framebuffer comes back incomplete.
`reflect().requiredFeatures` reports the closure, so a module that declares one gets both:

```ts
const m = module({ enables: ['float32Blend'], funcs: [vs, fs] })
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
import { hostFeaturesFor, reflect, glslEs300Backend, wgslBackend } from '@xgis/shader-dsl'

// WebGL2: verify the already-booted context has each extension.
for (const ext of hostFeaturesFor(glslEs300Backend, reflect(m).requiredFeatures)) {
  if (!gl.getExtension(ext)) throw new Error(`WebGL2 lacks ${ext}`)
}

// WebGPU: feed the same lookup into requestDevice, at boot.
const device = await adapter.requestDevice({
  requiredFeatures: hostFeaturesFor(wgslBackend, reflect(m).requiredFeatures),
})
```

### Choosing between two modules

`enables` states a hard requirement, so it is the wrong tool for a feature you can live
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

A compute entry declared `portable: true` emits on both backends: natively as `@compute` on
WGSL, and on GLSL ES 3.00 through a compute-to-fragment lowering that runs with no emit
option. In exchange the kernel stays inside a gather-only tier, where every invocation reads
what it likes and writes one element at its own index.

```ts
const dispatch = resource('dispatch', vec4uT, { group: 0, binding: 0 })
const field = storageBuffer('field', f32T, { group: 0, binding: 1, access: 'read' })
const outColor = storageBuffer('out_color', u32T, { group: 0, binding: 2, access: 'read_write' })

const kernel = fn(
  'eval_field',
  { gid: builtin('global_invocation_id', vec3uT) },
  voidT,
  ({ gid }) => {
    const fid = gid.x
    If(fid.ge(dispatch.node.x), () => {
      Return()
    })
    outColor.at(fid).assign(pack4x8unorm(vec4(field.at(fid), 0, 0, 1)))
  },
  { stage: 'compute', workgroupSize: 64, portable: true },
)

const m = module({
  bindings: [dispatch.binding, field.binding, outColor.binding],
  funcs: [kernel],
})
```

The tier is exactly this shape:

- `global_invocation_id` is read as `.x` alone, the 1-D linear invocation index.
- Exactly one `read_write` storage binding whose elements are `u32`, so its type is
  `array<u32>`, written exactly once at index `gid.x`. A scatter write, a second write, or
  zero writes fails.
- The first `uniform` binding must be `vec4<u32>`, the dispatch uniform, whose `.x` is the
  invocation count and whose `.y` is the output-grid width. The other two components are
  reserved. First means first in the module's `bindings` list, so declaration order matters.
- No `raw` statements anywhere the entry's call graph reaches, since per-target text
  contradicts the portability claim.

Anything outside that shape fails validation at every emit on both writers, with `SD0111`
and a remedy per violation. Declaring `portable` on an entry that is not compute fails at
build time with `SD0110`.

The lowering changes how the kernel is dispatched as well as how it is emitted: on WebGL2
the host submits a fullscreen draw into an R32UI target in place of a compute dispatch.
Declaring `portable` is what lets a WebGL2 host recognize the kernel as eligible for that
path.

Barriers, workgroup memory, atomics, scatter writes and multi-output kernels are outside the
tier. A kernel that needs one of them stays WebGPU-only, so omit `portable`, or restructure
the work into several gather-only passes.

## fp64

After this page you can declare a double-precision value in a shader, know which operations
it supports, and bind the guard texture the emulation needs.

A GPU has no 64-bit float type. In this package `f64` is emulated: one value is a pair of
`f32` numbers, a high part and a low part, and the number is their unevaluated sum. That
gives about 48 bits of significand, the fraction bits that decide how many digits a value
keeps, over the ordinary f32 exponent range. A value near 1e8, a position in world units
for one, where one f32 step is already 8 units, still resolves detail far below one unit. The authoring surface is
the same as f32, and only the declared type differs. Before emit, the `fp64Lower` pass
rewrites every f64 into a `vec2<f32>` and injects the emulation functions the shader now
calls. WGSL, GLSL and the CPU oracle agree on the results.

### Declaring an f64 value

Write `f64T` where you would write `f32T`: in a uniform field, in an `fn` parameter, in a
local. The arithmetic methods, the comparisons and the builtins keep their spelling, so a
body converted from f32 usually changes only in its signature.

```ts
import { f32T, f64T, fn, module, sqrt, toF32, uniformStruct } from '@xgis/shader-dsl'

const U = uniformStruct(
  'U',
  { group: 0, binding: 0, as: 'u' },
  {
    origin: f64T, // one vec2<f32> slot: the host packs splitF64(value)
  },
)

const k = fn('k', { x: f64T, s: f32T }, (p) => toF32(sqrt(p.x.add(U.field.origin).mul(p.s))))
const m = module({ funcs: [k], uses: [U] })
```

Nothing on the module announces fp64. The lowering pass finds the f64 types itself.

### Conversions

An f32 widens to f64 implicitly inside arithmetic, and the widen is exact. `toF64(x)` is the
explicit spelling of that same widen. A JavaScript number is already a double, so
`f64(1e-9)`, or the bare `1e-9` in f64 arithmetic, splits the literal into its pair at build
time with nothing lost. `f64FromParts(hi, lo)` assembles a value from two f32 halves that
arrive already split, a vertex attribute pair for instance. Narrowing is always explicit:
`toF32(x)` adds the two halves back together and gives an f32, losing the extra precision.
Mixing an f64 with an integer or a boolean is an author-time `SD0004`.

```ts
import { f32T, f64, f64FromParts, fn, toF32, toF64 } from '@xgis/shader-dsl'

const g = fn('g', { a: f32T, hi: f32T, lo: f32T }, (p) => {
  const widened = toF64(p.a) // exact
  const lit = f64(1e-9) // split at build time
  const rebuilt = f64FromParts(p.hi, p.lo) // two lanes that were split by the host
  return toF32(widened.add(lit).add(rebuilt)) // the explicit narrow
})
```

### The operations f64 supports

The four arithmetic operations, every comparison, `neg`, `abs`, `min`, `max`, `sqrt`, `mix`
with an f32 interpolant, `floor`, `fract`, `sin` and `cos` accept f64 operands. Anything else
on an f64 operand fails at emit with `SD0041`, so narrow the value with `toF32` first and
finish that part of the computation in f32. `%` and the bitwise operators are refused
earlier, at author time. `sin` and `cos` are less accurate than the arithmetic around them.
Relative error for the transcendental itself floors at about 2^-36, and it grows with the
size of the argument through the range reduction.

```ts
import { f64, f64T, floor, fn, min, toF32 } from '@xgis/shader-dsl'

// A triangle wave on a coordinate that has outgrown f32.
const stripe = fn('stripe', { x: f64T }, (p) => {
  const y = p.x.mul(0.5)
  const f = y.sub(floor(y))
  return toF32(min(f, f64(1).sub(f)))
})
```

### The guard texture

A shader compiler may reassociate float arithmetic, and reassociation deletes exactly the
small correction terms this emulation is built on. Every emitted helper therefore threads a
value the compiler cannot see through those terms: a 1 read from a texture. Any module that
does f64 arithmetic gets a `texture_2d<f32>` binding named `_fp64` injected for it, at group
0 and the first free binding, and it appears in `reflect()` as an ordinary 2D texture. The
host binds a 1 by 1 texture whose texel reads exactly 1.0, white RGBA8 or R32F holding 1.0.
The value lives in a texture because some drivers specialize a pipeline on the uniform
values they observe and re-optimize it, which folds the correction terms away again; no
compiler treats a texel as a constant.

Two things to do at the host. If the bind group layout is fixed, pin the slot with
`fp64Guard({ group, binding })` in the module's `uses`. And on Apple GPUs the guard is not
enough, because the platform's default fast math collapses the float lowering anyway. Pass
whatever device signals you have to `recommendFp64Flavor` and hand the result to the emit
as `fp64Flavor`; on those devices it selects an integer lowering, which needs no guard
binding at all.

```ts
// `k` and `U` are the function and the uniform struct from the first example.
import { emitModule, fp64Guard, module, recommendFp64Flavor } from '@xgis/shader-dsl'

const pinned = module({ funcs: [k], uses: [U, fp64Guard({ group: 0, binding: 3 })] })

const flavor = recommendFp64Flavor({ userAgent: navigator.userAgent })
const wgsl = emitModule(pinned, { fp64Flavor: flavor })
```

The emulation owns two name spaces in the emitted shader. A function name starting with
`df64_`, or a struct name starting with `DF64Vec` or `DF64Mat`, fails emit with `SD0043`.

### Packing and layout

An f64 uniform field or vertex attribute occupies one plain `vec2<f32>` slot, size 8 and
align 8. Pack it on the host with `splitF64(x)`, which returns the `[hi, lo]` pair in the
order the shader reads it. A value interpolated from the vertex stage to the fragment stage,
a varying, cannot be f64: that is `SD0044`, because interpolating a hi/lo pair across a
triangle is numerically wrong. Interpolate an f32 quantity instead, or carry the value in a
uniform and do the f64 arithmetic in the fragment stage.

```ts
import { splitF64 } from '@xgis/shader-dsl'

const [hi, lo] = splitF64(-8_234_567.890123)
new Float32Array(uniformBuffer, 0, 2).set([hi, lo])
```

### Vectors

`vec2f64T`, `vec3f64T` and `vec4f64T` are the vector types, built with `vec2f64(x, y)` and
its siblings. Components, swizzles, componentwise arithmetic with f64, f32 and number
broadcast, the componentwise builtins `abs`, `min`, `max`, `mix`, `floor`, `fract`, `sin`,
`cos` and `normalize`, and the reductions `dot`, `length` and `distance`, which give back an
f64, all read the same as their f32 counterparts. Anything outside that list is `SD0041`
again, so narrow one component at a time with `toF32(v.x)`. A vector lowers to a struct holding a
hi plane and a lo plane, so componentwise work runs once for the whole vector.

```ts
import { dot, f64T, fn, toF32, uniformStruct, vec2f64, vec2f64T } from '@xgis/shader-dsl'

const P = uniformStruct('P', { group: 0, binding: 1, as: 'p' }, { center: vec2f64T })

const d = fn('d', { x: f64T, y: f64T }, (p) => {
  const q = vec2f64(p.x, p.y).sub(P.field.center)
  return toF32(dot(q, q)) // the subtraction and the dot both run in f64
})
```

A vector uniform field takes its struct layout: 16 bytes for two components, 32 bytes for
three or four under std140. A vector vertex attribute is rejected. Pass hi and lo as two
`vecN<f32>` locations and rebuild each lane with `f64FromParts`.

### What it costs

One f64 operation is several f32 operations, ten or more for a multiply or an add. So opt in
per value: hold the coordinates that need the range in f64, narrow as soon as the difference
is small enough for f32, and let the rest of the shader run at f32 speed.

```ts
import { f64T, fn, toF32 } from '@xgis/shader-dsl'

// The subtraction needs the range; the shading after it does not.
const shade = fn('shade', { world: f64T, camera: f64T }, (p) =>
  toF32(p.world.sub(p.camera)).mul(0.5).add(0.5),
)
```

One example in the gallery, `examples/fp64-deep-zoom.ts`, runs one formula on both types
side by side, and shows the f32 half collapsing to a flat field while the f64 half keeps
its stripes.

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
import { emitGlslModule } from '@xgis/shader-dsl'

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
import { emitGlslModule } from '@xgis/shader-dsl'

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
import { emitGlslModule } from '@xgis/shader-dsl'

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
on their own subpath, `@xgis/shader-dsl/emit-prod`, so a build that never imports it
bundles none of them and a plain emit call keeps the bytes it has.

### The plugin bag

An emit plugin is an `EmitPlugin`, a named transform you pass to an emit call, the way a
Vite or Webpack plugin is passed to a build. Both `emitModule` and `emitGlslModule` take a
`plugins` array in their options. A plugin acts in one of two stages: `transformIR`
rewrites the module before it is assembled, `transformText` rewrites the emitted string.
Every IR stage runs before any text stage, and within a stage they run in array order.

```ts
import { emitModule, emitGlslModule } from '@xgis/shader-dsl'
import { mangle, minify, obfuscate } from '@xgis/shader-dsl/emit-prod'

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
parens. The default `'full'` leaves every emitted byte alone.

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

renames.get('terrain_shade') // 'b'
renames.get('noise.coordinate') // 'f'; a function-scoped key is `authoredFn.authoredName`
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
backend did not author: a `raw` body, or a fragment a host splices in.

```ts
import { aliasTypes, minify, minifyShaderText, prune } from '@xgis/shader-dsl/emit-prod'

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
one decision per helper considered.

```ts
import { inline, obfuscate, type InlineDecision } from '@xgis/shader-dsl/emit-prod'

const decisions: InlineDecision[] = []
const wgsl = emitModule(m, {
  parens: 'minimal',
  plugins: [inline({ opaque: 'all', maxGrowth: 4, report: decisions }), ...obfuscate()],
})

decisions[0] // { fn, callSites, ops, growth, inlined, reason: 'inlined' | 'over-budget' | 'not-inlinable' }
```

### Decoding a driver log

The shipped text is unreadable on purpose, so a driver error reads
`no matching overload in 'b' for arg of type 'l'`. `decodeShaderLog(log, renames)` turns
that back into authored names. Substitution is token-wise, so the driver's own prose, its
line numbers and its source excerpts are untouched, and a short name inside a longer word is
never a hit. Decoding is a build-time step, so the decoder and the map both stay on the
`emit-prod` subpath and out of the shipped bundle.

A name that inverts uniquely is replaced, which covers module-scope names and type
aliases, the ones a driver actually names. A function-scoped name is reused across
functions on purpose, so one that inverts to several candidates is annotated with all of
them. `invertRenames(renames)` hands you the table as data.

```ts
import { decodeShaderLog, invertRenames } from '@xgis/shader-dsl/emit-prod'

decodeShaderLog("no matching overload in 'b' for arg of type 'l'", renames)
// "no matching overload in 'terrain_shade' for arg of type 'vec2<f32>'"

decodeShaderLog('undeclared identifier f', renames)
// 'undeclared identifier f⟨coordinate (in noise) | tint (in shade)⟩'

invertRenames(renames).get('b') // { emitted: 'b', authored: ['terrain_shade'] }
```

### Names that are never renamed

Some names are the interface a host resolves at run time, so mangling them would break the
binding. Five kinds are left alone. Entry-point names, because a WebGPU pipeline names its
`entryPoint`. Entry-point parameter names, because a non-struct entry parameter is the GLSL
varying name, and the vertex side spells that varying from its return struct's field name in
a separate emit call. Binding names, including the `_fp64` guard, because hosts resolve them
by name. Binding-struct names, because that is the GLSL uniform block tag. Struct field
names, because they carry std140 packing and because GLSL varyings link the two stages by
name. A module that holds a `raw` statement is left unmangled altogether, which
[Raw statements](/guide/authoring/raw-statements/) explains.

```ts
const renames = new Map<string, string>()
emitModule(m, { parens: 'minimal', plugins: obfuscate({ renames }) })

renames.get('terrain_shade') // 'b', a helper function
renames.get('vec2<f32>') // 'l', a type alias
renames.has('U') // false; a binding name a host resolves
renames.has('fs') // false; an entry-point name a pipeline names
```

### Proving the shipped module is the one you tested

`semanticDiff(dev, prod)` reports the differences between two modules in four buckets, and
a production pipeline moves lines into some of them by design. Hand it the same plugin
array as `transforms` and every difference your declared pipeline provably causes is
classified out of those buckets into `explained`, each entry naming the plugin, the bucket
and the fact line.

```ts
import { isSemanticallyEqual, semanticDiff } from '@xgis/shader-dsl'

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
plain emit from 175,673 characters to 93,490, and two gates hold it to its properties.
`examples/minify-safety.test.ts` asserts that the lexed token stream and every literal's
f32 value survive minification and that the pass is idempotent.
`examples/reserved-word-safety.test.ts` runs the corpus through `obfuscate()` and through
`[inline(), ...obfuscate()]` and asserts that neither plugin invents a name either
language reserves.

## Raw statements

After this page you can splice a hand-written statement into a module and know what that
statement costs you on each target.

A raw statement is a string the DSL writes into a function body without reading it. Reach
for one when a statement has to be hand-written, when it arrives pre-built from another
generator, or when it uses a construct the IR does not model. Everything else on this page
follows from one fact: to the compiler that string is opaque bytes.

### A spelling per target

A payload is the `{ wgsl, glsl }` object you hand to `rawStmt`, one spelling per target.
`rawStmt` returns a statement node you can drop into a body array:

```ts
import { rawStmt, vec4fT, type FuncDecl } from '@xgis/shader-dsl'

const PAIRED = rawStmt({
  wgsl: 'return vec4<f32>(1.0, 0.0, 0.0, 1.0);',
  glsl: 'return vec4(1.0, 0.0, 0.0, 1.0);',
})

const fs: FuncDecl = {
  name: 'fs_main',
  attrs: ['@fragment'],
  stage: 'fragment',
  params: [],
  ret: vec4fT,
  retAttr: '@location(0)',
  body: [PAIRED],
}
```

The meaning of a raw is fixed, which is "put these bytes here". Only the spelling is per
target. `emitModule` writes the `wgsl` string and `emitGlslModule` writes the `glsl`
string, each one verbatim, and neither writer ever emits the other's side.

### Inside an fn body

A `fn` body is assembled by a builder, so splice a raw there with `b.raw(payload)`. The
builder is the second argument the body receives:

```ts
import { fn, voidT } from '@xgis/shader-dsl'

const seed_lane = fn('seed_lane', {}, voidT, (_p, b) => {
  b.raw({ wgsl: 'let _k = 1.0;', glsl: 'float _k = 1.0;' })
})
```

A bare `rawStmt(...)` call inside a `fn` body is a discarded expression: it builds a node,
nobody pushes it, and nothing is emitted. Use the free factory when you assemble a
`Stmt[]` array by hand, as the first sample does, and `b.raw` everywhere else. `b.raw`
goes through the same push path as every other statement, so it records a source location
like the rest of the body.

### A missing side fails closed

At least one side is required at the type level, so `rawStmt({})` is a compile error.
Supplying only one side is allowed, and it is a decision: this module does not build for
the other target. A backend handed a raw with no spelling for its own target throws
`UnsupportedFeatureError`, coded SD0030. The message names the spelling that is missing
and quotes the side you did give, so the error points at the statement to port.

```ts
import { emitGlslModule, emitModule, fn, module, vec4, vec4fT } from '@xgis/shader-dsl'

const fs = fn(
  'fs_main',
  {},
  vec4fT,
  (_p, b) => {
    b.raw({ glsl: 'gl_FragDepth = 0.5;' })
    return vec4(1, 0, 0, 1)
  },
  { stage: 'fragment' },
)

const m = module({ funcs: [fs] })

emitGlslModule(m, 'fragment') // splices the glsl spelling verbatim
emitModule(m) // throws UnsupportedFeatureError (SD0030)
```

This is the shape to use when you ship WebGL2 today and may add WebGPU later. The GLSL
build keeps working, and the day someone runs the WGSL writer it stops at the first raw
that has no wgsl spelling, naming the statement to port. Supply every spelling the module
must build for, and the question never comes up.

### Indentation and identifiers

Two things about the text itself are yours to get right.

The writer prepends the enclosing body indent to the spelling as a whole, so only the
first line of a multi-line spelling is indented and every later line lands at column 0.
Indent the continuation lines yourself when the shape of the emitted source matters:

```ts
b.raw({
  wgsl: 'if (t > 1.0) {\n    t = 1.0;\n  }',
  glsl: 'if (t > 1.0) {\n    t = 1.0;\n  }',
})
```

Identifiers inside a spelling are also yours to keep valid, because nothing reads into the
string and so nothing rewrites it. The GLSL backend renames params and locals whose names
collide with a GLSL reserved word, `in`, `sample`, `filter` and `texture` among them, so a
`glsl` spelling that names one of those refers to a variable the emitted stage no longer
has. The WGSL side has no such renamer, so only the GLSL spelling is exposed to it, even
though the contract is the same in both directions. Read the emitted source once after you
add a raw that mentions a name from the surrounding body.

### What a raw statement turns off

Three things a module gives up, module wide, from a single raw anywhere in it.

The identifier mangler declines to run. `mangle()`, from
[Production emit](/guide/authoring/production-emit/), shortens helper, struct and const
names and hands back a map from authored names to emitted ones. Given a module that holds a
raw, it returns the module unchanged and an empty map, because renaming around text it
cannot read would desync the splice:

```ts
import { emitModule, f32T, fn, module, vec4, vec4fT } from '@xgis/shader-dsl'
import { mangle } from '@xgis/shader-dsl/emit-prod'

const shade = fn('shade_pixel', { x: f32T }, vec4fT, (p) => vec4(p.x, 0, 0, 1))

const fs = fn(
  'fs_main',
  {},
  vec4fT,
  (_p, b) => {
    b.raw({ wgsl: 'let _k = 1.0;', glsl: 'float _k = 1.0;' })
    return shade(0.5)
  },
  { stage: 'fragment' },
)

const renames = new Map<string, string>()
const wgsl = emitModule(module({ funcs: [shade, fs] }), { plugins: [mangle({ renames })] })
// The module holds a raw, so `shade_pixel` keeps its authored name and renames is empty.
```

GLSL stage scoping switches off. The GLSL backend normally emits into a stage only the
functions that stage can reach. Raw text is opaque to that reference walk, so the filter
bails for the whole module and every helper is emitted into every stage. A helper the
entry never calls therefore still reaches the writer, and a raw in it with no `glsl`
spelling still fails the whole GLSL emit. The sharper consequence is that fragment-only
machinery in any helper, `dpdx`, `dpdy`, `fwidth` and `discard`, is emitted into the vertex
stage as well, where it does not compile. Keep a raw-carrying module clear of such
helpers, or move the raw into a module of its own. Entry points of the other stage are
still dropped before the body walk, so enforcement stays per stage: a raw with no `glsl`
spelling fails each stage whose emitted function set contains it.

[The CPU oracle](/guide/authoring/the-cpu-oracle/) stops at the raw. `compileModule` accepts
the module and hands back a function per fn, and the oracle has no evaluation for raw text,
so calling a function whose body holds one throws. Other functions in the same module still
run. If one function needs both a raw and an oracle check, split it: keep the arithmetic in
a function the oracle can run and put the raw in a caller.

## Migrating a GLSL shader

After this page you can take the GLSL construct in front of you, look up how it is spelled
in the DSL, and see what that spelling turns into on each target. The rest of this guide is
ordered for someone writing a new shader. This page is ordered for someone holding a
working GLSL ES 3.00 shader and asking what each line becomes.

### The construct table

A construct here is one piece of GLSL source you have to account for: a uniform block, a
preprocessor branch, an `#include`, an extension directive. Find the row, follow the
spelling to the page that explains it, and read the note for what changes.

| GLSL construct | DSL spelling | WGSL result | Notes |
| --- | --- | --- | --- |
| `uniform Block { … }` that this module owns | [`uniformStruct`](/guide/authoring/layouts-and-resources/) | `@group`/`@binding` `var<uniform>` | the std140 layout comes from `reflect()`, so no offset is counted by hand |
| `uniform float u_x;` that the host prelude already declares | `externVar` | the same reference, spelled per target | emits nothing, and lands in `reflect().requires` |
| `uniform float u_x;` that this module declares and the host owns | `hostUniform` | `@group`/`@binding` `var<uniform>` | GLSL emits a loose default-block uniform instead of a block, and `reflect()` marks it `owner: 'host'` |
| a whole block the host owns | `hostBlock` | one `@group`/`@binding` `var<uniform>` | `glsl: 'loose'` flattens it to one uniform per member and rewrites `blk.field` to `field` on the IR. The default `'std140-block'` keeps the block. WGSL keeps the block either way, because a host bind group is one unit |
| a function the host provides | `externFn` | the same call on both targets | typed at the call site, with no declaration emitted |
| `#ifdef FEATURE` where this module decides | [a builder parameter and a plain `if`](/guide/authoring/conditional-programs/) | no preprocessor | the losing arm is never built, so its bindings are never declared |
| `#ifdef FEATURE` where the host decides | [`variantFamily`](/guide/authoring/conditional-programs/) | one module per point in the matrix | `emitGuarded` generates the `#if` ladder for a GLSL host that owns the define, and every arm is byte-identical to the standalone variant. For a ladder that goes inside an `#include`, `emitGuardedFragment` returns the same ladder with the preamble as data |
| a variant that changes only a value | [`overrideConst` with `overrideValues`](/guide/authoring/conditional-programs/) | `override` plus pipeline constants | building a separate variant for this multiplies pipelines for nothing |
| `#include "helper.glsl"` | [`emitGlslFragment` and `emitFragment`](/guide/authoring/emitting-and-reflection/) | a module fragment the host concatenates | the header comes back as `preamble`, as data |
| a statement-level variant slot inside one module | [`composeModule` with `placeholder`](/guide/authoring/conditional-programs/) | the same | statement slots only, so it does not replace an `#include` |
| `precision highp …` on one declaration | the `precision` option on `hostUniform` | nothing, since WGSL has no precision qualifiers | the [stage preamble](/guide/authoring/glsl-float-precision/) is the default. This option is for a fragment composed into a host program |
| `usampler2D` and `isampler2D` | [`texture2duT` and `texture2diT`](/guide/authoring/layouts-and-resources/) | `texture_2d<u32>` and `texture_2d<i32>` | the sampler precision line is emitted for you |
| `#extension … : require` | [`enables`](/guide/authoring/capabilities-extensions/) | `enable …;` | fails closed with SD0030 on a backend whose profile has no row. That page also says which capabilities survive on WGSL |
| comparing two emits after an optimizer pass | [`semanticDiff`](/guide/authoring/production-emit/) | the same | compares IR and reflection, so folding and renaming do not drown the diff. Declare the production plugins as `transforms` and their rewrites classify into `explained` |

A block this module owns is the most common first row. `uniformStruct` takes the WGSL type
name, the slot, and the field map, and gives back typed field access:

```ts
import { mat4x4fT, uniformStruct, vec2fT } from '@xgis/shader-dsl'

// uniform Camera { mat4 u_matrix; vec2 u_viewport_px; } u_camera;
const camera = uniformStruct(
  'Camera',
  { group: 0, binding: 0, as: 'u_camera' },
  { u_matrix: mat4x4fT, u_viewport_px: vec2fT },
)

const mvp = camera.field.u_matrix
```

### Builtin values

A builtin is a value the hardware supplies to a stage. The DSL's vocabulary for them is
WGSL's, typed as the closed union `WgslBuiltinName`, so a `gl_*` spelling or a typo is a
`tsc` error that names the union. Each backend then spells the id its own way.

| GLSL global | DSL spelling | Notes |
| --- | --- | --- |
| `gl_Position` | `builtin('position', vec4fT)` on the vertex output | writes `gl_Position` on GLSL |
| `gl_FragCoord` | `builtin('position', vec4fT)` on a fragment input | reads `gl_FragCoord` on GLSL. Mind the y origin: GL window space is bottom-left and WGSL framebuffer space is top-left, so flip per target, or derive a y-symmetric value, before consuming `.y` |
| `gl_VertexID` | `builtin('vertex_index', u32T)` | GLSL wraps the read as `uint(gl_VertexID)`, since the DSL types it u32 and GLSL's is int |
| `gl_InstanceID` | `builtin('instance_index', u32T)` | the same `uint()` wrap |
| `gl_FrontFacing` | `builtin('front_facing', boolT)` | |
| `gl_FragDepth` | `builtin('frag_depth', f32T)` as the return attribute | |
| `gl_PointSize` and `gl_PointCoord` | unsupported on both writers | point size caps vary per vendor, and WebGPU point primitives are always one pixel. Expand an instanced quad in the vertex stage and interpolate a `@location(n)` corner uv |
| float `mod(x, y)` | the free function `mod()` | that is floor-mod. `.mod()` and `%` are trunc-mod, which is WGSL's semantics and spells portably on GLSL too. Pick by the semantics you mean on negative operands |

A fragment stage reads the framebuffer coordinate through the same `position` builtin the
vertex stage writes:

```ts
import { builtin, f32, fn, vec4, vec4fT } from '@xgis/shader-dsl'

const fsCoord = fn(
  'fs_coord',
  { pos: builtin('position', vec4fT) },
  (p) => vec4(p.pos.x.mul(0.001), p.pos.y.mul(0.001), f32(0), f32(1)),
  { stage: 'fragment', retAttr: '@location(0)' },
)
```

### Declarations the host owns

Four of the rows above are about the same question, which is who declares a symbol and who
owns the memory behind it. `externVar` is for a symbol the host prelude already declares. It
emits nothing, gives you a typed reference, and takes a per-target `spelling` so a move to a
host that exposes the value differently is a map change. `externFn` forward-declares a
callable whose body is defined elsewhere and linked in at emit, so the call is typed and no
declaration is emitted. `hostUniform` and `hostBlock` are for symbols this module declares
while the host owns the storage, so they do emit a declaration and mark it `owner: 'host'` in
reflection.

`hostBlock` also carries the choice a GLSL host forces, since a prelude provides either a
std140 block or loose uniforms and the wrong one will not link:

```ts
import { hostBlock, mat4x4fT, vec2fT } from '@xgis/shader-dsl'

const camera = hostBlock(
  'CameraUniforms',
  { group: 0, binding: 0, as: 'u_camera' },
  { u_matrix: mat4x4fT, u_viewport_px: vec2fT },
  { glsl: 'loose' },
)

camera.field.u_matrix // emits `u_matrix` on GLSL, `u_camera.u_matrix` on WGSL
```

The rewrite from `u_camera.u_matrix` to `u_matrix` happens on the IR before emit, so it
cannot corrupt an unrelated substring, it survives `minify()`, and `reflect()` still
describes what was emitted. A loose block's members must be scalars, vectors or matrices, and
`hostBlock` throws SD0016 as you declare one that is not. Their names must also not collide
with another loose block's, since flattening puts them all in one namespace; that one is
caught when the GLSL writer runs, with SD0030 naming both blocks.

### Targeting WebGL2 only

Nothing on this page narrows what the GLSL writer can express. The neutral names are
spellings, and several of the rules behind them exist to make WebGL2 output more defined:
`round` emits `roundEven`, and float `%` emits a trunc-mod that GLSL ES 3.00 compiles.

For a GLSL construct the neutral surface does not model,
[`rawStmt`](/guide/authoring/raw-statements/) accepts a payload for one target only, and
`b.raw` takes the same payload inside a `fn()` body. The point-size row above is the case
this is for: the builtin has no neutral spelling, and a WebGL2-only build can still write
it. The GLSL writer splices the payload verbatim, and the WGSL writer, if it ever runs on
that module, fails closed on that statement:

```ts
import { f32, f32T, fn } from '@xgis/shader-dsl'

const sized = fn('sized', {}, f32T, (_p, b) => {
  b.raw({ glsl: 'gl_PointSize = 4.0;' })
  return f32(1)
})
```

That is the shape to reach for when you exclude WebGPU today and may want it later. What a
raw costs the rest of the module is on [Raw statements](/guide/authoring/raw-statements/).
