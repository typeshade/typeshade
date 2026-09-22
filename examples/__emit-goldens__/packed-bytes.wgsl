struct Palette {
  weights: u32,
  texels: u32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> palette: Palette;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  let out = VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
  return out;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let lit = dot4U8Packed(palette.weights, palette.texels);
  let signedLit = dot4I8Packed(palette.weights, palette.texels);
  let bytes = unpack4xU8(palette.texels);
  let signedBytes = unpack4xI8(palette.texels);
  let _gv0 = vec4<u32>((bytes.x + 300u), bytes.y, bytes.z, bytes.w);
  let truncated = pack4xU8(_gv0);
  let clamped = pack4xU8Clamp(_gv0);
  let signedPacked = pack4xI8(signedBytes);
  let signedClamped = pack4xI8Clamp(vec4<i32>((signedBytes.x * 400), signedBytes.y, 3, 4));
  let a = (f32((lit % 211u)) / 211.0);
  let b = (f32(u32((signedLit & 255))) / 255.0);
  let c = (f32(((truncated ^ clamped) % 97u)) / 97.0);
  let d = (f32(((signedPacked ^ signedClamped) % 63u)) / 63.0);
  return vec4<f32>((a * v.uv.x), (b * v.uv.y), ((c * 0.5) + (d * 0.5)), 1.0);
}
