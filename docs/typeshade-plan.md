# The plan of proposal 0100

This is a living plan. Proposal 0100 (`changes/0100-typescript-meaning.md`) records the principle
and the decisions; this file records the work that reaches it, and ordinary pull requests change
it as the work moves. When a unit lands, its row names its proposal, its pull request and its
commit.

## The stages

| Stage             | Work                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0. Atomic changes | Area Z: the tools that let every later unit land alone, small and fast                                               |
| I. Foundation     | P1 and P2; area S: one `Target`, one runtime, the memory and thread contract, two levels of IR, the software adapter |
| II. Execution     | Area W: the wasm target in workers, with shared memory and threads by default; area R                                |
| III. Language     | The language units, as high-level IR features (S4), in the order of the TypeCV evidence                              |
| IV. Platform      | The planner, derivatives, the verification report, other targets                                                     |

## The units

A unit is the smallest change that an author can use on its own and that a pull request can
deliver and verify alone. Each unit lands in its own pull request. The units of one area share one
proposal with a stage for each unit (proposal 0100, decision D4).

| Unit | Area         | What an author can write when it lands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Needs                      |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Z0a  | Atomic       | Vitest 3.2 to 5, with `fsModuleCache` on. Measured before: a documents-only run spends 194 s of 277 s collecting modules (PR #801, 2026-10-27).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                       |
| Z1   | Atomic       | Impact-based test selection on every pull request: Vitest's module graph (`vitest related`, `--changed`) for code, and `scripts/doc-tests.ts` narrowed to the tests that read the changed paths. Measured before: `scripts/changes.ts` selects 51 tests in 22 s; the documents-only run selects 100 test files in 4 min 37 s.                                                                                                                                                                                                                                                                                                                                                                          | Z0a                        |
| Z3   | Atomic       | Changelog fragments: each change adds one file under a fragments directory with a random name, and a script assembles `CHANGELOG.md` in the house style (Rule 13.8) at release. Measured before: `CHANGELOG.md` was touched by 10 of the last 30 merged pull requests.                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                       |
| Z5   | Atomic       | Barrel files and import boundaries: Biome's `noBarrelFile` rule first, then narrow imports where a small file reaches most of the suite. Measured before: a change to the 20-line `src/core/tiers.ts` selects 2883 tests (3 min 7 s).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Z1                         |
| Z0b  | Atomic       | TypeScript 7 readiness: the type check runs on TypeScript 7's native `tsc`, while the compiler API stays on TypeScript 5 or 6 (`@typescript/typescript6`); the measurement records both times.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Z0a                        |
| Z6   | Atomic       | A decision, measured first: Biome in place of Prettier and ESLint. Measured before: `format:check` 29 s and `lint` 13 s; typescript-eslint does not yet accept TypeScript 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Z5                         |
| T1   | TypeScript 7 | The front end and the language service move to TypeScript 7.1's programmatic API, once 7.1 is stable; the projection that proposal 0100 requires of every extension is measured on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Z0b, TypeScript 7.1 stable |
| P1   | Process      | Rule 13.10: before `1.0.0` a change may break any program in the next release, with no window, deprecation step or kept spelling; a `### Changed` entry and reviewed goldens remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                       |
| P2   | Process      | Before `1.0.0`, an area's Doorstop items and its site and editor pages are brought up to date once, when the area's last unit lands, not with each unit. A change to `CLAUDE.md`, `changes/README.md` and the docs-impact gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P1                         |
| S1   | Structure    | One `Target` for each place a program runs (hardware WebGPU, the software adapter, WebGL2, wasm, JavaScript). Its compile half is today's `Backend` (`src/core/backend.ts`: emit and `capProfile`), widened to the JavaScript and wasm artifacts; its run half is an availability probe, memory and an executor for a kernel function, an entry and a draw. One registry replaces the tier written in four places (`src/core/tiers.ts`, `src/runtime/runtime.ts`, `src/core/fuse-report.ts`, `src/core/console-print.ts`); the manifest carries each target's artifact (Rules 11.10, 11.11); the differential gate runs on every registered target. Landed tier by tier. A proposal, for the manifest. | none                       |
| S2   | Structure    | One runtime: the call layer becomes a thin layer over the program runtime, with one path that requests a device and one resource layer. Today two paths request a device (`src/core/host-entry.ts`, `src/runtime/runtime.ts`) and 34 sites in eight files create buffers.                                                                                                                                                                                                                                                                                                                                                                                                                              | S1                         |
| S3   | Structure    | The memory and thread contract: one design for the arena (A1), the device's linear memory (R2), and the shared memory and workers (W2), as the `Target`'s memory. A proposal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | S2                         |
| S4   | Structure    | Two levels of IR: a high-level IR that carries TypeShade's meaning (arrays, references, `Map`, exceptions, function values), a pass that chooses each representation (proposal 0100, section 2: the representation is the compiler's), and today's `ModuleDecl` as the low level every target takes. The language units B to L become a high-level feature and its lowering, and no target changes for them. The tree has the pattern in part already: lowering passes such as `fp64Lower`, and the ids of `PRE_EMIT_INTRINSICS` that no backend sees.                                                                                                                                                 | none                       |
| S5   | Structure    | The software adapter, used wherever the host offers one: when no hardware adapter answers, the webgpu target asks for `requestAdapter({ forceFallbackAdapter: true })` (SwiftShader in Chromium where enabled, Dawn's Node binding in Node) and reports `isFallbackAdapter`. Today `requestAdapter()` takes no options. The default order becomes hardware WebGPU, hardware WebGL2, the software adapter, wasm, JavaScript; `configure({ prefer })` reorders it, and the perf gate measures the software adapter's place.                                                                                                                                                                              | S1                         |
| A1   | Memory       | One buffer the compiler owns (the arena): it appears in `reflect()` and the manifest, and the call sizes and binds it. The records of a loop that pushes (change 0078) move into it as its first user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                       |
| A2   | Memory       | A region of the arena reserved per call from a size the call knows (a host value's length, a constant).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A1                         |
| A3   | Memory       | Running out of the arena: a flag the call reads, then the CPU tier for a host call, or a refusal that names the bound.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A2                         |
| A4   | Memory       | A reference as a value: an offset into the arena that a variable, a field or an element holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A2                         |
| C1   | `boolean`    | `boolean` is accepted wherever `bool` is, as the same type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none                       |
| C2   | `boolean`    | `bool` is removed; its diagnostic names `boolean`; examples and documents use `boolean`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | C1, P1                     |
| B1   | Arrays       | `T[]` and `Array<T>` wherever `array<T>` with no size is accepted (a kernel function's parameter, a storage binding).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none                       |
| B2   | Arrays       | `Float32Array`, `Int32Array`, `Uint32Array` and `Float64Array` in the same positions (revision 1 of this file).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                       |
| B3   | Arrays       | `Array<T, N>` as the sized array; the editor projects it to `T[] & { readonly length: N }` (TS2317 on the global `Array`); the editor's projection gains replacement as well as insertion, which this spelling needs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none                       |
| B4   | Arrays       | A local's size from its value: `new Array(N)`, `new Float32Array(N)`, `Array.from({ length: N }, f)` with a constant `N`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | B1                         |
| B5   | Arrays       | A class field's size from its initializer, a binding's struct included: `weights = new Float32Array(16)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | B4                         |
| B6   | Arrays       | A helper's `T[]` parameter, compiled once for each length its callers pass (Rule 8.9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | B1                         |
| B7   | Arrays       | `array<T, N>` is removed; its diagnostic names `Array<T, N>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | B3, P1                     |
| B8   | Arrays       | `new Float32Array(n)` and `new Array(n)` with `n` known when the call runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | B4, A2                     |
| B9   | Arrays       | `push` outside a kernel function's loop, on an array in the arena.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A3                         |
| D1   | References   | `const b = a` of a local array or struct is the same object: a write through `b` is seen through `a` (`TS8005` withdrawn for locals).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none                       |
| D2   | References   | A struct or array parameter a helper writes is the caller's, as in TypeScript.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none                       |
| D3   | References   | A reference held in a field or an element.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A4                         |
| E1   | Types        | `'x' in s`, answered from the type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                       |
| E2   | Types        | A union of two types, `A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          \| B`, as a tagged value, as the optional value is.                  | none                       |
| E3   | Types        | `s instanceof C`, from the static type, or from the tag of E2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | E2                         |
| E4   | Types        | A rest tuple `[T, ...T[]]`, as a `T[]` with at least one element.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | B1                         |
| F1   | Loops        | `while (true)` and `for (;;)` with a `break`, as WGSL's `loop`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                       |
| F2   | Loops        | A `for` that is not counted, as an open loop; the analyses that need a counted loop skip it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | none                       |
| F3   | Loops        | `do…while`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none                       |
| F4   | Loops        | A labelled `break` and `continue`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | none                       |
| G1   | Methods      | `find` and `findLast`, giving `T                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  \| undefined`.                                                       | none                       |
| G2   | Methods      | `sort` of a sized array in one invocation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                       |
| G3   | Methods      | `slice` with a constant length, and `concat` of sized arrays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | B3                         |
| G4   | Methods      | `filter`, its result in the arena.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A2                         |
| G5   | Methods      | `sort` of a kernel function's array, on the device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                       |
| H1   | Map and Set  | A `Map` or `Set` local to a function, in the arena.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A3                         |
| H2   | Map and Set  | A `Map` or `Set` in a binding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | H1                         |
| I1   | Functions    | A function held in a local `const` or `let` and called later, as an id the compiler dispatches on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | none                       |
| I2   | Functions    | A function held in a field or an element.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | I1                         |
| I3   | Functions    | A closure whose captures live in the arena.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | I1, A2                     |
| J1   | Recursion    | Recursion whose depth the compiler bounds from constants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | none                       |
| J2   | Recursion    | Recursion over an explicit stack in the arena.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A3                         |
| K1   | Strings      | A `string` constant and `===` on it, held as an id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                       |
| K2   | Strings      | A string built at run time, UTF-16 code units in the arena, with `length`, `charCodeAt` and `===`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A2                         |
| L1   | Exceptions   | `throw` and `try`/`catch` within one function.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none                       |
| L2   | Exceptions   | A `throw` that crosses calls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | L1                         |
| L3   | Exceptions   | A `throw` that leaves a kernel function or an entry and reaches the host as a rejected promise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | L2                         |
| W1   | WebAssembly  | The wasm tier of proposal 0042 for a kernel function over scalar arrays, run in a worker so the calling thread never blocks; the encoder, the numeric contract, the tier between WebGL2 and the CPU tier, the JavaScript tier as its fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 0042 revised and accepted  |
| W2   | WebAssembly  | Threads by default: where `crossOriginIsolated` is true (and always in Node), one shared `WebAssembly.Memory` and a pool of workers run the iterations of a loop the kernel proof accepts (Rule 8.22), split across the workers; a reduction keeps the fixed tree of Rule 7.2, so the bits do not depend on the thread count. Elsewhere W1's single worker runs it.                                                                                                                                                                                                                                                                                                                                    | W1                         |
| W3   | WebAssembly  | Vectors and matrices on the wasm tier, scalarized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | W1                         |
| W4   | WebAssembly  | A `Resident` array kept in the shared memory between calls, with no copy between the workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | W2                         |
| W5   | WebAssembly  | A `@compute` entry's workgroups spread across the workers, each workgroup on one worker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | W2, W3                     |
| W6   | WebAssembly  | A full-screen `@fragment` draw, its rows spread across the workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | W2, W3                     |
| W7   | WebAssembly  | The Vite plugin: the binary as an asset loaded with `instantiateStreaming`, an inline fallback, and the dev server's cross-origin isolation headers on by default; the setup page names the production headers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W1                         |
| W8   | WebAssembly  | SIMD (`v128`) for vector lanes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | W3                         |
| W9   | WebAssembly  | The arena of unit A1 in the shared memory, so the units that need it run on the wasm tier where no GPU tier represents them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | W2, A1                     |
| R1   | Runtime      | A runtime core module, prebuilt in the package, and its loader; its first function packs an array of structs into `std430` bytes (TypeCV audit P1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                       |
| R2   | Runtime      | One `WebAssembly.Memory` per device owner (Rule 11.8) holds the host copies of `Resident` arrays in the GPU's layout, so an upload is one `writeBuffer` with no conversion. A GPU buffer and linear memory stay separate: data moves between them by WebGPU's copy and mapping path (`docs/computing-platform-plan.md`).                                                                                                                                                                                                                                                                                                                                                                               | R1                         |
| R3   | Runtime      | The pool of released arrays in that memory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | R2                         |
| R4   | Runtime      | The ordered merge of a `Map` or `Set`'s records (change 0080) in the runtime core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | R1                         |
| R5   | Runtime      | The host side of the arena of unit A1 in that memory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | R2, A1                     |
| R6   | Runtime      | The runtime core written in `"use typeshade"`, one source compiled to WGSL for the GPU and to WebAssembly for the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | R1, W1                     |

## Notes

Rule 4.6's refusal of `number` stays. `number` names no width, and the sized scalars are what the
surface borrows from WGSL to say it.

Area S is the structure the rest stands on. Every execution path the host offers is used (the
owner, 2026-10-27: "가능하면 최대한 활용하는게 좋아보여요"): a software adapter such as
SwiftShader is a form of the webgpu target (S5), not a replacement for the wasm tier, since a page
can use it only where the browser offers it. S2, S4 and S5 change no rule, export or surface and need no proposal (`changes/README.md`); S1 and S3 change the public contract and need one each.

Area W carries proposal 0042 (draft, PR #460), split into units and revised: threads, shared
memory and asynchronous calls are the default, not a later stage. Its stage gate stays: W1 runs
at least twice as fast as the CPU tier, bit for bit, or 0042 is withdrawn with the numbers. The
JavaScript CPU tier stays the oracle and the fallback. A form the GPU cannot represent (proposal 0100, section 2: the representation is the compiler's)
runs on the wasm tier before the JavaScript one once W7 lands.

Area R uses WebAssembly for the runtime itself: memory, layout and the host's share of the
algorithms. The program module of area W imports the runtime core's memory, so a device owner has
one linear memory. A call crosses the boundary once for each array, never once for each element,
and compiles a module once, asynchronously, at load (0042, decision D2 of #459). A user never
holds a raw view of linear memory: growing a memory that is not shared detaches its
`ArrayBuffer`, so a user holds a `Resident` handle, and a view is made again after a growth. The
JavaScript implementations stay as the oracle and as the fallback where a page's content security
policy refuses WebAssembly.

The design basis of A1 is the layout C compilers give WebAssembly (Emscripten, clang's `wasm32`),
read from general knowledge and not verified in this proposal: static data, then a shadow stack
for what needs an address, then a heap that grows with `memory.grow`, views refreshed after each
growth, function pointers through a table and `call_indirect`, and exceptions as native
WebAssembly exception handling. TypeShade differs in three ways: the arena's layout is the GPU's
`std430` (Rule 6.8), so it moves without conversion; optimization runs on the IR before encoding,
since 0042 adds no dependency; and one program runs alike on four tiers, so the memory model of
A1 to A4 must be one that WebGPU and WebAssembly both take.

The units with no dependency can start at once and in any order. P1 comes before any unit that
removes a spelling (B7, C2). Area S comes first: the structure the other units stand on. Then area W (decision D5), then R. Among the rest, the
TypeCV audit's ranking of its forced forms (sort, `Map`, bounded lists, records at a stride) is the
evidence for G2, H1 and B9 first. Each proposal takes the next free number when it is drafted
(Rule 3.7).

Area Z comes before area S, in the order Z0a, Z1, Z3, Z5, Z0b, Z6 (the owner, 2026-10-27:
"항상 최소 단위로 가능하도록 하는게 가장 먼저", approved with the tool choices of that day).
Area Z adds development dependencies only; the package keeps no runtime dependency. T1 waits for
TypeScript 7.1's stable programmatic API, which TypeScript 7.0 does not have.

## Z1 implementation record

Status: in progress, approved by the owner on 2026-10-28. The implementation starts from
`f65bbad3`, the shared commit checks of PR #818, on branch `codex/affected-tests`, PR #819.

The first unit selects code tests with Vitest's static dependency analysis. It also keeps
tests whose file, child-process or external-package inputs the module graph cannot describe.
Runtime dependency records do not select tests: a conditional import can be absent from the
last recorded run.

Configuration, toolchain, lockfile, shader, deleted, renamed and unknown inputs retain the full
applicable suite. Documents-only pull requests keep their existing selection. Non-pull-request
runs remain full, and the GPU gates keep their existing scope. No runtime dependency is added.
Narrowing the document readers to particular changed paths remains a later Z1 unit.

Validation must cover conditional imports, opaque file inputs and each full-suite fallback
before CI uses the selector. The pull request records selected counts and measured run times;
fewer selected files alone do not establish a speedup.

### Document selection unit

Status: implemented and locally validated in PR #820; review and merge are pending. Approved by the owner
on 2026-10-28. This unit starts from
`cdfe7399` of PR #819, on branch `codex/doc-test-selection`, PR #820.

Only audited document-input mappings may narrow the existing document-reader set. Each mapping
has a reviewed fingerprint of its source, data, configuration and declared inputs. A changed
test, helper, data input or configuration invalidates that fingerprint and keeps the test until
its inputs are reviewed again. Unknown readers remain in the existing set.

The document-only CI step uses `scripts/affected-tests.ts --documents` against the PR merge
base. No base selects the existing document candidates. Mixed code changes, a dirty worktree
or an unresolved base retain the full unit suite because document-only scope is unproven.

This unit changes only document selection. Code selection, TypeScript candidates and GPU gates
retain their existing scope. No runtime dependency is added. Validation must prove that changed
documents still select tests that detect planted faults, and that stale fingerprints broaden
the selection.

The initial audits cover these document inputs:

| Test                                            | Document inputs                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/changelog.test.ts`                         | `CHANGELOG.md`                                                                   |
| `src/core/backends/extension-profile.test.ts`   | `AUTHORING.md`                                                                   |
| `src/core/spec-conformance/stage-rules.test.ts` | `docs/roadmap.md`                                                                |
| `src/compiler/ts/builtin-values.test.ts`        | `docs/use-typeshade-surface.md`                                                  |
| `src/compiler/ts/doc-snippets.test.ts`          | `README.md`, `AUTHORING.md`, direct Markdown children of `docs/` and `examples/` |

The registry also names non-imported fixture and shader inputs. Audits assume CI's frozen
dependency install. The fingerprint includes CI configuration and the local configuration
import closure. Symlinks, a document-root override and Node options retain document readers.
Do not refresh a stale fingerprint automatically: read the test, its helpers and its file
inputs before recording another audit.

On 2026-10-28, five real document faults failed their corresponding tests after 301 baseline
assertions passed on `3b1cd968`. The README fault failed both compiler and editor checks.
PR #820 records selector integration checks, candidate counts and measured execution times.

Implementation `0a635726` passed build, lint, format, document, proposal-scope and IfChange checks.
Its 112 selection and reference regression tests passed in the document-suite run below.
The staged-index commit hooks also passed.

A paired run on 2026-10-28 used Node 24.19.0, Bun 1.4.4, Vitest 5.0.5 and pinned TypeScript 5.6.3.
The isolated fixture `9ccfeae0` changes only a proposal's Markdown comment from `0a635726`.
Both runs used `CI=true`, the default workers and the same checkout and dependencies.

| Run                          | Files | Passed tests | Skipped tests | Wall time, including selection |
| ---------------------------- | ----- | ------------ | ------------- | ------------------------------ |
| Existing document candidates | 106   | 4450         | 4             | 209.042 s                      |
| Audited path selection       | 101   | 4149         | 4             | 200.568 s                      |

The selected run spent 1.92 s selecting tests. The observed reduction was 8.474 s, or 4.05%.
This was one baseline-then-selected pair without a cache reset; it does not establish a
general speedup. Unknown readers still account for 101 files, so further narrowing requires
additional input audits.

Five isolated commits then planted those document faults against `0a635726`. The actual
`--documents --base` CLI retained all five valid audits and selected each failing reader.
The targeted tests failed as expected, including both README compiler and editor checks.

### Host diagnostic batching unit

Status: implemented and locally validated in PR #821; review and merge are pending. Approved
by the owner on 2026-10-28. This unit starts from `07127b3b` of PR #820, on branch
`codex/batch-host-diagnostics`.

Batch the independent host programs in `src/compiler/ts/host-entry.test.ts` and
`src/compiler/ts/host-kernel.test.ts`. Use one TypeScript Program per fixture group so its
library and generated view are checked once. Keep each case in its own module and attribute
diagnostics to its exact file. Unexpected global, library or generated-view errors must fail.

Preserve every positive and negative case, the editor checks, the DOM library and compiler
options. Do not change production code or narrow test selection in this unit. The target is
four complete host Program checks instead of twelve across these two test files.

Validation compares diagnostic results before and after batching, verifies fault detection,
and measures both test files on the same runtime and dependency baseline. A measured speedup
must report run order and cache conditions. CI also checks the supported TypeScript versions.

The implementation reduces host-entry's complete host Programs from eight to two, and
host-kernel's from four to two. The unchanged resident-form group already batches five cases.
All 91 tests retain their names and pass before and after the change. Static comparison
confirmed that the fixture sources, expected diagnostics and compiler options remain the same.

Measurements on 2026-10-28 used Node 24.19.0, Bun 1.4.4, Vitest 5.0.5 and TypeScript 5.6.3.
Both variants ran in the same isolated checkout with `CI=true`, default workers and both
reporters (default and JSON). No cache reset occurred between runs.

| Run order | Variant  | Wall time | Passed tests |
| --------- | -------- | --------- | ------------ |
| 1         | Original | 47.921 s  | 91           |
| 2         | Batched  | 22.079 s  | 91           |
| 3         | Batched  | 23.729 s  | 91           |
| 4         | Original | 41.909 s  | 91           |

The original mean was 44.915 s; the batched mean was 22.904 s, a 49.01% observed reduction.
This measures these two files, not the full CI workflow. There were two runs per variant;
the order helps expose cache effects but does not establish a general performance bound.

Build, lint, format, requirements synchronization and Doorstop validation passed locally.
The requirement files needed no changes because the rule references and evidence remain valid.

Six independent fault probes failed as expected. They covered a broken positive case,
repaired negative cases in both files, generated-view errors in both files, and a global
diagnostic from an invalid library option. Each probe restored its isolated source afterward.

### Typed binding diagnostic batching unit

Status: implemented and locally validated in PR #822; review and merge are pending. Approved
by the owner on 2026-10-28. This unit starts from `d494156d` of PR #821, on branch
`codex/batch-binding-diagnostics`.

Batch the seven host fixtures in `src/compiler/ts/typed-bindings.test.ts` into one TypeScript
Program and generate their shared shader view once. Keep the six named tests, all source
cases, expected diagnostics and body-relative line numbers. Each fixture stays a separate
module. Unexpected global, generated-view or other non-case diagnostics must fail.

Keep the existing TypeScript options and runtime behavior. Check original and batched results,
plant faults to verify diagnostic routing, and measure the complete file in both run orders.
Record the runtime versions, cache conditions and limitations of the measurement. CI retains
the supported TypeScript version checks.

The implementation prepares seven independent modules in one `beforeAll` hook with a 90-second
budget. The six tests read their own results. Exact-path routing rejects unexpected diagnostics
instead of dropping them. The existing TypeScript options, including `skipLibCheck`, stay unchanged.

An isolated capture of actual Worker results confirmed seven Programs before and one afterward.
All seven fixture sources, compiler options, diagnostic codes, messages and host/body-relative
line numbers matched. Both variants reported six diagnostics and no non-case diagnostics.
The original six named tests passed. Selecting only the last test passed, as did shuffling
all six tests with seed 19.

Five fault probes detected a broken positive case, a repaired negative case, a moved diagnostic
line, a generated-view error and a global diagnostic from an invalid library option. The last
two fail the preparation hook and the suite; Vitest marks the six test bodies skipped and exits 1.

Measurements on 2026-10-28 used Node 24.19.0, Bun 1.4.4, Vitest 5.0.5 and TypeScript 5.6.3.
Both variants ran in the same isolated checkout with `CI=true`, default workers and default/JSON
reporters. The cache was not reset between runs.

| Run order | Variant  | Wall time | Passed tests |
| --------- | -------- | --------- | ------------ |
| 1         | Original | 34.257 s  | 6            |
| 2         | Batched  | 6.707 s   | 6            |
| 3         | Batched  | 6.578 s   | 6            |
| 4         | Original | 32.811 s  | 6            |

The observed mean fell from 33.534 s to 6.6425 s, an 80.19% reduction for this file.
This is two runs per variant, not a measurement of the full CI workflow or a general bound.
Build, lint, format, requirements synchronization and Doorstop validation passed. Generated
requirement files needed no changes. Final-head CI remains the authority for its version matrix.

### Fixture module-cache isolation

Status: PR #824 merged into PR #822 on 2026-10-28, after all nine CI jobs passed.
This bug fix starts from `13fe0b6f` of PR #822, on branch `codex/fixture-cache-isolation`.

The TypeScript 5.9 CI job failed while a document-contract fixture started Vitest.
The error was `ENOTEMPTY` when removing its shared `node_modules/.vitest-cache` directory.
Both selector test files link fixture dependencies to the repository's `node_modules`.
Vitest 5's default module-cache directory therefore permits concurrent fixture processes to
invalidate the same cache.

Give each fixture in `src/doc-test-selection.test.ts` and `src/affected-tests.test.ts`
its own module-cache directory. Cover their custom configurations and inherited projects.
Keep dependency recording, Vite's result-cache directory, CLI execution and static-graph checks.
Do not change the production Vitest configuration or test-selection behavior.

Validate the supported Vitest option against its installed declarations. Reproduce shared-cache
invalidation in isolated dependencies, then verify concurrent fixtures with separate caches.
Run both complete test files and the applicable build, lint, format and document checks.

The four valid fixture configurations now set `test.fsModuleCachePath` to
`.cache/vitest-modules`. Vitest 5.0.5 resolves that path against each fixture root.
The custom projects inherit it through `extends: true`. The intentionally broken
configuration still fails before startup. The installed declarations confirm this option
is supported outside `experimental`.

Validation on 2026-10-28 used Node 24.19.0, Bun 1.4.4 and Vitest 5.0.5.
Both complete test files passed all 71 tests with TypeScript 5.6.3 and again with 5.9.3.
The private checkout used its own installed dependencies. Static comparison confirmed that
all test, expectation and execution calls remain unchanged.

A separate probe reproduced cross-fixture invalidation with the original configuration:
starting a fixture with a different lockfile deleted another fixture's cache sentinel.
The exact `ENOTEMPTY` scheduling race was not reproduced locally. All four modified configuration
templates then passed two concurrent rounds, eight runs total, while preserving separate caches
and the shared dependency-cache sentinel. This verifies cache isolation, not a performance gain.

Build, lint, format, document references, proposal scope and `LINT.IfChange` checks passed.
The validated head was `4f6501ef`; merge `8089e899` carries the fix into PR #822.
All nine CI jobs also passed on `8089e899`; PR #822 is ready for review.

### Remaining measured test costs

Status: implemented in PR #823; all nine CI jobs passed on `62199837`, and review is ready.
The owner approved this unit on 2026-10-28. It starts from `13fe0b6f` of PR #822,
on branch `codex/remaining-test-costs`.

Profile and reduce avoidable work in `src/core/manifest.test.ts` and
`src/affected-tests.test.ts`, the two remaining hotspots identified in the document-suite run.
Preserve the complete manifest corpus and emit-option matrix, independent writer checks,
JSON/repack comparisons, and the selector's CLI, failure and conservative-fallback coverage.

Prefer test preparation and process-startup improvements. A manifest implementation change
must preserve outputs and diagnostics, avoid persistent caches over mutable IR, and pass the
gates that its runtime path reaches. Do not weaken assertions, remove input combinations or
narrow test selection to report a shorter run.
If the private implementation changes bundle sizes, measure both sources in the same checkout.
Record the measured differences and adjust only caps that those measurements exceed.

Record profiles, before/after measurements, run order and cache conditions. Keep independent
fault checks for any verification path whose preparation or execution changes. Report a
remaining cost explicitly if removing it would remove an independent correctness check.

The implementation reuses the binding groups already computed by `buildManifest` with the
same module and `fp64Flavor`. The console variant still reflects its separate lowered module.
No reflection result persists beyond the call. The option instrument computes its 146 default
WGSL strings once, removing 584 duplicate emits within that test. Its final default-option
comparison checks that the intervening variants left the default output unchanged.
All 231 tests, the complete 146-example by eight-option matrix, independent writer comparisons,
JSON round trips, and `repack` comparisons remain.

The document-plan fixtures now call `selectTests` in the current worker instead of starting
Bun for each of 20 API calls. A Git context in the parent environment retains the child helper,
which removes that context without changing the parent. Static-graph resolution still runs in
children. All 36 scenarios and 12 child-process call sites remain. The empty-document CLI probe
also asserts its `0/1 files (affected)` report. PR #824's fixture-cache isolation applies to
both sides of the selector performance comparison.

A worker CPU profile sampled 38.019 s inside the manifest tests, excluding import time.
The optimizer's `fixpoint` occupied 18.687 s inclusively, 49.15% of those samples.
The repeated reflection inside `packBindings` occupied 0.669 s. These inclusive costs overlap;
they are not independent totals or whole-CI percentages. Required GLSL generation occupied
13.327 s; a probe found only 32.93 ms in 243 empty requests, so no GLSL behavior was changed.

Independent old/new comparison found identical complete JSON in 1,314 cases: 146 modules
under the default and eight explicit options, with IR and console recording enabled.
Two planted faults failed as intended. Ignoring options made the option instrument fail;
ignoring WGSL options while retaining their manifest record produced 91 independent-writer
mismatches. Both faults were removed after the probes.

Timing on 2026-10-28 used Node 24.19.0, Bun 1.4.4, Vitest 5.0.5 and TypeScript 5.6.3.
Each file ran alone in the same checkout, in original/optimized/optimized/original order,
with `CI=true`, default workers, default and JSON reporters, and no cache reset.
No other test, build or profile ran during these measurements. The compared test names and
outcomes matched: 231 manifest tests and 36 selector tests on each run.

| Test file      | Original runs      | Optimized runs     | Original mean | Optimized mean | Reduction |
| -------------- | ------------------ | ------------------ | ------------- | -------------- | --------- |
| Manifest       | 45.124 s, 39.790 s | 41.027 s, 38.442 s | 42.457 s      | 39.7345 s      | 6.41%     |
| Affected tests | 23.423 s, 23.313 s | 18.998 s, 18.820 s | 23.368 s      | 18.909 s       | 19.08%    |

These are two runs per variant for each file, not whole-CI measurements or general bounds.
The selector comparison includes identical fixture-cache isolation on both sides.
The first manifest run was slower than the last; report the individual runs with the means.

Paired bundle measurements used both sources in the same checkout with Bun 1.4.4.
The emit split initial and total sizes changed from 96,670 to 96,672 gzip bytes.
The fuse split initial size changed from 13,772 to 13,773; its total changed from 92,845 to 92,846.
Only those four exceeded caps in `scripts/bundle-budget.json` changed to the measured sizes.
All floors and other caps remain. The manifest output itself stayed byte-identical.

Local verification passed build, lint, format, requirements synchronization, Doorstop,
document impact/references, proposal scope, `LINT.IfChange`, and the bundle boundary gate.
Generated requirement items needed no changes. The compile gate passed all 194 examples,
including 134 GLSL programs and 125 render pipelines, with zero failures.
The packed-tarball journey gate passed its 33 journeys and 120 runs, then all project-init,
host-import and host-example checks. A separate run with an invalid parent `GIT_WORK_TREE`
passed all 20 document-selection tests, exercising the child-helper fallback.
The full unit suite passed 491 files: 11,492 tests passed, four skipped and one todo.
The pull request records final-head CI separately.

### CI critical path reduction

Status: in progress, approved by the owner on 2026-10-28. This unit starts from PR #823
at `62199837`, on branch `codex/ci-critical-path`.

Optimize elapsed pull-request CI time, measured from workflow creation until its last required
job completes. Separate runner waiting, job dependencies, setup, checks and test execution.
Use recent GitHub run and step timestamps; local single-file speed is not the acceptance measure.

Run `40705276444` took 585 seconds from creation to completion. The first jobs waited 87 seconds.
The final `typecheck + unit` job took 488 seconds: build 33, lint 16, format 34, unit tests 382.
The TypeScript 5.9 and 6.0 jobs took 392 and 377 seconds; the compile gate took 221 seconds.
These are observations from one run, not a stable performance bound.

Reduce the measured critical path while retaining every selected test, all TypeScript versions,
GPU gates, diagnostic checks, and existing externally required check names. Parallel execution
may divide the selected suite, but must prove complete and nonoverlapping coverage and propagate
selection, worker and aggregation failures. Preserve conservative selection and empty-set behavior.
Do not modify repository protection settings, relax timeouts or remove assertions to save time.

Prefer an existing Vitest partition facility when it preserves these contracts. Choose the
partition count from measured costs and report added runner/setup work. Keep selection and
partition policy inspectable; do not introduce an unverified historical-duration dependency.
Record the final implementation, functional checks, and actual CI timing with queue time separate.

The preceding run `40703242200` completed in 546 seconds, with three seconds of initial waiting.
Its pinned job took 527 seconds, including 413 seconds of unit execution. In `40705276444`,
those execution costs fell to 488 and 382 seconds, but initial waiting rose to 87 seconds.
Thus a 39-second job improvement coincided with a 39-second increase in workflow elapsed time.
The workflow completion timestamps include one second after the last job in both observations.

Both runs used the full applicable scopes. In `40705276444`, these were 491 pinned files and
323 files on each additional TypeScript version. The selector first reported the plan document
outside its source boundary; the bundle-budget change independently requires the full fallback.
This unit preserves that policy. A future mixed-document selection change must first cover
nonstatic document inputs in Vitest configuration and plugins.

The implementation uses Vitest's existing shard sequencer: three pinned workers and two workers
for each additional TypeScript version. The sequencer hashes paths, then divides the ordered
specifications by count. Historical durations inform this partition count, not test selection
or partition membership. The observed costs are skewed: the largest pinned partition contains
55.6% of reported test-file duration with three shards. A rough cost model predicts about
212 seconds for that unit partition and 206/198 seconds for the two-version partitions.
These are planning estimates, not measured speedups. More TypeScript partitions would add
runners without shortening that predicted critical path.

Source and policy checks run in parallel with the unit workers. Every worker retains its build
and installed-version assertion. The unchanged required check names aggregate each version's
own workers; unsuccessful, cancelled or unexpectedly skipped dependencies cannot pass them.
GPU gates retain their existing implementation and scope. The unit worker count rises from
three to seven, and builds and setup repeat on each worker. Additional queue delay can offset
the execution reduction, so report runner waiting separately in the final CI comparison.

Local verification on 2026-10-29 passed all 45 selector tests (36 existing and nine new),
plus 82 neighboring document-selection, classification, hook and paired-change tests.
Actual CLI receipts prove full/affected partition coverage and project-aware multiplicity.
They also cover the TypeScript/document restrictions, invalid indices, surplus shards,
unexpected zero specifications, configuration errors and test-failure propagation.
The document PR path was also checked with `--documents`, `--base` and `--shard` together.

The exact workflow shell steps passed 130 probes for aggregation results, malformed matrices,
scope errors and event-specific CLI arguments. Actionlint 1.7.12 accepted both workflow files.
Lint, format and the bundle boundary passed in a fresh checkout without `dist`, proving the
parallel quality job does not depend on the workers' build outputs. Build, lint, format,
requirements synchronization, Doorstop and the document checks passed on the implementation.
The five existing document-input contracts were reviewed and refreshed against the new control
files; an unrelated proposal still selects 101 of 106 document candidates. The reusable worker
workflow is now a control input, so editing it invalidates those audits.
Full partition execution and actual GitHub timing are recorded on the pull request.

### TypeScript CI partition adjustment

Status: in progress, requested by the owner on 2026-10-30. This unit starts from PR #825
at `f9740521`, on branch `codex/ci-typescript-shards`.

Run `40973208311` passed all 17 jobs in 286 seconds. Its TypeScript 5.9 and 6.0 worker paths
took 273 and 267 seconds through their required checks. The pinned path took 241 seconds,
and the compile gate took 224 seconds. Those observations replace the earlier planning model:
the additional TypeScript versions now determine completion.

Increase each additional TypeScript version from two native Vitest partitions to three.
Keep the pinned suite at three partitions. Preserve the selected specifications, per-worker
builds, failure aggregation, GPU gates and required check names. Refresh the reviewed document
input fingerprints because the workflow is one of their control inputs.

Historical file costs and the completed worker timings suggest about 32 seconds less elapsed
time, with roughly 110 additional runner-seconds for two extra workers. These are estimates,
not measured results. Do not add a pinned worker until a completed run shows that it would
shorten the critical path enough to justify its repeated setup and build.

Verify the unchanged selection and partition invariants, workflow syntax, documentation and
complete TypeScript-version execution. Record actual GitHub elapsed time, runner waiting and
summed job time against `40973208311` on the pull request.

The implementation is PR #836. Local checks on 2026-10-30 passed the build, lint, format,
document-selection and TypeScript-classification tests, requirements synchronization, Doorstop,
document impact/references, proposal scope and IfChange. Actionlint accepted both workflows;
130 existing shell probes passed. Vitest's actual sequencer assigned the 323 TypeScript
specifications to 108, 108 and 107 files, with complete and nonoverlapping coverage.
Independent review found no blocker. All five document contracts were reviewed and refreshed;
an unrelated proposal still selects 101 of 106 candidates. GitHub execution results remain
to be recorded on PR #836.

### Device-range fault probe cost

Status: in progress, requested by the owner on 2026-10-30. This unit starts from PR #836
at `a4e22230`, on branch `codex/kernel-fault-probes`.

The generated kernel differential is one of the slowest files in every TypeScript leg.
Its instrument deliberately changes a device-range trip count, but first runs plans without
device ranges. The fault cannot change those plans. An unchanged local probe made 182 calls
for `device-trip-one-less`; only the last two had a device loop. The other fault probes made
seven and eighteen calls. These are call counts, not an elapsed-time improvement claim.

Skip a plan without a device loop only when injecting `device-trip-one-less`. Preserve every
normal differential seed, size, boundary input and assertion, the eligible fault inputs and
the first detected mismatch. Keep the other faults and held-length checks unchanged.
Do not change production code, the oracle, the corpus or CI worker counts in this unit.

Compare the complete existing test file before and after. Verify unchanged normal comparison
counts and eligible fault results. Disable the device fault in a temporary verification copy
and require the existing instrument test to fail. Record local paired timings separately
from any actual CI completion measurement, with the configuration and remaining work on the PR.

Implementation is PR #837. The baseline PR #836 passed all 19 GitHub jobs in run `40979089740`:
269 seconds total, 25 seconds of initial waiting and 244 seconds from first start to last finish.
Its summed job time was 2,084 seconds. Keep that run as the CI comparison for this test change.

Local ABBA measurement on 2026-10-30 used Node 24.19.0, TypeScript 5.6.3 and Vitest 5.0.5,
the same checkout and default configuration, with default and JSON reporters. No cache reset
occurred between runs. All four runs passed the same nine named tests.

| Run | Variant  | Wall time | Test bodies |
| --- | -------- | --------: | ----------: |
| A1  | Baseline |  51.082 s |    46.440 s |
| B1  | Guarded  |  32.491 s |    30.136 s |
| B2  | Guarded  |  32.228 s |    29.921 s |
| A2  | Baseline |  43.485 s |    41.156 s |

Mean wall time fell from 47.283 to 32.360 seconds, or 31.56%. This is a local file measurement,
not a CI completion result. All normal output receipts matched: 59 kernels and their feature
histogram, 708 interpreter/codegen calls, 240 ordinary plan comparisons and 144 held-length
comparisons. The corpus and all assertions remain unchanged.

Separate call receipts retained seven skipped-iteration and eighteen dropped-partial probes,
with identical inputs and outputs. Device-trip probes fell from 182 to two. Both retained
inputs and outputs matched the former eligible calls. All three first mismatches were identical;
the device fault still failed on seed 321, size 1, scatter size 1, boundary inputs.
A temporary Vite transform disabled only that fault assignment. The existing instrument then
failed its nonzero-divergence assertion. No production file was edited for this proof.
Actual GitHub results and the remaining checks are recorded on PR #837.

### Shared-worker test execution cost

Status: in progress, approved by the owner on 2026-10-30. This unit starts from PR #837
at `1f380675`, on branch `codex/selective-test-isolation`.

A four-file diagnostic passed the same 91 tests with and without isolation, in two orders.
The df64 integer property file took 53.5 seconds first and 70.1 seconds last without isolation.
With isolation, it took 55.7 seconds first and 61.5 seconds last. Its starting heap rose from
29 MiB to 473 MiB only in the shared-last case. These single observations identify a hypothesis,
not a memory leak or a proven cause. Boundary observations found no logical state contamination.

Repeat the fixed-order comparison and measure garbage collection separately from JavaScript
execution. Use CPU profiles to locate the remaining cost. Test selective isolation only if the
evidence supports it. Preserve all seeds, assertions, test specifications, affected selection,
native sharding and required checks. Keep compiler behavior and CI worker counts unchanged.

Verify the complete test inventory and failure propagation if configuration changes. Refresh
document-input fingerprints only after reviewing their configuration dependency. Record local
measurements separately from GitHub completion time. A broad isolation change needs evidence
that its extra module loading does not outweigh the execution improvement.
