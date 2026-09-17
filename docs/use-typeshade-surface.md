# `"use typeshade"` language surface

Status: **on `main`** as of `2605a27` (PR #5 squash). Design freeze for layout / entry / data types.
Does not replace `docs/use-typeshade-plan.md` (IR phases 0–22). This document is the **author-facing grammar**.
`fn()` remains the IR equality oracle. Product code uses `"use typeshade"`.

North star: TypeScript syntax only where the TS parser already accepts it. No preprocessor. No second IR.

```
type Camera = { … }                 value struct (or class + field attrs)
class VsIn { @location(0) … }       value struct + per-field metadata
declare const camera: uniform<T>    resource slot (host fills)
declare let pixels: storage<T>      resource slot, writable
@compute([64]) export function      entry
@vertex / @fragment export function entry
```

GPU has three things. The grammar has three places.

| GPU              | TypeShade                                      | `@` allowed?                          |
|------------------|------------------------------------------------|---------------------------------------|
| Buffer / UBO     | `declare const/let` + `uniform<T>` / `storage<T>` | No (const cannot take decorators)     |
| Value layout     | `class` fields or `type` alias                 | Yes, on **class fields only**         |
| Shader stage     | top-level `export function`                    | `@compute` `@vertex` `@fragment`      |

Do not put an entry method on a class. Do not use a class as a bind group.

---

## 1. Resources — `declare`

Host-owned. No initializer. Slot index = source order of `declare` in the file.

```ts
"use typeshade"

declare const camera: uniform<Camera>
declare const src: storage<f32>
declare let pixels: storage<f32>
```

| Declaration | Space | Access |
|-------------|-------|--------|
| `declare const x: uniform<T>` | uniform | read |
| `declare const x: storage<T>` | storage | read |
| `declare let x: storage<T>` | storage | read_write |
| `declare const x: T` | illegal | space required |
| `declare let x: uniform<T>` | illegal | uniform is const |

Writes to a read-only resource are a compile error.

Duplicate `@group @binding` is an error.

Sketch form still exists and occupies the same slot sequence:

```ts
const scale = uniform<f32>()
let xs = storage<f32>()
```

Product code should use `declare`. Mixing `declare` and call form in one file shares one slot counter; collisions still error.

`var` is not a resource declaration.

---

## 2. Value types — `type`, `interface` and `class`

Plain data without field metadata uses a type alias:

```ts
type Camera = {
  view: mat4
  pos: vec3
}
```

`interface Camera { view: mat4; pos: vec3 }` is the same struct written a third way. A class,
a type alias over an object type, and an interface all produce one `StructDecl`; the compiler
accepts all three.

A `type`/`interface` struct is the members written in it: a method or call signature, an
index signature, an optional (`a?: f32`) member, and an `interface … extends …` are each
rejected, since a WGSL struct has no form for them and silently dropping one would change
the buffer layout the host fills.

Field metadata (`@location`, `@align`, `@size`, `@offset`, `@builtin`, `@interpolate`, `@ignore`) requires a **class field**. Interfaces and type-literal members cannot carry TS decorators, so a struct used as entry I/O — where WGSL requires `@builtin` or `@location` on every member — has to be a class.

```ts
class Camera {
  @align(16)
  view: mat4
  pos: vec3
}

class VsIn {
  @location(0) position: vec3
  @location(1) @interpolate("linear") uv: vec2
}
```

Of that list the compiler applies `@location` and `@builtin` today. `@align` on a field is
an error (`TS8010`) rather than a silent no-op — the `@align(16)` above is *(target)*.
`@size`, `@offset`, `@interpolate` and `@ignore` parse but do not reach the emitted struct yet.

`class` here is a struct with attributes, not an object.

Forbidden on these classes:

- `new Camera()` as a resource
- `extends` (`TS8010`: the base's fields would silently vanish from the layout)
- methods that close over `declare` resources
- `@compute` / `@vertex` / `@fragment` methods
- constructors, `this` as a pipeline
- no fields at all — a struct with an empty field list has no WGSL form
- a field name that is not a plain identifier (`"my-field": f32`, `[key]: f32`)

Pure methods that only read `this` fields may land later as free functions. Not in the first class slice.

A struct is collected only when something **uses** it: a `declare` binding's `uniform<T>` /
`storage<T>` argument, a parameter, return or local annotation, or a field of another struct
that is itself used. Naming it in another TYPE declaration is not using it — `type Params =
Config`, `Config[]`, `Config | undefined` and `Readonly<Config>` all describe a type rather
than consume one, so none of them makes `Config` a shader struct. A `type` or `interface`
declaration nothing consumes is not a shader type at all — it may be a host-side shape
(`type Opts = { seed: number }`) — and is left alone, neither checked nor emitted. A `class`
is always collected, as it always has been.

One name, one declaration. A second class, interface or type alias of the same name is an
error, **including two interfaces**, which TypeScript itself would merge: the merged layout
would disagree with the one emitted here at every use site, so the ambiguity is refused
rather than silently resolved.

`declare` is the bind-group spelling; an `interface` is a value layout like any other.

---

## 3. Entries — function decorators and explicit builtins

Shader-stage inputs are **explicit function parameters**. TypeShade does not inject `gid`, `vid`, or `pid` as implicit globals.

```ts
@compute([64, 1, 1])
export function paint(
  @builtin("global_invocation_id") gid: vec3u
) {
  pixels[gid.x] += camera.pos.x
}

@vertex
export function vs(
  @builtin("vertex_index") vid: u32,
  vin: VsIn
): vec4 {
  return camera.view * vec4(vin.position, 1)
}

@fragment
export function fs(
  @builtin("position") pid: vec4
): vec4 {
  return vec4(pid.x, 0, 0, 1)
}
```

- No stage decorator → helper, not an entry.
- Builtins are ordinary entry parameters with `@builtin(...)` metadata.
- A builtin is not a hidden global; its dependency is visible in the function signature.
- The builtin name must match the target backend's supported builtin set.
- Workgroup size is the only payload on `@compute`. Default `[1, 1, 1]` if omitted as `@compute`.
- `@compute({ workgroup: [64, 1, 1] })` is accepted as an alias.

---

## 4. What we will not do

| Idea | Why not |
|------|--------|
| `@uniform const scale` | TS does not parse decorators on `const` |
| `class Scene { @compute paint() {} }` | `this` is not a GPU instance |
| Static class as bind group | Extra ban list; emit `.d.ts` instead |
| Per-decl binding numbers as the happy path | Host mismatch is silent on GPU |
| JS `Array` / lambdas / `filter` length change | IR + WGSL constraints |
| Implicit `gid` / `vid` / `pid` globals | Hidden stage inputs make dependencies less explicit |
| Recursion, direct or mutual | WGSL has no call stack; Tint rejects the module outright. The check is SYNTACTIC, so a call in code the optimizer would drop (`if (false) { f() }`, an unread `const x = f()`) is a cycle too. That is stricter than Tint for that class, and deliberately so: matching the optimizer would accept `if (false)` and reject `if (DEBUG)` for `const DEBUG: bool = false`, which no author could predict |

---

## 5. Lowering

```
declare const camera: uniform<Camera>
        → BindingDecl { name, space: "uniform", binding: N, type: Camera }

declare let pixels: storage<f32>
        → BindingDecl { space: "storage", access: "read_write", … }

camera / pixels in a function
        → varref (resource scope)

class Camera { view, pos }
        → StructDecl + field attrs

@builtin("global_invocation_id") gid: vec3u
        → entry parameter + builtin metadata

@compute([64]) export function paint
        → FuncDecl + workgroup metadata
```

Same Expr / Stmt / FuncDecl / BindingDecl / StructDecl as the EDSL.

---

## 6. Implementation order

1. **Landed on main:** `declare` + `uniform<T>` / `storage<T>` → BindingDecl, varref, WGSL, duplicate-slot errors.
2. **`@compute([x,y,z])` + explicit builtin parameters** in that function only.
3. **`class` as StructDecl.** Fields without decorators first (`uniform<Camera>`).
4. **Field decorators** `@align` `@location` `@size` `@offset` `@ignore`.
5. **`@vertex` / `@fragment`** + explicit builtin and `VsIn` locations.
6. Reflect JSON + optional `.d.ts` for `declare` names.

Do not start Execution Graph or class methods before 2–4 are green.

---

## 7. Diagnostics (required)

| Situation | Error |
|-----------|-------|
| `declare const x: f32` | need `uniform<T>` or `storage<T>` |
| `declare let x: uniform<T>` | uniform must be `declare const` |
| assign to `declare const` resource | read-only |
| two resources share `@binding` | name both |
| builtin parameter on an incompatible stage | stage mismatch |
| `@compute` method on a class | entries are top-level functions |
| a function that reaches itself, directly or through other functions | `TS8031` on the call that closes the cycle, naming the whole cycle |
| `.length` on an `array<T>` with no `N`, anywhere | `TS8032`. For a `storage` array the length is the bound buffer's and needs `arrayLength` (unspelled today); for a local, a parameter or a `uniform<array<T>>` the fix is an explicit size, `array<f32, 3>` |

---

## 8. Example

Compiles today. `@align(16)` on `view` is part of the frozen grammar (§2) but the compiler
rejects it (`TS8010`, "`@align` on a field is not applied"), so it is left out here.

```ts
"use typeshade"

class Camera {
  view: mat4
  pos: vec3
}

declare const camera: uniform<Camera>
declare let pixels: storage<array<f32>>

@compute([64, 1, 1])
export function paint(
  @builtin("global_invocation_id") gid: vec3u
) {
  const i = gid.x
  pixels[i] = pixels[i] + camera.pos.x
}
```

**Rule:** a target example — grammar this document freezes but the compiler does not accept
yet — stays in this document, is labelled *(target)*, and is never copied into `README.md`,
the org profile, or any other front-facing page. Those pages carry only examples that
compile, which `src/compiler/ts/doc-snippets.test.ts` enforces.

**Numbering:** §§9, 10 and 13 below are issue #8's A2, A6 and A3, which reserved those numbers
while they were in flight and appended here in issue order. The sections took the next free
numbers so the A-item branches did not all claim §9 and collide on merge.

---

## 9. Assignment targets

A write lands on a name, or on a field, component or element of one. The chain may be as
deep as the types allow; what decides whether it is legal is the **root** of the chain.

```ts
v = vec3(0., 1., 0.)      // a name
v.x = 0.                  // a component
v.x += 1.                 // and the compound and ++ / -- forms
o.pos = vec4(p, 0., 1.)   // a field
o.pos.x = 2.              // a component of a field
ps[i].a = 1.              // a field of an element
pixels[i] = 1.            // an element
```

| Root | Writable? |
|------|-----------|
| `let` local | yes |
| `declare let x: storage<T>` | yes |
| `const` local | no: `TS8005` |
| `declare const x: uniform<T>` / `storage<T>` | no: `TS8005` |
| a function parameter | no: `TS8018`; see the caveat below |
| anything that is not a name (`vec3(0.).x`) | no: `TS8018` |

The parameter row is about writing **through** a parameter: `p.x = 1.`, `p.xs[i] = 1.`.
Writing a parameter **whole** (`p = 1.`, `p += 1.`, `p++`) is a different matter: WGSL rejects
it too, but this surface has always accepted it and emitted `p = 1.0;`, so refusing it now
would stop source that compiles today. Narrowing it needs a deprecation path and is on
[issue #8](https://github.com/typeshade/typeshade/issues/8)'s "later" list; until then, a
whole-parameter write is a bug the compiler does not catch yet.

A swizzle target names exactly **one** component. `v.xy = …` and `c.rg = …` are rejected
(`TS8018`), which is what WGSL does: assign each component, or build the whole vector and
assign that. `v.r` `v.g` `v.b` `v.a` are components like `v.x` … `v.w` and are writable.

`++` and `--` step a **numeric scalar**: `f32`, `i32`, `u32` and `f64`. On a member or element
target they lower to the compound form (`ps[i].a += 1.`), so the target is written once instead
of read and written back; a bare name keeps `i = (i + 1)`.

Everything else is rejected with `TS8018`. A bool, a struct, an array and a matrix have nothing
to add `1` to. A **vector** is rejected too, native and emulated-double alike: the step is one
literal of the target's type, and no vector literal has a spelling, so `v++` never emitted
shader text on any target. Write the addition out instead:

```ts
v = v + vec3(1., 1., 1.)   // instead of v++ on a vec3
```

An `i32` or `u32` vector takes the same addition with bare literals, `v = v + vec2i(1, 1)`,
because a literal inside a vector constructor takes the constructor's element type (§13); a
`vec3f64` has no literal spelling at all, so its addition needs values that are already `f64`.
The refusal names an example only for the kinds whose example compiles.

Lowering is the same `assign` / `assignOp` the EDSL's `v.x.assign(a)` and `o.pos.assign(v)`
produce, so the two surfaces stay IR-equal here.

Binding a value to another name **copies** it, as it does on both GPU targets: after
`let w = v; w.x = 100.`, `v` is unchanged, on the GPU and in the CPU oracle alike.

## 10. Builtins, casts and `discard`

The scalar casts are `f32(x)`, `i32(x)`, `u32(x)`, `bool(x)` and `f64(x)`. `bool(x)` is
"x is not zero", WGSL's own conversion, and is spelled with the compare it means. `f64(x)`
widens an `f32` to the emulated double; casting a value to the type it already has is that
value.

Free builtin functions, callable without a `Math.` prefix, are the GLSL / WGSL names the IR
carries. Beyond the set that was already there (`sin` … `clamp`, `mix`, `smoothstep`, `step`,
`length`, `dot`, `cross`, `distance`, `normalize`, `mod`, `fract`, `degrees`, `radians`,
`inverseSqrt`):

| Spelling | Meaning |
|----------|---------|
| `exp2(x)` | 2ˣ |
| `saturate(x)` | `clamp(x, 0., 1.)`; GLSL ES 3.00 has no `saturate`, so it is inlined there |
| `fwidth(x)`, `dpdx(x)`, `dpdy(x)` | screen-space derivatives (`dFdx` / `dFdy` in GLSL) |
| `fma(a, b, c)` | `a·b + c`; GLSL ES 3.00 has no `fma`, so it is inlined there |
| `atan(y, x)` | the two-argument arctangent (`atan2` in WGSL); `atan(x)` is still one argument |
| `select(f, t, c)` | `c ? t : f`. **WGSL's order: the condition is last.** The same IR the ternary builds |
| `a ** b` | `pow(a, b)`. Both operands must have one type; splat a scalar exponent |

A function the file declares wins over any name in the table above, and over `bool` and
`f64`: those names meant the author's function before they were builtins, and an addition
does not change what a program means. The builtins that came earlier (`min`, `max`, `mix`,
`clamp`, `pow`, `f32` …) keep their precedence, for the same reason pointing the other way:
a program that resolves to one today must keep resolving to it.

`discard` kills the fragment:

```ts
"use typeshade"

class Color {
  @location(0) color: vec4
}

@fragment
export function fs(@builtin("position") p: vec4): Color {
  if (p.x > 0.5) {
    discard
  }
  return { color: vec4(1., 0., 0., 1.) }
}
```

It is allowed in a fragment entry, and in a helper as long as no `@vertex` or `@compute`
entry can reach it: the check closes over the call graph, so `discard` inside a helper a
vertex entry calls is rejected too, naming the helper and the entry. The three screen-space
derivatives (`fwidth`, `dpdx`, `dpdy`) are fragment-only by the same rule.

`**` is float-only, as `pow` is on both targets: `i32 ** i32` is rejected rather than emitted
as `pow(i32, i32)`, which neither compiler accepts.

`transpose` has no `f32` form on either surface: the IR carries only `transpose64`, over an
emulated-double matrix, so there is nothing to expose yet.

**One caveat on declaring a function with a builtin's name**, and it is about GLSL ES 3.00
rather than about this table: a declared function is emitted with the name the author wrote,
and GLSL ES 3.00 does not let a program redeclare one of ITS builtins. Measured on the compile
gate's own WebGL2 context, a module that declares and calls `exp2` or `fwidth` compiles on
Tint and is rejected by ANGLE with

```
ERROR: 0:5: 'exp2' : Name of a built-in function cannot be redeclared as function
```

while `saturate` and `fma` are accepted, because GLSL ES 3.00 has neither name. `bool` fails
the same way for a different reason: it is a GLSL ES 3.00 keyword, so ANGLE reports
`'bool' : syntax error` on a module that declares a function of that name, although the
declaration still wins on WGSL and on the CPU. None of this is new: those names are the GLSL
builtins and keywords they always were, and a module declaring one emitted the same GLSL
before this item existed. It is, though, the one way the precedence rule above can hand you a
WGSL-only module. The fix is to rename the function; the compiler does not warn about it yet.

The same precedence holds for a function handed to a fold. `zip(xs, ys, atan2)` beside a
declared `atan2` is refused with the rule named, because `atan2` is a name the intrinsic wins
and a fold has no intrinsic-valued callback; `zip(xs, ys, fma)` beside a declared `fma` calls
the declaration, as a plain `fma(a, b, c)` would.

---

## 11. Vector constructors

A `vecN` constructor either **composes** a vector out of parts of its own element type, or
**converts** one whole vector of the same size:

```ts
vec3(a, b, c)        // compose: three f32
vec3(0.5)            // splat
vec4(v3, 1.)         // compose from a vec3 and a scalar
vec4(v2, v2)         // compose from two vec2
vec3f(v)             // convert: v is a vec3u, every component becomes an f32
vec3u(v)             // convert the other way
vec2(gid.xy)         // convert a vec2<u32> swizzle to vec2<f32>
```

The converting form is WGSL's `vecN<T>(e: vecN<S>)` and GLSL ES 3.00's `vec3(uv)`, and the
EDSL's `vec3(v)` builds the same node. It needs exactly one argument, a vector of the
constructor's own size; a vector of another size and a mixed list such as `vec3(v2u, 1.)`
stay rejected, as WGSL rejects them.

The conversion follows **WGSL's** scalar conversion, which is what WebGPU and the CPU oracle
both give you: a float source saturates into an integer target (`vec3u(vec3(-3.2, …))` is
`0`, not `-3`), and `i32` and `u32` are reinterpreted two's-complement. An emulated-double
vector is not converted this way.

**GLSL ES 3.00 does not promise that.** It leaves an out-of-range or NaN float→int conversion
undefined, and the WebGL2 context the compile gate uses disagrees with WGSL on exactly those
inputs — measured against an RGBA32UI target, `uvec3(vec3(1e30)).x` reads back `0` where the
oracle gives `4294967040`, `ivec3(vec3(1e30)).x` reads `-2147483648` where the oracle gives
`2147483520`, and `uvec3(vec3(NaN)).x` reads `2147483648` where the oracle gives `0`. The
`-3.2` above happens to agree, and an in-range source always does. So the cross-backend
ground a portable shader can stand on is **in-range values**; clamp before you convert if the
source might not be.

---

## 12. Module constants

A top-level `const` is a module-scope shader constant. A scalar one folds to a single value
at declaration; a **vector or array** one carries its value as an expression every backend
emits and evaluates:

```ts
"use typeshade"

const PI2: f32 = 6.28318 // scalar, as before
const UP = vec3(0., 1., 0.) // → const UP: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);
const SKY: vec4 = vec4(0.4, 0.6, 0.9, 1.)
const XS: array<f32, 3> = array<f32, 3>(1., 2., 3.)
const PAL = array<vec4, 2>(vec4(1., 0., 0., 1.), vec4(0., 1., 0., 1.))
const K: f32 = 2.
const V = vec3(K, K, K) // an earlier const is a valid component

export function pick(i: i32): vec4 {
  return PAL[i] * K + vec4(UP, PI2) + vec4(V, XS[0]) + SKY
}
```

The value must be **constant**: a literal, a **whole** constant declared earlier in the file,
a constructor over those, or arithmetic over those with a divisor that is not zero. It may
not call a function, read a resource, or take a component, field or element — `vec3(UP.x, 0.,
0.)` is refused even though both writers would fold it. `XS.length` is a constant too, so an
array constant can bound a loop. An array **of arrays** is refused: the GLSL ES 3.00 spelling
it would produce is not one ANGLE accepts.

An **integer** earlier const is a valid component too, since #17 landed: `const N: i32 = 4`
followed by `const NV = vec3i(N, N, N)` emits `const N: i32 = 4;` and
`const NV: vec3<i32> = vec3<i32>(N, N, N);`. Before that fix the backend's `emitConst` spelled
every scalar constant with a float literal (`4.0`), which is why this section once limited the
rule to `f32` components.

This is the same declaration the EDSL's `constExpr(name, type, node)` produces — one
`ConstDecl` with its `valueExpr` filled.

A struct-valued and a matrix-valued constant are not accepted yet: the constant collector
runs without the struct table, and the surface has no matrix constructor.

---

## 13. Integer literals

A number written without a decimal point takes the type the position around it **declares**.
It is WGSL's abstract-integer rule, narrowed to the places where a type is actually stated:

```ts
"use typeshade"

const N: u32 = 16 // the declared type — on the IR; see the note below

class Id {
  id: u32
}

export function g(a: i32): i32 {
  return a
}

export function positions(i: i32, c: bool, xs: array<f32, 4>): u32 {
  let j: i32 = -1 // the declared type, sign and all
  let x: u32 = N // the assignment target's type…
  x = 2 // …here
  const s: Id = { id: 0 } // the struct field's type
  const v = vec3u(1, 2, 3) // the constructor's element type
  const t: u32 = c ? 1 : 2 // through both arms, from the position around it
  let acc = 0.
  for (let k = 0; k < 4; k++) {
    // i32, the type an induction variable must have
    acc += xs[0] // an index is an i32
  }
  return u32(g(1) + j) + x + s.id + v.x + t + u32(acc) + u32(min(i, 4))
  //         ^ the parameter's type              ^ the kind of the call's other arguments
}

export function ret(): u32 {
  return 0 // the declared return type
}
```

Only a declared **integer** type changes anything. In every float position the literal stays
an `f32` exactly as before — `g(2)` where `g` takes an `f32` is `g(2.0)`, `mix(a, b, 1)` is
`mix(a, b, 1.0)`, and a call whose arguments are all written numbers (`min(1, 2)`) is
untouched.

A minus sign in front of a literal is part of the literal for this purpose. `let j: i32 = -1`
and `for (let j: i32 = -1; …)` take `i32` the way `let j: i32 = 1` does; the negative form used
to be told to cast an integer the author had already written, and inside a `for` init it emitted
`var j: i32 = -1.0`, which no backend accepts (issue #40).

A declaration is the one position with a carve-out, kept from before this item: a single
literal written as a float but valued as a whole number takes the declared integer type there,
so `let y: i32 = 0.`, `let y: u32 = 0.`, `let y: i32 = 1e3` and `for (let k: u32 = 0.; …)`
compile as they always did. Only a single literal does. `let y: i32 = 2.5 + 0.5` and
`let y: i32 = -1.` are the mismatches they always were, and `let y: i32 = 1.5` is reported at
the source where it used to fail in the backend. A return, an argument and a field never had
the carve-out.

Two classes of emitted text move with this item, and neither was a program before: an integer
literal beside an integer peer in a builtin call (`min(i, 4.0)` is `min(i, 4u)` now), and a
`for` init that spelled a float literal into an integer `var` (`for (var k: i32 = -1.0; …)`
is `-1` now).

A literal that is not an integer stays what it is and is diagnosed against the declared type:
`return 1.5` in a `u32` function is still a type mismatch, and so is passing an `i32` value
where a `u32` is declared. There is no implicit conversion between types — only a literal,
which has no type of its own until something states one.

Three edges of the rule, each of which the diagnostics still cover:

- **It is about how the number is WRITTEN, not what it folds to.** `return 2 + 3` in a `u32`
  function is `return 5u;`, but `return 2.5 + 0.5` is a type mismatch — every leaf of the
  arithmetic has to be an integer literal.
- **The value has to fit.** `return -1` in a `u32` function, or `2147483648` in an `i32` one,
  is left exactly as written and reported as the mismatch it always was.
- **A literal in a builtin call's FIRST argument does not retype the call.** An intrinsic's
  result type is its first argument's, so `min(1, i)` with an `i32` `i` still types the call
  `f32` and emits `min(1.0, i)` — which WGSL does not accept. The position this rule is for is
  the other one, `min(i, 4)`, where the literal is not what decides the type. Fixing the first
  position means changing how every intrinsic's result type is decided, which is not additive.

`const N: u32 = 16` is the **front end** only: the `ConstDecl` it builds carries `u32` and
`16`, and the backend's `emitConst` still spells every scalar constant with a float literal,
so the emitted line reads `const N: u32 = 16.0;`. That half is issue #13, with #17 as its fix.

## 14. TypeScript shapes the parser already had

Four ordinary TypeScript shapes that the grammar admits and the language now lowers (one of
them, the object-literal shorthand, is an expression rather than a statement).
None of them is a new operation: `Stmt.var.init` has always been optional, `assignOp` has
always taken any `BinOp`, `construct` does not record how a field was spelled, and `switch`
was already lowered; only the source language refused them.

```ts
"use typeshade"

const PALETTE_WARM = 1.

export function band(seed: i32, t: f32): vec3 {
  let bits: i32 = seed
  bits <<= 1
  bits &= 3
  bits |= 0
  bits ^= 0
  bits >>= 0

  let rgb: vec3
  rgb = vec3(0., 0., 0.)
  switch (bits) {
    case 0:
      rgb = vec3(0.1, 0.1, 0.12)
      break
    case 1: {
      if (t > 0.5) {
        rgb = vec3(PALETTE_WARM, 0.55, 0.2)
        break
      }
      rgb = vec3(0.5, 0.3, 0.1)
      break
    }
    default:
      rgb = vec3(0.85, 0.85, 0.9)
  }
  return rgb
}
```

**`let x: f32` with no initializer** declares a mutable local and leaves the value for a
later assignment: WGSL's `var x: f32;`, GLSL's `float x;`, and the EDSL's `Var(f32T)`. The
annotation is what carries the type, so it is required; a `const` still needs its value.
Note what the two targets do with a read that happens _before_ the first assignment: WGSL
zero-initialises, GLSL ES 3.00 leaves it undefined. That divergence is the EDSL's today as
well; assign before you read. Both CPU backends follow WGSL and bind the zero of the declared
type at the declaration: `0.`, `false` for a `bool`, an array of zeros, and a struct with
every field zeroed, recursively through a nested struct and an array of structs.

**`&=`, `|=`, `^=`, `<<=`, `>>=`** compound the bitwise operators onto an `i32` or `u32`
target. For `&=`, `|=` and `^=` the right-hand side takes the target's type (`y &= 3` on a
`u32` is `y &= 3u`) and must have it. A SHIFT amount is a `u32` whatever the target is, which
is WGSL's only scalar overload: `y <<= 1` emits `y <<= 1u`, and an `i32` amount is passed
through the `u32(...)` cast rather than refused (`y <<= k` emits `y <<= u32(k)`). A negative
shift amount is refused, as is a negative value on a `u32` target. A float target is refused
here; `>>>=`, like `>>>`, is not supported.

**`{ pos, uv }`** is the shorthand for `{ pos: pos, uv: uv }` and builds the identical
struct; the shape `return { pos, uv }` is naturally written in.

**`switch`** takes the `break` TypeScript requires at the end of a case. It is dropped in
lowering, because the IR switch does not fall through and each backend writes its own case
terminator; a `break` that leaves a case _early_ is kept and emitted. A case label is an
integer constant: a literal, a negative literal, or a module `const`. A label has to fit the
selector, so `case -1:` is refused for a `u32` one, and a label may appear only once: two
that fold to the same number (`case 2:` beside `case 1 + 1:`) is an error here rather than at
the backend. Two labels on one body (`case 0: case 1:`) is still refused, and so is `continue`
in a `switch` that no loop encloses.

**A case body does not fall through, whatever TypeScript would do with it.** A body that does
not end in `break` still ends its case here, since the IR switch has no fall-through and
neither does WGSL's. So `case 2: { if (c) { …; break } x = … }` runs its last line and leaves,
where plain TypeScript would carry on into the next case. Write the `break`; the language
does not warn about a missing one yet, since a body without one is what an author porting
from WGSL writes.

**One emit change, and the only one in this section.** `break` at the end of a case inside a
loop was already accepted before this item, since the enclosing loop made it legal, and it
reached the backends as a statement: WGSL emitted `case 0: { r = 1.0; break; }` and GLSL
`r = 1.0; break; break;`. Both are valid programs, and both now lose that trailing `break`,
because the drop is what makes a case body mean the same thing inside a loop and outside one.
The behaviour is identical on all three backends; only the text is one statement shorter.

Last updated: 2026-09-14
