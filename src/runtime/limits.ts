// The device's limits, as the program runtime reports them (change 0051, part 2, Rule 11.11).
// A `GPUSupportedLimits` keeps its attributes as accessors on its prototype (WebIDL), so an
// object spread copies none of them. `for…in` lists inherited enumerable properties, so it does.

import type { Pack, PackBinding, PackEntry } from '../core/manifest-types.js';
import { STAGE } from './gpu.js';

/** Copy every numeric limit of a WebGPU `limits` object into a new frozen record keyed by
 *  WebGPU's names. The copy is taken once: a device's limits do not change after it is made. */
export function copyLimits(source: object | undefined): Readonly<Record<string, number>> {
  const copy: Record<string, number> = {};
  if (source !== undefined) {
    for (const name in source) {
      const value: unknown = (source as Record<string, unknown>)[name];
      if (typeof value === 'number') copy[name] = value;
    }
  }
  return Object.freeze(copy);
}

/** The limits WebGPU holds to a multiple of 4 (change 0051, R1). */
const MULTIPLE_OF_FOUR = new Set([
  'maxStorageBufferBindingSize',
  'maxVertexBufferArrayStride',
  'maxImmediateSize',
]);

/** A limit whose request must not fall below the adapter's value: the offset alignments. A
 *  name that starts with `min` is one (change 0051, requesting step 6). */
export function isMinimumLimit(name: string): boolean {
  return name.startsWith('min');
}

/** Refuse a value `createRuntime({ limits })` names that WebGPU cannot take (change 0051, R1).
 *  Throws a `TypeError` that names the limit and the value. */
export function checkLimitValues(limits: Readonly<Record<string, number>>): void {
  for (const name of Object.keys(limits)) {
    const value = limits[name]!;
    if (!Number.isInteger(value) || value < 0)
      throw new TypeError(
        `createRuntime({ limits }): ${name} takes a whole number of 0 or more; got ${String(value)}.`,
      );
    if (isMinimumLimit(name) && name.endsWith('Alignment')) {
      let power = 1;
      while (power < value) power *= 2;
      if (value === 0 || power !== value || value >= 2 ** 32)
        throw new TypeError(
          `createRuntime({ limits }): ${name} takes a power of 2 below 2^32; got ${value}.`,
        );
    } else if (MULTIPLE_OF_FOUR.has(name) && value % 4 !== 0) {
      throw new TypeError(
        `createRuntime({ limits }): ${name} takes a multiple of 4; got ${value}.`,
      );
    }
  }
}

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

/** The limits one entry needs, from the bindings it reaches (change 0051, the derivation table).
 *  A render pipeline needs the larger of its entries' needs, so each entry is derived alone. */
function needOfEntry(program: Pack, entry: PackEntry, records: boolean): Record<string, number> {
  const bindings = new Map(program.bindings.map((b) => [b.name, b]));
  if (records && !bindings.has('_console')) {
    // The console pass places `_console` one past the highest binding of group 0 it reaches.
    const reached = selectBindings([entry], bindings, false).visibility;
    let top = -1;
    for (const name of reached.keys()) {
      const b = bindings.get(name);
      if (b !== undefined && b.group === 0) top = Math.max(top, b.binding);
    }
    bindings.set('_console', {
      name: '_console',
      space: 'storage',
      group: 0,
      binding: top + 1,
      type: 'array<u32>',
      stages: [],
      resource: { resourceKind: 'storage-buffer' },
      injected: true,
    } as PackBinding);
  }
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
  return need;
}

/** The limits the programs need, each the largest need of any entry, with zero needs left out
 *  (change 0051, requesting steps 4 and 5). The caller caps each value at the adapter's. */
export function deriveLimits(programs: readonly Pack[], emit: boolean): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const program of programs) {
    const records = canRecord(program, emit);
    for (const entry of program.entries)
      for (const [name, value] of Object.entries(needOfEntry(program, entry, records)))
        merged[name] = Math.max(merged[name] ?? 0, value);
  }
  return merged;
}
