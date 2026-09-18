"use typeshade"

// A storage texture: an image a shader writes by texel coordinate (§33).
//
// Not a sampled texture. There is no sampler and no filtering — the shader addresses texels
// directly — and the FORMAT and the ACCESS mode are part of the type, as they are in WGSL:
// `texture_storage_2d<"rgba8unorm", "write">` is a different type from the same texture at
// `"read"`. Written as string literal types, so `tsc` checks a mistyped format in the editor
// before this compiler sees the file.
//
// WGSL-only. GLSL ES 3.00 has no image load/store at all — that is ES 3.10 — so a module
// carrying one emits WGSL alone, the same way a storage buffer or an atomic does. Measured on
// a WebGL2 driver rather than read off the spec: `layout(rgba8) uniform writeonly image2D` is
// "invalid layout qualifier: not supported", and asking for the extension that would bring it
// is "extension is not supported".
//
// Two things this refuses that Tint does NOT, because Tint compiles a shader and a device
// binds one. Tint accepts every format at every access mode; a real device accepts
// `"read_write"` only at `"r32uint"`, `"r32sint"` and `"r32float"`, and accepts no format
// outside the sixteen below without an extra feature request. Both were measured by asking a
// device to build a bind group layout for each pair. A spelling Tint takes and a device
// refuses passes the compile gate and then fails at `createBindGroupLayout`, which is a wrong
// program emitted without a diagnostic — the shape issue #113 was.

// Written, never read: `"write"` is the access mode, and `textureLoad` on this is refused.
declare const dst: texture_storage_2d<"rgba8unorm", "write">

// Read and written through one binding, which only the three single-channel 32-bit formats
// allow. An accumulator is what that is for.
declare const acc: texture_storage_2d<"r32float", "read_write">

// An integer format stores an integer texel: a `"…uint"` format takes a `vec4u`, a `"…sint"`
// one a `vec4i`. The conditional type in the ambient lib makes the editor say so too.
declare const ids: texture_storage_2d<"rgba8uint", "write">

@compute([64, 1, 1])
export function paint(@builtin("global_invocation_id") gid: vec3u): void {
  // One invocation per texel, addressed as a row-major index into the image: the workgroup is
  // one-dimensional (§25), so the two coordinates come out of the index rather than out of
  // `gid.y`. The guard is the standard one — a dispatch covers whole workgroups, so the last
  // one runs past the end.
  const size = textureDimensions(dst)
  const width = size.x
  const x = gid.x % width
  const y = gid.x / width
  if (y >= size.y) {
    return
  }
  const at: vec2i = vec2i(i32(x), i32(y))
  const uv: vec2 = vec2(f32(x) / f32(size.x), f32(y) / f32(size.y))

  // Read the accumulator, add to it, write it back: one binding, both ways.
  const seen = textureLoad(acc, at)
  const weight = seen.x + length(uv - vec2(0.5))
  textureStore(acc, at, vec4(weight, 0., 0., 0.))

  const shade = smoothstep(0., 1., weight * 0.5)
  textureStore(dst, at, vec4(uv.x, uv.y, shade, 1.))

  // The same coordinate in an integer texture, as an id map is written.
  textureStore(ids, at, vec4u(x % u32(256), y % u32(256), u32(1), u32(255)))
}
