struct Frame {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (p.xy / frame.size);
  return vec4<f32>(uv.x, uv.y, 0.5, 1.0);
}
