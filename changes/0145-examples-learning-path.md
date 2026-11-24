---
id: '0145'
title: An author learns TypeShade from a path of 17 examples and finds the other examples in a gallery
status: accepted
rules:
  - '4.3'
  - '4.8'
  - '6.9'
  - '6.10'
  - '7.5'
  - '7.9'
  - '7.10'
  - '8.9'
  - '8.10'
  - '8.11'
  - '8.12'
  - '8.13'
  - '8.16'
  - '8.17'
  - '8.18'
  - '8.19'
  - '8.25'
surface:
  - 3
  - 16
  - 17
  - 22
  - 26
  - 28
  - 30
  - 31
  - 32
  - 33
  - 34
  - 35
  - 36
  - 37
  - 39
  - 44
  - 45
  - 47
  - 48
  - 50
  - 51
  - 53
  - 54
  - 62
  - 66
  - 67
  - 76
  - 77
exports: []
exports-removed: []
codes: []
examples:
  - first-color
  - uv-gradient
  - moving-wave
  - sdf-shapes
  - tile-pattern
  - fractal
  - palette
  - bouncing-balls
  - triangle
  - spinning-cube
  - textured-cube
  - double-array
  - image-blur
  - parallel-sum
  - histogram
  - particle-system
  - ray-tracer
  - three-body
  - bloom
  - tone-mapping
  - game-of-life
  - boids
  - reaction-diffusion
  - path-tracer-progressive
  - fluid-2d
  - kernel-array-methods
  - kernel-image-invert
  - kernel-push
  - loop-struct-array
names: []
downstream:
  - repo: typeshade.github.io
    what: The examples page, the example detail pages and the Playground starters (en and ko) show the learning path in order and the gallery in four groups (amendment A1); the Playground default host and the host runner run the new host.ts form; the example blurbs and i18n lines name the new ids; each page that links an old example id or lists the examples is checked; compiler-changes.md records 0145
  - repo: vscode-typeshade
    what: The skill's example references and any sample list name the learning path and the gallery; the sample files the extension offers match the new first-color pair; compiler-changes.md records 0145
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0145, `status: accepted` (owner, 2026-11-23, Approval and plan record). Numbers 0145 and above were free on `main` at `64593b03` and in the open pull requests on 2026-11-23 (checked: `changes/` listing and `gh api repos/typeshade/typeshade/pulls?state=open`).                                                                                                                                                                                          |
| Date and attribution          | 2026-11-23, UTC. The date is the drafting date. An AI agent session (Claude Code) drafted the text for the session that works for the repository owner. The owner's decisions in `## Why` are quoted from the conversation of 2026-11-23. They are decisions about the direction. They are not an approval of this text.                                                                                                                                              |
| Applicability / Effectivity   | `examples/` (the `*.shade.ts` files, `examples/hosts/`, `_order.ts`, `_shade.ts`, `_scan.ts`, `index.ts`, `__emit-goldens__/`), `examples/hosts/_order.ts`, `_registry.ts`, `_drive.ts`, `_reference.ts`, the generator that `examples/_order.ts` names, `scripts/compile-gate.ts`, `scripts/user-journey.ts`, `scripts/changes.ts`, the docs that list examples, and the site and Playground repository. No release version is assigned (OD-6: nothing is released). |
| Review baseline               | `main` at `64593b038fc8d8b201174f482474d5374b395e55`. Proposal 0138 (`accepted`) and proposal 0142 (`accepted`) are read at that commit.                                                                                                                                                                                                                                                                                                                              |
| Review and revision authority | Pull request #1415. Git records the revisions. The review and merge records of the pull request will record the decision. This text does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                            |

## What changes

After this change, an author who opens the examples finds two things.

1. A **learning path**: 17 new examples in five parts. The first is the smallest program that
   draws. The last is a ray tracer. Each step uses only the concepts of the steps before it.
2. A **gallery**: every example that exists today, regrouped in four groups. The groups are
   _works_ (visual pieces), _high precision_ (the `fp64` examples), _feature examples_
   (small examples of one language feature) and _inspired_ (examples that implement an effect
   known from another source; amendment A1).

Each example of the path is a pair: one `.shade.ts` module and one `host.ts`. Each example of
the gallery that a host can call has the same pair (The gallery, below). The `host.ts` runs as
written in the Playground. The old examples keep their ids. Their hosts change to the host form
below.

This proposal adds no rule, no author-facing name, no diagnostic code and no export
(`names: []`, `exports: []`). It changes which examples exist and how each one is shown.

### The learning path

The path was drafted in the session of 2026-11-23. The owner reviewed the direction on the same
day, in these words: "좋은데, 처음부터 다시 구상하는거라 있던거에 얽매이지 않아도 돼요".
English: Good, but this is a fresh design, so it need not be bound to the existing examples.
The owner's words are a decision about the direction. They are not an approval of this text.
No id clashes with an existing example id, so no name is changed.

| Part                  | Step | Example id        | Result                 | New concepts of the step                                                                      |
| --------------------- | ---- | ----------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| 1 First pixels        | 1    | `first-color`     | one colour             | `"use typeshade"`, a fragment entry. Host: `fs(canvas)`, `run(canvas)`.                       |
|                       | 2    | `uv-gradient`     | a gradient             | the `position` builtin, vectors, swizzle. A uniform carries the canvas size.                  |
|                       | 3    | `moving-wave`     | a moving wave          | time as one more uniform field. Host: `animate(canvas)`.                                      |
|                       | 4    | `sdf-shapes`      | a circle and a box     | writing functions; `length`, `smoothstep`                                                     |
| 2 The language        | 5    | `tile-pattern`    | repeated tiles         | loops, conditions, `fract`                                                                    |
|                       | 6    | `fractal`         | the Mandelbrot set     | iteration with an early exit                                                                  |
|                       | 7    | `palette`         | a colour palette       | arrays, module constants                                                                      |
|                       | 8    | `bouncing-balls`  | bouncing balls         | a class, methods, objects are references (change 0142)                                        |
| 3 Drawing shapes      | 9    | `triangle`        | a triangle             | vertex and fragment entries, vertex data. Host: the program runtime (`runtime()`, `rt.load`). |
|                       | 10   | `spinning-cube`   | a spinning cube        | matrices, a camera, depth. Host: `frame.pass`.                                                |
|                       | 11   | `textured-cube`   | a textured cube        | textures and samplers                                                                         |
| 4 GPU compute         | 12   | `double-array`    | a list of numbers      | the first compute kernel, a run, reading results back                                         |
|                       | 13   | `image-blur`      | a blurred image        | an image kernel                                                                               |
|                       | 14   | `parallel-sum`    | a sum                  | workgroup memory, barriers                                                                    |
|                       | 15   | `histogram`       | a bar chart            | atomics                                                                                       |
| 5 Putting it together | 16   | `particle-system` | thousands of particles | compute moves them, render draws them. No new concept: it joins steps 9 to 15.                |
|                       | 17   | `ray-tracer`      | a ray-traced scene     | everything together. No new concept.                                                          |

Rules of the path:

- A step uses only the concepts of the steps before it. The last column lists the concepts that
  the step adds. Steps 1, 2, 9 and 10 add more than one. Steps 16 and 17 add none.
- Step 2 reads the canvas size from a uniform, as `examples/hosts/host-draw/host-draw.shade.ts`
  does. Step 3 adds only time to that uniform. [proposal] Step 17 builds its camera ray from
  vectors, so it needs no concept of step 10.
- Each step has a pair: `<id>.shade.ts` and `host.ts`.
- The `host.ts` of each step runs as written in the Playground, on every tier the step lists.
  Part 3 and step 16 list WebGPU and WebGL2 only (The cost of Part 3, below).
- A step shows no form that the compiler refuses or does not implement yet. The compiler
  refuses such a form with a diagnostic that says so (OD-9).

### The gallery

The gallery holds every example in the tree at `64593b03`, so nothing is deleted. Counts below
come from `find examples -name '*.shade.ts'` and `examples/_order.ts`, run on 2026-11-23 at
`26c38ae5`:

- 102 files `examples/*.shade.ts`.
- 9 files `examples/hosts/<id>/<id>.shade.ts` (`host-draw`, `host-compute`, `host-kernel`,
  `host-resident`, `host-helper`, `host-program`, `loop-fuse`, `string-keys-record`,
  `host-set-unique`), each with a `host.ts`.
- 36 builder examples `examples/*.ts` that `examples/_order.ts` lists (`CURATED_ORDER`). The
  site reads them at build time from `examples/index.ts`. 23 of the 102 `.shade.ts` files are
  twins of these (`twinOf`). The other 13 builder examples have no `.shade.ts` form.
- 3 support modules, which are not examples: `noise.shade.ts` (once in
  `examples/lib/`), `blur-x.shade.ts` (once in `examples/passes/`) and `trail.shade.ts` (the three moved into the directories of the examples that import them, `examples/gallery/imported-noise/`, `examples/gallery/separable-blur/` and `examples/gallery/feedback-trail/`, in M4.3a and M4.3b). An example imports
  each of them (`imported-noise`, `separable-blur`, `feedback-trail`).

Total: 114 `.shade.ts` files (102 + 9 + 3) and 36 builder files. They hold 147 examples
(102 + 9 + 36). When a twin pair is shown once, the gallery has 124 entries (147 - 23). Use
these two numbers everywhere: 147 examples, 124 gallery entries.

The 124 entries are: 79 modules with no twin (102 - 23), 9 host examples, 23 twin pairs and 13
builder examples with no twin.

The four groups are (the fourth, _inspired_, is the amendment A1 and holds no existing example):

| Group            | Content                                                                                                                            | First assignment rule                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Works            | Visual pieces: raymarching, fractals, noise, terrain, ocean, path tracer, and so on.                                               | A renderable example that is not `fp64` and not one-feature.        |
| High precision   | The `fp64` examples: 25 examples, 13 builder and 12 `.shade.ts` (14 entries with twins shown once).                                | The id starts with `fp64-`.                                         |
| Feature examples | Small examples of one language feature: `closures`, `class-syntax`, `workgroup-reduce`, `hello-*`, the 9 host examples, and so on. | An example that shows one construct and is not a finished picture.  |
| Inspired (A1)    | Examples that implement an effect or a technique known from another source. The first batch is in A1.                              | The example names its source as inspiration (A1, The writing rule). |

The tree holds 28 files named `fp64-*`. Of these, 25 are examples. The other 3 are test files
(`fp64-julia.test.ts`, `fp64-lane-stripes.test.ts`, `fp64-twins.test.ts`). They are not examples
and stay where they are.

The first assignment is a rule, not a list. Milestone M4 writes the full table, id by id, as
data in each example's header (a `group` field beside `title` and `blurb`). The owner reviews
that table in the pull request of M4 (open question Q3).

**What "has a `host.ts`" means in the gallery.**

1. A `.shade.ts` example with `"renderable": true` gets a `host.ts` of the new form. A host
   example already has one, and M4 rewrites it.
2. An example with `"renderable": false` gets a `host.ts` with `run()` only when its module has
   an export that a host can call (Rules 8.20 and 8.24). Today 25 files `examples/*.shade.ts` and 7
   of the 9 host modules say `"renderable": false` (`grep -l '"renderable": false'`).
3. A module with no export that a host can call gets no `host.ts`. The gallery shows the module
   and says why. M4 lists these modules in its table (open question Q7).
4. A builder example with no twin (13) stays as it is. It has no `host.ts` and no module.
   The gallery shows it in its builder form.
5. A builder example with a twin (23) is shown through the twin. The twin follows rule 1, 2 or 3.
6. A support module (3) gets no `host.ts`. It moves with the example that imports it.

## The host.ts form

Every example that gets a `host.ts` follows one form.

1. The file imports the shader module itself. The Vite plugin (`typeshade/vite`) turns each
   exported function of the module into a function the host calls (Rule 8.20).
2. The file exports `run(canvas)` for a drawing example, or `run()` for a compute example.
   `run` does the work once and resolves when the result is ready. A drawing example that
   changes with time takes a second argument: `run(canvas, time = 0)` draws one frame.
3. A drawing example may also export `animate(canvas)`. It calls `run(canvas, time)` each frame.
4. The file holds no pipeline, buffer, bind group or encoder code.
5. The file has a leading comment of one to three lines. It names the concept the step adds.
6. When a host exports both `run` and `animate`, the Playground calls `animate` and shows the
   frames. [proposal] The check harness calls `run`. When a host exports `run` only, the
   Playground calls `run`. The Playground adds nothing around either call.

Item 1 limits the form to what a host can call. A vertex entry is not callable from a host
(Rule 8.20). The default-export manifest and the program runtime are not that form. Part 3 and
step 16 break item 1 until 0138 milestone 5 (The cost of Part 3, below).

"Replaced in full" is the owner's instruction: "중요한건 지금 host.ts 코드도 전면 교체해야한다는거입니다."
(2026-11-23). Today's `host.ts` files export several functions each and serve two readers: the
reader and the check harness `examples/hosts/_drive.ts`. The new form serves the reader first.
The harness reads the same `run`, so the checks still run the code the reader sees.

### Which host API each part uses

The API below is what `main` at `64593b03` has. Nothing here is a new name.

| Part                  | Host API on `main`                                                                                                                                      | Tiers                               | Depends on 0138 milestone 5?                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 First pixels        | A full-screen `@fragment` entry called as `fs(canvas, bindings?)` (surface §67, Rule 8.24). Step 1 passes no bindings.                                  | WebGPU, then WebGL2, then CPU.      | No.                                                                                                                                           |
| 2 The language        | The same call. Step 8 passes class instances as bindings.                                                                                               | As part 1, checked per step at M2.  | No. Step 8 depends on 0142 (`accepted`). Whether 0142's stages are implemented is not verified here. M2 checks it first.                      |
| 3 Drawing shapes      | A vertex and fragment entry pair on the program runtime: `runtime()`, `rt.load(program).render(...)`, `rt.frame().pass(...)` (as `host-program`).       | WebGPU and WebGL2. No CPU tier.     | Yes. 0138 R5 replaces this form (The cost of Part 3).                                                                                         |
| 4 GPU compute         | A `@compute` entry called as `scale(bindings, workgroups)`; kernel functions called as `await kernel(args)`; `array`, `zeros` from `typeshade/runtime`. | Checked per step at M3.             | No for steps 12 and 13. Steps 14 and 15 are not checked against the 0138 milestone 4 slices (A10) here. M3 checks it.                         |
| 5 Putting it together | Step 16 draws and computes in one frame: program runtime plus resources. Step 17 is a full-screen entry plus an image kernel.                           | Step 16: WebGPU and WebGL2 at most. | Yes for step 16 (0138 milestone 5 and the milestone 4 graphs). Step 17 depends on part 3 only if it draws through a render pass. It does not. |

Facts read at `64593b03`: `src/runtime.ts` exports `array`, `texture`, `uniform`, `zeros`,
`configure`, `createDevice`, the `Device` type and the program runtime. It exports no `show`
and no `node`. These two names are in 0138 and are not delivered. The proposal names them as a
dependency and does not use them. A host.ts of the path does not call `createDevice`.

### The cost of Part 3 and step 16

Facts, read at `64593b03`:

- The program runtime runs on WebGPU and WebGL2. It has no CPU tier (`examples/hosts/_order.ts`,
  the comment on `host-program`: "the CPU tier is the call layer's").
- A vertex entry is not callable from a host (Rule 8.20). A draw with a vertex entry needs the
  default-export manifest and `runtime()`.
- 0138 R5 (`changes/0138-host-nodes-and-graphs.md`, R5) makes `fs(vs(vertices))` the draw form.
  It replaces the program runtime form that steps 9 to 11 and 16 would teach.
- 0138 milestone 5 is not started on `main`.

Cost, stated plainly. If the path writes steps 9 to 11 and 16 now, each of the four `host.ts`
files breaks host form item 1, loses the CPU tier, and is rewritten when 0138 milestone 5
lands. The shader modules of these steps are not rewritten. Q6 asks the owner to choose.

**Dependency rule.** A step is never written with an API that does not exist (OD-9: the compiler
refuses a form it does not implement, and the diagnostic says so).

## One example before and after

CLAUDE.md asks for one example before and after for a change to how an author writes an
example. The example is the smallest program that draws.

**Before.** `hello.shade.ts`, a top-level file of `examples/`, is a triangle. It has no host. A reader who wants to see
it run copies `examples/hosts/host-draw/host.ts`, which is the closest host:

```ts
"use typeshade";
// examples/hello.shade.ts (abridged)
interface Clip { pos: builtin<"position">; }
interface Color { color: vec4; }

@vertex
export function vs(i: builtin<"vertex_index">): Clip {
  let x = -0.8;
  let y = -0.8;
  if (i === 1) { x = 0.8; }
  if (i === 2) { x = 0; y = 0.8; }
  return { pos: vec4(x, y, 0, 1) };
}

@fragment
export function fs(): Color {
  return { color: vec4(1, 0, 0, 1) };
}
```

```ts
// examples/hosts/host-draw/host.ts (abridged)
import { fs } from './host-draw.shade.ts';

export function draw(canvas: HTMLCanvasElement | OffscreenCanvas, time: number): Promise<void> {
  return fs(canvas, { frame: { time, size: [canvas.width, canvas.height] } });
}
export function animate(canvas: HTMLCanvasElement): void { /* requestAnimationFrame loop */ }
export async function run(canvas, times = [0, 0.5, 1.25]): Promise<void> { /* ... */ }
```

The first example a reader meets teaches two entries, two structs, a builtin and a branch.
The host is a different example, with three exports and a uniform.

**After.** the pair `first-color.shade.ts` and `host.ts` in the new path directory of `first-color`:

```ts
"use typeshade";
// Step 1. A fragment entry returns one colour for every pixel.
@fragment
export function fs(): vec4 {
  return vec4(0.2, 0.6, 1.0, 1.0);
}
```

```ts
// Step 1. Draw the module's entry into a canvas. The same call runs on WebGPU, WebGL2 and the CPU tier.
import { fs } from './first-color.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas);
}
```

- [fact] Rule 8.24 (change 0125) says `entry(target)`, `entry(target, undefined)` and
  `entry(target, {})` have the same meaning when the entry reaches no host binding. Surface §67
  gives `e(target, bindings?)`. `first-color` reaches none, so `fs(canvas)` is the call.
- Both halves (CLAUDE.md, "A test reads both halves"): M1 asserts `compile()` and the
  language service on the same `first-color.shade.ts` source. `getDiagnostics` returns none,
  and the emit has one fragment entry. The `first-color` pair is not run yet. M1 runs the `host.ts` on the three tiers and checks it with `tsc`.

What the author removes from the reader's first screen: the vertex entry, the two interfaces,
the branch, the uniform and the bindings argument. What the author keeps: the directive, one entry, one call.

## Why

On 2026-11-23 the owner decided the direction (quoted in Korean as said):

- "그냥 모든 예제를 다시 구조있게 만들고자합니다. 예제는 가장 기본적인것 부터 해서 어려운걸로 나아가게하되, 기타 예제들은 겔러리에 넣는걸로 해주세요."
  (English: Make all the examples structured again. Go from the most basic to the hardest. Put
  the other examples in a gallery.)
- "처음부터 다시 구상하는거라 있던거에 얽매이지 않아도 돼요"
  (English: This is a new design from the start. The existing examples do not bind it.)
- Earlier the same day: "중요한건 지금 host.ts 코드도 전면 교체해야한다는거입니다."
  (English: The important point: the `host.ts` code must also be replaced in full.)

Evidence for the problem, read at `64593b03`:

- `examples/_order.ts` orders 36 builder examples editorially: "cartographic first, then generic,
  then compute". Its order follows the site's first purpose (a map site), not a reader's
  progress.
- `examples/_shade.ts` (line 22 and nearby) records that the 102 `.shade.ts` files are not in
  `examples/index.ts` and are shown by none of the site's pages. It names the site's gates
  (`wgslOnlyExample()`, `checkedBlurbs()`, a typed `categories` record) as the cause. The site
  repository is not read here, so these names are unverified.
- The first `"use typeshade"` example, `hello.shade.ts`, has a vertex entry, two structs and a
  branch. A host for it does not exist. The nine hosts of `examples/hosts/` are API examples
  for people who know the language.
- A `host.ts` today serves the reader and the check harness. Each exports more than one
  function (for example `draw`, `animate`, `run` in `host-draw`).

Alternatives:

| Option | What it is                                                    | Cost                                                                                      |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A      | This proposal: new path, old examples regrouped in a gallery. | One new set of 17 pairs. Every old host is rewritten. Many files move.                    |
| B      | Order the old examples as a path. No new example.             | No old example is basic enough for steps 1 to 3. The owner said the old ones do not bind. |
| C      | A path of new examples. Old examples stay as they are.        | The owner asked that every example move to the structure. Two host forms live together.   |

The owner chose A in the words above. B and C are recorded as the options this text did not
choose.

Assumption: the learning path of the owner's session is the table above, and each step needs
one pair. The pairs are small. Step 16 and step 17 are the largest.

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md`. It reverses none.

- **OD-1.** The path teaches TypeShade as its own language. A step never explains a form by
  what `tsc` accepts. The `host.ts` is TypeScript; the `.shade.ts` is not.
- **OD-2.** Each entry in the path is written `@vertex`, `@fragment` or `@compute`. No example
  uses a fixed function name for a stage.
- **OD-3.** The proposal adds no construct. Each concept in the path exists already. The path
  does not teach a construct the compiler could replace.
- **OD-4.** The proposal shows the owner the example before and after (above), and lists the
  options and their costs (Why). The owner decides before the merge.
- **OD-5.** Step 8 and the gallery's reference examples (`reference-parameters`, `orbit-inout`)
  rest on "an object is a reference, with no qualifier". No path step writes `@inout` or `@out`.
  `orbit-inout` and `reference-parameters` are checked against 0142's state at M4.
- **OD-6.** Nothing is released. An old example id that the site shows needs no warning
  release. A redirect is a choice, not an obligation (Q1).
- **OD-7.** A path step writes a number as a number. No step teaches a default type.
- **OD-9.** The compiler refuses a form it does not implement yet, and the diagnostic says
  so. The path therefore shows no form that is refused today.

OD-10 (dynamic arrays) does not apply: no step grows an array. `palette` and `double-array`
use arrays of a fixed length.

OD-8 (a library's decorator) does not apply. The owner's words of 2026-11-23 are not an entry.
Only the owner adds an entry. This proposal adds none.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule, diagnostic code or surface form
(`names: []`, `rules: []`, `codes: []`, `exports: []`, `surface: []`). It changes which
examples exist, how they are grouped, and how each `host.ts` is written. The compiler cannot
choose the order of concepts that a reader meets, so the change is editorial work.

## What it touches

Front matter, one line each:

- `examples`: the 17 ids of the learning path are added. No existing id is removed or renamed.
  [inference] If the gallery files move into directories (Q2), `scripts/changes.ts` first
  learns the new paths, so that a move with the same id is not reported as a removal and an
  addition (`exampleId`, lines 420 to 432).
- `rules`, `surface`, `exports`, `exports-removed`, `codes`, `names`: none. Rules 8.24 and
  11.10 and surface §65, §67 and §69 are read, not changed.
- `downstream`: the site and the editor skill (What it owes downstream).

Files and subsystems at `64593b03` (the implementation touches each):

| Item                                                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `examples/path/<id>/` (new)                                                  | 17 directories with `<id>.shade.ts` and `host.ts`.                                                                                                                                                                                                                                                                                                                                                                 |
| `examples/gallery/` (new, Q2)                                                | The 147 examples (124 entries, twins once) regrouped in the groups (four with amendment A1). Each gets a `host.ts` as The gallery rules say. The 3 support modules move with their importers.                                                                                                                                                                                                                      |
| `examples/_order.ts`, `examples/index.ts`, `examples/hosts/_order.ts`        | Split in two: the path order (hand-written, by step) and the gallery order (by group). The two `_order.ts` lists and `examples/hosts/_registry.ts` merge or are replaced.                                                                                                                                                                                                                                          |
| the script `gen-example-registry`                                            | [fact] The file named in `examples/_order.ts`, `_scan.ts` and `index.ts` does not exist in the tree at `64593b03` (`git ls-files`). M1 finds which script writes `examples/index.ts` and updates it.                                                                                                                                                                                                               |
| `examples/_shade.ts`, `examples/_scan.ts`, `examples/registry-drift.test.ts` | Discover the new directories. The drift gate reports an id in the order lists that has no file, and a file that no list names.                                                                                                                                                                                                                                                                                     |
| `examples/__emit-goldens__/` (423 files)                                     | Names follow the id, so a move changes no name. 17 new modules add goldens. A changed module changes its golden.                                                                                                                                                                                                                                                                                                   |
| `scripts/compile-gate.ts`                                                    | Its example set (`examples`, `shadeExamples`) grows by 17 modules and keeps all the others. Each new step is judged on Tint and ANGLE as the others are.                                                                                                                                                                                                                                                           |
| `scripts/user-journey.ts`                                                    | Journeys that name `host-draw`, `host-compute` and the other hosts read the new `run` of each.                                                                                                                                                                                                                                                                                                                     |
| `examples/hosts/_drive.ts`, `examples/hosts/_reference.ts`                   | M4 rewrites both: they call `draw` and `runSpecialized`, which the new form removes. The reference of each new step is computed in plain JavaScript.                                                                                                                                                                                                                                                               |
| `examples/host-examples.test.ts`, `examples/examples.test.ts`                | Run each new `host.ts` on the CPU tier. A listed tier must pass, an unlisted tier must not pass (as `HOST_ORDER` does today).                                                                                                                                                                                                                                                                                      |
| Docs that name examples                                                      | Verified by `grep` on 2026-11-23: `README.md` (names `hello.shade.ts`, lines 221 to 229), `docs/language-service-api.md` (`hello.shade.ts`, `hello-uniform-struct.shade.ts`), `AUTHORING.md`, `journeys/README.md`, `docs/capability-coverage.md`, `docs/debugging.md`, `docs/performance.md`, `docs/language-design.md`, `docs/use-typeshade-surface.md`. `bun run docs:impact` lists the rest at each milestone. |
| `examples/README.md`, `examples/PORTING.md`                                  | Rewritten for the two places and the host form.                                                                                                                                                                                                                                                                                                                                                                    |

Evidence the implementation will give (each milestone below): `bun run gate:compile`,
`bun run bake:goldens` with its diff, `vitest` runs for the example suites, `bun run
gate:journeys`, a Playground run, `bun run docs:impact`, `bun run docs:refs`, and
`bun scripts/changes.ts`.

### Impact estimate

**What an author must learn that is new** (README, Independent review, question 1).

- No language concept. The proposal adds no rule, name or code.
- The host convention: `run(canvas)` or `run()`, and an optional `animate(canvas)`. A reader of
  an example learns this one convention and no pipeline code.
- A writer of an example learns one new header field, `group`, beside `title` and `blurb`.
  `examples/_shade.ts` reads the header block and must accept it (M4).

**What the change removes** (README, Independent review, question 5). Each item is verified in
this repository at `26c38ae5`.

- The `host.ts` exports `draw` and `animate` in the old form (`examples/hosts/host-draw/host.ts`)
  and `runSpecialized` (`examples/hosts/host-compute/host.ts`). `animate` stays in the new form
  with a new meaning (host form item 3). `draw` and `runSpecialized` go.
- The single `CURATED_ORDER` list in `examples/_order.ts`. Two lists replace it (the path and
  the gallery).
- The `HOST_ORDER` list in `examples/hosts/_order.ts` and `examples/hosts/_registry.ts`
  (merged or replaced).
- The `categories` record `cartographic | generic | compute`. It lives in the site repository.
  `examples/_shade.ts` line 22 names it. It is not read here, so its removal is unverified.
- The example pages of the old order. They are in the site repository and are unverified.

**Known impacts.**

- **Golden churn.** 17 new modules add goldens. A move of a gallery module changes no golden
  name. Only `host.ts` changes in the gallery, so no gallery golden changes. A shader rewrite
  would change one. The count of changed goldens is unknown until M4.
- **Journey changes.** `scripts/user-journey.ts` names the nine host examples. Each `run` is
  replaced, so `examples/hosts/_reference.ts` changes for all nine.
- **Site pages.** The examples page groups rows by the typed record `cartographic | generic |
compute` and requires a blurb for each id in each locale (unverified: site repository). The
  new grouping needs a site change (M5). 17 new ids need two blurbs each (en, ko). The 124
  gallery entries need blurbs in both locales to be shown. The count of existing blurbs is not
  measured here.
- **Compile gate set.** It grows by 17. The compile time of the gate grows. The size is
  unmeasured.
- **Stale example names in docs.** The files in the table above name an old example. A search of
  the site and the editor repository for each old id is part of M5 and is not done here.
- **The two-form period.** Between M1 and M4 the gallery's hosts are in the old form. Each
  milestone leaves `main` green. A reader sees both forms until M4.
- **The rewrite of Part 3.** Q6 states the cost and the options.

Estimates: none. Duration and cost are not estimated (unknown, not zero).

Decisions to resolve before acceptance: Q1 to Q7 below.

### Independent review record

An independent reviewer read this draft at `26c38ae5` on 2026-11-23 and gave 15 findings:
5 blocking, 7 should-fix and 3 nit. The author's answers follow. "Fixed" means the text
changed. Open items are in the questions.

| #   | Class      | Finding                                                                              | Answer                                                                                                                        |
| --- | ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocking   | 114 `.shade.ts` files, not 111. Three files missing.                                 | Fixed. The gallery lists the 3 support modules, and M4 and "nothing is deleted" include them.                                 |
| 2   | Blocking   | Totals disagree (147 against 138).                                                   | Fixed. 147 examples and 124 gallery entries, used in every place.                                                             |
| 3   | Blocking   | Rule 8.24 lets a fragment entry be called with no bindings.                          | Fixed. Rule 8.24 and surface §67 read. `fs(canvas)` is used. The [inference] label and the M1 doubt are removed.              |
| 4   | Blocking   | Step 2 needs a uniform that step 3 introduces.                                       | Fixed. The uniform moves to step 2. Step 3 adds time.                                                                         |
| 5   | Blocking   | Part 3 and step 16 break host form item 1 and 0138 R5 replaces them.                 | Fixed. The cost is stated, the tiers are corrected, and Q6 recommends writing them after 0138 milestone 5 (new milestone M6). |
| 6   | Should fix | "Each step adds one concept" is false.                                               | Fixed. The rule now says what the column lists. Host concepts are in the column.                                              |
| 7   | Should fix | Which of `run` and `animate` the Playground calls.                                   | Fixed. Host form item 6.                                                                                                      |
| 8   | Should fix | The owner's approval is not supported.                                               | Fixed. The owner's words of 2026-11-23 are quoted in Korean and English.                                                      |
| 9   | Should fix | OD-10 unused. OD-9 over-cited.                                                       | Fixed. OD-10 is removed and noted as not applicable. OD-9 states what the text uses.                                          |
| 10  | Should fix | "Each example gets a `host.ts`" is undefined for builder and non-renderable modules. | Fixed. Six rules in The gallery. Q7 asks the owner about modules with no callable export.                                     |
| 11  | Should fix | The estimate lacks what is new and what is removed. M4 rewrites `_drive.ts`.         | Fixed. Both lists are in the estimate. The table row for `_drive.ts` and `_reference.ts` says M4 rewrites them.               |
| 12  | Should fix | Docs that name old examples are unverified.                                          | Fixed. The list holds the files that `grep` found. `AGENTS.md` and `src/AGENTS.md` are removed (no match).                    |
| 13  | Nit        | Title too long. `fp64-*` count.                                                      | Fixed. 28 files: 25 examples (13 builder, 12 `.shade.ts`) and 3 tests.                                                        |
| 14  | Nit        | Long sentences. Mixed terms.                                                         | Fixed. Sentences split. Terms: group, directory, pair, entry, example.                                                        |
| 15  | Nit        | `createDevice` and `Device` are exported.                                            | Fixed. Noted in the facts read at `64593b03`.                                                                                 |

Check by the author: all 15 findings are answered. No deviation is open. The findings that
lead to a decision for the owner are Q6 and Q7.

### Approval and plan record

- [decision, owner, 2026-11-23] Shown the revision `11fd771c` in the conversation, with the
  example before and after (`hello.shade.ts` against the `first-color` pair) and the recommended
  answers to Q1 to Q7, the owner answered "추천대로" (English translation: as recommended). The
  record has no other words. The approved revision is the one pull request #1415 merges.
- Scope approved: the learning path, the gallery rules, the host.ts form and milestones M1 to M6
  as this text states them.
- The owner's answers to Q1 to Q7: each recommended answer (Open questions for the owner). In
  short: Q1 no redirect; Q2 move with `git mv`; Q3 show all 124 entries; Q4 step 1 states that
  the three tiers give the same pixels; Q5 keep all 36 builder examples; Q6 option (b), Part 3
  and step 16 after 0138 milestone 5; Q7 a module with no host-callable export has no `host.ts`.
- Responsibilities: the agent implements each milestone in its own pull request. The owner says
  "merge" for each pull request that changes how an author writes an example (CLAUDE.md,
  Merging).
- Milestones: M1 to M4 in order, then M5 in the site repository. M6 follows 0138 milestone 5. No
  duration is established.

#### Milestones (proposed, one pull request each)

Each milestone carries `Change: 0145`. Each leaves `main` green. A pull request that shows an
author-facing form shows the example before and after, and waits for the owner's "merge".

| Milestone | Content                                                                                                                                                                                   | What it verifies                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | Part 1 (steps 1 to 4), the host.ts form, and the registry split (path against gallery). `scripts/changes.ts` and the scan learn `examples/path/`.                                         | `bun run gate:compile` with the 4 new modules. Goldens baked and the diff read. Both halves on each of the 4 sources (`compile()` and the language service). Each `host.ts` run on the CPU tier and on a WebGPU page. `registry-drift.test.ts`. `docs:impact`. |
| M2        | Part 2 (steps 5 to 8). First, check 0142's state for step 8.                                                                                                                              | As M1 for 4 modules. Step 8 on the three tiers, with objects as references.                                                                                                                                                                                    |
| M3        | Part 4 (steps 12 to 15) and step 17.                                                                                                                                                      | As M1 for 5 modules. Compute steps: the result read back equals a plain JavaScript reference (`_reference.ts` form). Step 17 on WebGPU and the tiers it lists.                                                                                                 |
| M4        | The gallery migration: every example gets a `host.ts` as The gallery rules say, and a `group`. The nine host examples, `_drive.ts`, `_reference.ts` and their journeys move to the form.  | `gate:journeys` on WebGPU and WebGL2 (the tiers each host lists). `examples/host-examples.test.ts` on the CPU tier. Goldens unchanged for a pure move. The full group table, with the modules that have no `host.ts`, is in the pull request.                  |
| M5        | The site and the Playground (the site repository): the examples page, the example pages, `playground-host-default.ts`, `playground-host-run.ts`, the host example pages, the i18n blurbs. | The site build. A Playground run of each `host.ts` of the path that exists. The site's own gates. This milestone belongs to the site repository and follows its compiler pin (README, The lifecycle, item 5).                                                  |
| M6        | Part 3 (steps 9 to 11) and step 16, written after 0138 milestone 5 is delivered (Q6, option (b), chosen). Both use `fs(vs(vertices))`.                                                    | As M1 for 4 modules, on the tiers that 0138 milestone 5 gives. Both halves on each source.                                                                                                                                                                     |

[inference, agent] M5 runs in the site repository, and the compiler pin pull request there fails
until 0145 is in its `compiler-changes.md`. The names of the Playground files are as the
owner's task gave them and are not verified in this repository.

### Configuration and validation record

The proposal is `accepted`, not `implemented`. This record grows with each milestone. Delivery of
the whole change will require: the pull requests and commits that say `Change: 0145`; the
delivered configuration; the functional checks per milestone; the document audit; each deviation
with its disposition; and the pending work.

**M1, delivered.** Pull request #1422, merged on 2026-11-23 as `0e86ecd0`. The owner said "승인"
(English: approved) in the conversation for it.

- Delivered: steps 1 to 4 under `examples/path/<id>/`, the path registry (`examples/path/_order.ts`,
  `_registry.ts`, `index.ts`, `_reference.ts`, `_drive.ts`, `tsconfig.json`), the scan and
  `scripts/changes.ts` reading `examples/path/`, `examples/path-examples.test.ts`,
  `src/changes-path.test.ts` and the four emit goldens.
- [fact] Checks before the merge, on the branch based on `08e98bb8`: `bun run gate:compile` (211
  examples, 0 failures), `bun run bake:goldens` (only the four new files), `vitest run examples`
  and the policy tests (32 files, 1292 tests), `tsc --build --force`, `docs:refs`, `docs:impact`.
  Every check of the pull request's head `7da4726e` was green, the four required checks included.
- Not run: a WebGPU page that runs the four `host.ts` files, since `gate:journeys` reads only
  `HOST_ORDER`; the `animate` of `moving-wave`. Open: M4 brings the path into the journeys.

| Deviation                                                                                                                                                                                                  | Disposition                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| D-1. The four modules carry `"renderable": false, "reason": "no entry point"`, as `host-draw` does. A module with only a fragment entry has no vertex stage, and the `shade-examples` GLSL test needs one. | Open. M5 decides what the site reads for a step that draws.         |
| D-2. The uniform is `interface Frame`, where `host-draw` uses `class Frame`. Step 8 stays the first step with a class.                                                                                     | Closed. The path rule "a step uses only earlier concepts" asks it.  |
| D-3. `examples/index.ts` names the generator scripts/gen-example-registry.ts, which does not exist, so `pathExamples` was added by hand.                                                                   | Closed by M4.1: the generator is written and a drift test holds it. |
| D-4. Steps 1 to 4 also use `abs`, `max`, `sin`, `const` locals and swizzles, which the path table does not list.                                                                                           | Open. The path table is amended to list them.                       |

**M2, delivered.** Pull request #1429, merged on 2026-11-23 as `7cc11705`, under the owner's
go-ahead of that day for every pull request until 24:00 KST ("12시까지 모두 자동 진행 승인").

- Delivered: steps 5 to 8 (`tile-pattern`, `fractal`, `palette`, `bouncing-balls`) with their
  references, drives and four emit goldens.
- [fact] Checks: `bun run gate:compile` (215 examples, 0 failures), `bun run bake:goldens`,
  `examples/path-examples.test.ts` (32 tests: both halves, each `run()` on the CPU tier, `tsc` on
  the hosts). Every check of the head `7a42dff5` was green, the four required checks included.
- Not run: a WebGPU or WebGL2 page.

**M3, delivered.** Pull request #1430, merged on 2026-11-23 as `4d2ca1aa`, under the same
go-ahead.

- Delivered: steps 12 to 15 and 17 (`double-array`, `image-blur`, `parallel-sum`, `histogram`,
  `ray-tracer`) with their references, drives and five emit goldens.
- [fact] Checks: `bun run gate:compile` (220 examples, 0 failures), `bun run bake:goldens` (368
  tests), `npx vitest run examples` and the policy tests (1342 tests). Every check of the head
  `233906c3` was green, the four required checks included.
- Not run: a WebGPU or WebGL2 page. The WebGL2 entries of `examples/path/_order.ts` rest on
  Rule 11.8 and change 0054, not on a run.
- [fact] The first M3 commit listed no WebGL2 for `parallel-sum` and `histogram`, on the ground
  that WebGL2 has no workgroup memory and no atomics. That was wrong: the pass program of change
  0054 runs both. Commit `233906c3` corrected it before the merge, and OD-11 now records the
  owner's decision against that reasoning.

| Deviation                                                                                                                                                         | Disposition                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| D-5. The text says step 8 passes class instances as bindings. Step 8 builds its balls in the fragment entry, so no instance crosses the host boundary.            | Open. The text is amended, or a later step shows a class binding. |
| D-6. The text leaves the compute host form open. Steps 12 to 15 use `run(args = default): Promise<result>`, which returns an array or a number and draws nothing. | Open. The host form section is amended to name it.                |
| D-7. `image-blur` blurs a flat `f32` array with a 2D compute entry, not a texture.                                                                                | Open. A texture form follows 0138 milestone 5.                    |
| D-8. `ray-tracer` offsets its floor checker by 0.31 and 0.17, so no tile edge falls on a pixel centre, where f32 and f64 disagree.                                | Closed. The offset changes no concept the step teaches.           |

### Status record, 2026-11-24 (handoff)

This record lists the state of change 0145 at the handoff of 2026-11-24. The owner asked for a
handoff list inside the repository. [decision, owner, 2026-11-24] The orchestrating session
relayed it with "추천대로" (English: as recommended) for the OD-11 audit. Labels: [fact] was
observed, [inference] is the agent's reading, [proposal] is planned work, [decision] is the
owner's.

Configuration of this record: `main` at `af0a3f8e`. Every commit named below was checked with
`git cat-file -t` after `git fetch`, and each is an ancestor of `af0a3f8e`. Milestones M1 to M3
are in the records above.

#### Status of the milestones

| Item                           | Status      | Identifier                                                                    |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------- |
| M4.3a (modules `a` to `h`)     | done        | #1472, merge commit `d31bfbff`                                                |
| M4.3b (27 modules `i` to `z`)  | done        | #1488, merge commit `b013281e`                                                |
| A3 (the path edits)            | accepted    | #1485, merge commit `1876866d`                                                |
| M4.6 (one driver)              | done        | #1464, merge commit `c0814b4e`                                                |
| M4.3c                          | done, held  | A patch. It waits for the owner's Doorstop review. Base `main` at `b013281e`. |
| M4.4, M4.5 rest, M4.7 to M4.10 | not started | The table "Not started" below                                                 |
| M5, M6, M7                     | not started | The same table                                                                |

[fact] M4.1 and M4.2 have no merge commit in this record, so it states no status for them.
[inference] The tree suggests that both were delivered (`examples/_manifest.ts`, and D-3 closed by M4.1). A later record names their commits.

#### M4.3c, held for the Doorstop review

1. [fact] M4.3c is complete as a patch. It is not a pull request in this record. Its base is `main`
   at `b013281e`.
2. [fact] It waits for the owner's Doorstop review. It edits the 17 rules and 27 sections of A3 by
   path only.
3. [fact] Items to review, with `doorstop review`: RULE-0403, RULE-0408, RULE-0609, RULE-0610,
   RULE-0705, RULE-0709, RULE-0710, RULE-0809, RULE-0810, RULE-0811, RULE-0812, RULE-0813,
   RULE-0816, RULE-0817, RULE-0818, RULE-0819 and RULE-0825.
4. [fact] Items to clear, with `doorstop clear`: SURF-002, SURF-003, SURF-004, SURF-007, SURF-014,
   SURF-016, SURF-017, SURF-019, SURF-024, SURF-026, SURF-027, SURF-028, SURF-040, SURF-044,
   SURF-049, SURF-063, SURF-065, SURF-068, SURF-070 and SURF-076.
5. [procedure] A person reads each item, then runs the command. An agent does not run
   `doorstop review` or `doorstop clear`, and not `python scripts/doorstop-check.py -C`.
6. [proposal] After the review, push the patch as a pull request with `Change: 0145`. It waits
   for the owner's "merge", since M4.3 is marked owner in the slice table of A2.

#### Work that follows M4.3c

[proposal] Each step below needs M4.3c merged. Each is one change on its own pull request.

1. Remove the header reader of `examples/_shade.ts`. The reader is the `EXAMPLE_BLOCK` pattern at
   `examples/_shade.ts:108` and its use in the function at `:96` to `:135` (lines on `af0a3f8e`).
   After M4.3c no module carries an `@example` header, and the scan reads `example.json` only.
2. Fix the stale count in `examples/README.md`. Line 210 says `bun run gate:compile` emits "all 127
   registered examples". Measure the count with `bun run gate:compile`, then write the number
   that it prints.
3. Fix the OD-11 wording in the bodies of the moved modules: `clip-planes`, `compute-sync`,
   `array-length`, `cube-array-gather`, `msaa-resolve`, `packed-bytes`, `storage-texture`,
   `shadow-compare` and `subgroup-reduce`. The text and rows are in the record of change 0146
   (Status record, 2026-11-24, Group 5). [fact] The body comments of these modules are not in
   the `@example` header, so M4.3c keeps them.

#### Not started

[fact] No item in this table has a commit or a pull request. The approval column says who must
say "merge" before the item is on `main`.

| Item                   | Content                                                                                                                                                                                                                                         | Next action                                                                            | Approval                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| M4.4                   | The group table: `group` and `tags` in every `example.json` and builder literal. Delete `CURATED_ORDER`.                                                                                                                                        | Write the table after M4.3c is merged. The pull request shows the table for the owner. | Owner reviews the table (Q3), then says "merge".      |
| M4.4, judgement call 1 | The rule of the group `works` in `examples/groups.json`: "A renderable example that is not fp64 and not one-feature."                                                                                                                           | The owner reads the group of each example where that rule is a judgement.              | Owner, in the M4.4 pull request.                      |
| M4.4, judgement call 2 | Nine `example.json` files carry `"waitsFor": "0145 M4.7"`: `kernel-set-unique`, `compute-reduction-twin`, `loop-kernel`, `workgroup-scratch`, `workgroup-reduce`, `loop-reduction`, `atomic-histogram`, `workgroup-override` and `loop-on-cpu`. | The owner decides if the label "0145 M4.7" stays for each, or names another slice.     | Owner, in the M4.4 pull request.                      |
| M4.5, the rest         | Rewrite `examples/README.md` and `examples/PORTING.md` to the new layout.                                                                                                                                                                       | Write the rewrite after M4.3c and M4.4.                                                | Pre-approved: merge on green checks (A2 slice table). |
| M4.7                   | `host.ts` for the callable compute and kernel modules, in batches of about five.                                                                                                                                                                | Write the first batch of the form. Show it to the owner.                               | Owner for the first batch. Then green checks (O6).    |
| M4.8                   | The three special hosts in the form: `host-compute`, `loop-fuse`, `host-program`. Remove `draw` and `runSpecialized` as exports.                                                                                                                | Start after M4.6 (done). Show the exports removed.                                     | Owner.                                                |
| M4.9                   | `scripts/user-journey.ts` reads the registry. C6 for every `host: "run"` entry. `HOST_ORDER` goes.                                                                                                                                              | Start after M4.7 and M4.8.                                                             | Pre-approved: merge on green checks.                  |
| M4.10                  | `host.ts` for the `pending` draw modules, in about 14 batches of six.                                                                                                                                                                           | Start after 0138 milestone 5 delivers a draw. The first batch shows the form.          | Owner for the first batch. Then green checks (O6).    |
| M7                     | The eight examples of the first batch of the inspired group (A1).                                                                                                                                                                               | Start after M4.4 and M4.7. Show the header of each new example to the owner first.     | Owner.                                                |
| M5                     | The site and the Playground, in the site repository.                                                                                                                                                                                            | Start after the site's compiler pin moves and 0145 is in its `compiler-changes.md`.    | The site repository's rules.                          |
| M6                     | Part 3 (steps 9 to 11) and step 16.                                                                                                                                                                                                             | Start after 0138 milestone 5 is delivered (Q6, option (b)).                            | Owner for a change to what an author writes.          |

[inference] M4.7 and M4.10 wait for the form of one batch, and M7 waits for both M4.4 and M4.7.
The longest chain is M4.3c, M4.4, M4.7, M7.

#### Verification and audit record of this section

- Ran on 2026-11-24 on `af0a3f8e`: `git cat-file -t` for each commit named above (all `commit`),
  `git merge-base --is-ancestor` for each (all ancestors), and `grep` for the line numbers of
  `examples/_shade.ts` and `examples/README.md`.
- Not run: the four required checks of CI, `python scripts/doorstop-check.py -C`, `doorstop
review` and `doorstop clear`. This section changes no code, no rule and no example.
- Not verified: the content of the M4.3c patch. The Doorstop lists are as the orchestrating
  session gave them. They are not re-derived with `bun run reqs:sync` here.
- Deviations: none open from this section. D-1, D-4, D-5 and D-7 stay open as above.

## Open questions for the owner

Each question has a recommended answer. The owner chose every recommended answer on 2026-11-23
(Approval and plan record).

1. **Q1. Do old example ids keep redirects on the site?** The site may link old ids.
   Recommended: no redirect. OD-6 says nothing is released. The ids of the gallery do not
   change in this proposal, so only a link to a page that the site removes needs a decision.
2. **Q2. Do the gallery files move into directories, or stay where they are?** Moving gives
   one layout (`examples/<group>/<id>/<id>.shade.ts` and `host.ts`) and one directory for each
   `host.ts`. Staying keeps the history short and moves nothing. Recommended: move with
   `git mv`, because each gallery example now needs a `host.ts` beside it.
3. **Q3. Does the gallery show all 124 entries or a curated subset?** The 147 examples (102
   `.shade.ts`, 9 hosts, 36 builder) hold 23 twin pairs. Showing each pair once gives 124
   entries. Recommended: show all 124, grouped by the four groups, and mark the builder form
   as the twin. The owner reviews the group table at M4.
4. **Q4. What does the CPU tier show for step 1?** The CPU tier paints pixel by pixel. For one
   colour it shows the same colour. Recommended: step 1 states that the three tiers give the
   same pixels and the Playground shows the tier it runs on. The owner may want a visible
   tier label.
5. **Q5. What about the 36 builder examples (`examples/*.ts`)?** They use the `fn()` surface.
   23 have a twin; 13 do not. Recommended: keep all 36 as they are. Show the 23 through their
   twins. Show the 13 in their builder form, with no `host.ts`, so that nothing is deleted. The
   owner may want them removed from the site.
6. **Q6. When are steps 9 to 11 and 16 written?** The cost is in The cost of Part 3 and
   step 16. Options:
   - (a) Write them now in the form of `main` (program runtime, WebGPU and WebGL2). Each
     `host.ts` is rewritten when 0138 milestone 5 lands, and the CPU tier is absent until then.
   - (b) Write them only after 0138 milestone 5 is delivered (milestone M6). This is the only
     option that avoids a rewrite. Until then the path shows 13 steps, with a gap at part 3 and
     at step 16.
   - Recommended: (b). It keeps every `host.ts` of the path in the form of host form item 1, and
     it spends no work on a form that 0138 R5 replaces. Cost of (b): the path is incomplete
     until 0138 milestone 5 lands.
7. **Q7. What does the gallery do with a module that has no host-callable export?** Rule 8.20
   admits only some exports. Recommended: show the module with no `host.ts`, say why in its
   blurb, and list each such module in the M4 table. The owner may prefer a hand-written
   `run()` that reaches the module through the program runtime. That would break host form
   item 1.

## Amendments

### A1. A fourth gallery group, inspired by other sources (2026-11-23, status: accepted)

- Status: accepted. [decision, owner, 2026-11-23] The owner answered A1-Q1, A1-Q2, A1-Q4 and
  A1-Q5 in the conversation, in a question form the agent showed (Owner's answers, below). A1 is
  part of the approved text from the merge of its pull request (#1432). No code and no example
  changes with this pull request.
- Baseline: `main` at `34d65efd`. M1 is delivered there (`examples/path/` holds steps 1 to 8).
  M3 is not on `main`: `examples/path/` has no `double-array`, `image-blur`, `parallel-sum`,
  `histogram` or `ray-tracer` yet. [fact] Read with `ls examples/path` and `examples/path/_order.ts`.

#### What A1 changes

1. The gallery gets a fourth group, **inspired**. It holds an example that implements an effect or
   a technique known from another source: a NVIDIA sample, a WebGPU sample or an example of
   another engine. The three groups of The gallery stay as they are.
2. A1 states the writing rule of the group (The writing rule, below).
3. A1 names a first batch of eight examples (The first batch, below).
4. A1 lists the examples that wait for 0138 milestone 5 (The deferred list, below).
5. A1 adds milestone M7 for the first batch.
6. The front matter `examples` gains the ids of the first batch. The text that counts the groups
   says four where it said three.

A1 adds no rule, no author-facing name, no diagnostic code and no export. `rules`, `surface`,
`exports`, `exports-removed`, `codes` and `names` stay empty.

#### Why, and the owner's words

The owner said three things on 2026-11-23, in the conversation. Each is quoted in Korean as said.

1. "그래픽스로는 엔비디아 예제도 가져와도 좋고요, 다른 엔진의 예제들도 가져와도 좋겠어요"
   (English: For graphics, it is good to bring in NVIDIA's examples too, and the examples of
   other engines too.)
2. "라이센스 문제없이, 그냥 그 예제에 대한 구현을 하는거니까 라이센스 문제없잖아요. 예를 들어
   3체 예제를 만든다고 다른 라이센스 문제를 받는건 아니잖아요"
   (English: No license problem: we just implement that example, so there is no license problem.
   For example, making a three-body example does not bring another license's problem.)
3. "라이센스가 허락하면 주석에 달고, 사용하도록 합시다"
   (English: Where the license permits, note it in a comment and use it.)

[inference, agent] Statements 2 and 3 together mean this. An idea implemented anew needs no
license. Code or an asset of a source may be used where its license permits, with a comment.
The owner's words are decisions about the direction. They are not an approval of this text.

#### The writing rule of the inspired group

- [decision, owner] Default. An idea, an algorithm or a technique is implemented anew in
  TypeShade, from its description and its result.
- [decision, owner] Where the license of the source permits reuse (for example MIT, Apache-2.0,
  BSD or CC0), its code or its asset may be used.
- [decision, owner] A reused part carries a comment. The comment names the source, its URL, the
  revision, its license and its copyright line.
- [proposal, agent] A reused part also follows the terms of its license. An Apache-2.0 source goes
  into `NOTICE`, as fdlibm does today. An MIT or BSD source keeps its copyright notice in the
  comment of the part.
- [proposal, agent] A source whose license does not permit reuse, or that has no license, is not
  reused. The example implements the idea anew. It copies no code and no asset. It does not
  translate the source line by line. An example is the default license of ShaderToy listings
  (CC BY-NC-SA), which `examples/README.md` (the licensing note) already treats this way.
- [proposal, agent] An example that reuses nothing has a header that names the source as
  inspiration. The header gives the source's name and URL. It is a courtesy. It does not
  present the example as an official example of that product.
- [proposal, agent] An example needs no texture, model or other asset of its source for its idea.
  It makes what it needs procedurally. A reused asset is the exception that the owner's third
  statement allows, with its comment.
- [proposal, agent] This is the project's rule. It is not legal advice. This is no claim that a
  license reading is certain, and an owner who doubts a source may leave it out.
- [proposal, agent] Which comment rule applies. The comment policy covers `src/` only:
  `src/comment-policy.test.ts` counts the files `git ls-files -- src` lists
  (`scripts/comment-policy.ts`, line 96). A file of `examples/` is not `src/`. The attribution
  comment is allowed there, and `scripts/comment-baseline.json` is not affected. [fact] Read on
  2026-11-23 at `34d65efd`. A reused part that is to live in `src/` follows CLAUDE.md, Comments:
  the attribution goes in `NOTICE` and in the commit message, and the comment is a `Why:` comment
  only if no name or test can carry it.
- [proposal, agent] A reused part is a change that a person reads. The pull request of M7 lists
  each reused part with the five facts of the comment, so that the reviewer can check them.

An example of a header of the group (illustrative: M7 writes each real header):

```ts
"use typeshade";

/* @example
{
  "title": "Boids",
  "blurb": "Flocking from three rules, in one compute entry and one fragment entry.",
  "group": "inspired",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Inspired by the flocking model of Craig Reynolds (1986) and the WebGPU samples
// (https://webgpu.github.io/webgpu-samples/). Written anew. No code or asset is copied.
// Not an official example of either.
```

The owner's earlier entries are not reversed. A1 rests on OD-3 (it adds no construct), OD-4
(this text shows the owner a header, and the options are in the questions) and OD-9 (the first
batch uses only forms that the compiler implements; a form it does not implement waits). OD-1,
OD-2 and OD-5 hold for the batch: each entry is `@compute` or `@fragment`, and objects are
references.

#### The first batch

Every example of the batch uses forms of the compiler at `34d65efd`: a full-screen `@fragment`
entry called as `fs(canvas, bindings?)` (Rule 8.24) and a `@compute` entry or a kernel function.
No example has a vertex entry, a render pass or a texture. Those wait for 0138 milestone 5
(Q6 of the approved text). The ids are new in the tree, except `path-tracer` (below).

| Id                        | What it shows                                                                                                                                              | Path concepts it uses                                                                       | Tiers it targets                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| `three-body`              | Three bodies under gravity. Each pixel replays the system for a fixed number of steps and draws the bodies and their trails.                               | Steps 4 to 8: functions, loops with an early exit, arrays, a class with references.         | WebGPU, WebGL2, CPU (fragment only). |
| `bloom`                   | A glow around bright points. A procedural image function is sampled at the taps of a Gaussian kernel inside one fragment entry.                            | Steps 4, 5 and 7: functions, loops, a constant array of weights.                            | WebGPU, WebGL2, CPU (fragment only). |
| `tone-mapping`            | One HDR ramp, split into three bands: clamped, Reinhard and an ACES fit. No input image.                                                                   | Steps 2 and 4: `position`, vectors, functions.                                              | WebGPU, WebGL2, CPU (fragment only). |
| `game-of-life`            | Conway's rule on a grid. A compute entry reads one buffer and writes the other. A fragment entry draws the cells.                                          | Step 7 (arrays), step 12 (the first compute kernel).                                        | WebGPU, WebGL2, CPU.                 |
| `boids`                   | Flocking from three rules. A compute entry reads every boid and writes the next state. A fragment entry draws each boid as a disc.                         | Steps 5 and 8 (loops, a class), step 12.                                                    | WebGPU, WebGL2, CPU.                 |
| `reaction-diffusion`      | Gray-Scott pattern growth on a grid, in a compute entry with two buffers. A fragment entry maps the two chemicals to colour.                               | Steps 7 and 12, and the `palette` ramp of step 7.                                           | WebGPU, WebGL2, CPU.                 |
| `path-tracer-progressive` | A path tracer that keeps the sum of its samples in a buffer. A compute entry adds one sample for each pixel in each call. A fragment entry shows the mean. | Steps 4 to 8 and step 12. It continues `examples/gallery/path-tracer/path-tracer.shade.ts`. | WebGPU, WebGL2, CPU.                 |
| `fluid-2d`                | Stable fluids on a grid: advection, divergence, a fixed count of Jacobi pressure iterations and projection, each a kernel function.                        | Steps 5, 7 and 12, and the kernel call of step 12 (`await kernel(args)`).                   | WebGPU, WebGL2, CPU.                 |

Notes on the table.

- [fact] `examples/gallery/path-tracer/path-tracer.shade.ts` exists in the gallery. A comment in its source says that progressive
  accumulation "needs a second pass that reads the previous image, which is host work today". The
  id `path-tracer` is therefore taken. [proposal, agent] The new example uses the id
  `path-tracer-progressive`. A1-Q3 asks the owner.
- [fact] `bloom` and `tone-mapping` are written without a texture input. A texture sample is a
  form that the compiler implements (surface §15), but a host binds a texture to a fragment entry
  only through the program runtime, which is 0138 milestone 5 territory for the path. The two
  examples therefore make their HDR image inside the fragment entry. A bloom that blurs the image
  of an earlier pass waits for 0138 milestone 5 and is in the deferred list.
- [fact] Tiers. WebGL2 has no storage buffer of its own, but TypeShade runs a `@compute` entry
  there as its pass program over textures of 32-bit words, with read-write storage, barriers and
  atomic operations in the phased order of change 0054 (`docs/language-design.md`, Rule 11.8 and
  the compute entry's tiers). The owner pointed this out on 2026-11-23: "WebGL2 에 스토리지 버퍼가
  없어도 typeshade에서는 구현되잖아요. 지금 그것도 typeshade가 폴백 구현해주는데" (English: even
  if WebGL2 has no storage buffer, TypeShade implements it; TypeShade provides that fallback
  now). So all eight target WebGL2. A kernel function runs on WebGL2 only when each loop writes
  one array of 4-byte elements at exactly `i` (Rule 11.8); M7 checks `fluid-2d` against that.
- [fact] None of the eight uses workgroup memory, a barrier or an atomic. None is GPU-only for
  that reason. [fact] If M7 finds that a rewrite needs a barrier, that example lists WebGPU and
  WebGL2: the CPU tier refuses an entry that reaches a barrier, and WebGL2 runs it in its pass
  program (Rule 8.24, Rule 11.8). An atomic alone keeps all three tiers. M7 checks it.
- The tiers above are targets, not results. An example lists a tier exactly when its whole
  `run()` gives the reference on that tier alone (as `HOST_ORDER` and `PATH_ORDER` do). M7 fixes
  the list from what runs.
- The steps that the batch names and that are not on `main` are steps 12 and later. M7 therefore
  follows M3.

Each example of the group gets a `host.ts` of the host form (A1-Q2). Its `run` draws one frame or
runs the calls once, and its `animate` repeats them. `game-of-life`, `boids`,
`reaction-diffusion`, `path-tracer-progressive` and `fluid-2d` keep their buffers resident
between calls (as `host-resident` does).

#### The deferred list

These examples need a vertex entry, a render pass or a texture. Each waits for 0138 milestone 5
and is written after M6. A1 does not add them to the front matter.

- Meshes with a vertex buffer (a lit mesh, an instanced field of cubes).
- Shadow maps (a depth pass, then a lit pass).
- Deferred shading (a G-buffer of more than one target, then a lighting pass).
- Physically based shading on a mesh.
- Bloom and tone mapping as passes that read the image of an earlier pass.
- Particles drawn as points or sprites from a vertex entry.
- Reflections and water that render to a texture.

[proposal, agent] Each is a candidate for an inspired example. A later amendment names them id by id.

#### Milestone M7

M7 follows M3 and M4: it needs steps 12 and later, and the directory layout of the gallery (Q2 of
the approved text). It carries `Change: 0145`. One pull request holds the batch, or one pull
request holds each few examples. M7 shows a header of each new example to the owner before the
owner says "merge" (CLAUDE.md, Merging).

| Milestone | Content                                                                                                                                    | What it verifies                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M7        | The eight examples of the first batch in the inspired group. Each has a module, a `host.ts`, a `group` and a header that names its source. | `bun run gate:compile` with the new modules. Goldens baked and the diff read. Both halves on each source (`compile()` and the language service). Each `host.ts` run on the tiers it lists. A CPU-tier reference in plain JavaScript where the tier runs it (`_reference.ts` form). The header of each, and any reused part with its five facts, read in the pull request. `docs:impact`. |

#### Deviations and open items

- No deviation from the approved text is open. A1 adds to it and changes no sentence, except that
  "three groups" becomes "four groups" where the text counts them. The sentences are marked in the
  pull request.
- Closed: the first batch (A1-Q1) and the id `path-tracer-progressive` (A1-Q3), as the owner
  answered.

#### Owner's answers (2026-11-23)

- [decision, owner] A1-Q1: "이대로" (as it is). The first batch is the eight examples below. The
  question named `path-tracer-progressive` as the id for the clash, so the answer also settles
  A1-Q3.
- [decision, owner] A1-Q2: "예, 같은 형식" (yes, the same form). Each inspired example has a
  `host.ts` of the path's form.
- [decision, owner] A1-Q4: "예, 같은 조건으로" (yes, under the same terms). A reused part may be
  code or an asset, under the same comment and license terms.
- [decision, owner] A1-Q5: "예, 검토 없이" (yes, with no review). The agent reads each source's
  license and lists the five facts (source, URL, revision, license, copyright line) in the pull
  request. The owner does not review the list before the merge. A source whose license is unclear
  is not reused.

#### Open questions for the owner (answered above)

1. **A1-Q1. Is the first batch right?** The eight examples are `three-body`, `bloom`,
   `tone-mapping`, `game-of-life`, `boids`, `reaction-diffusion`, `path-tracer-progressive` and
   `fluid-2d`. Recommended: yes. Each is written with forms the compiler has today, and the five
   that need a buffer target all three tiers too (OD-11).
2. **A1-Q2. Does an inspired example need a `host.ts` in the form of the path?** Recommended: yes,
   the same form as the path (`run(canvas)` or `run()`, and an optional `animate(canvas)`). The
   reader and the check harness then read one host of one form.
3. **A1-Q3. The id `path-tracer` is taken. Which id does the new example use?** Recommended:
   `path-tracer-progressive`, so that `examples/gallery/path-tracer/path-tracer.shade.ts` keeps its id (OD-6 allows a
   rename, but nothing needs it).
4. **A1-Q4. May a reused part be an asset as well as code?** The owner's third statement says
   "사용하도록" without naming either. Recommended: yes, for both, under the same comment and the
   same license terms. The first batch reuses nothing, so the question has no effect on M7 now.
5. **A1-Q5. Does the owner want to read each source's license, or does the agent decide?**
   Recommended: the agent reads it and lists the five facts in the pull request. The owner reviews
   the list. A source whose license is unclear is not reused.

#### What A1 touches

- `examples`: the eight ids are added. [fact] `scripts/changes.ts` reads the ids of the front
  matter against the tree, so M7 must add the files for each.
- `NOTICE`: changes only if M7 reuses an Apache-2.0 part. The first batch reuses none.
- `examples/README.md`: its licensing note is amended to name the group and the rule (M7).
- Docs that count the groups: this text (the sentences marked above). `bun run docs:impact`
  lists the rest at M7.
- `downstream`: the site shows four groups, not three. The site needs one more group heading and
  a blurb in each locale for each shown id. The editor skill's example list names the group.
  [fact] The front matter `downstream` lines say "three groups" and are amended in this text.

### A2. The gallery (milestone M4) designed from scratch (2026-11-23, status: accepted)

- Status: accepted. [decision, owner, 2026-11-23] The owner answered O1 to O6 in the conversation,
  in a question form the agent showed (Owner's answers to the options, below). O7 was not asked
  and stands as written. A2 is part of the approved text from the merge of its pull request
  (#1443). No code and no example changes with this pull request.
- Baseline: `main` at `360b35d6`. M1, M2 and M3 are delivered there (`examples/path/` holds steps 1
  to 8, 12 to 15 and 17).
- A2 replaces the old text of M4, of Q2 and of Q7. It keeps the path, M1 to M3, A1 and every other
  sentence of the approved text (Supersession, below).
- A2 adds no rule, no author-facing name, no diagnostic code and no export. `rules`, `surface`,
  `exports`, `exports-removed`, `codes` and `names` stay empty. [proposal] The front matter
  `examples` does not change.

#### Why A2 exists

A planning pass for M4 read the gallery at `360b35d6` and found four things. Each is a fact, read
with the command named.

1. 81 of the 102 files `examples/*.shade.ts` have a `@vertex` entry (`grep -l "@vertex"`). The
   other 21 hold a `@compute` entry or a kernel function. No file holds a fragment entry alone.
2. Each of the 81 vertex stages reads the `vertex_index` builtin (`grep -l vertex_index`). [inference]
   Each draws without a vertex buffer. The fragment entry of each reads a vertex output, so Rule 8.24
   does not make it callable (Rule 8.20: a vertex entry is not callable yet; the host view declares
   such a fragment `never`, `src/compiler/ts/host-face-shared.ts`). Under Q7 these modules get no `host.ts`.
3. The text of this proposal names two layouts. The table of What it touches says
   `examples/gallery/`. Q2 says `examples/<group>/<id>/`.
4. Three host examples lose what they show under one `run()`. `host-program` shows the program
   runtime (`runtime()`, `rt.load`, `rt.frame`). `host-compute` shows `runSpecialized`, which returns a
   `FuseReport`. `loop-fuse` shows the fuse reports. A plain-JavaScript reference for every gallery
   example is not practical, for example for the path tracer.

The owner was asked four questions on 2026-11-23. Each answer is a decision about the direction.
Each is quoted in Korean as said, with its English translation:

- [decision, owner, 2026-11-23] O2, the 81 modules with no `host.ts`: "그냥 처음부터 다시".
  English: just start over.
- [decision, owner, 2026-11-23] O1, the layout: "제대로 확장 가능하게 처음부터 다시".
  English: start over properly, so that it can grow.
- [decision, owner, 2026-11-23] O4, the three special hosts: "제대로 처음부터 다시".
  English: start over properly.
- [decision, owner, 2026-11-23] O5, the verification: "제대로 처음부터 다시".
  English: start over properly.

The owner's words are decisions about the direction. They are not an approval of this text.

#### Goal

After A2 is implemented:

1. Every example of the gallery is runnable by a host, in the same form as the path.
2. The layout holds hundreds of examples and new groups. A new example or a new group needs no
   change to a TypeScript file of the registry.
3. A special demonstration keeps what it shows.
4. Every example has a check that needs no hand-written reference for that example.

Fact: today a host file exists for the 9 host examples and the 13 path steps. No other example
has one. A2 does not hold that the goal is met before 0138 milestone 5 (The draw dependency).
Until then the count of examples with `host: "pending"` states the gap, and the goal is a count to bring to zero.

#### The layout

Today five files carry order and metadata. [fact] `examples/_order.ts` (`CURATED_ORDER`, 36 builder
ids), `examples/hosts/_order.ts` (`HOST_ORDER`, 9 ids and tiers), `examples/path/_order.ts`
(`PATH_ORDER`, 13 entries with part, step and tiers), the `@example` header block of each
`.shade.ts` (title, blurb, `renderable`, `reason`, `twinOf`, `passes`) and the builder object of
each `examples/*.ts`. [fact] `examples/index.ts` names scripts/gen-example-registry.ts, which is not
in the tree (deviation D-3). Two scripts, `examples/hosts/_registry.ts` and `examples/path/_registry.ts`, write
the other two indexes.

[proposal] The new layout:

```text
examples/
  groups.json                      the groups, as data
  path/<id>/<id>.shade.ts          the path: module unchanged (M1 to M3)
  path/<id>/example.json           the manifest (added by M4.2)
  path/<id>/host.ts
  path/_order.ts                   ids in reading order, nothing else
  gallery/<id>/<id>.shade.ts       every other module, one directory each, no `@example` block
  gallery/<id>/example.json        the manifest of the example
  gallery/<id>/host.ts             the host, when `host` is "run"
  gallery/<id>/check.ts            optional: the assertion of a special demonstration
  gallery/<id>/<support>.shade.ts  a support module of this example (no `example.json`)
  *.ts                             the 36 builder examples stay as they are (Q5)
  index.ts                         generated by scripts/gen-example-registry.ts
```

1. **One directory for each example.** The directory name is the id. The module is `<id>.shade.ts`.
   A test fails when the two disagree. The directory holds one `example.json` beside the module. The nine hosts, the 93 other `.shade.ts` examples and the 3
   support modules move under `examples/gallery/`. A support module moves into the directory of the
   example that imports it (`noise.shade.ts` of `examples/lib/` to `imported-noise`, `blur-x.shade.ts` of `examples/passes/` to `separable-blur`, and
   `trail.shade.ts` to `feedback-trail`, as 0145 says each is imported by one example).
2. **The manifest is a separate `example.json` in each example directory.** [decision, owner, O2]
   [fact] Today the `@example` block of a module holds its hand-written metadata
   (`examples/_shade.ts`, decision #65: two branches that add two examples touch two new files and no
   shared line). [proposal] A directory keeps that property: a new example is a new directory with
   a new `example.json`, and no shared line changes. The file is plain JSON. A test rejects an
   unknown field. The module holds no `@example` block (Registry, item 4). The fields:

   | Field          | Meaning                                                                                              |
   | -------------- | ---------------------------------------------------------------------------------------------------- |
   | `title`        | The English title. Required. It moves from the old `@example` block.                                 |
   | `blurb`        | The English blurb. Required. It moves from the old `@example` block.                                 |
   | `group`        | One id from `groups.json`. Required.                                                                 |
   | `tags`         | Free words for search and filter. Optional.                                                          |
   | `tiers`        | The tiers the host's `run()` passes on. Default: `webgpu`, `webgl2`, `cpu`.                          |
   | `tierNotes`    | One line for each tier that `tiers` omits. It cites a Rule or says "not supported yet" (OD-11).      |
   | `host`         | `"run"` (a `host.ts` exists), `"pending"` (waits for a named dependency), or `"none"` with a reason. |
   | `waitsFor`     | With `host: "pending"`: the proposal and milestone that deliver the missing form.                    |
   | `extras`       | Names of other exports of `host.ts` that the Playground lists (The host form).                       |
   | `demonstrates` | For a special demonstration: one sentence on what the extra output shows.                            |

   `renderable`, `reason`, `twinOf` and `passes` keep their meaning and move from the old block into
   `example.json`. The id is the directory name, so the file has no `id`. The module has no
   `@example` block after M4.3, so the shader file holds only the program.

3. **Groups are data, not directories.** examples/groups.json lists each group: its id, its English
   title, its order and one line on the assignment rule. The four groups of the approved text
   (works, high precision, feature examples, inspired) are its first four lines. A new group is one
   new line and one line in each locale of the site. The reasons for data over directories:
   an example can carry tags besides its group; a move between groups edits one field and moves
   no file; and the directory stays one level deep for any number of groups. The cost: the tree
   does not show the group.
4. **One generated registry.** scripts/gen-example-registry.ts is written (this closes D-3). It reads
   `groups.json`, `path/_order.ts` and each `example.json`, and writes `examples/index.ts`. The text of each
   `host.ts` and module is written into the index at authoring time, as `examples/path/_registry.ts` does today, so the index stays
   browser-safe. A drift test fails when the checked-in index differs from a fresh render, when a
   directory has no `example.json`, when a manifest names a group that `groups.json` lacks, and when a
   listed id has no directory.

   What happens to the `@example` header. [proposal, agent] Recommended: `title` and `blurb` live
   only in `example.json`, and M4.3 removes the header from each module as it moves the file. One
   fact then has one home, the generator reads one kind of source, and a module is only the
   program. The cost: a reader who opens the `.shade.ts` alone does not see the title and the
   blurb, and each moved module changes by its first lines. The alternative is to keep the header
   for single-file readers. That keeps two copies of `title` and `blurb`, and a drift test must
   hold them equal. A2 does not take it. Until a module moves, the scan reads its header, and
   after it moves the scan reads `example.json`.

5. **What the registry replaces.**

   | Today                                                       | After A2                                                                                                                                                |
   | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `examples/_order.ts`, `CURATED_ORDER`                       | Deleted. The builder example's literal gains `group` and `tags`. Order inside a group is the id, then `rank`.                                           |
   | `examples/hosts/_order.ts`, `HOST_ORDER`                    | Deleted. `tiers` and `tierNotes` move into each `example.json`. The notes of the file become `tierNotes` text.                                          |
   | `examples/path/_order.ts`, `PATH_ORDER`                     | Keeps the ids in reading order. `part`, `step` and `tiers` move into each `example.json`. A test checks `step` rises.                                   |
   | `examples/hosts/_registry.ts`, `examples/path/_registry.ts` | Deleted. scripts/gen-example-registry.ts writes all of it.                                                                                              |
   | the missing scripts/gen-example-registry.ts (D-3)           | Written.                                                                                                                                                |
   | `examples/hosts/_drive.ts`, `examples/path/_drive.ts`       | One driver reads the registry (Verification).                                                                                                           |
   | `examples/hosts/index.ts`, `examples/path/index.ts`         | Folded into `examples/index.ts`. The names `hostExamples` and `pathExamples` stay exported until the site pin moves (OD-6: no warning release is owed). |

   The path keeps its own ordered list because a reader's progress is editorial. The gallery has no
   list: its order is data in the manifests, and a new example touches no shared line.

6. **The builder examples.** [fact] The 36 files `examples/*.ts` keep the surface of Q5. [proposal]
   No new example is written in that form. A new example is a directory of `"use typeshade"`
   source (OD-1).
7. **How the site reads it.** [proposal] The site reads `examples/index.ts` at build time, as today.
   It builds its group headings from `groups.json` and the localized titles from its own i18n by
   group id. A group id with no i18n line fails the site build, so a new group cannot go unnamed. The typed
   record `cartographic | generic | compute` goes (M5). [fact] The site repository is not read here.

Cost of the layout. The move touches about 127 files and adds one `example.json` for each
example directory. Each emit golden is named by id, so no golden
name changes (`examples/__emit-goldens__/`). Each test that names a path under `examples/` changes.

#### The draw dependency

[fact] 0138, R5 (`changes/0138-host-nodes-and-graphs.md`): "Inside a graph or outside it,
`fs(vs(vertices))` draws". The result is a texture of the fragment's output type. The vertex call takes
`{ count, instances, indices, topology }`. With a `Buffer<T>` argument and no `count`, it draws
one vertex for each element. R6 puts an image on a canvas with `show(image, canvas)`.

[fact] 0138 milestone 5 is "Rendering. R5, R6 and R11: compositions, texture outputs, render-state
options, `show`, class parameters as uniforms". Its open questions are Q3, Q5 and Q15, which the owner
settles before it starts (0138, Approval and plan record). Amendment A9 moved slice 2c, with `show`, to
milestone 5. [fact] No module of `src/` exports `show`. 0138 A19 lists slices 4 to 6 of milestone 4 as not started, and
no amendment records milestone 5 as started.

[fact] R5 says nothing on whether the CPU tier draws a vertex entry. The program runtime has no CPU tier
(`examples/hosts/_order.ts`, the note on `host-program`). [inference] A vertex example then runs on WebGPU and
WebGL2 first. The CPU tier is "not supported yet" there, and OD-11 and OD-9 ask that it be recorded as open work.

[inference] 81 of 102 modules draw with an index-only vertex stage. The draw form that the gallery
needs at least is: draw a vertex entry with a count and no vertex data, run its fragment entry on the
result, and put the image on a canvas. R5 and R6 cover it. R11 (class parameters as uniforms),
instancing and render state are not needed for the gallery's first batches.

Options for the dependency. The owner chooses (Options, O3).

- **D-a. The draw part of M4 waits for 0138 milestone 5.** The layout, the manifest, the registry, the
  verification and the hosts of the 21 callable modules and the 3 special hosts go first. The 81 draw
  modules carry `host: "pending"` and `waitsFor: "0138 milestone 5"`.
- **D-b. A minimum draw form comes first.** A2 only names the need. A compiler and runtime feature
  needs its own accepted proposal (`changes/README.md`). The candidate is an amendment of 0138 that
  carries a slice "5a" out of milestone 5: R5 for a vertex call with `count` and no vertex data, R6's
  `show` into a canvas, and the answers to Q5 and Q15. A2 does not draft that amendment.
- **D-c. A hand-written program-runtime `host.ts` for each of the 81.** This is Q7's rejected
  alternative. Each file breaks host form item 1, has no CPU tier, and is rewritten when R5 lands.

Until the form exists, a `pending` module is shown with its module and its emit, and the gallery says
what it waits for. This follows OD-9: a form the compiler does not implement yet is "not supported yet".
It is not a decision that the module needs no host.

[proposal] A module with no callable export and no draw (for example `hello-camera`, whose only export reads a
binding) gets `host: "none"` and a reason. M4.1 measures how many modules this applies to. [fact] The
count is not known today.

#### The host form for the gallery

The form of the approved text stays: the file imports its module, holds no pipeline code and
has a one-to-three-line leading comment. A2 completes it where D-6 left a gap.

1. `run` takes the target first: `run(canvas, options?)` for a drawing example and `run(inputs?)`
   for a compute example. Every parameter has a default, so the harness calls `run()` or `run(canvas)`.
2. `run` resolves to a **result**: `void`, or a plain object of host values (numbers, typed arrays,
   nested objects). A fuse report or a specialization is such a value (`FuseReport`). This closes D-6:
   steps 12 to 15 already return an array or a number.
3. A result may carry `image`, `{ width, height, rgba }`, for an example that cannot draw into a canvas
   yet. The Playground shows it as a picture. [proposal] This is a convention of the Playground and the harness. It adds no name to the language.
4. A host file may export **extras**: named functions with the call form of `run`, listed in the
   manifest `extras`. The Playground shows one button for each. The harness runs each extra too, so no
   extra goes unchecked.
5. An example that must assert more than a comparison (a report's group count, for instance) adds
   `check.ts`. It exports `check(result, tier)` and throws on a failure. The harness reads it. The
   Playground and the reader do not. The `host.ts` stays the reader's file.

How the three special hosts fit:

| Host           | `run()`                                                                       | Extras and `check.ts`                                                                                                      | What it keeps                                               |
| -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `host-program` | Draws on the program runtime, returns `{ image }` (the pixels it reads back). | None. `waitsFor: "0138 milestone 5"` for the form that replaces `runtime()`; the example stays in the old form until then. | The program runtime: `runtime()`, `rt.load`, `rt.frame`.    |
| `host-compute` | Returns `{ values }` of the scale call.                                       | Extra `runSpecialized`, returning `{ direct, values, report }`. `check.ts` asserts the report's shape on each tier.        | Constants and a workgroup size chosen per call; the report. |
| `loop-fuse`    | Returns `{ chain, split, reduce }`, each with its `report`. Today's shape.    | `check.ts` asserts the group count of each scope on WebGPU, and that each call runs apart on the CPU tier.                 | The fuse reports, the dispatch counts.                      |

[fact] `loop-fuse` already returns reports from `run`. Only `examples/hosts/_drive.ts` reduces them to numbers.
[inference] The form is therefore a name for what the three hosts do, not a new shape.

#### Verification without a reference for each example

[fact] Checks that exist today: both halves on each `.shade.ts` (`examples/shade-examples.test.ts`),
the emit goldens (`examples/__emit-goldens__/`, 423 files), the compile gate on Tint and ANGLE
(`scripts/compile-gate.ts`), and the entry-call leg of the gate, which calls each exported compute entry and
full-screen fragment entry on every tier and compares the results (`scripts/entry-calls.ts`). The
path adds a plain-JavaScript reference for each step (`examples/path/_reference.ts`).

[proposal] The gallery rests on these checks. None needs a reference written for one example.

| Check                                                                                                                                                                                                                                                   | Where it runs                                                          | Needs a GPU                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| C1. Both halves on every manifest and module: `compile()` and the language service agree, and the `example.json` of each example passes its schema (`bothTake`). Generated from the registry.                                                           | `vitest`, job `typecheck + unit`.                                      | No.                                                              |
| C2. Emit goldens for every module, by id.                                                                                                                                                                                                               | `vitest`, job `typecheck + unit`.                                      | No.                                                              |
| C3. Compile gate: each module on Tint and ANGLE.                                                                                                                                                                                                        | `bun run gate:compile`, job `compile gate (Tint + WebGL2)`.            | A browser; no hardware GPU named.                                |
| C4. CPU `run()`: each `host: "run"` example runs on the CPU tier, twice. The two results are equal, all numbers are finite, and `check.ts` passes where it exists.                                                                                      | `vitest`, job `typecheck + unit`.                                      | No.                                                              |
| C5. CPU against the oracle: the CPU `run()` is held to the CPU f64 oracle of the same IR (`AGENTS.md`), within the tolerance that the determinism report states for the operations it lists.                                                            | `vitest`, job `typecheck + unit`.                                      | No.                                                              |
| C6. Cross-tier: each `run()` on WebGPU and on WebGL2 is held to the CPU result, with the same tolerance. A tier that `tiers` lists must pass. A tier that `tiers` omits must fail with the refusal that `tierNotes` names (as `HOST_ORDER` does today). | `bun run gate:journeys`, job `user journeys (packed tarball, WebGPU)`. | Yes: WebGPU in the job. A local run needs a browser with WebGPU. |
| C7. The entry-call leg of C3 stays for every compute and full-screen fragment entry, on every tier.                                                                                                                                                     | `bun run gate:compile`, job `compile gate (Tint + WebGL2)`.            | A browser.                                                       |

Notes.

- [fact] C5 is possible, checked by M4.6. The oracle is not called through a host `run()`: the
  check computes the expected pixels or values from the `f64` oracle with the bindings the host
  passes, and holds the CPU `run()` to them. It covers the path steps that list `cpu` and
  `host-draw`. The CPU tier runs the generated JavaScript twin of the oracle in `f32`, so C5 finds a
  wrong call layer and `f32` drift, and does not find an error that both share. The tolerance is exact
  where the determinism report of the module lists no operation, and the `PIXEL` and `RELATIVE`
  allowances of `examples/path/_reference.ts` otherwise: the report states its bounds in words, not numbers.
- [inference] C6 compares a GPU tier to the CPU tier. A bug that all three tiers share is not found
  by C6. The path keeps its plain-JavaScript references for this reason, and the gallery has none
  (owner's answer O5). A shared bug is the work of C5 and of the gate's differential legs (`bun run gate:differential`).
- [proposal] A reference stays optional. An example whose result is simple may add `reference.ts` and
  join C6's comparison. No example needs one.
- A digest golden of each CPU result is left out. C2 and C6 already hold the emit and the tiers.
- The path is unchanged. Its references, drives and `examples/path-examples.test.ts` stay.
- Not run: nothing in this list runs yet. A2 is a design. Each slice records the checks it ran.

#### One example before and after

CLAUDE.md asks for one example before and after for a change to how an author writes an example. [fact]
The gallery has no lit cube. The deferred list of A1 names meshes as waiting for 0138 milestone 5.
The example is `hello-vsout`, which has the shape that 81 modules share: a fragment entry that reads
a vertex output.

**Before.** One file, `hello-vsout.shade.ts` in `examples/` (37 lines). It has no group, no host and no
tier list. Its header holds `title`, `blurb` and `"renderable": true`. A reader cannot run it.

```ts
"use typeshade";

/* @example
{
  "title": "Hello varyings",
  "blurb": "The triangle again, now carrying a `uv` varying ...",
  "renderable": true
}
*/

interface VsOut { pos: builtin<"position">; uv: vec2; }
interface Color { color: vec4; }

@vertex
export function vs(i: builtin<"vertex_index">): VsOut { /* three corners, with uv */ }

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv.x, v.uv.y, 0.2, 1) };
}
```

**After, now (M4.1 to M4.5).** The directory is `examples/gallery/hello-vsout/`. The shader body is
byte for byte the same. The `@example` header block is gone from `hello-vsout.shade.ts`, and the
manifest is the file examples/gallery/hello-vsout/example.json:

```json
{
  "title": "Hello varyings",
  "blurb": "The triangle again, now carrying a `uv` varying ...",
  "group": "feature",
  "tags": ["varyings", "vertex-stage"],
  "renderable": true,
  "host": "pending",
  "waitsFor": "0138 milestone 5"
}
```

The gallery page shows the module and its emit, and says what the example waits for. C1 to C3 run on it.

**After, once 0138 milestone 5 delivers a draw (M4.10).** The directory gains `host.ts`. [illustrative]
The spelling of an index-only draw is open until milestone 5. The file below shows the form, not the final call.

```ts
// A vertex stage hands a `uv` varying to the fragment stage.
import { fs, vs } from './hello-vsout.shade.ts';
import { show } from 'typeshade/runtime';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  show(fs(vs(undefined, { count: 3 })), canvas);
}
```

And `example.json` says `"host": "run"` with `tiers: ["webgpu", "webgl2"]` and a `tierNotes.cpu` of
"not supported yet: the CPU tier draws no vertex entry". C4 to C6 then run on it.

What the author writes: one `example.json` with a group beside the shader, and one host of one call. What the author does
not write: a pipeline, a bind group, a reference for the example, an entry in a shared list.

#### Slices

Each slice is one pull request that a Sonnet sub-agent can finish in about 30 minutes. `main` is green
after each. Each says `Change: 0145`. Marks: **owner** means the pull request changes how an author writes an
example (CLAUDE.md, Merging) and waits for the owner's "merge", with the before and after in the body.
**pre-approved** means a move, a generator, a check or a rewrite of a harness, and
merges on green checks under the rule for an accepted proposal. [fact] A2 is `accepted` from the merge of
PR #1443: no slice starts before that merge.

| Slice | Content                                                                                                                                                                                                                                                                                                             | Mark                                        | Depends on          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------- |
| M4.1  | Write scripts/gen-example-registry.ts (closes D-3). It writes the three current indexes byte for byte as now. A drift test. Measure the modules with no callable export and no draw.                                                                                                                                | pre-approved                                | none                |
| M4.2  | The `example.json` schema and its test; `groups.json`; the scan reads `example.json` where a directory has one, and the header otherwise. The 13 path steps get an `example.json` that holds the old header fields and moves `part`, `step` and `tiers` from `PATH_ORDER`; their headers go.                        | owner                                       | M4.1                |
| M4.3  | Move the `.shade.ts` files under `examples/gallery/<id>/`, by first letter, in two or three pull requests. Each move writes the `example.json` of the module from its header (`title`, `blurb`, `renderable`, `reason`, `twinOf`, `passes`) and removes the header. The scan reads both places until the last move. | owner                                       | M4.2                |
| M4.4  | The group table: `group` and `tags` in every `example.json` and builder literal; delete `CURATED_ORDER`. The owner reviews the table here (Q3).                                                                                                                                                                     | owner                                       | M4.3                |
| M4.5  | Move the 3 support modules and the 23 twins' links into the directories. Delete `examples/lib/` and `examples/passes/`. `examples/README.md` and `examples/PORTING.md` rewritten.                                                                                                                                   | pre-approved                                | M4.3                |
| M4.6  | One driver reads the registry. C4, C5 and the shared compare helper. The CPU suite runs every `host: "run"` example. Check whether C5 is possible.                                                                                                                                                                  | pre-approved                                | M4.2                |
| M4.7  | `host.ts` for the callable compute and kernel modules, in batches of about five (the 21 modules, less those that M4.1 marks `none`). One batch of the form first.                                                                                                                                                   | owner (first batch), then green checks (O6) | M4.4, M4.6          |
| M4.8  | The three special hosts in the form: `host-compute` extras and `check.ts`, `loop-fuse` `check.ts`, `host-program` `{ image }`. Remove `draw` and `runSpecialized` as exports.                                                                                                                                       | owner                                       | M4.6                |
| M4.9  | `scripts/user-journey.ts` reads the registry. C6 for every `host: "run"` entry. `HOST_ORDER` has no reader and goes.                                                                                                                                                                                                | pre-approved                                | M4.7, M4.8          |
| M4.10 | After 0138 milestone 5: `host.ts` for the `pending` draw modules, in about 14 batches of six. The first batch shows the form.                                                                                                                                                                                       | owner (first batch), then green checks (O6) | the draw dependency |

[inference] M4.1, M4.5, M4.6 and M4.9 change no example's text for a reader. M4.2, M4.3, M4.4, M4.7, M4.8
and M4.10 change what an author writes. [fact] M4.2 and M4.3 add the `example.json` files, so an
author writes an `example.json` beside the shader from M4.2 on. These two slices, and M4.4, wait
for the owner's "merge", with the before and after of the example in the body.

A1's milestone M7 now follows M4.4 and M4.7. An inspired example is a directory of
`examples/gallery/` with `"group": "inspired"`. A1-Q2 holds: it has a `host.ts` of this form.

#### Supersession

A2 supersedes these sentences of the approved text. It records each as a deviation of the approved
text, made part of it by this amendment.

- The M4 row of the milestone table, and the M4 line of the Approval and plan record.
- Rules 1 to 3 of "What `has a host.ts` means in the gallery": a module with no callable export gets no
  `host.ts` (Q7). A2 replaces them with `host: "run" | "pending" | "none"`. Rules 4 to 6 stay.
- Q2, the layout `examples/<group>/<id>/`, and the table row `examples/gallery/` (Q2): the layout is
  `examples/gallery/<id>/` with the group in the manifest.
- Q7, the recommended answer: "show the module with no `host.ts`". A `pending` module is shown the same way, but only until its draw form exists.
- The rows of What it touches that say `_order.ts`, `index.ts` and `examples/hosts/_order.ts` "split in
  two", and `_drive.ts` and `_reference.ts` "rewritten by M4" for the gallery. The path keeps its pair.
- The list in "What the change removes": `CURATED_ORDER` is removed, not split. `HOST_ORDER` is removed. `draw` and
  `runSpecialized` go as the text says.
- The `group` header field "beside `title` and `blurb`": `group` moves into `example.json` with `title`,
  `blurb` and the new fields of this amendment. The `@example` header block leaves the modules (M4.3).
- The host form: item 2 gains the result, `image`, extras and `check.ts`.

Stays: the learning path and its table, M1, M2, M3, M5, M6, A1, the host form items 1, 3 to 6, the
tiers of the path, the Q1, Q3 to Q6 answers, and the owner's decisions listed under Owner's decisions.
Deviations: D-3 closes with M4.1. D-6 closes with the host form above. D-1, D-4, D-5 and D-7 are
unchanged.

#### The owner's decisions that A2 rests on

A2 reverses no entry of `docs/owner-decisions.md`.

- **OD-3.** The manifest holds what the compiler cannot know: group, tags, tiers. No construct is added.
  The registry is a script, not a language form.
- **OD-4.** This text shows one example before and after, and the options with their costs.
- **OD-6.** Nothing is released. The names `hostExamples` and `pathExamples` may go with no warning release. The site pin moves in M5.
- **OD-9.** A `pending` module waits for a form the compiler does not implement yet. The text says so and refuses nothing.
- **OD-11.** `tierNotes` never says that a tier cannot run a program because WebGL2 or the CPU lacks a feature. It cites a Rule
  or says "not supported yet". The draw modules list `webgl2` with `webgpu`, and the CPU tier is recorded as open work.
- **OD-1, OD-2, OD-5, OD-7.** No example changes its source. Each entry keeps `@vertex`, `@fragment` or `@compute`.

#### Options for the owner (closed: answered above)

Each option had a recommendation. The owner answered each one (Owner's answers to the options). The
lines below stay as the owner saw them, and each option ends with its answer.

1. **O1. The layout.**
   - (a) `examples/path/<id>/` and `examples/gallery/<id>/`, groups in `groups.json`.
   - (b) One flat `examples/<id>/` for path and gallery, with a `collection` field. Simpler tree. The path would move, and
     the infrastructure files of `examples/` would sit beside hundreds of directories.
   - (c) `examples/gallery/<group>/<id>/`. The tree shows the group. A group change moves files, and an example has one group only.
   - Recommended: (a). It keeps the delivered path, and a group is a field (OD-3: no new construct; the O1 answer asked for growth).
   - **Answered: (a).**
2. **O2. Where the manifest lives.**
   - (a) The extended `@example` block of the module.
   - (b) A separate `example.json` in each directory. It adds a file for each example, and `title` and `blurb` need a move.
   - Recommended: (a). The block is the manifest today, and it leaves with the module (`examples/_shade.ts`, #65).
   - **Answered: (b), not the recommended one.** A separate `example.json`.
3. **O3. The draw dependency.** D-a, D-b or D-c (The draw dependency).
   - Recommended: D-a, with M4.1 to M4.9 now. D-c spends work on a form that R5 replaces (Q6, option (b), made the same
     choice for the path's part 3). D-b needs an amendment of 0138, which is a decision for the owner on milestone 5's Q3, Q5 and Q15.
     The owner may ask for D-b if 81 pending modules are too long a gap.
   - **Answered: D-a.** The 81 draw modules carry `host: "pending"` until 0138 milestone 5.
4. **O4. The special demonstrations.**
   - (a) One `run()` that returns a result, extras, and an optional `check.ts` (The host form).
   - (b) Split each special demonstration into its own example id (`host-compute-specialized`, and so on), each with a plain `run()`.
   - Recommended: (a). `loop-fuse` already returns reports, and one module carries both calls of `host-compute`. (b) adds ids to the registry and the site.
   - **Answered: (a).**
5. **O5. The verification.**
   - (a) C1 to C7, no reference for a gallery example.
   - (b) (a), and every gallery example also needs a plain-JavaScript reference, as the path does.
   - (c) (a), and a digest golden of each CPU result.
   - Recommended: (a). (b) is the cost the owner's answer O5 refused (the path tracer). (c) adds a golden to bake for
     little that C2 and C6 do not hold.
   - **Answered: (a).** C1 to C7, no reference for a gallery example.
6. **O6. How the owner merges the batches of M4.7 and M4.10.** Each batch adds `host.ts` files, which change what an author reads.
   - (a) The owner says "merge" for each batch.
   - (b) The owner says "merge" for the first batch of each kind and for the group table. Later batches of the same form merge on green
     checks, and the agent reports each merge.
   - Recommended: (b). The form is reviewed once. CLAUDE.md (Merging) makes the owner's word the approval, so this is the owner's choice.
   - **Answered: (b).** The owner merges the first batch and the group table. Later batches merge on green checks.
7. **O7. The group table (Q3).** M4.4 writes it. [proposal] The owner reviews the table in that pull request, as Q3 says.
   Nothing to decide here now.
   - **Not asked.** It stands as written: the owner reviews the table in the M4.4 pull request.

#### Owner's answers to the options (2026-11-23)

The owner answered in a question form that the agent showed. Each answer is quoted in Korean as
said, with an English gloss.

- [decision, owner] O1, layout: "path와 gallery, 그룹은 데이터" (English: path and gallery, groups
  as data). Option (a): `examples/path/<id>/` and `examples/gallery/<id>/`, groups in `groups.json`.
- [decision, owner] O2, manifest: "별도 example.json" (English: a separate example.json). Option
  (b), not the recommended one. Each example directory holds an `example.json` that carries `title`,
  `blurb`, `group`, `tags`, `tiers`, `tierNotes`, `host`, `waitsFor`, `extras` and `demonstrates`,
  and the old `renderable`, `reason`, `twinOf` and `passes`. The shader file holds no manifest.
- [decision, owner] O3, draw dependency: "0138 M5 기다리기" (English: wait for 0138 M5). Option D-a.
  The 81 vertex-and-fragment modules carry `host: "pending"` until 0138 milestone 5.
- [decision, owner] O4, special hosts: "run() + extras" (English: `run()` plus extras). Option (a).
- [decision, owner] O5, verification: "C1~C7" (English: C1 to C7). Option (a).
- [decision, owner] O6, merge policy for host batches: "첫 묶음만 소유자 병합" (English: only the
  first batch is merged by the owner). Option (b). The owner merges the first batch and the group
  table. Later batches merge on green checks.
- O7, the group table reviewed in M4.4: not asked. It stands as written.

#### Changes after the owner's answers

O2 chose a separate `example.json`. The text above was revised to match. Each forced change:

1. The layout tree and item 1 of The layout: each directory gains `example.json`. A support module has none.
2. Item 2 of The layout: the manifest is `example.json`, not the extended `@example` block. `title` and
   `blurb` are listed as fields. `renderable`, `reason`, `twinOf` and `passes` move into the file.
3. Item 4 of The layout: the generator reads each `example.json`. The drift test fails on a directory with no
   `example.json`. [proposal, agent] The `@example` header is removed in M4.3, and `title` and `blurb` live only in `example.json`.
4. Item 5 and the cost line: the moved fields go into each `example.json`.
5. C1: it checks the schema of each `example.json`. No check reads the header.
6. The before and after example: the header block is gone, and `example.json` is shown.
7. The slices: M4.2 adds the schema and the files of the path steps. M4.3 writes the files and removes the headers. M4.2, M4.3 and
   M4.4 are marked owner, so M4.3 changes from pre-approved to owner. M4.7 and M4.10 are owner for the first batch (O6).
8. Supersession and What A2 touches: the `group` field moves to `example.json`, and `examples/_shade.ts` is named.
9. A1 is not edited. Its illustrative `@example` block shows the fields of an inspired example. After M4.3 those fields are in its `example.json`.
10. Status: draft becomes accepted. The options list is closed.

#### Open items

| Item                                                                                                                   | Reason                                                 | Next action                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| The count of modules with no callable export and no draw (`host: "none"`).                                             | Not measured. `hello-camera` is one.                   | M4.1 measures it.                                |
| Whether the CPU f64 oracle can be called through a host `run()` (C5).                                                  | Not verified.                                          | M4.6 checks it.                                  |
| Whether the CPU tier draws a vertex entry.                                                                             | R5 is silent. No CPU tier in the program runtime.      | Ask at milestone 5; record as open work (OD-11). |
| The spelling of an index-only draw, and `show` into a canvas.                                                          | 0138 milestone 5 and its Q5 and Q15.                   | The owner decides at milestone 5.                |
| The site: groups from `groups.json`, the typed record, the blurbs, the Playground reading `image`, extras and `tiers`. | The site repository is not read here.                  | M5, after the compiler pin.                      |
| Whether later pull requests of M4.3 (the same form, after the first) merge on green checks.                            | O6 names host batches only. M4.3 is marked owner.      | The owner says in the conversation.              |
| Tolerance of C6 for each example.                                                                                      | The determinism report gives it; not read per example. | M4.6.                                            |

#### What A2 touches

- `examples`: no id is added or removed. [fact] `scripts/changes.ts` must learn `examples/gallery/` before M4.3, as it learned `examples/path/` in M1 (`src/changes-path.test.ts`).
- `examples/_shade.ts` (the header parser; the scan reads `example.json` instead), `examples/` registry files, the scan, `examples/registry-drift.test.ts`, `examples/host-examples.test.ts`, `examples/examples.test.ts`,
  `scripts/user-journey.ts`, `scripts/compile-gate.ts` (its example set reads the registry), scripts/gen-example-registry.ts (new).
- Docs: `examples/README.md`, `examples/PORTING.md`, `AGENTS.md` (the example gates), `bun run docs:impact` lists the rest at each slice.
- `downstream`: the site reads `groups.json` and the manifest fields; the Playground runs `run` with `image`, extras and the tier list; the editor
  skill's example list names the layout. Nothing is verified in those repositories here.

### A3. The gallery move edits the paths in rules and surface sections (2026-11-23, status: accepted)

- Status: accepted. [decision, owner, 2026-11-24] The owner said "병합 승인 및 추천안으로" (merge
  approved, with the recommended answers). A3 is part of the approved text from the merge of its
  pull request (#1485). No code and no example changes with that pull request.
- Baseline: `main` at `9c47626a` for the scan. [fact] The M4.3a pull request (#1472, commit
  `d42218f6`) merged into `main` on 2026-11-23 as `d31bfbff`.
- A3 adds no author-facing name, no diagnostic code and no export. `exports`, `exports-removed`,
  `codes` and `names` stay empty. A3 edits no meaning of a rule or of a surface section.

#### Why A3 exists

1. [fact] M4.3a moved 30 modules, `a` to `h`, to `examples/gallery/<id>/`. It left 18 modules of
   `a` to `h` at the top level.
2. [fact] `docs/language-design.md` and `docs/use-typeshade-surface.md` name each of those 18 by
   its path, `examples/<id>.shade.ts`.
3. [fact] A2 declares no rule and no surface section. `bun run precommit` refuses an edit of
   those paths under `Change: 0145`.
4. [fact] The same holds for the modules `i` to `z`. Of the 54 of them, 23 are named by a rule or
   a section. M4.3c cannot move them without A3.
5. [fact] Four modules of `i` to `z` that no rule names cannot move under A2 either:
   `kernel-array-methods`, `kernel-image-invert`, `kernel-push` and `loop-struct-array`. Their
   `@example` header is most of each file. Git pairs the old module with the new `example.json`
   and reads the new module as an addition, so `scripts/changes.ts` counts the id as changed, and
   `bun run precommit` refuses it under `Change: 0145`.
6. [proposal] A3 declares the path edits and the four ids, so that M4.3c can move them.

#### What A3 declares

[fact] On `main` at `9c47626a`, 41 of the 102 top-level modules are named by a path in
`docs/language-design.md`, `docs/use-typeshade-surface.md` or `reqs/`. A reader repeats the scan
with `grep -n 'examples/[a-z0-9-]*\.shade\.ts'` on those three places. The table by id is not
copied here.

1. The edit is path-only. The text changes from `examples/<id>.shade.ts` to
   `examples/gallery/<id>/<id>.shade.ts`, and from nothing else.
2. No rule and no section changes its meaning. A reviewer checks this with `git diff --word-diff`:
   each hunk shows one path and no other word.
3. The edit reaches 17 rules: 4.3, 4.8, 6.9, 6.10, 7.5, 7.9, 7.10, 8.9, 8.10, 8.11, 8.12, 8.13,
   8.16, 8.17, 8.18, 8.19 and 8.25.
4. The edit reaches 27 surface sections: §3, §16, §17, §22, §26, §28, §30, §31, §32, §33, §34, §35,
   §36, §37, §39, §44, §45, §47, §48, §50, §51, §53, §54, §62, §66, §76 and §77.
5. The front matter `rules:` and `surface:` gain these lists. [fact] `scripts/changes.ts` reads
   the declared lists from proposals that are `accepted` or `implemented` on the base branch. It
   has no state for an amendment in draft. Proposal 0145 is `accepted`, so the lists count from
   the merge of this pull request.
6. The front matter `examples:` gains the four ids of item 5 of "Why A3 exists". The move
   changes no shader text of theirs. Each moves with its `@example` header turned into an
   `example.json`, as in M4.3a.
7. [proposal] The plan below keeps M4.3c after the owner's "merge" of A3. The tool does not
   enforce that order. The plan does.

Which ids reach which rule and which section, grouped by the plan slice:

| Slice | Modules named by a rule or a section                                                                                                                                                                                                                                                                                                                                                                                            | Count |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| M4.3c | `a` to `h`: `array-length`, `array-methods`, `block-scope`, `capsule-corp-namek-class`, `class-builder`, `class-parts`, `class-syntax`, `clip-planes`, `closures`, `compute-sync`, `cube-array-gather`, `cube-env`, `cutout`, `fp64-lane-stripes`, `generic-class`, `generic-helpers`, `gpu-console`, `higher-order`                                                                                                            | 18    |
| M4.3c | `i` to `z`: `id-pick`, `inferred-returns`, `integer-math`, `loops-over-data`, `msaa-resolve`, `normal-matrix`, `null-values`, `optional-fields`, `optional-values`, `orbit-inout`, `packed-bytes`, `packing-bitcast`, `particle-step`, `pick-composite`, `reference-parameters`, `rng-method`, `sample-branch`, `shadow-compare`, `storage-texture`, `subgroup-reduce`, `tuple-and-brand`, `uniform-array`, `workgroup-tile-2d` | 23    |

#### One line before and after

Rule 4.3, the `Enforced by` line, `docs/language-design.md` line 356.

Before:

```text
- Enforced by: `examples/gallery/tuple-and-brand/tuple-and-brand.shade.ts` on both halves of the gate.
```

After:

```text
- Enforced by: `examples/gallery/tuple-and-brand/tuple-and-brand.shade.ts` on both halves of the gate.
```

[fact] The rule text above that line does not change.

#### The reqs items

1. [fact] `reqs/rules/RULE-*.md` items carry the rule text and the paths that they reference.
   17 RULE items belong to the 17 rules above. A SURF item exists for 18 of the 27 sections:
   §3, §16, §17, §22, §26, §28, §31, §33, §39, §44, §50, §51, §53, §54, §62, §66, §76 and §77.
   The other nine sections (§30, §32, §34, §35, §36, §37, §45, §47 and §48) have no SURF item.
2. [procedure] After each M4.3c commit that edits one of these files:
   1. Run `bun run reqs:sync`.
   2. Read the items that it flags.
   3. Ask a person to run `doorstop review` for each changed RULE and SURF item.
3. [fact] An agent does not run `doorstop review` or `doorstop clear`. A person reads the item
   first, as `reqs/README.md` says.

#### The plan

1. M4.3a: 30 modules, `a` to `h`, in pull request #1472. It stays as it is. It left 18 modules
   (D-9, below).
2. M4.3b: 27 of the 31 modules `i` to `z` that no rule and no section names. No rule text
   changes. It does not wait for A3. It waits for the owner's "merge", as A2's slice table and
   CLAUDE.md (Merging) say for a change to how an author writes an example.
3. M4.3c: every module in the table above, 41 in all, and the four modules of item 5 of "Why A3
   exists". It waits for A3 to be accepted. It edits the 17 rules and 27 sections by path only.
   It carries the reqs steps above.
4. M4.4 and the slices after it do not change.

[fact] 18 + 23 = 41, and 30 + 18 = 48 modules of `a` to `h`. 27 + 4 + 23 = 54 modules of `i` to
`z`. [inference] After M4.3c no top-level
`*.shade.ts` stays, so the scan reads one place.

#### Deviations and open items

| Deviation                                                                                                                                                       | Disposition                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D-9. M4.3a left 18 modules of `a` to `h` at the top level, because rules and surface sections name them by path and A2 declares no rule and no surface section. | Made part of the approved text by A3 (accepted 2026-11-24). Closed when M4.3c moves them. |

| Item                                                    | Reason                                                 | Next action                                           |
| ------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| The doorstop review of each changed RULE and SURF item. | A person reads each item. An agent does not run it.    | A person runs it after `bun run reqs:sync`, in M4.3c. |
| The order "M4.3c after A3".                             | `scripts/changes.ts` does not enforce it (see item 5). | The plan keeps it. A reviewer checks it.              |
| Paths in other documents (`AGENTS.md`, `docs/*.md`).    | A3 names only the three places the scan covered.       | `bun run docs:impact` lists them at each slice.       |

#### Questions for the owner, answered

1. **A3-Q1. Does the owner accept a path-only edit of 17 rules and 27 surface sections?**
   Recommended: yes. No meaning changes, and a reviewer sees one path in each hunk.
   [decision, owner, 2026-11-24] Yes, with the recommended answer ("추천안으로").
2. **A3-Q2. Does the owner accept the four ids in `examples:`?** Recommended: yes. Each id is
   an example that already exists, and only its place and its header change.
   [decision, owner, 2026-11-24] Yes, with the recommended answer ("추천안으로").

#### What A3 touches

- `rules`: the 17 rules above. `surface`: the 27 sections above. [proposal] Both lists join the
  front matter.
- `docs/language-design.md`, `docs/use-typeshade-surface.md`: the paths, in M4.3c.
- `reqs/rules/`, `reqs/surface/`: the items that `bun run reqs:sync` changes, in M4.3c.
- `examples`: four ids join the list (item 6 of "What A3 declares"). No example is added to or
  removed from the tree.
- `downstream`: no change. The site and the editor read rule numbers, not these paths.

### A4. M4.8 scope: surface §67 and the special hosts (2026-11-24, status: accepted 2026-11-24, the owner answered A4-Q1 to A4-Q4 in the conversation)

- Status: accepted. [fact] The owner answered A4-Q1 to A4-Q4 on 2026-11-24. A4 is part of the approved text
  when its pull request is merged. No code and no example changes with that pull request.
- Baseline: `main` at `7af32059`. [fact] A first implementation of M4.8 is commit `78dbc51d` on branch
  `claude/0145-m4-8-special-hosts`. It is not pushed and not merged. M4.8 follows A4, not that commit.
- A4 adds no rule, no author-facing name, no diagnostic code and no export. `rules`, `exports`,
  `exports-removed`, `codes` and `names` do not change. `draw` and `runSpecialized` are exports of
  example files, not of the package: `src/__api__/surface.md` does not list them.

#### Why A4 exists

1. [fact] `docs/use-typeshade-surface.md` §67, line 10090 on the baseline, says:
   "`examples/hosts/host-compute/host.ts` contains the complete default, direct-specialized and
   device-plan runs."
2. [fact] M4.8 moves the direct-specialized and device-plan runs to `check.ts` beside `host.ts`, as far as
   A4-R1 says. The sentence is then false.
3. [fact] §67 is not in the `surface:` list of 0145. `bun run precommit` refuses an edit of §67 under `Change: 0145`.
4. [fact] The slice text of M4.8 does not give three details: the result shapes, what `check.ts` holds
   and what replaces `draw`. A4 states a reading for each.

#### What A4 declares

1. [decision] The front matter `surface:` gains `67`. [fact] `scripts/changes.ts` has no state for an
   amendment, so the list counts from the merge of this pull request (A2 and A3, same rule).
2. [decision] M4.8 edits one sentence of §67: the one in "Why A4 exists", item 1. It changes no other word of §67.
3. [fact] `reqs/surface/SURF-067.md` carries §67. M4.8 runs `bun run reqs:sync` and reads the item that it flags.
   A person runs `doorstop review SURF-067`. An agent does not.
4. [fact] The stale line references `examples/hosts/host-program/host.ts:28` are in
   `src/core/coverage/webgpu-objects.ts` (lines 2200 and 2203) and in the baked
   `docs/capability-coverage.md` (line 197). M4.8 changes the line number there. [inference] No
   criterion of `changes/README.md` reaches those files. `bun scripts/changes.ts` confirms this on the M4.8 diff.
5. [decision] M4.8 replaces `draw` (A4-R5) once the doc-impact fix (branch `claude/doc-impact-member-names`)
   is on `main`. [fact] That fix removes the false must-fix mentions of `draw()`. A4 does not declare it.

#### The readings M4.8 delivers

Each reading fills a gap in the slice text. [decision] The owner accepted each one.

| Id    | Host           | Reading                                                                                                                                                                                                                                                                                                             |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A4-R1 | `host-compute` | `host.ts` exports `run()`, which returns `{ values }`, and the extra `runSpecialized()`, which returns `{ direct, values, report }`. The manifest lists it in `extras`. `check.ts` asserts the report's shape on each tier.                                                                                         |
| A4-R2 | `host-compute` | The driver (`examples/_driver.ts`, `runCheck`) calls `check.ts`. `_drive.ts` imports what it needs and reads `values`, `direct` and `report` from the two runs.                                                                                                                                                     |
| A4-R3 | `loop-fuse`    | `run()` takes default inputs, so the harness calls `run()`. It still returns `{ chain, split, reduce }`, each with its `report`. `check.ts` calls `run()` again and checks each report.                                                                                                                             |
| A4-R4 | `host-program` | `run()` returns `{ image: { width, height, rgba } }`. The program runtime stays (`waitsFor: "0138 milestone 5"`).                                                                                                                                                                                                   |
| A4-R5 | `host-draw`    | `draw` is replaced by `run(canvas, time = 0)`: one frame. This keeps the `time` parameter of item 2 of "The host.ts form". A2 changed item 1 to `run(canvas, options?)`, and D-11 records the difference. `animate(canvas)` stays and calls `run(canvas, time)` each frame. The `times` list of today's `run` goes. |

1. [fact] A2 (host form, item 4 and the host-form table) lists `runSpecialized` as an extra of `host-compute`.
   The owner chose "run() + extras" as O4.
2. [decision] The slice row says "Remove ... runSpecialized as exports". M4.8 reads this as: `runSpecialized`
   stays exported as an extra, per O4 and the A2 table. Only `draw` leaves.
3. [fact] A2 says of `loop-fuse`: "Today's shape." The existing `run(a, b, c)` has no default
   inputs. A4-R3 adds them. The result shape does not change.
4. [fact] `check.ts` is the harness's file (host form, item 5). It exports `check(result, tier)`.
5. [fact] `draw` in `host-draw/host.ts` is not a form name. The form calls the one-frame function `run`.

#### What the site and M4.9 then owe

1. [proposal] The site repository (`typeshade/web`, the `downstream` entry of 0145): the Playground reads
   `image` from `host-program` (A4-R4). It keeps the `runSpecialized` button for `host-compute` (A4-R1).
   It calls `animate` for `host-draw`, and `run(canvas)` for the check (A4-R5).
2. [proposal] The site's host example pages for `host-compute`, `loop-fuse`, `host-program` and `host-draw`
   follow the new `host.ts` text. The site does not show `check.ts`.
3. [proposal] M4.9 reads `check.ts` through the registry for each entry that has one. The driver
   (`examples/_driver.ts`, `runCheck`) calls `check(result, tier)`. M4.9 does not read `HOST_ORDER`.
4. [fact] `compiler-changes.md` already records 0145. A4 adds no id to it.

#### Questions for the owner

Each answer is "[answer, owner, 2026-11-24]".

1. **A4-Q1. Does the owner accept `67` in `surface:`, for the one sentence?**
   [Answer, owner, 2026-11-24: "모두 추천안대로 (Recommended)". Yes.]
2. **A4-Q2. Does the owner accept A4-R1 as first drafted: `specialized()` in `check.ts`, not an extra?**
   [Answer, owner, 2026-11-24: "Extra로 유지 (Recommended)". No. `runSpecialized` stays an extra, as O4 and the A2 table say. A4-R1 is rewritten.]
3. **A4-Q3. Does the owner accept A4-R3 and A4-R4 as written?**
   [Answer, owner, 2026-11-24: "모두 추천안대로 (Recommended)". Yes.]
4. **A4-Q4. Does the owner accept A4-R5: `run(canvas, time = 0)` and `animate(canvas)` for `host-draw`?**
   [Answer, owner, 2026-11-24: "모두 추천안대로 (Recommended)". Yes.]

#### Deviations and open items

| Deviation                                                                                                               | Disposition                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D-10. A2 lists `runSpecialized` as an extra. The first A4-R1 moved it out.                                              | Closed. The owner answered "Extra로 유지 (Recommended)" on 2026-11-24. A4-R1 keeps it as an extra, as the A2 table says. |
| D-11. A2 item 1 gives `run(canvas, options?)`. A4-R5 keeps the `time` parameter of the original item 2 for `host-draw`. | Closed. Accepted by the owner's answer to A4-Q4 (2026-11-24).                                                            |

| Item                                                         | Reason                                           | Next action                                          |
| ------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| The `doorstop review` of `SURF-067`.                         | A person reads the item. An agent does not.      | A person runs it after `bun run reqs:sync`, in M4.8. |
| The doc-impact fix, branch `claude/doc-impact-member-names`. | M4.8 replaces `draw` only after it is on `main`. | Merge that branch, then start the `draw` change.     |

#### What A4 touches

- `surface`: §67. [decision] It joins the front matter.
- `docs/use-typeshade-surface.md`: one sentence of §67, in M4.8. `reqs/surface/SURF-067.md`: the item that `bun run reqs:sync` changes.
- `examples`: no id is added or removed. `downstream`: see "What the site and M4.9 then owe".

## What it owes downstream

For each repository in `downstream`. This is expected work. No responsibility is assigned.

- **typeshade.github.io** (the site and the Playground; the repository name is the one
  `DOWNSTREAM_REPOS` in `scripts/changes.ts` gives).
  - The examples page: show the path in order and the gallery in four groups. The typed
    `categories` record (`cartographic | generic | compute`) is replaced.
  - The example detail pages: a page for each of the 17 new ids, in en and ko, with the
    blurb, the module and the `host.ts`.
  - `playground-host-default.ts` and `playground-host-run.ts` (in the site repository): run
    the new form (`run(canvas)` or `run()`). These names come from the owner's task. They are
    not verified here.
  - The host example pages: the nine pages rewritten in the new form.
  - The i18n blurbs: one line in each locale for each shown id.
  - A search for each old example id that a page links, and for each page that lists the
    examples.
  - `compiler-changes.md` records 0145.
- **vscode-typeshade.**
  - The skill's example references and any sample list name the path and the gallery.
  - The first sample file that the extension offers matches `first-color`.
  - `compiler-changes.md` records 0145.
- **Journeys that name examples** live in this repository (`scripts/user-journey.ts`) and are
  in M4.
- **Docs that list examples** live in this repository (What it touches). `bun run docs:impact`
  lists them at each milestone.

Track the downstream changes, the compiler pins and the proposal-id records separately after
the compiler's work is done. Keep each undelivered obligation pending.
