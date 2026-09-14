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

| GPU          | TypeShade                                         | `@` allowed?                      |
| ------------ | ------------------------------------------------- | --------------------------------- |
| Buffer / UBO | `declare const/let` + `uniform<T>` / `storage<T>` | No (const cannot take decorators) |
| Value layout | `class` fields or `type` alias                    | Yes, on **class fields only**     |
| Shader stage | top-level `export function`                       | `@compute` `@vertex` `@fragment`  |

Do not put an entry method on a class. Do not use a class as a bind group.

---

## 1. Resources — `declare`

Host-owned. No initializer. Slot index = source order of `declare` in the file.

```ts
'use typeshade'

declare const camera: uniform<Camera>
declare const src: storage<f32>
declare let pixels: storage<f32>
```

| Declaration                   | Space   | Access           |
| ----------------------------- | ------- | ---------------- |
| `declare const x: uniform<T>` | uniform | read             |
| `declare const x: storage<T>` | storage | read             |
| `declare let x: storage<T>`   | storage | read_write       |
| `declare const x: T`          | illegal | space required   |
| `declare let x: uniform<T>`   | illegal | uniform is const |

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
  @location(1) @interpolate('linear') uv: vec2
}
```

Of that list the compiler applies `@location` and `@builtin` today. `@align` on a field is
an error (`TS8010`) rather than a silent no-op — the `@align(16)` above is _(target)_.
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

| Idea                                          | Why not                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@uniform const scale`                        | TS does not parse decorators on `const`                                                                                                                                                                                                                                                                                                                                                                |
| `class Scene { @compute paint() {} }`         | `this` is not a GPU instance                                                                                                                                                                                                                                                                                                                                                                           |
| Static class as bind group                    | Extra ban list; emit `.d.ts` instead                                                                                                                                                                                                                                                                                                                                                                   |
| Per-decl binding numbers as the happy path    | Host mismatch is silent on GPU                                                                                                                                                                                                                                                                                                                                                                         |
| JS `Array` / lambdas / `filter` length change | IR + WGSL constraints                                                                                                                                                                                                                                                                                                                                                                                  |
| Implicit `gid` / `vid` / `pid` globals        | Hidden stage inputs make dependencies less explicit                                                                                                                                                                                                                                                                                                                                                    |
| Recursion, direct or mutual                   | WGSL has no call stack; Tint rejects the module outright. The check is SYNTACTIC, so a call in code the optimizer would drop (`if (false) { f() }`, an unread `const x = f()`) is a cycle too. That is stricter than Tint for that class, and deliberately so: matching the optimizer would accept `if (false)` and reject `if (DEBUG)` for `const DEBUG: bool = false`, which no author could predict |

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

| Situation                                                           | Error                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `declare const x: f32`                                              | need `uniform<T>` or `storage<T>`                                                                                                                                                                          |
| `declare let x: uniform<T>`                                         | uniform must be `declare const`                                                                                                                                                                            |
| assign to `declare const` resource                                  | read-only                                                                                                                                                                                                  |
| two resources share `@binding`                                      | name both                                                                                                                                                                                                  |
| builtin parameter on an incompatible stage                          | stage mismatch                                                                                                                                                                                             |
| `@compute` method on a class                                        | entries are top-level functions                                                                                                                                                                            |
| a function that reaches itself, directly or through other functions | `TS8031` on the call that closes the cycle, naming the whole cycle                                                                                                                                         |
| `.length` on an `array<T>` with no `N`, anywhere                    | `TS8032`. For a `storage` array the length is the bound buffer's and needs `arrayLength` (unspelled today); for a local, a parameter or a `uniform<array<T>>` the fix is an explicit size, `array<f32, 3>` |

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
yet — stays in this document, is labelled _(target)_, and is never copied into `README.md`,
the org profile, or any other front-facing page. Those pages carry only examples that
compile, which `src/compiler/ts/doc-snippets.test.ts` enforces.

**Numbering:** §9 is reserved for issue #8's A2 (member and component assignment), which is
in flight on its own branch and appends here in issue order. The sections below took the next
free numbers so the A-item branches do not all claim §9 and collide on merge.

---

## 10. Builtins, casts and `discard`

The scalar casts are `f32(x)`, `i32(x)`, `u32(x)`, `bool(x)` and `f64(x)`. `bool(x)` is
"x is not zero", WGSL's own conversion, and is spelled with the compare it means. `f64(x)`
widens an `f32` to the emulated double; casting a value to the type it already has is that
value.

Free builtin functions, callable without a `Math.` prefix, are the GLSL / WGSL names the IR
carries. Beyond the set that was already there (`sin` … `clamp`, `mix`, `smoothstep`, `step`,
`length`, `dot`, `cross`, `distance`, `normalize`, `mod`, `fract`, `degrees`, `radians`,
`inverseSqrt`):

| Spelling                          | Meaning                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `exp2(x)`                         | 2ˣ                                                                                   |
| `saturate(x)`                     | `clamp(x, 0., 1.)`; GLSL ES 3.00 has no `saturate`, so it is inlined there           |
| `fwidth(x)`, `dpdx(x)`, `dpdy(x)` | screen-space derivatives (`dFdx` / `dFdy` in GLSL)                                   |
| `fma(a, b, c)`                    | `a·b + c`; GLSL ES 3.00 has no `fma`, so it is inlined there                         |
| `atan(y, x)`                      | the two-argument arctangent (`atan2` in WGSL) — `atan(x)` is still one argument      |
| `select(f, t, c)`                 | `c ? t : f`. **WGSL's order: the condition is last.** The same IR the ternary builds |
| `a ** b`                          | `pow(a, b)`. Both operands must have one type; splat a scalar exponent               |

A function the file declares wins over any name in the table above, and over `bool` and
`f64`: those names meant the author's function before they were builtins, and an addition
does not change what a program means. The builtins that came earlier (`min`, `max`, `mix`,
`clamp`, `pow`, `f32` …) keep their precedence, for the same reason pointing the other way —
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
---

## 11. Vector constructors

A `vecN` constructor either **composes** a vector out of parts of its own element type, or
**converts** one whole vector of the same size:

```ts
vec3(a, b, c) // compose: three f32
vec3(0.5) // splat
vec4(v3, 1) // compose from a vec3 and a scalar
vec4(v2, v2) // compose from two vec2
vec3f(v) // convert: v is a vec3u, every component becomes an f32
vec3u(v) // convert the other way
vec2(gid.xy) // convert a vec2<u32> swizzle to vec2<f32>
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

Last updated: 2026-09-14
