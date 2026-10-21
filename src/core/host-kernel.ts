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
// Inside the body of `fuse()` (`typeshade/fuse`, change 0058) a call whose written arrays are all
// resident is recorded and not run (`core/fuse-scope.ts`); the scope's plan then runs each
// recorded call through `runChecked` below, with the WebGPU dispatches of all of them in one
// submission. Outside a scope a call is what it was, but for one thing: a loop that reduces and
// the dispatches that fold its partials are one submission (`reduceOnGpu`), as they are inside.
//
// Like the rest of `typeshade/runtime` it imports no compiler: the plugin writes everything the
// call needs into the generated module at build time.

import type { CpuValue } from './cpu-runtime.js';
import { CpuTexture, isCpuTexture } from './cpu-texture.js';
import { fuseSlot } from './fuse-scope.js';
import { defaultOwner, foreignOwner, textureOwners, type CallOwner } from './owner.js';
import type { PortableIr } from './ir/portable.js';
import { KERNEL_TREE, treeIdentity, type TreeOp } from './kernel-tree.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import {
  glContext,
  onWebgl2,
  programOf as compileGl,
  type KernelGlLoop,
} from './host-kernel-gl.js';
import { kernelQueue, residentState, type ResidentArrayState } from './resident.js';
import { fromShader, toShader, type HostType } from './host-values.js';
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
  storageBuffer,
  readInto,
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
  /** An array with no size: the caller's storage (Rule 8.23). `s` is its TypeShade type. */
  | {
      readonly name: string;
      readonly k: 'array';
      readonly layout: Layout & { readonly k: 'a' };
      readonly writes: boolean;
      readonly s: string;
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
      readonly value?: HostType;
      readonly writes: boolean;
      readonly s: string;
    };

/** One loop of a kernel function the call dispatches. */
export interface KernelLoop {
  readonly entry: string;
  readonly range: string;
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly step: number;
  readonly writes: readonly string[];
  readonly checks: readonly { readonly param: string; readonly a: number; readonly c: number }[];
  /** The textures it stores into at `vec2(i % W, i / W)`, each with the CPU-tier function that
   *  gives `W` (change 0077). Absent in a face written before that change. */
  readonly texels?: readonly { readonly param: string; readonly width: string }[];
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

/** What `typeshade({ fuse: true })` adds to the face of a kernel function that lowers (change
 *  0058): the facts of each loop, and the lowered module they name. */
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
    /** The uniform of the scalar parameters, `_start` and `_n`. */
    readonly args: EntryBinding;
    /** Each array parameter's storage binding. */
    readonly arrays: readonly EntryBinding[];
    /** Each texture parameter's binding (change 0077). */
    readonly textures?: readonly HandleBinding[];
    readonly loops: readonly KernelLoop[];
    /** The CPU-tier function that gives the result from the parameters and what the GPU folded
     *  for each reduction, in loop order; absent when the function returns nothing. */
    readonly tail?: string;
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
  /** The facts and the loop IR of a function that lowers, written only under
   *  `typeshade({ fuse: true })` (change 0058). */
  readonly fuse?: KernelFuse;
}

/** The compute entries of each loop, built once per kernel and flavor of the emulated double,
 *  since a pipeline is cached per entry object: the loop's, and the one that folds its partials
 *  when it reduces. */
const entries = new WeakMap<
  KernelFace,
  Partial<Record<Fp64Flavor, { loop: ComputeEntry; fold?: ComputeEntry }[]>>
>();

const TREE_PARAMS = [
  'global_invocation_id',
  'num_workgroups',
  'local_invocation_index',
  'workgroup_id',
] as const;

function entriesOf(
  k: KernelFace,
  flavor: Fp64Flavor,
): { loop: ComputeEntry; fold?: ComputeEntry; count?: ComputeEntry; scan?: ComputeEntry }[] {
  const g = k.gpu!;
  // A module that emulates no `f64` has one WGSL, and the flavor changes nothing (change 0073).
  const integer = flavor === 'integer' && g.wgslInteger !== undefined;
  const under = integer ? 'integer' : 'float';
  let per = entries.get(k);
  if (per === undefined) entries.set(k, (per = {}));
  let es = per[under];
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
        g.guard === undefined || integer
          ? []
          : [{ name: '_fp64', ...g.guard, space: 'texture', s: 'texture_2d<f32>', guard: true }];
      const entry = (fn: string, bindings: DrawBinding[], tree = false): ComputeEntry => ({
        name: k.name,
        fn,
        wgsl: integer ? g.wgslInteger! : g.wgsl,
        wg: tree && loop.reduce === undefined ? [KERNEL_TREE, 1, 1] : [loop.wg, 1, 1],
        params: loop.reduce !== undefined || tree ? TREE_PARAMS : TREE_PARAMS.slice(0, 2),
        bindings: [...bindings, ...guard],
        workgroupZero: {},
      });
      return {
        loop: entry(loop.entry, [
          g.args,
          ...g.arrays.map((b) => ({ ...b, writes: loop.writes.includes(b.name) })),
          ...records,
          ...parts,
          ...(g.textures ?? []),
        ]),
        ...(loop.reduce !== undefined
          ? { fold: entry(loop.reduce.entry, [g.args, ...parts]) }
          : {}),
        // A loop that pushes counts and scans before it stores (change 0078).
        ...(loop.push !== undefined
          ? {
              count: entry(loop.push.count, [
                g.args,
                ...g.arrays.map((b) => ({ ...b, writes: false })),
                ...records.map((b) => ({ ...b, writes: false })),
                ...parts,
                ...(g.textures ?? []),
              ]),
              scan: entry(loop.push.scan, [g.args, ...parts], true),
            }
          : {}),
      };
    });
    per[under] = es;
  }
  return es;
}

/**
 * Call a kernel function from host code (Rule 8.21): dispatch each of its loops on WebGPU when
 * it lowers and there is a device, and otherwise run it on the CPU tier, in the order of the
 * tiers `configure` sets (Rule 11.8); either way each array it writes is read back into the
 * caller's array in place, or left on the device in a `Resident`, and the promise resolves to
 * its result. Calls run one after another, in the order they were made.
 *
 * Inside the body of `fuse()` (change 0058) a call whose written arrays are all resident is
 * recorded, and runs with the scope's plan, at the scope's place in that order.
 *
 * @throws `TypeError` naming the function and the parameter for a value that does not fit, and
 *   for an array shorter than the index range a loop writes; `Error` when no tier it may use can
 *   run it.
 */
export function callKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
): Promise<unknown> {
  const scope = fuseSlot.active;
  if (scope !== undefined) return scope.kernel(cpu, k, argc, args);
  // A bare call is the default owner's: it takes no array a device made (change 0071).
  for (const [i, p] of k.params.entries()) {
    if (p.k !== 'array') continue;
    const foreign = foreignOwner(
      `${k.name}(): parameter "${p.name}"`,
      defaultOwner,
      residentState(args[i]),
    );
    if (foreign !== undefined) return Promise.reject(foreign);
  }
  const written = k.params.flatMap((p, i) =>
    p.k === 'array' && p.writes ? [residentState(args[i])].filter((s) => s !== undefined) : [],
  ) as ResidentArrayState[];
  const call = kernelQueue.run(() => runKernel(cpu, k, argc, args));
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
): Promise<unknown> {
  try {
    return runChecked(cpu, k, checkCall(cpu, k, argc, args));
  } catch (e) {
    return Promise.reject(e);
  }
}

/** The refusal of a call that passes the wrong number of arguments, or undefined. */
export function arityError(k: KernelFace, argc: number): TypeError | undefined {
  return argc === k.params.length
    ? undefined
    : new TypeError(
        `${k.name}() takes ${k.params.length} argument${k.params.length === 1 ? '' : 's'}; got ${argc}.`,
      );
}

/** A call's arguments, checked: what `runChecked` runs. */
export interface CheckedCall {
  readonly states: readonly (ResidentArrayState | undefined)[];
  readonly hosts: readonly unknown[];
  readonly values: readonly unknown[];
  /** Each loop's start and trip count; absent when the function runs on the CPU. */
  readonly ranges: readonly { start: number; n: number }[] | undefined;
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
  // A `Resident` stands for the array it holds.
  const states = args.map((a) => residentState(a));
  states.forEach((s, i) => {
    if (s !== undefined && states.indexOf(s) !== i)
      throw new TypeError(
        `${k.name}(): parameter "${k.params[i]!.name}" is the same resident array as parameter "${k.params[states.indexOf(s)]!.name}".`,
      );
  });
  // A scratch array of a fuse scope holds no host array yet, so `hosts` has the handle there, and
  // `checkArray` asks the array's own state instead of reading it.
  const hosts = args.map((a, i) => states[i]?.host ?? a);
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
  // loops write no scalar the ranges read (Rule 8.22), so every range is known up front.
  const ranges = k.gpu !== undefined ? rangesOf(cpu, k, values) : undefined;
  return { states, hosts, values, ranges };
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
  const { states, hosts, values, ranges } = c;
  const why: string[] = [];
  // Outside a scope the call is over when it resolves. In a plan, only the result is left.
  const result = (get: Finish): unknown => (run === undefined ? get() : get);
  // A bare call is the default owner's; a plan's call is its scope's owner's (change 0071).
  const owner = run?.owner ?? defaultOwner;
  // A texture a device made is on that device, as its buffer is (change 0077).
  k.params.forEach((p, i) => {
    const by = p.k === 'texture' ? textureOwners.get(hosts[i] as object) : undefined;
    if (by !== undefined && by !== owner)
      throw new TypeError(
        `${k.name}(): parameter "${p.name}" is a texture of ${by.label}, and this call is ${owner.label}'s. Make the texture with the device that runs the call.`,
      );
  });
  // A texture of the CPU tier's memory binds on no GPU tier (change 0077).
  const cpuOnly = k.params.find((p, i) => p.k === 'texture' && isCpuTexture(hosts[i]));
  for (const tier of owner.tiers()) {
    if (tier === 'webgpu') {
      if (k.gpu === undefined || ranges === undefined) {
        why.push(`webgpu: it runs on the CPU, ${k.noGpu ?? 'unknown'}`);
        continue;
      }
      if (cpuOnly !== undefined) {
        why.push(`webgpu: parameter "${cpuOnly.name}" is a texture of the CPU tier's memory`);
        continue;
      }
      const d = await owner.device();
      if (d === null) {
        why.push('webgpu: there is no WebGPU device');
        continue;
      }
      run?.tiers.add(tier);
      const folded = await onDevice(d, k, hosts, states, ranges, run, owner.fp64Flavor(), values);
      return result(async () => tailResult(cpu, k, values, await folded()));
    }
    if (tier === 'webgl2') {
      if (k.gl === undefined || k.gpu === undefined || ranges === undefined) {
        why.push(`webgl2: it runs on the CPU, ${k.noWebgl2 ?? k.noGpu ?? 'unknown'}`);
        continue;
      }
      const gl = glContext();
      if (gl === null) {
        why.push('webgl2: there is no WebGL2 context');
        continue;
      }
      // Every program first, so that one WebGL2 refuses leaves no array half written.
      try {
        for (const loop of k.gl.loops) compileGl(gl, loop);
      } catch (e) {
        why.push(`webgl2: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      await run?.flush();
      await syncAll(states, run);
      run?.tiers.add(tier);
      const live = heldBy(states, hosts);
      const arrays = new Map<string, unknown>();
      const uniforms = new Map<string, unknown>();
      k.params.forEach((p, i) => {
        if (p.k === 'array') arrays.set(p.name, live[i]);
        else uniforms.set(p.name, values[i]);
      });
      k.gl.loops.forEach((loop, j) =>
        onWebgl2(gl, loop, arrays, uniforms, ranges[j]!.start, k.gpu!.loops[j]!.step, ranges[j]!.n),
      );
      if (run !== undefined) run.counts.dispatches += ranges.filter((r) => r.n > 0).length;
      const out = tailResult(cpu, k, values, []);
      return result(async () => out);
    }
    // Each texture as the CPU tier's memory: its own, or an ImageData's copy (change 0077).
    const memory = new Map<string, CpuTexture>();
    const unread = k.params.find((p, i) => {
      if (p.k !== 'texture') return false;
      const t = cpuTextureOf(hosts[i]);
      if (t !== undefined) memory.set(p.name, t);
      return t === undefined;
    });
    if (unread !== undefined) {
      why.push(
        `cpu: parameter "${unread.name}" is a texture the CPU tier cannot read; it reads an ImageData and a texture a device on the CPU tier made`,
      );
      continue;
    }
    await run?.flush();
    await syncAll(states, run);
    run?.tiers.add(tier);
    const out = onCpu(cpu, k, heldBy(states, hosts), values, memory);
    return result(async () => out);
  }
  throw new Error(`${k.name}(): no tier it may use can run it (${why.join('; ')}).`);
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
  const g = globalThis as { ImageData?: abstract new (...a: never[]) => unknown };
  if (g.ImageData !== undefined && v instanceof g.ImageData)
    return CpuTexture.fromImageData(v as unknown as ImageData);
  return undefined;
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
  if (p.value === undefined) {
    if (!(v instanceof Set)) throw new TypeError(`${at}: takes a Set; got ${describe(v)}.`);
    for (const key of v as Set<unknown>)
      if (!fitsKey(p.key, key))
        throw new TypeError(`${at}: the key ${describe(key)} is not a ${p.key}.`);
    return new Set(v as Set<number>);
  }
  if (!(v instanceof Map)) throw new TypeError(`${at}: takes a Map; got ${describe(v)}.`);
  const out = new Map<number, CpuValue>();
  for (const [key, value] of v as Map<unknown, unknown>) {
    if (!fitsKey(p.key, key))
      throw new TypeError(`${at}: the key ${describe(key)} is not a ${p.key}.`);
    out.set(key as number, toShader(k.name, `${p.name}" at key "${String(key)}`, p.value, value));
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
    for (const key of ran as Set<number>) (host as Set<number>).add(key);
    return;
  }
  for (const [key, value] of ran as Map<number, CpuValue>)
    (host as Map<number, unknown>).set(key, fromShader(p.value, value));
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
      (host as Set<number>).add(key);
      (copy as Set<number> | undefined)?.add(key);
      continue;
    }
    const entry = readInto(dv, r * l.st, l.e, blank(l.e)) as {
      k: number;
      v: unknown;
    };
    const value = toShader(k.name, p.name, p.value, entry.v);
    (host as Map<number, unknown>).set(entry.k, fromShader(p.value, value));
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
  p: KernelParam & { k: 'collection' },
  host: unknown,
  values?: Layout & { k: 'a' },
): { keys: ArrayBuffer; values?: ArrayBuffer } {
  const entries: [number, unknown][] =
    p.value === undefined
      ? [...(host as Set<number>)].map((key) => [key, undefined])
      : [...(host as Map<number, unknown>)];
  const rows = entries
    .map(([key, value]) => ({ word: orderWord(p.key, key), value }))
    .sort((a, b) => a.word - b.word);
  const keys = new Uint32Array(rows.length + 1);
  keys[0] = rows.length;
  rows.forEach((r, i) => (keys[i + 1] = r.word));
  if (values === undefined) return { keys: keys.buffer };
  // Each value packed at its stride; an empty Map's binding holds one value nobody reads.
  const bytes = new ArrayBuffer(Math.max(1, rows.length) * values.st);
  const dv = new DataView(bytes);
  rows.forEach((r, i) => pack(dv, i * values.st, values.e, r.value, ''));
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
function rangesOf(
  cpu: GeneratedCpu,
  k: KernelFace,
  values: readonly unknown[],
): { start: number; n: number }[] {
  const g = k.gpu!;
  // The range functions read an array only by its length.
  const lengths = lengthsOf(k, values);
  const init = cpu.F['$initPrivates'];
  return g.loops.map((loop, j) => {
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
      const top = c.a > 0 ? c.a * hi + c.c : c.a * lo + c.c;
      const bottom = c.a > 0 ? c.a * lo + c.c : c.a * hi + c.c;
      if (top >= length || bottom < 0)
        throw new TypeError(
          `${k.name}(): parameter "${c.param}" holds ${length} elements, and loop ${j + 1} writes it at indices ${bottom} to ${top}.`,
        );
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
  ranges: readonly { start: number; n: number }[],
  run: PlanRun | undefined,
  flavor: Fp64Flavor,
  values: readonly unknown[] = [],
): Promise<Folded> {
  const g = k.gpu!;
  const es = entriesOf(k, flavor);
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
    const writes = g.loops.some((l) => l.writes.includes(p.name));
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
  for (const [j, loop] of g.loops.entries()) {
    const { start, n } = ranges[j]!;
    const vars = loop.reduce?.vars ?? [];
    await upload(j);
    if (n === 0) {
      // No iteration: the variable is combined with the identity, which leaves it, and a loop
      // that pushes pushed nothing.
      const identities = vars.map((v) => identityValue(v.op, v.scalar, v.n));
      if (loop.push !== undefined) identities.push(0 as CpuValue);
      folds.push(async () => identities);
      continue;
    }
    const uniform: Record<string, unknown> = { _start: start, _n: n, _in: 0, _out: 0 };
    k.params.forEach((p, i) => {
      if (p.k === 'value') uniform[p.name] = args[i];
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
        await batch.add(es[j]!.count!, checked, first.wg);
        await batch.add(es[j]!.scan!, checked, [1, 1, 1]);
        await batch.add(es[j]!.loop, checked, first.wg);
      } catch (e) {
        slots.destroy();
        throw e;
      }
      const total = batch.read(slots, n * 4, 4);
      const free = (): void => slots.destroy();
      void total.then(free, free);
      const records = recordBuffers.map((r) => {
        const read = batch.read(r.buffer, 0, Math.max(4, n * r.c.perIteration * r.st));
        const drop = (): void => r.buffer.destroy();
        void read.then(drop, drop);
        return { ...r, read };
      });
      let applied: Promise<void> | undefined;
      const apply = (): Promise<void> =>
        (applied ??= (async () => {
          const count = (await total).getUint32(0, true);
          for (const r of records) applyRecords(k, r.c, count, await r.read, args, values);
        })());
      if (records.length > 0) pending.push(apply);
      folds.push(async () => {
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
      folds.push(await reduceOnGpu(d, r, n, uniform, bound_, onDevice, batch, images));
    }
    // Outside a scope, the next loop sees what this one wrote.
    if (run === undefined) await batch.flush();
  }
  return async () => {
    const folded: CpuValue[] = [];
    try {
      for (const f of folds) folded.push(...(await f()));
    } finally {
      for (const b of tables) b.destroy();
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
    reads = layouts.map((l, i) => batch.read(partials[i]!, at * l.st, l.st));
  } catch (e) {
    free();
    throw e;
  }
  void Promise.all(reads).then(free, free);
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

function onCpu(
  cpu: GeneratedCpu,
  k: KernelFace,
  args: readonly unknown[],
  values: readonly unknown[],
  memory: ReadonlyMap<string, CpuTexture> = new Map(),
): unknown {
  const cpuArgs = k.params.map((p, i) =>
    p.k === 'array'
      ? toCpu(p.layout, args[i], false)
      : p.k === 'texture'
        ? (memory.get(p.name) as unknown as CpuValue)
        : (values[i] as CpuValue),
  );
  cpu.F['$initPrivates']?.();
  const result = cpu.F[k.fn]!(...cpuArgs);
  k.params.forEach((p, i) => {
    if (p.k === 'array' && p.writes) fromCpu(p.layout, cpuArgs[i]!, args[i], false);
    if (p.k === 'collection' && p.writes)
      collectionBack(p, cpuArgs[i] as unknown as Map<number, CpuValue> | Set<number>, args[i]);
  });
  return fromShader(k.result, result);
}
