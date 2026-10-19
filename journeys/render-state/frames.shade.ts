"use typeshade";

// The render-state journey's shaders (proposal 0064, PR-1): a full-screen triangle, a fragment
// entry with three colours, and a compute entry that writes a word. The host sets the pass's
// scissor, viewport, depth range and blend constant around the draws, and reads the pixels back.
// One vertex entry and one fragment entry: the GLSL writer takes one of each per module. The depth
// of the triangle and the colour of the fragment are overrides, which each pipeline sets.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

/** The depth of the triangle in clip space: 0.5 when the pipeline gives none. */
const depth: override<f32> = 0.5;

/** The colour the fragment entry writes: 0 for the colour of the position, 1 red, 2 green and 3 white. */
const pick: override<i32> = 0;

/** A fullscreen triangle at `depth`, with `uv` running from 0 at the top left to 1 at the bottom right. */
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, depth, 1), uv: vec2(x * 0.5 + 0.5, 0.5 - y * 0.5) };
}

@fragment
export function fs(v: VsOut): Color {
  if (pick == 1) {
    return { color: vec4(1, 0, 0, 1) };
  }
  if (pick == 2) {
    return { color: vec4(0, 1, 0, 1) };
  }
  if (pick == 3) {
    return { color: vec4(1, 1, 1, 1) };
  }
  return { color: vec4(v.uv, 0.5, 1) };
}

declare const out: storage<array<f32>, "read_write">;

/** Writes 7 to the first word: a kernel pass the host runs after a render pass. */
@compute([1])
export function bump(@builtin("global_invocation_id") gid: vec3u) {
  out[gid.x] = 7.;
}
