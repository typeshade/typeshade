---
id: '0002'
title: A method, a constructor and a local function take a function, as a function of the file does
status: draft
rules:
- '7.2'
- '8.10'
- '8.18'
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

Today only a function declared at the top of the file or of a namespace may have a parameter of
function type (Rule 8.18). Everywhere else it is refused, on a method, a static method, a
constructor, a field that holds a function (Rule 8.16) and a local function (Rule 8.17):

```text
TS8020 "f" takes a function, which only a function declared at the top of the file or of a
namespace may take (Rule 8.18): declare one there that takes it, and call that from "G.each".
```

After this change each of them takes a function the way a function of the file does. It is
compiled once for each set of functions its calls hand it, and in each copy a call of the
parameter calls the function handed over:

```ts
class Swarm {
  total: f32 = 0.;
  each(f: (i: i32) => void) {
    for (let i = 0; i < 8; i++) f(i);
  }
  sum(k: f32) {
    this.each((i) => {
      this.total += f32(i) * k;
    });
  }
}

export function run(k: f32): f32 {
  const twice = (f: (x: f32) => f32, x: f32) => f(f(x));
  return twice((x) => x * k, 2.);
}
```

- `s.each(sq)`, where `sq` is a function of the file, becomes `Swarm_each_sq(s)`, a copy of
  `each` for `sq`. The arrow function in `sum` gets a copy of its own.
- A constructor that takes a function is copied the same way: `new C(f)` becomes a copy of
  `C`'s constructor for `f`.
- The local `twice`, handed an arrow function, becomes a copy of `run_twice` for that arrow.
- A function is handed over as Rule 8.18 already says: by its name, or as an arrow function or
  a function expression written in the call.
- The copy takes what the function handed over captures and passes it on, as it does today.

One thing is new, because a copy of a method has an object and a copy of a local function has
captures of its own. A variable both sides reach is passed once:

- a variable the copy and the function handed over both capture;
- the object the method is called on, when the function handed over writes it.

In TypeScript that is one variable, so the copy gets one parameter for it, by reference where
either side writes it. `this.each((i) => { this.total += … })` adds to the `total` of the object
`each` reads. So the copy of `each` takes its object by reference even though `each` itself
writes nothing (Rule 8.10).

Still refused, each with the reason and the fix:

- A parameter of function type on an accessor. A setter's value is assigned (`o.f = g`), and a
  shader has no function value to assign.
- A parameter of function type on an entry point. This is unchanged: the pipeline cannot
  supply a function.
- A function type anywhere else: a return, a field, a variable. This is unchanged.
- A call that would pass two references into one variable, one of them written. An example is
  a function handed to `this.inner.each(...)` that writes `this`. WGSL refuses two such
  pointers ([Alias Analysis](https://gpuweb.github.io/gpuweb/wgsl/#alias-analysis)), so the
  front end refuses the call first (Rule 12.6).

## Why

Class-based TypeScript hands callbacks to methods: `items.each(...)`, `grid.visit(...)`, a
`forEachNeighbour` on a cell. A local helper that takes a callback is how a body keeps one loop
in one place. #195 made functions take functions, but only at the top level. A copy of a
top-level function has no object and no captures of its own, and that was the whole reason for
the limit.

The copies are made the same way for the rest:

- the method's object is one more parameter of the copy, taken as the method takes it (Rule
  8.10);
- a local function's own captures are passed as Rule 8.17 passes them today.

The one new question is the shared variable, and TypeScript answers it: the method and the
function it is handed see one object.

Alternatives considered:

- **Keep the refusal.** It is honest, and its fix works. But the fix is a spelling the author
  would not write, and the goal of the TypeScript surface is the ordinary TypeScript experience.
- **A function value as an index into a `switch`** over the functions a program hands anywhere
  (defunctionalization). It would allow choosing a function at run time, which Rule 8.18
  refuses. But it costs a dispatch on every call and gives up the static calls Rule 8.9 rests
  on. It is a separate proposal if it is wanted.
- **Take the method's object by value in every copy.** It is simpler, but `each` would then
  read a copy of the object that the function it calls has already changed. The program would
  compute something other than what TypeScript computes, with no diagnostic.

## What it touches

- **Rule 8.18.** A method, a static method, a constructor, a field that holds a function and a
  local function join a function of the file as the functions that may take a function. The
  sentence about shared variables is added. The refusal list shrinks to accessors, entry
  points, a function type anywhere else, a choice at run time, copies without end, and two
  references into one variable.
- **Rule 8.10.** A copy of a method takes its object by reference when the function it is
  handed writes that object.
- **Rule 7.2.** A row for a method that takes a function: `s.each(sq)` becomes
  `Swarm_each_sq(s)`, one copy for each function handed over.
- **Surface §14.** "A function that takes a function" loses "a parameter of function type on a
  method, a constructor, an accessor, a local function or an entry point" from its refusals, and
  says where else a function may be taken.
- **Surface §26.** It gains "A method that takes a function", with a compiled snippet: a method,
  a static method, a constructor, and the shared object.
- **Codes.** None are added or removed. `TS8020` still refuses the accessor and the entry point.
  The message for a method, a constructor and a local function goes away, and so does its
  pinned text (Rule 12.5).
- **Examples.** None are added. `examples/higher-order.shade.ts` gains a method that takes a
  function, a content change the compile gate already covers.
- **Tests.** `src/compiler/ts/higher-order.test.ts` holds WGSL, GLSL ES 3.00, the CPU oracle,
  the codegen and the debugger to one value for:
  - each of the five places that may now take a function;
  - the shared object, and a variable both sides capture;
  - each refusal.

  A journey shows it: the random-walk journey's `sixteen(step)` becomes a method of `Walker`.

## What it owes downstream

Nothing. Neither repository says where a function may be taken, so no statement there becomes
false. A search of both for "takes a function", "function type", "8.18" and the `TS8020` rows
finds only these:

- The site's from-TypeScript table has no row for a parameter of function type.
- The editor's skill says only that "a function may take a function (`apply(sq, x)`, an arrow
  as an argument)", and its `TS8020` row lists optional and rest parameters.
