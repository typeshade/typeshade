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

fn screenCoords(uv: vec2<f32>, resolution: vec2<f32>) -> vec2<f32> {
  let asp = (resolution.x / resolution.y);
  return vec2<f32>((((uv.x * 2.0) - 1.0) * asp), ((uv.y * 2.0) - 1.0));
}

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

fn fbm(p: vec2<f32>) -> f32 {
  return ((((noise(p) * 0.5) + (noise((p * 2.02)) * 0.25)) + (noise((p * 4.08)) * 0.125)) + (noise((p * 8.2)) * 0.0625));
}

fn palette(t: f32) -> vec3<f32> {
  let ph = vec3<f32>(0.0, 0.33, 0.67);
  return (vec3<f32>(0.5, 0.5, 0.5) + (cos(((t + ph) * 6.283)) * 0.5));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let t = U.time;
  let res = U.resolution;
  let p = screenCoords(vo.uv, res);
  let r = length(p);
  let a0 = atan2(p.y, p.x);
  let sector = (6.2831853 / U.segments);
  let am = (a0 - sector * floor(a0 / sector));
  let af = abs((am - (sector * 0.5)));
  let q = (vec2<f32>(cos(af), sin(af)) * r);
  let v = fbm(((q * 3.0) + vec2<f32>((t * 0.12), (-(t * 0.09)))));
  let rings = ((sin(((r * 9.0) - (t * 0.8))) * 0.5) + 0.5);
  let col = palette(((((v * 0.7) + (rings * 0.15)) + (r * 0.3)) - (t * 0.03)));
  let relief = ((v * 0.9) + 0.35);
  let vig = (1.0 - smoothstep(0.55, 1.25, r));
  return vec4<f32>(((col * relief) * vig), 1.0);
}
