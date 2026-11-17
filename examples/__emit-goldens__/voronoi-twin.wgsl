struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  cells: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let _licm0 = vec2<f32>(127.1, 311.7);
  let _licm1 = vec2<f32>(269.5, 183.3);
  let _licm2 = U.time;
  let p = (v.uv * U.cells);
  let cell = floor(p);
  let f = fract(p);
  var md: f32 = 8.0;
  for (var j: i32 = -1; (j <= 1); j = (j + 1)) {
    for (var i: i32 = -1; (i <= 1); i = (i + 1)) {
      let g = vec2<f32>(f32(i), f32(j));
      let _sm0_a0 = (cell + g);
      let _sm0_l_h = vec2<f32>(dot(_sm0_a0, _licm0), dot(_sm0_a0, _licm1));
      let _sm0_ret = fract((vec2<f32>(sin(_sm0_l_h.x), sin(_sm0_l_h.y)) * 43758.5453));
      let orbit = (vec2<f32>(sin((_licm2 + (_sm0_ret.x * 6.283))), cos((_licm2 + (_sm0_ret.y * 6.283)))) * 0.18);
      let pt = ((g + ((_sm0_ret * 0.5) + 0.25)) + orbit);
      md = min(md, distance(f, pt));
    }
  }
  let _lc0 = (md * md);
  let c = ((vec3<f32>(_lc0, _lc0, _lc0) * vec3<f32>(0.35, 0.6, 1.0)) + vec3<f32>(0.02, 0.03, 0.06));
  return vec4<f32>(c, 1.0);
}
