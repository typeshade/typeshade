import type { FuseArray, FuseLoop } from '../host-kernel.js';
import type { Tier } from '../tiers.js';
import type { GroupCall, EntryCall, PlannedCall } from './types.js';

interface Access {
  readonly param: string;
  readonly type: string;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly atI: boolean;
  readonly bare: boolean;
  readonly first?: FuseArray['first'];
}

export interface Info {
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

export function infoOf(call: PlannedCall): Info {
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
