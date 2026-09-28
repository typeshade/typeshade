---
id: '0026'
title: An example can be several passes drawn in order each frame, each pass reading what an earlier pass drew this frame or what a pass drew the frame before, and the site draws, edits and checks such an example
status: accepted
rules: []
surface: []
exports: []
exports-removed: []
codes: []
examples:
- separable-blur
- feedback-trail
downstream:
- repo: typeshade.github.io
  what: The runtime draws a pass list into offscreen textures and keeps the previous frame of each pass that reads it; the live-shader contract gains the reserved `frame` and `timeDelta` fields; the Playground makes a workspace file a pass and offers each pass as a texture source; the CPU rasteriser, the stills, the gallery and check-playground learn the two examples.
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Today every example is one program drawn once per frame into the canvas. The effects a
Shadertoy author reaches for first need more than that: a blur in two passes, a trail that fades
over earlier frames, a simulation (reaction-diffusion, fluid, a game of life) that reads its own
last state. None of them can be written as a TypeShade example, and the Playground cannot draw
them. The program runtime (0025) already records render passes into textures, and a fragment
entry already samples a `texture_2d<f32>` (surface §15). What is missing is a way to say
which pass feeds which, and one reference corpus the site and its checks can draw.

After this change an example's `@example` block can name the passes drawn before its own file
each frame:

```ts
"use typeshade";

/* @example
{
  "title": "Feedback trail",
  "blurb": "A dot that leaves a trail: the `trail` pass reads what it drew the frame before, fades it and adds the dot again.",
  "renderable": true,
  "passes": [{ "name": "trail", "file": "passes/trail.shade.ts" }]
}
*/

declare const trail: texture_2d<f32>;
declare const smp: sampler;
// … the fragment entry tone-maps what `trail` drew this frame into the canvas.
```

The rules, all of them host rules, none of them the compiler's:

1. **The passes are drawn in the order listed, then the example's own file into the canvas.**
   The example's own file is the last pass, and it is the only one drawn to the canvas.
2. **A pass is a complete program**, a `"use typeshade"` file with a vertex and a fragment entry,
   exactly like a renderable example. It lives under `examples/passes/`, which the corpus scan
   does not read, as `examples/lib/` is not read (Rule 3.9's `imported-noise`). A pass may
   import shader files like any file.
3. **A `texture_2d<f32>` binding named like a pass reads that pass's output.** A pass drawn
   earlier in the same frame is read as this frame's output. The pass itself, or one drawn later,
   is read as its output from the frame before, and the first frame reads zeroes. This is
   Shadertoy's rule for its buffers, so an author who knows it has nothing new to learn.
4. **An output is the canvas's size, in `rgba16float`**, so a simulation keeps values outside
   0 to 1 and below 1/255. WebGL2 renders to `RGBA16F` where `EXT_color_buffer_float` is
   available and to `RGBA8` where it is not, and says so.

No rule of `docs/language-design.md` changes, and no export, surface section or diagnostic
code: a pass is an ordinary program, a pass output is an ordinary `texture_2d<f32>`, and which
binding reads which texture is decided by the host that draws them, which is where 0025 and
#335 decision 3 put scheduling. The compiler's part is the registry, the gates and the two
examples.

### The registry reads the passes and refuses a graph that cannot be drawn

`examples/_shade.ts` reads `passes` from the `@example` block and compiles each pass file from
its own bytes, with `readDocument` as for the example itself. It throws at registration, as it
does today for a missing title, when:

- `passes` is not an array of `{ name, file }` with string fields;
- a pass's file is missing, or does not compile;
- a pass is not a program with exactly one vertex entry and one fragment entry;
- two passes share a name, or a pass has the example's own id as its name;
- a binding named like a pass, in any pass or in the example's own file, is not a
  `texture_2d<f32>`;
- a pass is drawn by nothing: no file binds it by name.

An example with passes must be `"renderable": true`. A pass that has no GLSL form makes the
whole example WGSL only, and the registry says which pass.

The registry records `passes` on the example: `{ name, file, module }` in draw order. The
existing fields do not move.

### The gates cover every pass

- **The compile gate** (`scripts/compile-gate.ts`) hands every pass's WGSL to Tint and every
  pass's GLSL pair to WebGL2, as it does for an example.
- **The emit goldens** add one set per pass, named `<example>.<pass>.wgsl` and
  `<example>.<pass>.vertex.glsl` and `.fragment.glsl`, so a pass cannot drift without a
  golden moving.
- **The WebGL2 run** (`examples/README.md`, the gate that reads pixels back) draws the passes
  in order into framebuffers for the two new examples, at frame 0 and at frame 30, and asserts
  the canvas is not flat. The feedback example must differ between the two frames, which is
  the proof that the previous frame was read.

### Two examples

- **`separable-blur`**: the pass `blurX` draws a procedural pattern blurred along x, and the
  example's own file blurs `blurX` along y. It shows rule 3's first half: a pass read in the
  frame it was drawn.
- **`feedback-trail`**: the pass `trail` reads `trail`, fades it by a uniform factor and adds a
  dot at a point that orbits with `time`; the example's own file tone-maps `trail` into the
  canvas. It shows rule 3's second half and why the first frame reads zeroes. It reads a
  reserved `frame: u32` field to seed on frame 0.

`examples/README.md` documents `passes` next to `title`, `blurb`, `renderable` and `twinOf`.

## Why

**The effects a reader expects from a shader playground are multipass.** On Shadertoy the
buffer tabs are where blur, bloom, trails and every simulation live. The site's Playground now
has file tabs, a transport and a texture a reader can drop a picture on
(typeshade.github.io#108). The maintainer asked for Shadertoy's shape and for the freedom to
express one's own work the way an engine allows. A single pass stops that at the first
effect that needs history.

**The graph is the host's, so the compiler does not learn a new word for it.** The
alternatives considered:

- **A type or decorator for a previous frame**, such as `previous<texture_2d<f32>>` or
  `@feedback`. It names a scheduling fact inside a shader. The shader cannot act on it: WGSL has
  no such thing, and the texture it reads is an ordinary texture. It would be a new entry in the
  §9.3 extension table for a concept that belongs to whoever records the frame. 0025 keeps the
  runtime out of scheduling on purpose ("It does not reorder, merge or schedule work"), and
  the language should not take that job either.
- **Importing a pass as a texture**, `import trail from './trail.shade.ts'`. Rule 3.9 makes an
  import mean that code is linked into one program. The same syntax must not also mean "a
  texture drawn by another program": the language service would type it one way and the
  compiler would link it another (Rule 12.7).
- **The graph in the site alone.** The Playground can draw a graph of the reader's own files
  with no change here. The gallery's examples come from this repository, though, and a
  multipass example written only on the site would be a shader no gate compiled. It would also
  have no golden and no WebGL2 run.
- **A compute kernel writing a storage texture** (`storage-texture`). It already works on
  WebGPU and on the CPU oracle. It has no WebGL2 form, and it is not how a fragment author
  writes a blur or a trail.

**It lines up with the public runtime.** When the site moves onto 0025, a pass is
`f.pass({ color: [output] }, (p) => p.draw(pipeline, bindings))`. A pass read as the frame
before is two `Texture`s swapped each frame. Nothing here adds to the runtime's API. Its engine
journey already records a render to a texture.

## What it touches

- `rules`, `surface`, `exports`, `codes`: none. A pass is a program under the rules that exist,
  and the graph is registry data.
- `examples`: `separable-blur` and `feedback-trail` are added. Their pass files live under
  `examples/passes/` and are not examples of their own.
- Tests:
  - `examples/shade-examples.test.ts`: a case per refusal above, a graph of three passes that
    registers, and the draw order recorded.
  - The compile gate and the emit goldens over every pass file.
  - The WebGL2 run that proves the feedback example reads its previous frame.

## What it owes downstream

**typeshade.github.io**

- `src/lib/shader-runtime.ts` draws an example's passes in order into offscreen textures each
  frame, then the example into the canvas. It keeps a second texture for each pass that is read
  as the frame before, and swaps them. The textures follow the canvas's size. On WebGL2 it
  renders to `RGBA16F` behind `EXT_color_buffer_float`, or to `RGBA8`, and the backend note says
  which.
- `src/lib/live-shader-contract.ts` gains the reserved fields `frame` (`u32`, frames since the
  clock started) and `timeDelta` (`f32`, seconds since the last frame). `DESIGN.md` restates the
  contract, so it changes in the same commit. The Playground's Restart sets `frame` to 0 and
  zeroes every pass output.
- The Playground (`src/scripts/playground.ts`, `playground-bindings.ts`):
  - A workspace file can be marked as a pass. The tab order is the draw order, and the main file
    is last.
  - The bindings panel offers each pass as a source of a `texture_2d<f32>` binding, beside the
    checker, the noise and a dropped picture.
  - The link carries the graph.
  - An example with `passes` opens with its pass files as tabs, marked.
- The CPU rasteriser draws the passes in order through the oracle's textures. For an example
  that reads a frame before, it draws from frame 0 to the frame asked for.
- `scripts/capture-stills.ts` captures the feedback example after a fixed number of frames at a
  fixed step, so its still is a trail and not frame 0.
- The gallery, the example pages and their emit tabs show one tab per pass.
- `scripts/check-playground.mjs`:
  - both examples paint;
  - the feedback example's frame moves with the frame count, and Restart returns it to frame 0;
  - the engines are compared at a fixed frame count and step.
- `compiler-changes.md` records 0026 when the pin reaches it.

**vscode-typeshade** owes nothing. The editor reads no example registry, and a pass is a file
the language service already understands.
