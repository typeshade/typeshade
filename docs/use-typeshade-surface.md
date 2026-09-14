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

## 2. Value types — `type` and `class`

Plain data without field metadata uses a type alias:

```ts
type Camera = {
  view: mat4
  pos: vec3
}
```

Field metadata (`@location`, `@align`, `@size`, `@offset`, `@builtin`, `@interpolate`, `@ignore`) requires a **class field**. Interfaces and type-literal members cannot carry TS decorators.

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
- `extends`
- methods that close over `declare` resources
- `@compute` / `@vertex` / `@fragment` methods
- constructors, `this` as a pipeline

Pure methods that only read `this` fields may land later as free functions. Not in the first class slice.

`interface Scene { time: uniform<f32> }` is a reserved alternate bind-group spelling. Not in the first slice. `declare` is the default.

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

## 17. What a `for` loop may say, and what it is told

**Numbering:** §§9 to §16 are reserved for issue #8's A2, A6, A8, A9, A3, A10, A7 and A11, in
flight on their own branches and appending here in issue order.

A `for` must be **counted**: an integer induction variable, a constant bound, a constant step,
and at most 256 trips. That has not changed. Two things about it have.

**The step may scale, not only add.** All four arithmetic compound assignments are update
forms now:

```ts
"use typeshade"

export function shrink(): f32 {
  let a = 0.
  for (let i: i32 = 64; i > 1; i /= 2) {
    a += 1. // 64 32 16 8 4 2 — six trips
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
counted loop — it reaches its bound in six iterations — and the only reason it was
`Unsupported for-update` is that nothing read it.

**A loop that exits too late is told that, not that it does not exit.** The trip count is
computed rather than walked, so the answer is exact at any size:

| | before | after |
| --- | --- | --- |
| `for (let i: i32 = 0; i < 1024; i++)` | `for (i = 0; i < 1024; step 1) does not exit.` | `for trip count 1024 exceeds 256.` |
| `for (let i: i32 = 0; i < 16; i -= 1)` | the same sentence | unchanged — this one really does not exit |

The old counter walked the sequence and could only look 258 steps ahead, so a policy violation
and a non-terminating loop shared one message. They are different mistakes and the fix for each
is different: the first wants a smaller bound, the second a step that moves toward it.

A step that cannot advance the variable now says which way it fails — `i += 0`, `i *= 1`,
`i *= 0` and `i /= 0` each get their own reason instead of one sentence about a step of 0.

Last updated: 2026-09-14
