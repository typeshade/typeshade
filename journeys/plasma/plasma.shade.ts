"use typeshade";

// A fullscreen effect, the first shader most people write: a fullscreen triangle and a
// fragment shader that colours each pixel from its position and a uniform the host animates.

class Frame {
  time: f32;
  scale: f32;
}

declare const frame: uniform<Frame>;

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, 0, 1) };
}

/** Where a pixel is in the pattern: a product of vectors, returned with no type written. */
function toUv(p: vec4) {
  return p.xy * frame.scale;
}

@fragment
export function fs(@builtin("position") p: vec4): Color {
  const uv = toUv(p);
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const k = f32(i + 1);
    v += (sin(uv.x * k + frame.time) * cos(uv.y * k - frame.time)) / k;
  }
  const c = v * 0.5 + 0.5;
  return { color: vec4(c, c * c, 1 - c, 1) };
}
