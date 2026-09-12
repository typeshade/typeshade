# `"use typeshade"` Source Compiler Plan

> Status: **in progress** on branch `feat/use-typeshade`  
> Goal: TypeScript source marked with `"use typeshade";` lowers into the **existing** TypeShade IR (`FuncDecl` / `Expr` / `Stmt`), then reuses existing backends (CPU / WGSL / GLSL).  
> Constraints: **Zero Dependency** for runtime; TypeScript is a **devDependency** for the compiler path only. Do not invent a parallel IR or call graph.

```
             TypeShade EDSL (fn())
                  |
                  |
"use typeshade"   |
      |           |
      v           v
  TS Compiler -> TypeShade IR
                  |
                  v
          Existing Backend
        +-----+-----+-----+
       CPU   WGSL  GLSL
```

---

## Phase 0 — Scope (locked)

**In scope**

- Detect `"use typeshade";`
- Lower eligible top-level functions to existing IR
- Expression / statement / function / call lowering
- Wire existing backends with minimal changes
- Tests: IR equality, codegen snapshots, CPU semantics

**Out of scope (this track)**

- Execution graph, `@kernel`, tensor, optimizer
- New function-call systems (reuse `declRef` / call graph)
- C-style numeric suffixes (`0.0f`) — not valid TypeScript; use annotations or (later) constructors

**First completion criterion**

```ts
"use typeshade";
export function transform(a: f32, b: f32): f32 {
  const x = a + b;
  return x * 2;
}
```

-> same IR shape as `fn()`, then backend emit.

---

## Phase 1 — Source entry + directive ✅

**Files**

- `src/compiler/ts/source-file.ts` — `compileTsSource()`
- `src/compiler/ts/directive.ts` — `"use typeshade"` detection

**Rules**

- Top-level string literal only; exact text `use typeshade`
- No directive -> ordinary TS (empty `funcs` unless `requireDirective`)

**Status:** done (tests green)

---

## Phase 2 — TS type -> TypeShade type ✅

**Files**

- `src/compiler/ts/type-map.ts`

**Minimum types**

`f32` `i32` `u32` `bool` `vec2` `vec3` `vec4`  
(+ void return keyword handled in function lowering)

**Status:** done

---

## Phase 3 — Expression lowering ✅

**Files**

- `src/compiler/ts/lower/expression.ts`
- `src/compiler/ts/context.ts` (scope)

**Supported**

- identifiers (param / local)
- numeric / boolean literals (numeric default **f32**)
- arithmetic `+ - * / %`
- bitwise `& | ^ << >>` (no `>>>`)
- logical `&& ||`
- unary `-` `!`
- comparisons `< > <= >= === !==` (reject non-strict `==` `!=`)

**Modulo policy (do not conflate)**

| Source | IR | Meaning |
|--------|-----|---------|
| `a % b` | `binop '%'` | truncated (WGSL / JS) |
| `mod(a, b)` | `call 'mod'` (Phase 6) | floor mod |

**Status:** done

---

## Phase 4 — Statement lowering ✅

**Files**

- `src/compiler/ts/lower/statement.ts`

**Supported**

- `const` -> IR `let`
- `let` -> IR `var`
- type annotations retarget numeric lits (`let a: i32 = 0`)
- `return`
- `if` / `else if` / `else` with nested block scopes
- `x = …` assign, `+= -= *= /= %=` assignOp

**Status:** done

---

## Phase 5 — Function lowering ✅ (core milestone)

**Files**

- `src/compiler/ts/lower/function.ts`
- `compileTsSource` fills `result.funcs`

**Shape**

```
FuncDecl { name, params, ret, body }
```

Same structure as `fn()`.

**Status:** done (integration tests for `transform`)

---

## Phase 6 — Function call ⬜ next

**Target**

```ts
function square(x: f32): f32 { return x * x; }
function foo(x: f32): f32 { return square(x) + 1; }
```

-> `call(square, x)` + existing declRef / call graph — **no new call system**.

Also: intrinsic free functions (`mod`, `max`, …) as `call` nodes.

---

## Phase 7 — Existing backend connection ⬜

```
TS -> "use typeshade" -> TS AST -> TypeShade IR -> lowerForBackend() -> WGSL / GLSL / CPU
```

Minimize backend diffs; prefer IR identity with EDSL path.

---

## Phase 8 — Test matrix ⬜ (expand)

1. **IR tests** — same shapes as `fn()` for equivalent bodies  
2. **Codegen snapshots** — TS source -> WGSL/GLSL  
3. **CPU semantic tests** — e.g. `foo(2, 3) === 11`

---

## Implementation order (compressed)

1. ~~Directive detection~~  
2. ~~TS type -> ShaderType~~  
3. ~~Expression~~  
4. ~~Statement~~  
5. ~~Function + compileTsSource.funcs~~  
6. **Function call** <- current next  
7. Backend wire-up  
8. Full IR / codegen / CPU matrix  

Only after Phase 8 is solid should `@kernel` / graph work start on a separate track.

---

## DX conventions (locked)

```ts
let a = 0.;        // f32
let a: i32 = 0;    // explicit
// NOT: 0.0f / 0u / 0i  (invalid TypeScript)
```

Errors -> `diagnostics[]` (no throw); partial success allowed.

---

## Tracking

| Phase | State |
|-------|--------|
| 0 Scope | locked |
| 1 Entry | ✅ |
| 2 Types | ✅ |
| 3 Expr | ✅ |
| 4 Stmt | ✅ |
| 5 Func | ✅ |
| 6 Call | ⬜ |
| 7 Backend | ⬜ |
| 8 Tests | ⬜ partial |

Last updated: 2026-09-12
