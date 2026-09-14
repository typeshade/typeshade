"use typeshade"

// Module-scope constants of every scalar type the compiler allows, each one USED, so the
// compile gate hands their spelling to Tint and to a real WebGL2 context on every run.
//
// That is the point of this example. Until #13 an integer const emitted
// `const TILES: u32 = 8.0;` — which Tint refuses ("cannot convert value of type
// 'abstract-float' to type 'u32'") and WebGL2 refuses the same way — and nothing caught it,
// because no example in EITHER corpus declared an integer module constant. A unit test on
// the spelling would have been enough to catch the regression; only a registered example
// proves the bytes a real driver sees.
//
// No bindings on purpose: a binding would drag in #14, which drops a source-compiled
// module's uniform block from the GLSL while keeping the uses.

const TILES: u32 = 8
const PHASE: i32 = -3
const GAMMA: f32 = 2.2
const INVERT: bool = true

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

// Oversized fullscreen triangle — 3 verts, no vertex buffer.
@vertex
export function vs(@builtin("vertex_index") idx: u32): VsOut {
  const x = f32(idx & 1) * 4. - 1.
  const y = f32(idx >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// A checkerboard: TILES sets the frequency, PHASE shifts which square is lit, GAMMA shapes
// the vertical ramp, INVERT flips the two shades.
@fragment
export function fs(vo: VsOut): vec4 {
  const cx = u32(vo.uv.x * f32(TILES))
  const cy = u32(vo.uv.y * f32(TILES))
  const parity = (cx + cy + u32(PHASE + 8)) & 1
  const ramp = pow(vo.uv.y, GAMMA)
  const dark = ramp * 0.25
  const v = parity === 0 ? (INVERT ? dark : ramp) : (INVERT ? ramp : dark)
  return vec4(v, v, v, 1.)
}
