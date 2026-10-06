// ═══ The passes of a split compute entry (change 0054), with no compiler in their closure ═══
//
// A split entry (`passes/phase-split.ts`) runs one pass at a time over every invocation of the
// dispatch. Three executors run it: the phased CPU oracle (`debug/phased.ts`), the CPU model of
// the WebGL2 executor (`testing/gl-model.ts`) and the WebGL2 executor itself (`gl-compute.ts`).
// They differ in their memory and agree on the order, which is this loop:
//
//   1. release each workgroup whose live invocations all wait at one barrier, and refuse one
//      whose invocations disagree about a barrier;
//   2. run a pass of every live invocation that is not waiting (the executor's `pass`, which
//      runs each and then scatters their writes in invocation index order);
//   3. in invocation index order, mark each invocation that stopped at a barrier as waiting and
//      resolve the atomic operation of each that stopped before one (`resolve`).
//
// It imports nothing, so the program runtime, which carries no compiler, can run it.

/** What the loop needs of an invocation. */
export interface PassInvocation {
  readonly wid: readonly number[];
  waiting: boolean;
}

/** One dispatch's invocations, in invocation index order, and what the executor does. */
export interface PassSchedule<I extends PassInvocation> {
  readonly invocations: readonly I[];
  /** Invocations per workgroup: `invocations` is that many per workgroup, workgroup by
   *  workgroup. */
  readonly perGroup: number;
  /** The resume point of a finished invocation. */
  readonly done: number;
  pcOf(inv: I): number;
  /** The cut a pass ends at when it leaves an invocation at `pc`, if any. */
  cutAt(pc: number): 'barrier' | 'atomic' | 'log' | undefined;
  /** The barrier that leads to `pc` and its line, for the message a divergent workgroup gets. */
  barrierAt(pc: number): { readonly fn: string; readonly line: string };
  pass(runnable: readonly I[]): void;
  resolve(inv: I, pc: number): void;
}

/** Run the passes until no invocation is live. Throws when the invocations of a workgroup
 *  disagree about a barrier: some finished while others wait at one, or they wait at different
 *  ones. */
export function runPasses<I extends PassInvocation>(
  s: PassSchedule<I>,
): { readonly passes: number; readonly barrierPhases: number } {
  const groups = s.invocations.length / s.perGroup;
  let passes = 0;
  let barrierPhases = 0;
  for (;;) {
    const live = s.invocations.filter((inv) => s.pcOf(inv) !== s.done);
    if (live.length === 0) break;
    for (let w = 0; w < groups; w++) {
      const group = s.invocations.slice(w * s.perGroup, (w + 1) * s.perGroup);
      const alive = group.filter((inv) => s.pcOf(inv) !== s.done);
      if (alive.length === 0 || !alive.every((inv) => inv.waiting)) continue;
      const at = s.pcOf(alive[0]!);
      const { fn, line } = s.barrierAt(at);
      const wid = alive[0]!.wid;
      if (alive.length < group.length) {
        throw new Error(
          `typeshade/cpu: ${fn}() at ${line} was reached by ${alive.length} of ${group.length} ` +
            `invocations of workgroup (${wid.join(', ')}); ${group.length - alive.length} returned before it. Every ` +
            `invocation of a workgroup must reach the same barrier: move it out of the branch, ` +
            `or the early return ahead of it.`,
        );
      }
      if (alive.some((inv) => s.pcOf(inv) !== at)) {
        throw new Error(
          `typeshade/cpu: the invocations of workgroup (${wid.join(', ')}) wait at different ` +
            `barriers (one at ${line}). Every invocation of a workgroup must reach the same ` +
            `barrier in the same order.`,
        );
      }
      for (const inv of alive) inv.waiting = false;
      barrierPhases++;
    }
    const runnable = live.filter((inv) => !inv.waiting);
    s.pass(runnable);
    passes++;
    for (const inv of runnable) {
      const pc = s.pcOf(inv);
      if (pc === s.done) continue;
      const cut = s.cutAt(pc);
      if (cut === 'barrier') inv.waiting = true;
      else if (cut === 'atomic') s.resolve(inv, pc);
    }
  }
  return { passes, barrierPhases };
}
