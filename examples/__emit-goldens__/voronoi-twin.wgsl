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

fn hash2(c: vec2<f32>) -> vec2<f32> {
  let h = vec2<f32>(dot(c, vec2<f32>(127.1, 311.7)), dot(c, vec2<f32>(269.5, 183.3)));
  return fract((vec2<f32>(sin(h.x), sin(h.y)) * 43758.5453));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let _licm0 = U.time;
  let p = (v.uv * U.cells);
  let cell = floor(p);
  let f = fract(p);
  var md: f32 = 8.0;
  for (var j: i32 = -1; (j <= 1); j = (j + 1)) {
    for (var i: i32 = -1; (i <= 1); i = (i + 1)) {
      let g = vec2<f32>(f32(i), f32(j));
      let seed = hash2((cell + g));
      let orbit = (vec2<f32>(sin((_licm0 + (seed.x * 6.283))), cos((_licm0 + (seed.y * 6.283)))) * 0.18);
      let pt = ((g + ((seed * 0.5) + 0.25)) + orbit);
      md = min(md, distance(f, pt));
    }
  }
  let _lc0 = (md * md);
  let c = ((vec3<f32>(_lc0, _lc0, _lc0) * vec3<f32>(0.35, 0.6, 1.0)) + vec3<f32>(0.02, 0.03, 0.06));
  return vec4<f32>(c, 1.0);
}
