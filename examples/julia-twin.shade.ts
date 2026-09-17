"use typeshade"

// The `"use typeshade"` twin of `julia.ts`.

class Uniforms {
  time: f32
  resolution: vec2
  zoom: f32
  mouse: vec4
}

declare const U: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// Iridescent cosine palette: 0.5 + 0.5·cos(2π(t + phase)). The scalar t broadcasts over the
// phase vector; cos() is component-wise.
function palette(t: f32): vec3 {
  const ph = vec3(0.0, 0.33, 0.67)
  return vec3(0.5) + cos((t + ph) * 6.283) * 0.5
}

@fragment
export function fs(vo: VsOut): vec4 {
  const uv = vo.uv
  // centre the plane, scale by the zoom uniform
  // `z` is annotated for the EDITOR, not the compiler: TypeScript types `vec2 * scalar` as
  // `number`, so the iteration below loses `z.x` and `z.y` and its reassignment draws TS2322,
  // on a program that compiles (issue #43). Emit-neutral: the WGSL and GLSL are byte-identical
  // without it.
  let z: vec2 = vec2(uv.x * 2. - 1., uv.y * 2. - 1.) * U.zoom
  // the Julia constant: orbits on autopilot; once the pointer has entered (m.w = 1) it maps
  // to the pointer instead. The pointer is normalised to c-space ≈ [−0.8, 0.8]².
  const m = U.mouse
  const res = U.resolution
  const orbit = vec2(cos(U.time * 0.31) * 0.39 - 0.4, sin(U.time * 0.41) * 0.39)
  const held = vec2((m.x / res.x * 2. - 1.) * 0.8, (m.y / res.y * 2. - 1.) * 0.8)
  const c = mix(orbit, held, m.w)
  let it = 0.
  for (let i: u32 = 0; i < 96; i++) {
    if (dot(z, z) > 4.) {
      break
    }
    z = vec2(z.x * z.x - z.y * z.y + c.x, z.x * z.y * 2. + c.y)
    it = it + 1.
  }
  // outside points (never escaped) → black core; escaped → palette by iteration
  const col = palette(it / 96. + U.time * 0.05)
  return vec4(col * (it / 96.), 1.)
}
