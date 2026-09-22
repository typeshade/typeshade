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
  @location(1) @interpolate("linear") uv: vec2 // (target)
}
```

Of that list the compiler applies `@location` and `@builtin` today. Every other name in it is
refused rather than silently dropped, which is the same rule under two codes: `@align` on a
field is `TS8010` ("@align on a field is not applied"), and `@size`, `@offset`, `@interpolate`
and `@ignore` are `TS8028` ("Unknown attribute"), because the compiler's attribute list does
not carry them. So the `@align(16)` and the `@interpolate("linear")` above are *(target)*, not
metadata that parses and goes nowhere. `@interpolate` is roadmap 0.3 item T12.

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

### What an entry may return

The shapes are the target's, not this compiler's, and there is one constraint per stage.

**A vertex entry returns the position.** A return typed `vec4` carries `@builtin("position")` on
its own, so the smallest vertex shader needs no struct and no parameters:

```ts
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(xs[i32(vi)], ys[i32(vi)], 0., 1.)
}
```

That reaches both targets: `-> @builtin(position) vec4<f32>` on WGSL, and `gl_Position` on GLSL
ES 3.00, where it is not a varying and links nothing. A struct return carries the position in a
field and adds as many `@location` varyings as the program wants, which is the shape to reach
for the moment anything travels to the fragment stage.

The one constraint: a vertex entry has to produce a position, and nothing can invent one. A
struct return with no `@builtin("position")` field, a `void` return, and a bare type that is not
a `vec4` are each refused, naming the field or the type to write. WGSL says the same thing ("a
vertex shader must include the 'position' builtin in its return type"); saying it here means an
author reads it against the line they wrote instead of against generated text.

**A fragment entry returns one value, or a struct of render targets.** A bare return takes
`@location(0)` at any width, so `f32`, `vec2`, `vec3` and `vec4` are all draw-buffer formats:

```ts
@fragment
export function fs(): f32 {
  return 0.5
}
```

A struct return is the multiple-render-target form, one `@location(n)` per target. A fragment
entry may also return nothing, which is what a program that only writes to storage does.

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

`transpose` applies to every matrix shape and `determinant` to the square ones; §40 has the
table.

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

A scalar constant's value has to be one its declared type can spell, and that is checked on
the declaration. An `i32` or `u32` one must be a whole number inside its 32-bit range; a `bool`
one takes `true`, `false`, `1` or `0`, and a number that is neither
([#64](https://github.com/typeshade/typeshade/issues/64)) is refused where it is written rather
than reaching the writer, which has only the file's `"use typeshade"` directive to point at.

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

`const N: u32 = 16` carries `u32` and `16` through the whole pipeline: the `ConstDecl` the
front end builds is `u32`, and the emitted line reads `const N: u32 = 16u;`. The float-literal
spelling this paragraph used to describe was issue #13, fixed by #17.

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
### A local function is a function of the module

`const f = (x: f32): f32 => x * 2.` is how a TypeScript developer writes a helper needed once,
and `const f = function (x: f32): f32 { ... }` is the older spelling of it (roadmap 0.3 item T7,
[#92](https://github.com/typeshade/typeshade/issues/92)). Both were "TS8099 Unsupported
expression", and the call after them "Unknown function".

Neither target has a function value, so a local function is a function of the module, named
after the body that declares it:

```ts
@fragment
export function fs(): vec4 {
  const f = (x: f32): f32 => x * 2.      // fn fs_f(x: f32) -> f32
  return vec4(f(3.), 0., 0., 1.)         // fs_f(3.0)
}
```

The name is what lets two bodies each declare an `f`, and the body still writes `f(x)`. A local
function may declare one of its own (`fs_outer_inner`), and one written at the module top level
is a module function already, under its own name; inside a `namespace` it takes the flattened
one, `N_twice`.

**A local function may not capture.** A shader function takes its arguments and reads the
module; there is no environment for it to carry a name in, and no closure to allocate one. A
name read from the body around it is refused where it is written, with the parameter to add
instead. That is the one rule separating a local function from a function declaration.

Three more shapes are refused: an expression body with no return type, since there is nothing to
infer it from here; a `let`, which would let the name point at another function; and a type
written on the const rather than on the function itself.

### Triple-slash directives

`/// <reference path="..." />` and `/// <reference types="..." />` are comments to the parser, so
they always worked, above the `"use typeshade"` directive and below it. They are pinned by a
test now so they keep working.

### An overload signature is skipped, and the implementation is lowered

TypeScript writes a function's overloads as body-less declarations above the one that has a
body (roadmap 0.3 item T6, [#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
export function lum(c: vec3): f32
export function lum(c: vec3): f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722))
}
```

Each signature was "Function "lum" needs a body (no ambient declarations)". They are skipped
now, and one `fn lum` is emitted from the implementation. That is the whole of it, because
TypeScript already checks a call against the implementation signature as well, and this surface
has no `any` for the implementation to widen to: a signature the implementation does not accept
is TypeScript's own error before it reaches here. The same holds inside a `namespace`, under the
flattened name, and on a method, a static function and a constructor, which took this shape
already.

Two body-less declarations are not overloads and keep their error: one with no implementation
anywhere, and `declare function`, which names a function no module can emit.

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


### `...` spreads a struct's fields

`{ ...p, y: 9. }` is the fields of `p` with `y` written over one of them, so it lowers to one
read per field of `p`'s struct (roadmap 0.3 item T7,
[#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
const q: P = { ...p, y: 9. }     // P(p.x, 9.0)
const q: P = { y: 9., ...p }     // P(p.x, p.y)
const q: Inner = { ...o.i, b: 9. } // Inner(o.i.a, 9.0)
```

Later wins, over a written field and over an earlier spread, which is TypeScript's own rule and
already how a repeated field was taken. A spread may fill part of a bigger struct with the rest
written, and the target struct is decided by an annotation or, with none, by the field names the
literal ends up with.

Three shapes have no form here. A value with no fields: a vector's components are read by name,
so `{ ...v }` is refused. A value that is not a plain read: the spread reads its operand once
per field, so a call would run once per field with it; bind it to a const first. And a field the
target struct has not got, which names the field rather than saying the literal does not match.

Every other spread is still a runtime operation this surface has no form for: `f(...args)` needs
an argument count known only at run time, and `[...xs]` a list that grows.

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
#20). WGSL keeps `x %= y;`, and an integer `%=` keeps the native operator on both. The rule
holds at any width: a `vec2` target takes the same componentwise
`cell = (cell - 1.0 * trunc(cell / 1.0));`, since GLSL ES 3.00 has no float `%` for a vector
either. `examples/block-scope.shade.ts` carries a scalar and a vector `%=` and is the gate's
evidence on both targets.

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

**A method that changes its object takes it by reference.** A method that assigns to `this`
takes its object as a parameter the callee writes THROUGH, and the call is a plain statement.
GLSL ES 3.00 spells that with the qualifier it has, `inout Particle self_`; WGSL has no such
qualifier and spells it as a pointer, `self_: ptr<function, Particle>`, read through as
`(*self_)`. The IR says which parameters are written and nothing about how a target spells it.

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
fn Particle_step(self_: ptr<storage, Particle, read_write>, dt: f32) {
  (*self_).pos = ((*self_).pos + ((*self_).vel * dt));
}
fn k(...) {
  Particle_step(&ps[gid.x], 0.5);
}
```

```glsl
void Particle_step(inout Particle self_, float dt) {
  self_.pos = (self_.pos + (self_.vel * dt));
}
// Particle_step(ps[i], 0.5);
```

The receiver has to be a place a function may write: a `let` local, a module variable, a storage
element, or `this` inside a constructor or another changing method. Which methods change their
object is read from their bodies, to a fixpoint: one that assigns to a field of `this` (or
`++`/`--` on one), and one that calls such a method on `this`. Such a method returns nothing;
one that returns a value reads its object only, and a write to `this` inside it is TS8035 with
that rule. The effect table (§19) counts a write through a reference as it counts any other, and
names it as the CALLER knows it: `ps[gid.x].step(dt)` writes `ps`, because `step` writes its
receiver and the receiver is reached through `ps`.

**One WGSL function per address space.** The address space is part of a WGSL pointer's type:
`ptr<function, T>` and `ptr<storage, T, read_write>` are different types, and a function
declared for one cannot be handed the other. So a method called on receivers in two spaces is
emitted twice, `Particle_step_function` beside `Particle_step_storage`, each call naming the one
it needs. One space and the function keeps its plain name, which is every module in the corpus
but one. None of this reaches the IR or the GLSL, which writes a single `inout` function: it is
the WGSL backend's own pass, and it is monomorphisation, the same answer §30 gives generics.

This is what a method that changes its object looks like now. It took the struct and RETURNED
it until the reference landed — `Particle_step(self_in: Particle, dt: f32) -> Particle` opening
with `var self_ = self_in` and closing with `return self_` — and the call site read the
receiver, called, and stored the result back: three copies of a struct for one method that moves
a point. `examples/orbit-inout.shade.ts` is the gate's evidence for the render pair, on Tint and
on a real WebGL2 driver; `examples/particle-step.shade.ts` for the compute one.

**`this`.** Inside a method that reads, `this` is the read-only first parameter; inside a method
that changes its object it is that parameter, written through; inside a constructor it is the
local being built.
`this` in a static function or a top-level function is TS8035.

**Access modifiers** `private`, `protected`, `public` and `readonly` on a field or a method are
accepted and mean nothing to the shader; TypeScript enforces them.

**Refused, with the fix (TS8035).** A getter or a setter (write a method), a static field (a
module `const`), a field holding an arrow function (a method), a decorator on a method (an
entry is a top-level function), an `async`, generator or `abstract` method, two constructors
or two methods of one name (no overloads), a call of a method on the class or of a static
function on a value, a member the class does not have, a field called as a method, a method
that changes its object called on a `const`, a parameter or a value that is dropped, or used
as a value, and a parameter named `self_`. A class with only static functions
and no fields is not a struct (TS8010): write them as functions. `extends` is a struct's base
since roadmap item T5. A `new` on anything but a class the file declares stays TS8013, and
says which of the four reasons it is.

### `new` is how a class is built, and the refusals say why

A class the file declares is built with `new`, everywhere a value goes: with a constructor,
without one, with field initializers, inside a method, as an argument, and on a derived class.
There is no shader rule against it. A class is a struct and a constructor is a function, so
`new P(1., 2.)` is `P_new(1.0, 2.0)` and nothing is allocated.

What is refused is refused for its own reason, and the message says which:

| written | why |
| --- | --- |
| `new Date()` | the file declares no class of that name, and `new` on anything else allocates a JS object |
| `new I()` on an interface or a type alias | it is a type, not a value, and carries no constructor; write the object literal or declare it as a class |
| `new S()` on an `abstract` class | there is no instance of it to build; construct a class that extends it |
| `new U()` on a class of statics alone | it is a group of functions with no fields, so there is no value to build |
| `new P(1., 2.)` where `P` declares no constructor | TypeScript's implicit constructor takes no arguments; declare one, or write the fields |

Only the first of those is a shader rule. The other four are TypeScript's own, or follow from a
class with no fields not being a struct at all.

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

A namespace holds a class too, under the same flattening (#107):

```ts
namespace Scene {
  export class Camera {
    pos: vec3
    zoom: f32
  }
}
declare const cam: uniform<Scene.Camera>
```

emits `struct Scene_Camera`, and everything named after a struct follows: a method is
`Scene_Camera_at`, the constructor `Scene_Camera_new`, and `new Scene.Camera(...)` calls it.
Inside the namespace's own bodies the short name works, `new Camera(...)`, and a nested
namespace nests the name, `A_B_Inner`.

The short name is read from anywhere in the file, which is more than TypeScript's lexical rule
allows, so the two places it could disagree are refused rather than guessed at. A short name two
namespaces both declare says which ones and asks for the one you mean. A top-level declaration
of the same name wins, which is what TypeScript does outside the namespace; write `N.P` for the
other one. Resolving it exactly needs the enclosing namespace, which a type annotation does not
carry to the mapper today.

An enum, a type alias, an interface and a variable inside a namespace keep their refusal: each
is collected by a route that has no declaration site to flatten from, which is its own step.

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

### `extends`, `abstract` and `implements`

A derived struct is its base's layout with more on the end, and a method is inherited by being
lowered again (roadmap 0.3 item T5,
[#92](https://github.com/typeshade/typeshade/issues/92)). Until this item every `extends` was
refused: "A TypeShade struct is exactly the members written here, so the inherited ones would be
dropped; write them out."

```ts
abstract class Shape {
  center: vec2
  constructor(center: vec2) {
    this.center = center
  }
  abstract sdf(p: vec2): f32
  coverage(p: vec2): f32 {
    return 1. - smoothstep(0., 0.02, this.sdf(p))
  }
}
class Circle extends Shape {
  radius: f32
  constructor(center: vec2, radius: f32) {
    super(center)
    this.radius = radius
  }
  sdf(p: vec2): f32 {
    const d: vec2 = p - this.center
    return length(d) - this.radius
  }
}
```

**Fields.** The base's come first, then the derived class's own, through a chain of any depth
and across both spellings: a class may extend a class or an interface, and an interface may
extend several. `implements` carries no layout and is left alone, as it always was. A field the
derived class redeclares with the base's type is the same field and keeps its place, which is
TypeScript's rule; one that redeclares it with a different type is refused, since a struct has
one layout and two use sites would disagree about it.

**Methods.** WGSL has no vtable, so dispatch is static and a class inherits a method by lowering
the BASE's body again with `this` typed as itself. The emit above carries `Circle_coverage` and
`Square_coverage`, each calling that class's own `sdf`, and no `Shape_coverage` at all. That is
also why an inherited body calls an override, exactly as it does in TypeScript. A static
function and a field initializer come down the same way, and a derived class with no constructor
of its own uses the nearest one above it.

**What makes the two dispatches agree.** A name typed as the base cannot hold a derived value.
Assigning one, or passing one where a base is expected, is refused with the reason:

```
"Derived" extends "Base", and a name typed as the base cannot hold a derived value here:
method dispatch is static, so a call through it would run "Base"'s body. Write "Derived" as
the type.
```

With that rule the static type of every receiver is its exact class, so lowering each body per
class means the same thing TypeScript's dynamic dispatch would.

**`abstract`.** An abstract class is a base and never a value: its struct is emitted so a
derived one can be described in terms of it, its methods reach each concrete class through
inheritance rather than becoming functions of its own, and a constructor it declares is emitted
because a derived `super(...)` calls it. An `abstract` member declares no body and contributes
nothing; TypeScript already requires a concrete class to implement it.

**`super`.** Both forms work. `super(a, b)` in a constructor calls the base's constructor and
copies its fields into the object being built, which is what a flat struct makes of it:

```wgsl
let _sup = Shape_new(center);
self_.center = _sup.center;
```

A bare `super()` where nothing above declares a constructor has nothing to run and emits
nothing. `super.sdf(p)` in an overriding method runs the base's body on this object, emitted
against this class as `Ring_super_Circle_sdf`. The base is named as well as the class, so a body
re-lowered two steps down still counts its own `super` from where it was written, and a chain of
three terminates.

**Refused, each with the reason.** A base this file does not declare as a struct; a cycle, named
through its chain; a field that changes type on the way down; and a generic base, which is one
declaration per argument set and belongs with generics. A base that is a CALL is the mixin
pattern, and §29 runs it.

## 28. What TypeScript writes that the GPU has no word for

Roadmap 0.3 item T10. Five shapes were "TS8099 Unsupported expression" or "TS8002 Unsupported
type syntax", each followed by two or three more diagnostics about the same one mistake. The
rule applied to them is the one the rest of this document is written to: the constraint has to
be the target's. Three of the five turned out not to be constraints at all.

**A tuple is a list of a length the type fixes, which is what `array<T, N>` is.** `[f32, f32]`
IS `array<f32, 2>`, the same type written the way a TypeScript developer writes a pair, named
elements included. Both targets take it wherever the array goes, a return included: WGSL writes
`fn bounds() -> array<f32, 2>` and GLSL ES 3.00 writes `float[2] bounds()`, which ESSL 300 has
and ESSL 100 did not. `examples/tuple-and-brand.shade.ts` is the gate's evidence for the pair.

```ts
function bounds(scale: f32): [near: f32, far: f32] {
  return [0.05 * scale, 8. * scale]
}
function mid(span: [f32, f32]): f32 {
  return (span[0] + span[1]) * 0.5
}
const depth = mid([0.05, 8.])           // a list, in a position that declares the type
```

A list now takes its type from any position that declares one, not from a `const` alone: a
return, an argument, a struct field. Where nothing declares one, `array<T, N>(...)` still says
it.

**A union whose members all name one type names it too.** `0 | 1 | 2` is an `i32`, for the
reason an enum member is one; `0.5 | 1.5` is an `f32`; `true | false` is a `bool`; `Meters |
f32` where `Meters` is an alias of `f32` is an `f32`.

**A brand is erased.** `f32 & { readonly [m]: 'm' }` with `declare const m: unique symbol` is
TypeScript's nominal-typing idiom: the brand exists so that only a `Meters` may be passed, and
carries no data. The parameter is an `f32`, the `declare` reaches no binding, and the emitted
code never hears about it. `{ readonly __brand: 'm' }` is the same idiom and is erased the same
way. `tsc` is what enforces the distinction, which is where it belongs.

**Refused, each in one sentence naming the reason and what to write instead.**

| Written | Why there is nothing for it to be |
| --- | --- |
| `f32 \| vec3` | a value has exactly one type, and the emitted code would have to pick. Write one function per type. |
| `'lo' \| 'hi'` | a string has no GPU representation. Write the cases as an enum, whose members are numbers. |
| `f32 \| null` | a value of a type always exists. Carry a bool saying whether it means anything. |
| `[f32, vec3]` | a list of several types is a struct. Declare one with a field per element. |
| `[f32, ...f32[]]` | every array outside storage has a length known at compile time. |
| `symbol` | a symbol is a JS runtime value. Only a brand key is erased. |
| `f32 & vec3` | two carriers have different layouts, so no one value is both. |
| `d instanceof B` | a struct is its fields and nothing else, and dispatch is static, so there is no type tag to read. Give the struct a field saying which kind it holds. |
| `'x' in b` | a struct has exactly the fields its type declares, so the answer is in the type. Write the field access. |
| `number`, `boolean` | a number on the GPU has a width: `f32`, `i32`, `u32`. The boolean is spelled `bool`. |

**And one mistake reads as one sentence.** A parameter whose annotation was refused no longer
adds that it "requires a TypeShade type annotation", which it has; a return no longer adds
"Unsupported return type"; a call to a function this file declares and could not lower no
longer says "Unknown function", which was untrue — the function is there, and its declaration
already said why. A call to a name nothing declares still says so.

## 29. The mixin pattern

Roadmap 0.3 item T8. `class TintedDisc extends Tinted(Disc)` is a class whose base is decided by
running a function. TypeScript runs it at run time and gets a constructor; there is no run time
here, so TypeShade runs it when the file is compiled and gets a list of members.

What makes that work is what §26 settled: a struct is flat, and dispatch is static. `Tinted(Disc)`
has no observable existence of its own, no layout a value can have and no method anything calls
through, so it is not a struct. Its members are spliced into the class that applied it, behind
the base's fields and ahead of that class's own, which is the order TypeScript's own mixin
produces.

```ts
class Disc {
  center: vec2
  radius: f32
}

function Tinted<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    tint: vec3
    lit(cover: f32): vec3 {
      return this.tint * smoothstep(0., 1., cover)
    }
  }
}

class TintedDisc extends Tinted(Disc) {
  softness: f32
}
```

```wgsl
struct TintedDisc {
  center: vec2<f32>,      // Disc's
  radius: f32,            // Disc's
  tint: vec3<f32>,        // the mixin's
  softness: f32,          // its own
}

fn TintedDisc_lit(self_: TintedDisc, cover: f32) -> vec3<f32> { … }
```

There is no `Tinted` in the emitted code and no `Tinted_lit`. Two classes applying one mixin each
carry their own copy of its methods, exactly as two classes extending one base do.

`AnyClass` is the ambient lib's name for the constructor type TypeScript needs before it will
take `class extends Base`: `new (...args: any[]) => object`. It is there so a shader author does
not have to know the incantation; declaring your own, as the TypeScript handbook does, reads the
same to this compiler, which never looks at the constraint. What it does mean is that a mixin
type-checks in the editor before it compiles, which is the point of writing it in TypeScript.

**A mixin is a function whose body is one `return class … { … }`.** Its class expression may
extend the function's own parameter, which is where the argument goes; or a class this file
declares; or nothing, which is a mixin that only adds. The chain nests, innermost first:
`extends Named(Aged(Particle))` puts Particle's fields, then Aged's, then Named's, then the
class's own. `const AgedParticle = Aged(Particle)` names an application, and a class may extend
that name; the const holds a class, so it is no module constant and folds to nothing.

**A mixin may carry what a class carries.** A constructor, including one that calls `super(…)`
over a base that has one; a static function, which becomes the applying class's; a field with a
`@builtin` or `@location` decorator, which reaches entry I/O the way any field does; a method
reading a field of the base it was mixed over.

**A name declared twice in the chain is an override, and the declaration closest to the value
wins**: the class over every mixin, an outer mixin over an inner one, silently, the way a
subclass method overrides a base's. Two FIELDS of that name written with different types are the
one case that is not an override but a change of layout, and it is reported: picking either
silently would change what the other's code reads.

**Refused, each in one sentence.** A function whose body is more than one `return` of a class,
since there is no run time for the rest of it to happen in; a call to a function this file does
not declare, since the class expression is read where it is written; a mixin applied to itself;
a base passed to a mixin whose class extends something else, so the base would go nowhere; a
mixin that extends its parameter and is given nothing.

## 30. Generics by monomorphisation

Roadmap 0.3 item T9. WGSL and GLSL ES 3.00 have no generics: a function has one signature and a
struct one layout. TypeScript has them, and a shader author reaches for them, so a generic
declaration is compiled **once per set of argument types the file uses it with**. That is what
monomorphisation is, and it is the only way a generic can reach either target.

```ts
function pick<T>(c: bool, a: T, b: T): T {
  return c ? a : b
}

const gain = pick(uv.x > 0.5, 1.2, 0.6)                    // pick_f32
const tint = pick(uv.y > 0.5, vec3(0.9, 0.4, 0.3), …)      // pick_vec3
```

```wgsl
fn pick_f32(c: bool, a: f32, b: f32) -> f32 { … }
fn pick_vec3(c: bool, a: vec3<f32>, b: vec3<f32>) -> vec3<f32> { … }
```

Nothing called `pick` is emitted: a generic is not a function the module has, its instances are.
Two calls at the same types reach one instance; a generic nothing calls emits nothing at all.
`examples/generic-helpers.shade.ts` is the gate's evidence.

**A type parameter is a type wherever a type is written**: a parameter, a return, inside
`array<T, N>`, and a local declaration in the body. It shadows a type of the same name, the way
TypeScript's does. The substitution is not a rewrite of the source: a type parameter is a NAME,
and the one place a name becomes a shader type binds it there, so the declaration's own nodes
are lowered unchanged.

**What settles the type arguments** is either what the call writes, `id<u32>(1)`, or what its
arguments show: a parameter written as the type parameter, or as `array<` it `, N>`. A generic
calling a generic passes its own type arguments through, so `id<T>(a)` inside `relay<T>` resolves
to whatever `relay` was instantiated at. There is no type checker here, so a parameter neither
form reaches is refused, naming the type argument as the fix.

**Arithmetic on a type parameter is TypeScript's limit, not this one.** `a + a` on an
unconstrained `T` is `Operator '+' cannot be applied to types 'T' and 'T'` in the editor, before
this compiler sees it. A generic here composes calls, selects, indexes and field reads;
`<T extends number>` is the constraint that admits scalar arithmetic, and the math builtins are
already generic over `Numeric`.

**Refused, each in one sentence.** A call nothing in which says what the type parameter is; the
wrong number of type arguments; a type argument that names no type. An argument whose type is
not the parameter's is the ordinary mismatch, reported against the instance once it exists.

A generic CLASS is §32, by the same rule and for the same reason.

## 31. A conditional on a struct or an array

Issue #113. `c ? a : b` where the two arms are structs, or fixed-length arrays, is a value chosen
at run time, and **neither target has an operator for it**. Measured on the real backends:

| target | the obvious spelling | verdict |
| --- | --- | --- |
| WGSL | `select(Ray, Ray, bool)` | Tint: `no matching call to 'select(Ray, Ray, bool)'` — `select` is declared for a scalar or a vector, and WGSL has no ternary at all |
| GLSL ES 3.00 | `((c) ? r1 : r2)` | WebGL2: `'?:' : ternary operator is not allowed for structures in ESSL 1.0 and webgl`, and the same for arrays |

The GLSL row is worth reading twice: the ES 3.00 spec's ternary takes any two operands of one
type, so the spec says a struct is fine. The driver says no, and the driver is what the emitted
code has to satisfy.

So the conditional is hoisted into a slot and an `if`, exactly as §19's multi-arm conditional
expression is hoisted into a slot and a `switch`, and for the same reason: the targets have the
statement, not the expression.

```wgsl
var _sel0: Ray;
if ((p.x > 0.5)) {
  _sel0 = r1;
} else {
  _sel0 = r2;
}
let r = _sel0;
```

```glsl
Ray _sel0;
if ((p.x > 0.5)) {
  _sel0 = r1;
} else {
  _sel0 = r2;
}
Ray r = _sel0;
```

**A helper function would have been shorter and wrong.** Its arguments are evaluated before the
call, so both arms would run, and an arm holding a call that `discard`s would then discard
unconditionally. The `if` keeps each arm on its own branch, which is what the source says and
what the CPU oracle already does. It also retires a documented under-fix: the ANGLE workaround
that hoists a struct constructor out of a position that target dislikes used to skip a
conditional's arms for exactly that reason, and now hoists inside the branch instead.

A scalar or a vector conditional keeps the operator each target has, `select` on WGSL and the
ternary on GLSL. A conditional inside a loop body hoists inside that body, never out of it. The
CPU backends read the IR, where the conditional is still a conditional, and need none of it.
`examples/pick-composite.shade.ts` is the gate's evidence on both targets.

**Why nothing caught it.** No example carried the shape, so the gate had never compiled one. The
constant folder hides the easy case as well: `true ? a : b` folds, and two identical arms CSE to
one binding, so it takes a runtime condition AND two distinguishable arms to reach at all.

## 32. A generic class

Roadmap 0.3 item T9, the class half of §30. A WGSL or GLSL struct is **one layout**, its fields'
types fixed, so a generic class is collected **once per set of type arguments the file writes it
with**.

```ts
class Slot<T> {
  a: T
  b: T
  either(c: bool): T {
    return c ? this.a : this.b
  }
}

const gain = new Slot<f32>(1.15, 0.55)                        // Slot_f32
const tint = new Slot<vec3>(vec3(0.95, …), vec3(0.18, …))     // Slot_vec3
```

```wgsl
struct Slot_f32 { a: f32, b: f32, }
struct Slot_vec3 { a: vec3<f32>, b: vec3<f32>, }
fn Slot_f32_either(self_: Slot_f32, c: bool) -> f32 { … }
fn Slot_vec3_either(self_: Slot_vec3, c: bool) -> vec3<f32> { … }
fn Slot_f32_new(a: f32, b: f32) -> Slot_f32 { … }
```

Nothing called `Slot` is emitted, and a generic class nothing writes emits nothing at all.
`examples/generic-class.shade.ts` is the gate's evidence on both targets.

**The instances are read off the source, not discovered as the lowering runs.** A struct has to
exist before anything is lowered against it: its methods are functions of the module, its fields
decide every layout that holds it, and the inheritance splice runs over the collected list. Every
use is a type node, an `extends`, or a `new`, and all three are visible syntactically, so one
walk finds them. A type argument may itself be an instance, `Box<Box<f32>>`, and a class inside a
namespace is reached by its dotted name, `N.Pair<f32>`.

**A type parameter's default is read the way TypeScript reads it.** `class Level<T = f32>` makes
`Level` and `Level<f32>` one struct, and a use may leave out every parameter that has one.

**A `new` may leave its type arguments to inference**, as TypeScript's does. This front end is
syntactic and has no argument types where the structs are collected, so the expression is
answered from the instances the file writes elsewhere: when there is exactly one, a bare `new`
can only be building that one, and the constructor's own argument check catches a call that does
not fit it. With several, one sentence says to write the type argument.

**A static belongs to the class, not to an instance.** TypeScript refuses a static that mentions
the class's type parameters outright, so a static is the same function however many instances
there are: one copy, under the class's own name, `Level_unit`.

**A base written with type arguments is the instance it names.** `class Marked extends Slot<f32>`
inherits `Slot_f32`'s fields and its methods, and the inherited bodies are read under the
binding they were written for. Before this item that was refused, with "one declaration per
argument set" as the reason — which is what a generic class now is.

**Arithmetic on a type parameter is TypeScript's limit here too**, so a generic class holds,
selects, indexes and returns, and the arithmetic happens on what it gives back.

**Refused, each in one sentence.** A type argument that is itself a type parameter, because it
names no layout until the declaration around it is instantiated; the wrong number of type
arguments. A surplus argument is reported once and the instance is still collected from the ones
the class declares, so the mistake does not take the struct, and every use of it, down with it.

## 33. A storage texture

Roadmap 0.4 item 10. An image a shader reads and writes **by texel coordinate**, with no sampler
and no filtering. The format and the access mode are part of its TYPE, as they are in WGSL, and
are written as string literal types so `tsc` checks them in the editor.

```ts
declare const dst: texture_storage_2d<"rgba8unorm", "write">
declare const acc: texture_storage_2d<"r32float", "read_write">
declare const ids: texture_storage_2d<"rgba8uint", "write">

@compute([64, 1, 1])
export function paint(@builtin("global_invocation_id") gid: vec3u): void {
  const at: vec2i = …
  const seen = textureLoad(acc, at)
  textureStore(acc, at, vec4(seen.x + 1., 0., 0., 0.))
  textureStore(dst, at, vec4(uv.x, uv.y, 0.5, 1.))
  textureStore(ids, at, vec4u(x, y, u32(1), u32(255)))
}
```

```wgsl
@group(0) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var acc: texture_storage_2d<r32float, read_write>;
textureStore(dst, at, vec4<f32>(uv.x, uv.y, 0.5, 1.0));
```

**WGSL only.** GLSL ES 3.00 has no image load/store at all — that is ES 3.10 — so a module
carrying one emits WGSL alone, as a storage buffer or an atomic does. Measured on a driver
rather than read off the spec: `layout(rgba8) uniform writeonly image2D` is `'rgba8' : invalid
layout qualifier: not supported`, and asking for the extension that would bring it is
`extension is not supported`.

**A storage texture is not a sampled texture**, and they are different IR kinds so that every
site which must decide between them fails to compile until it does. A sampled texture is read
through a sampler and carries an element type; a storage one is addressed directly and carries a
format and an access mode. `textureSample` on a storage texture and `textureStore` on a sampled
one are each refused with the other's name.

**The format decides the texel.** A `"…uint"` format stores a `vec4u`, a `"…sint"` one a
`vec4i`, and every other one — unorm, snorm and float — a `vec4`. The ambient lib says the same
thing with a conditional type, so the editor refuses a mismatched store before this compiler
does. **The access mode decides the calls**: `textureLoad` needs `"read"` or `"read_write"`,
`textureStore` needs `"write"` or `"read_write"`. A `textureStore` is refused in a vertex entry, or in a
helper a vertex entry reaches, in one sentence: WGSL allows a texture write in a fragment or
compute stage only. On an array texture the layer is retyped to an integer like every other
layer, so `textureStore(dst, at, 0, texel)` writes layer `0` and not a `0.0` Tint would refuse.

### Two refusals Tint does not make

**Tint compiles a shader; a device binds one.** Asked directly, Tint accepts every format at
every access mode. A real device, asked to build a bind group layout for each pair, does not:

| written | Tint | a device |
| --- | --- | --- |
| `texture_storage_2d<rgba8unorm, write>` | accepts | accepts |
| `texture_storage_2d<rgba8unorm, read_write>` | **accepts** | `RGBA8Unorm does not support storage texture access ReadWrite` |
| `texture_storage_2d<rg16float, write>` | **accepts** | `RG16Float does not support storage texture access WriteOnly` |

So this surface refuses both, with the reason and the fix. `"read_write"` is `"r32uint"`,
`"r32sint"` and `"r32float"` and nothing else; a format outside the sixteen every device stores
to with no feature requested (`rgba8unorm`, `rgba8snorm`, `rgba8uint`, `rgba8sint`,
`rgba16uint`, `rgba16sint`, `rgba16float`, `r32uint`, `r32sint`, `r32float`, `rg32uint`,
`rg32sint`, `rg32float`, `rgba32uint`, `rgba32sint`, `rgba32float`) is not a format here.
Either spelling would otherwise pass the compile gate and fail at `createBindGroupLayout`,
which is a wrong program emitted without a diagnostic — the shape issue #113 was.

**What the host is told.** A `storage-texture` entry carries `storageFormat` and
`storageAccess`, always set, in WebGPU's own spelling (`write-only`, `read-only`,
`read-write`) rather than WGSL's: a host passing the WGSL words through gets a validation error.
The bind group layout has to repeat the shader's format exactly.

**The write is an effect.** `textureStore` returns nothing, so an optimizer that read it as a
pure call would drop every one and emit an entry whose body does nothing. It sits in the
effectful set beside the atomics and the barriers, and it writes the binding at its first
argument's root. The CPU oracle has no texture memory, so the write goes nowhere there — the
same contract a texture read already keeps, where a load yields opaque black.
`examples/storage-texture.shade.ts` is the gate's evidence on Tint.

## 34. A shadow map, read by comparison

Roadmap 0.4 item 11. The texture a shadow pass wrote is a **depth texture**: single-channel
float with no element type of its own. The read that applies to it is not a sample but a
**comparison** — a reference depth against the texel, through a `sampler_comparison`, yielding
how much of the filter footprint passed. That number is the light factor.

```ts
declare const shadowMap: texture_depth_2d
declare const shadowSmp: sampler_comparison
declare const cascades: texture_depth_2d_array

const lit = textureSampleCompare(shadowMap, shadowSmp, uv, depthHere)
const litFar = textureSampleCompareLevel(cascades, shadowSmp, uv, band, depthHere)
```

```wgsl
@group(0) @binding(0) var shadowMap: texture_depth_2d;
@group(0) @binding(1) var shadowSmp: sampler_comparison;
let lit = textureSampleCompare(shadowMap, shadowSmp, uv, depthHere);
```

```glsl
precision highp sampler2DShadow;
uniform sampler2DShadow shadowMap;
float lit = texture(shadowMap, vec3(uv, depthHere));
float litFar = textureGrad(cascades, vec4(uv, float(band), depthHere), vec2(0.0), vec2(0.0));
```

**Portable, unlike a storage texture.** Both targets have a spelling, so a module carrying one
emits both halves and needs no capability. What differs is where the comparison lives. WGSL
keeps the texture and the sampler as **two bindings** and puts it on the sampler. GLSL ES 3.00
**fuses** them into one `sampler2DShadow` and folds the reference **into the coordinate** —
`vec3(uv, ref)`, and `vec4(uv, layer, ref)` on the array, where the layer folds in too — the
same fold the array layer already takes. A shadow sampler has no default precision in GLSL
(§4.5.4 gives one to `sampler2D` and `samplerCube` only), so the header declares one; without
it a real driver refuses the shader.

**Measured, on Tint and on a WebGL2 driver.** Every accepted shape above compiles on both.
Three refusals were measured too, and this surface says each first, in the author's own file:

| written | Tint | this compiler |
| --- | --- | --- |
| an ordinary `sampler` in `textureSampleCompare` | `no matching call` | `compares through a sampler_comparison; got sampler` |
| a `sampler_comparison` in `textureSample` | `no matching call` | `filters a texel through an ordinary sampler` |
| `textureSampleCompare` in a compute entry | `built-in cannot be used by compute pipeline stage` | `is only valid in a fragment shader` |

The two sampler kinds are **not interchangeable in either direction**, and they are two IR kinds
rather than a flag on one, so no site can read one as the other by accident. `tsc` refuses the
same three through the ambient lib, before this compiler sees the file.

**`textureSampleCompare` is fragment-only; `…Level` is not.** The first uses the implicit level
of detail, which needs the derivatives only a fragment quad has, and joins `dpdx` and `fwidth`
in the fragment-only set. `textureSampleCompareLevel` samples level 0 and is legal in any
stage — which is what `textureLod(…, 0.0)` is on GLSL, **on the 2D form**. GLSL ES 3.00 has no
`textureLod` for `sampler2DArrayShadow` at all: the first bake of the example passed Tint and
failed the WebGL2 half of the gate with `'textureLod' : no matching overloaded function found`.
The array form therefore spells level 0 as `textureGrad` with zero gradients — a level of
detail of −∞, clamped to the base level — which the same driver takes in a fragment and in a
vertex stage. One of four spellings guessed from the spec was wrong, and the gate is what
caught it.

**A depth texture is its own IR kind**, for the reason a storage texture is (§33): it is a
different thing at every site — no element type, yields `f32` not `vec4`, only some calls apply
— so every existing `kind === 'texture'` switch keeps meaning "sampled" and a site that must
decide fails to compile until it does. The comparison-ness stays on the **sampler**, as WGSL has
it, so the IR keeps modelling its closest target.

**A plain read of a depth texture is refused for now, with the reason.** `textureSample` with an
ordinary sampler, or `textureLoad`, on a `texture_depth_2d` is legal WGSL and Tint takes it.
On GLSL the combined sampler's type is decided by the *read* — `sampler2D` for a plain one,
`sampler2DShadow` for a comparison — so a depth texture read both ways in one module needs
WebGPU's separate samplers, which GLSL ES 3.00 has no form of. That is a capability of its own
(`separateSamplers`, one texture through samplers of different kinds) and a later item; until
it lands every depth read is a comparison and the GLSL combined type is one spelling per dim.
The refusal names the read that does apply.

**What the host is told.** A depth texture reflects as `resourceKind: 'texture'` with
`textureDepth: true` — the same `GPUBindGroupLayoutEntry.texture` member a sampled texture
takes, with `sampleType: 'depth'` — and no `textureElem`, since it has no element. A comparison
sampler reflects as `resourceKind: 'sampler'` with `samplerComparison: true`, for
`GPUSamplerBindingLayout.type: 'comparison'`. Both flags are always set on their kind and absent
on every other, so a host never reads absence as "not depth" on a buffer.

**The CPU twins yield 1.** The oracle has no texture memory. A comparison yields a *factor*, and
the placeholder that leaves the rest of the shader alone is the identity for the multiply it
feeds — where a texel read yields opaque black, because a texel has no identity and a factor
does. `examples/shadow-compare.shade.ts` is the gate's evidence on both targets.

## 35. Cube and 3D textures, bias and gradients

Roadmap 0.4 item 12, the portable half. A **cube texture** is six faces looked up by a
*direction*; a **3D texture** is a volume addressed by a `vec3` coordinate. Both are core in
both targets — WGSL `texture_cube<f32>` / `texture_3d<f32>`, GLSL ES 3.00 `samplerCube` /
`sampler3D` — so a module carrying one emits both halves and needs no capability. Two sampling
forms join them, `textureSampleBias` and `textureSampleGrad`, and the depth texture of §34
gains its cube, `texture_depth_cube`, the shadow map of a point light.

```ts
declare const env: texture_cube<f32>
declare const lut: texture_3d<f32>
declare const pointShadow: texture_depth_cube

const sky = textureSample(env, smp, dir) // by direction
const glossy = textureSampleBias(env, smp, dir, 2.) // the implicit level, shifted coarser
const graded = textureSampleLevel(lut, smp, sky.rgb, 0.) // the colour IS the coordinate
const detail = textureSampleGrad(albedo, smp, uv, ddx, ddy) // explicit gradients, any stage
const lit = textureSampleCompare(pointShadow, shadowSmp, normalize(toLight), length(toLight))
const size = textureDimensions(lut) // vec3u: a volume's size is three wide
```

```wgsl
@group(0) @binding(0) var env: texture_cube<f32>;
@group(0) @binding(1) var lut: texture_3d<f32>;
let glossy = textureSampleBias(env, smp, dir, 2.0);
let detail = textureSampleGrad(albedo, smp, uv, ddx, ddy);
```

```glsl
precision highp sampler3D;
precision highp samplerCubeShadow;
uniform samplerCube env;
uniform sampler3D lut;
vec4 glossy = texture(env, dir, 2.0);
vec4 detail = textureGrad(albedo, uv, ddx, ddy);
float lit = texture(pointShadow, vec4(dir, ref));
uvec3 size = uvec3(textureSize(lut, 0));
```

**One read id per shape, and the width rides on the type.** `textureSample` on a cube is the
same neutral id as on a 2D texture — WGSL spells both `textureSample`, GLSL both `texture` —
because the coordinate's width is a fact about the *texture's* type, not about the call. What
the front end adds is the check: a `vec2` on a cube, a `vec3` on a 2D texture, a `vec2i` fetch
on a 3D one, a gradient of the wrong width — each is refused at the argument, in the author's
own file, where Tint would say `no matching call` and a WebGL2 driver `no matching overloaded
function` about generated code. The two shapes that *do* restructure their arguments are their
own ids, per the rule the array layer is written under (§34): a **3D size** is `uvec3` where the
2D wrapper is `uvec2` (`textureDimensions3d`), and a **cube comparison** folds the reference into
a `vec4` where the 2D one folds it into a `vec3` (`textureSampleCompareCube`). A cube's own size
is two wide on both targets — the size of one face — so it keeps the 2D id.

**Measured, on Tint and on a WebGL2 driver.** Every accepted shape above compiles on both.
Three facts decided the design:

| shape | Tint | WebGL2 driver | so |
| --- | --- | --- | --- |
| `textureSampleBias` outside a fragment stage | `built-in cannot be used by compute pipeline stage` | `no matching overloaded function` (vertex) | fragment-only, with `textureSample` and `dpdx` |
| `textureSampleGrad` in a compute / vertex stage | accepts | accepts | any stage |
| `textureLod` on `samplerCubeShadow` | — | `no matching overloaded function` | level 0 is `textureGrad` with zero `vec3` gradients, as on the 2D array shadow |

A bias shifts the *implicit* level of detail, which needs the derivatives only a fragment quad
has; explicit gradients need none. The shadow-cube `textureLod` gap is the one §34 met on the
2D array, met again one dim over, and answered the same way — a zero gradient is a level of
detail of −∞, clamped to the base level.

**What a cube cannot do.** Neither target has a texel fetch for a cube: WGSL's `textureLoad`
and GLSL's `texelFetch` both stop at 2D, 2D array and 3D. `textureLoad(env, …)` is therefore
refused with the read to use instead. It follows that an **integer cube** has no read on this
surface: a cube is only sampled and sampling is float-only, so `texture_cube<u32>` is refused
at the declaration — once, with the reason, rather than at a read that would have to explain
both facts — and `tsc` refuses it too, since the ambient `texture_cube<E extends f32>` admits
no other element. `textureGather`, the read an integer cube does have, is the WGSL-only half of
this item and lifts the refusal when it lands. `textureNumLayers` names what a cube and a 3D
texture have instead of layers (six faces; depth, `textureDimensions(t).z`).

**Precision.** GLSL ES 3.00 §4.5.4 predeclares a default precision for `sampler2D` and
`samplerCube` only, so the header declares one for `sampler3D`, `samplerCubeShadow` and every
integer-prefixed form (`usampler3D`), and none for `samplerCube` — derived from the type
spelling, as before, so a new sampler type cannot declare itself without its line.

**What the host is told.** `textureDim` is now `'2d' | '2d-ms' | '2d-array' | 'cube' | '3d'`,
the value `GPUTextureViewDescriptor.dimension` takes; a depth cube reflects with
`textureDim: 'cube'` and `textureDepth: true`. The CPU twins keep their contracts: a bias or
gradient sample yields opaque black, a cube comparison yields 1 (the identity for the lighting
multiply, §34), and a 3D size yields 1×1×1. `examples/cube-env.shade.ts` is the gate's evidence
on both targets.

**The other half is §36.** `texture_cube_array`, `texture_1d` and `textureGather` are WGSL-only,
each its own derived capability with no GLSL profile row, the way a storage texture fails closed
(§33).

## 36. The WGSL-only textures: `texture_1d`, `texture_cube_array`, `textureGather`

Roadmap 0.4 item 12, the second half. A **1D texture** is a row of texels addressed by one
number, the shape a transfer function or a colour ramp takes. A **cube array** is N cube maps in
one binding, looked up by a direction and a layer; its depth twin, `texture_depth_cube_array`, is
the shadow maps of N point lights. **`textureGather`** reads the four texels a linear filter would
blend at mip level 0, one channel each, as a `vec4`, in any stage; **`textureGatherCompare`** does
the same through a comparison sampler and returns four pass results. The design is read straight
off the spec (§17.7.2, §17.7.3) and Tint's `core.def`.

```ts
declare const ramp: texture_1d<f32>
declare const envs: texture_cube_array<f32>
declare const pointShadows: texture_depth_cube_array

const heat = textureSample(ramp, smp, uv.x) // one number in
const steps = textureDimensions(ramp) // u32: one wide
const sky = textureSample(envs, smp, dir, layer) // the layer after the direction
const reds = textureGather(0, albedo, smp, uv) // component FIRST: 0 is red, 3 is alpha
const passes = textureGatherCompare(shadow, shadowSmp, uv, ref) // no component: one channel
const lit = textureSampleCompare(pointShadows, shadowSmp, dir, layer, ref)
```

```wgsl
@group(0) @binding(0) var ramp: texture_1d<f32>;
@group(0) @binding(1) var envs: texture_cube_array<f32>;
let reds = textureGather(0, albedo, smp, uv);
let passes = textureGatherCompare(shadow, shadowSmp, uv, 0.5);
```

**WGSL-only, three capabilities, derived.** GLSL ES 3.00 has none of the three, measured on a
WebGL2 driver: `sampler1D` is a *reserved word*, `samplerCubeArray` needs
`GL_EXT_texture_cube_map_array`, which the driver reports "not supported", and `textureGather`
arrived in ES 3.10 ("no matching overloaded function"). So each is a **derived** capability —
`texture1d` and `textureCubeArray` from a binding's type, `textureGather` from a call — with a
WGSL row and no GLSL row, the pattern `storageTexture` set (§33): the gate fails the module
closed on GLSL before any emit, `enables` cannot name them, and `reflect().requiredFeatures`
tells the host which ones a module needs. Three capabilities rather than one because a module
that uses a cube array and no gather should not be told about gather. On Tint every shape here
was measured accepted, gather in a compute stage too (`scratchpad/item12-probe.mts`).

**The argument order is the spec's.** WGSL puts the **component first** on a colour texture and
has **none** on a depth texture, whose texels have one channel; the layer follows the coordinate
on an array; the reference follows the layer on the compare form. This surface keeps that order
rather than inventing a TypeScript-flavoured one, so a WGSL author's muscle memory carries over
and the spec's own tables document the calls — the front end finds the texture by its *kind*
rather than its position. The component must be a whole number from 0 to 3 **written in the
call**: WGSL requires a const-expression there and makes any other value a shader-creation
error, so it is refused here, at the argument, with the channel names. `textureGather`'s result
takes the texture's element (`vec4<u32>` on a `texture_cube<u32>`), which is what makes an
**integer cube** readable at last: §35 refused `texture_cube<u32>` at the declaration because a
cube has no texel fetch and sampling is float-only; gather is the read it has, so the
declaration is admitted now and `textureSample` on it names `textureGather`.

**One id per argument structure, never a spelling that depends on the texture.** The cube-array
sampling forms are their own ids (`textureSampleCubeArray`, …`LevelCubeArray`, …`BiasCubeArray`,
…`GradCubeArray`, …`CompareCubeArray`, …`CompareLevelCubeArray`) rather than the 2d-array ones,
even though GLSL never emits either: the 2d-array spellings fold the layer into a
`vec3(uv, layer)`, which would be well-formed and *wrong* text for a cube array, and an id's
text must never depend on the texture it happens to be called on. The gathers are six ids by
the same rule (`textureGather`, `…Array`, `…Depth`, `…DepthArray`, `…Compare`,
`…CompareArray`); a cube gathers with the 2d id, since the coordinate's width rides on the type.
`textureDimensions` on a 1d texture is `textureDimensions1d`, a `u32` where the 2d wrapper is a
`uvec2`.

**What a 1d texture cannot do.** WGSL gives it `textureSample`, `textureSampleLevel` and
`textureLoad` only — no bias, no gradients, no gather, no layers — and each is refused in one
sentence naming the reads it has. A coordinate is checked for width like every other dim: a
`vec2` on a `texture_1d` is "takes a single f32 coordinate; got vec2<f32>".

**Fragment-only, under the name the author wrote.** `textureSample`, `textureSampleBias` and
`textureSampleCompare` on a cube array join the fragment-only set as their own ids, and the
message strips the `CubeArray` suffix: `"textureSampleBias" is only valid in a fragment shader`.
Gather takes no implicit derivative and is legal in any stage, which Tint confirms.

**What the host is told.** `textureDim` gains `'1d'` and `'cube-array'`; a depth cube array
reflects `textureDim: 'cube-array', textureDepth: true`. The CPU twins: a colour gather yields
opaque black, a depth gather the far plane (four 1s — nothing occludes), a gather compare four
1s (the identity for the multiply each feeds), a 1d size 1. `examples/cube-array-gather.shade.ts`
is the gate's evidence on the Tint half.

**Not here, by the audit's word.** The offset variants of every sampling builtin,
`textureNumLevels`, `textureSampleBaseClampToEdge`, `texture_external`, the storage 1d and 3d
textures, and `u32` array indices and levels where WGSL takes either: the spec audit lists each
with its portability, and they become their own items rather than riding this one.
`textureNumSamples` and `texture_depth_multisampled_2d` were on this list until §37 took them.

## 37. A multisampled texture, read one sample at a time

Roadmap 0.4 item 13. The type existed — `texture_multisampled_2d` and the `msaaTextureLoad`
capability — and nothing read it. This is the read: `textureLoad(t, coords, sampleIndex)` yields
one sample, `textureNumSamples(t)` says how many there are, and `textureDimensions(t)` the size.
The depth twin, `texture_depth_multisampled_2d`, is the depth attachment of an MSAA target,
loaded the same way and yielding an `f32`.

```ts
declare const msaa: texture_multisampled_2d<f32>
declare const depthMs: texture_depth_multisampled_2d

const c: vec2i = vec2i(p.xy)
const s0 = textureLoad(msaa, c, 0) // the third argument is a SAMPLE INDEX, not a level
const n = f32(textureNumSamples(msaa))
const depth = textureLoad(depthMs, c, 0) // f32
```

**Nothing else applies.** WGSL §6.6.3: a multisampled texture "cannot be used with a sampler".
Every sampling, comparison and gather form is refused in one sentence that names the load, and
so is `textureNumLayers` (samples, not layers). `textureNumSamples` on a single-sample texture
is refused the same way. The sample index is an integer like a level: a bare `3` is retargeted,
a fractional one refused.

**WGSL-only, by the capability the binding already derived.** GLSL ES 3.00 has no `sampler2DMS`
(that is ES 3.10), so `msaaTextureLoad` fails the module closed on that target before any emit,
for the depth twin too. The reads are their own ids (`textureLoadMs`, `textureLoadDepthMs`,
`textureDimensionsMs`, `textureNumSamples`) rather than the 2d ones: `texelFetch(t, c, int(s))`
would be well-formed, wrong text for a sample index, and the 2d size wrapper's `textureSize(t,
0)` takes a level a multisampled texture has none of.

**The element is no longer pinned to `f32`.** §6.6.3 parameterises the type by `f32`, `i32` or
`u32`, and `textureLoad` yields `vec4<T>`. The pin (X-GIS #1703) made an integer multisampled
texture unrepresentable while nothing read the type; with the spec as the authority and GLSL
failing closed by capability whatever the element, it bought nothing, so `texture_multisampled_2d<u32>`
is admitted.

**A plain read of a depth texture, at last, where it is safe.** §34 deferred plain reads of the
other depth textures because GLSL's fused sampler type is decided by the read. A multisampled
depth texture never reaches GLSL, so the reason does not arise and `textureLoad` on it is
admitted; the separate-samplers capability the others need stays a later item.

**What the host is told.** Both twins reflect `textureDim: '2d-ms'`, the depth one with
`textureDepth: true`. The CPU twins: a sample is opaque black, a depth sample the far plane, the
count 1 and the size 1×1, so a resolve that divides by the count stays finite.
`examples/msaa-resolve.shade.ts` is the gate's evidence on the Tint half.

## 38. What may differ by driver: the determinism report

WGSL gives every floating-point operation an accuracy (§15.7.4 of the spec). `x + y`, `x * y`,
`abs`, `floor`, `min` and `clamp` are correctly rounded: one answer, on every driver. `sin` is
allowed an absolute error, `exp` and `/` a number of ULP, `pow` and `mix` are "inherited from" a
formula the driver may reassociate or fuse (§15.7.5), and a derivative or `determinant` has no
bound at all. Only the first group is the same everywhere. The rest is the room two conforming
drivers have to disagree in, and the room a GPU result has to differ from the CPU oracle.

`compile()` returns that room as a list. `determinism` names every operation in the module
that may differ, with the spec's bound in words, how many times it occurs and where, in order
of first appearance:

```ts
"use typeshade";

class Color {
  @location(0) color: vec4;
}

@fragment
export function fs(@location(0) uv: vec2): Color {
  const wave: f32 = sin(uv.x * 6.2831) * 0.5 + 0.5;
  return { color: vec4(wave, uv.y, 0.5, 1.) };
}
```

```ts
import { compile } from 'typeshade'

const { determinism } = compile(source)
// [{ op: 'sin', elem: 'f32', kind: 'absolute',
//    accuracy: '2^-11 absolute error for x in [-π, π]', count: 1, where: ['fs'] }]
```

The multiply, the scale and the offset are correctly rounded and do not appear; `sin` does, with
the bound the spec gives it. An empty list means every operation in the module has one answer,
so a GPU result and the oracle can differ only by the oracle's own rounding, never by the
driver's choice.

"One answer" is the report's assumption, stated once. WGSL fixes no rounding mode, so a
correctly rounded result may be either neighbour of the exact value, and any operation may
flush a subnormal to zero. Every shipping driver rounds to nearest even, so the report counts a
correctly rounded result as one value and leaves the subnormal corners alone.

**The kinds.** `kind` says why an entry is there, and `accuracy` says how far it may go:

| `kind`      | What it covers                                                                                                                             | Examples                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ulp`       | a bound in units in the last place                                                                                                         | `/` (2.5 ULP), `exp`, `exp2`, `atan`, `atan2`, `inverseSqrt`, `unpack4x8unorm`                                                            |
| `absolute`  | an absolute error bound over an interval, or the worse of one and an inherited formula                                                     | `sin`, `cos`, `log`, `log2`, `asin`, `acos`, `tanh`                                                                                       |
| `inherited` | defined by a formula the driver may evaluate any way at least as accurate, reassociated or fused                                           | `pow`, `sqrt`, `tan`, `mix`, `smoothstep`, `fract`, `length`, `normalize`, `dot`, `cross`, `fma`, `mod`, `%`, `degrees`, `radians`, `mat * vec`, `mat * mat` |
| `unbounded` | the spec asks only for a pragmatically useful result                                                                                       | `dpdx`, `dpdy`, `fwidth` and their coarse and fine forms, `determinant`                                                                   |
| `filtered`  | a texture read whose footprint, filtering and level of detail selection are implementation-defined                                         | every `textureSample*`, the comparison forms included, and `textureGather`, whose four texels the footprint selects                       |
| `target`    | one answer on WGSL, but the GLSL ES 3.00 spelling may answer differently on some input                                                     | `ldexp` at `e = 128`; `pack4x8unorm`, `pack2x16unorm`, `pack2x16snorm` at an exact half                                                   |
| `emulated`  | an `f64` operation: f32 pairs whose error terms hold while the driver neither reassociates nor fuses them                                  | every arithmetic operator, `floor`, and every bounded builtin on `f64`, `vecNf64` and `matNf64`                                            |

**What is not listed.** Integer arithmetic, comparisons and the bit builtins, which have a correct
result. `+`, `-` and the component-wise `*` on `f32`, which are correctly rounded; a matrix
product is a sum of products and is listed. `abs`, `floor`, `ceil`, `trunc`, `round`, `sign`,
`min`, `max`, `clamp`, `saturate` and `step`, the builtins the optimizer folds at compile time
because they have one answer (issue #73). `fract` is not among them: the spec words it as
inherited from `x - floor(x)` and says `fract` of a tiny negative may be 1.0, so it is listed. The
casts, `pack2x16float` and `unpack2x16float`, which are correctly rounded on both targets. Texel
fetches (`textureLoad`), sizes, stores and atomics. A call to one of the module's own helpers is
not listed itself; its body is, under the helper's name. A `raw` statement is opaque WGSL and is
not read.

**One row per operation and float.** `sin` on `f32` and `sin` on `f64` are two rows, since the
second is an emulation with its own reason to differ. `where` names the module constants, module
variables and functions whose initializer or body holds the operation, in declaration order, each
once; `count` is the number of occurrences over all of them.

**The two targets.** GLSL ES 3.00 (§4.5.1) bounds the arithmetic operators, `a * b + c`, `pow`,
`exp`, `exp2`, `log`, `log2`, `sqrt`, `inversesqrt` and the explicit conversions with the numbers
WGSL gives them, lets every builtin it defines by an equation (the geometric and common
functions) inherit those bounds, and leaves the trigonometric functions, `determinant` and the
derivatives with undefined precision. So an `inherited` row means the same on both targets, and
an `absolute`, `ulp` or `unbounded` row is bounded by the driver alone on GLSL; the words in
`accuracy` are WGSL's. Where the GLSL spelling matters the row says so in `note`: `fma` has no
fused form on GLSL ES 3.00 and is emitted as `a * b + c`, which that spec lets be one fused or two
correctly rounded operations, the same room WGSL leaves `fma`; `mod` is spelled
`x - y * floor(x / y)` on WGSL and `mod(x, y)` on GLSL, both inheriting from that formula. A
`target` row is the case where the two can part on an input WGSL settles: the GLSL `ldexp`
spelling overflows at `e = 128`, and the GLSL `pack` forms round an exact half in an
implementation-chosen direction where WGSL takes `floor(0.5 + x)`.

**One operation at a time.** `accuracyOf(op)` answers for a single builtin id, operator or matrix
product: `{ kind: 'exact' }` when there is one answer on both targets, otherwise the kind and
bound the report would list. It answers for every id the compiler can emit; the test suite walks
the intrinsic tables and fails on a new builtin that has not been placed in one column or the
other.

The list is the input to the divergence report of roadmap item 19: when a GPU result and the
oracle disagree, the operations here are where the spec allows it, and everything else is a bug
in one of the two.

## 39. `f64`: the emulated double

Neither target has a 64-bit float. `f64` is an *emulated* double: a pair of `f32` words whose
sum is the value, and a library of error-free transforms over that pair. The type is yours to
write; a pass rewrites every `f64` into `vec2<f32>` plus `df64_*` calls before any backend sees
one, so WGSL and GLSL ES 3.00 both receive ordinary `f32` code and the CPU oracle evaluates the
same program as a JavaScript double, which *is* an IEEE binary64.

What that buys is significand, not range: about 48 bits against `f32`'s 24. A world coordinate
near 10⁷ has an `f32` ulp of 1, so `fract(x)` there is a constant and the detail is gone;
the same expression on an `f64` keeps it. `examples/fp64-lane-stripes.shade.ts` draws both
halves side by side.

```ts
"use typeshade"

class Uniforms {
  origin: f64   // one vec2<f32> slot; the host writes the two words
  span: f32
}
declare const u: uniform<Uniforms>

export function stripes(t: f32): f64 {
  const stripe: f64 = 0.125       // a literal in a DECLARED f64 position keeps the double
  const world = u.origin * 2.5    // a literal beside an f64 is lifted to an f64 literal
  const swept = world + u.span * t // an f32 beside an f64 widens exactly, as vec2<f32>(x, 0.)
  return fract(swept / stripe)
}
```

A literal is retyped only where the surrounding type *says* `f64` — a declaration, a parameter,
a field, a return, or the other side of an operator. `f64(0.1)` says it explicitly and is left
alone; it carries the whole double too (the cast folds a literal argument at full precision),
so the two spellings emit the same pair. What the retype buys is that the natural one compiles:
`const k: f64 = 0.1` used to be a type mismatch, `f64` against the `f32` every bare literal
lowers to, and the only way to write an f64 constant was the explicit cast.

**Vectors.** `vec2f64`, `vec3f64` and `vec4f64` are vectors of doubles. They swizzle and index
like any other vector — a lane is a swizzle of the hi and lo planes the pass lowers the vector
into — and `vecN(v)` narrows one per lane, which is `f32(lane)` N times.

```ts
export function lanes(p: vec3f64): vec3 {
  const x = p.x        // f64
  const first = p[1]   // f64 — a CONSTANT lane; p[i] with a variable i has no lowering
  const pair = p.xy    // vec2f64
  return vec3(p)       // the per-lane narrow
}
```

`length`, `distance` and `dot` on a `vec3f64` are `f64`, not `f32`: the pass composes each from
the scalar transforms and hands back the pair. `determinant` is the exception — a matrix of
doubles carries only `*` and `transpose`, so `determinant` on one is refused at the call, and
the remedy is to declare that matrix `mat4`.

**What is emulated, and what is refused.** There is a `df64_*` body for ten builtins on a scalar
and thirteen on a vector, and for nothing else:

| shape | lowered |
| --- | --- |
| `f64` | `abs`, `cos`, `floor`, `fract`, `max`, `min`, `mix`, `round`, `sin`, `sqrt`, and `+ - * /` with the six comparisons |
| `vecN<f64>` | the same, minus `sqrt`, plus `normalize`, and the reductions `dot`, `length`, `distance` |
| `matNxN<f64>` | `*` and `transpose` |

Everything else is refused **at the call**, naming the list and the narrow:

```
ceil has no emulated-double form; got f64. On an f64 the pass lowers abs, cos, floor,
fract, max, min, mix, round, sin and sqrt — narrow first, e.g. ceil(f32(x)).
```

On a vector the same refusal names the vector narrow, `ceil(vec3(v))`: `f32(v)` on a `vec64`
is not a narrow at all and the pass has no body for it.

`%` is refused too, at the operator — there is no df64 remainder — and so are `i32(x)` and
`u32(x)` on a double, which have no direct body either: narrow to `f32` first, `i32(f32(x))`.
A lane is a READ. `v.x = …` and `v[0] = …` are refused, because after lowering the vector is
two separate hi/lo planes and a lane of it is a swizzle of both, which is not a place; rebuild
the whole vector instead.

`round` is WGSL's: the nearest integer with ties going to the **even** one, which is what the
CPU oracle answers. (The library also carries `nint`, whose ties go toward +∞ because the
mod-2π reduction needs that convention; the two disagree at every half-integer, and `round` is
not it.) `%` has no emulation and stays refused, as does an `f64` in any slot a target takes as
a plain `f32` — a mip level, a sampling bias, a comparison's reference depth:

```
textureSampleLevel's level must be an f32; got f64. Write f32(x).
```

**Across an entry boundary.** A double cannot be a varying. A `@location` field interpolates
each of its two `f32` words on its own, and the interpolation of the words is not the
interpolation of the double they encode, so the compiler refuses an `f64` on an entry's
`@location` parameter, on an IO struct field and on an entry's return:

```
Parameter "p" carries f64: an emulated double is a pair of f32 words, and a @location
varying interpolates each word on its own, which is not the interpolation of the double.
Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or
storage binding carries an f64 and every stage can read one.
```

Both remedies are ordinary. There is **no author-facing way to split a double into its words
and rebuild it**, and that is deliberate: the two `f32` words are the emulation's business, not
the language's, and a program written against them would be written against an implementation
detail. A double two stages need is read in each of them — a uniform or a storage binding
carries an `f64` and every stage can see one — or narrowed to an `f32` at the boundary when
`f32` is enough for what crosses it.

The one `@location` an `f64` may sit on is a **vertex** input, which is a buffer read rather
than a varying: the pair fits the single slot the attribute already is. A `vec3f64` attribute
would need two slots and is refused.

(Carrying the words as two `@interpolate(flat)` varyings and rebuilding them transparently
would be exact, since flat interpolation does no blending. It is not done, because this
surface has no `@interpolate` attribute: an author can neither ask for a flat varying nor see
that one was chosen, so a double silently made flat would change what the program draws with
nothing to point at. If `@interpolate` lands, this is worth revisiting.)

**The guard.** A module that uses the emulation gets a `_fp64` binding injected at lowering: a
1×1 `texture_2d<f32>` the host must fill with `1.0`. It is what stops a driver's fast-math from
algebraically cancelling the error-free transforms — the pair only works because the compiler is
not allowed to "simplify" `(a + b) - a`, and a value read from a texture is one it cannot fold
through. `reflect()` reports it like any other binding, group and slot included, so bind what
reflection lists and the guard is covered; a host that skipped it got a WebGPU validation error
or, on WebGL2, a silently wrong picture.

## 40. Matrices: every `matCxR`

A matrix is `cols` columns of `rows` components, column-major, which is what both targets are.
All nine shapes of `C, R ∈ {2, 3, 4}` are types, spelled `matCxR`, and a square one also
answers to `matN`:

```ts
"use typeshade"

export function shapes(a: mat3, b: mat2x3, c: mat4x3): vec3 {
  //  mat3   = mat3x3   3 columns of 3
  //  mat2x3           2 columns of 3
  //  mat4x3           4 columns of 3
  return a[0] + b[1] + c[3]
}
```

`m[j]` is **column j**, a `vecR` — not row j, and not one component. The two readings coincide
only on a square matrix, which is why it was worth saying once here.

**Constructors.** Four forms, and a matrix takes whichever one fits:

```ts
const fromColumns = mat3(vec3(1., 0., 0.), vec3(0., 1., 0.), vec3(0., 0., 1.))
const fromParts   = mat2x3(1., 2., 3., 4., 5., 6.)   // column by column
const zero        = mat2()
const truncated   = mat3(model)                       // the upper-left 3×3 of a mat4
```

Truncation is offered and widening is not: `mat3(m4)` is the normal matrix a renderer wants,
while `mat4(m3)` would have to invent a fourth column, and which one it should be is the
author's choice rather than the compiler's.

**Products.** The table is wgsl.txt:9960-9995, and GLSL ES 3.00 spells each one the same way:

| written | means | result |
| --- | --- | --- |
| `m * s`, `s * m` | component-wise scaling | the matrix's own type |
| `m * v` | the column-vector product, `matCxR * vecC` | `vecR` |
| `v * m` | the **row**-vector product, `vecR * matCxR`, which is `transpose(m) * v` | `vecC` |
| `a * b` | `matKxR * matCxK`, the shared dimension cancelling | `matCxR` |

`v * m` and `m * v` are different products, so the one you want is the one you write. A pair
whose dimensions do not meet is refused, naming both shapes.

**Builtins.** `transpose(m)` on a `matCxR` gives a `matRxC` — a different type unless the
matrix is square. `determinant(m)` takes a square matrix only, since a non-square one has
none; asking for it names that.

**`matCx2` in a uniform block is refused**, and it is the only shape that is. Measured on a
real WebGL2 driver and on Tint: std140 rounds every matrix column up to 16 bytes, while WGSL's
column stride is `AlignOf(vecR<f32>)` — 8 when the matrix has two rows and 16 otherwise. So a
`mat2x2`, `mat3x2` or `mat4x2` field would sit at different byte offsets on the two targets,
and so would every field after it:

```
wgslLayout: mat2x2 in std140 is not supported — WGSL gives a two-row matrix a column
stride of 8 and GLSL std140 rounds every column to 16, so the two targets would disagree
on this field and every field after it; carry it as mat2x4 (measured: both targets stride
16) or as 2 vec2 fields
```

It is refused rather than silently padded because padding would make the WGSL a module emits
disagree with the offsets `reflect()` reports for it, and keeping those two the same is the
whole job of the layout layer. Every other shape agrees byte for byte and needs no ceremony —
a `mat3` rides a uniform block as it is. Outside a uniform block, in a storage buffer, there is
no such rule and all nine shapes are admitted: std430 does not round a column up to a `vec4`,
so the two targets agree on every shape. (A three-row column is still padded from 12 bytes to
16 in both layouts, because that is `vec3`'s own alignment rather than std140's rounding.)

**Emulated doubles stay square.** `mat2<f64>`, `mat3<f64>` and `mat4<f64>` carry `*` and
`transpose`; a non-square one is refused, because the fp64 pass has one `df64` body per
dimension rather than per shape. §39 has the rest of the `f64` surface.

## 62. A name a target reserves

Each of the two shading languages reserves a vocabulary of its own, and a name that lands on
one used to reach the author as a line number in text they never wrote:

```
glsl: fragment: ERROR: 0:16: 'half' : Illegal use of reserved word
```

That was a struct field named `half` ([#103](https://github.com/typeshade/typeshade/issues/103)).
A declared name is now checked against the reserved words of the targets the module is
**actually emitted for**, and refused where it is written, with `TS8068`:

<!-- doc-snippets: skip — the block IS the refusal: a field named `half` is what TS8068 reports -->

```ts
"use typeshade"

class Vertex {
  @builtin("position") pos: vec4
  @location(0) half: vec2 // TS8068 "half" is reserved in GLSL ES 3.00, so a field of that
} //                         name cannot be emitted for the WebGL2 target. Rename it.
```

**The name that is checked is the one the emit carries.** A class's static field is `Cls_K`, a
namespace's member is `Ns_K`, an inherited field is `Cls_super_Base_member`: the flattening is
what a backend sees, so that is what the check reads. A class `S` with a static `half` is
`S_half` and compiles; a class `atomic` with a static `uint` is `atomic_uint`, which GLSL ES
3.00 reserves, and the message names both spellings — `"uint" is emitted as "atomic_uint",
which is reserved in GLSL ES 3.00, …` — while underlining the member the author wrote.

**A target the module never reaches does not get a vote.** A compute kernel has no GLSL ES 3.00
form — that is the one stage the language does not have — so it may name a field `half`; WGSL is
every module's target and is always checked. `examples/array-length.shade.ts` carries exactly
that field, so Tint accepts the name on every gate run.

**The severity follows the target's role.** A WGSL word is an **error**: WGSL is the program,
and the module does not compile. A GLSL ES 3.00 word is a **warning**, which is what this
package already answers for "the second target cannot take this module" — `wgsl` is still
there, `glsl` comes back `undefined`, exactly as for a compute entry beside the render pair or
a storage binding the emulation cannot spell. The GLSL writer fails the emit closed on the same
names, so the warning is never the only thing between a reserved word and a driver, and a
render module that would not have produced GLSL anyway is never refused outright for a word it
would never have emitted.

**What the GLSL writer renames for itself is not refused.** A local, a parameter and a function
name that collides with a GLSL word is rewritten with every reference to it (`let out` becomes
`out_`), and that has always worked. The module surface it cannot rename is what this check
covers: a struct and its fields (the std140 offsets and the cross-stage varying contract), a
module constant, an override's `#define`, a module variable and a binding, whose name is the
host's reflection key. WGSL renames nothing, so every kind is checked for it, including the two
rules that are shapes rather than words: a name beginning with `__`, and the bare `_`. GLSL ES
3.00 §3.6 has two shape rules of its own, and both are read here too: a name beginning with
`gl_`, which it keeps for built-ins, and one containing `__` anywhere, not only at the front.

All three spellings of a struct are read — a `class`, an `interface` and a `type` alias are one
struct to the emitters, so they are one struct here.

**Both lists are the target's own, measured on the compiler that receives the text.** WGSL's are
the 26 keywords and 146 reserved words of the spec, transcribed from its source; GLSL ES 3.00's
are read off ANGLE's version-gated lexer at shader version 300, which is what a WebGL2 context
gives. Measured in Chromium, through the compile gate's instrument:

| Written | WGSL on Tint | GLSL ES 3.00 on ANGLE |
| --- | --- | --- |
| a field or constant named `half` | accepted | `'half' : Illegal use of reserved word` |
| a local named `as` | `'as' is a reserved keyword` | — |
| a local named `discard` | `expected identifier for variable declaration` | — |
| a name named `filter` | `'filter' is a reserved keyword` | `'filter' : Illegal use of reserved word` |
| a local named `__x` | `identifiers must not start with two or more underscores` | — |
| a name named `input`, `sample`, `image2D` | accepted | `Illegal use of reserved word` |
| a name named `gl_Scale` | accepted | `'gl_' : reserved built-in name` |
| a name named `a__b` | accepted | `identifiers containing two consecutive underscores (__) are reserved` |
| a name named `buffer`, `packed` | accepted | accepted |
| a name named `shared`, `with` | `is a reserved keyword` | accepted |

The last two rows are why each list is read from its own target's authority rather than from
one merged vocabulary. `buffer` and `shared` become GLSL keywords in ES 3.10 and `packed` is
reserved in ES 1.00, so refusing any of them at 300 would refuse a program a WebGL2 driver
compiles — while `shared` and `with` are WGSL reserved words, which is what the WGSL column
says and what Tint enforces.

---

Last updated: 2026-09-21
