struct Frame {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (((2.0 * p.xy) - frame.size) / frame.size.y);
  let disc = (1.0 - smoothstep(0.0, 0.01, (length((uv - vec2<f32>(-0.5, 0.0))) - 0.3)));
  let _i0a0 = (uv - vec2<f32>(0.5, 0.0));
  let panel = (1.0 - smoothstep(0.0, 0.01, max((abs(_i0a0.x) - 0.3), (abs(_i0a0.y) - 0.2))));
  return vec4<f32>((0.1 + (0.8 * disc)), ((0.1 + (0.4 * disc)) + (0.3 * panel)), (0.15 + (0.8 * panel)), 1.0);
}
