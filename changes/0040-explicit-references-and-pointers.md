---
id: '0040'
title: Reference parameters, written as `Ref<T>` and passed as `ref(place)`, by the model that already carries `this`
status: accepted
rules:
- '2.1'
- '6.10'
- '7.9'
- '8.8'
- '8.10'
- '8.17'
- '8.25'
- '9.6'
- '12.7'
surface:
- 9
- 14
- 26
- 49
- 52
- 70
exports: []
exports-removed: []
codes:
- TS8073
- TS8074
examples:
- reference-parameters
downstream:
- repo: typeshade.github.io
  what: Document `Ref<T>` parameters, `ref(place)` arguments, the call-scoped alias rule and the target lowering, with the swap and in-place examples; replace the TS8018 guidance that only names a local copy; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Hover and diagnostics for `Ref<T>` bindings and `ref()` arguments from the compiler's analysis, TS8073 and TS8074 in references/diagnostics.md, the skill's parameter-write guidance; record this proposal in compiler-changes.md.
---

<!-- doc-refs: skip-file — an accepted but unimplemented proposal names a future rule, a future surface section, future codes and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0040`, `status: accepted`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Revision context date         | 2026-10-05, Asia/Seoul: the date of this amendment's authoring, not of an approval or an implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Amendment                     | This revision replaces the design accepted in [PR #444](https://github.com/typeshade/typeshade/pull/444) (merged 2026-10-04, review baseline `c214e4d6caa3b2fe1a0fd32fa30636d8a4f7f484`, reviewed revision `4e7e1785a0f4d6a9e4513729d8236c9ae709f485`). That design added pointer syntax (`*T`, `&place`, `*pointer`), lexical exclusive borrows and the removal of `**`. The owner directed this amendment in conversation on 2026-10-05 after a review of that design; the merge of this amendment's pull request is the acceptance of the revised design. Git holds the earlier text. |
| Applicability / Effectivity   | `"use typeshade"` source; the front end (`src/compiler/ts/`), the three backends through the existing `inout` parameter mode, the CPU oracle and codegen, the language service, the documents named below; the site and the editor. Release version unassigned.                                                                                                                                                                                                                                                                                                                          |
| Review baseline               | `origin/main` at `c9c0f47aaaa69b90dd7a320fb0be551286479bcc`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Review and revision authority | Amendment: [PR #447](https://github.com/typeshade/typeshade/pull/447). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## What changes

An author can write a function that changes the caller's value, by the model the compiler
already uses for `this`. A method that writes `this.x` takes its object by reference today
(Rule 8.10): WGSL gets a pointer, GLSL ES 3.00 gets `inout`, the CPU stores the value back, and
the author writes `this.x` with no sigil. This proposal gives a parameter the same contract.

```ts
"use typeshade";

function swap(a: Ref<f32>, b: Ref<f32>): void {
  const t = a; // reads the caller's place
  a = b; // writes the caller's place:  WGSL *a = *b;   GLSL a = b;
  b = t;
}

function advance(r: Ref<Ray>, t: f32): void {
  r.origin = r.origin + r.dir * t; // the shape of this.origin = ...
}

@compute([64, 1, 1])
export function main(@builtin("global_invocation_id") id: vec3u): void {
  let x: f32 = 1.0;
  let y: f32 = 2.0;
  swap(ref(x), ref(y)); // WGSL swap(&x, &y);   GLSL swap(x, y);
  advance(ref(rays[id.x]), 2.0); // a storage element, in place
}
```

### The rule in one sentence

**A `Ref<T>` binding names a place. Reading the binding reads the place; assigning to the
binding, or to a field, component or element of it, writes the place.** There is no
dereference operator, no address operator and no arrow: field, index and swizzle access
through a `Ref<T>` is TypeScript's own member access, as it is on `this`.

### What an author writes

| Form                                  | Meaning                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p: Ref<T>` as a parameter            | The parameter names a place of type `T` in the caller. `T` is any shader value type: a scalar, a vector, a matrix, an array or a struct.                                     |
| `ref(place)` as an argument           | Passes the place. Required: a bare `x` where a `Ref<T>` is expected is refused with the edit (`TS8073`).                                                                     |
| `p = v`                               | Writes the place. On a value parameter the same statement rebinds a local copy (Rule 8.8, change 0031); the declared type is the difference, as GLSL's `inout` is from `in`. |
| `p.field = v`, `p[i] = v`, `p.xy = v` | Writes into the place, as `this.field = v` does.                                                                                                                             |
| `const t = p`, `f(p)`                 | Reads the place. `f(p)` where `f` takes a value `T` passes a copy; `f(p)` where `f` takes `Ref<T>` passes the same place on.                                                 |

`Ref` and `ref` are declarations of the ambient library, not reserved words: a file that
declares its own `ref` shadows them by Rule 2.1's declaration rule, as for any other name. The
compiler reads `ref(place)` as a form that takes a place, as it reads `atomicAdd(bins[i], 1)`
(surface §23), and never as a call.

### Which places

The argument of `ref()` must be a place a function may write, by the receiver rule of
Rule 8.10 unchanged: a `let` local, a `const` local whose initializer built its value
(Rule 6.10), a module variable, a storage element of a `read_write` binding, `this` inside a
constructor or a writing method, a `Ref<T>` parameter, or a field, element or index path of
one of those. A read-only place (a `const` scalar, a value parameter, a `storage<T>` read
binding, a uniform), a literal, a temporary (`ref(a * b)`, `ref(f())`) and a vector component
or swizzle (`ref(v.x)`, `ref(v.xy)`) are refused with `TS8073`, in the words the receiver rule
already uses. Storage and workgroup elements are in from the first version: the WGSL backend
already compiles one copy of a function per address space its calls use
(`src/core/backends/wgsl-ptr.ts`), for the receivers of Rule 8.10.

### The one check: no two references to one root in one call

Every argument of a call is checked together. Two reference arguments whose places share a
root (the local, module variable or binding they are reached through) are refused with
`TS8074`, when either is written by the callee: `swap(ref(x), ref(x))`, `swap(ref(o.a),
ref(o.b))`, `swap(ref(xs[i]), ref(xs[j]))`. A reference argument whose root is a module
variable the callee reads or writes directly is refused the same way. A method call counts its
receiver as a reference argument, and a call of a local function counts each variable it
captures by reference (Rule 8.17), so `ref(x)` beside a closure that writes `x` in one call is
refused too. This is WGSL's own alias analysis for pointer parameters
([Alias analysis](https://gpuweb.github.io/gpuweb/wgsl/#alias-analysis)), measured on Tint
with its valid neighbours (Rules 12.6 and 13.3); it is what GLSL's copy-in/copy-out and the
oracle's store-back need to agree with WGSL. Distinct roots are disjoint, so `swap(ref(x),
ref(y))` and `swap(ref(a.x), ref(b.x))` are accepted. The first version does not relax the
root rule for provably distinct fields or indices.

There is no lexical borrow and no lifetime: a reference lasts for the call. Between calls a
place is read and written as it always was.

### Evaluation order

Rule 7.9 already binds a call that writes to a temporary in source order and binds ahead of it
an operand that reads what it writes. A call with reference arguments is such a call for each
root it is handed, and the index expressions of a reference argument (`ref(xs[i])`) are
evaluated once, before the call, as every argument is. The compiler's existing sequencing
(`src/compiler/ts/sequence.ts`) takes the reference parameters as it takes `inout` today.

### Lowering

The IR already says which parameters a callee writes through, `FuncDecl.params[i].mode:
'inout'` (`src/core/ir/nodes.ts`), and each backend already spells it: WGSL `p: ptr<AS, T>`
with `&place` at the call and `(*p)` in the body, one copy of the function per address space;
GLSL ES 3.00 `inout T p` with the l-value at the call; the CPU oracle and codegen a copy in and
a store back on return (`src/core/cpu-codegen.ts`); the debugger the same. A `Ref<T>`
parameter sets that mode. No pointer type enters `ShaderType`, no address or dereference node
enters `Expr`, and the serialized IR, its cache identity and the emit of every existing program
are unchanged. A read-only use of a `Ref<T>` parameter (a body that never writes it) still
lowers as `inout` on GLSL in the first version; `in` for a provably unwritten reference is an
optimization left to the backend.

A local whose address a call takes is addressable storage on WGSL (`var`, not `let`), by the
analysis that already promotes a method's receiver.

### Hover and diagnostics

The editor's TypeScript program sees `Ref<T>` as `T` (`type Ref<T> = T` in the ambient
library, derived from the compiler's tables as Rule 12.7 requires), so every program the
compiler accepts is clean in the editor and under `tsc`. Hover on a `Ref<T>` binding is the
compiler's: the written type, that the binding names the caller's place, and the lowering when
known (`ptr<function, f32>`, `inout float`). The language service already composes hover from
the compiler's analysis (`src/language-service/hover.ts`).

Two codes are allocated, the next free ones in `src/compiler/ts/codes.ts` (Rule 3.7):

- `TS8073 REFERENCE`: a `Ref<T>` parameter handed a value (`Write ref(x) to pass the place.`),
  `ref()` of something that is not a writable place (in the receiver rule's words), `ref()`
  outside an argument position, a `Ref<T>` return type, field, element, local or module
  declaration, a `Ref<T>` parameter on a local function, a callback, a method or an entry, and a
  `Ref<T>` in a host-callable signature (Rule 8.20).
- `TS8074 REFERENCE_ALIAS`: two reference arguments on one root in one call, naming both
  arguments and the root, as WGSL names them.

`TS8018 ASSIGN_TARGET` on a write through a value parameter gains a second remedy beside the
local copy: `To change the caller's value, take "r: Ref<Ray>" and pass ref(r).`

### Acceptance and rejection

| Source                                                                                                | Outcome                                                                    |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `swap(ref(x), ref(y))`, distinct writable locals                                                      | Accept.                                                                    |
| `advance(ref(rays[i]), t)`, a `read_write` storage element                                            | Accept; WGSL compiles a storage-space copy of `advance`.                   |
| `bump(ref(counter))`, a module variable                                                               | Accept, unless `bump` reads or writes `counter` directly (`TS8074`).       |
| `f(ref(obj))` where `f` writes `obj.a` through its parameter                                          | Accept.                                                                    |
| `swap(x, y)`                                                                                          | `TS8073`: write `ref(x)`.                                                  |
| `swap(ref(x), ref(x))`, `swap(ref(o.a), ref(o.b))`, `swap(ref(xs[i]), ref(xs[j]))`                    | `TS8074`: one root twice.                                                  |
| `ref(1.0)`, `ref(a * b)`, `ref(v.x)`, `ref(c)` for a `const c: f32`, `ref(src[i])` for a read binding | `TS8073`: not a writable place.                                            |
| `function f(): Ref<f32>`, `class S { p: Ref<f32> }`, `const r: Ref<f32> = ref(x)`                     | `TS8073`: a reference is a parameter in this version.                      |
| `p = q` where both are `Ref<f32>` parameters                                                          | Accept: writes `p`'s place with `q`'s value. A reference is never rebound. |
| A method, a local function, a callback or an entry with a `Ref<T>` parameter                          | `TS8073`: outside this version.                                            |

### What a later proposal may add, on the same model

Each is a separate proposal; none changes the contract above.

1. **Local references**: `let r = ref(xs[i])` as a block-scoped alias of a place, its index
   evaluated once, projected to the place on GLSL and the CPU and a pointer-typed `let` on WGSL;
   at a call, `r` resolves to its root for `TS8074`. Never rebound.
2. **Read-only references**: a `Ref` of a read-only view (the `ReadView<T>` the ambient
   library already builds for read bindings), for a large value read without a copy; GLSL `in`.
3. **Slices**: a reference to a range of an array, for a helper that takes its share of a
   buffer; the root rule refined by range.
4. **`this` restated**: Rule 8.10's receiver as a `Ref<Self>` parameter, one rule for both.
5. **Sigils as sugar** (`&x` for `ref(x)`), only after proposal 0041 and its measurement; the
   projection maps them onto this model.

What no proposal will add, because neither WGSL nor GLSL ES 3.00 can express it: a reference
stored in a struct or an array, returned, captured, rebound, compared, or offset. A target that
could (a CPU target) is a target and not the definition of a construct (Rule 1.2).

## Why

Issue #431's shader and the GLSL and HLSL helpers authors port write a function that changes
its argument. Rule 8.8 refuses every reference parameter, and change 0031 gave a whole write to
a value parameter the meaning of a local copy, so the caller's value cannot be changed from a
helper at all; the author inlines the helper or returns and reassigns. The compiler already
carries the mechanism, for `this` (Rule 8.10), for captured variables (Rule 8.17) and for a
kernel's arrays (Rule 8.23): what is missing is a spelling an author can write and hover.

The design accepted in PR #444 supplied that spelling as C-like pointer syntax. Its review
found three costs that this amendment removes:

- `*T`, `&place` and `*pointer` are not TypeScript grammar. A `.ts` file carrying them is
  unreadable to `tsc`, the editor's TypeScript, prettier, eslint and every bundler, and the
  tsserver plugin that serves the editor today parses the file as TypeScript. Whether TypeShade
  files should become a language of their own is proposal 0041, to be decided on measurement;
  this proposal does not depend on it.
- The removal of `**` was a breaking change (Rule 13.9) that every author who writes `x ** 2`
  would meet. This design has no prefix `*`, so `**` keeps its meaning and nothing breaks.
- Lexical exclusive borrows with block lifetimes, capture and callback conflicts and
  control-flow joins were a checker with no counterpart on any target: a target copies only at
  a call, so a call is the only place two references to one place can disagree. The one rule
  above is WGSL's own, measurable on Tint.

The model chosen is the one the language already has. `this` is a reference parameter an
author writes without a sigil, and TypeScript authors already read `r.origin = ...` on an
object parameter as a write the caller sees; `Ref<Ray>` makes that reading true on the GPU
where a value parameter cannot. For a coding agent, whose first-try success is the owner's
criterion for the language, this adds no grammar and no reinterpretation TypeScript's checker
cannot see: `swap(x, y)` is refused with the one edit, `ref(x)` marks the mutation at the call
as `&x` would, and the alias rule is one sentence.

Two alternatives were weighed and recorded. A box type (`Ref<T>` with `.value`, `ref(x)`) lets
TypeScript's checker enforce the whole contract and reads as Vue's `ref`, but puts `.value` on
every access in shader code and does not match `this`. The pointer syntax is recorded above.
Sigils remain possible later as sugar over this model.

## What it touches

- Rule 2.1 and Rule 9.6: `Ref` and `ref` join §9.3's table by Rule 9.7, with the reasons
  "the reference parameter WGSL spells as a pointer and GLSL as `inout`, by the model `this`
  has" and "passes a place to a `Ref<T>` parameter, as `&` does in WGSL"; `TYPESHADE_EXTENSIONS`
  gains the two rows.
- Rule 6.10 is unchanged in text and cited: a `const` local whose initializer built its value
  is a writable place and may be passed by `ref()`; a `const` scalar may not.
- Rule 7.9: a call with reference arguments is a call that writes each root it is handed.
- Rule 8.8: "there must be no pointers and no reference parameters" becomes "a parameter is
  passed by value unless declared `Ref<T>`, which names the caller's place (Rule 8.25)"; the
  local-copy sentence of 0031 stays for value parameters; the roadmap row that placed references
  after 1.0 moves.
- Rule 8.10: its receiver rule is the place rule of `ref()`; a method call counts its receiver
  in the alias check.
- Rule 8.17: a local function's captured variables count in the alias check of a call that
  reaches them; a `Ref<T>` parameter is not capturable.
- Rule 8.25 (new): the reference rule: the binding names a place, what a place is, the
  call-scoped alias check, the lowering by the `inout` mode, the exclusions.
- Rule 12.7: `Ref<T>` is `T` to the editor's program; the hover of a reference binding is the
  compiler's; `src/language-service/ambient-parity.test.ts` gains the programs the two halves
  must agree on, including a `TS8073` and a `TS8074` the editor must show.
- Surface §9: a `Ref<T>` parameter is a root a write may land on. §14: `Ref<T>` among the
  parameter shapes the parser takes, and where it may not appear. §26: how a method's receiver
  relates to a `Ref<T>` parameter, and that a method takes none in this version. §49: the hover
  and the two codes in the editor. §52: the parameter-write row of the TS8018 table gains the
  `Ref<T>` remedy. §70 (new): the reference parameter, the examples, the alias rule, the
  lowering on each target, the later proposals.
- `TS8073`, `TS8074` in `src/compiler/ts/codes.ts`; `TS8018`'s second remedy.
- `examples/reference-parameters.shade.ts`: `swap` on locals and `advance` on storage
  elements, through the compile gate on Tint and WebGL2 and the differential gate, and in the
  site's gallery.
- No export changes: the IR's shapes are untouched. `src/__api__/surface.md` is rebaked only
  if the ambient declaration file's exported text changes.
- `docs/roadmap.md`: the After 1.0 row "Pointers and reference parameters" moves to the
  current section with this proposal's number; the sentence "the language has no pointers"
  under "Functions have derivatives" becomes "no pointer values", since `grad` already
  differentiates through `inout` parameters for `this`.
- `AUTHORING.md`: a section on `Ref<T>`; `CHANGELOG.md`: an entry under `[Unreleased]`,
  additive.

### Impact estimate

| Area                      | Expected work                                                                                                                                                        | Basis and uncertainty                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Front end                 | `Ref<T>` in the type reader; `ref()` as a place form in argument lowering; the place check reused from receivers; the alias check over all arguments; the two codes. | The receiver place check, the `inout` mode and the sequencing exist. The alias check is new and small. Medium. |
| Backends, oracle, codegen | None beyond what `inout` already does; storage-space copies exist.                                                                                                   | Known. The differential gate covers CPU/GPU agreement on store-back.                                           |
| Language service          | The ambient rows; hover from analysis; parity tests.                                                                                                                 | Small.                                                                                                         |
| Tint measurement          | The alias rule's accepted and refused neighbours, recorded in the code comment (Rule 13.3).                                                                          | Required before the check's text is final.                                                                     |
| Documents                 | The rules and sections above; `docs:impact`, `docs:refs`, `reqs:sync`, `doorstop -C`.                                                                                | Known set.                                                                                                     |
| Compatibility             | Additive: no existing program changes meaning or emit. A `0.N.P` release (Rule 13.9).                                                                                | Known.                                                                                                         |
| Dependencies              | None.                                                                                                                                                                | Known.                                                                                                         |
| Duration and cost         | Unknown; not estimated.                                                                                                                                              | No basis established.                                                                                          |

### Approval and plan record

The design of PR #444 was accepted on 2026-10-04 without implementation, as that revision
recorded. This amendment replaces that design; its approval is the merge of the pull request
that carries it, which this file records when opened. The declared impacts above (rules,
sections, the two codes, the example, no exports) are the finalized declarations the earlier
revision deferred; an implementation that reaches past them widens this proposal first
(`scripts/changes.ts`). Responsibilities, milestones, duration and cost are unassigned.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with
`Change: 0040`; the Tint measurement of the alias rule in the code comment; the compile gate
and the differential gate green with the new example; `src/compiler/ts/*.test.ts` asserting
both codes' text (Rule 12.5) and the parity test asserting the editor's; `docs:impact`,
`docs:refs`, `reqs:sync` and `doorstop -C` clean; and, separately, the site's and the editor's
pin pull requests with `0040` recorded in their `compiler-changes.md`.

## What it owes downstream

**typeshade.github.io.** A guide page for `Ref<T>` and `ref()`: the `swap` and `advance`
examples, the alias rule in one sentence with its refused neighbours, and the WGSL and GLSL the
examples emit; the constructs page's parameter-write entry, which today names only the local
copy; the TS8018 example; the Korean pages and the dictionary (`Ref`, `ref`, "참조"); the
gallery entry for the new example. `compiler-changes.md` records `0040` when the pin moves.

**vscode-typeshade.** `references/language.md`'s parameter section and
`references/diagnostics.md`'s `TS8073` and `TS8074` entries with the skill's compiled examples;
the hover fixtures for a `Ref<T>` binding; the MCP server's `docs` tool answers for `Ref` and
`ref` from the compiler's tables, as for every other name. `compiler-changes.md` records `0040`
when the pin moves.
