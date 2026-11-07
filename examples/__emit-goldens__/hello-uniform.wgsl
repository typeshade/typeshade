@group(0) @binding(0) var<uniform> scale: f32;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let x = ((f32(((vi << 1u) & 2u)) * 2.0) - 1.0);
  let y = ((f32((vi & 2u)) * 2.0) - 1.0);
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(scale, 0.0, 0.0, 1.0);
}
