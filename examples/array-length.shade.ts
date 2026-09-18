"use typeshade"

// The bounds guard every kernel over a runtime-sized storage array needs. The length of
// `src` is not in its type; it is the length of the buffer the host binds, so `src.length`
// reads it at run time as WGSL's `arrayLength(&src)`, a `u32` (#46). Before that spelling
// existed the guard folded to `gid.x >= 0u`, which is true for every unsigned invocation:
// the kernel returned at once and wrote nothing, with no diagnostic, as valid WGSL, on a
// real GPU.
//
// GLSL ES 3.00 has no storage buffer and so no form of this module; like
// `compute-reduction-twin` it is WGSL-only, and the compile gate runs it on Tint.

declare const src: storage<array<f32>>
declare let dst: storage<array<f32>>

@compute([64, 1, 1])
export function scale_all(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= src.length) {
    return
  }
  dst[gid.x] = src[gid.x] * 2.
}
