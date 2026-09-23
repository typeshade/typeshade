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
  let _licm0 = U.weights;
  var acc: f32 = 0.0;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    acc = (acc + (_licm0[i].v * f32((i + 1))));
  }
  let ramp = mix(U.stops[0], U.stops[1], clamp(v.uv.x, 0.0, 1.0));
  return (ramp * (acc / max(U.count, 1.0)));
}
