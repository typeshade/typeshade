import type { Stmt, StructDecl, FuncDecl } from '../ir/index.js';
import type { TreeLoop } from '../passes/parallel-loop.js';
import type { CpuValue } from '../cpu-runtime.js';
import type { ConsoleSink } from '../console.js';
import type { WorkgroupCount } from '../debug/dispatch.js';

export interface Ctx {
  consts: Map<string, CpuValue>;
  overrides: Map<string, CpuValue>;
  fns: Record<string, (...args: CpuValue[]) => CpuValue>;
  params: Map<string, FuncDecl['params']>;
  bindings: Record<string, CpuValue>;
  vars: Record<string, CpuValue>;
  structs: Map<string, StructDecl>;
  gpuStubs: boolean;
  consoleSink?: ConsoleSink;
  trees?: ReadonlyMap<Stmt, TreeLoop>;
  f32?: boolean;
}

/** The shape both CPU backends return, so a caller can compile with {@link compileModuleJs}
 *  and fall back to {@link compileModule} without touching call sites (for example when the
 *  host forbids `new Function` under a Content Security Policy). `fns` is a table of the
 *  module's declared functions by name, each taking its parameters positionally in declaration
 *  order. `setBinding` supplies a storage or uniform binding's value before a function that
 *  reads it runs. The two backends return the same value for the same call:
 *  `compileModuleJs(m).fns.f(args)` and `compileModule(m).fns.f(args)` agree under `Object.is`,
 *  element for element.
 *
 *  Exported from `typeshade`.
 */
export interface CpuModule {
  /** The module's declared functions by name. Parameters are positional, in declaration
   *  order; the return value is the function's result as a {@link CpuValue}. */
  fns: Record<string, (...args: CpuValue[]) => CpuValue>;
  /** Supply a storage or uniform binding's value by its declared name, before invoking a
   *  function that reads it. */
  setBinding(name: string, value: CpuValue): void;
  /** Run a `@compute` entry over `workgroups` workgroups of its declared size (one number for
   *  a 1-D grid, or the three counts), every invocation of a workgroup in lockstep at each
   *  `workgroupBarrier()` / `storageBarrier()`, with the builtin parameters
   *  (`global_invocation_id`, `local_invocation_id`, `local_invocation_index`, `workgroup_id`,
   *  `num_workgroups`) filled in (roadmap 0.2 item 5). Workgroup memory starts zero for each
   *  workgroup and a per-invocation variable at its initializer for each invocation; the
   *  bindings are the ones {@link setBinding} supplied, arrays written in place. Throws when the
   *  invocations of one workgroup disagree about a barrier, naming its line and the counts.
   *  A kernel with no barrier may also be run one invocation at a time through {@link fns}. */
  dispatch(entry: string, workgroups: WorkgroupCount): DispatchReport;
}

/** What a {@link CpuModule.dispatch} ran: the workgroups, the invocations across them, and
 *  how many barrier phases the invocations of each workgroup went through in total.
 *
 *  Exported from `typeshade`.
 */
export interface DispatchReport {
  readonly workgroups: number;
  readonly invocations: number;
  readonly barrierPhases: number;
}

/** How the CPU backends evaluate f32 arithmetic.
 *
 *  - `'f64'` (default): every value is a JavaScript double, so the result is the mathematically
 *    intended one to 53 bits. This is the reference an implementation is checked against.
 *  - `'f32'`: a correctly rounding f32 machine over the same IR the GPU receives. Every
 *    f32-typed operation rounds to f32 after it is evaluated, with ±Infinity on overflow. Use
 *    it when the question is what the target computes, so a parity gate can compare at ulp
 *    scale without a tolerance wide enough to hide a real error.
 *
 *  Exported from `typeshade`.
 */
export type CpuPrecision = 'f64' | 'f32';
