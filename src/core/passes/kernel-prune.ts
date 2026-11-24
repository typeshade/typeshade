import type { FuncDecl, ModuleDecl } from '../ir/index.js';
import { lowerKernel, type KernelPlan } from './kernel-lower.js';
import type { LowerOptions } from './kernel-lower-ir.js';
import type { KernelProof } from './parallel-loop.js';
import { reachFrom } from './stage-bindings.js';

export type { KernelPlan };

export function pruneUnreachedHelpers(m: ModuleDecl): ModuleDecl {
  const entries = m.funcs.filter((f) => f.stage !== undefined);
  const reached = reachFrom(m, entries).fns;
  return { ...m, funcs: m.funcs.filter((f) => f.stage !== undefined || reached.has(f.name)) };
}

export function lowerKernelPruned(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
  options: LowerOptions = {},
): KernelPlan | { readonly noGpu: string } {
  const plan = lowerKernel(f, m, proof, options);
  if ('noGpu' in plan) return plan;
  return {
    ...plan,
    module: pruneUnreachedHelpers(plan.module),
    ...(plan.subgroupModule !== undefined
      ? { subgroupModule: pruneUnreachedHelpers(plan.subgroupModule) }
      : {}),
  };
}
