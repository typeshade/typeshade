struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  segments: f32,
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

fn hash32(x: u32) -> u32 {
  let a = ((x ^ (x >> 16u)) * 2246822519u);
  let b = ((a ^ (a >> 13u)) * 3266489917u);
  return (b ^ (b >> 16u));
}

fn hash(p: vec2<f32>) -> f32 {
  let h = hash32((u32(i32(p.x)) ^ hash32(u32(i32(p.y)))));
  return (f32((h >> 8u)) * 5.960464477539063e-8);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = ((f * f) * (vec2<f32>(3.0) - (f * 2.0)));
  return mix(mix(hash(i), hash((i + vec2<f32>(1.0, 0.0))), u.x), mix(hash((i + vec2<f32>(0.0, 1.0))), hash((i + vec2<f32>(1.0, 1.0))), u.x), u.y);
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let t = U.time;
  let res = U.resolution;
  let _i0a0 = vo.uv;
  let _i0_asp = (res.x / res.y);
  let _gv0 = (((_i0a0.x * 2.0) - 1.0) * _i0_asp);
  let _gv1 = ((_i0a0.y * 2.0) - 1.0);
  let _i0ret = vec2<f32>(_gv0, _gv1);
  let r = length(_i0ret);
  let a0 = atan2(_gv1, _gv0);
  let sector = (6.2831853 / U.segments);
  let am = (a0 - sector * floor(a0 / sector));
  let af = abs((am - (sector * 0.5)));
  let q = (vec2<f32>(cos(af), sin(af)) * r);
  let _i1a0 = ((q * 3.0) + vec2<f32>((t * 0.12), (-(t * 0.09))));
  let v = ((((noise(_i1a0) * 0.5) + (noise((_i1a0 * 2.02)) * 0.25)) + (noise((_i1a0 * 4.08)) * 0.125)) + (noise((_i1a0 * 8.2)) * 0.0625));
  let rings = ((sin(((r * 9.0) - (t * 0.8))) * 0.5) + 0.5);
  let _i2a0 = ((((v * 0.7) + (rings * 0.15)) + (r * 0.3)) - (t * 0.03));
  let _i2_ph = vec3<f32>(0.0, 0.33, 0.67);
  let _i2ret = (vec3<f32>(0.5) + (cos(((_i2a0 + _i2_ph) * 6.283)) * 0.5));
  let relief = ((v * 0.9) + 0.35);
  let vig = (1.0 - smoothstep(0.55, 1.25, r));
  return vec4<f32>(((_i2ret * relief) * vig), 1.0);
}
