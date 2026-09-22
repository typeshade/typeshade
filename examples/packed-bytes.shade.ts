"use typeshade"

/* @example
{
  "title": "Packed 4x8 integer builtins",
  "blurb": "The eight builtins that read a `u32` as four bytes or write four back (§47): both packed dot products, both unpacks and all four packs, truncating and saturating. WGSL-only — GLSL ES 3.00 has no form of any of them, so this one is `renderable: false` and the gate runs its Tint half alone, which is exactly what the `packed4x8Dot` capability promises. The values it computes were dispatched on a real device and read back, and the CPU oracle returns the same ones.",
  "renderable": false,
  "reason": "packed4x8Dot"
}
*/
// The packed 4x8 integer family (§47). Eight builtins that read a `u32` as four bytes or write
// four back, and WGSL has all eight while GLSL ES 3.00 has none of them: no dot product of
// packed bytes, no byte pack, no byte unpack. So this example is WGSL-ONLY — registered
// `renderable: false`, and the gate runs its Tint half alone. A module reaching the GLSL writer
// with one of these would be a capability that failed to fail closed, which is what the
// `packed4x8Dot` row is for.
//
// Measured on Tint, with a broken shader fed to the same instrument first: all eight compile
// with NO directive, and `enable packed_4x8_integer_dot_product;` is REFUSED — "expected
// extension | Possible values: 'clip_distances', 'dual_source_blending', 'f16',
// 'primitive_index', 'subgroups'" — because it is a WGSL LANGUAGE feature rather than an
// extension. A host checks it on `navigator.gpu.wgslLanguageFeatures`, and
// `reflect().requiredLanguageFeatures` is where it reads the name.
//
// The VALUES below were dispatched on a real device and read back, so the CPU oracle is
// checked against the hardware rather than against a second reading of the specification:
// `dot4U8Packed(0x01010101, 0x01010101)` is 4, `dot4I8Packed(0x80808080, 0x01010101)` is -512,
// `pack4xU8(vec4u(0x1FF, 0, 0, 0))` truncates to 0xFF while `pack4xU8Clamp` saturates to the
// same byte from 400, and `unpack4xI8(0x04FD02FF)` is (-1, 2, -3, 4).

class Palette {
  // Four 8-bit weights packed into one word, the way a host hands a shader a small LUT.
  weights: u32
  texels: u32
}

declare const palette: uniform<Palette>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs = array(-1., 3., -1.)
  const ys = array(-1., -1., 3.)
  const i = i32(vi)
  const p: vec2 = vec2(xs[i], ys[i])
  const out: VsOut = { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) }
  return out
}

@fragment
export function fs(v: VsOut): vec4 {
  // The two dots: four byte products summed, unsigned into a u32 and signed into an i32.
  const lit: u32 = dot4U8Packed(palette.weights, palette.texels)
  const signedLit: i32 = dot4I8Packed(palette.weights, palette.texels)

  // Unpack both ways. The signed form sign-extends each byte, which is the whole difference.
  const bytes: vec4u = unpack4xU8(palette.texels)
  const signedBytes: vec4i = unpack4xI8(palette.texels)

  // Pack both ways, truncating and saturating. A component past a byte is TRUNCATED by the
  // plain form and clamped by the `Clamp` one, which is why both are here.
  const truncated: u32 = pack4xU8(vec4u(bytes.x + u32(300), bytes.y, bytes.z, bytes.w))
  const clamped: u32 = pack4xU8Clamp(vec4u(bytes.x + u32(300), bytes.y, bytes.z, bytes.w))
  // BOTH packs return a `u32`, the signed ones included: the result is four bytes in a word,
  // not a number with a sign (WGSL index.bs:20307, :20341). Typing these `i32` emitted WGSL
  // Tint refuses, "cannot assign 'u32' to 'i32'".
  const signedPacked: u32 = pack4xI8(signedBytes)
  const signedClamped: u32 = pack4xI8Clamp(vec4i(signedBytes.x * 400, signedBytes.y, 3, 4))

  const a: f32 = f32(lit % u32(211)) / 211.
  const b: f32 = f32(u32(signedLit & 255)) / 255.
  const c: f32 = f32((truncated ^ clamped) % u32(97)) / 97.
  const d: f32 = f32((signedPacked ^ signedClamped) % u32(63)) / 63.
  return vec4(a * v.uv.x, b * v.uv.y, c * 0.5 + d * 0.5, 1.)
}
