---
id: '0081'
title: A string literal union is a value the GPU holds as a small integer, Record over such keys is an indexed table, and a kernel function's Map and Set take such keys
status: implemented
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

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0081. This file is the proposal source. It has status `implemented`.                                                                                                                                                                                                                                                                         |
| Revision context            | Drafted 2026-10-21, UTC. The date is the authoring context. It is not an approval date.                                                                                                                                                                                                                                                               |
| Request source              | The repository owner, Seungup, asked in a Claude Code session of 2026-10-21 whether `Record<K, V>`, a class key and a `string` key are possible, and proposed that a string known at compile time be hashed at compile time, as C++'s `constexpr` does, and that the table be an indexed table rather than a struct. The owner approved the drafting. |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                   |
| Current lifecycle state     | `implemented`. PR #732 delivered parts 1 and 2; PR #733 delivers part 3. Deviation D1 remains open. Downstream delivery is pending.                                                                                                                                                                                                                   |
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

**Delivered configuration.** The accepted proposal revision is `22b93616`, merged through
PR #729. PR #732 delivered parts 1 and 2, merged at `82d7ba52`. PR #733 delivers part 3 from
that `main` baseline on `agent/0081-part3`. The Codex agent implemented and checked part 3 at
the owner's request on 2026-10-22 (UTC). Commit `f3062401` records its baseline and decision.
Git and PR #733 retain the subsequent implementation commits and their exact identities.
No release version is assigned.

The compiler now delivers all four sections of this proposal:

- String key types and their operators lower to existing `u32` values. The member order is
  UTF-16 code-unit order. Two spellings of one union have identical ids.
- `Record` lowers to an array. A numeric domain is accepted only when its distinct values are
  exactly 0 through N-1, indexed by value, independent of declaration order. Sparse, negative,
  fractional and empty numeric domains are refused with their actual values. Enum constant
  expressions and aliases are resolved by a TypeScript domain query on a separate syntax tree.
  The query does not bind the language service's tree. The IR and `typeKey` are unchanged.
- Host parameters and results convert keys and Record objects. A kernel's GPU uniforms use the
  checked, converted parameter values. The previous upload used the original strings; CPU-only
  host tests did not reach it. The new host example verifies that GPU boundary.
- A kernel's key-type Map and Set convert host strings to ids before execution, then convert
  ids back to strings in insertion order. Lookup tables and added records use that boundary
  too. Key-type Map values also round-trip as strings. An unknown host key is a `TypeError`.
  Open string keys remain refused. A string literal is stable for the guard of `Map.get`.

The registered host-example id is `string-keys-record`. Its shader and host are in
`examples/hosts/string-keys-record/`. The host registry, driver and independent reference
include it. Its WGSL and both GLSL goldens are baked. `host-set-unique` additionally exercises
string-keyed collections, initial entries, updates, insertion order and reads after writes.
The existing collection limits of change 0080 remain: WebGL2 refuses collection kernels;
loops that append to two collections, or add after a lookup, run on the CPU.

**Decision 2 disposition.** Numeric Record indices are member values, not reassigned ids.
Only the dense domain 0 through N-1 is accepted. This decision is also recorded on PR #733.

**Deviation D1 — open.** The owner instructed that this deviation remain open. In an entry
binding and a kernel function's array with no size, a key is its numeric id and a Record is
its array in id order. These boundaries retain the existing layout path. No owner closure is
recorded.

**Functional validation.** The Codex agent ran the following checks on the part 3 working tree
on 2026-10-22 (UTC). The tool configuration was Bun 1.4.3, Node 24.19.0, TypeScript 5.6.3,
Doorstop 3.2 and Chromium 154.0.8037.57 on Linux. GPU gates used
`TYPESHADE_CHROMIUM=/usr/bin/chromium`, WebGPU and WebGL2 through SwiftShader.

| Command                                                                                             | Observed result and retained evidence                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run build`                                                                                     | Passed, including the host and test TypeScript checks.                                                                                                                                                                                                                 |
| `bun run lint`                                                                                      | Passed.                                                                                                                                                                                                                                                                |
| `bun run format:check`                                                                              | Passed, including shader semicolons.                                                                                                                                                                                                                                   |
| `bun run test -- src/compiler/ts/key-types.test.ts src/compiler/ts/host-kernel-collections.test.ts` | 53 tests passed. Acceptance and refusal read both compiler and editor on one source; numeric Record and collection hover types, CPU host conversion and invalid host keys are checked.                                                                                 |
| `bun run test -- src/compiler/ts/key-types.test.ts examples/host-examples.test.ts`                  | 48 tests passed. Each host example matches its independent CPU reference, and its host view type-checks.                                                                                                                                                               |
| `bun run bake:goldens`                                                                              | 347 tests passed. The three new string-keys-record goldens are retained in `examples/__emit-goldens__/`.                                                                                                                                                               |
| `bun run gate:compile`                                                                              | Passed: 184 WGSL compilations, 127 GLSL stage pairs and 122 render pipelines; entry calls have zero failures.                                                                                                                                                          |
| `bun run gate:differential`                                                                         | Passed: 56 generated kernels, including eight generated Record programs checked by compiler and editor; 296 WebGPU calls, 2,464,761 values compared bit for bit, seven oracle-rounded values excluded. Chain, GLSL, compute and common-module arms have zero failures. |
| `bun run gate:journeys` after build                                                                 | Passed: 30 journeys, 112 runs, and the import/host-example arms. string-keys-record matches on WebGPU, WebGL2 and CPU; host-set-unique matches string keys and values on WebGPU and CPU.                                                                               |
| `bun run gate:boundary`                                                                             | Passed. Runtime: 44,244/44,600 bytes; emit: 95,192/97,500; fuse: 85,125/86,000; algorithms: 42,156/42,400; random: 27,391/27,600. Values are minified and gzipped bytes/budget. No budget changed.                                                                     |

The test sources, goldens, independent host reference and GPU gate corpus retain the functional
checks. PR #733 retains CI results for its implementation head, including the full unit suite
and TypeScript version checks. This record does not claim a CI result before it is observed.

**Document validation.** On 2026-10-22 (UTC), the Codex agent read every docs-impact review
location. The changes to Rules 4.1, 8.22 and 8.23, surface §74 and §75, the ambient Record
comment and this delivery record follow the implemented behavior. The other listed descriptions
remain applicable. `bun run docs:impact` has no must-fix item; `bun run docs:refs` reports no
dead reference. `bun run reqs:sync` and `python scripts/doorstop-check.py -C` pass after reading
and reviewing each changed rule and clearing each suspect surface item separately.
`bun run changes:check` and `bun scripts/ifchange.ts` pass. Git records the Doorstop stamps.

**Open obligations.** D1 remains open. Site and editor documentation and all downstream compiler
pins remain pending. `implemented` records compiler delivery, not downstream completion.

## What it owes downstream

- **typeshade.github.io.** A page, in English and Korean, for string literal keys and `Record`;
  the §28 page's string row; the Map and Set page's key types. `compiler-changes.md` records 0081
  when the pin moves.
- **vscode-typeshade.** The skill's references gain the key type, `Record` and their host values.
  `compiler-changes.md` records 0081 when the pin moves.
- **typecv.** Nothing is owed at the pin. `compiler-changes.md` records 0081 when the pin moves.
