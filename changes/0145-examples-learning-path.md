---
id: '0145'
title: An author learns TypeShade from a path of 17 examples and finds the other examples in a gallery
status: accepted
rules: []
surface: []
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
- 3 support modules, which are not examples: `examples/lib/noise.shade.ts` and
  `examples/passes/blur-x.shade.ts` and `examples/passes/trail.shade.ts`. An example imports
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

**Before.** `examples/hello.shade.ts` is a triangle. It has no host. A reader who wants to see
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

| Deviation                                                                                                                                                                                                  | Disposition                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| D-1. The four modules carry `"renderable": false, "reason": "no entry point"`, as `host-draw` does. A module with only a fragment entry has no vertex stage, and the `shade-examples` GLSL test needs one. | Open. M5 decides what the site reads for a step that draws.        |
| D-2. The uniform is `interface Frame`, where `host-draw` uses `class Frame`. Step 8 stays the first step with a class.                                                                                     | Closed. The path rule "a step uses only earlier concepts" asks it. |
| D-3. `examples/index.ts` names the generator scripts/gen-example-registry.ts, which does not exist, so `pathExamples` was added by hand.                                                                   | Open. A later pull request restores the generator or the text.     |
| D-4. Steps 1 to 4 also use `abs`, `max`, `sin`, `const` locals and swizzles, which the path table does not list.                                                                                           | Open. The path table is amended to list them.                      |

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

### A1. A fourth gallery group, inspired by other sources (2026-11-23, status: draft)

- Status: draft. `status: accepted` of 0145 does not change. A1 is part of the approved text only
  after the owner accepts it. No code and no example changes with this pull request.
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

| Id                        | What it shows                                                                                                                                              | Path concepts it uses                                                               | Tiers it targets                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| `three-body`              | Three bodies under gravity. Each pixel replays the system for a fixed number of steps and draws the bodies and their trails.                               | Steps 4 to 8: functions, loops with an early exit, arrays, a class with references. | WebGPU, WebGL2, CPU (fragment only). |
| `bloom`                   | A glow around bright points. A procedural image function is sampled at the taps of a Gaussian kernel inside one fragment entry.                            | Steps 4, 5 and 7: functions, loops, a constant array of weights.                    | WebGPU, WebGL2, CPU (fragment only). |
| `tone-mapping`            | One HDR ramp, split into three bands: clamped, Reinhard and an ACES fit. No input image.                                                                   | Steps 2 and 4: `position`, vectors, functions.                                      | WebGPU, WebGL2, CPU (fragment only). |
| `game-of-life`            | Conway's rule on a grid. A compute entry reads one buffer and writes the other. A fragment entry draws the cells.                                          | Step 7 (arrays), step 12 (the first compute kernel).                                | WebGPU, WebGL2, CPU.                 |
| `boids`                   | Flocking from three rules. A compute entry reads every boid and writes the next state. A fragment entry draws each boid as a disc.                         | Steps 5 and 8 (loops, a class), step 12.                                            | WebGPU, WebGL2, CPU.                 |
| `reaction-diffusion`      | Gray-Scott pattern growth on a grid, in a compute entry with two buffers. A fragment entry maps the two chemicals to colour.                               | Steps 7 and 12, and the `palette` ramp of step 7.                                   | WebGPU, WebGL2, CPU.                 |
| `path-tracer-progressive` | A path tracer that keeps the sum of its samples in a buffer. A compute entry adds one sample for each pixel in each call. A fragment entry shows the mean. | Steps 4 to 8 and step 12. It continues `examples/path-tracer.shade.ts`.             | WebGPU, WebGL2, CPU.                 |
| `fluid-2d`                | Stable fluids on a grid: advection, divergence, a fixed count of Jacobi pressure iterations and projection, each a kernel function.                        | Steps 5, 7 and 12, and the kernel call of step 12 (`await kernel(args)`).           | WebGPU, WebGL2, CPU.                 |

Notes on the table.

- [fact] `examples/path-tracer.shade.ts` exists in the gallery. Its header says that progressive
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
  that reason. [inference] If M7 finds that a rewrite needs one, that example lists WebGPU and
  CPU where the CPU tier runs it, and the CPU tier runs a workgroup barrier only as the call
  layer serializes it (`host-kernel` and `host-resident` are the shape). M7 checks it.
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
- Open: whether the first batch is right (A1-Q1).
- Open: the id clash `path-tracer` (A1-Q3).

#### Open questions for the owner

1. **A1-Q1. Is the first batch right?** The eight examples are `three-body`, `bloom`,
   `tone-mapping`, `game-of-life`, `boids`, `reaction-diffusion`, `path-tracer-progressive` and
   `fluid-2d`. Recommended: yes. Each is written with forms the compiler has today, and the five
   that need a buffer target WebGPU and CPU.
2. **A1-Q2. Does an inspired example need a `host.ts` in the form of the path?** Recommended: yes,
   the same form as the path (`run(canvas)` or `run()`, and an optional `animate(canvas)`). The
   reader and the check harness then read one host of one form.
3. **A1-Q3. The id `path-tracer` is taken. Which id does the new example use?** Recommended:
   `path-tracer-progressive`, so that `examples/path-tracer.shade.ts` keeps its id (OD-6 allows a
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
