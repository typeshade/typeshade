---
id: '0008'
title: A diagnostic says what the program is — a name is what declares it, `new` answers by its target, one refusal per mistake, and what Tint would refuse is refused on the line
status: accepted
rules:
- '2.1'
- '2.2'
- '4.8'
- '6.7'
- '6.8'
- '7.1'
- '7.5'
- '8.5'
- '8.13'
- '8.19'
- '12.4'
- '12.6'
- '12.7'
surface:
- 1
- 2
- 4
- 7
- 14
- 16
- 17
- 18
- 19
- 20
- 25
- 26
- 27
- 28
- 32
- 36
- 40
- 42
- 44
- 45
- 48
- 51
- 52
- 54
- 55
exports: []
exports-removed: []
codes:
- TS8012
examples: []
downstream:
- repo: typeshade.github.io
  what: The TS8012 entry of the error-code pages goes (its trigger, window.devicePixelRatio, is TS8022 now); the TS8013 and TS8035 entries and any copy quoting a sentence this changes (struct:A, vec3<f32> and the other type spellings in messages)
- repo: vscode-typeshade
  what: The skill's diagnostics table (the TS8012 row goes, the new refusals move from the TS8013 row to TS8035) and references/language.md's top-level var line (TS8014 alone)
---

<!-- doc-refs: skip-file — a proposal names files of the repositories downstream, which this tree does not have -->

## What changes

`new` builds a class since #86 and #190, a class has the rest of TypeScript since #195, and a
loop takes a runtime bound since #209. Many diagnostics were written before any of that, and
some never looked at what a name is, only at how it is spelled. An audit of every code at
`bbf3eff` found 201 defects; measured again on `f5fda52`, 186 still reproduce, 24 of them where
an author meets a wrong or missing diagnostic on a program the editor accepts. This proposal
takes the ones below. Each part cites its rule.

### 1. A name is what declares it, not how it is spelled (Rules 2.1, 2.2)

Rule 2.1 gives a name three sources. `Date`, `Map`, `window` and `JSON` are none of them, so in
a `"use typeshade"` file they do not exist, and a use of one is an unknown name like any other.
Today the front end keeps a list of 65 JavaScript globals and refuses a name by its text:

```text
new Date()             TS8013 A class this file declares is built with "new", and "Date" is not one of them. "new" on anything else allocates a JS object, which a shader has no heap for.
                       TS8012 "Date" is a host/JS API. "use typeshade" files cannot touch the JS runtime.
enum Status { Error }  TS8012 "Error" is a host/JS API. "use typeshade" files cannot touch the JS runtime.
(window: f32) => ...   TS8012, twice
class Date { ... }     TS8012 at the declaration and at every use
```

**After.** The list and `TS8012` go. A name nothing declares is reported once, where it is
used, by the code that owns its position: `TS8022` for a value, `TS8004` for a callee,
`TS8002` for a type. A name the file declares is never refused for its spelling. The list was
arbitrary anyway: `Uint8Array` was not on it and was already a plain `TS8022`.

Three more places decide by spelling, and change the same way:

- **An unknown callee is reported before its arguments.** `map(a, g)` and `nope(x)` report
  `TS8004` on `map` and `nope`. Today the arguments are lowered first, and a failing argument
  hides the one real mistake.
- **A name the file declares wins over a §9.3 free-spelling constant.** Today an `enum E`, a
  `namespace PI`, a `class TAU` or a `function PI` read as a value compiles to `e`, `π` or `τ`,
  with no diagnostic. After, it resolves to the file's declaration, as TypeScript resolves it.
- **A member is looked up on its receiver.** Today a class field `reverse`, an interface field
  `map` and a getter `join` are refused as "JS Array method", and a class method named
  `swizzle` as "swizzle components must be a string literal". After, each compiles. The
  array-method sentence is said only of an array, and `v.swizzle("yxz")` on a vector is
  refused as a member the vector does not have (Rule 2.2: `.swizzle()` is the IR builder's
  method, not a name any source gives, and the editor already refuses it with TS2339). The
  written swizzle `v.yxz` is unchanged.

### 2. `new` answers by what its target is (Rules 8.13, 12.1)

| Written                                                                      | Before                                           | After                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `new Date()`, nothing declares `Date`                                        | `TS8013` + `TS8012`                              | `TS8022`: `Date` is an unknown name                                                                                                        |
| `new vec3f(1., 2., 3.)`, `new f32(1)`                                        | `TS8013` "allocates a JS object"                 | `TS8035`: a WGSL constructor is called without `new`, `vec3f(...)`                                                                         |
| `new F()` on a function                                                      | `TS8013` "allocates a JS object"                 | `TS8035`: `F` is a function; call it, `F(...)`                                                                                             |
| `new E()` on an enum                                                         | `TS8013` "allocates a JS object"                 | `TS8035`: an enum's values are its members, `E.A`                                                                                          |
| `new I()` on an interface or type alias                                      | `TS8013`                                         | `TS8035`, the same sentence                                                                                                                |
| `new S()` on an `abstract` class                                             | `TS8013`                                         | `TS8035`, the same sentence                                                                                                                |
| `new this()` outside a static member                                         | `TS8013`                                         | `TS8035`, the same sentence                                                                                                                |
| `new N.P()` for `namespace N { export class P }`                             | `TS8035` `"N_P" has no constructor`              | compiles, as `new P()` of a top-level class does                                                                                           |
| `const K = new P(1.)`, `const K = g()` at module scope, or in a static field | `TS8035` or `TS8004`, then `TS8022` on every use | one sentence from the module constant's own check: a module constant is folded before any function exists, so build it inside the function |

Every `new` refusal is a class rule, so all of them are `TS8035`; `TS8013` keeps what its name
says, a host statement (`await`, `yield`, `try`, `throw`, `for…in`, `var`, a spread, a
template string). The "no heap" reason goes: `new P(1., 2.)` on the file's own class is
`P_new(1.0, 2.0)` and allocates nothing either.

### 3. One mistake, one diagnostic (Rule 12.4)

Where two passes each refuse the same node, one of them stops:

- `var`, `for…in`, `try` and `throw` in a body: `semantic.ts` refuses them, and the lowering
  then adds a reasonless `TS8099 Unsupported statement`. After, only the first. A refused
  `throw` is not also checked for its operand, so `throw new Error("x")` is one diagnostic, not
  four. A refused `var` is lowered as the `let` it would have been, so its uses say nothing.
- A top-level `var`: `TS8014` and `TS8013` on one span. After, `TS8014` alone.
- An interface or a type alias inside a namespace: the same `TS8014` twice. After, once.
- An array spread `[...a, 3.]`: `TS8013`, `TS8099` and `TS8022`. After, one sentence naming the
  elements to write.
- A generic interface or type alias used as `G<f32>`: `TS8010` with a reason §32 retired ("a
  generic declaration has no single set of field types"), then `TS8002`. After, one `TS8010`
  that names the spelling that works, `class G<T> { x: T }` (§32).

The cascade after a refused declaration (`TS8022` at each use, #171) is proposal 0007's, and not
repeated here.

### 4. What Tint would refuse is refused on the line (Rule 12.6)

Each of these compiles today with no diagnostic, and the module then fails in Tint, or is
silently not the program written:

- **A `for` update that assigns a member, an element or an unknown name**
  (`for (…; v.x += 1.)`, `xs[0] += 1`, `zz += 1`) deletes the whole loop from both targets.
  After: `TS8008` with the sentence `i += 1.` on a non-counter already gets, and `TS8022` for
  the unknown name. The lowering keeps an invariant: a statement it drops leaves an error.
- **An operator WGSL has no overload for, on two operands of one type**: `+` on two structs or
  two arrays, arithmetic or `<` on `bool`, `&` on `f32`, `===` on two matrices, any operator but
  `*` on a matrix of doubles, unary `-` on a `bool`. Today the check compares the two types and
  stops when they are equal. After: `TS8003`, naming the operator and the type (Rule 7.1).
- **A `vec3b` in a uniform or storage binding** (a struct field, a runtime array's element, the
  binding's whole type). Only a scalar `bool` was refused. After: `TS8051`, with `vec3u` as the
  remedy (Rule 6.8, surface §27 and §51).
- **A decorator on a top-level declaration**: `@group(2) @binding(5) declare const u: uniform<U>`
  is emitted at group 0, binding 0; `@id(7)` on an override and `@bogus` on a constant vanish.
  After: `TS8028`, as Rule 6.7 already requires. `@group` and `@binding` are named as the
  reflected, host-side choice they are, and `@id` as not applied, since the host sets an
  override by its name. Surface §4's row saying TypeScript cannot parse a decorator on a
  `const` is corrected: it parses it, and TypeScript itself refuses it (TS1206).
- **A non-uniform `break` or `continue`** makes the rest of the loop non-uniform, in the
  iteration after it as well: a barrier, a derivative or an implicit-LOD sample reached there is
  `TS8052` (Rule 8.5), as Tint refuses it. Today the walk models only `return`.
- **`workgroupUniformLoad`** goes through the same uniformity walk as a barrier. Today it has
  its own syntactic rule: any `if` or `switch` around it is refused, even on a uniform value,
  and a non-uniform early `return`, a helper reached under a non-uniform branch or a loop whose
  bound is non-uniform are all accepted. After, it is `TS8052` exactly where Tint refuses it,
  and `TS8034`'s sentence stops claiming the for-loop part (surface §48, §54).
- **`while (ON)`** for `const ON = true` with no `break`: today no diagnostic, and a GPU hang.
  After: the `TS8007` of `while (true)` (Rule 7.5).
- **A loop's hidden counter** (`_w` for a `while`, `_i` for a `for…of`) is a name of the
  compiler's own. Today an author's `_w` beside a `while` fails in the backend, and an author's
  `_i` read inside a `for…of` reads the counter instead, silently.

### 5. The editor says what the compiler says (Rule 12.7)

- **`src.length` on a runtime-sized storage array is a `u32` in the editor**, as it is in the
  compiler (§20). Today its hover is `(property) length: number`, which the compiler then
  refuses in `n * 0.5` or `const n: f32 = src.length`. A fixed array's `length` keeps its
  literal, `length: 4`.
- **`_` is declared in the ambient library**, so WGSL's phony assignment `_ = f(x)`, which
  compiles (§19, §52), is no longer `TS2304` in the editor.
- **A type in a message is written as the author writes it.** Today messages print the IR key:
  `declared struct:B, got struct:A`, `cannot * u32 and vec3<f32>`, `mat3x3<f32>`, spellings
  the editor rejects (`vec3<f32>` is TS2315). After: `B`, `A`, `vec3`, `vec3u`, `mat3x3`,
  `mat3x3<f64>`, through `authorTypeText`, the printer #188 added for its storage remedy.

### 6. Sentences written before classes and closures (Rule 12.1)

- Two bodies for one method: "a method has one body and no overloads" becomes "has two
  bodies", since overload signatures compile.
- An abstract member with a body is named on the class that declares it, not on the class
  that extends it, and the sentence says what is wrong: it has a body.
- A top-level statement is named by its keyword (`an "if" statement`), not by TypeScript's
  internal `IfStatement`.
- A `for` condition `i < 8 && i !== 3` is told that the extra clause is the refused part, and
  given the `if (i === 3) { break; }` that says it, not told to compare `i` to a bound, which it
  does.

## Why

A person skims past a wrong line; a coding agent acts on it. Every item above is a program the
editor accepts where the compiler says something false, says it twice, or says nothing and
hands Tint a module it refuses. The causes are four:

- **Matching a spelling instead of resolving a name**: the host-global list, the array-method
  list, the `swizzle` route, the §9.3 constants ahead of the file's own names.
- **Sentences older than the feature**: `new`, overloads, abstract members, generic classes.
- **Two passes refusing one node**: `semantic.ts` and the lowering's catch-all.
- **A check left to Tint**: operators by kind, host-shareable vectors, decorators, uniformity.

**Alternatives considered:**

- **Keep `TS8012`, resolved by symbol.** A name the file declares would then pass, but the code
  would still say "`Date` is a host API", as if TypeShade had JavaScript's globals and
  withheld them. By Rule 2.1 it does not have them at all, which is what an unknown-name
  diagnostic says, and #210's remedy table can add a better spelling for a foreign name.
- **Keep the `new` refusals under `TS8013`.** Its constant is `HOST_STMT`, and a `new` of the
  file's class is not a host statement. `TS8035` already owns `new` on a class of statics alone.

**Left out, on purpose:**

- **What proposal 0007 (#210) does:** the `TS8022` cascade after a refused declaration, the
  remedy table for an unknown name, `TS8002` for a type nothing declares, and the merged
  TypeScript and compiler list in the editor.
- **What proposal 0005 does:** an array's `map`, `reduce`, `some`, `every` and `forEach`.
- **Surface widenings, each its own proposal:** importing a class, interface or constant from
  another file, and the editor reading imports; a type alias or interface in a function body;
  `**=`, `&&=` and `||=`; string-literal field names.
- **The rest of the audit's medium and low findings** (unpinned sentences, stale comments,
  smaller remedies), listed in the issue this proposal's implementation opens.

## What it touches

- **Rules.**
  - **2.1, 2.2:** Enforced-by lines for names resolved by declaration, and the `.swizzle()`
    route closed.
  - **6.7:** the decorator refusal on a top-level declaration joins its Enforced-by line.
  - **6.8:** `TS8051` for a boolean vector.
  - **7.1:** the operator kinds `TS8003` now checks.
  - **7.5:** `while (ON)`, and the `for` update refused instead of dropped.
  - **8.5:** a non-uniform `break` or `continue`, and `workgroupUniformLoad` through the walk.
  - **8.13:** `new this()` outside a static member is `TS8035`.
  - **12.4, 12.6, 12.7:** their Enforced-by lines, and Appendix B's rows that this settles.
- **Surface sections.**
  - **§1, §4, §7:** decorators on a declaration, the §4 row, and the diagnostics table (`TS8012`
    out, the `new` rows in).
  - **§17:** the `for` update refusal and the `&&` condition sentence.
  - **§19, §52:** `_` in the editor.
  - **§20:** `.length` is a `u32` in the editor.
  - **§26:** the `new` table and the paragraph that says it stays `TS8013`.
  - **§27, §51:** a boolean vector in a binding.
  - **§28:** host names are unknown names.
  - **§32:** the generic interface sentence.
  - **§48, §54:** `workgroupUniformLoad` and `break`/`continue` in the uniformity walk.
- **Widened after acceptance**, because the implementation changed sentences that these places
  quote, and a quote the diff leaves stale is false (Rule 12.5):
  - **Rules 4.8 and 8.19** quote a `TS8003` and a return-type sentence that printed the IR's
    type key (`mat2x3<f32>`, `vec2<f32>`); §5's printer writes them as the author does.
  - **§36, §40, §42, §44, §45 and §55** quote texture-argument, matrix, packing, conversion and
    `random` sentences in the same IR spelling.
  - **§14** quotes a return-type sentence the same way.
  - **§2** says `@size` is refused as an unknown attribute; §4 of this proposal names it as
    WGSL's own attribute that is not an author attribute.
  - **§16 and §18** give the old reason for refusing a spread in a list (§3 of this proposal).
  - **§25** says `workgroupUniformLoad` is refused inside any branch; §4 of this proposal moves
    it under the uniformity walk.
- **Exports.** None.
- **Codes.** `TS8012` is retired; its number stays a gap (Rule 12.2). No code is added or
  renumbered. `TS8013` loses its `new` refusals to `TS8035`.
- **Examples.** None added or removed.
- **Tests that will pin it**, code and text (Rule 12.5), each written to fail without its fix:
  - `new-expression.test.ts`, `class-methods.test.ts`: every row of §2's table.
  - `honest-refusals.test.ts`: one diagnostic per shape of §3.
  - a new `host-names.test.ts`: a declared `Date`, `Error`, `window`, `self` compile; an
    undeclared one is one unknown-name diagnostic; the §9.3 constants lose to the file's names.
  - `loop-shapes.test.ts`: the three `for` updates, `while (ON)`, `_w` and `_i`.
  - `uniformity.test.ts` and `barriers` tests: `break`, `continue` and `workgroupUniformLoad`,
    each checked against Tint's verdict.
  - operator-kind cases beside the existing `TS8003` tests, a `vec3b` binding beside the `bool`
    one, a decorated declaration beside the attribute tests.
  - the language-service tests: the `length` hover, `_ = f()` clean.

## What it owes downstream

- **typeshade.github.io:** `src/lib/error-codes.ts` has a `TS8012` entry whose trigger is
  `window.devicePixelRatio`; it goes (the program is `TS8022` now), and so does any list of
  codes that names it. Any copy quoting a message with `struct:`, `vec3<f32>` or the `new`
  sentences is re-quoted.
- **vscode-typeshade:** `plugins/typeshade/skills/typeshade/references/diagnostics.md` drops the
  `TS8012 HOST_API` row, and its `TS8013` row stops listing `new`, which the `TS8035` row takes.
  `references/language.md` says a top-level `var` is `TS8014` and `TS8013`; it is `TS8014`
  alone.
- Both record `0008` in their `compiler-changes.md` when they pin a compiler that carries it.
