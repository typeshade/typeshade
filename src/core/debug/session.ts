import type { CpuValue } from '../cpu-runtime.js';
import { consoleInvocation } from '../console.js';
import { zeroOf } from '../cpu-runtime.js';
import type { FuncDecl, ModuleDecl, ShaderType } from '../ir/index.js';
import type { SourceSpan } from '../ir/span.js';
import { sourceSpanOf } from '../ir/span.js';
import type { CpuPrecision } from '../oracle.js';
import { validate } from '../passes/validate.js';
import { autoVars } from '../passes/opt/index.js';
import { treeLoops } from '../passes/parallel-loop.js';
import { froundF32 } from '../passes/precision.js';
import { sameFileName } from './file-name.js';
import { compileWatch, watchCacheKey, type CompiledWatch, type DebugWatchValue } from './watch.js';
import { evalExpr, makeCtx, runFunction, type Signal, type Step } from './interp.js';
import type {
  DebugBreakpoint,
  DebugPause,
  DebugSessionOptions,
  DebugSession,
} from './session/types.js';
import { snapshot } from './session/snapshot.js';
export type {
  DebugBreakpoint,
  DebugStackFrame,
  DebugPause,
  DebugSessionOptions,
  DebugSession,
} from './session/types.js';

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
 *  the reason is `'breakpoint'`. Pass `stopOnEntry: false` to run to the first armed
 *  breakpoint instead, which still considers that first statement.
 *
 *  It comes back already finished, with no pause, when nothing in the run carries a source
 *  span: a module authored through the `fn()` EDSL has none, and a run stops only where there
 *  is a line to show ({@link DebugPause.span}).
 *
 *  A kernel function (Rule 8.22) is stepped like any other, with one difference: a reduction
 *  loop its proof accepts is folded in the tree order every tier folds it in (Rule 7.2), so the
 *  result is the one `compileModule` returns, and a pause inside the loop shows the variable as
 *  one GPU invocation holds it, from the operator's identity, and not a running total
 *  (`docs/debugging.md` §1.3).
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
  validate(m);
  const unrounded = autoVars(m);
  const precision: CpuPrecision = opts?.precision ?? 'f32';
  const prepared = precision === 'f32' ? froundF32(unrounded) : unrounded;

  const decl = prepared.funcs.find((f) => f.name === entry);
  if (!decl) throw new Error(`typeshade/debug: no function "${entry}" in module`);

  const filled = fillArgs(decl, args);
  const sink = opts?.consoleSink;
  const invocation = sink && consoleInvocation(decl, filled, prepared.structs);
  const ctx: ReturnType<typeof makeCtx> = {
    ...makeCtx(prepared, opts?.gpuStubs ?? false),
    trees: treeLoops(unrounded, prepared),
    f32: precision === 'f32',
    ...(sink ? { consoleSink: sink } : {}),
    ...(invocation ? { invocation } : {}),
  };
  const declared = new Set(m.bindings.map((b) => b.name));
  for (const [name, value] of Object.entries(opts?.bindings ?? {})) {
    if (!declared.has(name)) {
      const known = [...declared].sort().join(', ') || 'none';
      throw new Error(`typeshade/debug: no binding "${name}" in this module; it declares ${known}`);
    }
    ctx.bindings[name] = value;
  }

  return new Session(
    decl,
    filled,
    ctx,
    precision,
    opts?.breakpoints ?? [],
    opts?.stopOnEntry ?? true,
    new Map(m.bindings.map((b) => [b.name, b.type])),
    prepared,
    opts?.maxSteps,
  );
}

function fillArgs(decl: FuncDecl, args: readonly CpuValue[]): CpuValue[] {
  return decl.params.map((p, i) => (args[i] === undefined ? zeroOf(p.type) : args[i]!));
}

class Session implements DebugSession {
  readonly precision: CpuPrecision;
  private readonly run: Step<Signal>;
  private readonly ctx: ReturnType<typeof makeCtx>;
  private readonly bindingTypes: ReadonlyMap<string, ShaderType>;
  private breakpoints: readonly DebugBreakpoint[];
  private paused: DebugPause | undefined;
  private finished = false;
  private signal: Signal | undefined;
  private readonly prepared: ModuleDecl;
  private readonly watches = new Map<string, CompiledWatch>();
  private readonly maxSteps: number | undefined;
  private steps = 0;

  constructor(
    decl: FuncDecl,
    args: readonly CpuValue[],
    ctx: ReturnType<typeof makeCtx>,
    precision: CpuPrecision,
    breakpoints: readonly DebugBreakpoint[],
    stopOnEntry: boolean,
    bindingTypes: ReadonlyMap<string, ShaderType>,
    prepared: ModuleDecl,
    maxSteps: number | undefined,
  ) {
    this.ctx = ctx;
    this.prepared = prepared;
    this.bindingTypes = bindingTypes;
    this.precision = precision;
    this.breakpoints = breakpoints;
    this.maxSteps = maxSteps;
    this.run = runFunction(decl, args, undefined, ctx);
    if (stopOnEntry) this.advance('entry', () => true);
    else this.advance('breakpoint', () => false);
  }

  get pause(): DebugPause | undefined {
    return this.paused;
  }
  get done(): boolean {
    return this.finished;
  }
  get result(): CpuValue | undefined {
    return this.signal?.kind === 'return' ? this.signal.value : undefined;
  }
  get discarded(): boolean {
    return this.signal?.kind === 'discard';
  }
  get stubbedIntrinsics(): readonly string[] {
    return [...this.ctx.stubbed];
  }

  setBreakpoints(breakpoints: readonly DebugBreakpoint[]): void {
    this.breakpoints = breakpoints;
  }

  evaluate(expression: string, frameIndex = 0): DebugWatchValue {
    const pause = this.paused;
    if (!pause) {
      throw new Error('typeshade/debug: cannot evaluate a watch; the run is not paused');
    }
    const frame = pause.frames[frameIndex];
    if (!frame) {
      throw new Error(
        `typeshade/debug: no frame ${frameIndex}; the stack is ${pause.frames.length} deep`,
      );
    }

    const scope = new Map<string, ShaderType>(this.bindingTypes);
    for (const [name, type] of frame.localTypes) scope.set(name, type);

    const key = watchCacheKey(scope, expression);
    let compiled = this.watches.get(key);
    if (!compiled) {
      compiled = this.atPrecision(compileWatch(this.prepared, scope, expression));
      this.watches.set(key, compiled);
    }

    const env = new Map<string, CpuValue>();
    for (const name of compiled.reads) {
      if (frame.locals.has(name)) env.set(name, frame.locals.get(name) as CpuValue);
      else if (pause.bindings.has(name)) env.set(name, pause.bindings.get(name) as CpuValue);
      else {
        throw new Error(
          `typeshade/debug: "${name}" is declared in ${frame.fnName} but not yet assigned at this pause`,
        );
      }
    }

    const before = this.ctx.stubHits;
    this.ctx.frames.push({
      fnName: frame.fnName,
      fnSpan: frame.fnSpan,
      callSpan: undefined,
      env,
      types: frame.localTypes,
      stubbed: new Set(frame.stubbedLocals),
      current: undefined,
    });
    try {
      const walk = evalExpr(compiled.expr, env, this.ctx);
      let step = walk.next();
      while (!step.done) step = walk.next();
      return { value: step.value, type: compiled.type, stubbed: this.ctx.stubHits > before };
    } finally {
      this.ctx.frames.pop();
    }
  }

  private atPrecision(w: CompiledWatch): CompiledWatch {
    if (this.precision !== 'f32') return w;
    const wrapped = froundF32({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [{ name: 'w', params: [], ret: w.type, body: [{ s: 'return', expr: w.expr }] }],
    });
    const stmt = wrapped.funcs[0]?.body[0];
    return stmt?.s === 'return' && stmt.expr ? { ...w, expr: stmt.expr } : w;
  }

  terminate(): void {
    this.finished = true;
    this.paused = undefined;
  }

  stepIn(): DebugPause | undefined {
    return this.advance('step', () => true);
  }

  stepOver(): DebugPause | undefined {
    const depth = this.depth();
    return this.advance('step', (d) => d <= depth);
  }

  stepOut(): DebugPause | undefined {
    const depth = this.depth();
    return this.advance(
      'step',
      (d) => d < depth,
      (d) => d < depth,
    );
  }

  continue(): DebugPause | undefined {
    return this.advance('breakpoint', () => false);
  }

  private depth(): number {
    return this.paused?.frames.length ?? 0;
  }

  private hits(span: SourceSpan): boolean {
    return this.breakpoints.some(
      (b) => (b.file === undefined || sameFileName(b.file, span.file)) && b.line === span.line,
    );
  }

  private advance(
    reason: DebugPause['reason'],
    want: (depth: number, span: SourceSpan) => boolean,
    wantAfterCall?: (depth: number) => boolean,
  ): DebugPause | undefined {
    if (this.finished) return undefined;
    for (;;) {
      const next = this.run.next();
      if (next.done) {
        this.finished = true;
        this.paused = undefined;
        this.signal = next.value;
        return undefined;
      }
      const { stmt, frames, afterCall } = next.value;
      if (!afterCall && this.maxSteps !== undefined && ++this.steps > this.maxSteps) {
        this.finished = true;
        this.paused = undefined;
        throw new Error(
          `typeshade/debug: the run reached ${this.maxSteps} statements without finishing ` +
            `(maxSteps); it is either an unbounded loop or a budget set too low`,
        );
      }
      const span = sourceSpanOf(stmt);
      if (afterCall) {
        if (span === undefined || !wantAfterCall?.(frames.length)) continue;
        this.paused = snapshot('step', stmt, span, frames, this.ctx.bindings, this.bindingTypes);
        return this.paused;
      }
      if (span === undefined) continue;
      const hit = this.hits(span);
      if (!hit && !want(frames.length, span)) continue;
      this.paused = snapshot(
        hit ? 'breakpoint' : reason,
        stmt,
        span,
        frames,
        this.ctx.bindings,
        this.bindingTypes,
      );
      return this.paused;
    }
  }
}
