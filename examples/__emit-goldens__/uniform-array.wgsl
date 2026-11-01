struct _Pad16_f32 {
  @size(16) v: f32,
}

struct Palette {
  count: f32,
  @align(16) weights: array<_Pad16_f32, 4>,
  stops: array<vec4<f32>, 2>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Palette;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let acc_1 = U.weights[0].v;
  let acc_2 = (acc_1 + (U.weights[1].v * 2.0));
  let acc_3 = (acc_2 + (U.weights[2].v * 3.0));
  let acc_4 = (acc_3 + (U.weights[3].v * 4.0));
  let ramp = mix(U.stops[0], U.stops[1], clamp(v.uv.x, 0.0, 1.0));
  return (ramp * (acc_4 / max(U.count, 1.0)));
}
