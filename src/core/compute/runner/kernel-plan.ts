import type { ModuleDecl, FuncDecl, BindingDecl } from '../../ir/index.js';
import { analyzePortableKernel, isPortableComputeEntry } from '../../passes/portable-kernel.js';

export interface KernelPlan {
  readonly entry: FuncDecl;
  readonly readBindings: readonly BindingDecl[];
  readonly outBinding: BindingDecl;
  readonly dispatchUniform: BindingDecl;
}

export function planKernel(m: ModuleDecl): KernelPlan {
  const entry = m.funcs.find(isPortableComputeEntry);
  if (!entry)
    throw new Error(
      "createComputeRunner: no `portable: true` compute entry in this module. Declare the kernel `fn(…, { stage: 'compute', portable: true })` — the declaration is what routes the WebGL2 lowering and what gets the tier checked on both writers (X-GIS #1812).",
    );
  const tier = analyzePortableKernel(m, entry);
  if (!tier.ok) throw new Error(`createComputeRunner: ${tier.violations.join('; ')}`);
  return {
    entry,
    readBindings: m.bindings.filter((b) => b.space === 'storage' && b.access === 'read'),
    outBinding: tier.outBinding,
    dispatchUniform: tier.dispatchUniform,
  };
}
