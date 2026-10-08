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
