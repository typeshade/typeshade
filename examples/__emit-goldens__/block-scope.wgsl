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
  var cell: vec2<f32> = (v.uv * RINGS);
  cell %= 1.0;
  let acc_1 = (step(0.0, band) * 0.25);
  let acc_2 = (acc_1 + (step(0.25, band) * 0.25));
  let acc_3 = (acc_2 + (step(0.5, band) * 0.25));
  let acc_4 = (acc_3 + (step(0.75, band) * 0.25));
  let acc_5 = (acc_4 * (1.0 - (abs((band - 0.3333333333333333)) * 0.5)));
  let acc_6 = (acc_5 * (1.0 - (abs((band - 0.6666666666666666)) * 0.5)));
  let acc_7 = (acc_6 * (1.0 - (abs((band - 1.0)) * 0.5)));
  var tint: vec3<f32> = vec3<f32>(0.1, 0.2, 0.5);
  if ((r < 0.5)) {
    let p_2 = (1.0 - (r * 2.0));
    tint = mix(tint, vec3<f32>(1.0, 0.9, 0.6), vec3<f32>(p_2, p_2, p_2));
  }
  let levels = (u32((band * 255.0)) >> 4u);
  let stepped = (f32((levels << 4u)) / 255.0);
  let grid = min(abs(cell.x), abs(cell.y));
  let shaded = (((tint * acc_7) + (stepped * 0.1)) + (grid * 0.05));
  return FsOut(vec4<f32>(((shaded / RINGS) * 4.0), 1.0));
}
