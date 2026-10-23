// One argument-count check for ordinary calls and the synchronous fuse recorder.
import type { KernelFace } from './host-kernel.js';

export function arityError(k: KernelFace, argc: number): TypeError | undefined {
  return argc === k.params.length
    ? undefined
    : new TypeError(
        `${k.name}() takes ${k.params.length} argument${k.params.length === 1 ? '' : 's'}; got ${argc}.`,
      );
}
