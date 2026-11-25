import { fusedFor, type Fused } from '../fuse-entry.js';
import {
  assignSlots,
  DEFAULT_STORAGE_BUFFERS,
  groupCalls,
  onLaterTier,
  type GroupCall,
  type PlannedCall,
} from '../fuse-group.js';
import { reportOf } from '../host-entry.js';
import type { CheckedEntry } from '../host-compute.js';
import type { CheckedCall } from '../host-kernel.js';
import type { CallOwner } from '../owner.js';
import { TIERS, type Tier } from '../tiers.js';
import {
  kernelOf,
  nameOf,
  ScratchState,
  type Plan,
  type PlanGroup,
  type RecordedCall,
} from '../fuse-record.js';
import { tierOf, tierOfEntry, type Choice } from './tier-choice.js';

export interface FusedRun {
  readonly fused: Fused;
  readonly arrays: readonly object[];
}

interface SettledGroup extends PlanGroup {
  readonly tier: Tier;
}

export type SettledPlan = Omit<Plan, 'groups'> & { readonly groups: readonly SettledGroup[] };

interface Settled {
  readonly groups: readonly SettledGroup[];
  readonly runs: readonly (FusedRun | undefined)[];
}

export async function settle(
  calls: readonly RecordedCall[],
  checked: readonly (CheckedCall | CheckedEntry)[],
  owner: CallOwner,
): Promise<Settled> {
  const choices: Choice[] = [];
  for (const [i, c] of calls.entries())
    choices.push(
      c.kind === 'kernel'
        ? await tierOf(c.k, checked[i] as CheckedCall, owner)
        : await tierOfEntry(c, owner),
    );
  const tiers = choices.map((c) => c.tier);
  const device = tiers.includes('webgpu') ? await owner.device() : null;
  const limit =
    (device === null ? undefined : reportOf(device).limits.maxStorageBuffersPerShaderStage) ??
    DEFAULT_STORAGE_BUFFERS;
  const seen: PlannedCall[] = calls.map((c, i): PlannedCall => {
    if (c.kind === 'entry') return { entry: c.e.name, tier: tiers[i]! };
    const at = checked[i] as CheckedCall;
    return {
      k: c.k,
      arrays: c.k.params.map((p, a) =>
        p.k === 'array' ? (at.states[a] ?? (at.hosts[a] as object)) : undefined,
      ),
      range: at.ranges?.[0],
      tier: tiers[i]!,
      ...(at.held.some((h) => h !== undefined) ? { held: true as const } : {}),
    };
  });
  const groups: SettledGroup[] = [];
  const runs: (FusedRun | undefined)[] = [];
  const scratch = new Set<object>(
    seen.flatMap((c) => ('entry' in c ? [] : c.arrays)).filter((a) => a instanceof ScratchState),
  );
  const alone = (i: number): (readonly [number, number, number])[] | undefined => {
    const c = calls[i]!;
    if (tiers[i] !== 'webgpu') return undefined;
    if (c.kind === 'entry') return [c.e.wg];
    return c.k.gpu !== undefined ? c.k.gpu.loops.map((l) => [l.wg, 1, 1] as const) : undefined;
  };
  for (const planned of groupCalls(seen, limit, scratch)) {
    const g: SettledGroup = {
      calls: planned.calls,
      fused: planned.fused,
      tier: tiers[planned.calls[0]!]!,
      ...(planned.why !== undefined ? { why: planned.why } : {}),
    };
    if (!g.fused) {
      const shapes = alone(g.calls[0]!);
      groups.push(shapes !== undefined ? { ...g, workgroupShapes: shapes } : g);
      runs.push(undefined);
      continue;
    }
    const { slots, arrays } = assignSlots(g.calls.map((i) => seen[i] as GroupCall));
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
        tier: tiers[i]!,
        ...(why !== undefined ? { why } : {}),
        ...(shape !== undefined ? { workgroupShapes: shape } : {}),
      });
      runs.push(undefined);
    });
  }
  const best = TIERS.find((t) => tiers.includes(t));
  return {
    groups: groups.map((g) => {
      const i = g.calls[0]!;
      const why = choices[i]!.why;
      return g.why === undefined && g.tier !== best && why.length > 0
        ? { ...g, why: onLaterTier(nameOf(calls[i]!), g.tier, why) }
        : g;
    }),
    runs,
  };
}

export const regroup = (plan: Plan, groups: readonly SettledGroup[]): SettledPlan => ({
  ...plan,
  groups,
  barriers: groups.slice(1).map((g) => g.calls[0]!),
});
