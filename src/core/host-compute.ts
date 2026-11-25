// Implements: Rule 8.24, Rule 11.8, Rule 11.13 (docs/language-design.md; traced in reqs/).

import {
  checkBindings,
  configuredRuntime,
  describe,
  flavored,
  isBuffer,
  isGuard,
  madeReport,
  onCpu,
  onGpu,
  packed,
  recordDispatches,
  residentable,
  workgroupsOf,
  type Checked,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type GpuBuffer,
  type GpuDevice,
  type Workgroups,
} from './host-entry.js';
import { specializeEntry, checkEntryLimits, cpuSpecialization } from './host-overrides.js';
import { fuseSlot } from './fuse-scope.js';
import { checkIncoming, type IncomingReads } from './host-failure.js';
import {
  callDefault,
  defaultOwner,
  inferOwner,
  ownerOf,
  resourceOwner,
  type CallOwner,
} from './owner.js';
import {
  decide,
  kernelQueue,
  layoutKind,
  residentState,
  tentatively,
  type ResidentArrayState,
} from './resident.js';
import {
  argumentOwner,
  callSite,
  commitArguments,
  isRegionResource,
  isResource,
  joinRecorded,
  recordArgument,
  type RecordedArgument,
} from './host-record.js';
import { throwFailure, usedGl } from './submission.js';
import type { PlanRun } from './host-kernel.js';
import { entryPrograms } from './host-compute/entry-programs.js';
import { entryTierFit } from './host-compute/tier-fit.js';
export { entryTierFit } from './host-compute/tier-fit.js';
export type { EntryTierFit } from './host-compute/tier-fit.js';
import { onGl } from './host-compute/gl-run.js';
export { entryPrograms } from './host-compute/entry-programs.js';
export type { EntryPrograms } from './host-compute/entry-programs.js';

function checkArity(e: ComputeEntry, argc: number): void {
  if (argc !== 2 && argc !== 3)
    throw new TypeError(
      `${e.name}() takes 2 or 3 arguments, (bindings, workgroups, options?); got ${argc}.`,
    );
}

export function residentsOf(
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
): Map<EntryBinding, ResidentArrayState> {
  checkArity(e, argc);
  const states = new Map<EntryBinding, ResidentArrayState>();
  if (typeof bindings === 'object' && bindings !== null && !Array.isArray(bindings))
    for (const b of e.bindings) {
      const s = residentState((bindings as Record<string, unknown>)[b.name]);
      if (s === undefined || !isBuffer(b)) continue;
      if (!residentable(b))
        throw new TypeError(
          `${e.name}(): binding "${b.name}" (${b.s}) takes no Buffer: only a storage array with no size does.`,
        );
      const refusal = s.outside?.(`${e.name}(): binding "${b.name}"`);
      if (refusal !== undefined) throw refusal;
      const twin = [...states].find(([, t]) => t === s);
      if (twin !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${b.name}" is the same Buffer as binding "${twin[0].name}".`,
        );
      states.set(b, s);
    }
  return states;
}

export function indirectOf(e: ComputeEntry, workgroups: unknown): ResidentArrayState | undefined {
  if (typeof workgroups !== 'object' || workgroups === null || !('indirect' in workgroups))
    return undefined;
  const s = residentState(workgroups.indirect);
  const refusal = s?.outside?.(`${e.name}(): "workgroups.indirect"`);
  if (refusal !== undefined) throw refusal;
  return s;
}

export interface IndirectCount {
  readonly state: ResidentArrayState;
  readonly offset: number;
}

export interface CheckedEntry {
  readonly owner?: CallOwner;
  readonly recorded?: boolean;
  readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
  readonly checked: Checked;
  readonly wg: readonly [number, number, number] | IndirectCount;
}

function countsOf(
  e: ComputeEntry,
  workgroups: unknown,
  states: ReadonlyMap<EntryBinding, ResidentArrayState>,
): readonly [number, number, number] | IndirectCount {
  const wg = workgroupsOf(e, workgroups);
  if (Array.isArray(wg)) return wg;
  const { indirect, offset } = wg as { indirect: unknown; offset: number };
  const at = `${e.name}(): "workgroups.indirect"`;
  const s = indirectOf(e, workgroups);
  if (s === undefined)
    throw new TypeError(
      `${at} is a Buffer<u32> that holds the workgroup counts; got ${describe(indirect)}.`,
    );
  if (s.destroyed)
    throw new TypeError(`${at}: this Buffer was disposed; make a new one with array().`);
  const view = s.view();
  if (!(view instanceof Uint32Array))
    throw new TypeError(`${at} is a Buffer<u32>; got a Buffer of ${describe(view)}.`);
  if (offset + 3 > view.length)
    throw new TypeError(
      `${e.name}(): "workgroups.offset" is ${offset}, and the three counts from it need ${offset + 3} elements; the array holds ${view.length}.`,
    );
  for (const [b, t] of states)
    if (t === s && (b.writes || b.rw === true))
      throw new TypeError(
        `${at} is also binding "${b.name}", which the entry ${b.writes ? 'writes' : 'binds read_write'}. WebGPU cannot read the counts from a buffer that the same dispatch writes, so pass another Buffer.`,
      );
  return { state: s, offset };
}

export function checkEntryCall(
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
): CheckedEntry {
  const states = residentsOf(e, argc, bindings);
  let view = bindings;
  if (typeof bindings === 'object' && bindings !== null && !Array.isArray(bindings)) {
    const o: Record<string, unknown> = { ...(bindings as Record<string, unknown>) };
    for (const [b, s] of states) o[b.name] = s.view();
    view = o;
  }
  const residents = new Set([...states.keys()].map((b) => b.name));
  return {
    states,
    checked: checkBindings(e, view, residents),
    wg: countsOf(e, workgroups, states),
  };
}

export const entryHost = {
  residentsOf,
  indirectOf,
  checkEntryCall,
  entryTierFit,
  runEntry,
  entryInputs,
};

export function entryInputs(
  e: ComputeEntry,
  c: CheckedEntry,
  reads: IncomingReads,
): ResidentArrayState[] {
  const states = e.bindings.flatMap((b) => {
    if (!isBuffer(b)) return [];
    const s = c.states.get(b);
    return s !== undefined && (reads === undefined || reads.includes(b.name)) ? [s] : [];
  });
  if ('state' in c.wg) states.push(c.wg.state);
  return states;
}

export function callCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: unknown,
  workgroups: unknown,
  options?: unknown,
  reads?: IncomingReads,
): Promise<void> {
  let prepared = true;
  let refusal: unknown;
  try {
    checkArity(e, argc);
    e = specializeEntry(e, options);
  } catch (err) {
    if (fuseSlot.active !== undefined) throw err;
    prepared = false;
    refusal = err;
  }
  const resources =
    typeof bindings === 'object' && bindings !== null
      ? e.bindings.filter((b) => isResource((bindings as Record<string, unknown>)[b.name]))
      : [];
  if (fuseSlot.active !== undefined) {
    const region =
      typeof bindings === 'object' && bindings !== null
        ? e.bindings.find((b) => isRegionResource((bindings as Record<string, unknown>)[b.name]))
        : undefined;
    if (region !== undefined)
      throw new TypeError(
        `${e.name}(): binding "${region.name}" is a Buffer of structs or a Uniform, which the body of today's fuse() does not record; call the entry outside it, or pass a Buffer of scalars made with array(xs).`,
      );
    return fuseSlot.active.entry(
      cpu,
      e,
      argc,
      bindings,
      workgroups,
      entryHost,
      reads,
      callSite(callCompute, 1),
    );
  }
  if (resources.length > 0) {
    if (!prepared) throw refusal;
    return tentatively(() =>
      recordCompute(cpu, e, argc, bindings as Record<string, unknown>, workgroups, reads),
    ) as never;
  }
  try {
    throwFailure();
  } catch (err) {
    return Promise.reject(err);
  }
  const written: ResidentArrayState[] = [];
  const owners: [string, CallOwner | undefined][] = [];
  let owner: CallOwner;
  try {
    if (typeof bindings === 'object' && bindings !== null)
      for (const b of e.bindings) {
        const value = (bindings as Record<string, unknown>)[b.name];
        const s = residentState(value);
        owners.push([`binding "${b.name}"`, resourceOwner(value)]);
        if (s !== undefined && isBuffer(b) && b.writes) written.push(s);
      }
    owners.push([
      '"workgroups.indirect"',
      resourceOwner(
        typeof workgroups === 'object' && workgroups !== null && 'indirect' in workgroups
          ? workgroups.indirect
          : undefined,
        `${e.name}(): "workgroups.indirect"`,
      ),
    ]);
    owner = inferOwner(`${e.name}()`, owners, undefined, callDefault());
  } catch (err) {
    return Promise.reject(err);
  }
  const call = kernelQueue.run(async () => {
    if (!prepared) throw refusal;
    const checked = { ...checkEntryCall(e, argc, bindings, workgroups), owner };
    checkIncoming(entryInputs(e, checked, reads));
    await runEntry(cpu, e, checked, undefined);
  });
  call.then(
    () => written.forEach((s) => (s.error = undefined)),
    (err: unknown) => written.forEach((s) => (s.error = err)),
  );
  return call;
}

function recordCompute(
  cpu: GeneratedCpu,
  e: ComputeEntry,
  argc: number,
  bindings: Record<string, unknown>,
  workgroups: unknown,
  reads: IncomingReads,
): Promise<unknown> | undefined {
  const site = callSite(callCompute, 1);
  throwFailure();
  const mapped: Record<string, unknown> = { ...bindings };
  const indirect =
    typeof workgroups === 'object' && workgroups !== null && 'indirect' in workgroups
      ? workgroups.indirect
      : undefined;
  const owner = inferOwner(
    `${e.name}()`,
    [
      ...e.bindings.map((b): [string, CallOwner | undefined] => [
        `binding "${b.name}"`,
        argumentOwner(bindings[b.name]),
      ]),
      ['"workgroups.indirect"', resourceOwner(indirect, `${e.name}(): "workgroups.indirect"`)],
    ],
    undefined,
    callDefault(),
  );
  const countsError = residentState(indirect)?.error;
  if (countsError !== undefined) throw countsError;
  decide(residentState(indirect), 'u32', `${e.name}(): "workgroups.indirect"`, site);
  for (const b of e.bindings)
    if (isBuffer(b) && b.layout.k === 'a' && b.layout.n === null)
      decide(
        residentState(bindings[b.name]),
        layoutKind(b.layout),
        `${e.name}(): binding "${b.name}"`,
        site,
      );
  const taken: RecordedArgument[] = [];
  try {
    for (const b of e.bindings) {
      if (!(b.name in bindings)) continue;
      const at = `${e.name}(): binding "${b.name}"`;
      const buffer = isBuffer(b);
      const unsized = buffer && b.layout.k === 'a' && b.layout.n === null;
      const r = recordArgument(
        at,
        bindings[b.name],
        unsized ? (b.layout as { st: number; e: unknown }) : undefined,
        buffer && b.writes,
        buffer,
        owner,
      );
      taken.push(r);
      mapped[b.name] = r.value;
    }
  } catch (err) {
    for (const t of taken) t.buffer?.done();
    throw err;
  }
  const { uploads } = commitArguments(taken, () => checkEntryCall(e, argc, mapped, workgroups));
  const written = e.bindings.flatMap((b) => {
    const s = isBuffer(b) && b.writes ? residentState(mapped[b.name]) : undefined;
    return s === undefined ? [] : [s];
  });
  const waits = taken.some((t) => t.waits === true);
  const done = joinRecorded(
    `${e.name}()`,
    site,
    uploads,
    written,
    async () => {
      const checked = { ...checkEntryCall(e, argc, mapped, workgroups), owner, recorded: true };
      checkIncoming(entryInputs(e, checked, reads));
      await runEntry(cpu, e, checked, undefined);
    },
    waits,
  );
  return waits ? done : undefined;
}

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
