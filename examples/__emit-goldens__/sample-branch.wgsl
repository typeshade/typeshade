struct Tint {
  rgb: vec4<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var albedo: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> tint: Tint;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

fn sharp(uv: vec2<f32>) -> vec4<f32> {
  return textureSample(albedo, smp, uv);
}

fn sharp_grad(uv: vec2<f32>, hoist_gx_h0: vec2<f32>, hoist_gy_h1: vec2<f32>) -> vec4<f32> {
  return textureSampleGrad(albedo, smp, uv, hoist_gx_h0, hoist_gy_h1);
}

fn wide(uv: vec2<f32>) -> vec4<f32> {
  let inner = (uv * 0.5);
  return textureSample(albedo, smp, inner);
}

fn wide_grad(uv: vec2<f32>, hoist_gx_h0: vec2<f32>, hoist_gy_h1: vec2<f32>) -> vec4<f32> {
  let inner = (uv * 0.5);
  return textureSampleGrad(albedo, smp, inner, hoist_gx_h0, hoist_gy_h1);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  var base: vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  let uv_h0 = v.uv;
  let hoist_gx_h1 = dpdx(uv_h0);
  let hoist_gy_h2 = dpdy(uv_h0);
  let uv_h1 = v.uv;
  let inner_h2 = (uv_h1 * 0.5);
  let hoist_gx_h3 = dpdx(inner_h2);
  let hoist_gy_h4 = dpdy(inner_h2);
  if ((v.uv.x > 0.5)) {
    base = sharp_grad(v.uv, hoist_gx_h1, hoist_gy_h2);
  } else {
    base = wide_grad(v.uv, hoist_gx_h3, hoist_gy_h4);
  }
  if ((tint.rgb.w > 0.5)) {
    let near = (v.uv * 0.75);
    let warm = textureSample(albedo, smp, near);
    return vec4<f32>(((base.xyz * tint.rgb.xyz) + (warm.xyz * 0.25)), 1.0);
  }
  return vec4<f32>((base.xyz * tint.rgb.xyz), 1.0);
}
