"use typeshade"

// User clip planes: `@builtin("clip_distances")`, the vertex output the rasterizer reads
// before it rasterizes anything (surface doc §50).
//
// It is the example for the rule that writing the id IS the declaration. Nothing below names
// a capability, an extension or a feature, and the emitted WGSL still opens with
//
//   enable clip_distances;
//
// because WGSL refuses `@builtin(clip_distances)` without it — Tint says `use of
// '@builtin(clip_distances)' requires enabling extension 'clip_distances'`. `reflect()`
// reports the neutral capability `clipDistances`, and `hostFeaturesFor(wgslBackend, …)` turns
// that into `clip-distances`, which is what the host passes `requestDevice`. The compile gate
// does exactly that, which is why this file compiles there.
//
// WGSL-ONLY (`renderable: false`). GLSL ES 3.00 has `gl_ClipDistance` behind
// `EXT_clip_cull_distance`, an extension WebGL2 does not expose, so the capability has no row
// in that backend's profile and `emitGlslModule` fails the module closed naming it. That
// refusal is the point: a WebGL2 driver would otherwise link a shader whose clip planes
// silently do nothing.

class Planes {
  // Four planes, each `dot(plane, vec4(pos, 1.))` — the standard ax + by + cz + d form.
  a: vec4
  b: vec4
  c: vec4
  d: vec4
}

declare const planes: uniform<Planes>

class VsOut {
  @builtin("position") pos: vec4
  // The one built-in value whose type the AUTHOR picks: `array<f32, N>` with N from 1 to 8.
  // A wider one, or any other type, is refused at this line.
  @builtin("clip_distances") clip: array<f32, 4>
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  const p = vec4(x, y, 0., 1.)
  let o = new VsOut()
  o.pos = p
  o.uv = vec2(x * 0.5 + 0.5, y * 0.5 + 0.5)
  // A negative distance clips the fragment against that plane.
  o.clip[0] = dot(planes.a, p)
  o.clip[1] = dot(planes.b, p)
  o.clip[2] = dot(planes.c, p)
  o.clip[3] = dot(planes.d, p)
  return o
}

// The fragment stage takes its OWN struct, not `VsOut`. `clip_distances` is a vertex output
// and nothing else — WGSL never hands it to a fragment entry — so a fragment parameter
// carrying it is refused at the authoring line (`Builtin "clip_distances" is not a valid
// fragment input; it is a vertex output.`). The two structs share the `@location(0) uv`
// varying, which is the one the rasterizer actually interpolates.
class FsIn {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@fragment
export function fs(v: FsIn): vec4 {
  // Whatever survives the four planes is shaded normally.
  return vec4(v.uv, 0.5, 1.)
}
