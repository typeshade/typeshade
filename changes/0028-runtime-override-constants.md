---
id: '0028'
title: A host of the program runtime sets a program's overrides by name, binds a float texture the program only loads, reads the console's counts, and runs a program packed under emit options
status: draft
rules:
- '11.10'
- '11.11'
surface:
- 69
exports:
- RenderState
- Program
- Frame
- Runtime
- PackOptions
- BindEntry
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The Playground's runner moves onto the program runtime (0025's downstream work, which this unblocks) with its override controls through RenderState.constants and compute's constants, its frame and pixel console captures reading their dropped count from submit(), and its canvas running the manifest packModule gives under the reader's emit options; nothing on the site changes before that move
- repo: vscode-typeshade
  what: The skill's references/host.md, whose program runtime section says what render() and compute() take, names the override values, and that submit() returns the console's counts
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

The program runtime (0025, Rule 11.11) has two hosts outside this repository. The site's
Playground has to move its WebGPU runner onto it (0025's downstream work), and typeshade/stepinside
draws its product on it. Each asks for something the runtime cannot do through its public API.
This proposal adds the four that block them. Each is independent of the others, and each can be
implemented on its own.

### 1. Override values, by name

An override is a specialization constant: the pipeline sets it (surface §15). The runtime makes
every pipeline with no constants, so each override takes the default its declaration states, and
a host has no way to set one. The Playground's bindings panel sets them.

```ts
const program = rt.load(scene);
const fine = await program.render({ targets: ['bgra8unorm'], constants: { quality: 3 } });
const coarse = await program.render({ targets: ['bgra8unorm'], constants: { quality: 1 } });
const step = await program.compute('step', { constants: { iterations: 64 } });
```

- `RenderState` gains `constants`, and `program.compute(entry, options)` takes `{ constants }`.
  Each is a record of override name to value. It is handed to every stage of the pipeline as
  WebGPU's `constants`, keyed by the name the source declares, which is the name the WGSL
  declares (surface §15).
- An override the record leaves out takes its declared default, as it does today.
- A name the manifest's `overrides` does not list is a `TypeError` that names the program's
  overrides. So is a value its type cannot hold: an `f32` takes a finite number, an `i32` or a
  `u32` an integer in its range, and a `bool` a boolean or a number, as WebGPU's constants take
  one (0 is false). WebGPU would otherwise report a validation error with no name of the source
  in it, or convert the value silently.
- The pipeline cache keys on the values. Two states that differ only in an override are two
  pipelines, and the same values give the same pipeline back.

### 2. A float texture the program only loads (#404)

The runtime lays out every `texture_2d<f32>` as `sampleType: 'float'`, which needs a filterable
format. A host cannot bind a 32-bit float texture (`r32float`, `rgba32float`) that the program
only reads with `textureLoad`, and WebGPU names the layout in its error, not the binding. The
program knows more than the layout uses: it knows which calls read each texture, and which
sampler meets it.

- `reflect()` reports each sampled texture's `sampleType`, WebGPU's word for what a
  `GPUTextureBindingLayout` takes:
  - `'depth'` for a depth texture;
  - `'uint'` or `'sint'` for an integer one;
  - `'unfilterable-float'` for an `f32` texture that no call of any entry pairs with a
    `sampler`: one it loads, measures or counts, and a multisampled one, which no sampler reads;
  - `'float'` for an `f32` texture a call pairs with a `sampler`, which the runtime lays out
    `filtering`.
- The manifest carries it with the rest of the resource, in `reflect()`'s vocabulary (Rule 11.10),
  and the runtime lays out from it. `'unfilterable-float'` takes a filterable format too, so a
  texture laid out that way still binds everything it took before.
- A host that samples an unfilterable format with a non-filtering sampler, which a program
  cannot say, is not covered. A per-binding layout in `RenderState` is the way to it, and a later
  proposal can add one when a host needs it.

### 3. The console's counts, to the host

A dispatch or draw that records the console hands its lines to the host's sink
(`createRuntime({ console: sink })`). The number of calls its buffer had no room for goes to the
host's console as a warning, even when the host gave a sink. So a host that shows the lines
itself cannot show how many were dropped. The Playground's frame capture says how many lines it
kept and how many it dropped, and its checks hold the two to the frame's pixels. The compiler's
own journeys read the count by patching `console.warn` (`journeys/_harness.mjs`).

- `frame.submit()` and `rt.submit(…)` resolve to what the console buffers of that submit held:
  `{ console: [{ entry, lines, dropped }, …] }`, one row for each dispatch and draw that recorded.
- A runtime given a sink prints nothing: the host that takes the lines takes the count. The
  default, `'print'`, prints the lines and the warning as today.

### 4. A program packed under emit options

`packModule(m)` emits the program at the defaults. A host that shows or ships the program under
other options (an optimization level, `parens`, `fp64Flavor`, the emit plugins) cannot hand the
runtime that program. The Playground's canvas runs the WGSL its WGSL tab shows. `fp64Flavor`
changes the bindings too: the float flavor injects the `_fp64` guard, and the integer one does not.

- `packModule(m, { emit })` takes the WGSL writer's options and a level: `level`, `parens`,
  `fp64Flavor` and `plugins`. The manifest's `wgsl`, its recorded variant's `wgsl`, its `glsl` and
  its `bindings` are the ones those options emit. The same options for the module's host import
  are a later question: the plugin's options stay as they are.
- A manifest records the options it was packed under (`emit`, the level and the two named
  options), so the load-time emitter (`repack`) emits the program again under them, and Rule
  11.10's promise ("emitted again gives every other field byte for byte") holds.
- A plugin is a function, which a manifest cannot record. So `{ ir: true }` with `plugins` is a
  `TypeError` that says the load-time emitter could not emit the program again.

The runtime stays WebGPU only; a WebGL2 tier with pinned overrides is the proposal 0025 names for
later.

## Why

These are the gaps between the runtime and its first two hosts. The site's gap analysis read
`src/lib/shader-runtime.ts` against `typeshade/runtime`'s public exports. Items 1, 3 and 4 block
0025's downstream work: without them, moving the Playground's runner onto the runtime would take
away its override controls, its dropped count, and the options the reader chose. Item 2 is
stepinside's #404: it wanted an `r32float` inverse-depth level and settled for `rgba16float`.

The rest of that analysis has workarounds through the public API, and none belongs here:

- the host's own buffers and textures, bound by name;
- `pass.raw` for a scissor;
- a runtime per mounted program, destroyed with it.

A multisampled texture's layout was a plain bug, fixed on its own (#414).

Alternatives considered:

- **The host edits the WGSL**, replacing an override's default or the text under other options,
  before `rt.load()`. It duplicates what the compiler emits and breaks the manifest's hold on its
  text (Rule 11.10). The fp64 guard's binding, which the options add or remove, would disagree
  with the manifest's `bindings`.
- **The load-time emitter emits the program again with new defaults** (`repack`). That is the
  WebGL2 tier's way, which has no pipeline constants. On WebGPU the pipeline takes them natively,
  with no second compile.
- **A layout the host writes for every texture**, instead of the sample type the program
  implies. It moves to every host what the compiler already knows, which 0025's decision 5 (a
  layout from the manifest, never `'auto'`) set out to avoid.
- **The dropped count through the sink**, as a second kind of event. The sink is the CPU tier's
  type too (`ConsoleSink`), and an event that is not a `console.*` call would reach every sink.

## What it touches

- **Rule 11.10**: the manifest records the options it was packed under. A texture's resource
  carries its sample type, which follows from the calls that read it.
- **Rule 11.11**: the runtime does four things:
  - builds a pipeline with the override values the host gives it by name, and refuses, with a
    `TypeError`, a name the manifest does not declare and a value its type cannot hold;
  - lays out a texture by its sample type;
  - hands the console's counts to the host that takes its lines;
  - runs a program packed under emit options.
- **Surface §69**: `program.render(state)` and `program.compute(entry, options)` take
  `constants`; `submit()` returns the console's counts; `packModule(m, { emit })`.
- **Exports**:
  - `RenderState` gains `constants`.
  - `Program`'s `compute` takes an options argument.
  - `Frame`'s and `Runtime`'s `submit` resolve to the console's counts.
  - `PackOptions` gains `emit`.
  - `BindEntry` gains `sampleType`.
  - The manifest's `PackResource` carries it too.
- **Code**:
  - `src/runtime/program.ts`: the pipeline descriptors, the cache keys and the layout entry;
  - `src/runtime/runtime.ts`: `submit()`;
  - `src/core/reflect.ts`: the sample type, from the texture-sampler pairs `manifest.ts` already
    reads for the WebGL2 tier;
  - `src/core/manifest.ts` and `src/compiler/ts/pack.ts`: the emit options;
  - `src/emit.ts`: `repack` under them.
- **Tests**:
  - `src/runtime/runtime.test.ts`, against the recording device:
    - the override values reach the vertex, fragment and compute stages' `constants`;
    - an unknown name and each type's wrong value are refused with their sentences;
    - two states that differ in one override make two pipelines, and the same values one;
    - a texture only loaded is laid out `unfilterable-float`, and one a sampler reads `float`;
    - `submit()` returns each recorded entry's lines and dropped count, and a runtime with a sink
      prints nothing.
  - `src/core/manifest.test.ts`, over every example: each texture's sample type agrees with the
    calls that read it. A manifest packed under each level and flavor holds that WGSL, and
    `repack` gives it back byte for byte.
  - The user journeys, on WebGPU through `typeshade/runtime` as the packed tarball ships it:
    - a compute entry that reads an override, at its default and at another value, each result
      held to the CPU oracle's run of the module with that value as the override's default;
    - an `r32float` texture bound to a program that loads it.

## What it owes downstream

**typeshade.github.io**

- The Playground's runner moves onto the program runtime; that move is 0025's downstream work,
  and this proposal is what lets it keep what it shows today:
  - the override controls, `playground-bindings.ts`'s `constants()`, reach WebGPU through
    `RenderState.constants` and `compute`'s `constants`;
  - the frame and pixel captures read their dropped count from `submit()`;
  - the canvas runs the manifest `packModule` gives under the reader's emit options.
- Until that move the runner sets WebGPU's `constants` and packs its own bindings, and nothing on
  the site changes.

**vscode-typeshade**

- The skill's `references/host.md` says, in its program runtime section, what `render()` and
  `compute()` take and what `submit()` returns. It names the override values and the console's
  counts there.
