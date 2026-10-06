---
id: '0049'
title: A host passes a storage binding its bytes, a `Uint8Array` in the layout the manifest gives, beside the typed array or objects it passes today
status: draft
rules:
  - '8.21'
  - '11.8'
  - '11.11'
surface:
  - 64
  - 65
  - 67
  - 69
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The API reference entries for resident, Resident and Bindings, which the site reads from the JSDoc at the pin. The rule pages of Rules 8.21, 11.8 and 11.11 render the new text from reqs/rules at the pin. The edits of Rules 8.21 and 11.11 change their fingerprints, so the site's rule checks stop the build at the pin. The pin pull request reads each page that explains them again, en and ko. READ_AGAINST in src/lib/design-rules.ts and content/guide/ko/rules.json then take the new fingerprints. No page copy names a binding's host values at 79484e3. compiler-changes.md records 0049 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (references/host.md) gains the bytes in its host values, kernel function, Resident and program runtime bullets. The view text in the tsserver fixture HOST_IMPORT_PROJECT is written again from the pin. compiler-changes.md records 0049.
---

<!-- doc-refs: skip-file — a draft proposal names files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0049`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Date and attribution          | Written 2026-10-05 (UTC), which is 2026-10-06 in Asia/Seoul. The date is the authoring context, not an approval. A coding agent in a Claude Code session drafted it for the engine typeshade/radiance. The source is item 3 of the engine's [record 0006](https://github.com/typeshade/radiance/blob/0bd1be89d1d5fe1407c34c3ed56809ff0c2c512d/docs/design/0006-compiler-boundary.md). The owner accepted that record on 2026-10-05, and its step 1 opens this proposal. The same agent made every probe and measurement this file reports, on 2026-10-05. Attribution is not approval. |
| Applicability / Effectivity   | The host value of a storage binding on both layers: `src/core/host-entry.ts`, `src/core/resident.ts`, `src/runtime/program.ts`, `src/core/host-kernel.ts` and `src/core/host-kernel-gl.ts`. The host view that `src/compiler/ts/host-face.ts` writes, change 0030's typed default export included. The rules, surface sections and tests named below. The site and the editor. Release version unassigned.                                                                                                                                                                             |
| Review baseline               | `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`. The engine read its evidence at `e923a346dfe5e9478b7b5ce25df39bbd9317a511`. Between the two, `git diff` changes no line of `src/core/resident.ts`, `src/core/host-entry.ts` or `src/runtime/`. It changes one reason string of `src/compiler/ts/host-face.ts` and no host type. So every line the engine cited is where it was.                                                                                                                                                                                           |
| Review and revision authority | No pull request is assigned yet. Git records the revisions. The pull request's review and merge will record the decision. This document does not name the hash of the commit that will contain it.                                                                                                                                                                                                                                                                                                                                                                                     |

## What changes

A host gains a second host value for a storage binding: its bytes. The bytes are a `Uint8Array`
that holds the binding's value in the `std430` layout the manifest gives (Rule 11.10). The
runtime uploads them as they are and checks only their length. The host values of Rule 8.21
stay. An array of objects stays the host value of an array of structs, and the host view names
it first.

The design extends Rule 8.21 (host values), Rule 11.8 (`resident`) and Rule 11.11 (binding by
name in the program runtime). It keeps change 0025's one resource model (section 2): a
`Resident` of bytes is a buffer of both layers, and it binds under one layout. It revisits
decision 3 of change 0013 for a host that opts in, and keeps that decision's default ("Why").
Nothing an author writes in a shader changes. The manifest, the WGSL, the GLSL and the generated
module do not change, unless open decision 8 takes its alternative. Accepted change 0030 types the
program runtime's bindings, and "Interaction with change 0030" says what its types become.

### Before and after

| Today, at the baseline (fact)                                                                                                                                                          | After this proposal (proposed)                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An array of structs takes an array of objects. The runtime packs it one field at a time (`pack` in `src/core/host-entry.ts`).                                                          | It takes the array of objects or a `Uint8Array` of its bytes. The runtime copies the bytes and packs nothing.                                                                                                           |
| An array with no size of scalars or vectors takes the scalar's typed array alone (`runtimeCount`). A `Uint8Array` gets `got a Uint8Array, not a Float32Array`.                         | It takes the typed array or a `Uint8Array` of its bytes, the padding of a `vec3` element included.                                                                                                                      |
| `resident(new Uint8Array(n))` throws `resident(): takes a host value (...), not a Uint8Array, which no binding holds.`                                                                 | `resident()` takes a `Uint8Array` and holds a copy of its bytes. `read()` gives a new copy, of the class passed.                                                                                                        |
| `resident(new ArrayBuffer(n))` passes. A binding then refuses it, for example with `got an object, not a Float32Array`. A fieldless struct, and a struct whose fields it has, take it. | `resident()` refuses an `ArrayBuffer` at once, and the sentence names `new Uint8Array(buffer)`.                                                                                                                         |
| A sized binding of a vector, a matrix or a sized array, storage or uniform, takes any `ArrayLike` of the right length (`listOf`). A `Uint8Array` of numbers is one.                    | A `Uint8Array` at the top of a storage binding is its bytes, and a uniform binding refuses one. This is the break ("Compatibility").                                                                                    |
| The CPU tier converts a host value to the values it runs on (`toCpu`) and writes them back (`fromCpu`).                                                                                | For bytes, the CPU tier decodes them by the binding's layout. It encodes the written ones back with the functions `pack` uses.                                                                                          |
| The host view types a storage binding as a typed array or an array of objects. It adds a `Resident` of it where the binding has no size.                                               | The view adds `Uint8Array` to every storage binding and every kernel array, and `Resident<Uint8Array>` where it names `Resident` today. Under change 0030, each storage binding of the typed default export gains both. |

An engine on the program runtime, with a node record that has `f32` and `u32` fields:

```ts
import { createRuntime, resident } from 'typeshade/runtime';
import trace from './trace.shade.ts'; // the manifest (surface §64)

// trace.shade.ts declares:
//   class Node { lo: vec3; a: u32; hi: vec3; b: u32; }
//   declare const nodes: storage<array<Node>>;
// The manifest gives `nodes` the layout { kind: 'array', length: null, stride: 32, element:
//   { kind: 'struct', size: 32, fields: lo at 0, a at 12, hi at 16, b at 28 } }.
const bytes = new Uint8Array(4096 * 32);
const f32 = new Float32Array(bytes.buffer);
const u32 = new Uint32Array(bytes.buffer);
f32.set([0, 0, 0], 0); // node 0, lo: bytes 0 to 11
u32[3] = 1; // node 0, a: bytes 12 to 15
f32.set([1, 1, 1], 4); // node 0, hi: bytes 16 to 27
u32[7] = 2; // node 0, b: bytes 28 to 31

const rt = await createRuntime({ programs: [trace] });
const walk = await rt.load(trace).compute('walk');
const nodes = resident(bytes); // a copy of the bytes, and nothing is packed
const frame = rt.frame();
frame.dispatch(walk, { nodes }, 64);
await frame.submit();
```

The layout in the comment is the one `packModule` gives at the baseline for that declaration. A
probe compiled it on 2026-10-05 and printed `stride: 32` and the four offsets above.

A call of surface §67's `scale` through the call layer:

```ts
import { scale } from './kernels.shade.ts';

const xs = new Uint8Array(new Float32Array([1, 2, 3, 4]).buffer); // the bytes of four f32
const ys = new Uint8Array(16);
await scale({ k: 2.5, xs, ys }, 1); // ys holds the bytes of 2.5, 5, 7.5 and 10, in place
```

### The bytes (proposed)

- **What they are.** A `Uint8Array`, tested with `instanceof`, so Node's `Buffer` is one. It may
  view any buffer at any byte offset. Its `byteLength` bytes are the binding's value. They are
  little-endian, at the offsets the manifest's `layout` gives under `rule: 'std430'`. `pack`
  writes this layout today, through `writeNumber` and `writeLane` in `src/core/host-entry.ts`.
- **A copy of them.** A handle copies the bytes with `Uint8Array.prototype.slice.call(bytes)`,
  never with the value's own `slice()`. The copy is new memory, of the class the host passed
  ("`resident()` and `Resident`").
- **Padding.** A padding byte counts toward the length and holds no value. The runtime uploads
  it as it is, and no tier reads it.
- **An emulated `f64`.** A number is two `f32` words, `hi` then `lo`, as the GPU holds it (Rule
  8.21). A `vecNf64` is two planes, the second at the `lo` offset the layout gives. The host
  writes the split that `writeNumber` writes for a host value.
- **Where a host passes them.**
  - A storage binding of a draw or a dispatch of the program runtime (Rule 11.11).
  - A storage binding of an entry call or a draw of the call layer (Rule 8.24).
  - A kernel function's array with no size (Rule 8.21, its last paragraph).
  - `resident(bytes)` and `r.write(bytes)` (Rule 11.8). The handle stands where a `Resident`
    stands today: any storage binding of the program runtime, and an array with no size on the
    call layer.
- **Where they are not taken.**
  - A uniform binding, given bytes or a `Resident` of bytes. Open decision 3 asks whether its
    `std140` bytes join.
  - A helper's parameter or result (Rule 8.20), and a kernel function's value parameter.
  - A binding with no layout (`noLayout` in the manifest), which takes no host value today.
  - An element or a field inside a host value. There a `Uint8Array` keeps today's meaning, an
    `ArrayLike` of numbers (`listOf`).
- **The length.** The runtime checks the length and nothing else:
  - An array with no size takes a whole number of elements, at least one. So `byteLength` is a
    nonzero multiple of the layout's `stride`.
  - A struct whose last field is an array with no size takes that field's offset plus a whole
    number of its elements, at least one. It also takes at least WebGPU's minimum binding size
    for the struct. That minimum can ask for more than one element ("A struct whose last field
    has no size").
  - Every other storage binding takes exactly the layout's `size`.
- **No content check.** Every bit pattern of a 4-byte word is an `f32`, an `i32` or a `u32`. A
  `bool` has no storage layout (Rule 6.8, `TS8051`). So the runtime has no value to refuse.
- **When the runtime reads them.** It reads them when it reads any other host value of that
  binding. That is at the call for the program runtime and for a draw. It is when the queued call
  runs for an entry call and a kernel call (`kernelQueue` in `src/core/resident.ts`).
- **The cost.** On WebGPU, no work per element. At most one copy of the bytes on the host for
  each upload, and WebGPU's own copy at `queue.writeBuffer`. The CPU tier decodes each number
  ("The tiers").
- **A written binding.** An entry call and a kernel call copy the buffer's bytes back over the
  caller's `Uint8Array`, whole and in place. They read a typed array back the same way today. A
  `Resident` stays on the device. The program runtime reads nothing back into a plain value
  today, and it reads nothing back into bytes.

### `resident()` and `Resident` (proposed)

**The copy.**

- `resident(bytes)` holds a copy of the bytes, `Uint8Array.prototype.slice.call(bytes)`. The
  copy is new memory, of the class the host passed.
- A copy of the same class is what a handle gets today for every other typed array. `copyOf`
  in `src/core/resident.ts` (lines 127 to 131) makes it with the value's own `slice()`.
- ECMA-262's `slice` makes the new array with the array's species constructor
  (TypedArraySpeciesCreate). So the copy keeps the class.
- For Node's `Buffer` the value's own `slice()` is no copy: `Buffer.prototype.slice` returns a
  view of the same memory.
- A probe on 2026-10-05, under bun 1.3.14 and under Node 22.22.0, showed it. A write through
  `slice()`'s result changed the `Buffer`, and both shared one `ArrayBuffer`.
- In the same probe, `new Uint8Array(value)` copied too, but gave a plain `Uint8Array`.
- A plain copy would break the type of `resident`. Its signature is
  `<T>(value: T) => Resident<T>`, and `read()` returns `Promise<T>` (`src/__api__/surface.md`,
  line 1452, and `src/core/resident.ts`, line 54).
- So `tsc` types `read()` of a handle of a subclass as that subclass. A plain copy would then
  not be what its type says.
- A second probe that day ran `Uint8Array.prototype.slice.call(value)` on both runtimes. For a
  `Buffer` it gave a `Buffer` that shared no memory, at offset 0 of its own `ArrayBuffer`.
- That held for a `Buffer` from Node's pool, at byte offset 1320. Node under
  `--throw-deprecation` threw nothing.
- For `class Hex extends Uint8Array { hex() }` it gave a `Hex`, and `hex()` ran on the copy.
- So `resident()`, `write()` and `read()` copy bytes by that one rule. The signature of
  `resident` does not change. `Resident<T>.read()` gives a `T` for bytes, as for a typed array
  today.
- A subclass whose constructor does not take a length cannot be copied so. In the second probe,
  `class Img extends Uint8Array { constructor(w, h) }` made the copy throw a `TypeError`.
- `slice()` of the same subclass of `Float32Array` threw a `TypeError` too. So `resident()` of
  such a value throws, as it does for a typed array today.

**The handle.**

- `r.write(bytes)` replaces the copy. A write of another length makes a new buffer at the next
  use, as today. The branch of `bufferFor` whose comment reads "A write changed its length" does
  it.
- `await r.read()` gives a new copy by the same rule. It holds the bytes the handle holds, read
  from the device when a call wrote them there.
- `bufferFor` uploads the copy's `byteLength` bytes from its `byteOffset`. The probe found each
  copy at offset 0 of its own buffer, but a subclass's constructor decides that.
- A handle keeps its kind. A handle made from bytes takes bytes at `write()`, and a handle made
  from a host value takes a host value ("Refusals").
- The types say the same, since `write()` takes a `T`. `tsc` 5.6.3, 5.9.3 and 6.0.2 each gave
  TS2345 for a `Float32Array` written to a `Resident<Uint8Array>`, and for the reverse.
- One kind for each handle keeps one form of its host copy. `sync()` and the CPU tier treat
  bytes and a host value apart (below and "The tiers").
- A handle of bytes takes the layout of the first binding it is bound to, as change 0025 says of
  a struct (section 2). Each use checks the length against that layout. The CPU tier decodes by
  it.
- A uniform binding of the program runtime refuses a handle of bytes, as it refuses bytes. The
  check reads the handle's copy, so the sentence is the same ("Refusals").
- Change 0025 (section 2) also says: "A `Resident`
  bound to a binding of another layout is a `TypeError` naming both."
- This proposal keeps that rule for a handle of bytes. One handle of bytes does not serve two
  layouts.
- Observed at the baseline (fact): no code makes that refusal. `bufferFor` (lines 96 to 116)
  compares no layout. It records the layout of the call that makes the buffer.
- That call is a first use, or a use on a new device (line 101). It is also the first use after
  a write changed the length (line 108). Every other use binds the same buffer, and the recorded
  layout stays.
- That is a deviation from implemented change 0025, for every handle. Draft change 0048 records
  the same fact. Its disposition is open (open decision 9).
- This proposal does not fix it, since the fix covers every handle and change 0025 already
  declares it. Step 1's tests bind a handle of bytes under one layout only.
- On the CPU and WebGL2 tiers the handle's host copy is the bytes. `sync()` copies the device's
  bytes over it, where today it decodes them into the host value with `readInto`.

### Refusals (proposed)

Each refusal is a `TypeError`, as every refusal of a host value is today (Rule 8.21). The
runtime puts its prefix before each problem text below, as it does today:

- An entry call or a draw: `scale(): binding "xs" (array<f32>): ` (`checkBindings` in
  `src/core/host-entry.ts`).
- A kernel call: `render(): parameter "out" (array<f32>): ` (`checkArray` in
  `src/core/host-kernel.ts`).
- The program runtime: the entry, its line, the binding and its type, then the binding's name
  (`#resource` and `#packed` in `src/runtime/program.ts`).

| Condition                                                                     | Problem text (proposed)                                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| An array with no size gets 0 bytes                                            | `got a Uint8Array of 0 bytes, which WebGPU cannot bind`                                                                            |
| An array with no size gets a part of an element                               | `got a Uint8Array of 100 bytes, which is not a whole number of 32-byte elements`                                                   |
| A struct with a last array of no size gets the wrong length                   | `got a Uint8Array of 6 bytes, which is not 4 bytes before "items" and a whole number of its 4-byte elements`                       |
| Such a struct gets fewer bytes than WebGPU binds                              | `got a Uint8Array of 20 bytes, below WebGPU's minimum binding size for this struct: pass 32 bytes or more (4 elements of "items")` |
| Any other storage binding gets another length                                 | `got a Uint8Array of 20 bytes, and its layout is 16 bytes`                                                                         |
| A uniform binding gets bytes, or a `Resident` of bytes on the program runtime | `got a Uint8Array, which only a storage binding takes as bytes`                                                                    |
| A storage binding gets an `ArrayBuffer`                                       | `got an ArrayBuffer, which no binding holds: pass new Uint8Array(buffer) for its bytes`                                            |
| A uniform binding gets an `ArrayBuffer`                                       | `got an ArrayBuffer, which no binding holds`                                                                                       |

`resident()` and `write()` refuse at the call:

| Value                                                     | Text (proposed)                                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resident(new ArrayBuffer(16))`                           | `resident(): takes a host value (a number, a tuple, a typed array, an array or an object) or its bytes (a Uint8Array), not an ArrayBuffer, which no binding holds. Pass new Uint8Array(buffer) for its bytes.` |
| `resident(new DataView(buffer))`                          | `resident(): takes a host value (...) or its bytes (a Uint8Array), not a DataView, which no binding holds. Pass new Uint8Array(view.buffer, view.byteOffset, view.byteLength) for its bytes.`                  |
| `resident(new Int16Array(8))`                             | `resident(): takes a host value (...) or its bytes (a Uint8Array), not an Int16Array, which no binding holds.` (today's sentence, with the bytes added and the article fixed)                                  |
| `r.write(new ArrayBuffer(16))`                            | `write(): takes a host value or its bytes, not an ArrayBuffer, which no binding holds. Pass new Uint8Array(buffer) for its bytes.`                                                                             |
| `r.write(new Float32Array(4))` on a handle of bytes       | `write(): this handle holds bytes, so it takes a Uint8Array, not a Float32Array.`                                                                                                                              |
| `r.write(new Uint8Array(16))` on a handle of a host value | `write(): this handle holds a host value, not bytes. Make a handle of the bytes with resident(bytes).`                                                                                                         |

`describe` in `src/core/host-entry.ts` names an `ArrayBuffer` where it says `an object` today.
So every refusal that describes one says `an ArrayBuffer`.

Today five texts on the binding path write the article `a` before any name:

- `describe` (line 143) and `notHostValue` in `src/core/resident.ts` (line 142) write
  `a ${v.constructor.name}`, which gives `a Int16Array`.
- `runtimeCount` in `src/core/host-entry.ts` (line 192) writes `not a ${Want.name}`, which gives
  `not a Int32Array`.
- `unbox` in `src/core/host-entry.ts` (line 328) writes `passed as a ${Want.name} of length 1`.
  For a written `i32` scalar binding, that gives `passed as a Int32Array of length 1`.
- `notHostValue` (line 145) writes `a ${typeof v}`, which gives `not a undefined`.

After this proposal the five texts choose the article by the first letter of the name. They write
`an` before `A`, `E`, `I` and `O`, and `a` before every other letter, `U` included.

- So they write `an Int16Array`, `an Int32Array` and `an ArrayBuffer`. They keep `a Uint8Array`,
  `a Uint32Array` and `a Float32Array`, as the tables above do.
- `undefined` is the one exception, since its first sound is a vowel. Its text becomes
  `not an undefined`.
- Step 1 makes this change. The program runtime reaches `describe` and `runtimeCount` through
  `byteSize` and `pack` in `#packed` (`src/runtime/program.ts`, lines 667 to 680).
- The call layer shares these functions, so its texts change in step 1 too. The call layer alone
  reaches `unbox`, through `pack` with its `box` argument set (`src/core/host-entry.ts`, lines
  805 and 828).
- Step 1 changes the article of `unbox` with the others, since it is the same rule in the same
  file. The path of `unbox` changes in step 2, when a written scalar binding also takes its bytes.

Two more texts write the same article off the binding path. This proposal leaves them as they
are, since it changes neither path:

- `describe` in `src/core/host-values.ts` writes `a ${v.constructor.name}` (line 65). It words
  the refusals of `toShader`, which checks a helper's arguments and a kernel function's value
  parameters. Those take no bytes ("Where they are not taken").
- The refusal of an emit option in `src/core/manifest.ts` (line 400) writes `a ${typeof given}`.
  A probe on 2026-10-05 gave `got a object.` for `packModule(m, { emit: { level: {} } })`.
- A fix of those two texts is a separate bug fix.

### The tiers (proposed)

**WebGPU.**

- The program runtime uploads the bytes into a buffer of its pool with `queue.writeBuffer`. It
  binds the size the bytes give, as it binds a packed value's size today (#367). A `Resident`
  of bytes reaches `bufferFor` with a `bytes()` that gives its copy.
- The call layer's `packed` gives the bytes. `onGpu` binds them, and copies a written binding's
  staging bytes back over the caller's array.
- `onGpu` writes a written scalar binding's number into index 0 of the caller's value today
  (lines 1023 and 1024). For bytes it copies the four or eight bytes instead.
- `checkBindings` packs every value once into scratch memory to check it (lines 802 to 806).
  For bytes it checks the length and packs nothing.

**The CPU tier** (Rule 11.7).

- The generated code runs on the values `toCpu` gives: in `onCpu` of `src/core/host-entry.ts`
  and `src/core/host-kernel.ts`, and in `frameOf` and `hostResidents` of
  `src/core/host-draw.ts`.
- For bytes, the call decodes them by the binding's layout into those values. It reads each
  number with `readNumber` and `readLane`, the functions a read back uses.
- The decoder counts the elements of an array with no size from the bytes, by the rule of the
  length check. An array at the top of a binding holds `byteLength / stride` elements.
- A struct's last array holds `(byteLength - offset) / stride` elements, where `offset` is that
  field's offset in the layout. The encoder writes back the same count.
- After the run, the call encodes each written binding back over the caller's bytes. It writes
  each number with `writeNumber` and `writeLane`, the functions `pack` uses. Padding bytes keep
  what the host put there.
- So the CPU tier reads the bytes by the layout the manifest carries, which Rule 6.8 holds to
  the WGSL. It computes from the values the GPU reads.
- An emulated `f64` decodes as `hi + lo`, as a read back decodes it (`readNumber`). This is the
  double the GPU holds, which can differ from a double the host split, by the split's rounding.
- An `f32` word that holds a NaN may get another NaN encoding when the call writes the binding
  back. ECMA-262 lets an engine choose that encoding (NumericToRawBytes). A `Float32Array` host
  value has the same property today, since `fromCpu` assigns its elements.

**WebGL2.**

- An entry call has no WebGL2 tier, and a draw that reads a storage buffer has none (Rule 11.8,
  surface §67). This does not change.
- A kernel function's WebGL2 tier reads each array a loop reads as a data texture (`lanesOf` in
  `src/core/host-kernel-gl.ts`). For bytes, the lanes are the bytes read as the element's typed
  array for a scalar element, and as `f32` lanes otherwise.
- That is what `lanesOf` makes of a packed value at the baseline:
  `new Float32Array(packed(b, value))`. So the data texture holds the same texels for the bytes
  as for the host value that packs to them.
- On `main` after the baseline, #485 (`52d1bd0a`) made `lanesOf` read an integer vector's packed
  bytes as `u32` or `i32` lanes. Accepted change 0046 reads a struct array with an integer field
  as `u32` lanes.
- Each of those reads its lanes from the packed bytes. So the bytes take the place of the packed
  bytes there too. This is an inference from the diff of #485 and the text of 0046.
- A kernel function's array is a parameter of type `array<T>` (`kernelFace` in
  `src/compiler/ts/host-face.ts`), never a struct's field. So for bytes, every tier of a kernel
  call counts `byteLength / stride` elements.
- A 4-byte typed array cannot view a buffer from an offset that is not a multiple of 4. Its
  constructor throws a `RangeError`.
- So the call views the bytes in place when their `byteOffset` is a multiple of 4. Otherwise it
  views a copy, `new Uint8Array(bytes)`, which starts at offset 0. This holds for every array a
  loop reads.
- The array a loop writes holds 4-byte elements (Rule 11.8). `onWebgl2` reads its bits as
  `new Uint32Array(out.buffer, out.byteOffset, out.length)` (line 167). For a `Uint8Array`,
  `length` counts bytes, and the offset can be odd.
- So the call reads and writes those bits as 32-bit words over `byteLength / 4`, by the same
  copy rule. After the draw it copies the words of a copy back over the caller's bytes.
- At the baseline (fact), only an array in a storage binding that is not `read_write` gets a
  `dataTexture` (`dataTextureOf` in `src/core/manifest.ts`, line 267).
- At the baseline, every field of an array of structs must also be an `f32`, a `u32` or a
  `vecN<f32>`. A struct with an `i32` field, for example, gets none.
- At the baseline, such a texture is the struct's `std430` stride in `r32float` lanes, with a
  `u32` bit-cast. So the bytes of such an array are that texture's texels as they are.
- Accepted change 0046 makes the texture of a struct with a `u32` or an `i32` field R32UI (its
  "What changes"). The `f32` lanes of such a struct are then read through `uintBitsToFloat`.
- Each lane is still one 4-byte word of the struct's `std430` stride. So the bytes stay that
  texture's texels. This is an inference from the text of 0046, which `main` at `fba7c05e` does
  not implement.
- A host with a WebGL2 path of its own can therefore upload the bytes of such an array with no
  packing. This is an inference from the code. The proposal adds no test of a host's own path.

**The wasm tier of change 0042.** That proposal is a draft at the baseline. It keeps arrays in
the module's linear memory as bytes in the `std430` layout. If both proposals are accepted, the
bytes copy into memory as they are, and a written binding copies back. The proposal implemented
second carries that line and its test.

### What the oracle records

- The oracle takes `CpuValue`s: `compileModule` and `CpuModule.setBinding` in
  `src/core/oracle.ts`, and `compileModuleJs` in `src/core/cpu-codegen.ts`. They do not change.
- The CPU tier decodes the bytes into the `CpuValue`s of the host value that packs to the same
  bytes. So the oracle records the same results for both.
- It also records the same `console.*` events, which carry decoded numbers and never bytes. The
  determinism report (Rule 11.2) belongs to the compile and sees no host value.
- The two exceptions are above: an emulated `f64` decodes as `hi + lo`, and a NaN may change
  its encoding on the way back.
- `gate:differential` holds the GPU to the oracle over generated programs. It needs no change.

### The host view and the editor (Rules 8.21 and 8.24, proposed)

`hostFace` writes the host view (`bindingTsType` in `src/compiler/ts/host-face.ts`, line 434).
Every storage binding's type and every kernel array's type gains `Uint8Array`. Where the view
names `Resident<T>` (lines 769 and 770, and 1259 and 1260), it adds `Resident<Uint8Array>`. A
uniform binding's type does not change. For example, a written `f32` scalar binding becomes
`Float32Array | Uint8Array`.

The view of surface §67's `scale` at the baseline, as `tshc sync` wrote it in a scratch
directory on 2026-10-05:

```ts
export declare function scale(bindings: { readonly k: number; readonly xs: Float32Array | Resident<Float32Array>; readonly ys: Resident<Float32Array> }, workgroups: number | readonly [number, number?, number?]): void;
export declare function scale(bindings: { readonly k: number; readonly xs: Float32Array | Resident<Float32Array>; readonly ys: Float32Array | Resident<Float32Array> }, workgroups: number | readonly [number, number?, number?]): Promise<void>;
```

The view after this proposal:

```ts
export declare function scale(bindings: { readonly k: number; readonly xs: Float32Array | Uint8Array | Resident<Float32Array> | Resident<Uint8Array>; readonly ys: Resident<Float32Array> | Resident<Uint8Array> }, workgroups: number | readonly [number, number?, number?]): void;
export declare function scale(bindings: { readonly k: number; readonly xs: Float32Array | Uint8Array | Resident<Float32Array> | Resident<Uint8Array>; readonly ys: Float32Array | Uint8Array | Resident<Float32Array> | Resident<Uint8Array> }, workgroups: number | readonly [number, number?, number?]): Promise<void>;
```

A probe checked these types on 2026-10-05 under the compiler's `lib` (`ES2022`, `DOM`). It ran
`tsc` 5.6.3 (the compiler's dev dependency), 5.9.3 and 6.0.2. CI reads the API surface with the
newest 5.x and with 6.0 as well (`src/api-surface.test.ts`, lines 46 to 52). The probe used a
copy of the `Resident` interface of `src/core/resident.ts`. All three versions gave the same
result:

- For an array of structs, a `Uint8Array` and a `Resident<Uint8Array>` type-check.
- A `Float32Array`, a `Resident<Float32Array>` and a `Uint8ClampedArray` are TS2322.
- For `scale`, a `Resident<Uint8Array>` for `ys` selects the first signature, which returns
  `void`.

At the baseline the view declares the default export of a host import as `Pack` (line 1294).
The program runtime's `Bindings` is `Readonly<Record<string, unknown>>` (`src/runtime/program.ts`,
line 44). This proposal changes neither type, and the JSDoc of `Bindings` gains the bytes.
Accepted change 0030 types the default export and the bindings of each pipeline. The next section
says what its types become with the bytes.

The language service reads shader files, and a host value is not something a shader author
writes. So it does not change, and Rule 12.7 is not touched.

### Interaction with change 0030 (accepted)

**Change 0030 at the baseline (facts).**

- Change 0030 (`changes/0030-typed-bindings.md`) is `status: accepted`. Its acceptance merged in
  #417 (`8bd5ed9c`).
- It is not implemented. No file of `src/` names `BindingsOf`, and the view declares the default
  export as `Pack` (`src/compiler/ts/host-face.ts`, line 1294).
- It edits Rules 8.21 and 11.11 and surface §64 and §69. This proposal edits the same two rules
  and §69. It edits §64 if 0030 is implemented before step 1, or if open decision 7 makes step 1
  the carrier (below).
- Its view types the default export as `Pack<{ entry: … }>`, with the bindings each entry
  reaches. In its words, "The types are written inside `Pack<…>`."
- It types a buffer binding as "its host value (Rule 8.21), written as the host view already
  writes a parameter". Its examples are "a struct as an object, a vector as a tuple, a matrix as
  its flat array".
- A buffer binding also takes "a `Resident` of that value, or the host's own buffer" (0030, lines
  64 to 66).
- `program.compute()` and `program.render()` then return pipelines typed with those bindings.
  `frame.dispatch()`, `pass.draw()` and the pipelines' own `dispatch()` and `draw()` take them.
- An untyped `Pack`, such as a manifest read from JSON, "takes any bindings, as today". It is
  `Pack<Record<string, Bindings>>`.
- 0030's "What it touches" gives Rule 8.21 this text: "the host value of a binding is the one a
  parameter of that type takes" (0030, line 110).
- 0030's code builds the view's program declaration "from the manifest's entries and
  `hostTypeOf`" (0030, lines 122 and 123).
- `hostTypeOf` (`src/compiler/ts/host-face.ts`, line 200) gives the host type of a helper's
  parameter and of a kernel function's value parameter (lines 1128 and 920).
- Neither of those parameters takes bytes ("Where they are not taken"). `hostTypeOf` gives no
  type for an array with no size (lines 225 and 226).
- `bindingTsType` writes such an array today, for an entry call's binding and for a kernel
  function's array (lines 766 and 1257). Step 2 widens `bindingTsType`.

**The engine (an inference).** The engine loads its program from the typed default export:
`rt.load(trace)` (radiance `bc99533`, `packages/radiance/src/renderers/PathTracer.ts`, lines 13
and 144). After 0030, `tsc` reads each binding the engine passes there.

**The binding types after both changes (proposed).** `T` is the type 0030 writes for the
binding's host value.

| Binding of the typed default export | Under change 0030 alone                     | Under change 0030 and this proposal                |
| ----------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| A storage binding                   | `T`, `Resident<T>` or the host's own buffer | Those, and `Uint8Array` and `Resident<Uint8Array>` |
| A uniform binding                   | `T`, `Resident<T>` or the host's own buffer | No change                                          |

**The probe of 0030's types (observed).** A probe on 2026-10-05 wrote these binding types by
hand, since 0030 is not implemented. It used a copy of the `Resident` interface of
`src/core/resident.ts` and a stand-in for the host's own buffer. It ran `tsc` 5.6.3, 5.9.3 and
6.0.2 under `ES2022` and `DOM`, and all three gave the same result:

- For an array of structs under 0030's types alone, `{ nodes: bytes }` and
  `{ nodes: resident(bytes) }` were TS2322.
- With `Uint8Array` and `Resident<Uint8Array>` added, both type-checked.
- So under 0030 alone, the dispatch of the engine example in "Before and after" would be a type
  error. This is an inference from the probe.

**Which change carries the bytes there (proposed, open decision 7).**

- Step 1 adds a sentence on the program runtime's bytes to Rule 8.21 ("What it touches"). From
  step 1 on, Rule 8.21 names the bytes among a storage binding's host values.
- The order of step 1 and change 0030's implementation decides which change carries the bytes in
  the typed default export, with its test.
- If change 0030 is implemented before step 1, step 1 carries them. Step 1 then edits the program
  declaration of `hostFace` and the text of surface §64 that gives a binding's types.
- For that case the front matter lists §64.
- If step 1 is implemented before change 0030, 0030's text as written does not carry them. It
  ties a binding's type to a parameter's type and builds it from `hostTypeOf`. This is an
  inference from the facts above.
- No parameter takes bytes until step 2, and none ever does under open decision 5's alternative.
  So 0030's implementation, built as its text says, writes no `Uint8Array` for a binding.
- Its sentence of Rule 8.21 would then contradict step 1's sentence, "A storage binding of a draw
  or a dispatch also takes its bytes". This is an inference too.
- So in that order the owner chooses the carrier (open decision 7). One carrier is step 1,
  amended first to add the bytes to the typed default export after 0030's implementation.
- The other carrier is an amendment of change 0030 that names the bytes of a storage binding.
- Either carrier makes the two sentences of Rule 8.21 one rule. A binding takes the host value
  that a parameter of its type takes, and a storage binding also takes its bytes.
- This draft does not know which writer 0030's implementation uses. If it reuses
  `bindingTsType`, step 2's edit of that function reaches the typed default export too.
- So this draft does not claim that step 2 adds no type there. In that case the order of step 2
  and change 0030 matters as well.
- Under open decision 5's alternative, which stops after step 1, the carrier is the same. In the
  order step 1, then 0030, change 0030 as written never carries the bytes.

**Exports (an inference).** 0030 writes the binding types inside `Pack<…>` in each view, and
`src/__api__/surface.md` lists no view. So this draft expects no export to change in either
order. If 0030's implementation names a binding's value type in an export, this proposal is
amended first to declare that export.

**`Bindings` (an inference).** 0030's untyped `Pack` is `Pack<Record<string, Bindings>>`. So
this draft reads 0030 as keeping `Bindings` as `Readonly<Record<string, unknown>>`.

### Compatibility (Rule 13.9)

- A host program that type-checks against the call layer's view keeps type-checking. Each
  binding's type gains members and loses none.
- At run time a `Uint8Array` for an array with no size is refused today and taken after. A call
  that throws today is not a program that worked (Rule 13.9).
- **The break.** Today some bindings take a value at their top that this proposal reads as bytes
  or refuses. The table lists them.

| Value at the top of the binding                                                                     | Today, at the baseline (fact)                                  | After this proposal (proposed)                                                                          | The edit that keeps today's meaning                                                          |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A `Uint8Array` for a storage vector, matrix or sized array                                          | Its numbers, as any `ArrayLike` of the right length (`listOf`) | A refusal of its length                                                                                 | `Array.from(bytes)`                                                                          |
| A `Uint8Array` for a uniform vector, matrix or sized array                                          | Its numbers, as above                                          | A refusal (open decision 3)                                                                             | `Array.from(bytes)`                                                                          |
| A `Uint8Array` for a struct whose every field it has, such as `length`                              | The object (`pack`, case `'o'`)                                | In storage, its bytes when its length passes the length check, else a refusal. In a uniform, a refusal. | An object of the fields, such as `{ length: bytes.length }`                                  |
| A `Uint8Array` for a fieldless struct                                                               | The object, which holds no field                               | In storage, its bytes when it is 4 bytes long, else a refusal. In a uniform, a refusal.                 | `{}`                                                                                         |
| An `ArrayBuffer` for a fieldless struct, or a struct whose every field it has, such as `byteLength` | The object                                                     | A refusal                                                                                               | `{}`, or an object of the fields, such as `{ byteLength: buffer.byteLength }`                |
| `resident()` of an `ArrayBuffer`                                                                    | A handle, which binds as such a struct                         | A refusal at the call                                                                                   | `resident()` of that object, or `resident(new Uint8Array(buffer))` where the bytes are meant |

- A probe on 2026-10-05 ran today's `pack` under bun 1.3.14. A `Uint8Array` of `[255, 0, 0, 255]`
  for a `vec4u` gave the words 255, 0, 0 and 255.
- In the same probe, a `Uint8Array` of 4 numbers packed as a `mat2x2`. One of 7 bytes packed as
  `class S { length: u32 }`, with the value 7. A struct field named `length` compiles.
- In the same probe, an `ArrayBuffer` and a `Uint8Array` each packed as a fieldless struct. A
  `Uint8Array` for `array<u32>` and for a struct with a field `a` was refused, as the table
  assumes.
- **The call layer's view.** It types a vector as a tuple, a matrix as `number[]` and a sized
  array as an array type. It does so in storage and in a uniform (`bindingTsType`, lines 434 to
  450).
- `tsc` 5.6.3, 5.9.3 and 6.0.2 each gave TS2345 for a `Uint8Array` there. Each took one for a
  fieldless struct's `{  }` and for `{ readonly length: number }`.
- So typed host code on the call layer meets the break only at such a struct, and at
  `resident()` of an `ArrayBuffer`. The signature of `resident` takes any value. Any other case
  there needs a caller that `tsc` does not read.
- **The cost to the editor (observed).** Another probe on 2026-10-05 typed a vector binding as
  `readonly [number, number, number, number] | Uint8Array`. It ran `tsc` 5.6.3, 5.9.3 and 6.0.2.
  - A literal `[1, 2, 3]` gave TS2322 on each. Its second line said that the tuple is not
    assignable to `Uint8Array` (`Uint8Array<ArrayBufferLike>` on 5.9.3 and 6.0.2).
  - Without `Uint8Array` in the type, the second line was
    `Source has 3 element(s) but target requires 4.`
  - A struct literal with a missing field still got a line that names the field. A tuple of the
    right length and a complete struct literal type-checked.
  - So the bytes make the message for a wrong tuple less clear. The probe showed it for a vector,
    and it can reach any binding whose type gains `Uint8Array`.
  - Open decision 4's alternative adds no `Uint8Array` to a sized binding, so it avoids this cost
    there.
- **The program runtime at the baseline.** `Bindings` is `Readonly<Record<string, unknown>>`
  (`src/runtime/program.ts`, line 44), and the default export is an untyped `Pack`. No type
  guards any binding there.
- So at the baseline a host of the program runtime meets every row of the table at run time,
  with no type error.
- **The program runtime after change 0030.** A host of a typed default export gets a type for
  each binding ("Interaction with change 0030"). The probe of 0030's types also ran the rows of
  the table under 0030's types alone:
  - A `Uint8Array` for a vector, a matrix or a sized array was TS2322. So such a host meets the
    first two rows only through a caller that `tsc` does not read.
  - A `Uint8Array` for `{ readonly length: number }` or `{}` type-checked. An `ArrayBuffer` for
    `{}` or `{ readonly byteLength: number }` type-checked too.
  - So such a host meets the struct rows as a typed host of the call layer does, the silent case
    included.
  - `resident(new ArrayBuffer(4))` for a fieldless struct type-checked. After this proposal,
    `resident()` refuses it at the call.
  - With both changes, a `Uint8Array` for a storage vector type-checks, and the runtime refuses
    its length. For a uniform vector it stays a type error.
- A host of an untyped `Pack`, such as a manifest read from JSON, still meets every row at run
  time with no type error.
- **Which rows refuse.** After this proposal every row refuses at the call, with a sentence of
  "Refusals", except the two cases in storage below.
- The rows of vectors, matrices and sized arrays always refuse. A `Uint8Array` of N numbers is N
  bytes, and each element of those layouts takes at least 4 bytes.
- **The silent case.** In storage, a struct binds before and after when the `Uint8Array` has
  each of its fields, and its length passes the length check. For a struct of fixed size, that
  length is the struct's size.
- `pack` finds a field with `name in o` (`src/core/host-entry.ts`, line 315), so a property of
  the prototype counts. Before, each field holds that property. After, the fields hold the words
  of the bytes.
- A scalar field reads a number property: `length`, `byteLength`, `byteOffset`,
  `BYTES_PER_ELEMENT`, and `offset` on a `Buffer`.
- A field of struct type reads the `ArrayBuffer`: `buffer`, and `parent` on a `Buffer`. Its own
  fields read that buffer's number properties, such as `byteLength` and `maxByteLength`.
- A fieldless struct takes any object, so a fieldless field named `buffer` or `parent` binds
  too.
- A vector, a matrix or a sized array field finds no property it takes. `listOf` takes only an
  object with a numeric `length`, and no object property of a `Uint8Array` has one. This is an
  inference from the code.
- A last field with no size named `buffer` or `parent` reads the `ArrayBuffer`. `pack` writes
  none of its elements, since the buffer's `length` is `undefined` (case `'a'`).
- Before, such a struct binds at its fixed size, which `byteSize` gives for any value
  (`fixedSize`, case `'o'`). WebGPU takes that size only when it reaches the minimum binding size.
- By the rule of "A struct whose last field has no size", that needs a field of alignment 8.
  Here that is an `f64`, or a struct that holds one. The last array then holds 4-byte elements at
  an offset of 4 modulo 8. This is an inference from the rule.
- A second `pack` probe on 2026-10-05, under bun 1.3.14, showed it. `class S { length: u32 }`
  given `new Uint8Array(4)` packed the word 4. As bytes, its four zero bytes are the word 0.
- In that probe, a struct of `byteLength` and `byteOffset` given `new Uint8Array(8)` packed 8
  and 0. A struct of `length` and `a` was refused, since the array has no `a`.
- A third `pack` probe that day, under bun 1.3.14, read fields of struct type. `class S`
  with a field `buffer: B`, where `class B { byteLength: u32 }`, packed the word 4 from
  `new Uint8Array(4)`.
- In the third probe, `maxByteLength` in place of `byteLength` packed 4 too. A field `parent: B`
  given `Buffer.alloc(4)` packed 4. A fieldless `B` named `buffer` or `parent` packed.
- In the third probe, a `vec2<u32>` field named `buffer` was refused. So was a field of struct
  type named `constructor`, which reads a function. Struct fields named `buffer` and `parent`
  compiled with no diagnostic.
- A fourth probe that day compiled a struct whose last field has no size:
  `class S { length: f64; byteOffset: u32; buffer: array<u32>; }`. The manifest gave it a `size`
  of 16, with `buffer` at 12. By the rule, 16 is its minimum.
- In the fourth probe, `byteSize` gave 16 for a `Uint8Array` of 16 bytes and of 40 bytes. `pack`
  wrote no element of `buffer`. After this proposal, those lengths bind 1 and 7 elements.
- `tsc` 5.6.3, 5.9.3 and 6.0.2 each took a `Uint8Array` for
  `{ readonly buffer: { readonly byteLength: number } }` and for `{ readonly buffer: {} }`. So a
  typed host meets these cases as well.
- A fieldless struct given 4 bytes binds before and after as well. Its 4 bytes are the private
  carrier of change 0035 (`src/core/reflect.ts`, line 289).
- No shader source names that carrier, so nothing the shader computes changes there. This is an
  inference from the code.
- **Rule 13.10 (an inference).** That rule covers "a change that keeps a program compiling and
  makes it compute something else". Its first step is a published warning on each affected line.
- That warning is a diagnostic of `compile()` behind its deprecation option. The silent case has
  no such line: the shader and its emit do not change.
- The affected line is a host call, and no compile reads it. So this draft reads Rule 13.10 as
  not covering the silent case. Whether that reading holds is part of open decision 4.
- Under Rule 13.9 the break ships in a new `0.N.0`. Both steps ship in that same release
  ("Steps"), so the break reaches both layers at once.
- **The changelog.** Rule 13.9 asks the entry to name the edit an author makes to migrate. The
  `CHANGELOG.md` entry names the edit of each row, as the table's last column gives it.
- The entry also names the silent case, with its old meaning and its new one. Open decision 4 is
  the alternative with no break.

### A struct whose last field has no size

**The minimum binding size (measured).** WebGPU binds such a struct from a minimum size. It is
the struct's size with the last array taken as one element, rounded up to the struct's
alignment. So a length of whole elements can still be too short.

The drafting agent measured it on 2026-10-05 in a scratch directory, through Playwright 1.63.0.
It ran Chromium 141 (`HeadlessChrome/141.0.0.0`) on SwiftShader, with the journey gate's flags
(`CHROMIUM_ARGS` in `scripts/user-journey.ts`). Each case bound one buffer at the size below and
dispatched once.

The pipeline had an explicit layout with no `minBindingSize`, as both layers build it
(`pipelineLayout` in `src/core/host-entry.ts`, `layoutEntry` in `src/runtime/program.ts`).
Rule 11.11 says the program runtime never uses `layout: 'auto'`.

| WGSL type of the binding                                         | Offset and stride of the array | Sizes WebGPU refused | Sizes WebGPU took, with `arrayLength` |
| ---------------------------------------------------------------- | ------------------------------ | -------------------- | ------------------------------------- |
| `struct T { m: vec4f, items: array<f32> }`                       | 16 and 4                       | 20, 24, 28           | 32 (4), 36 (5)                        |
| `struct T { m: u32, items: array<f32> }`                         | 4 and 4                        | 4                    | 8 (1), 12 (2)                         |
| `struct T { m: vec4f, n: f32, items: array<f32> }`               | 20 and 4                       | 24, 28               | 32 (3)                                |
| `struct T { m: f32, items: array<vec3f> }`                       | 16 and 16                      | 16, 28               | 32 (1), 48 (2)                        |
| `struct T { m: u32, items: array<vec2f> }`                       | 8 and 8                        | 12                   | 16 (1), 20 (1), 24 (2)                |
| `struct T { m: vec4f, items: array<E> }`, `E` three `f32` fields | 16 and 12                      | 28                   | 32 (1), 40 (2)                        |
| `array<vec3f>`                                                   | 0 and 16                       | 12                   | 16 (1), 28 (1), 32 (2)                |
| `array<f32>`                                                     | 0 and 4                        | none                 | 4 (1), 8 (2)                          |

Each refusal was a validation error at the dispatch, of one form. For example: "[Buffer
(unlabeled)] bound with size 20 at group 0, binding 0 is too small. The pipeline
([ComputePipeline (unlabeled)]) requires a buffer binding which is at least 32 bytes."

An earlier run of the same cases under `layout: 'auto'` refused and took the same sizes, with
another text. Every row fits the rule below. The rule is an inference from those rows and from
the specification ("Assumptions"). The rule (proposed):

- The struct's alignment `A` is the largest alignment of its fields, the last array's element
  included (WGSL's `AlignOf`).
- The minimum is the last field's offset plus one stride, rounded up to a multiple of `A`.
- The runtime takes a length of whole elements at or above the minimum. A shorter one gets its
  own sentence ("Refusals").
- For the `vec4f` struct above, the smallest length the runtime takes is 32 bytes, 4 elements.
  For the struct of `E` elements, it is 40 bytes, 2 elements, since 32 is not whole elements.
- WebGPU also takes a length that ends inside an element, and `arrayLength` drops the part (20
  bytes and 28 bytes above). The runtime refuses such a length, as `runtimeCount` refuses a part
  of an element today.
- Rule 13.3 asks for the measured text in the code comment as well. Step 1's comment carries the
  text measured under the runtime's own layouts, quoted above.

**Where the runtime reads `A` (open decision 8).** The manifest gives each offset, size and
stride, and no alignment. For such a struct, its `size` is the last field's offset rounded up to
`A`. So it does not give `A`: the `vec4f` struct above has a `size` of 16, with `items` at 16.

- Recommended: the runtime derives `A` from the field layouts, by the numbers of `typeLayout` in
  `src/core/reflect.ts`.
- A scalar is 4, and an emulated `f64` is 8. A vector of two lanes is 8, and of three or four
  lanes 16, an `f64` vector included.
- An atomic is 4. The host `Layout` carries it as a scalar of its integer (`layoutOf`, case
  `'atomic'`, in `src/core/manifest.ts`), and `typeLayout` gives it 4.
- A matrix of two rows is 8, and of three or four rows 16. An array takes its element's, a struct
  its largest field's, and a fieldless struct 4.
- This is a second copy of a layout rule. The comment on `Layout` in `src/core/host-entry.ts`
  (lines 35 and 36) says that the runtime computes no layout itself.
- So a test holds the copy to `typeLayout`, for every struct that the examples bind as storage.
- The alternative adds the alignment to the manifest's struct layout (`PackLayout` in
  `src/core/manifest-types.ts`). That changes the manifest, so this proposal is amended first,
  with Rule 11.10 among its rules.

**The object host value (observed at the baseline).** A probe on 2026-10-05 packed
`class List { count: u32; items: array<f32>; }` bound as `storage<List>`. The manifest gives it a
struct `size` of 4, with `items` at offset 4 and a stride of 4. `byteSize` sizes the host value by
the fixed part alone (`fixedSize`, case `'o'`). `pack` then threw
`RangeError: Out of bounds access` under bun 1.3.14.

So the object host value of such a binding fails today. Bytes would be its first host value
that binds. The failure of the object is a separate bug fix, and this proposal does not fix it.

### Exclusions

- No change to the manifest (Rule 11.10), unless open decision 8 takes its alternative. No
  change to the WGSL, the GLSL, the generated module, a diagnostic or an example.
- No change to the meaning of a typed array or an array of objects. The break changes only the
  meaning of a `Uint8Array` and an `ArrayBuffer` ("Compatibility").
- No public decoder of bytes for a host or a script (open decision 6).
- No partial write. Record 0006 item 2 asks for it in a proposal of its own, change 0048. That
  is a draft written beside this one, not on `main` at the baseline.
- No texture write, which is record 0006 item 4 (change 0050, another such draft).
- No check of a binding's size against a device limit. That is record 0006 item 1, change 0051,
  a draft too. "Interaction with change 0051" gives the order of its check and the length check.
- No fix of the object host value of a struct with a last array of no size.
- No refusal of a `Resident` bound under another layout. Change 0025 declares it, and its fix
  is change 0025's own (open decision 9).
- No change to the runner of `typeshade/compute`, which predates the program runtime (change
  0025, "What stays").
- No new dependency.

### Interaction with change 0048 (a draft)

Change 0048 proposes `r.write(part, { offset })` on a `Resident` of a typed array or an array.
Its "Why one method" section says that a byte write is that method on a handle whose host
value is bytes. If both proposals are accepted, a handle of bytes takes a `Uint8Array` part and
an offset in bytes. The next use uploads the 4-byte words the part touches, since
`queue.writeBuffer` takes offsets and sizes in multiples of 4. The proposal implemented second
carries that line and its test.

### Interaction with change 0051 (a draft)

Change 0051 is record 0006 item 1, a draft in pull request #489 at `56a46578`, where it moved from `0047` to `0051` after main took `0047`. It is not on
`main` at the baseline. Its part 4 holds each buffer binding of a dispatch or a draw to a device
limit. That part is "The value checks (part 4)" in `changes/0051-device-limits.md` at
`bbe70169`, lines 315 to 348.

- 0051 sizes a plain value in a storage binding by its packed bytes, and a `Resident` by the
  bytes of its host value. A size past a limit is a `RangeError`.
- Its checks run in a pass of their own, before the call takes the console buffer. In its words,
  the pass "leaves a value it cannot size, such as one that does not fit its layout, to the
  binding walk".
- If both proposals are accepted (proposed), the pass sizes bytes by their `byteLength` when they
  pass the length check of this proposal. A handle of bytes has the `byteLength` of its copy.
- For `maxBufferSize`, bytes count as 0051 counts a plain value: their `byteLength` rounded up to
  16, as `BufferPool.take` rounds it (`src/runtime/program.ts`, line 249).
- Bytes of another length, and bytes for a uniform binding, do not fit their layout. The pass
  leaves them to the binding walk, which refuses them with the `TypeError` of "Refusals".
- So bytes of a valid length past a limit get 0051's `RangeError`. Bytes of a wrong length get
  this proposal's `TypeError`, whatever their size.
- Of step 1 and change 0051, the one implemented second carries these lines and their test. Step 2
  does not take part, since 0051 adds no limit check to the call layer (its "What each tier
  does").

### Steps (proposed)

1. **The program runtime and `resident()`.** The bytes in `#resource` and `#packed`, in
   `notHostValue`, `copyOf`, `write()` and `sync`. The refusals of the tables above, and the
   article of the five texts in "Refusals". Step 1's text of Rules 8.21, 11.8 and 11.11 and of
   surface §69 ("What it touches"). The engine needs this step alone.
   If change 0030 is implemented before step 1, step 1 also carries the bytes in the typed
   default export. It then edits surface §64 ("Interaction with change 0030"). In the other
   order, open decision 7 names the carrier.
2. **The call layer.** The bytes in `checkBindings`, `packed`, `onGpu`, `checkArray`, `lanesOf`
   and `onWebgl2`. The decoder and encoder of the CPU tier. The call layer's host view:
   `bindingTsType` and the two `Resident` spellings. Step 2's text of Rules 8.21 and 11.8 and of
   surface §65 and §67.

Each step is its own pull request with a `Change: 0049` line. Between the two, the call layer
refuses a `Resident` of bytes with today's sentences, such as
`got a Uint8Array, not a Float32Array`. In that interval, Rule 11.8 and surface §69 say so.

In that interval, a `Uint8Array` for a sized storage binding is bytes on the program runtime
and numbers on the call layer. So both steps ship in one `0.N.0` release, and no release is cut
between them. The break then reaches both layers in one release ("Compatibility").

Open decision 9 recommends the fix of the deviation from change 0025 before step 1, in its own
pull request with a `Change: 0025` line.

## Why

### The cost today (facts at the baseline)

- An array of structs reaches the GPU through `pack`, one `DataView` write per number
  (`src/core/host-entry.ts`, lines 267 to 321). A read back goes through `readInto`, one read
  per number (lines 335 to 369).
- `resident()` and `write()` copy an array of objects with `structuredClone` (`copyOf` in
  `src/core/resident.ts`, lines 127 to 131).
- An entry call packs each value twice. `checkBindings` packs it into scratch memory to check it
  (lines 802 to 806). `packed` packs it again to upload it (lines 823 to 830).
- The program runtime packs a plain value at each draw and each dispatch (`#packed` in
  `src/runtime/program.ts`). It packs a `Resident` at each upload after a `write()`.

The drafting agent timed these steps on 2026-10-05 at the baseline. It used bun 1.3.14 on Linux,
on an Intel Xeon at 2.10 GHz with 4 cores. A script in a scratch directory outside the tree
imported `src/core/host-entry.ts`. It used 1,048,576 elements of the `Node` above, 32 bytes each.
Each step ran three times:

| Step                    | What it does                                                    | Time              |
| ----------------------- | --------------------------------------------------------------- | ----------------- |
| `byteSize`, then `pack` | the array of objects into a new buffer of 33,554,432 bytes      | 399 to 502 ms     |
| `readInto`              | the bytes back into the same objects                            | 193 to 305 ms     |
| `structuredClone`       | the copy `resident()` and `write()` make of an array of objects | 1,925 to 1,968 ms |
| a byte copy             | `new Uint8Array(n).set(bytes)` over the same 33,554,432 bytes   | 19 to 22 ms       |

These are one machine's numbers. They are evidence for this draft and not a gate. For change
0013, #252 measured about 220 ms in and 1.3 s out per million of the same size (Rule 11.8, its
rationale).

### What the engine needs

The facts below are from the engine's [record 0001](https://github.com/typeshade/radiance/blob/0bd1be89d1d5fe1407c34c3ed56809ff0c2c512d/docs/design/0001-scene-data-model.md)
at radiance commit `0bd1be8`.

- Its rule 2 makes every scene buffer an `array<vec4>` or an `array<vec4u>`, bound from one
  typed array. An integer word is stored as its bits and read with `bitcast<u32>` (surface §44).
- The record gives the reason: a million nodes as objects is a million cloned objects and a
  `DataView` write per field.
- Its upload rule writes `nodes`, `triangles` and `vertices` whole when a geometry changes. It
  writes `instances`, `nodes` and `lights` whole when a transform changes.
- So the engine pays the conversion at each write, not once. Residency does not remove that
  cost for a buffer that the host writes again at each change.
- Its kernels read a record as `instances[i * 8 + 6]` through named helpers such as
  `instanceBases(i)`. The record says that structs read better, and that a named helper reads as
  well as a field. Record 0006 lists readability as the need of item 3.

With bytes, the engine can declare its records as structs, with `u32` fields for its integer
words. It can keep its typed-array builder and pass the bytes. This is an inference. Whether the
engine does it is the engine's decision, as an amendment to its record 0001.

The engine's oracle path reads the same buffers, and bytes do not reach it:

- The engine's `scripts/oracle.ts` (radiance `bc99533`, lines 11 and 52 to 57) runs the oracle
  through `compileModuleJs` and `setBinding`. It gives each buffer as a `CpuValue`, from the
  typed arrays the renderer uploads.
- A `CpuValue` has no form for bytes (`src/core/cpu-runtime.ts`, line 43). With its records as
  structs, the engine would give `setBinding` an array of objects for each.
- Under open decision 6's recommendation no decoder is public. So the engine would build those
  objects a second way, or decode its bytes by the manifest's layout in its own code.
- Record 0001 says of the oracle: "Nothing in the oracle knows the layout. It knows the pack."
  That would no longer hold.
- So bytes meet the readability need in the kernels, and not in the oracle path. This is an
  inference. Open decision 6's alternative would close that gap.

The site is a second host that holds buffers as bytes. At typeshade.github.io `79484e3`, its
Playground runner keeps each storage and uniform buffer as a `Uint8Array`. It makes a
`GPUBuffer` of its own for each one with `writeBuffer`. Those are `StorageBufferSpec.bytes` and
`UniformBufferSpec.bytes` in its `src/lib/shader-bindings.ts`. The `writeBuffer` call is at
line 1171 of its `src/lib/shader-runtime.ts`.

### Why this revisits decision 3 of change 0013

Change 0013 is implemented. The owner took #252's recommendation as its decision 3. It reads:
"A struct array takes objects only." A packed `ArrayBuffer` in the storage layout "would put
`vec3` padding in the caller's file". 97 of the corpus's 162 structs have padding. Residency
answers the conversion cost by paying it once.

Two facts changed after that decision:

- **The layout is public now.** The manifest carries each binding's layout, with every offset,
  size and stride (Rule 11.10, change 0025). Before 0025, no public output gave an element
  stride (0025, section 1). So a host that writes bytes reads the padding from the compiler,
  and does not compute `std430` itself.
- **Residency pays once for each write.** An engine that writes a buffer at each change pays
  at each change (the table above).

What stays from decision 3:

- The array of objects stays the host value the view names first. Surface §65 and the
  `loop-struct-array` example teach it.
- The padding stays out of the file of every host that does not pass bytes.
- Only a host that already lays out bytes passes them: an engine, or a loader of a binary
  format.

### Why one representation, the `Uint8Array`

- **Little meaning is taken away.** WGSL has no 8-bit storage type, so no binding holds a
  `Uint8Array` as its own array type (`notHostValue` in `src/core/resident.ts`, line 142).
- A `Uint8Array` binds today only as an `ArrayLike` of numbers or as an object. Those are the
  cases of the break ("Compatibility").
- **A 4-byte typed array has a meaning already.** A `Float32Array` for `array<vec3<f32>>` holds
  three numbers an element, and the call pads each element to its stride (Rule 8.21). So a
  `Float32Array` cannot also mean the bytes.
- **An `ArrayBuffer` in the view would let an older `tsc` pass a typed array.** `tsc` 5.6.3
  gave no error for a `Float32Array` or a `Uint32Array` where a parameter is
  `Uint8Array | ArrayBuffer`.
- `tsc` 5.9.3 and 6.0.2 gave TS2345 for both. TypeScript 5.7 made the typed arrays generic over
  their buffer (`src/api-surface.test.ts`, lines 49 and 50). All three gave TS2345 where the
  parameter is `Uint8Array`.
- The peer range is `>=5.0.0 <7` (`package.json`). So a view that names `ArrayBuffer` would let a
  host on TypeScript 5.6 pass a typed array for an array of structs. The runtime would then
  refuse it.
- That holds for 5.0 to 5.5 too, by inference: the typed arrays are generic only from 5.7. The
  probe did not run those versions.
- A `Uint8Array` over a buffer costs no copy.
- **One copy rule.** A handle copies bytes by one rule, which keeps the class passed. So
  `Resident<T>.read()` gives a `T` ("`resident()` and `Resident`"). A second representation would
  need its own copy rule and its own type back.

### Why not a typed array for an array of structs

Record 0006 item 3 names this as its second shape. It is not chosen, for three reasons:

- A `Float32Array` for an array of `vec3` is tight today, and the call adds the padding. For
  an array of structs it would be padded, as the bytes are. One type would mean two layouts,
  and the host could not tell which from the type.
- A struct with `f32` and `u32` fields fits no single 4-byte typed array. The host would write
  bits through a second view of the same buffer, which is the bytes.
- With bytes, that shape costs one expression:
  `new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)`.

### Alternatives considered

- **The host's own `GPUBuffer`.** The program runtime takes one already (surface §69). It is
  not chosen for this need. An engine written on the runtime alone calls nothing on a WebGPU
  object, as the engine's `CLAUDE.md` requires. Such a buffer also has no host copy, no CPU
  tier, no `read()` and no place in the order of calls.
- **A faster `pack`, generated per layout.** It would lower the cost and keep it, and the
  `structuredClone` of `copyOf` would stay. It is independent of this proposal and not part of
  it.
- **An `ArrayBuffer` or a `DataView` as well.** Not chosen, for the reasons above. The refusal
  names the `Uint8Array` that views the same bytes. Open decision 2 is the alternative.
- **A check of the contents.** Not chosen: every bit pattern of a 4-byte word is a value, and
  no storage binding holds a `bool`.
- **`resident(bytes, layout)`.** Not chosen: the first binding gives the layout, as it gives a
  struct's (change 0025, section 2).
- **A plain copy, with an overload `resident(bytes: Uint8Array): Resident<Uint8Array>`.** The
  overload would keep the types sound for a plain copy. It would reshape `resident` in
  `src/__api__/surface.md`. Not chosen: the copy that keeps the class keeps today's signature
  sound.
- **Bytes for a uniform as well.** Open decision 3.

### Assumptions

- WebGPU's minimum binding size is as measured above, on one implementation (Dawn in Chromium
  141 on SwiftShader). The baseline already refuses an empty array (`byteSize`:
  `got an empty array, which WebGPU cannot bind`).
- This draft reads the WebGPU specification the same way: the array with no size taken as
  `array<E, 1>`, then WGSL's `SizeOf` of the type. That is a reading, not a second measurement.
- The compile gate measures it again on its device (Rule 13.3, "Tests owed").
- A subclass of `Uint8Array` makes a new array of the length its species constructor is given.
  The copy rule relies on it, as `copyOf` does for every typed array today. For a subclass that
  does not, `slice` throws a `TypeError` ("`resident()` and `Resident`").
- `queue.writeBuffer` takes a size that is a multiple of 4. Every stride and every storage size
  is a multiple of 4 (the comment on `packed` in `src/core/host-entry.ts`). So a length that
  passes the check meets it.

### Unresolved decisions

The owner decides these before acceptance. Each is the recommendation above.

1. Bytes beside objects. This amends decision 3 of change 0013 for a host that opts in, and
   objects stay the default.
2. One representation, the `Uint8Array`. An `ArrayBuffer` and a `DataView` are refused, and
   the sentence names the remedy. The alternative takes an `ArrayBuffer` at run time and keeps
   it out of the view.
3. Storage bindings only. A uniform refuses bytes, which is part of the break. The alternative
   lets a uniform take its `std140` bytes too, which the site's Playground already holds.
4. Every storage binding, sized ones included, with the break in a new `0.N.0`. The alternative
   takes bytes only where no `Uint8Array` binds today.
   - Those are an array with no size, and a struct whose last field is one, whose object host
     value fails today.
   - A uniform keeps today's meaning of a `Uint8Array`, and `resident()` keeps taking an
     `ArrayBuffer`. That alternative has no break.
   - The break has one silent case ("Compatibility"). This draft reads Rule 13.10 as not
     covering it, since no compile reads the host call. Whether that reading holds is the
     owner's decision. The alternative has no silent case.
5. The call layer and kernel functions in this proposal (step 2), so a `Resident` of bytes
   serves both layers. The alternative stops after step 1, and the call layer refuses bytes.
   Then a `Uint8Array` for a sized storage binding stays numbers on the call layer and is bytes
   on the program runtime.
   - Under the alternative, the typed default export takes the bytes only through the carrier
     of open decision 7. No parameter then takes bytes, so 0030 as written never names them.
6. The oracle's `CpuModule.setBinding` keeps taking a `CpuValue`, and no decoder is public. The
   alternative is a later proposal that exports the decoder or lets `setBinding` take bytes.
   - Under the recommendation, an engine that passes structs as bytes builds the oracle's
     objects itself ("What the engine needs"). The alternative would spare it that.
7. The order with changes 0030, 0042, 0051 and 0048: the one implemented second carries the
   lines this proposal names for it.
   - For accepted change 0030, the order is that of step 1 and 0030's implementation. The lines
     are the bytes in the typed default export ("Interaction with change 0030").
   - If step 1 is implemented before change 0030, 0030 as written does not carry the bytes
     ("Interaction with change 0030"). The owner chooses the carrier, and this draft recommends
     neither.
   - One carrier is step 1, amended first to add the bytes to the typed default export after
     0030's implementation. The other is an amendment of 0030 that names them.
   - Either carrier makes 0030's sentence of Rule 8.21 and step 1's sentence one rule.
   - If 0030's implementation reuses `bindingTsType`, the order of step 2 and 0030 matters too.
   - For draft change 0051, the order is that of step 1 and 0051. The lines are the size of bytes
     and the order of the two checks ("Interaction with change 0051").
8. The struct's alignment for the minimum binding size: the runtime derives it from the field
   layouts, and a test holds it to `typeLayout`. The alternative carries it in the manifest,
   and this proposal is first amended to touch Rule 11.10.
9. The deviation from change 0025, which has no refusal of a handle bound under another layout.
   The recommendation is a fix with `Change: 0025`, in its own pull request, before step 1.
   Then no handle of bytes binds under two layouts on `main`.
   - The alternative amends change 0025 so that a handle may serve two layouts. This proposal
     would then say so for a handle of bytes.

## What it touches

- **Rule 8.21, step 1.** The paragraph on an entry's bindings gains a sentence on the program
  runtime (Rule 11.11). A storage binding of a draw or a dispatch also takes its bytes.
- That sentence states the length check and the upload of the bytes as they are. It states that
  a uniform binding refuses bytes.
- Change 0030 gives Rule 8.21 the sentence "the host value of a binding is the one a parameter
  of that type takes". If 0030 is implemented first, step 1 adds a storage binding's bytes to it.
- In the other order, the carrier of open decision 7 makes that edit ("Interaction with change
  0030").
- **Rule 8.21, step 2.** That sentence widens to a binding of an entry a host calls (Rule 8.24).
  The paragraph on a kernel function gains the bytes too.
- In step 2 the rule states the write back in place, the decode on the CPU tier and where bytes
  are not taken. "Enforced by" gains the tests of each step.
- **Rule 8.21, its rationale (step 1).** Its first sentence says that the representation is the
  one the CPU tier already runs on, typed precisely in the host view.
- That stays true of the host values. It is not true of the bytes, which the CPU tier decodes
  and the view types only as `Uint8Array`.
- So the rationale gains a sentence on the bytes: a host that already holds them pays `pack`
  and `structuredClone` for nothing ("Why").
- **Rule 8.24** does not change. Its `bindings` take "the binding's host value (Rule 8.21)", so
  the bytes reach an entry call through Rule 8.21.
- Its read back "into the caller's value in place" holds for bytes as it is written. So its
  text needs no edit.
- Its "Enforced by" names code this proposal edits, `src/core/host-entry.ts` and `computeFace` in
  `src/compiler/ts/host-face.ts`. It also names `src/compiler/ts/host-entry.test.ts`, which gains
  the tests of step 2.
- **Rule 11.8 (step 1).** The sentence on `resident(value)` gains a `Uint8Array`. It states that
  the handle copies it with `Uint8Array.prototype.slice.call`, which keeps its class.
- It also states that `read()` gives a new copy by the same rule, and that a handle keeps its
  kind at `write()`.
- It also states that a handle of bytes takes the layout of the first binding it is bound to,
  as change 0025 says.
- In step 1 it also states that the call layer refuses a handle of bytes. Step 2 removes that
  clause. Under open decision 5's alternative, the clause stays.
- **Rule 11.11 (step 1).** Its sentence on binding by name uploads a storage binding's bytes as
  they are, after the length check. It refuses them for a uniform. "Enforced by" gains the tests
  below.
- **Surface §64.** It changes if change 0030 is implemented before step 1. Then step 1 adds
  the bytes to the binding types that 0030's text gives for the typed default export.
- If step 1 is implemented before change 0030, §64 changes here only if open decision 7 makes
  step 1 the carrier. Otherwise this proposal leaves §64 as it is, and `scripts/changes.ts`
  lists §64 as pending. The configuration record then says why.
- **Surface §65 (step 2).** The parameter table gains a row for the bytes. "Resident arrays"
  names `resident(bytes)`, which a kernel function then takes.
- Step 1 leaves §65 as it is. §65 documents the call layer's kernel functions, which refuse bytes
  until step 2.
- **Surface §67 (step 2).** The bindings table gains a row for the bytes, with the length rule,
  a refusal and the write back in place.
- **Surface §69 (step 1).** "Bindings go by name" gains the bytes and `resident(bytes)`, with the
  engine example above. In step 1 it also says that the call layer refuses a handle of bytes and
  does not read a `Uint8Array` as bytes. Step 2 removes that sentence.
- **Exports.** None is added, removed or reshaped. The copy rule keeps the signature of
  `resident` sound for bytes ("`resident()` and `Resident`"). The JSDoc of `resident`,
  `Resident` and `Bindings` gains the bytes.
- `bun run bake:api-surface` writes no new line, and `src/api-surface.test.ts` holds that.
- **Code.**
  - `src/core/host-entry.ts`: the bytes at the top of a binding in `byteSize`, `pack`, `readInto`,
    `toCpu`, `fromCpu`, `packed`, `checkBindings` and `onGpu`. A decoder and an encoder of the
    CPU tier's values. `describe` names an `ArrayBuffer`. `describe`, `runtimeCount` and `unbox`
    choose their article.
  - `src/core/host-entry.ts`: the minimum binding size of a struct whose last field has no size,
    with the struct's alignment as open decision 8 settles it.
  - `src/core/resident.ts`: `notHostValue`, `copyOf` (a copy with
    `Uint8Array.prototype.slice.call` for bytes) and `sync`. The kind check of `write()`, the
    upload of the copy's bytes in `bufferFor`, the refusal texts and the JSDoc.
  - `src/runtime/program.ts`: `#resource`, `#packed` and the JSDoc of `Bindings`.
  - `src/core/host-kernel.ts`: `checkArray`. `src/core/host-kernel-gl.ts`: `lanesOf` and the
    written array in `onWebgl2`, each with the copy rule for an offset that is not a multiple
    of 4.
  - `src/compiler/ts/host-face.ts`: `bindingTsType` and the two `Resident` spellings, in step 2.
    If change 0030 is implemented before step 1, step 1 also edits each storage binding's type
    in the program declaration.
  - The draft expects no edit of `src/core/host-compute.ts` or `src/core/host-draw.ts`, which
    reach the bytes through the helpers above.
- **Tests owed, step 1.**
  - `src/runtime/runtime.test.ts`, on the recording fake device. A storage binding given bytes
    uploads them byte for byte and binds their size (#367). A frame that repeats its shapes
    makes no buffer.
  - The same file: a binding given a host value and given the bytes `pack` writes for it
    uploads equal bytes. This runs for `array<f32>`, `array<vec3<f32>>` and an array of structs
    with `vec3` and `u32` fields. It also runs for a sized struct, a struct with a last array,
    and an emulated `array<f64>`.
  - The same file: a `Resident` of bytes is uploaded once and bound by two programs of one
    layout. A `write()` of another length makes a new buffer. `read()` gives a new `Uint8Array`
    of what a dispatch wrote.
  - The same file: a `Buffer` given to `resident()` and to `write()` is copied. A later write to
    the `Buffer` changes nothing the handle holds.
  - The same file: `read()` of a handle of a `Buffer` gives a `Buffer` that shares no memory with
    the handle. A subclass of `Uint8Array` with a method of its own comes back as that class.
  - The same file: `write()` refuses the other kind of value, in each direction, with the
    sentences above. A uniform binding refuses a handle of bytes with the sentence of bytes.
  - The same file: the test 'holds any host value, and refuses what no binding holds' (lines
    1199 to 1209) expects `resident(new Uint8Array(4))` to throw today.
  - It changes to expect a handle there, and keeps the refusal with `new Int16Array(4)` and its
    fixed article. Its assertion for `resident(undefined)` (lines 1202 to 1204) changes to
    `not an undefined.`
  - The same file: a binding of `array<i32>` given a `Float32Array` gets
    `got a Float32Array, not an Int32Array`.
  - If change 0030 is implemented before step 1: `src/compiler/ts/host-face.test.ts` checks that
    each storage binding of the typed default export takes `Uint8Array` and `Resident<Uint8Array>`.
    A uniform binding takes neither.
  - In that case 0030's type test also compiles the engine example of "Before and after". It
    also expects a type error for bytes given to a uniform binding.
  - The same file: each refusal's text in the two tables above. A struct whose last field has no
    size, given whole elements below the minimum, gets the sentence of that row.
  - Under the recommendation of open decision 8, a test holds the runtime's struct alignment to
    `typeLayout`, for every struct that the examples bind as storage.
  - The compile gate's program tier (`scripts/entry-calls-page.ts`) dispatches each compute
    entry of the examples once more with every storage binding given as its bytes. It holds
    each written binding to the host value's run, byte for byte.
  - Before that, the gate shows it can fail (AGENTS.md#gate-discipline): bytes one stride short
    are refused with the sentence above.
  - The same program tier binds the measured structs of "A struct whose last field has no size"
    on WebGPU, under the layouts the runtime builds. Each takes its smallest length, and a
    length one stride shorter is refused by the runtime before WebGPU sees it.
  - A journey on the packed tarball (`bun run gate:journeys`): a kernel over an array of
    structs with `u32` fields, given its bytes on WebGPU in Chromium. The journey holds the
    result to its JavaScript reference and gives the CPU oracle the same nodes as objects.
- **Tests owed, step 2.**
  - `src/compiler/ts/host-entry.test.ts`, on the CPU tier: an entry called with bytes for each
    storage binding equals the call with the host value. Each written binding comes back in
    the caller's bytes. A written scalar binding takes four bytes. Each refusal's text.
  - `src/compiler/ts/host-kernel.test.ts`: a kernel function given bytes for an array of
    structs and for `array<vec3<f32>>` equals the call with objects and the typed array. The
    range check counts elements from the bytes.
  - `src/compiler/ts/host-draw.test.ts`: a draw on the CPU tier that reads an array of structs
    as bytes equals the frame from objects.
  - `src/compiler/ts/host-face.test.ts`: the view text of each kind of binding, as above. Under
    each TypeScript CI runs, bytes and a `Resident` of bytes type-check. A `Float32Array` for an
    array of structs and bytes for a uniform vector are type errors.
  - The compile gate's entry-call leg calls each compute entry with bytes, on WebGPU and on the
    CPU tier. It compares each call with the call with the host value.
  - The import journey (`journeys/_host-import/src/gpu.ts`): a map with WebGL2 required, given
    bytes at an odd byte offset, in Chromium. The array it reads and the array it writes each sit
    at an odd offset.
  - `src/compiler/ts/host-kernel.test.ts`: a `Buffer` at a nonzero byte offset of its
    `ArrayBuffer` (`Buffer.from(arrayBuffer, 4, n)`) is taken as bytes and written back in place.
  - A test that writes back an `f32` word compares a NaN as a NaN, not by its bits (ECMA-262,
    NumericToRawBytes).
- **The two halves.** The shader half, the compiler and the language service over a shader
  file, does not change. The host half is the view under `tsc`, which
  `src/compiler/ts/host-face.test.ts` checks. The editor's own fixture checks it again
  downstream.
- **`CHANGELOG.md`**: an entry under `[Unreleased]`, with the migration line of the
  break (Rule 13.9).
- No rule added, no diagnostic code, no example.

### Draft impact estimate

| Area                          | Expected work                                                                                                                                                                                                                                                                                                     | Basis and uncertainty                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Program runtime, `resident()` | The bytes in `#resource`, `#packed`, `notHostValue`, `copyOf` and `sync`, with the refusals and the minimum binding size.                                                                                                                                                                                         | Known files. A search of the baseline finds no other path from a plain value to a buffer. Size not estimated.            |
| Call layer and tiers          | The helpers of `src/core/host-entry.ts`, the decoder and encoder, `checkArray`, `lanesOf` and `onWebgl2`.                                                                                                                                                                                                         | Every tier reads a host value through these functions today. Size not estimated.                                         |
| Host view                     | `bindingTsType` and two `Resident` spellings. If change 0030 is implemented before step 1, each storage binding of the typed default export.                                                                                                                                                                      | Known: lines 434 to 450, 769 and 770, and 1259 and 1260 of `src/compiler/ts/host-face.ts`.                               |
| Tests and gates               | The unit tests, the gate legs and the journey above.                                                                                                                                                                                                                                                              | The instruments exist. Each gains a leg for bytes.                                                                       |
| Documents                     | Rules 8.21, 11.8 and 11.11, surface §65, §67 and §69, the changelog. Surface §64 if change 0030 is implemented before step 1.                                                                                                                                                                                     | `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` hold the set.                                          |
| Bundle                        | The runtime's module closure gains the byte path.                                                                                                                                                                                                                                                                 | `scripts/bundle-boundary.ts` measures it against `scripts/bundle-budget.json` (Rule 11.11). The growth is not estimated. |
| Compatibility                 | Additive for typed host code on the call layer, but for a struct whose fields a `Uint8Array` has. At the baseline the break reaches every program runtime host with no type error. After change 0030, a host of a typed default export meets it as a typed host of the call layer does. One case of it is silent. | Known from the code (`listOf`, `pack` case `'o'`, `Bindings`), the `pack` probe and the `tsc` probe on three versions.   |
| Dependencies                  | None.                                                                                                                                                                                                                                                                                                             | Known.                                                                                                                   |
| Duration and cost             | Unknown. Not estimated.                                                                                                                                                                                                                                                                                           | No basis established.                                                                                                    |

### Approval and plan record

This record does not yet apply. Acceptance requires these records: the owner's answers to the
nine unresolved decisions, written in this file, and the actual decision with its pull request
reference. It also requires the approved revision of this file, the final rules and surface
sections, and whether the two steps stand. This draft assigns no responsibility, milestone,
duration or cost.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementing commits with
`Change: 0049` and the tests above green on the delivered revision. It requires the compile
gate and the user journeys run on WebGPU in Chromium, with the result of each recorded.
It requires the minimum binding size measured again in the compile gate, under the runtime's own
layouts. It requires the measured text in the code comment (Rule 13.3). It requires the state of
open decision 9's fix, by its pull request. It requires the order of step 1 and change 0030's
implementation. It also requires the pull request that put the bytes in the typed default export.

Document validation requires `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C`
clean after the rule edits. It requires `src/api-surface.test.ts` green with no new line, and
the bundle sizes against `scripts/bundle-budget.json`. The site's and the editor's pin pull
requests, with `0049` in their `compiler-changes.md`, are recorded separately.

## What it owes downstream

**typeshade.github.io** (facts at `79484e3`).

- The API reference reads the JSDoc of `src/core/resident.ts` and `src/runtime/program.ts`
  (`CATEGORY_BY_FILE` in its `src/lib/api.ts`). So its entries for `resident`, `Resident` and
  `Bindings` change at the pin. The pin pull request reads them.
- The rule pages of Rules 8.21, 11.8 and 11.11 render each rule from the pinned compiler's
  `reqs/rules` (`RULES_DIR` in its `src/lib/design-rules.ts`, line 36). So they show the new
  text with no hand edit.
- Three pages explain Rule 8.21 or 11.11 without naming it (`EXPLAINERS` in the same module).
  `/guide/language/types/` and `/guide/language/from-typescript/classes/` explain Rule 8.21
  (lines 644 to 652). `/guide/concepts/webgpu-and-webgl2/` explains Rule 11.11 (line 696).
- `READ_AGAINST` records the fingerprint those pages were last read against: Rule 8.21 at line
  753 and Rule 11.11 at line 761. `content/guide/ko/rules.json` records the same two for the ko
  pages (lines 40 and 42).
- The edits of Rules 8.21 and 11.11 change their fingerprints at the pin. `assertRuleReadings`
  (line 846) then stops the site's build, and `bun run check:guide` names the ko pages.
- So the pin pull request reads each of the three pages again against the new rules, en and ko.
  Then both records take the new fingerprints.
- No page copy names a binding's host values. A search of `src/i18n/en.ts` for "array of
  objects", "typed array", `Int32Array` and `Uint32Array` found none.
- An opportunity, not an obligation: the Playground's runner may pass its storage bytes as they
  are, in place of the `GPUBuffer` it makes for each.
- `compiler-changes.md` records `0049` when the pin moves.

**vscode-typeshade** (facts at `53afb2b`).

- The skill's host reference, `plugins/typeshade/skills/typeshade/references/host.md`, gains
  the bytes in four places. The first is its host values bullet: "a typed array for a
  runtime-sized storage array, or an array of objects for one of structs".
- The second is its kernel function bullet: "Each array is a `Float32Array`, `Int32Array` or
  `Uint32Array`". The other two are its `Resident` bullet and its bullet "Bindings go by name".
- `HOST_IMPORT_PROJECT` in `packages/tsserver-plugin/src/fixtures.ts` holds view text as
  `tshc sync` writes it at the pin. Its views are written again from the new pin.
- `packages/tsserver-plugin/src/tsserver.test.ts` may gain a host call with a `Uint8Array`. If
  it does, the paragraph of `docs/design.md` that lists what that fixture holds gains it too.
- `compiler-changes.md` records `0049` when the pin moves.

**typeshade/radiance**, the engine that asks for this proposal, is not in `DOWNSTREAM_REPOS`
(`scripts/changes.ts`, line 61). So the front matter does not list it, and
`scripts/downstream-impact.ts` does not hold it here. Its record 0001 decides, as its own
amendment, whether its buffers become structs once its pin carries this change.
