---
id: '0142'
title: A struct, a class instance and an array behave as a JavaScript object does, so a function that writes its parameter changes the caller's value, and `@inout` and `@out` are removed
status: accepted
rules:
  - '1.7'
  - '1.8'
  - '6.7'
  - '6.10'
  - '7.2'
  - '7.6'
  - '7.9'
  - '7.10'
  - '8.8'
  - '8.10'
  - '8.17'
  - '8.21'
  - '8.22'
  - '8.23'
  - '8.25'
  - '8.28'
  - '8.29'
  - '9.6'
  - '12.7'
surface:
  - 1
  - 6
  - 7
  - 9
  - 14
  - 23
  - 26
  - 28
  - 44
  - 49
  - 52
  - 64
  - 65
  - 70
  - 71
  - 73
  - 74
  - 76
exports: []
exports-removed: []
codes:
  - TS8003
  - TS8005
  - TS8018
  - TS8035
  - TS8073
  - TS8074
  - TS8075
  - TS8080
examples: []
names:
  - Array.prototype.slice
  - structuredClone
downstream:
  - repo: typeshade.github.io
    what: Every page and Playground starter that writes `@inout` or `@out`, or that explains that a parameter is a value, is written again; the reference pages for Rules 8.8, 8.23 and 8.25 change, in English and in Korean, when the compiler pin passes this change.
  - repo: vscode-typeshade
    what: The skill's references and snippets that write `@inout` or `@out` change; compiler-changes.md records 0142 when the pin moves.
  - repo: typenn
    what: Each kernel and helper that writes `@inout` or `@out` drops the qualifier; compiler-changes.md records 0142 when the pin moves. Not yet searched.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0142, `status: accepted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | 2026-11-16 (UTC), the date of this draft. Written by an AI agent (Claude Code) from the owner's statements in the conversation of that date, which are quoted below. The owner has not approved it.                                                                                                                                                                                                                                                                                                                                           |
| Applicability / Effectivity   | The front end (`src/compiler/ts/`, with `lower/references.ts`, `definite.ts`, `value-array-write.ts`, `decorated-form.ts`, `attribute-types.ts`), the language service (`src/language-service/`: hover, signature, navigation, diagnostics, docs), `src/cli/migrate.ts`, the three backends through the IR's parameter modes, the host call layer (`src/core/host-kernel.ts`), `docs/language-design.md`, `docs/use-typeshade-surface.md`, `AUTHORING.md`, `examples/reference-parameters.shade.ts`, `reqs/`. No release version is assigned. |
| Review baseline               | `main` at `97acd619`. The observed results below were first taken at `e7653735` and taken again by the reviewer at `d6dee2e9`, with the same results.                                                                                                                                                                                                                                                                                                                                                                                         |
| Review and revision authority | No pull request was assigned when this text was written. Git records revisions; the pull request's review and merge record decisions.                                                                                                                                                                                                                                                                                                                                                                                                         |

## What changes

- [fact] The owner's statements, in the conversation of 2026-11-16, in Korean with English
  translations:
  - "ps는 old next 아닌 레퍼런스로 받는 개념이 아닌가? 복사로 받아..? 왜? 배열은 기본적으로
    포인터아닌가" (is `ps` not received as a reference? Received as a copy? Why? Is an array not a
    pointer by default?)
  - "룰 8.8을 바꿔야겠는데요. Object는 모두 레퍼런스 바이 벨류 형식으로 가도록? In/out를 없애고
    아에 언어 수준에서 자체적으로 포인터를 처리할까요" (Rule 8.8 should change. Every object goes
    by reference, passed by value? Remove in/out and let the language handle pointers itself?)
  - "어차피 컴파일러 수준에서 결정 가능하지 않나? 언어가 불가능인게 아니라 구현부가 없어서
    현재로써 안되는건 아니고?" (Can the compiler not decide it anyway? Is it not that the
    implementation is missing, and not that the language cannot do it?)
  - "제가 얘기하고 싶은건 typeshade로 작성된 코드가 1:1로 다른 언어로 번역될 필요가 없다는거예요."
    (What I want to say is that code written in TypeShade need not be translated one-to-one into
    another language.) This is OD-9.
- [proposal, agent] The rule, in one sentence: **an object has the identity a JavaScript object
  has.** An object is a struct, an instance of a class, or an array (with a size or with none). A
  number, a `bool`, a vector and a matrix are values, as a JavaScript primitive is.
- [proposal, agent] The compiler's contract, in one sentence: **which object a name refers to, and
  who sees a write to it, is never other than what JavaScript says.** Where the compiler implements
  that, the program runs. Where it does not yet, the program is refused with a diagnostic that says
  "not supported yet". The contract is about identity and sharing only: the other differences from
  JavaScript that Rule 7.2 records (the `u32` index, `f32` arithmetic, and the rest) stay as they
  are, and TypeShade stays a language of its own (OD-1).
- [proposal, agent] `@inout` and `@out` are removed. A file that writes one is refused with a text
  that says to delete it. `tshc migrate` deletes them, which is new work in `src/cli/migrate.ts`:
  today it leaves a written qualifier as it is.

**One example, before and after.**

Before (`main` at `97acd619`):

```ts
function nudge(@inout p: Particle, dt: f32): void {
  p.pos += p.vel * dt;
}
export function step(@inout ps: array<Particle>, dt: f32): void {
  for (let i: u32 = 0; i < ps.length; i++) nudge(ps[i], dt);
}
```

After:

```ts
function nudge(p: Particle, dt: f32): void {
  p.pos += p.vel * dt;
}
export function step(ps: array<Particle>, dt: f32): void {
  for (let i: u32 = 0; i < ps.length; i++) nudge(ps[i], dt);
}
```

The host call does not change: `await step(particles, 1 / 60)` updates `particles`.

**A second example: a number or a vector that a function gave back through `@inout` or `@out`.**

Before:

```ts
function order(@inout lo: f32, @inout hi: f32): void {
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
}
order(a, b);
```

After, as JavaScript writes it, since a number is a value:

```ts
function order(lo: f32, hi: f32): [f32, f32] {
  return lo > hi ? [hi, lo] : [lo, hi];
}
[a, b] = order(a, b);
```

- [observed result] On 2026-11-16 `const [p, q] = swap(x, y)` compiles, and `[p, q] = swap(p, q)`
  (an assignment to names that exist) is `TS8018`. Stage 1 implements that assignment, so the
  second example compiles as written.

**The stages.** A stage is an order of implementation (OD-9). Each form below has JavaScript's
meaning from the stage that implements it, and is refused as "not supported yet" before that.

**Table 1. Passing, returning and naming an object.**

| Form                                                                                                             | JavaScript                           | After this change                                                                                                               | Stage |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `f(p)` where `f` writes `p.x` or `p[i]`                                                                          | The caller's object changes.         | The same. The compiler passes the place.                                                                                        | 1     |
| `f(p)` where `p` is `array<T, N>`                                                                                | The caller's array changes.          | The same: an array with a size is an object (Rule 8.8 and change 0031 change).                                                  | 1     |
| `f(ps[i])`, an element of a storage binding                                                                      | The element changes.                 | The same (today's lowering of Rule 8.25).                                                                                       | 1     |
| `f(new P())`, `f({ … })` where `f` writes it                                                                     | Legal; nothing else sees the write.  | The same: the compiler holds the value in a local.                                                                              | 1     |
| `p = new P(); p.x = 2` in `f`                                                                                    | The caller's object does not change. | The same: from the assignment on, `p` names the new object.                                                                     | 1     |
| `p.x = 1; p = new P(); p.x = 2` in `f`                                                                           | The caller sees `x` equal to 1.      | The same. Rule 8.8's "local for the whole body" becomes a local from the assignment on.                                         | 1     |
| `p = r; p.x = 1` in `f`, `r` another name                                                                        | `r.x` is 1.                          | The same, where the compiler can name the object at each write.                                                                 | 2     |
| `return p` of a parameter                                                                                        | The same object.                     | The same: no copy; the caller's name and the result name one object.                                                            | 1     |
| `return new P()`, a fresh object                                                                                 | A new object.                        | The same (today).                                                                                                               | 1     |
| `const q = p; q.x = 1`; `let q = p; q.x = 1` with `q` never assigned again                                       | `p.x` is 1.                          | The same: `q` is a second name of `p`.                                                                                          | 1     |
| `const p = new P(); p.x = 1`                                                                                     | Legal.                               | The same.                                                                                                                       | 1     |
| `for (const p of ps) p.x = 1`                                                                                    | Each element changes.                | The same: `p` names the element.                                                                                                | 1     |
| `p: P = new P()`, a default                                                                                      | A fresh object for each call.        | The same.                                                                                                                       | 1     |
| A local function that writes an object of the function around it                                                 | The object changes.                  | The same (Rule 8.17, today).                                                                                                    | 1     |
| `arr[i] = p`, `a.child = p`, with no later write that both names can see                                         | No difference from a copy.           | A copy; the result is JavaScript's.                                                                                             | 1     |
| `let q = p; q = r; q.x = 1`                                                                                      | `r.x` is 1.                          | The same, where the compiler can name the object at each write.                                                                 | 2     |
| `f(a, a)` where `f` writes one; `a.merge(a)`; a module variable passed to a function that also writes it by name | One object under two names.          | The same. Today `TS8074` and `TS8035` refuse these for the targets' sake; that reason ends with OD-9.                           | 2     |
| `p === q`, `p !== q`                                                                                             | Whether they are one object.         | The same. Today `TS8003` says "a struct is a value with no identity here"; that text changes at stage 1 to "not supported yet". | 2     |
| `const { child } = a` where `child` is an object                                                                 | `child` is a second name.            | The same.                                                                                                                       | 2     |
| `let q = k > 0 ? a : b; q.x = 1`                                                                                 | One of `a.x`, `b.x` is 1.            | The same, by a tag and a branch over the objects `q` can name.                                                                  | 3     |
| `a.child = b; b.x = 1`, then a read of `a.child.x`                                                               | 1.                                   | The same, by one storage for both names.                                                                                        | 3     |
| `ps[i] = ps[j]; ps[i].x = 1`, with `i` and `j` known at run time                                                 | `ps[j].x` is 1.                      | The same, by a table of indexes beside the array, of the array's length (below).                                                | 3     |
| `m.set(k, p); p.x = 1` for a `Map` of structs                                                                    | The entry changes.                   | The same, by the same table.                                                                                                    | 3     |
| A write through a uniform or a read-only binding                                                                 | A write to a frozen object throws.   | Refused, as today: the binding is declared read-only, so the refusal is the meaning.                                            | —     |

**Table 2. The kind of function.** Today only a function of the file or of a namespace takes a
reference (Rule 8.25); every other kind takes values and refuses a write to an object parameter.

| Kind                                                                                        | After this change                                                                                  | Stage |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| A function of the file or of a namespace                                                    | Its object parameters are the caller's objects.                                                    | 1     |
| A method's object (`this`)                                                                  | As today (Rule 8.10).                                                                              | 1     |
| A kernel function's array parameter, called from the host                                   | The host's array, written in place; `return ps` gives the same array or the same `Buffer`.         | 1     |
| An entry's parameter                                                                        | The pipeline's value, which no caller in the program holds; a write changes the entry's own value. | 1     |
| A parameter of a method, a constructor, a setter                                            | The caller's object.                                                                               | 2     |
| A parameter of a local function, of a function passed as an argument, of a generic function | The caller's object.                                                                               | 2     |
| A kernel function's struct parameter, called from the host                                  | The host's object, written back after the call.                                                    | 2     |
| Two elements of a host array that are one JavaScript object                                 | One object: the call packs it once and writes it back once.                                        | 3     |

**Table 3. A copy.** The language adds no copy construct (OD-3). Each JavaScript form has its
JavaScript meaning.

| Form                                               | JavaScript meaning                                 | Stage                                |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| `xs.slice()`, `[...xs]` of numbers or vectors      | A new array.                                       | 1                                    |
| `new P(p.x, p.y)`, or a `clone()` the class writes | A new instance.                                    | 1 (nothing new)                      |
| `structuredClone(v)` of structs that are no class  | A deep copy.                                       | 1                                    |
| `{ ...p }` of a struct that is no class            | A new object; a field that is an object is shared. | 1 when no field is an object, else 3 |
| `xs.slice()`, `[...xs]` of objects                 | A new array of the same objects.                   | 3                                    |
| `structuredClone(v)` of a class instance           | A plain object with no methods.                    | 3                                    |

- [proposal, agent] Until stage 3, the refusal of the last two rows says what to write instead: a
  loop that constructs each element, or the class's own `clone()`.

## Why

- [fact] OD-9 (`docs/owner-decisions.md`, merged as `cf8beaa5`): a TypeShade program need not
  translate one-to-one into a target language. That a target has no construct for a form is not a
  reason to refuse it. A form is refused only when the compiler does not implement it yet, and
  says so, or when no compilation can give it its meaning. This proposal applies that entry to
  objects.
- [fact] OD-1 says TypeShade is a language of its own that borrows TypeScript's syntax. OD-3 says
  the compiler's work is not pushed onto the author. OD-5 says a parameter qualifier is written
  `@inout` or `@out` before the parameter, and that every other parameter is passed by value.
  **This proposal replaces both statements of OD-5 about a parameter.** Only the owner changes an
  entry; #1321 carries the new entry. OD-5's half on an entry's I/O is not touched.
- [fact] The language already passes one object by reference with no mark: a method that writes its
  object changes the caller's object (Rule 8.10). `p.tick(dt)` changes `p`, and `tick(p, dt)` with
  the same body does not compile without `@inout`.
- [observed result] On 2026-11-16, `compile()` gives:

| Source                                                    | Result today                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `function nudge(p: P): void { p.x += 1.; }`               | `TS8018`: "Cannot write through parameter "p" … declare "@inout p: P"."                              |
| `function h(a: array<f32, 2>): f32 { a[0] = 1.; … }`      | `TS8018`, the same text.                                                                             |
| `function nudge(p: P): f32 { p = new P(); p.x += 1.; … }` | Compiles; `p` is a local (Rule 8.8).                                                                 |
| `const q = a; q.x = 1.;`                                  | `TS8005`: "… which TypeScript would change with it and a copy here would not. Declare it with let …" |
| `let q = a; q.x = 1.;`                                    | Compiles; `q` is a copy. JavaScript would change `a`.                                                |
| `a.tick()` with `tick() { this.x += 1.; }`, `a` a local   | Compiles; `a` changes.                                                                               |
| `for (const p of ps) { p.x = 1.; }`                       | `TS8005`, the same text.                                                                             |
| `a === b` for two instances                               | `TS8003`: "a struct is a value with no identity here, and WGSL compares scalars and vectors only."   |

- [inference, agent] So today's language is already careful. It refuses most forms whose meaning
  would differ from JavaScript's, and it asks the author for a mark (`@inout`, `let`) to pick the
  other meaning. The cost of today's design is not a silent error. The author must learn marks
  that JavaScript does not have, and one silent difference is left: `let q = a` is a copy.
- [inference, agent] The compiler already computes which parameters a function writes (`fnWrites`
  in `src/core/passes/effects.ts`), and already lowers a written reference to a pointer on WGSL
  and `inout` on GLSL ES 3.00 (Rule 8.25). Stage 1 uses both for a function of the file.

**Whether a heap is needed.**

- [fact] The owner asked why a heap would be needed once the program is compiled. The first draft
  listed "a count of live objects the compiler cannot bound" as refused for good. That row was
  wrong and is removed.
- [fact] A live object is referred to by a variable, by a field of another object, or by an array
  element. A function cannot call itself (Rule 8.4), and a struct cannot hold itself. So the
  objects that variables and fields hold have a bound the compiler computes, and the compiler
  gives each a place at compile time.
- [fact] The reviewer of this proposal found the case that sentence does not cover: an array with
  no size. In `ps[i] = ps[j]; ps[i].x = 1`, which elements are one object is known only at run
  time, and the array's length is known only at the call. [inference, agent] It still needs no
  allocation while the program runs: a table of indexes of the array's length, which the call
  makes beside the array, says which place each element names. That table is stage 3's work, and
  until then the form is refused as "not supported yet".
- [fact] Recursive functions and recursive types stay refused by their own rules. This proposal
  does not change them; allowing either would need allocation while the program runs.

**Alternatives.**

| Alternative                                                                | Why it is not proposed                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Keep today's design (every parameter a value; `@inout` and `@out`).        | The owner asked for the change. It is coherent, and it stays the fallback if this proposal is refused. |
| References for arrays only; structs stay values.                           | Two rules for "does the call change my value". The owner asked about every object.                     |
| JavaScript's meaning with silent copies where the compiler cannot keep it. | It breaks the contract above.                                                                          |
| Keep `@inout` for a number or a vector only.                               | A mark JavaScript does not have, kept for 6 parameters in the tree; a returned value says the same.    |

## Owner's decisions

- OD-1: TypeShade is a language of its own; the contract is about an object's identity, and the
  language's other differences from JavaScript stay.
- OD-3: the compiler's work is not pushed onto the author. `@inout` and `@out` say what the
  compiler can read from the function, so they are removed.
- OD-4: the two examples of "What changes" show an author's source before and after.
- OD-5: this proposal carries the rule text of the entry as the owner replaced it on 2026-11-16
  (#1321, `fec0c3a0`). The first draft of this proposal was written against the entry of
  2026-11-09, at the owner's request in the conversation, and the entry was replaced after the
  proposal was accepted.
- OD-9: a form is refused only when the compiler does not implement it yet, and says so, or when
  no compilation can give it its meaning.
- This proposal reverses no entry as the entries stand on `main` at `fec0c3a0`.

## Why the compiler cannot do it

- [fact] The proposal removes two constructs, `@inout` and `@out`, because the compiler can decide
  what they said: `fnWrites` reads which parameters a function writes.
- [fact] It adds two names, `Array.prototype.slice` and `structuredClone` (Amendment A1), and each
  says one thing the compiler cannot decide from the program: that the author wants a **new**
  object and not the one a name already refers to. With `let r = xs`, `r` is the same array, as in
  JavaScript. Whether the author meant the same array or a snapshot of it is the author's intent;
  both programs are valid, and they give different results as soon as one name is written through.
- [observed result] On 2026-11-16, at #1324's `9dc3d135`, three tests of
  `src/core/passes/opt/sink-aggregate-init.test.ts` failed for this reason: their fixture took a
  snapshot with `let result = source`, which now names the same array. The fixture writes
  `source.slice()`.
- [fact] Both names are ECMAScript's and the web platform's, as TypeScript spells them
  (`docs/language-design.md` §2.1). The proposal adds no name of its own and no copy construct
  (decision 2).
- [fact] No downstream repository asked for this change; no issue is linked.

## What it touches

- Rules 1.7 and 1.8: the sentences on a qualifier.
- Rule 6.7: `inout` and `out` leave the list of attributes.
- Rule 6.10: the `TS8005` text and the paragraph on a copy.
- Rule 7.2: the rows on a struct copied by `const w = v`, on the copy of `for (const x of a)`, and
  on `@inout` as a recorded divergence.
- Rule 7.6: the `@out` clause is removed.
- Rules 7.9 and 7.10: an `@inout` argument as a place; an optional value with a qualifier.
- Rule 8.8: a parameter of an object is the caller's object; a whole write makes a local from that
  write on; "there must be no pointer values" becomes a statement about what an author writes.
- Rule 8.10: one rule for `this` and for a parameter.
- Rule 8.17: a captured `@inout` parameter.
- Rule 8.21: what a host call passes for an object.
- Rules 8.22 and 8.23: a kernel's array is the caller's array; the value reading of change 0138
  (A10 Q-A, A15, A16) is withdrawn.
- Rule 8.25: the qualifiers and the list of functions that take values go; the lowering stays.
- Rule 8.28: "a struct parameter is a value on both targets".
- Rule 8.29: a method that changes its object "takes it as `@inout`".
- Rule 9.6 (item 10) and Rule 12.7 (the editor's hover and its `TS2454` filter for a qualifier).
- Surface §1, §6, §7, §9, §14, §23, §26, §28, §44, §49, §52, §64, §65, §70, §71, §73, §74 and §76:
  each names a qualifier or one of the codes below.
- Codes: `TS8018`, `TS8005`, `TS8035` and `TS8003` change their texts; `TS8073` and `TS8075` lose
  their parts about a qualifier; `TS8074` becomes a "not supported yet" refusal until stage 2;
  `TS8080` is removed.
- `src/cli/migrate.ts` and its test: delete a written qualifier. `AUTHORING.md`.
  `examples/reference-parameters.shade.ts` is written again; whether its name stays is settled at
  implementation (the front matter's `examples` changes by an amendment if the set changes).
- Change 0138: slice 2 (#1310) is reverted in its language part; Amendment A19 (#1315) and slice 3
  (#1316) are closed; `return ps` needs no copy; 0138 needs an amendment for R14 and C1.

### Draft impact estimate

- [observed result] Counted on 2026-11-16 at `e7653735`, over 216 `.shade.ts` files of `examples/`,
  `src/algorithms/`, `src/random/` and `journeys/` (735 functions and methods):
  - 114 parameters carry `@inout` or `@out`. 108 are objects: each loses its qualifier and keeps
    its meaning. 6 are a number or a vector (5 in `examples/reference-parameters.shade.ts`, 1 in
    `journeys/class-twins/units.shade.ts`): each function is written again to return its values.
  - 153 parameters are objects with no qualifier. None is written through a member (the compiler
    refuses that today), so no call changes its meaning.
  - 3 `let` locals are initialized from a name and then written through a member; 2 write vector
    components only. The third, `examples/class-syntax.shade.ts:83`, is `let a = Ring.unit`, a
    static getter that returns a fresh object (the reviewer read it). So no `let` in these files
    changes its meaning. The count is a syntactic one; the implementation reads each again.
- [inference, agent] `@out` on a kernel's array let the call skip the upload and fill zeros. After
  the change the compiler must infer "written whole before any read" to skip the upload; where it
  cannot, the upload stays. Cost: unknown until measured.
- [inference, agent] The graph planner of change 0138 (slices 4 to 6) reads calls that write their
  arguments in place. R14's "otherwise it writes a new resource" and A10's conflict C1 are settled
  the other way.
- Unknown: the duration; the size of stages 2 and 3; the code size of the tag-and-branch lowering
  and of the table of indexes.

**Decisions.**

- [fact] On 2026-11-16 the agent showed the owner seven points with a recommended answer for each,
  and asked whether to go on with them. The owner answered "진행하세요" (English translation: go
  ahead). The record has no other words.

1. [decision, owner] An object is a struct, an instance of a class, or an array. A number, a
   `bool`, a vector and a matrix are values.
2. [decision, owner] An author writes a copy with a name JavaScript already has; the language adds
   no copy construct (OD-3). [proposal, agent] Table 3 is the agent's reading of that decision. The
   recommendation the owner saw named `structuredClone(p)` for a struct and `xs.slice()` for an
   array; in JavaScript the first drops a class's methods and the second shares the elements, so
   the table gives each form its JavaScript meaning. The agent reported the correction to the
   owner on 2026-11-16.
3. [decision, owner] Stage 1 may merge alone. A form of a later stage is refused with a text that
   says it is not supported yet (OD-9).
4. [decision, owner] `@out` is removed with no replacement. The compiler infers where an upload can
   be skipped (OD-3).
5. [decision, owner] The pull request that implements stage 1 also removes the value reading of
   change 0138's slice 2 and `TS8080`. No pull request only reverts.
6. [decision, owner] OD-5's statements about a parameter are replaced, in #1321.
7. [decision, owner] A host array whose two elements are one JavaScript object is refused at the
   call with a `TypeError` that names both indexes. [proposal, agent] After the review, the refusal
   is "not supported yet" and stage 3 lifts it (Table 2): a compilation can keep the identity, so
   OD-9 does not allow a refusal for good.
8. [proposal, agent; reported to the owner on 2026-11-16] `@inout` and `@out` on a number or a
   vector are removed with no replacement. Such a function returns its values, as JavaScript
   writes it (the second example above). Stage 1 implements `[a, b] = f(a, b)`.

**Open, owner must settle.**

- [fact] Decisions 2 (Table 3), 7 (the stage) and 8 are the agent's, made after the owner's first
  answer and reported. The owner saw them and said "머지하세요" (Approval and plan record).
- [inference, agent] No statement conflicts with an entry of `docs/owner-decisions.md` other than
  OD-5, which decision 6 replaces: OD-1 (the contract is scoped to identity), OD-3 (no qualifier,
  no copy construct), OD-4 (the two examples), OD-7 and Rule 7.2 (untouched), OD-9 (no form
  refused for a target's sake).

**Independent review record.**

- [fact] Reviewer: an AI agent (Claude Code) that did not write this proposal, on 2026-11-16.
  Revision reviewed: `d6dee2e9`. It found 2 blocking findings, 6 should-fix findings and 2 notes.
  Verdict: approve after fixes. It ran the six sources of the observed-result table again, and
  each matched.

| Finding                                                                                         | Answer                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1. The front matter misses rules, sections, codes and files.                                    | Fixed: 19 rules, 18 sections, `TS8003` and `TS8035`, and the applicability row.                            |
| 2. Rule 8.25's kinds of function that take values; `a.merge(a)`.                                | Fixed: Table 2, and a row of Table 1.                                                                      |
| 3. A whole assignment with a write before it, or from a name.                                   | Fixed: three rows of Table 1.                                                                              |
| 4. `===` and `!==` on objects.                                                                  | Fixed: a row of Table 1; `TS8003`'s text changes at stage 1.                                               |
| 5. Refusals kept for good with no reason OD-9 allows (`TS8074`, decision 7, `structuredClone`). | Fixed: each has a stage. A read-only binding stays refused, with its reason.                               |
| 6. Forms that share an object and have no row.                                                  | Fixed: rows of Tables 1 and 2.                                                                             |
| 7. "No heap is needed" is false as written for an array with no size.                           | Fixed: the section "Whether a heap is needed" states the case and the table of indexes.                    |
| 8. The contract is wider than the language.                                                     | Fixed: scoped to identity and sharing; Rule 7.2's divergences stay.                                        |
| 9. Decision 2's label; OD-5's "by value" sentence.                                              | Fixed: Table 3 is labelled the agent's; #1321 replaces both statements.                                    |
| 10. The `let` candidate, `tshc migrate`, the baseline.                                          | Fixed: the candidate is read and is no change; `migrate.ts` is listed as new work; the baseline is stated. |

- [fact] No review has read the revision that answers this review.

### Approval and plan record

- [decision, owner, 2026-11-16] Shown the revision `ac2bf764` in the conversation, with the three
  points the agent settled after the seven decisions (Table 3, the stage of decision 7, decision
  8), the owner answered "머지하세요" (English translation: merge it). The record has no other
  words. The approved revision is the one this pull request (#1317) merges.
- Scope approved: the rule and the contract of "What changes", Tables 1 to 3 with their stages,
  and decisions 1 to 8.
- Responsibilities: the agent implements stage 1 in its own pull request, which also removes the
  value reading of change 0138's slice 2 (decision 5). Stages 2 and 3 each get their own pull
  request. The owner says "merge" for each pull request that changes how an author writes an
  example (CLAUDE.md, Merging).
- Milestones: stage 1, stage 2, stage 3, in that order. No duration is established.
- Before stage 1 starts: #1321 (OD-5) merges; #1315 and #1316 are closed; change 0138 gets an
  amendment that withdraws A10 Q-A's value reading, A15, A16 and A19's plan.
- Required evidence at delivery: for each row of Tables 1 to 3 that a stage implements, a test of
  both halves on one source (Rule 12.7); for each row it does not, a test of the "not supported
  yet" refusal in both halves; the gates of `AGENTS.md`; the document audit of the rules and
  sections of the front matter, with their Doorstop items.

### Configuration and validation record

This record does not yet apply; delivery will require the tests of both halves for each row of the
table of forms, the gates of `AGENTS.md`, and the document audit of the rules and sections above.

## Amendments

### A1. The names of Table 3 in the front matter (2026-11-16)

- [fact] Why. Table 3 gives `xs.slice()` and `structuredClone(v)` their JavaScript meaning at stage
  1. Each is a name an author could not write before, so the front matter lists it under `names`
     (`changes/README.md`): `scripts/changes.ts` and `src/author-names.test.ts` refuse an added name
     that no accepted proposal lists. The first draft of the front matter had no `names`.
- [fact] How it was found. #1324 (stage 1) added `Array.prototype.slice` to the ambient library at
  `483ac8d5`, and `src/author-names.test.ts` failed in CI at `518ba043`: "the set of
  author-facing names changed; added: Array.prototype.slice".
- [fact] Both names come from ECMAScript and the web platform as TypeScript spells them
  (`docs/language-design.md` §2.1); neither is a name of the compiler's own.
- [fact] This amendment changes the front matter `names`, and adds the sections "Owner's
  decisions" and "Why the compiler cannot do it" that `changes/TEMPLATE.md` asks of a proposal that
  adds a name; the first draft was written from an older copy of the template and had neither. It
  changes no rule text and no code. Nothing here is a new design: Table 3 and decision 2 are the approved text.
- [fact] Not listed: `[...xs]` and `{ ...p }` are syntax and add no name. `clone()` is a method an
  author's class writes.
- Status: `status: accepted` does not change.

## What it owes downstream

- **typeshade.github.io.** Every page and Playground starter that writes `@inout` or `@out`; the
  reference pages of Rules 8.8, 8.23 and 8.25; in English and in Korean.
- **vscode-typeshade.** The skill's references and snippets that write a qualifier.
- **typenn, typecv, typeaudio, radiance.** Each searches its tree for `@inout` and `@out`. None has
  been searched yet.

Expected work is described; responsibilities are recorded at acceptance.
