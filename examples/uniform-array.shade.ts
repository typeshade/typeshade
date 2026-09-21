"use typeshade"

// A uniform holding a list, which is the shape WGSL lays out differently from every other
// (surface doc §51).
//
// `weights: array<f32, 4>` is four floats in the source and four SIXTEEN-byte slots in the
// buffer, because WGSL's uniform address space aligns every array element to 16 bytes. The
// compiler emits the padding itself — a wrapper struct carrying `@size(16)`, with the reads
// rewritten through it — so the bytes the WGSL declares are the bytes `reflect()` reports:
//
//   struct _Pad16_f32 { @size(16) v: f32, }
//   struct Palette { count: f32, @align(16) weights: array<_Pad16_f32, 4>, … }
//   …  U.weights[i].v
//
// Both attributes are load-bearing and fix different things. `@size(16)` inside the wrapper is
// the element STRIDE; `@align(16)` on the member is the array's OFFSET, which the wrapper
// cannot supply because a struct's alignment comes from its members and `@size` does not raise
// it. With only the stride, Tint reports `weights` at offset 4 — which is also the offset
// `reflect()` does not report.
//
// GLSL ES 3.00 needs none of it: a std140 block gives `float[4]` a 16-byte stride natively,
// which is why the unpadded program links on WebGL2 and dies on WebGPU. That divergence is
// the whole reason this example is renderable on BOTH targets — one host packing, two texts,
// the same memory.
//
// `stops: array<vec4, 2>` is the control: a `vec4` is already 16 bytes, so it is emitted as
// written and nothing is padded that does not need to be.

class Palette {
  // BEFORE the list, deliberately. A scalar ahead of a padded array is the shape that needs
  // the second half of the fix: the wrapper gives the element its 16-byte stride, and
  // `@align(16)` on this member gives the array its 16-byte OFFSET. Without it Tint puts
  // `weights` at offset 4 and says so, while `reflect()` reports 16.
  count: f32
  // Under 16 bytes an element: padded on WGSL, native on GLSL std140.
  weights: array<f32, 4>
  // Already 16 bytes an element: untouched on both.
  stops: array<vec4, 2>
}

declare const U: uniform<Palette>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

@fragment
export function fs(v: VsOut): vec4 {
  // Read every padded element, so the emitted `.v` hop is exercised at each index rather
  // than only at a constant one.
  let acc = 0.
  for (let i: i32 = 0; i < 4; i++) {
    acc = acc + U.weights[i] * f32(i + 1)
  }
  // …and both unpadded ones, which are read exactly as written.
  const ramp = mix(U.stops[0], U.stops[1], clamp(v.uv.x, 0., 1.))
  return ramp * (acc / max(U.count, 1.))
}
