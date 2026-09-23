"use typeshade"

/* @example
{
  "title": "Compute reduction (source twin)",
  "blurb": "`compute-reduction.ts` written in the source language: the EDSL's `reduce()` combinator spelled as the `for` loop it expands into. WGSL-only like its original — GLSL ES 3.00 has no compute stage.",
  "renderable": false,
  "twinOf": "compute-reduction",
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// The `"use typeshade"` twin of `compute-reduction.ts`. Same kernel, written in the source
// language. Two things in the original have no source-language spelling, and both are
// deliberate rather than gaps:
//
//   * `reduce(...)` is an EDSL COMBINATOR — a fold the authoring layer expands into a loop.
//     A `for` loop IS the source language's spelling of it, so that is what this is.
//   * `const WINDOW = u32(8)` is a BUILD-TIME JavaScript constant. It never becomes a WGSL
//     declaration; it inlines as `8u` at both use sites. A module-scope `const WINDOW: u32`
//     here would emit a `const` declaration the original never emits, so the faithful twin
//     inlines too — and, separately, that spelling is currently broken (#13: an integer
//     module constant emits `const WINDOW: u32 = 8.0;`, which Tint rejects).
//
// The diff goldens in `shade-twins.test.ts` pin what the remaining differences cost.

declare const input: storage<array<f32>>
declare const output: storage<array<f32>, "read_write">
// .x = number of output elements (one reduced window each).
declare const params: uniform<vec4u>

@compute([64, 1, 1])
export function reduce_windows(@builtin("global_invocation_id") gid: vec3u): void {
  const idx = gid.x
  if (idx >= params.x) {
    return
  }

  // Fold 8 (the original's WINDOW) elements: sum starts at 0, j in [0, 8), accumulate.
  const base = idx * 8
  let sum = 0.
  for (let j: u32 = 0; j < 8; j++) {
    sum = sum + input[base + j]
  }

  output[idx] = sum
}
