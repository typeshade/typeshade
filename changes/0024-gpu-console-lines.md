---
id: '0024'
title: A console line from a shader says where it ran, a production build records when asked, and a host's own pipeline reads the console buffer with one helper
status: draft
rules:
- '8.24'
surface:
- 64
- 66
- 67
exports:
- typeshade
- TypeshadeViteOptions
- recordConsole
- ConsoleRecorder
- RecordConsoleOptions
- printConsole
- PrintConsoleOptions
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The API reference gains the `typeshade/console` subpath and its exports, each in a category (`check:api` fails an export with none), and `typeshade/vite`'s options; the pages that quote the host import's console sentence (the guide sections AUTHORING.md takes from surface §67, re-translated in Korean) say that a line carries its tier and invocation and that `vite build` records with `console: 'always'`; the Playground's Console tab shows its lines in the same form as the printed ones (the tier, then the invocation)
- repo: vscode-typeshade
  what: The skill's references/host.md ("In `vite dev`, a `console.*` call in an entry prints in the browser console from the GPU. A production build records nothing.") names the plugin option and the printed form; references/language.md's console rule names `typeshade/console` for a host that builds its own pipeline; the MCP server's `run` tool prints its console lines through `printConsole`'s format (a tier badge and the invocation), which `tools.test.ts` pins; docs/design.md §5's DAP `output` row says the debug console shows the same prefix
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Three things change about how the console calls a shader makes reach a person reading them.
Change 0014 made the calls reach the host from WebGPU as the same events the CPU delivers
(Rule 11.9, surface §66). This proposal is about the last step: what the host prints, when it
prints it, and what a host that does not use the import has to write to get there.

### 1. A printed line says which tier ran it and which invocation made it

Today the host import prints a decoded event as `console[e.method](...e.args)`, and the CPU
tier's sink (`hostConsole`) does the same. A compute entry dispatched over 64 invocations that
calls `console.log("x", v)` prints 64 lines of `x 1.5`, `x 2.5`, … with nothing that says which
invocation printed which, or that they came from the GPU at all. The event carries both
(`invocation`, and the path that delivered it); the printed line drops them.

After this change every line the runtime prints starts with a badge naming the tier and, when
the event has one, the invocation:

```
 GPU  [3, 0, 0]  x 4.5
 CPU  [3, 0, 0]  x 4.5
 CPU  height 0.25
```

- The badge is `GPU` for an event decoded from the console buffer and `CPU` for one the CPU
  tier's sink delivered. In a browser it is drawn as a small label with the `%c` directive; Node
  ignores `%c`, so a test runner or a server prints the same text without the styling.
- The invocation follows the badge as `[x, y, z]`: `global_invocation_id` for a compute entry,
  the pixel `[x, y, 0]` for a fragment entry, exactly the `invocation` field. A helper a host
  calls directly (surface §64) is not an invocation, and its line has the badge alone.
- The line keeps its method: `console.warn` stays a warning and `console.error` an error, so the
  browser's filters still work.
- The badge and the invocation go in the format string, and the event's own arguments follow as
  arguments. A label that holds `%d` or `%s` is printed as written, where today it is read as a
  directive because it is the first argument.
- A `console.table` event prints the badge and the invocation on a `console.log` line, then the
  table with the host's own `console.table`, since the table's second argument is its columns.
- The warning for calls that did not fit the buffer carries the same badge and names the entry,
  as it does now.

The events themselves do not change: `ConsoleEvent` keeps its shape, `decodeConsole` returns
what it returns, and a sink a host passes gets the same object. Only the printing changes.

### 2. A production build records when the plugin is asked to

Today `typeshade/vite` records the console in `vite dev` and never in `vite build` (Rule 8.24,
surface §67). A problem that shows only in a deployed build, or only on a device the developer
does not run `vite dev` on, cannot be looked at through the console at all.

After this change the plugin takes options:

```ts
// vite.config.ts
export default defineConfig({ plugins: [typeshade({ console: 'always' })] });
```

- `console: 'dev'` records in `vite dev` and not in `vite build`. It is the default, so
  `typeshade()` behaves exactly as it does today.
- `console: 'always'` records in both. A production build that records pays for it on every
  dispatch and draw of an entry that logs: one storage buffer bound, one atomic add per call,
  and one readback after the work. The plugin prints one line when the build starts saying the
  build records the console.
- `console: 'never'` records in neither, for a developer who wants `vite dev`'s WGSL to be the
  production WGSL byte for byte.
- `consoleBytes` sets the size of the buffer the runtime binds for each dispatch and draw. The
  default is today's 1 MiB. A frame that logs every pixel fills any buffer; the dropped count
  says so, and this is how a developer gives it more room.

What an entry records, and why a call is not recorded (`TS8071`), do not change.

### 3. A host that builds its own pipeline reads the buffer with one helper

The import runtime binds the console buffer, copies it back and prints it. A host that compiles
with `compile(src, { console: 'gpu' })` and builds its own WebGPU pipeline gets the recorded
WGSL and the `ConsoleLog`, and then writes the rest itself: a zeroed storage buffer of some
size, its layout entry (visible to the fragment and compute stages, never the vertex stage), the
bind group entry at `log.group` and `log.binding`, a copy into a mappable buffer after the pass,
the map, `decodeConsole`, and a print. That is about thirty lines, and every host writes the
same thirty.

After this change a new subpath, `typeshade/console`, holds the helper the import runtime uses,
and nothing that imports the compiler, so a host that compiled at build time ships only this:

```ts
import { recordConsole } from 'typeshade/console';

// `log` is `compile(src, { console: 'gpu' }).console`, kept beside the WGSL at build time.
const rec = recordConsole(device, log, { bytes: 1 << 20, label: 'particles' });
const layout = device.createBindGroupLayout({ entries: [...mine, rec.layoutEntry] });
// ... the pipeline over that layout, and a bind group with `rec.entry` in `rec.group`
pass.dispatchWorkgroups(64);
pass.end();
rec.copy(encoder); // before the submit
device.queue.submit([encoder.finish()]);
await rec.print(); // maps, decodes and prints in the CPU's order, badge and invocation first
```

- `recordConsole(device, log, options?)` makes a zeroed buffer and returns a `ConsoleRecorder`:
  `group`, `entry` (the bind group entry), `layoutEntry` (the layout entry, fragment and compute
  visibility), `copy(encoder)`, `read()` (resolves to `{ events, dropped }`, what
  `decodeConsole` returns), `print()` (reads and prints), and `destroy()`. One recorder is one
  dispatch or draw; its buffers are released once it has been read.
- `printConsole(events, options?)` prints events as part 1 says, with `tier` (`'gpu'` or
  `'cpu'`), `label` (the entry's name, used in the dropped warning) and `dropped`. The import
  runtime and the CPU tier's `hostConsole` both print through it, so a line looks the same
  whichever path printed it.
- `typeshade/console` also re-exports `decodeConsole` and the types it reads (`ConsoleEvent`,
  `ConsoleLog`, `ConsoleSite`, `ConsoleMethod`), which the main entry keeps exporting as well.

## Why

A console line is read by a person, and a person debugging a shader asks two things of it
first: did this come from the GPU or from the CPU, and which invocation said it. Both are in the
event already, and the Playground's Console tab shows both. The browser console, where most
developers look, shows neither.

TypeGPU prints its GPU console lines with a `GPU` label, and does it for every draw and
dispatch without the host doing anything, because TypeGPU owns the pipeline: its `afterSubmit`
reads its own log buffer back. TypeShade's import runtime owns its pipelines too, and prints
the same way after this change. A host that uses `compile()` owns its pipeline, and the helper
in part 3 is the piece it cannot get from the import.

Alternatives considered:

- **Print the invocation as an argument after the event's own** (`console.log(...args, inv)`).
  The line then reads as if the shader logged the invocation, and a table has nowhere to put it.
- **A badge on GPU lines only.** A line with no badge would then mean "the CPU" only by
  absence, and a host that falls back to the CPU tier on a machine with no WebGPU would print
  lines that look like the host's own `console.log`. Both tiers are named.
- **Record in production through an environment variable** (`TYPESHADE_CONSOLE=1`). The build's
  configuration is `vite.config.ts`; a variable is one more place for a developer to look, and
  it is invisible in the repository that ships the build.
- **Put the helper on the main entry.** The main entry carries the front end, and a host that
  compiled at build time would pull the TypeScript compiler into its bundle to read a buffer.
  `typeshade/runtime` is not API (it is the generated modules' contract). A subpath of its own
  is what `typeshade/debug` and `typeshade/emit-prod` already are.
- **Leave the buffer size fixed.** 1 MiB is 43 690 lines of two numbers, less than one line per
  pixel of a 640 × 480 frame. Without the option, a developer who needs more changes the
  package.

## What it touches

- **Rule 8.24** changes one sentence: in `vite dev`, or in any build with `console: 'always'`,
  an entry's WGSL records its calls, and the runtime prints each event after the dispatch or
  the draw, in the CPU tier's order, with its tier and invocation; `console: 'never'` records
  in neither.
- **Surface §64** (the plugin): `typeshade()` takes `{ console?, consoleBytes? }`, with the
  default that keeps today's behaviour.
- **Surface §66**: the printed form, badge and invocation, and `typeshade/console` for a host
  with its own pipeline; the events themselves are unchanged.
- **Surface §67**, "`console.*` from an entry": the options, the printed form, and the
  production build that records when asked.
- **Exports.**
  - `typeshade` (in `typeshade/vite`) gains an optional `options` parameter,
    `TypeshadeViteOptions`. `TypeshadeVitePlugin` keeps its shape.
  - `typeshade/console`, a new subpath: `recordConsole`, `ConsoleRecorder`,
    `RecordConsoleOptions`, `printConsole`, `PrintConsoleOptions`, and the re-exported
    `decodeConsole`, `ConsoleEvent`, `ConsoleLog`, `ConsoleSite` and `ConsoleMethod`, which
    keep their shapes.
- **Code.**
  - `src/core/console-print.ts` (new): `printConsole` and the badge.
  - `src/core/console-record.ts` (new): `recordConsole`, which is today's `consoleFor` in
    `src/core/host-entry.ts` made public, with `read`, `layoutEntry` and `destroy`.
  - `src/core/host-entry.ts`: `consoleFor` and `printEvent` give way to the two above.
  - `src/core/host-runtime.ts`: `hostConsole` prints through `printConsole` with the CPU badge.
  - `src/vite.ts`: the options, and the one line a recording production build prints.
  - `src/console.ts` (new): the subpath's barrel. `package.json` gains the `./console` export.
- **Tests.**
  - `src/core/console-print.test.ts`: the format string for each method, a label holding
    `%d`, a table, an event with no invocation, the dropped warning, against a recorded fake
    `console`.
  - `src/core/console-record.test.ts`: `read()` on a fake device returns what `decodeConsole`
    returns for the same words, and `layoutEntry` never names the vertex stage.
  - `src/vite.test.ts`: `console: 'always'` records under `vite build`, `'never'` records under
    `vite dev`, and the default records exactly as today.
  - The import journey (`scripts/user-journey.ts`): the printed `vite dev` lines carry the badge
    and the invocation, in order, and a production build made with `console: 'always'`
    prints them too.
  - A journey for a host that builds its own pipeline with `recordConsole`, on WebGPU, whose
    events equal the CPU oracle's.

## What it owes downstream

**typeshade.github.io**

- The API reference gains `typeshade/console` and its exports, each in a category, and the
  options of `typeshade/vite`.
- The Korean guide sections that AUTHORING.md changes are translated again.
- The Playground's Console tab already shows the invocation. It gains the tier on each line in
  the same words the printed badge uses, so the tab and the browser console read alike.

**vscode-typeshade**

- The skill's `references/host.md` names `console: 'always'` and the printed form, and
  `references/language.md` names `typeshade/console` for a host with its own pipeline.
- The MCP server's `run` tool prints its lines through `printConsole`'s format; `tools.test.ts`
  pins it.
- `docs/design.md` §5's DAP `output` row says the debug console shows the same prefix.

## Decisions for the reviewer

Accepting this proposal accepts each of these. Each is the recommendation above:

1. Every printed line carries its tier, `GPU` or `CPU`, and its invocation when it has one,
   in the format string, drawn with `%c` in a browser.
2. `typeshade({ console: 'dev' | 'always' | 'never', consoleBytes })`, defaulting to `'dev'`
   and 1 MiB, which is today's behaviour.
3. A new subpath, `typeshade/console`, holds `recordConsole` and `printConsole`, and the import
   runtime and the CPU tier print through `printConsole`.
