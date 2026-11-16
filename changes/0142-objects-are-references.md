---
id: '0142'
title: A struct, a class instance and an array behave as a JavaScript object does, so a function that writes its parameter changes the caller's value, and `@inout` and `@out` are removed
status: draft
rules:
  - '7.6'
  - '8.8'
  - '8.10'
  - '8.23'
  - '8.25'
surface:
  - 7
  - 14
  - 52
  - 65
  - 70
exports: []
exports-removed: []
codes:
  - TS8005
  - TS8018
  - TS8073
  - TS8074
  - TS8075
  - TS8080
examples: []
downstream:
  - repo: typeshade.github.io
    what: Every page and Playground starter that writes `@inout` or `@out`, or that explains that a parameter is a value, is written again; the reference pages for Rules 8.8, 8.23 and 8.25 change, in English and in Korean, when the compiler pin passes this change.
  - repo: vscode-typeshade
    what: The skill's references and snippets that write `@inout` or `@out` change; compiler-changes.md records 0142 when the pin moves.
  - repo: typenn
    what: Each kernel and helper that writes `@inout` or `@out` drops the qualifier; compiler-changes.md records 0142 when the pin moves. Not yet searched.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0142, `status: draft`.                                                                                                                                                                                                                |
| Date and attribution          | 2026-11-16 (UTC), the date of this draft. Written by an AI agent (Claude Code) from the owner's statements in the conversation of that date, which are quoted below. The owner has not approved it.                                            |
| Applicability / Effectivity   | The front end (`src/compiler/ts/`), the three backends through the IR's parameter modes, the host call layer (`src/core/host-kernel.ts`), `docs/language-design.md`, `docs/use-typeshade-surface.md`, `reqs/`. No release version is assigned. |
| Review baseline               | `main` at `e7653735`.                                                                                                                                                                                                                          |
| Review and revision authority | No pull request was assigned when this text was written. Git records revisions; the pull request's review and merge record decisions.                                                                                                          |

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
- [proposal, agent] The rule, in one sentence: **an object behaves as it does in JavaScript.** An
  object is a struct, an instance of a class, or an array (with a size or with none). A number, a
  `bool`, a vector and a matrix are values, as a JavaScript primitive is.
- [proposal, agent] The compiler's contract, in one sentence: **a program never runs with a meaning
  JavaScript would not give it.** Where the compiler implements the JavaScript meaning, the program
  runs. Where it does not yet, the program is refused with a diagnostic that says so. The contract
  lets the implementation arrive in stages while the language keeps one meaning.

**One example, before and after.**

Before (`main` at `e7653735`):

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

**What each form means after the change.**

| Form                                                                         | JavaScript                         | After this change                                                                 | Stage |
| ---------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | ----- |
| `f(p)` where `f` writes `p.x` or `p[i]`                                      | The caller's object changes.       | The same. The compiler passes the place (a pointer on WGSL, `inout` on GLSL).     | 1     |
| `f(p)` where `f` assigns `p` whole                                           | The caller's object does not move. | The same: the name is rebound to a local (Rule 8.8's local, kept).                | 1     |
| `return p` of a parameter                                                    | The same object.                   | The same: no copy; the caller's name and the result name one object.              | 1     |
| `const q = p; q.x = 1`                                                       | `p.x` is 1.                        | The same: `q` is a second name of `p`.                                            | 1     |
| `let q = p; q.x = 1`, `q` never assigned again                               | `p.x` is 1.                        | The same.                                                                         | 1     |
| `arr[i] = p`, `a.child = p`, with no later write that both names can see     | No difference from a copy.         | A copy; the result is JavaScript's.                                               | 1     |
| `let q = p; q = r; q.x = 1`                                                  | `r.x` is 1.                        | The same, where the compiler can name the object at each write.                   | 2     |
| `let q = k > 0 ? a : b; q.x = 1`                                             | One of `a.x`, `b.x` is 1.          | The same, by a tag and a branch over the finite set of objects.                   | 3     |
| `a.child = b; b.x = 1` then a read of `a.child.x`                            | 1.                                 | The same, where the compiler can keep one storage for both names.                 | 3     |
| A count of live objects the compiler cannot bound                            | Allocated on the heap.             | Refused for good: a shader has no heap.                                           | never |
| An object in a storage buffer, across two dispatches or across the host call | —                                  | A value: a buffer holds values, as a message between two JavaScript workers does. | never |

- [proposal, agent] A form whose stage is not implemented yet is refused, with a text that names the
  form and says it is not supported yet. It never compiles to a copy that JavaScript would not make.
- [proposal, agent] `@inout` and `@out` are removed. A file that writes one is refused with a text
  that says to delete it. `tshc migrate` deletes them.
- [proposal, agent] A kernel function's array parameter is the caller's array, as it was before
  change 0138's slice 2: a write to it is seen by the host. `return ps` gives the host the same
  array, or the same `Buffer`. A caller that wants the old values kept passes a copy
  (`step(old.slice(), dt)`).

## Why

- [fact] `docs/owner-decisions.md` OD-1 says TypeShade is a language of its own that borrows
  TypeScript's syntax. OD-3 says the compiler's work is not pushed onto the author. OD-5 says a
  parameter qualifier is written `@inout` or `@out` before the parameter. **This proposal replaces
  the parameter half of OD-5.** Only the owner changes an entry; the owner asked for this in the
  conversation quoted above. The entry's other half (an entry's I/O stays in the type) is not
  touched.
- [fact] The language already passes one object by reference with no mark: a method that writes its
  object changes the caller's object (Rule 8.10). `p.tick(dt)` changes `p`, and `tick(p, dt)` with
  the same body does not compile without `@inout`.
- [observed result] On 2026-11-16, at `main` `e7653735`, `compile()` gives:

| Source                                                    | Result today                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `function nudge(p: P): void { p.x += 1.; }`               | `TS8018`: "Cannot write through parameter "p" … declare "@inout p: P"."                              |
| `function h(a: array<f32, 2>): f32 { a[0] = 1.; … }`      | `TS8018`, the same text.                                                                             |
| `function nudge(p: P): f32 { p = new P(); p.x += 1.; … }` | Compiles; `p` is a local (Rule 8.8).                                                                 |
| `const q = a; q.x = 1.;`                                  | `TS8005`: "… which TypeScript would change with it and a copy here would not. Declare it with let …" |
| `let q = a; q.x = 1.;`                                    | Compiles; `q` is a copy. JavaScript would change `a`.                                                |
| `a.tick()` with `tick() { this.x += 1.; }`                | Compiles; `a` changes.                                                                               |

- [inference, agent] So today's language is already careful: it refuses most forms whose meaning
  would differ from JavaScript's, and it asks the author for a mark (`@inout`, `let`) to pick the
  other meaning. The cost of today's design is not a silent error. It is that the author must
  learn two marks that JavaScript does not have, and that the one silent difference left is
  `let q = a`, a copy.
- [inference, agent] The compiler already computes which parameters a function writes
  (`fnWrites` in `src/core/passes/effects.ts`), and already lowers a written reference to a pointer
  on WGSL and `inout` on GLSL ES 3.00 (Rule 8.25's lowering). Stage 1 uses both; it adds no new
  lowering.
- [fact] A shader has no heap, so each name of an object can refer to one of a finite set of
  objects that the compiler can list. That is why the later stages are a matter of implementation
  and not of what the language can express.

**Alternatives.**

| Alternative                                                                | Why it is not proposed                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Keep today's design (every parameter a value; `@inout` and `@out`).        | The owner asked for the change. It is coherent, and it stays the fallback if this proposal is refused. |
| References for arrays only; structs stay values.                           | Two rules for "does the call change my value". The owner asked about every object.                     |
| JavaScript's meaning with silent copies where the compiler cannot keep it. | It breaks the contract above: a program would run with a meaning JavaScript does not give it.          |

## What it touches

- Rule 8.8: a parameter of an object is the caller's object; the rule on a whole write (a local)
  stays; "there must be no pointer values" becomes a statement about what an author writes.
- Rule 8.10: the same rule now covers `this` and a parameter; the text is joined or cross-cited.
- Rule 8.23: a kernel's array is the caller's array; the value reading of change 0138 (A10 Q-A,
  A15, A16) is withdrawn.
- Rule 8.25: `@inout` and `@out` are removed; what stays is the lowering and the alias rule.
- Rule 7.6: the `@out` clause is removed.
- Surface §7 (the diagnostics table), §14 and §52 (parameters), §65 and §70 (kernels).
- `TS8018` and `TS8005`: texts that offer `@inout` or "declare it with let" change. `TS8073` and
  `TS8075`: the parts about a qualifier go. `TS8074` (two references to one place in one call)
  stays, with a text that needs no qualifier to explain it. `TS8080` is removed.
- Change 0138: slice 2 (#1310) is reverted in its language part; Amendment A19 (#1315) and slice 3
  (#1316) are withdrawn or rewritten; `return ps` needs no copy.

### Draft impact estimate

- [observed result] Counted on 2026-11-16 at `e7653735`, over 216 `.shade.ts` files of `examples/`,
  `src/algorithms/`, `src/random/` and `journeys/` (735 functions and methods):
  - 114 parameters carry `@inout` or `@out`. Each loses its qualifier and keeps its meaning.
  - 153 parameters are objects with no qualifier. None is written through a member (the compiler
    refuses that today), so no call changes its meaning.
  - 3 `let` locals are initialized from a name and then written through a member; 2 write vector
    components only. 1 is a candidate for a changed meaning: `examples/class-syntax.shade.ts:83`.
    Each is read by a person before the change.
- [inference, agent] `@out` on a kernel's array let the call skip the upload and fill zeros. After
  the change the compiler must infer "written whole before any read" to skip the upload; where it
  cannot, the upload stays. Cost: unknown until measured.
- [inference, agent] The graph planner of change 0138 (slices 4 to 6) reads calls that write their
  arguments in place. R14's "otherwise it writes a new resource" and A10's conflict C1 are settled
  the other way; 0138 needs an amendment.
- Unknown: the duration; the size of stages 2 and 3; the code size of the tag-and-branch lowering.

**Decisions needed before acceptance.**

1. What an object is: struct, class instance and array; vectors and matrices stay values.
2. `let q = p` becomes a second name of `p`. How an author writes a copy of a struct: candidates
   are a spread into a constructor, a `clone()` the compiler gives every class, or
   `structuredClone(p)`. For an array, `xs.slice()`.
3. Whether stage 1 may merge alone, with stages 2 and 3 refused by a diagnostic.
4. `@out`: removed with no replacement, or kept as an optional promise "the function writes it
   whole" for a kernel's array.
5. The order against change 0138: revert slice 2 first, or implement stage 1 and remove both
   together.
6. The new text of OD-5, in the owner's words.

### Approval and plan record

This record does not yet apply; acceptance will require the owner's decision on the six points
above and a merge of this proposal as `accepted`.

### Configuration and validation record

This record does not yet apply; delivery will require the tests of both halves for each row of the
table of forms, the gates of `AGENTS.md`, and the document audit of the rules and sections above.

## What it owes downstream

- **typeshade.github.io.** Every page and Playground starter that writes `@inout` or `@out`; the
  reference pages of Rules 8.8, 8.23 and 8.25; in English and in Korean.
- **vscode-typeshade.** The skill's references and snippets that write a qualifier.
- **typenn, typecv, typeaudio, radiance.** Each searches its tree for `@inout` and `@out`. None has
  been searched yet.

Expected work is described; responsibilities are recorded at acceptance.
