// The derivation of the limits a program needs (change 0051, part 1, Rule 11.11). The helpers the
// device's limits need are in `core/device-limits.ts`.

import type { Pack, PackBinding, PackEntry } from '../core/manifest-types.js';
import { checkLimitValues, copyLimits, isMinimumLimit } from '../core/device-limits.js';
import { STAGE } from './gpu.js';

export { checkLimitValues, copyLimits, isMinimumLimit };

/** The bindings an entry set reaches, each with the stage bits that reach it, and the recorder
 *  entry the console buffer goes to (`#shape` in `program.ts` lays out what this selects). The
 *  console buffer is selected when `records` is set and `bindings` holds `_console`. */
export function selectBindings(
  entries: readonly PackEntry[],
  bindings: ReadonlyMap<string, PackBinding>,
  records: boolean,
): { visibility: Map<string, number>; recorder?: PackEntry } {
  const visibility = new Map<string, number>();
  for (const e of entries)
    for (const b of e.bindings ?? [])
      visibility.set(b.name, (visibility.get(b.name) ?? 0) | STAGE[e.stage as keyof typeof STAGE]);
  let recorder: PackEntry | undefined;
  if (records && bindings.has('_console')) {
    recorder = entries.find((e) => e.stage === 'compute' || e.stage === 'fragment');
    if (recorder !== undefined)
      visibility.set('_console', STAGE[recorder.stage as keyof typeof STAGE]);
  }
  return recorder === undefined ? { visibility } : { visibility, recorder };
}

/** Whether a program can record: it carries its recorded variant (`console`), or its IR and the
 *  host gives an emitter (change 0051, "A program that can record"). */
export function canRecord(program: Pack, emit: boolean): boolean {
  return program.console !== undefined || (emit && program.ir !== undefined);
}

/** The bindings a program's entries are laid out with: its own, and for a program that records
 *  with no `_console` in them, the console buffer and the `_fp64` guard placed as the console
 *  pass places them (change 0051, "One authority"). The console pass puts `_console` one past
 *  the highest binding of group 0 in the module, the guard `fp64Lower` injects one past that.
 *  The guard is not counted in the highest binding, since the pass runs before it is injected. */
export function bindingsOf(program: Pack, records: boolean): Map<string, PackBinding> {
  const bindings = new Map(program.bindings.map((b) => [b.name, b]));
  if (!records || bindings.has('_console')) return bindings;
  let top = -1;
  for (const b of program.bindings)
    if (b.group === 0 && b.name !== '_fp64') top = Math.max(top, b.binding);
  const slot = top + 1;
  bindings.set('_console', {
    name: '_console',
    emitted: '_console',
    space: 'storage',
    group: 0,
    binding: slot,
    type: 'array<u32>',
    stages: [],
    resource: { resourceKind: 'storage-buffer' },
    injected: true,
  } as PackBinding);
  const guard = bindings.get('_fp64');
  if (guard !== undefined && guard.group === 0)
    bindings.set('_fp64', { ...guard, binding: slot + 1 });
  return bindings;
}

/** The need of one entry, by limit, and whether the count of storage buffers includes the console
 *  buffer. `bindings` is the map `bindingsOf` returns. */
export function needOfEntry(
  bindings: ReadonlyMap<string, PackBinding>,
  entry: PackEntry,
  records: boolean,
): { need: Record<string, number>; console: boolean } {
  const { visibility } = selectBindings([entry], bindings, records);
  const need: Record<string, number> = {};
  let maxGroup = -1;
  let maxBinding = -1;
  for (const name of visibility.keys()) {
    const b = bindings.get(name);
    if (b === undefined) continue;
    maxGroup = Math.max(maxGroup, b.group);
    maxBinding = Math.max(maxBinding, b.binding);
    const kind = {
      'storage-buffer': 'maxStorageBuffersPerShaderStage',
      'uniform-buffer': 'maxUniformBuffersPerShaderStage',
      texture: 'maxSampledTexturesPerShaderStage',
      sampler: 'maxSamplersPerShaderStage',
      'storage-texture': 'maxStorageTexturesPerShaderStage',
    }[b.resource.resourceKind];
    need[kind] = (need[kind] ?? 0) + 1;
  }
  if (maxGroup >= 0) {
    need.maxBindGroups = maxGroup + 1;
    need.maxBindingsPerBindGroup = maxBinding + 1;
  }
  if (entry.stage === 'compute' && entry.workgroupSize !== undefined) {
    const [x, y, z] = entry.workgroupSize;
    need.maxComputeWorkgroupSizeX = x;
    need.maxComputeWorkgroupSizeY = y;
    need.maxComputeWorkgroupSizeZ = z;
    need.maxComputeInvocationsPerWorkgroup = x * y * z;
  }
  return { need, console: visibility.has('_console') };
}

/** The limits the pipeline check holds (change 0051, R4): the derived table without the four
 *  workgroup limits, which `checkWorkgroupShape` refuses (decision 14). */
export const PIPELINE_LIMITS = [
  'maxStorageBuffersPerShaderStage',
  'maxUniformBuffersPerShaderStage',
  'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxBindGroups',
  'maxBindingsPerBindGroup',
] as const;

/** The limits the programs need, each the largest need of any entry, with zero needs left out
 *  (change 0051, requesting steps 4 and 5). The caller caps each value at the adapter's. */
export function deriveLimits(programs: readonly Pack[], emit: boolean): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const program of programs) {
    const records = canRecord(program, emit);
    const bindings = bindingsOf(program, records);
    for (const entry of program.entries)
      for (const [name, value] of Object.entries(needOfEntry(bindings, entry, records).need))
        merged[name] = Math.max(merged[name] ?? 0, value);
  }
  return merged;
}
