---
id: '0048'
title: A host replaces part of a `Resident` in place with `write(part, { offset })`, which keeps the length and the device buffer
status: draft
rules:
  - '11.8'
surface:
  - 65
  - 67
  - 69
exports:
  - Resident
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The API reference's Resident page, read from the JSDoc at the pin, shows the second write signature. The rule page of Rule 11.8, read from reqs/rules/RULE-1108.md at the pin, shows the new rule text. The pin pull request checks both pages, and compiler-changes.md records 0048.
  - repo: vscode-typeshade
    what: The skill's host reference gains one sentence on write(part, { offset }) in its Resident bullet. That bullet's clause "nothing is read back until await r.read()" gains the read-back of a partial write. compiler-changes.md records 0048 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0048`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Written 2026-10-05 (UTC), which is 2026-10-06 in Asia/Seoul. The date is the authoring context, not an approval. A coding agent in a Claude Code session drafted it for the engine typeshade/radiance. The source is item 2 of the engine's [record 0006](https://github.com/typeshade/radiance/blob/0bd1be89d1d5fe1407c34c3ed56809ff0c2c512d/docs/design/0006-compiler-boundary.md). The owner accepted that record on 2026-10-05, and its step 1 opens this proposal. Attribution is not approval.                                                                                                                                                                                                                                                |
| Applicability / Effectivity   | `src/core/resident.ts`: the handle, its host copy and its device buffer. The `Resident` export of `typeshade` and `typeshade/runtime`. The tests and documents named below, the site and the editor. The call layer and the program runtime reach the device buffer through `bufferFor`. Both read the host copy (`state.host`) in the bytes callback they hand to it. The call layer also calls `sync` before a WebGL2 or CPU tier reads the host copy. The program runtime never calls `sync`. The draft expects one edit to these callers: a draw of the call layer also checks its resident bindings when it runs. Release version unassigned. The change is breaking under Rule 13.9 (see "Compatibility"), so it ships only in a new `0.N.0`. |
| Review baseline               | `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`. The engine read its evidence at `e923a34`. No commit between the two touches `src/core/resident.ts`, `src/core/host-entry.ts` or `src/runtime/program.ts` (`git log e923a34..3f6f46b` on those paths lists none). So every line the engine cited is where it was.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review and revision authority | No pull request is assigned yet. Git records the revisions. The pull request's review and merge will record the decision. This document does not name the hash of the commit that will contain it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## What changes

A host gains a partial write on a `Resident`: `r.write(part, { offset })`. It replaces what the
handle holds from index `offset` on, and keeps the rest, the length and the device buffer. The
next use on WebGPU uploads only the elements the part covers, at their byte offsets. It uploads
the whole value instead, as today, when the host copy was the newer one before the write. The
host copy is the newer one before the first use. It is the newer one again after `write(value)`,
`read()` or a call on the WebGL2 or the CPU tier that takes the handle. It stays so until a use
on WebGPU.

The design extends Rule 11.8. It also extends change 0025's one resource model (section 2, "One
resource model with the call layer"), which made `Resident` the buffer of both layers. It keeps
`resident()` from change 0013 and `write(value)` from change 0025 as they are. Nothing an author
writes in a shader changes, and no host view changes. The change is one overload of one exported
method, and the upload behind it. It also changes a program that passes `write` itself as a
callback (see "Compatibility").

### Before and after

| Today, at the baseline                                                                                                                  | After this proposal                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `r.write(value)` replaces the whole value. The handle keeps a copy of all of it.                                                        | `r.write(value)` is unchanged. `r.write(part, { offset })` replaces the numbers or elements from `offset` on, and keeps the others.                                                                                                                                                         |
| `r.write(value, x)` ignores `x`. A program can pass `write` itself as a callback, for example to `forEach`.                             | A second argument other than `undefined` makes a partial write or a `TypeError`. Such a program changes (see "Compatibility").                                                                                                                                                              |
| The next use on WebGPU packs the whole value and uploads it at byte 0.                                                                  | After a partial write, the next use uploads only the elements the part covers, each at its byte offset. A partial write after `write(value)`, `read()` or a call on the WebGL2 or the CPU tier uploads with the whole value, as today. It does so when no use on WebGPU comes between them. |
| A write of another length makes a new buffer of the new size at the next use.                                                           | A partial write keeps the length and the buffer. A part that ends past the length is a `TypeError` that `write` throws at once.                                                                                                                                                             |
| The WebGL2 and CPU tiers read the handle's host copy.                                                                                   | Unchanged. A partial write is an assignment into that host copy.                                                                                                                                                                                                                            |
| An engine that changes part of a buffer writes the whole buffer again (typeshade/radiance record 0001, its upload rule and decision 5). | The engine writes the nodes that changed. The rest of the buffer stays on the device.                                                                                                                                                                                                       |

### The API (proposed)

`Resident` in `src/core/resident.ts` gains a second signature of `write`. The text below is the
proposed declaration, with its JSDoc, which the site's API reference shows. The `@throws` of
`read()` gains the failed read-back and a part that does not fit the layout. The first `write`
signature and its JSDoc are the baseline's, with no change. The JSDoc of the interface itself, not
shown, gains the read-back of a partial write (see "What it touches").

```ts
export interface Resident<T = ResidentValue> {
  /**
   * Wait for every kernel call made before this one, and return a new array holding what the
   * handle holds.
   *
   * @throws the error of a queued call that wrote this handle and failed, or of a partial
   *   write's read-back that failed. `TypeError` for a part given to `write()` that does not
   *   fit the layout of the handle's buffer.
   */
  read(): Promise<T>;
  /**
   * Replace what the handle holds with `value`, after every call made before this one; with
   * none waiting, at once. The next use uploads it.
   */
  write(value: T): void;
  /**
   * Replace part of what the handle holds with `part`, from index `offset` on. Keep the rest
   * and the length, as `TypedArray.prototype.set(part, offset)` does. The write runs after
   * every call made before this one, or at once when none waits. `offset` counts the numbers
   * of a typed array and the elements of an array.
   *
   * The next use on WebGPU uploads only the elements the part covers, into the buffer the
   * handle already has. It uploads the whole value instead when the host copy was the newer
   * one. That is so before the first use. It is so again after `write(value)`, `read()` or a
   * call on WebGL2 or the CPU, until a use on WebGPU. A vector or a matrix binding always takes
   * the whole value.
   *
   * A call, a draw or a dispatch on WebGPU may have written the handle last. Then a part that
   * covers only some numbers of an element first waits for a read-back of the device copy. So
   * does any part of a vector or a matrix binding. The calls made after the write wait too. A
   * read-back that fails drops the part. Its error stays for `read()` to throw, until a call
   * that writes the handle succeeds.
   *
   * @param part - a typed array of the kind the handle holds, or an array; copied at once.
   * @param options - `offset`, a whole number from 0.
   * @throws `TypeError` for a use after `destroy()`, a second argument that is not an object, a
   *   handle last given no typed array or array, a part of another kind, an offset that is not a
   *   whole number from 0, and a part that ends past the length.
   */
  write(
    part: T extends readonly (infer E)[] ? readonly E[] : T extends ArrayBufferView ? T : never,
    options: { readonly offset: number },
  ): void;
  destroy(): void;
  readonly [residentBrand]: T;
}
```

An example, on a binding the engine's record 0001 declares, `storage<array<vec4>>`:

```ts
import { resident } from 'typeshade/runtime';

// 4 numbers an element, a stride of 16 bytes: 8,192 elements, 131,072 bytes.
const nodes = resident(new Float32Array(8192 * 4));
// ...a frame binds `nodes`, so its buffer is on the device...

const rebuilt = new Float32Array(80 * 4); // 80 elements that changed
nodes.write(rebuilt, { offset: 2400 * 4 }); // numbers 9,600 to 9,919: elements 2,400 to 2,479
// The next dispatch or draw that binds `nodes` uploads 1,280 bytes at byte 38,400.
// It makes no buffer, and `await nodes.read()` gives the merged array.

// storage<array<Particle>>, where Particle holds `pos` and `vel`, each a vec3f
const start = Array.from({ length: 1024 }, () => ({ pos: [0, 0, 0], vel: [0, 0, 0] }));
const particles = resident(start);
const spawned = { pos: [0, 1, 0], vel: [0, 2, 0] };
particles.write([spawned], { offset: 17 }); // replaces element 17 and keeps every other one
```

### What a partial write does (proposed)

Three terms have one meaning in this proposal. A call is a kernel call, an entry call or a draw
of the call layer. Each call takes a place in the queue of calls (Rule 11.8). A use is a call,
or a draw or a dispatch of the program runtime, that takes the handle. The last value given is
the value of the last `write(value)` made before the partial write. With no such write, it is
the value `resident()` took.

- **The handle.** The last value given is a typed array or an array (Rule 8.21). The typed arrays
  are `Float32Array`, `Int32Array`, `Uint32Array` and `Float64Array`. An array is any JavaScript
  array (`Array.isArray`). Examples from Rule 8.21 are an array of structs, a fixed-size array, a
  tuple and a matrix's flat column-major array. `write` refuses any other host value.
- **The part.** For a typed array, the part is a typed array of the same kind. For an array, the
  part is an array. `write` copies the part at once, as `write(value)` copies its value. So the
  caller may reuse it at once.
- **The offset.** `offset` is an index into the host value, as `TypedArray.prototype.set` takes
  it. For a typed array it counts numbers. For an array it counts elements.
- **The length.** `offset + part.length` must not pass the length of the last value given.
- **Which write.** A second argument that is not `undefined` makes the call a partial write.
  `write(value, undefined)` is `write(value)`, as for an option left out. `write` refuses a
  second argument that is not an object, `null` included (see "Refusals"). At the baseline
  `write` ignores a second argument. So this rule changes a program that passes one, for example
  `values.forEach(r.write)` (see "Compatibility").
- **The checks at once.** `write` makes every check of "Refusals" at once, before anything is
  queued. So a refusal throws at the caller's line. Each check reads the last value given, also
  when its write is still queued. A queued `write(value)` changes the host copy only when it
  runs, so no check reads the host copy. The writes run in the order the host makes them. So a
  partial write that runs finds a host copy of the kind and the length its checks read.
- **The host copy.** The write assigns the part into the host copy from `offset` on. The CPU and
  WebGL2 tiers and `read()` see it there.
- **Where the newest contents are.** The handle records it in `ResidentArrayState.fresh`
  (`src/core/resident.ts`): `'host'` for the host copy, `'device'` for the device buffer and
  `'both'` when the two are alike. A partial write keeps `fresh` as it is, except after a
  read-back (below). When `fresh` is `'device'` or `'both'`, the write adds the range it covers
  to the handle's state. The next use that binds the handle on WebGPU uploads those ranges and
  clears them.
- **The device buffer.** That use uploads the elements the ranges cover. An element is one
  element of the binding's array. For `n` numbers an element, the number at index `q` is in
  element `q / n`, rounded down. The bytes are the ones `pack` (`src/core/host-entry.ts`) writes
  for those elements. `pack` uses the layout of that use, the `layout` that `bufferFor` takes, as
  a whole upload does today. Each element goes at its index times the layout's stride.
- **When the host copy is the newer one.** When `fresh` is `'host'`, the write adds no range. The
  next use uploads the whole value, as today, and that value holds the part. A handle drops its
  ranges when `fresh` becomes `'host'`, and a whole upload or a new buffer clears them. The whole
  host copy holds every part, and each of these packs it, at once or at the next use. `bufferFor`
  also makes a new buffer for a use on another device (`this.gpu.d !== d`), whatever `fresh` is.
  At the baseline `fresh` is `'host'` before the first use on WebGPU, and after `write(value)`
  runs. It is also `'host'` after each run of `sync`, with a read-back or with none (`sync` in
  `src/core/resident.ts`). `read()` runs `sync`. So does each call that takes the handle on the
  WebGL2 or the CPU tier: `runKernel` in `src/core/host-kernel.ts`, `runCompute` in
  `src/core/host-compute.ts` and `hostResidents` in `src/core/host-draw.ts`. `fresh` stays
  `'host'` until a use on WebGPU. This proposal keeps what `sync` and `read()` leave in `fresh`
  (open decision 10).
- **One layout.** The test of whole elements and the read-back use the layout the buffer was
  made with (`ResidentArrayState.gpu.layout`), as `sync` does today. So the contract below holds
  for a handle whose uses all bind one layout. Change 0025 (section 2, "One resource model with
  the call layer") requires this. It says that a `Resident` bound to a binding of another layout
  is a `TypeError` naming both. At the baseline nothing implements that refusal. The same-size
  branch of `bufferFor` neither checks nor updates `gpu.layout`. This is a deviation from
  change 0025, whose status is `implemented`. Its disposition is open, and open decision 9
  proposes how to close it. This proposal does not add the refusal (see Exclusions).
- **A binding that is not an array.** For a vector or a matrix binding, the next use uploads the
  whole value whenever a range waits, as after `write(value)`.
- **Two writes before one use.** Covered ranges that overlap or touch since the last use upload as
  one range. Ranges apart upload as one `queue.writeBuffer` each.
- **A device copy that a use made newer.** A use on WebGPU that writes the handle sets `fresh` to
  `'device'`. A part of whole elements then uploads as above, with no read-back. Two kinds of
  part first read the device copy back. One is a part of only some numbers of an element. The
  other is any part of a vector or matrix binding. The read-back reads the buffer into the host
  copy with `download` and `readInto` (`src/core/host-entry.ts`), as `sync` does. It does not
  run `sync`. It sets `fresh` to `'both'`, since the two copies are then alike. The write then
  assigns the part and adds its range. So the next use uploads that element alone, or the whole
  value of a vector or matrix binding. The write decides whether its part needs a read-back when
  it runs, not when the host calls `write`. The decision depends on the uses that come before it.
- **Ranges before a read-back.** A read-back writes the device's contents over the host copy. So
  while `fresh` is `'device'`, each read-back first uploads the ranges that wait, and clears
  them. Both `sync` and the read-back of a partial write do this. Without it, the read-back would
  write older contents over an earlier part in the host copy. Each packs every range before it
  uploads any ("A part that does not fit the layout").
- **The order.** A partial write takes its place in the order of calls, as `write(value)` does
  (Rule 11.8). A write that needs no read-back runs as `write(value)` runs. It runs at once when
  none waits, and otherwise after the calls made before it (`kernelQueue.whenIdle` in
  `src/core/resident.ts`). A read-back is asynchronous. So a write that needs one always holds a
  place in the queue (`kernelQueue.run`), even when none waits. The calls made after it wait
  until it settles. A `read()` made before the write is not ordered with it (see "Why the
  upload waits for the next use").
- **A read-back that fails.** A read-back can fail, for example when the device is lost. The
  write then drops the part, and the host copy and the device buffer keep what they held. The
  runtime keeps the failure as the handle's error (`ResidentArrayState.error`), and `read()`
  throws it, as for a queued call that fails (Rule 11.8). The write itself returned `void`. So
  the runtime handles the rejection itself, and no rejection goes unhandled. A later call that
  writes the handle and succeeds clears that error, as it clears any error a call left. The part
  is then lost, and no `read()` throws (open decision 8).
- **An error a call left.** Apart from a failed read-back, a partial write neither sets nor
  clears the handle's error. `write(value)` does neither today. A later call that writes the
  handle and succeeds clears it (`callKernel` in `src/core/host-kernel.ts`, `callCompute` in
  `src/core/host-compute.ts`). So after a failed call and a partial write, `read()` still throws
  the call's error. A partial write runs after a failed call as after any other.
- **A whole write after a partial one.** `write(value)` after a partial write replaces both. It
  sets `fresh` to `'host'`, so the next use uploads the whole value, as today.
- **No new GPU object.** A partial write makes no buffer. Only its read-back makes a staging
  buffer, as `read()` does (`download` in `src/core/host-entry.ts`).
- **The contract the tests hold.** Take any sequence of whole writes, partial writes and uses of
  one layout, with no failed read-back. The contract also needs three conditions, which the
  runtime does not hold (see "Why the upload waits for the next use"). First, the host submits
  each draw or dispatch of the program runtime that writes the handle before the next write
  runs. Second, the host records no such draw or dispatch while the read-back of a partial write
  is pending. Third, no write runs while the read-back of an earlier `read()` is pending.
  - The merged value is what the handle holds when each step applies in the order it runs. A
    write and a call run as "The order" says. A draw or a dispatch runs when the host submits
    its commands.
  - A whole write replaces the value, and a partial write assigns its part. A use that writes
    the handle replaces what it writes with its results.
  - After every step runs, take each byte of the device buffer that holds a number. It equals the
    byte of a single `write(value)` of the merged value, in that layout. Padding bytes are not
    part of the contract. Nor is a lane that a use wrote, when a write of the same number gives
    other bits. Two such kinds are an `f32` NaN and an emulated `f64` pair that is not the split
    `writeNumber` makes (`src/core/host-entry.ts`). ECMAScript lets the implementation choose the
    bits of a NaN that a `DataView` writes (ECMA-262, NumericToRawBytes). Such a lane keeps the
    use's bits until a write reaches its element.

### Refusals (proposed)

Every refusal in this table is a `TypeError` that `write` throws at once, before anything is
queued. `write` checks the rows in their order and throws the first that fails. The texts are
the proposed ones. A text shows a value given this way: a number or `undefined` as `String()`
writes it, a string as `JSON.stringify` writes it. Anything else shows as the `describe` helper
of `src/core/host-entry.ts` writes it. The third row shows the kind of the last value given
instead. A typed handle is one whose last value given is a typed array. An array handle is one
whose last value given is an array.

| Condition                                                        | Text                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A use after `destroy()`                                          | `This Resident was destroyed; make a new one with resident().` (the text `src/core/resident.ts` throws today)                                                                                                        |
| The second argument is not an object                             | `write(): the second argument takes an object with an offset, not 5. To pass write as a callback, wrap it: (v) => handle.write(v).` For `null` or `true`, the first sentence ends `not null.` or `not boolean true.` |
| The last value given is a struct's object, a number or a boolean | `write(): an offset takes a Resident that holds a typed array or an array, not an object.` For a number or a boolean, the text ends `not a number.` or `not a boolean.`                                              |
| A typed handle gets a part of another kind                       | `write(): the part must be a Float32Array, as the Resident holds, not an array of length 4.`                                                                                                                         |
| An array handle gets a part that is no array                     | `write(): the part must be an array, as the Resident holds, not a Float32Array.`                                                                                                                                     |
| The offset is missing or not a whole number from 0               | `write(): offset takes a whole number from 0, not -1.` The value is `1.5`, `"2"` or `undefined` in the other cases.                                                                                                  |
| The part ends past the length                                    | `write(): the part of 8 from offset 4092 ends at 4100, past the length 4096 of the Resident. A partial write keeps the length: pass the whole value to write() to change it.`                                        |

**A part that does not fit the layout.** A part may not fit the layout, for example an element
of an array part with a struct field missing. `write` cannot check this at once, since the
handle may have no layout yet. A later step packs the part and refuses it with a `TypeError`.
Each step that uploads the waiting ranges packs every range before it uploads any. So a refused
step uploads nothing, and the ranges, `fresh` and the host copy stay as they were. The step is
one of three.

- **A use.** It refuses the part as it refuses a misfit element of `write(value)` today, with the
  element's index in the path. A kernel call checks the host copy in its place in the queue
  (`checkArray` in `runKernel`, `src/core/host-kernel.ts`). An entry call checks it there too
  (`checkBindings` in `runCompute`, `src/core/host-compute.ts`). A draw of the call layer checks
  its bindings when the host calls it (`frameOf` in `src/core/host-draw.ts`). That is before the
  draw's place in the queue. So a partial write queued before the draw can run between that check
  and the draw. This proposal adds a check of each resident binding's host copy at the start of
  the draw's place in the queue, before `painterFor`. It refuses a misfit with the text of
  `checkBindings`, so a draw refuses it the same way on every tier. The same check refuses a
  queued `write(value)` that does not fit. At the baseline a draw then rejects with a raw
  `Misfit` from `packed` (`hostResidents` and the WebGPU painter's `paint`). Under one layout,
  each check of the call layer runs before its `sync` or `bufferFor`, which then meet no misfit.
  `bufferFor` passes a `Misfit` from the ranges to its caller unwrapped, as it passes one from its
  bytes callback today. The program runtime words it in `#resource` (`src/runtime/program.ts`).
- **`read()`.** While `fresh` is `'device'`, `sync` uploads the waiting ranges before its
  read-back ("Ranges before a read-back"). Nothing checks the host copy first, and `pack` throws
  a `Misfit` (`src/core/host-entry.ts`), which is not an `Error`. So `sync` turns it into a
  `TypeError`. `read()` rejects with it, reads nothing back and sets no error on the handle. The
  text names no caller, since more than one step can meet the misfit. It names the path and the
  problem, as `checkArray` does. For an element 17 whose `pos` is the string `"x"`, it is
  `A part given to write() does not fit the layout of the Resident's buffer: at [17].pos, got the string "x".`
- **The read-back of a later partial write.** It also uploads the waiting ranges first. A misfit
  there is a read-back that fails ("A read-back that fails"). Its error is the same text.
  Inference from the rules above: under one layout, no sequence reaches this case. A part that
  needs a read-back belongs to a vector or matrix binding, whose ranges never wait while `fresh`
  is `'device'`. Or it belongs to a typed array for an array with no size, and `pack` writes such
  numbers with no check (its `flatWidth` branch).

Each later `read()` rejects the same way until a write replaces the part. `write(value)` does,
and so does a partial write that covers it with a part that fits. While `fresh` is `'both'`,
`sync` packs nothing and drops the ranges. Then `read()` returns the host copy, as after a misfit
`write(value)` today.

### The tiers

- **WebGPU.** All four paths bind a `Resident` through `bufferFor`. Two are a kernel call
  (`onDevice` in `src/core/host-kernel.ts`) and an entry call (`runCompute` in
  `src/core/host-compute.ts`). The others are a draw (`src/core/host-draw.ts`) and the program
  runtime (`#resource` in `src/runtime/program.ts`). So one change to `bufferFor` serves the call
  layer and the program runtime alike. The program runtime runs on WebGPU only (surface §69, its
  last sentence).
- **WebGL2.** This tier keeps no device copy of a `Resident`. A kernel call brings the host copy
  up to date with `sync()` and makes data textures from it at each call (`onWebgl2` in
  `src/core/host-kernel-gl.ts`). A draw packs the host copy at each draw (`hostResidents` in
  `src/core/host-draw.ts`). A partial write reaches this tier through the host copy, and nothing
  on the tier changes. An entry has no WebGL2 tier (Rule 11.8). A kernel call and a draw on this
  tier both run `sync` first, which sets `fresh` to `'host'`. So the next use on WebGPU after
  such a call uploads the whole value (see "When the host copy is the newer one").
- **The CPU tier.** The generated code (Rule 11.7) reads the host copy and writes its results
  back into it. A kernel call runs over `hosts` in `runKernel` (`src/core/host-kernel.ts`). An
  entry call converts the host copy with `onCpu` (`src/core/host-entry.ts`). A partial write is
  an assignment into that copy. Rule 11.7 does not change. A kernel call, an entry call and a
  draw on this tier run `sync` first (`runKernel`, `runCompute` in `src/core/host-compute.ts` and
  `hostResidents`). So here too, the next use on WebGPU after such a call uploads the whole value.
- **The wasm tier of change 0042.** That proposal is a draft at the baseline. It keeps a
  `Resident` in the module's linear memory, in the `std430` layout. If both proposals are
  accepted, its tier takes a partial write as the WebGPU upload does: the covered elements,
  packed at their byte offsets. The proposal implemented second carries that line and its test.

### The recorded size

The handle records its device buffer's size in bytes (`ResidentArrayState.gpu.size` in
`src/core/resident.ts`). A partial write never changes that size or the host value's length. It
never destroys the buffer and never makes one.

A kernel function reads its array's `.length` (Rule 8.23), and an entry reads `arrayLength`.
Both read the same length before and after a partial write. Growth stays with `write(value)`,
which makes a new buffer of the new size at the next use. The branch of `bufferFor` whose comment
reads "A write changed its length" does it. A host that wants room to grow makes its value
larger than it uses. It keeps its own count of the elements it uses.

### The host view and the editor

A kernel function's view takes `T | Resident<T>` for each array (`hostFace` in
`src/compiler/ts/host-face.ts`, Rule 8.21). An entry's view takes it for a storage array with no
size (Rule 8.24). This proposal changes neither view text. The view imports the `Resident` type
from the runtime (`viewText` in the same file). So `tsc` and the editor see the new signature
through that import. On a handle of a struct or a number, the type of `part` is `never`. A partial
write there is a type error at the host's own line, before it is a `TypeError`. Rule 8.21's
rationale asks this of a wrong shape. The language service, which reads shader files, does not
change.

At the baseline change 0030 has the status `accepted`, and no code implements it yet (`src/`
names no `BindingsOf`). It types each buffer binding of a draw or a dispatch. The type is the
binding's host value or a `Resident` of that value, and a vector's host value is a tuple. So a
vector binding's handle can be a `Resident<[number, number, number]>`. On it, the type of `part`
is `readonly number[]`, and `write([4], { offset: 1 })` type-checks (observed under TypeScript
5.6.3 on 2026-10-05). The runtime takes that part. A vector or a matrix binding takes the whole
value at the next use ("A binding that is not an array"). So this proposal agrees with change 0030.

The type of `part` has one limit. Observed on 2026-10-05, on a scratch copy of the declaration
above under `tsc --strict`:

- The handle is `resident(new Float32Array(16))`, and the part is a `Float32Array` on a
  `SharedArrayBuffer`.
- Under TypeScript 5.6.3, the `devDependencies` version in `package.json`, the part
  type-checks.
- Under 5.9.3 and 6.0.2, the same part is error TS2345. So is `write(value)` with such a value,
  at the baseline.

Inference: from TypeScript 5.7 on, a typed array's type names the kind of its buffer, so `T` is
`Float32Array<ArrayBuffer>`. The peer range of `typescript` in `package.json` is `>=5.0.0 <7`, so
a host may use either. The check this proposal makes at run time takes such a part. This
proposal keeps the limit, as `write(value)` has it. A wider type of `part` is a separate change.

### The oracle

The oracle records nothing new. A partial write computes no value: it copies numbers into the
host copy and packs them by the layout the whole upload uses. The CPU tier is the oracle's
generated code (Rule 11.7), and it runs over that host copy. So the tests hold the WebGPU
buffer, read back, to the CPU tier's host copy after the same writes. The determinism report
gains no row (Rule 11.2). An `f32` is rounded as a buffer write rounds it, as for
`write(value)` (Rule 8.21).

### Compatibility (proposed)

The change is breaking under Rule 13.9. That rule calls a change breaking when an upgrade can make
a program that worked stop working or work differently.

- **What changes.** At the baseline `write` declares one parameter and ignores a second argument
  (`write` in `src/core/resident.ts`). After this proposal, a second argument other than
  `undefined` makes a partial write or a `TypeError` ("Which write").
- **The programs it reaches.** A program that passes `write` itself as a callback gets a second
  argument. `Array.prototype.forEach` and `Array.prototype.map` pass the index.
  `Set.prototype.forEach` passes the value again, and `Map.prototype.forEach` passes the key.
  `write` reads no `this`, so such a call works at the baseline.
- **Observed** on 2026-10-05, on scratch copies of the baseline declaration and the one above.
  Under TypeScript 5.6.3 with `--strict`, each of those four calls type-checks on both
  declarations. Under Bun 1.3.14 at the baseline, `values.forEach(r.write)` and
  `new Set(values).forEach(r.write)` write each value, and `read()` gives the last.
- **After the change.** Such a program throws a `TypeError` at the call, from a row of
  "Refusals". One case gives no error: a second argument that is an object with a whole-number
  `offset`, with a part that passes every check of "Refusals". That call makes a partial write.
- **The migration.** Wrap the method: `values.forEach((v) => r.write(v))`. The second row of
  "Refusals" names this edit. So does the `### Changed` entry in `CHANGELOG.md`, as Rule 13.9
  requires.
- **The release.** A breaking change ships only in a new `0.N.0` (Rule 13.9). At the baseline
  `package.json` is at `0.1.0`, and `[Unreleased]` in `CHANGELOG.md` already files `### Changed`
  entries. `src/changelog.test.ts` holds a release that files one to a new minor. Inference: while
  those entries stay, this change adds no version step of its own.
- **No deprecation window.** Inference: Rule 13.10's window is for a change that keeps a program
  compiling and makes it compute something else. Here a changed program throws at the call,
  except in the one case above. For the index that `forEach` and `map` pass, the text names the
  fix. `RELEASING.md` (section 7) gives a loud break before `1.0.0` a minor and a migration line,
  not a window. It says so of a removal. The owner decides whether the one silent case needs
  more (open decision 11).
- **This repository.** At the baseline no file passes `write` as a value (`git grep` for
  `.write)` and `.write,`).

### Exclusions

- No `writeRange(byteOffset, bytes)`, and no bytes as a host value. Record 0006 item 3 asks for
  bytes in a proposal of its own (see "Why one method").
- No growth, no spare capacity and no binding of a sub-range of a buffer.
- No change to `write(value)`, `destroy()`, `resident()` or the order of calls. `read()` changes
  only in the errors it may throw (see "A read-back that fails" and "A part that does not fit the
  layout"). After a partial write, it also uploads the ranges that wait before its read-back (see
  "Ranges before a read-back").
- No refusal of a `Resident` bound to a second layout. Change 0025 declares it (see "One
  layout"), and its fix is change 0025's own (open decision 9).
- No order between the program runtime and the queue of calls.
- No order between a write and the read-back of a `read()` made before it. `write(value)` has
  the same gap, so a fix for both is a change of its own.
- No partial read, such as `read({ offset, count })`.
- No texture write. Record 0006 item 4 asks for it in a proposal of its own.
- No change to the manifest (Rule 11.10), to a host view's text, to a diagnostic or to an
  example.
- No new dependency.

## Why

### The cost today (facts at the baseline)

- `bufferFor` in `src/core/resident.ts` packs the whole host value when the host copy is the
  newer one. It uploads it with `uploadTo`, which is `queue.writeBuffer(buffer, 0, bytes)` in
  `src/core/host-entry.ts`. A byte length that differs destroys the buffer and makes a new one.
- `write(value)` in the same file copies the whole value and marks the host copy newer. Its copy
  (`copyOf`) is a `slice()` of a typed array and a `structuredClone` of anything else.
- So one changed element costs a host copy of the whole value when the host calls
  `write(value)`. It also costs an upload of the whole buffer at the next use.
  `src/runtime/runtime.test.ts` counts that upload, in the test "binds a Resident as one buffer,
  uploaded once and again after write()".

### What the engine needs

The engine's record 0001 lays a scene out in seven storage buffers. On a change to a geometry,
it writes `nodes`, `triangles` and `vertices` again whole. Its decision 5 keeps this until the
compiler gives the runtime a partial write. When the instances move, its upload rule (step 3)
appends the top-level hierarchy to `nodes` and writes `nodes` whole. The top-level hierarchy
lives after every geometry's hierarchy in that buffer. Its decision 4 keeps the indices inside a
geometry's hierarchy relative to that geometry, so a hierarchy can move later without a rewrite.

The engine gives its own figures. Sponza's nodes are about 7 MB, which its record labels an
inference. The top-level hierarchy for 10,000 instances is about 0.3 MB. With a partial write, a
frame in which only the instances move writes the top-level range of `nodes`, not the whole
buffer. These numbers are the engine's estimates and not measurements of this compiler.

That benefit holds while the top-level hierarchy keeps its node count. When the count changes,
the length of `nodes` changes, and a partial write keeps the length. The engine may instead keep
spare room after the top-level hierarchy, as "The recorded size" describes. That is an option,
and record 0001 does not state it. Spare room changes the `arrayLength` of `nodes` ("Why the
length stays"). Inference from record 0001: its kernel finds the top-level hierarchy at
`tlasBase` (`params.scene.x`). The record names no use of the length of `nodes`.

### Why one method, and not `writeRange`

The engine's record names two shapes: `write(value, { offset })` and
`writeRange(byteOffset, bytes)`. This proposal takes the first, and adds no second method.

- **Bytes need the layout, and the host does not have it.** A `Resident` learns its layout from
  the first binding it is bound to. Before that use, and on the CPU tier, it has none.
- **The host copy is a host value, not bytes.** The CPU and WebGL2 tiers and `read()` read the
  host copy. A byte write would have to be decoded back into numbers by the layout, which may not
  exist yet.
- **Packing is what the runtime is for.** Change 0025 (section 2) says the runtime automates what
  the compiler knows. The layout is what the compiler knows, so the runtime packs, not the host.

The rule that relates the two shapes: a byte write is this method on a `Resident` whose host
value is bytes. Record 0006 item 3 asks for bytes as a storage host value in a proposal of its
own. If that proposal is accepted, `write(bytes, { offset })` on such a handle takes a byte
offset, and it is `writeRange`. So no second method is needed in either case.

Draft change 0049 is that proposal. It is a draft written beside this one, not on `main` at the
baseline. For a handle of bytes, it uploads the 4-byte words a part touches, since
`queue.writeBuffer` takes multiples of 4. This proposal agrees. On such a handle, the 4-byte word
takes the place of the element in each rule of "What a partial write does". Two of those rules
then read as follows. While `fresh` is `'host'`, the next use uploads the whole value. After a use
made the device copy newer, a part that covers only some bytes of a word reads the device copy
back first. The proposal implemented second carries these lines (open decision 7).

### Why the host value's own index

An offset in elements of the binding cannot be turned into an index of a typed array before the
handle has a layout. A `Float32Array` for `array<vec4>` and for `array<vec2>` look the same to
the runtime until the first use. The index of the host value always has a meaning, on every
tier. It is also the index `TypedArray.prototype.set` takes, which a TypeScript developer
already reads.

### Why the upload waits for the next use

`write(value)` uploads at the next use that binds the handle, not when the host calls it. A
partial write that uploaded at once would give one handle two rules for when the device sees a
write. The next use also lets two writes that touch become one upload. The cost of this choice
is the one `write(value)` has today. A frame recorded before the write and submitted after it
reads the old elements. It reads the new ones only if a use binds the handle again before that
submit.

The program runtime binds a handle when a draw or a dispatch records (`#resource` in
`src/runtime/program.ts`). It takes no place in the queue of calls: that file does not use
`kernelQueue`. So a draw or a dispatch recorded while a read-back is pending binds the handle
without the part. In the same way, it binds a handle without the value of a `write(value)` that
is still queued. A draw or a dispatch that writes the handle while the read-back is pending is
not ordered with it either. The contract states this as its second condition.
Inference from the code at the baseline: `read()` has the same exposure today, since its `sync`
is not ordered with the program runtime. This proposal does not change that (see Exclusions).

A draw or a dispatch that writes the handle marks the device copy newer when it records, not when
its commands are submitted. `#resource` passes the binding's `writes` to `bufferFor` at the
record. Between that record and that submit, the device buffer does not hold the results yet.

- A read-back there submits its own work at once (`download` in `src/core/host-entry.ts`). So it
  reads the contents from before the draw or the dispatch. The element upload at the next use
  then writes over the lanes that the draw or the dispatch wrote in that element. The read-back
  also sets `fresh` to `'both'`, so a later `read()` does not read those results back.
- A write there runs before the draw or the dispatch. But its upload can come at a use after the
  submit, and then it writes over the results.

Inference from the code at the baseline: `write(value)` has the exposure of the second item
today. So the contract above states its first condition: the host submits each draw or
dispatch that writes the handle before the next write runs.

A `read()` is not ordered with a write made after it, either. `read()` waits for the queue of
calls and then runs `sync` outside it (`read` and `sync` in `src/core/resident.ts`). A write can
run while that read-back is pending. When the read-back ends, `readInto` writes the device's
contents over the host copy. The write can then be lost, with no error. Inference from the code
at the baseline: `write(value)` has the same exposure, since `sync` reads `this.host` after its
`await`. The contract states this as its third condition, and this proposal does not change it
(see Exclusions).

### Why the length stays

The runtime binds a `Resident`'s buffer whole: `#resource` in `src/runtime/program.ts` gives a
buffer and no size. WGSL's `arrayLength` is the bound size over the stride (the comment on
`packed` in `src/core/host-entry.ts`, #367). A buffer with spare room would therefore change
`arrayLength`, and what a kernel or an entry computes with it. Spare room is a separate design,
which would bind a size.

### Alternatives considered

- **`writeRange(byteOffset, bytes)` alone, or both methods.** Rejected for the reasons above.
- **An offset in elements of the binding.** Rejected: it has no meaning before the first use, or
  on the CPU tier.
- **An upload at once, in the queue's order.** The WebGPU queue would run it before every later
  submit, whatever the frame recorded. Not chosen, to keep one rule with `write(value)`. It is
  open decision 3.
- **A diff inside `write(value)`.** The runtime would compare the new value with the host copy
  and upload what differs. Rejected: the compare costs a pass over the whole value,
  `write(value)` still copies all of it, and the host already knows what changed.
- **The host's own `GPUBuffer` and `queue.writeBuffer`.** A binding already takes one (surface
  §69). Rejected for this need: such a buffer has no host copy, so no CPU tier, no `read()` and
  no place in the order of calls.
- **A view handle, such as `r.range(offset, count)`.** Rejected: it is a second kind of handle,
  with its own lifetime. Rule 11.8's refusal of one `Resident` as two parameters of one call
  would also have to cover two views that overlap.
- **Upload only the written numbers, never a read-back.** For 4-byte lanes it works. An emulated
  `f64` vector keeps its `hi` and `lo` lanes in two planes (Rule 8.21). So a part of one element
  is two separate byte ranges. Not chosen for the first version, to keep one rule for every
  layout.
- **`read()` sets `fresh` to `'both'`.** When `fresh` was `'device'` or `'both'`, the two
  copies are alike after `sync`. `read()` then returns a copy and leaves the host copy as it is
  (`read` in `src/core/resident.ts`). So `read()` could set `fresh` to `'both'`, and a partial
  write after it would upload only its elements. Not chosen here: it changes what `read()`
  leaves for the next use, and this proposal changes `read()` only as "Exclusions" says. It is
  open decision 10. A call on the WebGL2 or the CPU tier can write the host copy in place (the
  comment on `sync`). So such a call keeps `'host'` in either case.
- **Ignore a second argument that is not an object.** It would keep `forEach` and `map` working.
  Not chosen: it does not make the change additive. `Set.prototype.forEach` passes the value
  again, which is an object, and `Map.prototype.forEach` can pass an object key. A JavaScript
  call such as `write(part, 3)` would also replace the whole value, and its length, with no error.
- **A new method name, such as `writeAt(part, offset)`.** It is additive under Rule 13.9. Not
  chosen here: record 0006 item 2 names `Resident.write(value, { offset })`. The release that
  carries this change bumps the minor anyway (see "Compatibility", an inference). It is open
  decision 11.
- **A `RangeError` for a part past the end.** `TypedArray.prototype.set` throws one. Rejected:
  the runtime's refusals are `TypeError`s (Rule 8.21). A range refusal is one too (`rangesOf` in
  `src/core/host-kernel.ts`).

### Assumptions

- WebGPU's `queue.writeBuffer` takes an offset and a size that are multiples of 4
  ([GPUQueue.writeBuffer](https://www.w3.org/TR/webgpu/#dom-gpuqueue-writebuffer)). Every element
  stride is a multiple of 4 (the comment on `packed` in `src/core/host-entry.ts`), so an upload of
  whole elements meets it. Rule 13.3 asks for a measurement on a device, and for the measured
  text in the plan and in the code comment. The journey leg below is that measurement. Delivery
  records its result in this file's validation record and in the comment beside the partial
  upload in `bufferFor`.
- The change is breaking under Rule 13.9 only through a second argument (see "Compatibility").
  A caller's `write(value)` still type-checks, and no host implements `Resident`, whose brand is
  a `unique symbol`. A direct call of `write` with a second argument is a type error at the
  baseline, since `write` declares one parameter. An indirect call is not: `forEach` and `map`
  pass `write` an index, and that program type-checks and works at the baseline.

### Unresolved decisions

The owner decides these before acceptance. Each is the recommendation above.

1. One method, `write(part, { offset })`, and no `writeRange`. A byte write waits for record
   0006 item 3's proposal.
2. `offset` counts the host value's own index: numbers of a typed array, elements of an array.
3. The upload happens at the next use that binds the handle, as for `write(value)`, and not at
   once in the queue's order.
4. After a use made the device copy newer, a part that covers only some numbers of an element
   reads the device copy back first. The read-back sets `fresh` to `'both'`, so the next use
   uploads that element alone. The alternatives are a refusal, or an upload of the written
   lanes only.
5. Every refusal, the part past the end included, is a `TypeError`.
6. Covered ranges that overlap or touch upload as one range, and the tests pin it.
7. The order with change 0042 and with draft change 0049, record 0006 item 3's proposal. The
   one implemented second carries the lines this proposal names for it.
8. A read-back that fails drops the part and becomes the handle's error, which `read()` throws.
   Apart from that, a partial write neither sets nor clears the handle's error. The alternative
   for the second half is to clear the error a call left, as a call that succeeds does. One
   consequence follows from the code at the baseline. A later call that writes the handle and
   succeeds clears the read-back's error (`callKernel` in `src/core/host-kernel.ts`,
   `callCompute` in `src/core/host-compute.ts`). The part is then lost, and no `read()` throws.
9. The deviation from change 0025: nothing refuses a `Resident` bound under another layout. The
   recommendation is a fix with `Change: 0025`, in its own pull request, before this proposal's
   implementation. `scripts/changes.ts` takes `Change:` for an `implemented` proposal.
   - Draft change 0049 records the same deviation and the same recommendation, in its open
     decision 9.
   - The alternative amends change 0025 so that a handle may serve two layouts. This proposal
     would then be amended to say which layout the element test and the read-back use.
10. A partial write made while `fresh` is `'host'` uploads with the whole value at the next use.
    That includes a partial write after `read()`, or after a call on the WebGL2 or the CPU tier,
    until a use on WebGPU. `sync` and `read()` keep what they leave in `fresh`. The alternative
    is that `read()` sets `fresh` to `'both'` when the copies are alike ("Alternatives
    considered").
11. The change is breaking under Rule 13.9 and ships in a new `0.N.0`. The `### Changed` entry
    in `CHANGELOG.md` and the second row of "Refusals" name the migration. It takes no
    deprecation window ("Compatibility"). The alternative is a new method name, which is
    additive and departs from the shape record 0006 item 2 names.

## What it touches

- **Rule 11.8.** The sentence on `r.write(value)` gains the partial write. It states the handles
  it takes, the offset as the host value's index and the length kept. It states when the next
  use uploads only the covered elements and when it uploads the whole value. It also states that
  a failed read-back leaves its error on the handle, and that `read()` refuses a part that does
  not fit the layout. The "Enforced by" line gains the tests below.
- **Surface §65.** The paragraph "Resident arrays" gains `write(part, { offset })` with an
  example and the refusal of a part past the end.
- **Surface §67.** The paragraph "Resident bindings" says that nothing is read back until
  `await r.read()`. It gains the read-back of a partial write after a use on WebGPU wrote the
  handle (decision 4). The section's bullet on a draw's `Resident` says that a draw on WebGPU
  reads nothing back. The header comment of `src/core/host-compute.ts` says so of an entry call.
  Both stay true, since the read-back runs in the write's own place in the queue.
- **Surface §69.** The bullet "Bindings go by name" says what the next use uploads after each
  kind of write. That is the whole value after `write(value)`. After a partial one, it is the
  covered elements, or the whole value when the host copy was the newer one.
- **`Resident`**, exported from `typeshade` and `typeshade/runtime`: the second `write`
  signature and its JSDoc, and the two `@throws` of `read()`. The JSDoc of the interface says that
  nothing is read back until `Resident.read`, and it gains the same read-back as surface §67.
  `bun run bake:api-surface` writes the new line for `src/core/resident.ts#Resident` in
  `src/__api__/surface.md`.
- **Code.** `src/core/resident.ts`, and one check in `src/core/host-draw.ts`. The draw checks each
  resident binding's host copy at the start of its place in the queue ("A part that does not fit
  the layout"). `src/core/resident.ts` gains the signature, the checks `write` makes at
  once, and the kind and the length of the last value given. `ResidentArrayState` gains the
  covered ranges. `bufferFor` uploads the ranges, and `sync` uploads them before its read-back.
  Both pack every range before they upload any. `sync` and the write's read-back turn a `Misfit`
  into the `TypeError` of "A part that does not fit the layout". `write` gains the read-back in
  the queue, which sets `fresh` to `'both'`. A handler keeps the read-back's failure as the
  handle's error. `read()` gains both errors in its JSDoc. The comment beside the partial upload
  records the measurement (Rule 13.3). The header comment of `src/core/resident.ts` says a chain
  of calls costs one upload and one read. It gains the uploads of the ranges and the read-back of
  a partial write. The draft expects no edit to `src/core/host-kernel.ts`,
  `src/core/host-compute.ts` or `src/runtime/program.ts`.
- **Tests owed.**
  - `src/runtime/runtime.test.ts`, on the recording fake device. Each fake buffer already holds
    its bytes (`bytes`). Its `copyTextureToBuffer` writes them through the encoder's `effects`
    when the queue runs the encoder. The fake's `writeBuffer` must then write its data into
    `bytes` at the offset, and record each offset and size. Its `copyBufferToBuffer` must copy
    the source buffer's bytes through `effects`, as `copyTextureToBuffer` does. A test can stand
    in for a dispatch that writes the handle: the dispatch changes the buffer's bytes when the
    test submits its commands.
  - The same file, the cases. A partial write uploads one range at the element's byte offset
    and makes no buffer. Two writes that touch upload once, and two apart upload twice. A part
    inside one `vec3` element uploads that element's 16 bytes. Each refusal's text, thrown by
    `write` at once, in the order of the rows. `write(x, undefined)` is a whole write.
    `values.forEach(r.write)` throws the second row's text at its first call. A length check and
    a kind check against a queued `write(value)` that has not run yet.
  - The same file, `fresh` before the write. A partial write after `read()` of a handle a
    dispatch wrote uploads the whole value at the next use. So does a partial write after
    `sync()`, which each call on the WebGL2 or the CPU tier runs. A partial write after a use
    that only reads uploads its element alone. Each case counts the uploads and their sizes.
  - The same file, after the test submits a dispatch that writes the handle. A part of whole
    elements uploads with no read-back. A part of one element reads back once first. After that
    read-back, `fresh` is `'both'`, and the next use uploads that element alone. A part of whole
    elements, then a part of one element, keeps the first part through the read-back. All give
    the same `read()`, which holds the dispatch's results and the parts.
  - The same file, with a fake device whose `mapAsync` rejects. A partial write that needs a
    read-back drops the part, `read()` throws the failure, and no rejection goes unhandled.
    A later call that writes the handle and succeeds clears that error.
  - The same file, an array of structs that a dispatch wrote, then a part whose element has a
    string field. `read()` rejects with the `TypeError` of "A part that does not fit the layout".
    It uploads nothing and reads nothing back, and a second `read()` rejects the same way. A draw
    of the program runtime that binds the handle refuses it with its own `TypeError` and uploads
    nothing. A partial write of an element that fits, over it, lets `read()` give the dispatch's
    results and the part.
  - The same file, a seeded property test over random sequences of whole writes, partial writes,
    `read()` calls and uses, some of which write the handle. The sequences keep the contract's
    three conditions. It runs on `array<vec3f>`, `array<vec4u>`, an array of structs and an
    emulated `array<f64>`. Its uses write no `f32` NaN, and only the `f64` split `writeNumber`
    makes. Every value byte of the buffer equals a whole upload of the merged value.
  - `src/compiler/ts/host-kernel.test.ts`, on the CPU tier: a kernel call after a partial write
    equals the same call on a `resident()` of the merged array. Under `tsc`, the partial write
    type-checks on a `Resident<Float32Array>` and on an array of structs. It is a type error on a
    `Resident` of a struct. After a queued call that fails and a partial write, `read()` throws
    the call's error.
  - `src/compiler/ts/host-entry.test.ts` and `src/compiler/ts/host-draw.test.ts`: an entry call
    and a CPU-tier draw that read a handle after a partial write.
  - `src/compiler/ts/host-draw.test.ts`, the draw path. The test queues a kernel call. Behind it,
    it queues a partial write whose part does not fit, then a draw that binds the handle. The
    draw rejects with the text of `checkBindings` and draws nothing. So does a queued
    `write(value)` that does not fit. The check runs before `painterFor`, so this test on the
    CPU tier reaches the one check that every tier runs.
  - The import journey (`journeys/_host-import/src/gpu.ts`, run by `bun run gate:journeys`): a
    partial write between two calls on WebGPU in Chromium, read back and held to the CPU tier.
- **`CHANGELOG.md`**: under `[Unreleased]`, an `### Added` entry for the partial write (Rule
  13.8). A `### Changed` entry names the break and its migration, `(v) => r.write(v)` (Rule 13.9).
- No rule added, no diagnostic code, no example.

### Draft impact estimate

| Area              | Expected work                                                                                                                                                                                                                                                               | Basis and uncertainty                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | The signature, the checks against the last value given and the covered ranges. Their upload in `bufferFor` and before each read-back. The read-back in the queue and its error. The draw's check when it runs.                                                              | `bufferFor` and `sync` are about 30 lines of `src/core/resident.ts`. A search of the baseline finds no other path to the device buffer.                                                                                                                                                                                                                                                                                                         |
| Types and API     | The second signature, its JSDoc, the `@throws` of `read()`, the re-baked line of `src/__api__/surface.md`.                                                                                                                                                                  | Known. `src/api-surface.test.ts` and `src/api-doc-coverage.test.ts` hold the line and the JSDoc.                                                                                                                                                                                                                                                                                                                                                |
| Tests and gates   | A fake `writeBuffer` that writes the buffer's `bytes` at an offset. A fake `copyBufferToBuffer` that copies the source's bytes through `effects`. A stand-in for a dispatch that writes. A `mapAsync` that rejects. The cases and the property test above, the journey leg. | Each fake buffer in `src/runtime/runtime.test.ts` holds its bytes (`bytes`), and `copyTextureToBuffer` writes them through `effects` when the queue runs the encoder. Its `writeBuffer` only counts a call. Its `copyBufferToBuffer` sets only the console words (`consoleWords`), when the command is recorded and not as an effect. Its `mapAsync` never rejects. The console tests read through those words, so the change keeps their path. |
| Documents         | Rule 11.8, surface §65, §67 and §69, the changelog.                                                                                                                                                                                                                         | `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and `doorstop -C` hold the set.                                                                                                                                                                                                                                                                                                                                                 |
| Compatibility     | Breaking under Rule 13.9 for a program that passes `write` itself as a callback. A `### Changed` entry with the migration. `write(value)` keeps its signature and its behaviour.                                                                                            | Observed under TypeScript 5.6.3 and Bun 1.3.14 on 2026-10-05 ("Compatibility"). That the release adds no version step is an inference from `CHANGELOG.md` and `src/changelog.test.ts` at the baseline.                                                                                                                                                                                                                                          |
| Dependencies      | None.                                                                                                                                                                                                                                                                       | Known.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Change 0042       | One line and one test in whichever of the two proposals is implemented second.                                                                                                                                                                                              | 0042 is a draft at the baseline. Its memory layout is `std430`, as the WebGPU buffer is.                                                                                                                                                                                                                                                                                                                                                        |
| Duration and cost | Unknown. Not estimated.                                                                                                                                                                                                                                                     | No basis established.                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Approval and plan record

This record does not yet apply. Acceptance requires the owner's answers to the eleven unresolved
decisions, recorded in this file. It also requires the actual decision with its pull request
reference, the approved revision of this file and the final list of surface sections. The
sections are 65, 67 and 69 at the baseline. This draft assigns no responsibility, milestone,
duration or cost.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementing commits with `Change: 0048`,
and the tests above green on the delivered revision. It requires the journey leg on WebGPU in
Chromium, recorded with its browser and result. Rule 13.3 asks for that measured result in this
record and in the code comment beside the partial upload in `bufferFor`. Delivery also requires
`bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and `doorstop -C` clean after the
edit to Rule 11.8. It requires a recorded disposition of the deviation from change 0025 (open
decision 9). Separately, it requires the site's and the editor's pin pull requests with
`0048` recorded in their `compiler-changes.md`. Compiler status `implemented` does not establish
that downstream work.

## What it owes downstream

This draft read each repository at the commit named. Each item is expected work, not done work.

**typeshade.github.io** (read at `main` `d0a0be8`). The API reference reads each export's JSDoc
from the vendored compiler at the pin, in its
[API data module](https://github.com/typeshade/typeshade.github.io/blob/d0a0be84c48fd4dadf4578a716f6dee1088072b3/src/lib/api.ts).
The `Resident` page then shows the second `write` signature with no edit by hand. The
[rule page of Rule 11.8](https://typeshade.dev/reference/rules/11-8/) renders the rule from
`reqs/rules/RULE-1108.md` at the pin, in its
[design rules module](https://github.com/typeshade/typeshade.github.io/blob/d0a0be84c48fd4dadf4578a716f6dee1088072b3/src/lib/design-rules.ts).
So it shows the new text of Rule 11.8 with no edit by hand.

At that commit no page of the site explains Rule 11.8. No entry of `EXPLAINERS` in that module
lists it, and no string of the English dictionary names it. No error code links to it:
Rule 11.8's "Enforced by" names no code, and no code's registry text names the rule. So
`assertRuleReadings` in that module does not read Rule 11.8, and the site's build does not stop
on the change. Copy that names Rule 11.8, for example to document the partial write, makes a page
explain it. That copy then needs a `READ_AGAINST` entry for `11.8` in the same pull request.
Without it, `assertRuleReadings` stops the build. The pin pull request checks both pages. The
concept page's `runtimeP` copy (en and ko) says a `Resident` keeps an array on the GPU between
calls, which stays true. `compiler-changes.md` records `0048` when the pin moves.

**vscode-typeshade** (read at `main` `53afb2b`). The skill's
[host reference](https://github.com/typeshade/vscode-typeshade/blob/53afb2b4fd37d5594160a052c329d25df87473c3/plugins/typeshade/skills/typeshade/references/host.md)
has a bullet on "A `Resident`". It gains one sentence: `write(part, { offset })` replaces a part
and keeps the length. Its clause "nothing is read back until `await r.read()`" (line 78) gains the
read-back of a partial write (decision 4). The tsserver fixtures name no `write` on a `Resident`
at that commit, so they need no edit. `compiler-changes.md` records `0048` when the pin moves.

**typeshade/radiance**, the engine that asks for this change, is not one of the repositories a
proposal may name (`DOWNSTREAM_REPOS` in `scripts/changes.ts`). It takes the partial write up in
its own record 0001, at the step that writes its scene buffers. It does so when its pin moves past
this proposal.
