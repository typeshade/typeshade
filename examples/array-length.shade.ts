"use typeshade";

/* @example
{
  "title": "Runtime array length",
  "blurb": "The bounds guard every kernel over a runtime-sized storage array needs: `src.length` reads the bound buffer's length as WGSL `arrayLength(&src)`, a `u32`, so the guard is real where it once folded to `gid.x >= 0u` and returned every invocation (#46). WGSL-only: GLSL ES 3.00 has no storage buffers.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// The bounds guard every kernel over a runtime-sized storage array needs. The length of
// `src` is not in its type; it is the length of the buffer the host binds, so `src.length`
// reads it at run time as WGSL's `arrayLength(&src)`, a `u32` (#46). Before that spelling
// existed the guard folded to `gid.x >= 0u`, which is true for every unsigned invocation:
// the kernel returned at once and wrote nothing, with no diagnostic, as valid WGSL, on a
// real GPU.
//
// GLSL ES 3.00 has no storage buffer and so no form of this module; like
// `compute-reduction-twin` it is WGSL-only, and the compile gate runs it on Tint.
//
// That makes it the gate's evidence for the other half of #103: `half` is a word GLSL ES 3.00
// reserves — a field of that name is "Illegal use of reserved word" on ANGLE, which is how the
// issue was found — and a word WGSL does not. A module with no GLSL form is emitted for WGSL
// alone, so the compiler does not hold this field to the other target's list, and Tint takes
// the name on every gate run. A render module declaring the same field is refused with TS8068.

declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;

// The two parts a scale of 2 is split into, named for what they hold.
class Weights {
  half: f32;
  rest: f32;
}

@compute([64, 1, 1])
export function scale_all(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= src.length) {
    return;
  }
  const w: Weights = { half: 0.5, rest: 1.5 };
  dst[gid.x] = src[gid.x] * (w.half + w.rest);
}
