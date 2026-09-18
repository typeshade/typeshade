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

A type alias over anything else is another name for its target, which is what it means in
TypeScript (roadmap 0.3 item T2):

```ts
type Meters = f32
type Color = vec3
type Grid = array<f32, 16>
type Point = Camera
```

The alias resolves wherever a type may stand: a parameter, a return, a class field, a local
annotation, a module const, and the argument of `uniform<...>` or `storage<...>`. A chain
resolves through, and a cycle (`type A = B; type B = A`) is TS8002 naming the chain rather
than a recursion. A builtin name wins over an alias of the same name, so `type vec3 = f32`
does not make `vec3` a scalar. A generic alias has no one target type and keeps its refusal;
generics are roadmap 0.3 item T9.

A struct is the members written in it, whichever of the three spellings declared it: a method
or call signature, an index signature, an optional (`a?: f32`) member, and an `extends` clause
are each rejected, since a WGSL struct has no form for them and silently dropping one would
change the buffer layout the host fills. The optional member is the one where the three
spellings used to disagree: an interface refused it and a class emitted it as required. They
refuse it alike now. Inheritance is roadmap 0.3 item T5, which flattens the base's fields
rather than dropping them.

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

- `new Camera()` as a resource (a `new` on a class with a constructor builds a value, §26)
- `extends` (`TS8010`: the base's fields would silently vanish from the layout)
- `@compute` / `@vertex` / `@fragment` methods (an entry is a top-level function)
- no fields at all — a struct with an empty field list has no WGSL form
- a field name that is not a plain identifier (`"my-field": f32`, `[key]: f32`)

Methods, a constructor and static functions are §26: each is a function of the module, and a
method reads `this` as its first parameter.

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

Do not start Execution Graph or class methods before 2–4 are green. (Class methods landed as §26.)

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
| `.length` or `arrayLength(x)` on an `array<T>` with no `N` that is not in storage | `TS8032`. A `storage` array reads the bound buffer's length as `arrayLength(&x)` (§20); for a local, a parameter or a `uniform<array<T>>` the fix is an explicit size, `array<f32, 3>` |
| A module variable declared or used where its address space forbids | `TS8033`. A `let` with neither type nor initializer, a resource type without `declare`, a `const` with a wrapper, a `workgroup` initializer, a type the space cannot hold, an initializer that is not a constant, or workgroup memory read from a vertex or fragment entry (§24) |
| A barrier where one cannot stand | `TS8034`. `workgroupBarrier()` or `storageBarrier()` in a vertex or fragment entry, inside an `if` or `switch` body, or used as a value (§25) |
| A class member the surface does not take, or a method call the class rules refuse | `TS8035`. A getter or setter, a static field, an arrow-function field, a decorator on a method, `this` outside a method, a method called on the class or a static function on a value, a member the class does not have, a method that changes its object called on a `const`, a parameter or a dropped value, or used as a value (§26) |
| A math builtin called with arguments its signature does not take | `TS8036`. Two shapes that had to agree (`dot(vec3, vec2)`, `clamp(v, 0., 1.)` on a vector), an element kind the builtin has no form for (`sin` on an integer vector), a scalar where a vector is due (`normalize(s)`, `cross` on a `vec2`), `mix`'s factor, `refract`'s eta, `ldexp`'s exponent or a bit offset of the wrong shape, or `transpose` on a non-matrix; the fix is named (§10) |

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

**Numbering:** §§9 to 18 below are issue #8's A2, A6, A8, A9, A3, A10, A7, A11, A15 and A16,
which reserved those numbers while they were in flight and appended here in issue order. The
sections took the next free numbers so the A-item branches did not all claim §9 and collide on
merge. §19 is issue #47, §20 is issue #46, §21 is issue #38, §22 is issues #71, #68 and #20, §23 is roadmap 0.2 item 4, §24 and §25 are item 5 (design #82), §26 is design #86, and §27 is item 7.

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
| `select(f, t, c)` | `c ? t : f`. **WGSL's order: the condition is last.** The same IR the ternary builds; a vector-of-bools `c` picks per component (§27) |
| `a ** b` | `pow(a, b)`. Both operands must have one type; splat a scalar exponent |
| `reflect(i, n)`, `refract(i, n, eta)`, `faceForward(n, i, nref)` | the geometry three; `faceforward` in GLSL. `eta` is a scalar |
| `transpose(m)`, `determinant(m)` | on a `mat4`; `determinant` is an `f32` |
| `ldexp(x, e)` | `x · 2ᵉ`; `e` is an `i32`, or an integer vector of `x`'s shape. A bare literal `e` is an `i32`. GLSL ES 3.00 has no `ldexp`, so it is `x * intBitsToFloat((e + 127) << 23)` there, exact from 2⁻¹²⁶ to 2¹²⁷ |
| `countOneBits(x)`, `reverseBits(x)` | on a `u32` or `i32` or a vector of them; the `_popcnt` / `_brev` helpers in GLSL (see below) |
| `countLeadingZeros(x)`, `countTrailingZeros(x)` | 32 for zero; the `_clz` / `_ctz` helpers in GLSL |
| `firstLeadingBit(x)`, `firstTrailingBit(x)` | the result keeps `x`'s type (all ones for "none": `0xffffffff` on a `u32`, `-1` on an `i32`); the `_msb` / `_lsb` helpers in GLSL |
| `extractBits(e, offset, count)`, `insertBits(e, newbits, offset, count)` | WGSL's clamping of `offset` and `count` to the 32 bits, on the CPU too; the `_xbits` / `_ibits` helpers in GLSL. Bare literals there are `u32` |
| `dpdxCoarse(x)`, `dpdxFine(x)`, `dpdyCoarse(x)`, `dpdyFine(x)`, `fwidthCoarse(x)`, `fwidthFine(x)` | the derivatives at a stated granularity; GLSL ES 3.00 has one of each kind and picks its own, so they spell `dFdx` / `dFdy` / `fwidth` there. Fragment-only, like the plain three |

Roadmap 0.2 item 8 added the rows from `reflect` down. Each is evaluated by the CPU oracle
(the derivatives as the zero placeholder the plain ones are, under `gpuStubs`), the bit
builtins by the argument's static kind where a `u32` and an `i32` differ (a reversed top bit
reads negative, a "none" is `0xffffffff` or `-1`, an extracted field is sign-extended). `frexp`
and `modf` return a struct on WGSL and are not here yet; they come with the implicit result
struct they need on GLSL.

GLSL ES 3.00, which is what WebGL2 compiles, has none of the eight bit builtins (GLSL ES 3.10
added `bitCount`, `findMSB` and the rest, and ANGLE refuses each with "no matching overloaded
function found"). The GLSL emitter writes each as a small function over the shifts, masks and
comparisons ES 3.00 has, one overload per argument type the module calls it with, and defines
them ahead of the module's own functions: `_popcnt`, `_brev`, `_msb`, `_lsb`, `_clz`, `_ctz`,
`_xbits` and `_ibits`. A signed overload casts to the unsigned one and back, `_msb` on a
signed value first flips a negative one so the search finds the highest bit that differs from
the sign bit, and the results are WGSL's in every pinned case (32 for the zero counts, all
ones for the first bit of a zero, the clamped offset and count). The helpers were run on
ANGLE against the CPU functions over 1632 values, and the `bit-bump` example carries them
through the compile gate. A module that calls none of the eight carries none of the helpers.

**The arguments are checked (roadmap 0.2 item 9, #57, TS8036).** Until then the builtins were
lowered by arity alone: `dot(a, b)` with a `vec3` and a `vec2`, or `clamp(v, 0., 1.)` with a
vector `v`, drew no diagnostic and emitted a call Tint refuses with "no matching call". The
rules are WGSL's, one per signature shape. The componentwise builtins (`min`, `max`, `clamp`,
`pow`, `step`, `smoothstep`, `atan(y, x)`, `fma`, `distance`, `dot`, `reflect`, `faceForward`
and the rest) take arguments of one type: a scalar beside a vector is refused with the splat to
write (`vec3(x)`), two kinds of one shape with the cast (`f32(x)` or `i32(x)`), two vector sizes
as such. `mix(a, b, t)` alone takes `t` as the vectors' type or a scalar of their element kind,
and `mod(x, y)` a scalar `y` against a vector `x`. `refract` takes a scalar eta, `ldexp` an `i32`
exponent (a `vec3i` for a `vec3` `x`), `extractBits` and `insertBits` a `u32` offset and count,
`cross` two `vec3`; `normalize`, `dot` and the geometry four take vectors only, `transpose` and
`determinant` a matrix. Each builtin has its element kinds: the float ones refuse an integer
(`sin(vec3i)`, `mix` on integer vectors), `abs`, `min`, `max` and `clamp` take any number, `sign`
an `f32` or `i32`, the bit builtins an `i32` or `u32`. The diagnostic sits on the offending
argument. An emulated double (`f64`, `vec3f64`) is left to the fp64 pass, whose lifting rules are
its own. The result type follows the operand deciding the shape: `dot` of integer vectors is that
integer, and a written number in the first position takes an integer peer's kind (§13).

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
a constructor over those, arithmetic over those with a divisor that is not zero, or a **math
builtin** over those (`const K: f32 = sin(1.)`, `const UP: vec3 = normalize(vec3(1., 1., 0.))`,
`const N: i32 = max(i32(4), 8)`). A constant that calls a builtin is emitted as the call, since
a builtin over constants is a constant expression in WGSL and in GLSL ES 3.00, so the GPU
computes its own `sin(1.0)`; the front end still knows the value, so an integer one can bound
a loop, and the CPU oracle computes the same call. The annotation has to agree with the call's
type: `const K: i32 = floor(2.7)` is refused, since the emitted line would carry both. It may
not call a declared function or a derivative (`fwidth`, `dpdx`, `dpdy`), read a resource, or
take a component, field or element — `vec3(UP.x, 0., 0.)` is refused even though both writers
would fold it. `XS.length` is a constant too, so an array constant can bound a loop. An array
**of arrays** is refused: the GLSL ES 3.00 spelling it would produce is not one ANGLE accepts.

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

A module const of a struct type takes the struct its annotation names, the way a `const p: P =
{ ... }` inside a function already did (§16). That is what lets two structs of one shape be told
apart at module scope, where the field names alone cannot answer:

```ts
const ORIGIN: P = { x: 0., y: 1. } // → const ORIGIN: P = P(0.0, 1.0);
```

### `enum`

A numeric `enum` is a set of named integer constants, which is exactly what a module constant
is, so each member is one (roadmap 0.3 item T1,
[#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
enum Mode {
  Flat,
  Shaded,
  Wire,
}

enum Flag {
  None = 0,
  Lit = 1 << 0,
  Shadow = 1 << 1,
  Both = Lit | Shadow,
}
```

emits `const Mode_Flat: i32 = 0;` through `const Mode_Wire: i32 = 2;`, and `const Flag_Both:
i32 = 3;`. The values are TypeScript's own: a member counts one up from the one before it, an
explicit initializer sets the count, and a member may name one declared before it. A bare
member name means nothing outside the enum body, as in TypeScript. `const enum` is the same
here, since the members are constants either way.

`Mode.Shaded` reads the constant, the enum's name as a type is `i32`, and a member may bound a
`for` loop and stand in a `switch` case, because a constant is what those need. A `<<`, `>>`,
`&`, `|` or `^` over two whole numbers folds now, which is what makes the bit-flag form above
a constant.

Refused, with the reason: a **string** member, which no GPU type holds; a value this cannot
compute to a whole number; a value outside an `i32`; and a `declare enum`, which has no members
to emit. Reading a member the enum does not declare says so.

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
- **A written number in a builtin call's FIRST argument takes an integer peer's kind (#57).**
  An intrinsic's result type is its first argument's, and until roadmap 0.2 item 9 that position
  was never retargeted, so `min(1, i)` with an `i32` `i` typed the call `f32` and emitted
  `min(1.0, i)`, which WGSL does not accept. Now the first argument that is not a written number
  decides: `min(1, i)` is an `i32` call and `clamp(0, i, 10)` a `u32` one for a `u32` `i`, as
  `min(i, 4)` already was. A float peer changes nothing, and a builtin with no integer form
  (`pow(2, i)`) keeps its `f32` first argument, so the argument check (TS8036) names `i` as the
  odd one out.

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

### A claim about a type emits nothing

`x as T`, `<T>x`, `x as const`, `x satisfies T` and `x!` are claims TypeScript makes about a
type, not conversions, so each emits exactly what its operand emits (roadmap 0.3 item T7,
[#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
const K = 3. as const
const half = 0.5 as f32
const v = <vec2>vec2(1., 2.)
const p = { x: 1., y: 2. } satisfies P
const x = u!.x
```

The claimed type is the contextual type for what it wraps, so `satisfies P` names the struct an
object literal builds, exactly as an annotation does.

A claim that names a type the operand does not have is refused, because `as` emits nothing and
the value would then travel under a name it does not have:

```
"as" states a type, it does not convert: "0.5 as i32" is f32, not i32. Write i32(...) to
convert, or drop the "as".
```

That is TypeScript's own meaning of `as`, said at the one place where letting it pass would
produce a program whose types disagree with its emit.

### A destructuring declaration is the reads it stands for

`const { x, y } = v` is the two reads it abbreviates, so it lowers to one declaration per name,
in the order written (roadmap 0.3 item T7,
[#92](https://github.com/typeshade/typeshade/issues/92)). Both shapes a shader has fields on can
be read this way: a struct, by field name, and a vector, by component name or by a swizzle.

```ts
const { x, y: b } = uv          // let x = uv.x;  let b = uv.y;
const { xy } = uv               // let xy = uv.xy;
const { a, k } = u              // let a = u.a;   let k = u.k;
const { i: { a } } = u          // let a = u.i.a;
let { x } = uv                  // var x: f32 = uv.x;
```

The value on the right is evaluated once. A bare name is read again for each field, since
reading a name costs nothing and names no new local; anything else is bound to an internal local
first, so `const { x, y } = uv * 2.` emits the product once and reads `x` and `y` off it. That
local takes an IR name of its own and no source name, so a program may declare `_d` itself and a
block may hold two such declarations.

A pattern takes no type annotation, since each name takes the type of the field it reads. Three
shapes have no form here and name the read to write instead: a default (`{ x = 1. }`), which
needs a value that may be absent; a rest (`{ ...r }`), since a struct is exactly its fields and
has no remainder to name; and a computed name, which would choose a field at run time. An array
pattern (`const [a, b] = v`) is refused and names the read to write instead: a vector by
component, an array by index.

### A default parameter value is filled in at the call site

`function vignette(uv: vec2, strength: f32 = 0.8)` is ordinary TypeScript, and `vignette(uv)` is
how it is then called (roadmap 0.3 item T7,
[#92](https://github.com/typeshade/typeshade/issues/92)). Neither target has default arguments,
so the emitted function keeps every parameter and the missing ones are written where the call
is:

```ts
function vignette(uv: vec2, strength: f32 = 0.8, softness: f32 = 1.35): f32 { ... }
vignette(uv)            // vignette(uv, 0.8, 1.35)
vignette(uv, 0.5)       // vignette(uv, 0.5, 1.35)
```

A default works on a function, a method, a static function and a constructor. It is lowered
once, at the declaration, in the module's scope, so it may read a module const, a binding, a
module variable or an `override`, build a struct, and call another function, including one
declared later or one with a default of its own. An integer default takes its parameter's kind
the way a written argument does, so `b: i32 = 3` emits `3` and not `3.0`.

A default may not read another parameter of the same function, or `this`. At the call site that
parameter is an expression rather than a value, so `b: f32 = a * 2.` would emit the argument for
`a` a second time and run whatever it calls twice. Compute from the other parameter in the body
instead. Two more shapes have no value to fill from and say so: a default on an entry
parameter, which comes from the pipeline and not from a call, and a default that calls a
function whose own default waits on it.

`b?: f32` stays refused, and now names the default to write instead: a shader value is always
present, so a body has no "absent" to test for.

A call that still omits a parameter without a default reports the range: `"f" takes 2 to 3
argument(s), got 1`. TypeScript allows a default before a required parameter (`f(a = 1., b: f32)`),
where both arguments are required; only the trailing run of defaults fills in, which is
TypeScript's own rule.

One thing the fill changes beyond the call: a default carries its calls into the body that wrote
the call, so `g` whose body is `return f()`, where `f` defaults to `g()`, emits `f(g())` and
calls itself. That is a call cycle, and it is refused as one, at the call that closes it.

## 15. Textures, samplers and overrides

Three declarations the surface had no spelling for. None of them is a new IR shape: a
`texture`/`sampler` `ShaderType` and `ModuleDecl.overrides` have been there all along, and the
EDSL builds them with `resource(name, texture2dfT, …)` and `overrideConst(name, type, default)`.

```ts
"use typeshade"

declare const tex: texture_2d<f32>
declare const atlas: texture_2d_array<f32>
declare const smp: sampler
const tint: override<f32> = 0.85
declare const bias: override<f32>

class Color {
  @location(0) color: vec4
}

@fragment
export function fs(@location(0) uv: vec2): Color {
  const a = textureSample(tex, smp, uv)
  const b = textureSample(atlas, smp, uv, 1)
  const c = textureSampleLevel(tex, smp, uv, 0.)
  const d = textureLoad(tex, vec2i(i32(0), i32(0)), 0) // vec2i(0, 0) is A3, not yet landed
  const size = textureDimensions(tex)
  const layers = textureNumLayers(atlas)
  const k = tint + bias + f32(size.x) + f32(layers)
  return { color: (a + b + c + d) * k }
}
```

**A texture and a sampler are written bare**, with no `uniform<>` or `storage<>` wrapper, because a
handle lives in no address space. They take the next binding slot in declaration order like any
other resource, and must be `const`. `texture_2d<T>` and `texture_2d_array<T>` take `f32`, `i32`
or `u32`; the element decides both the WGSL spelling and which reads apply.

**The read a call becomes is decided by the texture, not by the argument count.**
`textureSample(atlas, smp, uv, 1)` on an array texture is the neutral id `textureSampleArray`,
which WGSL spells with the layer as its own argument and GLSL ES 3.00 folds into a `vec3`
coordinate, which is the same choice the EDSL's overloads make. A **layer** is an `i32` and a
`textureLoad` **level** is a `u32`, so `textureLoad(t, c, 0)` emits `textureLoad(t, c, 0u)`
rather than the `0.0` that no backend accepts.

Sampling is float-only: an integer texture has no filtering, so `textureSample` on one is
refused and names `textureLoad` instead. On GLSL ES 3.00 the texture and the sampler fuse into
one `sampler2D`, and the sampler argument disappears from the call.

**An override is a specialization constant**: the pipeline sets it, so no pass folds it and it
occupies no binding slot. `const q: override<f32> = 0.5` states the default; `declare const q:
override<f32>` has nowhere to put one and takes the type's zero. It must be a scalar
(`f32`, `i32`, `u32`, `bool`) and the default must be a literal of that type, since the declaration
each backend emits carries it, so it has to be known here, and `override<bool> = 1` is refused
rather than emitted as `override q: bool = 1.0;`, which neither compiler accepts. WGSL emits
`override q: f32 = 0.5;`; GLSL ES 3.00 has no equivalent and emits a `#define`.

**An override may not take the name of a struct field or a resource.** That `#define` is a
preprocessor substitution, so it rewrites every later occurrence of the name, a declaration
included: an override called `uv` beside a `@location(0) uv` varying emitted `#define uv 0.85`
above `in vec2 uv;`, which ANGLE reads as `in vec2 0.85;`. The collision is refused at the
declaration; the WGSL was always fine, which is exactly why nothing caught it.

**A layer and a mip level are whole numbers of 0 or more.** A fractional or negative one is
refused rather than emitted: WGSL rejects it and GLSL ES 3.00 silently rounds, so the two
targets would disagree about the same source. That is the rule the EDSL raises `SD0015` for.

**These five names are reserved**: `textureSample`, `textureSampleLevel`, `textureLoad`,
`textureDimensions`, `textureNumLayers`. A function you declare with one of those names is
refused, the way `mod` and `clamp` have always been. A name that was *only* a user function
before this item is the one thing that changes here.

Left for later: `texture_2d_ms<f32>`, whose multisampled load neither backend here reaches, and
the storage-texture forms.

## 16. Object literals take the declared struct

Which struct `{ … }` builds comes from the type the position **declares**: a function's
return type, a `let`/`const` annotation, or a parameter type.

```ts
"use typeshade"

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class FsIn {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

export function shade(o: FsIn): f32 {
  return o.uv.x
}

@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  const p = vec2(0., 0.)
  return { pos: vec4(p, 0., 1.), uv: p } // the return type says VsOut
}

export function pick(): f32 {
  const a: FsIn = { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) } // the annotation says FsIn
  return shade(a) + shade({ pos: a.pos, uv: a.uv }) // the parameter says FsIn
}
```

Matching the field **names** against the struct table is the fallback, for a position that
declares nothing (`const o = { … }` with no annotation). It stays because it is often enough,
but it could never answer the case above: `VsOut` and `FsIn` have the same fields, so the name
set does not distinguish them and the literal was rejected inside a function that states
exactly which one it returns.

A declared struct also improves the diagnostics, because there is something to name:

| | before | after |
| --- | --- | --- |
| `return { a: 1. }` for a two-field `P` | `Object literal { a } does not match a known struct.` | `Missing field "b" for struct P.` |
| `return { a: 1., c: 2. }` | `Object literal { a, c } does not match a known struct.` | `Struct P has no field "c".` |

The context reaches **inward**: the struct is resolved before the field values are lowered, so
a nested literal is built against the type of the field it fills. `{ i: { x: 1. } }` for an
`Outer { i: Inner }` picks `Inner` even where a same-shaped `InnerTwin` exists.

**Three more positions declare a type without an annotation of their own**, and each one
takes it:

| | where the type comes from |
| --- | --- |
| `o = { a: 3., b: 4. }` | the target's own declaration, carried to the assignment |
| `c ? { … } : { … }` | the ternary's position, passed to both arms |
| `array<Q, 2>({ … }, { … })` | the constructor's type argument |

What is left to name matching is a position that declares nothing at all: a literal as an
operand, an index, or the base of a property access. A twin is unresolvable there, as before.

A contextual type that is not a struct is ignored here rather than reported, because
`const o: f32 = { a: 1. }` is a mistake about the declaration. That does not always mean the
declaration is what names it: the literal is lowered first, so with twins in scope the
fallback fails before the declaration's check runs and you get
`Object literal { a, b } does not match a known struct.` plus `Unknown identifier "o".`
instead. The position still owns the mistake; it does not always get to be the one that
reports it.

A **repeated** field keeps taking the last value, in every position, as it always has:
`{ a: 1., a: 2., b: 3. }` builds `P(2., 3.)`. TypeScript's own `TS1117` reports it in the
editor, so the compiler does not repeat the complaint.


## 17. What a `for` loop may say, and what it is told

A `for` must be **counted**: an integer induction variable, a constant bound, a constant step,
and at most 256 trips. That has not changed. Three things about it have.

**The step may scale, not only add.** The four update forms are `+=`, `-=`, `*=` and `/=`:

```ts
"use typeshade"

export function shrink(): f32 {
  let a = 0.
  for (let i: i32 = 64; i > 1; i /= 2) {
    a += 1. // 64 32 16 8 4 2, six trips
  }
  for (let j: i32 = 1; j < 64; j *= 2) {
    a += 1.
  }
  for (let k: i32 = 8; k > 0; k -= 2) {
    a += 1.
  }
  return a
}
```

A halving loop over a mip chain or a doubling one over a binary reduction is an ordinary
counted loop: it reaches its bound in six iterations, and the only reason it was
`Unsupported for-update.` is that nothing read it. `%=` is arithmetic too and stays out, not
for want of a lowering: a remainder step is a fixed point after one application, whatever the
start, so no `for` it heads would exit.

**A loop that exits too late is told that, not that it does not exit.** The trip count is
computed rather than walked, so the answer is exact at any size:

| | before | after |
| --- | --- | --- |
| `for (let i: i32 = 0; i < 1024; i++)` | `for (i = 0; i < 1024; step 1) does not exit.` | `for trip count 1024 exceeds 256.` |
| `for (let i: i32 = 0; i < 16; i--)` | `for (i = 0; i < 16; step -1) does not exit.` | `for (i = 0; i < 16; i -= 1) does not exit.` |

The old counter walked the sequence and could only look 258 steps ahead, so a policy violation
and a non-terminating loop shared one message. They are different mistakes and the fix for each
is different: the first wants a smaller bound, the second a step that moves toward it. The
second row is the loop that really does not exit, so it keeps its sentence; what changes there
is only how the step is spelled back, since `i--` and `i -= 1` reach the counter as one step.

**A loop that runs out of its type is a third answer**, and it used to wear the second one.
`for (let i: i32 = 1; i < 2147483647; i *= 3)` does reach its bound, but only once `i` has
passed what an `i32` holds, so what the hardware does on the way is an overflow and not an
exit. It says `walks "i" outside the range of i32 before the condition fails.` and carries
`TS8006` rather than `TS8007`, because that is a statement about the bound and not about
termination.

A step that cannot advance the variable says which way it fails: `i += 0`, `i *= 1`, `i *= 0`
and `i /= 0` each get their own reason instead of one sentence about a step of 0. `i /= 0` is
stuck rather than unpredictable, and the message says so: WGSL defines integer `x / 0` as `x`.

A step the induction type cannot **hold** is refused at the source rather than retyped:
`i *= 2.5` on an `i32` counter reads `does not fit "i", which is i32: 2.5 is not a whole
number.`, and `i += 3000000000` reads `is outside its range.` Both used to become a literal of
the counter's type that only the backend could refuse, naming a number the source does not
contain. A step **written** as a float but valued as a whole number (`i += 2.0`) is still
accepted, exactly as §13 accepts `let y: i32 = 0.`

**What this does not cover.** A `while` is not trip-counted. It needs a compile-time-constant
bound in its condition, but nothing checks that its body moves toward that bound, so
`let w: i32 = 0; while (w < 4) { a += 1. }` compiles today with no diagnostic and spins on the
device. And the multiplicative step has no `fn()` EDSL spelling, so `ir-equality.test.ts` has
no twin to pin `i *= 2` against; the CPU trip count in `loop-shapes.test.ts` stands in for that
until `forRange` takes a step operation.

## 18. A list as an array's initializer

An `array<T, N>` takes a list where its type is written, in a function body and at module
scope:

```ts
"use typeshade"

export function ramp(i: i32): f32 {
  const stops: array<f32, 3> = [0., 0.5, 1.]
  const weights: array<i32, 3> = [1, 2, 1]
  let scratch: array<f32, 2> = [0., 0.]
  scratch[0] = stops[i] * f32(weights[i])
  return scratch[0]
}
```

It is the same declaration `array<f32, 3>(0., 0.5, 1.)` makes: the same `construct` node and the
same emitted text, so the two spellings are one program, and `src/compiler/ts/ir-equality.test.ts`
pins both against the EDSL's `construct(arrayT(f32T, 3), …)`.

A list carries no type of its own, which is what decides where it is allowed and what it
means:

- It is **only** an initializer, and only where the declaration states an `array<T, N>`.
  `const xs = [1., 2.]` and `sum([1., 2.])` are refused, each naming the spelling that works.
- The size must be fixed and must match: `array<f32>` has nothing to fill, and
  `array<f32, 3> = [1., 2.]` is an arity error.
- Every element must be the element type. There is no implicit conversion, so
  `array<f32, 2> = [1., i32(2)]` is refused rather than silently widened.
- A number **written** in the list takes the element type by the same rule §13 gives a scalar
  declaration, so `array<i32, 3> = [1, 2, 3]` emits `array<i32, 3>(1, 2, 3)` and
  `array<i32, 2> = [1., 2.]` is accepted the way `const x: i32 = 1.` is. What that rule
  refuses, the element check reports: `array<i32, 2> = [1.5, 2]`, `array<u32, 2> = [-1, 2]`
  and `array<i32, 2> = [3000000000, 2]` each name the element and its type. A value that
  states its own type, `i32(2)`, keeps it.
- An **array of arrays** is refused, list or call: GLSL ES 3.00 has none. Measured through the
  compile gate, `array<array<f32, 2>, 2>` passes Tint and fails the WebGL2 context with
  *arrays of arrays supported in GLSL ES 3.10 and above only*, so the two targets would
  disagree about the same source. Flatten it: one `array<f32, 4>` indexed by
  `row * width + column`.
- A spread and a hole are refused: `[...xs]` would need the size of `xs` at lowering time.

The call form is not the same in one respect: `array<i32, 3>(1, 2, 3)` still lowers each
argument on its own and emits `array<i32, 3>(1.0, 2.0, 3.0)`, which neither target accepts.
That is a gap in the call site, not in the list, and #8's A3 did not close it.


---

## 19. A call as a statement

A function may be called for what it does, with its result dropped. This is the shape every
side effect in a shader takes: a helper that writes a storage binding today, and the
`workgroupBarrier()`, `textureStore(...)` and `atomicAdd(...)` family that lands on the same
statement.

```ts
"use typeshade"
declare let dst: storage<array<f32>>

function store(i: u32): void {
  dst[i] = 1.
}

@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  store(gid.x)
}
```

```wgsl
fn main_k(@builtin(global_invocation_id) gid: vec3<u32>) {
  store(gid.x);
}
```

**The call lowers through the path every call takes**, so the callee, arity and argument rules
are the ones §10 and the function rules give; only the statement form is new. The IR carries
it as its own statement (`call`), and each writer spells it: WGSL takes a user function's
dropped result bare and needs the phony assignment before a value-returning builtin, since
Tint treats every such builtin as `@must_use`, so `max(a, b)` as a statement emits
`_ = max(a, b);`. GLSL ES 3.00 takes the bare call in every case. The CPU oracle, the CPU
codegen and the debug stepper evaluate the call for its effect.

**A value-returning builtin may stand alone**, as it may in TypeScript (`Math.max(a, b);` is
legal), and the optimizer drops it as the nothing it computes. **A value that is not a call
may not**: `vec3(1., 2., 3.)`, a `select`, an array fold build a value and drop it, and the
statement is refused (TS8099) with the two ways out, assign the value or remove the line.

**A call that writes a binding is the one impure expression the IR has**, and the optimizer
knows it. The effect table (`src/core/passes/effects.ts`) names the bindings each function
writes, itself or through the functions it calls. Dead-code elimination keeps a `call`
statement exactly when its call has an effect. Common-subexpression elimination, value
numbering and loop-invariant motion leave a function that makes an effectful call alone, and
a read of a binding some callee writes is never shared across the call: two `bump(i)` in a
row stay two, and a `dst[i]` read after them is a second read. The linear inliner does not
lift a helper whose prelude holds a call statement, since splicing it ahead of the `if` that
guarded the call site would run the effect on a path that never called.

**What this does not cover.** The portable compute tier (§ the `portable` kernel shape) refuses
a call statement anywhere in the entry's reach: its single store is a plain assignment written
in the entry, and a store hidden in a callee is not one the fragment-GPGPU lowering can follow.

---

## 20. The length of a runtime-sized storage array

A `storage<array<T>>` has no size in its type; its length is the length of the buffer the
host binds. `xs.length` on such an array reads it at run time, and `arrayLength(xs)` spells
the same read explicitly. Both are a `u32`, as the WGSL builtin is.

```ts
"use typeshade"
declare const src: storage<array<f32>>
declare let dst: storage<array<f32>>

@compute([64, 1, 1])
export function scale_all(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= src.length) {
    return
  }
  dst[gid.x] = src[gid.x] * 2.
}
```

```wgsl
if ((gid.x >= arrayLength(&src))) {
  return;
}
```

**What the operand may be** is what WGSL's `arrayLength` accepts: a pointer to a runtime-sized
array in the storage space, which is the binding itself or a trailing array field of a storage
struct (`arrayLength(b.xs)` for `declare const b: storage<Buf>`). Measured on Tint,
`arrayLength(&src[0])` is refused and `arrayLength(&b.xs)` accepted, and the front end draws
the same line: an element, a sized array or a value that is not an array is refused (TS8003)
with what it is. A local that copies the binding (`const a = src`) denotes what the binding
denotes, so `a.length` reads the same length.

**An unsized array that is not in storage has no runtime length.** A `uniform<array<f32>>`, a
local `array<f32>` or a parameter typed `array<f32>` was already invalid GPU code (Tint:
"runtime-sized arrays can only be used in the <storage> address space"), and `.length` or
`arrayLength` on one is refused (TS8032) with the one fix that works: give the type a size,
`array<f32, 3>`. A sized array's `.length` stays the compile-time `i32` it always was.

**The CPU oracle** reads the bound buffer's length, so `compile().eval` and the debug stepper
agree with the GPU. **GLSL ES 3.00 has no form**: it has no storage buffer and no runtime-sized
array (`.length()` on one is GLSL ES 3.10), so a module with a runtime-sized storage array emits
WGSL alone, as it did before this. The `array-length` example is registered WGSL-only for that
reason, like `compute-reduction-twin`.

**A loop over such an array is still not written as `for (…; i < src.length; …)`**: §17 asks a
`for` to compare its counter to a constant bound, and a runtime length is not one. Guard the
invocation with `if` and index by `gid.x`, as the example does.

A function you declare with the name `arrayLength` keeps winning the call, the way the names
§10 added do, so no program that compiled before this section compiles differently.

---

## 21. Block scope

TypeScript scopes a `const` or `let` to its block, and two blocks may declare one name: two
sequential loops over `i`, a `p` in a loop body and a `p` in an `if` arm, an inner `p` that
shadows an outer `p` or a parameter. The front end always resolved names that way. The IR did
not follow, because it identifies a local by its name alone within a function and every
optimizer pass keys a function-wide map on it; the lowerer handed both bindings one name, and
the emit refused the module with `SD0112` at line 1 of the file (issue #38).

**Rule:** the second and later declarations of a name in one function take the IR name
`name_1`, `name_2`, and so on. The first keeps the source name. Resolution is unchanged: inside
its block an inner declaration shadows the outer one, and the code after the block reads the
outer one again. The renamed binding is always the later one, so nothing emitted before the
inner block moves.

```ts
"use typeshade"

@fragment
export function fs(): vec4 {
  let a = 0.
  for (let i: u32 = 0; i < 4; i++) {
    a = a + f32(i)
  }
  for (let i: u32 = 0; i < 3; i++) {
    a = a + f32(i) * 2.
  }
  return vec4(a, 0., 0., 1.)
}
```

emits the first loop over `i` and the second over `i_1`. A local in a nested block that shadows
a resource binding or a module const is renamed the same way (`dst_1`), so the binding's own
name stays the binding's and a write through it is still a binding write to every pass.

**What the rename does not change.** Diagnostics and the symbol table (hover, rename,
references) use the name as the author spelled it; a loop diagnostic about the second `i` says
`i`. What stays refused is what TypeScript refuses or what this surface refused before: a name
declared twice in one block (TS8023), and a name at the top of a function body, or a parameter,
that repeats a module-level declaration (TS8023; the parameter case threw out of the compiler
before, issue #68). The debug stepper reports a local by its IR name for now, so a shadowed `p`
steps as `p_1`.

---

## 22. Constant checks on a shift amount and a divisor

Two more things a program is told at compile time instead of by the driver, and one spelling
the GLSL writer owed the compound assignment.

**A shift amount is 0 to 31.** WGSL requires the amount of `<<` and `>>` on a 32-bit integer
to be less than 32 when it is a constant, and masks a run-time amount to its low five bits;
GLSL ES 3.00 leaves both undefined. So `x << 32` is `x << 0` on one target and anything on the
other. An amount the front end can fold (a literal, arithmetic over literals, a module const)
that is outside 0 to 31 is refused with TS8003, for `x >> 33`, `x >> (16 + 16)` and `x <<= 32`
alike (issue #71). A run-time amount passes; the mask is the GPU's business.

**A divisor that is provably zero is refused where the division is lowered.** The proof is a
componentwise constant folder over literals, negation, vector constructors, whole module consts
(a scalar by its value, a vector by its initializer) and arithmetic over those. One zero
component is enough, because the division is componentwise and Tint refuses the module for the
component it cannot represent. The refusal is TS8003, `Division by zero: "K" is 0 on every
invocation`, in a function body, in a compound `/=` or `%=`, and in a module const's initializer,
which used to be the one place it was checked (issue #68). A divisor the folder cannot prove
anything about passes: the point is to refuse what is certainly undefined, not to demand a proof
of safety.

**A float `%=` on GLSL ES 3.00** is written `x = (x - y * trunc(x / y));`, the `floatMod`
spelling the binary `%` has always taken there, because GLSL's `%` is for integers. The compound
assignment wrote `x %= y;` and the driver refused it while the WGSL beside it was fine (issue
#20). WGSL keeps `x %= y;`, and an integer `%=` keeps the native operator on both.

```ts
"use typeshade"
const K: f32 = 4.

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let bits: u32 = u32(uv.x * 255.) >> 4
  bits <<= 2
  let x: f32 = uv.y / K
  x %= 0.5
  return vec4(f32(bits) / 255., x, 0., 1.)
}
```

---

## 23. Atomics

Many invocations write one location at once in a histogram, a counter, a reduction. A plain
`bins[i] = bins[i] + 1` loses counts, because two invocations read the same old value. WGSL's
answer is the atomic type and its builtins, and this surface carries them (roadmap 0.2 item 4).

**The type.** `atomic<u32>` and `atomic<i32>` are locations in storage memory, never values. They
are declared inside a `storage<...>` binding with `let`: an array of them, a field of a storage
struct, or a bare binding.

```ts
"use typeshade"
class Summary {
  count: atomic<u32>
  maxBin: atomic<i32>
}
declare const src: storage<array<f32>>
declare let bins: storage<array<atomic<u32>>>
declare let summary: storage<Summary>

@compute([64, 1, 1])
export function histogram(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(src)) {
    return
  }
  const bin = u32(clamp(src[gid.x], 0., 0.999) * 8.)
  atomicAdd(bins[bin], 1)
  const before = atomicAdd(summary.count, 1)
  atomicMax(summary.maxBin, i32(bin))
}
```

**The builtins.** The location is written as the plain expression, and the WGSL writer spells
the pointer: `atomicAdd(bins[bin], 1)` emits `atomicAdd(&bins[bin], 1u)`. `atomicLoad(x)` reads
the location; `atomicStore(x, v)` writes it and returns nothing; `atomicAdd`, `atomicSub`,
`atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor` and `atomicExchange` each take a
value, update the location as one indivisible step, and return the value it held before. A bare
integer literal in the value position takes the atomic's own integer type, and integer
arithmetic wraps at 32 bits. A result nobody binds is dropped behind WGSL's phony assignment, as
§19 drops any builtin's.

**What is refused, and told the fix.** An atomic is never read or assigned directly: `bins[i]`
outside an atomic builtin, as a value or as an assignment target, is TS8003 naming
`atomicLoad`, `atomicStore` and `atomicAdd`. Every atomic builtin needs read_write access, so a
`declare const` binding is TS8005 with "declare it with let". A value of another type
(`atomicAdd(bins[i], 1.5)`) is TS8003, a location that is not atomic is TS8003, the wrong number
of arguments is TS8019. An atomic declared as a local, a parameter or a return type, or inside a
`uniform<...>`, is TS8099 with where it may live; `atomic<f32>` is TS8002.

**The optimizer** treats every atomic builtin as an effect: two `atomicAdd` calls on one
location are both kept, an `atomicLoad` is never shared across a store to the same binding, and
a helper that only calls `atomicAdd` on a binding counts as writing that binding in the effect
table of §19. **The CPU oracle** runs invocations one after another, so its atomics are plain
reads and writes in that order; the oracle, the CPU codegen and the debug stepper agree on every
kernel in the tests, and a host reads the counts back from the arrays it bound. **GLSL ES 3.00**
has no storage buffers and no atomics, so a module carrying one emits WGSL alone, like §20's; the
`atomic-histogram` example is registered WGSL-only and the compile gate runs it on Tint.

A function you declare with an atomic builtin's name keeps winning the call, the way the names
§10 added do, so no program that compiled before this section compiles differently.

---

## 24. Module variables

Two kinds of memory a kernel needs that are neither a resource nor a local: a value each
invocation owns for its whole run, across every function it calls (WGSL's `var<private>`), and
memory one workgroup's invocations share (WGSL's `var<workgroup>`). Roadmap 0.2 item 5,
design [#82](https://github.com/typeshade/typeshade/issues/82).

**Spelling.** A top-level `let` is a module variable. Plain, it is the per-invocation one:
`let seed: u32 = 7` is what a module-level `let` means to a TypeScript reader, a value this run
of the program owns, and in a shader the run is the invocation. Workgroup memory has no
TypeScript counterpart, so it is always written out, as a wrapper type on the annotation the
way a resource is a `declare const|let` with `uniform<T>` or `storage<T>`:
`let tile: workgroup<array<f32, 64>>`. The per-invocation space has the same kind of wrapper,
`perInvocation<T>`, for a writer who wants the space on the line. No `declare`: `declare` stays
the mark of a value the host provides, and a module variable is the module's own.

```ts
"use typeshade"
declare const src: storage<array<f32>>
declare let dst: storage<array<f32>>

let tile: workgroup<array<f32, 64>>
let seed: u32 = 7

function next(): u32 {
  seed = seed * 1664525 + 1013904223
  return seed
}

@compute([64, 1, 1])
export function k(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  tile[lid.x] = src[gid.x]
  dst[gid.x] = tile[lid.x] + f32(next() >> 24)
}
```

- A plain `let seed: u32 = 7` emits `var<private> seed: u32 = 7u;`. The initializer is
  optional and a constant expression by §12's measure (a literal, a module const, arithmetic or
  a math builtin over those; a list for an array, an object literal for a struct); without one
  the variable is zero. Without an annotation the type is the initializer's, by the rule a
  `const` follows: `let v = 1.5` and `let n = 7` are both f32, and `let n: u32 = 7` is the
  integer. Any stage may use it. `let seed: perInvocation<u32> = 7` is the same variable with
  its space written out; the name is not WGSL's `private` because TypeScript reserves that
  word in strict mode, and every module is strict.
- `workgroup<T>` emits `var<workgroup> tile: array<f32, 64>;`. It takes no initializer (WGSL
  forbids one) and is zero at the start of each workgroup. Only a compute entry, and the helpers
  it calls, may read or write it; a vertex or fragment entry that names it is refused (TS8033).
- `T` is a scalar, a vector, a matrix, a sized array or a struct of those, and in
  `workgroup<T>` an `atomic<u32>` or `atomic<i32>` (WGSL allows atomics in workgroup memory; §23's
  builtins take a workgroup location too). A texture, a sampler, a runtime-sized array, or an
  atomic in a per-invocation variable is refused with the reason (TS8033).

**What a per-invocation variable is not: shared.** In JavaScript a module-level `let` is one
value every call sees. In a shader each invocation has its own copy, and nothing one invocation
writes to it reaches another. Memory the invocations of one workgroup share is `workgroup<T>`;
memory every invocation shares is a `storage` binding.

**What is refused.** A `let` with neither a type nor an initializer, a list without an array
type, a resource type without `declare` (`let x: storage<array<f32>>` is a binding that lost
its `declare let`), a non-constant initializer, an initializer of another type, and a type the
space cannot hold are TS8033 with the fix. A `const` with a wrapper type is TS8033: a `const` is
a module constant (§12). A repeated name, or a name a const or a binding already has, is
TS8023. A top-level `var` stays TS8014.

**In the IR and the emit.** A module variable is `ModuleDecl.vars`, not a binding: it has no
group, no binding and no layout, and `reflect()` reports nothing for it. WGSL emits it between
the consts and the bindings. GLSL ES 3.00 emits a per-invocation variable as a plain global,
which is per-invocation there too, so a fragment shader that keeps generator state in one
renders on both targets; workgroup memory has no WebGL2 form, so a module with one emits WGSL
alone. The effect table (§19) counts a write to a module variable as a write, so a helper that
only writes `seed` is a writer and no pass drops or moves the call.

**On the CPU.** The oracle runs one invocation per call. A per-invocation variable starts from
its initializer at every host-facing call, and keeps its value across the calls that
invocation makes inside the module. Workgroup memory is one implicit workgroup's for the
module's lifetime: zero when the module is compiled, then whatever the invocations left in
it. A barrier, and the lockstep `dispatch` that gives one invocation another's slot to read,
is §25; a kernel without one should touch its own slot, as `workgroup-scratch.shade.ts` does.
The oracle, the CPU codegen and the debug stepper agree.

---

## 25. Barriers, and running a workgroup on the CPU

`workgroupBarrier()` and `storageBarrier()` are the two statements that make workgroup memory
(§24) useful: every invocation of the workgroup runs the statements before the barrier, then
every one runs on, and what each wrote before it is what every other reads after it. Roadmap
0.2 item 5, design [#82](https://github.com/typeshade/typeshade/issues/82), step 2.

```ts
"use typeshade"
declare const src: storage<array<f32>>
declare let sums: storage<array<f32>>

let tile: workgroup<array<f32, 64>>

@compute([64, 1, 1])
export function reduce(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
): void {
  tile[lid.x] = src[gid.x]
  workgroupBarrier()
  for (let stride: u32 = 32; stride > 0; stride /= 2) {
    if (lid.x < stride) {
      tile[lid.x] = tile[lid.x] + tile[lid.x + stride]
    }
    workgroupBarrier()
  }
  if (lid.x === 0) {
    sums[wid.x] = tile[0]
  }
}
```

**A barrier is a statement.** It takes no argument and has no value: `const x = workgroupBarrier()`
is TS8034. Both emit bare on WGSL, `workgroupBarrier();`, and never behind §19's phony
assignment. GLSL ES 3.00 has no compute stage, so a module with one emits WGSL alone.

**Where it stands.** WGSL requires a barrier in uniform control flow in the compute stage, and
this surface states the same two rules at the call (TS8034): in a compute entry or a function it
calls, never in a vertex or fragment entry, which has no workgroup; and never inside an `if` or
`switch` body. A branch on a value the invocations do not share is how a workgroup waits
forever. A `for` with §17's constant bound is uniform and allowed, which is the shape the
reduction above needs: the loop steps by `/= 2`, one of §17's four counted steps. The optimizer
treats a barrier as an effect (§19), so it is never dropped, merged or moved, and no read of
workgroup memory crosses it.

**Running it on the CPU.** The oracle runs one invocation per call, and a barrier has no one to
wait for there: calling `fns.reduce(...)` on a kernel with a barrier throws and names
`dispatch`. `compileModule(m).dispatch(entry, workgroups)` and `compileModuleJs(m).dispatch(...)`
run a `@compute` entry over `workgroups` workgroups of its declared size (one number for a 1-D
grid, or the three counts), every invocation of a workgroup in lockstep: each invocation runs
until the statement it is about to execute is a barrier, and only when every live invocation of
the workgroup has arrived do all of them run on. The builtin parameters are filled in
(`global_invocation_id`, `local_invocation_id`, `local_invocation_index`, `workgroup_id`,
`num_workgroups`), workgroup memory starts zero for each workgroup, a per-invocation variable
at its initializer for each invocation, and the bindings are the ones `setBinding` supplied,
arrays written in place and a scalar handed back. The result names the workgroups, the
invocations and the barrier phases. A kernel with no barrier may still be run one invocation at
a time through `fns`.

**Divergence is an error.** Invocations of one workgroup that do not agree about a barrier,
some returning before it or waiting at a different one, are a program WGSL forbids and a GPU
hangs on. `dispatch` throws instead, naming the barrier's line and the counts:
`workgroupBarrier() at line 14 was reached by 61 of 64 invocations of workgroup (0, 0, 0); 3
returned before it.` This is the first divergence report roadmap item 21 asks for. The debug
stepper steps one invocation alone and refuses a barrier with the same words as a direct call:
the values past it would be ones no workgroup produces.

**Also in this step.** A call that returns nothing can no longer initialize a local:
`const x = store(1)` emitted `let x = store(1u);`, which Tint refuses, with no diagnostic; it is
TS8003 now with "call it on its own line".

---

## 26. Classes with methods, a constructor and static functions

A class stays a struct (§2): its fields are the struct's fields, with their decorators and
layout, and the object literal still builds one. What a class may now also declare are
functions of the module: methods, a constructor and static functions. Design
[#86](https://github.com/typeshade/typeshade/issues/86); this is its first step.

```ts
"use typeshade"
class Ray {
  origin: vec3
  dir: vec3
  hits: u32 = 0
  constructor(origin: vec3, dir: vec3) {
    this.origin = origin
    this.dir = normalize(dir)
  }
  at(t: f32): vec3 {
    return this.origin + this.dir * t
  }
  static up(): vec3 {
    return vec3(0., 1., 0.)
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const r = new Ray(vec3(uv, 0.), vec3(0., 0., 2.))
  return vec4(r.at(1.) + Ray.up(), f32(r.hits))
}
```

**What each one lowers to.** A method is a function whose first parameter is the struct, and
`this` reads as that parameter: `Ray_at(self_: Ray, t: f32) -> vec3<f32>`, with `this.origin`
spelled `self_.origin`. The call `r.at(1.)` is `Ray_at(r, 1.0)`. A static function is a
function with no receiver, `Ray_up()`, called on the class: `Ray.up()`. The constructor is
`Ray_new(origin, dir) -> Ray`: it starts from the zero struct, assigns each field initializer
in declaration order (`hits: u32 = 0`), runs the body with `this` as that local, and returns
it; `new Ray(a, b)` is a call of it. A class with no constructor still answers `new P()` with
the zero struct and its field initializers, spelled out on both targets since GLSL ES 3.00
leaves a bare declaration undefined. WGSL and GLSL ES 3.00 both take a struct parameter by
value and both spell a struct constructor, so both targets carry every one of these as
written; the IR is the functions and structs it already had, so the oracle, the CPU codegen
and the debug stepper run them unchanged.

```wgsl
fn Ray_at(self_: Ray, t: f32) -> vec3<f32> {
  return (self_.origin + (self_.dir * t));
}
fn Ray_up() -> vec3<f32> {
  return vec3<f32>(0.0, 1.0, 0.0);
}
fn Ray_new(origin: vec3<f32>, dir: vec3<f32>) -> Ray {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Ray = Ray(_cse0, _cse0, 0u);
  self_.hits = 0u;
  self_.origin = origin;
  self_.dir = normalize(dir);
  return self_;
}
```

The constructor starts from the zero struct spelled out, since GLSL ES 3.00 leaves a bare
declaration undefined where WGSL zeroes it, and a field the body never assigns has to read the
same on both. A struct with a matrix field falls back to the bare `var self_: M;` (the zero of a
matrix is not spelled yet), which is WGSL's zero and GLSL's undefined value, as any local
declared without an initializer is today.

**Names.** The emitted name is `Struct_member`. A top-level function of that name is TS8023,
naming both. `self_` is the name the object takes in the emitted function (`self` itself is
on WGSL's reserved-word list, as `this` is); a parameter called `self_` is refused.

**A method that changes its object.** WGSL passes a struct by value, so a method that
assigns to `this` takes and returns the struct, and a call of it is a statement that writes
the receiver back. `Particle.step(dt)` below is `fn Particle_step(self_in: Particle, dt: f32)
-> Particle`: it starts with `var self_ = self_in`, runs the body on that copy and returns it,
and the statement `ps[gid.x].step(dt)` is `ps[gid.x] = Particle_step(ps[gid.x], dt)`. The
receiver has to be a place a function may write: a `let` local, a module variable, a storage
element, or `this` inside a constructor or another changing method. Which methods change their
object is read from their bodies, to a fixpoint: one that assigns to a field of `this` (or
`++`/`--` on one), and one that calls such a method on `this`. Such a method returns nothing,
so its caller can write the object back; one that returns a value reads its object only, and
a write to `this` inside it is TS8035 with that rule. The effect table (§19) counts the
write-back as it counts any assignment, so a kernel that steps a storage element is a writer.

```ts
class Particle {
  pos: vec2
  vel: vec2
  step(dt: f32): void {
    this.pos = this.pos + this.vel * dt
  }
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ps[gid.x].step(0.5)
}
```

```wgsl
fn Particle_step(self_in: Particle, dt: f32) -> Particle {
  var self_: Particle = self_in;
  self_.pos = (self_.pos + (self_.vel * dt));
  return self_;
}
fn k(...) {
  ps[gid.x] = Particle_step(ps[gid.x], 0.5);
}
```

**`this`.** Inside a method that reads, `this` is the read-only first parameter; inside a
constructor or a method that changes its object, it is the local being built or copied.
`this` in a static function or a top-level function is TS8035.

**Access modifiers** `private`, `protected`, `public` and `readonly` on a field or a method are
accepted and mean nothing to the shader; TypeScript enforces them.

**Refused, with the fix (TS8035).** A getter or a setter (write a method), a static field (a
module `const`), a field holding an arrow function (a method), a decorator on a method (an
entry is a top-level function), an `async`, generator or `abstract` method, two constructors
or two methods of one name (no overloads), a call of a method on the class or of a static
function on a value, a member the class does not have, a field called as a method, a method
that changes its object called on a `const`, a parameter or a value that is dropped, or used
as a value, and a parameter named `self_` or `self_in`. A class with only static functions
and no fields is not a struct (TS8010): write them as functions. `extends` stays refused
(§2). A `new` on anything but a class the file declares stays TS8013.

**In the editor.** Hover on a method, at its declaration or a call, reads `(method) Ray.at(t:
f32): vec3`; on `new Ray(...)`, `constructor Ray(origin: vec3, dir: vec3): Ray`; go to
definition from `r.at` lands on the method. The TypeScript checker already knows a class's
members, so the language service adds nothing for them and the compiler's symbols record each
method under its class name.

**Not yet.** A cycle through method calls in the recursion check (Tint still refuses it, as a
backend diagnostic), and `return this` from a changing method (split the chain).

---

**A class whose members are all static is a namespace of functions** (roadmap 0.3 item T3,
[#92](https://github.com/typeshade/typeshade/issues/92)). The utility class needs no fields,
and WGSL has no empty struct, so it carries none:

```ts
class Util {
  static half(x: f32): f32 {
    return x * 0.5
  }
  static quarter(x: f32): f32 {
    return Util.half(Util.half(x))
  }
}
```

emits `fn Util_half` and `fn Util_quarter` and no `struct Util` at all. An INSTANCE member on a
fieldless class keeps the empty-struct refusal, because a method needs a receiver and the
receiver is the struct that is not there.

**A static field is the module constant `Cls_Field`.** `class K { static N: i32 = 4 }` emits
`const K_N: i32 = 4;`, and `K.N` reads it. It folds by the rules §12 already states, so it may
name a constant declared earlier and may bound a `for` loop, and it takes the same types a
top-level const does. A static field with no initializer is refused: it is a constant, and a
constant has a value. Reading a name the class does not declare says so, and naming a static
function without calling it says to call it.

### `namespace`

A namespace is a named group of functions and constants, and the module holds both, so the
members flatten to `Ns_member`, the joining a method and a static field already take (roadmap
0.3 item T4, [#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
namespace Palette {
  export const WARM: vec3 = vec3(0.9, 0.5, 0.1)
  export function tint(c: vec3): vec3 {
    return c * WARM
  }
}
```

emits `const Palette_WARM` and `fn Palette_tint`. Nesting flattens too, in both spellings:
`namespace A { export namespace B { ... } }` and `namespace A.B { ... }` both give `A_B_member`.

A name inside a namespace body is looked up the way TypeScript looks it up: the body first, then
the namespace and each one around it, then the file. So `WARM` above is `Palette.WARM`, a local
of the same name shadows it, a member namespace may be written by its short name inside its
parent (`B.two()` inside `A`), and a top-level function is reachable from inside.

A call written through a dotted name is in the cycle check (§ recursion), so `A.f()` calling
itself is TS8031 rather than WGSL Tint refuses.

A namespace holds functions, constants and namespaces. A class, an enum, a type or a variable
inside one is refused and told to be declared at the top level of the file, because each already
has a home there and a second spelling would be a second thing. A `declare namespace` has no
members to emit.

## 27. Boolean vectors

A comparison of two vectors is componentwise and yields a vector of bools: `vec2b`, `vec3b`,
`vec4b`, WGSL's `vec2<bool>` and GLSL's `bvec2`. Roadmap 0.2 item 7. Before this, `a < b` on
two vectors compiled with no diagnostic as a scalar bool, which emitted `bool m = (a < b);` on
GLSL ES 3.00 (not a program) and read as one scalar on the oracle; the same source now means
what WGSL says it means on every target and on the CPU.

```ts
"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const a = vec3(uv, 0.5)
  const b = vec3(0.5, 0.5, 0.5)
  const m = a < b                       // vec3b
  const c = select(a, b, m)             // per component: b where m is true, a elsewhere
  if (all(m)) {
    return vec4(1., 0., 0., 1.)
  }
  return vec4(c, f32(any(!m)))
}
```

```wgsl
let m = (a < b);
let c = select(a, b, m);
if (all(m)) { ... }
return vec4<f32>(c, f32(any((m == vec3<bool>(false, false, false)))));
```

```glsl
bvec3 m = lessThan(a, b);
vec3 c = mix(a, b, m);
if (all(m)) { ... }
_ret = vec4(c, float(any(equal(m, bvec3(false, false, false)))));
```

- **Comparisons.** `<`, `<=`, `>`, `>=`, `===` and `!==` on two vectors of one type yield a
  vector of bools of that size. WGSL spells them as operators; GLSL ES 3.00 has no operator
  form for a vector comparison, so the writer spells `lessThan`, `lessThanEqual`,
  `greaterThan`, `greaterThanEqual`, `equal` and `notEqual`. `===` and `!==` on f32 vectors
  round to f32 first on the CPU, as the scalar form does (X-GIS #13). An ordering (`<`, `<=`,
  `>`, `>=`) on two bool vectors is TS8003 with the fix: `===`/`!==`, or `any`/`all`.
- **`any(m)` and `all(m)`** reduce a vector of bools to one bool, the same builtins on both
  targets. Over an array they stay the folds of §16, `any(xs, (x) => ...)`; a scalar or a
  numeric vector is TS8003 naming both shapes.
- **`select(f, t, m)`** with a vector-of-bools condition picks per component, and the arms are
  vectors of the mask's size (TS8003 otherwise). WGSL's `select` takes the mask as is; GLSL ES
  3.00 spells `mix(f, t, m)` for float vectors and a componentwise ternary through the vector's
  constructor for integer and bool ones, since its `mix` with a `bvec` selector exists for
  floats alone.
- **`!m`** flips every component: lowered as the compare with a vector of falses that the
  scalar `!` already is, `m == vec3<bool>(false, false, false)` on WGSL and `equal(m, bvec3(...))`
  on GLSL.
- **`vec2b(...)`, `vec3b(...)`, `vec4b(...)`** construct one from bools, a smaller bool vector
  and bools, one bool broadcast, or a numeric vector of the same size (nonzero is true). A
  component reads as a bool: `m.x`, `m.xy`.
- **Not vectors of bools:** `&&` and `||` stay scalar (TS8003), as on both targets; combine
  masks with `all`, `any` or a `select`. A bool vector has no arithmetic and is not
  host-shareable, so it cannot be a binding's type.

**On the CPU.** The oracle, the CPU codegen and the debug stepper share one comparison and one
per-component pick (`compareValues`, `selectComponents` in `cpu-runtime.ts`), so a vector of
bools is an array of booleans on all three and the differential tests hold them to one answer.

**In the editor.** TypeScript types `a < b` as a plain `boolean`, whatever the operands, so the
ambient lib takes a `bool` where it takes a bool vector (`any`, `all`, `select`'s condition) and
the compiler decides. `vec3b` and its siblings are types and constructors there too; a component
of a comparison's result is one thing the editor cannot type, so a mask read per component is
built with the constructor, `vec3b(uv.x > 0.5, uv.x > 0.5, uv.y > 0.5)`, as the `bool-select`
example does.

---

Last updated: 2026-09-18
