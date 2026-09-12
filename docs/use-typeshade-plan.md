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
- C-style numeric suffixes (`0.0f`) — not valid TypeScript

**Policies (locked after audit)**

| Topic | Rule |
|-------|------|
| Export | **All** top-level `function` decls are lowered (`export` optional) |
| Errors | Collect `diagnostics[]`; no throw; **partial emit** allowed |
| Numeric lit | Default **f32**; annotations retarget (`let a: i32 = 0`) |
| Modulo | `a % b` → truncated `binop '%'`; `mod(a,b)` → floor `call` (Phase 6b) |
| const assign | **Rejected** (immutable) |

**First completion criterion**

```ts
"use typeshade";
export function transform(a: f32, b: f32): f32 {
  const x = a + b;
  return x * 2;
}
```

→ same core IR as `fn()`, then backend emit.

---

## Phase 1 — Source entry + directive ✅

- `src/compiler/ts/source-file.ts` — `compileTsSource()`
- `src/compiler/ts/directive.ts`

---

## Phase 2 — TS type → TypeShade type ✅

Minimum: `f32` `i32` `u32` `bool` `vec2` `vec3` `vec4` (f32 vectors only)  
Not yet: `vec2<f32>`, `vec2i`/`vec2u`, mat, array, texture

---

## Phase 3 — Expression lowering ✅

Arithmetic, bitwise, logical, unary, comparisons.  
No member / index / construct / ternary / call (later phases).

---

## Phase 4 — Statement lowering ✅

`const`/`let`, `return`, `if`/`else if`/`else`, assign, assignOp  
Nested block scopes via `LoweringScope.push/pop`

---

## Phase 5 — Function lowering ✅

`FuncDecl { name, params, ret, body }`  
`compileTsSource` fills `funcs`

---

## Phase 5.1 — Close the milestone (gap fill) ✅

| Item | Status |
|------|--------|
| `fn()` vs `compileTsSource` IR equality (`ir-equality.test.ts`) | ✅ |
| `function.test.ts` unit tests | ✅ |
| assign / assignOp / **const reassignment reject** | ✅ |
| Export policy + partial emit documented | ✅ |
| `Binding.mutable` for write checks | ✅ |

---

## Phase 6a — construct + member (vec DX) ⬜ **next**

Without this, `vec3` types exist but cannot be built or swizzled in source.

```ts
const v = vec3(1, 2, 3);  // construct
const x = v.x;            // member
```

IR: `construct`, `member` (swizzle later if needed)

---

## Phase 6b — Function call + declRef ⬜

```ts
function square(x: f32): f32 { return x * x; }
function foo(x: f32): f32 { return square(x) + 1; }
```

→ `{ op: 'call', fn, args, declRef? }`  
Intrinsics: `mod`, `max`, … as `call` (no new call system)  
Collect callees for module assembly.

---

## Phase 7 — Existing backend connection ⬜

```
TS → IR → existing lower/emit → WGSL / GLSL / CPU
```

Minimize backend diffs; prefer IR identity with EDSL path.

---

## Phase 8 — Test matrix ⬜

1. IR equality (started in 5.1) — expand coverage  
2. Codegen snapshots — TS → WGSL/GLSL  
3. CPU semantic tests — e.g. `foo(2, 3) === 11`

---

## Deferred (post–Phase 8 or separate track)

- `for` / `break` / `continue`
- ternary → `select`
- `index` / full swizzle assign
- stage / `@compute` attrs on source functions
- diagnostic codes (`TS-SH001`…) + `noEmitOnError`
- package.json export path for `compiler/ts`
- `@kernel` / execution graph

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
| **5.1 Gap fill** | ✅ |
| **6a construct/member** | ⬜ next |
| 6b Call + declRef | ⬜ |
| 7 Backend | ⬜ |
| 8 Tests | ⬜ partial |

Last updated: 2026-09-12 (post-audit)
