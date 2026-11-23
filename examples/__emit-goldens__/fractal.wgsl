struct Frame {
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

fn rounds(c: vec2<f32>) -> f32 {
  var z: vec2<f32> = vec2<f32>(0.0, 0.0);
  var count: f32 = 0.0;
  for (var i: i32 = 0; (i < 32); i = (i + 1)) {
    if ((length(z) > 2.0)) {
      break;
    }
    z = (vec2<f32>(((z.x * z.x) - (z.y * z.y)), ((2.0 * z.x) * z.y)) + c);
    count += 1.0;
  }
  return (count * 0.03125);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (((2.0 * p.xy) - frame.size) / frame.size.y);
  let t = rounds(((1.3 * uv) - vec2<f32>(0.6, 0.0)));
  return vec4<f32>(t, (sqrt(t) * 0.8), (1.0 - t), 1.0);
}
