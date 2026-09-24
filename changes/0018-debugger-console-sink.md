---
id: '0018'
title: A debug session delivers the console calls it steps over to a sink, as the CPU oracle does
status: implemented
rules: []
surface:
- 66
exports:
- DebugSessionOptions
- startDebugSessionFromConfig
exports-removed: []
codes: []
examples: []
downstream:
- repo: vscode-typeshade
  what: docs/design.md §5's DAP row for a console call loses its "pending" and names the option; the MCP server's run tool (packages/mcp-server/src/run.ts) prints the lines a run logged under its result, with tools.test.ts's exact-output case updated for a program that logs
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

The stepping engine (`typeshade/debug`) runs a `console.*` call and delivers nothing. Since
0014, `compileModule`, the generated CPU code and `dispatch` hand each call to a
`ConsoleSink`, but a `DebugSession` takes no sink, so an editor's debug adapter and the MCP
server's `run` tool cannot show what a stepped program logs. `docs/design.md` §5 in
vscode-typeshade marks its DAP row for a console call "pending" on exactly this.

After this change:

```ts
const session = startDebugSession(module, 'main', [[3, 0, 0]], {
  consoleSink: (e) => lines.push(e),
});
session.continue(); // lines holds every event the run delivered, in order
```

- `DebugSessionOptions` gains `consoleSink?: ConsoleSink`. Each console call the session runs
  delivers one `ConsoleEvent`, with its labels, its span and, for an entry that takes
  `global_invocation_id` or `position`, the `invocation` it was started as, the same event
  `compile().eval` delivers for that call (surface §66).
- `startDebugSessionFromConfig(m, config, hooks?)` gains an optional third argument,
  `{ consoleSink }`. A launch configuration is JSON, so a function cannot ride in it; the sink
  goes beside it.
- An event is delivered when the call runs, so a step that runs one delivers it before the
  step returns its pause. A step that does not reach the call delivers nothing.
- Nothing else moves: no emitted byte, no diagnostic, and a session without a sink behaves as
  it does today.

## Why

0014's goal was that a program logs the same lines wherever it runs. Stepping is the one
CPU path left that drops them, and it is the one a developer uses while debugging. The
alternative, a pull API (`session.logged`, read after each step), would make every adapter
diff a list; a push sink is what the other three CPU paths already take.

## What it touches

- **Surface §66.** The delivery paragraph names the debugger among the CPU paths.
- **`DebugSessionOptions`** gains `consoleSink`.
- **`startDebugSessionFromConfig`** gains its optional `hooks` argument.
- **Code.** `src/core/debug/session.ts` and `config.ts` pass the sink and the invocation into
  the interpreter context, which already delivers to one since 0014.
- **Tests.** A session stepped over a kernel that logs delivers the events `compile().eval`
  delivers for the same entry and arguments, labels and invocation included, and delivers
  each one at the step that runs its call.

## What it owes downstream

**vscode-typeshade**

- `docs/design.md` §5: the DAP row for a console call loses "pending" and names
  `consoleSink`.
- The MCP server's `run` tool (`packages/mcp-server/src/run.ts`) prints the lines a run
  logged, under its result; `tools.test.ts` pins the output for a program that logs.
