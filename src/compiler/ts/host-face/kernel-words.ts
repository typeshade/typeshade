import { emitModule } from '../../../core/backends/wgsl.js';
import type { EntryBinding } from '../../../core/host-entry.js';
import type { KernelFace, PushWord } from '../../../core/host-kernel.js';
import type { FuncDecl, ModuleDecl, StructDecl } from '../../../core/ir/nodes.js';
import { lowerKernelFor } from './made.js';
import { layoutOf } from '../../../core/manifest.js';
import type { KernelPlan } from '../../../core/passes/kernel-lower.js';
import type { KernelProof } from '../../../core/passes/parallel-loop.js';
import { authorTypeText } from '../context.js';
import { guardOf } from './guard.js';
import { spell } from './spell.js';

export function wordBinding(
  plan: KernelPlan,
  structs: ReadonlyMap<string, StructDecl>,
  name: string,
  rw: boolean,
): EntryBinding {
  const b = plan.module.bindings.find((x) => x.name === name)!;
  const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
  if ('none' in layout) throw new Error(layout.none);
  return {
    name: b.name,
    group: b.group,
    binding: b.binding,
    space: 'storage',
    writes: rw,
    ...(rw ? { rw: true as const } : {}),
    layout,
    s: spell(b.type),
  };
}

export function wordBindings(
  plan: KernelPlan,
  structs: ReadonlyMap<string, StructDecl>,
): PushWord[] | { none: string } {
  const out: PushWord[] = [];
  for (const w of plan.words ?? []) {
    const b = plan.module.bindings.find((x) => x.name === w.binding)!;
    const layout = layoutOf(b.type, 'std430', structs, authorTypeText);
    if ('none' in layout) return layout;
    out.push({
      param: w.param,
      field: w.field,
      binding: {
        name: b.name,
        group: b.group,
        binding: b.binding,
        space: 'storage',
        writes: true,
        rw: true,
        layout,
        s: spell(b.type),
      },
      loops: w.loops,
    });
  }
  return out;
}

export function heldVariant(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
): NonNullable<NonNullable<KernelFace['gpu']>['held']> | undefined {
  const plan = lowerKernelFor(f, m, proof, { held: true });
  if ('noGpu' in plan) return undefined;
  let wgsl: string;
  let wgslInteger: string | undefined;
  let wgslSubgroup: string | undefined;
  let wgslSubgroupInteger: string | undefined;
  try {
    wgsl = emitModule(plan.module);
    wgslInteger =
      guardOf(wgsl).guard !== undefined
        ? emitModule(plan.module, { fp64Flavor: 'integer' })
        : undefined;
  } catch {
    return undefined;
  }
  if (plan.subgroupModule !== undefined) {
    try {
      wgslSubgroup = emitModule(plan.subgroupModule);
      if (wgslInteger !== undefined)
        wgslSubgroupInteger = emitModule(plan.subgroupModule, { fp64Flavor: 'integer' });
    } catch {
      wgslSubgroup = undefined;
      wgslSubgroupInteger = undefined;
    }
  }
  const structs = new Map(plan.module.structs.map((x) => [x.name, x]));
  const args = layoutOf(
    { kind: 'struct', name: plan.argsStruct },
    'std140',
    structs,
    authorTypeText,
  );
  const words = wordBindings(plan, structs);
  if ('none' in args || 'none' in words) return undefined;
  return {
    wgsl,
    ...(wgslInteger !== undefined ? { wgslInteger } : {}),
    ...(wgslSubgroup !== undefined ? { wgslSubgroup } : {}),
    ...(wgslSubgroupInteger !== undefined ? { wgslSubgroupInteger } : {}),
    args: {
      name: plan.argsBinding,
      group: 0,
      binding: 0,
      space: 'uniform',
      writes: false,
      layout: args,
      s: plan.argsStruct,
    },
    words,
    ...guardOf(wgsl),
  };
}
