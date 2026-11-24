import { describe, expect, it } from 'vitest';
import type { RhiDevice } from './rhi.js';
import { textureKindOf, webgl2Device } from './webgl2.js';
import { fakeGl, type FakeGlOptions } from './webgl2-fake-gl.js';

type Row = readonly [format: string, kind: string, internal: string, upload: string, type: string];

const SUPPORTED: readonly Row[] = [
  ['r8unorm', 'float', 'R8', 'RED', 'UNSIGNED_BYTE'],
  ['rg8unorm', 'float', 'RG8', 'RG', 'UNSIGNED_BYTE'],
  ['rgba8unorm', 'float', 'RGBA8', 'RGBA', 'UNSIGNED_BYTE'],
  ['rgba8unorm-srgb', 'float', 'SRGB8_ALPHA8', 'RGBA', 'UNSIGNED_BYTE'],
  ['bgra8unorm', 'float', 'RGBA8', 'RGBA', 'UNSIGNED_BYTE'],
  ['bgra8unorm-srgb', 'float', 'SRGB8_ALPHA8', 'RGBA', 'UNSIGNED_BYTE'],
  ['r8snorm', 'float', 'R8_SNORM', 'RED', 'BYTE'],
  ['rgba8snorm', 'float', 'RGBA8_SNORM', 'RGBA', 'BYTE'],
  ['r16float', 'float', 'R16F', 'RED', 'HALF_FLOAT'],
  ['rg16float', 'float', 'RG16F', 'RG', 'HALF_FLOAT'],
  ['rgba16float', 'float', 'RGBA16F', 'RGBA', 'HALF_FLOAT'],
  ['r32float', 'float', 'R32F', 'RED', 'FLOAT'],
  ['rg32float', 'float', 'RG32F', 'RG', 'FLOAT'],
  ['rgba32float', 'float', 'RGBA32F', 'RGBA', 'FLOAT'],
  ['r8uint', 'uint', 'R8UI', 'RED_INTEGER', 'UNSIGNED_BYTE'],
  ['r8sint', 'sint', 'R8I', 'RED_INTEGER', 'BYTE'],
  ['rg16uint', 'uint', 'RG16UI', 'RG_INTEGER', 'UNSIGNED_SHORT'],
  ['rgba16sint', 'sint', 'RGBA16I', 'RGBA_INTEGER', 'SHORT'],
  ['r32uint', 'uint', 'R32UI', 'RED_INTEGER', 'UNSIGNED_INT'],
  ['rgba32sint', 'sint', 'RGBA32I', 'RGBA_INTEGER', 'INT'],
  ['depth16unorm', 'depth', 'DEPTH_COMPONENT16', 'DEPTH_COMPONENT', 'UNSIGNED_SHORT'],
  ['depth24plus', 'depth', 'DEPTH_COMPONENT24', 'DEPTH_COMPONENT', 'UNSIGNED_INT'],
  ['depth32float', 'depth', 'DEPTH_COMPONENT32F', 'DEPTH_COMPONENT', 'FLOAT'],
  ['depth24plus-stencil8', 'depth', 'DEPTH24_STENCIL8', 'DEPTH_STENCIL', 'UNSIGNED_INT_24_8'],
  [
    'depth32float-stencil8',
    'depth',
    'DEPTH32F_STENCIL8',
    'DEPTH_STENCIL',
    'FLOAT_32_UNSIGNED_INT_24_8_REV',
  ],
  ['rgb10a2unorm', 'float', 'RGB10_A2', 'RGBA', 'UNSIGNED_INT_2_10_10_10_REV'],
  ['rgb10a2uint', 'uint', 'RGB10_A2UI', 'RGBA_INTEGER', 'UNSIGNED_INT_2_10_10_10_REV'],
  ['rg11b10ufloat', 'float', 'R11F_G11F_B10F', 'RGB', 'UNSIGNED_INT_10F_11F_11F_REV'],
];

const UNSUPPORTED = [
  'rg8unorm-srgb',
  'r8unorm-srgb',
  'rgba16unorm',
  'r32unorm',
  'r8float',
  'rgba8snorm-srgb',
  'bc1-rgba-unorm',
  'rgb9e5ufloat',
  'stencil8',
  'nonsense',
];

const make = (options?: FakeGlOptions) => {
  const fake = fakeGl(options);
  return { ...fake, device: webgl2Device(fake.gl) };
};

const created = (device: RhiDevice, format: string): void => {
  device.createTexture({ size: [3, 2, 1], format, usage: ['render'] });
};

describe('the formats of the WebGL2 backend', () => {
  it.each(SUPPORTED)('%s is a %s texel of %s', (format, kind, internal) => {
    expect(textureKindOf(format)).toBe(kind);
    const { device, calls } = make();
    created(device, format);
    expect(calls).toContain(`texStorage2D(TEXTURE_2D,1,${internal},3,2)`);
  });

  it.each(SUPPORTED)('%s is written as %s of %s', (format, _kind, _internal, upload, type) => {
    const { device, calls } = make();
    const texture = device.createTexture({ size: [1, 1, 1], format, usage: ['render'] });
    device.writeTexture(texture, new Uint8Array(16), 16, 1, 1);
    const call = calls.find((c) => c.startsWith('texSubImage2D('))!;
    expect(call.startsWith(`texSubImage2D(TEXTURE_2D,0,0,0,1,1,${upload},${type},`)).toBe(true);
  });

  it.each(UNSUPPORTED)('%s has no texture, as a kind or as a texture', (format) => {
    expect(textureKindOf(format)).toBeUndefined();
    const { device, calls } = make();
    expect(() => created(device, format)).toThrow(`${format} is not supported yet on WebGL2.`);
    expect(calls.filter((c) => c.startsWith('texStorage2D('))).toEqual([]);
  });

  it('makes no texture of an integer format that the context lacks', () => {
    const { device } = make({ missing: ['RGBA32UI'] });
    expect(() => created(device, 'rgba32uint')).toThrow('rgba32uint is not supported yet');
    expect(() => created(device, 'rgba32sint')).not.toThrow();
  });

  it('refuses a 3D, layered or multisampled texture', () => {
    const { device } = make();
    const base = { format: 'rgba8unorm', usage: ['render'] } as const;
    expect(() => device.createTexture({ ...base, size: [2, 2, 1], dimension: '3d' })).toThrow(
      'A 3D or layered texture is not supported yet on the WebGL2 tier.',
    );
    expect(() => device.createTexture({ ...base, size: [2, 2, 2] })).toThrow(
      'A 3D or layered texture is not supported yet on the WebGL2 tier.',
    );
    expect(() => device.createTexture({ ...base, size: [2, 2, 1], sampleCount: 4 })).toThrow(
      'A multisampled texture is not supported yet on the WebGL2 tier',
    );
  });

  it('writes a blue-first texel as red first, and leaves the host bytes alone', () => {
    const { device, calls } = make();
    const texture = device.createTexture({ size: [2, 1, 1], format: 'bgra8unorm', usage: [] });
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    device.writeTexture(texture, bytes, 8, 2, 1);
    expect(calls.find((c) => c.startsWith('texSubImage2D('))).toContain(',[3,2,1,4,7,6,5,8])');
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(calls.filter((c) => c.startsWith('blitFramebuffer('))).toEqual([]);
  });

  it('writes a red-first texel as it is', () => {
    const { device, calls } = make();
    const texture = device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: [] });
    device.writeTexture(texture, new Uint8Array([1, 2, 3, 4]), 4, 1, 1);
    expect(calls.find((c) => c.startsWith('texSubImage2D('))).toContain(',[1,2,3,4])');
  });

  it('sets the row length when a row has padding, and sets it back', () => {
    const { device, calls } = make();
    const texture = device.createTexture({ size: [2, 2, 1], format: 'rgba8unorm', usage: [] });
    device.writeTexture(texture, new Uint8Array(512), 256, 3, 2);
    const rows = calls.filter((c) => c.startsWith('pixelStorei(UNPACK_ROW_LENGTH'));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe('pixelStorei(UNPACK_ROW_LENGTH,0)');
    expect(calls).toContain('pixelStorei(UNPACK_ALIGNMENT,1)');
  });

  it('sets no row length for a tight row', () => {
    const { device, calls } = make();
    const texture = device.createTexture({ size: [2, 2, 1], format: 'rgba8unorm', usage: [] });
    device.writeTexture(texture, new Uint8Array(16), 8, 2, 2);
    expect(calls.filter((c) => c.startsWith('pixelStorei(UNPACK_ROW_LENGTH'))).toEqual([]);
  });

  it.each([
    ['r32float', new Float32Array([1.5, -2]), '[1.5,-2]'],
    ['r16float', new Uint16Array([0x3c00, 0xc000]), '[15360,49152]'],
    ['r16uint', new Uint16Array([65535, 1]), '[65535,1]'],
    ['r16sint', new Int16Array([-2, 3]), '[-2,3]'],
    ['r32uint', new Uint32Array([4294967295]), '[4294967295]'],
    ['r32sint', new Int32Array([-5]), '[-5]'],
    ['r8snorm', new Int8Array([-1, 2]), '[-1,2]'],
    ['r8unorm', new Uint8Array([255, 2]), '[255,2]'],
    ['rgb10a2unorm', new Uint32Array([0xdeadbeef]), '[3735928559]'],
  ])('hands %s texels to the context as the typed array of its type', (format, data, shown) => {
    const { device, calls } = make();
    const texture = device.createTexture({ size: [data.length, 1, 1], format, usage: [] });
    device.writeTexture(texture, data, data.byteLength, data.length, 1);
    expect(calls.find((c) => c.startsWith('texSubImage2D('))).toContain(`,${shown})`);
  });
});
