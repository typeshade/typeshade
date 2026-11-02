"use typeshade";

/* @example
{
  "title": "Hello varyings",
  "blurb": "The triangle again, now carrying a `uv` varying from the vertex stage into the fragment stage through a shared `VsOut` interface — the `builtin<\"position\", vec4>` + `location<0, vec2>` pair that every interpolated value rides.",
  "renderable": true
}
*/

interface VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}

interface Color {
  color: location<0, vec4>;
}

export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  let x = -0.8;
  let y = -0.8;
  let u = 0.;
  let v = 0.;
  if (i === 1) {
    x = 0.8;
    u = 1.;
  }
  if (i === 2) {
    x = 0.;
    y = 0.8;
    u = 0.5;
    v = 1.;
  }
  return { pos: vec4(x, y, 0., 1.), uv: vec2(u, v) };
});

export const fs = fragment(function fs(v: VsOut): Color {
  return { color: vec4(v.uv.x, v.uv.y, 0.2, 1.) };
});
