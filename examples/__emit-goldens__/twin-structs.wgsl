struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsIn {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

fn shade(o: FsIn) -> vec4<f32> {
  let d = (o.uv - vec2<f32>(0.5, 0.5));
  let r = length(d);
  return vec4<f32>(o.uv.x, o.uv.y, (1.0 - r), 1.0);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  let uv = ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5));
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), uv);
}

@fragment
fn fs(v: VsOut) -> Color {
  let asIn = FsIn(v.pos, v.uv);
  let a = shade(asIn);
  let b = shade(FsIn(v.pos, (v.uv * 0.5)));
  return Color(((a + b) * 0.5));
}
