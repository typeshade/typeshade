import type { RhiBindGroup, RhiBuffer, RhiComputePass, RhiComputePipeline } from '../rhi.js';
import type { CpuBuffer } from './buffer.js';
import type { CpuBindGroup } from './handles.js';
import type { CpuComputePipeline } from './pipelines.js';
import type { Command } from './types.js';
import { dispatch } from './execute.js';

export class CpuComputePassImpl implements RhiComputePass {
  #pipeline: CpuComputePipeline | undefined;
  readonly #groups = new Map<number, CpuBindGroup>();
  constructor(readonly commands: Command[]) {}
  setPipeline(pipeline: RhiComputePipeline): void {
    this.commands.push(() => (this.#pipeline = pipeline as CpuComputePipeline));
  }
  setBindGroup(index: number, group: RhiBindGroup): void {
    this.commands.push(() => this.#groups.set(index, group as CpuBindGroup));
  }
  dispatchWorkgroups(x: number, y = 1, z = 1): void {
    this.commands.push(() => {
      if (this.#pipeline === undefined)
        throw new TypeError('The dispatch has no pipeline: call setPipeline first.');
      dispatch(this.#pipeline, new Map(this.#groups), [x, y, z]);
    });
  }
  dispatchWorkgroupsIndirect(buffer: RhiBuffer, byteOffset: number): void {
    this.commands.push(() => {
      if (this.#pipeline === undefined)
        throw new TypeError('The dispatch has no pipeline: call setPipeline first.');
      const b = buffer as CpuBuffer;
      if (byteOffset % 4 !== 0 || byteOffset + 12 > b.size)
        throw new TypeError(
          `dispatchWorkgroupsIndirect: three counts from byte ${byteOffset} do not fit a buffer of ${b.size}.`,
        );
      const dv = new DataView(b.bytes.buffer, b.bytes.byteOffset + byteOffset, 12);
      const wg = [dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true)] as const;
      if (wg.some((n) => n === 0)) return;
      dispatch(this.#pipeline, new Map(this.#groups), wg);
    });
  }
  end(): void {}
}
