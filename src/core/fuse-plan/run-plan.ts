import type { FuseReport } from '../fuse-report.js';
import { uniformFor } from '../fuse-entry.js';
import {
  DispatchBatch,
  packed,
  type GpuBuffer,
  type GpuCounts,
  type Layout,
} from '../host-entry.js';
import type { CheckedEntry } from '../host-compute.js';
import { checkIncoming } from '../host-failure.js';
import {
  checkCall,
  kernelInputs,
  grid,
  reduceOnGpu,
  runChecked,
  tailResult,
  type CheckedCall,
  type Finish,
  type Folded,
  type PlanRun,
} from '../host-kernel.js';
import type { CallOwner } from '../owner.js';
import { ResidentArrayState } from '../resident.js';
import { TIERS, type Tier } from '../tiers.js';
import {
  kernelOf,
  writtenBy,
  ScratchState,
  type Plan,
  type PlanGroup,
  type RecordedCall,
  type RecordedKernel,
} from '../fuse-record.js';
import { settle, regroup, type FusedRun, type SettledPlan } from './settle.js';

async function runFused(
  group: PlanGroup,
  f: FusedRun,
  calls: readonly RecordedCall[],
  checked: readonly (CheckedCall | CheckedEntry)[],
  run: PlanRun,
): Promise<Finish[]> {
  const kernel = (i: number): RecordedKernel => kernelOf(calls[i]!);
  const kernelChecked = (i: number): CheckedCall => checked[i] as CheckedCall;
  const d = (await run.owner.device())!;
  run.tiers.add('webgpu');
  const values: Record<string, unknown> = {};
  const onDevice = new Map<string, GpuBuffer>();
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

export async function runPlan(
  calls: readonly RecordedCall[],
  planned: Plan,
  scratch: readonly ScratchState[],
  owner: CallOwner,
): Promise<FuseReport> {
  let plan: SettledPlan;
  const counts: GpuCounts = { dispatches: 0, submissions: 0, groupDispatches: [] };
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
  const finishes: Finish[] = [];
  const results: unknown[] = [];
  for (const s of scratch) s.phase = 'running';
  try {
    const checked = calls.map((c) =>
      c.kind === 'kernel'
        ? checkCall(c.cpu, c.k, c.argc, c.args)
        : c.host.checkEntryCall(c.e, c.argc, c.bindings, c.workgroups),
    );
    const supplied = new Set<ResidentArrayState>();
    calls.forEach((c, i) => {
      checkIncoming(
        c.kind === 'kernel'
          ? kernelInputs(c.k, checked[i] as CheckedCall, c.incoming)
          : c.host.entryInputs(c.e, checked[i] as CheckedEntry, c.incoming),
        supplied,
      );
      for (const s of writtenBy(c)) supplied.add(s);
    });
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
          await c.host.runEntry(c.cpu, c.e, checked[i] as CheckedEntry, run);
          finishes[i] = async () => undefined;
        } else finishes[i] = await runChecked(c.cpu, c.k, checked[i] as CheckedCall, run);
      }
    }
    await run.flush();
    for (const [i, finish] of finishes.entries()) results[i] = await finish();
  } catch (error) {
    batch?.discard();
    for (const c of calls) {
      for (const s of writtenBy(c)) {
        s.error = error;
        s.ahead = false;
      }
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
  const webgpuScratch = { allocations: 0, allocatedBytes: 0, reuses: 0, reusedBytes: 0 };
  for (const s of scratch) {
    webgpuScratch.allocations += s.webgpuScratch.allocations;
    webgpuScratch.allocatedBytes += s.webgpuScratch.allocatedBytes;
    webgpuScratch.reuses += s.webgpuScratch.reuses;
    webgpuScratch.reusedBytes += s.webgpuScratch.reusedBytes;
  }
  return {
    tier: TIERS.find((t) => tiers.has(t)) ?? 'cpu',
    dispatches: counts.dispatches,
    submissions: counts.submissions,
    webgpuScratch,
    groups: plan.groups.map((g, gi) => {
      const ns = gpuTimes.get(gi);
      return {
        calls: g.calls.map((i) => plan.calls[i]!.name),
        fused: g.fused,
        tier: g.tier,
        dispatches: counts.groupDispatches![gi] ?? 0,
        ...(g.why !== undefined ? { why: g.why } : {}),
        ...(g.workgroupShapes !== undefined ? { workgroupShapes: g.workgroupShapes } : {}),
        ...(typeof ns === 'number' ? { gpuTime: ns } : {}),
        ...(g.calls.some((i) => plan.calls[i]!.indirect) ? { indirect: true as const } : {}),
      };
    }),
  };
}
