"use typeshade";

// The integer colour of the pass-attachments journey (proposal 0064, PR-3): one full-screen triangle,
// and a fragment that writes the unsigned values 7, 8, 9 and 10 to an rgba8uint target.

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4u;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, 0.5, 1) };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4u(7, 8, 9, 10) };
}
