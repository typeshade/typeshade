---
id: '0012'
title: A top-level loop of an exported function that takes an array runs as a GPU kernel when the compiler proves its iterations independent, and on the CPU with the line that stops it when it cannot
status: draft
rules:
- '7.2'
- '7.5'
- '8.6'
- '8.8'
- '8.21'
- '8.22'
- '8.23'
- '11.8'
surface:
- 65
exports:
- resident
- Resident
- configure
exports-removed: []
codes:
- TS8070
examples:
- loop-kernel
- loop-reduction
- loop-struct-array
- loop-on-cpu
downstream:
- repo: typeshade.github.io
  what: The control-flow page's loop copy (en and ko), which gains the loop that becomes a kernel and TS8070; the four new examples in the gallery, the Playground picker, the stills and the Korean blurbs; the API reference's entries for resident, Resident and configure; the WebGPU and WebGL2 concept page's runtime copy, which gains the tiers
- repo: vscode-typeshade
  what: The skill's compute section and references/host.md (a kernel function and its asynchronous call, resident), a TS8070 row in references/diagnostics.md, and a tsserver fixture for a host file that calls a kernel function with a Float32Array and with a Resident
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

This proposal is roadmap item 15. The owner settled the design in #252 and took its
recommendations; its seventh open question is decided on this pull request. Every measurement
cited below is recorded there, taken on `main` at cd3a70a against Tint in Chromium 141.

Today an author who wants a GPU to run a loop writes a `@compute` entry, `declare`s a storage
binding for each array, reads `global_invocation_id`, guards the bound, and packs the buffers on
the host by hand. The roadmap's own example does not compile. `out[i] = …` on a parameter is
`TS8018 Cannot write through parameter "out" — parameters are not writable.`, and
`xs.length` on one is `TS8032`.

After this change:

```ts
// terrain.shade.ts
'use typeshade';

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}

export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
```

```ts
// app.ts
import { resident } from 'typeshade';
import { height, render, total } from './terrain.shade.ts';

height([0.5, 0.5], k); // a helper: synchronous, on the CPU (0009)
const img = new Float32Array(512 * 512);
await render(k, 512, img); // the loop ran as a kernel; img is filled in place
const sum = await total(img); // a reduction: the workgroup tree, then its partials

const dev = resident(new Float32Array(512 * 512));
render(k, 512, dev); // queued; nothing is read back, so nothing waits
const again = await dev.read(); // the one wait of the chain
```

- **A kernel function** (Rule 8.22) is an exported function that is not an entry point and has
  at least one parameter of a runtime-sized array type `array<T>`. Its _candidate loops_ are
  the `for` and `for…of` statements at the top level of its body. No other loop is ever a
  candidate: a loop inside an entry, a helper or a fragment shader stays per-invocation code, as
  it is today. Measured over the 48 loops of the 89 files in `examples/` and `journeys/`: none
  is a candidate, so no golden and no diagnostic changes.
- **Its body** takes scalar statements, then one or more candidate loops, then an optional
  `return` of scalars. Each loop is one dispatch, or two for an `f32` reduction, queued in
  order. A later loop that reads a scalar a reduction produced is refused with the remedy
  "split the function".
- **The independence proof** (Rule 8.22) runs on the IR of a candidate loop with induction
  variable `i`. It is syntactic: no solver and no alias analysis, because the IR has no pointers
  and no recursion, and only bindings and `inout` arguments alias.
  - **R1.** The loop is counted (Rule 7.5) with an additive constant step. A `while` and a
    multiplicative step are refused. The IR `for` gains a `counted` field carrying the
    `CountedLoop` that `analyzeCountedFor` already computes and nothing reads today. A `while`
    is a `for` over a synthetic `_w` counter in the IR, so without the field the proof could
    not tell the two apart.
  - **R2.** No `return` inside the loop, and no `break` that belongs to it.
  - **R3.** Every write (an assignment, `++`, an `inout` argument, an `atomic*` call, a
    `textureStore`) lands on one of these:
    - a name declared inside the body;
    - an outer array at `a*i + c` (`a` a nonzero constant, and every write to that array
      using one `a` with constants `c` in `[0, |a|)`, or one `c`), or at one expression with a
      loop-invariant coefficient, which the call checks is nonzero;
    - `i*W + x`, over one perfectly nested inner loop `x` from 0 to `< W`;
    - the texture coordinate `vec2(i % W, i / W)`;
    - a reduction variable, written only as `s op= e`, `s = s op e`, `s = min(s, e)` or
      `s = max(s, e)` with one `op` of `+ * & | ^ min max`, and `e` not reading `s`;
    - an integer array written only as `a[k] op= e`, which is a scatter reduction.
  - **R4.** An array the loop writes is read in the body only at an index it writes. A
    reduction variable is not read. The value an `atomic*` call returns is not read.
  - **R5.** A function the body calls, transitively, writes no module variable and no binding.
    Its `inout` arguments count as writes at the call.
  - **R6.** No barrier, no workgroup memory and no `console.log` in the body.

  Measured on #252's corpus, the proof accepts all 14 of the 16 hand-written `@compute`
  entries whose work is order-independent, written as loops. It also refuses all seven
  textbook dependences, for the reason a reader would give: prefix sum, in-place smoothing,
  scatter, early exit, argmin, a carried "first value", and a call that bumps a counter.

- **A refused loop is a warning, `TS8070`, and the loop runs on the CPU.** The program is
  correct either way. The text is two sentences (Rule 12.1): the first names the line and the
  author's own names, and the second gives the remedy:

  | Rule | Text                                                                                                                                                                                     |
  | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | R1   | `This loop runs on the CPU because it is a while loop, whose trip count is known only when it ends. A for loop over a count runs on the GPU.`                                            |
  | R1   | `This loop runs on the CPU because "stride /= 2" does not step through a range of indices. Step by adding a constant.`                                                                   |
  | R2   | `This loop runs on the CPU because line 9 returns from inside it, so whether an iteration runs depends on the ones before it. Record the result in an array and read it after the loop.` |
  | R3   | `This loop runs on the CPU because line 49 writes "nearest", which the next iteration reads. Declare it inside the loop, or combine it with one of += *= min max & \| ^.`                |
  | R3   | `This loop runs on the CPU because line 4 writes "b[idx[i]]", an element two iterations can share. Write at an index made from "i".`                                                     |
  | R4   | `This loop runs on the CPU because line 9 reads "out[i - 1]", which another iteration writes. Read from an array the loop does not write.`                                               |
  | R5   | `This loop runs on the CPU because line 7 calls "tally", which writes "calls". Return the value from "tally" and combine it in the loop instead.`                                        |
  | R6   | `This loop runs on the CPU because line 5 calls console.log, whose lines would print in another order on the GPU. Log after the loop.`                                                   |

  The front end reports it, because only the front end still has the author's names and lines.
  #252's prototype found three things the IR loses: it names `uy_1` and `self_`, and it gives
  no span inside the helper that `xs.reduce(…)` lowers to. A loop inside such a helper reports
  on the author's call. There is one diagnostic per loop, for the first reason (Rule 12.4). The
  language service reports the same warning.

- **Reductions** lower to what items 4 and 5 already give. Each form below was written in
  `"use typeshade"`, compiled with no diagnostic, and accepted by Tint:
  - integer `+ & | ^ min max`: a 256-wide workgroup tree, then one `atomic*` per workgroup;
  - integer `*`, and every `f32` and `f64` reduction: the tree into partials, then the
    partials by the same tree. WGSL has no `atomic<f32>`, which Tint refuses with
    `'atomic' only supports 'i32' or 'u32' types`;
  - an integer scatter: `atomicAdd` on the array, retyped `array<atomic<T>>`, which keeps the
    same host layout.

  An `f32` scatter-add is refused. A reduction on WebGL2, which has no atomics and no workgroup
  memory, goes to the CPU.

- **An `f32` reduction means the tree order** (Rule 7.2). The CPU tier and the oracle run the
  same 256-wide tree, so every tier agrees bit for bit. The sequential reading differs by
  2 170 ulp at 1M elements, and the tree is the more accurate of the two. `compile().determinism`
  lists the reduction. Integer reductions, `min` and `max` are exact in any order.
- **An array parameter of a kernel function is passed by reference** (Rule 8.8's one
  exception, Rule 8.23). It is the caller's storage, and whether the body writes it decides
  its access. `array<T, N>` stays by value. A kernel function cannot be called from shader
  code (Rule 8.6), so its array parameters exist only as bindings. A helper that takes the
  array is compiled once per array argument, as a generic is once per type argument (Rule
  8.9). WGSL needs no pointer for this, and GLSL has none.
- **Host values** (surface §65, extending 0009's §64):

  | Parameter                           | Host value                                                                       |
  | ----------------------------------- | -------------------------------------------------------------------------------- |
  | `array<f32>`                        | `Float32Array`                                                                   |
  | `array<i32>`, `array<u32>`          | `Int32Array`, `Uint32Array`                                                      |
  | `array<f64>`                        | `Float64Array`, split into hi and lo by the runtime                              |
  | `array<vecN>` (and `i`, `u`, `f64`) | the scalar's typed array, N per element, tightly packed; the runtime pads `vec3` |
  | `array<S>`, a struct                | `S[]` of plain objects (0009's struct row), converted at the call                |
  | `array<bool>`                       | refused: `bool` is not host-shareable                                            |
  | any of the above                    | a `Resident` of it                                                               |

  Before anything is uploaded, a call checks each array's length against the index range the
  proof established (`a*(n-1) + c < length`). It throws a `TypeError` naming the function, the
  parameter and both numbers. Item 21 later proves the same bound at compile time.

- **The call** is asynchronous from the start, as 0009 promised the later tiers would be. The
  host view gives a kernel function two signatures, so the type shows where the wait is:
  - with a host array, it returns `Promise<void>` (or `Promise<R>`), and reads back into the
    caller's array in place;
  - with only `Resident` arrays written and no return value, it returns `void`, and only queues.

  The signature follows from the parameter types, never from the proof, so fixing a refused
  loop changes no call site.

- **`resident(array)`** from `typeshade` wraps a typed array or a struct array once and returns
  an opaque `Resident<T>`. It stays on the device across calls, and `await r.read()` is the one
  wait of a chain. On the CPU tier it holds its own array and costs nothing. The same handle is
  the image of #204 and the state of #97's Phase 4.
- **Tiers** (Rule 11.8): WebGPU, then WebGL2 through the fragment lowering, then the CPU,
  decided per call. The WebGL2 lowering takes a map that writes one array at exactly `i` with a
  4-byte element, and every other shape goes to the next tier. #252 found that 10 of the 15
  accepted maps have that shape. The runner gains:
  - several read arrays;
  - scalar arguments as uniforms;
  - an `f32` output through its R32UI bitcast;
  - on WebGPU, several outputs and struct outputs.

  `configure({ prefer })` from `typeshade` is the runner's `prefer` as a global. A one-entry
  list makes that tier required, and a call that cannot run on it throws, naming why.

## Why

`docs/dx.md` names the second execution model (dispatches, workgroups, pipelines) as the third
thing a TypeScript developer must learn before a GPU does anything. The roadmap's first reason to
build the second half of 1.0 is "Loops become kernels". #252 measured the design against the
corpus rather than against a sketch.

The owner took #252's recommendations on its open questions:

1. The trigger is an exported function with a runtime-sized array parameter, and not every
   exported function's loop. The latter would put proofs and warnings on 48 loops that are
   correct per-invocation code.
2. The tree order is the meaning of an `f32` reduction. The alternative lets the GPU differ,
   which would make development mode (item 19) flag every sum.
3. A struct array takes objects only. A packed `ArrayBuffer` in the storage layout would cost
   nothing to convert, but it would put `vec3` padding in the caller's file: 97 of the corpus's
   162 structs have padding. Residency answers the conversion cost (about 220 ms in and 1.3 s
   out per million 32-byte elements) by paying it once.
4. The word is `resident`, the placeholder `docs/dx.md` already uses, with `.read()` on the
   handle. The package top level grows by that one word, next to `grad` and `configure`.
5. The texture-coordinate rule is in, so `storage-texture` survives as a loop.
6. A refused loop is a warning, and `configure({ prefer: ['webgpu'] })` is how a caller
   requires the GPU.
7. #252 made no recommendation on the hole it found: a runtime-sized array parameter reaches
   Tint as `fn f(ps: array<P>)`, which Tint refuses with
   `runtime-sized arrays can only be used in the <storage> address space`. This proposal
   assumes a separate bug fix lands first and refuses such a parameter on every function with
   `TS8020`. This proposal then lifts the refusal for a kernel function alone. The reviewer
   decides this one on this pull request.

Alternatives considered, each measured in #252:

- **Numba's `prange`**, an author's assertion with no proof. It is smaller, but it moves the
  proof onto the author, and `docs/dx.md` asks for a loop that is "predictable, not only
  powerful".
- **Inferring residency across the host's calls** (#97 Phase 4). This needs whole-program host
  analysis, and #97 places it after 1.0.
- **Keeping a hidden device copy of each caller array**, and skipping an upload when it is
  unchanged. A typed array has no write barrier, so knowing it is unchanged costs an O(n) hash,
  which is the upload's own cost.
- **Returning a device array from the call.** The source cannot write a runtime-sized return
  type, and the roadmap's in-place form would go.
- **A multi-pass WebGL2 reduction.** It is possible, but it is new work, and v1 sends
  reductions to the next tier and says so.

## What it touches

- **Rule 7.2.** Its table gains rows for a reduction loop, which is summed in the tree order
  where the sequential reading differs in the last places, and for a scatter reduction, which
  lowers to atomics.
- **Rule 7.5.** The rationale names item 15 as a reader of the counted shape, and the counted
  fact now reaches the IR.
- **Rule 8.6.** A kernel function, like an entry, is not called from another function.
- **Rule 8.8.** Its one new exception: a runtime-sized array parameter of a kernel function is
  passed by reference.
- **Rule 8.21 (0009).** The host call gains the kernel function's asynchronous shape, its two
  signatures and the length check.
- **Rule 8.22 (new).** A kernel function, its candidate loops, the body's shape, and the proof
  R1 to R6.
- **Rule 8.23 (new).** The array parameter: by reference, its access inferred, compiled once
  per argument in a helper, and its host values.
- **Rule 11.8 (new).** The tiers, what each takes, the reduction's tree order on every tier,
  and `configure({ prefer })`.
- **Surface §65 (new): "A loop that runs as a kernel".** It is the next free number after 0009's
  §64 and no open branch claims it. It holds the kernel function, the proof's rules, the TS8070
  table, the host values, `resident` and the tiers.
- **TS8070 (new).** The warning. TS8069 is claimed by the open proposal on the directive (#253).
- **Exports.**
  - `resident`, the function;
  - `Resident`, its opaque type;
  - `configure`, whose options are `{ prefer?: readonly ('webgpu' | 'webgl2' | 'cpu')[] }`.

  All three are from `typeshade`, baked into `src/__api__/surface.md` (Rule 11.6).

- **Examples.**
  - `loop-kernel`: the roadmap's terrain;
  - `loop-reduction`: a sum, a mean and a variance, and a histogram;
  - `loop-struct-array`: the particle step as a loop over `array<Particle>`;
  - `loop-on-cpu`: one refused loop per rule, each carrying its TS8070 warning. It compiles,
    because a warning refuses nothing.
- **Code.**
  - `src/core/ir/nodes.ts`: `for` gains `counted`, set by `lowerFor` and absent on a `while`.
  - `src/core/passes/parallel-loop.ts` (new): the proof over the IR, with its facts. The
    front end turns them into TS8070 in the author's names.
  - The kernel lowering: the generated `@compute` entry per candidate loop, the tree reduction,
    and the dispatch plan the host module reads.
  - `src/compiler/ts/host-face.ts` (0009): the kernel function's host face and its overloads.
  - `src/core/compute/runner.ts`: the generalizations above.
  - `typeshade/runtime`: the call, the length check and `Resident`.
- **Tests.**
  - `src/core/passes/parallel-loop.test.ts`: every row of #252's M2 table, each accepted form
    and each refusal with its code and text, and the six `inout` cases the prototype first got
    wrong (M1, finding 1);
  - a parity test that every tier computes the same bits for each example, reductions
    included;
  - both halves (CLAUDE.md): each refusal asserted in `compile()` and in the language service
    on the same source, and a host call typed through the host view in `tsc`;
  - a journey: the particles journey rewritten as a loop, with no `@compute`, `gid` or packing,
    which is the X1 check's first program.

## What it owes downstream

**typeshade.github.io**

- **The control-flow page** (en and ko) describes a `for` loop as per-invocation code only. It
  gains the loop that runs as a kernel, the proof's rules in one paragraph, and TS8070 with its
  table.
- **The four new examples** need gallery entries, Playground picker rows, stills and Korean
  blurbs.
- **The API reference** (`src/lib/api.ts` reads the root barrel) needs entries for `resident`,
  `Resident` and `configure`.
- **The WebGPU and WebGL2 concept page** (`runtimeH`, `runtimeP`) needs the tiers, next to the
  runtime copy 0009 rewrote.

**vscode-typeshade**

- **The skill.**
  - `SKILL.md`'s compute guidance still teaches a hand-written `@compute` entry first. It gains
    the kernel function, with the entry as the escape hatch.
  - `references/host.md` gains the asynchronous call, `resident` and `configure`.
  - `references/diagnostics.md` gains a TS8070 row.
- **A tsserver fixture:** a host file that calls a kernel function with a `Float32Array`, which
  awaits, and with a `Resident`, which returns `void`.
