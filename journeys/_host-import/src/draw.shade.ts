"use typeshade";

// Three full-screen fragment entries a host file draws into a canvas through the import (change
// 0016): a plasma from a uniform, an image repeated every 8 pixels through a sampler, and a ramp
// read from a storage array that a kernel function wrote and that stays on the device (Rule
// 11.8).

class Wave {
  time: f32;
  scale: f32;
}

declare const wave: uniform<Wave>;
declare const image: texture_2d<f32>;
declare const smp: sampler;
declare const ramp: storage<array<f32>>;

@fragment
export function plasma(@builtin("position") p: vec4): vec4 {
  const uv = p.xy * wave.scale;
  let v = 0.;
  for (let i = 0; i < 4; i++) {
    const k = f32(i + 1);
    v += (sin(uv.x * k + wave.time) * cos(uv.y * k - wave.time)) / k;
  }
  const c = v * 0.5 + 0.5;
  return vec4(c, c * c, 1 - c, 1);
}

@fragment
export function tiled(@builtin("position") p: vec4): vec4 {
  return textureSample(image, smp, p.xy / 8.);
}

/** Each element of `out`, its index over the length: 0 up to just under 1. */
export function fillRamp(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(i) / f32(out.length);
  }
}

@fragment
export function ramped(@builtin("position") p: vec4): vec4 {
  return vec4(ramp[u32(p.x)], ramp[u32(p.y)], 0., 1.);
}
