import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevice } from './device.js';
import { configure, residentState } from '../core/resident.js';

afterEach(() => {
  configure({ runtime: null });
  configure({});
  vi.unstubAllGlobals();
});

function orderedGpu(log: string[]) {
  const device = {
    limits: {},
    features: new Set<string>(),
    queue: { onSubmittedWorkDone: async () => {}, writeTexture: () => undefined },
    lost: new Promise<never>(() => {}),
    createTexture: (d: { size: number[]; format: string; usage: number }) => ({
      width: d.size[0],
      height: d.size[1],
      format: d.format,
      usage: d.usage,
      createView: () => ({}),
      destroy: () => {
        log.push('texture');
      },
    }),
    destroy: () => {
      log.push('device');
    },
  };
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: async () => ({
        features: { has: () => false },
        limits: {},
        requestDevice: async () => device,
      }),
    },
  });
}

describe('the pool keeps a number[] as Float32Array words', () => {
  it('hands a released Float32Array to a number[] of the same length, and the other way', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const typed = dev.array(Float32Array.of(1, 2, 3));
    const typedState = residentState(typed);
    dev.release(typed);
    const plain = dev.array([4, 5, 6]);
    expect(residentState(plain)).toBe(typedState);
    expect(dev.statistics).toMatchObject({ allocations: 1, reuses: 1 });
    expect(await plain.read()).toEqual(Float32Array.of(4, 5, 6));
    dev.release(plain);
    const again = dev.array(Float32Array.of(7, 8, 9));
    expect(residentState(again)).toBe(typedState);
    expect(dev.statistics).toMatchObject({ allocations: 1, reuses: 2 });
    expect(await again.read()).toEqual(Float32Array.of(7, 8, 9));
    await dev.dispose();
  });

  it('keeps a number[] of another length apart from a released one', async () => {
    const dev = await createDevice({ prefer: ['cpu'] });
    const first = dev.array([1, 2, 3]);
    dev.release(first);
    const other = dev.array([1, 2]);
    expect(residentState(other)).not.toBe(residentState(first));
    expect(dev.statistics.allocations).toBe(2);
    await dev.dispose();
  });
});

describe('dispose order on a device the owner requested', () => {
  it('destroys each texture before the WebGPU device', async () => {
    const log: string[] = [];
    orderedGpu(log);
    const dev = await createDevice({ prefer: ['webgpu', 'cpu'] });
    expect(dev.tier).toBe('webgpu');
    dev.texture({ size: [2, 2], format: 'r32float' });
    dev.texture({ size: [2, 2], format: 'r32float' });
    await dev.dispose();
    await Promise.resolve();
    expect(log).toEqual(['texture', 'texture', 'device']);
  });
});
