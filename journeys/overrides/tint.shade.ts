"use typeshade";

// A fullscreen effect whose look is fixed when its pipeline is made. The vertex entry reads
// `sheen` and hands it to the fragment entry as a varying; the fragment entry reads `tint`,
// `bands` and `inverted`. The host names all four for the one pipeline (surface §69), so each
// stage is created with values for names its entry does not read, which WebGPU takes when the
// module declares them.

const sheen: override<f32> = 0.;
const tint: override<f32> = 1.;
const bands: override<u32> = 2;
const inverted: override<bool> = false;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) glow: f32;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), glow: sheen };
}

@fragment
export function fs(v: VsOut): Color {
  // Vertical stripes: the column, in groups of 8, numbers a band, and the bands are 0 to 1.
  const band = f32((u32(v.pos.x) / u32(8)) % bands) / f32(bands);
  const blue = inverted ? 1. - band : band;
  return { color: vec4(band * tint, v.glow, blue, 1.) };
}
