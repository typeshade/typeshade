import type { DrawBinding } from '../../../core/host-entry.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from '../../../core/intrinsics.js';
import type { FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { buildGlCompute, type GlComputeProgram } from '../../../core/passes/gl-compute.js';
import { spellingsOf } from '../../../core/spelling-plan.js';
import type { FaceCtx } from './context.js';
import { gpuOnlyCall } from './reach.js';
import { spell } from './spell.js';

const CPU_HANDLES: ReadonlySet<ShaderType['kind']> = new Set([
  'texture',
  'storage-texture',
  'depth-texture',
  'sampler',
  'sampler-comparison',
]);

export function noCpuTier(
  closure: ReadonlySet<string>,
  bindings: readonly DrawBinding[],
  c: FaceCtx,
): string | undefined {
  const handle = bindings.find(
    (b) => (b.space === 'texture' || b.space === 'sampler') && !('guard' in b),
  );
  if (handle !== undefined)
    return `it reaches the ${handle.s} "${handle.name}", which is not supported yet on the CPU tier (Rule 8.24)`;
  for (const g of closure)
    for (const n of [...(c.entry.reads.get(g) ?? []), ...(c.entry.writes.get(g) ?? [])]) {
      const b = c.entry.bindings.find((x) => x.name === n);
      if (b !== undefined && CPU_HANDLES.has(b.type.kind))
        return `it reaches the ${spell(b.type)} "${b.name}", which is not supported yet on the CPU tier (Rule 8.24)`;
    }
  for (const g of closure) {
    const gpu = gpuOnlyCall(c.byName.get(g)!, c.entry.declared);
    if (gpu !== undefined && !isAtomicIntrinsic(gpu) && !isBarrierIntrinsic(gpu))
      return `it reaches ${gpu}(), which is not supported yet on the CPU tier (Rule 8.24)`;
  }
  return undefined;
}

export function wgslEntryPoint(f: FuncDecl, c: FaceCtx): { entryPoint?: string } {
  const emitted = spellingsOf(c.entry.module).wgsl.entries.get(f.name);
  return emitted === undefined ? {} : { entryPoint: emitted };
}

export function glTier(f: FuncDecl, c: FaceCtx): { gl: GlComputeProgram } | { noGl: string } {
  try {
    return { gl: buildGlCompute(c.entry.module, f.name) };
  } catch (e) {
    return { noGl: e instanceof Error ? e.message : String(e) };
  }
}
