enable clip_distances;

struct Planes {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @builtin(clip_distances) clip: array<f32, 4>,
  @location(0) uv: vec2<f32>,
}

struct FsIn {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> planes: Planes;

fn VsOut_new() -> VsOut {
  var self_: VsOut = VsOut(vec4<f32>(0.0, 0.0, 0.0, 0.0), array<f32, 4>(0.0, 0.0, 0.0, 0.0), vec2<f32>(0.0, 0.0));
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  let p = vec4<f32>(x, y, 0.0, 1.0);
  var o: VsOut = VsOut_new();
  o.pos = p;
  o.uv = vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5));
  o.clip[0] = dot(planes.a, p);
  o.clip[1] = dot(planes.b, p);
  o.clip[2] = dot(planes.c, p);
  o.clip[3] = dot(planes.d, p);
  return o;
}

@fragment
fn fs(v: FsIn) -> @location(0) vec4<f32> {
  return vec4<f32>(v.uv, 0.5, 1.0);
}
