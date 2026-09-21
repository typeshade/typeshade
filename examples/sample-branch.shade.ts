"use typeshade"

// The whole `derivative_uniformity` path (§54), compiled on Tint and on ANGLE by the gate.
//
// WGSL requires `textureSample` to be called from UNIFORM control flow: the implicit level of
// detail is a difference between neighbouring invocations, and one that did not run has no
// value to difference against. A sample inside an `if` on a varying is therefore a
// shader-creation error — Tint: `'textureSample' must only be called from uniform control
// flow` — and this compiler now refuses it at the call.
//
// This file is the OTHER half: the author who wants the branch anyway, and says so. The
// `@diagnostic("off", "derivative_uniformity")` on the entry emits WGSL's module-scope
// `diagnostic(off, derivative_uniformity);`, and Tint takes the module as written. It is on
// the entry because that is where the decision belongs, and module-scope in the emit because
// WGSL's function attribute does not reach the functions the entry calls — `banded` here is
// one, and the sample is inside it.
//
// The uniform branch beside it is the row that used to be refused for the wrong reason: every
// invocation takes the same side of `tint.x > 0.5`, because a `uniform` holds one value for
// the whole draw, so the sample under it needs no directive at all.
//
// GLSL ES 3.00 has nothing to say about any of it: an implicit derivative in non-uniform
// control flow is undefined there rather than refused, so its text carries no directive and
// the picture is the same one.

class Tint {
  rgb: vec4
}

declare const albedo: texture_2d<f32>
declare const smp: sampler
declare const tint: uniform<Tint>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// The sample under a NON-uniform condition, in a helper the entry calls. Legal only because
// the entry carries the directive; without it this is the refusal §54 is about.
function banded(uv: vec2): vec4 {
  if (uv.x > 0.5) {
    return textureSample(albedo, smp, uv)
  }
  const inner: vec2 = uv * 0.5
  return textureSample(albedo, smp, inner)
}

@diagnostic("off", "derivative_uniformity")
@fragment
export function fs(v: VsOut): vec4 {
  const base: vec4 = banded(v.uv)
  // A UNIFORM condition: one value for the whole draw, so every invocation takes the same
  // side and the sample under it needs no directive.
  if (tint.rgb.w > 0.5) {
    const near: vec2 = v.uv * 0.75
    const warm: vec4 = textureSample(albedo, smp, near)
    return vec4(base.xyz * tint.rgb.xyz + warm.xyz * 0.25, 1.)
  }
  return vec4(base.xyz * tint.rgb.xyz, 1.)
}
