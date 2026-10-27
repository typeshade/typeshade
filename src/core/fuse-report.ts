// === The report of a fuse scope, and the arithmetic over several (Rule 11.13, change 0071) ===
//
// `FuseReport` is what `fuse()` and `device.fuse()` resolve to. It lives here, apart from the
// planner in `fuse-plan.ts`, so that `typeshade/runtime` can export the type and `mergeReports`
// without importing one line of the planner (Rule 11.11, change 0071 Amendment 2).

/**
 * What a `fuse` scope did once its plan had run. The counts are of the calls the plan made to
 * the device and nothing else: a `dispatches` is one dispatch on WebGPU or one draw on WebGL2,
 * and a `submissions` is one `queue.submit`, a read of a `Resident` that the plan needed
 * included.
 *
 * Exported from `typeshade/fuse`, from `typeshade/runtime` and from the root (change 0071,
 * Amendment 2), so a host that holds a report types it without importing the planner.
 */
export interface FuseReport {
  /** The best tier any call of the plan ran on: WebGPU before WebGL2 before the CPU tier, and
   *  `'cpu'` when no call ran on a device. Each call runs on the first tier of
   *  `configure({ prefer })` that can run it, as a call outside a scope does. */
  readonly tier: 'webgpu' | 'webgl2' | 'cpu';
  /** How many dispatches the plan made: none on the CPU tier. */
  readonly dispatches: number;
  /** How many times the plan gave the WebGPU queue commands: none on the other tiers. One for
   *  a scope whose calls all run on WebGPU, the calls that reduce among them: the loop of a
   *  reduction, the dispatches that fold its partials and the copy of what it folded to are in
   *  that submission. A call that runs on WebGL2 or the CPU tier reads its arrays from the host,
   *  so the plan submits what it holds before it, and each read of a `Resident` from the device
   *  that the call needs is a submission too. */
  readonly submissions: number;
  /** The groups of calls, in order, each by the names of its kernel functions. A group that is
   *  `fused` is one dispatch. `why` says, in the author's words, why a group stands apart from
   *  the one before it; a group with nothing to say leaves it out. */
  readonly groups: readonly {
    readonly calls: readonly string[];
    readonly fused: boolean;
    readonly why?: string;
    /** The workgroup of each dispatch the group made on WebGPU, as `[n, 1, 1]`, in dispatch
     *  order. A fused group or a single-loop call has one entry. A lone call of a function with
     *  more than one loop has one entry per loop: a map loop then a reducing loop gives
     *  `[[64,1,1],[256,1,1]]`. The fold levels of a reduction are not entries; they run at the
     *  size of their reducing loop. The entry that stores after a function's loops adds none
     *  (change 0094), so a function with no loop has `[]`. Absent exactly when the group does not
     *  run on WebGPU. */
    readonly workgroupShapes?: readonly (readonly [number, number, number])[];
    /** The GPU time of the group's compute passes, in nanoseconds, as the device measured it with
     *  timestamp queries (`timestamp-query`). Gaps between passes are in no group's time. The
     *  browser may round each timestamp to a coarser step. Absent when the device did not measure
     *  it: no `timestamp-query` feature, a group that does not run on WebGPU, or a failed read of
     *  the timestamps. It is not 0 in those cases. */
    readonly gpuTime?: number;
    /** Present, and `true`, for the group of an entry call whose workgroup count a
     *  `Resident<Uint32Array>` holds, `entry(bindings, { indirect, offset? })` (change 0075).
     *  Such a call is a group of its own. On WebGPU `dispatches` counts its dispatch once, whatever
     *  the counts hold, since the plan does not read them. The CPU tier and WebGL2 read them from
     *  the host copy when the call runs, and run nothing for a count with a 0 in it. */
    readonly indirect?: true;
  }[];
  /** The chunk of a long kernel the plan ran (change 0074): present exactly when the plan was
   *  `device.fuse(body, { chunk })`. `key` and `units` are the chunk's, and `elapsedMs` is the wall
   *  time, in milliseconds, from the start of the plan to its fence (`device.wait()`), which the
   *  device learns the rate of `key` from. */
  readonly chunk?: {
    readonly key: string;
    readonly units: number;
    readonly elapsedMs: number;
  };
}

const TIER_RANK = { cpu: 0, webgl2: 1, webgpu: 2 } as const;

/**
 * The report of several plans as one, as a plan of several groups reports its own: the
 * `dispatches` and the `submissions` summed, the `groups` in the order given, and the `tier` the
 * most capable report ran on (WebGPU before WebGL2 before the CPU tier). With no report it is
 * the report of a plan that did nothing: `'cpu'`, 0, 0 and no group. Each group is the one its
 * report held, not a copy. A merged report has no `chunk` row, since it is no one chunk
 * (change 0074): `device.chunkRates` holds what the device measured of each key.
 *
 * Exported from `typeshade/runtime` and from the root (change 0071, Amendment 2).
 */
export function mergeReports(reports: readonly FuseReport[]): FuseReport {
  let tier: FuseReport['tier'] = 'cpu';
  let dispatches = 0;
  let submissions = 0;
  const groups: FuseReport['groups'][number][] = [];
  for (const r of reports) {
    if (TIER_RANK[r.tier] > TIER_RANK[tier]) tier = r.tier;
    dispatches += r.dispatches;
    submissions += r.submissions;
    groups.push(...r.groups);
  }
  return { tier, dispatches, submissions, groups };
}
