import { planKernel, type KernelPlan } from './runner/kernel-plan.js';
import { workgroupSizeOf, type ModuleDecl } from '../ir/index.js';
import { createCpuRunner } from './runner/cpu.js';
import { emitModule as emitWgslModule } from '../backends/wgsl.js';
import { TIERS } from '../tiers.js';
import { emittedName, spellingsOf } from '../spelling-plan.js';
import type {
  ComputeBackend,
  RejectedBackend,
  ComputeRunnerOptions,
  ComputeRunner,
} from './runner/types.js';
import { createWebGl2Runner } from './runner/webgl2.js';
export type {
  ComputeBackend,
  RejectedBackend,
  GpuDeviceLike,
  ComputeRunnerOptions,
  ComputeRunner,
} from './runner/types.js';

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

interface GpuDeviceApi {
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

const DEFAULT_PREFER: readonly ComputeBackend[] = TIERS;

function createWebGpuRunner(
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

/** Build a runner for `m`, resolving the backend ONCE against `prefer`.
 *
 *  Throws — rather than silently degrading — when no candidate in `prefer` is available;
 *  the error lists every rejection reason, so "why is this on the CPU?" is answerable
 *  from the message alone.
 *
 *  @throws when the module has no `portable: true` compute entry, when that entry is
 *  outside the gather-only tier (the analyzer's own sentences, the `SD0111` text), or
 *  when no preferred backend can be built.
 */
export async function createComputeRunner(
  m: ModuleDecl,
  opts?: ComputeRunnerOptions,
): Promise<ComputeRunner> {
  const plan = planKernel(m);
  const prefer = opts?.prefer ?? DEFAULT_PREFER;
  const rejected: RejectedBackend[] = [];

  for (const backend of prefer) {
    if (backend === 'webgpu') {
      if (!opts?.device) {
        rejected.push({ backend, reason: 'no WebGPU device was passed (`device`)' });
        continue;
      }
      const offGroup = [plan.outBinding, plan.dispatchUniform, ...plan.readBindings].find(
        (b) => b.group !== 0,
      );
      if (offGroup) {
        rejected.push({
          backend,
          reason: `binding '${offGroup.name}' is declared in @group(${offGroup.group}); this tier builds its bind group from \`layout: 'auto'\` + getBindGroupLayout(0), so every binding a portable kernel touches must be in @group(0)`,
        });
        continue;
      }
      const impl = createWebGpuRunner(opts.device as GpuDeviceApi, m, plan);
      return { backend, rejected, run: impl.run, dispose: impl.dispose };
    }
    if (backend === 'webgl2') {
      if (!opts?.gl) {
        rejected.push({ backend, reason: 'no WebGL2 context was passed (`gl`)' });
        continue;
      }
      const impl = createWebGl2Runner(opts.gl, m, plan);
      return { backend, rejected, run: impl.run, dispose: impl.dispose };
    }
    const impl = createCpuRunner(m, plan);
    return { backend: 'cpu', rejected, run: impl.run, dispose: impl.dispose };
  }

  throw new Error(
    `createComputeRunner: no backend from [${prefer.join(', ')}] could be used. ` +
      rejected.map((r) => `${r.backend}: ${r.reason}`).join('; '),
  );
}
