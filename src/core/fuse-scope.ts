// ═══ The slot a `fuse` body runs in: what a call asks while a scope is open (change 0058) ═══
//
// `typeshade/fuse` runs a body once and, while it runs, puts a recorder in the slot below. A
// kernel call, an entry call, a draw and every use of the kernel queue (`read()`, `write()` and
// `destroy()` of a `Resident` among them) look in the slot first (`core/host-kernel.ts`,
// `core/host-compute.ts`, `core/host-draw.ts`, `core/resident.ts`): with the slot empty they run
// as they always did. The body is synchronous and a scope is one item in the queue, taken when
// the body returns, so a use of the queue inside the body would run before the calls the body
// recorded before it. The recorder refuses it instead. The recorder, the plan and the report live
// in `core/fuse-plan.ts`, which only `typeshade/fuse` imports. This file is all the call layer
// imports of it, so that a host which never imports `typeshade/fuse` ships no planner.
//
// Like the rest of `typeshade/runtime` it imports no compiler, and it imports nothing at all.

/** What the call layer asks of the scope that is open. */
export interface FuseRecorder {
  /**
   * Take a kernel call into the scope instead of running it. `cpu` is the generated module's
   * CPU code, `k` the kernel function's face, and `args` the arguments it was called with.
   * Resolves, once the scope's plan has run, to what the call would have resolved to.
   *
   * @throws `TypeError` naming the call, for one that cannot be recorded.
   */
  kernel(cpu: unknown, k: unknown, argc: number, args: readonly unknown[]): Promise<unknown>;
  /**
   * Take an entry call into the scope instead of running it (Rule 8.24, change 0069): it forms a
   * group of its own in the plan. `cpu` is the generated module's CPU code, `e` the entry, and
   * `argc`, `bindings` and `workgroups` the arguments it was called with. `host` is what the call
   * layer lends the plan to check and run the call (`entryHost` in `core/host-compute.ts`): the
   * scope imports none of it. Resolves, once the scope's plan has run, as the entry's call
   * resolves outside a scope.
   *
   * @throws `TypeError` naming the call, for an entry call that cannot be recorded.
   */
  entry(
    cpu: unknown,
    e: unknown,
    argc: number,
    bindings: unknown,
    workgroups: unknown,
    host: unknown,
  ): Promise<void>;
  /** Refuse `call`, which `what` describes ("a draw"), because a scope records kernel calls and
   *  entry calls only. Always throws a `TypeError`. */
  refuse(call: string, what: string): never;
}

/** The scope that is open, if any. `typeshade/fuse` sets it while a body runs and clears it when
 *  the body returns or throws; a body is synchronous, so nothing else runs in between. */
export const fuseSlot: { active: FuseRecorder | undefined } = { active: undefined };
