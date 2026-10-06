---
id: '0030'
title: A host's draws and dispatches are type-checked against the bindings each entry reaches, from the module's host view
status: accepted
rules:
- '8.21'
- '11.11'
surface:
- 64
- 69
exports:
- BindingsOf
- Pack
- Program
- RenderPipeline
- ComputePipeline
- RenderPass
- Frame
- Runtime
- packModule
- repack
- RuntimeOptions
exports-removed: []
codes: []
examples: []
downstream:
- repo: vscode-typeshade
  what: The skill's references/host.md says a draw's and a dispatch's bindings are typed from the module's host view, and that a manifest read from JSON is untyped until cast
- repo: typeshade.github.io
  what: Nothing to write; the API reference shows the new type parameters of Program, RenderPipeline and ComputePipeline from the JSDoc at the next pin
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## Amendment (2026-10-06)

This revision amends the accepted text in two points, found while implementing it. The merge of
its pull request is its acceptance. Git holds the earlier text.

1. **Three more exports change their printed shape, and nothing else.** `packModule` returns a
   `Pack`, `repack` takes and returns one, and `RuntimeOptions.emit` and `programs` name it. With
   `Pack`'s type parameter, `bun run bake:api-surface` prints each as
   `Pack<Readonly<Record<string, Readonly<Record<string, unknown>>>>>`, the default, where it
   printed `Pack`. Their behaviour and what they accept do not change. The front matter lists them,
   since `scripts/changes.ts` reads the API surface's diff.
2. **`render()` with no entry names.** The accepted text types such a pipeline with "the
   program's only ones". The manifest's type carries each entry's bindings and not its stage, so
   the types cannot tell which entry is the program's only vertex or fragment entry. Such a
   pipeline's draws take the bindings of any one entry of the program: a misspelled name that no
   entry has is still refused, and a binding left out is caught by the runtime at the draw, as
   today. `render({ vertex, fragment })` is typed exactly. Carrying the stage would need a second
   type parameter of `Pack`, which this revision does not add.

## What changes

A host imports a module through the Vite plugin, and the module's default export is its manifest
(0025). The host view, `mesh.shade.typeshade.ts`, types that export as `Pack`. The runtime's
`Bindings` is `Readonly<Record<string, unknown>>`, so `tsc` accepts a draw that leaves a field
out, misspells a binding, or passes a `vec3` where the shader has a `vec4` (#408):

```ts
import mesh from './mesh.shade.ts';
const pipeline = await rt.load(mesh).render({ targets: [format] });
pass.draw(pipeline, { veiw: { viewProj, time } }, geometry); // tsc: fine; the runtime: a TypeError at the first draw
```

The runtime refuses all three, with a sentence that names the entry, its line and the binding.
But it refuses at the first draw, and an application that draws on demand reaches that when a
scene first shows. When a shader's uniform gains a field, the only check that the host kept up
is running it.

After this change the host view types the manifest with the bindings each entry reaches, and the
runtime carries that type through:

```ts
import mesh from './mesh.shade.ts'; // Pack<{ vs: {...}; fs: {...} }>, from the host view
const pipeline = await rt.load(mesh).render({ targets: [format] }); // RenderPipeline<vs's & fs's bindings>
pass.draw(pipeline, { veiw: { viewProj, time } }, geometry);
//                    ~~~~ tsc: "veiw" is not a binding of vs or fs; "view" is missing
```

- **The host view types the manifest.** `declare const program: Pack<{ vs: VsBindings; fs:
FsBindings }>`: one entry of the record for each entry of the program. Each lists the bindings
  the entry reaches, by the names the source declares, each with the type of the value a draw or
  a dispatch may pass for it:
  - a buffer: its host value (Rule 8.21), written as the host view already writes a parameter:
    a struct as an object, a vector as a tuple, a matrix as its flat array. Or a `Resident` of
    that value, or the host's own buffer;
  - a texture: a `Texture` or the host's own texture or view;
  - a sampler: a `Sampler` or the host's own sampler.

  The types are written inside `Pack<…>`. A name the module exports is never taken, and a
  module with no binding writes `Pack<{}>`.

- **The runtime carries it.**
  - `rt.load(program)` returns a `Program<E>`.
  - `program.compute(entry)` returns a `ComputePipeline` typed with that entry's bindings.
  - `program.render(state)` returns a `RenderPipeline` typed with the bindings its two entries
    reach: the ones `vertex` and `fragment` name, or the program's only ones.
  - `pass.draw()`, `pipeline.draw()`, `frame.dispatch()` and `pipeline.dispatch()` take those
    types.
  - An entry name that is not one of the program's is an error too.
- **An untyped manifest stays untyped.** `Pack` with no argument is
  `Pack<Record<string, Bindings>>`, which takes any bindings, as today. A manifest read from JSON,
  or packed by `packModule` at run time, has that type unless the host casts it. The runtime's
  checks at the draw stay as they are: they are what an untyped host has, and what catches a value
  the types cannot describe (an array's length, a texture's format).

## Why

- The information is already there. The manifest lists each entry's bindings and each binding's
  byte layout, and the host view already writes a host value's type for every parameter the host
  calls (Rule 8.21). A draw's bindings are the same values, going the other way.
- Rule 12.7 makes the editor and the compiler one vocabulary. For a draw today, the editor has no
  word at all, and the runtime alone refuses what the host view could have said.
- An engine on the runtime (#335's ② and ③) is mostly draws and dispatches. A field a material
  gains is the common change, and it is the one that now slips past `tsc`.

Alternatives considered:

- **Named binding types beside the module's exports** (`MeshVsBindings`, as #408 suggests). They
  would take names from the module's namespace, where the author's own exports live, and a
  module that exports a `VsBindings` would collide. The types live inside `Pack<…>`, and a host
  that wants a name writes `BindingsOf<typeof mesh, 'vs'>`, a type the runtime exports.
- **Typing by a generic argument the host writes** (`rt.load<MeshBindings>(mesh)`). It moves to
  every host a type the build already knows, and it can be wrong.
- **A typed wrapper generated per module**, beside the manifest. A second API over the same
  runtime, which the program runtime's decision 3 in 0025 (one public runtime) set out to avoid.

## What it touches

- **Rule 8.21**: the host value of a binding is the one a parameter of that type takes, and the
  host view writes it for each binding an entry reaches.
- **Rule 11.11**: the runtime's `load`, `render`, `compute`, `draw` and `dispatch` carry the
  manifest's binding types.
- **Surface §64** (the host view): the default export's type. **Surface §69**: typed draws and
  dispatches, `BindingsOf`, and the untyped `Pack`.
- **Exports**:
  - `Pack` takes a type parameter, defaulted.
  - `Program`, `RenderPipeline` and `ComputePipeline` take one each.
  - `RenderPass`'s `draw`, `Frame`'s `dispatch` and `Runtime`'s `load` are generic over them.
  - `BindingsOf` is new.
- **Code**:
  - `src/compiler/ts/host-face.ts`: the view's `program` declaration, from the manifest's entries
    and `hostTypeOf`;
  - `src/core/manifest-types.ts`: `Pack`'s parameter;
  - `src/runtime/program.ts` and `src/runtime/runtime.ts`: the generics. Nothing changes at run
    time.
- **Tests**:
  - `src/compiler/ts/host-face.test.ts`: the view of a module with a uniform struct, a storage
    array, a texture, a sampler and a vertex and a fragment entry declares each entry's bindings
    with those types.
  - A type test over that view, compiled by `tsc` as the user journeys compile a host file:
    - a draw with every binding compiles;
    - a misspelled binding, a missing field, a `vec3` for a `vec4` and an unknown entry name are
      each an error at their argument;
    - an untyped `Pack` takes anything.
  - The runtime's own refusals are unchanged, and `src/runtime/runtime.test.ts` keeps them.

## What it owes downstream

**vscode-typeshade**

- The skill's `references/host.md` says, in its program runtime section, that a draw's and a
  dispatch's bindings are checked by `tsc` from the module's host view. It also says that a
  manifest read from JSON is untyped until it is cast to `Pack<BindingsOf<…>>` of its module.

**typeshade.github.io**

- Nothing to write. The API reference shows the new type parameters from the JSDoc at the next
  pin.
