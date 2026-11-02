---
id: '0109'
title: A host file imports a class of a shader module as a value, builds an instance with `new` and calls its methods on the CPU tier, and passes the instance wherever the struct's object is taken
status: implemented
rules:
  - '8.20'
  - '8.21'
  - '11.8'
surface:
  - 64
  - 65
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
  - repo: typeaudio
    what: Amendment 1. `src/bank.ts` retires `Bank.read()` typed as the fields of `T` (`State<T>[]`) and returns what `read()` gives; `test/render.test.ts` holds a bank read back after a render to `instanceof`; `docs/compiler-asks.md` marks ask N done; `compiler-changes.md` records 0109 when the pin moves past the amendment's implementation.
---

<!-- doc-refs: skip-file — a draft proposal names tests, text and a journey its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0109, `status: implemented`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC); see Approval and plan record. Pull request #890 implements items 1 to 5; see Configuration and validation record. The owner approved Amendment 1 (item 6, decision D5) on 2026-11-02 (UTC); see its row and the two records. Its implementation is not started. Downstream adoption is tracked apart.                                                                                                                                                                                                                                                         |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, while designing an audio library on the compiler whose units are classes in `.shade.ts` files. The owner asked whether a class defined in a `"use typeshade"` file can be imported on the CPU side, built with `new` and used as an ordinary class, with the GPU running the same code ("cpu side에서 import해서 가져온 다음에 new 해서 사용하면 gpu side에서 실행되는거라던가"), and said that if not, the host face should be advanced now ("지금 고도화 해야할 것 같은데"). The agent reported that a class crosses to the host as a type only. The owner approved the drafting of this proposal ("승인"). No GitHub issue is recorded. |
| Applicability / effectivity   | Rules 8.20 and 8.21 of `docs/language-design.md` and their items in `reqs/`; `docs/use-typeshade-surface.md` §64; `src/compiler/ts/host-face.ts` (the export collection, `viewText` and the generated module); `src/core/host-values.ts`; `src/compiler/ts/host-face.test.ts`; `journeys/_host-import`. The compiler's lowering, the GPU tiers, the oracle, the exports of the package, the diagnostic codes and the examples do not change. No release version is assigned.                                                                                                                                                                                                                                       |
| Review baseline               | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Review and revision authority | Pull request [#872](https://github.com/typeshade/typeshade/pull/872) (branch `claude/proposal-0109-host-classes`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Amendment 1                   | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction, on the branch `claude/0109-amend-resident-instances`, from issue [#945](https://github.com/typeshade/typeshade/issues/945) (found in typeshade/typeaudio pull request #5, recorded there as ask N). It adds item 6 and decision D5: a `Resident` made from instances reads back as instances. Items 1 to 5, decisions D1 to D4, their approval and their record do not change. Pull request [#960](https://github.com/typeshade/typeshade/pull/960) (branch `claude/0109-amend-resident-instances`); the owner approved the amendment on 2026-11-02 (UTC), and the merge of that pull request records the decision.                     |

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
6. **A `Resident` of instances reads back as instances (Amendment 1).** `resident(value)`,
   `device.array(value)` and `r.write(value)` keep, in the copy the `Resident` holds (Rule 11.8),
   the class of each object the value holds: an element of an array of structs, and a struct a
   field of one holds. `await r.read()` returns a new copy with the same classes: each object
   that was an instance of a class is an instance of that class, with the fields its own
   properties and its constructor not run, as a struct a result holds is (item 4, D1), and a
   plain object stays a plain object (D5). A call that writes the `Resident`, on any tier,
   changes the fields and no class, so `instanceof` holds on what `read()` returns and a method
   runs on it. The host copy the CPU tier runs on and the bytes a GPU tier binds do not change:
   a class is not in the buffer. `resident(length, element)` and `device.array(length, element)`
   hold numbers and do not change. A `Resident` of plain objects reads back as today.

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

**Decisions, resolved at acceptance** (Approval and plan record).

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
- **D5 (Amendment 1).** `read()` keeps the classes of the value the `Resident` was given (the
  amendment), or the type of a `Resident` of a class, `Resident<OnePole[]>`, and the view's
  `array<OnePole>` say the object of the fields (the second way issue #945 names), or the
  `Resident` learns one class from the first call that binds it and builds instances of that
  class. The amendment keeps the classes: the view types the handle by the class since change
  0116 (decision D3), so the value then matches the type; a bank of units reads back what it was
  given; and the copy needs no module, where the third way needs a call before `read()` means
  anything and gives two meanings to one handle.

**Amendment 1 (2026-11-02).** Issue #945 found, in typeshade/typeaudio pull request #5, that a
`Resident` made with `dev.array(instances)` over `array<Voice>`, written by a kernel call, read
back as plain objects of the fields while its type said `Voice[]`: `instanceof Voice` was false and
the methods were absent. The cause is in `copyOf` of `src/core/resident.ts`, which copies a value
with `structuredClone`, and `structuredClone` keeps no prototype. Rule 8.21's instance clause (D1)
speaks of a result, so the behaviour broke no rule; the mismatch between the type and the value
is what Rule 12.7's one vocabulary and `docs/dx.md` principle 3 speak against. An array of
instances passed to a call without a `Resident` keeps its instances already: the call writes each
element's fields back in place (`readInto` and `fromCpu` in `src/core/host-entry.ts`). The
amendment adds item 6 and decision D5, and declares Rule 11.8 and surface §65, which say what a
`Resident` holds and what `read()` returns.

## What it touches

- **Rule 8.20.** "An exported struct is a type of it" becomes: an exported class is a value of
  the host face, whose constructor, methods, accessors and static functions are admitted by this
  rule's conditions member by member, and a member that fails one is declared `never` with the
  reason; an exported `interface` and `type` stay types; a generic class stays `never`.
- **Rule 8.21.** A struct's host value is an object of its fields, an instance of its exported
  class included; a struct-typed result of an exported class is an instance of it (D1); the check
  reads the declared fields and ignores the prototype.
- **Rule 11.8 (Amendment 1).** The sentences on `resident(value)`, which holds its own copy, on
  `r.write(value)` and on `await r.read()`, which returns a new copy of what it holds, say that
  the copy keeps the class of each object it holds, and that `read()` returns instances of those
  classes, built as item 4 builds a result's struct (item 6, D5). What a `Resident` holds for
  the tiers, and when it is read or written, do not change.
- **surface 64.** The table row for a struct splits in two, a class and an interface or type; the
  host-values row for a struct names the instance; the listing above joins the section.
- **surface 65 (Amendment 1).** The sentences on `read()` (`returns a new copy of what it
holds`) and on `write()` say that a `Resident` made from instances of an exported class reads
  back as instances, with one sentence that names §64 and `instanceof`.
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
Amendment 1: `copyOf` in `src/core/resident.ts` copies an array of objects, and an object, with
each object's prototype kept (`Object.create` of the source's prototype and the own enumerable
properties copied, one level after another), and keeps `structuredClone` or `slice()` for a
typed array and for a value with no object, or replaces `structuredClone` for every value, which an `AudioWorkletGlobalScope` lacks (typeshade/typeaudio experiment 2, ask F); Rule 11.8 and its `reqs/` item, synced and reviewed; §65.

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
Amendment 1: `src/compiler/ts/host-class.test.ts` gains a case in which a `Resident` of
instances of an exported class, written by a kernel call on the CPU tier, is read back and held
to `instanceof`, to its fields and to a method called on an element; `src/fuse.test.ts` holds the
same on the recording device, where the device buffer is read into the host copy; a `Resident`
of plain objects, and a `Resident` whose objects hold an instance in a field, read back as given;
`write()` with instances; and a host program type-checked against the view in which
`await bank.read()` is a `Voice[]` on which `tick()` is called. The tests read both halves where
a view is the point (Rule 12.7). `bun run gate:boundary` records what the copy adds.

### Draft impact estimate

Known work: the view printer for a class; the class shim in the generated module; the result as
an instance; the two rules, their `reqs/` items and §64; the test cases and the journey.
Compatibility: a host that imports a class name as a type keeps type-checking, since a class
declaration is a type too; a host that builds plain objects keeps working (item 4); a host that
imports `* as m` sees new names and nothing removed. Bundle: a shim per exported class in the
generated module, unknown bytes, measured at implementation. Downstream: the two documentation
repositories update their copy of §64; typenn and typecv may adopt the class value or not.
Duration and cost: unknown, no basis for an estimate.
Amendment 1: known work is `copyOf`, its tests, one sentence family in Rule 11.8 and §65, and
their `reqs/` item. Compatibility: a host that reads a `Resident` of plain objects sees no
change; a host that reads a `Resident` of instances gets instances where it got plain objects,
which is what its type said. A copy that walks objects where `structuredClone` walked them:
the time of `read()` and `write()` of an array of objects, measured at implementation. Downstream:
typeaudio retires one workaround; the site copies §65. Duration and cost: unknown, no basis for
an estimate.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("승인", approve), in answer to the agent's report that listed pull requests #871 and #872
with their open decisions and the draft's recommendations, and asked for the word that accepts
them as drafted. D1 to D4 are accepted as drafted: a struct-typed result of an exported class is an instance of that class; `instanceof` holds along `extends`; a class one of whose members fails Rule 8.20's conditions is still a value, with that member declared `never` and its reason; a class with a field that has no host value stays a type, with the reason. The approved revision is the one
this record is part of. The merge of [#872](https://github.com/typeshade/typeshade/pull/872)
with `status: accepted` records the decision.

Responsibilities: an agent of this repository implements items 1 to 5, Rules 8.20 and 8.21 and the §64 text in pull requests
whose commits say `Change: 0109`. No milestone date is assigned. No duration or cost estimate is
established.

**Amendment 1.** The owner (Seungup) approved the amendment in the Claude Code session on
2026-11-02 (UTC), in Korean ("추천대로", as recommended), in answer to the orchestrator's report
that listed pull request #960 with decision D5 and the draft's recommendation. D5 is accepted as
drafted: `read()` keeps the classes of the value the `Resident` was given. The approved revision
is the one this record is part of, with item 6, Rule 11.8 and §65 in scope. The merge of
[#960](https://github.com/typeshade/typeshade/pull/960) records the decision. Responsibilities:
an agent of this repository implements item 6 in pull requests whose commits say
`Change: 0109`. No milestone date is assigned. No duration or cost estimate is established.

### Configuration and validation record

**Accepted revision.** The text merged by pull request
[#872](https://github.com/typeshade/typeshade/pull/872) as `80096906` on `main`, with D1 to D4
accepted as drafted (Approval and plan record).

**Implementation.** Pull request [#890](https://github.com/typeshade/typeshade/pull/890), branch
`claude/0109-host-classes`, from `main` at `78a9060`, by a Claude Code agent at the owner's
direction. Its commits say `Change: 0109`: `1a853614` (the export collection, the view and the
generated module), `f9bd36d0` (Rules 8.20 and 8.21, `reqs/`, surface §64 and
`src/compiler/ts/host-class.test.ts`), `1b394e76` (the instance built apart from `fromShader`),
`bec6c8d8` (the journey), `a662890f` (the merge of `main` at `48b315ad`), `8ec8095e` (the bundle
budgets), `b89349f6` (a result of an abstract class's struct), `8c7aaaf5` (the merge of `main` at
`391f8dc7`), `d60f734f` (the merge of `main` at `4072eba4`), and the commit that holds this record
and the changelog entry. The three merges were committed with `--no-verify` (issue #901): the
commit-msg policy reads a merge against its first parent and counted the rules and surface text
`main` changed (proposals 0100, 0111 and 0113) as changes of this branch; the staged file checks
passed on each merged index, and `bun scripts/changes.ts --base origin/main` reports Rules 8.20
and 8.21 and §64 alone.

**Delivered configuration.**

- `src/compiler/ts/host-face.ts`: an internal class export (`ClassExport`, `classFace`,
  `classMembers`, `memberCall`), whose members are admitted one by one by Rule 8.20's conditions,
  each running the function the module lowers for the class (`OnePole_tick`, and `Circle_perim`
  for a body `Circle` inherits); the view's class (`classView`, `memberLines`, `baseClass`); the
  generated class (`classModule`), with `extends` along exported classes and the prototypes
  `__ts_P` for D1; a class with a field that has no host value as a type (`ShapeExport`, D4).
  `HostFace.exports` reports a class as `kind: 'struct'` and a D4 class as `kind: 'never'` with
  `typeOnly`, so `src/__api__/surface.md` does not change.
- `src/core/host-values.ts`: `callMember` (a constructor, a method, an accessor half or a static
  function on the CPU tier; a changing method's object written back from what the function
  publishes in `$.inout`; `return this` returning the instance) and `fromShaderIn` (a struct of an
  exported class as its instance); `fromShader` is unchanged. `src/core/host-runtime.ts` exports
  both through `typeshade/runtime/internal`, which is not API.
- `docs/language-design.md` Rules 8.20 and 8.21; `reqs/rules/RULE-0820.md` and `RULE-0821.md`
  reviewed; `reqs/surface/SURF-064.md`, `SURF-065.md`, `SURF-067.md`, `SURF-069.md`, `SURF-075.md`
  and `SURF-076.md` cleared after reading each section against the new Rule 8.21 (only §64
  changes; the others speak of objects a call takes, which an instance is).
- `docs/use-typeshade-surface.md` §64: the two table rows, the host-values row, the
  `filters.shade.ts` listing with its host program and view, and the paragraphs on a class.
- `docs/typescript-coverage.md` (the row of an exported class), `src/AGENTS.md` (the map of
  `host-face.ts`), `journeys/README.md`, `CHANGELOG.md`.
- `src/compiler/ts/host-class.test.ts` (new) and `src/compiler/ts/host-face.test.ts` (the class and
  interface rows).
- `journeys/_host-import/src/filters.shade.ts` (new), `app.ts`, `gpu.ts`, `reference.mjs`, and the
  filter keys' bound in `scripts/user-journey.ts`.
- `scripts/bundle-budget.json`.

**The kernel's loop.** `run` of the listing lowers (§65): its face carries one loop for the GPU,
the module gives no `TS8070`, and the journey runs it on WebGPU with WebGPU required
(`configure({ prefer: ['webgpu'] })`), where a loop that ran on the CPU tier would throw.

**Functional validation**, on 2026-11-02 (UTC), Bun 1.4.4, Node 22.23.4, TypeScript 5.6.3:

- `src/compiler/ts/host-class.test.ts`, `src/compiler/ts/host-face.test.ts` and
  `src/compiler/ts/host-draw.test.ts`, run with `bunx vitest run` at `8c7aaaf5` and again at
  `d60f734f`: 22, 22 and 19 tests passed. The class file holds each case of the validation list:
  the view; `new` with and without a constructor; initializers and zero values; a changing method, a method that only reads and `return this`; a
  static function; an accessor; a field that holds a function; a member and a constructor declared
  `never` (D3); a generic class; a class that stays a type (D4); an instance taken by a helper, a
  kernel function and an entry beside a plain object; a result as an instance at every level,
  built without its constructor (D1), and an abstract struct's result as an object; `extends` and
  `instanceof` (D2); a host program under `tsc` with each refusal at its line. `compile()` and the
  language service give no diagnostic on each shader source of the file.
- `bun run test` at `8c7aaaf5`: 505 files, 502 passed and 3 failed, 11,728 tests passed and 10
  failed. Five tests of `src/affected-tests.test.ts` and four of `src/doc-test-selection.test.ts`
  fail the same way on a clean checkout of `main` at `391f8dc7` in the same container, so they are
  the container's and not this change's (CI ran the unit shards). One test of
  `src/compiler/ts/host-draw.test.ts` reached the 90 s timeout under a load average of 17, beside
  the suites of two other sessions; the file passed alone, as listed above.
- `bun run test` at `d60f734f`: 507 files, 505 passed and 2 failed, 11,742 tests passed and 9
  failed, the same nine container-only tests of `src/affected-tests.test.ts` and
  `src/doc-test-selection.test.ts`.
- `bun run gate:journeys` at `8c7aaaf5` (headless Chromium 1243, SwiftShader; not run again at
  `d60f734f`, where the host test files passed and CI's journey check runs it): exit 0, 253 checks
  passed and none failed; `filterTicks`, `filterBank`, `filterStates` and `filterKept` on the CPU
  tier, and `filterBankGpu`, `filterStatesGpu` and `filterKeptGpu` on WebGPU, each with a worst
  difference of 0; `tsc` over the journey's host files, 0 errors. The same gate passed on the build
  of `f9bd36d0` with the journey's files.
- `bun scripts/bundle-boundary.ts` at `8ec8095e` and again at `8c7aaaf5`, with the same numbers,
  against the same script at `78a9060`: `typeshade/runtime` 148342 (+0), split initial 36460 (+5),
  aggregate 150335 (+5); `typeshade/emit` 114775 (+0); `typeshade/fuse` 109717 (+1), split initial
  13769 (-3), aggregate 110205 (-28); `typeshade/algorithms` 47656 (+0); `typeshade/random` 31492
  (+6). Bun's bundler drops the class helpers from every subpath; the budgets of the measurements
  over their caps moved by those bytes. The shape of the first commit, `fromShader` with the
  prototypes, had cost +33, +39, +44 and +42 bytes on runtime, fuse, algorithms and random. In a
  generated module, a class is one constant for each member and one class literal; no common
  module exports a class, so their baked faces do not change.
- `bun run build` passed at `8ec8095e`, `b89349f6`, `8c7aaaf5` and `d60f734f`; `bun run lint` and
  `bun run format:check` passed at `8ec8095e` and at `d60f734f`.
- Not run: `bun run gate:compile`, `bun run gate:differential`, `bun run gate:render` and
  `bun run gate:perf` (the change emits no shader text and changes no kernel lowering), and the
  TypeScript 5.9 and 6.0 legs, which CI runs.

**Document validation**, on 2026-11-02 (UTC): `bun run docs:refs`, 0 dead references;
`bun run docs:impact` read for each commit, each commit's `Docs-Impact:` trailer saying what was
read; `bun run reqs:sync` with nothing left to write; `python3 scripts/doorstop-check.py -C`,
Doorstop 3.2, with no item flagged; `bun scripts/changes.ts --base origin/main`, exit 0 ("This
change touches Rule 8.20, Rule 8.21; surface §64"), at `8c7aaaf5` and at `d60f734f`.

**Deviations**, each with its disposition:

1. The Implementation paragraph names "a `class` export kind". The kind is internal to
   `host-face.ts`; `HostFace.exports` reports a class as its struct, since `HostExport` is in
   `src/__api__/surface.md` and What it touches says that `hostFace` keeps the shape of its
   result. Closed: the approved text's "keeps the shape" decides it.
2. Item 1 says that a derived class is declared with its `extends`. Where a member a host can call
   stands where the class above declares it `never`, or an accessor and a `never` member meet,
   TypeScript refuses the override (TS2416, TS2425, TS2610), so the view declares the class whole,
   without `extends`; its JavaScript class extends all the same, so `instanceof` holds (D2).
   §64 states it. Open: an amendment may write it into item 1.
3. A class that extends a mixin application (`extends M(B)`) reaches the members of its own
   declaration and of the classes it names; a member the mixin adds is not declared in the view,
   so a host call of it is a type error, not a wrong value. Open: no test reaches it.
4. Rule 8.21's D1 sentence named a class "exported as a value"; an abstract class is one, and its
   struct in a result is an object of its fields, typed by them, since it has no instance. The
   rule's text says so since `b89349f6`. Closed.

Not deviations, recorded for the reader: a member declared `private`, `protected` or with a `#`
name is not reached by the host, and its field is declared with the same access; a class of
static functions alone is a value whose `new` builds an instance with no field; a constant of a
class's struct stays a frozen object of its fields (D1 speaks of results); an abstract class
declares its instance members with the types of the functions of the first concrete class below
it, and `new` of it throws the reason its view gives.

**Open items.** The downstream work of What it owes downstream is not started: the site's copy of
§64 (English and Korean), the editor's host reference and its fixture, and each repository's
`compiler-changes.md` when its pin moves. Deviations 2 and 3 stay open as recorded.

**Amendment 1.** Not implemented. This record does not yet apply: delivery will require the
accepted revision of the amendment, the implementing pull request and its commits, the delivered
`copyOf`, the test runs with their dates and results (functional validation) apart from the
document checks for Rule 11.8 and §65 (document validation), each deviation with its disposition,
and the pending work. A planned result is not a completed one.

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

Amendment 1 adds:

- **typeshade.github.io.** The page that copies §65, in English and in Korean, gains the sentence
  on a `Resident` of instances.
- **vscode-typeshade.** The skill's host reference, where it says what `read()` returns, says that
  a `Resident` of instances reads back as instances.
- **typeaudio.** `src/bank.ts` retires `Bank.read()` typed as the fields of `T` (`State<T>[]`) and
  returns what `read()` gives; `test/render.test.ts` holds a bank read back after a render to
  `instanceof`; `docs/compiler-asks.md` marks ask N done with this proposal's id and amendment;
  `compiler-changes.md` records 0109 when the pin moves past the amendment's implementation.
- **typenn, typecv.** Nothing must change: neither reads a `Resident` of instances.
