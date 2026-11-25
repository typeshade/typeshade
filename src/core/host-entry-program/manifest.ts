import { isBuffer, isGuard, type ComputeEntry, type GeneratedCpu } from '../host-entry.js';
import {
  PACK_SCHEMA,
  packLayout,
  type Pack,
  type PackBinding,
  type PackConsole,
  type PackEntry,
} from '../manifest-types.js';
import { VERSION } from '../version.js';
import type { Tier } from '../tiers.js';
import { packBindingOf, slotOf } from '../host-draw.js';
import { CPU_PROGRAM, type CpuCode, type CpuProgram } from '../../rhi/cpu-program.js';

type CallTier = Tier;

const manifests = new WeakMap<ComputeEntry, Map<CallTier, Pack>>();

export function glHandles(e: ComputeEntry): Set<string> {
  const out = new Set<string>();
  for (const t of e.gl?.textures ?? []) {
    out.add(t.name);
    if (t.sampler !== null) out.add(t.sampler);
  }
  return out;
}

function callCpuProgram(e: ComputeEntry, cpu: GeneratedCpu): CpuProgram {
  return {
    code: cpu as unknown as CpuCode,
    entries: {
      [e.entryPoint ?? e.fn]: {
        fn: e.fn,
        stage: 'compute',
        params: e.params.map((builtin) => ({
          kind: 'field' as const,
          field: { name: builtin, builtin },
        })),
        workgroupSize: e.wg,
      },
    },
    bindings: e.bindings.filter(isBuffer).map((b) => ({
      name: b.name,
      group: b.group,
      binding: b.binding,
      layout: packLayout(b.layout),
      kind: b.space,
    })),
    workgroupZero: e.workgroupZero,
  };
}

export function callManifestOf(e: ComputeEntry, tier: CallTier, cpu?: GeneratedCpu): Pack {
  let byTier = manifests.get(e);
  if (byTier === undefined) manifests.set(e, (byTier = new Map()));
  const hit = byTier.get(tier);
  if (hit !== undefined) return hit;
  const gl = tier === 'webgl2';
  const handles = gl ? glHandles(e) : undefined;
  const reached = e.bindings.filter((b) =>
    tier === 'cpu' ? isBuffer(b) : gl ? isBuffer(b) || isGuard(b) || handles!.has(b.name) : true,
  );
  const bindings = reached.map((b): PackBinding => {
    const p = packBindingOf(b, 'compute', gl ? b.name : slotOf(b));
    return gl && isBuffer(b) && b.space === 'uniform' ? { ...p, layout: packLayout(b.layout) } : p;
  });
  const entry: PackEntry = {
    name: e.name,
    emitted: e.entryPoint ?? e.fn,
    stage: 'compute',
    workgroupSize: e.wg,
    bindings: reached.map((b, i) => ({
      name: bindings[i]!.name,
      writes: isBuffer(b) && b.writes,
    })),
  };
  let console: PackConsole | undefined;
  if (tier === 'webgpu' && e.log !== undefined) {
    const slot: PackBinding = {
      name: '_console',
      emitted: '_console',
      space: 'storage',
      group: e.log.group,
      binding: e.log.binding,
      access: 'read_write',
      type: 'array<u32>',
      stages: ['compute'],
      resource: { resourceKind: 'storage-buffer' },
      injected: true,
    };
    console = { wgsl: e.wgsl, log: e.log, bindings: [...bindings, slot] };
  }
  const m: Pack = {
    schema: PACK_SCHEMA,
    compiler: VERSION,
    wgsl: e.wgsl,
    bindings,
    entries: [entry],
    structs: [],
    overrides: [],
    features: [],
    ...(console !== undefined ? { console } : {}),
    ...(gl && e.gl !== undefined ? { gl: { computes: { [e.name]: e.gl } } } : {}),
  };
  if (tier === 'cpu') (m as { [CPU_PROGRAM]?: CpuProgram })[CPU_PROGRAM] = callCpuProgram(e, cpu!);
  byTier.set(tier, m);
  return m;
}
