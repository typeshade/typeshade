import type { KernelPlan } from './kernel-plan.js';
import { workgroupSizeOf, type ModuleDecl } from '../../ir/index.js';
import { emitModule as emitWgslModule } from '../../backends/wgsl.js';
import { emittedName, spellingsOf } from '../../spelling-plan.js';
import type { ComputeRunner } from './types.js';

interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GpuComputePassLike {
  setPipeline(p: unknown): void;
  setBindGroup(index: number, group: unknown): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}

interface GpuEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(
    src: unknown,
    srcOff: number,
    dst: unknown,
    dstOff: number,
    size: number,
  ): void;
  finish(): unknown;
}

interface GpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}

export interface GpuDeviceApi {
  createShaderModule(d: { code: string }): unknown;
  createComputePipeline(d: {
    layout: 'auto';
    compute: { module: unknown; entryPoint: string };
  }): GpuPipelineLike;
  createBuffer(d: { size: number; usage: number }): GpuBufferLike;
  createBindGroup(d: {
    layout: unknown;
    entries: readonly { binding: number; resource: { buffer: GpuBufferLike } }[];
  }): unknown;
  createCommandEncoder(): GpuEncoderLike;
  readonly queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView): void;
    submit(buffers: readonly unknown[]): void;
  };
}

/* Why: `GPUBufferUsage` / `GPUMapMode` flags, spelled out because `types: []` means the real
 *  globals are not declared here. These values are NORMATIVE in the WebGPU spec (§buffer
 *  usage flags), not implementation detail — they are as stable as the API itself. */
const GPU_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;
const GPU_MAP_READ = 0x0001;

export function createWebGpuRunner(
  device: GpuDeviceApi,
  m: ModuleDecl,
  plan: KernelPlan,
): Omit<ComputeRunner, 'backend' | 'rejected'> {
  const shader = device.createShaderModule({ code: emitWgslModule(m) });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shader,
      entryPoint: emittedName(spellingsOf(m).wgsl.entries, plan.entry.name),
    },
  });
  const layout = pipeline.getBindGroupLayout(0);
  const wg = workgroupSizeOf(plan.entry) ?? 64;
  let disposed = false;

  return {
    async run(input: Float32Array, invocations?: number): Promise<Uint32Array> {
      if (disposed) throw new Error('createComputeRunner: runner has been disposed');
      const n = invocations ?? input.length;
      const outBytes = Math.max(4, n * 4);

      const inBuf = device.createBuffer({
        size: Math.max(4, input.byteLength),
        usage: GPU_USAGE.STORAGE | GPU_USAGE.COPY_DST,
      });
      const outBuf = device.createBuffer({
        size: outBytes,
        usage: GPU_USAGE.STORAGE | GPU_USAGE.COPY_SRC,
      });
      const countBuf = device.createBuffer({
        size: 16,
        usage: GPU_USAGE.UNIFORM | GPU_USAGE.COPY_DST,
      });
      const stagingBuf = device.createBuffer({
        size: outBytes,
        usage: GPU_USAGE.MAP_READ | GPU_USAGE.COPY_DST,
      });
      try {
        device.queue.writeBuffer(inBuf, 0, input);
        device.queue.writeBuffer(countBuf, 0, new Uint32Array([n, 0, 0, 0]));

        const bind = device.createBindGroup({
          layout,
          entries: [
            ...plan.readBindings.map((b) => ({ binding: b.binding, resource: { buffer: inBuf } })),
            { binding: plan.outBinding.binding, resource: { buffer: outBuf } },
            { binding: plan.dispatchUniform.binding, resource: { buffer: countBuf } },
          ],
        });

        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(Math.ceil(n / wg));
        pass.end();
        enc.copyBufferToBuffer(outBuf, 0, stagingBuf, 0, outBytes);
        device.queue.submit([enc.finish()]);

        await stagingBuf.mapAsync(GPU_MAP_READ);
        const got = new Uint32Array(stagingBuf.getMappedRange().slice(0, n * 4));
        stagingBuf.unmap();
        return got;
      } finally {
        inBuf.destroy();
        outBuf.destroy();
        countBuf.destroy();
        stagingBuf.destroy();
      }
    },
    dispose(): void {
      disposed = true;
    },
  };
}
