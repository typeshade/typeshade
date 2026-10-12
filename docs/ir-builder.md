# The IR builder

This document is for an engine, a tool or a test that assembles a module in code, node by
node, instead of compiling a `"use typeshade"` source. An author who writes a shader reads
`AUTHORING.md`; nothing on this page is needed to write one.

**No stability promise.** The builder lives at the subpath `typeshade/core/ir`, not at the
package root (Rule 11.19, change 0060). Its names, its node classes and its declarators may
change in any release before 1.0. Code that imports it pins the package version.

## What the builder is for

`compile()` reads a `"use typeshade"` source and returns a `ModuleDecl`: the IR every backend
reads. The builder constructs the same `ModuleDecl` from TypeScript calls. Three kinds of code
use it:

- An engine that generates a shader it cannot write as a file, for example one whose functions
  depend on data known only at run time.
- A tool that rewrites or inspects IR, and needs to make nodes of its own.
- The compiler's own tests and the example registry. A _twin_ is one shader written twice,
  as a `"use typeshade"` file and with the builder; `examples/shade-twins.test.ts` holds the two
  to one IR. This is how the builder serves as the IR-equality oracle for the source language.

Everything a module is fed to afterwards, `emitModule`, `emitGlslStages`, `reflect`,
`compileModule`, `packModule` and the rest, comes from the package root, and takes a built
module and a compiled one alike.

```ts
import { fn, module, vec2fT, f32T, abs, length } from 'typeshade/core/ir'
import { emitModule, compileModule, reflect } from 'typeshade'

// One helper. The return type is inferred from the value the body returns.
const ringMask = fn('ring_mask', { uv: vec2fT, radius: f32T }, (p) =>
  abs(length(p.uv).sub(p.radius)),
)

const m = module({ funcs: [ringMask] })

const wgsl = emitModule(m) // fn ring_mask(uv: vec2<f32>, radius: f32) -> f32 { … }
const cpu = compileModule(m) // cpu.fns.ring_mask([0.3, 0.4], 0.5) === 0
const meta = reflect(m)
```

## Assembling a module by hand

`fn` declares a function: an optional name, a record of parameters keyed by name, a body, and,
for an entry point, the stage in its options. The body receives the typed parameter nodes as
its first argument. `module` gathers functions, structs, bindings and constants into one
`ModuleDecl`. Each expression is a _node_: a typed object that records an operation and its
operands, and carries its type in TypeScript. Operators are methods on a node, because
JavaScript cannot overload them: `x.mul(4).sub(1)` is a multiply and a subtract.

```ts
import {
  fn,
  module,
  ioStruct,
  builtin,
  location,
  sub,
  vec2,
  vec4,
  vec2fT,
} from 'typeshade/core/ir'
import { emitModule, emitGlslStages } from 'typeshade'

const VsOut = ioStruct('VsOut', {
  pos: builtin('position'),
  uv: location(0, vec2fT),
})

const vs = fn(
  'vs',
  { vi: builtin('vertex_index') },
  ({ vi }) => {
    const x = vi.bitAnd(1).f32().mul(4).sub(1)
    const y = vi.shr(1).f32().mul(4).sub(1)
    return VsOut.construct({
      pos: vec4(x, y, 0, 1),
      uv: vec2(x.mul(0.5).add(0.5), y.mul(0.5).add(0.5)),
    })
  },
  { stage: 'vertex' },
)

const fs = fn('fs', { vo: VsOut }, ({ vo }) => vec4(vo.uv.x, sub(1, vo.uv.y), 0.5, 1), {
  stage: 'fragment',
})

const gradient = module({ structs: [VsOut.decl], funcs: [vs, fs] })

const wgsl = emitModule(gradient)
const { vertex, fragment } = emitGlslStages(gradient)
```

This module is the program of the `"use typeshade"` file on `AUTHORING.md`'s first page. Its
emit differs only in how values are named: the optimizer names the values it shares `_cse0`
and `_cse1` where the file's `const` declarations name them `x` and `y`, and the file's
`const shade` is a `let` of its own where this module inlines `sub(1, vo.uv.y)`.

`vec2fT` is a _type token_: a value that names a shader type, written where a declaration needs
a type. Every token ends in `T` (`f32T`, `u32T`, `vec4fT`, `mat4x4fT`, `arrayT(elem, n)`).
`vec2` and `vec4` build a value. A bare number operand takes its type from the node it meets,
so `bitAnd(1)` needs no `u32(1)`. A number on the LEFT of an operator has no methods, so the
free functions `add`, `sub`, `mul` and `div` take a literal first: `sub(1, x)`.

`module` takes `consts`, `structs`, `bindings`, `funcs`, `overrides`, `enables` and `uses`, and
each defaults to empty. `uses` takes handles that carry their own declarations, such as a
`uniformStruct`. Order in `funcs` is the emit order; a function reached through a handle call
but not listed is collected and placed before its caller. A resource is not collected that
way: a binding a body reads that the module is not handed emits no declaration, and the
`uses-declared` lint rule of `diagnose` names it. Pass `funcs` as a record,
`{ dist_to_segment, vs_full: vsFull }`, and each key becomes the emitted name, in key order.

## Values and mutation

An intermediate value is a plain `const` holding a node; the emit pass decides whether it is
inlined, shared or bound. `Let(value)` binds a value once and returns a read-only node, and
`Var(init)` declares a mutable variable, from an initial value or a type token. Both take an
optional leading name for the emitted source. Mutation is a method on the value written:
`.assign(v)`, `.addAssign(v)`, `.subAssign(v)`, `.mulAssign(v)` and `.divAssign(v)`. Assigning
to a plain `const` node makes it a variable in the emitted source.

| category   | methods                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| arithmetic | `.add .sub .mul .div .mod .neg`                                          |
| compound   | `.addAssign .subAssign .mulAssign .divAssign`                            |
| comparison | `.lt .gt .le .ge .eq .ne`                                                |
| logical    | `.and .or .not`                                                          |
| bitwise    | `.bitAnd .bitOr .bitXor .shl .shr`                                       |
| casts      | `.f32() .i32() .u32() .f64()`                                            |
| components | `.x .y .z .w` · `.r .g .b .a` · `.rgb .xy .xyz …` · `.swizzle<R>('zxy')` |
| index      | `.at(i)` on an array node · `.at(i, elemType)` otherwise                 |
| ternary    | `cond.select(a, b)`                                                      |

`select(cond, a, b)` is the free spelling of `.select`, condition first, so it emits WGSL's
`select(b, a, cond)`. `mod(x, y)` is the floor modulo and `.mod` is `%`.

A module constant whose GPU and CPU values differ is `constDecl`; one built from a foldable
node is `constExpr`. Both are read through `.node`.

```ts
import {
  fn,
  module,
  constDecl,
  constExpr,
  Var,
  Let,
  min,
  length,
  vec2fT,
  vec4,
  vec4fT,
  f32T,
} from 'typeshade/core/ir'
import { emitModule } from 'typeshade'

const PI = constDecl('PI', f32T, { wgsl: 3.14159265, cpu: Math.PI })
const SKY = constExpr('SKY', vec4fT, vec4(0.4, 0.6, 0.9, 1))

const shade = fn('shade', { p: vec2fT, r: f32T }, ({ p, r }) => {
  const d = Let('d', length(p).sub(1)) // let d = …;
  const best = Var('best', r.mul(r).mul(PI.node)) // var best: f32 = …;
  best.assign(min(best, d))
  best.addAssign(1)
  return SKY.node.mul(best)
})

const wgsl = emitModule(module({ consts: [PI.decl, SKY], funcs: [shade] }))
```

## Functions and control flow

A handle `fn` returns is both the callable and the declaration. Call it with an object keyed
by parameter name, which is checked, or positionally, which is not. `externFn` declares the
signature of a function linked in at emit from elsewhere, so the call is typed and nothing is
emitted for it.

Control flow is a set of calls that push statements into the body being built. `If(cond, body)`
chains `.elif` and `.else`. `Loop(n, body)` counts from `0u` to `n`, and
`Loop(init, cond, body, step?)` is the three-part form. `Break()`, `Continue()` and `Discard()`
end work early. `Switch(scrut).case(n, body).default(body)` dispatches on an integer, and
`matchExpr` is its value form. `when(cond, a, b)` and `when([[cond, a], …], else)` pick a value
lazily, `reduce(init, i0, cond, body, step?)` folds a loop, and `enumU32` with `matchEnum`
dispatches exhaustively on a closed set. A native `return value` inside a control-flow body is
refused (`SD0115`); an early exit is `Return(value)` or `ReturnIf(cond, value)`, and the
function then passes `{ allowEarlyReturn: true }` so the single-exit lint rule does not report
it.

```ts
import {
  fn,
  module,
  If,
  Loop,
  Break,
  Continue,
  Switch,
  Return,
  Var,
  when,
  reduce,
  enumU32,
  matchEnum,
  min,
  f32,
  u32,
  u32T,
  f32T,
  vec2,
  vec4,
  vec4fT,
} from 'typeshade/core/ir'
import { emitModule } from 'typeshade'

const Kind = enumU32({ Line: 0, Fill: 1, Stroke: 2 })

const dispatch = fn(
  'dispatch',
  { kind: u32T, count: u32T, x: f32T },
  f32T,
  ({ kind, count, x }) => {
    const acc = Var('acc', f32(0))
    Loop(64, (i) => {
      acc.addAssign(i.f32())
    })
    Loop(
      u32(0),
      (i) => i.lt(count),
      (i) => {
        If(i.eq(3), () => Continue())
        If(i.gt(10), () => Break())
        acc.assign(min(acc, i.f32()))
      },
    )
    Switch(kind)
      .case(1, () => acc.mulAssign(2))
      .default(() => {})
    If(x.lt(0), () => {
      Return(f32(0))
    })
    const best = reduce(f32(1e10), u32(0), (i) => i.le(4), (b, i) => min(b, i.f32()), u32(1))
    const dir = when(x.lt(1e-6), () => vec2(1, 0), () => vec2(0, 1))
    const tint = matchEnum(kind, Kind, {
      Line: () => vec4(1, 0, 0, 1),
      Fill: () => vec4(0, 1, 0, 1),
      Stroke: () => vec4(0, 0, 1, 1),
    })
    Return(acc.add(best).add(dir.x).add(tint.x))
  },
  { allowEarlyReturn: true },
)

const wgsl = emitModule(module({ funcs: [dispatch] }))
```

A body whose value leaves through `Return` alone, as this one does, needs the return type
token (`f32T` above), because TypeScript reads such a body as returning nothing; leaving it out
is `SD0113`.

## Layouts and resources

Each declarator takes the layout once and returns a handle that carries the declarations and
typed accessors; pass the handles to `module({ uses: [...] })`.

- `ioStruct(name, fields)` declares an IO struct; each field is `builtin(id)` or
  `location(n, type, interp?)`. `.construct({...})` builds a value, `.var(name)` declares a
  mutable one, `.of(node)` reads fields off a node, and `.decl` is the declaration.
- `uniformStruct(type, { group, binding, as }, fields)` declares a uniform block; read a field
  with `.field.<name>`.
- `structDecl(name, fields)` declares a plain struct, and `storageBuffer(name, elem,
{ group, binding, access })` a bound array of it, read with `.at(i)`.
- `resource(name, token, { group, binding })` declares one bound value: a scalar or vector
  uniform, a texture (`texture2dfT`, `texture2dArrayfT`, `texture2duT` …) or a sampler
  (`samplerT`). `.node` reads it and `.binding` is the declaration.

```ts
import {
  fn,
  module,
  uniformStruct,
  structDecl,
  storageBuffer,
  resource,
  textureSampleLevel,
  texture2dfT,
  samplerT,
  mat4x4fT,
  vec4fT,
  vec2fT,
  u32T,
  u32,
} from 'typeshade/core/ir'
import { reflect } from 'typeshade'

const U = uniformStruct('Uniforms', { group: 0, binding: 0, as: 'u' }, { mvp: mat4x4fT, tint: vec4fT })
const Segment = structDecl('Segment', { kind: u32T, p0: vec2fT, p1: vec2fT })
const segments = storageBuffer('segments', Segment, { group: 0, binding: 1, access: 'read' })
const tex = resource('tex', texture2dfT, { group: 0, binding: 2 })
const smp = resource('smp', samplerT, { group: 0, binding: 3 })

const look = fn('look', { i: u32T }, ({ i }) => {
  const seg = segments.at(i)
  const c = textureSampleLevel(tex.node, smp.node, seg.p0, 0)
  return c.mul(U.field.tint).mul(seg.kind.add(u32(1)).f32())
})

const m = module({ uses: [U, segments, tex, smp], structs: [Segment.decl], funcs: [look] })
reflect(m).bindGroups // u, segments, tex and smp, at bindings 0 to 3
```

## Conditional programs

A builder is an ordinary function, so a variant is a function parameter and a plain `if`
decides what goes into the IR; the arm that loses is never built, and its bindings are never
declared. `overrideConst(name, type, default)` declares a specialization constant, read through
`.node` and listed in `module({ overrides })`. `variantFamily({ axes, build, key })` takes a
`build` that returns a module for one point, built or compiled.

`composeModule(base, swaps)` fills statement slots. Mark the seam with `b.placeholder('tag')` in
the base module, through the builder the body receives as its second argument, and pass the
statements that replace it per variant. It descends into `if`, `for` and `switch` bodies and
contributes no consts, structs or bindings, so it is no substitute for an `#include`.

```ts
import { fn, module, overrideConst, If, Var, f32, f32T, vec4, vec4fT, type Stmt } from 'typeshade/core/ir'
import { composeModule, emitModule } from 'typeshade'

const quality = overrideConst('quality', f32T, 1.0)
const shade = fn('shade', { base: f32T }, ({ base }) => {
  const acc = Var(base)
  If(quality.node.gt(f32(1)), () => {
    acc.assign(acc.mul(f32(2)).add(f32(0.5)))
  })
  return acc
})

const base = module({
  overrides: [quality.decl],
  funcs: [
    shade,
    fn('fill_color', {}, vec4fT, (_p, b) => {
      b.placeholder('fill')
    }),
  ],
})

const solid: Stmt[] = [{ s: 'return', expr: vec4(1, 0, 0, 1).expr }]
const wgsl = emitModule(composeModule(base, { fill: solid }))
```

## Portable compute kernels

A compute entry declared `portable: true` emits on both writers: natively as `@compute` on WGSL,
and on GLSL ES 3.00 through a compute-to-fragment lowering that runs with no emit option. In
exchange the kernel stays inside a gather-only tier:

- `global_invocation_id` is read as `.x` alone, the 1-D linear invocation index.
- Exactly one `read_write` storage binding whose elements are `u32`, written exactly once at
  index `gid.x`. A scatter write, a second write, or zero writes fails.
- The first `uniform` binding must be `vec4<u32>`, the dispatch uniform, whose `.x` is the
  invocation count and whose `.y` is the output-grid width. First means first in the module's
  `bindings` list.
- No raw statements anywhere the entry's call graph reaches.

Anything outside that shape fails validation at every emit with `SD0111` and a remedy per
violation; `portable` on an entry that is not compute is `SD0110`. On WebGL2 the host submits a
fullscreen draw into an R32UI target in place of a compute dispatch. A `"use typeshade"` compute
entry needs none of this: it runs on WebGL2 as a pass program (`AUTHORING.md`, Portable compute
kernels).

```ts
import {
  fn,
  module,
  builtin,
  resource,
  storageBuffer,
  If,
  Return,
  pack4x8unorm,
  vec4,
  vec4uT,
  vec3uT,
  f32T,
  u32T,
  voidT,
} from 'typeshade/core/ir'
import { emitGlslModule, emitModule } from 'typeshade'

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

const m = module({ bindings: [dispatch.binding, field.binding, outColor.binding], funcs: [kernel] })
const wgsl = emitModule(m)
const glsl = emitGlslModule(m, 'fragment')
```

## Declarations the host owns

Four declarators answer who declares a symbol and who owns the memory behind it, for a module
composed into a host program that already has a prelude.

- `externVar` is a symbol the host prelude already declares. It emits nothing, gives a typed
  reference, takes a per-target `spelling`, and lands in `reflect().requires`.
- `externFn` forward-declares a callable whose body is linked in at emit, so the call is typed
  and no declaration is emitted.
- `hostUniform` declares a uniform this module declares and the host owns: GLSL emits a loose
  default-block uniform, and `reflect()` marks it `owner: 'host'`. Its `precision` option sets a
  qualifier on that one declaration.
- `hostBlock` declares a whole block the host owns. `{ glsl: 'loose' }` flattens it to one
  uniform per member and rewrites `blk.field` to `field` on the IR; the default
  `'std140-block'` keeps the block, and WGSL keeps it either way. A loose block's members must
  be scalars, vectors or matrices (`SD0016` as you declare one that is not), and two loose
  blocks whose members collide are `SD0030` when the GLSL writer runs.

```ts
import { fn, module, hostBlock, mat4x4fT, vec2fT, vec4, vec4fT } from 'typeshade/core/ir'
import { emitGlslModule, emitModule } from 'typeshade'

const camera = hostBlock(
  'CameraUniforms',
  { group: 0, binding: 0, as: 'u_camera' },
  { u_matrix: mat4x4fT, u_viewport_px: vec2fT },
  { glsl: 'loose' },
)

const vs = fn('vs', {}, vec4fT, () => camera.field.u_matrix.mul(vec4(0, 0, 0, 1)), {
  stage: 'vertex',
  retAttr: '@builtin(position)',
})

const m = module({ uses: [camera], funcs: [vs] })
emitGlslModule(m, 'vertex') // reads `u_matrix`
emitModule(m) // reads `u_camera.u_matrix`
```

## Raw statements

A raw statement is a string the builder writes into a function body without reading it. Reach
for one when a statement has to be hand-written, arrives pre-built from another generator, or
uses a construct the IR does not model. To the compiler that string is opaque bytes, and
everything below follows from that.

A payload is the `{ wgsl, glsl }` object, one spelling per target. Inside an `fn` body, splice
it with `b.raw(payload)`, where `b` is the builder the body receives as its second argument.
`rawStmt(payload)` returns a statement node for a `Stmt[]` you assemble by hand; a bare
`rawStmt(...)` call inside an `fn` body is a discarded expression and emits nothing.
`emitModule` writes the `wgsl` string and `emitGlslModule` the `glsl` string, each verbatim.

At least one side is required at the type level. A backend handed a raw with no spelling for
its own target throws `UnsupportedFeatureError` (`SD0030`), naming the missing spelling and
quoting the side you gave. That is the shape for a WebGL2-only construct, such as a write to
`gl_FragDepth` or `gl_PointSize`:

```ts
import { fn, module, vec4, vec4fT } from 'typeshade/core/ir'
import { emitGlslModule, emitModule } from 'typeshade'

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
// emitModule(m) throws UnsupportedFeatureError (SD0030)
```

Two things about the text are yours. The writer indents only the first line of a multi-line
spelling, so indent the continuation lines yourself. And identifiers inside a spelling are not
rewritten: the GLSL backend renames a param or local named like a GLSL reserved word (`in`,
`sample`, `filter`, `texture`), so a `glsl` spelling that names one refers to a variable the
emitted stage no longer has.

A single raw anywhere in a module turns three things off, module wide:

- **Mangling.** `mangle()` returns the module unchanged and an empty rename map, because
  renaming around text it cannot read would desync the splice.
- **GLSL stage scoping.** The GLSL backend normally emits into a stage only the functions that
  stage reaches. Raw text is opaque to that walk, so every helper is emitted into every stage,
  and fragment-only machinery (`dpdx`, `dpdy`, `fwidth`, `discard`) in any helper reaches the
  vertex stage, where it does not compile.
- **The CPU oracle**, for the function that holds it: calling that function throws, and the
  other functions of the module still run.

## fp64

`f64T` is the emulated double's token, and `vec2f64T`, `vec3f64T` and `vec4f64T` its vectors,
built with `vec2f64(x, y)` and its siblings. `toF64(x)` and `x.f64()` widen exactly, `f64(1e-9)`
splits a literal at build time, `toF32(x)` narrows, and `f64FromParts(hi, lo)` assembles a value
from two `f32` halves that arrive already split, a vertex attribute pair for instance; the
`"use typeshade"` surface has no such door. A module whose bind group layout is fixed passes
`fp64Guard({ group, binding })` in `uses`.

```ts
import { fn, module, f32T, f64, f64FromParts, toF32, toF64 } from 'typeshade/core/ir'
import { emitModule } from 'typeshade'

const g = fn('g', { a: f32T, hi: f32T, lo: f32T }, (p) => {
  const widened = toF64(p.a) // exact
  const lit = f64(1e-9) // split at build time
  const rebuilt = f64FromParts(p.hi, p.lo) // two lanes that were split by the host
  return toF32(widened.add(lit).add(rebuilt)) // the explicit narrow
})

const wgsl = emitModule(module({ funcs: [g] }))
```

## Errors and source locations

The builder checks its operands as it runs, so a type mismatch throws while the module is being
built, before any emit call: adding a `vec2f` to a `vec3f` throws `SD0002`,
`typeshade [SD0002]: binary op on mismatched vectors`, with the operator and the two types. An
error thrown while a body is being built names the function and the body kind, for example
`in Loop body`.

A built node has no source file, so its location is the TypeScript stack that built it.
Capturing it is off by default, because it costs a stack walk per node. `setSourceTracing(true)`
from `typeshade/dev`, or `TYPESHADE_TRACE=1` in the environment, turns it on; `diagnose(m)` then
prints the `-->` line of the builder call behind each finding. The full lint ruleset of
`diagnose` includes `no-assign-to-let`, the `Let` then `.assign()` mistake, which emits WGSL a
driver rejects.

```ts
import { fn, module, Let, f32T } from 'typeshade/core/ir'
import { diagnose, formatReport, setSourceTracing } from 'typeshade/dev'

setSourceTracing(true)

const rim = fn('rim_alpha', { x: f32T }, ({ x }) => {
  const edge = Let('edge', x.mul(2))
  edge.assign(x)
  return edge
})

const report = diagnose(module({ funcs: [rim] }), { rules: 'all' })
formatReport(report) // error[SD0107] no-assign-to-let  (fn rim_alpha), --> the edge.assign(x) line
```

## The node API

A node is an instance of `Node<K>`, where `K` is the type key (`'f32'`, `'vec4<f32>'`,
`'struct:VsOut'`). `.expr` is the plain `Expr` it wraps, which is what a hand-assembled `Stmt`
carries. `isNodeValue(v)` tells a node from another value, and `lift(v, like)` turns a bare
number into a node of `like`'s kind. A `Let` binding, a parameter and a module constant are a
`ReadonlyNode<K>`, which has every reading method and no writing one. The IR types themselves,
`ModuleDecl`, `FuncDecl`, `Expr`, `Stmt` and `ShaderType`, are exported from the package root as
well, since a tool that reads what `compile()` returns names them.
