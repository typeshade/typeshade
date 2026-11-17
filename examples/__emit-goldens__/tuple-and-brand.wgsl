const HORIZON: f32 = 8.0;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let _sm2_a0 = i32(vi);
  var _sm2_l_xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var _sm2_l_ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let _sm2_ret_0 = _sm2_l_xs[_sm2_a0];
  let _sm2_ret_1 = _sm2_l_ys[_sm2_a0];
  return vec4<f32>(_sm2_ret_0, _sm2_ret_1, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.01));
  let _sm0_a0 = uv.x;
  let span_0 = (0.05 * _sm0_a0);
  let span_1 = (HORIZON * _sm0_a0);
  let depth = ((span_0 + span_1) * 0.5);
  return vec4<f32>(uv.x, uv.y, (depth / HORIZON), 1.0);
}
