---
id: '0004'
title: The editor types a function whose body returns vector arithmetic as the compiler does
status: implemented
rules: []
surface:
- 14
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

## What changes

Two earlier changes meet here:

- Since #195, a function that writes no return type returns what its body does (Rule 8.19).
- Since #217, the language service writes the front end's type into a local built by vector
  arithmetic (`projection.ts`, #162).

They do not reach each other. TypeScript types every arithmetic result `number`, so a function
whose `return` does arithmetic on a vector is a `number` in the editor, while the compiler
knows it is the vector. On this program the compiler accepts, the language service reports
five errors today:

```ts
function glow(p: vec2) {
  return p * 0.5;
}
class Orbit {
  r: f32 = 1.;
  at(t: f32) {
    return vec2(cos(t), sin(t)) * this.r;
  }
  get twice() {
    return vec2(this.r) * 2.;
  }
}
function tint(c: vec2): f32 {
  return c.x;
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const o = new Orbit();
  const half = (q: vec2) => q * 0.5;
  const a = glow(uv).x + tint(glow(uv)) + o.at(1.).y + o.twice.x + half(uv).x;
  return vec4(a, 0., 0., 1.);
}
```

```text
TS2339 Property 'x' does not exist on type 'number'.                  glow(uv).x
TS2345 Argument of type 'number' is not assignable to parameter of     tint(glow(uv))
       type 'vec2'.
TS2339 Property 'y' does not exist on type 'number'.                  o.at(1.).y
TS2339 Property 'x' does not exist on type 'number'.                  o.twice.x
TS2339 Property 'x' does not exist on type 'number'.                  half(uv).x
```

Completion after `glow(uv).` offers nothing, and hover says `number`. Surface §14 tells the
author to write `: vec2`.

After this change the projection also writes the return type into the text TypeScript reads.
It does so for each function that writes no return type, where:

- its `return`, or an arrow function's expression body, does arithmetic;
- the front end's type for its return is an `f32`, `i32` or `u32` vector, or an `f32` matrix.

That covers a function of the file or of a namespace, a method, a getter, a field that holds a
function, and an arrow function or a function expression, local or handed to a call. So
TypeScript reads `function glow(p: vec2): vec2 { … }` and `(q: vec2): vec2 => q * 0.5`. Every
answer maps back to the text as written, as #217 does for a local. The five errors go, and
completion and hover say `vec2`.

Plain `tsc` has no service in front of it and still types the function `number`. The README
lists that among the classes it reports.

## Why

#195 made leaving the return type off the ordinary way to write a helper. The editor is where
an author meets the language first (surface §49, Rule 12.7). A red squiggle on a program that
compiles is the failure §49 calls the worse one: it stops an author who was right.

The type the projection writes is the one the compiler inferred. The front end already records
it for hover (`CompileTsSourceResult.symbols`, a `function` symbol's type), so nothing is typed
twice.

The alternative was to keep §14's advice to write `: vec2`. That makes the author write what
the compiler already knows, which is what #217 removed for a local.

## What it touches

- **Rules.** None. Rule 12.7 (one vocabulary between the service and the compiler) already
  asks for this, and Rule 8.19 is unchanged.
- **Surface §14.** The editor paragraph of "A return type left off is the body's to say" now
  says the language service types the function as the compiler does. `: vec2` is needed only
  for plain `tsc`.
- **No export, code or example set changes.** `planInsertions` keeps its signature and is not
  in `src/__api__/surface.md`.
- **Prose outside the criteria, in the same change:**
  - the #162 section of `docs/language-service-api.md`;
  - the README's "Not covered" line;
  - `examples/inferred-returns.shade.ts`, which returns a product directly and drops its #162
    note;
  - `examples/path-tracer.shade.ts`, whose #162 note has been untrue for its locals since #217,
    and whose runtime-bound note has been untrue since #209.
- **Tests.** `src/language-service/projection.test.ts` pins the program above to no diagnostic.
  It also pins hover, completion, references, rename and semantic tokens across an inserted
  return type, and leaves alone a function whose return type is written, or whose return does
  no arithmetic. The editor-silence cases of `src/compiler/ts/return-inference.test.ts` gain a
  product. The journey gate's editor check covers a journey helper that returns one.

## What it owes downstream

Nothing:

- **vscode-typeshade.** The VS Code extension and the tsserver plugin serve the compiler's own
  service (`createTypeshadeLanguageService`), so the change reaches them with the pin. Neither
  their docs nor the skill describe the workaround.
- **typeshade.github.io.** The Playground uses the same service, and no page tells an author to
  write the return type for the editor's sake.
