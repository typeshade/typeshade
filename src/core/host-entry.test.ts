// The call layer's device (change 0051, Rule 11.8 and Rule 11.13 F5): `configure({ limits,
// features })` asks for it, `callDevice()` reports it, and the refusals C1 to C4 hold. The device
// is cached per module instance, so each test loads fresh modules and stubs `navigator.gpu`.

import { afterEach, describe, expect, it, vi } from 'vitest';

type Limits = Record<string, number>;

interface StubOptions {
  /** The adapter's limits, by WebGPU's names. */
  readonly limits?: Limits;
  /** The adapter's features; the adapter has no `features` when left out. */
  readonly features?: readonly string[];
}

/** Stub `navigator.gpu` with an adapter. Its device takes what `requestDevice` asks for: each
 *  required limit, and the required features. Returns the descriptors the adapter received. */
function stubGpu(options: StubOptions) {
  const requests: unknown[] = [];
  const adapter = {
    limits: options.limits,
    features: options.features === undefined ? undefined : new Set<string>(options.features),
    requestDevice: async (d?: { requiredFeatures?: string[]; requiredLimits?: Limits }) => {
      requests.push(d);
      return {
        limits: { maxStorageBuffersPerShaderStage: 8, ...(d?.requiredLimits ?? {}) },
        features: new Set<string>(d?.requiredFeatures ?? []),
        lost: new Promise<never>(() => {}),
      };
    },
  };
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => adapter } });
  return requests;
}

/** The modules of one test: a call layer no other test has asked for a device. */
async function fresh() {
  vi.resetModules();
  const resident = await import('./resident.js');
  const host = await import('./host-entry.js');
  return { configure: resident.configure, ...host };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('configure({ limits, features }) asks the call layer for its device (proposal 0051)', () => {
  it('requests the limits and the features it names, and timestamp-query when the adapter has it', async () => {
    const requests = stubGpu({
      limits: { maxStorageBuffersPerShaderStage: 12 },
      features: ['timestamp-query', 'shader-f16'],
    });
    const { configure, callDevice } = await fresh();
    configure({ limits: { maxStorageBuffersPerShaderStage: 12 }, features: ['shader-f16'] });
    const report = await callDevice();
    expect(requests).toEqual([
      {
        requiredFeatures: ['shader-f16', 'timestamp-query'],
        requiredLimits: { maxStorageBuffersPerShaderStage: 12 },
      },
    ]);
    expect(report).toEqual({
      limits: { maxStorageBuffersPerShaderStage: 12 },
      features: ['shader-f16', 'timestamp-query'],
    });
  });

  it('requests no descriptor, and never fails, when nothing is named and the adapter has no timestamps', async () => {
    const requests = stubGpu({ limits: { maxStorageBuffersPerShaderStage: 12 }, features: [] });
    const { callDevice } = await fresh();
    const report = await callDevice();
    expect(requests).toEqual([undefined]);
    expect(report?.limits.maxStorageBuffersPerShaderStage).toBe(8);
    expect(report?.features).toEqual([]);
  });

  it('reports the device with its limits frozen, and no report with no WebGPU', async () => {
    stubGpu({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    const { callDevice } = await fresh();
    const report = await callDevice();
    expect(Object.isFrozen(report?.limits)).toBe(true);
    expect(Object.isFrozen(report?.features)).toBe(true);
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', {});
    const none = await (await fresh()).callDevice();
    expect(none).toBeNull();
  });
});

describe('the refusals of the call layer (C1 to C4)', () => {
  it('C1: refuses a wrong value when configure runs, and names configure({ limits })', async () => {
    stubGpu({});
    const { configure } = await fresh();
    expect(() => configure({ limits: { maxBufferSize: 1.5 } })).toThrow(
      new TypeError(
        'configure({ limits }): maxBufferSize takes a whole number of 0 or more; got 1.5.',
      ),
    );
    expect(() => configure({ limits: { minUniformBufferOffsetAlignment: 48 } })).toThrow(
      new TypeError(
        'configure({ limits }): minUniformBufferOffsetAlignment takes a power of 2 below 2^32; got 48.',
      ),
    );
    expect(() => configure({ limits: { maxStorageBufferBindingSize: 134217730 } })).toThrow(
      new TypeError(
        'configure({ limits }): maxStorageBufferBindingSize takes a multiple of 4; got 134217730.',
      ),
    );
  });

  it("C2: rejects the first call that needs the device, with the adapter's limit, and requests nothing", async () => {
    const requests = stubGpu({ limits: { maxStorageBuffersPerShaderStage: 8 } });
    const { configure, callDevice } = await fresh();
    configure({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    await expect(callDevice()).rejects.toThrow(
      new Error(
        'The adapter supports maxStorageBuffersPerShaderStage up to 8; configure({ limits }) asks for 12.',
      ),
    );
    expect(requests).toHaveLength(0);
  });

  it('C2: rejects a limit the adapter does not report, and a feature it lacks', async () => {
    const requests = stubGpu({ limits: { maxStorageBuffersPerShaderStage: 8 }, features: [] });
    const { configure, callDevice } = await fresh();
    configure({ limits: { maxStorageBufferz: 1 } });
    await expect(callDevice()).rejects.toThrow(
      new Error('configure({ limits }): "maxStorageBufferz" is not a limit this adapter reports.'),
    );
    configure({ limits: {}, features: ['float32-filterable'] });
    await expect(callDevice()).rejects.toThrow(
      new Error(
        'The adapter lacks the "float32-filterable" feature that configure({ features }) asks for.',
      ),
    );
    expect(requests).toHaveLength(0);
  });

  it('C2: an alignment the adapter cannot give is refused "down to" its value', async () => {
    stubGpu({ limits: { minUniformBufferOffsetAlignment: 256 } });
    const { configure, callDevice } = await fresh();
    configure({ limits: { minUniformBufferOffsetAlignment: 128 } });
    await expect(callDevice()).rejects.toThrow(
      new Error(
        'The adapter supports minUniformBufferOffsetAlignment down to 256; configure({ limits }) asks for 128.',
      ),
    );
  });

  it('C2: a refused first request leaves no device, so a later configure and call request it again', async () => {
    const requests = stubGpu({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    const { configure, callDevice } = await fresh();
    configure({ limits: { maxStorageBuffersPerShaderStage: 16 } });
    await expect(callDevice()).rejects.toThrow('asks for 16.');
    configure({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    const report = await callDevice();
    expect(report?.limits.maxStorageBuffersPerShaderStage).toBe(12);
    expect(requests).toEqual([{ requiredLimits: { maxStorageBuffersPerShaderStage: 12 } }]);
  });

  it('C3: after the device exists, a different limit throws; the same value does not', async () => {
    stubGpu({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    const { configure, callDevice } = await fresh();
    await callDevice();
    configure({ limits: {} });
    expect(() => configure({ limits: { maxStorageBuffersPerShaderStage: 12 } })).toThrow(
      new TypeError(
        "configure({ limits }): the call layer's device exists with maxStorageBuffersPerShaderStage 8, and its limits cannot change. Set limits before the first call, or pass createRuntime({ limits }) to configure({ runtime }).",
      ),
    );
    expect(() => configure({ limits: {} })).not.toThrow();
  });

  it('C3: a feature change after the device exists throws, and prefer still changes', async () => {
    stubGpu({ limits: {}, features: ['shader-f16'] });
    const { configure, callDevice } = await fresh();
    configure({ features: ['shader-f16'] });
    await callDevice();
    expect(() => configure({ features: ['shader-f16'] })).not.toThrow();
    expect(() => configure({ features: [] })).toThrow(
      /features \[shader-f16\], and its features cannot change/,
    );
  });

  it('C4: with a runtime configured, limits and features throw, and the runtime is kept', async () => {
    stubGpu({});
    const { configure } = await fresh();
    configure({ runtime: { device: {} } });
    expect(() => configure({ limits: { maxBufferSize: 1 << 28 } })).toThrow(
      new TypeError(
        "configure({ limits }): a runtime is configured, and its device is the host's. Pass limits to createRuntime({ limits }).",
      ),
    );
    expect(() => configure({ features: ['shader-f16'] })).toThrow(TypeError);
    configure({ runtime: null });
    expect(() => configure({ limits: {} })).not.toThrow();
  });

  it('C4 does not apply to a call that names no limit or feature', async () => {
    stubGpu({});
    const { configure } = await fresh();
    configure({ runtime: { device: {} } });
    expect(() => configure({ prefer: ['cpu'] })).not.toThrow();
  });

  it('a refused configure changes nothing: the tiers stay as they were', async () => {
    stubGpu({});
    const { configure } = await fresh();
    const { preferredTiers } = await import('./resident.js');
    configure({ prefer: ['cpu'] });
    expect(() => configure({ prefer: ['webgpu'], limits: { maxBufferSize: -1 } })).toThrow(
      TypeError,
    );
    expect(preferredTiers()).toEqual(['cpu']);
  });
});

describe('the call layer device on the call path (Rule 11.13 F5)', () => {
  it('reads one device for every call: gpuDevice() and callDevice() share the request', async () => {
    const requests = stubGpu({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    const { configure, gpuDevice, callDevice } = await fresh();
    configure({ limits: { maxStorageBuffersPerShaderStage: 12 } });
    const [d, report] = await Promise.all([gpuDevice(), callDevice()]);
    expect(requests).toHaveLength(1);
    expect(d).not.toBeNull();
    expect(report?.limits.maxStorageBuffersPerShaderStage).toBe(12);
  });
});
