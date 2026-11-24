import { expect } from 'vitest';
import { bothHalves, bothTake } from '../testing/both-halves.js';
import type { ModuleDecl } from '../ir/nodes.js';
import { lowerKernel, type KernelPlan } from './kernel-lower.js';
import { proveKernels, type KernelProof } from './parallel-loop.js';

export const FILE = 'm.shade.ts';

export interface Lowered {
  readonly module: ModuleDecl;
  readonly proof: KernelProof;
  readonly plan: KernelPlan | { readonly noGpu: string };
}

export function lowerFrom(module: ModuleDecl, name: string, proof: KernelProof): Lowered['plan'] {
  return lowerKernel(
    module.funcs.find((f) => f.name === name)!,
    module,
    proof,
  );
}

export function lowered(body: string, name = 'k'): Lowered {
  const halves = bothTake(`"use typeshade";\n${body}\n`, { fileName: FILE });
  const module = halves.result.module;
  const proof = proveKernels(module).find((p) => p.fn === name)!;
  return { module, proof, plan: lowerFrom(module, name, proof) };
}

export function refusedByProof(body: string, name = 'k'): Lowered['plan'] {
  const halves = bothHalves(`"use typeshade";\n${body}\n`, { fileName: FILE });
  expect(halves.compiler).toEqual([]);
  const module = halves.result.module;
  return lowerFrom(
    module,
    name,
    proveKernels(module).find((p) => p.fn === name)!,
  );
}

export const noGpu = (plan: Lowered['plan']): string => {
  if (!('noGpu' in plan)) throw new Error('the function was lowered');
  return plan.noGpu;
};
