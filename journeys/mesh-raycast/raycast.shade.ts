"use typeshade";

// One ray per invocation, tested against every triangle of a mesh whose size the host decides
// at run time: `for (let t = 0; t < verts.length / 3; t++)`, the loop a TypeScript author writes
// first (Rule 7.5, #209). Nothing here is annotated to please the compiler.

class Ray {
  origin: vec4;
  dir: vec4;
}

declare const verts: storage<array<vec4>>;
declare const rays: storage<array<Ray>>;
declare let hits: storage<array<f32>>;

function intersect(o: vec3, d: vec3, a: vec3, b: vec3, c: vec3): f32 {
  // Workaround (#162): TypeScript reads vector arithmetic as `number`, so these locals carry
  // their types for the editor and for plain `tsc`; the compiler needs none of them.
  const e1: vec3 = b - a;
  const e2: vec3 = c - a;
  const p: vec3 = cross(d, e2);
  const det = dot(e1, p);
  if (abs(det) < 0.000001) {
    return -1;
  }
  const inv = 1 / det;
  const s: vec3 = o - a;
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) {
    return -1;
  }
  const q: vec3 = cross(s, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) {
    return -1;
  }
  return dot(e2, q) * inv;
}

@compute([64])
export function trace(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= rays.length) {
    return;
  }
  const ray = rays[gid.x];
  let nearest = 1e30;
  const triangles = verts.length / 3;
  for (let t = 0; t < triangles; t++) {
    const d = intersect(ray.origin.xyz, ray.dir.xyz, verts[t * 3].xyz, verts[t * 3 + 1].xyz, verts[t * 3 + 2].xyz);
    if (d > 0 && d < nearest) {
      nearest = d;
    }
  }
  hits[gid.x] = nearest < 1e30 ? nearest : -1;
}
