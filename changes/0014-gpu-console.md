---
id: '0014'
title: A console call in a compute or fragment shader reaches the host from WebGPU too, as the same events the CPU delivers, when a compile asks for it, and a string literal is a label
status: draft
rules:
- '6.11'
- '7.8'
- '11.9'
surface:
- 28
- 66
exports:
- CompileOptions
- CompileResult
- ConsoleEvent
- ConsoleLog
- ConsoleSite
- decodeConsole
- ReflectOptions
- Expr
exports-removed: []
codes:
- TS8071
examples:
- gpu-console
downstream:
- repo: typeshade.github.io
  what: A log pane in the Playground fed by the CPU run (consoleSink) and by the WebGPU run (the `_console` buffer created, bound, reset and decoded in src/lib/compute-runner.ts and src/lib/shader-runtime.ts, and skipped by name in the bindings panel and the Reflection pane as `_fp64` is); the gpu-console example in the gallery, the picker, the stills and the Korean blurbs; a TS8071 entry on the error-code pages; API reference rows for decodeConsole, ConsoleLog and ConsoleSite and a category for them; the concept page's "no TypeShade code touches a WebGPU object" and injected-binding copy; the Korean guide pages AUTHORING.md changes, and glossary terms for the console buffer kept apart from the driver log
- repo: vscode-typeshade
  what: The skill's "console.log takes values, never text, and runs only on the CPU" (SKILL.md) and "removed from WGSL and GLSL" (references/language.md) rewritten around labels and the opt-in buffer, the binding rule's "every resource is in group 0 in declaration order" noting the injected `_console`, a TS8071 row in references/diagnostics.md, and docs/design.md §5's DAP table gaining a console-event row
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Roadmap 0.2 item 6 is half shipped. The CPU oracle and the generated CPU code deliver each
`console.*` call to `compile(src, { consoleSink })`. WGSL and GLSL ES 3.00 drop the call: the
optimizer removes it as a call with no effect, keeping the arguments' own effects. This proposal
is the other half, #76 steps 2 to 4, written against `main` as it is rather than against #76's
first sketch (see "Why").

Today this does not compile, because a string is refused (`TS8099 A string has no GPU
representation …`):

```ts
"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

@compute([64])
export function scale(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) {
    return;
  }
  const y = xs[gid.x] * 2.;
  if (y > 100.) {
    console.warn("large value at", gid.x, y);
  }
  out[gid.x] = y;
}
```

After this change:

- **A string literal argument is a label** (Rule 7.8's one exception, surface §28). It never
  reaches the GPU: it is kept in the site table on the host, and the event carries it in its
  place, as JavaScript would pass it. Only a literal is a label. `"x" + y`, a template with a
  hole, or a string anywhere else stays refused with today's sentence; a template with a hole
  gets a remedy that names the value as its own argument.
- **What an argument may be** does not change: every value with a fixed size, as the CPU takes
  today (a scalar, `bool`, a vector, a matrix, the `f64` family, a fixed-size array, a struct of
  those, an enum member).
- **The CPU is unchanged** except that the event carries the labels, and, for an entry that takes
  `global_invocation_id` or `position`, its `invocation`.
- **WGSL records the call when a compile asks for it**: `compile(src, { console: 'gpu' })`.
  The default stays `'cpu'`, and with it no emitted byte moves. With `'gpu'`:
  - The compiler adds one binding, `_console`, a `read_write` storage buffer at group 0, the first
    binding past the module's own group-0 bindings. That is the slot the `_fp64` guard already
    takes, by the same rule, so it never moves a binding the author declared (Rule 6.11).
    `reflect(m, { console: 'gpu' })` lists it, as it lists `_fp64`.
  - Each call, after its arguments are evaluated once, left to right, reserves words with one
    `atomicAdd` on the buffer's cursor. It then writes the site number, the invocation id (three
    words: `global_invocation_id` on a compute entry, the pixel from `position` on a fragment
    entry) and each argument as `u32` words: a float by `bitcast`, a `bool` as 0 or 1, a vector,
    matrix, array or struct component by component, an `f64` as its two halves.
  - Nothing sizes the buffer at compile time. The shader reads `arrayLength`, so the host
    decides the capacity by the size of the buffer it binds. An entry that does not fit is
    dropped and counted; it is never written in part.
  - `CompileResult.console` is the `ConsoleLog`: the slot and the site table (for each site its
    method, span, labels and argument types). It is data, so a worker can post it.
- **The host decodes the buffer into the same events**: `decodeConsole(words, log)` from
  `typeshade` returns `{ events, dropped }`. The events are `ConsoleEvent`s, the type the CPU
  sink already receives, ordered by invocation (z, then y, then x) and by program order within
  one invocation, which is the order the CPU tier runs a dispatch in. Handed to one sink, a
  kernel logs the same lines on the CPU and on WebGPU. The host's part is four steps: create the
  buffer, bind it at the slot, write zero to its first two words before each dispatch or draw,
  and copy it back, map it and decode it.
- **What is not recorded, and says so.** Under `'gpu'`, `TS8071` (a warning) marks a call the
  WGSL cannot record, on the call, with the reason:
  - a vertex entry reaches it. Tint refuses a `read_write` storage buffer in any function a
    vertex entry reaches, so the call records nothing in that function on any stage (Rule 8.3's
    shape: move the call to the fragment side);
  - an argument has no fixed size or is not a value (a runtime-sized array, a texture, a
    sampler). These compile today on the CPU, and refusing them would be a break under Rule
    13.9, so they stay accepted and are not recorded;
  - the module already binds eight storage buffers in the stage, WebGPU's default
    `maxStorageBuffersPerShaderStage`, so a ninth would fail the pipeline.

  GLSL ES 3.00 has no storage buffer and no atomic and records nothing, with no diagnostic
  (Rule 10.5 defers that lowering family; #76 step 5 is the WebGL2 slot texture, if it is ever
  wanted).

- **Production** (`typeshade/emit-prod`) never records. Its emit is the default.

## Why

`docs/dx.md` row 5 names the second debugging world as a thing TypeShade removes, and says of
`main`: "The GPU's log buffer is not there yet (item 6, half shipped)". Roadmap item 19, the
divergence report, is written to reuse "the log buffer from 6", so the buffer is also the
transport for per-invocation records the compiler will write itself. The layout below leaves room
for that: a site is a row of a table, and item 19 adds rows of another kind.

**Measured** on Tint and SwiftShader in headless Chromium 141.0.7390.37, the compile gate's
browser and flags, with the WGSL this lowering would write, by hand:

- **Compute, 256 invocations, 200 in bounds, two sites** (a `log` in the entry and a `warn` in a
  helper): 264 events. Decoded and ordered, they equal the CPU run exactly, every `f32` bit for
  bit. In buffer order they did not, so ordering by invocation is what makes the two read the
  same.
- **The same kernel into a 64-word buffer**: 10 events decoded, 254 counted as dropped, 264 in
  all, and every decoded event is one the CPU produced. An entry that straddles the end writes
  its site word only, which is how the decoder knows where the written entries stop.
- **Fragment, a 64×64 target**: the diagonal logs and the odd pixels `discard` first. 32 events,
  all even pixels, in raster order. A discarded invocation writes nothing after `discard`.
- **Fragment with `dpdx` on a small triangle**: 528 events for 528 covered pixels. Helper
  invocations write nothing.
- **A vertex entry that reaches the buffer**: the module is refused by Tint:
  `var with 'storage' address space and 'read_write' access mode cannot be used by vertex pipeline stage`.
- **The slot**: the buffer at group 0 past the module's bindings, and at group 3 alone, both
  compiled and ran with `layout: 'auto'`; at group 3, groups 1 and 2 could be left unset.

The design questions, and what this proposal takes:

1. **Opt-in, not default-on.** #76 put the buffer in every module with a console call, with a
   `'drop'` option for production. That moves the emitted bytes and the binding layout of every
   shader that logs, and a host that does not know about the buffer fails validation on its next
   dispatch. `docs/debugging.md` §1.1 turned a GPU printf down for that reason. Opt-in answers
   it: the build that wants the lines asks, like a debug build, and a production build is the
   default. A runtime (0009's host import, 0012's kernel functions) turns it on in its
   development mode.
2. **The slot.** #76 left open "the highest unused group, or a fixed group such as 3". Both work
   on Chromium 141. This proposal takes a third: group 0, past the module's own bindings, because
   the `_fp64` guard already takes that slot by that rule, `reflect()` already reports such a
   binding, and every host that handles `_fp64` (the site's Playground does, by name) handles
   this one the same way. It also keeps the compute runner's group-0 bind group enough, and needs
   no browser to accept unset empty groups. The reviewer may prefer group 3: it is stable under
   edits to the author's bindings, at the cost of both of those.
3. **All five methods.** #76 accepted `log` only; `main` lowers `log`, `info`, `debug`, `warn`
   and `error`. The method is a column of the site table and costs nothing on the GPU.
4. **Arrays and structs are recorded.** #76 refused them; `main` compiles them on the CPU, so a
   refusal would be a break. The site table carries the type, so the decoder rebuilds the value
   the CPU delivers.
5. **The order.** The decoder orders by invocation. A caller that wants the order the GPU wrote
   in has it before the sort; this proposal does not add an option for it.

`docs/debugging.md` §1.1 calls "a shader trace buffer" "a defensible separate feature; it is not
debugging". This is that feature. It records values; it does not step, and the stepper stays the
CPU's. The implementation rewrites that bullet to say so and to point at surface §66.

Alternatives considered:

- **A statement `{ s: 'log', site, args }` in the IR**, as #76 sketched. `main` already carries
  the call as a `call` node and every pass keeps it, so the call stays a call and gains its
  labels.
- **Zeroing the whole buffer between runs.** The straddling entry's site word makes it
  unnecessary: the host resets two words.
- **A capacity compile option.** `arrayLength` makes the capacity the host's, with no emitted
  byte depending on it.
- **Recording on WebGL2 through a slot texture.** One entry per invocation, a second render
  target, and a GLSL lowering Rule 10.5 defers. Not now.

## What it touches

- **Rule 6.11 (new).** The one binding the compiler adds for a console call: when, where (group
  0, past the module's bindings, after `_fp64` when both are there), its type, and that
  `reflect()` reports it.
- **Rule 7.8.** Its string refusal gains the exception: a string literal argument of a `console`
  call is a label, kept on the host.
- **Rule 11.9 (new).** A `console` call computes nothing a shader reads. Its arguments are
  evaluated once, in order, on every target. On the CPU it delivers an event to the sink. On
  WGSL under `'gpu'` it records the event in the buffer, and the host decodes the same events in
  the CPU's order. GLSL ES 3.00 and a function a vertex entry reaches record nothing.
- **Surface §28.** The string row gains the label exception.
- **Surface §66 (new): "`console`: what reaches the host, from the CPU and from the GPU".** The
  console surface has no section today. It holds the methods, what an argument may be, labels,
  the sink, the `'gpu'` option, the buffer's layout, the host's four steps, `decodeConsole`, the
  order, `TS8071` and what is not recorded. It is the next free number after 0012's §65.
- **TS8071 (new).** The warning. TS8069 is 0010's and TS8070 is 0012's.
- **Exports**, re-baked into `src/__api__/surface.md` (Rule 11.6):
  - `CompileOptions` gains `console?: 'cpu' | 'gpu'`;
  - `CompileResult` gains `console?: ConsoleLog`;
  - `ConsoleEvent` gains `invocation?`, and its `args` may hold a label string;
  - `ConsoleLog` and `ConsoleSite` (new types) and `decodeConsole` (new function), from
    `typeshade`;
  - `ReflectOptions` gains `console?: 'cpu' | 'gpu'`;
  - `Expr`'s `call` variant gains an optional `labels` field: the author's arguments in order, a
    string for a label and a number for an index into `args`. Every pass that spreads a call node
    keeps it.
- **Example `gpu-console`**: the kernel above. The compile gate compiles its WGSL with and
  without `'gpu'` on Tint.
- **Code.**
  - `src/compiler/ts/lower/expression-call.ts`: labels.
  - `src/core/oracle.ts`, `src/core/cpu-codegen.ts` and the stepper: labels and `invocation`.
  - `src/core/passes/console-buffer.ts` (new): the lowering, IR to IR, after `fp64Lower`, before
    the optimizer, so the atomics and the stores are effects every optimizer pass already keeps
    (Rule 11.1: nothing new in the shared walk).
  - `src/core/console.ts`: the site table and `decodeConsole`.
  - `src/compiler/ts/compile.ts` and `src/core/reflect.ts`: the option.
- **Docs.** `AUTHORING.md`, `docs/debugging.md` §1.1, `docs/dx.md` row 5, the roadmap's item 6
  row, and a CHANGELOG entry (Rule 13.8).
- **Tests.**
  - Both halves (CLAUDE.md): a label and each `TS8071` reason asserted in `compile()` and in the
    language service on the same source. The ambient `Console` (`src/language-service/ambient.ts`)
    takes `Numeric | boolean` today, so the editor refuses a label, and also a struct, an array
    and a matrix the compiler accepts: a Rule 12.7 gap this change closes by widening the
    parameter to the loggable types and `string`, with a parity test over each.
  - The encoder and decoder on the CPU, with no GPU: the lowered module run on the oracle with
    the buffer bound to an array, decoded, equals the sink's events for every example that logs,
    including an overflow case.
  - The effects: a call whose argument writes keeps the write on every target, under both
    options.
  - A journey on WebGPU: `gpu-console` dispatched and decoded, equal to the CPU run.

## What it owes downstream

**typeshade.github.io**

- **The Playground** has no log pane, and no `compile()` or `compileModule` call passes a sink.
  It gains a pane fed by the CPU run first, then by the WebGPU run when the page has a device:
  - `src/lib/compute-runner.ts` and `src/lib/shader-runtime.ts` create, bind, reset and decode
    the buffer;
  - the bindings panel and the Reflection pane skip `_console` by name, as they skip `_fp64`;
  - `DESIGN.md`'s Playground paragraph, copy in both locales, and a `check-playground.mjs` check.
- **The `gpu-console` example**: gallery entry, picker row, still, Korean blurb.
- **TS8071** on the error-code pages, with a trigger and a fix program.
- **The API reference**: rows and a category for `decodeConsole`, `ConsoleLog` and
  `ConsoleSite`. `src/core/console.ts`'s "CPU oracle" category no longer describes all of it.
- **The WebGPU and WebGL2 concept page**: "No TypeShade code touches a WebGPU object" still
  holds (the host binds the buffer), and the injected-binding copy gains `_console` beside
  `_fp64`.
- **The Korean guide** pages `AUTHORING.md` changes, and glossary terms for the console buffer
  kept apart from the driver log's "로그" and "디코딩".

**vscode-typeshade**

- **The skill**: `SKILL.md` ("`console.log` takes values, never text, and runs only on the CPU")
  and `references/language.md` ("removed from WGSL and GLSL and prints only in a CPU run") are
  rewritten around labels and the opt-in buffer. The binding rule ("every `declare` resource is
  `@group(0)`, bound in declaration order") notes the injected `_console`, and
  `references/diagnostics.md` gains a TS8071 row.
- **`docs/design.md` §5**: the debug adapter's DAP table gains a row for a console event (an
  `output` event), for when the adapter is built.
