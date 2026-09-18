struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let past = (v.uv > vec2<f32>(0.5, 0.5));
  let cool = vec3<f32>(0.1, 0.3, 0.8);
  let warm = vec3<f32>(0.9, 0.5, 0.1);
  let _cse0 = (v.uv.x > 0.5);
  let mask = vec3<bool>(_cse0, _cse0, (v.uv.y > 0.5));
  var color: vec3<f32> = select(cool, warm, mask);
  if (all(past)) {
    color = (color * 1.2);
  } else if ((any(past) == false)) {
    color = (color * 0.6);
  }
  return vec4<f32>(color, 1.0);
}
