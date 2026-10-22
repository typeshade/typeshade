// Shared override validation for program pipelines and imported compute-entry calls (0084).
// No compiler or runtime code generation reaches this module.

import { describe } from './host-entry.js';
import type { Pack, PackEntry, PackOverride } from './manifest-types.js';

/** The line an entry or a binding is declared on, for a refusal: ` (brick.shade.ts:12)`. */
export const at = (e: { readonly line?: PackEntry['line'] } | undefined): string =>
  e?.line === undefined ? '' : ` (${e.line.file.split(/[\\/]/).pop()}:${e.line.line})`;

/** The largest magnitude an `f32` holds; WebGPU refuses an override value past it. */
const F32_MAX = 3.4028234663852886e38;

/** What WebGPU's `constants` takes for `v`, the value given for the override `o`: a number, 0 or 1
 *  for a `bool`. A value the override's type cannot hold is a `TypeError` that says what the type
 *  takes. WebGPU would report a validation error that names nothing of the source, or convert the
 *  value silently: a fraction to an `i32`, a string, `true`. */
function constantOf(o: PackOverride, v: unknown): number {
  const int = o.type === 'i32' || o.type === 'u32';
  const lo = o.type === 'u32' ? 0 : int ? -0x80000000 : -F32_MAX;
  const hi = o.type === 'u32' ? 0xffffffff : int ? 0x7fffffff : F32_MAX;
  if (o.type === 'bool') {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' && Number.isFinite(v)) return v === 0 ? 0 : 1;
  } else if (typeof v === 'number' && v >= lo && v <= hi && (!int || Number.isInteger(v)))
    // An integer has no -0. An f32 keeps it, which the cache's key tells from 0.
    return int ? v || 0 : v;
  const takes =
    o.type === 'bool'
      ? 'a boolean or a finite number, where 0 is false'
      : int
        ? `a whole number from ${lo} to ${hi}`
        : `a finite number no larger than ${F32_MAX} in magnitude`;
  throw new TypeError(
    `The override "${o.name}" (${o.type}) takes ${takes}; got ${v === undefined ? 'undefined' : describe(v)}.`,
  );
}

/** The override values a pipeline is created with, checked against the manifest's `overrides`:
 *  what WebGPU's `constants` takes, in the order the program declares its overrides, and the
 *  cache's key, so the same values give one pipeline whatever order or spelling the host used.
 *  `undefined` when the host gives none. A name the program does not declare, and a value its
 *  type cannot hold, are a `TypeError` (WebGPU's own error names nothing of the source). */
export function constantsOf(
  manifest: Pick<Pack, 'overrides'>,
  given: Readonly<Record<string, number | boolean>> | undefined,
): { readonly values: Record<string, number>; readonly key: string } | undefined {
  if (given === undefined) return undefined;
  if (typeof given !== 'object' || given === null || Array.isArray(given))
    throw new TypeError(
      `The constants are ${describe(given)}, not an object of override names and values.`,
    );
  const declared = manifest.overrides;
  const undeclared = Object.keys(given).find((n) => !declared.some((o) => o.name === n));
  if (undeclared !== undefined)
    throw new TypeError(
      `The program has no override "${undeclared}"; its overrides are ${declared.map((o) => `"${o.name}" (${o.type})`).join(', ') || 'none'}.`,
    );
  const values: Record<string, number> = {};
  let key = '';
  for (const o of declared) {
    if (!Object.hasOwn(given, o.name)) continue;
    const v = (values[o.name] = constantOf(o, given[o.name]));
    key += `${o.name}=${Object.is(v, -0) ? '-0' : v};`;
  }
  return key === '' ? undefined : { values, key };
}

/** The override values as WebGPU takes them: each authored name keyed by the name the WGSL
 *  declares (`emitted`, Proposal 0070). The values keep the authored names; only the key moves. */
export function wgslConstants(
  manifest: Pick<Pack, 'overrides'>,
  values: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    const o = manifest.overrides.find((x) => x.name === name);
    out[o?.emitted ?? name] = value;
  }
  return out;
}

/** Resolve an entry's workgroup dimensions with the values supplied to pipeline creation. */
export function specializedWorkgroupShape(
  e: Pick<PackEntry, 'workgroupSize' | 'workgroupSizeOverrides'>,
  values: Readonly<Record<string, number>> = {},
): readonly [number, number, number] {
  const defaults = e.workgroupSize ?? [64, 1, 1];
  const names = e.workgroupSizeOverrides;
  return [0, 1, 2].map((axis) => {
    const name = names?.[axis];
    return name == null ? defaults[axis]! : (values[name] ?? defaults[axis]!);
  }) as [number, number, number];
}

export function checkWorkgroupShape(
  limits: Readonly<Record<string, number>>,
  e: { readonly name: string; readonly line?: PackEntry['line'] },
  shape: readonly [number, number, number],
): void {
  const maxima = [
    limits.maxComputeWorkgroupSizeX ?? 256,
    limits.maxComputeWorkgroupSizeY ?? 256,
    limits.maxComputeWorkgroupSizeZ ?? 64,
  ];
  for (let axis = 0; axis < 3; axis++) {
    const value = shape[axis]!;
    if (!Number.isInteger(value) || value <= 0 || value > maxima[axis]!)
      throw new TypeError(
        `"${e.name}"${at(e)}: workgroup shape [${shape.join(', ')}] has an invalid ${'xyz'[axis]} dimension; this device allows 1 to ${maxima[axis]}.`,
      );
  }
  const invocations = shape[0] * shape[1] * shape[2];
  const maxInvocations = limits.maxComputeInvocationsPerWorkgroup ?? 256;
  if (invocations > maxInvocations)
    throw new TypeError(
      `"${e.name}"${at(e)}: workgroup shape [${shape.join(', ')}] has ${invocations} invocations; this device allows ${maxInvocations}.`,
    );
}
