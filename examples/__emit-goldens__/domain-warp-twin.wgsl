struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  warp: f32,
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

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let t = U.time;
  let res = U.resolution;
  let p = (screenCoords(vo.uv, res) * 1.8);
  let w = U.warp;
  let q = vec2<f32>(fbm(p), fbm((p + vec2<f32>(5.2, 1.3))));
  let pq = (p + (q * w));
  let r = vec2<f32>(fbm(((pq + vec2<f32>(1.7, 9.2)) + vec2<f32>((t * 0.15), (t * 0.12)))), fbm((pq + vec2<f32>(8.3, 2.8))));
  let f = fbm((p + (r * w)));
  let a = mix(vec3<f32>(0.09, 0.12, 0.2), vec3<f32>(0.85, 0.83, 0.72), clamp(((f * f) * 2.8), 0.0, 1.0));
  let b = mix(a, vec3<f32>(0.2, 0.5, 0.55), clamp((length(q) * 0.9), 0.0, 1.0));
  let c = mix(b, vec3<f32>(0.66, 0.3, 0.2), clamp((smoothstep(0.4, 1.0, r.y) * 0.6), 0.0, 1.0));
  return vec4<f32>((c * ((f * 1.4) + 0.35)), 1.0);
}
