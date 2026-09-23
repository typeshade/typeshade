"use typeshade";

// A grid of points lit from a list of lights the host uploads, written the way a TypeScript
// developer writes it: the array's own methods, `reduce` for a sum, `map` for a set of samples,
// `some` and `every` for "any" and "all", and no loop spelled out.

class Light {
  pos: vec2;
  radius: f32;
  power: f32;
}

declare const lights: storage<array<Light>>;
declare const out: storage<array<f32>, "read_write">;

/** The light that reaches `q` from every light. */
function glowAt(q: vec2) {
  return lights.reduce((sum, l) => sum + l.power / (1. + 16. * dot(l.pos - q, l.pos - q)), 0.);
}

@compute([64])
export function shade(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x * 3 >= out.length) {
    return;
  }
  const p = vec2(f32(gid.x % 16) / 8. - 1., f32(gid.x / 16) / 8. - 1.);
  // Four samples inside the point's cell, averaged.
  const offsets = array<vec2, 4>(vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(1., 1.));
  const samples = offsets.map((o) => glowAt(p + o / 32.));
  out[gid.x * 3] = samples.reduce((a, s) => a + s, 0.) / 4.;
  out[gid.x * 3 + 1] = lights.some((l) => distance(l.pos, p) < l.radius) ? 1. : 0.;
  out[gid.x * 3 + 2] = lights.every((l) => distance(l.pos, p) > 2. * l.radius) ? 1. : 0.;
}
