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

fn discardOutsideCircle(p: vec2<f32>) -> vec4<f32> {
  let r = length(p);
  if ((r > 1.0)) {
    discard;
  }
  let edge = fwidth(r);
  let rim = saturate(((1.0 - r) / (edge + 0.0001)));
  let fall = (exp2(((-r) * 2.0)) * (1.0 - pow(r, 2.0)));
  return vec4<f32>((mix(vec3<f32>(0.06, 0.1, 0.35), vec3<f32>(1.0, 1.0, 1.0), fall) * rim), 1.0);
}

@fragment
fn fs(v: VsOut) -> FsOut {
  return FsOut(discardOutsideCircle(v.uv));
}
