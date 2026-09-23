"use typeshade";

/* @example
{
  "title": "Kaleidoscope (source twin)",
  "blurb": "`kaleidoscope.ts` written in the source language: the polar mirror fold through `mod`, the portable floor-mod, so the negative angles `atan2` produces wrap identically on both targets.",
  "renderable": true,
  "twinOf": "kaleidoscope"
}
*/

// The `"use typeshade"` twin of `kaleidoscope.ts`. `screenCoords` is a helper
// function here rather than an import — see `plasma-twin.shade.ts` on the
// repeated head.

class Uniforms {
  time: f32;
  resolution: vec2;
  segments: f32;
}

declare const U: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

// Centred, isotropic screen coordinates: y spans ±1 over the height and x spans
// ±aspect over the width, so one unit covers the same pixels on both axes.
function screenCoords(uv: vec2, resolution: vec2): vec2 {
  const asp = resolution.x / resolution.y;
  return vec2((uv.x * 2. - 1.) * asp, uv.y * 2. - 1.);
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}

// An exact integer hash (lowbias32 with xxHash's primes): every target and the CPU oracle
// agree on every bit of it. `fract(sin(x) * 43758.5453)` did not, since WGSL bounds `sin`
// only to 2^-11 and the multiply puts that error above the fraction (#184).
function hash32(x: u32): u32 {
  const a = (x ^ (x >> 16)) * 0x85ebca77;
  const b = (a ^ (a >> 13)) * 0xc2b2ae3d;
  return b ^ (b >> 16);
}

// scalar hash of a lattice point → [0,1): 24 bits, which f32 holds exactly
function hash(p: vec2): f32 {
  const h = hash32(u32(i32(p.x)) ^ hash32(u32(i32(p.y))));
  return f32(h >> 8) * 5.9604644775390625e-8; // 2^-24, exact: WGSL lets `/` round
}

// bilinear value noise with smootherstep weights
function noise(p: vec2): f32 {
  const i = floor(p);
  const f = fract(p);
  // `u` is annotated for the EDITOR, not the compiler: TypeScript types `vec2 * scalar` as
  // `number`, so `u.x` and `u.y` two lines down would be TS2339 on a program that compiles
  // (issue #43). Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const u: vec2 = f * f * (vec2(3.) - f * 2.);
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y,
  );
}

// 4-octave fbm, unrolled so the helper stays a pure value expression
function fbm(p: vec2): f32 {
  return noise(p) * 0.5 + noise(p * 2.02) * 0.25 + noise(p * 4.08) * 0.125 +
    noise(p * 8.2) * 0.0625;
}

// Iridescent cosine palette: 0.5 + 0.5·cos(2π(t + phase)).
function palette(t: f32): vec3 {
  const ph = vec3(0.0, 0.33, 0.67);
  return vec3(0.5) + cos((t + ph) * 6.283) * 0.5;
}

@fragment
export function fs(vo: VsOut): vec4 {
  const t = U.time;
  const res = U.resolution;
  const p = screenCoords(vo.uv, res);
  const r = length(p);
  const a0 = atan2(p.y, p.x);
  // fold: floor-mod the angle into one sector, mirror about its midline
  const sector = 6.2831853 / U.segments;
  const am = mod(a0, sector);
  const af = abs(am - sector * 0.5);
  const q = vec2(cos(af), sin(af)) * r;
  // wedge pattern: swirling fbm + concentric rings
  const v = fbm(q * 3. + vec2(t * 0.12, -(t * 0.09)));
  const rings = sin(r * 9. - t * 0.8) * 0.5 + 0.5;
  const col = palette(v * 0.7 + rings * 0.15 + r * 0.3 - t * 0.03);
  // the fbm field doubles as a brightness relief so the wedges keep depth
  const relief = v * 0.9 + 0.35;
  // vignette so the fold's outer edge fades instead of clipping
  const vig = 1. - smoothstep(0.55, 1.25, r);
  return vec4(col * relief * vig, 1.);
}
