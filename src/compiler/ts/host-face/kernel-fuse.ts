import type { FuseArray, FuseLoop, KernelFuse } from '../../../core/host-kernel.js';
import type { FuncDecl } from '../../../core/ir/nodes.js';
import { toPortable } from '../../../core/ir/portable.js';
import { kernelWorkgroups } from '../../../core/kernel-workgroup.js';
import type { KernelPlan } from '../../../core/passes/kernel-lower.js';
import type { KernelProof } from '../../../core/passes/parallel-loop.js';
import { VERSION } from '../../../core/version.js';
import { describeRead } from '../kernel-loops.js';
import { bareArrays, reachedBy } from './kernel-facts.js';

export function fuseRecord(
  f: FuncDecl,
  plan: KernelPlan,
  proof: KernelProof,
  origin: string,
): KernelFuse {
  const arrayParams = f.params
    .filter((p) => p.type.kind === 'array' && p.type.size === undefined)
    .map((p) => p.name);
  const facts = plan.loops.map((l, j): FuseLoop => {
    const v = proof.loops[j]!;
    if (!v.ok) throw new Error(`${f.name}: loop ${j + 1} lowered without an accepted proof`);
    const arrays: FuseArray[] = [];
    for (const param of arrayParams) {
      const store = v.stores.find((x) => x.name === param);
      const fact = store ?? v.reads.find((x) => x.name === param);
      if (fact === undefined) continue;
      const first = describeRead(f, fact);
      arrays.push({
        param,
        access: store === undefined ? 'read' : store.readBack ? 'readwrite' : 'write',
        atI: fact.atI,
        ...(first !== undefined ? { first } : {}),
      });
    }
    const bare = bareArrays(f, plan, l, arrayParams);
    return {
      entry: l.entry,
      ...(l.reduce !== undefined ? { fold: l.reduce.entry } : {}),
      wg: l.wg,
      ...(kernelWorkgroups.has(f) ? { declared: true } : {}),
      arrays,
      ...(bare.length > 0 ? { bare } : {}),
      reduces: l.reduce !== undefined,
      scatters: v.writes.some((w) => w.kind === 'scatter'),
      continues: l.continues,
      iterates: l.iterates,
      iteration: l.iteration,
    };
  });
  return { origin, facts, ir: toPortable(reachedBy(plan.module), VERSION) };
}
