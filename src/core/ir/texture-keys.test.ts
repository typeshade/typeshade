import { describe, it, expect } from 'vitest';
import {
  samplerT,
  samplerComparisonT,
  texture1dfT,
  texture2dfT,
  texture2dMsfT,
  texture2dArrayfT,
  texture2duT,
  texture2diT,
  texture2dArrayuT,
  texture2dArrayiT,
  texture3dfT,
  textureCubefT,
  textureCubeArrayfT,
  textureDepth2dT,
  textureDepth2dArrayT,
  textureDepthCubeT,
  textureDepthCubeArrayT,
  textureDepthMultisampled2dT,
  typeKey,
  type KeyOf,
  type ShaderType,
} from './index.js';

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('texture and sampler keys', () => {
  it('spells every sampled texture dim explicitly, at the type level and at runtime', () => {
    const _ms: Exact<KeyOf<typeof texture2dMsfT>, 'texture_multisampled_2d<f32>'> = true;
    const _arr: Exact<KeyOf<typeof texture2dArrayfT>, 'texture_2d_array<f32>'> = true;
    const _2d: Exact<KeyOf<typeof texture2dfT>, 'texture_2d<f32>'> = true;
    const _cube: Exact<KeyOf<typeof textureCubefT>, 'texture_cube<f32>'> = true;
    const _3d: Exact<KeyOf<typeof texture3dfT>, 'texture_3d<f32>'> = true;
    const _1d: Exact<KeyOf<typeof texture1dfT>, 'texture_1d<f32>'> = true;
    const _cubeArr: Exact<KeyOf<typeof textureCubeArrayfT>, 'texture_cube_array<f32>'> = true;
    const _sampler: Exact<KeyOf<typeof samplerT>, 'sampler'> = true;
    expect([_ms, _arr, _2d, _cube, _3d, _1d, _cubeArr, _sampler]).toEqual(Array(8).fill(true));
    expect(typeKey(texture2dMsfT)).toBe('texture_multisampled_2d<f32>');
    expect(typeKey(texture2dArrayfT)).toBe('texture_2d_array<f32>');
    expect(typeKey(texture2dfT)).toBe('texture_2d<f32>');
    expect(typeKey(textureCubefT)).toBe('texture_cube<f32>');
    expect(typeKey(texture3dfT)).toBe('texture_3d<f32>');
    expect(typeKey(texture1dfT)).toBe('texture_1d<f32>');
    expect(typeKey(textureCubeArrayfT)).toBe('texture_cube_array<f32>');
    expect(typeKey(samplerT)).toBe('sampler');
  });

  it('infers the element of a sampled texture key instead of fixing it to f32', () => {
    const _u: Exact<KeyOf<typeof texture2duT>, 'texture_2d<u32>'> = true;
    const _i: Exact<KeyOf<typeof texture2diT>, 'texture_2d<i32>'> = true;
    const _au: Exact<KeyOf<typeof texture2dArrayuT>, 'texture_2d_array<u32>'> = true;
    const _ai: Exact<KeyOf<typeof texture2dArrayiT>, 'texture_2d_array<i32>'> = true;
    expect([_u, _i, _au, _ai]).toEqual([true, true, true, true]);
    expect(typeKey(texture2duT)).toBe('texture_2d<u32>');
    expect(typeKey(texture2dArrayiT)).toBe('texture_2d_array<i32>');
  });

  it('spells storage textures as WGSL does, with the dim written out', () => {
    const flat: ShaderType = {
      kind: 'storage-texture',
      dim: '2d',
      format: 'rgba8unorm',
      access: 'write',
    };
    const layered: ShaderType = {
      kind: 'storage-texture',
      dim: '2d-array',
      format: 'r32float',
      access: 'read_write',
    };
    expect(typeKey(flat)).toBe('texture_storage_2d<rgba8unorm, write>');
    expect(typeKey(layered)).toBe('texture_storage_2d_array<r32float, read_write>');
  });

  it('spells depth textures and comparison samplers as WGSL does', () => {
    expect(typeKey(textureDepth2dT)).toBe('texture_depth_2d');
    expect(typeKey(textureDepth2dArrayT)).toBe('texture_depth_2d_array');
    expect(typeKey(textureDepthCubeT)).toBe('texture_depth_cube');
    expect(typeKey(textureDepthCubeArrayT)).toBe('texture_depth_cube_array');
    expect(typeKey(textureDepthMultisampled2dT)).toBe('texture_depth_multisampled_2d');
    expect(typeKey(samplerComparisonT)).toBe('sampler_comparison');
  });
});
