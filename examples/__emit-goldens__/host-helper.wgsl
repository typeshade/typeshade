struct View {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> view: View;

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let _sm0_a0 = (p.xy / view.size);
  let h = (0.5 + ((0.25 * sin((6.2831853 * _sm0_a0.x))) * cos((6.2831853 * _sm0_a0.y))));
  return vec4<f32>(h, h, h, 1.0);
}
