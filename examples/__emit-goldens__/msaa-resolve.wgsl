@group(0) @binding(0) var msaa: texture_multisampled_2d<f32>;
@group(0) @binding(1) var depthMs: texture_depth_multisampled_2d;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let c = vec2<i32>(p.xy);
  let s0 = textureLoad(msaa, c, 0u);
  let s1 = textureLoad(msaa, c, 1u);
  let s2 = textureLoad(msaa, c, 2u);
  let s3 = textureLoad(msaa, c, 3u);
  let n = f32(textureNumSamples(msaa));
  let colour = ((((s0 + s1) + s2) + s3) / max(n, 1.0));
  let depth = min(textureLoad(depthMs, c, 0u), textureLoad(depthMs, c, 1u));
  let size = textureDimensions(msaa);
  let vignette = (1.0 - (0.5 * length(((p.xy / vec2<f32>(f32(size.x), f32(size.y))) - 0.5))));
  return vec4<f32>(((colour.rgb * vignette) * (1.0 - (depth * 0.25))), 1.0);
}
