const TILES: u32 = 8u;
const PHASE: i32 = -3;
const GAMMA: f32 = 2.2;
const INVERT: bool = true;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VsOut {
  let x = ((f32((idx & 1u)) * 4.0) - 1.0);
  let y = ((f32((idx >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let _cse0 = f32(TILES);
  let cx = u32((vo.uv.x * _cse0));
  let cy = u32((vo.uv.y * _cse0));
  let parity = (((cx + cy) + u32((PHASE + 8))) & 1u);
  let ramp = pow(vo.uv.y, GAMMA);
  let dark = (ramp * 0.25);
  let v = select(select(dark, ramp, INVERT), select(ramp, dark, INVERT), (parity == 0u));
  return vec4<f32>(v, v, v, 1.0);
}
