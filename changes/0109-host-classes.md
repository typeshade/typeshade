---
id: '0109'
title: A host file imports a class of a shader module as a value, builds an instance with `new` and calls its methods on the CPU tier, and passes the instance wherever the struct's object is taken
status: draft
rules:
  - '8.20'
  - '8.21'
surface:
  - 64
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The page that copies surface §64 (en and ko), where its table says a struct is an `export interface` and its host-values row says a struct is an object of its fields, says that an exported class is a value, built with `new` on the CPU tier, and shows the listing; `compiler-changes.md` records 0109 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (`references/host.md`), where it says an exported struct is a type of the host face, says that an exported class is a value; a fixture that pins a view's text for a class changes; `compiler-changes.md` records 0109 when the pin moves.
  - repo: typenn
    what: Nothing must change. It may later export a module's classes to its host side instead of building their objects by hand; `compiler-changes.md` records 0109 when the pin moves.
  - repo: typecv
    what: Nothing must change. The same option as for typenn; `compiler-changes.md` records 0109 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names tests, text and a journey its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0109, `status: draft`. The front matter is the identity and lifecycle authority. No approval is recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, while designing an audio library on the compiler whose units are classes in `.shade.ts` files. The owner asked whether a class defined in a `"use typeshade"` file can be imported on the CPU side, built with `new` and used as an ordinary class, with the GPU running the same code ("cpu side에서 import해서 가져온 다음에 new 해서 사용하면 gpu side에서 실행되는거라던가"), and said that if not, the host face should be advanced now ("지금 고도화 해야할 것 같은데"). The agent reported that a class crosses to the host as a type only. The owner approved the drafting of this proposal ("승인"). No GitHub issue is recorded. |
| Applicability / effectivity   | Rules 8.20 and 8.21 of `docs/language-design.md` and their items in `reqs/`; `docs/use-typeshade-surface.md` §64; `src/compiler/ts/host-face.ts` (the export collection, `viewText` and the generated module); `src/core/host-values.ts`; `src/compiler/ts/host-face.test.ts`; `journeys/_host-import`. The compiler's lowering, the GPU tiers, the oracle, the exports of the package, the diagnostic codes and the examples do not change. No release version is assigned.                                                                                                                                                                                                                                       |
| Review baseline               | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Review and revision authority | Pull request [#872](https://github.com/typeshade/typeshade/pull/872) (branch `claude/proposal-0109-host-classes`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                 |

## What changes

**Before.** Rule 8.20 says that an exported struct is a type of the host face. The host view
(§64) writes a class as `export interface Voice { … }`, and the generated module exports no value
for it. A host file's `new Voice()` is TS2693 at the host's line, the class's constructor has no
host face, and a method's math reaches the host only through a helper the author exports beside
the class. The host builds the object by hand, `{ z: 0, k: 0.1 }`, and repeats what the
constructor and the field initializers say. A generic class is `never`, with the reason
`it is generic, and its struct exists only as the instances the module uses`.

**After.**

1. **An exported class is a value of the host face.** The view declares it as a class,
   `export declare class OnePole { constructor(k: number); z: number; k: number; tick(x: number): number; }`,
   with the host type of Rule 8.21 for each member, and the generated module exports a JavaScript
   class of that name. A derived class is declared with its `extends`, and the generated class
   extends the generated base, so `instanceof` holds along the chain (D2). An abstract class is
   declared `abstract`. An `interface` and a `type` stay types, `export interface`, as today.
2. **`new` runs the constructor on the CPU tier.** `new OnePole(0.1)` checks and converts its
   arguments as a helper call does (Rule 8.21), runs the class's constructor as the oracle's
   generated JavaScript (Rule 11.7), the field initializers included, and returns an instance
   whose own enumerable properties are the fields, each a host value. A class with no
   constructor builds its fields from their initializers. A field with neither takes the zero
   value of its type, as `new` gives it in the module (§26).
3. **A method runs on the CPU tier.** `f.tick(x)` converts its arguments, runs the method with
   the instance as its object, and returns a host value. A changing method (Rule 8.10) writes the
   instance's fields in place. A static function is a static method of the class. A getter and a
   setter are an accessor property. A field that holds a function (Rule 8.16) is a method under
   the field's name. Each member is admitted by the conditions of Rule 8.20: it is not generic,
   takes no function, has a host value for each parameter and for its result, and reaches no
   binding, no workgroup variable and no builtin only a GPU computes. A member that fails one is
   declared with the type `never` and the reason in its comment, so a call of it is a type error
   at the host's line, and the class is still a value (D3).
4. **An instance is the struct's host value.** Wherever a struct's object is taken today, as a
   parameter, a field, an element of an `array<T, N>`, an element of a kernel function's array of
   structs or a binding of an entry, an instance is taken: the check reads the fields the struct
   declares and ignores the prototype. A plain object of the fields is taken as before. A
   struct-typed result of an export is an instance of its exported class when the struct is one
   (D1), built without running the constructor, so that `tick()` works on what a helper returned.
5. **What is left out.** A generic class stays `never` with today's reason. A class with a field
   that has no host value (Rule 8.21: an atomic, a texture, an optional value, a nullable class)
   stays a type, `export interface`, with the reason on its line, so that the host can still name
   the type (D4). A device-backed instance, whose method call would dispatch, is not offered
   (Why). Nothing a class does on the host runs on the GPU: the GPU runs a method through a kernel
   function or an entry that calls it on an element of an array, under §65 and §67, which do not
   change.

The listing. A shader module declares a filter as a class, and a kernel function runs a bank of
them:

```ts
"use typeshade";

/** A one-pole lowpass with its state. */
export class OnePole {
  z: f32 = 0.;
  k: f32;
  constructor(k: f32) {
    this.k = k;
  }
  /** One sample through the filter. */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
}

/** Runs every filter of the bank over its block, one lane per filter. */
export function run(out: array<f32>, xs: array<f32>, filters: array<OnePole>, block: u32) {
  for (let i: u32 = 0; i < filters.length; i++) {
    for (let n: u32 = 0; n < block; n++) {
      out[i * block + n] = filters[i].tick(xs[i * block + n]);
    }
  }
}
```

A host file builds the bank with the class's own constructor, tests one filter on the CPU tier,
and hands the instances to the kernel as the structs they are:

```ts
import { OnePole, run } from './filters.shade.ts';

const filters = Array.from({ length: 64 }, () => new OnePole(0.1)); // the constructor, on the CPU tier
filters[0].tick(1); // the method, on the CPU tier, with the same math the kernel runs
await run(out, xs, filters, 1024); // the instances, taken as the structs they are (item 4)
```

The view of that module, after this change:

```ts
// Generated by typeshade from filters.shade.ts. Do not edit; `tshc sync` rewrites it.

/** A one-pole lowpass with its state. */
export declare class OnePole {
  constructor(k: number);
  z: number;
  k: number;
  /** One sample through the filter. */
  tick(x: number): number;
}
/** Runs every filter of the bank over its block, one lane per filter.
 *  A kernel function (Rule 8.22). … */
export declare function run(out: Float32Array | Resident<Float32Array>, xs: Float32Array | Resident<Float32Array>, filters: readonly OnePole[] | Resident<OnePole[]>, block: number): Promise<void>;
```

The comments in the view are those of proposal 0108, which this proposal does not depend on;
without it the view carries the declarations alone. The exact parameter types of `run` are the
ones §65 gives a kernel function today and are shown shortened.

**The cost of a host method.** A host call converts at the boundary as a helper call does, at
each call. A host loop that ticks an instance once per sample pays that conversion per sample.
The host method is the reference, for a test, a debugger and a value a host needs; the kernel is
the fast path.

## Why

**The problem.** A class written once in a shader module is two things on the host today: a
type the host can name and an object the host must build by hand. The constructor's work is
repeated in host code, and drifts from it. The methods are unreachable. A library whose units are
classes, a filter, an oscillator, an envelope, each with its state and its `tick`, cannot test a
unit on the host one sample at a time, cannot build its bank with the class's own constructor,
and cannot let a host read a value a method computes. `docs/dx.md` says that the CPU oracle is
the meaning of the TypeScript the developer wrote, and that a helper runs on the CPU tier through
the same import (§64). A class is the one declaration that does not.

**Evidence.** At the review baseline, `host-face.ts` collects a `ClassDeclaration` as
`{ kind: 'struct' }` and `viewText` prints `export interface` for it; the generated module exports
nothing for a class. Rule 8.20's sentence "an exported struct is a type of it" states the
behaviour. The oracle's generated JavaScript already lowers a method as a function over its
object (`P_len`, per the comment at the head of `host-face.ts`), and `src/core/host-values.ts`
already converts a struct value at a call (`toShader`, `fromShader`), so the pieces a class value
needs exist.

**The request.** The owner asked on 2026-11-02 for a class defined in a `"use typeshade"` file to
be imported on the CPU side, built with `new`, and used as an ordinary class, with the GPU running
the same code, and said that the host face should be advanced now if that is not possible.

**The model this proposal chooses.** One class, two sides, the same bits. The host builds and
tests instances on the CPU tier. The GPU runs the same methods over many instances through a
kernel function or an entry, as it does today. The owner's sentence holds in that form: the
methods of what the host built with `new` run on the GPU, per block and over the bank, not per
call and per object.

**Alternatives.**

- Keep the class a type, and let the host build objects by hand. Today's behaviour: the
  constructor is repeated, the methods are unreachable.
- A device-backed instance, whose method call dispatches a kernel over that one object.
  Rejected: a round trip per call, an `await` on every method, and a device object on the primary
  path, against `docs/dx.md` principles 1 and 4.
- A class shim each library generates for itself from `reflect()`. Rejected: every library would
  rewrite the compiler's lowering of constructors and methods, and drift from it.
- A class value on the CPU tier. Chosen: the constructor and the methods already exist as the
  oracle's functions; the view declares them; the generated module exports them under the class.

**Assumptions.** The oracle's generated JavaScript can run a method with a host-side object as
its `self`, after the conversion a helper call makes, and a changing method's writes to `self`
can be written back into the instance's fields. The implementation measures what each class shim
adds to the generated module (`scripts/bundle-boundary.ts`).

**Decisions to resolve before acceptance.**

- **D1.** A struct-typed result of an exported class is an instance of that class (the draft),
  or a plain object of its fields as today. The draft chooses the instance: an instance is still
  an object of its fields, `JSON.stringify` writes the fields alone, and a host that gets a
  `OnePole` back can call `tick()` on it.
- **D2.** `instanceof` holds along `extends` (the draft), or the generated classes are flat. The
  draft generates the chain, since the view declares `extends` anyway and a flat class would
  make `instanceof Shape` false for a `Circle`.
- **D3.** A class one of whose members fails Rule 8.20's conditions is still a value, with that
  member declared `never` and its reason (the draft), or the whole class stays a type. The draft
  keeps the class a value, as the view keeps an export declared `never` beside the ones a host
  can call.
- **D4.** A class with a field that has no host value stays a type with the reason (the draft),
  or becomes `never`. The draft keeps the type, so that a host can still name it in a signature.

## What it touches

- **Rule 8.20.** "An exported struct is a type of it" becomes: an exported class is a value of
  the host face, whose constructor, methods, accessors and static functions are admitted by this
  rule's conditions member by member, and a member that fails one is declared `never` with the
  reason; an exported `interface` and `type` stay types; a generic class stays `never`.
- **Rule 8.21.** A struct's host value is an object of its fields, an instance of its exported
  class included; a struct-typed result of an exported class is an instance of it (D1); the check
  reads the declared fields and ignores the prototype.
- **surface 64.** The table row for a struct splits in two, a class and an interface or type; the
  host-values row for a struct names the instance; the listing above joins the section.
- **exports, codes, examples: none.** `hostFace` keeps its signature and the shape of its result.
  The generated module is not the package's API; a helper that builds a class over the CPU tier's
  functions, if one is added to `typeshade/runtime/internal`, is internal (§64, "What ships"). No
  diagnostic is added. An example may follow by amendment; the validation names the journey.

**Implementation.** `src/compiler/ts/host-face.ts`: a `class` export kind that carries the
constructor's parameters, the members with their host types, the `extends` chain and the reasons
of the members that fail; `viewText` prints the class declaration; the generated module exports a
class whose constructor and methods call the CPU tier's functions with the conversions of
`src/core/host-values.ts` at each boundary. `src/core/host-values.ts`: a struct result built as an
instance when its class is exported (D1). Rules 8.20 and 8.21, `reqs/` synced and reviewed, §64.

**Validation.** `src/compiler/ts/host-face.test.ts` gains one case for each item: the class in
the view; `new` with a constructor and without; initializers and zero values; a changing method;
a static function; a getter and a setter; a method declared `never` with its reason (D3); a
generic class still `never`; a class with a field without a host value, still a type (D4); an
instance passed to a helper, to a kernel function's array of structs and to an entry's binding;
a result as an instance (D1); `extends` and `instanceof` (D2); a plain object still taken; a host
program type-checked against the view. `journeys/_host-import` gains a class built with `new` and
called on the CPU tier, and the kernel `run` above called with the instances: on the CPU tier,
and on WebGPU where the journey has a device. The kernel's test records whether its loop lowers
(§65) or runs on the CPU with TS8070; either way the instances are taken (item 4), and the
answer about the loop belongs to §65, which this proposal does not change.
`scripts/bundle-boundary.ts` records what the class shim adds to the generated module.

### Draft impact estimate

Known work: the view printer for a class; the class shim in the generated module; the result as
an instance; the two rules, their `reqs/` items and §64; the test cases and the journey.
Compatibility: a host that imports a class name as a type keeps type-checking, since a class
declaration is a type too; a host that builds plain objects keeps working (item 4); a host that
imports `* as m` sees new names and nothing removed. Bundle: a shim per exported class in the
generated module, unknown bytes, measured at implementation. Downstream: the two documentation
repositories update their copy of §64; typenn and typecv may adopt the class value or not.
Duration and cost: unknown, no basis for an estimate.

### Approval and plan record

This record does not yet apply. Acceptance will require the actual approval decision and its
pull request reference, the approved revision of this file with D1 to D4 resolved, assigned
responsibilities and the required validation evidence named above. No approver, schedule or
result is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
pull requests with `Change: 0109` in their commits, the delivered configuration, the observed
results of the functional validation (the test cases, the journey and the bundle measurement
above) and the document validation (`bun run docs:refs`, `bun run docs:impact`,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` for Rules 8.20 and 8.21 and §64).
Required future evidence is not a completed result.

## What it owes downstream

- **typeshade.github.io.** The page that copies §64, in English and in Korean: its table row for
  a struct, its host-values row and its listing say that an exported class is a value built with
  `new` on the CPU tier, with the instance taken as the struct; `compiler-changes.md` records 0109
  when the pin moves.
- **vscode-typeshade.** The skill's host reference (`references/host.md`), where it says an
  exported struct is a type of the host face, says that an exported class is a value, and a
  fixture that pins a view's text for a class changes; `compiler-changes.md` records 0109 when
  the pin moves.
- **typenn, typecv.** Nothing must change. Each may later export a module's classes to its host
  side instead of building their objects by hand; `compiler-changes.md` records 0109 in each
  when its pin moves.
