const PALETTE: array<vec3<f32>, 4> = array<vec3<f32>, 4>(vec3<f32>(0.1, 0.1, 0.35), vec3<f32>(0.8, 0.2, 0.4), vec3<f32>(0.98, 0.65, 0.2), vec3<f32>(1.0, 0.95, 0.7));

struct Frame {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (p.xy / frame.size);
  let wavy = (uv.x + (0.1 * sin((10.0 * uv.y))));
  let _i0_scaled = (clamp(wavy, 0.0, 0.999) * 3.0);
  let _i0_i = i32(_i0_scaled);
  let _i0ret = mix(PALETTE[_i0_i], PALETTE[(_i0_i + 1)], fract(_i0_scaled));
  return vec4<f32>(_i0ret, 1.0);
}
