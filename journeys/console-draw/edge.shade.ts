"use typeshade";

// The fragment of pixels.shade.ts, from an entry whose work reads its neighbours: `fwidth` is
// taken over a 2x2 quad, so the GPU runs helper invocations beside a lone pixel. A helper
// writes nothing, so a one-pixel scissor still records one line (surface §66).

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

/** A fullscreen triangle, with `uv` running from 0 at the top left to 1 at the bottom right. */
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, 0, 1), uv: vec2(x * 0.5 + 0.5, 0.5 - y * 0.5) };
}

/** `fwidth` is never negative, so no pixel is discarded; the call only makes the quad's
 *  neighbours run. */
@fragment
export function edge(v: VsOut): Color {
  if (fwidth(v.uv.x) < 0) {
    discard;
  }
  console.log("pixel", v.pos.x, v.pos.y, v.uv);
  return { color: vec4(v.uv, 0, 1) };
}
