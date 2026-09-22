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
// WGSL's function attribute does not reach the functions the entry calls.
//
// The branch on `v.uv.x` is in the ENTRY, deliberately: that is the one the analysis has an
// answer about — `v.uv` is a `@location` input, which varies by invocation by definition — so
// deleting the directive line turns this file into the refusal §54 is about, and the gate
// compiles the module the directive allows. A sample under a HELPER's parameter would not
// prove the same thing: a parameter is only as uniform as the argument, which the walk reads
// from the call site rather than from the parameter, so that shape says nothing here.
//
// The uniform branch beside it is the row that used to be refused for the wrong reason: every
// invocation takes the same side of `tint.rgb.w > 0.5`, because a `uniform` holds one value
// for the whole draw, so the sample under it needs no directive at all.
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

// The two samples the branch below chooses between. Both are called from uniform control flow
// inside this helper; what is not uniform is the branch in the entry that picks one.
function sharp(uv: vec2): vec4 {
  return textureSample(albedo, smp, uv)
}

function wide(uv: vec2): vec4 {
  const inner: vec2 = uv * 0.5
  return textureSample(albedo, smp, inner)
}

@diagnostic("off", "derivative_uniformity")
@fragment
export function fs(v: VsOut): vec4 {
  // The sample under a NON-uniform condition — `v.uv` is a @location input, so the two sides
  // of this branch are taken by different invocations of the same quad. Legal only because
  // this entry carries the directive; delete that line and this is the refusal §54 is about.
  let base: vec4 = vec4(0., 0., 0., 1.)
  if (v.uv.x > 0.5) {
    base = sharp(v.uv)
  } else {
    base = wide(v.uv)
  }
  // A UNIFORM condition: one value for the whole draw, so every invocation takes the same
  // side and the sample under it needs no directive.
  if (tint.rgb.w > 0.5) {
    const near: vec2 = v.uv * 0.75
    const warm: vec4 = textureSample(albedo, smp, near)
    return vec4(base.xyz * tint.rgb.xyz + warm.xyz * 0.25, 1.)
  }
  return vec4(base.xyz * tint.rgb.xyz, 1.)
}
