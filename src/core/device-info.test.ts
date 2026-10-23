// Verifies: Rule 11.8, Rule 11.11, Rule 11.17 (docs/language-design.md; traced in reqs/).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInfo } from './build-info.js';
import { automaticFp64Flavor, deviceInfo, retainAdapter } from './device-info.js';

afterEach(() => vi.unstubAllGlobals());

describe('automatic fp64 selection (0085)', () => {
  it('uses the actual device and its creation adapter, without probing another adapter', () => {
    const requestAdapter = vi.fn(() => {
      throw new Error('unrelated adapter');
    });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    expect(automaticFp64Flavor('webgpu', { adapterInfo: { vendor: 'apple' } })).toBe('integer');
    expect(automaticFp64Flavor('webgpu', { adapterInfo: { vendor: 'nvidia' } })).toBe('float');
    const device = { adapterInfo: {} };
    retainAdapter(device, { info: { vendor: 'apple' } });
    expect(automaticFp64Flavor('webgpu', device)).toBe('integer');
    expect(deviceInfo('webgpu', device).webgpu?.vendor).toBeNull();
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('uses the actual GL renderer, including masked and debug strings', () => {
    const gl = {
      RENDERER: 2,
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 4 }),
      getParameter: (key: number) => (key === 4 ? 'ANGLE Metal Renderer: Apple M2' : 'masked'),
    };
    expect(automaticFp64Flavor('webgl2', gl)).toBe('integer');
    expect(
      automaticFp64Flavor('webgl2', {
        ...gl,
        getExtension: () => null,
        getParameter: () => 'Metal',
      }),
    ).toBe('integer');
  });

  it('falls back to the user agent when redacted, but always selects float for the CPU', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh AppleWebKit/605.1.15' });
    expect(automaticFp64Flavor('webgpu', { adapterInfo: { vendor: '' } })).toBe('integer');
    expect(
      automaticFp64Flavor('webgpu', {
        get adapterInfo(): object {
          throw new Error('denied');
        },
      }),
    ).toBe('integer');
    expect(automaticFp64Flavor('cpu')).toBe('float');
    vi.stubGlobal('navigator', {
      get userAgent(): string {
        throw new Error('denied');
      },
    });
    expect(automaticFp64Flavor('webgpu', {})).toBe('float');
  });

  it('caches the recommendation per native device without rereading metadata on every call', () => {
    const identity = vi.fn(() => ({ vendor: 'apple' }));
    const device = {
      get adapterInfo(): object {
        return identity();
      },
    };
    expect(automaticFp64Flavor('webgpu', device)).toBe('integer');
    expect(automaticFp64Flavor('webgpu', device)).toBe('integer');
    expect(identity).toHaveBeenCalledTimes(1);
  });
});

describe('device snapshots', () => {
  it('copies enabled capabilities and actual-device identity, deeply frozen and serializable', () => {
    const device = {
      adapterInfo: { vendor: 'actual', description: '', isFallbackAdapter: false },
      features: new Set(['z', 'a']),
      limits: Object.create({ maxBufferSize: 1024 }),
    };
    retainAdapter(device, {
      info: { vendor: 'creation adapter' },
      features: new Set(['unsupported']),
    });
    const info = deviceInfo('webgpu', device);
    expect(info.webgpu).toEqual({
      provenance: 'device',
      vendor: 'actual',
      architecture: null,
      device: null,
      description: null,
      fallback: false,
      features: ['a', 'z'],
      limits: { maxBufferSize: 1024 },
    });
    device.adapterInfo.vendor = 'changed';
    device.features.add('later');
    device.limits.maxBufferSize = 2048;
    expect(info.webgpu?.vendor).toBe('actual');
    expect(info.webgpu?.features).toEqual(['a', 'z']);
    expect(info.webgpu?.limits.maxBufferSize).toBe(1024);
    for (const value of [info, info.build, info.webgpu, info.webgpu?.features, info.webgpu?.limits])
      expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });

  it('retains creation metadata without retaining mutable browser objects or guessing external identity', () => {
    const device = {};
    const adapter = { info: { vendor: 'owned' }, isFallbackAdapter: true };
    retainAdapter(device, adapter);
    adapter.info.vendor = 'changed';
    expect(deviceInfo('webgpu', device).webgpu).toMatchObject({
      provenance: 'adapter',
      vendor: 'owned',
      fallback: true,
    });
    expect(deviceInfo('webgpu', {}).webgpu).toMatchObject({
      provenance: 'unavailable',
      vendor: null,
      fallback: null,
    });
  });

  it('preserves redaction and getter failures without asking for another adapter', () => {
    const device = {
      get adapterInfo(): object {
        throw new Error('denied');
      },
    };
    expect(deviceInfo('webgpu', device).webgpu?.provenance).toBe('unavailable');
    expect(deviceInfo('webgpu', { adapterInfo: { vendor: '' } }).webgpu?.vendor).toBeNull();
  });

  it('reads only the given WebGL context and tolerates missing debug information', () => {
    const gl = {
      VENDOR: 1,
      RENDERER: 2,
      getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 }),
      getParameter: (key: number) =>
        ['', 'masked vendor', 'masked renderer', 'actual vendor', 'actual renderer'][key],
    };
    const info = deviceInfo('webgl2', gl);
    expect(info.webgl).toEqual({
      vendor: 'masked vendor',
      renderer: 'masked renderer',
      unmaskedVendor: 'actual vendor',
      unmaskedRenderer: 'actual renderer',
    });
    expect(Object.isFrozen(info.webgl)).toBe(true);
    expect(info.webgpu).toBeNull();
    expect(
      deviceInfo('webgl2', { ...gl, getExtension: () => null }).webgl?.unmaskedRenderer,
    ).toBeNull();
    expect(
      deviceInfo('webgl2', {
        ...gl,
        getExtension: () => {
          throw new Error('denied');
        },
        getParameter: () => '',
      }).webgl,
    ).toEqual({ vendor: null, renderer: null, unmaskedVendor: null, unmaskedRenderer: null });
    expect(
      deviceInfo('webgl2', {
        ...gl,
        getParameter: () => {
          throw new Error('lost');
        },
      }).webgl?.renderer,
    ).toBeNull();
  });

  it('is safe without browser globals on the CPU tier and leaves builds unstamped', () => {
    expect(deviceInfo('cpu')).toEqual({ build: buildInfo, tier: 'cpu', webgpu: null, webgl: null });
    expect(buildInfo.revision).toBeNull();
  });
});
