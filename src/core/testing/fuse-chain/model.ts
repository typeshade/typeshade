import { KERNEL_TREE } from '../../kernel-tree.js';
import type { ChainCall, ChainCorpus } from '../random-ir.js';
import { tripsOf, type Sizes } from './inputs.js';

export type Reason =
  | 'continues'
  | 'empty'
  | 'reduces'
  | 'trips'
  | 'start'
  | 'step'
  | 'waw'
  | 'war'
  | 'read'
  | 'write'
  | 'limit';

export interface ModelGroup {
  readonly calls: readonly number[];
  readonly because?: Reason;
  readonly contracted: readonly string[];
}

interface Reach {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly atI: boolean;
  readonly measures: boolean;
}

function reaches(call: ChainCall): Map<string, Reach> {
  const out = new Map<string, Reach>();
  for (const a of call.access)
    out.set(a.array, {
      reads: a.reads !== 'none',
      writes: a.writes !== 'none',
      atI: a.reads !== 'shifted' && a.writes !== 'strided',
      measures: a.measures,
    });
  return out;
}

export function modelGroups(c: ChainCorpus, s: Sizes, limit: number): ModelGroup[] {
  const info = c.calls.map((call) => {
    const trips = tripsOf(call, s);
    return {
      call,
      trips,
      apart: call.continues ? ('continues' as const) : trips === 0 ? ('empty' as const) : undefined,
      by: reaches(call),
    };
  });
  const scratch = c.arrays.filter((a) => a.scratch).map((a) => a.id);
  const held = (members: readonly number[]): Set<string> => {
    const out = new Set<string>();
    for (const id of scratch) {
      const users = info.flatMap((m, i) => (m.by.has(id) ? [i] : []));
      if (users.length === 0 || !users.every((i) => members.includes(i))) continue;
      const seen = users.map((i) => info[i]!.by.get(id)!);
      if (seen.filter((r) => r.writes).length === 1 && seen.every((r) => r.atI && !r.measures))
        out.add(id);
    }
    return out;
  };
  const groups: { calls: number[]; because?: Reason }[] = [];
  const refusal = (members: readonly number[], next: number): Reason | undefined => {
    const n = info[next]!;
    const last = info[members[members.length - 1]!]!;
    if (n.apart !== undefined) return n.apart;
    if (last.apart !== undefined) return last.apart;
    if (last.call.reduces > 0) return 'reduces';
    const first = info[members[0]!]!;
    if (first.trips !== n.trips) return 'trips';
    if (first.call.start !== n.call.start) return 'start';
    if (first.call.step !== n.call.step) return 'step';
    for (const m of members.map((g) => info[g]!))
      for (const [id, mine] of m.by) {
        const theirs = n.by.get(id);
        if (theirs === undefined) continue;
        if (mine.writes && theirs.writes) return 'waw';
        if (theirs.writes && mine.reads) return 'war';
        if (mine.writes && theirs.reads) {
          if (!theirs.atI) return 'read';
          if (!mine.atI) return 'write';
        }
      }
    const bound = new Set<string>();
    for (const g of members) for (const id of info[g]!.by.keys()) bound.add(id);
    for (const id of n.by.keys()) bound.add(id);
    for (const id of held([...members, next])) bound.delete(id);
    return bound.size + n.call.reduces > limit ? 'limit' : undefined;
  };
  info.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const no = last === undefined ? undefined : refusal(last.calls, i);
    if (last !== undefined && no === undefined) last.calls.push(i);
    else groups.push({ calls: [i], ...(no !== undefined ? { because: no } : {}) });
  });
  return groups.map((g) => ({
    ...g,
    contracted: g.calls.length > 1 ? [...held(g.calls)] : [],
  }));
}

export function reasonOf(why: string | undefined): Reason | undefined {
  if (why === undefined) return undefined;
  const m = /^\S+ and \S+ run as two dispatches because (.*)$/.exec(why);
  if (m === null) return undefined;
  const t = m[1]!;
  if (/^the trip counts differ/.test(t)) return 'trips';
  if (/^the loops start at different indices/.test(t)) return 'start';
  if (/^the loops step by different amounts/.test(t)) return 'step';
  if (/^one dispatch would bind \d+ storage buffers/.test(t)) return 'limit';
  if (/^\S+ writes an array \S+ also writes$/.test(t)) return 'waw';
  if (/^\S+ writes an array \S+ reads$/.test(t)) return 'war';
  if (/^\S+ reads `/.test(t)) return 'read';
  if (/^\S+ writes `/.test(t)) return 'write';
  if (/^\S+ has a loop with a `continue`$/.test(t)) return 'continues';
  if (/^\S+ has a loop that runs no iteration$/.test(t)) return 'empty';
  if (/^\S+ reduces$/.test(t)) return 'reduces';
  return undefined;
}

export const shapeOf = (gs: readonly { readonly calls: readonly number[] }[]): number[][] =>
  gs.map((g) => [...g.calls]);

export function foldLevels(trips: number): number {
  let levels = 0;
  for (let partials = Math.ceil(trips / KERNEL_TREE); partials > 1; levels++)
    partials = Math.ceil(partials / KERNEL_TREE);
  return levels;
}

export function dispatchesOf(c: ChainCorpus, s: Sizes, model: readonly ModelGroup[]): number {
  let n = 0;
  for (const g of model) {
    const trips = tripsOf(c.calls[g.calls[0]!]!, s);
    if (trips === 0) continue;
    n += 1 + (c.calls[g.calls[g.calls.length - 1]!]!.reduces > 0 ? foldLevels(trips) : 0);
  }
  return n;
}

export type Fate = 'local' | 'outside' | 'writers' | 'offset' | 'measured';

export function scratchFates(c: ChainCorpus, groups: readonly ModelGroup[]): Map<string, Fate> {
  const fates = new Map<string, Fate>();
  for (const a of c.arrays) {
    if (!a.scratch) continue;
    const users = c.calls.flatMap((call, j) =>
      call.access.some((x) => x.array === a.id) ? [j] : [],
    );
    const seen = users.map((j) => reaches(c.calls[j]!).get(a.id)!);
    const home = groups.find((g) => users.every((j) => g.calls.includes(j)));
    fates.set(
      a.id,
      home?.contracted.includes(a.id) === true
        ? 'local'
        : home === undefined || home.calls.length < 2
          ? 'outside'
          : seen.filter((r) => r.writes).length !== 1
            ? 'writers'
            : seen.some((r) => !r.atI)
              ? 'offset'
              : 'measured',
    );
  }
  return fates;
}
