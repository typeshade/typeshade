@group(0) @binding(0) var<uniform> scale: f32;

@fragment
fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(scale, 0.0, 0.0, 1.0);
}
