struct Uniforms {
  resolution: vec2<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var blurX: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let _licm0 = v.pos.xy;
  let size = max(u.resolution, vec2<f32>(1.0, 1.0));
  var sum: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var total: f32 = 0.0;
  for (var i: i32 = -4; (i <= 4); i = (i + 1)) {
    let w = exp(((-f32((i * i))) * 0.125));
    let at = ((_licm0 + vec2<f32>(0.0, (f32(i) * 1.5))) / size);
    sum = (sum + (textureSampleLevel(blurX, smp, at, 0.0).rgb * w));
    total = (total + w);
  }
  return Color(vec4<f32>((sum / total), 1.0));
}
