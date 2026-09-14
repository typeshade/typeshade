const UP: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);
const SKY: vec4<f32> = vec4<f32>(0.36, 0.55, 0.85, 1.0);
const STOPS: array<f32, 3> = array<f32, 3>(0.2, 0.5, 0.8);
const PALETTE: array<vec4<f32>, 3> = array<vec4<f32>, 3>(vec4<f32>(0.95, 0.55, 0.2, 1.0), vec4<f32>(0.2, 0.7, 0.45, 1.0), vec4<f32>(0.55, 0.3, 0.8, 1.0));
const HALF: f32 = 0.5;
const GREY: vec3<f32> = vec3<f32>(HALF, HALF, HALF);

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, (y * UP.y), 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> Color {
  let t = ((v.uv.x * HALF) + HALF);
  var band: vec4<f32> = SKY;
  if ((t > STOPS[0])) {
    band = PALETTE[0];
  }
  if ((t > STOPS[1])) {
    band = PALETTE[1];
  }
  if ((t > STOPS[2])) {
    band = PALETTE[2];
  }
  let tinted = ((band.rgb * HALF) + (GREY * HALF));
  return Color(vec4<f32>(tinted, 1.0));
}
