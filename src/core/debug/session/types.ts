import type { CpuValue } from '../../cpu-runtime.js';
import type { ConsoleSink } from '../../console.js';
import type { ShaderType, Stmt } from '../../ir/index.js';
import type { SourceSpan } from '../../ir/span.js';
import type { CpuPrecision } from '../../oracle.js';
import type { DebugWatchValue } from '../watch.js';

/** A breakpoint, as an editor sets one: a zero-based line, optionally in a named file.
 *
 *  It resolves against statement spans rather than text: a run stops at the first statement
 *  whose span STARTS on that line, so a breakpoint on a blank line or a comment never fires
 *  and a breakpoint on a line carrying two statements fires at each in turn.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugBreakpoint {
  /** Match only statements from this file. Omit to match on line alone, which is what a
   *  single-file session wants.
   *
   *  Compared against the name the module was COMPILED under (`SourceSpan.file`), and the two
   *  are normalized before comparing: separators, `./` and `../` segments. They have to be,
   *  because the compile side is `ts.SourceFile.fileName` and TypeScript rewrites what it is
   *  given (`C:\shaders\a.ts` is stored as `C:/shaders/a.ts`) while a breakpoint's path
   *  arrives exactly as the editor spelled it. Neither side is resolved against a directory
   *  or looked up on disk, so a relative path and an absolute one are still two files. */
  readonly file?: string;
  /** Zero-based line, the same convention `SourceSpan` and the language service use. */
  readonly line: number;
}

/** One frame of a paused call stack.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugStackFrame {
  /** The function's declared name. */
  readonly fnName: string;
  /** Where that function was declared, when it came from `"use typeshade"` source. */
  readonly fnSpan: SourceSpan | undefined;
  /** Where the call that created this frame was written; absent on the entry frame. */
  readonly callSpan: SourceSpan | undefined;
  /** The statement this frame is stopped on. */
  readonly span: SourceSpan | undefined;
  /** The names this frame holds and their current values, copied at the pause.
   *
   *  The copy is one level deep, which is what the CPU value model makes meaningful: a vector
   *  is a `number[]` and a struct a plain object, shared by reference so that `p.x = ...`
   *  assigns in place. So a scalar reads as it was at the pause, and a vector or struct is a
   *  live view of the frame's own storage. Read them before stepping again.
   *
   *  One call's whole environment, NOT a lexical scope. The interpreter keeps one map per
   *  call, as `oracle.ts` does, so a name declared inside a block stays in it after the block
   *  ends: a `for` counter, or a local of an `if` body, is still listed with its last value
   *  once control has left. Per-block scopes would be the fix and are not M2's; until then a
   *  variables view showing this map is showing what the frame HAS, which is a superset of
   *  what the next statement can name. */
  readonly locals: ReadonlyMap<string, CpuValue>;
  /** The declared type of every name this frame can hold, so {@link formatCpuValue} can render
   *  a local the way its author spelled it. A name absent from `locals` but present here has
   *  not been declared yet at this pause. */
  readonly localTypes: ReadonlyMap<string, ShaderType>;
  /** The names in {@link locals} whose value is a **stand-in**, not a computed result: it came
   *  from a GPU-only intrinsic that `gpuStubs` let stand in, or from arithmetic on one. Empty
   *  unless the session was started with `gpuStubs: true`, since without it a stub throws
   *  instead of returning.
   *
   *  This is what a variables view marks so that nobody reads `dx = 0` as the answer
   *  (`docs/debugging.md` §2.4). {@link DebugSession.stubbedIntrinsics} answers the other
   *  question, WHICH intrinsics stood in anywhere in the run, and neither substitutes for the
   *  other: a run can have stubbed `dpdx` ten statements ago and be showing nothing derived
   *  from it now.
   *
   *  Conservative in the one direction that cannot mislead. It over-reports rather than
   *  under-reports: a helper that calls `dpdx` and does not use the result still marks what
   *  the call returned, and writing one clean component of a marked vector leaves the vector
   *  marked. Assigning a whole name something clean clears it. */
  readonly stubbedLocals: ReadonlySet<string>;
}

/** A stopped run: where it is, and everything visible from there.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugPause {
  /** Why the run stopped: the first statement of the entry, a completed step, or a
   *  breakpoint. */
  readonly reason: 'entry' | 'step' | 'breakpoint';
  /** Where the statement about to execute was written.
   *
   *  Always present. A statement the compiler synthesised, such as the counter a `while`
   *  lowers to or a helper `fp64Lower` injects, has no line to show, so a run never stops on
   *  one: it executes between two stops like any other work the author did not write
   *  (`docs/debugging.md` §3.4). That is also why a module authored through the `fn()` EDSL,
   *  which carries no spans at all, runs to completion without pausing: there is no source to
   *  step. */
  readonly span: SourceSpan;
  /** The IR statement about to execute. */
  readonly stmt: Stmt;
  /** The call stack, innermost frame first, as a debug adapter reports it. */
  readonly frames: readonly DebugStackFrame[];
  /** The uniform and storage bindings this run was given, as their own scope.
   *
   *  The values SUPPLIED, keyed by declared name, not the module's declared list: a binding the
   *  caller did not supply is absent here, because it has no value, and reading it during the
   *  run throws naming it rather than reading as a zero. A name the module does not declare
   *  cannot appear at all, since `startDebugSession` rejects one.
   *
   *  A value supplied through {@link startDebugSessionFromConfig} has been checked against its
   *  declared type and had any absent struct field filled in. One supplied straight to
   *  {@link startDebugSession} has not: this entry point stores what it is given, so a number
   *  where a struct is declared produces `NaN` when a field of it is read. The configuration
   *  layer is where that check lives, which is also where a caller gets every problem at once
   *  rather than the first. */
  readonly bindings: ReadonlyMap<string, CpuValue>;
  /** Each binding's declared type, for the same reason {@link DebugStackFrame.localTypes}
   *  exists. */
  readonly bindingTypes: ReadonlyMap<string, ShaderType>;
}

/** How a run is set up.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugSessionOptions {
  /** What the arithmetic means. Defaults to `'f32'`, where `compileModule` defaults to
   *  `'f64'`, and the difference is deliberate: someone stepping a shader is asking what the
   *  GPU computes, while the f64 mode answers a different question. It is the algebra
   *  reference, blind by construction to the rounding that produces most "it looks wrong on
   *  the GPU" reports. `docs/debugging.md` §5 decision 6 settles this. */
  readonly precision?: CpuPrecision;
  /** Accept placeholder values at the GPU-only intrinsics (a texture read, a screen-space
   *  derivative) instead of throwing. Off by default, as on the oracle, because a plausible
   *  wrong number is the worst failure mode for a reference. When on,
   *  {@link DebugSession.stubbedIntrinsics} names every one that stood in, and
   *  {@link DebugStackFrame.stubbedLocals} names the values each pause is showing that came
   *  from one. */
  readonly gpuStubs?: boolean;
  /** Uniform and storage values by declared name, in the CPU value model: a number for a
   *  scalar, a flat array for a vector or matrix, an object keyed by field name for a
   *  struct, an array for an array. */
  readonly bindings?: Readonly<Record<string, CpuValue>>;
  /** Breakpoints to arm before the run starts. {@link DebugSession.setBreakpoints} replaces
   *  them later. */
  readonly breakpoints?: readonly DebugBreakpoint[];
  /** Stop before the entry's first statement. Default `true`; `false` runs to the first
   *  breakpoint instead.
   *
   *  Either way a breakpoint on the entry's own first statement fires: the entry pause is
   *  examined against the armed breakpoints like any other stop, and reports `'breakpoint'`
   *  when one matches. */
  readonly stopOnEntry?: boolean;
  /** Stop the run after this many statement events, as a guard against a shader that cannot
   *  finish.
   *
   *  A `while (true)` with no reachable exit is a program the front end accepts and neither
   *  backend can finish, and `continue()` on one does not return: it is an ordinary loop on
   *  the caller's thread, so there is no timeout and nothing to cancel. A budget turns that
   *  into an error naming the limit. Unset means unbounded, which is the right default for a
   *  test; a UI driving a session over a shader someone else wrote should set one.
   *
   *  Counted in statements reached, not in statements stopped at, so it bounds the work one
   *  `continue()` can do rather than the number of pauses it reports. */
  readonly maxSteps?: number;
  /** Where the `console.*` calls the run steps over go (surface §66). Each call delivers one
   *  event when it runs, so a step that runs one delivers it before the step returns its
   *  pause, and a step that does not reach it delivers nothing. The event is the one
   *  `compile().eval` delivers for the same call: its labels, its span and, for an entry that
   *  takes `global_invocation_id` or `position`, the `invocation` the run was started as.
   *  Absent, a call delivers nothing. */
  readonly consoleSink?: ConsoleSink;
}

/** A run of one invocation, stopped at a statement and steppable from there.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugSession {
  /** Where the run is stopped, or `undefined` once it has finished. */
  readonly pause: DebugPause | undefined;
  /** Whether the run has finished. */
  readonly done: boolean;
  /** The entry point's return value, once `done`. `undefined` for a void entry and for one
   *  that discarded. */
  readonly result: CpuValue | undefined;
  /** Whether the run ended at a `discard`. */
  readonly discarded: boolean;
  /** The GPU-only intrinsics that returned a placeholder rather than a computed value at some
   *  point during this run, by name. Empty unless `gpuStubs` is on.
   *
   *  A property of the whole run, and cumulative: once `dpdx` appears here it stays, however
   *  far the run has moved on. It answers "did anything in this session stand in, and what",
   *  which is a banner on the session or a warning in a test. It does NOT say which of the
   *  values on screen are stand-ins, because a name is not a value: after `const d = dpdx(a)`
   *  it reports `dpdx` and cannot tell `d` from `a`. That is
   *  {@link DebugStackFrame.stubbedLocals}, the other half of `docs/debugging.md` §2.4, which
   *  is what a variables view marks. */
  readonly stubbedIntrinsics: readonly string[];
  /** The precision this run is evaluating at, so a UI can say which question it is answering. */
  readonly precision: CpuPrecision;
  /** Run to the next statement in this frame or a caller, over any calls the current
   *  statement makes. */
  stepOver(): DebugPause | undefined;
  /** Run to the next statement anywhere, which is the first statement of a callee when the
   *  current statement calls one. */
  stepIn(): DebugPause | undefined;
  /** Run until this frame returns, stopping in its caller. */
  stepOut(): DebugPause | undefined;
  /** Run until a breakpoint or the end of the invocation. */
  continue(): DebugPause | undefined;
  /** Replace the armed breakpoints. */
  setBreakpoints(breakpoints: readonly DebugBreakpoint[]): void;
  /** What is this expression, here, now: a DAP `evaluate`, a watch box, a debug hover.
   *
   *  The text is compiled by the REAL front end against the frame's own names, so a watch
   *  means what the same text would mean written at that point in the shader, and a type error
   *  in it is the same diagnostic the editor shows (`docs/debugging.md` §4.5). It can call the
   *  module's own helpers. It is evaluated by the interpreter already running this session, at
   *  this session's precision, so a watch answers the same question the run does.
   *
   *  Reads only; nothing a watch does can change the run. An assignment is a compile error
   *  rather than a side effect.
   *
   *  The scope is the chosen frame's parameters and locals plus the module's bindings, minus
   *  any name whose type the source language cannot yet spell (a texture, a sampler, a
   *  runtime-sized storage array); watching one of those is an error naming it, never a wrong
   *  number. Compiled watches are cached by text and frame shape, so stepping with a watch
   *  open costs one compile, not one per step.
   *
   *  @param expression - the watch text, as the user typed it.
   *  @param frameIndex - which frame to evaluate in, innermost first; defaults to 0.
   *  @throws `DebugWatchError` when the text does not compile in that scope, and whatever the
   *    interpreter throws when evaluating it does (a GPU-only intrinsic with `gpuStubs` off,
   *    an out-of-range index).
   *  @throws `Error` when the session is not paused, or `frameIndex` names no frame.
   */
  evaluate(expression: string, frameIndex?: number): DebugWatchValue;
  /** Abandon the run without finishing it: the session reports `done`, keeps whatever pause it
   *  was showing out of `pause`, and every further move is a no-op.
   *
   *  What a DAP `terminate` maps onto, and what a UI closing a panel should call. It cannot
   *  interrupt a `continue()` that is already running, since that is a loop on the same
   *  thread; {@link DebugSessionOptions.maxSteps} is the guard for that case. */
  terminate(): void;
}
