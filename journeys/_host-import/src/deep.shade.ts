"use typeshade";

// A full-screen fragment entry that computes in `f64` (change 0013's f64 split), drawn through
// the import on WebGPU, WebGL2 and the CPU tier. Its WGSL and GLSL hold each double as two
// `f32`s and read the `_fp64` guard the runtime binds; the CPU tier computes a double.

class Zoom {
  cx: f64;
  scale: f64;
}

declare const zoom: uniform<Zoom>;

/** A band whose position an `f32` would lose: `x` is near 12 345.678 and moves by a millionth
 *  per pixel, and the band is the fraction of `x * 1000`. */
@fragment
export function deep(@builtin("position") p: vec4): vec4 {
  const x: f64 = zoom.cx + f64(p.x) * zoom.scale;
  return vec4(f32(fract(x * 1000)), p.y / 32, 0, 1);
}
