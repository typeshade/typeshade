@group(0) @binding(0) var ramp: texture_1d<f32>;
@group(0) @binding(1) var envs: texture_cube_array<f32>;
@group(0) @binding(2) var albedo: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var shadow: texture_depth_2d;
@group(0) @binding(5) var pointShadows: texture_depth_cube_array;
@group(0) @binding(6) var shadowSmp: sampler_comparison;

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
  let heat = textureSample(ramp, smp, uv.x);
  let steps = f32(textureDimensions(ramp));
  let layer = i32(floor((uv.y * f32(textureNumLayers(envs)))));
  let sky = textureSample(envs, smp, dir, layer);
  let dull = textureSampleLevel(envs, smp, dir, layer, 3.0);
  let reds = textureGather(0, albedo, smp, uv);
  let edge = (abs((reds.x - reds.z)) + abs((reds.y - reds.w)));
  let passes = textureGatherCompare(shadow, shadowSmp, uv, 0.5);
  let lit = dot(passes, vec4<f32>(0.25, 0.25, 0.25, 0.25));
  let toLight = vec3<f32>((uv - 0.5), 0.5);
  let litPoint = textureSampleCompare(pointShadows, shadowSmp, normalize(toLight), layer, length(toLight));
  let shade = ((mix(sky.rgb, dull.rgb, 0.5) * (0.4 + ((0.6 * lit) * litPoint))) + (heat.rgb * edge));
  return vec4<f32>((shade * clamp((steps * 0.00390625), 0.5, 1.0)), 1.0);
}
