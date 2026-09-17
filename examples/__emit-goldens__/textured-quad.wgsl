override tint: f32 = 0.85;
override desaturate: f32 = 0.0;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let texel = textureSample(tex, smp, v.uv);
  let dims = textureDimensions(tex);
  let width = f32(dims.x);
  let edge = clamp(((v.uv.x * width) / (width + 1.0)), 0.0, 1.0);
  let grey = dot(texel.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let mixed = mix(texel.rgb, vec3<f32>(grey, grey, grey), vec3<f32>(desaturate, desaturate, desaturate));
  let shaded = (mixed * (tint * edge));
  return Color(vec4<f32>(shaded, texel.a));
}
