// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).
// The deferred executor of a recorded fuse plan (change 0085).
// core/fuse-record.ts runs the body and reserves the queue position before importing this file.
// This executor validates all calls, settles groups, emits fused WGSL and submits their work.
// It settles recorded promises and written residents together and releases scratch storage.
// Public FuseScope declarations stay here as type-only imports for existing declaration paths.
// The executor and its chunks contain no front end or external package (Rule 11.11).

import type { FuseReport } from './fuse-report.js';
export type { FuseReport } from './fuse-report.js';
import { fusedFor, uniformFor, type Fused } from './fuse-entry.js';
import {
  assignSlots,
  DEFAULT_STORAGE_BUFFERS,
  groupCalls,
  type GroupCall,
  type PlannedCall,
} from './fuse-group.js';
import {
  DispatchBatch,
  reportOf,
  packed,
  type ComputeEntry,
  type GpuBuffer,
  type GpuCounts,
  type Layout,
} from './host-entry.js';
import type { CheckedEntry } from './host-compute.js';
import {
  checkCall,
  grid,
  reduceOnGpu,
  runChecked,
  tailResult,
  type CheckedCall,
  type Finish,
  type Folded,
  type KernelFace,
  type PlanRun,
} from './host-kernel.js';
import { glContext } from './host-kernel-gl.js';
import type { CallOwner } from './owner.js';
import { ResidentArrayState, type Resident } from './resident.js';
import { TIERS, type Tier } from './tiers.js';

import {
  kernelOf,
  nameOf,
  writtenBy,
  ScratchState,
  type Plan,
  type PlanGroup,
  type RecordedCall,
  type RecordedKernel,
} from './fuse-record.js';
export { buildPlan, runScope, ScratchState } from './fuse-record.js';
export type { Plan, PlanCall, PlanDependency, PlanGroup, PlanInput } from './fuse-record.js';

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
   * numbers, and a `Resident<Float32Array>` of that many numbers is its host value.
   *
   * Where the plan fuses every call that takes it into one dispatch, and each call reaches it
   * at exactly the loop's counter and never by its length, the fused entry holds it as a local:
   * no device buffer and no host array of `length` elements is made. Otherwise the plan makes a
   * zeroed device buffer for the scope, or on the CPU tier and WebGL2 a zeroed host array when
   * the first call needs it, and frees it when the plan has run, on success and on failure.
   *
   * `read()` and `write()` of the handle are a `TypeError` naming it as scratch, and so is a
   * kernel call that takes it outside the body of the scope that made it or after the plan has
   * run. So is an entry call that takes it, in the body or after the plan has run: only a kernel
   * call of the body may take a scratch array. `destroy()` does nothing: the plan frees the array, so a host that destroys every
   * handle it holds stays correct. A handle from `resident()` keeps its buffer and its write
   * inside a fused group, so the host may read it after the scope.
   *
   * @param length - how many elements it holds, a whole number from 0 to 4294967295.
   * @param element - the type of an element, `'f32'` when left out. `'vec4f'` is an element of
   *   four `f32` numbers, so the array takes `4 × length` numbers.
   * @returns the handle, which a kernel call takes as a `Resident`.
   * @throws `TypeError` for a length that is not a whole number in that range, an element that
   *   is none of the four, and a call made when the body is not running.
   */
  scratch(length: number, element?: 'f32'): Resident<Float32Array>;
  scratch(length: number, element: 'i32'): Resident<Int32Array>;
  scratch(length: number, element: 'u32'): Resident<Uint32Array>;
  scratch(length: number, element: 'vec4f'): Resident<Float32Array>;
}

// ─── grouping ────────────────────────────────────────────────────────────────────────────────

/** The tier a checked call runs on: the first tier of `configure({ prefer })` that can run it,
 *  which is the choice `runChecked` makes, made before anything runs. A tier whose program a
 *  driver then refuses is not seen here; it only moves a call to a tier that fuses nothing. */
async function tierOf(k: KernelFace, c: CheckedCall, owner: CallOwner): Promise<Tier> {
  for (const tier of owner.tiers()) {
    if (tier === 'webgpu') {
      if (k.gpu !== undefined && c.ranges !== undefined && (await owner.device()) !== null)
        return tier;
    } else if (tier === 'webgl2') {
      if (
        k.gl !== undefined &&
        k.gpu !== undefined &&
        c.ranges !== undefined &&
        glContext() !== null
      )
        return tier;
    } else return tier;
  }
  return 'cpu';
}

/** The tier an entry call runs on: the first of `configure({ prefer })` that can run it, as
 *  `runEntry` chooses it (Rule 11.8). */
async function tierOfEntry(e: ComputeEntry, owner: CallOwner): Promise<Tier> {
  for (const tier of owner.tiers()) {
    if (tier === 'webgpu') {
      if ((await owner.device()) !== null) return tier;
    } else if (tier === 'webgl2') {
      if (e.gl !== undefined && glContext() !== null) return tier;
    } else return tier;
  }
  return 'cpu';
}

/** What a group of more than one call runs as: its entry, and the array each slot binds. */
interface FusedRun {
  readonly fused: Fused;
  readonly arrays: readonly object[];
}

/** The groups of a plan, and for each the fused entry it runs as, if it is more than one call. */
interface Settled {
  readonly groups: readonly PlanGroup[];
  readonly runs: readonly (FusedRun | undefined)[];
}

/**
 * Settle the groups of calls that have been checked: which tier each runs on, the storage buffers
 * the device allows a dispatch, the groups the planner makes and the entry of each group of
 * several calls. A group whose entry cannot be built runs its calls apart, and says why.
 */
async function settle(
  calls: readonly RecordedCall[],
  checked: readonly (CheckedCall | CheckedEntry)[],
  owner: CallOwner,
): Promise<Settled> {
  const tiers: Tier[] = [];
  for (const [i, c] of calls.entries())
    tiers.push(
      c.kind === 'kernel'
        ? await tierOf(c.k, checked[i] as CheckedCall, owner)
        : await tierOfEntry(c.e, owner),
    );
  // The limit is read from the device's report (change 0051, Rule 11.13 F5). The report is read
  // from the device the await gave, so the plan takes no step its await sequence did not take.
  const device = tiers.includes('webgpu') ? await owner.device() : null;
  const limit =
    (device === null ? undefined : reportOf(device).limits.maxStorageBuffersPerShaderStage) ??
    DEFAULT_STORAGE_BUFFERS;
  const seen: PlannedCall[] = calls.map((c, i): PlannedCall => {
    if (c.kind === 'entry') return { entry: c.e.name, tier: tiers[i]! };
    const at = checked[i] as CheckedCall;
    return {
      k: c.k,
      // An array is known by its identity: a `Resident`'s state, or the host array.
      arrays: c.k.params.map((p, a) =>
        p.k === 'array' ? (at.states[a] ?? (at.hosts[a] as object)) : undefined,
      ),
      range: at.ranges?.[0],
      tier: tiers[i]!,
      // A held length (change 0094): such a call is a group of its own.
      ...(at.held.some((h) => h !== undefined) ? { held: true as const } : {}),
    };
  });
  const groups: PlanGroup[] = [];
  const runs: (FusedRun | undefined)[] = [];
  // The scratch arrays of the scope: a group that fuses every call that names one holds it as a
  // local.
  const scratch = new Set<object>(
    seen.flatMap((c) => ('entry' in c ? [] : c.arrays)).filter((a) => a instanceof ScratchState),
  );
  // The workgroup of each loop of one call that runs on WebGPU alone, in loop order.
  const alone = (i: number): (readonly [number, number, number])[] | undefined => {
    const c = calls[i]!;
    if (tiers[i] !== 'webgpu') return undefined;
    if (c.kind === 'entry') return [c.e.wg];
    return c.k.gpu !== undefined ? c.k.gpu.loops.map((l) => [l.wg, 1, 1] as const) : undefined;
  };
  for (const planned of groupCalls(seen, limit, scratch)) {
    const g: PlanGroup = {
      calls: planned.calls,
      fused: planned.fused,
      ...(planned.why !== undefined ? { why: planned.why } : {}),
    };
    if (!g.fused) {
      const shapes = alone(g.calls[0]!);
      groups.push(shapes !== undefined ? { ...g, workgroupShapes: shapes } : g);
      runs.push(undefined);
      continue;
    }
    const { slots, arrays } = assignSlots(g.calls.map((i) => seen[i] as GroupCall));
    // The entry is built under the owner's flavor of the emulated double (change 0073).
    const fused = fusedFor(
      g.calls.map((i, m) => ({ k: kernelOf(calls[i]!).k, slots: slots[m]! })),
      arrays.flatMap((a, at) => (planned.contracted.includes(a) ? [at] : [])),
      owner.fp64Flavor(device ?? undefined),
    );
    if (!('none' in fused)) {
      groups.push({ ...g, workgroupShapes: [[fused.wg, 1, 1] as const] });
      runs.push({ fused, arrays });
      continue;
    }
    g.calls.forEach((i, m) => {
      const [before, name] = [nameOf(calls[g.calls[m - 1] ?? i]!), nameOf(calls[i]!)];
      const why =
        m === 0
          ? g.why
          : `${before} and ${name} run as two dispatches because the fused entry could not be built: ${fused.none}`;
      const shape = alone(i);
      groups.push({
        calls: [i],
        fused: false,
        ...(why !== undefined ? { why } : {}),
        ...(shape !== undefined ? { workgroupShapes: shape } : {}),
      });
      runs.push(undefined);
    });
  }
  return { groups, runs };
}

/** The plan with the groups the planner settled, and a barrier before each group but the first. */
const regroup = (plan: Plan, groups: readonly PlanGroup[]): Plan => ({
  ...plan,
  groups,
  barriers: groups.slice(1).map((g) => g.calls[0]!),
});

// ─── running ─────────────────────────────────────────────────────────────────────────────────

/**
 * Run the calls of a group as one dispatch: each distinct array is bound once, a `Resident` as
 * the buffer it already has on the device, as a call outside a scope binds it, and the dispatch
 * joins the plan's batch. The result of each call is what its tail gives, which a {@link Finish}
 * computes once the plan has submitted. A fused group is a group of calls that run on WebGPU, and
 * none has an empty range.
 *
 * A group whose last call reduces is that call's reduction with the calls before it as a prologue
 * (F6): its loop entry, then one fold entry for each level of partials, run as `callKernel` runs
 * them (`reduceOnGpu`). They are dispatches of the plan's batch like the others: the levels share
 * one device buffer of partials, each with a uniform of its own, and the folded values are copied
 * in the plan's submission and wait for the end of it. The tail of the last call takes what the
 * levels folded, and the tails of the others fold nothing.
 */
async function runFused(
  group: PlanGroup,
  f: FusedRun,
  calls: readonly RecordedCall[],
  checked: readonly (CheckedCall | CheckedEntry)[],
  run: PlanRun,
): Promise<Finish[]> {
  // A fused group holds kernel calls only (F8): each access below is of a kernel call.
  const kernel = (i: number): RecordedKernel => kernelOf(calls[i]!);
  const kernelChecked = (i: number): CheckedCall => checked[i] as CheckedCall;
  const d = (await run.owner.device())!;
  run.tiers.add('webgpu');
  const values: Record<string, unknown> = {};
  const onDevice = new Map<string, GpuBuffer>();
  // An array the entry holds as a local has no slot here: nothing of it is bound.
  f.fused.slots.forEach((slot) => {
    const array = f.arrays[slot.array]!;
    if (array instanceof ResidentArrayState)
      onDevice.set(
        slot.name,
        array.bufferFor(
          d,
          slot.binding.layout as Layout & { k: 'a' },
          () => packed(slot.binding, array.host),
          slot.written,
        ),
      );
    else values[slot.name] = array;
  });
  const ranges = group.calls.map((i) => kernelChecked(i).ranges![0]!);
  const uniform = uniformFor(
    group.calls.map((i, m) => ({
      k: kernel(i).k,
      hosts: kernelChecked(i).hosts,
      range: ranges[m]!,
    })),
  );
  values[f.fused.args.name] = uniform;
  const { reduce } = f.fused;
  let folded: Folded | undefined;
  if (reduce === undefined)
    await run
      .batchOn(d)
      .add(
        f.fused.entry,
        { values, images: new Map(), samplers: new Map(), onDevice },
        grid(Math.ceil(ranges[0]!.n / f.fused.wg)).wg,
      );
  else
    folded = await reduceOnGpu(
      d,
      {
        loop: f.fused.entry,
        fold: reduce.fold,
        args: f.fused.args.name,
        wg: f.fused.wg,
        vars: reduce.vars,
        fields: reduce.fields,
      },
      ranges[0]!.n,
      uniform,
      values,
      onDevice,
      run.batchOn(d),
    );
  const last = group.calls.length - 1;
  return group.calls.map(
    (i, m): Finish =>
      async () =>
        tailResult(
          kernel(i).cpu,
          kernel(i).k,
          kernelChecked(i).values,
          folded !== undefined && m === last ? await folded() : [],
        ),
  );
}

/**
 * Run the plan's calls in order, each as it runs outside a scope, except that on WebGPU all their
 * dispatches reach the queue together, and the calls of a group the planner fused are one
 * dispatch. Every call is checked before any runs, and the groups are settled before the first
 * dispatch. The dispatches are submitted when the last call has run, and before a call that must
 * see what they wrote: a call that runs on WebGL2 or the CPU, which reads its arrays from the
 * host. A reduction is no such call: its levels are dispatches of the batch like the rest, and
 * what it folded to is copied in the submission that holds them, so the result of a call that
 * reduces is computed after the last submission.
 *
 * The plan is one unit. If it fails, the error stays on every `Resident` any of its calls writes,
 * for `read()` to throw, as a failed call leaves it on the ones it writes, and every call of it
 * rejects. A call that ran before the failure may have changed what it wrote, and a call after it
 * did not run, so none of those arrays can be trusted. Whatever the outcome, the scratch arrays
 * of the scope are freed when the plan has run.
 */
export async function runPlan(
  calls: readonly RecordedCall[],
  planned: Plan,
  scratch: readonly ScratchState[],
  owner: CallOwner,
): Promise<FuseReport> {
  let plan = planned;
  const counts: GpuCounts = { dispatches: 0, submissions: 0 };
  const tiers = new Set<Tier>();
  let batch: DispatchBatch | undefined;
  const gpuTimes = new Map<number, number | null>();
  const run: PlanRun = {
    owner,
    counts,
    tiers,
    group: undefined,
    gpuTimes,
    batchOn(d) {
      batch ??= new DispatchBatch(d, counts, gpuTimes);
      if (batch.device !== d) throw new Error('fuse(): the device changed while the scope ran.');
      batch.group = run.group;
      return batch;
    },
    flush: async () => batch?.flush(),
  };
  // How to get the result of each call, in the order of the calls, and the results.
  const finishes: Finish[] = [];
  const results: unknown[] = [];
  // From here the scratch arrays are usable, by the calls of this plan and by nothing else.
  for (const s of scratch) s.phase = 'running';
  try {
    // Every call is checked before any runs (an entry call's bindings too, as a kernel call's).
    const checked = calls.map((c) =>
      c.kind === 'kernel'
        ? checkCall(c.cpu, c.k, c.argc, c.args)
        : c.host.checkEntryCall(c.e, c.argc, c.bindings, c.workgroups),
    );
    const settled = await settle(calls, checked, owner);
    plan = regroup(planned, settled.groups);
    for (const [gi, g] of settled.groups.entries()) {
      run.group = gi;
      const fused = settled.runs[gi];
      if (fused !== undefined) {
        const done = await runFused(g, fused, calls, checked, run);
        g.calls.forEach((i, m) => (finishes[i] = done[m]!));
        continue;
      }
      for (const i of g.calls) {
        const c = calls[i]!;
        if (c.kind === 'entry') {
          // An entry call is a group of its own (F8): its dispatch joins the batch, or a tier
          // that reads the host submits the batch first.
          await c.host.runEntry(c.cpu, c.e, checked[i] as CheckedEntry, run);
          finishes[i] = async () => undefined;
        } else finishes[i] = await runChecked(c.cpu, c.k, checked[i] as CheckedCall, run);
      }
    }
    await run.flush();
    // The device held what a reduction folded to until its submission.
    for (const [i, finish] of finishes.entries()) results[i] = await finish();
  } catch (error) {
    // What the batch holds was never submitted.
    batch?.discard();
    for (const c of calls) {
      for (const s of writtenBy(c)) s.error = error;
      c.settle.reject(error);
    }
    throw error;
  } finally {
    for (const s of scratch) s.release();
  }
  calls.forEach((c, i) => {
    for (const s of writtenBy(c)) s.error = undefined;
    if (c.kind === 'kernel') c.settle.resolve(results[i]);
    else c.settle.resolve();
  });
  return {
    tier: TIERS.find((t) => tiers.has(t)) ?? 'cpu',
    dispatches: counts.dispatches,
    submissions: counts.submissions,
    groups: plan.groups.map((g, gi) => {
      const ns = gpuTimes.get(gi);
      return {
        calls: g.calls.map((i) => plan.calls[i]!.name),
        fused: g.fused,
        ...(g.why !== undefined ? { why: g.why } : {}),
        ...(g.workgroupShapes !== undefined ? { workgroupShapes: g.workgroupShapes } : {}),
        ...(typeof ns === 'number' ? { gpuTime: ns } : {}),
        ...(g.calls.some((i) => plan.calls[i]!.indirect) ? { indirect: true as const } : {}),
      };
    }),
  };
}
