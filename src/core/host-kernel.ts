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
// Like the rest of `typeshade/runtime` it imports no compiler: the plugin writes everything the
// call needs into the generated module at build time.

import type { CpuValue } from './cpu-runtime.js';
import { KERNEL_TREE, treeIdentity, type TreeOp } from './kernel-tree.js';
import {
  glContext,
  onWebgl2,
  programOf as compileGl,
  type KernelGlLoop,
} from './host-kernel-gl.js';
import { kernelQueue, preferredTiers, residentState, type ResidentArrayState } from './resident.js';
import { fromShader, toShader, type HostType } from './host-values.js';
import {
  byteSize,
  fromCpu,
  gpuDevice,
  Misfit,
  onGpu,
  pack,
  packed,
  type GpuBuffer,
  runtimeCount,
  toCpu,
  type ComputeEntry,
  type DrawBinding,
  type EntryBinding,
  type GeneratedCpu,
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
    };

/** One loop of a kernel function the call dispatches. */
export interface KernelLoop {
  readonly entry: string;
  readonly range: string;
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly step: number;
  readonly writes: readonly string[];
  readonly checks: readonly { readonly param: string; readonly a: number; readonly c: number }[];
  /** The workgroup size of its entry: 256 when it reduces. */
  readonly wg: number;
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
    /** The uniform of the scalar parameters, `_start` and `_n`. */
    readonly args: EntryBinding;
    /** Each array parameter's storage binding. */
    readonly arrays: readonly EntryBinding[];
    readonly loops: readonly KernelLoop[];
    /** The CPU-tier function that gives the result from the parameters and what the GPU folded
     *  for each reduction, in loop order; absent when the function returns nothing. */
    readonly tail?: string;
    /** Where the `_fp64` guard is, when the module emulates `f64`: the call binds it. */
    readonly guard?: { readonly group: number; readonly binding: number };
  };
  /** What the WebGL2 tier draws, one program per loop, when every loop writes one array of
   *  4-byte elements at `i` (Rule 11.8). */
  readonly gl?: { readonly loops: readonly KernelGlLoop[] };
  /** Why it does not run on WebGL2, when it does not. */
  readonly noWebgl2?: string;
  /** Why it runs on the CPU tier, when it does. */
  readonly noGpu?: string;
}

/** The compute entries of each loop, built once per kernel, since a pipeline is cached per
 *  entry object: the loop's, and the one that folds its partials when it reduces. */
const entries = new WeakMap<KernelFace, { loop: ComputeEntry; fold?: ComputeEntry }[]>();

const TREE_PARAMS = [
  'global_invocation_id',
  'num_workgroups',
  'local_invocation_index',
  'workgroup_id',
] as const;

function entriesOf(k: KernelFace): { loop: ComputeEntry; fold?: ComputeEntry }[] {
  let es = entries.get(k);
  if (es === undefined) {
    const g = k.gpu!;
    es = g.loops.map((loop) => {
      const parts = (loop.reduce?.vars ?? []).map((v) => v.binding);
      // The `_fp64` guard of a module that emulates `f64`, which the runtime binds.
      const guard: DrawBinding[] =
        g.guard === undefined
          ? []
          : [{ name: '_fp64', ...g.guard, space: 'texture', s: 'texture_2d<f32>', guard: true }];
      const entry = (fn: string, bindings: EntryBinding[]): ComputeEntry => ({
        name: k.name,
        fn,
        wgsl: g.wgsl,
        wg: [loop.wg, 1, 1],
        params: loop.reduce !== undefined ? TREE_PARAMS : TREE_PARAMS.slice(0, 2),
        bindings: [...bindings, ...guard],
        workgroupZero: {},
      });
      return {
        loop: entry(loop.entry, [
          g.args,
          ...g.arrays.map((b) => ({ ...b, writes: loop.writes.includes(b.name) })),
          ...parts,
        ]),
        ...(loop.reduce !== undefined
          ? { fold: entry(loop.reduce.entry, [g.args, ...parts]) }
          : {}),
      };
    });
    entries.set(k, es);
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

async function runKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
): Promise<unknown> {
  if (argc !== k.params.length)
    throw new TypeError(
      `${k.name}() takes ${k.params.length} argument${k.params.length === 1 ? '' : 's'}; got ${argc}.`,
    );
  // A `Resident` stands for the array it holds.
  const states = args.map((a) => residentState(a));
  states.forEach((s, i) => {
    if (s !== undefined && states.indexOf(s) !== i)
      throw new TypeError(
        `${k.name}(): parameter "${k.params[i]!.name}" is the same resident array as parameter "${k.params[states.indexOf(s)]!.name}".`,
      );
  });
  const hosts = args.map((a, i) => states[i]?.host ?? a);
  // Every value is checked before anything runs or is uploaded.
  const values = k.params.map((p, i) =>
    p.k === 'value' ? toShader(k.name, p.name, p.type, hosts[i]) : checkArray(k, p, hosts[i]),
  );
  // Each loop's range, and each array against the indices it writes, before anything runs: the
  // loops write no scalar the ranges read (Rule 8.22), so every range is known up front.
  const ranges = k.gpu !== undefined ? rangesOf(cpu, k, values) : undefined;
  const why: string[] = [];
  for (const tier of preferredTiers()) {
    if (tier === 'webgpu') {
      if (k.gpu === undefined || ranges === undefined) {
        why.push(`webgpu: it runs on the CPU, ${k.noGpu ?? 'unknown'}`);
        continue;
      }
      const d = await gpuDevice();
      if (d === null) {
        why.push('webgpu: there is no WebGPU device');
        continue;
      }
      const folded = await onDevice(d, k, hosts, states, ranges);
      const tail = k.gpu.tail;
      if (tail === undefined) return undefined;
      cpu.F['$initPrivates']?.();
      return fromShader(k.result, cpu.F[tail]!(...lengthsOf(k, values), ...folded));
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
      for (const s of states) await s?.sync();
      const arrays = new Map<string, unknown>();
      const uniforms = new Map<string, unknown>();
      k.params.forEach((p, i) => {
        if (p.k === 'array') arrays.set(p.name, hosts[i]);
        else uniforms.set(p.name, values[i]);
      });
      k.gl.loops.forEach((loop, j) =>
        onWebgl2(gl, loop, arrays, uniforms, ranges[j]!.start, k.gpu!.loops[j]!.step, ranges[j]!.n),
      );
      const tail = k.gpu.tail;
      if (tail === undefined) return undefined;
      cpu.F['$initPrivates']?.();
      return fromShader(k.result, cpu.F[tail]!(...lengthsOf(k, values)));
    }
    for (const s of states) await s?.sync();
    return onCpu(cpu, k, hosts, values);
  }
  throw new Error(`${k.name}(): no tier it may use can run it (${why.join('; ')}).`);
}

/** Check an array argument against its layout; its element count. */
function checkArray(k: KernelFace, p: KernelParam & { k: 'array' }, v: unknown): number {
  try {
    const size = byteSize(p.layout, v, '');
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
    return { start, n };
  });
}

/** The parameters as the range functions and the tail take them: each array by its length. */
function lengthsOf(k: KernelFace, values: readonly unknown[]): CpuValue[] {
  return k.params.map((p, i) =>
    p.k === 'array'
      ? ({ length: values[i] as number } as unknown as CpuValue)
      : (values[i] as CpuValue),
  );
}

/** The workgroups of a dispatch of `groups`, past 65535 spilling into y, and how many that is. */
function grid(groups: number): { wg: [number, number, number]; slots: number } {
  const x = Math.max(1, Math.min(groups, 65535));
  const y = Math.ceil(groups / x);
  return { wg: [x, y, 1], slots: x * y };
}

const TYPED = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  f64: Float64Array,
} as const;

/** Dispatch each loop in order; for a loop that reduces, fold its partials level by level and
 *  return what each variable folded to, in loop order. */
async function onDevice(
  d: NonNullable<Awaited<ReturnType<typeof gpuDevice>>>,
  k: KernelFace,
  args: readonly unknown[],
  states: readonly (ResidentArrayState | undefined)[],
  ranges: readonly { start: number; n: number }[],
): Promise<CpuValue[]> {
  const g = k.gpu!;
  const es = entriesOf(k);
  const folded: CpuValue[] = [];
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
  for (const [j, loop] of g.loops.entries()) {
    const { start, n } = ranges[j]!;
    const vars = loop.reduce?.vars ?? [];
    if (n === 0) {
      // No iteration: the variable is combined with the identity, which leaves it.
      for (const v of vars) folded.push(identityValue(v.op, v.scalar, v.n));
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
    const first = grid(Math.ceil(n / loop.wg));
    if (vars.length === 0) {
      await onGpu(
        d,
        es[j]!.loop,
        { values: bound_, images: new Map(), samplers: new Map(), onDevice },
        first.wg,
      );
      continue;
    }
    // The partials of every level, one region after another.
    const levels: { wg: [number, number, number]; slots: number; count: number }[] = [];
    let count = Math.ceil(n / loop.wg);
    let slots = first.slots;
    while (count > 1) {
      const next = grid(Math.ceil(count / KERNEL_TREE));
      levels.push({ ...next, count });
      slots += next.slots;
      count = Math.ceil(count / KERNEL_TREE);
    }
    for (const v of vars) bound_[v.binding.name] = new TYPED[v.scalar](slots * v.n);
    const checked = { values: bound_, images: new Map(), samplers: new Map(), onDevice };
    await onGpu(d, es[j]!.loop, checked, first.wg);
    let at = 0;
    let out = first.slots;
    for (const level of levels) {
      uniform._n = level.count;
      uniform._in = at;
      uniform._out = out;
      await onGpu(d, es[j]!.fold!, checked, level.wg);
      at = out;
      out += level.slots;
    }
    for (const v of vars) {
      const part = bound_[v.binding.name] as ArrayLike<number>;
      folded.push(
        (v.n === 1
          ? part[at]!
          : Array.from({ length: v.n }, (_, c) => part[at * v.n + c]!)) as CpuValue,
      );
    }
  }
  return folded;
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
): unknown {
  const cpuArgs = k.params.map((p, i) =>
    p.k === 'array' ? toCpu(p.layout, args[i], false) : (values[i] as CpuValue),
  );
  cpu.F['$initPrivates']?.();
  const result = cpu.F[k.fn]!(...cpuArgs);
  k.params.forEach((p, i) => {
    if (p.k === 'array' && p.writes) fromCpu(p.layout, cpuArgs[i]!, args[i], false);
  });
  return fromShader(k.result, result);
}
