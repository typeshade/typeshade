// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { IncomingReads } from '../host-failure.js';
import type { GeneratedCpu } from '../host-entry.js';
import { callKernel, type KernelFace } from '../host-kernel.js';
import type { KernelMade } from '../kernel-made-face.js';
import { withSaturatingPushes } from '../push-count.js';
import { countedTotal } from './capacity.js';
import { filled } from './making.js';

export function saturating(cpu: GeneratedCpu, k: KernelFace): GeneratedCpu {
  const run = cpu.F[k.fn]!;
  return {
    ...cpu,
    F: { ...cpu.F, [k.fn]: (...a) => withSaturatingPushes(() => run(...a)) },
  };
}

export async function countedCapacity(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
  reads?: IncomingReads,
): Promise<number> {
  let next = 0;
  const all = k.params.map((p) =>
    p.name === made.param
      ? filled(k, made, 1, undefined)
      : p.name === made.count
        ? 0
        : args[next++],
  );
  const pushed = await callKernel(saturating(cpu, k), k, all.length, all, reads);
  return countedTotal(k, made, Number(pushed));
}
