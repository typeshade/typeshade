// ═══ The compile gate's compute cases: entries no example has (Rule 8.24, change 0054) ═══
//
// The entry-call leg calls every `@compute` entry of the examples on each tier
// (`scripts/entry-calls-page.ts`). These are entries no example has, which the WebGL2 tier must
// still run; adding them to `examples/` would change the set of examples, which is a proposal's
// to change. `scripts/entry-calls.ts` reads them as it reads an example: the module the Vite
// plugin generates, its manifest, a call on every tier against WebGPU.
//
// `textured` reads a 2D texture three ways (`textureDimensions`, `textureLoad`, and
// `textureSampleLevel` through the sampler, past the right edge, where the address mode wraps
// it) inside a loop with two barriers, so the pass program binds the texture and its sampler on
// every pass, and the scatter between the passes reads its integer textures on units a sampler
// was bound to. The page gives every texture an 8 x 8 image and every sampler `nearest` and
// `repeat`, and samples at texel centres, so each tier reads the same texels and the values are
// exact. The CPU tier has no texture; WebGPU is the reference.
//
// `PROGRAM_CASES` are entries the call layer cannot call at all: they reach a texture that has
// no host value there (#204), so the page dispatches each through the program runtime alone, on
// WebGPU and on its WebGL2 tier, from the manifest `packModule` writes, and holds WebGL2 to
// WebGPU. The page makes every texture from `ProgramTexture`, its texels from `texelOf`, on both
// tiers alike. `handles` reads a 2D array, a 3D and a cube texture and compares two depth textures,
// at texel centres, so the texels read are the same on each tier. `storage` reads and writes three
// storage textures across a barrier, and the page reads each texture back as bytes; its stores
// are values no rounding mode puts on either side of a step (no `k + 0.5` of 255).
//
// It uses no Node API.

/** Each case as an author writes it, by its id. */
export const COMPUTE_CASES = {
  textured: `"use typeshade";

declare const photo: texture_2d<f32>;
declare const smp: sampler;
declare const out: storage<array<f32>, "read_write">;
let row: workgroup<array<f32, 8>>;

function lum(c: vec4f): f32 {
  return c.x * 0.25 + c.y * 0.5 + c.z * 0.25;
}

@compute([8, 1, 1])
export function blurRow(@builtin("local_invocation_index") li: u32): void {
  const dims = textureDimensions(photo);
  for (let y: u32 = 0; y < dims.y; y++) {
    row[li] = lum(textureLoad(photo, vec2i(i32(li), i32(y)), 0));
    workgroupBarrier();
    const uv = vec2f(f32(li + 1) + 0.5, f32(y) + 0.5) / vec2f(dims);
    const right = lum(textureSampleLevel(photo, smp, uv, 0.));
    out[y * 8 + li] = row[(li + 7) % 8] * 100. + right + f32(dims.x * 1000);
    workgroupBarrier();
  }
}
`,
} as const;

/** The cases that must run on both WebGL2 tiers, the call layer's and the program runtime's: a
 *  case skipped there would pass the gate having shown nothing. */
export const ON_WEBGL2: readonly (keyof typeof COMPUTE_CASES)[] = ['textured'];

/** A texture a program case binds, as the page makes it on each tier. */
export interface ProgramTexture {
  /** A sampled texture, or a storage texture the entry reads or writes. */
  readonly kind: 'sampled' | 'storage';
  readonly dim: '2d' | '2d-array' | '3d' | 'cube';
  readonly format: 'rgba8unorm' | 'rgba8uint' | 'r32float' | 'r32uint' | 'depth16unorm';
  /** Width, height, and layers or depth. */
  readonly size: readonly [number, number, number];
}

/** An entry the program runtime alone can dispatch, with how the page binds it. */
export interface ProgramCase {
  readonly source: string;
  readonly entry: string;
  readonly workgroups: number;
  readonly textures: Readonly<Record<string, ProgramTexture>>;
  readonly samplers: Readonly<
    Record<string, { readonly filter?: 'nearest'; readonly compare?: 'less' }>
  >;
  /** The `array<f32>` storage binding the entry writes, and its length, if it writes one. */
  readonly out?: { readonly name: string; readonly length: number };
}

/** Channel `c` of texel `(x, y, z)` of a texture of `format`, as the page uploads it: a byte for
 *  an 8-bit format, a float or an integer for a 32-bit one, a 16-bit word for depth16unorm. */
export function texelOf(
  format: ProgramTexture['format'],
  x: number,
  y: number,
  z: number,
  c: number,
): number {
  switch (format) {
    case 'rgba8unorm':
    case 'rgba8uint':
      return (x * 37 + y * 11 + z * 5 + c * 3 + 1) % 256;
    case 'r32float':
      return ((x + y * 8 + z * 64) % 17) / 4 - 1;
    case 'r32uint':
      return x + y * 8 + z * 64 + 1;
    case 'depth16unorm':
      return ((x * 7 + y * 3 + z * 5) % 16) * 4096;
  }
}

export const PROGRAM_CASES: Readonly<Record<string, ProgramCase>> = {
  handles: {
    source: `"use typeshade";

declare const layers: texture_2d_array<f32>;
declare const vol: texture_3d<u32>;
declare const env: texture_cube<f32>;
declare const shadow: texture_depth_2d;
declare const cascades: texture_depth_2d_array;
declare const smp: sampler;
declare const cmp: sampler_comparison;
declare const out: storage<array<f32>, "read_write">;

@compute([64, 1, 1])
export function handles(@builtin("local_invocation_index") li: u32): void {
  const x = i32(li % 4);
  const y = i32((li / 4) % 4);
  const z = i32(li / 16);
  const a = textureLoad(layers, vec2i(x, y), z % 3, 0);
  const b = textureLoad(vol, vec3i(x, y, z), 0);
  const axis = li % 6;
  const s = f32(li / 6 % 4) * 0.5 - 0.75;
  const t = f32(li / 24 % 2) * 0.5 - 0.25;
  let dir = vec3f(1., s, t);
  if (axis == 1) { dir = vec3f(-1., s, t); }
  if (axis == 2) { dir = vec3f(s, 1., t); }
  if (axis == 3) { dir = vec3f(s, -1., t); }
  if (axis == 4) { dir = vec3f(s, t, 1.); }
  if (axis == 5) { dir = vec3f(s, t, -1.); }
  const c = textureSampleLevel(env, smp, dir, 0.);
  const uv = (vec2f(f32(x), f32(y)) + 0.5) / 4.;
  const ref = f32(li % 16) / 16. + 1. / 32.;
  const d = textureSampleCompareLevel(shadow, cmp, uv, ref);
  const e = textureSampleCompareLevel(cascades, cmp, uv, z % 2, ref);
  const dims = textureDimensions(vol);
  out[li] = a.x + a.y * 2. + c.z * 4. + f32(b.x + b.w) * 8. + d * 16. + e * 32. + f32(dims.z) * 64.;
}
`,
    entry: 'handles',
    workgroups: 1,
    textures: {
      layers: { kind: 'sampled', dim: '2d-array', format: 'rgba8unorm', size: [4, 4, 3] },
      vol: { kind: 'sampled', dim: '3d', format: 'rgba8uint', size: [4, 4, 4] },
      env: { kind: 'sampled', dim: 'cube', format: 'rgba8unorm', size: [4, 4, 6] },
      shadow: { kind: 'sampled', dim: '2d', format: 'depth16unorm', size: [4, 4, 1] },
      cascades: { kind: 'sampled', dim: '2d-array', format: 'depth16unorm', size: [4, 4, 2] },
    },
    samplers: { smp: { filter: 'nearest' }, cmp: { filter: 'nearest', compare: 'less' } },
    out: { name: 'out', length: 64 },
  },
  storage: {
    source: `"use typeshade";

declare const acc: texture_storage_2d<"r32float", "read_write">;
declare const img: texture_storage_2d<"rgba8unorm", "write">;
declare const ids: texture_storage_2d<"r32uint", "write">;
let row: workgroup<array<f32, 8>>;

@compute([8, 1, 1])
export function paint(@builtin("local_invocation_id") lid: vec3u, @builtin("workgroup_id") wid: vec3u): void {
  const at = vec2i(i32(lid.x), i32(wid.x));
  const seen = textureLoad(acc, at).x;
  row[lid.x] = seen;
  workgroupBarrier();
  const left = row[(lid.x + 7) % 8];
  textureStore(acc, at, vec4f(seen * 2. + left, 0., 0., 0.));
  const dims = textureDimensions(img);
  textureStore(img, vec2u(lid.x, wid.x), vec4f(f32(lid.x) / 7., f32(wid.x) / 7., left / 7., 1.));
  textureStore(ids, at, vec4u(lid.x + wid.x * dims.x, u32(0), u32(0), u32(0)));
}
`,
    entry: 'paint',
    workgroups: 8,
    textures: {
      acc: { kind: 'storage', dim: '2d', format: 'r32float', size: [8, 8, 1] },
      img: { kind: 'storage', dim: '2d', format: 'rgba8unorm', size: [8, 8, 1] },
      ids: { kind: 'storage', dim: '2d', format: 'r32uint', size: [8, 8, 1] },
    },
    samplers: {},
  },
};
