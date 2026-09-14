"use typeshade"

// The `"use typeshade"` twin of `starfield.ts`. `screenCoords` is a helper
// function here rather than an import — see `plasma-twin.shade.ts` on the
// repeated head.

class Uniforms {
  time: f32
  resolution: vec2
  density: f32
}

declare const U: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

// Centred, isotropic screen coordinates: y spans ±1 over the height and x spans
// ±aspect over the width, so one unit covers the same pixels on both axes.
function screenCoords(uv: vec2, resolution: vec2): vec2 {
  const asp = resolution.x / resolution.y
  return vec2((uv.x * 2. - 1.) * asp, uv.y * 2. - 1.)
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// scalar hash of a lattice point → [0,1)
function hash(p: vec2): f32 {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
}

@fragment
export function fs(vo: VsOut): vec4 {
  const t = U.time
  const res = U.resolution
  const p = screenCoords(vo.uv, res)
  let col = vec3(0., 0., 0.)
  // three parallax layers — nearer (coarser) layers drift faster
  for (let i: u32 = 0; i < 3; i++) {
    const fi = f32(i)
    const scale = fi * 14. + 18.
    const drift = fi * 0.014 + 0.01
    // Annotated for the EDITOR, not for the compiler. TypeScript types `vec2 * scalar` as
    // `number`, so `q` here and `sp` below would each draw TS2345 where they are next used, on
    // a program that compiles (issue #43). Emit-neutral: the WGSL and GLSL are byte-identical
    // without either annotation.
    const q: vec2 = vec2(p.x + t * drift, p.y) * scale + fi * 37.7
    const cell = floor(q)
    const f = fract(q)
    const h = hash(cell)
    // does this cell hold a star? density raises the hash gate
    const gate = step(0.92 - U.density * 0.25, h)
    // star position inside the cell (kept off the cell edges)
    const sp: vec2 = vec2(hash(cell + vec2(12.3, 45.6)), hash(cell + vec2(78.9, 1.2))) * 0.7 + 0.15
    const d = distance(f, sp)
    const rad = 0.06 - fi * 0.012 // far layers are smaller
    const core = 1. - smoothstep(0., rad, d)
    const twinkle = sin(t * (h * 4. + 2.) + h * 40.) * 0.4 + 0.6
    const b = core * core * twinkle * gate * (1. - fi * 0.25)
    // colour temperature from the hash: blue-white ↔ warm
    const tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), h)
    col = col + tint * b
  }
  // a faint diagonal Milky-Way band
  const s = p.y + p.x * 0.35
  const band = exp(-(s * s * 6.))
  return vec4(col + vec3(0.09, 0.11, 0.16) * band, 1.)
}
