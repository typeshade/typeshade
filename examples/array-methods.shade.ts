"use typeshade";

/* @example
{
  "title": "An array's methods",
  "blurb": "Three lights in an `array<Light, 3>`, lit with the methods a TypeScript author reaches for first (Rule 8.18, surface §63). `lights.map(...)` measures how far the pixel is from each light, `d.reduce(...)` keeps the nearest, `lights.forEach(...)` adds each glow into `col` through a pointer, and `lights.some(...)` and `d.every(...)` test the pixel against them all. Each call is a call of a counted loop made for the array's type and the function handed over: `array_map_fs_f`, `array_forEach_fs_f_2`. Renders three glows, a ring around the nearest light, and a lighter disc inside each.",
  "renderable": true
}
*/

// An array's five methods (Rule 8.18, surface §63):
//
// - `map`, `forEach`, `some`, `every` and `reduce` take a function as `Array.prototype` does,
//   by its name or as an arrow function written in the call, which gets the element, its index
//   (an `i32`) and the array;
// - each call is a call of a function of the module made for the array's type and that
//   function, a counted loop that calls it (Rule 7.5): a call stands where a loop could not,
//   in an argument or on the right of `&&`;
// - what the function captures, the loop takes and passes on, by reference where it writes:
//   `forEach` adds into `col` here.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class FsOut {
  @location(0) color: vec4;
}

// Fullscreen triangle, as `rng-method.shade.ts` draws it.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}

class Light {
  pos: vec2;
  radius: f32;
  color: vec3;
}

@fragment
export function fs(v: VsOut): FsOut {
  const p = v.uv;
  const lights = array<Light, 3>(
    { pos: vec2(-0.5, -0.3), radius: 0.35, color: vec3(1., 0.45, 0.2) },
    { pos: vec2(0.45, -0.1), radius: 0.3, color: vec3(0.2, 0.6, 1.) },
    { pos: vec2(0., 0.5), radius: 0.25, color: vec3(0.4, 1., 0.5) },
  );
  // How far the pixel is from each light, and from the nearest.
  const d = lights.map((l) => distance(l.pos, p));
  const nearest = d.reduce((a, b) => min(a, b));
  // Each light's glow, added into `col` through a pointer.
  let col = vec3(0.02, 0.02, 0.05);
  lights.forEach((l, i) => {
    col += l.color * (0.02 / (0.02 + d[i] * d[i]));
  });
  // A lighter disc inside any light, and a dimmer field far from every one.
  if (lights.some((l) => distance(l.pos, p) < l.radius)) {
    col = mix(col, vec3(1.), 0.15);
  }
  if (d.every((x) => x > 0.7)) {
    col *= 0.6;
  }
  // A ring at 0.2 around the nearest light.
  col += vec3(1. - smoothstep(0., 0.012, abs(nearest - 0.2)));
  return { color: vec4(col, 1.) };
}
