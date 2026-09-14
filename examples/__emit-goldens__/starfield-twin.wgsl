struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  density: f32,
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

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let _licm0 = (0.92 - (U.density * 0.25));
  let _licm1 = vec2<f32>(12.3, 45.6);
  let _licm2 = vec2<f32>(78.9, 1.2);
  let _licm3 = vec3<f32>(0.75, 0.85, 1.0);
  let _licm4 = vec3<f32>(1.0, 0.9, 0.75);
  let t = U.time;
  let res = U.resolution;
  let p = screenCoords(vo.uv, res);
  var col: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  for (var i: u32 = 0u; (i < 3u); i = (i + 1u)) {
    let fi = f32(i);
    let scale = ((fi * 14.0) + 18.0);
    let drift = ((fi * 0.014) + 0.01);
    let q = ((vec2<f32>((p.x + (t * drift)), p.y) * scale) + (fi * 37.7));
    let cell = floor(q);
    let f = fract(q);
    let h = hash(cell);
    let gate = step(_licm0, h);
    let sp = ((vec2<f32>(hash((cell + _licm1)), hash((cell + _licm2))) * 0.7) + 0.15);
    let d = distance(f, sp);
    let rad = (0.06 - (fi * 0.012));
    let core = (1.0 - smoothstep(0.0, rad, d));
    let twinkle = ((sin(((t * ((h * 4.0) + 2.0)) + (h * 40.0))) * 0.4) + 0.6);
    let b = ((((core * core) * twinkle) * gate) * (1.0 - (fi * 0.25)));
    let tint = mix(_licm3, _licm4, h);
    col = (col + (tint * b));
  }
  let s = (p.y + (p.x * 0.35));
  let band = exp((-((s * s) * 6.0)));
  return vec4<f32>((col + (vec3<f32>(0.09, 0.11, 0.16) * band)), 1.0);
}
