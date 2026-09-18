const WARM: vec3<f32> = vec3<f32>(1.0, 0.72, 0.42);

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

fn grade(c: vec3<f32>, gamma: f32) -> vec3<f32> {
  let _cse0 = (1.0 / gamma);
  return pow(max(c, vec3<f32>(0.0, 0.0, 0.0)), vec3<f32>(_cse0, _cse0, _cse0));
}

fn vignette(uv: vec2<f32>, strength: f32, softness: f32) -> f32 {
  return (1.0 - (strength * smoothstep(0.0, softness, dot(uv, uv))));
}

fn bands(uv: vec2<f32>, tint: vec3<f32>, count: f32) -> vec3<f32> {
  let t = ((fract((uv.y * count)) * 0.35) + 0.65);
  return (tint * t);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), p);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let cool = bands(v.uv, vec3<f32>(0.38, 0.6, 1.0), 10.0);
  let warm = bands(v.uv, WARM, 6.0);
  let mixed = mix(cool, warm, smoothstep(-1.0, 1.0, v.uv.x));
  let lit = (mixed * vignette(v.uv, 0.8, 1.35));
  return vec4<f32>(grade(lit, 2.2), 1.0);
}
