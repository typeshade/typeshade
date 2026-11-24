import type { RhiBuffer } from '../rhi.js';

export class CpuBuffer implements RhiBuffer {
  readonly __rhi = 'buffer';
  readonly bytes: Uint8Array;
  destroyed = false;
  constructor(
    readonly size: number,
    readonly usage: readonly string[],
  ) {
    this.bytes = new Uint8Array(size);
  }
}
