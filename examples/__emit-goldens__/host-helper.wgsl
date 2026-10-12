struct View {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> view: View;

fn height(p: vec2<f32>) -> f32 {
  return (0.5 + ((0.25 * sin((6.2831853 * p.x))) * cos((6.2831853 * p.y))));
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let h = height((p.xy / view.size));
  return vec4<f32>(h, h, h, 1.0);
}
