struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;

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
  let u = ((f * f) * (vec2<f32>(3.0, 3.0) - (f * 2.0)));
  return mix(mix(hash(i), hash((i + vec2<f32>(1.0, 0.0))), u.x), mix(hash((i + vec2<f32>(0.0, 1.0))), hash((i + vec2<f32>(1.0, 1.0))), u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  return ((((noise(p) * 0.5) + (noise((p * 2.02)) * 0.25)) + (noise((p * 4.08)) * 0.125)) + (noise((p * 8.2)) * 0.0625));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let aspect = (U.resolution.x / U.resolution.y);
  let p = ((vec2<f32>((vo.uv.x * aspect), vo.uv.y) * 4.0) + vec2<f32>((U.time * 0.05), 0.0));
  let cover = smoothstep(0.35, 0.75, fbm(p));
  let sky = mix(vec3<f32>(0.18, 0.36, 0.7), vec3<f32>(0.55, 0.72, 0.92), vo.uv.y);
  return vec4<f32>(mix(sky, vec3<f32>(1.0, 1.0, 1.0), cover), 1.0);
}
