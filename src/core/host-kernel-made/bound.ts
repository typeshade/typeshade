import type { KernelFace } from '../host-kernel.js';
import type { KernelMade } from '../kernel-made-face.js';
import type { Made } from './making.js';

export function boundArguments(
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
  bound: Made,
): unknown[] {
  let next = 0;
  return k.params.map((p) =>
    p.name === made.param ? bound : p.name === made.count ? 0 : args[next++],
  );
}
