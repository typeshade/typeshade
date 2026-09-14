// ═══ typeshade/debug: stepping one shader invocation on the CPU ═══
//
// The engine behind `docs/debugging.md`: the CPU oracle's own walk, re-spelled as a generator
// that stops at statement boundaries, so an author can step through the `"use typeshade"`
// source they wrote and inspect what each statement computed.
//
// Its own subpath rather than a corner of `./dev`, because the two have different consumers.
// `./dev` is lint, diagnostics and optimizer measurement, imported by tests; this is imported
// by an IDE's debug adapter and by the Playground, and a subpath is the cheapest way to keep
// the two dependency graphs apart.
//
// Import as `typeshade/debug`.

export {
  startDebugSession,
  type DebugBreakpoint,
  type DebugPause,
  type DebugSession,
  type DebugSessionOptions,
  type DebugStackFrame,
} from './core/debug/session.js'

// The span an author's breakpoint resolves against, and the reader for it, re-exported here
// so a debug adapter needs one import, not two.
export { sourceSpanOf, type SourceSpan } from './core/ir/span.js'
// The value model every local, parameter and binding is spelled in.
export type { CpuValue, CpuStruct } from './core/cpu-runtime.js'
export type { CpuPrecision } from './core/oracle.js'
