---
id: '0019'
title: A shader calls console.table with one value, and the host prints it as a table
status: implemented
rules:
- '11.9'
surface:
- 66
exports:
- ConsoleMethod
- CONSOLE_METHODS
exports-removed: []
codes: []
examples:
- gpu-console
downstream:
- repo: typeshade.github.io
  what: the Playground's Console pane renders a `table` event as a table (rows by index or field, one column per field or component) instead of one line; every page that lists the five console methods names `table` too (the surface and error-code pages, the `TS8099` example for an unsupported method)
- repo: vscode-typeshade
  what: the skill's `console` rule and references/language.md name `table`; the MCP server's `run` tool prints a `table` event as rows under its line (`tools.test.ts` pins one); docs/design.md §5's DAP `output` row says how a `table` event reads in the debug console
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

A shader can call `console.table` today only to be refused: `TS8099`, "console.table() is not
supported in TypeShade yet. Use log, info, debug, warn, or error." After this change it takes
one value and delivers it, and the host prints a table:

```ts
"use typeshade";

class Particle {
  pos: vec2;
  speed: f32;
}

declare const ps: storage<array<Particle, 4>, "read_write">;

@compute([1])
export function main(): void {
  console.table(ps); // one row per particle, columns pos and speed
}
```

- `console.table(data)` takes exactly one argument, a value any `console.log` argument may be
  (surface §66): a fixed-size array, a struct, a vector, a matrix or a scalar.
- The event is `{ method: 'table', args: [data], span, invocation }`, the shape Rule 11.9
  already gives every console event. The host prints it with its own `console.table`, which is
  what `hostConsole` and the `vite dev` runtime already do by calling `console[e.method]`.
- A matrix is delivered as its columns, an array of column vectors, so a table of a `mat4x4f`
  has four rows of four, the way WGSL indexes it (`m[j]` is column `j`). Every other value is
  delivered as `console.log` delivers it. A scalar prints as one value, as the host's own
  `console.table(3)` does.
- On WebGPU under `console: 'gpu'` a `table` call is recorded like any other: one site, one
  value, the same words. `decodeConsole` gives back the same event. Nothing new is bound, and
  GLSL ES 3.00 records nothing, as for the other methods.
- The second argument of the host's `console.table`, the list of columns to show, is refused
  (`TS8099`) with the remedy: select the fields in the shader, into a smaller struct, or filter
  the table on the host. A list of strings is text the shader cannot hold, and nothing else in
  §66 takes one.
- The editor completes `table` after `console.` and types it `table(tabularData: unknown): void`,
  one parameter, so a second argument is TypeScript's own arity error as well as the compiler's.
- The other methods of `console` stay refused by name, and the refusal's text lists `table`.

## Why

`console.log("ps", ps)` on an array of structs prints one nested line, which is hard to read
past a few elements. The browser's `console.table` is the tool a JavaScript developer reaches
for, and since every console event already reaches a host `console[e.method]`, the method is
nearly free: the work is in the vocabulary (Rule 12.7: the editor and the compiler agree that
`table` exists) and in each host that renders events itself rather than through the browser
console (the Playground pane, the MCP server's text, the debug console).

Alternatives considered:

- **Accept the columns argument as an array literal of string literals**, kept on the host like
  a label (Rule 7.8). It works, but it widens `ConsoleEvent` (a `columns` field every printer
  must learn) for a filter the host can apply itself. It can follow in its own proposal if
  asked for.
- **Refuse a scalar**, since a table of one value is not a table. The host's `console.table`
  accepts one and prints it plainly, and refusing what JavaScript accepts is a rule the author
  has to learn for no gain.
- **Deliver a matrix flat**, as `console.log` does (column-major, 16 numbers for a `mat4x4f`).
  That prints one row of sixteen columns, which reads as neither the matrix nor its columns.

## What it touches

- **Rule 11.9** gains one sentence: `console.table` takes one argument, and a matrix argument
  is delivered as its columns. The rest of the rule (evaluated once, in order, on every target;
  recorded under `console: 'gpu'`) holds unchanged.
- **Surface §66** lists `table` among the methods, with the one-argument form, the matrix
  shape and the refused columns argument.
- **`ConsoleMethod`** gains `'table'`; **`CONSOLE_METHODS`** gains `table`. `ConsoleEvent`,
  `ConsoleSink`, `decodeConsole` and `ConsoleLog` keep their shapes.
- **Code.**
  - `src/core/console.ts`: the method and, in `consoleArgs`, the matrix-to-columns shape for a
    `table` event.
  - `src/compiler/ts/lower/expression-call.ts`: the arity refusal and the refusal's method list.
  - `src/language-service/ambient.ts`: the `table` declaration.
  - `src/core/passes/console-buffer.ts`: nothing beyond the method name, since a site records
    its method already.
- **`TS8099`** keeps its code and meaning; its text for an unsupported console method lists
  `table`, and a second argument to `table` is a new message under the same code.
- **The `gpu-console` example** gains a `console.table` of the struct, so the compile gate reads
  the recorded WGSL for a `table` site and the journey compares it on WebGPU. Its golden moves.
- **Tests.**
  - `src/compiler/ts/console.test.ts`: both halves on the same source (Rule 12.7): `compile()`
    accepts `console.table(x)` and refuses `console.table(x, ["a"])` with `TS8099`, and the
    language service's `getDiagnostics` agrees, with `getCompletions` after `console.` listing
    exactly the six methods.
  - `src/core/passes/console-buffer.test.ts`: a `table` of an array of structs and of a matrix,
    decoded equal to the sink's event.
  - `src/core/debug/console.test.ts`: a stepped `table` call delivers the same event.

## What it owes downstream

**typeshade.github.io**

- The Playground's Console pane renders a `table` event as an HTML table: a row per array
  element (or one row for a struct), a column per field or component. `check-playground.mjs`
  gains a case that logs a table on the CPU and on the GPU and holds the two panes equal.
- Every page that lists the five methods lists six. The error-code page's `TS8099` example for
  an unsupported console method keeps working, with its text updated.

**vscode-typeshade**

- The skill's `console` rule (SKILL.md) and `references/language.md` name `table` and its one
  argument.
- The MCP server's `run` tool prints a `table` event under its `line N, console.table:` heading
  as one indented row per element; `tools.test.ts` pins the output.
- `docs/design.md` §5's DAP `output` row says a `table` event reads as rows in the debug console.

## Decisions for the reviewer

Accepting this proposal accepts each of these. Each is the recommendation above:

1. One argument; the columns argument refused, not carried as labels.
2. A scalar accepted, as the host's `console.table` accepts one.
3. A matrix delivered as its columns for `table` only; `console.log` keeps the flat form.
