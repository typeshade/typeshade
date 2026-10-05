"use typeshade";

// A fragment entry that writes what an 8-bit target cannot hold: values above 1 and below 0. The
// host draws it into an `rgba16float` target and reads the target back as numbers (surface §69).
// Each value is a small dyadic number, so the f32 arithmetic here is exact and each channel is
// exactly the half float the target stores: a value the readback decodes wrongly, by one bit of
// the significand or of the exponent, is a value the journey fails on.

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

/** A fullscreen triangle. */
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, 0, 1) };
}

/** Red climbs from 0.25 in steps of 4, green runs from -3 to 2.625 in steps of 0.375, and blue is
 *  8 times the column times the row, up to 1800: the columns and rows of a 16 by 16 target. */
@fragment
export function fs(v: VsOut): Color {
  const px = floor(v.pos.x);
  const py = floor(v.pos.y);
  return { color: vec4(px * 4 + 0.25, (py - 8) * 0.375, px * py * 8, 1) };
}
