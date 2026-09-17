struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  swell: f32,
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

fn hash(p: vec2<f32>) -> f32 {
  return fract((sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453));
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = ((f * f) * (vec2<f32>(3.0, 3.0) - (f * 2.0)));
  return mix(mix(hash(i), hash((i + vec2<f32>(1.0, 0.0))), u.x), mix(hash((i + vec2<f32>(0.0, 1.0))), hash((i + vec2<f32>(1.0, 1.0))), u.x), u.y);
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let t = U.time;
  let res = U.resolution;
  let asp = (res.x / res.y);
  let x = (((vo.uv.x * 2.0) - 1.0) * asp);
  let y = vo.uv.y;
  let sky = mix(vec3<f32>(0.83, 0.58, 0.38), vec3<f32>(0.12, 0.28, 0.48), smoothstep(0.58, 1.0, y));
  let y2 = ((y * 2.0) - 1.0);
  let dSun = distance(vec2<f32>(x, y2), vec2<f32>(0.42, 0.56));
  let sun = (1.0 - smoothstep(0.035, 0.06, dSun));
  let halo = (exp((-(dSun * 4.0))) * 0.35);
  let _cse0 = vec3<f32>(1.0, 0.85, 0.6);
  let skyCol = (sky + (_cse0 * (sun + halo)));
  let dpt = max((0.58 - y), 0.0008);
  let wz = (0.06 / dpt);
  let sp = (vec2<f32>(((x * wz) * 0.6), (wz + (t * 0.6))) * 3.0);
  var h: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  for (var i: u32 = 0u; (i < 4u); i = (i + 1u)) {
    h = (h + (amp * noise(((sp * freq) + vec2<f32>((t * 0.12), 0.0)))));
    freq = (freq * 2.03);
    amp = (amp * 0.5);
  }
  let wave = ((h * U.swell) * smoothstep(0.0, 0.05, dpt));
  let sea = (mix(vec3<f32>(0.05, 0.18, 0.28), vec3<f32>(0.55, 0.5, 0.45), exp((-(dpt * 7.0)))) + (vec3<f32>(0.3, 0.38, 0.36) * wave));
  let glint = ((pow((max((wave - 0.32), 0.0) * 2.6), 3.0) * exp((-(abs((x - 0.42)) * 2.2)))) * exp((-(dpt * 2.5))));
  let seaCol = (sea + (_cse0 * clamp(glint, 0.0, 1.2)));
  let col = mix(seaCol, skyCol, step(0.58, y));
  return vec4<f32>(col, 1.0);
}
