# `"use typeshade"` language surface

Status: **on `main`** as of `2605a27` (PR #5 squash). Design freeze for layout / entry / data types.
Does not replace `docs/use-typeshade-plan.md` (IR phases 0–22). This document is the **author-facing grammar**.
`fn()` remains the IR equality oracle. Product code uses `"use typeshade"`.

North star: TypeScript syntax only where the TS parser already accepts it. No preprocessor. No second IR.

```
type Camera = { … }                             value struct (or class + field attrs)
class VsIn { @location(0) … }                   value struct + per-field metadata
declare const camera: uniform<T>                resource slot (host fills)
declare const pixels: storage<T, "read_write">  resource slot, writable
@compute([64]) export function                  entry
@vertex / @fragment export function             entry
```

GPU has three things. The grammar has three places.

| GPU              | TypeShade                                      | `@` allowed?                          |
|------------------|------------------------------------------------|---------------------------------------|
| Buffer / UBO     | `declare const` + `uniform<T>` / `storage<T, A>` | No (const cannot take decorators)     |
| Value layout     | `class` fields or `type` alias                 | Yes, on **class fields only**         |
| Shader stage     | top-level `export function`                    | `@compute` `@vertex` `@fragment`      |

Do not put an entry method on a class. Do not use a class as a bind group.

---

## 1. Resources — `declare`

Host-owned. No initializer. Slot index = source order of `declare` in the file. Every resource
is declared `const`, and a storage binding says in its TYPE how the shader may touch it.

**The two forms.** `storage<T>` is WGSL's `var<storage, read>` and `storage<T, "read_write">` is
`var<storage, read_write>`. The access mode is the second type argument, and the only two words
it takes are `"read"` and `"read_write"` — WGSL's own enumerants, written as string literal
types the way a storage texture already writes its own (§33). `"read"` is the default, so
`storage<T>` and `storage<T, "read">` are the same binding. A uniform buffer is read-only in
WGSL, so `uniform<T>` takes one type argument and has no mode to ask for.

```ts
"use typeshade";

interface Camera {
  view: vec4;
  fov: f32;
}

declare const camera: uniform<Camera>;
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  dst[gid.x] = src[gid.x] * camera.fov;
}
```

**What it emits.** The three declarations are the three WGSL `var`s, in source order:

```wgsl
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
```

`module.bindings` and `reflect()` carry the same mode: `{ space: "storage", access: "read" }`
for `src` and `{ space: "storage", access: "read_write" }` for `dst`, and a uniform binding has
no `access` field at all.

| Declaration | Space | Access | Emitted |
|-------------|-------|--------|---------|
| `declare const x: uniform<T>` | uniform | read | `var<uniform> x: T;` |
| `declare const x: storage<T>` | storage | read | `var<storage, read> x: T;` |
| `declare const x: storage<T, "read">` | storage | read | the same; the default written out |
| `declare const x: storage<T, "read_write">` | storage | read_write | `var<storage, read_write> x: T;` |
| `declare const x: T` | illegal | space required | `TS8099` |
| `declare let x: storage<T>` | illegal | the mode is a type argument | `TS8099` |
| `declare let x: uniform<T>` | illegal | a uniform is read-only | `TS8099` |
| `declare const x: storage<T, "write">` | illegal | a buffer has no write-only mode | `TS8002` |
| `declare const x: uniform<T, A>` | illegal | a uniform has no mode | `TS8002` |

**What each refusal says.** Every sentence below names the line to write instead, and the
refused declaration is still COLLECTED, so the one sentence is not buried under an
`Unknown identifier` at every use of the name.

- `declare let counts: storage<array<u32>>` — `TS8099`,
  `"counts" is a storage binding, and a binding is declared const: write "declare const counts: storage<array<u32>, "read_write">". A storage binding's access mode is its second type argument, not the declaration keyword.`
  The binding recovers as `read_write`, because a `let` author wanted to write.
- `declare let gain: uniform<f32>` — `TS8099`,
  `"gain" is a uniform binding, and a binding is declared const: write "declare const gain: uniform<f32>". A uniform buffer is read-only, so there is no writable form of it to ask for.`
- `declare const dst: storage<array<f32>, "write">` — `TS8002`,
  `storage<T, Access> Access is "read" or "read_write"; got "write". A storage BUFFER has no write-only mode; that is a storage texture's, texture_storage_2d<Format, "write">.`
  The binding recovers as `read_write`, because recovering as `read` would make the author's own
  write a second refusal on the same program.
- `declare const cam: uniform<Camera, "read">` — `TS8002`,
  `uniform<T> takes one type argument. A uniform buffer is read-only, so it has no access mode to write.`
- A write to a read binding — `TS8005`,
  `Cannot assign to "src" — it is a read-only resource. Write "declare const src: storage<array<f32>, "read_write">" to write to it.`
  A `uniform` gets the same first clause and no remedy: there is no writable uniform.
  The remedy names the form the file uses and the type as an AUTHOR spells it: a call-form
  binding is answered with `Write "const src = storage<array<f32>, "read_write">()" to write to
  it.`, and a vector, a matrix or an emulated double is named `vec4`, `mat2x3`, `vec2f64` and
  not by the compiler's internal key (`vec4<f32>`, which the editor answers with
  `TS2315 Type 'vec4' is not generic`). `src.length = 2` gets no remedy at all, because it is
  `TS8018` under either mode.

**The editor says the same thing.** The ambient library resolves `storage<T>` and `uniform<T>`
to `ReadView<T>`, one mapped type that makes every field, lane and index signature `readonly`
all the way down, and resolves `storage<T, "read_write">` to `T` itself. So `src[0] = 1.` is
TS2542 and `camera.fov = 1.` is TS2540 as they are typed, before `compile()` is called, while
`dst[0] = 1.` stays clean. A bad access word is TS2344 and a second type argument on a
`uniform` is TS2314, from the declaration's own constraint. Reading is untouched: a struct
copied out of a read array, `length(p.offset)`, `.length` on a read array and a method on a
class-typed read binding all behave exactly as before. §49 has the row for row.

Duplicate `@group @binding` is an error.

Sketch form still exists and occupies the same slot sequence, and takes the access mode in the
same place:

```ts
const scale = uniform<f32>();
const xs = storage<f32, "read_write">();
```

The `{ access: "read_write" }` option it once took is gone: writing it is `TS8099`,
`The { access } option is gone: a storage binding's access mode is its second type argument. Write "const ys = storage<array<f32, 4>, "read_write">({ binding: 3 })".`
The word it names is the author's own only when the author's own is one of the two: an option
that asked for something else is answered with `"read_write"`, never echoed back into a line
the next compile would refuse. On a `uniform`, which has no access mode to move anywhere, the
sentence is its own:
`The { access } option is gone, and a uniform buffer is read-only: it has no access mode to ask for. Write "const cam = uniform<f32>({ binding: 3 })".`
The editor refuses the option too, `TS2353 Object literal may only specify known properties, and 'access' does not exist in type '{ group?: number; binding?: number; }'`:
`uniform` and `storage` declare the slot they take (a binding number, a group and a binding, or
`{ group, binding }`), which they did not before — every call form that named its slot was
`TS2554 Expected 0 arguments, but got 1` in the editor on a program the compiler accepts, the
line this very refusal quotes included.

Product code should use `declare`. Mixing `declare` and call form in one file shares one slot counter; collisions still error.

Only the `const` half of the sketch form still compiles. Since a top-level `let` became a module
variable (§24), `let xs = storage<f32>()` is read as one as well and draws `TS8004 Unknown
function "storage<f32>()"`; write `declare const xs: storage<f32, "read_write">`.

`var` is not a resource declaration.

---

## 2. Value types — `type`, `interface` and `class`

Plain data without field metadata uses a type alias:

```ts
type Camera = {
  view: mat4;
  pos: vec3;
};
```

`interface Camera { view: mat4; pos: vec3 }` is the same struct written a third way. A class,
a type alias over an object type, and an interface all produce one `StructDecl`; the compiler
accepts all three.

A type alias over anything else is another name for its target, which is what it means in
TypeScript (roadmap 0.3 item T2):

```ts
type Meters = f32;
type Color = vec3;
type Grid = array<f32, 16>;
type Point = Camera;
```

The alias resolves wherever a type may stand: a parameter, a return, a class field, a local
annotation, a module const, and the argument of `uniform<...>` or `storage<...>`. A chain
resolves through, and a cycle (`type A = B; type B = A`) is TS8002 naming the chain rather
than a recursion. A builtin name wins over an alias of the same name, so `type vec3 = f32`
does not make `vec3` a scalar. A generic alias has no one target type and keeps its refusal;
generics are roadmap 0.3 item T9.

A struct is the members written in it, whichever of the three spellings declared it: a call
signature, an index signature and an optional (`a?: f32`) member are each rejected, since a
WGSL struct has no form for them and silently dropping one would change the buffer layout the
host fills. An interface that declares a method is not a struct but a contract, which a class
may name in `implements` and a type parameter may take as its constraint (§26, Rule 6.9). The
optional member is the one where the three spellings used to disagree: an interface refused it
and a class emitted it as required. They refuse it alike now. An `extends` clause is inheritance (roadmap 0.3 item T5, §26): the base's fields come
first and the derived ones after, so nothing is dropped.

Field metadata (`@location`, `@builtin`, `@interpolate`, `@invariant`, `@blend_src`, `@align`, `@size`, `@offset`, `@ignore`) requires a **class field**. Interfaces and type-literal members cannot carry TS decorators, so a struct used as entry I/O — where WGSL requires `@builtin` or `@location` on every member — has to be a class.

```ts
class Camera {
  @align(16)
  view: mat4;
  pos: vec3;
}

class VsIn {
  @location(0) position: vec3;
  @location(1) @interpolate("linear") uv: vec2; // WGSL only — GLSL ES 3.00 has no `linear`
}
```

Of that list the compiler applies `@location`, `@builtin`, `@interpolate`, `@invariant` and
`@blend_src` today (§53). `@location`, `@builtin` and `@interpolate` also apply to a bare entry
PARAMETER, which is how a fragment entry that takes one varying writes it. The rest are refused
rather than silently dropped, under two codes: `@align` on a field is `TS8010` ("@align on a
field is not applied"), so the `@align(16)` above is *(target)*; `@size`, `@offset` and
`@ignore` are `TS8028` ("Unknown attribute"), because the compiler's attribute list does not
carry them. Measured, not assumed: each of the five was compiled to read back its code.

`class` here is a struct with attributes, not an object.

Forbidden on these classes:

- `new Camera()` as a resource (a `new` on a class with a constructor builds a value, §26)
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
(`type Opts = { seed: number }`) — and is left alone, neither checked nor emitted, except
that its name counts toward the rule below. A `class` is always collected, as it always has
been.

One name, one declaration. A second class, interface or type alias of the same name is an
error, **including two interfaces**, which TypeScript itself would merge: the merged layout
would disagree with the one emitted here at every use site, so the ambiguity is refused
rather than silently resolved. It is refused whether or not anything uses the name (#172), so
the error sits on the second declaration and not on a use written later.

`declare` is the bind-group spelling; an `interface` is a value layout like any other.

---

## 3. Entries — function decorators and explicit builtins

Shader-stage inputs are **explicit function parameters**. TypeShade does not inject `gid`, `vid`, or `pid` as implicit globals.

```ts
@compute([64, 1, 1])
export function paint(
  @builtin("global_invocation_id") gid: vec3u
) {
  pixels[gid.x] += camera.pos.x;
}

@vertex
export function vs(
  @builtin("vertex_index") vid: u32,
  vin: VsIn
): vec4 {
  return camera.view * vec4(vin.position, 1);
}

@fragment
export function fs(
  @builtin("position") pid: vec4
): vec4 {
  return vec4(pid.x, 0, 0, 1);
}
```

- No stage decorator → helper, not an entry.
- Builtins are ordinary entry parameters with `@builtin(...)` metadata.
- A builtin is not a hidden global; its dependency is visible in the function signature.
- The builtin name must match the target backend's supported builtin set.
- Workgroup size is the only payload on `@compute`, an array of one to three whole numbers; a bare
  `@compute` takes the default of 64, emitted as `@workgroup_size(64)`.
- `y` and `z` default to 1, and WGSL spells only the extents it needs: `@compute([8, 8])` emits
  `@workgroup_size(8, 8)`, `@compute([4, 1, 2])` emits `@workgroup_size(4, 1, 2)`, and
  `@compute([64, 1, 1])` emits `@workgroup_size(64)` as it always did. `reflect()` reports the
  three extents as `workgroupShape`, `[8, 8, 1]`, beside `workgroupSize`, which stays the `x`
  extent; a host sizes a dispatch as `ceil(n / extent)` workgroups per axis. The CPU `dispatch`
  runs the same grid, with `global_invocation_id`, `local_invocation_id` and
  `local_invocation_index` filled in per axis (§25). `examples/workgroup-tile-2d.shade.ts` is the
  gate's evidence.
- A shape over WebGPU's default compute limits (`x` and `y` 256, `z` 64, 256 invocations in all)
  compiles with a warning (`TS8026`) naming the limit, since only a device requested with that
  limit raised runs it:
  `@compute workgroup shape [16, 16, 2] has 512 invocations, over maxComputeInvocationsPerWorkgroup (256). WebGPU guarantees no more, so a device requested without raising that limit refuses the pipeline.`
- A `portable` kernel's workgroup stays one-dimensional (`SD0111`): the WebGL2 lowering draws one
  texel per invocation and has no workgroup to give `y` and `z` to.
- `@compute({ workgroup: [64, 1, 1] })` is refused (`TS8037`):
  `@compute takes an array of one to three whole numbers, "@compute([64, 1, 1])", or no argument for the default of 64; "{ workgroup: [64, 1, 1] }" is not a workgroup shape.`

### What an entry may return

The shapes are the target's, not this compiler's, and there is one constraint per stage.

**A vertex entry returns the position.** A return typed `vec4` carries `@builtin("position")` on
its own, so the smallest vertex shader needs no struct and no parameters:

```ts
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(xs[i32(vi)], ys[i32(vi)], 0., 1.);
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
  return 0.5;
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
| JS `Array` / `filter` length change | IR + WGSL constraints |
| A function held in a variable, returned, or chosen at run time | Neither target has a function value; a local function and a closure's variables are §14's, and every call of one is written where it is in scope (Rule 8.17), as every function a call hands to a parameter of function type is named there (Rule 8.18) |
| Implicit `gid` / `vid` / `pid` globals | Hidden stage inputs make dependencies less explicit |
| Recursion, direct or mutual | WGSL has no call stack; Tint rejects the module outright. The check reads the calls as written, and a method call, an accessor and `new` as they lower, before the optimizer runs, so a call in code the optimizer would drop (`if (false) { f() }`, an unread `const x = f()`) is a cycle too. That is stricter than Tint for that class, and deliberately so: matching the optimizer would accept `if (false)` and reject `if (DEBUG)` for `const DEBUG: bool = false`, which no author could predict |

---

## 5. Lowering

```
declare const camera: uniform<Camera>
        → BindingDecl { name, space: "uniform", binding: N, type: Camera }

declare const pixels: storage<f32, "read_write">
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
| `declare let x: storage<T>` | `TS8099`. `"x" is a storage binding, and a binding is declared const: write "declare const x: storage<T, "read_write">". A storage binding's access mode is its second type argument, not the declaration keyword.` The binding is collected as `read_write` anyway, so the sentence is not buried (§1) |
| `declare let x: uniform<T>` | `TS8099`. `"x" is a uniform binding, and a binding is declared const: write "declare const x: uniform<T>". A uniform buffer is read-only, so there is no writable form of it to ask for.` |
| an access word outside `"read"` and `"read_write"` | `TS8002`. `storage<T, Access> Access is "read" or "read_write"; got "write". A storage BUFFER has no write-only mode; that is a storage texture's, texture_storage_2d<Format, "write">.` Collected as `read_write` (§1); TS2344 in the editor |
| a second type argument on a `uniform<T>` | `TS8002`. `uniform<T> takes one type argument. A uniform buffer is read-only, so it has no access mode to write.` TS2314 in the editor |
| the retired `{ access }` option on the call form | `TS8099`, naming the type-argument spelling to write (§1). Reported and ignored: the mode comes from the type argument |
| assign to a read resource: a `uniform<T>`, or a `storage<T>` with no `"read_write"` | `TS8005`, whose sentence names the `storage<T, "read_write">` line to write when the target is a storage binding, the compiler READ its declared type (a recovered type names no line: the line would drop what it could not read) and the target is a place on some mode (`md[0]` on an `f64` matrix, `src.length`, an emulated-double lane `dv[0].x` and a multi-component swizzle `v.xy` are each the same refusal on either mode, and name no line). TS2542 on an index and TS2540 on a field in the editor, before `compile()` is called (§1) |
| two resources share `@binding` | name both |
| builtin parameter on an incompatible stage | stage mismatch |
| `@compute` method on a class | entries are top-level functions |
| a function that reaches itself, directly or through other functions | `TS8031` on the call that closes the cycle, naming the whole cycle |
| `.length` or `arrayLength(x)` on an `array<T>` with no `N` that is not in storage | `TS8032`. A `storage` array reads the bound buffer's length as `arrayLength(&x)` (§20); for a local, a parameter or a `uniform<array<T>>` the fix is an explicit size, `array<f32, 3>` |
| A module variable declared or used where its address space forbids | `TS8033`. A `let` with neither type nor initializer, a resource type without `declare` (`"dst" is a storage binding the host provides, and needs declare: write "declare const dst: storage<array<f32>, "read_write">".` — the mode is the one the `let` asked for, and a resource with no type argument names the shape `storage<...>`), a `const` with a wrapper, a `workgroup` initializer, a type the space cannot hold, an initializer that is not a constant, or workgroup memory read from a vertex or fragment entry (§24) |
| A barrier where one cannot stand | `TS8034`. `workgroupBarrier()` or `storageBarrier()` in a vertex or fragment entry, or used as a value (§25). One under a branch the invocations may not share is `TS8052` (§54) |
| A class member the surface does not take, or a method call the class rules refuse | `TS8035`. A static field that holds a function, a decorator on a method, `this` outside a method, a method called on the class or a static function on a value, a member the class does not have, a member a class that extends declares as another kind than its base, `super.f` on a field that holds a function, a method that changes its object called on a `const` whose value something else may hold, a parameter or a dropped value, one that returns nothing used as a value, a `private`, `protected` or `#x` member named where TypeScript does not allow it, or a changing call on the copy a `return this` method hands back inside an expression (§26) |
| A call that writes in a `while` condition, anywhere but as one side of its comparison | `TS8006`. The condition runs on every iteration, so the call cannot move ahead of the loop to run in source order; compare the call alone, or call it into a `let` at the end of the body (§26, Rule 7.9) |
| A name the file does not declare: a value, a callee, a type, a field, a member, an assignment target, an attribute, a `@builtin` id, an `enable` extension, an import | `TS8022`, `TS8004`, `TS8002` and the rest, on the name, with the remedy in one order (Rule 12.1): TypeShade's spelling of a GLSL or HLSL name (`lerp` is `mix`), else the name of the same kind it is spelled like (`Did you mean "clamp"?`), else the declaration it needs |
| A math builtin called with arguments its signature does not take | `TS8036`. Two shapes that had to agree (`dot(vec3, vec2)`, `clamp(v, 0., 1.)` on a vector), an element kind the builtin has no form for (`sin` on an integer vector), a scalar where a vector is due (`normalize(s)`, `cross` on a `vec2`), `mix`'s factor, `refract`'s eta, `ldexp`'s exponent or a bit offset of the wrong shape, or `transpose` on a non-matrix; the fix is named (§10) |

---

## 8. Example

Compiles today. `@align(16)` on `view` is part of the frozen grammar (§2) but the compiler
rejects it (`TS8010`, "`@align` on a field is not applied"), so it is left out here.

```ts
"use typeshade";

class Camera {
  view: mat4;
  pos: vec3;
}

declare const camera: uniform<Camera>;
declare const pixels: storage<array<f32>, "read_write">;

@compute([64, 1, 1])
export function paint(
  @builtin("global_invocation_id") gid: vec3u
) {
  const i = gid.x;
  pixels[i] = pixels[i] + camera.pos.x;
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
v = vec3(0., 1., 0.);      // a name
v.x = 0.;                  // a component
v.x += 1.;                 // and the compound and ++ / -- forms
o.pos = vec4(p, 0., 1.);   // a field
o.pos.x = 2.;              // a component of a field
ps[i].a = 1.;              // a field of an element
pixels[i] = 1.;            // an element
```

| Root | Writable? |
|------|-----------|
| `let` local | yes |
| `declare const x: storage<T, "read_write">` | yes |
| `const` local | no: `TS8005` |
| `declare const x: uniform<T>` / `storage<T>` | no: `TS8005` |
| a function parameter | no: `TS8018` |
| anything that is not a name (`vec3(0.).x`) | no: `TS8018` |

The parameter row covers writing **through** a parameter (`p.x = 1.`, `p.xs[i] = 1.`) and
writing it **whole** (`p = 1.`, `p += 1.`, `p++`) alike. The whole write used to be accepted and
emitted as `p = 1.0;`, which Tint refuses; it is `TS8018` now, naming the local to copy it into
(§52).

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
v = v + vec3(1., 1., 1.);   // instead of v++ on a vec3
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
| `ldexp(x, e)` | `x · 2ᵉ`; `e` is an `i32`, or an integer vector of `x`'s shape. A bare literal `e` is an `i32`. GLSL ES 3.00 has no `ldexp`, so it is `x * intBitsToFloat(((e >> 1) + 127) << 23) * intBitsToFloat(((e - (e >> 1)) + 127) << 23)` there, the scale built in two halves so that every legal exponent, -149 to 128, agrees with WGSL (§38) |
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
a program that resolves to one today must keep resolving to it. That precedence is a function
of the module's: a name a body declares, a local function (§14) or a parameter that takes a
function, wins over every builtin, as TypeScript's lookup finds it first. `step(i)` on a parameter
`step` calls the function the call handed over, and a local `const mix = …` is the one `mix(…)`
calls, where both reached WGSL's builtin before.

`discard` kills the fragment:

```ts
"use typeshade";

class Color {
  @location(0) color: vec4;
}

@fragment
export function fs(@builtin("position") p: vec4): Color {
  if (p.x > 0.5) {
    discard;
  }
  return { color: vec4(1., 0., 0., 1.) };
}
```

It is allowed in a fragment entry, and in a helper as long as no `@vertex` or `@compute`
entry can reach it: the check closes over the call graph, so `discard` inside a helper a
vertex entry calls is rejected too, naming the helper and the entry. The three screen-space
derivatives (`fwidth`, `dpdx`, `dpdy`) are fragment-only by the same rule. `discard()` is refused
with the remedy: `discard` is a statement, written without the parentheses.

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
vec3(a, b, c);        // compose: three f32
vec3(0.5);            // splat
vec4(v3, 1.);         // compose from a vec3 and a scalar
vec4(v2, v2);         // compose from two vec2
vec3f(v);             // convert: v is a vec3u, every component becomes an f32
vec3u(v);             // convert the other way
vec2(gid.xy);         // convert a vec2<u32> swizzle to vec2<f32>
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
"use typeshade";

const PI2: f32 = 6.28318; // scalar, as before
const UP = vec3(0., 1., 0.); // → const UP: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);
const SKY: vec4 = vec4(0.4, 0.6, 0.9, 1.);
const XS: array<f32, 3> = array<f32, 3>(1., 2., 3.);
const PAL = array<vec4, 2>(vec4(1., 0., 0., 1.), vec4(0., 1., 0., 1.));
const K: f32 = 2.;
const V = vec3(K, K, K); // an earlier const is a valid component

export function pick(i: i32): vec4 {
  return PAL[i] * K + vec4(UP, PI2) + vec4(V, XS[0]) + SKY;
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

A struct-valued constant is accepted as the next paragraph says, and a matrix-valued one with
§40's constructors: `const M: mat2 = mat2(vec2(1., 0.), vec2(0., 1.))` emits
`const M: mat2x2<f32> = mat2x2<f32>(…);`.

---

A module const of a struct type takes the struct its annotation names, the way a `const p: P =
{ ... }` inside a function already did (§16). That is what lets two structs of one shape be told
apart at module scope, where the field names alone cannot answer:

```ts
const ORIGIN: P = { x: 0., y: 1. }; // → const ORIGIN: P = P(0.0, 1.0);
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
"use typeshade";

const N: u32 = 16; // the declared type — on the IR; see the note below

class Id {
  id: u32;
}

export function g(a: i32): i32 {
  return a;
}

export function positions(i: i32, c: bool, xs: array<f32, 4>): u32 {
  let j: i32 = -1; // the declared type, sign and all
  let x: u32 = N; // the assignment target's type…
  x = 2; // …here
  const s: Id = { id: 0 }; // the struct field's type
  const v = vec3u(1, 2, 3); // the constructor's element type
  const t: u32 = c ? 1 : 2; // through both arms, from the position around it
  let acc = 0.;
  for (let k = 0; k < 4; k++) {
    // i32, the type an induction variable must have
    acc += xs[0]; // an index is an i32
  }
  return u32(g(1) + j) + x + s.id + v.x + t + u32(acc) + u32(min(i, 4));
  //         ^ the parameter's type              ^ the kind of the call's other arguments
}

export function ret(): u32 {
  return 0; // the declared return type
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
  is not retyped, and is reported at the literal as TS8003 *The value has to fit: -1 is outside
  u32, which holds 0 to 4294967295 (§13).* The same sentence covers every declared position
  above: a declaration, an assignment, a `for` init, a return, an argument, a struct field, a
  vector constructor's element and a conditional's arm. An array element keeps §18's element
  message, and a module `const` its own range message.
- **A written number in a builtin call's FIRST argument takes an integer peer's kind (#57).**
  An intrinsic's result type is its first argument's, and until roadmap 0.2 item 9 that position
  was never retargeted, so `min(1, i)` with an `i32` `i` typed the call `f32` and emitted
  `min(1.0, i)`, which WGSL does not accept. Now the first argument that is not a written number
  decides: `min(1, i)` is an `i32` call and `clamp(0, i, 10)` a `u32` one for a `u32` `i`, as
  `min(i, 4)` already was. A float peer changes nothing, and a builtin with no integer form
  (`pow(2, i)`) keeps its `f32` first argument, so the argument check (TS8036) names `i` as the
  odd one out.

`const N: u32 = 16` emits `const N: u32 = 16u;`. That was not true when this section was
written — the backend spelled every scalar constant with a float literal, so the line read
`const N: u32 = 16.0;`, which is the half issues #13 and #17 were about — and it has been true
since they landed.

**A window is open on the default (#148; the policy it follows is roadmap item 25, the
deprecation-policy row, and `RELEASING.md` §7).** Everything above is
about a position that DECLARES a type. Where nothing declares one — `let i = 0`, `const K = 5`
— the literal still takes `f32`, so `xs[i]` is `Index must be i32 or u32`. WGSL concretizes an
abstract integer to `i32` when nothing else decides (wgsl.txt:3929-3933, 4100-4104), GLSL's `5`
is an `int`, and a TypeScript reader expects `let i = 0` to index an array — so that default
will change. It has NOT changed yet: this release carries the window, not the flip. A build
that wants to see which of its lines the flip will move asks for the warning, which is off by
default and moves no emitted byte:

```ts
compile(source, { deprecations: true });
// TS8053 (warning): "i" is written as an integer and types as f32 today; it will type as i32
// (§13, #148). Write "i = 0." to keep f32, or leave it and take i32.
```

`RELEASING.md` §7 is the policy the window follows and the list of the windows that are open.

## 14. TypeScript shapes the parser already had

Four ordinary TypeScript shapes that the grammar admits and the language now lowers (one of
them, the object-literal shorthand, is an expression rather than a statement).
None of them is a new operation: `Stmt.var.init` has always been optional, `assignOp` has
always taken any `BinOp`, `construct` does not record how a field was spelled, and `switch`
was already lowered; only the source language refused them.

```ts
"use typeshade";

const PALETTE_WARM = 1.;

export function band(seed: i32, t: f32): vec3 {
  let bits: i32 = seed;
  bits <<= 1;
  bits &= 3;
  bits |= 0;
  bits ^= 0;
  bits >>= 0;

  let rgb: vec3;
  rgb = vec3(0., 0., 0.);
  switch (bits) {
    case 0:
      rgb = vec3(0.1, 0.1, 0.12);
      break;
    case 1: {
      if (t > 0.5) {
        rgb = vec3(PALETTE_WARM, 0.55, 0.2);
        break;
      }
      rgb = vec3(0.5, 0.3, 0.1);
      break;
    }
    default:
      rgb = vec3(0.85, 0.85, 0.9);
  }
  return rgb;
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
the backend. Two labels on one body (`case 0: case 1:`) are one clause with two selectors
(§52), and `continue` in a `switch` that no loop encloses is refused.

**A case body must not fall through.** The IR switch has no fall-through and neither does
WGSL's, so a body whose end is reachable cannot mean here what it means in TypeScript, which
carries on into the next case. It is refused at its label, `TS8017`:

```
switch case 2 falls through into the next case: TypeScript runs both bodies, and WGSL runs
only this one. End it with "break", or repeat the shared statements in each case.
```

`case 2: { if (c) { …; break } x = … }` is refused this way, since the `if` leaves on one path
only; so is a `default:` above a case, and a `case` whose only `break` is inside a loop,
which leaves the loop. Whether the end is reachable is TypeScript's own reachability, the one
`tsc` applies with `noFallthroughCasesInSwitch`. The last clause needs no `break`, and neither
does a clause that runs on only into empty clauses at the end of the switch, since TypeScript
runs nothing more there either. An author porting from WGSL, whose cases need no `break`,
writes one per case (§52, #202).

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
const K = 3. as const;
const half = 0.5 as f32;
const v = <vec2>vec2(1., 2.);
const p = { x: 1., y: 2. } satisfies P;
const x = u!.x;
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
const { x, y: b } = uv;          // let x = uv.x;  let b = uv.y;
const { xy } = uv;               // let xy = uv.xy;
const { a, k } = u;              // let a = u.a;   let k = u.k;
const { i: { a } } = u;          // let a = u.i.a;
let { x } = uv;                  // var x: f32 = uv.x;
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
  const f = (x: f32): f32 => x * 2.;      // fn fs_f(x: f32) -> f32
  return vec4(f(3.), 0., 0., 1.);         // fs_f(3.0)
}
```

The name is what lets two bodies each declare an `f`, and the body still writes `f(x)`. A local
function may declare one of its own (`fs_outer_inner`), and one written at the module top level
is a module function already, under its own name; inside a `namespace` it takes the flattened
one, `N_twice`.

**A local function reads and writes the variables around it**, as a TypeScript closure does
(Rule 8.17). Neither target has an environment to carry them in, and none is needed: a function
is no value here, so every call of a local function is written where the variables it reads are
in scope. Each variable it reads from a function around it is a parameter the emitted function
takes ahead of its own, and every call passes it. One it writes, or that a local function it
calls writes, is passed by reference, a pointer in WGSL and an `inout` parameter in GLSL ES
3.00, so the write lands in the variable itself and the next call sees it:

```ts
"use typeshade";

export function accumulate(k: f32): f32 {
  let total = 0.;
  const add = (v: f32): void => {     // fn accumulate_add(total: ptr<function, f32>, k: f32, v: f32)
    total += v * k;                   //   (*total) += (v * k);
  };
  add(1.);                            // accumulate_add(&total, k, 1.0);
  add(2.);
  return total;                       // 1.5 for k = 0.5
}

class Meter {
  level: f32 = 0.;
  gain: f32 = 2.;
  feed(xs: array<f32, 3>): f32 {
    // `this` in an arrow function is the method's object; `push` writes it, so `feed` takes it
    // by reference (Rule 8.10) and hands it on: Meter_feed_push(self_, xs[0]).
    const push = (x: f32): void => {
      this.level += x * this.gain;
    };
    push(xs[0]);
    push(xs[1]);
    push(xs[2]);
    return this.level;
  }
}

export function hoisted(x: f32): f32 {
  let steps = 0.;
  bump();                             // a function declaration is hoisted, as TypeScript's is
  bump();
  return steps * x;
  function bump(): void {
    steps += 1.;
  }
}

@fragment
export function fs(): vec4 {
  let m = new Meter();
  return vec4(accumulate(0.5), m.feed(array<f32, 3>(1., 2., 3.)), hoisted(2.), 1.);
}
```

A variable is read when the call runs, not when the function is declared, so a write between
the two is seen. A write through a capture follows the variable's own declaration: a `let` may be
written, a `const` only through the object it built (Rule 6.10), and a parameter not at all, as in
the body around it. A function named as a fold's callback (`any(xs, near)`, `zip(xs, ys, f)`)
passes what it captures to every call the fold makes. A local function inside a generic function
is made once per instance, `pick_f32_swap`.

Refused, each with the reason: a call at a point where a variable the function reads is not
declared yet, since TypeScript throws there (`"f" reads "y", which is not declared yet where
"f" is called`); and a function named as a value rather than called (`const g = f`, `return f`),
since nothing at run time can hold a function.

Two shapes of the declaration itself are refused too: a `let`, which would let the name point at
another function, and a type written on the const rather than on the function itself. A return
type it leaves off, its body says, as for any function (below).

### A function that takes a function

A parameter whose type is a function type, written out or through a type alias, takes a function
(Rule 8.18). Neither target has a function value to take, and none is needed: every call names
the function it hands over, so the function is compiled once for each function its calls hand
it, as a generic function is once for each set of type arguments. In each copy a call of the
parameter calls the function handed over:

```ts
"use typeshade";

type Op = (a: f32, b: f32) => f32;

function fold3(op: Op, a: f32, b: f32, c: f32): f32 {
  return op(op(a, b), c);
}

function times(body: (i: i32) => void): void {
  for (let i = 0; i < 4; i++) {
    body(i);
  }
}

function mul(a: f32, b: f32): f32 {
  return a * b;
}

export function shade(k: f32): f32 {
  let total = 0.;
  times((i) => {                            // fn shade_body(total: ptr<function, f32>, k: f32, i: i32)
    total += f32(i) * k;                    // times_shade_body(&total, k);
  });
  const xs = array<f32, 3>(1., 2., 3.);
  const big = any(xs, (x) => x > k);        // shade_any(k, xs[0]) || …
  return fold3(mul, 2., 3., 4.) +           // fold3_mul(2.0, 3.0, 4.0)
    fold3((a, b) => a + b * k, 1., 2., 3.) + // fold3_shade_op(k, 1.0, 2.0, 3.0)
    total + (big ? 1. : 0.);
}

@fragment
export function fs(): vec4 {
  return vec4(shade(0.5), 0., 0., 1.);
}
```

A call hands a function over by its name, a local one included, or as an arrow function or a
function expression written in the call. One written in the call is a local function of the body
the call is in, so it reads and writes that body's variables as §14's local functions do, and the
copy takes what it captures and passes it on: `total` above is written through a pointer from
`shade_body`, by way of `times_shade_body`. It takes its parameters' types from the parameter's
type, and its return type too, where it writes none; it may leave parameters off at the end, as
TypeScript allows; and when the type returns `void`, an expression body runs as a statement, so
`times(() => n += k)` adds. Inside the function that takes it, a parameter of function type is
called, or handed on to another such parameter (`twice(f)` calling `apply(f, x)` makes
`apply_…` for whatever `f` was).

The folds take the same arguments: `any(xs, pred)`, `all`, `none` and `zip(xs, ys, f)` accept an
arrow function, typed by the arrays, and one `zip` is handed returns what its body does. So do an
array's own methods, `xs.map(f)`, `xs.forEach(f)`, `xs.some(p)`, `xs.every(p)` and
`xs.reduce(f, init)`, each a counted loop the call runs (§63).

A local function takes a function the same way, and so do a method, a static method, a
constructor and a field that holds a function (§26): `const twice = (f: (x: f32) => f32, x: f32)
=> f(f(x))` in `run`, handed `(x) => x * k`, is `run_twice_run_f(k, x)`. A copy takes what its
own body captures and what the functions handed over capture, and a variable both reach once:
a local function that writes `total` and is handed an arrow function that writes it too takes
one `total`, by reference.

Refused, each with the reason: a function that does not fit the parameter's type (`"add" takes 2
argument(s), and "(x: f32) => f32" passes 1`); an argument that would choose a function at run
time (`c ? sq : cube`); a builtin or a generic function by its name, for which an arrow function
that calls it is the fix; a parameter of function type on a setter, whose value an assignment
gives it, or on an entry point, whose parameters the pipeline supplies; a function type anywhere
else, a return, a field, a variable; and a function that hands itself a function it builds anew
on every call, whose copies would never end.

### A return type left off is the body's to say

A function that writes no return type returns what its body does, as TypeScript infers it (Rule
8.19): a function of the file or of a namespace, a local function, a generic function's instance,
a method, a getter and a field that holds a function all take the type of their first `return`
with a value, and one with none returns nothing. The `return`s after the first are typed against
it as against a written type, so `return 0` after `return u32(7)` is a `u32`. A call that needs
the type before the body's turn lowers that body first, so a function may be called above its
declaration:

```ts
"use typeshade";

class Rng {
  seed: u32 = u32(1);
  next() {
    this.seed = this.seed * u32(1664525) + u32(1013904223);
    return f32(this.seed >> u32(8)) / 16777216.;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let rng = new Rng();
  const jitter = (k: f32) => (rng.next() - 0.5) * k;
  return vec4(glow(uv) + jitter(0.1), 0., 0., 1.);
}

function glow(p: vec2) {
  return 0.1 / length(p);
}
```

```wgsl
fn Rng_next(self_: ptr<function, Rng>) -> f32 { … }
fn glow(p: vec2<f32>) -> f32 { … }
fn fs_jitter(rng: ptr<function, Rng>, k: f32) -> f32 { … }
```

An arrow function whose body is an expression returns its value, but an assignment, `++`, `--`
or a call of a function that returns nothing runs as a statement and the function returns
nothing: `const inc = () => n += k` adds, where TypeScript would also return the new `n` (Rule
7.2). A method whose every `return` is `return this` returns its object, so a chain goes on from
it (§26). `return g()`, where `g` returns nothing, calls `g` and returns nothing, in any function.

TypeScript types an operator on a vector as `number`, so on its own it would type a function
whose return is `v * 2.` a `number` and underline a caller that reads `.x` off it. The language
service writes the type the compiler infers into the text TypeScript reads, as it does for a
`const` that holds such a product (`docs/language-service-api.md`,
[#162](https://github.com/typeshade/typeshade/issues/162)): `: vec2` after the parameter list of
a function, a method, a getter or an arrow function that writes no return type, handed to a call
or not, so the editor completes `glow(uv).` and reports nothing. Plain `tsc` has no service in
front of it and still types the function `number`; there the return type, written, is the fix. A
return of a call, a constructor or a field keeps its type either way.

Refused, each with the reason: a function whose type waits on itself, which is a call cycle and
refused as one (§4); `return`s of two types (`Function "f" returns f32 at its first "return" and
vec2<f32> at another`); a bare `return` beside one with a value; a default parameter value that
calls such a function, since every default is lowered before any body; and a setter's value with
no type and no getter, or beside a getter that returns nothing, since nothing says what it takes.
A setter's value that writes no type beside a getter takes what the getter returns, written or
said by its body (§26). An entry point writes its return type, which is its output (§3).

### Triple-slash directives

`/// <reference path="..." />` and `/// <reference types="..." />` are comments to the parser, so
they always worked, above the `"use typeshade"` directive and below it. They are pinned by a
test now so they keep working.

### An overload signature is skipped, and the implementation is lowered

TypeScript writes a function's overloads as body-less declarations above the one that has a
body (roadmap 0.3 item T6, [#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
export function lum(c: vec3): f32;
export function lum(c: vec3): f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
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
"use typeshade";

declare const tex: texture_2d<f32>;
declare const atlas: texture_2d_array<f32>;
declare const smp: sampler;
const tint: override<f32> = 0.85;
declare const bias: override<f32>;

class Color {
  @location(0) color: vec4;
}

@fragment
export function fs(@location(0) uv: vec2): Color {
  const a = textureSample(tex, smp, uv);
  const b = textureSample(atlas, smp, uv, 1);
  const c = textureSampleLevel(tex, smp, uv, 0.);
  const d = textureLoad(tex, vec2i(0, 0), 0);
  const size = textureDimensions(tex);
  const layers = textureNumLayers(atlas);
  const k = tint + bias + f32(size.x) + f32(layers);
  return { color: (a + b + c + d) * k };
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
rather than the `0.0` that no backend accepts. That is where a bare number lands; a layer or a
level written as a variable may be either integer type (§42).

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

**A function you declare with one of these names keeps winning the call**, as §10 states for
every builtin name: `textureSample`, `textureSampleLevel`, `textureLoad`, `textureDimensions`
and `textureNumLayers` declared in the file are the author's functions, emitted under the name
written.

The multisampled texture is §37 and the storage texture §33.

## 16. Object literals take the declared struct

Which struct `{ … }` builds comes from the type the position **declares**: a function's
return type, a `let`/`const` annotation, or a parameter type.

```ts
"use typeshade";

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class FsIn {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

export function shade(o: FsIn): f32 {
  return o.uv.x;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  const p = vec2(0., 0.);
  return { pos: vec4(p, 0., 1.), uv: p }; // the return type says VsOut
}

export function pick(): f32 {
  const a: FsIn = { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) }; // the annotation says FsIn
  return shade(a) + shade({ pos: a.pos, uv: a.uv }); // the parameter says FsIn
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
const q: P = { ...p, y: 9. };     // P(p.x, 9.0)
const q: P = { y: 9., ...p };     // P(p.x, p.y)
const q: Inner = { ...o.i, b: 9. }; // Inner(o.i.a, 9.0)
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

A `for` must be **counted**: an integer induction variable, a constant step, and an exit that
compares the variable to a bound the body does not write (Rule 7.5). The start and the bound
may be runtime values, and a trip count has no ceiling: #203 removed the 256-trip limit and the
constant bound, and made `while` an open loop. The first part of this section says what that
means; the rest is the counted loop's older detail, which still holds.

**A bound may be a value the program learns at run time.** A count from a uniform, an array's
length, a parameter, an `override`: any integer expression the body does not write.

```ts
"use typeshade";

declare const verts: storage<array<vec3f>>;
declare const hits: storage<array<u32>, "read_write">;

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  let count: u32 = 0;
  for (let t = 0; t < verts.length / 3; t++) {
    if (verts[t * 3].y > f32(gid.x)) {
      count += 1;
    }
  }
  hits[gid.x] = count;
}
```

The counter needs no annotation. `verts.length` is a `u32`, and an unannotated counter whose
start is a non-negative integer literal takes the type of a `u32` bound, so `t` is a `u32` here.
Otherwise it is an `i32`, as it always was: with an annotation, a negative or computed start, or
an `i32` bound. Before this, the loop above was `TS8003 cannot compare i32 and u32`, about a type
the author never wrote.

The start may be a runtime value too, which is how a kernel strides over data:
`for (let i: u32 = lid; i < params.count; i += 64)`. Both targets accept the loop as written;
#203 measured `for (…; i < arrayLength(&data); …)` and a uniform-bounded `for` and `while` on
Tint and on ANGLE.

The step is still a constant, so the compiler still knows which way the counter moves, and
refuses the header that moves it away from its bound:

| Header | Answer |
| --- | --- |
| `let i: i32 = 0; i < n; i -= 1` | `TS8007 for step "i -= 1" moves "i" away from a bound it compares with <, so the loop does not exit once it starts.` |
| `let i: i32 = 0; i < n; i *= 2` | `TS8007 for step "i *= 2" never advances "i": multiplying pins it at 0.` |
| `let i: i32 = 0; i !== n; i += 2` | `TS8006`: against a runtime bound, `!=` exits only if the step lands on it exactly, so the remedy is `<`. |
| `let i: i32 = 1; i < n; i *= -2` | `TS8006`: with a runtime bound, a factor has to be a whole number of 2 or more, or its direction is unknown. |
| a body that writes `n` | `TS8006 for bound reads "n", which the loop body writes, so it does not bound the loop.` Read it into a `const` first, or write a `while`. |

What is not checked, because the value is not known before the loop runs: that the counter
reaches a runtime bound before it leaves its type. `i <= n` with `n` at the type's maximum never
fails, and `i += 4` wraps past a bound within 4 of it. All three engines run such a loop the same
way; Appendix B of the language design records it.

**No trip count is too many.** `for (let i: i32 = 0; i < 100000; i++)` compiles; it was
`for trip count 100000 exceeds 256.` Neither target limits a trip count, and nothing downstream
read the ceiling but the check itself, which is why #203 removed it. A constant header is still
counted exactly, and a count that leaves its type or never ends is still refused, as below.

**A `while` is an open loop.** It ends when its condition fails, or at a `break` or a `return`,
and its condition may be anything of type `bool`: `while (sp > 0)` over a stack, which is how a
BVH is traversed, or `while (true)` with a `break` once an iteration has converged. The one
`while` refused is the one that certainly never ends, a constant `true` with nothing in its body
that leaves it:
`TS8007 while (true) has no break or return in its body, so it never ends.` A `break` inside a
nested loop or a `switch` leaves that statement, not this loop, and is not counted as a way out.
A `for` with no condition says to write this form: `for (;;)` is refused and points at
`while (true) { … }`.

The compiler does not check that a `while` body moves toward its exit. An open loop is the
author's to end, as it is in WGSL, and one that spins on a GPU is ended by the device's watchdog,
which loses the device. `examples/loops-over-data.shade.ts` holds all three loops, a
uniform-bounded `for`, a stack walk and a converging `while (true)`, and the compile gate runs it
on Tint and on WebGL2.

**`for (const x of xs)` iterates an array.** It is the other loop a TypeScript author writes
over data, and it was `TS8013 for-of / for-in iterate JS objects`. Over an `array<T, N>` or a
runtime-sized storage array it is a counted loop over the indices: the trip count is the array's
length, which the body cannot change, so there is nothing left to check.

```ts
"use typeshade";

class Light {
  pos: vec3;
  power: f32;
}
class Scene {
  lights: array<Light, 4>;
}
declare const scene: uniform<Scene>;

export function lit(p: vec3): f32 {
  let s = 0.;
  for (const l of scene.lights) {
    s += l.power / (1. + distance(p, l.pos));
  }
  return s;
}
```

It lowers to `for (var _i: u32 = 0u; _i < 4u; _i = _i + 1u) { let l = scene.lights[_i]; … }`,
with `arrayLength(&xs)` as the bound of a runtime-sized array. The element is read at the top
of each trip, as TypeScript's array iterator reads it, and `for (let x of xs)` gives a copy the
body may change without writing the array. `break` and `continue` do what they do in any loop.

Three shapes are refused. A vector is not an array (`TS8003`): index it, or write it into an
`array<T, N>`. The array has to be a name, or a member or index path to one (`TS8006`), because
it is read on every trip: `const xs = make(); for (const x of xs)`. And `for…in` stays `TS8013`,
since a shader value has no keys to enumerate. In the editor the ambient `array` and list types
are iterable, so the loop type-checks there too.

**Before #203**, three things about the counted loop changed, and they still hold.

**The step may scale, not only add.** The four update forms are `+=`, `-=`, `*=` and `/=`:

```ts
"use typeshade";

export function shrink(): f32 {
  let a = 0.;
  for (let i: i32 = 64; i > 1; i /= 2) {
    a += 1.; // 64 32 16 8 4 2, six trips
  }
  for (let j: i32 = 1; j < 64; j *= 2) {
    a += 1.;
  }
  for (let k: i32 = 8; k > 0; k -= 2) {
    a += 1.;
  }
  return a;
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
| `for (let i: i32 = 0; i < 1024; i++)` | `for (i = 0; i < 1024; step 1) does not exit.` | `for trip count 1024 exceeds 256.`, and since #203 no error |
| `for (let i: i32 = 0; i < 16; i--)` | `for (i = 0; i < 16; step -1) does not exit.` | `for (i = 0; i < 16; i -= 1) does not exit.` |

The old counter walked the sequence and could only look 258 steps ahead, so a policy violation
(the ceiling #203 later removed) and a non-terminating loop shared one message. They are different mistakes and the fix for each
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

**What this does not cover.** The multiplicative step has no `fn()` EDSL spelling, so `ir-equality.test.ts` has
no twin to pin `i *= 2` against; the CPU trip count in `loop-shapes.test.ts` stands in for that
until `forRange` takes a step operation.

## 18. A list as an array's initializer

An `array<T, N>` takes a list where its type is written, in a function body and at module
scope:

```ts
"use typeshade";

export function ramp(i: i32): f32 {
  const stops: array<f32, 3> = [0., 0.5, 1.];
  const weights: array<i32, 3> = [1, 2, 1];
  let scratch: array<f32, 2> = [0., 0.];
  scratch[0] = stops[i] * f32(weights[i]);
  return scratch[0];
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

The call form types its arguments by the same rule and the same check, so
`array<i32, 3>(1, 2, 3)` emits `array<i32, 3>(1, 2, 3)` (GLSL `int[3](1, 2, 3)`) and
`array<u32, 2>(1, 2)` emits `array<u32, 2>(1u, 2u)`, exactly what the list form emits, and
`array<u32, 2>(-1, 2)` is refused with the list's element message. `array(1, 2, 3)`, which
states no element type, infers `array<f32, 3>`: nothing declares an integer there, so §13 gives
each literal `f32`.


---

## 19. A call as a statement

A function may be called for what it does, with its result dropped. This is the shape every
side effect in a shader takes: a helper that writes a storage binding today, and the
`workgroupBarrier()`, `textureStore(...)` and `atomicAdd(...)` family that lands on the same
statement.

```ts
"use typeshade";
declare const dst: storage<array<f32>, "read_write">;

function store(i: u32): void {
  dst[i] = 1.;
}

@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  store(gid.x);
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
writes, itself or through the functions it calls, and a write through a method's object as the
caller's receiver (§26). Dead-code elimination keeps a `call` statement exactly when its call
has an effect, and a `let` nobody reads whose initializer writes becomes the call statement it
amounts to: `const unused = next()` still calls `next`. Common-subexpression elimination, value
numbering and loop-invariant motion leave a function that makes an effectful call alone, and
a read of a binding some callee writes is never shared across the call: two `bump(i)` in a
row stay two, and a `dst[i]` read after them is a second read; nor is a copy taken before a
method changes its object, `const before = p` ahead of `p.bump()`. A struct assembled field by
field is not folded into a constructor when a field's value writes, since the constructor would
evaluate the fields in declaration order rather than the order they were assigned. The linear
inliner does not lift a helper whose prelude holds a call statement, since splicing it ahead of
the `if` that guarded the call site would run the effect on a path that never called. Such a
call inside a larger expression is put in source order before any of this runs (§26, Rule 7.9).

**What this does not cover.** The portable compute tier (§ the `portable` kernel shape) refuses
a call statement anywhere in the entry's reach: its single store is a plain assignment written
in the entry, and a store hidden in a callee is not one the fragment-GPGPU lowering can follow.

---

## 20. The length of a runtime-sized storage array

A `storage<array<T>>` has no size in its type; its length is the length of the buffer the
host binds. `xs.length` on such an array reads it at run time, and `arrayLength(xs)` spells
the same read explicitly. Both are a `u32`, as the WGSL builtin is.

```ts
"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

@compute([64, 1, 1])
export function scale_all(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= src.length) {
    return;
  }
  dst[gid.x] = src[gid.x] * 2.;
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

**A loop over such an array is written `for (…; i < src.length; …)`** since #203: §17 takes a
runtime bound, and the length reaches the header as `arrayLength(&src)`. When this section was
written §17 wanted a constant bound, and the remedy was to guard the invocation with `if` and
index by `gid.x`, as the example still does.

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
"use typeshade";

@fragment
export function fs(): vec4 {
  let a = 0.;
  for (let i: u32 = 0; i < 4; i++) {
    a = a + f32(i);
  }
  for (let i: u32 = 0; i < 3; i++) {
    a = a + f32(i) * 2.;
  }
  return vec4(a, 0., 0., 1.);
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
"use typeshade";
const K: f32 = 4.;

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let bits: u32 = u32(uv.x * 255.) >> 4;
  bits <<= 2;
  let x: f32 = uv.y / K;
  x %= 0.5;
  return vec4(f32(bits) / 255., x, 0., 1.);
}
```

---

## 23. Atomics

Many invocations write one location at once in a histogram, a counter, a reduction. A plain
`bins[i] = bins[i] + 1` loses counts, because two invocations read the same old value. WGSL's
answer is the atomic type and its builtins, and this surface carries them (roadmap 0.2 item 4).

**The type.** `atomic<u32>` and `atomic<i32>` are locations in storage memory, never values. They
are declared inside a `storage<...>` binding whose access mode is `"read_write"`: an array of them,
a field of a storage struct, or a bare binding.

```ts
"use typeshade";
class Summary {
  count: atomic<u32>;
  maxBin: atomic<i32>;
}
declare const src: storage<array<f32>>;
declare const bins: storage<array<atomic<u32>>, "read_write">;
declare const summary: storage<Summary, "read_write">;

@compute([64, 1, 1])
export function histogram(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(src)) {
    return;
  }
  const bin = u32(clamp(src[gid.x], 0., 0.999) * 8.);
  atomicAdd(bins[bin], 1);
  const before = atomicAdd(summary.count, 1);
  atomicMax(summary.maxBin, i32(bin));
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
binding whose type does not say `"read_write"` is TS8005 naming the line to write. A value of
another type (`atomicAdd(bins[i], 1.5)`) is TS8003, a location that is not atomic is TS8003, the
wrong number of arguments is TS8019. An atomic declared as a local, a parameter or a return
type, or inside a `uniform<...>`, is TS8099 with where it may live; `atomic<f32>` is TS8002.

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

**Spelling.** A top-level `let` is a module variable. Plain, it is the per-invocation one, and
that is its only spelling: `let seed: u32 = 7` is what a module-level `let` means to a TypeScript
reader, a value this run of the program owns, and in a shader the run is the invocation.
Workgroup memory has no TypeScript counterpart, so it is always written out, as a wrapper type on
the annotation the way a resource is a `declare const` with `uniform<T>` or `storage<T>`:
`let tile: workgroup<array<f32, 64>>`. No `declare`: `declare` stays the mark of a value the host
provides, and a module variable is the module's own.

```ts
"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;

let tile: workgroup<array<f32, 64>>;
let seed: u32 = 7;

function next(): u32 {
  seed = seed * 1664525 + 1013904223;
  return seed;
}

@compute([64, 1, 1])
export function k(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  tile[lid.x] = src[gid.x];
  dst[gid.x] = tile[lid.x] + f32(next() >> 24);
}
```

- A plain `let seed: u32 = 7` emits `var<private> seed: u32 = 7u;`. The initializer is
  optional and a constant expression by §12's measure (a literal, a module const, arithmetic or
  a math builtin over those; a list for an array, an object literal for a struct); without one
  the variable is zero. Without an annotation the type is the initializer's, by the rule a
  `const` follows: `let v = 1.5` and `let n = 7` are both f32, and `let n: u32 = 7` is the
  integer. Any stage may use it. The space itself is never written out, and WGSL's own name for
  it could not be written anyway: `private` is a word TypeScript reserves in strict mode, and
  every module is strict.
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
its `declare`), a non-constant initializer, an initializer of another type, and a type the
space cannot hold are TS8033 with the fix. A `const` with a wrapper type is TS8033: a `const` is
a module constant (§12). A repeated name, or a name a const or a binding already has, is
TS8023. A top-level `var` stays TS8014. `perInvocation<T>`, a wrapper this section once offered
as a second way to write the per-invocation variable, was removed: one variable with two
spellings is two things to learn and one of them redundant. Writing it is TS8033,
`perInvocation<T> was removed: a top-level let is already the per-invocation variable. Drop the
wrapper and write let seed: u32.`

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
"use typeshade";
declare const src: storage<array<f32>>;
declare const sums: storage<array<f32>, "read_write">;

let tile: workgroup<array<f32, 64>>;

@compute([64, 1, 1])
export function reduce(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
): void {
  tile[lid.x] = src[gid.x];
  workgroupBarrier();
  for (let stride: u32 = 32; stride > 0; stride /= 2) {
    if (lid.x < stride) {
      tile[lid.x] = tile[lid.x] + tile[lid.x + stride];
    }
    workgroupBarrier();
  }
  if (lid.x === 0) {
    sums[wid.x] = tile[0];
  }
}
```

**A barrier is a statement.** It takes no argument and has no value: `const x = workgroupBarrier()`
is TS8034. Both emit bare on WGSL, `workgroupBarrier();`, and never behind §19's phony
assignment. GLSL ES 3.00 has no compute stage, so a module with one emits WGSL alone.

**Where it stands.** WGSL requires a barrier in uniform control flow in the compute stage, and
this surface states the same two rules at the call: in a compute entry or a function it calls,
never in a vertex or fragment entry, which has no workgroup (TS8034); and never under a branch
on a value the invocations do not share, which is how a workgroup waits forever (TS8052). The
second rule used to refuse every `if` and `switch` body; it is the uniformity analysis of §54
now, so a branch on a uniform buffer value or on `workgroup_id` is accepted, and the `if` above,
on `local_invocation_id`, holds no barrier. A `for` whose bound every invocation shares (a constant, a
uniform, `workgroup_id`) is uniform and allowed; one bounded by `local_invocation_id` is not, and
a barrier in it is TS8052, which is the shape the reduction above needs: the loop steps by `/= 2`, one of §17's four counted steps. The optimizer
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
"use typeshade";
class Ray {
  origin: vec3;
  dir: vec3;
  hits: u32 = 0;
  constructor(origin: vec3, dir: vec3) {
    this.origin = origin;
    this.dir = normalize(dir);
  }
  at(t: f32): vec3 {
    return this.origin + this.dir * t;
  }
  static up(): vec3 {
    return vec3(0., 1., 0.);
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const r = new Ray(vec3(uv, 0.), vec3(0., 0., 2.));
  return vec4(r.at(1.) + Ray.up(), f32(r.hits));
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
  pos: vec2;
  vel: vec2;
  step(dt: f32): void {
    this.pos = this.pos + this.vel * dt;
  }
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ps[gid.x].step(0.5);
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

The receiver has to be a place a function may write: a `let` local, a `const` whose initializer
built its value (below), a module variable, a storage element, or `this` inside a constructor or
another changing method, or a field or an element of one of those. Which methods change their
object is read from their bodies, to a fixpoint over every class of the file at once: one that
assigns to a field of `this` (or `++`/`--` on one), one that calls such a method or reads such a
getter on `this` or on a field or an element of it, whatever class that field is, and one that
reaches such a body through `super`. The effect table (§19) counts a
write through a reference as it counts any other, and names it as the CALLER knows it:
`ps[gid.x].step(dt)` writes `ps`, because `step` writes its receiver and the receiver is reached
through `ps`.

**It may return a value** (Rule 8.10), as any method may. A random-number generator is the
shape: `next()` advances the state and returns the draw. The reference is what carries the object
back, so the return is free, and the emitted function is WGSL's own idiom for a generator,
`fn Rng_next(self_: ptr<function, Rng>) -> f32`, and GLSL ES 3.00's, `float Rng_next(inout Rng
self_)`. On its own line the value is dropped and the write kept; anywhere a value goes, it is
one.

```ts
"use typeshade";
class Rng {
  state: u32;
  next(): f32 {
    this.state = this.state * 747796405 + 2891336453;
    return f32(this.state >> 8) / 16777216.;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let rng: Rng = { state: u32(uv.x * 1000.) };
  const grain = vec2(rng.next(), rng.next());
  const spark = uv.y > 0.5 ? rng.next() : 0.;
  return vec4(grain, spark, 1.);
}
```

```wgsl
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var rng: Rng = Rng(u32((uv.x * 1000.0)));
  let _seq0 = Rng_next(&rng);
  let _seq1 = Rng_next(&rng);
  let grain = vec2<f32>(_seq0, _seq1);
  var _seq2: f32;
  if ((uv.y > 0.5)) {
    _seq2 = Rng_next(&rng);
  } else {
    _seq2 = 0.0;
  }
  let spark = _seq2;
  return vec4<f32>(grain, spark, 1.0);
}
```

**A call that writes runs in source order** (Rule 7.9). TypeScript evaluates `vec2(rng.next(),
rng.next())` left to right, and so does WGSL; GLSL ES 3.00 fixes that order for a call's
arguments and leaves it open for an operator's operands (§5.11). So a call that writes, inside a
larger expression, is bound to a `let` of its own ahead of the statement, in the order the source
evaluates it, and the statement reads the temporary: the two draws above are two lets, first to
last, on both targets. An operand evaluated before such a call that reads what the call changes
is bound ahead of it, so `rng.state + rng.next()` adds the state from before the draw. A call
TypeScript runs conditionally keeps its condition: an arm of `?:` is an `if` rather than WGSL's
`select`, which would evaluate both arms, and the right operand of `&&` or `||` is an `if` on the
left one. A call that is the whole of its statement (`const a = rng.next()`, the value of an
assignment or a `return`, a condition, a selector, a call statement) stays where it is. This is
the same for a helper that writes a storage binding or a module variable and for an atomic, which
could write from inside an expression before any of this (§19, §23, §24). A `while` condition
runs on every iteration, so nothing
in it can move ahead of the loop: a call that writes may be one side of its comparison,
`while (rng.next() < 0.9)`, and anything deeper is TS8006 with the remedy.
`examples/rng-method.shade.ts` is the gate's evidence, on Tint and on a real WebGL2 driver.

It returned nothing while the struct itself was what came back, and until this a method that
wrote `this` and returned a value was TS8035 at the write, "A method that changes its object
returns nothing (§26)".

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
local being built. Inside a static member it is the class the call names (Rule 8.13): the class
that declares the member, or one that inherits it (below), so `this.K`, `this.f()` and
`this.count += 1.` name its statics and `new this()` builds it; `this` as a value there, and
`this` in a top-level function, is TS8035.

**Access modifiers.** `public` is accepted and means nothing to the shader. `private` and
`protected` are enforced here (Rule 8.15, below), as `readonly` is (Rule 8.14) and a private name,
`#x`, is (Rule 8.12): the front end does not run the checker, and without these a program
TypeScript refuses would compile. They were accepted and meant nothing until this.

**Refused, with the fix (TS8035).** A static block (give each static field its value where it
is declared), a static field holding a function (a static method), a decorator on a method (an
entry is a top-level function), an `async` or generator method, two constructors or two
methods of one name (no overloads), a call of a method on the class or of a static function on
a value, a member the class does not have, a field called as a method and an accessor called as
one, a member a class that extends declares as another kind than its base does, a method that
changes its object called on a `const` whose value something else may hold, a parameter or a
value that is dropped, one that returns nothing used as a value, and a parameter named `self_`.
A field holding an arrow function was on this list; it is the method it is written as now
(below). A write to
`this` in a base's body called through `super` was refused too, since that body read its object
only; it takes the object by reference now, as any method that writes it does (below). A class
with only static functions and no fields is a namespace of functions (below). `abstract` and
`extends` are a struct's base since roadmap item T5. A `new`
on anything but a class the file declares stays TS8013, and says which of the four reasons it
is.

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

A cycle through method calls is TS8031 at the call that closes it (below). It reached Tint until
then, as did a chain through a changing method, `v.setX(1.).setY(2.)`, until it compiled (below).

### Getters and setters

A `get` or a `set` accessor is a function of the module, one for each half: `get area()` is
`Rect_get_area(self_: Rect)`, and `set width(v)` is `Rect_set_width(self_, v)` (Rule 8.11). A
read `r.area` calls the getter; an assignment `r.width = 4.` calls the setter with the new value,
and a compound assignment, `++` and `--` read the old value through the getter and write the new
one through the setter. A setter that assigns a field changes its object, so it takes it by
reference, as a method that does (§26 above); so does a getter that fills a cache.

```ts
"use typeshade";
class Temperature {
  #celsius: f32 = 0.;
  get celsius(): f32 {
    return this.#celsius;
  }
  set celsius(v: f32) {
    this.#celsius = max(v, -273.15);
  }
  get fahrenheit(): f32 {
    return this.#celsius * 1.8 + 32.;
  }
  set fahrenheit(v) {
    this.celsius = (v - 32.) / 1.8;
  }
  static get boiling(): Temperature {
    let t = new Temperature();
    t.celsius = 100.;
    return t;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let t = new Temperature();
  t.fahrenheit = 212. * uv.x;
  t.celsius += 5.;
  return vec4(t.celsius / Temperature.boiling.celsius, t.fahrenheit / 212., 0., 1.);
}
```

```wgsl
fn Temperature_get_celsius(self_: Temperature) -> f32 {
  return self_.celsius;
}
fn Temperature_set_celsius(self_: ptr<function, Temperature>, v: f32) {
  (*self_).celsius = max(v, -273.15);
}
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var t: Temperature = Temperature_new();
  Temperature_set_fahrenheit(&t, (212.0 * uv.x));
  Temperature_set_celsius(&t, (Temperature_get_celsius(t) + 5.0));
  ...
}
```

Either half's annotation types the other when one has none, as in TypeScript: `set
fahrenheit(v)` takes the getter's `f32`. When neither half writes a type, the getter's body says
it (Rule 8.19, §14) and the setter's value takes it, as TypeScript types it: `v` below is an `f32`
because `level` returns one, and an assignment that needs the type before the getter's body is
lowered lowers it first.

```ts
"use typeshade";
class Gauge {
  #raw: f32 = 0.;
  get level() {
    return this.#raw * 0.5;
  }
  set level(v) {
    this.#raw = v * 2.;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let g = new Gauge();
  g.level = uv.x;
  g.level += 0.25;
  return vec4(g.level, 0., 0., 1.);
}
```

A static accessor is a function with no receiver, read on the class, `Temperature.boiling`. The
nearest class of a chain that declares either half of an accessor owns both, so a class that
overrides the getter alone has no setter, as in TypeScript.

Refused, with the fix: a read of an accessor with no getter and a write of one with no setter
(declare the other half); a setter's value with no type and no getter, which TypeScript would
type `any`, or beside a getter that returns nothing (write `set x(v: T)`); and a write into what
a getter returns, `t.pos.x = 1.` (TS8018): the getter hands back a copy, so the write would be
lost where TypeScript changes the object; assign the whole property instead.

### Private names

A member written `#x` is private to its class (Rule 8.12). WGSL and GLSL ES 3.00 have no private
member and no `#` in a name, so it is emitted without the `#`: the field `#count` is the struct
member `count`, the method `#step` is `Cls_step`, the static `#K` the constant `Cls_K`. What keeps
it private is the front end, which lets `#x` be named only inside the body of the class that
declares it, TypeScript's own rule. A private field and a public accessor of one name is the
ordinary pairing, and the two do not meet: `count` the member, `Counter_get_count` the getter.

```ts
"use typeshade";
class Counter {
  #count: u32 = 0;
  static #limit = 100;
  get count(): u32 {
    return this.#count;
  }
  increment(): void {
    this.#count = this.#clamped(this.#count + 1);
  }
  #clamped(n: u32): u32 {
    return min(n, u32(Counter.#limit));
  }
}

@fragment
export function fs(): vec4 {
  let c = new Counter();
  c.increment();
  c.increment();
  return vec4(f32(c.count) / 2., 0., 0., 1.);
}
```

A public name never reaches a private member, so `c.count` above is the getter and never the
field; an object literal cannot build a class with a private field (build it with `new`), and a
spread and a destructuring pattern leave the private fields out, as TypeScript's do. Refused:
`#x` named outside its class body (TS8035), and two members of one class chain that would share
an emitted name, `#x` beside `x` or a `#x` a class and one it extends both declare (TS8010 for a
field, TS8035 for a function).

### Parameter properties, a field's type from its initializer, and `readonly`

`constructor(public x: f32, public y: f32) {}` declares the fields `x` and `y` where the
constructor stands, and the constructor assigns them from its parameters before the field
initializers run (Rule 8.14). `private`, `protected` and `readonly` declare one too. A field
written without a type takes the one its initializer names: a written number is an `f32` (Rule
5.1), `true` and `false` a `bool`, `new P()` the struct `P`, `vec3(0.)` or `u32(1)` that type. One
whose initializer names no type, `a = f(x)`, is TS8010 with the fix, `a: T = ...`; before this
it was dropped from the struct with nothing said where it was declared, and every use of it read
as an unknown field.

```ts
"use typeshade";
class Particle {
  age = 0.;
  alive = true;
  vel = vec2(0.);
  constructor(
    readonly id: u32,
    public pos: vec2,
  ) {}
  step(dt: f32): void {
    this.age += dt;
    this.pos += this.vel * dt;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let p = new Particle(7, uv);
  p.vel = vec2(1., 0.);
  p.step(0.5);
  return vec4(p.pos, p.age, f32(p.id));
}
```

A `readonly` field may be assigned in a constructor of the class that declares it and nowhere
else (TS8005), which is TypeScript's rule; `readonly` is shallow, as TypeScript's is, so
`p.pos.x = 1.` on a `readonly pos` writes into what the field holds and stands.

Field initializers run in TypeScript's order (Rule 8.14): a base's in its constructor, then, when
`super(...)` returns, the derived class's parameter properties and its own initializers, then the
rest of its body. So `class B extends A { limit = 5. }` builds a `B` whose `limit` is 5 whatever
`A` starts it at, and an initializer that reads `this.limit` reads what `A`'s constructor left.
A class that inherits its constructor runs its own initializers when that body returns. Until
this, every initializer ran before the constructor's body, and a derived class's one for an
inherited field was dropped, so that `B`'s `limit` was `A`'s.

### A chain of calls on one object

A method whose every `return` is `return this` hands back its own object, so TypeScript runs the
next call of a chain on the same one: `b.sized(2.).tinted(red)` sizes `b` and tints it (Rule
8.10). A struct is a value here, and what such a method returns is a copy of it: the reference is
how the method changed the object, and the return is a value like any other. So where a chain is
the whole of a statement, of a declaration's initializer or of a `return`, each call but the last
runs as a statement of its own, in source order, on the object the chain starts from, and the
last runs in the statement, on that object too. The object is found once, before the first call,
as TypeScript finds it: `slots[cursor].claim(1.).tag(2.)` reads `cursor` into a `let` first, so
`tag` tags the slot `claim` claimed even when `claim` moves `cursor`. A chain that starts at `new`
puts what `new` built in a temporary, `_chain`, and that temporary is the object the chain changes.

```ts
"use typeshade";
class Brush {
  size: f32 = 1.;
  tint: vec3 = vec3(1.);
  sized(s: f32): Brush {
    this.size = s;
    return this;
  }
  tinted(c: vec3): Brush {
    this.tint = c;
    return this;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let b = new Brush();
  b.sized(uv.x).tinted(vec3(uv, 0.5));
  const c = new Brush().sized(2.).tinted(vec3(1., 0., 0.));
  return vec4(b.tint * b.size + c.tint, 1.);
}
```

```wgsl
fn Brush_sized(self_: ptr<function, Brush>, s: f32) -> Brush {
  (*self_).size = s;
  return (*self_);
}
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var b: Brush = Brush_new();
  Brush_sized(&b, uv.x);
  Brush_tinted(&b, vec3<f32>(uv, 0.5));
  var _chain: Brush = Brush_new();
  Brush_sized(&_chain, 2.0);
  let c = Brush_tinted(&_chain, vec3<f32>(1.0, 0.0, 0.0));
  ...
}
```

A method that returns `this`, inherited by a class that extends the one that wrote it, returns
the derived object, as it does at run time in TypeScript, so a chain through inherited setters
keeps its type. Inside a larger expression the copy is all there is. A call on it that only reads
is right as it is, `1. + v.setX(1.).len()`; one that would change it is refused (TS8035), since the
change would land on the copy and be dropped where TypeScript changes `v`: make the chain a
statement of its own, or call each method on `v`.

### `super` on an accessor, and on a method that changes its object

`super.value` in an override reads through the base's getter, and `super.value = v` writes
through its setter, on this body's object (Rule 8.11); a compound assignment, `++` and `--` go
through both. The base's half is lowered once more for the derived class,
`Clamped_super_Counter_set_value`, as the base's body of a method already was for `super.m()`
(T5, [#92](https://github.com/typeshade/typeshade/issues/92)). A base's body that writes its object,
called through `super`, takes it by reference as any method that writes it does (Rule 8.10), and
the override hands on its own reference.

```ts
"use typeshade";
class Counter {
  n: f32 = 0.;
  get value(): f32 {
    return this.n;
  }
  set value(v: f32) {
    this.n = v;
  }
  bump(): void {
    this.n += 1.;
  }
}

class Clamped extends Counter {
  set value(v: f32) {
    super.value = min(v, 10.);
  }
  get value(): f32 {
    return super.value;
  }
  bump(): void {
    super.bump();
    this.value = this.value;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let c = new Clamped();
  c.value = 9.5 + uv.x;
  c.bump();
  return vec4(c.value / 10., 0., 0., 1.);
}
```

```wgsl
fn Clamped_set_value(self_: ptr<function, Clamped>, v: f32) {
  Clamped_super_Counter_set_value(self_, min(v, 10.0));
}
fn Clamped_bump(self_: ptr<function, Clamped>) {
  Clamped_super_Counter_bump(self_);
  Clamped_set_value(self_, Clamped_get_value((*self_)));
}
fn Clamped_super_Counter_bump(self_: ptr<function, Clamped>) {
  (*self_).n += 1.0;
}
```

Refused, with the fix (TS8035): `super.x` where the class above declares only the other half of
`x`, `super.x` naming a field (a field is the object's own, which `super` does not reach, as
TypeScript's TS2855 says; write `this.x`), and a `super.x` nothing above declares.

### `private` and `protected`

`private` and `protected` are enforced (Rule 8.15), as TypeScript's checker enforces them in the
editor and as `#x` is here (Rule 8.12). A `private` member may be named only in the body of the
class that declares it; a `protected` one in that body and in the bodies of the classes that
extend it, on an object of the naming body's own class or of one that extends it (TypeScript's
TS2446). Neither changes what is emitted: `balance` is the struct member `balance`, and
`deposit` the function `Account_deposit`.

```ts
"use typeshade";
class Account {
  private balance: f32 = 0.;
  protected limit: f32 = 100.;
  deposit(v: f32): void {
    this.balance = min(this.balance + v, this.limit);
  }
  get total(): f32 {
    return this.balance;
  }
}

class Premium extends Account {
  raise(): void {
    this.limit *= 2.;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let p = new Premium();
  p.raise();
  p.deposit(150. * uv.x);
  return vec4(p.total / 200., 0., 0., 1.);
}
```

A name is checked against the declaration the class whose body holds it sees, as TypeScript
checks it: `this.weight()` in an `abstract` class that declares `protected abstract weight()` is
that class's own call, even in the body a class that overrides `weight` inherits. A field a
derived class declares again without a modifier is public, as TypeScript allows.

Refused (TS8035), each with the member to reach it through: `p.balance` outside `Account`
(`"Account.balance" is private, so only the body of "Account" may name it. Reach it through a
public member of "Account".`), `p.limit` outside the chain, and, in a `Premium` body, `a.limit`
on an `Account` that is not a `Premium`. An object literal cannot build such a class (TS8010;
build it with `new`), and a spread and a destructuring pattern leave its `private` and
`protected` fields out, as TypeScript's do.

---

**A class whose members are all static is a namespace of functions** (roadmap 0.3 item T3,
[#92](https://github.com/typeshade/typeshade/issues/92)). The utility class needs no fields,
and WGSL has no empty struct, so it carries none:

```ts
class Util {
  static half(x: f32): f32 {
    return x * 0.5;
  }
  static quarter(x: f32): f32 {
    return Util.half(Util.half(x));
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

**A static field the file writes is a module variable** (Rule 8.13). `Stats.hits += 1` anywhere
in the file, or `this.hits += 1` in a static member, makes `hits` the per-invocation variable a
top-level `let` is (§24), `var<private> Stats_hits`, and every read of it reads the variable. Its
initializer is a constant by §24's measure. A `readonly` static is never written, and a write to
one is TS8005.

```ts
"use typeshade";
class Stats {
  static hits = 0.;
  static readonly WEIGHT = 0.5;
  static record(v: f32): void {
    this.hits += v * this.WEIGHT;
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  Stats.record(uv.x);
  Stats.record(uv.y);
  return vec4(Stats.hits, 0., 0., 1.);
}
```

### Statics through a class that extends, `new this()`, and `super` in a static member

A class inherits its base's statics, as TypeScript's constructors do (Rule 8.13): `Big.SCALE` is
`Big`'s own when `Big` declares one and `Shape`'s when it does not, and `Big.unit()` calls the
`unit` that `Shape` declares. In TypeScript `this` in a static member is the class the call
names, so `Big.unit()` runs `Shape`'s body with `this` as `Big`: `new this()` builds a `Big`, and
`this.SCALE` reads `Big.SCALE`. Here that body is lowered once more for `Big`, as `Big_unit`, with
`this` bound to `Big`, and a static declared to return the class that declares it that builds
its value with `new this()` returns the class the call names, the object TypeScript returns at
run time. `super.describe()` in a static member runs the static the class above declares, with
`this` still the class the call names.

```ts
"use typeshade";
class Shape {
  size: f32 = 1.;
  static SCALE = 1.;
  static unit(): Shape {
    let s = new this();
    s.size = this.SCALE;
    return s;
  }
  static describe(): f32 {
    return this.SCALE;
  }
}

class Big extends Shape {
  static SCALE = 4.;
  static describe(): f32 {
    return super.describe() * 10.;
  }
}

@fragment
export function fs(): vec4 {
  const a = Shape.unit();
  const b = Big.unit();
  return vec4(a.size, b.size, Big.describe(), 1.);
}
```

```wgsl
fn Big_describe() -> f32 {
  return (Big_super_Shape_describe() * 10.0);
}
fn Big_unit() -> Big {
  var s: Big = Big_new();
  s.size = Big_SCALE;
  return s;
}
fn Big_super_Shape_describe() -> f32 {
  return Big_SCALE;
}
```

`this` in a static member was the class that wrote the member until this, so `Big.unit()` built a
`Shape` and read `Shape.SCALE`, which is not what TypeScript computes. A class of statics alone
keeps its base too: over a class with fields it has those fields, so it is a struct and `new`
builds one, and over another class of statics alone it is a namespace that inherits them.

A write to a static through a class that does not declare it, `Big.count += 1.` for a `count`
only `Shape` declares, would give `Big` a field of its own in TypeScript, which one module
variable cannot be; it is TS8005 with the fix, `Shape.count += 1.`. The same write through
`this`, in a `Shape` static that `Big.f()` runs, is refused where such a call is written and
nowhere if nothing makes one; so is `this.#k` there, since a private static lives on `Shape` alone
and TypeScript throws when `Big` reaches it (TS8035, with the fix `Shape.#k`). `super.K = v` in a
static member writes `this.K` in TypeScript, not the field the class above declares, and is
refused with both spellings to choose from. `new this()` outside a static member is TS8013:
`this` there is an object, not a class.

A write INTO a static a base declares is another matter: `Big.origin.y = 5.`, or a method that
changes `Big.origin`, changes the one object `Shape` and `Big` both read, in TypeScript and here.
The statics of a generic base are its class's, one for every instance, so `FPair.K` over
`class FPair extends Pair<f32>` reads `Pair.K`. And what holds for a static holds for every body a
class inherits (Rule 8.9): an instance method whose body calls `weigh(this)` with `weigh` taking
the base fails for the derived class alone, since a derived value is not a base one here, and it
is refused when something calls it on a derived object, and not at all while nothing does.

### A method that changes an object its object holds, and a `const` object

A field of `this` is part of `this`. So a method that calls a changing method on one,
`this.hull.step(dt)`, changes its own object too, whichever class declares `step`, and takes it by
reference as any changing method does (Rule 8.10). The same holds for an element,
`this.parts[i].step(dt)`, for a getter that writes its object, and at any depth: which methods
change their object is worked out for every class of the file at once, so a class may hold one
declared after it. Until this, `drift` below was TS8035, `"Ship.drift" reads its object only, so
it cannot write "this" (§26).`

```ts
"use typeshade";
class Body {
  pos: vec2 = vec2(0.);
  vel: vec2 = vec2(1., 0.5);
  step(dt: f32): void {
    this.pos += this.vel * dt;
  }
}

class Ship {
  hull: Body = new Body();
  drift(dt: f32): vec2 {
    this.hull.step(dt);
    return this.hull.pos;
  }
}

@fragment
export function fs(): vec4 {
  const ship = new Ship();
  const at = ship.drift(0.5);
  return vec4(at, ship.hull.pos.x, 1.);
}
```

```wgsl
fn Ship_drift(self_: ptr<function, Ship>, dt: f32) -> vec2<f32> {
  Body_step(&(*self_).hull, dt);
  return (*self_).hull.pos;
}
fn fs() -> @location(0) vec4<f32> {
  var ship: Ship = Ship_new();
  let at = Ship_drift(&ship, 0.5);
  return vec4<f32>(at, ship.hull.pos.x, 1.0);
}
```

`const ship = new Ship()` is how TypeScript writes that: a `const` fixes the name and not the
object, so a method may change what it holds (Rule 6.10). Nothing else holds the object `new`
built, so the local is that object, and the declaration is a `var` from the first write through
it; a `const` nothing writes through stays WGSL's `let`. An object literal, an array literal and a
type's constructor build a value of their own too, so `const v = vec3(0.); v.x = 1.` is a write to
`v`. A `const` that copies what another name holds is where TypeScript and a struct part: its write
would reach the object both names hold, and a write here the copy alone. So it is refused, and the
message asks which is meant, `let c = a` to write a copy or the write on `a` itself:

```
TS8035  "C.bump" changes its object, and "c" is a const whose value may be one something else
        holds, which TypeScript would change with it and a copy here would not. Declare it with
        let to change a copy, or call it on the value itself.
```

Until this, every write through a `const` was refused, with `let` as the fix: `"Ship.drift"
changes its object, and "ship" is declared with const; declare it with let.`

What holds for that refusal holds for every struct local, `let` as well as `const`: a struct is a
value here, so `const w = v` and `let w = v` copy it, where TypeScript hands `w` the object `v`
holds. A write through one name after the copy is not seen through the other:
`const v = new V(); const w = v; v.bump(); w.x` is 0 here and 1 in TypeScript. Write through one
name, or copy after the last write.

### A field that holds a function

`focus = (d: f32): f32 => d * this.gain` is how TypeScript code often writes a method, to keep
`this` bound. A shader has no function value to hand anywhere, so such a field is the method it
is written as (Rule 8.16): the function's parameters, return type and body are the method's, an
expression body is what it returns, and `this` is the object, as in TypeScript. `lens.focus(x)`
is `Lens_focus(lens, x)`. A `function` expression is taken the same way, its `this` parameter
dropped.

```ts
"use typeshade";
class Lens {
  gain: f32 = 2.;
  focus = (d: f32): f32 => d * this.gain;
  blur = (d: f32): f32 => {
    const k = this.focus(d);
    return k / (1. + k);
  };
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const lens = new Lens();
  return vec4(lens.focus(uv.x), lens.blur(uv.y), 0., 1.);
}
```

```wgsl
fn Lens_focus(self_: Lens, d: f32) -> f32 {
  return (d * self_.gain);
}
fn Lens_blur(self_: Lens, d: f32) -> f32 {
  let k = Lens_focus(self_, d);
  return (k / (1.0 + k));
}
```

With no return type written, it returns what its body does (Rule 8.19, §14): `focus = (d: f32) =>
d * this.gain` is the same method, and an expression body that is an assignment, `hit = (d: f32)
=> this.hp -= d`, runs as a statement.

Refused, with the fix: a static field that holds a function, since an arrow there binds `this` to
the class that declares it where a static method binds the class a call names (Rule 8.13), so it
is written as the static method; type parameters; and an `async` or generator function. Until
this, every such field was `A field holding a function is a method: write "focus(...) { ... }".`

A class that extends keeps the kind each member has above it, as TypeScript requires: a field
that holds a function may stand where a method was, and a method may not stand where such a field
was (TS2425); a method, an accessor and a field of a shader type may not stand in for one another
either. Those that did not involve a function field compiled before, to the derived class's member
where TypeScript's object holds the base's. Each is TS8035 now, naming both members. `super.f` on a
field that holds a function is refused as TypeScript refuses it (TS2855), since a field is the
object's own. An accessor over an abstract field is refused too, although TypeScript takes it: the
abstract field is a member of every struct below the class that declares it, so a body that class
wrote would read the member and never the accessor, 0 where TypeScript computes the getter's value.
The fix is named, `abstract get f(): f32`, which means the same and reaches the accessor.

### A method that takes a function

A method, a static method, a constructor and a field that holds a function take a function as a
function of the file does (Rule 8.18, §14): each is compiled once for each set of functions its
calls hand it, and in each copy a call of the parameter calls the function handed over. The
copy takes what the functions handed over capture, then its object, then the rest.

```ts
"use typeshade";
class Swarm {
  total: f32 = 0.;
  each(f: (i: i32) => void) {
    for (let i = 0; i < 4; i++) f(i);
  }
  sum(k: f32) {
    this.each((i) => {
      this.total += f32(i) * k;
    });
  }
  static twice(f: (x: f32) => f32, x: f32) {
    return f(f(x));
  }
}

@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let s = new Swarm();
  s.sum(uv.x);
  let n = 0.;
  s.each((i) => {
    n += f32(i);
  });
  return vec4(s.total, n, Swarm.twice((x) => x * 0.5, uv.y), 1.);
}
```

```wgsl
fn Swarm_each_Swarm_sum_f(k: f32, self_: ptr<function, Swarm>) { … }
fn Swarm_each_fs_f(n: ptr<function, f32>, self_: Swarm) { … }
fn Swarm_twice_fs_f_1(x: f32) -> f32 { … }
```

`each` writes nothing of its own object, and the arrow function in `sum` writes `this.total`. In
TypeScript that is one object, so the copy of `each` takes its object by reference and hands the
same reference to the arrow function (Rule 8.10): what `each` reads is what the function wrote.
The same holds for a local named as the object, `g.each(() => { g.n += k; })`. The call through
`super`, `super.each(f)`, runs the base's copy on this body's object, and a method a class
inherits is copied for the class that calls it.

Refused, with the fix: a function handed to a call on a field or an element of a variable that
the function reaches, when either may write it (`this.inner.each((i) => { this.total += 1.; })`),
since the call would take two references into one variable, which WGSL refuses where either is
written: call it on a copy in a let, and assign the copy back if the call changes it. A setter
takes no function (§14).

### An interface with methods is a contract

An interface that declares a method says what a class supplies. `implements Shape` and a type
parameter's constraint, `<T extends Shape>`, are how TypeScript uses one, and both compile: a call
on a `T` reaches the method of the class the call binds, one function for each class, which is
the static dispatch of Rule 8.9. A value of type `Shape` itself would have to pick its body at run
time, which no WGSL function can, so a parameter, a field or a local of that type is refused once,
where the interface declares the method, with the type parameter to write instead (Rule 6.9). An
interface of fields alone is a struct, as it was.

```ts
"use typeshade";
interface Shape {
  area(): f32;
}

class Square implements Shape {
  side: f32 = 2.;
  area(): f32 {
    return this.side * this.side;
  }
}

class Disc implements Shape {
  r: f32 = 1.;
  area(): f32 {
    return 3.14159 * this.r * this.r;
  }
}

function total<T extends Shape>(a: T, b: T): f32 {
  return a.area() + b.area();
}

@fragment
export function fs(): vec4 {
  return vec4(total(new Square(), new Square()), total(new Disc(), new Disc()), 0., 1.);
}
```

```wgsl
fn total_Square(a: Square, b: Square) -> f32 {
  return (Square_area(a) + Square_area(b));
}
fn total_Disc(a: Disc, b: Disc) -> f32 {
  return (Disc_area(a) + Disc_area(b));
}
```

Until this, the constraint was TS8010, `Data type "Shape" cannot have methods.`, and a value of the
interface's type said so again at each use.

### A call cycle through methods

`this.g(n)` names no function in its text, so the recursion check (§4) could not follow a call on
a value, and a cycle through methods reached Tint. The check reads the calls each body lowers to
now, a method call, a getter, a setter and `new` included, and says TS8031 at the call that closes
the cycle, naming it as written (Rule 8.4):

```
TS8031  Recursive call: "N.f" -> "N.g" -> "N.f". WGSL has no call stack, so a function must not
        take part in a call cycle.
```

A body a class inherits is lowered once more for that class, and the cycle it closes there is said
once, as is the one each instance of a generic function closes, under the name the function was
written with. A static called through its class, `N.f()`, is named `"N.f"` too, where the check
said `"N_f"` before.

### `namespace`

A namespace is a named group of functions and constants, and the module holds both, so the
members flatten to `Ns_member`, the joining a method and a static field already take (roadmap
0.3 item T4, [#92](https://github.com/typeshade/typeshade/issues/92)):

```ts
namespace Palette {
  export const WARM: vec3 = vec3(0.9, 0.5, 0.1);
  export function tint(c: vec3): vec3 {
    return c * WARM;
  }
}
```

emits `const Palette_WARM` and `fn Palette_tint`. Nesting flattens too, in both spellings:
`namespace A { export namespace B { ... } }` and `namespace A.B { ... }` both give `A_B_member`.

A namespace holds a class too, under the same flattening (#107):

```ts
namespace Scene {
  export class Camera {
    pos: vec3;
    zoom: f32;
  }
}
declare const cam: uniform<Scene.Camera>;
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
"use typeshade";
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const a = vec3(uv, 0.5);
  const b = vec3(0.5, 0.5, 0.5);
  const m = a < b;                       // vec3b
  const c = select(a, b, m);             // per component: b where m is true, a elsewhere
  if (all(m)) {
    return vec4(1., 0., 0., 1.);
  }
  return vec4(c, f32(any(!m)));
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
  targets. Over an array they stay the folds, `any(xs, pred)` with `pred` a function the file
  declares, a local one included, which hands each call what it captures (Rule 8.17), or an arrow
  function written in the call (Rule 8.18, §14); a scalar or a numeric vector is TS8003 naming
  both shapes.
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
  center: vec2;
  constructor(center: vec2) {
    this.center = center;
  }
  abstract sdf(p: vec2): f32;
  coverage(p: vec2): f32 {
    return 1. - smoothstep(0., 0.02, this.sdf(p));
  }
}
class Circle extends Shape {
  radius: f32;
  constructor(center: vec2, radius: f32) {
    super(center);
    this.radius = radius;
  }
  sdf(p: vec2): f32 {
    const d: vec2 = p - this.center;
    return length(d) - this.radius;
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
  return [0.05 * scale, 8. * scale];
}
function mid(span: [f32, f32]): f32 {
  return (span[0] + span[1]) * 0.5;
}
const depth = mid([0.05, 8.]);           // a list, in a position that declares the type
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
| `'lo' \| 'hi'` | a string has no GPU representation. Write the cases as an enum, whose members are numbers. A string literal written as an argument of `console.log` is a label, which the host keeps (§66). |
| `f32 \| null` | a value of a type always exists. Carry a bool saying whether it means anything. |
| `[f32, vec3]` | a list of several types is a struct. Declare one with a field per element. |
| `[f32, ...f32[]]` | every array outside storage has a length known at compile time. |
| `symbol` | a symbol is a JS runtime value. Only a brand key is erased. |
| `f32 & vec3` | two carriers have different layouts, so no one value is both. |
| `d instanceof B` | a struct is its fields and nothing else, and dispatch is static, so there is no type tag to read. Give the struct a field saying which kind it holds. |
| `'x' in b` | a struct has exactly the fields its type declares, so the answer is in the type. Write the field access. |
| `number`, `boolean` | a number on the GPU has a width: `f32`, `i32`, `u32`. The boolean is spelled `bool`. |

**And two operators with nothing to be either.** `a == b` is refused for `a === b`:
JavaScript's loose equality is a coercion table, and both targets have exactly one comparison,
between two values of one type. `a >>> b` is refused for a cast and `>>`: a GPU shift is one
operator whose meaning the **operand's** kind fixes — `>>` on a `u32` is already the logical
shift, and on an `i32` the arithmetic one — so there is no third operator for `>>>` to be. §52
has the rest of the operator surface.

**And one mistake reads as one sentence.** A parameter whose annotation was refused no longer
adds that it "requires a TypeShade type annotation", which it has; a return no longer adds
"Unsupported return type"; a call to a function this file declares and could not lower no
longer says "Unknown function", which was untrue — the function is there, and its declaration
already said why. A call to a name nothing declares still says so, and names the function it
is spelled like (§7). A local whose declaration was refused, or that is declared from one that
was, says nothing more where it is read, assigned or written through (#171): after a refused
`const t = a * b`, `const u = t * 2.` binds no `u` either, and `return u` is not an unknown
identifier.

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
  center: vec2;
  radius: f32;
}

function Tinted<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    tint: vec3;
    lit(cover: f32): vec3 {
      return this.tint * smoothstep(0., 1., cover);
    }
  };
}

class TintedDisc extends Tinted(Disc) {
  softness: f32;
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
  constructor(a: T, b: T) {
    this.a = a
    this.b = b
  }
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
declare const shadowMap: texture_depth_2d;
declare const shadowSmp: sampler_comparison;
declare const cascades: texture_depth_2d_array;

const lit = textureSampleCompare(shadowMap, shadowSmp, uv, depthHere);
const litFar = textureSampleCompareLevel(cascades, shadowSmp, uv, band, depthHere);
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
declare const env: texture_cube<f32>;
declare const lut: texture_3d<f32>;
declare const pointShadow: texture_depth_cube;

const sky = textureSample(env, smp, dir); // by direction
const glossy = textureSampleBias(env, smp, dir, 2.); // the implicit level, shifted coarser
const graded = textureSampleLevel(lut, smp, sky.rgb, 0.); // the colour IS the coordinate
const detail = textureSampleGrad(albedo, smp, uv, ddx, ddy); // explicit gradients, any stage
const lit = textureSampleCompare(pointShadow, shadowSmp, normalize(toLight), length(toLight));
const size = textureDimensions(lut); // vec3u: a volume's size is three wide
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
declare const ramp: texture_1d<f32>;
declare const envs: texture_cube_array<f32>;
declare const pointShadows: texture_depth_cube_array;

const heat = textureSample(ramp, smp, uv.x); // one number in
const steps = textureDimensions(ramp); // u32: one wide
const sky = textureSample(envs, smp, dir, layer); // the layer after the direction
const reds = textureGather(0, albedo, smp, uv); // component FIRST: 0 is red, 3 is alpha
const passes = textureGatherCompare(shadow, shadowSmp, uv, depthRef); // no component: one channel
const lit = textureSampleCompare(pointShadows, shadowSmp, dir, layer, depthRef);
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
was measured accepted, gather in a compute stage too (a one-off probe that was not kept in the tree).

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
textures: the spec audit lists each with its portability, and they become their own items
rather than riding this one. `u32` array indices and levels, where WGSL takes either integer,
were on this list until §42 took them.
`textureNumSamples` and `texture_depth_multisampled_2d` were on this list until §37 took them.

## 37. A multisampled texture, read one sample at a time

Roadmap 0.4 item 13. The type existed — `texture_multisampled_2d` and the `msaaTextureLoad`
capability — and nothing read it. This is the read: `textureLoad(t, coords, sampleIndex)` yields
one sample, `textureNumSamples(t)` says how many there are, and `textureDimensions(t)` the size.
The depth twin, `texture_depth_multisampled_2d`, is the depth attachment of an MSAA target,
loaded the same way and yielding an `f32`.

```ts
declare const msaa: texture_multisampled_2d<f32>;
declare const depthMs: texture_depth_multisampled_2d;

const c: vec2i = vec2i(p.xy);
const s0 = textureLoad(msaa, c, 0); // the third argument is a SAMPLE INDEX, not a level
const n = f32(textureNumSamples(msaa));
const depth = textureLoad(depthMs, c, 0); // f32
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
import { compile } from 'typeshade';

const { determinism } = compile(source);
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
| `target`    | one answer on WGSL, but the GLSL ES 3.00 spelling may answer differently on some input                                                     | the four packs — `pack4x8unorm`, `pack4x8snorm`, `pack2x16unorm`, `pack2x16snorm` — at an exact half; the four `quantizeToF16` widths     |
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
`target` row is the case where the two can part on an input WGSL settles. The four packs are
there for the same tie, reached two ways: `pack2x16unorm` and `pack2x16snorm` are native GLSL
builtins defined with `round()`, whose exact half goes in an implementation-chosen direction,
while `pack4x8unorm` and `pack4x8snorm` have no GLSL form at all and are hand-inlined as
`floor(0.5 + x)` — the rule WGSL itself states — against a driver measured to round that same
half to even. `quantizeToF16` is a `packHalf2x16` round trip on GLSL and parts on a binary16
half, on a magnitude past the largest finite binary16 and on one below the smallest normal.
`ldexp` was a `target` row and is not one any more: its GLSL scale is now built in two halves,
and a sweep of all 278 legal exponents against a WGSL driver found no disagreement.

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
"use typeshade";

class Uniforms {
  origin: f64;   // one vec2<f32> slot; the host writes the two words
  span: f32;
}
declare const u: uniform<Uniforms>;

export function stripes(t: f32): f64 {
  const stripe: f64 = 0.125;       // a literal in a DECLARED f64 position keeps the double
  const world = u.origin * 2.5;    // a literal beside an f64 is lifted to an f64 literal
  const swept = world + u.span * t; // an f32 beside an f64 widens exactly, as vec2<f32>(x, 0.)
  return fract(swept / stripe);
}
```

A literal is retyped only where the surrounding type *says* `f64` — a declaration, a parameter,
a field, a return, or the other side of an operator. `f64(0.1)` says it explicitly and is left
alone; it carries the whole double too (the cast folds a literal argument at full precision),
so the two spellings emit the same pair. What the retype buys is that the natural one compiles:
`const k: f64 = 0.1` used to be a type mismatch, `f64` against the `f32` every bare literal
lowers to, and the only way to write an f64 constant was the explicit cast.

Neither the retype nor the cast takes a call for a literal. `f32(0.1)` says which precision it
means, so `f64(f32(0.1))` widens that `f32` exactly, to the pair `(0.10000000149011612, 0.0)`,
as `s * f32(0.1)` widens it beside an `f64`.

**Vectors.** `vec2f64`, `vec3f64` and `vec4f64` are vectors of doubles. They swizzle and index
like any other vector — a lane is a swizzle of the hi and lo planes the pass lowers the vector
into — and `vecN(v)` narrows one per lane, which is `f32(lane)` N times.

```ts
export function lanes(p: vec3f64): vec3 {
  const x = p.x;        // f64
  const first = p[1];   // f64 — a CONSTANT lane; p[i] with a variable i has no lowering
  const pair = p.xy;    // vec2f64
  return vec3(p);       // the per-lane narrow
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
would be exact, since flat interpolation does no blending. It is not done: a double silently
made flat would change what the program draws with nothing in the source to point at.
`@interpolate("flat")` is an author attribute now (§53), but an `f64` varying is refused with it
as without it; admitting the flat case is an open item.)

**The guard.** A module that uses the emulation gets a `_fp64` binding injected at lowering: a
1×1 `texture_2d<f32>` the host must fill with `1.0`. It is what stops a driver's fast-math from
algebraically cancelling the error-free transforms — the pair only works because the compiler is
not allowed to "simplify" `(a + b) - a`, and a value read from a texture is one it cannot fold
through. `reflect()` reports it like any other binding, group and slot included, so bind what
reflection lists and the guard is covered; a host that skipped it got a WebGPU validation error
or, on WebGL2, a silently wrong picture.

Each function that does `f64` arithmetic reads that texel once, into a `let` at the top of its
body, and hands it to the emulation as a parameter, so a loop reads it before it starts and not
on every iteration. It stays a runtime read: nothing in the emitted source says it is `1.0`, and
a guard the compiler could see through would guard nothing. On GLSL ES 3.00 the texture is
declared `uniform highp sampler2D _fp64;`. That specification gives `sampler2D` a default
precision of `lowp` in both stages, and a texel fetch returns its sampler's precision; `1.0` is
exact at `lowp`, so the qualifier changes no value today, and it is what keeps the read exact
under a host preamble that lowers the default.

**What the 48 bits rest on.** The pair keeps its extra bits only while every `f32` `+`, `-` and
`*` inside the error-free transforms rounds to nearest, ties to even. Under any other rounding a
two-sum or a split leaves an error term that is not the exact residual. That is hardware
practice, not a promise either target's specification makes: GLSL ES 3.00 (§4.5.1) calls those
three operations correctly rounded but leaves the rounding mode undefined and lets any
operation flush a subnormal to zero, and WGSL fixes no rounding mode either (§38). Every
shipping GPU rounds `f32` addition, subtraction and multiplication to nearest even, and the
48-bit figure is stated on that basis. Where a driver flushes subnormals, a result smaller than
about 2⁻¹⁰² keeps only its high word, because its low word is then below the smallest normal
`f32`.

## 40. Matrices: every `matCxR`

A matrix is `cols` columns of `rows` components, column-major, which is what both targets are.
All nine shapes of `C, R ∈ {2, 3, 4}` are types, spelled `matCxR`. Each one also answers to
WGSL's predeclared alias `matCxRf` (`mat2x2f`, `mat4x3f`, …), as `vec3` answers to `vec3f`, and a
square one also answers to `matN`. The three spellings are one type, and each is a constructor
too:

```ts
"use typeshade";

export function shapes(a: mat3, b: mat2x3, c: mat4x3): vec3 {
  //  mat3   = mat3x3   3 columns of 3
  //  mat2x3           2 columns of 3
  //  mat4x3           4 columns of 3
  const d: mat2x3f = b;  // mat2x3f = mat2x3, WGSL's alias
  return a[0] + d[1] + c[3];
}
```

`m[j]` is **column j**, a `vecR` — not row j, and not one component. The two readings coincide
only on a square matrix, which is why it was worth saying once here.

**Constructors.** Four forms, and a matrix takes whichever one fits:

```ts
const fromColumns = mat3(vec3(1., 0., 0.), vec3(0., 1., 0.), vec3(0., 0., 1.));
const fromParts   = mat2x3(1., 2., 3., 4., 5., 6.);   // column by column
const zero        = mat2();
const truncated   = mat3(model);                       // the upper-left 3×3 of a mat4
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
whose dimensions do not meet is refused at the operator, naming both shapes and the rule. That
includes the pair easiest to write by accident, two matrices of **one non-square shape**: a
`mat2x3` has 2 columns and 3 rows, so `a * b` between two of them meets nothing, however alike
the two look.

```ts
export function bad(a: mat2x3, b: mat2x3): mat3 {
  return a * b;
  // Type mismatch: cannot * mat2x3<f32> and mat2x3<f32>. WGSL's matrix product is
  // matKxR * matCxK -> matCxR: the left operand's 2 columns must meet the right operand's
  // 3 rows. transpose(b) turns this pair into one that meets.
}
```

**A matrix has `+`, `-` and `*` and nothing else.** `m / n` and `m % n` are refused, because
neither target defines them, and so are the compound spellings `m /= n` and `m %= n`. `m *= n`
carries the product rule above: the result has to land back in the target's own shape, which a
square right operand does.

**Builtins.** `transpose(m)` on a `matCxR` gives a `matRxC` — a different type unless the
matrix is square. `determinant(m)` takes a square matrix only, since a non-square one has
none; asking for it names that.

**`matCx2` in a uniform block is refused**, and it is the only shape that is. Measured on a
real WebGL2 driver and on Tint: std140 rounds every matrix column up to 16 bytes, while WGSL's
column stride is `AlignOf(vecR<f32>)` — 8 when the matrix has two rows and 16 otherwise. So a
`mat2x2`, `mat3x2` or `mat4x2` field would sit at different byte offsets on the two targets,
and so would every field after it:

```
TS8051 (error): "U.m" is in a uniform: mat2x2 in std140 is not supported — WGSL gives a
two-row matrix a column stride of 8 and GLSL std140 rounds every column to 16, so the two
targets would disagree on this field and every field after it; carry it as mat2x4
(measured: both targets stride 16) or as 2 vec2 fields.
```

The refusal is an error at the binding's declaration (Rule 4.8), so neither target is emitted,
for a compute-only module as for a render one; `reflect()` and the fn() EDSL's `wgslLayout`
throw the same sentence for a std140 layout.

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

## 42. Every texture argument is checked before emit

> **On the section numbers.** They are handed out in BLOCKS, one block per branch in flight,
> the same way `src/compiler/ts/codes.ts` hands out diagnostic codes, so two sessions adding
> sections at once cannot claim one number twice. That leaves gaps: §41 and §56 to §61 are
> blocks no landed branch has spent, while §50 to §54 are lane D's and are in this document
> below, as are §55 and §62. A gap is never reused: a number a block did not spend stays unspent, so a
> cross-reference keeps pointing where it pointed.

A texture read has one texture argument and several plain ones, and WGSL types each of the plain
ones exactly. The coordinate of a sampled read is a normalised `f32`; the coordinate of a texel
fetch — `textureLoad` and `textureStore`, sampled or storage — is a whole texel, "`C` is `i32`,
or `u32`". A layer, a mip level and a sample index are integers. A `level`, a `bias` and a
`depth_ref` are `f32`. Both targets refuse the wrong one: Tint with "no matching call" about
generated code the author never wrote, a WebGL2 driver with "no matching overloaded function".

Only the WIDTH of a coordinate and a whole-number LITERAL used to be checked, so a VARIABLE of
the wrong type went through untouched:

<!-- doc-snippets: skip — the refusal this section is about; it is meant not to compile -->

```ts
"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const l: i32 = 2;
  return textureSampleLevel(t, s, p.xy, l);
}
```

That emitted `textureSampleLevel(t, s, p.xy, 2)` with zero diagnostics. It is now one sentence
naming the cast to write:

```
textureSampleLevel level must be an f32; got i32. Write f32(l).
```

The same check covers the element kind of a coordinate, which nothing looked at:
`textureSample(t, s, vec2i(0, 0))` is `textureSample on a texture_2d<f32> takes an f32
coordinate; got vec2<i32>.`, and `textureLoad(t, vec2(0., 0.), 0)` is `textureLoad on a
texture_2d<f32> takes an integer coordinate, an i32 or a u32; got vec2<f32>.` A storage texture
is checked like every other one, where its coordinate was previously left to nobody:
`textureStore(dst, vec3i(0, 0, 0), …)` on a `texture_storage_2d` is `takes a vec2 coordinate;
got vec3<i32>.`

A bare number is still retargeted rather than refused, because a literal has no type of its own
on this surface: `textureSampleLevel(t, s, uv, 0)` emits `0.0`, `textureLoad(t, c, 0)` emits the
integer, and `textureStore(dstArr, at, 0, v)` spells its layer `0`. What changed is only the
case a cast fixes.

## 43. Which stage a texture read and an atomic belong to

Three rules of WGSL say where a call may stand, and all three are now checked at the entry, in
the author's file, with the call chain named:

| Rule | What it covers |
| --- | --- |
| fragment only | `textureSample` and `textureSampleBias` (the implicit level of detail needs the screen-space derivatives), `textureSampleCompare` (same, through a comparison sampler), and `dpdx` / `dpdy` / `fwidth` with their coarse and fine forms |
| fragment or compute | `textureStore`, ANY call touching a storage texture declared `"read_write"` — a read, a `textureDimensions`, a `textureNumLayers` — and every `atomic*` builtin |
| any stage | `textureSampleLevel`, `textureSampleGrad`, `textureSampleCompareLevel`, `textureLoad`, `textureGather` and every query |

The second row is not about the builtin but about the RESOURCE: a storage texture with write
access must not be reached from a vertex stage at all, so measuring or reading one there is
refused with writing it, while a `"read"` storage texture and every sampled fetch stay legal.
That is why it cannot be a list of names — `textureLoad` and `textureDimensions` are the ids a
sampled texture uses too — and why the argument's own type is what decides. (A `"write"` texture
is never read in any stage: `textureLoad` on one is refused by the access rule first, and says
so.)

<!-- doc-snippets: skip — the refusal this section is about; it is meant not to compile -->

```ts
"use typeshade";
declare const total: storage<atomic<u32>, "read_write">;

class Clip {
  @builtin("position") pos: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const n = atomicAdd(total, 1);
  return { pos: vec4(f32(n), 0., 0., 1.) };
}
```

```
"atomicAdd" is only valid in a fragment or compute shader; "vs" is a vertex entry. WGSL allows
an atomic built-in in a fragment or compute stage only.
```

A helper is never refused on its own — it is legal until something calls it from the wrong stage
— so the walk closes over the call graph and names the chain: `"bump" is reachable from the
vertex entry "vs"`.

There are two tables behind the first row, because there are two ways into the emitter: the
`"use typeshade"` front end reports at the entry, and the `fragment-only-builtin` lint reports at
emit for a module composed through the EDSL. Both ways of missing an id have happened —
`textureSample` on a `texture_cube_array` was in neither table and reached Tint, and
`textureSample` itself was in the lint and not the front end, so a vertex entry sampling a plain
2D texture was answered by the backend rather than by a sentence about the author's own file. A
test now holds the two equal and derives what they should contain from the intrinsic catalogue.

## 44. Packing, bitcast and the constructors WGSL spells

The IR and both backends have spelled the eight pack/unpack ids and the two `bitcast` ids since
the registry was written. Nothing on this surface could NAME them, so every one was
`Unknown function`. They are authorable now, with `quantizeToF16` and the 4x8 signed pair added
beside them:

| Written | WGSL | GLSL ES 3.00 |
| --- | --- | --- |
| `pack4x8unorm(v)`, `pack4x8snorm(v)` | the builtin | hand-inlined (ES 3.10 has the builtin, ES 3.00 does not) |
| `unpack4x8unorm(u)`, `unpack4x8snorm(u)` | the builtin | hand-inlined |
| `pack2x16float/unorm/snorm(v)` | the builtin | `packHalf2x16` / `packUnorm2x16` / `packSnorm2x16` |
| `unpack2x16float/unorm/snorm(u)` | the builtin | `unpackHalf2x16` / `unpackUnorm2x16` / `unpackSnorm2x16` |
| `bitcast<u32>(x)`, `bitcast<f32>(x)` | `bitcast<T>(x)` | `floatBitsToUint` / `uintBitsToFloat` |
| `quantizeToF16(x)` | the builtin | `unpackHalf2x16(packHalf2x16(...))`, two components at a time |

A pack takes exactly the vector its name says and yields a `u32`; an unpack takes a `u32` and
yields the vector. There is one overload each, and a wrong shape says so:
`pack4x8unorm takes a vec4<f32>; got vec2<f32>. WGSL gives it one overload, and GLSL ES 3.00
the same.` The bit pattern of an unpack may be written as
a bare number — `unpack2x16unorm(65536)` — because an integer literal is retargeted in every
integer position.

`bitcast` names its target as a TYPE ARGUMENT, as WGSL does. It reinterprets rather than
converts, and the two are easy to confuse, so the refusal says which is which:

```
bitcast<u32> reads the bits of an f32; got u32. A bitcast reinterprets 32 bits, it does not
convert: u32(x) is the conversion.
```

`quantizeToF16(x)` rounds to what an IEEE-754 binary16 holds and comes back as an `f32`, so a
shader can see the precision an f16 pipeline would give it without the `shader-f16` extension.
It takes an `f32` or a float vector, and on GLSL it is spelled ONE COMPONENT AT A TIME: pairing
two components into a single `packHalf2x16` was measured to let an overflowing component carry
into its neighbour, which WGSL's per-component builtin cannot do.

It is a `target` row in the determinism report (§38), and the report names three measured
divergences rather than one: at an exact half the GLSL round trip rounds to nearest even and the
WGSL driver moved; above the largest finite binary16 WGSL gives an infinity and the GLSL round
trip a NaN; below the smallest normal one the driver flushed to zero and the GLSL round trip
kept the subnormal. Both 4×8 packs are `target` rows too — writing WGSL's own `floor(0.5 + x)`
into the GLSL inline does not make the two agree, because the WGSL driver rounded the same tie
to even.

### The constructors

Three spellings WGSL has that this surface lacked:

```ts
const zero = vec3();               // the zero value: every component the element's zero
const ids = vec3<u32>(1, 2, 3);    // the element named as a type argument
const xs = array(1., 2., 3.);      // the element type and the count inferred
```

`vec3<u32>(1, 2, 3)` is the one that mattered most, because it used to compile clean and build a
`vec3<f32>`: a program that asked for an unsigned vector silently got a float one, and a
following `f32(v.x)` looked like a cast while casting nothing. A short name already says its
element, so a second one that DISAGREES is a contradiction, while one that agrees is a synonym
and is taken:

```
vec3u<f32> names two element types; vec3u is already u32. Write vec3<f32> or vec3u.
```

The type-argument spelling takes scalar components, and the zero form. Composing a vector out of
a shorter one, or converting a whole one, keeps the short name — `vec3i(v)`, not `vec3<i32>(v)` —
so that the editor and the compiler say the same thing about the same program: an ambient
parameter has to be a concrete type for the vector-arithmetic rule of §17 to read a shape off
it, and a conditional one there silences that rule on every call.

`array(...)` infers ONE element type from its elements, because an array has one; elements that
disagree are refused with the explicit form named, rather than a guess at which was meant. A
bare integer literal still lowers to an `f32` here, so `array(1, 2, 3)` is an `array<f32, 3>` —
the same type `const x = 1` gives.

### `all` and `any` on a plain bool

Both builtins have a scalar overload in WGSL, and both return the argument. The ambient lib
always admitted it; the front end refused it, so the editor and the compiler disagreed about a
program WGSL defines. It is now lowered to the argument itself rather than to a call — a
one-component reduction is the value, and GLSL ES 3.00 has no `all(bool)` overload to emit.

`examples/packing-bitcast.shade.ts` runs all of this on both halves of the gate.

## 45. The two portable spellings that were not, and the scalar conversions

A builtin with no entry in the intrinsic registry is spelled the same on every target. That is
true of `abs` and `dot` for most of their forms and false for two, which the registry claimed
anyway. Measured on a WebGL2 driver, with a broken shader fed to the same instrument first:

| form | WGSL (Tint) | GLSL ES 3.00 (WebGL2) |
| --- | --- | --- |
| `abs` on a `u32` or a vector of them | accepts | **"no matching overloaded function found"** |
| `dot` on integer vectors, either signedness | accepts | **"no matching overloaded function found"** |
| `abs` on an `i32` or a vector of them | accepts | accepts |
| `dot` on float vectors | accepts | accepts |

So an unsigned `abs` is now the IDENTITY on GLSL — which is what it is, since an unsigned value
has no sign to take — and an integer `dot` becomes a `_idot` helper, one overload per vector
type the module uses. A helper rather than an inline sum, because an inline would splice both
arguments once per component, after every optimizer pass has run. The signed `abs` and the float
`dot` are untouched. `examples/integer-math.shade.ts` is the gate witness: its GLSL half links
only because of this.

The choice is ONE rule, asked by both authoring surfaces. `"use typeshade"` lowers `abs(x)` from
source and the `fn()` node graph builds it directly, and a rule that lives in the front end only
leaves the other surface emitting the GLSL no driver takes. So the `fn()` builtins ask the same
function, and while they are there an integer `dot` gets the type its operands actually give:

```ts
import { fn, dot, abs, vec3iT, vec3uT } from 'typeshade';

const sq = fn('sq', { v: vec3iT }, ({ v }) => dot(v, v)); //     -> i32, emits _idot on GLSL
const mag = fn('mag', { v: vec3uT }, ({ v }) => abs(v)); //      -> the operand itself on GLSL
```

`dot` used to be typed `f32` for every operand that was not an emulated double, so the integer
form returned a float the value never was — and it was unreachable through `tsc` in any case,
since the overloads admitted float vectors alone. Both are fixed together: the integer overloads
are there, and they return `i32` and `u32`.

### The scalar conversions

`u32(e)`, `i32(e)` and `f32(e)` take a SCALAR, and a FLOAT the target can hold:

```
u32(-1) is out of range: a u32 holds 0 to 4294967295, and the two targets compute different
values for a float that does not. Measured: u32(-1.) is 0 on WGSL and 4294967295 on GLSL ES
3.00, and u32(4.3e9) is 4294967295 there and 5032960 here. Clamp it first if you want one
answer, e.g. u32(clamp(x, 0., 4294967295.)).

f32() takes a scalar; got vec3<f32>. A vector is converted component-wise by its own
constructor, e.g. vec3(v).
```

Both used to go through. A bare `-1` is an `f32` on this surface, so `u32(-1)` emitted the FLOAT
conversion `u32(-1.0)` — a value the two targets define and define differently. `f32(vec3(...))`
is the sharper case: Tint refuses it outright, and a WebGL2 driver compiles `float(vec3)` and
silently takes `.x`. The two targets did not differ on a corner; they disagreed about whether
the program existed.

The refusal is for FLOATS only, and that is a measurement rather than a simplification.

### An integer conversion is a reinterpretation, not a range check

`u32(i)` on an `i32` — and `i32(u)` on a `u32` — is a bit reinterpretation. Both targets perform
it and both agree on the answer:

| spelling | WGSL (Tint) | GLSL ES 3.00 (WebGL2) |
| --- | --- | --- |
| `u32(-1i)` | accepts, 4294967295 | `uint(-1)` accepts, 4294967295 |
| `i32(4294967295u)` | accepts, -1 | `int(4294967295u)` accepts, -1 |
| `u32(-1)` | **"value -1 cannot be represented as 'u32'"** | `uint(-1)` accepts |

The last row is the whole problem, and it is about the SPELLING. An unsuffixed integer literal
in WGSL is an *abstract* integer, and an abstract integer has to be representable in whatever it
is converted to; with the `i` suffix it is a concrete `i32` and the conversion is the ordinary
reinterpretation. This backend writes `u32` literals with their `u` and `i32` literals with no
suffix at all, so once const propagation had substituted a negative `i32` constant into a
`u32()` call, the module Tint saw was the one it refuses — and nothing said so, because nothing
in the author's file said `-1`.

So the conversion is FOLDED rather than refused. The `u32(-1)` in question is the EMITTED one of
the table's last row — a spelling the backend produced, never one an author wrote, since a bare
`-1` in the source is an `f32` and `u32(-1)` there is the float refusal above. It becomes the
literal `4294967295u` instead, which is the value both targets compute and which needs no suffix
to say what it is:

```ts
const k: i32 = -1;
const bits = u32(k); // emits 4294967295u on WGSL and 4294967295u on GLSL ES 3.00
```

The fold wraps the way the hardware wraps, and that matters more than it sounds. The compile-time
folder used to work in doubles while the const-fold pass worked in 32-bit integers, so the two
disagreed about the same expression: `i32 100000 * 100000` is 1410065408 on both targets and
10000000000 in doubles, `u32 0 - 1` is 4294967295 there and -1 here, and `i32 1 / 2` is 0 there
and 0.5 here. Both now use one helper, so a rule that compares a compile-time value against what
the GPU will compute is comparing the same number.

A RUNTIME conversion is untouched:

```ts
let k: i32 = -1;
const bits = u32(k); // stays a conversion: bit-preserving on WGSL and on GLSL ES 3.00
```

A mutable binding has no compile-time value, so nothing folds and the call is emitted as
written. On the float side a local `const` now carries whatever the compile-time folder can
compute — a negated literal, an alias of another const, a `Math.floor(...)` — so the divergent
`u32(-1.)` is caught through a reference as well as when it is spelled out.

An emulated double is a scalar for this rule, so `f32(f64(x))` is the narrowing it has always
been. And an integer-written literal in a builtin that has no float form is typed `i32`, the way
WGSL materialises an AbstractInt:

```ts
const bits = countOneBits(5); // was "takes an i32 or u32 … got f32"
```

`countOneBits(5.)` keeps its refusal: a float-written literal has no integer meaning.

### What the oracle answers

`length(e)` and `distance(e1, e2)` have scalar overloads in WGSL, defined as `abs(e)` and
`abs(e1 - e2)`; both targets compile them, and the CPU oracle used to throw `v.reduce is not a
function` on a program the GPU ran. It answers now.

One row of this is recorded rather than fixed: `abs(-2147483648)` on an `i32` is that value
itself on both targets, because 2^31 has no `i32`, and the oracle answers `2147483648`. A
builtin there is handed plain numbers, and the `f32` of the same magnitude is the same number
with a genuine `+2147483648` answer — so telling them apart needs the oracle and the codegen to
wrap a call's result by its IR type, which is a change to every integer builtin rather than to
this one. It is pinned as an `it.fails` so the day that changes is a deliberate edit.

## 46. What a texture is asked, and by which integer

Four things a texture read takes that WGSL spells and this surface did not (#147). Each was
measured on real Tint and a real WebGL2 driver before it was written, with a broken shader fed
to the same instrument first.

### A mip level on the size query

```ts
const full = textureDimensions(atlas);
const half = textureDimensions(atlas, 1);
```

The second form was `expects 1 argument(s), got 2`, and the GLSL column had spelled
`textureSize(t, int(level))` all along — only the front end refused it. Measured accepted on
Tint, and on WebGL2 with a non-constant level too. The level is an integer, so a fractional one
is refused like every other texture level.

### The layer count of a storage array

`textureNumLayers` on a `texture_storage_2d_array` answered `takes a sampled texture; … has no
sampler`, which is the wrong answer and the wrong reason. It is a `u32` now, and a storage
texture with no layers is told so in its own words. WGSL-only, like the rest of the storage
family: GLSL ES 3.00 has no image load/store at all.

### Either integer as a texel coordinate

WGSL types a texel coordinate `i32, or u32`. This surface accepted both and emitted both — and
GLSL's `texelFetch` has no unsigned overload:

```
texelFetch(t, uvec2(0u, 0u), 0)         REJECTED: 'texelFetch' : no matching overloaded function
texelFetch(t, ivec2(uvec2(0u, 0u)), 0)  COMPILES
```

So `textureLoad(t, vec2u(...), 0)` compiled clean here and failed on WebGL2. An unsigned
coordinate is now wrapped in the signed constructor of the texture's own width. A signed
coordinate — what every existing program writes — emits exactly the bytes it always did.

### A const-expression as the gather component

WGSL asks for a const-expression, not a literal, so a module constant is one:

```ts
const CHANNEL = 1;
const four = textureGather(CHANNEL, atlas, smp, uv);
```

That was `must be … written in the call`. A LOCAL is still refused: its value is not known until
the shader runs.

### A mip level, except where there are none

`textureDimensions(t, level)` is the two-argument form WGSL has for a sampled or a depth
texture, and it was an arity error here while the GLSL column had spelled
`textureSize(t, int(level))` all along. A STORAGE texture does not get it, and that is measured
rather than reasoned:

| spelling | WGSL (Tint) |
| --- | --- |
| `textureDimensions(t: texture_2d<f32>, 0u)` | accepts |
| `textureDimensions(t: texture_2d<f32>, <runtime u32>)` | accepts |
| `textureDimensions(t: texture_depth_2d, 0u)` | accepts |
| `textureDimensions(t: texture_storage_2d<r32float, read>, 0u)` | **"no matching call"**, 33 candidates |
| `textureDimensions(t: texture_multisampled_2d<f32>, 0u)` | **"no matching call"**, 33 candidates |

A storage texture and a multisampled one have exactly one level, so there is no level to ask
for, and the extra argument is refused where it is written rather than emitted for Tint to
reject.

### The storage format that is not core

The format list is the set a device stores to with NOTHING requested, because a format outside
it compiles on Tint and then fails when the host builds the bind group — a wrong program with
no diagnostic anywhere. `bgra8unorm` is the seventeenth entry and the first that is not core.
Measured on two independent Chromium builds, asking a real device for a bind group layout at
each access mode:

| device | `bgra8unorm` at `write` | at `read` | at `read_write` |
| --- | --- | --- | --- |
| nothing requested | **refused** | refused | refused |
| requested `bgra8unorm-storage` | accepts | **refused** | **refused** |

Tint compiles every one of those spellings, so neither a shader compiler nor the compile gate
can tell them apart. So the format is authorable at `write`, refused at the other two with the
reason that is about this format, and a module using it derives the `bgra8unormStorage`
capability from the binding's own format:

```ts
declare const dst: texture_storage_2d<"bgra8unorm", "write">;
// reflect(m).requiredFeatures includes 'bgra8unormStorage'
// hostFeaturesFor(wgslBackend, …) turns that into 'bgra8unorm-storage'
```

The TIERED texture formats — `r8unorm`, `rg8unorm`, `rgb10a2unorm`, `rg16float` and their
siblings — are still absent, and that is a measurement too: no adapter reachable from this
repository reports `texture-formats-tier1`, both Chromium builds refuse every one of them at
every access mode even with every adapter feature requested, and three of the names
(`r16snorm`, `rg16snorm`, `rgba16snorm`) are not valid enum members there at all. `read_write`
beyond `r32uint`, `r32sint` and `r32float` is in the same position: every format was refused on
both builds with every adapter feature enabled. Adding either from the specification's word
alone is exactly the mistake this list exists to prevent, so they wait for a device that can
answer.

### A WGSL language feature is not a device feature

A language feature is a property of the shading language rather than of the device: it is not
requested at `requestDevice`, it is either present in the browser's WGSL implementation or not.
`reflect()` reports the ones the module's source uses:

```ts
for (const f of reflect(m).requiredLanguageFeatures) {
  if (!navigator.gpu.wgslLanguageFeatures.has(f)) throw new Error(`WGSL lacks ${f}`);
}
```

Here that is `readonly_and_readwrite_storage_textures`, reported when the module binds a
storage texture at `"read"` or `"read_write"`; a `"write"` one is core and needs nothing.
Measured on Chromium: `navigator.gpu.wgslLanguageFeatures` reports the name, the module
compiles with and without a `requires` directive, and a `requires` naming a feature the browser
lacks is refused — so the check belongs at the host, before the module is built. This item
emitted no directive; §50 later made the WGSL writer lead with
`requires readonly_and_readwrite_storage_textures;` for such a binding, and §47 adds a second
row, `packed_4x8_integer_dot_product`, which is reported and not emitted.

### What the editor says

The ambient declarations now describe what the compiler lowers, and no more. `E` is constrained
to `f32`, `i32` and `u32`, so `texture_2d<bool>` is red in the editor as it always was in the
compiler; `textureLoad` is typed by the texture's element, so a fetch from a `texture_2d<u32>`
is a `vec4u` in both; every texel coordinate takes either integer vector; and `bgra8unorm` is
in the format union, admitted at `"write"` and refused at the other two by the same conditional
type that already enforced the `read_write` rule.

## 47. The packed 4x8 integer builtins

Eight builtins that read a `u32` as four bytes, or write four back (wgsl.txt:21906/21920). Every
one was an unknown name on this surface:

```ts
const lit = dot4U8Packed(weights, texels); // u32: four unsigned byte products, summed
const signed = dot4I8Packed(weights, texels); // i32: four signed byte products, summed
const bytes = unpack4xU8(texels); // vec4u, the low byte into component 0
const signedBytes = unpack4xI8(texels); // vec4i, each byte SIGN-EXTENDED
const packed = pack4xU8(bytes); // u32, each component TRUNCATED to its low byte
const saturated = pack4xU8Clamp(bytes); // u32, each component clamped into [0, 255] first
const packedI = pack4xI8(signedBytes); // u32 too, truncated
const saturatedI = pack4xI8Clamp(signedBytes); // u32 too, clamped into [-128, 127] first
```

The values are not read off the specification. Each call was DISPATCHED on a real device through
the compile gate's own instruments and the buffer read back, and the CPU oracle was written to
those numbers:

| call | the device wrote |
| --- | --- |
| `dot4U8Packed(0x01010101, 0x01010101)` | `4` |
| `dot4U8Packed(0xFF000000, 0xFF000000)` | `65025`, which is 255 × 255 |
| `dot4I8Packed(0xFF000000, 0xFF000000)` | `1`, because 0xFF is −1 signed |
| `dot4I8Packed(0x80808080, 0x01010101)` | `-512`, which is 4 × (−128 × 1) |
| `pack4xU8(vec4u(0x1FF, 0, 0, 0))` | `0xFF` — TRUNCATED, not clamped |
| `pack4xU8Clamp(vec4u(400, 2, 3, 4))` | `0x040302FF` — 400 saturates to 255 |
| `pack4xI8Clamp(vec4i(400, -400, 3, 4))` | `0x0403807F` — 127 and −128 |
| `unpack4xI8(0x04FD02FF)` | `(-1, 2, -3, 4)` |

Every pack returns a `u32`, the SIGNED ones included: the result is four bytes in a word, not a
number with a sign (WGSL index.bs:20307, :20341). Only the unpacks and `dot4I8Packed` are
signed. Typing `pack4xI8` as an `i32` emitted WGSL Tint refuses — measured, assigning it to an
`i32` is "cannot assign 'u32' to 'i32'", and adding it to `dot4I8Packed`'s result is "no
matching overload for 'operator + (u32, i32)'".

### WGSL-only, and not an extension

GLSL ES 3.00 has no dot product of packed bytes, no byte pack and no byte unpack, so a module
using one of the eight derives the `packed4x8Dot` capability and fails closed on that target —
the WGSL half still emits, and the GLSL half is absent with the capability named, the same shape
the storage-texture rows use. `examples/packed-bytes.shade.ts` is registered `renderable: false`
for that reason, and the gate runs its Tint half alone.

On the WGSL side there is nothing to declare, and that is measured rather than assumed:

| spelling | Tint |
| --- | --- |
| the call, with nothing declared | accepts |
| `requires packed_4x8_integer_dot_product;` | accepts, changes nothing |
| `enable packed_4x8_integer_dot_product;` | **"expected extension \| Possible values: 'clip_distances', 'dual_source_blending', 'f16', 'primitive_index', 'subgroups'"** |

It is a WGSL *language* feature, not an extension: a property of the browser's implementation
rather than of the device, and not something requested at `requestDevice`. So the emitted module
carries no directive and the host checks for it before it builds the shader module:

```ts
for (const f of reflect(m).requiredLanguageFeatures) {
  if (!navigator.gpu.wgslLanguageFeatures.has(f)) throw new Error(`WGSL lacks ${f}`);
}
```

A module that declares its own function under one of the eight names keeps the call to its own
function, by the additivity rule every builtin this surface adds follows — and it then needs
neither the capability nor the language feature, because it never reaches the builtin.

## 48. Compare-exchange, the uniform load and the texture barrier

Three WGSL builtins, each an unknown name before, and all three WebGPU-only: GLSL ES 3.00 has no
compute stage, so it has no workgroup memory, no atomic compare-exchange and no barrier of any
kind. A module using one fails closed on that target.

### `atomicCompareExchangeWeak`

Stores a value only when the location holds the one you name, as one indivisible step, and
answers what the location held BEFORE the call plus whether the store happened:

```ts
const claim = atomicCompareExchangeWeak(claimed, 0, gid.x + 1);
if (claim.exchanged) {
  leader = lid.x; // this invocation won it
}
```

The result is a STRUCT, and WGSL gives it no writable name. Measured on Tint:

| spelling | Tint |
| --- | --- |
| `let r = atomicCompareExchangeWeak(&a, 1u, 2u);` | accepts |
| `r.old_value`, `r.exchanged` | accepts |
| `r.oldValue` | **"struct member oldValue not found"** |
| `var r: __atomic_compare_exchange_result<u32> = …;` | **"invalid type for variable declaration"** |
| the call with its result ignored | accepts — it is not `@must_use` |

So the fields are spelled the way the target spells them, in snake_case, the result is bound with
`const` and never annotated, and **no struct declaration is emitted**: WGSL's is built in, and
declaring one would shadow it. The type exists in the IR and in the editor and in neither
backend's output.

"Weak" names a hardware licence to fail spuriously. The CPU oracle does not exercise it — one
invocation at a time, so a comparison that holds cannot be beaten to the location — and a shader
that loops until it succeeds, which is the shape WGSL documents, is correct on a device and here.

### `workgroupUniformLoad`

One value read out of workgroup memory with a barrier on each side, so every invocation of the
workgroup gets the same one:

```ts
const agreed: u32 = workgroupUniformLoad(leader);
```

It carries a barrier's placement rules, because it *is* two barriers around a read:

| spelling | Tint |
| --- | --- |
| in a compute entry, outside any branch | accepts |
| inside an `if` | **"'workgroupUniformLoad' must only be called from uniform control flow"** |
| of a storage pointer | **"no matching call"**, both candidates workgroup pointers |
| of a `vec4`, of an array element | accepts — any shape that memory holds |

A render entry needs no rule of its own here: a workgroup variable read from one is already
refused where it is read, which is the sentence that names what the author has to move.

### `textureBarrier`

Holds every invocation of the workgroup until all have arrived, ordering their writes to the
TEXTURE address space. A statement, in a compute entry, in uniform control flow — the same two
rules `workgroupBarrier` has, and Tint states them the same way ("must only be called from
uniform control flow", "built-in cannot be used by vertex pipeline stage").

It compiles with no storage texture in sight, so nothing in the module's shape announces what it
needs. It belongs to the `readonly_and_readwrite_storage_textures` WGSL language feature, and
`reflect().requiredLanguageFeatures` is what says so — the same field a readable storage texture
reaches for.

`examples/compute-sync.shade.ts` runs all three, registered `renderable: false`.

### A reserved word is still the author's problem

The example above names its uniform load `agreed`, not `shared`, and the comment in it says why:
`shared` is a WGSL reserved keyword, and this surface does not rename an author's local to avoid
one. When this section landed, the compile gate caught `'shared' is a reserved keyword` from
Tint with no diagnostic from the compiler first — the identifier sanitiser guarded GENERATED
names only. §62 closed that gap: a local named `shared` is now `TS8068` where it is written.

## 49. The editor and the compiler agree

The ambient library is a second implementation of this surface's type rules, written in
TypeScript's vocabulary rather than the compiler's, and two implementations drift. A rule the
ambient lib states more NARROWLY than the compiler is the worse failure: red squiggles on a
program that compiles, which stops an author who was right. Eight such rows are closed:

| spelling | the editor used to say | now |
| --- | --- | --- |
| `select(a, b, c)` on bools | "Argument of type 'boolean' is not assignable to parameter of type 'Numeric'" | clean |
| `select(vec2b(…), vec2b(…), c)` | the same, about `vec2b` | clean |
| `vec3(x, v2)`, `vec4(x, v2, w)`, `vec4(x, y, v2)` | "Argument of type 'f32' is not assignable to parameter of type 'vec2'" | clean |
| `f32(true)`, `i32(true)`, `u32(true)` | "Argument of type 'boolean' is not assignable to parameter of type 'number'" | clean |
| `m[3].xyz` and `m[0] = vec4(1.)` on a `mat4`, and the same on every square matrix | "Property 'xyz' does not exist on type 'never'"; "Type 'vec4' is not assignable to type 'never'" | clean |
| `m[i]` on a `mat4` or a `mat2x3`, with `i: u32` or a `for` counter, and `m[0][1]` | "Element implicitly has an 'any' type because expression of type 'u32' can't be used to index type 'mat4<f32>'" | clean |
| `v[0]` and `v[i]` on a `vec4`, read or written | the same, on type 'vec4' | clean |
| `v.yx` on a `vec2`, `v.zyx` on a `vec4`, `c.bgra` | "Property 'yx' does not exist on type 'vec2'" | clean |

`select` takes any scalar or vector WGSL gives it, bools and emulated doubles included
(wgsl.txt:21338-21352). The vector constructors take a component vector anywhere, not only
first (20889/20987). A cast takes a `bool`, which is 1 or 0 (20207) — except `f64`, which
WIDENS an `f32` and takes nothing else. A square matrix's column is a `vecN`, as a non-square
one's always was (§40). The square aliases take their element as a type argument, `mat4<f64>`
being a matrix of emulated doubles (§39), and the argument used to be read by assignability,
under which an `f32` passes for an `f64`. So the default `mat4` was a matrix of doubles to the
editor, and a column of doubles is `never`, since the compiler refuses to index one. A vector
and an `f32` matrix take any integer index, a runtime one included, as WGSL indexes them, and the
library gave both numeric LITERAL keys only, which is the emulated double's rule (§39): they
take an index signature now, as `array<T, N>` does. A matrix of doubles still takes no runtime
index (TS7053 beside `TS8003 Cannot index mat4x4<f64>.`), and what the signature admits and the
compiler refuses is the section "An index only the compiler refuses" below. A swizzle is any pick
of one to four letters from one set, repeats and any order included (`parseSwizzle`,
`src/compiler/ts/swizzle.ts`), and the library declared the eight components and the six prefix
swizzles only (`xy`, `xyz`, `xyzw`, `rg`, `rgb`, `rgba`), so `v.yx` was red on a program that
runs; its note and the README called that a false negative. Each vector now declares every pick
the compiler takes. A pick that mixes the two sets (`v.xg`) or reaches past the vector (`v.xz` on
a `vec2`) is refused by both, the compiler's `TS8022` alone in the editor's merged list.

`src/language-service/ambient-parity.test.ts` asserts the AGREEMENT rather than either verdict,
with rows on both sides: a row where both refuse is as much the subject as one where both
accept, and a test that only checked the accepting rows would be green on an ambient lib that
had stopped saying anything at all.

### A write the editor used to allow

Drift runs the other way too, and it is quieter: a rule the ambient lib states more WIDELY than
the compiler is a program that types clean in the editor and is refused by `compile()`. A write
to a read-only resource was one. `src[0] = 1.` on a `declare const src: storage<array<f32>>`
reported nothing from TypeScript; only the compiler's `TS8005` said so, and an author reading
the editor saw a green file.

The access mode reaches the library now (§1): `storage<T>` and `uniform<T>` resolve to
`ReadView<T>`, which makes every field, lane and index signature `readonly` all the way down,
and `storage<T, "read_write">` resolves to `T` itself. So the write is TS2542 on an index and
TS2540 on a field as it is typed, and the read_write binding beside it stays clean — which is
the point, because a readonly index signature that was not per binding is exactly the false
positive this surface removed once already, when every compute kernel reported TS2542 on the
store it exists to make.

| spelling | the editor used to say | now |
| --- | --- | --- |
| `src[0] = 1.` on `storage<array<f32>>` | nothing | TS2542 |
| `camera.fov = 1.` on `uniform<Camera>` | nothing | TS2540 |
| `b.w[0] = 1.`, `xs[0].q = 1.` (one level down) | nothing | TS2542, TS2540 |
| `dst[0] = 1.` on `storage<array<f32>, "read_write">` | clean | clean |
| `storage<T, "write">` | TS2314, "requires 1 type argument" | TS2344, against the two words |

A read is untouched, which is what the view must not cost: a struct copied out of a read array,
`length(p.offset)`, `.length` on a read array, a method called on a class-typed read binding and
`array<f32, 3>` still not being an `array<f32, 2>` are all measured in
`src/language-service/ambient.test.ts`, which pins both directions. `uniform<T, "read">` is
TS2314 as it always was, because `uniform<T>` still takes one type argument; what changed there
is the compiler's own sentence beside it (§1).

### Two writes only the compiler refuses

The read view is a TYPE, so it sees writes that are typed as writes. Two are not, and the
editor is silent about both while `compile()` refuses them:

```ts
declare const bins: storage<array<atomic<u32>>>;
atomicAdd(bins[0], 1); // TS8005 from the compiler, nothing from TypeScript

class Acc { total: f32 = 0. as f32; add(x: f32): void { this.total = this.total + x; } }
declare const acc: storage<Acc>;
acc.add(1.); // TS8035 from the compiler, nothing from TypeScript
```

An `atomic<T>` is one symbol-keyed brand, and `ReadView` passes a symbol key through as it
stands: there is no property to mark `readonly`, because an atomic is written through a CALL
and not through an assignment. A method is a call signature, which no mapped type preserves,
so the view stops at the method boundary — and it has to, since `Acc.add` is declared once and
shared by a read binding and a read_write one alike. Both sentences name the declaration to
write (`Write "declare const bins: storage<array<atomic<u32>>, "read_write">" to write to
it.`), so the remedy is the same one the indexed write gets; only the layer that says it
differs. Recorded as the Appendix B row for design rule 6.2 in `docs/language-design.md`.

### An index only the compiler refuses

The index signature a vector and an `f32` matrix take admits what an array's does, and the
compiler alone refuses the rest:

| spelling | the compiler | the editor |
| --- | --- | --- |
| `m[4]` on a `mat4`, `v[4]` on a `vec4` | TS8016, "Index 4 is out of range for length 4." | the compiler's sentence alone |
| `m[j]` with `j: f32` | TS8003, "Index must be i32 or u32." | the compiler's sentence alone |

Each drew TS7053 beside the compiler's sentence while the two types took literal keys only, two
sentences for one mistake, and now draws one. Plain `tsc` has no compiler beside it and says
nothing about either, as it says nothing about `a[5]` on an `array<f32, 3>`.

### A write the editor refuses and the compiler takes

Drift the other way, which §49 calls the worse failure: red on a program that runs.

| spelling | the compiler | the editor |
| --- | --- | --- |
| `s = 1.` on `declare const s: storage<f32, "read_write">` | `var<storage, read_write> s: f32;` then `s = 1.0` | TS2588, "Cannot assign to 's' because it is a constant" |

It is the price of the keyword. A binding is `declare const` (§1), and TypeScript will
not assign to a `const` whatever its value type is: no ambient declaration can close it,
because `const` is the keyword's meaning and not the type's. It reaches only a WHOLE-binding
write — a scalar, a vector, a struct or an emulated double assigned as one — and a compute
kernel's `out[gid.x] = …` or `p.scale = …` is untouched, which is why no example and no test in
the tree met it before `remedy-lines.test.ts` pasted a remedy in and measured what was left.
The remedy it names is still the right line; the editor simply says one more thing about it.
Appendix B's row for design rule 12.7 carries it. A square matrix column, `m[0] = vec4(1.)` on
a `storage<mat4, "read_write">`, was a second row here, and it is closed: the table at the head
of this section has it.

### The second type argument, where the two layers still part

| spelling | the compiler | the editor |
| --- | --- | --- |
| `type A = "read_write"` then `storage<array<f32>, A>` | TS8002, `got A`: the mode is read off the literal type and an alias is not one, so it is recovered as read_write | clean, since `A` satisfies `StorageBufferAccess` |
| `storage<array<f32>, "read_write", "x">` | clean; a third type argument is not read | TS2707, "requires between 1 and 2 type arguments" |
| `declare let counts: storage<array<u32>>` beside `counts[gid.x] = 1` | TS8099 on the declaration alone: the binding is recovered as read_write, so the write is not a second sentence | TS8099 and TS2542 on the write, because the library reads the type as DECLARED and the recovery is the compiler's |

Each is one mistake answered twice or once too few, never a program that runs differently. The
first two follow from where the mode is read: the compiler reads a string literal type out of
the declaration, TypeScript checks an assignable constraint. The third is the cost of recovery
— a refusal that keeps the binding alive so the rest of the file still resolves cannot also
reach back into the ambient library and change the type it was declared with.

### Two compositions the editor still does not take

`vec4(x, v3)` and `vec4(v2, v2)` are real WGSL and the compiler takes both. They are
deliberately not declared, and the cost of declaring them is measured: adding a SECOND
two-argument `vec4` overload costs TypeScript the contextual type it uses to infer through
vector arithmetic. With one candidate, `vec4(mix(c * 0.5, d, 0.5), 1.)` contextually types its
first argument `vec3` and `mix` infers `vec3`; with two, that context is gone, `mix` infers from
the `number` the arithmetic erased `c * 0.5` to, and the call reports TS2769 on a program that
compiles.

`vec4(c * 0.5, 1.)` is a far more common spelling than either of the two, so the editor is
better off without them until the #43 arithmetic filter can restore a shape through a NESTED
call. Both are pinned as `it.fails` so the day that changes is a deliberate edit.

### A binding still needs a named type

```ts
interface P { m: mat4 }
declare const U: uniform<P>; // fine
declare const V: uniform<{ m: mat4 }>; // Unsupported type syntax "{ m: mat4 }"
```

Both layers refuse the literal, so nothing disagrees — but the refusal is a gap rather than a
rule. Accepting it means synthesising an anonymous struct: a name, a place in the module's
structs, a layout. That is a compiler feature and not an editor-parity fix, and it is pinned
here as it stands so both layers move together the day it lands.

### The type the editor gives an expression

Agreeing on which programs are valid is half of this section. The other half is the TYPE each
expression has. The front end gives every expression it lowers a type, and the editor's checker
gives the same expression a type of its own from the ambient library. Because the scalar brands
are optional, a declaration that says `number` where the compiler means `u32` draws no error in
either layer. It shows only in what an author reads: a hover, a completion list, signature help.
`src.length` on a runtime-sized storage array was one: the compiler reads it as `arrayLength(&src)`,
a `u32` (§20), and the editor said `number` until #271.

The front end now records the type of every expression it lowers
(`CompileTsSourceResult.expressions`). `src/language-service/expression-parity.test.ts` compares
that type with the checker's on every program under `examples/` and `journeys/`. What it
reports is the first divergence: a property access, an element access or a call whose receiver
and arguments agree, but whose own type does not. The divergences still open are listed in the
test's own table, which is the one list of them, by what each reads and the two types. The table
is shrink-only: a divergence it does not list fails, and so does a row that no longer occurs.
Proposal 0015 names the three classes the table holds today: a builtin's result (`dot`, `length`,
`smoothstep`, `max` on a `u32`, …), an unannotated scalar a document declares, and a constructor
or method that loses a type argument (`array(...)`, `.map`).

## 50. `enable`, `requires`, and the built-in values behind an extension

WGSL turns a language extension on with a module-scope `enable f16;` and names a *language*
extension with `requires <feature>;` — two different axes, and neither had an author spelling.

**Some built-in values derive their own `enable`.** `@builtin("clip_distances")` is a
shader-creation error without `enable clip_distances;` — Tint says `use of
'@builtin(clip_distances)' requires enabling extension 'clip_distances'` — so writing the id is
the whole declaration. The compiler emits the directive, `reflect().requiredFeatures` grows the
neutral capability, and `hostFeaturesFor(wgslBackend, …)` turns it into what the host requests
at `requestDevice`.

```ts
"use typeshade";

class VsOut {
  @builtin("position") pos: vec4;
  @builtin("clip_distances") cd: array<f32, 4>; // vertex OUTPUT only, N from 1 to 8
}

@fragment
export function fs(@builtin("primitive_index") pi: u32): vec4 { // fragment INPUT only
  return vec4(f32(pi), 0., 0., 1.);
}
```

| id | stage and direction | type | capability · directive · host feature |
| --- | --- | --- | --- |
| `clip_distances` | vertex output | `array<f32, N>`, 1 ≤ N ≤ 8 | `clipDistances` · `enable clip_distances;` · `clip-distances` |
| `primitive_index` | fragment input | `u32` | `primitiveIndex` · `enable primitive_index;` · `primitive-index` |
| `subgroup_invocation_id` | compute **or fragment** input | `u32` | `subgroups` · `enable subgroups;` · `subgroups` |
| `subgroup_size` | compute **or fragment** input | `u32` | `subgroups` · `enable subgroups;` · `subgroups` |

`@blend_src(0|1)` on a fragment output derives `dualSourceBlending` the same way (§53).

`clip_distances` used to be admitted with no stage rule and no size rule at all: it sat on a
fragment input and emitted WGSL Tint refused. Each row's stage, direction and type is now
checked at the authoring line. The subgroup pair read as compute-only, which refused a legal
fragment program; both stages are accepted.

**Each of the four fails closed on GLSL ES 3.00.** That target has no row for any of these
capabilities, so `emitGlslModule` throws `SD0030` naming it rather than emitting a varying a
WebGL2 driver would reinterpret.

**The author spelling for the rest: a string directive beside `"use typeshade"`.** An
extension no use in the file derives is turned on by the file itself. `f16` is the one no use can
derive, since its type is not on this surface yet (Rule 4.7). `subgroups` is derived by
`subgroup_invocation_id` and `subgroup_size` (the table above), and the directive turns it on for
a file that reads neither; the subgroup built-in functions (`subgroupAdd` and the rest) are not
on this surface, so those two values are the only use there is to derive it from:

```ts
"use typeshade";
"enable subgroups";
```

One extension per directive, WGSL's own name. The vocabulary is the WGSL backend's capability
profile, so it is exactly the list the writer can emit a directive for: `clip_distances`,
`dual_source_blending`, `f16`, `primitive_index`, `subgroups`. A misspelled name is `TS8050`
naming them, and enables nothing — a typo does not also fail the module closed on a capability
it never asked for. A file with no directive emits the same bytes it always did.

**The `requires` axis.** A WGSL *language* extension changes what the text may say and is
checked by the host against `navigator.gpu.wgslLanguageFeatures`, not requested at
`requestDevice`. `reflect().requiredLanguageFeatures` reports it and the WGSL writer emits the
directive. One row is emitted today: a storage texture bound `read` or `read_write` needs
`readonly_and_readwrite_storage_textures`, since core WGSL gives a storage texture `write` only
(`textureBarrier` reports the same row, §48). The packed 4x8 builtins' feature,
`packed_4x8_integer_dot_product`, is reported and carries no directive (§47).

```wgsl
requires readonly_and_readwrite_storage_textures;

@group(0) @binding(0) var acc: texture_storage_2d<r32float, read_write>;
```

**What this deliberately does not reach.** Three rows were settled by measurement against the
Tint of the Chromium the compile gate runs (2026-09-21):

- `@builtin("global_invocation_index")` and `@builtin("workgroup_index")` are in the WGSL text
  and in neither Tint's builtin vocabulary: the module dies with `expected builtin value name`,
  whose own "possible values" list omits both. Admitting them would move the failure further
  from the author, not closer.
- `@builtin("frag_depth", "less")`, the conservative-depth mode, is refused at the comma:
  `expected ')' for builtin attribute`. There is nothing to lower it to.
- `requires uniform_buffer_standard_layout;` is refused by Chromium 141
  (`chromium_headless_shell-1194`) with `feature 'uniform_buffer_standard_layout' is not
  supported`, and accepted by Chromium 153, which lists the feature. Either way nothing this
  compiler emits asks for it, and that is the point: a `requires` naming a feature an
  implementation lacks is itself a shader-creation error, so emitting it could only NARROW
  where a module runs. §51 pads the uniform array instead, which needs nothing of the device.

And four by design, with no measurement to take:

- One more WGSL name still has no capability of its own: `atomic_vec2u_min_max` waits on
  `atomic<vec2<u32>>`, an After-1.0 row, an extension whose whole surface is a feature this
  compiler cannot spell yet, so a capability for it would gate nothing.
  (`dual_source_blending` was another; §53 gives it one, derived from `@blend_src`. And
  `packed_4x8_integer_dot_product` was listed here as a third until §47 measured it to be a
  language feature rather than an extension — Tint refuses `enable` on it — and gave its eight
  builtins the derived `packed4x8Dot` capability.)
- `var<immediate>`, `const_assert` and `@must_use` on a user function have no spelling here.
  The first two have no TypeScript shape to hang on; `@must_use` is an emit decision the
  writer makes, not an author one.
- The `diagnostic(...)` directive is not written by hand. It is emitted where a rule this
  compiler analyses asks for it, which is the uniformity item, not a free-form author control:
  the author writes `@diagnostic("off", "derivative_uniformity")` on an entry (§54).
- Four declarable capabilities — `floatRenderTarget`, `float32Blend`, `float32Filterable` and
  `multiview` — are still unspellable from a `"use typeshade"` source. (`capabilityMatrix`
  reports nine of its eighteen rows `declarable`; the other five are the extensions above.) `"enable ..."` takes the
  WGSL extension names, and none of those four is one: three are activated by the host at
  `requestDevice` or `gl.getExtension` and cost the shader no token at all, and the fourth is a
  GLSL `#extension`. A module that needs one is assembled with `module({ enables: [...] })`.

**What a host must actually do, and what the gate does.** An extension-gated id costs a device
feature, and a device only has one if it was asked for. `requestDevice()` with no
`requiredFeatures` gives a device with none, and Tint then answers `extension 'clip_distances'
is not allowed in the current environment` — which reads like a bad emit and is not one. So
`scripts/compile-gate.ts` derives the features the corpus needs from the modules themselves
(`hostFeaturesFor(wgslBackend, reflect(m).requiredFeatures)`), requests the ones the adapter
has, and prints any it lacks rather than dropping them silently.
`examples/clip-planes.shade.ts` is the evidence: it compiles on the gate's real Tint, on a
device that was asked for `clip-distances`.

`primitive_index` has no registered example, because `primitive-index` is not among that
adapter's features at all (measured: it offers `clip-distances` and `subgroups`, not this).
Its emit is pinned by `src/compiler/ts/builtin-values.test.ts` instead, and its `hostFeature`
string is the one value in §50 that no measurement here could confirm.

## 51. What a uniform lays out: the 16-byte array rule, and the shapes a struct hides

A `uniform` buffer is the one place WGSL changes the bytes under you, and it used to change
them behind the compiler's back.

**Every array element in a uniform starts on a 16-byte boundary.** So `array<f32, 4>` is not
sixteen bytes, it is sixty-four. That is core WGSL, and an implementation that does not offer
the optional `uniform_buffer_standard_layout` language feature refuses a module that says
otherwise — measured on Chromium 141 (`chromium_headless_shell-1194`):

```
'uniform' storage requires that array elements are aligned to 16 bytes, but array element of
type 'f32' has a stride of 4 bytes. Consider using a vector or struct as the element type
instead.
```

**Mind which implementation you measured.** Chromium 153, which is what `bun run gate:compile`
launches when `TYPESHADE_CHROMIUM` is unset (and what CI installs), lists
`uniform_buffer_standard_layout` in `navigator.gpu.wgslLanguageFeatures` and **accepts** the
unpadded module. So "every driver refuses this" is not the argument. Two things that hold on
both builds are:

- the emit and `reflect()` describe the same bytes, which they did not before; and
- the module runs on an implementation without the relaxation, which core WGSL allows there to
  be.

A consequence worth stating plainly: on the newer build the compile gate cannot tell a padded
emit from an unpadded one, so the gate is not what pins this. The unit tests are.

The compiler emits the padding itself. A wrapper struct carries `@size(16)` and the reads are
rewritten one field deeper:

```ts
"use typeshade";

class Palette {
  count: f32;               // a scalar BEFORE the list, which is where @align earns its keep
  weights: array<f32, 4>;   // four floats in the source
  stops: array<vec4, 2>;    // already 16 bytes an element — untouched
}
declare const U: uniform<Palette>;
```

```wgsl
struct _Pad16_f32 {
  @size(16) v: f32,
}

struct Palette {
  count: f32,
  @align(16) weights: array<_Pad16_f32, 4>,
  stops: array<vec4<f32>, 2>,
}

…  U.weights[i].v
```

**Two attributes, fixing two different things.** `@size(16)` inside the wrapper is the element
STRIDE. `@align(16)` on the member is the array's OFFSET, and the wrapper cannot supply it: a
struct's alignment comes from its members, and `@size` does not raise it. With the stride
alone, `count` before `weights` puts the array at offset 4 rather than 16 — and 4 is the
offset `reflect()` does not report, which is the whole bug in one line. On Chromium 141 that
is also a hard error:

```
the offset of a struct member of type 'array<_Pad16_f32, 3>' in address space 'uniform' must
be a multiple of 16 bytes, but 'xs' is currently at offset 4. Consider setting '@align(16)' on
this member
```

On the same build, `@align(16) @size(64)` on the member of a BARE `array<f32, 4>` is refused
with the stride text, because the stride rule is on the element and no member attribute reaches
it; the wrapper supplies the stride and the member attribute the offset, and together they are
accepted. `array<vec2, N>` is padded too (a `vec2` is eight bytes); `array<vec4, N>` and
`array<mat4, N>` are not, because their stride is already a multiple of 16.

**The emit and `reflect()` now describe the same memory.** `reflect()` has always reported a
uniform array under std140's 16-byte stride; it was the emit that disagreed, which is exactly
the class of bug a host discovers as garbled uniforms. For the struct above,
For `interface U { k: f32; xs: array<f32, 3> }`, `reflect().uniforms[0]` reads `k` at 0 and
`xs` at 16, total 64 — and Tint's own layout note for the emitted struct reads `offset(0) k :
f32`, `offset(16) xs : array<_Pad16_f32, 3>`, total 64. Nine shapes were checked that way by
hand against Chromium 141, including an array of structs that hold arrays, a struct element
whose own stride is 8, a `vec2` array between a scalar and a `vec3`, a `u32` array before a
`mat4`, and a nested struct holding a padded array. Every offset and every struct size agrees.
Those were hand measurements, not a pinned gate: what the suite pins is the emitted text and
`reflect()`, in `src/compiler/ts/uniform-layout.test.ts`, which runs in Node and launches no
browser.

The one number that is NOT the WGSL `SizeOf` is `reflect().uniforms[].size`: it is the std140
size, which rounds the struct up to 16, while WGSL's own `SizeOf` may be smaller. A host that
allocates `size` bytes is always correct — it over-allocates at worst — and every OFFSET, which
is what a packer actually writes against, agrees exactly. `examples/emit-reflection-conformance.test.ts`
sweeps both corpora for a uniform-reachable array that reaches WGSL with a stride under 16.

**GLSL ES 3.00 needs none of it.** A std140 block gives `float[4]` a 16-byte stride natively,
which is precisely why the unpadded program links on WebGL2 and dies on WebGPU. The padding is
a WGSL-only lowering; the GLSL text is unchanged, and one host packing feeds both.
`examples/uniform-array.shade.ts` runs on both halves of the gate.

**A padded array used as a VALUE is rebuilt, not leaked.** The member's element type changed,
so `const w = U.weights` would hand a local the wrapper type and `w[1] * k` would multiply a
struct by an f32 — Tint: `no matching overload for 'operator * (_Pad16_f32, f32)'`. Wherever
the array is read whole rather than indexed — a local, a call argument, a return, a struct
built by value — the authored array is rebuilt from its elements,
`array<f32, 4>(U.weights[0].v, …)`, which costs the loads the copy was going to do anyway.
Writing such an array whole is refused: a constructor is not something to assign to, and a
uniform is read-only, so the only way to reach that shape is a local of a uniform struct's
type.

**Three shapes are refused rather than emitted**, each because nothing here could emit the
bytes `reflect()` reports for it:

| Written | Why |
| --- | --- |
| `array<array<f32, 2>, 3>` in a uniform | Two levels need the 16-byte element rule and there is one member to carry `@align`. Use a list of a struct, or of a `vec4`. |
| `uniform<array<f32, 4>>` — a bare list as the whole binding | No member to carry `@align(16)`, and `reflect().uniforms` describes nothing for it. Wrap it in a struct. |
| one struct bound as `uniform<S>` AND `storage<S>` | The two address spaces lay the same array out differently (std430 keeps the natural stride), so padding it for one corrupts the other. Declare one struct per address space. |

A list of `vec4` is exempt from all three — its stride is already 16 — which is what keeps them
from reading as a blanket ban on lists.

**`@size` and `@align` are still not author attributes.** `@align` on a field is `TS8010` and
`@size` is an unknown attribute, as before. Applying them would mean teaching the layout engine
`reflect()` shares with the GLSL writer to read them, and an attribute the emit honoured while
reflection ignored it is the very disagreement this section closes. They stay refused until
both halves move together.

**Three shapes a struct used to hide.** The type map sees a field's type; it does not see which
address space the field ends up in, so these reached the backend as text a driver refuses:

| Written | Refused with |
| --- | --- |
| `interface U { flag: bool }` in a `uniform` or `storage` | `TS8051` — `"U.flag" is a bool; a uniform struct holds numeric scalars only (WGSL's host-shareable rule). Use u32.` |
| `interface S { xs: array<f32>; k: f32 }` | `TS8051` — a runtime-sized list that is not the last field, so nothing after it has an offset |
| `uniform<array<f32>>` | `TS8051` — a uniform buffer has one size; give the list a length or declare it `storage<T>` |

Beside them, and not an address-space rule at all: `array<T, 0>` (and a negative or fractional
length) is refused at the type as `TS8002`, wherever it is written. A list of no elements has
no use and every index into it is out of range.

`bool` is the one worth dwelling on: Tint says `type 'bool' cannot be used in address space
'uniform' as it is non-host-shareable`, while the GLSL writer emitted it into the std140 block
without complaint. That is a silent divergence between the two targets, not a shared failure,
and silent divergence is what this compiler exists to remove. A `bool` local, parameter or
return is untouched — the rule is about host-shared bytes.

## 52. Operators, switch and statements: what WGSL spells, and what it does not

**A shift amount is a `u32`, whatever it shifts.** WGSL's only scalar overload is `e1 << e2`
with `e2: u32`. The compound path had always known this; the binary path had not, so
`x << n` with an `i32` `n` emitted `(x << n)` — `no matching overload for 'operator << (i32,
i32)'` on Tint — while `x << 1u`, the one spelling Tint accepts, was refused here by the
equal-types rule. Both paths now agree:

```ts
"use typeshade";

export function f(x: i32, n: i32, u: u32): i32 {
  const a = x << n;        // WGSL (x << u32(n))
  const b = x >> u;         // WGSL (x >> u), no cast needed
  const c = x << 3;         // WGSL (x << 3u), the literal retyped rather than wrapped
  return a + b + c;
}
```

GLSL ES 3.00 carries the same cast, as `uint(n)`. Its §5.9 lets a shift's two operands have
different kinds, so the cast is legal rather than required there — the IR is one tree and both
writers read it, which is how the compound path has always behaved. `&`, `|` and `^` keep the
equal-types rule: there both operands must be one type on both targets. The 0..31 bound on a
literal amount is unchanged.

A shift is componentwise, so the kind rule reads the **element**: `vec2u << vec2u` is two lanes
shifted, not a type error, and a `vec2i` amount takes the same conversion the scalar gets, one
lane wider (`x << vec2<u32>(n)`). Measured on Chromium 141 (`chromium_headless_shell-1194`),
with the broken-shader instrument check passing on both compilers first:

| Written | Tint | ANGLE |
| --- | --- | --- |
| `vec2<u32> << vec2<u32>` | accepted | accepted |
| `vec2<i32> << vec2<u32>` (the conversion this inserts) | accepted | accepted |
| `vec2<i32> << vec2<i32>` (unconverted) | `no matching overload for 'operator << (vec2<i32>, vec2<i32>)'` | accepted |
| `vec2<u32> << u32` (scalar broadcast) | `no matching overload for 'operator << (vec2<u32>, u32)'` | accepted |

So the conversion is load-bearing, and the scalar broadcast — which GLSL ES 3.00 §5.9 takes and
WGSL has no overload for — is refused here rather than emitted, with the splat named in the
message (`x << vec2u(n)`).

One limit, recorded rather than worked around: a lane-wise shift is not expressible in a
`"use typeshade"` file that `tsc` checks. TypeScript's own `<<` yields `number` whatever its
operands are, and a vector type is a branded object, so `const lanes: vec2u = x << n` is
TS2322 under the ambient lib before the compiler ever sees it. The rule lives in the lowering
so the IR path stays correct and so `&`, `|`, `^` and the scalar shifts keep one kind rule
between them; there is no gate example, because no `.shade.ts` can carry one.

**`~`, unary `+`, and the minus WGSL does not have.**

| Written | Result |
| --- | --- |
| `~x` on an `i32` or `u32` | `~x` on both targets. Its value differs by kind, and the CPU oracle routes it by the static kind as it does the other bit builtins: `~5` is `-6` on an `i32` and `4294967290` on a `u32`. |
| `+x` on a number | `x`. The identity both targets give it, emitting nothing. |
| `-u` on a `u32` | Refused. WGSL defines unary `-` for the signed and float kinds only, and `(-u)` is `no matching overload for 'operator - (u32)'`. The message names both fixes at the operand's own width: `0u - x` / `i32(x)` for a scalar, `vec4u(0u) - x` / `vec4i(x)` for a `vec4u`. |
| `~x` on an `f32`, `+b` on a `bool` | Refused, naming the kinds each takes. |

**One switch clause, several selectors.** TypeScript spells "two labels, one body" as an empty
clause above a full one, and the compiler used to refuse that shape as
`switch case fall-through is not allowed` — the one shape that is *not* fall-through, since
an empty clause has nothing to fall through (a body that does fall through is refused, §14):

```ts
"use typeshade";

export function tier(k: i32): i32 {
  switch (k) {
    case 0:
    case 1: return 10;   // WGSL `case 0, 1: {`   ·   GLSL `case 0: case 1: {`
    case 2: return 20;
    default: return 99;
  }
}
```

The IR carries the selector list, so both CPU engines match on membership.

Three shapes stay refused, and two of them were silent miscompiles.

A **trailing** empty clause has nothing below it to share, and neither target has a label with
no body.

An empty clause above **`default:`** has a body below it, but not one it may join: this
compiler does not put `default` into a selector list (WGSL's grammar would take
`case 1, default:`), so the selector has nowhere to go — and carrying it past the default is
what this refusal exists to stop.
`case 1: default: r = 10.; break; case 2: r = 20.; break;` lowered to `case 1, 2: { r = 20.0; }`
with `default: { r = 10.0; }` beside it, so `f(1)` was 20 on both GPUs and in the oracle where
TypeScript says 10 — with no diagnostic. It now reads:

```
switch case 1 sits above "default:" with no body of its own. A case that should do what the
default does needs its own body; WGSL has no form for sharing the default's.
```

And the mirror image: an **empty `default:` with a clause after it**. TypeScript falls it
through into that clause; both targets run nothing. `default: case 2: return 0;` emitted
`default: { }`, so a selector that matched nothing else left the switch where TypeScript
returns 0. An empty `default:` as the *last* clause does nothing in either language, so it
stays legal.

**A parameter is a value.** `a = 1.` emitted `a = 1.0;`, which Tint refuses with `cannot assign
to parameter 'a'` / `parameters are immutable`; the docs called it a bug the compiler did not
catch. It is caught now, and the message names the line to add:

```
Cannot assign to "a" — a parameter is a value, not a variable. Copy it into a local first:
"let a_ = a;", then write that.
```

It is *not* shadowed by `var a = a;`, which is what the obvious fix would be. Measured on the
same Tint, that is `redeclaration of 'a'`: a WGSL function's parameters and its top-level
locals share one scope. A shadow would therefore have to rename the local, changing the
identifier the author wrote and a debugger shows, to save one line — so the line is asked for
instead. A write *through* a parameter (`p.x = 1.`) keeps the message it already had.

Every spelling that writes one reaches the rule, not just `a = v`: `a++`, `++a`, `a--` and a
`for` whose update is `a += k` all built their own write target and so emitted `a = (a + 1);`
past it. One function raises it, so the three sites cannot drift apart again.

**Three more that now say what is wrong.**

- Calling an entry point is refused. WGSL says an entry point may not be called; the pipeline
  invokes it. The fix is to move the body into a plain function both call.
- `_ = f()` is WGSL's phony assignment: call it, drop the result. It read as `Cannot assign to
  unknown name "_"`. There is no second meaning for it to have — §62's reserved-name rule
  refuses a local named `_`, because it is WGSL's phony target and not an identifier — and
  `_ = 1.` (not a call) is still refused. What it buys is that
  the **line** is accepted: a pure call whose result is dropped is then removed outright by the
  optimizer, and one that writes emits as the bare call `g(1.0);`, since WGSL takes a user
  function's dropped result without the phony — which `emit.ts` reserves for a `@must_use`
  builtin.
- A decimal literal past the f32 range is refused. `1e40` reached the writer, which printed
  `1e+40` — a value no f32 holds, so the shader ran on a number nobody wrote.

**What this deliberately does not reach.**

- **`do … while`.** Not "it has no header": `while (c)` has no header either and is accepted,
  reading its bound from the **condition**. The reason is the loop node. The IR has exactly one
  loop, a top-tested `for`, and a `do … while` runs its body once before the first test, which
  that shape cannot express. Both targets could carry it — WGSL spells it
  `loop { body; break if !(c); }` (wgsl.txt:11554, 11872-11878) and GLSL ES 3.00 has
  `do … while` outright — so what is missing is a bottom-tested `Stmt` kind through all three
  backends and the trip-count analysis. A recorded deferral with a target-independent reason,
  refused with the `while` form to use rather than the catch-all "Unsupported statement".
- **A labelled `break` or `continue`.** Neither target has a label, so `outer:` has nothing to
  name it for. Refused with the two restructurings that work.
- **`==` and `>>>`** keep the refusals they had (§28). `===` is the equality both targets have,
  and WGSL has no unsigned right shift.

## 53. Entry IO: the interpolation an integer varying has no choice about

**An integer varying is `flat`, and the two writers used to disagree about that.** WGSL requires
every integral user-defined IO to carry `@interpolate(flat)` — there is no interpolation for a
`u32` — and the compiler emitted `@location(0) id: u32,` bare. The GLSL writer had always added
the qualifier. So one source described two different programs, and the WGSL half was one Tint
refuses. Measured on Chromium 141 (`chromium_headless_shell-1194`), with the broken-shader
instrument check passing on both compilers first:

| Written | Verdict |
| --- | --- |
| WGSL `@location(0) id: u32` on a vertex output | `integral user-defined vertex outputs must have a '@interpolate(flat)' attribute` |
| WGSL the same with `@interpolate(flat)` | accepted |
| GLSL ES 3.00 `in uint id;` | `'in' : must use 'flat' interpolation here` |
| GLSL ES 3.00 `flat in uint id;` | accepted |

The attribute is derived from the TYPE now, for a scalar and a vector alike, on both writers,
and for both spellings of a varying — a struct field and a bare entry parameter. The parameter
form is its own row: a fragment entry that takes `@location(0) id: u32` and declares no struct
reaches no struct, so rewriting the structs alone left it bare and Tint answered `integral
user-defined fragment inputs must have a '@interpolate(flat)' attribute`. A VERTEX entry's
`@location` parameters are vertex ATTRIBUTES, not varyings, and are left alone.

```ts
"use typeshade";

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) id: u32;       // WGSL @interpolate(flat) · GLSL `flat out uint id;`
  @location(1) uv: vec2;      // untouched: a float varying interpolates
}
```

`examples/id-pick.shade.ts` is the gate's evidence, compiled on Tint and on ANGLE.

**`@interpolate`, `@invariant` and `@blend_src` are attributes an author writes.** All three
parse and reach the emitted struct; `@align`, `@size`, `@offset` and `@ignore` still do not
(§2).

| Written | WGSL | GLSL ES 3.00 |
| --- | --- | --- |
| `@interpolate("flat")` | `@interpolate(flat)` | `flat` |
| `@interpolate("perspective", "centroid")` | `@interpolate(perspective, centroid)` | `smooth centroid` |
| `@interpolate("linear")`, `@interpolate(…, "sample")` | as written | **no form** — the module has no GLSL half |
| `@invariant` on `@builtin("position")` | `@invariant @builtin(position)` | `invariant gl_Position;` |
| `@blend_src(0)` / `@blend_src(1)` at one `@location` | `enable dual_source_blending;` + the attributes | **no form** — GLSL ES 3.00 has no second source |

The two "no form" rows fail the module CLOSED on GLSL rather than emitting something else:
`emitGlslModule` throws and the module simply has no GLSL text, the way a storage texture
already does. `@blend_src` derives the `dualSourceBlending` capability (§50) from the field
itself, so the directive is emitted for any module that declares one. No example carries it:
`adapter.features.has('dual-source-blending')` is false on the gate's adapter, and Tint answers
`extension 'dual_source_blending' is not allowed in the current environment` — so a gate example
would test the adapter, not the emit.

`@interpolate` belongs on a `@location` field. On a `@builtin` it is refused: a built-in value
carries its own rule, and WGSL has no interpolation to give it.

**What is refused, one sentence each.**

| Written | Why |
| --- | --- |
| `@location(0) ok: bool` | a value passed between stages is a numeric scalar or a numeric vector; `bool` is not host-shareable. Send a `u32` and compare it. |
| two members at one `@location` | each slot carries one value. The exception is a dual-source pair, where the slot is the location AND the blend source. Checked after `extends` splices a base's fields in, and across an entry's parameter list as well as a struct. |
| `@location(0) x: f32` on a `@compute` entry | a compute shader has no user IO: it reads its work from resources and the `@builtin` invocation ids. Both spellings — a bare parameter and a struct member. |
| `@builtin("vertex_index") i: f32` | each built-in value has one type, which `WGSL_BUILTIN_TYPES` holds; this one is `u32`. |
| `@interpolate("perspective")` on a `u32` varying | an integer has one interpolation and it is `flat`. Tint: `interpolation type must be 'flat' for integral user-defined IO types`, while GLSL answers from the type and emits `flat` whatever the attribute says. |
| `@blend_src(0)` with no `@blend_src(1)` | a dual-source blend mixes two colours, so both sit at the same `@location`. Stated from the spec: the gate's adapter has no `dual-source-blending` feature, so Tint refuses the directive before reaching the rule. |
| a vertex output and a fragment input that disagree at one `@location` | an interstage slot is one type, interpolated one way, on both sides. Compared in WGSL's canonical form, so `@interpolate(flat)` and `@interpolate(flat, first)` are one answer, and so are `@interpolate(perspective, center)` and no attribute at all. |

The interstage rule is the one that needed somewhere new to live. When both stages share a
struct they agree by construction; two structs — which is what an author writes when the
fragment reads a subset — let them drift, and a `vec2` output read as a `vec3` input emitted
clean WGSL and clean GLSL, with the failure arriving at pipeline creation in a message naming
neither struct nor field. It is a CORE lint rule on the IR, so every authoring surface is
covered at every emit, and the `"use typeshade"` front end runs the same function to point at
the fragment declaration. A vertex output the fragment ignores is fine: WGSL constrains only
the slots the fragment names.

## 54. Derivative uniformity: the control flow a sample may be reached under

**`textureSample` inside an `if` on a fragment input is a shader-creation error, and the
compiler had nothing to say about it.** WGSL's `derivative_uniformity` rule (wgsl.txt:17477-17482)
requires that `textureSample`, `textureSampleBias`, `textureSampleCompare` and the screen-space
derivatives be called from UNIFORM control flow — every invocation of the quad reaches the call,
or none does — because the implicit level of detail is a difference between neighbouring
invocations, and an invocation that did not run has no value to difference against. Its default
severity is `error` (wgsl.txt:1646-1648). `workgroupBarrier` has the same shape for a different
reason: a workgroup where some invocations reach the barrier and some do not waits forever.

Measured on Chromium 141 (`chromium_headless_shell-1194`) and 153
(`chromium_headless_shell-1243`, the build CI installs), IDENTICALLY on both, with the
broken-shader instrument check passing on both compilers first:

| Written | Verdict |
| --- | --- |
| `textureSample` under `if (uv.x > 0.5)` on a fragment input | `'textureSample' must only be called from uniform control flow` |
| the same with `diagnostic(off, derivative_uniformity);` at module scope | accepted |
| the same with `@diagnostic(off, derivative_uniformity)` on the entry | accepted |
| `textureSample` under `if (k > 0.5)` on a uniform buffer value | accepted |
| `textureSampleLevel` under a condition on a fragment input | accepted |
| `dpdx` under a condition on a fragment input | `'dpdx' must only be called from uniform control flow` |
| `workgroupBarrier` under a condition on a uniform buffer value | accepted |
| `workgroupBarrier` under `if (id.x > 4u)` on `local_invocation_id` | `'workgroupBarrier' must only be called from uniform control flow` |
| the same, **with** `diagnostic(off, derivative_uniformity);` in the module | still `'workgroupBarrier' must only be called from uniform control flow` |
| `if (uv.x > 1.) { return … }` above a `textureSample` | `'textureSample' must only be called from uniform control flow` |
| `if (uv.x > 1.) { discard }` above a `textureSample`, and above a `fwidth` | accepted |
| `break` out of a loop under a non-uniform condition, above a barrier | accepted |

Every one of those is reported by `createShaderModule`, not only by `createRenderPipeline` — so
the compile gate already runs Tint's own uniformity check on every example, and the acceptance
item asking for a pipeline leg rests on a premise the measurement disproves. There is nothing
to add to the gate.

Three of those rows decide as much as the first. **The filter is the derivative rule's**, so
the off switch does not silence a barrier: a barrier's requirement is not `derivative_uniformity`
and is not filterable, and silencing it here would hand an author a module that fails at
`createShaderModule` instead of at the line. **A `return` under a non-uniform condition makes
everything after it non-uniform** — those invocations are gone. **A `discard` does not**: the
invocation is demoted to a helper rather than ended, so it goes on contributing the neighbour a
derivative differences against, which is why `discard` beside `fwidth` is the ordinary
antialiased-cutout idiom and `examples/cutout.shade.ts` compiles.

**What the compiler says now.** The call is refused at the call, naming the value the control
flow depends on and the three ways out:

```
textureSample() is reached under "VsOut.uv" (a fragment input at @location(0)), which WGSL's
derivative_uniformity rule refuses: the implicit level of detail is a difference between
neighbouring invocations, and one that did not run has no value to difference against. Hoist
the call above the branch, or use textureSampleLevel or textureSampleGrad, whose level of
detail is the one you wrote, or write @diagnostic("off", "derivative_uniformity") on the entry
to take the module as written.
```

**The analysis is three-valued, and that is the design, not a hedge.** A value is `uniform`,
`non-uniform`, or `unknown`, and the two callers want opposite answers from the same walk:

- A **derivative** is refused only when its control flow is DEFINITELY non-uniform. Anything
  the walk cannot follow — a helper's parameters, a storage read whose index it does not track
  — stays `unknown` and goes through to Tint, which owns the complete rule. A false positive
  here would refuse a program both targets run.
- A **barrier** is accepted only when its control flow is DEFINITELY uniform. The rule it
  replaces refused every `if` and `switch` outright, so `unknown` keeps that refusal and the
  relaxation can only ever admit a condition the walk has proven uniform.

The seeds are the spec's (wgsl.txt:17870-17883): `workgroup_id`, `num_workgroups`,
`subgroup_size` and `num_subgroups` are uniform, a `uniform` buffer is uniform, a module or
`override` constant is uniform, and every other built-in value and user input varies by
invocation. A call into a USER function is **at least `unknown`, and at most as uniform as the
arguments its RESULT DEPENDS ON**. Both halves are load-bearing, and each was the wrong answer
on its own:

- Never `uniform`, whatever the arguments say, because the body can read a module `var`, a
  storage buffer or a built-in value the walk never sees — so reading the arguments alone would
  PROVE uniform a call that is not one, and that proof is what the barrier rule rests on.
- Never *more* uniform than the arguments that reach the result. A bare `unknown` laundered a
  definitely non-uniform value, so a one-line
  `function edge(x: f32): bool { return x > 0.5 }` put `if (edge(v.uv.x)) { textureSample(…) }`
  straight past the walk while the same condition written inline was refused. A helper is not a
  policy boundary.
- But no *less* uniform than those either, which is why it is the arguments the result depends
  on and not all of them. `function lightingMode(uv: vec2, mode: f32): bool { return mode > 0.5 }`
  answers from `mode`; `uv` is handed over and never reaches the value. Joining every argument
  refused `if (lightingMode(v.uv, k)) { textureSample(…) }` on a uniform `k`, which Tint
  accepts.

So the call-graph fixpoint computes a **summary** per function — the parameter positions its
return value depends on — and a call site joins the arguments at those positions and no others.
Data *and* control dependence count: `function pick(x: f32, y: f32) { if (x > 0.5) { return 1. }
return y }` returns a value that differs by `x` though no `return` mentions it, so a `return`
carries the parameters of every condition it sits under. The summary is transitive, so
`outer(p, q) { return inner(q, p) }` depends on `q` alone when `inner`'s result depends on its
first parameter alone. A callee with no summary — an extern, a name the walk cannot resolve —
contributes every argument, which is the conservative floor.

It is **flow-sensitive**, which is what makes both thresholds true rather than merely stated.
The environment is threaded in statement order and merged at each branch's join:

<!-- doc-snippets: skip — the first half is REFUSED on purpose, so it cannot be a unit that compiles; both halves are pinned by src/core/passes/uniformity.test.ts. -->

```ts
const edge = v.uv.x > 0.5;
if (edge) { return textureSample(t, s, v.uv); }   // refused, naming VsOut.uv — the root, not the name

let g: f32 = v.uv.x;
g = 0.25;
if (g > 0.5) { return textureSample(t, s, v.uv); }   // accepted: order decides, and so does Tint
```

An earlier version joined every write to a name regardless of order, and was wrong in both
directions at once: it refused the second program, which Tint accepts, and a copy chain three
deep (`a = b; b = c; c = f32(lid.x)`) settled at `uniform` for a name that is not, so a barrier
under it was admitted though Tint refuses it. A loop body is iterated to a fixpoint, so a value
carried round the loop is seen however long the chain is.

It is **interprocedural**, for the same reason: a barrier at a helper's top level is uniform
only if every call of that helper is. The walk runs to a fixpoint over the call graph, and each
call site contributes two things to its callee — the control flow it is reached under, and the
class of each ARGUMENT, joined per parameter position. Entries start uniform. A helper nothing
calls starts uniform too, on its own terms, because there is no caller to claim anything wrong
about: WGSL analyses such a function by itself, and a pessimistic seed refused a barrier at the
top level of a helper-only module under no branch at all, with no spelling that got it through.

The argument half is what makes the walk read a helper as its callers use it:

<!-- doc-snippets: skip — the first half is REFUSED on purpose, so it cannot be a unit that compiles; both halves are pinned by src/core/passes/uniformity.test.ts. -->

```ts
export function shade(x: f32, uv: vec2): vec4 {
  if (x > 0.5) { return textureSample(t, s, uv); }   // refused when x was handed v.uv.x
  return vec4(0., 0., 0., 1.);
}
// shade(v.uv.x, v.uv)  → refused, naming VsOut.uv
// shade(k, v.uv)       → accepted, and Tint accepts it too
```

Seeding every helper parameter `unknown` regardless of what it was handed let the first of
those through while Tint refused it — the same hole as the helper CONDITION above, read from
the other end. A parameter no call site reached stays `unknown`, which is what leaves a
helper-only module exactly as it was.

**Where a value is read from decides, not what was written into it.** WGSL's rule is per
ADDRESS SPACE, and Tint does not look at the write side at all — it refuses a read of a
`private` variable that nothing in the module writes. The table, every row measured:

| A read of | Class |
| --- | --- |
| a module `let` (`var<private>`) | **non-uniform** |
| `workgroup` memory | **non-uniform** |
| a `read_write` storage binding (`declare let`) | **non-uniform** |
| a `uniform` binding | uniform |
| a read-only storage binding (`declare const`) | uniform |
| a module `const`, an `override` | uniform |
| `workgroupUniformLoad(x)` | uniform, by construction |

`workgroupUniformLoad` is the carve-out and it is load-bearing: with a workgroup read
non-uniform on sight, it is the only spelling left that can carry a barrier — which is exactly
what the builtin is for, since it *is* one value for the whole workgroup with a barrier on each
side. It is the value the CALL produces that is uniform, not the argument.

An earlier round classified those three spaces by the join of every write in the module
instead, on the theory that a location written only constants stays uniform. That refinement is
false against Tint, and it cost four acceptances of programs Tint refuses. The write side does
not enter the answer, so none of that machinery survives.

**A write's target is a computation, not just a place.** `a[u32(x)] = y` makes every element of
`a` depend on `x`, because which element took `y` is what `x` decided — so the index expressions
of a target join the written variable's class, in the walk and in the summary alike.

What it does not reach is stated rather than implied, and kept true of the tree: it runs in the
`"use typeshade"` front end only, where a diagnostic can point at the authoring line, so an
EDSL-assembled module reaches Tint — which owns the complete rule — unchanged; a `raw`
statement's text is opaque to it; an `inout` parameter is not modelled, since the walk answers
a call's result; and two refusals are deliberately conservative, filed as
[#180](https://github.com/typeshade/typeshade/issues/180) with their measurements rather than
fixed here — a barrier under `if (edge(k))` on a uniform `k`, which Tint accepts and the
barrier threshold refuses because a user call's floor is `unknown`, and a summary that is
flow-insensitive over locals, so `gate(x, y) { let acc = x * 2.; acc = y; return acc }` keeps
`x` where the same statements inline do not. Both only ever refuse.

**The barrier rule is the spec's now, not a stricter one.** It used to refuse every `if` and
`switch`. `if (k > 0.5)` on a uniform buffer value is accepted by Tint, and is accepted here —
which is the shape a kernel branching on a dispatch-wide flag needs. What is still refused is a
branch on a value the invocations do not share, and a branch this compiler cannot read, which
keeps the old answer.

**Switching it off.** `@diagnostic("off", "derivative_uniformity")` on an entry silences the
analysis and emits WGSL's module-scope directive:

```ts
"use typeshade";

declare const t: texture_2d<f32>;
declare const s: sampler;
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@diagnostic("off", "derivative_uniformity")
@fragment export function fs(v: VsOut): vec4 {
  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv); }   // taken as written
  return vec4(0., 0., 0., 1.);
}
```

```wgsl
diagnostic(off, derivative_uniformity);
```

`examples/sample-branch.shade.ts` is the gate's evidence for the whole path — the attribute in,
the module-scope directive out, compiled on Tint and on ANGLE. Its non-uniform branch is in the
ENTRY, on a `@location` input, so deleting the directive line turns the file into the refusal
above; a sample under a `uniform` condition sits beside it, needing no directive at all.

The severity is HONOURED, not merely emitted: `off` silences the rule, `info` and `warning`
demote it to a warning, and `error` is the default it already has. A directive the emit carried
while the front end went on reporting an error would be a line that reads as a decision and is
not one — the module would never reach the compiler the author aimed it at, because the WGSL is
withheld whenever a diagnostic is an error.

Written on the entry, emitted at module scope, and that is deliberate: WGSL's `@diagnostic` on
a function covers that function's own body and not the functions it calls, and a sample is as
often in a helper as in the entry — so the attribute form would switch off a rule the module
still breaks elsewhere. One spelling in, the one that means what the author meant out. The
severity vocabulary is WGSL's (`off`, `info`, `warning`, `error`); the rule vocabulary is what
this compiler analyses, which is one rule, because a directive with nothing behind it is a line
that reads as a decision and is not one.

GLSL ES 3.00 needs none of this: an implicit derivative in non-uniform control flow is
undefined there rather than refused (glsl-es-300.txt:3751-3752), so the GLSL text does not move
for any of it.

## 55. `random(seed)`: a hash of its seed, and what a driver does to it

**`random(seed)` is a pure function of its seed, and is the one name here that neither language
gives.** WGSL has no random built-in at all, and ECMAScript's `random` is a MEMBER of `Math`
that takes no seed — a free `random` beside it is a different name under the language design
rules' 2.1(b), and it carries its own §9.3 row in the extension table with `mod` and `fill`. It
takes an `f32`, a `vec2` or a `vec3` and answers an `f32` in the range [0, 1).

```ts
"use typeshade";

export function noise(t: f32, uv: vec2, p: vec3): vec4 {
  const a = random(t);    // an f32 seed
  const b = random(uv);   // a vec2 seed
  const c = random(p);    // a vec3 seed
  return vec4(a, b, c, 1.);
}
```

Nothing is drawn from a stream: there is no state, so one seed is one value everywhere in the
module and on every invocation of every frame. That is the property the name is for — a value
that stays put while the camera moves — and it is also, today, the property it does not have on
a GPU. The two paragraphs below say why.

```ts
"use typeshade";

export function cell(uv: vec2): f32 {
  return random(floor(uv * 8.));   // one value per 8x8 cell
}
```

**What is emitted**, measured on this tree, is the sine hash the shader-toy idiom made common:

| Written | WGSL (the GLSL ES 3.00 text is the same with `vec2`/`vec3` spelled GLSL's way) |
| --- | --- |
| `random(x)` on an `f32` | `fract((sin(x) * 43758.5453123))` |
| `random(uv)` on a `vec2` | `fract((sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453123))` |
| `random(p)` on a `vec3` | `fract((sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453123))` |

A `vec2` and a `vec3` seed are dotted into one `f32` first, so all three are the same one-argument
hash. There is no `random` call in the IR: the front end expands it where it stands, so
`isKnownIntrinsic('random')` is false and there is no `INTRINSICS` row to read an accuracy
off. The nodes it leaves behind carry the author's span, so the debugger and every
diagnostic still point at the `random(x)` that was written, not at the `sin` inside it.

**The seed is an `f32`, a `vec2` or a `vec3`, and the editor cannot hold you to that.** The
declaration reads `random(seed: f32 | vec2 | vec3): f32`, which is what the compiler enforces:

| Written | Verdict |
| --- | --- |
| `random(s)` on a `u32`, an `i32` or an `f64` | `TS8003 random(seed) seed must be f32, vec2, or vec3; got u32.` (and `i32`, `f64`) |
| `random(v)` on a `vec4` | the same sentence with `vec4<f32>`, and TypeScript's own `Argument of type 'vec4' is not assignable to parameter of type 'f32 \| vec2 \| vec3'` |
| `random(3)` | accepted: an integer literal in a float position is an `f32` (the language design rules' 5.1, and §13 here), so this is `random(3.)` |
| `random()` | `TS8019`, one sentence naming the three shapes; `Math.random()` with no seed does not compile either |

The `vec4` row is the only one TypeScript itself reports. **Measured** through the language
service: the scalar brands are OPTIONAL properties — `type f32 = number & { readonly [f32Tag]?: true }`,
and the same shape for `i32`, `u32` and `f64` — so every branded scalar is structurally
assignable to every other and a `u32` argument satisfies an `f32` parameter. `vecTag` is
REQUIRED and carries the arity, which is why the vector arm is checked while you type and the
scalar arm waits for the compile. Naming the parameter `f32` rather than `number` did not change
that; it changed what the declaration and the hover SAY, so they now say what the refusal says.

**The result is driver-dependent, which is a defect and not a caveat.** WGSL bounds `sin` to
2⁻¹¹ absolute error on [-π, π] and does not bound it at all outside that range — and outside is
where this hash lives: a `vec2` seed over an 8×8 cell grid reaches `sin` with an argument of up
to about 640, and the determinism report (§38) already lists `sin` in the absolute-error column for that
reason. Multiplying by 43758.5453123 and taking `fract` turns that error into a different
answer, not a nearby one. Measured:

| Seed | `sin` exact | `sin` moved by 2⁻¹¹ |
| --- | --- | --- |
| `random(0.5)` | 0.9642 | 0.3306 |
| `random(12.)` | 0.3497 | 0.7161 |

[#181](https://github.com/typeshade/typeshade/issues/181) measures the emitted expression against
the f64 CPU oracle at up to **0.8078** apart on a [0, 1) range, with Tint and ANGLE agreeing with
each other and both parting from the oracle. So "the same seed always gives the same value" is
true of the IR and false of a GPU. What was measured is that the two targets agree with each
other and neither agrees with the reference; what is NOT measured, and is what the missing bound
permits, is that a third driver's `sin` answers differently again — the specification gives no
promise to hold it to. Nothing in the front end says any of this, which is the Appendix B row
this section is named in, against the language design rules' 12.6.

The range has a second edge, from the same tree's determinism report: WGSL's `fract` is
`x - floor(x)`, which gives 1 or 1 - 2⁻²⁴ for a tiny negative `x`, so [0, 1) is the intent and
1.0 is reachable. Compare against a threshold, do not divide by `1. - random(s)`.

**#181 replaces the implementation with an exact integer hash**, murmur3's `fmix32` over a
counter, chosen in a bake-off of eight candidates run on Chromium for real: every 32-bit integer
candidate is bit-exact across WGSL, GLSL ES 3.00, the oracle and the CPU codegen, and
`fract(sin())` is the only one that fails even under a hashed seeding. The same change gives
`Math.random()` a meaning — a host-seeded per-invocation draw, ECMAScript's own contract for the
name — so that the two names become two operations rather than one hash and one dead spelling.
Until it lands, `random(seed)` is what this section says it is.

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
"use typeshade";

class Vertex {
  @builtin("position") pos: vec4;
  @location(0) half: vec2; // TS8068 "half" is reserved in GLSL ES 3.00, so a field of that
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

## 63. An array's methods

An array has five of the methods of ECMAScript's `Array.prototype`, and each runs as TypeScript
runs it (Rule 8.18). They work on an `array<T, N>`, and all but `map` on a runtime-sized storage
array too. Before this section every method of an array was `TS8099 JS Array method ".map" is
not a shader op`.

| Written              | Its value          | What it does                                                          |
| -------------------- | ------------------ | --------------------------------------------------------------------- |
| `xs.map(f)`          | `array<R, N>`      | `f(value, index, array)` for each element; `R` is what `f` returns    |
| `xs.forEach(f)`      | nothing            | `f(value, index, array)` for each element, as a statement             |
| `xs.some(p)`         | `bool`             | whether `p` holds for an element, stopping at the first that passes   |
| `xs.every(p)`        | `bool`             | whether `p` holds for every element, stopping at the first that fails |
| `xs.reduce(f, init)` | the type of `init` | `acc = f(acc, value, index, array)` from `init`, left to right        |
| `xs.reduce(f)`       | `T`                | the same, starting from the first element, on an `array<T, N>`        |

```ts
"use typeshade";

class Light {
  pos: vec2;
  radius: f32;
  power: f32;
}
declare const lights: storage<array<Light>>;
declare const out: storage<array<f32>, "read_write">;

function sq(x: f32): f32 {
  return x * x;
}

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const p = vec2(f32(gid.x) / 64., 0.5);
  const weights: array<f32, 4> = [0.1, 0.2, 0.3, 0.4];
  const scaled = weights.map((w, i) => w * f32(i + 1));
  const total = scaled.map(sq).reduce((acc, w) => acc + w, 0.);
  const lit = lights.some((l) => distance(l.pos, p) < l.radius);
  let glow = 0.;
  lights.forEach((l) => {
    glow += l.power / (1. + distance(l.pos, p));
  });
  out[gid.x] = glow * total + (lit ? 1. : 0.);
}
```

**The function.** A method takes its function the way a function that takes a function does
(§14): by its name, or as an arrow function or a function expression written in the call. It is
handed the element (`value`), the element's `index`, an `i32`, which is the type an unannotated
counter has (Rule 7.5), and the `array` itself, and for `reduce` the running value first. It
may leave parameters off at the end, as TypeScript allows, and a function the file declares may
take fewer than the method passes: `scaled.map(sq)` hands `sq` the element alone. One that
writes no return type returns what its body does (Rule 8.19). What it captures, the call passes,
by reference where it writes it: `glow` above. `reduce`'s running value has the type of the
function's first parameter where that is written, and otherwise the type of the value to start
from, where a `0` nothing declares an integer is an `f32` (Rule 5.1).

**What it lowers to.** Each call is a call of a function of the module, made once for each array
type and function handed over: a counted loop over the indices that calls the function, which
`some` and `every` leave at the first element that decides them.

```wgsl
fn array_map_sq(scaled: array<f32, 4>) -> array<f32, 4> {
  var out: array<f32, 4>;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    out[i] = sq(scaled[i]);
  }
  return out;
}

fn array_forEach_main_f_2(glow: ptr<function, f32>, p: vec2<f32>) {
  for (var i: i32 = 0; (i < i32(arrayLength(&lights))); i = (i + 1)) {
    main_f_2(glow, p, lights[i]);
  }
}
```

A method call is an expression and a loop is a statement. A function is a call anywhere a call
may stand, in an argument, on the right of `&&`, or in a loop's condition, where no loop could
be written in place, and every target and the CPU oracle run one already.

**The array is read as it goes, as TypeScript reads it.** An element the function writes before
the loop reaches it is read with the write:

- a module variable, a module constant or a binding is read in place, `lights[i]` above;
- a variable the function captures is read through the parameter the loop takes for it, which
  is the one the function writes through when it writes it (Rule 8.18): a running sum
  `xs.forEach((x, i) => { xs[i + 1] += x; })` adds each element into the next, as in TypeScript;
- any other array is passed by value, since nothing can write it while the loop runs.

An index on the way to the array, `cells[k].xs.some(…)`, is read once before the loop, as
TypeScript reads the receiver once.

**Where it differs from TypeScript** (Rule 7.2): `index` is an `i32` where TypeScript passes a
`number`, and `map`'s value is an array value that a `const` holds a copy of, as every array
here is, where TypeScript builds a new array object.

**Refused, each naming what to write:**

- the other methods of `Array.prototype` (`filter`, `find`, `slice`, `push`, `sort`, …): an
  array's length is fixed, so a search, a copy or a change of length is a loop,
  `for (const x of xs)` (§17);
- `map` on a runtime-sized array, whose value would be an array with no size, which exists only
  in storage: `forEach` storing into a storage binding is the fix;
- `reduce` with no value to start from on a runtime-sized array, which may be empty, where
  TypeScript throws a `TypeError` and a shader cannot throw;
- a function that takes the array itself from a runtime-sized one, which no function can take:
  it reads the binding by its name instead;
- a second argument to `map`, `forEach`, `some` or `every` (`thisArg`), since an arrow function
  reads the `this` around it already;
- every refusal Rule 8.18 makes of a function handed over: one that does not fit, a builtin or a
  generic function by its name, and a choice at run time; and a `map` whose function returns
  nothing, and a `forEach` whose value is used.

The folds of §27 (`sum`, `any`, `all`, `none`, `zip`) stay as they are: unrolled, and shorter
to write where they fit.

**The editor types all of it.** `interface Array<T>` in the ambient library declares the five,
as `lib.es5.d.ts` spells them with a `this` of `array<T, N>` and `index: i32`, and
`array<T, N>` picks them by name (Rule 3.6), so `scaled` above is an `array<f32, 4>` and
`glow`'s arrow function is checked against the element type.

## 66. `console`: what reaches the host

`changes/0014-gpu-console.md`. A shader function calls the JavaScript console as TypeScript
spells it, `console.log`, `console.info`, `console.debug`, `console.warn` and `console.error`,
and the call reaches the host as an event, `{ method, args, span }`, handed to the sink the host
passes: `compile(src, { consoleSink })` for `eval`, or `compileModule(m, { consoleSink })` and
`compileModuleJs(m, { consoleSink })`. The other methods of `console` are refused by name.

```ts
"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

@compute([64])
export function scale(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) {
    return;
  }
  const y = xs[gid.x] * 2.;
  if (y > 100.) {
    console.warn("large value at", gid.x, y);
  }
  out[gid.x] = y;
}
```

**An argument is a value, or a string literal, which is a label.** A value is anything with a
type the shader can hold: a scalar, a `bool`, a vector, a matrix, an `f64`, an array, a struct,
an enum member. A string has no GPU representation (§28), and a label never reaches one: it is
kept on the host, and the event carries it in the place it was written, so the call above
delivers `["large value at", 136, 272]`. A template with a value in it builds text at run time,
and is refused with the arguments to write instead (`console.log(\`x = ${x}\`)` is
`console.log("x =", x)`); so is any other string that is not a literal.

**A console call computes nothing a shader reads.** It is a statement, and its value cannot be
used. Its arguments are evaluated once, in order, as any call's are, so an argument that writes
(a method that changes its object, a helper that bumps a module variable) writes on every
target.

**Where it is delivered.** On the CPU (the oracle, the generated CPU code, `dispatch`), each call
delivers its event to the sink when it runs, and to nothing when no sink is passed. An event from
an entry that takes `global_invocation_id`, or from a `dispatch`, carries its `invocation`; a
fragment entry's is the pixel, `[x, y, 0]`. The debugger steps through a call. By default WGSL
and GLSL ES 3.00 record nothing: the call is removed, and the writes of its arguments stay, so no
emitted byte depends on a console call.

**On WebGPU, when the compile asks.** `compile(src, { console: 'gpu' })` makes the WGSL record
each call a compute or fragment entry reaches. The compiler binds one storage buffer the author
did not write, `_console`, at group 0 past the module's own bindings (Rule 6.11), and
`result.console` says where, with the table of calls the decoder reads. The host does four
things:

```js
const log = result.console;
const buf = device.createBuffer({ size: 8 + 4 * 16384, usage: STORAGE | COPY_SRC | COPY_DST });
// bind `buf` at @group(log.group) @binding(log.binding), with the module's other resources;
device.queue.writeBuffer(buf, 0, new Uint32Array([0, 0])); // before each dispatch or draw
// after it: copy `buf` into a MAP_READ buffer, map it, and
const { events, dropped } = decodeConsole(new Uint32Array(mapped), log);
for (const e of events) sink(e);
```

The size is the host's: a call reserves its words with one `atomicAdd`, and one that does not fit
is dropped whole and counted in `dropped`. `decodeConsole` returns the events the CPU run
delivers, in the order the CPU runs a dispatch in (by invocation, `z`, then `y`, then `x`, and in
program order within one), each with its `invocation`. `reflect(m, { console: 'gpu' })` lists the
buffer beside the module's bindings, as it lists `_fp64`. `typeshade/emit-prod` never records.

**What is not recorded says so.** Under `console: 'gpu'`, `TS8071` is a warning on a call the
WGSL cannot record, and the call still reaches the sink on the CPU:

- a vertex entry reaches it: a vertex stage cannot write a storage buffer, and Tint refuses the
  module, so a function a vertex entry reaches records nothing on any stage. Log on the fragment
  side;
- an argument has no fixed size or is not a value: a runtime-sized array, a texture, a sampler;
- the stage already binds eight storage buffers, WebGPU's default limit.

GLSL ES 3.00 has no storage buffer and records nothing, with no diagnostic. A discarded fragment
writes nothing after its `discard`.

`examples/gpu-console.shade.ts` is the kernel above with a helper that warns; the compile gate
hands Tint its WGSL both ways, as written and under `console: 'gpu'`. The `console-log` journey
runs it on WebGPU from the packed tarball and holds the lines `decodeConsole` returns equal to
the CPU run's and to its host's own, line for line.

**The editor** declares each method as the standard console does, taking any argument, and
reports what the compiler refuses among them in the compiler's words.

---

## 64. Calling a module from host code

An ordinary TypeScript file imports a `.shade.ts` and calls the helper functions it exports. The
call runs the module's own code **on the CPU tier, not on the GPU**, at `f32` precision, the way
the GPU would compute it (Rule 11.7). It is how host code shares a shader's math: a height query,
a picking test, a unit test. No device, buffer or compile step appears in the host's code, and
`typescript` is needed at build time only. Calling an entry point on the GPU through the same
import is the second half of roadmap item 16 (16b), and comes in a proposal of its own.

```ts
"use typeshade";

export const EPS: f32 = 0.001;

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

export function normal(p: vec2, k: vec4): vec3 {
  const dx = height(p + vec2(EPS, 0.), k) - height(p - vec2(EPS, 0.), k);
  const dy = height(p + vec2(0., EPS), k) - height(p - vec2(0., EPS), k);
  return normalize(vec3(-dx, 2. * EPS, -dy));
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(normal(p.xy * 0.01, vec4(1., 0.5, 2., 0.25)) * 0.5 + 0.5, 1.);
}
```

That module is `terrain.shade.ts`. A host file calls it like any other module:

```ts
import { height, normal } from './terrain.shade.ts';

const k = [1, 0.5, 2, 0.25] as const;
const h = height([0.5, 0.5], k); // a number
const n = normal([0.5, 0.5], k); // [number, number, number]
```

**The setup** is the lines below. The import journey (`journeys/_host-import/`, run by
`bun run gate:journeys`) sets up the first three exactly so, from the packed tarball, and checks
that `tsc`, `vite build` and the bundle's calls come out right:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

export default defineConfig({ plugins: [typeshade()] });
```

```jsonc
// tsconfig.json, the host project's own: two lines
"moduleSuffixes": [".typeshade", ""],
"exclude": ["src/**/*.shade.ts"]
```

```jsonc
// package.json
"scripts": { "prepare": "typeshade sync" }
```

```
# .gitignore
*.shade.typeshade.ts
```

**The host view.** A host program cannot type-check the shader source: its decorators are
TS1206, its vocabulary meets the DOM's (`length`, `location`), and a host array is not a branded
`vec2`. So the host reads a generated file instead. The plugin writes a _host view_ beside each
module, `terrain.shade.typeshade.ts`, and `moduleSuffixes` makes `tsc`, the editor, typescript-eslint
and `vitest --typecheck` resolve `./terrain.shade.ts` to it. Vite ignores `moduleSuffixes`, so the
bundle reads the source, through the plugin:

```ts
// Generated by typeshade from terrain.shade.ts. Do not edit; `typeshade sync` rewrites it.

export declare const EPS: number;
export declare function height(p: readonly [number, number], k: readonly [number, number, number, number]): number;
export declare function normal(p: readonly [number, number], k: readonly [number, number, number, number]): [number, number, number];
/** Not callable from host code (Rule 8.20): it is an entry point, which runs on a GPU; the GPU half of roadmap item 16 adds it. */
export declare const fs: never;
```

The plugin rewrites a view when its module changes, in `vite dev` and in `vite build`. On a clean
checkout `tsc` often runs before Vite (create-vite's `build` script is `tsc && vite build`), so
`typeshade sync` writes every view first; `typeshade sync --check` fails on one that is missing or
stale. The views are generated files, and git-ignored.

**What a host can call** (Rule 8.20): an exported function that is not an entry point, is not
generic, takes no function, has a host value for each parameter and for its result, and reaches
no binding, no workgroup variable and no builtin only a GPU computes. An exported constant and an
`enum` are values too, and an exported struct is a type. Every other export is in the view as
`never`, with the reason in a comment, so calling one is a type error at the host's own line.

| Export                                       | In the host view                                             |
| -------------------------------------------- | ------------------------------------------------------------ |
| a function a host can call                   | `export declare function f(…): …`                            |
| a constant                                   | `export declare const K: …`, a frozen copy                   |
| an `enum`                                    | its members as values, and a type of their numbers           |
| a struct (`class`, `interface`, `type`)      | `export interface S { … }`                                   |
| an entry point, a generic function, a binding, anything else | `never`, with the reason and the work that adds it |

**Host values** (Rule 8.21) are the representation the CPU tier already runs on:

| TypeShade type                            | argument                                                   | result         |
| ----------------------------------------- | ---------------------------------------------------------- | -------------- |
| `f32`, `f64`                              | `number` (an `f32` is rounded as a buffer write rounds it) | `number`       |
| `i32`, `u32`                              | `number`, an integer in the type's range                   | `number`       |
| `bool`                                    | `boolean`                                                  | `boolean`      |
| `vecN` and its `f`, `i`, `u`, `f64` forms | `readonly [number, …]` of N                                | `[number, …]`  |
| `vecNb`                                   | `readonly [boolean, …]` of N                               | `[boolean, …]` |
| `matCxR`                                  | `readonly number[]` of C×R, column-major                   | `number[]`     |
| `array<T, N>`                             | `readonly T[]` of N                                        | `T[]`          |
| a struct                                  | an object of its fields                                    | the same       |
| an `enum`                                 | the member's number                                        | the same       |

Each argument is checked and converted at the call, for the caller `tsc` did not read: an
`ArrayLike` of the right length, a `Float32Array` included, becomes a fresh array, and a value
that does not fit is a `TypeError` naming the function, the parameter and its type
(`height(): parameter "p" (vec2): got an array of length 1.`). The result aliases no argument.
The call is synchronous, and no later tier makes it otherwise. A runtime-sized array, an atomic, a
texture, a sampler and a binding have no host value yet: they belong to roadmap item 15 and to
the GPU half of item 16.

**The name** (Rule 3.8). A shader module a host imports is named `*.shade.ts`. The plugin refuses
a `.ts` the bundle reads that begins with `"use typeshade"` under any other name, with the
rename. A module with a compile error fails the build with each `TS80xx` diagnostic at its file,
line and column. A `.shade.ts` that imports another `.shade.ts` is still `TS8004`: one file is
one module.

**What ships.** The plugin writes the CPU tier's code into the module the bundler reads, as module
code, with no `new Function`, so a strict content security policy is no obstacle. That module
imports `typeshade/runtime`, the op library it runs on, and nothing of the compiler.

Last updated: 2026-09-22
