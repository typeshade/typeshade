import type { CpuValue } from '../../cpu-runtime.js';
import type { FuncDecl, ModuleDecl, ShaderType } from '../../ir/index.js';
import type { SourceSpan } from '../../ir/span.js';
import { sourceSpanOf } from '../../ir/span.js';
import type { CpuPrecision } from '../../oracle.js';
import { froundF32 } from '../../passes/precision.js';
import { sameFileName } from '../file-name.js';
import { compileWatch, watchCacheKey, type CompiledWatch, type DebugWatchValue } from '../watch.js';
import { evalExpr, makeCtx, runFunction, type Signal, type Step } from '../interp.js';
import type { DebugBreakpoint, DebugPause, DebugSession } from './types.js';
import { snapshot } from './snapshot.js';

export class Session implements DebugSession {
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
