// Verifies: Rule 11.8, Rule 11.11, Rule 11.17 (docs/language-design.md; traced in reqs/).
import { afterEach, expect, it, vi } from 'vitest';
import {
  buildInfo,
  createDevice,
  createRuntime,
  type DeviceInfo,
  type TypeShadeBuildInfo,
} from '../runtime.js';
import { buildInfo as rootBuild } from '../index.js';

afterEach(() => vi.unstubAllGlobals());

function gpu(vendor?: string) {
  return {
    adapterInfo: vendor === undefined ? undefined : { vendor },
    features: new Set(['enabled']),
    limits: { maxBufferSize: 1024 },
    lost: new Promise<{ reason: string; message: string }>(() => {}),
    destroy: vi.fn(),
    queue: { onSubmittedWorkDone: async () => {} },
  };
}

it('does not request an adapter for external devices and preserves independent snapshots after loss/disposal', async () => {
  const requestAdapter = vi.fn(() => {
    throw new Error('unrelated adapter');
  });
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  let lose!: (info: { reason: string; message: string }) => void;
  const a = {
    ...gpu('a'),
    lost: new Promise<{ reason: string; message: string }>((resolve) => {
      lose = resolve;
    }),
  };
  const b = gpu();
  const rt = await createRuntime({ device: a });
  const owner = await createDevice({ runtime: rt });
  const other = await createDevice({ device: b });
  const info: DeviceInfo = owner.info;
  const build: TypeShadeBuildInfo = info.build;
  expect(build).toBe(rootBuild);
  expect(build).toBe(buildInfo);
  expect(rt.info).toEqual(info);
  expect(other.info.webgpu?.provenance).toBe('unavailable');
  expect(info.webgpu?.vendor).toBe('a');
  lose({ reason: 'destroyed', message: 'lost' });
  await owner.lost;
  await owner.dispose();
  await other.dispose();
  rt.destroy();
  expect(owner.info).toBe(info);
  expect(rt.info.webgpu?.vendor).toBe('a');
  expect(requestAdapter).not.toHaveBeenCalled();
  expect(a.destroy).not.toHaveBeenCalled();
  expect(b.destroy).not.toHaveBeenCalled();
});

it('retains each own-device creation adapter and reports enabled rather than supported capabilities', async () => {
  const devices = [gpu(), gpu()];
  let n = 0;
  const requestAdapter = vi.fn(async () => {
    const index = n++;
    return {
      info: { vendor: `adapter-${index}`, isFallbackAdapter: true },
      features: new Set(['supported-only']),
      limits: { maxBufferSize: 4096 },
      requestDevice: async () => devices[index],
    };
  });
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  const owner = await createDevice({ prefer: ['webgpu'] });
  const rt = await createRuntime({ prefer: ['webgpu'] });
  expect(owner.info.webgpu).toMatchObject({
    provenance: 'adapter',
    vendor: 'adapter-0',
    features: ['enabled'],
    limits: { maxBufferSize: 1024 },
    fallback: true,
  });
  expect(rt.info.webgpu?.vendor).toBe('adapter-1');
  const wrapped = await createDevice({ runtime: rt });
  expect(wrapped.info).toEqual(rt.info);
  expect(requestAdapter).toHaveBeenCalledTimes(2);
  await wrapped.dispose();
  await owner.dispose();
  rt.destroy();
  expect(devices[0]!.destroy).toHaveBeenCalledOnce();
  expect(devices[1]!.destroy).toHaveBeenCalledOnce();
});

it('reports only the supplied WebGL context and leaves it owned by the host', async () => {
  const loseContext = vi.fn();
  const gl = {
    VENDOR: 1,
    RENDERER: 2,
    createTransformFeedback: () => ({}),
    getParameter: () => 'supplied',
    getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
  };
  const rt = await createRuntime({ device: gl });
  expect(rt.info.webgl).toEqual({
    vendor: 'supplied',
    renderer: 'supplied',
    unmaskedVendor: null,
    unmaskedRenderer: null,
  });
  expect(rt.info.webgpu).toBeNull();
  const info = rt.info;
  rt.destroy();
  expect(rt.info).toBe(info);
  expect(loseContext).not.toHaveBeenCalled();
});
