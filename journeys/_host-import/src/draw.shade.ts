"use typeshade";

// Two full-screen fragment entries a host file draws into a canvas through the import (change
// 0016): a plasma from a uniform, and an image repeated every 8 pixels through a sampler.

class Wave {
  time: f32;
  scale: f32;
}

declare const wave: uniform<Wave>;
declare const image: texture_2d<f32>;
declare const smp: sampler;

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
