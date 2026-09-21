struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let origin = vec2<f32>(0.0, 0.0);
  let steps = vec3<u32>(1u, 2u, 3u);
  let rgba8Bits = pack4x8unorm(vec4<f32>(v.uv, 0.25, 1.0));
  let rgba8 = unpack4x8unorm(rgba8Bits);
  let signed8Bits = pack4x8snorm(vec4<f32>(((v.uv * 2.0) - vec2<f32>(1.0, 1.0)), -0.5, 1.0));
  let signed8 = unpack4x8snorm(signed8Bits);
  let half = unpack2x16float(pack2x16float(v.uv));
  let u16 = unpack2x16unorm(pack2x16unorm(v.uv));
  let s16 = unpack2x16snorm(pack2x16snorm((v.uv - origin)));
  let bits = bitcast<u32>((v.uv.x + 1.0));
  let exponent = (f32(extractBits(bits, 23u, 8u)) / 255.0);
  let back = bitcast<f32>(bits);
  let grade = vec3<f32>(half.x, u16.y, exponent);
  let coarse = quantizeToF16(grade);
  let lit = (back > 1.5);
  let edge = (select(0.0, 0.15, lit) + select(0.0, 0.1, (v.uv.x > 0.98)));
  let banded = (f32(steps.y) * 0.125);
  let _lc0 = (banded * 0.1);
  let rgb = (((coarse * 0.5) + (vec3<f32>(rgba8.x, ((signed8.y * 0.5) + 0.5), ((s16.x * 0.5) + 0.5)) * 0.4)) + vec3<f32>(_lc0, _lc0, _lc0));
  return vec4<f32>(clamp((rgb + vec3<f32>(edge, edge, edge)), vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0)), rgba8.w);
}
