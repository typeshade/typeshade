// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { CpuValue } from '../cpu-runtime.js';
import type { GeneratedCpu } from '../host-entry.js';
import type { IncomingReads } from '../host-failure.js';
import { callKernel, type KernelFace } from '../host-kernel.js';
import { callDefault } from '../owner.js';
import { fromShaderIn } from '../host-values.js';
import type { KernelMade } from '../kernel-made-face.js';
import { markGrowing, MOST_PUSHED, pushedLength } from '../push-count.js';
import { PastGrowth } from '../pushed-index.js';
import { boundArguments } from './bound.js';
import { allocatedFor, pastLimit } from './capacity.js';
import { filled, NO_CLASSES, type Made } from './making.js';

const ARRAYS = { f32: Float32Array, i32: Int32Array, u32: Uint32Array } as const;

function pastGrowth(k: KernelFace, made: KernelMade, e: PastGrowth): RangeError {
  return pastLimit(k, made, `${String(e.length)} or more`, String(e.length - 1), true);
}

const cpuFaces = new WeakMap<KernelFace, KernelFace>();

export function cpuTierListed(): boolean {
  return callDefault().tiers().includes('cpu');
}

export function onCpuTier(k: KernelFace, made: KernelMade): KernelFace {
  let face = cpuFaces.get(k);
  if (face === undefined) {
    const own: Record<string, unknown> = { ...k };
    for (const key of ['gpu', 'gl', 'noWebgl2']) delete own[key];
    own.noGpu =
      `its capacity for "${made.shown}" is more than the host can reserve, and only the CPU ` +
      `tier grows an array while it runs`;
    face = own as unknown as KernelFace;
    cpuFaces.set(k, face);
  }
  return face;
}

export function growingRun(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  limit: number = MOST_PUSHED,
): { readonly cpu: GeneratedCpu; readonly store: CpuValue[] } {
  const store: CpuValue[] = [];
  markGrowing(store, limit);
  const at = k.params.findIndex((p) => p.name === made.param);
  const run = cpu.F[k.fn]!;
  const grows = (...a: CpuValue[]): CpuValue => {
    a[at] = store as unknown as CpuValue;
    try {
      return run(...a);
    } catch (e) {
      throw e instanceof PastGrowth ? pastGrowth(k, made, e) : e;
    }
  };
  return { cpu: { ...cpu, F: { ...cpu.F, [k.fn]: grows } }, store };
}

export function materialized(
  k: KernelFace,
  made: KernelMade,
  store: readonly CpuValue[],
  pushed: unknown,
): Made {
  const count = Number(pushed);
  if (count !== store.length || pushedLength(store) !== store.length)
    throw new Error(
      `${k.name}(): the array it grows with push, "${made.shown}", reports ${String(pushed)} ` +
        `elements pushed and holds ${String(store.length)}.`,
    );
  if (made.struct !== undefined) {
    const struct = made.struct;
    const classes = k.P?.() ?? NO_CLASSES;
    const elements = allocatedFor(
      k,
      made,
      count,
      () => store.map((v) => fromShaderIn(struct, v, classes)),
      true,
    );
    return made.share === 'every' ? elements.map(() => elements[0]) : elements;
  }
  const width = made.width ?? 1;
  return allocatedFor(
    k,
    made,
    count,
    () => {
      const array = new ARRAYS[made.array!](count * width);
      if (width === 1) array.set(store as unknown as number[]);
      else store.forEach((v, i) => array.set(v as unknown as number[], i * width));
      return array;
    },
    true,
  );
}

export function callGrowing(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
  reads?: IncomingReads,
  limit: number = MOST_PUSHED,
): Promise<unknown> {
  const run = growingRun(cpu, k, made, limit);
  const all = boundArguments(k, made, args, filled(k, made, 1, undefined));
  return callKernel(run.cpu, k, all.length, all, reads).then((pushed) =>
    materialized(k, made, run.store, pushed),
  );
}
