// Implements: Rule 11.8, Rule 11.13 (docs/language-design.md; traced in reqs/).

import { isBuffer, type ComputeEntry, type GeneratedCpu } from './host-entry.js';
import { specializeEntry } from './host-overrides.js';
import { fuseSlot } from './fuse-scope.js';
import { checkIncoming, type IncomingReads } from './host-failure.js';
import { callDefault, inferOwner, resourceOwner, type CallOwner } from './owner.js';
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
import { throwFailure } from './submission.js';
import { entryTierFit } from './host-compute/tier-fit.js';
export { entryTierFit } from './host-compute/tier-fit.js';
export type { EntryTierFit } from './host-compute/tier-fit.js';
import {
  checkArity,
  residentsOf,
  indirectOf,
  checkEntryCall,
  entryInputs,
} from './host-compute/checked-entry.js';
import { runEntry } from './host-compute/run-entry.js';
export { runEntry } from './host-compute/run-entry.js';
export {
  residentsOf,
  indirectOf,
  checkEntryCall,
  entryInputs,
} from './host-compute/checked-entry.js';
export type { IndirectCount, CheckedEntry } from './host-compute/checked-entry.js';
export { entryPrograms } from './host-compute/entry-programs.js';
export type { EntryPrograms } from './host-compute/entry-programs.js';

export const entryHost = {
  residentsOf,
  indirectOf,
  checkEntryCall,
  entryTierFit,
  runEntry,
  entryInputs,
};

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
