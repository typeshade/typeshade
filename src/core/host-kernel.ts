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
import { fromShader, toShader, type HostType } from './host-values.js';
import {
  byteSize,
  fromCpu,
  gpuDevice,
  Misfit,
  onGpu,
  pack,
  runtimeCount,
  toCpu,
  type ComputeEntry,
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
  };
  /** Why it runs on the CPU tier, when it does. */
  readonly noGpu?: string;
}

/** The compute entry of each loop, built once per kernel, since a pipeline is cached per
 *  entry object. */
const entries = new WeakMap<KernelFace, ComputeEntry[]>();

function entriesOf(k: KernelFace): ComputeEntry[] {
  let es = entries.get(k);
  if (es === undefined) {
    const g = k.gpu!;
    es = g.loops.map((loop): ComputeEntry => ({
      name: k.name,
      fn: loop.entry,
      wgsl: g.wgsl,
      wg: [64, 1, 1],
      params: ['global_invocation_id', 'num_workgroups'],
      bindings: [g.args, ...g.arrays.map((b) => ({ ...b, writes: loop.writes.includes(b.name) }))],
      workgroupZero: {},
    }));
    entries.set(k, es);
  }
  return es;
}

/**
 * Call a kernel function from host code (Rule 8.21): dispatch each of its loops on WebGPU when
 * it lowers and there is a device, and otherwise run it on the CPU tier; either way each array it
 * writes is read back into the caller's array in place, and the promise resolves to its result.
 *
 * @throws `TypeError` naming the function and the parameter for a value that does not fit, and
 *   for an array shorter than the index range a loop writes.
 */
export async function callKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
): Promise<unknown> {
  if (argc !== k.params.length)
    throw new TypeError(
      `${k.name}() takes ${k.params.length} argument${k.params.length === 1 ? '' : 's'}; got ${argc}.`,
    );
  // Every value is checked before anything runs or is uploaded.
  const values = k.params.map((p, i) =>
    p.k === 'value' ? toShader(k.name, p.name, p.type, args[i]) : checkArray(k, p, args[i]),
  );
  // Each loop's range, and each array against the indices it writes, before anything runs: the
  // loops write no scalar the ranges read (Rule 8.22), so every range is known up front.
  const ranges = k.gpu !== undefined ? rangesOf(cpu, k, values) : undefined;
  const d = k.gpu !== undefined ? await gpuDevice() : null;
  if (d !== null && ranges !== undefined) {
    await onDevice(d, k, args, ranges);
    return undefined;
  }
  return onCpu(cpu, k, args, values);
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
  const lengths = k.params.map((p, i) =>
    p.k === 'array'
      ? ({ length: values[i] as number } as unknown as CpuValue)
      : (values[i] as CpuValue),
  );
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

async function onDevice(
  d: NonNullable<Awaited<ReturnType<typeof gpuDevice>>>,
  k: KernelFace,
  args: readonly unknown[],
  ranges: readonly { start: number; n: number }[],
): Promise<void> {
  const g = k.gpu!;
  const es = entriesOf(k);
  for (const [j] of g.loops.entries()) {
    const { start, n } = ranges[j]!;
    if (n === 0) continue;
    const uniform: Record<string, unknown> = { _start: start, _n: n };
    k.params.forEach((p, i) => {
      if (p.k === 'value') uniform[p.name] = args[i];
    });
    const bound_: Record<string, unknown> = { [g.args.name]: uniform };
    k.params.forEach((p, i) => {
      if (p.k === 'array') bound_[p.name] = args[i];
    });
    const groups = Math.ceil(n / 64);
    const x = Math.min(groups, 65535);
    await onGpu(d, es[j]!, { values: bound_, images: new Map(), samplers: new Map() }, [
      x,
      Math.ceil(groups / x),
      1,
    ]);
  }
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
