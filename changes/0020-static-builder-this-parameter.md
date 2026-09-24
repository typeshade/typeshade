---
id: '0020'
title: A static builder that returns the class the call names says so with a `this` parameter, so the editor types `Big.unit()` as `Big` as the compiler does
status: draft
rules:
- '8.13'
surface:
- 26
exports: []
exports-removed: []
codes: []
examples:
- class-builder
downstream:
- repo: typeshade.github.io
  what: The class pages that show a static builder with new this(), and the Playground's and the gallery's copy of class-builder, in en and ko
---

<!-- doc-refs: skip-file — a proposal names the tests and the messages it will add, which this tree does not have yet -->

## What changes

A static member that builds its value with `new this()` runs, in TypeScript, with `this` as the
class the call names: `Capped.unit()` builds a `Capped`. Rule 8.13 makes the compiler follow
that. When such a static is declared to return the class that declares it, the compiler lowers
`Disc`'s body again for `Capped`, and the call returns a `Capped`:

```ts
class Disc {
  static SIZE = 0.2;
  static unit(): Disc {
    let d = new this();
    d.size = this.SIZE;
    return d;
  }
}
class Capped extends Disc { static SIZE = 0.35; set size(r: f32) { … } }

let b = Capped.unit();   // compiler: Capped. Editor: Disc, the return type written above.
b.size *= 2.;            // compiler: Capped's setter, which clamps. Editor: Disc's.
```

TypeScript reads `: Disc` and types the call `Disc`. So the two halves disagree about the type of
`b`, and about which accessor `b.size` runs. The 0015 gate lists this as its last class C
divergence (`.unit() | Capped | Disc`). Rule 12.7 says an expression's type in the editor must
be the compiler's.

After this change, a static that returns the class the call names says so in TypeScript's own
words. It takes a `this` parameter whose type has a construct signature returning a type
parameter bounded by the declaring class, plus the statics the body reads through `this`:

```ts
static unit<C extends Disc>(this: { new (): C; SIZE: f32 }): C {
  let d = new this();
  d.size = this.SIZE;
  return d;
}
```

TypeScript binds `C` to the class the call names and types `Capped.unit()` as `Capped`. This was
measured on the language service as it is today: its hover reads `Disc.unit<Capped>(…)`, and it
reports nothing. The compiler already lowers the body once per class the call names (Rule 8.13).
For this form it:

- takes the `this` parameter as a type only, as it already does for a `function` expression's
  `this` parameter (surface §26, "A field that holds a function"); it is not a parameter of
  `Owner_unit`;
- binds `C` to that class.

Today the compiler refuses the type literal with `TS8002` ("Unsupported type syntax"). That
refusal is what this change lifts, for this position only.

The form Rule 8.13 accepts today, a static declared to return the declaring class that builds
its value with `new this()`, is refused with `TS8035 CLASS_MEMBER`. The message names the form
above as the remedy:

```
"Disc.unit" builds its value with "new this()", so "Capped.unit()" returns a Capped, but it is
declared to return a Disc, which is the type the editor gives the call. Declare the class the
call names: static unit<C extends Disc>(this: { new (): C; SIZE: f32 }): C
```

The refusal applies only where the two halves would disagree: some class that extends the
declaring one inherits the static. A static no class inherits keeps compiling as it is, since
its caller is always the declaring class.

## Why

Rule 8.13 chose the run-time object over the declared type, which is right for what the program
computes. But the editor cannot follow it: TypeScript reads a written return type as written.
There are three ways to make the halves agree:

1. **Have the compiler return the declared class.** This breaks what the program computes, and
   Rule 8.13's rationale: `Capped.unit()` would build a `Capped` and hand back a `Disc`, and a
   struct cannot narrow to its base.
2. **Have the projection rewrite the return type.** The projection only inserts text
   (`projection.ts`); replacing `Disc` with `Capped` is a different mechanism, and one call site
   can name several classes.
3. **Ask for TypeScript's own spelling of "the class the call names" (this proposal).** It
   adds no name an author did not already have (Rule 2.2: `this` parameters, type parameters and
   type literals are TypeScript's), and it is what TypeScript code writes for the same builder
   pattern.

Before `0.1.0` nothing is published, so the refusal needs no deprecation window (Rule 13.9).

## What it touches

- **Rule 8.13.**
  - The clause "a static that builds its value with `new this(...)` and is declared to return
    the class that declares it returns `D`" becomes the `this` parameter form.
  - The declared-base form, when a class that extends the declaring one inherits the static,
    joins the rule's refusals.
  - The rule's Enforced-by gains the tests below.
- **Surface §26.** "Statics through a class that extends, `new this()`, and `super` in a static
  member": the example's `static unit(): Shape` becomes the `this` parameter form, the prose
  says why, and the refusal is quoted.
- **Example `class-builder`.** `Disc.unit` takes the form. Its emit does not change: the goldens
  are the proof that only the spelling moved.
- **Codes.** None added or renumbered. `TS8035` gains one message, and `TS8002` no longer fires
  on this one position.
- **Tests that will pin it**, each reading both halves (CLAUDE.md, "A test reads both halves"):
  - In `src/compiler/ts/class-syntax.test.ts`:
    - the form compiles, and `Capped.unit()` is a `Capped` in `compile()`'s expressions and in
      the language service's hover;
    - the declared-base form draws the new `TS8035`, and so does the editor, since the
      language service merges the compiler's diagnostics;
    - a static no class inherits still compiles with `: Disc`.
  - In `src/language-service/expression-parity.test.ts`, the row `.unit() | Capped | Disc` leaves
    KNOWN, which empties class C.
  - The three CPU paths hold `class-builder` to one value, as they do today.

## What it owes downstream

- **typeshade.github.io.** The class pages that show a static builder, and the Playground's copy
  of `class-builder`, take the new spelling on the next compiler pin. `downstream-impact.ts`
  lists the pages that quote `static unit(): …` with `new this()`. No name is removed, so none of
  them breaks the build; each one's text changes.
- **vscode-typeshade.** Nothing. Quick info passes through and shows `Capped` where it showed
  `Disc`.
