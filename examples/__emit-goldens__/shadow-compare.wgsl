@group(0) @binding(0) var shadowMap: texture_depth_2d;
@group(0) @binding(1) var shadowSmp: sampler_comparison;
@group(0) @binding(2) var cascades: texture_depth_2d_array;

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
  let depthHere = (0.5 + (0.25 * sin((uv.x * 6.2831))));
  let lit = textureSampleCompare(shadowMap, shadowSmp, uv, depthHere);
  let band = i32(floor((uv.y * f32(textureNumLayers(cascades)))));
  let litFar = textureSampleCompareLevel(cascades, shadowSmp, uv, band, depthHere);
  let size = textureDimensions(shadowMap);
  let texel = (1.0 / f32(size.x));
  let shade = mix(0.15, 1.0, ((lit * 0.6) + (litFar * 0.4)));
  return vec4<f32>((shade * (0.9 - texel)), (shade * 0.8), (shade * 0.6), 1.0);
}
