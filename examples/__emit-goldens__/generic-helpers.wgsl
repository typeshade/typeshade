fn head_f32(xs: array<f32, 3>) -> f32 {
  return xs[0];
}

fn pick_f32(c: bool, a: f32, b: f32) -> f32 {
  return select(b, a, c);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(pick_f32((vi == 0u), head_f32(xs), xs[i]), ys[i], 0.0, 1.0);
}

fn pick_vec3(c: bool, a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
  return select(b, a, c);
}

fn head_u32(xs: array<u32, 3>) -> u32 {
  return xs[0];
}

fn pair_f32(a: f32, b: f32) -> array<f32, 2> {
  let both = array<f32, 2>(a, b);
  return both;
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.01));
  let gain = pick_f32((uv.x > 0.5), 1.2, 0.6);
  let tint = pick_vec3((uv.y > 0.5), vec3<f32>(0.9, 0.4, 0.3), vec3<f32>(0.2, 0.6, 0.9));
  let steps = array<u32, 3>(2u, 3u, 5u);
  let band = (f32(head_u32(steps)) * 0.1);
  let span = pair_f32(uv.x, uv.y);
  return vec4<f32>(((tint * gain) * ((span[0] + span[1]) + band)), 1.0);
}
