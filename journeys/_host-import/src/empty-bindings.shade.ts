"use typeshade";

// No authored or runtime binding: all three host argument forms draw this same gradient.
export const unbound = fragment(function unbound(p: builtin<"position", vec4>): vec4 {
  return vec4(p.x / 32., p.y / 32., 0.25, 1.);
});
