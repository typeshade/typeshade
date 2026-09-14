// ═══ Shader DSL — a stepped run of one shader invocation (docs/debugging.md §2.1) ═══
//
// The editor-neutral half of the debugger. It takes a module, an entry point and one
// invocation's inputs, and hands back an object that stops at statement boundaries and can be
// stepped. It knows nothing about the Debug Adapter Protocol, VS Code or the DOM: a DAP
// server in `typeshade/vscode-typeshade` and a "Step on the CPU" panel in the Playground are
// both adapters over this, which is the same split `docs/language-service-api.md` §1 makes
// for the language service.

import type { CpuValue } from '../cpu-runtime.js'
import { zeroOf } from '../cpu-runtime.js'
import type { FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js'
import type { SourceSpan } from '../ir/span.js'
import { sourceSpanOf } from '../ir/span.js'
import type { CpuPrecision } from '../oracle.js'
import { validate } from '../passes/validate.js'
import { autoVars } from '../passes/opt/index.js'
import { froundF32 } from '../passes/precision.js'
import { sameFileName } from './file-name.js'
import { compileWatch, watchCacheKey, type CompiledWatch, type DebugWatchValue } from './watch.js'
import { evalExpr, makeCtx, runFunction, type Signal, type Step, type StepFrame } from './interp.js'

/** A breakpoint, as an editor sets one: a zero-based line, optionally in a named file.
 *
 *  It resolves against statement spans rather than text: a run stops at the first statement
 *  whose span STARTS on that line, so a breakpoint on a blank line or a comment never fires
 *  and a breakpoint on a line carrying two statements fires at each in turn.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export interface DebugBreakpoint {
  /** Match only statements from this file. Omit to match on line alone, which is what a
   *  single-file session wants.
   *
   *  Compared against the name the module was COMPILED under (`SourceSpan.file`), and the two
   *  are normalized before comparing: separators, `./` and `../` segments. They have to be,
   *  because the compile side is `ts.SourceFile.fileName` and TypeScript rewrites what it is
   *  given — `C:\shaders\a.ts` is stored as `C:/shaders/a.ts` — while a breakpoint's path
   *  arrives exactly as the editor spelled it. Neither side is resolved against a directory
   *  or looked up on disk, so a relative path and an absolute one are still two files. */
  readonly file?: string
  /** Zero-based line, the same convention `SourceSpan` and the language service use. */
  readonly line: number
}

/** One frame of a paused call stack.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
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
  /** The names in scope in this frame and their current values, copied at the pause.
   *
   *  The copy is one level deep, which is what the CPU value model makes meaningful: a
   *  vector is a `number[]` and a struct a plain object, shared by reference so that
   *  `p.x = …` assigns in place. So a scalar reads as it was at the pause, and a vector or
   *  struct is a live view of the frame's own storage. Read them before stepping again. */
  readonly locals: ReadonlyMap<string, CpuValue>
  /** The declared type of every name this frame can hold, so {@link formatCpuValue} can render
   *  a local the way its author spelled it. A name absent from `locals` but present here has
   *  not been declared yet at this pause. */
  readonly localTypes: ReadonlyMap<string, ShaderType>
  /** The names in {@link locals} whose value is a **stand-in**, not a computed result: it came
   *  from a GPU-only intrinsic that `gpuStubs` let stand in, or from arithmetic on one. Empty
   *  unless the session was started with `gpuStubs: true`, since without it a stub throws
   *  instead of returning.
   *
   *  This is what a variables view marks so that nobody reads `dx = 0` as the answer
   *  (`docs/debugging.md` §2.4). {@link DebugSession.stubbedIntrinsics} answers the other
   *  question — WHICH intrinsics stood in anywhere in the run — and neither substitutes for the
   *  other: a run can have stubbed `dpdx` ten statements ago and be showing nothing derived
   *  from it now.
   *
   *  Conservative in the one direction that cannot mislead. It over-reports rather than
   *  under-reports: a helper that calls `dpdx` and does not use the result still marks what
   *  the call returned, and writing one clean component of a marked vector leaves the vector
   *  marked. Assigning a whole name something clean clears it. */
  readonly stubbedLocals: ReadonlySet<string>
}

/** A stopped run: where it is, and everything visible from there.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export interface DebugPause {
  /** Why the run stopped: the first statement of the entry, a completed step, or a
   *  breakpoint. */
  readonly reason: 'entry' | 'step' | 'breakpoint'
  /** Where the statement about to execute was written. Absent for a statement the compiler
   *  synthesised, such as the counter a `while` loop lowers to. */
  readonly span: SourceSpan | undefined
  /** The IR statement about to execute. */
  readonly stmt: Stmt
  /** The call stack, innermost frame first, as a debug adapter reports it. */
  readonly frames: readonly DebugStackFrame[]
  /** The uniform and storage bindings this run was given, as their own scope. */
  readonly bindings: ReadonlyMap<string, CpuValue>
  /** Each binding's declared type, for the same reason {@link DebugStackFrame.localTypes}
   *  exists. */
  readonly bindingTypes: ReadonlyMap<string, ShaderType>
}

/** How a run is set up.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 */
export interface DebugSessionOptions {
  /** What the arithmetic means. Defaults to `'f32'` here, NOT to `compileModule`'s `'f64'`:
   *  someone stepping a shader is asking what the GPU computes, and the f64 mode answers a
   *  different question — it is the algebra reference, blind by construction to the rounding
   *  that produces most "it looks wrong on the GPU" reports. `docs/debugging.md` open
   *  question 6 is exactly this default. */
  readonly precision?: CpuPrecision
  /** Accept placeholder values at the GPU-only intrinsics (a texture read, a screen-space
   *  derivative) instead of throwing. Off by default, as on the oracle, because a plausible
   *  wrong number is the worst failure mode for a reference. When on,
   *  {@link DebugSession.stubbedIntrinsics} names every one that stood in, and
   *  {@link DebugStackFrame.stubbedLocals} names the values each pause is showing that came
   *  from one. */
  readonly gpuStubs?: boolean
  /** Uniform and storage values by declared name, in the CPU value model: a number for a
   *  scalar, a flat array for a vector or matrix, an object keyed by field name for a
   *  struct, an array for an array. */
  readonly bindings?: Readonly<Record<string, CpuValue>>
  /** Breakpoints to arm before the run starts. {@link DebugSession.setBreakpoints} replaces
   *  them later. */
  readonly breakpoints?: readonly DebugBreakpoint[]
  /** Stop before the entry's first statement. Default `true`.
   *
   *  `false` runs to the first breakpoint instead — and the entry's own first statement is one
   *  of the statements that can carry it, so a breakpoint on the first line of a one-line
   *  entry still fires. A session that merely skipped the entry pause would step over it. */
  readonly stopOnEntry?: boolean
}

/** A run of one invocation, stopped at a statement and steppable from there.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
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
   *  far the run has moved on. It answers "did anything in this session stand in, and what" —
   *  a banner on the session, a warning in a test. It does NOT say which of the values on
   *  screen right now are stand-ins, because a name is not a value; that is
   *  {@link DebugStackFrame.stubbedLocals}, which is what a variables view marks. */
  readonly stubbedIntrinsics: readonly string[]
  /** The precision this run is evaluating at, so a UI can say which question it is answering. */
  readonly precision: CpuPrecision
  /** Run to the next statement in this frame or a caller — over any calls the current
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
  /** What is this expression, here, now — a DAP `evaluate`, a watch box, a debug hover.
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
   *  runtime-sized storage array) — watching one of those is an error naming it, never a wrong
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
  evaluate(expression: string, frameIndex?: number): DebugWatchValue
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
 *  `pause.reason === 'entry'`. Pass `stopOnEntry: false` to run to the first armed breakpoint
 *  instead, which still considers that first statement.
 *
 *  A parameter `args` does not supply reads as the zero of its type — the same default the
 *  Playground's "Run on the CPU" uses — so an invocation can name only the inputs it cares
 *  about.
 *
 *  Exported from `@xgis/shader-dsl/debug`.
 *
 *  @param m - the module to run, as `compile()` or `module()` produced it.
 *  @param entry - the name of the function to invoke.
 *  @param args - that function's parameters, positionally; short or sparse is filled with zeros.
 *  @param opts - precision, GPU stubs, binding values and initial breakpoints.
 *  @returns the session, already stopped on the entry's first statement.
 *  @throws {@link ValidationError} when the module fails a core rule, and `Error` when `entry`
 *    names no function in the module.
 *
 *  @example
 *  ```ts
 *  import { compile } from '@xgis/shader-dsl'
 *  import { startDebugSession } from '@xgis/shader-dsl/debug'
 *
 *  const { module } = compile(src)
 *  const s = startDebugSession(module, 'fs', [[100.5, 50.5, 0, 1]])
 *  while (s.pause) {
 *    console.log(s.pause.span?.line, [...s.pause.frames[0]!.locals])
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
  if (!decl) throw new Error(`shader-dsl/debug: no function "${entry}" in module`)

  const ctx = makeCtx(prepared, opts?.gpuStubs ?? false)
  for (const [name, value] of Object.entries(opts?.bindings ?? {})) ctx.bindings[name] = value

  return new Session(
    decl,
    fillArgs(decl, args),
    ctx,
    precision,
    opts?.breakpoints ?? [],
    opts?.stopOnEntry ?? true,
    new Map(m.bindings.map((b) => [b.name, b.type])),
    prepared,
  )
}

/** Positional arguments, with anything missing standing in as the zero of its type. */
function fillArgs(decl: FuncDecl, args: readonly CpuValue[]): CpuValue[] {
  return decl.params.map((p, i) => (args[i] === undefined ? zeroOf(p.type) : args[i]!))
}

class Session implements DebugSession {
  readonly precision: CpuPrecision
  private readonly run: Step<Signal>
  private readonly ctx: ReturnType<typeof makeCtx>
  private readonly bindingTypes: ReadonlyMap<string, ShaderType>
  private breakpoints: readonly DebugBreakpoint[]
  private paused: DebugPause | undefined
  private finished = false
  private signal: Signal | undefined
  /** The module as the run prepared it, for a watch to redeclare structs and helpers from. */
  private readonly prepared: ModuleDecl
  /** Compiled watches, by text and frame shape. Stepping with a watch box open re-asks the
   *  same question at every stop, and the answer changes while the lowering does not. */
  private readonly watches = new Map<string, CompiledWatch>()

  constructor(
    decl: FuncDecl,
    args: readonly CpuValue[],
    ctx: ReturnType<typeof makeCtx>,
    precision: CpuPrecision,
    breakpoints: readonly DebugBreakpoint[],
    stopOnEntry: boolean,
    bindingTypes: ReadonlyMap<string, ShaderType>,
    prepared: ModuleDecl,
  ) {
    this.ctx = ctx
    this.prepared = prepared
    this.bindingTypes = bindingTypes
    this.precision = precision
    this.breakpoints = breakpoints
    this.run = runFunction(decl, args, undefined, ctx)
    if (stopOnEntry) this.advance('entry', () => true)
    else this.advance('breakpoint', (_d, span) => this.hits(span))
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

  evaluate(expression: string, frameIndex = 0): DebugWatchValue {
    const pause = this.paused
    if (!pause) {
      throw new Error('shader-dsl/debug: cannot evaluate a watch — the run is not paused')
    }
    const frame = pause.frames[frameIndex]
    if (!frame) {
      throw new Error(
        `shader-dsl/debug: no frame ${frameIndex}; the stack is ${pause.frames.length} deep`,
      )
    }

    // A local shadows a binding of the same name, which is the order the interpreter itself
    // resolves in (`evalExpr` checks the environment before the bindings).
    const scope = new Map<string, ShaderType>(this.bindingTypes)
    for (const [name, type] of frame.localTypes) scope.set(name, type)

    const key = watchCacheKey(scope, expression)
    let compiled = this.watches.get(key)
    if (!compiled) {
      compiled = this.atPrecision(compileWatch(this.prepared, scope, expression))
      this.watches.set(key, compiled)
    }

    const env = new Map<string, CpuValue>()
    for (const name of compiled.reads) {
      if (frame.locals.has(name)) env.set(name, frame.locals.get(name) as CpuValue)
      else if (pause.bindings.has(name)) env.set(name, pause.bindings.get(name) as CpuValue)
      else {
        // Declared further down the body, so the frame has a TYPE for it and no value. Saying
        // so beats evaluating `undefined` into a NaN that reads like an answer.
        throw new Error(
          `shader-dsl/debug: "${name}" is declared in ${frame.fnName} but not yet assigned at this pause`,
        )
      }
    }

    // A watch is evaluated on the frame it is asked about: pushing one carrying that frame's
    // stub marks is what makes a watch over a stand-in report itself as one, and it is what a
    // call inside the watch unwinds back to. The run's own generator is suspended throughout,
    // so nothing else is looking at this stack, and the `finally` puts it back either way.
    const before = this.ctx.stubHits
    this.ctx.frames.push({
      fnName: frame.fnName,
      fnSpan: frame.fnSpan,
      callSpan: undefined,
      env,
      types: frame.localTypes,
      stubbed: new Set(frame.stubbedLocals),
      current: undefined,
    })
    try {
      const walk = evalExpr(compiled.expr, env, this.ctx)
      let step = walk.next()
      // A watch never pauses: its statement boundaries are inside helpers it called, and a
      // watch box asking a question is not a place to stop.
      while (!step.done) step = walk.next()
      return { value: step.value, type: compiled.type, stubbed: this.ctx.stubHits > before }
    } finally {
      this.ctx.frames.pop()
    }
  }

  /** The watch expression rounded the way this run's arithmetic is rounded.
   *
   *  Without it a watch would answer a different question from the statement beside it: the run
   *  is `froundF32`-wrapped at `'f32'` and a freshly compiled expression is not, so
   *  `a * 0.1` in the watch box would be the f64 product while `const b = a * 0.1` one line
   *  down is the f32 one. `froundF32` takes a module, so the expression rides in a throwaway
   *  one rather than this file re-implementing the wrapping rule.
   */
  private atPrecision(w: CompiledWatch): CompiledWatch {
    if (this.precision !== 'f32') return w
    const wrapped = froundF32({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [{ name: 'w', params: [], ret: w.type, body: [{ s: 'return', expr: w.expr }] }],
    })
    const stmt = wrapped.funcs[0]?.body[0]
    return stmt?.s === 'return' && stmt.expr ? { ...w, expr: stmt.expr } : w
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
    return this.advance('step', (d) => d < depth)
  }

  continue(): DebugPause | undefined {
    return this.advance('breakpoint', (_d, span) => this.hits(span))
  }

  /** How deep the stack is at the current pause; 1 is the entry frame. */
  private depth(): number {
    return this.paused?.frames.length ?? 0
  }

  private hits(span: SourceSpan | undefined): boolean {
    if (span === undefined) return false
    return this.breakpoints.some(
      (b) => (b.file === undefined || sameFileName(b.file, span.file)) && b.line === span.line,
    )
  }

  /** Pull pauses out of the walk until one satisfies `want`, or the run finishes. */
  private advance(
    reason: DebugPause['reason'],
    want: (depth: number, span: SourceSpan | undefined) => boolean,
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
      const { stmt, frames } = next.value
      const span = sourceSpanOf(stmt)
      if (!want(frames.length, span)) continue
      this.paused = snapshot(reason, stmt, span, frames, this.ctx.bindings, this.bindingTypes)
      return this.paused
    }
  }
}

/** Copy the live frame stack into the shape a caller reads, innermost first. */
function snapshot(
  reason: DebugPause['reason'],
  stmt: Stmt,
  span: SourceSpan | undefined,
  frames: readonly StepFrame[],
  bindings: Readonly<Record<string, CpuValue>>,
  bindingTypes: ReadonlyMap<string, ShaderType>,
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
        localTypes: f.types,
        stubbedLocals: new Set(f.stubbed),
      }))
      .reverse(),
    bindings: new Map(Object.entries(bindings)),
    bindingTypes,
  }
}
