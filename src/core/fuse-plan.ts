// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).

export type { FuseReport } from './fuse-report.js';
export { runPlan } from './fuse-plan/run-plan.js';
export { buildPlan, runScope, ScratchState } from './fuse-record.js';
export type { Plan, PlanCall, PlanDependency, PlanGroup, PlanInput } from './fuse-record.js';

export interface ScratchBuffers {
  readonly none?: never;
}

// Why: `unknown`, not `never`, before the program runtime's types load, so that a use of the
// handle is a type error and not a `never` that passes every check (the review of #1257, N1).
export type ScratchBuffer<E extends string> = ScratchBuffers extends { readonly [K in E]: infer B }
  ? B
  : unknown;

/**
 * What the body of a `fuse` call receives: the scope that records the kernel calls the body
 * makes, and makes the scratch arrays they share.
 *
 * Exported from `typeshade/fuse`.
 */
export interface FuseScope {
  /** How many kernel calls the body has made so far. The scope has recorded them and has not
   *  run them: they run when the body returns. */
  readonly recorded: number;
  /**
   * Make a scratch array: a handle for an intermediate between the calls of the body, which the
   * host never reads. A kernel call in the body takes it where it takes an `array<f32>`,
   * `array<i32>`, `array<u32>` or `array<vec4f>`, as the `element` says. It holds zeros when the
   * plan starts, as a new buffer does. A `'vec4f'` array holds `length` vectors, so `4 × length`
   * numbers. It is a `Buffer` (change 0138, Amendment A10, slice 1): a `Buffer<vec4f>` for
   * `'vec4f'`, whose `length` counts vectors (Amendment A11, Q5).
   *
   * Where the plan fuses every call that takes it into one dispatch, and each call reaches it
   * at exactly the loop's counter and never by its length, the fused entry holds it as a local:
   * no device buffer and no host array of `length` elements is made. Otherwise the plan makes a
   * zeroed device buffer for the scope, or on the CPU tier and WebGL2 a zeroed host array when
   * the first call needs it, and frees it when the plan has run, on success and on failure.
   *
   * `read()`, `set()`, `resize()`, `at()` and `needsUpdate` of the handle are a `TypeError` naming
   * it as scratch, and so is a
   * kernel call that takes it outside the body of the scope that made it or after the plan has
   * run. So is an entry call that takes it, in the body or after the plan has run: only a kernel
   * call of the body may take a scratch array. `dispose()` does nothing: the plan frees the array,
   * so a host that disposes every handle it holds stays correct. A `Buffer` from `array()` keeps
   * its buffer and its write inside a fused group, so the host may read it after the scope.
   *
   * @param length - how many elements it holds, a whole number from 0 to 4294967295.
   * @param element - the type of an element, `'f32'` when left out. `'vec4f'` is an element of
   *   four `f32` numbers, so the array takes `4 × length` numbers.
   * @returns the handle, which a kernel call takes as a `Buffer`.
   * @throws `TypeError` for a length that is not a whole number in that range, an element that
   *   is none of the four, and a call made when the body is not running.
   */
  scratch(length: number, element?: 'f32'): ScratchBuffer<'f32'>;
  scratch(length: number, element: 'i32'): ScratchBuffer<'i32'>;
  scratch(length: number, element: 'u32'): ScratchBuffer<'u32'>;
  scratch(length: number, element: 'vec4f'): ScratchBuffer<'vec4f'>;
}
