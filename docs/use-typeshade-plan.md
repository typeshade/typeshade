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

| Not this                            | This                                      |
| ----------------------------------- | ----------------------------------------- |
| Giant compiler/runtime from day one | Incremental lowering into **existing** IR |
| Parallel type system                | Map TS types onto **existing** ShaderType |
| Parallel call graph                 | Reuse `declRef` / module collection       |
| Early graph / kernel                | **Phase 1–12 first**; graph from Phase 18 |

`"use typeshade";` means: this file is a **TypeShade program source**, not JS that happens to look like math.

---

## Phase map (0–22)

| #   | Name                         | Milestone |
| --- | ---------------------------- | --------- |
| 0   | Language Contract            | A         |
| 1   | Directive / Source Detection | A         |
| 2   | TS Type → TypeShade Type     | A         |
| 3   | Expression Compiler          | A         |
| 4   | Statement Compiler           | A         |
| 5   | Function Compiler            | A         |
| 6   | Module / Import / Export     | B         |
| 7   | Intrinsic / Builtin          | B         |
| 8   | Structured Types             | B         |
| 9   | Control Flow                 | B         |
| 10  | Diagnostics / Source Map     | B         |
| 11  | Existing Backend Integration | B         |
| 12  | Semantic Validation          | B         |
| 13  | Static Analysis              | C         |
| 14  | Compile-time Evaluation      | C         |
| 15  | Specialization               | C         |
| 16  | Kernel / Compute Entry       | D         |
| 17  | Host ↔ TypeShade Boundary    | D         |
| 18  | Execution Graph              | D         |
| 19  | Optimization                 | E         |
| 20  | Runtime / CPU / GPU          | E         |
| 21  | Verification / Debugging     | F         |
| 22  | Tooling                      | F         |

---

## Milestone A — “TypeScript becomes TypeShade” (Phase 0–5)

**Goal:** one function lowers to the same IR as `fn()`.

### Phase 0 — Language Contract

Define what is TypeShade vs TypeScript:

- Supported TS subset
- TypeShade-only types
- JS runtime meaning vs TypeShade meaning
- Allowed side effects (almost none in pure shader helpers)
- Forbidden APIs (`fetch`, `Date`, `Promise`, …; `console.*` was on this list and is now
  lowered, see Phase 12)
- Compilation unit + module semantics (sketch)

**Deliverable:** Language Spec draft (this doc; the spec it anticipated became `docs/language-design.md` and `docs/use-typeshade-surface.md`).

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
Then: `vec2` `vec3` `vec4` (**f32** vectors only at first; integer and bool vectors have landed since)

Later (this phase expands over time): `f64`, `mat*`, struct, array, pointer, buffer, texture, sampler, Tensor/Buffer generics…

**Rule:** map onto **existing** `ShaderType`, do not invent a second system.

**Status:** minimum surface done (`type-map.ts`), and grown since: matrices, structs, arrays,
textures, samplers, atomics and the emulated `f64` are all types today —
`docs/use-typeshade-surface.md` is the list. Pointers and Tensor/Buffer generics are not.

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
_(Former “Phase 6b call” is the single-file subset of this.)_

**Status:** done (`module.ts` `compileTsSources(files, entry)`; `module.test.ts`). Relative named imports only; the resolver rejects
default / namespace / bare-specifier imports and unexported names. Not yet on the package
entry surface — deep import only.

### Phase 7 — Intrinsic / Builtin ✅

`sin` `cos` `normalize` `dot` `mix` `mod` …  
Constructors: `vec3f(...)`, `mat4x4(...)` (the `matCxRf` aliases are not spelled; `docs/language-design.md` Appendix A)  
TS call → neutral intrinsic → existing WGSL/GLSL spelling registry.  
_(Former “Phase 6a construct/member” overlaps here + Phase 8.)_

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
Class fields carry `@location` / `@builtin` / `@interpolate` / `@invariant` / `@blend_src`;
field `@align` is a deliberate error (`TS8010`) rather than a silent no-op, and `@size` /
`@offset` / `@ignore` are `TS8028` ("Unknown attribute") — see `docs/use-typeshade-surface.md`
§2 and §53.

### Phase 9 — Control Flow ✅

`for` `while` `break` `continue` `switch` + GPU-semantic checks

**Status:** done (`lower/control.ts`, `loop-bound.ts`, `index-bound.ts`;
`control-flow.test.ts`, `for-loop.test.ts`, `loop-bound.test.ts`, `switch-array.test.ts`,
`index-bound.test.ts`). Unbounded and non-inductive loops are rejected
(`TS8006`–`TS8008`), `break` outside a loop or a `switch` is `TS8009`.

### Phase 10 — Diagnostics + Source Mapping 🟨 partial

Coded errors (e.g. `TS8001`), spans, IR ↔ source ↔ WGSL maps

**Status:** coded errors and source spans done (`codes.ts` `TS8001`–`TS8099`; every
diagnostic carries `fileName` / `line` / `character` / `category`; `diagnostics.test.ts`).
IR ↔ source is done too: every statement and function the front end lowers carries the span
it came from (`sourceSpanOf`), which the debugger (`typeshade/debug`, `docs/debugging.md`)
steps by. **The WGSL half is not implemented** — nothing maps an emitted WGSL line back to
its TypeScript line. That is what keeps this phase, and with it Milestone B, from closing.

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

**Status:** done (`semantic.ts` bans `fetch` / `Date` / `Promise` / `async` / `await` /
`try` / `throw`, `new` on anything but a class the file declares, and spread outside an object
literal as `TS8012`–`TS8014`; a string is `TS8099`; `console.*` is lowered, to a host sink on
the CPU and to nothing on the GPU;
`bindings.ts` enforces address space and read-only resources; `stage.test.ts` covers
stage / builtin compatibility). Tests: `semantic.test.ts`, `bindings.test.ts`,
`declare-bind.test.ts`, `param-attr.test.ts`.

---

## Milestone C — “Compiler understands computation” (13–15)

### Phase 13 — Static Analysis 🟨 partial

type, shape, constancy, uniformity, R/W, side effects, ranges

Three pieces have landed: derivative and barrier uniformity
(`passes/uniformity.ts`, surface §54), the effect table that tracks which function writes
which binding (`passes/effects.ts`), and the determinism report (surface §38).

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

Not started. `pack.ts` emits the _slot table_ the host binds against; upload / download,
ownership and sync stay entirely with the host application.

### Phase 18 — Execution Graph ⬜

`map` / `sum` style pipelines → graph IR  
**Do not start this before Phase 1–12 are solid.**

---

## Milestone E — “Compiler decides how/where” (19–20)

### Phase 19 — Optimization 🟨 partial

fusion, DCE, buffer reuse, layout, scheduling hints

The IR optimizer (`src/core/passes/opt/`: constant folding and propagation, CSE, GVN, LICM,
DCE, unrolling) runs in every emit; fusion, buffer reuse and scheduling do not
exist.

### Phase 20 — Runtime ⬜

CPU executor + GPU dispatch + residency / pipeline cache

---

## Milestone F — “Verifiable system” (21–22)

### Phase 21 — Verification / Debugging 🟨 partial

CPU oracle vs GPU; source → IR → kernel → run trace

The f64 CPU oracle and a source-level stepper over it (`typeshade/debug`, `docs/debugging.md`)
exist; a caller-facing GPU-versus-oracle comparison does not (roadmap 0.7 item 19).

### Phase 22 — Tooling 🟨 partial

`typeshade build | check | inspect | profile | explain`

`typeshadeVite()` (`vite.ts`, `vite.test.ts`) compiles `*.shade.ts` at build time and
fails the build on an error diagnostic, and the language service
(`typeshade/language-service`, `docs/language-service-api.md`) serves the editor. There is no
`typeshade` CLI — `build`, `check`, `inspect`, `profile` and `explain` are all unimplemented.

---

## Development order (repo practice)

1. **Never** build all 22 in parallel.
2. **Never** introduce Execution Graph before Milestone B closes.
3. Work **one phase (or tight sub-phase) at a time**, with tests.
4. Prefer IR identity with `fn()` over “looks similar”.

```
Milestone A  (0–5)   <- done
Milestone B  (6–12)  <- current focus: only Phase 10's WGSL source map left
Milestone C  (13–15) <- next horizon
Milestone D  (16–18)
Milestone E  (19–20)
Milestone F  (21–22) <- Phase 21 partial (oracle + stepper), Phase 22 partial (Vite plugin, language service)
```

---

## Current tracking (repo)

| Phase              | State      | Notes                                                                                             |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------- |
| 0 Contract         | partial    | policies in plan; full spec TBD                                                                   |
| 1 Directive        | ✅         | `directive.ts`, `source-file.ts`                                                                  |
| 2 Types            | ✅ min     | `type-map.ts`; expand under same phase number later                                               |
| 3 Expr             | ✅         | `lower/expression*.ts`; member/index/call landed with 7–8                                         |
| 4 Stmt             | ✅         | `lower/statement.ts`                                                                              |
| 5 Func             | ✅         | + 5.1 IR equality (`ir-equality.test.ts`)                                                         |
| 6 Module/Import    | ✅         | `module.ts`; relative named imports, deep import only                                             |
| 7 Intrinsic        | ✅         | `math-alias.ts`, `math-expand.ts`, `lower/expression-call.ts` (+ constructors)                    |
| 8 Structured       | ✅         | `structs.ts`, `lower/expression-prop.ts`, `lower/index-select.ts`                                 |
| 9 Control flow     | ✅         | `lower/control.ts`, `loop-bound.ts`; `control-flow.test.ts`                                       |
| 10 Diagnostics     | 🟨 partial | `codes.ts` `TS8001`–`TS8099` + spans on the IR; **no WGSL source map**                            |
| 11 Backend         | ✅         | `compile.ts`, `pack.ts` → WGSL / GLSL / CPU; usability gate passed                                |
| 12 Semantic val    | ✅         | `semantic.ts`, `bindings.ts`; host APIs, address space, stages                                    |
| 13 Static analysis | 🟨 partial | uniformity (§54), effect table, determinism report                                                |
| 14 Const eval      | ⬜         | `lit-coerce.ts` folds numeric-literal arithmetic; the IR optimizer folds and propagates constants |
| 15 Specialization  | ⬜         |                                                                                                   |
| 16 Kernel          | ⬜         | `@compute` exists; no `@kernel`, no Kernel IR                                                     |
| 17 Host boundary   | ⬜         | `pack.ts` gives the slot table; no upload/download/sync                                           |
| 18 Execution graph | ⬜         | blocked on Phase 10 closing Milestone B                                                           |
| 19 Optimization    | 🟨 partial | IR optimizer (`passes/opt/`); no fusion or buffer reuse                                           |
| 20 Runtime         | ⬜         |                                                                                                   |
| 21 Verification    | 🟨 partial | oracle + stepper (`typeshade/debug`); no GPU divergence report                                    |
| 22 Tooling         | 🟨 partial | `vite.ts` Vite plugin, language service; no `typeshade` CLI                                       |

Docs follow the same rule as code: every `"use typeshade"` block in `README.md` and
`docs/*.md` is compiled by `src/compiler/ts/doc-snippets.test.ts` and must produce zero
error diagnostics.

### Mapping from earlier short plan

| Old                       | New                                  |
| ------------------------- | ------------------------------------ |
| Phase 6 Call              | ⊂ Phase 6 + 7                        |
| Phase 6a construct/member | ⊂ Phase 7 + 8                        |
| Phase 7 Backend           | Phase 11                             |
| Phase 8 Test matrix       | continuous; formalized in 11–12 + 21 |

---

## DX conventions (locked)

```ts
let a = 0.;           // f32
let a: i32 = 0;       // explicit
// NOT 0.0f — invalid TypeScript
a % b                 // truncated mod
mod(a, b)             // floor mod (intrinsic, Phase 7)
```

Errors → `diagnostics[]`. `compile()` hands back no `wgsl` or `glsl` when any diagnostic is an
error (`docs/use-typeshade.md`, Compiling).

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

**Remaining for Milestone B:** Phase 10's WGSL source map (WGSL ↔ source; IR ↔ source is done). Everything else
in 6–12 is green.

Last updated: 2026-09-23 (long-term 0–22 plan)
