// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { IncomingReads } from '../host-failure.js';
import type { GeneratedCpu } from '../host-entry.js';
import { callKernel, type KernelFace } from '../host-kernel.js';
import type { KernelMade } from '../kernel-made-face.js';
import { withSaturatingPushes } from '../push-count.js';
import { boundArguments } from './bound.js';
import { countedTotal } from './capacity.js';
import { filled } from './making.js';

export function saturating(cpu: GeneratedCpu, k: KernelFace): GeneratedCpu {
  const run = cpu.F[k.fn]!;
  return {
    ...cpu,
    F: { ...cpu.F, [k.fn]: (...a) => withSaturatingPushes(() => run(...a)) },
  };
}

const countingFaces = new WeakMap<KernelFace, KernelFace>();

export function counting(k: KernelFace): KernelFace {
  if (k.gpu === undefined) return k;
  let face = countingFaces.get(k);
  if (face === undefined) {
    face = { ...k, gpu: { ...k.gpu, countOnly: true } };
    countingFaces.set(k, face);
  }
  return face;
}

export async function countedCapacity(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
  reads?: IncomingReads,
): Promise<number> {
  const all = boundArguments(k, made, args, filled(k, made, 1, undefined));
  const pushed = await callKernel(saturating(cpu, k), counting(k), all.length, all, reads);
  return countedTotal(k, made, Number(pushed));
}
