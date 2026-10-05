"use typeshade";

// A full-screen fragment entry that computes in `f64`. `x` is near 12 345.678 and moves by two
// hundred-thousandths per pixel, a step an `f32` cannot take at that size, and the colour is the
// fraction of `x * 1000`. The WGSL holds each double as two `f32`s: with the `'float'` flavor of
// the emulation the draw binds the `_fp64` guard the manifest lists, and with the `'integer'` one
// it binds none.

class Zoom {
  cx: f64;
  scale: f64;
}

declare const zoom: uniform<Zoom>;

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.) };
}

@fragment
export function fs(v: VsOut): Color {
  const x: f64 = zoom.cx + f64(v.pos.x) * zoom.scale;
  // The blue and the alpha are sums the optimizer folds and O0 leaves.
  return { color: vec4(f32(fract(x * 1000)), 0., 0.25 * 4. - 1., 0.5 + 0.5) };
}
