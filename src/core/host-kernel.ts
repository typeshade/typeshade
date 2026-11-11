// ═══ A kernel function called from host code (Rules 8.21, 8.22, 8.23; surface §65) ═══
//
// `await render(k, 512, img)` on a kernel function a host file imported (change 0013). The call
// is asynchronous from the start, as 0009 promised a later tier would be (Rule 8.21), and it
// writes each array the function writes back into the caller's own, in place.
//
// When the function lowers (`core/passes/kernel-lower.ts`) and there is a WebGPU device, each of
// its loops is one dispatch, in order: the call runs the loop's range function on the CPU tier
// for its start and bound, checks each array against the index range the proof established
// before anything is uploaded, dispatches one invocation per iteration and reads back what the
// loop wrote. Otherwise the whole function runs on the CPU tier (Rule 11.7), the generated code
// over the caller's arrays.
//
// A function that stores into its arrays after its loops (change 0094) has one more entry, of one
// invocation, which the call dispatches after the loops: it combines what each loop reduced and
// runs the stores, which the front end guards by each array's length. WebGL2 runs the stores on the
// CPU tier over its copies of the arrays after its draws (`finishOnHost`).
//
// A loop whose range reads an element of an array (change 0094, part 1) has a range the device
// holds: the call makes a trip buffer, dispatches the loop's range entry, then the loop's entry
// with `dispatchWorkgroupsIndirect` from the counts the range entry wrote, and reads nothing back;
// it checks no array against such a loop's writes, which the front end guards by each array's
// length. WebGL2 computes such a range on the CPU tier over its host copies (`glRange`).
//
// An array a loop pushes onto may come with its held length, `{ array, length, offset? }` (change
// 0094): the call checks it (`checkHeld`), runs the face's second WGSL text on WebGPU with the
// held length's `Resident` bound as the array's length word, which the scans advance, and on the
// CPU tier starts the array's count at the length the word holds and writes the new one into it.
// An array whose word the caller does not hold gets a zeroed one of the call's.
//
// Inside the body of `fuse()` (`typeshade/fuse`, change 0058) a call whose written arrays are all
// resident is recorded and not run (`core/fuse-scope.ts`); the scope's plan then runs each
// recorded call through `runChecked` below, with the WebGPU dispatches of all of them in one
// submission. Outside a scope a call is what it was, but for one thing: a loop that reduces and
// the dispatches that fold its partials are one submission (`reduceOnGpu`), as they are inside.
//
// Like the rest of `typeshade/runtime` it imports no compiler: the plugin writes everything the
// call needs into the generated module at build time.

import { arityError, heldArgument } from './host-arity.js';
import type { CpuValue } from './cpu-runtime.js';
import { pushedLength, startPushesAt } from './push-count.js';
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
import { KERNEL_TREE, treeIdentity, type TreeOp } from './kernel-tree.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import {
  glContext,
  onWebgl2,
  programOf as compileGl,
  type KernelGlLoop,
} from './host-kernel-gl.js';
import {
  handleOf,
  kernelQueue,
  lengthOf,
  kindName,
  residentState,
  ResidentArrayState,
} from './resident.js';
import {
  callSite,
  argumentOwner,
  commitArguments,
  isRegionResource,
  isResource,
  joinRecorded,
  recordArgument,
  type RecordedArgument,
} from './host-record.js';
import { throwFailure, usedGl } from './submission.js';
import { fromShader, toShader, type HostNumber, type HostType } from './host-values.js';
import type { Tier } from './tiers.js';
import {
  bulkOf,
  byteSize,
  DispatchBatch,
  fromCpu,
  gpuDevice,
  imageOf,
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

/** A parameter of a kernel function, as the generated module writes it. */
export type KernelParam =
  /** A value, passed by value as a helper's parameter is (Rule 8.21). */
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
      /** String members in id order (change 0081), absent for a numeric collection. */
      readonly keys?: readonly string[];
      readonly value?: HostType;
      readonly writes: boolean;
      readonly s: string;
    };

/** One loop of a kernel function the call dispatches. */
export interface KernelLoop {
  readonly entry: string;
  /** Whether the subgroup variant of the function's WGSL (change 0119) folds this
   *  loop inside a subgroup: a reduction every operator of which gives one value in every order,
   *  or a scatter whose writes a lane makes at most once. Absent when the variant runs the loop
   *  as the tree and the per-lane atomics do. */
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
    /** For a read under comparisons of the counter with a bound (#997): each comparison and the
     *  CPU-tier function that gives its bound. The read is checked over the iterations where
     *  they all hold. Absent in a face written before that change. */
    readonly guards?: readonly { readonly cop: '<' | '<=' | '>' | '>='; readonly fn: string }[];
  }[];
  /** The textures it stores into at `vec2(i % W, i / W)`, each with the CPU-tier function that
   *  gives `W` (change 0077). Absent in a face written before that change. */
  readonly texels?: readonly { readonly param: string; readonly width: string }[];
  /** The arrays the loop writes at one index `i*k + b` (the `scaled` form of R3, #775), each
   *  with the CPU-tier functions that give `k` and `b`; the call refuses `k = 0` and an index
   *  past the array's end. Absent when the loop writes none. */
  readonly strides?: readonly {
    readonly param: string;
    readonly coefficient: string;
    readonly base: string;
  }[];
  /** The arrays the loop writes at `i*W + x` over a nested `x < W` (the `row-major` form of R3,
   *  #775), each with the CPU-tier function that gives `W`; the call refuses a last row past the
   *  array's end. Absent when the loop writes none. */
  readonly rows?: readonly { readonly param: string; readonly width: string }[];
  /** The workgroup size of its entry: 256 when it reduces. */
  readonly wg: number;
  /** For a loop that pushes onto an array (change 0078): the entry that counts each
   *  iteration's pushes, the entry that scans the counts into offsets and the total, and the
   *  binding of the `n + 1` `u32`s that hold them. {@link entry} stores. */
  readonly push?: {
    readonly count: string;
    readonly scan: string;
    readonly binding: EntryBinding;
  };
  /** For a loop whose range the device holds (change 0094, part 1): the entry of one invocation
   *  that computes the range, and the element of the trip buffer it writes from: the start's bits,
   *  the trip count and the workgroup count `[x, y, 1]` of {@link entry}, which the call dispatches
   *  indirectly. {@link checks} is empty: a write past an array's end is dropped. Absent for a loop
   *  whose range the call computes on the host. */
  readonly device?: { readonly entry: string; readonly at: number };
  /** What it reduces, when it does (Rule 7.2): the entry that folds a level of partials, and
   *  per variable its operator, its scalar, its component count and its partials' binding. */
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

/** The length word of an array a loop pushes onto (change 0094): the `array<u32>` binding that
 *  holds it, the field of the call's uniform that holds the element it is at, and the loops whose
 *  scan step reads it and writes the new length into it. The call binds the held length's
 *  `Resident` there, or a zeroed word of its own when the caller holds none. */
export interface PushWord {
  readonly param: string;
  readonly field: string;
  readonly binding: EntryBinding;
  readonly loops: readonly number[];
}

/** The WGSL a call runs, with the uniform and the length words it binds: the function's own, or
 *  the second text of a call that passes a held length (change 0094). */
interface Variant {
  readonly wgsl: string;
  readonly wgslInteger?: string;
  readonly wgslSubgroup?: string;
  readonly wgslSubgroupInteger?: string;
  readonly args: EntryBinding;
  readonly words: readonly PushWord[];
  readonly guard?: { readonly group: number; readonly binding: number };
}

/** One array parameter a loop reaches, as the planner of `typeshade/fuse` reads it (change 0058). */
export interface FuseArray {
  /** The parameter, by its name in {@link KernelFace.params}. */
  readonly param: string;
  /** What the loop does to it: reads it, writes it, or writes it and reads back what it wrote. */
  readonly access: 'read' | 'write' | 'readwrite';
  /** Whether every access of it is at exactly the loop's counter. */
  readonly atI: boolean;
  /** The first access that is not, in the author's words: `t[i - 1]` and its line. Absent when
   *  `atI`. */
  readonly first?: { readonly text: string; readonly line?: number };
}

/** One array parameter whose name an iteration uses without an index (change 0058): `t.length`
 *  measures `t` and reads none of its elements. A fused entry cannot keep such an array as a
 *  local, which has no length. */
export interface FuseBare {
  /** The parameter, by its name in {@link KernelFace.params}. */
  readonly param: string;
  /** The first place the iteration names it, in the author's words: `t.length` and its line. */
  readonly first: { readonly text: string; readonly line?: number };
}

/** What the planner of `typeshade/fuse` reads about one loop of a kernel function (change 0058).
 *  The compiler writes it at build time; the planner matches it and analyzes no IR. */
export interface FuseLoop {
  /** The loop's `@compute` entry in {@link KernelFuse.ir}: {@link KernelLoop.entry}. */
  readonly entry: string;
  /** The entry that folds a level of partials, when the loop reduces. */
  readonly fold?: string;
  /** The workgroup size of its entry: 256 when it reduces, the `@workgroup_size` of its function
   *  or 64 otherwise. */
  readonly wg: number;
  /** Whether its function declares the size with `@workgroup_size` (proposal 0067, decision D5).
   *  A call that declares none has no preference, and joins a group at the group's size. Absent
   *  when it declares none. */
  readonly declared?: boolean;
  /** One per array parameter the loop reaches by an element, in the order of the parameters. An
   *  array it only measures with `.length` is not in it: see {@link FuseLoop.bare}. */
  readonly arrays: readonly FuseArray[];
  /** The array parameters its iteration names without an index, in the order of the parameters,
   *  whether or not it also reaches their elements. Absent when it names none. */
  readonly bare?: readonly FuseBare[];
  /** Whether it reduces (Rule 7.2). */
  readonly reduces: boolean;
  /** Whether it scatters into an integer array, where two iterations may land on one element. */
  readonly scatters: boolean;
  /** Whether its body has a `continue` of its own, which its entry spells as a `return`. */
  readonly continues: boolean;
  /** The function in {@link KernelFuse.ir} whose body holds the iteration: the entry, or for a
   *  loop that reduces its helper. */
  readonly iterates: string;
  /** The index in the body of {@link iterates} where the iteration starts. */
  readonly iteration: number;
}

/** The facts and lowered module of an eligible kernel, emitted by default (changes 0058 and
 * 0085). `fuse: false` omits this record. */
export interface KernelFuse {
  /** The source module. A private helper has no identity but its name, so two faces of one
   *  origin share a helper of one name, and two origins may not. */
  readonly origin: string;
  /** One per loop, in order. */
  readonly facts: readonly FuseLoop[];
  /** The lowered module cut to what its loop entries reach, as `toPortable` writes it. The
   *  loop's entry and the functions it calls are in it, and no WGSL. */
  readonly ir: PortableIr;
}

/** A kernel function a host can call, as the generated module writes it. */
export interface KernelFace {
  readonly name: string;
  /** The function's name in the generated CPU code. */
  readonly fn: string;
  readonly params: readonly KernelParam[];
  readonly result: HostType;
  /** What the WebGPU tier dispatches; absent when the function runs on the CPU. */
  readonly gpu?: {
    readonly wgsl: string;
    /** The WGSL under the `'integer'` flavor of the emulated double, present when the module
     *  emulates `f64` (change 0073): a call of an owner whose flavor is `'integer'` dispatches
     *  it, and binds no guard. */
    readonly wgslInteger?: string;
    /** The subgroup variant (change 0119): the same entries with each loop
     *  {@link KernelLoop.subgroupFold} marks folded inside a subgroup first, which needs the
     *  `subgroups` feature. Present when a loop has one; the bits it writes are the tree's. Under
     *  the `'integer'` flavor too when the module emulates `f64`. */
    readonly wgslSubgroup?: string;
    readonly wgslSubgroupInteger?: string;
    /** The uniform of the scalar parameters, `_start` and `_n`. */
    readonly args: EntryBinding;
    /** Each array parameter's storage binding. */
    readonly arrays: readonly EntryBinding[];
    /** Private compact inputs (change 0082). Logical params and the full variant stay intact. */
    readonly projected?: {
      readonly wgsl: string;
      readonly wgslInteger?: string;
      readonly wgslSubgroup?: string;
      readonly wgslSubgroupInteger?: string;
      readonly arrays: readonly EntryBinding[];
    };
    /** Each texture parameter's binding (change 0077). */
    readonly textures?: readonly HandleBinding[];
    readonly loops: readonly KernelLoop[];
    /** The CPU-tier function that gives the result from the parameters and what the GPU folded
     *  for each reduction, in loop order; absent when the function returns nothing. */
    readonly tail?: string;
    /** The stores after the loops (change 0094): the `@compute` entry of one invocation the call
     *  dispatches after the loops, the CPU-tier function that runs them over the host's arrays
     *  (WebGL2, after its draws), and the array parameters they write. Absent when the function
     *  stores nothing after its loops. */
    readonly finish?: {
      readonly entry: string;
      readonly fn: string;
      readonly writes: readonly string[];
    };
    /** The length word of each array whose pushes start at a length the device holds (change
     *  0094): one that two loops push onto, or whose length the stores after the loops read.
     *  Absent when the function has none. */
    readonly words?: readonly PushWord[];
    /** The trip buffer of a function with a loop whose range the device holds (change 0094,
     *  part 1): the binding the range entries write, and the read-only binding of the same buffer
     *  the loops' entries read. The call makes the buffer, with the usages `STORAGE` and
     *  `INDIRECT`, and frees it once the call has run. Absent when every range is the host's. */
    readonly trips?: { readonly write: EntryBinding; readonly read: EntryBinding };
    /** What a call that passes a held length runs (change 0094): the same loops and bindings,
     *  with a length word for every array a loop pushes onto, appended after the other bindings,
     *  and the uniform that holds where each word is. Absent when the function pushes onto no
     *  array, or when {@link words} has every pushed array already. */
    readonly held?: {
      readonly wgsl: string;
      readonly wgslInteger?: string;
      readonly wgslSubgroup?: string;
      readonly wgslSubgroupInteger?: string;
      readonly args: EntryBinding;
      readonly words: readonly PushWord[];
      /** Where its `_fp64` guard is, after the length words, when the module emulates `f64`. */
      readonly guard?: { readonly group: number; readonly binding: number };
    };
    /** Where the `_fp64` guard is, when the module emulates `f64`: the call binds it. */
    readonly guard?: { readonly group: number; readonly binding: number };
    /** Each Map or Set parameter a loop adds to (change 0080): the storage binding of the
     *  records the loop pushes, one for each `add` or `set` in the order of a sequential run, the
     *  loop, and the most records an iteration pushes. The call makes the binding `n` times that
     *  long and applies the records to the caller's Map or Set in order. */
    readonly collections?: readonly {
      readonly param: string;
      readonly records: EntryBinding;
      readonly loop: number;
      readonly perIteration: number;
    }[];
    /** Each Map or Set parameter the loops read and none adds to (change 0080): the binding of
     *  its keys, the count then each key's order word sorted ({@link orderWord}), and a Map's
     *  values in the same order, which the call fills from the caller's collection. */
    readonly lookups?: readonly {
      readonly param: string;
      readonly keys: EntryBinding;
      readonly values?: EntryBinding;
      /** The first loop that reads it: the call uploads it then, after the records of the
       *  loops before it are in the collection. */
      readonly loop: number;
    }[];
  };
  /** What the WebGL2 tier draws, one program per loop, when every loop writes one array of
   *  4-byte elements at `i` (Rule 11.8). */
  readonly gl?: { readonly loops: readonly KernelGlLoop[] };
  /** Why it does not run on WebGL2, when it does not. */
  readonly noWebgl2?: string;
  /** Why it runs on the CPU tier, when it does. */
  readonly noGpu?: string;
  /** The facts and loop IR of an eligible function, written by default unless `fuse: false`
   * is requested (change 0085). Full-layout metadata, independent of ordinary projection. */
  readonly fuse?: KernelFuse;
}

/** The compute entries of each loop, built once per kernel, flavor of the emulated double and
 *  WGSL text (a call that passes a held length runs the second, change 0094), since a pipeline is
 *  cached per entry object: the loop's, and the one that folds its partials when it reduces. */
const entries = new WeakMap<KernelFace, Map<string, LoopEntries[]>>();

/** The entries of one loop: its own, the fold of a reduction, the count and scan of a push, and
 *  the range entry of a loop whose range the device holds. */
interface LoopEntries {
  loop: ComputeEntry;
  range?: ComputeEntry;
  fold?: ComputeEntry;
  count?: ComputeEntry;
  scan?: ComputeEntry;
}

/** What a call runs (change 0094): the function's own WGSL, or, for a call that passes a held
 *  length, the second text when the face has one. Its key names it in the caches of entries. */
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

/** The WGSL a call dispatches: the subgroup variant where the owner selects it and the face has
 *  one (change 0119, Rule 11.23), under the owner's flavor of the emulated double (change 0073). */
function textOf(v: Variant, integer: boolean, subgroup: boolean): string {
  if (subgroup && v.wgslSubgroup !== undefined)
    return integer && v.wgslSubgroupInteger !== undefined ? v.wgslSubgroupInteger : v.wgslSubgroup;
  return integer ? v.wgslInteger! : v.wgsl;
}

/** The key a text's entries are cached under: the flavor, the variant and the held form. */
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
  // A module that emulates no `f64` has one WGSL, and the flavor changes nothing (change 0073).
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
      // The records of a Map or Set the loop adds to (change 0080), which only it binds, and the
      // keys and values of each one the loops read.
      const records = [
        ...(g.collections ?? []).filter((c) => c.loop === j).map((c) => c.records),
        // A lookup is uploaded before its first reading loop, and bound from it on.
        ...(g.lookups ?? [])
          .filter((l) => l.loop <= j)
          .flatMap((l) => (l.values !== undefined ? [l.keys, l.values] : [l.keys])),
      ];
      // The `_fp64` guard of a module that emulates `f64`, which the runtime binds under the
      // `'float'` flavor; the `'integer'` flavor declares none.
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
      // A loop whose range the device holds reads its start and trip count from the trip buffer,
      // and the statements before it may read a pushed array's length word (change 0094).
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
        // A loop that pushes counts and scans before it stores (change 0078). Its scan reads the
        // array's length word, and writes the new length into it, when the array has one (change
        // 0094).
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

/** The entry that runs the stores after the loops (change 0094), built once per kernel and flavor
 *  of the emulated double, as the loops' entries are. It binds the uniform, every array, and the
 *  partials of each loop that reduces, which it reads at the slot its uniform names. */
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
      // The length words, which a store of a pushed array's length reads (change 0094).
      ...v.words.map((w) => w.binding),
      ...guard,
    ],
    workgroupZero: {},
  };
  per.set(under, entry);
  return entry;
}

/** The slot of the uniform's `_at<j>` that says loop `j` ran no iteration: the finish entry then
 *  combines the operator's identity, as the tail does (change 0094). */
const NO_FOLD = 0xffffffff;

/** The storage buffers a device allows a stage when it reports none: WebGPU's default. */
const STORAGE_BUFFERS = 8;

/** The words of the trip buffer each loop whose range the device holds has (change 0094): the
 *  lowering's `TRIP_WORDS`. */
const TRIP_WORDS = 8;

/** The layout of a held length's array: `u32`s, 4 bytes each (change 0094). */
const WORDS = { k: 'a', n: null, st: 4, e: { k: 's', t: 'u32' } } as const;

/**
 * Call a kernel function from host code (Rule 8.21): dispatch each of its loops on WebGPU when
 * it lowers and there is a device, and otherwise run it on the CPU tier, in the order of the
 * tiers its selected owner sets (Rule 11.8); either way each array it writes is read back into the
 * caller's array in place, or left on the device in a `Resident`, and the promise resolves to
 * its result. Calls run one after another, in the order they were made.
 *
 * Inside the body of `fuse()` (change 0058) a call whose written arrays are all resident is
 * recorded, and runs with the scope's plan, at the scope's place in that order.
 *
 * @throws `TypeError` naming the function and the parameter for a value that does not fit, and
 *   for an array shorter than the index range a loop writes; `Error` when no tier it may use can
 *   run it. Inside the body of `fuse()`, a `TypeError` at the call for a resource argument
 *   (change 0138, R4).
 */
export function callKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  reads?: IncomingReads,
): Promise<unknown> {
  const scope = fuseSlot.active;
  if (scope !== undefined) {
    // A graph that takes resources is milestone 4's `fuse(fn)` (change 0138, R4).
    // It records a `Buffer` of scalars, as it recorded a `Resident` (Amendment A10, slice 1).
    const r = args.findIndex(isRegionResource);
    if (r >= 0)
      throw new TypeError(
        `${k.name}(): parameter "${k.params[r]?.name ?? r}" is a Buffer of structs or a Uniform, which the body of today's fuse() does not record; call the function outside it, or pass a Buffer of scalars made with array(xs).`,
      );
    return scope.kernel(cpu, k, argc, args, reads);
  }
  // A call on a resource does not block (change 0138, R2). A held length's length is a
  // `Buffer<u32>` (Amendment A10, confirmation item 3), so a call that takes one is one too.
  const onResource = args.some((a, i) => {
    if (isResource(a)) return true;
    const held = k.params[i]?.k === 'array' ? heldArgument(a) : undefined;
    return held !== undefined && (isResource(held.array) || isResource(held.length));
  });
  if (onResource) return recordKernel(cpu, k, argc, args, reads) as never;
  // A recorded call that failed is thrown at the next call (Amendment A5, default 7).
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
        // A held length (change 0094): its array, and the `Resident` that holds its length.
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
  // What the call writes keeps its error: each written array, and a held length's word.
  const written = k.params.flatMap((p, i) => {
    if (p.k !== 'array') return [];
    const held = heldArgument(args[i]);
    return [
      p.writes ? residentState(held?.array ?? args[i]) : undefined,
      held !== undefined ? residentState(held.length) : undefined,
    ].filter((s) => s !== undefined);
  }) as ResidentArrayState[];
  const call = kernelQueue.run(() => runKernel(cpu, k, argc, args, owner, reads));
  // A call nobody awaits keeps its error on what it writes, for `read()` to throw.
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

/**
 * A call of a kernel function whose arguments include a resource (change 0138, R2): checked now,
 * recorded with the values it sees, and run once it is submitted. A function that returns nothing
 * returns nothing. A function that returns a value returns `Buffer`s at once (Amendment A10, Q-C):
 * a `Buffer` of length 1 for a number or a vector, a `Buffer` of `N` elements for an
 * `array<T, N>`, and for a struct an object of them with the struct's own fields (Amendment A11,
 * Q6). A call that also writes a plain array waits: it returns a promise of its result as plain
 * data, and fills the plain array when it has run (A10's answer to A7's deferred question 4;
 * A11, Q7). A number or vector parameter takes a `Buffer` of one element, read when the call runs
 * (A10, Q-C: a result is another call's argument).
 *
 * @throws `TypeError` naming the function and the parameter, now: for a result no `Buffer` holds,
 *   for a storage array of another class, and for a `Buffer` a parameter does not take; the error
 *   of an earlier recorded call that failed (Amendment A5, default 7).
 */
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
  // The device of the call, at the call (R3): the one its resources belong to, or with none of
  // its own the device in use. A call that mixes devices is refused before anything is taken.
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
  // Each argument is taken with nothing changed yet; a refusal ends the check of what was taken.
  const taken: RecordedArgument[] = [];
  const mapped: unknown[] = [];
  // A number or vector parameter given a `Buffer` of one element: read when the call runs.
  const bound: { readonly i: number; readonly state: ResidentArrayState }[] = [];
  let waits = false;
  try {
    k.params.forEach((p, i) => {
      const at = `${k.name}(): parameter "${p.name}"`;
      if (p.k === 'value' && residentState(args[i]) !== undefined) {
        const state = residentState(args[i])!;
        if (state.error !== undefined) throw state.error;
        mapped[i] = placeholderOf(at, p.type, state);
        bound.push({ i, state });
        return;
      }
      const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
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
      // A held length (change 0094): its length is a `Buffer<u32>` (Amendment A10, confirmation
      // item 3), which the call reads and writes, and refuses as it refuses a failed array.
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
  // The `Buffer`s of the result, planned before anything is taken out (Amendment A10, Q-C).
  let plan: ResultPlan | undefined;
  if (k.result.k !== 'void' && !waits) {
    const planned = resultPlan(k.result);
    if (typeof planned === 'string') {
      for (const t of taken) t.buffer?.done();
      throw new TypeError(
        `${k.name}(): takes a resource, and returns ${k.result.s}, ${planned}. A call on a resource gives a Buffer for a number, a vector, an array<T, N> of them, and a struct of those (change 0138, Amendments A10 Q-C and A11 Q6); pass plain data and await the call.`,
      );
    }
    plan = planned;
  }
  // Every argument is checked at the call, as a call with plain data checks it when it runs; only
  // then are the values the call sees copied out (the review of #1236, B2 and S2).
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
  const results = plan === undefined ? undefined : makeResults(plan, owner);
  if (results !== undefined) written.push(...results.states);
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

/** A placeholder of a number or vector parameter given a `Buffer` of one element, which the check
 *  at the call reads; the call reads the element when it runs ({@link boundValue}).
 *  @throws `TypeError` for a parameter of another type, and for a `Buffer` of another element or
 *    of more than one element. */
function placeholderOf(at: string, t: HostType, state: ResidentArrayState): unknown {
  const scalars = lengthOf(state) * state.components;
  const kind = kindName(state);
  if (t.k === 'num' && kind === t.t && scalars === 1) return 0;
  if (t.k === 'vec' && kind === t.e && scalars === t.n) return new Array<number>(t.n).fill(0);
  if (t.k !== 'num' && t.k !== 'vec')
    throw new TypeError(
      `${at} (${t.s}) takes no Buffer: a Buffer is a parameter's value only for a number or a vector (change 0138, Amendment A10, Q-C).`,
    );
  throw new TypeError(
    `${at} (${t.s}) takes a Buffer of one ${t.s}; got a Buffer of ${scalars} ${kind} numbers.`,
  );
}

/** The value a parameter bound from `state` takes when the call runs: the one element the
 *  `Buffer` holds after the calls made before (change 0138, Amendment A10, Q-C). */
async function boundValue(k: KernelFace, i: number, state: ResidentArrayState): Promise<unknown> {
  if (state.destroyed)
    throw new TypeError(
      `${k.name}(): parameter "${k.params[i]!.name}": this Buffer was disposed; make a new one with array().`,
    );
  if (state.error !== undefined) throw state.error;
  await state.fenced();
  await state.sync(true);
  const values = (state.next ?? state.host) as ArrayLike<number>;
  const p = k.params[i]!;
  return p.k === 'value' && p.type.k === 'vec' ? Array.from(values) : values[0];
}

/** How the `Buffer`s of a result are made: one handle of `n` elements of `c` scalars of `kind` for
 *  a number, a vector or an array of them, and an object of them for a struct (Amendment A11,
 *  Q6). */
type ResultPlan =
  | { readonly k: 'leaf'; readonly kind: HostNumber; readonly n: number; readonly c: number }
  | { readonly k: 'struct'; readonly f: readonly (readonly [string, ResultPlan])[] };

/** The plan of a result of type `t`, or why no `Buffer` holds it. A sized array of structs, a
 *  `bool`, a key, a matrix and a `Record` are not decided (Amendment A11, open items). */
function resultPlan(t: HostType): ResultPlan | string {
  switch (t.k) {
    case 'num':
      return { k: 'leaf', kind: t.t, n: 1, c: 1 };
    case 'vec':
      return t.e === 'bool' ? 'which no Buffer holds yet' : { k: 'leaf', kind: t.e, n: 1, c: t.n };
    case 'arr':
      if (t.e.k === 'num') return { k: 'leaf', kind: t.e.t, n: t.n, c: 1 };
      if (t.e.k === 'vec' && t.e.e !== 'bool') return { k: 'leaf', kind: t.e.e, n: t.n, c: t.e.n };
      return 'which no Buffer holds yet';
    case 'struct': {
      const f: (readonly [string, ResultPlan])[] = [];
      for (const [name, ft] of t.f) {
        const sub = resultPlan(ft);
        if (typeof sub === 'string') return `whose field "${name}" (${ft.s}) no Buffer holds yet`;
        f.push([name, sub]);
      }
      return { k: 'struct', f };
    }
    default:
      return 'which no Buffer holds yet';
  }
}

/** The typed array of each scalar a result `Buffer` holds (Rule 8.21; Amendment A11, Q2). */
const RESULT_ARRAYS = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  f64: Float64Array,
} as const;

/** The `Buffer`s of a result, made at the call on `owner` (R3): `value` is what the call returns,
 *  `states` the handles it writes, and `fill` writes the result into them when the call has run. */
function makeResults(
  plan: ResultPlan,
  owner: CallOwner,
): {
  readonly value: unknown;
  readonly states: readonly ResidentArrayState[];
  fill(result: unknown): void;
} {
  const states: ResidentArrayState[] = [];
  const make = (p: ResultPlan): { readonly value: unknown; fill(v: unknown): void } => {
    if (p.k === 'struct') {
      // One output for each field, with the struct's own names (R1; Amendment A11, Q6).
      const parts = p.f.map(([name, sub]) => [name, make(sub)] as const);
      return {
        value: Object.fromEntries(parts.map(([name, m]) => [name, m.value])),
        fill: (v) => {
          for (const [name, m] of parts) m.fill((v as Record<string, unknown>)[name]);
        },
      };
    }
    const C = RESULT_ARRAYS[p.kind];
    const state = new ResidentArrayState(new C(p.n * p.c));
    state.components = p.c;
    if (owner !== defaultOwner) state.ownedBy = owner;
    states.push(state);
    return {
      value: owner.result?.(state) ?? handleOf(state),
      fill: (v) => state.assign(new C((Array.isArray(v) ? v.flat() : [v]) as number[])),
    };
  };
  const root = make(plan);
  return { value: root.value, states, fill: root.fill };
}

/** Incoming contents in parameter order. A held length is data even for a write-only array. */
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

/** The refusal of a call that passes the wrong number of arguments, or undefined. */
export { arityError } from './host-arity.js';

/** A held length, checked (change 0094): the `Resident<Uint32Array>` whose element `offset` is
 *  the length of the array the call pushes onto, and the new length after the call. */
export interface HeldLength {
  readonly state: ResidentArrayState;
  readonly offset: number;
}

/** A loop's start and trip count, as the call computed them before anything ran; or, with
 *  `device`, a range the device holds, which the call does not know (change 0094). */
export interface KernelRange {
  readonly start: number;
  readonly n: number;
  readonly device?: true;
}

/** A call's arguments, checked: what `runChecked` runs. */
export interface CheckedCall {
  /** The owner captured by an ordinary call; a recorded call uses its scope's owner. */
  readonly owner?: CallOwner;
  /** A call on a resource, recorded and submitted later (change 0138, R2): on WebGL2 its
   *  submission flushes and a `read()` of what it wrote waits on a fence (Amendment A5, default 6).
   *  A call with plain data keeps today's meaning, and marks nothing. */
  readonly recorded?: boolean;
  readonly states: readonly (ResidentArrayState | undefined)[];
  readonly hosts: readonly unknown[];
  readonly values: readonly unknown[];
  /** Each loop's start and trip count; absent when the function runs on the CPU. A loop whose
   *  range the device holds (change 0094) has `device` set, and no start or trip count the host
   *  knows: its `start` and `n` are 0. */
  readonly ranges: readonly KernelRange[] | undefined;
  /** For each parameter, the held length it was passed with, `{ array, length, offset? }`
   *  (change 0094); undefined for a parameter passed without one. */
  readonly held: readonly (HeldLength | undefined)[];
}

/**
 * Check a call before anything runs or is uploaded: the number of arguments, one resident array
 * passed twice, every value against its type, and each array against the indices a loop writes.
 *
 * @throws `TypeError` naming the function and the parameter.
 */
export function checkCall(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
): CheckedCall {
  const bad = arityError(k, argc);
  if (bad !== undefined) throw bad;
  // A held length (change 0094): the parameter takes its `array`, and the length is checked apart.
  const held = k.params.map((p, i) => (p.k === 'array' ? checkHeld(k, p, args[i]) : undefined));
  const plain = args.map((a, i) => held[i]?.array ?? a);
  // A `Resident` stands for the array it holds.
  const states = plain.map((a) => residentState(a));
  states.forEach((s, i) => {
    if (s !== undefined && states.indexOf(s) !== i)
      throw new TypeError(
        `${k.name}(): parameter "${k.params[i]!.name}" is the same Buffer as parameter "${k.params[states.indexOf(s)]!.name}".`,
      );
  });
  // A held length is a `Resident` of its own: no array of the call, and no other held length.
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
  // A scratch array of a fuse scope holds no host array yet, so `hosts` has the handle there, and
  // `checkArray` asks the array's own state instead of reading it.
  const hosts = plain.map((a, i) => states[i]?.host ?? a);
  // Every value is checked before anything runs or is uploaded.
  const values = k.params.map((p, i) =>
    p.k === 'value'
      ? toShader(k.name, p.name, p.type, hosts[i])
      : p.k === 'texture'
        ? checkTexture(k, p, hosts[i])
        : p.k === 'collection'
          ? checkCollection(k, p, hosts[i])
          : checkArray(k, p, hosts[i], states[i]),
  );
  // Each loop's range, and each array against the indices it writes, before anything runs: the
  // loops write no scalar the ranges read (Rule 8.22), so every range that reads no element is
  // known up front. A range that reads one is the device's (change 0094).
  const ranges = k.gpu !== undefined ? rangesOf(cpu, k, values) : undefined;
  return {
    states,
    hosts,
    values,
    ranges,
    held: held.map((h) => (h === undefined ? undefined : { state: h.state, offset: h.offset })),
  };
}

/**
 * Check a held length for array parameter `p` (change 0094): `{ array, length, offset? }`, the
 * array and the element `offset` of the `Resident<Uint32Array>` `length` that holds its length.
 * Undefined for an argument of another shape, which the array's own check reads.
 *
 * @throws `TypeError` naming the function and the parameter, before anything runs: on a parameter
 *   no loop pushes onto (decision D5), and for a length that is no live `Resident<Uint32Array>`
 *   of the host's, or an offset that is no whole number from 0 or is past it.
 */
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
  // A scratch array of a fuse scope lives only until its plan has run (change 0058).
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

/** What a fuse scope's plan hands each call it runs (change 0058): where the WebGPU dispatches
 *  of its calls go, what it counts, and the tiers its calls ran on. `runChecked` with none is
 *  the call as it always was. */
export interface PlanRun {
  /** Whose device the plan runs on, and whose tiers its calls try (change 0071). */
  readonly owner: CallOwner;
  readonly counts: GpuCounts;
  readonly tiers: Set<Tier>;
  /** The group of the plan the call that is running belongs to (change 0066). */
  group: number | undefined;
  /** The GPU time of each group, in nanoseconds, as the batch's flushes measured it; `null`
   *  once a flush could not measure it. A group with no entry has no time. */
  readonly gpuTimes: Map<number, number | null>;
  /** The batch the plan's WebGPU dispatches join: they reach the queue in one submission, and
   *  the dispatches of a reduction's levels are among them. */
  batchOn(d: GpuDevice): DispatchBatch;
  /** Submit what the batch holds, before a step that must see what it wrote. */
  flush(): Promise<void>;
}

/** What a call of a plan gives in place of its result (change 0058): the result waits for what
 *  its reductions folded to, which the device holds until the plan has submitted. Call it once
 *  the plan has flushed its last dispatch. */
export type Finish = () => Promise<unknown>;

/** What the loops of a call that reduces folded to, one value for each variable in loop order,
 *  once the dispatches that fold them have been submitted. */
export type Folded = () => Promise<CpuValue[]>;

/** The host copies of the arguments once `syncAll` has run: a scratch array of a fuse scope has
 *  its elements by then, and had none when the call was checked. */
const heldBy = (
  states: readonly (ResidentArrayState | undefined)[],
  hosts: readonly unknown[],
): unknown[] => hosts.map((h, i) => states[i]?.host ?? h);

/** Bring each resident array's host copy up to date; a read of the device is a submission. */
async function syncAll(
  states: readonly (ResidentArrayState | undefined)[],
  run: PlanRun | undefined,
): Promise<void> {
  for (const s of states)
    if ((await s?.sync()) === true && run !== undefined) run.counts.submissions++;
}

/** What one tier of the call layer makes of a checked call (Rule 11.8): the reason it cannot run
 *  the call, or what it runs the call with. */
export type TierFit =
  | { readonly why: string }
  | { readonly why?: undefined; readonly tier: 'webgpu'; readonly d: GpuDevice }
  | { readonly why?: undefined; readonly tier: 'webgl2'; readonly gl: WebGL2RenderingContext }
  | { readonly why?: undefined; readonly tier: 'cpu' };

/**
 * Whether `tier` can run the checked call `c` of `k` for `owner` (Rule 11.8). It gives the WebGPU
 * device, the WebGL2 context with every program of the call compiled, or the CPU tier. Otherwise
 * it gives the reason in the words that the `Error` of a call no tier can run gives the tier,
 * after `webgpu: `, `webgl2: ` or `cpu: `.
 *
 * This is the one place that words the reason of each tier. `runChecked` runs a call on the first
 * tier that can run it. The planner of a `fuse` scope settles the same tier before anything runs,
 * and a group that runs on a later tier than its plan's says the reasons of the tiers before its
 * own (Rule 11.13, change 0118).
 */
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
    // A texture of the CPU tier's memory binds on no GPU tier (change 0077).
    const cpuOnly = k.params.find((p, i) => p.k === 'texture' && isCpuTexture(hosts[i]));
    if (cpuOnly !== undefined)
      return { why: `parameter "${cpuOnly.name}" is a texture of the CPU tier's memory` };
    // The array a held length is passed for that the WGSL a call runs gives no length word: the
    // pushes would start at 0 there, so such a call runs on the CPU tier (change 0094).
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
    // The entry that stores after the loops binds every array, the partials of each loop that
    // reduces and the length words (change 0094): on a device that allows fewer storage buffers
    // to a stage, the call runs on the next tier.
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
    // The range entry and the entry of a loop whose range the device holds bind the trip buffer
    // and the length words besides the arrays (change 0094).
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
    // Every program first, so that one WebGL2 refuses leaves no array half written. A program is
    // compiled once for each loop, so a plan that settled the tier compiles nothing again.
    try {
      for (const loop of k.gl.loops) compileGl(gl, loop);
    } catch (e) {
      return { why: e instanceof Error ? e.message : String(e) };
    }
    return { tier, gl };
  }
  // The CPU tier reads a texture of its own memory, and an ImageData, which it copies (change 0077).
  const unread = k.params.find((p, i) => p.k === 'texture' && !cpuReads(hosts[i]));
  if (unread !== undefined)
    return {
      why: `parameter "${unread.name}" is a texture the CPU tier cannot read; it reads an ImageData and a texture a device on the CPU tier made`,
    };
  return { tier: 'cpu' };
}

/**
 * Run a checked call on the first tier it may use, and resolve to its result.
 *
 * With a `run`, the call is part of a fuse scope's plan, and it resolves to a {@link Finish}
 * instead. On WebGPU its dispatches join the plan's batch instead of reaching the queue apart,
 * those of a reduction's levels among them, and a step that reads what the device holds submits
 * the batch first. What a reduction folded to is read in the submission that holds its levels,
 * so the call has no result before the plan has submitted it, and its `Finish` gives the result
 * after that.
 */
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
  // Outside a scope the call is over when it resolves. In a plan, only the result is left.
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
      // The `Resident` of each held length (change 0094).
      ...held.flatMap((h, i): [string, CallOwner | undefined][] =>
        h === undefined ? [] : [[`"${k.params[i]!.name}.length"`, ownerOf(h.state)]],
      ),
    ],
    run?.owner ?? c.owner,
  );
  // A held length's word, which the CPU tier reads and writes on the host (change 0094).
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
      // The subgroup variant, where the owner's device passed the probe and the face has one
      // (change 0119); the owner's statistics name the text the call ran.
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
        // Arrays already carry their checked element count here, including flat vectors and
        // typed subarrays. A length uniform names that parameter, never its backing capacity.
        uniforms.set(p.name, values[i]);
      });
      // A range the device holds is computed here, on the CPU tier over the host copies, once the
      // draws before it have written them (change 0094, Rule 11.8).
      let drawn = 0;
      k.gl!.loops.forEach((loop, j) => {
        const face = k.gpu!.loops[j]!;
        const r = ranges![j]!.device === true ? glRange(cpu, k, j, live, values) : ranges![j]!;
        if (r.n > 0) drawn++;
        onWebgl2(gl, loop, arrays, uniforms, r.start, face.step, r.n);
      });
      // The stores after the loops run on the CPU tier over the host copies the draws wrote
      // (change 0094, Rule 11.8).
      if (k.gpu!.finish !== undefined) finishOnHost(cpu, k, live, values);
      if (run !== undefined) recordDispatches(run.counts, run.group, drawn);
      // The submission flushes the context, and a read() of what the call wrote waits on a fence
      // (change 0138, Amendment A5, default 6).
      // Only a recorded call: a plan of a scope keeps its own submission (Rule 11.13), and a call
      // with plain data read its values back inside the call (S3 of the review of #1238).
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
    // Each texture as the CPU tier's memory: its own, or an ImageData's copy (change 0077).
    // `tierFit` has checked that the CPU tier reads each one.
    const memory = new Map<string, CpuTexture>();
    k.params.forEach((p, i) => {
      if (p.k === 'texture') memory.set(p.name, cpuTextureOf(hosts[i])!);
    });
    await run?.flush();
    // The words of the held lengths too: the CPU tier reads the length and writes the new one.
    await syncAll([...states, ...words], run);
    run?.tiers.add(tier);
    const out = onCpu(cpu, k, heldBy(states, hosts), values, memory, held);
    return result(async () => out);
  }
  throw new Error(`${k.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

const projectedFaces = new WeakMap<KernelFace, KernelFace>();

/** Cache the private face. The logical pack still reads all fields in its original order. */
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

/** The result of a call whose loops have run: the function's tail over the array lengths and the
 *  scalars, and over what each reduction folded, in loop order. Undefined for a function that
 *  returns nothing. A fuse plan's fused group computes the result of each of its calls here
 *  too (change 0058). */
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

/** Check a texture argument (change 0077): an image source for a `texture_2d<f32>`, and a
 *  device's storage texture of the parameter's format for a storage texture. Its image. */
function checkTexture(k: KernelFace, p: KernelParam & { k: 'texture' }, v: unknown): Image {
  const at = `${k.name}(): parameter "${p.name}" (${p.s})`;
  // A texture of the CPU tier's memory, which a device on that tier made (change 0077).
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
  // STORAGE_BINDING, 0x08: a texture made without it cannot be bound for a store.
  const usage = t.texture?.usage;
  if (typeof usage === 'number' && (usage & 0x08) === 0)
    throw new TypeError(`${at}: the texture was made without storage: true.`);
  return img;
}

/** A texture argument as the CPU tier's memory: a `CpuTexture` as it is, an `ImageData` copied;
 *  undefined for one the CPU tier cannot read (a WebGPU texture, a canvas, a bitmap). */
function cpuTextureOf(v: unknown): CpuTexture | undefined {
  if (isCpuTexture(v)) return v;
  return cpuReads(v) ? CpuTexture.fromImageData(v as ImageData) : undefined;
}

/** Whether the CPU tier reads a texture argument: a `CpuTexture`, or an `ImageData`, which
 *  `cpuTextureOf` copies. Nothing is copied here. */
function cpuReads(v: unknown): boolean {
  if (isCpuTexture(v)) return true;
  const g = globalThis as { ImageData?: abstract new (...a: never[]) => unknown };
  return g.ImageData !== undefined && v instanceof g.ImageData;
}

/** Whether `k` is a key of the type `key`: an integer in its range, or a number an f32 holds
 *  (`NaN` among them). */
function fitsKey(key: 'u32' | 'i32' | 'f32', k: unknown): boolean {
  if (typeof k !== 'number') return false;
  if (key === 'f32') return Number.isNaN(k) || Math.fround(k) === k;
  if (!Number.isInteger(k)) return false;
  return key === 'u32' ? k >= 0 && k <= 0xffffffff : k >= -0x80000000 && k <= 0x7fffffff;
}

/** Check a Map or Set argument (change 0080): a `Map` or a `Set` as the parameter says, each key
 *  of its key type and each value of its value type. A copy in the CPU tier's values, in the
 *  host's order, which the call runs on and writes back from. */
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

/** A value as a refusal names it. */
function describe(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') return `a ${typeof v}`;
  return `a ${(v as object).constructor?.name ?? 'object'}`;
}

/** Write what the CPU tier left in a Map or Set (change 0080) into the host's: a key it already
 *  holds keeps its place and takes the value set last, and a new key goes after, in the order
 *  the function added them. */
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

/**
 * Apply the records a loop pushed for Map or Set `c` (change 0080) to the caller's collection and
 * to the call's copy of it, which the tail reads: the first `count` records of `dv`, in order,
 * each an `add` or a `set` as ECMAScript makes it. A key the collection holds keeps its place, a
 * Map's value is the one set last, and keys compare by SameValueZero.
 */
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

/** The order word of a key (change 0080): one `u32` for each key, equal for two keys exactly when
 *  SameValueZero calls them equal, as the lowering's search computes it. */
const orderView = new DataView(new ArrayBuffer(4));
export function orderWord(key: 'u32' | 'i32' | 'f32', k: number): number {
  if (key === 'u32') return k >>> 0;
  if (key === 'i32') return k >>> 0;
  if (Number.isNaN(k)) return 0x7fc00000;
  if (k === 0) return 0;
  orderView.setFloat32(0, k, true);
  return orderView.getUint32(0, true);
}

/** What a loop that reads a Map or Set searches (change 0080): the count, then each key's order
 *  word, sorted, and a Map's values in the same order. An empty Map's values hold one value
 *  nobody reads, since a binding is not empty. */
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
  // Each value packed at its stride; an empty Map's binding holds one value nobody reads.
  const bytes = new ArrayBuffer(Math.max(1, rows.length) * values.st);
  const dv = new DataView(bytes);
  rows.forEach((r, i) =>
    pack(dv, i * values.st, values.e, toShader(k.name, p.name, p.value!, r.value), ''),
  );
  return { keys: keys.buffer, values: bytes };
}

/** An empty value `readInto` fills for layout `l`: an object for a struct, a list of the right
 *  length for an array with a size, and nothing for the rest, which it makes itself. */
function blank(l: Layout): unknown {
  if (l.k === 'o') return Object.fromEntries(l.f.map(([name, , fl]) => [name, blank(fl)]));
  if (l.k === 'a' && l.n !== null) return Array.from({ length: l.n }, () => blank(l.e));
  return undefined;
}

/** Check an array argument against its layout; its element count. A handle that holds no
 *  elements yet, a scratch array of a fuse scope, is checked by its own state (`s`). */
function checkArray(
  k: KernelFace,
  p: KernelParam & { k: 'array' },
  v: unknown,
  s: ResidentArrayState | undefined,
): number {
  if (s?.measure !== undefined) return s.measure(k.name, p);
  try {
    const size = byteSize(p.layout, v, '');
    // A flat typed array is checked by `byteSize` alone: its bulk copy cannot fail, so no dry pack.
    if (bulkOf(p.layout, v) === undefined)
      pack(new DataView(new ArrayBuffer(Math.max(4, size))), 0, p.layout, v, '');
    return runtimeCount(p.layout, v, '');
  } catch (err) {
    if (!(err instanceof Misfit)) throw err;
    const at = err.path === '' ? '' : `at ${err.path}, `;
    throw new TypeError(`${k.name}(): parameter "${p.name}" (${p.s}): ${at}${err.problem}.`);
  }
}

// ─── WebGPU ──────────────────────────────────────────────────────────────────────────────────

/** Iterations from `start` toward `bound` by `step`, as the loop's comparison counts them. */
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

/** Each loop's start and trip count, having checked every array the loop writes at `a*i + c`
 *  against its length. */
function rangesOf(cpu: GeneratedCpu, k: KernelFace, values: readonly unknown[]): KernelRange[] {
  const g = k.gpu!;
  // The range functions read an array only by its length.
  const lengths = lengthsOf(k, values);
  const init = cpu.F['$initPrivates'];
  return g.loops.map((loop, j) => {
    // A range the device holds is computed by its range entry, or on WebGL2 from the host copies
    // once the loops before it have run (change 0094).
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
      // A read under comparisons of the counter with a bound happens in the iterations where they
      // hold (#997): the counters from `from` to `to`. The interval holds every such iteration.
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
    // Each array it writes at `i*k + b` or at `i*W + x` holds every index it writes (#775).
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
    // Each texture it stores into holds the texels (i % W, i / W) of every iteration.
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

/**
 * The range of loop `j`, which the device holds, for WebGL2 (change 0094): its range function on
 * the CPU tier over the host copies of the arrays, the elements it names read, and the iterations
 * whose `i` lies inside the one array the loop writes at `i`. The others would write past the
 * array's end, which every tier drops (decision D2), and WebGL2 does not draw them.
 */
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
  // The iterations `t` from `lo` to `hi` are the ones whose `start + t * step` is in the array.
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

/** The storage buffers the most-binding entry of a loop whose range the device holds binds, its
 *  range entry or its own, and the loop; undefined when no range is the device's (change 0094). */
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

/** The parameters as the range functions and the tail take them: each array by its length. */
function lengthsOf(k: KernelFace, values: readonly unknown[]): CpuValue[] {
  // A texture is no value the CPU tier reads: the functions it runs there name none (change 0077).
  return k.params.map((p, i) =>
    p.k === 'array'
      ? ({ length: values[i] as number } as unknown as CpuValue)
      : p.k === 'texture'
        ? (0 as CpuValue)
        : (values[i] as CpuValue),
  );
}

/** The workgroups of a dispatch of `groups`, past 65535 spilling into y, and how many that is. */
export function grid(groups: number): { wg: [number, number, number]; slots: number } {
  const x = Math.max(1, Math.min(groups, 65535));
  const y = Math.ceil(groups / x);
  return { wg: [x, y, 1], slots: x * y };
}

/**
 * Dispatch each loop in order, and give back what the loops that reduce folded to. Outside a
 * scope each loop reaches the queue in a submission of its own, as it always did, and a loop
 * that reduces is one submission with the dispatches that fold its partials (`reduceOnGpu`). In
 * a plan (`run`), the dispatches of every loop join the plan's batch, and the folded values are
 * there to read once the plan has submitted it.
 */
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
  // A call that passes a held length runs the WGSL in which every array a loop pushes onto has a
  // length word (change 0094).
  const holds = held.some((h) => h !== undefined);
  const variant = variantOf(k, holds);
  const es = entriesOf(k, flavor, holds, subgroup);
  const batch = run?.batchOn(d) ?? new DispatchBatch(d);
  const folds: Folded[] = [];
  // Each texture, as `checkCall` found it (change 0077).
  const images = new Map<string, Image>();
  k.params.forEach((p, i) => {
    if (p.k === 'texture') images.set(p.name, imageOf(args[i]) as Image);
  });
  // A `Resident` is bound as the buffer it already has on the device.
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
  // The keys and values of each Map or Set the loops read (change 0080), uploaded before the first
  // loop that reads it, once the records of the loops before it are in the collection, and freed
  // once what the call folded has been read.
  const tables: GpuBuffer[] = [];
  // The records of a loop, applied to the collections once read back; at most once.
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
  // The stores after the loops (change 0094): where the finish entry reads what each loop that
  // reduces folded, and the partials it binds, which the call frees once it has run. `ats` also
  // holds where each length word is, which every entry's uniform carries.
  const fin = g.finish;
  const ats: Record<string, number> = {};
  const partsOf = new Map<number, readonly GpuBuffer[]>();
  const kept: GpuBuffer[] = [];
  if (fin !== undefined)
    g.loops.forEach((l, j) => {
      if (l.reduce !== undefined) ats[`_at${String(j)}`] = NO_FOLD;
    });
  // The length words (change 0094): the `Resident` of a held length, bound as the buffer it has
  // on the device and left there with the new length, or a zeroed word the call makes for an
  // array whose pushes start at 0, which it frees once it has run. The uniform says where each is.
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
  // The trip buffer (change 0094, part 1): the range entry of each loop whose range the device
  // holds writes its start, its trip count and its entry's workgroup count there, and the loop is
  // dispatched indirectly from it, with nothing read back. It is freed once the call has run.
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
      // A loop whose range the device holds maps (stage 3 of change 0094): its range entry, then
      // its entry from the counts the range entry wrote, a trip count of 0 dispatching nothing.
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
    // A loop that pushes onto an array with a length word runs its scan even with no iteration
    // (change 0094): slot 0 then holds the length after the loop, which the result reads.
    const word = variant.words.some((w) => w.loops.includes(j));
    if (n === 0 && !word) {
      // No iteration: the variable is combined with the identity, which leaves it, and a loop
      // that pushes pushed nothing.
      const identities = vars.map((v) => identityValue(v.op, v.scalar, v.n));
      if (loop.push !== undefined) identities.push(0 as CpuValue);
      folds.push(async () => identities);
      // The finish entry binds a slot it does not read: `_at<j>` says the loop ran nothing.
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
      // Count, scan, store (change 0078): `n` counts become their offsets in place, and the
      // total is written after them, read back in the submission that holds the three.
      const slots = zeroedBuffer(d, (n + 1) * 4);
      const bound = new Map(onDevice);
      bound.set(loop.push.binding.name, slots);
      // The records of a Map or Set the loop adds to (change 0080): `n` times the most an
      // iteration pushes, so every record fits.
      const collected = (g.collections ?? []).filter((c) => c.loop === j);
      const recordBuffers = collected.map((c) => {
        const st = (c.records.layout as Layout & { k: 'a' }).st;
        const buffer = zeroedBuffer(d, Math.max(4, n * c.perIteration * st));
        bound.set(c.records.name, buffer);
        return { c, st, buffer };
      });
      const first = grid(Math.ceil(n / loop.wg));
      const checked = { values: bound_, images, samplers: new Map(), onDevice: bound };
      try {
        if (n > 0) await batch.add(es[j]!.count!, checked, first.wg);
        await batch.add(es[j]!.scan!, checked, [1, 1, 1]);
        if (n > 0) await batch.add(es[j]!.loop, checked, first.wg);
      } catch (e) {
        slots.destroy();
        throw e;
      }
      // The total, read back for the result. With a length word and no result, it stays on the
      // device, where the word holds the new length, and nothing is read back (change 0094).
      const total = g.tail !== undefined || !word ? batch.read(slots, n * 4, 4) : undefined;
      if (total === undefined) kept.push(slots);
      else {
        const free = (): void => slots.destroy();
        void total.then(free, free);
      }
      const records = recordBuffers.map((r) => {
        const read = batch.read(r.buffer, 0, Math.max(4, n * r.c.perIteration * r.st));
        const drop = (): void => r.buffer.destroy();
        void read.then(drop, drop);
        return { ...r, read };
      });
      let applied: Promise<void> | undefined;
      const apply = (): Promise<void> =>
        (applied ??= (async () => {
          const count = (await total!).getUint32(0, true);
          for (const r of records) applyRecords(k, r.c, count, await r.read, args, values);
        })());
      if (records.length > 0) pending.push(apply);
      folds.push(async () => {
        if (total === undefined) return [0 as CpuValue];
        await apply();
        return [(await total).getUint32(0, true) as CpuValue];
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
      // With stores after the loops, the partials stay for the finish entry, and a function
      // that returns nothing reads nothing back (change 0094).
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
    // Outside a scope, the next loop sees what this one wrote.
    if (run === undefined) await batch.flush();
  }
  if (fin !== undefined) {
    // The stores, one invocation after the loops, in the same submission in a plan (change 0094).
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
      // From the WGSL text the loops ran: the second, for a call that passes a held length.
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
      // The finish entry has run: its submission is the plan's, or the flush above.
      for (const b of kept) b.destroy();
    }
    return folded;
  };
}

/** A loop that reduces, as `reduceOnGpu` runs it. */
export interface Reduction {
  /** The loop's entry, and the entry that folds a level of partials. */
  readonly loop: ComputeEntry;
  readonly fold: ComputeEntry;
  /** The name of the uniform's binding, which both entries bind. */
  readonly args: string;
  /** The workgroup size of the loop's entry: {@link KERNEL_TREE}. */
  readonly wg: number;
  /** What it reduces, as its face describes it. */
  readonly vars: NonNullable<KernelLoop['reduce']>['vars'];
  /** The fields of the uniform that say how many partials a level folds, where they start and
   *  where the level writes its own. */
  readonly fields: { readonly n: string; readonly in: string; readonly out: string };
}

/** The uniform fields of a kernel function's own entries. */
const OWN_FIELDS = { n: '_n', in: '_in', out: '_out' } as const;

/**
 * Add a loop that reduces over `n` iterations to `batch`, and one dispatch for each level that
 * folds its partials in the tree order (Rule 7.2). Resolves, once they are in the batch, to a
 * function that gives what each variable folded to after the batch has been flushed. `uniform`
 * is the loop's uniform, and `values` holds the rest of its bindings.
 *
 * The partials of every level are one device buffer for each variable, in regions one after
 * another, that the loop and every level bind. No level reads them back before the next, so all
 * the dispatches reach the queue in the one submission of the batch. That submission also copies
 * the folded slot of each variable (`DispatchBatch.read`). Each dispatch has a uniform of its
 * own: a copy of `uniform` with the fields that say how many partials the level folds, where they
 * start and where it writes its own, since a batch reads its values when it is flushed. The
 * buffers are freed once the folded slots have been read, or when the batch drops the read. A
 * fused group that ends in a loop that reduces runs through this too (change 0058), so it folds
 * by the levels that a call outside a scope folds by.
 *
 * With `keep` (change 0094), the caller takes the partials and frees them: `keep.partials` gets
 * them, and the slot the folded value is at, for the entry that stores after the loops, and with
 * `keep.read` false nothing is read back and the result folds nothing.
 */
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
  // The partials of every level, one region after another.
  const levels: { wg: [number, number, number]; slots: number; count: number }[] = [];
  let count = Math.ceil(n / r.wg);
  let slots = first.slots;
  while (count > 1) {
    const next = grid(Math.ceil(count / KERNEL_TREE));
    levels.push({ ...next, count });
    slots += next.slots;
    count = Math.ceil(count / KERNEL_TREE);
  }
  // A new buffer holds zeros, as the partials of a loop always started.
  const layouts = r.vars.map((v) => v.binding.layout as Layout & { readonly k: 'a' });
  const partials = layouts.map((l) => zeroedBuffer(d, slots * l.st));
  const free = (): void => partials.forEach((b) => b.destroy());
  const bound = new Map(onDevice);
  r.vars.forEach((v, i) => bound.set(v.binding.name, partials[i]!));
  // One uniform for each level, each written at an offset of its own in the device's uniform
  // buffer and bound at a dynamic offset (`uniformsOf` in `core/host-entry.ts`). A reduction has
  // three levels at most, for 2^32 iterations.
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
    // `at` is where the last dispatch wrote its first partial: the loop's slot 0 when no level
    // follows, and the first slot of the last level otherwise. That partial is the folded value.
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

function identityValue(op: TreeOp, scalar: string, n: number): CpuValue {
  const one = treeIdentity(op, scalar) as number;
  return (n === 1 ? one : new Array<number>(n).fill(one)) as CpuValue;
}

// ─── the CPU tier ────────────────────────────────────────────────────────────────────────────

/** The stores after the loops over the host's arrays (change 0094): what WebGL2 runs after its
 *  draws, through the CPU-tier function of the stores, each array it writes copied back in place.
 *  WebGL2 runs no loop that reduces, so the function folds nothing. */
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
  // A held length (change 0094): the pushes start at the length its word holds, which the call
  // has brought up to date on the host.
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
  // The new length, the held one plus what the loops appended, stays in the word.
  held.forEach((h, i) => {
    if (h !== undefined)
      (h.state.host as Uint32Array)[h.offset] = pushedLength(cpuArgs[i] as CpuValue[]);
  });
  return fromShader(k.result, result);
}
