@group(0) @binding(0) var env: texture_cube<f32>;
@group(0) @binding(1) var lut: texture_3d<f32>;
@group(0) @binding(2) var albedo: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var pointShadow: texture_depth_cube;
@group(0) @binding(5) var shadowSmp: sampler_comparison;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.004));
  let dir = normalize(vec3<f32>(((uv * 2.0) - 1.0), 1.0));
  let sky = textureSample(env, smp, dir);
  let glossy = textureSampleBias(env, smp, dir, 2.0);
  let graded = textureSampleLevel(lut, smp, sky.rgb, 0.0);
  let detail = textureSampleGrad(albedo, smp, uv, vec2<f32>(0.004, 0.0), vec2<f32>(0.0, 0.004));
  let toLight = vec3<f32>((uv - 0.5), 0.5);
  let lit = textureSampleCompare(pointShadow, shadowSmp, normalize(toLight), length(toLight));
  let size = textureDimensions(lut);
  let fade = clamp((f32(size.z) * 0.015625), 0.0, 1.0);
  let voxel = textureLoad(lut, vec3<i32>(0, 0, 0), 0u);
  let shade = ((mix(graded.rgb, glossy.rgb, 0.25) * (lit * detail.r)) * fade);
  return vec4<f32>((shade + (voxel.rgb * 0.05)), 1.0);
}
