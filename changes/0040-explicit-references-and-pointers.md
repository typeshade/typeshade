---
id: '0040'
title: Reference parameters, written `@inout` and `@out` with `@in` beside them, by the model that already carries `this`
status: accepted
rules:
- '2.1'
- '6.7'
- '6.10'
- '7.9'
- '8.8'
- '8.10'
- '8.17'
- '8.25'
- '9.6'
- '12.7'
surface:
- 7
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
  what: Document `@in`, `@inout` and `@out` parameters with unmarked arguments, the definite-write rule of `@out`, the call-scoped alias rule, a local function's capture of a reference and the target lowering, replacing the `Ref<T>` and `ref()` pages of the earlier pin, with the swap and in-place examples; replace the TS8018 guidance that only names a local copy; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Hover for qualified parameters and the inlay hint `&` at each argument an `@inout` or `@out` parameter takes, both from the compiler's analysis, in the tsserver plugin; TS8073 and TS8074 in references/diagnostics.md, the skill's parameter-write and local-function guidance; record this proposal in compiler-changes.md.
---

<!-- doc-refs: skip-file — an accepted but unimplemented proposal names a future rule, a future surface section, future codes and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0040`, `status: accepted`. The front matter is the lifecycle authority. The third amendment returned the proposal from `implemented` to `accepted`; the pull request that implements it sets `implemented` again.                                                                                                                                                                                                                                                                                                                                                       |
| Revision context date         | 2026-10-05, Asia/Seoul: the date of the three amendments' authoring, not of an approval or an implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Amendment                     | This revision replaces the design accepted in [PR #444](https://github.com/typeshade/typeshade/pull/444) (merged 2026-10-04, review baseline `c214e4d6caa3b2fe1a0fd32fa30636d8a4f7f484`, reviewed revision `4e7e1785a0f4d6a9e4513729d8236c9ae709f485`). That design added pointer syntax (`*T`, `&place`, `*pointer`), lexical exclusive borrows and the removal of `**`. The owner directed this amendment in conversation on 2026-10-05 after a review of that design; the merge of this amendment's pull request is the acceptance of the revised design. Git holds the earlier text. |
| Second amendment              | This revision lets a local function capture a `Ref<T>` parameter, which the text implemented in [PR #451](https://github.com/typeshade/typeshade/pull/451) refused. It also states in the text what three deviations of that implementation do (Configuration and validation record). The owner directed it in conversation on 2026-10-05, after the capture was measured. The merge of its pull request is its acceptance. Git holds the earlier text.                                                                                                                                  |
| Third amendment               | This revision replaces the spelling `Ref<T>` and `ref(place)` with the parameter qualifiers `@in`, `@inout` and `@out` and an unmarked argument, adds `@out`'s definite-write rule, and leaves the model, the places, the alias check and the lowering unchanged. The owner directed it in conversation on 2026-10-05, after using `ref()` and finding it awkward to write. Change 0043, proposed in the same pull request, gives the definite-assignment analysis both rely on. The merge of its pull request is its acceptance. Git holds the earlier text.                            |
| Applicability / Effectivity   | `"use typeshade"` source; the front end (`src/compiler/ts/`), the three backends through the existing `inout` parameter mode, the CPU oracle and codegen, the language service, the documents named below; the site and the editor. Release version unassigned.                                                                                                                                                                                                                                                                                                                          |
| Review baseline               | First amendment: `origin/main` at `c9c0f47aaaa69b90dd7a320fb0be551286479bcc`. Second amendment: `origin/main` at `ca7226b7d5d6c219b2e942e2df784fcc47ad68e4`, the merge of PR #462, which follows the merge of PR #456 (`6574f20bdd88e9111fa16cd10d92deca2b4a0621`). Third amendment: `origin/main` at `a5ff08f5dd9ff32b8ab7d6c49c0284a8178132aa`.                                                                                                                                                                                                                                        |
| Review and revision authority | First amendment: [PR #447](https://github.com/typeshade/typeshade/pull/447). Second amendment: [PR #464](https://github.com/typeshade/typeshade/pull/464). Third amendment: no pull request assigned at authoring. Git records revisions; each pull request's review and merge record the decision.                                                                                                                                                                                                                                                                                      |

## What changes

An author can write a function that changes the caller's value, by the model the compiler
already uses for `this`. A method that writes `this.x` takes its object by reference today
(Rule 8.10): WGSL gets a pointer, GLSL ES 3.00 gets `inout`, the CPU stores the value back, and
the author writes `this.x` with no sigil. This proposal gives a parameter the same contract,
marked on the parameter by the qualifier GLSL and HLSL already use.

```ts
"use typeshade";

function swap(@inout a: f32, @inout b: f32): void {
  const t = a; // reads the caller's place
  a = b; // writes the caller's place:  WGSL *a = *b;   GLSL a = b;
  b = t;
}

function add(@in a: f32, @in b: f32, @out c: f32): void {
  c = a + b; // c is written before anything reads it
}

function advance(@inout r: Ray, t: f32): void {
  r.origin = r.origin + r.dir * t; // the shape of this.origin = ...
}

@compute([64, 1, 1])
export function main(@builtin("global_invocation_id") id: vec3u): void {
  let x: f32 = 1.0;
  let y: f32 = 2.0;
  swap(x, y); // WGSL swap(&x, &y);   GLSL swap(x, y);
  let s: f32; // no initializer: add writes it
  add(x, y, s); // s is 3.0
  advance(rays[id.x], 2.0); // a storage element, in place
}
```

The third amendment replaced the spelling of the first two revisions, a `Ref<T>` parameter
type and a `ref(place)` argument, with these qualifiers and an unmarked argument. The model,
the places, the alias check and the lowering are unchanged.

### The rule in one sentence

**An `@inout` or `@out` parameter names a place. Reading it reads the place; assigning to it,
or to a field, component or element of it, writes the place.** There is no dereference
operator, no address operator and no arrow: field, index and swizzle access through the
parameter is TypeScript's own member access, as it is on `this`.

### What an author writes

| Form                                           | Meaning                                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@in p: T`                                     | A value parameter, as `p: T` is. GLSL and HLSL allow `in` written out, so a ported helper keeps it.                                                                                           |
| `@inout p: T`                                  | The parameter names a place of type `T` in the caller, which the body reads and writes. `T` is any shader value type: a scalar, a vector, a matrix, an array or a struct.                     |
| `@out p: T`                                    | The parameter names a place the body writes before it reads it, on every path, and writes on every path before the function returns (Definite writes, below).                                 |
| `f(x)` where `f` takes `@inout` or `@out`      | Passes the place `x`. The argument is unmarked, as in GLSL and HLSL. A value that is no place (a literal, `a * b`, `g()`) is refused with the edit (`TS8073`).                                |
| `p = v`, `p.field = v`, `p[i] = v`, `p.xy = v` | Writes the place, as `this.field = v` does. On a value parameter a whole write rebinds a local copy (Rule 8.8, change 0031); the qualifier is the difference, as GLSL's `inout` is from `in`. |
| `f(p)` inside the body                         | Reads the place when `f` takes a value; passes the same place on when `f` takes `@inout` or `@out`.                                                                                           |

`@in`, `@inout` and `@out` are attributes the compiler reads (Rule 6.7), with GLSL's names
taken into §9.3's extension table by Rule 9.7. A decorator on a parameter of a plain function
is TypeScript grammar, so the parser, the editor and every formatter read the file as they read
any `.ts` file. The editor's TypeScript sees the parameter as its plain type `T`.

### Where a qualifier may be written

On a parameter of a function declared at the top of the file or of a namespace. An entry, a
method, a constructor, an accessor, a local function, a function written as an argument and a
generic function take their parameters by value, and an `@inout` or `@out` on one is refused
with `TS8073`, which names the place to move the code. `@in` is refused there too, with the
edit to remove it, so that each qualifier has one place. Two qualifiers on one parameter are
refused. A qualifier on anything but a parameter is refused with `TS8028`, as any misplaced
attribute is.

### Which places

The argument of an `@inout` or `@out` parameter must be a place a function may write, by the
receiver rule of Rule 8.10 unchanged: a `let` local, a `const` local whose initializer built
its value (Rule 6.10), a module variable, a storage element of a `read_write` binding, `this`
inside a constructor or a writing method, an `@inout` or `@out` parameter, a column of a
matrix, or a field, element or index path of one of those. A read-only place (a `const`
scalar, a value parameter, a `storage<T>` read binding, a uniform), a literal, a temporary
(`a * b`, `f()`) and a vector component or swizzle (`v.x`, `v.xy`) are refused with `TS8073`, in
the words the receiver rule already uses. Storage and workgroup elements are in: the WGSL
backend compiles one copy of a function per address space its calls use
(`src/core/backends/wgsl-ptr.ts`), for the receivers of Rule 8.10.

### Definite writes

`@out` has GLSL's meaning, and GLSL leaves an `out` parameter undefined when the call begins,
where WGSL's pointer and the CPU's place hold the caller's value. The two agree when the body
never reads the value the parameter came in with, and the caller always gets a value. So the
compiler refuses, with `TS8075` (change 0043):

- a read of an `@out` parameter, or of a field, component or element of it, on a path where
  the body has not yet written the whole parameter;
- a `return`, or the end of the body, on a path where the body has not written the whole
  parameter.

A call that passes a local to an `@out` parameter assigns the local, for change 0043's analysis
of a read before an assignment: `let s: f32; add(x, y, s); return s;` is accepted.

### The one check: no two references to one root in one call

Every argument of a call is checked together. Two `@inout` or `@out` arguments whose places
share a root (the local, module variable or binding they are reached through) are refused with
`TS8074`, when the callee writes either: `swap(x, x)`, `swap(o.a, o.b)`, `swap(xs[i], xs[j])`.
An argument whose root is a module variable the callee reads or writes directly is refused the
same way. A method call counts its receiver as a reference argument, and a call of a local
function counts each variable it captures by reference (Rule 8.17). This is WGSL's own alias
analysis for pointer parameters
([Alias analysis](https://gpuweb.github.io/gpuweb/wgsl/#alias-analysis)), measured on Tint with
its valid neighbours (Rules 12.6 and 13.3). Distinct roots are disjoint, so `swap(x, y)` and
`swap(a.x, b.x)` are accepted. A reference lasts for the call.

### Evaluation order

Rule 7.9 binds a call that writes to a temporary in source order and binds ahead of it an
operand that reads what it writes. A call with `@inout` or `@out` arguments is such a call for
each root it is handed, and the index expressions of such an argument (`xs[i]`) are evaluated
once, before the call, as every argument is.

### Lowering

The IR says which parameters a callee writes through, `FuncDecl.params[i].mode: 'inout'`
(`src/core/ir/nodes.ts`), and each backend spells it: WGSL `p: ptr<AS, T>` with `&place` at the
call and `(*p)` in the body, one copy of the function per address space; GLSL ES 3.00 `inout T
p` with the l-value at the call; the CPU oracle and codegen a copy in and a store back on
return; the debugger the same. `@inout` and `@out` both set that mode. Under the definite-write
rule an `@out` parameter's incoming value is never read and its outgoing value is always set,
so `inout` is exactly `out` on every target, and the IR keeps one mode. GLSL may spell `@out`
as `out` as a matter of text. No pointer type enters `ShaderType`, no address or dereference
node enters `Expr`, and the serialized IR and its cache identity are unchanged.

A local passed to `@inout` or `@out` is addressable storage on WGSL (`var`, not `let`), by the
analysis that already promotes a method's receiver.

### A local function that captures a reference

A local function reads and writes the variables of the function around it (Rule 8.17), and an
`@inout` or `@out` parameter is one of them. The local function takes the place the parameter
names, as it takes any variable it captures: by value while neither it nor a local function it
calls writes the parameter, and by reference once one does. It passes the parameter on to an
`@inout` or `@out` parameter as itself. WGSL hands the pointer on and GLSL ES 3.00 the `inout`
parameter; the CPU paths copy in and store back at each call. The capture was measured on every
target before the second amendment (Configuration and validation record).

### Hover, inlay hints and diagnostics

The editor's TypeScript program sees `@inout p: f32` as `p: f32`, so every program the compiler
accepts is clean in the editor and under `tsc` (Rule 12.7). The hover is the compiler's: a
parameter reads `(parameter) @inout p: f32` with the sentence that it names the caller's place
and the lowering when known, and a function reads `function lift(@inout w: f32, k: f32): void`
where it is declared and where it is called. The call site carries no mark, so the editor shows
one: an inlay hint `&` before each argument an `@inout` or `@out` parameter takes, from the
compiler's analysis (`src/language-service/`), which the tsserver plugin and the Playground
display.

`TS8073 REFERENCE` refuses a value where an `@inout` or `@out` parameter takes a place (`"swap"
writes "a" back to the caller, and "1." is a value nothing holds. Pass a variable.`), a place
that is not writable (in the receiver rule's words), a qualifier where a function takes its
parameters by value, and two qualifiers on one parameter. `TS8074 REFERENCE_ALIAS` is
unchanged. `TS8075` belongs to change 0043. TypeScript's TS2454 (a variable used before being
assigned) is replaced in the editor by the compiler's `TS8075`, whose analysis knows that an
`@out` argument assigns. An exported function with an `@inout` or `@out` parameter stays
importable by another shader module (Rule 3.9), and the host view declares it `never` with the
reason (Rule 8.20).

`TS8018 ASSIGN_TARGET` on a write into a value parameter (`r.origin = v`) names the remedy,
where the function may take a qualified parameter: `To change the caller's value, declare
"@inout r: Ray".` A whole write to a value parameter (`r = v`) stays the local copy of change
0031 and has no diagnostic.

### Acceptance and rejection

| Source                                                                                   | Outcome                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `swap(x, y)`, distinct writable locals                                                   | Accept.                                                                    |
| `advance(rays[i], t)`, a `read_write` storage element                                    | Accept; WGSL compiles a storage-space copy of `advance`.                   |
| `let s: f32; add(1., 2., s); return s;`                                                  | Accept: the `@out` argument assigns `s`.                                   |
| `bump(counter)`, a module variable                                                       | Accept, unless `bump` reads or writes `counter` directly (`TS8074`).       |
| `swap(1., y)`, `swap(a * b, y)`, `swap(v.x, y)`, `swap(c, y)` for a `const c: f32`       | `TS8073`: not a writable place.                                            |
| `swap(x, x)`, `swap(o.a, o.b)`, `swap(xs[i], xs[j])`                                     | `TS8074`: one root twice.                                                  |
| `function f(@out c: f32) { c += 1.; }`                                                   | `TS8075`: `c` is read before it is written.                                |
| `function f(@out c: f32, k: bool) { if (k) { c = 1.; } }`                                | `TS8075`: one path returns without writing `c`.                            |
| `@inout` on a method's, a local function's, an entry's or a generic function's parameter | `TS8073`: outside this version.                                            |
| `p = q` where both are `@inout` parameters                                               | Accept: writes `p`'s place with `q`'s value. A reference is never rebound. |

### What a later proposal may add, on the same model

Each is a separate proposal; none changes the contract above.

1. **Local references**: a block-scoped alias of a place, its index evaluated once; at a call,
   it resolves to its root for `TS8074`. Never rebound.
2. **Read-only references**: a parameter that reads a large value or a runtime-sized array in
   place, without a copy.
3. **Slices**: a reference to a range of an array; the root rule refined by range.
4. **`this` restated**: Rule 8.10's receiver as an `@inout` parameter, one rule for both.

What no proposal will add, because neither WGSL nor GLSL ES 3.00 can express it: a reference
stored in a struct or an array, returned, rebound, compared, or offset. A local function's
capture is none of these: the reference is a parameter of the emitted function for one call.

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

The second amendment lets a local function capture a reference. The implementation of PR #451
refused the capture on the reading that a capture outlives a call. In this language it does not.
A local function is a function of the module, and its captures are its parameters. A call of it
ends inside the call of the function around it (Rule 8.17). Rule 8.17 already passes a written
capture by reference, which is the contract of a `Ref<T>` parameter. The measurement in the
record shows that each target compiles the capture. The refusal made an author copy the
reference into a `let` and assign it back after the call. That is the boilerplate `Ref<T>`
exists to remove. A coding agent that writes a helper as a local function met a refusal that no
other variable meets.

The third amendment changes the spelling after the owner wrote programs with it. A `ref(x)` at
every call was noise in shader code, which writes these calls often, and `Ref<T>` wrapped a type
that the editor then showed unwrapped. The pointer syntax `*`, `&` was weighed again and stays
out: TypeShade's compiler and language service parse source with TypeScript's parser, which
reads `swap(&x, &y)` as two binary expressions with missing operands and `*p = 1.` with its
assignment lost (measured on 2026-10-05), so sigils need a parser of their own, a position map
for every diagnostic and hover, and a file other tools cannot read. A parameter decorator needs
none of that: TypeScript parses `function lift(@inout w: f32)` with no error, and the compiler
and the editor already report it as one unknown attribute, `TS8028`, the one fact to change.
GLSL and HLSL spell the three modes `in`, `inout` and `out`, so a ported helper keeps its
qualifiers and an agent writes what it has read in those languages. An unmarked argument is what
those languages write too; the editor's inlay hint shows the `&` that the source no longer
carries. Proposal 0041 (`.tsh` files) existed for the sigils and is withdrawn in the same pull
request.

## What it touches

- Rule 2.1 and Rule 9.6: §9.3's table loses `Ref` and `ref` and gains the attributes `in`,
  `inout` and `out`, by Rule 9.7, with the reason "GLSL's parameter qualifiers, which mark the
  parameters a function reads, writes back, or writes"; `TYPESHADE_EXTENSIONS` follows. `Ref`
  and `ref` leave the ambient library, so a file's own `ref` is an ordinary name again.
- Rule 6.7: the attribute names the compiler reads gain `@in`, `@inout` and `@out`, on a
  parameter.
- Rule 6.10 is unchanged in text and cited: a `const` local whose initializer built its value
  is a writable place and may be passed to `@inout`; a `const` scalar may not.
- Rule 7.9: a call with `@inout` or `@out` arguments is a call that writes each root it is
  handed.
- Rule 8.8: a parameter is passed by value unless qualified `@inout` or `@out`, which names the
  caller's place (Rule 8.25); the local-copy sentence of 0031 stays for value parameters.
- Rule 8.10: its receiver rule is the place rule of an `@inout` argument; a method call counts
  its receiver in the alias check.
- Rule 8.17: an `@inout` or `@out` parameter is captured as the place it names.
- Rule 8.25: restated for the qualifiers: the parameter names a place, what a place is, the
  unmarked argument, `@out`'s definite writes, the call-scoped alias check, the lowering by the
  `inout` mode, the exclusions.
- Rule 12.7: the parameter is its plain type to the editor's program; the hover, the inlay hint
  and `TS8075` in place of TypeScript's TS2454 are the compiler's.
- Surface §7: the diagnostics table's rows for the qualifiers. §9: a qualified parameter is a
  root a write may land on. §14: the qualifiers among the parameter shapes the parser takes, and
  the capture. §26: how a method's receiver relates to an `@inout` parameter. §49: the hover, the
  inlay hint and the codes in the editor. §52: the parameter-write row of the TS8018 table names
  `@inout`. §70: retitled "Parameter qualifiers: `@in`, `@inout` and `@out`", restated.
- `TS8073` reworded for unmarked arguments and qualifiers; `TS8074` unchanged; `TS8018`'s remedy
  names `@inout`. `TS8075` is change 0043's.
- `examples/reference-parameters.shade.ts`: the same shapes written with `@inout`, and an `@out`
  that writes a result into an unassigned local, through the compile gate on Tint and WebGL2 and
  the differential gate, and in the site's gallery.
- `src/__api__/surface.md` is rebaked if the ambient declaration file's exported text changes;
  no export of the API subpaths changes, and the IR's shapes are untouched.
- `src/language-service/`: the hover of a qualified parameter and of its function, the inlay
  hint, and TS2454 replaced by `TS8075`.
- `AUTHORING.md`, `CHANGELOG.md` (`[Unreleased]`, where `Ref<T>` was never released, so no
  released program breaks), `docs/roadmap.md`.

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
| Second amendment          | The refusal in `src/compiler/ts/lower/local-functions.ts` goes; a captured reference passes on bare; tests read both halves; the documents above; the example.       | Measured before the amendment (record). Small.                                                                 |
| Duration and cost         | Unknown; not estimated.                                                                                                                                              | No basis established.                                                                                          |

### Approval and plan record

The design of PR #444 was accepted on 2026-10-04 without implementation, as that revision
recorded. This amendment replaced that design, and its approval is the merge of
[PR #447](https://github.com/typeshade/typeshade/pull/447) on 2026-10-05 (merge commit
`00f978853b41918e874af075b71d53aeb556d38b`), which the owner directed in conversation. The
declared impacts above (rules, sections, the two codes, the example, no exports) are the
finalized declarations the earlier revision deferred. Responsibilities, milestones, duration and
cost were not assigned.

The second amendment's approval is the merge of
[PR #464](https://github.com/typeshade/typeshade/pull/464) on 2026-10-05 (merge commit
`a73e5756786cc8403cb62d39e7b64111567a3ff5`), which the owner directed in conversation.
Responsibilities, milestones, duration and cost were not assigned.

The third amendment is approved by the merge of its pull request, at the owner's direction.
That merge has not happened at this revision. The pull request that implements it records the
merge commit.

### Configuration and validation record

**Implementation.** [PR #451](https://github.com/typeshade/typeshade/pull/451), commits carrying
`Change: 0040`, on the base `00f978853b41918e874af075b71d53aeb556d38b`. Implemented by the
repository's coding agent at the owner's direction. Delivered: the front end
(`src/compiler/ts/lower/references.ts`, `parseParams` and the parameter binding in
`lower/function.ts`, the argument path in `lower/expression-misc.ts`, the type mapper, the
capture refusal), `TS8073` and `TS8074`, the CPU store back into a field or an element
(`src/core/oracle.ts`, `src/core/cpu-codegen.ts`, `src/core/debug/interp.ts`), the host view's
refusal, the ambient declarations, docs and hover, the rules, the surface sections, the example,
`AUTHORING.md`, `docs/roadmap.md` and the changelog. `scripts/changes.ts --base origin/main`
reports exactly the declared rules, sections, codes and example.

**Functional validation**, run on 2026-10-05 in the session's Linux container, Bun 1.3.14,
Chromium 1194 (headless, WebGPU and WebGL2 on SwiftShader):

- `src/compiler/ts/reference-parameters.test.ts`, 29 cases: each program on the oracle at `f64`
  and `f32`, the generated code at both, the optimized module and the debugger; the WGSL and
  GLSL text; each refusal's code and text in the compiler and in the editor; the hover; a kernel
  loop that hands elements over by reference. Passed.
- The full unit suite (`vitest run`): passed after one fix in
  `ambient-registry-closure.test.ts`, which now witnesses `ref` (the first run had 1 failure,
  that one).
- `bun run gate:compile`: 138 examples, 0 failures; `reference-parameters` passes Tint, links on
  WebGL2 and builds its pipeline.
- `bun run gate:differential`: 0 failures.
- The alias rule measured on Tint, with the refused and the accepted neighbours, recorded in
  `lower/references.ts`.

**Document validation**, the same day: `bun run docs:impact` (every review item read; the
account is the implementing commit's `Docs-Impact:` trailer), `bun run docs:refs` (0 dead
references), `bun run reqs:sync` and `doorstop -C` (clean after each item was reviewed and each
suspect link cleared on reading), `bun run format:check`, `eslint .`, the type checks and
`bun run build`.

**Deviations from the text above**, recorded on PR #451 (1 to 4) and in this revision (5), with
their disposition.

1. Closed by the follow-up. PR #451 refused a matrix's column as a reference argument, since
   the CPU keeps a matrix as a flat list. The follow-up passes it, as this proposal says (the
   CPU paths read and store a column back through their column helpers), and the example uses
   one.
2. Closed by the second amendment. An export with a `Ref<T>` parameter is declared `never` in
   the host view (Rule 8.20) and is not refused with `TS8073`, since an export is also how
   another shader module imports the function (Rule 3.9). The text now says so (Hover and
   diagnostics).
3. Closed by the follow-up. PR #451 refused a generic function with a `Ref<T>` parameter only
   where a call made an instance of it. The follow-up refuses it where it is declared.
4. Closed by the second amendment. The `TS8018` remedy is on a write into a value parameter,
   where the function may declare a `Ref<T>` parameter. A whole write to a value parameter is
   the local copy of change 0031. The text now says so (Hover and diagnostics).
5. Closed by the second amendment. The text named `advance` on storage elements for the
   example. The delivered example is a fragment shader, which WebGL2 draws too, and passes
   locals, a struct, array elements and a matrix's column. A storage element is pinned by
   `src/compiler/ts/reference-parameters.test.ts` and was measured on Tint. The text now names
   the delivered example (What it touches).

**Follow-up.** [PR #456](https://github.com/typeshade/typeshade/pull/456), commits carrying
`Change: 0040`, on the base `f637ae64251f7e49ffe42947e2371837d0bf32c6`, merged on 2026-10-05 as
`6574f20bdd88e9111fa16cd10d92deca2b4a0621`. It closes deviations 1 and 3:
`src/compiler/ts/reference-parameters.test.ts` pins a column on every CPU path and in the WGSL
and GLSL text, and the generic function's refusal; the compile gate checks the example's column
on Tint and WebGL2. It also fixes four defects an audit found: `ref(this.n)` now makes a method
one that writes its object (Rule 8.10); a type alias of `Ref<T>` is read as its target; the
`TS8018` remedy appears only where a function may take a reference; a kernel loop that writes
its array through `ref(out[i])` is refused for WebGL2 before lowering, in the author's terms.

**Capture measurement**, for the second amendment, run on 2026-10-05 in the session's Linux
container, Bun 1.3.14, Chromium 1194 (headless, WebGPU and WebGL2 on SwiftShader). The
configuration was the compiler at `cb104e07bc60a10d062cf9bfbe29684a7e66cd92`, the head of PR
#456, with the capture refusal removed from `captureArguments` in a working copy that was not
committed. Each program captures a `Ref<T>` parameter in a local function:

| Form                                          | Expected | CPU paths       | Tint     | WebGL2       |
| --------------------------------------------- | -------- | --------------- | -------- | ------------ |
| A read                                        | 6        | agree           | accepted | linked       |
| A write, the local function called twice      | 5        | agree           | accepted | linked       |
| A read and a write in two local functions     | 126      | agree           | accepted | linked       |
| A callback of an array method (`forEach`)     | 7        | agree           | accepted | linked       |
| Passed on as `ref(p)` to a `Ref<T>` parameter | 11       | agree           | accepted | linked       |
| A field of the captured struct                | 5        | agree           | accepted | linked       |
| A method of the captured struct               | 4        | agree           | accepted | linked       |
| A local function inside a local function      | 7        | agree           | accepted | linked       |
| A read in a loop condition                    | 30       | agree           | accepted | linked       |
| An element of a `read_write` storage binding  | 2        | agree           | accepted | no GLSL form |
| Passed on bare, `bump(p)`                     | 11       | refused, TS8073 | not run  | not run      |

The CPU paths are the oracle at `f64` and `f32`, the generated code at `f64` and `f32`, the
optimized module and the debugger. Each returned the expected value. Tint compiled the module of
each accepted program. WebGL2 linked each program with a GLSL form; the storage element is a
compute program. The working copy refused the last program with `"bump" takes "v" by reference,
Ref<f32>: pass the place with ref(p), which marks at the call that "bump" may change it.` The
binding of a capture does not carry the reference mark of the parameter it captures. The
implementation passes a captured reference on as itself, as the function around it does (A
local function that captures a reference).

**Capture implementation.** A pull request with `Change: 0040` on the base
`a73e5756786cc8403cb62d39e7b64111567a3ff5`, by the repository's coding agent at the owner's
direction. Delivered: the capture refusal in `captureArguments` removed
(`src/compiler/ts/lower/local-functions.ts`); a captured reference passed on bare as itself
(`lowerReferenceArgument` in `src/compiler/ts/lower/references.ts`); Rules 8.17 and 8.25,
surface §14 and §70, `TS8073`'s documentation, `AUTHORING.md`, the changelog and `reqs/`; the
example's `liftAll`, whose local function hands the captured array's elements to `lift`, with
its goldens re-baked. Functional validation on 2026-10-05, the same container and versions:

- `src/compiler/ts/reference-parameters.test.ts`, 44 cases. The capture cases run on every CPU
  path, check the WGSL and GLSL text and the editor's diagnostics and hover. Two `TS8074` cases
  reach an alias through a capture. Passed.
- The eleven measured forms again: all agree on the six CPU paths, Tint accepts all eleven,
  WebGL2 links the ten with a GLSL form.
- `vitest run`: 396 files, 8370 tests passed, 0 failures.
- `bun run gate:compile`: 138 examples, 0 failures; `reference-parameters` passes Tint, links
  on WebGL2 and builds its pipeline. `bun run gate:differential`: 0 failures.

Document validation the same day: `docs:impact` (each review item read; the commit's
`Docs-Impact:` trailer), `docs:refs` (0 dead references), `reqs:sync` and `doorstop -C` (RULE-0817
and RULE-0825 reviewed, SURF-004, SURF-014, SURF-027 and SURF-070 cleared after reading),
`format:check`, `lint` and `build`.

**Pending.**

- The third amendment (the qualifiers, the unmarked argument, `@out`'s definite writes, the
  inlay hint): not started at this record. Its implementation pull request records the
  amendment's merge and sets `status: implemented` again. Change 0043 is implemented with it.
- The site's and the editor's work below, each with its pin and `0040` recorded in its
  `compiler-changes.md`: not started at this record.

## What it owes downstream

**typeshade.github.io.** The site pinned the compiler at `c66579b`, which carries `Ref<T>` and
`ref()`, and its pages document that spelling. When the pin moves past the third amendment: the
guide page restated for `@in`, `@inout` and `@out` with unmarked arguments (the `swap`, `add` and
`advance` examples, `@out`'s definite writes, the alias rule with its refused neighbours, the WGSL
and GLSL the examples emit, a local function that captures a reference); the constructs page's
parameter-write entry; the TS8018 example; the Korean pages and the dictionary (`@inout` and the
three qualifiers, "참조"); the gallery entry for the example; the Playground's hover and inlay
hint. `compiler-changes.md` records the amendment when the pin moves.

**vscode-typeshade.** `references/language.md`'s parameter section and
`references/diagnostics.md`'s `TS8073`, `TS8074` and `TS8075` entries with the skill's compiled
examples; the hover fixtures for a qualified parameter and its function; the inlay hint `&` in
the tsserver plugin (`packages/tsserver-plugin`), from the compiler's analysis; the MCP server's
`docs` tool answers for `@in`, `@inout` and `@out` from the compiler's tables; the skill's
local-function guidance. `compiler-changes.md` records `0040` when the pin moves.
