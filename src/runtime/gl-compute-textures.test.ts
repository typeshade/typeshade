import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatched, lastArgs, setup } from './gl-compute-host-harness.js';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';

const compiled = (source: string) => {
  const r = compile(source);
  if (r.diagnostics.some((d) => d.category === 'error')) throw new Error('does not compile');
  return packModule(r.module!, { console: false });
};

const SAMPLED = compiled(`"use typeshade";
declare const photo: texture_2d<f32>;
declare const smp: sampler;
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureSampleLevel(photo, smp, vec2f(0.5), 0.).y;
}
`);
const LOADED = compiled(`"use typeshade";
declare const photo: texture_2d<f32>;
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureLoad(photo, vec2i(0), 0).x;
}
`);
const STORED = compiled(`"use typeshade";
declare const img: texture_storage_2d<"r32float", "write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  textureStore(img, vec2i(0), vec4f(1.));
}
`);
const VOLUME = compiled(`"use typeshade";
declare const photo: texture_3d<f32>;
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureLoad(photo, vec3i(0), 0).x;
}
`);
const CUBE = compiled(`"use typeshade";
declare const photo: texture_cube<f32>;
declare const smp: sampler;
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureSampleLevel(photo, smp, vec3f(0.5), 0.).x;
}
`);

vi.mock('../core/gl-compute.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/gl-compute.js')>()),
  runGlCompute: vi.fn(async () => undefined),
}));

beforeEach(() => dispatched.mockClear());

describe('a texture of a dispatch on the WebGL2 tier', () => {
  it('is read through the sampler its call passes, else through the nearest clamped one', async () => {
    const sampled = await setup(SAMPLED);
    const photo = sampled.rt.texture({ size: [2, 2], format: 'rgba8unorm' });
    const linear = sampled.rt.sampler({ minFilter: 'linear', magFilter: 'linear' });
    const out = new Float32Array(1);
    const f = sampled.rt.frame();
    f.dispatch(sampled.pipeline, { photo, smp: linear, out }, 1);
    await f.submit();
    expect(lastArgs().textures['photo']!.sampler).toBe(
      sampled.rt.rhi.toNative(linear.sampler as never),
    );
    const loaded = await setup(LOADED);
    const g = loaded.rt.frame();
    g.dispatch(
      loaded.pipeline,
      { photo: loaded.rt.texture({ size: [2, 2], format: 'rgba8unorm' }), out },
      1,
    );
    await g.submit();
    expect(lastArgs().textures['photo']!.sampler).toBe(loaded.rt.rhi.toNative(loaded.rt.nearest));
    expect(loaded.rt.nearest).toBe(loaded.rt.nearest);
  });

  it('is made nearest, clamped to the edge on every axis', async () => {
    const { rt, calls } = await setup(SAMPLED);
    void rt.nearest;
    const set = calls.filter((c) => c.startsWith('samplerParameteri('));
    expect(set).toEqual([
      'samplerParameteri(*,TEXTURE_MIN_FILTER,NEAREST)',
      'samplerParameteri(*,TEXTURE_MAG_FILTER,NEAREST)',
      'samplerParameteri(*,TEXTURE_WRAP_S,CLAMP_TO_EDGE)',
      'samplerParameteri(*,TEXTURE_WRAP_T,CLAMP_TO_EDGE)',
      'samplerParameteri(*,TEXTURE_WRAP_R,CLAMP_TO_EDGE)',
    ]);
  });
});

describe('a texture of the dispatch that is not sampled', () => {
  it('takes a storage texture of the runtime with its native texture and its width and height', async () => {
    const { rt, pipeline } = await setup(STORED);
    const img = rt.texture({ size: [3, 2], format: 'r32float', storage: true });
    const f = rt.frame();
    f.dispatch(pipeline, { img } as never, 1);
    await f.submit();
    expect(lastArgs().storageTextures['img']).toMatchObject({
      texture: (img as unknown as { texture: object }).texture,
      width: 3,
      height: 2,
    });
  });

  it('takes the host own texture of a dimension other than 2D as it is', async () => {
    class HostTexture {}
    vi.stubGlobal('WebGLTexture', HostTexture);
    try {
      const { rt, pipeline } = await setup(VOLUME);
      const own = new HostTexture();
      const f = rt.frame();
      f.dispatch(pipeline, { photo: own, out: new Float32Array(1) } as never, 1);
      await f.submit();
      expect(lastArgs().textures['photo']!.texture).toBe(own);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names TEXTURE_CUBE_MAP for a cube texture given a texture of the runtime', async () => {
    const { rt, pipeline } = await setup(CUBE);
    const photo = rt.texture({ size: [2, 2], format: 'rgba8unorm' });
    const smp = rt.sampler({});
    expect(() =>
      rt.frame().dispatch(pipeline, { photo, smp, out: new Float32Array(1) } as never, 1),
    ).toThrow('takes a WebGLTexture made for TEXTURE_CUBE_MAP');
  });
});

describe('a texture of the runtime that does not fit the binding of a dispatch is refused', () => {
  it.each([
    ['texture_3d<f32>', 'vec3i(0)', 'TEXTURE_3D'],
    ['texture_2d_array<f32>', 'vec2i(0), 0', 'TEXTURE_2D_ARRAY'],
  ])('names the target a %s is made for', async (type, at, target) => {
    const { rt, pipeline } = await setup(
      compiled(`"use typeshade";
declare const photo: ${type};
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureLoad(photo, ${at}, 0).x;
}
`),
    );
    const photo = rt.texture({ size: [2, 2], format: 'rgba8unorm' });
    expect(() => rt.frame().dispatch(pipeline, { photo, out: new Float32Array(1) }, 1)).toThrow(
      `binding "photo" (${type}) takes a WebGLTexture made for ${target}: a Texture of the WebGL2 runtime is 2D.`,
    );
  });

  it('refuses a storage texture array, which no Texture of the runtime is', async () => {
    const { rt, pipeline } = await setup(
      compiled(`"use typeshade";
declare const img: texture_storage_2d_array<"r32float", "write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  textureStore(img, vec2i(0), 0, vec4f(1.));
}
`),
    );
    const img = rt.texture({ size: [2, 2], format: 'r32float', storage: true });
    expect(() => rt.frame().dispatch(pipeline, { img } as never, 1)).toThrow(
      'is an array, and a Texture of the WebGL2 runtime is 2D: the WebGL2 tier binds a texture_storage_2d_array to no texture yet.',
    );
  });
});
