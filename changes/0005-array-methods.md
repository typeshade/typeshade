---
id: '0005'
title: An array's map, reduce, some, every and forEach take a function, as TypeScript's do
status: implemented
rules:
- '2.1'
- '7.2'
- '8.18'
surface:
- 14
- 63
exports: []
exports-removed: []
codes: []
examples:
- array-methods
downstream:
- repo: typeshade.github.io
  what: The control-flow page's loop copy and its item on array methods (en and ko), and the new array-methods example in the gallery, the Playground picker, the stills and the Korean blurbs
- repo: vscode-typeshade
  what: The skill's sentence on JavaScript array methods and its TS8099 row, and the xs.map rows of references/language.md and references/diagnostics.md
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Today every method of a JavaScript array is refused, whatever it is:

```text
TS8099 JS Array method ".map" is not a shader op. Use sum/min/any/all/zip/fill.
```

After this change, five methods of ECMAScript's `Array.prototype` compile, and run as TypeScript
runs them. They work on an `array<T, N>`, and all but `map` also work on a runtime-sized
storage array (`storage<array<T>>`):

| Written              | Its value          | What it does                                                                |
| -------------------- | ------------------ | --------------------------------------------------------------------------- |
| `xs.map(f)`          | `array<R, N>`      | `f(value, index, array)` for each element; `R` is what `f` returns          |
| `xs.forEach(f)`      | nothing            | `f(value, index, array)` for each element, as a statement                   |
| `xs.some(p)`         | `bool`             | whether `p` holds for an element, stopping at the first that passes         |
| `xs.every(p)`        | `bool`             | whether `p` holds for every element, stopping at the first that fails       |
| `xs.reduce(f, init)` | the type of `init` | `acc = f(acc, value, index, array)` from `init`, left to right              |
| `xs.reduce(f)`       | `T`                | the same, starting from the first element, on an `array<T, N>` with `N` ≥ 1 |

```ts
class Light {
  pos: vec2;
  radius: f32;
  power: f32;
}
declare const lights: storage<array<Light>>;

@fragment
export function fs(@location(0) p: vec2): vec4 {
  const weights: array<f32, 4> = [0.1, 0.2, 0.3, 0.4];
  const scaled = weights.map((w, i) => w * f32(i + 1));
  const total = scaled.reduce((acc, w) => acc + w, 0.);
  const lit = lights.some((l) => distance(l.pos, p) < l.radius);
  let glow = 0.;
  lights.forEach((l) => {
    glow += l.power / (1. + distance(l.pos, p));
  });
  return vec4(glow * total, lit ? 1. : 0., 0., 1.);
}
```

The function is handed over as Rule 8.18 hands one to a function that takes a function: by its
name, or as an arrow function or a function expression written in the call. It is typed by the
array:

- `value` is the element type;
- `index` is an `i32`, the type an unannotated counter has (Rule 7.5);
- `array` is the array itself.

It may leave parameters off at the end. One that writes no return type returns what its body
does (Rule 8.19). What it captures, the method passes to each call, by reference where it
writes it. `reduce`'s `init` has the type of the function's first parameter where that is
written, and otherwise its own type. A written `0` that nothing declares an integer is an `f32`
(Rule 5.1).

**What it lowers to.** Each call becomes a function of the module, one for each array type and
function handed over. Its counted loop over the array's indices (Rule 7.5) calls the function,
and `some` and `every` return from it at the first element that decides them. So `xs.map(sq)`
is a call of a function like this one:

```wgsl
fn array_map_sq(xs: array<f32, 4>) -> array<f32, 4> {
  var out: array<f32, 4>;
  for (var i: i32 = 0; i < 4; i++) {
    out[i] = sq(xs[i]);
  }
  return out;
}
```

A method call is an expression, and a loop is a statement. A function of the module is a call
anywhere a call may stand: in an argument, on the right of `&&`, or in a loop's condition. None
of those has room for a loop written in place. Every target and the CPU oracle already run such
a function, and the IR gains no node (Rule 11.1).

**The array is read as it goes, as TypeScript reads it.** An element that the function writes
before the loop reaches it is read with the write:

- A module variable or a binding is read in place.
- Any other array is passed to the loop by value.
- If the function handed over writes the variable that holds the array, that variable is passed
  once, by reference: the pointer the function writes through is the one the loop reads.

This is the one-variable-one-pointer rule of Rule 8.18.

**Still refused, each naming what to write:**

- **The other methods** (`filter`, `find`, `slice`, `concat`, `push`, `sort`, `includes`, …).
  The message names the five and `for (const x of xs)`. An array's length is fixed, and a
  search or a copy is a loop.
- **`map` on a runtime-sized array.** Its value would be a runtime-sized array, which exists
  only in storage. The fix is `forEach` writing into a storage binding.
- **`reduce` with no `init` on an array that may be empty** (runtime-sized, or `N` = 0).
  TypeScript throws a `TypeError` there, and a shader cannot throw.
- **A second argument to `map`, `forEach`, `some` and `every`** (`thisArg`). An arrow function
  reads `this` already.
- **Every refusal Rule 8.18 makes of a function handed over.** These are a function that does
  not fit, a builtin or a generic function by its name, and a choice at run time. The same goes
  for `map`'s function returning nothing, and for `forEach`'s value used.

The editor types all of it. The ambient library declares the five on `array<T, N>`, with
`index: i32`.

## Why

A TypeScript author reaches for these methods before writing a loop. Over a storage buffer,
`data.reduce((a, x) => a + x, 0.)` is how one says "sum", and `lights.some(...)` is how one
says "any". The folds (`sum`, `any`, `all`, `none`, `zip`) cover part of that under names the
author has to learn, the §9.3 rows. They are unrolled, and they take a fixed-size array only.
`for (const x of xs)` (#216) covers the rest, as a statement. The five methods are ECMAScript's
own names, so they need no row of §9.3 (Rule 2.1(b)).

Alternatives considered:

- **Unroll each call into one call per element, as the folds do.** That needs no function.
  `src/compiler/ts/array-hof.ts` sketched it for a free `map(xs, f)` and `reduce(xs, init, f)`,
  and was never wired in. But the code grows with `N`, and a runtime-sized storage array has no
  `N`, which is the case a compute kernel meets first.
- **Write the loop into the calling body, as `for…of` is written.** This is exact. But a method
  call sits inside an expression, and the loop condition and the right side of `&&` have
  nowhere to put a loop. This is the same reason `sequence.ts` refuses a writing call deep in a
  loop condition.
- **Keep the refusal, and name `for…of`.** This leaves the gap.

The folds stay as they are. They are shorter to write where they fit, and nothing here changes
them.

## What it touches

- **Rule 2.1.** Source (b) gains "a method `Array.prototype` has, written on an array (surface
  §63)". Its "Enforced by" gains the `surface-names.test.ts` case that pins the methods the
  library declares on `array` against the running engine's `Array.prototype`, as the `Math`
  and `console` stand-ins are pinned.
- **Rule 7.2.** Rows for the five, and the divergences:
  - `index` is an `i32` where TypeScript passes a `number`;
  - `map`'s value is an array value, not a new object, as every array here is.
- **Rule 8.18.** An array's method takes a function the same way, compiled once for each array
  type and function. It also gains the sentence that a variable both sides reach is passed once
  (shared with proposal 0002, which writes it first if it lands first).
- **Surface §63 (new).** "An array's methods". It is the next free number by Rule 3.7: §62 is
  the last section, and the gaps at §41 and §56 to §61 are never reused. No open branch claims
  §63. It covers the five, what each lowers to, how the array is read, and the refusals, with
  snippets the doc-snippet suite compiles.
- **Surface §14.** "A function that takes a function" points to §63 beside the folds.
- **Example `examples/array-methods.shade.ts` (new, renderable).** It is in the compile gate,
  with its goldens.
- **The ambient library** (`src/language-service/ambient.ts`) declares the five on `array<T, N>`,
  and `TYPE_DOCS`' `array` entry mentions them. This changes no export: `SHADE_DTS` and
  `TYPE_DOCS` keep their types in `src/__api__/surface.md`.
- **Codes.** None are added or removed. The refusals use `TS8099`, `TS8003` and `TS8019`, with
  new text (Rule 12.5).
- **`src/compiler/ts/array-hof.ts`,** which nothing imports, is deleted.
- **Tests.**
  - A new `src/compiler/ts/array-methods.test.ts` holds WGSL, GLSL ES 3.00, the CPU oracle, the
    codegen and the debugger to one value for:
    - each method, on a fixed-size array and on a runtime-sized one;
    - captures by value and by reference;
    - a function that writes the array ahead of the loop;
    - each refusal.
  - `surface-names.test.ts` gains its case.
  - The `rejects xs.map` case of `array-dx.test.ts` becomes a refusal of `filter`.
  - A journey over a storage buffer shows it on WebGPU and the CPU oracle.

## What it owes downstream

- **typeshade.github.io**
  - The control-flow page, in `src/i18n/en.ts` and `src/i18n/ko.ts`. `loopP` says to "avoid
    JavaScript patterns that dynamically change execution structure from runtime objects or
    array methods", and the boundary item says "Do not use dynamic array methods to determine
    execution length". Both describe every array method as refused.
  - The new `array-methods` example, which goes in:
    - a gallery group of `src/lib/shade-examples.ts`;
    - `src/lib/playground-examples.ts`;
    - `scripts/artifacts.mjs`;
    - `src/i18n/ko.ts`, for its Korean title and blurb.
  - Optionally, a row on the from-TypeScript page (`src/lib/typescript-lowering.ts`). The
    reference page for `array` quotes its declaration out of `SHADE_DTS`, so it picks up the
    methods by itself. `src/lib/language-reference.ts` must still parse the declaration.
- **vscode-typeshade**
  - `plugins/typeshade/skills/typeshade/SKILL.md`: its sixth point says "no JavaScript array
    methods (`xs.map(...)`)", and its TS8099 row lists `xs.map(...)`.
  - `references/language.md`: the refused-table row "`xs.map(...)` and the other array
    methods", whose remedy is `for (const x of xs)`.
  - `references/diagnostics.md`: TS8099's list of triggers names `xs.map(...)`.
