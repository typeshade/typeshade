diagnostic(off, derivative_uniformity);

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

fn banded(uv: vec2<f32>) -> vec4<f32> {
  if ((uv.x > 0.5)) {
    return textureSample(albedo, smp, uv);
  }
  let inner = (uv * 0.5);
  return textureSample(albedo, smp, inner);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let base = banded(v.uv);
  if ((tint.rgb.w > 0.5)) {
    let near = (v.uv * 0.75);
    let warm = textureSample(albedo, smp, near);
    return vec4<f32>(((base.xyz * tint.rgb.xyz) + (warm.xyz * 0.25)), 1.0);
  }
  return vec4<f32>((base.xyz * tint.rgb.xyz), 1.0);
}
