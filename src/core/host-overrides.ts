// Imported-entry specializations (0084). A variant is an entry object, so the existing
// per-device pipeline cache and the fp64-flavor cache keep their usual ownership.
import { copy, describe, type ComputeEntry, type GeneratedCpu } from './host-entry.js';
import {
  constantsOf,
  wgslConstants,
  specializedWorkgroupShape,
  checkWorkgroupShape,
} from './overrides.js';
import { glslOverrideNames, pinOverrides } from './gl-overrides.js';
import type { CpuValue } from './cpu-runtime.js';

const variants = /*#__PURE__*/ new WeakMap<ComputeEntry, Map<string, ComputeEntry>>();
const cpus = /*#__PURE__*/ new WeakMap<ComputeEntry, { cpu: GeneratedCpu; entry: ComputeEntry }>();

/** Validate and snapshot options when the host makes the call, before a scope records work. */
export function specializeEntry(e: ComputeEntry, options: unknown): ComputeEntry {
  if (options === undefined) return e;
  if (typeof options !== 'object' || options === null || Array.isArray(options))
    throw new TypeError(
      `${e.name}(): options takes { constants: { NAME: value } }; got ${describe(options)}.`,
    );
  const extra = Object.keys(options).find((n) => n !== 'constants');
  if (extra !== undefined)
    throw new TypeError(`${e.name}(): options has no "${extra}"; use "constants".`);
  const manifest = { overrides: e.overrides ?? [] };
  const constants = constantsOf(
    manifest,
    (options as { constants?: Readonly<Record<string, number | boolean>> }).constants,
  );
  if (constants === undefined) return e;
  let per = variants.get(e);
  if (per === undefined) variants.set(e, (per = new Map()));
  let v = per.get(constants.key);
  if (v === undefined) {
    const wg = specializedWorkgroupShape(
      { workgroupSize: e.wg, workgroupSizeOverrides: e.workgroupSizeOverrides },
      constants.values,
    );
    // Device maxima are checked when the owner is known. Invalid extents are refused now,
    // without allocating a workgroup array or accepting any work into the queue.
    checkWorkgroupShape(
      {
        maxComputeWorkgroupSizeX: 0xffffffff,
        maxComputeWorkgroupSizeY: 0xffffffff,
        maxComputeWorkgroupSizeZ: 0xffffffff,
        maxComputeInvocationsPerWorkgroup: Number.MAX_SAFE_INTEGER,
      },
      e,
      wg,
    );
    const changed = wg.some((n, i) => n !== e.wg[i]);
    const resized = (e.workgroupVars ?? []).some(
      (w) =>
        w.override !== undefined &&
        constants.values[w.override] !== undefined &&
        constants.values[w.override] !== (e.workgroupZero[w.name] as readonly CpuValue[]).length,
    );
    v = {
      ...e,
      wg,
      constants: wgslConstants(manifest, constants.values),
      overrideValues: constants.values,
      ...(changed || resized
        ? {
            gl: undefined,
            noGl: changed
              ? `WebGL2 supports only the declared default [${e.wg.join(', ')}]; selected workgroup shape [${wg.join(', ')}]`
              : 'WebGL2 supports only the declared default workgroup-array lengths',
          }
        : e.gl === undefined
          ? {}
          : {
              gl: {
                ...e.gl,
                vertex: pinOverrides(e.gl.vertex, constants.values, glslOverrideNames(manifest)),
              },
            }),
    };
    // An array override need not appear in @workgroup_size. Validate it independently.
    workgroupBytes(v);
    per.set(constants.key, v);
  }
  return v;
}

function lengthOf(e: ComputeEntry, name: string, override: string): number {
  const n = e.overrideValues?.[override] ?? (e.workgroupZero[name] as readonly CpuValue[]).length;
  if (!Number.isInteger(n) || n < 1)
    throw new TypeError(
      `${e.name}(): workgroup-array override "${override}" must be a positive integer; got ${n}.`,
    );
  return n;
}

/** WebGPU counts each workgroup allocation rounded up to 16 bytes. */
function workgroupBytes(e: ComputeEntry): number {
  let total = 0;
  for (const v of e.workgroupVars ?? []) {
    const bytes =
      v.override === undefined
        ? v.size
        : (v.size / (e.workgroupZero[v.name] as readonly CpuValue[]).length) *
          lengthOf(e, v.name, v.override);
    total += Math.ceil(bytes / 16) * 16;
  }
  return total;
}

/** Apply an owner's actual limits before buffer uploads or pipeline creation. The CPU tier
 *  uses WebGPU's portable minima, which also bounds allocation of specialized zero arrays. */
export function checkEntryLimits(
  e: ComputeEntry,
  limits: Readonly<Record<string, number>> = {},
): void {
  checkWorkgroupShape(limits, e, e.wg);
  const bytes = workgroupBytes(e),
    most = limits.maxComputeWorkgroupStorageSize ?? 16384;
  if (bytes > most)
    throw new TypeError(
      `${e.name}(): workgroup storage needs ${bytes} bytes; this device allows ${most}.`,
    );
}

/** Select pre-generated CPU closures and resize reachable workgroup zeros only on the CPU
 *  tier, after its allocation limit was checked. The authored defaults keep their own module. */
export function cpuSpecialization(
  cpu: GeneratedCpu,
  e: ComputeEntry,
): { cpu: GeneratedCpu; entry: ComputeEntry } {
  if (e.overrideValues === undefined) return { cpu, entry: e };
  let v = cpus.get(e);
  if (v === undefined) {
    if (cpu.specialize === undefined)
      throw new TypeError(
        `${e.name}(): this host module has no generated CPU override factory; rebuild it with this compiler.`,
      );
    const values: Record<string, number | boolean> = { ...e.overrideValues };
    for (const o of e.overrides ?? [])
      if (o.type === 'bool' && Object.hasOwn(values, o.name)) values[o.name] = values[o.name] !== 0;
    const zero = { ...e.workgroupZero };
    for (const w of e.workgroupVars ?? [])
      if (w.override !== undefined)
        zero[w.name] = Array.from({ length: lengthOf(e, w.name, w.override) }, () =>
          copy((e.workgroupZero[w.name] as readonly CpuValue[])[0]!),
        ) as CpuValue;
    v = { cpu: cpu.specialize(values), entry: { ...e, workgroupZero: zero } };
    cpus.set(e, v);
  }
  return v;
}
