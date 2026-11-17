@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(select(xs[i], xs[0], (vi == 0u)), ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.01));
  let gain = select(0.6, 1.2, (uv.x > 0.5));
  let tint = select(vec3<f32>(0.2, 0.6, 0.9), vec3<f32>(0.9, 0.4, 0.3), (uv.y > 0.5));
  let _sm0_a0 = uv.x;
  let _sm0_a1 = uv.y;
  return vec4<f32>(((tint * gain) * ((_sm0_a0 + _sm0_a1) + 0.2)), 1.0);
}
