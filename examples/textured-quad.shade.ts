"use typeshade";

/* @example
{
  "title": "Texture, sampler and overrides",
  "blurb": "A fullscreen triangle sampling a `texture_2d<f32>` through a `sampler`, tinted by two `override<f32>` specialization constants — WGSL declares the handles and the overrides, GLSL ES 3.00 fuses texture and sampler into one `sampler2D` and spells each override as a `#define`.",
  "renderable": true
}
*/

// The gated example for textures, samplers and overrides (#8 A7). Before it, nothing the
// compile gate emitted declared a handle resource or a specialization constant from this
// surface, so the gate said as much about A7 as it did before A7 existed.
//
// It carries all four of the item's declarations — a 2D texture, a sampler, an override with
// a stated default and one with none — and reads the texture through `textureSample`, which
// is fragment-only on both targets (the level of detail comes from screen-space derivatives).
// `textureDimensions` is read in the same stage so the unfiltered query has coverage too.

declare const tex: texture_2d<f32>;
declare const smp: sampler;
const tint: override<f32> = 0.85;
declare const desaturate: override<f32>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) * 0.5 + vec2(0.5, 0.5) };
}

@fragment
export function fs(v: VsOut): Color {
  const texel = textureSample(tex, smp, v.uv);
  // Read the real extent, so the unfiltered query has coverage too. Spelled component-wise
  // rather than `vec2(textureDimensions(tex))`: the element-converting constructor is A8, on
  // its own branch, and this example must compile on main plus this item alone.
  const dims = textureDimensions(tex);
  const width = f32(dims.x);
  // `clamp`, not `saturate`: that alias is A6, on its own branch.
  const edge = clamp(v.uv.x * width / (width + 1.), 0., 1.);
  const grey = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  // The vector `t` and the annotated `const` are both spellings around the editor's ambient
  // lib, not the compiler: `mix<T extends Numeric>(a: T, b: T, t: T)` has no scalar-`t`
  // overload, and vector arithmetic evaluates to `number` in TypeScript, so passing either
  // result straight on is a TS2345 it does not filter. Both are #21's family; the compiler
  // takes the scalar form and this file would too.
  const mixed = mix(texel.rgb, vec3(grey, grey, grey), vec3(desaturate, desaturate, desaturate));
  const shaded: vec3 = mixed * (tint * edge);
  return { color: vec4(shaded, texel.a) };
}
