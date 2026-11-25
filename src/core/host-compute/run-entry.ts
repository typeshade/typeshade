import {
  configuredRuntime,
  flavored,
  isBuffer,
  isGuard,
  madeReport,
  onCpu,
  onGpu,
  packed,
  recordDispatches,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type GpuBuffer,
  type GpuDevice,
  type Workgroups,
} from '../host-entry.js';
import { checkEntryLimits, cpuSpecialization } from '../host-overrides.js';
import { defaultOwner, inferOwner, ownerOf, resourceOwner, type CallOwner } from '../owner.js';
import type { ResidentArrayState } from '../resident.js';
import { usedGl } from '../submission.js';
import type { PlanRun } from '../host-kernel.js';
import { entryPrograms } from './entry-programs.js';
import { entryTierFit } from './tier-fit.js';
import { onGl } from './gl-run.js';
import type { IndirectCount, CheckedEntry } from './checked-entry.js';

export async function runEntry(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  c: CheckedEntry,
  run: PlanRun | undefined,
): Promise<void> {
  const { states, checked, wg } = c;
  const why: string[] = [];
  let noCpu: string | undefined;
  const resources: [string, CallOwner | undefined][] = e.bindings.map((b) => [
    `binding "${b.name}"`,
    isBuffer(b) && states.has(b) ? ownerOf(states.get(b)!) : resourceOwner(checked.values[b.name]),
  ]);
  if ('state' in wg) resources.push(['"workgroups.indirect"', ownerOf(wg.state)]);
  const owner = inferOwner(`${e.name}()`, resources, run?.owner ?? c.owner);
  for (const tier of owner.tiers()) {
    const fit = await entryTierFit(e, owner, tier);
    if (fit.why !== undefined) {
      why.push(`${tier}: ${fit.why}`);
      if (tier === 'cpu') noCpu = fit.why;
      continue;
    }
    if (fit.tier === 'webgpu') {
      const { d } = fit;
      checkEntryLimits(e, d.limits ?? {});
      const onDevice = new Map<string, GpuBuffer>();
      for (const [b, s] of states)
        onDevice.set(
          b.name,
          s.bufferFor(d, b.layout, () => packed(b, s.host), b.writes),
        );
      const grid: Workgroups =
        'state' in wg
          ? {
              buffer: wg.state.bufferFor(
                d,
                COUNTS,
                () => (wg.state.host as Uint32Array).slice().buffer,
                false,
              ),
              offset: 4 * wg.offset,
            }
          : wg;
      const ge = flavored(e, owner.fp64Flavor(d));
      if (run === undefined)
        return (entryPrograms.run?.gpu ?? onGpu)(d, ge, { ...checked, onDevice }, grid);
      run.tiers.add('webgpu');
      await run.batchOn(d).add(ge, { ...checked, onDevice }, grid);
      return;
    }
    if (fit.tier === 'webgl2') {
      const { gl } = fit;
      await run?.flush();
      run?.tiers.add('webgl2');
      const grid = await gridOf(wg, owner, run);
      if (grid === undefined) return;
      await hostCopies(states, checked.values, run);
      if (run === undefined && c.recorded === true) {
        usedGl(gl);
        for (const [b, s] of states) if (b.writes) s.fence = gl;
      }
      if (
        run === undefined &&
        entryPrograms.run !== undefined &&
        !e.bindings.some((b) => b.name === '_fp64' && !isGuard(b))
      )
        return entryPrograms.run.gl(gl, e, checked, grid);
      const passes = await onGl(gl, e, e.gl!, checked, grid);
      if (run !== undefined) recordDispatches(run.counts, run.group, passes);
      return;
    }
    await run?.flush();
    run?.tiers.add('cpu');
    const grid = await gridOf(wg, owner, run);
    if (grid === undefined) return;
    await hostCopies(states, checked.values, run);
    if (e.overrideValues !== undefined) checkEntryLimits(e);
    const selected = cpuSpecialization(cpu, e);
    if (run === undefined && entryPrograms.run !== undefined)
      return entryPrograms.run.cpu(selected.cpu, selected.entry, checked.values, grid);
    onCpu(selected.cpu, selected.entry, checked.values, grid);
    return;
  }
  if (noCpu !== undefined) throw new TypeError(`${e.name}() has no tier: ${why.join('; ')}.`);
  throw new Error(`${e.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

const COUNTS = { k: 'a', n: null, st: 4, e: { k: 's', t: 'u32' } } as const;

const MOST_WORKGROUPS = 65535;

async function gridOf(
  wg: readonly [number, number, number] | IndirectCount,
  owner: CallOwner,
  run: PlanRun | undefined,
): Promise<readonly [number, number, number] | undefined> {
  if (!('state' in wg)) return wg;
  if ((await wg.state.sync(true)) && run !== undefined) run.counts.submissions++;
  const words = wg.state.host as Uint32Array;
  const grid = [words[wg.offset]!, words[wg.offset + 1]!, words[wg.offset + 2]!] as const;
  const limits =
    owner === defaultOwner
      ? ((configuredRuntime()?.device as GpuDevice | undefined)?.limits ?? madeReport()?.limits)
      : (await owner.device())?.limits;
  const most = limits?.maxComputeWorkgroupsPerDimension ?? MOST_WORKGROUPS;
  return grid.every((n) => n > 0 && n <= most) ? grid : undefined;
}

async function hostCopies(
  states: ReadonlyMap<EntryBinding, ResidentArrayState>,
  values: Record<string, unknown>,
  run: PlanRun | undefined,
): Promise<void> {
  for (const [b, s] of states) {
    if ((await s.sync()) && run !== undefined) run.counts.submissions++;
    values[b.name] = s.host;
  }
}
