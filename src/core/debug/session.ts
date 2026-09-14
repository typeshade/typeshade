// ═══ Shader DSL: a stepped run of one shader invocation (docs/debugging.md §2.1) ═══
//
// The editor-neutral half of the debugger. It takes a module, an entry point and one
// invocation's inputs, and hands back an object that stops at statement boundaries and can be
// stepped. It knows nothing about the Debug Adapter Protocol, VS Code or the DOM: a DAP
// server in `typeshade/vscode-typeshade` and a "Step on the CPU" panel in the Playground are
// both adapters over this, which is the same split `docs/language-service-api.md` §1 makes
// for the language service.

import type { CpuValue } from '../cpu-runtime.js'
import { zeroOf } from '../cpu-runtime.js'
import type { FuncDecl, ModuleDecl, Stmt } from '../ir/index.js'
import type { SourceSpan } from '../ir/span.js'
import { sourceSpanOf } from '../ir/span.js'
import type { CpuPrecision } from '../oracle.js'
import { validate } from '../passes/validate.js'
import { autoVars } from '../passes/opt/index.js'
import { froundF32 } from '../passes/precision.js'
import { makeCtx, runFunction, type Signal, type Step, type StepFrame } from './interp.js'

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
   *  single-file session wants. */
  readonly file?: string
  /** Zero-based line, the same convention `SourceSpan` and the language service use. */
  readonly line: number
}

/** One frame of a paused call stack.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugStackFrame {
  /** The function's declared name. */
  readonly fnName: string
  /** Where that function was declared, when it came from `"use typeshade"` source. */
  readonly fnSpan: SourceSpan | undefined
  /** Where the call that created this frame was written; absent on the entry frame. */
  readonly callSpan: SourceSpan | undefined
  /** The statement this frame is stopped on. */
  readonly span: SourceSpan | undefined
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
  readonly locals: ReadonlyMap<string, CpuValue>
}

/** A stopped run: where it is, and everything visible from there.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugPause {
  /** Why the run stopped: the first statement of the entry, a completed step, or a
   *  breakpoint. */
  readonly reason: 'entry' | 'step' | 'breakpoint'
  /** Where the statement about to execute was written.
   *
   *  Always present. A statement the compiler synthesised, such as the counter a `while`
   *  lowers to or a helper `fp64Lower` injects, has no line to show, so a run never stops on
   *  one: it executes between two stops like any other work the author did not write
   *  (`docs/debugging.md` §3.4). That is also why a module authored through the `fn()` EDSL,
   *  which carries no spans at all, runs to completion without pausing: there is no source to
   *  step. */
  readonly span: SourceSpan
  /** The IR statement about to execute. */
  readonly stmt: Stmt
  /** The call stack, innermost frame first, as a debug adapter reports it. */
  readonly frames: readonly DebugStackFrame[]
  /** The uniform and storage bindings this run was given, as their own scope.
   *
   *  The values SUPPLIED, keyed by declared name, not the module's declared list: a binding the
   *  caller did not supply is absent here, because it has no value, and reading it during the
   *  run throws naming it rather than reading as a zero. A name the module does not declare
   *  cannot appear at all, since `startDebugSession` rejects one.
   *
   *  What is NOT checked yet is the shape of a supplied value: a number where a struct is
   *  declared is stored as given and produces `NaN` when a field of it is read. That check
   *  belongs with the invocation builder of §4.3 and lands with it. */
  readonly bindings: ReadonlyMap<string, CpuValue>
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
  readonly precision?: CpuPrecision
  /** Accept placeholder values at the GPU-only intrinsics (a texture read, a screen-space
   *  derivative) instead of throwing. Off by default, as on the oracle, because a plausible
   *  wrong number is the worst failure mode for a reference. When on,
   *  {@link DebugSession.stubbedIntrinsics} names every one that stood in. */
  readonly gpuStubs?: boolean
  /** Uniform and storage values by declared name, in the CPU value model: a number for a
   *  scalar, a flat array for a vector or matrix, an object keyed by field name for a
   *  struct, an array for an array. */
  readonly bindings?: Readonly<Record<string, CpuValue>>
  /** Breakpoints to arm before the run starts. {@link DebugSession.setBreakpoints} replaces
   *  them later. */
  readonly breakpoints?: readonly DebugBreakpoint[]
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
  readonly maxSteps?: number
}

/** A run of one invocation, stopped at a statement and steppable from there.
 *
 *  Exported from `typeshade/debug`.
 */
export interface DebugSession {
  /** Where the run is stopped, or `undefined` once it has finished. */
  readonly pause: DebugPause | undefined
  /** Whether the run has finished. */
  readonly done: boolean
  /** The entry point's return value, once `done`. `undefined` for a void entry and for one
   *  that discarded. */
  readonly result: CpuValue | undefined
  /** Whether the run ended at a `discard`. */
  readonly discarded: boolean
  /** The GPU-only intrinsics that returned a placeholder rather than a computed value at some
   *  point during this run, by name. Empty unless `gpuStubs` is on.
   *
   *  A property of the whole run, and cumulative: once `dpdx` appears here it stays, however
   *  far the run has moved on. It answers "did anything in this session stand in, and what",
   *  which is a banner on the session or a warning in a test. It does NOT say which of the
   *  values on screen are stand-ins, because a name is not a value: after `const d = dpdx(a)`
   *  it reports `dpdx` and cannot tell `d` from `a`. That per-value marking is the other half
   *  of `docs/debugging.md` §2.4 and arrives with the milestone that delivers it. */
  readonly stubbedIntrinsics: readonly string[]
  /** The precision this run is evaluating at, so a UI can say which question it is answering. */
  readonly precision: CpuPrecision
  /** Run to the next statement in this frame or a caller, over any calls the current
   *  statement makes. */
  stepOver(): DebugPause | undefined
  /** Run to the next statement anywhere, which is the first statement of a callee when the
   *  current statement calls one. */
  stepIn(): DebugPause | undefined
  /** Run until this frame returns, stopping in its caller. */
  stepOut(): DebugPause | undefined
  /** Run until a breakpoint or the end of the invocation. */
  continue(): DebugPause | undefined
  /** Replace the armed breakpoints. */
  setBreakpoints(breakpoints: readonly DebugBreakpoint[]): void
  /** Abandon the run without finishing it: the session reports `done`, keeps whatever pause it
   *  was showing out of `pause`, and every further move is a no-op.
   *
   *  What a DAP `terminate` maps onto, and what a UI closing a panel should call. It cannot
   *  interrupt a `continue()` that is already running, since that is a loop on the same
   *  thread; {@link DebugSessionOptions.maxSteps} is the guard for that case. */
  terminate(): void
}

/** Start a stepped run of one shader invocation.
 *
 *  It is the CPU oracle's own walk, re-spelled as a generator that stops at every statement
 *  boundary: the same IR the WGSL and GLSL writers emit, the same operation library, and the
 *  same two preparation passes `compileModule` runs (`validate`, then `autoVars`), so what it
 *  steps through is the program the author wrote rather than an optimized rewrite of it. The
 *  run covers ONE invocation. A whole frame is millions of them and is not what this is for;
 *  `compileModuleJs` remains the backend for that.
 *
 *  The session stops immediately, before the entry's first statement, with
 *  `pause.reason === 'entry'` unless a breakpoint is armed on that statement, in which case
 *  the reason is `'breakpoint'`. Call {@link DebugSession.continue} to run on to the next one.
 *
 *  It comes back already finished, with no pause, when nothing in the run carries a source
 *  span: a module authored through the `fn()` EDSL has none, and a run stops only where there
 *  is a line to show ({@link DebugPause.span}).
 *
 *  A parameter `args` does not supply reads as the zero of its type for the shapes `zeroOf`
 *  covers, which is the same default the Playground's "Run on the CPU" uses, so an invocation
 *  can name only the inputs it cares about. A struct or array parameter is the gap: its zero
 *  is `{}`, and reading a field of it throws a raw `TypeError` rather than a message naming
 *  the parameter. That is parity with `compileModule` today, and the invocation builder of
 *  §4.3 is where it gets fixed.
 *
 *  Exported from `typeshade/debug`.
 *
 *  @param m - the module to run, as `compile()` or `module()` produced it.
 *  @param entry - the name of the function to invoke.
 *  @param args - that function's parameters, positionally; a missing one is filled with the
 *    zero of its type, except a struct or array, whose zero is an empty object (see above).
 *  @param opts - precision, GPU stubs, binding values and initial breakpoints.
 *  @returns the session, stopped on the entry's first statement, or already finished when the
 *    module carries no spans.
 *  @throws {@link ValidationError} when the module fails a core rule, and `Error` when `entry`
 *    names no function in the module.
 *
 *  @example
 *  ```ts
 *  import { compile } from 'typeshade'
 *  import { startDebugSession } from 'typeshade/debug'
 *
 *  const { module } = compile(src)
 *  const s = startDebugSession(module, 'fs', [[100.5, 50.5, 0, 1]])
 *  while (s.pause) {
 *    console.log(s.pause.span.line, [...s.pause.frames[0]!.locals])
 *    s.stepOver()
 *  }
 *  console.log(s.result)
 *  ```
 *
 *  @see {@link DebugPause} for what a stop reports.
 *  @see {@link compileModule} for the same evaluator run to completion.
 */
export function startDebugSession(
  m: ModuleDecl,
  entry: string,
  args: readonly CpuValue[] = [],
  opts?: DebugSessionOptions,
): DebugSession {
  // The oracle's own preparation, in the oracle's own order: reject what the GPU writers
  // reject, materialise auto-vars so the assignable lvalues match, then round if asked.
  validate(m)
  let prepared = autoVars(m)
  const precision: CpuPrecision = opts?.precision ?? 'f32'
  if (precision === 'f32') prepared = froundF32(prepared)

  const decl = prepared.funcs.find((f) => f.name === entry)
  if (!decl) throw new Error(`typeshade/debug: no function "${entry}" in module`)

  const ctx = makeCtx(prepared, opts?.gpuStubs ?? false)
  // A name the module does not declare is a typo, not a value: storing it silently means the
  // real binding stays unsupplied and the run fails later, naming the binding the caller
  // thought they had just supplied. `ctx.bindingNames` is the declared set.
  const declared = new Set(m.bindings.map((b) => b.name))
  for (const [name, value] of Object.entries(opts?.bindings ?? {})) {
    if (!declared.has(name)) {
      const known = [...declared].sort().join(', ') || 'none'
      throw new Error(`typeshade/debug: no binding "${name}" in this module; it declares ${known}`)
    }
    ctx.bindings[name] = value
  }

  return new Session(
    decl,
    fillArgs(decl, args),
    ctx,
    precision,
    opts?.breakpoints ?? [],
    opts?.maxSteps,
  )
}

/** Positional arguments, with anything missing standing in as the zero of its type, whatever
 *  `zeroOf` makes of it: `{}` for a struct, which is the gap `startDebugSession`'s JSDoc names. */
function fillArgs(decl: FuncDecl, args: readonly CpuValue[]): CpuValue[] {
  return decl.params.map((p, i) => (args[i] === undefined ? zeroOf(p.type) : args[i]!))
}

class Session implements DebugSession {
  readonly precision: CpuPrecision
  private readonly run: Step<Signal>
  private readonly ctx: ReturnType<typeof makeCtx>
  private breakpoints: readonly DebugBreakpoint[]
  private paused: DebugPause | undefined
  private finished = false
  private signal: Signal | undefined
  private readonly maxSteps: number | undefined
  private steps = 0

  constructor(
    decl: FuncDecl,
    args: readonly CpuValue[],
    ctx: ReturnType<typeof makeCtx>,
    precision: CpuPrecision,
    breakpoints: readonly DebugBreakpoint[],
    maxSteps: number | undefined,
  ) {
    this.ctx = ctx
    this.precision = precision
    this.breakpoints = breakpoints
    this.maxSteps = maxSteps
    this.run = runFunction(decl, args, undefined, ctx)
    // `'entry'` is the reason only when nothing else claims the stop. A breakpoint on the
    // entry's FIRST statement was previously invisible: the constructor consumed that
    // statement as the entry pause, so a later `continue()` resumed past it and the
    // breakpoint never reported: on a one-statement entry, a breakpoint on its only line
    // produced no stop at all. `advance` now prefers `'breakpoint'` whenever one matches,
    // here as on every other move.
    this.advance('entry', () => true)
  }

  get pause(): DebugPause | undefined {
    return this.paused
  }
  get done(): boolean {
    return this.finished
  }
  get result(): CpuValue | undefined {
    return this.signal?.kind === 'return' ? this.signal.value : undefined
  }
  get discarded(): boolean {
    return this.signal?.kind === 'discard'
  }
  get stubbedIntrinsics(): readonly string[] {
    return [...this.ctx.stubbed]
  }

  setBreakpoints(breakpoints: readonly DebugBreakpoint[]): void {
    this.breakpoints = breakpoints
  }

  terminate(): void {
    this.finished = true
    this.paused = undefined
  }

  stepIn(): DebugPause | undefined {
    return this.advance('step', () => true)
  }

  stepOver(): DebugPause | undefined {
    const depth = this.depth()
    return this.advance('step', (d) => d <= depth)
  }

  stepOut(): DebugPause | undefined {
    const depth = this.depth()
    // The post-call arm is what makes this §2.1's step-out rather than "run until the stack is
    // shallower": it stops the moment this frame's caller has it back, still on the statement
    // that made the call, so a following `stepIn` enters that statement's next call.
    return this.advance(
      'step',
      (d) => d < depth,
      (d) => d < depth,
    )
  }

  continue(): DebugPause | undefined {
    return this.advance('breakpoint', () => false)
  }

  /** How deep the stack is at the current pause; 1 is the entry frame. */
  private depth(): number {
    return this.paused?.frames.length ?? 0
  }

  private hits(span: SourceSpan): boolean {
    return this.breakpoints.some(
      (b) => (b.file === undefined || b.file === span.file) && b.line === span.line,
    )
  }

  /** Pull events out of the walk until one is worth stopping at, or the run finishes.
   *
   *  Three rules, and each is a decision rather than a detail:
   *
   *  - **A statement with no span is never a stop.** It still executes; it just has no line to
   *    show, so stopping there would put an editor's caret nowhere. The counter a `while`
   *    lowers to is the case that exists today (`docs/debugging.md` §3.4). This is why
   *    `DebugPause.span` is not optional.
   *  - **A breakpoint stops any move**, not only `continue`. A breakpoint inside a helper that
   *    a stepped-over statement calls has to fire, which is what DAP's `next`, `stepIn` and
   *    `stepOut` all report.
   *  - **A post-call event is a stop only for `stepOut`.** See {@link StepEvent.afterCall}.
   */
  private advance(
    reason: DebugPause['reason'],
    want: (depth: number, span: SourceSpan) => boolean,
    wantAfterCall?: (depth: number) => boolean,
  ): DebugPause | undefined {
    if (this.finished) return undefined
    for (;;) {
      const next = this.run.next()
      if (next.done) {
        this.finished = true
        this.paused = undefined
        this.signal = next.value
        return undefined
      }
      const { stmt, frames, afterCall } = next.value
      if (!afterCall && this.maxSteps !== undefined && ++this.steps > this.maxSteps) {
        this.finished = true
        this.paused = undefined
        throw new Error(
          `typeshade/debug: the run reached ${this.maxSteps} statements without finishing ` +
            `(maxSteps); it is either an unbounded loop or a budget set too low`,
        )
      }
      const span = sourceSpanOf(stmt)
      if (afterCall) {
        if (span === undefined || !wantAfterCall?.(frames.length)) continue
        this.paused = snapshot('step', stmt, span, frames, this.ctx.bindings)
        return this.paused
      }
      if (span === undefined) continue
      const hit = this.hits(span)
      if (!hit && !want(frames.length, span)) continue
      this.paused = snapshot(hit ? 'breakpoint' : reason, stmt, span, frames, this.ctx.bindings)
      return this.paused
    }
  }
}

/** Copy the live frame stack into the shape a caller reads, innermost first. */
function snapshot(
  reason: DebugPause['reason'],
  stmt: Stmt,
  span: SourceSpan,
  frames: readonly StepFrame[],
  bindings: Readonly<Record<string, CpuValue>>,
): DebugPause {
  return {
    reason,
    span,
    stmt,
    frames: frames
      .map((f) => ({
        fnName: f.fnName,
        fnSpan: f.fnSpan,
        callSpan: f.callSpan,
        span: f.current ? sourceSpanOf(f.current) : undefined,
        locals: new Map(f.env),
      }))
      .reverse(),
    bindings: new Map(Object.entries(bindings)),
  }
}
