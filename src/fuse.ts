// === `typeshade/fuse`: a host runs a chain of kernel-function calls as one plan (change 0058) ===
//
// A kernel function's call dispatches each of its loops on its own, and on WebGPU each dispatch
// reaches the queue in a submission of its own. `fuse` takes the calls a body makes over
// `Resident` arrays, records them, and runs them as one plan in one submission, the calls the
// compiler's facts allow as one dispatch. The host imports it on purpose, as it imports
// `typeshade/emit`: `typeshade/runtime` imports only the slot the call layer asks
// (`core/fuse-scope.ts`), so an application that never imports `fuse` ships none of the planner.
// The plan and the recorder are `core/fuse-plan.ts`, the planner is `core/fuse-group.ts`, and
// `core/fuse-entry.ts` builds the entry of a fused group and emits it with the WGSL writer
// `typeshade/emit` uses. Its module closure holds no file of the front end and no package, which
// `scripts/bundle-boundary.ts` holds in CI with a size budget (Rule 11.11). The scope also makes
// scratch arrays, the intermediates of a chain that the host never reads: a group that fuses every
// call that names one holds it as a local of its entry, and then no buffer and no host array is
// made for it (`core/fuse-plan.ts`, `core/fuse-entry.ts`).

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
 * while the plan runs, since every array it writes is resident. A reduction is the exception to
 * the one submission: it reads its partials back between its levels, so the plan submits what it
 * holds before it, and the reduction's loop and each level of its partials are a submission each.
 *
 * The plan fuses what the facts allow. Consecutive calls that run on WebGPU become one dispatch
 * when each is the one loop of a kernel function built with `typeshade({ fuse: true })`, the loop
 * neither scatters nor continues of its own accord, the loops have one start, one trip count and
 * one step, an array one call wrote and a later call reads is written and read at exactly the
 * loop's index, no array a call writes is one an earlier call of the group reads or writes, and
 * the group binds no more arrays than the device allows storage buffers, the partials of a
 * reduction among them. A loop that reduces (`s += xs[i]`) may be the last call of a group: the
 * calls before it run as a prologue of each of its iterations, and its folds of the partials, and
 * the result of its call, are as they are outside a scope (Rule 7.2). No call joins a group after
 * a call that reduces. A call that does not join the group before it starts a group of its own,
 * and the report says why in the author's words: "mul and blur run as two dispatches because blur
 * reads `t[i - 1]` (line 9)". A module built without the option carries no facts, and its calls
 * run apart. WebGL2 runs the calls apart, and the CPU tier never fuses. A call outside a scope is
 * not changed.
 *
 * `scope.scratch(length)` makes an intermediate that the host never reads. Where the plan fuses
 * every call that takes it, and each reaches it at exactly the loop's counter and never by its
 * length, the fused entry holds it as a local, and no device buffer and no host array is made for
 * it. Otherwise it is a zeroed array that exists for the plan and is freed when the plan has run.
 * `read()` and `write()` of a scratch array, and a call that takes it outside the scope that made
 * it, are a `TypeError`. A `Resident` from `resident()` keeps its buffer and its write.
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
 * const out = resident(new Float32Array(n));
 * const report = await fuse((scope) => {
 *   const t = scope.scratch(n);
 *   const u = scope.scratch(n);
 *   add(t, a, b);
 *   mul(u, t, c);
 *   relu(out, u);
 * });
 * report.dispatches; // 1, on WebGPU: t and u are locals of the one entry
 * const y = await out.read();
 * ```
 *
 * @param body - a synchronous function that makes the kernel calls to plan; it receives the
 *   scope, which counts the calls recorded so far and makes scratch arrays.
 * @returns the report of the plan once it has run.
 * @throws `TypeError`, as a rejection, for a body that is not a synchronous function. The errors
 *   of a call, such as a value that does not fit, are rejections too. Inside a body, a call that
 *   cannot be recorded throws.
 */
export function fuse(body: (scope: FuseScope) => void): Promise<FuseReport> {
  return runScope(body);
}
