---
id: '0003'
title: A setter with no type takes the type its getter's body returns
status: accepted
rules:
- '8.19'
surface:
- 14
- 26
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

## What changes

Since #195 a getter with no return type returns what its body does (Rule 8.19). The setter
beside it still needs a type from somewhere. When neither half writes one, the setter's value is
refused:

```ts
class Gauge {
  v: f32 = 0.;
  get x() {
    return this.v * 2.;
  }
  set x(n) {
    this.v = n / 2.;
  }
}
```

```text
TS8002 The setter "Gauge.x" needs a type for "n": write "set x(n: T)", or give the getter a
return type.
```

After this change the setter's value takes the type the getter returns, written or inferred,
as TypeScript types it. TypeScript 5.6 types `n` as `number` here, with no diagnostic under
`strict`.

An assignment that needs the setter's type before the getter's body has been lowered lowers
that body first, as Rule 8.19 already does for a call. So `g.x = 4.` compiles wherever it is
written. So does `g.x += 1.`, which reads through the getter and writes through the setter
(Rule 8.11).

Still refused, each with the fix:

- **A setter whose value has no type and that has no getter.** TypeScript types it `any` and
  reports TS7032 and TS7006 under `noImplicitAny`. The message drops "or give the getter a
  return type": `TS8002 The setter "Gauge.y" needs a type for "n": write "set y(n: T)".`
- **A setter whose value has no type, beside a getter that returns nothing.** Its value would
  be a `void`. The fix is the setter's type.

## Why

TypeScript code writes an accessor pair's type once, if at all. #195 made the getter's body say
it and left its setter refused, which the rules recorded as a known gap: the refusal in Rule
8.19 and the §14 note "since no call says what it takes". The getter is the call that says it.
The lazy body fill that Rule 8.19 already uses answers it the same way it answers a call.

The alternative was to keep the refusal. It is one sentence, and the fix works. But it is the
only place where a class written without annotations still stops.

## What it touches

- **Rule 8.19.** The refusal "a setter's value with no type beside a getter with none" becomes:
  - a setter's value takes the type its getter returns, written or inferred;
  - a setter's value with no type and no getter, or beside a getter that returns nothing, must
    be refused.
- **Surface §14.** The refusal list at the end of "A return type left off is the body's to say"
  loses the setter.
- **Surface §26.** "Getters and setters" gains an unannotated pair. Its refusal list names what
  is still refused. That list's "a getter with no type from either half (annotate it)" has been
  untrue since #195 and is corrected here.
- **Codes.** None. `TS8002` stays for the refusals, and its message loses the getter half where
  there is no getter (Rule 12.5).
- **Examples.** None are added. `examples/inferred-returns.shade.ts` gains the unannotated pair,
  a content change the compile gate already covers.
- **Tests.**
  - `src/compiler/ts/return-inference.test.ts`: its setter case compiles now. It is held to one
    value across WGSL, GLSL ES 3.00, the CPU oracle, the codegen and the debugger, and against
    the program that writes the types.
  - `src/compiler/ts/class-syntax.test.ts`: pins the two refusals.

## What it owes downstream

Nothing. Neither repository describes the refusal. The site's getter row writes both types, and
the editor's skill says only that classes have getters and setters.
