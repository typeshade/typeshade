"use typeshade";

/* @example
{
  "title": "Null, undefined and present values",
  "blurb": "Nullable classes and members retain three states through optional chaining. The left band has no object (undefined), the middle has a null member, and the right has a present value. Strict tests choose red, green and blue respectively (Rule 7.10, change 0098).",
  "renderable": true
}
*/

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
class Color { @location(0) color: vec4; }

class Sample {
  private value: f32 | null;
  constructor(value: f32 | null) { this.value = value; }
  get amount(): f32 | null { return this.value; }
}

function sample(x: f32): Sample | null {
  if (x < 0.333) { return null; }
  return new Sample(x < 0.666 ? null : x);
}

function tint(value?: f32 | null): vec3 {
  if (value === undefined) { return vec3(0.8, 0.1, 0.1); }
  if (value === null) { return vec3(0.1, 0.8, 0.1); }
  return vec3(0.1, 0.1, value);
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  const p = vec2(xs[i], ys[i]);
  return { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) };
}

@fragment
export function fs(v: VsOut): Color {
  const value = sample(v.uv.x)?.amount;
  return { color: vec4(tint(value), 1.) };
}
