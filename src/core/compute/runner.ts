import { planKernel } from './runner/kernel-plan.js';
import { type ModuleDecl } from '../ir/index.js';
import { createCpuRunner } from './runner/cpu.js';
import { TIERS } from '../tiers.js';
import type {
  ComputeBackend,
  RejectedBackend,
  ComputeRunnerOptions,
  ComputeRunner,
} from './runner/types.js';
import { createWebGl2Runner } from './runner/webgl2.js';
import { createWebGpuRunner, type GpuDeviceApi } from './runner/webgpu.js';
export type {
  ComputeBackend,
  RejectedBackend,
  GpuDeviceLike,
  ComputeRunnerOptions,
  ComputeRunner,
} from './runner/types.js';

const DEFAULT_PREFER: readonly ComputeBackend[] = TIERS;

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
