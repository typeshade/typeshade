"use typeshade";

/* @example
{
  "title": "A sample under a branch, and the compiler rewrites it",
  "blurb": "WGSL requires `textureSample` to be called from UNIFORM control flow (§54): the implicit level of detail is a difference between neighbouring invocations, and one that did not run has no value to difference against. A sample inside an `if` on a varying is a shader-creation error — Tint: `'textureSample' must only be called from uniform control flow`. The author writes the sample where it is, and the compiler rewrites it: it computes the coordinate again before the `if`, takes `dpdx` and `dpdy` of it there, in uniform control flow, and samples inside the branch with `textureSampleGrad` and those gradients (Rule 8.5). The emitted WGSL carries no `diagnostic(...)` directive. Beside it, a sample under a `uniform` condition, which the compiler leaves as written, because every invocation takes the same side of it.",
  "renderable": true
}
*/
// The whole `derivative_uniformity` path (§54), compiled on Tint and on ANGLE by the gate.
//
// WGSL requires `textureSample` to be called from UNIFORM control flow: the implicit level of
// detail is a difference between neighbouring invocations, and one that did not run has no
// value to difference against. A sample inside an `if` on a varying is therefore a
// shader-creation error — Tint: `'textureSample' must only be called from uniform control
// flow`.
//
// This file is the case the compiler rewrites (change 0132, Rule 8.5). The branch on `v.uv.x`
// picks between two helpers, and each samples at a coordinate computed from `v.uv`, a value
// defined before the branch. So the compiler computes each coordinate again before the `if`,
// takes `dpdx` and `dpdy` of it there, in uniform control flow, and calls a copy of each helper
// that samples with `textureSampleGrad` and those gradients. The author writes nothing for it,
// and the emitted WGSL carries no `diagnostic(...)` directive. A call the compiler cannot
// rewrite gets TS8052 with the reason.
//
// The branch on `v.uv.x` is in the ENTRY, deliberately: `v.uv` is a `location<…>` input, which
// varies by invocation by definition, so the walk knows the branch is non-uniform, and the
// gate compiles the rewritten module on Tint and on ANGLE.
//
// The uniform branch beside it is the row that used to be refused for the wrong reason: every
// invocation takes the same side of `tint.rgb.w > 0.5`, because a `uniform` holds one value
// for the whole draw, so the sample under it is uniform and the compiler leaves it as written.
//
// GLSL ES 3.00 reads the same rewritten IR: the two samples become `textureGrad` with `dFdx`
// and `dFdy` before the branch, where an implicit derivative in non-uniform control flow was
// undefined.

class Tint {
  rgb!: vec4;
}

declare const albedo: texture_2d<f32>;
declare const smp: sampler;
declare const tint: uniform<Tint>;

interface VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}

export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
});

// The two samples the branch below chooses between. Both are called from uniform control flow
// inside this helper; what is not uniform is the branch in the entry that picks one.
function sharp(uv: vec2): vec4 {
  return textureSample(albedo, smp, uv);
}

function wide(uv: vec2): vec4 {
  const inner: vec2 = uv * 0.5;
  return textureSample(albedo, smp, inner);
}

export const fs = fragment(function fs(v: VsOut): vec4 {
  // The sample under a NON-uniform condition — `v.uv` is a `location<…>` input, so the two sides
  // of this branch are taken by different invocations of the same quad. The compiler computes
  // each helper's coordinate and its gradients before the `if`, and samples with them inside.
  let base: vec4 = vec4(0., 0., 0., 1.);
  if (v.uv.x > 0.5) {
    base = sharp(v.uv);
  } else {
    base = wide(v.uv);
  }
  // A UNIFORM condition: one value for the whole draw, so every invocation takes the same
  // side and the sample under it is left as written.
  if (tint.rgb.w > 0.5) {
    const near: vec2 = v.uv * 0.75;
    const warm: vec4 = textureSample(albedo, smp, near);
    return vec4(base.xyz * tint.rgb.xyz + warm.xyz * 0.25, 1.);
  }
  return vec4(base.xyz * tint.rgb.xyz, 1.);
});
