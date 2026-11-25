import { arityError, heldArgument } from './host-arity.js';
import type { CpuValue } from './cpu-runtime.js';
import { pushedLength, startPushesAt } from './push-count.js';
import { dispatchPush } from './host-kernel-push.js';
import { identityValue } from './host-kernel-identity.js';
import { CpuTexture, isCpuTexture } from './cpu-texture.js';
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
import type { PortableIr } from './ir/portable.js';
import { KERNEL_TREE, type TreeOp } from './kernel-tree.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import {
  glContext,
  onWebgl2,
  programOf as compileGl,
  type KernelGlLoop,
} from './host-kernel-gl.js';
import {
  decide,
  handleOf,
  kernelQueue,
  layoutKind,
  lengthOf,
  isOpenHere,
  kindName,
  residentState,
  ResidentArrayState,
  tentatively,
  type ElementKind,
} from './resident.js';
import {
  callSite,
  argumentOwner,
  commitArguments,
  isRegionResource,
  isResource,
  joinRecorded,
  recordArgument,
  resources,
  type RecordedArgument,
} from './host-record.js';
import { throwFailure, usedGl } from './submission.js';
import {
  fromShader,
  toShader,
  type HostClasses,
  type HostNumber,
  type HostType,
} from './host-values.js';
import type { Tier } from './tiers.js';
import {
  bulkOf,
  byteSize,
  DispatchBatch,
  fromCpu,
  gpuDevice,
  imageOf,
  matrixFlat,
  Misfit,
  pack,
  packed,
  projectInputLayout,
  storageBuffer,
  readInto,
  recordDispatches,
  runtimeCount,
  toCpu,
  zeroedBuffer,
  type GpuBuffer,
  type GpuCounts,
  type GpuDevice,
  type ComputeEntry,
  type DrawBinding,
  type EntryBinding,
  type GeneratedCpu,
  type HandleBinding,
  type Image,
  type Layout,
} from './host-entry.js';

export type KernelParam =
  | { readonly name: string; readonly k: 'value'; readonly type: HostType }
  /** An array with no size: the caller's storage (Rule 8.23). `s` is its TypeShade type.
   *  `pushed` marks an array a loop pushes onto, which the call also takes with a held length,
   *  `{ array, length, offset? }` (change 0094); absent for any other array. */
  | {
      readonly name: string;
      readonly k: 'array';
      readonly layout: Layout & { readonly k: 'a' };
      readonly writes: boolean;
      readonly s: string;
      readonly pushed?: true;
      readonly keys?: readonly string[];
    }
  /** A texture (change 0077): a `texture_2d<f32>` the loops read, or a 2D storage texture of
   *  `storage.format` they store into. `s` is its TypeShade type. */
  | {
      readonly name: string;
      readonly k: 'texture';
      readonly s: string;
      readonly storage?: { readonly format: string; readonly access: string };
    }
  /** ECMAScript's `Set<K>` or `Map<K, V>` (change 0080): the caller's, passed by reference.
   *  `value` is a Map's value type, absent for a Set; `writes` when a loop adds to it. `s` is
   *  its TypeShade type. */
  | {
      readonly name: string;
      readonly k: 'collection';
      readonly key: 'u32' | 'i32' | 'f32';
      readonly keys?: readonly string[];
      readonly value?: HostType;
      readonly writes: boolean;
      readonly s: string;
    };

export interface KernelLoop {
  readonly entry: string;
  readonly subgroupFold?: true;
  readonly range: string;
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly step: number;
  readonly writes: readonly string[];
  readonly checks: readonly {
    readonly param: string;
    readonly a: number;
    readonly c: number;
    readonly read?: true;
    readonly guards?: readonly { readonly cop: '<' | '<=' | '>' | '>='; readonly fn: string }[];
  }[];
  readonly texels?: readonly { readonly param: string; readonly width: string }[];
  readonly strides?: readonly {
    readonly param: string;
    readonly coefficient: string;
    readonly base: string;
  }[];
  readonly rows?: readonly { readonly param: string; readonly width: string }[];
  readonly wg: number;
  readonly push?: {
    readonly count: string;
    readonly scan: string;
    readonly binding: EntryBinding;
  };
  readonly device?: { readonly entry: string; readonly at: number };
  readonly reduce?: {
    readonly entry: string;
    readonly vars: readonly {
      readonly name: string;
      readonly op: TreeOp;
      readonly scalar: 'f32' | 'i32' | 'u32' | 'f64';
      readonly n: number;
      readonly binding: EntryBinding;
    }[];
  };
}

export interface PushWord {
  readonly param: string;
  readonly field: string;
  readonly binding: EntryBinding;
  readonly loops: readonly number[];
}

interface Variant {
  readonly wgsl: string;
  readonly wgslInteger?: string;
  readonly wgslSubgroup?: string;
  readonly wgslSubgroupInteger?: string;
  readonly args: EntryBinding;
  readonly words: readonly PushWord[];
  readonly guard?: { readonly group: number; readonly binding: number };
}

export interface FuseArray {
  readonly param: string;
  readonly access: 'read' | 'write' | 'readwrite';
  readonly atI: boolean;
  readonly first?: { readonly text: string; readonly line?: number };
}

export interface FuseBare {
  readonly param: string;
  readonly first: { readonly text: string; readonly line?: number };
}

export interface FuseLoop {
  readonly entry: string;
  readonly fold?: string;
  readonly wg: number;
  readonly declared?: boolean;
  readonly arrays: readonly FuseArray[];
  readonly bare?: readonly FuseBare[];
  readonly reduces: boolean;
  readonly scatters: boolean;
  readonly continues: boolean;
  readonly iterates: string;
  readonly iteration: number;
}

export interface KernelFuse {
  readonly origin: string;
  readonly facts: readonly FuseLoop[];
  readonly ir: PortableIr;
}

export interface KernelFace {
  readonly name: string;
  readonly P?: () => HostClasses;
  readonly fn: string;
  readonly params: readonly KernelParam[];
  readonly result: HostType;
  readonly gpu?: {
    readonly wgsl: string;
    readonly wgslInteger?: string;
    readonly wgslSubgroup?: string;
    readonly wgslSubgroupInteger?: string;
    readonly args: EntryBinding;
    readonly arrays: readonly EntryBinding[];
    readonly projected?: {
      readonly wgsl: string;
      readonly wgslInteger?: string;
      readonly wgslSubgroup?: string;
      readonly wgslSubgroupInteger?: string;
      readonly arrays: readonly EntryBinding[];
    };
    readonly textures?: readonly HandleBinding[];
    readonly loops: readonly KernelLoop[];
    readonly tail?: string;
    readonly countOnly?: true;
    readonly finish?: {
      readonly entry: string;
      readonly fn: string;
      readonly writes: readonly string[];
    };
    readonly words?: readonly PushWord[];
    readonly trips?: { readonly write: EntryBinding; readonly read: EntryBinding };
    readonly held?: {
      readonly wgsl: string;
      readonly wgslInteger?: string;
      readonly wgslSubgroup?: string;
      readonly wgslSubgroupInteger?: string;
      readonly args: EntryBinding;
      readonly words: readonly PushWord[];
      readonly guard?: { readonly group: number; readonly binding: number };
    };
    readonly guard?: { readonly group: number; readonly binding: number };
    readonly collections?: readonly {
      readonly param: string;
      readonly records: EntryBinding;
      readonly loop: number;
      readonly perIteration: number;
    }[];
    readonly lookups?: readonly {
      readonly param: string;
      readonly keys: EntryBinding;
      readonly values?: EntryBinding;
      readonly loop: number;
    }[];
  };
  readonly gl?: { readonly loops: readonly KernelGlLoop[] };
  readonly noWebgl2?: string;
  readonly noGpu?: string;
  readonly fuse?: KernelFuse;
}

const entries = new WeakMap<KernelFace, Map<string, LoopEntries[]>>();

interface LoopEntries {
  loop: ComputeEntry;
  range?: ComputeEntry;
  fold?: ComputeEntry;
  count?: ComputeEntry;
  scan?: ComputeEntry;
}

function variantOf(k: KernelFace, held: boolean): Variant & { readonly key: string } {
  const g = k.gpu!;
  if (held && g.held !== undefined) return { ...g.held, key: 'held' };
  return {
    wgsl: g.wgsl,
    ...(g.wgslInteger !== undefined ? { wgslInteger: g.wgslInteger } : {}),
    ...(g.wgslSubgroup !== undefined ? { wgslSubgroup: g.wgslSubgroup } : {}),
    ...(g.wgslSubgroupInteger !== undefined ? { wgslSubgroupInteger: g.wgslSubgroupInteger } : {}),
    args: g.args,
    words: g.words ?? [],
    ...(g.guard !== undefined ? { guard: g.guard } : {}),
    key: '',
  };
}

const TREE_PARAMS = [
  'global_invocation_id',
  'num_workgroups',
  'local_invocation_index',
  'workgroup_id',
] as const;

function textOf(v: Variant, integer: boolean, subgroup: boolean): string {
  if (subgroup && v.wgslSubgroup !== undefined)
    return integer && v.wgslSubgroupInteger !== undefined ? v.wgslSubgroupInteger : v.wgslSubgroup;
  return integer ? v.wgslInteger! : v.wgsl;
}

function underOf(
  v: Variant & { readonly key: string },
  integer: boolean,
  subgroup: boolean,
): string {
  return `${integer ? 'integer' : 'float'}${subgroup && v.wgslSubgroup !== undefined ? '+subgroup' : ''}${v.key}`;
}

function entriesOf(
  k: KernelFace,
  flavor: Fp64Flavor,
  held = false,
  subgroup = false,
): LoopEntries[] {
  const g = k.gpu!;
  const v = variantOf(k, held);
  const integer = flavor === 'integer' && v.wgslInteger !== undefined;
  const text = textOf(v, integer, subgroup);
  const under = underOf(v, integer, subgroup);
  let per = entries.get(k);
  if (per === undefined) entries.set(k, (per = new Map()));
  let es = per.get(under);
  if (es === undefined) {
    es = g.loops.map((loop, j) => {
      const parts = [
        ...(loop.reduce?.vars ?? []).map((v) => v.binding),
        ...(loop.push !== undefined ? [loop.push.binding] : []),
      ];
      const records = [
        ...(g.collections ?? []).filter((c) => c.loop === j).map((c) => c.records),
        ...(g.lookups ?? [])
          .filter((l) => l.loop <= j)
          .flatMap((l) => (l.values !== undefined ? [l.keys, l.values] : [l.keys])),
      ];
      const guard: DrawBinding[] =
        v.guard === undefined || integer
          ? []
          : [{ name: '_fp64', ...v.guard, space: 'texture', s: 'texture_2d<f32>', guard: true }];
      const entry = (fn: string, bindings: DrawBinding[], tree = false): ComputeEntry => ({
        name: k.name,
        fn,
        wgsl: text,
        wg: tree && loop.reduce === undefined ? [KERNEL_TREE, 1, 1] : [loop.wg, 1, 1],
        params: loop.reduce !== undefined || tree ? TREE_PARAMS : TREE_PARAMS.slice(0, 2),
        bindings: [...bindings, ...guard],
        workgroupZero: {},
      });
      const device =
        loop.device !== undefined ? [g.trips!.read, ...v.words.map((w) => w.binding)] : [];
      return {
        loop: entry(loop.entry, [
          v.args,
          ...g.arrays.map((b) => ({ ...b, writes: loop.writes.includes(b.name) })),
          ...records,
          ...parts,
          ...(g.textures ?? []),
          ...device,
        ]),
        ...(loop.device !== undefined
          ? {
              range: {
                ...entry(loop.device.entry, [
                  v.args,
                  ...g.arrays.map((b) => ({ ...b, writes: false })),
                  g.trips!.write,
                  ...v.words.map((w) => w.binding),
                ]),
                wg: [1, 1, 1],
                params: TREE_PARAMS.slice(0, 2),
              },
            }
          : {}),
        ...(loop.reduce !== undefined
          ? { fold: entry(loop.reduce.entry, [v.args, ...parts]) }
          : {}),
        ...(loop.push !== undefined
          ? {
              count: entry(loop.push.count, [
                v.args,
                ...g.arrays.map((b) => ({ ...b, writes: false })),
                ...records.map((b) => ({ ...b, writes: false })),
                ...parts,
                ...(g.textures ?? []),
              ]),
              scan: entry(
                loop.push.scan,
                [
                  v.args,
                  ...parts,
                  ...v.words.filter((w) => w.loops.includes(j)).map((w) => w.binding),
                ],
                true,
              ),
            }
          : {}),
      };
    });
    per.set(under, es);
  }
  return es;
}

const finishEntries = new WeakMap<KernelFace, Map<string, ComputeEntry>>();

function finishOf(k: KernelFace, flavor: Fp64Flavor, held = false, subgroup = false): ComputeEntry {
  const g = k.gpu!;
  const fin = g.finish!;
  const v = variantOf(k, held);
  const integer = flavor === 'integer' && v.wgslInteger !== undefined;
  const under = underOf(v, integer, subgroup);
  let per = finishEntries.get(k);
  if (per === undefined) finishEntries.set(k, (per = new Map()));
  const had = per.get(under);
  if (had !== undefined) return had;
  const guard: DrawBinding[] =
    v.guard === undefined || integer
      ? []
      : [{ name: '_fp64', ...v.guard, space: 'texture', s: 'texture_2d<f32>', guard: true }];
  const entry: ComputeEntry = {
    name: k.name,
    fn: fin.entry,
    wgsl: textOf(v, integer, subgroup),
    wg: [1, 1, 1],
    params: TREE_PARAMS.slice(0, 2),
    bindings: [
      v.args,
      ...g.arrays.map((b) => ({ ...b, writes: fin.writes.includes(b.name) })),
      ...g.loops.flatMap((l) =>
        (l.reduce?.vars ?? []).map((r) => ({ ...r.binding, writes: false })),
      ),
      ...v.words.map((w) => w.binding),
      ...guard,
    ],
    workgroupZero: {},
  };
  per.set(under, entry);
  return entry;
}

const NO_FOLD = 0xffffffff;

const STORAGE_BUFFERS = 8;

const TRIP_WORDS = 8;

const WORDS = { k: 'a', n: null, st: 4, e: { k: 's', t: 'u32' } } as const;

export function callKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  reads?: IncomingReads,
): Promise<unknown> {
  const scope = fuseSlot.active;
  if (scope !== undefined) {
    const r = args.findIndex(isRegionResource);
    if (r >= 0)
      throw new TypeError(
        `${k.name}(): parameter "${k.params[r]?.name ?? r}" is a Buffer of structs or a Uniform, which the body of today's fuse() does not record; call the function outside it, or pass a Buffer of scalars made with array(xs).`,
      );
    return scope.kernel(cpu, k, argc, args, reads, callSite(callKernel));
  }
  const onResource = args.some((a, i) => {
    if (isResource(a)) return true;
    const held = k.params[i]?.k === 'array' ? heldArgument(a) : undefined;
    return held !== undefined && (isResource(held.array) || isResource(held.length));
  });
  if (onResource) return tentatively(() => recordKernel(cpu, k, argc, args, reads)) as never;
  try {
    throwFailure();
  } catch (e) {
    return Promise.reject(e);
  }
  let owner: CallOwner;
  try {
    owner = inferOwner(
      `${k.name}()`,
      k.params.flatMap((p, i): [string, CallOwner | undefined][] => {
        const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
        if (held !== undefined)
          return [
            [`parameter "${p.name}"`, resourceOwner(held.array)],
            [`"${p.name}.length"`, resourceOwner(held.length, `${k.name}(): "${p.name}.length"`)],
          ];
        return [
          [
            `parameter "${p.name}"`,
            p.k === 'array' || p.k === 'texture' ? resourceOwner(args[i]) : undefined,
          ],
        ];
      }),
      undefined,
      callDefault(),
    );
  } catch (err) {
    return Promise.reject(err);
  }
  // Why: a call nobody awaits keeps its error on what it writes; no unit test holds a Resident here.
  const written = k.params.flatMap((p, i) => {
    if (p.k !== 'array') return [];
    const held = heldArgument(args[i]);
    return [
      p.writes ? residentState(held?.array ?? args[i]) : undefined,
      held !== undefined ? residentState(held.length) : undefined,
    ].filter((s) => s !== undefined);
  }) as ResidentArrayState[];
  const call = kernelQueue.run(() => runKernel(cpu, k, argc, args, owner, reads));
  call.then(
    () => written.forEach((s) => (s.error = undefined)),
    (e: unknown) => written.forEach((s) => (s.error = e)),
  );
  return call;
}

function runKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  owner: CallOwner,
  reads: IncomingReads,
  recorded = false,
): Promise<unknown> {
  try {
    const checked = { ...checkCall(cpu, k, argc, args), owner, recorded };
    checkIncoming(kernelInputs(k, checked, reads));
    return runChecked(cpu, k, checked);
  } catch (e) {
    return Promise.reject(e);
  }
}

function recordKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  reads: IncomingReads,
): unknown {
  const site = callSite(callKernel);
  throwFailure();
  const bad = arityError(k, argc);
  if (bad !== undefined) throw bad;
  const owner = inferOwner(
    `${k.name}()`,
    k.params.flatMap((p, i): [string, CallOwner | undefined][] => {
      const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
      if (held === undefined) return [[`parameter "${p.name}"`, argumentOwner(args[i])]];
      return [
        [`parameter "${p.name}"`, argumentOwner(held.array)],
        [`"${p.name}.length"`, argumentOwner(held.length, `${k.name}(): "${p.name}.length"`)],
      ];
    }),
    undefined,
    callDefault(),
  );
  const taken: RecordedArgument[] = [];
  const mapped: unknown[] = [];
  const bound: { readonly i: number; readonly state: ResidentArrayState }[] = [];
  let waits = false;
  try {
    k.params.forEach((p, i) => {
      const at = `${k.name}(): parameter "${p.name}"`;
      if (p.k === 'value' && residentState(args[i]) !== undefined) {
        const state = residentState(args[i])!;
        if (state.error !== undefined) throw state.error;
        decide(state, valueKind(p.type), at, site);
        mapped[i] = placeholderOf(at, p.type, state);
        bound.push({ i, state });
        return;
      }
      const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
      if (p.k === 'array') {
        decide(residentState(held?.array ?? args[i]), layoutKind(p.layout), at, site);
        if (held !== undefined)
          decide(residentState(held.length), 'u32', `${k.name}(): "${p.name}.length"`, site);
      }
      const r = recordArgument(
        at,
        held?.array ?? args[i],
        p.k === 'array' ? p.layout : undefined,
        (p.k === 'array' || p.k === 'collection') && p.writes,
        p.k !== 'texture',
        owner,
      );
      taken.push(r);
      if (r.waits === true) waits = true;
      const lengthError = held === undefined ? undefined : residentState(held.length)?.error;
      if (lengthError !== undefined) throw lengthError;
      mapped[i] =
        held === undefined
          ? r.value
          : {
              array: r.value,
              length: held.length,
              ...(held.offset !== undefined ? { offset: held.offset } : {}),
            };
    });
  } catch (e) {
    for (const t of taken) t.buffer?.done();
    throw e;
  }
  let plan: ResultPlan | undefined;
  if (k.result.k !== 'void' && !waits) {
    const planned = resultPlan(k.result);
    if (typeof planned === 'string') {
      for (const t of taken) t.buffer?.done();
      throw new TypeError(
        `${k.name}(): takes a resource, and returns ${k.result.s}, ${planned}. A call on a resource gives a Buffer for a number, a vector, a bool, a key, a matrix of f32, an array<T, N> of them or of structs, and a struct or a Record of those (change 0138, Amendments A10 Q-C, A11 Q6 and A12, decision 4); pass plain data and await the call.`,
      );
    }
    plan = planned;
  }
  const { uploads } = commitArguments(taken, () => checkCall(cpu, k, argc, mapped));
  const written: ResidentArrayState[] = [];
  k.params.forEach((p, i) => {
    if (p.k !== 'array') return;
    const held = heldArgument(mapped[i]);
    const s = p.writes ? residentState(held?.array ?? mapped[i]) : undefined;
    if (s !== undefined) written.push(s);
    const length = held === undefined ? undefined : residentState(held.length);
    if (length !== undefined) written.push(length);
  });
  const results = plan === undefined ? undefined : makeResults(plan, owner, k);
  if (results !== undefined) {
    written.push(...results.states);
    uploads.push(...results.uploads);
  }
  const done = joinRecorded(
    `${k.name}()`,
    site,
    uploads,
    written,
    async () => {
      for (const b of bound) mapped[b.i] = await boundValue(k, b.i, b.state);
      const value = await runKernel(cpu, k, argc, mapped, owner, reads, true);
      if (results !== undefined) results.fill(value);
      return value;
    },
    waits,
  );
  if (waits) return done;
  return results?.value;
}

function valueKind(t: HostType): string | undefined {
  if (t.k === 'num') return t.t;
  if (t.k === 'vec') return t.e === 'bool' ? undefined : t.e;
  if (t.k === 'mat') return t.e === 'f32' ? 'f32' : undefined;
  return undefined;
}

function heldText(state: ResidentArrayState): string {
  const n = lengthOf(state);
  const e = state.elem;
  const plural = (word: string, count: number): string =>
    `${count} ${word}${count === 1 ? '' : 's'}`;
  if (e?.k === 'bool')
    return state.components > 1 ? `${n} vec${state.components}<bool>` : plural('bool', n);
  if (e?.k === 'key') return `${plural('key', n)} of ${e.m.map((m) => `'${m}'`).join(' | ')}`;
  if (e?.k === 'mat') return `${n} mat${e.c}x${e.r}`;
  const scalars = n * state.components;
  if (isOpenHere(state)) return `${plural('number', scalars)} whose element is not fixed`;
  return `${plural(`${kindName(state)} number`, scalars)}`;
}

const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((m, i) => m === b[i]);

function placeholderOf(at: string, t: HostType, state: ResidentArrayState): unknown {
  const scalars = lengthOf(state) * state.components;
  const e = state.elem;
  if (e === undefined) {
    const kind = kindName(state);
    if (t.k === 'num' && kind === t.t && scalars === 1) return 0;
    if (t.k === 'vec' && kind === t.e && scalars === t.n) return new Array<number>(t.n).fill(0);
    if (
      t.k === 'mat' &&
      t.e === 'f32' &&
      kind === 'f32' &&
      state.components === 1 &&
      scalars === t.c * t.r
    )
      return new Array<number>(t.c * t.r).fill(0);
  } else if (e.k === 'bool') {
    if (t.k === 'bool' && scalars === 1) return false;
    if (t.k === 'vec' && t.e === 'bool' && scalars === t.n && state.components === t.n)
      return new Array<boolean>(t.n).fill(false);
  } else if (e.k === 'key') {
    if (t.k === 'key' && scalars === 1 && sameKeys(e.m, t.m)) return t.m[0];
  } else if (t.k === 'mat' && t.e === 'f32' && e.c === t.c && e.r === t.r && lengthOf(state) === 1)
    return new Array<number>(t.c * t.r).fill(0);
  if (
    t.k !== 'num' &&
    t.k !== 'vec' &&
    t.k !== 'bool' &&
    t.k !== 'key' &&
    !(t.k === 'mat' && t.e === 'f32')
  )
    throw new TypeError(
      `${at} (${t.s}) takes no Buffer: a Buffer is a parameter's value only for a number, a vector, a bool, a key or a matrix of f32 (change 0138, Amendment A10, Q-C; Amendment A12, decision 4).`,
    );
  const want = t.k === 'mat' ? `one ${t.s}, or of ${t.c * t.r} f32 numbers` : `one ${t.s}`;
  throw new TypeError(
    `${at} (${t.s}) takes a Buffer of ${want}; got a Buffer of ${heldText(state)}.`,
  );
}

async function boundValue(k: KernelFace, i: number, state: ResidentArrayState): Promise<unknown> {
  if (state.error !== undefined) throw state.error;
  await state.fenced();
  await state.sync(true);
  const values = state.host as ArrayLike<number>;
  const p = k.params[i]!;
  const t = p.k === 'value' ? p.type : undefined;
  if (t?.k === 'bool') return values[0] !== 0;
  if (t?.k === 'key') return t.m[values[0]!];
  if (t?.k === 'vec' && t.e === 'bool') return Array.from(values, (w) => w !== 0);
  return t?.k === 'vec' || t?.k === 'mat' ? Array.from(values) : values[0];
}

function checkElement(
  k: KernelFace,
  p: KernelParam & { k: 'array' },
  state: ResidentArrayState | undefined,
): void {
  if (state === undefined) return;
  const e = state.elem;
  const pe = p.layout.e;
  const fits =
    e === undefined
      ? pe.k !== 'm' || state.components === 1
      : e.k === 'key'
        ? p.keys !== undefined && sameKeys(e.m, p.keys)
        : e.k === 'mat'
          ? pe.k === 'm' && pe.c === e.c && pe.r === e.r
          : false;
  if (!fits)
    throw new TypeError(
      `${k.name}(): parameter "${p.name}" (${p.s}) takes no Buffer of ${heldText(state)}${e?.k === 'bool' ? ': no array<bool> exists, since a bool has no storage layout' : ''} (change 0138, Amendment A12, decision 4).`,
    );
}

type ResultPlan =
  | {
      readonly k: 'leaf';
      readonly kind: HostNumber;
      readonly n: number;
      readonly c: number;
      readonly elem?: ElementKind;
    }
  | {
      readonly k: 'structs';
      readonly s: string;
      readonly n: number;
      readonly layout: Layout & { readonly k: 'a' };
    }
  | { readonly k: 'struct'; readonly f: readonly (readonly [string, ResultPlan])[] };

function elementPlan(t: HostType, n: number): ResultPlan | string {
  switch (t.k) {
    case 'num':
      return { k: 'leaf', kind: t.t, n, c: 1 };
    case 'bool':
      return { k: 'leaf', kind: 'u32', n, c: 1, elem: { k: 'bool' } };
    case 'key':
      return { k: 'leaf', kind: 'u32', n, c: 1, elem: { k: 'key', m: t.m } };
    case 'vec':
      return t.e === 'bool'
        ? { k: 'leaf', kind: 'u32', n, c: t.n, elem: { k: 'bool' } }
        : { k: 'leaf', kind: t.e, n, c: t.n };
    case 'mat':
      return t.e === 'f64'
        ? 'which has no host value'
        : { k: 'leaf', kind: 'f32', n, c: t.c * t.r, elem: { k: 'mat', c: t.c, r: t.r } };
    default:
      return 'which no Buffer holds';
  }
}

function resultPlan(t: HostType): ResultPlan | string {
  switch (t.k) {
    case 'arr': {
      if (t.e.k === 'struct') {
        const layout = storageLayout(t.e);
        if (typeof layout === 'string') return `whose element ${layout}`;
        return {
          k: 'structs',
          s: t.e.s,
          n: t.n,
          layout: { k: 'a', n: null, st: layout.st, e: layout.l },
        };
      }
      if (t.e.k === 'arr' || t.e.k === 'rec') return 'which no Buffer holds';
      return elementPlan(t.e, t.n);
    }
    case 'struct':
    case 'rec': {
      const fields: readonly (readonly [string, HostType])[] =
        t.k === 'struct' ? t.f : t.m.map((m) => [m, t.e] as const);
      const f: (readonly [string, ResultPlan])[] = [];
      for (const [name, ft] of fields) {
        const sub = resultPlan(ft);
        if (typeof sub === 'string')
          return `whose field "${name}" (${ft.s}) ${sub.replace(/^which /u, '')}`;
        f.push([name, sub]);
      }
      return { k: 'struct', f };
    }
    default:
      return elementPlan(t, 1);
  }
}

function storageLayout(
  t: HostType,
):
  | { readonly l: Layout; readonly size: number; readonly align: number; readonly st: number }
  | string {
  const up = (n: number, a: number): number => Math.ceil(n / a) * a;
  const leaf = (l: Layout, size: number, align: number) => ({
    l,
    size,
    align,
    st: up(size, align),
  });
  switch (t.k) {
    case 'num':
      return t.t === 'f64' ? leaf({ k: 's', t: 'f64' }, 8, 8) : leaf({ k: 's', t: t.t }, 4, 4);
    case 'bool':
      return leaf({ k: 's', t: 'u32', b: 1 }, 4, 4);
    case 'key':
      return leaf({ k: 's', t: 'u32', m: t.m }, 4, 4);
    case 'vec': {
      const align = t.n === 2 ? 8 : 16;
      if (t.e === 'f64') {
        const lo = t.n === 2 ? 8 : 16;
        return leaf({ k: 'v', n: t.n, t: 'f64', lo }, up(lo + 4 * t.n, align), align);
      }
      const l: Layout =
        t.e === 'bool' ? { k: 'v', n: t.n, t: 'u32', b: 1 } : { k: 'v', n: t.n, t: t.e };
      return leaf(l, 4 * t.n, align);
    }
    case 'mat': {
      if (t.e === 'f64') return 'holds a matrix of f64, which has no host value';
      const cs = t.r === 2 ? 8 : 16;
      return leaf({ k: 'm', c: t.c, r: t.r, cs }, t.c * cs, cs);
    }
    case 'arr': {
      const e = storageLayout(t.e);
      if (typeof e === 'string') return e;
      return leaf({ k: 'a', n: t.n, st: e.st, e: e.l }, t.n * e.st, e.align);
    }
    case 'struct': {
      const f: (readonly [string, number, Layout])[] = [];
      let cursor = 0;
      let align = 4;
      for (const [name, ft] of t.f) {
        const fl = storageLayout(ft);
        if (typeof fl === 'string') return fl;
        cursor = up(cursor, fl.align);
        f.push([name, cursor, fl.l]);
        cursor += fl.size;
        align = Math.max(align, fl.align);
      }
      const size = up(cursor, align);
      return leaf({ k: 'o', f, sz: size }, size, align);
    }
    case 'rec':
      return `holds ${t.s}, whose members a Buffer of structs has no accessor for`;
    default:
      return `holds ${t.s}, which has no host value`;
  }
}

const RESULT_ARRAYS = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  f64: Float64Array,
} as const;

function wordsOf(v: unknown, elem: ElementKind | undefined): number[] {
  const xs = (Array.isArray(v) ? v.flat() : [v]) as unknown[];
  if (elem?.k === 'bool') return xs.map((x) => (x === true ? 1 : 0));
  if (elem?.k === 'key') return xs.map((x) => elem.m.indexOf(x as string));
  return xs as number[];
}

function makeResults(
  plan: ResultPlan,
  owner: CallOwner,
  k: KernelFace,
): {
  readonly value: unknown;
  readonly states: readonly ResidentArrayState[];
  readonly uploads: readonly (() => void)[];
  fill(result: unknown): void;
} {
  const states: ResidentArrayState[] = [];
  const uploads: (() => void)[] = [];
  const make = (p: ResultPlan): { readonly value: unknown; fill(v: unknown): void } => {
    if (p.k === 'struct') {
      const parts = p.f.map(([name, sub]) => [name, make(sub)] as const);
      return {
        value: Object.fromEntries(parts.map(([name, m]) => [name, m.value])),
        fill: (v) => {
          for (const [name, m] of parts) m.fill((v as Record<string, unknown>)[name]);
        },
      };
    }
    if (p.k === 'structs') {
      const make = resources.structs;
      if (make === undefined)
        throw new TypeError(
          `${k.name}(): returns ${p.s}s, whose Buffer is a resource of typeshade/runtime; import typeshade/runtime to call it on a resource.`,
        );
      const proto = k.P?.().get(p.s) ?? Object.prototype;
      const r = make(p.layout, proto, `Buffer<${p.s}>`, p.n, owner);
      states.push(r.state);
      if (r.upload !== undefined) uploads.push(r.upload);
      return { value: r.value, fill: (v) => r.fill(v as unknown[]) };
    }
    const C = RESULT_ARRAYS[p.kind];
    const state = new ResidentArrayState(new C(p.n * p.c));
    state.components = p.c;
    state.elem = p.elem;
    if (owner !== defaultOwner) state.ownedBy = owner;
    states.push(state);
    return {
      value: owner.result?.(state) ?? handleOf(state),
      fill: (v) => state.assign(new C(wordsOf(v, p.elem))),
    };
  };
  const root = make(plan);
  return { value: root.value, states, uploads, fill: root.fill };
}

export function kernelInputs(
  k: KernelFace,
  c: CheckedCall,
  reads: IncomingReads,
): ResidentArrayState[] {
  return k.params.flatMap((p, i) => {
    const state = c.states[i];
    const held = c.held[i];
    return [
      ...(state !== undefined && (reads === undefined || reads.includes(p.name)) ? [state] : []),
      ...(held === undefined ? [] : [held.state]),
    ];
  });
}

export { arityError } from './host-arity.js';

export interface HeldLength {
  readonly state: ResidentArrayState;
  readonly offset: number;
}

export interface KernelRange {
  readonly start: number;
  readonly n: number;
  readonly device?: true;
}

export interface CheckedCall {
  readonly owner?: CallOwner;
  readonly recorded?: boolean;
  readonly states: readonly (ResidentArrayState | undefined)[];
  readonly hosts: readonly unknown[];
  readonly values: readonly unknown[];
  readonly ranges: readonly KernelRange[] | undefined;
  readonly held: readonly (HeldLength | undefined)[];
}

export function checkCall(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
): CheckedCall {
  const bad = arityError(k, argc);
  if (bad !== undefined) throw bad;
  const held = k.params.map((p, i) => (p.k === 'array' ? checkHeld(k, p, args[i]) : undefined));
  const plain = args.map((a, i) => held[i]?.array ?? a);
  const states = plain.map((a) => residentState(a));
  states.forEach((s, i) => {
    if (s !== undefined && states.indexOf(s) !== i)
      throw new TypeError(
        `${k.name}(): parameter "${k.params[i]!.name}" is the same Buffer as parameter "${k.params[states.indexOf(s)]!.name}".`,
      );
  });
  held.forEach((h, i) => {
    if (h === undefined) return;
    const at = `${k.name}(): "${k.params[i]!.name}.length"`;
    const array = states.indexOf(h.state);
    if (array >= 0)
      throw new TypeError(`${at} is the same Buffer as parameter "${k.params[array]!.name}".`);
    const other = held.findIndex((g) => g?.state === h.state);
    if (other !== i)
      throw new TypeError(`${at} is the same Buffer as "${k.params[other]!.name}.length".`);
  });
  k.params.forEach((p, i) => {
    if (p.k === 'array') checkElement(k, p, states[i]);
  });
  const hosts = plain.map((a, i) => states[i]?.host ?? a);
  const values = k.params.map((p, i) =>
    p.k === 'value'
      ? toShader(k.name, p.name, p.type, hosts[i])
      : p.k === 'texture'
        ? checkTexture(k, p, hosts[i])
        : p.k === 'collection'
          ? checkCollection(k, p, hosts[i])
          : checkArray(k, p, hosts[i], states[i]),
  );
  const ranges = k.gpu !== undefined ? rangesOf(cpu, k, values) : undefined;
  return {
    states,
    hosts,
    values,
    ranges,
    held: held.map((h) => (h === undefined ? undefined : { state: h.state, offset: h.offset })),
  };
}

function checkHeld(
  k: KernelFace,
  p: KernelParam & { k: 'array' },
  v: unknown,
):
  | { readonly array: unknown; readonly state: ResidentArrayState; readonly offset: number }
  | undefined {
  const h = heldArgument(v);
  if (h === undefined) return undefined;
  if (p.pushed !== true)
    throw new TypeError(
      `${k.name}(): parameter "${p.name}" is an array no loop pushes onto, so it takes no { array, length, offset? }. Pass the array itself.`,
    );
  const at = `${k.name}(): "${p.name}.length"`;
  const offset = h.offset ?? 0;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0)
    throw new TypeError(
      `${k.name}(): "${p.name}.offset" counts elements of "${p.name}.length", so it is a whole number from 0; got ${describe(offset)}.`,
    );
  const s = residentState(h.length);
  if (s === undefined)
    throw new TypeError(
      `${at} is a Buffer<u32> that holds the length of "${p.name}"; got ${describe(h.length)}.`,
    );
  if (s.outside !== undefined)
    throw new TypeError(
      `${at} is a scratch array of fuse(), which the host never reads. Make the length with array() or device.array().`,
    );
  if (s.destroyed)
    throw new TypeError(`${at}: this Buffer was disposed; make a new one with array().`);
  const view = s.view();
  if (!(view instanceof Uint32Array))
    throw new TypeError(`${at} is a Buffer<u32>; got a Buffer of ${describe(view)}.`);
  if (offset + 1 > view.length)
    throw new TypeError(
      `${k.name}(): "${p.name}.offset" is ${offset}, and the length at it needs ${offset + 1} elements; "${p.name}.length" holds ${view.length}.`,
    );
  return { array: h.array, state: s, offset };
}

export interface PlanRun {
  readonly owner: CallOwner;
  readonly counts: GpuCounts;
  readonly tiers: Set<Tier>;
  group: number | undefined;
  readonly gpuTimes: Map<number, number | null>;
  batchOn(d: GpuDevice): DispatchBatch;
  flush(): Promise<void>;
}

export type Finish = () => Promise<unknown>;

export type Folded = () => Promise<CpuValue[]>;

const heldBy = (
  states: readonly (ResidentArrayState | undefined)[],
  hosts: readonly unknown[],
): unknown[] => hosts.map((h, i) => states[i]?.host ?? h);

async function syncAll(
  states: readonly (ResidentArrayState | undefined)[],
  run: PlanRun | undefined,
): Promise<void> {
  for (const s of states)
    if ((await s?.sync()) === true && run !== undefined) run.counts.submissions++;
}

export type TierFit =
  | { readonly why: string }
  | { readonly why?: undefined; readonly tier: 'webgpu'; readonly d: GpuDevice }
  | { readonly why?: undefined; readonly tier: 'webgl2'; readonly gl: WebGL2RenderingContext }
  | { readonly why?: undefined; readonly tier: 'cpu' };

export async function tierFit(
  k: KernelFace,
  c: CheckedCall,
  owner: CallOwner,
  tier: Tier,
): Promise<TierFit> {
  const { hosts, ranges, held } = c;
  if (tier === 'webgpu') {
    if (k.gpu === undefined || ranges === undefined)
      return { why: `it runs on the CPU, ${k.noGpu ?? 'unknown'}` };
    const cpuOnly = k.params.find((p, i) => p.k === 'texture' && isCpuTexture(hosts[i]));
    if (cpuOnly !== undefined)
      return { why: `parameter "${cpuOnly.name}" is a texture of the CPU tier's memory` };
    const unheld = held.findIndex(
      (h, i) =>
        h !== undefined && !variantOf(k, true).words.some((w) => w.param === k.params[i]!.name),
    );
    if (unheld >= 0)
      return {
        why: `its pushes onto "${k.params[unheld]!.name}" start after a held length only on the CPU tier`,
      };
    const d = await owner.device();
    if (d === null) return { why: 'there is no WebGPU device' };
    const most = d.limits?.maxStorageBuffersPerShaderStage ?? STORAGE_BUFFERS;
    const stores =
      k.gpu.finish === undefined
        ? 0
        : finishOf(
            k,
            owner.fp64Flavor(d),
            held.some((h) => h !== undefined),
            owner.subgroupFolds?.(d) === true,
          ).bindings.filter((b) => b.space === 'storage').length;
    if (stores > most)
      return {
        why: `its stores after the loops bind ${String(stores)} storage buffers, and the device allows ${String(most)}`,
      };
    const ranged = deviceBindings(
      k,
      owner.fp64Flavor(d),
      held.some((h) => h !== undefined),
      owner.subgroupFolds?.(d) === true,
    );
    if (ranged !== undefined && ranged.count > most)
      return {
        why: `loop ${String(ranged.loop + 1)} reads its trip count from an array, and its entries bind ${String(ranged.count)} storage buffers, which the device allows ${String(most)}`,
      };
    return { tier, d };
  }
  if (tier === 'webgl2') {
    if (k.gl === undefined || k.gpu === undefined || ranges === undefined)
      return { why: `it runs on the CPU, ${k.noWebgl2 ?? k.noGpu ?? 'unknown'}` };
    const gl = glContext();
    if (gl === null) return { why: 'there is no WebGL2 context' };
    try {
      for (const loop of k.gl.loops) compileGl(gl, loop);
    } catch (e) {
      return { why: e instanceof Error ? e.message : String(e) };
    }
    return { tier, gl };
  }
  const unread = k.params.find((p, i) => p.k === 'texture' && !cpuReads(hosts[i]));
  if (unread !== undefined)
    return {
      why: `parameter "${unread.name}" is a texture that is not supported yet on the CPU tier (Rule 11.8); the CPU tier reads an ImageData and a texture a device on the CPU tier made`,
    };
  return { tier: 'cpu' };
}

export function runChecked(cpu: GeneratedCpu, k: KernelFace, c: CheckedCall): Promise<unknown>;
export function runChecked(
  cpu: GeneratedCpu,
  k: KernelFace,
  c: CheckedCall,
  run: PlanRun,
): Promise<Finish>;
export async function runChecked(
  cpu: GeneratedCpu,
  k: KernelFace,
  c: CheckedCall,
  run?: PlanRun,
): Promise<unknown> {
  const { states, hosts, values, ranges, held } = c;
  const why: string[] = [];
  const result = (get: Finish): unknown => (run === undefined ? get() : get);
  const owner = inferOwner(
    `${k.name}()`,
    [
      ...k.params.map((p, i): [string, CallOwner | undefined] => [
        `parameter "${p.name}"`,
        states[i] === undefined
          ? p.k === 'texture'
            ? resourceOwner(hosts[i])
            : undefined
          : ownerOf(states[i]),
      ]),
      ...held.flatMap((h, i): [string, CallOwner | undefined][] =>
        h === undefined ? [] : [[`"${k.params[i]!.name}.length"`, ownerOf(h.state)]],
      ),
    ],
    run?.owner ?? c.owner,
  );
  const words = held.map((h) => h?.state);
  for (const tier of owner.tiers()) {
    const fit = await tierFit(k, c, owner, tier);
    if (fit.why !== undefined) {
      why.push(`${tier}: ${fit.why}`);
      continue;
    }
    if (fit.tier === 'webgpu') {
      const { d } = fit;
      run?.tiers.add(tier);
      const physical =
        run === undefined && states.every((s) => s === undefined) ? projectedInputs(k, hosts) : k;
      const subgroup = owner.subgroupFolds?.(d) === true;
      owner.dispatched?.(
        k.name,
        subgroup &&
          variantOf(
            physical,
            held.some((h) => h !== undefined),
          ).wgslSubgroup !== undefined
          ? 'subgroup'
          : 'tree',
      );
      const folded = await onDevice(
        d,
        physical,
        hosts,
        states,
        ranges!,
        run,
        owner.fp64Flavor(d),
        values,
        held,
        subgroup,
      );
      return result(async () => tailResult(cpu, k, values, await folded()));
    }
    if (fit.tier === 'webgl2') {
      const { gl } = fit;
      await run?.flush();
      await syncAll(states, run);
      run?.tiers.add(tier);
      const live = heldBy(states, hosts);
      const arrays = new Map<string, unknown>();
      const uniforms = new Map<string, unknown>();
      k.params.forEach((p, i) => {
        if (p.k === 'array') arrays.set(p.name, live[i]);
        uniforms.set(p.name, values[i]);
      });
      let drawn = 0;
      k.gl!.loops.forEach((loop, j) => {
        const face = k.gpu!.loops[j]!;
        const r = ranges![j]!.device === true ? glRange(cpu, k, j, live, values) : ranges![j]!;
        if (r.n > 0) drawn++;
        onWebgl2(gl, loop, arrays, uniforms, r.start, face.step, r.n);
      });
      // Why: WebGL2 has no store entry, so the CPU tier runs the stores over the draws' host copies;
      // only a real WebGL2 context reaches this.
      if (k.gpu!.finish !== undefined) finishOnHost(cpu, k, live, values);
      if (run !== undefined) recordDispatches(run.counts, run.group, drawn);
      // Why: a recorded call's read() waits on a WebGL2 fence of the flushed context; a plan keeps its
      // own submission (Rule 11.13) and a plain call reads back inside the call. Only a real WebGL2
      // context holds a fence, so no unit test does.
      if (run === undefined && c.recorded === true) {
        usedGl(gl);
        k.params.forEach((p, i) => {
          const s = states[i];
          if (p.k === 'array' && p.writes && s !== undefined) s.fence = gl;
        });
      }
      const out = tailResult(cpu, k, values, []);
      return result(async () => out);
    }
    const memory = new Map<string, CpuTexture>();
    k.params.forEach((p, i) => {
      if (p.k === 'texture') memory.set(p.name, cpuTextureOf(hosts[i])!);
    });
    await run?.flush();
    await syncAll([...states, ...words], run);
    run?.tiers.add(tier);
    const out = onCpu(cpu, k, heldBy(states, hosts), values, memory, held);
    return result(async () => out);
  }
  throw new Error(`${k.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

const projectedFaces = new WeakMap<KernelFace, KernelFace>();

function projectedInputs(k: KernelFace, hosts: readonly unknown[]): KernelFace {
  const projected = k.gpu?.projected;
  if (projected === undefined) return k;
  if (hosts.some((h, i) => h !== null && typeof h === 'object' && hosts.indexOf(h) !== i)) return k;
  let face = projectedFaces.get(k);
  if (face === undefined) {
    for (const b of projected.arrays) {
      const p = k.params.find((p) => p.name === b.name);
      if (p?.k === 'array' && b.layout.k === 'a' && b.layout.st !== p.layout.st)
        projectInputLayout(p.layout, b.layout);
    }
    face = { ...k, gpu: { ...k.gpu!, ...projected, projected: undefined } };
    projectedFaces.set(k, face);
  }
  return face;
}

export function tailResult(
  cpu: GeneratedCpu,
  k: KernelFace,
  values: readonly unknown[],
  folded: readonly CpuValue[],
): unknown {
  const tail = k.gpu!.tail;
  if (tail === undefined) return undefined;
  cpu.F['$initPrivates']?.();
  return fromShader(k.result, cpu.F[tail]!(...lengthsOf(k, values), ...folded));
}

function checkTexture(k: KernelFace, p: KernelParam & { k: 'texture' }, v: unknown): Image {
  const at = `${k.name}(): parameter "${p.name}" (${p.s})`;
  if (isCpuTexture(v)) {
    if (p.storage !== undefined && v.format !== p.storage.format)
      throw new TypeError(`${at}: got a ${v.format} texture; it stores ${p.storage.format}.`);
    return { source: v, width: v.width, height: v.height };
  }
  const img = imageOf(v);
  if (typeof img === 'string') throw new TypeError(`${at}: ${img}.`);
  if (p.storage === undefined) return img;
  const t = v as { format?: unknown; texture?: { usage?: unknown } };
  if (img.view === undefined)
    throw new TypeError(
      `${at}: takes a texture a device made with texture({ storage: true }), not an image source.`,
    );
  if (t.format !== p.storage.format)
    throw new TypeError(`${at}: got a ${String(t.format)} texture; it stores ${p.storage.format}.`);
  const usage = t.texture?.usage;
  if (typeof usage === 'number' && (usage & 0x08) === 0)
    throw new TypeError(`${at}: the texture was made without storage: true.`);
  return img;
}

function cpuTextureOf(v: unknown): CpuTexture | undefined {
  if (isCpuTexture(v)) return v;
  return cpuReads(v) ? CpuTexture.fromImageData(v as ImageData) : undefined;
}

function cpuReads(v: unknown): boolean {
  if (isCpuTexture(v)) return true;
  const g = globalThis as { ImageData?: abstract new (...a: never[]) => unknown };
  return g.ImageData !== undefined && v instanceof g.ImageData;
}

function fitsKey(key: 'u32' | 'i32' | 'f32', k: unknown): boolean {
  if (typeof k !== 'number') return false;
  if (key === 'f32') return Number.isNaN(k) || Math.fround(k) === k;
  if (!Number.isInteger(k)) return false;
  return key === 'u32' ? k >= 0 && k <= 0xffffffff : k >= -0x80000000 && k <= 0x7fffffff;
}

function checkCollection(
  k: KernelFace,
  p: KernelParam & { k: 'collection' },
  v: unknown,
): Map<number, CpuValue> | Set<number> {
  const at = `${k.name}(): parameter "${p.name}" (${p.s})`;
  const keyId = (key: unknown): number => {
    if (p.keys !== undefined) {
      const id = typeof key === 'string' ? p.keys.indexOf(key) : -1;
      if (id < 0)
        throw new TypeError(
          `${at}: the key ${describe(key)} is not one of ${p.keys.map((s) => JSON.stringify(s)).join(' | ')}.`,
        );
      return id;
    }
    if (!fitsKey(p.key, key))
      throw new TypeError(`${at}: the key ${describe(key)} is not a ${p.key}.`);
    return key as number;
  };
  if (p.value === undefined) {
    if (!(v instanceof Set)) throw new TypeError(`${at}: takes a Set; got ${describe(v)}.`);
    return new Set([...(v as Set<unknown>)].map(keyId));
  }
  if (!(v instanceof Map)) throw new TypeError(`${at}: takes a Map; got ${describe(v)}.`);
  const out = new Map<number, CpuValue>();
  for (const [key, value] of v as Map<unknown, unknown>) {
    out.set(keyId(key), toShader(k.name, `${p.name}" at key "${String(key)}`, p.value, value));
  }
  return out;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') return `a ${typeof v}`;
  return `a ${(v as object).constructor?.name ?? 'object'}`;
}

function collectionBack(
  p: KernelParam & { k: 'collection' },
  ran: Map<number, CpuValue> | Set<number>,
  host: unknown,
): void {
  if (p.value === undefined) {
    for (const key of ran as Set<number>) (host as Set<unknown>).add(p.keys?.[key] ?? key);
    return;
  }
  for (const [key, value] of ran as Map<number, CpuValue>)
    (host as Map<unknown, unknown>).set(p.keys?.[key] ?? key, fromShader(p.value, value));
}

function applyRecords(
  k: KernelFace,
  c: NonNullable<NonNullable<KernelFace['gpu']>['collections']>[number],
  count: number,
  dv: DataView,
  hosts: readonly unknown[],
  values: readonly unknown[],
): void {
  const i = k.params.findIndex((p) => p.name === c.param);
  const p = k.params[i] as KernelParam & { k: 'collection' };
  const l = c.records.layout as Layout & { k: 'a' };
  const fits = Math.floor(dv.byteLength / l.st);
  if (count > fits)
    throw new Error(
      `${k.name}(): loop ${c.loop + 1} added ${count} entries to "${p.name}", past the ${fits} the call made room for.`,
    );
  const host = hosts[i];
  const copy = values[i];
  for (let r = 0; r < count; r++) {
    if (p.value === undefined) {
      const key = readInto(dv, r * l.st, l.e, undefined) as number;
      (host as Set<unknown>).add(p.keys?.[key] ?? key);
      (copy as Set<number> | undefined)?.add(key);
      continue;
    }
    const entry = readInto(dv, r * l.st, l.e, blank(l.e)) as {
      k: number;
      v: unknown;
    };
    const hostValue = fromShader(p.value, entry.v as CpuValue);
    const value = toShader(k.name, p.name, p.value, hostValue);
    (host as Map<unknown, unknown>).set(p.keys?.[entry.k] ?? entry.k, hostValue);
    (copy as Map<number, CpuValue> | undefined)?.set(entry.k, value);
  }
}

const orderView = new DataView(new ArrayBuffer(4));
export function orderWord(key: 'u32' | 'i32' | 'f32', k: number): number {
  if (key === 'u32') return k >>> 0;
  if (key === 'i32') return k >>> 0;
  if (Number.isNaN(k)) return 0x7fc00000;
  if (k === 0) return 0;
  orderView.setFloat32(0, k, true);
  return orderView.getUint32(0, true);
}

function lookupTable(
  k: KernelFace,
  p: KernelParam & { k: 'collection' },
  host: unknown,
  values?: Layout & { k: 'a' },
): { keys: ArrayBuffer; values?: ArrayBuffer } {
  const entries: [number | string, unknown][] =
    p.value === undefined
      ? [...(host as Set<number | string>)].map((key) => [key, undefined])
      : [...(host as Map<number | string, unknown>)];
  const rows = entries
    .map(([key, value]) => ({
      word: orderWord(
        p.key,
        p.keys === undefined ? (key as number) : p.keys.indexOf(key as string),
      ),
      value,
    }))
    .sort((a, b) => a.word - b.word);
  const keys = new Uint32Array(rows.length + 1);
  keys[0] = rows.length;
  rows.forEach((r, i) => (keys[i + 1] = r.word));
  if (values === undefined) return { keys: keys.buffer };
  const bytes = new ArrayBuffer(Math.max(1, rows.length) * values.st);
  const dv = new DataView(bytes);
  rows.forEach((r, i) =>
    pack(dv, i * values.st, values.e, toShader(k.name, p.name, p.value!, r.value), ''),
  );
  return { keys: keys.buffer, values: bytes };
}

function blank(l: Layout): unknown {
  if (l.k === 'o') return Object.fromEntries(l.f.map(([name, , fl]) => [name, blank(fl)]));
  if (l.k === 'a' && l.n !== null) return Array.from({ length: l.n }, () => blank(l.e));
  return undefined;
}

function checkArray(
  k: KernelFace,
  p: KernelParam & { k: 'array' },
  v: unknown,
  s: ResidentArrayState | undefined,
): number {
  if (s?.measure !== undefined) return s.measure(k.name, p);
  try {
    if (s === undefined && matrixFlat(p.layout.e, v) !== undefined)
      throw new Misfit('', 'got a Float32Array, not an array');
    const size = byteSize(p.layout, v, '');
    if (bulkOf(p.layout, v) === undefined)
      pack(new DataView(new ArrayBuffer(Math.max(4, size))), 0, p.layout, v, '');
    return runtimeCount(p.layout, v, '');
  } catch (err) {
    if (!(err instanceof Misfit)) throw err;
    const at = err.path === '' ? '' : `at ${err.path}, `;
    throw new TypeError(`${k.name}(): parameter "${p.name}" (${p.s}): ${at}${err.problem}.`);
  }
}

function tripsOf(loop: KernelLoop, start: number, bound: number): number {
  const s = Math.abs(loop.step);
  const span =
    loop.cop === '<'
      ? bound - start
      : loop.cop === '<='
        ? bound - start + 1
        : loop.cop === '>'
          ? start - bound
          : start - bound + 1;
  return span <= 0 ? 0 : Math.ceil(span / s);
}

function rangesOf(cpu: GeneratedCpu, k: KernelFace, values: readonly unknown[]): KernelRange[] {
  const g = k.gpu!;
  const lengths = lengthsOf(k, values);
  const init = cpu.F['$initPrivates'];
  return g.loops.map((loop, j) => {
    if (loop.device !== undefined) return { start: 0, n: 0, device: true };
    init?.();
    const range = cpu.F[loop.range]!(...lengths) as unknown as readonly number[];
    const [start, bound] = [range[0]!, range[1]!];
    const n = tripsOf(loop, start, bound);
    if (n === 0) return { start, n };
    const last = start + (n - 1) * loop.step;
    const [lo, hi] = [Math.min(start, last), Math.max(start, last)];
    for (const c of loop.checks) {
      const i = k.params.findIndex((p) => p.name === c.param);
      const length = values[i] as number;
      let [from, to] = [lo, hi];
      for (const g of c.guards ?? []) {
        init?.();
        const bound = Number(cpu.F[g.fn]!(...lengths));
        if (!Number.isFinite(bound)) continue;
        if (g.cop === '<') to = Math.min(to, bound - 1);
        else if (g.cop === '<=') to = Math.min(to, bound);
        else if (g.cop === '>') from = Math.max(from, bound + 1);
        else from = Math.max(from, bound);
      }
      if (from > to) continue;
      const top = c.a > 0 ? c.a * to + c.c : c.a * from + c.c;
      const bottom = c.a > 0 ? c.a * from + c.c : c.a * to + c.c;
      if (top >= length || bottom < 0)
        throw new TypeError(
          `${k.name}(): parameter "${c.param}" holds ${length} elements, and loop ${j + 1} ${c.read ? 'reads' : 'writes'} it at indices ${bottom} to ${top}.`,
        );
    }
    const over = (param: string, bottom: number, top: number): void => {
      const length = values[k.params.findIndex((p) => p.name === param)] as number;
      if (top >= length || bottom < 0)
        throw new TypeError(
          `${k.name}(): parameter "${param}" holds ${length} elements, and loop ${j + 1} writes it at indices ${bottom} to ${top}.`,
        );
    };
    for (const s of loop.strides ?? []) {
      init?.();
      const step = Number(cpu.F[s.coefficient]!(...lengths));
      init?.();
      const base = Number(cpu.F[s.base]!(...lengths));
      if (step === 0)
        throw new TypeError(
          `${k.name}(): loop ${j + 1} writes parameter "${s.param}" at a stride of 0, so every iteration writes the same element.`,
        );
      const [a, b] = [step * lo + base, step * hi + base];
      over(s.param, Math.min(a, b), Math.max(a, b));
    }
    for (const r of loop.rows ?? []) {
      init?.();
      const w = Number(cpu.F[r.width]!(...lengths));
      if (w > 0) over(r.param, lo * w, hi * w + w - 1);
    }
    for (const t of loop.texels ?? []) {
      const i = k.params.findIndex((p) => p.name === t.param);
      const img = values[i] as Image;
      init?.();
      const w = Number(cpu.F[t.width]!(...lengths));
      const rows = Math.floor(hi / w) + 1;
      if (!(w >= 1) || lo < 0 || w > img.width || rows > img.height)
        throw new TypeError(
          `${k.name}(): parameter "${t.param}" is a ${img.width}x${img.height} texture, and loop ${j + 1} stores it ${w} texels to a row at iterations ${lo} to ${hi}, which reach row ${rows - 1}.`,
        );
    }
    return { start, n };
  });
}

function glRange(
  cpu: GeneratedCpu,
  k: KernelFace,
  j: number,
  live: readonly unknown[],
  values: readonly unknown[],
): KernelRange {
  const loop = k.gpu!.loops[j]!;
  const cpuArgs = k.params.map((p, i) =>
    p.k === 'array' ? toCpu(p.layout, live[i], false) : (values[i] as CpuValue),
  );
  cpu.F['$initPrivates']?.();
  const range = cpu.F[loop.range]!(...cpuArgs) as unknown as readonly number[];
  const [start, bound] = [range[0]!, range[1]!];
  const n = tripsOf(loop, start, bound);
  const out = k.gl!.loops[j]!.out;
  const length = (live[k.params.findIndex((p) => p.name === out)] as ArrayLike<unknown>).length;
  // Why: WebGL2 draws only the iterations `t` in `lo..hi` whose `start + t * step` lies in the array; only a WebGL2 context runs this.
  const step = loop.step;
  const lo =
    step > 0
      ? Math.max(0, Math.ceil(-start / step))
      : Math.max(0, Math.ceil((start - length + 1) / -step));
  const hi =
    step > 0
      ? Math.min(n - 1, Math.floor((length - 1 - start) / step))
      : Math.min(n - 1, Math.floor(start / -step));
  return hi < lo ? { start, n: 0 } : { start: start + lo * step, n: hi - lo + 1 };
}

function deviceBindings(
  k: KernelFace,
  flavor: Fp64Flavor,
  held: boolean,
  subgroup = false,
): { readonly loop: number; readonly count: number } | undefined {
  if (k.gpu?.trips === undefined) return undefined;
  const es = entriesOf(k, flavor, held, subgroup);
  let most: { loop: number; count: number } | undefined;
  for (const [j, e] of es.entries())
    for (const x of [e.loop, e.range]) {
      if (x === undefined || k.gpu.loops[j]!.device === undefined) continue;
      const count = x.bindings.filter((b) => b.space === 'storage').length;
      if (most === undefined || count > most.count) most = { loop: j, count };
    }
  return most;
}

function lengthsOf(k: KernelFace, values: readonly unknown[]): CpuValue[] {
  return k.params.map((p, i) =>
    p.k === 'array'
      ? ({ length: values[i] as number } as unknown as CpuValue)
      : p.k === 'texture'
        ? (0 as CpuValue)
        : (values[i] as CpuValue),
  );
}

export function grid(groups: number): { wg: [number, number, number]; slots: number } {
  const x = Math.max(1, Math.min(groups, 65535));
  const y = Math.ceil(groups / x);
  return { wg: [x, y, 1], slots: x * y };
}

async function onDevice(
  d: NonNullable<Awaited<ReturnType<typeof gpuDevice>>>,
  k: KernelFace,
  args: readonly unknown[],
  states: readonly (ResidentArrayState | undefined)[],
  ranges: readonly KernelRange[],
  run: PlanRun | undefined,
  flavor: Fp64Flavor,
  values: readonly unknown[] = [],
  held: readonly (HeldLength | undefined)[] = [],
  subgroup = false,
): Promise<Folded> {
  const g = k.gpu!;
  const holds = held.some((h) => h !== undefined);
  const variant = variantOf(k, holds);
  const es = entriesOf(k, flavor, holds, subgroup);
  const batch = run?.batchOn(d) ?? new DispatchBatch(d);
  const folds: Folded[] = [];
  const images = new Map<string, Image>();
  k.params.forEach((p, i) => {
    if (p.k === 'texture') images.set(p.name, imageOf(args[i]) as Image);
  });
  const onDevice = new Map<string, GpuBuffer>();
  k.params.forEach((p, i) => {
    const s = states[i];
    if (p.k !== 'array' || s === undefined) return;
    const b = g.arrays.find((x) => x.name === p.name)!;
    const writes =
      g.loops.some((l) => l.writes.includes(p.name)) || g.finish?.writes.includes(p.name) === true;
    onDevice.set(
      p.name,
      s.bufferFor(d, p.layout, () => packed(b, s.host), writes),
    );
  });
  const tables: GpuBuffer[] = [];
  const pending: (() => Promise<void>)[] = [];
  const upload = async (j: number): Promise<void> => {
    const here = (g.lookups ?? []).filter((l) => l.loop === j);
    if (here.length === 0) return;
    if (pending.length > 0) {
      await (run !== undefined ? run.flush() : batch.flush());
      for (const apply of pending.splice(0)) await apply();
    }
    for (const l of here) await uploadOne(l);
  };
  const uploadOne = async (
    l: NonNullable<NonNullable<KernelFace['gpu']>['lookups']>[number],
  ): Promise<void> => {
    const i = k.params.findIndex((p) => p.name === l.param);
    const table = lookupTable(
      k,
      k.params[i] as KernelParam & { k: 'collection' },
      args[i],
      l.values?.layout as (Layout & { k: 'a' }) | undefined,
    );
    const keys = storageBuffer(d, table.keys);
    tables.push(keys);
    onDevice.set(l.keys.name, keys);
    if (l.values !== undefined) {
      const values = storageBuffer(d, table.values!);
      tables.push(values);
      onDevice.set(l.values.name, values);
    }
  };
  const fin = g.countOnly === true ? undefined : g.finish;
  const ats: Record<string, number> = {};
  const partsOf = new Map<number, readonly GpuBuffer[]>();
  const kept: GpuBuffer[] = [];
  if (fin !== undefined)
    g.loops.forEach((l, j) => {
      if (l.reduce !== undefined) ats[`_at${String(j)}`] = NO_FOLD;
    });
  for (const w of variant.words) {
    const h = held[k.params.findIndex((p) => p.name === w.param)];
    if (h !== undefined) {
      const s = h.state;
      onDevice.set(
        w.binding.name,
        s.bufferFor(d, WORDS, () => (s.host as Uint32Array).slice().buffer, true),
      );
      ats[w.field] = h.offset;
    } else {
      const own = zeroedBuffer(d, 4);
      kept.push(own);
      onDevice.set(w.binding.name, own);
      ats[w.field] = 0;
    }
  }
  let trips: GpuBuffer | undefined;
  if (g.trips !== undefined) {
    const words = Math.max(...g.loops.map((l) => (l.device?.at ?? 0) + TRIP_WORDS));
    trips = zeroedBuffer(d, words * 4);
    kept.push(trips);
    onDevice.set(g.trips.write.name, trips);
    onDevice.set(g.trips.read.name, trips);
  }
  for (const [j, loop] of g.loops.entries()) {
    const { start, n } = ranges[j]!;
    const vars = loop.reduce?.vars ?? [];
    await upload(j);
    if (loop.device !== undefined) {
      const uniform: Record<string, unknown> = { _start: 0, _n: 0, _in: 0, _out: 0, ...ats };
      k.params.forEach((p, i) => {
        if (p.k === 'value') uniform[p.name] = values[i];
      });
      const bound_: Record<string, unknown> = { [g.args.name]: uniform };
      k.params.forEach((p, i) => {
        if (p.k === 'array') bound_[p.name] = args[i];
      });
      const checked = { values: bound_, images, samplers: new Map(), onDevice };
      try {
        await batch.add(es[j]!.range!, checked, [1, 1, 1]);
        await batch.add(es[j]!.loop, checked, {
          buffer: trips!,
          offset: (loop.device.at + 2) * 4,
        });
        if (run === undefined) await batch.flush();
      } catch (e) {
        for (const b of kept) b.destroy();
        throw e;
      }
      continue;
    }
    const word = variant.words.some((w) => w.loops.includes(j));
    if (n === 0 && !word) {
      // Why: with no iteration a variable folds to its identity and a push loop pushed nothing; the
      // device path of this needs a real WebGPU device, which no unit test has.
      const identities = vars.map((v) => identityValue(v.op, v.scalar, v.n));
      if (loop.push !== undefined) identities.push(0 as CpuValue);
      folds.push(async () => identities);
      if (fin !== undefined && vars.length > 0) {
        const unread = vars.map((v) =>
          zeroedBuffer(d, (v.binding.layout as Layout & { readonly k: 'a' }).st),
        );
        partsOf.set(j, unread);
        kept.push(...unread);
      }
      continue;
    }
    const uniform: Record<string, unknown> = { _start: start, _n: n, _in: 0, _out: 0, ...ats };
    k.params.forEach((p, i) => {
      if (p.k === 'value') uniform[p.name] = values[i];
    });
    const bound_: Record<string, unknown> = { [g.args.name]: uniform };
    k.params.forEach((p, i) => {
      if (p.k === 'array') bound_[p.name] = args[i];
    });

    if (loop.push !== undefined) {
      await dispatchPush({
        d,
        g,
        j,
        n,
        loop: { push: loop.push },
        entries: es[j]!,
        firstWorkgroups: grid(Math.ceil(n / loop.wg)).wg,
        boundValues: bound_,
        images,
        onDevice,
        batch,
        word,
        countOnly: g.countOnly === true,
        kept,
        folds,
        pending,
        applyRecords: (c, count, dv) => applyRecords(k, c, count, dv, args, values),
      });
    } else if (vars.length === 0) {
      const first = grid(Math.ceil(n / loop.wg));
      const checked = { values: bound_, images, samplers: new Map(), onDevice };
      await batch.add(es[j]!.loop, checked, first.wg);
    } else {
      const r = {
        loop: es[j]!.loop,
        fold: es[j]!.fold!,
        args: g.args.name,
        wg: loop.wg,
        vars,
        fields: OWN_FIELDS,
      };
      const keep =
        fin === undefined
          ? undefined
          : {
              read: g.tail !== undefined,
              partials: (at: number, buffers: readonly GpuBuffer[]): void => {
                ats[`_at${String(j)}`] = at;
                partsOf.set(j, buffers);
                kept.push(...buffers);
              },
            };
      folds.push(await reduceOnGpu(d, r, n, uniform, bound_, onDevice, batch, images, keep));
    }
    if (run === undefined) await batch.flush();
  }
  if (fin !== undefined) {
    const uniform: Record<string, unknown> = { _start: 0, _n: 0, _in: 0, _out: 0, ...ats };
    k.params.forEach((p, i) => {
      if (p.k === 'value') uniform[p.name] = values[i];
    });
    const bound_: Record<string, unknown> = { [g.args.name]: uniform };
    k.params.forEach((p, i) => {
      if (p.k === 'array') bound_[p.name] = args[i];
    });
    const bound = new Map(onDevice);
    for (const [j, buffers] of partsOf)
      g.loops[j]!.reduce!.vars.forEach((v, i) => bound.set(v.binding.name, buffers[i]!));
    try {
      await batch.add(
        finishOf(k, flavor, holds, subgroup),
        { values: bound_, images, samplers: new Map(), onDevice: bound },
        [1, 1, 1],
      );
      if (run === undefined) await batch.flush();
    } catch (e) {
      for (const b of kept) b.destroy();
      throw e;
    }
  }
  return async () => {
    const folded: CpuValue[] = [];
    try {
      for (const f of folds) folded.push(...(await f()));
    } finally {
      for (const b of tables) b.destroy();
      for (const b of kept) b.destroy();
    }
    return folded;
  };
}

export interface Reduction {
  readonly loop: ComputeEntry;
  readonly fold: ComputeEntry;
  readonly args: string;
  readonly wg: number;
  readonly vars: NonNullable<KernelLoop['reduce']>['vars'];
  readonly fields: { readonly n: string; readonly in: string; readonly out: string };
}

const OWN_FIELDS = { n: '_n', in: '_in', out: '_out' } as const;

export async function reduceOnGpu(
  d: GpuDevice,
  r: Reduction,
  n: number,
  uniform: Record<string, unknown>,
  values: Record<string, unknown>,
  onDevice: ReadonlyMap<string, GpuBuffer>,
  batch: DispatchBatch,
  images: ReadonlyMap<string, Image> = new Map(),
  keep?: {
    readonly read: boolean;
    readonly partials: (at: number, buffers: readonly GpuBuffer[]) => void;
  },
): Promise<Folded> {
  const first = grid(Math.ceil(n / r.wg));
  const levels: { wg: [number, number, number]; slots: number; count: number }[] = [];
  let count = Math.ceil(n / r.wg);
  let slots = first.slots;
  while (count > 1) {
    const next = grid(Math.ceil(count / KERNEL_TREE));
    levels.push({ ...next, count });
    slots += next.slots;
    count = Math.ceil(count / KERNEL_TREE);
  }
  const layouts = r.vars.map((v) => v.binding.layout as Layout & { readonly k: 'a' });
  const partials = layouts.map((l) => zeroedBuffer(d, slots * l.st));
  const free = (): void => partials.forEach((b) => b.destroy());
  const bound = new Map(onDevice);
  r.vars.forEach((v, i) => bound.set(v.binding.name, partials[i]!));
  const dispatch = (
    e: ComputeEntry,
    args: Record<string, unknown>,
    rest: Record<string, unknown>,
    wg: [number, number, number],
  ): Promise<void> =>
    batch.add(
      e,
      {
        values: { ...rest, [r.args]: args },
        images: new Map(images),
        samplers: new Map(),
        onDevice: bound,
      },
      wg,
    );
  let reads: Promise<DataView>[];
  try {
    await dispatch(r.loop, uniform, values, first.wg);
    let at = 0;
    let out = first.slots;
    for (const level of levels) {
      const fields = { [r.fields.n]: level.count, [r.fields.in]: at, [r.fields.out]: out };
      await dispatch(r.fold, { ...uniform, ...fields }, {}, level.wg);
      at = out;
      out += level.slots;
    }
    reads =
      keep?.read === false ? [] : layouts.map((l, i) => batch.read(partials[i]!, at * l.st, l.st));
    keep?.partials(at, partials);
  } catch (e) {
    free();
    throw e;
  }
  if (keep === undefined) void Promise.all(reads).then(free, free);
  return async () =>
    (await Promise.all(reads)).map(
      (dv, i) => readInto(dv, 0, layouts[i]!.e, undefined) as CpuValue,
    );
}

function finishOnHost(
  cpu: GeneratedCpu,
  k: KernelFace,
  args: readonly unknown[],
  values: readonly unknown[],
): void {
  const fin = k.gpu!.finish!;
  const cpuArgs = k.params.map((p, i) =>
    p.k === 'array' ? toCpu(p.layout, args[i], false) : (values[i] as CpuValue),
  );
  cpu.F['$initPrivates']?.();
  cpu.F[fin.fn]!(...cpuArgs);
  k.params.forEach((p, i) => {
    if (p.k === 'array' && fin.writes.includes(p.name))
      fromCpu(p.layout, cpuArgs[i]!, args[i], false);
  });
}

function onCpu(
  cpu: GeneratedCpu,
  k: KernelFace,
  args: readonly unknown[],
  values: readonly unknown[],
  memory: ReadonlyMap<string, CpuTexture> = new Map(),
  held: readonly (HeldLength | undefined)[] = [],
): unknown {
  const cpuArgs = k.params.map((p, i) =>
    p.k === 'array'
      ? toCpu(p.layout, args[i], false)
      : p.k === 'texture'
        ? (memory.get(p.name) as unknown as CpuValue)
        : (values[i] as CpuValue),
  );
  held.forEach((h, i) => {
    if (h !== undefined)
      startPushesAt(cpuArgs[i] as CpuValue[], (h.state.host as Uint32Array)[h.offset]!);
  });
  cpu.F['$initPrivates']?.();
  const result = cpu.F[k.fn]!(...cpuArgs);
  k.params.forEach((p, i) => {
    if (p.k === 'array' && p.writes) fromCpu(p.layout, cpuArgs[i]!, args[i], false);
    if (p.k === 'collection' && p.writes)
      collectionBack(p, cpuArgs[i] as unknown as Map<number, CpuValue> | Set<number>, args[i]);
  });
  held.forEach((h, i) => {
    if (h !== undefined)
      (h.state.host as Uint32Array)[h.offset] = pushedLength(cpuArgs[i] as CpuValue[]);
  });
  return fromShader(k.result, result);
}
