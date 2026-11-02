"use typeshade";

/* @example
{
  "title": "Hello triangle",
  "blurb": "The smallest complete TypeShade program — a vertex stage that positions three corners from `vertex_index` and a fragment stage that paints them flat red. Both stages, two IO structs, no resources.",
  "renderable": true
}
*/

interface Clip {
  pos: builtin<"position", vec4>;
}

interface Color {
  color: location<0, vec4>;
}

export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): Clip {
  let x = -0.8;
  let y = -0.8;
  if (i === 1) {
    x = 0.8;
  }
  if (i === 2) {
    x = 0.;
    y = 0.8;
  }
  return { pos: vec4(x, y, 0., 1.) };
});

export const fs = fragment(function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) };
});
