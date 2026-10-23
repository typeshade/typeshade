// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Instance requirements negotiate on their own adapter and only inspect supplied devices (0085).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevice } from './device.js';
import { createRuntime } from './runtime.js';
import { requestedDevice, setRequestedDevice } from '../core/host-entry.js';

interface Request {
  requiredLimits?: Readonly<Record<string, number>>;
  requiredFeatures?: readonly string[];
}

function native(limits: Record<string, number> = {}, features: readonly string[] = []) {
  return {
    limits,
    features: new Set(features),
    queue: { onSubmittedWorkDone: async () => {} },
    lost: new Promise<never>(() => {}),
    destroy: vi.fn(),
  };
}

function adapter() {
  const devices: ReturnType<typeof native>[] = [];
  const requestDevice = vi.fn(async (request?: Request) => {
    const device = native(
      { maxBufferSize: 256, minStorageBufferOffsetAlignment: 256, ...request?.requiredLimits },
      request?.requiredFeatures,
    );
    devices.push(device);
    return device;
  });
  const value = {
    limits: { maxBufferSize: 4096, minStorageBufferOffsetAlignment: 64 },
    features: new Set(['shader-f16', 'timestamp-query']),
    requestDevice,
  };
  const requestAdapter = vi.fn(async () => value);
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  return { value, devices, requestDevice, requestAdapter };
}

afterEach(() => vi.unstubAllGlobals());

describe('instance requirements', () => {
  it('negotiates independent requirements without reading or changing the default request', async () => {
    const gpu = adapter();
    const previous = requestedDevice();
    const global = { limits: { maxBufferSize: 8192 }, features: ['default-only'] };
    setRequestedDevice(global);
    try {
      const a = await createDevice({
        prefer: ['webgpu'],
        limits: { maxBufferSize: 1024, minStorageBufferOffsetAlignment: 64 },
        features: ['shader-f16', 'shader-f16'],
      });
      const b = await createDevice({ prefer: ['webgpu'] });
      expect(gpu.requestDevice.mock.calls.map(([request]) => request)).toEqual([
        {
          requiredLimits: { maxBufferSize: 1024, minStorageBufferOffsetAlignment: 64 },
          requiredFeatures: ['shader-f16', 'timestamp-query'],
        },
        { requiredFeatures: ['timestamp-query'] },
      ]);
      expect(a.limits.maxBufferSize).toBe(1024);
      expect(a.info.webgpu?.features).toEqual(['shader-f16', 'timestamp-query']);
      expect(b.limits.maxBufferSize).toBe(256);
      expect(b.info.webgpu?.features).toEqual(['timestamp-query']);
      expect(requestedDevice()).toBe(global);
      await a.dispose();
      expect(gpu.devices[0]!.destroy).toHaveBeenCalledOnce();
      expect(gpu.devices[1]!.destroy).not.toHaveBeenCalled();
      await b.dispose();
    } finally {
      setRequestedDevice(previous);
    }
  });

  it('snapshots caller-owned limits and features before awaiting the adapter', async () => {
    const gpu = adapter();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    gpu.requestAdapter.mockImplementation(async () => {
      await wait;
      return gpu.value;
    });
    const limits = { maxBufferSize: 1024 };
    const features = ['shader-f16'];
    const pending = createDevice({ prefer: ['webgpu'], limits, features });
    limits.maxBufferSize = 8192;
    features.push('unsupported');
    release();
    const owner = await pending;
    expect(gpu.requestDevice).toHaveBeenCalledWith({
      requiredLimits: { maxBufferSize: 1024 },
      requiredFeatures: ['shader-f16', 'timestamp-query'],
    });
    await owner.dispose();
  });

  it('validates malformed requirements before requesting anything, including on CPU', async () => {
    const gpu = adapter();
    for (const options of [
      { limits: null },
      { limits: [] },
      { limits: { maxBufferSize: -1 } },
      { limits: { maxBufferSize: 1.5 } },
      { limits: { maxBufferSize: Infinity } },
      { limits: { minStorageBufferOffsetAlignment: 3 } },
      { limits: { maxStorageBufferBindingSize: 5 } },
      { features: null },
      { features: 'shader-f16' },
      { features: [42] },
    ]) {
      await expect(createDevice({ ...options, prefer: ['cpu'] } as never)).rejects.toThrow(
        TypeError,
      );
    }
    expect(gpu.requestAdapter).not.toHaveBeenCalled();
  });

  it.each([
    [{ maxBufferSize: 8192 }, [], 'supports maxBufferSize'],
    [{ minStorageBufferOffsetAlignment: 32 }, [], 'down to 64'],
    [{ missingLimit: 1 }, [], 'not a limit this adapter reports'],
    [{}, ['unsupported'], 'lacks the "unsupported" feature'],
  ] as const)(
    'follows the owner fallback policy for unavailable requirements: %j %j',
    async (limits, features, reason) => {
      const gpu = adapter();
      const owner = await createDevice({ prefer: ['webgpu', 'cpu'], limits, features });
      expect(owner.tier).toBe('cpu');
      expect(owner.skipped).toEqual([{ tier: 'webgpu', reason: expect.stringContaining(reason) }]);
      expect(gpu.requestDevice).not.toHaveBeenCalled();
      await expect(createDevice({ prefer: ['webgpu'], limits, features })).rejects.toThrow(reason);
      await owner.dispose();
    },
  );

  it('reports a native request failure before trying the next allowed tier', async () => {
    const gpu = adapter();
    gpu.requestDevice.mockRejectedValue(new Error('device allocation failed'));
    const owner = await createDevice({ prefer: ['webgpu', 'cpu'] });
    expect(owner.tier).toBe('cpu');
    expect(owner.skipped).toEqual([{ tier: 'webgpu', reason: 'device allocation failed' }]);
    await owner.dispose();
  });
});

describe('supplied capabilities', () => {
  it('checks enabled features and prototype limits without requesting or destroying the host device', async () => {
    const gpu = adapter();
    const device = native(
      Object.create({ maxBufferSize: 1024, minStorageBufferOffsetAlignment: 64 }) as Record<
        string,
        number
      >,
      ['shader-f16'],
    );
    const options = {
      limits: { maxBufferSize: 512, minStorageBufferOffsetAlignment: 256 },
      features: ['shader-f16'],
    };
    const a = await createDevice({ device, ...options });
    const runtime = await createRuntime({ device });
    const b = await createDevice({ runtime, ...options });
    expect(a.limits.maxBufferSize).toBe(1024);
    expect(b.info.webgpu?.features).toEqual(['shader-f16']);
    await a.dispose();
    await b.dispose();
    expect(device.destroy).not.toHaveBeenCalled();
    expect(gpu.requestAdapter).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it.each([
    [{ maxBufferSize: 2048 }, [], 'has maxBufferSize 1024'],
    [{ minStorageBufferOffsetAlignment: 32 }, [], 'has minStorageBufferOffsetAlignment 64'],
    [{ missingLimit: 1 }, [], 'not a limit this device reports'],
    [{}, ['supported-but-not-enabled'], 'has not enabled "supported-but-not-enabled"'],
  ] as const)(
    'refuses missing capabilities in either supplied source: %j %j',
    async (limits, features, reason) => {
      const gpu = adapter();
      const device = native({ maxBufferSize: 1024, minStorageBufferOffsetAlignment: 64 });
      for (const source of [{ device }, { runtime: { device } }])
        await expect(createDevice({ ...source, limits, features })).rejects.toThrow(reason);
      expect(gpu.requestAdapter).not.toHaveBeenCalled();
      expect(device.destroy).not.toHaveBeenCalled();
    },
  );
});
