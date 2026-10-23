// Local snapshots of the opened device, never of an unrelated probe (change 0083).
import { buildInfo, type TypeShadeBuildInfo } from './build-info.js';
import { copyLimits } from './device-limits.js';
import { recommendFp64Flavor } from './fp64/flavor-select.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import type { Tier } from './tiers.js';

/** Frozen, JSON-serializable historical metadata of an opened device. It remains readable after
 * loss or disposal and does not identify the effective tier of an individual call.
 * Exported from `typeshade` and `typeshade/runtime` (change 0083). */
export interface DeviceInfo {
  readonly build: TypeShadeBuildInfo;
  readonly tier: Tier;
  /** Identity from the actual WebGPU device or its retained creation adapter. Features and limits
   * describe the enabled device, never the adapter's supported maxima. `null` on other tiers. */
  readonly webgpu: {
    readonly provenance: 'device' | 'adapter' | 'unavailable';
    readonly vendor: string | null;
    readonly architecture: string | null;
    readonly device: string | null;
    readonly description: string | null;
    readonly fallback: boolean | null;
    readonly features: readonly string[];
    readonly limits: Readonly<Record<string, number>>;
  } | null;
  /** Strings from the actual WebGL2 context. Debug strings remain null when unavailable or
   * redacted. This section never attributes a WebGL probe to a WebGPU device. */
  readonly webgl: {
    readonly vendor: string | null;
    readonly renderer: string | null;
    readonly unmaskedVendor: string | null;
    readonly unmaskedRenderer: string | null;
  } | null;
}

type Identity = Omit<NonNullable<DeviceInfo['webgpu']>, 'features' | 'limits'>;
const adapters = new WeakMap<object, Identity>();
const flavors = new WeakMap<object, Fp64Flavor>();

/** Resolve once from the device actually used, without requesting an unrelated adapter (0085).
 * A supplied snapshot avoids rereading metadata while an owner is being constructed. */
export function automaticFp64Flavor(
  tier: Tier,
  native?: object | null,
  snapshot?: DeviceInfo,
): Fp64Flavor {
  if (tier === 'cpu') return 'float';
  const cached = native == null ? undefined : flavors.get(native);
  if (cached !== undefined) return cached;
  const info = snapshot ?? deviceInfo(tier, native);
  const retained = native == null ? undefined : adapters.get(native);
  const flavor = recommendFp64Flavor({
    adapterInfo: {
      vendor: info.webgpu?.vendor ?? retained?.vendor ?? undefined,
      architecture: info.webgpu?.architecture ?? retained?.architecture ?? undefined,
    },
    rendererString: `${info.webgl?.renderer ?? ''} ${info.webgl?.unmaskedRenderer ?? ''}`,
    userAgent: read(() => globalThis.navigator?.userAgent),
  });
  if (native != null) flavors.set(native, flavor);
  return flavor;
}

/** Optional browser metadata must not prevent opening an otherwise usable device. */
function read<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

function field(value: object | undefined, key: string): unknown {
  return read(() => (value as Record<string, unknown> | undefined)?.[key]);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function identity(
  value: unknown,
  provenance: Identity['provenance'],
  fallback?: unknown,
): Identity {
  const info = typeof value === 'object' && value !== null ? value : undefined;
  const reported = field(info, 'isFallbackAdapter');
  return Object.freeze({
    provenance: info === undefined ? 'unavailable' : provenance,
    vendor: text(field(info, 'vendor')),
    architecture: text(field(info, 'architecture')),
    device: text(field(info, 'device')),
    description: text(field(info, 'description')),
    fallback:
      typeof reported === 'boolean' ? reported : typeof fallback === 'boolean' ? fallback : null,
  });
}

/** Retain only copied metadata of the adapter that actually created this device. */
export function retainAdapter(device: object, adapter: object): void {
  adapters.set(
    device,
    identity(field(adapter, 'info'), 'adapter', field(adapter, 'isFallbackAdapter')),
  );
}

/** A snapshot of one owner. Reading it later performs no browser operation. */
export function deviceInfo(tier: Tier, native?: object | null): DeviceInfo {
  let webgpu: DeviceInfo['webgpu'] = null;
  let webgl: DeviceInfo['webgl'] = null;
  if (tier === 'webgpu') {
    const supplied = field(native ?? undefined, 'adapterInfo');
    const retained = native == null ? undefined : adapters.get(native);
    const id =
      supplied !== null && typeof supplied === 'object'
        ? identity(supplied, 'device', retained?.fallback)
        : (retained ?? identity(undefined, 'unavailable'));
    const features =
      read(() =>
        Array.from((field(native ?? undefined, 'features') ?? []) as Iterable<unknown>)
          .filter((f): f is string => typeof f === 'string')
          .sort(),
      ) ?? [];
    const limits =
      read(() => copyLimits(field(native ?? undefined, 'limits') as object | undefined)) ??
      Object.freeze({});
    webgpu = Object.freeze({ ...id, features: Object.freeze(features), limits });
  } else if (tier === 'webgl2' && native != null) {
    const gl = native as WebGL2RenderingContext;
    const debug = read(() => gl.getExtension('WEBGL_debug_renderer_info'));
    const parameter = (name: number | undefined): string | null =>
      name === undefined ? null : text(read(() => gl.getParameter(name)));
    webgl = Object.freeze({
      vendor: parameter(read(() => gl.VENDOR)),
      renderer: parameter(read(() => gl.RENDERER)),
      unmaskedVendor: parameter(read(() => debug?.UNMASKED_VENDOR_WEBGL)),
      unmaskedRenderer: parameter(read(() => debug?.UNMASKED_RENDERER_WEBGL)),
    });
  }
  return Object.freeze({ build: buildInfo, tier, webgpu, webgl });
}
