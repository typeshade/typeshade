struct Frame {
  size: vec2<f32>,
  time: f32,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (p.xy / frame.size);
  let wave = (0.5 + (0.5 * sin(((12.0 * uv.x) + (3.0 * frame.time)))));
  return vec4<f32>(uv.y, (0.5 * wave), wave, 1.0);
}
