# TypeScript coverage

One index of what a TypeScript author can write in a `"use typeshade"` file and what the
compiler does with it: supported as written, supported with a recorded difference in meaning,
refused with a diagnostic, or planned. The four documents it reads are the authorities, and a
row here is a pointer, not a rule: the diagnostics table is `docs/use-typeshade-surface.md` §7,
the types the GPU has no word for are its §28, the mappings whose meaning differs from
TypeScript's are Rule 7.2 of `docs/language-design.md`, the rules the tree does not yet enforce
are its Appendix B, and the plan is `docs/roadmap.md`. When a row and an authority disagree,
the authority is right and this index is stale; fix the row.

**Status.** _supported_: the form compiles with TypeScript's meaning. _divergent_: it compiles,
and Rule 7.2 records where the meaning differs. _refused_: the compiler reports the code shown,
with the edit to write, and the editor shows the same sentence (Rule 12.7). _planned_: refused
today, with the roadmap item or the proposal that would take it. _none_: refused, and no plan
takes it, with the reason.

## Types

| TypeScript                                                                                                              | Status    | Code     | Where                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `number`, `boolean`                                                                                                     | refused   | `TS8002` | §28: write `f32`, `i32`, `u32`, `bool`                                                                                                        |
| `string`                                                                                                                | none      | `TS8002` | §28: no GPU representation; a union of string literals is a key type (§75), and a string literal as a `console.log` argument is a label (§66) |
| `'lo' \| 'hi'` (a union of string literals)                                                                             | supported |          | §75: a key type, held as an id on the GPU, one of its members on the host                                                                     |
| `symbol`                                                                                                                | none      | `TS8002` | §28: a runtime value; only a brand key is erased                                                                                              |
| `f32 \| vec3` (a union of two GPU types)                                                                                | none      | `TS8002` | §28: a value has one type                                                                                                                     |
| `f32 & vec3`                                                                                                            | none      | `TS8002` | §28: two layouts, no one value                                                                                                                |
| `T \| undefined` as a local, a parameter, a result, a struct field, an array element                                    | supported |          | §76, Rule 7.10 (changes 0088, 0093): the compiler carries whether the value is there                                                          |
| `T \| undefined` in a binding, a module variable or constant, an override, an entry's IO, a kernel function's parameter | refused   | `TS8002` | §76: the sentence names the field; carry a `u32` flag by hand                                                                                 |
| `f32 \| null`, `null`                                                                                                   | refused   | `TS8002` | §76: write `T \| undefined` (0088, decision D7)                                                                                               |
| `f?: T` (an optional field), `x?: T` (an optional parameter)                                                            | supported |          | §76, §14 (0093): `T \| undefined`; a call may omit `x`; an entry's or a kernel function's parameter stays refused (`TS8020`)                  |
| `[f32, f32]`, `[near: f32, far: f32]` (a tuple)                                                                         | supported |          | §28: the same type as `array<f32, 2>`                                                                                                         |
| `[f32, vec3]`, `[f32, ...f32[]]`                                                                                        | none      | `TS8002` | §28: a list of several types is a struct; every array outside storage has a length                                                            |
| `array<T, N>`, `T[]` with a known length                                                                                | supported |          | §29 and §63                                                                                                                                   |
| `array<T>` with no size                                                                                                 | partial   |          | a storage binding's element, or a kernel function's parameter (Rule 8.22); refused anywhere else                                              |
| `type Meters = f32`, `type Color = vec3`                                                                                | supported |          | roadmap 0.3 T2                                                                                                                                |
| `interface`, a type literal, `class` as a struct                                                                        | supported |          | §26: one struct rule for the three spellings                                                                                                  |
| an index signature, a call signature on a struct                                                                        | refused   | `TS8010` | §26                                                                                                                                           |
| `enum`, `const enum`                                                                                                    | supported |          | roadmap 0.3 T1                                                                                                                                |
| generics, on a function and on a class                                                                                  | supported |          | Rule 8.9: one copy per set of type arguments (roadmap 0.3 T9)                                                                                 |
| `Map<K, V>`, `Set<K>`                                                                                                   | partial   |          | §74 (change 0080): a kernel function's parameter only                                                                                         |
| `Record<K, V>` over a key type                                                                                          | supported |          | §75 (change 0081)                                                                                                                             |
| `f64`, `vec2f64`, `vec3f64`                                                                                             | supported |          | roadmap 0.3 T18: the emulated double; not across an entry boundary (`TS8038`)                                                                 |
| `f16`, the `h` vectors                                                                                                  | planned   |          | roadmap, after 1.0: a WebGPU feature with no WebGL2 form                                                                                      |
| `readonly`                                                                                                              | supported |          | roadmap 0.3 T19: enforced on a field and on a parameter                                                                                       |
| `as const`, `satisfies`                                                                                                 | supported |          | roadmap 0.3 T7                                                                                                                                |
| `unknown`, `any`, `object`, `Function`                                                                                  | none      | `TS8002` | no GPU type names them                                                                                                                        |

## Literals and operators

| TypeScript                                     | Status    | Code               | Where                                                               |
| ---------------------------------------------- | --------- | ------------------ | ------------------------------------------------------------------- |
| `1` with no declared type                      | divergent |                    | roadmap 0.3 T15, §13: an `i32`, as WGSL reads it; `1.` is an `f32`  |
| `a ** b`, `atan(y, x)`, `c ? a : b`            | divergent |                    | Rule 7.2: `pow`, `atan2`, `select` (an `if` on a composite)         |
| `x << n` with an `i32` amount                  | divergent |                    | Rule 7.2: the amount is cast to `u32`                               |
| `a == b`, `a != b`                             | supported |                    | Rule 7.1: the same as `===` and `!==`                               |
| `v ?? d`, `o?.f`, `v ??= d`, `v === undefined` | supported |                    | §76                                                                 |
| `v!` (a non-null assertion), `o?.m()`, `f?.()` | refused   | `TS8003`, `TS8099` | §76: a shader cannot check the assertion, and has no function value |
| `typeof v === "undefined"`                     | refused   | `TS8099`           | §76: write `v === undefined`                                        |
| `d instanceof B`, `'x' in b`                   | none      | `TS8099`           | §28: no runtime type tags                                           |
| a template string                              | none      | `TS8099`           | a string has no GPU value (§28)                                     |
| `Math.sin`, `Math.PI` and the §9.3 aliases     | supported |                    | §9: the aliases of the WGSL builtins and constants                  |
| division or a shift by a value proven zero     | refused   | `TS8003`           | §7 (#68): WGSL refuses it and GLSL leaves it undefined              |

## Statements and control flow

| TypeScript                                         | Status    | Code     | Where                                                                                                                                            |
| -------------------------------------------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `if`, `else`, `?:`                                 | supported |          | §10                                                                                                                                              |
| `switch` with `break`                              | divergent |          | Rule 7.2: WGSL's `switch` never falls through; a trailing `break` is dropped                                                                     |
| `switch (true)`                                    | refused   | `TS8003` | §14: a `switch` over a `bool`                                                                                                                    |
| `for`, `while`                                     | supported |          | Rule 7.5: a counted loop, or an open loop the author ends                                                                                        |
| `for (const x of a)` over an array                 | divergent |          | Rule 7.2: a counted loop; `x` is a copy of `a[i]`                                                                                                |
| `do … while`, a labelled `break` or `continue`     | planned   | `TS8099` | roadmap 0.3 T13                                                                                                                                  |
| `break`, `continue`, an early `return`             | supported |          | §10; the narrowing walk follows them (§76)                                                                                                       |
| a `return`, `break` or `continue` at the top level | refused   | `TS8014` | §7                                                                                                                                               |
| `discard`                                          | divergent |          | §10, §76: ends the invocation; TypeScript's flow does not know it, so a read after `if (v === undefined) { discard; }` is refused in both halves |
| `let x;` read before every path assigns it         | refused   | `TS8075` | Rule 7.6, TypeScript's TS2454                                                                                                                    |
| `const o = {…}; o.x = 1`                           | divergent |          | Rule 7.2: a `var` from the first write through it                                                                                                |
| `const w = v` on a struct                          | divergent |          | Rule 7.2: a copy, where TypeScript shares one object                                                                                             |
| `try`, `catch`, `throw`                            | none      | `TS8099` | no exception on the GPU                                                                                                                          |
| `async`, `await`, a generator                      | none      | `TS8013` | `semantic.ts`: refused where written                                                                                                             |
| recursion, direct or through other functions       | none      | `TS8031` | Rule 8.4: WGSL has no call stack                                                                                                                 |

## Functions

| TypeScript                                                                                    | Status    | Code     | Where                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| a parameter reassigned whole, `a = …`, `a++`                                                  | divergent |          | §14, Rule 8.8: a mutable local from the immutable input; the caller's value stays                                                        |
| `@inout`, `@out` (a reference parameter)                                                      | supported |          | §70, Rule 8.25 (change 0040)                                                                                                             |
| a default parameter value, `b: f32 = 1.`                                                      | supported |          | §14: filled where the call is; a default may not read another parameter                                                                  |
| an optional parameter, `b?: f32`                                                              | supported |          | §14, §76 (change 0093)                                                                                                                   |
| a rest parameter, `...xs`                                                                     | none      | `TS8020` | §7: no variable arity on the GPU                                                                                                         |
| destructuring, in a parameter and in a declaration                                            | supported |          | roadmap 0.3 T7                                                                                                                           |
| a function with no return type                                                                | divergent |          | Rule 7.2, Rule 8.19: the body says it; `() => n += k` returns nothing                                                                    |
| overload signatures                                                                           | supported |          | roadmap 0.3 T6                                                                                                                           |
| a function that takes a function, `f: (x: f32) => f32`                                        | divergent |          | Rule 8.18: one copy per function handed over (`apply_sq`)                                                                                |
| an arrow function written as an argument                                                      | supported |          | Rule 8.18: a local function of the calling body                                                                                          |
| a function as a value: held, returned, chosen at run time                                     | none      | `TS8099` | Rule 8.17: a shader has no function values                                                                                               |
| a local function that reads or writes the variables around it                                 | divergent |          | Rule 7.2, Rule 8.17: the variables are parameters of the local function, by reference where it writes                                    |
| a call cycle through functions handed over                                                    | none      | `TS8031` | Rule 8.18                                                                                                                                |
| `xs.map(f)`, `forEach`, `some`, `every`, `reduce`, `fill`, `findIndex`, `indexOf`, `includes` | divergent |          | §63, Rule 7.2: a counted loop in a function made for the array type; the index is an `i32`; `reduce` folds in the tree order in a kernel |
| `xs.find(p)`, `slice`, `filter`, a second `thisArg` argument                                  | none      | `TS8099` | §63: not in the list; `find` is excluded by 0093 as its own change                                                                       |
| a vertex, fragment or compute entry                                                           | supported |          | §3, §4                                                                                                                                   |
| a kernel function (an exported function over `array<T>`)                                      | supported |          | Rule 8.22 (change 0013): each proven loop is a dispatch                                                                                  |

## Classes

| TypeScript                                                                     | Status    | Code                | Where                                                                                             |
| ------------------------------------------------------------------------------ | --------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| fields, a constructor, `new C()`, field initializers                           | supported |                     | §26, Rule 8.14                                                                                    |
| methods, static methods, static fields                                         | divergent |                     | Rule 7.2: `Cls_method(obj, …)`, dispatched statically; a written static field is a `var<private>` |
| a method that changes its object                                               | divergent |                     | Rule 8.10: the object is passed by reference                                                      |
| accessors, `#x`, parameter properties, `private`, `protected`                  | supported |                     | roadmap 0.3 T19, T20, Rule 8.12, 8.15                                                             |
| `extends`, `abstract`, `implements`, `super`, mixins                           | supported |                     | roadmap 0.3 T5, T8, T20; dispatch is static (#92)                                                 |
| a base-typed value, a downcast, dynamic dispatch                               | none      | `TS8003`            | §28: no runtime type tags; a read-only base view is proved (§26)                                  |
| `namespace`, nested                                                            | supported |                     | roadmap 0.3 T4                                                                                    |
| a field that holds a function                                                  | divergent |                     | Rule 8.16: a method under the field's name                                                        |
| `this` in a static member                                                      | supported |                     | roadmap 0.3 T19: the class                                                                        |
| a decorator anywhere but an entry, a parameter attribute or a struct attribute | refused   | `TS8035` and others | §7                                                                                                |

## Narrowing (`T | undefined`)

| TypeScript                                                                                         | Status    | Code     | Where                                                                                    |
| -------------------------------------------------------------------------------------------------- | --------- | -------- | ---------------------------------------------------------------------------------------- |
| `v === undefined` in `if`, `?:`, `&&`, `\|\|`, `while`, `for`; an early exit; an assignment; `??=` | supported |          | §76, Rule 7.10                                                                           |
| a member path, `h.n`, `h.a.n`                                                                      | supported |          | §76 (change 0093); cleared by a write to a prefix or the root and by a by-reference call |
| an element access, `xs[i]`, with a literal index too                                               | divergent | `TS8003` | §76: not narrowed; the sentence names the copy, `const x = xs[i]`                        |
| a member path inside a closure                                                                     | divergent | `TS8003` | §76: not kept; TypeScript keeps it for a `readonly` field only                           |
| a user type guard, `x is f32`; an aliased condition, `const ok = v !== undefined`                  | divergent | `TS8003` | §76: not followed                                                                        |

## Modules and the host

| TypeScript                                                                                                  | Status    | Code               | Where                                                                       |
| ----------------------------------------------------------------------------------------------------------- | --------- | ------------------ | --------------------------------------------------------------------------- |
| `import` of a shader module, in any directory or from a package                                             | supported |                    | Rule 3.9 (changes 0024, 0090)                                               |
| `export` of a helper the host calls                                                                         | supported |                    | §64, Rule 8.20, 8.21: on the CPU tier, with host values                     |
| an optional value, a struct with an optional field, a texture, a runtime-sized array as a host call's value | none      |                    | §64: the host view declares the export `never`, with the reason (Rule 8.21) |
| `console.log` inside a function                                                                             | supported |                    | §66 (roadmap 0.2 item 6)                                                    |
| top-level code that is not a declaration                                                                    | refused   | `TS8014`, `TS8022` | §7, §24: a `"use typeshade"` file holds declarations                        |
| a module `let` with no constant initializer                                                                 | refused   | `TS8033`           | §24                                                                         |

## How to keep it true

A row changes with the proposal or the fix that moves the form: the pull request that changes
a §7 row, a §28 row, a Rule 7.2 row or a roadmap item changes the row here in the same commit.
`bun run docs:refs` checks every path this file names; the section numbers and the codes are
read against their authorities by review.
