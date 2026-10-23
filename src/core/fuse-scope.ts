// ═══ The slot a `fuse` body runs in: what a call asks while a scope is open (change 0058) ═══
//
// The built-in recorder in core/fuse-record.ts fills this slot only while a synchronous body
// runs. Kernel and entry calls record; draws and other queue operations are refused. The queued
// plan loads core/fuse-plan.ts after reserving its place (change 0085). This slot imports none
// of the recorder or executor, so ordinary call modules need neither to check an active scope.

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

/** The active synchronous recorder. `open` retains the legacy registration hook used by
 * `typeshade/fuse`; current devices call the built-in recorder without consulting that hook. */
export const fuseSlot: {
  active: FuseRecorder | undefined;
  open: ((body: unknown, owner: unknown) => Promise<unknown>) | undefined;
} = { active: undefined, open: undefined };
