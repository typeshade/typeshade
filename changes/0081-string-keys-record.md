---
id: '0081'
title: A string literal union is a value the GPU holds as a small integer, Record over such keys is an indexed table, and a kernel function's Map and Set take such keys
status: accepted
rules:
  - '4.1'
  - '7.8'
  - '8.21'
  - '8.22'
  - '8.23'
surface:
  - 28
  - 64
  - 74
  - 75
exports: []
exports-removed: []
codes: []
examples:
  - string-keys-record
downstream:
  - repo: typeshade.github.io
    what: A page, en and ko, for string literal keys and Record, the §28 page's string row, and the Map and Set page's key types. compiler-changes.md records 0081 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references gain string literal keys, Record and the host contract of each. compiler-changes.md records 0081 when the pin moves.
  - repo: typecv
    what: Nothing is owed at the pin. A table keyed by a closed set of names (a channel, a class label) can move to a Record when the pin moves, held to its current output. compiler-changes.md records 0081 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0081. This file is the proposal source. It has status `accepted`.                                                                                                                                                                                                                                                                            |
| Revision context            | Drafted 2026-10-21, UTC. The date is the authoring context. It is not an approval date.                                                                                                                                                                                                                                                               |
| Request source              | The repository owner, Seungup, asked in a Claude Code session of 2026-10-21 whether `Record<K, V>`, a class key and a `string` key are possible, and proposed that a string known at compile time be hashed at compile time, as C++'s `constexpr` does, and that the table be an indexed table rather than a struct. The owner approved the drafting. |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                   |
| Current lifecycle state     | `accepted`. The owner's decision is recorded under Approval and plan record. Parts 1 and 2 were delivered by PR #732 at `82d7ba52`; part 3 is in progress.                                                                                                                                                                                            |
| Applicability / effectivity | The front end and the language service (a string literal union type, `Record`, their operators), the IR's lowering of both to existing types, the host face and the call layer (the conversion at the boundary), and change 0080's Map and Set. No release version is assigned.                                                                       |
| Review baseline             | `origin/main` at `91df8e2d` (commit "Merge pull request #727 …"), read on 2026-10-21. Change 0080 is `accepted` there, with part 1 and the host example merged.                                                                                                                                                                                       |
| Proposal review             | PR #729.                                                                                                                                                                                                                                                                                                                                              |
| Revision authority          | Git records the revisions of this file. The review and merge of the proposal-only pull request record the decision.                                                                                                                                                                                                                                   |

## What changes

Today a string has no GPU representation (surface §28, Rule 7.8), `Record` is an unknown type, and
a Map's or a Set's key is a `u32`, an `i32` or an `f32` (change 0080, decision 2). A closed set of
names is common in TypeScript code: a channel, a material, a class label, a mode. An author writes
it as a string literal union and indexes a table with it. This proposal lets a `"use typeshade"`
file do the same, with no string at run time.

```ts
"use typeshade";

type Channel = "r" | "g" | "b";

const GAIN: Record<Channel, f32> = { r: 1.2, g: 1.0, b: 0.8 };

export function boost(px: array<vec3f>, c: Channel, by: Record<Channel, f32>) {
  for (let i: u32 = 0; i < px.length; i++) {
    const k = c === "r" ? 0 : c === "g" ? 1 : 2;
    px[i][k] = px[i][k] * GAIN[c] * by[c];
  }
}
```

```ts
await boost(pixels, "g", { r: 1, g: 2, b: 1 });
```

### 1. A string literal union is a closed set of ids

- A type that is a union of string literal types, or one string literal type, is a key type. The
  compiler gives each member an id, a `u32` from 0, in the order of decision 1. The id is a
  compile-time constant: `"g"` above is `1u` in the emitted code.
- A value of a key type is a `u32` on every target. The operators are `===`, `!==` and `switch`
  over its members. Every other operator on it is refused, as it is on an enum member today.
- A string literal is accepted where a key type is expected. Anywhere else a string stays refused
  (Rule 7.8). `string` itself stays refused: its set of values is open.
- Two unions with the same members are the same type, and their ids agree, because the ids follow
  the members and not the place the union is written (decision 1).

### 2. `Record<K, V>` with a key type is an indexed table

- `Record<K, V>` with `K` a key type, an enum or a union of integer literals is a value type: an
  `array<V, N>` in the IR, `N` the number of keys, indexed by the key's id. It is no struct: WGSL
  cannot pick a struct field by a value, and every field of a `Record` has the one type `V`.
- `r[k]` with `k` of the key type is an index; `r.g` and `r["g"]` are the constant index `1`.
- An object literal with every key is a `Record` value, as TypeScript requires; the fields may be
  written in any order.
- `V` is a type an array may hold. A `Record` is a local, a parameter, a field, a module constant,
  a uniform and a storage value, as an array of its `N` is.

### 3. The host

- A key-type parameter or result is the string itself on the host. The call converts it to its id,
  and refuses a string outside the union with a `TypeError` that names the parameter.
- A `Record` is a plain object on the host, `{ r: 1, g: 2, b: 1 }`. The call refuses a missing key
  or an extra one.

### 4. A kernel function's Map and Set (change 0080)

- `Map<K, V>` and `Set<K>` also take a key type `K`. The GPU sees the id, and the call converts the
  host's string keys to ids before the loop and back after it, so the host reads `Map<string, V>`
  in insertion order as change 0080 gives it.
- A host `Map` or `Set` that holds a string outside the union is refused with a `TypeError`.
- `Map<string, V>` and `Set<string>`, whose key set is open, stay refused (decision 3).

### Not in this change

- `string` as a type, string operations (`+`, `length`, `slice`, template literals) and a string
  read from a buffer.
- A number-keyed `Record<number, V>` or `Record<u32, V>`: its key set is open, and an array or a
  `Map` is the type for it.
- A struct key and a vector key, for the reason change 0080 gives.

## Why

**The concept is the one TypeScript developers use.** A closed set of names is written as a string
literal union in TypeScript, and a table over it as a `Record`. Today a TypeShade author renames it
to an enum or to integers, and the host converts by hand at every call.

**No string reaches the GPU.** Every key is known at compile time. The compiler assigns the ids
once, as C++ evaluates a `constexpr`, and the GPU holds a `u32`. A key costs one register, and a
lookup is one index with no hash and no probe.

**An indexed table is better than a struct.** A struct field is a fixed offset, which a value
cannot choose in WGSL. An `array<V, N>` indexed by the id is the same memory, and takes a key that
the program computes.

### Alternatives

- **A struct per `Record`.** Constant keys only, and WGSL cannot select a field by a value. Refused
  as the lowering.
- **A run-time string hash.** The GPU has no string to hash, and a hash adds collisions to a set
  that is closed. Refused.
- **Open string keys in a Map, interned by the host per call.** The kernel can name only the
  literals it was compiled with, so a key outside them can be neither added nor read on the GPU.
  Decision 3.

### Assumptions

- The TypeScript checker gives the members of a string literal union in an order that does not
  follow the source, so the ids cannot follow the order of the checker's union.
- An enum already lowers to integers on every tier (surface §14), and `switch` over integers is
  WGSL's.

### Decisions at acceptance

The owner accepted decisions 1 to 4 as drafted (Approval and plan record).

1. **The order of the ids.** The members sorted by their UTF-16 code units (the draft), which makes
   the ids independent of the place and the order a union is written; or the order of the first
   `type` alias that declares the union, which matches what the author wrote and differs between
   two spellings of one union.
2. **The key types of `Record`.** String literal unions, enums and unions of integer literals (the
   draft), or string literal unions only.
3. **Open string keys in a Map or a Set.** Refused (the draft), or accepted with ids the host makes
   per call, where a kernel can add and read only the keys it names.
4. **A `Record` in storage.** Accepted as an `array<V, N>` with the layout an array has (the draft),
   or refused until change 0082 decides the layout of a value in storage.

## What it touches

- **Rule 4.1.** A key type and `Record<K, V>` join the types an author writes, under their
  TypeScript spellings.
- **Rule 7.8.** The string refusal gains its exception: a string literal where a key type is
  expected.
- **Rule 8.21.** A key-type value is a string on the host, and a `Record` a plain object.
- **Rules 8.22 and 8.23.** A Map's or a Set's key may be a key type; the call converts it.
- **Surface §28.** The string row says where a string literal is accepted.
- **Surface §64.** The host values of a key type and of a `Record`.
- **Surface §74.** The key types of a Map and a Set.
- **Surface §75 (new).** "String keys and Record": the ids, the operators, the table, the host.
- **Example `string-keys-record`.** A `Record` indexed by a key-type parameter, emitted on every
  target and called from the host.

### Draft impact estimate

Known work, by area:

- **Front end and language service.** The key type and its ids; `===`, `!==` and `switch`; the
  literal where a key type is expected; `Record` as `array<V, N>`, its literal and its index; each
  refusal in both halves (Rule 12.7).
- **IR.** None new: a key is a `u32`, a `Record` an `array<V, N>`.
- **Host face and call layer.** The string-to-id and object-to-array conversions, and their
  refusals.
- **Change 0080.** The Map and Set key conversion at the call.
- **Gates.** The compile gate over the example, the differential gate over generated programs that
  index a `Record`, and the import journey calling it on WebGPU.

Compatibility: no program that compiles today changes its meaning. A string literal union and a
`Record` are refused today everywhere.

Dependencies: change 0080 for section 4. Sections 1 to 3 depend on nothing.

Duration and cost: unknown. No estimate is established.

### Approval and plan record

The owner, Seungup, approved the proposal in the project conversation on 2026-10-21 (Asia/Seoul),
with the recommended decisions. Decision 1: the ids follow the members sorted by their UTF-16 code
units. Decision 2: a `Record` takes a string literal union, an enum or a union of integer literals
as its key type. Decision 3: open string keys in a Map or a Set stay refused. Decision 4: a
`Record` in storage is an `array<V, N>` with the layout an array has. The merge of PR #729 with
`status: accepted` records the decision. Responsibilities: an agent of this repository implements
the proposal in commits that say `Change: 0081`. The site and the editor do their work when their
pins move. No milestone date is assigned.

### Configuration and validation record

Parts 1 and 2 were merged in PR #732 (`82d7ba52`). They deliver string literal key types,
`Record` over those keys, and parameter/result host conversion. The baseline for part 3 is
`main` at `82d7ba52`, read on 2026-10-22 (UTC) by the Codex agent.

Part 3 is in progress on `agent/0081-part3`. Its numeric `Record` decision accepts only the
member values 0 through N-1, indexed by value. A refusal will name the actual values.
It also delivers key-type Map/Set conversion and the registered `string-keys-record` example.
No part 3 validation result is recorded yet.

Deviation D1 remains open at the owner's instruction: in an entry binding and a kernel
function's array with no size, a key is its numeric id and a `Record` is its array in id order.
This boundary uses the existing layout path. Parameter/result conversion does not change it.

The completed delivery must retain evidence for:

- each spelling and refusal in both halves on one source (Rule 12.7);
- the ids equal in two spellings of one union, and a `switch` over a key type on every target;
- a `Record` indexed by a computed key, held to the CPU tier bit for bit on WebGPU and WebGL2;
- the host conversions and their refusals;
- a kernel function's `Map<Channel, V>` read back with string keys in insertion order.

## What it owes downstream

- **typeshade.github.io.** A page, in English and Korean, for string literal keys and `Record`;
  the §28 page's string row; the Map and Set page's key types. `compiler-changes.md` records 0081
  when the pin moves.
- **vscode-typeshade.** The skill's references gain the key type, `Record` and their host values.
  `compiler-changes.md` records 0081 when the pin moves.
- **typecv.** Nothing is owed at the pin. `compiler-changes.md` records 0081 when the pin moves.
