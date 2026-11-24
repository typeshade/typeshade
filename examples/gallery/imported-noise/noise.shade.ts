"use typeshade";

// A shader library: value noise and its fbm, which `imported-noise.shade.ts` imports (surface
// §68). It sits in `lib/` so that it is not an example of its own: the corpus scan reads the
// directory's top level, and the compile gate reaches this file through the example's import.
// Only `noise` and `fbm` are exported; `hash32` and `hash` stay private to this file, and an
// importer that declares a `hash` of its own gets two functions, not a clash (Rule 3.2).

// An exact integer hash (lowbias32 with xxHash's primes): every target and the CPU oracle
// agree on every bit of it (#184).
function hash32(x: u32): u32 {
  const a = (x ^ (x >> 16)) * 0x85ebca77;
  const b = (a ^ (a >> 13)) * 0xc2b2ae3d;
  return b ^ (b >> 16);
}

// A lattice point's hash in [0, 1): 24 bits, which an f32 holds exactly.
function hash(p: vec2): f32 {
  const h = hash32(u32(i32(p.x)) ^ hash32(u32(i32(p.y))));
  return f32(h >> 8) * 5.9604644775390625e-8; // 2^-24, exact: WGSL lets `/` round
}

// Bilinear value noise with smoothstep weights.
export function noise(p: vec2): f32 {
  const i = floor(p);
  const f = fract(p);
  const u: vec2 = f * f * (vec2(3.) - f * 2.);
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y,
  );
}

// Four octaves, unrolled so the helper stays one value expression.
export function fbm(p: vec2): f32 {
  return noise(p) * 0.5 + noise(p * 2.02) * 0.25 + noise(p * 4.08) * 0.125 +
    noise(p * 8.2) * 0.0625;
}
