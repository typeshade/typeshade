import {
  checkBindings,
  describe,
  isBuffer,
  residentable,
  workgroupsOf,
  type Checked,
  type ComputeEntry,
  type EntryBinding,
} from '../host-entry.js';
import type { IncomingReads } from '../host-failure.js';
import type { CallOwner } from '../owner.js';
import { residentState, type ResidentArrayState } from '../resident.js';

export function checkArity(e: ComputeEntry, argc: number): void {
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
