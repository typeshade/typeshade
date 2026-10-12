// === `typeshade/fuse`: a host runs a chain of kernel-function calls as one plan (change 0058) ===
//
// A kernel function's call dispatches each of its loops on its own, and on WebGPU each dispatch
// reaches the queue in a submission of its own. `fuse` takes the calls a body makes over
// `Resident` arrays, records them, and runs them as one plan in one submission. The host imports
// it on purpose, as it imports `typeshade/emit`: `typeshade/runtime` imports only the slot the call
// layer asks (`core/fuse-scope.ts`), so an application that never imports `fuse` ships none of the
// planner. The plan and the recorder are `core/fuse-plan.ts`. Its module closure holds no file of
// the front end and no package, which `scripts/bundle-boundary.ts` holds in CI with a size budget
// (Rule 11.11).

import { runScope, type FuseReport, type FuseScope } from './core/fuse-plan.js';

export type { FuseReport, FuseScope };

/**
 * Run a chain of kernel-function calls as one plan, and resolve to a report of what the plan did.
 *
 * The runtime runs `body` once, synchronously. A kernel call the body makes whose written arrays
 * are all `Resident`s is recorded and not yet run. When `body` returns, the calls run as one unit
 * at the place `fuse` was called, in the order of Rule 11.8: a call or a `read()` made after
 * `fuse` returns sees what they wrote. On WebGPU the dispatches of all the calls are encoded into
 * one command encoder and reach the queue in one submission. On WebGL2 each loop draws as it does
 * outside a scope, and on the CPU tier the calls run one after another. Nothing is read back
 * while the plan runs, since every array it writes is resident.
 *
 * This version fuses nothing: each call is a group of its own, and runs as it runs outside a
 * scope. A call outside a scope is not changed.
 *
 * A call inside the body that is not a kernel call with resident written arrays is a
 * `TypeError` naming the call: an entry call (Rule 8.24), a draw, and a kernel call that writes
 * a host array, which would have to be read back. So are `read()`, `write()` and `destroy()` of
 * a `Resident` and every other use of the kernel queue, since they would run before the calls the
 * body recorded earlier. Close the scope around it. A `fuse` call inside the body joins the
 * scope, and returns that scope's report. The body is synchronous: an `async` function is a
 * `TypeError`, since a call after its first `await` would run outside the scope. A body that
 * throws leaves nothing to run.
 *
 * The promise rejects with the first error of the plan. The plan is one unit: the error also
 * stays on every `Resident` any of its calls writes, for `read()` to throw, as it does outside a
 * scope. Every call is checked before any runs, so a call that fails a check fails the plan
 * before any call of it ran.
 *
 * Exported from `typeshade/fuse`.
 *
 * @example
 * ```ts
 * import { resident } from 'typeshade/runtime';
 * import { fuse } from 'typeshade/fuse';
 * import { add, mul, relu } from './ops.shade.ts';
 *
 * const t = resident(new Float32Array(n));
 * const u = resident(new Float32Array(n));
 * const out = resident(new Float32Array(n));
 * const report = await fuse(() => {
 *   add(t, a, b);
 *   mul(u, t, c);
 *   relu(out, u);
 * });
 * report.submissions; // 1, on WebGPU
 * const y = await out.read();
 * ```
 *
 * @param body - a synchronous function that makes the kernel calls to plan; it receives the
 *   scope, which counts the calls recorded so far.
 * @returns the report of the plan once it has run.
 * @throws `TypeError`, as a rejection, for a body that is not a synchronous function. The errors
 *   of a call, such as a value that does not fit, are rejections too. Inside a body, a call that
 *   cannot be recorded throws.
 */
export function fuse(body: (scope: FuseScope) => void): Promise<FuseReport> {
  return runScope(body);
}
