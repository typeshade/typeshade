"use typeshade"

// Builtin breadth (roadmap 0.2 item 8, §10): `reflect`, `refract` and `faceForward` light a
// bump, `transpose` and `determinant` read the host's matrix, `ldexp` halves the diffuse term,
// the bit builtins band the screen by the column's index, and `fwidthCoarse` draws a line where
// a band starts. GLSL ES 3.00 spells several of these differently (`faceforward`, `bitCount`,
// `bitfieldReverse`, `bitfieldExtract`, `bitfieldInsert`, and `findMSB` cast back to `uint`),
// and the compile gate runs both targets, so the two spellings agree about the picture.

class Frame {
  m: mat4
}

declare const frame: uniform<Frame>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  const p: vec2 = vec2(xs[i], ys[i])
  return { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) }
}

@fragment
export function fs(v: VsOut): vec4 {
  // A bump whose normal tilts away from the centre, lit from the upper left, seen head on.
  const c: vec2 = v.uv - vec2(0.5, 0.5)
  const n: vec3 = normalize(vec3(c.x, c.y, 0.6))
  const toLight: vec3 = normalize(vec3(-0.4, 0.5, 0.75))
  const fromLight: vec3 = normalize(vec3(0.4, -0.5, -0.75))
  const toEye: vec3 = vec3(0., 0., 1.)
  const fromEye: vec3 = vec3(0., 0., -1.)
  // faceForward turns the normal toward the eye; reflect gives the highlight; refract is the
  // direction the view leaves through the surface, which tints the picture.
  const nf: vec3 = faceForward(n, fromEye, n)
  const highlight: f32 = pow(max(dot(reflect(fromLight, nf), toEye), 0.), 16.)
  const bent: vec3 = refract(fromEye, nf, 0.75)
  const half: i32 = -1
  const diffuse: f32 = ldexp(max(dot(nf, toLight), 0.), half)
  // The host's matrix: a transpose keeps the determinant, which scales the highlight, so an
  // identity gives the plain picture.
  const gain: f32 = determinant(transpose(frame.m))
  // Three bands from the column's index: its leading bit, its low nibble read back through
  // the reversed word, and its count of set bits written into bits 8 to 11 and pulled out.
  const col: u32 = u32(v.uv.x * 255.) + 1
  const lead: u32 = firstLeadingBit(col)
  const nibble: u32 = extractBits(reverseBits(col), 28, 4)
  const word: u32 = insertBits(col, countOneBits(col), 8, 4)
  const bands: vec3 = vec3(f32(lead) / 8., f32(nibble) / 16., f32(extractBits(word, 8, 4)) / 8.)
  // The coarse derivative of the leading bit is nonzero only where a band starts.
  const edge: f32 = min(fwidthCoarse(f32(lead)), 1.)
  const lit: vec3 = bands * diffuse
  const tint: vec3 = bent * 0.1
  const base: vec3 = lit + tint
  const shine: vec3 = vec3(highlight * gain, highlight * gain, highlight * gain)
  const color: vec3 = mix(base, vec3(1., 1., 1.), edge)
  const out: vec3 = color + shine
  return vec4(out, 1.)
}
