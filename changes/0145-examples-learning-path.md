---
id: '0145'
title: An author learns TypeShade from a learning path of 17 new examples, from one colour to a ray tracer, each one a shader module with a host.ts that runs as written in the Playground, and finds every other example in a gallery of three groups that uses the same host form
status: draft
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
names: []
downstream:
  - repo: typeshade.github.io
    what: The examples page, the example detail pages and the Playground starters (en and ko) show the learning path in order and the gallery in three groups; the Playground default host and the host runner run the new host.ts form; the example blurbs and i18n lines name the new ids; each page that links an old example id or lists the examples is checked; compiler-changes.md records 0145
  - repo: vscode-typeshade
    what: The skill's example references and any sample list name the learning path and the gallery; the sample files the extension offers match the new first-color pair; compiler-changes.md records 0145
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0145, front-matter status `draft`. Numbers 0145 and above were free on `main` at `64593b03` and in the open pull requests on 2026-11-23 (checked: `changes/` listing and `gh api repos/typeshade/typeshade/pulls?state=open`).                                                                                                                                                                                                                               |
| Date and attribution          | 2026-11-23, UTC. The date is the drafting date. An AI agent session (Claude Code) drafted the text for the session that works for the repository owner. The owner's decisions in `## Why` are quoted from the conversation of 2026-11-23. They are decisions about the direction. They are not an approval of this text.                                                                                                                                              |
| Applicability / Effectivity   | `examples/` (the `*.shade.ts` files, `examples/hosts/`, `_order.ts`, `_shade.ts`, `_scan.ts`, `index.ts`, `__emit-goldens__/`), `examples/hosts/_order.ts`, `_registry.ts`, `_drive.ts`, `_reference.ts`, the generator that `examples/_order.ts` names, `scripts/compile-gate.ts`, `scripts/user-journey.ts`, `scripts/changes.ts`, the docs that list examples, and the site and Playground repository. No release version is assigned (OD-6: nothing is released). |
| Review baseline               | `main` at `64593b038fc8d8b201174f482474d5374b395e55`. Proposal 0138 (`accepted`) and proposal 0142 (`accepted`) are read at that commit.                                                                                                                                                                                                                                                                                                                              |
| Review and revision authority | No pull request is assigned yet. Git records the revisions. The review and merge records of the pull request will record the decision. This text does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                               |

## What changes

After this change, an author who opens the examples finds two things.

1. A **learning path**: 17 new examples in five parts. The first is the smallest program that
   draws. The last is a ray tracer. Each step adds one concept to the step before it.
2. A **gallery**: every example that exists today, regrouped in three groups. The groups are
   _works_ (visual pieces), _high precision_ (the `fp64` examples) and _feature examples_
   (small examples of one language feature).

Each example of both places is a pair: one `.shade.ts` module and one `host.ts`. The `host.ts`
runs as written in the Playground. The old examples keep their ids. Their hosts change to the
host form below.

This proposal adds no rule, no author-facing name, no diagnostic code and no export
(`names: []`, `exports: []`). It changes which examples exist and how each one is shown.

### The learning path

The path was drafted in the session of 2026-11-23. The owner saw it and said it was good. No
id clashes with an existing example id, so no name is changed.

| Part                  | Step | Example id        | Result                 | New concept                                                                       |
| --------------------- | ---- | ----------------- | ---------------------- | --------------------------------------------------------------------------------- |
| 1 First pixels        | 1    | `first-color`     | one colour             | `"use typeshade"`, a fragment entry, a host draw; one code on WebGPU, WebGL2, CPU |
|                       | 2    | `uv-gradient`     | a gradient             | coordinates, vectors, swizzle                                                     |
|                       | 3    | `moving-wave`     | a moving wave          | a uniform carries time; animation                                                 |
|                       | 4    | `sdf-shapes`      | a circle and a box     | writing functions; `length`, `smoothstep`                                         |
| 2 The language        | 5    | `tile-pattern`    | repeated tiles         | loops, conditions, `fract`                                                        |
|                       | 6    | `fractal`         | the Mandelbrot set     | iteration with an early exit                                                      |
|                       | 7    | `palette`         | a colour palette       | arrays, module constants                                                          |
|                       | 8    | `bouncing-balls`  | bouncing balls         | a class, methods, objects are references (change 0142)                            |
| 3 Drawing shapes      | 9    | `triangle`        | a triangle             | vertex and fragment entries, vertex data                                          |
|                       | 10   | `spinning-cube`   | a spinning cube        | matrices, a camera, depth                                                         |
|                       | 11   | `textured-cube`   | a textured cube        | textures and samplers                                                             |
| 4 GPU compute         | 12   | `double-array`    | a list of numbers      | the first compute kernel, a run, reading results back                             |
|                       | 13   | `image-blur`      | a blurred image        | an image kernel                                                                   |
|                       | 14   | `parallel-sum`    | a sum                  | workgroup memory, barriers                                                        |
|                       | 15   | `histogram`       | a bar chart            | atomics                                                                           |
| 5 Putting it together | 16   | `particle-system` | thousands of particles | compute moves them, render draws them; the program runtime (change 0138)          |
|                       | 17   | `ray-tracer`      | a ray-traced scene     | everything together                                                               |

Rules of the path:

- Each step adds one concept. A step uses only the concepts of the steps before it.
- Each step has a pair: `<id>.shade.ts` and `host.ts`.
- The `host.ts` of each step runs as written in the Playground, on every tier the step lists.
- A step shows no form that the compiler refuses or does not implement yet (OD-9).

### The gallery

The gallery holds every example in the tree at `64593b03`, so nothing is deleted:

- 102 files `examples/*.shade.ts`.
- 9 directories `examples/hosts/<id>/` (`host-draw`, `host-compute`, `host-kernel`,
  `host-resident`, `host-helper`, `host-program`, `loop-fuse`, `string-keys-record`,
  `host-set-unique`), each with a module and a `host.ts`.
- 36 builder examples `examples/*.ts` that `examples/_order.ts` lists (`CURATED_ORDER`), which
  the site reads at build time from `examples/index.ts`. 23 of the 102 `.shade.ts` files are
  twins of these (`twinOf`).

The three groups are:

| Group            | Content                                                                                                                            | First assignment rule                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Works            | Visual pieces: raymarching, fractals, noise, terrain, ocean, path tracer, and so on.                                               | A renderable example that is not `fp64` and not one-feature.       |
| High precision   | The `fp64` examples: 28 files named `fp64-*` (12 of them `.shade.ts`).                                                             | The id starts with `fp64-`.                                        |
| Feature examples | Small examples of one language feature: `closures`, `class-syntax`, `workgroup-reduce`, `hello-*`, the 9 host examples, and so on. | An example that shows one construct and is not a finished picture. |

The first assignment is a rule, not a list. Milestone M4 writes the full table, id by id, as
data in each example's header (a `group` field beside `title` and `blurb`). The owner reviews
that table in the pull request of M4 (open question Q3).

## The host.ts form

Every example, in the path and in the gallery, has a `host.ts` that follows one form.

1. The file imports the shader module itself. The Vite plugin (`typeshade/vite`) turns each
   export of the module into a function the host calls.
2. The file exports `run(canvas)` for a drawing example, or `run()` for a compute example.
   `run` does the work once and resolves when the result is ready.
3. A drawing example may also export `animate(canvas)`. It calls `run` or `draw` again each
   frame.
4. The file holds no pipeline, buffer, bind group or encoder code.
5. The file has a leading comment of one to three lines. It names the concept the step adds.
6. The Playground calls `run` (or `animate`) and adds nothing around it.

"Replaced in full" is the owner's instruction: "중요한건 지금 host.ts 코드도 전면 교체해야한다는거입니다."
(2026-11-23). Today's `host.ts` files export several functions each (`draw`, `animate`,
`run`, `runSpecialized`) and serve two readers: the reader and the check harness
`examples/hosts/_drive.ts`. The new form serves the reader first. The harness reads the
same `run`, so the checks still run the code the reader sees.

### Which host API each part uses

The API below is what `main` at `64593b03` has. Nothing here is a new name.

| Part                  | Host API on `main`                                                                                                                                       | Depends on 0138 milestone 5?                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 First pixels        | A full-screen `@fragment` entry called as `fs(canvas, bindings)` (surface §67, Rule 8.24). Tier: WebGPU, then WebGL2, then CPU.                          | No.                                                                                                                                                                                    |
| 2 The language        | The same call. Step 8 passes class instances as bindings.                                                                                                | Step 8 depends on 0142 (a class instance as a reference). Whether 0142's stages are implemented is not verified here. M2 checks it first.                                              |
| 3 Drawing shapes      | A vertex and fragment entry pair drawn through the program runtime: `runtime()`, `rt.load(...).render(...)`, `rt.frame().pass(...)` (as `host-program`). | Yes. 0138 milestone 5 (rendering) replaces this form: compositions, texture outputs, render-state options, `show`, class parameters as uniforms. Milestone 5 is not started on `main`. |
| 4 GPU compute         | A `@compute` entry called as `scale(bindings, workgroups)`; kernel functions called as `await kernel(args)`; `array`, `zeros` from `typeshade/runtime`.  | No for steps 12 and 13. Steps 14 and 15 are not checked against the 0138 milestone 4 slices (A10) here. M3 checks it.                                                                  |
| 5 Putting it together | Step 16 draws and computes in one frame: program runtime plus resources. Step 17 is a full-screen entry plus an image kernel.                            | Yes for step 16 (0138 milestone 5 and 0138 milestone 4 graphs). Step 17 depends on the part 3 form only if it draws through a render pass.                                             |

Facts read at `64593b03`: `src/runtime.ts` exports `array`, `texture`, `uniform`, `zeros`,
`configure` and the program runtime. It exports no `show`, no `device` and no `node`. These
three names are in 0138 and are not delivered. The proposal names them as a dependency and does
not use them.

**Dependency rule.** A step whose host form depends on an undelivered part of 0138 is written
in the form of `main` at the time of its milestone. When 0138 milestone 5 lands, a later pull
request rewrites that `host.ts`. The cost of the rewrite is the same as the cost the owner
accepted in 0138 (`what it owes downstream`: "every host example ... change their host code").
A step is never written with an API that does not exist (OD-9: a form is refused only when not
implemented, and the diagnostic says so).

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
  await fs(canvas, {});
}
```

- [inference, agent] A full-screen entry that reads no binding is called with an empty
  bindings object. Surface §67 shows `fs(canvas, { frame: {...} })`. It does not show the
  call of an entry with no binding. M1 runs this call on the three tiers before it merges, and
  amends the text if the call needs another spelling. The `first-color` pair is not run yet.
- Both halves (CLAUDE.md, "A test reads both halves"): M1 asserts `compile()` and the
  language service on the same `first-color.shade.ts` source. `getDiagnostics` returns none,
  and the emit has one fragment entry. The `host.ts` is checked by `tsc` and by a run.

What the author removes from the reader's first screen: the vertex entry, the two interfaces,
the branch and the uniform. What the author keeps: the directive, one entry, one call.

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
- `examples/_shade.ts` records that the 102 `.shade.ts` files are not in `examples/index.ts`
  and are shown by none of the site's pages. The site's gates (`wgslOnlyExample()`,
  `checkedBlurbs()`, a typed `categories` record) block them.
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
one pair. The pairs are small. Step 17 and step 16 are the largest.

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
- **OD-9.** A step may rely on the compiler rewriting a form. The path shows what the program
  means, not what WGSL spells.
- **OD-10.** Step 16 and any step that grows an array write it as JavaScript does.

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

| Item                                                                         | Change                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/path/<id>/` (new)                                                  | 17 directories with `<id>.shade.ts` and `host.ts`.                                                                                                                                                                                                                                                  |
| `examples/gallery/` (new, Q2)                                                | The 102 `.shade.ts` files, the 9 host directories and the 36 builder examples regrouped in three groups. Each gets a `host.ts` in the new form.                                                                                                                                                     |
| `examples/_order.ts`, `examples/index.ts`, `examples/hosts/_order.ts`        | Split in two: the path order (hand-written, by step) and the gallery order (by group). The two `_order.ts` lists and `_registry.ts` merge or are replaced.                                                                                                                                          |
| the script `gen-example-registry`                                            | [fact] The file named in `examples/_order.ts`, `_scan.ts` and `index.ts` does not exist in the tree at `64593b03` (`git ls-files`). M1 finds which script writes `examples/index.ts` and updates it.                                                                                                |
| `examples/_shade.ts`, `examples/_scan.ts`, `examples/registry-drift.test.ts` | Discover the new directories. The drift gate reports an id in the order lists that has no file, and a file that no list names.                                                                                                                                                                      |
| `examples/__emit-goldens__/` (423 files)                                     | Names follow the id, so a move changes no name. 17 new modules add goldens. A changed module changes its golden.                                                                                                                                                                                    |
| `scripts/compile-gate.ts`                                                    | Its example set (`examples`, `shadeExamples`) grows by 17 modules and keeps all the others. Each new step is judged on Tint and ANGLE as the others are.                                                                                                                                            |
| `scripts/user-journey.ts`, `examples/hosts/_drive.ts`, `_reference.ts`       | Journeys that name `host-draw`, `host-compute` and the other hosts read the new `run` of each. The reference of each new step is computed in plain JavaScript.                                                                                                                                      |
| `examples/host-examples.test.ts`, `examples/examples.test.ts`                | Run each new `host.ts` on the CPU tier. A listed tier must pass, an unlisted tier must not pass (as `HOST_ORDER` does today).                                                                                                                                                                       |
| Docs that name examples                                                      | `docs/language-service-api.md` (names `hello.shade.ts`, `hello-uniform-struct.shade.ts`), `README.md` (names `hello.shade.ts` at lines 221 to 229), `AGENTS.md`, `src/AGENTS.md`, `docs/capability-coverage.md`, `docs/language-design.md`. `bun run docs:impact` lists the rest at each milestone. |
| `examples/README.md`, `examples/PORTING.md`                                  | Rewritten for the two places and the host form.                                                                                                                                                                                                                                                     |

Evidence the implementation will give (each milestone below): `bun run gate:compile`,
`bun run bake:goldens` with its diff, `vitest` runs for the example suites, `bun run
gate:journeys`, a Playground run, `bun run docs:impact`, `bun run docs:refs`, and
`bun scripts/changes.ts`.

### Draft impact estimate

Known impacts:

- **Golden churn.** 17 new modules add goldens. A move of a gallery module changes no golden
  name. A rewrite of a gallery module (not planned; only `host.ts` changes) would change its
  golden. The count of changed goldens is unknown until M4.
- **Journey changes.** `scripts/user-journey.ts` names the nine host examples. Each `run` is
  replaced, so the journey's reference table (`_reference.ts`) changes for all nine.
- **Site pages.** The examples page and the example pages group rows by the typed record
  `cartographic | generic | compute` and require a blurb for each id in each locale. The new
  grouping needs a site change (M5). 17 new ids need two blurbs each (en, ko). The
  gallery's 102 + 36 entries need blurbs in both locales to be shown. The count of existing
  blurbs is not measured here.
- **Compile gate set.** It grows by 17. The compile time of the gate grows. The size is unmeasured.
- **Stale example names in docs.** At least the files in the table above name an old example. A
  search of the site and the editor repository for each old id is part of M5 and is not done here.
- **The two-form period.** Between M1 and M4 the gallery's hosts are in the old form. Each
  milestone leaves `main` green. A reader sees both forms until M4.

Estimates: none. Duration and cost are not estimated (unknown, not zero).

Decisions to resolve before acceptance: Q1 to Q6 below.

### Independent review record

This record does not yet apply. No independent review has read this draft. README (Independent
review) requires one, with the proposal's findings and answers, before the owner decides.

### Approval and plan record

This record does not yet apply. Acceptance will require the evidence below.

- The owner's decision and the merge reference of the pull request with `status: accepted`.
- The approved revision and scope.
- The owner's answers to Q1 to Q6.
- Assigned responsibilities and agreed milestones. None is assigned now.

#### Milestones (proposed, one pull request each)

Each milestone carries `Change: 0145`. Each leaves `main` green. A pull request that shows an
author-facing form shows the example before and after, and waits for the owner's "merge".

| Milestone | Content                                                                                                                                                                                   | What it verifies                                                                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | Part 1 (steps 1 to 4), the host.ts form, and the registry split (path against gallery). `scripts/changes.ts` and the scan learn `examples/path/`.                                         | `bun run gate:compile` with the 4 new modules. Goldens baked and the diff read. Both halves on each of the 4 sources (`compile()` and the language service). Each `host.ts` run on the CPU tier and on a WebGPU page. Playground run (M5 owns the site; M1 runs the `host.ts` in the journey page). `registry-drift.test.ts`. `docs:impact`. |
| M2        | Parts 2 and 3 (steps 5 to 11). First, check 0142's state for step 8, and 0138 milestone 5's state for part 3.                                                                             | As M1 for 7 modules. Step 8 on the three tiers, with objects as references. Part 3 on the form that `main` has. The dependency on 0138 milestone 5 is recorded as pending if it is not delivered.                                                                                                                                            |
| M3        | Parts 4 and 5 (steps 12 to 17).                                                                                                                                                           | As M1 for 6 modules. Compute steps: the result read back equals a plain JavaScript reference (`_reference.ts` form). Step 16 and 17 on WebGPU and the tiers they list.                                                                                                                                                                       |
| M4        | The gallery migration: every existing example gets the new `host.ts` form and a `group`. The nine host examples and their journeys move to the new form.                                  | `gate:journeys` on WebGPU and WebGL2 (the tiers each host lists). `examples/host-examples.test.ts` on the CPU tier. Goldens unchanged for a pure move. The full group table is in the pull request.                                                                                                                                          |
| M5        | The site and the Playground (the site repository): the examples page, the example pages, `playground-host-default.ts`, `playground-host-run.ts`, the host example pages, the i18n blurbs. | The site build. A Playground run of each of the 17 `host.ts`. The site's own gates. This milestone belongs to the site repository and follows its compiler pin (README, The lifecycle, item 5).                                                                                                                                              |

[inference, agent] M5 runs in the site repository, and the compiler pin pull request there fails
until 0145 is in its `compiler-changes.md`. The names of the Playground files are as the
owner's task gave them and are not verified in this repository.

### Configuration and validation record

This record does not yet apply. Delivery will require: the accepted revision; the pull requests
and commits that say `Change: 0145`; the delivered configuration; the functional checks per
milestone (the compile gate, the goldens, the example suites, the journeys, a Playground run;
both halves of each author-facing form); the document audit (`docs:impact`, `docs:refs`,
`scripts/changes.ts`); each deviation with its disposition; and the pending work.

## Open questions for the owner

Each question has a recommended answer. The agent does not decide any of them.

1. **Q1. Do old example ids keep redirects on the site?** The site may link old ids.
   Recommended: no redirect. OD-6 says nothing is released. The ids of the gallery do not
   change in this proposal, so only a link to a page that the site removes needs a decision.
2. **Q2. Do the gallery files move into directories, or stay where they are?** Moving gives
   one layout (`examples/<place>/<id>/<id>.shade.ts` and `host.ts`) and one place for each
   `host.ts`. Staying keeps the history short and moves nothing. Recommended: move with
   `git mv`, because each gallery example now needs a `host.ts` beside it.
3. **Q3. Does the gallery show all 138 entries or a curated subset?** The 102 files, 9 hosts
   and 36 builder examples overlap (23 twins). Recommended: show all, with the twin pair
   shown once, grouped by the three groups, and mark the builder form as the twin. The owner
   reviews the group table at M4.
4. **Q4. What does the CPU tier show for step 1?** The CPU tier paints pixel by pixel. For one
   colour it shows the same colour. Recommended: step 1 states that the three tiers give the
   same pixels and the Playground shows the tier it runs on. The owner may want a visible
   tier label.
5. **Q5. What about the 36 builder examples (`examples/*.ts`)?** They use the `fn()` surface
   and have no `.shade.ts` host form. Recommended: keep them as the twin oracle
   (`twinOf`) and show only the `.shade.ts` form in the gallery. The owner may want them
   removed from the site.
6. **Q6. What about steps 9 to 11 and 16 before 0138 milestone 5?** The program runtime form
   is replaced by that milestone. Recommended: write the steps in the form of `main`, and
   rewrite their `host.ts` in a later pull request. The owner may prefer to hold part 3 until
   0138 milestone 5 is delivered.

## What it owes downstream

For each repository in `downstream`. This is expected work. No responsibility is assigned.

- **typeshade.github.io** (the site and the Playground; the repository name is the one
  `DOWNSTREAM_REPOS` in `scripts/changes.ts` gives).
  - The examples page: show the path in order and the gallery in three groups. The typed
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
