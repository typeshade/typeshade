import { describe, it, expect } from 'vitest';
import { wgslType, wgslBackend } from './wgsl.js';
import { TypeShadeError } from '../diagnostics/error.js';
import type { ShaderType } from '../ir/index.js';

type TextureType = Extract<ShaderType, { kind: 'texture' }>;
type StorageTextureType = Extract<ShaderType, { kind: 'storage-texture' }>;
type DepthTextureType = Extract<ShaderType, { kind: 'depth-texture' }>;

const codeOf = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof TypeShadeError ? e.code : `not a TypeShadeError: ${String(e)}`;
  }
  return undefined;
};

describe('wgslType refuses a type that exists only before the double-precision lowering', () => {
  it('refuses f64 with SD0040', () => {
    expect(codeOf(() => wgslType({ kind: 'f64' }))).toBe('SD0040');
  });

  it('refuses vec64 of each width with SD0040, naming the width', () => {
    for (const n of [2, 3, 4] as const) {
      const type: ShaderType = { kind: 'vec64', n };
      expect(codeOf(() => wgslType(type))).toBe('SD0040');
      expect(() => wgslType(type)).toThrow(`vec${n}<f64>`);
    }
  });

  it('refuses a matrix of f64 of each shape with SD0040 and spells the f32 matrix', () => {
    for (const cols of [2, 3, 4] as const) {
      for (const rows of [2, 3, 4] as const) {
        expect(codeOf(() => wgslType({ kind: 'mat', cols, rows, elem: 'f64' }))).toBe('SD0040');
        expect(wgslType({ kind: 'mat', cols, rows, elem: 'f32' })).toBe(`mat${cols}x${rows}<f32>`);
      }
    }
  });

  it('refuses a Map or a Set, which a kernel function takes and a shader never spells', () => {
    const type: ShaderType = { kind: 'collection', key: 'u32' };
    expect(() => wgslType(type)).toThrow("a Map or a Set is a kernel function's parameter");
  });
});

describe('wgslType spells each texture dimension by name, never from a template', () => {
  const sampled: readonly (readonly [TextureType['dim'], string])[] = [
    ['2d', 'texture_2d<f32>'],
    ['2d-array', 'texture_2d_array<f32>'],
    ['2d-ms', 'texture_multisampled_2d<f32>'],
    ['cube', 'texture_cube<f32>'],
    ['cube-array', 'texture_cube_array<f32>'],
    ['3d', 'texture_3d<f32>'],
    ['1d', 'texture_1d<f32>'],
  ];

  it.each(sampled)('spells a sampled %s texture as %s', (dim, spelled) => {
    expect(wgslType({ kind: 'texture', dim, elem: 'f32' })).toBe(spelled);
  });

  it('puts the element type inside the angle brackets', () => {
    expect(wgslType({ kind: 'texture', dim: '2d-array', elem: 'u32' })).toBe(
      'texture_2d_array<u32>',
    );
    expect(wgslType({ kind: 'texture', dim: '2d-ms', elem: 'i32' })).toBe(
      'texture_multisampled_2d<i32>',
    );
  });

  it('never writes a hyphen into a texture name', () => {
    for (const [dim] of sampled) {
      expect(wgslType({ kind: 'texture', dim, elem: 'f32' })).not.toMatch(/texture_[^<]*-/);
    }
  });

  it('puts the format and the access mode of a storage texture inside its type', () => {
    const spelled = (dim: StorageTextureType['dim']) =>
      wgslType({ kind: 'storage-texture', dim, format: 'rgba8unorm', access: 'write' });
    expect(spelled('2d')).toBe('texture_storage_2d<rgba8unorm, write>');
    expect(spelled('2d-array')).toBe('texture_storage_2d_array<rgba8unorm, write>');
    expect(
      wgslType({ kind: 'storage-texture', dim: '2d', format: 'r32float', access: 'read_write' }),
    ).toBe('texture_storage_2d<r32float, read_write>');
  });

  const depth: readonly (readonly [DepthTextureType['dim'], string])[] = [
    ['2d', 'texture_depth_2d'],
    ['2d-array', 'texture_depth_2d_array'],
    ['cube', 'texture_depth_cube'],
    ['cube-array', 'texture_depth_cube_array'],
    ['2d-ms', 'texture_depth_multisampled_2d'],
  ];

  it.each(depth)('spells a %s depth texture as %s, with no element type', (dim, spelled) => {
    expect(wgslType({ kind: 'depth-texture', dim })).toBe(spelled);
  });

  it('spells both samplers', () => {
    expect(wgslType({ kind: 'sampler' })).toBe('sampler');
    expect(wgslType({ kind: 'sampler-comparison' })).toBe('sampler_comparison');
  });

  it('spells the backend type name through the same function', () => {
    const type: ShaderType = { kind: 'texture', dim: 'cube-array', elem: 'f32' };
    expect(wgslBackend.typeName(type)).toBe(wgslType(type));
  });
});
