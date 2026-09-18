struct Palette {
  lo: vec3<f32>,
  hi: vec3<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((frag.xy * 0.008));
  let warm = Palette(vec3<f32>(0.35, 0.1, 0.05), vec3<f32>(1.0, 0.75, 0.35));
  let cool = Palette(vec3<f32>(0.04, 0.1, 0.3), vec3<f32>(0.5, 0.85, 1.0));
  var _sel0: Palette;
  if ((uv.x > 0.5)) {
    _sel0 = warm;
  } else {
    _sel0 = cool;
  }
  let shade = _sel0;
  let rising = array<f32, 3>(0.15, 0.5, 0.9);
  let falling = array<f32, 3>(0.9, 0.5, 0.15);
  var _sel1: array<f32, 3>;
  if ((uv.y > 0.5)) {
    _sel1 = rising;
  } else {
    _sel1 = falling;
  }
  let steps = _sel1;
  let band = i32(floor((uv.y * 3.0)));
  let t = smoothstep(0.0, 1.0, steps[band]);
  return vec4<f32>(mix(shade.lo, shade.hi, t), 1.0);
}
