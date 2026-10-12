struct Frame {
  time: f32,
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (p.xy / frame.size);
  let wave = (0.5 + (0.5 * sin(((6.2831853 * uv.x) + frame.time))));
  return vec4<f32>(uv.x, uv.y, wave, 1.0);
}
