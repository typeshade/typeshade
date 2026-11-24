import type { KernelPlan } from './kernel-plan.js';
import type { ModuleDecl } from '../../ir/index.js';
import { compileModuleJs } from '../../cpu-codegen.js';
import type { ComputeRunner } from './types.js';

export function createCpuRunner(
  m: ModuleDecl,
  plan: KernelPlan,
): Omit<ComputeRunner, 'backend' | 'rejected'> {
  const cm = compileModuleJs(m);
  const entryFn = cm.fns[plan.entry.name];
  if (typeof entryFn !== 'function')
    throw new Error(`createComputeRunner: compiled module has no entry '${plan.entry.name}'`);
  const gid: [number, number, number] = [0, 0, 0];

  return {
    run(input: Float32Array, invocations?: number): Promise<Uint32Array> {
      const n = invocations ?? input.length;
      const out = new Array<number>(n).fill(0);
      for (const b of plan.readBindings) cm.setBinding(b.name, Array.from(input));
      cm.setBinding(plan.dispatchUniform.name, [n, 0, 0, 0]);
      cm.setBinding(plan.outBinding.name, out);
      for (let i = 0; i < n; i++) {
        gid[0] = i;
        entryFn(gid);
      }
      return Promise.resolve(Uint32Array.from(out));
    },
    dispose(): void {},
  };
}
