---
id: '0028'
title: A host sets a program's overrides for each pipeline of the program runtime, by name
status: draft
rules:
- '11.11'
surface:
- 69
exports:
- RenderState
- Program
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The Playground's override controls reach a WebGPU pipeline through the runtime's constants once its runner moves onto the program runtime (0025's downstream work, which this unblocks); nothing on the site changes before that
- repo: vscode-typeshade
  what: The skill's references/host.md, whose program runtime section says what render() and compute() take, names the override values
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

An override is a specialization constant: the pipeline sets it (surface §15). The program
runtime makes the pipelines (Rule 11.11), and today it makes each one with no constants, so every
override takes the default its declaration states. A host of the runtime has no way to set one.

After this change the host sets them for each pipeline, by the names the source declares and the
manifest's `overrides` lists:

```ts
const program = rt.load(scene);
const fine = await program.render({ targets: ['bgra8unorm'], constants: { quality: 3 } });
const coarse = await program.render({ targets: ['bgra8unorm'], constants: { quality: 1 } });
const step = await program.compute('step', { constants: { iterations: 64 } });
```

- `RenderState` gains `constants`, and `program.compute(entry, options)` takes
  `{ constants }`. Each is a record of override name to value, handed to every stage of the
  pipeline as WebGPU's `constants`.
- An override the record leaves out takes its declared default, as it does today.
- A name the manifest's `overrides` does not list is a `TypeError` that names the program's
  overrides. So is a value its type cannot hold: an `f32` takes a finite number, an `i32` or a
  `u32` an integer in its range, and a `bool` a boolean. WebGPU would otherwise report a
  validation error with no name of the source in it, or convert the value silently.
- The pipeline cache keys on the values, so two states that differ only in an override are two
  pipelines, and the same values give the same pipeline back.

The runtime stays WebGPU only; a WebGL2 tier with pinned overrides is the proposal 0025 names for
later.

## Why

The site's Playground lets a reader move an override and see the frame change, and its runner
sets the pipeline's `constants` to do it. 0025 owes the site that runner's move onto the program
runtime, and without `constants` the move would take the override controls away on WebGPU. An
engine has the same need: a quality level or a light count is an override precisely so one module
serves several pipelines.

Alternatives considered:

- **The host edits the WGSL**, replacing an override's default before `rt.load()`. It duplicates
  what the compiler emits, breaks the manifest's hold on the text (Rule 11.10), and makes a new
  shader module for every value.
- **The load-time emitter emits the program again with new defaults** (`repack`). That is the
  WebGL2 tier's way, which has no pipeline constants. On WebGPU the pipeline takes them natively,
  with no second compile.

## What it touches

- **Rule 11.11**: the runtime builds a pipeline with the override values the host gives it by
  name, and refuses a name the manifest does not declare and a value its type cannot hold, with a
  `TypeError`.
- **Surface §69**: `program.render(state)` and `program.compute(entry, options)` take
  `constants`.
- **Exports**: `RenderState` gains `constants`; `Program`'s `compute` takes an options argument.
- **Code**: `src/runtime/program.ts`, the pipeline descriptors and the cache keys.
- **Tests**: `src/runtime/runtime.test.ts`, against the recording device: the values reach the
  vertex, fragment and compute stages' `constants`; an unknown name and each type's wrong value
  are refused with their sentences; two states that differ in one override make two pipelines, and
  the same values one. On WebGPU, a user journey dispatches a compute entry that reads an
  override, through `typeshade/runtime` as the packed tarball ships it, at the override's default
  and at another value, and holds each result to the CPU oracle's run of the same module with that
  value as the override's default. The oracle reads an override as its default (it is the
  un-specialized mirror), so no example of the compile gate's program tier can check a value the
  pipeline sets: none of them reads an override from a compute entry.

## What it owes downstream

**typeshade.github.io**

- The Playground's override controls, `playground-bindings.ts`'s `constants()`, reach WebGPU
  through `RenderState.constants` and `compute`'s `constants` when the runner moves onto the
  program runtime. That move is 0025's downstream work; this proposal is what lets it keep the
  controls. Until then the runner sets WebGPU's `constants` itself, and nothing changes.

**vscode-typeshade**

- The skill's `references/host.md` says, in its program runtime section, what `render()` and
  `compute()` take. It names the override values there.
