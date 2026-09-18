const HORIZON: f32 = 8.0;

fn bounds(scale: f32) -> array<f32, 2> {
  return array<f32, 2>((0.05 * scale), (HORIZON * scale));
}

fn mid(span: array<f32, 2>) -> f32 {
  return ((span[0] + span[1]) * 0.5);
}

fn corner(i: i32) -> array<f32, 2> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  return array<f32, 2>(xs[i], ys[i]);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let c = corner(i32(vi));
  return vec4<f32>(c[0], c[1], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.01));
  let span = bounds(uv.x);
  let depth = mid(array<f32, 2>(span[0], span[1]));
  return vec4<f32>(uv.x, uv.y, (depth / HORIZON), 1.0);
}
