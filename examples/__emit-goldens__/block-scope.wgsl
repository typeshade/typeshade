const RINGS: f32 = 6.0;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let r = length(v.uv);
  var band: f32 = (r * RINGS);
  band %= 1.0;
  var acc: f32 = 0.0;
  for (var i: u32 = 0u; (i < 4u); i = (i + 1u)) {
    let p = (f32(i) * 0.25);
    acc = (acc + (step(p, band) * 0.25));
  }
  for (var i_1: u32 = 0u; (i_1 < 3u); i_1 = (i_1 + 1u)) {
    let p_1 = (f32((i_1 + 1u)) / 3.0);
    acc = (acc * (1.0 - (abs((band - p_1)) * 0.5)));
  }
  var tint: vec3<f32> = vec3<f32>(0.1, 0.2, 0.5);
  if ((r < 0.5)) {
    let p_2 = (1.0 - (r * 2.0));
    tint = mix(tint, vec3<f32>(1.0, 0.9, 0.6), vec3<f32>(p_2, p_2, p_2));
  }
  let levels = (u32((band * 255.0)) >> 4u);
  let stepped = (f32((levels << 4u)) / 255.0);
  let shaded = ((tint * acc) + (stepped * 0.1));
  return FsOut(vec4<f32>(((shaded / RINGS) * 4.0), 1.0));
}
