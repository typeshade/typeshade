# `"use typeshade"` — Long-term Project Plan

> Branch: merged to `main`  
> North star: **TypeScript is a natural source language for TypeShade** — not a one-off transpile, and not a second IR.  
> Principle: reuse existing TypeShade IR / intrinsics / backends. Do not rush Execution Graph before the TS → IR boundary is solid.

```
                 "use typeshade"
                        |
                        v
                TypeScript Source
                        |
                        v
                 TypeShade Compiler
                        |
              +---------+---------+
              |                   |
          TS TypeChecker       TS AST
              |                   |
              +---------+---------+
                        |
                        v
                 TypeShade IR   <--- same as fn() EDSL
                        |
         +--------------+--------------+
         |              |              |
      Function        Kernel         Shader
                        |
                        v
                Static Analysis -> Execution Graph -> Optimize -> Runtime
```

---

## Core idea

| Not this | This |
|----------|------|
| Giant compiler/runtime from day one | Incremental lowering into **existing** IR |
| Parallel type system | Map TS types onto **existing** ShaderType |
| Parallel call graph | Reuse `declRef` / module collection |
| Early graph / kernel | **Phase 1–12 first**; graph from Phase 18 |

`"use typeshade";` means: this file is a **TypeShade program source**, not JS that happens to look like math.

---

## Phase map (0–22)

| # | Name | Milestone |
|---|------|-----------|
| 0 | Language Contract | A |
| 1 | Directive / Source Detection | A |
| 2 | TS Type → TypeShade Type | A |
| 3 | Expression Compiler | A |
| 4 | Statement Compiler | A |
| 5 | Function Compiler | A |
| 6 | Module / Import / Export | B |
| 7 | Intrinsic / Builtin | B |
| 8 | Structured Types | B |
| 9 | Control Flow | B |
| 10 | Diagnostics / Source Map | B |
| 11 | Existing Backend Integration | B |
| 12 | Semantic Validation | B |
| 13 | Static Analysis | C |
| 14 | Compile-time Evaluation | C |
| 15 | Specialization | C |
| 16 | Kernel / Compute Entry | D |
| 17 | Host ↔ TypeShade Boundary | D |
| 18 | Execution Graph | D |
| 19 | Optimization | E |
| 20 | Runtime / CPU / GPU | E |
| 21 | Verification / Debugging | F |
| 22 | Tooling | F |

---

## Milestone A — “TypeScript becomes TypeShade” (Phase 0–5)

**Goal:** one function lowers to the same IR as `fn()`.

### Phase 0 — Language Contract

Define what is TypeShade vs TypeScript:

- Supported TS subset
- TypeShade-only types
- JS runtime meaning vs TypeShade meaning
- Allowed side effects (almost none in pure shader helpers)
- Forbidden APIs (`fetch`, `console`, `Date`, …)
- Compilation unit + module semantics (sketch)

**Deliverable:** Language Spec draft (this doc + later `docs/use-typeshade-spec.md`).

**Status:** policies locked in-repo (directive, f32 default lit, `%` vs `mod`, const immutable, all top-level fns collected). Spec prose still thin.

### Phase 1 — Directive Detection ✅

```
SourceFile
 ├─ "use typeshade" → TypeShade compiler
 └─ otherwise       → normal TS
```

- `compileTsSource` / `isTypeshadeSource`
- Top-level exact `"use typeshade"` / `'use typeshade'` only

**Status:** done (`directive.ts`, `source-file.ts`)

### Phase 2 — Type System ✅ (minimal)

First: `f32` `i32` `u32` `bool` (+ `void` return keyword)  
Then: `vec2` `vec3` `vec4` (currently **f32** vectors only)

Later (this phase expands over time): `f64`, `mat*`, struct, array, pointer, buffer, texture, sampler, Tensor/Buffer generics…

**Rule:** map onto **existing** `ShaderType`, do not invent a second system.

**Status:** minimum surface done (`type-map.ts`)

### Phase 3 — Expression Compiler ✅ (core arithmetic)

binop / compare / logical / unary / lit / param / varref  
`%` = truncated; `mod()` = floor call (later phase)

**Status:** done (`lower/expression.ts`)

### Phase 4 — Statement Compiler ✅

`const`→`let`, `let`→`var`, assign, assignOp, return, if/else  
Nested scopes; const not assignable

**Status:** done (`lower/statement.ts`)

### Phase 5 — Function Compiler ✅ + 5.1 gap fill ✅

```ts
"use typeshade";
export function transform(a: f32, b: f32): f32 {
  const x = a + b;
  return x * 2;
}
```

→ `FuncDecl` identical in core shape to `fn()`  
Verified: `ir-equality.test.ts`

**Status:** done (`lower/function.ts`, `compileTsSource.funcs`)

---

## Milestone B — “Real TypeShade programs” (Phase 6–12)

**Goal:** multi-file, intrinsics, structs, control flow, diagnostics, **WGSL/GLSL/CPU emit**.

### Phase 6 — Module / Import / Export ✅

```ts
// math.ts
"use typeshade";
export function square(x: f32): f32 { return x * x; }

// app.ts
"use typeshade";
import { square } from "./math";
export function foo(x: f32): f32 { return square(x) + 1; }
```

Module graph + call graph via existing `declRef` / transitive collection.  
*(Former “Phase 6b call” is the single-file subset of this.)*

**Status:** done (`sources.ts` `compileTsSources(files, { entry })`, `module.ts`;
`sources.test.ts`, `module.test.ts`). Relative named imports only; the resolver rejects
default / namespace / bare-specifier imports and unexported names. Not yet on the package
entry surface — deep import only.

### Phase 7 — Intrinsic / Builtin ✅

`sin` `cos` `normalize` `dot` `mix` `mod` …  
Constructors: `vec3f(...)`, `mat4x4f(...)`  
TS call → neutral intrinsic → existing WGSL/GLSL spelling registry.  
*(Former “Phase 6a construct/member” overlaps here + Phase 8.)*

**Status:** done (`math-alias.ts`, `math-expand.ts`, `lower/expression-call.ts` `VEC_CTOR`,
`numeric.ts` scalar casts; `math-alias.test.ts`, `math-expand.test.ts`,
`vec-mat-generic.test.ts`). `Math.*` aliases land on the same intrinsic ids; unknown
callees and JS `Array` methods are diagnosed, not silently passed through.

### Phase 8 — Structured Types ✅

```ts
type Vertex = { position: vec3f; normal: vec3f; uv: vec2f };
obj.position; v.x; v.xyz; a[i];
```

→ `member` / `index` / struct decl linkage

**Status:** done (`structs.ts`, `lower/expression-prop.ts`, `lower/index-select.ts`,
`vertex-layout.ts`; `structs.test.ts`, `camera-uniform.test.ts`, `vsout.test.ts`).
Class fields carry `@location` / `@builtin`; field `@align` is a deliberate error
(`TS8010`) rather than a silent no-op, and `@size` / `@offset` / `@interpolate` /
`@ignore` are parsed but not yet applied — see `docs/use-typeshade-surface.md` §2.

### Phase 9 — Control Flow ✅

`for` `while` `break` `continue` `switch` + GPU-semantic checks

**Status:** done (`lower/control.ts`, `loop-bound.ts`, `index-bound.ts`;
`control-flow.test.ts`, `for-loop.test.ts`, `loop-bound.test.ts`, `switch-array.test.ts`,
`index-bound.test.ts`). Unbounded and non-inductive loops are rejected
(`TS8006`–`TS8008`), `break` outside a loop is `TS8009`.

### Phase 10 — Diagnostics + Source Mapping 🟨 partial

Coded errors (e.g. `TS8001`), spans, IR ↔ source ↔ WGSL maps

**Status:** coded errors and source spans done (`codes.ts` `TS8001`–`TS8099`; every
diagnostic carries `fileName` / `line` / `character` / `category`; `diagnostics.test.ts`).
**Source maps are not implemented** — there is no IR ↔ source ↔ WGSL mapping anywhere in
the compiler, so a WGSL line cannot be traced back to its TypeScript line. That is what
keeps this phase, and with it Milestone B, from closing.

### Phase 11 — Existing Backend Integration ✅ **usability gate**

```
"use typeshade" → TS AST → TypeShade IR → existing backend → WGSL | GLSL | CPU
```

First point where the track is **practically usable**.

**Status:** done. `compile(src)` (`compile.ts`) returns WGSL (`emitModule`), GLSL stages
(`emitGlslStages`) and a CPU `eval` (`eval-entry.ts` over the f64 oracle); `pack.ts`
adds bindings, entry list and vertex layout. Tests: `compile.test.ts` (WGSL + GLSL + CPU
`eval` from one source), `pack.test.ts`, `clip-glsl.test.ts`, `eval-entry.test.ts`.

### Phase 12 — Semantic Validation ✅

Address space, stage compatibility, illegal mutation, ban host APIs, vector/matrix rules — compiler, not pure translator.

**Status:** done (`semantic.ts` bans `console` / `fetch` / `Date` / `Promise` / `async` /
`await` / `try` / `throw` / `new` / spread / template strings as `TS8012`–`TS8014`;
`bindings.ts` enforces address space and read-only resources; `stage.test.ts` covers
stage / builtin compatibility). Tests: `semantic.test.ts`, `bindings.test.ts`,
`declare-bind.test.ts`, `param-attr.test.ts`.

---

## Milestone C — “Compiler understands computation” (13–15)

### Phase 13 — Static Analysis ⬜
type, shape, constancy, uniformity, R/W, side effects, ranges

### Phase 14 — Compile-time Evaluation ⬜
Fold what is static; bake static matrices/transforms

### Phase 15 — Specialization ⬜
e.g. translation-only mat4; drop unused vector lanes

---

## Milestone D — “Computation platform” (16–18)

### Phase 16 — Kernel / Compute Entry ⬜
`@kernel` vs `@compute` semantics; Kernel IR

Not started. `@compute([x,y,z])` lowers to a WGSL compute entry (Phase 9 / 11), but there
is no `@kernel` decorator and no Kernel IR in `src/compiler/ts/`.

### Phase 17 — Host ↔ TypeShade Boundary ⬜
buffer upload/download, ownership, sync

Not started. `pack.ts` emits the *slot table* the host binds against; upload / download,
ownership and sync stay entirely with the host application.

### Phase 18 — Execution Graph ⬜
`map` / `sum` style pipelines → graph IR  
**Do not start this before Phase 1–12 are solid.**

---

## Milestone E — “Compiler decides how/where” (19–20)

### Phase 19 — Optimization ⬜
fusion, DCE, buffer reuse, layout, scheduling hints

### Phase 20 — Runtime ⬜
CPU executor + GPU dispatch + residency / pipeline cache

---

## Milestone F — “Verifiable system” (21–22)

### Phase 21 — Verification / Debugging ⬜
CPU oracle vs GPU; source → IR → kernel → run trace

### Phase 22 — Tooling 🟨 partial
`typeshade build | check | inspect | profile | explain`

`typeshadeVite()` (`vite.ts`, `vite.test.ts`) compiles `*.shade.ts` at build time and
fails the build on an error diagnostic. There is no `typeshade` CLI — `build`, `check`,
`inspect`, `profile` and `explain` are all unimplemented.

---

## Development order (repo practice)

1. **Never** build all 22 in parallel.  
2. **Never** introduce Execution Graph before Milestone B closes.  
3. Work **one phase (or tight sub-phase) at a time**, with tests.  
4. Prefer IR identity with `fn()` over “looks similar”.

```
Milestone A  (0–5)   <- done
Milestone B  (6–12)  <- current focus: only Phase 10 source maps left
Milestone C  (13–15) <- next horizon
Milestone D  (16–18)
Milestone E  (19–20)
Milestone F  (21–22) <- Phase 22 partial (Vite plugin only)
```

---

## Current tracking (repo)

| Phase | State | Notes |
|-------|--------|--------|
| 0 Contract | partial | policies in plan; full spec TBD |
| 1 Directive | ✅ | `directive.ts`, `source-file.ts` |
| 2 Types | ✅ min | `type-map.ts`; expand under same phase number later |
| 3 Expr | ✅ | `lower/expression*.ts`; member/index/call landed with 7–8 |
| 4 Stmt | ✅ | `lower/statement.ts` |
| 5 Func | ✅ | + 5.1 IR equality (`ir-equality.test.ts`) |
| 6 Module/Import | ✅ | `sources.ts`, `module.ts`; relative named imports, deep import only |
| 7 Intrinsic | ✅ | `math-alias.ts`, `math-expand.ts`, `lower/expression-call.ts` (+ constructors) |
| 8 Structured | ✅ | `structs.ts`, `lower/expression-prop.ts`, `lower/index-select.ts` |
| 9 Control flow | ✅ | `lower/control.ts`, `loop-bound.ts`; `control-flow.test.ts` |
| 10 Diagnostics | 🟨 partial | `codes.ts` `TS8001`–`TS8099` + spans; **no source maps** |
| 11 Backend | ✅ | `compile.ts`, `pack.ts` → WGSL / GLSL / CPU; usability gate passed |
| 12 Semantic val | ✅ | `semantic.ts`, `bindings.ts`; host APIs, address space, stages |
| 13 Static analysis | ⬜ | after B |
| 14 Const eval | ⬜ | `lit-coerce.ts` folds numeric-literal arithmetic only |
| 15 Specialization | ⬜ | |
| 16 Kernel | ⬜ | `@compute` exists; no `@kernel`, no Kernel IR |
| 17 Host boundary | ⬜ | `pack.ts` gives the slot table; no upload/download/sync |
| 18 Execution graph | ⬜ | blocked on Phase 10 closing Milestone B |
| 19–21 | ⬜ | |
| 22 Tooling | 🟨 partial | `vite.ts` Vite plugin; no `typeshade` CLI |

Docs follow the same rule as code: every `"use typeshade"` block in `README.md` and
`docs/*.md` is compiled by `src/compiler/ts/doc-snippets.test.ts` and must produce zero
error diagnostics.

### Mapping from earlier short plan

| Old | New |
|-----|-----|
| Phase 6 Call | ⊂ Phase 6 + 7 |
| Phase 6a construct/member | ⊂ Phase 7 + 8 |
| Phase 7 Backend | Phase 11 |
| Phase 8 Test matrix | continuous; formalized in 11–12 + 21 |

---

## DX conventions (locked)

```ts
let a = 0.;           // f32
let a: i32 = 0;       // explicit
// NOT 0.0f — invalid TypeScript
a % b                 // truncated mod
mod(a, b)             // floor mod (intrinsic, Phase 7)
```

Errors → `diagnostics[]`, partial emit allowed until Phase 10 tightens policy.

---

## First completion criterion (Milestone A)

```ts
"use typeshade";
export function transform(a: f32, b: f32): f32 {
  const x = a + b;
  return x * 2;
}
```

→ same core IR as `fn()` ✅ (`ir-equality.test.ts`)

**Milestone B slice — met:**

```ts
"use typeshade";
export function transform(v: vec3f): vec3f {
  if (length(v) > 1) return normalize(v);
  return v;
}
```

→ WGSL / GLSL / CPU via existing backends ✅ (`compile.ts`; `compile.test.ts`).
`length` / `normalize` are language builtins, so no import is needed; a cross-file call is
covered by the Phase 6 example above.

**Remaining for Milestone B:** Phase 10 source maps (IR ↔ source ↔ WGSL). Everything else
in 6–12 is green.

Last updated: 2026-09-14 (long-term 0–22 plan)
