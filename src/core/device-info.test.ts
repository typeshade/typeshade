// Verifies: Rule 11.8, Rule 11.11, Rule 11.17 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { buildInfo } from './build-info.js';
import { deviceInfo, retainAdapter } from './device-info.js';

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
