// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).

import type { FuseArray, FuseLoop } from './host-kernel.js';
import type { Tier } from './tiers.js';
import { KERNEL_TREE, KERNEL_WORKGROUP } from './kernel-tree.js';
import type { GroupCall, EntryCall, PlannedCall, Group } from './fuse-group/types.js';
import { WEBGL2_APART } from './fuse-group/tier-words.js';
export { WEBGL2_APART, onLaterTier } from './fuse-group/tier-words.js';
export type { GroupCall, EntryCall, PlannedCall, Group } from './fuse-group/types.js';

export const DEFAULT_STORAGE_BUFFERS = 8;

interface Access {
  readonly param: string;
  readonly type: string;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly atI: boolean;
  readonly bare: boolean;
  readonly first?: FuseArray['first'];
}

interface Info {
  readonly name: string;
  readonly tier: Tier;
  readonly onCpu: boolean;
  readonly apart: string | undefined;
  readonly reduces: boolean;
  readonly wg: number | undefined;
  readonly declared: { readonly size: number; readonly name: string } | undefined;
  readonly partials: number;
  readonly range: GroupCall['range'];
  readonly step: number;
  readonly by: ReadonlyMap<object, Access>;
  readonly entry: boolean;
}

function apartOf(call: GroupCall): string | undefined {
  const { k, range } = call;
  if (k.gpu === undefined) return `runs on the CPU, ${k.noGpu ?? 'unknown'}`;
  if (k.gpu.loops.some((l) => l.device !== undefined)) return 'reads its trip count from an array';
  if (call.held === true) return 'pushes after a held length';
  if (k.gpu.finish !== undefined) return 'stores into an array after its loops';
  if (range === undefined) return `runs on the CPU, ${k.noGpu ?? 'unknown'}`;
  if (k.params.some((p) => p.k === 'texture')) return 'takes a texture';
  if (k.params.some((p) => p.k === 'collection')) return 'takes a Map or a Set';
  if (k.gpu.loops.some((l) => l.push !== undefined)) return 'pushes onto an array';
  if (k.fuse === undefined) return 'was built without typeshade({ fuse: true })';
  if (k.fuse.facts.length !== 1) return 'has more than one loop';
  const loop = k.fuse.facts[0]!;
  if (loop.scatters) return 'scatters';
  if (loop.continues) return 'has a loop with a `continue`';
  if (range.n === 0) return 'has a loop that runs no iteration';
  return undefined;
}

function entryInfoOf(call: EntryCall): Info {
  return {
    name: call.entry,
    tier: call.tier,
    onCpu: false,
    apart: undefined,
    reduces: false,
    wg: undefined,
    declared: undefined,
    partials: 0,
    range: undefined,
    step: 1,
    by: new Map(),
    entry: true,
  };
}

function infoOf(call: PlannedCall): Info {
  if ('entry' in call) return entryInfoOf(call);
  const { k } = call;
  const loop: FuseLoop | undefined = k.fuse?.facts.length === 1 ? k.fuse.facts[0] : undefined;
  const by = new Map<object, Access>();
  k.params.forEach((p, i) => {
    const key = call.arrays[i];
    if (p.k !== 'array' || key === undefined) return;
    const fact = loop?.arrays.find((a) => a.param === p.name);
    const here: Access = {
      param: p.name,
      type: p.s,
      reads: fact?.access === 'read' || fact?.access === 'readwrite',
      writes: fact?.access === 'write' || fact?.access === 'readwrite',
      atI: fact?.atI ?? true,
      bare: loop?.bare?.some((b) => b.param === p.name) === true,
      ...(fact?.first !== undefined ? { first: fact.first } : {}),
    };
    const had = by.get(key);
    by.set(
      key,
      had === undefined
        ? here
        : {
            param: had.param,
            type: had.type,
            reads: had.reads || here.reads,
            writes: had.writes || here.writes,
            atI: had.atI && here.atI,
            bare: had.bare || here.bare,
            ...((had.first ?? here.first) !== undefined ? { first: had.first ?? here.first } : {}),
          },
    );
  });
  return {
    name: k.name,
    tier: call.tier,
    onCpu: k.gpu === undefined || (call.range === undefined && k.gpu.loops.length > 0),
    apart: apartOf(call),
    reduces: loop?.reduces === true,
    wg: k.gpu?.loops[0]?.wg,
    declared:
      loop?.declared === true && k.gpu !== undefined
        ? { size: k.gpu.loops[0]!.wg, name: k.name }
        : undefined,
    partials: loop?.reduces === true ? (k.gpu?.loops[0]?.reduce?.vars.length ?? 0) : 0,
    range: call.range,
    step: k.gpu?.loops[0]?.step ?? 1,
    by,
    entry: false,
  };
}

const pair = (a: string, b: string, because: string): string =>
  `${a} and ${b} run as two dispatches because ${because}`;

const placed = (first: NonNullable<FuseArray['first']>): string =>
  `\`${first.text}\`${first.line !== undefined ? ` (line ${first.line})` : ''}`;

function declaredIn(
  infos: readonly Info[],
  group: readonly number[],
): { readonly size: number; readonly name: string } | undefined {
  for (const g of group) {
    const d = infos[g]!.declared;
    if (d !== undefined) return d;
  }
  return undefined;
}

function refusal(
  infos: readonly Info[],
  group: readonly number[],
  next: number,
  limit: number,
  held: (members: readonly number[]) => ReadonlySet<object>,
): { readonly why?: string } | undefined {
  const c = infos[next]!;
  const last = infos[group[group.length - 1]!]!;
  if (c.entry || last.entry) {
    const entry = c.entry ? c.name : last.name;
    return {
      why: pair(last.name, c.name, `${entry} is an entry call, which forms a group of its own`),
    };
  }
  if (c.tier === 'webgl2') return { why: WEBGL2_APART };
  if (c.tier === 'cpu') return c.onCpu ? { why: `${c.name} ${c.apart}` } : {};
  if (last.tier !== 'webgpu')
    return {
      why: `${c.name} runs apart from ${last.name}, which runs ${last.tier === 'cpu' ? 'on the CPU' : 'on WebGL2'}`,
    };
  if (c.apart !== undefined) return { why: pair(last.name, c.name, `${c.name} ${c.apart}`) };
  if (last.apart !== undefined)
    return { why: pair(last.name, c.name, `${last.name} ${last.apart}`) };
  if (last.reduces) return { why: pair(last.name, c.name, `${last.name} reduces`) };
  const first = infos[group[0]!]!;
  const [a, b] = [first.range!, c.range!];
  if (a.n !== b.n)
    return {
      why: pair(last.name, c.name, `the trip counts differ (${a.n} and ${b.n})`),
    };
  if (a.start !== b.start)
    return {
      why: pair(
        last.name,
        c.name,
        `the loops start at different indices (${a.start} and ${b.start})`,
      ),
    };
  if (first.step !== c.step)
    return {
      why: pair(
        last.name,
        c.name,
        `the loops step by different amounts (${first.step} and ${c.step})`,
      ),
    };
  const declared = declaredIn(infos, group);
  if (c.reduces) {
    if (declared !== undefined && declared.size !== KERNEL_TREE)
      return {
        why: pair(
          last.name,
          c.name,
          `workgroup size ${declared.size} of ${declared.name}() differs from the tree size ${KERNEL_TREE} of ${c.name}()`,
        ),
      };
  } else if (
    c.declared !== undefined &&
    declared !== undefined &&
    c.declared.size !== declared.size
  ) {
    return {
      why: pair(
        last.name,
        c.name,
        `workgroup size ${c.declared.size} of ${c.name}() differs from ${declared.size} of ${declared.name}()`,
      ),
    };
  }
  for (const m of group.map((g) => infos[g]!)) {
    for (const [key, mine] of m.by) {
      const theirs = c.by.get(key);
      if (theirs === undefined) continue;
      if (theirs.type !== mine.type)
        return {
          why: pair(
            m.name,
            c.name,
            `they see one array as ${mine.type} in ${m.name} and ${theirs.type} in ${c.name}`,
          ),
        };
      if (mine.writes && theirs.writes)
        return { why: pair(m.name, c.name, `${c.name} writes an array ${m.name} also writes`) };
      if (theirs.writes && mine.reads)
        return { why: pair(m.name, c.name, `${c.name} writes an array ${m.name} reads`) };
      if (mine.writes && theirs.reads) {
        if (!theirs.atI)
          return {
            why: pair(
              m.name,
              c.name,
              theirs.first !== undefined
                ? `${c.name} reads ${placed(theirs.first)}`
                : `${c.name} reads \`${theirs.param}\` other than at its loop's counter`,
            ),
          };
        if (!mine.atI)
          return {
            why: pair(
              m.name,
              c.name,
              mine.first !== undefined
                ? `${m.name} writes ${placed(mine.first)}`
                : `${m.name} writes \`${mine.param}\` other than at its loop's counter`,
            ),
          };
      }
    }
  }
  const bound = new Set<object>();
  for (const g of group) for (const key of infos[g]!.by.keys()) bound.add(key);
  for (const key of c.by.keys()) bound.add(key);
  for (const key of held([...group, next])) bound.delete(key);
  const binds = bound.size + c.partials;
  if (binds > limit)
    return {
      why: pair(
        last.name,
        c.name,
        `one dispatch would bind ${binds} storage buffers, and the device allows ${limit}`,
      ),
    };
  return undefined;
}

export function groupCalls(
  calls: readonly PlannedCall[],
  limit: number,
  scratch: ReadonlySet<object> = new Set(),
): Group[] {
  const infos = calls.map(infoOf);
  const users = new Map<object, number[]>();
  infos.forEach((info, i) => {
    for (const key of info.by.keys()) users.set(key, [...(users.get(key) ?? []), i]);
  });
  const held = (members: readonly number[]): ReadonlySet<object> => {
    const inside = new Set(members);
    const out = new Set<object>();
    for (const key of scratch) {
      const named = users.get(key);
      if (named === undefined || !named.every((i) => inside.has(i))) continue;
      const seen = named.map((i) => infos[i]!.by.get(key)!);
      if (seen.filter((a) => a.writes).length === 1 && seen.every((a) => a.atI && !a.bare))
        out.add(key);
    }
    return out;
  };
  const groups: { calls: number[]; why?: string }[] = [];
  infos.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const no = last === undefined ? {} : refusal(infos, last.calls, i, limit, held);
    if (last !== undefined && no === undefined) last.calls.push(i);
    else groups.push({ calls: [i], ...(no?.why !== undefined ? { why: no.why } : {}) });
  });
  return groups.map((g) => {
    const members = g.calls.map((i) => infos[i]!);
    const size =
      members.length === 1
        ? members[0]!.wg
        : members.some((m) => m.reduces)
          ? KERNEL_TREE
          : (declaredIn(infos, g.calls)?.size ?? KERNEL_WORKGROUP);
    return {
      ...g,
      fused: g.calls.length > 1,
      ...(members.every((m) => m.tier === 'webgpu') && size !== undefined
        ? { workgroupSize: size }
        : {}),
      contracted: g.calls.length > 1 ? [...held(g.calls)] : [],
    };
  });
}

export function assignSlots(calls: readonly GroupCall[]): {
  readonly slots: readonly (readonly (number | undefined)[])[];
  readonly arrays: readonly object[];
} {
  const arrays: object[] = [];
  const slots = calls.map((c) =>
    c.arrays.map((a) => {
      if (a === undefined) return undefined;
      const at = arrays.indexOf(a);
      return at >= 0 ? at : arrays.push(a) - 1;
    }),
  );
  return { slots, arrays };
}
