"use typeshade"

// A per-invocation variable (roadmap 0.2 item 5, §24): a plain top-level `let seed: u32` is
// WGSL's `var<private>`, one copy per invocation that every function of the invocation shares,
// so a random-number generator can keep its state in it instead of threading a seed through
// each call. GLSL ES 3.00 spells it as a plain global, which is per-invocation there too, so
// this renders on both targets and the compile gate runs it on Tint and ANGLE.
//
// Renders a hash-noise field: each pixel seeds the generator from its position and draws three
// values from it.

let seed: u32 = 7

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class FsOut {
  @location(0) color: vec4
}

// Fullscreen triangle, as `cutout.shade.ts` draws it.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) }
}

// A linear congruential step on the invocation's own state, then the top 24 bits as a float
// in [0, 1).
function next(): f32 {
  seed = seed * 1664525 + 1013904223
  return f32(seed >> 8) / 16777216.
}

@fragment
export function fs(v: VsOut): FsOut {
  const cell = vec2u(u32((v.uv.x + 1.) * 32.), u32((v.uv.y + 1.) * 32.))
  seed = cell.x * 1973 + cell.y * 9277 + 26699
  const r = next()
  const g = next()
  const b = next()
  return { color: vec4(r, g, b, 1.) }
}
