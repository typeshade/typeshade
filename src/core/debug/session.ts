import type { CpuValue } from '../cpu-runtime.js';
import { consoleInvocation } from '../console.js';
import { zeroOf } from '../cpu-runtime.js';
import type { FuncDecl, ModuleDecl } from '../ir/index.js';
import type { CpuPrecision } from '../oracle.js';
import { validate } from '../passes/validate.js';
import { autoVars } from '../passes/opt/index.js';
import { treeLoops } from '../passes/parallel-loop.js';
import { froundF32 } from '../passes/precision.js';
import { Session } from './session/stepped-session.js';
import { makeCtx } from './interp.js';
import type { DebugSessionOptions, DebugSession } from './session/types.js';
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
